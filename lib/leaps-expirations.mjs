// LEAPS expiration selection for the bake. The 14-slot chain fetch stays as-is.
// This module decides which already-listed expirations sit 9–24 months out,
// which names are worth a few extra Yahoo calls, and how those calls are
// capped. Extra chains land on in-memory `_leapsChains` only. The bake injects
// the fetch; nothing here touches the network. The extra fetch stays off
// unless LEAPS_EXTRA_FETCH=1 (or opts.enabled).

export const LEAPS_MIN_MONTHS = 9;
export const LEAPS_MAX_MONTHS = 24;
// Extra names per bake, not extra expirations. A sixth qualifier waits.
export const LEAPS_EXTRA_FETCH_CAP = 5;
// In-window dates beyond the 14 already stored. Evenly spread so the cap
// keeps a far LEAP instead of four monthlies clustered at month 9.
export const LEAPS_EXTRA_EXPIRATIONS_CAP = 4;
// Same inter-expiration pause as fetchTickerChain in scripts/build.mjs.
export const LEAPS_POLITENESS_MS = 150;
// Long-call hard band from the picks entry guard (RSI >= 80 chase, <= 20 knife).
export const LEAPS_RSI_HARD_HIGH = 80;
export const LEAPS_RSI_HARD_LOW = 20;
// Same elevated-premium percentile selectStrategy uses before it will sell
// premium instead of buying it (percentile >= 60). A finite z-score at or
// above 1.5σ is the same "premium is rich" read. attachIvRanks sets z only
// once history is long enough; a missing z leaves the percentile gate in charge.
export const LEAPS_IV_PCTILE_MAX = 60;
export const LEAPS_IV_Z_MAX = 1.5;

// Default off. The bake gates the pass on this; opts.enabled overrides it in tests.
export function leapsExtraFetchEnabled(env = process.env) {
  return env?.LEAPS_EXTRA_FETCH === "1";
}

const DAY_MS = 86400000;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toExpSec(value) {
  if (value instanceof Date) {
    const sec = Math.floor(value.getTime() / 1000);
    return Number.isFinite(sec) ? sec : null;
  }
  const n = finite(value);
  return n == null ? null : Math.floor(n);
}

// Calendar months in UTC. Day-of-month clamps to the target month
// (Jan 31 + 1 month → Feb 28/29) so the window does not spill a day.
export function addUtcMonths(date, months) {
  const src = date instanceof Date ? date : new Date(date);
  const day = src.getUTCDate();
  const shifted = new Date(Date.UTC(
    src.getUTCFullYear(),
    src.getUTCMonth() + Number(months),
    1,
    src.getUTCHours(),
    src.getUTCMinutes(),
    src.getUTCSeconds(),
    src.getUTCMilliseconds(),
  ));
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, last));
  return shifted;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Inclusive UTC calendar dates: [today + 9 months, today + 24 months].
export function leapsWindowBounds(now = new Date(), opts = {}) {
  const minMonths = opts.minMonths ?? LEAPS_MIN_MONTHS;
  const maxMonths = opts.maxMonths ?? LEAPS_MAX_MONTHS;
  const start = addUtcMonths(startOfUtcDay(now instanceof Date ? now : new Date(now)), minMonths);
  const endDay = addUtcMonths(startOfUtcDay(now instanceof Date ? now : new Date(now)), maxMonths);
  return { startMs: start.getTime(), endMs: endDay.getTime() + DAY_MS - 1 };
}

export function expirationInLeapsWindow(expSec, now = new Date(), opts = {}) {
  const sec = toExpSec(expSec);
  if (sec == null || sec <= 0) return false;
  const { startMs, endMs } = leapsWindowBounds(now, opts);
  const ms = sec * 1000;
  return ms >= startMs && ms <= endMs;
}

function normalizeListed(listed) {
  const out = [];
  const seen = new Set();
  for (const raw of listed || []) {
    const sec = toExpSec(raw);
    if (sec == null || sec <= 0 || seen.has(sec)) continue;
    seen.add(sec);
    out.push(sec);
  }
  out.sort((a, b) => a - b);
  return out;
}

function keptSet(alreadyKept) {
  const kept = new Set();
  for (const raw of alreadyKept || []) {
    const sec = toExpSec(raw);
    if (sec != null) kept.add(sec);
  }
  return kept;
}

function sampleSpread(sorted, cap) {
  if (cap <= 0 || !sorted.length) return [];
  if (sorted.length <= cap) return sorted.slice();
  if (cap === 1) return [sorted[sorted.length - 1]];
  const picked = new Set();
  for (let i = 0; i < cap; i++) {
    picked.add(Math.round((i * (sorted.length - 1)) / (cap - 1)));
  }
  for (let i = 0; i < sorted.length && picked.size < cap; i++) picked.add(i);
  return [...picked].sort((a, b) => a - b).map((i) => sorted[i]);
}

// Expirations inside the 9–24 month window that the 14-slot fetch did not
// already store. When more than `cap` qualify, keep a spread from the nearest
// in-window date through the farthest.
export function selectLeapsExpirations(listed, opts = {}) {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? LEAPS_EXTRA_EXPIRATIONS_CAP;
  const kept = keptSet(opts.alreadyKept);
  const inWindow = normalizeListed(listed).filter((sec) => !kept.has(sec) && expirationInLeapsWindow(sec, now, opts));
  return sampleSpread(inWindow, cap);
}

// Missing percentile fails closed. A finite z at or above LEAPS_IV_Z_MAX is
// elevated too. Missing z (attachIvRanks sets it only when history is long
// enough) leaves the percentile gate in charge. Ranking stays on pctile.
function ivIsElevated(ivRank) {
  if (!ivRank || typeof ivRank !== "object") return true;
  const pctile = finite(ivRank.pctile);
  if (pctile == null || pctile >= LEAPS_IV_PCTILE_MAX) return true;
  // null/omitted z is "history too short", not a zero reading (Number(null) === 0).
  if (ivRank.z == null) return false;
  const z = finite(ivRank.z);
  return z != null && z >= LEAPS_IV_Z_MAX;
}

// A LEAPS candidate is a long-term uptrend (spot above its 200-day average)
// whose premium is not already elevated (pctile under 60, and z under 1.5
// when z exists), and that is outside the hard RSI chase/knife band. Missing
// trend or percentile fails closed so the extra fetch stays on the few names
// a long-dated call is actually for.
export function qualifiesAsLeapsCandidate(entry) {
  const spot = finite(entry?.spot);
  const sma200 = finite(entry?.technicals?.sma?.sma200);
  if (spot == null || sma200 == null || !(spot > sma200)) return false;
  const rsi = finite(entry?.technicals?.rsi);
  if (rsi != null && (rsi >= LEAPS_RSI_HARD_HIGH || rsi <= LEAPS_RSI_HARD_LOW)) return false;
  if (ivIsElevated(entry?.ivRank)) return false;
  return true;
}

function chainKeys(entry) {
  const chains = entry?.chains;
  if (!chains || typeof chains !== "object") return [];
  return Object.keys(chains);
}

function rankTuple(entry) {
  const pctile = finite(entry?.ivRank?.pctile);
  return [
    pctile == null ? Number.POSITIVE_INFINITY : pctile,
    String(entry?.symbol || ""),
  ];
}

function compareRank(a, b) {
  const ka = rankTuple(a);
  const kb = rankTuple(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// Qualifying names that still have at least one unfetched in-window
// expiration, cheapest premium first, truncated to the name cap. A name
// whose LEAPS dates are already inside the 14 stored slots does not consume
// a cap slot.
export function selectLeapsNames(entries, opts = {}) {
  const cap = Math.max(0, opts.cap ?? LEAPS_EXTRA_FETCH_CAP);
  const ranked = [];
  for (const entry of entries || []) {
    if (!entry || !qualifiesAsLeapsCandidate(entry)) continue;
    const extras = selectLeapsExpirations(entry._listedExpirations || entry.listedExpirations || [], {
      now: opts.now,
      alreadyKept: chainKeys(entry),
      cap: opts.expirationCap,
      minMonths: opts.minMonths,
      maxMonths: opts.maxMonths,
    });
    if (!extras.length) continue;
    ranked.push({ symbol: String(entry.symbol || ""), extras, entry });
  }
  ranked.sort((a, b) => compareRank(a.entry, b.entry));
  return ranked.slice(0, cap);
}

function expLabel(expSec) {
  const ms = Number(expSec) * 1000;
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return String(expSec);
  return d.toISOString().slice(0, 10);
}

function safeLog(log, message) {
  try {
    log(message);
  } catch {
    // A logger failure must not fail the bake.
  }
}

function usableChain(chain) {
  if (!chain || typeof chain !== "object") return null;
  const calls = Array.isArray(chain.c) ? chain.c : [];
  const puts = Array.isArray(chain.p) ? chain.p : [];
  if (!calls.length && !puts.length) return null;
  return { c: calls, p: puts };
}

// Fetch the selected tail onto `_leapsChains`. Names run together; each name's
// expirations stay in order with the politeness gap. One attempt per
// expiration. A reject, timeout, empty chain, or throw on one name is logged
// and skipped. The public `chains` / `expirations` maps are left untouched.
export async function attachLeapsExpirations(chains, opts = {}) {
  const empty = { names: [], calls: 0, attached: 0 };
  const enabled = opts.enabled ?? leapsExtraFetchEnabled(opts.env);
  if (enabled !== true) return empty;
  if (!chains || typeof chains !== "object") return empty;
  const fetchExpiration = opts.fetchExpiration;
  const log = typeof opts.log === "function" ? opts.log : console.log;
  const sleep = typeof opts.sleep === "function"
    ? opts.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const politenessMs = opts.politenessMs ?? LEAPS_POLITENESS_MS;
  if (typeof fetchExpiration !== "function") {
    safeLog(log, "  ⚠ LEAPS expiration pass skipped: no fetch helper");
    return empty;
  }

  const entries = [];
  for (const [symbol, data] of Object.entries(chains)) {
    if (!data || typeof data !== "object") continue;
    entries.push({ ...data, symbol });
  }
  const selected = selectLeapsNames(entries, opts);
  const callCap = selected.reduce((sum, row) => sum + row.extras.length, 0);
  let calls = 0;

  async function attachName(row) {
    const stats = { symbol: row.symbol, attached: 0, included: false };
    try {
      const data = chains[row.symbol];
      if (!data || typeof data !== "object" || !row.symbol) return stats;
      stats.included = true;
      for (let i = 0; i < row.extras.length; i++) {
        if (calls >= callCap) break;
        const expSec = row.extras[i];
        if (i > 0 && politenessMs > 0) await sleep(politenessMs);
        if (calls >= callCap) break;
        calls += 1;
        let fetched = null;
        try {
          fetched = await fetchExpiration(row.symbol, expSec);
        } catch (err) {
          safeLog(log, `  ⚠ LEAPS ${row.symbol} ${expLabel(expSec)} failed: ${err?.message || err}`);
          continue;
        }
        const chain = usableChain(fetched);
        if (!chain) {
          safeLog(log, `  ⚠ LEAPS ${row.symbol} ${expLabel(expSec)} missing`);
          continue;
        }
        try {
          if (!data._leapsChains || typeof data._leapsChains !== "object" || Array.isArray(data._leapsChains)) {
            data._leapsChains = {};
          }
          data._leapsChains[expSec] = chain;
        } catch (err) {
          safeLog(log, `  ⚠ LEAPS ${row.symbol} ${expLabel(expSec)} failed: ${err?.message || err}`);
          break;
        }
        stats.attached += 1;
      }
    } catch (err) {
      safeLog(log, `  ⚠ LEAPS ${row.symbol} failed: ${err?.message || err}`);
    }
    return stats;
  }

  const settled = await Promise.all(selected.map((row) => attachName(row)));
  const names = [];
  let attached = 0;
  for (const stats of settled) {
    attached += stats.attached;
    if (stats.included) names.push(stats.symbol);
  }
  return { names, calls, attached };
}

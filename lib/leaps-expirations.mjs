// LEAPS expiration selection for the bake. The 14-slot chain fetch stays as-is.
// This module only decides which already-listed expirations sit 9–24 months
// out, which names are worth a few extra Yahoo calls, and how those calls are
// capped. The bake injects the fetch; nothing here touches the network.

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
// Same "elevated premium" line selectStrategy uses before it will sell
// premium instead of buying it (z >= 1.5 OR percentile >= 60).
export const LEAPS_IV_Z_MAX = 1.5;
export const LEAPS_IV_PCTILE_MAX = 60;

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

function ivIsElevated(ivRank) {
  if (!ivRank || typeof ivRank !== "object") return true;
  const z = finite(ivRank.z);
  const pctile = finite(ivRank.pctile);
  if (z == null && pctile == null) return true;
  if (z != null && z >= LEAPS_IV_Z_MAX) return true;
  if (pctile != null && pctile >= LEAPS_IV_PCTILE_MAX) return true;
  return false;
}

// A LEAPS candidate is a long-term uptrend (spot above its 200-day average)
// whose premium is not already elevated, and that is outside the hard RSI
// chase/knife band. Missing trend or IV fails closed so the extra fetch
// stays on the few names a long-dated call is actually for.
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
  const z = finite(entry?.ivRank?.z);
  const pctile = finite(entry?.ivRank?.pctile);
  return [
    z == null ? Number.POSITIVE_INFINITY : z,
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

// Fetch the selected tail and merge it into the existing chains map.
// One attempt per expiration. A reject, timeout, or empty chain is logged
// and skipped. Names outside the capped shortlist are not read for writes.
export async function attachLeapsExpirations(chains, opts = {}) {
  const empty = { names: [], calls: 0, attached: 0 };
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
  const names = [];
  let calls = 0;
  let attached = 0;

  for (const row of selected) {
    if (calls >= callCap) break;
    const data = chains[row.symbol];
    if (!data || typeof data !== "object" || !row.symbol) continue;
    names.push(row.symbol);
    if (!data.chains || typeof data.chains !== "object") data.chains = {};
    if (!Array.isArray(data.expirations)) data.expirations = [];
    for (const expSec of row.extras) {
      if (calls >= callCap) break;
      if (calls > 0 && politenessMs > 0) await sleep(politenessMs);
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
      data.chains[expSec] = chain;
      if (!data.expirations.some((existing) => toExpSec(existing) === expSec)) {
        data.expirations.push(expSec);
        data.expirations.sort((a, b) => toExpSec(a) - toExpSec(b));
      }
      attached += 1;
    }
  }

  return { names, calls, attached };
}

// O2 — Cboe daily put/call ratios and volume by product.
//
// https://www.cboe.com/us/options/market_statistics/daily/?dt=YYYY-MM-DD is a
// server-rendered page with a "Ratios" table (TOTAL / INDEX / EQUITY / VIX /
// SPX + SPXW ...) and, per product, a titled table ("SUM OF ALL PRODUCTS",
// "EQUITY OPTIONS" ...) of Name | Call | Put | Total with a VOLUME and an
// OPEN INTEREST row. The bake reads the last completed session once per ET
// day and keeps 250 sessions of the headline ratios. Until the history is
// full each build also backfills a few older sessions from the same page, so
// the 250-session z and percentile fill in about a week instead of a year.
// Free, no key.

import { fetchText, finite, round, carried, errorText, stripTags, recentWeekdays, upsertDated, fetchedToday, mean, zScore, percentileRank } from "./util.mjs";

export const PUT_CALL_URL = (iso) => `https://www.cboe.com/us/options/market_statistics/daily/?dt=${iso}`;
export const PUT_CALL_HISTORY_DAYS = 250;
// Older sessions fetched per build while the history is short; a run of
// failures stops the pass early so a blocked page costs a few requests.
export const PUT_CALL_BACKFILL_PER_BUILD = 10;
// The z and percentile need this many earlier sessions; fewer would let a
// handful of days swing the read (and the tape vote behind
// PICKS_MACRO_PUTCALL_SRC=cboe) from one end to the other.
export const PUT_CALL_MIN_STATS = 60;
const BACKFILL_MISS_KEEP = 40;

const RATIO_LABELS = {
  total: /^TOTAL PUT\/CALL RATIO/i,
  index: /^INDEX PUT\/CALL RATIO/i,
  etp: /^EXCHANGE TRADED PRODUCTS PUT\/CALL RATIO/i,
  equity: /^EQUITY PUT\/CALL RATIO/i,
  vix: /^CBOE VOLATILITY INDEX \(VIX\) PUT\/CALL RATIO/i,
  spx: /^SPX \+ SPXW PUT\/CALL RATIO/i,
};
const VOLUME_LABELS = {
  total: /^SUM OF ALL PRODUCTS/i,
  index: /^INDEX OPTIONS/i,
  etp: /^EXCHANGE TRADED PRODUCTS$/i,
  equity: /^EQUITY OPTIONS/i,
  vix: /^CBOE VOLATILITY INDEX \(VIX\)$/i,
  spx: /^SPX \+ SPXW$/i,
};

function volumeSection(cell) {
  const label = String(cell || "").replace(/\s+NAME$/i, "").trim();
  for (const [key, re] of Object.entries(VOLUME_LABELS)) if (re.test(label)) return key;
  return null;
}

// Parses the page into { ratios: {total, index, ...}, volume: { total: {calls, puts, total, oiCalls, oiPuts, oiTotal} ... } }.
// Volume comes from each product's titled table (its VOLUME and OPEN INTEREST
// rows; the live layout, checked 2026-11-09) or, for an older one-row layout,
// from numbers that follow the product label on the same row.
export function parsePutCallPage(html) {
  const lines = stripTags(html).split("\n").map((l) => l.trim()).filter(Boolean);
  const ratios = {};
  const volume = {};
  let section = null;
  for (const line of lines) {
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
    if (!cells.length) continue;
    const head = volumeSection(cells[0]);
    if (head) section = head;
    else if (/PUT\/CALL RATIO/i.test(cells[0]) || /^RATIOS$/i.test(cells[0])) section = null;
    const first = cells[0].toUpperCase();
    if (section && (first === "VOLUME" || first === "OPEN INTEREST") && cells.length >= 4) {
      const nums = cells.slice(1, 4).map(finite);
      if (nums.every((n) => n != null)) {
        const v = volume[section] || (volume[section] = { calls: null, puts: null, total: null, oiCalls: null, oiPuts: null, oiTotal: null });
        if (first === "VOLUME" && v.calls == null) { v.calls = nums[0]; v.puts = nums[1]; v.total = nums[2]; }
        if (first === "OPEN INTEREST" && v.oiCalls == null) { v.oiCalls = nums[0]; v.oiPuts = nums[1]; v.oiTotal = nums[2]; }
      }
      continue;
    }
    if (cells.length < 2) continue;
    // Walk the cells so a row that lost its line break still parses:
    // a label cell followed by its value cell(s).
    for (let i = 0; i < cells.length - 1; i++) {
      const label = cells[i];
      for (const [key, re] of Object.entries(RATIO_LABELS)) {
        if (ratios[key] == null && re.test(label)) {
          const v = finite(cells[i + 1]);
          if (v != null) ratios[key] = v;
        }
      }
      for (const [key, re] of Object.entries(VOLUME_LABELS)) {
        if (!volume[key] && re.test(label)) {
          const nums = [];
          for (let j = i + 1; j < cells.length && nums.length < 6; j++) {
            const n = finite(cells[j]);
            if (n == null) break;
            nums.push(n);
          }
          if (nums.length >= 3) {
            volume[key] = { calls: nums[0], puts: nums[1], total: nums[2], oiCalls: nums[3] ?? null, oiPuts: nums[4] ?? null, oiTotal: nums[5] ?? null };
          }
        }
      }
    }
  }
  for (const [key, v] of Object.entries(volume)) if (v.calls == null && v.oiCalls == null) delete volume[key];
  return { ratios, volume, found: Object.keys(ratios).length };
}

function ratioStats(history, idx) {
  const vals = history.map((r) => r[idx]).filter((v) => Number.isFinite(v));
  const latest = vals[vals.length - 1];
  const prior = vals.slice(0, -1).slice(-PUT_CALL_HISTORY_DAYS);
  const enough = prior.length >= PUT_CALL_MIN_STATS;
  return {
    value: latest ?? null,
    avg20: prior.length >= 20 ? round(mean(prior.slice(-20)), 2) : null,
    z250: enough ? zScore(latest, prior) : null,
    pct250: enough ? percentileRank(latest, prior) : null,
    n: prior.length,
  };
}

function rowFromPage(day, parsed) {
  return [day, parsed.ratios.total ?? null, parsed.ratios.equity ?? null, parsed.ratios.index ?? null, parsed.ratios.vix ?? null, parsed.ratios.spx ?? null, parsed.ratios.etp ?? null];
}

function statsFor(history) {
  return {
    total: ratioStats(history, 1), equity: ratioStats(history, 2), index: ratioStats(history, 3),
    vix: ratioStats(history, 4), spx: ratioStats(history, 5), etp: ratioStats(history, 6),
  };
}

// Older sessions missing from the history, newest first, up to the cap. A
// day that returned no ratios table is remembered (backfillMisses) and not
// asked for again.
async function backfillHistory({ history, misses, sessionDates, todayEt, latestDay, fetchImpl, limit = PUT_CALL_BACKFILL_PER_BUILD }) {
  const have = new Set((history || []).map((r) => r[0]));
  const skip = new Set(misses || []);
  const wanted = (Array.isArray(sessionDates) ? sessionDates : [])
    .filter((d) => d < todayEt && d !== latestDay && !have.has(d) && !skip.has(d))
    .sort().reverse().slice(0, PUT_CALL_HISTORY_DAYS);
  // Nothing older than the window can stay once the history is full.
  const room = PUT_CALL_HISTORY_DAYS - (history || []).length;
  let out = history || [];
  const newMisses = [];
  let added = 0;
  let failures = 0;
  for (const day of wanted.slice(0, Math.max(0, Math.min(limit, room)))) {
    if (failures >= 3) break;
    try {
      const parsed = parsePutCallPage(await fetchImpl(PUT_CALL_URL(day), { accept: "text/html" }));
      if (!parsed.found || parsed.ratios.total == null) { newMisses.push(day); failures++; continue; }
      out = upsertDated(out, rowFromPage(day, parsed), PUT_CALL_HISTORY_DAYS);
      added++;
      failures = 0;
    } catch {
      failures++;
    }
  }
  return { history: out, added, misses: [...(misses || []), ...newMisses].slice(-BACKFILL_MISS_KEEP) };
}

export async function fetchPutCall({ prior, todayEt, sessionDates, nowIso = new Date().toISOString(), fetchImpl = fetchText, backfill = PUT_CALL_BACKFILL_PER_BUILD } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const fillIn = async (block) => {
    if (!backfill || !Array.isArray(block.history) || block.history.length >= PUT_CALL_HISTORY_DAYS) return block;
    const got = await backfillHistory({ history: block.history, misses: block.backfillMisses, sessionDates, todayEt, latestDay: block.asOf, fetchImpl, limit: backfill });
    if (!got.added && got.misses.length === (block.backfillMisses || []).length) return block;
    return { ...block, history: got.history, backfillMisses: got.misses, backfilledAt: got.added ? nowIso : (block.backfilledAt || null), stats: statsFor(got.history) };
  };
  if (fetchedToday(base, todayEt)) return fillIn({ ...base, carriedForward: false });
  const candidates = (Array.isArray(sessionDates) && sessionDates.length
    ? sessionDates.filter((d) => d < todayEt).sort().reverse()
    : recentWeekdays(todayEt, 6)).slice(0, 4);
  const errors = [];
  for (const day of candidates) {
    if (Array.isArray(base.history) && base.history.some((r) => r[0] === day) && base.asOf === day) {
      return fillIn({ ...base, ok: true, stale: false, carriedForward: false, fetchedDate: todayEt, fetchedAt: nowIso, error: null });
    }
    try {
      const html = await fetchImpl(PUT_CALL_URL(day), { accept: "text/html" });
      const parsed = parsePutCallPage(html);
      if (!parsed.found || parsed.ratios.total == null) {
        errors.push(`${day}: ratios table not found`);
        continue;
      }
      const history = upsertDated(base.history, rowFromPage(day, parsed), PUT_CALL_HISTORY_DAYS);
      return fillIn({
        ok: true, stale: false, carriedForward: false, error: null,
        fetchedAt: nowIso, fetchedDate: todayEt, asOf: day,
        ratios: parsed.ratios,
        volume: parsed.volume,
        stats: statsFor(history),
        history,
        backfillMisses: Array.isArray(base.backfillMisses) ? base.backfillMisses : [],
        backfilledAt: base.backfilledAt || null,
        note: "Cboe exchanges only (Cboe, C2, BZX, EDGX), end of day. Index ratios run high by construction because hedgers buy index puts; the equity ratio is the retail-heavy line. The z-score and percentile need 60 earlier sessions.",
      });
    } catch (err) {
      errors.push(`${day}: ${errorText(err)}`);
    }
  }
  return carried(base, errors[0] || "no session read", nowIso);
}

// O2 — Cboe daily put/call ratios and volume by product.
//
// https://www.cboe.com/us/options/market_statistics/daily/?dt=YYYY-MM-DD is a
// server-rendered page with a "Ratios" table (TOTAL / INDEX / EQUITY / VIX /
// SPX + SPXW ...) and Call / Put / Total volume + open interest per product.
// The bake reads the last completed session once per ET day and keeps 250
// sessions of the four headline ratios. Free, no key.

import { fetchText, finite, round, carried, errorText, stripTags, recentWeekdays, upsertDated, fetchedToday, mean, zScore, percentileRank } from "./util.mjs";

export const PUT_CALL_URL = (iso) => `https://www.cboe.com/us/options/market_statistics/daily/?dt=${iso}`;
export const PUT_CALL_HISTORY_DAYS = 250;

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

// Parses the page into { ratios: {total, index, ...}, volume: { total: {calls, puts, total, oiCalls, oiPuts, oiTotal} ... } }.
export function parsePutCallPage(html) {
  const lines = stripTags(html).split("\n").map((l) => l.trim()).filter(Boolean);
  const ratios = {};
  const volume = {};
  for (const line of lines) {
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
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
  return { ratios, volume, found: Object.keys(ratios).length };
}

function ratioStats(history, idx) {
  const vals = history.map((r) => r[idx]).filter((v) => Number.isFinite(v));
  const latest = vals[vals.length - 1];
  const prior = vals.slice(0, -1);
  return {
    value: latest ?? null,
    avg20: round(mean(prior.slice(-20)), 2),
    z250: zScore(latest, prior.slice(-250)),
    pct250: percentileRank(latest, prior.slice(-250)),
  };
}

export async function fetchPutCall({ prior, todayEt, sessionDates, nowIso = new Date().toISOString(), fetchImpl = fetchText } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  const candidates = (Array.isArray(sessionDates) && sessionDates.length
    ? sessionDates.filter((d) => d < todayEt).sort().reverse()
    : recentWeekdays(todayEt, 6)).slice(0, 4);
  const errors = [];
  for (const day of candidates) {
    if (Array.isArray(base.history) && base.history.some((r) => r[0] === day) && base.asOf === day) {
      return { ...base, ok: true, stale: false, carriedForward: false, fetchedDate: todayEt, fetchedAt: nowIso, error: null };
    }
    try {
      const html = await fetchImpl(PUT_CALL_URL(day), { accept: "text/html" });
      const parsed = parsePutCallPage(html);
      if (!parsed.found || parsed.ratios.total == null) {
        errors.push(`${day}: ratios table not found`);
        continue;
      }
      const row = [day, parsed.ratios.total ?? null, parsed.ratios.equity ?? null, parsed.ratios.index ?? null, parsed.ratios.vix ?? null, parsed.ratios.spx ?? null, parsed.ratios.etp ?? null];
      const history = upsertDated(base.history, row, PUT_CALL_HISTORY_DAYS);
      return {
        ok: true, stale: false, carriedForward: false, error: null,
        fetchedAt: nowIso, fetchedDate: todayEt, asOf: day,
        ratios: parsed.ratios,
        volume: parsed.volume,
        stats: {
          total: ratioStats(history, 1), equity: ratioStats(history, 2), index: ratioStats(history, 3),
          vix: ratioStats(history, 4), spx: ratioStats(history, 5), etp: ratioStats(history, 6),
        },
        history,
        note: "Cboe exchanges only (Cboe, C2, BZX, EDGX), end of day. Index ratios run high by construction because hedgers buy index puts; the equity ratio is the retail-heavy line.",
      };
    } catch (err) {
      errors.push(`${day}: ${errorText(err)}`);
    }
  }
  return carried(base, errors[0] || "no session read", nowIso);
}

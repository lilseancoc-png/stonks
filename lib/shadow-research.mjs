// Shadow-signal research: measures every logged-not-scored candidate input
// (lib/shadow-signals.mjs) in the bake, so the Owner Lab Evidence tab shows
// the same table scripts/diagnose-grade-ic.mjs prints, every day, without a
// hand-run script.
//
// Three reads per key:
//   1. Universe rank IC: on each grades-daily row that carries a shadow block,
//      the Spearman rank correlation between the key's value and each name's
//      forward 5- and 10-session return (own bars, close to close). Days need
//      RESEARCH_MIN_NAMES names with both. The read is the mean over every
//      day; the t-statistic uses non-overlapping days only.
//   2. After the grade: the partial rank correlation of the key with the
//      forward return once the grade total is held fixed, so a key that only
//      repeats what the grade already knows reads near zero.
//   3. On real trades: the decided Top Picks trades that froze the key in
//      their entry snapshot (lib/trade-snapshot.mjs), the value signed to the
//      trade's side (a put flips it), against the option P&L.
// The pass bar agreed on 2026-11-09 (docs/top-picks.md, "Crowd signals"):
// 40+ shadow days and 30+ decided trades, 10-day rank IC of 0.03 or more with
// the same sign in both halves of the non-overlapping sample, and a partial
// IC after the grade of the same sign at 0.02 or more. A key that clears it
// is a candidate for promotion, decided by the owners; nothing here promotes.
//
// The market-wide gauges (shadow block `mkt`) get one time-series read each:
// the rank correlation between the gauge on a day and SPY's forward 10-session
// return over non-overlapping days. Reported with its count; no pass bar,
// because 130 days of daily rows cannot judge a slow positioning gauge.
//
// Pure, no network, no AI, no writes. Owner-only output (grade-research.json
// and evidence-board.json).

import { spearman, forwardReturn, indexOnOrBefore, nonOverlappingDates, prepareSeries, RESEARCH_MIN_NAMES } from "./grade-research.mjs";
import { SHADOW_LABELS, SHADOW_MARKET_LABELS, SHADOW_CROWD_KEYS } from "./shadow-signals.mjs";

export const SHADOW_RESEARCH_VERSION = 1;
export const SHADOW_HORIZONS = Object.freeze([5, 10]);
export const SHADOW_PASS = Object.freeze({ days: 40, trades: 30, ic: 0.03, partial: 0.02, horizon: 10 });

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function tStat(xs) {
  if (xs.length < 3) return null;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return v > 0 ? m / Math.sqrt(v / xs.length) : null;
}
const sign = (v) => (v == null ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0);

// Partial Spearman of x with y, holding z fixed: the rank correlations of the
// three pairs, combined the usual way. null when either control correlation
// is (nearly) perfect.
export function partialSpearman(rows) {
  const rxy = spearman(rows.map((r) => [r.x, r.y]));
  const rxz = spearman(rows.map((r) => [r.x, r.z]));
  const ryz = spearman(rows.map((r) => [r.y, r.z]));
  if (rxy == null || rxz == null || ryz == null) return null;
  const den = (1 - rxz * rxz) * (1 - ryz * ryz);
  if (!(den > 1e-9)) return null;
  return (rxy - rxz * ryz) / Math.sqrt(den);
}

function prepared(series) {
  const out = {};
  for (const [symbol, raw] of Object.entries(series || {})) {
    const next = raw?.dates && raw?.closes && raw?.index ? raw : prepareSeries(raw);
    if (next?.dates?.length >= 2) out[symbol] = next;
  }
  return out;
}

// Rows with a shadow block, oldest first, one per date.
export function shadowDays(days) {
  const seen = new Set();
  return [...(days || [])]
    .filter((d) => d?.date && d.shadow && Array.isArray(d.shadow.keys) && d.shadow.rows && typeof d.shadow.rows === "object")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)))
    .map((d) => ({ date: String(d.date).slice(0, 10), totals: d.totals || {}, shadow: d.shadow }));
}

function dayStat(day, key, series, horizon) {
  const ki = day.shadow.keys.indexOf(key);
  if (ki < 0) return null;
  const rows = [];
  for (const [sym, vals] of Object.entries(day.shadow.rows)) {
    const x = Array.isArray(vals) ? num(vals[ki]) : null;
    const g = num(day.totals?.[sym]);
    const stock = series[sym];
    if (x == null || !stock) continue;
    const fwd = forwardReturn(stock, day.date, horizon, 0);
    if (!fwd) continue;
    rows.push({ x, y: fwd.ret, z: g });
  }
  if (rows.length < RESEARCH_MIN_NAMES) return null;
  const distinct = new Set(rows.map((r) => r.x)).size;
  if (distinct < 3) return null; // a constant (or near-constant) key has no rank
  const ic = spearman(rows.map((r) => [r.x, r.y]));
  const withGrade = rows.filter((r) => r.z != null);
  const partial = withGrade.length >= RESEARCH_MIN_NAMES ? partialSpearman(withGrade) : null;
  return ic == null ? null : { date: day.date, n: rows.length, ic, partial };
}

// One key at one horizon. Every shadow day gives one cross-sectional IC; the
// mean over all days is the read (overlapping windows do not bias a mean of
// cross-sectional correlations), the halves split those days in date order,
// and the t-statistic comes from the non-overlapping days only, since the
// overlapping ICs share sessions and would overstate it.
function summarize(stats, nonOverlapSet) {
  const all = stats.slice();
  const ics = all.map((s) => s.ic);
  const partials = all.map((s) => s.partial).filter((v) => v != null);
  const half = Math.floor(all.length / 2);
  const h1 = all.slice(0, half).map((s) => s.ic), h2 = all.slice(half).map((s) => s.ic);
  const no = all.filter((s) => nonOverlapSet.has(s.date));
  const noIcs = no.map((s) => s.ic);
  return {
    days: all.length,
    ic: r4(mean(ics)),
    t: r3(tStat(noIcs)),
    positiveShare: ics.length ? r3(ics.filter((v) => v > 0).length / ics.length) : null,
    half1: h1.length ? r4(mean(h1)) : null,
    half2: h2.length ? r4(mean(h2)) : null,
    partial: partials.length ? r4(mean(partials)) : null,
    names: all.length ? Math.round(mean(all.map((s) => s.n))) : 0,
    nonOverlap: { days: no.length, ic: r4(mean(noIcs)) },
  };
}

// Decided Top Picks trades whose entry snapshot froze the key: the value
// signed to the trade side against the option P&L (%), as a rank correlation.
export function tradeRead(closed, key) {
  const pairs = [];
  for (const t of Array.isArray(closed) ? closed : []) {
    if (!t || t.outcome === "void" || t.counted === false) continue;
    if (t.outcome !== "win" && t.outcome !== "loss") continue;
    const v = num(t.entrySnapshot?.shadow?.[key]);
    const pnl = num(t.optionPnlPct);
    if (v == null || pnl == null || (t.side !== "call" && t.side !== "put")) continue;
    pairs.push([t.side === "put" ? -v : v, pnl]);
  }
  const ic = pairs.length >= 3 ? spearman(pairs) : null;
  return { n: pairs.length, ic: r4(ic) };
}

export function keyStatus(read, trades, pass = SHADOW_PASS) {
  const h = read?.[String(pass.horizon)] || null;
  if (!h || h.days < pass.days || !trades || trades.n < pass.trades) return "collecting";
  if (h.ic == null) return "inconclusive";
  const s = sign(h.ic);
  const stable = sign(h.half1) === s && sign(h.half2) === s;
  const partialOk = h.partial != null && sign(h.partial) === s && Math.abs(h.partial) >= pass.partial;
  if (Math.abs(h.ic) >= pass.ic && stable && partialOk) return "pass";
  if (Math.abs(h.ic) < pass.ic || !stable) return "fail";
  return "inconclusive";
}

export function buildShadowResearch({ days = [], series = {}, closed = [], spy = "SPY", horizons = SHADOW_HORIZONS, pass = SHADOW_PASS } = {}) {
  const ser = prepared(series);
  const spySeries = ser[spy] || null;
  const rows = shadowDays(days);
  const keys = [...new Set(rows.flatMap((d) => d.shadow.keys))];
  const out = [];
  for (const key of keys) {
    const read = {};
    for (const h of horizons) {
      const stats = rows.map((d) => dayStat(d, key, ser, h)).filter(Boolean);
      const dates = stats.map((s) => s.date);
      const nonOverlap = new Set(nonOverlappingDates(dates, spySeries, h));
      read[String(h)] = summarize(stats, nonOverlap);
    }
    const trades = tradeRead(closed, key);
    const daysWith = rows.filter((d) => {
      const ki = d.shadow.keys.indexOf(key);
      return ki >= 0 && Object.values(d.shadow.rows).some((v) => Array.isArray(v) && v[ki] != null);
    }).length;
    out.push({
      key, label: SHADOW_LABELS[key] || key, crowd: SHADOW_CROWD_KEYS.includes(key),
      daysLogged: daysWith, read, trades, status: keyStatus(read, trades, pass),
    });
  }
  // Market gauges vs SPY's forward 10-session return, non-overlapping days.
  const gauges = [];
  const gaugeKeys = [...new Set(rows.flatMap((d) => Object.keys(d.shadow.mkt || {})))];
  if (spySeries) {
    const dates = rows.filter((d) => d.shadow.mkt).map((d) => d.date);
    const nonOverlap = new Set(nonOverlappingDates(dates, spySeries, pass.horizon));
    for (const g of gaugeKeys) {
      const pairs = [];
      for (const d of rows) {
        if (!nonOverlap.has(d.date)) continue;
        const v = num(d.shadow.mkt?.[g]);
        const fwd = forwardReturn(spySeries, d.date, pass.horizon, 0);
        if (v == null || !fwd) continue;
        pairs.push([v, fwd.ret]);
      }
      const latest = [...rows].reverse().find((d) => num(d.shadow.mkt?.[g]) != null);
      gauges.push({ key: g, label: SHADOW_MARKET_LABELS[g] || g, n: pairs.length, rho: pairs.length >= 8 ? r4(spearman(pairs)) : null, latest: latest ? num(latest.shadow.mkt[g]) : null, latestDate: latest?.date || null });
    }
  }
  const decidedTrades = (Array.isArray(closed) ? closed : []).filter((t) => t && (t.outcome === "win" || t.outcome === "loss") && t.counted !== false && t.entrySnapshot?.shadow).length;
  return {
    v: SHADOW_RESEARCH_VERSION,
    days: rows.length,
    first: rows[0]?.date || null,
    last: rows[rows.length - 1]?.date || null,
    decidedTrades,
    pass: { ...pass },
    horizons: [...horizons],
    keys: out,
    gauges,
    counts: {
      pass: out.filter((k) => k.status === "pass").length,
      fail: out.filter((k) => k.status === "fail").length,
      inconclusive: out.filter((k) => k.status === "inconclusive").length,
      collecting: out.filter((k) => k.status === "collecting").length,
    },
    note: "Rank correlations of each logged candidate with forward returns on the whole universe, alone and with the grade held fixed, plus the same key on decided trades. Measurement only: nothing here scores, gates or promotes.",
  };
}

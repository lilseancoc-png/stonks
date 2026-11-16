// Volatility forecasts against option prices (Owner-only, no AI, no fetch).
//
// Four forecasts of a stock's swings over the next 21 sessions, from its own
// daily closes:
//   trailing  the last 21 sessions' swings carried forward (the baseline)
//   ewma      an exponentially weighted average of squared moves (0.94 decay)
//   garch     GARCH(1,1), fitted per stock, which pulls back toward the
//             stock's long-run level
//   har       a regression of the next month's swings on the last week's,
//             month's and quarter's (fitted across all stocks at once)
// The forecast that scored best in the history test is set beside the option
// price: implied volatility minus forecast volatility is the premium an
// option buyer pays over what the stock is expected to do. The lab then
// checks, on dates whose 21 sessions have since passed, whether each forecast
// beat the baseline and whether a high premium really was followed by options
// that cost more than the move delivered.

import { finite, round, mean, sd, median, spearman, percentileOf, ols, tStat } from "./stats.mjs";

export const VOL_VERSION = 1;
export const VOL_H = 21;
export const VOL_MODELS = ["trailing", "ewma", "garch", "har"];
const ANN = 252;
const toVol = (variance) => (variance > 0 ? Math.sqrt(variance * ANN) * 100 : null);   // percent a year

export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] > 0 && closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0);
  return out;
}
// Mean squared return over rets[from..to) (daily variance).
function msr(sq, from, to) {
  if (from < 0 || to > sq.length - 1 + 1 || to <= from) return null;
  return (sq[to] - sq[from]) / (to - from);
}
const cumSq = (rets) => { const c = [0]; for (let i = 0; i < rets.length; i++) c.push(c[i] + rets[i] * rets[i]); return c; };

export function ewmaVariance(rets, upTo, lambda = 0.94) {
  const start = Math.max(0, upTo - 250);
  if (upTo - start < 30) return null;
  let v = 0, k = 0;
  for (let i = start; i < Math.min(start + 20, upTo); i++) { v += rets[i] * rets[i]; k++; }
  v /= k || 1;
  for (let i = start + k; i < upTo; i++) v = lambda * v + (1 - lambda) * rets[i] * rets[i];
  return v;
}

// GARCH(1,1) with the long-run variance pinned to the sample's (variance
// targeting), fitted by a grid over the two remaining numbers.
const GARCH_A = [0.03, 0.05, 0.08, 0.11, 0.15, 0.2];
const GARCH_B = [0.7, 0.78, 0.84, 0.88, 0.91, 0.94, 0.96];
export function fitGarch(rets, from, to) {
  const n = to - from;
  if (n < 120) return null;
  let lr = 0;
  for (let i = from; i < to; i++) lr += rets[i] * rets[i];
  lr /= n;
  if (!(lr > 0)) return null;
  let best = null;
  for (const a of GARCH_A) for (const b of GARCH_B) {
    if (a + b >= 0.995) continue;
    const omega = lr * (1 - a - b);
    let v = lr, ll = 0;
    for (let i = from; i < to; i++) {
      const r2 = rets[i] * rets[i];
      ll -= Math.log(v) + r2 / v;
      v = omega + a * r2 + b * v;
    }
    if (!best || ll > best.ll) best = { a, b, lr, ll };
  }
  return best;
}
// Average daily variance over the next h sessions from a fitted model.
export function garchVariance(fit, rets, upTo, h = VOL_H) {
  if (!fit) return null;
  const start = Math.max(0, upTo - 250), omega = fit.lr * (1 - fit.a - fit.b);
  let v = fit.lr;
  for (let i = start; i < upTo; i++) v = omega + fit.a * rets[i] * rets[i] + fit.b * v;
  const p = fit.a + fit.b;
  let sum = 0, cur = v;
  for (let k = 0; k < h; k++) { sum += cur; cur = fit.lr + p * (cur - fit.lr); }
  return sum / h;
}

// HAR inputs at index `upTo` (the first return not yet seen): log variance
// over the last 5, 22 and 66 sessions and the stock's own last-year level.
function harRow(sq, upTo) {
  const w = msr(sq, upTo - 5, upTo), m = msr(sq, upTo - 22, upTo), q = msr(sq, upTo - 66, upTo), y = msr(sq, Math.max(0, upTo - 252), upTo);
  if (!(w > 0) || !(m > 0) || !(q > 0) || !(y > 0) || upTo < 120) return null;
  return [Math.log(w), Math.log(m), Math.log(q), Math.log(y)];
}
export function fitHar(series, { step = 5, until = null } = {}) {
  const X = [], y = [];
  for (const s of series) {
    const end = Math.min(s.rets.length - VOL_H, until == null ? Infinity : until(s));
    for (let i = 120; i <= end; i += step) {
      const row = harRow(s.sq, i), fut = msr(s.sq, i, i + VOL_H);
      if (row && fut > 0) { X.push(row); y.push(Math.log(fut)); }
    }
  }
  if (X.length < 200) return null;
  const fit = ols(X, y);
  if (!fit) return null;
  const s2 = mean(fit.resid.map((e) => e * e));
  return { b: [fit.alpha, ...fit.beta].map((v) => round(v, 4)), s2: round(s2, 4), n: X.length, r2: round(fit.r2, 3) };
}
export function harVariance(har, sq, upTo) {
  const row = har ? harRow(sq, upTo) : null;
  if (!row) return null;
  let z = har.b[0];
  for (let j = 0; j < 4; j++) z += har.b[j + 1] * row[j];
  // The median forecast (no half-variance bump): QLIKE punishes forecasts
  // that run high less than ones that run low, but the bump overshoots on
  // fat-tailed residuals.
  return Math.exp(z);
}

// Coefficients used until a history run supplies fitted ones: next month's
// variance leans on the last month, with some pull to the last quarter and
// the stock's own year.
export const HAR_FALLBACK = { b: [-0.35, 0.12, 0.33, 0.25, 0.26], s2: 0.45, n: 0, r2: null, fallback: true };

function prep(bars) {
  const closes = [], dates = [];
  for (const b of bars || []) { const c = Number(b?.c); if (b?.t && c > 0) { closes.push(c); dates.push(String(b.t).slice(0, 10)); } }
  const rets = logReturns(closes);
  return { closes, dates, rets, sq: cumSq(rets) };
}

// Every model's forecast (daily variance) at index upTo.
function forecastsAt(s, upTo, { garch, har }) {
  return {
    trailing: msr(s.sq, upTo - VOL_H, upTo),
    ewma: ewmaVariance(s.rets, upTo),
    garch: garchVariance(garch, s.rets, upTo),
    har: harVariance(har, s.sq, upTo),
  };
}
const qlike = (real, f) => (real > 0 && f > 0 ? real / f - Math.log(real / f) - 1 : null);

// Score the four forecasts on dates whose next 21 sessions are known.
// `barsBySymbol`: { SYM: [{ t, c }] }. GARCH is refitted every `refit`
// sessions on the sessions before each forecast; HAR is fitted on the first
// half of each stock's history (or passed in) and scored on the rest.
export function evaluateVolModels(barsBySymbol, { step = 5, refit = 63, har = null, minBars = 200, warm = 130 } = {}) {
  const series = Object.entries(barsBySymbol || {}).map(([sym, bars]) => ({ sym, ...prep(bars) })).filter((s) => s.rets.length >= minBars);
  if (!series.length) return null;
  const harFit = har || fitHar(series, { step, until: (s) => Math.floor(s.rets.length / 2) }) || HAR_FALLBACK;
  const rows = [];   // { d, sym, real, f: {model: variance} }
  for (const s of series) {
    const startAt = har ? warm : Math.max(warm, Math.floor(s.rets.length / 2));
    let g = null, fitAt = -Infinity;
    for (let i = startAt; i + VOL_H <= s.rets.length; i += step) {
      if (i - fitAt >= refit) { g = fitGarch(s.rets, Math.max(0, i - 756), i); fitAt = i; }
      const real = msr(s.sq, i, i + VOL_H);
      if (!(real > 0)) continue;
      rows.push({ d: s.dates[i], sym: s.sym, real, f: forecastsAt(s, i, { garch: g, har: harFit }) });
    }
  }
  const models = VOL_MODELS.map((m) => {
    const ok = rows.filter((r) => r.f[m] > 0 && r.f.trailing > 0);
    if (ok.length < 30) return { model: m, n: ok.length };
    const q = ok.map((r) => qlike(r.real, r.f[m])), qb = ok.map((r) => qlike(r.real, r.f.trailing));
    const err = ok.map((r) => toVol(r.f[m]) - toVol(r.real)), errB = ok.map((r) => toVol(r.f.trailing) - toVol(r.real));
    // Per-date average loss gap vs the baseline; dates are the independent unit.
    const byDate = new Map();
    ok.forEach((r, k) => { if (!byDate.has(r.d)) byDate.set(r.d, []); byDate.get(r.d).push(qb[k] - q[k]); });
    const gaps = [...byDate.values()].map(mean);
    return {
      model: m, n: ok.length, dates: gaps.length,
      qlike: round(mean(q), 4), rmse: round(Math.sqrt(mean(err.map((e) => e * e))), 2), bias: round(mean(err), 2),
      vsBase: round((1 - mean(q) / mean(qb)) * 100, 1),                               // percent lower loss than the baseline
      rmseVsBase: round((1 - Math.sqrt(mean(err.map((e) => e * e))) / Math.sqrt(mean(errB.map((e) => e * e)))) * 100, 1),
      t: m === "trailing" ? null : round(tStat(gaps) / Math.sqrt(Math.max(1, VOL_H / step)), 2),   // overlap-adjusted
    };
  });
  const scored = models.filter((m) => finite(m.qlike));
  const best = scored.length ? scored.slice().sort((a, b) => a.qlike - b.qlike)[0].model : "trailing";
  return { har: harFit, models, best, rows: rows.length, symbols: series.length, from: rows.length ? rows.map((r) => r.d).sort()[0] : null };
}

// The bake's read: today's forecasts and premium for each stock, the forecast
// test on its own bars, and whether the premium predicted what options paid.
// `ivOf(sym)` returns [{ date, iv }] with iv as a fraction; `barsOf(sym)` the
// confirmed daily bars; `closed` the Top Picks record's closed trades.
export function buildVolLab({ symbols, barsOf, ivOf, closed = [], research = null, step = 5 } = {}) {
  const har = research?.har?.b ? research.har : null;
  const bars = {};
  for (const sym of symbols || []) { const b = barsOf(sym); if (b && b.length >= 150) bars[sym] = b; }
  const evalNow = evaluateVolModels(bars, { step, har: har || undefined, minBars: 150, warm: 125 });
  if (!evalNow) return { v: VOL_VERSION, status: "no-data", note: "Not enough price history yet." };
  const useHar = har || evalNow.har;
  // The model to set against option prices: the history test's winner when a
  // research run exists, else the baseline's best challenger on these bars.
  const model = research?.best || evalNow.best;
  const names = [], premiumRows = [];
  for (const [sym, b] of Object.entries(bars)) {
    const s = prep(b), n = s.rets.length;
    const g = fitGarch(s.rets, Math.max(0, n - 756), n);
    const f = forecastsAt(s, n, { garch: g, har: useHar });
    const ivRows = (ivOf(sym) || []).filter((e) => e?.date && finite(e.iv) && e.iv > 0);
    const ivByDate = new Map(ivRows.map((e) => [String(e.date).slice(0, 10), e.iv * 100]));
    const ivNow = ivRows.length ? ivRows[ivRows.length - 1].iv * 100 : null;
    const fc = toVol(f[model]) ?? toVol(f.trailing);
    names.push({
      s: sym, iv: round(ivNow, 1), trailing: round(toVol(f.trailing), 1), ewma: round(toVol(f.ewma), 1), garch: round(toVol(f.garch), 1), har: round(toVol(f.har), 1),
      forecast: round(fc, 1), premium: finite(ivNow) && finite(fc) ? round(ivNow - fc, 1) : null,
    });
    // Past dates: the premium then, and what the next 21 sessions delivered.
    let gPast = null, fitAt = -Infinity;
    for (let i = 125; i + VOL_H <= n; i += step) {
      const iv = ivByDate.get(s.dates[i]);
      if (!finite(iv)) continue;
      if (i - fitAt >= 63) { gPast = fitGarch(s.rets, Math.max(0, i - 756), i); fitAt = i; }
      const fp = toVol(forecastsAt(s, i, { garch: gPast, har: useHar })[model]), real = toVol(msr(s.sq, i, i + VOL_H));
      if (finite(fp) && finite(real)) premiumRows.push({ d: s.dates[i], sym, premium: iv - fp, paid: iv - real, ivVsTrail: iv - toVol(msr(s.sq, i - VOL_H, i)) });
    }
  }
  const prem = names.map((r) => r.premium).filter(finite);
  for (const r of names) {
    r.rank = finite(r.premium) && prem.length >= 10 ? round(percentileOf(prem, r.premium) * 100, 0) : null;
    r.read = !finite(r.premium) ? null : r.premium >= 8 ? "rich" : r.premium <= -3 ? "cheap" : "fair";
  }
  names.sort((a, b) => (b.premium ?? -1e9) - (a.premium ?? -1e9));
  // Did a higher premium mean options cost more than the move delivered?
  // Both sides of that question contain the option price, so some rank link
  // is built in. The test that counts is the paired one: does the forecast
  // premium rank the overpaid options better than the plain gap (IV minus the
  // last 21 sessions' volatility) on the same dates?
  const byDate = new Map();
  for (const r of premiumRows) { if (!byDate.has(r.d)) byDate.set(r.d, []); byDate.get(r.d).push(r); }
  const ics = [], icsBase = [], gains = [];
  for (const rows of byDate.values()) {
    if (rows.length < 12) continue;
    const ic = spearman(rows.map((r) => r.premium), rows.map((r) => r.paid));
    const icb = spearman(rows.map((r) => r.ivVsTrail), rows.map((r) => r.paid));
    if (!finite(ic) || !finite(icb)) continue;
    ics.push(ic); icsBase.push(icb); gains.push(ic - icb);
  }
  const adj = Math.sqrt(Math.max(1, VOL_H / step));
  const gainT = gains.length >= 8 ? tStat(gains) / adj : null;
  const premiumTest = ics.length >= 8 ? {
    dates: ics.length, rows: premiumRows.length, ic: round(mean(ics), 3),
    baseIc: round(mean(icsBase), 3), gain: round(mean(gains), 3), t: round(gainT, 2),
    avgPaid: round(mean(premiumRows.map((r) => r.paid)), 1),
    verdict: gainT >= 2 ? "better" : gainT <= -2 ? "worse" : "same",
    read: gainT >= 2 ? "The forecast premium ranked the overpriced options better than the plain gap between option prices and recent volatility."
      : gainT <= -2 ? "The plain gap between option prices and recent volatility ranked the overpriced options better than the forecast premium."
        : "The forecast premium ranked the overpriced options about as well as the plain gap between option prices and recent volatility; no proven gain yet.",
  } : { dates: ics.length, rows: premiumRows.length, verdict: "collecting", read: "Collecting: the test needs 8 dates with option prices and 21 sessions after each." };
  // Top Picks single options by the premium on the day they opened.
  const premAt = new Map(premiumRows.map((r) => [`${r.sym}|${r.d}`, r.premium]));
  const nearest = (sym, day) => {
    for (let k = 0; k < 6; k++) { const d = new Date(Date.parse(`${day}T00:00:00Z`) - k * 86400000).toISOString().slice(0, 10); const v = premAt.get(`${sym}|${d}`); if (finite(v)) return v; }
    return null;
  };
  const bands = [["cheap", "Cheap (premium under 0)", (p) => p < 0], ["fair", "Fair (0 to 8)", (p) => p >= 0 && p < 8], ["rich", "Rich (8 or more)", (p) => p >= 8]];
  const trades = [];
  for (const c of closed || []) {
    if (!c || (c.outcome !== "win" && c.outcome !== "loss") || c.counted === false) continue;
    if ((c.contract?.structure || "long") !== "long" || !finite(Number(c.optionPnlPct))) continue;
    const p = nearest(c.symbol, String(c.entryDate || "").slice(0, 10));
    if (finite(p)) trades.push({ p, pnl: Number(c.optionPnlPct), win: c.outcome === "win" });
  }
  const byPremium = bands.map(([id, label, test]) => {
    const rows = trades.filter((t) => test(t.p));
    return { id, label, n: rows.length, win: rows.length ? round(mean(rows.map((t) => (t.win ? 1 : 0))), 3) : null, avg: rows.length ? round(mean(rows.map((t) => t.pnl)), 1) : null };
  });
  return {
    v: VOL_VERSION, status: "ok", model, horizon: VOL_H,
    asOf: Object.values(bars)[0]?.slice(-1)[0]?.t?.slice?.(0, 10) || null,
    names,
    summary: {
      names: names.length, withIv: prem.length, medianPremium: prem.length ? round(median(prem), 1) : null,
      rich: names.filter((r) => r.read === "rich").length, cheap: names.filter((r) => r.read === "cheap").length,
    },
    test: { live: { models: evalNow.models, best: evalNow.best, rows: evalNow.rows, from: evalNow.from }, history: research ? { models: research.models, best: research.best, rows: research.rows, symbols: research.symbols, from: research.from } : null },
    premiumTest, byPremium, tradesMatched: trades.length,
    har: { b: useHar.b, fitted: har ? "history run" : useHar.fallback ? "default" : "these bars", n: useHar.n || null },
  };
}

export const _test = { prep, msr, cumSq, harRow, qlike, sd };

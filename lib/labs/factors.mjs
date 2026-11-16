// Factor Lab (Owner-only, no AI, no fetch): what the grade and the books are
// really betting on, and which plain factors predict returns in our names.
//
// Three reads:
//   1. Exposures. The daily return of a book (the grade's long-short book, the
//      Top Picks direction book, each engine's) regressed on factor returns:
//      the market, small vs large, growth vs the market, and in-universe
//      momentum and low-volatility portfolios. What is left over is the part
//      that is not just a factor an index fund sells for free.
//   2. The factor panel. Each covered stock's percentile on price factors
//      (momentum, reversal, low volatility, low beta, near the high, trend)
//      and on fundamentals read at the bake (value, margins, growth, debt).
//      A weekly snapshot is kept so each factor's rank skill at 1, 5, 21 and
//      63 sessions can be measured forward on our own names.
//   3. Grade vs factors. How much of today's grade ranking the factors
//      explain, and each stock's grade with that part taken out.
// Per-stock values are Owner-only; the research runner commits aggregates.

import { finite, round, mean, sd, median, spearman, ranks, ols, tStat, maxDrawdown, trialsAdjustedT } from "./stats.mjs";

export const FACTORS_VERSION = 1;
export const FACTOR_HORIZONS = [1, 5, 21, 63];

// Price factors: value at bar index i from closes (higher = more of it).
export const PRICE_FACTORS = [
  { key: "mom12", short: "12m mom", label: "12-month momentum", hint: "Return over the last year, skipping the last month", need: 253 },
  { key: "mom6", short: "6m mom", label: "6-month momentum", hint: "Return over the last 6 months, skipping the last month", need: 148 },
  { key: "rev1", short: "1m reversal", label: "1-month reversal", hint: "Last month's losers (they tend to bounce)", need: 22 },
  { key: "lowvol", short: "Low vol", label: "Low volatility", hint: "Calmer stocks over the last 3 months", need: 64 },
  { key: "lowbeta", short: "Low beta", label: "Low beta", hint: "Stocks that move less with the S&P 500", need: 127 },
  { key: "high52", short: "52w high", label: "Near the 52-week high", hint: "Close as a share of the 1-year high", need: 253 },
  { key: "trend", short: "200d trend", label: "Above the 200-day average", hint: "Close against the 200-day average", need: 201 },
];
export const FUND_FACTORS = [
  { key: "value", short: "Earn yield", label: "Value (earnings yield)", hint: "Earnings per dollar of price, forward when known" },
  { key: "sales", short: "Sales yield", label: "Value (sales yield)", hint: "Sales per dollar of price" },
  { key: "margin", short: "Margin", label: "Profit margin", hint: "Net profit as a share of sales" },
  { key: "roe", short: "ROE", label: "Return on equity", hint: "Profit as a share of shareholder equity" },
  { key: "growth", short: "Growth", label: "Sales growth", hint: "Revenue growth over a year" },
  { key: "lowdebt", short: "Low debt", label: "Low debt", hint: "Less debt against equity" },
];
export const ALL_FACTORS = [...PRICE_FACTORS, ...FUND_FACTORS];
const labelOf = (key) => ALL_FACTORS.find((f) => f.key === key)?.label || key;

export function priceFactor(key, c, i, mkt = null) {
  const need = PRICE_FACTORS.find((f) => f.key === key)?.need || 0;
  if (i < need - 1 || !(c[i] > 0)) return null;
  const ret = (a, b) => (c[a] > 0 && c[b] > 0 ? c[b] / c[a] - 1 : null);
  if (key === "mom12") return ret(i - 252, i - 21);
  if (key === "mom6") return ret(i - 147, i - 21);
  if (key === "rev1") { const r = ret(i - 21, i); return r == null ? null : -r; }
  if (key === "lowvol" || key === "lowbeta") {
    const w = key === "lowvol" ? 63 : 126;
    const xs = [], ms = [];
    for (let j = i - w + 1; j <= i; j++) {
      if (!(c[j] > 0) || !(c[j - 1] > 0)) return null;
      xs.push(Math.log(c[j] / c[j - 1]));
      if (key === "lowbeta") { if (!mkt || !(mkt[j] > 0) || !(mkt[j - 1] > 0)) return null; ms.push(Math.log(mkt[j] / mkt[j - 1])); }
    }
    if (key === "lowvol") return -sd(xs);
    const mx = mean(xs), mm = mean(ms);
    let cov = 0, vm = 0;
    for (let j = 0; j < xs.length; j++) { cov += (xs[j] - mx) * (ms[j] - mm); vm += (ms[j] - mm) ** 2; }
    return vm > 0 ? -(cov / vm) : null;
  }
  if (key === "high52") { let h = 0; for (let j = i - 251; j <= i; j++) if (c[j] > h) h = c[j]; return h > 0 ? c[i] / h : null; }
  if (key === "trend") { let s = 0; for (let j = i - 199; j <= i; j++) s += c[j]; return c[i] / (s / 200) - 1; }
  return null;
}
const pnum = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export function fundFactor(key, f) {
  if (!f) return null;
  const fpe = pnum(f.forwardPE), pe = pnum(f.trailingPE), ps = pnum(f.priceToSales), de = pnum(f.debtToEquity);
  if (key === "value") return fpe > 0 ? 1 / fpe : pe > 0 ? 1 / pe : null;
  if (key === "sales") return ps > 0 ? 1 / ps : null;
  if (key === "margin") return pnum(f.profitMargin);
  if (key === "roe") return pnum(f.returnOnEquity);
  if (key === "growth") return pnum(f.revenueGrowthYoy);
  if (key === "lowdebt") return de != null && de >= 0 ? -de : null;
  return null;
}

// Percentile (0-99) of each value among the finite ones; null stays null.
export function percentiles(values) {
  const idx = values.map((v, i) => (finite(v) ? i : -1)).filter((i) => i >= 0);
  const out = values.map(() => null);
  if (idx.length < 5) return out;
  const r = ranks(idx.map((i) => values[i]));
  idx.forEach((i, k) => { out[i] = Math.min(99, Math.round(((r[k] - 0.5) / idx.length) * 100)); });
  return out;
}

// --- history test (research runner, and the bake on its own year of bars) ------------------

// barsBySymbol: { SYM: [{ t, c }] }; `market` the S&P 500 (or SPY) bars that
// set the calendar. For each rebalance date (every `step` sessions) rank the
// stocks on each factor, then read the next 1/5/21/63-session returns.
export function evaluateFactors(barsBySymbol, market, { factors = PRICE_FACTORS.map((f) => f.key), horizons = FACTOR_HORIZONS, step = 21, costBps = 10, minNames = 20, from = null } = {}) {
  const cal = (market || []).map((b) => String(b.t).slice(0, 10));
  const mktClose = (market || []).map((b) => Number(b.c));
  const pos = new Map(cal.map((d, i) => [d, i]));
  // Align every stock to the calendar (a missing session carries no value).
  const aligned = {};
  for (const [sym, bars] of Object.entries(barsBySymbol || {})) {
    const c = new Array(cal.length).fill(null);
    for (const b of bars || []) { const i = pos.get(String(b.t).slice(0, 10)); if (i != null && Number(b.c) > 0) c[i] = Number(b.c); }
    // Carry the last close across short gaps so windows stay usable.
    for (let i = 1, gap = 0; i < c.length; i++) { if (c[i] == null && c[i - 1] != null && gap < 3) { c[i] = c[i - 1]; gap++; } else if (c[i] != null) gap = 0; }
    aligned[sym] = c;
  }
  const syms = Object.keys(aligned);
  const startIdx = from ? Math.max(260, cal.findIndex((d) => d >= from)) : 260;
  const out = [];
  for (const key of factors) {
    const ic = Object.fromEntries(horizons.map((h) => [h, []]));
    const spread = [];            // top minus bottom third, next `step` sessions, percent
    const dates = [];
    let prevTop = null, prevBot = null, turn = [];
    for (let i = startIdx; i + 1 < cal.length; i += step) {
      const vals = syms.map((s) => (aligned[s][i] != null ? priceFactor(key, aligned[s], i, mktClose) : null));
      const have = vals.map((v, k) => (finite(v) ? k : -1)).filter((k) => k >= 0);
      if (have.length < minNames) continue;
      for (const h of horizons) {
        if (i + h >= cal.length) continue;
        const xs = [], ys = [];
        for (const k of have) { const a = aligned[syms[k]][i], b = aligned[syms[k]][i + h]; if (a > 0 && b > 0) { xs.push(vals[k]); ys.push(b / a - 1); } }
        if (xs.length >= minNames) { const r = spearman(xs, ys); if (finite(r)) ic[h].push(r); }
      }
      if (i + step < cal.length) {
        const order = have.slice().sort((a, b) => vals[a] - vals[b]);
        const third = Math.floor(order.length / 3);
        const bot = order.slice(0, third), top = order.slice(-third);
        const fwd = (list) => mean(list.map((k) => { const a = aligned[syms[k]][i], b = aligned[syms[k]][i + step]; return a > 0 && b > 0 ? b / a - 1 : null; }).filter(finite));
        const t = fwd(top), b = fwd(bot);
        if (finite(t) && finite(b)) {
          spread.push((t - b) * 100); dates.push(cal[i]);
          if (prevTop) {
            const kept = top.filter((k) => prevTop.has(k)).length + bot.filter((k) => prevBot.has(k)).length;
            turn.push(1 - kept / (top.length + bot.length));
          }
          prevTop = new Set(top); prevBot = new Set(bot);
        }
      }
    }
    const perYear = 252 / step;
    const half = Math.floor(spread.length / 2);
    const turnover = turn.length ? mean(turn) : null;
    // Each rebalance trades `turnover` of both legs, in and out.
    const costPerPeriod = turnover != null ? turnover * 2 * 2 * (costBps / 100) : 0;
    const icRow = (h) => {
      const xs = ic[h], overlap = Math.sqrt(Math.max(1, h / step));
      const hh = Math.floor(xs.length / 2);
      return { h, n: xs.length, ic: xs.length ? round(mean(xs), 3) : null, t: xs.length > 5 ? round(tStat(xs) / overlap, 2) : null, first: hh > 3 ? round(mean(xs.slice(0, hh)), 3) : null, second: hh > 3 ? round(mean(xs.slice(hh)), 3) : null };
    };
    const rows = horizons.map(icRow);
    const main = rows.find((r) => r.h === 21) || rows[rows.length - 1];
    const gross = spread.length ? mean(spread) * perYear : null;
    out.push({
      key, label: labelOf(key), dates: spread.length, from: dates[0] || null, to: dates[dates.length - 1] || null,
      ic: rows,
      spread: spread.length ? {
        perYear: round(gross, 1), net: round(gross - costPerPeriod * perYear, 1), t: round(tStat(spread), 2),
        first: half > 3 ? round(mean(spread.slice(0, half)) * perYear, 1) : null, second: half > 3 ? round(mean(spread.slice(half)) * perYear, 1) : null,
        worst: round(maxDrawdown(spread.map((x) => x / 100)) * 100, 1), turnover: round(turnover, 2),
      } : null,
      bothHalves: main && finite(main.first) && finite(main.second) ? Math.sign(main.first) === Math.sign(main.second) && main.first !== 0 : null,
      _spread: spread, _dates: dates,
    });
  }
  const trials = factors.length * horizons.length, tBar = trialsAdjustedT(trials);
  for (const f of out) {
    const main = f.ic.find((r) => r.h === 21);
    f.verdict = !main || main.n < 12 ? "few"
      : Math.abs(main.t ?? 0) >= tBar && f.bothHalves && (f.spread?.net ?? 0) * Math.sign(main.ic) > 0 ? "holds"
      : Math.abs(main.t ?? 0) >= 2 ? "lucky" : "none";
  }
  return { factors: out, trials, tBar: round(tBar, 2), names: syms.length, calendar: { from: cal[startIdx] || null, to: cal[cal.length - 1] || null } };
}
export const publicFactorRows = (ev) => (ev?.factors || []).map(({ _spread, _dates, ...rest }) => rest);

// --- exposures -----------------------------------------------------------------------------------

const dailyRet = (bars) => { const m = new Map(); for (let i = 1; i < (bars || []).length; i++) { const a = Number(bars[i - 1].c), b = Number(bars[i].c); if (a > 0 && b > 0) m.set(String(bars[i].t).slice(0, 10), b / a - 1); } return m; };

// Daily factor returns from data the bake already holds. `stocks` is
// { SYM: bars }; SPY / QQQ / IWM bars come from the same chains.
export function bakeFactorReturns({ stocks, spy, qqq, iwm, step = 21 }) {
  const mkt = dailyRet(spy), q = dailyRet(qqq), w = dailyRet(iwm);
  const cal = (spy || []).map((b) => String(b.t).slice(0, 10));
  const out = { market: mkt, size: new Map(), growth: new Map(), momentum: new Map(), lowvol: new Map() };
  for (const d of cal) {
    if (mkt.has(d) && w.has(d)) out.size.set(d, w.get(d) - mkt.get(d));
    if (mkt.has(d) && q.has(d)) out.growth.set(d, q.get(d) - mkt.get(d));
  }
  // In-universe long-short thirds, re-ranked every `step` sessions on values
  // known the day before.
  const pos = new Map(cal.map((d, i) => [d, i]));
  const mktClose = (spy || []).map((b) => Number(b.c));
  const aligned = {}, rets = {};
  for (const [sym, bars] of Object.entries(stocks || {})) {
    const c = new Array(cal.length).fill(null);
    for (const b of bars || []) { const i = pos.get(String(b.t).slice(0, 10)); if (i != null && Number(b.c) > 0) c[i] = Number(b.c); }
    aligned[sym] = c; rets[sym] = dailyRet(bars);
  }
  const syms = Object.keys(aligned);
  for (const [name, key] of [["momentum", "mom6"], ["lowvol", "lowvol"]]) {
    let top = null, bot = null;
    for (let i = 150; i < cal.length; i++) {
      if ((i - 150) % step === 0 || !top) {
        const vals = syms.map((s) => priceFactor(key, aligned[s], i - 1, mktClose));
        const have = vals.map((v, k) => (finite(v) ? k : -1)).filter((k) => k >= 0).sort((a, b) => vals[a] - vals[b]);
        if (have.length >= 15) { const third = Math.floor(have.length / 3); bot = have.slice(0, third).map((k) => syms[k]); top = have.slice(-third).map((k) => syms[k]); }
      }
      if (!top) continue;
      const d = cal[i];
      const avg = (list) => mean(list.map((s) => rets[s].get(d)).filter(finite));
      const t = avg(top), b = avg(bot);
      if (finite(t) && finite(b)) out[name].set(d, t - b);
    }
  }
  return out;
}
export const FACTOR_NAMES = { market: "Market (S&P 500)", size: "Small vs large", growth: "Growth vs market (QQQ minus SPY)", momentum: "Momentum (our names)", lowvol: "Low volatility (our names)" };
// Column headings for the same series (the full name rides as the tooltip).
export const FACTOR_SHORT = { market: "Market", size: "Small caps", growth: "Growth", momentum: "Momentum", lowvol: "Low vol" };

// Regress a book's daily returns ([{ d, r }], fractions) on the factor series.
export function exposures(book, factorReturns, { minDays = 40, lags = 5 } = {}) {
  const keys = Object.keys(factorReturns);
  const X = [], y = [], days = [];
  for (const row of book || []) {
    const xs = keys.map((k) => factorReturns[k].get(row.d));
    if (!finite(row.r) || xs.some((v) => !finite(v))) continue;
    X.push(xs); y.push(row.r); days.push(row.d);
  }
  if (X.length < minDays) return { n: X.length, status: "few" };
  const fit = ols(X, y, { lags });
  if (!fit) return { n: X.length, status: "few" };
  const total = mean(y) * 252 * 100;
  return {
    status: "ok", n: X.length, from: days[0], to: days[days.length - 1], r2: round(fit.r2, 3),
    alpha: round(fit.alpha * 252 * 100, 1), alphaT: round(fit.t[0], 2), total: round(total, 1),
    betas: keys.map((k, j) => ({ key: k, label: FACTOR_NAMES[k] || k, short: FACTOR_SHORT[k] || k, beta: round(fit.beta[j], 2), t: round(fit.t[j + 1], 2) })),
  };
}

// The grade's long-short book: long the top third by yesterday's grade, short
// the bottom third, equal weight, held one session.
export function gradeBook(days, retsOf) {
  const out = [];
  const list = (days || []).filter((d) => d?.date && d.totals).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (let k = 0; k + 1 < list.length; k++) {
    const entries = Object.entries(list[k].totals).filter(([, v]) => finite(Number(v))).sort((a, b) => Number(a[1]) - Number(b[1]));
    if (entries.length < 15) continue;
    const third = Math.floor(entries.length / 3), next = list[k + 1].date;
    const avg = (part) => mean(part.map(([s]) => retsOf(s)?.get(next)).filter(finite));
    const t = avg(entries.slice(-third)), b = avg(entries.slice(0, third));
    if (finite(t) && finite(b)) out.push({ d: next, r: t - b });
  }
  return out;
}
// A direction book: each day, the average of side x stock return over the
// trades open that day (calls +1, puts -1). Options are left out on purpose:
// this asks what the stock picks are, not what the option structure adds.
export function directionBook(trades, retsOf, calendar) {
  const spans = [];
  for (const t of trades || []) {
    const from = String(t?.entryDate || "").slice(0, 10), to = String(t?.exitDate || t?.closedAt || "").slice(0, 10) || "9999-12-31";
    if (!t?.symbol || !/^\d{4}-\d{2}-\d{2}$/.test(from)) continue;
    spans.push({ s: t.symbol, sign: t.side === "put" ? -1 : 1, from, to });
  }
  const out = [];
  for (const d of calendar || []) {
    const rs = [];
    for (const sp of spans) if (d > sp.from && d <= sp.to) { const r = retsOf(sp.s)?.get(d); if (finite(r)) rs.push(sp.sign * r); }
    if (rs.length) out.push({ d, r: mean(rs), n: rs.length });
  }
  return out;
}

// --- the weekly panel and forward rank skill -------------------------------------------------------

export function panelSnapshot(date, syms, valuesOf) {
  const f = {};
  for (const fac of ALL_FACTORS) f[fac.key] = percentiles(syms.map((s) => valuesOf(s, fac.key)));
  return { d: date, syms, f };
}
// Keep one snapshot per ISO week (the newest), `keep` weeks back.
export function foldPanel(panel, snap, keep = 60) {
  const weekOf = (d) => { const t = new Date(`${d}T00:00:00Z`); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); };
  const out = (Array.isArray(panel) ? panel : []).filter((p) => p?.d && weekOf(p.d) !== weekOf(snap.d));
  out.push(snap);
  out.sort((a, b) => a.d.localeCompare(b.d));
  return out.slice(-keep);
}
// Rank skill of each stored factor at each horizon, from snapshots whose
// forward window has closed. closeAt(sym, date, plusSessions) -> close | null.
export function panelSkill(panel, closeAt, { horizons = FACTOR_HORIZONS, extra = null } = {}) {
  const rows = [];
  const keys = [...ALL_FACTORS.map((f) => f.key), ...(extra ? Object.keys(extra) : [])];
  for (const key of keys) {
    const per = horizons.map((h) => {
      const ics = [];
      for (const snap of panel || []) {
        const vals = extra && extra[key] ? snap.syms.map((s) => extra[key](snap.d, s)) : snap.f?.[key];
        if (!vals) continue;
        const xs = [], ys = [];
        snap.syms.forEach((s, k) => {
          const a = closeAt(s, snap.d, 0), b = closeAt(s, snap.d, h);
          if (finite(vals[k]) && a > 0 && b > 0) { xs.push(vals[k]); ys.push(b / a - 1); }
        });
        if (xs.length >= 15) { const r = spearman(xs, ys); if (finite(r)) ics.push(r); }
      }
      const overlap = Math.sqrt(Math.max(1, h / 5));
      return { h, n: ics.length, ic: ics.length ? round(mean(ics), 3) : null, t: ics.length > 5 ? round(tStat(ics) / overlap, 2) : null };
    });
    rows.push({ key, label: extra && extra[key] ? (key === "grade" ? "Top Picks grade" : key) : labelOf(key), ic: per });
  }
  return rows;
}

// --- grade vs factors today -------------------------------------------------------------------------

export function gradeVsFactors(rows, keys = ["lowbeta", "mom6", "lowvol", "trend"]) {
  // rows: [{ s, grade, f: { key: percentile } }]
  const ok = rows.filter((r) => finite(r.grade) && keys.every((k) => finite(r.f?.[k])));
  if (ok.length < 25) return { status: "few", n: ok.length };
  const z = (k) => { const xs = ok.map((r) => r.f[k]); const m = mean(xs), s = sd(xs) || 1; return ok.map((r) => (r.f[k] - m) / s); };
  const cols = keys.map(z);
  const X = ok.map((_, i) => cols.map((c) => c[i]));
  const fit = ols(X, ok.map((r) => r.grade));
  if (!fit) return { status: "few", n: ok.length };
  const net = ok.map((r, i) => ({ s: r.s, grade: round(r.grade, 1), net: round(fit.resid[i], 1) }));
  const byGrade = net.slice().sort((a, b) => b.grade - a.grade), byNet = net.slice().sort((a, b) => b.net - a.net);
  const rankG = new Map(byGrade.map((r, i) => [r.s, i + 1])), rankN = new Map(byNet.map((r, i) => [r.s, i + 1]));
  return {
    status: "ok", n: ok.length, r2: round(fit.r2, 3),
    loads: keys.map((k, j) => ({ key: k, label: labelOf(k), beta: round(fit.beta[j], 2), t: round(fit.t[j + 1], 2), corr: round(spearman(ok.map((r) => r.grade), ok.map((r) => r.f[k])), 2) })),
    names: net.map((r) => ({ ...r, rank: rankG.get(r.s), netRank: rankN.get(r.s) })).sort((a, b) => a.netRank - b.netRank),
    medianShift: round(median(net.map((r) => Math.abs(rankG.get(r.s) - rankN.get(r.s)))), 0),
  };
}

export const _test = { dailyRet, labelOf };

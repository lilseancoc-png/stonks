// Strategy engines: the history test. Replays the engines day by day over
// daily bars with the same rule code (signals.mjs), the same book (book.mjs:
// slots, run limits, exits, learning) and Black-Scholes option prices, then
// scores each engine by time window, market type (the Regime Lab's six
// cells), macro environment (rates, inflation, financial conditions, the
// yield curve, VIX band, recession) and against random entries taken with
// the same contract and exits.
//
// Timing matches the live engine as closely as daily bars allow: a decision
// on day D reads bars through D-1 and enters at D's open; open trades are
// marked at D's open and again at D's close.
//
// What it cannot know: real bid/ask spreads, real implied volatility (it
// uses 1.15x realized), fills, and for the Flow engine anything at all (no
// stored flow history). Costs are 3.5% of premium per round trip.
//
// Share trades (a setup's call side marked `calls: "shares"`) are marked at
// the open or close price itself, with 0.1% costs a round trip, and are
// scored apart from the options (`shares` on each engine row). Their random
// books buy the same stock lot on random days with the same stock exits.
//
// Pure. No network, no AI.

import { ENGINES, BOOK } from "./config.mjs";
import { precompute, featAt } from "./features.mjs";
import { buildMacro } from "./macro.mjs";
import { prepareReports, earnView, fundCore } from "./earn.mjs";
import { stepBook, emptyRecord, emptyState } from "./book.mjs";
import { engineStats, summarize, maxDrawdown } from "./record.mjs";
import { bsPrice } from "../greeks.mjs";
import { strikeForDelta } from "../regime-lab/options-model.mjs";

export const BACKTEST_VERSION = "engines-backtest-1";
export const WINDOWS = Object.freeze([
  { id: "2008-crisis", label: "2008 financial crisis", from: "2008-01-02", to: "2009-03-31" },
  { id: "2009-2012", label: "Recovery and debt-ceiling chop", from: "2009-04-01", to: "2012-12-31" },
  { id: "2013-2017", label: "Calm bull market", from: "2013-01-02", to: "2017-12-29" },
  { id: "2018-2019", label: "Volatility spike and trade war", from: "2018-01-02", to: "2019-12-31" },
  { id: "2020", label: "Covid crash and rebound", from: "2020-01-02", to: "2020-12-31" },
  { id: "2021", label: "2021 melt-up", from: "2021-01-04", to: "2021-12-31" },
  { id: "2022", label: "2022 rate-hike bear market", from: "2022-01-03", to: "2022-12-30" },
  { id: "2023-2024", label: "AI rally", from: "2023-01-03", to: "2024-12-31" },
  { id: "2025", label: "2025", from: "2025-01-02", to: "2025-12-31" },
  { id: "2026", label: "2026 to date", from: "2026-01-02", to: "2026-12-31" },
]);

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const YEAR_MS = 365.25 * 86400000;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Modeled implied volatility for a symbol at bar i.
function ivAt(P, i, ratio) {
  const a = P.rv20[i], b = P.rv60[i];
  const rv = fin(a) && fin(b) ? 0.6 * a + 0.4 * b : fin(a) ? a : fin(b) ? b : null;
  return rv == null ? null : Math.min(2.5, Math.max(0.1, rv * ratio));
}

// opts:
//   series: { SYM: bars }, isEtf(sym), fred, vix, vix3m,
//   macroEvents: [{ date, kind }], reports: { SYM: [report] },
//   labels: Map(date -> { cell, era, stressed }) as of each close,
//   from, to, engines: [ids], learn: bool, ivRatio, costPts, control: books.
export function runBacktest(opts) {
  const { series, isEtf = () => false, fred = {}, vix = null, vix3m = null, macroEvents = [], reports = null, labels = null,
    from = "2007-01-03", to = "9999-12-31", engines = ["technicals", "reversion", "macro"], learn = false, ivRatio = 1.15,
    costPts = BOOK.costPts, control = 20, seed = 7, calendarSymbol = "SPY", raw = false, shares = true } = opts;
  // raw: every setup traded from day one (probation ignored), for the
  // "rules as written" read beside the "as it runs" one.
  const baseSpecs = opts.specs || ENGINES;
  const specs = raw ? Object.fromEntries(Object.entries(baseSpecs).map(([id, e]) => [id, { ...e, setups: Object.fromEntries(Object.entries(e.setups).map(([k, v]) => [k, { ...v, probation: false }])) }])) : baseSpecs;
  const half = costPts / 200;
  const P = {};
  for (const [sym, bars] of Object.entries(series)) { const p = precompute(bars); if (p.n >= 80) P[sym] = p; }
  const calP = P[calendarSymbol];
  if (!calP) throw new Error(`runBacktest needs ${calendarSymbol} bars for the calendar`);
  const macroLib = buildMacro({ fred, vix, vix3m, events: macroEvents });
  const reps = {};
  if (reports) for (const [sym, list] of Object.entries(reports)) if (P[sym]) reps[sym] = prepareReports(list);
  const cal = calP.S.t.filter((d) => d >= from && d <= to);
  const syms = Object.keys(P);
  const ptr = Object.fromEntries(syms.map((s) => [s, -1]));
  const state = emptyState(), record = emptyRecord();
  const todayIdx = {};
  const needEarn = engines.some((e) => e === "earnings" || e === "fundamentals" || e === "reversion") && reports;
  const expirySec = (date, dte) => Math.floor((Date.parse(date + "T00:00:00Z") + dte * 86400000) / 1000);
  const yearsLeft = (contract, date, atClose) => Math.max(1 / 365, (contract.expiry * 1000 + 20 * 3600000 - (Date.parse(date + "T00:00:00Z") + (atClose ? 20 : 14) * 3600000)) / YEAR_MS);
  let atClose = false, D = null;
  const quote = (t) => {
    const p = P[t.symbol], i = todayIdx[t.symbol];
    if (!p || i == null) return null;
    const spot = atClose ? p.S.c[i] : p.S.o[i];
    if (t.contract.structure === "shares") return spot > 0 ? { mid: spot, spot, source: "model" } : null;
    const iv = ivAt(p, atClose ? i : i - 1, ivRatio) ?? t.contract.iv;
    const px = bsPrice(t.contract.optionType, spot, t.contract.strike, yearsLeft(t.contract, D, atClose), iv, 0.04);
    return px == null ? null : { mid: Math.max(0.01, px * (1 - half)), spot, source: "model" };
  };
  const pick = (view, side, spec) => {
    const p = P[view.sym], i = ptr[view.sym];
    const iv = ivAt(p, i, ivRatio); if (!iv || !(view.spot > 0)) return { skip: "no volatility read" };
    const type = side === "put" ? "put" : "call", dte = spec.contract.dteIdeal, T = dte / 365;
    const strike = strikeForDelta({ side: type, spot: view.spot, iv, T, delta: spec.contract.delta, rfr: 0.04 });
    const px = bsPrice(type, view.spot, strike, T, iv, 0.04);
    if (!(px >= BOOK.minMid)) return { skip: "premium under 30 cents" };
    if (px * 100 > BOOK.maxCost) return { skip: "one contract costs more than the $5,000 cap" };
    return { structure: "long", optionType: type, strike, expiry: expirySec(D, dte), dte, mid: Math.round(px * (1 + half) * 100) / 100, iv: Math.round(iv * 10000) / 10000, modeled: true };
  };
  const dayRegime = [];
  for (let k = 0; k < cal.length; k++) {
    D = cal[k];
    const views = {};
    for (const s of syms) {
      const t = P[s].S.t;
      while (ptr[s] + 1 < t.length && t[ptr[s] + 1] < D) ptr[s]++;
      const i = ptr[s], iT = i + 1 < t.length && t[i + 1] === D ? i + 1 : null;
      todayIdx[s] = iT;
      if (iT == null || i < 60) continue;
      const f = featAt(P[s], i); if (!f) continue;
      const view = { sym: s, isEtf: !!isEtf(s), spot: P[s].S.o[iT], f };
      if (needEarn && reps[s]) { view.earn = earnView(P[s], i, reps[s], { today: D }); view.fund = { core: fundCore(view.earn) }; }
      views[s] = view;
    }
    const prev = views[calendarSymbol]?.f?.date || null;
    const lab = labels && prev ? labels.get(prev) || null : null;
    const factors = macroLib.factors(D), env = macroLib.env(D, factors);
    const ctx = { date: D, spy: views.SPY?.f || null, byId: views, macro: factors, env, macroEvent: prev ? macroLib.eventOn(prev) : null,
      regime: lab ? { cell: lab.cell, era: lab.era, stressed: !!lab.stressed } : null };
    dayRegime.push(lab?.cell || null);
    atClose = false;
    stepBook(state, record, { nowIso: `${D}T15:00:00.000Z`, today: D, late: false, views, ctx, quote, pick, learn, engines, closedKept: Infinity, specs, shares });
    atClose = true;
    stepBook(state, record, { nowIso: `${D}T20:00:00.000Z`, today: D, late: true, views, ctx, quote, pick, learn, engines, marksOnly: true, closedKept: Infinity, specs, shares });
  }

  // Random entries with the same contract and exits (premium exits and the
  // time limit only), entered at the open on random days and names.
  const rand = rng(seed);
  function walk(sym, side, k0, spec) {
    const p = P[sym]; if (!p) return null;
    const d0 = cal[k0];
    let i0 = p.S.t.indexOf(d0); if (i0 < 61) return null;
    const iv0 = ivAt(p, i0 - 1, ivRatio); if (!iv0) return null;
    const type = side, T0 = spec.contract.dteIdeal / 365, spot0 = p.S.o[i0];
    const K = strikeForDelta({ side: type, spot: spot0, iv: iv0, T: T0, delta: spec.contract.delta, rfr: 0.04 });
    const px0 = bsPrice(type, spot0, K, T0, iv0, 0.04);
    if (!(px0 >= BOOK.minMid) || px0 * 100 > BOOK.maxCost) return null;
    const entry = px0 * (1 + half), x = spec.exits;
    let pnl = 0, hi = 0;
    for (let j = 0; j <= x.maxSessions && i0 + j < p.n; j++) {
      for (const close of j === 0 ? [true] : [false, true]) {
        const i = i0 + j, spot = close ? p.S.c[i] : p.S.o[i];
        const T = Math.max(1 / 365, T0 - ((j + (close ? 0.25 : 0)) * 1.45) / 365);
        const px = bsPrice(type, spot, K, T, ivAt(p, close ? i : i - 1, ivRatio) ?? iv0, 0.04);
        pnl = ((px * (1 - half)) / entry - 1) * 100;
        if (pnl > hi) hi = pnl;
        if ((fin(x.tp) && pnl >= x.tp) || pnl <= x.stop) return pnl;
        if (fin(x.trailArm) && hi >= x.trailArm && pnl <= hi - x.trailGive) return pnl;
      }
    }
    return pnl;
  }
  // A random share lot: in at the open, out at the stock stop (2 ATR under),
  // the target (3 ATR over) or the session limit, less 0.1% costs.
  function walkShares(sym, k0) {
    const p = P[sym]; if (!p) return null;
    const i0 = p.S.t.indexOf(cal[k0]); if (i0 < 61) return null;
    const atr = p.atr[i0 - 1], px0 = p.S.o[i0];
    if (!(atr > 0) || !(px0 > 0)) return null;
    const lo = px0 - BOOK.sharesStopAtr * atr, hi = px0 + BOOK.sharesTargetAtr * atr, cost = BOOK.sharesCostPct * 2;
    let px = px0;
    for (let j = 0; j <= BOOK.sharesMaxSessions && i0 + j < p.n; j++) {
      for (const close of j === 0 ? [true] : [false, true]) {
        px = close ? p.S.c[i0 + j] : p.S.o[i0 + j];
        if (px <= lo || px >= hi) return (px / px0 - 1) * 100 - cost;
      }
    }
    return (px / px0 - 1) * 100 - cost;
  }
  const controlBooks = (n, avgNow, draw) => {
    const avgs = [];
    for (let b = 0; b < control; b++) {
      let sum = 0, k = 0, guard = 0;
      while (k < Math.min(n, 400) && guard++ < n * 6) { const pnl = draw(); if (pnl == null) continue; sum += pnl; k++; }
      if (k) avgs.push(sum / k);
    }
    if (!avgs.length) return null;
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length, sd = Math.sqrt(avgs.reduce((a, b) => a + (b - mean) ** 2, 0) / avgs.length);
    return { books: avgs.length, avg: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10, beat: Math.round((avgs.filter((a) => avgNow > a).length / avgs.length) * 100), edge: Math.round((avgNow - mean) * 10) / 10 };
  };
  const result = { version: BACKTEST_VERSION, from: cal[0] || from, to: cal[cal.length - 1] || to, sessions: cal.length, symbols: syms.length, learn, raw, costPts, ivRatio, engines: {} };
  for (const id of engines) {
    const spec = specs[id];
    const closed = record.closed.filter((t) => t.engine === id);
    const stats = engineStats(closed, { windows: WINDOWS });
    const optClosed = closed.filter((t) => t.contract?.structure !== "shares");
    const years = Math.max(0.25, cal.length / 252);
    const es = state.engines[id];
    const row = { id, name: spec.name, ...stats, perYear: Math.round((stats.n / years) * 10) / 10, maxDrawdownUsd: maxDrawdown(stats.curve),
      shadow: summarize(es.shadow.closed || []), bar: es.bar, rulesVersion: `${spec.tag}-${es.v}`, changes: Math.max(0, (es.v || 1) - 1), log: (es.log || []).slice(0, 12) };
    // Control books: random option entries for the option trades, random
    // share lots for the share trades.
    const pool = syms.filter((s) => (spec.universe === "etfs" ? isEtf(s) : spec.universe === "stocks" ? !isEtf(s) : true));
    if (control > 0 && stats.n >= 20) {
      const callShare = optClosed.filter((t) => t.side === "call").length / optClosed.length;
      const c = controlBooks(stats.n, stats.avg, () => walk(pool[Math.floor(rand() * pool.length)], rand() < callShare ? "call" : "put", Math.floor(rand() * Math.max(1, cal.length - spec.exits.maxSessions - 1)), spec));
      if (c) row.control = c;
    }
    if (control > 0 && stats.shares && stats.shares.n >= 20) {
      const c = controlBooks(stats.shares.n, stats.shares.avg, () => walkShares(pool[Math.floor(rand() * pool.length)], Math.floor(rand() * Math.max(1, cal.length - BOOK.sharesMaxSessions - 1))));
      if (c) stats.shares.control = c;
    }
    result.engines[id] = row;
  }
  result.openAtEnd = record.open.length;
  if (opts.keepTrades) result.trades = record.closed;
  return result;
}

// The page copy of a result: aggregates only (no trade rows).
export function publicResult(res) {
  const slim = (s) => (s ? { n: s.n, winRate: s.winRate, avg: s.avg, median: s.median, usd: s.usd, profitFactor: s.profitFactor } : null);
  const rows = (list) => (list || []).map((r) => ({ key: r.key, label: r.label, from: r.from, to: r.to, ...slim(r) }));
  const out = { version: res.version, from: res.from, to: res.to, sessions: res.sessions, symbols: res.symbols, learn: res.learn, raw: !!res.raw, costPts: res.costPts, ivRatio: res.ivRatio, engines: {} };
  for (const [id, e] of Object.entries(res.engines)) {
    out.engines[id] = {
      id, name: e.name, ...slim(e), wins: e.wins, losses: e.losses, winRange: e.winRange, avgWin: e.avgWin, avgLoss: e.avgLoss, best: e.best, worst: e.worst,
      perYear: e.perYear, maxDrawdownUsd: e.maxDrawdownUsd, control: e.control || null, bar: e.bar, rulesVersion: e.rulesVersion, changes: e.changes, log: e.log,
      bySetup: rows(e.bySetup), byScore: rows(e.byScore), bySide: rows(e.bySide), byCell: rows(e.byCell), byExit: rows(e.byExit), byYear: rows(e.byYear).sort((a, b) => (a.key < b.key ? -1 : 1)), byWindow: rows(e.byWindow),
      byEnv: Object.fromEntries(Object.entries(e.byEnv || {}).map(([k, v]) => [k, rows(v)])), curve: e.curve,
      // Share trades, scored apart (null when the engine bought none).
      shares: e.shares ? { ...slim(e.shares), wins: e.shares.wins, losses: e.shares.losses, winRange: e.shares.winRange, avgWin: e.shares.avgWin, avgLoss: e.shares.avgLoss, best: e.shares.best, worst: e.shares.worst,
        maxDrawdownUsd: maxDrawdown(e.shares.curve), control: e.shares.control || null, bySetup: rows(e.shares.bySetup), byCell: rows(e.shares.byCell), byExit: rows(e.shares.byExit), byYear: rows(e.shares.byYear).sort((a, b) => (a.key < b.key ? -1 : 1)), byWindow: rows(e.shares.byWindow), curve: e.shares.curve } : null,
    };
  }
  return out;
}

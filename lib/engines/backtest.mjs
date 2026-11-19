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
// Core engines (Trend follower, Momentum basket) are also scored as a
// portfolio (`core` on their row): the value of $1 that follows the engine's
// holdings at every open and close, with idle money earning the fed funds
// rate, against $1 in SPY bought the same day and held. That is the "beat the
// S&P" read; their per-trade stats are the usual share rows.
//
// The Allocator (`allocator`: "on" | "advise" | "off", default off) runs
// with no prior here: it starts from nothing and judges each setup only on
// trades that finished before the decision. Each engine row carries the
// dollars at the Allocator's size beside the dollars at normal size.
//
// Pure. No network, no AI.

import { ENGINES, BOOK, contractFor } from "./config.mjs";
import { precompute, featAt, monthEnds } from "./features.mjs";
import { buildMacro, fearReading } from "./macro.mjs";
import { prepareReports, earnView, fundCore } from "./earn.mjs";
import { stepBook, emptyRecord, emptyState } from "./book.mjs";
import { engineStats, summarize, maxDrawdown, tradeUsd } from "./record.mjs";
import { positionUsd } from "./contracts.mjs";
import { allocBook } from "./allocator.mjs";
import { bsPrice } from "../greeks.mjs";
import { strikeForDelta } from "../regime-lab/options-model.mjs";

// 2: the money-leak fixes (2026-11-17): option trades sized at
// BOOK.optionUsd, setup-level contracts, engine-level share stops, and random
// option books drawn trade by trade with each trade's own contract and exits.
// 3: paper trials (2026-11-19) scored apart (`trials`), and random share lots
// matched trade by trade to the real trade's hold and exits.
// 4: honest paper trades (2026-11-19): risk sizing with the conviction
// multiplier, Technicals' squeeze calls as shares, the crash stand-aside on
// Reversion's washout bounce, and the extreme-fear bounce test (only with a
// fear and greed series passed in).
export const BACKTEST_VERSION = "engines-backtest-4";
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
//   from, to, engines: [ids], learn: bool, ivRatio, costPts, control: books,
//   allocator: "on" | "advise" | "off", allocPrior (a prior table; what-if
//   tests only: the committed run starts the Allocator from nothing).
//   specs: the registry (engineSpecs() with fixes switched off; default
//   ENGINES), optionUsd: premium per option trade (null = one contract).
//   fearGreed: [date, score] Fear & Greed closes (optional; the index-fear
//   paper trial opens nothing without them).
export function runBacktest(opts) {
  const { series, isEtf = () => false, fred = {}, vix = null, vix3m = null, macroEvents = [], reports = null, labels = null,
    from = "2007-01-03", to = "9999-12-31", engines = ["technicals", "reversion", "macro"], learn = false, ivRatio = 1.15,
    costPts = BOOK.costPts, control = 20, seed = 7, calendarSymbol = "SPY", raw = false, shares = true, allocator = "off", allocPrior = null,
    optionUsd = BOOK.optionUsd, fearGreed = null, groupOf = null } = opts;
  // Sizing (2026-11-19): risk sizing with the conviction multiplier, as the
  // live engines run by default; `sizing: null` (or a `mode` other than
  // "risk") keeps the older $2,000-of-premium size (`optionUsd`).
  const sizing = opts.sizing === undefined ? { mode: "risk", budget: BOOK.riskUsd, conviction: true } : opts.sizing || (optionUsd > 0 ? { mode: "premium", optionUsd } : { mode: "one" });
  // fearGreed: Fear & Greed closes as [date, score, ...] rows (the score is
  // the second column; the research kit adds the VIX third), { date, score }
  // rows, a Map or an object of date -> score (none ships with the repo).
  // The decision on day D reads the last reading before D, as the history
  // test's other inputs do: the extreme-fear bounce test the latest one
  // (fgMap), the index-fear paper trial the last two (fearAt).
  const fearRows = fearGreed instanceof Map ? [...fearGreed] : Array.isArray(fearGreed) ? fearGreed.map((r) => (Array.isArray(r) ? [r[0], r[1]] : [r?.date, r?.score]))
    : fearGreed && typeof fearGreed === "object" ? Object.entries(fearGreed) : null;
  const fearPts = fearRows ? fearRows.map(([d, v]) => [typeof d === "string" ? d.slice(0, 10) : null, Number(v)]).filter((r) => r[0] && fin(r[1])).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : null;
  const fgMap = fearPts?.length ? new Map(fearPts) : null;
  // raw: every setup traded from day one (probation ignored), for the
  // "rules as written" read beside the "as it runs" one.
  const baseSpecs = opts.specs || ENGINES;
  const specs = raw ? Object.fromEntries(Object.entries(baseSpecs).map(([id, e]) => [id, { ...e, setups: Object.fromEntries(Object.entries(e.setups).map(([k, v]) => [k, { ...v, probation: false }])) }])) : baseSpecs;
  const half = costPts / 200;
  // Fear & Greed closes in date order (fearPts above), read forward with a
  // pointer so each day hands fearReading only the closes just before it.
  let fearK = 0;
  const fearAt = (D) => {
    if (!fearPts) return null;
    while (fearK < fearPts.length && fearPts[fearK][0] < D) fearK++;
    return fearReading(fearPts.slice(Math.max(0, fearK - 2), fearK), D);
  };
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
  // The setup's own window and delta where it has them (contractFor).
  const pick = (view, side, spec, c) => {
    const p = P[view.sym], i = ptr[view.sym];
    const iv = ivAt(p, i, ivRatio); if (!iv || !(view.spot > 0)) return { skip: "no volatility read" };
    const want = contractFor(spec, c?.setup);
    const type = side === "put" ? "put" : "call", dte = want.dteIdeal, T = dte / 365;
    const strike = strikeForDelta({ side: type, spot: view.spot, iv, T, delta: want.delta, rfr: 0.04 });
    const px = bsPrice(type, view.spot, strike, T, iv, 0.04);
    if (!(px >= BOOK.minMid)) return { skip: "premium under 30 cents" };
    if (px * 100 > BOOK.maxCost) return { skip: "one contract costs more than the $5,000 cap" };
    return { structure: "long", optionType: type, strike, expiry: expirySec(D, dte), dte, mid: Math.round(px * (1 + half) * 100) / 100, iv: Math.round(iv * 10000) / 10000, modeled: true };
  };
  // Core engines as a portfolio: $1 that follows the holdings. Each holding
  // carries its share of the engine's money (its lot over the engine's
  // total), marked at the open and the close from the bars themselves (not
  // the rounded record marks: split-adjusted prices run under a dollar);
  // the money not in a holding earns the fed funds rate. SPY bought at the
  // open of the engine's first day is the yardstick.
  const coreIds = engines.filter((id) => specs[id]?.core);
  const shareCost = BOOK.sharesCostPct / 100;   // each way, as a fraction
  const core = Object.fromEntries(coreIds.map((id) => [id, { v: 1, spy: null, start: null, held: new Map(), peak: 1, dd: 0, spyPeak: 1, spyDd: 0, days: 0, wSum: 0, years: {}, last: null }]));
  const pxAt = (sym, close) => { const i = todayIdx[sym]; const p = P[sym]; return i == null || !p ? null : close ? p.S.c[i] : p.S.o[i]; };
  function coreMark(o, close, factors) {
    for (const id of coreIds) {
      const q = core[id], spec = specs[id], cap = (spec.lotUsd || 1) * (spec.top || spec.slots || 1);
      if (!q.start && state.engines[id]?.core) { q.start = D; q.spy0 = pxAt(calendarSymbol, false); q.spy = 1; q.years[D.slice(0, 4)] = { v: 1, spy: 1 }; }
      if (!q.start) continue;
      let r = 0, w = 0;
      const gone = new Set(o.closed.filter((t) => t.engine === id).map((t) => t.tradeId));
      for (const [tid, h] of q.held) {
        w += h.w;
        const px = pxAt(h.sym, close);
        if (px > 0 && h.px > 0) { r += h.w * (px / h.px - 1); h.px = px; }
        if (gone.has(tid)) { r -= h.w * shareCost; q.held.delete(tid); }
      }
      // Idle money: the fed funds rate for the session, booked at the close.
      if (close && fin(factors?.dff)) r += Math.max(0, 1 - w) * (factors.dff / 100 / 252);
      for (const t of o.opened || []) {
        if (t.engine !== id) continue;
        const hw = Math.min(1, positionUsd(t.contract) / cap);
        q.held.set(t.tradeId, { sym: t.symbol, w: hw, px: Number(t.contract.mid) });
        r -= hw * shareCost;
      }
      q.v *= 1 + r;
      const spx = pxAt(calendarSymbol, close);
      if (spx > 0 && q.spy0 > 0) q.spy = spx / q.spy0;
      if (close) {
        q.days++; q.wSum += [...q.held.values()].reduce((a, h) => a + h.w, 0);
        q.peak = Math.max(q.peak, q.v); q.dd = Math.min(q.dd, q.v / q.peak - 1);
        q.spyPeak = Math.max(q.spyPeak, q.spy); q.spyDd = Math.min(q.spyDd, q.spy / q.spyPeak - 1);
        const y = D.slice(0, 4);
        if (!q.years[y]) q.years[y] = { v: q.last?.v ?? 1, spy: q.last?.spy ?? 1 };
        q.last = { v: q.v, spy: q.spy, y };
        q.years[y].end = { v: q.v, spy: q.spy };
      }
    }
  }
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
      const view = { sym: s, isEtf: !!isEtf(s), spot: P[s].S.o[iT], f, mo: monthEnds(P[s], i, D, 14), group: groupOf ? groupOf(s) || null : null };
      if (needEarn && reps[s]) { view.earn = earnView(P[s], i, reps[s], { today: D }); view.fund = { core: fundCore(view.earn) }; }
      views[s] = view;
    }
    const prev = views[calendarSymbol]?.f?.date || null;
    const lab = labels && prev ? labels.get(prev) || null : null;
    const factors = macroLib.factors(D), env = macroLib.env(D, factors);
    const fgv = fgMap && prev ? fgMap.get(prev) : null;
    const ctx = { date: D, spy: views.SPY?.f || null, byId: views, macro: factors, env, macroEvent: prev ? macroLib.eventOn(prev) : null,
      regime: lab ? { cell: lab.cell, era: lab.era, stressed: !!lab.stressed } : null,
      fearGreed: fin(fgv) ? { score: fgv, asOf: prev, stale: false, source: "rebuild" } : null,
      // Fear & Greed closes before D (the index-fear paper trial); none = no trial trades.
      fear: fearAt(D) };
    dayRegime.push(lab?.cell || null);
    atClose = false;
    const alloc = { mode: allocator, prior: allocPrior };
    const o1 = stepBook(state, record, { nowIso: `${D}T15:00:00.000Z`, today: D, late: false, views, ctx, quote, pick, learn, engines, closedKept: Infinity, specs, shares, allocator: alloc, optionUsd, sizing });
    coreMark(o1, false, factors);
    atClose = true;
    const o2 = stepBook(state, record, { nowIso: `${D}T20:00:00.000Z`, today: D, late: true, views, ctx, quote, pick, learn, engines, marksOnly: true, closedKept: Infinity, specs, shares, allocator: alloc, optionUsd, sizing });
    coreMark(o2, true, factors);
  }

  // Random entries with the same contract and exits (premium exits and the
  // time limit only), entered at the open on random days and names. Each
  // draw copies one of the engine's real option trades (its side, its
  // setup's contract and its exits), so a setup with its own contract or
  // exits is matched like for like (since 2026-11-17; before, every draw
  // used the engine's contract and exits).
  const rand = rng(seed);
  function walk(sym, k0, like, spec) {
    const p = P[sym]; if (!p) return null;
    const d0 = cal[k0];
    let i0 = p.S.t.indexOf(d0); if (i0 < 61) return null;
    const iv0 = ivAt(p, i0 - 1, ivRatio); if (!iv0) return null;
    const want = contractFor(spec, like.setup), x = like.exits && fin(like.exits.maxSessions) ? like.exits : spec.exits;
    const type = like.side === "put" ? "put" : "call", T0 = want.dteIdeal / 365, spot0 = p.S.o[i0];
    const K = strikeForDelta({ side: type, spot: spot0, iv: iv0, T: T0, delta: want.delta, rfr: 0.04 });
    const px0 = bsPrice(type, spot0, K, T0, iv0, 0.04);
    if (!(px0 >= BOOK.minMid) || px0 * 100 > BOOK.maxCost) return null;
    const entry = px0 * (1 + half);
    let pnl = 0, hi = 0;
    for (let j = 0; j <= x.maxSessions && i0 + j < p.n; j++) {
      for (const close of j === 0 ? [true] : [false, true]) {
        const i = i0 + j, spot = close ? p.S.c[i] : p.S.o[i];
        const T = Math.max(1 / 365, T0 - ((j + (close ? 0.25 : 0)) * 1.45) / 365);
        const px = bsPrice(type, spot, K, T, ivAt(p, close ? i : i - 1, ivRatio) ?? iv0, 0.04);
        pnl = ((px * (1 - half)) / entry - 1) * 100;
        if (pnl > hi) hi = pnl;
        if ((fin(x.tp) && pnl >= x.tp) || (fin(x.stop) && pnl <= x.stop)) return pnl;
        if (fin(x.trailArm) && hi >= x.trailArm && pnl <= hi - x.trailGive) return pnl;
      }
    }
    return pnl;
  }
  // A random share lot: in at the open, out at the stock stop (the engine's
  // share stop, 2 ATR under by default), the target (3 ATR over) or the
  // session limit, less 0.1% costs. Since 2026-11-19 (version 3) each lot is
  // matched to a real share trade drawn at random: it holds at most as many
  // sessions as that trade did, and has no stop or target when that trade
  // had none, so a setup that sells after a few sessions is not judged
  // against random lots that ride the market's drift for 20.
  function walkShares(sym, k0, spec, like = null) {
    const p = P[sym]; if (!p) return null;
    const i0 = p.S.t.indexOf(cal[k0]); if (i0 < 61) return null;
    const atr = p.atr[i0 - 1], px0 = p.S.o[i0];
    if (!(atr > 0) || !(px0 > 0)) return null;
    const stopAtr = fin(spec?.sharesStopAtr) ? spec.sharesStopAtr : BOOK.sharesStopAtr;
    const levels = !like || fin(like.stopLevel) || fin(like.targetLevel);
    const lo = levels ? px0 - stopAtr * atr : -Infinity, hi = levels ? px0 + BOOK.sharesTargetAtr * atr : Infinity, cost = BOOK.sharesCostPct * 2;
    const held = fin(like?.sessions) ? like.sessions : fin(like?.exits?.maxSessions) ? like.exits.maxSessions : BOOK.sharesMaxSessions;
    const maxJ = Math.min(BOOK.sharesMaxSessions, Math.max(0, held));
    let px = px0;
    for (let j = 0; j <= maxJ && i0 + j < p.n; j++) {
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
  const result = { version: BACKTEST_VERSION, from: cal[0] || from, to: cal[cal.length - 1] || to, sessions: cal.length, symbols: syms.length, learn, raw, costPts, ivRatio, sizing: sizing ? { mode: sizing.mode, budget: sizing.budget ?? null, conviction: !!sizing.conviction } : null, fearGreed: !!fgMap, engines: {} };
  const pct = (x) => (fin(x) ? Math.round(x * 1000) / 10 : null);
  for (const id of engines) {
    const spec = specs[id];
    const closed = record.closed.filter((t) => t.engine === id);
    if (spec.core) {
      // A core engine: its portfolio line against SPY bought the same day.
      const q = core[id], yrs = q.days / 252;
      const coreRow = q.start && q.days > 20 ? {
        from: q.start, years: Math.round(yrs * 10) / 10,
        total: pct(q.v - 1), spyTotal: pct(q.spy - 1),
        cagr: pct(q.v ** (1 / yrs) - 1), spyCagr: pct(q.spy ** (1 / yrs) - 1),
        maxDrawdown: pct(q.dd), spyMaxDrawdown: pct(q.spyDd),
        invested: Math.round((q.wSum / Math.max(1, q.days)) * 100),
        swaps: closed.filter((t) => t.status === "rotate").length,
        byYear: Object.entries(q.years).filter(([, x]) => x.end).sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([year, x]) => ({ year, ret: pct(x.end.v / x.v - 1), spy: pct(x.end.spy / x.spy - 1) })),
      } : null;
      const stats = engineStats(closed, { windows: WINDOWS });
      const es = state.engines[id];
      result.engines[id] = { id, name: spec.name, ...stats, perYear: Math.round((((stats.shares?.n || 0) / Math.max(0.25, cal.length / 252))) * 10) / 10, maxDrawdownUsd: maxDrawdown(stats.curve),
        shadow: summarize(es.shadow.closed || []), bar: es.bar, rulesVersion: `${spec.tag}-${es.v}`, changes: 0, log: (es.coreLog || []).slice(0, 12).map((c) => ({ date: c.asOf, v: c.month, kind: "month", text: c.why })), core: coreRow };
      continue;
    }
    const stats = engineStats(closed, { windows: WINDOWS });
    const optClosed = closed.filter((t) => !t.trial && t.contract?.structure !== "shares");
    const years = Math.max(0.25, cal.length / 252);
    const es = state.engines[id];
    const row = { id, name: spec.name, ...stats, perYear: Math.round((stats.n / years) * 10) / 10, maxDrawdownUsd: maxDrawdown(stats.curve),
      shadow: summarize(es.shadow.closed || []), bar: es.bar, rulesVersion: `${spec.tag}-${es.v}`, changes: Math.max(0, (es.v || 1) - 1), log: (es.log || []).slice(0, 12) };
    // Control books: random option entries for the option trades, random
    // share lots for the share trades.
    const pool = syms.filter((s) => (spec.universe === "etfs" ? isEtf(s) : spec.universe === "stocks" ? !isEtf(s) : true));
    if (control > 0 && stats.n >= 20) {
      const likeOf = () => optClosed[Math.floor(rand() * optClosed.length)];
      const c = controlBooks(stats.n, stats.avg, () => { const like = likeOf(); const ms = fin(like.exits?.maxSessions) ? like.exits.maxSessions : spec.exits.maxSessions; return walk(pool[Math.floor(rand() * pool.length)], Math.floor(rand() * Math.max(1, cal.length - ms - 1)), like, spec); });
      if (c) row.control = c;
    }
    // Share lots (the engine's own, then its paper trials, each against
    // random lots matched trade by trade to their holds and exits). A
    // trial's random lots come from the names it traded (the index-fear
    // trial: SPY, QQQ and IWM), so it is not flattered by a weaker pool.
    const shareControl = (block, list, names) => {
      if (!(control > 0 && block && block.n >= 20 && list.length && names.length)) return;
      const c = controlBooks(block.n, block.avg, () => walkShares(names[Math.floor(rand() * names.length)], Math.floor(rand() * Math.max(1, cal.length - BOOK.sharesMaxSessions - 1)), spec, list[Math.floor(rand() * list.length)]));
      if (c) block.control = c;
    };
    shareControl(stats.shares, closed.filter((t) => !t.trial && t.contract?.structure === "shares"), pool);
    const trialList = closed.filter((t) => t.trial);
    shareControl(stats.trials, trialList, [...new Set(trialList.map((t) => t.symbol))].filter((s) => P[s]).sort());
    // The Allocator's sizes on this engine's real trades.
    if (allocator !== "off") { const b = allocBook(closed.filter((t) => !t.trial), tradeUsd); row.allocator = { n: b.n, plainUsd: b.plainUsd, sizedUsd: b.sizedUsd, heldN: b.advisedOut, heldUsd: b.heldUsd }; }
    result.engines[id] = row;
  }
  result.allocator = allocator;
  result.openAtEnd = record.open.length;
  if (opts.keepTrades) result.trades = record.closed;
  return result;
}

// The page copy of a result: aggregates only (no trade rows).
export function publicResult(res) {
  const slim = (s) => (s ? { n: s.n, winRate: s.winRate, avg: s.avg, median: s.median, usd: s.usd, flatUsd: s.flatUsd ?? null, profitFactor: s.profitFactor } : null);
  const rows = (list) => (list || []).map((r) => ({ key: r.key, label: r.label, from: r.from, to: r.to, ...slim(r) }));
  const out = { version: res.version, from: res.from, to: res.to, sessions: res.sessions, symbols: res.symbols, learn: res.learn, raw: !!res.raw, costPts: res.costPts, ivRatio: res.ivRatio, allocator: res.allocator || "off", sizing: res.sizing || null, fearGreed: !!res.fearGreed, engines: {} };
  for (const [id, e] of Object.entries(res.engines)) {
    out.engines[id] = {
      id, name: e.name, ...slim(e), wins: e.wins, losses: e.losses, winRange: e.winRange, avgWin: e.avgWin, avgLoss: e.avgLoss, best: e.best, worst: e.worst,
      perYear: e.perYear, maxDrawdownUsd: e.maxDrawdownUsd, control: e.control || null, bar: e.bar, rulesVersion: e.rulesVersion, changes: e.changes, log: e.log,
      bySetup: rows(e.bySetup), byScore: rows(e.byScore), bySide: rows(e.bySide), byCell: rows(e.byCell), byExit: rows(e.byExit), byYear: rows(e.byYear).sort((a, b) => (a.key < b.key ? -1 : 1)), byWindow: rows(e.byWindow),
      byEnv: Object.fromEntries(Object.entries(e.byEnv || {}).map(([k, v]) => [k, rows(v)])), curve: e.curve,
      // Share trades, scored apart (null when the engine bought none).
      shares: e.shares ? { ...slim(e.shares), wins: e.shares.wins, losses: e.shares.losses, winRange: e.shares.winRange, avgWin: e.shares.avgWin, avgLoss: e.shares.avgLoss, best: e.shares.best, worst: e.shares.worst,
        maxDrawdownUsd: maxDrawdown(e.shares.curve), control: e.shares.control || null, bySetup: rows(e.shares.bySetup), byCell: rows(e.shares.byCell), byExit: rows(e.shares.byExit), byYear: rows(e.shares.byYear).sort((a, b) => (a.key < b.key ? -1 : 1)), byWindow: rows(e.shares.byWindow),
        byEnv: Object.fromEntries(Object.entries(e.shares.byEnv || {}).map(([k, v]) => [k, rows(v)])), curve: e.shares.curve } : null,
      // Paper trials, scored apart from the engine's own trades (null when none).
      trials: e.trials ? { ...slim(e.trials), wins: e.trials.wins, losses: e.trials.losses, avgWin: e.trials.avgWin, avgLoss: e.trials.avgLoss, best: e.trials.best, worst: e.trials.worst,
        maxDrawdownUsd: maxDrawdown(e.trials.curve), control: e.trials.control || null, bySetup: rows(e.trials.bySetup), byCell: rows(e.trials.byCell), byExit: rows(e.trials.byExit), byYear: rows(e.trials.byYear).sort((a, b) => (a.key < b.key ? -1 : 1)), byWindow: rows(e.trials.byWindow), curve: e.trials.curve } : null,
      core: e.core || null, allocator: e.allocator || null,
    };
  }
  return out;
}

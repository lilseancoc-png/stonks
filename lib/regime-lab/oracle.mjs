// Regime Lab: the "known headline" oracle (D1-D8, G7; 2026-11-09).
//
// If the engine knew tomorrow's headline, how much could it make, with what
// structure and what risk? The answer is a CEILING, never a strategy, and its
// value is the gap between it and what the engine does. The book holds only
// events whose outcome a RULE can tag before any price is read:
//   earnings   beat / miss / in line from EPS actual vs estimate (±1% in line)
//   fomc       cut / hike / hold from the decision table
//   cpi        cooler / hotter than the prior month-over-month print
//   jobs       stronger / weaker than the prior payroll change
// Consensus is not stored, so the prior print stands in for it (D1). Series
// values are the latest revised vintage, not the print as released; the
// output says so. Headline text never enters the book (G7), and nothing here
// may be written into the Track Record: every output carries neverRecord.

import { openPosition, markPosition, netOfCosts, eventIv, ivProxy, COSTS } from "./options-model.mjs";

export const ORACLE_VERSION = "2026-11-09-oracle-v1";
export const HEADLINE_TYPES = Object.freeze(["earnings", "fomc", "cpi", "jobs"]);
export const ORACLE_EXITS = Object.freeze(["open", "close", "close3"]);
export const ORACLE_STRUCTURES = Object.freeze(["stock", "long", "debit_vertical", "straddle"]);
export const INLINE_SURPRISE_PCT = 1;
export const CPI_NEUTRAL_PP = 0.05;
export const JOBS_NEUTRAL_K = 25;
export const ORACLE_DTE = 30;
export const NOISE_LEVELS = Object.freeze([0, 10, 20, 30, 40, 50]);

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function firstSessionAtOrAfter(cal, date, strict = false) {
  let lo = 0, hi = cal.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (strict ? cal[m] > date : cal[m] >= date) { r = m; hi = m - 1; } else lo = m + 1; }
  return r >= 0 ? cal[r] : null;
}

// D1. Tags.
export function epsTag({ epsActual = null, epsEstimate = null, surprisePct = null } = {}) {
  let sur = num(surprisePct);
  const a = num(epsActual), e = num(epsEstimate);
  if (sur == null && a != null && e != null) sur = Math.abs(e) > 1e-9 ? ((a - e) / Math.abs(e)) * 100 : (a === e ? 0 : a > e ? 100 : -100);
  if (sur == null) return null;
  return Math.abs(sur) <= INLINE_SURPRISE_PCT ? 0 : sur > 0 ? 1 : -1;
}
export function fomcTag(outcome) { return outcome === "cut" ? 1 : outcome === "hike" ? -1 : outcome === "hold" ? 0 : null; }
export function cpiTag(mm, priorMm) { const a = num(mm), b = num(priorMm); if (a == null || b == null) return null; const d = (a - b) * 100; return Math.abs(d) <= CPI_NEUTRAL_PP ? 0 : d < 0 ? 1 : -1; }
export function jobsTag(change, priorChange) { const a = num(change), b = num(priorChange); if (a == null || b == null) return null; const d = a - b; return Math.abs(d) <= JOBS_NEUTRAL_K ? 0 : d > 0 ? 1 : -1; }

// Monthly release rows from a FRED-style series { t: ['YYYY-MM-01'], v }.
// A release in month M reports month M-1; the row carries that month's
// change and the prior month's change.
export function monthlyReleaseRows(releaseDates, series, { kind = "pct" } = {}) {
  if (!series || !Array.isArray(series.t) || !Array.isArray(series.v)) return [];
  const byMonth = new Map(series.t.map((t, i) => [String(t).slice(0, 7), num(series.v[i])]));
  const prevMonth = (ym, n = 1) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 7); };
  const rows = [];
  for (const date of releaseDates || []) {
    if (!DATE_RE.test(String(date))) continue;
    const m0 = prevMonth(date.slice(0, 7), 1), m1 = prevMonth(date.slice(0, 7), 2), m2 = prevMonth(date.slice(0, 7), 3);
    const v0 = byMonth.get(m0), v1 = byMonth.get(m1), v2 = byMonth.get(m2);
    if (v0 == null || v1 == null || v2 == null) continue;
    if (kind === "pct") rows.push({ date, month: m0, change: v0 / v1 - 1, priorChange: v1 / v2 - 1 });
    else rows.push({ date, month: m0, change: v0 - v1, priorChange: v1 - v2 });
  }
  return rows;
}

// The book: one row per rule-tagged event with its reaction session.
export function buildHeadlineBook({ cal = [], earnings = [], fomc = [], cpi = [], jobs = [] } = {}) {
  const rows = [];
  for (const e of earnings) {
    if (!e || !DATE_RE.test(String(e.date || ""))) continue;
    const tag = epsTag(e);
    if (tag == null) continue;
    const reaction = e.session === "AM" ? firstSessionAtOrAfter(cal, e.date) : firstSessionAtOrAfter(cal, e.date, true);
    if (!reaction) continue;
    rows.push({ type: "earnings", sym: e.sym, date: reaction, announced: e.date, session: e.session || "TBD", tag, detail: tag > 0 ? "beat" : tag < 0 ? "miss" : "in line", surprisePct: r2(num(e.surprisePct)) });
  }
  for (const f of fomc) {
    const tag = fomcTag(f?.outcome);
    if (tag == null || !DATE_RE.test(String(f.date || ""))) continue;
    const reaction = firstSessionAtOrAfter(cal, f.date);
    if (!reaction) continue;
    rows.push({ type: "fomc", sym: "SPY", date: reaction, announced: f.date, tag, detail: f.outcome, bp: num(f.bp) });
  }
  for (const c of cpi) {
    const tag = cpiTag(c?.change, c?.priorChange);
    if (tag == null) continue;
    const reaction = firstSessionAtOrAfter(cal, c.date);
    if (!reaction) continue;
    rows.push({ type: "cpi", sym: "SPY", date: reaction, announced: c.date, tag, detail: tag > 0 ? "cooler" : tag < 0 ? "hotter" : "same", mm: r2(c.change * 100), priorMm: r2(c.priorChange * 100) });
  }
  for (const j of jobs) {
    const tag = jobsTag(j?.change, j?.priorChange);
    if (tag == null) continue;
    const reaction = firstSessionAtOrAfter(cal, j.date);
    if (!reaction) continue;
    rows.push({ type: "jobs", sym: "SPY", date: reaction, announced: j.date, tag, detail: tag > 0 ? "stronger" : tag < 0 ? "weaker" : "same", change: Math.round(j.change), priorChange: Math.round(j.priorChange) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
  return Object.freeze({ v: ORACLE_VERSION, rows, neverRecord: true, ruleTaggedOnly: true, caveat: "Tags come from rules on stored numbers (revised series, prior print as the consensus stand-in). Headline text is never read." });
}

// Bar series come in two shapes: a row array [{ t, c, o?, h?, l? }] (the
// bake's confirmed bars, the long-history cache) or columns { t, c, o?, idx? }
// (the harness context). Normalize to columns with a date index once per
// input object; the cache is weak so a one-off array costs nothing after.
const SERIES_CACHE = new WeakMap();
export function barSeries(bars) {
  if (!bars || typeof bars !== "object") return null;
  const hit = SERIES_CACHE.get(bars);
  if (hit) return hit;
  let out = null;
  if (Array.isArray(bars)) {
    const t = [], c = [], o = [];
    let anyOpen = false;
    for (const b of bars) {
      const d = typeof b?.t === "string" ? b.t.slice(0, 10) : b?.date ? String(b.date).slice(0, 10) : null;
      const close = num(b?.c);
      if (!d || close == null || close <= 0) continue;
      t.push(d); c.push(close);
      const op = num(b?.o); o.push(op != null && op > 0 ? op : null); if (op != null && op > 0) anyOpen = true;
    }
    if (!t.length) return null;
    out = { t, c, o: anyOpen ? o : null, idx: new Map(t.map((d, i) => [d, i])) };
  } else if (Array.isArray(bars.t) && Array.isArray(bars.c)) {
    out = bars.idx instanceof Map ? bars : { t: bars.t, c: bars.c, o: Array.isArray(bars.o) ? bars.o : null, idx: new Map(bars.t.map((d, i) => [d, i])) };
  } else return null;
  SERIES_CACHE.set(bars, out);
  return out;
}
const seriesOf = (barsOf) => (sym) => barSeries(barsOf(sym));

// Moves around a reaction session for one bar series { t, o?, c }.
function movesFor(bars, date) {
  const i = bars.idx.get(date);
  if (i == null || i < 1) return null;
  const prev = bars.c[i - 1];
  if (!(prev > 0) || !(bars.c[i] > 0)) return null;
  const o = bars.o && bars.o[i] > 0 ? bars.o[i] : null;
  const c3 = bars.c[i + 3];
  return { i, prev, open: o != null ? (o / prev - 1) * 100 : null, close: (bars.c[i] / prev - 1) * 100, close3: c3 > 0 ? (c3 / prev - 1) * 100 : null, closeSpot: bars.c[i], spot3: c3 > 0 ? c3 : null };
}

function describeType(list) {
  const signed = list.filter((r) => r.tag !== 0 && r.moves);
  const out = { n: list.length, signed: signed.length, neutral: list.filter((r) => r.tag === 0).length, hit: {}, avgSigned: {}, bestExit: null, alreadyPricedPct: null, avgAbsMove: null, bySign: {} };
  let best = null;
  for (const ex of ORACLE_EXITS) {
    const rows = signed.filter((r) => Number.isFinite(r.moves[ex]));
    if (!rows.length) { out.hit[ex] = null; out.avgSigned[ex] = null; continue; }
    const hits = rows.filter((r) => Math.sign(r.moves[ex]) === r.tag).length;
    out.hit[ex] = Math.round((hits / rows.length) * 100);
    out.avgSigned[ex] = r2(mean(rows.map((r) => r.tag * r.moves[ex])));
    if (ex !== "open" && (best == null || out.avgSigned[ex] > out.avgSigned[best])) best = ex;
  }
  out.bestExit = best;
  const atClose = signed.filter((r) => Number.isFinite(r.moves.close));
  out.alreadyPricedPct = atClose.length ? Math.round((atClose.filter((r) => Math.sign(r.moves.close) === -r.tag).length / atClose.length) * 100) : null;
  out.avgAbsMove = r2(mean(list.filter((r) => r.moves && Number.isFinite(r.moves.close)).map((r) => Math.abs(r.moves.close))));
  for (const [name, sign] of [["good", 1], ["bad", -1]]) {
    const rows = signed.filter((r) => r.tag === sign && Number.isFinite(r.moves.close));
    out.bySign[name] = rows.length ? { n: rows.length, hitPct: Math.round((rows.filter((r) => Math.sign(r.moves.close) === sign).length / rows.length) * 100), avgMove: r2(mean(rows.map((r) => r.moves.close))) } : null;
  }
  return out;
}

// D2 + D3. Three-way replay by headline type.
export function replayBook(book, barsOf) {
  const rows = [];
  const series = seriesOf(barsOf);
  for (const r of book.rows) {
    const bars = series(r.sym);
    if (!bars) continue;
    const moves = movesFor(bars, r.date);
    if (!moves) continue;
    rows.push({ ...r, moves: { open: r2(moves.open), close: r2(moves.close), close3: r2(moves.close3) }, i: moves.i });
  }
  const byType = {};
  for (const t of HEADLINE_TYPES) { const list = rows.filter((r) => r.type === t); if (list.length) byType[t] = describeType(list); }
  return { v: ORACLE_VERSION, neverRecord: true, rows, byType, total: describeType(rows) };
}

// D4 + D5 + D6. Structures, risk and the noisy oracle. `barsOf(sym)` returns
// rows or columns (see barSeries); `ivRatioOf(sym)` the name's IV/RV ratio (optional).
export function structuresUnderOracle(replay, barsOf, { ivRatioOf = () => undefined, dte = ORACLE_DTE, stress = false } = {}) {
  const rows = [];
  const series = seriesOf(barsOf);
  for (const r of replay.rows) {
    const bars = series(r.sym);
    if (!bars) continue;
    const i = r.i;
    const proxy = ivProxy(bars.c, i - 1, ivRatioOf(r.sym));
    if (proxy == null) continue;
    const ivBefore = eventIv(proxy, { phase: "before" }), ivAfter = eventIv(proxy, { phase: "after", crushPct: stress ? 30 : 20 });
    const spot0 = bars.c[i - 1], spotClose = bars.c[i], spot3 = bars.c[i + 3], spotOpen = bars.o && bars.o[i] > 0 ? bars.o[i] : null;
    const out = { type: r.type, sym: r.sym, date: r.date, tag: r.tag, ivBefore: r2(ivBefore), pnl: {} };
    for (const structure of ORACLE_STRUCTURES) {
      const sides = structure === "straddle" ? ["both"] : ["call", "put"];
      out.pnl[structure] = {};
      for (const side of sides) {
        const pos = openPosition({ structure, side: side === "both" ? "call" : side, spot: spot0, iv: ivBefore, dte });
        if (!pos) continue;
        const mark = (spot, held) => (spot > 0 ? netOfCosts(markPosition(pos, { spot, iv: ivAfter, sessionsHeld: held }), structure, { stress }) : null);
        out.pnl[structure][side] = { open: spotOpen != null ? mark(spotOpen, 0.3) : null, close: mark(spotClose, 1), close3: spot3 > 0 ? mark(spot3, 4) : null };
      }
    }
    rows.push(out);
  }
  const sideFor = (tag) => (tag > 0 ? "call" : "put");
  const byType = {};
  for (const t of HEADLINE_TYPES) {
    const list = rows.filter((r) => r.type === t);
    if (!list.length) continue;
    const signed = list.filter((r) => r.tag !== 0);
    const perStructure = {};
    let best = null;
    for (const structure of ORACLE_STRUCTURES) {
      const pick = (r, exit) => (structure === "straddle" ? r.pnl.straddle?.both?.[exit] : r.pnl[structure]?.[sideFor(r.tag)]?.[exit]);
      const base = structure === "straddle" ? list : signed;
      const close = base.map((r) => pick(r, "close")).filter(Number.isFinite), c3 = base.map((r) => pick(r, "close3")).filter(Number.isFinite);
      perStructure[structure] = { n: close.length, avgNetClose: r1(mean(close)), avgNetClose3: r1(mean(c3)), winPctClose: close.length ? Math.round((close.filter((x) => x > 0).length / close.length) * 100) : null, cost: COSTS[structure] * (stress ? 2 : 1) };
      if (perStructure[structure].avgNetClose != null && (best == null || perStructure[structure].avgNetClose > perStructure[best].avgNetClose)) best = structure;
    }
    // By IV level: the pre-event IV proxy's median within the type.
    const ivs = signed.map((r) => r.ivBefore).filter(Number.isFinite).sort((a, b) => a - b);
    const med = ivs.length ? ivs[Math.floor(ivs.length / 2)] : null;
    const byIv = {};
    if (med != null) {
      for (const [lvl, test] of [["low", (r) => r.ivBefore < med], ["high", (r) => r.ivBefore >= med]]) {
        const sub = signed.filter(test);
        let bestS = null, bestV = null;
        for (const structure of ["stock", "long", "debit_vertical"]) {
          const v = mean(sub.map((r) => r.pnl[structure]?.[sideFor(r.tag)]?.close).filter(Number.isFinite));
          if (v != null && (bestV == null || v > bestV)) { bestV = v; bestS = structure; }
        }
        byIv[lvl] = { n: sub.length, best: bestS, avgNet: r1(bestV), ivMedian: r2(med) };
      }
    }
    // D5. Risk: gap risk and time exits for the single option on the right side.
    const single = signed.map((r) => r.pnl.long?.[sideFor(r.tag)]).filter(Boolean);
    const opens = single.map((p) => p.open).filter(Number.isFinite), closes = single.map((p) => p.close).filter(Number.isFinite).sort((a, b) => a - b), c3s = single.map((p) => p.close3).filter(Number.isFinite);
    const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
    const afterEventStop = single.map((p) => (Number.isFinite(p.close) && p.close <= -50 ? p.close : p.close3)).filter(Number.isFinite);
    const risk = {
      gapPastStopPct: opens.length ? Math.round((opens.filter((x) => x <= -50).length / opens.length) * 100) : null,
      sizeAsStop: { avgNet: r1(mean(closes)), p10: r1(q(closes, 0.1)), p90: r1(q(closes, 0.9)), worst: r1(closes[0] ?? null), n: closes.length },
      timeExit: { close: r1(mean(closes)), close3: r1(mean(c3s)), stopAfterEventThenClose3: r1(mean(afterEventStop)) },
    };
    // D6. The noisy oracle, exact expectation: right-side vs wrong-side P&L.
    const noisy = {};
    for (const structure of ["stock", "long", "debit_vertical"]) {
      const right = signed.map((r) => r.pnl[structure]?.[sideFor(r.tag)]?.close).filter(Number.isFinite);
      const wrong = signed.map((r) => r.pnl[structure]?.[sideFor(-r.tag)]?.close).filter(Number.isFinite);
      const aC = mean(right), aW = mean(wrong);
      if (aC == null || aW == null) continue;
      const breakEven = aC > 0 && aW < 0 ? r1((aW / (aW - aC)) * 100) : aC <= 0 ? null : 0;
      noisy[structure] = { avgRight: r1(aC), avgWrong: r1(aW), breakEvenAccuracyPct: breakEven, atNoise: Object.fromEntries(NOISE_LEVELS.map((p) => [p, r1((1 - p / 100) * aC + (p / 100) * aW)])) };
    }
    byType[t] = { n: list.length, signed: signed.length, structures: perStructure, best, byIv, risk, noisy };
  }
  return { v: ORACLE_VERSION, neverRecord: true, stress, dte, rows: rows.map((r) => ({ type: r.type, sym: r.sym, date: r.date, tag: r.tag, ivBefore: r.ivBefore, long: r.pnl.long, stock: r.pnl.stock })), byType };
}

// D7. The engine's event plays and waits against the oracle's choice.
//   trades: Track Record closed trades with eventPlay { kind }, entryDate, side, optionPnlPct, symbol
//   waits:  [{ sym, date }] names the engine deferred for an event (archive)
export function engineVsOracle({ trades = [], waits = [], replay = null, structures = null, cal = [] } = {}) {
  if (!replay) return null;
  const index = new Map();
  for (const r of replay.rows) index.set(`${r.sym}|${r.date}`, r);
  const structRows = new Map((structures?.rows || []).map((r) => [`${r.sym}|${r.date}`, r]));
  const near = (sym, date) => {
    const i = cal.indexOf(String(date || "").slice(0, 10));
    for (let k = -1; k <= 6; k++) { const d = cal[i + k]; if (!d) continue; const hit = index.get(`${sym}|${d}`) || (sym !== "SPY" ? null : index.get(`SPY|${d}`)); if (hit) return hit; }
    return null;
  };
  const matched = [];
  for (const t of trades) {
    if (!t?.eventPlay?.kind || !t.symbol || !t.entryDate) continue;
    const sym = t.eventPlay.kind === "earnings" ? t.symbol : "SPY";
    const row = near(sym, t.entryDate);
    if (!row) continue;
    const sideSign = t.side === "put" ? -1 : 1;
    const s = structRows.get(`${row.sym}|${row.date}`);
    const oracleNet = s?.long?.[row.tag > 0 ? "call" : row.tag < 0 ? "put" : null]?.close3 ?? null;
    matched.push({ id: t.id || `${t.symbol}-${t.entryDate}`, kind: t.eventPlay.kind, type: row.type, agree: row.tag === 0 ? null : sideSign === row.tag, enginePnl: num(t.optionPnlPct), oracleNet, tag: row.tag });
  }
  const waitRows = [];
  for (const w of waits) { const row = near(w.sym, w.date); if (!row || row.tag === 0) continue; const s = structRows.get(`${row.sym}|${row.date}`); waitRows.push({ sym: w.sym, date: w.date, type: row.type, obviousNet: s?.long?.[row.tag > 0 ? "call" : "put"]?.close3 ?? null }); }
  const byType = {};
  for (const t of HEADLINE_TYPES) {
    const m = matched.filter((x) => x.type === t);
    if (!m.length) continue;
    const judged = m.filter((x) => x.agree != null);
    byType[t] = { n: m.length, agreePct: judged.length ? Math.round((judged.filter((x) => x.agree).length / judged.length) * 100) : null, engineAvgPnl: r1(mean(m.map((x) => x.enginePnl))), oracleAvgNet: r1(mean(m.map((x) => x.oracleNet))) };
  }
  const obvious = waitRows.map((x) => x.obviousNet).filter(Number.isFinite);
  return { v: ORACLE_VERSION, neverRecord: true, matched: matched.length, byType, waits: { n: waitRows.length, avgObviousNet: r1(mean(obvious)), goodWaitPct: obvious.length ? Math.round((obvious.filter((x) => x <= 0).length / obvious.length) * 100) : null } };
}

// D8. The ceiling beside the live return in the same window.
export function oracleCeiling({ structures = null, liveTrades = [], from = null, to = null } = {}) {
  if (!structures) return null;
  const inWin = (d) => (!from || d >= from) && (!to || d <= to);
  const rows = structures.rows.filter((r) => r.tag !== 0 && inWin(r.date));
  const nets = rows.map((r) => r.long?.[r.tag > 0 ? "call" : "put"]?.close3).filter(Number.isFinite);
  const live = liveTrades.filter((t) => t && (t.outcome === "win" || t.outcome === "loss") && num(t.optionPnlPct) != null && inWin(String(t.entryDate || "").slice(0, 10))).map((t) => num(t.optionPnlPct));
  const oracleAvg = mean(nets), liveAvg = mean(live);
  return { neverRecord: true, from, to, oracle: { n: nets.length, avgNet: r1(oracleAvg), structure: "single option, right side, exit three sessions after" }, live: { n: live.length, avgPnl: r1(liveAvg) }, sharePct: oracleAvg > 0 && liveAvg != null ? Math.round((liveAvg / oracleAvg) * 100) : null, note: "Perfect foresight of the headline, not of the move. A ceiling, never a track record." };
}

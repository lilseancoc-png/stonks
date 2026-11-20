// Self-improving loop: the calibration model behind every estimate (L1, S1,
// S2). Spec: docs/self-loop.md.
//
// A count table, not a fitted curve. Every resolved ledger row (its stock
// outcome joined from picks-outcomes.json, its option outcome modeled in
// lib/self-loop/ledger.mjs) is counted into four nested cells:
//
//   all                         every resolved row
//   band                        |total| in whole points (9 = 9+)
//   band x side                 calls and puts apart
//   band x side x market type   risk-on / neutral / risk-off
//
// An estimate starts at the finest cell and is shrunk toward the cell above
// it with SHRINK_K pseudo-samples, all the way up to a coin-flip prior. So a
// cell with 5 rows says almost what its parent says, and a cell with 300 rows
// mostly speaks for itself. Nothing is fitted on the row being estimated:
// the model is built from rows whose run date is before the day it is used
// (walk-forward), and the bake rebuilds it on every Top Picks run.
//
// The option outcome (+25% before -50%) is counted only once its whole
// window (OPTION_MAX_SESSIONS completed sessions after the run day) is over.
// A row is decided on the day it first touches +25% or -50%, so counting
// every row decided so far over-weights the fast outcomes of the newest runs
// (in a falling market the quick take-profits came first and the stops a few
// days later: rows stated near 94% then settled near 36%). The stock moves
// (5/10/20 sessions) have fixed windows and need no such cut.
//
// Pure, no network, no AI.

import { OPTION_MAX_SESSIONS } from "./ledger.mjs";
import { sessionForDate } from "../us-equity-calendar.mjs";

export const CALIBRATION_VERSION = 2;
export const SHRINK_K = 20;
export const PRIOR = Object.freeze({ p: 0.5, move: 0, pTp: 0.5, net: 0 });
export const MIN_ROWS_FOR_ESTIMATE = 200;  // below this every estimate is labeled "learning"

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null); // + 0 turns -0 into 0

function emptyAgg() {
  return { n5: 0, u5: 0, n10: 0, u10: 0, s10: 0, n20: 0, u20: 0, no: 0, tp: 0, win: 0, net: 0, winSum: 0, lossSum: 0, losses: 0 };
}

// Completed sessions strictly after `from` and strictly before `to` (both
// YYYY-MM-DD ET dates; `to` is the day the model is used, whose own session
// is not over). A year outside the published closure table counts weekdays.
export function sessionsBetween(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || !(from < to)) return 0;
  const d = new Date(`${from}T12:00:00Z`), end = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(end)) return 0;
  let n = 0;
  for (let i = 0; i < 400; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() >= end) break;
    const key = d.toISOString().slice(0, 10);
    const s = sessionForDate(key);
    if (s ? s.open : d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

// True when the row's option window is over by `before`, so its outcome is
// counted whatever it was. Without `before` (an offline fit) every row counts.
export function optionWindowOver(row, before, sessions = OPTION_MAX_SESSIONS) {
  if (!before) return true;
  return sessionsBetween(row?.d, before) >= sessions;
}

function add(agg, row, { countOption = true } = {}) {
  if (row.y5 != null) { agg.n5++; if (row.y5 > 0) agg.u5++; }
  if (row.y10 != null) { agg.n10++; agg.s10 += row.y10; if (row.y10 > 0) agg.u10++; }
  if (row.y20 != null) { agg.n20++; if (row.y20 > 0) agg.u20++; }
  if (countOption && row.opt && row.opt.net != null) {
    agg.no++;
    if (row.opt.res === "tp") agg.tp++;
    agg.net += row.opt.net;
    if (row.opt.net > 0) { agg.win++; agg.winSum += row.opt.net; } else { agg.losses++; agg.lossSum += row.opt.net; }
  }
}

export function cellKeys({ band, side, mk }) {
  const b = Number.isFinite(band) ? band : 0;
  const keys = ["all", `b${b}`];
  if (side === "call" || side === "put") {
    keys.push(`b${b}|${side}`);
    if (mk) keys.push(`b${b}|${side}|${mk}`);
  }
  return keys;
}

// rows: lib/self-loop/ledger.mjs joinedRows output. before: an ET date; only
// rows with an earlier run date are counted (walk-forward). useBase: count
// by the untuned total (tot0) so a live weight change cannot score itself.
export function fitCalibration(rows, { before = null, useBase = false } = {}) {
  const cells = {};
  let n = 0;
  for (const row of rows || []) {
    if (before && !(row.d < before)) continue;
    const countOption = !!row.opt && optionWindowOver(row, before);
    if (row.y5 == null && row.y10 == null && row.y20 == null && !countOption) continue;
    const tot = useBase && row.tot0 != null ? row.tot0 : row.tot;
    const band = Math.min(9, Math.floor(Math.abs(num(tot) ?? 0)));
    for (const k of cellKeys({ band, side: row.side, mk: row.mk })) {
      if (!cells[k]) cells[k] = emptyAgg();
      add(cells[k], row, { countOption });
    }
    n++;
  }
  return { v: CALIBRATION_VERSION, before, rows: n, k: SHRINK_K, cells };
}

function shrinkRate(hits, n, prior, k) { return (hits + k * prior) / (n + k); }
function shrinkMean(sum, n, prior, k) { return (sum + k * prior) / (n + k); }

// The estimate for one setup. Returns percent values and `n`, the rows in the
// finest cell that had any (0 = pure prior), plus `learning` while the model
// holds fewer than MIN_ROWS_FOR_ESTIMATE rows.
export function estimateFor(model, setup) {
  const k = model?.k || SHRINK_K;
  let p5 = PRIOR.p, p10 = PRIOR.p, p20 = PRIOR.p, mv = PRIOR.move, pTp = PRIOR.pTp, net = PRIOR.net, pWin = PRIOR.p;
  let avgWin = null, avgLoss = null, n = 0, cell = null;
  for (const key of cellKeys(setup || {})) {
    const a = model?.cells?.[key];
    if (!a) continue;
    p5 = shrinkRate(a.u5, a.n5, p5, k);
    p10 = shrinkRate(a.u10, a.n10, p10, k);
    p20 = shrinkRate(a.u20, a.n20, p20, k);
    mv = shrinkMean(a.s10, a.n10, mv, k);
    pTp = shrinkRate(a.tp, a.no, pTp, k);
    net = shrinkMean(a.net, a.no, net, k);
    pWin = shrinkRate(a.win, a.no, pWin, k);
    if (a.win) avgWin = a.winSum / a.win;
    if (a.losses) avgLoss = a.lossSum / a.losses;
    n = Math.max(a.n10, a.no);
    cell = key;
  }
  return {
    p5: r1(p5 * 100), p10: r1(p10 * 100), p20: r1(p20 * 100), em10: r2(mv), pTp: r1(pTp * 100),
    pWin: r1(pWin * 100), ev: r1(net), avgWin: r1(avgWin), avgLoss: r1(avgLoss), n, cell,
    learning: (model?.rows || 0) < MIN_ROWS_FOR_ESTIMATE,
  };
}

// The reliability read of a set of stated chances against what happened.
// pts: [{ p (0-100), y (true/false) }]. Brier score, the coin's 0.25, the
// base rate's score on the same rows, and ten bins of stated vs actual.
// `svb` is the skill against the base rate to four places (verdicts compare
// it; `skillVsBase` is the two-place display copy).
export function reliability(pts) {
  const list = (pts || []).filter((x) => x && Number.isFinite(x.p) && typeof x.y === "boolean");
  const n = list.length;
  if (!n) return { n: 0, brier: null, brierCoin: 0.25, brierBase: null, skill: null, bins: [] };
  let b = 0, ys = 0;
  for (const x of list) { const p = x.p / 100; b += (p - (x.y ? 1 : 0)) ** 2; if (x.y) ys++; }
  const base = ys / n;
  let bb = 0;
  for (const x of list) bb += (base - (x.y ? 1 : 0)) ** 2;
  const bins = [];
  for (let i = 0; i < 10; i++) {
    const lo = i * 10, hi = i === 9 ? 100.0001 : (i + 1) * 10;
    const inBin = list.filter((x) => x.p >= lo && x.p < hi);
    if (!inBin.length) continue;
    const said = inBin.reduce((s, x) => s + x.p, 0) / inBin.length;
    const got = (inBin.filter((x) => x.y).length / inBin.length) * 100;
    bins.push({ lo, hi: Math.min(100, hi), n: inBin.length, said: r1(said), got: r1(got) });
  }
  const brier = b / n;
  return { n, brier: Math.round(brier * 10000) / 10000, brierCoin: 0.25, brierBase: Math.round((bb / n) * 10000) / 10000, skill: r2(1 - brier / 0.25), skillVsBase: bb > 0 ? r2(1 - b / bb) : null, svb: bb > 0 ? Math.round((1 - b / bb) * 10000) / 10000 + 0 : null, baseRate: r1(base * 100), bins };
}

// A compact copy of the model for the Owner view: the band x side cells only.
export function modelTable(model) {
  const out = [];
  for (let b = 0; b <= 9; b++) {
    for (const side of ["call", "put"]) {
      const e = estimateFor(model, { band: b, side });
      const a = model?.cells?.[`b${b}|${side}`] || null;
      out.push({ band: b, side, n10: a ? a.n10 : 0, nOpt: a ? a.no : 0, p10: e.p10, em10: e.em10, pTp: e.pTp, ev: e.ev });
    }
  }
  return out;
}

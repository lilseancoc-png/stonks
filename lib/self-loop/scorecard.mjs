// Self-improving loop, step 3: compare estimates with what happened (L3) and
// audit every open-pick rule (L4). Spec: docs/self-loop.md.
//
// Reads the joined ledger rows (lib/self-loop/ledger.mjs joinedRows) and
// answers, from the engine's own written-down numbers:
//   - are the stated chances honest (reliability, Brier score)?
//   - how often does the grade's direction hold at 5 / 10 / 20 sessions, and
//     does a higher grade order names better (rank correlation per run)?
//   - how big are the moves next to the options' implied move?
//   - what would the planned option have made after costs, split by side,
//     market type, Regime Lab cell, event play, AI verdict and outcome?
//   - for each rule that turned a name away, did the names it stopped do
//     better or worse than the ones it let through (L4)?
//
// Pure, no network, no AI. Owner-only output.

import { reliability } from "./calibrate.mjs";
import { spearman } from "../picks-outcomes.mjs";

export const SCORECARD_VERSION = 1;
export const HISTORY_KEEP = 400;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null); // + 0 turns -0 into 0
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 + 0 : null); // + 0 turns -0 into 0
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export { spearman };
export function tStat(xs) {
  if (xs.length < 3) return null;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return v > 0 ? m / Math.sqrt(v / xs.length) : null;
}

// Direction read at one horizon: hit rate (moves that went the trade's way,
// flat moves left out) and the average signed move.
export function directionRead(rows, key = "y10") {
  let n = 0, hits = 0, nz = 0, sum = 0;
  for (const r of rows) {
    const y = r[key];
    if (y == null) continue;
    n++; sum += y;
    if (y !== 0) { nz++; if (y > 0) hits++; }
  }
  return { n, hit: nz ? r1((hits / nz) * 100) : null, avg: n ? r2(sum / n) : null };
}

// Option outcome read: rows with a modeled option result.
export function optionRead(rows) {
  const list = rows.filter((r) => r.opt && r.opt.net != null);
  const n = list.length;
  if (!n) return { n: 0, tp: null, stop: null, win: null, avg: null, avgWin: null, avgLoss: null };
  const tp = list.filter((r) => r.opt.res === "tp").length;
  const stop = list.filter((r) => r.opt.res === "stop").length;
  const wins = list.filter((r) => r.opt.net > 0);
  const losses = list.filter((r) => !(r.opt.net > 0));
  return {
    n, tp: r1((tp / n) * 100), stop: r1((stop / n) * 100), win: r1((wins.length / n) * 100),
    avg: r1(mean(list.map((r) => r.opt.net))), avgWin: wins.length ? r1(mean(wins.map((r) => r.opt.net))) : null,
    avgLoss: losses.length ? r1(mean(losses.map((r) => r.opt.net))) : null,
  };
}

// Run-level rank correlation of the grade total with the raw stock move. A
// put's total is negative, so ranking the total against the unsigned-by-side
// move reads calls and puts on one scale.
export function rankSkill(rows, key = "y10") {
  const byRun = new Map();
  for (const r of rows) {
    const y = r[key];
    if (y == null || r.tot == null) continue;
    const raw = r.side === "put" ? -y : y; // undo the side sign
    const k = `${r.d}|${r.et}`;
    if (!byRun.has(k)) byRun.set(k, { d: r.d, xs: [], ys: [] });
    const b = byRun.get(k);
    b.xs.push(r.tot); b.ys.push(raw);
  }
  const ics = [], dated = [];
  for (const b of byRun.values()) {
    const ic = spearman(b.xs, b.ys);
    if (ic != null) { ics.push(ic); dated.push({ d: b.d, ic }); }
  }
  if (!ics.length) return { runs: 0, avg: null, positive: null, t: null };
  // t on one run per horizon-length stride of dates, so overlapping windows
  // are not counted as independent.
  const stride = key === "y5" ? 5 : key === "y20" ? 20 : 10;
  dated.sort((a, b) => a.d.localeCompare(b.d));
  const days = [...new Set(dated.map((x) => x.d))];
  const keep = new Set(days.filter((_, i) => i % stride === 0));
  const indep = dated.filter((x) => keep.has(x.d)).map((x) => x.ic);
  return { runs: ics.length, avg: r3(mean(ics)), positive: r1((ics.filter((x) => x > 0).length / ics.length) * 100), t: r2(tStat(indep)), indep: indep.length };
}

function splitBy(rows, keyFn, order = null) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const keys = order ? order.filter((k) => groups.has(k)).concat([...groups.keys()].filter((k) => !order.includes(k))) : [...groups.keys()].sort();
  return keys.map((k) => ({ key: k, dir: directionRead(groups.get(k), "y10"), opt: optionRead(groups.get(k)) }));
}

// L4: every rule that turned a trade-grade name away, against the names the
// run let through (picked or opened). A positive `saved` means the names the
// rule stopped did worse than the ones let through, so the rule paid.
export function gateAudit(rows, { tradeBar = 4 } = {}) {
  const eligible = rows.filter((r) => Math.abs(r.tot ?? 0) >= tradeBar && r.opt && r.opt.net != null);
  const through = eligible.filter((r) => r.cls === "pick");
  const base = optionRead(through);
  const gates = new Map();
  for (const r of eligible) {
    if (r.cls !== "gate") continue;
    const g = String(r.out).slice(5) || "unknown";
    if (!gates.has(g)) gates.set(g, []);
    gates.get(g).push(r);
  }
  const out = [...gates.entries()].map(([gate, list]) => {
    const read = optionRead(list);
    const saved = read.avg != null && base.avg != null ? r1(base.avg - read.avg) : null;
    return { gate, ...read, saved, verdict: read.n < 20 || base.n < 20 ? "collecting" : saved > 2 ? "paying" : saved < -2 ? "costing" : "neutral" };
  }).sort((a, b) => b.n - a.n);
  return { bar: tradeBar, through: base, gates: out };
}

// Stated chance vs outcome for one horizon key ("p10" vs "y10").
function statedVsActual(rows, pKey, yKey, { onlyFitted = true } = {}) {
  return reliability(rows
    .filter((r) => r[pKey] != null && r[yKey] != null && r[yKey] !== 0 && (!onlyFitted || (r.pn ?? 0) > 0))
    .map((r) => ({ p: r[pKey], y: r[yKey] > 0 })));
}

// The scorecard. rows: joinedRows; tradeBar: PICKS_MIN_CONVICTION.
export function buildScorecard(rows, { tradeBar = 4 } = {}) {
  const all = rows || [];
  const days = [...new Set(all.map((r) => r.d))].sort();
  const resolved10 = all.filter((r) => r.y10 != null);
  const signal = all.filter((r) => Math.abs(r.tot ?? 0) >= 1);
  const trade = all.filter((r) => Math.abs(r.tot ?? 0) >= tradeBar);
  const moves = all.filter((r) => r.y10 != null && r.im10 != null && r.im10 > 0);
  const emRows = all.filter((r) => r.y10 != null && r.em10 != null && (r.pn ?? 0) > 0);
  return {
    v: SCORECARD_VERSION,
    rows: all.length, days: days.length, first: days[0] || null, last: days[days.length - 1] || null,
    resolved: { y5: all.filter((r) => r.y5 != null).length, y10: resolved10.length, y20: all.filter((r) => r.y20 != null).length, opt: all.filter((r) => r.opt).length },
    honesty: {
      p5: statedVsActual(all, "p5", "y5"),
      p10: statedVsActual(all, "p10", "y10"),
      p20: statedVsActual(all, "p20", "y20"),
      pTp: reliability(all.filter((r) => r.pTp != null && r.opt && (r.pn ?? 0) > 0).map((r) => ({ p: r.pTp, y: r.opt.res === "tp" }))),
    },
    direction: {
      all: { y5: directionRead(signal, "y5"), y10: directionRead(signal, "y10"), y20: directionRead(signal, "y20") },
      trade: { y5: directionRead(trade, "y5"), y10: directionRead(trade, "y10"), y20: directionRead(trade, "y20") },
    },
    rank: { y5: rankSkill(all, "y5"), y10: rankSkill(all, "y10"), y20: rankSkill(all, "y20") },
    moves: moves.length ? {
      n: moves.length,
      realized: r2(mean(moves.map((r) => Math.abs(r.y10)))),
      implied: r2(mean(moves.map((r) => r.im10))),
      ratio: r2(mean(moves.map((r) => Math.abs(r.y10))) / mean(moves.map((r) => r.im10))),
      emBias: emRows.length ? r2(mean(emRows.map((r) => r.y10 - r.em10))) : null,
      emMae: emRows.length ? r2(mean(emRows.map((r) => Math.abs(r.y10 - r.em10)))) : null,
      emN: emRows.length,
    } : { n: 0 },
    options: {
      trade: optionRead(trade),
      bySide: splitBy(trade, (r) => r.side, ["call", "put"]),
      byMarket: splitBy(trade, (r) => r.mk, ["risk-on", "neutral", "risk-off"]),
      byCell: splitBy(trade, (r) => r.cell),
      byEvent: splitBy(trade, (r) => r.ep || "none"),
      byVerdict: splitBy(trade, (r) => r.ev || "not graded", ["buy-now", "wait", "not graded"]),
      byOutcome: splitBy(trade, (r) => r.cls, ["pick", "gate", "open", "below-bar", "other"]),
      byBand: splitBy(all.filter((r) => Math.abs(r.tot ?? 0) >= 1), (r) => String(Math.min(9, Math.floor(Math.abs(r.tot ?? 0)))), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
    },
    gates: gateAudit(all, { tradeBar }),
  };
}

// One history row per run date, appended as outcomes resolve: what the
// estimates scored on rows whose 10-session outcome is now known.
export function historyRows(rows) {
  const byDay = new Map();
  for (const r of rows || []) {
    if (r.y10 == null) continue;
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d).push(r);
  }
  const out = [];
  for (const [d, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sig = list.filter((r) => Math.abs(r.tot ?? 0) >= 1);
    const dir = directionRead(sig, "y10");
    const rel = reliability(list.filter((r) => r.p10 != null && r.y10 !== 0 && (r.pn ?? 0) > 0).map((r) => ({ p: r.p10, y: r.y10 > 0 })));
    const ic = rankSkill(list, "y10");
    const opt = optionRead(list.filter((r) => Math.abs(r.tot ?? 0) >= 4));
    out.push({ d, n: list.length, hit: dir.hit, avg: dir.avg, brier: rel.brier, ic: ic.avg, optAvg: opt.avg, optN: opt.n });
  }
  return out.slice(-HISTORY_KEEP);
}

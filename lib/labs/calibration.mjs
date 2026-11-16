// Calibration Lab (Owner-only, no AI, no fetch): one scorer for every chance,
// score and range the site states.
//
// Three kinds of source:
//   chance  a stated probability of a yes/no event (0..1). Scored with the
//           Brier score, its skill against always stating the average rate,
//           and a reliability table (stated vs what happened).
//   score   a number that should rank outcomes (a grade, a 0-100 setup
//           score) but is not a probability. Scored by how often a winner
//           outranks a loser (AUC) and the hit rate by score band.
//   range   a stated low-high range with a claimed coverage (a 50% band, the
//           option-implied earnings move). Scored by how often the result
//           landed inside.
// Every adapter below reads objects the bake already holds and returns plain
// rows; nothing here reads a file or a clock.

import { finite, round, mean, quantile, scoreForecasts, auc, coverage } from "./stats.mjs";

export const CALIBRATION_VERSION = 1;
export const CAL_MIN_N = 30;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const pct = (v) => (finite(v) ? Math.round(v * 100) : null);

// --- scorers ---------------------------------------------------------------------

export function scoreChance(src, { minN = CAL_MIN_N } = {}) {
  const rows = (src.rows || []).filter((r) => finite(r.p) && r.p >= 0 && r.p <= 1 && (r.y === 0 || r.y === 1));
  const out = { id: src.id, label: src.label, where: src.where || null, kind: "chance", event: src.event || null, note: src.note || null, n: rows.length };
  if (src.from) out.from = src.from;
  if (rows.length < minN) return { ...out, verdict: "few", read: `Only ${rows.length} graded so far; ${minN} are needed for a read.` };
  const s = scoreForecasts(rows.map((r) => r.p), rows.map((r) => r.y), { bins: rows.length >= 200 ? 8 : 5 });
  const stated = pct(s.meanP), happened = pct(s.rate), gap = s.meanP - s.rate;
  let verdict, read;
  if (s.skill != null && s.skill < -0.02) {
    verdict = "worse";
    read = `Worse than always saying ${happened}%. It stated ${stated}% on average and ${happened}% happened.`;
  } else if (Math.abs(gap) > 0.08 || (s.ece != null && s.ece > 0.1)) {
    verdict = gap > 0 ? "over" : gap < 0 ? "under" : "uneven";
    read = Math.abs(gap) > 0.08
      ? `${gap > 0 ? "Too high" : "Too low"}: it stated ${stated}% on average and ${happened}% happened.`
      : `Right on average (${stated}% stated, ${happened}% happened) but off inside the bands: high chances and low chances do not separate as stated.`;
  } else if (s.skill != null && s.skill >= 0.02) {
    verdict = "good";
    read = `Honest and useful: ${stated}% stated, ${happened}% happened, and it beats always saying the average.`;
  } else {
    verdict = "flat";
    read = `Honest on average (${stated}% stated, ${happened}% happened) but no better than always saying ${happened}%.`;
  }
  return {
    ...out, rate: round(s.rate, 3), stated: round(s.meanP, 3), brier: round(s.brier, 4), skill: round(s.skill, 3),
    auc: round(s.auc, 3), ece: round(s.ece, 3),
    bins: (s.bins || []).map((b) => ({ p: round(b.p, 3), hit: round(b.hit, 3), n: b.n })),
    verdict, read,
  };
}

export function scoreScore(src, { minN = CAL_MIN_N } = {}) {
  const rows = (src.rows || []).filter((r) => finite(r.s) && (r.y === 0 || r.y === 1));
  const out = { id: src.id, label: src.label, where: src.where || null, kind: "score", event: src.event || null, note: src.note || null, n: rows.length };
  if (rows.length < minN) return { ...out, verdict: "few", read: `Only ${rows.length} graded so far; ${minN} are needed for a read.` };
  const a = auc(rows.map((r) => r.s), rows.map((r) => r.y));
  const sorted = rows.slice().sort((x, y) => x.s - y.s);
  const groups = rows.length >= 90 ? 3 : 2;
  const bands = [];
  for (let g = 0; g < groups; g++) {
    const part = sorted.slice(Math.floor((g * sorted.length) / groups), Math.floor(((g + 1) * sorted.length) / groups));
    if (part.length) bands.push({ lo: round(part[0].s, 2), hi: round(part[part.length - 1].s, 2), n: part.length, hit: round(mean(part.map((r) => r.y)), 3) });
  }
  const rate = mean(rows.map((r) => r.y));
  // A rank-sum standard error under "no ranking skill".
  const n1 = rows.filter((r) => r.y === 1).length, n0 = rows.length - n1;
  const se = n1 && n0 ? Math.sqrt((n1 + n0 + 1) / (12 * n1 * n0)) : null;
  const z = se && a != null ? (a - 0.5) / se : null;
  let verdict, read;
  if (z == null) { verdict = "few"; read = "Every graded row ended the same way, so there is nothing to rank yet."; }
  else if (z >= 2) { verdict = "good"; read = `Higher scores did better: a winner outranked a loser ${pct(a)}% of the time.`; }
  else if (z <= -2) { verdict = "worse"; read = `Backwards: higher scores did worse (a winner outranked a loser only ${pct(a)}% of the time).`; }
  else { verdict = "flat"; read = `No clear ranking yet: a winner outranked a loser ${pct(a)}% of the time, which chance alone can produce.`; }
  return { ...out, rate: round(rate, 3), auc: round(a, 3), z: round(z, 2), bands, verdict, read };
}

export function scoreRange(src, { minN = CAL_MIN_N } = {}) {
  const rows = (src.rows || []).filter((r) => finite(r.lo) && finite(r.hi) && finite(r.actual));
  const out = { id: src.id, label: src.label, where: src.where || null, kind: "range", event: src.event || null, note: src.note || null, n: rows.length, claimed: src.claimed };
  if (rows.length < minN) return { ...out, verdict: "few", read: `Only ${rows.length} graded so far; ${minN} are needed for a read.` };
  const c = coverage(rows, src.claimed);
  const se = Math.sqrt((src.claimed * (1 - src.claimed)) / rows.length);
  const z = (c.hit - src.claimed) / se;
  let verdict, read;
  if (z < -2) { verdict = "over"; read = `Too narrow: the result landed inside ${pct(c.hit)}% of the time against ${pct(src.claimed)}% claimed.`; }
  else if (z > 2) { verdict = "under"; read = `Too wide: the result landed inside ${pct(c.hit)}% of the time against ${pct(src.claimed)}% claimed.`; }
  else { verdict = "good"; read = `About right: inside ${pct(c.hit)}% of the time against ${pct(src.claimed)}% claimed.`; }
  return { ...out, covered: round(c.hit, 3), z: round(z, 2), verdict, read };
}

export function scoreSource(src, opts) {
  if (src.kind === "score") return scoreScore(src, opts);
  if (src.kind === "range") return scoreRange(src, opts);
  return scoreChance(src, opts);
}

// --- adapters --------------------------------------------------------------------------

// The self-improving loop's stated chances (lib/self-loop/ledger.mjs joined
// rows: chances in percent, moves signed to the trade's side).
export function loopSources(joined) {
  const fitted = (joined || []).filter((r) => (r.pn ?? 0) > 0);
  const dir = (pKey, yKey, sessions) => ({
    id: `loop-${pKey}`, kind: "chance", label: `Loop: stock moves the grade's way in ${sessions} sessions`, where: "Owner Lab, Loop",
    event: `Stock up (call) or down (put) after ${sessions} sessions`,
    rows: fitted.filter((r) => r[pKey] != null && r[yKey] != null && r[yKey] !== 0).map((r) => ({ p: r[pKey] / 100, y: r[yKey] > 0 ? 1 : 0, t: r.d })),
  });
  return [
    dir("p5", "y5", 5), dir("p10", "y10", 10), dir("p20", "y20", 20),
    {
      id: "loop-pTp", kind: "chance", label: "Loop: planned option reaches +25% before -50%", where: "Owner Lab, Loop",
      event: "Option hits the take-profit before the stop",
      rows: fitted.filter((r) => r.pTp != null && r.opt).map((r) => ({ p: r.pTp / 100, y: r.opt.res === "tp" ? 1 : 0, t: r.d })),
    },
  ];
}

const AI_TIER = { strong: 3, moderate: 2, weak: 1 };
const decided = (closed) => (closed || []).filter((c) => c && (c.outcome === "win" || c.outcome === "loss") && c.counted !== false);

// The Top Picks record: the contract's chance of profit, the grade and the AI
// grader's score, each against whether the trade won.
export function recordSources(closed) {
  const rows = decided(closed);
  const win = (c) => (c.outcome === "win" ? 1 : 0);
  return [
    {
      id: "picks-pop", kind: "chance", label: "Top Picks: chance of profit shown on the contract", where: "Top Picks cards, Track Record",
      event: "Trade closed as a win",
      note: "The chance is for holding to expiry; trades close earlier at +25% or -50%, so a gap here is expected.",
      rows: rows.filter((c) => num(c.contract?.pop) != null).map((c) => ({ p: num(c.contract.pop) > 1 ? num(c.contract.pop) / 100 : num(c.contract.pop), y: win(c), t: String(c.entryDate || "").slice(0, 10) })),
    },
    {
      id: "picks-grade", kind: "score", label: "Top Picks: grade at entry", where: "Top Picks",
      event: "Trade closed as a win",
      rows: rows.filter((c) => num(c.score) != null).map((c) => ({ s: Math.abs(num(c.score)), y: win(c) })),
    },
    {
      // The record freezes the grader's tier (thesis.aiGrade), not its 0-100
      // score, so the tier is ranked: strong 3, moderate 2, weak 1.
      id: "picks-ai", kind: "score", label: "Top Picks: AI grader's grade at entry", where: "Top Picks",
      event: "Trade closed as a win",
      note: "The AI grader's tier at entry, ranked strong 3, moderate 2, weak 1.",
      rows: rows.map((c) => ({ s: num(c.aiScore ?? c.thesis?.aiScore) ?? AI_TIER[String(c.thesis?.aiGrade || "").toLowerCase()] ?? null, y: win(c) })).filter((r) => r.s != null),
    },
  ];
}

// Each strategy engine's 0-100 setup score against whether its trade won.
export function engineSources(engineClosed, names = {}) {
  const by = new Map();
  for (const t of engineClosed || []) {
    if (!t?.engine || num(t.score) == null || num(t.optionPnlPct) == null) continue;
    if (!by.has(t.engine)) by.set(t.engine, []);
    by.get(t.engine).push({ s: num(t.score), y: num(t.optionPnlPct) > 0 ? 1 : 0 });
  }
  return [...by.entries()].map(([id, rows]) => ({
    id: `engine-${id}`, kind: "score", label: `${names[id] || id} engine: setup score`, where: "Top Picks, engine tabs", event: "Trade closed with a gain", rows,
  }));
}

// Prediction-market prices the day before a contract settled, against how it
// settled. `log` is the lab's own running list ({ id, p, y }).
export function predictionSource(log) {
  return {
    id: "prediction-markets", kind: "chance", label: "Prediction markets: price the day before settlement", where: "Prediction markets",
    event: "Contract settled YES",
    rows: (log || []).filter((r) => finite(r.p) && (r.y === 0 || r.y === 1)).map((r) => ({ p: r.p, y: r.y })),
  };
}
// Fold newly settled contracts (prediction-odds.json `resolved`) into the log.
export function foldPredictionLog(log, resolved, keep = 3000) {
  const out = Array.isArray(log) ? log.slice() : [];
  const seen = new Set(out.map((r) => r.id));
  for (const c of resolved || []) {
    const before = num(c?.before);
    if (!c?.id || seen.has(c.id) || before == null || (c.result !== "yes" && c.result !== "no")) continue;
    out.push({ id: c.id, p: round(before / 100, 3), y: c.result === "yes" ? 1 : 0, d: String(c.resolvedAt || "").slice(0, 10) });
    seen.add(c.id);
  }
  return out.slice(-keep);
}

// Option-implied earnings moves against the move that followed. A straddle
// prices the average absolute move; a normal move lands inside its own average
// about 58% of the time, which is the coverage this range claims.
export function earningsMoveSource(store) {
  const rows = [];
  for (const [sym, events] of Object.entries(store?.tickers || store?.bySymbol || store?.symbols || {})) {
    const list = Array.isArray(events) ? events : Array.isArray(events?.events) ? events.events : [];
    for (const ev of list) {
      const implied = num(ev?.impliedMovePct), move = num(ev?.movePct ?? ev?.reactionPct ?? ev?.dayMovePct);
      if (implied == null || move == null || !(implied > 0)) continue;
      // Stored moves are fractions on some rows and percent on others.
      const m = Math.abs(move) < 1 && Math.abs(implied) >= 1 ? move * 100 : move;
      rows.push({ lo: -implied, hi: implied, actual: m, sym });
    }
  }
  return {
    id: "earnings-implied-move", kind: "range", claimed: 0.58, label: "Earnings: option-implied move (live stamps only)", where: "Earnings results, stock page",
    event: "Earnings-day move stayed inside the implied move", rows,
    note: "A straddle prices the average size of the move, and a move lands inside its own average about 58% of the time.",
  };
}

// The drawdown-odds models: their out-of-sample history, then the live log
// (chances stated at past builds whose windows have since closed).
export function drawdownSources(dd, liveRows = []) {
  const out = [];
  for (const t of dd?.targets || []) {
    if (!t.bins || !finite(t.skill)) continue;
    const binN = t.bins.reduce((n, b) => n + (b.n || 0), 0);
    const stated = binN ? t.bins.reduce((v, b) => v + b.p * (b.n || 0), 0) / binN : null;
    const less = `${Math.round(t.skill * 100)}% less error`;
    out.push({
      prebuilt: {
        id: `dd-${t.id}`, kind: "chance", label: `Market odds: ${t.label}`, where: "Owner Lab, Quant labs", event: t.label,
        n: t.tested, rate: t.base, stated: round(stated, 3), brier: t.brier, skill: t.skill, auc: t.auc, ece: t.ece, bins: t.bins, history: true,
        verdict: t.status === "working" ? "good" : t.status === "weak" ? "flat" : "worse",
        read: t.status === "working" ? `Beats always saying the average in eras it never saw (${less}).`
          : t.status === "weak" ? `A small edge over always saying the average (${less}); too small to lean on.`
          : "No better than always saying the average in eras it never saw.",
        note: `History test, ${dd.sampleFrom?.slice(0, 4)} to ${dd.asOf?.slice(0, 4)}: each era predicted by a model fitted on the others.`,
      },
    });
  }
  const byId = new Map();
  for (const r of liveRows) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  for (const [id, rows] of byId) {
    const t = (dd?.targets || []).find((x) => x.id === id);
    out.push({ id: `dd-live-${id}`, kind: "chance", label: `Market odds, live: ${t?.label || id}`, where: "Owner Lab, Quant labs", event: t?.label || id, rows });
  }
  return out;
}

// --- the lab -------------------------------------------------------------------------------

const VERDICT_ORDER = { worse: 0, over: 1, under: 1, uneven: 1, flat: 2, good: 3, few: 4 };

export function buildCalibrationLab(sources, opts = {}) {
  const rows = [];
  for (const src of sources || []) {
    if (!src) continue;
    try { rows.push(src.prebuilt ? src.prebuilt : scoreSource(src, opts)); } catch { /* one bad source never sinks the lab */ }
  }
  rows.sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 5) - (VERDICT_ORDER[b.verdict] ?? 5) || (b.n || 0) - (a.n || 0));
  const count = (v) => rows.filter((r) => (Array.isArray(v) ? v.includes(r.verdict) : r.verdict === v)).length;
  return {
    v: CALIBRATION_VERSION,
    sources: rows,
    summary: { total: rows.length, good: count("good"), off: count(["over", "under", "uneven", "worse"]), flat: count("flat"), few: count("few") },
  };
}

export const _test = { decided, quantile };

// Self-improving loop, step 2: figure out what is wrong (D1-D4).
// Spec: docs/self-loop.md.
//
// Reads the joined ledger rows (lib/self-loop/ledger.mjs joinedRows) and
// answers, from the engine's own logged numbers:
//   D1  which inputs still line up with the move, and which are fading or
//       now point the wrong way (rank correlation per run, newest 20 and 60
//       sessions against all of it)
//   D2  where the engine works: each market type and Regime Lab cell, and
//       which inputs work in one market and not another
//   D3  how losses happen: the setups that lose more often than the book,
//       and whether a loss was the wrong direction or the right direction
//       that still lost (time decay, a move too small or too slow)
//   D4  a weekly report, built once per week after the Friday close (or at
//       the next build when that one was missed), that compares this week's
//       read with last week's and lists what to look at next
//
// Pure, no network, no AI. Nothing here changes a pick, a grade or the
// Track Record; the report only names candidates for the challenger books
// (step 3) and the bounded live settings (step 4).

import { spearman } from "../picks-outcomes.mjs";
import { reliability } from "./calibrate.mjs";
import { directionRead, optionRead, stridedDailyMeans, tStat } from "./scorecard.mjs";
import { tradeGrade } from "./ledger.mjs";

export const DIAGNOSE_VERSION = 1;
export const REPORTS_KEEP = 26;
export const MIN_RUNS_FOR_DECAY = 10;      // run dates in the newest window before a status is given
export const MIN_PATTERN_N = 15;           // names behind a loss pattern before it is named
export const PILLAR_LABEL = Object.freeze({ f: "Fundamentals pillar", t: "Technicals pillar", m: "Mechanicals pillar", n: "Narrative pillar", iv: "IV cost", rg: "Market overlay" });

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 + 0 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// The stock's own move, with the side sign undone (inputs vote bullish +).
const rawMove = (r, key) => (r[key] == null ? null : r.side === "put" ? -r[key] : r[key]);

// Every input a row carries: its signal votes, and its pillar scores as "P:x".
function inputsOf(r) {
  const out = {};
  if (r.sig) for (const [k, v] of Object.entries(r.sig)) if (num(v) != null) out[k] = num(v);
  if (r.pl) for (const [k, v] of Object.entries(r.pl)) if (num(v) != null) out[`P:${k}`] = num(v);
  return out;
}

// Per run, per input: rank correlation of the input with the stock move over
// every name in the run. A name without a vote counts as 0 (no vote).
export function inputIcByRun(rows, key = "y5") {
  const runs = new Map();
  for (const r of rows || []) {
    const y = rawMove(r, key);
    if (y == null) continue;
    const k = `${r.d}|${r.et}`;
    if (!runs.has(k)) runs.set(k, { d: r.d, mk: r.mk || null, cell: r.cell || null, names: [] });
    runs.get(k).names.push({ x: inputsOf(r), y });
  }
  const out = [];
  for (const run of runs.values()) {
    if (run.names.length < 5) continue;
    const keys = new Set();
    for (const n of run.names) for (const k of Object.keys(n.x)) keys.add(k);
    const ic = {};
    for (const k of keys) {
      const xs = run.names.map((n) => n.x[k] ?? 0);
      if (new Set(xs).size < 2) continue;
      const v = spearman(xs, run.names.map((n) => n.y));
      if (v != null) ic[k] = v;
    }
    out.push({ d: run.d, mk: run.mk, cell: run.cell, ic });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

// Average IC of one input over a list of runs, with the share positive and a
// t value on one date per `stride` dates (overlapping horizons are not
// independent; the two runs of a kept date count once, averaged).
function icRead(runs, k, stride) {
  const list = runs.filter((r) => r.ic[k] != null);
  if (!list.length) return { runs: 0, days: 0, avg: null, positive: null, t: null };
  const vals = list.map((r) => r.ic[k]);
  const days = [...new Set(list.map((r) => r.d))];
  const indep = stridedDailyMeans(list.map((r) => ({ d: r.d, ic: r.ic[k] })), stride);
  return { runs: list.length, days: days.length, avg: r3(mean(vals)), positive: r1((vals.filter((v) => v > 0).length / vals.length) * 100), t: r2(tStat(indep)) };
}

const newestDays = (runs, n) => {
  const days = [...new Set(runs.map((r) => r.d))].sort();
  const keep = new Set(days.slice(-n));
  return runs.filter((r) => keep.has(r.d));
};

// D1: input decay. Status per input from the newest 20 sessions against the
// newest 60 and all of it (5-session moves, the quickest read).
export function inputDecay(rows) {
  const runs5 = inputIcByRun(rows, "y5");
  const runs10 = inputIcByRun(rows, "y10");
  const keys = new Set();
  for (const r of runs5) for (const k of Object.keys(r.ic)) keys.add(k);
  const recent20 = newestDays(runs5, 20), recent60 = newestDays(runs5, 60);
  const out = [];
  for (const k of keys) {
    const all = icRead(runs5, k, 5), w60 = icRead(recent60, k, 5), w20 = icRead(recent20, k, 5), all10 = icRead(runs10, k, 10);
    let status = "quiet";
    if (w20.days < MIN_RUNS_FOR_DECAY) status = "collecting";
    else if (w20.avg <= -0.03 && w20.positive <= 35) status = "against";
    else if (w60.avg >= 0.02 && w20.avg <= 0) status = "fading";
    else if (w20.avg >= 0.03 && w20.positive >= 60) status = "working";
    out.push({ key: k, pillar: k.startsWith("P:"), all, w60, w20, all10, status });
  }
  const order = { against: 0, fading: 1, working: 2, quiet: 3, collecting: 4 };
  return out.sort((a, b) => (order[a.status] - order[b.status]) || ((b.w20.days || 0) - (a.w20.days || 0)) || a.key.localeCompare(b.key));
}

// D2: where the engine works. Direction, rank skill, honesty and the modeled
// option per market type and per Regime Lab cell, plus each input's IC by
// market type with the inputs that flip sign between markets.
export function marketSplits(rows, { tradeBar = 4 } = {}) {
  const runs10 = inputIcByRun(rows, "y10");
  const totalIc = (list) => {
    const byRun = new Map();
    for (const r of list) {
      const y = rawMove(r, "y10");
      if (y == null || r.tot == null) continue;
      const k = `${r.d}|${r.et}`;
      if (!byRun.has(k)) byRun.set(k, { xs: [], ys: [] });
      byRun.get(k).xs.push(r.tot); byRun.get(k).ys.push(y);
    }
    const ics = [...byRun.values()].map((b) => spearman(b.xs, b.ys)).filter((v) => v != null);
    return { runs: ics.length, avg: r3(mean(ics)) };
  };
  const group = (keyFn, order) => {
    const m = new Map();
    for (const r of rows || []) { const k = keyFn(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    const keys = order ? order.filter((k) => m.has(k)).concat([...m.keys()].filter((k) => !order.includes(k)).sort()) : [...m.keys()].sort();
    return keys.map((k) => {
      const list = m.get(k);
      const trade = list.filter((r) => tradeGrade(r, tradeBar));
      const rel = reliability(list.filter((r) => r.p10 != null && r.y10 != null && r.y10 !== 0 && (r.pn ?? 0) > 0).map((r) => ({ p: r.p10, y: r.y10 > 0 })));
      return { key: k, n: list.length, dir: directionRead(trade, "y10"), rank: totalIc(list), brier: rel.brier, brierBase: rel.brierBase, opt: optionRead(trade) };
    });
  };
  const mkOrder = ["risk-on", "neutral", "risk-off"];
  // Input IC by market type.
  const keys = new Set();
  for (const r of runs10) for (const k of Object.keys(r.ic)) keys.add(k);
  const inputs = [];
  for (const k of keys) {
    const by = {};
    for (const mk of mkOrder) by[mk] = icRead(runs10.filter((r) => r.mk === mk), k, 10);
    const reads = mkOrder.filter((mk) => by[mk].days >= MIN_RUNS_FOR_DECAY && by[mk].avg != null);
    const hi = reads.filter((mk) => by[mk].avg >= 0.03), lo = reads.filter((mk) => by[mk].avg <= -0.03);
    inputs.push({ key: k, by, flips: hi.length && lo.length ? { works: hi, against: lo } : null });
  }
  inputs.sort((a, b) => (b.flips ? 1 : 0) - (a.flips ? 1 : 0) || a.key.localeCompare(b.key));
  return { byMarket: group((r) => r.mk, mkOrder), byCell: group((r) => r.cell), inputs };
}

const bandBucket = (r) => { const a = Math.abs(r.tot ?? 0); return a >= 8 ? "8+" : a >= 6 ? "6-7" : "4-5"; };
const ivBucket = (r) => (r.im10 == null ? null : r.im10 < 5 ? "under 5%" : r.im10 < 8 ? "5-8%" : r.im10 < 12 ? "8-12%" : "12%+");
const FEATURES = [
  ["side", (r) => r.side],
  ["market", (r) => r.mk],
  ["cell", (r) => r.cell],
  ["event", (r) => r.ep || "none"],
  ["AI call", (r) => r.ev || "not graded"],
  ["grade", bandBucket],
  ["implied move", ivBucket],
  ["outcome", (r) => r.cls],
  ["side x market", (r) => (r.mk ? `${r.side} / ${r.mk}` : null)],
  ["side x cell", (r) => (r.cell ? `${r.side} / ${r.cell}` : null)],
  ["side x grade", (r) => `${r.side} / ${bandBucket(r)}`],
];

// D3: how losses happen, and which setups lose more often than the book.
export function lossPatterns(rows, { tradeBar = 4, minN = MIN_PATTERN_N } = {}) {
  const list = (rows || []).filter((r) => tradeGrade(r, tradeBar) && r.opt && r.opt.net != null);
  const n = list.length;
  if (!n) return { n: 0, lossRate: null, avg: null, how: null, worst: [], best: [] };
  const isLoss = (r) => !(r.opt.net > 0);
  const losses = list.filter(isLoss);
  const lossRate = losses.length / n;
  const avg = mean(list.map((r) => r.opt.net));
  // How the losses happened.
  const y = (r) => (r.y10 != null ? r.y10 : r.y5);
  const how = {
    losses: losses.length,
    fastStop: losses.filter((r) => r.opt.res === "stop" && (r.opt.days ?? 99) <= 3).length,
    slowStop: losses.filter((r) => r.opt.res === "stop" && (r.opt.days ?? 0) > 3).length,
    timedOut: losses.filter((r) => r.opt.res === "t20" || r.opt.res === "exp").length,
    wrongWay: losses.filter((r) => y(r) != null && y(r) <= 0).length,
    rightWayLost: losses.filter((r) => y(r) != null && y(r) > 0).length,
  };
  const groups = [];
  for (const [feature, fn] of FEATURES) {
    const m = new Map();
    for (const r of list) { const k = fn(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    if (m.size < 2) continue;
    for (const [value, g] of m) {
      if (g.length < minN || g.length === n) continue;
      const lr = g.filter(isLoss).length / g.length;
      const ga = mean(g.map((r) => r.opt.net));
      groups.push({ feature, value: String(value), n: g.length, lossRate: r1(lr * 100), avg: r1(ga), lift: r2(lossRate > 0 ? lr / lossRate : null), gap: r1(ga - avg) });
    }
  }
  const worst = groups.filter((g) => g.gap <= -3 && g.lift >= 1.1).sort((a, b) => a.gap - b.gap).slice(0, 8);
  const best = groups.filter((g) => g.gap >= 3).sort((a, b) => b.gap - a.gap).slice(0, 5);
  return { n, lossRate: r1(lossRate * 100), avg: r1(avg), how, worst, best };
}

// The diagnosis block of the view.
export function buildDiagnosis(rows, { tradeBar = 4 } = {}) {
  return { v: DIAGNOSE_VERSION, inputs: inputDecay(rows), markets: marketSplits(rows, { tradeBar }), losses: lossPatterns(rows, { tradeBar }) };
}

// ---- D4: the weekly report ------------------------------------------------------------------

function etParts(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, wd, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (date) => { const wd = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, wd === 0 ? -6 : 1 - wd); };

// The week a report is due for at this build, or null. The Friday close
// (16:00 ET) finishes a week; a build later than that, in the same week or a
// later one, reports the newest finished week. A week before the loop started
// is never reported, and nothing is reported before the first Top Picks run
// has written an estimate (startedAt): a report then would be empty and
// would start a challenger on no evidence.
export function reportWeekDue(builtAtIso, { lastWeek = null, startedAt = null } = {}) {
  if (!startedAt) return null;
  const now = etParts(builtAtIso);
  if (!now) return null;
  const mon = mondayOf(now.date);
  const finishedThisWeek = now.wd === 6 || now.wd === 0 || (now.wd === 5 && now.minutes >= 16 * 60);
  const week = finishedThisWeek ? mon : addDays(mon, -7);
  if (lastWeek && week <= lastWeek) return null;
  const start = String(startedAt).slice(0, 10);
  if (addDays(week, 4) < start) return null;
  return week;
}

// Readable name of an input key: "P:f" -> "Fundamentals pillar",
// "analystRevisions" -> "analyst revisions".
export function inputLabel(key) {
  const k = String(key || "");
  if (k.startsWith("P:")) return PILLAR_LABEL[k.slice(2)] || k;
  return k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

// One week's report: the headline reads now, the change since last week, and
// the plain-language list of what to look at. `prev` is the last report.
export function buildWeeklyReport({ week, builtAtIso, rows, scorecard, diagnosis, prev = null }) {
  const end = addDays(week, 4);
  const thisWeek = (rows || []).filter((r) => r.d >= week && r.d <= end);
  const sc = scorecard || {};
  const head = {
    brier10: sc.honesty?.p10?.brier ?? null,
    skill10: sc.honesty?.p10?.skillVsBase ?? null,
    hit10: sc.direction?.trade?.y10?.hit ?? null,
    rank10: sc.rank?.y10?.avg ?? null,
    optAvg: sc.options?.trade?.avg ?? null,
    optWin: sc.options?.trade?.win ?? null,
    graded10: sc.resolved?.y10 ?? 0,
  };
  const change = {};
  if (prev?.head) for (const [k, v] of Object.entries(head)) if (v != null && prev.head[k] != null) change[k] = r3(v - prev.head[k]);
  const items = [];
  const inputs = diagnosis?.inputs || [];
  for (const x of inputs.filter((i) => i.status === "against").slice(0, 3)) items.push({ kind: "input-against", key: x.key, text: `${inputLabel(x.key)} has pointed the wrong way over the last ${x.w20.days} sessions (rank correlation ${x.w20.avg}, positive in ${x.w20.positive}% of runs). Candidate for a mute challenger.` });
  for (const x of inputs.filter((i) => i.status === "fading").slice(0, 3)) items.push({ kind: "input-fading", key: x.key, text: `${inputLabel(x.key)} worked over 60 sessions (${x.w60.avg}) but not over the last 20 (${x.w20.avg}). Watch it.` });
  for (const x of (diagnosis?.markets?.inputs || []).filter((i) => i.flips).slice(0, 3)) items.push({ kind: "input-flips", key: x.key, text: `${inputLabel(x.key)} works in ${x.flips.works.join(" and ")} markets and points the wrong way in ${x.flips.against.join(" and ")}. Candidate for a market-type weight.` });
  for (const p of (diagnosis?.losses?.worst || []).slice(0, 3)) items.push({ kind: "loss-pattern", key: `${p.feature}:${p.value}`, text: `${p.feature} ${p.value}: ${p.n} names, lost ${p.lossRate}% of the time, ${p.gap} points worse than the book after costs.` });
  for (const g of (sc.gates?.gates || []).filter((x) => x.verdict === "costing").slice(0, 2)) items.push({ kind: "rule-costing", key: g.gate, text: `The ${g.gate} rule turned away names that did ${g.saved != null ? Math.abs(g.saved) : "?"} points better than the ones let through (${g.n} names). Candidate for review.` });
  const how = diagnosis?.losses?.how;
  if (how && how.losses >= 20) {
    const rw = how.rightWayLost / how.losses;
    if (rw >= 0.4) items.push({ kind: "loss-shape", key: "right-way-lost", text: `${Math.round(rw * 100)}% of modeled losses had the stock going the trade's way: the option lost to time or a move too small. Candidate for a longer-dated or spread challenger.` });
    if (how.fastStop / how.losses >= 0.4) items.push({ kind: "loss-shape", key: "fast-stop", text: `${Math.round((how.fastStop / how.losses) * 100)}% of modeled losses were stopped within 3 sessions: entries may be late or too close to a turn.` });
  }
  if (head.skill10 != null && head.skill10 < -0.01) items.push({ kind: "odds", key: "brier", text: `The stated 10-session chances score worse than the base rate (${head.skill10}). The count model is still learning or the grade bands are not ordered.` });
  return {
    v: DIAGNOSE_VERSION, week, end, builtAt: builtAtIso,
    logged: { rows: thisWeek.length, runs: new Set(thisWeek.map((r) => `${r.d}|${r.et}`)).size },
    head, change, items,
    inputs: { against: inputs.filter((i) => i.status === "against").map((i) => i.key), fading: inputs.filter((i) => i.status === "fading").map((i) => i.key), working: inputs.filter((i) => i.status === "working").map((i) => i.key) },
    gates: (sc.gates?.gates || []).map((g) => pick(g, ["gate", "n", "saved", "verdict"])),
  };
}

// Add the due report, if any, to state.reports (newest last, REPORTS_KEEP kept).
export function maybeAddWeeklyReport(state, { builtAtIso, rows, scorecard, diagnosis }) {
  if (!state) return null;
  const reports = Array.isArray(state.reports) ? state.reports : [];
  const last = reports.length ? reports[reports.length - 1] : null;
  const week = reportWeekDue(builtAtIso, { lastWeek: last?.week || null, startedAt: state.startedAt });
  if (!week) return null;
  const report = buildWeeklyReport({ week, builtAtIso, rows, scorecard, diagnosis, prev: last });
  state.reports = reports.concat([report]).slice(-REPORTS_KEEP);
  return report;
}

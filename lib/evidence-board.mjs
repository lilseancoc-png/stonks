// Tests-and-gates board (2026-11-08).
//
// One place that answers "which questions about the engine are still open,
// how much evidence each one has, and when it can be decided". Every test
// here already had its evidence collected somewhere on the site; this file
// only reads those counts and puts a status, a projected decision date and a
// verdict rule next to each one. It never changes a pick, a grade or the
// record, makes no AI call and reads nothing a bake did not already load.
//
// Inputs come from the bake (build.mjs, after the Top Picks ledger is
// written): the outcome rows and random control book
// (lib/picks-outcomes.mjs), the Top Picks closed trades, the number of
// grades-daily snapshots that carry a shadow-signal block, and the rule
// versions in force. Output: evidence-board.json, Owner-only, rewritten by
// every full bake, drawn by the Owner Lab "Evidence" view.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarizeControl, summarizeOutcomes, seededRandom } from "./picks-outcomes.mjs";

export const EVIDENCE_BOARD_KEY = "evidence-board.json";
export const EVIDENCE_BOARD_VERSION = 1;

// Fixed dates the owners already agreed on (ET).
export const DIRECTION_SKILL_EARLY_LOOK = "2026-11-23";
export const DIRECTION_SKILL_FULL_TEST = "2026-12-07";
export const SHADOW_SIGNALS_START = "2026-10-26";
export const MACRO_CONTEXT_START = "2026-11-09";
export const SINGLES_DEFAULT_START = "2026-11-07";
export const EVENT_PLAYS_START = "2026-11-06";

// Evidence each test needs before it can be read.
export const NEEDS = Object.freeze({
  outcomeRuns: 20,          // decision runs with a 10-day outcome
  shadowDays: 40,           // trading days of shadow rows (40-60 agreed)
  macroTrades: 30,          // decided trades under the macro-context grade
  controlTrades: 30,        // decided random control trades
  controlPicks: 30,         // decided picks since the control started
  graderRows: 40,           // graded names at or above the trade bar with r10
  edgeTrades: 30,           // decided trades for the edge read
  recordTrades: 140,        // decided trades to judge the record (140-240)
  singlesTrades: 30,        // decided single-option trades under the policy
  eventTrades: 20,          // decided event plays
});

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateKey(iso) {
  if (typeof iso !== "string") return null;
  const d = iso.slice(0, 10);
  return DATE_RE.test(d) ? d : null;
}

function addDays(date, days) {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + Math.round(days) * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ta = Date.parse(`${a}T12:00:00Z`), tb = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

// When will `have` reach `need`, at the pace seen since `since`? Trading-day
// paces are stretched to calendar days (×7/5). Null while there is no pace.
export function projectDate({ have, need, since, today }) {
  if (!(need > 0) || have == null || !since || !today) return null;
  if (have >= need) return today;
  const elapsed = daysBetween(since, today);
  if (elapsed == null || elapsed < 3 || have <= 0) return null;
  const perDay = have / elapsed;
  if (!(perDay > 0)) return null;
  const remaining = (need - have) / perDay;
  return addDays(today, Math.min(730, Math.ceil(remaining)));
}

function decided(trades) {
  return trades.filter((t) => t && (t.outcome === "win" || t.outcome === "loss") && num(t.optionPnlPct) != null);
}

function winPct(list) {
  if (!list.length) return null;
  return Math.round((list.filter((t) => t.outcome === "win").length / list.length) * 100);
}

function avgPnl(list) {
  if (!list.length) return null;
  return r1(list.reduce((a, t) => a + num(t.optionPnlPct), 0) / list.length);
}

// Seeded bootstrap of the mean P&L: 2,000 resamples, 2.5th and 97.5th points.
export function bootstrapMean(values, seed = "edge") {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  const rnd = seededRandom(`${seed}|${xs.length}`);
  const means = [];
  for (let i = 0; i < 2000; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(rnd() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return { low: r1(means[Math.floor(means.length * 0.025)]), high: r1(means[Math.floor(means.length * 0.975)]), mean: r1(xs.reduce((a, b) => a + b, 0) / xs.length) };
}

function firstEntry(list) {
  const dates = list.map((t) => dateKey(t.entryDate)).filter(Boolean).sort();
  return dates[0] || null;
}

function statusFor({ have, need, verdict, fixedDate, today }) {
  if (verdict === "pass" || verdict === "fail" || verdict === "inconclusive") return verdict;
  if (fixedDate && today && today < fixedDate) return have > 0 ? "collecting" : "waiting";
  if (have >= need) return "ready";
  return have > 0 ? "collecting" : "waiting";
}

// The board. Every field a test shows is derived here so the browser only
// draws. `today` is the ET date of the bake.
export function buildEvidenceBoard({
  outcomes = null, closed = [], open = [], shadowDays = 0, builtAtIso = null,
  tradeBar = 4, gradeModelVersion = null, structurePolicyVersion = null, today = null,
} = {}) {
  const asOf = today || dateKey(builtAtIso) || new Date().toISOString().slice(0, 10);
  const trades = Array.isArray(closed) ? closed : [];
  const dec = decided(trades);
  const decPicks = dec.map((t) => ({ pnl: num(t.optionPnlPct), win: t.outcome === "win", entryDate: dateKey(t.entryDate) }));
  const outcomeSummary = outcomes ? summarizeOutcomes(outcomes, { tradeBar }) : null;
  const controlSummary = outcomes?.control ? summarizeControl(outcomes.control, decPicks) : null;
  const tests = [];

  // 1. Direction skill, early look and full test (fixed dates).
  const icRuns = outcomeSummary?.ic?.runs || 0;
  const icRead = outcomeSummary?.ic || null;
  for (const [id, name, date] of [["early-look", "Direction skill: early look", DIRECTION_SKILL_EARLY_LOOK], ["dec7-input-test", "Direction skill: full test", DIRECTION_SKILL_FULL_TEST]]) {
    let verdict = null;
    if (asOf >= date && icRuns >= NEEDS.outcomeRuns) {
      verdict = icRead.avg > 0.05 && icRead.positiveShare >= 60 ? "pass" : icRead.avg < -0.05 ? "fail" : "inconclusive";
    }
    // Past the date with too little evidence, the decision slides to the day
    // the current pace reaches the count; the fixed date stays as `due`.
    const overdue = asOf >= date && !verdict;
    tests.push({
      id, name, lane: "engine",
      question: "Does the grade order the day's names by what they do over the next two weeks?",
      start: outcomeSummary?.first || null, due: date,
      projected: !overdue ? date : projectDate({ have: icRuns, need: NEEDS.outcomeRuns, since: outcomeSummary?.first || null, today: asOf }),
      overdue,
      progress: { have: icRuns, need: NEEDS.outcomeRuns, unit: "runs with a 10-day outcome" },
      read: icRead ? { avgIc: icRead.avg, positiveShare: icRead.positiveShare } : null,
      rule: "Pass: average run-level rank correlation above 0.05 and positive in 60%+ of runs. Fail: below -0.05.",
      status: statusFor({ have: icRuns, need: NEEDS.outcomeRuns, verdict, fixedDate: date, today: asOf }), verdict,
    });
  }

  // 2. Shadow signals: logged-not-scored candidates.
  {
    const have = num(shadowDays) || 0;
    tests.push({
      id: "shadow-signals", name: "Shadow signals", lane: "signals",
      question: "Do the seven logged candidate signals predict anything worth promoting?",
      start: SHADOW_SIGNALS_START, due: null,
      projected: projectDate({ have, need: NEEDS.shadowDays, since: SHADOW_SIGNALS_START, today: asOf }),
      progress: { have, need: NEEDS.shadowDays, unit: "trading days of shadow rows" },
      read: null,
      rule: "Read at 40 to 60 trading days: a signal is promoted only with a positive 10-day read in both halves of the sample.",
      status: statusFor({ have, need: NEEDS.shadowDays, verdict: null, today: asOf }), verdict: null,
    });
  }

  // 3. Macro context grade: trades under the new grade version.
  {
    const macro = dec.filter((t) => t.gradeModelVersion === "2026-11-macro-context");
    const have = macro.length;
    const older = dec.filter((t) => t.gradeModelVersion && t.gradeModelVersion !== "2026-11-macro-context");
    tests.push({
      id: "macro-context", name: "Macro, cycle and rotation context", lane: "engine",
      question: "Do trades opened under the macro-context grade do better than the ones before it?",
      start: MACRO_CONTEXT_START, due: null,
      projected: projectDate({ have, need: NEEDS.macroTrades, since: firstEntry(macro) || MACRO_CONTEXT_START, today: asOf }),
      progress: { have, need: NEEDS.macroTrades, unit: "decided trades" },
      read: { winPct: winPct(macro), avgPnl: avgPnl(macro), priorWinPct: winPct(older), priorAvgPnl: avgPnl(older), priorN: older.length },
      rule: "Read at 30 decided trades: win rate and average P&L against the trades under the previous grade.",
      status: statusFor({ have, need: NEEDS.macroTrades, verdict: null, today: asOf }), verdict: null,
      active: gradeModelVersion === "2026-11-macro-context",
    });
  }

  // 4. Random control book.
  {
    const c = controlSummary;
    const haveC = c?.control?.n || 0, haveP = c?.picks?.n || 0;
    const have = Math.min(haveC, haveP);
    const need = Math.min(NEEDS.controlTrades, NEEDS.controlPicks);
    let verdict = null;
    if (haveC >= NEEDS.controlTrades && haveP >= NEEDS.controlPicks && c.beatsPct != null) {
      verdict = c.beatsPct >= 95 ? "pass" : c.beatsPct <= 50 ? "fail" : "inconclusive";
    }
    tests.push({
      id: "random-control", name: "Picks vs a random book", lane: "control",
      question: "Do the picks beat random names with random sides, same contracts and same exits?",
      start: c?.since ? dateKey(c.since) : null, due: null,
      projected: projectDate({ have, need, since: c?.since ? dateKey(c.since) : null, today: asOf }),
      progress: { have, need, unit: "decided trades in the smaller book", control: haveC, picks: haveP, open: c?.open || 0 },
      read: c ? { controlWinPct: c.control.winPct, controlAvgPnl: c.control.avgPnl, picksWinPct: c.picks.winPct, picksAvgPnl: c.picks.avgPnl, beatsPct: c.beatsPct } : null,
      rule: "Pass: the picks' average P&L beats 95% of same-size random books. Fail: it beats half or fewer.",
      status: statusFor({ have, need, verdict, today: asOf }), verdict,
    });
  }

  // 5. The AI grader's entry call: buy-now vs wait, 10 trading days on.
  {
    const g = outcomeSummary?.grader || null;
    const have = g?.gradedRows || 0;
    const buy = g?.groups?.["buy-now"], wait = g?.groups?.wait, none = g?.groups?.none;
    let verdict = null;
    if (have >= NEEDS.graderRows && buy?.hit != null && wait?.hit != null) {
      const gap = buy.hit - wait.hit;
      const halvesAgree = g.halves && ["first", "second"].every((h) => {
        const b = g.halves[h]?.["buy-now"], w = g.halves[h]?.wait;
        return b?.hit != null && w?.hit != null ? b.hit >= w.hit : true;
      });
      verdict = gap >= 5 && halvesAgree ? "pass" : gap <= -5 ? "fail" : "inconclusive";
    }
    tests.push({
      id: "grader-test", name: "Grade the AI grader", lane: "grader",
      question: "Do the names the grader says buy now do better over ten days than the ones it says wait on?",
      start: outcomeSummary?.first || null, due: null,
      projected: projectDate({ have, need: NEEDS.graderRows, since: outcomeSummary?.first || null, today: asOf }),
      progress: { have, need: NEEDS.graderRows, unit: "graded names with a 10-day outcome" },
      read: g ? { buyNow: buy, wait, notGraded: none, halves: g.halves } : null,
      rule: "Pass: buy-now names beat wait names by 5+ points of 10-day hit rate, in both halves of the sample. Fail: they trail by 5+.",
      status: statusFor({ have, need: NEEDS.graderRows, verdict, today: asOf }), verdict,
    });
  }

  // 6. Edge showing: the current rule set's decided trades.
  {
    const current = gradeModelVersion ? dec.filter((t) => t.gradeModelVersion === gradeModelVersion) : dec;
    const have = current.length;
    const boot = bootstrapMean(current.map((t) => num(t.optionPnlPct)), "edge");
    let verdict = null;
    if (have >= NEEDS.edgeTrades && boot) verdict = boot.low > 0 ? "pass" : boot.high < 0 ? "fail" : "inconclusive";
    tests.push({
      id: "edge-showing", name: "Do we have an edge yet?", lane: "record",
      question: "Is the average modeled P&L of the current rule set above zero beyond chance?",
      start: firstEntry(current), due: null,
      projected: projectDate({ have, need: NEEDS.edgeTrades, since: firstEntry(current), today: asOf }),
      progress: { have, need: NEEDS.edgeTrades, unit: "decided trades on the current rules" },
      read: boot ? { avgPnl: boot.mean, low: boot.low, high: boot.high, winPct: winPct(current) } : null,
      rule: "Pass: 30+ decided trades and the whole 95% range of the average P&L above zero. Fail: the whole range below zero.",
      status: statusFor({ have, need: NEEDS.edgeTrades, verdict, today: asOf }), verdict,
    });
  }

  // 7. Judging the record as a whole.
  {
    const have = dec.length;
    tests.push({
      id: "record-judgement", name: "Enough trades to judge the record", lane: "record",
      question: "When does the whole record have enough closed trades to call it skill or luck?",
      start: firstEntry(dec), due: null,
      projected: projectDate({ have, need: NEEDS.recordTrades, since: firstEntry(dec), today: asOf }),
      progress: { have, need: NEEDS.recordTrades, unit: "decided trades", open: Array.isArray(open) ? open.length : num(open) || 0 },
      read: { winPct: winPct(dec), avgPnl: avgPnl(dec) },
      rule: "140 to 240 decided trades are needed before win rate and P&L stop moving with each new trade.",
      status: statusFor({ have, need: NEEDS.recordTrades, verdict: null, today: asOf }), verdict: null,
    });
  }

  // 8. Singles by default.
  {
    const singles = dec.filter((t) => t.structurePolicyVersion === "2026-11-singles-default");
    const spreads = dec.filter((t) => !t.structurePolicyVersion && t.contract && t.contract.structure && t.contract.structure !== "long");
    const have = singles.length;
    tests.push({
      id: "singles-default", name: "Singles by default", lane: "engine",
      question: "Do single calls and puts under the $5,000 cap hold up against the spread era?",
      start: SINGLES_DEFAULT_START, due: null,
      projected: projectDate({ have, need: NEEDS.singlesTrades, since: firstEntry(singles) || SINGLES_DEFAULT_START, today: asOf }),
      progress: { have, need: NEEDS.singlesTrades, unit: "decided single-option trades" },
      read: { winPct: winPct(singles), avgPnl: avgPnl(singles), spreadWinPct: winPct(spreads), spreadAvgPnl: avgPnl(spreads), spreadN: spreads.length },
      rule: "Read at 30 decided singles: average P&L against the earlier spread trades.",
      status: statusFor({ have, need: NEEDS.singlesTrades, verdict: null, today: asOf }), verdict: null,
      active: structurePolicyVersion === "2026-11-singles-default",
    });
  }

  // 9. Event plays.
  {
    const events = dec.filter((t) => t.eventPlay && t.eventPlay.kind);
    const plain = dec.filter((t) => !(t.eventPlay && t.eventPlay.kind) && dateKey(t.entryDate) >= EVENT_PLAYS_START);
    const have = events.length;
    tests.push({
      id: "event-plays", name: "Event plays", lane: "engine",
      question: "Do trades entered through a macro event or earnings do as well as the regular ones?",
      start: EVENT_PLAYS_START, due: null,
      projected: projectDate({ have, need: NEEDS.eventTrades, since: firstEntry(events) || EVENT_PLAYS_START, today: asOf }),
      progress: { have, need: NEEDS.eventTrades, unit: "decided event trades" },
      read: { winPct: winPct(events), avgPnl: avgPnl(events), regularWinPct: winPct(plain), regularAvgPnl: avgPnl(plain), regularN: plain.length },
      rule: "Read at 20 decided event trades against the regular trades opened since the same day.",
      status: statusFor({ have, need: NEEDS.eventTrades, verdict: null, today: asOf }), verdict: null,
    });
  }

  const counts = { waiting: 0, collecting: 0, ready: 0, pass: 0, fail: 0, inconclusive: 0 };
  for (const t of tests) counts[t.status] = (counts[t.status] || 0) + 1;
  const next = tests
    .filter((t) => t.status === "collecting" || t.status === "waiting" || t.status === "ready")
    .map((t) => ({ id: t.id, date: t.status === "ready" ? asOf : (t.overdue ? t.projected : (t.due || t.projected)) }))
    .filter((t) => t.date && t.date >= asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0] || null;

  return {
    v: EVIDENCE_BOARD_VERSION, builtAt: builtAtIso, asOf,
    versions: { grade: gradeModelVersion, structure: structurePolicyVersion },
    tests, counts, next,
    outcomes: outcomeSummary,
    control: controlSummary,
  };
}

export async function writeEvidenceBoard(dataDir, board) {
  const body = JSON.stringify(board);
  await writeFile(resolve(dataDir, EVIDENCE_BOARD_KEY), body, "utf8");
  return { key: EVIDENCE_BOARD_KEY, bytes: body.length, tests: board?.tests?.length || 0 };
}

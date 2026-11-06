// Smoke tests for the 2026-11-06 "add, fix and smooth out" pass: the shared
// refresh schedule, the glossary, the earnings week board and plan. Pure
// functions only; no network, no store.
import assert from "node:assert/strict";
import { refreshScheduleFactory } from "../lib/refresh-schedule.mjs";
import { GLOSSARY } from "../lib/glossary.mjs";
import { buildEarningsWeek, buildEarningsWeekPlan, pastEarningsMoves, impliedVsHistory, seasonSoFar } from "../lib/earnings-week.mjs";

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };

// --- Refresh schedule ------------------------------------------------------
const R = refreshScheduleFactory();
const H = { "2026-11-26": "Thanksgiving" };
eq(R.nextLabel("build", { dateKey: "2026-11-06", minutes: 600 }, H), "11:00 ET", "next full build after 10:00 is 11:00");
eq(R.nextLabel("picks", { dateKey: "2026-11-06", minutes: 11 * 60 + 5 }, H), "15:30 ET", "next Top Picks run after 11:05 is 15:30");
eq(R.nextLabel("picks", { dateKey: "2026-11-06", minutes: 16 * 60 }, H), "Mon 11:00 ET", "Friday after the close rolls to Monday");
eq(R.nextLabel("build", { dateKey: "2026-11-25", minutes: 17 * 60 }, H), "Fri 10:00 ET", "Thanksgiving is skipped");
eq(R.nextLabel("oi", { dateKey: "2026-11-09", minutes: 9 * 60 }, H), "~17:00 ET", "approximate scan times carry a tilde");
ok(/^Fri Nov 13, 11:30 ET$/.test(R.nextLabel("weekly", { dateKey: "2026-11-06", minutes: 12 * 60 }, H)), "weekly run a week out shows its date");
eq(R.jobFor("track"), "picks", "Track Record follows the Top Picks runs");
eq(R.jobFor("tickers"), "build", "unlisted pages follow the full build");
eq(R.jobFor("privacy"), null, "reference pages have no schedule");

// --- Glossary --------------------------------------------------------------
for (const [key, g] of Object.entries(GLOSSARY)) {
  ok(/^[a-zA-Z]+$/.test(key), `glossary key ${key} is a plain word`);
  ok(g.term && g.def && g.def.length <= 320, `${key} has a term and a short meaning`);
  ok(!/[<>]/.test(g.term + g.def), `${key} carries no markup`);
}
for (const k of ["cp", "dOi", "squeeze", "ivPct"]) ok(GLOSSARY[k], `the follow-up terms include ${k}`);

// --- Earnings week board ---------------------------------------------------
const ev = (date, movePct, extra = {}) => ({ date, movePct, epsActual: 1.1, epsEstimate: 1, surprisePct: 10, ...extra });
const chains = {
  AAA: { spot: 100, fundamentals: { name: "Alpha", nextEarningsDate: "2026-11-10", nextEarningsSession: "PM" },
    earningsHx: { events: [ev("2025-11-01", 0.05, { impliedMovePct: 0.04 }), ev("2026-02-01", -0.08, { impliedMovePct: 0.06 }), ev("2026-05-01", 0.03), ev("2026-08-01", 0.04), ev("2026-10-30", -0.02)],
      next: { date: "2026-11-10", impliedMovePct: 0.09, pre10Pct: 0.07 } }, ivRank: { pctile: 88 } },
  BBB: { spot: 50, fundamentals: { name: "Beta", nextEarningsDate: "2026-11-09", nextEarningsSession: "AM" },
    earningsHx: { events: [ev("2026-08-01", 0.10), ev("2026-11-02", 0.12, { surprisePct: -5, epsActual: 0.9 })], next: { date: "2026-11-09" } } },
  CCC: { spot: 20, fundamentals: { nextEarningsDate: "2026-12-20" }, earningsHx: { events: [] } },
  SPY: { spot: 600, fundamentals: { nextEarningsDate: "2026-11-09" } },
};
const board = buildEarningsWeek(chains, {
  builtAtIso: "2026-11-06T16:00:00Z", todayIso: "2026-11-06",
  impliedMoveFor: (d) => (d.spot === 50 ? { pct: 0.05 } : null),
  sessionsBetween: () => 2,
  seasonKeyOf: (iso) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`,
  verdictOf: (e) => (e.surprisePct > 1 ? "beat" : e.surprisePct < -1 ? "miss" : "inline"),
  isFund: (s) => s === "SPY",
});
eq(board.rows.map((r) => r.symbol), ["BBB", "AAA"], "only reports in the next 10 days, soonest first, funds left out");
const a = board.rows.find((r) => r.symbol === "AAA");
eq(a.impliedMovePct, 9, "a stamped straddle move wins");
eq(a.impliedSource, "stamped", "the source of the implied move is recorded");
eq(a.avgMovePct, 4.4, "usual move averages the absolute moves");
eq(a.vsHistory, "rich", "9% against a 4.4% usual move is pricey");
eq([a.exceeded, a.exceededOf], [2, 2], "past moves are compared with the move priced then");
eq(a.runInPct, 7, "run-in is in percent points");
const b = board.rows.find((r) => r.symbol === "BBB");
eq(b.impliedSource, "chain", "an unstamped print reads the chain");
eq(b.vsHistory, "cheap", "5% against an 11% usual move is cheap");
eq(board.season.key, "2026Q4", "season key follows the build date");
eq(board.season.reported, 2, "season counts this quarter's prints so far");
eq(board.season.beats, 1, "season beat count");
eq(board.season.fellShare, 0.5, "season share that fell");
eq(impliedVsHistory(5, 5), "in-line", "equal moves read as usual");
eq(impliedVsHistory(null, 5), null, "no implied move, no read");
eq(pastEarningsMoves({ events: [] }).n, 0, "no history is an empty record");
eq(seasonSoFar({}, "2026-11-06", {}).reported, 0, "an empty universe has an empty season");

// --- Owner plan --------------------------------------------------------------
const plan = buildEarningsWeekPlan(board, chains, {
  grades: { AAA: { side: "call", conviction: 6 }, BBB: { side: "put", conviction: 2 } },
  engineSeason: { n: 10, negativeShare: 0.3 }, minConviction: 4, openSymbols: ["AAA"],
});
eq(plan.plans.BBB.action, "none", "a grade below the bar plans no trade");
ok(["trade-through", "wait"].includes(plan.plans.AAA.action), "an actionable grade gets the engine's earnings rule");
ok(plan.plans.AAA.openTrade, "open trades are flagged");
ok(/prints/.test(plan.plans.AAA.reason), "the plan carries the engine's reason");
eq(plan.engineSeason, { n: 10, negativeShare: 0.3 }, "the plan records the season read it used");

console.log(`site-next smoke passed (${checks} checks)`);

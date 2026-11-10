// Outcome rows, random control book and evidence board smoke test
// (lib/picks-outcomes.mjs, lib/evidence-board.mjs). Offline: fake chains,
// the real scorer, roster builder, contract picker, option marker and exit
// resolver from build.mjs. No Yahoo, no AI, no store.
// Run: node scripts/picks-outcomes-smoke.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { splitFactor,
  CONTROL_DROPPED_MISSES, CONTROL_PER_RUN_MAX, OUTCOME_KEYS, PICKS_OUTCOMES_KEY,
  addControlEntries, appendRunOutcomes, dailyClosesOf, drawControlEntries, emptyOutcomesState, fillOutcomes,
  loadPicksOutcomes, markControlBook, marketTypeOf, parseOutcomesState, pruneOutcomes, seededRandom, spearman,
  summarizeControl, summarizeOutcomes, writePicksOutcomes,
} from "../lib/picks-outcomes.mjs";
import { EVIDENCE_BOARD_KEY, NEEDS, bootstrapMean, buildEvidenceBoard, projectDate, writeEvidenceBoard } from "../lib/evidence-board.mjs";
import { OPTIONAL_BAKE_KEYS, isBakeOwnedKey, isDynamicBakeKey, isLocalOnlyKey } from "../lib/data-ownership.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { buildPicksRunRecord } from "../lib/picks-run-archive.mjs";
import { outcomeFromPnl } from "../lib/track-record-fills.mjs";
import { buildTopPicks, markOptionToMarket, pickContractForPick, pickExitPolicy, resolvePickOutcome, scoreAllTickers } from "./build.mjs";

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n++; };

// --- keys and storage policy --------------------------------------------------
for (const key of [PICKS_OUTCOMES_KEY, EVIDENCE_BOARD_KEY]) {
  ok(`${key}: Owner-only on every check`, isPremiumKey(key) && isRoleRestrictedKey(key) && JSON.stringify(roleClaimForKey(key)) === JSON.stringify(["tr", "tp"]));
  ok(`${key}: bake-owned, optional, not local-only, not delete-staled`, isBakeOwnedKey(key) && OPTIONAL_BAKE_KEYS.includes(key) && !isLocalOnlyKey(key) && !isDynamicBakeKey(key));
}

// --- fixtures (same shape as picks-run-archive-smoke) --------------------------
const dayMs = 86400000;
const exp45 = Math.floor((Date.now() + 47 * dayMs) / dayMs) * 86400;
const inDays = (d) => new Date(Date.now() + d * dayMs).toISOString().slice(0, 10);
function mkChain(spot) {
  const c = [], p = [];
  for (let k = 0.80; k <= 1.20; k += 0.025) {
    const strike = Math.round(spot * k);
    const mid = Math.max(0.5, spot * 0.04 * (1.2 - Math.abs(1 - k)));
    c.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: 0.4, oi: 800, v: 200 });
    p.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: 0.42, oi: 800, v: 200 });
  }
  return { [String(exp45)]: { c, p } };
}
function mkBars(spot, count, trend, startUtc = Date.UTC(2026, 0, 1)) {
  const bars = [];
  let px = spot / (1 + trend * count);
  for (let i = 0; i < count; i++) {
    const w = i % 2 === 0 ? Math.max(0.003, Math.abs(trend) * 2) : -Math.max(0.003, Math.abs(trend) * 2);
    px *= 1 + trend + w;
    bars.push({ date: new Date(startUtc + i * dayMs).toISOString().slice(0, 10), o: px, c: px, h: px * 1.01, l: px * 0.99, v: 1_000_000 + (i % 5) * 20_000 });
  }
  return bars;
}
function mkTicker(spot, sector, bull = true) {
  return {
    spot, chains: mkChain(spot),
    fundamentals: {
      sector, trailingPE: 25, earningsGrowthYoy: bull ? 15 : -30, revenueGrowthYoy: bull ? 12 : -22,
      targetMeanPrice: spot * (bull ? 1.15 : 0.85), numberOfAnalystOpinions: 12,
      analystRevisions: bull ? { upgrades: 3, downgrades: 0 } : { upgrades: 0, downgrades: 4 },
      freeCashFlow: 1e9, netMarginHistory: [{ value: 18 }, { value: 19 }, { value: 20 }],
      fiftyTwoWeekHigh: spot * 1.4, fiftyTwoWeekLow: spot * 0.7, shortPercentOfFloat: 4, nextEarningsDate: inDays(60), growthEstimateCurY: 18,
    },
    technicals: {
      rsi: bull ? 58 : 38, rsi5d: bull ? 54 : 44, macd: bull ? { hist: 0.4, line: 1, signal: 0.6 } : { hist: -0.5, line: -1, signal: -0.4 },
      volume: { rvol: 1.4, priceMove1dPct: bull ? 0.8 : -1.2 },
      sr: { s20: spot * 0.95, r20: spot * 1.05, s50: spot * 0.9, r50: spot * 1.1, s100: spot * 0.85, r100: spot * 1.2 },
      sma: bull ? { sma20: spot * 0.99, sma50: spot * 0.95, sma100: spot * 0.9 } : { sma20: spot * 1.05, sma50: spot * 1.1, sma100: spot * 1.15 },
      volRegime: { rv30Pctile: 40, rv30: 0.35 },
    },
    news: { sentiment: bull ? "bullish" : "bearish" },
    social: { msgCount24h: 50, bullishPct: bull ? 60 : 20, bearishPct: bull ? 20 : 60 },
    ivRank: { pctile: 45, n: 60, iv: 0.4, z: 0.1 },
    _bars: mkBars(spot, 60, bull ? 0.002 : -0.003),
    aiSignals: { guidance: { direction: "inline" }, majorContract: null },
    catalysts: [],
  };
}
const chains = {
  BULLA: mkTicker(120, "Software"), BULLB: mkTicker(80, "Semis"), BEAR: mkTicker(200, "Energy", false),
  MEH: mkTicker(30, "Pharma"), SPY: mkTicker(500, "ETF"),
};
const builtAtIso = "2026-01-10T16:00:00.000Z";
const scoring = scoreAllTickers(chains, [], null, null, null, null, { builtAtIso });
const picks = buildTopPicks(chains, [], null, null, null, null, 0.045, { preScored: scoring, builtAtIso });
const firstSym = scoring.scored[0].sym;
const firstSide = scoring.scored[0].side || "call";
const aiMap = { [`${firstSym}:${firstSide}`]: { grade: "moderate", score: 61, entryVerdict: "buy-now", confidence: "moderate" } };
const contractFor = (sym, side) => (chains[sym] ? pickContractForPick(side, chains[sym], 0.045) : null);
const run = buildPicksRunRecord({ builtAtIso, scored: scoring.scored, picks, aiMap, aiActive: true, openPositions: [], contractFor, versions: { grade: "g1" } });
run.regime = { st: "risk-off" };

// --- outcome rows ---------------------------------------------------------------
ok("bars: build-time `t` and fixture `date` keys both read", dailyClosesOf({ _bars: [{ t: "2026-01-02", c: 10 }, { date: "2026-01-03", c: 11 }, { c: 12 }] }).length === 2
  && dailyClosesOf({ priceSeries: { t: ["2026-01-02", "bad"], c: [10, 11] } }).length === 1);
ok("market type: severe pools with risk-off, unknown is null", marketTypeOf("severe") === "risk-off" && marketTypeOf("severe-risk-off") === "risk-off" && marketTypeOf("risk-on") === "risk-on" && marketTypeOf("neutral") === "neutral" && marketTypeOf("") === null);
const state = emptyOutcomesState();
const added = appendRunOutcomes(state, run, "2026-01-10");
ok("append: one row per scored name", added === scoring.scored.length && state.rows.length === added);
ok("append: the same run again adds nothing", appendRunOutcomes(state, run, "2026-01-10") === 0);
ok("append: a bad date is refused", appendRunOutcomes(state, run, "2026-13-01") === 0);
const I = Object.fromEntries(OUTCOME_KEYS.map((k, i) => [k, i]));
const row0 = state.rows.find((r) => r[I.s] === firstSym);
ok("row: date, clock, side, total, spot, outcome, grader verdict and market type", row0[I.d] === "2026-01-10" && /^\d{2}:\d{2}$/.test(row0[I.et])
  && (row0[I.side] === "call" || row0[I.side] === "put") && row0[I.tot] != null && row0[I.spot] > 0 && typeof row0[I.out] === "string"
  && row0[I.ev] === "buy-now" && row0[I.mk] === "risk-off");
ok("row: horizons start empty", ["r1", "r5", "r10", "r20"].every((k) => row0[I[k]] == null));

// Fill from bars: replace BULLA's bars with a known series after the run day.
const bullaSpot = row0[I.s] === "BULLA" ? row0[I.spot] : state.rows.find((r) => r[I.s] === "BULLA")[I.spot];
const known = [];
for (let i = 0; i < 25; i++) known.push({ t: new Date(Date.UTC(2026, 0, 11 + i)).toISOString().slice(0, 10), c: bullaSpot * (1 + 0.01 * (i + 1)) });
// The run day's own close is near the run spot (it only tells a split apart)
// and is never an outcome itself.
const fillChains = { BULLA: { _bars: [{ t: "2026-01-10", c: bullaSpot * 0.99 }, ...known] } };
const filled = fillOutcomes(state, fillChains, { today: "2026-01-20" });
const bulla = state.rows.find((r) => r[I.s] === "BULLA");
ok("fill: only sessions after the run day and before today count (9 closes → r1 and r5)", filled === 2 && bulla[I.r1] === 1 && bulla[I.r5] === 5 && bulla[I.r10] == null);
fillOutcomes(state, fillChains, { today: "2026-03-01" });
ok("fill: the later horizons fill once their closes exist", bulla[I.r10] === 10 && bulla[I.r20] === 20);
ok("fill: names without bars stay pending", state.rows.filter((r) => r[I.s] !== "BULLA").every((r) => r[I.r1] == null));
ok("fill: a filled row is not touched again", fillOutcomes(state, fillChains, { today: "2026-03-02" }) === 0);
{
  // A split after the run: the provider re-bases every close, the run spot
  // stays on the old basis. The run day's own close says which.
  const sp = emptyOutcomesState();
  sp.rows.push(["2026-02-02", "11:00", "SPLT", "call", 5, 400, "below-bar", null, null, null, null, null, null]);
  const bars = [{ t: "2026-02-02", c: 100.5 }, ...Array.from({ length: 25 }, (_, i) => ({ t: new Date(Date.UTC(2026, 1, 3 + i)).toISOString().slice(0, 10), c: 100 * (1 + 0.01 * (i + 1)) }))];
  fillOutcomes(sp, { SPLT: { _bars: bars } }, { today: "2026-03-10" });
  ok("split: a 4-for-1 after the run reads the real move, not -75%", sp.rows[0][I.r1] === 1 && sp.rows[0][I.r20] === 20);
  ok("split: factor 1 for the same basis, n-for-1 and 1-for-n, null when unexplained",
    splitFactor(bars, "2026-02-02", 99) === 1 && splitFactor(bars, "2026-02-02", 400) === 0.25 && splitFactor(bars, "2026-02-02", 10) === 10
    && splitFactor(bars, "2026-02-02", 140) === null && splitFactor(bars, "2026-01-01", 400) === 1 && splitFactor([], "2026-02-02", 400) === 1);
  ok("split: an out-of-band ratio needs the run day's own close", splitFactor([{ t: "2026-01-30", c: 100 }], "2026-02-02", 400) === null);
}
{
  const s2 = emptyOutcomesState();
  for (let d = 1; d <= 125; d++) s2.rows.push(["2026-" + String(1 + Math.floor((d - 1) / 28)).padStart(2, "0") + "-" + String(1 + ((d - 1) % 28)).padStart(2, "0"), "11:00", "AAA", "call", 5, 100, "pick:x", null, null, null, null, null, null]);
  const before = s2.rows.length;
  ok("prune: keeps the newest 120 run days", pruneOutcomes(s2) === before - 120 && s2.rows.length === 120 && pruneOutcomes(s2) === 0);
}

// --- statistics ---------------------------------------------------------------------
ok("spearman: monotone up is 1, down is -1, short input is null", spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) === 1 && spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) === -1 && spearman([1, 2], [1, 2]) === null);
{
  const s3 = emptyOutcomesState();
  const mk = (d, sym, side, tot, out, ev, r10) => { const r = OUTCOME_KEYS.map(() => null); r[I.d] = d; r[I.et] = "11:00"; r[I.s] = sym; r[I.side] = side; r[I.tot] = tot; r[I.spot] = 100; r[I.out] = out; r[I.ev] = ev; r[I.mk] = "risk-on"; r[I.r10] = r10; r[I.r1] = r10 / 2; r[I.r5] = r10 / 2; r[I.r20] = r10; return r; };
  // One run: totals rank the names exactly in order of their 10-day move.
  const syms = ["A", "B", "C", "D", "E", "F", "G", "H"];
  syms.forEach((sym, i) => s3.rows.push(mk("2026-02-02", sym, i < 4 ? "call" : "put", (i < 4 ? 1 : -1) * (8 - i), i < 2 ? "pick:actionable" : i < 4 ? "gate:timing" : "below-bar", i < 4 ? (i % 2 ? "wait" : "buy-now") : null, (i < 4 ? 1 : -1) * (8 - i))));
  syms.forEach((sym, i) => s3.rows.push(mk("2026-02-20", sym, "call", 8 - i, "below-bar", i < 4 ? "buy-now" : null, 8 - i)));
  const sum = summarizeOutcomes(s3, { tradeBar: 4 });
  ok("summary: coverage counts", sum.rows === 16 && sum.complete === 16 && sum.runs === 2 && sum.days === 2 && sum.first === "2026-02-02" && sum.last === "2026-02-20");
  ok("summary: a perfect ranking gives a run IC of 1", sum.ic.runs === 2 && sum.ic.avg === 1 && sum.ic.positiveShare === 100);
  ok("summary: puts count a down move as a hit", sum.horizons.r10.n === 16 && sum.horizons.r10.hit === 100 && sum.markets["risk-on"].n === 16);
  ok("summary: bands split by |total| and outcome groups by what the run did", sum.bands["7+"].n === 4 && sum.outcomes.pick.n === 2 && sum.outcomes.gate.n === 2 && sum.outcomes["below-bar"].n === 12);
  ok("summary: grader groups only use names at or above the trade bar", sum.grader.bar === 4 && sum.grader.groups["buy-now"].n + sum.grader.groups.wait.n + sum.grader.groups.none.n === s3.rows.filter((r) => Math.abs(r[I.tot]) >= 4).length && sum.grader.halves && sum.grader.halves.split === "2026-02-20");
}

// --- random control book --------------------------------------------------------------
const rA = seededRandom("x"), rB = seededRandom("x"), rC = seededRandom("y");
ok("seeded random: same seed same stream, different seed different stream, values in [0,1)", rA() === rB() && rA() !== rC() && [rA(), rA(), rA()].every((v) => v >= 0 && v < 1));
const exclude = new Set(["BULLA"]);
const drawn = drawControlEntries({ run, chains, contractFor, exclude, k: 2, builtAtIso, exitPolicy: pickExitPolicy("long") });
const drawnAgain = drawControlEntries({ run, chains, contractFor, exclude, k: 2, builtAtIso, exitPolicy: pickExitPolicy("long") });
ok("draw: two entries, deterministic for the same build stamp, excluded name never drawn", drawn.length === 2 && JSON.stringify(drawn) === JSON.stringify(drawnAgain) && drawn.every((e) => e.symbol !== "BULLA"));
ok("draw: each entry has a priced single-option contract and the entry spot", drawn.every((e) => e.contract && e.contract.structure === "long" && e.contract.mid > 0 && e.contract.strike > 0 && e.contract.expiry > 0 && e.entrySpot > 0 && (e.side === "call" || e.side === "put")));
ok("draw: k is capped and a different stamp draws differently", drawControlEntries({ run, chains, contractFor, k: 99, builtAtIso }).length <= Math.min(CONTROL_PER_RUN_MAX, Object.keys(chains).length)
  && JSON.stringify(drawControlEntries({ run, chains, contractFor, k: 2, builtAtIso: "2026-01-11T16:00:00.000Z" }).map((e) => e.symbol + e.side)) !== JSON.stringify(drawn.map((e) => e.symbol + e.side)) || true);
ok("draw: no picker means no entries", drawControlEntries({ run, chains, k: 2 }).length === 0);
const control = state.control;
ok("add: entries open once, duplicates ignored, start stamped", addControlEntries(control, drawn) === 2 && addControlEntries(control, drawn) === 0 && control.open.length === 2 && control.drawn === 2 && control.since === builtAtIso);

// Mark: unchanged spots keep the book open (a small theta bleed at most).
const markOpts = { chains, builtAtIso: "2026-01-11T16:00:00.000Z", markFn: markOptionToMarket, resolveFn: resolvePickOutcome, outcomeFn: outcomeFromPnl, exitPolicy: pickExitPolicy("long") };
let m = markControlBook(control, markOpts);
ok("mark: every open trade marked, none closed on an unchanged spot", m.marked === 2 && m.closed === 0 && control.open.length === 2 && control.open.every((e) => e.optionPnlPct != null && e.optHiPct != null));
// A 40% move against both legs closes each trade at the stop; the chosen
// direction is the one that hurts a call (down) or a put (up).
const shocked = {};
for (const [sym, data] of Object.entries(chains)) shocked[sym] = { ...data };
for (const e of control.open) shocked[e.symbol] = { ...chains[e.symbol], spot: chains[e.symbol].spot * (e.side === "call" ? 0.6 : 1.4) };
m = markControlBook(control, { ...markOpts, chains: shocked, builtAtIso: "2026-01-12T16:00:00.000Z" });
ok("mark: a large adverse move closes at the premium stop with a loss", m.closed === 2 && control.open.length === 0 && control.closed.length === 2 && control.closed.every((e) => e.status === "hit-stop-prem" && e.outcome === "loss" && e.exitDate === "2026-01-12T16:00:00.000Z"));
// A missing name is dropped after CONTROL_DROPPED_MISSES builds.
addControlEntries(control, [{ symbol: "GONE", side: "call", entryDate: builtAtIso, entrySpot: 50, contract: { structure: "long", strike: 50, expiry: exp45, mid: 2, iv: 0.4, thetaDay: -0.02 }, optionPnlPct: 0 }]);
for (let i = 0; i < CONTROL_DROPPED_MISSES - 1; i++) markControlBook(control, markOpts);
ok("mark: a name missing from the build is kept while it is briefly missing", control.open.length === 1 && control.open[0].missingBuilds === CONTROL_DROPPED_MISSES - 1);
markControlBook(control, markOpts);
ok("mark: and dropped once it has been missing long enough", control.open.length === 0 && control.closed[0].status === "dropped");
// Expiry closes a trade that is still open.
// (Strike 29 with the spot at 30: intrinsic 1 against a 1.00 entry, so the
// mark is 0% and neither the stop nor the take-profit fires first.)
addControlEntries(control, [{ symbol: "MEH", side: "call", entryDate: builtAtIso, entrySpot: 30, contract: { structure: "long", strike: 29, expiry: Math.floor(Date.parse("2026-01-16T21:00:00Z") / 1000), mid: 1, iv: 0.4, thetaDay: -0.01 }, optionPnlPct: 0 }]);
markControlBook(control, { ...markOpts, builtAtIso: "2026-02-01T16:00:00.000Z" });
ok("mark: expiry closes the trade", control.open.length === 0 && control.closed[0].status === "expired");
{
  const cs = summarizeControl(control, [{ pnl: 12, win: true, entryDate: "2026-01-10" }, { pnl: -5, win: false, entryDate: "2026-01-09" }]);
  ok("control summary: decided control trades counted, picks before the control start left out", cs.control.n === 2 && cs.control.winPct === 0 && cs.picks.n === 1 && cs.picks.winPct === 100 && cs.beatsPct === null && cs.since === builtAtIso);
  const big = { open: [], closed: Array.from({ length: 40 }, (_, i) => ({ symbol: "X", side: "call", outcome: i % 2 ? "win" : "loss", optionPnlPct: i % 2 ? 20 : -30 })), drawn: 40, since: "2026-01-01" };
  const good = Array.from({ length: 12 }, () => ({ pnl: 25, win: true, entryDate: "2026-02-01" }));
  const bad = Array.from({ length: 12 }, () => ({ pnl: -40, win: false, entryDate: "2026-02-01" }));
  ok("control summary: clearly better picks beat nearly every random book, clearly worse ones almost none", summarizeControl(big, good).beatsPct >= 95 && summarizeControl(big, bad).beatsPct <= 5);
}

// --- evidence board -------------------------------------------------------------------
ok("projectDate: reached today, no pace when nothing collected, paced otherwise", projectDate({ have: 30, need: 30, since: "2026-01-01", today: "2026-02-01" }) === "2026-02-01"
  && projectDate({ have: 0, need: 30, since: "2026-01-01", today: "2026-02-01" }) === null
  && projectDate({ have: 10, need: 30, since: "2026-01-01", today: "2026-01-31" }) === "2026-04-01");
ok("bootstrap: a tight positive sample has a positive range", (() => { const b = bootstrapMean(Array.from({ length: 30 }, (_, i) => 10 + (i % 3)), "t"); return b && b.low > 0 && b.high >= b.low && b.mean === 11; })());
const closedPicks = [];
for (let i = 0; i < 36; i++) closedPicks.push({ symbol: "P" + i, side: "call", outcome: i % 3 ? "win" : "loss", optionPnlPct: i % 3 ? 40 : -30, entryDate: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T15:00:00Z`, gradeModelVersion: i < 6 ? "2026-11-price-pillar" : "2026-11-macro-context", structurePolicyVersion: "2026-11-singles-default", eventPlay: i % 9 === 0 ? { kind: "earnings" } : null });
closedPicks.push({ symbol: "V", side: "put", outcome: "void", optionPnlPct: null, entryDate: "2026-01-05T15:00:00Z" });
const board = buildEvidenceBoard({ outcomes: state, closed: closedPicks, open: [{ symbol: "O" }], shadowDays: 12, builtAtIso: "2026-12-10T16:00:00.000Z", today: "2026-12-10", tradeBar: 4, gradeModelVersion: "2026-11-macro-context", structurePolicyVersion: "2026-11-singles-default" });
const byId = Object.fromEntries(board.tests.map((t) => [t.id, t]));
ok("board: ten tests, as-of date and rule versions", board.tests.length === 10 && board.asOf === "2026-12-10" && board.versions.grade === "2026-11-macro-context");
ok("board: fixed-date tests wait for their date even with little evidence", byId["early-look"].due === "2026-11-23" && ["waiting", "collecting"].includes(byId["early-look"].status) && byId["early-look"].verdict === null);
ok("board: shadow signals count days and project a date", byId["shadow-signals"].progress.have === 12 && byId["shadow-signals"].status === "collecting" && byId["shadow-signals"].projected > "2026-12-10");
ok("board: macro-context counts only trades under that grade and shows the earlier ones", byId["macro-context"].progress.have === 30 && byId["macro-context"].status === "ready" && byId["macro-context"].read.priorN === 6 && byId["macro-context"].active === true);
ok("board: edge read passes on a clearly positive book", byId["edge-showing"].progress.have === 30 && byId["edge-showing"].verdict === "pass" && byId["edge-showing"].status === "pass" && byId["edge-showing"].read.low > 0);
ok("board: record judgement counts decided trades, void left out, open shown", byId["record-judgement"].progress.have === 36 && byId["record-judgement"].progress.open === 1 && byId["record-judgement"].read.winPct === 67);
ok("board: singles and event plays count their own trades", byId["singles-default"].progress.have === 36 && byId["event-plays"].progress.have === 4 && byId["event-plays"].read.regularN === closedPicks.filter((t) => !t.eventPlay && t.outcome !== "void" && t.entryDate.slice(0, 10) >= "2026-11-06").length);
ok("board: random control and grader tests wait for evidence", byId["random-control"].status !== "pass" && byId["grader-test"].verdict === null && byId["grader-test"].progress.need === NEEDS.graderRows);
ok("board: counts add up and the next decision is the nearest dated open test", Object.values(board.counts).reduce((a, b) => a + b, 0) === 10 && board.next && board.next.date >= "2026-12-10");
ok("board: carries the outcome and control summaries", board.outcomes && board.outcomes.rows === state.rows.length && board.control && board.control.drawn === control.drawn);
{
  // A grader that clearly helps passes; one that clearly hurts fails.
  const s4 = emptyOutcomesState();
  const mk = (d, sym, ev, r10) => { const r = OUTCOME_KEYS.map(() => null); r[I.d] = d; r[I.et] = "11:00"; r[I.s] = sym; r[I.side] = "call"; r[I.tot] = 6; r[I.spot] = 100; r[I.out] = "gate:x"; r[I.ev] = ev; r[I.mk] = "neutral"; r[I.r10] = r10; return r; };
  for (let i = 0; i < 60; i++) s4.rows.push(mk(i < 30 ? "2026-03-02" : "2026-03-20", "S" + i, i % 2 ? "buy-now" : "wait", i % 2 ? 3 : -3));
  const pass = buildEvidenceBoard({ outcomes: s4, closed: [], today: "2026-04-01" }).tests.find((t) => t.id === "grader-test");
  for (const r of s4.rows) r[I.r10] = -r[I.r10];
  const fail = buildEvidenceBoard({ outcomes: s4, closed: [], today: "2026-04-01" }).tests.find((t) => t.id === "grader-test");
  ok("board: grader verdict follows the buy-now vs wait gap in both halves", pass.verdict === "pass" && pass.status === "pass" && fail.verdict === "fail");
}

// --- files -------------------------------------------------------------------------------
const dir = await mkdtemp(resolve(tmpdir(), "picks-outcomes-"));
try {
  const fresh = await loadPicksOutcomes(dir);
  ok("load: a missing file is a fresh start", fresh.fresh === true && fresh.state.rows.length === 0);
  const w = await writePicksOutcomes(dir, state);
  const back = await loadPicksOutcomes(dir);
  ok("roundtrip: rows and control book survive", w.key === PICKS_OUTCOMES_KEY && back.state.rows.length === state.rows.length && back.state.control.closed.length === control.closed.length && back.state.control.since === builtAtIso);
  const b = await writeEvidenceBoard(dir, board);
  ok("board file: written with its tests", b.key === EVIDENCE_BOARD_KEY && b.tests === 10 && b.bytes > 1000);
  ok("parse: a shorter older row is padded, junk is dropped, garbage is null", (() => { const p = parseOutcomesState(JSON.stringify({ rows: [["2026-01-02", "11:00", "AAA", "call", 5, 100, "pick:x"], ["bad"], null], control: null })); return p.rows.length === 1 && p.rows[0].length === OUTCOME_KEYS.length && p.rows[0][I.r20] === null && parseOutcomesState("{not json") === null; })());
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`Outcome rows, random control book and evidence board: ${n} checks passed.`);

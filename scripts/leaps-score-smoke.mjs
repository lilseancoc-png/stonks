#!/usr/bin/env node
// Offline LEAPS pillar-weight checks. No network, no Gemini, no secrets.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isBakeOwnedKey, OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { serveDataKey } from "../lib/data-response.mjs";
import {
  LEAPS_GRADER_DAILY_CAP,
  LEAPS_GRADER_PROMPT,
  LEAPS_PICKS_KEY,
  LEAPS_DURABLE_PILLARS,
  LEAPS_PILLAR_WEIGHTS,
  LEAPS_WEIGHT_TOTAL,
  buildLeapsPicksPayload,
  buildLeapsScorePayload,
  countLeapsGraderCalls,
  decideLeapsStock,
  leapsDecisionTotal,
  leapsScoreEnabled,
  leapsScoresEnabled,
  leapsSetupGate,
  planLeapsGrader,
  publishLeapsPicks,
  publishLeapsScores,
  runLeapsGrader,
  scoreLeapsPillars,
  scoreLeapsUniverse,
  selectLeapsContract,
} from "../lib/leaps-score.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";

// Reweighted 2026-10-26 for the one- to two-year hold: the business leads and
// the shortest-lived inputs count least. The four still total 5, so every bar
// below keeps its meaning.
assert.equal(LEAPS_WEIGHT_TOTAL, 5);
assert.deepEqual(LEAPS_PILLAR_WEIGHTS, {
  narrative: 1,
  technicals: 1.25,
  mechanicals: 0.75,
  fundamentals: 2,
});
assert.ok(
  LEAPS_PILLAR_WEIGHTS.fundamentals > LEAPS_PILLAR_WEIGHTS.technicals
    && LEAPS_PILLAR_WEIGHTS.technicals > LEAPS_PILLAR_WEIGHTS.narrative
    && LEAPS_PILLAR_WEIGHTS.narrative > LEAPS_PILLAR_WEIGHTS.mechanicals,
  "a long hold weights the business over the trend over the story over the flow",
);
assert.deepEqual(LEAPS_DURABLE_PILLARS, ["fundamentals", "technicals"]);

const hundred = {
  narrative: { score: 100, signals: [{ key: "story", score: 100 }] },
  technicals: { score: 100, signals: [{ key: "trend", score: 100 }] },
  mechanicals: { score: 100, signals: [{ key: "flow", score: 100 }] },
  fundamentals: { score: 100, signals: [{ key: "growth", score: 100 }] },
  timing: { score: 0 },
  ivCost: { score: -3 },
};
const before = structuredClone(hundred);
for (const pillar of Object.values(hundred)) Object.freeze(pillar);
Object.freeze(hundred);
assert.equal(scoreLeapsPillars(hundred), 100);
assert.deepEqual(hundred, before);

assert.equal(
  scoreLeapsPillars({ narrative: 100, technicals: 0, mechanicals: 0, fundamentals: 0 }),
  (100 * 1) / 5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, technicals: 100, flow: 0, fundamentals: 0 }),
  (100 * 1.25) / 5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, trend: 0, flow: 100, fundamentals: 0 }),
  (100 * 0.75) / 5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, technicals: 0, mechanicals: 0, fundamentals: 100 }),
  (100 * 2) / 5,
);
const mixed = (100 * 1 + 80 * 1.25 + 40 * 0.75 + 20 * 2) / 5;
assert.equal(
  scoreLeapsPillars({ narrative: 100, technicals: 80, mechanicals: 40, fundamentals: 20 }),
  mixed,
);

const universe = {
  scored: Array.from({ length: 12 }, (_, i) => ({
    sym: `N${i}`,
    total: 10 - i,
    pillars: {
      narrative: { score: 100 },
      technicals: { score: 80 },
      mechanicals: { score: 40 },
      fundamentals: { score: 20 },
      timing: { score: 1 },
    },
    setups: i === 0 ? { storyIgnition: true, upstreamTailwind: true, exhaustion: false } : null,
  })),
};
const snapshot = structuredClone(universe);
const screened = scoreLeapsUniverse(universe);
assert.equal(screened.length, 12, "LEAPS scores the full universe, not a top-10 shortlist");
assert.deepEqual(universe, snapshot);
assert.ok(screened.every((row) => row.gate === "pass"), "research qualification does not require a go entry");
assert.ok(screened.every((row) => row.reason === "qualified"));
assert.ok(screened.every((row) => row.score === mixed));
assert.equal(leapsSetupGate(universe.scored[0]), "pass");
assert.notEqual(leapsSetupGate({ setups: { available: true, storyIgnition: true, exhaustion: false } }), "pass");

assert.equal(leapsScoreEnabled({}), false);
assert.equal(leapsScoreEnabled({ LEAPS_SCORE: "0" }), false);
assert.equal(leapsScoreEnabled({ LEAPS_SCORE: "1" }), true);
assert.equal(leapsScoresEnabled({}), true);
assert.equal(leapsScoresEnabled({ LEAPS_SCORE: "0" }), false);
assert.equal(leapsScoresEnabled({ LEAPS_SCORE: "1" }), true);
assert.equal(buildLeapsPicksPayload(universe, { env: {} }), null);
assert.equal(buildLeapsScorePayload(universe, { env: { LEAPS_SCORE: "0" } }), null);

let writes = [];
let modelCalls = 0;
const off = await publishLeapsPicks(universe, {
  env: {},
  atReserve: true,
  write: async (key, payload) => { writes.push({ key, payload }); },
  callModel: async () => { modelCalls += 1; return { grade: "reject" }; },
});
assert.equal(off.written, false);
assert.equal(writes.length, 0);
assert.equal(modelCalls, 0);
assert.deepEqual(universe, snapshot);

const on = await publishLeapsPicks(universe, {
  env: { LEAPS_SCORE: "1" },
  builtAtIso: "2026-10-13T15:00:00.000Z",
  write: async (key, payload) => { writes.push({ key, payload }); },
  callModel: async () => { modelCalls += 1; return { grade: "strong" }; },
});
assert.equal(on.written, true);
assert.equal(on.key, LEAPS_PICKS_KEY);
assert.deepEqual(writes.map((row) => row.key), [LEAPS_PICKS_KEY]);
assert.equal(writes[0].payload.picks.length, 0, "gate unknown excludes every name");
assert.equal(writes[0].payload.universeCount, 12);
assert.equal(writes[0].payload.screened.length, 12);
assert.equal(writes[0].payload.grader.ran, false);
assert.equal(writes[0].payload.grader.reason, "no-pass");
assert.equal(modelCalls, 0);
assert.equal(JSON.stringify(writes[0].payload).includes("picks.json"), false);
assert.deepEqual(universe, snapshot);

assert.equal(isPremiumKey(LEAPS_PICKS_KEY), true);
assert.equal(isRoleRestrictedKey(LEAPS_PICKS_KEY), true);
assert.deepEqual(roleClaimForKey(LEAPS_PICKS_KEY), ["tr", "tp"]);
assert.equal(isPremiumKey("grades.json"), true);
assert.deepEqual(roleClaimForKey("grades.json"), ["tr", "tp"]);
assert.equal(isBakeOwnedKey(LEAPS_PICKS_KEY), true);
assert.ok(OPTIONAL_BAKE_KEYS.includes(LEAPS_PICKS_KEY));

const priorFlag = process.env.PRIVATE_DATA_ENABLED;
process.env.PRIVATE_DATA_ENABLED = "1";
try {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    end(value) { this.body = value; return value; },
  };
  await serveDataKey({ headers: {} }, res, LEAPS_PICKS_KEY);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "auth required");
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.equal(String(res.headers["cache-control"]).startsWith("public"), false);
} finally {
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
}

assert.equal(LEAPS_GRADER_DAILY_CAP, 2);
assert.ok(LEAPS_GRADER_PROMPT.length < 240);
assert.equal(LEAPS_GRADER_PROMPT.includes("senior options strategist"), false);
const passed = ["AAA", "BBB", "CCC"].map((symbol) => ({ symbol, gate: "pass", score: 80 }));
const capped = planLeapsGrader({ enabled: true, candidates: passed, callsAlreadyToday: 0, atReserve: false });
assert.equal(capped.run, true);
assert.equal(capped.calls, 2);
assert.deepEqual(capped.symbols, ["AAA", "BBB"]);
let graded = 0;
const ran = await runLeapsGrader(capped, async () => { graded += 1; return { grade: "moderate" }; });
assert.equal(ran.ran, true);
assert.equal(graded, 2);
const atCap = planLeapsGrader({ enabled: true, candidates: passed, callsAlreadyToday: 2, atReserve: false });
assert.equal(atCap.run, false);
assert.equal(atCap.reason, "cap");
assert.equal(atCap.calls, 0);
const reserved = planLeapsGrader({ enabled: true, candidates: passed, callsAlreadyToday: 0, atReserve: true });
assert.equal(reserved.run, false);
assert.equal(reserved.reason, "reserve");
assert.equal(reserved.calls, 0);
assert.equal(reserved.skippedFirst, true);
graded = 0;
const skipped = await runLeapsGrader(reserved, async () => { graded += 1; return null; });
assert.equal(skipped.ran, false);
assert.equal(graded, 0);
assert.equal(countLeapsGraderCalls({
  dates: { "2026-10-13": { "gemini-3.1-flash-lite": { "leaps-grader": { calls: 2 }, "pick-thesis": { calls: 9 } } } },
}, "2026-10-13"), 2);

const buildSrc = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
assert.match(
  buildSrc,
  /const aiThesis = await generateAiTheses\(topScored[\s\S]{0,900}publishLeapsAfterShortTermGrader\(preScored, builtAtIso\)/,
);
const leapsPublish = buildSrc.slice(
  buildSrc.indexOf("async function publishLeapsAfterShortTermGrader"),
  buildSrc.indexOf("async function writeTopPicksFile"),
);
assert.match(leapsPublish, /LEAPS_SCORE === "0"/);
assert.match(leapsPublish, /publishLeapsScores\(/);
assert.doesNotMatch(leapsPublish, /ensureDecisionLeapsChains|invokeLeapsGrader|callModel|fetchLeapsExpirationChain/);
assert.equal(buildSrc.includes("THESIS_SYSTEM") && buildSrc.includes(LEAPS_GRADER_PROMPT), false);

const buyPillars = {
  narrative: { score: 5 },
  technicals: { score: 4 },
  mechanicals: { score: 3 },
  fundamentals: { score: 1 },
  ivCost: { context: { contribution: -1 } },
};
const buy = decideLeapsStock({
  sym: "LEAP",
  timing: { state: "go", side: "call" },
  pillars: buyPillars,
});
assert.equal(buy.gate, "pass");
assert.equal(buy.reason, "qualified");
assert.equal(buy.side, "call");
assert.equal(buy.pillarsAligned, 4);
assert.ok(buy.total >= 8);
assert.equal(buy.total, leapsDecisionTotal(buyPillars), "the one-point drift and a one-point rich-IV cost cancel");

const avoid = decideLeapsStock({
  timing: { state: "avoid", side: "call" },
  pillars: buyPillars,
});
assert.equal(avoid.gate, "pass");
assert.equal(avoid.reason, "qualified");

const onePillar = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 100 }, technicals: { score: 0 }, mechanicals: { score: 0 }, fundamentals: { score: 0 } },
});
assert.equal(onePillar.gate, "watch");
assert.equal(onePillar.reason, "confluence");
assert.equal(onePillar.pillarsAligned, 1);

const put = decideLeapsStock({
  timing: { state: "go", side: "put" },
  pillars: {
    narrative: { score: -4 },
    technicals: { score: -4 },
    mechanicals: { score: -3 },
    fundamentals: { score: -1, trajectory: { dir: "declining", score: -1.5 } },
  },
});
assert.equal(put.gate, "pass");
assert.equal(put.side, "put");
const putWithoutDecline = decideLeapsStock({
  timing: { state: "go", side: "put" },
  pillars: {
    narrative: { score: -4 },
    technicals: { score: -4 },
    mechanicals: { score: -3 },
    fundamentals: { score: -1 },
  },
});
assert.equal(putWithoutDecline.gate, "watch");
assert.equal(putWithoutDecline.reason, "fundamentals-not-declining");
const decliningCall = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: {
    ...buyPillars,
    fundamentals: { score: 1, trajectory: { dir: "declining", score: -2 } },
  },
});
assert.equal(decliningCall.gate, "watch");
assert.equal(decliningCall.reason, "fundamentals-declining");
assert.equal(decliningCall.side, "call");

// A one- to two-year case cannot rest on the two inputs that turn over fastest.
const storyOnly = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 5 }, technicals: { score: 0 }, mechanicals: { score: 5 }, fundamentals: { score: 0 } },
});
assert.equal(storyOnly.durablePillarsAligned, 0);
assert.ok(Math.abs(storyOnly.total) >= 8, "narrative plus flow can still clear the score bar");
assert.equal(storyOnly.pillarsAligned, 2, "and the plain two-pillar bar");
assert.equal(storyOnly.gate, "watch");
assert.equal(storyOnly.reason, "durability");
// One durable pillar is enough.
const withTrend = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 5 }, technicals: { score: 2 }, mechanicals: { score: 5 }, fundamentals: { score: 0 } },
});
assert.equal(withTrend.durablePillarsAligned, 1);
assert.equal(withTrend.gate, "pass");
// The business itself must not point the other way, however loud the story is.
const businessAgainst = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 5 }, technicals: { score: 5 }, mechanicals: { score: 5 }, fundamentals: { score: -1 } },
});
assert.equal(businessAgainst.side, "call");
assert.ok(Math.abs(businessAgainst.total) >= 8);
assert.equal(businessAgainst.gate, "watch");
assert.equal(businessAgainst.reason, "fundamentals-against");
// A flat or missing business read is an absence, not a contradiction.
assert.equal(decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 5 }, technicals: { score: 5 }, mechanicals: { score: 3 }, fundamentals: { score: 0 } },
}).gate, "pass");

const quiet = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 1 }, technicals: { score: 1 }, mechanicals: { score: 0 }, fundamentals: { score: 0 } },
});
assert.equal(quiet.gate, "reject");
assert.equal(quiet.reason, "below-bar");
assert.ok(Math.abs(quiet.total) < 5);

const callIdea = decideLeapsStock({
  timing: { state: "go", side: "call" },
  pillars: { narrative: { score: 2 }, technicals: { score: 2 }, mechanicals: { score: 1 }, fundamentals: { score: 1 } },
});
assert.equal(callIdea.gate, "watch");
assert.equal(callIdea.reason, "moderate");
assert.equal(callIdea.side, "call");
assert.ok(callIdea.total >= 5 && callIdea.total < 8);

const putIdea = decideLeapsStock({
  timing: { state: "go", side: "put" },
  pillars: {
    narrative: { score: -2 },
    technicals: { score: -2 },
    mechanicals: { score: -1 },
    fundamentals: { score: -1, trajectory: { dir: "declining", score: -1 } },
  },
});
assert.equal(putIdea.gate, "watch");
assert.equal(putIdea.reason, "moderate");
assert.equal(putIdea.side, "put");
assert.ok(Math.abs(putIdea.total) >= 5 && Math.abs(putIdea.total) < 9);

const asOf = new Date("2026-01-15T00:00:00Z");
const leapExp = Math.floor(asOf.getTime() / 1000) + 400 * 86400;
const nearExp = Math.floor(asOf.getTime() / 1000) + 45 * 86400;
const chain = {
  spot: 100,
  chains: {
    [nearExp]: { c: [{ s: 120, b: 2, a: 2.2, iv: 0.3, oi: 100 }], p: [] },
    [leapExp]: {
      c: [
        { s: 160, b: 1, a: 1.2, iv: 0.3, oi: 10 },
        { s: 130, b: 4, a: 4.4, iv: 0.3, oi: 80 },
      ],
      p: [{ s: 70, b: 3, a: 3.3, iv: 0.3, oi: 40 }],
    },
  },
};
const callContract = selectLeapsContract(chain, "call", { now: asOf, rate: 0.045 });
assert.ok(callContract, "a listed LEAPS call is recommended");
assert.equal(callContract.side, "call");
assert.equal(callContract.structure, "long");
assert.equal(callContract.expiry, leapExp);
assert.ok(callContract.qualifiedBy.includes("delta") || callContract.qualifiedBy.includes("otm"));
assert.ok(callContract.dte >= 270 && callContract.dte <= 740);
assert.notEqual(callContract.strike, 160);
const putContract = selectLeapsContract(chain, "put", { now: asOf, rate: 0.045 });
assert.equal(putContract.side, "put");
assert.equal(putContract.strike, 70);
assert.equal(selectLeapsContract({ spot: 100, chains: { [nearExp]: chain.chains[nearExp] } }, "call", { now: asOf }), null);

const scoredBuy = buildLeapsScorePayload({
  scored: [{
    sym: "LEAP",
    timing: { state: "go", side: "call" },
    pillars: buyPillars,
    data: chain,
  }],
}, { env: {} });
assert.equal(scoredBuy.mode, "research");
assert.equal(scoredBuy.contracts, false);
assert.equal(scoredBuy.picks.length, 1);
assert.equal(scoredBuy.picks[0].gate, "pass");
assert.equal(scoredBuy.picks[0].contract, undefined);
assert.equal(JSON.stringify(scoredBuy).includes("strike"), false);
assert.equal(scoredBuy.picks[0].pillars.narrative, 5);
let scoreWrites = [];
let scoreModelCalls = 0;
const publishedScore = await publishLeapsScores({
  scored: [{ sym: "LEAP", timing: { state: "go", side: "call" }, pillars: buyPillars }],
}, {
  env: {},
  write: async (key, payload) => { scoreWrites.push({ key, payload }); },
  callModel: async () => { scoreModelCalls += 1; return { grade: "strong" }; },
});
assert.equal(publishedScore.written, true);
assert.equal(scoreWrites[0].key, LEAPS_PICKS_KEY);
assert.equal(scoreModelCalls, 0);
assert.equal(publishedScore.payload.grader, undefined);

console.log("leaps-score smoke checks passed");

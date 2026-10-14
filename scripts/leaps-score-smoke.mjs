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
  LEAPS_PILLAR_WEIGHTS,
  LEAPS_WEIGHT_TOTAL,
  buildLeapsPicksPayload,
  countLeapsGraderCalls,
  leapsScoreEnabled,
  leapsSetupGate,
  planLeapsGrader,
  publishLeapsPicks,
  runLeapsGrader,
  scoreLeapsPillars,
  scoreLeapsUniverse,
} from "../lib/leaps-score.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";

assert.equal(LEAPS_WEIGHT_TOTAL, 4.5);
assert.deepEqual(LEAPS_PILLAR_WEIGHTS, {
  narrative: 1.5,
  technicals: 1.25,
  mechanicals: 1.25,
  fundamentals: 0.5,
});

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
  (100 * 1.5) / 4.5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, technicals: 100, flow: 0, fundamentals: 0 }),
  (100 * 1.25) / 4.5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, trend: 0, flow: 100, fundamentals: 0 }),
  (100 * 1.25) / 4.5,
);
assert.equal(
  scoreLeapsPillars({ narrative: 0, technicals: 0, mechanicals: 0, fundamentals: 100 }),
  (100 * 0.5) / 4.5,
);
const mixed = (100 * 1.5 + 80 * 1.25 + 40 * 1.25 + 20 * 0.5) / 4.5;
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
assert.ok(screened.every((row) => row.gate === "unknown"));
assert.ok(screened.every((row) => row.score === mixed));
assert.equal(leapsSetupGate(universe.scored[0]), "unknown");
assert.notEqual(leapsSetupGate({ setups: { available: true, storyIgnition: true, exhaustion: false } }), "pass");

assert.equal(leapsScoreEnabled({}), false);
assert.equal(leapsScoreEnabled({ LEAPS_SCORE: "0" }), false);
assert.equal(leapsScoreEnabled({ LEAPS_SCORE: "1" }), true);
assert.equal(buildLeapsPicksPayload(universe, { env: {} }), null);

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
assert.equal(isPremiumKey("grades.json"), false);
assert.equal(roleClaimForKey("grades.json"), null);
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
assert.match(buildSrc, /const LEAPS_SCORE_ENABLED = leapsScoreEnabled\(\);/);
assert.match(
  buildSrc,
  /const aiThesis = await generateAiTheses\(preScored[\s\S]{0,900}publishLeapsAfterShortTermGrader\(preScored, builtAtIso\)/,
);
assert.equal(buildSrc.includes("THESIS_SYSTEM") && buildSrc.includes(LEAPS_GRADER_PROMPT), false);

console.log("leaps-score smoke checks passed");

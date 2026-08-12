// Offline deterministic smoke test for the moving-average crossover tracker.
import assert from "node:assert/strict";
import {
  buildMovingAverageTracker,
  scoreMovingAverageCandidate,
} from "./build.mjs";

const likely = scoreMovingAverageCandidate({
  spot: 99,
  level: 100,
  previousDistancePct: -2.4,
  move1dPct: 1.5,
  move5dPct: 4,
  rvol: 1.5,
  nearbyCount: 2,
});
assert.equal(likely.direction, "above");
assert.equal(likely.status, "likely");
assert.ok(likely.score >= 70);
assert.equal(likely.projectedSessions, 1);

const fading = scoreMovingAverageCandidate({
  spot: 101,
  level: 100,
  previousDistancePct: 0.4,
  move1dPct: 1,
  move5dPct: 2,
  rvol: 0.8,
});
assert.equal(fading.direction, "below");
assert.equal(fading.status, "watch");
assert.equal(fading.gapChangePct < 0, true);
assert.equal(scoreMovingAverageCandidate({ spot: 106, level: 100 }), null);

const closes = Array.from({ length: 201 }, (_, index) => 90 + index * 0.05);
const payload = buildMovingAverageTracker({
  TEST: {
    spot: closes.at(-1),
    priceSeries: { c: closes },
    technicals: {
      sma: { sma20: 99.525, sma50: 98.775, sma100: 97.525, sma200: 95.025 },
      volume: { priceMove1dPct: 0.05, rvol: 1.2 },
    },
    fundamentals: { name: "Test Company", sector: "Technology" },
  },
}, "2026-08-11T16:00:00.000Z");
assert.equal(payload.version, 1);
assert.equal(payload.thresholdPct, 5);
assert.equal(payload.tickers.length, 1);
assert.equal(payload.tickers[0].fiveDayBase, closes.at(-6));
assert.ok(payload.summary.inBand >= 3);
assert.ok(payload.summary.topBelow.length >= 1);

console.log("moving-average tracker smoke test passed");

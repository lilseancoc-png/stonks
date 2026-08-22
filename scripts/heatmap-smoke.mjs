// Offline deterministic checks for the Heatmap's selectable return horizons.
import assert from "node:assert/strict";
import { buildHeatmapPayload, buildHeatmapPerformance } from "./build.mjs";

const bars = [
  { t: "2025-08-21", c: 100 },
  { t: "2025-12-31", c: 110 },
  { t: "2026-05-21", c: 120 },
  { t: "2026-07-21", c: 130 },
  { t: "2026-08-14", c: 140 },
  { t: "2026-08-21", c: 150 },
];
const chain = {
  spot: 150,
  _bars: bars,
  fundamentals: { name: "Heatmap Test", marketCap: 10_000_000_000 },
  technicals: { volume: { priceMove1dPct: 1.5, avg20: 1_000_000, rvol: 1.25 } },
};

const performance = buildHeatmapPerformance(chain, "2026-08-21T16:00:00.000Z");
assert.deepEqual(performance.perf, {
  "1w": 7.14,
  "1m": 15.38,
  "3m": 25,
  "1y": 50,
  ytd: 36.36,
});
assert.deepEqual(performance.perfStart, {
  "1w": "2026-08-14",
  "1m": "2026-07-21",
  "3m": "2026-05-21",
  "1y": "2025-08-21",
  ytd: "2025-12-31",
});

const payload = buildHeatmapPayload({ AAPL: chain }, "2026-08-21T16:00:00.000Z");
assert.equal(payload.tickers.length, 1);
assert.equal(payload.tickers[0].ch, 1.5);
assert.equal(payload.tickers[0].perf["3m"], 25);
assert.equal(payload.tickers[0].perfStart.ytd, "2025-12-31");

const nearAnniversary = buildHeatmapPerformance({
  spot: 120,
  _bars: [
    { t: "2025-08-25", c: 100 },
    { t: "2026-08-21", c: 120 },
  ],
}, "2026-08-23T16:00:00.000Z");
assert.equal(nearAnniversary.perf["1y"], 20, "one-year window may use the first session just after a weekend anniversary");

const missingYearEnd = buildHeatmapPerformance({
  spot: 120,
  _bars: [
    { t: "2026-01-02", c: 100 },
    { t: "2026-08-21", c: 120 },
  ],
}, "2026-08-21T16:00:00.000Z");
assert.equal(missingYearEnd.perf.ytd, undefined, "YTD must not substitute the first current-year close for the prior-year close");

console.log("heatmap smoke: ok");

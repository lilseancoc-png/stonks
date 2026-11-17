// Offline checks for the Industry trends section's weekly Alt Data math
// (GPU cloud prices, memory chip prices, search trends). Run by path:
//   node scripts/industry-trends-smoke.mjs
import assert from "node:assert/strict";
import {
  parseVastOffers,
  matchedLaneChange,
  buildAcceleratorPricesPayload,
} from "../lib/accelerator-prices.mjs";
import { buildRamRetailComposite } from "./build.mjs";
import { timelineSeries, buildInterestMetrics } from "./refresh-search-interest.mjs";

// --- Vast.ai: the lane's GPU count comes from the offer nearest the median ---
{
  const quotes = parseVastOffers({
    offers: [
      { gpu_name: "H100 SXM", num_gpus: 8, dph_total: 8.0, rentable: true, reliability: 0.99 },
      { gpu_name: "H100 SXM", num_gpus: 1, dph_total: 2.0, rentable: true, reliability: 0.99 },
      { gpu_name: "H100 SXM", num_gpus: 2, dph_total: 6.0, rentable: true, reliability: 0.99 },
    ],
  }, "on-demand");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].price, 2, "median of $1, $2 and $3 per GPU");
  assert.equal(quotes[0].gpuCount, 1, "the 1-GPU offer is the one at the median");
  assert.equal(quotes[0].instancePrice, 2);
}

// --- GPU price change is measured lane by lane ---
{
  const lanes = {
    "vast|h100|spot": [{ d: "2026-10-09", p: 2.0 }, { d: "2026-11-13", p: 2.2 }],
    "lambda|h100|on-demand": [{ d: "2026-10-09", p: 4.0 }, { d: "2026-11-13", p: 4.4 }],
    // CoreWeave missed this week's scan: its last point is old, so it is out.
    "coreweave|h100|on-demand": [{ d: "2026-10-09", p: 1.0 }],
  };
  assert.equal(matchedLaneChange(lanes, 30), 10, "both priced lanes rose 10%");
  // The plain composite median would have read median(2, 4, 1) = 2 then
  // median(2.2, 4.4) = 3.3, a 65% "rise" with no price moving that much.
  assert.equal(matchedLaneChange({}, 30), null);
  assert.equal(matchedLaneChange({ a: [{ d: "2026-11-13", p: 3 }] }, 30), null, "one point is no change");
}

// --- A provider that fails one week does not move the 30-day change ---
{
  const lane = (providerId, market, price) => ({
    key: `${providerId}|h100|${market}`, providerId, provider: providerId, modelId: "h100", model: "NVIDIA H100",
    market, price, low: price, high: price, offerCount: null, gpuCount: 1, instancePrice: price,
  });
  const weeks = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"];
  let prior = null;
  for (const [i, d] of weeks.entries()) {
    const up = 1 + i * 0.01; // every lane rises 1% a week
    prior = buildAcceleratorPricesPayload({
      builtAtIso: `${d}T21:00:00.000Z`,
      prior,
      sources: [
        { id: "vast", name: "Vast.ai", ok: true, quotes: [lane("vast", "spot", 1.5 * up)] },
        { id: "coreweave", name: "CoreWeave", ok: true, quotes: [lane("coreweave", "on-demand", 6.0 * up)] },
        { id: "runpod", name: "Runpod", ok: true, quotes: [lane("runpod-secure", "on-demand", 2.7 * up)] },
        { id: "lambda", name: "Lambda", ok: true, quotes: [lane("lambda", "on-demand", 3.0 * up)] },
      ],
    });
  }
  // Week 6: CoreWeave (the dearest lane) fails and is carried, so it adds no point.
  const up = 1.05;
  const payload = buildAcceleratorPricesPayload({
    builtAtIso: "2026-11-13T21:00:00.000Z",
    prior,
    sources: [
      { id: "vast", name: "Vast.ai", ok: true, quotes: [lane("vast", "spot", 1.5 * up)] },
      { id: "coreweave", name: "CoreWeave", ok: false, quotes: [], error: "HTTP 503" },
      { id: "runpod", name: "Runpod", ok: true, quotes: [lane("runpod-secure", "on-demand", 2.7 * up)] },
      { id: "lambda", name: "Lambda", ok: true, quotes: [lane("lambda", "on-demand", 3.0 * up)] },
    ],
  });
  const h100 = payload.benchmarks.find((b) => b.modelId === "h100");
  assert.equal(h100.change30dPct, 5, "lanes rose 5% over the 35 days back to the first scan");
  assert.equal(h100.change7dPct, 1);
  assert.equal(payload.summary.focus.change30dPct, 5);
  assert.deepEqual(payload.summary.staleSources, ["CoreWeave"]);
  // The composite line itself drops on the failed week (median of 3 lanes
  // instead of 4); the change no longer follows it.
  const comp = h100.compositeHistory;
  assert.ok(comp[comp.length - 1].p < comp[comp.length - 2].p);
}

// --- Memory retail composite is chain-linked across category changes ---
{
  const cats = [
    { history: [{ d: "2026-10-01", avg: 100, min: 90 }, { d: "2026-10-15", avg: 110, min: 99 }] },
    { history: [{ d: "2026-10-01", avg: 200, min: 180 }, { d: "2026-10-15", avg: 220, min: 198 }] },
    { history: [{ d: "2026-10-01", avg: 300, min: 270 }, { d: "2026-10-15", avg: 330, min: 297 }] },
    // A dear category enters on the second date.
    { history: [{ d: "2026-10-15", avg: 1000, min: 900 }] },
  ];
  const comp = buildRamRetailComposite(cats);
  assert.equal(comp.length, 2);
  assert.equal(comp[1].avg, 275, "the newest point is the newest median category price");
  assert.equal(comp[0].avg, 250, "every shared category rose 10%, so the line rose 10%");
  assert.equal(comp[1].min, 248);
  assert.equal(comp[0].min, Math.round(247.5 / 1.1));
  // A date with fewer than three shared categories is skipped, not linked.
  const thin = buildRamRetailComposite([
    { history: [{ d: "2026-10-01", avg: 100 }, { d: "2026-10-15", avg: 110 }] },
    { history: [{ d: "2026-10-01", avg: 200 }] },
    { history: [{ d: "2026-10-01", avg: 300 }] },
  ]);
  assert.deepEqual(thin.map((p) => p.d), ["2026-10-01"]);
  assert.deepEqual(buildRamRetailComposite([]), []);
}

// --- Search trends: an unfinished last day is left out ---
{
  const payload = { interest_over_time: { timeline_data: [
    { timestamp: String(Date.parse("2026-11-11T00:00:00Z") / 1000), values: [{ query: "AI chips", extracted_value: 50 }] },
    { timestamp: String(Date.parse("2026-11-12T00:00:00Z") / 1000), values: [{ query: "AI chips", extracted_value: 52 }] },
    { timestamp: String(Date.parse("2026-11-13T00:00:00Z") / 1000), partial_data: true, values: [{ query: "AI chips", extracted_value: 9 }] },
  ] } };
  const series = timelineSeries(payload, "AI chips");
  assert.deepEqual(series.map((p) => p.date), ["2026-11-11", "2026-11-12"]);
  const metrics = buildInterestMetrics(series, series);
  assert.equal(metrics.asOf, "2026-11-12");
  assert.equal(metrics.relativeInterest, 100);
}

console.log("Industry trends smoke passed: Vast lane size, matched GPU changes, chain-linked memory composite, partial search day.");

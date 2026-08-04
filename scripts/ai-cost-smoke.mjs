#!/usr/bin/env node
// Offline regression checks for production Gemini cost controls.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import {
  chartPatternRefreshState,
  estimateAiBucketCost,
} from "./build.mjs";
import { assessDecisionInputsBeforeAi } from "../lib/freshness-policy.mjs";

const beforeNoon = chartPatternRefreshState(new Date("2026-08-03T15:59:00Z"));
const atNoon = chartPatternRefreshState(new Date("2026-08-03T16:00:00Z"));
const sameEtEvening = chartPatternRefreshState(new Date("2026-08-04T03:00:00Z"));
const nextEtMorning = chartPatternRefreshState(new Date("2026-08-04T14:00:00Z"));

assert.equal(beforeNoon.etDate, "2026-08-03");
assert.equal(beforeNoon.freshAllowed, false, "opening builds must defer chart vision");
assert.equal(atNoon.freshAllowed, true, "the noon build must allow the daily chart pass");
assert.equal(atNoon.bucketKey, sameEtEvening.bucketKey, "one ET day must use one cache bucket");
assert.notEqual(atNoon.bucketKey, nextEtMorning.bucketKey, "the next ET day must get a new bucket");
assert.equal(nextEtMorning.freshAllowed, false, "the next morning must wait for its own noon pass");

const oneMillion = { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0 };
assert.equal(estimateAiBucketCost("gemini-2.5-flash", oneMillion), 0.30);
assert.equal(estimateAiBucketCost("gemini-2.5-flash-lite", oneMillion), 0.10);
assert.equal(estimateAiBucketCost("gemini-flash-latest", oneMillion), 1.50);
assert.equal(estimateAiBucketCost("gemini-flash-lite-latest", oneMillion), 0.30);

const symbols = Array.from({ length: 10 }, (_, i) => `T${i}`);
const validTicker = (symbol, overrides = {}) => ({
  spot: 100,
  quoteAsOf: "2026-08-03T15:30:00.000Z",
  marketState: "REGULAR",
  chains: { 1790000000: { c: [{ k: 100 }], p: [{ k: 100 }] } },
  technicals: {},
  _bars: Array.from({ length: 20 }, (_, i) => ({ t: `2026-07-${String(i + 1).padStart(2, "0")}`, c: 100 + i })),
  mockIv: 0.3,
  symbol,
  ...overrides,
});
const freshChains = Object.fromEntries(symbols.map((symbol) => [symbol, validTicker(symbol)]));
const partialUniverse = assessDecisionInputsBeforeAi({
  chains: Object.fromEntries(symbols.slice(0, 9).map((symbol) => [symbol, validTicker(symbol)])),
  expectedSymbols: symbols,
  sampleIv: (data) => data.mockIv,
  now: new Date("2026-08-03T16:00:00.000Z"),
});
assert.match(partialUniverse.errors.join("; "), /ticker coverage 9\/10; need at least 10/);

const nineIv = assessDecisionInputsBeforeAi({
  chains: { ...freshChains, T9: validTicker("T9", { mockIv: null }) },
  expectedSymbols: symbols,
  sampleIv: (data) => data.mockIv,
  now: new Date("2026-08-03T16:00:00.000Z"),
});
assert.deepEqual(nineIv.errors, [], "90% current IV coverage must pass the shared publication policy");

const eightIv = assessDecisionInputsBeforeAi({
  chains: {
    ...freshChains,
    T8: validTicker("T8", { mockIv: null }),
    T9: validTicker("T9", { mockIv: null }),
  },
  expectedSymbols: symbols,
  sampleIv: (data) => data.mockIv,
  now: new Date("2026-08-03T16:00:00.000Z"),
});
assert.match(eightIv.errors.join("; "), /current decision-grade IV coverage 8\/10/);

const staleQuote = assessDecisionInputsBeforeAi({
  chains: { ...freshChains, T0: validTicker("T0", { quoteAsOf: "2026-07-31T19:30:00.000Z" }) },
  expectedSymbols: symbols,
  sampleIv: (data) => data.mockIv,
  now: new Date("2026-08-03T16:00:00.000Z"),
});
assert.match(staleQuote.errors.join("; "), /not from the current ET session.*T0/);

const afterHours = assessDecisionInputsBeforeAi({
  chains: Object.fromEntries(symbols.map((symbol) => [symbol, validTicker(symbol, { marketState: "POST", mockIv: null })])),
  expectedSymbols: symbols,
  sampleIv: (data) => data.mockIv,
  now: new Date("2026-08-03T22:00:00.000Z"),
});
assert.deepEqual(afterHours.errors, [], "outside regular trading, missing IV remains a warning at the final gate");

console.log("AI cost-control smoke checks passed.");

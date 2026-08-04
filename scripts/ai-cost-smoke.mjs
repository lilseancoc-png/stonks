#!/usr/bin/env node
// Offline regression checks for production Gemini cost controls.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import {
  chartPatternRefreshState,
  estimateAiBucketCost,
} from "./build.mjs";

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

console.log("AI cost-control smoke checks passed.");

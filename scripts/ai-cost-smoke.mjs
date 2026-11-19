#!/usr/bin/env node
// Offline regression checks for production Gemini cost controls.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import {
  aiDailyCallCapReached,
  estimateAiBucketCost,
  headlineCanContainAiSignals,
  isMaterialAiHeadline,
  newMaterialAiHeadlineCount,
} from "./build.mjs";
import { assessDecisionInputsBeforeAi, pruneUnpublishableTickers } from "../lib/freshness-policy.mjs";

const oneMillion = { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0 };
assert.equal(estimateAiBucketCost("gemini-2.5-flash", oneMillion), 0.30);
assert.equal(estimateAiBucketCost("gemini-2.5-flash-lite", oneMillion), 0.10);
assert.equal(estimateAiBucketCost("gemini-flash-latest", oneMillion), 1.50);
assert.equal(estimateAiBucketCost("gemini-flash-lite-latest", oneMillion), 0.30);
assert.equal(
  estimateAiBucketCost("gemini-3.1-flash-lite", { ...oneMillion, searchQueries: 2 }),
  0.25 + (2 * 0.014),
  "grounding overage must be visible in the conservative cost ceiling",
);

assert.equal(isMaterialAiHeadline("Company raises full-year guidance after earnings"), true);
assert.equal(isMaterialAiHeadline("Three stocks investors are watching this morning"), false);
assert.equal(newMaterialAiHeadlineCount(["routine market recap"], ["routine market recap", "FDA approves lead drug"]), 1);
assert.equal(headlineCanContainAiSignals("Wins a $2 billion defense contract"), true);
assert.equal(headlineCanContainAiSignals("Shares move in afternoon trading"), false);
assert.equal(aiDailyCallCapReached(600, 149, 750), false, "the final reserved slot must remain available");
assert.equal(aiDailyCallCapReached(600, 150, 750), true, "concurrent reservations must close the daily call budget exactly at the cap");

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

// One fetched ticker that cannot publish is left out like an unfetched one
// (2026-11-19: Yahoo sent SNDK 3 daily bars and every build stopped). The
// coverage rule still decides, with 95% of a 100-name universe as the bar.
const hundred = Array.from({ length: 100 }, (_, i) => `H${i}`);
const at = new Date("2026-08-03T16:00:00.000Z");
const fullHundred = () => Object.fromEntries(hundred.map((symbol) => [symbol, validTicker(symbol)]));
{
  const chains = fullHundred();
  chains.H7 = validTicker("H7", { technicals: null, _bars: [{ c: 1 }, { c: 2 }, { c: 3 }] });
  const pruned = pruneUnpublishableTickers({ chains, expectedSymbols: hundred, now: at });
  assert.deepEqual(pruned.dropped, [{ symbol: "H7", reason: "missing technicals" }]);
  assert.equal(chains.H7, undefined, "the bad ticker is removed from this build");
  assert.equal(Object.keys(chains).length, 99);
  const gate = assessDecisionInputsBeforeAi({ chains, expectedSymbols: hundred, sampleIv: (d) => d.mockIv, now: at });
  assert.deepEqual(gate.errors, [], "99/100 with one bad name must pass");
}
{
  const chains = fullHundred();
  chains.H3 = validTicker("H3", { quoteAsOf: "2026-07-31T19:30:00.000Z" });
  chains.H4 = validTicker("H4", { _bars: [] });
  const pruned = pruneUnpublishableTickers({ chains, expectedSymbols: hundred, now: at });
  assert.deepEqual(pruned.dropped.map((r) => r.symbol).sort(), ["H3", "H4"]);
  assert.match(pruned.dropped.find((r) => r.symbol === "H3").reason, /current ET session/);
  const gate = assessDecisionInputsBeforeAi({ chains, expectedSymbols: hundred, sampleIv: (d) => d.mockIv, now: at });
  assert.deepEqual(gate.errors, [], "a frozen quote and an empty history are left out, 98/100 passes");
}
{
  const chains = fullHundred();
  for (let i = 0; i < 6; i++) chains[`H${i}`] = validTicker(`H${i}`, { technicals: null });
  const pruned = pruneUnpublishableTickers({ chains, expectedSymbols: hundred, now: at });
  assert.equal(pruned.dropped.length, 6);
  const gate = assessDecisionInputsBeforeAi({ chains, expectedSymbols: hundred, sampleIv: (d) => d.mockIv, now: at });
  assert.match(gate.errors.join("; "), /ticker coverage 94\/100; need at least 95/, "too many bad names still fail the build before paid AI");
}
{
  // Outside regular trading an older quote is normal and nothing is dropped.
  const chains = Object.fromEntries(hundred.map((symbol) => [symbol, validTicker(symbol, { marketState: "POST", quoteAsOf: "2026-07-31T19:30:00.000Z" })]));
  const pruned = pruneUnpublishableTickers({ chains, expectedSymbols: hundred, now: new Date("2026-08-03T22:00:00.000Z") });
  assert.deepEqual(pruned.dropped, []);
  assert.equal(Object.keys(chains).length, 100);
}
{
  // A clean universe is untouched, and names outside the expected list are ignored.
  const chains = { ...fullHundred(), EXTRA: { spot: null } };
  const pruned = pruneUnpublishableTickers({ chains, expectedSymbols: hundred, now: at });
  assert.deepEqual(pruned.dropped, []);
  assert.ok(chains.EXTRA, "only expected symbols are judged");
}

console.log("AI cost-control smoke checks passed.");

// Premarket leaders follow-through labels (lib/premarket-movers.mjs).
import assert from "node:assert/strict";
import { updatePremarketMovers } from "../lib/premarket-movers.mjs";

const rows = ["AAA", "BBB", "CCC", "DDD"].map((t) => ({ t, n: t }));
const pre = (price) => ({ marketState: "PRE", preMarketPrice: price, regularMarketPreviousClose: 100 });
const baseline = updatePremarketMovers({
  date: "2026-11-06", capturedAtIso: "2026-11-06T13:00:00Z", marketState: "PRE", tickerRows: rows,
  quotes: { AAA: pre(104), BBB: pre(100.1), CCC: pre(97), DDD: pre(95) },
});
assert.deepEqual(baseline.gainers.map((r) => r.t), ["AAA", "BBB"]);
const open = (price) => ({ marketState: "REGULAR", regularMarketPrice: price, regularMarketPreviousClose: 100 });
const later = updatePremarketMovers({
  prior: baseline, date: "2026-11-06", capturedAtIso: "2026-11-06T15:00:00Z", marketState: "REGULAR", tickerRows: rows,
  quotes: { AAA: open(106), BBB: open(100.62), CCC: open(98), DDD: open(96) },
});
const status = Object.fromEntries(later.gainers.map((r) => [r.t, r.status]));
assert.equal(status.AAA, "soared", "+4% premarket to +6% soars");
assert.equal(status.BBB, "held", "+0.1% premarket to +0.62% is not a soar");
console.log("premarket-movers smoke ok");

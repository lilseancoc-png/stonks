// Kalshi FOMC odds (QC of builds #323-#372). Kalshi quotes markets as
// fixed-point dollar strings (last_price_dollars "0.5600") with counts in
// volume_fp; reading only the old integer-cent fields left every market NaN,
// so the Calendar's Kalshi line never appeared. Pure; no network.
import assert from "node:assert/strict";
import { kalshiMarketRow, bucketRateOutcomes, computeFomcDivergence, classifyRateOutcome } from "./build.mjs";

// Today's shape: dollar strings and fixed-point counts only.
const current = [
  { yes_sub_title: "Hike 25bps", last_price_dollars: "0.7800", yes_bid_dollars: "0.7700", yes_ask_dollars: "0.7900", volume_fp: "152340.00" },
  { yes_sub_title: "Fed maintains rate", last_price_dollars: "0.0000", yes_bid_dollars: "0.2000", yes_ask_dollars: "0.2200", volume_fp: "98000.00" },
  { yes_sub_title: "Cut 25bps", last_price_dollars: "0.0100", yes_bid_dollars: "0.0000", yes_ask_dollars: "0.0200", volume_fp: "1200.00" },
];
const rows = current.map(kalshiMarketRow);
assert.equal(rows[0].prob, 0.78, "the last trade in dollars is the probability");
assert.ok(Math.abs(rows[1].prob - 0.21) < 1e-9, "no trade: the bid/ask mid");
assert.equal(rows[2].prob, 0.01);
assert.equal(rows[0].vol, 152340);
const b = bucketRateOutcomes(rows);
assert.ok(b, "the meeting gets a Kalshi read");
assert.ok(Math.abs(b.hike + b.hold + b.cut - 1) < 1e-9);
assert.ok(b.hike > 0.75 && b.hold > 0.2 && b.cut < 0.02);
assert.equal(b.vol, 251540);

// The legacy integer-cent shape still reads.
const legacy = kalshiMarketRow({ yes_sub_title: "Cut 25bps", last_price: 0, yes_bid: 40, yes_ask: 44, volume: 900 });
assert.ok(Math.abs(legacy.prob - 0.42) < 1e-9);
assert.equal(legacy.vol, 900);
assert.equal(kalshiMarketRow({ yes_sub_title: "Hike 25bps", last_price: 63 }).prob, 0.63);

// Nothing priced: dropped, never read as 0% or 100%.
assert.ok(Number.isNaN(kalshiMarketRow({ yes_sub_title: "Hike 25bps" }).prob));
assert.equal(bucketRateOutcomes([kalshiMarketRow({ yes_sub_title: "Hike 25bps" })]), null);

// With Kalshi back, the divergence check compares three sources.
const dv = computeFomcDivergence({ hike: 0.8, hold: 0.2, cut: 0 }, b, { hike: 0.78, hold: 0.21, cut: 0.01 });
assert.deepEqual(dv.sources, ["Futures", "Kalshi", "Polymarket"]);
assert.equal(classifyRateOutcome("Fed maintains rate"), "hold");

console.log("prediction markets smoke ok");

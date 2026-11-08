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

// Yahoo's real pre-market shape: regularMarketPrice is still the LAST close
// and regularMarketPreviousClose is the close before it. SNDK on 2026-11-06:
// Nov 4 close 1037.40, Nov 5 close 806.43, 09:00 ET premarket 889.09 (+10.2%).
const yahooPre = (pre, last, prior) => ({ marketState: "PRE", preMarketPrice: pre, regularMarketPrice: last, regularMarketPreviousClose: prior });
const real = updatePremarketMovers({
  date: "2026-11-06", capturedAtIso: "2026-11-06T14:00:00Z", marketState: "PRE", tickerRows: rows,
  quotes: { AAA: yahooPre(889.09, 806.43, 1037.4), BBB: yahooPre(101, 100, 90), CCC: yahooPre(155, 183.29, 189.88), DDD: yahooPre(95, 100, 110) },
});
const sndk = real.gainers.find((r) => r.t === "AAA");
assert.ok(sndk, "a stock trading above its last close is a premarket gainer");
assert.equal(sndk.prevClose, 806.43, "the gap is measured from the last regular close");
assert.equal(sndk.prePct, 10.25);
assert.ok(real.gainers.some((r) => r.t === "BBB"), "+1% over the last close is a gainer even though it is +12% over the close before");
assert.equal(real.decliners.find((r) => r.t === "CCC")?.prePct, -15.43, "TEAM-like gap down is read from the last close");
const realOpen = updatePremarketMovers({
  prior: real, date: "2026-11-06", capturedAtIso: "2026-11-06T21:00:00Z", marketState: "POST", tickerRows: rows,
  quotes: { AAA: { marketState: "POST", regularMarketPrice: 835.06, regularMarketPreviousClose: 806.43 } },
});
assert.equal(realOpen.gainers.find((r) => r.t === "AAA")?.currentPct, 3.55, "the close is marked against the same last close");
console.log("premarket-movers smoke ok");

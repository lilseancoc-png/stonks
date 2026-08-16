import assert from "node:assert/strict";
import { classifyPendingBuyoutStage, normalizeBuyoutRumors, parsePendingBuyoutTable } from "./build.mjs";

const confirmedHtml = `
  <table><tbody><tr>
    <td><a href="https://www.sec.gov/Archives/example">ACME ✓</a></td>
    <td>Acme Systems</td><td>Big Buyer</td><td>Cash</td>
    <td>$18.20</td><td>$20.00</td><td>9.89%</td><td>42.10%</td>
    <td>86</td><td>Nov 10, 2026</td>
  </tr></tbody></table>`;

const parsed = parsePendingBuyoutTable(confirmedHtml);
assert.equal(parsed.length, 1);
assert.deepEqual(
  {
    ticker: parsed[0].targetTicker,
    target: parsed[0].target,
    acquirer: parsed[0].acquirer,
    consideration: parsed[0].considerationPerShare,
    close: parsed[0].expectedCloseAt,
    verified: parsed[0].verifiedTerms,
  },
  {
    ticker: "ACME",
    target: "Acme Systems",
    acquirer: "Big Buyer",
    consideration: 20,
    close: "2026-11-10",
    verified: true,
  },
);

const builtAtIso = "2026-08-16T15:00:00.000Z";
const quotes = {
  WDAY: { symbol: "WDAY", quoteType: "EQUITY", name: "Workday, Inc.", price: 210, marketCap: 62000000000, currency: "USD" },
  "SIG.AX": { symbol: "SIG.AX", quoteType: "EQUITY", name: "Sigma Healthcare Limited", price: 3, marketCap: 3000000000, currency: "AUD" },
};
const rumors = normalizeBuyoutRumors([
  {
    title: "Silver Lake's take-private plans for WDAY are said to be preliminary",
    providerPublishTime: "2026-08-15T13:00:00.000Z",
    relatedTickers: ["WDAY"],
    publisher: "Example News",
    link: "https://example.com/workday-rumor",
  },
  {
    title: "Boots buyout rumors return after a quiet summer",
    providerPublishTime: "2026-08-15T14:00:00.000Z",
    relatedTickers: ["SIG.AX"],
    publisher: "Example News",
    link: "https://example.com/mismatch",
  },
], quotes, builtAtIso);

assert.equal(rumors.length, 1, "a related ticker without a target-name match must not become a rumor row");
assert.equal(rumors[0].targetTicker, "WDAY");
assert.equal(rumors[0].acquirer, "Silver Lake");
assert.equal(rumors[0].considerationPerShare, null);
assert.equal(rumors[0].estimatedEquityValue, null);
assert.equal(rumors[0].expectedCloseAt, null);
assert.equal(rumors[0].verifiedTerms, false);
assert.equal(classifyPendingBuyoutStage(rumors[0]), "active_talks");
assert.equal(classifyPendingBuyoutStage({ ...rumors[0], acquirer: "Undisclosed / reported interest", headline: "Acme jumps on buyout rumors" }), "rumor");
assert.equal(classifyPendingBuyoutStage({ status: "pending", daysLeft: 70 }, "shareholder vote scheduled ahead of the merger"), "regulatory_vote");
assert.equal(classifyPendingBuyoutStage({ status: "pending", daysLeft: 20 }, "definitive agreement announced"), "expected_close");
assert.equal(classifyPendingBuyoutStage({ status: "pending", daysLeft: 90 }, "definitive agreement announced"), "announced");

console.log("pending-buyouts smoke: ok");

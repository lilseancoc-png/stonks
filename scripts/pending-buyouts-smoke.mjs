import assert from "node:assert/strict";
import { buyoutQuoteMatches, classifyPendingBuyoutStage, enrichConfirmedBuyouts, normalizeBuyoutRumors, parsePendingBuyoutTable } from "./build.mjs";

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

// A foreign target listed under its home-market code must not borrow a
// different US security's quote (Ausgold's "AUC" matched a $6.56 listing
// against a 1.36 offer), and an unmatched row has no known currency.
const foreign = { targetTicker: "AUC", targetPrice: 1.3, considerationPerShare: 1.36, grossSpreadPct: 4.65 };
const domestic = { targetTicker: "ZIM", targetPrice: 27.5, considerationPerShare: 35, grossSpreadPct: 27.3 };
const unknown = { targetTicker: "VAU", targetPrice: 5.84, considerationPerShare: 5.88, grossSpreadPct: 0.7 };
const enrichQuotes = {
  AUC: { symbol: "AUC", price: 6.56, marketCap: 145162160, currency: "USD" },
  ZIM: { symbol: "ZIM", price: 27.96, marketCap: 3373347840, currency: "USD" },
};
assert.equal(buyoutQuoteMatches(foreign, enrichQuotes.AUC), false);
assert.equal(buyoutQuoteMatches(domestic, enrichQuotes.ZIM), true);
assert.equal(buyoutQuoteMatches({ targetPrice: null }, enrichQuotes.ZIM), true, "no table price: take the quote");
const [auc, zim, vau] = enrichConfirmedBuyouts([foreign, domestic, unknown], enrichQuotes);
assert.equal(auc.targetPrice, 1.3, "a mismatched quote keeps the table's own price");
assert.equal(auc.targetMarketCap, null);
assert.equal(auc.estimatedEquityValue, null);
assert.equal(auc.currency, null);
assert.equal(auc.quoteMatched, false);
assert.equal(zim.targetPrice, 27.96);
assert.equal(zim.currency, "USD");
assert.equal(zim.estimatedEquityValue, Math.round(3373347840 * (35 / 27.96)));
assert.equal(vau.currency, null, "no quote at all: currency unknown, not USD");
assert.equal(vau.targetPrice, 5.84);

console.log("pending-buyouts smoke: ok");

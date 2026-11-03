#!/usr/bin/env node
// Offline checks for ticker-judgment cache-miss reasons and the pick-level
// call reserve. No network and no Gemini calls.
import assert from "node:assert/strict";
import {
  AI_PICK_LEVEL_RESERVE_CALLS_DEFAULT,
  aiTierReserveBlocks,
  classifyTickerJudgmentMiss,
  formatTickerJudgmentMiss,
  summarizeTickerJudgmentMisses,
  tickerJudgmentWouldReuse,
  TICKER_JUDGMENT_MISS_REASONS,
} from "../lib/ai-call-efficiency.mjs";
import {
  aiDailyCallCapReached,
  aiReserveBlocks,
  headlineIsAboutSubject,
  newMaterialAiHeadlineCount,
  tickerJudgmentSignature,
} from "./build.mjs";

const CAP = 750;
const NARRATIVE_RESERVE = 30;
const PICK_RESERVE = AI_PICK_LEVEL_RESERVE_CALLS_DEFAULT;
const DRIFT = 0.02;
const TOLERANCE = 1;

assert.equal(PICK_RESERVE, 40, "pick reserve covers 20 research + grade pairs");
assert.deepEqual(
  [...TICKER_JUDGMENT_MISS_REASONS],
  ["no-cache", "fundamentals-changed", "price-drift", "news-count", "material-headline", "other"],
);

const headlines = [
  { title: "Acme holds investor briefing", publisher: "Reuters", publishedAt: "2026-07-31T13:00:00Z" },
];
const fundamentals = {
  lastQuarter: { date: "2026-06-30", epsActual: 1.2 },
  nextEarningsDate: "2026-10-20",
  recommendationKey: "buy",
  numberOfAnalystOpinions: 20,
};
const signed = tickerJudgmentSignature(headlines, fundamentals);
const signedAgain = tickerJudgmentSignature(headlines, fundamentals);
assert.equal(signed.sig, signedAgain.sig, "signature stays stable for identical inputs");
assert.equal(signed.metaSig, signedAgain.metaSig);
assert.match(signed.fundHash, /^[0-9a-f]{12}$/);
assert.ok(signed.sig.endsWith(signed.fundHash), "fund hash remains the sig tail");
assert.ok(signed.metaSig.endsWith(signed.fundHash), "fund hash remains the meta tail");

const changedFundamentals = tickerJudgmentSignature(headlines, {
  ...fundamentals,
  recommendationKey: "hold",
});
assert.notEqual(changedFundamentals.fundHash, signed.fundHash);
assert.notEqual(changedFundamentals.sig, signed.sig);
assert.notEqual(changedFundamentals.metaSig, signed.metaSig);

const changedHeadline = tickerJudgmentSignature(
  [{ ...headlines[0], title: "Acme schedules a conference" }],
  fundamentals,
);
assert.equal(changedHeadline.fundHash, signed.fundHash, "a title change must not move the fund hash");
assert.equal(changedHeadline.metaSig, signed.metaSig, "a title change must not move the meta signature");
assert.notEqual(changedHeadline.sig, signed.sig);

const prior = {
  news: { sentiment: "neutral", paragraph: "Prior read." },
  spot: 100,
  sig: signed.sig,
  metaSig: signed.metaSig,
  titles: signed.titles,
};
const base = {
  prior,
  spot: 100,
  sig: signed.sig,
  metaSig: signed.metaSig,
  titles: signed.titles,
  driftLimit: DRIFT,
  newsTolerance: TOLERANCE,
  materialFresh: 0,
  fundHash: signed.fundHash,
};

function expectReason(name, patch, reason) {
  const input = { ...base, ...patch };
  const miss = classifyTickerJudgmentMiss(input);
  assert.equal(tickerJudgmentWouldReuse(input), miss == null, `${name} reuse agreement`);
  if (reason == null) {
    assert.equal(miss, null, name);
    return miss;
  }
  assert.equal(miss?.reason, reason, name);
  return miss;
}

expectReason("exact hit", {}, null);
expectReason("spot inside the 2% band", { spot: 101.5 }, null);
expectReason("spot exactly at the 2% band", { spot: 102 }, null);

const oneNew = [...signed.titles, "afternoon trading wrap"];
assert.equal(newMaterialAiHeadlineCount(signed.titles, oneNew), 0);
expectReason("one new ordinary headline stays inside tolerance", {
  titles: oneNew,
  sig: "headline-churn",
  materialFresh: 0,
}, null);

expectReason("no cache entry", { prior: null }, "no-cache");
expectReason("cache entry without a judgment", {
  prior: { ...prior, news: null },
}, "no-cache");

expectReason("fundamentals changed", {
  sig: changedFundamentals.sig,
  metaSig: changedFundamentals.metaSig,
  fundHash: changedFundamentals.fundHash,
}, "fundamentals-changed");

const drifted = expectReason("price drifted", { spot: 103 }, "price-drift");
assert.equal(formatTickerJudgmentMiss(drifted), "price-drift 3.00%");
assert.ok(Math.abs(drifted.driftPct - 3) < 1e-9);

const twoNew = [...signed.titles, "afternoon trading wrap", "desk marks the close"];
assert.equal(newMaterialAiHeadlineCount(signed.titles, twoNew), 0);
expectReason("new headlines past tolerance", {
  titles: twoNew,
  sig: "two-new-headlines",
  materialFresh: 0,
}, "news-count");

const materialTitles = [...signed.titles, "Acme raises full-year guidance"];
assert.equal(newMaterialAiHeadlineCount(signed.titles, materialTitles), 1);
expectReason("material headline inside the count tolerance", {
  titles: materialTitles,
  sig: "material-headline",
  materialFresh: 1,
}, "material-headline");

expectReason("same titles reuse even when the headline hash changes", {
  sig: "same-titles-different-headline-hash",
}, null);
expectReason("headline hash changed and tolerance is off", {
  sig: "same-titles-different-headline-hash",
  newsTolerance: 0,
}, "other");
expectReason("tolerance cannot run without a stored title list", {
  prior: { ...prior, titles: null },
  sig: "same-titles-different-headline-hash",
}, "other");

const pipe = signed.metaSig.lastIndexOf("|");
const retargetedMeta = `zz|${signed.metaSig.slice(0, pipe)}|${signed.fundHash}`;
expectReason("model or prompt prefix changed", {
  sig: "prefix-changed",
  metaSig: retargetedMeta,
  fundHash: signed.fundHash,
}, "other");

expectReason("incomparable spot", {
  prior: { ...prior, spot: null },
  sig: "same-news-missing-spot",
}, "other");

expectReason("fundamentals outrank a price move", {
  spot: 110,
  sig: changedFundamentals.sig,
  metaSig: changedFundamentals.metaSig,
  fundHash: changedFundamentals.fundHash,
}, "fundamentals-changed");

expectReason("price drift outranks a headline count", {
  spot: 103,
  titles: twoNew,
  sig: "drift-and-news",
  materialFresh: 0,
}, "price-drift");

expectReason("headline count outranks a material title", {
  titles: [...twoNew, "Acme wins a major contract"],
  sig: "count-and-material",
  materialFresh: 1,
}, "news-count");

const summary = summarizeTickerJudgmentMisses([
  { reason: "no-cache" },
  { reason: "price-drift" },
  { reason: "price-drift" },
  { reason: "news-count" },
  "material-headline",
  { reason: "not-a-rule" },
]);
assert.equal(
  summary,
  "no-cache 1, fundamentals-changed 0, price-drift 2, news-count 1, material-headline 1, other 1",
);

const judgmentLine = CAP - NARRATIVE_RESERVE - PICK_RESERVE;
assert.equal(aiTierReserveBlocks(judgmentLine - 1, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "judgment"), false);
assert.equal(aiTierReserveBlocks(judgmentLine, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "judgment"), true);
assert.equal(aiTierReserveBlocks(judgmentLine, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "pick"), false);
assert.equal(aiTierReserveBlocks(judgmentLine, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "bulk"), true);
assert.equal(aiTierReserveBlocks(CAP - NARRATIVE_RESERVE - 1, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "pick"), false);
assert.equal(aiTierReserveBlocks(CAP - NARRATIVE_RESERVE, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "pick"), true);
assert.equal(aiTierReserveBlocks(CAP - NARRATIVE_RESERVE, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "bulk"), true);
assert.equal(aiTierReserveBlocks(CAP - NARRATIVE_RESERVE, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "reserved"), false);
assert.equal(aiTierReserveBlocks(CAP - 1, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "reserved"), false);

let judgmentSlots = 0;
let pickSlots = 0;
let bulkSlots = 0;
let reservedSlots = 0;
for (let used = 0; used < CAP; used++) {
  if (!aiTierReserveBlocks(used, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "judgment")) judgmentSlots += 1;
  if (!aiTierReserveBlocks(used, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "pick")) pickSlots += 1;
  if (!aiTierReserveBlocks(used, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "bulk")) bulkSlots += 1;
  if (!aiTierReserveBlocks(used, CAP, NARRATIVE_RESERVE, PICK_RESERVE, "reserved")) reservedSlots += 1;
}
assert.equal(judgmentSlots, CAP - NARRATIVE_RESERVE - PICK_RESERVE);
assert.equal(pickSlots, CAP - NARRATIVE_RESERVE);
assert.equal(pickSlots - judgmentSlots, PICK_RESERVE, "pick-level calls keep the reserved block re-judgments give up");
assert.equal(bulkSlots, judgmentSlots, "charts and universe-wide extraction also leave the final-grading block intact");
assert.equal(reservedSlots, CAP, "narrative and Brief calls are not blocked by either reserve");

assert.equal(aiTierReserveBlocks(judgmentLine, CAP, NARRATIVE_RESERVE, 0, "judgment"), false, "a zero pick reserve disables the extra stop");
assert.equal(aiTierReserveBlocks(CAP - NARRATIVE_RESERVE, CAP, NARRATIVE_RESERVE, 0, "judgment"), true);
assert.equal(aiTierReserveBlocks(10_000, 0, NARRATIVE_RESERVE, PICK_RESERVE, "judgment"), false, "a disabled cap refuses nothing here");
assert.equal(aiTierReserveBlocks(0, 50, NARRATIVE_RESERVE, PICK_RESERVE, "judgment"), true);
assert.equal(aiTierReserveBlocks(0, 50, NARRATIVE_RESERVE, PICK_RESERVE, "pick"), false);
assert.equal(aiTierReserveBlocks(20, 50, NARRATIVE_RESERVE, PICK_RESERVE, "pick"), true);

assert.equal(aiReserveBlocks(3_750_000, 4_000_000, 300_000, false), true);
assert.equal(aiReserveBlocks(3_750_000, 4_000_000, 300_000, true), false);
assert.equal(aiReserveBlocks(3_000_000, 4_000_000, 300_000, false), false);
assert.equal(aiReserveBlocks(3_999_999, 4_000_000, 0, false), false);
assert.equal(aiReserveBlocks(CAP - NARRATIVE_RESERVE, CAP, NARRATIVE_RESERVE, false), true);
assert.equal(aiReserveBlocks(CAP - NARRATIVE_RESERVE - 1, CAP, NARRATIVE_RESERVE, false), false);
assert.equal(aiReserveBlocks(CAP - 1, CAP, NARRATIVE_RESERVE, true), false);
assert.equal(aiDailyCallCapReached(600, 149, CAP), false, "the final reserved slot must remain available");
assert.equal(aiDailyCallCapReached(600, 150, CAP), true, "concurrent reservations must close the daily call budget exactly at the cap");

// Model the real order: charts/extraction first, final grade next, narratives last.
let consumed = 0;
const spend = tier => {
  if (aiDailyCallCapReached(0, consumed, CAP) || aiTierReserveBlocks(consumed, CAP, NARRATIVE_RESERVE, PICK_RESERVE, tier)) return false;
  consumed++;
  return true;
};
for (let i = 0; i < CAP; i++) spend("bulk");
assert.equal(consumed, judgmentLine);
for (let i = 0; i < PICK_RESERVE; i++) assert.equal(spend("pick"), true);
assert.equal(spend("pick"), false);
for (let i = 0; i < NARRATIVE_RESERVE; i++) assert.equal(spend("reserved"), true);
assert.equal(consumed, CAP);
assert.equal(spend("reserved"), false);

// Production default (2026-11-03): re-read after 4+ new ordinary headlines.
const threeNew = [...signed.titles, "afternoon trading wrap", "desk marks the close", "sector movers recap"];
expectReason("three new ordinary headlines stay inside the production tolerance", {
  titles: threeNew,
  sig: "three-new-headlines",
  newsTolerance: 3,
}, null);
expectReason("four new ordinary headlines re-read at the production tolerance", {
  titles: [...threeNew, "five stocks to watch"],
  sig: "four-new-headlines",
  newsTolerance: 3,
}, "news-count");
expectReason("a material headline still re-reads inside the production tolerance", {
  titles: [...signed.titles, "acme raises full-year guidance"],
  sig: "material-at-three",
  newsTolerance: 3,
  materialFresh: 1,
}, "material-headline");

// Material words force an early re-read only when the headline is about the stock.
const costco = { symbol: "COST", name: "Costco Wholesale Corporation" };
assert.equal(headlineIsAboutSubject("SharkNinja Still Looks Sharp Heading Into Earnings", costco), false);
assert.equal(headlineIsAboutSubject("Marvell doubles down on AI boom with costly $115 billion Lumentum deal", costco), false);
assert.equal(headlineIsAboutSubject("Costco October sales results beat estimates", costco), true);
assert.equal(headlineIsAboutSubject("Wholesale club giant (COST) raises dividend", costco), true);
assert.equal(headlineIsAboutSubject("Is $COST a buy after earnings?", costco), true);
const apple = { symbol: "AAPL", name: "Apple Inc." };
assert.equal(headlineIsAboutSubject("Apple earnings live updates: New CEO John Ternus faces first Wall Street test", apple), true);
assert.equal(headlineIsAboutSubject("Micron Falls 4% as Kioxia's Cautious Outlook Hits Memory Stocks", apple), false);
const amd = { symbol: "AMD", name: "Advanced Micro Devices, Inc." };
assert.equal(headlineIsAboutSubject("AMD Could Swing $90.7 Billion After Earnings", amd), true, "bare ticker word");
assert.equal(headlineIsAboutSubject("Google earnings beat as cloud grows", { symbol: "GOOGL", name: "Alphabet Inc." }), true, "brand alias");
assert.equal(headlineIsAboutSubject("Memory cost pressure hits margins after earnings", costco), false, "word tickers need the name");
// Funds, missing names and ticker-only names keep the any-title rule.
assert.equal(headlineIsAboutSubject("Fed cuts rates by a quarter point", { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF" }), true);
assert.equal(headlineIsAboutSubject("Fed cuts rates by a quarter point", { symbol: "SPY", name: "SPDR S&P 500 ETF Trust" }), true);
assert.equal(headlineIsAboutSubject("Some company cuts outlook", { symbol: "XYZ", name: null }), true);
assert.equal(headlineIsAboutSubject("Some company cuts outlook", { symbol: "XYZ", name: "XYZ" }), true);
const costTitles = ["costco stock looks fully priced"];
assert.equal(newMaterialAiHeadlineCount(costTitles, [...costTitles, "sharkninja still looks sharp heading into earnings"], costco), 0,
  "an off-topic material headline counts toward the tolerance, not as material");
assert.equal(newMaterialAiHeadlineCount(costTitles, [...costTitles, "sharkninja still looks sharp heading into earnings"]), 1,
  "without a subject the old any-title rule holds");
assert.equal(newMaterialAiHeadlineCount(costTitles, [...costTitles, "costco raises membership fee"], costco), 1);

console.log("ai-call-efficiency smoke: ok");

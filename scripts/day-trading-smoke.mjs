// Offline deterministic smoke test for the stock-only day-trading engine.
// No network, no data writes. Run: node scripts/day-trading-smoke.mjs

import assert from "node:assert/strict";
import {
  DAY_TRADING_RULES,
  emptyDayTradingHistory,
  normalizeHistory,
  runDayTradingEngine,
  scoreDayTradeCandidate,
} from "../lib/day-trading-engine.mjs";

assert.equal(DAY_TRADING_RULES.entryStartEtMin, 10 * 60);
assert.equal(DAY_TRADING_RULES.forceFlatEtMin, 16 * 60);
assert.equal(DAY_TRADING_RULES.maxHoldMinutes, 120);
assert.equal(DAY_TRADING_RULES.baseScore, 70);
assert.equal(DAY_TRADING_RULES.options, undefined);

// Version-1 payloads self-heal by dropping the retired options ledger and its
// session aggregates while retaining the stock record.
const migrated = normalizeHistory({
  version: 1,
  portfolios: {
    options: { open: [{ id: "retired-option" }], closed: [{ id: "retired-close" }] },
    stock: { closed: [{ id: "kept-stock", pnl: 10 }] },
  },
  sessions: [{ date: "2026-07-29", optionsPnl: 15, optionsTrades: 1, stockPnl: 10, stockTrades: 1 }],
});
assert.deepEqual(Object.keys(migrated.portfolios), ["stock"]);
assert.equal(migrated.portfolios.stock.closed[0].id, "kept-stock");
assert.equal("optionsPnl" in migrated.sessions[0], false);

const now = new Date("2026-07-30T15:00:00.000Z"); // 11:00 ET
const market = {
  clock: { date: "2026-07-30", weekday: "Thu", minute: 660 },
  bias: "long",
  biasScore: 1.1,
  priorContextPct: 0.6,
  firstHour: { complete: true, spyRetPct: 0.8, qqqRetPct: 1.1 },
  volatility: { state: "normal", vix: 19 },
  event: { block: false, reduce: false, events: [] },
  sizeMultiplier: 1,
  thresholdAdd: 0,
};
const candidate = {
  symbol: "TEST", sector: "Software", spot: 100, direction: "long",
  volumeRatio: 3, srBreak: { type: "upper", level: 99 },
  gex: { net: -1_000_000, callWall: { strike: 105 } }, grade: 16, atr: 1.2,
  technicals: {
    rsi: 58, macd: { hist: 1.2 }, sma: { sma20: 98 }, sr: { s20: 99, r20: 106 },
  },
};

const score = scoreDayTradeCandidate(candidate, market);
assert.equal(score.pass, true);
assert.ok(score.total >= score.threshold);

// A directional-tape candidate that lands exactly on the more permissive
// 70-point execution bar is eligible, while the neutral-tape safeguard stays
// stricter.
const thresholdCandidate = structuredClone(candidate);
thresholdCandidate.volumeRatio = 1;
thresholdCandidate.srBreak = null;
thresholdCandidate.gex = { net: 1_000_000 };
thresholdCandidate.grade = 10;
const thresholdScore = scoreDayTradeCandidate(thresholdCandidate, market);
assert.equal(thresholdScore.total, 70);
assert.equal(thresholdScore.threshold, 70);
assert.equal(thresholdScore.pass, true);
const neutralThresholdScore = scoreDayTradeCandidate(thresholdCandidate, { ...market, bias: "neutral" });
assert.equal(neutralThresholdScore.threshold, 82);
assert.equal(neutralThresholdScore.pass, false);

let result = runDayTradingEngine({ history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now });
assert.deepEqual(Object.keys(result.snapshot.open), ["stock"]);
assert.equal(result.snapshot.open.stock.length, 1);
assert.ok(result.snapshot.open.stock[0].initialCash <= DAY_TRADING_RULES.startingEquity * 0.25 + 1);
assert.match(result.snapshot.open.stock[0].timeExit, /^120 minutes/);

// Same symbol cannot be opened twice.
result = runDayTradingEngine({ history: result.history, candidates: [candidate], market: structuredClone(market), now: new Date(now.getTime() + 15 * 60000) });
assert.equal(result.snapshot.open.stock.length, 1);

// The stock book honors its hard stop and creates a cost-aware record.
const stockTrade = result.snapshot.open.stock[0];
result = runDayTradingEngine({
  history: result.history,
  candidates: [],
  market: structuredClone(market),
  marks: new Map([[stockTrade.id, { spot: stockTrade.stop - 0.1 }]]),
  now: new Date(now.getTime() + 30 * 60000),
});
assert.equal(result.snapshot.open.stock.length, 0);
assert.equal(result.history.portfolios.stock.closed.at(-1).outcome, "hard-stop");
assert.ok(result.history.portfolios.stock.closed.at(-1).pnl < 0);

// The only opening-clock restriction is 10:00 ET; stock entries remain
// eligible in the last hour until the mandatory 16:00 close flatten begins.
const earlyMarket = structuredClone(market);
earlyMarket.clock.minute = 599;
assert.equal(scoreDayTradeCandidate(candidate, earlyMarket).pass, false);
assert.ok(scoreDayTradeCandidate(candidate, earlyMarket).blocked.some((reason) => /10:00/.test(reason)));
const afternoonMarket = structuredClone(market);
afternoonMarket.clock.minute = 15 * 60 + 45;
const afternoon = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: afternoonMarket,
  now: new Date("2026-07-30T19:45:00.000Z"),
});
assert.equal(afternoon.snapshot.open.stock.length, 1);
afternoonMarket.clock.minute = DAY_TRADING_RULES.forceFlatEtMin;
assert.equal(scoreDayTradeCandidate(candidate, afternoonMarket).pass, false);

// A flat trade remains open through minute 119 and times out at minute 120.
let timed = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now,
});
const timedStock = timed.snapshot.open.stock[0];
const flatMarks = new Map([[timedStock.id, { spot: 100 }]]);
timed = runDayTradingEngine({
  history: timed.history, candidates: [], market: structuredClone(market), marks: flatMarks,
  now: new Date(now.getTime() + 119 * 60000),
});
assert.equal(timed.snapshot.open.stock.length, 1);
timed = runDayTradingEngine({
  history: timed.history, candidates: [], market: structuredClone(market), marks: flatMarks,
  now: new Date(now.getTime() + 120 * 60000),
});
assert.equal(timed.snapshot.open.stock.length, 0);
assert.equal(timed.history.portfolios.stock.closed.at(-1).outcome, "time-stop");

// Force-flat closes the stock book even when the final quote lookup fails.
let forced = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now,
});
const closeMarket = structuredClone(market);
closeMarket.clock.minute = DAY_TRADING_RULES.forceFlatEtMin;
forced = runDayTradingEngine({
  history: forced.history, candidates: [], market: closeMarket, marks: new Map(),
  now: new Date("2026-07-30T20:00:00.000Z"),
});
assert.equal(forced.snapshot.open.stock.length, 0);
assert.equal(forced.history.portfolios.stock.closed.at(-1).outcome, "session-close");
assert.equal(forced.history.portfolios.stock.closed.at(-1).exits.at(-1).markFallback, "entry-spot");

// Recovery time includes an active drawdown, not only a recovered drawdown.
const recoveryHistory = emptyDayTradingHistory();
const recoveryBook = recoveryHistory.portfolios.stock;
recoveryBook.resetEquity = 9_000;
recoveryBook.trueEquity = 9_000;
recoveryBook.highWaterMark = 10_000;
recoveryBook.equityCurve = [{ at: "2026-07-28T14:00:00.000Z", reset: 9_000, true: 9_000, reason: "loss" }];
const recovery = runDayTradingEngine({
  history: recoveryHistory, candidates: [], market: structuredClone(market),
  now: new Date("2026-07-30T15:00:00.000Z"),
});
assert.equal(recovery.snapshot.portfolios.stock.longestRecoveryHours, 49);

console.log("day-trading smoke test passed");

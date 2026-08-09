// Offline deterministic smoke test for lib/day-trading-engine.mjs.
// No network, no data writes. Run: node scripts/day-trading-smoke.mjs

import assert from "node:assert/strict";
import {
  DAY_TRADING_RULES,
  emptyDayTradingHistory,
  runDayTradingEngine,
  scoreDayTradeCandidate,
} from "../lib/day-trading-engine.mjs";
import { isUsEquityMarketHoliday, tradingDaysBetween } from "./scan-day-trading.mjs";

assert.equal(tradingDaysBetween("2026-07-30", "2026-07-31"), 1);
assert.equal(tradingDaysBetween("2026-07-31", "2026-08-03"), 1);
assert.equal(tradingDaysBetween("2026-07-30", "2026-08-03"), 2);
assert.equal(tradingDaysBetween("2026-07-02", "2026-07-06"), 1); // Independence Day observed
assert.equal(tradingDaysBetween("2026-12-24", "2026-12-28"), 1); // Christmas
assert.equal(tradingDaysBetween("2026-04-02", "2026-04-06"), 1); // Good Friday
assert.equal(isUsEquityMarketHoliday("2021-12-31"), true); // New Year's Day 2022 observed
assert.equal(DAY_TRADING_RULES.entryStartEtMin, 10 * 60);
assert.equal(DAY_TRADING_RULES.forceFlatEtMin, 16 * 60);
assert.equal(DAY_TRADING_RULES.maxHoldMinutes, 120);

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
  symbol: "SPY", sector: "Indexes", spot: 100, direction: "long",
  volumeRatio: 3, srBreak: { type: "upper", level: 99 },
  gex: { net: -1_000_000, callWall: { strike: 105 } }, grade: 16, atr: 1.2,
  technicals: {
    rsi: 58, macd: { hist: 1.2 }, sma: { sma20: 98 }, sr: { s20: 99, r20: 106 },
  },
  option: { side: "call", expiry: "2026-07-31", strike: 100, bid: 0.95, ask: 1, last: 0.98, iv: 0.5, oi: 1000, volume: 500 },
};

const score = scoreDayTradeCandidate(candidate, market);
assert.equal(score.pass, true);
assert.ok(score.total >= score.threshold);

let result = runDayTradingEngine({ history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now });
assert.equal(result.snapshot.open.options.length, 1);
assert.equal(result.snapshot.open.stock.length, 1);
assert.ok(result.snapshot.open.options[0].initialCash <= DAY_TRADING_RULES.startingEquity * 0.25);
assert.ok(result.snapshot.open.stock[0].initialCash <= DAY_TRADING_RULES.startingEquity * 0.25 + 1);
assert.match(result.snapshot.open.options[0].timeExit, /^120 minutes/);

// Same symbol cannot be opened twice; the existing positions remain one each.
result = runDayTradingEngine({ history: result.history, candidates: [candidate], market: structuredClone(market), now: new Date(now.getTime() + 15 * 60000) });
assert.equal(result.snapshot.open.options.length, 1);
assert.equal(result.snapshot.open.stock.length, 1);

// Both books honor their hard stops and create closed, cost-aware records.
const optionTrade = result.snapshot.open.options[0];
const stockTrade = result.snapshot.open.stock[0];
const marks = new Map([
  [optionTrade.id, { bid: 0.45, ask: 0.5, last: 0.47 }],
  [stockTrade.id, { spot: stockTrade.stop - 0.1 }],
]);
result = runDayTradingEngine({ history: result.history, candidates: [], market: structuredClone(market), marks, now: new Date(now.getTime() + 30 * 60000) });
assert.equal(result.snapshot.open.options.length, 0);
assert.equal(result.snapshot.open.stock.length, 0);
assert.equal(result.history.portfolios.options.closed.at(-1).outcome, "hard-stop");
assert.equal(result.history.portfolios.stock.closed.at(-1).outcome, "hard-stop");
assert.ok(result.history.portfolios.options.closed.at(-1).pnl < 0);
assert.ok(result.history.portfolios.stock.closed.at(-1).pnl < 0);

// The only opening-clock restriction is 10:00 ET; entries remain eligible in
// the last hour until the mandatory 16:00 close flatten begins.
const earlyMarket = structuredClone(market);
earlyMarket.clock.minute = 599;
assert.equal(scoreDayTradeCandidate(candidate, earlyMarket).pass, false);
assert.ok(scoreDayTradeCandidate(candidate, earlyMarket).blocked.some((reason) => /10:00/.test(reason)));
const lateMarket = structuredClone(market);
lateMarket.clock.minute = 880; // 14:40 ET
assert.equal(scoreDayTradeCandidate(candidate, lateMarket).pass, true);
lateMarket.clock.minute = DAY_TRADING_RULES.forceFlatEtMin;
assert.equal(scoreDayTradeCandidate(candidate, lateMarket).pass, false);

// The 1DTE book can actually open in the final hour; 9:30-10:00 is observation,
// not its only entry window.
const afternoonMarket = structuredClone(market);
afternoonMarket.clock.minute = 15 * 60 + 45;
const afternoon = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: afternoonMarket,
  now: new Date("2026-07-30T19:45:00.000Z"),
});
assert.equal(afternoon.snapshot.open.options.length, 1);

// A flat trade remains open through minute 119 and times out at minute 120.
let timed = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now,
});
const timedOption = timed.snapshot.open.options[0];
const timedStock = timed.snapshot.open.stock[0];
const flatMarks = new Map([
  [timedOption.id, { bid: 1.05, ask: 1.06, last: 1.05 }],
  [timedStock.id, { spot: 100 }],
]);
timed = runDayTradingEngine({
  history: timed.history, candidates: [], market: structuredClone(market), marks: flatMarks,
  now: new Date(now.getTime() + 119 * 60000),
});
assert.equal(timed.snapshot.open.options.length, 1);
assert.equal(timed.snapshot.open.stock.length, 1);
timed = runDayTradingEngine({
  history: timed.history, candidates: [], market: structuredClone(market), marks: flatMarks,
  now: new Date(now.getTime() + 120 * 60000),
});
assert.equal(timed.snapshot.open.options.length, 0);
assert.equal(timed.snapshot.open.stock.length, 0);
assert.equal(timed.history.portfolios.options.closed.at(-1).outcome, "time-stop");
assert.equal(timed.history.portfolios.stock.closed.at(-1).outcome, "time-stop");

// The stock book can use the wider candidate universe; the 1DTE book cannot.
const singleName = { ...candidate, symbol: "TEST" };
const singleNameResult = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [singleName], market: structuredClone(market), now,
});
assert.equal(singleNameResult.snapshot.open.options.length, 0);
assert.equal(singleNameResult.snapshot.open.stock.length, 1);
assert.ok(singleNameResult.snapshot.decisions[0].reasons.some((reason) => /SPY\/QQQ\/IWM/.test(reason)));

// The force-flat authority must close both books even when the final quote or
// chain lookup fails. With no prior mark, the engine uses the entry reference
// and records that fallback explicitly instead of carrying risk overnight.
let forced = runDayTradingEngine({
  history: emptyDayTradingHistory(), candidates: [candidate], market: structuredClone(market), now,
});
const closeMarket = structuredClone(market);
closeMarket.clock.minute = DAY_TRADING_RULES.forceFlatEtMin;
forced = runDayTradingEngine({
  history: forced.history, candidates: [], market: closeMarket, marks: new Map(),
  now: new Date("2026-07-30T20:00:00.000Z"),
});
assert.equal(forced.snapshot.open.options.length, 0);
assert.equal(forced.snapshot.open.stock.length, 0);
assert.equal(forced.history.portfolios.options.closed.at(-1).outcome, "session-close");
assert.equal(forced.history.portfolios.stock.closed.at(-1).outcome, "session-close");
assert.equal(forced.history.portfolios.options.closed.at(-1).exits.at(-1).markFallback, "entry-fill");
assert.equal(forced.history.portfolios.stock.closed.at(-1).exits.at(-1).markFallback, "entry-spot");

// Recovery time includes an active drawdown, not only drawdowns that later
// recovered to their prior peak.
const recoveryHistory = emptyDayTradingHistory();
for (const book of Object.values(recoveryHistory.portfolios)) {
  book.resetEquity = 9_000;
  book.trueEquity = 9_000;
  book.highWaterMark = 10_000;
  book.equityCurve = [{ at: "2026-07-28T14:00:00.000Z", reset: 9_000, true: 9_000, reason: "loss" }];
}
const recovery = runDayTradingEngine({
  history: recoveryHistory, candidates: [], market: structuredClone(market),
  now: new Date("2026-07-30T15:00:00.000Z"),
});
assert.equal(recovery.snapshot.portfolios.options.longestRecoveryHours, 49);
assert.equal(recovery.snapshot.portfolios.stock.longestRecoveryHours, 49);

console.log("day-trading smoke test passed");

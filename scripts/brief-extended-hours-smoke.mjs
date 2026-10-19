import assert from "node:assert/strict";
import {
  buildBriefExtendedHours,
  briefEarningsInWindow,
  previousWeekdayKey,
  quoteExtendedMove,
} from "../lib/brief-extended-hours.mjs";
import { gatherBriefSignals, briefUserMessage } from "./build.mjs";

// Monday 2026-10-19. Friday 2026-10-16 is the previous session.
const today = "2026-10-19";
assert.equal(previousWeekdayKey(today), "2026-10-16");
assert.equal(previousWeekdayKey("2026-10-21"), "2026-10-20");

const preTime = new Date("2026-10-19T12:15:00Z"); // 08:15 ET
const friday = new Date("2026-10-16T20:00:00Z");
const pre = (price, pct, extra = {}) => ({
  marketState: "PRE", regularMarketPrice: 100, regularMarketTime: friday,
  preMarketPrice: price, preMarketChangePercent: pct, preMarketTime: preTime, ...extra,
});

// Yahoo's own change percent wins; price math is the fallback.
assert.deepEqual(quoteExtendedMove(pre(103, 3), "premarket", today), { pct: 3, price: 103 });
assert.deepEqual(quoteExtendedMove(pre(95, undefined), "premarket", today), { pct: -5, price: 95 });
// A pre-market print from an earlier day is not today's indication.
assert.equal(quoteExtendedMove(pre(103, 3, { preMarketTime: friday }), "premarket", today), null);
// Bad prints and missing prices are dropped.
assert.equal(quoteExtendedMove(pre(500, 400), "premarket", today), null);
assert.equal(quoteExtendedMove({ regularMarketPrice: 100 }, "premarket", today), null);
// After hours needs today's regular close as the reference.
const postToday = {
  regularMarketPrice: 50, regularMarketTime: new Date("2026-10-19T20:00:00Z"),
  postMarketPrice: 47, postMarketChangePercent: -6, postMarketTime: new Date("2026-10-19T20:40:00Z"),
};
assert.deepEqual(quoteExtendedMove(postToday, "afterhours", today), { pct: -6, price: 47 });
assert.equal(quoteExtendedMove({ ...postToday, regularMarketTime: friday }, "afterhours", today), null);

const chains = {
  SPY: { spot: 600 },
  QQQ: { spot: 500 },
  // Reported after Friday's close; the store already has the EPS.
  NFLX: { earningsHx: { events: [{ date: "2026-10-16", session: "PM", epsActual: 5.2, epsEstimate: 4.9, surprisePct: 6.12 }] } },
  // Reports before Monday's open.
  JPM: { fundamentals: { nextEarningsDate: "2026-10-19", nextEarningsSession: "AM" } },
  // Reported before Friday's open: already in Friday's close, not overnight news.
  BAC: { earningsHx: { events: [{ date: "2026-10-16", session: "AM" }] } },
  // Reports after Monday's close.
  TSLA: { fundamentals: { nextEarningsDate: "2026-10-19", nextEarningsSession: "PM" } },
  AAPL: { spot: 200 },
  MSFT: { spot: 400 },
};

const morningEarn = briefEarningsInWindow({ chains, session: "premarket", todayEt: today });
assert.deepEqual(morningEarn.map((e) => e.sym).sort(), ["JPM", "NFLX"]);
assert.equal(morningEarn.find((e) => e.sym === "NFLX").when, "after the last close");
assert.equal(morningEarn.find((e) => e.sym === "NFLX").epsActual, 5.2);
assert.equal(morningEarn.find((e) => e.sym === "JPM").when, "before today's open");

const quotes = {
  SPY: pre(100.4, 0.4),
  QQQ: pre(99.1, -0.9),
  NFLX: pre(107.5, 7.5),
  AAPL: pre(101, 1), // under the 2% bar: not a mover
  MSFT: pre(96.8, -3.2),
  UNKNOWN: pre(130, 30), // not in the universe
};
const morning = buildBriefExtendedHours({ kind: "morning", quotes, chains, todayEt: today, asOfIso: preTime.toISOString() });
assert.equal(morning.session, "premarket");
assert.deepEqual(morning.indexes.map((m) => [m.sym, m.chPct]), [["SPY", 0.4], ["QQQ", -0.9]]);
assert.deepEqual(morning.movers.gainers, [{ sym: "NFLX", chPct: 7.5 }]);
assert.deepEqual(morning.movers.losers, [{ sym: "MSFT", chPct: -3.2 }]);
// Priced reactions first, then the print with no pre-market trade yet.
assert.deepEqual(morning.earnings.map((e) => [e.sym, e.chPct]), [["NFLX", 7.5], ["JPM", null]]);
assert.equal(buildBriefExtendedHours({ kind: "intraday", quotes, chains, todayEt: today }), null);
assert.equal(buildBriefExtendedHours({ kind: "morning", quotes: {}, chains: { AAPL: {} }, todayEt: today }), null);

const closing = buildBriefExtendedHours({ kind: "afternoon", quotes: { TSLA: { ...postToday, postMarketPrice: 94, postMarketChangePercent: -6 } }, chains, todayEt: today });
assert.deepEqual(closing.earnings, [{ sym: "TSLA", date: today, when: "after today's close", chPct: -6 }]);
assert.deepEqual(closing.movers.losers, [{ sym: "TSLA", chPct: -6 }]);

// The fact sheet the model reads carries the block, and the closing calendar
// now names tonight's reporters instead of skipping them.
const mSignals = gatherBriefSignals("morning", { chains: {}, extended: morning });
assert.ok(mSignals.extended);
const mPrompt = briefUserMessage("morning", today, mSignals);
assert.match(mPrompt, /Pre-market trading as of 8:15 AM ET/);
assert.match(mPrompt, /NFLX: reported after the last close, EPS 5\.2 vs 4\.9 est \(\+6\.1% surprise\), \+7\.50% pre-market/);
assert.match(mPrompt, /JPM: reported before today's open, no pre-market trade yet/);

const aSignals = gatherBriefSignals("afternoon", {
  chains: {},
  extended: closing,
  calendar: { todayEarnings: [{ sym: "TSLA", session: "PM" }, { sym: "JPM", session: "AM" }], upcomingEarn: [] },
});
assert.deepEqual(aSignals.events.map((e) => e.label), ["TSLA earnings"]);
assert.equal(aSignals.events[0].detail, "tonight, after the close");
const aPrompt = briefUserMessage("afternoon", today, aSignals);
assert.match(aPrompt, /After-hours trading/);
assert.match(aPrompt, /TSLA: reported after today's close, -6\.00% after hours/);

// A quiet session with nothing to report adds nothing.
assert.equal(gatherBriefSignals("morning", { chains: {}, extended: { session: "premarket", indexes: [], movers: { gainers: [], losers: [] }, earnings: [] } }).extended, undefined);

console.log("brief extended-hours smoke: ok");

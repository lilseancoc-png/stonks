#!/usr/bin/env node
// Offline checks for LEAPS paper tracking. No network, no AI, no secrets.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LEAPS_PAPER_KEY,
  LEAPS_STALE_REVIEW_DAYS,
  advanceLeapsPaperTrack,
  calendarDaysBetween,
  leapsContractKey,
  leapsTimeExitDate,
  shouldWriteLeapsPaper,
} from "../lib/leaps-paper-track.mjs";
import { LEAPS_PAPER_KEY as OWNERSHIP_KEY, REQUEST_TIME_EXCLUSIVE_KEYS, SCANNER_EXCLUSIVE_KEYS, isBakeOwnedKey } from "../lib/data-ownership.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";

function assertPnlIdentity(book) {
  for (const idea of Object.values(book.ideas)) {
    const rows = book.positions.filter((position) => position.ideaId === idea.id);
    const realized = rows
      .filter((position) => position.status === "closed")
      .reduce((sum, position) => sum + (typeof position.pnl === "number" ? position.pnl : 0), 0);
    const unrealized = rows
      .filter((position) => position.status !== "closed")
      .reduce((sum, position) => sum + (typeof position.pnl === "number" ? position.pnl : 0), 0);
    assert.equal(idea.realizedPnl, Math.round(realized * 100) / 100);
    assert.equal(idea.unrealizedPnl, Math.round(unrealized * 100) / 100);
    assert.equal(idea.pnl, Math.round((realized + unrealized) * 100) / 100);
    assert.deepEqual(idea.positionIds, rows.map((position) => position.id));
  }
  const ideaPnl = Object.values(book.ideas).reduce((sum, idea) => sum + idea.pnl, 0);
  const positionPnl = book.positions.reduce((sum, position) => sum + (typeof position.pnl === "number" ? position.pnl : 0), 0);
  assert.equal(Math.round(ideaPnl * 100) / 100, Math.round(positionPnl * 100) / 100);
}

function step(book, asOf, ideas, quotes = {}, stocks = {}) {
  const before = book == null ? null : structuredClone(book);
  const next = advanceLeapsPaperTrack({ book, asOf, ideas, quotes, stocks });
  if (before) assert.deepEqual(book, before, "a session must not mutate the prior book");
  assert.equal(next.asOf, next.lastProcessedDate);
  assertPnlIdentity(next);
  return next;
}

function idea(overrides = {}) {
  return {
    id: "nvda-1",
    symbol: "nvda",
    side: "call",
    strike: 150,
    expiration: "2027-06-18",
    ask: 10,
    target: 400,
    ...overrides,
  };
}

function q(bid, ask, asOf, extra = {}) {
  return { bid, ask, asOf, ...extra };
}

function stock(close, asOf) {
  return { NVDA: { close, asOf } };
}

function keyFor(row) {
  return leapsContractKey(row);
}

assert.equal(leapsTimeExitDate("2027-06-18"), "2026-12-18");
assert.equal(leapsTimeExitDate("2027-03-31"), "2026-09-30");
assert.equal(leapsTimeExitDate("2027-08-31"), "2027-02-28");
assert.equal(leapsTimeExitDate("2028-08-31"), "2028-02-29");
const sixMonthDays = calendarDaysBetween("2026-12-18", "2027-06-18");
assert.equal(sixMonthDays, 182);
assert.ok(sixMonthDays > 126, "the six-month exit is a calendar span, not a trading-day count");

assert.equal(shouldWriteLeapsPaper([]), false);
assert.equal(shouldWriteLeapsPaper(null), false);
assert.equal(shouldWriteLeapsPaper([idea()]), true);

const base = idea();
const contract = keyFor(base);

// Fill at the ask. A live mid on the same close does not replace the fill.
{
  const opened = step(null, "2026-10-13", [base], { [contract]: q(14, 16, "2026-10-13") }, stock(120, "2026-10-13"));
  assert.equal(opened.positions.length, 1);
  const position = opened.positions[0];
  assert.equal(position.symbol, "NVDA");
  assert.equal(position.entryAsk, 10);
  assert.equal(position.mark, 15);
  assert.equal(position.pnl, 500);
  assert.equal(position.status, "open");
  assert.equal(position.exit, null);
}

// No ask, a non-positive ask, or a quote mid with no ask does not open.
{
  const midOnly = { [contract]: q(9, 11, "2026-10-13") };
  for (const ask of [undefined, null, 0, -1, Number.NaN]) {
    const row = idea({ ask });
    delete row.ask;
    if (ask !== undefined) row.ask = ask;
    const book = step(null, "2026-10-13", [row], midOnly, stock(120, "2026-10-13"));
    assert.equal(book.positions.length, 0, `ask ${String(ask)} must not fill at mid`);
  }
}

// One open position per name, and the same idea the next session does not open another.
{
  const first = step(null, "2026-10-13", [base, idea({ id: "nvda-2", ask: 11 })], { [contract]: q(10, 10, "2026-10-13") });
  assert.equal(first.positions.length, 1);
  assert.equal(first.positions[0].ideaId, "nvda-1");
  const second = step(first, "2026-10-14", [base, idea({ id: "nvda-2", ask: 11 })], { [contract]: q(10.2, 10.4, "2026-10-14") });
  assert.equal(second.positions.length, 1);
  assert.equal(second.positions[0].id, first.positions[0].id);
  assert.equal(second.summary.open, 1);
}

// A different name can open beside it. A different idea on the same name waits until the slot is free,
// and the original idea id still does not re-enroll after it closes.
{
  const other = idea({ id: "aapl-1", symbol: "AAPL", strike: 200, ask: 8, target: 500 });
  const both = step(null, "2026-10-13", [base, other]);
  assert.equal(both.summary.open, 2);
  const held = step(both, "2026-10-14", [base], { [contract]: q(20, 20, "2026-10-14") }, stock(120, "2026-10-14"));
  const closed = held.positions.find((position) => position.ideaId === "nvda-1");
  assert.equal(closed.exit.reason, "doubled");
  const again = step(held, "2026-10-15", [base], { [contract]: q(21, 21, "2026-10-15") });
  assert.equal(again.positions.filter((position) => position.ideaId === "nvda-1").length, 1);
  const replacement = step(again, "2026-10-16", [idea({ id: "nvda-2", ask: 9, target: 500 })]);
  const nvdaOpen = replacement.positions.filter((position) => position.symbol === "NVDA" && position.status === "open");
  assert.equal(nvdaOpen.length, 1);
  assert.equal(nvdaOpen[0].ideaId, "nvda-2");
}

// +20% and -50% option moves are not exits. A high print is not the close.
{
  let book = step(null, "2026-10-13", [base]);
  book = step(book, "2026-10-14", [base], { [contract]: q(11.8, 12.2, "2026-10-14", { high: 100 }) }, stock(120, "2026-10-14"));
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].mark, 12);
  assert.equal(book.positions[0].exit, null);
  book = step(book, "2026-10-15", [base], { [contract]: q(4.8, 5.2, "2026-10-15") }, stock(120, "2026-10-15"));
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].mark, 5);
  assert.equal(book.positions[0].pnl, -500);
}

// Doubled is the close mid against twice the entry ask. Just under stays open.
{
  let book = step(null, "2026-10-13", [base]);
  book = step(book, "2026-10-14", [base], { [contract]: q(19, 19, "2026-10-14") });
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].mark, 19);
  book = step(book, "2026-10-15", [base], { [contract]: q(20, 20, "2026-10-15") });
  assert.equal(book.positions[0].status, "closed");
  assert.equal(book.positions[0].exit.reason, "doubled");
  assert.equal(book.positions[0].exit.price, 20);
  assert.equal(book.positions[0].exit.pnl, 1000);
}

// Stock target. Calls use close >= target. Puts use close <= target.
{
  let book = step(null, "2026-10-13", [idea({ target: 150 })]);
  book = step(book, "2026-10-14", [idea({ target: 150 })], { [contract]: q(10, 10.4, "2026-10-14") }, stock(149, "2026-10-14"));
  assert.equal(book.positions[0].status, "open");
  book = step(book, "2026-10-15", [idea({ target: 150 })], { [contract]: q(11, 11, "2026-10-15") }, stock(150, "2026-10-15"));
  assert.equal(book.positions[0].exit.reason, "target");
  assert.equal(book.positions[0].exit.price, 11);

  const put = idea({ id: "put-1", side: "put", strike: 150, target: 100, ask: 8 });
  const putKey = keyFor(put);
  let puts = step(null, "2026-10-13", [put]);
  puts = step(puts, "2026-10-14", [put], { [putKey]: q(8, 8, "2026-10-14") }, { NVDA: { close: 101, asOf: "2026-10-14" } });
  assert.equal(puts.positions[0].status, "open");
  puts = step(puts, "2026-10-15", [put], { [putKey]: q(9, 9, "2026-10-15") }, { NVDA: { close: 100, asOf: "2026-10-15" } });
  assert.equal(puts.positions[0].exit.reason, "target");
}

// External flag, then the calendar six-month exit. The day before the threshold stays open.
{
  let book = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
  book = step(book, "2026-10-14", [idea({ exitFlag: true })], { [contract]: q(10.5, 11.5, "2026-10-14") });
  assert.equal(book.positions[0].exit.reason, "flag");
  assert.equal(book.positions[0].exit.price, 11);
  assert.equal(book.positions.length, 1);

  let timed = step(null, "2026-12-17", [base], { [contract]: q(10, 10, "2026-12-17") }, stock(120, "2026-12-17"));
  assert.equal(timed.positions[0].status, "open");
  timed = step(timed, "2026-12-18", [base], { [contract]: q(10, 11, "2026-12-18") }, stock(120, "2026-12-18"));
  assert.equal(timed.positions[0].exit.reason, "time");
  assert.equal(timed.positions[0].exit.date, "2026-12-18");
  assert.equal(timed.positions[0].exit.price, 10.5);
  assert.equal(calendarDaysBetween("2026-12-18", base.expiration), sixMonthDays);
}

// Same-day tie records one reason, in order: target, doubled, flag, time.
{
  const tieDay = "2026-12-18";
  const tieQuote = { [contract]: q(19, 21, tieDay) };
  const tieStock = stock(400, tieDay);
  const open = () => step(null, "2026-12-17", [base], { [contract]: q(10, 10, "2026-12-17") }, stock(120, "2026-12-17"));
  const targetTie = step(open(), tieDay, [idea({ exitFlag: true })], tieQuote, tieStock);
  assert.equal(targetTie.positions.length, 1);
  assert.equal(targetTie.positions[0].exit.reason, "target");

  const doubledTie = step(open(), tieDay, [idea({ exitFlag: true, target: 900 })], tieQuote, stock(120, tieDay));
  assert.equal(doubledTie.positions[0].exit.reason, "doubled");

  const flagTie = step(open(), tieDay, [idea({ exitFlag: true, target: 900 })], { [contract]: q(11, 11, tieDay) }, stock(120, tieDay));
  assert.equal(flagTie.positions[0].exit.reason, "flag");

  const timeTie = step(open(), tieDay, [idea({ target: 900 })], { [contract]: q(11, 11, tieDay) }, stock(120, tieDay));
  assert.equal(timeTie.positions[0].exit.reason, "time");
}

// Roll closes the old position and, when the idea is still active and the new ask is positive,
// opens the replacement the same session. Target, doubled, and flag beat a roll. A roll beats the time stop.
{
  const rollTo = { strike: 180, expiration: "2028-06-16", ask: 7 };
  let book = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
  book = step(book, "2026-10-14", [idea({ rollTo })], { [contract]: q(12, 12, "2026-10-14") });
  assert.equal(book.positions.length, 2);
  const old = book.positions[0];
  const rolled = book.positions[1];
  assert.equal(old.exit.reason, "roll");
  assert.equal(old.exit.price, 12);
  assert.equal(old.pnl, 200);
  assert.equal(old.status, "closed");
  assert.equal(rolled.status, "open");
  assert.equal(rolled.entryAsk, 7);
  assert.equal(rolled.strike, 180);
  assert.equal(rolled.expiration, "2028-06-16");
  assert.equal(rolled.rolledFrom, old.id);
  assert.equal(rolled.ideaId, old.ideaId);
  assert.equal(rolled.pnl, 0);
  assert.equal(book.ideas["nvda-1"].pnl, 200);
  assert.equal(book.ideas["nvda-1"].realizedPnl, 200);
  assert.equal(book.ideas["nvda-1"].unrealizedPnl, 0);
  assert.equal(book.summary.open, 1);
  const rolledKey = keyFor(rolled);
  const carried = step(book, "2026-10-15", [idea({ rollTo })], { [rolledKey]: q(7, 8, "2026-10-15") });
  assert.equal(carried.positions[1].status, "open");
  assert.equal(carried.positions[1].mark, 7.5);
  assert.equal(carried.positions[1].frozen, false);
  assert.equal(carried.ideas["nvda-1"].pnl, 250);

  const noAsk = step(
    step(null, "2026-10-13", [base]),
    "2026-10-14",
    [idea({ rollTo: { ...rollTo, ask: 0 } })],
    { [contract]: q(12, 12, "2026-10-14") },
  );
  assert.equal(noAsk.positions.length, 1);
  assert.equal(noAsk.positions[0].exit.reason, "roll");
  assert.equal(noAsk.summary.open, 0);

  const inactive = step(
    step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") }),
    "2026-10-14",
    [idea({ active: false, rollTo })],
    { [contract]: q(12, 12, "2026-10-14") },
  );
  assert.equal(inactive.positions.length, 1);
  assert.equal(inactive.positions[0].status, "open");

  const targetBeatsRoll = step(
    step(null, "2026-10-13", [idea({ target: 150 })]),
    "2026-10-14",
    [idea({ target: 150, rollTo })],
    { [contract]: q(11, 11, "2026-10-14") },
    stock(150, "2026-10-14"),
  );
  assert.equal(targetBeatsRoll.positions.length, 1);
  assert.equal(targetBeatsRoll.positions[0].exit.reason, "target");

  const rollBeatsTime = step(
    step(null, "2026-12-17", [base], { [contract]: q(10, 10, "2026-12-17") }),
    "2026-12-18",
    [idea({ rollTo })],
    { [contract]: q(10, 10, "2026-12-18") },
    stock(120, "2026-12-18"),
  );
  assert.equal(rollBeatsTime.positions[0].exit.reason, "roll");
  assert.equal(rollBeatsTime.positions[1].status, "open");
  assert.equal(rollBeatsTime.positions[1].entryDate, "2026-12-18");
}

// Missing and bad quotes hold the position, keep the last good mark, and never close.
// A calendar gap still counts as one trading session. Five stale sessions flag review.
{
  let book = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") }, stock(120, "2026-10-13"));
  book = step(book, "2026-10-23", [base], {}, stock(120, "2026-10-23"));
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].stale, true);
  assert.equal(book.positions[0].staleTradingDays, 1);
  assert.equal(book.positions[0].mark, 10);
  assert.equal(book.positions[0].lastQuote, "missing");
  assert.equal(book.positions[0].review, false);

  const badDays = [
    ["2026-10-14", null, "missing"],
    ["2026-10-15", q(0, 30, "2026-10-15"), "bid-zero"],
    ["2026-10-16", q(8, 16, "2026-10-16"), "wide-spread"],
    ["2026-10-19", q(1, 40, "2026-10-19"), "wide-spread"],
    ["2026-10-20", q(50, 50, "2026-10-21"), "off-session"],
  ];
  // Spread exactly half the mid is still a usable close. 12/20 → mid 16, spread 8.
  const exact = step(null, "2026-10-13", [base], { [contract]: q(12, 20, "2026-10-13") });
  assert.equal(exact.positions[0].lastQuote, "good");
  assert.equal(exact.positions[0].mark, 16);

  let stale = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
  badDays.forEach(([asOf, quote, state], index) => {
    stale = step(stale, asOf, [base], quote ? { [contract]: quote } : {}, stock(80, asOf));
    assert.equal(stale.positions[0].status, "open");
    assert.equal(stale.positions[0].exit, null);
    assert.equal(stale.positions[0].mark, 10);
    assert.equal(stale.positions[0].pnl, 0);
    assert.equal(stale.positions[0].lastQuote, state);
    assert.equal(stale.positions[0].staleTradingDays, index + 1);
    assert.equal(stale.positions[0].review, index + 1 >= LEAPS_STALE_REVIEW_DAYS);
  });
  assert.equal(stale.positions[0].flags.includes("review"), true);
  assert.equal(LEAPS_STALE_REVIEW_DAYS, 5);

  // A later good close updates the mark and clears the stale count. Review stays.
  const recovered = step(stale, "2026-10-21", [base], { [contract]: q(13, 13, "2026-10-21") });
  assert.equal(recovered.positions[0].status, "open");
  assert.equal(recovered.positions[0].mark, 13);
  assert.equal(recovered.positions[0].stale, false);
  assert.equal(recovered.positions[0].staleTradingDays, 0);
  assert.equal(recovered.positions[0].review, true);
  assert.equal(recovered.summary.review, 1);
}

// A wide mid that would look like a double, or a zero bid, does not exit.
{
  let book = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
  book = step(book, "2026-10-14", [base], { [contract]: q(1, 100, "2026-10-14") });
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].mark, 10);
  assert.equal(book.positions[0].lastQuote, "wide-spread");
  book = step(book, "2026-10-15", [base], { [contract]: q(0, 80, "2026-10-15") });
  assert.equal(book.positions[0].status, "open");
  assert.equal(book.positions[0].lastQuote, "bid-zero");
}

// Expired contracts settle at intrinsic from the last underlying close, never the option mid.
{
  const expiring = idea({ expiration: "2027-01-15", strike: 100, target: 120, ask: 8 });
  const expKey = keyFor(expiring);
  let book = step(null, "2026-01-05", [expiring], { [expKey]: q(8, 8, "2026-01-05") }, stock(110, "2026-01-05"));
  assert.equal(book.positions[0].status, "open");
  assert.equal(leapsTimeExitDate(expiring.expiration), "2026-07-15");
  const timed = step(book, "2026-07-15", [expiring], { [expKey]: q(9, 9, "2026-07-15") }, stock(110, "2026-07-15"));
  assert.equal(timed.positions[0].exit.reason, "time");

  book = step(book, "2027-01-15", [expiring], { [expKey]: q(99, 99, "2027-01-15") });
  assert.equal(book.positions[0].exit.reason, "expired");
  assert.equal(book.positions[0].exit.price, 10);
  assert.notEqual(book.positions[0].exit.price, 99);
  assert.equal(book.positions[0].pnl, 200);

  const withClose = step(
    step(null, "2026-01-05", [expiring], { [expKey]: q(8, 8, "2026-01-05") }, stock(110, "2026-01-05")),
    "2027-01-15",
    [expiring],
    { [expKey]: q(99, 99, "2027-01-15") },
    stock(130, "2027-01-15"),
  );
  assert.equal(withClose.positions[0].exit.reason, "expired");
  assert.equal(withClose.positions[0].exit.price, 30);

  const put = idea({ id: "put-exp", side: "put", strike: 100, expiration: "2027-01-15", ask: 4, target: 1 });
  const putKey = keyFor(put);
  const putBook = step(
    step(null, "2026-01-05", [put], { [putKey]: q(4, 4, "2026-01-05") }, stock(110, "2026-01-05")),
    "2027-01-15",
    [put],
    { [putKey]: q(1, 1, "2027-01-15") },
    stock(80, "2027-01-15"),
  );
  assert.equal(putBook.positions[0].exit.price, 20);

  const otm = step(
    step(null, "2026-01-05", [expiring], { [expKey]: q(8, 8, "2026-01-05") }, stock(90, "2026-01-05")),
    "2027-01-15",
    [expiring],
    { [expKey]: q(15, 15, "2027-01-15") },
    stock(90, "2027-01-15"),
  );
  assert.equal(otm.positions[0].exit.price, 0);
  assert.notEqual(otm.positions[0].exit.price, 15);

  const unpriced = step(
    step(null, "2026-01-05", [expiring], { [expKey]: q(8, 8, "2026-01-05") }),
    "2027-01-15",
    [expiring],
    { [expKey]: q(40, 40, "2027-01-15") },
  );
  assert.equal(unpriced.positions[0].exit.reason, "expired");
  assert.equal(unpriced.positions[0].exit.price, null);
  assert.equal(unpriced.positions[0].mark, 8);
  assert.equal(unpriced.positions[0].flags.includes("expired-unpriced"), true);
}

// Split, strike change, and symbol change freeze the book. Later quotes cannot invent a gain.
{
  const cases = [
    ["split", idea({ corporateAction: "split" }), q(40, 40, "2026-10-14", { corporateAction: "split" })],
    ["strike-change", idea({ strike: 75 }), q(40, 40, "2026-10-14", { strike: 75 })],
    ["symbol-change", idea({ symbol: "NVDA.NEW" }), q(40, 40, "2026-10-14", { symbol: "NVDA.NEW" })],
  ];
  for (const [kind, changed, quote] of cases) {
    let book = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
    book = step(book, "2026-10-14", [changed], { [contract]: quote }, stock(400, "2026-10-14"));
    assert.equal(book.positions[0].status, "frozen", kind);
    assert.equal(book.positions[0].freezeReason, kind);
    assert.equal(book.positions[0].mark, 10);
    assert.equal(book.positions[0].pnl, 0);
    assert.equal(book.positions[0].exit, null);
    book = step(book, "2026-10-15", [changed], { [contract]: q(80, 80, "2026-10-15") }, stock(500, "2026-10-15"));
    assert.equal(book.positions[0].status, "frozen");
    assert.equal(book.positions[0].mark, 10);
    assert.equal(book.positions[0].pnl, 0);
    assert.equal(book.summary.open, 0);
    assert.equal(book.summary.frozen, 1);
    const blocked = step(book, "2026-10-16", [idea({ id: "nvda-2", ask: 9 })]);
    assert.equal(blocked.positions.length, 1);
  }

  // An explicit split beats a same-day roll and a fat mid.
  let splitRoll = step(null, "2026-10-13", [base], { [contract]: q(10, 10, "2026-10-13") });
  splitRoll = step(
    splitRoll,
    "2026-10-14",
    [idea({ corporateAction: "split", rollTo: { strike: 180, expiration: "2028-06-16", ask: 7 } })],
    { [contract]: q(40, 40, "2026-10-14", { corporateAction: "split" }) },
  );
  assert.equal(splitRoll.positions.length, 1);
  assert.equal(splitRoll.positions[0].status, "frozen");
  assert.equal(splitRoll.positions[0].pnl, 0);
}

// Two builds of the same session do not update or close twice. An earlier session cannot
// rewrite a later book. Each session's mark stays on the price known that day.
{
  const day1Quotes = { [contract]: q(10, 10, "2026-10-13") };
  const day1 = step(null, "2026-10-13", [base], day1Quotes, stock(120, "2026-10-13"));
  assert.equal(day1.positions[0].mark, 10);
  const day2Quotes = { [contract]: q(20, 20, "2026-10-14") };
  const day2 = step(day1, "2026-10-14", [base], day2Quotes, stock(180, "2026-10-14"));
  assert.equal(day1.positions[0].mark, 10, "the earlier book keeps the price known that day");
  assert.equal(day2.positions[0].mark, 20);
  assert.equal(day2.positions[0].exit.reason, "doubled");
  assert.equal(day2.positions[0].pnl, 1000);

  const repeat = step(day2, "2026-10-14", [idea({ exitFlag: true, rollTo: { strike: 180, expiration: "2028-06-16", ask: 7 } })], {
    [contract]: q(40, 40, "2026-10-14"),
  }, stock(500, "2026-10-14"));
  assert.deepEqual(repeat, day2);
  assert.equal(repeat.positions.length, 1);
  assert.equal(repeat.positions[0].pnl, 1000);

  const again = advanceLeapsPaperTrack({
    book: day2,
    asOf: "2026-10-14",
    ideas: [base],
    quotes: day2Quotes,
    stocks: stock(180, "2026-10-14"),
  });
  assert.deepEqual(again, day2);

  const rewind = step(day2, "2026-10-13", [base], { [contract]: q(1, 1, "2026-10-13") }, stock(1, "2026-10-13"));
  assert.deepEqual(rewind, day2);

  const future = step(null, "2026-10-13", [base], { [contract]: q(30, 30, "2026-10-14", { corporateAction: "split" }) }, {
    NVDA: { close: 400, asOf: "2026-10-14" },
  });
  assert.equal(future.positions[0].status, "open");
  assert.equal(future.positions[0].mark, 10);
  assert.equal(future.positions[0].lastQuote, "off-session");
  assert.equal(future.positions[0].frozen, false);
  assert.equal(future.positions[0].lastStockClose, null);
}

// Owner-only key, bake-owned, and the bake hook stays dormant while the picks list is empty.
assert.equal(OWNERSHIP_KEY, LEAPS_PAPER_KEY);
assert.equal(isPremiumKey(LEAPS_PAPER_KEY), true);
assert.deepEqual(roleClaimForKey(LEAPS_PAPER_KEY), ["tr", "tp"]);
assert.equal(isPremiumKey("grades.json"), false);
assert.equal(isBakeOwnedKey(LEAPS_PAPER_KEY), true);
assert.equal(REQUEST_TIME_EXCLUSIVE_KEYS.has(LEAPS_PAPER_KEY), false);
assert.equal(SCANNER_EXCLUSIVE_KEYS.has(LEAPS_PAPER_KEY), false);

const buildSource = await readFile(resolve("scripts/build.mjs"), "utf8");
assert.match(buildSource, /export function leapsPicksForBake\(\) \{\n  return \[\];\n\}/);
assert.match(buildSource, /const leapsPicks = leapsPicksForBake\(\)/);
assert.match(buildSource, /const leapsPaperPrev = leapsPicks\.length \? await readLeapsPaperBook\(\) : null/);
assert.match(buildSource, /if \(leapsPicks\.length\) \{\n    try \{\n      const paper = await writeLeapsPaperTrack\(/);
assert.match(buildSource, /if \(!isPremiumKey\(LEAPS_PAPER_KEY\)\)/);
assert.doesNotMatch(buildSource, /BRIEF_TOOL_SOURCES[\s\S]*leaps-paper\.json/);

console.log("LEAPS paper-track smoke checks passed.");

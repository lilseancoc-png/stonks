// Execute now? card event warnings (QC of builds #223-#272). Earnings and
// FOMC are counted in market sessions, so a Monday print seen on a Friday is
// the next session, not "three days away" with no warning, and an FOMC day
// stops reading as "today" once the 15:30 ET press conference is over. Pure;
// no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAppJs } from "./render/app-js.mjs";
import { closureTables } from "../lib/us-equity-calendar.mjs";

const source = renderAppJs();
new vm.Script(source);
const fn = (name) => {
  const start = source.indexOf("  function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
};

const { holidays } = closureTables();
const ctx = vm.createContext({ Date, Intl, Math, Number, String, isFinite, MARKET_HOLIDAYS: holidays });
for (const name of ["isMarketSessionDay", "execEtIsoDate", "execEtMinuteOfDay", "execSessionsUntil", "execEventDayLabel"]) {
  vm.runInContext(fn(name), ctx);
}
const { execSessionsUntil: sessions, execEventDayLabel: label } = ctx;

// Sessions, not calendar days.
assert.equal(sessions("2026-11-20", "2026-11-20"), 0, "same day");
assert.equal(sessions("2026-11-23", "2026-11-20"), 1, "Friday to Monday is one session");
assert.equal(sessions("2026-11-24", "2026-11-20"), 2);
assert.equal(sessions("2026-11-23", "2026-11-21"), 1, "Saturday to Monday");
assert.equal(sessions("2026-11-27", "2026-11-25"), 1, "Thanksgiving is skipped");
assert.equal(sessions("2027-01-19", "2027-01-15"), 1, "MLK Day is skipped");
assert.equal(sessions("2026-11-19", "2026-11-20"), 0, "a past date never counts");

// Labels.
assert.equal(label(0, "2026-11-20", "2026-11-20"), "today");
assert.equal(label(1, "2026-11-24", "2026-11-23"), "tomorrow");
assert.equal(label(1, "2026-11-23", "2026-11-20"), "Monday (next session)");
assert.equal(label(1, "2026-11-27", "2026-11-25"), "Friday (next session)");
assert.equal(label(2, "2026-11-24", "2026-11-20"), "on Tuesday");

// ET clock helpers.
assert.equal(ctx.execEtIsoDate(Date.parse("2026-11-21T01:30:00Z")), "2026-11-20", "8:30 pm ET is still Friday");
assert.equal(ctx.execEtMinuteOfDay(Date.parse("2026-12-09T20:30:00Z")), 930, "15:30 ET in winter");
assert.equal(ctx.execEtMinuteOfDay(Date.parse("2026-07-29T19:30:00Z")), 930, "15:30 ET in summer");

// The card uses them: no calendar-day rounding left, and the FOMC day is
// dropped after the press conference.
const card = fn("buildExecuteNowCard");
assert.match(card, /daysToEarnings = execSessionsUntil\(earnDay, todayIso\)/);
assert.match(card, /daysToFomc = execSessionsUntil\(fd, todayIso\)/);
assert.match(card, /fd === todayIso && nowEtMin != null && nowEtMin >= 930/);
assert.doesNotMatch(card, /dot plot lands/);

console.log("execute card events smoke ok");

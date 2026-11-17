// Index calendar session log (buildIndexHourSession / appendIndexCalendar):
// a bar still trading at build time never counts as finished, the day is never
// complete before the close, and the page's month-read text quotes the same
// sleeve counts as its rule. Run: node scripts/index-calendar-smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndexHourSession, appendIndexCalendar, indexCalendarAsOf } from "./build.mjs";

let n = 0;
const ok = (name, fn) => { fn(); n++; };

const DAY = "2026-11-16";
const PREV = "2026-11-13";
const daily = [
  { t: PREV, o: 600, h: 602, l: 598, c: 600 },
  { t: DAY, o: 601, h: 608, l: 599, c: 606 },
];
const slots = [570, 600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900, 930];
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const intraday = (upTo) => slots.filter((m) => m <= upTo).map((m, i) => ({
  t: `${DAY} ${hhmm(m)}`, o: 601 + i * 0.4, h: 602 + i * 0.4, l: 600 + i * 0.4, c: 601.5 + i * 0.4, v: 1000,
}));
// 15:05Z = 10:05 ET on a November (EST) day; 20:35Z = 15:35 ET; 21:10Z = 16:10 ET.
const at = (utc) => indexCalendarAsOf(`${DAY}T${utc}:00.000Z`);

ok("asOf: reads the build time in ET with the day's close", () => {
  assert.deepEqual(at("15:05"), { date: DAY, minute: 605, closeMinute: 960 });
  assert.equal(indexCalendarAsOf("2026-11-27T18:30:00.000Z").closeMinute, 780);
  assert.equal(indexCalendarAsOf("not a date"), null);
});

ok("10:05 build: the live 10:00 bar is not the 10:30 price", () => {
  const s = buildIndexHourSession(daily, intraday(600), 1, at("15:05"));
  assert.equal(s.firstHourComplete, false);
  assert.equal(s.dayComplete, false);
  assert.equal(s.inProgress, true);
  assert.equal(s.at1030, undefined);
  assert.equal(s.gapPct != null, true, "the opening gap is known at 10:05");
});

ok("11:05 build: first hour done, day still in progress", () => {
  const s = buildIndexHourSession(daily, intraday(660), 1, at("16:05"));
  assert.equal(s.firstHourComplete, true);
  assert.equal(s.at1030, 601.9);
  assert.equal(s.dayComplete, false);
  assert.equal(s.inProgress, true);
});

ok("15:35 build: both last bars exist but the day is not complete", () => {
  const s = buildIndexHourSession(daily, intraday(930), 1, at("20:35"));
  assert.equal(s.firstHourComplete, true);
  assert.equal(s.dayComplete, false);
  assert.equal(s.close, undefined);
});

ok("16:10 build: the day is complete", () => {
  const s = buildIndexHourSession(daily, intraday(930), 1, at("21:10"));
  assert.equal(s.dayComplete, true);
  assert.equal(s.close, 606);
  assert.equal(s.inProgress, undefined);
});

ok("past days and callers without a build time are unchanged", () => {
  const nextDay = indexCalendarAsOf("2026-11-17T15:05:00.000Z");
  const s = buildIndexHourSession(daily, intraday(930), 1, nextDay);
  assert.equal(s.dayComplete, true);
  const noAsOf = buildIndexHourSession(daily, intraday(600), 1);
  assert.equal(noAsOf.firstHourComplete, true, "old behavior without asOf");
});

const chain = (upTo, close) => ({
  _bars: [daily[0], { ...daily[1], c: close }],
  _intraday: intraday(upTo),
});
ok("appendIndexCalendar: today's row is partial before the close and cleared after", () => {
  const mid = appendIndexCalendar(null, { SPY: chain(930, 605) }, `${DAY}T20:35:00.000Z`);
  const row = mid.days.find((d) => d.date === DAY);
  assert.equal(row.partial, true);
  assert.equal(row.spy.session.dayComplete, false);
  assert.equal(mid.days.find((d) => d.date === PREV).partial, undefined);
  const after = appendIndexCalendar(mid, { SPY: chain(930, 606) }, `${DAY}T21:10:00.000Z`);
  const done = after.days.find((d) => d.date === DAY);
  assert.equal(done.partial, undefined);
  assert.equal(done.spy.session.dayComplete, true);
  assert.equal(done.spy.c, 606);
});

ok("month read: the sleeve counts in the text come from the rule", () => {
  const src = readFileSync(new URL("./render/app-js.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("at least four risk sleeves"), "fixed wording is gone");
  assert.ok(!src.includes("falls below four sleeves"));
  assert.ok(!src.includes("expands to four or more sleeves"));
  assert.ok(src.includes("riskPositive >= riskOnNeed"));
  assert.ok(src.includes("riskPositive <= riskOffMax"));
  // Six sleeves: broad needs 5, defensive allows 2.
  assert.equal(Math.ceil(6 * 0.75), 5);
  assert.equal(Math.floor(6 * 0.34), 2);
});

console.log(`index-calendar-smoke: ${n} checks passed`);

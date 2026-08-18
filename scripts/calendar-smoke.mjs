import {
  dedupeCalendarEvents,
  parseFederalReserveCalendarHtml,
  parseJacksonHoleSymposium,
  parseOfficialIcsCalendar,
} from "./build.mjs";

let failures = 0;
function ok(label, condition) {
  if (condition) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

console.log("Calendar source coverage smoke");

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Consumer Price Index
DTSTART;TZID=US-Eastern:20260911T083000
END:VEVENT
BEGIN:VEVENT
SUMMARY:GDP (Second Estimate) and Corporate Profits\, 2nd Quarter 2026
DTSTART:20260826T123000Z
END:VEVENT
END:VCALENDAR`;
const parsedIcs = parseOfficialIcsCalendar(ics, {
  sourceKey: "test",
  source: "Official test",
  sourceUrl: "https://example.com/calendar.ics",
});
ok("ICS parser keeps every VEVENT", parsedIcs.length === 2);
ok("local Eastern DTSTART remains 08:30 ET", parsedIcs[0]?.date === "2026-09-11" && parsedIcs[0]?.time === "08:30 ET");
ok("UTC DTSTART converts to the correct ET date/time", parsedIcs[1]?.date === "2026-08-26" && parsedIcs[1]?.time === "08:30 ET");
ok("folded/escaped commas are restored", /Profits, 2nd/.test(parsedIcs[1]?.title || ""));

const fedHtml = `
<div class="row cal-nojs__rowTitle"><h4 class="col-md-12">FOMC Meetings</h4></div>
<div class="row"><div class="panel"><div class="panel-body"><div class="row">
<div class="col-xs-2"><p>2:00 p.m.</p></div>
<div class="col-xs-7"><p>FOMC Minutes</p><p>Meeting of July 28-29</p></div>
<div class="col-xs-3"><p>19</p></div>
</div></div></div></div>
<div class="row cal-nojs__rowTitle"><h4 class="col-md-12">Statistical Releases</h4></div>
<div class="row"><div class="panel"><div class="panel-body"><div class="row">
<div class="col-xs-2"><p>9:15 a.m.</p></div>
<div class="col-xs-7"><p>G.17 - Industrial Production and Capacity Utilization</p></div>
<div class="col-xs-3"><p>18</p></div>
</div></div></div></div>`;
const fedEvents = parseFederalReserveCalendarHtml(fedHtml, 2026, 7);
ok("Fed parser keeps minutes and statistical releases", fedEvents.length === 2);
ok("Fed minutes are classified as Fed", fedEvents[0]?.type === "fed" && fedEvents[0]?.date === "2026-08-19");
ok("Fed statistical releases are report rows", fedEvents[1]?.type === "report" && fedEvents[1]?.time === "09:15 ET");

const jackson = parseJacksonHoleSymposium(`
  <p>The 2026 Jackson Hole Economic Policy Symposium will take place Aug. 27-29.
  This year's topic is &quot;Financial Innovation: Implications for Payments and Policy.&quot;</p>`);
ok("Jackson Hole begins Aug. 27", jackson?.date === "2026-08-27");
ok("Jackson Hole retains the Aug. 29 end date", jackson?.endDate === "2026-08-29");
ok("Jackson Hole is a Federal-policy event with official provenance", jackson?.type === "fed" && jackson?.source === "Kansas City Fed");

const deduped = dedupeCalendarEvents([
  { type: "report", subtype: "cpi-mom", date: "2026-09-11", title: "Inflation Rate MoM" },
  { type: "report", subtype: "official-bls-consumer-price-index", date: "2026-09-11", title: "Consumer Price Index", official: true },
  { type: "report", subtype: "official-bls-real-earnings", date: "2026-09-11", title: "Real Earnings", official: true },
]);
ok("official umbrella releases dedupe against richer detailed rows", deduped.length === 2 && !deduped.some((e) => e.title === "Consumer Price Index"));
ok("non-overlapping official releases remain", deduped.some((e) => e.title === "Real Earnings"));

if (failures) {
  console.error(`\n${failures} calendar smoke assertion${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("\nCalendar smoke passed.");

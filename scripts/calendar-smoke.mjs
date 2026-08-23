import {
  dedupeCalendarEvents,
  parseFederalReserveCalendarHtml,
  parseJacksonHoleSymposium,
  parseOfficialIcsCalendar,
} from "./build.mjs";
import { renderAppJs } from "./render/app-js.mjs";

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

const appJs = renderAppJs({});
const calendarDisplayHelpers = appJs.match(/function calEventDateKeys\(e\)\{[\s\S]*?(?=\n  \/\/ Navigate to the Grade tab)/)?.[0] || "";
ok("Calendar display helpers are emitted", !!calendarDisplayHelpers);
const display = new Function(`${calendarDisplayHelpers}\nreturn { calEventDateKeys, calEventPriorityCompare };`)();
ok("multi-day events paint every covered date", JSON.stringify(display.calEventDateKeys(jackson)) === JSON.stringify([
  "2026-08-27", "2026-08-28", "2026-08-29",
]));
const routinePrints = [
  { type: "report", date: "2026-08-27", title: "CP - Commercial Paper", importance: "low" },
  { type: "report", date: "2026-08-27", title: "H.15 - Selected Interest Rates", importance: "low" },
  { type: "report", date: "2026-08-27", title: "H.4.1 - Factors Affecting Reserve Balances", importance: "low" },
];
const prioritized = [...routinePrints, jackson].sort(display.calEventPriorityCompare);
ok("Jackson Hole outranks routine Fed prints", prioritized[0] === jackson);
ok("multi-day filter matching uses every covered date", /calEventDateKeys\(e\)\.indexOf\(selDay\) >= 0/.test(appJs));
const miniLabelSource = appJs.match(/function calMiniLabel\(e\)\{[\s\S]*?(?=\n  \/\/ Full hover)/)?.[0] || "";
const miniLabel = new Function("catalystCategoryLabel", "calendarTypeLabel", `${miniLabelSource}\nreturn calMiniLabel;`)(
  () => "Event", (type) => type === "fed" ? "Fed" : "Macro",
);
ok("Jackson Hole is named in the month cell", miniLabel(jackson) === "Jackson Hole");

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

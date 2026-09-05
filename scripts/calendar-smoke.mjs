import {
  dedupeCalendarEvents,
  matchesMacroPrediction,
  macroReleaseSourceLabel,
  fetchTextCalendar,
  isExcludedFedCalendarReport,
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
</div></div></div></div>
<div class="row"><div class="panel"><div class="panel-body"><div class="row">
<div class="col-xs-2"><p>1:00 p.m.</p></div>
<div class="col-xs-7"><p>CP - Commercial Paper</p></div>
<div class="col-xs-3"><p>18, 19, 20, 21</p></div>
</div></div></div></div>`;
const fedEvents = parseFederalReserveCalendarHtml(fedHtml, 2026, 7);
ok("Fed parser keeps minutes and decision-relevant statistical releases", fedEvents.length === 2);
ok("Fed minutes are classified as Fed", fedEvents[0]?.type === "fed" && fedEvents[0]?.date === "2026-08-19");
ok("Fed statistical releases are report rows", fedEvents[1]?.type === "report" && fedEvents[1]?.time === "09:15 ET");
ok("repetitive Fed report families are excluded", [
  "H6 - Money Stock Measures",
  "CP - Commercial Paper",
  "H8 - Assets and Liabilities",
  "H.10 - Foreign Exchange Rates",
  "H.15 - Selected Interest Rates",
  "G20 - Finance Companies",
  "H.4.1 - Factors Affecting Reserve Balances",
  "G5 - Foreign Exchange Rates",
  "G.19 - Consumer Credit",
  "H.15 - Selected Interest Rates",
].every(isExcludedFedCalendarReport));
ok("unlisted Fed reports remain eligible", [
  "G.17 - Industrial Production and Capacity Utilization",
].every((title) => !isExcludedFedCalendarReport(title)));

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
  { type: "report", date: "2026-08-27", title: "G.5A - Foreign Exchange Rates", importance: "low" },
  { type: "report", date: "2026-08-27", title: "G.17 - Industrial Production and Capacity Utilization", importance: "medium" },
  { type: "report", date: "2026-08-27", title: "Z.1 - Financial Accounts of the United States", importance: "medium" },
];
const prioritized = [...routinePrints, jackson].sort(display.calEventPriorityCompare);
ok("Jackson Hole outranks routine Fed prints", prioritized[0] === jackson);
ok("multi-day filter matching uses every covered date", /calEventDateKeys\(e\)\.indexOf\(selDay\) >= 0/.test(appJs));
const miniLabelSource = appJs.match(/function calMiniLabel\(e\)\{[\s\S]*?(?=\n  \/\/ Full hover)/)?.[0] || "";
const miniLabel = new Function("catalystCategoryLabel", "calendarTypeLabel", `${miniLabelSource}\nreturn calMiniLabel;`)(
  () => "Event", (type) => type === "fed" ? "Fed" : "Macro",
);
ok("Jackson Hole is named in the month cell", miniLabel(jackson) === "Jackson Hole");

const dayOffsetHelpers = appJs.match(/function calDaysFromToday\(dateStr, todayMs\)\{[\s\S]*?function calDaysFromEvent\(e, todayMs\)\{[\s\S]*?\n  \}/)?.[0] || "";
ok("span-aware calendar day offsets are emitted", !!dayOffsetHelpers);
const daysFrom = new Function(`${dayOffsetHelpers}\nreturn calDaysFromEvent;`)();
ok("Jackson Hole is current on day 2 of the symposium", daysFrom(jackson, Date.UTC(2026, 7, 28)) === 0);
ok("Jackson Hole is current on the last day", daysFrom(jackson, Date.UTC(2026, 7, 29)) === 0);
ok("Jackson Hole is one day out before it starts", daysFrom(jackson, Date.UTC(2026, 7, 26)) === 1);
ok("Jackson Hole is past after it ends", daysFrom(jackson, Date.UTC(2026, 7, 30)) === -1);
ok("briefing uses span-aware day offsets", /days: calDaysFromEvent\(e, todayMs\)/.test(appJs));
ok("briefing does not send readers to Market Analysis", !/data-cal-brief-go="market"/.test(appJs));
const excludedFedHelper = appJs.match(/function calIsExcludedFedReport\(title\)\{[\s\S]*?\n  \}/)?.[0] || "";
ok("Calendar load drops excluded Fed statistical prints", !!excludedFedHelper && /calIsExcludedFedReport\(e\.title\)/.test(appJs));
const isExcludedLive = new Function(`${excludedFedHelper}\nreturn calIsExcludedFedReport;`)();
ok("live H.15 filter matches ingest", isExcludedLive("H.15 - Selected Interest Rates") && isExcludedLive("CP - Commercial Paper"));
ok("live G.17 stays eligible", !isExcludedLive("G.17 - Industrial Production and Capacity Utilization"));

const deduped = dedupeCalendarEvents([
  { type: "report", subtype: "cpi-mom", date: "2026-09-11", title: "Inflation Rate MoM" },
  { type: "report", subtype: "official-bls-consumer-price-index", date: "2026-09-11", title: "Consumer Price Index", official: true },
  { type: "report", subtype: "official-bls-real-earnings", date: "2026-09-11", title: "Real Earnings", official: true },
]);
ok("official umbrella releases dedupe against richer detailed rows", deduped.length === 2 && !deduped.some((e) => e.title === "Consumer Price Index"));
ok("non-overlapping official releases remain", deduped.some((e) => e.title === "Real Earnings"));

const annualAugust = { title: "August Inflation US Annual", slug: "august-inflation-us-annual-1786474662954", endDate: "2026-09-11" };
const release = { subtype: "cpi-yoy", date: "2026-09-11" };
ok("August annual CPI matches September headline YoY release", matchesMacroPrediction(release, annualAugust));
for (const subtype of ["cpi-mom", "core-cpi-mom", "core-cpi-yoy", "ppi-mom"]) {
  ok(`${subtype} rejects headline annual CPI`, !matchesMacroPrediction({ ...release, subtype }, annualAugust));
}
ok("October release rejects August reference month", !matchesMacroPrediction({ ...release, date: "2026-10-14" }, annualAugust));
ok("PPI MoM rejects PPI YoY", !matchesMacroPrediction({ subtype: "ppi-mom", date: "2026-09-10" }, { title: "PPI YoY August 2026", endDate: "2026-09-10" }));
ok("December rejects full-year inflation maximum", !matchesMacroPrediction({ ...release, date: "2026-12-10" }, { title: "How high will inflation get in 2026", endDate: "2026-12-31" }));
ok("core monthly CPI exact match accepted", matchesMacroPrediction({ ...release, subtype: "core-cpi-mom" }, { title: "Core CPI monthly August 2026", endDate: "2026-09-11" }));
ok("wrong country rejected", !matchesMacroPrediction(release, { ...annualAugust, title: "Argentina August Inflation Annual" }));
ok("missing period and year rejected", !matchesMacroPrediction(release, { title: "Annual CPI" }));
ok("prior year rejected", !matchesMacroPrediction(release, { ...annualAugust, title: "August annual CPI 2025" }));
ok("closed CPI contract rejected", !matchesMacroPrediction(release, { ...annualAugust, closed: true }));
ok("inactive outcome rejected", !matchesMacroPrediction(release, annualAugust, { active: false }));
ok("FRED fallback credited with consensus provider", macroReleaseSourceLabel("FRED:CPIAUCSL", true, true) === "FRED · CPIAUCSL · ForexFactory");
ok("BLS actual provider retained", macroReleaseSourceLabel("BLS:CUUR0000SA0", true, false) === "BLS · CUUR0000SA0");
ok("empty ForexFactory row not credited", macroReleaseSourceLabel("BLS:CUUR0000SA0", true, false).includes("ForexFactory") === false);
ok("FF-only values do not claim BLS", macroReleaseSourceLabel(null, false, true) === "ForexFactory");
let calls = 0;
const recovered = await fetchTextCalendar("https://example.com/calendar", async () => {
  calls++;
  return calls === 1 ? { ok: false, status: 503 } : { ok: true, text: async () => "calendar" };
});
ok("official source retries transient failures", recovered === "calendar" && calls === 2);
calls = 0;
try { await fetchTextCalendar("https://example.com/calendar", async () => { calls++; return { ok: false, status: 404 }; }); } catch {}
ok("official source does not retry permanent missing URLs", calls === 1);

if (failures) {
  console.error(`\n${failures} calendar smoke assertion${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("\nCalendar smoke passed.");

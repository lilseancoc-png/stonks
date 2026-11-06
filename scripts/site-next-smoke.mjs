// Smoke tests for the 2026-11-06 "add, fix and smooth out" pass: the shared
// refresh schedule, the glossary, the earnings week board and plan. Pure
// functions only; no network, no store.
import assert from "node:assert/strict";
import { refreshScheduleFactory } from "../lib/refresh-schedule.mjs";
import { GLOSSARY } from "../lib/glossary.mjs";
import { ownerWatchlistFactory, applyOwnerWatchlistRequest, readOwnerWatchlistDoc } from "../lib/owner-watchlist.mjs";
import { watchlistAlertsFactory } from "../lib/watchlist-alerts.mjs";
import { buildCalendarIcs, parseIcsSymbols } from "../lib/calendar-ics.mjs";
import { weekRecapFactory } from "../lib/week-recap.mjs";
import { noPicksFactory } from "../lib/no-picks.mjs";
import { pickDisplayDecision } from "../lib/research-display.mjs";
import { buildEarningsWeek, buildEarningsWeekPlan, pastEarningsMoves, impliedVsHistory, seasonSoFar } from "../lib/earnings-week.mjs";

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };

// --- Refresh schedule ------------------------------------------------------
const R = refreshScheduleFactory();
const H = { "2026-11-26": "Thanksgiving" };
eq(R.nextLabel("build", { dateKey: "2026-11-06", minutes: 600 }, H), "11:00 ET", "next full build after 10:00 is 11:00");
eq(R.nextLabel("picks", { dateKey: "2026-11-06", minutes: 11 * 60 + 5 }, H), "15:30 ET", "next Top Picks run after 11:05 is 15:30");
eq(R.nextLabel("picks", { dateKey: "2026-11-06", minutes: 16 * 60 }, H), "Mon 11:00 ET", "Friday after the close rolls to Monday");
eq(R.nextLabel("build", { dateKey: "2026-11-25", minutes: 17 * 60 }, H), "Fri 10:00 ET", "Thanksgiving is skipped");
eq(R.nextLabel("oi", { dateKey: "2026-11-09", minutes: 9 * 60 }, H), "~17:00 ET", "approximate scan times carry a tilde");
ok(/^Fri Nov 13, 11:30 ET$/.test(R.nextLabel("weekly", { dateKey: "2026-11-06", minutes: 12 * 60 }, H)), "weekly run a week out shows its date");
eq(R.jobFor("track"), "picks", "Track Record follows the Top Picks runs");
eq(R.jobFor("tickers"), "build", "unlisted pages follow the full build");
eq(R.jobFor("privacy"), null, "reference pages have no schedule");
eq(R.jobFor("glossary"), null, "the Glossary has no schedule");

// --- Glossary --------------------------------------------------------------
for (const [key, g] of Object.entries(GLOSSARY)) {
  ok(/^[a-zA-Z]+$/.test(key), `glossary key ${key} is a plain word`);
  ok(g.term && g.def && g.def.length <= 320, `${key} has a term and a short meaning`);
  ok(!/[<>]/.test(g.term + g.def), `${key} carries no markup`);
}
for (const k of ["cp", "dOi", "squeeze", "ivPct"]) ok(GLOSSARY[k], `the follow-up terms include ${k}`);

// --- Earnings week board ---------------------------------------------------
const ev = (date, movePct, extra = {}) => ({ date, movePct, epsActual: 1.1, epsEstimate: 1, surprisePct: 10, ...extra });
const chains = {
  AAA: { spot: 100, fundamentals: { name: "Alpha", nextEarningsDate: "2026-11-10", nextEarningsSession: "PM" },
    earningsHx: { events: [ev("2025-11-01", 0.05, { impliedMovePct: 0.04 }), ev("2026-02-01", -0.08, { impliedMovePct: 0.06 }), ev("2026-05-01", 0.03), ev("2026-08-01", 0.04), ev("2026-10-30", -0.02)],
      next: { date: "2026-11-10", impliedMovePct: 0.09, pre10Pct: 0.07 } }, ivRank: { pctile: 88 } },
  BBB: { spot: 50, fundamentals: { name: "Beta", nextEarningsDate: "2026-11-09", nextEarningsSession: "AM" },
    earningsHx: { events: [ev("2026-08-01", 0.10), ev("2026-11-02", 0.12, { surprisePct: -5, epsActual: 0.9 })], next: { date: "2026-11-09" } } },
  CCC: { spot: 20, fundamentals: { nextEarningsDate: "2026-12-20" }, earningsHx: { events: [] } },
  SPY: { spot: 600, fundamentals: { nextEarningsDate: "2026-11-09" } },
};
const board = buildEarningsWeek(chains, {
  builtAtIso: "2026-11-06T16:00:00Z", todayIso: "2026-11-06",
  impliedMoveFor: (d) => (d.spot === 50 ? { pct: 0.05 } : null),
  sessionsBetween: () => 2,
  seasonKeyOf: (iso) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`,
  verdictOf: (e) => (e.surprisePct > 1 ? "beat" : e.surprisePct < -1 ? "miss" : "inline"),
  isFund: (s) => s === "SPY",
});
eq(board.rows.map((r) => r.symbol), ["BBB", "AAA"], "only reports in the next 10 days, soonest first, funds left out");
const a = board.rows.find((r) => r.symbol === "AAA");
eq(a.impliedMovePct, 9, "a stamped straddle move wins");
eq(a.impliedSource, "stamped", "the source of the implied move is recorded");
eq(a.avgMovePct, 4.4, "usual move averages the absolute moves");
eq(a.vsHistory, "rich", "9% against a 4.4% usual move is pricey");
eq([a.exceeded, a.exceededOf], [2, 2], "past moves are compared with the move priced then");
eq(a.runInPct, 7, "run-in is in percent points");
const b = board.rows.find((r) => r.symbol === "BBB");
eq(b.impliedSource, "chain", "an unstamped print reads the chain");
eq(b.vsHistory, "cheap", "5% against an 11% usual move is cheap");
eq(board.season.key, "2026Q4", "season key follows the build date");
eq(board.season.reported, 2, "season counts this quarter's prints so far");
eq(board.season.beats, 1, "season beat count");
eq(board.season.fellShare, 0.5, "season share that fell");
eq(impliedVsHistory(5, 5), "in-line", "equal moves read as usual");
eq(impliedVsHistory(null, 5), null, "no implied move, no read");
eq(pastEarningsMoves({ events: [] }).n, 0, "no history is an empty record");
eq(seasonSoFar({}, "2026-11-06", {}).reported, 0, "an empty universe has an empty season");

// --- Owner plan --------------------------------------------------------------
const plan = buildEarningsWeekPlan(board, chains, {
  grades: { AAA: { side: "call", conviction: 6 }, BBB: { side: "put", conviction: 2 } },
  engineSeason: { n: 10, negativeShare: 0.3 }, minConviction: 4, openSymbols: ["AAA"],
});
eq(plan.plans.BBB.action, "none", "a grade below the bar plans no trade");
ok(["trade-through", "wait"].includes(plan.plans.AAA.action), "an actionable grade gets the engine's earnings rule");
ok(plan.plans.AAA.openTrade, "open trades are flagged");
ok(/prints/.test(plan.plans.AAA.reason), "the plan carries the engine's reason");
eq(plan.engineSeason, { n: 10, negativeShare: 0.3 }, "the plan records the season read it used");

// --- Owner watchlist sync --------------------------------------------------
const W = ownerWatchlistFactory();
eq(W.clean(["aapl", "AAPL", "bad ticker", "MSFT"]), ["AAPL", "MSFT"], "clean uppercases, dedupes and drops bad symbols");
eq(W.merge(["AAPL", "MSFT"], ["NVDA"], null), ["AAPL", "MSFT", "NVDA"], "first sync keeps both lists");
eq(W.merge(["AAPL"], ["AAPL", "NVDA"], ["AAPL", "MSFT", "NVDA"]), ["AAPL"], "a removal on another device sticks");
eq(W.merge(["AAPL", "MSFT"], ["TSLA", "AAPL"], ["AAPL", "MSFT"]), ["TSLA", "AAPL"], "local adds and removes apply to the server list");
eq(W.apply(["AAPL"], { op: "add", symbol: "nvda" }), ["NVDA", "AAPL"], "add puts the name first");
eq(W.apply(["AAPL", "NVDA"], { op: "remove", symbol: "AAPL" }), ["NVDA"], "remove drops the name");
eq(W.clean(Array.from({ length: 60 }, (_, i) => "Q" + i)).length, 40, "the list caps at 40");
ok(applyOwnerWatchlistRequest([], { op: "add", symbol: "<x>" }).error, "a bad symbol is refused");
ok(applyOwnerWatchlistRequest([], { op: "sync", local: "AAPL" }).error, "a bad sync body is refused");
eq(applyOwnerWatchlistRequest(["AAPL"], { op: "sync", local: ["AAPL", "META"], base: ["AAPL"] }).list, ["META", "AAPL"], "sync merges on the server");
eq(readOwnerWatchlistDoc("not json"), { version: 1, users: {} }, "a broken record reads as empty");

// --- Owner watchlist alerts ------------------------------------------------
const A = watchlistAlertsFactory();
const alerts = A.build({
  watch: ["AAA", "BBB", "CCC", "DDD"],
  ma: { builtAtIso: "2026-11-06T15:00:00Z", tickers: [
    { symbol: "AAA", spot: 101, levels: { 50: 100, 200: 90 }, previousDistances: { 50: -0.5, 200: 9 } },
    { symbol: "BBB", spot: 99, levels: { 50: 95, 200: 100 }, previousDistances: { 50: 3, 200: 0.4 } },
    { symbol: "DDD", spot: 50, levels: { 50: 49, 200: 40 }, previousDistances: { 50: 2, 200: 20 } } ] },
  oi: { scannedAt: "2026-11-06T13:30:00Z", tickers: [
    { symbol: "CCC", spot: 120, callWall: { strike: 120.5 }, putWall: { strike: 100 } },
    { symbol: "DDD", spot: 50, callWall: { strike: 60 }, putWall: { strike: 50 } } ] },
  unusual: { scannedAt: "2026-11-06T16:00:00Z", tickers: [{ symbol: "CCC", contracts: [{ side: "call", strike: 130, expSec: Date.UTC(2026, 11, 18) / 1000, premium: 2.4e6 }, { side: "put", strike: 110, premium: 1e5 }, { side: "call", strike: 125, premium: 3e5 }] }] },
  quotes: { DDD: { spot: 48.5 } },
  now: Date.parse("2026-11-06T18:00:00Z"),
});
const kinds = alerts.map((x) => `${x.symbol}:${x.kind}:${x.dir}`);
ok(kinds.includes("AAA:ma:up"), "a close back above the 50-day is a cross up");
ok(kinds.includes("BBB:ma:down"), "a drop under the 200-day is a cross down");
eq(kinds.filter((k) => k.startsWith("AAA:ma")).length, 1, "no cross when the side did not change (AAA stays above its 200-day)");
ok(kinds.includes("CCC:wall:up"), "within 0.75% of the call wall counts as at the wall");
ok(kinds.includes("CCC:flow:up"), "unusual trades today, mostly calls");
ok(/biggest \$130 call Dec 18, \$2\.4M premium/.test(alerts.find((x) => x.kind === "flow").text), "the flow alert names the biggest trade");
ok(kinds.includes("DDD:ma:down") && kinds.includes("DDD:wall:down"), "a live price below the 50-day and the put wall raises both");
ok(alerts.find((x) => x.symbol === "DDD" && x.kind === "wall").live, "live prices are marked live");
ok(/trades today/.test(alerts.find((x) => x.kind === "flow").text), "a scan from the same ET day says today");
const lateFlow = A.build({ watch: ["CCC"], unusual: { scannedAt: "2026-11-05T20:00:00Z", tickers: [{ symbol: "CCC", contracts: [{ side: "put", strike: 110, premium: 1e5 }] }] }, now: Date.parse("2026-11-06T14:00:00Z") });
ok(/trade on Nov 5 \(/.test(lateFlow[0].text) && !/today/.test(lateFlow[0].text), "yesterday's scan names its date instead of saying today");
eq(A.build({ watch: [] }), [], "no watchlist, no alerts");

// --- Calendar subscribe (.ics) ---------------------------------------------
eq(parseIcsSymbols("aapl, MSFT,msft,<x>,BRK.B"), ["AAPL", "MSFT", "BRK.B"], "ics symbols are cleaned and deduped");
const cal = {
  events: [
    { type: "earnings", symbol: "AAPL", date: "2026-11-10", session: "PM", impliedMovePct: 0.045, source: "Nasdaq" },
    { type: "earnings", symbol: "TSLA", date: "2026-11-11", session: "AM" },
    { type: "earnings", symbol: "AAPL", date: "2026-11-01", session: "PM" },
    { type: "report", subtype: "cpi-headline", title: "Consumer Price Index (October)", date: "2026-11-12", time: "08:30 ET", source: "BLS" },
    { type: "report", subtype: "core-cpi-mom", title: "Core CPI m/m", date: "2026-11-12", time: "08:30 ET" },
    { type: "report", subtype: "nfp", title: "Employment Situation", date: "2026-11-06", time: "08:30 ET" },
    { type: "report", subtype: "adp", title: "ADP employment", date: "2026-11-06" },
    { type: "report", subtype: "ppi", title: "Producer Price Index", date: "2026-11-13" },
    { type: "fomc", title: "FOMC decision", date: "2026-12-09", time: "14:00 ET" },
  ],
  fomc: { meetings: [{ date: "2026-12-09", label: "Dec 8-9" }, { date: "2027-01-27", label: "Jan 26-27" }, { date: "2026-10-28" }] },
};
const ics = buildCalendarIcs(cal, { symbols: ["AAPL"], nowIso: "2026-11-06T12:00:00Z", siteUrl: "https://mingstreet.app" });
const unfolded = ics.replace(/\r\n /g, "");
ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"), "the feed is one VCALENDAR with CRLF lines");
ok(ics.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75), "every line folds at 75 octets");
ok(unfolded.includes("UID:earnings-AAPL-2026-11-10@mingstreet.app"), "a watched name's earnings is in");
ok(!unfolded.includes("TSLA"), "an unwatched name's earnings is left out");
ok(!unfolded.includes("2026-11-01") && !unfolded.includes("20261101"), "past events are dropped");
ok(unfolded.includes("SUMMARY:AAPL earnings (after the close)"), "the earnings title says when it reports");
ok(unfolded.includes("about ±4.5%"), "the implied move rides along");
eq((unfolded.match(/UID:cpi-2026-11-12@/g) || []).length, 1, "CPI headline and core are one event");
ok(unfolded.includes("UID:jobs-2026-11-06@") && unfolded.includes("DTSTART;TZID=America/New_York:20261106T083000"), "the jobs report is 8:30 ET");
ok(!/ADP|Producer/.test(unfolded), "ADP and PPI are not in the feed");
eq((unfolded.match(/UID:fomc-2026-12-09@/g) || []).length, 1, "an FOMC date in both lists shows once");
ok(unfolded.includes("UID:fomc-2027-01-27@") && unfolded.includes("DTEND;TZID=America/New_York:20270127T150000"), "FOMC past the event window comes from the meeting list, 2:00 to 3:00 PM ET");
ok(unfolded.includes("BEGIN:VTIMEZONE") && unfolded.includes("TZID:America/New_York"), "the New York time zone is defined");
ok(/DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111/.test(unfolded), "earnings are all-day events");
ok(buildCalendarIcs({ events: [] }, { symbols: [], nowIso: "2026-11-06T12:00:00Z", name: "A, B; C" }).includes("X-WR-CALNAME:A\\, B\\; C"), "text is escaped");
ok(!buildCalendarIcs(cal, { symbols: [], nowIso: "2026-11-06T12:00:00Z" }).includes("earnings-"), "no watchlist: macro dates only");

// --- Friday recap ------------------------------------------------------------
const WR = weekRecapFactory();
eq(WR.weekOf("2026-11-06"), { start: "2026-11-02", end: "2026-11-06" }, "a Friday's week runs Monday to Friday");
eq(WR.weekOf("2026-11-08"), { start: "2026-11-02", end: "2026-11-06" }, "Sunday shows the week that just ended");
eq(WR.shiftWeek("2026-11-04", -1), "2026-10-26", "previous week starts the Monday before");
eq(WR.etKey("2026-11-07T03:30:00Z"), "2026-11-06", "late evening UTC is still Friday in New York");
const acc = {
  open: [
    { symbol: "NVDA", side: "call", score: 7.4, entryDate: "2026-11-03T16:05:00Z", optionPnlPct: 6.2 },
    { symbol: "MSFT", side: "call", score: 7.1, entryDate: "2026-10-28T19:35:00Z", optionPnlPct: -3 },
  ],
  closed: [
    { symbol: "AAPL", side: "call", score: 7.6, entryDate: "2026-10-29T15:05:00Z", exitDate: "2026-11-04T15:05:00Z", optionPnlPct: 25.4, outcome: "win", status: "hit-tp-prem" },
    { symbol: "TSLA", side: "put", score: 8.8, entryDate: "2026-11-02T16:05:00Z", exitDate: "2026-11-05T20:35:00Z", optionPnlPct: -50, outcome: "loss", status: "hit-stop-prem", eventPlay: { kind: "earnings" } },
    { symbol: "AMD", side: "call", score: 7.2, entryDate: "2026-10-20T15:05:00Z", exitDate: "2026-11-06T20:35:00Z", optionPnlPct: -51, outcome: "loss", status: "hit-stop-prem" },
    { symbol: "META", side: "call", score: 7.9, entryDate: "2026-10-12T15:05:00Z", exitDate: "2026-10-20T15:05:00Z", optionPnlPct: 30, outcome: "win", status: "hit-tp-prem", eventPlay: { kind: "earnings" } },
  ],
  gateLog: [
    { date: "2026-11-03", sym: "AMZN", side: "call", gate: "ai-wait" },
    { date: "2026-11-04", sym: "GOOGL", side: "call", gate: "ai-wait" },
    { date: "2026-11-05", sym: "AVGO", side: "put", gate: "sector-cap" },
    { date: "2026-11-03", sym: "NVDA", side: "call", gate: "opened" },
    { date: "2026-10-27", sym: "ORCL", side: "call", gate: "sector-cap" },
  ],
};
const rc = WR.build(acc, { nowIso: "2026-11-06T22:00:00Z" });
eq(rc.opened.map((x) => x.symbol), ["TSLA", "NVDA"], "opened this week, open or since closed, in order");
eq(rc.closed.map((x) => x.symbol), ["AAPL", "TSLA", "AMD"], "closed this week, whenever they opened");
eq([rc.record.wins, rc.record.losses], [1, 2], "this week's record");
eq(rc.miss.symbol, "TSLA", "the biggest miss is the losing close with the highest entry score");
eq(rc.best.symbol, "AAPL", "best close");
eq(rc.topGate.gate, "ai-wait", "the rule that turned away the most this week");
eq(rc.topGate.names, ["AMZN call", "GOOGL call"], "the names it turned away");
const earn = rc.byEvent.find((b) => b.kind === "earnings");
eq([earn.week.wins, earn.week.losses, earn.all.wins, earn.all.losses], [0, 1, 1, 1], "entry type split, this week and to date");
const withArchive = WR.build({ ...acc, archive: [
  { symbol: "ORCL", side: "call", entryDate: "2026-06-01T15:05:00Z", exitDate: "2026-06-05T15:05:00Z", optionPnlPct: 25, outcome: "win", status: "hit-tp-prem", eventPlay: { kind: "earnings" }, archived: true },
  { ...acc.closed[3], archived: true },
] }, { nowIso: "2026-11-06T22:00:00Z" });
const earnAll = withArchive.byEvent.find((b) => b.kind === "earnings").all;
eq([earnAll.wins, earnAll.losses], [2, 1], "archived trades count toward the to-date split, once each");
ok(rc.current && rc.complete, "Friday evening: the current week, closed out");
ok(!WR.build(acc, { nowIso: "2026-11-04T15:00:00Z" }).complete, "Wednesday: week in progress");
const prior = WR.build(acc, { nowIso: "2026-11-06T22:00:00Z", weekOf: "2026-10-28" });
eq(prior.opened.map((x) => x.symbol), ["MSFT", "AAPL"], "the week before");
ok(!prior.current, "an earlier week is not the current one");
const txt = WR.text(rc, { "ai-wait": "AI said wait" });
ok(/Opened 2: TSLA put \(Mon, score 8\.8, through earnings\); NVDA call/.test(txt), "recap text lists the opens");
ok(txt.includes("Closed 3: 1 won, 2 lost (33% win rate), average -25.2%."), "recap text sums the closes");
ok(txt.includes("Biggest miss: TSLA put, entry score 8.8, closed -50.0% (premium stop hit).") && txt.includes("Rule that turned away the most: AI said wait, 2 names (AMZN call, GOOGL call)."), "recap text names the miss and the rule");
ok(WR.build({}, { nowIso: "2026-11-06T22:00:00Z" }).opened.length === 0, "an empty record still builds");
ok(WR.recapReady("2026-11-06T21:05:00Z") && WR.recapReady("2026-11-08T15:00:00Z"), "the Home tile shows Friday after 4 PM ET and on the weekend");
ok(!WR.recapReady("2026-11-06T19:00:00Z") && !WR.recapReady("2026-11-09T15:00:00Z"), "not before Friday's close or on Monday");

// --- Why no picks today ------------------------------------------------------
const NP = noPicksFactory();
const runPicks = {
  builtAtIso: "2026-11-06T16:05:00Z",
  picks: [{ symbol: "NVDA", side: "call", group: "watch", entry: { now: false }, contract: {} }],
  rosterMeta: { minConviction: 4, turnedAway: [
    { sym: "AMD", side: "call", total: 6.5, gate: "below-strong" },
    { sym: "NVDA", side: "call", total: 9.1, gate: "ai-wait" },
    { sym: "TSLA", side: "put", total: -7.4, gate: "sector-cap" },
    { sym: "AMD", side: "call", total: 6.5, gate: "timing-checks" },
    { sym: "META", side: "call", total: 8, gate: "picked" },
  ] },
};
const gradesDoc = { grades: {
  AAPL: { symbol: "AAPL", total: 3.6 }, MSFT: { symbol: "MSFT", total: -3.9 }, META: { symbol: "META", total: 8 },
  AMD: { symbol: "AMD", total: 6.5 }, XOM: { symbol: "XOM", total: 1 }, KO: { symbol: "KO", total: 0 },
} };
const nm = NP.nearMisses(runPicks, gradesDoc, { isReady: (p) => pickDisplayDecision(p).ready });
eq(nm.readyCount, 0, "a watch-only roster has nothing ready to buy");
eq(nm.misses.map((m) => `${m.symbol}:${m.gate}`), ["NVDA:ai-wait", "TSLA:sector-cap", "AMD:below-strong", "MSFT:below-bar", "AAPL:below-bar"], "the run's near misses first, closest first, then the strongest scores under the bar");
ok(nm.misses[3].side === "put" && /4 or more/.test(nm.misses[3].next), "a negative score under the bar is a put and says what it needs");
eq(nm.gates.find((g) => g.gate === "below-strong").n, 1, "each rule counts the names it stopped");
ok(!nm.misses.some((m) => m.symbol === "META"), "a picked name is never a near miss");
eq(NP.nearMisses(runPicks, null, { n: 2 }).misses.length, 2, "n caps the list");
eq(NP.nearMisses({ picks: [{ group: "actionable", entry: { now: true }, contract: {}, strategy: { type: "long" }, optionEconomics: { eligible: true } }] }, null, { isReady: (p) => pickDisplayDecision(p).ready }).readyCount, 1, "a ready pick counts");
ok(Object.keys(NP.GATE_NEXT).every((k) => NP.GATE_LABEL[k]), "every rule with advice has a label");

// --- Home-screen app (PWA) -------------------------------------------------------
{
  const { readFileSync, existsSync } = await import("node:fs");
  const vm = await import("node:vm");
  const rootUrl = new URL("../", import.meta.url);
  const read = (p) => readFileSync(new URL(p, rootUrl), "utf8");
  const manifest = JSON.parse(read("manifest.webmanifest"));
  ok(manifest.start_url === "/" && manifest.display === "standalone", "the app opens the site full screen");
  for (const icon of manifest.icons) {
    const buf = readFileSync(new URL("." + icon.src, rootUrl));
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    ok(buf.slice(1, 4).toString() === "PNG" && `${w}x${h}` === icon.sizes, `${icon.src} is a ${icon.sizes} PNG`);
  }
  ok(manifest.icons.some((i) => i.purpose === "maskable"), "a maskable icon for Android");
  const staged = read("scripts/prepare-vercel.mjs");
  for (const f of ["manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"]) ok(staged.includes(`"${f}"`) && existsSync(new URL(f, rootUrl)), `${f} ships`);
  const vercel = JSON.parse(read("vercel.json"));
  const sw = vercel.headers.find((h) => h.source === "/sw.js");
  ok(sw && sw.headers.some((x) => x.key === "Cache-Control" && /max-age=0/.test(x.value)), "sw.js is never held in a long cache");
  ok(read("index.html").includes('rel="manifest"'), "the page links the manifest");
  // Run sw.js in a sandbox and see which requests it answers.
  const handlers = {};
  const sandbox = { self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: "https://mingstreet.app" }, clients: { claim: async () => {} }, skipWaiting: async () => {} },
    caches: { open: async () => ({ addAll: async () => {}, keys: async () => [], put: async () => {}, delete: async () => {} }), keys: async () => [], match: async () => null, delete: async () => {} },
    fetch: async () => new Response("{}"), URL, Response, Set, Promise };
  vm.runInNewContext(read("sw.js"), sandbox);
  const answers = (url, mode = "cors", method = "GET") => {
    let hit = false;
    handlers.fetch({ request: { url, mode, method }, respondWith: () => { hit = true; }, waitUntil: () => {} });
    return hit;
  };
  ok(answers("https://mingstreet.app/", "navigate") && answers("https://mingstreet.app/?tab=calendar", "navigate"), "the page itself works offline");
  ok(answers("https://mingstreet.app/app.js?v=sha256-1") && answers("https://mingstreet.app/js/streaks.js?v=1") && answers("https://mingstreet.app/styles.css?v=2"), "the code and styles work offline");
  ok(answers("https://mingstreet.app/api/auth/me?data=manifest-free.json") && answers("https://mingstreet.app/data/manifest.json"), "the public manifest sidecars work offline");
  for (const u of ["https://mingstreet.app/api/auth/me", "https://mingstreet.app/api/auth/me?data=picks-accuracy.json&owner=1", "https://mingstreet.app/data/picks.json",
    "https://mingstreet.app/api/quotes?symbols=AAPL", "https://mingstreet.app/api/auth/owner-watchlist", "https://mingstreet.app/api/auth/calendar-ics?o=x", "https://fonts.gstatic.com/x.woff2"]) {
    ok(!answers(u), `never kept: ${u}`);
  }
  ok(!answers("https://mingstreet.app/app.js", "cors", "POST"), "only GET requests");
  ok(!answers("https://mingstreet.app/welcome.html", "navigate"), "the sign-in page always goes to the network");
}

console.log(`site-next smoke passed (${checks} checks)`);

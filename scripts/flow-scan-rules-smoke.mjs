// Unusual-flow scan rules from the 2026-11-17 Options activity audit
// (lib/flow-scan-rules.mjs): the opening half hour and one bar per stock.
// No network. Run: node scripts/flow-scan-rules-smoke.mjs
import assert from "node:assert/strict";
import {
  flowScanSwitches,
  tradedThisSession,
  recordDailyVolume,
  stockVolumeBaseline,
  flowVolumeBars,
  barForDte,
  DAILY_KEEP,
  OPEN_WINDOW_MAX_MIN,
  flowScanVersion,
} from "../lib/flow-scan-rules.mjs";
import { buildCandidate } from "./scan-unusual.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { OWNER_SETTINGS, applyOwnerSettingsToEnv } from "../lib/owner-settings.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// 1. Switches: on unless set to an off word.
eq(flowScanSwitches({}), { openWindow: true, stockBars: true }, "both default on");
eq(flowScanSwitches({ FLOW_OPEN_WINDOW: "0", FLOW_STOCK_BARS: "off" }), { openWindow: false, stockBars: false }, "0 / off turn them off");
eq(flowScanSwitches({ FLOW_OPEN_WINDOW: " false ", FLOW_STOCK_BARS: "1" }), { openWindow: false, stockBars: true }, "false off, 1 on");
eq(flowScanSwitches({ FLOW_OPEN_WINDOW: "", FLOW_STOCK_BARS: "on" }), { openWindow: true, stockBars: true }, "empty stays on");

eq([flowScanVersion({}), flowScanVersion({ FLOW_STOCK_BARS: "0" }), flowScanVersion({ FLOW_OPEN_WINDOW: "0" }), flowScanVersion({ FLOW_OPEN_WINDOW: "0", FLOW_STOCK_BARS: "0" })],
  ["2026-11-17", "2026-11-17-open", "2026-11-17-bars", ""], "trade stamp names the switches that are on");

// 2. Traded this session: today after 9:30 ET only (November = EST, UTC-5).
const today = "2026-11-17";
ok(tradedThisSession(Date.parse("2026-11-17T14:35:00Z"), today), "9:35 ET today counts");
ok(tradedThisSession(Date.parse("2026-11-17T14:30:00Z"), today), "9:30 ET exactly counts");
ok(!tradedThisSession(Date.parse("2026-11-17T14:29:00Z"), today), "9:29 ET pre-open does not");
ok(!tradedThisSession(Date.parse("2026-11-16T20:59:00Z"), today), "yesterday's close does not");
ok(!tradedThisSession(NaN, today), "no last trade does not");
ok(!tradedThisSession(Date.parse("2026-11-17T15:00:00Z"), null), "no date key does not");

// 3. Daily totals: cumulative max per day, latest minute, last 20 days kept.
let dv = recordDailyVolume({}, "AAA", today, 30, 1200);
dv = recordDailyVolume(dv, "AAA", today, 90, 5000);
dv = recordDailyVolume(dv, "AAA", today, 60, 4000); // an out-of-order rerun never lowers it
eq(dv.AAA[today], { v: 5000, m: 90 }, "keeps the larger total and the later minute");
eq(recordDailyVolume(dv, "AAA", today, -10, 9999).AAA[today], { v: 5000, m: 90 }, "pre-open minute ignored");
eq(recordDailyVolume(dv, "AAA", today, 120, -1).AAA[today], { v: 5000, m: 90 }, "negative total ignored");
let many = {};
for (let d = 1; d <= 30; d++) many = recordDailyVolume(many, "BBB", `2026-10-${String(d).padStart(2, "0")}`, 390, d * 100);
eq(Object.keys(many.BBB).length, DAILY_KEEP, "keeps the newest 20 days");
eq(Object.keys(many.BBB)[0], "2026-10-11", "drops the oldest");

// 4. Baseline: complete days before today, median of the last 10, 5 needed.
const days = (rows) => ({ CCC: Object.fromEntries(rows.map(([d, v, m]) => [d, { v, m }])) });
eq(stockVolumeBaseline(days([
  ["2026-11-10", 100000, 390], ["2026-11-11", 120000, 390], ["2026-11-12", 80000, 390], ["2026-11-13", 90000, 390],
]), "CCC", today), null, "four complete days: no baseline yet");
eq(stockVolumeBaseline(days([
  ["2026-11-10", 100000, 390], ["2026-11-11", 120000, 390], ["2026-11-12", 80000, 390], ["2026-11-13", 90000, 390],
  ["2026-11-14", 1000, 200], // afternoon scans failed: not counted
  ["2026-11-16", 110000, 330],
  ["2026-11-17", 999999, 390], // today never counts
]), "CCC", today), 100000, "median of the five complete days before today");
eq(stockVolumeBaseline(days([
  ["2026-11-10", 100, 390], ["2026-11-11", 200, 390], ["2026-11-12", 300, 390],
  ["2026-11-13", 400, 390], ["2026-11-14", 500, 390], ["2026-11-16", 600, 390],
]), "CCC", today), 350, "even count: mean of the middle two");
const twelve = [];
for (let d = 1; d <= 12; d++) twelve.push([`2026-11-${String(d).padStart(2, "0")}`, d === 1 || d === 2 ? 1e9 : 1000 * d, 390]);
eq(stockVolumeBaseline(days(twelve), "CCC", "2026-11-13"), 7500, "only the last 10 sessions count");
eq(stockVolumeBaseline({}, "ZZZ", today), null, "unknown stock");

// 5. Bars: 1% / 0.5% of the baseline, capped at the old bar, floored at 500 / 250.
eq(flowVolumeBars(null), { near: 4000, far: 2000, relative: false, baseline: null }, "no baseline keeps the old bar");
eq(flowVolumeBars(2_000_000), { near: 4000, far: 2000, relative: false, baseline: 2000000 }, "a huge name keeps the old bar");
eq(flowVolumeBars(120_000), { near: 1200, far: 600, relative: true, baseline: 120000 }, "a mid-size name gets its own bar");
eq(flowVolumeBars(20_000), { near: 500, far: 250, relative: true, baseline: 20000 }, "a small name is floored");
eq(flowVolumeBars(120_000, { stockBars: false }), { near: 4000, far: 2000, relative: false, baseline: null }, "switch off keeps the old bar");
eq(barForDte({ near: 1200, far: 600 }, 14), 1200, "14 days is near");
eq(barForDte({ near: 1200, far: 600 }, 15), 600, "15 days is far");
eq(barForDte(null, 3), 4000, "no bars = old near bar");
eq(barForDte(undefined, null), 2000, "unknown DTE = far bar");

// 6. The scanner's candidate check with the new context.
const nowMs = Date.parse("2026-11-17T15:05:00Z"); // 10:05 ET
const expSec = Date.parse("2026-11-21T00:00:00Z") / 1000; // 4 days out
const contract = (over = {}) => ({
  strike: 110, volume: 1500, openInterest: 300, lastPrice: 1.2, bid: 1.15, ask: 1.25, impliedVolatility: 0.5,
  lastTradeDate: new Date("2026-11-17T15:01:00Z"), ...over,
});
const ctxOpen = { openWindow: true, todayKey: today, bars: flowVolumeBars(120_000) };
const scannedAt = new Date(nowMs).toISOString();
let c = buildCandidate("CCC", "call", contract(), expSec, scannedAt, 100, null, nowMs, ctxOpen);
ok(c.flagged && c.sinceOpen && c.deltaVol === 1500 && c.bar === 1200 && c.stockBar, "first scan: 1,500 since the open clears a 1,200 bar");
c = buildCandidate("CCC", "call", contract(), expSec, scannedAt, 100, null, nowMs, { ...ctxOpen, bars: flowVolumeBars(null) });
ok(!c.flagged && c.sinceOpen && c.bar === 4000 && !c.stockBar, "the same trade misses the old 4,000 bar");
c = buildCandidate("CCC", "call", contract({ lastTradeDate: new Date("2026-11-16T20:55:00Z") }), expSec, scannedAt, 100, null, nowMs, ctxOpen);
ok(!c.flagged && c.deltaVol == null && !c.sinceOpen, "not traded today: yesterday's total is not measured");
c = buildCandidate("CCC", "call", contract(), expSec, scannedAt, 100, null, nowMs, { ...ctxOpen, openWindow: false });
ok(!c.flagged && c.deltaVol == null, "switch off: first scan flags nothing (old behavior)");
const prev = new Map([["CCC|call|110|" + expSec, 200]]);
prev.coveredSymbols = new Set(["CCC"]);
c = buildCandidate("CCC", "call", contract(), expSec, scannedAt, 100, prev, nowMs, ctxOpen);
ok(c.flagged && !c.sinceOpen && c.deltaVol === 1300, "with a same-day snapshot the hourly delta is used, not since-open");
c = buildCandidate("CCC", "call", contract({ volume: 250 }), expSec, scannedAt, 100, null, nowMs, ctxOpen);
ok(!c.flagged, "vol > OI still required");
c = buildCandidate("CCC", "call", contract({ strike: 102 }), expSec, scannedAt, 100, null, nowMs, ctxOpen);
ok(!c.flagged, "5% OTM minimum still required");
c = buildCandidate("CCC", "call", contract(), expSec, scannedAt, 100, null, nowMs);
ok(!c.flagged && c.bar === 4000, "no context = the old behavior");
ok(OPEN_WINDOW_MAX_MIN === 120, "opening window ends at 11:30 ET");

// 7. Owner Settings: both switches exist and apply as off.
for (const key of ["FLOW_OPEN_WINDOW", "FLOW_STOCK_BARS"]) {
  const def = OWNER_SETTINGS.find((d) => d.key === key);
  ok(def && def.scope === "build" && def.default === true && def.impact === "high" && def.picks, `${key} is a high-impact build switch`);
}
const env = {};
applyOwnerSettingsToEnv(JSON.stringify({ values: { FLOW_STOCK_BARS: false }, history: [] }), env);
eq(flowScanSwitches(env), { openWindow: true, stockBars: false }, "an Owner Settings off reaches the switch");

// 8. The page labels a since-open flag and shows the bar.
const js = renderAppJs();
ok(js.includes("' since open'") && js.includes("' since the open'"), "chip and tooltip say since the open");
ok(js.includes("set from this stock\u2019s normal option volume"), "tooltip explains the per-stock bar");
ok(js.includes("key:'flowscan'") && js.includes("'2026-11-17': { note:'Flow scan counts the opening half hour"), "Track Record draws a divider at the flow-scan stamp");

console.log(`flow scan rules smoke passed (${checks} checks)`);

// Offline checks for the W3 Webull data logs (lib/webull-data/: order flow,
// market breadth, backups), their jobs, the bake helpers, the Owner-only key
// registration and the MCP scrub. Made-up numbers only: Webull's terms forbid
// republishing its data and this repo is public, so no real answer is
// committed. When the Owner's probe samples are on this machine (the project
// files folder), they are parsed too, as a shape check, and nothing from them
// is printed.
//
// Run: node scripts/webull-w3-smoke.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCapitalFlow, mergeFlow, noteFlowMiss, flowShadowRow, flowShadowRows, flowSummary, emptyFlowFile, FLOW_KEY } from "../lib/webull-data/flow.mjs";
import { bucketOf, parseSectors, parseSectorPage, parseList, applyBreadthRecord, emptyBreadthFile, breadthGauges, breadthContextRow, breadthView, BREADTH_KEY, LISTS } from "../lib/webull-data/breadth.mjs";
import {
  parseEarningsCalendar, parseRating, parseTarget, parseFearGreed, parseEconPage, applyBackupRecord, emptyBackupFile,
  chainsWithEarningsBackup, earningsDisagreements, streetTargetBackup, fearGreedCheck, fearGreedStandIn, econDisagreements, BACKUP_KEY, BACKUP_CHECK_KEY,
} from "../lib/webull-data/backup.mjs";
import { w3Switches, readWebullW3, w3ShadowInputs, w3BottomContextRow, w3EvidenceTests, buildBackupCheck } from "../lib/webull-data/bake.mjs";
import { FUND_SYMBOLS, readKey } from "../lib/webull-data/jobs/w3-shared.mjs";
import flowJob from "../lib/webull-data/jobs/webull-flow.mjs";
import breadthJob from "../lib/webull-data/jobs/webull-breadth.mjs";
import backupJob, { rotationSlice } from "../lib/webull-data/jobs/webull-backup.mjs";
import { scrubWebull, mayHoldWebull } from "../lib/webull-data/mcp-scrub.mjs";
import { buildShadowSignals, shadowValue, SHADOW_SIGNAL_VERSION, SHADOW_KEYS, SHADOW_MARKET_KEYS } from "../lib/shadow-signals.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { REQUEST_TIME_EXCLUSIVE_KEYS, OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { ownerSettingDef } from "../lib/owner-settings.mjs";
import { withExtraContext } from "../lib/bottom-tracker.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// --- C: order flow ---------------------------------------------------------
const flowAnswer = [
  { date: "20261110", large_in: "1.2E8", large_out: "1.0E8", medium_in: "5e7", medium_out: "6e7", small_in: "2e7", small_out: "2e7" },
  { date: "20261111", large_in: "100", large_out: "300", medium_in: "100", medium_out: "100", small_in: "100", small_out: "100" },
  { date: "20261112", large_in: "300", large_out: "100", medium_in: "100", medium_out: "100", small_in: "100", small_out: "100" },
  { date: "20261113", large_in: "300", large_out: "100", medium_in: "100", medium_out: "100", small_in: "100", small_out: "100" },
  { date: "bad", large_in: "1" },
  { date: "20261114", large_in: "", large_out: "1", medium_in: "1", medium_out: "1", small_in: "1", small_out: "1" },
];
const rows = parseCapitalFlow(flowAnswer);
eq(rows.length, 4, "bad date and a blank amount are dropped");
eq(rows[0], ["2026-11-10", 120000000, 100000000, 50000000, 60000000, 20000000, 20000000], "exponent strings parse to whole dollars");
let ff = mergeFlow(emptyFlowFile(), "AAA", rows, { nowIso: "2026-11-14T22:00:00Z" });
ff = mergeFlow(ff, "AAA", [["2026-11-13", 500, 100, 100, 100, 100, 100], ["2026-11-14", 300, 100, 100, 100, 100, 100]], { nowIso: "2026-11-15T22:00:00Z" });
eq(ff.rows.AAA.length, 5, "upsert by date: a re-read day replaces, a new day appends");
eq(ff.rows.AAA[3][1], 500, "the newer read of the same date wins");
eq(ff.lastDate, "2026-11-14", "lastDate follows the newest session");
noteFlowMiss(ff, "ETF1", "INVALID_SYMBOL", "2026-11-15T22:00:00Z");
eq(flowSummary(ff).misses, 1, "a refused name is logged as a miss");
ff = mergeFlow(ff, "BBB", [["2026-11-14", 100, 100, 100, 100, 100, 100]]);
const capped = mergeFlow(emptyFlowFile(), "C", Array.from({ length: 12 }, (_, i) => [`2026-10-${String(i + 10).padStart(2, "0")}`, 1, 1, 1, 1, 1, 1]), { max: 10 });
eq(capped.rows.C.length, 10, "the rolling cap keeps the newest sessions");
// Shadow: only sessions before the grade date; 2026-11-14 is excluded on that date.
const sr = flowShadowRow(ff.rows.AAA, "2026-11-14");
ok(sr && sr.wfl === Math.round(((500 - 100) / 1000) * 10000) / 100, "wfl = large net / total of the last session before the date");
ok(sr.wfl5 == null, "wfl5 needs five sessions before the date");
const sr2 = flowShadowRow(ff.rows.AAA, "2026-11-16");
ok(sr2.wfl5 != null && sr2.wft != null, "five sessions give wfl5");
eq(flowShadowRow(ff.rows.AAA, "2026-11-30"), null, "a stale log is never logged as today's");
ok(Object.keys(flowShadowRows(ff, "2026-11-16")).includes("BBB"), "every name in the file gets a row");

// --- D: breadth ------------------------------------------------------------
eq([-0.15, -0.07, -0.03, -0.01, 0, 0.01, 0.03, 0.07, 0.2, "x"].map(bucketOf), [0, 1, 2, 3, 4, 5, 6, 7, 8, -1], "change ratios bucket like Webull's widget");
const sectorsAnswer = { data: [
  { id: "1", name: "Software", advanced: "39", declined: "92", flat: "451", change_ratio: "0.0173", volume: "100", market_value: "200", data: [] },
  { id: "2", name: "Banks", advanced: "60", declined: "20", flat: "10", change_ratio: "-0.002" },
  { id: "3", name: "No counts" },
], pagination_key: "p2" };
const ps = parseSectors(sectorsAnswer);
eq(ps.sectors.length, 2, "a sector without counts is dropped");
eq(ps.next, "p2", "the next page key is kept");
eq(ps.sectors[0].chg, 1.73, "sector change in percent");
const pg = parseSectorPage({ data: [{ change_ratio: "0.06" }, { change_ratio: "-0.12" }, { change_ratio: "0" }, {}], pagination_key: "" });
eq([pg.n, pg.counts[7], pg.counts[0], pg.counts[4], pg.next], [3, 1, 1, 1, null], "a detail page counts each stock once; no key = last page");
const bigList = { data: Array.from({ length: 200 }, (_, i) => ({ symbol: `S${i}`, name: "N", price: "1", change_ratio: "0.1", volume: "5" })) };
const pl = parseList(bigList);
ok(pl.capped && pl.n === 200 && pl.rows.length === 50, "a 200-row answer is marked capped and trimmed to 50 rows");
let bf = emptyBreadthFile();
const D1 = "2026-11-13", D2 = "2026-11-14";
bf = applyBreadthRecord(bf, { kind: "sectors", date: D1, sectors: ps.sectors });
bf = applyBreadthRecord(bf, { kind: "sector-page", date: D1, sectorId: "1", page: 0, counts: pg.counts, n: pg.n, last: true });
bf = applyBreadthRecord(bf, { kind: "sector-page", date: D1, sectorId: "1", page: 0, counts: pg.counts, n: pg.n, last: true });
eq(bf.today.buckets.n, 3, "a re-read page is not counted twice");
ok(!breadthView(bf).buckets.complete, "one of two sectors read = incomplete");
bf = applyBreadthRecord(bf, { kind: "sector-page", date: D1, sectorId: "2", page: 0, counts: pg.counts, n: pg.n, last: true });
ok(breadthView(bf).buckets.complete, "every sector read = complete");
bf = applyBreadthRecord(bf, { kind: "list", date: D1, list: "newHigh", n: 40, capped: false, rows: [] });
bf = applyBreadthRecord(bf, { kind: "list", date: D1, list: "newLow", n: 200, capped: true, rows: [] });
bf = applyBreadthRecord(bf, { kind: "error", date: D1, part: "losers", reason: "HTTP_417" });
eq(bf.history.length, 1, "one history row per session");
eq(bf.history[0].advPct, Math.round((99 / (99 + 112)) * 10000) / 100, "advPct = advancers over advancers plus decliners (flat and untraded left out)");
const g = breadthGauges(bf, D2);
ok(g.wbAdv != null && g.wbHL == null && g.wbUp5 != null, "a capped 52-week list leaves wbHL out; complete buckets give wbUp5");
eq(breadthGauges(bf, D1), {}, "the grade date's own session is never read");
const before = bf.today;
bf = applyBreadthRecord(bf, { kind: "sectors", date: "2026-11-12", sectors: ps.sectors });
eq(bf.today, before, "an older day never replaces a newer one");
const row = breadthContextRow(bf, null);
ok(row && row.id === "webull-breadth" && ["washout", "stretched", "neutral"].includes(row.lean) && /Owner only/.test(row.source), "the Bottom tracker context row is labeled and leans");
const withRow = withExtraContext({ rows: [{ id: "baa", title: "Baa" }], note: "n" }, [row, null]);
eq(withRow.rows.map((r) => r.id), ["baa", "webull-breadth"], "the Webull row is appended after the existing context rows");
eq(withExtraContext({ rows: [], note: "n" }, []).note, "n", "no extra rows = the context block unchanged");

// --- E: backups -----------------------------------------------------------
const TODAY = "2026-11-19";
const earn = parseEarningsCalendar([
  { fiscal_year: "2026", fiscal_period: "3", expected_publish_date: "2026-11-01", eps_est: "1", eps_actual: "1.1" },
  { fiscal_year: "2026", fiscal_period: "4", expected_publish_date: "2026-12-02", eps_est: "1.2" },
], TODAY);
eq(earn.next, "2026-12-02", "the next date is the first one on or after today with no actual");
eq(parseRating({ strong_buy: "3", buy: "5", hold: "2", under_perform: "0", sell: "0", number: "10" }).n, 10, "rating counts");
eq(parseTarget({ mean: "100.5", low: "80", high: "120", median: "101", currency: "USD" }).mean, 100.5, "target mean");
eq(parseTarget({ mean: "0" }), null, "a zero target is not a target");
const fgAns = { current: { date: "2026-11-18", fear_greed_index: "22", grade: "Fear" }, previous_day: { date: "2026-11-17", fear_greed_index: "25" }, one_week_ago: { date: "2026-11-11", fear_greed_index: "40" }, one_month_ago: { date: "2026-10-17", fear_greed_index: "55" } };
const fgPts = parseFearGreed(fgAns);
eq(fgPts.length, 4, "four dated Fear & Greed points");
const econ = parseEconPage({ data: [{ event_name: "CPI (YoY)", publish_date: "2026-12-10", publish_time: "2026-12-10T13:30:00.000+0000" }, { event_name: "x" }], pagination_key: "k" });
eq([econ.events.length, econ.events[0].time, econ.next], [1, "13:30Z", "k"], "econ rows keep the UTC time; a row with no date is dropped");
let bk = emptyBackupFile();
const at = "2026-11-18T21:30:00Z";
bk = applyBackupRecord(bk, { kind: "earnings", sym: "AAA", value: earn }, { nowIso: at });
bk = applyBackupRecord(bk, { kind: "earnings", sym: "BBB", value: { quarters: [], next: "2026-11-25" } }, { nowIso: at });
bk = applyBackupRecord(bk, { kind: "target", sym: "AAA", value: parseTarget({ mean: "100", low: "80", high: "120" }) }, { nowIso: at });
bk = applyBackupRecord(bk, { kind: "fearGreed", points: fgPts }, { nowIso: at });
bk = applyBackupRecord(bk, { kind: "econ", first: true, from: TODAY, to: "2026-12-19", events: econ.events, last: false }, { nowIso: at });
bk = applyBackupRecord(bk, { kind: "econ", from: TODAY, to: "2026-12-19", events: econ.events, last: true }, { nowIso: at });
eq([bk.econ.events.length, bk.econ.complete], [1, true], "econ pages dedupe and finish");
eq(bk.fearGreed.latest.value, 22, "latest Fear & Greed is the current point");
const chains = { AAA: { fundamentals: {} }, BBB: { fundamentals: { nextEarningsDate: "2026-11-21" } }, SPY: { fundamentals: {} } };
const eb = chainsWithEarningsBackup(chains, bk, TODAY, { isEtf: (s) => s === "SPY" });
eq(eb.filled, [{ symbol: "AAA", date: "2026-12-02" }], "only a name with no main-source date is filled");
ok(eb.chains !== chains && eb.chains.BBB === chains.BBB && chains.AAA.fundamentals.nextEarningsDate == null, "copy-on-write: the public chains object is untouched");
eq(eb.chains.AAA.fundamentals.nextEarningsSource, "webull-backup", "a filled date is labeled");
eq(chainsWithEarningsBackup(chains, null, TODAY).chains, chains, "no backup file = the same chains object");
eq(earningsDisagreements(chains, bk, TODAY).map((d) => d.symbol), ["BBB"], "a 4-day gap between sources is flagged");
eq(Object.keys(streetTargetBackup(bk, TODAY)), ["AAA"], "fresh targets only");
eq(Object.keys(streetTargetBackup(bk, "2027-02-01")), [], "an old target is not used");
const cnnSame = [{ date: "2026-11-18", score: 22.4 }, { date: "2026-11-17", score: 25 }, { date: "2026-11-11", score: 39.2 }, { date: "2026-10-17", score: 55.6 }];
const same = fearGreedCheck(bk, cnnSame);
ok(same.sameIndex && same.verdict === "same-index", "four dates within 1.5 points = the same index");
const diff = fearGreedCheck(bk, cnnSame.map((p) => ({ ...p, score: p.score + 6 })));
ok(!diff.sameIndex && diff.verdict === "different-index", "a 6-point gap = a different index");
eq(fearGreedCheck(bk, cnnSame.slice(0, 2)).verdict, "not-enough-dates", "two dates are not enough");
ok(fearGreedStandIn(bk, same, { cnnFresh: false, lastGoodDate: "2026-11-14", todayEt: TODAY })?.source === "webull-backup", "CNN failed + same index = stand-in");
eq(fearGreedStandIn(bk, same, { cnnFresh: true, todayEt: TODAY }), null, "CNN fresh = no stand-in");
eq(fearGreedStandIn(bk, diff, { cnnFresh: false, todayEt: TODAY }), null, "a different index never stands in");
eq(fearGreedStandIn(bk, same, { cnnFresh: false, lastGoodDate: "2026-11-18", todayEt: TODAY }), null, "not newer than CNN's last good = no stand-in");
eq(econDisagreements([{ group: "cpi", date: "2026-12-09" }, { group: "cpi", date: "2026-12-10" }], bk).length, 1, "a release date one day off is flagged; the same date is not");
const check = buildBackupCheck({ w3: { on: { WEBULL_BACKUPS: true }, backup: bk }, chains, todayEt: TODAY, isEtf: (s) => s === "SPY", earningsFilled: eb.filled, targetsFilled: ["AAA"], fearGreed: same, ourReports: [], builtAtIso: at });
eq([check.key, check.earnings.filled.length, check.earnings.disagree.length], [BACKUP_CHECK_KEY, 1, 1], "the Owner backup report");

// --- switches and bake reads ----------------------------------------------
eq(w3Switches({}, null), { WEBULL_FLOW_LOG: true, WEBULL_BREADTH_LOG: true, WEBULL_BACKUPS: true }, "on by default");
eq(w3Switches({ WEBULL_FLOW_LOG: "0", WEBULL_BACKUPS: "off" }, { values: { WEBULL_BREADTH_LOG: false } }), { WEBULL_FLOW_LOG: false, WEBULL_BREADTH_LOG: false, WEBULL_BACKUPS: false }, "env 0/off and a saved false each turn one off");
const dir = mkdtempSync(join(tmpdir(), "w3-"));
writeFileSync(join(dir, FLOW_KEY), JSON.stringify(ff));
writeFileSync(join(dir, BREADTH_KEY), JSON.stringify(bf));
writeFileSync(join(dir, BACKUP_KEY), JSON.stringify(bk));
const w3 = await readWebullW3(dir, {});
ok(w3.flow && w3.breadth && w3.backup, "the bake reads the three hydrated files");
writeFileSync(join(dir, "owner-settings.json"), JSON.stringify({ values: { WEBULL_FLOW_LOG: false } }));
const w3off = await readWebullW3(dir, {});
ok(w3off.flow == null && w3off.breadth, "a switch off in Owner Settings stops the bake reading that file");
const si = w3ShadowInputs(w3, "2026-11-16");
ok(si.flow.AAA && si.market.wbAdv != null, "shadow inputs for flow and the market gauges");
ok(w3BottomContextRow(w3, null)?.id === "webull-breadth", "Bottom tracker row");
const ev = w3EvidenceTests(w3, TODAY);
eq(ev.map((t) => [t.id, t.lane, t.status]), [["webull-flow", "signals", "collecting"], ["webull-breadth", "signals", "collecting"]], "two Evidence board rows, logging");
ok(/3 months/.test(ev[0].name) && ev[0].progress.need === 63, "test after about three months");

// --- shadow v8 ------------------------------------------------------------
eq(SHADOW_SIGNAL_VERSION >= 8, true, "shadow version 8 or later");
{ const k = SHADOW_KEYS.join(), m = SHADOW_MARKET_KEYS.join(); ok(k.includes("ufb,wfl,wft,wfl5") && m.includes("pmJmp,wbAdv,wbHL,wbUp5"), "new keys appended after the version 7 keys"); }
const sh = buildShadowSignals({ AAA: { spot: 10 } }, { builtAtIso: "2026-11-16T21:00:00Z", webullFlow: si.flow, marketExtra: si.market });
ok(shadowValue(sh, "AAA", "wfl") === si.flow.AAA.wfl && sh.mkt.wbAdv === si.market.wbAdv, "the shadow block carries the Webull keys");

// --- jobs with a fake client and store -----------------------------------
const mem = new Map();
const store = { get: async (k) => (mem.has(k) ? Buffer.from(mem.get(k)) : null), put: async (k, v) => { mem.set(k, String(v)); } };
const counts = {};
const ctx = { date: TODAY, phase: "close", nowMs: Date.parse("2026-11-19T21:40:00Z"), tickers: ["AAA", "SPY", "BBB"], store, count: (n, k) => { counts[n] = (counts[n] || 0) + k; } };
const calls = [];
const client = { get: async (path, q) => {
  calls.push(path);
  if (path.includes("capital-flows")) { if (q.symbol === "SPY") { const e = new Error("bad"); e.status = 417; e.code = "INVALID_SYMBOL"; throw e; } return flowAnswer; }
  if (path.endsWith("market-sectors/list")) return q.pagination_key ? { data: [] } : { data: sectorsAnswer.data.slice(0, 1), pagination_key: "p2" };
  if (path.endsWith("market-sectors/get")) return q.pagination_key ? { data: [{ change_ratio: "0.01" }] } : { data: [{ change_ratio: "-0.03" }], pagination_key: "d2" };
  if (path.includes("earnings-calendars")) return [{ expected_publish_date: "2026-12-02", eps_est: "1" }];
  if (path.includes("ratings")) return { buy: "3", number: "3" };
  if (path.includes("target-prices")) return { mean: "50" };
  if (path.includes("fear-greed")) { ok(Object.keys(q).length === 0, "Fear & Greed is called with no params, as the probe did"); return fgAns; }
  if (path.includes("economic-calendars")) return q.pagination_key ? { data: [] } : { data: [{ event_name: "CPI", publish_date: "2026-12-10" }], pagination_key: "e2" };
  return { data: [] };
} };
async function drain(job) {
  const state = {};
  ok(job.plan(state, { ...ctx, phase: "intraday" }).length === 0, `${job.id}: no plan before the close`);
  let queue = job.plan(state, ctx);
  ok(queue.length > 0, `${job.id}: planned`);
  eq(job.plan(state, ctx), [], `${job.id}: planned once per session`);
  let n = 0;
  while (queue.length && n < 500) {
    const item = queue.shift(); n++;
    const out = await job.run(item, client, ctx);
    const recs = Array.isArray(out) ? out : out?.records || [];
    if (!Array.isArray(out) && Array.isArray(out?.more)) queue = [...out.more, ...queue];
    await job.save(recs, store, ctx);
  }
  return n;
}
const nFlow = await drain(flowJob);
eq(nFlow, 3, "flow: one call per name");
const savedFlow = JSON.parse(mem.get(FLOW_KEY));
ok(savedFlow.rows.AAA && savedFlow.misses.SPY && !JSON.stringify(savedFlow.misses).includes("bad"), "flow: a refused fund is a miss with a fixed label");
const nBreadth = await drain(breadthJob);
eq(nBreadth, 2 + 2 + Object.keys(LISTS).length, "breadth: sectors pages, detail pages via `more`, then the lists");
const savedB = JSON.parse(mem.get(BREADTH_KEY));
ok(savedB.today.buckets.n === 2 && savedB.today.buckets.sectorsDone["1"], "breadth: detail pages walked to the end");
const nBackup = await drain(backupJob);
const stocks = ["AAA", "BBB"];
const slice = rotationSlice(stocks, TODAY);
eq(nBackup, 1 + 2 + stocks.length + slice.length * 2, "backup: Fear & Greed, econ pages, earnings for stocks (no funds), ratings and targets for a fifth");
const savedK = JSON.parse(mem.get(BACKUP_KEY));
ok(savedK.earnings.AAA?.next === "2026-12-02" && !savedK.earnings.SPY && savedK.econ.complete, "backup: saved");
eq(new Set(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].flatMap((_, i) => rotationSlice(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"], `2026-11-${16 + i}`))).size, 6, "every name rotates in within a week");
// A failed read never saves over the history.
await assert.rejects(readKey({ get: async () => { throw new Error("store down"); } }, FLOW_KEY, emptyFlowFile), /store down/); checks++;
await assert.rejects(readKey({ get: async () => Buffer.from("{bad") }, FLOW_KEY, emptyFlowFile)); checks++;
eq(await readKey({ get: async () => null }, FLOW_KEY, emptyFlowFile), emptyFlowFile(), "a missing key starts empty");
ok(calls.every((p) => /^\/market-data\//.test(p)), "every call is a /market-data/ GET");

// --- funds list matches build.mjs ------------------------------------------
const { TICKERS, SECTORS } = await import("../scripts/build.mjs");
const etfs = TICKERS.filter((s) => SECTORS[s] === "ETF");
ok(etfs.length >= 5, "found the covered ETFs");
eq(new Set(FUND_SYMBOLS.filter((s) => TICKERS.includes(s))), new Set(etfs), "FUND_SYMBOLS = the covered SECTORS ETF names");

// --- Owner-only, request-time, MCP ----------------------------------------
for (const k of [FLOW_KEY, BREADTH_KEY, BACKUP_KEY, BACKUP_CHECK_KEY]) {
  ok(isPremiumKey(k) && roleClaimForKey(k).join() === "tr,tp", `${k} is Owner-only`);
}
for (const k of [FLOW_KEY, BREADTH_KEY, BACKUP_KEY]) ok(REQUEST_TIME_EXCLUSIVE_KEYS.has(k), `${k} is request-time-owned (no workflow pushes it)`);
ok(OPTIONAL_BAKE_KEYS.includes(BACKUP_CHECK_KEY) && !REQUEST_TIME_EXCLUSIVE_KEYS.has(BACKUP_CHECK_KEY), "the backup report is bake-owned");
for (const k of ["WEBULL_FLOW_LOG", "WEBULL_BREADTH_LOG", "WEBULL_BACKUPS"]) ok(ownerSettingDef(k)?.scope === "site" && ownerSettingDef(k).group === "Webull data", `${k} is an Owner Settings live switch`);
ok(ownerSettingDef("WEBULL_BACKUPS").impact === "high", "the backups switch can change Top Picks, so it is marked big impact");
const dirty = {
  days: [{ date: "d", shadow: { keys: ["r21", "wfl", "wfl5"], rows: { AAA: [1, 2, 3] }, mkt: { pc: 1, wbAdv: 50 } } }],
  context: { rows: [{ id: "baa", title: "Baa" }, { id: "webull-breadth", title: "W", source: "Webull OpenAPI screeners (Owner only)" }] },
  rows: { AAA: { street: { mean: 9, source: "webull-backup" } } },
  open: [{ entrySnapshot: { shadow: { r21: 1, wft: 2 } } }],
};
ok(mayHoldWebull(JSON.stringify(dirty)) && !mayHoldWebull(JSON.stringify({ a: 1 })), "the cheap pre-check");
const clean = scrubWebull(dirty);
eq(clean.days[0].shadow.rows.AAA, [1, null, null], "shadow columns blanked");
eq(clean.days[0].shadow.mkt, { pc: 1 }, "market gauges dropped");
eq(clean.context.rows.map((r) => r.id), ["baa"], "the Webull context row dropped");
eq(clean.rows.AAA.street, { source: "webull-backup", withheld: true }, "a backup street target withheld");
eq(clean.open[0].entrySnapshot.shadow, { r21: 1 }, "entry snapshot keys dropped");
ok(!/wbAdv|"wft"|Webull OpenAPI|"mean":9/.test(JSON.stringify(clean)), "no Webull value left (column names stay in the shadow key list)");

// --- the Owner's probe samples, when on this machine (shape check only) ----
const SAMPLES = "/mnt/project-files/engine-roadmap/webull-probe-samples";
if (existsSync(SAMPLES)) {
  const read = (f) => { try { return JSON.parse(readFileSync(join(SAMPLES, f), "utf8")); } catch { return null; } };
  const cf = read("capital_flow_NVDA.json");
  if (cf?.sample) ok(parseCapitalFlow(cf.sample).length === cf.sample.length, "probe: capital flow rows parse");
  const ms = read("market_sectors.json");
  if (ms?.sample) ok(parseSectors({ data: ms.sample }).sectors.length === ms.sample.length, "probe: sector rows parse");
  for (const f of ["gainers.json", "losers.json", "top_actives.json", "week52_new_high.json"]) {
    const j = read(f);
    if (Array.isArray(j?.sample)) ok(parseList({ data: j.sample }).rows.length === Math.min(j.sample.length, 50), `probe: ${f} rows parse`);
  }
  const tp = read("analyst_target_price.json");
  if (tp?.sample) ok(parseTarget(tp.sample)?.mean > 0, "probe: target parses");
  const ec = read("economic_calendar.json");
  if (Array.isArray(ec?.sample)) ok(parseEconPage({ data: ec.sample }).events.length > 0, "probe: econ rows parse");
}

console.log(`webull W3 smoke: ${checks} checks passed`);
process.exit(0);

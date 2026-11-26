#!/usr/bin/env node
// Offline checks for the data source health table (lib/source-health.mjs):
// the payload scan, the per-source states, the day history and the Update
// Checker response that carries it. No network, no writes outside a temp dir.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCES, SOURCE_HEALTH_KEEP_DAYS, scanPayload, assessSource, buildSourceHealth, parseSourceHealth, loadSourceHealth, readSourcePayloads, writeSourceHealth } from "../lib/source-health.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { handleUpdateChecker } from "../lib/update-checker-http.mjs";

const now = Date.parse("2026-11-09T21:15:00Z");
const built = "2026-11-09T21:10:00Z";
const def = (id) => SOURCES.find((d) => d.id === id);
assert.equal(new Set(SOURCES.map((d) => d.id)).size, SOURCES.length, "source ids are unique");
assert.ok(isPremiumKey("source-health.json") && OPTIONAL_BAKE_KEYS.includes("source-health.json"));

// scanPayload: newest past date wins, future dates (calendar) are ignored,
// builtAtIso never counts, carry markers and failed statuses are counted.
const scan = scanPayload({
  builtAtIso: "2026-11-09T21:10:00Z",
  events: [{ date: "2026-11-05", stale: false }, { date: "2026-11-20" }, { date: "2026-11-08", stale: true }],
  sourceHealth: [{ id: "a", status: "ok" }, { id: "b", status: "failed" }],
  deep: { deeper: { deepest: { asOf: "2026-11-09T12:00:00Z" } } },
}, now);
assert.equal(scan.at, Date.parse("2026-11-09T12:00:00Z"));
assert.equal(scan.flagged, 2); assert.equal(scan.carried, 1); assert.equal(scan.failed, 1); assert.equal(scan.statuses, 2);

// An observation date beats a fetch stamp on the same object (review
// 2026-11-22): a weekly COT block read today but holding an old report is
// as old as the report. A stamp alone still counts.
const cotBlock = { ok: true, stale: false, carriedForward: false, fetchedAt: "2026-11-09T20:03:00Z", fetchedDate: "2026-11-09", asOf: "2026-10-20", contracts: { ES: { asOf: "2026-10-20" } } };
assert.equal(scanPayload(cotBlock, now).at, Date.parse("2026-10-20T12:00:00Z"), "asOf wins over fetchedAt");
assert.equal(scanPayload({ generatedAtIso: "2026-11-09T20:00:00Z", story: "x" }, now).at, Date.parse("2026-11-09T20:00:00Z"), "a lone stamp still counts");
assert.equal(scanPayload({ a: { asOf: "2026-11-01" }, b: { fetchedAt: "2026-11-09T20:00:00Z" } }, now).at, Date.parse("2026-11-09T20:00:00Z"), "a stamp on an object without an observation date still counts");
assert.equal(scanPayload({ asOf: "2026-10", fetchedAt: "2026-11-09T20:00:00Z" }, now).at, Date.parse("2026-11-09T20:00:00Z"), "an unparseable observation date does not hide the stamp");
assert.equal(assessSource(def("crowd-cot"), { cot: cotBlock }, now).state, "aged", "an old COT report reads aged");
assert.equal(assessSource(def("crowd-cot"), { cot: { ...cotBlock, asOf: "2026-11-03" } }, now).state, "ok", "last Friday's release (Tuesday report) is fresh");

// assessSource states.
assert.equal(assessSource(def("fear-greed"), null, now).state, "missing");
assert.equal(assessSource(def("fear-greed"), null, now, "invalid").state, "unreadable");
assert.equal(assessSource(def("fear-greed"), { asOf: "2026-11-09", score: 40, stale: false }, now).state, "ok");
assert.equal(assessSource(def("fear-greed"), { asOf: "2026-11-02", score: 40, stale: true }, now).state, "carried");
const aged = assessSource(def("fear-greed"), { asOf: "2026-11-01", score: 40 }, now);
assert.equal(aged.state, "aged"); assert.match(aged.detail, /8 days old/);
assert.equal(assessSource(def("f13"), { builtAtIso: built, period: "Q3 2026", perFirm: {} }, now).state, "ok", "undated payload written this run reads ok");
// Webull data logs (audit 2026-11-22): the bake passes the newest session
// each log holds (a Friday session still reads ok on Monday), or a note when
// the log is switched off.
assert.equal(assessSource(def("webull-flow"), { lastDate: "2026-11-06" }, now).state, "ok");
assert.equal(assessSource(def("webull-breadth"), { lastDate: "2026-11-03" }, now).state, "aged");
assert.equal(assessSource(def("webull-flow"), { note: "switched off" }, now).state, "ok");
assert.equal(assessSource(def("webull-flow"), null, now).state, "missing");
// AI lab release-note readers (audit 2026-11-22): a failed reader is a
// partial read; the newest good read is the observation date.
assert.equal(assessSource(def("ai-disruption"), { sources: [{ lab: "a", ok: true, lastOk: "2026-11-09" }, { lab: "b", ok: true, lastOk: "2026-11-08" }] }, now).state, "ok");
const aiPart = assessSource(def("ai-disruption"), { sources: [{ lab: "a", ok: true, lastOk: "2026-11-09" }, { lab: "b", ok: false, lastOk: "2026-11-02" }] }, now);
assert.equal(aiPart.state, "partial"); assert.match(aiPart.detail, /1 of 2 source checks not ok/);
assert.equal(assessSource(def("ai-disruption"), { sources: [{ lab: "a", ok: true, lastOk: "2026-11-01" }] }, now).state, "aged");
assert.equal(assessSource(def("ai-disruption"), { enabled: false }, now).state, "missing");
const partial = assessSource(def("commodities"), { builtAtIso: built, items: [{ key: "a", asOf: "2026-11-09", stale: false }, { key: "b", asOf: "2026-11-09", stale: false }, { key: "c", asOf: "2026-11-01", stale: true }] }, now);
assert.equal(partial.state, "partial"); assert.match(partial.detail, /1 of 3 parts carried/);
const mostly = assessSource(def("commodities"), { builtAtIso: built, items: [{ key: "a", stale: true }, { key: "b", stale: true }, { key: "c", stale: false }] }, now);
assert.equal(mostly.state, "carried");
assert.equal(assessSource(def("fed-liquidity"), { entries: [], liquidity: { asOf: "2026-11-04", stale: false } }, now).state, "ok", "path selects the block");
assert.equal(assessSource(def("fed-liquidity"), { entries: [] }, now).state, "missing");
const quarterly = assessSource(def("ai-capex"), { builtAtIso: built, companies: [{ asOf: "2026-09-30" }] }, now);
assert.equal(quarterly.state, "ok", "a quarterly source may be months old");
const weekly = assessSource(def("ram-prices"), { builtAtIso: built, spot: { asOf: "2026-10-20", stale: false }, retail: { asOf: "2026-10-20", stale: false } }, now);
assert.equal(weekly.state, "aged");
// Central bank gold publishes each month about two months late (2026-11-16:
// September data read as "aged" at 47 days).
assert.equal(assessSource(def("central-bank-gold"), { builtAtIso: built, asOf: "2026-09-30", stale: false }, now).state, "ok", "two-month publication lag is not aged");
assert.equal(assessSource(def("central-bank-gold"), { builtAtIso: built, asOf: "2026-08-15", stale: false }, now).state, "aged", "three months old is aged");

// buildSourceHealth: the history upserts by ET day (worst state wins within a
// day), prunes to 60 days and computes streaks and bad days.
const payloads = new Map([["fear-greed.json", { payload: { asOf: "2026-11-09", stale: true } }], ["macro.json", { payload: { asOf: "2026-11-09T20:00:00Z" } }], ["news-feed.json", { error: "invalid" }]]);
const oldDays = Array.from({ length: 70 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString().slice(0, 10), s: { "fear-greed": 2, "macro-levels": 0 } }));
const prior = { v: 1, builtAtIso: "2026-11-08T21:10:00Z", sources: [], days: oldDays.concat([{ date: "2026-11-08", s: { "fear-greed": 2, "macro-levels": 0 } }, { date: "2026-11-09", s: { "macro-levels": 3 } }]) };
const health = buildSourceHealth({ payloads, prior, builtAtIso: built, now });
assert.equal(health.days.length, SOURCE_HEALTH_KEEP_DAYS);
assert.equal(health.days[health.days.length - 1].date, "2026-11-09");
const fg = health.sources.find((r) => r.id === "fear-greed"), mac = health.sources.find((r) => r.id === "macro-levels"), news = health.sources.find((r) => r.id === "news"), ta = health.sources.find((r) => r.id === "treasury-auctions");
assert.equal(fg.state, "carried"); assert.ok(fg.streak >= 3 && fg.review, "a long carry streak asks for review");
assert.equal(mac.state, "ok"); assert.equal(health.days[health.days.length - 1].s["macro-levels"], 3, "the worse state earlier today is kept for the day");
assert.equal(mac.streak, 1, "today still counts as a bad day for macro");
assert.equal(news.state, "unreadable"); assert.equal(news.review, true);
assert.equal(ta.state, "missing"); assert.equal(ta.streak, 1);
assert.equal(health.counts.sources, SOURCES.length);
assert.ok(health.counts.review >= 3);
assert.equal(fg.badDays30, 30);

// Round trip through the files.
const dir = await mkdtemp(join(tmpdir(), "source-health-"));
try {
  await writeFile(join(dir, "fear-greed.json"), JSON.stringify({ asOf: "2026-11-09", stale: false }));
  await writeFile(join(dir, "news-feed.json"), "{not json");
  const read = await readSourcePayloads(dir);
  assert.equal(read.get("fear-greed.json").payload.asOf, "2026-11-09");
  assert.equal(read.get("news-feed.json").error, "invalid");
  assert.equal(read.has("macro.json"), false);
  const info = await writeSourceHealth(dir, health);
  assert.equal(info.sources, SOURCES.length);
  const loaded = await loadSourceHealth(dir);
  assert.equal(loaded.error, null); assert.equal(loaded.state.days.length, SOURCE_HEALTH_KEEP_DAYS);
  assert.equal(parseSourceHealth("{\"v\":99}"), null);
  const stored = JSON.parse(await readFile(join(dir, "source-health.json"), "utf8"));
  assert.ok(stored.sources.every((r) => typeof r.detail === "string" && !/undefined|NaN/.test(r.detail)));
} finally {
  await rm(dir, { recursive: true, force: true });
}

// The Update Checker status response carries the table (and tolerates its absence).
const makeRes = () => { const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } }; return res; };
const store = (health) => ({ async rawGet() { return null; }, async get(key) { return key === "source-health.json" && health ? Buffer.from(JSON.stringify(health)) : null; } });
let res = makeRes();
await handleUpdateChecker({ method: "GET", query: { checker: "status" } }, res, { env: { PRIVATE_DATA_ENABLED: "1" }, getSession: async () => ({ tr: true, tp: true }), store: store(health), now });
assert.equal(res.statusCode, 200);
assert.equal(res.body.sources.sources.length, SOURCES.length);
assert.equal(res.body.sources.sources.find((r) => r.id === "fear-greed").review, true);
res = makeRes();
await handleUpdateChecker({ method: "GET", query: { checker: "status" } }, res, { env: { PRIVATE_DATA_ENABLED: "1" }, getSession: async () => ({ tr: true, tp: true }), store: store(null), now });
assert.equal(res.statusCode, 200); assert.equal(res.body.sources, null);

// Every source names a file the site really writes (2026-11-12: "news.json"
// and "narratives.json" never existed, so both read "missing" every build).
{
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const files = [];
  const walk = async (rel) => { for (const e of await readdir(new URL(rel, root), { withFileTypes: true })) { const r = rel + e.name; if (e.isDirectory()) await walk(r + "/"); else if (/\.mjs$/.test(e.name) && !/source-health|-smoke/.test(e.name)) files.push(r); } };
  await walk("lib/"); await walk("scripts/");
  const writerText = (await Promise.all(files.map((f) => readFile(new URL(f, root), "utf8")))).join("\n");
  for (const d of SOURCES) assert.ok(writerText.includes(d.key) || d.key === "manifest.json", `${d.id}: no writer names ${d.key}`);
  const hm = assessSource(SOURCES.find((d) => d.id === "yahoo-quotes"), { builtAtIso: "2026-11-10T18:30:00Z", eodSummary: { date: "2026-11-09" } }, Date.parse("2026-11-10T18:31:00Z"));
  assert.equal(hm.state, "ok", "the heatmap is as fresh as its last write, not its last closing summary");
  assert.ok(scanPayload({ items: [{ publishedAt: "2026-11-09T12:00:00Z" }] }, Date.parse("2026-11-10T00:00:00Z")).at != null, "publishedAt counts as an observation date");
}

// Dates for the three payloads that had none, and the capital-raises allowance
// (2026-11-22).
{
  const at = Date.parse("2026-11-22T12:00:00Z");
  const def = (id) => SOURCES.find((d) => d.id === id);
  const hist = assessSource(def("historical-sources"), { records: { "^GSPC": { confirmedThrough: "2026-11-02", checkedAt: "2026-11-22T10:00:00Z" }, SPY: { confirmedThrough: "2026-11-03" } } }, at);
  assert.equal(hist.state, "aged", "long history dated by its newest confirmed session");
  assert.equal(assessSource(def("historical-sources"), { records: { SPY: { confirmedThrough: "2026-11-20" } } }, at).state, "ok");
  assert.equal(assessSource(def("pending-buyouts"), { builtAtIso: "2026-11-22T11:00:00Z", asOf: "2026-11-10T21:00:00Z", deals: [] }, at).state, "aged", "buyouts dated by the last confirmed-table read");
  assert.equal(assessSource(def("accelerator-prices"), { builtAtIso: "2026-11-22T11:00:00Z", sources: [{ id: "vast", ok: true, stale: false, asOf: "2026-10-30" }] }, at).state, "aged", "GPU prices dated by each provider's newest good read");
  assert.equal(assessSource(def("capital-raises"), { items: [{ publishedAt: "2026-11-12T12:00:00Z" }] }, at).state, "ok", "ten quiet days is normal for capital raises");
  assert.equal(assessSource(def("capital-raises"), { items: [{ publishedAt: "2026-11-02T12:00:00Z" }] }, at).state, "aged");
  assert.equal(SOURCES.some((d) => d.id === "crowd-lev-flows"), false, "leveraged ETF flows are off and out of the list");
}

// GDELT news (2026-11-24): a run that read 4 of 64 stocks said "ok" because
// the attempt time counted as an observation and one read cleared `stale`.
{
  const g = (extra) => ({ gdelt: { date: "2026-11-09", done: ["A", "B"], lastOkDate: "2026-11-09", stale: false, days: { A: [{ d: "2026-11-09", vol24: 3 }] }, health: { ranAt: "2026-11-09T18:31:00Z", calls: 31, read: 2 }, ...extra } });
  const low = assessSource(def("gdelt-news"), g({ coverage: { checkedOn: "2026-11-09", fresh: 4, withRatio: 2, of: 64, status: "low" } }), now);
  assert.equal(low.state, "partial", "under half the stocks read is partial");
  assert.match(low.detail, /4 of 64/);
  assert.equal(assessSource(def("gdelt-news"), g({ coverage: { fresh: 60, of: 64, status: "ok" } }), now).state, "ok", "a full read is ok");
  const old = assessSource(def("gdelt-news"), g({ lastOkDate: "2026-11-02", health: { ranAt: "2026-11-09T18:31:00Z", calls: 31, read: 0 }, coverage: { fresh: 40, of: 64, status: "ok" } }), now);
  assert.equal(old.state, "aged", "the last good read dates the block, not the attempt");
}

// Generic value checks (2026-11-26): every number zero, a field that went to
// zero in every row, every number the same as an earlier session, and a main
// list that shrank to under half its usual size. Only an ok row changes.
{
  const { numericProfile, listCount, applyValueChecks } = await import("../lib/source-health.mjs");
  const d = (id) => SOURCES.find((x) => x.id === id);
  const okRow = (id) => ({ id, state: "ok", detail: "Fresh observation, nothing carried." });
  const rows = (k, vals) => vals.map((v, i) => ({ sym: `S${i}`, [k]: v, price: 10 + i, asOf: "2026-11-09" }));
  // Timestamps and versions are not values.
  const p0 = numericProfile({ builtAtMs: 1, version: 3, items: [{ fetchedAtMs: 5, v: 1 }] });
  assert.equal(p0.count, 0);
  // All zero.
  const zero = numericProfile({ a: 0, b: { c: 0, d: [0, 0, 0, 0] } });
  assert.equal(applyValueChecks(okRow("fear-greed"), d("fear-greed"), { profile: zero, today: "2026-11-09" }).state, "partial");
  // A field with values last build that is zero in every row now.
  const before = numericProfile({ funds: rows("flowUsd", [5, 0, 3, 9, 1, 2]) });
  assert.ok(before.live.includes("flowUsd"));
  const after = numericProfile({ funds: rows("flowUsd", [0, 0, 0, 0, 0, 0]) });
  // The first all-zero build only notes it (one quiet snapshot is not a
  // broken feed); the second in a row reads partial.
  const first = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: after, priorRow: { fp: before.hash, fpSince: "2026-11-06", live: before.live }, today: "2026-11-09" });
  assert.equal(first.state, "ok"); assert.equal(first.zeroSince.flowUsd, "2026-11-09"); assert.ok(first.live.includes("flowUsd"));
  const back = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: before, priorRow: first, today: "2026-11-09" });
  assert.equal(back.state, "ok"); assert.equal(back.zeroSince, undefined, "values came back");
  const zeroed = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: after, priorRow: first, today: "2026-11-09" });
  assert.equal(zeroed.state, "partial"); assert.match(zeroed.detail, /flowUsd is zero in every row since 2026-11-09/);
  // It keeps reading partial on later days (so three days alert), until it
  // has been zero for a week.
  const day2 = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: after, priorRow: zeroed, today: "2026-11-10" });
  assert.equal(day2.state, "partial"); assert.equal(day2.zeroSince.flowUsd, "2026-11-09");
  // A by-name map counts as rows.
  assert.ok(numericProfile({ funds: { A: { flow: 1 }, B: { flow: 2 }, C: { flow: 0 }, D: { flow: 3 }, E: { flow: 4 } } }).live.includes("flow"));
  const after2 = numericProfile({ funds: rows("flowUsd", [0, 0, 0, 0, 0, 0]).map((r) => ({ ...r, price: r.price + 1 })) });
  const week = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: after2, priorRow: day2, today: "2026-11-17" });
  assert.equal(week.state, "ok"); assert.equal(week.live.includes("flowUsd"), false);
  // A field that was always zero is not flagged.
  const always = applyValueChecks(okRow("crowd-short-volume"), d("crowd-short-volume"), { profile: after, priorRow: { fp: after.hash, fpSince: "2026-11-09", live: after.live }, today: "2026-11-09" });
  assert.equal(always.state, "ok");
  // Same numbers as an earlier session: flagged for a daily source, not a
  // weekly one, not a steady one, not within the same day.
  const vals = numericProfile({ items: rows("x", [1, 2, 3, 4, 5, 6, 7, 8]) });
  const same = { fp: vals.hash, fpSince: "2026-11-06", live: vals.live };
  const frozen = applyValueChecks(okRow("fear-greed"), d("fear-greed"), { profile: vals, priorRow: same, today: "2026-11-09" });
  assert.equal(frozen.state, "partial"); assert.match(frozen.detail, /same as on 2026-11-06/); assert.equal(frozen.fpSince, "2026-11-06");
  assert.equal(applyValueChecks(okRow("ram-prices"), d("ram-prices"), { profile: vals, priorRow: same, today: "2026-11-09" }).state, "ok", "weekly source");
  assert.equal(applyValueChecks(okRow("treasury-auctions"), d("treasury-auctions"), { profile: vals, priorRow: same, today: "2026-11-09" }).state, "ok", "steady source");
  assert.equal(applyValueChecks(okRow("fear-greed"), d("fear-greed"), { profile: vals, priorRow: { ...same, fpSince: "2026-11-09" }, today: "2026-11-09" }).state, "ok", "same day");
  const changed = applyValueChecks(okRow("fear-greed"), d("fear-greed"), { profile: numericProfile({ items: rows("x", [1, 2, 3, 4, 5, 6, 7, 9]) }), priorRow: same, today: "2026-11-09" });
  assert.equal(changed.state, "ok"); assert.equal(changed.fpSince, "2026-11-09");
  // A worse state is never replaced.
  assert.equal(applyValueChecks({ ...okRow("fear-greed"), state: "aged" }, d("fear-greed"), { profile: zero, today: "2026-11-09" }).state, "aged");
  // Main list size: an array, the biggest top-level list, a by-name map, a
  // named count.
  assert.equal(listCount([1, 2, 3]), 3);
  assert.equal(listCount({ a: [1, 2], b: [1, 2, 3, 4] }), 4);
  assert.equal(listCount({ markets: { A: { x: 1 }, B: { x: 2 }, C: { x: 3 } } }), 3);
  assert.equal(listCount({ count: 503, sources: [1, 2] }, { countKey: "count" }), 503);
  assert.equal(applyValueChecks(okRow("yahoo-global"), d("yahoo-global"), { profile: vals, count: 4, priorRow: { n: 30 }, priorCounts: [30, 31, 30, 29, 30], today: "2026-11-09" }).state, "ok", "one short build is not flagged");
  const shrunk = applyValueChecks(okRow("yahoo-global"), d("yahoo-global"), { profile: vals, count: 4, priorRow: { n: 5 }, priorCounts: [30, 31, 30, 29, 30], today: "2026-11-09" });
  assert.equal(shrunk.state, "partial"); assert.match(shrunk.detail, /Covered 4 items; usually about 30/);
  assert.equal(applyValueChecks(okRow("yahoo-global"), d("yahoo-global"), { profile: vals, count: 20, priorCounts: [30, 31, 30], today: "2026-11-09" }).state, "ok");
  assert.equal(applyValueChecks(okRow("unusual-flow"), d("unusual-flow"), { profile: vals, count: 2, priorCounts: [40, 40, 40], today: "2026-11-09" }).state, "ok", "an event list may shrink on a quiet day");
  // buildSourceHealth keeps the list sizes by day and the fingerprint on the row.
  const p1 = new Map([["fear-greed.json", { payload: { asOf: "2026-11-09", items: rows("score", [1, 2, 3, 4, 5, 6, 7, 8]) } }]]);
  const h1 = buildSourceHealth({ payloads: p1, builtAtIso: "2026-11-06T21:10:00Z", now: Date.parse("2026-11-06T21:15:00Z") });
  const fg1 = h1.sources.find((r) => r.id === "fear-greed");
  assert.equal(h1.days.at(-1).n["fear-greed"], 8); assert.ok(fg1.fp); assert.equal(fg1.fpSince, "2026-11-06");
  const p2 = new Map([["fear-greed.json", { payload: { asOf: "2026-11-09", items: rows("score", [1, 2, 3, 4, 5, 6, 7, 8]) } }]]);
  const h2 = buildSourceHealth({ payloads: p2, prior: h1, builtAtIso: "2026-11-09T21:10:00Z", now });
  assert.equal(h2.sources.find((r) => r.id === "fear-greed").state, "partial", "same numbers as the last session");
  // Engine feed fails are kept by day for the alert's three-day rule.
  const feeds = { feeds: [{ id: "news", label: "News volume and tone", provider: "GDELT Project", state: "fail" }, { id: "vix", label: "VIX", provider: "Cboe", state: "ok" }] };
  const h3 = buildSourceHealth({ payloads: new Map(), prior: h2, builtAtIso: "2026-11-10T21:10:00Z", now: Date.parse("2026-11-10T21:15:00Z"), feedChecks: feeds });
  assert.deepEqual(h3.days.at(-1).f, { news: 1, vix: 0 });
}

// New provider rows (2026-11-26): Nasdaq sessions, ForexFactory, Google News
// RSS (a count the bake passes in) and the index member lists.
{
  const d = (id) => SOURCES.find((x) => x.id === id);
  const cal = (nasdaq, rs = { forexFactory: "ok" }) => ({ builtAtIso: built, coverage: { nasdaq, reportSources: rs } });
  assert.equal(assessSource(d("nasdaq-sessions"), cal({ status: "ok", requested: 20, succeeded: 20, failedDates: [] }), now).state, "ok");
  assert.equal(assessSource(d("nasdaq-sessions"), cal({ status: "partial", requested: 20, succeeded: 4, failedDates: [] }), now).state, "partial");
  assert.equal(assessSource(d("nasdaq-sessions"), cal({ status: "unavailable", requested: 20, succeeded: 0 }), now).state, "partial");
  assert.equal(assessSource(d("forex-factory"), cal({}, { forexFactory: "ok" }), now).state, "ok");
  assert.equal(assessSource(d("forex-factory"), cal({}, { forexFactory: "unavailable" }), now).state, "partial");
  assert.equal(assessSource(d("google-news"), { coverage: { fresh: 70, of: 72, status: "ok" } }, now).state, "ok");
  assert.equal(assessSource(d("google-news"), { coverage: { fresh: 3, of: 72, status: "low" } }, now).state, "partial");
  assert.equal(assessSource(d("google-news"), { note: "not read this run" }, now).state, "ok");
  const members = (extra) => ({ builtAtIso: built, members: { asOf: "2026-10-28", sources: [{ id: "sp500", count: 503 }], count: 517, ...extra } });
  assert.equal(assessSource(d("index-members"), members({}), now).state, "ok", "lists re-read monthly");
  assert.equal(assessSource(d("index-members"), members({ lastError: "HTTP 500" }), now).state, "partial");
  assert.equal(assessSource(d("index-members"), members({ asOf: "2026-08-01" }), now).state, "aged");
  const buildSrc = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
  assert.match(buildSrc, /sourcePayloads\.set\("google-news-rss\.synthetic", \{ payload: googleNewsSourcePayload\(\) \}\)/);
  assert.match(buildSrc, /GOOGLE_NEWS_READS\.asked\+\+;/);
}

// Data-health alert (lib/data-health-alert.mjs): opens only after three bad
// build days running, lists names, states and day counts only.
{
  const { buildDataHealthAlert } = await import("../lib/data-health-alert.mjs");
  const h = {
    builtAtIso: built,
    sources: [
      { id: "a", label: "Fear & Greed", provider: "CNN", state: "aged", streak: 3, detail: "secret NVDA detail" },
      { id: "b", label: "Option chains", provider: "Yahoo", state: "partial", streak: 2, detail: "x" },
      { id: "c", label: "Missing one", provider: "X", state: "missing", streak: 1 },
      { id: "d", label: "Fine", provider: "Y", state: "ok", streak: 0 },
    ],
    engineFeeds: { feeds: [{ id: "news", label: "News volume and tone", provider: "GDELT Project", state: "fail", detail: "4 of 64 NVDA" }, { id: "vix", label: "VIX", provider: "Cboe", state: "fail" }] },
    days: [{ date: "2026-11-05", s: {}, f: { news: 1, vix: 0 } }, { date: "2026-11-06", s: {}, f: { news: 1, vix: 1 } }, { date: "2026-11-09", s: {}, f: { news: 1, vix: 1 } }],
  };
  const a = buildDataHealthAlert(h);
  assert.equal(a.status, "alert");
  assert.deepEqual(a.sources.map((r) => r.id), ["a"], "two bad days or a first missing day do not alert");
  assert.deepEqual(a.feeds.map((f) => f.id), ["news"]);
  assert.match(a.title, /2 bad 3\+ build days/);
  assert.doesNotMatch(a.md + a.title + JSON.stringify(a), /NVDA|secret|4 of 64/, "no detail strings or tickers in the public issue");
  assert.match(a.md, /\| Fear & Greed \| CNN \| aged \| 3 \|/);
  const ok = buildDataHealthAlert({ ...h, sources: h.sources.filter((r) => r.streak < 3), engineFeeds: { feeds: [] } });
  assert.equal(ok.status, "ok");
  assert.equal(buildDataHealthAlert(null).status, "unknown");
  const wf = await readFile(new URL("../.github/workflows/daily.yml", import.meta.url), "utf8");
  const step = wf.slice(wf.indexOf("- name: Data health alert"), wf.indexOf("- name: Prepare final static output"));
  assert.match(step, /if: \$\{\{ always\(\) \}\}/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /--label data-health/);
  assert.match(step, /gh issue close/);
  assert.doesNotMatch(step, /git push|git commit|sync-data/, "the alert step writes and pushes nothing");
}

console.log("source-health-smoke: ok");

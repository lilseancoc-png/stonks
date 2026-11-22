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

console.log("source-health-smoke: ok");

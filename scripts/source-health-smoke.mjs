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

// assessSource states.
assert.equal(assessSource(def("fear-greed"), null, now).state, "missing");
assert.equal(assessSource(def("fear-greed"), null, now, "invalid").state, "unreadable");
assert.equal(assessSource(def("fear-greed"), { asOf: "2026-11-09", score: 40, stale: false }, now).state, "ok");
assert.equal(assessSource(def("fear-greed"), { asOf: "2026-11-02", score: 40, stale: true }, now).state, "carried");
const aged = assessSource(def("fear-greed"), { asOf: "2026-11-01", score: 40 }, now);
assert.equal(aged.state, "aged"); assert.match(aged.detail, /8 days old/);
assert.equal(assessSource(def("f13"), { builtAtIso: built, period: "Q3 2026", perFirm: {} }, now).state, "ok", "undated payload written this run reads ok");
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

// buildSourceHealth: the history upserts by ET day (worst state wins within a
// day), prunes to 60 days and computes streaks and bad days.
const payloads = new Map([["fear-greed.json", { payload: { asOf: "2026-11-09", stale: true } }], ["macro.json", { payload: { asOf: "2026-11-09T20:00:00Z" } }], ["news.json", { error: "invalid" }]]);
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
  await writeFile(join(dir, "news.json"), "{not json");
  const read = await readSourcePayloads(dir);
  assert.equal(read.get("fear-greed.json").payload.asOf, "2026-11-09");
  assert.equal(read.get("news.json").error, "invalid");
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

console.log("source-health-smoke: ok");

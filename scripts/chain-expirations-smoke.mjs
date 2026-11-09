// Settled same-day expirations stay out of the baked chain and the browser
// gamma read (QC of builds #473-#522). Yahoo keeps today's expiration listed
// after the 16:00 ET close; the 16:10 ET bake used to ship that dead chain.
// Pure; no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { liveExpirationDates } from "./build.mjs";
import { computeGexSummary } from "../lib/gex.mjs";

const day = (iso) => new Date(`${iso}T00:00:00Z`);
const listed = [day("2026-11-06"), day("2026-11-09"), day("2026-11-13")];
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// Friday 2026-11-06: 15:59 ET keeps today's expiration, 16:10 ET drops it.
assert.deepEqual(liveExpirationDates(listed, sec("2026-11-06T20:59:00Z")).map((d) => d.toISOString().slice(0, 10)),
  ["2026-11-06", "2026-11-09", "2026-11-13"], "before the close today's expiration is live");
assert.deepEqual(liveExpirationDates(listed, sec("2026-11-06T21:10:00Z")).map((d) => d.toISOString().slice(0, 10)),
  ["2026-11-09", "2026-11-13"], "after the 16:00 ET close today's expiration is dropped");
// Daylight time: the close is 20:00Z.
assert.deepEqual(liveExpirationDates([day("2026-07-10"), day("2026-07-17")], sec("2026-07-10T20:05:00Z")).map((d) => d.toISOString().slice(0, 10)),
  ["2026-07-17"], "under daylight time the close is 20:00Z");
assert.deepEqual(liveExpirationDates([null, "x", day("2026-11-13")], sec("2026-11-06T21:10:00Z")).length, 1, "bad rows are skipped");
assert.deepEqual(liveExpirationDates(undefined), []);

// Server GEX already drops a settled expiration; the browser copy must use the
// same close-time test, not a rounded day count.
const row = (s, oi) => ({ s, b: 1, a: 1.1, l: 1, iv: 0.3, oi, v: 0 });
const chains = {
  [sec("2026-11-06T00:00:00Z")]: { c: [row(100, 900000)], p: [] },
  [sec("2026-11-13T00:00:00Z")]: { c: [row(110, 10)], p: [row(90, 10)] },
};
const after = computeGexSummary(chains, 100, { now: Date.parse("2026-11-06T21:10:00Z") });
assert.notEqual(after.callWall?.strike, 100, "the settled 0DTE strike is not a wall after the close");

const appJs = await readFile(new URL("./render/app-js.mjs", import.meta.url), "utf8");
const gexStart = appJs.indexOf("function computeGex(entry, spot)");
assert.ok(gexStart > 0, "browser computeGex exists");
const gexBody = appJs.slice(gexStart, gexStart + 1500);
assert.match(gexBody, /closeMs <= now\) continue;/, "browser GEX drops an expiration at its close, like lib/gex.mjs");
assert.doesNotMatch(gexBody, /if \(dte < 0\) continue;/, "the rounded-day test is gone");

const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
assert.match(build, /const expirations = liveExpirationDates\(allExp\)\.slice\(0, MAX_EXPIRATIONS\);/,
  "the bake slices MAX_EXPIRATIONS from live expirations only");

console.log("chain-expirations smoke ok");

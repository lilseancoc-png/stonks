// Offline checks for the measured intraday volume curve and the
// session-so-far volume read (2026-11-17 Price signals audit).
//   node scripts/volume-curve-smoke.mjs

import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BUCKETS,
  MEASURED_CURVE_SEED,
  CURVE_MIN_DAYS,
  CURVE_SLOTS,
  cumFracExpected,
  cumFracFromKnots,
  curveFromDays,
  evaluateTicker,
  learnCurveDay,
  volumeReadVersion,
  volumeSwitches,
} from "../lib/volume-flags.mjs";
import { hourlyVolumeRead } from "./build.mjs";
import { renderHtml } from "./render/html.mjs";
import { renderAppJs } from "./render/app-js.mjs";

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };
const near = (a, b, m, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

// --- the fixed curve stays the fallback ----------------------------------
near(cumFracExpected(30), 0.125, "fixed curve: 12.5% by 10:00");
near(cumFracExpected(60), 0.25, "fixed curve: 25% by 10:30");
near(cumFracExpected(390), 1, "fixed curve: whole day at the close");
eq(BUCKETS.reduce((t, b) => t + b.frac, 0).toFixed(6), "1.000000", "fixed buckets add to one");

// --- the measured seed -----------------------------------------------------
const seed = MEASURED_CURVE_SEED.map((k) => [...k]);
near(cumFracExpected(30, seed), 0.16, "seed: 16% by 10:00");
near(cumFracExpected(60, seed), 0.24, "seed: straight line between knots");
near(cumFracExpected(0, seed), 0, "seed: nothing before the open");
near(cumFracExpected(400, seed), 1, "seed: whole day after the close");
near(cumFracExpected(30, [[0, 0], [30, 0.5]]), 0.125, "a curve that does not end at the close falls back");
near(cumFracExpected(30, [[0, 0], [30, 0.4], [90, 0.3], [390, 1]]), 0.125, "a falling curve falls back");
near(cumFracExpected(30, "junk"), 0.125, "junk falls back");
for (let m = 0; m < 390; m += 5) ok(cumFracFromKnots(m + 5, seed) >= cumFracFromKnots(m, seed), `seed never falls (${m})`);
// The point of the change: at 10:00 a normal stock no longer reads 1.33x.
near(0.167 / cumFracExpected(30, seed), 1.04, "a median stock reads about 1.0x at 10:00 on the seed", 0.01);
ok(0.167 / cumFracExpected(30) > 1.3, "the fixed curve read the same stock 1.33x");

// --- switches and the trade stamp ------------------------------------------
eq(volumeSwitches({}), { measuredCurve: true, sessionRead: true }, "both on by default");
eq(volumeSwitches({ VOLUME_MEASURED_CURVE: " 0 ", VOLUME_SESSION_READ: "1" }), { measuredCurve: false, sessionRead: true }, "0 turns one off");
eq(volumeReadVersion({}), "2026-11-17", "stamp with both on");
eq(volumeReadVersion({ VOLUME_SESSION_READ: "0" }), "2026-11-17-curve", "stamp: curve only");
eq(volumeReadVersion({ VOLUME_MEASURED_CURVE: "0" }), "2026-11-17-read", "stamp: session read only");
eq(volumeReadVersion({ VOLUME_MEASURED_CURVE: "0", VOLUME_SESSION_READ: "0" }), "", "no stamp with both off");

// --- learning one finished session -----------------------------------------
const date = "2026-11-10"; // a full day
const names = Array.from({ length: 30 }, (_, i) => `S${i}`);
const dayVol = Object.fromEntries(names.map((s, i) => [s, 1_000_000 + i * 10_000]));
const truth = [[30, 0.18], [90, 0.34], [150, 0.46], [210, 0.56], [270, 0.66], [330, 0.76], [390, 0.95]];
const snaps = [{ etDate: date, etMin: -30, tickers: names.map((s) => ({ symbol: s, cumVol: 0 })) }];
for (const [m, f] of truth) snaps.push({ etDate: date, etMin: m, tickers: names.map((s) => ({ symbol: s, cumVol: Math.round(dayVol[s] * f) })) });
const learned = learnCurveDay(snaps, date, (s) => dayVol[s]);
ok(learned && learned.names === 30, "a full day with 30 names learns");
eq(learned.pts.map((p) => p[0]), [30, 90, 150, 210, 270, 330], "points only at in-session scans");
near(learned.pts[0][1], 0.18, "share of the day at 10:00", 1e-3);
// A daily bar still trading when the bake ran (smaller than what the scanner
// already saw) is left out rather than read as a huge share.
const shortBar = { ...dayVol, S0: 100, S1: 100 };
const learned2 = learnCurveDay(snaps, date, (s) => shortBar[s]);
eq(learned2.names, 28, "names with a short daily bar are left out");
eq(learnCurveDay(snaps, date, (s) => (s < "S2" ? dayVol[s] : null)), null, "fewer than 20 names gives no point");
eq(learnCurveDay(snaps.map((s) => ({ ...s, etDate: "2026-11-27" })), "2026-11-27", (s) => dayVol[s]), null, "a half day is skipped");

// --- the curve in use -------------------------------------------------------
const few = Array.from({ length: CURVE_MIN_DAYS - 1 }, (_, i) => ({ date: `d${i}`, pts: [[30, 0.2]] }));
eq(curveFromDays(few).knots, seed, "under five days a knot keeps the seed");
eq(curveFromDays(few).learnedSlots, 0, "no knot learned yet");
const enough = Array.from({ length: CURVE_MIN_DAYS }, (_, i) => ({ date: `d${i}`, pts: [[30, 0.2 + i * 0.01], [92, 0.33]] }));
const fitted = curveFromDays(enough);
near(fitted.knots[1][1], 0.22, "10:00 knot is the median of five days");
// A 92-minute reading counts for the 90-minute knot, moved along the seed.
near(fitted.knots[2][1], 0.33 - (cumFracFromKnots(92, seed) - cumFracFromKnots(90, seed)), "nearby scan shifted to the knot", 1e-4);
eq(fitted.learnedSlots, 2, "two knots learned");
const wild = Array.from({ length: CURVE_MIN_DAYS }, (_, i) => ({ date: `w${i}`, pts: [[30, 0.6], [90, 0.2]] }));
const tamed = curveFromDays(wild).knots;
for (let i = 1; i < tamed.length; i++) ok(tamed[i][1] > tamed[i - 1][1], `fitted curve keeps rising (${tamed[i][0]})`);
ok(cumFracExpected(30, tamed) > 0, "a tamed curve is still valid");
eq(CURVE_SLOTS.every((m) => seed.some((k) => k[0] === m)), true, "every scan slot has a seed knot");

// --- evaluateTicker's session read -----------------------------------------
// 10:20 ET on a full day: 50 minutes in.
const at = (h, m) => new Date(Date.UTC(2026, 10, 10, h + 5, m));
const base = { spot: 101, prevClose: 100, avg20: 1_000_000, sr: null, prev: null, bucketStartCumVol: 0, bucketStartEtMin: 0 };
const e1 = evaluateTicker({ ...base, now: at(10, 20), cumVol: 200_000, curve: seed });
const exp50 = 1_000_000 * cumFracExpected(50, seed);
eq(e1.session.expected, Math.round(exp50), "session read: expected volume by now on the curve");
near(e1.session.ratio, Math.round((200_000 / exp50) * 100) / 100, "session read: ratio");
near(e1.session.movePct, 1, "session read: move from yesterday's close");
const e0 = evaluateTicker({ ...base, now: at(9, 45), cumVol: 50_000, curve: seed });
eq(e0.session, null, "no session read in the first 20 minutes");
const eFixed = evaluateTicker({ ...base, now: at(10, 20), cumVol: 200_000 });
ok(eFixed.session.ratio > e1.session.ratio, "the fixed curve reads the same morning heavier");

// --- the grade's read --------------------------------------------------------
const flags = {
  etDate: "2026-11-10",
  tickers: [{ symbol: "AAA", bucketHits: [{ volRatio: 2.4, priceMovePct: 1.2, bucketLabel: "9:30-10:30" }, { volRatio: 0.8, priceMovePct: 0.2 }] }],
  session: { etMin: 330, reads: { AAA: { r: 1.1, m: 0.9, t: 330 } } },
};
eq(hourlyVolumeRead("AAA", flags, true).volRatio, 1.1, "session read is used when on");
eq(hourlyVolumeRead("AAA", flags, true).basis, "session", "and says so");
eq(hourlyVolumeRead("BBB", flags, true), null, "a name with no session read gets the daily fallback");
eq(hourlyVolumeRead("AAA", flags, false).volRatio, 2.4, "switch off: the busiest window");
const oldFile = { ...flags }; delete oldFile.session;
eq(hourlyVolumeRead("AAA", oldFile, true).volRatio, 2.4, "a file from before the change reads the old way");

// --- page shell and the browser's live relative volume ----------------------
const temp = await mkdtemp(resolve(tmpdir(), "stonks-volcurve-"));
try {
  const dataDir = resolve(temp, "data");
  await mkdir(dataDir);
  const manifestOf = (volumeFlags) => {
    const html = renderHtml({ symbols: [], builtAt: "test", builtAtIso: "2026-11-17T15:00:00.000Z", dataDir, volumeFlags });
    const m = html.match(/window\.STONKS_MANIFEST=(\{.*?\});<\/script>/s);
    return JSON.parse(m[1]);
  };
  const measuredFlags = { scannedAt: "2026-11-17T15:00:00.000Z", etDate: "2026-11-17", curve: { mode: "measured", knots: seed } };
  eq(manifestOf(measuredFlags).volumeFlagsMeta.curveKnots, seed, "the shell carries the measured knots");
  eq(manifestOf({ ...measuredFlags, curve: { mode: "fixed", knots: seed } }).volumeFlagsMeta.curveKnots, null, "fixed mode carries none");
  eq(manifestOf({ ...measuredFlags, curveKnots: null }).volumeFlagsMeta.curveKnots, null, "a newer meta's null wins over an older payload's curve");

  const app = renderAppJs({});
  const start = app.indexOf("function execCurveKnots(){");
  const end = app.indexOf("function execEtMinutesSinceOpen(");
  ok(start > 0 && end > start, "the browser curve functions are in app.js");
  const run = (knots) => {
    const ctx = { MANIFEST: { volumeFlagsMeta: { curveKnots: knots } } };
    vm.runInNewContext(app.slice(start, end) + "\nthis.f = execCumFracExpected;", ctx);
    return ctx.f;
  };
  const browserSeed = run(seed);
  for (const m of [5, 30, 61, 150, 300, 389]) near(browserSeed(m), cumFracExpected(m, seed), `browser matches the scanner at ${m} min`);
  const browserFixed = run(null);
  for (const m of [5, 30, 61, 150, 300, 389]) near(browserFixed(m), cumFracExpected(m), `browser fallback matches the fixed curve at ${m} min`);
  near(run([[0, 0], [30, 0.5]])(30), cumFracExpected(30), "browser rejects a bad curve too");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log(`volume-curve-smoke: ${checks} checks passed`);

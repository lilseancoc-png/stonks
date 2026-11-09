#!/usr/bin/env node
// Offline checks for the walk-forward replay (lib/walk-forward.mjs) on
// synthetic archive runs and outcomes with a known structure.
import assert from "node:assert/strict";
import { ranks, spearman, ridgeFit, joinSamples, walkForward, formatReport } from "../lib/walk-forward.mjs";
import { OUTCOME_KEYS } from "../lib/picks-outcomes.mjs";

assert.deepEqual(ranks([10, 30, 20, 20]), [1, 4, 2.5, 2.5]);
assert.equal(Math.round(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) * 1000) / 1000, 1);
assert.equal(Math.round(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) * 1000) / 1000, -1);
assert.equal(spearman([1, 1, 1], [1, 2, 3]), null, "no variance → null");
const fit = ridgeFit([[1, 0], [2, 0], [3, 1], [4, 1], [5, 0], [6, 1]], [2.1, 4.0, 6.2, 7.9, 10.1, 12.0], 0.001);
assert.ok(Math.abs(fit.w[0] - 2) < 0.05 && Math.abs(fit.intercept) < 0.3, "ridge recovers the slope");

// Synthetic archive: 60 run days, 60 names, only the fundamentals pillar carries
// direction; the fixed total (equal weights) dilutes it.
let seed = 11;
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const I = Object.fromEntries(OUTCOME_KEYS.map((k, i) => [k, i]));
const names = Array.from({ length: 60 }, (_, i) => "S" + String(i).padStart(2, "0"));
function synth({ signalKey, noise }) {
  const dayFiles = [], rows = [];
  for (let d = 0; d < 60; d++) {
    const date = new Date(Date.UTC(2026, 0, 5) + d * 86400000).toISOString().slice(0, 10);
    const run = { builtAtIso: date + "T16:04:00Z", et: "11:00", rows: [] };
    for (const s of names) {
      const p = { f: gauss() * 2, t: gauss() * 2, m: gauss(), n: gauss(), iv: gauss() * 0.5 };
      const tot = p.f + p.t + p.m + p.n + p.iv;
      const y = (signalKey ? 1.5 * p[signalKey] : 0) + noise * gauss();
      run.rows.push({ s, tot: Math.round(tot * 100) / 100, side: tot < 0 ? "put" : "call", spot: 100, out: "below-bar", pillars: p });
      const row = OUTCOME_KEYS.map(() => null);
      row[I.d] = date; row[I.et] = "11:00"; row[I.s] = s; row[I.side] = tot < 0 ? "put" : "call"; row[I.tot] = tot; row[I.r10] = Math.round(y * 100) / 100; row[I.r5] = null;
      rows.push(row);
    }
    dayFiles.push({ v: 1, date, runs: [run] });
  }
  return { dayFiles, outcomes: { v: 1, keys: OUTCOME_KEYS.slice(), rows } };
}

const strong = synth({ signalKey: "f", noise: 1.5 });
const samples = joinSamples(strong.dayFiles, strong.outcomes, { horizon: "r10" });
assert.equal(samples.length, 60 * 60, "every archived row with a 10-day outcome joins");
assert.equal(joinSamples(strong.dayFiles, strong.outcomes, { horizon: "r5" }).length, 0, "an unfilled horizon yields no samples");
assert.throws(() => joinSamples([], {}, { horizon: "r99" }), /unknown horizon/);
const res = walkForward(samples, { trainDays: 20, testDays: 5 });
assert.deepEqual(res.features, ["f", "t", "m", "n", "iv"]);
assert.equal(res.runDays, 60);
assert.equal(res.windows.length, 8, "(60 - 20) / 5 windows");
for (const w of res.windows) {
  assert.ok(Math.abs(w.weights.f) > Math.abs(w.weights.t) && Math.abs(w.weights.f) > Math.abs(w.weights.m), "the informative pillar gets the largest weight");
  assert.equal(w.nTrain, 20 * 60); assert.equal(w.nTest, 5 * 60);
}
assert.equal(res.summary.verdict, "fitted-better");
assert.ok(res.summary.fittedOosIc > res.summary.fixedOosIc + 0.1, `refit ${res.summary.fittedOosIc} should beat fixed ${res.summary.fixedOosIc} clearly`);
assert.ok(res.summary.shrinkage != null && res.summary.shrinkage < 0.1, "little shrinkage when the signal is real");
const text = formatReport(res);
assert.ok(/Verdict: fitted-better/.test(text) && !/undefined|NaN/.test(text));

// Pure noise: nothing reads direction; no verdict in favour of refitting.
const noise = synth({ signalKey: null, noise: 2 });
const nres = walkForward(joinSamples(noise.dayFiles, noise.outcomes), { trainDays: 20, testDays: 5 });
assert.notEqual(nres.summary.verdict, "fitted-better");
assert.ok(Math.abs(nres.summary.fixedOosIc) < 0.08 && Math.abs(nres.summary.fittedOosIc) < 0.08, "ICs near zero on noise");
assert.match(nres.summary.note, /Neither reads direction|within 0.03|fixed scale beats/);

// Too little history: insufficient, no crash.
const short = walkForward(samples.filter((s) => s.date < "2026-01-30"), { trainDays: 20, testDays: 5 });
assert.equal(short.summary.verdict, "insufficient");
assert.equal(walkForward([], {}).summary.verdict, "insufficient");

console.log("walk-forward-smoke: ok");

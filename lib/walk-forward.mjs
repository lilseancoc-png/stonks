// Walk-forward replay of the grade on archived runs (2026-11-08).
//
// The run archive (lib/picks-run-archive.mjs) keeps every pillar score the
// engine gave every name at each decision run, and the outcomes file
// (lib/picks-outcomes.mjs) keeps what each name did 1, 5, 10 and 20 sessions
// later. This module joins the two and asks one question honestly: would a
// different weighting of the same pillars have called direction better OUT
// OF SAMPLE than the fixed scale the engine uses? It walks forward in time:
// fit pillar weights on a window of past run days, score the next few days
// with those weights, compare the rank correlation (Spearman IC) with the
// forward move against the fixed total's IC on the same days, then slide.
// In-sample IC is reported next to out-of-sample so the shrinkage is visible.
//
// Research harness only: nothing here changes a grade, a weight or a pick.
// Pure, no network, no AI; scripts/walk-forward.mjs is the command line.

import { OUTCOME_KEYS } from "./picks-outcomes.mjs";

export const WALK_FORWARD_VERSION = 1;
export const PILLAR_KEYS = Object.freeze(["f", "t", "m", "n", "iv", "rg"]);
export const DEFAULTS = Object.freeze({ horizon: "r10", trainDays: 20, testDays: 5, minRowsPerDay: 10, ridge: 1 });
const I = Object.fromEntries(OUTCOME_KEYS.map((k, i) => [k, i]));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

// Average ranks with ties shared.
export function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rx = ranks(xs.slice(0, n)), ry = ranks(ys.slice(0, n));
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (!(sxx > 0) || !(syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Ridge regression with an intercept: minimise |y - Xw - b|^2 + ridge*|w|^2.
export function ridgeFit(X, y, ridge = 1) {
  const n = X.length;
  if (!n) return null;
  const p = X[0].length;
  const mean = new Array(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) mean[j] += row[j] / n;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xc = X[i].map((v, j) => v - mean[j]);
    for (let j = 0; j < p; j++) {
      b[j] += xc[j] * (y[i] - ym);
      for (let k = 0; k < p; k++) A[j][k] += xc[j] * xc[k];
    }
  }
  for (let j = 0; j < p; j++) A[j][j] += ridge;
  const w = solve(A, b);
  if (!w) return null;
  const intercept = ym - w.reduce((s, v, j) => s + v * mean[j], 0);
  return { w, intercept };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Joins archived run rows (pillars) with outcome rows (forward moves) on
// date + run clock + symbol + side. dayFiles: picks-run-YYYY-MM-DD.json
// payloads; outcomes: the picks-outcomes.json state. Returns one sample per
// scored name with the horizon filled.
export function joinSamples(dayFiles, outcomes, { horizon = DEFAULTS.horizon } = {}) {
  const hi = I[horizon];
  if (hi == null) throw new Error(`unknown horizon ${horizon}`);
  const moves = new Map();
  for (const r of Array.isArray(outcomes?.rows) ? outcomes.rows : []) {
    if (!Array.isArray(r)) continue;
    const y = num(r[hi]);
    if (y == null) continue;
    moves.set(`${r[I.d]}|${r[I.et]}|${r[I.s]}|${r[I.side]}`, y);
  }
  const samples = [];
  for (const day of Array.isArray(dayFiles) ? dayFiles : []) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || "")) continue;
    for (const run of Array.isArray(day.runs) ? day.runs : []) {
      const et = typeof run?.et === "string" ? run.et : "";
      for (const row of Array.isArray(run?.rows) ? run.rows : []) {
        if (!row?.s || !row.pillars) continue;
        const side = row.side === "put" ? "put" : "call";
        const y = moves.get(`${day.date}|${et}|${row.s}|${side}`);
        const tot = num(row.tot);
        if (y == null || tot == null) continue;
        const x = {};
        for (const k of PILLAR_KEYS) { const v = num(row.pillars[k]); if (v != null) x[k] = v; }
        if (!Object.keys(x).length) continue;
        samples.push({ date: day.date, et, s: row.s, side, tot, x, y });
      }
    }
  }
  return samples;
}

function featureKeys(samples) {
  const counts = {};
  for (const s of samples) for (const k of Object.keys(s.x)) counts[k] = (counts[k] || 0) + 1;
  return PILLAR_KEYS.filter((k) => (counts[k] || 0) >= samples.length * 0.9);
}

function dayIc(rows, scoreOf, minRows) {
  if (rows.length < minRows) return null;
  return spearman(rows.map(scoreOf), rows.map((r) => r.y));
}

function meanOf(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

// The walk. Returns per-window results and a summary with a verdict.
export function walkForward(samples, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const keys = featureKeys(samples);
  const byDay = new Map();
  for (const s of samples) {
    if (!keys.every((k) => s.x[k] != null)) continue;
    const dk = `${s.date} ${s.et}`;
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(s);
  }
  const days = [...byDay.keys()].sort();
  const windows = [];
  for (let start = 0; start + o.trainDays + 1 <= days.length; start += o.testDays) {
    const trainDays = days.slice(start, start + o.trainDays);
    const testDays = days.slice(start + o.trainDays, start + o.trainDays + o.testDays);
    if (!testDays.length) break;
    const train = trainDays.flatMap((d) => byDay.get(d));
    const fit = ridgeFit(train.map((s) => keys.map((k) => s.x[k])), train.map((s) => s.y), o.ridge);
    if (!fit) continue;
    const fitted = (s) => fit.intercept + keys.reduce((acc, k, j) => acc + fit.w[j] * s.x[k], 0);
    const fixed = (s) => s.tot;
    const ic = (dayList, scoreOf) => meanOf(dayList.map((d) => dayIc(byDay.get(d), scoreOf, o.minRowsPerDay)));
    windows.push({
      trainFrom: trainDays[0], trainTo: trainDays[trainDays.length - 1], testFrom: testDays[0], testTo: testDays[testDays.length - 1],
      nTrain: train.length, nTest: testDays.reduce((n, d) => n + byDay.get(d).length, 0),
      weights: Object.fromEntries(keys.map((k, j) => [k, r3(fit.w[j])])),
      fittedInSampleIc: r3(ic(trainDays, fitted)), fixedInSampleIc: r3(ic(trainDays, fixed)),
      fittedIc: r3(ic(testDays, fitted)), fixedIc: r3(ic(testDays, fixed)),
    });
  }
  const fittedOos = meanOf(windows.map((w) => w.fittedIc)), fixedOos = meanOf(windows.map((w) => w.fixedIc));
  const fittedIn = meanOf(windows.map((w) => w.fittedInSampleIc));
  const beat = windows.filter((w) => w.fittedIc != null && w.fixedIc != null && w.fittedIc > w.fixedIc).length;
  const judged = windows.filter((w) => w.fittedIc != null && w.fixedIc != null).length;
  let verdict = "insufficient", note = `Needs at least 4 walk-forward windows (${judged} so far).`;
  if (judged >= 4) {
    const gap = fittedOos - fixedOos;
    if (gap > 0.03 && beat / judged >= 0.6) { verdict = "fitted-better"; note = `Learned pillar weights beat the fixed scale out of sample by ${r3(gap)} IC in ${beat} of ${judged} windows.`; }
    else if (gap < -0.03) { verdict = "fixed-better"; note = `The fixed scale beats refitted weights out of sample by ${r3(-gap)} IC; refitting overfits the window.`; }
    else { verdict = "no-difference"; note = `Refitted weights and the fixed scale are within 0.03 IC of each other out of sample (${beat} of ${judged} windows better).`; }
    if (fixedOos != null && Math.abs(fixedOos) <= 0.02 && (fittedOos == null || Math.abs(fittedOos) <= 0.02)) note += ` Neither reads direction at the ${o.horizon} horizon in this sample (both IC within ±0.02).`;
  }
  return {
    v: WALK_FORWARD_VERSION, horizon: o.horizon, trainDays: o.trainDays, testDays: o.testDays, features: keys,
    samples: samples.length, runDays: days.length, windows,
    summary: { windows: windows.length, judged, fittedBeatFixed: beat, fittedOosIc: r3(fittedOos), fixedOosIc: r3(fixedOos), fittedInSampleIc: r3(fittedIn), shrinkage: fittedIn != null && fittedOos != null ? r3(fittedIn - fittedOos) : null, verdict, note },
  };
}

export function formatReport(result) {
  const lines = [
    `Walk-forward replay (${result.horizon}, train ${result.trainDays} run days, test ${result.testDays}): ${result.samples} samples over ${result.runDays} run days, features ${result.features.join(" ")}.`,
    "",
    "train                → test                 nTrain nTest  fixed IC  fitted IC  fitted in-sample  weights",
  ];
  for (const w of result.windows) {
    const wt = Object.entries(w.weights).map(([k, v]) => `${k}=${v}`).join(" ");
    lines.push(`${w.trainFrom.slice(0, 10)}..${w.trainTo.slice(0, 10)} → ${w.testFrom.slice(0, 10)}..${w.testTo.slice(0, 10)}  ${String(w.nTrain).padStart(6)} ${String(w.nTest).padStart(5)}  ${String(w.fixedIc ?? "—").padStart(8)}  ${String(w.fittedIc ?? "—").padStart(9)}  ${String(w.fittedInSampleIc ?? "—").padStart(16)}  ${wt}`);
  }
  const s = result.summary;
  lines.push("", `Out of sample: fixed scale IC ${s.fixedOosIc ?? "—"}, refitted IC ${s.fittedOosIc ?? "—"} (in-sample ${s.fittedInSampleIc ?? "—"}, shrinkage ${s.shrinkage ?? "—"}); refit better in ${s.fittedBeatFixed} of ${s.judged} windows.`, `Verdict: ${s.verdict}. ${s.note}`);
  return lines.join("\n");
}

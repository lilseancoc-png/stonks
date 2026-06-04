#!/usr/bin/env node
// A/B parity check for the AI_SIGNALS_COMBINED cost optimization.
//
// WHAT IT PROVES
// The optimization folds the per-ticker Major-Contract + Guidance extraction
// (formerly a dedicated attachAiContractGuidance round-trip) into the combined
// ticker-judgment call. That removes ~one flash-lite call per ticker per build,
// but the two signals (data.aiSignals.{guidance,majorContract}) feed
// scoreFundamentals, so the merged reads must agree with the dedicated reads or
// grades/picks shift. This script measures that agreement from the persisted
// per-ticker fundamentals-pillar rows in two data/grades.json snapshots.
//
// HOW TO PRODUCE THE TWO SNAPSHOTS (needs GEMINI_API_KEY — run in CI or locally
// with the key; the script below needs no key, it only diffs the JSON):
//
//   # OFF — today's behaviour (dedicated signals call)
//   AI_SIGNALS_COMBINED=0 node scripts/build.mjs
//   cp data/grades.json /tmp/grades-off.json
//
//   # ON — folded into the combined call
//   AI_SIGNALS_COMBINED=1 node scripts/build.mjs
//   cp data/grades.json /tmp/grades-on.json
//
//   node scripts/ab-signals-merge.mjs /tmp/grades-off.json /tmp/grades-on.json
//
// Because the underlying model call is non-deterministic, perfect agreement is
// not expected even between two OFF runs; run an OFF-vs-OFF baseline too to see
// the model's intrinsic run-to-run churn, then judge ON-vs-OFF against that
// floor rather than against 100%.
//
// EXIT CODE: 0 if both signals agree on >= AGREE_THRESHOLD of comparable
// tickers AND the net fundamentals-pillar score delta is within SCORE_TOLERANCE;
// 1 otherwise (review before flipping the prod Actions Variable on).

import { readFileSync } from "node:fs";

const AGREE_THRESHOLD = Number(process.env.AB_AGREE_THRESHOLD || 0.9); // 90% of comparable tickers
// Mean per-ticker |Δ| of the two fundamentals signal scores (guidance {-3..+3},
// majorContract {-3..+2}). Judge against your OFF-vs-OFF baseline — some churn
// is the model's intrinsic non-determinism, not the merge.
const SCORE_TOLERANCE = Number(process.env.AB_SCORE_TOLERANCE || 0.5);

const [offPath, onPath] = process.argv.slice(2);
if (!offPath || !onPath) {
  console.error("usage: node scripts/ab-signals-merge.mjs <grades-off.json> <grades-on.json>");
  process.exit(2);
}

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const off = load(offPath);
const on = load(onPath);

const gradesOf = (g) => (g && g.grades) || {};
const offG = gradesOf(off);
const onG = gradesOf(on);

const sigRow = (entry, key) => {
  const sigs = entry?.pillars?.fundamentals?.signals;
  if (!Array.isArray(sigs)) return null;
  return sigs.find((s) => s && s.key === key) || null;
};
const sigScore = (entry, key) => {
  const r = sigRow(entry, key);
  return r && typeof r.score === "number" ? r.score : 0;
};

const syms = Object.keys(offG).filter((s) => s in onG).sort();
let guideComparable = 0, guideAgree = 0;
let contractComparable = 0, contractAgree = 0;
const guideMismatch = [];
const contractMismatch = [];
const scoreDeltas = [];

for (const sym of syms) {
  const eo = offG[sym], en = onG[sym];

  for (const [key, agreeArr, mismatchArr, counters] of [
    ["guidance", null, guideMismatch, "guide"],
    ["majorContract", null, contractMismatch, "contract"],
  ]) {
    const ro = sigRow(eo, key);
    const rn = sigRow(en, key);
    if (!ro || !rn) continue;
    // Compare the read the model produced (value) and the resulting score.
    const vo = String(ro.value ?? "");
    const vn = String(rn.value ?? "");
    const comparable = true;
    const agree = vo === vn && ro.score === rn.score;
    if (counters === "guide") {
      guideComparable += comparable ? 1 : 0;
      guideAgree += agree ? 1 : 0;
      if (!agree) guideMismatch.push({ sym, off: `${vo} (${ro.score})`, on: `${vn} (${rn.score})` });
    } else {
      contractComparable += comparable ? 1 : 0;
      contractAgree += agree ? 1 : 0;
      if (!agree) contractMismatch.push({ sym, off: `${vo} (${ro.score})`, on: `${vn} (${rn.score})` });
    }
  }

  // Scoring impact = how much the two fundamentals signal rows the merge can
  // affect (guidance + majorContract) moved, in points, for this ticker.
  const dScore =
    Math.abs(sigScore(en, "guidance") - sigScore(eo, "guidance")) +
    Math.abs(sigScore(en, "majorContract") - sigScore(eo, "majorContract"));
  scoreDeltas.push(dScore);
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const meanAbsDelta = scoreDeltas.length
  ? scoreDeltas.reduce((a, b) => a + b, 0) / scoreDeltas.length
  : 0;

console.log(`A/B signals-merge parity — ${offPath}  vs  ${onPath}`);
console.log(`Tickers compared: ${syms.length}`);
console.log("");
console.log(`Guidance       agree ${guideAgree}/${guideComparable} (${pct(guideAgree, guideComparable)})`);
console.log(`MajorContract  agree ${contractAgree}/${contractComparable} (${pct(contractAgree, contractComparable)})`);
console.log(`Fundamentals pillar score: mean |Δ| = ${meanAbsDelta.toFixed(4)} over ${scoreDeltas.length} tickers`);
console.log("");

const show = (label, arr) => {
  if (!arr.length) { console.log(`${label}: none`); return; }
  console.log(`${label} (${arr.length}):`);
  for (const m of arr.slice(0, 40)) console.log(`  ${m.sym.padEnd(8)} off=${m.off.padEnd(18)} on=${m.on}`);
  if (arr.length > 40) console.log(`  …${arr.length - 40} more`);
};
show("Guidance mismatches", guideMismatch);
show("MajorContract mismatches", contractMismatch);
console.log("");

const guideRate = guideComparable ? guideAgree / guideComparable : 1;
const contractRate = contractComparable ? contractAgree / contractComparable : 1;
const pass =
  guideRate >= AGREE_THRESHOLD &&
  contractRate >= AGREE_THRESHOLD &&
  meanAbsDelta <= SCORE_TOLERANCE;

console.log(
  pass
    ? `PASS — agreement >= ${(AGREE_THRESHOLD * 100).toFixed(0)}% and mean |Δscore| <= ${SCORE_TOLERANCE}. Safe to enable AI_SIGNALS_COMBINED=1 (compare against your OFF-vs-OFF baseline churn).`
    : `REVIEW — below threshold. Inspect mismatches above and your OFF-vs-OFF baseline before enabling.`,
);
process.exit(pass ? 0 : 1);

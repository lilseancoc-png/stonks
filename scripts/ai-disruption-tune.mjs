// Report on the AI disruption capture-score weights (lib/ai-disruption/).
// Prints how each grade varies across the launch log and how widely the
// current and first-draft weights spread the scores, then the widest-spread
// weights within 0.10 of the draft that keep coverage >= 0.25, autonomy
// >= 0.15 and the draft's rank order (Spearman >= 0.85). Read-only.
//   node scripts/ai-disruption-tune.mjs [path/to/ai-disruption.json]
// With a saved public log, its launches (with the Owner's fixes applied) are
// used instead of the registry backfill.
import { readFileSync } from "node:fs";
import { LAUNCHES, CAPTURE_WEIGHTS, CAPTURE_WEIGHTS_DRAFT, captureGrades, captureScore } from "../lib/ai-disruption/index.mjs";

const file = process.argv[2];
const launches = file ? JSON.parse(readFileSync(file, "utf8")).launches : LAUNCHES;
const keys = Object.keys(CAPTURE_WEIGHTS);
const grades = launches.map((l) => captureGrades(l));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const rank = (a) => { const r = Array(a.length); a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).forEach(([, i], k) => { r[i] = k; }); return r; };
const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length; let d = 0; for (let i = 0; i < n; i += 1) d += (ra[i] - rb[i]) ** 2; return 1 - (6 * d) / (n * (n * n - 1)); };
const scores = (w) => launches.map((l) => captureScore(l, null, w));
const line = (name, w) => { const s = scores(w); return `${name.padEnd(8)} sd ${sd(s).toFixed(1)}  middle half ${q(s, 0.25)}-${q(s, 0.75)}  range ${Math.min(...s)}-${Math.max(...s)}`; };

console.log(`${launches.length} launches`);
for (const k of keys) {
  const v = grades.map((g) => g[k]);
  console.log(`  ${k.padEnd(13)} average ${mean(v).toFixed(2)} of 5, spread ${sd(v).toFixed(2)}`);
}
console.log(line("draft", CAPTURE_WEIGHTS_DRAFT));
console.log(line("current", CAPTURE_WEIGHTS));

const w0 = keys.map((k) => CAPTURE_WEIGHTS_DRAFT[k]);
const s0 = scores(CAPTURE_WEIGHTS_DRAFT);
const steps = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
let best = null;
function* combos(i, left, acc) {
  if (i === keys.length - 1) { if (left >= 0.05 - 1e-9 && left <= 0.35 + 1e-9) yield [...acc, +left.toFixed(2)]; return; }
  for (const s of steps) if (s <= left - 0.05 * (keys.length - 1 - i) + 1e-9) yield* combos(i + 1, +(left - s).toFixed(2), [...acc, s]);
}
for (const w of combos(0, 1, [])) {
  if (w.some((x, i) => Math.abs(x - w0[i]) > 0.1 + 1e-9) || w[keys.indexOf("coverage")] < 0.25 || w[keys.indexOf("autonomy")] < 0.15) continue;
  const obj = Object.fromEntries(keys.map((k, i) => [k, w[i]]));
  const s = scores(obj);
  const r = spearman(s, s0);
  if (r < 0.85) continue;
  if (!best || sd(s) > best.sd) best = { w: obj, sd: sd(s), r };
}
if (best) {
  console.log(line("widest", best.w));
  console.log(`  weights ${JSON.stringify(best.w)}  rank match with draft ${best.r.toFixed(2)}`);
}

// Read-only research inventory. No imports from the build, network, models, or broker.
// Run: node scripts/audit-top-picks-research.mjs --as-of=2026-10-27
// Optional: --out=<report.json>. Only that explicit report path is written.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(as-of|out)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --as-of=YYYY-MM-DD and optional --out=<path>');
  return [match[1], match[2]];
}));
const asOf = args['as-of'] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new Error('Invalid as-of date');
const sources = {};
async function source(path) {
  const text = await readFile(resolve(root, path), 'utf8');
  sources[path] = { sha256: createHash('sha256').update(text).digest('hex') };
  return text;
}
const build = await source('scripts/build.mjs');
const shadow = await source('lib/shadow-signals.mjs');
const economics = await source('lib/option-entry-economics.mjs');
const evidence = await source('lib/evidence-record.mjs');
function section(start, end) {
  const a = build.indexOf(start), b = build.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Source boundary changed: ${start}`);
  return build.slice(a, b);
}
const technicals = section('function scoreTechnicals(', 'export function fiveSessionReturnPct(');
const score = section('function scoreTicker(', 'const FLOW_PERSIST_WINDOW_MS');
const aiCandidates = section('export function aiGraderCandidates(', 'export async function generateAiTheses(');
const prompt = section('export function buildThesisUserMessage(', 'function parseThesisResponse(');
const daily = section('export function appendGradesDaily(', 'export async function writeGradesDaily(');
const checks = [
  ['streak-vote-reads-current-run', /streakRow\?\.current/.test(technicals) && /sameDays >= 3/.test(technicals)],
  ['streak-vote-does-not-read-snapped-or-ma-context', !/lastEnded|maContext/.test(technicals)],
  ['timing-kept-out-of-base-conviction', /const base = fund.score \+ tech.score \+ mech.score \+ narr.score/.test(score)],
  ['ai-candidates-screened-on-existing-score', /preClearsBar/.test(aiCandidates) && /Math.abs\(r.total\) >= minConv/.test(aiCandidates)],
  ['ai-prompt-already-reads-iv-momentum', /extras\?\.ivRow/.test(prompt) && /IV MOMENTUM/.test(prompt)],
  ['shadow-logging-already-exists', /SHADOW_KEYS = \['r21', 'im21', 'vrp', 'cw', 'pw', 'pg', 'pe14'\]/.test(shadow)],
  ['option-feasibility-has-three-iv-stresses', /\['iv-down', .8\], \['iv-flat', 1\], \['iv-up', 1.2\]/.test(economics)],
  ['daily-grade-snapshot-replaces-same-date', /findIndex/.test(daily) && /days\[idx\] =/.test(daily)],
  ['holdings-evidence-reads-value-change', /const value = row \? finite\(row.valueChange\) : 0/.test(evidence)],
  ['form4-display-is-truncated', /transactions: deduped.slice\(0, 120\)/.test(build)],
].map(([id, observed]) => ({ id, observed }));

const files = [
  'streaks.json', 'iv-trending.json', 'ma-tracker.json', 'pattern-recognition.json',
  'historical-data.json', 'historical-source-history.json', 'CBRS.json',
  'grades.json', 'grades-daily.json', 'picks.json', 'picks-accuracy.json',
  '13f.json', 'quant.json', 'evidence-latest.json', 'earnings-forecast.json', 'unified-signal.json',
];
const artifacts = [];
for (const file of files) {
  let raw;
  try { raw = await readFile(resolve(root, 'data', file), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    artifacts.push({ file, status: 'missing-locally' });
    continue;
  }
  let value;
  try { value = JSON.parse(raw); }
  catch { artifacts.push({ file, status: 'invalid-json' }); continue; }
  const stamp = value.builtAtIso || value.asOf || value.date || null;
  const stampMs = stamp ? Date.parse(stamp) : NaN;
  const ageCalendarDays = Number.isFinite(stampMs)
    ? Math.round((Date.parse(asOf) - Date.parse(new Date(stampMs).toISOString().slice(0, 10))) / 86400000) : null;
  artifacts.push({ file, status: 'present-locally', stamp, ageCalendarDays,
    note: 'Local file only. Age is calendar days, not a cadence or market-session eligibility verdict.' });
}
const dataNames = await readdir(resolve(root, 'data')).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
const report = { version: 1, asOf, scope: 'Source connections and local coverage only; no production access or predictive backtest.',
  sources, checks, artifacts,
  hasLocalIvHistoryDirectory: dataNames.includes('iv-history'),
  limits: ['Source pattern checks detect drift; they are not runtime tests.',
    'Missing local private data does not establish missing production data.',
    'No performance lift, win probability, or current CBRS assessment is estimated.'] };
const json = JSON.stringify(report, null, 2) + '\n';
if (args.out) await writeFile(resolve(args.out), json);
console.log(json);
if (checks.some(check => !check.observed)) process.exitCode = 1;

// Scope audit, in addition to the runtime access and preservation tests.
//
// The producer, storage, grading, research and broker files and the 17 browser
// calculators must match the fingerprints saved in
// scripts/owner-scope-baseline.json. A deliberate change to one of them updates
// that list:
//
//   node scripts/owner-scope-smoke.mjs --update
//
// so the change shows up in review as an edit to the list, instead of this
// check failing on every branch that touches build.mjs. The published data
// manifest and the baked risk-free rate still compare with the branch point
// (git merge-base with origin/main, or OWNER_SCOPE_BASE), because every bake
// rewrites them on main.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const LIST = new URL('scripts/owner-scope-baseline.json', root);
const update = process.argv.includes('--update');
const source = path => readFileSync(new URL(path, root), 'utf8');
const exists = path => { try { source(path); return true; } catch { return false; } };
const hash = text => createHash('sha256').update(text).digest('hex');

const FILES = ['scripts/build.mjs', 'lib/top-picks-config.mjs', 'lib/datastore.mjs', 'lib/data-ownership.mjs', 'scripts/sync-data.mjs', 'lib/webull-mirror.mjs', 'lib/grade-research.mjs', 'lib/picks.mjs'].filter(exists);
const CALCULATORS = ['gradeSpread', 'gradeLiquidity', 'gradeVolRegime', 'gradeDelta', 'gradeTheta', 'shouldBuy', 'findAlternative', 'reconcileVerdict', 'buildResultHtml', 'computeMaxPain', 'computeTermStructure', 'computeLiveMacroRegime', 'computeGexFlip', 'computeGex', 'maTrackerScore', 'heatmapSquarify', 'heatmapColorParts'];

function fn(text, name) {
  const start = text.indexOf('  function ' + name + '('); assert(start >= 0, 'Function exists: ' + name);
  const lineEnd = text.indexOf('\n', start);
  const first = text.slice(start, lineEnd);
  const end = first.trimEnd().endsWith('}') ? lineEnd : text.indexOf('\n  }', start) + 4;
  assert(end > start, 'Function closes: ' + name);
  const code = text.slice(start, end).trim(); new vm.Script('(' + code + ')'); return code;
}

const appJs = source('app.js');
const current = {
  files: Object.fromEntries(FILES.map(f => [f, hash(source(f))])),
  calculators: Object.fromEntries(CALCULATORS.map(n => [n, hash(fn(appJs, n))])),
};

if (update) {
  writeFileSync(LIST, JSON.stringify({ note: 'Fingerprints for scripts/owner-scope-smoke.mjs. Update with --update only for a deliberate change, and say why in the PR.', ...current }, null, 2) + '\n');
  console.log('Owner scope list updated: ' + FILES.length + ' files, ' + CALCULATORS.length + ' calculators. Commit scripts/owner-scope-baseline.json with the change.');
  process.exit(0);
}

const saved = JSON.parse(readFileSync(LIST, 'utf8'));
const changed = [];
for (const [f, h] of Object.entries(current.files)) if (saved.files?.[f] !== h) changed.push(f);
for (const f of Object.keys(saved.files || {})) if (!(f in current.files)) changed.push(f + ' (removed)');
for (const [n, h] of Object.entries(current.calculators)) if (saved.calculators?.[n] !== h) changed.push('app.js ' + n + '()');
assert.deepEqual(changed, [], 'Producer, storage, grading, research, broker or calculator source changed without updating the saved list: ' + changed.join(', ') + '. If the change is deliberate, run node scripts/owner-scope-smoke.mjs --update and commit the list.');

// Bake-rewritten values: compare with the branch point, not the moving tip.
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
let base = process.env.OWNER_SCOPE_BASE || null;
if (!base) { try { base = git('merge-base', 'HEAD', 'origin/main').trim(); } catch { base = null; } }
if (!base) { console.log('Owner scope audit: saved fingerprints match; no branch point found, so the manifest and rate comparison was skipped.'); process.exit(0); }
const original = git('show', base + ':app.js');
for (const name of ['RFR', 'RFR_META']) assert.equal(appJs.match(new RegExp('var ' + name + ' = ([^;]+);'))[1], original.match(new RegExp('var ' + name + ' = ([^;]+);'))[1], name + ' provenance unchanged');
const manifest = html => html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1];
assert.equal(manifest(source('index.html')), manifest(git('show', base + ':index.html')), 'Published data manifest remains byte-identical');
console.log('Owner scope audit: ' + FILES.length + ' producer/storage/broker files and ' + CALCULATORS.length + ' browser calculators match the saved list; published manifest and rate provenance match the branch point.');

// Checks and finishes the site dictionaries in i18n/.
//
//   node scripts/i18n-build.mjs           # check zh-CN / ja / ko, write zh-TW
//   node scripts/i18n-build.mjs --check   # check only, exit 1 on a problem
//
// zh-CN.json, ja.json and ko.json are written by hand
// as { "strings": { "<English key>": "<text>" } }.
// zh-TW.json is made from zh-CN.json with OpenCC (Simplified -> Taiwan
// Traditional with Taiwan phrasing), then i18n/zh-TW-overrides.json wins for
// any key it lists. Every entry must keep the key's {0} number slots and
// <0>…</0> / <0/> tag markers, or the browser would drop numbers or markup;
// entries that do not are reported and left out. No network, no AI.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'i18n');
const HAND = ['zh-CN', 'ja', 'ko'];
const checkOnly = process.argv.includes('--check');

const readJson = async (name, fallback) => {
  try { return JSON.parse(await readFile(resolve(DIR, name), 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
const slots = (s) => (s.match(/\{\d+\}|<\/?\d+\/?>/g) || []).sort().join(' ');

function clean(strings, lang, problems) {
  const out = {};
  for (const key of Object.keys(strings).sort((a, b) => a.localeCompare(b))) {
    const val = strings[key];
    if (val == null || val === '') continue;
    if (typeof val !== 'string') { problems.push(`${lang}: not text: ${key}`); continue; }
    if (slots(key) !== slots(val)) { problems.push(`${lang}: slots differ: ${JSON.stringify(key)} -> ${JSON.stringify(val)}`); continue; }
    out[key] = val;
  }
  return out;
}

const write = (lang, strings) => writeFile(resolve(DIR, lang + '.json'), JSON.stringify({ lang, strings }, null, 1) + '\n');

const problems = [];
const done = {};
for (const lang of HAND) {
  const file = await readJson(lang + '.json', { strings: {} });
  done[lang] = clean(file.strings || {}, lang, problems);
  if (!checkOnly) await write(lang, done[lang]);
}

// opencc-js is not a project dependency (no new package for a rarely run
// step). Install it for one run with `npm i --no-save opencc-js`; without it
// the existing zh-TW.json is kept and only checked.
let OpenCC = null;
if (!checkOnly) { try { OpenCC = await import('opencc-js'); } catch { console.log('opencc-js not installed; keeping the existing zh-TW.json (npm i --no-save opencc-js to rebuild it).'); } }
if (!checkOnly && !OpenCC) {
  clean((await readJson('zh-TW.json', { strings: {} })).strings || {}, 'zh-TW', problems);
}
if (!checkOnly && OpenCC) {
  const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });
  const overrides = (await readJson('zh-TW-overrides.json', { strings: {} })).strings || {};
  // A few Taiwan word choices OpenCC leaves in mainland form.
  const FIX = [[/賬/g, '帳'], [/質量/g, '品質'], [/激活/g, '啟用'], [/菜單/g, '選單']];
  const tw = {};
  for (const [k, v] of Object.entries(done['zh-CN'])) {
    let t = toTw(v);
    for (const [re, rep] of FIX) t = t.replace(re, rep);
    tw[k] = t;
  }
  Object.assign(tw, overrides);
  await write('zh-TW', clean(tw, 'zh-TW', problems));
}

let keys = [];
try { keys = await readJson('source-strings.json'); } catch {}
for (const lang of HAND) {
  const n = Object.keys(done[lang]).length;
  const covered = keys.length ? keys.filter((k) => k in done[lang]).length : 0;
  console.log(`${lang}: ${n} entries${keys.length ? `, ${covered}/${keys.length} site strings` : ''}`);
}
if (problems.length) {
  console.log(problems.join('\n'));
  if (checkOnly) process.exit(1);
}

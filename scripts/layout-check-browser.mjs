#!/usr/bin/env node
// Layout check (2026-11-08): every page in the site map, as the Owner and as
// a public visitor, at phone and desktop width, light and dark. Each load
// must throw no error, show no raw "undefined" / "NaN" / "[object Object]",
// keep every element inside the viewport (no sideways scroll), load its
// images and show text. Screenshots are saved to a temp folder for a look;
// nothing is compared with a committed picture, so a deliberate redesign
// never fails this check.
//
// Data: the keys in LAYOUT_DATA_DIR (a hydrated data/ folder, for example
// after `node scripts/sync-data.mjs pull`) are served when that is set, so
// the data-rich layouts are checked locally; without it every page shows its
// empty state, which must hold up just as well. LAYOUT_ONLY=home,picks
// limits the pages; LAYOUT_WIDTHS=390,1440 the widths. Synthetic server only.
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { startSiteServer, launchBrowser, openTab, pageProblems, settle, selfTest } from './browser-harness.mjs';

const NOW = process.env.LAYOUT_NOW || null;
const output = process.env.LAYOUT_OUT || resolve(tmpdir(), 'stonks-layout-check');
await mkdir(output, { recursive: true });
const only = process.env.LAYOUT_ONLY ? new Set(process.env.LAYOUT_ONLY.split(',')) : null;
const widths = (process.env.LAYOUT_WIDTHS || '390,1440').split(',').map(Number).filter((n) => n > 0);
const dataDir = process.env.LAYOUT_DATA_DIR || null;
const pages = SITE_SECTIONS.flatMap((s) => s.items.map((i) => ({ id: i.id, owner: !!i.owner })));
const dataCache = new Map();
async function readData(key) {
  if (!dataDir || !/^[A-Za-z0-9._/-]+\.json$/.test(key) || key.includes('..')) return null;
  if (!dataCache.has(key)) dataCache.set(key, readFile(resolve(dataDir, key), 'utf8').then((t) => JSON.parse(t)).catch(() => null));
  return dataCache.get(key);
}

let owner = false;
const server = await startSiteServer({ data: readData, owner: () => owner });
const browser = await launchBrowser();
let checks = 0, shots = 0;
const failures = [];
try {
  await selfTest(browser, server.base);
  for (const width of widths) {
    const theme = width <= 500 ? 'dark' : 'light';
    for (const p of pages) {
      if (only && !only.has(p.id)) continue;
      owner = p.owner;
      const s = await openTab(browser, server.base, { width, theme, tab: p.id, now: NOW });
      await settle(s.page, 800);
      const problems = await pageProblems(s);
      const name = p.id + '-' + width + '-' + theme;
      await s.page.screenshot({ path: resolve(output, name + '.png'), fullPage: false }); shots++;
      checks++;
      if (problems.length) failures.push({ name, problems });
      await s.context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
for (const f of failures) console.error('✗ ' + f.name + '\n    ' + f.problems.join('\n    '));
if (failures.length) { console.error(`layout-check-browser: ${failures.length} of ${checks} page loads have layout problems (screenshots in ${output})`); process.exit(1); }
console.log(`layout-check-browser: ${checks} page loads clean at ${widths.join('/')}px${dataDir ? ' with data from ' + dataDir : ' (empty-state data)'} (${shots} screenshots in ${output})`);

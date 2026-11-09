// Site catalog: the page list the MCP `list_features` tool and the Update
// checker read, generated from scripts/render/site-map.mjs, plus the covered
// symbol list generated from TICKERS in scripts/build.mjs.
//   node scripts/site-catalog.mjs          writes lib/site-catalog/{site-catalog,universe}.mjs
//   node scripts/site-catalog.mjs --check  fails when either file drifted
// lib/site-catalog/feature-sources.mjs (page -> published file) is hand-kept.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { SITE_SECTIONS } from './render/site-map.mjs';

const check = process.argv.includes('--check');
const root = new URL('../', import.meta.url);
const catalog = '// Generated from scripts/render/site-map.mjs by scripts/site-catalog.mjs.\nexport const siteCatalog = ' + JSON.stringify(SITE_SECTIONS.flatMap((s) => s.items.map((i) => ({ id: i.id, label: i.label, description: i.blurb, category: s.label }))), null, 2) + ';\n';
const catalogPath = new URL('lib/site-catalog/site-catalog.mjs', root);
if (check) assert.equal(await readFile(catalogPath, 'utf8'), catalog, 'Site catalog drift: run node scripts/site-catalog.mjs');
else await writeFile(catalogPath, catalog);

const build = await readFile(new URL('scripts/build.mjs', root), 'utf8');
const coverage = build.match(/export const TICKERS = \[([\s\S]*?)\];/)[1].replace(/\/\/[^\n]*/g, '');
const universe = [...coverage.matchAll(/"([A-Z0-9.]+)"/g)].map((m) => m[1]);
const universeBytes = '// Generated from the site coverage list in scripts/build.mjs by scripts/site-catalog.mjs.\nexport const researchUniverse = ' + JSON.stringify(universe).replaceAll(',', ', ') + ';\n';
const universePath = new URL('lib/site-catalog/universe.mjs', root);
if (check) assert.equal(await readFile(universePath, 'utf8'), universeBytes, 'Covered symbol list drift: run node scripts/site-catalog.mjs');
else await writeFile(universePath, universeBytes);
console.log('Site catalog ' + (check ? 'verified.' : 'generated.'));

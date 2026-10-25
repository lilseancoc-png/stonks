// Offline feature-only regeneration. Preserve other desks and data provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { renderHtml } from './render/html.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const original = await readFile(resolve(root, 'index.html'), 'utf8');
const oldApp = await readFile(resolve(root, 'app.js'), 'utf8');
const manifestText = original.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
assert(manifestText, 'published shell manifest required');
const manifest = JSON.parse(manifestText);
const rate = oldApp.match(/var RFR = ([^;]+);/)?.[1], meta = oldApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta, 'existing rate provenance required');
const app = renderAppJs({ riskFreeRate: Number(rate), riskFreeRateMeta: JSON.parse(meta) });
new vm.Script(app);
const css = renderStylesCss();
const rendered = renderHtml({ ...manifest, volumeFlags: manifest.volumeFlagsMeta, oi: manifest.oiMeta });
const nav = rendered.match(/<button\b[^>]*data-page-tab="historical-data"[^>]*>[\s\S]*?<\/button>/)?.[0];
const pane = rendered.match(/  <div class="page-pane" id="page-pane-historical-data"[\s\S]*?(?=  <div class="page-pane")/)?.[0];
assert(nav && pane, 'Historical Data chrome required');
let html = original;
if (html.includes('data-page-tab="historical-data"')) html = html.replace(/<button\b[^>]*data-page-tab="historical-data"[^>]*>[\s\S]*?<\/button>/, nav);
else html = html.replace(/(<button\b[^>]*data-page-tab="bottom-tracker"[^>]*>[\s\S]*?<\/button>)/, '$1\n      ' + nav);
if (html.includes('id="page-pane-historical-data"')) html = html.replace(/  <div class="page-pane" id="page-pane-historical-data"[\s\S]*?(?=  <div class="page-pane")/, pane);
else html = html.replace('  <div class="page-pane" id="page-pane-quant"', pane + '  <div class="page-pane" id="page-pane-quant"');
for (const [name, content] of [['app.js', app], ['styles.css', css]]) {
  html = html.replace(new RegExp('(' + name.replace('.', '\\.') + '\\?v=)[^"\\s]+', 'g'), '$1' + contentAssetVersion(content));
}
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1], manifestText);
assert.equal((html.match(/id="page-pane-historical-data"/g) || []).length, 1);
await writeFile(resolve(root, 'index.html'), html);
await writeFile(resolve(root, 'app.js'), app);
await writeFile(resolve(root, 'styles.css'), css);
console.log('Regenerated Historical Data navigation, pane, and browser assets. Other desks and data/rate provenance preserved.');

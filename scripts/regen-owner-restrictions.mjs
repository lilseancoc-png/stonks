// Rebuild browser assets offline while preserving market-data and rate provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderHtml } from './render/html.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
const root = new URL('../', import.meta.url);
const original = await readFile(new URL('index.html', root), 'utf8');
const oldApp = await readFile(new URL('app.js', root), 'utf8');
const manifestText = original.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
assert(manifestText, 'Existing shell manifest required');
const manifest = JSON.parse(manifestText);
assert(manifest.deferred, 'Keep data in server-routed sidecars');
const rate = Number(oldApp.match(/var RFR = ([^;]+);/)[1]);
const rateMeta = JSON.parse(oldApp.match(/var RFR_META = ([^;]+);/)[1]);
const app = renderAppJs({ riskFreeRate: rate, riskFreeRateMeta: rateMeta });
new vm.Script(app);
const styles = renderStylesCss();
const book = await readFile(new URL('js/book-views.js', root), 'utf8');
const assetVersions = Object.fromEntries([['app.js', app], ['styles.css', styles], ['js/book-views.js', book],
  ['js/streaks.js', await readFile(new URL('js/streaks.js', root), 'utf8')]].map(([key, bytes]) => [key, contentAssetVersion(bytes)]));
let html = renderHtml({ ...manifest, volumeFlags: manifest.volumeFlagsMeta, oi: manifest.oiMeta, assetVersions });
html = html.replace(/window\.STONKS_MANIFEST=\{.*\};<\/script>/, 'window.STONKS_MANIFEST=' + manifestText + ';</script>');
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1], manifestText);
for (const [name, bytes] of [['index.html', html], ['app.js', app], ['styles.css', styles]]) await writeFile(new URL(name, root), bytes);
console.log('Regenerated Owner restrictions with unchanged data and rate provenance.');

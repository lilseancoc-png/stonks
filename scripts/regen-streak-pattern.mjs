// Offline UI regeneration, preserving market data, page state, and rate provenance.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {renderHtml} from './render/html.mjs';
import {renderAppJs} from './render/app-js.mjs';
import {renderStylesCss} from './render/styles-css.mjs';
import {contentAssetVersion} from '../lib/asset-version.mjs';
const html = await readFile('index.html','utf8'), oldApp = await readFile('app.js','utf8');
const manifestText = html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
assert(manifestText, 'Existing shell manifest required');
const manifest = JSON.parse(manifestText), rate = oldApp.match(/var RFR = ([^;]+);/)?.[1], meta = oldApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta, 'Existing rate provenance required');
const app = renderAppJs({riskFreeRate:Number(rate),riskFreeRateMeta:JSON.parse(meta)}), css = renderStylesCss();
new vm.Script(app);
const generated = renderHtml({...manifest, volumeFlags:manifest.volumeFlagsMeta, oi:manifest.oiMeta});
let next = html;
for (const pane of ['streaks','pattern-lab']) {
  const pattern = new RegExp('  <div class="page-pane" id="page-pane-' + pane + '"[\\s\\S]*?(?=  <div class="page-pane")');
  const section = generated.match(pattern)?.[0]; assert(section, pane + ' pane required');
  assert(pattern.test(next));next = next.replace(pattern,section);
}
for (const [asset,body] of [['app.js',app],['styles.css',css],['js/streaks.js',await readFile('js/streaks.js','utf8')]]) {
  next = next.replace(new RegExp('(' + asset.replaceAll('.','\\.') + '\\?v=)[^"\\s]+','g'), '$1' + contentAssetVersion(body));
}
assert.equal(next.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1], manifestText);
await writeFile('app.js',app);await writeFile('styles.css',css);await writeFile('index.html',next);
console.log('Regenerated Streaks and Pattern Lab UI; market data and rate provenance preserved.');

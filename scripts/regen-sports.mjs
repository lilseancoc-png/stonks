// Offline Sports-only regeneration: adds or refreshes the Sports sidebar group
// and its three panes in the committed index.html and rebuilds app.js /
// styles.css, preserving the published manifest and the risk-free-rate
// provenance. Same approach as regen-historical-data.mjs; no data/ needed.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { renderHtml } from './render/html.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
import { SPORTS_PAGE_IDS } from '../lib/owner-access-policy.mjs';

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

const groupRe = /<details class="side-nav-group" data-nav-group="sports"[\s\S]*?<\/details>/;
const group = rendered.match(groupRe)?.[0];
assert(group, 'Sports sidebar group required');
const paneRe = (id) => new RegExp('  <div class="page-pane" id="page-pane-' + id + '"[\\s\\S]*?(?=  <div class="page-pane")');
const panes = SPORTS_PAGE_IDS.map((id) => rendered.match(paneRe(id))?.[0]);
assert(panes.every(Boolean), 'Sports panes required');

let html = original;
if (groupRe.test(html)) html = html.replace(groupRe, group);
else {
  const ownerGroup = html.match(/<details class="side-nav-group" data-nav-group="owner"[\s\S]*?<\/details>/)?.[0];
  assert(ownerGroup, 'Owner sidebar group required');
  html = html.replace(ownerGroup, ownerGroup + '\n  ' + group);
}
SPORTS_PAGE_IDS.forEach((id, i) => {
  if (html.includes('id="page-pane-' + id + '"')) html = html.replace(paneRe(id), panes[i]);
  else {
    const after = i === 0 ? 'quant' : SPORTS_PAGE_IDS[i - 1];
    const anchor = html.match(paneRe(after))?.[0];
    assert(anchor, 'pane anchor ' + after + ' required');
    html = html.replace(anchor, anchor + panes[i]);
  }
});
for (const [name, content] of [['app.js', app], ['styles.css', css]]) {
  html = html.replace(new RegExp('(' + name.replace('.', '\\.') + '\\?v=)[^"\\s]+', 'g'), '$1' + contentAssetVersion(content));
}
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1], manifestText);
for (const id of SPORTS_PAGE_IDS) {
  assert.equal((html.match(new RegExp('id="page-pane-' + id + '"', 'g')) || []).length, 1);
  assert.equal((html.match(new RegExp('data-page-tab="' + id + '"', 'g')) || []).length, 1);
}
await writeFile(resolve(root, 'index.html'), html);
await writeFile(resolve(root, 'app.js'), app);
await writeFile(resolve(root, 'styles.css'), css);
console.log('Regenerated the Sports section navigation, panes and browser assets. Other desks and data/rate provenance preserved.');

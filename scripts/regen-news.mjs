// Regenerate the News desk and app.js offline. Preserve the published
// shell's data timestamp, manifest, rate provenance and every other section.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { renderHtml } from './render/html.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
const root = fileURLToPath(new URL('..',import.meta.url));
const original = await readFile(resolve(root,'index.html'),'utf8');
const oldApp = await readFile(resolve(root,'app.js'),'utf8');
const manifestText = original.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
assert(manifestText,'published shell manifest required');
const manifest = JSON.parse(manifestText);
const rate = oldApp.match(/var RFR = ([^;]+);/)?.[1];
const meta = oldApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta,'existing rate provenance required');
const app = renderAppJs({riskFreeRate:Number(rate),riskFreeRateMeta:JSON.parse(meta)});
new vm.Script(app);
const rendered = renderHtml({...manifest,volumeFlags:manifest.volumeFlagsMeta,oi:manifest.oiMeta});
function section(html,id) {
  const start = html.search(new RegExp('<section\\b[^>]*id="'+id+'"[^>]*>'));
  assert(start>=0,'section required: '+id);
  const tags=/<\/?section\b[^>]*>/g;
  tags.lastIndex=start;
  let depth=0,match;
  while((match=tags.exec(html))) {
    depth+=match[0].startsWith('</')?-1:1;
    if(depth===0)return {start,end:tags.lastIndex,text:html.slice(start,tags.lastIndex)};
  }
  throw new Error('Unclosed section '+id);
}
let html=original;
for(const id of ['news-feed-section']) {
  const old=section(html,id),next=section(rendered,id);
  html=html.slice(0,old.start)+next.text+html.slice(old.end);
}
html=html.replace(/(app\.js\?v=)[^"\s]+/g,'$1'+contentAssetVersion(app));
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1],manifestText);
await writeFile(resolve(root,'index.html'),html);
await writeFile(resolve(root,'app.js'),app);
console.log('Regenerated News and app.js; preserved other desks and data/rate provenance.');

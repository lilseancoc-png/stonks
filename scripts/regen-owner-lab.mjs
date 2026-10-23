// Offline regeneration for an Owner Lab-only change when no private hydrate
// is available. Preserve every other HTML section, the shell data timestamp,
// and the already-published risk-free-rate value and provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { renderHtml } from './render/html.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const original=await readFile(resolve(root,'index.html'),'utf8');
const originalApp=await readFile(resolve(root,'app.js'),'utf8');
const manifestText=original.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
assert.ok(manifestText,'existing shell manifest is required');
const manifest=JSON.parse(manifestText);
const rate=originalApp.match(/var RFR = ([^;]+);/)?.[1];
const rateMeta=originalApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert.ok(rate && rateMeta,'existing risk-free rate and provenance are required');
const app=renderAppJs({riskFreeRate:Number(rate),riskFreeRateMeta:JSON.parse(rateMeta)});
new vm.Script(app);
const styles=renderStylesCss();
const rendered=renderHtml({...manifest,volumeFlags:manifest.volumeFlagsMeta,oi:manifest.oiMeta});
function ownerSection(html){
  const start=html.search(/<section\b[^>]*id="quant-section"[^>]*>/);
  assert.ok(start>=0,'Owner Lab section is required');
  const tags=/<\/?section\b[^>]*>/g;
  tags.lastIndex=start;
  let depth=0,match;
  while((match=tags.exec(html))){
    depth+=match[0].startsWith('</')?-1:1;
    if(depth===0)return {start,end:tags.lastIndex,text:html.slice(start,tags.lastIndex)};
  }
  throw new Error('Unclosed Owner Lab section');
}
const previous=ownerSection(original), next=ownerSection(rendered);
let html=original.slice(0,previous.start)+next.text+original.slice(previous.end);
for(const [name,bytes] of [['app.js',app],['styles.css',styles],['js/book-views.js',await readFile(resolve(root,'js/book-views.js'),'utf8')]]){
  const literal=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp('('+literal+'\\?v=)[^"\\s]+','g');
  assert.ok(pattern.test(html),'asset version reference is required: '+name);
  html=html.replace(pattern,'$1'+contentAssetVersion(bytes));
}
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1],manifestText,'shell data provenance must not change');
await writeFile(resolve(root,'index.html'),html);
await writeFile(resolve(root,'app.js'),app);
await writeFile(resolve(root,'styles.css'),styles);
console.log('Regenerated Owner Lab HTML and browser assets offline; preserved other sections and data/rate provenance.');

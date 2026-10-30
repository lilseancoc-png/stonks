// Rebuild the affected browser assets offline, preserving research timestamps.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {renderAppJs} from './render/app-js.mjs';
import {renderStylesCss} from './render/styles-css.mjs';
import {trackRecordSection,topPicksSection} from './render/html.mjs';
import {contentAssetVersion} from '../lib/asset-version.mjs';
const root=new URL('../',import.meta.url);
const [original,priorApp]=await Promise.all(['index.html','app.js'].map(p=>readFile(new URL(p,root),'utf8')));
const rate=priorApp.match(/var RFR = ([^;]+);/)?.[1],meta=priorApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate&&meta,'Existing risk-free-rate provenance is required');
const app=renderAppJs({riskFreeRate:Number(rate),riskFreeRateMeta:JSON.parse(meta)}),css=renderStylesCss();
new vm.Script(app);
let html=original;
for(const [id,render]of[['picks-section',topPicksSection],['accuracy-section',trackRecordSection]]){
 const re=new RegExp('<section class="card" id="'+id+'">[\\s\\S]*?<\\/section>');
 assert(re.test(html),'Existing '+id+' required');html=html.replace(re,()=>render());
}
for(const [name,content]of[['app.js',app],['styles.css',css]])html=html.replace(new RegExp('('+name.replace('.','\\.')+'\\?v=)[^"\\s]+','g'),'$1'+contentAssetVersion(content));
assert.equal(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1],original.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1]);
await Promise.all([['index.html',html],['app.js',app],['styles.css',css]].map(([name,bytes])=>writeFile(new URL(name,root),bytes)));
console.log('Updated Top Picks and Track Record chrome; research snapshots and rate provenance preserved.');

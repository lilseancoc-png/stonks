// Compare behavior-bearing source with the branch base. This is a scope audit,
// in addition to runtime access and preservation tests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
const base=git('merge-base','HEAD','main').trim();
const source=path=>readFileSync(new URL(path,root),'utf8');
for(const file of ['scripts/build.mjs','lib/datastore.mjs','lib/data-ownership.mjs','scripts/sync-data.mjs','lib/webull-mirror.mjs','lib/grade-research.mjs','lib/picks.mjs'].filter(file=>{try{source(file);return true;}catch{return false;}})){
  assert.equal(source(file),git('show',base+':'+file),'No changes to producer, storage, grading, research or broker behavior: '+file);
}
const original=git('show',base+':app.js'),current=source('app.js');
function fn(text,name){
  const start=text.indexOf('  function '+name+'(');assert(start>=0,'Function exists: '+name);
  const lineEnd=text.indexOf('\n',start);
  const first=text.slice(start,lineEnd);
  const end=first.trimEnd().endsWith('}')?lineEnd:text.indexOf('\n  }',start)+4;
  assert(end>start,'Function closes: '+name);
  const code=text.slice(start,end).trim();new vm.Script('('+code+')');return code;
}
const calculators=['gradeSpread','gradeLiquidity','gradeVolRegime','gradeDelta','gradeTheta','shouldBuy','findAlternative','reconcileVerdict','buildResultHtml','computeMaxPain','computeTermStructure','computeLiveMacroRegime','computeGexFlip','computeGex','maTrackerScore','heatmapSquarify','heatmapColorParts'];
for(const name of calculators)assert.equal(fn(current,name),fn(original,name),'Calculation must remain identical: '+name);
for(const name of ['RFR','RFR_META'])assert.equal(current.match(new RegExp('var '+name+' = ([^;]+);'))[1],original.match(new RegExp('var '+name+' = ([^;]+);'))[1],name+' provenance unchanged');
const manifest=html=>html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1];
assert.equal(manifest(source('index.html')),manifest(git('show',base+':index.html')),'Published data manifest remains byte-identical');
console.log('Owner scope audit: producer/storage/broker source, 17 browser calculators, published manifest and rate provenance match the branch base.');

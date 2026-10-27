// Read-only audit of the actual locally collected financial artifacts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash,quarterlyFacts,finite,FORECAST_MODEL } from '../lib/earnings-forecast.mjs';
import { hasWrittenProfile } from '../lib/earnings-forecast-profiles.mjs';
const dir=process.env.EARNINGS_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url));
const state=JSON.parse(await readFile(resolve(dir,'earnings-forecast-state.json'))),payload=JSON.parse(await readFile(resolve(dir,'earnings-forecast.json')));
const size=state.cohort.size||10,current=payload.companies.filter(c=>!c.former);assert.equal(state.cohort.companies.length,size);assert.equal(current.length,size);
assert.deepEqual(current.map(c=>c.symbol),state.cohort.companies.map(c=>c.symbol));for(const c of payload.companies.filter(c=>c.former))assert(!state.cohort.companies.some(x=>x.symbol===c.symbol),'a former company cannot also be current');
const runIds=new Set(state.runs.map(r=>r.id));assert.equal(runIds.size,state.runs.length);
let sources=0,reconciledAxes=0;
for(const[hash,s]of Object.entries(state.sourceDocuments))if(/^[a-f0-9]{64}$/.test(hash)){
  const raw=JSON.parse(await readFile(resolve(dir,s.key)));assert.equal(contentHash(raw.body),hash);sources++;
}
for(const c of payload.companies){
  const run=state.runs.find(r=>r.id===state.current[c.symbol]);if(!run)continue;
  assert.equal(run.modelVersion,FORECAST_MODEL);const ids=new Set(state.observations[c.symbol].map(o=>o.id));assert(run.sourceIds.every(id=>ids.has(id)),'manifest must reference retained source observations');
  assert.equal(run.inputManifestHash,contentHash(run.sourceIds));assert.deepEqual(c.forecast.outputs,run.outputs);
  const archive=JSON.parse(await readFile(resolve(dir,'earnings-forecast/runs/'+run.id+'.json')));assert.deepEqual(archive,run);
  const q=quarterlyFacts(state.observations[c.symbol],payload.builtAtIso),currency=run.currency;
  for(const axis of [c.mix.product,c.mix.geographic])if(axis&&axis.currency===currency){
    const end=axis.period.currentPeriod.endDate;
    const actual=axis.period.periodType==='annual'?state.observations[c.symbol].filter(o=>o.metric==='revenue'&&o.end===end&&o.currency===currency&&(Date.parse(o.end)-Date.parse(o.start))/86400000>=349).sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||a.priority-b.priority)[0]?.value:q.find(q=>q.end===end)?.metrics.revenue?.value;if(!finite(actual))continue;
    const sum=axis.rows.reduce((v,r)=>v+r.value,0);assert(Math.abs(sum-actual)<=Math.max(1e6,Math.abs(actual)*.01),c.symbol+' mix must reconcile to same-period source revenue');reconciledAxes++;
  }
  if(finite(run.outputs.eps)){const a=run.assumptions,o=run.outputs;assert(Math.abs(o.operatingIncome+a.nonoperating-o.pretaxIncome)<.01);assert(Math.abs(o.pretaxIncome-o.taxes+a.commonIncomeAdjustment-o.netIncome)<.01);assert(Math.abs(o.netIncome/a.dilutedShares-o.eps)<1e-10);}
}
// Companies on the list without a written driver profile fall back to their reported lines.
const missingProfiles=current.filter(c=>!hasWrittenProfile(c.symbol)).map(c=>c.symbol);
const newLines=payload.companies.flatMap(c=>[c.mix?.product,c.mix?.geographic].filter(Boolean).flatMap(a=>a.rows.filter(r=>r.isNew).map(r=>c.symbol+': '+r.name)));
console.log(JSON.stringify({companies:current.map(c=>c.symbol),formerCompanies:payload.companies.filter(c=>c.former).map(c=>c.symbol),cohortSelectedAt:state.cohort.selectedAt,missingProfiles,newRevenueLines:newLines,segmentForecasts:current.filter(c=>finite(c.forecast.segment?.revenue)).length,rankingComplete:state.cohort.complete,verifiedSourceHashes:sources,reconciledDisclosureAxes:reconciledAxes,revenueForecasts:payload.companies.filter(c=>finite(c.forecast.outputs?.revenue)).length,epsForecasts:payload.companies.filter(c=>finite(c.forecast.outputs?.eps)).length,liveResolvedQuarters:state.evaluations.length,cost:payload.cost,note:'Source integrity and accounting consistency only; this does not establish predictive accuracy.'},null,2));

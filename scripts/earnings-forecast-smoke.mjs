import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { earningsFixture } from './fixtures/earnings-forecast.mjs';
import { forecastQuarter,quarterlyFacts,normalizeCompanyFacts,mergeObservations,contentHash,makeObservation,evaluateRuns,selectCohort,scoreRows,reconstructedBacktest,reconcileBusinessMix,COHORT_SIZE,cohortQuarter,cohortDue,acceptCohort,rerankCohort,businessMix } from '../lib/earnings-forecast.mjs';
import { companyProfile,hasWrittenProfile } from '../lib/earnings-forecast-profiles.mjs';
import { earningsScenarioFactory } from '../lib/earnings-forecast-scenarios.mjs';
import { readForecastState,prepareEarningsForecast,writeEarningsForecast,parseTsmRelease } from './refresh-earnings-forecast.mjs';
import { isPremiumKey,roleClaimForKey } from '../lib/premium-keys.mjs';
import { isDynamicBakeKey,isRetainedRemoteBakeKey,isEarningsForecastKey } from '../lib/data-ownership.mjs';
import { hydrationPolicy } from '../lib/data-hydration.mjs';
import { serveDataKey } from '../lib/data-response.mjs';
import { store } from '../lib/datastore.mjs';
import { signSession,SESSION_COOKIE } from '../lib/session.mjs';

let checks=0;const test=(name,fn)=>{fn();checks++;};
const obs=earningsFixture(),cutoffAt='2025-02-15T12:00:00Z',run=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt});
test('financial bridge and negative error sign',()=>{assert.equal(run.status,'ready');assert.equal(run.outputs.revenue,100);assert(Math.abs(run.outputs.eps-2.2)<1e-12);assert.equal(run.target.end,'2025-03-31');assert.equal(98-run.outputs.revenue,-2);});
test('deterministic replay and input manifest',()=>{assert.deepEqual(forecastQuarter({symbol:'TEST',observations:obs,cutoffAt}),run);assert.equal(contentHash({b:2,a:1}),contentHash({a:1,b:2}));assert.equal(run.inputManifestHash,contentHash(run.sourceIds));});
test('operational ingestion cutoff and reconstructed distinction',()=>{const late=obs.map(o=>({...o,firstSeenAt:'2025-03-01T00:00:00Z'}));assert.equal(forecastQuarter({symbol:'TEST',observations:late,cutoffAt}).status,'unavailable');assert.equal(forecastQuarter({symbol:'TEST',observations:late,cutoffAt,mode:'reconstructed'}).outputs.revenue,100);});
test('future revision cannot alter the frozen forecast',()=>{const o=obs.find(o=>o.metric==='revenue');const revision=makeObservation({...o,id:undefined,value:999,filed:'2026-01-01',availableAt:'2026-01-02T00:00:00Z',firstSeenAt:'2026-01-02T00:00:00Z',accession:'revision'});assert.deepEqual(forecastQuarter({symbol:'TEST',observations:[...obs,revision],cutoffAt}),run);assert.equal(run.outputs.revenue,100);});
test('missing taxes and shares withhold EPS rather than create zero',()=>{for(const metric of ['taxes','dilutedShares']){const r=forecastQuarter({symbol:'TEST',observations:obs.filter(o=>o.metric!==metric),cutoffAt});assert.equal(r.outputs.eps,null);assert.equal(r.outputs.revenue,100);}assert.throws(()=>makeObservation({...obs[0],value:null}),/Invalid/);});
test('negative EPS is retained as a valid reported number',()=>{const rows=obs.map(o=>o.metric==='eps'?{...o,value:-2}:o);assert.equal(quarterlyFacts(rows,cutoffAt).at(-1).metrics.eps.value,-2);});
test('dilution and incompatible capital structures fail closed',()=>{const changed=obs.map(o=>o.metric==='dilutedShares'&&o.end==='2024-12-31'?{...o,value:800}:o);assert.equal(forecastQuarter({symbol:'TEST',observations:changed,cutoffAt}).outputs.eps,null);});
test('loss periods do not invent a tax benefit',()=>{const values={operatingIncome:-200,pretaxIncome:-198,netIncome:-202.4,eps:-25.3};const rows=obs.map(o=>o.metric in values?{...o,value:values[o.metric]}:o);const r=forecastQuarter({symbol:'TEST',observations:rows,cutoffAt});assert.equal(r.outputs.taxes,null);assert.equal(r.outputs.eps,null);});
test('fiscal 52/53-week target uses weeks, not calendar quarter labels',()=>{const rows=obs.map(o=>({...o,start:'2024-07-29',end:'2024-10-27'}));const r=forecastQuarter({symbol:'TEST',observations:rows,cutoffAt});assert.equal(r.target.end,'2025-01-26');assert.equal(r.target.calendar,'52/53-week fiscal calendar');});
test('short histories use an explicit run-rate fallback',()=>{const r=forecastQuarter({symbol:'TEST',observations:obs.filter(o=>o.end==='2024-12-31'),cutoffAt});assert.equal(r.outputs.revenue,100);assert.match(r.warnings.join(' '),/run-rate/);assert.equal(r.outputs.eps,null);});
test('a known results release cannot become a new pre-event prediction',()=>{const r=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,reportedPeriodEnd:'2025-03-31'});assert.equal(r.status,'awaiting-source');assert.equal(r.outputs,undefined);});
test('stale financials suppress current forecast values',()=>{const r=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt:'2026-12-01T00:00:00Z'});assert.equal(r.status,'stale');assert(Object.values(r.outputs).every(v=>v===null));});
test('normalization separates durations, units and compatible Q4 dollars',()=>{const row=(start,end,val,accn='annual')=>({start,end,val,accn,form:'10-K',filed:'2025-01-30'});const raw={cik:1,facts:{'us-gaap':{Revenues:{units:{USD:[row('2024-01-01','2024-12-31',400),row('2024-01-01','2024-09-30',300)]}},EarningsPerShareDiluted:{units:{'USD/shares':[row('2024-01-01','2024-12-31',10),row('2024-01-01','2024-09-30',7)]}},WeightedAverageNumberOfDilutedSharesOutstanding:{units:{shares:[row('2024-01-01','2024-12-31',8),row('2024-01-01','2024-09-30',6)]}}}}};const n=normalizeCompanyFacts(raw,{symbol:'TEST',firstSeenAt:cutoffAt,rawHash:'raw'});const q=quarterlyFacts(n.observations,cutoffAt).at(-1);assert.equal(q.metrics.revenue.value,100);assert.equal(q.metrics.eps,undefined);assert.equal(q.metrics.dilutedShares,undefined);assert.equal(q.start,'2024-10-01');const bad=structuredClone(raw);bad.facts['us-gaap'].Revenues.units.USD[1].start='2023-01-01';assert.equal(quarterlyFacts(normalizeCompanyFacts(bad,{symbol:'TEST',firstSeenAt:cutoffAt,rawHash:'bad'}).observations,cutoffAt).length,0);});
test('observation merge is idempotent and preserves first ingestion',()=>{assert.equal(mergeObservations(obs,obs).length,obs.length);const next={...obs[0],firstSeenAt:'2026-01-01T00:00:00Z'};assert.equal(mergeObservations(obs,[next])[0].firstSeenAt,obs[0].firstSeenAt);});
test('actual evaluation requires a post-cutoff, matching basis release',()=>{const incoming=obs.filter(o=>o.end==='2024-03-31').map(o=>makeObservation({...o,start:'2025-01-01',end:'2025-03-31',value:o.metric==='revenue'?98:o.value,filed:'2025-04-30',availableAt:'2025-05-01T00:00:00Z',firstSeenAt:'2025-05-01T01:00:00Z',accession:'actual'}));const scored=evaluateRuns([run],{TEST:[...obs,...incoming]},'2025-06-01T00:00:00Z');assert.equal(scored.find(r=>r.metric==='revenue').error,-2);assert.equal(scored.find(r=>r.metric==='revenue').absoluteError,2);assert.equal(evaluateRuns([run],{TEST:incoming.map(o=>({...o,basis:'adjusted'}))},'2025-06-01T00:00:00Z').length,0);assert.equal(run.outputs.revenue,100);});
test('revenue bias candidate cannot use unreleased results',()=>{const e={symbol:'TEST',model:run.modelVersion,metric:'revenue',kind:'live',actualAvailableAt:'2026-01-01',cutoffAt:'2025-01-01',targetEnd:'2024-12-31',forecast:100,error:100};const r=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,liveEvaluations:[e]});assert.equal(r.candidate.sample,0);assert.equal(r.candidate.biasFraction,0);});
test('learning waits for revenue and matching EPS evidence',()=>{
  const rows=Array.from({length:8},(_,i)=>({id:'e'+i,symbol:'TEST',model:run.modelVersion,metric:'revenue',kind:'live',actualAvailableAt:'2025-01-01',firstSeenAt:'2025-01-02',cutoffAt:'2024-01-01',targetEnd:'2024-'+String(i+1).padStart(2,'0')+'-28',forecast:100,baseForecast:100,error:10,baseError:10,baseAbsoluteError:10,candidateAbsoluteError:2,naiveAbsoluteError:10}));
  const forecast=es=>forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,liveEvaluations:es}),eps=rows.slice(0,4).map(e=>({...e,id:e.id+'eps',metric:'eps'}));
  assert.equal(forecast([...rows.slice(0,7),...eps]).candidate.active,false);assert.equal(forecast(rows).candidate.active,false,'revenue alone cannot promote a supported EPS model');
  const r=forecast([...rows,...eps]);assert.equal(r.candidate.active,true);assert(r.outputs.revenue>100);assert.equal(r.manifest.trainingEvaluationIds.length,8);
  assert.equal(forecast([...rows,...eps.map(e=>({...e,targetEnd:'2023'+e.targetEnd.slice(4)}))]).candidate.active,false,'unmatched EPS quarters do not count');
  assert.equal(forecast(rows.map(e=>({...e,firstSeenAt:'2026-01-01'}))).candidate.sample,0);
});
test('same-end incompatible duration or accounting basis never supplies a bridge',()=>{
  const rows=obs.filter(o=>!['taxes','grossProfit'].includes(o.metric));
  const wrong=obs.filter(o=>['taxes','grossProfit'].includes(o.metric)).map(o=>({...o,...(o.metric==='taxes'?{start:o.start.slice(0,4)+'-01-01'}:{basis:'Adjusted'})}));
  const q=quarterlyFacts([...rows,...wrong],cutoffAt).find(q=>q.end==='2024-09-30');assert.equal(q.metrics.taxes,undefined);assert.equal(q.metrics.grossProfit,undefined);
});
test('loss common income also withholds candidate EPS',()=>{
  const values={netIncome:-7.4,eps:-.925},r=forecastQuarter({symbol:'TEST',observations:obs.map(o=>o.metric in values?{...o,value:values[o.metric]}:o),cutoffAt});
  assert.equal(r.outputs.eps,null);assert.equal(r.candidate.eps,null);assert.equal(r.comparison.baseEps,null);
});
test('a reporting-basis change cannot borrow growth or margins from old quarters',()=>{
  const changed=obs.map(o=>o.end==='2024-12-31'?{...o,basis:'New reporting basis'}:o),r=forecastQuarter({symbol:'TEST',observations:changed,cutoffAt});
  assert.equal(r.assumptions.growthSample,0);assert.match(r.assumptions.growthRule,/run-rate/);assert.equal(r.outputs.eps,null,'new basis has insufficient bridge history');
});
const scenarioApi=earningsScenarioFactory(),sc={symbol:'TEST',forecast:run,mix:{}};
sc.mix=reconcileBusinessMix({product:{rows:[{name:'Products',value:60},{name:'Services',value:40}],period:{periodType:'quarter',currentPeriod:{endDate:'2024-12-31'}},currency:'USD'},geographic:{rows:[{name:'Home',value:25},{name:'Abroad',value:75}],period:{periodType:'quarter',currentPeriod:{endDate:'2024-12-31'}},currency:'USD'}},obs,cutoffAt,'USD');
test('all default mixes reproduce frozen bridge without mutation',()=>{const before=structuredClone(sc);for(const axis of ['consolidated','product','geographic','custom']){const d=scenarioApi.defaults(sc);d.axis=axis;const r=scenarioApi.calculate(sc,d);assert.deepEqual(r.errors,[]);for(const k of Object.keys(run.outputs))assert(Math.abs(r.outputs[k]-run.outputs[k])<1e-10,k+' matches base');}assert.deepEqual(sc,before);});
test('mix shocks compound within one axis and produce weighted margins',()=>{const d=scenarioApi.defaults(sc);d.axis='product';d.revenueDelta=10;d.splits.product[0].demand=20;d.splits.product[0].price=10;d.splits.product[0].margin=30;d.splits.product[1].margin=10;const r=scenarioApi.calculate(sc,d);assert.deepEqual(r.errors,[]);assert(Math.abs(r.outputs.revenue-131.12)<1e-10);assert(Math.abs(r.outputs.operatingIncome-30.536)<1e-10);assert(Math.abs(r.rows.reduce((v,r)=>v+r.resultShare,0)-1)<1e-12);d.splits.geographic[0].demand=500;assert.equal(scenarioApi.calculate(sc,d).outputs.revenue,r.outputs.revenue,'inactive region mix never compounds');});
test('incomplete weights, missing globals, excessive margins and zero shares fail honestly',()=>{let d=scenarioApi.defaults(sc);d.axis='custom';d.splits.custom[0].weight=40;assert.match(scenarioApi.calculate(sc,d).errors.join(' '),/100%/);d=scenarioApi.defaults(sc);d.taxRate=null;assert.equal(scenarioApi.calculate(sc,d).outputs.eps,null);d.operatingMargin=80;assert.match(scenarioApi.calculate(sc,d).errors.join(' '),/exceeds gross/);d=scenarioApi.defaults(sc);d.dilutedShares=0;assert(scenarioApi.calculate(sc,d).errors.length);d=scenarioApi.defaults(sc);d.revenueDelta=null;assert(scenarioApi.calculate(sc,d).errors.length);});
test('scenario loss and unsupported base EPS cannot be unlocked manually',()=>{const d=scenarioApi.defaults(sc);d.commonIncomeAdjustment=-.001;assert.equal(scenarioApi.calculate(sc,d).outputs.eps,null);d.operatingMargin=-10;assert.equal(scenarioApi.calculate(sc,d).outputs.taxes,null);const unsupported={...sc,forecast:{...run,outputs:{...run.outputs,eps:null,netIncome:null}}};assert.equal(scenarioApi.calculate(unsupported,scenarioApi.defaults(unsupported)).outputs.eps,null);});
test('disclosure currency, period and reconciliation gate reported starting mixes',()=>{
  const invalid=structuredClone(sc);invalid.mix.product.currency='TWD';assert.equal(scenarioApi.mix(invalid,'product'),null);
  const bad=reconcileBusinessMix({...sc.mix,product:{...sc.mix.product,rows:[{name:'Wrong total',value:20}]}},obs,cutoffAt,'USD');assert.equal(bad.product.reconciliation.status,'unverified');
  const annual=makeObservation({...obs[0],start:'2024-01-01',end:'2024-12-31',value:400});
  const m={...sc.mix,product:{...sc.mix.product,rows:[{name:'Annual',value:400}],period:{periodType:'annual',currentPeriod:{endDate:'2024-12-31'}}}};
  assert.equal(reconcileBusinessMix(m,[...obs,annual],cutoffAt,'USD').product.reconciliation.status,'matched');
  assert.equal(reconcileBusinessMix(m,obs,cutoffAt,'USD').product.reconciliation.status,'unverified','annual disclosure cannot reconcile against Q4 alone');
});
test('scenario export/import requires exact company forecast and disclosure basis',()=>{const d=scenarioApi.defaults(sc);d.axis='product';d.name='Upside';d.splits.product[0].demand=10;const j=scenarioApi.pack(sc,d);assert.deepEqual(scenarioApi.unpack(sc,j),d);j.results.revenue=999;assert.equal(scenarioApi.calculate(sc,scenarioApi.unpack(sc,j)).outputs.revenue,106,'import recalculates, never trusts file outputs');assert.throws(()=>scenarioApi.unpack({...sc,symbol:'OTHER'},j),/different company/);const changed=structuredClone(sc);changed.mix.product.period.currentPeriod.endDate='2025-03-31';assert.throws(()=>scenarioApi.unpack(changed,j),/snapshot/);j.assumptions.splits.product[0].name='Forged';assert.throws(()=>scenarioApi.unpack(sc,j),/source snapshot/);});
test('forecast horizons do not multiply realized sample counts',()=>{const row={symbol:'TEST',targetEnd:'2025-03-31',metric:'revenue',cutoffAt:'2025-02-01',forecast:100,actual:98,error:-2,absoluteError:2,naiveAbsoluteError:2};assert.equal(scoreRows([row,{...row,cutoffAt:'2025-02-02'}]).revenue.n,1);});
test('reconstructed scores are explicitly separate and finite',()=>{const b=reconstructedBacktest('TEST',obs,cutoffAt);assert.equal(b.kind,'reconstructed');assert.match(b.label,/not live/);assert(b.rows.length>0);assert(b.rows.every(r=>Number.isFinite(r.error)));assert.equal(b.horizons.length,4);});
test('ranking excludes ETFs, sorts caps, and reports missing coverage',()=>{const universe=Array.from({length:25},(_,i)=>'S'+i),chains=Object.fromEntries(universe.map((s,i)=>[s,{fundamentals:{marketCap:i+1,name:s}}]));chains.ETF={fundamentals:{marketCap:1e20}};const c=selectCohort(chains,[...universe,'ETF','MISSING'],{ETF:'ETF'},cutoffAt);assert.equal(c.companies[0].symbol,'S24');assert.equal(c.companies.length,COHORT_SIZE);assert.equal(COHORT_SIZE,20);assert.equal(c.companies.at(-1).rank,20);assert.deepEqual(c.missing,['MISSING']);assert.equal(c.complete,false);assert.equal(selectCohort(chains,universe,{},cutoffAt,10).companies.length,10);});
test('the list re-ranks once a calendar quarter and keeps leavers',()=>{
  const universe=Array.from({length:22},(_,i)=>'S'+i),caps=(big)=>Object.fromEntries(universe.map((s,i)=>[s,{fundamentals:{marketCap:s===big?1e9:100-i,name:s}}]));
  const first=selectCohort(caps(null),universe,{},'2025-02-15T12:00:00Z');
  assert.equal(cohortQuarter('2025-02-15T12:00:00Z'),'2025-Q1');assert(!cohortDue(first,'2025-03-31T20:00:00Z'));assert(cohortDue(first,'2025-04-01T14:00:00Z'));assert(cohortDue({...first,companies:first.companies.slice(0,10)},'2025-02-16T00:00:00Z'),'a 10-name list grows to 20 at once');
  const state={cohort:first};const next=selectCohort(caps('S21'),universe,{},'2025-04-01T14:00:00Z');assert(acceptCohort(first,next,'2025-04-01T14:00:00Z'));
  const moved=rerankCohort(state,next,'2025-04-01T14:00:00Z');assert.deepEqual(moved,{joined:['S21'],left:['S19']});assert.equal(state.former.S19.leftAt,'2025-04-01T14:00:00Z');assert.equal(state.joined.S21,'2025-04-01T14:00:00Z');assert.equal(state.cohortHistory.at(-1).quarter,'2025-Q2');
  const incomplete={...selectCohort(caps(null),[...universe,'NOCAP'],{},'2025-04-02T14:00:00Z')};assert(!acceptCohort(first,incomplete,'2025-04-02T14:00:00Z'),'missing caps wait early in the quarter');assert(acceptCohort(first,incomplete,'2025-04-20T14:00:00Z'),'but not forever');
  rerankCohort(state,selectCohort(caps(null),universe,{},'2025-07-01T14:00:00Z'),'2025-07-01T14:00:00Z');assert.equal(state.former.S19,undefined,'a returning company is current again');assert(state.former.S21);
});
test('new revenue lines are flagged, a relabelled breakdown is not',()=>{
  const period={periodType:'quarter',currentPeriod:{endDate:'2024-12-31'},previousPeriod:{endDate:'2023-12-31'}};
  const m=businessMix({segments:{product:[{name:'Core',value:90,previousValue:80},{name:'AI',value:10,previousValue:null},{name:'Other',value:1,previousValue:null}],productPeriod:period,currency:'USD'}});
  assert.deepEqual(m.product.rows.map(r=>r.isNew),[false,true,false]);
  assert(businessMix({segments:{product:[{name:'A',value:1},{name:'B',value:1}],productPeriod:period,currency:'USD'}}).product.rows.every(r=>!r.isNew));
  assert(businessMix({segments:{product:[{name:'A',value:1},{name:'B',value:1}],productPeriod:{...period,previousPeriod:null},currency:'USD'}}).product.rows.every(r=>!r.isNew));
});
test('companies without a written profile get prompts from reported lines',()=>{
  assert.equal(companyProfile('AAPL').source,'written');assert(hasWrittenProfile('NVDA'));
  const p=companyProfile('NEWCO',{product:{rows:[{name:'Cloud',value:60,previousValue:40},{name:'AI',value:10,previousValue:null,isNew:true},{name:'Other',value:30}],period:{currentPeriod:{endDate:'2024-12-31'}}},geographic:{rows:[{name:'US',value:70},{name:'Asia',value:30}],period:{currentPeriod:{endDate:'2024-12-31'}}}});
  assert.equal(p.source,'reported-lines');assert.deepEqual(p.drivers.map(d=>d.exposure),['Cloud','AI','US','Asia']);assert.match(p.drivers[0].rationale,/60% .*\+50%/);assert.match(p.drivers[1].name,/new line/);assert(p.drivers.every(d=>d.numericalEffect===null));
  assert.equal(companyProfile('NEWCO').source,'none');
});
const segmentMix={rows:[{name:'Growing',value:70,previousValue:50},{name:'Shrinking',value:30,previousValue:50}],period:{periodType:'quarter',currentPeriod:{endDate:'2024-12-31'},previousPeriod:{endDate:'2023-12-31'}},currency:'USD',filed:'2025-01-30'};
test('business-line model stays in shadow and leaves the base forecast alone',()=>{
  const r=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix});
  assert.equal(r.outputs.revenue,100);assert(Math.abs(r.segment.growth-.16)<1e-12);assert(Math.abs(r.segment.revenue-116)<1e-9);assert.equal(r.segment.active,false);assert.notEqual(r.inputKey,run.inputKey);
  assert.equal(forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix:null}).inputKey,run.inputKey,'no segment input keeps the original key');assert.equal(run.segment,null);
  for(const bad of [{...segmentMix,filed:'2025-03-01'},{...segmentMix,currency:'TWD'},{...segmentMix,period:{...segmentMix.period,periodType:'annual'}},{...segmentMix,rows:[{name:'Growing',value:50,previousValue:50},{name:'Shrinking',value:30,previousValue:50}]},{...segmentMix,period:{...segmentMix.period,previousPeriod:{endDate:'2024-09-30'}}}])assert.equal(forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix:bad}).segment,null);
  const fresh=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix:{...segmentMix,rows:[{name:'Growing',value:60,previousValue:50},{name:'Shrinking',value:30,previousValue:50},{name:'Brand new',value:10,previousValue:null,isNew:true}]}});
  assert.deepEqual(fresh.segment.newLines,['Brand new']);assert(Math.abs(fresh.segment.newShare-.1)<1e-12);assert.match(fresh.warnings.join(' '),/New revenue line since the prior-year quarter: Brand new/);
});
test('business-line model is scored and promoted only through the forward gate',()=>{
  const live=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix});
  const incoming=obs.filter(o=>o.end==='2024-03-31').map(o=>makeObservation({...o,start:'2025-01-01',end:'2025-03-31',value:o.metric==='revenue'?115:o.value,filed:'2025-04-30',availableAt:'2025-05-01T00:00:00Z',firstSeenAt:'2025-05-01T01:00:00Z',accession:'actual'}));
  const scored=evaluateRuns([live],{TEST:[...obs,...incoming]},'2025-06-01T00:00:00Z').find(r=>r.metric==='revenue');assert(Math.abs(scored.segmentAbsoluteError-1)<1e-9);assert.equal(scored.baseAbsoluteError,15);
  const rows=Array.from({length:8},(_,i)=>({id:'s'+i,symbol:'TEST',model:run.modelVersion,metric:'revenue',kind:'live',actualAvailableAt:'2025-01-01',firstSeenAt:'2025-01-02',cutoffAt:'2024-01-01',targetEnd:'2024-'+String(i+1).padStart(2,'0')+'-28',forecast:100,error:10,baseAbsoluteError:10,naiveAbsoluteError:10,segmentAbsoluteError:2}));
  const eps=rows.slice(0,4).map(e=>({...e,id:e.id+'eps',metric:'eps'}));
  assert.equal(forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix,liveEvaluations:rows.slice(0,7)}).segment.active,false);
  assert.equal(forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix,liveEvaluations:rows}).segment.active,false,'a supported EPS bridge also needs EPS checks');
  const promoted=forecastQuarter({symbol:'TEST',observations:obs,cutoffAt,segmentMix,liveEvaluations:[...rows,...eps]});assert.equal(promoted.segment.active,true);assert(Math.abs(promoted.outputs.revenue-116)<1e-9);assert.equal(promoted.manifest.segmentEvaluationIds.length,12);
});
test('whole namespace owner-gated and immutable keys retained',()=>{for(const key of ['earnings-forecast.json','earnings-forecast-state.json','earnings-forecast/bad.json','earnings-forecast/runs/'+ 'a'.repeat(64)+'.json']){assert(isPremiumKey(key));assert.deepEqual(roleClaimForKey(key),['tr','tp']);assert(isEarningsForecastKey(key));assert(!isDynamicBakeKey(key));}const key='earnings-forecast/sources/'+'a'.repeat(64)+'.json';assert(isRetainedRemoteBakeKey(key));assert(!hydrationPolicy()(key));assert(hydrationPolicy({includeArchives:true})(key));assert(!hydrationPolicy({owner:'transcripts',includeArchives:true})(key));});
const previousFlag=process.env.PRIVATE_DATA_ENABLED;process.env.PRIVATE_DATA_ENABLED='1';
for(const key of ['earnings-forecast.json','earnings-forecast-state.json','earnings-forecast/unknown.json']){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await serveDataKey({headers:{}},res,key);assert.equal(res.statusCode,401);assert.equal(res.headers['Cache-Control'],'private, no-store');checks++;}
if(previousFlag===undefined)delete process.env.PRIVATE_DATA_ENABLED;else process.env.PRIVATE_DATA_ENABLED=previousFlag;
const priorSecret=process.env.SESSION_SECRET,priorRead=store.get;process.env.SESSION_SECRET='offline-earnings-forecast-session-test-key';process.env.PRIVATE_DATA_ENABLED='1';let reads=0;
try{
  store.get=async()=>{reads++;return Buffer.from('{"privateForecast":true}');};
  for(const claims of [{tr:true},{tp:true},{tr:true,tp:true}]){
    const token=await signSession(claims),res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(v){this.body=v;}};
    const before=reads;await serveDataKey({headers:{cookie:SESSION_COOKIE+'='+token}},res,'earnings-forecast.json');
    assert.equal(res.statusCode,claims.tr&&claims.tp?200:401);assert.equal(reads-before,claims.tr&&claims.tp?1:0);assert.equal(res.headers['Cache-Control'],'private, no-store');checks++;
  }
}finally{store.get=priorRead;if(priorSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=priorSecret;if(previousFlag===undefined)delete process.env.PRIVATE_DATA_ENABLED;else process.env.PRIVATE_DATA_ENABLED=previousFlag;}
const dir=await mkdtemp(resolve(tmpdir(),'earnings-forecast-test-')),state=await readForecastState(dir);
const symbols=Array.from({length:10},(_,i)=>'T'+i),chains=Object.fromEntries(symbols.map((s,i)=>[s,{fundamentals:{marketCap:1000-i,name:s}}]));
state.cohort=selectCohort(chains,symbols,{},cutoffAt);for(const s of symbols)state.observations[s]=earningsFixture(s);
const prepared=await prepareEarningsForecast({previous:state,chains,universe:symbols,sectors:{},cikMap:new Map(),fetchImpl:()=>{throw Error('Offline tests must not contact a provider');},now:()=>cutoffAt});
assert.equal(prepared.payload.companies.length,10);assert.equal(prepared.payload.cost.requestsThisRun,0);assert.equal(prepared.state.runs.length,10);checks++;
await writeEarningsForecast({dataDir:dir,prepared});const before=await readFile(resolve(dir,'earnings-forecast-state.json'),'utf8');
await Promise.all([writeEarningsForecast({dataDir:dir,prepared}),writeEarningsForecast({dataDir:dir,prepared})]);assert.equal(await readFile(resolve(dir,'earnings-forecast-state.json'),'utf8'),before);checks++;
const collisionDir=await mkdtemp(resolve(tmpdir(),'earnings-forecast-race-'));await Promise.all([writeEarningsForecast({dataDir:collisionDir,prepared}),writeEarningsForecast({dataDir:collisionDir,prepared})]);assert.equal((await readForecastState(collisionDir)).runs.length,10);checks++;
const again=await prepareEarningsForecast({previous:prepared.state,chains,universe:symbols,sectors:{},cikMap:new Map(),now:()=>cutoffAt});assert.equal(again.state.runs.length,10);assert.equal(again.artifacts.size,0);checks++;
const later=await prepareEarningsForecast({previous:prepared.state,chains:{...chains,T0:{fundamentals:{name:'T0',marketCap:1}}},universe:symbols,sectors:{},cikMap:new Map(),now:()=>'2025-02-16T12:00:00Z'});assert.equal(later.state.runs.length,10);assert.equal(later.payload.companies[0].symbol,'T0');assert.equal(later.payload.companies[0].forecast.cutoffAt,cutoffAt);checks++;
const retry=await prepareEarningsForecast({previous:state,chains,universe:symbols,sectors:{},cikMap:new Map(),now:()=>'2025-02-16T12:00:00Z'});assert.notEqual(retry.state.runs[0].id,prepared.state.runs[0].id);await writeEarningsForecast({dataDir:collisionDir,prepared:retry});assert.equal((await readForecastState(collisionDir)).runs.length,10);checks++;
const cached=structuredClone(prepared.state);for(const [i,s]of symbols.entries())cached.sourceStatus[s]={issuerId:String(i+1).padStart(10,'0'),rawHash:'cached',accessions:null,checkedAt:cutoffAt};
let requests=0;const warm=await prepareEarningsForecast({previous:cached,chains,universe:symbols,sectors:{},now:()=>cutoffAt,fetchImpl:()=>{requests++;throw Error('Warm refresh must not download');}});assert.equal(requests,0);assert.equal(warm.payload.cost.requestsThisRun,0);checks++;
const limited=structuredClone(cached);for(const s of symbols)limited.sourceStatus[s].checkedAt='2020-01-01T00:00:00Z';const held=await prepareEarningsForecast({previous:limited,chains,universe:symbols,sectors:{},now:()=>cutoffAt,maxRequests:0,fetchImpl:()=>{throw Error('Limit must stop network');}});assert.equal(held.payload.cost.requestsThisRun,0);assert.equal(held.state.observations.T0.length,cached.observations.T0.length);assert.match(held.state.sourceStatus.T0.error,/limit/);checks++;
const disabled=await prepareEarningsForecast({previous:prepared.state,chains,universe:symbols,sectors:{},enabled:false,fetchImpl:()=>{throw Error('Disabled must not fetch');},now:()=>cutoffAt});assert.equal(disabled.payload.enabled,false);checks++;
{
  // A quarter later the list re-ranks: one name joins, one leaves with its frozen forecast.
  const names=Array.from({length:22},(_,i)=>'R'+i),caps=big=>Object.fromEntries(names.map((s,i)=>[s,{fundamentals:{name:s,marketCap:s===big?1e6:1000-i}}]));
  const base=await readForecastState(await mkdtemp(resolve(tmpdir(),'earnings-forecast-rerank-')));for(const s of names)base.observations[s]=earningsFixture(s);base.mix.R0={product:segmentMix,geographic:null,filed:'2025-01-30'};
  const q1=await prepareEarningsForecast({previous:base,chains:caps(null),universe:names,sectors:{},cikMap:new Map(),now:()=>cutoffAt});
  assert.equal(q1.payload.companies.length,20);assert.equal(q1.state.runs.length,20);assert(q1.payload.companies.every(c=>!c.former&&!c.joinedAt));assert(Math.abs(q1.payload.companies[0].forecast.segment.revenue-116)<1e-9,'state mix feeds the business-line model');
  const frozen=q1.state.runs.find(r=>r.symbol==='R19');
  const q2=await prepareEarningsForecast({previous:q1.state,chains:caps('R21'),universe:names,sectors:{},cikMap:new Map(),now:()=>'2025-04-02T14:00:00Z'});
  const current=q2.payload.companies.filter(c=>!c.former),left=q2.payload.companies.filter(c=>c.former);
  assert.equal(current.length,20);assert.equal(current[0].symbol,'R21');assert.equal(current[0].joinedAt,'2025-04-02T14:00:00Z');assert.deepEqual(left.map(c=>c.symbol),['R19']);
  assert.equal(left[0].forecast.id,frozen.id,'a leaver shows its frozen forecast');assert.match(left[0].forecast.warnings[0],/Left the top 20 on 2025-04-02/);
  assert(!q2.state.runs.some(r=>r.symbol==='R19'&&r.id!==frozen.id),'no new forecast after leaving');assert(q2.state.runs.some(r=>r.symbol==='R21'));
  assert.deepEqual(q2.payload.cohortHistory.at(-1),{at:'2025-04-02T14:00:00Z',quarter:'2025-Q2',size:20,joined:['R21'],left:['R19']});
  checks++;
}
{
  // Segment parser: new small lines stay out of "Other"; company-specific axes are a reconciled last resort.
  const {buildSegmentSlices,pickBestAxisBreakdownByPeriod,PRODUCT_AXES_PRIORITY,GEOGRAPHIC_AXES_PRIORITY,COMPANY_PRODUCT_AXIS,COMPANY_GEOGRAPHIC_AXIS}=await import('./build.mjs');
  const cur=new Map([['A',50],['B',20],['C',10],['D',8],['E',5],['F',3],['G',2.5],['H',1.2],['I',.2],['Tiny new',.1]]),prev=new Map([['A',40],['B',20],['C',10],['D',8],['E',5],['F',3],['G',2],['H',1],['I',.3]]);
  const slices=buildSegmentSlices(cur,prev);assert.deepEqual(slices.find(r=>r.name==='Tiny new'),{name:'Tiny new',value:.1,previousValue:null,isNew:true});assert.equal(slices.find(r=>r.name==='A').isNew,false);assert.equal(slices.at(-1).name,'Other');
  assert(buildSegmentSlices(new Map([['X',1],['Y',1]]),new Map([['P',1]])).every(r=>r.isNew===undefined),'relabelled breakdown has no new lines');
  const ctx=(id,dims)=>[id,{dims,periodStart:'2024-10-01',periodEnd:'2024-12-31'}],fact=(contextRef,value)=>({contextRef,value});
  const contexts=new Map([ctx('c1',[{axis:'acme:RevenueStreamAxis',member:'acme:CloudMember'}]),ctx('c2',[{axis:'acme:RevenueStreamAxis',member:'acme:AdsMember'}]),ctx('g1',[{axis:'acme:SalesRegionAxis',member:'acme:AmericasMember'}]),ctx('g2',[{axis:'acme:SalesRegionAxis',member:'acme:AsiaMember'}])]);
  const facts=[fact('c1',60),fact('c2',40),fact('g1',70),fact('g2',30)],totals=new Map([['2024-12-31',100]]),all=()=>true;
  const product=pickBestAxisBreakdownByPeriod(facts,contexts,PRODUCT_AXES_PRIORITY,all,totals,{rejectGeographic:true,companyAxisPattern:COMPANY_PRODUCT_AXIS});
  assert.deepEqual([...product.get('2024-12-31').entries()],[['Cloud',60],['Ads',40]]);
  assert.deepEqual([...pickBestAxisBreakdownByPeriod(facts,contexts,GEOGRAPHIC_AXES_PRIORITY,all,totals,{companyAxisPattern:COMPANY_GEOGRAPHIC_AXIS}).get('2024-12-31').keys()],['Americas','Asia']);
  assert.equal(pickBestAxisBreakdownByPeriod(facts,contexts,PRODUCT_AXES_PRIORITY,all,new Map([['2024-12-31',130]]),{rejectGeographic:true,companyAxisPattern:COMPANY_PRODUCT_AXIS}),null,'a custom axis that does not add up is ignored');
  assert.equal(pickBestAxisBreakdownByPeriod(facts,contexts,PRODUCT_AXES_PRIORITY,all,totals,{rejectGeographic:true}),null,'no pattern, no fallback');
  checks++;
}
const html='<p>TIFRS (Unit: NT$ million, except for EPS) 3Q26 Amount</p><table><tr><td>Net sales</td><td>1,494,243</td><td>989,918</td><td>50.9</td><td>1,270,381</td><td>17.6</td></tr><tr><td>EPS (NT$)</td><td>29.43 b</td><td>17.44 c</td><td>68.7</td><td>27.25 b</td><td>8.0</td></tr></table>';
const tsm=parseTsmRelease(html,{url:'https://www.sec.gov/example',accession:'tsm',filed:'2026-10-15',firstSeenAt:'2026-10-26T00:00:00Z',rawHash:'hash'});assert.equal(tsm.find(o=>o.metric==='revenue'&&o.end==='2026-09-30').value,1494243e6);assert.equal(tsm.find(o=>o.metric==='eps').unit,'TWD/shares');assert.throws(()=>parseTsmRelease(html.replace('NT$ million','USD billion'),{firstSeenAt:cutoffAt}),/Unsupported/);checks++;
await writeFile(resolve(dir,'earnings-forecast-state.json'),'{bad');await assert.rejects(readForecastState(dir));checks++;
const stage=await mkdtemp(resolve(tmpdir(),'earnings-forecast-stage-'));await mkdir(resolve(stage,'data/earnings-forecast/runs'),{recursive:true});
for(const f of ['public.json','earnings-forecast.json','earnings-forecast-state.json','earnings-forecast/runs/'+ 'a'.repeat(64)+'.json'])await writeFile(resolve(stage,'data',f),'{}');
execFileSync('git',['init','-q'],{cwd:stage});const excludes=[':!data/earnings-forecast.json',':!data/earnings-forecast-state.json',':!data/earnings-forecast/**'];execFileSync('git',['add','-f','--','data',...excludes],{cwd:stage});assert.equal(execFileSync('git',['diff','--cached','--name-only'],{cwd:stage,encoding:'utf8'}).trim(),'data/public.json');
const workflow=await readFile(new URL('../.github/workflows/daily.yml',import.meta.url),'utf8');for(const e of excludes)assert(workflow.includes(e));checks++;
console.log(`Earnings Forecast: ${checks} groups passed: normalization, fiscal periods, provenance, immutability/retries, financial bridge, withholding, as-of replay, actuals, learning isolation, cohort selection, native TWD, private responses and zero-provider offline integration.`);

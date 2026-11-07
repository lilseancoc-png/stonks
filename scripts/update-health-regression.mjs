// Offline replay of the November 2 status warnings. No provider, AI, storage
// or broker requests. Run with npm run test:update-health.
import assert from 'node:assert/strict';
import { UPDATE_FEATURES, inspectFeature, checkFeatureCadence } from '../lib/update-checker.mjs';
import { collectBriefSiteTools, fetchNasdaqEarningsSessions, fetchForexFactoryCalendar } from './build.mjs';
import { buildOwnerMarketBrief, sourceStatus } from '../lib/owner-market-brief.mjs';
import { fixtureReport } from './fixtures/update-checker.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';
import { calendarSourceLabel } from '../lib/calendar-policy.mjs';

const now = new Date('2026-11-02T20:17:00Z');
const morning = '2026-11-02T16:04:51.941Z';
const report = fixtureReport(true);
report.runs[0].createdAt = '2026-11-02T18:30:10Z';
const specs = ['picks', 'open-picks', 'track'].map(id=>UPDATE_FEATURES.find(s=>s.id===id));
const cache = new Map(specs.map(s=>[s.key, Promise.resolve({payload:{builtAtIso:morning}})]));
const cadence = async at => checkFeatureCadence(specs.map(s=>({...s,status:'available',asOf:morning})),cache,report,at);
assert((await cadence(now.getTime())).every(s=>s.status==='available'), '13:30 build carries the 11:00 trade records');
assert((await cadence(Date.parse('2026-11-02T21:20:00Z'))).every(s=>s.status==='stale'), 'a missed 15:30 trade refresh must still alert');

const weekly = {builtAtIso:'2026-10-30T20:00:04.352Z',stale:false};
const scan = await collectBriefSiteTools({now,dataDir:'/nonexistent-update-health-fixture',narratives:[],payloads:{ram:weekly,accelerators:weekly}});
assert(scan.checked.includes('RAM prices') && scan.checked.includes('GPU cloud prices'), 'Friday weekly prices remain usable on Monday');
const owner = buildOwnerMarketBrief({builtAtIso:now.toISOString(),publicScan:scan});
assert(owner.coverage.filter(s=>['RAM prices','GPU cloud prices'].includes(s.label)).every(s=>s.status==='available' && s.asOf===weekly.builtAtIso));
const expired = await collectBriefSiteTools({now,dataDir:'/nonexistent-update-health-fixture',payloads:{ram:{...weekly,builtAtIso:'2026-10-20T20:00:00Z'},accelerators:{...weekly,stale:true}}});
assert(expired.missing.includes('RAM prices') && expired.missing.includes('GPU cloud prices'), 'old or explicitly stale weekly data remains excluded');
const expiredOwner = buildOwnerMarketBrief({builtAtIso:now.toISOString(),publicScan:expired});
assert.equal(expiredOwner.coverage.find(s=>s.label==='RAM prices').status,'stale');
assert.equal(expiredOwner.coverage.find(s=>s.label==='RAM prices').asOf,'2026-10-20T20:00:00Z');

const originalFetch = globalThis.fetch;
try {
  const noRecords = {data:null,status:{rCode:200,bCodeMessage:[{code:1002,errorMessage:'Earnings Calendar: No record found.'}]}};
  globalThis.fetch = async () => new Response(JSON.stringify(noRecords));
  const empty = await fetchNasdaqEarningsSessions(Date.parse('2026-12-23'),0,['2026-12-23']);
  assert.equal(empty.coverage.status,'ok'); assert.equal(empty.size,0);
  for (const payload of [{data:null},{...noRecords,status:{...noRecords.status,rCode:500}},{...noRecords,status:{rCode:200,bCodeMessage:[{code:999,errorMessage:'Unavailable'}]}}]) {
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    assert.equal((await fetchNasdaqEarningsSessions(Date.parse('2026-12-23'),0,['2026-12-23'])).coverage.status,'unavailable', 'unknown null response cannot masquerade as empty');
  }
  const asked=[];
  globalThis.fetch = async url => {asked.push(String(url));return new Response(JSON.stringify({data:{rows:[]}}));};
  const holiday = await fetchNasdaqEarningsSessions(Date.parse('2026-11-26T12:00:00Z'),2,['2026-12-25']);
  assert.deepEqual(asked.map(u=>u.slice(-10)),['2026-11-27'],'market holidays are not requested');
  assert.equal(holiday.coverage.status,'ok','a holiday cannot make the earnings lookup incomplete');
  const urls=[];
  const rows=[{title:'Unemployment Claims',country:'USD',date:'2026-11-05T08:30:00-05:00',forecast:'200K'}];
  const ff = await fetchForexFactoryCalendar(async url=>{urls.push(url);return new Response(JSON.stringify(rows));});
  assert.deepEqual(urls,['https://nfs.faireconomy.media/ff_calendar_thisweek.json'], 'use the publisher-linked weekly export only');
  assert.equal(ff.sourceStatus.forexFactory,'ok');assert.equal(ff.length,1);
  for (const response of [new Response('offline',{status:503}),new Response('{}'),new Response('[]')]) {
    assert.equal((await fetchForexFactoryCalendar(async()=>response)).sourceStatus.forexFactory,'unavailable', 'actual weekly export failures remain visible');
  }
} finally {globalThis.fetch=originalFetch;}

const calendar=UPDATE_FEATURES.find(s=>s.id==='calendar');
const cal=inspectFeature(calendar,{builtAtIso:now.toISOString(),events:[],coverage:{officialSources:{'ism-2026':false}}},now.getTime());
assert.equal(cal.status,'degraded');assert.match(cal.detail,/ISM/);
assert(!inspectFeature(calendar,{builtAtIso:now.toISOString(),events:[],coverage:{officialSources:{PRIVATE_SENTINEL:false}}},now.getTime()).detail.includes('PRIVATE_SENTINEL'));
const news=UPDATE_FEATURES.find(s=>s.id==='news');
const feed=inspectFeature(news,{builtAtIso:now.toISOString(),sourceHealth:[{id:'ir-amd',label:'PRIVATE_SENTINEL',status:'error',error:'HTTP 403 PRIVATE_SENTINEL'}]},now.getTime());
assert.equal(feed.status,'degraded');assert.match(feed.detail,/AMD.*403/);assert(!feed.detail.includes('PRIVATE_SENTINEL'));
const brief=UPDATE_FEATURES.find(s=>s.id==='owner-market-brief');
const warning=inspectFeature(brief,{builtAtIso:now.toISOString(),coverage:[{key:'ram-prices.json',label:'RAM prices',status:'stale'}]},now.getTime());
assert.equal(warning.status,'degraded');assert.match(warning.detail,/Memory chip prices/);
const privateWarning=inspectFeature(brief,{builtAtIso:now.toISOString(),coverage:[{label:'PRIVATE_SENTINEL',status:'missing'}]},now.getTime());
assert(!privateWarning.detail.includes('PRIVATE_SENTINEL'));
// A failed producer may still write a fresh envelope. All consumers must
// withhold its facts and preserve the failure without echoing private text.
const pattern=UPDATE_FEATURES.find(s=>s.id==='pattern-lab');
for (const failure of [{error:'PRIVATE_SENTINEL'},{errors:['PRIVATE_SENTINEL']},{errors:{fetch:1}},{status:'degraded'},{coverage:{complete:false}}]) {
  const payload={builtAtIso:now.toISOString(),...failure};
  const result=inspectFeature(pattern,payload,now.getTime());
  assert.equal(result.status,'degraded','fresh producer failure cannot be healthy');
  assert(!result.detail.includes('PRIVATE_SENTINEL'));
  assert.equal(sourceStatus(payload,now.getTime()).status,'degraded','Owner Brief withholds failed source desks');
  const failedScan=await collectBriefSiteTools({now,dataDir:'/nonexistent-update-health-fixture',payloads:{ram:payload}});
  assert(!failedScan.checked.includes('RAM prices'));
  assert.equal(failedScan.sources.find(s=>s.label==='RAM prices').status,'degraded');
}
for (const failure of [{error:null,errors:[]},{error:false,errors:{fetch:0,details:[]}}]) {
  assert.equal(inspectFeature(pattern,{builtAtIso:now.toISOString(),...failure},now.getTime()).status,'available','empty error fields are allowed');
}
for (const sourceHealth of [[null],{},[{id:'ir-amd'}],[{id:'ir-amd',status:123}],[{id:'ir-amd',status:'unexpected'}]]) {
  assert.equal(inspectFeature(news,{builtAtIso:now.toISOString(),sourceHealth},now.getTime()).status,'invalid','malformed news health cannot pass');
}
for (const officialSources of [{bls:'false'},[],{bls:null}]) {
  assert.equal(inspectFeature(calendar,{builtAtIso:now.toISOString(),events:[],coverage:{officialSources}},now.getTime()).status,'invalid','malformed calendar coverage cannot pass');
}
for (const coverage of [[null],[{key:'ram-prices.json'}],[{status:123}]]) {
  assert.equal(inspectFeature(brief,{builtAtIso:now.toISOString(),coverage},now.getTime()).status,'invalid','malformed brief coverage cannot pass');
}
for (const status of ['degraded','error','failed','down']) {
  assert.equal(inspectFeature(brief,{builtAtIso:now.toISOString(),coverage:[{key:'ram-prices.json',status}]},now.getTime()).status,'degraded');
}
const weeklySpec=UPDATE_FEATURES.find(s=>s.id==='ram-prices');
for (const [asOf,status] of [['2026-10-30','available'],['2026-10-29','stale']]) {
  const payload={asOf};
  const [row]=await checkFeatureCadence([inspectFeature(weeklySpec,payload,now.getTime())],new Map([[weeklySpec.key,{payload}]]),{runs:[]},now.getTime());
  assert.equal(row.status,status,'date-only observation retains its calendar date');
}
const failedOwnerInput=ownerBriefFixture();
failedOwnerInput.payloads['grades.json'].error='PRIVATE_SENTINEL';
const failedOwner=buildOwnerMarketBrief(failedOwnerInput);
assert.equal(failedOwner.coverage.find(s=>s.id==='grade').status,'degraded');
assert(!failedOwner.findings.some(s=>s.tab==='grade' || s.tab==='strategies'),'failed grade data cannot supply usable Brief findings');
for (const key of ['constructor','toString','fed-board-2026-13','PRIVATE_SENTINEL']) {
  assert.equal(calendarSourceLabel(key),'Unrecognized official schedule','unknown schedule keys cannot expose raw data or invalid dates');
}
console.log('Update health regression passed: refresh cadence, date precision, weekly inputs, valid empty responses, source failures, malformed coverage and private-safe diagnostics.');

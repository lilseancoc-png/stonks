import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildOwnerMarketBrief, OWNER_BRIEF_KEY, OWNER_BRIEF_SOURCES, sourceStatus } from '../lib/owner-market-brief.mjs';
import { OWNER_PAGE_IDS } from '../lib/owner-access-policy.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';
import { publishOwnerMarketBrief } from './publish-owner-market-brief.mjs';
import { publicDataPayload } from '../lib/public-data-policy.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import { store } from '../lib/datastore.mjs';
import authHandler from '../api/auth/[action].js';
import dataHandler from '../api/data/[...path].js';
const fixture=ownerBriefFixture(), saved=structuredClone(fixture), report=buildOwnerMarketBrief(fixture);
assert.deepEqual(fixture,saved,'Synthesis cannot mutate upstream research');
assert.deepEqual(report,buildOwnerMarketBrief(fixture),'Deterministic output');
assert.equal(report.scenarios.length,1);assert.equal(report.scenarios[0].paths.length,2);
assert(!JSON.stringify(report.scenarios).includes('weight'),'Scenario weights cannot become forecast odds');
assert(report.findings.some(f=>f.title==='Market and breadth disagree'));
assert.equal(report.publicRead.summary,fixture.payloads['briefs.json'].current.summary);
assert.equal(report.ideas[0].symbol,fixture.payloads['unified-signal.json'].decisions[0].symbol);assert(report.ideas[0].challenges.length);assert(report.ideas.some(i=>i.blocks.length));
assert(Date.parse(report.validUntil)<=Date.parse(fixture.builtAtIso)+24*3600000,'A brief expires within one day');
assert.equal(report.forecasts[0].eps,2.4);assert.equal(report.forecasts[0].cutoffAt,'2026-10-20T12:00:00Z');
// The on-demand Lab has owner-scoped experiments, not a daily decision feed.
// Keep it out of scheduled synthesis and AI inputs, including when enabled.
for(const page of OWNER_PAGE_IDS.filter(id=>!['owner-market-brief','research-lab'].includes(id)))assert(OWNER_BRIEF_SOURCES.some(s=>s.id===page),'New Owner page needs a brief adapter: '+page);
assert(!OWNER_BRIEF_SOURCES.some(s=>s.id==='research-lab'||s.key?.startsWith('_stonks/research-lab/')),'Interactive Lab records never enter brief synthesis');
assert(isPremiumKey(OWNER_BRIEF_KEY));assert.deepEqual(roleClaimForKey(OWNER_BRIEF_KEY),['tr','tp']);assert(isBakeOwnedKey(OWNER_BRIEF_KEY));
for(const [value,status] of [[null,'missing'],[{},'undated'],[{builtAtIso:'invalid'},'undated'],[{builtAtIso:'2026-10-24T15:05:00Z'},'future'],[{builtAtIso:'2026-10-01T15:05:00Z'},'stale']])assert.equal(sourceStatus(value,Date.parse(fixture.builtAtIso)).status,status);
for(const state of ['stale','undated','future']) {
  const f=structuredClone(fixture), p=f.payloads['unified-signal.json'];
  if(state==='stale')p.builtAtIso='2026-10-01T15:05:00Z';else if(state==='undated')delete p.builtAtIso;else p.builtAtIso='2026-10-24T15:05:00Z';
  assert.equal(buildOwnerMarketBrief(f).ideas.length,0,state+' decisions cannot supply ideas');
}
const expired=structuredClone(fixture);expired.payloads['unified-signal.json'].validUntil='2026-10-23T15:00:00Z';
assert(buildOwnerMarketBrief(expired).ideas.every(i=>!i.policyCurrent&&(i.status==='avoid'||i.suggestion.includes('Reference'))));
const staleScenario=structuredClone(fixture);staleScenario.payloads['market-analysis.json'].scenarioEngine.builtAtIso='2026-10-01';
assert.equal(buildOwnerMarketBrief(staleScenario).scenarios.length,0,'A fresh wrapper cannot refresh stale scenarios');
for(const state of ['former','stale','awaiting-source','unavailable']){const f=structuredClone(fixture);f.payloads['earnings-forecast.json'].companies[0].forecast.status=state;assert.equal(buildOwnerMarketBrief(f).forecasts.length,0);}
const aging=structuredClone(fixture);aging.payloads['quant.json'].builtAtIso=new Date(Date.parse(fixture.builtAtIso)-95.5*3600000).toISOString();assert.equal(Date.parse(buildOwnerMarketBrief(aging).validUntil),Date.parse(fixture.builtAtIso)+0.5*3600000,'Expiry follows the oldest usable input');
const legacy=structuredClone(fixture);legacy.payloads['briefs.json'].current.accessPolicyVersion=0;assert.equal(buildOwnerMarketBrief(legacy).publicRead,null);
assert.equal(buildOwnerMarketBrief({builtAtIso:fixture.builtAtIso}).status,'insufficient-data');
const changed=structuredClone(fixture);changed.builtAtIso='2026-10-23T15:10:00Z';changed.payloads['bottom-tracker.json'].summary='Credit weakens again';
assert(buildOwnerMarketBrief({...changed,previous:report}).changes.some(c=>c.detail==='Credit weakens again'));
const newVerdict=structuredClone(fixture);newVerdict.builtAtIso='2026-10-23T15:10:00Z';newVerdict.payloads['bottom-tracker.json'].verdict='emerging';assert(buildOwnerMarketBrief({...newVerdict,previous:report}).changes.some(c=>c.title.includes('emerging')),'Verdict changes retain stable finding identity');
const dir=await mkdtemp(resolve(tmpdir(),'owner-brief-test-'));
try {
  for(const [key,value]of Object.entries(fixture.payloads))await writeFile(resolve(dir,key),JSON.stringify(value));
  const payload=await publishOwnerMarketBrief({dataDir:dir,builtAtIso:fixture.builtAtIso,publicScan:fixture.publicScan,publicCore:fixture.publicCore});
  assert.deepEqual(JSON.parse(await readFile(resolve(dir,OWNER_BRIEF_KEY),'utf8')),payload);
  assert.equal(await readFile(resolve(dir,'unified-signal.json'),'utf8'),JSON.stringify(fixture.payloads['unified-signal.json']));
} finally {await rm(dir,{recursive:true,force:true});}
// Prove both deployed readers deny before storage for every invalid role/session.
const oldFlag=process.env.PRIVATE_DATA_ENABLED,oldSecret=process.env.SESSION_SECRET,oldGet=store.get;
process.env.PRIVATE_DATA_ENABLED='1';process.env.SESSION_SECRET='owner-brief-offline-fixture';let reads=0;
store.get=async()=>{reads++;return Buffer.from(JSON.stringify(report));};
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=JSON.stringify(v);return this;},end(v){this.body=String(v);return this;}});
try {
  const owner=await signSession({sub:'owner',tr:true,tp:true});
  const member=await signSession({sub:'member',tr:false,tp:false});
  const partial=await signSession({sub:'partial',tr:true});
  const expired=await signSession({sub:'expired',tr:true,tp:true},{ttlSec:-10});
  for(const handler of [authHandler,dataHandler])for(const token of ['',member,partial,expired,owner+'forged',owner]){
    const res=response(),before=reads;
    await handler({method:'GET',url:'/api/data/'+OWNER_BRIEF_KEY,query:{action:'me',data:OWNER_BRIEF_KEY},headers:token?{cookie:`${SESSION_COOKIE}=${token}`} : {}},res);
    assert.equal(res.statusCode,token===owner?200:401);assert.equal(res.headers['cache-control'],'private, no-store');
    if(token!==owner)assert.equal(reads,before,'Deny before reading private storage');else assert(res.body.includes('Synthetic public foundation'));
  }
}finally{store.get=oldGet;if(oldFlag==null)delete process.env.PRIVATE_DATA_ENABLED;else process.env.PRIVATE_DATA_ENABLED=oldFlag;if(oldSecret==null)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=oldSecret;}
assert(!JSON.stringify(publicDataPayload('briefs.json',fixture.payloads['briefs.json'])).includes('Synthetic public foundation'),'Public projection remains unchanged');
console.log('Owner brief: all Owner page adapters, deterministic publication, source age, expired approvals, forecast withholding, scenarios, conflicts, changes, immutable inputs and both authenticated routes passed.');

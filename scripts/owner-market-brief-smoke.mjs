import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildOwnerMarketBrief, OWNER_BRIEF_KEY, OWNER_BRIEF_SOURCES, openDayExpiry, sourceStatus } from '../lib/owner-market-brief.mjs';
import { OWNER_PAGE_IDS, SPORTS_PAGE_IDS } from '../lib/owner-access-policy.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';
import { publishOwnerMarketBrief } from './publish-owner-market-brief.mjs';
import { deskControls, webullFillSummary, engineLimitHolds, fillLine } from '../lib/owner-desk-state.mjs';
import { activeControls, readOwnerControlsDoc, accountLimits } from '../lib/owner-controls.mjs';
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
assert(Date.parse(report.validUntil)<=openDayExpiry(Date.parse(fixture.builtAtIso),24),'A brief expires within one open market day');
assert.equal(report.forecasts[0].eps,2.4);assert.equal(report.forecasts[0].cutoffAt,'2026-10-20T12:00:00Z');
// The on-demand Lab has owner-scoped experiments, not a daily decision feed.
// Keep it out of scheduled synthesis and AI inputs, including when enabled.
// Operational diagnostics are not market evidence for the Owner brief.
// The strategy engines are paper books kept apart from Top Picks (owner
// decision, 2026-11-16): the brief did not read them while they sat on the
// Top Picks page and does not read them now that they have their own page.
// Quant labs is measurement only ("context, not a vote"); the brief did not
// read it as an Owner Lab view and does not read it as its own page.
// The Valuation lab is a what-if calculator on the Owner's own inputs
// (display only, 2026-11-17); it is not market evidence for the brief.
for(const page of OWNER_PAGE_IDS.filter(id=>!['owner-market-brief','update-checker','owner-settings','engines','quant-labs','valuation-lab'].includes(id)&&!SPORTS_PAGE_IDS.includes(id)))assert(OWNER_BRIEF_SOURCES.some(s=>s.id===page),'New Owner page needs a brief adapter: '+page);
assert(!OWNER_BRIEF_SOURCES.some(s=>String(s.key||'').startsWith('_stonks/')),'Raw internal records never enter brief synthesis');
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
// The Owner's own desk (wave-1 integration): controls, account limits, Webull fills.
{
  const now=Date.parse(fixture.builtAtIso);
  assert.equal(report.desk.controls,null);assert.equal(report.desk.webull,null);assert.equal(report.desk.limitHolds,null);
  assert(!report.findings.some(f=>f.id.startsWith('desk:')),'No desk finding without desk state');
  const doc=readOwnerControlsDoc({stop:{at:'2026-10-23T13:00:00Z',by:'owner'},avoid:[{sym:'AAPL',close:true,at:'2026-10-23T13:00:00Z'}],watch:[],catalysts:[],dial:{level:'safer',at:'2026-10-23T13:00:00Z',until:'2026-10-24T20:00:00Z'}});
  const run={...activeControls(doc,now),enabled:true,limits:accountLimits({ACCOUNT_LIMIT_NEW_PER_DAY:'3'})};
  const ctl=deskControls(run);
  assert.equal(ctl.stop,true);assert.deepEqual(ctl.avoid,['AAPL']);assert.deepEqual(ctl.close,['AAPL']);assert.equal(ctl.dial,'safer');assert.equal(ctl.limits.newPerDay,3);
  assert.doesNotThrow(()=>JSON.stringify(ctl));
  assert.equal(deskControls({...activeControls(null,now),enabled:true,limits:accountLimits({})}),null,'Nothing set = no desk controls');
  assert.deepEqual(deskControls({...activeControls(doc,now),enabled:false,limits:accountLimits({})}),{enabled:false,limits:null});
  const ledger={trades:{
    a:{tradeId:'a',engineEntryIso:'2026-10-22T15:00:00Z',state:'open',requestedQty:2,filledQty:2,fillPrice:1,entryDiffPct:1.5},
    b:{tradeId:'b',engineEntryIso:'2026-10-22T15:00:00Z',state:'open',requestedQty:4,filledQty:1,fillPrice:1,entryDiffPct:-0.5},
    c:{tradeId:'c',engineEntryIso:'2026-10-22T15:00:00Z',state:'missed',requestedQty:1,filledQty:0},
    d:{tradeId:'d',engine:'TEC',engineEntryIso:'2026-10-22T15:00:00Z',state:'skipped',ownerHold:'Not bought: new trades are stopped by the owner.'},
    e:{tradeId:'e',engine:'TEC',engineEntryIso:'2026-10-22T15:00:00Z',state:'skipped',sharedContract:'x'},
    f:{tradeId:'f',engineEntryIso:'2026-09-01T15:00:00Z',state:'closed',requestedQty:1,filledQty:1,fillPrice:1},
  }};
  const wb=webullFillSummary(ledger,{nowMs:now});
  assert.equal(wb.n,5,'Trades older than the window are left out');
  assert.deepEqual([wb.picks.filled,wb.picks.partial,wb.picks.missed],[1,1,1]);assert.equal(wb.engines.held,1);assert.equal(wb.engines.shared,1);
  assert.equal(wb.gapPct.picks,0.5);assert.equal(wb.gapPct.engines,null);
  assert.equal(fillLine(wb.picks),'1 of 3 filled, 1 partly, 1 missed');
  assert.equal(webullFillSummary({trades:{}},{nowMs:now}),null);assert.equal(webullFillSummary(null),null);
  const engines={runs:[{iso:'2026-10-23T15:20:00Z'}],checks:{MSFT:[{engine:'TEC',why:'account limit: 3 new trades a day reached'}],NVDA:[{engine:'FUN',why:'run limit'}]}};
  const holds=engineLimitHolds(engines,now);assert.equal(holds.n,1);assert.deepEqual(holds.syms,['MSFT']);
  assert.equal(engineLimitHolds({...engines,runs:[{iso:'2026-10-20T15:20:00Z'}]},now),null,'An old run says nothing about today');
  const f=structuredClone(fixture);f.payloads['engines.json']=engines;
  const r=buildOwnerMarketBrief({...f,desk:{controls:ctl,webull:wb}});
  const stop=r.findings.find(x=>x.id==='desk:controls');
  assert(stop&&stop.priority===1&&stop.title==='New trades are stopped'&&stop.tab==='engines');
  assert(stop.detail.includes('AAPL')&&stop.detail.includes('Safer')&&stop.detail.includes('keep logging'));
  assert(r.findings.some(x=>x.id==='desk:limits'&&x.priority===1&&x.detail.includes('MSFT')));
  const fill=r.findings.find(x=>x.id==='desk:webull');assert(fill&&fill.tab==='track'&&fill.detail.includes('1 of 3 filled'));
  assert(r.priorities.some(x=>x.id==='desk:controls'),'A stop is a priority');
  assert.equal(r.summary,report.summary,'Desk state is not a research desk and does not change the coverage count');
  const off=buildOwnerMarketBrief({...fixture,desk:{controls:{enabled:false,limits:null}}});
  assert(off.findings.some(x=>x.id==='desk:controls'&&x.title==='Owner controls are off'));
  const resumed=structuredClone(fixture);resumed.builtAtIso='2026-10-23T15:10:00Z';
  assert(buildOwnerMarketBrief({...resumed,previous:r}).changes.some(c=>c.kind==='dropped'&&c.title==='New trades are stopped'),'Resuming shows as a change');
}
// Policy and news on held names (data integration, 2026-11-19).
{
  const pol=[{symbol:'UNH',docs:[{title:'Medicare Advantage rate notice',type:'Rule',date:'2026-10-21',pending:false,significant:true,url:null}],spike:null},{symbol:'NFLX',docs:[],spike:{ratio:2.5,date:'2026-10-21',tone:-3.5}}];
  const r=buildOwnerMarketBrief({...fixture,desk:{policy:pol}});
  const f=r.findings.find(x=>x.id==='desk:policy');
  assert(f&&f.tab==='open-picks'&&f.priority===1,'A significant rule on a held name is a priority');
  assert(f.detail.includes('UNH')&&f.detail.includes('Medicare Advantage')&&f.detail.includes('(significant)')&&f.detail.includes('NFLX: news 2.5x')&&f.detail.includes('darker'));
  assert(/trade rules do not read it/.test(f.detail));
  assert.equal(r.desk.policy.length,2);
  assert(!buildOwnerMarketBrief({...fixture,desk:{policy:[]}}).findings.some(x=>x.id==='desk:policy'),'Nothing held in the news = no finding');
  const quiet=buildOwnerMarketBrief({...fixture,desk:{policy:[{symbol:'MSFT',docs:[{title:'Notice',type:'Notice',date:'2026-10-21'}],spike:null}]}}).findings.find(x=>x.id==='desk:policy');
  assert.equal(quiet.priority,2,'A plain notice is context, not a priority');
}
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

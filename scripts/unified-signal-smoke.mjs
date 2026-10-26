import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildUnifiedSignalEngine, writeUnifiedSignalEngine, UNIFIED_SIGNAL_KEY, isUnifiedSignalArchiveKey } from '../lib/unified-signal.mjs';
import { unifiedSignalDisplayFactory } from '../lib/unified-signal-display.mjs';
import { yahooQuoteProvenance } from '../lib/quote-provenance.mjs';
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { isDynamicBakeKey, isBakeOwnedKey, bakeKeysToPublish } from '../lib/data-ownership.mjs';
import { hydrationPolicy } from '../lib/data-hydration.mjs';
import { serveDataKey } from '../lib/data-response.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import { store } from '../lib/datastore.mjs';
import { publishUnifiedSignal } from './publish-unified-signal.mjs';
import { unifiedSignalFixture, UNIFIED_FIXTURE_TIME } from './fixtures/unified-signal.mjs';

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const policy = unifiedSignalDisplayFactory(), fixture = unifiedSignalFixture();
const before = JSON.stringify(fixture), result = buildUnifiedSignalEngine(fixture);
const by = (payload,symbol) => payload.decisions.find(row => row.symbol === symbol);
check(JSON.stringify(fixture) === before, 'building the view must not mutate trading inputs');
check(policy.valid(result), 'wire contract is supported');
check(by(result,'BULL').status === 'eligible', 'published bullish entry retains its policy eligibility');
check(by(result,'BEAR').status === 'eligible', 'published bearish entry retains its policy eligibility');
check(by(result,'WAIT').status === 'wait', 'wait is preserved');
check(by(result,'AVOID').status === 'avoid', 'AI reject veto is preserved');
check(by(result,'MISS').status === 'insufficient-data', 'missing source time is not neutral');
check(by(result,'MIX').status === 'watch', 'no qualified side remains research');
check(by(result,'BEAR').vehicles.choices.find(v=>v.kind==='shares').eligible === false, 'short borrow assumptions are not invented');
check(by(result,'BULL').evidence.filter(e=>e.id.startsWith('news:')).length === 1, 'duplicate syndicated titles are not duplicated');
check(by(result,'BULL').evidence.find(e=>e.id.startsWith('record:')).effect === 'context', 'rising IV measurement is not a bullish vote');
check(by(result,'BULL').uncertainty.probability === null, 'no fabricated probability');
check(by(result,'BULL').valuation.intrinsicValue === null, 'analyst consensus is not intrinsic value');
const belowFloor=structuredClone(fixture);
belowFloor.grades.BULL.pillars.timing.structure.target=114.99999;
belowFloor.grades.BULL.pillars.timing.structure.invalidation=90;
check(by(buildUnifiedSignalEngine(belowFloor),'BULL').status!=='eligible','full-precision reward/risk below 1.5 cannot round into eligibility');
const atFloor=structuredClone(belowFloor);
atFloor.grades.BULL.pillars.timing.structure.target=115;
check(by(buildUnifiedSignalEngine(atFloor),'BULL').status==='eligible','an exact 1.5 reward/risk remains eligible');
const bearishFloor=structuredClone(fixture);
bearishFloor.grades.BEAR.pillars.timing.structure.target=85.00001;
bearishFloor.grades.BEAR.pillars.timing.structure.invalidation=110;
check(by(buildUnifiedSignalEngine(bearishFloor),'BEAR').status!=='eligible','bearish reward/risk uses full precision too');
bearishFloor.grades.BEAR.pillars.timing.structure.target=85;
check(by(buildUnifiedSignalEngine(bearishFloor),'BEAR').status==='eligible','bearish exact-threshold payoff remains eligible');
const credit = by(result,'BEAR').vehicles.choices.find(v=>v.kind==='option');
const economics = fixture.picks.picks.find(p=>p.symbol==='BEAR').optionEconomics;
assert.equal(credit.scenarios[1].atTargetPctOfRisk, Math.round(economics.scenarios[1].atTarget.pnlPerShare / economics.maximumLoss * 1e6) / 1e4); checks++;
const extra = structuredClone(fixture); extra.evidence.names.BULL.push({id:'short',src:'finra-si',dir:'up',str:3,v:900,asOf:'2026-10-23'});
check(by(buildUnifiedSignalEngine(extra),'BULL').grade === by(result,'BULL').grade, 'extra measurement does not add grade points');
for (const mutate of [
  f=>{f.chains.BULL.quoteProvenance.asOf='2026-10-22T15:00:00Z';},
  f=>{f.chains.BULL.quoteProvenance.asOf='2026-10-23T17:00:00Z';},
  f=>{f.chains.BULL.quoteProvenance.currency=null;},
  f=>{f.chains.BULL.quoteProvenance.field='postMarketPrice';},
  f=>{f.picks.builtAtIso='2026-10-23T14:00:00Z';},
  f=>{f.picks.picks[0].entry.now=false;},
  f=>{f.picks.picks[0].optionEconomics.eligible=false;},
  f=>{f.picks.picks[0].entryTiming.hardWait='earnings';},
  f=>{f.picks.picks[0].group='watch';},
  f=>{delete f.grades.BULL.pillars.timing.readiness;},
  f=>{f.grades.BULL.pillars.timing.readiness.directionConfirmed=false;},
  f=>{f.grades.BULL.pillars.timing.score=null;},
  f=>{f.picks.picks[0].entryPolicyVersion='legacy';},
  f=>{f.grades.BULL.pillars.timing.structure.invalidation=102;},
]) {
  const f=structuredClone(fixture); mutate(f);
  check(by(buildUnifiedSignalEngine(f),'BULL').status !== 'eligible', 'incomplete, stale, vetoed or malformed setups cannot qualify');
}
const promoted=structuredClone(fixture); promoted.grades.BULL.pillars.timing.state='wait';
promoted.picks.picks[0].entry.ai={verdict:'buy-now',blocked:false};
check(by(buildUnifiedSignalEngine(promoted),'BULL').status==='eligible','bounded published AI promotion remains supported');
const oldQuote=structuredClone(fixture); oldQuote.chains.BULL.quoteProvenance.asOf='2026-10-23T14:10:00Z';
const almostOld=buildUnifiedSignalEngine(oldQuote);
check(policy.status(by(almostOld,'BULL'),almostOld,Date.parse('2026-10-23T15:11:00Z'))==='wait','entry expires from source quote time, not retrieval time');
check(policy.status(by(result,'BULL'),result,Date.parse(UNIFIED_FIXTURE_TIME)+3600001)==='wait','expired snapshots cannot qualify');
check(policy.status(by(result,'BULL'),result,Date.parse(UNIFIED_FIXTURE_TIME),true)==='wait','failed refresh makes old eligibility reference only');
const late=buildUnifiedSignalEngine(unifiedSignalFixture('2026-10-23T19:35:00Z'));
check(policy.status(by(late,'BULL'),late,Date.parse('2026-10-23T20:01:00Z'))==='wait','entry qualification expires at the cash-session close');
const earlyClose=buildUnifiedSignalEngine(unifiedSignalFixture('2026-11-27T17:35:00Z'));
check(by(earlyClose,'BULL').quote.validUntil==='2026-11-27T18:00:00.000Z','half-day qualification expires at the verified early close');
const sunday={...structuredClone(fixture),builtAtIso:'2026-10-25T16:00:00Z'};
check(by(buildUnifiedSignalEngine(sunday),'BULL').quote.usable && !by(buildUnifiedSignalEngine(sunday),'BULL').quote.current,'Friday close is a Sunday reference, not a live entry');
const monday=unifiedSignalFixture('2026-10-26T12:30:00Z');
monday.chains.BULL.quoteProvenance.asOf='2026-10-23T20:00:00Z';
monday.chains.BULL.quoteProvenance.marketState='PRE';
check(by(buildUnifiedSignalEngine(monday),'BULL').quote.usable&&!by(buildUnifiedSignalEngine(monday),'BULL').quote.current,'prior trading close stays a valid premarket reference');
const mondayOpen=structuredClone(monday);mondayOpen.builtAtIso='2026-10-26T14:30:00Z';
check(!by(buildUnifiedSignalEngine(mondayOpen),'BULL').quote.usable,'prior close is not a current-session price after the next market open');
const next=unifiedSignalFixture('2026-10-23T19:35:00Z'); next.previous=result; next.grades.BULL.total=9;
check(by(buildUnifiedSignalEngine(next),'BULL').changes.items.some(s=>s.includes('grade changed')),'previous snapshots explain changes');
const removed=unifiedSignalFixture('2026-10-23T19:35:00Z');removed.previous=result;removed.chains.BULL.news.headlines=[];
check(by(buildUnifiedSignalEngine(removed),'BULL').changes.items.some(s=>s.includes('removed')),'disappearing evidence is recorded as a change');
const post=yahooQuoteProvenance({marketState:'POST',regularMarketPrice:100,regularMarketTime:new Date('2026-10-23T20:00:00Z'),postMarketPrice:110,postMarketTime:new Date('2026-10-23T21:00:00Z'),currency:'USD'});
check(post.field==='postMarketPrice' && post.asOf==='2026-10-23T21:00:00.000Z','active-session quote uses its matching source clock');
check(yahooQuoteProvenance({marketState:'POST',regularMarketPrice:100,regularMarketTime:1792785600},{optionSpot:true}).field==='regularMarketPrice','option analytics keep the regular-session basis');
for (const key of [UNIFIED_SIGNAL_KEY,result.snapshotKey,'signal-decisions/malformed.json']) {
  check(isPremiumKey(key) && isRoleRestrictedKey(key) && JSON.stringify(roleClaimForKey(key))==='["tr","tp"]','current and entire snapshot namespace require both owner claims');
}
check(isUnifiedSignalArchiveKey(result.snapshotKey) && isBakeOwnedKey(result.snapshotKey) && !isDynamicBakeKey(result.snapshotKey),'archives publish without delete-stale retention');
check(!hydrationPolicy()(result.snapshotKey) && hydrationPolicy({includeArchives:true})(result.snapshotKey),'normal builds skip archive downloads; research can opt in');
check(bakeKeysToPublish([UNIFIED_SIGNAL_KEY,result.snapshotKey]).length===2,'both current view and snapshot publish');
const malformed=structuredClone(result); delete malformed.decisions[0].vehicles.choices[1].limitations;
check(!policy.valid(malformed),'malformed deep vehicle data is rejected at the boundary');
const dir=await mkdtemp(resolve(tmpdir(),'stonks-unified-'));
try {
  await writeUnifiedSignalEngine(dir,result); await writeUnifiedSignalEngine(dir,result);
  check(await readFile(resolve(dir,result.snapshotKey),'utf8')===JSON.stringify(result),'snapshot writes are repeatable');
  const corrupt={...result,validation:'different content under the same key'};
  await assert.rejects(writeUnifiedSignalEngine(dir,corrupt)); checks++;
  check(await readFile(resolve(dir,UNIFIED_SIGNAL_KEY),'utf8')===JSON.stringify(result),'snapshot conflict cannot advance the current view');
  await writeFile(resolve(dir,'picks.json'),JSON.stringify(fixture.picks));
  await writeFile(resolve(dir,'market-analysis.json'),JSON.stringify({scenarioEngine:fixture.scenario}));
  const published=await publishUnifiedSignal({dataDir:dir,builtAtIso:fixture.builtAtIso,chains:fixture.chains,grades:fixture.grades});
  check(published.decisions.length===6 && by(published,'BULL').stress.paths.length===1,'completed local artifacts flow through publication');
} finally { await rm(dir,{recursive:true,force:true}); }

// Exercise the actual data-serving authorization boundary, with an offline
// store stand-in. Never read a provider or private account.
const oldGet=store.get, priorEnv={SESSION_SECRET:process.env.SESSION_SECRET,PRIVATE_DATA_ENABLED:process.env.PRIVATE_DATA_ENABLED};
try {
  process.env.SESSION_SECRET='unified-offline-fixture-secret'; process.env.PRIVATE_DATA_ENABLED='1';
  let reads=0; store.get=async()=>{reads++;return Buffer.from(JSON.stringify(result));};
  for (const claims of [null,{tr:true,tp:false},{tr:false,tp:true},{tr:true,tp:true}]) {
    const token=claims?await signSession(claims):null;
    for (const key of [UNIFIED_SIGNAL_KEY,result.snapshotKey]) {
      const response={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;},end(value){this.body=value;}};
      const start=reads;
      await serveDataKey({headers:{cookie:token?`${SESSION_COOKIE}=${token}`:''}},response,key);
      const owner=claims?.tr===true&&claims?.tp===true;
      check(response.statusCode===(owner?200:401),'real data endpoint requires both signed owner claims');
      check(response.headers['Cache-Control']==='private, no-store','private responses never enter public cache');
      check(owner?reads===start+1:reads===start,'denied callers do not reach stored decisions');
    }
  }
} finally {
  store.get=oldGet;
  for (const [key,value] of Object.entries(priorEnv)) { if(value==null)delete process.env[key];else process.env[key]=value; }
}
console.log(`Unified Signal Engine: ${checks} checks passed. Synthetic/offline evidence only.`);

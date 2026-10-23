// Decision invariants found during the Risk-Analysis review. Offline only.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderAppJs } from './render/app-js.mjs';
import { assessOptionEntryEconomics } from '../lib/option-entry-economics.mjs';
import { buildPickContract, buildExitPlan, buildUnderlyingTradePlan, buildTopPicks, computeEntryTiming } from './build.mjs';
import { bsPrice, yearsToExpiry, expiryCloseEpochSec } from '../lib/greeks.mjs';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import { pickDisplayDecision } from '../lib/research-display.mjs';

const {data,timing,expiry,row,aiThesis}=entryPolicyFixture();
const inconsistent={structure:'debit_vertical',expiry,legs:[
  {qty:1,type:'call',strike:100,bid:3,ask:3.1,iv:1},
  {qty:-1,type:'call',strike:105,bid:1,ask:1.1,iv:.1},
]};
const impossible=assessOptionEntryEconomics({side:'call',spot:100,contract:inconsistent,plan:{target:110,invalidation:96}});
assert.equal(impossible.eligible,false,'an impossible theoretical spread value cannot be clipped into a Buy');
assert.equal(impossible.reason,'inconsistent-spread-model');
const noSingle=structuredClone(data);
for(const quote of noSingle.chains[expiry].c){
  // The primary single-option policy has a higher OI requirement than spreads.
  quote.oi=60;
}
const fallback=buildPickContract('call',noSingle,.045,{type:'long',reason:'strong thesis'},{evaluateEconomics:true,stockPlan:{...timing.structure,target:120}});
assert(fallback?.economics.eligible && fallback.strategy.type==='debit');
assert.equal(fallback.economics.comparison.primary.key,null,'a missing preferred contract must remain missing in the audit');
assert.equal(fallback.economics.comparison.primary.reason,'no-qualified-contract');
assert.equal(fallback.strategy.label,'Bull debit spread','fallback label must match the selected contract');

const highExpiry=Math.floor((Date.now()+85*86400000)/86400000)*86400,highChain={c:[],p:[]};
for(let strike=20;strike<=200;strike++)for(const [type,key]of [['call','c'],['put','p']]){
  const mid=bsPrice(type,100,strike,yearsToExpiry(highExpiry),1.99,.045);
  highChain[key].push({s:strike,b:mid*.99,a:mid*1.01,iv:1.99,oi:1000,v:50});
}
const highCredit=buildPickContract('call',{spot:100,chains:{[highExpiry]:highChain}},.045,{type:'credit',reason:'rich IV'},{evaluateEconomics:true,stockPlan:{target:180,invalidation:94}});
assert(highCredit);
assert(highCredit.contract.structure!=='credit_vertical'||highCredit.contract.shortStrike<100,'an eligible credit spread cannot begin beyond its stock defense');

const stale={group:'actionable',contract:{structure:'long'},entry:{now:true},optionEconomics:{eligible:false,reason:'target-unprofitable'}};
assert.equal(pickDisplayDecision(stale).ready,false,'a contradictory persisted payload must not render Buy');
assert.equal(pickDisplayDecision({...stale,optionEconomics:undefined,entryPolicyVersion:'reviewed'}).ready,false,'reviewed policies require an actual passing audit');
assert.equal(pickDisplayDecision({...stale,optionEconomics:{eligible:true},entry:{now:true,economics:{eligible:false}}}).ready,false,'conflicting audits cannot render Buy');
const shifted=buildExitPlan('call',125,data,null);
assert(shifted.takeProfit.price>125||shifted.takeProfit.price===null,'an explicit entry spot must own the target geometry');
const huge=structuredClone(data);
for(const bar of huge._bars){bar.h=bar.c*2;bar.l=bar.c*.1;}
const hugePut=buildUnderlyingTradePlan('put',huge);
assert(hugePut.target===null||hugePut.target>0,'stock targets cannot be negative');

// Economic wait ideas must not consume the actionable roster's exposure caps.
const rows=[];
for(let i=0;i<4;i++){
  const r=structuredClone(row);r.sym='AUDIT'+i;r.data.fundamentals.sector='Audit sector';
  r.total=12-i*.1;r.timing.structure={...timing.structure,target:120,rr:6};
  if(i<3)for(const chain of Object.values(r.data.chains))for(const q of [...chain.c,...chain.p]){q.b*=5;q.a*=5;}
  rows.push(r);
}
const picks=buildTopPicks(Object.fromEntries(rows.map(r=>[r.sym,r.data])),[],null,null,null,null,.045,{preScored:{scored:rows,peerIndex:{},regimeBand:'neutral'},aiThesisMap:Object.fromEntries(rows.map(r=>[r.sym+':call',aiThesis]))});
assert.equal(picks.find(p=>p.symbol==='AUDIT3')?.group,'actionable','watch ideas cannot prevent a different eligible trade from taking an actionable slot');
console.log('Risk audit invariants passed: spread bounds, absent primary, credit defense, display eligibility, stock geometry and separate roster caps.');

// Exercise the shipped renderer against partial model output, not only math.
const app=renderAppJs({riskFreeRate:.045,riskFreeRateMeta:{}});
const helper=app.slice(app.indexOf('  function optionEconomicsReason('),app.indexOf('  function pickExitPlanHtml('));
const ui={escapeHtml:value=>String(value),fmt:(value,digits)=>Number(value).toFixed(digits)};
vm.createContext(ui);vm.runInContext(helper,ui);
const invalidHtml=ui.pickEconomicsHtml({optionEconomics:impossible});
assert.match(invalidHtml,/impossible spread value/);
assert.match(invalidHtml,/Unavailable/);
assert.doesNotMatch(invalidHtml,/NaN|undefined|null/);
assert.match(ui.pickEconomicsHtml({optionEconomics:fallback.economics}),/permitted alternative/);
assert.equal(ui.pickEconomicsHtml({}), '');
const trackedSource=app.slice(app.indexOf('  function trackedPicks('),app.indexOf('  function picksLiveSymbols('));
const live={pickDisplayDecision,picksState:{data:{picks:[stale,{...stale,optionEconomics:{eligible:true}}]}}};
vm.createContext(live);vm.runInContext(trackedSource,live);
assert.equal(live.trackedPicks().length,1,'live roster totals must use the same reviewed Buy decision as the card');

console.log('Risk audit UI passed: invalid scenarios stay unavailable; fallback and legacy cards render.');

const assess=(contract,extra={})=>assessOptionEntryEconomics({side:'call',spot:100,contract,plan:{target:120,invalidation:96},...extra});
const expensiveDebit={structure:'debit_vertical',expiry,legs:[
  {qty:1,type:'call',strike:100,bid:6,ask:6.2,iv:.4},
  {qty:-1,type:'call',strike:110,bid:1,ask:1.6,iv:.4}]};
assert.equal(assess(expensiveDebit,{minDebitRewardRisk:1}).reason,'debit-payoff-below-minimum-after-costs');
const thinCredit={structure:'credit_vertical',expiry,legs:[
  {qty:-1,type:'put',strike:95,bid:2.2,ask:2.8,iv:.4},
  {qty:1,type:'put',strike:85,bid:.2,ask:.3,iv:.4}]};
assert.equal(assess(thinCredit,{minCreditFraction:.22}).reason,'credit-too-small-after-costs');
const reversed=structuredClone(expensiveDebit);reversed.legs[0].strike=110;reversed.legs[1].strike=100;
assert.equal(assess(reversed).reason,'invalid-vertical-direction');
for(const extra of [{spot:null},{plan:{target:-1,invalidation:96}},{feePerLeg:-1},{horizonDays:Infinity},{takeProfitPct:NaN},{stopPct:0}])
  assert.equal(assess(expensiveDebit,extra).eligible,false,'missing or invalid assumptions must not become Buy');
console.log('Risk audit execution costs passed: debit reward/risk and credit-width floors use executable quotes; malformed inputs stay ineligible.');

// Decision thresholds use full precision, even when display rounds to 25%.
const boundaryNow=Date.now();
const remaining=(expiryCloseEpochSec(expiry)*1000-boundaryNow-14*86400000)/(365*86400000);
const theoretical=bsPrice('call',110,106,remaining,.4,.045);
const justUnder=theoretical/(1+24.99999/100);
const boundary=assessOptionEntryEconomics({side:'call',spot:100,contract:{structure:'long',strike:106,expiry,bid:justUnder,ask:justUnder,iv:.4},plan:{target:110,invalidation:96},nowMs:boundaryNow});
assert.equal(boundary.eligible,false,'display rounding cannot promote a scenario below the 25% profit threshold');

// A deterministic sweep checks both directions, structures, runways and costs.
let swept=0;
for(const side of ['call','put'])for(const structure of ['long','debit_vertical','credit_vertical'])
for(const days of [30,60,90])for(const iv of [.2,.4,1.2])for(const move of [.03,.1,.2]) {
  const exp=Math.floor((boundaryNow+days*86400000)/86400000)*86400;
  const T=(expiryCloseEpochSec(exp)*1000-boundaryNow)/(365*86400000);
  const dir=side==='call'?1:-1;
  const makeLeg=(type,strike,qty)=>{
    const mid=bsPrice(type,100,strike,T,iv,.045);
    return {type,strike,qty,expiry:exp,iv,bid:mid*.99,ask:mid*1.01};
  };
  const contract=structure==='long'?{...makeLeg(side,100+dir*6,1),structure}
    :{structure,expiry:exp,legs:structure==='debit_vertical'
      ?[makeLeg(side,100,1),makeLeg(side,100+dir*10,-1)]
      :[makeLeg(side==='call'?'put':'call',100-dir*5,-1),makeLeg(side==='call'?'put':'call',100-dir*15,1)]};
  const input={side,spot:100,contract,plan:{target:100*(1+dir*move),invalidation:100-dir*4},nowMs:boundaryNow,takeProfitPct:structure==='credit_vertical'?50:25};
  const free=assessOptionEntryEconomics(input),paid=assessOptionEntryEconomics({...input,feePerLeg:.65});
  for(const audit of [free,paid]) {
    assert.equal(audit.scenarios.length,3,'coherent models must produce all three scenarios');
    for(const scenario of audit.scenarios)for(const point of [scenario.atTarget,scenario.atInvalidation]) {
      assert(point && Number.isFinite(point.returnPct));
      assert(point.pnlPerShare>=-audit.maximumLoss-.0002,'scenario cannot exceed contractual max loss plus fees');
      if(audit.maximumProfit!=null)assert(point.pnlPerShare<=audit.maximumProfit+.0002,'scenario cannot exceed contractual max profit net of fees');
    }
    if(audit.eligible)assert(audit.scenarios.find(s=>s.label==='iv-flat').atTarget.returnPct>=audit.takeProfitPct);
  }
  const flat=a=>a.scenarios.find(s=>s.label==='iv-flat').atTarget.returnPct;
  assert(flat(paid)<=flat(free)+.0001,'adding fees cannot improve the same contract target return');
  if(paid.eligible)assert(free.eligible,'fees cannot rescue an ineligible trade');
  swept+=2;
}
console.log('Risk audit scenario sweep passed: '+swept+' call/put, structure, expiry, IV, target and fee cases.');

// Run actual file enrollment in an isolated data directory. Never write data/.
const scratch=await mkdtemp(resolve(tmpdir(),'stonks-risk-admission-'));
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Admission regression prohibits network calls');};
try {
  await mkdir(resolve(scratch,'data'));
  let source=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
  source=source.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+)(["'])([^"']+)\2/gm,(whole,prefix,quote,specifier)=>{
    if(specifier.startsWith('node:'))return whole;
    return prefix+quote+(specifier.startsWith('.')?new URL(specifier,new URL('./build.mjs',import.meta.url)).href:import.meta.resolve(specifier))+quote;
  });
  source=source.replace('const ROOT = resolve(__dirname, "..");','const ROOT = '+JSON.stringify(scratch)+';');
  await writeFile(resolve(scratch,'engine.mjs'),source);
  const isolated=await import(pathToFileURL(resolve(scratch,'engine.mjs')).href);
  const sample=buildTopPicks({FIXTURE:data},[],null,null,null,null,.045,{preScored:{scored:[row],peerIndex:{},regimeBand:'neutral'},aiThesisMap:{'FIXTURE:call':aiThesis}})[0];
  assert.equal(sample.group,'actionable');
  const reviewed={...sample,symbol:'AAPL'};
  const failed={...sample,symbol:'MSFT',optionEconomics:{...sample.optionEconomics,eligible:false}};
  const absent={...sample,symbol:'AMZN',optionEconomics:null,entry:{...sample.entry,economics:null}};
  const legacy={...absent,symbol:'BAC',entryPolicyVersion:undefined};
  const hardWait={...sample,symbol:'GE',entryTiming:{...sample.entryTiming,hardWait:'event'}};
  const missingEntry={...sample,symbol:'KO',entry:null};
  const noStrategy={...sample,symbol:'V',strategy:{type:'none'}};
  const iso=new Date().toISOString();
  const prior={symbol:'JNJ',side:'call',entryDate:iso,exitDate:iso,status:'hit-tp-prem',outcome:'win',optionPnlPct:25,entrySpot:100,exitSpot:110};
  await writeFile(resolve(scratch,'data/picks.json'),JSON.stringify({picks:[reviewed,failed,absent,legacy,hardWait,missingEntry,noStrategy]}));
  await isolated.updatePicksAccuracyFile(Object.fromEntries(['AAPL','MSFT','AMZN','BAC','GE','KO','V'].map(symbol=>[symbol,data])),iso,{open:[],closed:[prior],archive:[]});
  const record=JSON.parse(await readFile(resolve(scratch,'data/picks-accuracy.json'),'utf8'));
  assert.deepEqual(record.open.map(e=>e.symbol),['AAPL','BAC']);
  assert.equal(record.open[0].entryPolicyVersion,sample.entryPolicyVersion);
  assert.equal(record.open[1].entryPolicyVersion,null);
  assert.deepEqual(record.open[0].entryEconomics,sample.optionEconomics);
  assert.deepEqual(record.closed.find(e=>e.symbol==='JNJ'),prior,'prior outcomes must not be rewritten by admission changes');
  console.log('Risk audit enrollment passed: failed, absent and hard-Wait reviews are excluded; legacy evidence and prior outcomes are preserved.');
} finally { globalThis.fetch=oldFetch;await rm(scratch,{recursive:true,force:true}); }

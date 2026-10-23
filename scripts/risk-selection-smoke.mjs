// Offline decision checks. Uses no network, AI, broker or persisted data.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import { buildPickContract, buildTopPicks, pickContractForPick, computeEntryTiming, openPickPrecheck } from './build.mjs';
import { assessOptionEntryEconomics } from '../lib/option-entry-economics.mjs';
import { entryVolatilityRisk } from '../lib/entry-volatility-risk.mjs';
import { greeks, yearsToExpiry, bsPrice } from '../lib/greeks.mjs';
import { compactClosedForArchive } from '../lib/track-record-fills.mjs';

export function runRiskSelectionChecks() {
  const {data,timing,row,aiThesis,expiry}=entryPolicyFixture();
  const strategy={type:'long',reason:'Strong thesis, reasonable IV'};
  const opts={evaluateEconomics:true,stockPlan:timing.structure};
  const costly=structuredClone(data);
  const preferred=pickContractForPick('call',costly,.045,{requireClean:true});
  for(const quote of costly.chains[expiry].c) if(quote.s===preferred.strike){quote.b*=3;quote.a*=3;}
  const legacy=buildPickContract('call',costly,.045,strategy);
  assert.equal(assessOptionEntryEconomics({side:'call',spot:100,contract:legacy.contract,plan:timing.structure,rate:.045}).eligible,false);
  const alternative=buildPickContract('call',costly,.045,strategy,opts);
  assert(alternative.economics.eligible);
  assert.equal(alternative.strategy.type,'long');
  assert.notEqual(alternative.contract.strike,legacy.contract.strike);
  assert(alternative.economics.comparison.evaluated>1);
  assert.equal(alternative.economics.comparison.reason,'permitted-alternative-clears');

  const dated=structuredClone(data),earlier=expiry-15*86400;
  dated.chains[expiry].c=dated.chains[expiry].c.filter(q=>q.s===preferred.strike);
  dated.chains[earlier]={c:[{s:preferred.strike,iv:.4,oi:1000,v:50}],p:[]};
  const earlierMid=bsPrice('call',100,preferred.strike,yearsToExpiry(earlier),.4,.045);
  Object.assign(dated.chains[earlier].c[0],{b:earlierMid*.99,a:earlierMid*1.01});
  for(const quote of dated.chains[expiry].c){quote.b*=3;quote.a*=3;}
  const datedAlternative=buildPickContract('call',dated,.045,strategy,opts);
  assert(datedAlternative.economics.eligible);
  assert.equal(datedAlternative.contract.expiry,earlier,'a feasible already-fetched expiration can rescue the preferred expiry');

  const spreadData=structuredClone(data),spreadStrategy={type:'debit',reason:'Event restriction'};
  const firstSpread=buildPickContract('call',data,.045,spreadStrategy).contract;
  for(const quote of spreadData.chains[expiry].c)if(quote.s===firstSpread.longStrike){quote.b*=1.1;quote.a*=1.1;}
  const spreadOpts={evaluateEconomics:true,stockPlan:{...timing.structure,target:105}};
  const oldSpread=buildPickContract('call',spreadData,.045,spreadStrategy).contract;
  assert.equal(assessOptionEntryEconomics({side:'call',spot:100,contract:oldSpread,plan:spreadOpts.stockPlan,rate:.045}).eligible,false);
  const newSpread=buildPickContract('call',spreadData,.045,spreadStrategy,spreadOpts);
  assert(newSpread.economics.eligible && newSpread.economics.comparison.changed);
  assert.notDeepEqual([newSpread.contract.longStrike,newSpread.contract.shortStrike],[oldSpread.longStrike,oldSpread.shortStrike]);

  const fallbackData=structuredClone(data);
  for(const quote of fallbackData.chains[expiry].c){
    const delta=greeks('call',100,quote.s,yearsToExpiry(expiry),quote.iv,.045).delta;
    if(delta>=.30 && delta<=.50){quote.b*=3;quote.a*=3;}
  }
  const fallback=buildPickContract('call',fallbackData,.045,strategy,opts);
  assert(fallback.economics.eligible);
  assert.equal(fallback.strategy.type,'debit');
  assert.equal(fallback.strategy.requested,'long');
  assert.equal(fallback.strategy.fallback,true);
  const serialized=JSON.stringify(fallbackData);
  const debitOnly=buildPickContract('call',fallbackData,.045,{type:'debit',reason:'Event / IV restriction'},opts);
  assert.equal(debitOnly.strategy.type,'debit');
  assert.deepEqual(debitOnly.economics.comparison.permitted,['debit']);
  assert.equal(JSON.stringify(fallbackData),serialized,'comparison never mutates fetched quotes');
  const put=buildPickContract('put',data,.045,strategy,{evaluateEconomics:true,stockPlan:{target:80,invalidation:104}});
  assert(put.economics.eligible && put.contract.delta<0);
  const credit=buildPickContract('call',data,.045,{type:'credit',reason:'Elevated IV'},{evaluateEconomics:true,stockPlan:{target:115,invalidation:96}});
  assert(credit.economics.eligible && credit.contract.structure==='credit_vertical');
  assert.deepEqual(credit.economics.comparison.permitted,['credit','debit']);
  const empty=structuredClone(data);
  for(const chain of Object.values(empty.chains))for(const q of [...chain.c,...chain.p])q.b=null;
  assert.equal(buildPickContract('call',empty,.045,strategy,opts),null,'alternatives never relax missing quote requirements');

  const rescuedRow={...row,data:costly};
  const picks=buildTopPicks({FIXTURE:costly},[],null,null,null,null,.045,{preScored:{scored:[rescuedRow],peerIndex:{},regimeBand:'neutral'},aiThesisMap:{'FIXTURE:call':aiThesis}});
  const rescued=picks.find(p=>p.symbol==='FIXTURE');
  assert.equal(rescued?.group,'actionable');
  assert.equal(rescued.entry.now,true);
  assert(rescued.optionEconomics.comparison.changed);
  assert.equal(openPickPrecheck(rescuedRow,'call',false,{rfr:.045}),null,'AI priority uses the same economic rescue');

  // Identical closes/returns and different prior intraday ranges: an 8% move
  // is an exceptional shock for the quiet stock, ordinary risk for the volatile
  // one. Neither test asserts that absence of this veto creates a Go.
  const series=(range,last=92)=>{
    const c=Array.from({length:60},(_,i)=>100+(i%2?.15:-.15));
    c.push(last);
    return {c,h:c.map(v=>v*(1+range/2)),l:c.map(v=>v*(1-range/2)),v:c.map(()=>1e6)};
  };
  const quiet=series(.01),volatile=series(.08);
  const quietRead=entryVolatilityRisk(quiet,'call'),volatileRead=entryVolatilityRisk(volatile,'call');
  assert(quietRead.available && volatileRead.available);
  assert(quietRead.severeKnife && !volatileRead.severeKnife);
  assert(quietRead.thresholdsPct.severe1<volatileRead.thresholdsPct.severe1);
  const bars=series=>series.c.map((c,i)=>({date:new Date(Date.now()-(series.c.length-i)*86400000).toISOString().slice(0,10),o:c,c,h:series.h[i],l:series.l[i],v:series.v[i]}));
  const timingFor=series=>{const b=bars(series);b.push({...b.at(-1),date:new Date().toISOString().slice(0,10)});return computeEntryTiming('call',{spot:series.c.at(-1),_bars:b},series.c.at(-1),{});};
  const quietTiming=timingFor(quiet),volatileTiming=timingFor(volatile);
  assert(quietTiming.components.setup.severeKnife);
  assert.equal(volatileTiming.components.setup.severeKnife,false);
  assert.notEqual(volatileTiming.state,'go','a volatile rebound still needs the independent Go prerequisites');
  assert(entryVolatilityRisk(series(.01,108),'put').severeKnife);
  assert.equal(entryVolatilityRisk(series(.08,108),'put').severeKnife,false);
  assert(entryVolatilityRisk(series(.20,70),'call').emergencyKnife);
  assert(entryVolatilityRisk(series(.20,140),'put').emergencyKnife);
  assert(entryVolatilityRisk(series(.20,150),'call').emergencyRun);
  const quietRun=timingFor(series(.01,120)),volatileRun=timingFor(series(.08,120));
  assert(quietRun.components.extension.catastrophic);
  assert.equal(volatileRun.components.extension.catastrophic,false);
  assert.equal(volatileRun.components.extension.tier==='hard',false);
  const shock=structuredClone(quiet);
  for(let i=shock.c.length-3;i<shock.c.length;i++){shock.h[i]*=3;shock.l[i]*=.1;}
  assert.equal(entryVolatilityRisk(shock,'call').priorAtrPct.d3,quietRead.priorAtrPct.d3,'all tested shock bars are excluded from their ATR window');
  const counter=entryVolatilityRisk(volatile,'call',{fightsTape:true});
  assert(counter.thresholdsPct.severe1<volatileRead.thresholdsPct.severe1);
  assert(counter.thresholdsPct.severe1>=5,'absolute noise floor survives regime tightening');
  assert.equal(entryVolatilityRisk({...quiet,h:[]},'call').available,false);
  const unconfirmed=bars(quiet);unconfirmed.push({...unconfirmed.at(-1),date:new Date().toISOString().slice(0,10),c:1,h:1000,l:.1});
  const confirmed=computeEntryTiming('call',{spot:92,_bars:unconfirmed},92,{});
  assert.deepEqual(confirmed.metrics.volatilityRisk,quietTiming.metrics.volatilityRisk,'unfinished bar cannot change risk thresholds');
  const audit={entryPolicyVersion:rescued.entryPolicyVersion,entryEconomics:rescued.optionEconomics,entryVolatilityRisk:quietRead};
  const archived=compactClosedForArchive(audit);
  for(const [key,value] of Object.entries(audit))assert.deepEqual(archived[key],value);
  console.log('Risk selection passed: alternative strikes, permitted fallback, calls/puts, roster rescue, prior ATR, mirrored volatility, emergency limits, unfinished bars and frozen audits.');
  return {rescued,quietTiming,volatileTiming};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)runRiskSelectionChecks();

// Offline verification of entry-plan ownership, executable quote scenarios,
// the earnings boundary, delta policy and research-only LEAPS qualification.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { assessOptionEntryEconomics, OPTION_ENTRY_POLICY_VERSION } from '../lib/option-entry-economics.mjs';
import { bsPrice, greeks, yearsToExpiry } from '../lib/greeks.mjs';
import { computeEntryTiming, buildUnderlyingTradePlan, buildExitPlan, buildTopPicks,
  pickContractForPick, pickVerticalForPick, resolvePickOutcome, applySplitToEntry, buildLeveragedEtfPicks } from './build.mjs';
import { buildLeapsScorePayload } from '../lib/leaps-score.mjs';
const DAY = 86400000;

export function entryPolicyFixture() {
  const bars = [], closes = [], volumes = [];
  let price = 100;
  for (let i = 0; i < 35; i++) { price *= 1 + (i % 2 ? -.003 : .003); closes.push(price); volumes.push(1e6); }
  const moves = [.02,.02,.02,.02,.02,-.02,-.02,-.02,.015];
  const vols = [1,1,1,1,1,.72,.70,.68,1.6];
  for (let i = 0; i < moves.length; i++) { price *= 1 + moves[i]; closes.push(price); volumes.push(1e6*vols[i]); }
  const now = Date.now();
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i] / price * 100;
    bars.push({date:new Date(now-(closes.length-i)*DAY).toISOString().slice(0,10),o:c,c,h:c*1.01,l:c*.99,v:volumes[i]});
  }
  bars.push({...bars.at(-1),date:new Date(now).toISOString().slice(0,10)});
  const expiry = Math.floor((now+60*DAY)/DAY)*86400, T = yearsToExpiry(expiry);
  const chain = {c:[],p:[]};
  for (let strike = 70; strike <= 130; strike++) for (const [type,key] of [['call','c'],['put','p']]) {
    const mid = bsPrice(type,100,strike,T,.4,.045);
    chain[key].push({s:strike,b:mid*.99,a:mid*1.01,iv:.4,oi:1000,v:50});
  }
  const data = {spot:100,_bars:bars,chains:{[expiry]:chain},fundamentals:{sector:'Test'},ivRank:{z:0,pctile:30}};
  const timing = computeEntryTiming('call',data,100,{});
  const pillars = Object.fromEntries(['fundamentals','technicals','mechanicals','narrative'].map(key=>[key,{score:3,signals:[{key:'test-'+key,label:key,score:3,note:'fixture'}]}]));
  const row = {sym:'FIXTURE',total:12,side:'call',data,pillars,drivers:[],timing,recommendation:{tier:'strong-call',label:'Strong Call',conviction:'Very High'}};
  const aiThesis = {summary:'Fixture research case',setup:'Confirmed pullback',catalyst:'Fixture catalyst',outlook:'Directional',macroSupport:'neutral',invalidation:['Support fails'],grade:'strong',score:90,entryVerdict:'buy-now'};
  return {data,timing,row,aiThesis,expiry};
}

export function runEntryPolicyChecks() {
  const {data,timing,row,aiThesis,expiry} = entryPolicyFixture();
  assert.equal(timing.state,'go');
  const plan = buildUnderlyingTradePlan('call',data);
  assert.deepEqual(plan,timing.structure);
  const long = pickContractForPick('call',data,.045,{requireClean:true});
  assert(long && Math.abs(long.delta)>=.30 && Math.abs(long.delta)<=.50 && long.otmPct<=15);
  assert(Math.abs(Math.abs(long.delta)-.40)<.03,'liquid comparable options prefer delta near 0.40');
  const oneStrike = strike => {
    const mid=bsPrice('call',100,strike,yearsToExpiry(expiry),.65,.045);
    return {...data,chains:{[expiry]:{c:[{s:strike,b:mid*.99,a:mid*1.01,iv:.65,oi:1000,v:50}],p:[]}}};
  };
  assert(pickContractForPick('call',oneStrike(114),.045,{requireClean:true}),'14% OTM can qualify beyond the former 12% ceiling');
  assert.equal(pickContractForPick('call',oneStrike(116),.045,{requireClean:true}),null,'16% OTM remains outside the new ceiling');
  const exit = buildExitPlan('call',100,data,long,{stockPlan:plan});
  assert.equal(exit.cut.price,plan.invalidation);
  assert.equal(exit.takeProfit.price,plan.target);
  assert.equal(exit.stockPlan,plan);
  // The leveraged desk shares the exit builder; its downstream plan must
  // carry these real levels rather than inventing percentage stops.
  const leveraged = buildLeveragedEtfPicks({NVDA:data},{NVDA:{total:12,timing:{call:timing}}},new Date().toISOString());
  const leveredIdea = [...leveraged.ideas,...leveraged.watch].find(p=>p.under?.symbol==='NVDA');
  assert(leveredIdea?.plan);
  assert.equal(leveredIdea.plan.invalidation.underlyingPx,plan.invalidation);
  assert.equal(leveredIdea.plan.target.underlyingPx,plan.target);
  const debit = pickVerticalForPick('call',data,.045,{type:'debit'});
  assert(debit && Math.abs(debit.legs[0].delta)>.5,'spread anchor retains its independent 0.55 target');
  const credit = pickVerticalForPick('call',data,.045,{type:'credit'});
  assert(credit);
  const creditExit = buildExitPlan('call',100,data,credit,{stockPlan:plan});
  assert.equal(creditExit.cut.price,plan.invalidation);
  assert.equal(creditExit.takeProfit.price,plan.target);
  assert.equal(creditExit.vehicleDefense.price,credit.shortStrike);
  assert.equal(resolvePickOutcome({isCall:true,cur:credit.shortStrike-.01,stopUnder:plan.invalidation,vehicleStopUnder:credit.shortStrike,modeledOptPnlPct:-1}).status,'hit-stop-under');
  const split = applySplitToEntry({entrySpot:100,cut:94,vehicleCut:97,takeProfit:115},2,new Date().toISOString());
  assert.equal(split.cut,47);
  assert.equal(split.vehicleCut,48.5,'credit defense follows the tracked contract through splits');
  const unavailable = buildExitPlan('call',100,{},null);
  assert(unavailable.levels.every(level=>!level.prose.includes('$null')));

  const c = {structure:'long',strike:100,expiry,iv:.4,bid:6,ask:6.1,mid:6.05};
  const goodPlan={target:115,invalidation:96};
  for (const spread of [debit,credit]) {
    const economics = assessOptionEntryEconomics({side:'call',spot:100,contract:spread,plan:goodPlan,takeProfitPct:spread===credit?50:25});
    assert.equal(economics.eligible,true,'executable spread can fund its managed profit exit');
    assert(economics.maximumLoss>0);
    assert(economics.scenarios.every(sc=>sc.atInvalidation.pnlPerShare>=-economics.maximumLoss-.001));
  }
  const good=assessOptionEntryEconomics({side:'call',spot:100,contract:c,plan:goodPlan});
  assert.equal(good.eligible,true);
  assert.equal(good.scenarios.length,3);
  assert(good.scenarios[0].atTarget.returnPct<good.scenarios[1].atTarget.returnPct);
  assert.equal(good.entryPrice,6.1);
  assert.equal(good.feesEstimated,false);
  const expensive=assessOptionEntryEconomics({side:'call',spot:100,contract:{...c,bid:25,ask:25.1,mid:25.05},plan:goodPlan});
  assert.equal(expensive.eligible,false);
  assert.equal(expensive.reason,'target-unprofitable');
  assert.equal(assessOptionEntryEconomics({side:'call',spot:100,contract:{...c,bid:null},plan:goodPlan}).reason,'missing-quotes');
  assert.equal(assessOptionEntryEconomics({side:'call',spot:100,contract:c,plan:{target:110,invalidation:101}}).reason,'invalid-stock-plan');
  const put=assessOptionEntryEconomics({side:'put',spot:100,contract:{...c,strike:100},plan:{target:85,invalidation:104}});
  assert.equal(put.eligible,true);
  assert(put.scenarios[0].atTarget.returnPct<put.scenarios[1].atTarget.returnPct);
  const tightCredit={structure:'credit_vertical',expiry,legs:[{qty:-1,type:'put',strike:100,bid:3,ask:3.1,iv:.4},{qty:1,type:'put',strike:95,bid:2.8,ask:2.9,iv:.4}]};
  assert.equal(assessOptionEntryEconomics({side:'call',spot:100,contract:tightCredit,plan:goodPlan,takeProfitPct:50}).eligible,false,'tiny executable credit cannot hide wing friction');
  assert(assessOptionEntryEconomics({side:'call',spot:100,contract:c,plan:goodPlan,feePerLeg:.65}).scenarios[1].atTarget.returnPct<good.scenarios[1].atTarget.returnPct);

  const build = source => buildTopPicks({FIXTURE:source.data},[],null,null,null,null,.045,{preScored:{scored:[source],peerIndex:{},regimeBand:"neutral"},aiThesisMap:{'FIXTURE:call':aiThesis}});
  // This small stock target cannot fund the managed option profit exit after
  // time and crossing costs. An AI Buy Now must not waive the economic gate.
  const overpriced=structuredClone(row);
  for(const chain of Object.values(overpriced.data.chains)) for(const leg of [...chain.c,...chain.p]) {leg.b*=2;leg.a*=2;}
  const rejected=build(overpriced).find(p=>p.symbol==='FIXTURE');
  assert(rejected && rejected.optionEconomics,'candidate retains its economic audit');
  assert.equal(rejected.optionEconomics.eligible,false);
  assert.equal(rejected.group,'watch'); assert.equal(rejected.entry.now,false); assert.equal(rejected.entry.signal,'wait-economics');
  const wider=structuredClone(row);
  wider.timing.structure={...plan,target:120,rr:Math.round((120-100)/(100-plan.invalidation)*100)/100};
  const accepted=build(wider).find(p=>p.symbol==='FIXTURE');
  assert(accepted?.optionEconomics.eligible);
  assert.equal(accepted.group,'actionable');
  assert.equal(accepted.entryPolicyVersion,OPTION_ENTRY_POLICY_VERSION);
  assert.equal(accepted.entry.target,accepted.exitPlan.takeProfit.price);
  assert.equal(accepted.entry.invalidation,accepted.exitPlan.cut.price);

  for(const days of [14,15]) {
    const earned=structuredClone(wider);
    // Earnings dates are US market calendar dates. UTC is already tomorrow
    // during the ET evening, which otherwise turns this 14-day test into 15.
    const todayEt=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
    earned.data.fundamentals.nextEarningsDate=new Date(Date.parse(todayEt+'T12:00:00Z')+days*DAY).toISOString().slice(0,10);
    const pick=build(earned).find(p=>p.symbol==='FIXTURE');
    assert(pick);
    assert.equal(pick.strategy.type,days===14?'debit':'long');
  }
  const research=buildLeapsScorePayload(['go','wait','avoid'].map((state,i)=>({sym:'IDEA'+i,timing:{state,side:'call'},pillars:row.pillars})),{env:{}});
  assert.equal(research.picks.length,3);
  assert.deepEqual(research.picks.map(p=>p.entry.state),['go','wait','avoid']);
  assert(research.picks.every(p=>p.reason==='qualified' && p.trajectory && p.contract===undefined));
  console.log('Entry policy checks passed: shared plans, independent spread delta, economics, Buy demotion, earnings boundary, LEAPS qualification.');
  return {accepted,rejected,research};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) runEntryPolicyChecks();

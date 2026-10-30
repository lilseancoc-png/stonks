import assert from 'node:assert/strict';
import {topPicksMarket,topPicksMarketSources} from '../lib/top-picks-market.mjs';
import {advanceMarketStudy,summarizeMarketStudy,marketStudyView,unavailableMarketStudyView} from '../lib/top-picks-market-study.mjs';
import {approvedTopPicks,applyMarketAdmission} from '../lib/top-picks-approval.mjs';
import {createTopPicksHandler} from '../api/top-picks.js';
import {entryPolicyFixture} from './entry-policy-smoke.mjs';
import {prepareTopPicksScoring,buildTopPicks,buildThesisUserMessage,computeEntryTiming,buildTopPicksMarketContext,computeMacroRegime} from './build.mjs';
import {pickDisplayDecision} from '../lib/research-display.mjs';
import {topPicksMarketClientFactory} from './render/top-picks-market-client.mjs';
import {isPremiumKey,roleClaimForKey} from '../lib/premium-keys.mjs';
import {isBakeOwnedKey,isSeedableKey,isDynamicBakeKey} from '../lib/data-ownership.mjs';
import {compactClosedForArchive} from '../lib/track-record-fills.mjs';
import {publishUnifiedSignal} from './publish-unified-signal.mjs';
import {buildUnifiedSignalEngine} from '../lib/unified-signal.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const now=new Date().toISOString(), ms=Date.parse(now);
const macro=(state='neutral',extra={})=>({state,stress:state==='risk-off'?-3:0,dataQuality:{sufficient:true},axes:{indexes:{score:0,available:true},vix:{score:0,available:true}},
 inputs:{indexes:{asOf:now,spy:{pctChange1d:0},qqq:{pctChange1d:0}},vix:{asOf:now,value:18}},...extra});
const assess=(state='neutral',extra={})=>topPicksMarket.assess({macroRegime:macro(state),asOf:now,...extra});
const {data,row,aiThesis}=entryPolicyFixture();
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('labels anchor one multiplier; bearish direction and inverse exposure are explicit',()=>{
 for(const [state,want] of [['risk-on',1.05],['neutral',1],['risk-off',.75],['severe-risk-off',.6]])assert.equal(topPicksMarket.score(assess(state),{conviction:10,side:'call'}).multiplier,want);
 assert.equal(topPicksMarket.score(assess('risk-off'),{conviction:-10,side:'put'}).multiplier,1.05);
 assert.equal(topPicksMarket.score(assess('risk-off'),{conviction:10,side:'call',exposure:-1}).multiplier,1.05);
 assert.equal(topPicksMarket.score(assess('severe-risk-off'),{conviction:10,side:'call',exposure:0}).multiplier,1);
 assert.equal(topPicksMarket.score(assess('neutral',{macroRegime:macro('neutral',{fragile:true})}),{conviction:10}).multiplier,.9);
});
check('confirmation is independent; additional warnings never soften a headwind',()=>{
 const desks=[{id:'heatmap',stance:-1,asOf:now},{id:'volume',stance:-1,asOf:now}];
 const a=assess('risk-off',{desks}),b=assess('risk-off',{desks:[...desks,{id:'gamma',stance:0,structure:'amplify',asOf:now}]});
 assert.equal(topPicksMarket.score(a,{conviction:10}).multiplier,.7);
 assert(topPicksMarket.score(b,{conviction:10}).multiplier<=.7);
 assert.equal(topPicksMarket.score(assess('risk-off',{desks:[{id:'market',stance:-2,asOf:now},{id:'fear-greed',stance:-2,asOf:now},{id:'overnight',stance:-1,asOf:now}]}),{conviction:10}).multiplier,.75);
 assert.equal(assess('risk-off',{desks:desks.map(d=>({...d,asOf:new Date(ms-3*3600000).toISOString()}))}).confirmation,0,'older participation cannot boost or discount the current session');
});
check('deterioration catches QQQ divergence and measured earnings reactions',()=>{
 const mr=macro();mr.inputs.indexes.qqq.pctChange1d=-1.5;
 assert.equal(assess('neutral',{macroRegime:mr}).trajectory,'deteriorating');
 assert.equal(assess('neutral',{earnings:{n:4,negativeShare:1,medianMovePct:-5,asOf:now}}).trajectory,'deteriorating');
 assert.equal(assess('neutral',{earnings:{n:1,negativeShare:1,medianMovePct:-20,asOf:now}}).trajectory,'stable');
 const old={date:'2099-01-01',axisScores:{indexes:2,vix:2}};
 assert.equal(assess('neutral',{previous:old}).trajectory,'stable');
});
check('missing, stale and future core observations cannot qualify',()=>{
 for(const at of [null,'2020-01-01',new Date(ms+600001).toISOString()]){
   const mr=macro();mr.inputs.indexes.asOf=at;
   assert.equal(assess('neutral',{macroRegime:mr}).ready,false);
 }
 assert.equal(topPicksMarket.assess({asOf:now}).ready,false);
 assert(topPicksMarket.score(assess('risk-on'),{conviction:6.5}).tradeScore<7);
 assert(topPicksMarket.score(assess('risk-on'),{conviction:-6.5,side:'put'}).tradeScore<0);
});
check('real roster path exposes both scores, cannot AI-promote an unknown market',()=>{
 const pre={scored:[structuredClone(row)],peerIndex:{},regimeBand:'neutral'},before=JSON.stringify(pre);
 const a=assess();
 const transformed=prepareTopPicksScoring(pre,{macroRegime:macro()},a);
 assert.equal(transformed.scored[0].stockConviction,12);
 assert.equal(transformed.scored[0].tradeScore,12);
 assert.equal(JSON.stringify(pre),before);
 const p=buildTopPicks({FIXTURE:data},[],null,null,{macroRegime:macro()},null,.045,{preScored:pre,marketAssessment:a,aiThesisMap:{'FIXTURE:call':aiThesis}});
 assert.equal(p[0].group,'actionable');assert.equal(p[0].stockConviction,12);assert.equal(p[0].tradeScore,12);
 const held=buildTopPicks({FIXTURE:data},[],null,null,{},null,.045,{preScored:pre,marketAssessment:topPicksMarket.assess({asOf:now}),aiThesisMap:{'FIXTURE:call':aiThesis}});
 assert.equal(held.filter(p=>p.group==='actionable').length,0);
 assert.equal(pickDisplayDecision({...p[0],marketApproval:{held:true}}).ready,false);
});
check('Top Picks reviewer uses all market axes and the current IV rule only for this policy',()=>{
 const r=prepareTopPicksScoring({scored:[structuredClone(row)]},{macroRegime:macro()},assess()).scored[0];
 r.data={...data,ivRank:{pctile:70,z:0,iv:.4},technicals:{volRegime:{rv30:.3}}};
 const mr=macro('risk-off');for(const k of ['twoY','bondVol','breadth','putCall','credit','rotation'])mr.axes[k]={score:-1,label:'DETAIL_'+k};
 const text=buildThesisUserMessage(r,'call',mr);
 for(const key of ['twoY','bondVol','breadth','putCall','credit','rotation'])assert(text.includes('DETAIL_'+key));
 assert(!text.includes('premium is rich'));
 const old=buildThesisUserMessage({...r,marketAdjustment:null},'call',mr);assert(old.includes('premium is rich'));
});
check('recent reclaim audit is limited to the Top Picks timing option',()=>{
 const shared=computeEntryTiming('call',data,100,{regime:'risk-off'});
 const isolated=computeEntryTiming('call',data,100,{regime:'risk-off',topPicksPolicy:true});
 assert.equal(shared.readiness.reclaimAge,undefined);
 assert(isolated.readiness.reclaimAge==null||isolated.readiness.reclaimAge<=4);
 assert.equal(computeEntryTiming('call',data,100,{}).state,'go');
 const d=structuredClone(data),n=d._bars.length;
 for(const[i,v]of[[n-4,95],[n-3,97],[n-2,97.25]])Object.assign(d._bars[i],{c:v,o:v,h:v*1.01,l:v*.99,v:1.6e6});
 const recent=computeEntryTiming('call',d,97.25,{regime:'risk-off',topPicksPolicy:true});
 assert.equal(recent.readiness.reclaimAge,1);assert.equal(recent.readiness.trendReclaimed,true);
 assert.equal(computeEntryTiming('call',d,97.25,{regime:'risk-off'}).readiness.trendReclaimed,false);
 assert.notEqual(recent.state,'go','a recent reclaim alone cannot waive momentum or other Go prerequisites');
});
check('source adapters distinguish missing data, structural gamma and sector breadth',()=>{
 const sources=topPicksMarketSources({macro:{macroRegime:macro()},asOf:now,heatmap:{builtAtIso:now,tickers:Array.from({length:10},(_,i)=>({ch:i<7?-2:1,mc:100}))},
 volume:{scannedAt:now,tickers:[{sector:'A',eod:{flagged:true,dayMovePct:-2}},{sector:'B',bucketHits:[{hourlyFlagged:true,priceMovePct:-3}]}]},gamma:{net:-1,asOf:now}});
 assert.equal(sources.desks.length,7);assert.equal(sources.desks.find(d=>d.id==='heatmap').stance,-1);
 assert.equal(sources.desks.find(d=>d.id==='volume').stance,-1);
 assert.equal(sources.desks.find(d=>d.id==='gamma').structure,'amplify');
 assert.equal(sources.desks.find(d=>d.id==='overnight').available,false);
 const context=buildTopPicksMarketContext({FIXTURE:data},{macroRegime:macro()},now,{});assert(context.ready);
 const contextual=topPicksMarketSources({macro:{macroRegime:macro()},asOf:now,
   calendar:{days:[{date:new Date(ms-86400000).toISOString().slice(0,10),spy:{chPct:-1},qqq:{chPct:-1},iwm:{chPct:-1},smh:{chPct:-1},vix:{chPct:-5}}]},
   overnight:{tone:{label:'insufficient'},builtAtIso:now},gamma:{asOf:now}});
 assert.equal(contextual.desks.find(d=>d.id==='index-cal').stance,0,'falling VIX does not confirm a defensive month');
 assert.equal(contextual.desks.find(d=>d.id==='overnight').available,false);
 assert.equal(contextual.desks.find(d=>d.id==='gamma').available,false);
 assert.equal(topPicksMarketSources({asOf:now,heatmap:{builtAtIso:now,tickers:[{ch:-5}]}}).desks.find(d=>d.id==='heatmap').stance,0,'missing cap weights cannot invent a weighted tape');
});
check('permission state is private, request-owned and excluded from bake/seed',()=>{
 assert.equal(isPremiumKey('top-picks-approval.json'),true);
 assert.deepEqual(roleClaimForKey('top-picks-approval.json'),['tr','tp']);
 assert.equal(isBakeOwnedKey('top-picks-approval.json'),false);
 assert.equal(isSeedableKey('top-picks-approval.json'),false);
 assert.equal(isPremiumKey('top-picks-market-study.json'),true);
 assert.equal(isBakeOwnedKey('top-picks-market-study.json'),true);
 assert.equal(isDynamicBakeKey('top-picks-market-study.json'),false,'an omitted measurement archive retains its existing remote object');
 const archived=compactClosedForArchive({symbol:'AAA',marketAdjustment:{version:topPicksMarket.VERSION},stockConviction:10,tradeScore:7,marketApproval:{held:false}});
 assert.equal(archived.stockConviction,10);assert.equal(archived.tradeScore,7);assert(archived.marketAdjustment.version);
});
check('market scores are bounded, monotonic in adverse severity and never reverse direction',()=>{
 for(const side of ['call','put'])for(let value=0;value<=20;value+=.25){
  const raw=(side==='call'?1:-1)*value;
  for(const state of ['risk-on','neutral','risk-off','severe-risk-off']){
    const a=topPicksMarket.score(assess(state),{conviction:raw,side});
    assert(a.multiplier>=.5&&a.multiplier<=1.1);assert(a.tradeScore*raw>=0);
  }
 }
 for(const stress of [-3,-4,-5,-6]){
   const a=assess('risk-off',{macroRegime:macro('risk-off',{stress})});
   assert(topPicksMarket.score(a,{conviction:10}).multiplier<=.75);
 }
});
const pick={symbol:'FIXTURE',side:'call',stockConviction:10,optionAdjustedConviction:10,tradeScore:10,total:10,group:'actionable',entry:{now:true},marketAdjustment:topPicksMarket.score(assess(),{conviction:10}),marketApproval:{held:false}};
const payload={builtAtIso:now,rosterMeta:{marketAssessment:assess(),actionableBar:7},picks:[pick]};
check('live worsening holds new entries; an old response and quote recovery cannot revive them',()=>{
 const shock={spy:{value:90,pctChange1d:-3,asOf:now,marketState:'REGULAR'},qqq:{value:90,pctChange1d:-4,asOf:now,marketState:'REGULAR'},vix:{value:35,pctChange1d:30,asOf:now,marketState:'REGULAR'}};
 const a=topPicksMarket.liveReview(assess(),shock,now);assert(a.newHeadwind);
 const held=topPicksMarket.revalidate(payload,a,{now:ms,live:true});assert.equal(held.picks[0].entry.now,false);
 assert.equal(topPicksMarket.revalidate(held,assess(),{now:ms,live:true}).picks[0].entry.now,false);
 assert.equal(topPicksMarket.revalidate(payload,assess(),{now:ms+30*3600000}).picks[0].entry.now,false);
});
check('live rallies review bearish exposure and current evidence is checked at request time',()=>{
 const rally={spy:{pctChange1d:3,asOf:now},qqq:{pctChange1d:3.5,asOf:now},vix:{value:14,pctChange1d:-20,asOf:now}};
 const a=topPicksMarket.liveReview(assess(),rally,now);assert.equal(a.state,'risk-on');assert(a.exceptionalShock);
 const bearish={...payload,picks:[{...pick,side:'put',stockConviction:-10,optionAdjustedConviction:-10,tradeScore:-10,marketAdjustment:topPicksMarket.score(assess(),{conviction:-10,side:'put'})}]};
 const held=topPicksMarket.revalidate(bearish,a,{now:ms,live:true});assert.equal(held.picks[0].entry.now,false);assert.equal(held.picks[0].tradeScore,-7.5,'a new headwind holds even an above-bar score');
 const strong={...payload,picks:[{...pick,stockConviction:20,optionAdjustedConviction:20}]};
 assert.equal(topPicksMarket.revalidate(strong,assess('severe-risk-off'),{now:ms,live:true}).picks[0].entry.now,false,'a newer persisted regime must be compared with the publication');
 const mr=macro();mr.inputs.indexes.marketState='REGULAR';mr.inputs.vix.marketState='REGULAR';
 const current=assess('neutral',{macroRegime:mr});
 assert.equal(topPicksMarket.revalidate({...payload,rosterMeta:{...payload.rosterMeta,marketAssessment:current}},current,{now:ms+31*60000,live:true}).picks[0].entry.now,false);
 assert.equal(topPicksMarket.revalidate({...payload,rosterMeta:{...payload.rosterMeta,marketPublication:'offline-research'}},assess(),{now:ms}).picks[0].entry.now,false,'an offline regeneration cannot grant fresh stock permission');
});
check('live bond, dollar and commodity shocks use dated existing macro inputs',()=>{
 const quote={asOf:now};
 const legs={spy:{...quote,pctChange1d:0},qqq:{...quote,pctChange1d:0},vix:{...quote,value:18,pctChange1d:0},
  dxy:{...quote,pctChange1d:2},tenY:{...quote,bpsChange1d:20},twoY:{...quote,bpsChange1d:15},move:{...quote,value:150,pctChange1d:10},crude:{...quote,pctChange1d:9},gold:{...quote,pctChange1d:4}};
 const review=topPicksMarket.liveReview(assess(),legs,now);
 for(const k of ['dxy','yields','twoY','bondVol','commodity'])assert.equal(review.sourceAxes[k].score,-2);
 assert(['risk-off','severe-risk-off'].includes(review.state));
 const stale=topPicksMarket.liveReview(assess(),{...legs,crude:{...legs.crude,asOf:'2020-01-01'},gold:{...legs.gold,asOf:'2020-01-01'}},now);
 assert.equal(stale.sourceAxes.commodity,undefined,'expired commodity quotes cannot cast a new vote');
});
check('live price axes retain the existing market thresholds and weighted gauge',()=>{
 const backdrop={asOf:now,indexes:{asOf:now,spy:{pctChange1d:0},qqq:{pctChange1d:0}},vix:{asOf:now,value:18,trend:'flat',pctChange1d:0},dxy:{asOf:now,pctChange1d:0},tenY:{asOf:now,bpsChange1d:0},thirtyY:{asOf:now,bpsChange1d:0},twoY:{asOf:now,bpsChange1d:0},move:{asOf:now,value:95,pctChange1d:0},crude:{asOf:now,pctChange1d:0},gold:{asOf:now,pctChange1d:0}};
 const baseline=computeMacroRegime(backdrop);
 for(const direction of [-1,0,1]){
  const quote={asOf:now},legs={spy:{...quote,pctChange1d:direction*2},qqq:{...quote,pctChange1d:direction*2.5},vix:{...quote,value:direction<0?30:direction>0?14:18,pctChange1d:direction<0?20:direction>0?-20:0},
   dxy:{...quote,pctChange1d:-direction*1.5},tenY:{...quote,bpsChange1d:-direction*20},thirtyY:{...quote,bpsChange1d:-direction*20},twoY:{...quote,bpsChange1d:-direction*15},move:{...quote,value:direction<0?150:direction>0?75:95,pctChange1d:direction<0?10:0},crude:{...quote,pctChange1d:direction<0?9:0},gold:{...quote,pctChange1d:direction<0?4:0}};
  const live=topPicksMarket.liveReview(topPicksMarket.assess({macroRegime:baseline,asOf:now}),legs,now);
  const current={...backdrop,indexes:{asOf:now,spy:legs.spy,qqq:legs.qqq}};
  for(const k of ['vix','dxy','tenY','thirtyY','twoY','move','crude','gold'])current[k]={...backdrop[k],...legs[k]};
  const expected=computeMacroRegime(current);
  for(const k of ['indexes','vix','dxy','yields','twoY','bondVol','commodity'])assert.equal(live.sourceAxes[k].score,expected.axes[k].score,k);
  assert.equal(live.stress,expected.stress);assert.equal(live.state,expected.state);
 }
});
check('prospective comparison is idempotent, point-in-time and cannot invent historical outcomes',()=>{
 const at='2026-10-01T15:00:00Z';
 const decision={symbol:'AAA',side:'call',spot:100,marketState:'risk-off',selected:false,policies:{legacy:{eligible:true},labels:{eligible:true},combined:{eligible:false}}};
 let study=advanceMarketStudy(null,{decisions:[decision],builtAtIso:at,publication:true});
 study=advanceMarketStudy(study,{decisions:[decision],builtAtIso:at,publication:true});assert.equal(study.rows.length,1);assert.equal(study.runs.length,1);
 const c={AAA:{_bars:Array.from({length:20},(_,i)=>({date:'2026-10-'+String(i+2).padStart(2,'0'),c:99-i}))}};
 study=advanceMarketStudy(study,{chains:c,builtAtIso:'2026-10-08T00:00:00Z'});
 assert.equal(study.rows[0].outcomes[5].directionalReturnPct,-5);assert(!study.rows[0].outcomes[10]);
 const report=summarizeMarketStudy(study,5);assert.equal(report.avoidedLosers,1);assert.equal(report.missedWinners,0);assert.equal(report.policies[0].directionalWinRatePct,null);
 assert.equal(report.policies[0].meanModeledOptionRiskReturnPct,null);
 const empty=advanceMarketStudy(study,{decisions:[],publication:true,builtAtIso:'2026-10-09T15:00:00Z'});assert.equal(empty.reports[5].emptyRuns,2);
 const view=topPicksMarketClientFactory();assert(view.study(study,5).includes('not executed portfolios'));assert(view.scores({...pick,marketAdjustment:{...pick.marketAdjustment,marketState:'<script>'}}).includes('&lt;script&gt;'));
 assert(view.context(payload).includes('overlapping desks'));
 assert.equal(view.snapshot(pick,[]).entry.now,false,'an off-roster saved idea cannot retain a live market permission');
 assert.equal(view.snapshot(pick,[pick]),pick);assert.equal(pick.entry.now,true,'saved research is not mutated');
 const compact=marketStudyView(study);assert(!Object.hasOwn(compact,'rows'));assert(!Object.hasOwn(compact,'runs'));assert.deepEqual(compact.reports,study.reports);
 const gap=unavailableMarketStudyView(compact,{builtAtIso:at,publication:true});assert.equal(gap.collectionGaps,1);
 assert.equal(unavailableMarketStudyView(gap,{builtAtIso:at,publication:true}).collectionGaps,1,'an unavailable publication is counted once');
 assert(view.study(gap,5).includes('Measurement paused'));
});
check('measurement uses unique common sessions and correct expiry-day option payoffs',()=>{
 const at='2026-10-01T15:00:00Z',expiry=Date.parse('2026-10-06T00:00:00Z')/1000;
 const bars=Array.from({length:18},(_,i)=>({date:'2026-10-'+String(i+2).padStart(2,'0'),c:110}));
 const decision=symbol=>({symbol,side:'call',spot:100,policies:{legacy:{eligible:true},labels:{eligible:true},combined:{eligible:true}}});
 const leg=(qty,strike,type='call')=>({qty,strike,type,expiry,iv:.4});
 const decisions=[{...decision('AAA'),contract:{strike:100,expiry,iv:.4,mid:5}},
  {...decision('BBB'),contract:{structure:'debit_vertical',netDebit:5,maxLoss:5,legs:[leg(1,100),leg(-1,110)]}},
  {...decision('CCC'),side:'put',contract:{structure:'credit_vertical',netCredit:2,maxLoss:8,legs:[leg(-1,100,'put'),leg(1,90,'put')]}}];
 let study=advanceMarketStudy(null,{decisions,builtAtIso:at,publication:true});
 study=advanceMarketStudy(study,{builtAtIso:'2026-10-21T00:00:00Z',chains:{AAA:{_bars:[bars[0],...bars]},BBB:{_bars:bars},CCC:{_bars:bars},SPY:{_bars:bars}}});
 assert.deepEqual(study.rows.map(r=>r.outcomes[5].modeledOptionRiskReturnPct),[100,100,25]);
 assert(study.rows.every(r=>r.outcomes[10].modeledOptionRiskReturnPct===null),'a stock close after expiry cannot price an expired option');
 const missing=advanceMarketStudy(null,{decisions:[decision('AAA')],builtAtIso:at,publication:true});
 const report=advanceMarketStudy(missing,{builtAtIso:'2026-10-21T00:00:00Z',chains:{AAA:{_bars:bars.filter((_,i)=>i!==2)},SPY:{_bars:bars}}});
 assert(!report.rows[0].outcomes[5],'a missing stock session cannot slide the five-session target forward');
});

// Test the same durable request path used by the browser and mirror, with no
// storage/provider credentials and no broker calls.
const objects=new Map([['picks.json',JSON.stringify(payload)]]);
const memory={get:async k=>objects.has(k)?Buffer.from(objects.get(k)):null,put:async(k,v)=>objects.set(k,v),withLease:async(_k,fn)=>({busy:false,result:await fn(()=>{})})};
const shock={legs:{spy:{pctChange1d:-3,asOf:now},qqq:{pctChange1d:-4,asOf:now},vix:{value:35,pctChange1d:20,asOf:now}}};
let approved=await approvedTopPicks({store:memory,fetchLive:async()=>shock,now:()=>ms});assert(approved.picks[0].marketApproval.held);
approved=await approvedTopPicks({store:memory,fetchLive:async()=>({legs:{}}),now:()=>ms});assert(approved.picks[0].marketApproval.held);checks++;
// Ordinary shifts require distinct observations and persist through a cold
// request; a new coherent publication is the only reset.
objects.delete('top-picks-approval.json');
const ordinary=t=>({legs:{spy:{pctChange1d:-1,asOf:new Date(t).toISOString()},qqq:{pctChange1d:-1.4,asOf:new Date(t).toISOString()},vix:{value:22,pctChange1d:10,asOf:new Date(t).toISOString()}}});
let pending=await approvedTopPicks({store:memory,fetchLive:async()=>ordinary(ms),now:()=>ms});assert.equal(pending.marketConfirmationPending,true);assert.equal(pending.picks[0].entry.now,true);
pending=await approvedTopPicks({store:memory,fetchLive:async()=>ordinary(ms),now:()=>ms+60000});assert.equal(pending.picks[0].entry.now,true,'same quote does not confirm a new observation');
approved=await approvedTopPicks({store:memory,fetchLive:async()=>ordinary(ms+60000),now:()=>ms+60000});assert(approved.picks[0].marketApproval.held);checks++;
objects.set('picks.json',JSON.stringify({...payload,builtAtIso:new Date(ms+120000).toISOString()}));
approved=await approvedTopPicks({store:memory,fetchLive:async()=>({legs:{}}),now:()=>ms+120000});assert.equal(approved.picks[0].entry.now,true);checks++;
assert.equal(JSON.parse(objects.get('top-picks-approval.json')).publication,new Date(ms+120000).toISOString());
objects.set('picks.json',JSON.stringify(payload));
await assert.rejects(approvedTopPicks({store:memory,fetchLive:async()=>({legs:{}}),now:()=>ms+120000}),/Publication changed/);checks++;
objects.delete('top-picks-approval.json');
await assert.rejects(approvedTopPicks({store:memory,fetchLive:async()=>{objects.set('picks.json',JSON.stringify({...payload,builtAtIso:new Date(ms+120000).toISOString()}));return null;},now:()=>ms}),/Publication changed/);checks++;
const regularMacro=macro();for(const key of ['indexes','vix'])regularMacro.inputs[key].marketState='REGULAR';
const regularAssessment=assess('neutral',{macroRegime:regularMacro});
objects.delete('top-picks-approval.json');objects.set('picks.json',JSON.stringify({...payload,rosterMeta:{...payload.rosterMeta,marketAssessment:regularAssessment}}));
approved=await approvedTopPicks({store:memory,fetchLive:async()=>null,now:()=>ms+31*60000});assert(approved.picks[0].marketApproval.held);assert(!approved.marketConfirmationPending);checks++;
objects.set('top-picks-approval.json',JSON.stringify({publication:now,held:'malformed'}));
await assert.rejects(approvedTopPicks({store:memory,fetchLive:async()=>null,now:()=>ms}),/approval is malformed/);checks++;
approved=topPicksMarket.revalidate(payload,topPicksMarket.assess({asOf:now}),{now:ms,live:true});
const acc={open:[{symbol:'FIXTURE',side:'call',entryDate:now,marketAdjustment:{}}],closed:[]};
assert.equal(applyMarketAdmission(acc,approved,{trades:{}}).open.length,0);
assert.equal(applyMarketAdmission(acc,approved,{trades:{x:{symbol:'FIXTURE',side:'call',engineEntryIso:now}}}).open.length,1);checks++;
let reads=0;const env=process.env.PRIVATE_DATA_ENABLED;process.env.PRIVATE_DATA_ENABLED='1';
const handler=createTopPicksHandler({session:async()=>({tp:true,tr:false}),dataStore:{get(){reads++;throw Error('Must not read');}},quotes:async()=>{throw Error('Must not fetch');}});
const response={setHeader(){},status(code){this.code=code;return this;},json(v){this.body=v;return this;}};
await handler({method:'GET'},response);assert.equal(response.code,401);assert.equal(reads,0);checks++;
if(env==null)delete process.env.PRIVATE_DATA_ENABLED;else process.env.PRIVATE_DATA_ENABLED=env;
// Exercise the real publisher boundary: a new Top Picks rejection must not
// alter the pre-existing Unified Signal approval input.
const isolated=await mkdtemp(join(tmpdir(),'top-picks-consumer-'));
try{
 const old={builtAtIso:now,picks:[],rosterMeta:{aiVetoed:[]}},updated={builtAtIso:now,picks:[],rosterMeta:{aiVetoed:['AAA']},sharedResearch:old};
 await writeFile(join(isolated,'picks.json'),JSON.stringify(updated));
 const got=await publishUnifiedSignal({dataDir:isolated,builtAtIso:now,chains:{AAA:data},grades:{AAA:{total:10,side:'call',pillars:{}}}});
 const expected=buildUnifiedSignalEngine({builtAtIso:now,assessmentAtIso:now,chains:{AAA:data},grades:{AAA:{total:10,side:'call',pillars:{}}},picks:old,previous:null,forecast:null,ivTrending:null,scenario:null,evidence:null,quant:null,linkMap:null,rotation:null,gradeModelVersion:null});
 assert.deepEqual(got,expected);checks++;
}finally{await rm(isolated,{recursive:true,force:true});}
const storage=await mkdtemp(join(tmpdir(),'top-picks-study-'));
try{
 await mkdir(join(storage,'data'));
 let source=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
 source=source.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+|export\s*\{[^}]*\}\s*from\s+)(["'])([^"']+)\2/gm,(whole,prefix,quote,specifier)=>specifier.startsWith('node:')?whole:prefix+quote+(specifier.startsWith('.')?new URL(specifier,new URL('./build.mjs',import.meta.url)).href:import.meta.resolve(specifier))+quote);
 source=source.replace('const ROOT = resolve(__dirname, "..");','const ROOT = '+JSON.stringify(storage)+';');
 await writeFile(join(storage,'engine.mjs'),source);
 const engine=await import(pathToFileURL(join(storage,'engine.mjs')).href);
 const built=buildTopPicks({FIXTURE:data},[],null,null,{macroRegime:macro()},null,.045,{preScored:{scored:[structuredClone(row)],peerIndex:{},regimeBand:'neutral'},marketAssessment:assess(),aiThesisMap:{'FIXTURE:call':aiThesis}});
 const publication={builtAtIso:now,rosterMeta:built.rosterMeta,picks:built.map(p=>({...p,symbol:'AAPL'}))};
 await writeFile(join(storage,'data/picks.json'),JSON.stringify(publication));
 await engine.updatePicksAccuracyFile({AAPL:data,FIXTURE:data},now,{open:[],closed:[]});
 const record=JSON.parse(await readFile(join(storage,'data/picks-accuracy.json'),'utf8'));
 const study=JSON.parse(await readFile(join(storage,'data/top-picks-market-study.json'),'utf8'));
 assert.equal(record.open.length,1);assert.equal(record.open[0].stockConviction,12);
 assert.equal(record.marketStudy.rows,undefined);assert.equal(study.rows.length,1);
 assert.equal(record.marketStudy.reports[5].total,study.rows.length);
 const restored=await engine.readPicksAccuracyState();assert.equal(restored.marketStudy.rows.length,1);
 await engine.updatePicksAccuracyFile({AAPL:data,FIXTURE:data},now,restored,null,{enrollNewPicks:false});
 assert.equal(JSON.parse(await readFile(join(storage,'data/top-picks-market-study.json'),'utf8')).runs.length,1);
 await writeFile(join(storage,'data/top-picks-market-study.json'),'invalid JSON');
 const damaged=await engine.readPicksAccuracyState();assert(damaged.marketStudyUnavailable);assert.equal(damaged.open.length,1);
 await engine.updatePicksAccuracyFile({AAPL:data,FIXTURE:data},now,damaged,null,{enrollNewPicks:false});
 assert.equal(await readFile(join(storage,'data/top-picks-market-study.json'),'utf8'),'invalid JSON','damaged evidence cannot silently be overwritten');
 const paused=JSON.parse(await readFile(join(storage,'data/picks-accuracy.json'),'utf8'));assert(paused.marketStudy.unavailable);assert.equal(paused.open.length,1);
 await rm(join(storage,'data/top-picks-market-study.json'));
 const missing=await engine.readPicksAccuracyState();assert(missing.marketStudyUnavailable);assert.equal(missing.open.length,1);checks++;
 console.log('PASS actual enrollment persists compact reports and separate frozen history; a history failure pauses only measurement and preserves the trading record');
}finally{await rm(storage,{recursive:true,force:true});}
console.log(`${checks} Top Picks market checks passed, including roster, source adapters, shadow outcomes, durable holds, mirror admission and Owner access.`);

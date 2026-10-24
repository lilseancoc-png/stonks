import assert from 'node:assert/strict';
import vm from 'node:vm';
import {computeMacroRegime,computeHeadlineGeoTone,applyMacroRegimePersistence} from './build.mjs';
import {marketRefresh,marketRefreshFactory} from '../lib/market-refresh.mjs';
import {renderAppJs} from './render/app-js.mjs';
import {marketAnalysis} from '../lib/market-analysis.mjs';
import {buildScenarioEngine} from '../lib/scenario-engine.mjs';
const app=renderAppJs({riskFreeRate:.04});
const ctx=vm.createContext({marketAnalysis,Date,Math,console});
vm.runInContext(app.slice(app.indexOf('  function liveGlobalTapeAxis('),app.indexOf('  function macroStateMeta(')),ctx);
const healthy=()=>({asOf:new Date().toISOString(),
 indexes:{spy:{pctChange1d:0,pctChange5d:0,aboveSma20:true},qqq:{pctChange1d:0,pctChange5d:0,aboveSma20:true}},
 vix:{value:18,pctChange1d:0,trend:'flat'},vixTerm:{state:'contango'},dxy:{pctChange1d:0,pctChange5d:0,trend:'flat'},
 tenY:{value:4,bpsChange1d:0,bpsChange5d:0,trend:'flat'},thirtyY:{value:4.5,bpsChange1d:0},
 twoY:{value:3.8,bpsChange1d:0,bpsChange5d:0,trend:'flat'},move:{value:95,pctChange1d:0},
 crude:{pctChange1d:0,pctChange5d:0},gold:{pctChange1d:0,pctChange5d:0},
 breadth:{pctAbove200:55,pctAbove50:55,nhnl:0},putCall:{oiRatio:1.05,volRatio:1.05,totalVol:100,oiSum:1000},
 credit:{oas:4,oasChg5d:0,hygLqdChg1d:0,hygLqdChg5d:0,asOf:new Date().toISOString()},rotation:{spread:0}
});
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('empty and thin evidence cannot declare neutral or risk-on',()=>{
 assert.equal(computeMacroRegime({}).state,'insufficient-data');
 assert.equal(computeMacroRegime({vix:{value:14},move:{value:75}}).state,'insufficient-data');
});
check('partial provider responses do not crash or coerce unknowns to zero',()=>{
 for(const patch of [{dxy:{value:100,pctChange1d:null}},{breadth:{pctAbove200:null,pctAbove50:70}},{vix:{value:null}},{credit:{oas:null,hygLqdChg5d:1}}]) {
  const r=computeMacroRegime({...healthy(),...patch});assert(r);assert(Object.values(r.axes).every(a=>Number.isFinite(a.score)));
 }
 const r=computeMacroRegime({...healthy(),breadth:{pctAbove200:null,pctAbove50:70}});assert.equal(r.inputs.breadth.pctAbove200,null);assert.equal(r.axes.breadth.available,false);
});
check('daily return uses quote previous close with and without a current history bar',()=>{
 const q={regularMarketPrice:100,regularMarketPreviousClose:99,regularMarketTime:new Date('2026-10-23T20:00:00Z')};
 const rows=[{date:new Date('2026-10-21T12:00Z'),close:98},{date:new Date('2026-10-22T12:00Z'),close:99}];
 const a=marketAnalysis.dailyMoves(q,rows),b=marketAnalysis.dailyMoves(q,[...rows,{date:new Date('2026-10-23T12:00Z'),close:100}]);
 assert.equal(a.prior1d,99);assert.equal(a.pctChange1d,b.pctChange1d);assert(Math.abs(a.pctChange1d-1.010101)<1e-5);assert.equal(a.prior5d,null);
});
check('Unix seconds, milliseconds and Date inputs normalize to the same instant',()=>{
 const ms=Date.parse('2026-10-23T20:00:00Z');assert.equal(marketAnalysis.timestamp(ms/1000),marketAnalysis.timestamp(new Date(ms)));assert.equal(marketAnalysis.timestamp(ms),marketAnalysis.timestamp(new Date(ms)));
});
check('de-escalation and nuclear-energy headlines do not cast conflict votes',()=>{
 for(const title of ['Iran and Israel agree ceasefire to end war','Trade deal removes tariffs after peace agreement','Air strikes cancelled as troops withdraw','Nuclear power stocks rally on reactor demand'])assert.equal(computeHeadlineGeoTone([{title,date:new Date().toISOString()}]).score,0,title);
 assert(computeHeadlineGeoTone([{title:'Ceasefire collapses as missile attacks resume',date:new Date().toISOString()}]).score<0);
});
check('OAS alone owns the credit vote and an ETF-only read remains missing',()=>{
 const b=healthy();b.credit.hygLqdChg5d=-20;assert.equal(computeMacroRegime(b).axes.credit.score,0);
 b.credit.oas=8;const r=computeMacroRegime(b);assert.equal(r.axes.credit.score,-2);assert.equal(marketAnalysis.contributions(r,r.thresholds).find(x=>x.key==='credit').contribution,-2.5);
 b.credit.oas=null;assert.equal(computeMacroRegime(b).axes.credit.available,false);
});
check('falling yields during a sell-off do not fabricate an easing vote',()=>{
 const b=healthy();b.indexes.spy.pctChange1d=b.indexes.qqq.pctChange1d=-3;b.tenY.bpsChange1d=b.twoY.bpsChange1d=-20;b.vix.value=35;
 const r=computeMacroRegime(b);assert.equal(r.axes.yields.score,0);assert.equal(r.axes.twoY.score,0);
});
check('opposite index moves are labeled mixed, not broad',()=>{
 const b=healthy();b.indexes.spy.pctChange1d=-1.5;b.indexes.qqq.pctChange1d=2.5;assert.match(computeMacroRegime(b).axes.indexes.label,/mixed index leadership/);
});
check('live details carry the input used by their actual vote',()=>{
 const b=computeMacroRegime(healthy());const r=ctx.computeLiveMacroRegime(b,{vix:{value:30,pctChange1d:10,asOf:new Date().toISOString(),marketState:'REGULAR'}});
 assert.match(r.axes.vix.label,/30.0/);assert.equal(r.inputs.vix.value,30);assert.equal(r.inputs.vix.pctChange1d,10);
});
check('old or untimestamped quotes do not become checked inputs',()=>{
 const b=computeMacroRegime(healthy());for(const asOf of ['2020-01-01',null]){const r=ctx.computeLiveMacroRegime(b,{vix:{value:35,asOf,marketState:'REGULAR'}});assert.equal(r.inputs.vix.value,18);assert.equal(r.axes.vix.live,false);assert.equal(r.live,false);}
});
check('missing core evidence cannot generate scenario forecasts',()=>{
 const r=buildScenarioEngine({macroRegime:computeMacroRegime({})});assert.equal(r.unavailable,true);assert.equal(r.transition.probabilities,null);assert.equal(r.scenarios.length,0);
});
let seed=7139;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const pick=a=>a[Math.floor(rnd()*a.length)];
check('2000 ordinary and stressed input combinations preserve server/browser scoring',()=>{
 for(let i=0;i<2000;i++){
  const b=healthy();for(const k of ['spy','qqq'])b.indexes[k]={pctChange1d:pick([-3,-1.8,-.8,0,.8,1.8,3]),pctChange5d:pick([-5,0,5]),aboveSma20:rnd()>.5};
  b.vix={value:pick([12,16.5,18,20,25,30]),pctChange1d:pick([-10,0,10]),trend:pick(['rising','falling','flat'])};
  b.dxy={pctChange1d:pick([-1.2,-.6,0,.6,1.2]),pctChange5d:pick([-2,0,2]),trend:pick(['rising','falling','flat'])};
  for(const k of ['tenY','thirtyY','twoY'])b[k]={value:4,bpsChange1d:pick([-20,-10,0,10,20]),bpsChange5d:pick([-20,0,20]),trend:pick(['rising','falling','flat'])};
  for(const k of ['crude','gold'])b[k]={pctChange1d:pick([-8,0,3,4,8]),pctChange5d:pick([-10,0,6,12])};
  b.move={value:pick([70,95,110,140]),pctChange1d:pick([-10,0,10])};b.breadth={pctAbove200:pick([20,40,55,65,85]),pctAbove50:pick([20,65,85]),nhnl:pick([-15,0,25])};
  b.credit={oas:pick([2.5,4,6,8]),oasChg5d:pick([-.3,0,.3,.6]),hygLqdChg5d:pick([-2,0,2])};b.rotation={spread:pick([-2,0,2])};
  const server=computeMacroRegime(b),live=ctx.computeLiveMacroRegime(server,{});
  assert.equal(live.state,server.state,'state '+i);assert.equal(live.stress,server.stress,'stress '+i);
  for(const key of Object.keys(server.axes))assert.equal(live.axes[key].score,server.axes[key].score,'axis '+key+' '+i);
  const sum=marketAnalysis.contributions(server,server.thresholds).reduce((sum,row)=>sum+(row.contribution??0),0);assert(Math.abs(sum-server.stress)<=.051);
 }
});
check('fresh index quotes recover an old source without using the expired peer',()=>{
 const baked=computeMacroRegime(healthy());baked.builtAtIso='2020-01-01T12:00:00Z';
 for(const value of Object.values(baked.inputs))if(value)value.asOf=baked.builtAtIso;
 const asOf=new Date().toISOString();
 const live=ctx.computeLiveMacroRegime(baked,{spy:{value:100,pctChange1d:1,asOf,marketState:'REGULAR'},vix:{value:14,asOf,marketState:'REGULAR'},dxy:{pctChange1d:0,asOf,marketState:'REGULAR'}});
 assert.equal(live.axes.indexes.available,true);assert.match(live.axes.indexes.label,/single-index/);
 assert.equal(live.inputs.indexes.asOf,asOf);assert.equal(live.inputs.indexes.qqq.pctChange1d,undefined);
 assert.equal(live.axes.vix.available,true);assert.equal(live.dataQuality.sufficient,true);
});
check('saved recovery holds preserve defensive drivers and exposure limits',()=>{
 const previous={state:'risk-off',drivers:['Credit stress'],grossMult:.65};
 const held=applyMacroRegimePersistence({state:'risk-on',drivers:['Calm VIX'],grossMult:1},previous);
 assert.equal(held.state,'risk-off');assert.deepEqual(held.drivers,previous.drivers);assert.equal(held.grossMult,.65);
});
check('failed peace talks are not mistaken for de-escalation',()=>{
 for(const title of ['No ceasefire after missile attacks','Peace talks fail as war continues','Ceasefire talks stall amid renewed air strikes'])assert(computeHeadlineGeoTone([{title,date:new Date().toISOString()}]).score<0,title);
});
check('unchanged deployments and hidden panes produce no automatic reads',()=>{
 const state=marketRefresh.create();marketRefresh.observe(state,'dpl_A');
 for(let i=1;i<2880;i++){
  marketRefresh.observe(state,'dpl_A');
  assert.equal(marketRefresh.begin(state,{now:i*30000,visible:true}),false);
 }
 marketRefresh.observe(state,'dpl_B');
 assert.equal(marketRefresh.begin(state,{now:86400000,visible:false}),false);
 assert.equal(state.attempts.length,0);
});
check('deployment storms stay below 12 reads in every rolling day and do not overlap',()=>{
 const state=marketRefresh.create();marketRefresh.observe(state,'dpl_A');
 let count=0;
 for(let now=1;now<=3*86400000;now+=30000){
  marketRefresh.observe(state,'dpl_'+now);
  if(marketRefresh.begin(state,{now,visible:true})){
   count++;assert.equal(marketRefresh.begin(state,{now,visible:true}),false);
   marketRefresh.finish(state,{now,ok:true});
  }
  assert(state.attempts.length<=12);
 }
 assert.equal(count,36);assert.equal(marketRefresh.limits.maxReads,12);
});
check('one delayed retry consumes the same budget and then stops',()=>{
 const state=marketRefresh.create();marketRefresh.noteInitial(state,1000000);
 marketRefresh.observe(state,'dpl_A');marketRefresh.observe(state,'dpl_B');
 const now=1000000+marketRefresh.limits.gapMs;
 assert(marketRefresh.begin(state,{now,visible:true}));marketRefresh.finish(state,{now,ok:false});
 assert.equal(marketRefresh.begin(state,{now:now+299999,visible:true}),false);
 assert(marketRefresh.begin(state,{now:now+300000,visible:true}));marketRefresh.finish(state,{now:now+300000,ok:false});
 for(let i=1;i<2880;i++)assert.equal(marketRefresh.begin(state,{now:now+300000+i*30000,visible:true}),false);
 assert(state.attempts.length<=2); // old attempts age out, no recurring retries
});
check('activation TTL and persisted budgets survive page reload',()=>{
 const state=marketRefresh.create();marketRefresh.noteInitial(state,1000000);
 assert.equal(marketRefresh.begin(state,{now:1899999,visible:true,reason:'activate'}),false);
 assert(marketRefresh.begin(state,{now:1900000,visible:true,reason:'activate'}));
 const restored=marketRefresh.create(JSON.parse(JSON.stringify(state)),1900000);
 assert.equal(restored.attempts.length,1);assert.equal(restored.inFlight,false);
 assert.equal(marketRefresh.begin(restored,{now:1900001,visible:true,reason:'activate'}),false);
});
check('new deployment signals during a request are retained without cached-ID flapping',()=>{
 const state=marketRefresh.create();marketRefresh.observe(state,'dpl_A');marketRefresh.observe(state,'dpl_B');
 assert(marketRefresh.begin(state,{now:1000000,visible:true}));
 marketRefresh.observe(state,'dpl_C');marketRefresh.finish(state,{now:1000000,ok:true});assert.equal(state.pending,true);
 marketRefresh.observe(state,'dpl_A');assert.equal(state.seen.at(-1),'dpl_C');
});
check('snapshots reject malformed, future and older data and accept cohesive updates',()=>{
 const now=Date.now(),iso=(offset)=>new Date(now+offset).toISOString();
 const current={builtAtIso:iso(-600000),macroRegime:computeMacroRegime(healthy())};
 assert.equal(marketRefresh.compareSnapshot(null,current,now),'newer');
 assert.equal(marketRefresh.compareSnapshot(current,current,now),'same');
 assert.equal(marketRefresh.compareSnapshot(current,{...current,builtAtIso:iso(-700000)},now),'older');
 assert.equal(marketRefresh.compareSnapshot(current,{...current,refreshedAtIso:iso(-1000)},now),'newer');
 for(const candidate of [{}, {...current,macroRegime:{}}, {...current,builtAtIso:iso(600001)}, {...current,refreshedAtIso:'invalid'}])assert.equal(marketRefresh.compareSnapshot(current,candidate,now),'invalid');
});
check('sentiment details show live components and preserve the actual fallback reference',()=>{
 const now=new Date().toISOString();
 const merged=marketAnalysis.mergedInputs({inputs:{sentiment:{score:20,prev:25,breadth:30,credit:30,month:50,rating:'extreme fear'}}},
  {fng:{score:70,prevClose:null,breadth:65,credit:60,month:55,asOf:now}});
 assert.equal(merged.sentiment.score,70);assert.equal(merged.sentiment.prev,25);
 assert.equal(merged.sentiment.breadth,65);assert.equal(merged.sentiment.credit,60);assert.equal(merged.sentiment.rating,null);
});
check('expired volatility cannot confirm a gold risk-off interpretation',()=>{
 const backdrop=healthy();backdrop.vix={value:35,asOf:'2020-01-01T12:00:00Z'};
 backdrop.gold={pctChange1d:4,pctChange5d:0};
 const regime=computeMacroRegime(backdrop);assert.equal(regime.axes.vix.available,false);
 assert.equal(regime.axes.commodity.score,0);assert.equal(regime.state,'insufficient-data');
});

// Exercise the real generated loader, not only the pure policy.
let clock=Date.now(),requests=0,renders=0;
class TestDate extends Date {static now(){return clock;}}
const initial={builtAtIso:new Date(clock-600000).toISOString(),macroRegime:computeMacroRegime(healthy())};
let reply=initial,fail=false;
const pane={hidden:false};
const loader=vm.createContext({Date:TestDate,marketRefresh,HAS_OWNER_ACCESS:true,AbortController,setTimeout,clearTimeout,
 document:{hidden:false,getElementById:(id)=>id==='page-pane-market'?pane:null},
 sessionStorage:{getItem:()=>null,setItem:()=>{}},dataUrl:(key)=>key,
 fetch:async()=>{requests++;if(fail)throw new Error('synthetic outage');return {ok:true,json:async()=>reply};},
 rendered:()=>{renders++;},console});
vm.runInContext('marketRefresh = ('+marketRefreshFactory.toString()+')();\n'+app.slice(app.indexOf('  var marketState = { data:'),app.indexOf('  var scenarioState ='))+
 app.slice(app.indexOf('  function renderMarketLoadStatus('),app.indexOf('  function renderMacroTape('))+
 '\nrenderMarketAnalysis = rendered;',loader);
await loader.loadMarketAnalysis();assert.equal(requests,1);assert.equal(loader.marketState.data.builtAtIso,initial.builtAtIso);
loader.maybeRefreshMarket('poll','dpl_A');assert.equal(requests,1);
clock+=900000;reply={...initial,builtAtIso:new Date(clock).toISOString(),scenarioEngine:{version:99}};
loader.maybeRefreshMarket('poll','dpl_B');
await new Promise(setImmediate);
assert.equal(requests,2);assert.equal(loader.marketState.data.scenarioEngine.version,99);
const retained=loader.marketState.data;
clock+=900000;fail=true;loader.maybeRefreshMarket('poll','dpl_C');await new Promise(setImmediate);
assert.equal(loader.marketState.data,retained);assert.match(loader.marketState.error,/previous snapshot/);
clock+=300000;loader.maybeRefreshMarket('poll','dpl_C');await new Promise(setImmediate);assert.equal(requests,4);
clock+=900000;loader.maybeRefreshMarket('poll','dpl_C');await new Promise(setImmediate);assert.equal(requests,4);
// The visible Retry control must work even when old data remains loaded.
fail=false;reply={...initial,builtAtIso:new Date(clock).toISOString()};
await loader.loadMarketAnalysis({retry:true});assert.equal(requests,5);assert.equal(loader.marketState.error,null);
await loader.loadMarketAnalysis({retry:true});assert.equal(requests,5);
assert(renders>=5);
console.log(`PASS generated loader: atomic refresh, retained snapshot, bounded failure retry and working manual retry`);
let quoteRequests=0,quoteVisible=true;
const quote=vm.createContext({Date:TestDate,AbortController,setTimeout,clearTimeout,
 marketPaneVisible:()=>quoteVisible,macroTape:{},MACRO_TAPE_POLL_MS:30000,
 fetch:async()=>{quoteRequests++;return {ok:true,json:async()=>({legs:{},deploymentId:'dpl_quote'})};},
 maybeRefreshMarket:()=>{},renderMacroTape:()=>{},barometerLive:{}});
vm.runInContext(app.slice(app.indexOf('  function pollMacroTapeOnce('),app.indexOf('  function startMacroTapeLive(')),quote);
quote.pollMacroTapeOnce();quote.pollMacroTapeOnce();await new Promise(setImmediate);assert.equal(quoteRequests,1);
quote.pollMacroTapeOnce();await new Promise(setImmediate);assert.equal(quoteRequests,1);
clock+=30000;quoteVisible=false;quote.pollMacroTapeOnce();assert.equal(quoteRequests,1);
quoteVisible=true;quote.pollMacroTapeOnce();await new Promise(setImmediate);assert.equal(quoteRequests,2);
console.log('PASS generated quote poll: no overlapping or rapid duplicate requests; hidden pane pauses');
console.log(`${checks+2} market review checks passed, including 2000 scoring cases and 3 days of refresh simulation.`);

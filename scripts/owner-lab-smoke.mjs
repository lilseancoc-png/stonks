// Offline behavior checks. No provider calls, credentials or remote writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildEvidenceRecord, addCalendarDays, runEvidenceRecord } from '../lib/evidence-record.mjs';
import { buildQuantPayload, pickExitPolicy } from './build.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { leveragedEntryPlan } from '../lib/research-display.mjs';
import { evidenceBody, linkResults, EVIDENCE_LABELS } from '../js/book-views.js';

const app = renderAppJs({});
const book = await readFile(new URL('../js/book-views.js', import.meta.url), 'utf8');
function block(source, first, next) {
  const start = source.indexOf(first), end = source.indexOf(next, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return source.slice(start, end);
}
const day = '2026-10-22';
const base = {spot:100,technicals:{sr:{s20:90,r20:110}}};
const short = buildEvidenceRecord({chains:{NVDA:base}}, {bakeDate:day});
assert.equal(short.version,2);
assert.equal(short.names.NVDA[0].id,'sr-pos');
assert.equal(short.names.NVDA[0].dir,'pending');
const history = Array.from({length:20},(_,i)=>({date:addCalendarDays(day,-i-1),names:{NVDA:[{id:'sr-pos',v:i%2?40:60,dir:'neutral',firstSeen:addCalendarDays(day,-30)}]}}));
const normal=buildEvidenceRecord({chains:{NVDA:base}},{bakeDate:day,priorRecords:history});
assert.equal(normal.names.NVDA[0].dir,'neutral');
const legacyHistory=history.map(record=>({...record,names:{NVDA:record.names.NVDA.map(p=>({...p,id:'structure'}))}}));
assert.equal(buildEvidenceRecord({chains:{NVDA:base}},{bakeDate:day,priorRecords:legacyHistory}).names.NVDA[0].dir,'pending');
const earningsCases=[
  [{chains:{NVDA:{...base,earningsHx:{next:{date:'2026-10-25',daysUntil:3,pre10Pct:8}}}}},'earn-pre'],
  [{chains:{NVDA:{...base,earningsHx:{events:[{date:'2026-10-21',surprisePct:8}]}}}},'earn-eps'],
  [{chains:{NVDA:base},earningsCalls:{calls:{NVDA:{callDate:'2026-10-21',mgmtTone:'optimistic'}}}},'earn-tone'],
];
for (const [sources,id] of earningsCases) {
  const record=buildEvidenceRecord(sources,{bakeDate:day});
  assert.ok(record.names.NVDA.some(p=>p.id===id));
  for (const piece of record.names.NVDA) assert.ok(EVIDENCE_LABELS[piece.id],piece.id);
}
let reads=0; const writes=[];
await runEvidenceRecord({store:{get:async()=>{reads++;return null;},put:async(key)=>writes.push(key)},bakeDate:day,sources:{chains:{NVDA:base}}});
assert.equal(reads,61,'same bounded history reads');
assert.deepEqual(writes,['evidence/2026-10-22.json','evidence-latest.json'],'same two objects; no new storage family');
assert.match(evidenceBody(short,'NVDA'),/Collecting history/);
assert.match(evidenceBody(normal,'NVDA'),/No unusual deviation recorded/);
assert.match(evidenceBody({...short,version:undefined,names:{NVDA:[{id:'earnings',v:1,dir:'neutral',str:0}]}},'NVDA'),/Legacy metric/);
assert.match(evidenceBody({date:day,names:{NVDA:[{id:'news',v:0,dir:'neutral',str:0}]}},'NVDA'),/Baseline status unavailable/);
assert.doesNotMatch(evidenceBody(short,''),/<article/,'no alphabetical dump');
assert.match(evidenceBody({...short,names:{NVDA:[{id:'news',src:'<script>',v:0,dir:'neutral'}]}},'NVDA'),/&lt;script&gt;/);

const bars=Array.from({length:100},(_,i)=>({t:addCalendarDays('2026-07-01',i),c:100*Math.exp(i*.001+.01*Math.sin(i))}));
const ivHistory=new Map([['NVDA',{entries:bars.slice(31).map(b=>({date:b.t,iv:.2}))}]]);
const quant=buildQuantPayload({NVDA:{spot:100,_bars:bars,ivRank:{iv:.5,asOf:'2026-10-22',pctile:99}}},ivHistory,{},null,'2026-10-22T15:00:00Z').payload;
const vrp=quant.vrp.rows[0];
assert.ok(vrp);
assert.ok(Math.abs(vrp.iv30-vrp.rv30-vrp.vrp)<=.02,'all displayed VRP components use one observation');
assert.equal(vrp.iv30,20);
assert.equal(vrp.asOf,bars.at(-1).t);
assert.equal(vrp.ivPctile,null,'do not attach a percentile from another date');

const [_, tp, stop] = app.match(/var POS_TP = (\d+), POS_STOP = (\d+)/);
assert.equal(Number(tp),pickExitPolicy().takeProfitPct,'position checker matches the current engine target');
assert.equal(Number(stop),pickExitPolicy().stopPct);
const pos=vm.createContext({POS_TP:Number(tp),POS_STOP:Number(stop),RFR:.04,chainExpiryCloseEpochSec:x=>x+16*3600,posContext:()=>({factors:[]}),posState:{chain:{}},picksGradesState:{data:{grades:{NVDA:{total:10,pillars:{timing:{state:'go'}}}}}}});
vm.runInContext(block(app,'function posMarkInfo(m){','  // Render the gathered context'),pos);
const position={sym:'NVDA',side:'call',strike:100,exp:Date.now()/1000+86400*30,entry:5,qty:1};
assert.equal(pos.posDecision({...position,mark:{bid:0,ask:0,last:0,iv:0,spot:100}}).action,'PRICE UNAVAILABLE');
assert.equal(pos.posDecision({...position,mark:{bid:4,ask:6,last:5,iv:0,spot:100,src:'live',marketState:'REGULAR',fetchedAt:new Date().toISOString()}}).action,'HOLD');
for (const mark of [{bid:4,ask:6,last:5,src:'build',marketState:'REGULAR'},{bid:0,ask:0,last:5,src:'live',marketState:'REGULAR'},{bid:6,ask:4,last:5,src:'live',marketState:'REGULAR'},{bid:4,ask:6,src:'live',marketState:'CLOSED'},{bid:4,ask:6,src:'live',marketState:'REGULAR',fetchedAt:new Date(Date.now()-600000).toISOString()}]) assert.equal(pos.posDecision({...position,mark:{...mark,iv:0,spot:100}}).action,'REFERENCE ONLY');
const currentMark={bid:6.05,ask:6.15,iv:0,spot:100,src:'live',marketState:'REGULAR',fetchedAt:new Date().toISOString()};
assert.equal(pos.posDecision({...position,mark:currentMark}).action,'HOLD','22% remains below the current 25% target');
assert.equal(pos.posDecision({...position,mark:{...currentMark,bid:6.25,ask:6.35}}).action,'SELL / TAKE PROFIT');
assert.doesNotMatch(app,/Mark is the live mid/);

const lev=vm.createContext({leveragedEntryPlan,escapeHtml:x=>String(x)});
vm.runInContext(block(app,'function levDecision(i){','  function levIsNow'),lev);
vm.runInContext(block(app,'function levSizeHtml(i){','  function levCard'),lev);
const idea={etf:'TEST',direction:'bull',leverage:2,entry:{state:'wait'},under:{spot:100},plan:{entry:{now:false,trigger:100},invalidation:{underlyingPx:90},target:{underlyingPx:120}}};
assert.match(lev.levSizeHtml(idea),/data-lev-decision="wait"/);
assert.match(lev.levSizeHtml({...idea,entry:{state:'avoid'}}),/No size/);
assert.doesNotMatch(lev.levSizeHtml({...idea,plan:{...idea.plan,target:{underlyingPx:105}}}),/data-lev-size/);

let advancedOpen=false;
const root={innerHTML:'',hidden:false,querySelector:selector=>selector==='#quant-advanced'?{open:advancedOpen}:null,querySelectorAll:()=>[]};
const elements={'quant-root':root,'quant-empty':{hidden:true},'quant-eyebrow':{}};
const render=vm.createContext({$:id=>elements[id],escapeHtml:x=>String(x),symGradeHref:s=>'?s='+s,bindBriefChips:()=>{},quantState:{data:null},quantPairsAll:false});
vm.runInContext(block(app,'function quantSymLink(sym){','  function ivtFreshnessMeta'),render);
for (const data of [{date:day,ped:{rows:[{t:'NVDA',movePct:3,driftSoFar:1,daysSince:1}]}},{date:day,dispersion:{idxIv:20,basketIv:30,impliedCorr:.44}},{date:day,sigma:{rows:[]},pairs:{rows:[]}}]) {
  render.quantState.data=data; render.renderQuant(); assert.equal(root.hidden,false);
}
assert.match(root.innerHTML,/Qualified relationships/);
render.quantState.data={date:day,pairs:{rows:[]},vrp:{richZ:1.5,rows:[{t:'NVDA',iv30:30,rv30:20,vrp:10,z:2,asOf:day}]}};
render.renderQuant();
assert.equal((root.innerHTML.match(/class="quant-sym"/g)||[]).length,1,'a rich company is not repeated as cheap in a thin universe');
assert.match(root.innerHTML,/No company clears the 1.5σ cheap threshold/);
advancedOpen=true; render.renderQuant();
assert.match(root.innerHTML,/<details id="quant-advanced"[^>]* open>/,'changing the filter or refreshing keeps the open results visible');

const map={nodes:{'ticker:NVDA':{type:'ticker',symbol:'NVDA',label:'Nvidia'},'ticker:TSM':{type:'ticker',symbol:'TSM',label:'TSMC'}},edges:[{from:'ticker:TSM',to:'ticker:NVDA',kind:'overnight-peer',src:'global-peer-groups',asOf:day}]};
const links=linkResults(map,{tickers:[{t:'NVDA',ch:2,perf:{'1w':3}}]},{query:'NVDA',node:''});
assert.match(links,/<b>NVDA<\/b>/,'the searched company remains the company even on incoming peer links');
assert.match(links,/TSMC/);
assert.match(links,/Overnight market peer/);

// Drive the actual diagnostic loader with fixture HTTP responses and a small
// DOM boundary. This proves closed views do not issue storage requests.
class Element {
  constructor(){this.hidden=false;this._html='';this.panel=null;}
  set innerHTML(value){this._html=value;this.panel=/data-book-panel/.test(value)?{open:/<details[^>]*\sopen>/.test(value)}:null;}
  get innerHTML(){return this._html;}
  querySelector(selector){return selector==='[data-book-panel]'?this.panel:null;}
}
const dom=Object.fromEntries(['book-evidence','book-link','book-rejections','owner-panel-diagnostics','owner-diagnostics-status'].map(id=>[id,new Element()]));
dom['owner-panel-diagnostics'].hidden=true;
const requests=[];
const fixture={
  'evidence-latest.json':{key:'evidence/'+day+'.json'},['evidence/'+day+'.json']:short,
  'ai-rejections-latest.json':{key:'ai-rejections/'+day+'.json'},['ai-rejections/'+day+'.json']:{date:day,passed:[{sym:'NVDA',side:'call',grade:'strong',entryVerdict:'wait',total:10,spot:100}],records:[{sym:'NVDA',side:'call',grade:'strong',kind:'wait',entryReason:'Wait for confirmation',total:10,spot:100}]},
};
const listeners={};
const browser=vm.createContext({URLSearchParams,Intl,Date,setTimeout,window:{location:{search:'?tab=quant'}},fetch:async(url)=>{const key=new URL(url,'http://fixture').searchParams.get('data')||String(url).replace(/^data\//,'');requests.push(key);return {ok:!!fixture[key],status:fixture[key]?200:404,json:async()=>fixture[key]};}});
vm.runInContext(book.replace(/^export \{[^\n]+\};?$/m,''),browser);
browser.document={getElementById:id=>dom[id]||null,querySelector:()=>null,activeElement:null,readyState:'complete',addEventListener:(type,handler)=>{listeners[type]=handler;}};
browser.openTab('quant'); assert.equal(requests.length,0);
dom['owner-panel-diagnostics'].hidden=false; browser.openTab('quant'); assert.equal(requests.length,0);
assert.match(dom['book-evidence'].innerHTML,/Open to load/);
vm.runInContext('state.open["book-evidence"]=true;',browser);
await browser.renderEvidence(); assert.equal(requests.length,2);
await browser.renderEvidence(); assert.equal(requests.length,2,'search and rerenders reuse the snapshot');
await browser.refreshOwnerRecords('book-evidence'); assert.equal(requests.length,4,'only an explicit refresh repeats the two reads');
assert.ok(!requests.includes('link-map.json'));
let releaseLoad;
const loadGate=new Promise(resolve=>{releaseLoad=resolve;});
const normalFetch=browser.fetch;
browser.fetch=async(...args)=>{await loadGate;return normalFetch(...args);};
vm.runInContext('for (const key of cache.keys()) if (isOwnerKey(key)) cache.delete(key);',browser);
const pendingLoad=browser.loadOwnerRecord('book-evidence');
const pendingCount=requests.length;
await browser.refreshOwnerRecords('book-evidence');
assert.equal(requests.length,pendingCount,'refresh cannot duplicate a pending initial record load');
releaseLoad(); await pendingLoad; browser.fetch=normalFetch;
vm.runInContext('state.open["book-rejections"]=true;',browser);
await browser.renderRejections();
assert.match(dom['book-rejections'].innerHTML,/1 company\/side decision</);
assert.match(dom['book-rejections'].innerHTML,/<td>Passed<\/td>/);
assert.match(dom['book-rejections'].innerHTML,/<td>Wait for entry<\/td>/);
assert.match(dom['book-rejections'].innerHTML,/Wait for confirmation/);
await browser.refreshOwnerRecords('book-evidence');
const afterEvidenceRefresh=requests.length;
await browser.renderRejections();
assert.equal(requests.length,afterEvidenceRefresh,'refreshing evidence preserves the loaded grader snapshot and avoids extra reads');
console.log('Owner Lab smoke passed: pricing, eligibility, metric history, aligned VRP, partial snapshots, readable records and bounded on-demand reads.');

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pickDisplayDecision, shareEntryPayoff, pickReviewCheckpoint, scenarioEventPhase } from '../lib/research-display.mjs';

export function verifyResearchDisplay(appJs) {
  const be = { symbol:'BE', group:'watch', entry:{now:false, headline:'Wait for reset',trigger:239.05}, contract:{expiry:Date.parse('2026-11-20T21:00:00Z')/1000}, entryPlan:{stance:'full',strategy:{name:'Full entry',blurb:'Full size OK'},tranches:[{label:'Enter now',price:251.63,size:'100%'}]} };
  assert.equal(pickDisplayDecision(be).ready, false);
  const ready = {...be,group:'actionable',entry:{now:true,headline:'Confirmed'}};
  assert.equal(pickDisplayDecision(ready).ready, true);
  for (const p of [{...ready,entryTiming:{hardWait:true}},{...ready,entryTiming:{hardVeto:true}},{...ready,strategy:{type:'none'}},{...ready,contract:null},{...ready,entry:{now:false}}]) assert.equal(pickDisplayDecision(p).ready,false);
  assert.equal(pickDisplayDecision({...ready,entryTiming:{state:'wait'},entry:{now:true,basis:'ai-final-grader'}}).ready,true);
  const gd = shareEntryPayoff({action:{key:'wait'},entry:{price:380.06},target:{price:377.91},review:{price:358.07}});
  assert.equal(gd.rr,null);
  assert.ok(gd.upsidePct < 0);
  assert.match(gd.warning,/at or below/);
  assert.equal(shareEntryPayoff({action:{key:'starter'},entry:{price:100},target:{price:120},review:{price:90}}).rr.toFixed(2),'2.00');
  assert.equal(shareEntryPayoff({action:{key:'research'},entry:{price:100},target:{price:120},review:{price:90}}).rr,null);
  assert.equal(shareEntryPayoff({entry:{price:null},target:{price:120},review:{price:90}}).rr,null);
  assert.equal(shareEntryPayoff({entry:{price:100},target:{price:120},review:{price:101}}).rr,null);
  assert.equal(pickReviewCheckpoint(be,Date.parse('2026-09-04')).date,'2026-11-06');
  assert.equal(pickReviewCheckpoint(be,Date.parse('2026-11-07')).due,true);
  assert.equal(pickReviewCheckpoint({contract:{}}),null);
  assert.equal(pickReviewCheckpoint(be,Date.parse('2026-11-21')).expired,true);
  const jobs = {date:'2026-09-04',window:'08:30 ET'};
  assert.equal(scenarioEventPhase(jobs,Date.parse('2026-09-04T12:29:00Z')),'upcoming');
  assert.equal(scenarioEventPhase(jobs,Date.parse('2026-09-04T12:30:00Z')),'past');
  assert.equal(scenarioEventPhase({date:'2026-09-04',window:'PM'},Date.parse('2026-09-05T01:00:00Z')),'today');
  assert.equal(scenarioEventPhase({date:'2026-09-05',window:'today'},Date.parse('2026-09-05T01:00:00Z')),'upcoming');
  assert.equal(scenarioEventPhase({date:'2026-12-04',window:'08:30 ET'},Date.parse('2026-12-04T13:00:00Z')),'upcoming');

  const section = (start,end) => appJs.slice(appJs.indexOf(start),appJs.indexOf(end,appJs.indexOf(start)));
  const context = {pickDisplayDecision,pickReviewCheckpoint,escapeHtml:x=>String(x),Date};
  vm.createContext(context);
  vm.runInContext(section('  function pickEntryPlanHtml(', '  function pickExitPlanHtml('),context);
  const heldHtml = context.pickEntryPlanHtml(be);
  assert.match(heldHtml,/Wait for confirmation/);
  assert.match(heldHtml,/239\.05/);
  assert.doesNotMatch(heldHtml,/Enter now|Full size OK|251\.63/);
  assert.match(context.pickEntryPlanHtml(ready),/Entry plan/);
  vm.runInContext(section('  function pickPlanSummaryHtml(', '  function buildPickCardHtml('),context);
  assert.match(context.pickPlanSummaryHtml(be),/Pre-expiration review/);
  assert.match(context.pickPlanSummaryHtml(be),/2026-11-06/);
  const live = {isFinite}; vm.createContext(live);
  vm.runInContext(section('  function liveEntryOverlay(', '  function applyLiveEntryChips('),live);
  assert.equal(live.liveEntryOverlay({...be,entry:{...be.entry,signal:'wait-pullback'}},230).kind,'arm');
  assert.match(appJs,/Includes watch ideas · not deployed/);
  assert.match(appJs,/modeled win rate · n=/);
  assert.match(appJs,/candidateBoard \+ modelRecord \+ researchContext/);
}

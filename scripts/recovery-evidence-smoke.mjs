import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppJs } from './render/app-js.mjs';

const js = renderAppJs();
const ctx = { fmtBigCurrency: value => String(value), escapeHtml: value => String(value) };
vm.createContext(ctx);
function load(start, end) {
  const a = js.indexOf(start), b = js.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  vm.runInContext(js.slice(a, b), ctx);
}
load('  function segmentRevenueReconciliation(', '  function sentimentDot(');
load('  function stkRecoveryEvidence(', '  // The expandable Investment Thesis Checklist');
load('  function stkActionKey(', '  // END stkGroupRows');
const period = {periodType:'quarterly',currentPeriod:{endDate:'2026-07-31'}};
const segments = {product:[{value:22.03e9}],geographic:[{value:23.08e9}],productPeriod:period,geographicPeriod:period};
assert.match(ctx.segmentRevenueReconciliation(segments), /do not reconcile/);
assert.equal(ctx.segmentRevenueReconciliation({...segments,geographic:[{value:22.03e9}]}), '');
assert.equal(ctx.segmentRevenueReconciliation({...segments,geographicPeriod:{...period,currentPeriod:{endDate:'2025-12-31'}}}), '');
assert.equal(ctx.segmentRevenueReconciliation({...segments,productPeriod:null}), '');
const gd = {symbol:'GD',clean:true,execution:{action:{key:'wait'},entry:{price:380.06},target:{price:377.91}}};
const before = JSON.stringify(gd);
const groups = ctx.stkGroupRows([gd]);
assert.equal(groups.find(g=>g.key==='buy').count,0);
assert.equal(groups.find(g=>g.key==='review').count,1);
assert.equal(JSON.stringify(gd),before, 'presentation must not mutate decision inputs');
assert.equal(ctx.stkPlanNeedsReview({...gd,execution:{entry:{price:null},target:{price:100}}}),false);
assert.match(ctx.stkRecoveryEvidence({}),/unavailable/);
assert.match(ctx.stkRecoveryEvidence({recoveryEvidence:{trajectory:{confidence:'high',reason:'Revenue slowing'},blockers:[{detail:'high-confidence decline'}]}}),/high-confidence decline/);
assert.match(js,/over shown history/);
assert.match(js,/Reported quarter EPS/);
console.log('recovery evidence smoke passed');

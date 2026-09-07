// Exercise emitted Grade UI behavior without quotes or a browser session.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppJs } from './render/app-js.mjs';
import { verifyLiveRefresh } from './live-refresh-smoke.mjs';

const app = renderAppJs();
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, start);
  return app.slice(from, to);
}
const elements = {
  'opt-max-pain': {}, 'opt-expiry': { value: '1' },
  'opt-strike': { selectedIndex: 0 }, 'opt-eval-result': {},
};
const context = {
  state: { symbol: 'LULU', currentExp: 1, spot: 100, chains: {
    1: { c: [{ s: 115, oi: 10 }], p: [{ s: 120, oi: 20 }] },
    2: { c: [{ s: 110, oi: 40 }, { s: 115, oi: 50 }], p: [{ s: 110, oi: 60 }] },
  } },
  $: id => elements[id], getOptType: () => 'call', fmt: n => n.toFixed(2),
  fmtExpiryLabel: n => 'Expiry ' + n, escapeHtml: String, tipChip: () => '', TIPS: {},
  scheduleEvaluate: () => {}, pushUrlState: () => {}, refreshLiveChain: () => {},
};
vm.createContext(context);
vm.runInContext(section('  function populateStrikes(){', '  function findContract(){'), context);
vm.runInContext(section('  function computeMaxPain(', '  // Baked contractQuality'), context);
context.populateStrikes();
assert.match(elements['opt-max-pain'].innerHTML, /Expiry 1/);
context.ev = { target: { closest: () => ({ getAttribute: k => k === 'data-alt-exp' ? '2' : '115' }) } };
vm.runInContext('(function(){' + section('          var altBtn =', '\n        });\n      }\n    }') + '})()', context);
assert.equal(context.state.currentExp, 2);
assert.equal(elements['opt-strike'].selectedIndex, 1, 'suggestion preserves the exact strike');
assert.match(elements['opt-max-pain'].innerHTML, /Expiry 2/);
assert.match(elements['opt-max-pain'].innerHTML, /150 open contracts/);
assert.doesNotMatch(elements['opt-max-pain'].innerHTML, /Expiry 1/);
context.state.currentExp = 3;
context.populateStrikes();
assert.equal(elements['opt-max-pain'].hidden, true, 'missing expiry clears prior analytics');
assert.equal(elements['opt-max-pain'].innerHTML, '');

Object.assign(context, {
  window: { STONKS_MANIFEST: {} }, liveLastRefreshAt: null,
  formatDisplayInstant: () => '12:00', ALIGNED_SCORE_TIP: '',
});
vm.runInContext(section('  function confidenceLabel(', '  function newsTakeHtml('), context);
for (const direction of ['call', 'put']) {
  for (const decision of ['yes', 'no']) {
    const html = context.renderBuyPanel({ direction, decision, confidence: 'strong', aligned: decision === 'yes' ? 5 : -5 }, null);
    assert.match(html, new RegExp('Strong confidence in verdict · ' + decision.toUpperCase() + ' on ' + direction + 's'));
    assert.doesNotMatch(html, /conviction · for/);
    if (direction === 'put') assert.match(html, /toward this trade \(bearish\).*against it \(bullish\)/);
  }
}
// Includes rapid A/B/A expiry switches, late responses and closing-bell cases.
await verifyLiveRefresh(app);
console.log('Grade contract smoke passed');

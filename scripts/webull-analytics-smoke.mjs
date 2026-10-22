import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webullAnalyticsFactory } from '../lib/webull-analytics.mjs';
import { webullReviewFixture } from './fixtures/webull-review.mjs';

const analytics = webullAnalyticsFactory();
const t = (id, extra = {}) => ({ t: { tradeId: id, symbol: id, side: 'call', state: 'closed', structure: 'long', fillPrice: 2, closeFillPrice: 3, paperPnlPct: 50, fees: 1, engineEntryPrice: 2, engineExitPrice: 3.2, enginePnlPct: 60, closeFillIso: '2026-10-01T20:00:00Z', ...extra }, rec: { entrySpot: 100, exitSpot: 110, side: 'call', contract: { pop: .6 } } });
let r = analytics.analyze([t('a'), t('b', { filledQty: 3, closeFillPrice: 1, paperPnlPct: -50, closeFillIso: '2026-10-02T20:00:00Z', fees: 3 })], 'structure');
assert.equal(r.stats.pnl, -204, 'recorded quantities and total fees');
assert.equal(r.stats.drawdown, -303, 'drawdown from the prior peak');
assert.equal(r.stats.expectancy, -102);
assert.equal(r.stats.winRate, 50);
assert.equal(r.stats.profitFactor, 99 / 303);
assert.equal(r.curve[0].paper, 0, 'baseline precedes the first trade');
assert.equal(r.calibration[2].actual, 50);
assert.equal(r.calibration[2].predicted, 60);
assert.equal(analytics.net(t('b', { filledQty: 3, fees: 3 }).t), 49.5);
assert.equal(analytics.dollars(t('credit', { structure: 'credit_vertical', closeFillPrice: 1 }).t, false), 99);
const missing = t('missing', { closeFillPrice: null, enginePnlPct: null, engineExitPrice: null }); missing.rec.exitSpot = null;
r = analytics.analyze([missing, t('open', { state: 'open' }), t('partial', { openQty: 1 }), t('settled', { state: 'settled' })], 'grade');
assert.equal(r.stats.n, 1);
assert.equal(r.stats.pnl, null, 'missing fill is not a zero-dollar trade');
assert.equal(r.stats.pairedN, 0);
assert.equal(r.stats.directionN, 0, 'missing exit spot is not zero or a loss');
assert.equal(r.stats.bias, null);
assert.equal(r.stats.benchmarkN, 0, 'missing SPY pairs do not become zero returns');
assert.equal(r.execution.reduce((s, x) => s + x.value, 0), 4);
r = analytics.analyze([t('loss', { closeFillPrice: 1, paperPnlPct: -50 })], 'run');
assert.equal(r.stats.drawdown, -101, 'first losing trade draws down from zero');
assert.equal(r.stats.profitFactor, 0);
assert.equal(analytics.analyze([], 'sector').stats.winRate, null);

// Execute the generated production renderer, not a duplicate implementation.
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('  var wbTest = '), end = app.indexOf('  // --- Per-pick "Strategy & entry details"', start);
assert.ok(start > 0 && end > start);
const box = { innerHTML: '' }, summaries = [];
const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fixture = webullReviewFixture();
fixture.mirror.trades[0].tradeId = fixture.accuracy.closed[0].tradeId = '<unsafe>';
const context = vm.createContext({ Date, console, isFinite, escapeHtml, $: id => id === 'an-webull' ? box : null,
  accuracyState: { data: fixture.accuracy }, accFills: { rows: [] }, accView: { wbSide: 'all', wbStruct: 'all', wbRun: 'all', wbState: 'all', wbRange: 'all', wbLens: 'performance', wbGroup: 'structure' },
  accFillKey: v => v, tlEtParts: v => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(v)).map(p => [p.type, p.value])),
  accSeg: (key, id, value, options) => options.map(o => '<input data-acc-set="' + key + '" value="' + o.value + '">').join(''),
  accPaneSummary: (...args) => summaries.push(args), accDateTime: v => v, accDate: v => v,
  accPct: v => v == null ? '—' : v.toFixed(1) + '%', accMoney: v => v == null ? '—' : '$' + v.toFixed(2), accUsd: v => v == null ? null : '$' + v,
  ACC_STATUS_LABEL: {}, chHoverAttr: () => '',
});
const tradeIdStart = app.indexOf('  function tlTradeId(');
vm.runInContext(app.slice(tradeIdStart, app.indexOf('  function tlEtTime(', tradeIdStart)), context);
vm.runInContext(app.slice(start, end), context);
context.wbTest = { loaded: true, data: fixture.mirror };
assert.equal(vm.runInContext('WB_ANALYTICS.analyze(wbRows()).stats.recordN', context), 35, 'real trade-ID join, excluding the deliberately replaced ID');
for (const lens of ['performance', 'accuracy', 'engine', 'trades']) {
  context.accView.wbLens = lens; vm.runInContext('renderWebullTest()', context);
  assert.doesNotMatch(box.innerHTML, /NaN|Infinity|<unsafe>/);
  assert.match(box.innerHTML, /Refresh trades/);
  if (lens === 'performance') { assert.match(box.innerHTML, /Realized P&amp;L over time/); assert.match(box.innerHTML, /Drawdown/); assert.match(box.innerHTML, /Paper versus SPY options/); assert.match(box.innerHTML, /View chart data/); }
  if (lens === 'accuracy') { assert.match(box.innerHTML, /Accuracy over time/); assert.match(box.innerHTML, /Predicted probability versus outcome/); }
  if (lens === 'engine') { assert.match(box.innerHTML, /Execution status/); assert.match(box.innerHTML, /Execution gaps/); }
  if (lens === 'trades') assert.match(box.innerHTML, /&lt;unsafe&gt;/);
}
context.accView.wbSide = 'put';
assert.ok(vm.runInContext('wbRows().every(x => x.t.side === "put")', context));
context.accView.wbRange = '30';
assert.ok(vm.runInContext('wbRows().every(x => Date.parse(x.t.engineEntryIso) >= Date.now() - 30 * 86400000)', context));
context.accView.wbState = 'open';
assert.ok(vm.runInContext('wbRows().every(x => ["open","entering","exiting","settlement-pending"].includes(x.t.state))', context));
for (const group of ['structure', 'grade', 'tier', 'sector', 'regime', 'run', 'side']) { context.accView.wbGroup = group; vm.runInContext('renderWebullTest()', context); assert.doesNotMatch(box.innerHTML, /NaN|Infinity/); }
context.accView.wbSide = 'all'; context.accView.wbRange = 'all'; context.accView.wbState = 'closed'; context.accView.wbLens = 'accuracy';
vm.runInContext('renderWebullTest()', context);
assert.equal(vm.runInContext('WB_ANALYTICS.analyze(wbRows()).stats.n', context), 36);
fixture.mirror.trades = []; vm.runInContext('renderWebullTest()', context); assert.match(box.innerHTML, /No mirrored trades yet/);
context.wbTest.error = 'off'; vm.runInContext('renderWebullTest()', context); assert.match(box.innerHTML, /Retry loading trades/);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /acc-tab-books|acc-pane-books|Paper books|paper books/);
assert.doesNotMatch(app, /function renderPaperBooks|paperBook:/);
assert.match(app, /wbLens:accView.wbLens/);
console.log('Webull analytics: quantity/fee accounting, drawdown, matched samples, missing values, filters, four shipped views and Paper books removal passed.');

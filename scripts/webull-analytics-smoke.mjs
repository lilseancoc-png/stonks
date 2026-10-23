import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webullAnalyticsFactory } from '../lib/webull-analytics.mjs';
import { webullReviewFactory } from './render/webull-review-client.mjs';
import { webullReviewFixture } from './fixtures/webull-review.mjs';

const analytics = webullAnalyticsFactory();
const t = (id, extra = {}) => ({ t: { tradeId: id, symbol: id, side: 'call', state: 'closed', structure: 'long', fillPrice: 2, closeFillPrice: 3, paperPnlPct: 50, fees: 1, engineEntryPrice: 2, engineExitPrice: 3.2, enginePnlPct: 60, closeFillIso: '2026-10-01T20:00:00Z', ...extra }, rec: { entrySpot: 100, exitSpot: 110, side: 'call', contract: { pop: .6 } } });
let r = analytics.analyze([t('a'), t('b', { filledQty: 3, closedQty: 3, openQty: 0, closeFillPrice: 1, paperPnlPct: -50, closeFillIso: '2026-10-02T20:00:00Z', fees: 3 })], 'structure');
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
assert.equal(r.stats.n, 0, 'missing close fills are unverified outcomes');
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

for (const fields of [{ needsReview: true }, { filledQty: 0, closedQty: 0 }, { filledQty: 3, closedQty: 1, openQty: 0 }, { filledQty: 1, closedQty: 1, openQty: -1 }, { filledQty: -1 }, { closeFillPrice: null }]) {
  const result = analytics.analyze([t('unverified', fields)], 'structure');
  assert.equal(result.stats.n, 0, JSON.stringify(fields));
  assert.equal(result.stats.pnl, null);
  assert.equal(result.stats.excludedClosed, 1);
}
const undated = t('undated', { closeFillIso: null, engineExitIso: '2026-10-02T20:00:00Z' });
r = analytics.analyze([undated, t('dated')], 'structure');
assert.equal(r.stats.pnl, 198, 'undated results stay in the total');
assert.equal(r.stats.undated, 1);
assert.equal(r.stats.drawdown, null, 'cannot assert a peak-to-trough order without all paper close dates');
assert.equal(r.curve.length, 2, 'only the dated close and baseline are plotted');
assert.equal(r.trend.length, 1);
assert.equal(r.comparison.length, 2);
const archived = t('archive'); archived.rec = { aiGrade: 'A', sector: 'constructor' };
assert.equal(analytics.analyze([archived], 'grade').groups[0].label, 'A');
assert.equal(analytics.analyze([archived], 'sector').groups[0].label, 'constructor');
archived.rec.sector = '__proto__';
assert.equal(analytics.analyze([archived], 'sector').groups[0].n, 1);
assert.equal(analytics.isActive(t('error', { state: 'error', openQty: 1 }).t), true);
assert.equal(analytics.isActive(t('review', { needsReview: true }).t), true);
const scenario = analytics.scenarios(t('quotes', { entryBid: 1, entryAsk: 3, exitBid: 1, exitAsk: 3, fillPrice: 10, fees: 2 }).t);
assert.equal(scenario.mid, -1, 'fee % uses the scenario entry, not actual fill');
assert.ok(Math.abs(scenario.cross - (-200 / 3 - 2 / 3)) < 1e-10);
assert.equal(analytics.scenarios(t('bad-quotes', { entryBid: 3, entryAsk: 1, exitBid: 1, exitAsk: 2 }).t), null);

const hoverSets = [];
const renderer = webullReviewFactory({ html: v => String(v).replace(/</g, '&lt;'), pct: v => v == null ? '—' : v.toFixed(1) + '%', money: v => '$' + v, hover: p => { hoverSets.push(p); return ''; } });
renderer.render(analytics.analyze([t('hover')]), 'performance', 'structure');
assert.equal(hoverSets[1].length, 2, 'one combined hover point per observation');
assert.match(hoverSets[1][1].label, /Paper:.*\nEngine:/);
const missingHtml = renderer.render(analytics.analyze([undated]), 'performance', 'structure');
assert.match(missingHtml, /drawdown is withheld/);
assert.doesNotMatch(missingHtml, /aria-label="Realized dollar drawdown"/);
assert.doesNotMatch(renderer.status({ lastRunIso: '2026-10-22T20:00:00Z' }, { builtAtIso: '2026-10-22T19:30:00Z' }), /latest Track Record build has not been checked/, 'legacy responses cannot report which engine build was reconciled');

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
  ACC_STATUS_LABEL: {}, chHoverAttr: p => ' data-hover-count="' + p.length + '"',
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
// Forward-compatible ledger fields must appear in the shipped renderer, and
// cannot become verified returns just because state says closed.
fixture.mirror.reconciliation = { status: 'attention', alerts: ['NVDA: <unsafe> holdings'], checkedAtIso: '2026-10-22T15:00:00Z' };
fixture.mirror.engineSnapshotIso = '2026-10-21T15:00:00Z';
fixture.mirror.trades.push({ ...fixture.mirror.trades[1], tradeId: 'unverified-closed', needsReview: true, filledQty: 0, closedQty: 0, openQty: 0 });
fixture.mirror.trades.push({ ...fixture.mirror.trades[1], tradeId: 'partial-exit', state: 'error', requestedQty: 3, filledQty: 2, closedQty: 1, openQty: 1, needsReview: true });
fixture.accuracy.closed[2].sector = 'constructor';
fixture.accuracy.closed[3].thesis = null; fixture.accuracy.closed[3].aiGrade = 'Archived A';
context.accView.wbLens = 'trades';
vm.runInContext('renderWebullTest()', context);
assert.match(box.innerHTML, /Broker reconciliation needs review/);
assert.match(box.innerHTML, /latest Track Record build has not been checked/);
assert.match(box.innerHTML, /&lt;unsafe&gt; holdings/);
assert.doesNotMatch(box.innerHTML, /<unsafe>/);
assert.match(box.innerHTML, /1 closed trade excluded/);
assert.match(box.innerHTML, /Needs broker review/);
context.accView.wbLens = 'accuracy';
vm.runInContext('renderWebullTest()', context);
assert.match(box.innerHTML, /Archived A/, 'archive grades retained in the detailed accuracy output');
context.accView.wbLens = 'trades';
context.accView.wbState = 'open';
assert.ok(vm.runInContext('wbRows().some(x => x.t.tradeId === "partial-exit")', context));
vm.runInContext('renderWebullTest()', context);
assert.match(box.innerHTML, /2\/3 filled · 1 closed · 1 open/);
fixture.mirror.trades = []; vm.runInContext('renderWebullTest()', context); assert.match(box.innerHTML, /No mirrored trades yet/);
context.wbTest.error = 'off'; vm.runInContext('renderWebullTest()', context); assert.match(box.innerHTML, /Retry loading trades/);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /acc-tab-books|acc-pane-books|Paper books|paper books/);
assert.doesNotMatch(app, /function renderPaperBooks|paperBook:/);
assert.match(app, /wbLens:accView.wbLens/);
console.log('Webull analytics: quantity/fee accounting, drawdown, matched samples, missing values, filters, four shipped views and Paper books removal passed.');

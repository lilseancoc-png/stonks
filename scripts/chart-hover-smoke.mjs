// Line-chart hover: Historical Data publishes the same data-ch points the
// shared cursor readout already understands, and the grade spark does too.
import assert from 'node:assert/strict';
import { historicalDataFactory } from './render/historical-data-client.mjs';
import { gradeSpark, windowGradeSamples } from '../js/book-views.js';

function summary(extra = {}) {
  return { n: 2, meanPct: 1.2, medianPct: 0.8, positivePct: 50, worstPct: -1.5, bestPct: 4.2, ...extra };
}
function year(y, ret) {
  return { year: y, baseline: y + '-01-02', end: y + '-12-31', returnPct: ret, drawdownPct: -3 };
}
function range(years) {
  return {
    ...summary(),
    n: years.length,
    years,
    path: [
      { x: 0, low: -2, high: 3, median: 0.4 },
      { x: 50, low: -1, high: 4, median: 1.1 },
      { x: 100, low: -0.5, high: 5, median: 1.8 },
    ],
    baseline: { meanPct: 0.6, sessions: 20, n: 12 },
  };
}
const years = [year(2023, -1.5), year(2024, 4.2)];
const payload = {
  version: 2,
  builtAtIso: new Date().toISOString(),
  sourceBuiltAtIso: '2026-10-23T20:00:00.000Z',
  historyEncoding: 'shared-observations-v1',
  methodology: ['Close to close.'],
  lore: [],
  source: { name: 'Yahoo Finance', returnType: 'Price return.' },
  coverage: {
    minimumYears: 10,
    total: 2,
    ready: 2,
    boundaries: ['Revised macro observations.'],
    paidOptions: [],
    markets: [{
      id: 'SPY', label: 'S&P 500', url: 'https://finance.yahoo.com/quote/SPY',
      years: 20, observations: 5000, firstDate: '2006-01-03', lastDate: '2026-10-23',
      status: 'ready', group: 'US stocks', publisher: 'Yahoo', provider: 'Yahoo', frequency: 'daily',
    }],
    context: [{
      id: 'DTWEXBGS', label: 'Trade-weighted broad US dollar', group: 'Currency',
      url: 'https://fred.stlouisfed.org/series/DTWEXBGS', publisher: 'Federal Reserve', provider: 'FRED',
      frequency: 'daily', unit: 'Index, January 2006 = 100', vintage: 'revised',
      years: 20.8, observations: 5217, firstDate: '2006-01-02', lastDate: '2026-10-23', status: 'ready',
      latest: 121.32, median10y: 117.72, percentile10y: 78,
      chart: [
        { t: '2006-01-02', v: 100 },
        { t: '2016-01-04', v: 110.5 },
        { t: '2026-10-23', v: 121.32 },
      ],
    }],
  },
  indexes: {
    SPY: {
      label: 'S&P 500', assetClass: 'US stocks', sessions: 5000,
      firstDate: '2006-01-03', asOf: '2026-10-23', ageDays: 1,
      current: { asOf: '2026-10-23', ytdPct: 10, trend63Pct: 2, volatility20Pct: 12, drawdown252Pct: -3 },
      analogs: { eligible: 10, rows: [{ date: '2024-10-23', trend63Pct: 1, volatility20Pct: 12, next20Pct: 0.4, next63Pct: 1.1 }] },
      monthly: Array.from({ length: 12 }, (_, i) => summary({ month: i + 1, meanPct: i - 6 })),
      recurring: [],
      studies: [{
        id: 'q4', name: 'Fourth quarter', group: 'Seasonal', claim: 'Q4.', definition: 'Oct-Dec.',
        comparison: { status: 'in-progress', year: 2026, returnPct: 1.2, baseline: '2025-12-31', end: '2026-02-01', sessions: 20, path: [{ x: 0, y: 0 }, { x: 50, y: 1.2 }] },
        ranges: { all: range(years), '20y': range(years), '10y': range(years) },
      }],
    },
  },
};

const seen = [];
let html = '';
let onClick = null;
const el = {
  get innerHTML() { return html; },
  set innerHTML(value) { html = String(value); },
  querySelector() { return null; },
  closest() { return { hidden: true }; },
  addEventListener(type, fn) { if (type === 'click') onClick = fn; },
};
const api = historicalDataFactory({
  localStorage: { getItem() { return null; }, setItem() {} },
  addEventListener() {},
  clearTimeout() {},
  setTimeout() { return 1; },
  fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
}, {
  hidden: true,
  getElementById() { return el; },
  addEventListener() {},
  createElement() { return { click() {} }; },
}, {
  owner: () => true,
  url: () => '/api/auth/me?data=historical-data.json',
  hover(points) {
    seen.push(points);
    return ' data-ch="yes"';
  },
});
await api.load();
assert.equal(seen.length, 3, 'seasonal line plus two bar charts publish hover points');
const seasonal = seen[0];
const mid = seasonal.filter(p => String(p.label).startsWith('50%'));
assert.equal(mid.length, 2, 'median and the held-out year are both followable');
assert.match(mid[0].label, /Median \+1\.10%/);
assert.match(mid[0].label, /2026 comparison \+1\.20%/);
assert.equal(mid[0].x, mid[1].x);
assert.notEqual(mid[0].y, mid[1].y);
assert.equal(seasonal.every(p => p.value == null), true, 'padded charts do not publish a misaligned drag-compare');
assert.match(html, /data-ch="yes"/);
assert.doesNotMatch(html, /<title>/);

onClick({ target: { closest: () => ({ dataset: { historyView: 'context' }, hasAttribute: () => false }) } });
const macro = seen.at(-1);
assert.deepEqual(macro.map(p => p.label.split('\n')[0]), ['2006-01-02', '2016-01-04', '2026-10-23']);
assert.match(macro[2].label, /2026-10-23\n121\.32 Index, January 2006 = 100\nTrade-weighted broad US dollar/);
assert.equal(macro[2].value, undefined);
assert.match(html, /data-ch="yes"/);
assert.match(html, /Trade-weighted broad US dollar/);

const grades = windowGradeSamples(
  [{ date: '2026-10-01', totals: { SPY: 1 } }, { date: '2026-10-02', totals: { SPY: 4.2 } }],
  'SPY', '1m', '2026-09-01', '2026-10-02', 4.2, 4,
);
assert.equal(grades.series.at(-1).date, '2026-10-02');
const spark = gradeSpark(grades.series);
assert.match(spark, /data-ch="/);
assert.match(spark, /2026-10-02/);
assert.match(spark, /Grade \+4\.2/);
assert.equal(gradeSpark([1]), '');

const generated = `var historicalData = (${historicalDataFactory.toString()})`;
new Function(generated);
assert.match(generated, /label: r\.t \+ '\\n' \+/);
assert.doesNotMatch(generated, /value: r\.v/);

console.log('chart-hover smoke ok');

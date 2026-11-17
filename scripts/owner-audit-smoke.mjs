// Owner sections audit (2026-11-17): the 2-year yield reversal guard and the
// Bottom tracker's completed-session closes. Offline, no network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { computeMacroRegime, closesForBottom } from './build.mjs';
import { marketAnalysis } from '../lib/market-analysis.mjs';
import { renderAppJs } from './render/app-js.mjs';

const app = renderAppJs({ riskFreeRate: 0.04 });
const ctx = vm.createContext({ marketAnalysis, Date, Math, console });
vm.runInContext(app.slice(app.indexOf('  function liveGlobalTapeAxis('), app.indexOf('  function macroStateMeta(')), ctx);
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const base = () => ({ asOf: new Date().toISOString(),
  indexes: { spy: { pctChange1d: 0, pctChange5d: 0, aboveSma20: true }, qqq: { pctChange1d: 0, pctChange5d: 0, aboveSma20: true } },
  vix: { value: 18, pctChange1d: 0, trend: 'flat' }, vixTerm: { state: 'contango' }, dxy: { pctChange1d: 0, pctChange5d: 0, trend: 'flat' },
  tenY: { value: 4, bpsChange1d: 0, bpsChange5d: 0, trend: 'flat' }, thirtyY: { value: 4.5, bpsChange1d: 0 },
  twoY: { value: 3.6, bpsChange1d: 0, bpsChange5d: 0, trend: 'flat' }, move: { value: 95, pctChange1d: 0 } });

check('Nov 16 16:10 case: 2Y -5.0 bps on a rising 5-day trend is not a tightening vote', () => {
  const b = base(); b.twoY = { value: 3.6, bpsChange1d: -5, bpsChange5d: 10, trend: 'rising' };
  const r = computeMacroRegime(b);
  assert.equal(r.axes.twoY.score, 0);
  assert.equal(r.drivers.some((d) => /^2Y/.test(d)), false);
  assert.equal(ctx.computeLiveMacroRegime(r, {}).axes.twoY.score, 0, 'browser re-port agrees');
});
check('the 2Y guard uses the same half-bar as the 10-year and the dollar', () => {
  for (const [b1, want] of [[-4, 0], [-3.9, -1], [0, -1], [9, -1], [14, -2]]) {
    const b = base(); b.twoY = { value: 3.6, bpsChange1d: b1, bpsChange5d: 10, trend: 'rising' };
    const r = computeMacroRegime(b);
    assert.equal(r.axes.twoY.score, want, `2Y ${b1} bps`);
    assert.equal(ctx.computeLiveMacroRegime(r, {}).axes.twoY.score, want, `browser ${b1} bps`);
  }
  for (const [b1, want] of [[4, 0], [3.9, 1], [-9, 1]]) {
    const b = base(); b.twoY = { value: 3.6, bpsChange1d: b1, bpsChange5d: -10, trend: 'falling' };
    assert.equal(computeMacroRegime(b).axes.twoY.score, want, `falling 2Y ${b1} bps`);
  }
});

const bars = [{ t: '2026-11-12', c: 100 }, { t: '2026-11-13', c: 101 }, { t: '2026-11-16', c: 98 }];
check('Bottom tracker closes drop the session in progress during market hours', () => {
  const rows = closesForBottom({ _bars: bars, marketState: 'REGULAR' }, new Date('2026-11-16T16:00:00Z'));
  assert.deepEqual(rows.map((r) => r.t), ['2026-11-12', '2026-11-13']);
});
check('Bottom tracker closes keep the day once the session has closed', () => {
  const rows = closesForBottom({ _bars: bars, marketState: 'POST' }, new Date('2026-11-16T21:10:00Z'));
  assert.deepEqual(rows.map((r) => r.t), ['2026-11-12', '2026-11-13', '2026-11-16']);
  const prior = closesForBottom({ _bars: bars.slice(0, 2), marketState: 'REGULAR' }, new Date('2026-11-16T16:00:00Z'));
  assert.equal(prior.length, 2, 'an older last bar is already a close');
});
check('the persisted price series follows the same rule', () => {
  const rows = closesForBottom({ priceSeries: { t: bars.map((b) => b.t), c: bars.map((b) => b.c) }, marketState: 'PRE' }, new Date('2026-11-16T16:00:00Z'));
  assert.equal(rows.at(-1).t, '2026-11-13');
});
console.log(`Owner audit: ${checks} checks passed.`);

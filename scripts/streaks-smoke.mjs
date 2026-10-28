// Offline regression cases for the streak builder and shared card/list semantics.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { computeStreakForTicker, confirmedDailyBars } from './build.mjs';

export function barsFor(moves, volumes = []) {
  let close = 100;
  return [{ t: '2026-09-01', c: close, v: 100 }, ...moves.map((pct, i) => ({
    t: new Date(Date.UTC(2026, 8, i + 2)).toISOString().slice(0, 10),
    c: close *= 1 + pct / 100, v: volumes[i] ?? 100,
  }))];
}
const failures = [];
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message); }
}
const compute = (moves) => computeStreakForTicker('TEST', barsFor(moves));
test('same-direction days exclude tolerated counters and flats; returns compound', () => {
  const row = compute([1, 1, -0.3, 0, 1]);
  assert.equal(row.current.sameDays, 3);
  assert.equal(row.current.windowDays, 5);
  assert(Math.abs(row.current.cumulativePct - ((1.01 ** 3 * 0.997) - 1) * 100) < 1e-9);
  assert.equal(row.history.length, 5);
});
test('flat session interrupts consecutive counter-day tripwire', () => {
  const row = compute([1, 1, 1, 1, 1, -0.3, -0.3, 0, -0.3, -0.3]);
  assert.equal(row.current.color, 'green');
  assert.equal(row.current.consecutiveCounterDays, 2);
});
test('four truly consecutive counter sessions still break a run', () => {
  assert.equal(compute([1, 1, 1, 1, 1, -0.3, -0.3, -0.3, -0.3]).current.color, 'red');
});
test('immaterial two-day snap does not hide a recent material run', () => {
  const e = compute([1, 1, 1, 1, 1, -3, -0.4, 3]).lastEnded;
  assert(e);
  assert.equal(e.color, 'green');
  assert.equal(e.days, 5);
  assert.equal(e.sessionsAgo, 2);
});
test('red runs snap symmetrically into bounce candidates', () => {
  const e = compute([-1, -1, -1, -1, -1, 3]).lastEnded;
  assert.equal(e.color, 'red');
  assert.equal(e.sameDays, 5);
  assert(e.cumulativePct < 0 && e.reversalPct > 0);
  assert.equal(e.sessionsAgo, 0);
});
test('noise and ordinary two-day reversals stay out of Just snapped', () => {
  assert.equal(compute([1, 1, -3]).lastEnded, null);
  assert.equal(compute([0.03, 0.03, 0.03, -0.03]), null);
});
test('snap expires after two subsequent sessions', () => {
  assert.equal(compute([1, 1, 1, 1, 1, -3, -1, -1, -1]).lastEnded, null);
});
test('ended run keeps its own volume rather than borrowing reversal volume', () => {
  const row = computeStreakForTicker('TEST', barsFor([1, 1, 1, 1, 1, -3], [200, 200, 200, 200, 200, 50]));
  assert.equal(row.lastEnded.volumeRatio, 2);
  assert.notEqual(row.lastEnded.volumeRatio, row.current.volumeRatio);
});
test('unfinished candle excluded; closed candle retained', () => {
  const bars = barsFor([1, 1, 1, -3]);
  assert.equal(confirmedDailyBars(bars, 'REGULAR', new Date('2026-09-05T16:00:00Z')).length, bars.length - 1);
  assert.equal(confirmedDailyBars(bars, 'CLOSED').length, bars.length);
});

test('pre-market and delayed feeds keep the last completed session', () => {
  const bars = barsFor([1, 1, 1, -3]);
  for (const state of ['PRE', 'REGULAR', 'UNKNOWN']) {
    assert.equal(confirmedDailyBars(bars, state, new Date('2026-09-06T12:00:00Z')).length, bars.length);
  }
  assert.equal(confirmedDailyBars(bars, 'PRE', new Date('2026-09-05T12:00:00Z')).length, bars.length - 1);
  assert.equal(confirmedDailyBars([{c: 100}, {c: 102}], 'REGULAR').length, 1);
});

const context = vm.createContext({ window: {}, document: { readyState: 'loading', addEventListener() {} } });
vm.runInContext(await readFile(new URL('../js/streaks.js', import.meta.url), 'utf8'), context);
const ui = vm.runInContext('({makeSorter, hasRecentSnap, streakCandidateMeta})', context);
const rows = [
  {symbol: 'AAA', lastClose: 50, current: {days: 9, sameDays: 2, cumulativePct: 30}, lastEnded: {days: 8, sameDays: 5, color: 'green', cumulativePct: 12, sessionsAgo: 1, volumeRatio: 1.2}},
  {symbol: 'ZZZ', lastClose: 100, current: {days: 1, sameDays: 1, cumulativePct: -3}, lastEnded: {days: 10, sameDays: 10, color: 'red', cumulativePct: -25, sessionsAgo: 0, volumeRatio: 2}},
];
for (const [mode, first] of [['streak','ZZZ'],['cum','ZZZ'],['up','AAA'],['down','ZZZ'],['vol','ZZZ'],['last','ZZZ'],['alpha','AAA']]) {
  test('snapped ' + mode + ' sort uses ended-run metrics', () => {
    assert.equal(rows.slice().sort(ui.makeSorter(mode, t => t.lastEnded))[0].symbol, first);
  });
}
test('snapped minimum length counts signal days, not full window', () => {
  assert.equal(ui.hasRecentSnap(rows[0], 6), false);
  assert.equal(ui.hasRecentSnap(rows[0], 5), true);
});
test('UI and decision panel reject expired and malformed snap ages', () => {
  for (const sessionsAgo of [-1, 3, null, '1']) {
    const t = {...rows[0], lastEnded: {...rows[0].lastEnded, sessionsAgo}};
    assert.equal(ui.hasRecentSnap(t), false);
    assert.equal(ui.streakCandidateMeta(t).snapped, false);
  }
});
test('break risk uses consecutive counters rather than partially healed pressure', () => {
  const t = {...rows[0], current: {...rows[0].current, tolerancePct: 0, counterDays: 4, consecutiveCounterDays: 1}};
  assert.equal(ui.streakCandidateMeta(t).fragile, false);
});
if (failures.length) throw Error(failures.length + ' streak regressions failed: ' + failures.join(', '));

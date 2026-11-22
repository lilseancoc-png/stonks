// Earnings ripple effects: the forward-validation log (2026-11-17 audit).
// 1. A window that ends today resolves only after the close, never off the
//    in-progress bar the 10:00 ET bake sees.
// 2. The direction hit scores beta x the driver's ACTUAL move against the
//    follower's move (the frozen prediction carries only the beta's sign).
// 3. A log written under the old rule has its realized moves re-read once.
// No network.
import assert from 'node:assert/strict';
// The test reads "today" from the clock, and the build drops today's bar while
// the session is open (confirmedDailyBars). On a weekend the newest bar is
// Friday's, so the run failed every Saturday and Sunday (audit 2026-11-22).
// Pin the clock to the newest weekday, 10:30 ET, before the build loads.
const RealDate = Date;
const pinnedMs = (() => {
  let t = RealDate.now();
  while ([0, 6].includes(new RealDate(t - 5 * 3600000).getUTCDay())) t -= 86400000;
  const d = new RealDate(t - 5 * 3600000).toISOString().slice(0, 10);
  return RealDate.parse(`${d}T15:30:00Z`);
})();
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [pinnedMs])); }
  static now() { return pinnedMs; }
};
const { updateSpilloverLog, SPILLOVER_LOG_RESOLVE_VERSION, etDateKey } = await import('./build.mjs');

const today = etDateKey();
// Weekdays ending today (oldest first).
const days = [];
for (let t = Date.parse(`${today}T12:00:00Z`); days.length < 30; t -= 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  days.unshift(d.toISOString().slice(0, 10));
}
const last = days.length - 1;
// Closes: flat at 100, then each name's own moves on chosen days.
const series = (moves) => days.map((t, i) => ({ t, o: 100, c: 100 * (moves[i] ?? 1) }));
const cum = (steps) => { const out = {}; let lvl = 1; for (let i = 0; i < days.length; i++) { lvl *= steps[i] ?? 1; out[i] = lvl; } return out; };
// Driver D: down 3% on day last-10, up 4% on day last-5, up 2% today.
// Follower F: down 1% on day last-10, up 1% on day last-5, down 1% today.
const D = cum({ [last - 10]: 0.97, [last - 5]: 1.04, [last]: 1.02 });
const F = cum({ [last - 10]: 0.99, [last - 5]: 1.01, [last]: 0.99 });
const chainsAt = (marketState) => ({
  D: { _bars: series(D), marketState, ivRank: { iv: 0.4 } },
  F: { _bars: series(F), marketState, ivRank: { iv: 0.3 } },
});
const followers = [{ follower: 'F', expA: 1.2, expB: 0.8, pricedMovePct: 1.9 }];
const upcomingFor = (date) => [{ driver: 'D', date, session: 'AM', isolation: { status: 'clean', hard: [], flags: [] }, impliedMovePct: 6, followers }];

// Two past prints, enrolled and frozen before the fix's version.
let log = null;
for (const date of [days[last - 10], days[last - 5]]) {
  log = updateSpilloverLog(log, { chains: chainsAt('REGULAR'), upcoming: upcomingFor(date), todayEt: days[days.indexOf(date) - 1], builtAtIso: 'x' });
  log = updateSpilloverLog(log, { chains: chainsAt('REGULAR'), upcoming: upcomingFor(date), todayEt: date, builtAtIso: 'x' });
}
// Today's before-open print: enrolled the day before, frozen and first seen
// on the day by the 10:00 ET bake.
log = updateSpilloverLog(log, { chains: chainsAt('REGULAR'), upcoming: upcomingFor(today), todayEt: days[last - 1], builtAtIso: 'x' });
log = updateSpilloverLog(log, { chains: chainsAt('REGULAR'), upcoming: upcomingFor(today), todayEt: today, builtAtIso: '10:00' });
const todayRow = log.events.find((e) => e.date === today);
assert.equal(todayRow.frozen, true);
assert.equal(todayRow.resolvedAt, undefined, 'the window ends in an unfinished session: not resolved at 10:00');
assert.equal(log.resolveVersion, SPILLOVER_LOG_RESOLVE_VERSION);
const past = log.events.filter((e) => e.date !== today);
assert.equal(past.every((e) => !!e.resolvedAt), true, 'past windows resolve');
assert.deepEqual(past.map((e) => e.driverRealizedPct), [-3, 4]);
assert.deepEqual(past.map((e) => e.predictions[0].realizedPct), [-1, 1]);
// Beta is positive and the follower moved with the driver both times: 2 of 2.
assert.equal(log.forward.engineA.hit, 1, 'direction = beta x the driver move');
assert.equal(log.forward.engineB.hit, 1);
assert.equal(log.forward.engineA.n, 2);

// After the close the same day: the window is complete and resolves.
log = updateSpilloverLog(log, { chains: chainsAt('POST'), upcoming: upcomingFor(today), todayEt: today, builtAtIso: '16:10' });
const closed = log.events.find((e) => e.date === today);
assert.equal(closed.resolvedAt, today);
assert.equal(closed.driverRealizedPct, 2);
assert.equal(closed.predictions[0].realizedPct, -1);
// Driver up, follower down: a miss. 2 of 3.
assert.equal(log.forward.engineA.hit, 0.6667);

// A log written under the old rule (no resolveVersion): realized moves read
// off a 10:00 ET bar are re-read once from the closes; the IV change is kept.
const oldLog = JSON.parse(JSON.stringify(log));
delete oldLog.resolveVersion;
const stale = oldLog.events.find((e) => e.date === days[last - 5]);
stale.driverRealizedPct = 0.4;
stale.predictions[0].realizedPct = -0.2;
stale.predictions[0].ivChange = -0.05;
const sameDay = oldLog.events.find((e) => e.date === today);
sameDay.predictions[0].realizedPct = 0.3; // read off this morning's bar
const reread = updateSpilloverLog(oldLog, { chains: chainsAt('REGULAR'), upcoming: [], todayEt: today, builtAtIso: 'y' });
const fixed = reread.events.find((e) => e.date === days[last - 5]);
assert.equal(fixed.driverRealizedPct, 4);
assert.equal(fixed.predictions[0].realizedPct, 1);
assert.equal(fixed.predictions[0].ivChange, -0.05, 'the IV change read at resolution stays');
assert.equal(fixed.resolvedAt, days[last - 5], 'a re-read keeps the resolution date');
assert.equal(reread.events.find((e) => e.date === today).resolvedAt, undefined, 'resolved this morning under the old rule: resolves again after the close');
assert.equal(reread.resolveVersion, SPILLOVER_LOG_RESOLVE_VERSION);
// The re-read runs once: a later bake leaves resolved rows alone.
const again = JSON.parse(JSON.stringify(reread));
again.events.find((e) => e.date === days[last - 5]).predictions[0].realizedPct = 9;
const later = updateSpilloverLog(again, { chains: chainsAt('REGULAR'), upcoming: [], todayEt: today, builtAtIso: 'z' });
assert.equal(later.events.find((e) => e.date === days[last - 5]).predictions[0].realizedPct, 9);

console.log('spillover log smoke ok');

// 4. Edge compares the aligned average move with a one-day at-the-money
//    option's cost (about 0.4 of the day's 1σ move), not the full 1σ move
//    (2026-11-17, Owner choice).
{
  const { buildSpilloverMatrix, spillPrepSeries, SPILLOVER_OPTION_COST_RATIO } = await import('./build.mjs');
  assert.ok(Math.abs(SPILLOVER_OPTION_COST_RATIO - 0.3989) < 0.0005, 'one-day ATM option ≈ 0.4σ');
  const dates = [];
  for (let t = Date.parse('2025-01-02T12:00:00Z'); dates.length < 160; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    dates.push(d.toISOString().slice(0, 10));
  }
  const evIdx = [30, 50, 70, 90, 110, 130];
  const mk = (bump) => { let c = 100; return spillPrepSeries(dates.map((t, i) => { c *= 1 + (Math.sin(i * 1.7) * 0.002) + bump(i); return { t, c }; })); };
  const drv = (i) => (evIdx.includes(i - 1) ? (evIdx.indexOf(i - 1) % 2 ? -0.04 : 0.04) : 0);
  const fol = (i) => (evIdx.includes(i - 1) ? (evIdx.indexOf(i - 1) % 2 ? -0.015 : 0.015) : 0);
  const series = { AAA: mk(drv), BBB: mk(fol), SPY: mk(() => 0) };
  const groups = [{ key: 'g', label: 'G', etf: null, members: ['AAA', 'BBB'] }];
  const events = evIdx.map((i) => ({ driver: 'AAA', date: dates[i], session: 'PM' }));
  const out = buildSpilloverMatrix({ events, series, groups, currentIv: { BBB: 0.4 }, builtAtIso: new Date().toISOString(), yearsBack: 1 });
  const p = out.pairs.find((x) => x.driver === 'AAA' && x.follower === 'BBB');
  assert.ok(p && p.avgAligned != null, 'pair built');
  const sigma = 0.4 / Math.sqrt(252);
  assert.ok(Math.abs(p.sigmaDay - sigma) < 1e-4, 'sigmaDay is the one-day 1σ move');
  assert.ok(Math.abs(p.pricedMove - sigma * SPILLOVER_OPTION_COST_RATIO) < 1e-4, 'pricedMove is the one-day ATM option cost');
  assert.ok(Math.abs(p.edge - (p.avgAligned - p.pricedMove)) < 2e-4, 'edge = aligned average minus option cost');
  assert.ok(p.edge > 0, 'a 1.5% echo beats a ~1% one-day option cost');
  console.log('spillover edge vs one-day option cost: ok');
}

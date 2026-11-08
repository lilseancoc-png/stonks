// Before-open earnings sessions (QC of builds #73-#122). Backfilled prints
// with no session were all read as after-close, so a before-open reporter's
// reaction was measured a session late: Datadog's 23% jump on 2025-11-06
// showed as +0.2%. Checks the curated list (with the 2024 switch dates for
// Disney and PayPal), the one-time re-read of stored prints, and the chatter
// labels that call the Stocktwits sample a 30-post sample. No network.
import assert from 'node:assert/strict';
import {
  curatedEarningsSession, earningsSessionRepairTargets, applyAmSessionRepair,
  computeEarningsReaction, updateEarningsEventsHistory, etDateKey,
} from './build.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { readFile } from 'node:fs/promises';

// 1. The curated list, with switch dates.
assert.equal(curatedEarningsSession('MRNA', '2019-03-06'), 'AM');
assert.equal(curatedEarningsSession('ddog', '2025-11-06'), 'AM');
assert.equal(curatedEarningsSession('JPM', '2016-01-14'), 'AM', 'the original bank rows are unchanged');
assert.equal(curatedEarningsSession('DIS', '2023-11-08'), null, 'Disney reported after the close before May 2024');
assert.equal(curatedEarningsSession('DIS', '2024-08-07'), 'AM');
assert.equal(curatedEarningsSession('PYPL', '2024-02-07'), null);
assert.equal(curatedEarningsSession('PYPL', '2024-04-30'), 'AM');
assert.equal(curatedEarningsSession('AAPL', '2025-10-30'), null, 'after-close names keep the default');

// 2. One print: the stock jumps 20% at the open on the announcement day.
const days = [];
for (let t = Date.UTC(2025, 8, 15); t <= Date.UTC(2025, 11, 31); t += 86400000) {
  const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  days.push(d.toISOString().slice(0, 10));
}
const bars = days.map((t) => (t < '2025-11-06' ? { t, o: 100, c: 100 } : t === '2025-11-06' ? { t, o: 118, c: 120 } : { t, o: 120, c: 120 }));
const late = computeEarningsReaction(bars, '2025-11-06', 'TBD');
assert.equal(late.movePct, 0, 'read as after-close, the jump is missed');
const stored = () => ({ date: '2025-11-06', session: 'TBD', epsActual: 0.11, ...late, pre10Pct: 0.2, pre15Pct: 0.2, ivPre: 0.5, ivPost: 0.4, impliedMoveEstPct: 0.06 });
const ev = stored();
assert.equal(applyAmSessionRepair(ev, bars), true);
assert.equal(ev.session, 'AM');
assert.equal(ev.movePct, 0.2);
assert.equal(ev.gapPct, 0.18);
assert.equal(ev.closeBefore, 100);
for (const k of ['pre10Pct', 'pre15Pct', 'ivPost', 'ivPre', 'impliedMoveEstPct']) assert.equal(k in ev, false, k + ' is re-read on the right side of the print');
const stamped = { ...stored(), impliedMovePct: 0.09 };
applyAmSessionRepair(stamped, bars);
assert.equal(stamped.ivPre, 0.5, 'a live pre-print stamp is kept');
const early = stored();
assert.equal(applyAmSessionRepair(early, bars.filter((b) => b.t >= '2025-11-06')), false, 'no bar before the print: nothing changes');
assert.equal(early.session, 'TBD');
assert.equal(early.movePct, 0);

// 3. Which stored prints get re-read.
const today = '2026-11-08';
const rows = [
  { date: '2025-11-06', session: 'TBD' }, { date: '2026-08-06', session: 'AM' },
  { date: '2026-11-08', session: 'TBD' }, { date: '2025-02-13', session: 'TBD', amRepairTried: true },
];
assert.deepEqual(earningsSessionRepairTargets('DDOG', rows, today).map((e) => e.date), ['2025-11-06'], 'only past, unlabeled, untried prints');
assert.deepEqual(earningsSessionRepairTargets('DIS', [{ date: '2023-11-08', session: 'TBD' }, { date: '2025-11-13', session: 'TBD' }], today).map((e) => e.date), ['2025-11-13']);
assert.deepEqual(earningsSessionRepairTargets('TSLA', [{ date: '2025-10-22', session: 'TBD' }], today), []);

// 4. End to end: a stored Datadog-like print inside the one-year bars is
// re-read on the next build with no network call.
const store = { ivGuardVersion: 1, tickers: { DDOG: { deepBackfill: 1, backfilledAt: etDateKey(), amStampFix: 1, events: [stored()] } } };
const chains = { DDOG: { fundamentals: {}, _bars: bars } };
const realFetch = globalThis.fetch; let fetched = 0;
globalThis.fetch = async () => { fetched++; throw Error('offline'); };
try { await updateEarningsEventsHistory(store, chains, new Map()); } finally { globalThis.fetch = realFetch; }
const after = store.tickers.DDOG.events.find((e) => e.date === '2025-11-06');
assert.equal(fetched, 0);
assert.equal(after.session, 'AM');
assert.equal(after.movePct, 0.2, 'the announcement-day jump is the reaction');
assert.equal(after.pre10Pct, 0, 'the run-up stops before the print');
assert.equal(store.tickers.DDOG.sessionRepairAt, etDateKey());

// 5. The chatter count is a 30-post sample, not a day's volume.
const js = renderAppJs();
assert.equal(js.includes("' msgs/24h'"), false);
assert(js.includes('of 30 sampled posts within 24h'));
const sp = await readFile(new URL('./render/stock-page-js.mjs', import.meta.url), 'utf8');
assert.equal(sp.includes('messages in 24 hours'), false);
assert(sp.includes('of the newest 30 posts were within 24 hours'));

console.log('earnings session smoke ok');

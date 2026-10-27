// Offline checks for the Historical Data event studies, the "resembles now"
// matcher and the Brief playbook headline cues. Synthetic closes only; no
// network and no AI.
import assert from 'node:assert/strict';
import { isHistoricalTradingDate } from '../lib/historical-market-calendar.mjs';
import { cleanLongBars } from '../lib/historical-market-history.mjs';
import { buildHistoricalEvents, measureEpisode, headlineHits, wwdcKeynote, EVENT_CATEGORIES, WWDC_KEYNOTES, FOMC_DECISIONS, CRASH_DROP_PCT } from '../lib/historical-events.mjs';
import { buildHistoricalData, packHistoricalData } from '../lib/historical-data.mjs';
import { refreshHistoricalSourceCache, loadFredReleaseDates } from './collect-historical-sources.mjs';
import { detectPlaybookCues, historicalEventInputs } from './build.mjs';

// Deliberately synthetic, gently rising closes. Not actual market history.
function series(from, to, { shocks = {}, drift = .0003 } = {}) {
  const rows = []; let c = 100, i = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10), dow = new Date(t).getUTCDay();
    if (day >= '1990-01-01' ? !isHistoricalTradingDate(day) : dow === 0 || dow === 6) continue;
    c *= 1 + drift + Math.sin(++i * .21) * .004;
    if (shocks[day] != null) c *= 1 + shocks[day] / 100;
    rows.push({ t: day, c });
  }
  return rows;
}
const pctOf = (rows, day) => { const i = rows.findIndex(r => r.t === day); return (rows[i].c / rows[i - 1].c - 1) * 100; };

// Long-history cleaning keeps pre-1990 weekdays and still rejects 1990+ holidays.
const long = cleanLongBars([{ t: '1987-10-19', c: 224.84 }, { t: '1987-10-17', c: 1 }, { t: '2025-12-25', c: 5 }, { t: '2025-12-26', c: 6 }, { t: '2026-01-02', c: 7 }], '2025-12-31');
assert.deepEqual(long.map(r => r.t), ['1987-10-19', '2025-12-26'], 'weekend and holiday rows dropped; pre-1990 weekday kept; cutoff respected');

// Episode math: measured from the close before the first session on/after the date.
const flat = series('2000-01-03', '2005-12-31', { drift: 0, shocks: { '2001-09-17': -10 } });
const ep = measureEpisode(flat, '2001-09-11');
assert.equal(ep.session, '2001-09-17'); assert.equal(ep.baseline, '2001-09-10');
assert(Math.abs(ep.d1 - pctOf(flat, '2001-09-17')) < 0.01, 'day 1 is the first-session move');
assert(ep.drawdown60Pct <= ep.d1 + 1e-9 && ep.recoverySessions == null && ep.recoveryWindowComplete, 'a flat series never regains a 10% gap; the three-year window is complete');
assert.equal(measureEpisode(flat, '1999-01-04'), null, 'dates before the series are unavailable, not zero');
// Peaks must be an actual bar, and the data says whether it was the high.
assert.equal(measureEpisode(flat, '2001-09-15', { peak: true }), null, 'a peak date that is not a trading day is unavailable, not shifted');
const peaked = series('2000-01-03', '2008-12-31', { drift: .0005, shocks: { '2003-06-02': -30 } });
const pk = measureEpisode(peaked, '2003-05-30', { peak: true });
assert.equal(pk.baseline, '2003-05-30'); assert.equal(pk.session, '2003-06-02'); assert(pk.d1 < -29);
assert.equal(pk.peakConfirmed, false, 'a gently rising series is not at its high three years later; flagged');

// Synthetic market set.
const shocks = { '1987-10-19': -20.5, '1987-10-20': 5, '2008-10-15': -9, '2020-03-16': -12 };
const nq = { '2022-05-05': -5, '2022-05-06': 1, '2022-05-09': -4.5, '2024-08-05': -4.2 };
const gspc = series('1950-01-03', '2026-10-26', { shocks }), ixic = series('1971-02-05', '2026-10-26', { shocks: nq });
const aapl = series('1990-01-02', '2026-10-26'), kre = series('2006-06-01', '2026-10-26'), gme = series('2002-02-13', '2026-10-26', { shocks: { '2021-01-13': 57 } });
const spy = series('1993-01-29', '2026-10-26'), gld = series('2004-11-18', '2026-10-26');
const wti = series('1986-01-02', '2026-10-26').map(r => ({ t: r.t, v: r.c / 2 }));
const flatCtx = (from, v) => series(from, '2026-10-26', { drift: 0 }).map(r => ({ t: r.t, v }));
const context = { VIXCLS: flatCtx('1990-01-02', 18), DCOILWTICO: wti, DGS10: flatCtx('1962-01-02', 4), STLFSI4: flatCtx('1994-01-07', -0.5) };
const base = { series: { '^GSPC': gspc, '^IXIC': ixic, AAPL: aapl, KRE: kre, GME: gme, SPY: spy, GLD: gld }, context, cutoff: '2026-10-26' };
const ev = buildHistoricalEvents(base);

// Every item on the coverage list has a study.
for (const id of ['war', 'pandemic', 'oil', 'tariffs', 'mania', 'squeeze', 'bank-run', 'crash', 'nasdaq-4', 'witching', 'wwdc', 'econ']) assert(ev.studies[id], `study ${id}`);
assert.deepEqual(ev.order, ['war', 'pandemic', 'oil', 'tariffs', 'mania', 'squeeze', 'bank-run', 'crash', 'nasdaq-4', 'witching', 'wwdc', 'econ']);
assert(EVENT_CATEGORIES.every(c => c.episodes.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date))));
assert.equal(ev.studies.war.episodes.filter(e => !e.unavailable).length, ev.studies.war.episodes.length, 'S&P 500 since 1950 covers every war episode');
assert(ev.studies.oil.episodes.find(e => e.date === '1973-10-17' && !e.unavailable && e.oil20Pct == null), '1973 measured on the S&P 500; WTI spot starts 1986');
assert(ev.studies.oil.episodes.find(e => e.date === '2019-09-16').oil20Pct != null);
assert(ev.studies['bank-run'].episodes.find(e => e.date === '2023-03-09').banks20Pct != null);
assert(ev.studies.mania.episodes.find(e => e.date === '2000-03-10').market === '^IXIC');
assert(ev.studies.squeeze.episodes.find(e => e.date === '2021-01-13').d1 > 50, 'GME squeeze day measured on GME');

// Crash days and Black Monday.
const crash = ev.studies.crash;
assert.equal(crash.blackMonday.date, '1987-10-19'); assert(crash.blackMonday.d1 < -20);
assert.equal(crash.occurrences, 3); assert.equal(crash.summary.n, 3);
assert.equal(crash.threshold, CRASH_DROP_PCT); assert.equal(crash.since, gspc[0].t);
assert.match(crash.definition, new RegExp(`down ${-CRASH_DROP_PCT}%`));
// Clusters chain: three drops each 15 sessions apart are one cluster.
const chained = gspc.filter(r => r.t <= '1999-12-31');
const chainIdx = [7000, 7015, 7030].map(i => chained[i].t);
const chainSeries = series('1950-01-03', '1999-12-31', { shocks: Object.fromEntries(chainIdx.map(d => [d, -7])) });
const chainStudy = buildHistoricalEvents({ series: { '^GSPC': chainSeries }, context: {}, cutoff: '1999-12-31' }).studies.crash;
assert.equal(chainStudy.occurrences, 3); assert.equal(chainStudy.clusters, 1, 'a drop 15 sessions after the previous one stays in its cluster');

// Nasdaq 4%: 2022-05-05 drop, slight bounce, then a lower close; 05-09 is the same cluster.
const n4 = ev.studies['nasdaq-4'], may = n4.episodes.find(e => e.date === '2022-05-05');
assert.equal(may.slightBounce, true); assert.equal(may.belowAfterBounce, true); assert.equal(may.below5, true);
assert.equal(n4.episodes.find(e => e.date === '2022-05-09').firstInCluster, false);
assert.equal(n4.all.n, 3); assert.equal(n4.firstInCluster.n, 2);

// Triple witching vs monthly; WWDC; econ.
const [q, m] = ev.studies.witching.rows;
assert(q.n >= 160 && m.n >= 2 * q.n - 8, 'quarterly vs other monthly expirations since 1984');
assert.equal(ev.studies.wwdc.summary.n, WWDC_KEYNOTES.filter(d => d <= '2026-09-20').length, 'every keynote with 20 sessions after it');
const econ = ev.studies.econ;
assert(econ.rows.find(r => r.id === 'fomc').n >= 90, 'FOMC days since 2015');
assert(econ.rows.find(r => r.id === 'cpi').unavailable, 'CPI needs FRED release dates');
assert.equal(econ.upcoming.find(u => u.id === 'fomc').date, '2026-10-28');
assert(FOMC_DECISIONS.every((d, i, a) => !i || a[i - 1] < d), 'FOMC dates sorted and unique');
assert(FOMC_DECISIONS.every(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 3 || d === '2015-09-17' || d === '2018-11-08' || d === '2020-11-05' || d === '2024-11-07'), 'decision days are Wednesdays except four Thursday decisions');
{ const { FOMC_MEETINGS_BASELINE } = await import('./build.mjs'); assert(FOMC_MEETINGS_BASELINE.every(m => FOMC_DECISIONS.includes(m.date)), 'the event list matches the build calendar baseline'); }
const withCpi = buildHistoricalEvents({ ...base, releases: { cpi: { dates: ['2025-01-15', '2025-02-07', '2025-02-12', '2026-11-10'] } } });
const cpiRow = withCpi.studies.econ.rows.find(r => r.id === 'cpi');
assert.equal(cpiRow.n, 2, 'one CPI date per month (the latest listed)'); assert.equal(cpiRow.droppedSameMonth, 1);
// "Other days" exclude every release type, so rows compare against the same quiet sessions.
assert.notEqual(ev.studies.econ.rows.find(r => r.id === 'fomc').otherMeanAbsPct, null);
// Make every non-FOMC session since 2015 a "CPI day": FOMC then has no quiet days to compare with.
const allDays = gspc.filter(r => r.t >= '2015-01-01' && r.t <= '2026-10-26' && !FOMC_DECISIONS.includes(r.t)).map(r => r.t);
const crowded = buildHistoricalEvents({ ...base, releases: { cpi: { dates: allDays } } }).studies.econ.rows.find(r => r.id === 'fomc');
assert.equal(crowded.otherMeanAbsPct, null, 'other days exclude every release type, not just this row');
assert.equal(withCpi.studies.econ.rows.find(r => r.id === 'cpi').marketClosed, 0);

// "Resembles now": quiet tape -> only calendar matches (FOMC in two days).
assert.deepEqual(ev.matches.map(x => x.id), ['econ-fomc'], 'a quiet synthetic tape matches only the upcoming FOMC');
assert.match(ev.matches[0].history, /releases since 2015/);

// Nasdaq -4% and S&P -5% on the latest close.
const hit = buildHistoricalEvents({ ...base, series: { ...base.series, '^IXIC': series('1971-02-05', '2026-10-26', { shocks: { ...nq, '2026-10-26': -4.6 } }), '^GSPC': series('1950-01-03', '2026-10-26', { shocks: { ...shocks, '2026-10-26': -5.5 } }) } });
const ids = hit.matches.map(x => x.id);
assert(ids.includes('nasdaq-4') && ids.includes('crash'));
assert(hit.matches.every(x => !/null|undefined|NaN/.test(x.why + (x.history || ''))), 'no missing numbers in match text');
assert.match(hit.matches.find(x => x.id === 'nasdaq-4').history, /separate episodes \(4 drop days\) since 1971/);
assert.match(hit.matches.find(x => x.id === 'nasdaq-4').history, /slight bounce/);

// Headlines: a tariff headline needs a risk-off reaction; relief headlines never count.
const nowIso = '2026-10-26T21:00:00Z', fresh = '2026-10-26T15:00:00Z';
const hh = headlineHits([{ title: 'White House announces 50% tariffs on EU imports', date: fresh }, { title: 'Tariff pause extended for 90 days', date: fresh }, { title: 'New tariffs threatened', date: '2026-10-20T12:00:00Z' }, { title: 'WHO declares new outbreak a public health emergency', date: fresh }, { title: 'Regional lender hit by deposit outflows', date: fresh }], nowIso);
assert.equal(hh.tariffs.length, 1, 'relief and stale headlines are ignored');
assert(hh.pandemic && hh['bank-run']);
const quietWithNews = buildHistoricalEvents({ ...base, inputs: { headlineHits: hh } });
assert(!quietWithNews.matches.some(x => ['tariffs', 'pandemic', 'bank-run'].includes(x.id)), 'headline without a market reaction is not a match');
const reacting = buildHistoricalEvents({ ...base, series: { ...base.series, '^GSPC': series('1950-01-03', '2026-10-26', { shocks: { ...shocks, '2026-10-26': -1.8 } }) }, inputs: { headlineHits: hh, squeezes: [{ sym: 'XYZ', chPct: 22, rvol: 6 }] } });
const rids = reacting.matches.map(x => x.id);
assert(rids.includes('tariffs') && rids.includes('pandemic') && rids.includes('squeeze'));
assert(!rids.includes('bank-run'), 'bank headline also needs KRE down 5%');
assert.deepEqual(reacting.inputs.squeezes, [{ sym: 'XYZ', chPct: 22, rvol: 6 }], 'inputs travel with the snapshot');

// Bank stress from KRE alone; oil shock; mania.
const kreDrop = series('2006-06-01', '2026-10-26', { shocks: { '2026-10-13': -8, '2026-10-20': -8 } });
assert(buildHistoricalEvents({ ...base, series: { ...base.series, KRE: kreDrop } }).matches.some(x => x.id === 'bank-run'));
const oilSpike = wti.map(r => r.t >= '2026-10-20' ? { ...r, v: r.v * 1.15 } : r);
assert(buildHistoricalEvents({ ...base, context: { ...context, DCOILWTICO: oilSpike } }).matches.some(x => x.id === 'oil'));
// 1987 setup: the comparison numbers are measured from the same data.
const tenUp = context.DGS10.map(r => ({ t: r.t, v: r.t >= '2026-07-01' ? 5.5 : r.t >= '1987-06-01' && r.t <= '1987-10-16' ? 6 : 4 }));
const hot = series('1950-01-03', '2026-10-26', { shocks: { ...shocks, '2026-03-02': 25 } });
const setup = buildHistoricalEvents({ ...base, series: { ...base.series, '^GSPC': hot }, context: { ...context, DGS10: tenUp } }).matches.find(x => x.id === 'crash-1987-setup');
assert(setup, '1987-style setup fires on a 20%+ year with a 1-point yield rise');
assert.match(setup.why, /On 1987-10-16, the last close before Black Monday, the same measures were/);
const boom = series('1971-02-05', '2026-10-26', { shocks: { ...nq, '2026-07-01': 25, '2026-08-03': 25 } });
assert(buildHistoricalEvents({ ...base, series: { ...base.series, '^IXIC': boom } }).matches.some(x => x.id === 'mania'));

// Calendar matches: triple witching week and WWDC (known and estimated).
const juneCut = '2026-06-03', june = Object.fromEntries(Object.entries(base.series).map(([k, v]) => [k, v.filter(r => r.t <= juneCut)]));
const jm = buildHistoricalEvents({ ...base, cutoff: juneCut, series: june, context: Object.fromEntries(Object.entries(context).map(([k, v]) => [k, v.filter(r => r.t <= juneCut)])) }).matches;
assert(jm.some(x => x.id === 'wwdc' && /2026-06-08/.test(x.why)));
const sepCut = '2026-09-15', sep = Object.fromEntries(Object.entries(base.series).map(([k, v]) => [k, v.filter(r => r.t <= sepCut)]));
assert(buildHistoricalEvents({ ...base, cutoff: sepCut, series: sep, context: Object.fromEntries(Object.entries(context).map(([k, v]) => [k, v.filter(r => r.t <= sepCut)])) }).matches.some(x => x.id === 'witching'));
assert.deepEqual(wwdcKeynote(2026), { date: '2026-06-08', estimated: false });
assert.equal(wwdcKeynote(2027).estimated, true); assert.equal(new Date(`${wwdcKeynote(2027).date}T00:00:00Z`).getUTCDay(), 1);

// Collector: event markets and release calendars ride the existing refresh.
const loaded = [];
const cache = await refreshHistoricalSourceCache({ builtAtIso: '2026-10-26T22:00:00Z', loadMarket: async id => { loaded.push(id); return ({ '^GSPC': gspc, '^IXIC': ixic, AAPL: aapl, KRE: kre, GME: gme })[id] || spy; }, loadContext: async () => wti, loadRelease: async id => id === 'cpi' ? ['2025-01-15', '2026-11-10'] : ['2025-01-10'] });
assert(['^GSPC', '^IXIC', 'AAPL', 'KRE', 'GME'].every(id => loaded.includes(id)));
assert.equal(cache.symbols['^GSPC'][0].t, gspc[0].t, 'pre-1990 index history survives collection');
assert.deepEqual(cache.releases.cpi.dates, ['2025-01-15', '2026-11-10']);
const warm = await refreshHistoricalSourceCache({ previous: cache, builtAtIso: '2026-10-27T22:00:00Z', loadRelease: () => { throw new Error('weekly, not daily'); } });
assert.deepEqual(warm.releases.cpi.dates, cache.releases.cpi.dates, 'release calendars refresh weekly and persist');
await assert.rejects(loadFredReleaseDates('cpi', async () => { throw new Error('no network'); }, { apiKey: '' }), /FRED_API_KEY not set/);
let seenUrl = '';
const dates = await loadFredReleaseDates('jobs', async url => { seenUrl = url; return { ok: true, json: async () => ({ release_dates: [{ date: '2026-10-02' }, { date: '2026-09-05' }, { date: '2026-09-05' }] }) }; }, { apiKey: 'k' });
assert.deepEqual(dates, ['2026-09-05', '2026-10-02']); assert.match(seenUrl, /release_id=50/);
await assert.rejects(loadFredReleaseDates('jobs', async () => ({ ok: false, status: 400 }), { apiKey: 'secret-key' }), e => !String(e.message).includes('secret-key'));

// Integration: the snapshot carries events, event coverage stays out of the ledger count.
const full = buildHistoricalData({ sourceCache: cache, builtAtIso: '2026-10-26T22:00:00Z', inputs: { headlineHits: {}, squeezes: [] } });
assert(full.events && full.events.order.length === 12);
assert.equal(full.coverage.total, full.coverage.markets.length + full.coverage.context.length);
assert.equal(full.coverage.eventMarkets.length, 5); assert(full.coverage.eventMarkets.every(s => s.status === 'ready'));
assert.equal(full.coverage.releaseCalendars.find(r => r.id === 'cpi').releases, 1, 'future release dates are not counted as past releases');
const wire = JSON.stringify(packHistoricalData(full));
assert(Buffer.byteLength(wire) < 4_150_000, 'snapshot stays under the response cap');
const again = buildHistoricalData({ sourceCache: cache, builtAtIso: '2026-10-26T22:00:00Z', inputs: JSON.parse(wire).events.inputs });
assert.equal(JSON.stringify(packHistoricalData(again)), wire, 'the audit can rebuild the snapshot from the cache plus stored inputs');

// Brief playbook: headline cues need a risk-off tape; WWDC uses the keynote date.
const chainsDown = { SPY: { technicals: { volume: { priceMove1dPct: -1.6 } } } }, chainsUp = { SPY: { technicals: { volume: { priceMove1dPct: 0.4 } } } };
const headlines = [{ title: 'White House announces 50% tariffs on EU imports', date: '2026-10-26T15:00:00Z' }];
const at = new Date('2026-10-26T20:00:00Z');
assert(detectPlaybookCues({ chains: chainsDown, headlines }, at).some(c => c.id === 'tariffs'));
assert(!detectPlaybookCues({ chains: chainsUp, headlines }, at).some(c => c.id === 'tariffs'));
assert(detectPlaybookCues({ chains: {} }, new Date('2026-06-01T15:00:00Z')).some(c => c.id === 'wwdc'));
assert(!detectPlaybookCues({ chains: {} }, new Date('2026-07-01T15:00:00Z')).some(c => c.id === 'wwdc'));
assert(detectPlaybookCues({ chains: {} }, new Date('2026-06-15T15:00:00Z')).some(c => c.id === 'wwdc'), 'Brief cue and matcher share the keynote +7 day window');
assert(!detectPlaybookCues({ chains: {} }, new Date('2026-06-16T15:00:00Z')).some(c => c.id === 'wwdc'));
const inputs = historicalEventInputs({ ABC: { technicals: { volume: { priceMove1dPct: 30, rvol: 7 } } }, DEF: { technicals: { volume: { priceMove1dPct: 30, rvol: 1 } } } }, headlines, '2026-10-26T20:00:00Z');
assert.deepEqual(inputs.squeezes, [{ sym: 'ABC', chPct: 30, rvol: 7 }]); assert.equal(inputs.headlineHits.tariffs.length, 1);

console.log('historical-events-smoke: ok');

// Price-pillar fix (2026-11-06): breakouts against the PRIOR sessions' range,
// streaks read with the trend, the MACD and 52-week votes retired, the entry
// snapshot on every Track Record trade, retired drivers in the thesis check,
// and the two cheap grader context lines. Offline, no network.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeStreakForTicker, streakTrendRead, streakTrendFromMa, STREAK_TREND_READS } from '../lib/streaks.mjs';
import { buildEntrySnapshot, heavyMoveRead, postEarningsRead, retiredVotes } from '../lib/trade-snapshot.mjs';
import { topPicksMarket } from '../lib/top-picks-market.mjs';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import {
  buildGradesIndex, buildTopPicks, buildThesisUserMessage, graderContextBuilder, priorSupportResistance,
  buildPickForecast, RETIRED_SIGNAL_KEYS, GRADE_MODEL_VERSION, etDateKey,
} from './build.mjs';

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const DAY = 86400000;
const now = new Date().toISOString(), ms = Date.parse(now);

// A ticker whose last bar breaks above the prior 20 sessions' high.
function breakoutTicker({ breakout = 0.03, base = 100 } = {}) {
  const bars = [];
  for (let i = 0; i < 130; i++) {
    const c = base * (1 + 0.01 * Math.sin(i / 3));
    bars.push({ t: new Date(ms - (131 - i) * DAY).toISOString().slice(0, 10), o: c, c, h: c * 1.005, l: c * 0.995, v: Math.round(1e6 * (1 + 0.15 * Math.sin(i * 1.7))) });
  }
  const hi = Math.max(...bars.slice(-100).map((b) => b.h));
  const spot = hi * (1 + breakout);
  bars.push({ t: new Date(ms).toISOString().slice(0, 10), o: spot, c: spot, h: spot * 1.002, l: spot * 0.99, v: 2e6 });
  const ps = { t: bars.map((b) => b.t), c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), v: bars.map((b) => b.v) };
  return { spot, bars, ps };
}
const sigOf = (g, pillar, key) => g?.pillars?.[pillar]?.signals?.find((x) => x.key === key) || null;
// The grade needs an option chain; borrow the entry-policy fixture's.
const baseChain = entryPolicyFixture().data;
const gradeOne = (data, streaks = null) => {
  const g = buildGradesIndex({ ONE: { ...baseChain, ...data } }, [], streaks, null, null, null, { builtAtIso: now }).ONE;
  assert(g, 'graded');
  return g;
};

await check('grade version names the price-pillar fix', () => {
  assert.equal(GRADE_MODEL_VERSION, '2026-11-price-pillar');
  assert(RETIRED_SIGNAL_KEYS.has('macd') && RETIRED_SIGNAL_KEYS.has('fiftyTwoWeek'));
});

await check('support/resistance: a close above the prior 20/100-day high votes +2; the old same-bar window never could', () => {
  const { spot, bars, ps } = breakoutTicker();
  // The bake path: technicals.srPrior from the window that ends one bar early.
  const lv = priorSupportResistance({ priceSeries: ps });
  assert(lv && spot > lv.r20 && spot > lv.r100, 'spot clears both prior highs');
  const g = gradeOne({ spot, priceSeries: ps, technicals: { sr: { r20: Math.max(...bars.slice(-20).map((b) => b.h)), s20: 90 }, sma: {} }, fundamentals: {} });
  const sr = sigOf(g, 'technicals', 'srBreak');
  assert.equal(sr.score, 2, JSON.stringify(sr));
  assert.match(sr.value, /prior 100D high/);
  // Stored srPrior wins over the priceSeries rebuild.
  const g2 = gradeOne({ spot: 100, technicals: { srPrior: { r20: 110, s20: 101, r100: 120, s100: 95 }, sma: {} }, fundamentals: {} });
  assert.equal(sigOf(g2, 'technicals', 'srBreak').score, -1);
  // Inside the range: no vote.
  const g3 = gradeOne({ spot: 100, technicals: { srPrior: { r20: 105, s20: 95, r100: 110, s100: 90 }, sma: {} }, fundamentals: {} });
  assert.equal(sigOf(g3, 'technicals', 'srBreak').score, 0);
});

await check('MACD and the 52-week position no longer vote', () => {
  const g = gradeOne({ spot: 99, technicals: { rsi: 60, rsi5d: 55, macd: { line: 2, signal: 1, hist: 1 }, sma: {} }, fundamentals: { fiftyTwoWeekHigh: 100, fiftyTwoWeekLow: 50 } });
  assert.equal(sigOf(g, 'technicals', 'macd'), null);
  assert.equal(sigOf(g, 'technicals', 'fiftyTwoWeek'), null);
  // The roster forecast no longer reads MACD either.
  const f = buildPickForecast({ total: 5, pillars: { technicals: { signals: [{ key: 'macd', score: 1 }, { key: 'srBreak', score: 2 }] } } }, 'call');
  assert.equal(f.direction, 'upgrade'); // srBreak +2 alone
  const f2 = buildPickForecast({ total: 5, pillars: { technicals: { signals: [{ key: 'macd', score: 1 }, { key: 'smaStack', score: 1 }] } } }, 'call');
  assert.equal(f2.direction, 'hold', 'MACD no longer adds to the forecast');
});

await check('streak rule: up runs need the trend and volume; bounces below the averages count against', () => {
  const run = (color, sameDays, volumeTrend = 'flat') => ({ color, sameDays, volumeTrend });
  assert.equal(streakTrendRead(run('green', 4), 1).vote, 1);
  assert.equal(streakTrendRead(run('green', 4, 'falling'), 1).vote, 0);
  assert.equal(streakTrendRead(run('green', 3), -1).kind, 'bear-rally');
  assert.equal(streakTrendRead(run('green', 3), -1).vote, -1);
  assert.equal(streakTrendRead(run('red', 5), -1).vote, -1);
  assert.equal(streakTrendRead(run('red', 5), 1).kind, 'uptrend-dip');
  assert.equal(streakTrendRead(run('red', 5), 1).vote, 0);
  assert.equal(streakTrendRead(run('green', 2), 1).kind, 'short');
  assert.equal(streakTrendRead(run('green', 6), 0).kind, 'no-trend');
  for (const def of Object.values(STREAK_TREND_READS)) assert(def.label && def.short && [-1, 0, 1].includes(def.vote));
  assert.equal(streakTrendFromMa({ levels: [{ period: 20, distancePct: 1 }, { period: 50, distancePct: 2 }, { period: 100, distancePct: -1 }] }), 1);
  assert.equal(streakTrendFromMa({ levels: [{ period: 20, distancePct: -1 }, { period: 50, distancePct: 2 }] }), 0);
  assert.equal(streakTrendFromMa(null), 0);
});

await check('streak vote in the grade follows the moving-average trend', () => {
  const streaks = (color, sameDays, volumeTrend = 'rising') => ({ ONE: { current: { color, sameDays, cumulativePct: 4, volumeTrend } } });
  const above = { spot: 100, technicals: { sma: { sma20: 95, sma50: 92, sma100: 90 } }, fundamentals: {} };
  const below = { spot: 100, technicals: { sma: { sma20: 105, sma50: 108, sma100: 110 } }, fundamentals: {} };
  assert.equal(sigOf(gradeOne(above, streaks('green', 4)), 'technicals', 'streak').score, 1);
  assert.equal(sigOf(gradeOne(below, streaks('green', 4)), 'technicals', 'streak').score, -1);
  assert.equal(sigOf(gradeOne(above, streaks('red', 4)), 'technicals', 'streak').score, 0);
  assert.equal(sigOf(gradeOne(below, streaks('red', 4)), 'technicals', 'streak').score, -1);
  assert.match(sigOf(gradeOne(below, streaks('green', 4)), 'technicals', 'streak').value, /bounce below its averages/);
});

await check('streaks.json rows carry the same read from their own moving averages', () => {
  const bars = [];
  let c = 100;
  for (let i = 0; i < 120; i++) { c *= 1 + (i < 115 ? -0.004 : 0.012); bars.push({ t: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, c, v: 1e6 }); }
  const row = computeStreakForTicker('X', bars);
  assert.equal(row.current.color, 'green');
  assert.equal(row.trendRead.trend, -1, 'still below the 20/50/100-day averages');
  assert.equal(row.trendRead.kind, 'bear-rally');
  assert.equal(row.trendRead.vote, -1);
});

await check('entry snapshot: votes, pillars, retired votes, heavy-volume day, post-earnings drift and shadow inputs', () => {
  const { spot, ps } = breakoutTicker({ breakout: 0.06 });
  const data = {
    spot, priceSeries: ps,
    technicals: { rsi: 66, rsi5d: 60, macd: { line: 1, signal: 0.5, hist: 0.5 }, sma: { sma20: spot / 1.05, sma50: spot / 1.08, sma200: spot / 1.2 }, volume: { rvol: 2.1 }, srPrior: { r20: spot / 1.06, s20: spot / 1.12 } },
    fundamentals: { fiftyTwoWeekHigh: spot * 1.01, fiftyTwoWeekLow: spot * 0.6 },
    earningsHx: { events: [{ date: ps.t[ps.t.length - 4], movePct: 0.07, closeAfter: spot * 0.97, surprisePct: 12 }] },
  };
  const pick = {
    symbol: 'ONE', streak: { color: 'green', days: 3, cumulativePct: 6, volumeTrend: 'rising', read: 'uptrend-run' },
    pillars: { technicals: { score: 4, signals: [{ key: 'srBreak', score: 2, available: true }, { key: 'social', score: 0, available: false }] }, fundamentals: { score: 2, signals: [{ key: 'pe', score: 0, available: true }] }, timing: { score: 1 } },
  };
  const snap = buildEntrySnapshot(pick, data, { shadow: { keys: ['r21', 'vrp'], rows: { ONE: [5.1, null] } } });
  assert.equal(snap.v, 1);
  assert.deepEqual(snap.pillars, { t: 4, f: 2, tm: 1 });
  assert.deepEqual(snap.signals, { srBreak: 2, pe: 0 }, 'a measured zero is kept; an unavailable signal is left out');
  assert.equal(snap.retired.macd, 1);
  assert.equal(snap.retired.fw, -1, 'near the 52-week high');
  assert.equal(snap.ctx.streak.k, 'uptrend-run');
  assert(snap.ctx.d20 > 4.9 && snap.ctx.d20 < 5.1);
  assert(snap.ctx.r20 > 5.9 && snap.ctx.r20 < 6.1);
  assert.equal(snap.heavy.heavy, 1, 'a 6% breakout on double volume is a heavy 2-sigma day');
  assert.equal(snap.ped.s, 3);
  assert(snap.ped.dr > 2.9 && snap.ped.dr < 3.2, JSON.stringify(snap.ped));
  assert.deepEqual(snap.shadow, { r21: 5.1 }, 'missing shadow inputs are left out');
  assert(JSON.stringify(snap).length < 900, 'stays compact: ' + JSON.stringify(snap).length);
  assert.equal(heavyMoveRead({ priceSeries: { c: [1, 2, 3], v: [1, 1, 1] } }), null);
  assert.equal(postEarningsRead({ earningsHx: { events: [] }, priceSeries: ps }), null);
  assert.deepEqual(retiredVotes({}), {});
});

await check('grader: prior-range levels, the streak kind, ripple peers and the site forecast', () => {
  const { data, row } = entryPolicyFixture();
  const r = structuredClone(row);
  r.data = { ...data, technicals: { ...(data.technicals || {}), srPrior: { r20: 104, s20: 95 }, sma: { sma20: 101, sma50: 98, sma100: 96 } }, earningsHx: { events: [], next: { date: etDateKey(new Date(ms + 9 * DAY)), daysUntil: 9, session: 'PM' } } };
  r.streakRow = { current: { color: 'green', sameDays: 3, cumulativePct: 3.2, volumeTrend: 'falling' } };
  r.pillars.technicals.signals.push({ key: 'smaStack', score: -1, available: true });
  const ctx = graderContextBuilder({
    spillover: { upcoming: [
      { driver: 'NVDA', date: '2026-11-19', session: 'PM', daysUntil: 9, impliedMovePct: 7, followers: [{ follower: 'FIXTURE', pairQualified: true, expB: 3.4 }, { follower: 'OTHER', pairQualified: false }] },
      { driver: 'FAR', date: '2026-12-30', daysUntil: 40, followers: [{ follower: 'FIXTURE', pairQualified: true }] },
    ] },
    earningsForecast: { companies: [{ symbol: 'FIXTURE', forecast: { status: 'ready', outputs: { revenue: 2.4e9, eps: 1.23 }, baseline: { revenue: 2e9 }, sourcePeriod: { end: '2025-09-30' }, target: { end: '2026-09-30' } } }] },
  })('FIXTURE');
  assert.equal(ctx.peerEvents.length, 1, 'only validated peers inside 14 days');
  const msg = buildThesisUserMessage(r, 'call', null, ctx);
  assert.match(msg, /prior 20-day high \(resistance\) \$104\.00/);
  assert.match(msg, /prior 20-day low \(support\) \$95\.00/);
  assert.match(msg, /3-day green streak .* bounce below its averages/);
  assert.match(msg, /volume falling/);
  assert.match(msg, /PEER EARNINGS IN THE HOLD .*NVDA reports 2026-11-19 PM \(9d\), typical ripple ±3\.4% here/);
  assert.match(msg, /SITE EARNINGS FORECAST .*quarter ending 2026-09-30.*revenue \$2\.40B \(\+20\.0% vs the quarter ending 2025-09-30\), EPS \$1\.23/);
  // Nothing to say when there is nothing in the hold.
  const quiet = buildThesisUserMessage(r, 'call', null, {});
  assert.doesNotMatch(quiet, /PEER EARNINGS|SITE EARNINGS FORECAST/);
});

// --- Track record: entry snapshot + retired drivers --------------------------
const storage = await mkdtemp(join(tmpdir(), 'price-pillar-'));
try {
  await mkdir(join(storage, 'data'));
  let source = await readFile(new URL('./build.mjs', import.meta.url), 'utf8');
  source = source.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+|export\s*\{[^}]*\}\s*from\s+)(["'])([^"']+)\2/gm, (whole, prefix, quote, specifier) => specifier.startsWith('node:') ? whole : prefix + quote + (specifier.startsWith('.') ? new URL(specifier, new URL('./build.mjs', import.meta.url)).href : import.meta.resolve(specifier)) + quote);
  source = source.replace('const ROOT = resolve(__dirname, "..");', 'const ROOT = ' + JSON.stringify(storage) + ';');
  await writeFile(join(storage, 'engine.mjs'), source);
  const engine = await import(pathToFileURL(join(storage, 'engine.mjs')).href);
  const { data, row, aiThesis } = entryPolicyFixture();
  const macro = { state: 'neutral', stress: 0, dataQuality: { sufficient: true }, axes: { indexes: { score: 0, available: true }, vix: { score: 0, available: true } },
    inputs: { indexes: { asOf: now, spy: { pctChange1d: 0 }, qqq: { pctChange1d: 0 } }, vix: { asOf: now, value: 18 } } };
  const built = buildTopPicks({ FIXTURE: data }, [], null, null, { macroRegime: macro }, null, .045,
    { preScored: { scored: [structuredClone(row)], peerIndex: {}, regimeBand: 'neutral' }, marketAssessment: topPicksMarket.assess({ macroRegime: macro, asOf: now }), aiThesisMap: { 'FIXTURE:call': aiThesis }, builtAtIso: now });
  assert.equal(built[0]?.group, 'actionable', 'fixture enrolls');
  const picks = built.map((p) => ({ ...p, symbol: 'AAPL' }));
  await writeFile(join(storage, 'data/picks.json'), JSON.stringify({ builtAtIso: now, rosterMeta: built.rosterMeta, picks }));
  const chains = { AAPL: data };
  await engine.updatePicksAccuracyFile(chains, now, { open: [], closed: [] }, null, { shadow: { keys: ['r21'], rows: { AAPL: [4.2] } } });
  const first = await engine.readPicksAccuracyState();
  await check('record: every enrolled trade freezes the entry snapshot', () => {
    assert.equal(first.open.length, 1);
    const snap = first.open[0].entrySnapshot;
    assert(snap && snap.v === 1, JSON.stringify(first.open[0]).slice(0, 300));
    assert.equal(snap.signals['test-technicals'], 3);
    assert.equal(snap.pillars.t, 3);
    assert.deepEqual(snap.shadow, { r21: 4.2 });
    assert.equal(first.open[0].gradeModelVersion, '2026-11-price-pillar');
  });
  await check('record: an open trade whose drivers were all retired votes is not closed as thesis-broken', async () => {
    const state = structuredClone(first);
    state.open[0].thesis = { ...(state.open[0].thesis || {}), driverKeys: ['macd', 'fiftyTwoWeek'], stopSpot: null };
    const later = new Date(ms + 60000).toISOString();
    await engine.updatePicksAccuracyFile(chains, later, state, { AAPL: { total: 6, drivers: [{ key: 'epsGrowth', score: 1 }] } }, { enrollNewPicks: false });
    const after = JSON.parse(await readFile(join(storage, 'data/picks-accuracy.json'), 'utf8'));
    assert.equal(after.open.length, 1, JSON.stringify(after.closed?.[0]?.status));
    assert.notEqual(after.open[0].thesisStatus?.verdict, 'broken');
    assert.equal(after.open[0].thesisStatus?.driversTotal, 0);
  });
} finally { await rm(storage, { recursive: true, force: true }); }

console.log(`${checks} price-pillar checks passed.`);

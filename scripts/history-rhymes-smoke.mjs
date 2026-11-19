// Offline checks for Booms & busts (lib/history-rhymes.mjs): the equity-implied
// credit model, the six AI buildout signs and the six whole-market signs with
// their bear market history test (lib/history-rhymes-market.mjs), the public /
// Owner split, the summary that Historical Data, the Owner brief and shadow
// logging read, and the wiring into the store policy, MCP and the browser
// page. No network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildHistoryRhymes, buildHistoryRhymesOwner, historyRhymesSummary, mertonCredit, realizedVol, stockCreditRead, stageFor, roleOf,
  CASES, SIGNS, SOURCES, ROLES, REPORTED_CDS, HISTORY_RHYMES_KEY, HISTORY_RHYMES_OWNER_KEY, HISTORY_RHYMES_FRED,
} from '../lib/history-rhymes.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { OPTIONAL_BAKE_KEYS } from '../lib/data-ownership.mjs';
import { SHARED_FRED_IDS } from '../lib/historical-sources.mjs';
import { MARKET_SIGNS, MARKET_COUNT_RULE, bearMarkets, marketHistoryTest, marketSignCounts, readMarketSigns, addMonths, baaMiddle } from '../lib/history-rhymes-market.mjs';
import { SOURCE_KEYS } from '../lib/site-catalog/feature-sources.mjs';
import { FEATURE_DATASETS } from '../lib/mcp/tools.mjs';
import { buildOwnerMarketBrief, OWNER_BRIEF_SOURCES } from '../lib/owner-market-brief.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';
import { buildShadowSignals } from '../lib/shadow-signals.mjs';

// ---- the Merton model ---------------------------------------------------
{
  // A heavily indebted, volatile builder (about CoreWeave's shape in late 2026):
  // the model should read a high default chance and a spread above 1,000 bp.
  const crwv = mertonCredit({ equity: 40e9, debt: 30e9, sigmaE: 1.0, r: 0.04, years: 5 });
  assert(crwv.converged, 'the solver converges');
  assert(crwv.pdPct > 40 && crwv.pdPct < 90, `high default chance for a levered, volatile builder (${crwv.pdPct})`);
  assert(crwv.spreadBp > 600, `wide model spread (${crwv.spreadBp})`);
  // A cash-rich mega cap with little debt: close to zero.
  const safe = mertonCredit({ equity: 3e12, debt: 1e11, sigmaE: 0.3 });
  assert(safe.pdPct < 0.5 && safe.spreadBp <= 5, 'little debt, low volatility, near-zero default chance');
  // More debt, same equity and volatility: a higher default chance.
  const lo = mertonCredit({ equity: 100e9, debt: 20e9, sigmaE: 0.5 }), hi = mertonCredit({ equity: 100e9, debt: 80e9, sigmaE: 0.5 });
  assert(hi.pdPct > lo.pdPct && hi.spreadBp >= lo.spreadBp, 'monotone in debt');
  // Higher volatility, same balance sheet: a higher default chance.
  assert(mertonCredit({ equity: 100e9, debt: 50e9, sigmaE: 0.8 }).pdPct > mertonCredit({ equity: 100e9, debt: 50e9, sigmaE: 0.3 }).pdPct, 'monotone in volatility');
  for (const bad of [{}, { equity: 0, debt: 1, sigmaE: 0.3 }, { equity: 1, debt: 0, sigmaE: 0.3 }, { equity: 1, debt: 1, sigmaE: 0 }, { equity: 'x', debt: 1, sigmaE: 0.3 }]) {
    assert.equal(mertonCredit(bad), null, 'bad input returns null, not a number');
  }
  assert.equal(realizedVol([100, 101]), null, 'short history has no volatility');
  const flat = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(0.001 * i));
  assert(realizedVol(flat) < 1e-6, 'a steady climb has no volatility');
  const zig = Array.from({ length: 300 }, (_, i) => (i % 2 ? 101 : 99));
  assert(realizedVol(zig) > 0.2, 'daily swings read as volatility');
}

// ---- stage labels: boom and bust read apart -----------------------------
{
  const st = (boom, boomTotal, bust, bustTotal) => stageFor({ boom, boomTotal, bust, bustTotal }).id;
  assert.equal(st(0, 3, 0, 3), 'quiet');
  assert.equal(st(1, 3, 0, 3), 'early');
  assert.equal(st(2, 3, 0, 3), 'boom', 'two of three boom signs and no strain');
  assert.equal(st(3, 3, 0.5, 3), 'boom', 'one partial bust sign is not yet strain');
  assert.equal(st(2, 3, 1, 3), 'late', 'boom signs plus one bust sign');
  assert.equal(st(1, 3, 1, 3), 'strain', 'strain without most boom signs');
  assert.equal(st(3, 3, 2, 3), 'bust');
  assert.equal(st(0, 3, 2.5, 3), 'bust', 'the bust side reads first');
  assert.equal(st(3, 3, 1, 2), 'late', 'shares use the counted signs with a reading');
  assert.equal(st(0, 0, 0, 0), 'quiet', 'no readings at all');
  assert.equal(stageFor().id, 'quiet');
  assert(['quiet', 'early', 'boom', 'late', 'strain', 'bust'].every((id) => {
    const s = stageFor(id === 'quiet' ? {} : id === 'early' ? { boom: 1, boomTotal: 3 } : id === 'boom' ? { boom: 3, boomTotal: 3 } : id === 'late' ? { boom: 3, boomTotal: 3, bust: 1, bustTotal: 3 } : id === 'strain' ? { bust: 1, bustTotal: 3 } : { bust: 3, bustTotal: 3 });
    return s.id === id && s.label && s.note;
  }), 'every stage has a label and a note');
}

// ---- whole-market signs and the bear market test --------------------------
{
  // Bear markets from closes: a 25% fall, a 15% dip (not a bear) and an open fall.
  const closes = [['2000-01-03', 100], ['2000-03-01', 120], ['2000-06-01', 100], ['2000-09-01', 90], ['2001-01-02', 125], ['2001-03-01', 110], ['2001-06-01', 130], ['2002-01-02', 98], ['2002-03-01', 104]].map(([t, c]) => ({ t, c }));
  const bears = bearMarkets(closes);
  assert.equal(bears.length, 2);
  assert.deepEqual(bears[0], { peak: '2000-03-01', trough: '2000-09-01', fallPct: -25, ongoing: false, name: '2000–02 dot-com bust' });
  assert.equal(bears[1].ongoing, true, 'a fall with no new high since is still open');
  assert.equal(bears[1].peak, '2001-06-01');
  // A synthetic history: four bear markets, each preceded by an inverted
  // curve; the curve is otherwise positive. Rates rise steadily all along, so
  // that sign is lit nearly everywhere and adds nothing.
  const months = []; for (let k = '1980-01'; k <= '2020-12'; k = addMonths(k, 1)) months.push(k);
  const peaks = ['1989-06', '1998-06', '2007-06', '2016-06'];
  const daily = (f) => months.map((k) => ({ t: `${k}-15`, v: f(k) }));
  const fred = {
    DFF: daily((k) => 2 + (months.indexOf(k) % 48) * 0.06),
    DGS10: daily((k) => 5 + (months.indexOf(k) % 12) * 0.2),
    DGS2: daily(() => 4),
    T10Y2Y: daily((k) => (peaks.some((p) => k <= p && k > addMonths(p, -9)) ? -0.2 : 0.8)),
    BAA10Y: daily(() => 2),
  };
  const spx = []; let v = 100;
  for (const k of months) {
    v *= peaks.includes(addMonths(k, -1)) ? 0.75 : 1.004;
    spx.push({ t: `${k}-28`, c: v });
  }
  const t = marketHistoryTest({ fred, spx });
  assert.equal(t.bears.length, 4, 'four bear markets found');
  assert.equal(t.signs['curve-inverted'].bearsBefore, t.signs['curve-inverted'].bearsCovered, 'the curve was inverted before every one');
  assert(t.signs['curve-inverted'].lift >= MARKET_COUNT_RULE.minLift, `the curve passes (${t.signs['curve-inverted'].lift})`);
  assert(t.signs['rates-rising'].litMonths > 0);
  assert.equal(t.signs['credit-strain'].litMonths, 0, 'a flat Baa spread never lights');
  for (const b of t.bears) assert.equal(b.reads['curve-inverted'].status, 'lit', `${b.peak}: curve lit in the year before`);
  assert(t.until <= addMonths('2020-12', -24), 'the test stops 24 months before the data ends');
  // Months inside a decline are left out.
  const inside = months.filter((k) => t.bears.some((b) => k > b.peak.slice(0, 7) && k <= b.trough.slice(0, 7))).length;
  assert(inside > 0 && t.signs['curve-inverted'].months < months.length - inside);
  // The count rule: a bust sign counts only when it passes; boom signs and
  // untested bust signs always count.
  const sign = (id) => MARKET_SIGNS.find((s) => s.id === id);
  assert.deepEqual(marketSignCounts(sign('curve-inverted'), { lift: 1.7, litMonths: 100 }), { counts: true, why: 'passed' });
  assert.deepEqual(marketSignCounts(sign('rates-rising'), { lift: 0.94, litMonths: 254 }), { counts: false, why: 'failed' });
  assert.deepEqual(marketSignCounts(sign('rates-rising'), { lift: 3, litMonths: 10 }), { counts: false, why: 'failed' }, 'too few lit months');
  assert.deepEqual(marketSignCounts(sign('credit-strain'), null), { counts: true, why: 'untested' });
  assert.deepEqual(marketSignCounts(sign('valuation'), null), { counts: true, why: null });
  assert(MARKET_SIGNS.filter((s) => s.side === 'bust').every((s) => s.tested) && MARKET_SIGNS.filter((s) => s.side === 'boom').every((s) => !s.tested));
  assert(MARKET_SIGNS.every((s) => s.label && s.rule && s.then));
  // Today's readings with nothing in hand are unknown, never clear.
  const none = readMarketSigns({});
  assert(MARKET_SIGNS.every((s) => none[s.id].status === 'unknown' && none[s.id].now), 'missing inputs read unknown');
  // Rates: fed funds flat, the 10-year up 1.6 points in a year: lit.
  const days = Array.from({ length: 800 }, (_, i) => new Date(Date.UTC(2024, 8, 1) + i * 86400000).toISOString().slice(0, 10));
  const r = readMarketSigns({ fred: { DFF: days.map((t) => ({ t, v: 4 })), DGS10: days.map((t, i) => ({ t, v: 3.5 + i * 0.0045 })), DGS2: days.map((t) => ({ t, v: 3.9 })), T10Y2Y: days.map((t, i) => ({ t, v: i === 300 ? -0.05 : 0.6 })) } });
  assert.equal(r['rates-rising'].status, 'lit', r['rates-rising'].now);
  assert.match(r['rates-rising'].now, /10-year yield [\d.]+%, \+1\.[5-9]\d over a year/);
  assert.match(r['rates-rising'].now, /close to fed funds/);
  // Credit strain needs a level (2026-11-17): a widening counts partly only
  // while the Baa spread sits at or above its long-run middle; a jump big
  // enough to light the sign lights it at any level.
  const baaHist = Array.from({ length: 360 }, (_, i) => ({ t: `${1990 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-28`, v: 2.4 }));
  const dayOf = (i) => new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString().slice(0, 10);
  const baaNow = (to, up) => [...baaHist, ...Array.from({ length: 100 }, (_, i) => ({ t: dayOf(i), v: to - up + up * i / 99 }))];
  const tight = readMarketSigns({ fred: { BAA10Y: baaNow(2.0, 0.2) } })['credit-strain'];
  assert.equal(tight.status, 'clear', 'Baa +0.2 to 2.0, below its 2.4 middle, does not count');
  assert.match(tight.now, /long-run middle is 2\.40\..*still below their long-run middle, so the widening does not count yet\./);
  const wide = readMarketSigns({ fred: { BAA10Y: baaNow(2.6, 0.2) } })['credit-strain'];
  assert.equal(wide.status, 'partial', 'Baa +0.2 to 2.6, above its middle, is partly showing');
  assert.doesNotMatch(wide.now, /does not count/);
  assert.equal(readMarketSigns({ fred: { BAA10Y: baaNow(1.9, 0.4) } })['credit-strain'].status, 'lit', 'a 0.4 jump lights at any level');
  const hyOnly = readMarketSigns({ fred: { BAA10Y: baaNow(2.0, 0), BAMLH0A0HYM2: Array.from({ length: 100 }, (_, i) => ({ t: dayOf(i), v: 3 + 0.4 * i / 99 })) } })['credit-strain'];
  assert.equal(hyOnly.status, 'clear', 'high yield +0.4 with Baa below its middle does not count');
  assert.equal(baaMiddle(new Map([['2000-01', { last: 1 }]]), '2000-01'), null, 'no middle under two years of months');
  const mids = new Map(Array.from({ length: 30 }, (_, i) => [addMonths('2000-01', i), { last: i < 20 ? 1 : 9 }]));
  assert.equal(baaMiddle(mids, addMonths('2000-01', 23)), 1, 'the middle uses months up to the key only');
  assert.equal(r['curve-inverted'].status, 'lit', 'one inverted day inside two years lights the curve sign');
  assert.match(r['curve-inverted'].now, /last inverted in 2025-06/);
  // Valuation, margin debt and bond sales.
  const v2 = readMarketSigns({ fred: { DGS10: [{ t: '2026-11-10', v: 4.9 }] }, chains: { SPY: { fundamentals: { trailingPE: 26.8 } } } }).valuation;
  assert.equal(v2.status, 'lit', 'a 3.7% earnings yield under a 4.9% bond yield');
  assert.match(v2.now, /trailing P\/E is 26\.8.*1\.2 points less than bonds/);
  assert.equal(readMarketSigns({ fred: { DGS10: [{ t: '2026-11-10', v: 3 }] }, chains: { SPY: { fundamentals: { forwardPE: 20 } } } }).valuation.status, 'clear', '5% against 3% is cheap enough');
  const md = (yoy) => readMarketSigns({ crowd: { marginDebt: { summary: { month: '2026-10', debitUsdM: 1.2e6, yoyPct: yoy, peak: { month: '2026-10', fromPeakPct: 0 } } } } })['margin-debt'];
  assert.equal(md(34).status, 'lit'); assert.equal(md(20).status, 'partial'); assert.equal(md(5).status, 'clear');
  assert.match(md(34).now, /\$1200 billion in 2026-10, \+34\.0% from a year earlier, a record\./);
}

// ---- synthetic inputs -----------------------------------------------------
const day = (start, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10);
// Nasdaq: 600 sessions climbing about 0.2% a day (a stretched year).
const ixic = Array.from({ length: 600 }, (_, i) => ({ t: day('2024-11-01', i), c: 10000 * Math.exp(0.002 * i) }));
const gspc = Array.from({ length: 600 }, (_, i) => ({ t: day('2024-11-01', i), c: 5000 * Math.exp(0.001 * i) }));
const monthly = (from, n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + i, 1)); return { t: d.toISOString().slice(0, 10), v: f(i) }; });
const daily = (from, n, f) => Array.from({ length: n }, (_, i) => ({ t: day(from, i), v: f(i) }));
const fred = {
  // Baa spread since 1986, with the 2008 spike, widening 0.5 over the last quarter.
  BAA10Y: [...monthly('1986-01-01', 480, (i) => (i >= 270 && i <= 280 ? 5.5 : 2.0)), ...daily('2026-08-01', 100, (i) => 1.5 + i * 0.005)],
  BAMLH0A0HYM2: daily('2023-11-01', 1100, (i) => 3.0 + (i > 1000 ? (i - 1000) * 0.01 : 0)),
  BAMLC0A0CM: daily('2023-11-01', 1100, () => 0.9),
  USSTHPI: monthly('1975-01-01', 620, (i) => 60 * Math.exp(0.004 * i) * (i >= 380 && i <= 440 ? 0.8 : 1)).filter((_, i) => i % 3 === 0),
  MORTGAGE30US: monthly('1971-04-01', 660, () => 6.5),
  DRSFRMACBS: monthly('1991-01-01', 420, (i) => (i >= 220 && i <= 260 ? 11 : 2)).filter((_, i) => i % 3 === 0),
  PRCMUCONS: monthly('1993-01-01', 400, (i) => 20000 + (i >= 80 && i <= 100 ? 30000 : 0)),
  // Two years of rates: fed funds up a little, hikes priced, curve positive.
  DFF: daily('2024-11-01', 740, (i) => 3.6 + (i > 600 ? 0.3 : 0)),
  DGS10: daily('2024-11-01', 740, (i) => 4.1 + i * 0.0011),
  DGS2: daily('2024-11-01', 740, () => 4.5),
};
fred.T10Y2Y = fred.DGS10.map((r) => ({ t: r.t, v: Math.round((r.v - 4.5) * 100) / 100 + 0.5 }));
const crowd = { marginDebt: { summary: { month: '2026-10', debitUsdM: 1.25e6, yoyPct: 33, momPct: 2, peak: { month: '2026-10', fromPeakPct: 0 } } } };
const aiCapex = { builtAtIso: '2026-11-11T21:00:00Z', totals: { revenue: { capexYoyPct: 60, yoyPct: 14, count: 7, capexToRevenueTtmPct: 27, capexToRevenueFyPriorPct: 19 } } };
const accelerators = { builtAtIso: '2026-11-06T16:30:00Z', benchmarks: [{ modelId: 'h100', currentMedian: 2.1, change30dPct: -6, compositeHistory: [{ d: '2026-06-01', p: 2.6 }, { d: '2026-11-06', p: 2.1 }] }] };
const ipoCredit = { raises: { bonds: { latest: { m: '2026-10' }, months: Array.from({ length: 16 }, (_, i) => ({ m: `2025-${String(i + 1).padStart(2, '0')}`, ig: i >= 13 ? 180 : 120, hy: 25, cv: 8 })) } } };
// Alternating closes whose one-year realized volatility is `vol`.
const bars = (n, vol) => Array.from({ length: n }, (_, i) => ({ c: 100 * Math.exp(vol / (2 * Math.sqrt(252)) * (i % 2 ? 1 : -1)) }));
const stock = (sym, f, { spot = 100, vol = 0.4, etf = false } = {}) => ({ symbol: sym, spot, _bars: bars(260, vol), fundamentals: { quoteType: etf ? 'ETF' : 'EQUITY', ...f } });
const chains = {
  CRWV: stock('CRWV', { marketCap: 40e9, totalDebt: 30e9, totalCash: 2e9, fiftyTwoWeekHigh: 190, operatingCashFlow: 3e9, freeCashFlow: -8e9, capitalAllocation: { capexTtm: -11e9 } }, { spot: 95, vol: 1.0 }),
  ORCL: stock('ORCL', { marketCap: 600e9, totalDebt: 110e9, fiftyTwoWeekHigh: 340, operatingCashFlow: 22e9, freeCashFlow: -10e9, capitalAllocation: { capexTtm: -32e9 }, creditRating: { agency: 'S&P', rating: 'BBB-', outlook: 'stable', asOf: '2026-07' } }, { spot: 220, vol: 0.5 }),
  MSFT: stock('MSFT', { marketCap: 3.6e12, totalDebt: 60e9, fiftyTwoWeekHigh: 560, operatingCashFlow: 140e9, freeCashFlow: 70e9, capitalAllocation: { capexTtm: -70e9 } }, { spot: 500, vol: 0.25 }),
  META: stock('META', { marketCap: 1.8e12, totalDebt: 50e9, fiftyTwoWeekHigh: 790, operatingCashFlow: 110e9, freeCashFlow: 40e9, capitalAllocation: { capexTtm: -70e9 } }, { spot: 700, vol: 0.35 }),
  NVDA: stock('NVDA', { marketCap: 4.5e12, totalDebt: 10e9, fiftyTwoWeekHigh: 210, operatingCashFlow: 90e9, freeCashFlow: 80e9, capitalAllocation: { capexTtm: -5e9 } }, { spot: 190, vol: 0.45 }),
  JPM: stock('JPM', { marketCap: 800e9, totalDebt: 500e9, fiftyTwoWeekHigh: 330 }, { spot: 300, vol: 0.2 }),
  SMH: stock('SMH', { fiftyTwoWeekHigh: 400 }, { spot: 330, etf: true }),
  AAPL: stock('AAPL', { marketCap: 3.9e12, totalDebt: 0, fiftyTwoWeekHigh: 280 }, { spot: 270, vol: 0.25 }),
  SPY: stock('SPY', { trailingPE: 27, fiftyTwoWeekHigh: 700 }, { spot: 680, etf: true }),
};
const builtAtIso = '2026-11-12T21:10:00Z';
const series = { '^IXIC': ixic, '^GSPC': gspc };
const rhymes = buildHistoryRhymes({ builtAtIso, series, fred, aiCapex, accelerators, ipoCredit, chains, crowd });

// ---- the public payload ---------------------------------------------------
{
  assert.equal(rhymes.version, 2);
  assert.equal(rhymes.stale, false);
  assert.equal(rhymes.now.total, 6);
  assert.equal(rhymes.now.signs.length, SIGNS.length);
  assert.deepEqual(rhymes.now.signs.map((s) => s.id), SIGNS.map((s) => s.id), 'signs keep their order');
  assert.deepEqual(SIGNS.map((s) => s.side), ['boom', 'boom', 'boom', 'bust', 'bust', 'bust'], 'three boom and three bust signs');
  const status = Object.fromEntries(rhymes.now.signs.map((s) => [s.id, s.status]));
  const spending = rhymes.now.signs.find((s) => s.id === 'spending');
  assert.equal(status.spending, 'lit', 'capex +60% vs revenue +14%, 27% of revenue, above the builders\' cash flow');
  assert.deepEqual(spending.parts.map((p) => p.id), ['capex-vs-revenue', 'capex-intensity', 'capex-vs-cash'], 'capital spending is one sign with three parts');
  assert.deepEqual(spending.parts.map((p) => p.status), ['lit', 'lit', 'lit']);
  assert.equal(status['price-falls'], 'lit', 'H100 rent -6% over 30 days');
  assert.equal(status['debt-funding'], 'lit', 'two debt-funded builders lean on debt');
  assert(!('credit-strain' in status), 'credit strain moved to the whole-market panel');
  // Drawdowns in each stock's own swings: CRWV (100% a year) is 50% off its
  // high, 0.69 of a year's swing; ORCL (50% a year) is 35% off, 0.87.
  assert.equal(status['weak-link'], 'partial', 'ORCL 35% off its high is the deeper fall in its own swings');
  const wl = rhymes.now.signs.find((s) => s.id === 'weak-link');
  assert.equal(wl.value, -35.3, 'the value is the deepest fall in swings, as a percent');
  assert.match(wl.now, /^\w+ -?[\d.]+% and \w+ -?[\d.]+% from their 52-week highs\. Against each stock's own yearly swing \(ORCL about 50% and CRWV about 100%\), the deepest fall is ORCL's at 0\.87 of a year's swing; 1\.46 lights the sign and 0\.82 lights it partly\.$/, 'two builders read as one sentence, with their swings');
  assert.equal(status['price-stretch'], 'lit', 'Nasdaq doubled in a year');
  assert.equal(status['leaders-crack'], 'partial', 'SMH 17.5% off its high, 0.48 of its 40% yearly swing');
  assert.match(rhymes.now.signs.find((s) => s.id === 'leaders-crack').now, /It moves about 40% in a typical year, so the fall is 0\.48 of a year's swing; 0\.64 lights the sign and 0\.30 lights it partly\.$/);
  assert(rhymes.now.signs.every((s) => ['lit', 'partial', 'clear', 'unknown'].includes(s.status) && typeof s.now === 'string' && s.now && !/NaN|undefined|null/.test(s.now)), 'every sign has a clean sentence');
  assert(rhymes.now.signs.every((s) => !/(^|[^1\d])[123]th\b|\b1[123](st|nd|rd)\b/.test(s.now)), 'ordinals read 1st, 2nd, 3rd, 11th');
  const expectScore = rhymes.now.lit.length + rhymes.now.partial.length * 0.5;
  assert.equal(rhymes.now.score, expectScore, 'lit counts 1, partial 0.5');
  assert.deepEqual(rhymes.now.boom, { score: 3, known: 3, counted: 3, total: 3 });
  assert.deepEqual(rhymes.now.bust, { score: 2, known: 3, counted: 3, total: 3 });
  assert.equal(rhymes.now.stage.id, 'bust', 'every boom sign and 2 of 3 bust signs');
  assert(rhymes.now.mostLike && rhymes.now.matches.length === 3, 'three historical cases are compared');
  assert.equal(rhymes.now.mostLike.id, 'telecom', 'all six signs match telecom best');
  // The whole-market panel.
  const m = rhymes.now.market;
  assert.deepEqual(m.signs.map((s) => s.id), MARKET_SIGNS.map((s) => s.id));
  const ms = Object.fromEntries(m.signs.map((s) => [s.id, s.status]));
  assert.equal(ms['margin-debt'], 'lit', 'margin debt +33% from a year earlier');
  assert.equal(ms.valuation, 'lit', 'SPY earns 3.7% against a 4.9% bond yield');
  assert.equal(ms['credit-growth'], 'lit', 'bond sales up 39%');
  assert.equal(ms['rates-rising'], 'partial', 'fed funds up 0.3 with hikes priced');
  assert.equal(ms['curve-inverted'], 'clear');
  assert.equal(ms['credit-strain'], 'lit', 'Baa +0.45 over three months');
  assert.equal(rhymes.bearTest, null, 'two years of S&P 500 closes find no bear market to test against');
  assert(m.signs.every((s) => s.counts === true), 'with no history to test, every sign counts');
  assert(m.signs.filter((s) => s.tested).every((s) => s.countWhy === 'untested'));
  assert.deepEqual(m.boom, { score: 3, known: 3, counted: 3, total: 3 });
  assert.deepEqual(m.bust, { score: 1.5, known: 3, counted: 3, total: 3 });
  assert.equal(m.stage.id, 'late');
  assert(m.signs.every((s) => s.sources.length && s.sources.every((id) => SOURCES[id])), 'every market sign names its data source');
  assert(m.signs.every((s) => typeof s.now === 'string' && s.now && !/NaN|undefined|null/.test(s.now)), 'every market sign has a clean sentence');
  assert.equal(rhymes.inputs.marginDebt, '2026-10');
  assert(rhymes.now.matches.every((m, i, a) => i === 0 || a[i - 1].similarity >= m.similarity), 'matches sorted by similarity');
  // The cases: four, every dated fact has a known source and a link.
  assert.deepEqual(rhymes.cases.map((c) => c.id), CASES.map((c) => c.id));
  assert.deepEqual(CASES.map((c) => c.id), ['railroads', 'telecom', 'housing', 'ai-buildout']);
  for (const c of rhymes.cases) {
    assert(c.name && c.summary && c.story.length >= 3, `${c.id} has a story`);
    assert(c.timeline.length >= 4 && c.timeline.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.text), `${c.id} timeline is dated`);
    assert(c.timeline.every((e) => !e.source || (SOURCES[e.source] && e.sourceUrl)), `${c.id} timeline sources resolve`);
    assert(c.numbers.every((n) => !n.source || (SOURCES[n.source] && n.sourceUrl)), `${c.id} numbers' sources resolve`);
    assert(c.timeline.every((e, i, a) => i === 0 || a[i - 1].date <= e.date), `${c.id} timeline in date order`);
  }
  assert(Object.values(SOURCES).every((s) => /^https:\/\//.test(s.url) && s.label), 'every source is an https link with a label');
  assert(REPORTED_CDS.every((q) => SOURCES[q.source] && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && (q.bp == null || q.bp > 0) && q.note), 'reported CDS quotes are dated and sourced');
  assert(REPORTED_CDS.some((q) => q.symbol === 'CRWV' && q.bp >= 1000), 'the CoreWeave quote is on the list');
  // Computed history from the FRED rows.
  assert(rhymes.credit.baa.now && rhymes.credit.baa.pctile != null, 'Baa spread now and its percentile');
  assert(rhymes.credit.reported.length === REPORTED_CDS.length, 'press CDS quotes ride the public file');
  assert(rhymes.housing && rhymes.telecom && rhymes.gpu && rhymes.analog, 'case blocks present');
  assert(Array.isArray(rhymes.analog.now?.rows) && rhymes.analog.now.rows.length > 10, 'the AI-era Nasdaq path is drawn');
  assert.deepEqual(Object.keys(rhymes.inputs.fred), HISTORY_RHYMES_FRED, 'inputs date every FRED series');
  // No per-stock model numbers in the public file: they suggest stock
  // positions, so they live in the Owner file only.
  const pub = JSON.stringify(rhymes);
  for (const k of ['pdPct', 'distance', 'debtToMcapPct', 'leveragePct', 'assetVolPct', 'capexToOcfPct', 'buildout', 'highest', 'flags']) assert(!pub.includes(`"${k}":`), `public file has no ${k} field`);
  assert(!/"symbol":"(MSFT|META|NVDA|AAPL)"/.test(pub), 'no per-stock rows for covered names in the public file');
}

// ---- missing inputs degrade, never throw ---------------------------------
{
  const empty = buildHistoryRhymes({ builtAtIso });
  assert.equal(empty.now.total, 6);
  assert(empty.now.market.signs.every((s) => s.status === 'unknown'), 'whole-market signs read unknown with no inputs');
  assert.equal(empty.now.market.stage.id, 'quiet');
  assert.equal(empty.now.known, 1, 'only the GPU rent sign has a reading with no inputs (the dated index rows)');
  assert(empty.now.signs.filter((s) => s.id !== 'price-falls').every((s) => s.status === 'unknown'), 'unknown, not clear, when data is missing');
  assert(empty.cases.length === 4, 'the history still renders');
  assert.equal(empty.asOf, null);
}

// ---- audit fixes (2026-11-12) ---------------------------------------------
{
  // Debt funding is read from leverage, not from having any debt at all.
  const light = { ...chains, CRWV: stock('CRWV', { marketCap: 400e9, totalDebt: 10e9, operatingCashFlow: 20e9, fiftyTwoWeekHigh: 100 }, { spot: 95 }), ORCL: stock('ORCL', { marketCap: 600e9, totalDebt: 30e9, operatingCashFlow: 22e9, fiftyTwoWeekHigh: 100 }, { spot: 95 }) };
  const flatBonds = { raises: { bonds: { latest: { m: '2026-04' }, months: Array.from({ length: 16 }, (_, i) => ({ m: `2025-${String(i + 1).padStart(2, '0')}`, ig: 120, hy: 25, cv: 8 })) } } };
  const st = (inputs) => Object.fromEntries(buildHistoryRhymes({ builtAtIso, series, fred, aiCapex, accelerators, ipoCredit, chains, ...inputs }).now.signs.map((s) => [s.id, s]));
  assert.equal(st({ chains: light, ipoCredit: flatBonds })['debt-funding'].status, 'clear', 'light borrowers do not light the sign');
  assert.equal(st({ chains: light })['debt-funding'].status, 'clear', 'market-wide bond sales no longer light the builders\' debt sign');
  const oneHeavy = { ...light, CRWV: chains.CRWV };
  assert.equal(st({ chains: oneHeavy, ipoCredit: flatBonds })['debt-funding'].status, 'partial', 'one heavy borrower is partial');
  assert.match(st({})['debt-funding'].now, /CRWV \$30B \(75% of market value, 10 years of operating cash flow\)/);
  // GPU rent: rising now is clear, a small move is partial, falling is lit.
  const gpu = (ch30, from, to) => ({ accelerators: { builtAtIso, benchmarks: [{ modelId: 'h100', currentMedian: to, change30dPct: ch30, compositeHistory: [{ d: '2026-07-31', p: from }, { d: '2026-11-06', p: to }] }] } });
  const up = st(gpu(23.2, 2.59, 3.19))['price-falls'];
  assert.equal(up.status, 'clear', 'H100 rent +23% (the live reading on 2026-11-06) is not a falling price');
  assert.match(up.now, /rising now/);
  assert.equal(st(gpu(-3, 2.6, 2.52))['price-falls'].status, 'partial');
  assert.equal(st(gpu(2, 3.0, 2.6))['price-falls'].status, 'lit', 'down 13% over three months');
  // Capex intensity names each period it compares.
  const part = (o, id) => o.spending.parts.find((p) => p.id === id);
  assert.match(part(st({}), 'capex-intensity').now, /27% of revenue for the group over the last twelve months and 19% the fiscal year before/);
  // The spending sign lights on two lit parts, and partly on one.
  const oneLit = st({ aiCapex: { totals: { revenue: { capexYoyPct: 10, yoyPct: 8, capexToRevenueTtmPct: 27, capexToRevenueFyPriorPct: 19, count: 7 } } }, chains: light });
  assert.equal(part(oneLit, 'capex-intensity').status, 'lit');
  assert.equal(oneLit.spending.status, 'partial', 'one lit part is partly showing');
  assert.equal(st({ aiCapex: null, chains: {} }).spending.status, 'unknown', 'no parts, no reading');
  const fallingSupplier = { SMH: stock('SMH', { fiftyTwoWeekHigh: 100 }, { spot: 70, etf: true }) };
  assert.equal(st({ aiCapex: null, chains: fallingSupplier })['leaders-crack'].status, 'unknown', 'a supplier drawdown cannot establish that spending is still rising without spending growth');
  assert.equal(st({ aiCapex: { totals: { revenue: { capexYoyPct: -10 } } }, chains: fallingSupplier })['leaders-crack'].status, 'clear', 'falling spending does not light the supplier-plus-growing-spending sign');
  // Drawdowns scale to each stock's swings (2026-11-17): a calm builder
  // lights on a 30% fall, a wild one needs more than 45%, and with no price
  // history the fixed 40% / 25% bars stand.
  const builders = (crwv, orcl) => ({ ...chains, CRWV: crwv, ORCL: orcl });
  const calm = stock('ORCL', { fiftyTwoWeekHigh: 100 }, { spot: 70, vol: 0.2 });
  const quiet = stock('CRWV', { fiftyTwoWeekHigh: 100 }, { spot: 99, vol: 0.5 });
  assert.equal(st({ chains: builders(quiet, calm) })['weak-link'].status, 'lit', 'a 30% fall in a stock that moves 20% a year lights the sign');
  const wild = stock('CRWV', { fiftyTwoWeekHigh: 100 }, { spot: 55, vol: 1.2 });
  const flatOrcl = stock('ORCL', { fiftyTwoWeekHigh: 100 }, { spot: 99, vol: 0.3 });
  assert.equal(st({ chains: builders(wild, flatOrcl) })['weak-link'].status, 'clear', 'a 45% fall in a stock that moves 120% a year does not');
  const noHistory = { ...stock('CRWV', { fiftyTwoWeekHigh: 100 }, { spot: 58 }), _bars: [] };
  const nh = st({ chains: { CRWV: noHistory } })['weak-link'];
  assert.equal(nh.status, 'lit', 'no volatility history: the fixed 40% bar applies');
  assert.match(nh.now, /fixed bars apply \(40% lights the sign, 25% partly\)/);
  const calmSmh = { SMH: stock('SMH', { fiftyTwoWeekHigh: 100 }, { spot: 85, vol: 0.2, etf: true }) };
  assert.equal(st({ chains: calmSmh })['leaders-crack'].status, 'lit', 'SMH 15% off in a 20% year is a large fall in its own swings');
  const noCash = part(st({ chains: { CRWV: stock('CRWV', { operatingCashFlow: -5e9, capitalAllocation: { capexTtm: 10e9 } }) } }), 'capex-vs-cash');
  assert.equal(noCash.status, 'lit', 'known negative operating cash flow with positive capital spending is strain, not missing data');
  assert.match(noCash.now, /negative.*operating cash flow|operating cash flow.*negative/i);
  assert.doesNotMatch(noCash.now, /missing|NaN|Infinity/);
  // Timeline entries with a rounded date carry the label to show.
  const rr = rhymes.cases.find((c) => c.id === 'railroads');
  assert.equal(rr.timeline[0].when, 'Summer 1845');
  assert(rhymes.cases.every((c) => c.timeline.every((e) => e.when === null || typeof e.when === 'string')));
  assert(rhymes.cases.find((c) => c.id === 'telecom').timeline.filter((e) => /Global Crossing|Telecommunications Act/.test(e.text)).every((e) => e.source && e.source !== 'brookings'), 'Brookings does not date Global Crossing or the 1996 act');
  // How old the newest press CDS quote is.
  assert.equal(rhymes.credit.reportedNewest, '2026-10-15');
  assert.equal(rhymes.credit.reportedAgeDays, 28);
  assert.equal(rhymes.credit.reportedStale, false);
  const later = buildHistoryRhymes({ builtAtIso: '2027-01-20T21:00:00Z', series, fred });
  assert.equal(later.credit.reportedStale, true, 'quotes older than 60 days are flagged');
  // A carried copy says so in its summary.
  assert.equal(historyRhymesSummary({ ...rhymes, stale: true }).stale, true);
  assert.equal(historyRhymesSummary(rhymes).stale, false);
}

// ---- the Owner payload ----------------------------------------------------
const owner = buildHistoryRhymesOwner({ builtAtIso, rhymes, chains, r: 0.04, skip: (s) => s === 'JPM' });
{
  const all = [...owner.buildout, ...owner.others];
  const syms = all.map((x) => x.symbol).sort();
  assert(!syms.includes('SMH'), 'ETFs skipped');
  assert(!syms.includes('JPM'), 'financials skipped');
  assert.deepEqual(syms, ['AAPL', 'CRWV', 'META', 'MSFT', 'NVDA', 'ORCL']);
  const crwv = all.find((x) => x.symbol === 'CRWV');
  assert.equal(crwv.role, 'borrower');
  assert.equal(crwv.roleLabel, ROLES.borrower.label);
  assert(crwv.model.pdPct > 20, 'the levered builder reads a high model default chance');
  assert(crwv.flags.includes('Model five-year default chance 20% or more'));
  assert(crwv.flags.includes('Capital spending above operating cash flow'));
  assert(crwv.flags.includes('Negative free cash flow with debt'));
  assert(crwv.flags.includes('40% or more below its 52-week high'));
  assert.equal(crwv.cds[0].bp, 1000, 'reported CDS quote attached to the stock');
  assert(all.find((x) => x.symbol === 'ORCL').rating.rating === 'BBB-', 'credit rating carried');
  assert.equal(all.find((x) => x.symbol === 'AAPL').model, null, 'no debt, no model');
  assert(owner.buildout.every((x) => x.role) && owner.others.every((x) => !x.role), 'buildout names split from the rest');
  assert.deepEqual(owner.buildout.map((x) => x.role), [...owner.buildout.map((x) => x.role)].sort((a, b) => ['borrower', 'spender', 'supplier', 'power', 'user'].indexOf(a) - ['borrower', 'spender', 'supplier', 'power', 'user'].indexOf(b)), 'buildout sorted by role');
  assert(owner.highest.length <= 5 && owner.highest[0].symbol === 'CRWV', 'highest model default chance first');
  assert.equal(owner.check.symbol, 'CRWV');
  assert.equal(owner.check.reportedPdPct, 63);
  assert.equal(owner.check.reportedBp, 1000);
  assert.equal(owner.check.reportedApprox, 'above');
  assert.equal(owner.check.reportedDate, REPORTED_CDS.filter((q) => q.symbol === 'CRWV').map((q) => q.date).sort().at(-1), 'model check reads the newest CoreWeave quote');
  assert(/^https:/.test(owner.check.reportedSourceUrl), 'model check links its source');
  assert.equal(owner.stage.id, rhymes.now.stage.id);
  assert.equal(owner.marketStage.id, rhymes.now.market.stage.id);
  assert(owner.model.notes.some((n) => /not a market quote/.test(n)) && owner.model.notes.some((n) => /shadow input \(epd\)/.test(n)));
  assert.equal(roleOf('CRWV'), 'borrower');
  assert.equal(roleOf('ZZZZ'), null);
  assert.equal(stockCreditRead('SMH', chains.SMH), null);
}

// ---- summary for Historical Data, the Owner brief and shadow logging ------
const summary = historyRhymesSummary(rhymes);
{
  assert.equal(summary.score, rhymes.now.score);
  assert.equal(summary.total, 6);
  assert.equal(summary.mostLike.id, 'telecom');
  assert.equal(summary.market.stage.id, 'late');
  assert.equal(summary.market.score, rhymes.now.market.score);
  assert(summary.market.signs.some((s) => s.id === 'credit-strain' && s.status === 'lit'));
  assert(summary.signs.every((s) => s.status === 'lit' || s.status === 'partial'));
  assert(summary.credit && Number.isFinite(summary.credit.baa));
  assert.equal(historyRhymesSummary(null), null);
}

// ---- shadow logging: epd per name, bsl / baa in the market row -----------
{
  const defaultChance = Object.fromEntries([...owner.buildout, ...owner.others].filter((x) => x.model).map((x) => [x.symbol, x.model.pdPct]));
  const sh = buildShadowSignals(chains, { builtAtIso, defaultChance, buildout: summary });
  const at = (sym, k) => sh.rows[sym]?.[sh.keys.indexOf(k)];
  assert.equal(sh.v, 9);
  assert.equal(at('CRWV', 'epd'), Math.round(defaultChance.CRWV * 100) / 100, 'epd logged for a name with a model read');
  assert.equal(at('AAPL', 'epd') ?? null, null, 'no model read, no epd');
  assert.equal(sh.mkt?.bsl, summary.score, 'buildout score logged in the market row');
  assert.equal(sh.mkt?.bsm, summary.market.score, 'whole-market score logged in the market row');
  assert.equal(sh.mkt?.baa, summary.credit.baa, 'Baa spread logged in the market row');
}

// ---- Owner brief line ----------------------------------------------------
{
  assert(OWNER_BRIEF_SOURCES.some((s) => s.id === 'history-rhymes' && s.key === HISTORY_RHYMES_OWNER_KEY));
  const f = ownerBriefFixture();
  f.payloads[HISTORY_RHYMES_OWNER_KEY] = { ...owner, builtAtIso: f.builtAtIso, asOf: f.builtAtIso };
  const report = buildOwnerMarketBrief(f);
  const line = report.findings.find((x) => x.title.startsWith('Buildout warning signs'));
  assert(line, 'the Owner brief carries a buildout line');
  assert.match(line.detail, new RegExp(`^${rhymes.now.score} of 6 AI buildout signs`));
  assert.match(line.detail, /Whole market: Late boom/);
  assert.match(line.detail, /CRWV/);
  assert.match(line.detail, /not market CDS quotes/);
}

// ---- store policy, ownership and MCP -------------------------------------
assert.equal(HISTORY_RHYMES_KEY, 'history-rhymes.json');
assert.equal(isPremiumKey(HISTORY_RHYMES_KEY), false, 'the history and market-wide signs are public');
assert.equal(isPremiumKey(HISTORY_RHYMES_OWNER_KEY), true, 'the per-stock credit read is Owner-only');
assert.deepEqual(roleClaimForKey(HISTORY_RHYMES_OWNER_KEY), ['tr', 'tp']);
assert(OPTIONAL_BAKE_KEYS.includes(HISTORY_RHYMES_KEY) && OPTIONAL_BAKE_KEYS.includes(HISTORY_RHYMES_OWNER_KEY), 'both files are bake-owned and optional');
assert.equal(SOURCE_KEYS['history-rhymes'], HISTORY_RHYMES_KEY, 'the page reads the public file');
assert.equal(FEATURE_DATASETS['history-rhymes']?.owner, HISTORY_RHYMES_OWNER_KEY, 'MCP exposes the Owner file as a dataset');
{
  const ids = new Set(SHARED_FRED_IDS);
  for (const id of HISTORY_RHYMES_FRED) assert(ids.has(id), `${id} rides the shared long-history cache`);
}

// ---- browser wiring ------------------------------------------------------
{
  const client = await readFile(new URL('./render/history-rhymes-client.mjs', import.meta.url), 'utf8');
  assert.match(client, /vnJson\('history-rhymes-owner\.json', true\)/, 'the Owner file is fetched only with an Owner session');
  assert.match(client, /vnJson\('history-rhymes\.json'/);
  assert(!/`/.test(client.slice(client.indexOf('return `') + 8, client.lastIndexOf('`;'))), 'no nested template literals in the generated script');
  const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert(appJs.includes('function loadHistoryRhymes(') && appJs.includes('function loadHistoryRhymesRisk('), 'app.js was regenerated with the page');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="page-pane-history-rhymes"') && html.includes('id="risk-rhymes"'), 'index.html has the pane and the risk card');
}

console.log(`history-rhymes smoke: ok (AI buildout ${rhymes.now.score} of 6, ${rhymes.now.stage.label}; whole market ${rhymes.now.market.score} of 6, ${rhymes.now.market.stage.label}; CRWV model ${owner.highest[0].pdPct}%)`);

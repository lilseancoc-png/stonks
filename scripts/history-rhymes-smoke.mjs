// Offline checks for Booms & busts (lib/history-rhymes.mjs): the equity-implied
// credit model, the nine warning signs, the public / Owner split, the summary
// that Historical Data, the Owner brief and shadow logging read, and the wiring
// into the store policy, MCP and the browser page. No network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildHistoryRhymes, buildHistoryRhymesOwner, historyRhymesSummary, mertonCredit, realizedVol, stockCreditRead, stageFor, roleOf,
  CASES, SIGNS, SOURCES, ROLES, REPORTED_CDS, HISTORY_RHYMES_KEY, HISTORY_RHYMES_OWNER_KEY, HISTORY_RHYMES_FRED,
} from '../lib/history-rhymes.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { OPTIONAL_BAKE_KEYS } from '../lib/data-ownership.mjs';
import { SHARED_FRED_EXTRA } from '../lib/historical-sources.mjs';
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

// ---- stage labels -------------------------------------------------------
assert.equal(stageFor(0).id, 'early');
assert.equal(stageFor(3).id, 'boom');
assert.equal(stageFor(5.5).id, 'late');
assert.equal(stageFor(9).id, 'bust');

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
};
const aiCapex = { builtAtIso: '2026-11-11T21:00:00Z', totals: { revenue: { capexYoyPct: 60, yoyPct: 14, count: 7, capexToRevenueTtmPct: 27, capexToRevenueFyPriorPct: 19 } } };
const accelerators = { builtAtIso: '2026-11-06T16:30:00Z', benchmarks: [{ modelId: 'h100', currentMedian: 2.1, change30dPct: -6, compositeHistory: [{ d: '2026-06-01', p: 2.6 }, { d: '2026-11-06', p: 2.1 }] }] };
const ipoCredit = { raises: { bonds: { latest: { m: '2026-10' }, months: Array.from({ length: 16 }, (_, i) => ({ m: `2025-${String(i + 1).padStart(2, '0')}`, ig: i >= 13 ? 180 : 120, hy: 25, cv: 8 })) } } };
const bars = (n, vol) => Array.from({ length: n }, (_, i) => ({ c: 100 * Math.exp(vol / Math.sqrt(252) * (i % 2 ? 1 : -1)) }));
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
};
const builtAtIso = '2026-11-12T21:10:00Z';
const series = { '^IXIC': ixic, '^GSPC': gspc };
const rhymes = buildHistoryRhymes({ builtAtIso, series, fred, aiCapex, accelerators, ipoCredit, chains });

// ---- the public payload ---------------------------------------------------
{
  assert.equal(rhymes.version, 1);
  assert.equal(rhymes.stale, false);
  assert.equal(rhymes.now.total, 9);
  assert.equal(rhymes.now.signs.length, SIGNS.length);
  assert.deepEqual(rhymes.now.signs.map((s) => s.id), SIGNS.map((s) => s.id), 'signs keep their order');
  const status = Object.fromEntries(rhymes.now.signs.map((s) => [s.id, s.status]));
  assert.equal(status['capex-vs-revenue'], 'lit', 'capex +60% vs revenue +14%');
  assert.equal(status['capex-intensity'], 'lit', 'capex 27% of revenue and rising');
  assert.equal(status['price-falls'], 'lit', 'H100 rent -6% over 30 days');
  assert.equal(status['debt-funding'], 'lit', 'bond sales up 30%+ and two debt-funded builders');
  assert.equal(status['credit-strain'], 'lit', 'Baa +0.45 over three months');
  assert.equal(status['weak-link'], 'lit', 'CRWV 50% off its high');
  assert.equal(status['price-stretch'], 'lit', 'Nasdaq doubled in a year');
  assert.equal(status['leaders-crack'], 'partial', 'SMH 17.5% off its high');
  assert(rhymes.now.signs.every((s) => ['lit', 'partial', 'clear', 'unknown'].includes(s.status) && typeof s.now === 'string' && s.now && !/NaN|undefined|null/.test(s.now)), 'every sign has a clean sentence');
  const expectScore = rhymes.now.lit.length + rhymes.now.partial.length * 0.5;
  assert.equal(rhymes.now.score, expectScore, 'lit counts 1, partial 0.5');
  assert.equal(rhymes.now.stage.id, stageFor(expectScore).id);
  assert(rhymes.now.mostLike && rhymes.now.matches.length === 3, 'three historical cases are compared');
  assert.equal(rhymes.now.mostLike.id, 'telecom', 'eight of nine signs match telecom best');
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
  assert.equal(empty.now.total, 9);
  assert.equal(empty.now.known, 1, 'only the GPU rent sign has a reading with no inputs (the dated index rows)');
  assert(empty.now.signs.filter((s) => s.id !== 'price-falls').every((s) => s.status === 'unknown'), 'unknown, not clear, when data is missing');
  assert(empty.cases.length === 4, 'the history still renders');
  assert.equal(empty.asOf, null);
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
  assert.equal(owner.stage.id, rhymes.now.stage.id);
  assert(owner.model.notes.some((n) => /not a market quote/.test(n)) && owner.model.notes.some((n) => /shadow input \(epd\)/.test(n)));
  assert.equal(roleOf('CRWV'), 'borrower');
  assert.equal(roleOf('ZZZZ'), null);
  assert.equal(stockCreditRead('SMH', chains.SMH), null);
}

// ---- summary for Historical Data, the Owner brief and shadow logging ------
const summary = historyRhymesSummary(rhymes);
{
  assert.equal(summary.score, rhymes.now.score);
  assert.equal(summary.total, 9);
  assert.equal(summary.mostLike.id, 'telecom');
  assert(summary.signs.every((s) => s.status === 'lit' || s.status === 'partial'));
  assert(summary.credit && Number.isFinite(summary.credit.baa));
  assert.equal(historyRhymesSummary(null), null);
}

// ---- shadow logging: epd per name, bsl / baa in the market row -----------
{
  const defaultChance = Object.fromEntries([...owner.buildout, ...owner.others].filter((x) => x.model).map((x) => [x.symbol, x.model.pdPct]));
  const sh = buildShadowSignals(chains, { builtAtIso, defaultChance, buildout: summary });
  const at = (sym, k) => sh.rows[sym]?.[sh.keys.indexOf(k)];
  assert.equal(sh.v, 4);
  assert.equal(at('CRWV', 'epd'), Math.round(defaultChance.CRWV * 100) / 100, 'epd logged for a name with a model read');
  assert.equal(at('AAPL', 'epd') ?? null, null, 'no model read, no epd');
  assert.equal(sh.mkt?.bsl, summary.score, 'buildout score logged in the market row');
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
  assert.match(line.detail, new RegExp(`^${rhymes.now.score} of 9 signs`));
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
  const ids = new Set(SHARED_FRED_EXTRA.map((s) => s.id));
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

console.log(`history-rhymes smoke: ok (${rhymes.now.score} of 9 signs, ${rhymes.now.stage.label}; CRWV model ${owner.highest[0].pdPct}%)`);

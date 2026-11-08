#!/usr/bin/env node
// Browser check for the 2026-11-08 feature additions, in the committed site
// with synthetic data on the harness server (scripts/browser-harness.mjs):
//   F5  Market Analysis "What if" dials and presets (Owner)
//   G4  Market Analysis cycle clock (Owner)
//   F6  Who owns what cluster buying + the stock page's Cluster buying note
//   F7  the stock page's valuation band
//   F8  Earnings results by-sector scorecard
// Each page is opened at phone and desktop width; every load must throw no
// error, show no raw "undefined" / "NaN", and keep inside the viewport. No
// provider, account or production store is contacted. Run:
//   PLAYWRIGHT_MODULE=... node scripts/features-next-browser.mjs
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, settle, selfTest, ROOT } from './browser-harness.mjs';
import { buildValuationBands } from '../lib/valuation-band.mjs';
import { findInsiderClusters } from '../lib/insider-cluster.mjs';
import { buildScenarioEngine } from '../lib/scenario-engine.mjs';
import { buildCycleTrail } from '../lib/macro-context.mjs';

const build = await import('./build.mjs');
const { TICKERS, SECTORS, INDUSTRY_OF_TICKER, sectorGroupOf, buildEarningsTrackerPayload } = build;

const failures = [];
let checks = 0;
const ok = (name, cond, extra = '') => { checks++; if (!cond) failures.push(name + (extra ? ': ' + extra : '')); };

// ---- local data (an old snapshot is fine; synthetic keys below win) ----------
const localCache = new Map();
async function local(key) {
  if (!/^[A-Za-z0-9._/-]+\.json$/.test(key) || key.includes('..')) return null;
  if (!localCache.has(key)) localCache.set(key, readFile(resolve(ROOT, 'data', key), 'utf8').then((t) => JSON.parse(t)).catch(() => null));
  return localCache.get(key);
}
const names = ['AAPL', 'MSFT', 'NVDA'];
const chains = {};
for (const s of names) { const j = await local(s + '.json'); if (j) chains[s] = j; }
const haveChains = Object.keys(chains).length >= 2;

// ---- F7: valuation bands from the local chains + a synthetic history --------
const history = new Map();
if (chains.AAPL?.fundamentals) {
  const f = chains.AAPL.fundamentals;
  const pts = [];
  for (let i = 60; i >= 1; i--) {
    const d = new Date(Date.UTC(2026, 10, 7) - i * 86400000).toISOString().slice(0, 10);
    const k = 1 + Math.sin(i / 9) * 0.12;
    pts.push({ date: d, pe: f.trailingPE * k, fpe: f.forwardPE * k, ps: f.priceToSales * k, mcap: f.marketCap * k, debt: f.totalDebt, cash: f.totalCash, rev: f.revenue });
  }
  history.set('AAPL', pts);
}
const valuationBands = buildValuationBands({
  chains, symbols: TICKERS, industries: INDUSTRY_OF_TICKER, sectors: SECTORS, groupOf: sectorGroupOf,
  isEtf: (s) => SECTORS[s] === 'ETF', history, builtAtIso: '2026-11-07T21:10:00Z', asOf: '2026-11-07', minPeers: 2,
});

// ---- F6: Form 4 rows with one AAPL cluster -----------------------------------
const f4rows = [
  { symbol: 'AAPL', ownerName: 'Ann Chief', roles: ['officer'], officerTitle: 'CEO', transactionDate: '2026-10-20', direction: 'buy', openMarket: true, code: 'P', shares: 1000, price: 230, value: 230000, form: '4' },
  { symbol: 'AAPL', ownerName: 'Bob Finance', roles: ['officer'], officerTitle: 'CFO', transactionDate: '2026-10-28', direction: 'buy', openMarket: true, code: 'P', shares: 500, price: 231, value: 115500, form: '4' },
  { symbol: 'AAPL', ownerName: 'Cara Board', roles: ['director'], transactionDate: '2026-11-05', direction: 'buy', openMarket: true, code: 'P', shares: 200, price: 229, value: 45800, form: '4' },
  { symbol: 'MSFT', ownerName: 'Dan Director', roles: ['director'], transactionDate: '2026-11-03', direction: 'sell', openMarket: true, code: 'S', shares: 300, price: 410, value: 123000, form: '4' },
  { symbol: 'NVDA', ownerName: 'Eve Exec', roles: ['officer'], transactionDate: '2026-11-04', direction: 'other', openMarket: false, code: 'A', shares: 5000, price: null, value: null, form: '4' },
];
const f13 = await local('13f.json');
const f13Synthetic = f13 ? {
  ...f13,
  insiderTransactions: {
    asOf: '2026-11-07T12:00:00.000Z', lookbackDays: 45, filingsPerIssuerCap: 6, issuersChecked: 3, filingsParsed: 5,
    transactionCount: f4rows.length, openMarketCount: f4rows.filter((r) => r.openMarket).length,
    topPurchases: f4rows.filter((r) => r.direction === 'buy'), topSales: f4rows.filter((r) => r.direction === 'sell'),
    transactions: f4rows, clusterBuying: findInsiderClusters(f4rows, { asOf: '2026-11-07' }),
    sourceNote: 'Synthetic Form 4 rows for the browser check.',
  },
} : null;

// ---- F8: an earnings season with several sector groups ---------------------
const reporters = TICKERS.filter((s) => SECTORS[s] !== 'ETF').slice(0, 14);
const ledger = { tickers: {} };
reporters.forEach((sym, i) => {
  const beat = i % 3 !== 2;
  ledger.tickers[sym] = { events: [{
    date: '2026-10-' + String(20 + (i % 9)).padStart(2, '0'), session: i % 2 ? 'PM' : 'AM',
    epsActual: beat ? 1.1 : 0.9, epsEstimate: 1, surprisePct: beat ? 10 : -10,
    movePct: (beat ? 0.04 : -0.06) * (1 + (i % 4) / 10), gapPct: (beat ? 0.03 : -0.05), week1Pct: beat ? 0.02 : -0.03,
    impliedMovePct: 0.05, guidance: i % 4 === 0 ? 'raised' : i % 4 === 1 ? 'inline' : i % 4 === 2 ? 'lowered' : null, guidanceSrc: i % 2 ? 'call' : 'news',
    pre10Pct: 0.01, pre15Pct: 0.02,
  }] };
});
const trackerChains = Object.fromEntries(reporters.map((s) => [s, { fundamentals: { name: s + ' Inc', financialCurrency: 'USD' } }]));
const savedKey = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
const tracker = await buildEarningsTrackerPayload(ledger, trackerChains, '2026-11-07T21:10:00Z');
if (savedKey) process.env.GEMINI_API_KEY = savedKey;
const season = tracker.seasons?.[0];
ok('F8: the synthetic season carries a by-sector table', season && Array.isArray(season.bySector) && season.bySector.length >= 2, JSON.stringify(season?.bySector?.length));

// ---- F5 + G4: a market-analysis payload the page accepts ---------------------
const AXES = ['indexes', 'vix', 'dxy', 'yields', 'fed', 'commodity', 'geo', 'inflation', 'sentiment', 'globalTape', 'twoY', 'bondVol', 'breadth', 'putCall', 'credit', 'rotation'];
function priceSeries(start, n, amp) {
  const t = [], c = [];
  let v = start;
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(2026, 6, 1 + i)); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; v *= 1 + (Math.sin(i / 4) * amp) / 100; t.push(d.toISOString().slice(0, 10)); c.push(Math.round(v * 100) / 100); }
  return { t, c };
}
const scnChains = {
  SPY: { priceSeries: priceSeries(600, 90, 0.5), technicals: { volRegime: { rv30: 0.16 } }, fundamentals: { name: 'SPY' } },
  AAPL: { priceSeries: priceSeries(230, 90, 0.9), technicals: { volRegime: { rv30: 0.25 } }, fundamentals: { name: 'Apple', beta: 1.1 } },
  NVDA: { priceSeries: priceSeries(180, 90, 1.6), technicals: { volRegime: { rv30: 0.42 } }, fundamentals: { name: 'NVIDIA', beta: 1.8 } },
  WMT: { priceSeries: priceSeries(100, 90, 0.3), technicals: { volRegime: { rv30: 0.18 } }, fundamentals: { name: 'Walmart', beta: 0.4 } },
  XOM: { priceSeries: priceSeries(110, 90, 0.7), technicals: { volRegime: { rv30: 0.22 } }, fundamentals: { name: 'Exxon', beta: 0.8 } },
};
const scores = Object.fromEntries(AXES.map((k, i) => [k, [0, -1, 1][i % 3]]));
// A market tape in the shape the page validates (state, axes, inputs,
// thresholds), the same minimal fixture scripts/top-picks-market-smoke.mjs uses.
const nowIso = new Date().toISOString();
const regime = { state: 'neutral', rawState: 'neutral', persisted: false, stress: 0, dataQuality: { sufficient: true },
  axes: { indexes: { score: 0, available: true, label: 'Indexes flat' }, vix: { score: 0, available: true, label: 'VIX calm' } },
  inputs: { indexes: { asOf: nowIso, spy: { pctChange1d: 0 }, qqq: { pctChange1d: 0 } }, vix: { asOf: nowIso, value: 18 } },
  thresholds: { axisWeights: { indexes: 1.5, vix: 1.25 } }, drivers: [], summary: 'Synthetic neutral tape for the browser check', grossMult: 1 };
const scenarioEngine = buildScenarioEngine({
  builtAtIso: '2026-11-07T21:10:00Z', asOfDate: '2026-11-07', chains: scnChains,
  macroBackdrop: { vixTerm: { state: 'contango', ratio: 0.92 }, credit: { oasChg5d: -0.05 } },
  macroRegime: { state: 'neutral', stress: -1, axes: Object.fromEntries(AXES.map((k) => [k, { score: scores[k], label: k }])) },
  regimeHistory: { days: Array.from({ length: 6 }, (_, i) => ({ date: '2026-10-' + String(26 + i).padStart(2, '0'), state: 'neutral', stress: -i / 3, axisScores: scores })) },
  macroHistory: { entries: Array.from({ length: 30 }, (_, i) => ({ date: '2026-10-' + String(i + 1).padStart(2, '0'), twoY: 3.6 - i * 0.004, tenY: 4.1 + i * 0.003, dxy: 99 + i * 0.02, vix: 17 + i * 0.05 })) },
  calendar: { events: [{ type: 'fomc', date: '2026-12-10', time: '14:00 ET', title: 'FOMC rate decision', source: 'Federal Reserve' }, { type: 'report', subtype: 'CPI YoY', date: '2026-11-12', title: 'CPI YoY', source: 'BLS' }] },
  sectors: { SPY: 'ETF', AAPL: 'Tech', NVDA: 'Semis', WMT: 'Retail', XOM: 'Energy' },
  kindOf: (s) => ({ SPY: 'broad', AAPL: 'megaCapTech', NVDA: 'semiconductors', WMT: 'consumerStaples', XOM: 'energy' }[s] || 'broad'),
  profiles: { broad: { axes: [{ key: 'indexes', w: 1 }] }, megaCapTech: { axes: [{ key: 'indexes', w: 0.8 }, { key: 'yields', w: 0.4 }] }, semiconductors: { axes: [{ key: 'indexes', w: 0.6 }, { key: 'yields', w: 0.3 }, { key: 'dxy', w: 0.7 }] }, consumerStaples: { axes: [{ key: 'yields', w: 0.3 }] }, energy: { axes: [{ key: 'commodity', w: 1 }] } },
  spilloverMatrix: { pairs: [] },
});
// Cycle clock from a synthetic macro history (same fixture as the smoke).
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const rand = rng(5);
const cal = [];
for (let d = Date.UTC(2024, 0, 2); cal.length < 420; d += 86400000) { const wd = new Date(d).getUTCDay(); if (wd !== 0 && wd !== 6) cal.push(new Date(d).toISOString().slice(0, 10)); }
const walk = (start, drift, vol) => { let x = start; return cal.map(() => (x *= 1 + drift + (rand() - 0.5) * vol)); };
const level = (start, drift, vol) => { let x = start; return cal.map(() => (x += drift + (rand() - 0.5) * vol)); };
const daily = (v) => ({ t: cal.slice(), v });
const monthly = (start, step) => { const t = [], v = []; let x = start; for (let m = 0; m < 36; m++) { t.push(`${2022 + Math.floor((m + 11) / 12)}-${String(((m + 11) % 12) + 1).padStart(2, '0')}-01`); v.push((x *= 1 + step)); } return { t, v }; };
const series = {
  SPY: daily(walk(470, 0.0005, 0.02)), HYG: daily(walk(76, 0.0001, 0.006)), IEF: daily(walk(95, 0, 0.006)), USO: daily(walk(72, 0.0008, 0.03)), 'DX-Y.NYB': daily(walk(102, 0.0002, 0.006)),
  '^VIX': daily(level(15, 0, 1.2).map((x) => Math.max(10, x))), DFF: daily(level(5.3, -0.002, 0.01)), DGS2: daily(level(4.4, -0.001, 0.06)), T10Y2Y: daily(level(-0.3, 0.002, 0.04)),
  T5YIE: daily(level(2.3, 0, 0.03)), CPIAUCSL: monthly(300, 0.0025), CPILFESL: monthly(305, 0.0024), UNRATE: monthly(3.8, 0.004),
};
const cycleClock = buildCycleTrail({ series, calendar: cal, months: 12 });
ok('G4: the synthetic cycle trail has a year of points', cycleClock && cycleClock.points.length >= 12);
const marketAnalysis = regime ? { builtAtIso: new Date(Date.now() - 3600e3).toISOString(), macroRegime: regime, scenarioEngine, cycleClock } : null;

const synthetic = new Map([
  ['valuation-bands.json', valuationBands],
  ['earnings-tracker.json', tracker],
  ...(f13Synthetic ? [['13f.json', f13Synthetic]] : []),
  ...(marketAnalysis ? [['market-analysis.json', marketAnalysis]] : []),
]);

let owner = false;
const server = await startSiteServer({ data: async (key) => (synthetic.has(key) ? synthetic.get(key) : local(key)), owner: () => owner });
const browser = await launchBrowser();
try {
  await selfTest(browser, server.base);
  for (const width of [390, 1440]) {
    // Owner: Market Analysis what-if dials + cycle clock.
    if (marketAnalysis) {
      owner = true;
      const s = await openTab(browser, server.base, { width, tab: 'market', theme: width === 390 ? 'dark' : 'light' });
      await settle(s.page, 1200);
      // The what-if dials and the cycle clock sit in folded sections. The
      // market tape also hides the scenario section while its live quote
      // check reports insufficient data, which it always does here because
      // the harness answers /api/macro-live with nothing; the dials are what
      // this check is about, so the sections are opened and shown by hand.
      await s.page.evaluate(() => { document.querySelectorAll('#page-pane-market details.market-secondary').forEach((d) => { d.open = true; if (d.querySelector('#market-scenario-engine, #market-cycle-clock')) d.hidden = false; }); });
      await s.page.waitForTimeout(150);
      const dials = await s.page.locator('input[data-scn-dial]').count();
      ok(`F5 ${width}: six dials render`, dials === 6, 'dials=' + dials);
      const before = await s.page.locator('#scenario-whatif-result .scenario-empty').count();
      ok(`F5 ${width}: all dials at zero show the empty prompt`, before === 1);
      const preset = s.page.locator('[data-scn-preset="hot-cpi"]').first();
      ok(`F5 ${width}: presets render`, (await preset.count()) === 1);
      if (await preset.count()) {
        await preset.click({ timeout: 5000 });
        await s.page.waitForTimeout(200);
        const lists = await s.page.locator('#scenario-whatif-result .scenario-whatif-lists button[data-scn-grade]').count();
        ok(`F5 ${width}: a preset lists gainers and losers`, lists >= 2, 'rows=' + lists);
        const tenY = await s.page.locator('input[data-scn-dial="tenYBps"]').inputValue();
        ok(`F5 ${width}: the preset moves the 10-year dial`, tenY === '10', 'tenY=' + tenY);
        await s.page.locator('.scenario-preset-reset').first().click();
        await s.page.waitForTimeout(150);
        ok(`F5 ${width}: reset returns the empty prompt`, (await s.page.locator('#scenario-whatif-result .scenario-empty').count()) === 1);
        await s.page.locator('input[data-scn-dial="spyPct"]').first().evaluate((el) => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await s.page.waitForTimeout(150);
        ok(`F5 ${width}: moving a dial updates its label and the lists`, /\+5/.test(await s.page.locator('[data-scn-dial-val="spyPct"]').innerText()) && (await s.page.locator('#scenario-whatif-result .scenario-whatif-lists button[data-scn-grade]').count()) >= 2);
      }
      const trail = await s.page.locator('#market-cycle-clock svg polyline.cc-trail').count();
      ok(`G4 ${width}: the cycle clock draws its trail`, trail === 1, 'trail=' + trail);
      const dots = await s.page.locator('#market-cycle-clock svg .cc-dot, #market-cycle-clock svg .cc-dot-now').count();
      ok(`G4 ${width}: one dot per month`, dots >= 12, 'dots=' + dots);
      ok(`G4 ${width}: the clock host is shown`, !(await s.page.locator('#market-cycle-clock').evaluate((el) => el.hidden)));
      const problems = await pageProblems(s);
      ok(`market ${width}: clean page`, problems.length === 0, problems.join(' | '));
      await s.context.close();
      owner = false;
    }
    // Public: Who owns what cluster buying.
    if (f13Synthetic) {
      const s = await openTab(browser, server.base, { width, tab: 'f13' });
      await settle(s.page, 1500);
      const clusters = await s.page.locator('.f4-clusters .f4-cluster').count();
      ok(`F6 ${width}: the AAPL cluster card shows on Who owns what`, clusters === 1, 'cards=' + clusters);
      const text = clusters ? await s.page.locator('.f4-clusters').innerText() : '';
      ok(`F6 ${width}: the card names three insiders`, /3 insiders/.test(text), text.slice(0, 120));
      const problems = await pageProblems(s);
      ok(`f13 ${width}: clean page`, problems.length === 0, problems.join(' | '));
      await s.context.close();
    }
    // Public: Earnings results by-sector scorecard.
    {
      const s = await openTab(browser, server.base, { width, tab: 'earnings' });
      await settle(s.page, 1500);
      const rows = await s.page.locator('.ers-sector-table tbody tr').count();
      ok(`F8 ${width}: the by-sector table has a row per group`, rows >= 2 && rows === (season?.bySector?.length || 0), 'rows=' + rows);
      const problems = await pageProblems(s);
      ok(`earnings ${width}: clean page`, problems.length === 0, problems.join(' | '));
      await s.context.close();
    }
    // Public: the stock page valuation band + Cluster buying on Ownership.
    if (haveChains && chains.AAPL) {
      const s = await openTab(browser, server.base, { width, tab: 'stock', extra: '&s=AAPL' });
      await settle(s.page, 2000);
      await s.page.waitForSelector('#stp-valuation:not([hidden])', { timeout: 8000 }).catch(() => {});
      const bands = await s.page.locator('#stp-valuation .stp-band').count();
      ok(`F7 ${width}: valuation bars render on the Overview`, bands >= 2, 'bars=' + bands);
      const own = await s.page.locator('#stp-valuation .stp-band-own').count();
      ok(`F7 ${width}: the own range shows for a name with history`, own >= 2, 'own=' + own);
      let problems = await pageProblems(s);
      ok(`stock overview ${width}: clean page`, problems.length === 0, problems.join(' | '));
      if (f13Synthetic) {
        await s.page.locator('[data-stock-tab="ownership"]').first().click();
        await s.page.waitForSelector('.stp-cluster', { timeout: 8000 }).catch(() => {});
        const cluster = await s.page.locator('.stp-cluster').count();
        ok(`F6 ${width}: the stock page Ownership tab shows Cluster buying`, cluster === 1, 'sections=' + cluster);
        problems = await pageProblems(s);
        ok(`stock ownership ${width}: clean page`, problems.length === 0, problems.join(' | '));
      }
      await s.context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (!f13Synthetic) console.log('note: data/13f.json is missing, so the Who owns what checks were skipped');
if (!haveChains) console.log('note: data/AAPL.json is missing, so the stock page checks were skipped');
if (failures.length) { console.log('features-next-browser: FAIL\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`features-next-browser: ok (${checks} checks)`);

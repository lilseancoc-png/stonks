// Browser check for the Industry trends audit (2026-11-17): AI spending, GPU
// cloud prices, Memory chip prices and Search trends render at 1440 light and
// 390 dark with no page errors, raw values or sideways scroll; a weekly page
// four days after its Friday scan still reads as current; the AI spending
// page leaves a stale full year out of the totals and charts only the years
// every company has reported; carried related queries never badge a card when
// related lookups are off. Synthetic data only.
// Run: node scripts/regen-static.mjs && node scripts/industry-trends-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { buildAcceleratorPricesPayload } from '../lib/accelerator-prices.mjs';
import { buildRamPricesPayload } from './build.mjs';

const output = process.env.INDUSTRY_TRENDS_BROWSER_OUT || resolve(tmpdir(), 'stonks-industry-trends-browser');
await mkdir(output, { recursive: true });

const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const dateOf = (ms) => iso(ms).slice(0, 10);
const scanMs = now - 4 * DAY; // a Friday scan read on Tuesday

// GPU: six weekly scans, every lane up 1% a week.
let gpu = null;
for (let w = 5; w >= 0; w--) {
  const up = 1 + (5 - w) * 0.01;
  const lane = (providerId, market, price) => ({
    key: providerId + '|h100|' + market, providerId, provider: providerId, providerUrl: 'https://example.com', sourceUrl: 'https://example.com',
    modelId: 'h100', model: 'NVIDIA H100', rawModel: 'H100', market, price: price * up, low: price * up, high: price * up,
    offerCount: null, gpuCount: 1, instancePrice: price * up, vramGb: 80, note: '',
  });
  gpu = buildAcceleratorPricesPayload({
    builtAtIso: iso(scanMs - w * 7 * DAY),
    prior: gpu,
    sources: [
      { id: 'vast', name: 'Vast.ai', ok: true, quotes: [lane('vast', 'spot', 1.5)] },
      { id: 'coreweave', name: 'CoreWeave', ok: true, quotes: [lane('coreweave', 'on-demand', 6)] },
      { id: 'runpod', name: 'Runpod', ok: true, quotes: [lane('runpod-secure', 'on-demand', 2.7)] },
      { id: 'lambda', name: 'Lambda', ok: true, quotes: [lane('lambda', 'on-demand', 3)] },
    ],
  });
}

// Memory: one spot scan and a retail block with a category that enters late.
const retailDates = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => dateOf(scanMs - (7 - i) * 14 * DAY));
const ram = buildRamPricesPayload({
  builtAtIso: iso(scanMs),
  spot: { updatedAt: dateOf(scanMs) + ' 10:00', items: [
    { name: 'DDR5 16Gb', sessionAvg: 30, sessionHigh: 31, sessionLow: 29, dailyChangePct: 1 },
    { name: 'DDR4 8Gb', sessionAvg: 5, sessionHigh: 5.2, sessionLow: 4.9, dailyChangePct: -1 },
  ] },
  retail: { sourceName: 'WhereIsMyRam (US retail)', sourceUrl: 'https://example.com', market: { inStock: 900, weekPct: 1, monthPct: 4 }, categories: [
    { label: 'DDR5 · 2×16 GB', minPrice: 120, avgPrice: 140, stocks: 300, weekPct: 1, monthPct: 4, history: retailDates.map((d, i) => ({ d, min: 100 + i * 3, avg: 120 + i * 3 })) },
    { label: 'DDR5 · 2×32 GB', minPrice: 230, avgPrice: 260, stocks: 200, weekPct: 1, monthPct: 4, history: retailDates.map((d, i) => ({ d, min: 200 + i * 4, avg: 230 + i * 4 })) },
    { label: 'DDR4 · 2×16 GB', minPrice: 60, avgPrice: 70, stocks: 150, weekPct: 0, monthPct: 2, history: retailDates.map((d, i) => ({ d, min: 50 + i, avg: 60 + i })) },
    { label: 'DDR5 · 2×48 GB', minPrice: 420, avgPrice: 480, stocks: 40, weekPct: 2, monthPct: 6, history: retailDates.slice(5).map((d, i) => ({ d, min: 400 + i * 5, avg: 460 + i * 5 })) },
  ] },
  prior: null,
});

// AI spending: MSFT (June year), GOOGL (calendar), TSM stale at FY2024.
const co = (ticker, labels, vals, ttm, extra = {}) => ({
  ticker, name: ticker, source: 'sec',
  fyLatest: { label: labels[labels.length - 1], end: '', val: vals[vals.length - 1] },
  fyPrior: { label: labels[labels.length - 2], end: '', val: vals[vals.length - 2] },
  yoyPct: Math.round((vals[vals.length - 1] / vals[vals.length - 2] - 1) * 1000) / 10,
  ttm: { val: ttm, asOf: '2026-09-30', basis: 'ttm' },
  rev: null, revenue: null, capexToRevenuePct: null, guidance: null,
  history: labels.map((label, i) => ({ label, end: '', val: vals[i] })),
  ...extra,
});
const capex = {
  builtAtIso: iso(now - 2 * 3600000),
  companies: [
    co('MSFT', ['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026'], [24e9, 28e9, 44e9, 64e9, 116e9], 136e9),
    co('GOOGL', ['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025'], [25e9, 31e9, 32e9, 53e9, 91e9], 160e9),
    co('TSM', ['FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024'], [17e9, 30e9, 36e9, 31e9, 29e9], 53e9, { fyStale: true }),
  ],
  totals: {
    fyLatestSum: 207e9, fyPriorSum: 117e9, fyLatestLabel: 'FY2025', fyMixed: true, fyRangeLabel: 'FY2025–2026',
    fyByLabel: { FY2025: ['GOOGL'], FY2026: ['MSFT'] }, fyStale: [{ ticker: 'TSM', label: 'FY2024' }], fyCount: 2,
    runRateVsFyPct: 43.5, ttmAsOfRange: ['2026-09-30', '2026-09-30'], yoyPct: 76.9, deltaAbs: 90e9, yoyCohort: 2, ttmSum: 349e9, ttmCount: 3, count: 3,
    revenue: null, guidance: null,
  },
  missing: [], stale: false,
};

// Search: related lookups off, one row still carrying an old breakout.
const hist = Array.from({ length: 60 }, (_, i) => ({ date: dateOf(scanMs - (59 - i) * DAY), value: 30 + (i % 7) }));
const search = {
  builtAtIso: iso(scanMs),
  source: { name: 'Google Trends', provider: 'SerpApi', cadence: 'weekly', geo: 'US', periodDays: 90, anchor: 'stock market' },
  status: { state: 'ok', freshInterest: 2, freshRelated: 0, relatedEnabled: false, requestsUsed: 12, requestLimit: 40, errors: [] },
  rows: [
    { id: 'ai-chips', label: 'AI chips', query: 'AI chips', sector: 'Compute', type: 'theme', interest: 33, relativeInterest: 40, change7d: 12, change30d: 20, history: hist, topQueries: [], risingQueries: [{ query: 'old news', value: 'Breakout', score: 5000, breakout: true }], stale: false, asOf: dateOf(scanMs) },
    { id: 'gold', label: 'Gold', query: 'gold price', sector: 'Markets', type: 'theme', interest: 60, relativeInterest: 90, change7d: 20, change30d: 5, history: hist, topQueries: [], risingQueries: [], stale: false, asOf: dateOf(scanMs) },
  ],
};

const files = { 'ai-capex.json': capex, 'accelerator-prices.json': gpu, 'ram-prices.json': ram, 'search-interest.json': search };
const server = await startSiteServer({ owner: () => false, data: (key) => files[key] || null });
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };

try {
  await selfTest(browser, server.base);
  for (const view of [{ width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 844, theme: 'dark' }]) {
    const tag = view.width + '-' + view.theme;
    // AI spending
    {
      const s = await openTab(browser, server.base, { tab: 'ai-capex', ...view });
      await s.page.locator('#ai-capex-root .cx-desk').waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      const html = await s.page.locator('#ai-capex-root').innerHTML();
      check(/years every company has reported/.test(html), tag + ' capex: chart label names complete years');
      await s.page.locator('#ai-capex-root details.cx-research > summary').click();
      await settle(s.page, 300);
      const text = await s.page.locator('#ai-capex-root').innerText();
      check(/Left out of the fiscal-year total and growth: TSM \(newest full year on file is FY2024\)/.test(text), tag + ' capex: stale year note');
      check(/FY2024 \(newest full year on file\)/.test(text), tag + ' capex: TSM row marked');
      check(/latest fiscal years up 76\.9%/.test(text), tag + ' capex: strip note names the fiscal-year growth');
      check(/\+43\.5% vs latest FY/.test(text) && !/68\.6%/.test(text), tag + ' capex: run-rate compares the same companies');
      // Chart: complete years only (2022 to 2025 for MSFT + GOOGL, TSM out).
      const pts = await s.page.evaluate(() => {
        const el = document.querySelector('#ai-capex-root [data-ch]');
        try { return JSON.parse(el.getAttribute('data-ch')).map((p) => String(p[2]).slice(0, 4)); } catch { return null; }
      });
      check(Array.isArray(pts) && pts.join(',') === '2022,2023,2024,2025', tag + ' capex: chart years ' + JSON.stringify(pts));
      const problems = await pageProblems(s);
      check(problems.length === 0, tag + ' capex: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'ai-capex-' + tag + '.png'), fullPage: true });
      await s.context.close();
    }
    // GPU cloud prices
    {
      const s = await openTab(browser, server.base, { tab: 'accelerator-prices', ...view });
      await s.page.locator('#accelerator-prices-root .ap-desk').waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      const text = await s.page.locator('#accelerator-prices-root').innerText();
      check(!/needs a fresh build/.test(text), tag + ' gpu: four-day-old weekly scan is not stale');
      check(/Live list-price read/i.test(text), tag + ' gpu: current badge');
      check(/\+5\.0%/.test(text), tag + ' gpu: 30-day change from matched lanes');
      check(/weekly snapshot/.test(text) && !/daily snapshot/.test(text), tag + ' gpu: weekly wording');
      const eye = await s.page.locator('#accelerator-prices-eyebrow').innerText();
      check(/Current public pricing/.test(eye), tag + ' gpu eyebrow: ' + eye);
      const problems = await pageProblems(s);
      check(problems.length === 0, tag + ' gpu: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'gpu-' + tag + '.png'), fullPage: true });
      await s.context.close();
    }
    // Memory chip prices
    {
      const s = await openTab(browser, server.base, { tab: 'ram-prices', ...view });
      await s.page.locator('#ram-prices-root section, #ram-prices-root .rp-desk').first().waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      const text = await s.page.locator('#ram-prices-root').innerText();
      check(!/Reference only/.test(text), tag + ' ram: four-day-old weekly scan is not reference-only');
      const problems = await pageProblems(s);
      check(problems.length === 0, tag + ' ram: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'ram-' + tag + '.png'), fullPage: true });
      await s.context.close();
    }
    // Search trends
    {
      const s = await openTab(browser, server.base, { tab: 'search-interest', ...view });
      await s.page.locator('#search-interest-root .si-desk').waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      check((await s.page.locator('#search-interest-root .si-breakout').count()) === 0, tag + ' search: no badge from carried related queries');
      const first = await s.page.locator('#search-interest-root .si-card .si-symbol').first().innerText();
      check(first === 'Gold', tag + ' search: cards sorted by 7-day move, not by an old breakout (' + first + ')');
      const problems = await pageProblems(s);
      check(problems.length === 0, tag + ' search: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'search-' + tag + '.png'), fullPage: true });
      await s.context.close();
    }
  }
  console.log('Industry trends browser check passed: ' + checks + ' checks; screenshots in ' + output);
} finally {
  await browser.close();
  await server.close();
}

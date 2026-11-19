// Browser check for the stock page on a wide-tier name (wave-1 integration,
// 2026-11-19): a stock that is not one of the 80 tracked names (an S&P 500 /
// Nasdaq-100 member, or a name that left coverage, such as DIS) has no
// per-ticker file, so the page shows its public wide-tier.json row (closes,
// ranges, next report) instead of "could not load", links to the Heatmap's
// Wide view, and still says "could not load" for a name on neither list.
// Synthetic data only.
// Run: node scripts/stock-wide-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';

const output = process.env.STOCK_WIDE_BROWSER_OUT || resolve(tmpdir(), 'stonks-stock-wide-browser');
await mkdir(output, { recursive: true });
const nowIso = new Date().toISOString();
const wide = {
  version: 1, enabled: true, builtAtIso: nowIso, refreshedAtIso: nowIso, asOf: '2026-11-18',
  members: { asOf: '2026-11-01', sources: [], count: 3, sp500: 3, ndx: 1, extras: [] },
  perfStart: {}, counts: { names: 2, tracked: 1, missing: 0 }, missing: [],
  tickers: [
    { t: 'AAPL', n: 'Apple Inc.', s: 'Information Technology', i: 'Hardware', x: 'SN', mc: 3.9e12, sp: 230, pc: 230, ch: 0.5, perf: { '1w': 1 }, ma50: 225, ma200: 210, hi52: 240, lo52: 170, av50: 5e7, rv: 0.2, er: null, d: '2026-11-18', tr: 1, g: 'Tech' },
    { t: 'DIS', n: 'Walt Disney Co.', s: 'Communication Services', i: 'Movies & Entertainment', x: 'S', mc: 2.05e11, sp: 112.4, pc: 112.4, ch: -1.25, perf: { '1w': 2.1, '1m': -3.4, '3m': 5.6, '1y': 12.3, ytd: 8.8 }, ma50: 108, ma200: 104, hi52: 124, lo52: 85, av50: 9e6, rv: 0.22, er: '2026-12-04', erEst: 1, d: '2026-11-18' },
    { t: 'XLC', n: 'Communication Services Select Sector SPDR', s: 'Sector funds', i: 'XLC', x: '', mc: null, sp: 100, pc: 100, ch: 0.1, perf: {}, d: '2026-11-18', fund: 1 },
  ],
  sectorTable: [], worth: [], today: null, breadth: null, notes: {},
};
const server = await startSiteServer({
  owner: () => false,
  data: (key) => (key === 'wide-tier.json' ? wide : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const missingOk = (p) => p.filter((x) => !/DIS\.json|ZZZQ\.json|XLC\.json|404/.test(x));

try {
  await selfTest(browser, server.base);

  // Desktop light: DIS opens as a wide card.
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'stock', extra: '&s=DIS' });
    await s.page.locator('[data-stp-wide]').waitFor({ timeout: 15000 });
    await settle(s.page, 400);
    const t = await s.page.locator('#stock-root').innerText();
    check(/Walt Disney/.test(t) && /\$112\.40/.test(t), 'DIS card shows its name and last close: ' + t.slice(0, 200));
    check(/wide list \(S&P 500\)/.test(t) && /no grade, option chain or AI read/.test(t), 'DIS card says it is wide-only');
    check(/\$85\.00 to \$124\.00/.test(t) && /70% of the way up/.test(t), 'DIS 52-week range and place in it');
    check(/Dec 4, 2026/.test(t) && /estimated/.test(t), 'DIS next report, marked estimated');
    check(/\+4\.1%/.test(t) && /\+8\.1%/.test(t), 'DIS vs 50-day and 200-day averages');
    check(/1m/.test(t) && /−3\.4%/.test(t) && /YTD/.test(t) && /\+8\.8%/.test(t), 'DIS return chips');
    check(!/could not load/.test(t), 'DIS does not read "could not load"');
    check(server.asks.data.some((k) => /wide-tier\.json/.test(k)), 'wide-tier.json was read on the miss');
    const p = missingOk(await pageProblems(s));
    check(p.length === 0, 'DIS desktop: ' + p.join(' | '));
    await s.page.locator('#stock-root').screenshot({ path: resolve(output, 'dis-1440-light.png') });
    // The map link opens the Heatmap on its Wide view.
    await s.page.locator('[data-stp-wide-map]').click();
    await s.page.waitForFunction(() => { const p = document.getElementById('page-pane-heatmap'); return p && !p.hidden; }, null, { timeout: 15000 });
    await settle(s.page, 600);
    const pressed = await s.page.locator('#heatmap-section [data-heatmap-source="wide"]').getAttribute('aria-pressed');
    check(pressed === 'true', 'the map link switches the Heatmap to Wide');
    await s.context.close();
  }

  // Phone dark: the card fits with no sideways scroll.
  {
    const s = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'stock', extra: '&s=DIS' });
    await s.page.locator('[data-stp-wide]').waitFor({ timeout: 15000 });
    await settle(s.page, 400);
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 1, 'phone: no sideways scroll (' + over + 'px)');
    await s.page.locator('#stock-root').screenshot({ path: resolve(output, 'dis-390-dark.png') });
    await s.context.close();
  }

  // A sector fund row and a name on neither list keep "could not load".
  for (const sym of ['XLC', 'ZZZQ']) {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'stock', extra: '&s=' + sym });
    await s.page.locator('.stp-missing').waitFor({ timeout: 15000 });
    await settle(s.page, 800);
    check(await s.page.locator('[data-stp-wide]').count() === 0, sym + ': no wide card');
    check(/could not load/.test(await s.page.locator('#stock-root').innerText()), sym + ': reads "could not load"');
    await s.context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`stock-wide-browser: ${checks} checks pass. Screenshots: ${output}`);

#!/usr/bin/env node
// Outage drill (2026-11-08): the site with its data store and every live API
// down. Each key page is opened with /data/* and /api/* answering 503 (and
// once fully offline), as a public visitor and with the Owner probe failing,
// at desktop and phone width. A page passes when it throws no error, shows no
// raw "undefined" / "NaN" / "[object Object]", does not scroll sideways and
// still shows text (an empty state or the shell), so an outage degrades to a
// readable page instead of a blank or broken one. Synthetic server only; no
// provider, account or production store is contacted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, settle, selfTest } from './browser-harness.mjs';

const NOW = '2026-11-09T15:00:00Z';
const output = process.env.OUTAGE_DRILL_OUT || resolve(tmpdir(), 'stonks-outage-drill');
await mkdir(output, { recursive: true });
const PAGES = (process.env.OUTAGE_PAGES || 'home,tickers,stock,market-map,heatmap,calendar,news,brief,flow,oi,earnings-week,earnings,commodities,bonds-usd,fear-greed,streaks,past-day,whats-changed,overnight,iv-trend,strategies,learn,glossary').split(',');

const server = await startSiteServer({ failData: true, failApi: true });
const browser = await launchBrowser();
let checks = 0, shots = 0, retryChecks = 0;
const failures = [];
try {
  await selfTest(browser, server.base);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    for (const tab of PAGES) {
      const s = await openTab(browser, server.base, { width, theme, tab, now: NOW });
      await settle(s.page, 900);
      const problems = await pageProblems(s);
      const name = 'outage-' + tab + '-' + width;
      await s.page.screenshot({ path: resolve(output, name + '.png'), fullPage: false }); shots++;
      checks++;
      if (problems.length) failures.push({ name, problems });
      // Every Retry / Refresh button must show it ran, even when the data is
      // still unavailable and the page redraws the same (initRefreshFeedback).
      if (width === 1440) {
        const retry = s.page.locator('.page-pane:not([hidden]) button').filter({ hasText: /^\s*(Retry|Try again|Refresh|Reload)/ });
        const n = await retry.count();
        for (let i = 0; i < n; i++) {
          const b = retry.nth(i);
          if (!(await b.isVisible()) || await b.isDisabled()) continue;
          const before = await s.page.locator('.page-pane:not([hidden])').innerText();
          await b.click(); await s.page.waitForTimeout(1500);
          const after = await s.page.locator('.page-pane:not([hidden])').innerText();
          retryChecks++;
          if (after === before) failures.push({ name, problems: ['"' + (await b.innerText().catch(() => '?')).trim() + '" showed no sign that it ran'] });
          break;
        }
      }
      await s.context.close();
    }
  }
  // Fully offline (no network at all) on the home page and one data page.
  for (const tab of ['home', 'tickers']) {
    const s = await openTab(browser, server.base, { width: 1440, theme: 'light', tab, now: NOW });
    await settle(s.page, 300);
    await s.context.setOffline(true);
    await s.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await s.page.waitForTimeout(600);
    const problems = await pageProblems(s);
    checks++;
    const name = 'offline-' + tab;
    await s.page.screenshot({ path: resolve(output, name + '.png'), fullPage: false }); shots++;
    if (problems.length) failures.push({ name, problems });
    await s.context.close();
  }
  assert.ok(server.asks.data.length > 0 && server.asks.api.length > 0, 'the pages asked for data and live APIs, which all failed');
} finally {
  await browser.close();
  await server.close();
}
for (const f of failures) console.error('✗ ' + f.name + '\n    ' + f.problems.join('\n    '));
if (failures.length) { console.error(`outage-drill-browser: ${failures.length} of ${checks} page loads failed (screenshots in ${output})`); process.exit(1); }
console.log(`outage-drill-browser: ${checks} page loads survived a full data and API outage; ${retryChecks} Retry / Refresh clicks showed feedback (${shots} screenshots in ${output})`);

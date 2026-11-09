// Browser check for the Owner Lab "Regime Lab" tab (2026-11-09): the tab
// renders the lab file at 1440 light and 390 dark with no page errors, raw
// values or sideways scroll; a missing file degrades to one hint line; a
// public visitor never sees the tab and never asks for regime-lab.json.
// Synthetic data only (the smoke fixture); nothing here contacts a provider,
// an account or the production store.
// Run: node scripts/regen-static.mjs && node scripts/regime-lab-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { regimeLabFixture } from './regime-lab-smoke.mjs';
import { REGIME_LAB_KEY } from '../lib/regime-lab/payload.mjs';

const output = process.env.REGIME_LAB_BROWSER_OUT || resolve(tmpdir(), 'stonks-regime-lab-browser');
await mkdir(output, { recursive: true });
const fixture = regimeLabFixture();
assert.ok(fixture.payload.today?.cell, 'fixture has a label for today');

let owner = true, haveFile = true;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === REGIME_LAB_KEY ? (haveFile ? fixture.payload : null) : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };

async function openLab(opts) {
  const s = await openTab(browser, server.base, { tab: 'quant', ...opts });
  await s.page.locator('#owner-tab-regime').waitFor({ state: 'visible', timeout: 15000 });
  await s.page.locator('#owner-tab-regime').click();
  return s;
}

try {
  await selfTest(browser, server.base);

  // Owner, desktop, light.
  {
    const s = await openLab({ width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#regime-lab-root .rgl-section').first().waitFor({ timeout: 15000 });
    await settle(s.page, 800);
    const text = await s.page.locator('#owner-panel-regime').innerText();
    check(/Which market are we in/.test(text), 'the tab intro is shown');
    check((await s.page.locator('#regime-lab-root .rgl-section').count()) >= 8, 'every lab section rendered');
    check((await s.page.locator('#regime-lab-root .rgl-cell').count()) === 6, 'six market cells on the grid');
    check((await s.page.locator('#regime-lab-root .rgl-cell.is-now').count()) === 1, 'one cell marked as now');
    check((await s.page.locator('#rgl-catalog tbody tr').count()) === 22, 'the test catalog lists F1-F22');
    check(/never written into the Track Record|never-record|ceiling/i.test(text), 'the oracle section says it is a ceiling, never a record');
    check(/Guards|G1/.test(text), 'the guards section rendered');
    check(/Written by the/.test(await s.page.locator('#owner-regime-status').innerText()), 'the status line names the build');
    const problems = await pageProblems(s);
    check(problems.length === 0, 'desktop light: ' + problems.join(' | '));
    // The nav links jump within the pane without reloading.
    await s.page.locator('.rgl-nav a[href="#rgl-oracle"]').click();
    await settle(s.page, 200);
    check(/tab=quant/.test(s.page.url()), 'nav link keeps the Owner Lab open');
    check(s.errors.length === 0, 'no page errors after navigating sections');
    await s.page.screenshot({ path: resolve(output, 'owner-1440-light.png'), fullPage: true });
    await s.context.close();
  }

  // Owner, phone, dark.
  {
    const s = await openLab({ width: 390, height: 844, theme: 'dark' });
    await s.page.locator('#regime-lab-root .rgl-section').first().waitFor({ timeout: 15000 });
    await settle(s.page, 800);
    const problems = await pageProblems(s);
    check(problems.length === 0, 'phone dark: ' + problems.join(' | '));
    check((await s.page.locator('#rgl-catalog tbody tr').count()) === 22, 'phone: catalog rows present');
    await s.page.screenshot({ path: resolve(output, 'owner-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // Owner, the file is not written yet.
  {
    haveFile = false;
    const s = await openLab({ width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /not available yet/.test(document.querySelector('#owner-regime-status')?.textContent || ''), null, { timeout: 15000 });
    const text = await s.page.locator('#regime-lab-root').innerText();
    check(/could not be loaded|not written yet/.test(text), 'a missing file shows one hint, not a broken page');
    check(s.errors.length === 0, 'no page errors on a missing file');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
    // The Refresh button re-reads the file.
    const r = await openLab({ width: 1200, height: 900, theme: 'light' });
    await r.page.locator('#regime-lab-root .rgl-section').first().waitFor({ timeout: 15000 });
    const before = server.asks.data.filter((k) => k === REGIME_LAB_KEY).length;
    await r.page.locator('[data-owner-regime-refresh]').click();
    await r.page.waitForFunction((n) => true, null, { timeout: 1000 }).catch(() => {});
    await settle(r.page, 600);
    check(server.asks.data.filter((k) => k === REGIME_LAB_KEY).length > before, 'Refresh lab re-reads regime-lab.json');
    await r.context.close();
  }

  // Public visitor: no tab, no request.
  {
    owner = false;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'quant', width: 1440, height: 1000 });
    await settle(s.page, 1500);
    check(!(await s.page.locator('#owner-tab-regime').isVisible().catch(() => false)), 'public: the Regime Lab tab is not visible');
    check(!server.asks.data.includes(REGIME_LAB_KEY), 'public: regime-lab.json was never requested');
    check((await s.page.evaluate(() => new URLSearchParams(location.search).get('tab'))) !== 'quant', 'public: the Owner Lab tab is not reachable');
    check(s.errors.length === 0, 'public: no page errors');
    await s.context.close();
    owner = true;
  }
  console.log(`regime-lab browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

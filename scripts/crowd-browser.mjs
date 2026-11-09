// Browser check for the Crowd & positioning page (2026-11-09): the public page
// renders every tab at 1440 light and 390 dark with no page errors, raw values
// or sideways scroll, never asks for the Owner file and carries no
// recommendation wording; a missing file degrades to one line; the Owner Lab's
// crowd section renders the Owner join. Synthetic data only; nothing here
// contacts a provider, an account or the production store.
// Run: node scripts/regen-static.mjs && node scripts/crowd-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { crowdFixture } from './crowd-fixture.mjs';
import { regimeLabFixture } from './regime-lab-smoke.mjs';
import { CROWD_KEY, CROWD_OWNER_KEY } from '../lib/crowd/index.mjs';
import { REGIME_LAB_KEY } from '../lib/regime-lab/payload.mjs';

const output = process.env.CROWD_BROWSER_OUT || resolve(tmpdir(), 'stonks-crowd-browser');
await mkdir(output, { recursive: true });
const fx = await crowdFixture();
assert.ok(fx.crowd.okCount >= 10, `fixture sources fresh: ${fx.crowd.okCount}`);
assert.ok(fx.owner.openTrades.length >= 2, 'fixture has open trades');
const lab = regimeLabFixture();

let owner = false, haveFile = true;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === CROWD_KEY ? (haveFile ? fx.crowd : null) : key === CROWD_OWNER_KEY ? (owner ? fx.owner : null) : key === REGIME_LAB_KEY ? lab.payload : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const ADVICE_RE = /\b(we recommend|you should (buy|sell)|buy now|sell now|strong buy|strong sell|our pick|top pick)\b/i;
const TABS = ['positioning', 'shorts', 'attention', 'odds', 'perps'];

try {
  await selfTest(browser, server.base);

  // Public, desktop, light: every tab.
  {
    const s = await openTab(browser, server.base, { tab: 'crowd', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#crowd-root .crd-body').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    check((await s.page.locator('#crowd-root .vn-tabs .ui-tab').count()) === 5, 'five tabs');
    check((await s.page.locator('#crowd-root .mm-kpi').count()) >= 4, 'headline tiles rendered');
    for (const tab of TABS) {
      await s.page.locator('[data-crowd-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const text = await s.page.locator('#crowd-root').innerText();
      check(text.length > 300, tab + ': content rendered');
      check(!ADVICE_RE.test(text), tab + ': no recommendation wording');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' desktop light: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'public-1440-' + tab + '.png'), fullPage: true });
    }
    await s.page.locator('[data-crowd-tab="positioning"]').click();
    await settle(s.page, 400);
    check((await s.page.locator('#crowd-root table').count()) >= 3, 'positioning: put/call, COT, margin and fund tables');
    check((await s.page.locator('#crowd-root .crd-chart svg').count()) >= 1, 'positioning: at least one line chart');
    await s.page.locator('[data-crowd-tab="odds"]').click();
    await settle(s.page, 400);
    check((await s.page.locator('#crowd-root .crd-dist-row').count()) >= 6, 'odds: range buckets drawn');
    await s.page.locator('[data-crowd-tab="perps"]').click();
    await settle(s.page, 400);
    check((await s.page.locator('#crowd-root table tbody tr').count()) >= 5, 'perps: stock rows');
    check(!server.asks.data.includes(CROWD_OWNER_KEY), 'public: crowd-owner.json was never requested');
    check(server.asks.data.includes(CROWD_KEY), 'public: crowd.json was requested');
    // The chosen tab is remembered across a reload.
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.page.locator('#crowd-root .crd-body').waitFor({ timeout: 15000 });
    check((await s.page.locator('[data-crowd-tab="perps"][aria-selected="true"]').count()) === 1, 'tab choice remembered');
    await s.context.close();
  }

  // Public, phone, dark.
  {
    const s = await openTab(browser, server.base, { tab: 'crowd', width: 390, height: 844, theme: 'dark' });
    await s.page.locator('#crowd-root .crd-body').waitFor({ timeout: 15000 });
    for (const tab of ['positioning', 'shorts', 'odds']) {
      await s.page.locator('[data-crowd-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' phone dark: ' + problems.join(' | '));
    }
    await s.page.screenshot({ path: resolve(output, 'public-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // Public, file not written yet.
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { tab: 'crowd', width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /could not load/.test(document.querySelector('#crowd-root')?.textContent || ''), null, { timeout: 15000 });
    check(s.errors.length === 0, 'missing file: no page errors');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
  }

  // Owner Lab: the crowd join section.
  {
    owner = true;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'quant', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#owner-tab-regime').waitFor({ state: 'visible', timeout: 15000 });
    await s.page.locator('#owner-tab-regime').click();
    await s.page.locator('#rgl-crowd-body .mm-kpis').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    const text = await s.page.locator('#rgl-crowd').innerText();
    check(/open trades? joined/.test(text), 'owner: the join line names the open trades');
    check((await s.page.locator('#rgl-crowd-body table tbody tr').count()) >= 2, 'owner: open trades table rows');
    check(/Most crowded attention/.test(text), 'owner: most / least crowded lists');
    check(server.asks.data.includes(CROWD_OWNER_KEY), 'owner: crowd-owner.json requested');
    const problems = await pageProblems(s);
    check(problems.length === 0, 'owner lab: ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, 'owner-lab-crowd.png'), fullPage: true });
    await s.context.close();
    owner = false;
  }
  console.log(`crowd browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

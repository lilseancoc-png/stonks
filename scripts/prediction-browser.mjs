// Browser check for the Prediction markets page (2026-11-15): every public tab
// renders at 1440 light and 390 dark with no page errors, raw values or
// sideways scroll, never asks for the Owner file and carries no
// recommendation wording; the Owner tabs render the Owner payload only after
// sign-in; the stock page shows the odds strip; a missing file degrades to
// one line. Synthetic data from prediction-fixture.mjs; nothing here contacts
// Kalshi, Polymarket or the production store.
// Run after regenerating the shell: node scripts/prediction-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { predictionFixture, fixtureChains } from './prediction-fixture.mjs';
import { PREDICTION_KEY, PREDICTION_OWNER_KEY, PREDICTION_STATE_KEY } from '../lib/prediction/index.mjs';

const output = process.env.PREDICTION_BROWSER_OUT || resolve(tmpdir(), 'stonks-prediction-browser');
await mkdir(output, { recursive: true });
const fx = await predictionFixture();
assert.ok(fx.pub.counts.tracked >= 6, 'fixture tracks contracts');
assert.ok(fx.owner.families.length >= 3, 'fixture has test families');
const bars = fixtureChains(['NVDA']).NVDA._bars;
const nvda = { symbol: 'NVDA', spot: bars[bars.length - 1].c, priceSeries: { t: bars.map((b) => b.t.slice(0, 10)), c: bars.map((b) => b.c) }, fundamentals: {}, technicals: {}, news: {} };

let owner = false, haveFile = true;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === PREDICTION_KEY ? (haveFile ? fx.pub : null) : key === PREDICTION_OWNER_KEY ? (owner ? fx.owner : null) : key === 'NVDA.json' ? nvda : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const ADVICE_RE = /\b(we recommend|you should (buy|sell)|buy now|sell now|strong buy|strong sell|our pick|top pick)\b/i;
const PUBLIC = ['themes', 'moves', 'releases', 'stocks'];
const OWNER = ['tests', 'runup', 'alerts', 'finder'];

try {
  await selfTest(browser, server.base);

  // Public, desktop, light: every tab.
  {
    const s = await openTab(browser, server.base, { tab: 'prediction-markets', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#pm-root .pmk-body').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    check((await s.page.locator('#pm-root .vn-tabs .ui-tab').count()) === 4, 'four public tabs');
    check((await s.page.locator('#pm-root .mm-kpi').count()) >= 3, 'headline tiles rendered');
    for (const tab of PUBLIC) {
      await s.page.locator('[data-pmk-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const text = await s.page.locator('#pm-root').innerText();
      check(text.length > 300, tab + ': content rendered');
      check(!ADVICE_RE.test(text), tab + ': no recommendation wording');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' desktop light: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'public-1440-' + tab + '.png'), fullPage: true });
    }
    await s.page.locator('[data-pmk-tab="themes"]').click();
    await settle(s.page, 400);
    check((await s.page.locator('#pm-root .pmk-theme').count()) >= 4, 'themes: one section per topic with contracts');
    check((await s.page.locator('#pm-root svg.row-spark').count()) >= 4, 'themes: 30-day lines drawn');
    check((await s.page.locator('#pm-root .pmk-link').count()) >= 4, 'themes: stock links drawn');
    await s.page.locator('[data-pmk-theme="geopolitics"]').click();
    await settle(s.page, 300);
    check((await s.page.locator('#pm-root .pmk-theme').count()) === 1, 'themes: a topic chip narrows to one topic');
    await s.page.locator('[data-pmk-tab="releases"]').click();
    await settle(s.page, 300);
    check(/CPI/.test(await s.page.locator('#pm-root').innerText()), 'releases: the CPI guess is listed');
    await s.page.locator('[data-pmk-tab="stocks"]').click();
    await settle(s.page, 300);
    await s.page.locator('[data-pmk-sym="NVDA"]').click();
    await settle(s.page, 300);
    check(/Jensen Huang/.test(await s.page.locator('#pm-root').innerText()), 'by stock: NVDA lists the Jensen Huang contract');
    const asks = server.asks.data.slice();
    check(!asks.includes(PREDICTION_OWNER_KEY) && !asks.includes(PREDICTION_STATE_KEY), 'public: no Owner or state file was requested');
    check(asks.includes(PREDICTION_KEY), 'public: prediction-odds.json was requested');
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.page.locator('#pm-root .pmk-body').waitFor({ timeout: 15000 });
    check((await s.page.locator('[data-pmk-tab="stocks"][aria-selected="true"]').count()) === 1, 'tab choice remembered');
    await s.context.close();
  }

  // Public, phone, dark.
  {
    const s = await openTab(browser, server.base, { tab: 'prediction-markets', width: 390, height: 844, theme: 'dark', extra: '&view=themes' });
    await s.page.locator('#pm-root .pmk-body').waitFor({ timeout: 15000 });
    for (const tab of PUBLIC) {
      await s.page.locator('[data-pmk-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' phone dark: ' + problems.join(' | '));
    }
    await s.page.screenshot({ path: resolve(output, 'public-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // Stock page: the odds strip on the Overview tab.
  {
    const s = await openTab(browser, server.base, { tab: 'stock', width: 1280, height: 1000, theme: 'light', extra: '&s=NVDA' });
    await s.page.locator('#stp-odds:not([hidden])').waitFor({ timeout: 15000 });
    const text = await s.page.locator('#stp-odds').innerText();
    check(/What prediction markets are betting on/.test(text) && /Jensen Huang/.test(text), 'stock page: the odds strip lists the linked contract');
    check(await s.page.locator('#stp-odds a[href*="tab=prediction-markets"]').count() === 1, 'stock page: links to the full page');
    const problems = (await pageProblems(s)).filter((p) => !/console error/.test(p));
    check(problems.length === 0, 'stock page: ' + problems.join(' | '));
    await s.page.locator('#stp-odds').screenshot({ path: resolve(output, 'stock-nvda-odds.png') });
    await s.context.close();
  }

  // Public, file not written yet.
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { tab: 'prediction-markets', width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /could not load/.test(document.querySelector('#pm-root')?.textContent || ''), null, { timeout: 15000 });
    check(s.errors.length === 0, 'missing file: no page errors');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
  }

  // Owner: the four Owner tabs.
  {
    owner = true;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'prediction-markets', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('[data-pmk-tab="tests"]').waitFor({ timeout: 15000 });
    check((await s.page.locator('#pm-root .vn-tabs .ui-tab').count()) === 8, 'owner: eight tabs');
    for (const tab of OWNER) {
      await s.page.locator('[data-pmk-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const text = await s.page.locator('#pm-root').innerText();
      check(!/Loading the Owner tests|not written yet/.test(text), tab + ': Owner data rendered');
      check(!ADVICE_RE.test(text), tab + ': no recommendation wording');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' owner: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'owner-1440-' + tab + '.png'), fullPage: true });
    }
    await s.page.locator('[data-pmk-tab="tests"]').click();
    await settle(s.page, 300);
    check((await s.page.locator('#pm-root .pmk-verdict').count()) >= 3, 'owner tests: verdict pills');
    await s.page.locator('[data-pmk-tab="moves"]').click();
    await settle(s.page, 300);
    check(/How they moved/.test(await s.page.locator('#pm-root').innerText()), 'owner: big moves add the linked stock reactions');
    check(server.asks.data.includes(PREDICTION_OWNER_KEY), 'owner: prediction-odds-owner.json requested');
    check(!server.asks.data.includes(PREDICTION_STATE_KEY), 'owner: the raw state file is never requested');
    await s.context.close();
    owner = false;
  }
  console.log(`prediction browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

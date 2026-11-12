// Browser check for Booms & busts (2026-11-12): the public page renders every
// tab at 1440 light and 390 dark with no page errors, raw values or sideways
// scroll, never asks for the Owner file and carries no recommendation wording;
// a missing file degrades to one line; the Owner sees the Stocks tab with the
// per-stock credit read; Risk analysis shows the non-voting context card; a
// ?view= deep link opens its tab. Synthetic data only (scripts/fixtures/
// history-rhymes.mjs); nothing here contacts a provider or the store.
// Run: node scripts/regen-static.mjs && node scripts/history-rhymes-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { historyRhymesFixture } from './fixtures/history-rhymes.mjs';
import { HISTORY_RHYMES_KEY, HISTORY_RHYMES_OWNER_KEY } from '../lib/history-rhymes.mjs';

const output = process.env.HISTORY_RHYMES_BROWSER_OUT || resolve(tmpdir(), 'stonks-history-rhymes-browser');
await mkdir(output, { recursive: true });
const fx = historyRhymesFixture();

let owner = false, haveFile = true;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === HISTORY_RHYMES_KEY ? (haveFile ? fx.rhymes : null) : key === HISTORY_RHYMES_OWNER_KEY ? (owner ? fx.owner : null) : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const ADVICE_RE = /\b(we recommend|you should (buy|sell)|buy now|sell now|strong buy|strong sell|our pick|top pick)\b/i;
const PUBLIC_TABS = ['now', 'railroads', 'telecom', 'housing', 'ai', 'credit'];
const ready = (page) => page.locator('#history-rhymes-root .hr-body').waitFor({ timeout: 15000 });

try {
  await selfTest(browser, server.base);

  // Public, desktop, light: every tab.
  {
    const s = await openTab(browser, server.base, { tab: 'history-rhymes', width: 1440, height: 1000, theme: 'light' });
    await ready(s.page);
    await settle(s.page, 600);
    check((await s.page.locator('#history-rhymes-root [data-hr-tab]').count()) >= PUBLIC_TABS.length, 'public tabs drawn');
    check((await s.page.locator('#history-rhymes-root [data-hr-tab="stocks"]').count()) === 0, 'public: no Stocks tab');
    check((await s.page.locator('#history-rhymes-root .hr-sign').count()) === 9, 'nine warning signs');
    check((await s.page.locator('#history-rhymes-root .hr-match-row').count()) === 3, 'three case matches');
    for (const tab of PUBLIC_TABS) {
      await s.page.locator('#history-rhymes-root [data-hr-tab="' + tab + '"]').first().click();
      await settle(s.page, 500);
      const text = await s.page.locator('#history-rhymes-root').innerText();
      check(text.length > 400, tab + ': content rendered');
      check(!ADVICE_RE.test(text), tab + ': no recommendation wording');
      check(!/\b(NaN|undefined|null)\b/.test(text), tab + ': no raw values');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' desktop light: ' + problems.join(' | '));
      if (tab !== 'now') check((await s.page.locator('#history-rhymes-root .hr-svg').count()) >= 1, tab + ': at least one chart');
      await s.page.screenshot({ path: resolve(output, 'public-1440-' + tab + '.png'), fullPage: true });
    }
    // Chart hover readout works on a case chart.
    await s.page.locator('#history-rhymes-root [data-hr-tab="housing"]').first().click();
    await settle(s.page, 400);
    const svg = s.page.locator('#history-rhymes-root .hr-svg[data-ch]').first();
    check(await svg.count() === 1, 'housing chart opts in to hover');
    const box = await svg.boundingBox();
    await s.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await settle(s.page, 200);
    check(await s.page.locator('.ch-tip').isVisible(), 'hover tooltip shows');
    await s.page.locator('#history-rhymes-root [data-hr-tab="credit"]').first().click();
    await settle(s.page, 300);
    check(/1,000|1000/.test(await s.page.locator('#history-rhymes-root').innerText()), 'credit: the reported CoreWeave CDS quote');
    check(/no free daily feed/i.test(await s.page.locator('#history-rhymes-root').innerText()), 'credit: says single-name CDS is not free');
    check(!server.asks.data.includes(HISTORY_RHYMES_OWNER_KEY), 'public: the Owner file was never requested');
    check(server.asks.data.includes(HISTORY_RHYMES_KEY), 'public: the public file was requested');
    // The chosen tab is remembered across a reload.
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await ready(s.page);
    check((await s.page.locator('#history-rhymes-root [data-hr-tab="credit"][aria-selected="true"]').count()) === 1, 'tab choice remembered');
    await s.context.close();
  }

  // Public, phone, dark.
  {
    const s = await openTab(browser, server.base, { tab: 'history-rhymes', width: 390, height: 844, theme: 'dark' });
    await ready(s.page);
    for (const tab of ['now', 'telecom', 'ai', 'credit']) {
      await s.page.locator('#history-rhymes-root [data-hr-tab="' + tab + '"]').first().click();
      await settle(s.page, 500);
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' phone dark: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'public-390-dark-' + tab + '.png'), fullPage: true });
    }
    await s.context.close();
  }

  // A ?view= deep link opens that tab.
  {
    const s = await openTab(browser, server.base, { tab: 'history-rhymes', extra: '&view=railroads', width: 1200, height: 900, theme: 'light' });
    await ready(s.page);
    check((await s.page.locator('#history-rhymes-root [data-hr-tab="railroads"][aria-selected="true"]').count()) === 1, 'deep link opens Railroads');
    await s.context.close();
  }

  // Public, file not written yet.
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { tab: 'history-rhymes', width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /could not load/.test(document.querySelector('#history-rhymes-root')?.textContent || ''), null, { timeout: 15000 });
    check(s.errors.length === 0, 'missing file: no page errors');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
  }

  // Owner: the Stocks tab and the Risk analysis context card.
  {
    owner = true;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'history-rhymes', extra: '&view=stocks', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#history-rhymes-root [data-hr-tab="stocks"][aria-selected="true"]').waitFor({ timeout: 15000 });
    await s.page.locator('#history-rhymes-root table tbody tr').first().waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    const text = await s.page.locator('#history-rhymes-root').innerText();
    check(/CRWV/.test(text) && /Debt-funded builder/.test(text), 'owner: the debt-funded builder row');
    check(/Merton/.test(text) && /not a market CDS quote/i.test(text), 'owner: the model is labeled as a model');
    check((await s.page.locator('#history-rhymes-root table tbody tr').count()) >= 10, 'owner: buildout and other stock rows');
    check(server.asks.data.includes(HISTORY_RHYMES_OWNER_KEY), 'owner: the Owner file was requested');
    const rowH = await s.page.locator('#history-rhymes-root table tbody tr').first().evaluate((tr) => tr.getBoundingClientRect().height);
    check(rowH < 70, 'owner: stock rows stay one line tall (' + Math.round(rowH) + 'px)');
    await s.page.locator('#history-rhymes-root [data-vt-expand]').first().click();
    await settle(s.page, 300);
    const detail = await s.page.locator('#history-rhymes-root .hr-detail').first().innerText();
    check(/Model five-year default chance 20% or more/.test(detail) && /1,000|Reuters|S&P/.test(detail), 'owner: the row opens to its flags and CDS report');
    const problems = await pageProblems(s);
    check(problems.length === 0, 'owner stocks: ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, 'owner-1440-stocks.png'), fullPage: true });
    await s.context.close();

    const r = await openTab(browser, server.base, { tab: 'risk', width: 1440, height: 1000, theme: 'light' });
    await r.page.locator('#risk-rhymes .hr-risk').waitFor({ timeout: 15000 });
    const card = await r.page.locator('#risk-rhymes').innerText();
    check(/Context, not a vote/i.test(card) && /of 9/.test(card), 'risk: the context card names the count and says it does not vote');
    const rp = (await pageProblems(r)).filter((p) => !/blank/.test(p));
    check(rp.length === 0, 'risk card: ' + rp.join(' | '));
    await r.page.locator('#risk-rhymes').screenshot({ path: resolve(output, 'owner-risk-card.png') });
    await r.context.close();
    owner = false;
  }
  console.log(`history-rhymes browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

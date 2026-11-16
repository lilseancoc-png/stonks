// Browser check for the Owner Lab "Quant labs" view and the "Market odds"
// card (2026-11-16): every sub-tab renders the labs file at 1440 light and
// 390 dark with no page errors, raw values or sideways scroll; the card shows
// on the Bottom tracker and Risk analysis pages; a missing file degrades to
// one hint; a public visitor never sees the view or the card and never asks
// for either labs file. Synthetic data only (the smoke fixture); nothing here
// contacts a provider, an account or the production store.
// Run: node scripts/quant-labs-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { quantLabsFixture } from './quant-labs-smoke.mjs';
import { QUANT_LABS_KEY, QUANT_LABS_STATE_KEY } from '../lib/labs/index.mjs';

const output = process.env.QUANT_LABS_BROWSER_OUT || resolve(tmpdir(), 'stonks-quant-labs-browser');
await mkdir(output, { recursive: true });
const { payload } = quantLabsFixture();
assert.ok(payload?.card?.fall?.length && payload.drawdown?.status === 'ok', 'fixture has market odds');
assert.ok(payload.factors?.universe?.factors?.length, 'fixture has the wide factor test');

let owner = true, haveFile = true, file = payload;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === QUANT_LABS_KEY ? (haveFile ? file : null) : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const JUNK = /undefined|NaN|\[object Object\]|Infinity/;
const TABS = [
  ['summary', /Market odds/],
  ['odds', /10%\+ fall within 6 months/],
  ['calibration', /Top Picks/],
  ['factors', /Momentum|momentum/],
  ['vol', /GARCH/],
  ['filings', /risk section|Risk section|annual report/i],
  ['registry', /Things tried/],
];

// Quant labs is its own Owner page since 2026-11-16 (was an Owner Lab view).
async function openLabs(opts) {
  const s = await openTab(browser, server.base, { tab: 'quant-labs', ...opts });
  await s.page.locator('#page-pane-quant-labs').waitFor({ state: 'visible', timeout: 15000 });
  return s;
}

try {
  await selfTest(browser, server.base);

  for (const vp of [{ width: 1440, height: 1000, theme: 'light', name: 'owner-1440-light' }, { width: 390, height: 844, theme: 'dark', name: 'owner-390-dark' }]) {
    const s = await openLabs(vp);
    await s.page.locator('#quant-labs-root .ql-body').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    check(/How likely, how honest/.test(await s.page.locator('#page-pane-quant-labs').innerText()), vp.name + ': the page intro is shown');
    check((await s.page.locator('[data-page-tab="quant-labs"]').count()) === 1 && (await s.page.locator('[data-owner-view="labs"]').count()) === 0, vp.name + ': Quant labs is a sidebar page, not an Owner Lab view');
    check(/Written by the/.test(await s.page.locator('#owner-labs-status').innerText()), vp.name + ': the status line names the build');
    check((await s.page.locator('#quant-labs-root [data-ql-tab]:not(.ql-linkbtn)').count()) === TABS.length, vp.name + ': one tab per lab');
    for (const [tab, expect] of TABS) {
      await s.page.locator(`#quant-labs-root [data-ql-tab="${tab}"]:not(.ql-linkbtn)`).first().click();
      await settle(s.page, 250);
      const text = await s.page.locator('#quant-labs-root').innerText();
      check(expect.test(text), `${vp.name}: ${tab} tab rendered`);
      check(text.length > 300 && !JUNK.test(text), `${vp.name}: ${tab} tab has no raw values`);
      check(!/is not available yet/.test(text), `${vp.name}: ${tab} tab has its data`);
      const problems = await pageProblems(s);
      check(problems.length === 0, `${vp.name} ${tab}: ` + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, `${vp.name}-${tab}.png`), fullPage: true });
    }
    // Tables and charts that must be there.
    await s.page.locator('#quant-labs-root [data-ql-tab="odds"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 250);
    check((await s.page.locator('#quant-labs-root table tbody tr').count()) >= payload.drawdown.targets.length, vp.name + ': one row per market event');
    check((await s.page.locator('#quant-labs-root svg').count()) >= 1, vp.name + ': the stated-vs-happened chart');
    await s.page.locator('#quant-labs-root [data-ql-tab="calibration"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 250);
    check((await s.page.locator('#quant-labs-root table tbody tr').count()) >= payload.calibration.sources.length, vp.name + ': one row per calibration source');
    // The wide factor test: a row per factor and one for the combined score, the
    // family regression, the limits, and no company named.
    await s.page.locator('#quant-labs-root [data-ql-tab="factors"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 250);
    const uni = s.page.locator('#quant-labs-root [data-ql-universe]');
    check((await uni.count()) === 1, vp.name + ': the wide factor test is shown');
    const uniText = await uni.innerText();
    check(/largest US companies/.test(uniText) && /held up after costs/.test(uniText), vp.name + ': the wide factor test states its read');
    check((await uni.locator('table').count()) === 2, vp.name + ': the factor table and the family regression');
    check((await uni.locator('table').first().locator('tbody tr').count()) >= payload.factors.universe.factors.length + 1, vp.name + ': a row per factor and one for the combined score');
    check((await uni.locator('table').nth(1).locator('tbody tr').count()) === payload.factors.universe.families.length, vp.name + ': a regression row per family');
    check(/Limits of this test/.test(uniText) && /Aggregates only/.test(uniText), vp.name + ': the limits and the aggregates note are there');
    check(!/\bU\d{3}\b|Made-up company/.test(uniText) && !JUNK.test(uniText), vp.name + ': the wide factor test names no company and shows no raw values');
    check(!/—%/.test(uniText), vp.name + ': a factor with no spread shows a dash, not a dash with a percent sign');
    await uni.screenshot({ path: resolve(output, `${vp.name}-universe.png`) });
    // A summary link jumps to its lab and the choice is remembered.
    await s.page.locator('#quant-labs-root [data-ql-tab="summary"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 200);
    const jump = s.page.locator('#quant-labs-root .ql-linkbtn').first();
    const target = await jump.getAttribute('data-ql-tab');
    await jump.click();
    await settle(s.page, 250);
    check((await s.page.locator(`#quant-labs-root [data-ql-tab="${target}"][aria-selected="true"], #quant-labs-root [data-ql-tab="${target}"].is-active, #quant-labs-root [data-ql-tab="${target}"].active`).count()) >= 1, vp.name + ': a summary link opens its lab');
    check(s.errors.length === 0, vp.name + ': no page errors after switching labs');
    check(!server.asks.data.includes(QUANT_LABS_STATE_KEY), vp.name + ': the browser never asks for the state file');
    await s.context.close();
  }

  // The old Owner Lab link (?tab=quant&lab=labs) still opens Quant labs, on its
  // own page; Owner Lab's other views stay where they were.
  {
    const s = await openTab(browser, server.base, { tab: 'quant', extra: '&lab=labs', width: 1200, height: 900 });
    await s.page.locator('#quant-labs-root .ql-body').waitFor({ timeout: 15000 });
    check(await s.page.locator('#page-pane-quant-labs').isVisible(), 'the old ?tab=quant&lab=labs link opens the Quant labs page');
    const q = new URL(s.page.url()).searchParams;
    check(q.get('tab') === 'quant-labs' && !q.has('lab'), 'the old link lands on ?tab=quant-labs');
    await s.context.close();
    const o = await openTab(browser, server.base, { tab: 'quant', extra: '&lab=loop', width: 1200, height: 900 });
    await settle(o.page, 600);
    check(await o.page.locator('#page-pane-quant').isVisible() && await o.page.locator('#owner-panel-loop').isVisible(), '?tab=quant&lab=loop still opens the Owner Lab Loop view');
    check(o.errors.length === 0, 'Owner Lab: no page errors');
    await o.context.close();
  }

  // The card on the Risk analysis and Bottom tracker pages.
  for (const [tab, host] of [['risk', '#risk-odds'], ['bottom-tracker', '#bottom-odds']]) {
    for (const vp of [{ width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 844, theme: 'dark' }]) {
      const s = await openTab(browser, server.base, { tab, ...vp });
      await s.page.locator(host + ' .ql-card').waitFor({ state: 'visible', timeout: 15000 });
      await settle(s.page, 400);
      const text = await s.page.locator(host).innerText();
      check(/Context, not a vote/i.test(text) && /Chance of a 10%\+ drop within 6 months/.test(text), `${tab} ${vp.width}: the card states the headline chance`);
      check(/normal \d+%/.test(text) && !JUNK.test(text), `${tab} ${vp.width}: the card shows the normal rate and no raw values`);
      check((await s.page.locator(host + ' a[href="?tab=quant-labs"]').count()) === 1, `${tab} ${vp.width}: the card links to the Quant labs page`);
      const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
      check(problems.length === 0, `${tab} ${vp.width}: ` + problems.join(' | '));
      await s.page.locator(host).screenshot({ path: resolve(output, `card-${tab}-${vp.width}.png`) });
      await s.context.close();
    }
  }

  // A lab that could not run keeps its last good copy with a note; a lab with
  // no data says so in one line.
  {
    file = { ...payload, vol: { ...payload.vol, stale: true }, factors: { status: 'no-data', note: 'No price history reached the factor lab this build.' } };
    const s = await openLabs({ width: 1200, height: 900, theme: 'light' });
    await s.page.locator('#quant-labs-root .ql-body').waitFor({ timeout: 15000 });
    await s.page.locator('#quant-labs-root [data-ql-tab="vol"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 200);
    check(/Last good copy/.test(await s.page.locator('#quant-labs-root').innerText()), 'a stale lab says it is the last good copy');
    await s.page.locator('#quant-labs-root [data-ql-tab="factors"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 200);
    check(/No price history reached the factor lab/.test(await s.page.locator('#quant-labs-root').innerText()), 'a lab with no data shows its note');
    await s.page.locator('#quant-labs-root [data-ql-tab="summary"]:not(.ql-linkbtn)').first().click();
    await settle(s.page, 200);
    const text = await s.page.locator('#quant-labs-root').innerText();
    check(!JUNK.test(text) && s.errors.length === 0, 'the summary copes with a missing lab');
    await s.context.close();
    file = payload;
  }

  // The file is not written yet; then Refresh re-reads it.
  {
    haveFile = false;
    const s = await openLabs({ width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /No labs file yet|not available/.test(document.querySelector('#owner-labs-status')?.textContent || ''), null, { timeout: 15000 });
    check(/could not be loaded/.test(await s.page.locator('#quant-labs-root').innerText()), 'a missing file shows one hint, not a broken page');
    check(s.errors.length === 0, 'no page errors on a missing file');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    const c = await openTab(browser, server.base, { tab: 'risk', width: 1200, height: 900 });
    await settle(c.page, 1500);
    check(!(await c.page.locator('#risk-odds').isVisible().catch(() => false)), 'no file: the card stays hidden');
    check(c.errors.length === 0, 'no file: no page errors on Risk analysis');
    await c.context.close();
    haveFile = true;
    const r = await openLabs({ width: 1200, height: 900, theme: 'light' });
    await r.page.locator('#quant-labs-root .ql-body').waitFor({ timeout: 15000 });
    const before = server.asks.data.filter((k) => k === QUANT_LABS_KEY).length;
    await r.page.locator('[data-owner-labs-refresh]').click();
    await settle(r.page, 600);
    check(server.asks.data.filter((k) => k === QUANT_LABS_KEY).length > before, 'Refresh re-reads quant-labs.json');
    await r.context.close();
  }

  // Public visitor: no view, no card, no request.
  {
    owner = false;
    server.asks.data.length = 0;
    for (const tab of ['quant-labs', 'quant', 'risk', 'bottom-tracker', 'home']) {
      const s = await openTab(browser, server.base, { tab, extra: tab === 'quant' ? '&lab=labs' : '', width: 1440, height: 1000 });
      await settle(s.page, 1500);
      check(!(await s.page.locator('#page-pane-quant-labs').isVisible().catch(() => false)) && !(await s.page.locator('[data-page-tab="quant-labs"]').isVisible().catch(() => false)), `public ${tab}: the Quant labs page and its sidebar link are not visible`);
      check(!(await s.page.locator('.ql-card').first().isVisible().catch(() => false)), `public ${tab}: no Market odds card`);
      check(s.errors.length === 0, `public ${tab}: no page errors`);
      await s.context.close();
    }
    check(!server.asks.data.includes(QUANT_LABS_KEY) && !server.asks.data.includes(QUANT_LABS_STATE_KEY), 'public: neither labs file was requested');
    owner = true;
  }
  console.log(`quant-labs browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

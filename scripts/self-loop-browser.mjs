// Browser check for the Owner Lab "Loop" tab (2026-11-09): the tab renders
// the loop's view file at 1440 light and 390 dark with no page errors, raw
// values or sideways scroll; a missing file degrades to one hint line; a
// public visitor never sees the tab and never asks for either loop file.
// Synthetic data only (the smoke fixture); nothing here contacts a provider,
// an account or the production store.
// Run: node scripts/self-loop-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { selfLoopFixture, tuneViewFixture } from './self-loop-smoke.mjs';
import { LOOP_STATE_KEY, LOOP_VIEW_KEY } from '../lib/self-loop/index.mjs';

const output = process.env.SELF_LOOP_BROWSER_OUT || resolve(tmpdir(), 'stonks-self-loop-browser');
await mkdir(output, { recursive: true });
const { view } = selfLoopFixture();
assert.ok(view?.latest?.rows?.length, 'fixture has estimates');

const liveView = { ...view, tune: tuneViewFixture() };
assert.ok(liveView.tune.live && liveView.tune.waiting.length >= 2, 'the live tuning fixture has items waiting');
let owner = true, haveFile = true, live = false;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => (key === LOOP_VIEW_KEY ? (haveFile ? (live ? liveView : view) : null) : null),
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };

async function openLoop(opts) {
  const s = await openTab(browser, server.base, { tab: 'quant', ...opts });
  await s.page.locator('#owner-tab-loop').waitFor({ state: 'visible', timeout: 15000 });
  await s.page.locator('#owner-tab-loop').click();
  return s;
}

try {
  await selfTest(browser, server.base);

  // Owner, desktop, light.
  {
    const s = await openLoop({ width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#self-loop-root .slp-section').first().waitFor({ timeout: 15000 });
    await settle(s.page, 800);
    const text = await s.page.locator('#owner-panel-loop').innerText();
    check(/Is the engine learning/.test(text), 'the tab intro is shown');
    check((await s.page.locator('#self-loop-root .slp-section').count()) >= 8, 'every loop section rendered');
    check((await s.page.locator('#slp-latest tbody tr').count()) === view.latest.rows.length, 'one row per latest estimate');
    check(/Brier/.test(text) && /Rank skill/.test(text), 'honesty and direction reads rendered');
    check(/Saved/.test(text), 'the rule audit rendered');
    check((await s.page.locator('#slp-history svg.ln-svg').count()) === 2, 'two history charts');
    check((await s.page.locator('#slp-honesty svg.ln-svg').count()) === 1, 'the stated-vs-happened chart');
    check(!/undefined|NaN|\[object Object\]/.test(text), 'no raw values');
    check((await s.page.locator('#slp-report details').count()) >= 1, 'weekly reports rendered');
    check((await s.page.locator('#slp-report details[open]').count()) === 1, 'the newest report starts open');
    check((await s.page.locator('#slp-inputs tbody tr').count()) > 0, 'the input decay table rendered');
    check(/How do the losses happen/.test(text) && /Where does the engine work/.test(text), 'loss patterns and market splits rendered');
    check(/Paper challengers/.test(text) && /tried so far/.test(text), 'the challenger section rendered');
    check((await s.page.locator('#slp-challengers .slp-ch').count()) >= 1, 'a running challenger card');
    check(/Written by the/.test(await s.page.locator('#owner-loop-status').innerText()), 'the status line names the build');
    const problems = await pageProblems(s);
    check(problems.length === 0, 'desktop light: ' + problems.join(' | '));
    await s.page.locator('.rgl-nav a[href="#slp-gates"]').click();
    await settle(s.page, 200);
    check(/tab=quant/.test(s.page.url()), 'nav link keeps the Owner Lab open');
    check(s.errors.length === 0, 'no page errors after navigating sections');
    check(!server.asks.data.includes(LOOP_STATE_KEY), 'the browser never asks for the large state file');
    const tuneText = await s.page.locator('#slp-tune').innerText();
    check(/Self-tuning/.test(tuneText) && /Shadow/.test(tuneText), 'the self-tuning section shows shadow by default');
    check((await s.page.locator('#slp-tune [data-loop-act="approve"]').count()) === view.tune.waiting.length, 'shadow: an approval can wait for when it goes live');
    check((await s.page.locator('#slp-tune [data-loop-act="undo"], #slp-tune [data-loop-act="restore"]').count()) === 0, 'shadow on the base version: nothing to undo or restore');
    check(/What it would apply/.test(tuneText), 'shadow: the path it would apply is shown');
    await s.page.screenshot({ path: resolve(output, 'owner-1440-light.png'), fullPage: true });
    await s.context.close();
  }

  // Owner, phone, dark.
  {
    const s = await openLoop({ width: 390, height: 844, theme: 'dark' });
    await s.page.locator('#self-loop-root .slp-section').first().waitFor({ timeout: 15000 });
    await settle(s.page, 800);
    const problems = await pageProblems(s);
    check(problems.length === 0, 'phone dark: ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, 'owner-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // Owner, self-tuning live: items waiting, versions, an Approve click.
  for (const vp of [{ width: 1440, height: 1000, theme: 'light', name: 'tune-1440-light' }, { width: 390, height: 844, theme: 'dark', name: 'tune-390-dark' }]) {
    live = true;
    const s = await openLoop(vp);
    const posts = [];
    await s.page.route('**/api/auth/picks-loop', (route) => {
      const req = route.request();
      posts.push({ method: req.method(), body: req.postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, seq: posts.length }) });
    });
    s.page.on('dialog', (d) => d.accept());
    await s.page.locator('#slp-tune .slp-wait').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    const text = await s.page.locator('#slp-tune').innerText();
    check(/Live since/.test(text) && /Waiting on you/.test(text), vp.name + ': live status and the waiting list');
    check((await s.page.locator('#slp-tune .slp-wait li').count()) === liveView.tune.waiting.length, vp.name + ': one row per waiting item');
    check((await s.page.locator('#slp-tune tr.is-current').count()) === 1, vp.name + ': the version in use is marked');
    check((await s.page.locator('#slp-tune [data-loop-version]').count()) === liveView.tune.versions.length - 1, vp.name + ': every other version can be restored');
    check(!/undefined|NaN|\[object Object\]/.test(text), vp.name + ': no raw values');
    const problems = await pageProblems(s);
    check(problems.length === 0, vp.name + ': ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, vp.name + '.png'), fullPage: true });
    const approve = s.page.locator('#slp-tune .slp-wait [data-loop-act="approve"]').first();
    await approve.scrollIntoViewIfNeeded();
    await approve.click();
    await s.page.waitForFunction(() => /Saved/.test(document.querySelector('#slp-tune-status')?.textContent || ''), null, { timeout: 10000 });
    check(posts.length === 1 && posts[0].method === 'POST' && posts[0].body.act === 'approve' && posts[0].body.target === liveView.tune.waiting[0].id, vp.name + ': Approve posts the item id');
    check(await approve.isDisabled(), vp.name + ': the clicked button is disabled after saving');
    const undo = s.page.locator('#slp-tune [data-loop-act="undo"]');
    await undo.scrollIntoViewIfNeeded();
    await undo.click();
    await s.page.waitForFunction(() => /Saved/.test(document.querySelector('#slp-tune-status')?.textContent || ''), null, { timeout: 10000 });
    check(posts.length === 2 && posts[1].body.act === 'undo' && posts[1].body.target === undefined, vp.name + ': Undo posts an undo');
    check(s.errors.length === 0, vp.name + ': no page errors after the clicks');
    await s.context.close();
    live = false;
  }
  // A refused save shows the reason and re-enables the button.
  {
    live = true;
    const s = await openLoop({ width: 1200, height: 900, theme: 'light' });
    await s.page.route('**/api/auth/picks-loop', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'busy, try again' }) }));
    s.page.on('dialog', (d) => d.accept());
    await s.page.locator('#slp-tune .slp-wait').waitFor({ timeout: 15000 });
    const btn = s.page.locator('#slp-tune .slp-wait [data-loop-act="decline"]').first();
    await btn.click();
    await s.page.waitForFunction(() => /Not saved/.test(document.querySelector('#slp-tune-status')?.textContent || ''), null, { timeout: 10000 });
    check(/busy, try again/.test(await s.page.locator('#slp-tune-status').innerText()), 'a refused save shows the reason');
    check(!(await btn.isDisabled()), 'the button can be tried again');
    await s.context.close();
    live = false;
  }

  // Owner, the file is not written yet; then Refresh re-reads it.
  {
    haveFile = false;
    const s = await openLoop({ width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /not available yet/.test(document.querySelector('#owner-loop-status')?.textContent || ''), null, { timeout: 15000 });
    const text = await s.page.locator('#self-loop-root').innerText();
    check(/could not be loaded|not written yet/.test(text), 'a missing file shows one hint, not a broken page');
    check(s.errors.length === 0, 'no page errors on a missing file');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
    const r = await openLoop({ width: 1200, height: 900, theme: 'light' });
    await r.page.locator('#self-loop-root .slp-section').first().waitFor({ timeout: 15000 });
    const before = server.asks.data.filter((k) => k === LOOP_VIEW_KEY).length;
    await r.page.locator('[data-owner-loop-refresh]').click();
    await settle(r.page, 600);
    check(server.asks.data.filter((k) => k === LOOP_VIEW_KEY).length > before, 'Refresh loop re-reads picks-loop.json');
    await r.context.close();
  }

  // Public visitor: no tab, no request.
  {
    owner = false;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'quant', width: 1440, height: 1000 });
    await settle(s.page, 1500);
    check(!(await s.page.locator('#owner-tab-loop').isVisible().catch(() => false)), 'public: the Loop tab is not visible');
    check(!server.asks.data.includes(LOOP_VIEW_KEY) && !server.asks.data.includes(LOOP_STATE_KEY) && !server.asks.data.includes('picks-loop-control.json'), 'public: no loop file was requested');
    check(!server.asks.api.some((a) => /picks-loop/.test(a)), 'public: the loop action was never called');
    check(s.errors.length === 0, 'public: no page errors');
    await s.context.close();
    owner = true;
  }
  console.log(`self-loop browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}

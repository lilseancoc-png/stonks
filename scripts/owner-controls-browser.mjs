// Browser check for the Owner controls (2026-11-19, lib/owner-controls.mjs):
// the banner on Top Picks, Open picks, Strategy engines and Owner Settings,
// the controls panel on the engines page (Stop / Resume with the confirm box,
// the risk dial, Check this stock against the engines' last run and a live
// quote, Avoid, Watch, the catalyst log, Undo, the scorecard), the Account
// limits tab in Owner Settings, phone width in dark mode, a failed load, and a
// public visitor (who never sees a banner and never asks for the controls).
// Synthetic data only (scripts/engines-fixture.mjs); the controls action is
// played by the real lib/owner-controls.mjs in memory. Nothing here contacts a
// provider, an account or the production store.
// Run: node scripts/regen-static.mjs && node scripts/owner-controls-browser.mjs
// (the PR does not commit app.js / index.html, so regenerate them first or
// the page waits for markup that is not there and the run times out)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { enginesFixture } from './engines-fixture.mjs';
import { ENGINES_VIEW_KEY, ENGINES_RECORD_KEY } from '../lib/engines/index.mjs';
import { applyOwnerControlsRequest, controlsView, controlsScorecard, accountLimits } from '../lib/owner-controls.mjs';
import { ownerSettingsView } from '../lib/owner-settings.mjs';

const output = process.env.OWNER_CONTROLS_BROWSER_OUT || resolve(tmpdir(), 'stonks-owner-controls-browser');
await mkdir(output, { recursive: true });
const fx = await enginesFixture();
const view = fx.view;
// A name the engines scored at their last run, for Check this stock.
const checkSym = Object.keys(view.checks?.rows || {}).sort()[0];
assert.ok(checkSym, 'the fixture run has Check rows');

let owner = true, failControls = false, doc = null, switchOff = false;
const limits = accountLimits({ ACCOUNT_LIMIT_OPEN_USD: '40000', ACCOUNT_LIMIT_NEW_PER_DAY: '6' });
const posts = [];
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { ok(JSON.parse(s || 'null')); } catch { ok(null); } }); });
const acc = { builtAtIso: view.runIso, open: [fx.flagship], closed: [] };
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => {
    if (key === ENGINES_VIEW_KEY) return view;
    if (key === ENGINES_RECORD_KEY) return fx.record;
    if (key === 'picks-accuracy.json') return acc;
    if (key === 'picks-open.json') return { builtAtIso: view.runIso, open: [fx.flagship] };
    return null;
  },
  api: async (url, req) => {
    if (url.pathname === '/api/quote') return { symbol: url.searchParams.get('symbol'), spot: 123.45, changePct: -1.2 };
    if (url.pathname === '/api/quotes') return { quotes: [{ symbol: 'TSLA', spot: 250 }] };
    if (url.pathname === '/api/auth/owner-settings') return ownerSettingsView(null, { applied: { applied: {}, pinned: [], skipped: [], builtAtIso: view.runIso }, env: {} });
    if (url.pathname === '/api/auth/webull-mirror') return url.searchParams.get('scope') === 'engines' ? fx.mirror : { scope: 'flagship', trades: [], rows: [] };
    if (url.pathname !== '/api/auth/owner-controls') return undefined;
    if (failControls) return null;
    if (req.method === 'POST') {
      const body = await readBody(req);
      posts.push(body);
      const out = applyOwnerControlsRequest(doc, body, { at: new Date().toISOString(), by: 'Synthetic owner' });
      if (out.error) return { ...controlsView(doc, Date.now(), limits), changed: false, text: out.error };
      if (out.changed) doc = out.doc;
      return { ...controlsView(doc, Date.now(), limits), changed: !!out.changed, text: out.text || null };
    }
    const v = controlsView(doc, Date.now(), limits, { enabled: !switchOff });
    if (url.searchParams.get('scorecard')) v.scorecard = controlsScorecard(doc, { engines: fx.record.closed, picks: [] });
    return v;
  },
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const clean = async (s, label, opts) => { const p = await pageProblems(s, opts); check(p.length === 0, label + ': ' + p.join(' | ')); };
const asks = () => server.asks.api.filter((a) => a.startsWith('/api/auth/owner-controls')).length;
const accept = (s) => s.page.on('dialog', (d) => d.accept());
const shot = (s, name) => s.page.screenshot({ path: resolve(output, name + '.png'), fullPage: false });

try {
  await selfTest(browser, server.base);

  // ---- Owner, desktop, light: the engines page and its panel ---------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines' });
    accept(s);
    await s.page.locator('#oc-panel .oc-grid').first().waitFor({ timeout: 15000 });
    await settle(s.page, 700);
    const banner = s.page.locator('#page-pane-engines [data-oc-banner="engines"]');
    check(await banner.isVisible(), 'the engines page shows the banner');
    check(/none in force/.test(await banner.innerText()), 'nothing in force at first');
    check(await s.page.locator('#oc-panel').isVisible(), 'the controls panel shows');
    const panel = await s.page.locator('#oc-panel').innerText();
    for (const t of ['Stop new trades', 'Risk dial', 'Check this stock', 'Avoid', 'Watch closely', 'Catalyst log', 'Account limits', 'Change log', 'Scorecard'])
      check(panel.includes(t), 'the panel has ' + t);
    check(/Open option premium \$40,000/.test(panel) && /New trades a day 6/.test(panel) && /Daily loss stop off/.test(panel), 'the limits read from settings, off where unset');
    check(await s.page.locator('#oc-panel [data-oc-act="undo"]').isDisabled(), 'Undo is off with nothing to undo');
    await clean(s, 'engines page with the panel');
    await shot(s, 'engines-panel-1440-light');

    // Stop with the confirm box (accepted), then the banner says so.
    await s.page.locator('#oc-panel [data-oc-act="stop"]').click();
    await s.page.waitForFunction(() => /New trades are stopped/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    check(posts.at(-1).act === 'stop' && posts.at(-1).confirm === true, 'Stop posts with the confirm');
    check(/Exits keep running/.test(await banner.innerText()) && /LEAPS, Leveraged ETFs and Sector rotation/.test(await banner.innerText()), 'the banner says what keeps running');
    check(await s.page.locator('#oc-panel [data-oc-act="resume"]').isVisible(), 'the panel offers Resume');
    check(/Logged; Undo is in the change log/.test(await s.page.locator('#oc-panel .oc-msg').innerText()), 'the save says it was logged');
    await shot(s, 'engines-stopped-1440-light');

    // A declined confirm box changes nothing.
    s.page.removeAllListeners('dialog');
    s.page.on('dialog', (d) => d.dismiss());
    const before = posts.length;
    await s.page.locator('#oc-panel [data-oc-act="dial"][data-oc-level="riskier"]').click();
    await settle(s.page, 300);
    check(posts.length === before, 'Riskier with the box declined posts nothing');
    s.page.removeAllListeners('dialog'); accept(s);

    // Resume, the dial, Avoid, Watch, a catalyst.
    await s.page.locator('#oc-panel [data-oc-act="resume"]').click();
    await s.page.waitForFunction(() => !/New trades are stopped/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    await s.page.locator('#oc-panel [data-oc-act="dial"][data-oc-level="safer"]').click();
    await s.page.waitForFunction(() => /Risk dial Safer/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    check(await s.page.locator('#oc-panel [data-oc-level="safer"]').getAttribute('aria-pressed') === 'true', 'Safer shows as chosen');
    await s.page.locator('[data-oc-form="avoid"] input[name="sym"]').fill('tsla');
    await s.page.locator('[data-oc-form="avoid"] input[name="close"]').check();
    await s.page.locator('[data-oc-form="avoid"] button[type="submit"]').click();
    await s.page.waitForFunction(() => /Avoid TSLA/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    check(posts.at(-1).act === 'avoid' && posts.at(-1).sym === 'TSLA' && posts.at(-1).close === true && posts.at(-1).confirm === true, 'Avoid with close posts with the confirm');
    await s.page.locator('[data-oc-form="watch"] input[name="sym"]').fill('NVDA');
    await s.page.locator('[data-oc-form="watch"] button[type="submit"]').click();
    await s.page.waitForFunction(() => /Watching NVDA/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await s.page.locator('[data-oc-form="catalyst"] input[name="sym"]').fill('AAPL');
    await s.page.locator('[data-oc-form="catalyst"] input[name="text"]').fill('Product event');
    await s.page.locator('[data-oc-form="catalyst"] input[name="date"]').fill(soon);
    await s.page.locator('[data-oc-form="catalyst"] button[type="submit"]').click();
    await s.page.waitForFunction(() => /Product event/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    check((await s.page.locator('#oc-panel .oc-log li').count()) === 6, 'six changes in the log');

    // Undo the catalyst.
    await s.page.locator('#oc-panel [data-oc-act="undo"]').click();
    await s.page.waitForFunction(() => !/Product event/.test(document.querySelector('[data-oc-banner="engines"]')?.innerText || ''), null, { timeout: 5000 });
    check(/undone/.test(await s.page.locator('#oc-panel .oc-log').innerText()), 'the undone change is marked');

    // Check this stock: the engines' last run plus a live quote.
    await s.page.locator('[data-oc-form="check"] input[name="sym"]').fill(checkSym);
    await s.page.locator('[data-oc-form="check"] button[type="submit"]').click();
    await s.page.waitForFunction(() => /123\.45/.test(document.querySelector('#oc-panel .oc-check')?.innerText || ''), null, { timeout: 5000 });
    const chk = await s.page.locator('#oc-panel .oc-check').innerText();
    check(new RegExp(checkSym).test(chk) && /-1\.20% today/.test(chk), 'Check shows the live quote');
    check((await s.page.locator('#oc-panel .oc-check-table tbody tr').count()) === view.checks.rows[checkSym].length, 'Check lists every engine row for the name');
    // The scorecard loads on open.
    await s.page.locator('#oc-panel [data-oc-score] > summary').click();
    await s.page.waitForFunction(() => /Avoided stocks/.test(document.querySelector('#oc-panel [data-oc-score]')?.innerText || ''), null, { timeout: 5000 });
    const sc = await s.page.locator('#oc-panel [data-oc-score]').innerText();
    check(/Risk dial Safer/.test(sc) && /TSLA/.test(sc), 'the scorecard shows the settings and the avoided stock');
    await clean(s, 'engines page after every control');
    await shot(s, 'engines-controls-1440-light');
    await s.context.close();
  }

  // ---- The banner on the other Owner pages ---------------------------------
  for (const [tab, where] of [['picks', 'picks'], ['open-picks', 'open'], ['owner-settings', 'settings']]) {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab });
    await s.page.locator('[data-oc-banner="' + where + '"]').waitFor({ state: 'visible', timeout: 15000 });
    await settle(s.page, 500);
    const txt = await s.page.locator('[data-oc-banner="' + where + '"]').innerText();
    check(/Risk dial Safer/.test(txt) && /Avoid TSLA/.test(txt) && /Watching NVDA/.test(txt), tab + ': the banner lists what is in force');
    check((await s.page.locator('[data-oc-banner="' + where + '"] a[href="?tab=engines"]').count()) === 1, tab + ': the banner links to the controls');
    check((await s.page.locator('[data-oc-banner="' + where + '"] [data-oc-act="stop"]').count()) === 1, tab + ': Stop is one click from here');
    if (tab === 'owner-settings') {
      const tabBtn = s.page.locator('#owner-settings-root').getByRole('tab', { name: /Account limits/ });
      if (await tabBtn.count()) {
        await tabBtn.first().click(); await settle(s.page, 300);
        check(/Cap on open option premium/.test(await s.page.locator('#owner-settings-root').innerText()), 'Owner Settings has the Account limits tab');
      } else check(/Account limits/.test(await s.page.locator('#owner-settings-root').innerText()), 'Owner Settings lists Account limits');
    }
    await clean(s, tab + ' with the banner');
    await shot(s, tab + '-banner-1440-light');
    await s.context.close();
  }

  // ---- Owner, phone, dark ----------------------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'engines' });
    await s.page.locator('#oc-panel .oc-grid').first().waitFor({ timeout: 15000 });
    await settle(s.page, 700);
    await clean(s, 'engines panel at 390 dark');
    await s.page.locator('#oc-panel').scrollIntoViewIfNeeded();
    await shot(s, 'engines-panel-390-dark');
    await s.context.close();
    const p = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'picks' });
    await p.page.locator('[data-oc-banner="picks"]').waitFor({ state: 'visible', timeout: 15000 });
    await settle(p.page, 500);
    await clean(p, 'Top Picks banner at 390 dark');
    await shot(p, 'picks-banner-390-dark');
    await p.context.close();
  }

  // ---- A failed load ---------------------------------------------------------
  {
    failControls = true;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks' });
    await settle(s.page, 1500);
    check(await s.page.locator('[data-oc-banner="picks"]').isHidden(), 'Top Picks hides the banner when the controls cannot load');
    await clean(s, 'Top Picks with the controls down');
    await s.context.close();
    const e = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines' });
    await e.page.locator('#oc-panel').waitFor({ state: 'visible', timeout: 15000 });
    await settle(e.page, 900);
    check(/couldn’t load/.test(await e.page.locator('#oc-panel').innerText()), 'the panel says it could not load');
    await clean(e, 'engines page with the controls down');
    await e.context.close();
    failControls = false;
  }

  // ---- The kill switch off (Owner Settings OWNER_CONTROLS) ---------------------
  {
    switchOff = true;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks' });
    await s.page.locator('[data-oc-banner="picks"]').waitFor({ state: 'visible', timeout: 15000 });
    await settle(s.page, 600);
    const t = await s.page.locator('[data-oc-banner="picks"]').innerText();
    check(/Owner controls are off/.test(t) && !/New trades are stopped/.test(t), 'Top Picks says the controls are off, not that trades are stopped');
    await clean(s, 'Top Picks with the controls switched off');
    await s.context.close();
    const e = await openTab(browser, server.base, { width: 390, height: 900, theme: 'dark', tab: 'engines' });
    await e.page.locator('#oc-panel .oc-grid').first().waitFor({ timeout: 15000 });
    await settle(e.page, 700);
    check(/nothing applies to Top Picks/.test(await e.page.locator('#oc-panel').innerText()), 'the panel says nothing applies while off');
    await clean(e, 'engines page (390 dark) with the controls switched off');
    await shot(e, 'switched-off-390-dark');
    await e.context.close();
    switchOff = false;
  }

  // ---- Public visitor ----------------------------------------------------------
  {
    owner = false;
    const n0 = asks();
    for (const [tab, w] of [['home', 1440], ['picks', 1440], ['engines', 390]]) {
      const s = await openTab(browser, server.base, { width: w, height: 900, theme: w < 500 ? 'dark' : 'light', tab });
      await settle(s.page, 1200);
      check((await s.page.locator('[data-oc-banner]:visible, #oc-panel:visible').count()) === 0, 'public ' + tab + ': no banner or panel');
      await clean(s, 'public ' + tab);
      await s.context.close();
    }
    check(asks() === n0, 'a public visitor never asks for the controls');
    owner = true;
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${checks} owner controls browser checks passed. Screenshots: ${output}`);

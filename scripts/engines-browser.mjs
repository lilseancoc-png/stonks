// Browser check for the strategy engines on the Top Picks page (2026-11-16):
// the engine switcher, "All engines", each engine's five views, deep links,
// the same-contract note on Open picks, the first-morning empty state, phone
// width in dark mode, and a public visitor (who never sees the engines and
// never asks for an engine file or the paper account).
// Synthetic data only (scripts/engines-fixture.mjs); nothing here contacts a
// provider, an account or the production store.
// Run: node scripts/engines-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { enginesFixture } from './engines-fixture.mjs';
import { ENGINES, ENGINE_IDS } from '../lib/engines/config.mjs';
import { ENGINES_VIEW_KEY, ENGINES_RECORD_KEY, ENGINES_STATE_KEY } from '../lib/engines/index.mjs';

const output = process.env.ENGINES_BROWSER_OUT || resolve(tmpdir(), 'stonks-engines-browser');
await mkdir(output, { recursive: true });
const fx = await enginesFixture();
const view = fx.view;
assert.ok(view.engines.length === ENGINE_IDS.length && view.total.open > 0 && view.total.n > 20, 'the fixture has open and closed engine trades');
assert.ok(fx.flagship && view.shared.length >= 1, 'the fixture has a contract shared with Top Picks');

const acc = { builtAtIso: view.runIso, open: [fx.flagship], closed: [] };
let owner = true, haveFile = true;
const mirrorAsks = [];
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => {
    if (key === ENGINES_VIEW_KEY) return haveFile ? view : null;
    if (key === ENGINES_RECORD_KEY) return haveFile ? fx.record : null;
    if (key === 'picks-accuracy.json') return acc;
    if (key === 'picks-open.json') return { builtAtIso: view.runIso, open: [fx.flagship] };
    return null;
  },
  api: (url) => {
    if (url.pathname !== '/api/auth/webull-mirror') return undefined;
    mirrorAsks.push(url.search);
    return url.searchParams.get('scope') === 'engines' ? fx.mirror : { scope: 'flagship', trades: [], rows: [] };
  },
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const clean = async (s, label, opts) => { const p = await pageProblems(s, opts); check(p.length === 0, label + ': ' + p.join(' | ')); };
const paneText = (s) => s.page.locator('#eng-pane').innerText();
const pick = async (s, id) => { await s.page.locator('#eng-bar [data-eng="' + id + '"]').click(); await settle(s.page, 250); };
const sub = async (s, id) => { await s.page.locator('#eng-pane .eng-subtabs [data-eng-sub="' + id + '"]').click(); await settle(s.page, 250); };

try {
  await selfTest(browser, server.base);

  // ---- Owner, desktop, light -------------------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks' });
    await s.page.locator('#eng-bar').waitFor({ state: 'visible', timeout: 15000 });
    await settle(s.page, 900);
    check((await s.page.locator('#eng-bar [data-eng]').count()) === ENGINE_IDS.length + 2, 'the switcher has Top Picks, All engines and one tab per engine');
    check(await s.page.locator('#eng-bar [data-eng="flagship"]').evaluate((b) => b.classList.contains('is-on')), 'Top Picks is the default view');
    check(await s.page.locator('#picks-section').isVisible(), 'the Top Picks card shows by default');
    check(await s.page.locator('#eng-pane').isHidden(), 'the engine pane starts hidden');
    const tecOpen = view.engines.find((e) => e.id === 'technicals').open.length;
    if (tecOpen) check((await s.page.locator('#eng-bar [data-eng-count="technicals"]').innerText()).trim() === String(tecOpen), 'the tab shows the open-trade count');

    // All engines.
    await pick(s, 'all');
    await s.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    await settle(s.page, 700);
    check(await s.page.locator('#picks-section').isHidden(), 'the Top Picks card hides while an engine view is open');
    check(/engine=all/.test(s.page.url()), 'the address carries the engine');
    let text = await paneText(s);
    check((await s.page.locator('#eng-all-cmp tbody tr').count()) === ENGINE_IDS.length + 2, 'side by side: the flagship, six engines and a total row');
    for (const id of ENGINE_IDS) check(text.includes(ENGINES[id].name), 'All engines names ' + ENGINES[id].name);
    check(/own Track Record/.test(text) && /Flagship/.test(text), 'the flagship row points at its own record');
    check((await s.page.locator('#eng-all-shared tbody tr').count()) === view.shared.length, 'one row per shared contract');
    check((await s.page.locator('#eng-all-shared').innerText()).includes('Top Picks'), 'the shared contract names its holder');
    check(/Market type/.test(text) && /10-year yield/.test(text), 'the market backdrop rendered');
    check((await s.page.locator('#eng-all-hist tbody tr').count()) === ENGINE_IDS.length, 'the history test summary has every engine');
    check(/not in the long test/.test(await s.page.locator('#eng-all-hist').innerText()), 'engines without a long test say so');
    check((await s.page.locator('#eng-all-webull .vt-table tbody tr').count()) === fx.mirror.trades.length, 'the paper account lists every engine order');
    check((await s.page.locator('#eng-all-runs tbody tr').count()) === Math.min(20, view.runs.length), 'the run log rendered');
    check(mirrorAsks.length >= 1 && mirrorAsks.every((q) => /scope=engines/.test(q)), 'the page asks the mirror for engine trades only');
    await clean(s, 'All engines, desktop');
    await s.page.screenshot({ path: resolve(output, 'all-engines-1440.png'), fullPage: true });

    // Jump from the table into one engine.
    await s.page.locator('#eng-all-cmp [data-eng-go="technicals"]').click();
    await settle(s.page, 300);
    check(/engine=technicals/.test(s.page.url()), 'a name in the table opens that engine');

    // Every engine, every view.
    for (const id of ENGINE_IDS) {
      const e = view.engines.find((x) => x.id === id);
      await pick(s, id);
      await sub(s, 'now');
      text = await paneText(s);
      check(text.includes(e.name) && text.includes(e.idea.slice(0, 40)), id + ': the idea is shown');
      check((await s.page.locator('#eng-open .vt-table tbody tr').count()) === e.open.length, id + ': one row per open trade');
      check(/The rules/.test(text) && /Never a spread/.test(text), id + ': the rules are shown');
      if (e.candidates.length) check((await s.page.locator('#eng-cands tbody tr').count()) === e.candidates.length, id + ': one row per candidate');
      await clean(s, id + ' now');

      await sub(s, 'record');
      text = await paneText(s);
      check(/This record belongs to/.test(text), id + ': the record says whose it is');
      check((await s.page.locator('#eng-closed .vt-table tbody tr').count()) === e.closed.length, id + ': one row per closed trade');
      if (e.stats.n) check((await s.page.locator('#eng-splits details').count()) === 8, id + ': eight scorecard cuts');
      if ((e.stats.curve || []).length >= 3) check((await s.page.locator('#eng-pane .eng-body > svg.ln-svg, #eng-pane .eng-body > .ln-wrap svg, #eng-pane .eng-body svg.ln-svg').count()) >= 1, id + ': the running-total chart');
      await clean(s, id + ' record');

      await sub(s, 'learn');
      text = await paneText(s);
      check((await s.page.locator('#eng-setups tbody tr').count()) === e.setups.length, id + ': one row per setup');
      check(/Change log/.test(text) && /Shadow trades/.test(text), id + ': change log and shadow trades');
      if (e.setups.some((x) => x.startsOnShadow)) check(/Started on shadow/.test(text), id + ': shadow-start setups are marked');
      await clean(s, id + ' learn');

      await sub(s, 'history');
      text = await paneText(s);
      if (e.history && (e.history.live || e.history.raw)) {
        check((await s.page.locator('#eng-hist-windows tbody tr').count()) >= 5, id + ': results by time period');
        check((await s.page.locator('#eng-hist-cells tbody tr').count()) >= 4, id + ': results by market type');
        check(/Fed policy/.test(text) && /Inflation/.test(text) && /VIX level/.test(text), id + ': results by macro environment');
        check(/Random entries/.test(text), id + ': the random-entry control');
        const before = await s.page.locator('#eng-hist-windows').innerText();
        await s.page.locator('#eng-pane [data-eng-hist="raw"]').click();
        await settle(s.page, 200);
        check((await s.page.locator('#eng-pane [data-eng-hist="raw"]').evaluate((b) => b.classList.contains('is-on'))) && (await s.page.locator('#eng-hist-windows').innerText()) !== before, id + ': the version switch changes the numbers');
        await s.page.locator('#eng-pane [data-eng-hist="live"]').click();
      } else {
        check(/judged forward only|not in the long history test/.test(text), id + ': says why there is no long test');
      }
      check(/What the test cannot see/.test(text), id + ': the limits of the test are listed');
      await clean(s, id + ' history');

      await sub(s, 'webull');
      await s.page.locator('#eng-pane .vt-table, #eng-pane .vt-empty').first().waitFor({ timeout: 15000 });
      const mine = fx.mirror.trades.filter((t) => t.engine === id);
      check((await s.page.locator('#eng-pane .eng-body .vt-table tbody tr').count()) === mine.length, id + ': only its own paper orders');
      await clean(s, id + ' webull');
    }
    await pick(s, 'technicals'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'technicals-now-1440.png'), fullPage: true });
    await sub(s, 'history');
    await s.page.screenshot({ path: resolve(output, 'technicals-history-1440.png'), fullPage: true });

    // The follower row carries its label.
    const follower = view.engines.flatMap((e) => e.open.map((t) => ({ e, t }))).find((x) => x.t.shared);
    if (follower) {
      await pick(s, follower.e.id); await sub(s, 'now');
      check(/Held by Top Picks/.test(await s.page.locator('#eng-open').innerText()), 'the follower trade says who holds the contract');
      await sub(s, 'webull');
      check(/Not bought/.test(await paneText(s)) && /Held by Top Picks/.test(await paneText(s)), 'the paper account shows it was not bought twice');
    }

    // Back to the flagship.
    await pick(s, 'flagship');
    check(await s.page.locator('#picks-section').isVisible() && await s.page.locator('#eng-pane').isHidden(), 'Top Picks comes back');
    check(!/engine=/.test(s.page.url()), 'the address drops the engine');
    await clean(s, 'Top Picks with the switcher');
    await s.context.close();
  }

  // ---- Deep link and leaving the page ----------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks', extra: '&engine=reversion&ev=history' });
    await s.page.locator('#eng-hist-windows').waitFor({ timeout: 15000 });
    check(await s.page.locator('#eng-bar [data-eng="reversion"]').evaluate((b) => b.classList.contains('is-on')), 'a link opens its engine');
    check(await s.page.locator('#eng-pane .eng-subtabs [data-eng-sub="history"]').evaluate((b) => b.classList.contains('is-on')), 'a link opens its view');
    await s.page.evaluate(() => { const b = document.querySelector('[data-tab="open-picks"], #page-tab-open-picks'); if (b) b.click(); });
    await settle(s.page, 700);
    check(!/engine=|ev=/.test(s.page.url()), 'leaving Top Picks drops the engine from the address');
    await s.context.close();
  }

  // ---- Open picks: the same-contract note -------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'open-picks' });
    await s.page.locator('#open-picks-root .eng-shared-note').waitFor({ timeout: 15000 });
    const note = await s.page.locator('#open-picks-root .eng-shared-note').innerText();
    check(note.includes(fx.flagship.tradeId) && /Top Picks holds the one paper position/.test(note), 'Open picks names the engine trade on the same contract');
    await clean(s, 'Open picks with the note');
    await s.context.close();
  }

  // ---- First morning: no file yet ---------------------------------------------
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks', extra: '&engine=all' });
    // "Check again" appears once the read has finished (the loading line has no button).
    await s.page.locator('#eng-pane [data-eng-reload]').waitFor({ timeout: 15000 });
    check(/have not run yet/.test(await paneText(s)), 'before the first run the page says so');
    await pick(s, 'macro');
    check(/have not run yet/.test(await paneText(s)), 'an engine tab says so too');
    await clean(s, 'no engine file');
    await s.context.close();
    haveFile = true;
  }

  // ---- Owner, phone, dark ------------------------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'picks', extra: '&engine=all' });
    await s.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    await settle(s.page, 900);
    await clean(s, 'All engines, phone');
    await s.page.screenshot({ path: resolve(output, 'all-engines-390-dark.png'), fullPage: true });
    for (const id of ['technicals', 'macro', 'flow']) {
      await pick(s, id);
      for (const v of ['now', 'record', 'learn', 'history', 'webull']) { await sub(s, v); await settle(s.page, 200); await clean(s, id + ' ' + v + ', phone'); }
    }
    await pick(s, 'technicals'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'technicals-now-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // ---- Public visitor ----------------------------------------------------------
  {
    owner = false;
    server.asks.data.length = 0; server.asks.api.length = 0; mirrorAsks.length = 0;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks', extra: '&engine=all' });
    await settle(s.page, 1500);
    check((await s.page.locator('#eng-bar').count()) === 0 || await s.page.locator('#eng-bar').isHidden(), 'a public visitor never sees the engine switcher');
    check(!server.asks.data.some((k) => [ENGINES_VIEW_KEY, ENGINES_RECORD_KEY, ENGINES_STATE_KEY].includes(k)), 'a public visit asks for no engine file: ' + server.asks.data.join(', '));
    check(mirrorAsks.length === 0, 'a public visit never asks for the paper account');
    await s.context.close();
    owner = true;
  }

  console.log(`${checks} engine browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}

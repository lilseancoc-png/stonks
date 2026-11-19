// Browser check for the Owner "Strategy engines" page (2026-11-16): its tab
// bar, "All engines", each engine's five views, deep links, old
// ?tab=picks&engine= links landing on the new page, Top picks staying Top
// Picks only, the same-contract note and the engines link on Open picks, the
// first-morning empty state, phone width in dark mode, and a public visitor
// (who never sees the page and never asks for an engine file or the paper
// account).
// Synthetic data only (scripts/engines-fixture.mjs); nothing here contacts a
// provider, an account or the production store.
// Run: node scripts/engines-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { enginesFixture } from './engines-fixture.mjs';
import { ENGINES, ENGINE_IDS, SIGNAL_IDS, CORE_IDS } from '../lib/engines/config.mjs';
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
    // Top picks is Top Picks only: no engine tabs on it.
    const top = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks' });
    await top.page.locator('#picks-section').waitFor({ state: 'visible', timeout: 15000 });
    await settle(top.page, 600);
    check(await top.page.locator('#picks-section').isVisible(), 'the Top Picks card shows on Top picks');
    check((await top.page.locator('#page-pane-picks #eng-bar, #page-pane-picks #eng-pane').count()) === 0, 'Top picks carries no engine tabs');
    check((await top.page.locator('[data-page-tab="engines"]').count()) >= 1, 'the sidebar lists Strategy engines');
    check(!server.asks.data.includes(ENGINES_VIEW_KEY), 'Top picks does not load the engine file');
    await clean(top, 'Top picks without the engines');
    await top.context.close();

    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines' });
    await s.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    await settle(s.page, 900);
    check((await s.page.locator('#eng-bar [data-eng]').count()) === ENGINE_IDS.length + 2, 'the page has All engines, one tab per engine and the Allocator');
    check((await s.page.locator('#eng-bar [data-eng="flagship"]').count()) === 0, 'Top Picks is not a tab here');
    check(await s.page.locator('#eng-bar [data-eng="all"]').evaluate((b) => b.classList.contains('is-on')), 'All engines is the default view');
    check(await s.page.locator('#page-pane-picks').isHidden(), 'the Top Picks page is not shown');
    const tecOpen = view.engines.find((e) => e.id === 'technicals').open.length;
    if (tecOpen) check((await s.page.locator('#eng-bar [data-eng-count="technicals"]').innerText()).trim() === String(tecOpen), 'the tab shows the open-trade count');
    check(/tab=engines/.test(s.page.url()) && !/engine=/.test(s.page.url()), 'the address is the page itself for All engines');

    // All engines.
    let text = await paneText(s);
    // Share trades (2026-11-17) get their own row under the total.
    const shareRow = view.total.shares && (view.total.shares.n + view.total.shares.open) > 0 ? 1 : 0;
    check(shareRow === 1, 'the fixture has engine share trades');
    const coreRow = view.total.core && (view.total.core.n + view.total.core.open) > 0 ? 1 : 0;
    check(coreRow === 1, 'the fixture has core-engine holdings');
    check((await s.page.locator('#eng-all-cmp tbody tr').count()) === ENGINE_IDS.length + 2 + shareRow + coreRow, 'side by side: the flagship, eight engines, a total row, the share-trades row and the core-holdings row');
    const cmpText = await s.page.locator('#eng-all-cmp').innerText();
    check(/Signal engines, share trades/.test(cmpText) && /Core engines, holdings/.test(cmpText), 'share trades and core holdings are scored on their own lines');
    check(/core, monthly/.test(cmpText) && /vs SPY/.test(cmpText), 'a core engine row reads against SPY');
    for (const id of ENGINE_IDS) check(text.includes(ENGINES[id].name), 'All engines names ' + ENGINES[id].name);
    check(/own pages and Track Record/.test(text) && /Flagship/.test(text), 'the flagship row points at its own pages');
    check((await s.page.locator('#eng-all-shared tbody tr').count()) === view.shared.length, 'one row per shared contract');
    check((await s.page.locator('#eng-all-shared').innerText()).includes('Top Picks'), 'the shared contract names its holder');
    check(/Market type/.test(text) && /10-year yield/.test(text), 'the market backdrop rendered');
    check((await s.page.locator('#eng-all-hist tbody tr').count()) === ENGINE_IDS.length, 'the history test summary has every engine');
    check(/a year against SPY/.test(await s.page.locator('#eng-all-hist').innerText()), 'the core engines are summed up as a portfolio against SPY');
    check(/not in the long test/.test(await s.page.locator('#eng-all-hist').innerText()), 'engines without a long test say so');
    check((await s.page.locator('#eng-all-webull .vt-table tbody tr').count()) === fx.mirror.trades.length, 'the paper account lists every engine order');
    const webullText = await s.page.locator('#eng-all-webull').innerText();
    check(/Made by/i.test(webullText) && /made_by/.test(await s.page.locator('#eng-all-webull').textContent()), 'the paper account names the engine behind each order and says the downloads do too');
    check(/Webull order IDs start ms(ern|mac|tec|fun|flo|rev)/.test(webullText), 'each order shows the engine tag its Webull order IDs start with');
    check(/Webull fill/.test(webullText) && /Partly filled/.test(webullText), 'the paper account shows filled / partly filled / missed per order');
    const partlyN = fx.mirror.trades.filter((t) => t.fillOutcome === 'partial').length;
    if (partlyN) check(new RegExp('\\d+ of \\d+ (contracts|shares)').test(webullText), 'a partly filled order shows what filled of what was asked');
    check(/share orders on/.test(webullText) && /quantities above one on/.test(webullText), 'the paper account says which Webull sizing switches are on');
    check((await s.page.locator('#eng-all-runs tbody tr').count()) === Math.min(20, view.runs.length), 'the run log rendered');
    const openAll = view.engines.reduce((n, e) => n + e.open.length, 0);
    check((await s.page.locator('#eng-all-open .vt-table tbody tr:not(.vt-detail)').count()) === openAll, 'every engine\'s open trades sit in one table');
    const withCurve = view.engines.filter((e) => e.stats?.curve?.length).length;   // option trades only: a core engine has none
    check((await s.page.locator('#eng-all-curve .ln-svg path.ln-line').count()) === withCurve, 'one running-total line per engine with closed trades');
    check(!/\d{4}-\d{2}-\d{2}/.test(await s.page.locator('#eng-all-curve .ln-svg').innerHTML().then((h) => h.replace(/data-ch='[^']*'/, ''))), 'the curve axis reads as days, not raw ISO dates');
    check(/Went first/i.test(await s.page.locator('#eng-all-runs').innerText()), 'the run log says which engine went first');
    // The money-leak fixes (2026-11-17): one line each, with its switch state.
    const fix3 = view.fixes.filter((f) => f.step !== 4), fix4 = view.fixes.filter((f) => f.step === 4);
    check((await s.page.locator('#eng-all-fixes .eng-fixes li').count()) === fix3.length && fix3.length === 4, 'one line per rule fix');
    check(/Owner Settings/.test(await s.page.locator('#eng-all-fixes').innerText()) && (await s.page.locator('#eng-all-fixes .evb-s-pass').count()) === fix3.filter((f) => f.on).length, 'each fix shows whether it is on and where to switch it');
    // Honest paper trades (2026-11-19): their own section, one line each, and the sizing comparison.
    check((await s.page.locator('#eng-all-honest .eng-fixes li').count()) === fix4.length && fix4.length === 6, 'one line per honest-paper change');
    const honestText = await s.page.locator('#eng-all-honest').innerText();
    check(/ask going in and the bid coming out/.test(honestText) && /1 to 10 contracts/.test(honestText) && /conviction/i.test(honestText) && /Owner Settings/.test(honestText), 'the honest-paper section says what changed and where to switch it');
    check(/Fear and greed at the last run|No fear and greed reading/.test(honestText), 'the section says what fear and greed read at the last run');
    // Every open option trade opened under the new rules says how it was sized and filled.
    const sized = view.engines.flatMap((e) => e.open).filter((t) => t.size);
    check(sized.length > 0 && (await s.page.locator('#eng-all-open details.eng-size').count()) >= sized.length, 'each new trade carries its Size line');
    if (sized.length) {
      const d0 = s.page.locator('#eng-all-open details.eng-size').first();
      await d0.locator('summary').click(); await settle(s.page, 150);
      check(/budget|contract|share/i.test(await d0.innerText()), 'the Size line opens to the reasons');
    }
    check(mirrorAsks.length >= 1 && mirrorAsks.every((q) => /scope=engines/.test(q)), 'the page asks the mirror for engine trades only');
    await clean(s, 'All engines, desktop');
    await s.page.screenshot({ path: resolve(output, 'all-engines-1440.png'), fullPage: true });

    // Jump from the table into one engine.
    await s.page.locator('#eng-all-cmp [data-eng-go="technicals"]').click();
    await settle(s.page, 300);
    check(/engine=technicals/.test(s.page.url()), 'a name in the table opens that engine');

    // Every signal engine, every view.
    for (const id of SIGNAL_IDS) {
      const e = view.engines.find((x) => x.id === id);
      await pick(s, id);
      await sub(s, 'now');
      text = await paneText(s);
      check(text.includes(e.name) && text.includes(e.idea.slice(0, 40)), id + ': the idea is shown: ' + text.slice(0, 160).replace(/\n/g, ' / '));
      check((await s.page.locator('#eng-open .vt-table tbody tr').count()) === e.open.length, id + ': one row per open trade');
      check(/The rules/.test(text) && /Never a spread/.test(text), id + ': the rules are shown');
      const shareSetups = e.setups.filter((x) => x.calls === 'shares' && !x.retired);
      check(/never short stock/.test(text) === shareSetups.length > 0, id + ': the rules say which setups buy shares (' + shareSetups.length + ')');
      const shrOpen = e.open.filter((t) => t.instrument === 'shares').length;
      check((await s.page.locator('#eng-open .eng-shr').count()) === shrOpen, id + ': open share trades carry the Shares badge (' + shrOpen + ')');
      if (shrOpen) check(/shares at \$/.test(await s.page.locator('#eng-open').innerText()) && /Stock levels/.test(await s.page.locator('#eng-open').innerText()), id + ': a share trade shows its lot and stock exits');
      if (e.candidates.length) check((await s.page.locator('#eng-cands tbody tr').count()) === e.candidates.length, id + ': one row per candidate');
      const priced = e.candidates.filter((c) => c.skipped === 'price').length;
      check((await s.page.locator('#eng-cands tr.eng-row-skipped').count()) === priced, id + ': setups ruled out by today’s price move are listed (' + priced + ')');
      if (priced) check(/not traded and not tracked/.test(await s.page.locator('#eng-cands').innerText()), id + ': the page says what a row with no score means');
      if (id === 'fundamentals') {
        // The standing rank (2026-11-16): both ends, with the held names marked.
        const rk = e.rank;
        check(!!rk && rk.n >= rk.minNames && rk.top.length > 0 && rk.bottom.length > 0, 'fundamentals: the fixture carries a live rank');
        const rankText = await s.page.locator('#eng-rank').innerText();
        check((await s.page.locator('#eng-rank tbody tr').count()) === rk.top.length + rk.bottom.length + rk.heldElsewhere.length, 'fundamentals: one row per ranked stock shown');
        check(rankText.includes('Best ' + rk.top.length) && rankText.includes('Worst ' + rk.bottom.length), 'fundamentals: best and worst ends are headed');
        check(rankText.includes(rk.top[0].symbol) && rankText.includes(rk.bottom[rk.bottom.length - 1].symbol), 'fundamentals: the first and last ranked stocks are listed');
        const heldShown = [...rk.top, ...rk.bottom, ...rk.heldElsewhere].filter((r) => r.held).length;
        check(heldShown === e.open.length && (await s.page.locator('#eng-rank tr.eng-rank-held').count()) === heldShown, 'fundamentals: every holding is marked in the rank (' + heldShown + ')');
        check(/Stocks ranked/.test(text), 'fundamentals: the count of ranked stocks is shown where the entry bar was');
        check(/Swaps/.test(text) && /top or bottom third/.test(text), 'fundamentals: the rules say when a holding is swapped');
        check(e.open.filter((t) => t.side === 'call').length <= e.sideSlots.call && e.open.filter((t) => t.side === 'put').length <= e.sideSlots.put, 'fundamentals: no more than three calls and two puts');
      } else {
        check((await s.page.locator('#eng-rank').count()) === 0, id + ': no rank section');
      }
      await clean(s, id + ' now');

      await sub(s, 'record');
      text = await paneText(s);
      check(/This record belongs to/.test(text), id + ': the record says whose it is');
      check((await s.page.locator('#eng-closed .vt-table tbody tr').count()) === e.closed.length, id + ': one row per closed trade');
      if (e.stats.n) check((await s.page.locator('#eng-splits details').count()) === 8, id + ': eight scorecard cuts');
      check((await s.page.locator('#eng-shares').count()) === (e.sharesStats ? 1 : 0), id + ': share trades have their own scorecard when there are any');
      if (e.sharesStats) check(/% of the share price/.test(await s.page.locator('#eng-shares').innerText()), id + ': the share scorecard says its unit');
      check((await s.page.locator('#eng-vs-hist').count()) === 1, id + ': live against the history test');
      // What Webull filled, beside the engine's own result (2026-11-19).
      if (e.closed.length) {
        const closedText = await s.page.locator('#eng-closed').innerText();
        check(/At Webull/.test(closedText), id + ': the closed trades show what Webull filled');
        const inMirror = e.closed.slice(0, 60).some((t) => fx.mirror.trades.some((m) => m.tradeId === t.tradeId && m.fillOutcome === 'filled'));
        if (inMirror) check(/Filled/.test(closedText), id + ': a filled paper trade reads Filled beside the engine result');
      }
      if (e.vsHistory.rows.length) check((await s.page.locator('#eng-vs-hist tbody tr').count()) === e.vsHistory.rows.length, id + ': one row per setup and instrument (' + e.vsHistory.rows.length + ')');
      if (e.vsHistory.rows.some((r) => r.modelGain)) check(/price model/.test(await s.page.locator('#eng-vs-hist').innerText()), id + ': the price-model caveat');
      if ((e.stats.curve || []).length >= 3) check((await s.page.locator('#eng-pane .eng-body > svg.ln-svg, #eng-pane .eng-body > .ln-wrap svg, #eng-pane .eng-body svg.ln-svg').count()) >= 1, id + ': the running-total chart');
      await clean(s, id + ' record');

      await sub(s, 'learn');
      text = await paneText(s);
      check((await s.page.locator('#eng-setups tbody tr').count()) === e.setups.length, id + ': one row per setup');
      check(/Change log/.test(text) && /Shadow trades/.test(text), id + ': change log and shadow trades');
      if (e.setups.some((x) => x.startsOnShadow)) check(/Started on shadow/.test(text), id + ': shadow-start setups are marked');
      if (id === 'reversion') check(/Own contract: about 0\.30 delta, 14 to 35 days/.test(await s.page.locator('#eng-setups').innerText()) && /Own exits: \+30% take-profit, -60% stop/.test(await s.page.locator('#eng-setups').innerText()), 'reversion: the washout bounce shows its own contract and stop');
      if (id === 'technicals' || id === 'reversion') check(/retired/i.test(await s.page.locator('#eng-setups').innerText()), id + ': the retired put setup is marked');
      if (id === 'fundamentals') {
        check(/Retired/.test(await s.page.locator('#eng-setups').innerText()), 'fundamentals: the first-rules setups are marked retired');
        check(/standing rank/.test(text), 'fundamentals: the learning view explains the rule change');
      }
      await clean(s, id + ' learn');

      await sub(s, 'history');
      text = await paneText(s);
      if (e.history && (e.history.live || e.history.raw)) {
        check((await s.page.locator('#eng-hist-windows tbody tr').count()) >= 5, id + ': results by time period');
        // Technicals buys shares only since 2026-11-19: its history test is its share trades.
        if (id === 'technicals') check(/bought only shares in this version/.test(text) && /share trades/.test(await s.page.locator('#eng-hist-cmp').innerText()), 'technicals: the history test shows its share trades');
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
    // The core engines (2026-11-17): the monthly target, holdings, checks and the S&P line.
    for (const id of CORE_IDS) {
      const e = view.engines.find((x) => x.id === id);
      await pick(s, id);
      await sub(s, 'now');
      text = await paneText(s);
      check(text.includes(e.name) && text.includes(e.idea.slice(0, 40)), id + ': the idea is shown');
      check(/Core engine/i.test(text), id + ': marked as a core engine');
      check((await s.page.locator('#eng-core-target').count()) === 1 && /T-bills/.test(await s.page.locator('#eng-core-target').innerText()), id + ': this month’s target and its reads');
      check((await s.page.locator('#eng-open .vt-table tbody tr').count()) === e.open.length, id + ': one row per holding');
      check((await s.page.locator('#eng-open .eng-shr').count()) === e.open.length, id + ': every holding is shares');
      if (e.open.length) check(/Held until a monthly check swaps it/.test(await s.page.locator('#eng-open').innerText()), id + ': no stop or target, held to the monthly check');
      check((await s.page.locator('#eng-core-log tbody tr').count()) === e.holdings.log.length && e.holdings.log.length >= 2, id + ': one row per monthly check (' + e.holdings.log.length + ')');
      check(/S&P 500 \(SPY\) since then/.test(text), id + ': read against SPY since it started');
      check((await s.page.locator('#eng-core-ranked').count()) === (id === 'momentum' ? 1 : 0), id + ': the ranked list only for the basket');
      check(/Never an option|never an option/.test(text) && /bought as stock in the Webull paper account/i.test(text), id + ': the rules say stock only, bought as stock at Webull');
      await clean(s, id + ' now');
      await sub(s, 'record');
      check((await s.page.locator('#eng-closed .vt-table tbody tr').count()) === e.closed.length, id + ': one row per closed holding');
      check(/swapped at the monthly check/i.test(await paneText(s)) === e.closed.some((t) => t.status === 'rotate'), id + ': swaps are labeled');
      await clean(s, id + ' record');
      await sub(s, 'learn');
      check(/does not learn/.test(await paneText(s)) && (await s.page.locator('#eng-setups tbody tr').count()) === e.setups.length, id + ': a fixed rule, no learning');
      await clean(s, id + ' learn');
      await sub(s, 'history');
      text = await paneText(s);
      check(/SPY a year/.test(text) && (await s.page.locator('#eng-core-years tbody tr').count()) >= 10, id + ': the portfolio line against SPY, year by year');
      if (id === 'momentum') check(/1,000-name list/.test(text), 'momentum: the survivor bias is spelled out');
      await clean(s, id + ' history');
      await sub(s, 'webull');
      await s.page.locator('#eng-pane .vt-table, #eng-pane .vt-empty').first().waitFor({ timeout: 15000 });
      const coreMine = fx.mirror.trades.filter((t) => t.engine === id);
      check((await s.page.locator('#eng-pane .eng-body .vt-table tbody tr').count()) === coreMine.length, id + ': its holdings in the paper account, as stock');
      if (coreMine.length) check(/ shares/.test(await paneText(s)), id + ': paper rows read in shares');
      await clean(s, id + ' webull');
    }
    await pick(s, 'momentum'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'momentum-now-1440.png'), fullPage: true });
    await pick(s, 'trend'); await sub(s, 'history');
    await s.page.screenshot({ path: resolve(output, 'trend-history-1440.png'), fullPage: true });

    // The Allocator tab.
    await pick(s, 'allocator');
    await s.page.locator('#eng-alloc-table').waitFor({ timeout: 15000 });
    text = await paneText(s);
    check(/engine=allocator/.test(s.page.url()), 'the Allocator has its own address');
    check((await s.page.locator('#eng-alloc-table tbody tr').count()) === view.allocator.rows.length && view.allocator.rows.length >= SIGNAL_IDS.length, 'the Allocator lists every signal setup (' + view.allocator.rows.length + ')');
    check(/Market today/.test(text) && /Trending up, calm/.test(text), 'the Allocator names today’s market type');
    check(/not allocated/.test(text) && /Advising: holds nothing back/i.test(text) && /Would hold back/.test(text), 'the Allocator explains its rule and that it advises by default');
    check((await s.page.locator('#eng-alloc-hist tbody tr').count()) === 2 && /as it runs live/.test(await s.page.locator('#eng-alloc-hist').innerText()) && /would have held back made/.test(await s.page.locator('#eng-alloc-hist').innerText()), 'the Allocator shows its history test, with and without a starting record, and what the trades it would have held back made');
    check((await s.page.locator('#eng-alloc-table [data-eng-go]').count()) === view.allocator.rows.length, 'each row links to its engine');
    await clean(s, 'Allocator');
    await s.page.screenshot({ path: resolve(output, 'allocator-1440.png'), fullPage: true });

    await pick(s, 'fundamentals'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-now-1440.png'), fullPage: true });
    await sub(s, 'learn');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-learn-1440.png'), fullPage: true });
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

    // The flagship row leads to the Top picks page.
    await pick(s, 'all');
    await s.page.locator('#eng-all-cmp [data-wf-go="picks"]').click();
    await settle(s.page, 700);
    check(await s.page.locator('#picks-section').isVisible() && await s.page.locator('#page-pane-engines').isHidden(), 'the Top Picks row opens the Top picks page');
    check(/tab=picks/.test(s.page.url()) && !/engine=/.test(s.page.url()), 'the address drops the engine');
    await clean(s, 'Top picks after leaving the engines');
    await s.context.close();
  }

  // ---- Deep link and leaving the page ----------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines', extra: '&engine=reversion&ev=history' });
    await s.page.locator('#eng-hist-windows').waitFor({ timeout: 15000 });
    check(await s.page.locator('#eng-bar [data-eng="reversion"]').evaluate((b) => b.classList.contains('is-on')), 'a link opens its engine');
    check(await s.page.locator('#eng-pane .eng-subtabs [data-eng-sub="history"]').evaluate((b) => b.classList.contains('is-on')), 'a link opens its view');
    await s.page.evaluate(() => { const b = document.querySelector('[data-page-tab="open-picks"]'); if (b) b.click(); });
    await settle(s.page, 700);
    check(/tab=open-picks/.test(s.page.url()) && !/engine=|ev=/.test(s.page.url()), 'leaving the page drops the engine from the address');
    // From the engines page, the sidebar's Top picks opens Top picks (no bounce back).
    await s.page.evaluate(() => { const b = document.querySelector('[data-page-tab="engines"]'); if (b) b.click(); });
    await settle(s.page, 500);
    await pick(s, 'macro');
    await s.page.evaluate(() => { const b = document.querySelector('[data-page-tab="picks"]'); if (b) b.click(); });
    await settle(s.page, 700);
    check(/tab=picks/.test(s.page.url()) && await s.page.locator('#picks-section').isVisible(), 'Top picks opens from an engine view');
    await s.context.close();

    // A link saved while the engines sat on the Top Picks page still works.
    const old = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks', extra: '&engine=reversion&ev=history' });
    await old.page.locator('#eng-hist-windows').waitFor({ timeout: 15000 });
    check(/tab=engines/.test(old.page.url()) && /engine=reversion/.test(old.page.url()) && /ev=history/.test(old.page.url()), 'an old Top Picks engine link lands on the Strategy engines page');
    check(await old.page.locator('#page-pane-picks').isHidden(), 'and does not show Top picks');
    await old.context.close();
    const oldAll = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'picks', extra: '&engine=all' });
    await oldAll.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    check(/tab=engines/.test(oldAll.page.url()) && !/engine=/.test(oldAll.page.url()), 'the old All engines link lands on the page');
    await oldAll.context.close();
  }

  // ---- Open picks: the same-contract note -------------------------------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'open-picks' });
    await s.page.locator('#open-picks-root .eng-shared-note').waitFor({ timeout: 15000 });
    const note = await s.page.locator('#open-picks-root .eng-shared-note').innerText();
    check(note.includes(fx.flagship.tradeId) && /Top Picks holds the one paper position/.test(note), 'Open picks names the engine trade on the same contract');
    const link = s.page.locator('#open-picks-root .eng-open-link');
    check(new RegExp('Strategy engines: ' + view.total.open + ' open paper trade').test(await link.innerText()), 'Open picks links to the engines with their open count');
    const openBody = await s.page.locator('#open-picks-root').innerText();
    const otherEngineIds = view.engines.flatMap((e) => e.open.map((t) => t.tradeId)).filter((id) => !note.includes(id));
    check(otherEngineIds.length > 0 && otherEngineIds.every((id) => !openBody.includes(id)), 'Open picks lists no engine trade of its own');
    await link.locator('[data-wf-go="engines"]').click();
    await s.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    check(/tab=engines/.test(s.page.url()), 'the link opens the Strategy engines page');
    await clean(s, 'Open picks with the note');
    await s.context.close();
  }

  // ---- First morning: no file yet ---------------------------------------------
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines' });
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
    const s = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'engines' });
    await s.page.locator('#eng-all-cmp').waitFor({ timeout: 15000 });
    await settle(s.page, 900);
    await clean(s, 'All engines, phone');
    await s.page.screenshot({ path: resolve(output, 'all-engines-390-dark.png'), fullPage: true });
    for (const id of ['technicals', 'macro', 'flow', 'trend', 'momentum']) {
      await pick(s, id);
      for (const v of ['now', 'record', 'learn', 'history', 'webull']) { await sub(s, v); await settle(s.page, 200); await clean(s, id + ' ' + v + ', phone'); }
    }
    await pick(s, 'technicals'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'technicals-now-390-dark.png'), fullPage: true });
    await pick(s, 'fundamentals'); await sub(s, 'now'); await settle(s.page, 300);
    await clean(s, 'fundamentals now, phone');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-now-390-dark.png'), fullPage: true });
    await pick(s, 'allocator'); await settle(s.page, 300);
    await clean(s, 'Allocator, phone');
    await s.page.screenshot({ path: resolve(output, 'allocator-390-dark.png'), fullPage: true });
    await s.context.close();
  }

  // ---- Public visitor ----------------------------------------------------------
  {
    owner = false;
    server.asks.data.length = 0; server.asks.api.length = 0; mirrorAsks.length = 0;
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'engines', extra: '&engine=technicals' });
    await settle(s.page, 1500);
    check((await s.page.locator('#eng-bar').count()) === 0 || await s.page.locator('#eng-bar').isHidden(), 'a public visitor never sees the engines page');
    check((await s.page.locator('[data-page-tab="engines"]').count()) === 0 || await s.page.locator('[data-page-tab="engines"]').first().isHidden(), 'a public visitor has no Strategy engines entry in the sidebar');
    check(!/tab=engines/.test(s.page.url()), 'a public visitor is sent home from the engines link');
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

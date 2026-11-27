// Browser check for the Owner "Strategy engines" page (2026-11-16): its tab
// bar, "All engines", each engine's five views, deep links, old
// ?tab=picks&engine= links landing on the new page, Top picks staying Top
// Picks only, Open picks listing every open Webull paper trade (Top Picks,
// every engine trade and anything still working at Webull, 2026-11-19), the
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
import { mirrorTradeId } from '../lib/webull-mirror.mjs';
import { picksTradePop } from '../lib/trade-pop.mjs';

const output = process.env.ENGINES_BROWSER_OUT || resolve(tmpdir(), 'stonks-engines-browser');
await mkdir(output, { recursive: true });
const fx = await enginesFixture();
const view = fx.view;
assert.ok(view.engines.length === ENGINE_IDS.length && view.total.open > 0 && view.total.n > 20, 'the fixture has open and closed engine trades');
assert.ok(fx.flagship && view.shared.length >= 1, 'the fixture has a contract shared with Top Picks');

// The Top Picks trade carries a stated chance, as a new enrollment would.
fx.flagship.pop = picksTradePop(fx.flagship, { exitPolicy: { takeProfitPct: 25, stopPct: 50 }, rfr: 0.045, setupOdds: { winPct: 48, n: 31, level: 'side-band' } });
assert.ok(fx.flagship.pop && fx.flagship.pop.p > 0, 'the fixture Top Picks trade has a stated chance');
// The earnings straddle trial (2026-11-27): the fixture's walk never prices a
// report's options cheap, so the page payload gets two hand-made pairs (one
// sold, one waiting for its report) in the shape straddleRows() writes.
assert.ok(view.straddles && !view.straddles.error && view.straddles.on === true, 'the page file carries the straddle block');
const stExp = Math.floor(Date.parse('2026-12-18T00:00:00Z') / 1000);
view.straddles = { ...view.straddles, open: 1, closed: 1, wins: 1, usd: 640, pct: 33.3, avgPct: 33.3, rows: [
  { id: 'ERN:NVDA-C-11/12/26-15:30-ST', symbol: 'NVDA', reportDate: '2026-11-13', session: 'AM', sellOn: '2026-11-13', entryDate: '2026-11-12T20:30:00.000Z', exitDate: null, open: true, legs: 2, strike: 190, expiry: stExp, qty: 2, expectedPct: 7.4, impliedPct: 5.9, ratio: 1.25, costUsd: 2240, usd: -310, pct: -13.8, moveAtExitPct: null },
  { id: 'ERN:AMD-C-11/03/26-15:30-ST', symbol: 'AMD', reportDate: '2026-11-03', session: 'PM', sellOn: '2026-11-04', entryDate: '2026-11-03T20:30:00.000Z', exitDate: '2026-11-04T16:00:00.000Z', open: false, legs: 2, strike: 250, expiry: stExp, qty: 1, expectedPct: 9.1, impliedPct: 6.8, ratio: 1.34, costUsd: 1920, usd: 640, pct: 33.3, moveAtExitPct: -10.2 },
] };
const acc = { builtAtIso: view.runIso, open: [fx.flagship], closed: [] };
let owner = true, haveFile = true;
const mirrorAsks = [];
// The whole paper account (scope=all, read by Open picks): the Top Picks
// trade filled, every engine row, and one engine trade the record has closed
// that Webull is still selling.
const flagshipWb = { tradeId: mirrorTradeId(fx.flagship), engine: null, madeBy: 'Top Picks', symbol: fx.flagship.symbol, side: fx.flagship.side, state: 'open', instrument: 'option', fillOutcome: 'filled', requestedQty: 2, filledQty: 2, paperPnlPct: 3.6, legs: 'BUY spread' };
const closedEng = fx.mirror.trades.find((t) => t.state === 'closed');
const exitingWb = closedEng ? { ...closedEng, tradeId: closedEng.tradeId + '-X', state: 'exiting', fillOutcome: 'filled' } : null;
const allMirror = { ...fx.mirror, scope: 'all', trades: [flagshipWb, ...fx.mirror.trades, ...(exitingWb ? [exitingWb] : [])] };
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
    const scope = url.searchParams.get('scope');
    return scope === 'engines' ? fx.mirror : scope === 'all' ? allMirror : { scope: 'flagship', trades: [], rows: [] };
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
    check((await s.page.locator('#eng-bar [data-eng]').count()) === ENGINE_IDS.length + 4, 'the page has All engines, one tab per engine, the Allocator, the Scorecard and Experiments');
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
    check((await s.page.locator('#eng-all-cmp tbody tr').count()) === ENGINE_IDS.length + 2 + shareRow + coreRow, 'side by side: the flagship, nine engines, a total row, the share-trades row and the core-holdings row');
    const cmpText = await s.page.locator('#eng-all-cmp').innerText();
    check(/Signal engines, share trades/.test(cmpText) && /Core engines, holdings/.test(cmpText), 'share trades and core holdings are scored on their own lines');
    check(/core, monthly/.test(cmpText) && /vs SPY/.test(cmpText), 'a core engine row reads against SPY');
    for (const id of ENGINE_IDS) check(text.includes(ENGINES[id].name), 'All engines names ' + ENGINES[id].name);
    check(/own pages and Track Record/.test(text) && /Flagship/.test(text), 'the flagship row points at its own pages');
    check((await s.page.locator('#eng-all-shared tbody tr').count()) === view.shared.length, 'one row per shared contract');
    check((await s.page.locator('#eng-all-shared').innerText()).includes('Top Picks'), 'the shared contract names its holder');
    // Opposite-side tags and market-risk tags (2026-11-26, measure only).
    if (view.opposites?.pairs) {
      const opp = await s.page.locator('#eng-all-opposite').innerText();
      check(/Opposite sides of one stock/.test(opp) && /Pairs tagged/.test(opp), 'the opposite-sides scoreboard renders');
      check((await s.page.locator('#eng-all-opposite details:last-of-type tbody tr').count()) === Math.min(view.opposites.rows.length, 30), 'one row per tagged pair');
    } else check((await s.page.locator('#eng-all-opposite').count()) <= 1, 'no opposite pair: the section is empty or absent');
    if (view.marketRiskTags?.tagged) check(/Market-risk tags: \d+ engine trades/.test(text), 'the market-risk tag count shows');
    check(/Market type/.test(text) && /10-year yield/.test(text), 'the market backdrop rendered');
    check((await s.page.locator('#eng-all-hist tbody tr').count()) === ENGINE_IDS.length, 'the history test summary has every engine');
    check(/a year against SPY/.test(await s.page.locator('#eng-all-hist').innerText()), 'the core engines are summed up as a portfolio against SPY');
    check(/not in the long test/.test(await s.page.locator('#eng-all-hist').innerText()), 'engines without a long test say so');
    check((await s.page.locator('#eng-all-webull .vt-table tbody tr').count()) === fx.mirror.trades.length, 'the paper account lists every engine order');
    const webullText = await s.page.locator('#eng-all-webull').innerText();
    check(/Made by/i.test(webullText) && /made_by/.test(await s.page.locator('#eng-all-webull').textContent()), 'the paper account names the engine behind each order and says the downloads do too');
    check(/Webull order IDs start ms(ern|mac|tec|fun|flo|rev)/.test(webullText), 'each order shows the engine tag its Webull order IDs start with');
    // Webull results by engine (2026-11-22): one row per engine, then one per setup and instrument.
    const wbKey = (t) => (t.setup || '') + '|' + (t.instrument === 'stock' ? 'shares' : 'options');
    const wbEngines = [...new Set(fx.mirror.trades.filter((t) => t.engine).map((t) => t.engine))];
    const wbSetups = new Set(fx.mirror.trades.filter((t) => t.engine).map((t) => t.engine + '#' + wbKey(t)));
    check(/Webull results by engine/.test(webullText), 'the paper account has a results-by-engine table');
    check((await s.page.locator('#eng-all-webull tr.eng-wb-engine').count()) === wbEngines.length, 'one results row per engine with paper trades (' + wbEngines.length + ')');
    check((await s.page.locator('#eng-all-webull tr.eng-wb-setup').count()) === wbSetups.size, 'one results row per engine setup and instrument (' + wbSetups.size + ')');
    {
      const first = wbEngines.find((id) => ENGINE_IDS.includes(id));
      const sent = fx.mirror.trades.filter((t) => t.engine === first && t.fillOutcome !== 'shared' && t.fillOutcome !== 'not-bought').length;
      const cells = await s.page.locator('#eng-all-webull tr.eng-wb-engine').filter({ has: s.page.locator('[data-eng-go="' + first + '"]') }).locator('td').allInnerTexts();
      check(cells[1] === String(sent), first + ': the results row counts ' + sent + ' sent orders (read ' + cells[1] + ')');
    }
    check(/Webull fill/.test(webullText) && /Partly filled/.test(webullText), 'the paper account shows filled / partly filled / missed per order');
    const partlyN = fx.mirror.trades.filter((t) => t.fillOutcome === 'partial').length;
    if (partlyN) check(new RegExp('\\d+ of \\d+ (contracts|shares)').test(webullText), 'a partly filled order shows what filled of what was asked');
    check(/share orders on/.test(webullText) && /quantities above one on/.test(webullText), 'the paper account says which Webull sizing switches are on');
    check(/each stock order \$10,000 to \$250,000 of stock/.test(webullText), 'the paper account states the stock order range');
    const resized = fx.mirror.trades.filter((t) => t.qtyBasis === 'shares-max' || t.qtyBasis === 'shares-min');
    if (resized.length) check(/(Cut to the \$250,000 maximum|Raised to the \$10,000 minimum) \(record \d+\)/.test(webullText), 'a stock order moved into the range says so, with the record count');
    else console.log('note: no fixture stock order fell outside the range this run');
    check((await s.page.locator('#eng-all-runs tbody tr').count()) === Math.min(20, view.runs.length), 'the run log rendered');
    const openAll = view.engines.reduce((n, e) => n + e.open.length, 0);
    check((await s.page.locator('#eng-all-open .vt-table tbody tr:not(.vt-detail)').count()) === openAll, 'every engine\'s open trades sit in one table');
    const withCurve = view.engines.filter((e) => e.stats?.curve?.length).length;   // option trades only: a core engine has none
    check((await s.page.locator('#eng-all-curve .ln-svg path.ln-line').count()) === withCurve, 'one running-total line per engine with closed trades');
    check(!/\d{4}-\d{2}-\d{2}/.test(await s.page.locator('#eng-all-curve .ln-svg').innerHTML().then((h) => h.replace(/data-ch='[^']*'/, ''))), 'the curve axis reads as days, not raw ISO dates');
    check(/Went first/i.test(await s.page.locator('#eng-all-runs').innerText()), 'the run log says which engine went first');
    // The money-leak fixes (2026-11-17): one line each, with its switch state.
    const fix3 = view.fixes.filter((f) => !(f.step >= 4)), fix4 = view.fixes.filter((f) => f.step === 4), fix5 = view.fixes.filter((f) => f.step === 5);
    // The live data pack (2026-11-20): its own section, one line per part, switches named.
    const liveTrials = (view.trialSwitches || []).filter((t) => t.date === '2026-11-20');
    check(fix5.length === 2 && liveTrials.length === 2 && (await s.page.locator('#eng-all-live .eng-fixes li').count()) === fix5.length + liveTrials.length + 1, 'one line per live data pack part (two changes, two Flow trials, the rotation)');
    check(/Owner Settings/.test(await s.page.locator('#eng-all-live').innerText()) && /Multi-asset rotation/.test(await s.page.locator('#eng-all-live').innerText()), 'the live data pack says where to switch each part');
    check((await s.page.locator('#eng-all-fixes .eng-fixes li').count()) === fix3.length && fix3.length === 4, 'one line per rule fix');
    // The downtrend pack (2026-11-20): its three switches, the put cap and the Downside puts engine.
    const fix6 = view.fixes.filter((f) => f.step === 6);
    check(fix6.length === 3 && (await s.page.locator('#eng-all-down .eng-fixes li').count()) === fix6.length + 2, 'one line per downtrend pack part (three switches, the put cap, Downside puts)');
    check(/1 to 100 contracts/.test(await s.page.locator('#eng-all-down').innerText()) && /Owner Settings/.test(await s.page.locator('#eng-all-down').innerText()), 'the downtrend pack names the put cap and where to switch it');
    await s.page.locator('#eng-all-down').screenshot({ path: resolve(output, 'downtrend-pack-1440.png') });
    check(/Owner Settings/.test(await s.page.locator('#eng-all-fixes').innerText()) && (await s.page.locator('#eng-all-fixes .evb-s-pass').count()) === fix3.filter((f) => f.on).length, 'each fix shows whether it is on and where to switch it');
    // Honest paper trades (2026-11-19): their own section, one line each, and the sizing comparison.
    check((await s.page.locator('#eng-all-honest .eng-fixes li').count()) === fix4.length && fix4.length === 6, 'one line per honest-paper change');
    const honestText = await s.page.locator('#eng-all-honest').innerText();
    check(/ask going in and the bid coming out/.test(honestText) && /1 to 200 contracts/.test(honestText) && /conviction/i.test(honestText) && /Owner Settings/.test(honestText), 'the honest-paper section says what changed and where to switch it');
    // The size-bucket read (2026-11-20): does bigger size do better?
    const cmp = view.sizing && view.sizing.compare;
    if (cmp && (cmp.options.n || cmp.shares.n)) check(/Does bigger size do better\?/.test(honestText) && /Sized up \(over 1\.1x\)/.test(honestText) && /1 to 200 contracts, at most \$200,000 of premium \(1 to 25 from 20 November, 1 to 10 before\)/.test(honestText), 'the sizing section splits closed trades by multiplier and says the range');
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
    if (await s.page.locator('#eng-all-opposite').count()) await s.page.locator('#eng-all-opposite').screenshot({ path: resolve(output, 'opposite-sides-1440.png') });
    await s.page.locator('#eng-all-webull .eng-wb-head + .acc-tscroll').screenshot({ path: resolve(output, 'webull-by-engine-1440.png') });

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
      check((await s.page.locator('#eng-open .vt-table tbody tr:not(.vt-detail)').count()) === e.open.length, id + ': one row per open trade');
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
      // Paper trials (2026-11-19) are scored in their own section, never in the engine's numbers.
      check((await s.page.locator('#eng-trials').count()) === (e.trialStats ? 1 : 0), id + ': paper trials have their own section when there are any');
      if (e.trialStats) check(/scored here on their own/.test(await s.page.locator('#eng-trials').innerText()), id + ': the trial section says it is kept apart');
      // The earnings straddle trial: its own table on the Earnings record only, one row per pair.
      check((await s.page.locator('#eng-straddles').count()) === (id === 'earnings' ? 1 : 0), id + ': the straddle table is on the Earnings record only');
      if (id === 'earnings') {
        const stx = await s.page.locator('#eng-straddles').innerText();
        check((await s.page.locator('#eng-straddles table tbody tr').count()) === 2, 'earnings: one row per straddle (both legs together)');
        check(/open, sells 2026-11-13/.test(stx) && /before the open/.test(stx) && /after the close/.test(stx), 'earnings: an open straddle says when it sells, and each says the report time');
        check(/1 closed \(1 made money\)/.test(stx) && /\+\$640/.test(stx) && /\$2,240/.test(stx), 'earnings: the pair totals and what each cost');
        check(/one leg always loses/.test(stx), 'earnings: the note says to judge the pair');
      }
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
      const trialSetups = e.setups.filter((x) => x.trial).length;
      check((await s.page.locator('#eng-setups .eng-trial').count()) === trialSetups, id + ': paper-trial setups carry the badge (' + trialSetups + ')');
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
      if (mine.length) {
        const mineSetups = new Set(mine.map((t) => (t.setup || '') + '|' + (t.instrument === 'stock' ? 'shares' : 'options')));
        check(/Webull results by setup/.test(await paneText(s)) && (await s.page.locator('#eng-pane tr.eng-wb-engine').count()) === 0 && (await s.page.locator('#eng-pane tr.eng-wb-setup').count()) === mineSetups.size, id + ': its Webull results by setup (' + mineSetups.size + ' rows)');
      }
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
      check((await s.page.locator('#eng-open .vt-table tbody tr:not(.vt-detail)').count()) === e.open.length, id + ': one row per holding');
      check((await s.page.locator('#eng-open .eng-shr').count()) === e.open.length, id + ': every holding is shares');
      if (e.open.length) check(/Held until a monthly check swaps it/.test(await s.page.locator('#eng-open').innerText()), id + ': no stop or target, held to the monthly check');
      check((await s.page.locator('#eng-core-log tbody tr').count()) === e.holdings.log.length && e.holdings.log.length >= 2, id + ': one row per monthly check (' + e.holdings.log.length + ')');
      check(/S&P 500 \(SPY\) since then/.test(text), id + ': read against SPY since it started');
      check((await s.page.locator('#eng-core-ranked').count()) === (id === 'momentum' || id === 'rotation' ? 1 : 0), id + ': the ranked list only for the basket and the rotation');
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
      const hasHist = !!(e.history && (e.history.live || e.history.held || e.history.raw)?.core);
      if (hasHist || !e.liveTest) check(/SPY a year/.test(text) && (await s.page.locator('#eng-core-years tbody tr').count()) >= 10, id + ': the portfolio line against SPY, year by year');
      else check(/No history test on file/.test(text) && /live test/.test(text), id + ': a live test with no history run yet says so');
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
    await pick(s, 'rotation'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'rotation-now-1440.png'), fullPage: true });
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

    // The scorecard pack (2026-11-21): Scorecard and Experiments tabs.
    await pick(s, 'scorecard');
    await s.page.locator('#eng-sc-main').waitFor({ timeout: 15000 });
    text = await paneText(s);
    check(/engine=scorecard/.test(s.page.url()), 'the Scorecard has its own address');
    check(view.scorecard && Array.isArray(view.scorecard.rows) && (await s.page.locator('#eng-sc-main tbody tr').count()) === view.scorecard.rows.length + 1, 'the Scorecard lists every engine plus the book (' + (view.scorecard && view.scorecard.rows.length) + ')');
    check(/Weekly Sharpe/i.test(text) && /Book without it/i.test(text) && /By the market tape at entry/i.test(text) && /Options, shares and paper trials apart/i.test(text), 'the Scorecard shows Sharpe, the book without each engine, the tape split and the parts apart');
    check(/Loser brake/i.test(text) && (await s.page.locator('#eng-sc-brake tbody tr').count()) === (view.brake.rows || []).length && view.brake.rows.some((r) => r.on), 'the Scorecard shows the loser brake table with braked setups from the history prior');
    check(/History reference/i.test(text) && /real option prices/.test(text), 'the Scorecard shows the history reference');
    await clean(s, 'Scorecard');
    await s.page.screenshot({ path: resolve(output, 'scorecard-1440.png'), fullPage: true });
    await pick(s, 'experiments');
    await s.page.locator('.eng-vars').waitFor({ timeout: 15000 });
    text = await paneText(s);
    check(/engine=experiments/.test(s.page.url()), 'Experiments has its own address');
    check((await s.page.locator('.eng-var').count()) === view.variants.rows.length && view.variants.rows.length >= 8, 'Experiments lists every variant (' + view.variants.rows.length + ')');
    check(/never sent to Webull/.test(text) && /What it tests/.test(text) && /Worth adopting if/.test(text), 'each variant states its change, what it tests and when it is worth adopting');
    await clean(s, 'Experiments');
    await s.page.screenshot({ path: resolve(output, 'experiments-1440.png'), fullPage: true });

    await pick(s, 'fundamentals'); await sub(s, 'now');
    check(/3 calls and 5 puts at most/.test(await s.page.locator('.eng-rules').first().innerText()) && /at most \$200,000 of premium, whichever comes first \(puts 1 to 100 and \$100,000\)/.test(await s.page.locator('.eng-rules').first().innerText()), 'Fundamentals rules read 3 calls and 5 puts, the premium cap, puts capped at 100 contracts and $100,000');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-now-1440.png'), fullPage: true });
    await sub(s, 'learn');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-learn-1440.png'), fullPage: true });
    // Downside puts (2026-11-20): every tab loads clean, and its learn tab says why it is judged forward.
    await pick(s, 'downside');
    for (const v of ['now', 'record', 'learn', 'history', 'webull']) { await sub(s, v); await settle(s.page, 200); await clean(s, 'downside ' + v); }
    await sub(s, 'now');
    {
      const rules = await s.page.locator('.eng-rules').first().innerText();
      check(/One single put,/.test(rules) && /1 to 100 contracts and at most \$100,000 of premium/.test(rules) && /50% of the \$[\d,]+ budget/.test(rules) && !/buys shares instead/.test(rules), 'Downside rules read puts only, half the risk budget and the put caps (100 contracts, $100,000)');
    }
    await s.page.screenshot({ path: resolve(output, 'downside-now-1440.png'), fullPage: true });
    await pick(s, 'technicals'); await sub(s, 'now');
    {
      // The exit pack (2026-11-27): no share price target on Technicals; time-only options on Reversion.
      const rules = await s.page.locator('.eng-rules').first().innerText();
      check(/with no price target \(a paper test since 27 Nov 2026\)/.test(rules) && !/ATR over it/.test(rules), 'Technicals rules read no share price target');
    }
    await s.page.screenshot({ path: resolve(output, 'technicals-now-1440.png'), fullPage: true });
    await pick(s, 'reversion'); await sub(s, 'now');
    {
      const rules = await s.page.locator('.eng-rules').first().innerText();
      check(/no take-profit, no premium stop, 5 sessions at most/.test(rules) && /held for their sessions with no premium target, no premium stop and no stock levels/.test(rules) && /sized on its whole premium/.test(rules), 'Reversion rules read time-only option exits');
    }
    await pick(s, 'technicals');
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

  // ---- Open picks: every open trade in the Webull paper account ---------------
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'open-picks' });
    await s.page.locator('#open-picks-root .eng-shared-note').waitFor({ timeout: 15000 });
    const note = await s.page.locator('#open-picks-root .eng-shared-note').innerText();
    check(note.includes(fx.flagship.tradeId) && /Top Picks holds the one paper position/.test(note), 'Open picks names the engine trade on the same contract');
    await s.page.locator('#open-picks-engines table').first().waitFor({ timeout: 15000 });
    // Wait for the paper account read to land in the Webull column.
    await s.page.waitForFunction(() => !/loading…/.test((document.querySelector('#open-picks-engines') || {}).innerText || ''), null, { timeout: 15000 });
    const engIds = view.engines.flatMap((e) => e.open.map((t) => t.tradeId));
    const group = s.page.locator('#open-picks-engines');
    const groupText = await group.innerText();
    check(engIds.length > 0 && engIds.every((id) => groupText.includes(id)), 'Open picks lists every open engine trade (' + engIds.length + ')');
    check(new RegExp('Strategy engine trades\\s*' + engIds.length, 'i').test(groupText), 'the engine group head counts them');
    const madeBy = await group.locator('tbody tr td:nth-child(2)').allInnerTexts();
    const names = new Set(view.engines.filter((e) => e.open.length).map((e) => e.name));
    check(madeBy.length >= engIds.length && [...names].every((n) => madeBy.some((m) => m.includes(n))), 'each row says which engine made it');
    const trials = view.engines.flatMap((e) => e.open).filter((t) => t.trial).length;
    if (trials) check((await group.locator('.eng-trial').count()) >= trials, 'paper trials carry their badge');
    // Webull column: filled, held by another and missed rows read from the paper account.
    const wbTexts = await group.locator('tbody tr td:nth-child(6)').allInnerTexts();
    const openRows = fx.mirror.trades.filter((t) => engIds.includes(t.tradeId));
    check(openRows.some((t) => t.fillOutcome === 'filled') && wbTexts.some((x) => /Filled/.test(x)), 'filled engine trades say Filled');
    if (openRows.some((t) => t.fillOutcome === 'shared')) check(wbTexts.some((x) => /Held by another/.test(x)), 'a follower on a shared contract says Held by another');
    if (openRows.some((t) => t.fillOutcome === 'missed')) check(wbTexts.some((x) => /Missed/.test(x)), 'a missed entry says Missed');
    // Expected gain (lib/trade-pop.mjs expectedGain): its own column after Webull.
    const egHead = await group.locator('thead th').allInnerTexts();
    const egTexts = await group.locator('tbody tr:not(.vt-detail) td:nth-child(7)').allInnerTexts();
    check(egHead.some((h) => /Exp\. gain/.test(h)) && egTexts.some((x) => /[+−]\d/.test(x)), 'the engine trades table shows each trade\'s expected gain');
    // Top Picks row: Webull column joined by trade ID, Mark filled from entry and P&L.
    const tp = s.page.locator('#open-picks-root .accuracy-group').first();
    const tpText = await tp.innerText();
    check(/Top Picks trades\s*1/i.test(tpText), 'the Top Picks group is labeled and counted apart');
    if (await tp.locator('table').count()){
      check(/Filled/.test(tpText) && /\+3\.6%/.test(tpText), 'the Top Picks row shows its Webull fill and paper result');
    }
    // Chance of profit (2026-11-22): a Chance column with a Why under each stamped row, and the Owner check.
    const engHead = await group.locator('table').first().locator('thead').innerText();
    check(/Chance/.test(engHead), 'the engine table has a Chance column');
    const stampedOpen = view.engines.flatMap((e) => e.open).filter((t) => t.pop);
    check(stampedOpen.length > 0, 'the fixture opens engine trades with a stated chance (' + stampedOpen.length + ')');
    const chanceCells = await group.locator('table').first().locator('tbody tr:not(.vt-detail) td:nth-child(5)').allInnerTexts();
    check(chanceCells.some((x) => /\d+%/.test(x)), 'engine rows show their chance');
    const why = group.locator('table').first().locator('td:nth-child(5) [data-vt-expand]').first();
    if (await why.count()){
      await why.click(); await settle(s.page, 200);
      const whyText = await group.locator('.vt-detail:not([hidden]) .pop-why').first().innerText();
      check(/Our estimate: \d+%/.test(whyText) && /Market model/.test(whyText) && /Track record/.test(whyText), 'the Why lays out the estimate, the model and the record');
      check(/Expected gain: [+−]?\d/.test(whyText) && /breaks even at a move|Break-even move/.test(whyText), 'the Why lays out the expected gain and its break-even move');
    } else check(false, 'a stamped engine row has a Why button');
    check(await s.page.locator('#open-picks-pop').count() === 1, 'Open picks has the Chance of profit check');
    check(/Chance of profit check/i.test(await s.page.locator('#open-picks-pop summary').innerText()), 'the check is labelled');
    check(/Expected gain check/.test(await s.page.locator('#open-picks-pop').textContent()), 'the check has the expected-gain part');
    // Still working at Webull: the closed engine trade still selling.
    if (exitingWb) check(groupText.includes(exitingWb.tradeId) && /Still working at Webull/i.test(groupText) && /Selling/.test(groupText), 'a trade still selling at Webull after its record closed is listed');
    const sumText = await s.page.locator('#open-picks-sum').innerText();
    const total = 1 + engIds.length + (exitingWb ? 1 : 0);
    check(new RegExp('\\b' + total + '\\b[\\s\\S]*open trades').test(sumText) && /Top Picks · engines/.test(sumText), 'the summary counts every open trade (' + total + ')');
    check(mirrorAsks.some((q) => /scope=all/.test(q)), 'Open picks reads the whole paper account');
    // An engine name links to that engine's page.
    const firstEng = view.engines.find((e) => e.open.length);
    await group.locator('a[href*="tab=engines&engine=' + firstEng.id + '"]').first().click();
    await s.page.locator('#eng-pane').waitFor({ timeout: 15000 });
    check(/tab=engines/.test(s.page.url()) && new RegExp('engine=' + firstEng.id).test(s.page.url()), 'the engine name opens that engine on the Strategy engines page');
    await s.context.close();
  }
  // Open picks in table view (Top Picks row's Mark and Webull cells), and at phone width in dark mode.
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'open-picks' });
    await s.page.locator('#open-picks-engines table').first().waitFor({ timeout: 15000 });
    const tableBtn = s.page.locator('#open-picks-root [data-view-mode="table"], #open-picks-root [data-vmode="table"]').first();
    if (await tableBtn.count()){ await tableBtn.click(); await settle(s.page, 300); }
    await s.page.waitForFunction(() => !/loading…/.test((document.querySelector('#open-picks-root') || {}).innerText || ''), null, { timeout: 15000 });
    const tpTable = s.page.locator('#open-picks-root .accuracy-group').first().locator('table');
    if (await tpTable.count()){
      const head = await tpTable.locator('thead').innerText();
      const row = await tpTable.locator('tbody tr').first().innerText();
      check(/Webull/.test(head) && /Filled/.test(row), 'the Top Picks table has a Webull column');
      check(/Chance/.test(head) && row.includes(Math.round(fx.flagship.pop.p * 100) + '%'), 'the Top Picks table shows the trade\'s chance');
      const pnl = Number(fx.flagship.optionPnlPct), basis = Number(fx.flagship.contract?.netDebit ?? fx.flagship.contract?.mid);
      if (Number.isFinite(pnl) && basis > 0 && fx.flagship.contract?.structure !== 'credit_vertical'){
        const mark = '$' + (Math.round(basis * (1 + pnl / 100) * 100) / 100).toFixed(2);
        check(row.includes(mark), 'the Top Picks Mark cell reads ' + mark);
      }
    }
    await clean(s, 'Open picks, table view');
    await s.page.screenshot({ path: resolve(output, 'open-picks-1440.png'), fullPage: true });
    await s.context.close();
    const p = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'open-picks' });
    await p.page.locator('#open-picks-engines table').first().waitFor({ timeout: 15000 });
    await settle(p.page, 300);
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'Open picks has no sideways page scroll at 390 px (' + overflow + ')');
    // Cards at phone width: the Top Picks card has a Chance of profit line whose Why opens in place.
    const chip = p.page.locator('#open-picks-root .pop-chip').first();
    check(await chip.count() === 1, 'the Top Picks card has a Chance of profit line');
    if (await chip.count()){
      await chip.locator('summary').click(); await settle(p.page, 200);
      const chipText = await chip.innerText();
      check(/Our estimate: \d+%/.test(chipText) && /Similar past Top Picks/.test(chipText), 'the card\'s Why opens with the estimate and the Top Picks record');
    }
    await clean(p, 'Open picks, phone dark');
    await p.page.screenshot({ path: resolve(output, 'open-picks-390-dark.png'), fullPage: true });
    await p.context.close();
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
    if (await s.page.locator('#eng-all-opposite').count()) {
      await s.page.locator('#eng-all-opposite').screenshot({ path: resolve(output, 'opposite-sides-390-dark.png') });
      const wide = await s.page.locator('#eng-all-opposite').evaluate((el) => el.scrollWidth - el.clientWidth);
      check(wide <= 1, 'phone: the opposite-sides section fits its width (' + wide + 'px)');
    }
    await s.page.locator('#eng-all-webull .eng-wb-head + .acc-tscroll').screenshot({ path: resolve(output, 'webull-by-engine-390-dark.png') });
    for (const id of ['technicals', 'macro', 'flow', 'trend', 'momentum']) {
      await pick(s, id);
      for (const v of ['now', 'record', 'learn', 'history', 'webull']) { await sub(s, v); await settle(s.page, 200); await clean(s, id + ' ' + v + ', phone'); }
    }
    await pick(s, 'technicals'); await sub(s, 'now');
    await s.page.screenshot({ path: resolve(output, 'technicals-now-390-dark.png'), fullPage: true });
    await pick(s, 'fundamentals'); await sub(s, 'now'); await settle(s.page, 300);
    await clean(s, 'fundamentals now, phone');
    await s.page.screenshot({ path: resolve(output, 'fundamentals-now-390-dark.png'), fullPage: true });
    await pick(s, 'downside'); await sub(s, 'now'); await settle(s.page, 300);
    await clean(s, 'downside now, phone');
    await s.page.screenshot({ path: resolve(output, 'downside-now-390-dark.png'), fullPage: true });
    await pick(s, 'scorecard'); await settle(s.page, 300);
    await clean(s, 'Scorecard, phone');
    await s.page.screenshot({ path: resolve(output, 'scorecard-390-dark.png'), fullPage: true });
    await pick(s, 'experiments'); await settle(s.page, 300);
    await clean(s, 'Experiments, phone');
    await s.page.screenshot({ path: resolve(output, 'experiments-390-dark.png'), fullPage: true });
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

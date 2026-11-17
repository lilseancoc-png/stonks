// Merged pages ("hubs", site-map.mjs SITE_HUBS) in a real browser, Owner and
// public, desktop and phone (2026-11-17 UI streamline).
//
// Every page in the site map is opened the way a visitor would reach it and
// checked for: the hub title and its page tabs (one marked current), one lit
// sidebar entry per hub with the other pages out of the visible sidebar,
// sibling chips that name the hub once, no page error, no sideways scroll on a
// phone. Public visitors must never see an Owner page, hub tab or tool. Also
// covers the Market risk line, the old Owner Lab Personal tools link, the
// sizing tools on their desks, the palette naming a page's hub, keyboard
// stepping between hub tabs and the Back button.
//
// Run: node scripts/site-hubs-browser.mjs   (no npm script on purpose: a
// package.json change trips verify:risk-cost)
// Screenshots: $QA_OUTPUT or <tmp>/stonks-site-hubs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SITE_SECTIONS, SITE_HUBS } from './render/site-map.mjs';
import { startSiteServer, launchBrowser, openTab, settle } from './browser-harness.mjs';

const out = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-site-hubs');
await mkdir(out, { recursive: true });

const now = Date.now();
const data = {
  'market-analysis.json': { builtAtIso: new Date(now - 3600e3).toISOString(), macroRegime: { state: 'risk-off', fragile: false, axes: {}, inputs: {}, thresholds: {}, drivers: ['VIX up'] } },
  'bottom-tracker.json': { asOf: '2026-11-16', verdict: 'no-drawdown', title: 'No crash in progress', indexes: {}, indicators: [], rule: [], cancels: [] },
  'quant-labs.json': { builtAt: new Date(now - 3600e3).toISOString(), card: { asOf: '2026-11-14', from: '1962-01-31', offHigh: -2.1, fall: [{ id: 'fall10_6m', p: 0.21, base: 0.13, status: 'working' }] } },
  'history-rhymes.json': { now: { stage: { id: 'late', label: 'Late boom, strain showing' }, score: 5, total: 9, signs: [] } },
  'stock-picks.json': {
    builtAtIso: new Date(now - 3600e3).toISOString(), candidates: [],
    dca: { baseUsd: 10, updatedAtIso: new Date(now - 3600e3).toISOString(), history: [], indexes: [
      { symbol: 'VOO', label: 'S&P 500', price: 600, chPct: -1.2, multiplier: 2, points: 3, maxPoints: 8, tier: { key: 'hi', label: 'Lean in', note: 'A real dip.' }, reads: [] },
      { symbol: 'QQQ', label: 'Nasdaq-100', price: 520, chPct: -1.5, multiplier: 1, points: 1, maxPoints: 8, tier: { key: 'base', label: 'Baseline' }, reads: [] },
    ] },
  },
};

let owner = false;
const server = await startSiteServer({ data: (k) => data[k] ?? null, owner: () => owner });
const browser = await launchBrowser();
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// Home has no page header (its hero is the header), so it is not listed.
const pages = SITE_SECTIONS.flatMap((s) => s.items.filter((it) => !it.navHidden && it.id !== 'home').map((it) => ({ ...it, section: s.id })));
const hubLabel = (it) => (it.hub ? SITE_HUBS[it.hub].label : it.label);
const hubPages = (hub, isOwner) => pages.filter((p) => p.hub === hub && (isOwner || !p.owner));
// Sidebar entries in a section for this visitor (a hub counts once; Home too).
const sectionEntries = (sec, isOwner) => new Set(SITE_SECTIONS.find((x) => x.id === sec).items.filter((p) => !p.navHidden && (isOwner || !p.owner)).map((p) => p.hub || p.id)).size;

// Opens a page the way the site does (the sidebar button, which a hub page
// keeps even when it is out of the visible sidebar) and reads its header.
async function visit(page, id) {
  await page.evaluate((tab) => document.querySelector('[data-page-tab="' + tab + '"]').click(), id);
  try {
    await page.waitForFunction((tab) => { const p = document.getElementById('page-pane-' + tab); return p && !p.hidden && p.querySelector('.wf-title'); }, id, { timeout: 8000 });
  } catch (e) {
    const st = await page.evaluate((tab) => { const p = document.getElementById('page-pane-' + tab); return { url: location.href, exists: !!p, hidden: p && p.hidden, head: !!(p && p.querySelector('.wf-title')), open: [...document.querySelectorAll('.page-pane')].filter((x) => !x.hidden).map((x) => x.id) }; }, id);
    throw new Error('page ' + id + ' did not open: ' + JSON.stringify(st));
  }
  await page.waitForTimeout(80);
  return page.evaluate((tab) => {
    const pane = document.getElementById('page-pane-' + tab);
    const row = pane.querySelector('.wf-hub');
    const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
    return {
      url: new URL(location.href).searchParams.get('tab'),
      title: pane.querySelector('.wf-title').textContent,
      rowShown: shown(row),
      tabs: row ? [...row.querySelectorAll('.wf-hub-tab')].map((b) => [b.textContent, b.getAttribute('data-wf-go'), b.getAttribute('aria-current') === 'page']) : [],
      lit: [...document.querySelectorAll('[data-hub-lead].is-hub-on')].map((b) => b.getAttribute('data-hub')),
      membersShown: [...document.querySelectorAll('[data-hub-member]')].filter(shown).map((b) => b.getAttribute('data-page-tab')),
      sibs: [...pane.querySelectorAll('.wf-sib')].map((b) => [b.textContent, b.classList.contains('is-here')]),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, id);
}

function checkHeader(h, it, isOwner, where) {
  ok(h.url === it.id, `${where} ${it.id}: URL names the page (got ${h.url})`);
  ok(h.title === hubLabel(it), `${where} ${it.id}: title "${h.title}" should be "${hubLabel(it)}"`);
  if (it.hub) {
    const want = hubPages(it.hub, isOwner);
    ok(h.rowShown, `${where} ${it.id}: hub tab row shown`);
    assert.deepEqual(h.tabs.map((t) => t[1]), want.map((p) => p.id), `${where} ${it.id}: hub tabs in sidebar order`);
    assert.deepEqual(h.tabs.map((t) => t[0]), want.map((p) => p.label), `${where} ${it.id}: hub tab labels`);
    ok(h.tabs.filter((t) => t[2]).map((t) => t[1]).join() === it.id, `${where} ${it.id}: exactly this page marked current`);
    assert.deepEqual(h.lit, [it.hub], `${where} ${it.id}: its hub's sidebar entry is lit`);
    const here = h.sibs.filter((s) => s[1]);
    if (sectionEntries(it.section, isOwner) > 1) ok(here.length === 1 && here[0][0] === SITE_HUBS[it.hub].label, `${where} ${it.id}: sibling chips mark the hub once`);
    else ok(h.sibs.length === 0, `${where} ${it.id}: a one-entry section shows no sibling chips`);
  } else {
    ok(!h.rowShown, `${where} ${it.id}: no hub row on a single page`);
    assert.deepEqual(h.lit, [], `${where} ${it.id}: no hub lit`);
  }
  assert.deepEqual(h.membersShown, [], `${where} ${it.id}: other hub pages stay out of the visible sidebar`);
  const sibNames = h.sibs.map((s) => s[0]);
  ok(new Set(sibNames).size === sibNames.length, `${where} ${it.id}: no duplicate sibling chips`);
}

try {
  // ---- Every page, Owner and public, desktop ----------------------------------
  for (const isOwner of [true, false]) {
    owner = isOwner;
    const who = isOwner ? 'owner' : 'public';
    const s = await openTab(browser, server.base, { tab: 'home' });
    await settle(s.page, 900);
    const list = pages.filter((p) => isOwner || !p.owner);
    for (const it of list) checkHeader(await visit(s.page, it.id), it, isOwner, who + ' 1440');
    if (!isOwner) {
      const ownerVisible = await s.page.evaluate(() => [...document.querySelectorAll('[data-role-group="owner"]')].some((g) => !g.hidden));
      ok(!ownerVisible, 'public: Owner sidebar groups hidden');
      const ownerTools = await s.page.evaluate(() => [...document.querySelectorAll('.owner-desk-tool, [data-mr-line]')].some((el) => el.offsetParent));
      ok(!ownerTools, 'public: no Owner tool or Market risk line on screen');
    }
    // Back returns to the page before a hub tab click.
    const first = list.find((p) => p.hub);
    const second = hubPages(first.hub, isOwner)[1];
    await visit(s.page, first.id);
    await s.page.click(`#page-pane-${first.id} .wf-hub-tab[data-wf-go="${second.id}"]`);
    await s.page.waitForFunction((t) => !document.getElementById('page-pane-' + t).hidden, second.id);
    await s.page.goBack();
    await s.page.waitForFunction((t) => !document.getElementById('page-pane-' + t).hidden, first.id);
    ok(true, `${who}: Back after a hub tab returns to ${first.id}`);
    // Keyboard: arrows step focus between hub tabs, Enter opens.
    await s.page.focus(`#page-pane-${first.id} .wf-hub-tab[data-wf-go="${first.id}"]`);
    await s.page.keyboard.press('ArrowRight');
    ok(await s.page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-wf-go')) === second.id, `${who}: ArrowRight moves to the next hub tab`);
    await s.page.keyboard.press('Enter');
    await s.page.waitForFunction((t) => !document.getElementById('page-pane-' + t).hidden, second.id);
    ok(true, `${who}: Enter opens the focused hub tab`);
    // A page reached by its hub tab (not its sidebar button) still gets its
    // "Additional view" panels from js/book-views.js (they were missing).
    const BOOK_PAGES = ['heatmap', 'calendar', 'narratives', 'iv-trend', 'oi', 'streaks', 'spillover', 'ma-tracker', 'earnings'];
    // A fresh load each time, so no earlier sidebar click has mounted them.
    for (const it of list.filter((p) => p.hub && BOOK_PAGES.includes(p.id))) {
      const lead = hubPages(it.hub, isOwner)[0];
      if (lead.id === it.id) continue;
      const b = await openTab(browser, server.base, { tab: lead.id });
      await b.page.waitForSelector(`#page-pane-${lead.id} .wf-hub-tab[data-wf-go="${it.id}"]`, { timeout: 8000 });
      await b.page.click(`#page-pane-${lead.id} .wf-hub-tab[data-wf-go="${it.id}"]`);
      try {
        await b.page.waitForFunction((t) => !!document.querySelector('#page-pane-' + t + ' [data-book-panel]'), it.id, { timeout: 5000 });
        ok(true, `${who}: ${it.id} opened by its hub tab shows its Additional view panels`);
      } catch { ok(false, `${who}: ${it.id} opened by its hub tab has no Additional view panel`); }
      await b.context.close();
    }
    assert.deepEqual([...s.errors, ...s.consoleErrors], [], `${who}: no page or console errors`);
    await s.context.close();
  }

  // ---- Phone, dark: every hub page fits and shows its current tab ----------------
  for (const isOwner of [true, false]) {
    owner = isOwner;
    const who = isOwner ? 'owner' : 'public';
    const s = await openTab(browser, server.base, { tab: 'home', width: 390, height: 844, theme: 'dark' });
    await settle(s.page, 900);
    for (const it of pages.filter((p) => p.hub && (isOwner || !p.owner))) {
      const h = await visit(s.page, it.id);
      checkHeader(h, it, isOwner, who + ' 390');
      ok(!h.overflow, `${who} 390 ${it.id}: no sideways scroll`);
      const inView = await s.page.evaluate((tab) => {
        const row = document.querySelector('#page-pane-' + tab + ' .wf-hub'), on = row.querySelector('[aria-current="page"]');
        const a = row.getBoundingClientRect(), b = on.getBoundingClientRect();
        return b.left >= a.left - 1 && b.right <= a.right + 1;
      }, it.id);
      ok(inView, `${who} 390 ${it.id}: current hub tab scrolled into view`);
    }
    await s.page.evaluate(() => document.querySelector('[data-page-tab="whats-changed"]').click());
    await settle(s.page, 300);
    await s.page.screenshot({ path: resolve(out, `${who}-daily-brief-390-dark.png`) });
    assert.deepEqual([...s.errors, ...s.consoleErrors], [], `${who} phone: no page or console errors`);
    await s.context.close();
  }

  // ---- Owner: Market risk line ------------------------------------------------
  owner = true;
  let s = await openTab(browser, server.base, { tab: 'market' });
  await s.page.waitForFunction(() => { const h = document.querySelector('#page-pane-market [data-mr-line]'); return h && !h.hidden && !/Not loaded yet/.test(h.innerText) && h.querySelectorAll('.mr-read').length === 4; }, null, { timeout: 10000 });
  const line = await s.page.evaluate(() => ({
    text: document.querySelector('#page-pane-market [data-mr-line]').innerText,
    strip: (document.querySelector('#market-desk-strip') || {}).innerText || '',
    here: [...document.querySelectorAll('#page-pane-market .mr-read.is-here')].map((b) => b.textContent),
  }));
  ok(/Insufficient data/.test(line.text) && /Insufficient data/.test(line.strip), 'market risk line names the same tape state as the Market analysis strip');
  ok(/No crash in progress/.test(line.text) && /21% \(normal 13%\)/.test(line.text) && /Late boom/.test(line.text), 'market risk line shows the other three reads');
  ok(/disagree/.test(line.text) && /horizon/.test(line.text), 'market risk line explains a disagreement');
  ok(line.here.length === 1 && /Cross-asset tape/.test(line.here[0]), 'the open page is marked in the line');
  await s.page.screenshot({ path: resolve(out, 'owner-market-risk-1440.png') });
  await s.page.click('#page-pane-market .mr-read[data-wf-go="bottom-tracker"]');
  await s.page.waitForFunction(() => !document.getElementById('page-pane-bottom-tracker').hidden && !document.querySelector('#page-pane-bottom-tracker [data-mr-line]').hidden);
  ok(true, 'a read in the line opens its page, which shows the line too');
  assert.deepEqual([...s.errors, ...s.consoleErrors], [], 'market risk: no errors');
  await s.context.close();

  // A read whose file is missing says Unavailable, not "Not loaded yet".
  const saved = data['history-rhymes.json'];
  delete data['history-rhymes.json'];
  s = await openTab(browser, server.base, { tab: 'risk' });
  await s.page.waitForFunction(() => /Unavailable/.test((document.querySelector('#page-pane-risk [data-mr-line]') || {}).innerText || ''), null, { timeout: 10000 });
  ok(true, 'a missing read says Unavailable');
  await s.context.close();
  data['history-rhymes.json'] = saved;

  // ---- Owner: Personal tools moved onto the desks -------------------------------
  s = await openTab(browser, server.base, { tab: 'quant', extra: '&lab=personal' });
  await s.page.waitForFunction(() => !document.getElementById('page-pane-open-picks').hidden, null, { timeout: 8000 });
  ok(new URL(s.page.url()).searchParams.get('tab') === 'open-picks', 'old Personal tools link opens Open picks');
  ok(await s.page.evaluate(() => !!document.querySelector('#page-pane-open-picks #picks-position')), 'position checker sits on Open picks');
  // It still works there: a typed holding is priced from the stock's chain.
  const exp = Math.floor(Date.UTC(new Date().getUTCFullYear() + 1, 0, 16) / 1000);
  data['AAPL.json'] = { symbol: 'AAPL', spot: 200, builtAtIso: new Date(now - 3600e3).toISOString(), expirations: [exp], chains: { [exp]: { c: [{ s: 200, b: 9.8, a: 10.2, l: 10, iv: 0.3, oi: 900, v: 120 }], p: [{ s: 200, b: 8.8, a: 9.2, l: 9, iv: 0.31, oi: 700, v: 80 }] } } };
  await s.page.evaluate(() => { const d = document.getElementById('picks-position'); if (d && d.tagName === 'DETAILS') d.open = true; });
  await s.page.fill('#pos-symbol', 'AAPL');
  await s.page.press('#pos-symbol', 'Enter');
  await s.page.waitForFunction(() => !document.getElementById('pos-expiry').disabled, null, { timeout: 8000 });
  await s.page.fill('#pos-strike', '200');
  await s.page.fill('#pos-entry', '8');
  await s.page.click('#pos-check');
  await s.page.waitForFunction(() => (document.getElementById('pos-result').innerText || '').trim().length > 20, null, { timeout: 8000 });
  const posOut = await s.page.evaluate(() => ({ result: document.getElementById('pos-result').innerText, status: document.getElementById('pos-status').className }));
  ok(!/err/.test(posOut.status) && /AAPL/.test(posOut.result), 'position checker prices a holding on Open picks');
  delete data['AAPL.json'];
  await s.context.close();
  s = await openTab(browser, server.base, { tab: 'quant' });
  await settle(s.page, 600);
  ok(await s.page.evaluate(() => document.getElementById('owner-tab-research').getAttribute('aria-selected') === 'true' && !document.getElementById('owner-panel-research').hidden && !document.getElementById('owner-tab-personal')), 'Owner Lab opens on Research screens');
  assert.deepEqual([...s.errors, ...s.consoleErrors], [], 'Owner Lab: no errors');
  await s.context.close();
  s = await openTab(browser, server.base, { tab: 'stocks' });
  await s.page.waitForFunction(() => /\$20/.test((document.getElementById('owner-dca-root') || {}).innerText || ''), null, { timeout: 8000 });
  const dca = await s.page.evaluate(() => ({ tool: document.getElementById('owner-dca-root').innerText, desk: document.getElementById('stocks-root').innerText }));
  ok(/2× baseline/i.test(dca.tool) && /\$10/.test(dca.tool), 'Stock picks shows your DCA amount with the multiplier');
  ok(!/Daily DCA dial/.test(dca.desk), 'the dial is drawn once on Stock picks');
  await s.page.fill('#stk-dca-base', '25');
  ok(/\$50/.test(await s.page.evaluate(() => document.getElementById('owner-dca-root').innerText)), 'changing the baseline rescales the amounts');
  await s.context.close();
  for (const [tab, id] of [['rotation', 'owner-rotation-root'], ['levetf', 'owner-lev-root']]) {
    s = await openTab(browser, server.base, { tab });
    await s.page.evaluate((p) => { document.getElementById(p).closest('details').open = true; }, id);
    await s.page.waitForFunction((p) => !/^Loading/.test(document.getElementById(p).innerText.trim()), id, { timeout: 8000 });
    ok(true, `${tab}: its sizing tool is drawn on the desk`);
    assert.deepEqual([...s.errors, ...s.consoleErrors], [], `${tab}: no errors`);
    await s.context.close();
  }

  // ---- Palette names the hub ---------------------------------------------------
  owner = false;
  s = await openTab(browser, server.base, { tab: 'home' });
  await settle(s.page, 600);
  await s.page.keyboard.press('Control+k');
  await s.page.waitForSelector('#cmd-palette:not([hidden])');
  await s.page.fill('#cmd-palette-input', 'streaks');
  await s.page.waitForTimeout(250);
  const hits = await s.page.evaluate(() => [...document.querySelectorAll('#cmd-palette-results li')].map((li) => li.innerText.replace(/\s+/g, ' ')));
  ok(hits.some((h) => /Up\/down streaks/.test(h) && /Price signals/.test(h)), 'palette names the hub of a merged page');
  await s.context.close();

  // ---- Public: Owner pages stay closed ---------------------------------------------
  for (const id of ['market', 'stocks', 'quant-labs', 'owner-settings', 'historical-data', 'narratives']) {
    s = await openTab(browser, server.base, { tab: id });
    await settle(s.page, 700);
    ok(new URL(s.page.url()).searchParams.get('tab') !== id && await s.page.evaluate((t) => { const p = document.getElementById('page-pane-' + t); return !p || p.hidden; }, id), `public: ?tab=${id} is closed`);
    await s.context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`site-hubs-browser: ${checks} checks passed (Owner and public, 1440 light and 390 dark). Screenshots in ${out}`);

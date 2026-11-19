// Browser check for the Owner's own desk across the site (wave-1 integration,
// 2026-11-19): Home "Your desk" tiles for the Owner controls (live) and for
// Webull paper fills (the Owner brief's desk block), the stock page's "Your
// controls" section (Watch / Avoid / Lift), the catalyst log as Calendar rows,
// phone width in dark mode, and a public visitor (who sees none of it and
// never asks for the controls). Synthetic data only; the controls action is
// played by the real lib/owner-controls.mjs in memory.
// Run: node scripts/owner-desk-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { applyOwnerControlsRequest, controlsView, accountLimits } from '../lib/owner-controls.mjs';
import { etClock } from '../lib/us-equity-calendar.mjs';

const output = process.env.OWNER_DESK_BROWSER_OUT || resolve(tmpdir(), 'stonks-owner-desk-browser');
await mkdir(output, { recursive: true });
const nowIso = new Date().toISOString();
const today = etClock(Date.now()).date;
const inDays = (n) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let owner = true;
let ctlOn = true;
let doc = applyOwnerControlsRequest(null, { act: 'stop', confirm: true }, { at: nowIso, by: 'Synthetic owner' }).doc;
doc = applyOwnerControlsRequest(doc, { act: 'avoid', sym: 'ADBE' }, { at: nowIso, by: 'Synthetic owner' }).doc;
doc = applyOwnerControlsRequest(doc, { act: 'catalyst', sym: 'ADBE', text: 'Synthetic product event', date: inDays(2) }, { at: nowIso, by: 'Synthetic owner' }).doc;
const limits = accountLimits({});
const posts = [];
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { ok(JSON.parse(s || 'null')); } catch { ok(null); } }); });
const adbe = { symbol: 'ADBE', spot: 400, priceSeries: { t: ['2026-11-13', '2026-11-14'], c: [398, 400] }, fundamentals: {}, technicals: {}, news: {} };
const brief = { version: 1, builtAtIso: nowIso, headline: 'New trades are stopped', changes: [], changesSince: null,
  desk: { controls: null, limitHolds: null, webull: { since: nowIso, days: 7, n: 6, picks: { filled: 3, partial: 1, missed: 1, pending: 0, held: 0, shared: 0, notBought: 0 }, engines: { filled: 1, partial: 0, missed: 0, pending: 0, held: 1, shared: 0, notBought: 0 }, gapPct: { picks: 0.8, engines: null } } } };
const calendar = { builtAtIso: nowIso, windowEnd: inDays(20), events: [{ type: 'earnings', date: inDays(1), symbol: 'MSFT', session: 'AMC' }] };
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => {
    if (key === 'ADBE.json') return adbe;
    if (key === 'calendar.json') return calendar;
    if (!owner) return null;
    if (key === 'owner-market-brief.json') return brief;
    if (key === 'picks-open.json') return { builtAtIso: nowIso, open: [] };
    return null;
  },
  api: async (url, req) => {
    if (url.pathname !== '/api/auth/owner-controls') return undefined;
    if (!owner) return null;
    if (req.method === 'POST') {
      const body = await readBody(req);
      posts.push(body);
      const out = applyOwnerControlsRequest(doc, body, { at: new Date().toISOString(), by: 'Synthetic owner' });
      if (out.changed) doc = out.doc;
      return { ...controlsView(doc, Date.now(), limits), changed: !!out.changed, text: out.text || null };
    }
    return controlsView(doc, Date.now(), limits, { enabled: ctlOn });
  },
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const shot = (s, name) => s.page.screenshot({ path: resolve(output, name + '.png'), fullPage: false });
const asks = () => server.asks.api.filter((a) => a.startsWith('/api/auth/owner-controls')).length;

try {
  await selfTest(browser, server.base);

  // Home, Owner, desktop light: the controls tile and the Webull fills tile.
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'home' });
    await s.page.locator('#landing-desk-tiles [data-go="engines"]').waitFor({ timeout: 15000 });
    await s.page.locator('#landing-desk-tiles [data-acc-pref="webull"]').waitFor({ timeout: 15000 });
    await settle(s.page, 500);
    const oc = await s.page.locator('#landing-desk-tiles [data-go="engines"]').innerText();
    check(/Owner controls/.test(oc) && /New trades stopped/.test(oc) && /exits keep running/.test(oc) && /ADBE/.test(oc), 'Home: the stop tile names the stop and the avoided stock: ' + oc);
    check(await s.page.locator('#landing-desk-tiles [data-go="engines"] .sig-neg').count() === 1, 'Home: the stop reads red');
    const wb = await s.page.locator('#landing-desk-tiles [data-acc-pref="webull"]').innerText();
    check(/Filled at Webull/.test(wb) && /4 of 6/.test(wb) && /Top Picks 3\/5/.test(wb) && /engines 1\/1/.test(wb) && /2 missed or partial/.test(wb), 'Home: the fills tile counts fills: ' + wb);
    const p = await pageProblems(s);
    check(p.length === 0, 'Home owner desktop: ' + p.join(' | '));
    await s.page.locator('#landing-desk').screenshot({ path: resolve(output, 'home-desk-1440-light.png') });
    await s.context.close();
  }

  // Stock page, Owner: "Your controls" shows the avoid and the catalyst; Watch posts.
  {
    const s = await openTab(browser, server.base, { width: 1280, height: 1000, theme: 'light', tab: 'stock', extra: '&s=ADBE' });
    s.page.on('dialog', (d) => d.accept());
    await s.page.locator('#stp-oc:not([hidden])').waitFor({ timeout: 15000 });
    const t = await s.page.locator('#stp-oc').innerText();
    check(/Your controls/.test(t) && /New trades are stopped/.test(t) && /Avoided/.test(t) && /Synthetic product event/.test(t), 'stock page: the section lists what is set: ' + t);
    check(await s.page.locator('#stp-oc [data-oc-act="lift"]').count() === 1 && await s.page.locator('#stp-oc [data-oc-act="avoid-stock"]').count() === 0, 'stock page: an avoided stock offers Lift, not Avoid');
    const before = posts.length;
    await s.page.locator('#stp-oc [data-oc-act="watch"]').click();
    await s.page.waitForFunction(() => /Watched closely/.test(document.querySelector('#stp-oc')?.innerText || ''), null, { timeout: 10000 });
    check(posts.length === before + 1 && posts[posts.length - 1].act === 'watch' && posts[posts.length - 1].sym === 'ADBE', 'stock page: Watch closely saves one watch');
    check(await s.page.locator('#stp-oc [data-oc-act="unwatch"]').count() === 1, 'stock page: the button turns into Stop watching');
    await s.page.locator('#stp-oc [data-oc-act="lift"]').click();
    await s.page.waitForFunction(() => document.querySelector('#stp-oc [data-oc-act="avoid-stock"]'), null, { timeout: 10000 });
    check(posts[posts.length - 1].act === 'lift', 'stock page: Lift avoid saves');
    await s.page.locator('#stp-oc [data-oc-act="avoid-stock"]').click();
    await s.page.waitForFunction(() => document.querySelector('#stp-oc [data-oc-act="lift"]'), null, { timeout: 10000 });
    check(posts[posts.length - 1].act === 'avoid' && posts[posts.length - 1].close === undefined, 'stock page: Avoid (after the confirm box) never closes trades from here');
    const p = (await pageProblems(s)).filter((x) => !/console error/.test(x));
    check(p.length === 0, 'stock page owner: ' + p.join(' | '));
    await s.page.locator('#stp-oc').screenshot({ path: resolve(output, 'stock-controls-1280-light.png') });
    await s.context.close();
  }

  // Calendar, Owner: the catalyst log shows as a row.
  {
    const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'calendar' });
    await s.page.waitForFunction(() => /Synthetic product event/.test(document.querySelector('#calendar-root')?.innerText || ''), null, { timeout: 15000 });
    const t = await s.page.locator('#calendar-root').innerText();
    check(/Your flag/i.test(t) && /MSFT/.test(t), 'Calendar: the Owner catalyst sits beside the public events: ' + t.slice(0, 1500));
    const p = (await pageProblems(s)).filter((x) => !/console error/.test(x));
    check(p.length === 0, 'Calendar owner: ' + p.join(' | '));
    await shot(s, 'calendar-1440-light');
    await s.context.close();
  }

  // Phone, dark: Home tiles and the stock section fit.
  {
    const s = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'home' });
    await s.page.locator('#landing-desk-tiles [data-go="engines"]').waitFor({ timeout: 15000 });
    await settle(s.page, 500);
    const p = await pageProblems(s);
    check(p.length === 0, 'Home phone dark: ' + p.join(' | '));
    await s.page.locator('#landing-desk').screenshot({ path: resolve(output, 'home-desk-390-dark.png') });
    await s.context.close();
    const t = await openTab(browser, server.base, { width: 390, height: 844, theme: 'dark', tab: 'stock', extra: '&s=ADBE' });
    await t.page.locator('#stp-oc:not([hidden])').waitFor({ timeout: 15000 });
    await settle(t.page, 400);
    // The page clips sideways overflow, so measure the section's own children.
    const inside = await t.page.evaluate(() => { const box = document.querySelector('#stp-oc').getBoundingClientRect(); return [...document.querySelectorAll('#stp-oc > *')].every((el) => el.getBoundingClientRect().right <= box.right + 1); });
    check(inside, 'stock page phone dark: the controls section fits its column');
    const q = (await pageProblems(t)).filter((x) => !/console error/.test(x));
    check(q.length === 0, 'stock page phone dark: ' + q.join(' | '));
    await t.page.locator('#stp-oc').screenshot({ path: resolve(output, 'stock-controls-390-dark.png') });
    await t.context.close();
  }

  // Kill switch off in Owner Settings: the stock section says so and shows no
  // saved control as if it applied; Home drops the controls tile.
  {
    ctlOn = false;
    const s = await openTab(browser, server.base, { width: 1280, height: 1000, theme: 'light', tab: 'stock', extra: '&s=ADBE' });
    await s.page.locator('#stp-oc:not([hidden])').waitFor({ timeout: 15000 });
    const t = await s.page.locator('#stp-oc').innerText();
    check(/Owner controls are off/.test(t) && !/New trades are stopped|Avoided|Synthetic product event/.test(t), 'kill switch off: the stock section shows nothing as in force: ' + t);
    await s.context.close();
    const h = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'home' });
    await h.page.locator('#landing-desk-tiles [data-acc-pref="webull"]').waitFor({ timeout: 15000 });
    await settle(h.page, 800);
    check(await h.page.locator('#landing-desk-tiles [data-go="engines"]').count() === 0, 'kill switch off: no Owner controls tile on Home');
    await h.context.close();
    ctlOn = true;
  }

  // Public visitor: no section, no tile, no Owner row, no request for the controls.
  {
    owner = false;
    const before = asks();
    const s = await openTab(browser, server.base, { width: 1280, height: 1000, theme: 'light', tab: 'stock', extra: '&s=ADBE' });
    await settle(s.page, 1500);
    check(await s.page.locator('#stp-oc').count() === 0, 'public: no controls section on the stock page');
    await s.context.close();
    const c = await openTab(browser, server.base, { width: 1280, height: 1000, theme: 'light', tab: 'calendar' });
    await c.page.waitForFunction(() => /MSFT/.test(document.querySelector('#calendar-root')?.innerText || ''), null, { timeout: 15000 });
    check(!/Synthetic product event|Your flag/i.test(await c.page.locator('#calendar-root').innerText()), 'public: no Owner catalyst on the Calendar');
    await c.context.close();
    check(asks() === before, 'public: the controls are never requested');
  }
  console.log(`${checks} owner desk browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}

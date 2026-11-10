// Browser check for the Owner Settings page (Owner · Admin → Settings): tabs
// and changed counts, search and the filters, folding sections, the red
// "Big impact" warnings and their "are you sure" box (cancel, Escape, confirm,
// undo, reset all), number checks, Display settings for this device and the
// start page. Runs at 1440 and 390, light and dark, against the committed
// index.html / app.js / styles.css with an in-memory settings store; no
// production store, provider or account is contacted.
// Run: node scripts/owner-settings-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/owner-settings.mjs';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.OWNER_SETTINGS_BROWSER_OUT || resolve(tmpdir(), 'stonks-owner-settings-browser');
await mkdir(output, { recursive: true });

let doc = null;
let posts = [];
const applied = { applied: {}, pinned: ['AI_THESIS'], skipped: [], builtAtIso: '2026-11-10T16:00:00Z', settingsUpdatedAt: null };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/api/auth/me') return json({ enabled: true, authed: true, authenticated: true, trackRecord: true, topPicks: true, user: { name: 'Owner' } });
  if (url.pathname === '/api/auth/owner-settings') {
    if (req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b); posts.push(body);
      const out = S.applyOwnerSettingsRequest(doc, body, { by: 'Owner' });
      if (out.error) return json({ error: out.error, ...(out.needsConfirm ? { needsConfirm: true } : {}) }, 400);
      doc = out.doc;
    }
    return json(S.ownerSettingsView(doc, { applied, env: { WEBULL_MIRROR: 'on', MCP_PUBLIC_ACCESS: '' } }));
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return json({});
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = resolve(root, '.' + decodeURIComponent(p));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); return res.end(); }
  try { const c = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(c); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [], fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

try {
  for (const [w, h, scheme] of [[1440, 900, 'light'], [1440, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    doc = null; posts = [];
    const tag = `${w}-${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const page = await ctx.newPage();
    let nativeDialogs = 0;
    page.on('pageerror', (e) => errors.push(tag + ': ' + e));
    page.on('dialog', (d) => { nativeDialogs++; d.dismiss(); });
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' })));
    await page.goto(base + '/?tab=owner-settings');
    await page.waitForSelector('[data-os-tab]', { timeout: 20000 });
    const tabs = await page.$$eval('[data-os-tab]', (l) => l.map((b) => b.getAttribute('data-os-tab')));
    check(tabs.join('|') === [...S.OWNER_SETTINGS_TABS, 'Display', 'History'].join('|'), tag + ' tabs ' + tabs.join('|'));
    check(!(await page.$('#os-MCP_ENABLED')), tag + ' other tabs hidden');

    // Big-impact rows: red tag, red bold warning, red edge.
    const high = S.OWNER_SETTINGS.filter((d) => d.tab === 'Top Picks' && d.impact === 'high').map((d) => d.key);
    for (const k of high) check(await page.isVisible(`[data-os-row="${k}"] .os-impact strong`), `${tag} ${k} shows its warning`);
    check(!(await page.$('[data-os-row="PICKS_WATCH_COUNT"] .os-impact')), tag + ' small settings carry no warning');
    const red = await page.$eval('[data-os-row="PICKS_EDGE_GATE"] .os-impact', (el) => { const c = getComputedStyle(el); const s = getComputedStyle(el.querySelector('strong')); return { color: c.color, weight: Number(s.fontWeight) }; });
    const [r, g, b] = red.color.match(/\d+/g).map(Number);
    check(r > 180 && r > g + 60 && r > b + 60 && red.weight >= 700, `${tag} warning is bold red (${red.color}, ${red.weight})`);

    // A small number saves straight away; out-of-range is refused in the page.
    await page.fill('#os-PICKS_WATCH_COUNT', '11'); await page.click('[data-os-save="PICKS_WATCH_COUNT"]');
    check(/between 0 and 10/.test(await page.textContent('#owner-settings-root')), tag + ' out of range refused');
    await page.fill('#os-PICKS_WATCH_COUNT', '4'); await page.click('[data-os-save="PICKS_WATCH_COUNT"]');
    await page.waitForSelector('[data-os-row="PICKS_WATCH_COUNT"] .os-tag-changed');
    check(!(await page.$('[data-os-ask-back]')), tag + ' small change asks nothing');

    // Big-impact switch: the box opens, Cancel keeps the old value and saves nothing.
    const before = posts.length;
    await page.click('#os-PICKS_EDGE_GATE');
    await page.waitForSelector('[role=alertdialog]');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'os-ask-no'), tag + ' Cancel has focus');
    check(/Are you sure/.test(await page.textContent('[role=alertdialog]')) && await page.isVisible('[role=alertdialog] .os-impact strong'), tag + ' box shows the red warning');
    await page.click('[data-os-ask-no]');
    check(!(await page.$('[data-os-ask-back]')) && posts.length === before && await page.isChecked('#os-PICKS_EDGE_GATE'), tag + ' cancel saves nothing');
    // Escape closes it too.
    await page.click('#os-PICKS_EDGE_GATE'); await page.waitForSelector('[role=alertdialog]');
    await page.keyboard.press('Escape');
    check(!(await page.$('[data-os-ask-back]')) && posts.length === before, tag + ' Escape cancels');
    // Confirm saves with confirm: true.
    await page.click('#os-PICKS_EDGE_GATE'); await page.waitForSelector('[role=alertdialog]');
    check(await page.$eval('[data-os-ask-yes]', (b) => b.classList.contains('os-danger')), tag + ' red confirm button');
    await page.click('[data-os-ask-yes]');
    await page.waitForSelector('[data-os-row="PICKS_EDGE_GATE"] .os-tag-changed');
    check(posts.at(-1).confirm === true && doc.values.PICKS_EDGE_GATE === false, tag + ' confirmed change saved');
    check(/2/.test(await page.textContent('[data-os-tab="Top Picks"] .os-count')), tag + ' changed count badge');

    // Undo of a big-impact change asks too.
    await page.click('[data-os-undo]'); await page.waitForSelector('[role=alertdialog]');
    check(/Watch|Raise the bar/.test(await page.textContent('[role=alertdialog]')), tag + ' undo lists its change');
    await page.click('[data-os-ask-no]');
    check(doc.values.PICKS_EDGE_GATE === false, tag + ' undo cancelled');

    // A page that doesn't know a setting is big impact still gets the box
    // when the server asks for it.
    const asked = await page.evaluate(async () => (await fetch('/api/auth/owner-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ act: 'set', values: { PICKS_MACRO_REGIME: false } }) })).json());
    check(asked.needsConfirm === true, tag + ' server refuses without confirm');
    // Market tape + Live site.
    await page.click('[data-os-tab="Market tape"]');
    await page.click('#os-PICKS_MACRO_NEWS');
    await page.waitForFunction(() => !document.querySelector('#os-PICKS_MACRO_NEWS').checked && !document.querySelector('#os-PICKS_MACRO_NEWS').disabled);
    await page.focus('[data-os-tab="Market tape"]'); await page.keyboard.press(w < 800 ? 'ArrowRight' : 'ArrowDown');
    check(await page.$eval('[data-os-tab="AI & cost"]', (b) => b.getAttribute('aria-selected') === 'true'), tag + ' arrow key moves tab');
    await page.click('[data-os-tab="Live site"]');
    check(/Off in Vercel/.test(await page.textContent('[data-os-row="MCP_PUBLIC_ACCESS"]')), tag + ' public MCP shows Vercel off');
    await page.click('#os-MCP_ENABLED'); await page.waitForSelector('[role=alertdialog]');
    check(/disconnects ChatGPT/.test(await page.textContent('[role=alertdialog]')), tag + ' MCP box explains');
    await page.click('[data-os-ask-no]');
    check(await page.isChecked('#os-MCP_ENABLED'), tag + ' MCP still on after cancel');
    await page.click('#os-MCP_ENABLED'); await page.waitForSelector('[role=alertdialog]');
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    check(!(await page.$('#os-ask-host')) && doc.values.MCP_ENABLED === undefined, tag + ' Back closes the box unsaved');
    check(await page.evaluate(() => document.querySelector('.os-ask-back') === null), tag + ' box removed from the page');

    // Search + filters.
    await page.click('#os-search'); await page.keyboard.type('borrow');
    check(await page.isVisible('[data-os-row="CROWD_BORROW"]'), tag + ' search finds borrow fees');
    const n = (await page.$$('[data-os-row]')).length;
    check(n >= 1 && n <= 4, tag + ' search narrows ' + n);
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'os-search'), tag + ' search keeps focus');
    await page.click('[data-os-clear]');
    await page.check('#os-changed-only');
    const rows = await page.$$eval('[data-os-row]', (l) => l.map((r) => r.getAttribute('data-os-row')).sort());
    check(rows.join(',') === 'PICKS_EDGE_GATE,PICKS_MACRO_NEWS,PICKS_WATCH_COUNT', tag + ' changed only ' + rows.join(','));
    await page.uncheck('#os-changed-only');
    await page.check('#os-high-only');
    const hi = await page.$$eval('[data-os-row]', (l) => l.map((r) => r.getAttribute('data-os-row')));
    check(hi.length === S.OWNER_SETTINGS.filter((d) => d.impact === 'high').length && hi.every((k) => S.ownerSettingDef(k)?.impact === 'high'), tag + ' big impact only ' + hi.length);
    await page.uncheck('#os-high-only');

    // Folds stay shut across a save.
    await page.click('[data-os-tab="Top Picks"]');
    await page.click('[data-os-fold="Events"] > summary');
    check(!(await page.$eval('[data-os-fold="Events"]', (d) => d.open)), tag + ' fold closes');
    await page.click('#os-PICKS_STRATEGY_AUTO'); await page.waitForSelector('[role=alertdialog]'); await page.click('[data-os-ask-no]');
    check(!(await page.$eval('[data-os-fold="Events"]', (d) => d.open)), tag + ' fold stays shut');

    // Reset all asks, lists what changes, and runs.
    await page.click('[data-os-resetall]'); await page.waitForSelector('[role=alertdialog]');
    const items = await page.$$eval('.os-ask-list li', (l) => l.length);
    check(items === 3, tag + ' reset all lists ' + items);
    await page.click('[data-os-ask-yes]');
    await page.waitForFunction(() => !document.querySelector('[data-os-ask-back]') && !document.querySelector('.os-tag-changed'));
    check(Object.keys(doc.values).length === 0, tag + ' reset all ran');

    // Display tab.
    await page.click('[data-os-tab="Display"]');
    await page.selectOption('#os-display-text', 'large');
    check(await page.evaluate(() => document.documentElement.getAttribute('data-text-size')) === 'large', tag + ' text size applied');
    await page.selectOption('#os-display-density', 'compact');
    await page.selectOption('#os-display-motion', 'reduce');
    check(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')), tag + ' reduce motion applied');
    const flip = scheme === 'dark' ? 'light' : 'dark';
    await page.selectOption('#os-display-theme', flip);
    check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === flip, tag + ' theme applied');
    await page.selectOption('#os-display-start', 'open-picks');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, tag + ' overflow ' + overflow);
    const raw = await page.textContent('#owner-settings-root'); check(!/undefined|NaN|\[object/.test(raw), tag + ' raw text');
    await page.click('[data-os-tab="Top Picks"]');
    await page.click('#os-PICKS_EDGE_GATE'); await page.waitForSelector('[role=alertdialog]');
    const box = await page.$eval('.os-ask', (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    check(box.l >= 0 && box.r <= w && box.t >= 0 && box.b <= h, tag + ' box fits the screen');
    await page.screenshot({ path: resolve(output, `confirm-${tag}.png`) });
    await page.click('[data-os-ask-no]');
    await page.locator('#owner-settings-section').screenshot({ path: resolve(output, `section-${tag}.png`) });

    await page.goto(base + '/');
    await page.waitForFunction(() => /tab=open-picks/.test(location.search), null, { timeout: 8000 }).catch(() => {});
    check(/tab=open-picks/.test(await page.evaluate(() => location.search)), tag + ' start page used');
    check(await page.evaluate(() => document.documentElement.getAttribute('data-text-size')) === 'large', tag + ' text size kept after reload');
    await page.goto(base + '/?tab=owner-settings');
    await page.waitForSelector('[data-os-tab="Top Picks"].is-on', { timeout: 10000 }).catch(() => fails.push(tag + ' remembered tab'));
    await page.click('[data-os-tab="Display"]');
    await page.click('[data-os-display-reset]');
    check(await page.evaluate(() => !document.documentElement.getAttribute('data-text-size') && !localStorage.getItem('stonks-display-v1') && !localStorage.getItem('stonks-theme')), tag + ' display reset');
    await page.click('[data-os-tab="History"]'); check((await page.$$('.os-history li')).length >= 4, tag + ' history tab');
    check(nativeDialogs === 0, tag + ' no native browser dialogs');
    await ctx.close();
  }
  // An older copy of the page with no impact marks: the server's refusal
  // opens the box, and confirming saves.
  {
    doc = null; posts = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('stale: ' + e));
    await page.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.fulfill({ body: '' });
      if (u.pathname !== '/api/auth/owner-settings') return route.continue();
      const resp = await route.fetch(); const j = await resp.json();
      if (Array.isArray(j.settings)) j.settings = j.settings.map(({ confirm, impact, warn, ...x }) => x);
      return route.fulfill({ response: resp, json: j });
    });
    await page.goto(base + '/?tab=owner-settings');
    await page.waitForSelector('#os-PICKS_EDGE_GATE', { timeout: 20000 });
    await page.click('#os-PICKS_EDGE_GATE');
    await page.waitForSelector('[role=alertdialog]', { timeout: 8000 }).catch(() => {});
    check(/Raise the bar after losses has a big impact/.test(await page.textContent('body')), 'stale page: server refusal opens the box');
    await page.click('[data-os-ask-yes]').catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[data-os-ask-back]'), null, { timeout: 8000 }).catch(() => {});
    check(doc && doc.values.PICKS_EDGE_GATE === false && posts.at(-1).confirm === true, 'stale page: confirmed save works');
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
assert.deepEqual(errors, [], 'page errors:\n' + errors.join('\n'));
assert.deepEqual(fails, [], 'failed:\n' + fails.join('\n'));
console.log(`owner settings browser passed (${checks} checks; screenshots in ${output})`);

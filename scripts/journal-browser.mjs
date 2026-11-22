// Browser checks for the Owner intuition journal, end to end against the real
// api/auth handler (in-memory store): the panel opens on the right and the page
// shrinks beside it, stays open while moving between pages, logs a value, a
// table row and a chart point with their page and as-of time, snaps a picture
// of a card, saves an entry stamped with the full date and time, edits it
// (keeping the earlier text), marks a result, shows the other owner's entries
// without Edit / Delete, opens a ?journal= link, works as a sheet on a phone,
// and stays invisible to a public visitor. No live quotes or paid services.
// Requires Playwright and its Chromium browser.
// Run: node scripts/journal-browser.mjs   (QA_OUTPUT=dir keeps screenshots)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PRIVATE_DATA_ENABLED = '1';
process.env.SESSION_SECRET = 'journal-browser-secret-0123456789';
delete process.env.JOURNAL_ENABLED;
const root = fileURLToPath(new URL('../', import.meta.url));
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;
const out = process.env.QA_OUTPUT || '/tmp/stonks-journal';
await mkdir(out, { recursive: true });

const { store } = await import('../lib/datastore.mjs');
const J = await import('../lib/intuition-journal.mjs');
const { default: authHandler } = await import('../api/auth/[action].js');
const { SESSION_COOKIE, signSession } = await import('../lib/session.mjs');
const mem = new Map();
store.rawGet = async (k) => (mem.has(k) ? Buffer.from(mem.get(k)) : null);
store.rawPut = async (k, v) => { mem.set(k, Buffer.isBuffer(v) ? Buffer.from(v) : Buffer.from(String(v))); };
store.rawDel = async (k) => { mem.delete(k); };
store.get = async () => null;
Object.defineProperty(store, 'backend', { value: 'memory', configurable: true });
const cookies = {
  MiniMe: `${SESSION_COOKIE}=${await signSession({ sub: '111', name: 'MiniMe', tr: true, tp: true })}`,
  LilSean: `${SESSION_COOKIE}=${await signSession({ sub: '222', name: 'LilSean', tr: true, tp: true })}`,
};

const now = new Date().toISOString();
const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'JPM', 'META', 'AMZN'];
const heat = symbols.map((t, i) => ({ t, s: 'Technology', i: 'QA', sp: 100 + i, mc: (10 - i) * 1e9, ch: i - 4 }));
const picks = symbols.map((symbol, i) => ({
  symbol, side: i % 4 === 3 ? 'put' : 'call', sector: 'Technology', total: 9 - i * 0.5, score: 9 - i * 0.5, conviction: 'High',
  group: i < 6 ? 'actionable' : 'watch', entry: { now: i < 6 }, spot: 100 + i, entryDate: now,
  recommendation: { tier: 'strong-call', label: 'Strong Call' },
  pillars: { fundamentals: { score: 1.5, signals: [] }, technicals: { score: 2, signals: [] }, mechanicals: { score: 0.5, signals: [] }, narrative: { score: 1, signals: [] } },
  contract: { structure: 'long', strike: 100 + i, expiry: Date.now() / 1000 + 40 * 86400, expiryLabel: "Dec 18 '26", dte: 40, mid: 2 + i, maxLoss: 200, iv: 0.4, delta: 0.5, oi: 1000, pop: 0.5, breakevenMovePct: 3 },
}));
const fixtures = {
  'heatmap.json': { tickers: heat, builtAtIso: now },
  'picks.json': { picks, builtAtIso: now },
  'picks-open.json': { open: [], closed: [], builtAtIso: now },
};
let who = 'MiniMe';
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push({ who, path: url.pathname + url.search });
  const json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  const owner = who !== 'public';
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json(owner ? { enabled: true, authed: true, member: true, trackRecord: true, topPicks: true, role: 'owner', name: who } : { enabled: true, authed: false, member: false });
  if (url.pathname === '/api/auth/top-picks') return owner ? json(fixtures['picks.json']) : json({ error: 'auth required' }, 401);
  if (url.pathname === '/api/auth/journal' || url.pathname === '/api/auth/journal-shot') {
    let body;
    if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; } }
    const headers = { ...req.headers, 'x-forwarded-proto': 'http', ...(owner ? { cookie: cookies[who] } : {}) };
    const r = { statusCode: 200, headers: {}, setHeader(n, v) { this.headers[n] = v; }, status(c) { this.statusCode = c; return this; },
      json(v) { res.statusCode = this.statusCode; for (const [k, v2] of Object.entries(this.headers)) res.setHeader(k, v2); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); },
      end(v) { res.statusCode = this.statusCode; for (const [k, v2] of Object.entries(this.headers)) res.setHeader(k, v2); res.end(v); } };
    return authHandler({ query: { action: url.pathname.slice('/api/auth/'.length), ...Object.fromEntries(url.searchParams) }, method: req.method, headers, body }, r);
  }
  if (url.pathname === '/api/macro-live') return json({ legs: { spy: { value: 671.25 }, qqq: { value: 602.5 }, vix: { value: 17.1 }, tenY: { value: 4.12 }, dxy: { value: 99.4 }, crude: { value: 61.2 }, gold: { value: 4050 } } });
  if (url.pathname === '/api/quotes') {
    const syms = String(url.searchParams.get('symbols') || '').split(',').filter(Boolean);
    return json({ quotes: syms.map((s) => ({ symbol: s, spot: s === 'NVDA' ? 190 : 600 })) });
  }
  const name = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
  if (name) return name in fixtures ? json(fixtures[name]) : json({}, 404);
  if (url.pathname.startsWith('/api/')) return json({ quotes: [], items: [], entries: [] });
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

async function newPage(width, { dark = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'], deviceScaleFactor: 1, hasTouch: width < 700, isMobile: width < 700 });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  if (process.env.JR_DEBUG) page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
  return { context, page };
}
// Put a table and a chart with hover points into the open page, so a row and
// a chart point can be picked the same way as anywhere on the site.
async function addSamples(page, tab) {
  await page.evaluate((tab) => {
    const pane = document.getElementById('page-pane-' + tab);
    const card = document.createElement('section');
    card.className = 'card'; card.id = 'jr-sample';
    card.innerHTML = '<header class="card-header"><h2 class="card-title">Sample flow table</h2></header><p class="hint">Updated Nov 21, 2026 4:05 PM ET</p>' +
      '<table><thead><tr><th>Ticker</th><th>Premium</th><th>Side</th></tr></thead><tbody><tr id="jr-row"><td>NVDA</td><td>$4.2M</td><td>Calls</td></tr></tbody></table>' +
      '<h3>Sample chart</h3><svg id="jr-chart" viewBox="0 0 200 100" width="300" height="150" data-ch=\'[[20,80,"Nov 18\\nSPY 660.10"],[100,50,"Nov 19\\nSPY 668.40"],[180,20,"Nov 20\\nSPY 671.25"]]\'><polyline points="20,80 100,50 180,20" fill="none" stroke="currentColor"/></svg>';
    pane.prepend(card);
  }, tab);
}

try {
  // ---------------- Desktop, MiniMe ----------------
  {
    const { context, page } = await newPage(1366);
    await page.goto(base + '/?tab=picks');
    await page.locator('#picks-grid .pick-tab-card').first().waitFor();
    await page.locator('#journal-toggle').waitFor({ state: 'visible' });
    const before = await page.locator('#main-content').boundingBox();
    await page.click('#journal-toggle');
    await page.locator('#journal-panel [data-jr-text]').waitFor();
    const panel = await page.locator('#journal-panel').boundingBox();
    const after = await page.locator('#main-content').boundingBox();
    assert.ok(Math.abs(panel.x + panel.width - 1366) <= 1 && panel.width >= 400, 'the panel sits on the right');
    assert.ok(after.x + after.width <= panel.x + 1 && after.width < before.width, 'the page shrinks beside it (split view)');
    assert.equal(await page.getAttribute('#journal-toggle', 'aria-expanded'), 'true');
    assert.match(await page.textContent('[data-jr-now]'), /20\d\d/, 'the live stamp shows the year');
    const headerOver = async () => page.evaluate(() => {
      const edge = document.getElementById('journal-panel').getBoundingClientRect().left;
      return [...document.querySelectorAll('.site-header button, .site-header a, .site-header select')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.workspace-settings-panel'); })
        .filter((el) => el.getBoundingClientRect().right > edge + 1).map((el) => el.id || el.className);
    });
    assert.deepEqual(await headerOver(), [], 'no header button slides under the panel');
    await page.setViewportSize({ width: 1024, height: 900 });
    assert.deepEqual(await headerOver(), [], 'no header button slides under the panel at 1024 wide');
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.fill('[data-jr-text]', 'Calling it now: the market peaks after the OpenAI and Anthropic IPOs.\nNVDA leads into it.');
    await page.click('.jr-call summary');
    await page.fill('[data-jr-call="subject"]', 'nvda');
    await page.click('[data-jr-dir="up"]');
    await page.fill('[data-jr-call="target"]', '250');
    await page.fill('[data-jr-call="by"]', '2027-06-30');
    await page.selectOption('[data-jr-call="confidence"]', '4');
    await page.fill('[data-jr-tags]', 'ai, ipo');

    // Value from a pick card.
    await page.click('[data-jr-pick="data"]');
    assert.ok(await page.evaluate(() => document.body.classList.contains('jr-picking')));
    const card = page.locator('#picks-grid .pick-tab-card').first();
    const pageBefore = await page.evaluate(() => location.search + '|' + document.getElementById('picks-detail-card').innerHTML.length);
    await card.hover();
    await page.locator('.jr-hl:not([hidden])').waitFor();
    await card.click();
    await page.locator('.jr-ev-item').first().waitFor();
    let ev = await page.locator('.jr-ev-item').first().textContent();
    assert.match(ev, /Top picks/i, 'the page is named');
    assert.match(ev, /AAPL/, 'the value is logged');
    assert.match(ev, /site data built|as of|updated/i, 'with an as-of time');
    assert.equal(await page.evaluate(() => document.body.classList.contains('jr-picking')), false, 'pick mode ends after a pick');
    assert.equal(await page.evaluate(() => location.search + '|' + document.getElementById('picks-detail-card').innerHTML.length), pageBefore, 'the click did not open the pick');

    // A table row (with its column names) and a chart point.
    await addSamples(page, 'picks');
    await page.click('[data-jr-pick="data"]');
    await page.locator('#jr-row td').nth(1).click();
    ev = await page.locator('.jr-ev-item').nth(1).textContent();
    assert.match(ev, /Ticker: NVDA · Premium: \$4\.2M · Side: Calls/, 'a row is logged with its column names');
    assert.match(ev, /Sample flow table/);
    assert.match(ev, /Updated Nov 21, 2026 4:05 PM ET/, 'the as-of line of the card is used');
    await page.click('[data-jr-pick="data"]');
    const chart = await page.locator('#jr-chart').boundingBox();
    await page.mouse.move(chart.x + chart.width * 0.9, chart.y + chart.height * 0.3);
    await page.locator('.ch-tip').waitFor({ state: 'visible' });
    await page.mouse.click(chart.x + chart.width * 0.9, chart.y + chart.height * 0.3);
    ev = await page.locator('.jr-ev-item').nth(2).textContent();
    assert.match(ev, /Nov 20 · SPY 671\.25/, 'a chart point is logged from its hover label');
    assert.match(ev, /Sample chart/);

    // Keyboard: Esc stops pick mode without logging.
    await page.click('[data-jr-pick="data"]');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.jr-pickbar').count(), 0);
    assert.equal(await page.locator('.jr-ev-item').count(), 3);

    // A picture of a card.
    await page.click('[data-jr-pick="shot"]');
    await page.locator('#jr-sample').hover({ position: { x: 20, y: 10 } });
    await page.locator('#jr-sample').click({ position: { x: 20, y: 10 } });
    await page.locator('.jr-ev-shot img').waitFor();
    assert.equal([...mem.keys()].filter((k) => k.startsWith(J.SHOT_PREFIX)).length, 1, 'the picture is uploaded');
    await shot(page, 'desktop-write');

    // Move to another page: the panel and the draft stay.
    await page.click('#page-tab-home');
    await page.waitForFunction(() => !document.getElementById('page-pane-home').hidden);
    assert.ok(await page.isVisible('#journal-panel'), 'the panel follows across pages');
    assert.match(await page.inputValue('[data-jr-text]'), /peaks after/);
    await page.click('[data-jr-pick="data"]');
    await page.locator('#page-pane-home h2, #page-pane-home h1').first().click();
    assert.equal(await page.locator('.jr-ev-item').count(), 5);
    assert.match(await page.locator('.jr-ev-item').nth(4).textContent(), /Home/);
    await page.locator('.jr-ev-x').nth(4).click();
    assert.equal(await page.locator('.jr-ev-item').count(), 4, 'evidence can be removed');

    // Save.
    await page.click('[data-jr-save]');
    await page.locator('.jr-msg.is-ok').waitFor();
    assert.match(await page.textContent('.jr-msg'), /Saved .*20\d\d/);
    const doc = J.readJournalDoc(mem.get(J.JOURNAL_KEY));
    assert.equal(doc.entries.length, 1);
    const e = doc.entries[0];
    assert.equal(e.author.name, 'MiniMe');
    assert.deepEqual(e.call, { subject: 'NVDA', direction: 'up', target: 250, by: '2027-06-30', confidence: 4 });
    assert.deepEqual(e.ref.symbol, 'NVDA'); assert.equal(e.ref.price, 190);
    assert.equal(e.market.spy, 671.25); assert.equal(e.market.vix, 17.1);
    assert.equal(e.evidence.length, 4); assert.equal(e.evidence[3].kind, 'shot');
    assert.ok(e.evidence.every((x) => x.thumb === undefined), 'thumbnails stay in the browser');
    assert.equal(await page.inputValue('[data-jr-text]'), '', 'the draft clears after saving');

    // Review.
    await page.click('[data-jr-view="review"]');
    await page.locator('.jr-entry').first().waitFor();
    const entryText = await page.locator('.jr-entry').first().textContent();
    assert.match(entryText, /MiniMe/); assert.match(entryText, /20\d\d/, 'full date with the year');
    assert.match(entryText, /NVDA up/); assert.match(entryText, /target 250\.00/); assert.match(entryText, /confidence 4\/5/);
    assert.match(entryText, /Market then: SPY 671\.25 · QQQ 602\.50 · VIX 17\.10/);
    await page.locator('[data-jr-since] b').waitFor();
    assert.match(await page.textContent('[data-jr-since]'), /NVDA 190\.00 then, 190\.00 now: 0\.00% \(no move yet\)/);
    await page.locator('.jr-entry .jr-shot img').waitFor();
    assert.ok(await page.locator('.jr-entry .jr-shot img').evaluate((img) => img.complete && img.naturalWidth > 0), 'the saved picture loads from the server');
    await page.locator('.jr-entry .jr-shot').click();
    await page.locator('.jr-zoom img').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.jr-zoom').count(), 0);

    // Edit keeps the first time and the earlier text.
    await page.click('[data-jr-edit]');
    await page.fill('[data-jr-text]', 'Calling it now: the market peaks after the IPOs, then a bear market.');
    await page.click('[data-jr-save]');
    await page.locator('.jr-msg.is-ok').waitFor();
    await page.click('[data-jr-view="review"]');
    await page.locator('.jr-edited').waitFor();
    await page.click('[data-jr-hist]');
    assert.match(await page.locator('.jr-hist').textContent(), /NVDA leads into it/, 'the earlier text is shown');
    const edited = J.readJournalDoc(mem.get(J.JOURNAL_KEY)).entries[0];
    assert.equal(edited.createdAt, e.createdAt); assert.equal(edited.history.length, 1);

    // Mark a result.
    await page.click('[data-jr-outcome]');
    await page.click('[data-jr-res="right"]');
    await page.fill('[data-jr-outnote]', 'Played out');
    await page.click('[data-jr-outsave]');
    await page.locator('.jr-out-right').waitFor();
    assert.match(await page.textContent('.jr-sum'), /1 right/);

    // Search and filter.
    await page.fill('[data-jr-q]', 'zzz-no-match');
    await page.locator('.jr-empty').waitFor();
    await page.fill('[data-jr-q]', 'bear');
    await page.locator('.jr-entry').waitFor();
    await shot(page, 'desktop-review');

    // Alt+J closes and reopens; the panel remembers it was open after a reload.
    await page.keyboard.press('Alt+KeyJ');
    assert.equal(await page.isVisible('#journal-panel'), false);
    await page.keyboard.press('Alt+KeyJ');
    assert.ok(await page.isVisible('#journal-panel'));
    await page.reload();
    await page.locator('#journal-panel .jr-entry, #journal-panel [data-jr-text]').first().waitFor();
    if (await page.locator('[data-jr-view="review"][aria-pressed="false"], [data-jr-view="review"]:not(.is-on)').count()) await page.click('[data-jr-view="review"]');
    await page.locator('.jr-entry [data-jr-hist]').first().click();
    await page.locator('.jr-hist').first().waitFor();
    assert.match(await page.locator('.jr-hist').first().textContent(), /NVDA leads into it/, 'earlier versions load after a reload');
    assert.ok(await page.locator('.jr-hist .jr-ev-item').count() >= 1, 'an earlier version shows its evidence');

    // Split view: the two panes sit left of the journal.
    await page.click('#split-toggle').catch(async () => { await page.click('#workspace-settings-toggle'); await page.click('#split-toggle'); });
    await page.locator('#split-view').waitFor();
    const split = await page.locator('#split-view').boundingBox();
    const jp = await page.locator('#journal-panel').boundingBox();
    assert.ok(split.x + split.width <= jp.x + 1, 'split view panes stay left of the journal');
    assert.deepEqual(await headerOver(), [], 'no header button slides under the panel in split view');
    await shot(page, 'desktop-split');
    assert.deepEqual(page.errors, []);
    await context.close();
  }

  // ---------------- Desktop, the other owner ----------------
  who = 'LilSean';
  {
    const { context, page } = await newPage(1366, { dark: true });
    const id = J.readJournalDoc(mem.get(J.JOURNAL_KEY)).entries[0].id;
    await page.goto(base + '/?journal=' + id);
    await page.locator('.jr-entry.is-focus').waitFor();
    assert.equal(await page.evaluate(() => location.search.includes('journal=')), false, 'the link is cleaned from the address bar');
    assert.equal(await page.locator('[data-jr-edit]').count(), 0, 'no Edit on the other owner\'s entry');
    assert.equal(await page.locator('[data-jr-delask]').count(), 0, 'no Delete on the other owner\'s entry');
    assert.equal(await page.locator('[data-jr-outcome]').count(), 1, 'both owners can mark a result');
    await page.click('[data-jr-view="write"]');
    await page.fill('[data-jr-text]', 'Rates fall, small caps rip.');
    await page.click('.jr-call summary');
    await page.fill('[data-jr-call="subject"]', 'MARKET');
    await page.click('[data-jr-dir="up"]');
    await page.keyboard.press('Control+Enter');
    await page.locator('.jr-msg.is-ok').waitFor();
    const docNow = J.readJournalDoc(mem.get(J.JOURNAL_KEY));
    const mine = docNow.entries.find((x) => x.author.name === 'LilSean');
    assert.equal(mine.ref.symbol, 'SPY', 'a MARKET call stamps SPY');
    await page.click('[data-jr-view="review"]');
    await page.selectOption('[data-jr-who]', 'LilSean');
    assert.equal(await page.locator('.jr-entry').count(), 1);
    await shot(page, 'desktop-review-dark');
    assert.deepEqual(page.errors, []);
    await context.close();
  }

  // ---------------- Phone, MiniMe ----------------
  who = 'MiniMe';
  {
    const { context, page } = await newPage(390);
    await page.goto(base + '/?tab=picks');
    await page.locator('#picks-grid .pick-tab-card').first().waitFor();
    assert.ok(await page.isVisible('#journal-toggle'), 'one tap away on a phone');
    const tb = await page.locator('#journal-toggle').boundingBox();
    assert.ok(tb.x >= 0 && tb.x + tb.width <= 390, 'the button fits the header');
    await page.click('#journal-toggle');
    const p = await page.locator('#journal-panel').boundingBox();
    assert.ok(p.x <= 1 && p.width >= 389, 'a full-width sheet on a phone');
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollW <= 390, 'no sideways scroll');
    await page.click('[data-jr-view="write"]');
    await page.fill('[data-jr-text]', 'Phone note');
    await page.click('[data-jr-pick="data"]');
    assert.equal(await page.isVisible('#journal-panel'), false, 'the sheet tucks away while picking');
    const card = page.locator('#picks-grid .pick-tab-card').first();
    await card.tap();
    await page.locator('[data-jr-pickuse]:not([hidden])').waitFor();
    assert.equal(await page.locator('.jr-ev-item').count(), 0, 'a first tap only selects');
    await page.tap('[data-jr-pickuse]');
    await page.locator('#journal-panel .jr-ev-item').waitFor();
    assert.ok(await page.isVisible('#journal-panel'), 'the sheet comes back');
    await shot(page, 'phone-write');
    await page.click('[data-jr-close]');
    assert.equal(await page.isVisible('#journal-panel'), false);
    assert.deepEqual(page.errors, []);
    await context.close();
  }

  // ---------------- Public visitor ----------------
  who = 'public';
  {
    const { context, page } = await newPage(1366);
    requests.length = 0;
    await page.goto(base + '/?journal=jabcdefg00000000');
    await page.waitForTimeout(800);
    assert.equal(await page.isVisible('#journal-toggle'), false, 'public visitors never see the button');
    assert.equal(await page.locator('#journal-panel').count(), 0);
    await page.keyboard.press('Alt+KeyJ');
    assert.equal(await page.locator('#journal-panel').count(), 0, 'the shortcut does nothing for them');
    assert.ok(!requests.some((r) => r.path.startsWith('/api/auth/journal')), 'no journal request from a public visit');
    assert.deepEqual(page.errors, []);
    await context.close();
  }
  console.log('journal browser checks passed (desktop light/dark, two owners, split view, phone, public); screenshots in ' + out);
} finally {
  await browser.close();
  server.close();
}

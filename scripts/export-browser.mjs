// Browser checks for the Owner-only Export menu: an Owner can save the
// current Top picks (all cards, or only the six actionable ones) and an opened
// pick's Grade view as PNG / PDF / CSV / Excel / JSON, copy them, and print
// just that part; a public visitor never sees the button. No live quotes or
// paid services. Requires Playwright and its Chromium browser.
// Optional: PLAYWRIGHT_MODULE=/abs/path/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome
// Run: node scripts/export-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;
const out = process.env.QA_OUTPUT || '/tmp/stonks-export';
await mkdir(out, { recursive: true });
const now = new Date().toISOString();
const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'JPM', 'META', 'AMZN', 'GOOGL'];
const heat = symbols.map((t, i) => ({ t, s: 'Technology', i: 'QA', sp: 100 + i, mc: (10 - i) * 1e9, ch: i - 4 }));
// The first six clear every bar (actionable); the rest are watch ideas.
const picks = symbols.map((symbol, i) => ({
  symbol, side: i % 4 === 3 ? 'put' : 'call', sector: 'Technology', total: 9 - i * 0.5, score: 9 - i * 0.5, conviction: 'High',
  group: i < 6 ? 'actionable' : 'watch', entry: { now: i < 6 }, spot: 100 + i, entryDate: now,
  recommendation: { tier: 'strong-call', label: 'Strong Call' },
  pillars: { fundamentals: { score: 1.5, signals: [] }, technicals: { score: 2, signals: [] }, mechanicals: { score: 0.5, signals: [] }, narrative: { score: 1, signals: [] } },
  contract: { structure: 'long', strike: 100 + i, expiry: Date.now() / 1000 + 40 * 86400, expiryLabel: "Dec 18 '26", dte: 40,
    mid: 2 + i, maxLoss: 200, iv: 0.4, delta: 0.5, oi: 1000, pop: 0.5, breakevenMovePct: 3 },
}));
const fixtures = {
  'heatmap.json': { tickers: heat, builtAtIso: now },
  'picks.json': { picks, builtAtIso: now },
  'picks-open.json': { open: [], closed: [], builtAtIso: now },
  'picks-accuracy.json': { open: [], closed: picks.slice(0, 4).map((p, i) => ({ ...p, result: i % 2 ? 'loss' : 'win', closedAt: now })), builtAtIso: now },
};
let owner = true;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json(owner ? { enabled: true, member: true, trackRecord: true, topPicks: true, role: 'owner' } : { enabled: true, member: false });
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

async function bytes(download) { const p = out + '/' + download.suggestedFilename(); await download.saveAs(p); return readFile(p); }
try {
  for (const width of [1366, 390]) {
    owner = true;
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    await page.goto(base + '/?tab=picks');
    await page.locator('#picks-grid .pick-tab-card').first().waitFor();
    if (!(await page.isVisible('#export-toggle'))) await page.click('#workspace-settings-toggle');
    await page.click('#export-toggle');
    const parts = await page.locator('.export-part span').allTextContents();
    assert.deepEqual(parts.slice(0, 4), ['Whole page', 'All pick cards', 'Actionable top picks only (6)', 'Ideas · watch only (3)'], 'Top picks offers the cards, and each group');
    const box = await page.locator('#export-panel').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'menu fits the screen');
    await page.screenshot({ path: `${out}/${width}-menu.png` });
    const save = async (fmt) => (await Promise.all([page.waitForEvent('download'), page.click(`[data-export-format="${fmt}"]`)]))[0];

    await page.check('input[name="export-part"][value="2"]');
    assert.ok(await page.locator('#picks-grid').evaluate((el) => el.classList.contains('export-target')), 'the chosen part is outlined');
    const png = await save('png');
    assert.match(png.suggestedFilename(), /^mingstreet-picks-actionable-top-picks-\d{4}-\d\d-\d\d-\d{4}\.png$/);
    const pngBytes = await bytes(png);
    assert.equal(pngBytes.subarray(1, 4).toString(), 'PNG');
    // The picture holds the six actionable cards and not the watch ideas.
    assert.equal(await page.locator('#picks-grid .export-hide').count(), 0, 'hidden groups come back after the picture');
    const pdf = await bytes(await save('pdf'));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.subarray(-8).toString(), /%%EOF/);
    const csv = (await bytes(await save('csv'))).toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.match(csv[0], /^ticker,tier,side,total/);
    assert.deepEqual(csv.slice(1).map((l) => l.split(',')[0]), symbols.slice(0, 6), 'CSV holds the six actionable picks');
    const xlsx = await bytes(await save('xlsx'));
    assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
    assert.ok(xlsx.includes(Buffer.from('xl/worksheets/sheet1.xml')) && xlsx.includes(Buffer.from('<v>9</v>')), 'Excel sheet has numbers as numbers');
    const json = JSON.parse((await bytes(await save('json'))).toString('utf8'));
    assert.deepEqual(json.data.map((p) => p.symbol), symbols.slice(0, 6));
    await page.click('[data-export-format="copy-table"]');
    await page.locator('.export-status', { hasText: 'Table copied' }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^ticker\ttier/);

    // Whole page JSON carries the page's data files.
    await page.check('input[name="export-part"][value="0"]');
    const whole = JSON.parse((await bytes(await save('json'))).toString('utf8'));
    assert.equal(whole.files['picks.json'].picks.length, symbols.length);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#export-panel').isHidden(), 'Escape closes the menu');

    // Open a pick, switch to its Grade view, export that.
    await page.locator('#picks-grid .pick-tab-card').first().click();
    await page.locator('#picks-detail-card .pick-tab').nth(1).click();
    if (!(await page.isVisible('#export-toggle'))) await page.click('#workspace-settings-toggle');
    await page.click('#export-toggle');
    assert.equal(await page.locator('.export-part span').nth(1).textContent(), 'AAPL · Grade view');
    await page.check('input[name="export-part"][value="1"]');
    assert.equal((await bytes(await save('png'))).subarray(1, 4).toString(), 'PNG');
    // Print / Save as PDF prints only the opened pick.
    await page.evaluate(() => { window.print = () => { window.__printed = document.querySelector('.export-print-target')?.id; }; });
    await page.click('[data-export-format="print"]');
    assert.equal(await page.evaluate(() => window.__printed), 'picks-detail-card');
    await page.mouse.click(5, 300);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('exporting-print')), false, 'print layout is removed afterwards');

    // A guide page has nothing to export.
    await page.goto(base + '/?tab=cheatsheet');
    await page.waitForFunction(() => !document.getElementById('page-pane-cheatsheet')?.hidden);
    if (!(await page.isVisible('#export-toggle'))) await page.click('#workspace-settings-toggle');
    await page.click('#export-toggle');
    await page.locator('.export-empty').waitFor();
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    // Public visitor: no button, no menu.
    owner = false;
    const pub = await browser.newContext({ viewport: { width, height: 900 } });
    const pp = await pub.newPage();
    await pp.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    await pp.goto(base + '/?tab=heatmap');
    await pp.waitForFunction(() => !document.getElementById('page-pane-heatmap')?.hidden);
    assert.equal(await pp.locator('#export-toggle').evaluate((b) => b.hidden), true, 'public visitors never get Export');
    assert.equal(await pp.locator('#export-panel').count(), 0);
    await pub.close();
  }
  console.log('export browser: ok (' + out + ')');
} finally {
  await browser.close();
  server.close();
}

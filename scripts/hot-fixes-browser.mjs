// Browser regression checks for findings 1–13. No live quotes or paid services.
// Requires Playwright and its Chromium browser. Optional overrides:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/browser
// Run: node scripts/hot-fixes-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_TEXT_SCALE } from './render/text-scale.mjs';

// Page-pane controls are 13px scaled by the page text size.
const controlFont = +(13 * PAGE_TEXT_SCALE).toFixed(2) + 'px';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.QA_OUTPUT || '/tmp/stonks-hot-fixes';
await mkdir(out, { recursive: true });
const now = new Date().toISOString();
const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'JPM'];
const changes = [2, 0, -3, null, 1, -1];
const heat = symbols.map((t, i) => ({ t, s: ['Tech', 'Software', 'Semis', 'Semis', 'Auto', 'Banks'][i], i: 'QA', sp: 100 + i, mc: (6 - i) * 1e9, ch: changes[i], perf: { '1m': i - 2, '1w': i, '3m': i, ytd: i, '1y': i } }));
const picks = symbols.map((symbol, i) => ({
  symbol, side: 'call', sector: heat[i].s, total: 9 - i, score: 9 - i, conviction: 'High',
  group: 'watch', entry: { now: false }, spot: 100, entryDate: now, optionPnlPct: i,
  contract: { structure: ['debit_vertical', 'credit_vertical', 'long'][i % 3], strike: 100,
    expiry: Date.now() / 1000 + 60 * 86400, expiryLabel: "Jan 15 '27", dte: 60,
    mid: 1 + i, maxLoss: 2 + i, iv: (i + 1) / 10, delta: .5, oi: 100, pop: .6,
    breakevenMovePct: 2, netDebit: 1 + i, netCredit: 1 }
}));
const fixtures = {
  'heatmap.json': { tickers: heat, builtAtIso: now },
  'picks.json': { picks, builtAtIso: now },
  'picks-open.json': { open: picks, closed: [], builtAtIso: now },
  'picks-accuracy.json': { open: picks, closed: [], builtAtIso: now },
  'grades-daily.json': { days: Array.from({ length: 25 }, (_, i) => ({ date: new Date(Date.now() - (24 - i) * 86400000).toISOString().slice(0, 10), totals: Object.fromEntries(symbols.map((s, k) => [s, i % 9 - k])) })) },
  'earnings-calls.json': { calls: Object.fromEntries(symbols.map(symbol => [symbol, { symbol, company: symbol, callDate: now.slice(0, 10), headline: 'Quarterly results', mgmtTone: 'positive' }])) },
  'unusual.json': { tickers: [{ symbol: 'AAPL', contracts: [{ side: 'call', premium: 12040000 }, { side: 'put', premium: 914019 }] }], scannedAt: now },
};
const archive = new Map();
async function data(name) {
  if (name in fixtures) return fixtures[name];
  try {
    const value = JSON.parse(await readFile(resolve(root, 'data', name), 'utf8'));
    return name === 'manifest.json' || name === 'manifest-free.json' ? { ...value, unusual: fixtures['unusual.json'] } : value;
  } catch {}
  if (!archive.has(name)) {
    try { archive.set(name, JSON.parse(execFileSync('git', ['show', '5b856b32a:data/' + name], { cwd: root, maxBuffer: 20e6, stdio: ['ignore', 'pipe', 'ignore'] }))); }
    catch { archive.set(name, {}); }
  }
  return archive.get(name);
}
// Isolated local fixture server. The HTML, CSS and JS are the real generated site.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json({ enabled: true, member: true, trackRecord: true, topPicks: true, role: 'owner' });
  const name = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
  if (name) return json(await data(name));
  if (url.pathname.startsWith('/api/')) return json({ quotes: [], items: [], entries: [] });
  if (url.pathname.startsWith('/_vercel/')) { res.setHeader('Content-Type', 'text/javascript'); return res.end(''); }
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ theme }) => {
      // Seed only once, so reload checks exercise actual persisted choices.
      if (!sessionStorage.getItem('qa-seeded')) {
        localStorage.setItem('stonks-theme', theme);
        localStorage.setItem('stonks-views-v1', JSON.stringify({ 'view:picks': 'table', 'view:open-picks': 'table', 'view:tickers': 'table' }));
        sessionStorage.setItem('qa-seeded', '1');
      }
    }, { theme });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    const go = async tab => {
      await page.goto(base + '/?tab=' + tab);
      await page.waitForFunction(tab => !!window.STONKS_VIEWS && !document.getElementById('page-pane-' + tab)?.hidden, tab);
    };
    const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const noOverflow = async label => {
      await settled();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      if (!fits) {
        console.log(label, await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).slice(0, 16).map(e => ({ tag: e.tagName, id: e.id, cls: String(e.className), right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })) })));
        await page.screenshot({ path: out + '/overflow.png' });
      }
      assert.ok(fits, label + ' has no page overflow');
    };
    const savedHeaders = pane => page.evaluate(pane => Object.keys(JSON.parse(localStorage.getItem('stonks-views-v1') || '{}')).filter(k => k.startsWith('tsort:' + pane + '|')), pane);
    const firstCol = sel => page.locator(sel + ' tbody tr td:first-child').allTextContents();

    // Actual ticker menu, flip and reload must beat the saved header sort.
    await go('tickers');
    const tickerTable = '#tickers-table table';
    await page.locator(tickerTable + ' th').filter({ hasText: 'Mkt cap' }).click();
    await page.locator('#tickers-sort').selectOption('alpha');
    await settled();
    assert.deepEqual(await savedHeaders('tickers'), []);
    const az = await firstCol(tickerTable);
    assert.deepEqual(az, az.slice().sort((a, b) => a.localeCompare(b)));
    await page.locator(tickerTable + ' th').filter({ hasText: 'Mkt cap' }).click();
    await page.locator('[data-sort-flip="tickers"]').click();
    await settled();
    assert.deepEqual(await savedHeaders('tickers'), []);
    assert.deepEqual(await firstCol(tickerTable), az.slice().reverse());
    await noOverflow('Ticker table');
    await page.reload(); await settled();
    await page.locator(tickerTable).waitFor();
    assert.deepEqual(await firstCol(tickerTable), az.slice().reverse());

    await go('picks');
    await page.locator('#picks-grid table th').filter({ hasText: 'Grade' }).click();
    await page.locator('#picks-sort-select').selectOption('iv');
    await settled();
    assert.deepEqual(await savedHeaders('picks'), []);
    assert.deepEqual(await firstCol('#picks-grid table'), symbols);
    const pickText = await page.locator('#picks-grid table').innerText();
    assert.match(pickText, /Debit spread/); assert.match(pickText, /Credit spread/);
    assert.doesNotMatch(pickText, /credit_vertical|debit_vertical/);
    await page.screenshot({ path: out + '/' + width + '-' + theme + '-picks.png' });
    await page.locator('[data-view-toggle="picks"][data-view-mode="chart"]').click();
    await page.locator('.picks-riskmap .sc-svg').first().waitFor();
    assert.ok((await page.locator('.picks-riskmap .sc-svg').first().boundingBox()).height <= 361);
    await noOverflow('Picks risk map');

    await go('open-picks');
    await page.locator('#open-picks-root table').first().waitFor();
    assert.doesNotMatch(await page.locator('#open-picks-root').innerText(), /credit_vertical|debit_vertical/);
    await page.locator('#open-picks-root table th').filter({ hasText: 'Strike' }).first().click();
    await page.locator('[data-open-picks-sort]').selectOption('ticker');
    await settled();
    assert.deepEqual(await savedHeaders('open-picks'), []);
    await noOverflow('Open picks');

    await go('calls');
    await page.locator('[data-calls-sort]').waitFor();
    const callsStyle = await page.locator('[data-calls-sort]').evaluate(el => ({ font: getComputedStyle(el).fontSize, label: getComputedStyle(el.closest('label')).display }));
    assert.equal(callsStyle.font, controlFont); assert.ok(['flex', 'inline-flex'].includes(callsStyle.label));
    await noOverflow('Earnings calls');
    await page.screenshot({ path: out + '/' + width + '-' + theme + '-calls.png' });

    // Six selected tickers: compact tray, horizontal chips and reachable footer.
    await go('tickers');
    for (const s of symbols) await page.locator('#tickers-table [data-cmp-toggle="' + s + '"]').click();
    await page.locator('#cmp-tray').waitFor();
    const tray = await page.locator('#cmp-tray').boundingBox();
    assert.ok(tray.height < 145, 'tray stays compact');
    const padding = await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    assert.ok(padding >= 900 - tray.y, 'page reserves tray space');
    if (width === 390) assert.equal(await page.locator('.cmp-tray-chips').evaluate(el => getComputedStyle(el).flexWrap), 'nowrap');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const foot = await page.locator('.foot-discord').boundingBox();
    assert.ok(foot.y + foot.height <= tray.y, 'Discord footer is above tray at bottom');
    await page.screenshot({ path: out + '/' + width + '-' + theme + '-tray.png' });
    // Space must follow wrapping when the viewport changes and disappear on Compare.
    await page.setViewportSize({ width: width === 390 ? 768 : 320, height: 900 });
    await settled();
    const resizedTray = await page.locator('#cmp-tray').boundingBox();
    const resizedPadding = await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    assert.ok(resizedPadding >= 900 - resizedTray.y);
    await noOverflow('Resized compare tray');
    await page.setViewportSize({ width, height: 900 });
    await settled();
    await page.locator('[data-cmp-tray-open]').click();
    await page.locator('.cmp-pl-bar').first().waitFor();
    assert.equal(await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom)), 0);
    for (const id of ['cmp-mode', 'cmp-bench']) assert.equal(await page.locator('#' + id).evaluate(el => getComputedStyle(el).fontSize), controlFont);
    if (width === 390) {
      assert.equal(await page.locator('.cmp-pl-ticker').first().isVisible(), true);
      assert.equal(await page.locator('.cmp-pl-ticker').first().textContent(), symbols[0]);
    }
    await page.locator('#cmp-sectors > summary').click();
    await page.locator('[data-cmp-sec].is-on').first().waitFor();
    while (await page.locator('[data-cmp-sec].is-on').count() > 1) await page.locator('[data-cmp-sec].is-on').first().click();
    const last = page.locator('[data-cmp-sec].is-on');
    await last.dispatchEvent('click');
    assert.equal(await page.locator('[data-cmp-sec].is-on').count(), 1);
    for (const id of ['cmp-sec-metric', 'cmp-sec-weight']) assert.equal(await page.locator('#' + id).evaluate(el => getComputedStyle(el).fontSize), controlFont);
    await noOverflow('Compare pillars and sectors');
    await page.locator('#cmp-pillars').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + '/' + width + '-' + theme + '-compare.png' });

    await go('heatmap');
    await page.locator('#heatmap-layout-select').selectOption('periods');
    await page.locator('[data-ts-key="heatmap-periods"]').waitFor();
    assert.deepEqual(await firstCol('[data-ts-key="heatmap-periods"]'), ['AAPL', 'TSLA', 'MSFT', 'JPM', 'NVDA', 'AMD']);
    await noOverflow('Heatmap two periods');

    await go('tickers');
    await page.locator('[data-view-toggle="tickers"][data-view-mode="chart"]').click();
    const scatter = page.locator('#tickers-scatter .sc-svg');
    await scatter.waitFor();
    const box = await scatter.boundingBox();
    assert.ok(box.width <= 641 && box.height <= 361, 'scatter capped at native drawing size');

    await go('iv-trend');
    const ivChart = page.locator('.ivt-vsavg .sc-svg');
    await ivChart.waitFor();
    const ivBox = await ivChart.boundingBox();
    assert.ok(ivBox.width <= 641 && ivBox.height <= 321, 'IV chart capped at native drawing size');

    await go('grade');
    await page.goto(base + '/?s=AAPL');
    await page.locator('.ogh-svg').waitFor();
    assert.ok((await page.locator('.ogh-svg').boundingBox()).height <= 151);
    if (width === 390) {
      await page.setViewportSize({ width: 1920, height: 900 });
      await settled();
      const resized = await page.locator('.ogh-svg').boundingBox();
      assert.ok(resized.height <= 151, 'grade history must not enlarge after rotating or widening a phone viewport: ' + resized.height);
      await page.setViewportSize({ width, height: 900 });
    }

    await go('flow');
    const sector = page.locator('[data-ssb-key="flow.sectors"]');
    await sector.locator('summary').click();
    assert.match(await sector.locator('.ssb-val').innerText(), /\$12\.0M\s*\/\s*\$0\.91M/);

    // Reset must clear Track Record choices without clearing theme.
    await page.evaluate(() => localStorage.setItem('stonks-acc-view', JSON.stringify({ eqSplit: 'sector', cmpPreset: 'structure' })));
    await page.locator('#views-reset').dispatchEvent('click');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => localStorage.getItem('stonks-acc-view')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('stonks-theme')), theme);
    assert.ok(await page.locator('#news-feed-sort option[value="move"]').textContent().then(t => t.includes('Biggest move today')));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no page overflow');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(width + 'px ' + theme + ': passed');
    await context.close();
  }
  console.log('Hot-fixes browser checks passed. Screenshots: ' + out);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

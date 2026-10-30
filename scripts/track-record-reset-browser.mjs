// The shipped page -> real authenticated handler -> fake storage. No broker.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createWebullPreview } from './webull-review-preview.mjs';
import { webullReviewFixture } from './fixtures/webull-review.mjs';
import { withPublishedGenerations, store as singleton } from '../lib/datastore.mjs';
import { readSiteRecord, RESET_KEYS } from '../lib/track-record-reset.mjs';
import { computePicksAccuracyStats } from '../lib/track-record-stats.mjs';
import { pickTradeId } from '../lib/pick-trade-text.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import handler from '../api/auth/[action].js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createWebullPreview(), now = Date.now();
const output = process.env.TRACK_RESET_BROWSER_OUT || resolve(tmpdir(), 'stonks-track-record-reset-browser');
await mkdir(output, { recursive: true });
const originalMethods = Object.fromEntries(['get', 'put', 'withLease'].map(k => [k, singleton[k]]));
const priorEnv = { SESSION_SECRET: process.env.SESSION_SECRET, PRIVATE_DATA_ENABLED: process.env.PRIVATE_DATA_ENABLED };
process.env.SESSION_SECRET = 'synthetic-browser-reset-secret'; process.env.PRIVATE_DATA_ENABLED = '1';
const raw = new Map();
let requests = [], writes = [], failNext = false, delayNext = false, delayPreview = false;
const client = withPublishedGenerations({
  get: async key => raw.get(key) ?? null,
  put: async (key, value) => { writes.push(key); raw.set(key, Buffer.from(value)); },
  del: async () => { throw new Error('A log wipe cannot delete source state'); },
  list: async () => [...raw].map(([key, b]) => ({ key, size: b.length })),
  withLease: async (name, fn) => { assert.match(name, /^track-record-(webull|onsite)$/); return { busy: false, result: await fn(() => {}) }; },
});
Object.assign(singleton, { get: client.get, put: client.put, withLease: client.withLease });
const token = await signSession({ tr: true, tp: true });
const fixture = webullReviewFixture(now), paper = fixture.mirror.trades.filter(t => t.state === 'closed');
fixture.accuracy.closed = fixture.accuracy.closed.map((r, i) => ({ ...r, outcome: paper[i].enginePnlPct > 0 ? 'win' : 'loss',
  optionPnlPct: paper[i].enginePnlPct, underlyingPnlPct: paper[i].enginePnlPct / 5, contract: { ...r.contract, mid: 4, structure: paper[i].structure } }));
const recent = { ...fixture.accuracy.closed[0], symbol: 'MSFT', entryDate: new Date(now - 12 * 3600000).toISOString() };
recent.tradeId = pickTradeId(recent); fixture.accuracy.open = [{ ...recent, exitDate: null }];
const ledger = { version: 2, goLiveIso: fixture.mirror.goLiveIso, accountId: 'synthetic-paper',
  trades: Object.fromEntries([...paper, { ...paper[0], tradeId: recent.tradeId, symbol: recent.symbol,
    engineEntryIso: recent.entryDate, state: 'open', filledQty: 1, openQty: 1, closedQty: 0 }].map(t => [t.tradeId, { ...t, entryAttempts: [], exitAttempts: [] }])),
  reconciliation: { status: 'attention', alerts: ['Synthetic active trade: bookkeeping must survive'] }, runs: [{ at: recent.entryDate }] };
fixture.accuracy.stats = computePicksAccuracyStats(fixture.accuracy.open, fixture.accuracy.closed);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const [width, theme] of [[1440, 'dark'], [390, 'dark'], [1440, 'light'], [390, 'light']]) {
    raw.clear(); requests = []; writes = [];
    raw.set('picks-accuracy.json', Buffer.from(JSON.stringify(fixture.accuracy)));
    raw.set('webull-paper-ledger.json', Buffer.from(JSON.stringify(ledger)));
    raw.set('picks-fills.json', Buffer.from(JSON.stringify({ rows: [{ trade_id: 'uploaded', account: 'My CSV' }] })));
    const sourceBefore = new Map(raw);
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 744 : 1000 }, acceptDownloads: true });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: preview.base, sameSite: 'Lax' }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(t => localStorage.setItem('stonks-theme', t), theme);
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== preview.base) return route.fulfill({ body: '' });
      const action = url.pathname.startsWith('/api/auth/') ? url.pathname.split('/').at(-1) : '';
      if (['track-record-reset','track-record-data','webull-mirror','picks-fills'].includes(action)) {
        const body = req.method() === 'POST' ? req.postDataJSON() : null;
        if (body?.operation === 'preview' && delayPreview) { delayPreview = false; await new Promise(r => setTimeout(r, 400)); }
        if (body?.operation === 'wipe') {
          requests.push(body);
          if (delayNext) { delayNext = false; await new Promise(r => setTimeout(r, 500)); }
          if (failNext) { failNext = false; return route.fulfill({ status: 502, json: { error: 'Synthetic storage failure. Try again.' } }); }
        }
        const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(value) { this.body = JSON.stringify(value); return this; }, end(value) { this.body = value; } };
        await handler({ method: req.method(), headers: { ...await req.allHeaders(), host: url.host, 'x-forwarded-proto': 'http' },
          body, query: { action, ...Object.fromEntries(url.searchParams) } }, response);
        return route.fulfill({ status: response.code || response.statusCode || 200, headers: response.headers,
          contentType: response.headers['Content-Type'] || 'application/json', body: response.body });
      }
      const key = action === 'me' ? url.searchParams.get('data') : url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null;
      if (key === 'picks-accuracy.json') return route.fulfill({ json: fixture.accuracy });
      return route.continue();
    });
    await page.goto(preview.base + '/?tab=track');
    await page.locator('[data-track-reset="webull"]').waitFor();
    const dialog = page.locator('#acc-reset-dialog'), submit = page.locator('#acc-reset-confirm'), check = page.locator('#acc-reset-sure');
    await page.locator('[data-track-reset="webull"]').click();
    assert.match(await dialog.innerText(), /Wipe Webull log · 1D\?/);
    assert.equal(await page.locator('#acc-reset-range').inputValue(), '1D');
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
    assert.equal(requests.length, 0);
    await page.locator('[data-track-reset="onsite"]').click();
    await page.locator('#acc-reset-cancel').click(); assert.equal(writes.length, 0);

    // Every choice gets a fresh signed, bounded preview and clears the checkbox.
    await page.locator('[data-track-reset="webull"]').click();
    for (const range of ['1D','1W','1M','3M','ALL']) {
      await page.locator('#acc-reset-range').selectOption(range);
      await check.waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.getElementById('acc-reset-sure').disabled);
      assert.equal(await check.isChecked(), false); assert.equal(await submit.isDisabled(), true);
      assert.match(await page.locator('#acc-reset-summary').innerText(), /UTC/);
    }
    await check.check(); failNext = true; await submit.click();
    await page.locator('#acc-reset-error').getByText('Synthetic storage failure. Try again.').waitFor();
    assert.equal(await submit.isDisabled(), true); assert.equal(writes.length, 0);
    await check.check();
    const footer = await submit.boundingBox();
    assert(footer.y >= 0 && footer.y + footer.height <= page.viewportSize().height, 'confirmation actions stay on screen while scrolling');
    await page.screenshot({ path: resolve(output, 'webull-periods-' + width + '-' + theme + '.png') });
    delayNext = true;
    const navigation = page.waitForEvent('load'); await submit.click();
    assert.equal(await submit.isDisabled(), true); await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
    await navigation;
    assert.deepEqual((await readSiteRecord(client, 'picks-accuracy.json')), fixture.accuracy);
    assert.equal(requests.at(-1).scope, 'webull'); assert.equal(requests.at(-1).range, 'ALL');
    await page.locator('#acc-tab-webull').click(); await page.locator('#an-webull').getByText(/No mirrored trades yet/).first().waitFor();
    // Download must match the cleared report, while source bookkeeping survives.
    const csv = await page.evaluate(async () => (await fetch('/api/auth/webull-mirror?format=csv')).text());
    assert(!csv.includes(recent.tradeId));

    // Restore only the reporting exclusion, never the source ledger, then wipe
    // the last day of the on-site log. Older trades and Webull metadata survive.
    raw.delete(RESET_KEYS.webull);
    await page.locator('[data-track-reset="onsite"]').click();
    await page.waitForFunction(() => !document.getElementById('acc-reset-sure').disabled);
    await check.check();
    await page.locator('#acc-reset-range').selectOption('1W');
    assert.equal(await check.isChecked(), false);
    await page.locator('#acc-reset-range').selectOption('1D');
    await page.waitForFunction(() => !document.getElementById('acc-reset-sure').disabled);
    await check.check();
    await page.screenshot({ path: resolve(output, 'onsite-periods-' + width + '-' + theme + '.png') });
    await Promise.all([page.waitForEvent('load'), submit.click()]);
    assert.equal((await readSiteRecord(client, 'picks-accuracy.json')).open.length, 0);
    assert.equal((await readSiteRecord(client, 'picks-accuracy.json')).closed.length, fixture.accuracy.closed.length);
    for (const [key, bytes] of sourceBefore) assert.deepEqual(raw.get(key), bytes, 'source remains intact: ' + key);
    assert.deepEqual(writes, [RESET_KEYS.webull, RESET_KEYS.onsite]);

    // All 13 Track Record panes still render after a partial wipe.
    for (const tab of ['summary','scorecard','webull','webull-equity','top10','activity','picks','equity','breakdowns','webull-breakdown','sim','montecarlo','research']) {
      await page.locator('#acc-tab-' + tab).click();
      assert.equal(await page.locator('#acc-pane-' + tab).isVisible(), true);
    }
    const response = await page.evaluate(async () => (await fetch('/api/auth/webull-mirror')).json());
    assert.equal(response.engineRecord.open.length, 1, 'Webull still has raw engine join metadata');
    // Open Picks must not reuse the wiped report cache.
    await page.goto(preview.base + '/?tab=open-picks');
    await page.locator('#open-picks-root').getByText('MSFT', { exact: true }).first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
    assert.deepEqual(errors, []); await context.close();
  }
  console.log('Track Record browser passed: all periods, separate logs, signed confirmation, cancel/Escape, failure/retry, duplicate protection, intact source state, CSV, Open Picks, all 13 panes, mobile/desktop and light/dark. Screenshots: ' + output);
} finally {
  await browser.close(); await new Promise(r => preview.server.close(r)); Object.assign(singleton, originalMethods);
  for (const [key, value] of Object.entries(priorEnv)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
}

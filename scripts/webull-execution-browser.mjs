// Exercise the generated UI against sanitized ledger exports. The fixture
// server is read-only, uses synthetic evidence, and cannot contact Webull.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createWebullPreview } from './webull-review-preview.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createWebullPreview();
const output = process.env.WEBULL_BROWSER_OUT || resolve(tmpdir(), 'stonks-webull-execution-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const [width, theme] of [[1440, 'dark'], [390, 'dark'], [1440, 'light'], [390, 'light']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    await page.addInitScript(t => localStorage.setItem('stonks-theme', t), theme);
    await page.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({ body: '' }));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(preview.base + '/?tab=track&previewCase=execution', { waitUntil: 'domcontentloaded' });
    await page.locator('#acc-tab-webull').click();
    const root = page.locator('#an-webull');
    await root.locator('.wb-review-nav').waitFor();
    await root.locator('label[for="acc-wb-lens-3"]').click();
    assert.equal(await root.locator('.wb-execution-history').count(), 4);
    const text = await root.innerText();
    assert.match(text, /Manual entry, broker-confirmed; automated exits only/);
    assert.match(text, /Earlier automatic entry missed; manually recovered/);
    assert.match(text, /Paper bought at the engine's price/);
    assert.match(text, /Emergency end-of-day exit attempted; fill not confirmed/);
    assert.match(text, /Emergency end-of-day exit: broker-confirmed fill/);
    assert.match(await page.locator('#acc-sum-webull').innerText(), /25%\s*filled \(3 missed\)/);
    const first = root.locator('.wb-execution-history').first();
    await first.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await first.getAttribute('open'), '');
    const currentOrders = first.locator(':scope > .acc-tscroll tbody');
    assert.match(await currentOrders.innerText(), /Manual entry/);
    assert.match(await currentOrders.innerText(), /\$51\.75/);
    assert.match(await currentOrders.innerText(), /:05/);
    assert.match(await currentOrders.innerText(), /Unconfirmed/);
    const observations = first.locator('.wb-order-observations');
    await observations.locator('summary').click();
    assert.match(await observations.innerText(), /Manual fill imported/);
    assert.match(await observations.innerText(), /cumulative order observations/);
    for (const w of [width, 1920, 768, 390, width]) {
      await page.setViewportSize({ width: w, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document overflow at ' + w);
    }
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'trade-history-' + width + '-' + theme + '.png'), fullPage: false });
    const event = page.waitForEvent('download');
    await root.getByRole('link', { name: 'Download all Webull paper trades (CSV)' }).click();
    const download = await event, csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /automatic_entry_outcome,automatic_entry_attempt_count/);
    assert.match(csv, /emergency_exit_used,emergency_exit_filled/);
    assert.match(csv, /manual.*missed/);
    const orderEvent = page.waitForEvent('download');
    await root.getByRole('link', { name: 'Download order attempts (CSV)' }).click();
    const orderFile = await orderEvent, orderCsv = await readFile(await orderFile.path(), 'utf8');
    assert.match(orderCsv, /cumulative_filled_qty/); assert.match(orderCsv, /observations_json/);
    assert.match(orderCsv, /manual-broker-import/); assert.match(orderCsv, /emergency-exit/);
    await root.locator('label[for="acc-wb-state-2"]').click();
    assert.equal(await root.locator('.wb-execution-history').count(), 1, 'closed filter excludes unfilled emergency');
    await page.reload(); await root.locator('.wb-execution-history').waitFor();
    assert.equal(await root.locator('#acc-wb-state-2').isChecked(), true);
    assert.equal(await root.locator('#acc-wb-lens-3').isChecked(), true);
    await root.locator('label[for="acc-wb-state-0"]').click();
    await root.locator('[data-acc-action="refresh-webull"]').click();
    await root.locator('.wb-execution-history').first().waitFor();
    assert.equal(await root.locator('.wb-execution-history').count(), 4);
    await page.locator('#acc-tab-webull-equity').click();
    await page.locator('#an-webull-equity .acc-eq-svg').first().waitFor();
    assert.match(await page.locator('#acc-sum-webull-equity').innerText(), /20\.24/);
    await page.locator('#acc-tab-webull-breakdown').click();
    assert.match(await page.locator('#an-webull-breakdown').innerText(), /recorded dollars after known fees/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'paper equity/breakdown fit the viewport');
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    assert.doesNotMatch(storage, /manual-broker-order|filledPrice|51\.75|emergency-exit/, 'private execution data is not persisted in browser preferences');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const page = await browser.newPage();
  await page.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({ body: '' }));
  await page.goto(preview.base + '/?tab=track&previewCase=retry');
  await page.locator('#acc-tab-webull').click();
  const root = page.locator('#an-webull');
  await root.getByRole('button', { name: 'Retry loading trades' }).click();
  await root.locator('.wb-review-nav').waitFor();
  assert.match(await root.innerText(), /Last broker reconciliation/);
  await page.goto(preview.base + '/?tab=track&previewCase=edge');
  await page.locator('#acc-tab-webull-equity').click();
  await page.locator('#an-webull-equity .wb-review-warning').waitFor();
  assert.match(await page.locator('#an-webull-equity').innerText(), /broker-confirmed entry and close timestamps/);
  assert.equal(await page.locator('#an-webull-equity svg').count(), 0, 'undated fills cannot create a paper timeline');
  assert.match(await page.locator('#acc-sum-webull-equity').innerText(), /verified paper trades/);
  await page.close();
  console.log('Webull browser passed: manual and emergency labels, broker-confirmed prices/times, automatic miss accounting, keyboard history, CSV, filters, reload/refresh, failure/retry, desktop/mobile and light/dark. Screenshots: ' + output);
} finally {
  await browser.close();
  await new Promise(r => preview.server.close(r));
}

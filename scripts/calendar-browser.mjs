import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCalendarPreview } from './calendar-preview.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-calendar-browser');
await mkdir(output, { recursive: true });
const preview = await createCalendarPreview();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === preview.base ? route.continue() : route.fulfill({ body: '' }));
    preview.setScenario('normal');
    await page.goto(preview.base + '/?tab=calendar', { waitUntil: 'domcontentloaded' });
    const coverage = page.locator('#calendar-coverage');
    await coverage.waitFor({ state: 'visible' });
    assert.match(await coverage.innerText(), new RegExp('1 of ' + preview.payload.coverage.earningsUniverse + ' stocks'));
    assert.match(await coverage.innerText(), /Official schedules unavailable: BLS/);
    await coverage.locator('summary').click();
    assert.match(await coverage.innerText(), /No upcoming earnings date found/);
    assert.match(await coverage.innerText(), /not an exhaustive company schedule/);
    assert.equal(await page.locator('#calendar-root [data-cal-sym="RDDT"]').count(), 0);
    for (const [filter, expected] of [['earnings','AAPL'],['catalysts','Synthetic developer event'],['reports','Synthetic unemployment claims'],['fomc','FOMC rate decision'],['macro','Synthetic macro announcement']]) {
      await page.locator('.calendar-pill[data-cal-type="' + filter + '"]').click();
      assert.match(await page.locator('#calendar-root').innerText(), new RegExp(expected));
    }
    await page.locator('.calendar-pill[data-cal-type="catalysts"]').click();
    assert.equal(await page.locator('#calendar-root a[href="https://example.com/calendar-test"]').count(), 1, 'catalyst citation renders');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#calendar-export-csv').click();
    const download = await downloadPromise, csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /Synthetic developer event/); assert(!csv.includes('RDDT'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    await page.screenshot({ path: resolve(output, 'calendar-' + width + '.png'), fullPage: true });
    preview.setScenario('stale'); await page.reload(); await coverage.waitFor({ state: 'visible' });
    assert.match(await coverage.innerText(), /snapshot needs a refresh/);
    preview.setScenario('error'); await page.reload(); await coverage.waitFor({ state: 'visible' });
    assert.match(await coverage.innerText(), /could not be loaded/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Calendar browser passed: desktop/mobile, all filters, citations, CSV export, source gaps, stale snapshots and load failure. Screenshots: ' + output);
} finally { await browser.close(); await new Promise(resolve => preview.server.close(resolve)); }

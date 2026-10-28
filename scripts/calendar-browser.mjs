import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCalendarPreview } from './calendar-preview.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-calendar-browser');
await mkdir(output, { recursive: true });
const preview = await createCalendarPreview({asOfIso:'2026-10-28T16:00:00Z'});
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1440, 390]) for (const theme of ['light','dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    await page.addInitScript(t=>localStorage.setItem('stonks-theme',t),theme);
    await page.clock.install({time:new Date('2026-10-28T16:00:00Z')});
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
    assert.match(await coverage.innerText(), /not exhaustive/);
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
    await page.screenshot({ path: resolve(output, 'calendar-' + width + '-' + theme + '.png'), fullPage: true });
    preview.setScenario('company'); await page.reload(); await coverage.waitFor({state:'visible'});
    const root=page.locator('#calendar-root');
    await page.locator('.calendar-pill[data-cal-type="catalysts"]').click();
    await root.locator('[data-cal-day="2026-10-28"]').click();
    assert.match(await root.locator('.cal-detail').innerText(), /Oracle AI World/);
    assert.match(await root.locator('.cal-detail').innerText(), /Ongoing/);
    assert.equal(await root.locator('a[href="https://www.oracle.com/ai-world/"]').count(),1);
    await root.locator('[data-cal-day="2026-10-23"]').click();
    assert.match(await root.locator('.cal-detail').innerText(), /iPhone Duo release/);
    assert.match(await root.locator('.cal-detail').innerText(), /Past/);
    const companyDownloadPromise=page.waitForEvent('download'); await page.locator('#calendar-export-csv').click();
    const companyDownload=await companyDownloadPromise, companyCsv=await readFile(await companyDownload.path(),'utf8');
    assert(companyCsv.includes('2026-10-25') && companyCsv.includes('2026-10-28'));
    assert(companyCsv.includes('source_url') && companyCsv.includes('iPhone Duo release'));
    assert(!companyCsv.includes('AWS re:Invent'),'October export excludes a November event');
    await root.locator('[data-cal-nav="prev"]').click();
    await root.locator('[data-cal-day="2026-09-09"]').click();
    assert.match(await root.locator('.cal-detail').innerText(), /iPhone Duo announcement/);
    await root.locator('[data-cal-nav="next"]').click();
    await root.locator('[data-cal-nav="next"]').click();
    await root.locator('[data-cal-day="2026-11-17"]').click();
    assert.match(await root.locator('.cal-detail').innerText(), /Microsoft Ignite/);
    assert.match(await root.locator('.cal-detail').innerText(), /Conference/i);
    if(width===390) {
      const controls=page.locator('.calendar-type-filter');
      assert(await controls.evaluate(e=>e.scrollWidth<=e.clientWidth),'phone filters fit without clipping');
      const title=root.locator('.cal-detail .cal-chip-text').first();
      assert.equal(await title.evaluate(e=>getComputedStyle(e).whiteSpace),'normal','company title wraps');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>{ if(document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0,0); });
    await page.screenshot({path:resolve(output,'company-events-'+width+'-'+theme+'.png'),fullPage:false});
    preview.setScenario('stale'); await page.reload(); await coverage.waitFor({ state: 'visible' });
    assert.match(await coverage.innerText(), /snapshot needs a refresh/);
    preview.setScenario('error'); await page.reload(); await coverage.waitFor({ state: 'visible' });
    assert.match(await coverage.innerText(), /could not be loaded/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Calendar browser passed: desktop/mobile, all filters, citations, CSV export, source gaps, stale snapshots and load failure. Screenshots: ' + output);
} finally { await browser.close(); await new Promise(resolve => preview.server.close(resolve)); }

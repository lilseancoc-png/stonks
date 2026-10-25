import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHistoricalPreview } from './historical-data-preview.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createHistoricalPreview({ historyFile: process.env.HISTORICAL_HISTORY_FILE || null });
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-historical-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    await page.addInitScript(t => localStorage.setItem('stonks-theme', t), theme);
    await page.route('**/*', route => new URL(route.request().url()).origin === preview.base ? route.continue() : route.fulfill({ body: '' }));
    page.on('pageerror', e => errors.push(e.message));
    preview.setScenario('owner');
    await page.goto(preview.base + '/?tab=historical-data', { waitUntil: 'domcontentloaded' });
    const root = page.locator('#historical-data-root');
    await root.locator('.h-study-head').waitFor({ timeout: 10000 }).catch(async error => {
      console.error(JSON.stringify({ errors, url: page.url(), historicalRequests: preview.requests, content: await root.innerHTML(), visiblePane: await page.locator('.page-pane:not([hidden])').getAttribute('id') }));
      await page.screenshot({ path: resolve(output, 'failure.png') }); throw error;
    });
    assert.equal(await root.locator('.h-study-button').count(), 17);
    assert.match(await root.innerText(), /Current completed-close conditions/i);
    assert.match(await root.locator('.h-study-head').innerText(), /Fourth-quarter rally/);
    assert(await root.locator('.h-figure svg').first().isVisible());
    await root.locator('[data-history-study="santa"]').click();
    assert.match(await root.locator('.h-comparison').innerText(), /Upcoming/i);
    assert.equal(await root.locator('.h-current').count(), 0, 'upcoming period has no fabricated current path');
    await root.locator('[data-history-study="midterm"]').click();
    assert.match(await root.innerText(), /Small sample/);
    assert.match(await root.locator('.h-comparison').innerText(), /same/);
    await root.locator('[data-history-control="symbol"]').selectOption('QQQ');
    await root.locator('[data-history-control="range"]').selectOption('10y');
    const expected = preview.payload.indexes.QQQ.studies.find(s => s.id === 'midterm').ranges['10y'];
    assert.match(await root.innerText(), new RegExp(expected.n + ' observations'));
    await page.reload(); await root.locator('.h-study-head').waitFor();
    assert.equal(await root.locator('[data-history-control="symbol"]').inputValue(), 'QQQ');
    assert.equal(await root.locator('[data-history-control="range"]').inputValue(), '10y');
    assert.match(await root.locator('.h-study-head').innerText(), /Midterm election year/);
    const downloadEvent = page.waitForEvent('download');
    await root.locator('[data-history-export]').click();
    const download = await downloadEvent, csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /price_return_pct/); assert.match(csv, /"QQQ","midterm"/); assert.match(csv, /"true","false"/, 'in-progress comparison is explicitly incomplete');
    await root.locator('[data-history-view="sources"]').click();
    assert.match(await root.innerText(), /Ten-year coverage ledger/);
    assert.match(await root.innerText(), new RegExp(preview.payload.coverage.ready + ' of 37'));
    assert.equal(await root.locator('.h-source-table tbody tr').count(),37);
    assert.match(await root.innerText(), /\$79\/month/);
    assert.match(await root.innerText(), /approval required/i);
    assert.equal(await root.locator('button').filter({hasText:/subscribe|enable paid/i}).count(),0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'coverage tables scroll internally on small screens');
    await page.evaluate(() => { if(document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0,0); });
    await page.screenshot({path:resolve(output,'sources-'+width+'-'+theme+'.png'),fullPage:false});
    await page.reload(); await root.locator('.h-source-intro').waitFor();
    assert.match(await root.innerText(), /Ten-year coverage ledger/, 'coverage view persists');
    await root.locator('[data-history-view="context"]').click();
    await root.locator('[data-history-control="context"]').selectOption('DGS10');
    assert.match(await root.innerText(), /10-year Treasury yield/);
    const treasury=preview.payload.coverage.context.find(s=>s.id==='DGS10');
    if(treasury.status==='ready') {
      assert.equal(await root.locator('.h-context-chart svg').count(),1);
      assert.match(await root.innerText(), /Percent/);
      assert.match(await root.innerText(), /not point-in-time/);
    } else assert.match(await root.innerText(), /chart and comparative statistics are withheld/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'context chart fits its viewport');
    const selectBox=await root.locator('[data-history-control="context"]').boundingBox(), refreshBox=await root.locator('[data-history-retry]').boundingBox();
    assert(selectBox.x+selectBox.width<=refreshBox.x+1 || refreshBox.x+refreshBox.width<=selectBox.x+1 || selectBox.y+selectBox.height<=refreshBox.y+1 || refreshBox.y+refreshBox.height<=selectBox.y+1,'context selector and refresh button do not overlap');
    await page.evaluate(() => { if(document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0,0); });
    await page.screenshot({path:resolve(output,'context-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-history-view="studies"]').click();
    if(preview.payload.indexes.TLT) {
      await root.locator('[data-history-control="symbol"]').selectOption('TLT');
      assert.match(await root.locator('[data-history-control="symbol"]').innerText(),/20\+ year Treasury ETF/);
      await root.locator('[data-history-control="symbol"]').selectOption('QQQ');
    }
    await root.locator('summary').filter({ hasText: 'Market lore' }).click();
    assert.match(await root.innerText(), /Super Bowl indicator/);
    for (const w of [width, 1920, 768, 390, width]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), w + 'px has no page overflow');
      assert(await root.locator('.h-figure svg').first().isVisible());
    }
    await root.locator('[data-history-study="q4"]').click();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: resolve(output, 'historical-' + width + '-' + theme + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === preview.base ? route.continue() : route.fulfill({ body: '' }));
  for (const scenario of ['error', 'missing', 'malformed', 'empty', 'stale']) {
    preview.setScenario(scenario); await page.goto(preview.base + '/?tab=historical-data');
    const root = page.locator('#historical-data-root');
    await root.locator('button').first().waitFor();
    if (['error', 'missing', 'malformed'].includes(scenario)) {
      assert.match(await root.innerText(), /unavailable/);
      preview.setScenario('owner'); await root.locator('[data-history-retry]').click(); await root.locator('.h-study-head').waitFor();
    } else if (scenario === 'empty') assert.match(await root.innerText(), /coverage is not ready/);
    else assert.match(await root.innerText(), /comparisons are stale/);
  }
  for (const scenario of ['anonymous', 'tp-only', 'tr-only', 'disabled']) {
    preview.setScenario(scenario); const before = preview.requests;
    await page.goto(preview.base + '/?tab=historical-data');
    await page.waitForFunction(() => !document.querySelector('#page-pane-home').hidden);
    assert.equal(await page.locator('[data-page-tab="historical-data"]').isVisible(), false);
    assert.equal(preview.requests, before, 'non-owner never requests private history');
  }
  preview.setScenario('owner');
  const before = preview.requests; await page.goto(preview.base + '/?tab=news');
  await page.waitForFunction(() => !document.querySelector('#page-pane-news').hidden);
  assert.equal(preview.requests, before, 'history loads only when opened');
  await page.goto(preview.base+'/?tab=historical-data');
  const root=page.locator('#historical-data-root'); await root.locator('.h-study-head').waitFor();
  await root.locator('[data-history-control="symbol"]').selectOption('SHY');
  await root.locator('[data-history-study="santa"]').click();
  await root.locator('[data-history-control="range"]').selectOption('10y');
  const annual=root.locator('.h-detail details').first(), chart=annual.locator('svg');
  const top=await chart.locator('rect').evaluateAll(rects=>Math.min(...rects.filter(r=>r.classList.contains('h-bar-pos')&&Number(r.getAttribute('height'))>0).map(r=>Number(r.getAttribute('y')))));
  assert(Math.abs(top-26)<.001,'the largest positive return reaches the top axis value even when the entire range is below one percent');
  await annual.screenshot({path:resolve(output,'regression-small-return-axis.png')});
  const freshTime=Date.parse(preview.payload.builtAtIso);
  await page.clock.install({time:new Date(freshTime)});
  await page.reload(); await root.locator('.h-study-head').waitFor();
  await page.clock.setSystemTime(new Date(freshTime+4*86400000-1000));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.doesNotMatch(await root.innerText(),/may be missing newer observations/);
  const timerReads=preview.requests;
  await page.clock.fastForward(2000);
  assert.match(await root.innerText(),/may be missing newer observations/,'an open visible tab updates at the snapshot age boundary');
  assert.equal(preview.requests,timerReads,'the freshness timer makes no data request');
  const priorReads=preview.requests;
  await page.clock.setSystemTime(new Date(freshTime+40*86400000));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.match(await root.innerText(),/Current comparisons are stale/,'freshness advances for a retained in-memory snapshot');
  assert.match(await root.locator('.h-context .h-kicker').innerText(),/Last available/i);
  assert.match(await root.innerText(),/may be missing newer observations/);
  assert.equal(preview.requests,priorReads,'updating freshness labels does not poll private data');
  await page.reload(); await root.locator('.h-study-head').waitFor();
  assert.match(await root.innerText(),/Current comparisons are stale/,'opening an old snapshot recomputes its age');
  await root.locator('[data-history-view="context"]').click();
  await root.locator('[data-history-control="context"]').selectOption('DGS10');
  assert.match(await root.innerText(),/latest observation is stale/,'macro freshness advances with the viewer clock');
  await root.screenshot({path:resolve(output,'regression-aged-macro.png')});
  await root.locator('[data-history-view="sources"]').click();
  assert.match(await root.locator('.h-source-table tbody tr').filter({hasText:'SPY ·'}).innerText(),/Latest observation is stale/,'source ledger uses the same live freshness rule');
  await page.close();
  console.log('Historical Data browser passed: owner gate, lazy reads, 17 studies, source ledger, macro charts, actual small-return axis scale, aged-snapshot/focus warnings without polling, packed payload, persistence, CSV, failures/retry, four themes/viewports and responsive resize. Screenshots: ' + output);
} finally { await browser.close(); await new Promise(resolve => preview.server.close(resolve)); }

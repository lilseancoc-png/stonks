import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStreaksPreview } from './streaks-preview.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// The Owner session sees the decision desk, Grade sort and Grade column;
// the public pass further down checks what a signed-out visitor gets.
const preview = await createStreaksPreview({fixture: true, owner: true});
const out = resolve(tmpdir(), 'stonks-streaks-browser');
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
try {
  for (const width of [1440, 768, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({viewport: {width, height: 1000}});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(t => localStorage.setItem('stonks-theme', t), theme);
    await page.clock.install({time: new Date(preview.payload.builtAtIso)});
    await page.route('**/*', route => new URL(route.request().url()).origin === preview.base ? route.continue() : route.fulfill({body: ''}));
    await page.goto(preview.base + '/?tab=streaks');
    const panel = page.locator('#streaks-snapped'), rows = panel.locator('[data-snapped-symbol]');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 24);
    assert.match(await rows.first().locator('.streaks-ma-context').innerText(), /20D SMA/);
    assert.match(await rows.first().locator('.streaks-ma-context').innerText(), /Reclaimed 20D/);
    await rows.first().locator('.streaks-ma-context summary').click();
    assert.equal(await rows.first().locator('.streaks-ma-context li').count(), 4);
    assert.match(await rows.first().locator('.streaks-ma-context').innerText(), /200D/);
    // Wide screens open Streaks as a table; the moving-average context lives on the cards.
    await page.locator('[data-view-toggle="streaks"][data-view-mode="cards"]').click();
    assert(await page.locator('.streaks-active .streaks-ma-context').count() > 0);

    const symbols = () => rows.evaluateAll(nodes => nodes.map(n => n.dataset.snappedSymbol));
    for (const [mode, first] of [['alpha','SN00'], ['cum','SN23'], ['up','SN22'], ['down','SN23'], ['last','SN23'], ['vol','SN22'], ['tol','SN23'], ['streak','SN17'], ['sector','SN08']]) {
      await page.locator('#streaks-sort-select').selectOption(mode);
      assert.equal((await symbols())[0], first, mode + ' sort');
    }
    await page.locator('#streaks-sort-select').selectOption('vol');
    await page.locator('[data-sort-flip="streaks"]').click();
    assert.equal((await symbols()).at(-1), 'SN23', 'missing ended volume stays last when reversed');
    await page.locator('[data-sort-flip="streaks"]').click();
    await page.evaluate(() => {window.STONKS_VIEWS.gradeTotal = sym => sym === 'SN23' ? null : Number(sym.slice(2));});
    await page.locator('#streaks-sort-select').selectOption('grade');
    assert.equal((await symbols())[0], 'SN22');
    assert.equal((await symbols()).at(-1), 'SN23');
    await page.locator('#streaks-sort-select').selectOption('alpha');
    await page.locator('[data-sort-flip="streaks"]').click();
    assert.equal((await symbols())[0], 'SN23');
    await page.locator('[data-sort-flip="streaks"]').click();
    await page.locator('#streaks-min-select').selectOption('5');
    assert.equal(await rows.count(), 18);
    await page.locator('#streaks-search').fill('SN00');
    assert.equal(await rows.count(), 0);
    assert.match(await panel.innerText(), /No ended runs match/);
    await page.locator('#streaks-min-select').selectOption('2');
    assert.deepEqual(await symbols(), ['SN00']);
    await page.locator('#streaks-search').fill('');
    await page.locator('#streaks-sector-select').selectOption({label: 'Healthcare'});
    assert.equal(await rows.count(), 12);
    assert((await symbols()).every(sym => Number(sym.slice(2)) % 2 === 0));
    await page.locator('#streaks-sector-select').selectOption('');
    await panel.locator('.streaks-snapped-head').click();
    await page.waitForFunction(() => document.querySelector('.streaks-board').classList.contains('is-snapped-collapsed'));
    await page.locator('#streaks-sort-select').selectOption('cum');
    assert.equal(await panel.getAttribute('open'), null, 'collapse survives sorting');
    await page.reload(); await panel.waitFor();
    assert.equal(await panel.getAttribute('open'), null, 'collapse survives reload');
    await panel.locator('.streaks-snapped-head').focus(); await page.keyboard.press('Enter');
    await rows.first().waitFor();
    const list = panel.locator('.streaks-snapped-list');
    assert(await list.evaluate(el => el.scrollHeight > el.clientHeight));
    assert(await list.evaluate(el => el.scrollWidth <= el.clientWidth), 'no horizontal list overflow');
    await list.focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.streaks-snapped-list').scrollTop > 0);
    await page.locator('[data-view-toggle="streaks"][data-view-mode="table"]').click();
    assert.equal(await rows.count(), 24, 'snapped list survives Table view');
    await page.locator('#streaks-sort-select').selectOption('alpha');
    assert.equal((await symbols())[0], 'SN00');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow at ' + width);
    await page.locator('[data-view-toggle="streaks"][data-view-mode="cards"]').click();
    await list.evaluate(el => {el.scrollTop = 0;});
    await page.evaluate(() => scrollTo(0, document.querySelector('.streaks-board').getBoundingClientRect().top + scrollY - 90));
    await page.screenshot({path: resolve(out, 'streaks-' + width + '-' + theme + '.png')});
    await panel.locator('.streaks-snapped-head').click();
    await page.locator('[data-streak-focus]').click();
    await page.waitForFunction(() => document.querySelector('#streaks-snapped').open);
    assert.equal(await panel.locator('[data-streak-open]:focus').count(), 1, 'decision action opens and focuses snapped stock');
    if (width === 1440 && theme === 'dark') {
      await page.locator('#streaks-min-select').selectOption('5');
      await page.locator('[data-sort-flip="streaks"]').click();
      await page.getByRole('button',{name:'Reset filters',exact:true}).click();
      assert.equal(await page.locator('[data-sort-flip="streaks"]').getAttribute('aria-pressed'),'false');
      await page.reload();await rows.first().waitFor();
      assert.equal(await page.locator('#streaks-min-select').inputValue(),'2');
      assert.equal(await page.locator('#streaks-sort-select').inputValue(),'streak');
      assert.equal(await rows.count(),24,'reset persists across reload');
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS browser ' + width + ' ' + theme);
  }
  // Trend reads: one active 4-day run per read (fixture streaksReadsFixture).
  preview.setScenario('reads');
  for (const width of [1440, 390]) {
    const page = await browser.newPage({viewport: {width, height: 1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({time: new Date(preview.payload.builtAtIso)});
    await page.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({body: ''}));
    await page.goto(preview.base + '/?tab=streaks');
    await page.locator('[data-snapped-symbol]').first().waitFor();
    const cards = page.locator('[data-view-toggle="streaks"][data-view-mode="cards"]');
    if (await cards.count()) await cards.click();
    const tiles = page.locator('.streaks-read-tile');
    assert.equal(await tiles.count(), 4, 'one tile per read');
    assert.match(await tiles.first().innerText(), /1 today/);
    assert.equal(await page.locator('.streaks-active .streaks-read').count(), 4, 'read chip on each 3+ day run');
    assert.match(await page.locator('#streaks-root .flow-decision').first().innerText(), /SN01/, 'evidenced up run leads the desk');
    await page.locator('[data-streak-read="bear-rally"]').click();
    assert.equal(await page.locator('#streaks-read-select').inputValue(), 'bear-rally');
    assert.equal(await page.locator('.streaks-active .streaks-row').count(), 1, 'tile filters to that read');
    assert.match(await page.locator('.streaks-active').innerText(), /SN03/);
    await page.locator('#streaks-read-select').selectOption('');
    assert.equal(await page.locator('.streaks-active .streaks-read').count(), 4);
    await page.locator('[data-view-toggle="streaks"][data-view-mode="table"]').click();
    await page.locator('#streaks-sort-select').selectOption('read');
    const firstRow = page.locator('.streaks-active tbody tr').first();
    assert.match(await firstRow.innerText(), /SN01/, 'read sort puts the strongest read first');
    assert.match(await page.locator('.streaks-active thead').innerText(), /Trend read/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow at ' + width);
    await page.locator('[data-view-toggle="streaks"][data-view-mode="cards"]').click();
    await page.evaluate(() => scrollTo(0, document.querySelector('#streaks-root').getBoundingClientRect().top + scrollY - 90));
    await page.screenshot({path: resolve(out, 'streaks-reads-' + width + '.png')});
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS trend reads ' + width);
  }
  // Public visitor: no Top Picks wording, no Grade sort or decision desk, but
  // the ticker cells, read tiles and stock-page buttons all stay.
  preview.setOwner(false);
  for (const width of [1440, 390]) {
    const page = await browser.newPage({viewport: {width, height: 1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({time: new Date(preview.payload.builtAtIso)});
    await page.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({body: ''}));
    await page.goto(preview.base + '/?tab=streaks');
    await page.locator('[data-snapped-symbol]').first().waitFor();
    assert.equal(await page.locator('#streaks-sort-select option[value="grade"]').count(), 0, 'grade sort is Owner-only');
    assert.equal(await page.locator('#page-pane-streaks .flow-decision').count(), 0, 'decision desk is Owner-only');
    assert.equal(await page.locator('.streaks-read-tile').count(), 4, 'read tiles are public');
    assert.doesNotMatch(await page.locator('#page-pane-streaks').innerText(), /Top Picks/, 'no Top Picks wording for the public');
    await page.locator('[data-view-toggle="streaks"][data-view-mode="table"]').click();
    const tickerCells = await page.locator('.streaks-active tbody tr td:first-child').allInnerTexts();
    assert(tickerCells.length > 0 && tickerCells.every(t => /^SN\d\d/.test(t.trim())), 'public table keeps its ticker column');
    assert.doesNotMatch(await page.locator('.streaks-active thead').innerText(), /Grade|Top Picks/);
    await page.locator('[data-view-toggle="streaks"][data-view-mode="cards"]').click();
    const open = page.locator('.streaks-active [data-streak-open]').first();
    const sym = await open.getAttribute('data-streak-open');
    await open.click();
    await page.waitForURL(url => url.searchParams.get('s') === sym && url.searchParams.get('tab') === 'stock' && !url.searchParams.get('view'));
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS public visitor ' + width);
  }
  preview.setOwner(true);
  preview.setScenario('normal');
  // Exercise the shipped page with the existing cached payload as well
  // (skipped when no hydrated data/ folder is present).
  const cached = existsSync(resolve(process.cwd(), 'data/streaks.json')) ? await createStreaksPreview() : null;
  if (!cached) console.log('SKIP cached payload (no data/streaks.json)');
  if (cached) try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => new URL(r.request().url()).origin === cached.base ? r.continue() : r.fulfill({body: ''}));
    await page.goto(cached.base + '/?tab=streaks');
    const panel = page.locator('#streaks-snapped');
    await panel.locator('[data-snapped-symbol]').first().waitFor();
    assert.equal(await panel.locator('[data-snapped-symbol]').count(), cached.payload.tickers.filter(t => t.lastEnded?.days >= 3 && t.lastEnded.sessionsAgo <= 2).length);
    for (const mode of ['vol', 'tol', 'grade', 'alpha']) await page.locator('#streaks-sort-select').selectOption(mode);
    await page.evaluate(() => scrollTo(0, document.querySelector('.streaks-board').getBoundingClientRect().top + scrollY - 90));
    await page.screenshot({path: resolve(out, 'streaks-cached-desktop.png')});
    await panel.locator('.streaks-snapped-head').click();
    await page.waitForFunction(() => document.querySelector('.streaks-board').classList.contains('is-snapped-collapsed'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'collapsed board does not overflow');
    await page.screenshot({path: resolve(out, 'streaks-cached-collapsed.png')});
    await panel.locator('.streaks-snapped-head').click();
    const first = await panel.locator('[data-streak-open]').first().getAttribute('data-streak-open');
    await panel.locator('[data-streak-open]').first().click();
    await page.waitForURL(url => url.searchParams.get('s') === first && url.searchParams.get('tab') === 'stock' && url.searchParams.get('view') === 'grade');
    assert.deepEqual(errors, []);
    console.log('PASS cached payload and Grade navigation');
  } finally { await new Promise(r => cached.server.close(r)); }
  for (const scenario of ['empty', 'error']) {
    preview.setScenario(scenario);
    const page = await browser.newPage();
    await page.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({body: ''}));
    await page.goto(preview.base + '/?tab=streaks');
    await page.getByText(scenario === 'empty' ? 'No streak data available.' : /Couldn't load streaks/).waitFor();
    assert.equal(await page.locator('#streaks-snapped').count(), 0, 'no stale snapped list on failed/empty load');
    if (scenario === 'error') {
      preview.setScenario('normal');await page.locator('[data-streak-retry]').click();
      await page.locator('[data-snapped-symbol]').first().waitFor();
    }
    await page.close();
  }
} finally { await browser.close(); await new Promise(r => preview.server.close(r)); }
console.log('Screenshots: ' + out);

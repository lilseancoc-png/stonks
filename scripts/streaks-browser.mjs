import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStreaksPreview } from './streaks-preview.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createStreaksPreview({fixture: true});
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
    assert.match(await panel.innerText(), /No snapped runs match/);
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
    assert.equal(await panel.locator('[data-grade]:focus').count(), 1, 'decision action opens and focuses snapped stock');
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
  // Exercise the shipped page with the existing cached payload as well.
  const cached = await createStreaksPreview();
  try {
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
    const first = await panel.locator('[data-grade]').first().getAttribute('data-grade');
    await panel.locator('[data-grade]').first().click();
    await page.waitForURL(url => url.searchParams.get('s') === first && url.searchParams.get('tab') === 'grade');
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

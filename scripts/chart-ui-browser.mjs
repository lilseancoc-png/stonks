// Replays the chart, disclosure grouping and live-toggle flows without providers.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPartyPreview } from './party-tracker-preview.mjs';
import { createLiquidationPreview } from './forced-liquidation-preview.mjs';
import { liquidationFixtureBase, liquidationFixtureNow, liquidationFixtureChain } from './fixtures/forced-liquidation.mjs';
import { buildForcedLiquidationPayload } from '../lib/forced-liquidation.mjs';
import { extractLiquidationFiling } from '../lib/forced-liquidation-sec.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-chart-ui-browser');
await mkdir(output, { recursive: true });
const party = await createPartyPreview(), liquidation = await createLiquidationPreview();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
async function open(base, width, theme = 'dark') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  await page.clock.install({ time: new Date(liquidationFixtureNow) });
  await page.addInitScript(t => localStorage.setItem('stonks-theme', t), theme);
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
  await page.route('**/_vercel/**', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
  page.on('pageerror', e => errors.push(e.stack || e.message));
  return { context, page, errors };
}

try {
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const { context, page, errors } = await open(party.base, width, theme);
    await page.goto(party.base + '/?tab=party-tracker');
    const root = page.locator('#party-tracker-root');
    await root.locator('.pty-chart').first().waitFor();
    for (const chart of await root.locator('.pty-chart').all()) {
      const labels = await chart.locator('.pty-axis text').allTextContents();
      check(labels.includes('Date') && labels.includes('Value of $1 (USD)'), 'Both axes have units and titles');
      check(labels.some(t => /^\$\d+\.\d+/.test(t)) && labels.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t)).length >= 2, 'Numeric and calendar ticks are visible');
      check(await chart.evaluate(svg => [...svg.querySelectorAll('.pty-axis text')].every(t => {
        const b = t.getBoundingClientRect(), p = svg.getBoundingClientRect();
        return b.width > 0 && b.x >= p.x - 1 && b.right <= p.right + 1 && b.y >= p.y && b.bottom <= p.bottom + 1 && b.height >= 9;
      })), 'Axis text fits the chart and remains legible');
    }
    const biden = party.payload.timeline.find(t => t.name === 'Joe Biden');
    await root.locator('.pty-cycles [data-party-cycle="' + biden.id + '"]').click();
    let chart = root.locator('.pty-chart').first();
    check((await chart.locator('.pty-axis text').allTextContents()).some(t => t.startsWith('2021-')), 'Presidency view labels its own dates');
    await chart.scrollIntoViewIfNeeded();
    await page.clock.runFor(1000);
    const positions = await chart.evaluate(svg => {
      const d = JSON.parse(svg.getAttribute('data-cr')), ctm = svg.getScreenCTM();
      return [0, Math.floor(d.d.length / 2)].map(i => ({ x: ctm.a * d.x[i] + ctm.e, y: svg.getBoundingClientRect().y + 90, date: d.d[i] }));
    });
    await page.mouse.move(positions[0].x, positions[0].y);
    await page.mouse.down();
    await page.locator('aside').first().evaluate(el => el.dispatchEvent(new Event('scroll')));
    await page.mouse.move(positions[1].x, positions[1].y, { steps: 5 });
    await page.mouse.up();
    const rangeText = await page.locator('.ch-range-tip').innerText();
    check(rangeText.includes(positions[0].date) && rangeText.includes(positions[1].date), 'Dragging uses plotted coordinates despite sidebar scrolling at ' + width + ' ' + theme + ': ' + rangeText);
    await chart.click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: resolve(output, 'party-' + width + '-' + theme + '.png') });
    const chapter = biden.chapters.find(c => c.path.length >= 2);
    await root.locator('[data-party-chapter="' + chapter.id + '"]').click();
    check(await root.locator('.pty-axis').count() > 0, 'Political chapters keep their axes');
    for (const term of party.payload.timeline) {
      await root.locator('.pty-cycles [data-party-cycle="' + term.id + '"]').click();
      for (const stretch of [term, ...term.chapters]) {
        await root.locator('[data-party-chapter="' + (stretch === term ? 'term' : stretch.id) + '"]').click();
        const plotted = JSON.parse(await root.locator('.pty-chart').getAttribute('data-cr'));
        check(plotted.s[0].v[0] === 1 && Math.abs((plotted.s[0].v.at(-1) - 1) * 100 - stretch.totalPct) < 0.05, 'Each term and chapter chart spans its full reported return');
      }
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Party layout fits viewport');
    check(errors.length === 0, errors.join('\n'));
    await context.close();
  }

  // Three source excerpts for one stock must stay auditable without three watch rows.
  const base = { ...liquidationFixtureBase, borrower: null, facilityKey: null, principalBorrowed: null, maintenanceLtv: null };
  let observations = [
    { ...base, fragmentId: 0, disclosedShares: null, sharesPledged: null, shareBasis: 'undisclosed', excerpt: 'SYNTHETIC generic pledge disclosure.' },
    { ...base, fragmentId: 1, disclosedShares: 500000, sharesPledged: null, disclosedShareBasis: 'initial-only', shareBasis: 'initial-only', excerpt: 'SYNTHETIC initial pledge disclosure.' },
    { ...base, fragmentId: 2, disclosedShares: 500000, sharesPledged: 500000, disclosedShareBasis: 'stated-current', shareBasis: 'stated-current', excerpt: 'SYNTHETIC current pledge disclosure.' },
  ];
  if (process.env.ARM_FILING_FILE) observations = extractLiquidationFiling(await readFile(process.env.ARM_FILING_FILE, 'utf8'), {
    accessionNumber: '0001973239-26-000097', filingDate: '2026-05-26', form: '20-F',
    url: 'https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm',
  }, { symbol: 'ARM', company: 'Arm Holdings plc', issuerVerified: true }).filter(r => r.kind === 'equity-pledge');
  const symbol = observations[0].symbol;
  const payload = buildForcedLiquidationPayload({ observations, builtAtIso: liquidationFixtureNow, coverage: { ...liquidation.payload.coverage, universeSymbols: [symbol] }, chains: { [symbol]: liquidationFixtureChain() } });
  check(payload.rows.length === 3, 'Replay contains three separate source records');
  check(new Set(payload.rows.map(r => r.stress?.score)).size > 1, 'Replay has different disclosure scores to verify representative selection');
  for (const width of [1440, 390]) {
    const { context, page, errors } = await open(liquidation.base, width);
    const root = page.locator('#forced-liquidation-root');
    const retained = structuredClone(payload), repeated = structuredClone(payload.rows[0]);
    repeated.id += '-duplicate'; repeated.observation.fragmentId += 100;
    retained.rows.push(repeated);
    await page.route('**/api/auth/me?data=forced-liquidation.json', r => r.fulfill({ json: retained }));
    await page.goto(liquidation.base + '/?tab=forced-liquidation');
    await root.locator('.fl-table').waitFor();
    check(await root.locator('.fl-table tbody tr').count() === 1, 'One stock produces one watchlist row');
    check((await root.innerText()).includes('3 matching disclosures'), 'Repeated evidence is explained');
    const highest = Math.max(...payload.rows.map(r => r.stress?.score ?? -1));
    check(Number(await root.locator('.fl-stress').innerText()) === highest, 'Row shows highest disclosure score, without adding scores');
    const downloadPromise = page.waitForEvent('download');
    await root.locator('[data-fl-export]').click();
    const csv = await readFile(await (await downloadPromise).path(), 'utf8');
    check(csv.split('\r\n').length === 4, 'CSV preserves every source record');
    await root.locator('.fl-table').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'liquidation-' + width + '.png') });
    await root.locator('.fl-table [data-fl-open]').click();
    const picker = root.locator('[data-fl-disclosure]');
    check(await picker.locator('option').count() === 3, 'Every disclosure is reachable in details');
    for (const record of payload.rows) {
      await picker.selectOption(record.id);
      check((await root.locator('.fl-excerpt').innerText()) === record.observation.excerpt, 'Picker opens the original evidence');
      check(await picker.inputValue() === record.id, 'Selection follows the inspected record');
    }
    await page.reload();
    await picker.waitFor();
    check(await picker.inputValue() === payload.rows.at(-1).id, 'Disclosure selection survives reload');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Disclosure selector fits phone width');
    check(errors.length === 0, errors.join('\n'));
    await context.close();
  }

  {
    const near = { ...liquidationFixtureBase, sharesPledged: 1000, disclosedShares: 1000, principalBorrowed: 10000 };
    const far = { ...near, fragmentId: 1, borrower: 'Another Borrower', facilityKey: 'other-facility', sharesPledged: 1e9, disclosedShares: 1e9, principalBorrowed: 1e6 };
    const body = buildForcedLiquidationPayload({ observations: [near, far], builtAtIso: liquidationFixtureNow, coverage: liquidation.payload.coverage, chains: { ATLS: liquidationFixtureChain() } });
    check(body.rows.find(r => r.borrower === far.borrower).stress.score > body.rows.find(r => r.borrower === near.borrower).stress.score, 'Separate facility has higher stress but no nearby threshold');
    const { context, page, errors } = await open(liquidation.base, 1440);
    await page.route('**/api/auth/me?data=forced-liquidation.json', r => r.fulfill({ json: body }));
    await page.goto(liquidation.base + '/?tab=forced-liquidation');
    const root = page.locator('#forced-liquidation-root');
    await root.locator('.fl-table').waitFor();
    check((await root.locator('.fl-table tbody').innerText()).includes('9.1%'), 'Nearby threshold cannot be hidden by a higher stress score for another loan');
    await root.locator('.fl-table [data-fl-open]').click();
    check((await root.locator('.fl-detail-head').innerText()).includes(near.borrower), 'Priority disclosure keeps its own borrower and terms');
    check(await root.locator('[data-fl-disclosure] option').count() === 2, 'Other facility remains independently reviewable');
    check(errors.length === 0, errors.join('\n'));
    await context.close();
  }

  // Start on, disable while a request is pending, then enable again.
  {
    const { context, page, errors } = await open(party.base, 1440);
    const apple = { t: 'AAPL', n: 'Apple', s: 'Mega-cap tech', mc: 1e12, sp: 100, ch: 1, rv: 1, av20: 1000, stale: true, perf: { '1w': 5 }, perfStart: { '1w': '2026-10-16' } };
    const heatmap = { builtAtIso: liquidationFixtureNow, tickers: [apple, { ...apple }, { ...apple, t: 'MSFT', n: 'Microsoft', stale: false, sp: 200, ch: 2 }] };
    await page.route('**/data/heatmap.json*', r => r.fulfill({ json: heatmap }));
    await page.route('**/api/auth/me?data=heatmap.json', r => r.fulfill({ json: heatmap }));
    let release, requested;
    const pending = new Promise(resolve => { requested = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let count = 0;
    let quotes = [{ symbol: 'AAPL', spot: 110, changePct: 10, marketState: 'REGULAR', regularAsOf: liquidationFixtureNow }];
    await page.route('**/api/quotes?*', async r => {
      count++; requested();
      await gate;
      await r.fulfill({ json: { quotes } });
    });
    await page.goto(party.base + '/?tab=heatmap');
    const toggle = page.locator('#heatmap-live-toggle');
    await page.locator('.heatmap-tile').first().waitFor();
    check(await toggle.isChecked(), 'Live overlay defaults on');
    check(await page.locator('.heatmap-tile').count() === 2, 'Duplicate ticker rows cannot inflate tiles or breadth');
    await pending;
    const responseDone = page.waitForResponse(r => new URL(r.url()).pathname === '/api/quotes');
    await toggle.uncheck(); release();
    await responseDone;
    await page.clock.runFor(50);
    check(await page.locator('#heatmap-live-state').innerText() === '', 'A late quote cannot revive an overlay switched off');
    const afterOff = count;
    await page.clock.runFor(31000);
    check(count === afterOff, 'Disabling stops polling');
    await page.reload();
    await page.locator('.heatmap-tile').first().waitFor();
    check(!(await toggle.isChecked()), 'Explicit off preference survives reload');
    await toggle.check();
    await page.locator('#heatmap-live-state.is-live').waitFor();
    check((await page.locator('.heatmap-tile[data-sym="AAPL"]').innerText()).includes('10.0'), 'Turning on applies live quotes');
    const liveLabel = await page.locator('#heatmap-live-state').innerText();
    check(liveLabel.toLowerCase().includes('1/2 stocks'), 'Live coverage distinguishes current quotes from saved values: ' + liveLabel);
    quotes = [{ symbol: 'MSFT', spot: 180, changePct: -10, dayVolume: 0, marketState: 'REGULAR', regularAsOf: liquidationFixtureNow }];
    await page.clock.runFor(31000);
    await page.waitForFunction(() => document.querySelector('.heatmap-tile[data-sym="MSFT"]')?.getAttribute('data-sp') === '180');
    const appleTile = page.locator('.heatmap-tile[data-sym="AAPL"]');
    check(await appleTile.getAttribute('data-ch') === '1' && await appleTile.getAttribute('data-sp') === '100', 'A symbol missing from the new response fully restores saved return and price');
    check((await appleTile.getAttribute('class')).includes('is-stale'), 'Saved stale marker is restored with the saved quote');
    check(await page.locator('.heatmap-tile[data-sym="MSFT"]').getAttribute('data-rv') === '0', 'Zero actual trading volume is not replaced by an older volume multiple');
    await appleTile.hover();
    check((await page.locator('#heatmap-tooltip').innerText()).includes('Saved snapshot'), 'Tooltip explains its data source');
    const tip = await page.locator('#heatmap-tooltip').boundingBox();
    check(tip.x >= 0 && tip.y >= 0 && tip.x + tip.width <= 1440 && tip.y + tip.height <= 1000, 'Tooltip stays in the visible viewport');
    quotes = [{ symbol: 'AAPL', spot: 999, changePct: 99, marketState: 'REGULAR', regularAsOf: '2026-10-01T20:00:00Z' }];
    await page.clock.runFor(31000);
    await page.waitForFunction(() => document.querySelector('#heatmap-live-state')?.textContent.includes('No fresh live quotes'));
    check(await appleTile.getAttribute('data-sp') === '100', 'Old trades cannot be relabeled live by a fresh response');
    quotes = [{ symbol: 'AAPL', spot: 999, changePct: 99, marketState: 'POST', regularAsOf: liquidationFixtureNow }];
    await page.clock.runFor(31000);
    await page.waitForFunction(() => document.querySelector('#heatmap-live-state')?.textContent.includes('After hours'));
    check(await appleTile.getAttribute('data-sp') === '100', 'Extended-hours prices cannot recolor a regular-session heatmap');
    await page.screenshot({ path: resolve(output, 'heatmap-live.png') });
    await page.locator('[data-page-tab="party-tracker"]').first().click();
    const beforeHidden = count;
    await page.clock.runFor(31000);
    check(count === beforeHidden, 'Leaving heatmap stops its requests');
    check(errors.length === 0, errors.join('\n'));
    await context.close();
  }
  console.log('Chart UI browser: ' + checks + ' checks passed. Screenshots: ' + output);
} finally {
  await browser.close();
  await Promise.all([new Promise(done => party.server.close(done)), new Promise(done => liquidation.server.close(done))]);
}

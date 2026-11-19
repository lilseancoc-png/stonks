// Browser check for the wide list (2026-11-19): the Heatmap's Tracked / Wide
// switch, our names outlined, "Vs its sector" colour, the sector table and
// "worth a look" list, untracked tiles that do not open a stock page, no live
// polling in Wide mode, the off / missing / stale file states, and the Market
// map breadth switch. Runs as a public visitor and as the Owner at 1440 light
// and 390 dark; the public run fails if any Owner-only file is requested.
// Synthetic data only (scripts/fixtures/wide-tier.mjs); nothing leaves the machine.
//
//   node scripts/wide-tier-browser.mjs            (WIDE_BROWSER_SHOTS=dir saves screenshots)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, settle, selfTest } from './browser-harness.mjs';
import { fixtureRun } from './fixtures/wide-tier.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
import { sectorGroupOfLabel } from '../lib/sector-groups.mjs';
const { TICKERS, SECTORS } = await import('./build.mjs');

const AS_OF = '2026-11-18';
const NOW = '2026-11-19T15:30:00Z'; // 10:30 ET, the next session
const SHOTS = process.env.WIDE_BROWSER_SHOTS || '';
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const tracked = TICKERS.filter((s) => sectorGroupOfLabel(SECTORS[s]) && sectorGroupOfLabel(SECTORS[s]) !== 'ETF');
const groupOf = (s) => sectorGroupOfLabel(SECTORS[s]);
const { out, mkt } = await fixtureRun({ asOf: AS_OF, tracked, groupOf, groupOrder: [...new Set(tracked.map(groupOf))], unusual: { scannedAt: AS_OF + 'T20:00:00Z', tickers: [{ symbol: tracked[0], contracts: [{}] }] } });
const wide = { ...out.payload, refreshedAtIso: '2026-11-19T15:05:00Z', builtAtIso: '2026-11-18T21:20:00Z' };
const heatmap = {
  builtAtIso: '2026-11-19T15:00:00Z', refreshedAtIso: '2026-11-19T15:05:00Z', marketState: 'REGULAR',
  tickers: tracked.map((s) => { const p = mkt.path(s); const L = p[p.length - 1], P = p[p.length - 2]; return { t: s, n: s + ' Synthetic', s: groupOf(s), i: SECTORS[s], mc: 1e10 + (s.charCodeAt(0) * 1e9), sp: L.c, ch: Math.round((L.c / P.c - 1) * 10000) / 100, perf: { '1w': 1, '1m': 2, '3m': 3, ytd: 4, '1y': 5 }, rv: 1.1 }; }),
};
const marketMap = { builtAtIso: '2026-11-18T21:20:00Z', rows: [], breadth: wide.breadth, notes: { breadth: 'Synthetic tracked breadth.' } };
let wideFile = wide;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => key === 'wide-tier.json' ? wideFile : key === 'heatmap.json' ? heatmap : key === 'market-map.json' ? marketMap : null,
  api: (url) => url.pathname === '/api/quotes' ? { quotes: [] } : undefined,
});
let owner = false;
const browser = await launchBrowser();
await selfTest(browser, server.base);
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const stockRows = wide.tickers.filter((r) => !r.fund && r.mc > 0);
const ourRows = stockRows.filter((r) => r.tr);

async function openHeatmap(opts, { wideSaved = false } = {}) {
  const s = await openTab(browser, server.base, { tab: 'heatmap', now: NOW, ...opts });
  if (wideSaved) {
    await s.page.evaluate(() => { const v = JSON.parse(localStorage.getItem('stonks-views-v1') || '{}'); v['heatmap.source'] = 'wide'; localStorage.setItem('stonks-views-v1', JSON.stringify(v)); });
    await s.page.reload({ waitUntil: 'domcontentloaded' });
  }
  await settle(s.page, 900);
  return s;
}

for (const [label, opts] of [['public 1440 light', { width: 1440, theme: 'light' }], ['owner 1440 light', { width: 1440, theme: 'light', owner: true }], ['public 390 dark', { width: 390, height: 844, theme: 'dark' }], ['owner 390 dark', { width: 390, height: 844, theme: 'dark', owner: true }]]) {
  owner = !!opts.owner;
  wideFile = wide;
  server.asks.data.length = 0; server.asks.api.length = 0;
  const s = await openHeatmap(opts);
  const { page } = s;
  // Tracked first: no wide file requested until Wide is picked.
  check(!server.asks.data.includes('wide-tier.json'), label + ': wide file loaded before Wide was picked');
  const trackedTiles = await page.locator('#heatmap-root .heatmap-tile').count();
  check(trackedTiles === tracked.length, label + `: tracked map has ${trackedTiles} tiles, expected ${tracked.length}`);
  await page.click('[data-heatmap-source="wide"]');
  await settle(page, 700);
  const tiles = await page.locator('#heatmap-root .heatmap-tile').count();
  check(tiles === stockRows.length, label + `: wide map has ${tiles} tiles, expected ${stockRows.length}`);
  const ours = await page.locator('#heatmap-root .heatmap-tile.is-ours').count();
  check(ours === ourRows.length, label + `: ${ours} outlined, expected ${ourRows.length}`);
  check(await page.locator('[data-heatmap-source="wide"][aria-pressed="true"]').count() === 1, label + ': switch shows Wide');
  check(await page.locator('#heatmap-live-toggle').isDisabled(), label + ': live toggle not disabled in Wide');
  check(/wide list/i.test(await page.locator('#heatmap-live-state').innerText()), label + ': live state does not say Wide list');
  check(await page.locator('#heatmap-wide').isVisible(), label + ': wide panel hidden');
  const secRows = await page.locator('#heatmap-wide table').first().locator('tbody tr').count();
  check(secRows === 11, label + `: sector table has ${secRows} rows`);
  check(/Our groups/.test(await page.locator('#heatmap-wide').innerText()), label + ': no Our groups table');
  check(/Worth a look/.test(await page.locator('#heatmap-wide').innerText()), label + ': no worth-a-look list');
  check(await page.locator('#heatmap-eod-summary').isHidden(), label + ': EOD summary shown in Wide');
  // No live polling in Wide mode.
  const quoteAsks = server.asks.api.filter((u) => u.startsWith('/api/quotes')).length;
  await page.waitForTimeout(1200);
  check(server.asks.api.filter((u) => u.startsWith('/api/quotes')).length === quoteAsks, label + ': live quotes polled in Wide mode');
  // An untracked tile does not navigate; it shows its details.
  const untracked = stockRows.find((r) => !r.tr && r.mc > 2e11);
  if (untracked) {
    const tile = page.locator(`#heatmap-root .heatmap-tile[data-sym="${untracked.t}"]`);
    await tile.click({ force: true });
    await page.waitForTimeout(300);
    check(new URL(page.url()).searchParams.get('tab') === 'heatmap', label + ': untracked tile navigated away');
    if (opts.width > 600) check(/no stock page/.test(await page.locator('#heatmap-tooltip').innerText().catch(() => '')), label + ': untracked tooltip missing its note');
  }
  // Vs its sector colour.
  await page.selectOption('#heatmap-color-select', 'rel');
  await settle(page, 300);
  const relTexts = await page.locator('#heatmap-root .heatmap-tile .heatmap-tile-pct').allTextContents();
  check(relTexts.length && relTexts.every((t) => /pts$|^—$/.test(t)) && relTexts.some((t) => /pts$/.test(t)), label + `: vs-sector tile text ${relTexts.slice(0, 3).join(' | ')}`);
  check(/beat its sector/.test(await page.locator('#heatmap-legend').innerText()), label + ': vs-sector legend');
  // List view: tracked names link, others do not.
  await page.selectOption('#heatmap-layout-select', 'list');
  await settle(page, 300);
  const links = await page.locator('#heatmap-alt table tbody tr td:first-child a').count();
  check(links === ourRows.length, label + `: list links ${links} names, expected ${ourRows.length}`);
  if (SHOTS) await page.screenshot({ path: resolve(SHOTS, label.replace(/\s+/g, '-') + '-list.png'), fullPage: false });
  await page.selectOption('#heatmap-layout-select', 'map');
  await page.selectOption('#heatmap-color-select', 'perf');
  await settle(page, 300);
  if (SHOTS) {
    await page.locator('#heatmap-section').screenshot({ path: resolve(SHOTS, label.replace(/\s+/g, '-') + '-wide.png') });
  }
  (await pageProblems(s)).forEach((p) => failures.push(label + ': ' + p));
  // Back to Tracked restores the tracked map and live overlay control.
  await page.click('[data-heatmap-source="tracked"]');
  await settle(page, 500);
  check(await page.locator('#heatmap-root .heatmap-tile').count() === tracked.length, label + ': tracked map not restored');
  check(!(await page.locator('#heatmap-live-toggle').isDisabled()), label + ': live toggle stays disabled');
  check(await page.locator('#heatmap-wide').isHidden(), label + ': wide panel still shown in Tracked');
  // Market map breadth switch.
  await page.goto(server.base + '/?tab=market-map', { waitUntil: 'domcontentloaded' });
  await settle(page, 700);
  const tabBtn = page.locator('[data-mm-tab="breadth"]');
  if (await tabBtn.count()) { await tabBtn.first().click(); await settle(page, 600); }
  check(await page.locator('[data-mm-breadth-src="tracked"][aria-pressed="true"]').count() === 1, label + ': breadth switch missing');
  await page.click('[data-mm-breadth-src="wide"]');
  await settle(page, 900);
  check(/S&P 500 and Nasdaq-100 stocks/.test(await page.locator('#mm-root').innerText()), label + ': wide breadth lede');
  check(await page.locator('#mm-breadth-1 canvas').count() > 0, label + ': wide breadth chart not drawn');
  if (SHOTS) await page.locator('#mm-root').screenshot({ path: resolve(SHOTS, label.replace(/\s+/g, '-') + '-breadth.png') });
  (await pageProblems(s)).forEach((p) => failures.push(label + ' market map: ' + p));
  if (!owner) {
    const ownerAsks = server.asks.data.filter((k) => isPremiumKey(k));
    check(!ownerAsks.length, label + ': public visitor asked for Owner files ' + ownerAsks.join(','));
  }
  await s.context.close();
}

// File states: off, missing, stale, and a saved Wide choice on load.
owner = false;
for (const [label, file, expect] of [
  ['off', { version: 1, enabled: false, builtAtIso: '2026-11-19T15:00:00Z', note: 'off' }, /turned off/],
  ['missing', null, /has not been built yet/],
  ['stale', { ...wide, refreshedAtIso: '2026-11-10T20:00:00Z', builtAtIso: '2026-11-10T20:00:00Z' }, /trading sessions old/],
]) {
  wideFile = file;
  const s = await openHeatmap({ width: 1440, theme: 'light' }, { wideSaved: true });
  const text = await s.page.locator('#heatmap-section').innerText();
  check(expect.test(text), `${label} file: expected ${expect} on the page`);
  check(await s.page.locator('[data-heatmap-source="wide"][aria-pressed="true"]').count() === 1, `${label} file: saved Wide choice not restored`);
  (await pageProblems(s)).forEach((p) => failures.push(label + ' file: ' + p));
  if (label !== 'stale') {
    await s.page.click('[data-heatmap-source="tracked"]');
    await settle(s.page, 400);
    check(await s.page.locator('#heatmap-root .heatmap-tile').count() === tracked.length, `${label} file: switching back to Tracked did not restore the map`);
  }
  await s.context.close();
}

await browser.close();
await server.close();
if (failures.length) { console.error('wide-tier-browser: ' + failures.length + ' problem(s)\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`wide-tier-browser: ok (${stockRows.length} wide names, ${ourRows.length} ours; public and Owner at 1440 light and 390 dark; off, missing and stale files)`);

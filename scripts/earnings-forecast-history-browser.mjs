// Browser check for the Earnings Forecast "History test" view and the ranges
// on the Forecast view (2026-11-16). The page file comes from the real build
// step run on made-up companies: one history where a newer-growth rule wins,
// one where the current rule stands, one too thin for a verdict, a stale copy
// and a page file written before the test existed. Owner-only page; a public
// visit is covered by scripts/earnings-forecast-browser.mjs.
// Run: node scripts/earnings-forecast-history-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createEarningsPreview } from './earnings-forecast-preview.mjs';
import { prepareEarningsForecast, readForecastState } from './refresh-earnings-forecast.mjs';
import { selectCohort } from '../lib/earnings-forecast.mjs';
import { historyUniverse, historyFred } from './fixtures/earnings-forecast-history.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.EARNINGS_HISTORY_BROWSER_OUT || resolve(tmpdir(), 'stonks-earnings-forecast-history-browser');
await mkdir(out, { recursive: true });
const dir = await mkdtemp(resolve(tmpdir(), 'earnings-forecast-history-')), asOf = '2026-11-16T12:00:00.000Z';

async function payloadFor(mode, { companies = 12 } = {}) {
  const uni = historyUniverse({ mode, companies }), symbols = Object.keys(uni), state = await readForecastState(resolve(dir, 'none-' + mode + companies));
  const chains = Object.fromEntries(symbols.map((s, i) => [s, { spot: 100, quoteAsOf: asOf, quoteProvenance: { currency: 'USD' }, fundamentals: { name: 'Made-up company ' + i, marketCap: (40 - i) * 1e10, financialCurrency: 'USD', forwardPE: 20 } }]));
  state.cohort = selectCohort(chains, symbols, {}, asOf);
  for (const s of symbols) state.observations[s] = uni[s];
  const prepared = await prepareEarningsForecast({ previous: state, chains, universe: symbols, sectors: {}, cikMap: new Map(), now: () => asOf, fred: historyFred(), fetchImpl: () => { throw Error('The browser fixture must not contact a provider'); } });
  return prepared.payload;
}
const files = {};
async function save(name, payload) { files[name] = resolve(dir, name + '.json'); await writeFile(files[name], JSON.stringify(payload)); return payload; }
const winner = await save('winner', await payloadFor('trending'));
const stands = await save('stands', await payloadFor('steady'));
const thin = await save('thin', await payloadFor('trending', { companies: 2 }));
await save('stale', { ...winner, historyTest: { ...winner.historyTest, stale: true } });
const before = structuredClone(winner); delete before.historyTest; for (const c of before.companies) { delete c.forecast.bands; c.forecast.history = null; }
await save('before', before);
assert.equal(winner.historyTest.verdict, 'promoted'); assert.equal(stands.historyTest.verdict, 'current-stands'); assert.equal(thin.historyTest.verdict, 'collecting');

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let checks = 0;
const check = (cond, label) => { assert.ok(cond, label); checks++; };
const JUNK = /undefined|NaN|\[object Object\]|Infinity/;

async function open(name, { width = 1440, theme = 'light' } = {}) {
  const preview = await createEarningsPreview({ payloadFile: files[name] });
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } }), page = await ctx.newPage(), errors = [];
  await page.addInitScript((t) => localStorage.setItem('stonks-theme', t), theme);
  await page.clock.install({ time: new Date(asOf) });
  await page.route('**/*', (r) => (new URL(r.request().url()).origin === preview.base ? r.continue() : r.fulfill({ body: '' })));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(preview.base + '/?tab=earnings-forecast');
  const root = page.locator('#earnings-forecast-root');
  await root.locator('.ef-company-head').waitFor({ timeout: 15000 });
  const close = async () => { await ctx.close(); await new Promise((r) => preview.server.close(r)); };
  return { page, root, errors, close };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  for (const vp of [{ width: 1440, theme: 'light' }, { width: 390, theme: 'dark' }]) {
    const tag = vp.width + ' ' + vp.theme, s = await open('winner', vp), t = winner.historyTest;
    // Forecast view: ranges and the rule in use.
    const range = s.root.locator('.ef-range');
    check(await range.count() === 1, tag + ': the forecast shows its ranges');
    const rangeText = await range.innerText();
    check(/Revenue/.test(rangeText) && /Diluted EPS/.test(rangeText) && /half the time/.test(rangeText) && /four times in five/.test(rangeText), tag + ': revenue and EPS each show a likely and a wide range');
    check(!JUNK.test(rangeText) && !/Unavailable/.test(rangeText), tag + ': the ranges carry real values');
    check(await s.root.locator('.ef-range-row').count() === 2, tag + ': one row per number');
    const forecastText = await s.root.innerText();
    check(new RegExp('Revenue rule in use: ' + t.winner.label).test(forecastText), tag + ': the forecast names the rule in use');
    check(/Point forecast with ranges from past misses/.test(forecastText) && !/Uncalibrated point forecast/.test(forecastText), tag + ': the "uncalibrated" line gives way to the ranges');
    check(await noOverflow(s.page), tag + ': the forecast view does not scroll sideways');
    await s.page.screenshot({ path: resolve(out, 'forecast-' + vp.width + '-' + vp.theme + '.png'), fullPage: true });
    // History test view.
    check(await s.root.locator('.ef-tabs [data-ef-view="history"]').count() === 1, tag + ': the History test tab is offered');
    await s.root.locator('.ef-tabs [data-ef-view="history"]').click();
    const verdict = s.root.locator('.ef-verdict');
    check(await verdict.getAttribute('data-ef-verdict') === 'promoted' && /beat the current rule/.test(await verdict.innerText()), tag + ': the verdict leads the view');
    const text = await s.root.innerText();
    check(!JUNK.test(text), tag + ': no raw values in the view');
    for (const m of t.models) check(text.includes(m.label), tag + ': rule listed: ' + m.label);
    const tables = s.root.locator('.ef-table');
    check(await tables.nth(0).locator('tbody tr').count() === t.models.length, tag + ': one row per rule');
    check((await tables.nth(0).locator('tbody tr', { hasText: 'In use' }).count()) === 1 && (await tables.nth(0).locator('tbody tr', { hasText: 'In use' }).innerText()).includes(t.winner.label), tag + ': exactly the winner is marked In use');
    check(/Do the ranges hold\?/.test(text) && await tables.nth(1).locator('tbody tr').count() === 4, tag + ': four range checks');
    check(/\d+(\.\d)?%/.test(await tables.nth(1).locator('tbody tr').first().innerText()), tag + ': the range check shows the share that landed inside');
    check(/Earnings per share/.test(text) && await tables.nth(2).locator('tbody tr').count() === 3, tag + ': three EPS rules');
    check(/Against analysts/.test(text) && /saved from now on/.test(text), tag + ': the analyst comparison says what is being collected');
    check(/What the drivers rule learned/.test(text) && /Companies that already reported/.test(text), tag + ': the drivers rule shows its inputs');
    check(/H00 in the test/.test(text) && /Closest rule here/.test(text), tag + ': the selected company has its own row');
    check(await s.root.locator('details.ef-method').count() >= 1, tag + ': the limits are one tap away');
    check(await noOverflow(s.page), tag + ': the History test view does not scroll sideways');
    await s.page.screenshot({ path: resolve(out, 'history-' + vp.width + '-' + vp.theme + '.png'), fullPage: true });
    // Another company, and the choice survives a reload.
    await s.root.locator('[data-ef-company="H05"]').click();
    check(/H05 in the test/.test(await s.root.innerText()), tag + ': switching company keeps the view and updates the company row');
    await s.page.reload(); await s.root.locator('.ef-company-head').waitFor();
    check(await s.root.locator('[data-ef-view="history"]').getAttribute('aria-pressed') === 'true', tag + ': the view is remembered');
    // Track record names the rule.
    await s.root.locator('.ef-tabs [data-ef-view="record"]').click();
    check(/History test rule/.test(await s.root.innerText()) && /Passed the history test; in use/.test(await s.root.innerText()), tag + ': the track record names the rule and its status');
    check(s.errors.length === 0, tag + ': no page errors (' + s.errors.join(' | ') + ')');
    await s.close();
  }

  // The current rule stands.
  {
    const s = await open('stands');
    check(await s.root.locator('.ef-range').count() === 1 && !/Revenue rule in use/.test(await s.root.innerText()), 'no winner: ranges show, no rule swap is announced');
    await s.root.locator('.ef-tabs [data-ef-view="history"]').click();
    check(await s.root.locator('.ef-verdict').getAttribute('data-ef-verdict') === 'current-stands' && /No rule beat the current one/.test(await s.root.locator('.ef-verdict').innerText()), 'no winner: the verdict says the current rule stays');
    const row = s.root.locator('.ef-table').first().locator('tbody tr', { hasText: 'In use' });
    check(await row.count() === 1 && /Current rule/.test(await row.innerText()), 'no winner: the current rule is the one in use');
    check((await s.root.locator('.ef-table').first().locator('tbody tr', { hasText: 'Did not pass' }).count()) === 4, 'no winner: every candidate reads Did not pass');
    await s.root.locator('.ef-tabs [data-ef-view="record"]').click();
    check(!/History test rule/.test(await s.root.innerText()), 'no winner: the track record adds nothing');
    check(s.errors.length === 0, 'no winner: no page errors');
    await s.page.screenshot({ path: resolve(out, 'history-stands.png'), fullPage: true });
    await s.close();
  }

  // Too little history for a verdict or a range.
  {
    const s = await open('thin');
    check(await s.root.locator('.ef-range').count() === (thin.companies[0].forecast.bands ? 1 : 0), 'thin history: ranges follow the data');
    await s.root.locator('.ef-tabs [data-ef-view="history"]').click();
    const text = await s.root.innerText();
    check(await s.root.locator('.ef-verdict').getAttribute('data-ef-verdict') === 'collecting' && /Collecting/.test(text) && !JUNK.test(text), 'thin history: the view says it is collecting');
    check(s.errors.length === 0, 'thin history: no page errors');
    await s.close();
  }

  // A stale copy and a page file from before the test existed.
  {
    const s = await open('stale');
    await s.root.locator('.ef-tabs [data-ef-view="history"]').click();
    check(/last good copy/.test(await s.root.innerText()), 'a stale test says it is the last good copy');
    await s.close();
    const b = await open('before');
    check(await b.root.locator('.ef-range').count() === 0 && /Uncalibrated point forecast/.test(await b.root.innerText()), 'an older page file keeps the old forecast line');
    await b.root.locator('.ef-tabs [data-ef-view="history"]').click();
    check(/has not run yet/.test(await b.root.innerText()) && b.errors.length === 0, 'an older page file shows one hint, not a broken view');
    await b.close();
  }
  console.log(`earnings-forecast history browser: ok (${checks} checks; screenshots in ${out})`);
} finally {
  await browser.close();
}

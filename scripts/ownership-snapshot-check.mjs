// Validate a saved, real SEC snapshot through the actual publisher, freshness
// verifier, and shipped browser. No requests leave the local preview server.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { write13FFile } from './build.mjs';
import { auditFreshness, BAKE_REQUIRED_REWRITTEN_FILES } from './verify-data-freshness.mjs';
import { bakeKeysToPublish } from '../lib/data-ownership.mjs';
import { createOwnershipPreview } from './ownership-preview.mjs';

const input = process.argv.find(s => s.startsWith('--input='))?.slice(8);
assert(input, 'Pass --input=/absolute/path/to/saved-full-ownership-snapshot.json');
const payload = JSON.parse(await readFile(resolve(input), 'utf8'));
const dir = await mkdtemp(resolve(tmpdir(), 'ownership-real-publication-'));
const now = new Date(), stamp = now.toISOString(), start = new Date(now.getTime() - 60000).toISOString();
const write = async (key, body) => { await mkdir(dirname(resolve(dir, key)), { recursive: true }); await writeFile(resolve(dir, key), JSON.stringify(body)); };
try {
  for (const key of BAKE_REQUIRED_REWRITTEN_FILES) await write(key, { builtAtIso: stamp, refreshedAtIso: stamp });
  await write('grades.json', { builtAtIso: stamp, grades: {} });
  for (const key of ['manifest.json', 'manifest-free.json']) await write(key, { _meta: { dataBuiltAtIso: stamp, renderedAtIso: stamp } });
  await write('macro.json', { asOf: stamp, twoY: { value: 4 }, tenY: { value: 4 }, dxy: { value: 100 } });
  await write13FFile({}, [], stamp, { ...payload, targetReportDate: payload.periodEndIso }, { dataDir: dir });
  const report = await auditFreshness({ owner: 'bake', dataDir: dir, runStartedAt: start, now, expectedSymbols: [] });
  assert.deepEqual(report.errors, [], 'real SEC books pass the complete freshness/publication boundary');
  const root = JSON.parse(await readFile(resolve(dir, '13f.json'), 'utf8'));
  const parts = (await (await import('node:fs/promises')).readdir(resolve(dir, '13f-books'))).map(f => '13f-books/' + f);
  const published = new Set(bakeKeysToPublish(['13f.json', ...parts], report.heldBack));
  assert(parts.every(k => published.has(k)));
  assert.equal(Object.values(root.perFirm).filter(f => f?.holdingsParts).length, 14);
  console.log('Real SEC snapshot: 14 manager books and ' + parts.length + ' immutable parts pass the actual freshness and upload boundary.');
} finally { await rm(dir, { recursive: true, force: true }); }

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createOwnershipPreview({ snapshotPath: resolve(input), gated: true });
const output = process.env.OWNERSHIP_BROWSER_OUT || resolve(tmpdir(), 'stonks-ownership-browser');
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [], reads = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('13f-books')) reads.push(r.url()); });
    await page.route('**/*', route => new URL(route.request().url()).origin === preview.base ? route.continue() : route.fulfill({ body: '' }));
    await page.goto(preview.base + '/?tab=f13');
    const root = page.locator('#ownership-explorer-root');
    await root.getByText('14 / 14 full books').waitFor({ timeout: 30000 });
    assert(reads.some(url => url.includes('/api/auth/me?data=13f-books')), 'exercise the real deployment data URL shape');
    const search = page.locator('#own-search');
    await search.fill('NVDA');
    const expected = Object.values(payload.perFirm).flatMap(f => f?.holdings || []).filter(r => !r.isExit && r.ticker === 'NVDA').length;
    assert(expected > 0);
    assert.match(await page.locator('#own-summary').innerText(), new RegExp('^' + expected + ' matching disclosures'));
    const first = root.locator('.own-row-details').first();
    await first.locator('summary').click();
    await first.getByText('Voting sole', { exact: true }).first().waitFor();
    await root.locator('[data-own-mode="funds"]').click();
    await search.fill('Viking');
    await root.locator('[data-own-fund="Viking Global Investors"]').click();
    assert.match(await page.locator('#own-results').innerText(), /1103804/);
    assert.match(await page.locator('#own-summary').innerText(), /^90 matching disclosures/);
    await root.locator('[data-own-back]').click();
    await search.fill('Pershing');
    await root.locator('[data-own-fund="Pershing Square Capital"]').click();
    assert.match(await page.locator('#own-results').innerText(), /Parent portfolio reported by PERSHING SQUARE INC\./);
    assert.match(await page.locator('#own-results').innerText(), /not attributed exclusively/);
    assert.match(await page.locator('#own-mapping-note').innerText(), /^6 positions in this reported portfolio/);
    assert.match(await page.locator('.own-metrics').innerText(), /\$19\.47B/);
    await page.screenshot({ path: resolve(output, 'real-sec-' + width + '.png'), fullPage: false });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.close();
  }
  console.log('Real SEC snapshot browser checks passed: full 14-manager scale, gated data URLs, NVDA ownership, raw sources, Viking identity and Pershing parent attribution on desktop/mobile.');
} finally { await browser?.close(); await new Promise(r => preview.server.close(r)); }

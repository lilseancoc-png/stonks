// Offline UI check. Synthetic public facts; no model calls or market refreshes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBriefSiteTools, gatherBriefSignals, briefRenderFields } from './build.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
import { BRIEF_ACCESS_POLICY_VERSION } from '../lib/public-data-policy.mjs';
import { BRIEF_FIXTURE_NOW as now, briefPublicFixture } from './fixtures/brief-public.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const shippedApp = await readFile(resolve(root, 'app.js'), 'utf8');
const rate = Number(shippedApp.match(/\bvar RFR = ([\d.]+);/)[1]);
const rateMeta = JSON.parse(shippedApp.match(/\bvar RFR_META = (\{[^\n]+\});/)[1]);
assert.equal(renderAppJs({ riskFreeRate: { rate, ...rateMeta } }), shippedApp, 'shipped app matches its renderer');
assert(html.includes('app.js?v=' + contentAssetVersion(shippedApp)), 'shipped app cache key matches its content');
const shippedStyles = await readFile(resolve(root, 'styles.css'), 'utf8');
assert.equal(renderStylesCss(), shippedStyles, 'shipped styles match their renderer');
assert(html.includes('styles.css?v=' + contentAssetVersion(shippedStyles)), 'shipped style cache key matches its content');
const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
const manifest = { ...shell, symbols: [], narratives: [], deferred: false };
const payloads = briefPublicFixture();
let kind = 'intraday';
let linkTarget = null;
async function brief() {
  const scan = await collectBriefSiteTools({ kind, payloads, now, narratives: [], dataDir: resolve(tmpdir(), 'no-brief-browser-data') });
  if (linkTarget) {
    const fact = scan.facts.find((f) => f.tab === linkTarget);
    assert(fact);
    scan.standouts = [fact];
  }
  return { current: { ...briefRenderFields(gatherBriefSignals(kind, { chains: {}, siteTools: scan, now,
    ivTrending: { tickers: [{ symbol: 'RICH', tier: null, elevated: true, pctile: 95, iv: 0.5, mean: 0.4, chg5dPct: -2 }] },
  })), date: '2026-10-27', kind, generatedAtIso: now.toISOString(), accessPolicyVersion: BRIEF_ACCESS_POLICY_VERSION,
    headline: 'Synthetic public brief preview', summary: 'Public tools show a streak reversal, insider disclosure and updated overnight context.', highlights: [],
  } };
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method !== 'GET') return json({}, 405);
  const key = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
  if (key === 'briefs.json') return json(await brief());
  if (key === 'manifest.json' || key === 'manifest-free.json') return json(manifest);
  if (url.pathname === '/api/auth/me') return json({ enabled: false, authenticated: false });
  if (key || url.pathname.startsWith('/api/')) return json({});
  if (url.pathname.startsWith('/_vercel/')) return res.end('');
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) return json({}, 404);
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream');
    res.end(extname(path) === '.html' ? body.toString().replace(/window\.STONKS_MANIFEST=\{.*\};<\/script>/,
      'window.STONKS_MANIFEST=' + JSON.stringify(manifest) + ';</script>') : body);
  } catch { json({}, 404); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const out = resolve(tmpdir(), 'stonks-brief-browser');
  await mkdir(out, { recursive: true });
  for (const width of [1440, 768, 390, 320]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: now });
    await page.addInitScript((value) => localStorage.setItem('stonks-theme', value), theme);
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    for (kind of ['morning', 'intraday', 'afternoon']) {
      await page.goto(base + '/?tab=brief');
      await page.locator('.brief-card').waitFor();
      assert.match(await page.locator('#brief-root').innerText(), /Synthetic public brief preview/);
      assert.equal(await page.locator('.brief-toolscan-row').count(), 10);
      if (width <= 560) {
        const row = page.locator('.brief-toolscan-row').first();
        const sourceBox = await row.locator('button').boundingBox();
        const textBox = await row.locator('p').boundingBox();
        assert(textBox.y >= sourceBox.y + sourceBox.height, 'mobile source sits above the finding');
        assert(textBox.width >= (await row.boundingBox()).width - 26, 'mobile finding uses the full card width');
      }
      const evidence = page.locator('.brief-evidence');
      assert.equal(await evidence.getAttribute('open'), null);
      await evidence.locator('summary').focus();
      await page.keyboard.press('Enter');
      const rich = page.locator('#brief-root [data-sym="RICH"]');
      await rich.waitFor({state: 'visible'});
      await rich.scrollIntoViewIfNeeded();
      assert.match(await rich.innerText(), /Rich premium/i);
      assert.match(await rich.getAttribute('title'), /Rich premium, not a rising-trend signal/);
      assert.match(await rich.getAttribute('title'), /realized volatility is unavailable/);
      assert.doesNotMatch(await rich.getAttribute('title'), /unexplained ramp/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'brief must fit the viewport');
    }
    await page.locator('.brief-headline').click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(out, `brief-${width}-${theme}.png`), fullPage: true });
    // Test links that previously targeted retired tabs, plus the new context.
    for (linkTarget of ['index-cal', 'capital-raises', 'streaks', 'pattern-lab', 'overnight', 'f13']) {
      await page.goto(base + '/?tab=brief');
      await page.locator('.brief-card').waitFor();
      await page.locator(`[data-brief-go="${linkTarget}"]`).first().click();
      assert(await page.locator('#page-pane-' + linkTarget).isVisible(), linkTarget + ' handoff');
    }
    linkTarget = null;
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('brief browser: morning/intraday/closing, desktop/tablet/mobile, light/dark, ten standouts, visible Rich label and tooltip, public page handoffs, and no page errors passed');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}

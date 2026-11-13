// Browser check for the stock page's Leadership tab (lib/corporate-structure/,
// scripts/render/leadership-client.mjs). The data is the offline smoke
// fixture (a fake SEC and a fake model) collected under two covered symbols,
// served by the shared harness; nothing leaves the machine.
// Run: node scripts/corporate-structure-browser.mjs   (screenshots: CORP_BROWSER_OUT=dir)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { refreshCorporateStructure } from '../lib/corporate-structure/collector.mjs';
import { buildCorporateViews } from '../lib/corporate-structure/assemble.mjs';
import { fakeSec, fakeAi, TECH_CIK, SOCIAL_CIK, TECH_PROXY_AI, SOCIAL_PROXY_AI } from './fixtures/corporate-structure.mjs';

const nowMs = Date.parse('2026-11-12T15:00:00Z');
const sec = fakeSec();
const state = await refreshCorporateStructure({
  universe: ['AAPL', 'META'], cikMap: new Map([['AAPL', TECH_CIK], ['META', SOCIAL_CIK]]), fetchImpl: sec.fetchImpl, nowMs, gapMs: 0,
  ai: { enabled: true, model: 'test', deps: { GoogleGenAI: fakeAi({ 'Example Tech Inc.': TECH_PROXY_AI, 'Example Social Inc.': SOCIAL_PROXY_AI }), apiKey: 'test' } },
});
const views = buildCorporateViews(state, { prices: { AAPL: 300, META: 600 }, sharesOut: { AAPL: 1e9 }, nowMs });
assert.ok(views.AAPL && views.META, 'fixture views built');
const tickerFile = (sym) => ({ symbol: sym, spot: sym === 'AAPL' ? 300 : 600, builtAt: '2026-11-12T15:00:00Z', expirations: [], chains: {}, technicals: {}, corporate: views[sym] });
const data = (key) => (/^(AAPL|META)\.json$/.test(key) ? tickerFile(key.slice(0, -5)) : null);

const out = process.env.CORP_BROWSER_OUT ? resolve(process.env.CORP_BROWSER_OUT) : null;
if (out) await mkdir(out, { recursive: true });
const site = await startSiteServer({ data });
const browser = await launchBrowser();
const VIEWS = ['people', 'org', 'web', 'votes', 'tenure', 'table', 'changes'];
let checks = 0;
try {
  await selfTest(browser, site.base);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    const s = await openTab(browser, site.base, { width, theme, tab: 'stock', extra: '&s=META&view=leadership' });
    const { page } = s;
    await page.locator('#ld-root [data-ld-view]').first().waitFor({ timeout: 15000 });
    await settle(page);
    const root = page.locator('#ld-root');
    assert.match(await root.innerText(), /Sam Founder/, 'founder listed');
    assert.match(await root.innerText(), /controls the company/i, 'control sentence shown');
    checks += 2;
    for (const v of VIEWS) {
      await root.locator('[data-ld-view="' + v + '"]').first().click();
      await settle(page, 250);
      const text = await root.innerText();
      assert.ok(text.replace(/\s+/g, ' ').length > 80, v + ' view has content');
      const problems = await pageProblems(s);
      assert.deepEqual(problems, [], `${v} view at ${width}px ${theme}: ${problems.join('; ')}`);
      if (out) await page.screenshot({ path: resolve(out, `leadership-${v}-${width}-${theme}.png`), fullPage: false });
      checks += 2;
    }
    // A person opens their detail; the close button returns to the view.
    await root.locator('[data-ld-view="people"]').first().click();
    await root.locator('[data-ld-person]').first().click();
    await root.locator('.ld-detail').waitFor({ timeout: 5000 });
    assert.match(await root.locator('.ld-detail').innerText(), /Shares|Value/, 'detail shows holdings');
    assert.deepEqual(await pageProblems(s), [], 'detail open without problems');
    if (out) await page.screenshot({ path: resolve(out, `leadership-detail-${width}-${theme}.png`), fullPage: false });
    await root.locator('[data-ld-close]').first().click();
    checks += 2;
    // The link stays shareable.
    assert.match(page.url(), /view=leadership/, 'view=leadership kept in the address');
    checks++;
    await s.context.close();
  }
  // A stock with no Leadership data says so instead of an empty tab.
  const blank = await openTab(browser, site.base, { width: 1440, tab: 'stock', extra: '&s=NVDA&view=leadership' });
  await settle(blank.page, 1500);
  assert.ok(!(await blank.page.locator('#ld-root [data-ld-view]').count()), 'no views without data');
  checks++;
  await blank.context.close();
} finally {
  await browser.close();
  await site.close();
}
console.log(`corporate-structure-browser: ${checks} checks passed`);

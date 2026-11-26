// Browser check for a failed ticker's kept last-good page (2026-11-26,
// lib/stale-ticker-copy.mjs): the stock page says the numbers are from an
// earlier build, and a fresh page does not. Synthetic data only.
// Run: node scripts/stale-ticker-copy-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';

const output = process.env.STALE_COPY_BROWSER_OUT || resolve(tmpdir(), 'stonks-stale-copy-browser');
await mkdir(output, { recursive: true });
const day = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const ticker = (extra = {}) => ({
  spot: 230, quoteAsOf: '2026-11-24T21:00:00.000Z', marketState: 'CLOSED',
  technicals: { rsi: 55, sr: { s20: 220, r20: 240 } },
  chains: { 1780000000: { c: [{ s: 230, b: 5, a: 5.2, iv: 0.3, oi: 100, v: 10 }], p: [{ s: 230, b: 4, a: 4.2, iv: 0.3, oi: 100, v: 10 }] } },
  expirations: [1780000000],
  priceSeries: { t: Array.from({ length: 40 }, (_, i) => day(i)), c: Array.from({ length: 40 }, (_, i) => 200 + i) },
  fundamentals: { name: 'Apple Inc.' },
  ...extra,
});
const files = {
  'AAPL.json': ticker({ staleCopy: { since: '2026-11-24T21:00:00.000Z', why: 'fetch failed', keptAtIso: '2026-11-26T15:00:00.000Z' } }),
  'MSFT.json': ticker({ fundamentals: { name: 'Microsoft Corp.' } }),
};
const server = await startSiteServer({ owner: () => false, data: (key) => files[key] || null });
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const quiet = (p) => p.filter((x) => !/404|Failed to load resource/.test(x));
try {
  await selfTest(browser, server.base);
  for (const [w, h, theme] of [[1440, 1000, 'light'], [390, 844, 'dark']]) {
    const s = await openTab(browser, server.base, { width: w, height: h, theme, tab: 'stock', extra: '&s=AAPL' });
    await s.page.locator('#stock-root .stp-price-slot').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    const banner = s.page.locator('#stock-root [data-stale-copy]');
    check(await banner.count() === 1, `${w}: the kept copy carries the notice`);
    const t = await banner.innerText();
    check(/Not updated in the latest build · data from Nov 24, 2026/.test(t), `${w}: notice text: ${t}`);
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 1, `${w}: no sideways scroll (${over}px)`);
    const p = quiet(await pageProblems(s, { allowCovers: true }));
    check(p.length === 0, `${w}: ` + p.join(' | '));
    await s.page.locator('#stock-root').screenshot({ path: resolve(output, `aapl-stale-${w}-${theme}.png`) });
    await s.context.close();
  }
  const s = await openTab(browser, server.base, { width: 1440, height: 1000, theme: 'light', tab: 'stock', extra: '&s=MSFT' });
  await s.page.locator('#stock-root .stp-price-slot').waitFor({ timeout: 15000 });
  await settle(s.page, 600);
  check(await s.page.locator('#stock-root [data-stale-copy]').count() === 0, 'a fresh page has no notice');
  await s.context.close();
  console.log(`stale-ticker-copy browser: ${checks} checks pass. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}

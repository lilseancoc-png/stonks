// Track Record "Running total" rule-change dots (2026-11-24). Rule changes that
// fall on one close day used to stack up the chart as several gold dots with
// nothing to hover. Now they merge into one numbered dot, hovering or tapping
// that day shows what changed, and the chart key ("N rule changes") opens the
// full list. Checks 1440 desktop and a 390 phone (touch), light and dark, plus
// the shared page checks (no errors, no sideways scroll, nothing covering data).
// Synthetic record only; nothing leaves the machine.
//   node scripts/track-rule-dots-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startSiteServer, launchBrowser, pageProblems, settle } from './browser-harness.mjs';

const OUT = process.env.RULE_DOTS_OUT || resolve(tmpdir(), 'stonks-rule-dots');
await mkdir(OUT, { recursive: true });

// Closes every few days from late August to Nov 20, with a gap from Oct 16 to
// Oct 27 so the Oct 19, 20, 22, 23 and 26 rule changes all land on one close.
const closeDays = [];
for (let t = Date.parse('2026-08-20T00:00:00Z'); t <= Date.parse('2026-11-20T00:00:00Z'); t += 3 * 86400000) {
  const d = new Date(t).toISOString().slice(0, 10);
  if (d > '2026-10-16' && d < '2026-10-27') continue;
  closeDays.push(d);
}
const closed = closeDays.map((day, i) => {
  const exit = day + 'T19:30:00Z';
  const entry = new Date(Date.parse(exit) - 5 * 86400000).toISOString();
  // From Nov 16 the live grade version is the "macro read off" one, so the
  // other Nov 16 version (its alternative) must not get a dot.
  const grade = day >= '2026-11-17' ? '2026-11-signed-flow-no-macro' : day >= '2026-11-07' ? '2026-11-price-pillar' : day >= '2026-10-27' ? '2026-10-iv-rule' : '';
  const pnl = [24, -18, 31, 12, -40, 26, 9][i % 7];
  return { tradeId: 'T' + i, symbol: ['NVDA', 'AAPL', 'MSFT', 'AMD'][i % 4], side: i % 3 ? 'call' : 'put', entryDate: entry, exitDate: exit,
    status: pnl > 0 ? 'hit-tp-prem' : 'hit-stop-prem', outcome: pnl > 0 ? 'win' : 'loss', optionPnlPct: pnl, entrySpot: 100, exitSpot: 100 + pnl / 5,
    gradeModelVersion: grade, contract: { structure: 'long', netDebit: 4 } };
});
const accuracy = { builtAtIso: '2026-11-20T21:00:00Z', open: [], closed, baseline: { open: [], closed: [] } };

const srv = await startSiteServer({ owner: true, data: (key) => key === 'picks-accuracy.json' ? accuracy : (key === 'manifest.json' || key === 'manifest-free.json') ? { symbols: [], narratives: [] } : null,
  api: (url) => url.pathname === '/api/auth/track-record-data' ? (url.searchParams.get('key') === 'picks-accuracy.json' ? accuracy : {}) : undefined });
const browser = await launchBrowser();
let failed = 0;
try {
  for (const [width, theme] of [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light']]) {
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height: phone ? 860 : 1000 }, serviceWorkers: 'block', deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
    const page = await context.newPage();
    const errors = [], consoleErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|the server responded with a status/.test(m.text())) consoleErrors.push(m.text()); });
    await page.addInitScript((t) => { try { localStorage.setItem('stonks-theme', t); } catch {} }, theme);
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === srv.base ? r.continue() : r.fulfill({ body: '' })));
    await page.goto(srv.base + '/?tab=track', { waitUntil: 'domcontentloaded' });
    const chart = page.locator('[data-acc-eq-chart="summary"]');
    await chart.locator('canvas').first().waitFor({ timeout: 20000 });
    await settle(page, 800);
    const label = width + ' ' + theme;
    try {
      // The key names the count; the list opens and closes from it.
      const key = chart.locator('.ck-mark-key');
      await key.waitFor();
      const keyText = (await key.innerText()).replace(/\s+/g, ' ');
      // Oct 19, 20, 22, 23 (two), 26, Nov 6 (three), Nov 16 (one live version).
      assert.match(keyText, /^10 rule changes/, label + ': key reads ' + keyText);
      assert.equal(await chart.locator('.ck-mark-list').isHidden(), true);
      await key.click();
      const list = chart.locator('.ck-mark-list');
      await list.waitFor();
      const items = await list.locator('li').allInnerTexts();
      assert.equal(items.length, 10, label + ': list rows');
      assert.match(items[0], /Oct 19, 2026.*Chart-pattern vote removed/);
      assert.ok(items.some((t) => /macro read off/.test(t)), label + ': live Nov 16 version listed');
      assert.ok(!items.some((t) => /confirmed by next-day open interest/.test(t)), label + ': rival Nov 16 version not listed');
      assert.equal(await chart.locator('.ck-mark-key').getAttribute('aria-expanded'), 'true');
      await page.screenshot({ path: resolve(OUT, 'list-' + width + '-' + theme + '.png'), fullPage: false });
      assert.deepEqual(await pageProblems({ page, errors, consoleErrors }), [], label + ': page checks with the list open');
      await chart.locator('.ck-mark-key').click();
      assert.equal(await list.isHidden(), true, label + ': list closes');

      // Hover (or tap) each close day until the tooltip shows the Oct 27 dot.
      await chart.locator('.ck-canvas').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const canvasBox = await chart.locator('.ck-canvas').boundingBox();
      const tip = chart.locator('.ck-mark-tip');
      let shown = '';
      for (let x = canvasBox.x + 10; x < canvasBox.x + canvasBox.width - 70 && !shown; x += 3) {
        if (phone) await page.touchscreen.tap(x, canvasBox.y + canvasBox.height * 0.45);
        else await page.mouse.move(x, canvasBox.y + canvasBox.height * 0.45);
        if (await tip.isVisible()) {
          const t = await tip.innerText();
          if (/Oct 26/.test(t)) shown = t;
        }
      }
      assert.ok(shown, label + ': hovering the merged dot shows its tooltip');
      assert.match(shown, /^6 rule changes took effect by this close/, label + ': tooltip header');
      for (const re of [/Oct 19, 2026/, /Oct 20, 2026/, /Oct 22, 2026/, /Oct 23, 2026/, /Oct 26, 2026/]) assert.match(shown, re);
      const tb = await tip.boundingBox();
      assert.ok(tb.x >= canvasBox.x - 1 && tb.x + tb.width <= canvasBox.x + canvasBox.width + 1, label + ': tooltip stays inside the chart');
      await page.screenshot({ path: resolve(OUT, 'tip-' + width + '-' + theme + '.png'), clip: { x: 0, y: Math.max(0, canvasBox.y - 120), width, height: Math.min(700, canvasBox.height + 260) } });
      // Off the marked days the tooltip goes away.
      if (phone) { await page.waitForTimeout(600); await page.touchscreen.tap(canvasBox.x + canvasBox.width * 0.1, canvasBox.y + canvasBox.height * 0.45); await page.waitForTimeout(200); }
      else await page.mouse.move(canvasBox.x + canvasBox.width * 0.1, canvasBox.y + canvasBox.height * 0.45);
      assert.equal(await tip.isHidden(), true, label + ': tooltip hides');
      console.log('ok  ' + label);
    } catch (e) {
      failed++;
      console.error('FAIL ' + label + ': ' + e.message);
      await page.screenshot({ path: resolve(OUT, 'fail-' + width + '-' + theme + '.png') }).catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log('screenshots: ' + OUT);
if (failed) { console.error(failed + ' view(s) failed'); process.exit(1); }
console.log('rule-change dots: all views pass');

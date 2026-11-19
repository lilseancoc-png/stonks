// Browser check for the Webull W3 Owner blocks (2026-11-19): the whole-market
// breadth block on Market analysis (counts, the nine-bucket histogram, the
// up-share line, gainers / losers / most active, 52-week highs and lows, the
// sector table, the backup-source panel) and the order-flow block on the
// stock page's Owner tab, as the Owner at 1440 light and 390 dark, with no
// page errors, raw values or sideways scroll. The public run must never ask
// for a Webull file and must show neither block. Synthetic data only; nothing
// here contacts Webull, a provider or the store.
// Run: node scripts/webull-w3-browser.mjs   (after the app.js render)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { applyBreadthRecord, emptyBreadthFile, BUCKETS, BREADTH_KEY } from '../lib/webull-data/breadth.mjs';
import { emptyFlowFile, mergeFlow, FLOW_KEY } from '../lib/webull-data/flow.mjs';
import { BACKUP_CHECK_KEY, BACKUP_KEY } from '../lib/webull-data/backup.mjs';

const output = process.env.WEBULL_W3_BROWSER_OUT || resolve(tmpdir(), 'stonks-webull-w3-browser');
await mkdir(output, { recursive: true });

// --- fixtures ----------------------------------------------------------------
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const days = [];
for (let t = Date.UTC(2026, 9, 1); t <= Date.UTC(2026, 10, 19); t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
}
const today = days[days.length - 1];
const row = (i, sign) => ({ s: 'SYN' + i, n: 'Synthetic ' + i + ' Inc', p: 10 + i, c: sign * (2 + i * 0.7), v: 1e6 * (20 - i), mv: 1e9 * (i + 1), rv: 1 + i / 10 });
let breadth = emptyBreadthFile();
for (const [di, date] of days.entries()) {
  const swing = Math.round(Math.sin(di / 4) * 120);
  const at = date + 'T21:10:00Z';
  breadth = applyBreadthRecord(breadth, { kind: 'sectors', date, sectors: [{ id: 'tech', name: 'Technology', adv: 300 + swing, dec: 200 - swing, flat: 10, chg: 0.8, mv: 5e12, vol: 4e9 }, { id: 'fin', name: 'Financials', adv: 150, dec: 240, flat: 5, chg: -0.4, mv: 3e12, vol: 2e9 }] }, { nowIso: at });
  breadth = applyBreadthRecord(breadth, { kind: 'sector-page', date, sectorId: 'tech', page: 0, counts: BUCKETS.map(() => Math.round(rnd() * 60)), n: 400, last: true }, { nowIso: at });
  breadth = applyBreadthRecord(breadth, { kind: 'sector-page', date, sectorId: 'fin', page: 0, counts: BUCKETS.map(() => Math.round(rnd() * 40)), n: 300, last: true }, { nowIso: at });
  for (const [list, sign] of [['gainers', 1], ['losers', -1], ['actives', 1], ['newHigh', 1], ['newLow', -1], ['nearHigh', 1], ['nearLow', -1]]) {
    const n = list === 'newLow' ? 200 : 12;
    breadth = applyBreadthRecord(breadth, { kind: 'list', date, list, n, capped: n >= 200, rows: Array.from({ length: Math.min(n, 12) }, (_, i) => row(i, sign)) }, { nowIso: at });
  }
}
breadth = applyBreadthRecord(breadth, { kind: 'error', date: today, part: 'nearLow', reason: 'timeout' }, { nowIso: today + 'T21:12:00Z' });

let flow = emptyFlowFile();
flow = mergeFlow(flow, 'NVDA', days.map((d, i) => [d, 4e8 + i * 1e6, Math.round(3.6e8 + rnd() * 9e7), 2e8, Math.round(1.9e8 + rnd() * 3e7), 1e8, 1.05e8]), { nowIso: today + 'T21:05:00Z' });

const check = {
  v: 1, key: BACKUP_CHECK_KEY, builtAt: today + 'T21:30:00Z',
  earnings: { filled: [{ symbol: 'NVDA', date: '2026-11-25' }], disagree: [{ symbol: 'AAPL', main: '2026-12-01', backup: '2026-12-04' }] },
  targets: { filled: ['MU'] },
  econ: { disagree: [{ group: 'CPI', ours: '2026-12-10', webull: '2026-12-11' }] },
  fearGreed: { verdict: 'too-few', matched: 2, maxGap: 0.8, standIn: false },
};

const chainOf = (sym) => {
  const t = days, c = days.map((_, i) => 100 + i + Math.sin(i / 3) * 4);
  return { symbol: sym, spot: c[c.length - 1], expirations: [], chains: {}, priceSeries: { t, c, v: t.map(() => 2e7) }, fundamentals: { name: sym + ' Corp', shortName: sym + ' Corp', marketCap: 1e12 }, technicals: { rsi: 55 } };
};
const WEBULL_KEYS = [BREADTH_KEY, FLOW_KEY, BACKUP_CHECK_KEY, BACKUP_KEY];

let owner = false;
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => {
    if (key === BREADTH_KEY) return owner ? breadth : null;
    if (key === FLOW_KEY) return owner ? flow : null;
    if (key === BACKUP_CHECK_KEY) return owner ? check : null;
    if (key === 'NVDA.json') return chainOf('NVDA');
    if (key === 'manifest.json' || key === 'manifest-free.json') return { symbols: [], narratives: [] };
    if (key === 'picks-accuracy.json') return owner ? { open: [], closed: [] } : null;
    return null;
  },
});
const browser = await launchBrowser();
let checks = 0;
const ok = (test, label) => { assert.ok(test, label); checks++; };
const VIEWS = [{ width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 900, theme: 'dark' }];
const shot = (s, name, v) => s.page.screenshot({ path: resolve(output, name + '-' + v.width + '-' + v.theme + '.png'), fullPage: true });
async function clean(s, label) {
  const problems = await pageProblems(s);
  ok(problems.length === 0, label + ': ' + problems.join(' | '));
}
const textOf = (page, sel) => page.locator(sel).first().innerText().catch(() => '');

try {
  await selfTest(browser, server.base);
  for (const v of VIEWS) {
    const tag = v.width + ' ' + v.theme;

    // Owner: Market analysis breadth block.
    owner = true;
    let s = await openTab(browser, server.base, { tab: 'market', now: today + 'T22:00:00Z', ...v });
    await s.page.waitForFunction(() => { const el = document.getElementById('market-webull'); return el && !el.hidden && /Whole-market breadth/.test(el.innerText); }, null, { timeout: 20000 });
    await settle(s.page);
    const mk = await textOf(s.page, '#market-webull');
    ok(/Movers up/.test(mk) && /Top gainers/.test(mk) && /Top losers/.test(mk) && /Most active/.test(mk), tag + ': breadth KPIs and movers');
    ok(/different and wider source/.test(mk), tag + ': labeled as a different source from the wide tier');
    ok(await s.page.locator('#market-webull svg rect').count() >= BUCKETS.length, tag + ': nine-bucket histogram drawn');
    ok(await s.page.locator('#market-webull svg[data-ch]').count() >= 1, tag + ': charts carry hover points');
    ok(/200\+/.test(mk), tag + ': a capped list shows 200+');
    ok(/did not answer this session: nearLow/.test(mk), tag + ': a missed part is named');
    ok(/Owner only/.test(mk), tag + ': source line says Owner only');
    await s.page.locator('#market-webull summary', { hasText: 'Backup sources' }).click();
    await s.page.locator('#market-webull summary', { hasText: '52-week highs and lows' }).click();
    await settle(s.page, 300);
    const mk2 = await textOf(s.page, '#market-webull');
    ok(/NVDA 2026-11-25/.test(mk2) && /AAPL ours 2026-12-01, Webull 2026-12-04/.test(mk2) && /CPI ours 2026-12-10/.test(mk2), tag + ': backup panel lists fills and disagreements');
    ok(/New 52-week lows \(200\+\)/.test(mk2), tag + ': 52-week lists open');
    await clean(s, 'market ' + tag);
    await shot(s, 'market', v);
    await s.context.close();

    // Owner: stock page Owner tab order flow.
    s = await openTab(browser, server.base, { tab: 'stock', extra: '&s=NVDA', now: today + 'T22:00:00Z', ...v });
    const btn = s.page.locator('[data-stock-tab="owner"]').first();
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await btn.click();
    await s.page.waitForFunction(() => /Order flow \(Webull\)/.test(document.getElementById('stp-tab-body')?.innerText || ''), null, { timeout: 15000 });
    await settle(s.page, 400);
    const fl = await textOf(s.page, '#stp-tab-body');
    ok(/Large orders, last five sessions/.test(fl) && /not a vote/.test(fl), tag + ': order-flow block with its no-vote note');
    ok(await s.page.locator('.wbd-flow-chart rect').count() >= 30, tag + ': flow bars drawn');
    ok(/sessions saved/.test(fl), tag + ': saved-session count');
    await clean(s, 'stock owner ' + tag);
    await shot(s, 'stock-owner', v);
    await s.context.close();

    // Public: neither block, no Webull file asked for.
    owner = false;
    const before = server.asks.data.length;
    s = await openTab(browser, server.base, { tab: 'market', ...v });
    await settle(s.page, 1200);
    ok(await s.page.locator('#market-webull:not([hidden])').count() === 0, tag + ': no breadth block for the public');
    await s.context.close();
    s = await openTab(browser, server.base, { tab: 'stock', extra: '&s=NVDA', ...v });
    await settle(s.page, 1200);
    ok(await s.page.locator('[data-wb]:not([hidden])').count() === 0, tag + ': no flow block for the public');
    await clean(s, 'stock public ' + tag);
    await s.context.close();
    const asked = server.asks.data.slice(before);
    ok(!asked.some((k) => WEBULL_KEYS.includes(k)), tag + ': a public visit asks for no Webull file (' + asked.filter((k) => /webull/.test(k)).join(', ') + ')');
  }
  console.log('webull W3 browser: ' + checks + ' checks passed. Screenshots: ' + output);
} finally {
  await browser.close();
  await server.close();
}

// Browser check for the 2026-11-07 views and Owner tools: Market map (fear
// map, two-number lens, chart wall, crowding, breadth, crowded shorts), What
// changed, Past days, the 0DTE share on Unusual options trades, market dates
// on the Calendar, the Fed liquidity line, the stock page (expected-move cone,
// story timeline, earnings reactions, chain heat grid, chatter, short
// interest), and the Owner tools (grade calibration, gate verdicts, book risk,
// trade journal). Each page runs as the Owner and as a public visitor; the
// public run fails if the browser asks for any Owner-only file. Synthetic data
// only; no provider, account or production store is contacted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarketMap } from '../lib/market-map.mjs';
import { buildSiteSnapshot, nextSiteChanges } from '../lib/site-changes.mjs';
import { buildMarketDays, buildMarketDayBriefs } from '../lib/market-days.mjs';
import { buildFedLiquidity } from '../lib/fed-liquidity.mjs';
import { marketStructureCalendarEvents } from '../lib/market-dates.mjs';
import { buildGradeResearch, seriesFromChains } from '../lib/grade-research.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
import { BRIEF_ACCESS_POLICY_VERSION } from '../lib/public-data-policy.mjs';
import { sectorGroupOfLabel } from '../lib/sector-groups.mjs';
import { computePicksAccuracyStats } from '../lib/track-record-stats.mjs';
const { SECTORS, TICKERS } = await import('./build.mjs');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const NOW = '2026-11-06T22:00:00Z';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.VIEWS_NEXT_BROWSER_OUT || resolve(tmpdir(), 'stonks-views-next-browser');
await mkdir(output, { recursive: true });

// --- fixtures ----------------------------------------------------------------
const SYMS = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'MU', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'LLY', 'CAT', 'DIS', 'NFLX', 'AVGO', 'ORCL', 'SMCI', 'WDC', 'CRM', 'BA', 'UNH', 'GS', 'COST', 'SPY', 'QQQ', 'IWM']
  .filter((s) => TICKERS.includes(s));
const ETFS = new Set(['SPY', 'QQQ', 'IWM']);
const dates = [];
for (let t = Date.UTC(2025, 4, 1); t <= Date.UTC(2026, 10, 6); t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const market = dates.map(() => (rnd() - 0.5) * 0.02);
const chains = {};
const lastDate = dates[dates.length - 1];
const expSecs = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-12-18', '2027-01-15'].map((d) => Date.parse(d + 'T20:00:00Z') / 1000);
SYMS.forEach((s, k) => {
  const beta = 0.6 + (k % 5) * 0.2, start = 40 + k * 17;
  let c = start;
  const closes = dates.map((_, i) => (c *= 1 + beta * market[i] + (rnd() - 0.5) * 0.025 + (k % 3 - 1) * 0.0006));
  const spot = Math.round(closes[closes.length - 1] * 100) / 100;
  const strikes = Array.from({ length: 21 }, (_, i) => Math.round(spot * (0.8 + i * 0.02)));
  const chain = {};
  expSecs.forEach((e, ei) => {
    const iv = 0.32 + ei * 0.01 + (k % 4) * 0.03;
    const row = (st, call) => ({ s: st, b: 1, a: 1.1, l: 1.05, iv: iv + (call ? 0 : Math.max(0, (spot - st) / spot) * 0.5), oi: Math.round(4000 * Math.exp(-Math.abs(st / spot - 1) * 12) * (call ? 1.2 : 0.9)) + (st % 5 === 0 ? 3000 : 0), v: ei === 0 ? 900 : Math.round(300 / (ei + 1)) });
    chain[String(e)] = { c: strikes.map((st) => row(st, true)), p: strikes.map((st) => row(st, false)) };
  });
  const bars = dates.map((t, i) => ({ t, c: Math.round(closes[i] * 100) / 100, v: 1e6 + Math.round(rnd() * 5e5) }));
  const earnings = ['2025-11-19', '2026-02-25', '2026-05-27', '2026-08-26'].map((d, i) => {
    const r = dates.findIndex((x) => x > d);
    const base = bars[r - 1].c;
    return { date: d, session: 'PM', surprisePct: [8, -3, 0.4, 5][i], impliedMovePct: 6 + i, movePct: bars[r].c / base - 1,
      path: Array.from({ length: 16 }, (_, j) => Math.round((bars[r - 10 + j].c / base - 1) * 10000) / 10000) };
  });
  chains[s] = {
    symbol: s, spot, _bars: bars,
    priceSeries: { t: dates, c: bars.map((b) => b.c), v: bars.map((b) => b.v) },
    expirations: expSecs, chains: chain,
    fundamentals: { name: s + ' Corp', shortName: s + ' Corp', marketCap: 5e10 + k * 3e10, trailingPE: 15 + k, forwardPE: 12 + k, nextEarningsDate: '2026-11-19',
      shortInterest: ETFS.has(s) ? null : { percentFloat: 1 + (k * 1.7) % 14, daysToCover: 1 + (k % 6), changePct: (k % 7 - 3) * 6, settlementDate: '2026-10-31' } },
    technicals: { rsi: 30 + (k * 7) % 45, volRegime: { rv30: 0.3 } },
    ivRank: { iv: 0.32 + (k % 4) * 0.03, pctile: (k * 13) % 100 },
    ivSurface: { skew25: 0.02 + (k % 5) * 0.01, skewZ: ((k * 7) % 9 - 4) / 1.5, termSlope: 0.01 },
    earningsHx: { events: earnings, next: { date: '2026-11-19', impliedMovePct: 7 } },
    social: { history: dates.slice(-30).map((t, i) => ({ at: t + 'T20:00:00Z', bullishSharePct: 50 + Math.round(Math.sin(i / 4) * 15), msgCount24h: 200 + i * 10 })) },
  };
});
const sectorOf = (s) => SECTORS[s] || null;
const groupOf = (s) => sectorGroupOfLabel(SECTORS[s]);
const map = buildMarketMap({ chains, symbols: SYMS, sectorOf, groupOf, isEtf: (s) => ETFS.has(s), ivBand: ({ pctile }) => ({ band: pctile >= 90 ? 'very-rich' : pctile >= 80 ? 'rich' : pctile <= 20 ? 'cheap' : 'normal' }), builtAtIso: '2026-11-06T21:10:00Z' });
const yesterday = JSON.parse(JSON.stringify(chains));
for (const s of SYMS) { yesterday[s]._bars = yesterday[s]._bars.slice(0, -1); }
const oiOf = (bump) => ({ scannedAt: '2026-11-06T13:31:30Z', tickers: SYMS.map((s) => ({ symbol: s, spot: chains[s].spot, callWall: { strike: Math.round(chains[s].spot * 1.08) + bump, oi: 9000, expSec: expSecs[2] }, putWall: { strike: Math.round(chains[s].spot * 0.94), oi: 8000, expSec: expSecs[2] }, cpRatio: 1.1, strikes: [] })) });
const unusualNow = { tickers: [{ symbol: 'NVDA', contracts: [{ side: 'call', strike: 200, expSec: expSecs[1], premium: 3.2e6, vol: 12000 }] }, { symbol: 'TSLA', contracts: [{ side: 'put', strike: 380, expSec: expSecs[1], premium: 1.4e6, vol: 6000 }] }] };
const f13 = { period: 'Q3 2026', perFirm: { 'Example Capital': { filingDate: '2026-11-05', topBought: [{ ticker: 'NVDA', valueChange: 4e8, valueNow: 2e9, isNew: false }], topSold: [] } },
  insiderTransactions: { transactions: [{ symbol: 'NVDA', transactionDate: '2026-10-29', ownerName: 'Jane Example', officerTitle: 'CFO', direction: 'sell', openMarket: true, shares: 20000, value: 3.8e6 }] } };
const changes = nextSiteChanges(nextSiteChanges(null, buildSiteSnapshot({ chains: yesterday, oi: oiOf(0), unusual: { tickers: [] }, f13: { perFirm: { 'Example Capital': { filingDate: '2026-08-14' } } }, builtAtIso: '2026-11-05T21:10:00Z' })),
  buildSiteSnapshot({ chains, oi: oiOf(5), unusual: unusualNow, f13, builtAtIso: '2026-11-06T21:10:00Z' }));
const marketDays = buildMarketDays({ chains, symbols: SYMS, builtAtIso: '2026-11-06T21:10:00Z' });
const dayBriefs = buildMarketDayBriefs({ prior: { briefs: [{ date: '2026-11-05', at: '2026-11-05T21:10:00Z', kind: 'close', v: BRIEF_ACCESS_POLICY_VERSION, headline: 'Chips led a late bounce', summary: 'Semis gained while banks lagged.' }] }, brief: null, policyVersion: BRIEF_ACCESS_POLICY_VERSION, builtAtIso: NOW });
const weeks = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 10, 4) - (119 - i) * 7 * 86400000).toISOString().slice(0, 10));
const liquidity = buildFedLiquidity({ walcl: weeks.map((d, i) => ({ date: d, value: 7_100_000 - i * 4000 })), tga: weeks.map((d, i) => ({ date: d, value: 750_000 + Math.sin(i / 6) * 80_000 })), rrp: weeks.map((d, i) => ({ date: d, value: Math.max(0, 500 - i * 5) })) });
const calendar = { builtAtIso: NOW, events: marketStructureCalendarEvents(Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'))
  .concat([{ type: 'fomc', date: '2026-12-09', title: 'FOMC decision' }, { type: 'macro', subtype: 'cpi-yoy', date: '2026-11-12', title: 'CPI' }, { type: 'earnings', symbol: 'NVDA', date: '2026-11-19', session: 'PM', title: 'NVDA earnings' }]) };
// Owner files.
const gradeDays = dates.slice(-90).map((date, i) => ({ date, totals: Object.fromEntries(SYMS.filter((s) => !ETFS.has(s)).map((s, k) => [s, Math.round((((k * 37 + i * 3) % 19) - 9) * 10) / 10]) ) }));
gradeDays[gradeDays.length - 1].totals.NVDA = 7.4; gradeDays[gradeDays.length - 2].totals.NVDA = 4.1;
gradeDays[gradeDays.length - 1].totals.AMD = -5.2; gradeDays[gradeDays.length - 2].totals.AMD = -1.0;
const research = buildGradeResearch({ days: gradeDays, series: seriesFromChains(chains), sectors: SECTORS, builtAtIso: NOW, placeboDraws: 20 });
const contract = (side, strike, exp, iv, structure = 'long') => ({ structure, optionType: side, strike, expiry: exp, expiryLabel: new Date(exp * 1000).toISOString().slice(0, 10), iv, delta: side === 'put' ? -0.5 : 0.55, thetaDay: -0.12, mid: 6, netDebit: 6 });
const openTrade = (symbol, side, entryDate, pnl, exp) => ({ symbol, side, tier: side === 'put' ? 'strong-put' : 'strong-call', score: side === 'put' ? -7.6 : 7.4, entryDate, entrySpot: chains[symbol].spot * 0.97, lastSpot: chains[symbol].spot, optionPnlPct: pnl, status: 'open', sector: SECTORS[symbol], gradeModelVersion: '2026-11-price-pillar', exitPolicy: { version: '2026-10-22-tp25' }, contract: contract(side, Math.round(chains[symbol].spot), exp, 0.4) });
const openBook = [openTrade('NVDA', 'call', '2026-11-04T16:04:00Z', 6.2, expSecs[3]), openTrade('AMD', 'call', '2026-11-05T20:33:00Z', -3.1, expSecs[4]), openTrade('TSLA', 'put', '2026-11-06T16:04:00Z', 1.4, expSecs[3])];
const closed = [{ ...openTrade('MU', 'call', '2026-10-21T15:06:02Z', 26.1, expSecs[3]), status: 'hit-tp-prem', outcome: 'win', exitDate: '2026-11-06T16:04:51Z' },
  { ...openTrade('NVDA', 'call', '2026-09-02T15:06:02Z', -42.7, expSecs[2]), status: 'hit-stop-under', outcome: 'loss', exitDate: '2026-09-18T16:04:51Z' }];
const accuracy = { builtAtIso: NOW, open: openBook, closed, archive: [], stats: computePicksAccuracyStats(openBook, closed, NOW), allTimeStats: computePicksAccuracyStats([], closed, NOW),
  gateStats: [{ gate: 'opened', n: 30, d5: { avgPct: 0.8, rightPct: 56, n: 30 }, d10: { avgPct: 1.4, rightPct: 58, n: 30 } }, { gate: 'ai-wait', n: 22, d5: { avgPct: 1.9, rightPct: 62, n: 22 }, d10: { avgPct: 3.1, rightPct: 66, n: 22 } }, { gate: 'below-strong', n: 40, d5: { avgPct: 0.1, rightPct: 50, n: 40 }, d10: { avgPct: -0.6, rightPct: 47, n: 40 } }] };
const gradesIndex = { minConviction: 4, grades: Object.fromEntries(Object.entries(gradeDays[gradeDays.length - 1].totals).map(([s, t]) => [s, { symbol: s, total: t }])) };
const gradesHistory = { changes: [{ symbol: 'NVDA', date: '2026-11-06', direction: 'up', prevTier: 'lean-call', curTier: 'strong-call', prevTotal: 4.1, total: 7.4, deltaScore: 3.3 }] };
const run = { runs: [{ builtAtIso: '2026-11-06T16:04:00Z', et: '11:00', picks: [{ s: 'TSLA', side: 'put', group: 'actionable', tot: -7.6 }, { s: 'AAPL', side: 'call', group: 'watch', tot: 5.1 }], rows: [] }] };
const fills = { rows: [], marks: {}, notes: { trades: {}, tickers: { NVDA: { text: 'Leader, but crowded into the print.', tags: ['Earnings'], at: '2026-11-05T15:00:00Z' } } } };
const heatmap = { builtAtIso: NOW, tickers: SYMS.map((s) => ({ s, n: s + ' Corp', sec: SECTORS[s], ch: map.rows.find((r) => r.s === s)?.r1d, mc: chains[s].fundamentals.marketCap })) };
const ulog = { entries: [{ scannedAt: '2026-10-20T15:00:00Z', symbol: 'NVDA', side: 'call', strike: 200, expSec: expSecs[1], deltaVol: 9000, vol: 12000, premium: 3.2e6 }] };

const data = {
  'market-map.json': map, 'site-changes.json': changes, 'market-days.json': marketDays, 'market-days-briefs.json': dayBriefs,
  'macro-history.json': { entries: [], liquidity }, 'calendar.json': calendar, 'grades-daily.json': { days: gradeDays }, 'grade-research.json': research,
  'picks-accuracy.json': accuracy, 'picks-open.json': { builtAtIso: NOW, open: openBook }, 'grades.json': gradesIndex, 'grades-history.json': gradesHistory,
  'picks-run-2026-11-06.json': run, 'heatmap.json': heatmap, 'oi-tracker.json': oiOf(5), '13f.json': f13, 'unusual-log.json': ulog,
  'manifest.json': { symbols: [], narratives: [] }, 'manifest-free.json': { symbols: [], narratives: [] }, 'picks-changes.json': { events: [] }, 'picks-roster.json': { current: [], dropped: [] },
  ...Object.fromEntries(SYMS.map((s) => { const { _bars, ...pub } = chains[s]; return [s + '.json', pub]; })),
};

// --- server --------------------------------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let owner = true;
const posts = [], publicAsks = [], recordAsks = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (v, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  if (req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const b = JSON.parse(body || '{}');
    posts.push({ path: url.pathname, body: b });
    if (url.pathname === '/api/auth/picks-fills' && owner) {
      await new Promise((r) => setTimeout(r, 120));
      const n = b.note;
      if (n) {
        const map2 = n.trade_id ? fills.notes.trades : fills.notes.tickers, id = n.trade_id || n.ticker;
        if (n.clear || (!n.text && !(n.tags || []).length)) delete map2[id]; else map2[id] = { text: n.text, tags: n.tags || [], at: NOW };
      }
      return json(fills);
    }
    return json({ error: 'read-only' }, 405);
  }
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json(owner ? { enabled: true, authed: true, authenticated: true, trackRecord: true, topPicks: true, user: { name: 'Synthetic owner' } } : { enabled: true, authed: false, authenticated: false });
  if (url.pathname === '/api/auth/picks-fills') { if (!owner) publicAsks.push('picks-fills'); return owner ? json(fills) : json({ error: 'auth required' }, 401); }
  if (url.pathname === '/api/auth/track-record-data') {
    const k = url.searchParams.get('key');
    if (!owner) { publicAsks.push('track-record-data'); return json({ error: 'auth required' }, 401); }
    recordAsks.push(k);
    return k in data ? json(data[k]) : json({});
  }
  if (url.pathname.startsWith('/api/auth/') && url.pathname !== '/api/auth/me') { if (!owner) publicAsks.push(url.pathname); return owner ? json({}) : json({ error: 'auth required' }, 401); }
  const key = url.pathname === '/api/auth/me' ? url.searchParams.get('data') : /^\/(?:api\/)?data\//.test(url.pathname) ? url.pathname.replace(/^\/(?:api\/)?data\//, '') : null;
  if (key) {
    if (isPremiumKey(key) && !owner) { publicAsks.push(key); return json({ error: 'auth required' }, 401); }
    return key in data ? json(data[key]) : json({});
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return json({});
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return json({ error: 'Not found' }, 404);
  try {
    let content = await readFile(path);
    if (extname(path) === '.html') content = content.toString().replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px;background:#f4df9b;color:#211a08;text-align:center;font:12px system-ui">Synthetic test data</div>');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(content);
  } catch { json({ error: 'Not found' }, 404); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// --- checks --------------------------------------------------------------------
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let shots = 0, checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const ONLY = process.env.VIEWS_NEXT_ONLY || '';
async function open(width, theme, tab, extra = '') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem('stonks-theme', t); }, theme);
  await page.clock.install({ time: new Date(NOW) });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' })));
  await page.goto(base + '/?tab=' + tab + extra, { waitUntil: 'domcontentloaded' });
  return { page, context, errors };
}
async function finish({ page, context, errors }, name, el) {
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': no sideways scroll');
  if (el) await page.locator(el).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: false }); shots++;
  assert.deepEqual(errors, [], name + ': no page errors');
  await context.close();
}
const text = (page, sel) => page.locator(sel).first().innerText();
const want = (name) => !ONLY || ONLY.split(',').includes(name);

try {
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    const tag = width + '-' + theme;
    for (const who of ['owner', 'public']) {
      owner = who === 'owner';
      const t = who + '-' + tag;
      publicAsks.length = 0;
      if (want('market-map')) {
        // Market map: every tab.
        let s = await open(width, theme, 'market-map');
        await s.page.locator('#mm-root svg').first().waitFor({ state: 'visible', timeout: 15000 });
        ok(/Fear map|fear/i.test(await text(s.page, '#mm-root')), 'fear map opens first');
        await finish(s, 'mm-fear-' + t, '#mm-root');
        for (const tab of ['scatter', 'wall', 'crowd', 'breadth', 'shorts']) {
          s = await open(width, theme, 'market-map');
          await s.page.locator('[data-mm-tab="' + tab + '"]').first().waitFor({ state: 'visible', timeout: 15000 });
          await s.page.locator('[data-mm-tab="' + tab + '"]').first().click();
          await s.page.waitForTimeout(400);
          const body = await text(s.page, '#mm-root');
          if (tab === 'scatter') {
            const opts = await s.page.locator('select[data-mm-x] option').allInnerTexts();
            ok(owner === opts.some((o) => /grade/i.test(o)), owner ? 'Owners can put the grade on an axis' : 'the public lens has no grade axis');
          }
          if (tab === 'wall') ok((await s.page.locator('#mm-root .mm-wall > *').count()) >= 10, 'chart wall draws a card per stock');
          if (tab === 'crowd') ok(owner === /open trade/i.test(body), owner ? 'Owners see open-trade pairs' : 'public crowding has no open trades');
          if (tab === 'shorts') ok(/days to cover/i.test(body), 'crowded shorts table');
          if (tab === 'breadth') ok((await s.page.locator('#mm-root canvas, #mm-root .ck-host, #mm-root svg').count()) > 0, 'breadth charts mount');
          await finish(s, 'mm-' + tab + '-' + t, '#mm-root');
        }
      }
      if (want('whats-changed')) {
        const s = await open(width, theme, 'whats-changed');
        await s.page.waitForFunction(() => /Call wall/.test(document.getElementById('wc-root')?.innerText || ''), null, { timeout: 15000 });
        const body = await text(s.page, '#wc-root');
        ok(/Unusual call trade/.test(body) && /filed a new 13F/.test(body), 'flow and filings listed');
        if (owner) await s.page.waitForFunction(() => /Grade 4\.1 → 7\.4/.test(document.getElementById('wc-root')?.innerText || ''), null, { timeout: 10000 });
        ok(owner === /Grade 4\.1 → 7\.4/.test(await text(s.page, '#wc-root')), owner ? 'Owners see 2+ point grade moves' : 'no grade moves for the public');
        await finish(s, 'wc-' + t, '#wc-root');
      }
      if (want('past-day')) {
        recordAsks.length = 0;
        const s = await open(width, theme, 'past-day');
        await s.page.locator('#pd-root select, #pd-root [data-pd-date]').first().waitFor({ state: 'visible', timeout: 15000 });
        await s.page.waitForTimeout(500);
        if (owner) await s.page.waitForFunction(() => /Top Picks runs?|Brief/i.test(document.getElementById('pd-root')?.innerText || ''), null, { timeout: 10000 });
        const body = await text(s.page, '#pd-root');
        ok(owner === /TSLA put|Top Picks run/i.test(body), owner ? 'Owners see that day\'s Top Picks run' : 'public Past days has no Top Picks run');
        if (owner) ok(recordAsks.includes('picks-accuracy.json'), 'Past days reads trades through the Track Record copy (wiped periods stay out)');
        await finish(s, 'pd-' + t, '#pd-root');
      }
      if (want('flow')) {
        const s = await open(width, theme, 'flow');
        await s.page.waitForFunction(() => /Same day/.test(document.getElementById('zdte-root')?.innerText || ''), null, { timeout: 15000 });
        await finish(s, 'zdte-' + t, '#zdte-root');
      }
      if (want('calendar')) {
        const s = await open(width, theme, 'calendar');
        await s.page.waitForFunction(() => /VIX options and futures expire/.test(document.getElementById('page-pane-calendar')?.innerText || ''), null, { timeout: 15000 });
        ok(/Market dates/.test(await s.page.locator('#page-pane-calendar').innerText()), 'market dates on the Calendar, with their own filter');
        await finish(s, 'cal-' + t, '.cal-market');
      }
      if (want('bonds')) {
        const s = await open(width, theme, 'bonds-usd');
        await s.page.waitForFunction(() => /Fed liquidity line/i.test(document.getElementById('bonds-liquidity')?.innerText || '') && /Now\s+\$/i.test(document.getElementById('bonds-liquidity')?.innerText || ''), null, { timeout: 15000 });
        await s.page.locator('#bonds-liquidity .bonds-liquidity-chart canvas, #bonds-liquidity .bonds-liquidity-chart svg').first().waitFor({ state: 'attached', timeout: 15000 });
        await finish(s, 'liq-' + t, '#bonds-liquidity');
      }
      if (want('stock')) {
        let s = await open(width, theme, 'stock', '&s=NVDA');
        await s.page.locator('#stp-chart').waitFor({ state: 'visible', timeout: 15000 });
        await s.page.waitForTimeout(600);
        ok(await s.page.locator('[data-stock-cone]').count() === 1, 'expected-move button');
        ok(/short interest/i.test(await s.page.locator('body').innerText()), 'short interest stat');
        await finish(s, 'stock-chart-' + t, '#stp-chart');
        for (const tab of ['story', 'earnings', 'options', 'owner'].filter((x) => owner || x !== 'owner')) {
          recordAsks.length = 0;
          s = await open(width, theme, 'stock', '&s=NVDA');
          const btn = s.page.locator('[data-stock-tab="' + tab + '"]').first();
          await btn.waitFor({ state: 'visible', timeout: 15000 });
          await btn.click();
          await s.page.waitForFunction(() => !/Loading…/.test(document.getElementById('stp-tab-body')?.innerText || 'Loading…'), null, { timeout: 15000 });
          await s.page.waitForTimeout(500);
          const body = await text(s.page, '#stp-tab-body');
          if (tab === 'story') {
            ok(owner === /Top Picks|Grade/.test(body), owner ? 'Owner story shows grade changes and trades' : 'public story has no Owner events');
            if (owner) ok(recordAsks.includes('grades-history.json') && recordAsks.includes('picks-accuracy.json'), 'Story reads grades and trades through the Track Record copy');
          }
          if (tab === 'earnings') ok(await s.page.locator('.stp-em-svg').count() >= 3, 'earnings small multiples');
          if (tab === 'options') ok(await s.page.locator('.stp-grid td').count() > 20, 'chain heat grid');
          if (tab === 'owner') {
            await s.page.waitForFunction(() => /crowded into the print/.test(document.getElementById('stp-tab-body')?.innerText || ''), null, { timeout: 10000 });
            ok(true, 'Owner ticker note shows on the stock page');
          }
          await finish(s, 'stock-' + tab + '-' + t, '#stp-tab-body');
        }
        if (!owner) ok(await (await open(width, theme, 'stock', '&s=NVDA')).page.locator('[data-stock-tab="owner"]').count() === 0, 'no Owner tab for the public');
      }
      if (!owner) assert.deepEqual([...new Set(publicAsks)], [], 'a public visitor never asks for an Owner file (' + tag + ')'), checks++;
    }
    owner = true;
    if (want('track')) {
      let s = await open(width, theme, 'track', '&acc=research');
      await s.page.waitForFunction(() => /Grade calibration/i.test(document.body.innerText), null, { timeout: 20000 });
      ok(await s.page.locator('.acc-cal-svg circle').count() >= 3, 'calibration dots');
      await finish(s, 'track-calibration-' + tag, '.acc-cal-wrap');
      s = await open(width, theme, 'track', '&acc=scorecard');
      await s.page.locator('details.acc-gates').first().waitFor({ state: 'attached', timeout: 20000 });
      await s.page.evaluate(() => { document.querySelectorAll('details.acc-gates').forEach((d) => { d.open = true; }); });
      await s.page.waitForFunction(() => /Did it help\?/i.test(document.querySelector('details.acc-gates')?.innerText || ''), null, { timeout: 10000 });
      ok(/Helped|Cost trades|No clear difference|Too few yet/i.test(await text(s.page, 'details.acc-gates')), 'gate verdicts');
      await finish(s, 'track-gates-' + tag, '.acc-gate-verdict');
    }
    if (want('open-picks')) {
      const s = await open(width, theme, 'open-picks');
      await s.page.waitForFunction(() => /Net stock exposure/i.test(document.body.innerText), null, { timeout: 20000 });
      await s.page.waitForFunction(() => /Fed 12-09|CPI 11-12/.test(document.querySelector('.book-risk')?.innerText || ''), null, { timeout: 10000 });
      ok(/E 11-19/.test(await text(s.page, '.book-risk')), 'expiry ladder flags the report before expiry');
      await finish(s, 'open-picks-book-' + tag, '.book-risk');
    }
  }
  // Trade journal: add a note with tags on an open trade, then edit the ticker note.
  if (want('journal')) {
    owner = true; posts.length = 0;
    const s = await open(1440, 'light', 'open-picks');
    // Wide screens open Open picks as a table: the notes sit in each row's detail row.
    const expand = s.page.locator('#open-picks-root table [data-vt-expand]').first();
    await expand.waitFor({ state: 'visible', timeout: 20000 });
    await expand.click();
    const add = s.page.locator('.acc-note [data-note-act="edit"][data-note-kind="trade"]').first();
    await add.waitFor({ state: 'visible', timeout: 20000 });
    ok(await s.page.locator('.vt-detail:not([hidden]) [data-note-kind="ticker"]').count() > 0, 'the ticker note sits beside the trade note');
    const id = await add.getAttribute('data-note-id');
    await add.click();
    const box = s.page.locator('[data-note-box="trade:' + id + '"]');
    await box.locator('textarea').fill('Bought the dip at the 20-day.\nPlan: hold through CPI.');
    await box.locator('[data-note-tag="Followed the plan"]').click();
    await box.locator('[data-note-tag="Macro"]').click();
    await box.locator('[data-note-act="save"]').click();
    await s.page.waitForFunction((k) => /Bought the dip/.test(document.querySelector('[data-note-box="' + k + '"]')?.innerText || ''), 'trade:' + id, { timeout: 5000 });
    const sent = posts.filter((p) => p.path === '/api/auth/picks-fills').map((p) => p.body.note);
    assert.deepEqual(sent, [{ trade_id: id, text: 'Bought the dip at the 20-day.\nPlan: hold through CPI.', tags: ['Followed the plan', 'Macro'] }], 'one note save with text and tags'); checks++;
    ok(/Followed the plan/.test(await box.innerText()) && /Macro/.test(await box.innerText()), 'tags show on the saved note');
    ok(/✎/.test(await s.page.locator('[data-note-flag="trade:' + id + '"]').first().textContent()), 'the row shows a note mark after saving');
    await finish(s, 'journal-1440-light', '[data-note-box="trade:' + id + '"]');
    // Phones show cards: the notes sit on each card.
    const p = await open(390, 'dark', 'open-picks');
    await p.page.locator('.acc-notes [data-note-kind="trade"]').first().waitFor({ state: 'visible', timeout: 20000 });
    ok(await p.page.locator('.acc-notes [data-note-kind="ticker"]').count() > 0, 'cards carry trade and ticker notes');
    await finish(p, 'journal-390-dark', '.acc-notes');
  }
} finally {
  await browser.close();
  server.close();
}
console.log('views-next browser check passed (' + checks + ' checks, ' + shots + ' screenshots in ' + output + ')');

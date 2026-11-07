// Browser check for the 2026-11-06 additions: Earnings week ahead, Glossary,
// the Track Record week recap and took/skipped marks, the "why no picks today"
// card, the calendar subscribe box, the Owner watchlist alerts on Home, and the
// freshness line. Shipped assets with synthetic data shaped like the live
// files; no provider, account or production store is contacted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEarningsWeek, buildEarningsWeekPlan } from '../lib/earnings-week.mjs';
import { computePicksAccuracyStats } from '../lib/track-record-stats.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const NOW = '2026-11-06T22:00:00Z'; // Friday 5 PM ET: the week recap is final
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.SITE_NEXT_BROWSER_OUT || resolve(tmpdir(), 'stonks-site-next-browser');
await mkdir(output, { recursive: true });

// --- fixtures ----------------------------------------------------------------
const ev = (date, movePct, extra = {}) => ({ date, movePct, epsActual: 1.1, epsEstimate: 1, surprisePct: 8, ...extra });
const chains = {
  MRNA: { spot: 258.6, fundamentals: { name: 'Moderna, Inc.', nextEarningsDate: '2026-11-06', nextEarningsSession: 'AM' },
    earningsHx: { events: [ev('2026-02-13', 0.0403), ev('2026-05-01', 0.0425), ev('2026-07-31', 0.0058), ev('2026-11-06', 0.0709, { impliedMovePct: 0.0883, pre10Pct: 0.19 })], next: null }, ivRank: { pctile: 62 } },
  NVDA: { spot: 188.3, fundamentals: { name: 'NVIDIA Corporation', nextEarningsDate: '2026-11-11', nextEarningsSession: 'PM' },
    earningsHx: { events: [ev('2025-11-19', 0.031, { impliedMovePct: 0.07 }), ev('2026-02-25', -0.085, { impliedMovePct: 0.075 }), ev('2026-05-27', 0.062, { impliedMovePct: 0.068 }), ev('2026-08-26', -0.034, { impliedMovePct: 0.064 })],
      next: { date: '2026-11-11', impliedMovePct: 0.081, pre10Pct: -0.12 } }, ivRank: { pctile: 71 } },
  CRWV: { spot: 96.4, fundamentals: { name: 'CoreWeave, Inc.', nextEarningsDate: '2026-11-10', nextEarningsSession: 'PM' },
    earningsHx: { events: [ev('2026-05-14', -0.12), ev('2026-08-12', 0.21, { impliedMovePct: 0.14 })], next: { date: '2026-11-10', impliedMovePct: 0.16 } } },
  DIS: { spot: 112.2, fundamentals: { name: 'The Walt Disney Company', nextEarningsDate: '2026-11-12', nextEarningsSession: 'AM' },
    earningsHx: { events: [ev('2026-02-04', 0.024), ev('2026-05-07', 0.103), ev('2026-08-06', -0.021)], next: { date: '2026-11-12' } } },
};
const board = buildEarningsWeek(chains, {
  builtAtIso: '2026-11-06T21:10:00Z', todayIso: '2026-11-06', sessionsBetween: (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000)),
  impliedMoveFor: (d) => (d.spot === 112.2 ? { pct: 0.052 } : null),
  seasonKeyOf: (iso) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`,
  verdictOf: (e) => (e.surprisePct > 1 ? 'beat' : e.surprisePct < -1 ? 'miss' : 'inline'),
});
const plan = buildEarningsWeekPlan(board, chains, { grades: { NVDA: { side: 'call', conviction: 6.2 }, DIS: { side: 'put', conviction: 2 }, MRNA: { side: 'call', conviction: 5 } }, engineSeason: { n: 30, negativeShare: 0.4 } });

const trade = (symbol, side, entryDate, exitDate, pnl, status, extra = {}) => ({ symbol, side, tier: side === 'put' ? 'strong-put' : 'strong-call', score: side === 'put' ? -7.6 : 7.4,
  entryDate, exitDate, optionPnlPct: pnl, outcome: exitDate ? (pnl > 0 ? 'win' : 'loss') : null, status, entryRegime: 'neutral', sector: 'Semis',
  gradeModelVersion: '2026-11-price-pillar', exitPolicy: { version: '2026-10-22-tp25' },
  contract: { structure: 'debit_vertical', optionType: side, strike: 100, expiry: Date.UTC(2026, 11, 18) / 1000, expiryLabel: "Dec 18, '26", mid: 5, netDebit: 5 }, ...extra });
const closed = [
  trade('SMCI', 'call', '2026-10-21T15:06:02Z', '2026-11-02T20:33:58Z', -55.9, 'hit-stop-prem'),
  trade('WDC', 'call', '2026-10-28T19:33:26Z', '2026-11-02T16:04:51Z', -42.7, 'hit-stop-under'),
  trade('AMD', 'call', '2026-11-03T16:04:00Z', '2026-11-05T16:04:00Z', 26.1, 'hit-tp-prem'),
  trade('TSLA', 'put', '2026-11-02T16:05:00Z', '2026-11-06T20:33:00Z', 25.4, 'hit-tp-prem', { eventPlay: { kind: 'earnings', label: 'TSLA earnings' } }),
  trade('ORCL', 'call', '2026-10-28T19:33:26Z', '2026-10-29T19:33:41Z', -25.2, 'hit-stop-under'),
];
const archive = [trade('LITE', 'call', '2026-06-21T15:05:29Z', '2026-07-01T15:06:19Z', 40.5, 'hit-tp-prem', { archived: true })];
const openTrades = [trade('NVDA', 'call', '2026-11-04T16:04:00Z', null, null, 'open', { optionPnlPct: 6.2 })];
const accuracy = {
  builtAtIso: "2026-11-06T20:33:00Z", open: openTrades, closed, archive,
  stats: computePicksAccuracyStats(openTrades, closed, '2026-11-06T20:33:00Z'),
  allTimeStats: computePicksAccuracyStats([], closed.concat(archive), '2026-11-06T20:33:00Z'),
  gateLog: [
    { date: '2026-11-03', sym: 'AMZN', side: 'call', gate: 'ai-wait', total: 6.8 }, { date: '2026-11-04', sym: 'GOOGL', side: 'call', gate: 'ai-wait', total: 7.1 },
    { date: '2026-11-05', sym: 'AVGO', side: 'call', gate: 'factor-run-cap', total: 7.3 }, { date: '2026-11-04', sym: 'NVDA', side: 'call', gate: 'opened', total: 7.4 },
  ],
};
// Today's Top Picks run: six names on watch, none ready to buy.
const watchPick = (symbol, side, total) => ({ symbol, side, total, score: total, conviction: Math.abs(total), group: 'watch', classification: 'waitEntry',
  recommendation: { tier: side === 'put' ? 'put' : 'call', label: side === 'put' ? 'Put' : 'Call' }, spot: 100, sector: 'Software',
  entry: { now: false, signal: 'wait-market', headline: 'The current market-adjusted score is below the recommendation bar' }, pillars: {}, drivers: [] });
const picks = {
  builtAtIso: '2026-11-06T20:33:00Z', minConviction: 4,
  rosterMeta: { minConviction: 4, tradeCut: 4, regimeBand: 'risk-off', turnedAway: [
    { sym: 'EWY', side: 'put', total: -7.7, gate: 'timing-checks' }, { sym: 'TEAM', side: 'put', total: -6.6, gate: 'below-strong' },
    { sym: 'AXP', side: 'call', total: 5.6, gate: 'below-strong' }, { sym: 'ADBE', side: 'put', total: -5.5, gate: 'below-strong' },
  ] },
  picks: [watchPick('EWY', 'put', -7.7), watchPick('TEAM', 'put', -6.6), watchPick('AXP', 'call', 5.6), watchPick('ADBE', 'put', -5.5)],
};
const grades = { grades: { DRAM: { symbol: 'DRAM', total: -3.8 }, SMCI: { symbol: 'SMCI', total: 3.1 }, MU: { symbol: 'MU', total: 2.4 } }, minConviction: 4 };
const maTracker = { builtAtIso: '2026-11-06T21:10:00Z', tickers: [
  { symbol: 'NVDA', spot: 188.96, levels: { 20: 211.66, 50: 219.86, 100: 214.01, 200: 186.4 }, previousDistances: { 20: -15, 50: -17.7, 100: -15.2, 200: -0.6 } },
  { symbol: 'MU', spot: 686.35, levels: { 50: 700, 200: 520 }, previousDistances: { 50: 1.2, 200: 30 } } ] };
const oiTracker = { scannedAt: '2026-11-06T13:31:30Z', tickers: [
  { symbol: 'NVDA', spot: 188.3, callWall: { strike: 210, oi: 172731, expSec: 1794182400 }, putWall: { strike: 190, oi: 43477, expSec: 1793923200 }, cpRatio: 1.4, strikes: [] },
  { symbol: 'MU', spot: 686.35, callWall: { strike: 720, oi: 9000, expSec: 1793923200 }, putWall: { strike: 680, oi: 12000, expSec: 1793923200 }, cpRatio: 0.9, strikes: [] } ] };
const fills = { rows: [], marks: {} };
// The Owner's Top Picks market mode (lib/top-picks-mode.mjs), saved by a POST.
let pickMode = { mode: 'auto', label: 'Auto', updatedAt: null, by: null, history: [] };
const ownerWatch = { symbols: ['NVDA', 'MU', 'MRNA'], updatedAt: '2026-11-06T15:00:00Z', icsToken: 'a'.repeat(24) + '.' + 'b'.repeat(32) };

// --- server --------------------------------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let owner = true;
const posts = [];
const data = { 'earnings-week.json': board, 'earnings-week-plan.json': plan, 'picks-accuracy.json': accuracy, 'grades.json': grades, 'ma-tracker.json': maTracker, 'oi-tracker.json': oiTracker,
  'manifest.json': { symbols: [], narratives: [] }, 'manifest-free.json': { symbols: [], narratives: [] }, 'picks-changes.json': { events: [] }, 'picks-roster.json': { current: [], dropped: [] } };
const ownerOnly = new Set(['earnings-week-plan.json', 'picks-accuracy.json', 'grades.json']);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (v, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  if (req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    posts.push({ path: url.pathname, body: JSON.parse(body || '{}') });
    if (url.pathname === '/api/auth/owner-watchlist') return json(ownerWatch);
    if (url.pathname === '/api/auth/top-picks-mode') {
      const m = posts[posts.length - 1].body.mode;
      const labels = { auto: 'Auto', 'no-puts': 'No new puts', 'no-calls': 'No new calls', pause: 'Pause new trades' };
      if (!labels[m]) return json({ error: 'bad mode' }, 400);
      pickMode = { mode: m, label: labels[m], updatedAt: NOW, by: 'Synthetic owner', history: [{ mode: m, at: NOW, by: 'Synthetic owner' }] };
      return json(pickMode);
    }
    if (url.pathname === '/api/auth/picks-fills') {
      await new Promise((r) => setTimeout(r, 150)); // a save takes a moment
      const m = posts[posts.length - 1].body.mark || {};
      if (m.trade_id) fills.marks[m.trade_id] = { took: m.took === true, reason: m.reason || null, at: NOW };
      return json(fills);
    }
    return json({ error: 'read-only' }, 405);
  }
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json(owner ? { enabled: true, authed: true, authenticated: true, trackRecord: true, topPicks: true, user: { name: 'Synthetic owner' } } : { enabled: true, authed: false, authenticated: false });
  if (url.pathname === '/api/auth/top-picks') return owner ? json(picks) : json({ error: 'auth required' }, 401);
  if (url.pathname === '/api/auth/owner-watchlist') return owner ? json(ownerWatch) : json({ error: 'auth required' }, 401);
  if (url.pathname === '/api/auth/top-picks-mode') return owner ? json(pickMode) : json({ error: 'auth required' }, 401);
  if (url.pathname === '/api/auth/picks-fills') return owner ? json(fills) : json({ error: 'auth required' }, 401);
  if (url.pathname === '/api/quotes') return json({ quotes: [] });
  if (url.pathname === '/api/auth/track-record-data') {
    const k = url.searchParams.get('key');
    if (!owner) return json({ error: 'auth required' }, 401);
    return k in data ? json(data[k]) : json({});
  }
  const key = url.pathname === '/api/auth/me' ? url.searchParams.get('data') : /^\/(?:api\/)?data\//.test(url.pathname) ? url.pathname.replace(/^\/(?:api\/)?data\//, '') : null;
  if (key) {
    if (ownerOnly.has(key) && !owner) return json({ error: 'auth required' }, 401);
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
async function open(width, theme, tab, extra = '') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem('stonks-theme', t); localStorage.setItem('stonks-watch-v1', JSON.stringify(['NVDA', 'MU'])); }, theme);
  await page.clock.install({ time: new Date(NOW) });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' })));
  await page.goto(base + '/?tab=' + tab + extra, { waitUntil: 'domcontentloaded' });
  return { page, context, errors };
}
async function finish({ page, context, errors }, name) {
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': no sideways scroll');
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: false }); shots++;
  assert.deepEqual(errors, [], name + ': no page errors');
  await context.close();
}
try {
  for (const [width, theme] of [[1440, 'light'], [390, 'dark'], [1440, 'dark'], [390, 'light']]) {
    const tag = width + '-' + theme;
    for (const who of ['owner', 'public']) {
      owner = who === 'owner';
      // Earnings week ahead (public page; the Top Picks plan column is Owner only).
      let s = await open(width, theme, 'earnings-week');
      const ewb = s.page.locator('#ewb-root');
      await ewb.locator('table').first().waitFor({ state: 'visible' });
      const text = await ewb.innerText();
      ok(/MRNA/.test(text) && /Reported: \+7\.1%/.test(text), 'the print that reported this morning is marked Reported with its move');
      ok(/NVDA/.test(text) && /8\.1%/.test(text), 'a stamped straddle move shows');
      ok(owner === /Top Picks plan/.test(text), owner ? 'Owners see the Top Picks plan column' : 'the public board has no Top Picks plan');
      if (width >= 1440) {
        const fit = await s.page.evaluate(() => { const w = document.querySelector('#ewb-root .vt-wrap'); return { sw: w.scrollWidth, cw: w.clientWidth, cols: [...w.querySelectorAll('thead th')].map((t) => t.textContent.trim() + ':' + Math.round(t.getBoundingClientRect().width)) }; });
        ok(fit.sw <= fit.cw + 1, 'the board fits a desktop screen without sideways scrolling: ' + JSON.stringify(fit));
      }
      await finish(s, 'earnings-week-' + who + '-' + tag);
    }
    owner = true;
    // Glossary page.
    let s = await open(width, theme, 'glossary');
    await s.page.locator('#glossary-section').waitFor({ state: 'visible' });
    ok((await s.page.locator('#glossary-section').innerText()).length > 400, 'the Glossary lists terms');
    await finish(s, 'glossary-' + tag);
    // Track Record: Week recap.
    s = await open(width, theme, 'track', '&acc=recap');
    const recap = s.page.locator('#acc-recap');
    await recap.locator('.recap-kpis').waitFor({ state: 'visible', timeout: 15000 });
    const rt = await recap.innerText();
    ok(/Nov 2 to 6, 2026/.test(rt), 'the recap names the week');
    ok(/TSLA/.test(rt) && /AMD/.test(rt), 'the recap lists the week\'s closes');
    ok(/AI said wait/.test(rt), 'the recap names the rule that turned away the most');
    await finish(s, 'track-recap-' + tag);
    // Top Picks: why no picks today.
    s = await open(width, theme, 'picks');
    const card = s.page.locator('.nopick-card');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const ct = await card.innerText();
    ok(/EWY/.test(ct) && /Entry timing checks/.test(ct), 'the closest name and its rule show');
    await s.page.waitForFunction(() => /DRAM/.test(document.querySelector('.nopick-card')?.innerText || ''), null, { timeout: 5000 });
    ok(true, 'the list is topped up from the shared grade index');
    // Market mode switch (Owner): shows the saved mode, and a click saves it.
    const modeBox = s.page.locator('#picks-mode');
    await modeBox.locator('.picks-mode-btn.is-on').waitFor({ state: 'visible', timeout: 5000 });
    ok(/Market mode/.test(await modeBox.innerText()) && (await modeBox.locator('.picks-mode-btn.is-on').innerText()) === 'Auto', 'the market mode switch shows the saved mode (Auto)');
    ok((await modeBox.locator('.picks-mode-btn').count()) === 4, 'the switch offers four modes');
    if ((width === 1440 && theme === 'light') || (width === 390 && theme === 'dark')) {
      s.page.once('dialog', (d) => d.accept());
      await modeBox.locator('[data-picks-mode="no-puts"]').click();
      await s.page.waitForFunction(() => document.querySelector('#picks-mode .picks-mode-btn.is-on')?.textContent === 'No new puts', null, { timeout: 5000 });
      ok(posts.some((p) => p.path === '/api/auth/top-picks-mode' && p.body.mode === 'no-puts'), 'a click saves the mode');
      const mt = await modeBox.innerText();
      ok(/New puts are held back/.test(mt) && /Mon 11:00 ET run/.test(mt) && /Synthetic owner/.test(mt), 'it says what the mode does, who set it and when it starts: ' + mt);
      ok(await modeBox.evaluate((el) => el.classList.contains('is-hold')), 'a held mode is marked on the page');
      await modeBox.scrollIntoViewIfNeeded();
      await finish(s, 'picks-mode-' + tag);
      pickMode = { mode: 'auto', label: 'Auto', updatedAt: null, by: null, history: [] };
      s = await open(width, theme, 'picks');
      await s.page.locator('.nopick-card').waitFor({ state: 'visible', timeout: 15000 });
    }
    await s.page.locator('.nopick-card').scrollIntoViewIfNeeded();
    await finish(s, 'picks-nopicks-' + tag);
    // Calendar subscribe box (Owner link once the saved list syncs).
    s = await open(width, theme, 'calendar');
    const ics = s.page.locator('#ics-box');
    await s.page.waitForFunction(() => /private link/.test(document.getElementById('ics-box')?.innerText || ''), null, { timeout: 10000 });
    ok(/webcal:.*calendar-ics\?o=/.test(await ics.locator('[data-ics-subscribe]').getAttribute('href')), 'the Owner subscribe link is the signed one');
    await ics.scrollIntoViewIfNeeded();
    await finish(s, 'calendar-ics-' + tag);
    // Home: Owner desk alerts for the synced watchlist.
    s = await open(width, theme, 'home');
    const alerts = s.page.locator('#landing-desk-alerts');
    await s.page.waitForFunction(() => /Crossed above its 200-day/.test(document.getElementById('landing-desk-alerts')?.innerText || ''), null, { timeout: 15000 });
    const at = await alerts.innerText();
    ok(/NVDA/.test(at) && /put wall|call wall/i.test(at), 'watchlist alerts show crosses and walls');
    ok(await s.page.locator('#freshness-banner, .freshness-detail').count() > 0, 'the freshness line renders');
    await alerts.scrollIntoViewIfNeeded();
    await finish(s, 'home-alerts-' + tag);
  }
  // Took / skipped marks: two quick taps both reach the server, in order.
  owner = true; posts.length = 0;
  const s = await open(1440, 'light', 'track', '&acc=picks');
  await s.page.locator('[data-acc-mark="took"]').first().waitFor({ state: 'visible', timeout: 15000 });
  const btns = s.page.locator('[data-acc-mark="took"]');
  ok(await btns.count() >= 2, 'closed trades offer the took / skipped buttons');
  const ids = [await btns.nth(0).getAttribute('data-acc-mark-id'), await btns.nth(1).getAttribute('data-acc-mark-id')];
  await s.page.evaluate((list) => list.forEach((id) => document.querySelector('[data-acc-mark="took"][data-acc-mark-id="' + id + '"]').click()), ids);
  await s.page.waitForFunction(() => document.querySelectorAll('.acc-mark-state.took').length >= 2, null, { timeout: 5000 });
  const marks = posts.filter((p) => p.path === '/api/auth/picks-fills').map((p) => p.body.mark && p.body.mark.trade_id);
  assert.deepEqual(marks, ids, 'a second tap during a save is queued, not dropped, and saves in order'); checks++;
  await finish(s, 'track-marks-1440-light');
} finally {
  await browser.close();
  server.close();
}
console.log('site-next browser check passed (' + checks + ' checks, ' + shots + ' screenshots in ' + output + ')');

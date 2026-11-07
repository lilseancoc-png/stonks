// Browser check for the 2026-11-07 edge, odds and run-health pieces: the
// "Do we have an edge yet?" Scorecard panel, the similar-setup odds lines on
// the Top Picks tile, the pick detail card and each open trade, and the Top
// Picks run status on Home and Open picks (published / missed). Runs as the
// Owner at 1440 light and 390 dark, then as a public visitor, which must not
// see any of it or ask for an Owner file. Synthetic data only; no provider,
// account or production store is contacted.
// Run: node scripts/regen-static.mjs (with any data/) && node scripts/edge-odds-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import { buildTopPicks, buildTopPicksPayload } from './build.mjs';
import { buildSetupOdds } from '../lib/setup-odds.mjs';
import { computePicksAccuracyStats } from '../lib/track-record-stats.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.EDGE_ODDS_BROWSER_OUT || resolve(tmpdir(), 'stonks-edge-odds-browser');
await mkdir(output, { recursive: true });

// --- fixtures ------------------------------------------------------------------
// Friday 2026-11-06. "published": the 15:30 run stamped 15:34 ET, checked at
// 17:00 ET. "missed": the last stamp is the 11:00 run, checked at 16:30 ET.
const CASES = {
  published: { now: '2026-11-06T22:00:00Z', built: '2026-11-06T20:34:00Z' },
  missed: { now: '2026-11-06T21:30:00Z', built: '2026-11-06T16:04:00Z' },
};
const { row, data, aiThesis } = entryPolicyFixture();
const macro = { state: 'neutral', stress: 0, dataQuality: { sufficient: true }, axes: {}, inputs: {} };
const built = buildTopPicks({ FIXTURE: data }, [], null, null, { macroRegime: macro }, null, 0.045, { preScored: { scored: [row], peerIndex: {}, regimeBand: 'neutral' }, aiThesisMap: { 'FIXTURE:call': aiThesis } });
const payload = buildTopPicksPayload(built, CASES.published.built);
assert.ok(payload.picks.length, 'fixture pick builds');
const pick = payload.picks[0];

let k = 0;
const contract = (side) => ({ structure: 'long', optionType: side, strike: 100, expiry: Date.parse('2026-12-18T20:00:00Z') / 1000, expiryLabel: '2026-12-18', iv: 0.4, delta: side === 'put' ? -0.55 : 0.55, mid: 4, netDebit: 4 });
const trade = (symbol, side, score, regime, pnl, extra = {}) => {
  const entry = new Date(Date.UTC(2026, 7, 10) + (k++) * 2 * 86400000);
  return { symbol, side, score, entryRegime: regime, tier: side === 'put' ? 'strong-put' : 'strong-call', entryDate: entry.toISOString(), exitDate: new Date(entry.getTime() + 5 * 86400000).toISOString(),
    entrySpot: 100, exitSpot: side === 'put' ? 100 - pnl / 10 : 100 + pnl / 10, status: pnl > 0 ? 'hit-tp-prem' : 'hit-stop-prem', outcome: pnl > 0 ? 'win' : 'loss', optionPnlPct: pnl,
    sector: 'Semiconductors', gradeModelVersion: k > 30 ? '2026-11-price-pillar' : '2026-10-iv-rule', exitPolicy: { version: '2026-10-22-tp25' }, contract: contract(side), ...extra };
};
const pnls = [25, -50, 26, 25, -48, 27, 25, 30, -50, 25, 25, -46, 28, 25, -50, 25, 31, 25, -52, 26, 25, 25, -50, 27, 25, 29, -49, 25, 25, 26, -50, 25, 28, 25, -47, 25];
const closedAll = pnls.map((p, i) => trade(['NVDA', 'AMD', 'MU', 'AVGO'][i % 4], i % 5 === 4 ? 'put' : 'call', i % 5 === 4 ? -(7 + (i % 3)) : 7 + (i % 3) + 0.3, ['neutral', 'risk-on', 'risk-off'][i % 3], p,
  i >= 24 ? { realFillPnlPct: p - 6 } : {}));
// A FIXTURE call history so the tile and detail card have a full match.
const fixtureHist = [25, 26, -50, 25, 25, 27, -49, 25, 28].map((p) => trade('FIXTURE', 'call', Number(pick.total) || 8.2, 'neutral', p));
closedAll.push(...fixtureHist);
closedAll.push(trade('XOM', 'call', 7.2, 'neutral', 3, { status: 'left-coverage', outcome: 'left-coverage', counted: false }));
const archive = closedAll.slice(0, 12).map((c) => ({ ...c }));
const closed = closedAll.slice(12);
const baselineClosed = closedAll.filter((c) => c.outcome === 'win' || c.outcome === 'loss').slice(0, 24).map((c) => ({ symbol: 'SPY', side: c.side, entryDate: c.entryDate, exitDate: c.exitDate, outcome: 'loss', optionPnlPct: c.side === 'put' ? -8 : 4, pairKey: `${c.symbol}:${c.side}:${c.entryDate}` }));
const openBook = [
  { ...trade('NVDA', 'call', 8.4, 'neutral', 6.2), status: 'open', outcome: null, exitDate: null, lastSpot: 101 },
  { ...trade('TSLA', 'put', -9.3, 'risk-off', -3.1), status: 'open', outcome: null, exitDate: null, lastSpot: 99 },
];
function accuracyFor(builtIso) {
  const setupOdds = buildSetupOdds({ closed, archive, roster: payload.picks, rosterRegime: 'neutral', open: openBook, builtAtIso: builtIso });
  return {
    builtAtIso: builtIso, open: openBook, closed, archive, setupOdds,
    stats: computePicksAccuracyStats(openBook, closed, builtIso), allTimeStats: computePicksAccuracyStats([], closed.concat(archive), builtIso),
    baseline: { open: [], closed: baselineClosed },
  };
}
const decided = closedAll.filter((c) => c.outcome === 'win' || c.outcome === 'loss');
const meanPct = decided.reduce((s, c) => s + c.optionPnlPct, 0) / decided.length;
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

// --- server --------------------------------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let owner = true, current = CASES.published;
const publicAsks = [];
function dataFor(key) {
  const acc = accuracyFor(current.built);
  const files = {
    'picks-accuracy.json': acc, 'picks-open.json': { builtAtIso: current.built, open: openBook, setupOdds: acc.setupOdds },
    'manifest.json': { symbols: [], narratives: [] }, 'manifest-free.json': { symbols: [], narratives: [] },
    'picks-changes.json': { events: [] }, 'picks-roster.json': { current: [], dropped: [] },
  };
  return key in files ? files[key] : {};
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (v, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  if (req.method !== 'GET') return json({ error: 'read-only' }, 405);
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json(owner ? { enabled: true, authed: true, authenticated: true, trackRecord: true, topPicks: true, user: { name: 'Synthetic owner' } } : { enabled: true, authed: false, authenticated: false });
  if (url.pathname === '/api/auth/top-picks') { if (!owner) publicAsks.push('top-picks'); return owner ? json(payload) : json({ error: 'auth required' }, 401); }
  if (url.pathname === '/api/auth/track-record-data') {
    const key = url.searchParams.get('key');
    if (!owner) { publicAsks.push('track-record-data'); return json({ error: 'auth required' }, 401); }
    return json(dataFor(key));
  }
  if (url.pathname === '/api/auth/picks-fills') return owner ? json({ rows: [], marks: {}, notes: { trades: {}, tickers: {} } }) : json({ error: 'auth required' }, 401);
  if (url.pathname.startsWith('/api/auth/') && url.pathname !== '/api/auth/me') { if (!owner) publicAsks.push(url.pathname); return owner ? json({}) : json({ error: 'auth required' }, 401); }
  const key = url.pathname === '/api/auth/me' ? url.searchParams.get('data') : /^\/(?:api\/)?data\//.test(url.pathname) ? url.pathname.replace(/^\/(?:api\/)?data\//, '') : null;
  if (key) {
    if (isPremiumKey(key) && !owner) { publicAsks.push(key); return json({ error: 'auth required' }, 401); }
    return json(dataFor(key));
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
let checks = 0, shots = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
async function open(width, theme, tab, extra = '', accTab = null) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([t, a]) => { localStorage.setItem('stonks-theme', t); if (a) localStorage.setItem('stonks-acc-tab', a); }, [theme, accTab]);
  await page.clock.install({ time: new Date(current.now) });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' })));
  await page.goto(base + '/?tab=' + tab + extra, { waitUntil: 'domcontentloaded' });
  return { page, context, errors };
}
async function finish({ page, context, errors }, name, el) {
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), name + ': no sideways page scroll');
  if (el) {
    const box = await page.locator(el).first().boundingBox();
    if (box) await page.evaluate((y) => scrollTo(0, Math.max(0, y - 80)), box.y + (await page.evaluate(() => scrollY)));
  }
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: false });
  shots++;
  assert.deepEqual(errors, [], name + ': no browser exceptions');
  await context.close();
}

try {
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    const tag = width + '-' + theme;
    owner = true; current = CASES.published;

    // Scorecard: the edge panel.
    let s = await open(width, theme, 'track', '', 'scorecard');
    await s.page.locator('.acc-edge').waitFor();
    const edge = await s.page.locator('.acc-edge').innerText();
    ok(/Do we have an edge yet\?/.test(edge), 'edge panel has its title');
    ok(/Not yet clear|Edge showing|Losing so far|Too early to say/.test(edge), 'edge panel shows a verdict');
    ok(edge.includes(fmtPct(meanPct)), 'edge panel average matches the decided trades (' + fmtPct(meanPct) + ')');
    ok(edge.includes(String(decided.length)), 'edge panel counts every decided trade, archive included');
    ok(/Average real fill/.test(edge) && /Picks minus a SPY option/.test(edge), 'real-fill and SPY rows show when enough trades carry them');
    ok(/needed to break even/.test(edge), 'win rate row names the break-even rate');
    ok(/Latest rule set only/.test(edge), 'latest rule set row shows when the record has more than one');
    ok(!/left-coverage/.test(await s.page.locator('.acc-edge-table').innerText()), 'left-coverage closes stay out');
    ok(await s.page.locator('.edge-chart svg[data-ch]').count() === 1, 'running-average chart carries hover points');
    ok(await s.page.locator('.edge-y span').count() >= 2 && await s.page.locator('.edge-chart svg text').count() === 0, 'axis labels sit outside the stretched SVG');
    ok(await s.page.locator('.acc-edge-table[data-nosort]').count() === 1, 'the measure table does not offer sorting');
    const order = await s.page.evaluate(() => { const st = document.getElementById('accuracy-stats'); return st && st.firstElementChild && st.firstElementChild.className; });
    ok(/acc-edge/.test(order || ''), 'edge panel leads the Scorecard');
    await finish(s, 'scorecard-' + tag, '.acc-edge');

    // Top Picks: tile chip and detail line.
    s = await open(width, theme, 'picks');
    await s.page.locator('[data-pick-open="FIXTURE"]').waitFor();
    const odds = accuracyFor(current.built).setupOdds.picks['FIXTURE|call'];
    ok(odds && odds.n >= 8, 'fixture pick has a similar-setup match');
    const chip = await s.page.locator('[data-pick-open="FIXTURE"] .ptc-odds').innerText();
    ok(chip.includes(odds.wins + '/' + odds.n + ' won'), 'tile chip shows wins of matched trades (' + chip + ')');
    const chipBox = await s.page.locator('[data-pick-open="FIXTURE"] .ptc-odds').boundingBox();
    const cardBox = await s.page.locator('[data-pick-open="FIXTURE"]').boundingBox();
    ok(chipBox && cardBox && chipBox.x >= cardBox.x && chipBox.x + chipBox.width <= cardBox.x + cardBox.width + 1, 'tile chip stays inside the card');
    await finish(s, 'picks-tile-' + tag, '[data-pick-open="FIXTURE"]');
    s = await open(width, theme, 'picks');
    await s.page.locator('[data-pick-open="FIXTURE"]').click();
    await s.page.locator('#picks-detail-card .odds-line').waitFor();
    const line = await s.page.locator('#picks-detail-card .odds-line').innerText();
    ok(line.includes(odds.wins + ' of ' + odds.n + ' won') && line.includes('likely ' + odds.range[0] + '–' + odds.range[1] + '%'), 'detail line shows wins, n and the likely range');
    await finish(s, 'picks-detail-' + tag, '#picks-detail-card .odds-line');

    // Open picks: odds on each trade; no run note when the run published.
    s = await open(width, theme, 'open-picks');
    if (width >= 1000) {
      // Wide screens open Open picks as a table: the "Like this" column.
      await s.page.locator('#open-picks-root table').first().waitFor();
      ok(await s.page.locator('#open-picks-root td .odds-cell').count() === openBook.length, 'every open trade has a "Like this" cell');
      await finish(s, 'open-picks-table-' + tag, '#open-picks-root table');
      s = await open(width, theme, 'open-picks');
      await s.page.locator('#open-picks-root [data-view-toggle="open-picks"][data-view-mode="cards"]').first().click();
    }
    await s.page.locator('#open-picks-root .acc-row-open').first().waitFor();
    ok(await s.page.locator('#open-picks-root .acc-row-open .odds-line').count() === openBook.length, 'every open trade card carries an odds line');
    ok(await s.page.locator('#open-picks-root .run-health').count() === 0, 'no run note when the latest run published');
    await finish(s, 'open-picks-' + tag, '#open-picks-root .odds-line');

    // Home: the run tile says when it last ran.
    s = await open(width, theme, 'home');
    // The tile draws first while picks-open.json loads; wait for the stamp.
    await s.page.waitForFunction(() => /last ran|did not publish|late/.test((document.querySelector('#landing-desk-tiles [data-go="picks"]') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const homeOk = await s.page.locator('#landing-desk-tiles [data-go="picks"]').innerText();
    ok(/last ran today 15:34 ET/.test(homeOk), 'Home run tile names the last run (' + homeOk.replace(/\s+/g, ' ') + ')');
    await finish(s, 'home-' + tag, '#landing-desk');

    // Missed 15:30 run.
    current = CASES.missed;
    s = await open(width, theme, 'open-picks');
    await s.page.locator('#open-picks-root .run-health-missed').waitFor();
    const note = await s.page.locator('#open-picks-root .run-health-missed').innerText();
    ok(/15:30 ET Top Picks run today has not published/.test(note) && /today 11:04 ET/.test(note), 'Open picks names the missed run and the last one (' + note + ')');
    await finish(s, 'open-picks-missed-' + tag, '#open-picks-root .run-health');
    s = await open(width, theme, 'home');
    await s.page.locator('#landing-desk-tiles [data-go="picks"] .sig-neg').waitFor();
    const homeMiss = await s.page.locator('#landing-desk-tiles [data-go="picks"]').innerText();
    ok(/15:30 ET Top Picks run today did not publish/.test(homeMiss) && /Mon/.test(homeMiss), 'Home run tile flags the missed run');
    await finish(s, 'home-missed-' + tag, '#landing-desk');
  }

  // Public visitor: nothing renders and no Owner file is asked for.
  owner = false; current = CASES.published;
  for (const tab of ['home', 'track', 'picks', 'open-picks']) {
    const s = await open(1440, 'light', tab);
    await s.page.waitForTimeout(1200);
    ok(await s.page.locator('.acc-edge, .odds-line, .ptc-odds, .run-health').count() === 0, 'public ' + tab + ': no edge, odds or run note');
    await finish(s, 'public-' + tab);
  }
  ok(publicAsks.filter((k2) => /picks-open|picks-accuracy|top-picks|track-record-data/.test(k2)).length === 0, 'public visit asked for no Owner file: ' + publicAsks.join(', '));
  console.log('edge odds browser: ok (' + checks + ' checks, ' + shots + ' screenshots in ' + output + ')');
} finally {
  await browser.close();
  server.close();
}

// Real browser over the committed app, with offline made-up props/results.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { sportsKey } from '../lib/sports/store.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(new URL('..', import.meta.url).pathname), now = Date.parse('2026-11-05T18:00Z');
const at = new Date(now).toISOString();
const game = { game_id: 'g1', season: 2026, local_date: '2026-11-05', start_utc: '2026-11-05T23:00Z', home_team: 'lal', away_team: 'gs', status: 'scheduled' };
const players = ['One', 'Two', 'Out'].map((n, i) => ({ sport: 'nba', player_id: 'p' + i, name: 'Fixture ' + n, position: 'G', team: 'lal', provider_ids: { espn: String(i + 1) } }));
const rows = players.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({ player_id: p.player_id, game_id: 'old' + i, sport: 'nba', season: 2026,
  date: new Date(Date.parse('2026-10-16T12:00Z') + i * 86400000).toISOString().slice(0, 10), team: 'lal', opponent: 'gs', home: true, played: true, position: 'G', minutes: 32, stats: { points: 25, rebounds: 7, assists: 5 } })));
const objects = new Map();
const put = (kind, value, opts = {}) => objects.set(sportsKey(kind, { sport: 'nba', ...opts }), JSON.stringify(value));
put('status', { state: 'ok', seasons: [2026], last_success_utc: at, latest_game_date: '2026-11-04' });
put('players', { players }); put('games', { games: [game] }, { season: 2026 }); put('player-games', { rows }, { season: 2026 });
const store = { backend: 'r2', rawGet: async (k) => objects.has(k) ? Buffer.from(objects.get(k)) : null, rawPut: async (k, v) => objects.set(k, String(v)), withLease: async (_, fn) => { await fn(() => {}); return { busy: false }; } };
let feedState = 'ok', sourceCalls = 0;
const sources = async () => { sourceCalls++; return {
  lines: { state: feedState, provider: 'Fixture PropLine', message: feedState === 'ok' ? null : 'Fixture feed unavailable', lines: players.map((p) => ({ event_id: 'e1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', start_utc: game.start_utc, player_name: p.name, stat: 'points', side: 'over', threshold: 15.5, observed_utc: at })) },
  injuries: { state: 'ok', observed_utc: at, reports: [{ name: 'Fixture Out', team: 'lal', status: 'Out', detail: 'Fixture injury', report_utc: at }] },
}; };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = (s) => { res.statusCode = s; return res; }; res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
  if (url.pathname === '/api/auth/me') {
    req.query = Object.fromEntries(url.searchParams);
    if (req.query.sports) return handleSportsRequest(req, res, { store, now: () => now, env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: 'fixture-owner', tr: true, tp: true }), loadPropSources: sources });
    return res.json({ enabled: true, authed: true, trackRecord: true, topPicks: true, user: { name: 'Fixture Owner' } });
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return res.json({});
  if (url.pathname.startsWith('/_vercel/')) return res.end('');
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) { res.statusCode = 404; return res.end(); }
  try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-sports-props'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage(), errors = [];
    await page.clock.install({ time: now });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/?tab=sports-nba');
    const pane = page.locator('#sports-nba-root');
    await pane.locator('.sp-prop').nth(1).waitFor();
    assert.equal(await pane.locator('.sp-prop').count(), 2);
    assert.ok(!(await pane.locator('.sp-props').innerText()).includes('Fixture Out\nMore'), 'Out player excluded');
    await pane.locator('.sp-prop details summary').first().click();
    assert.match(await pane.locator('.sp-prop').first().innerText(), /Workload & rest/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal page overflow');
    await page.screenshot({ path: resolve(output, 'picks-' + width + '.png'), fullPage: true });
    await pane.locator('[data-sp-prop-add]').first().click();
    const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('stonks-sports-draft-v1')));
    assert.equal(draft.legs.length, 1); assert.equal(draft.legs[0].threshold, 15.5); assert.equal(draft.legs[0].probability, null);
    await pane.locator('[data-sp-view="record"]').first().click();
    await pane.locator('.sp-prop-record').waitFor();
    assert.match(await pane.locator('.sp-prop-record').innerText(), /Pending/);
    const original = JSON.parse(objects.get(sportsKey('prop-record', { sport: 'nba', season: 2026 })));
    assert.equal(original.picks.length, 2);
    put('games', { games: [{ ...game, status: 'final' }] }, { season: 2026 });
    put('player-games', { rows: original.picks.map((p, i) => ({ player_id: p.player_id, game_id: game.game_id, played: true, stats: { points: i ? 5 : 25 } })) }, { season: 2026 });
    await pane.locator('[data-sp-record-refresh]').click();
    await pane.getByText('Bust', { exact: true }).waitFor();
    assert.match(await pane.locator('.sp-prop-record').innerText(), /50\.0%/);
    assert.ok(await pane.locator('a[download], a[href*="download=1"]').count());
    await page.screenshot({ path: resolve(output, 'record-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    // Restore the fixture before the second viewport; issued pair stays put.
    put('games', { games: [game] }, { season: 2026 }); put('player-games', { rows }, { season: 2026 });
  }
  const context = await browser.newContext(), page = await context.newPage();
  await page.clock.install({ time: now }); feedState = 'rate_limited';
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
  await page.goto(base + '/?tab=sports-nba'); await page.getByText('Fixture feed unavailable').first().waitFor();
  assert.equal(await page.locator('.sp-prop').count(), 0, 'outage never displays cached recommendations');
  assert.equal(JSON.parse(objects.get(sportsKey('prop-record', { sport: 'nba', season: 2026 }))).picks.length, 2, 'outage does not erase record');
  await context.close();
  console.log('Sports prop browser passed: two picks, evidence, mobile layout, builder, immutable record, final results and feed outage. Screenshots: ' + output);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }

// Real browser over the committed app, with offline made-up props/results.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { sportsKey } from '../lib/sports/store.mjs';
import { normalizeNBAQuotes } from '../lib/sports/nba-market.mjs';
import { gunzipSync } from 'node:zlib';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(new URL('..', import.meta.url).pathname), now = Date.parse('2026-11-05T18:00Z');
const at = new Date(now).toISOString(); let serverNow = now;
const game = { game_id: 'g1', season: 2026, local_date: '2026-11-05', start_utc: '2026-11-05T23:00Z', home_team: 'lal', away_team: 'gs', status: 'scheduled' };
const players = ['One', 'Two', 'Out'].map((n, i) => ({ sport: 'nba', player_id: 'p' + i, name: 'Fixture ' + n, position: 'G', team: i === 1 ? 'gs' : 'lal', provider_ids: { espn: String(i + 1) } }));
const rows = players.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({ player_id: p.player_id, game_id: 'old' + i, sport: 'nba', season: 2026,
  date: new Date(Date.parse('2026-10-16T12:00Z') + i * 86400000).toISOString().slice(0, 10), team: p.team, opponent: p.team === 'lal' ? 'gs' : 'lal', home: p.team === 'lal', played: true, position: 'G', minutes: p.name === 'Fixture Out' ? 12 : 32, stats: { points: 25, rebounds: 7, assists: 5 } })));
const objects = new Map();
const put = (kind, value, opts = {}) => objects.set(sportsKey(kind, { sport: 'nba', ...opts }), JSON.stringify(value));
put('status', { state: 'ok', seasons: [2026], last_success_utc: at, latest_game_date: '2026-11-04' });
put('players', { players }); put('games', { games: [game] }, { season: 2026 }); put('player-games', { rows }, { season: 2026 });
put('model', { model_version: 'fixture-team-context', as_of_date: '2026-11-04',
  context: { groups: { points: { all: { rate: 25 / 32 } } }, spread: { points: { a: 6, b: 1.5 } },
    factors: { points: { team_efficiency: { betas: [0.5, 0.5, 0, 0] }, team_pace: { betas: [1] } } },
    nba_team_context: { as_of_date: '2026-11-04', window: 20, source: 'box_score_estimate', league: { rating: 110, pace: 100 }, teams: {
      lal: { games: 10, offensive_rating: 112, defensive_rating: 108, net_rating: 4, pace: 98 },
      gs: { games: 12, offensive_rating: 115, defensive_rating: 111, net_rating: 4, pace: 102 },
    } } }, evaluation: { points: { status: 'validated' } } });
const store = { backend: 'r2', rawGet: async (k) => objects.has(k) ? Buffer.from(objects.get(k)) : null, rawPut: async (k, v) => objects.set(k, String(v)), withLease: async (_, fn) => { await fn(() => {}); return { busy: false }; } };
let feedState = 'ok', sourceCalls = 0, lastForce = null, holdNextRecord = false, heldRecordReady, releaseHeldRecord;
const referenceEvents = () => ['draftkings', 'fanduel', 'betmgm'].map((book) => ({ id: 'e1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', commence_time: game.start_utc,
  bookmakers: [{ key: book, markets: players.map((p) => ({ key: 'player_points', period: null, line_type: 'main', last_update: new Date(serverNow).toISOString(), outcomes: [
    { name: 'Over', description: p.name, point: 15.5, price: -400 }, { name: 'Under', description: p.name, point: 15.5, price: 300 },
  ] })) }] }));
const sources = async (args = {}) => { sourceCalls++; lastForce = !!args.force; return {
  lines: { state: feedState, provider: 'Fixture PropLine', message: feedState === 'ok' ? null : 'Fixture feed unavailable', lines: players.map((p) => ({ event_id: 'e1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', start_utc: game.start_utc, player_name: p.name, stat: 'points', side: 'over', threshold: 15.5, observed_utc: at })) },
  reference: { state: 'ok', quotes: normalizeNBAQuotes(referenceEvents(), serverNow), raw_events: referenceEvents() },
  injuries: { state: 'ok', observed_utc: at, reports: [{ name: 'Fixture Out', team: 'lal', status: 'Out', detail: 'Fixture injury', report_utc: at }] },
}; };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = (s) => { res.statusCode = s; return res; }; res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
  res.send = (b) => res.end(b);
  if (url.pathname === '/api/auth/me') {
    req.headers['x-forwarded-proto'] = 'http';
    if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; req.body = body; }
    req.query = Object.fromEntries(url.searchParams);
    if (req.query.sports === 'props-record' && !req.query.download) {
      const send = res.json;
      res.json = (body) => {
        if (!holdNextRecord) return send(body);
        holdNextRecord = false; heldRecordReady();
        return new Promise((done) => { releaseHeldRecord = () => { res.setHeader('X-Fixture-Stale', '1'); send(body); done(); }; });
      };
    }
    if (req.query.sports) return handleSportsRequest(req, res, { store, now: () => serverNow, env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: 'fixture-owner', tr: true, tp: true }), loadPropSources: sources });
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
    assert.match(await pane.locator('.sp-prop').first().innerText(), /Team efficiency/);
    assert.match(await pane.locator('.sp-prop').first().innerText(), /per 100 estimated possessions/);
    assert.match(await pane.locator('.sp-prop').first().innerText(), /Game pace/);
    assert.match(await pane.locator('.sp-prop').first().innerText(), /Sportsbook comparison/);
    assert.match(await pane.locator('.sp-prop').first().innerText(), /Minutes & role scenario/);
    await pane.locator('.sp-prop').first().screenshot({ path: resolve(output, 'team-context-' + width + '.png') });
    const pairCard = pane.locator('[data-sp-pair-game]');
    assert.equal(await pane.locator('[data-sp-slate="today"] .sp-slate-prop').count(), 2);
    assert.match(await pane.locator('[data-sp-slate="today"]').innerText(), /Best two-player pair across the slate/);
    await pairCard.locator('[data-sp-nba-payout]').fill('3');
    await pairCard.locator('[data-sp-nba-evaluate]').click();
    await pairCard.getByText('Experimental screen passes', { exact: true }).waitFor();
    if (width === 1440) { await pairCard.locator('[data-sp-nba-save]').click(); await pairCard.getByText('Paper pair saved at 3×. Its original players, line and entered payout stay fixed.', { exact: true }).waitFor(); }
    await pairCard.locator('[data-sp-nba-payout]').fill('1.5');
    await pairCard.locator('[data-sp-nba-evaluate]').click();
    await pairCard.getByText('Pass · no verified edge', { exact: true }).waitFor();
    const researchDownload = page.waitForEvent('download'); await pairCard.locator('[data-sp-nba-export]').click();
    const researchFile = await (await researchDownload).path();
    const research = JSON.parse(gunzipSync(await readFile(researchFile)));
    assert.equal(research.format, 'nba-research-export-1'); assert.ok(research.research.points[0].candidates.length >= 2);
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
    assert.ok(original.picks.every((p) => p.model.team_context.efficiency.applied), 'record preserves the ratings and applied adjustment');
    const held = new Promise((done) => { heldRecordReady = done; });
    holdNextRecord = true;
    await pane.locator('[data-sp-record-refresh]').click(); await held;
    put('games', { games: [{ ...game, status: 'final' }] }, { season: 2026 });
    put('player-games', { rows: original.picks.map((p, i) => ({ player_id: p.player_id, game_id: game.game_id, played: true, stats: { points: i ? 5 : 25 } })) }, { season: 2026 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await pane.getByText('Bust', { exact: true }).waitFor();
    const staleResponse = page.waitForResponse((r) => r.headers()['x-fixture-stale'] === '1');
    releaseHeldRecord(); await (await staleResponse).finished(); await page.waitForTimeout(100);
    assert.match(await pane.locator('.sp-prop-record').innerText(), /50\.0%/);
    assert.equal(await pane.getByText('Bust', { exact: true }).count(), 1, 'a slower pending response cannot overwrite the newer settled results');
    const smallDownload = page.waitForEvent('download');
    await pane.locator('[data-sp-record-export]').click();
    const small = await smallDownload;
    assert.equal(JSON.parse(await readFile(await small.path(), 'utf8')).records.length, 2);
    await page.screenshot({ path: resolve(output, 'record-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    // Restore the fixture before the second viewport; issued pair stays put.
    put('games', { games: [game] }, { season: 2026 }); put('player-games', { rows }, { season: 2026 });
  }
  const context = await browser.newContext(), page = await context.newPage();
  await page.clock.install({ time: now });
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
  await page.goto(base + '/?tab=sports-nba'); await page.locator('.sp-prop').first().waitFor();
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  const beforeHidden = sourceCalls;
  await page.clock.fastForward(121000);
  assert.equal(sourceCalls, beforeHidden, 'hidden page stops line polling');
  serverNow = now + 121000;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.sp-props-status')?.textContent.includes('10:02'));
  assert.ok(sourceCalls > beforeHidden, 'returning to a hidden tab resumes the scan');
  // The refresh button shows it is working, forces a feed re-read and says when it finished.
  const beforeManual = sourceCalls, refreshBtn = page.locator('[data-sp-props-refresh]');
  await refreshBtn.click();
  await page.locator('.sp-props-status').getByRole('status').filter({ hasText: /Refreshed at/ }).waitFor();
  assert.ok(sourceCalls > beforeManual && lastForce === true, 'refresh button forces a feed re-read');
  assert.equal(await page.locator('[data-sp-props-refresh]').innerText(), 'Refresh lines & injuries');
  // Poll before the source deadline and request new feed data, even without
  // a manual click. A failed poll must retain readable, disabled old analysis.
  const beforeAuto = sourceCalls;
  serverNow = now + 241000;
  await page.clock.fastForward(120000);
  await page.waitForFunction(() => document.querySelector('.sp-props-status')?.textContent.includes('10:04'));
  assert.ok(sourceCalls > beforeAuto && lastForce, 'automatic refresh bypasses the old two-minute feed cache');
  await page.route('**/api/auth/me?**sports=props&**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fixture refresh failure"}' }));
  await page.clock.fastForward(61000);
  await page.locator('.sp-props-status').filter({ hasText: 'Refresh failed. Previous analysis' }).waitFor();
  assert.equal(await page.locator('.sp-prop').count(), 2, 'expired analysis remains readable');
  assert.ok(await page.locator('[data-sp-prop-add]').first().isDisabled());
  assert.ok(await page.locator('[data-sp-nba-evaluate]').isDisabled());
  assert.ok(await page.locator('[data-sp-slate-add="today"]').isDisabled());
  await page.unroute('**/api/auth/me?**sports=props&**');
  serverNow = now; feedState = 'rate_limited';
  await page.goto(base + '/?tab=sports-nba'); await page.getByText('Fixture feed unavailable').first().waitFor();
  assert.equal(await page.locator('.sp-prop').count(), 0, 'outage never displays cached recommendations');
  assert.equal(JSON.parse(objects.get(sportsKey('prop-record', { sport: 'nba', season: 2026 }))).picks.length, 2, 'outage does not erase record');
  await context.close();
  // Cross-game slate rendering and Add both preserve each game's identity.
  feedState = 'ok'; serverNow = now;
  const crossContext = await browser.newContext(), crossPage = await crossContext.newPage();
  await crossPage.clock.install({ time: now });
  const otherGame = { ...game, game_id: 'g2', home_team: 'chi', away_team: 'bos', start_utc: '2026-11-05T23:30Z' };
  await crossPage.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.fulfill({ body: '' });
    if (!['board', 'props'].includes(url.searchParams.get('sports'))) return route.continue();
    const response = await route.fetch(), body = await response.json();
    if (url.searchParams.get('sports') === 'board') body.games.push({ ...otherGame, day: 'today' });
    else {
      const S = body.slates.find((s) => s.day === 'today');
      S.picks[1] = { ...S.picks[1], game_id: 'g2', team: 'chi', opponent: 'bos', player_id: 'cross-player', player_name: 'Fixture Cross Game', start_utc: otherGame.start_utc, game_start_utc: otherGame.start_utc };
      S.pair = { ...S.pair, method: 'independent_games', low: 0.6, high: 0.6 };
      // An unrelated per-game expiry must not disable this fresh slate.
      body.expires_utc = new Date(now - 1).toISOString();
    }
    return route.fulfill({ response, json: body });
  });
  await crossPage.goto(base + '/?tab=sports-nba');
  const crossSlate = crossPage.locator('[data-sp-slate="today"]');
  await crossSlate.getByText(/Different games; assumes independent outcomes/).waitFor();
  await crossSlate.locator('[data-sp-slate-add]').click();
  const crossDraft = await crossPage.evaluate(() => JSON.parse(sessionStorage.getItem('stonks-sports-draft-v1')));
  assert.deepEqual(crossDraft.legs.map((p) => p.game_id), ['g1', 'g2']);
  assert.deepEqual(crossDraft.legs.map((p) => p.threshold), [15.5, 15.5]);
  assert.equal(crossDraft.legs[1].game_start_utc, otherGame.start_utc);
  await crossSlate.locator('[data-sp-slate-add]').click();
  assert.equal((await crossPage.evaluate(() => JSON.parse(sessionStorage.getItem('stonks-sports-draft-v1')))).legs.length, 2, 'duplicate pair adds neither leg');
  await crossContext.close();
  // Complete browser download over multiple response-size-bounded pages.
  const recordKey = sportsKey('prop-record', { sport: 'nba', season: 2026 });
  const largeRecord = JSON.parse(objects.get(recordKey));
  for (let i = 0; i < 325; i++) largeRecord.picks.push({ ...largeRecord.picks[0], prop_id: 'archive-' + i, game_id: 'archive-' + i,
    issued_utc: new Date(now - 86400000 - i * 1000).toISOString(), evidence: [{ label: 'Frozen research', text: 'archived analysis '.repeat(1000) }] });
  assert.ok(JSON.stringify(largeRecord).length > 4500000);
  objects.set(recordKey, JSON.stringify(largeRecord)); feedState = 'ok';
  const exportContext = await browser.newContext(), exportPage = await exportContext.newPage();
  await exportPage.clock.install({ time: now });
  await exportPage.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
  const exportRequests = []; let downloadCount = 0;
  exportPage.on('request', (r) => { if (r.url().includes('download=1')) exportRequests.push(r.url()); });
  exportPage.on('download', () => { downloadCount++; });
  await exportPage.goto(base + '/?tab=sports-nba');
  await exportPage.locator('#sports-nba-root [data-sp-view="record"]').first().click();
  const exportButton = exportPage.locator('#sports-nba-root [data-sp-record-export]');
  await exportButton.waitFor();
  const fullDownload = exportPage.waitForEvent('download'); await exportButton.click();
  const downloaded = await fullDownload;
  const json = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  assert.equal(json.records.length, 327); assert.equal(new Set(json.records.map((p) => p.prop_id)).size, 327);
  assert.ok(exportRequests.length > 1, 'large research files are assembled from multiple bounded server replies');
  assert.equal(json.records.find((p) => p.prop_id === 'archive-324').evidence[0].text.length, 18000);
  assert.equal(downloaded.suggestedFilename(), 'nba-prop-record.json');
  await exportPage.route('**/api/auth/me?*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    return q.get('download') === '1' && Number(q.get('offset')) > 0
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The prop record changed while downloading. Please retry the download.' }) }) : route.continue();
  });
  await exportButton.click();
  await exportPage.locator('#sports-nba-root [role="alert"]').filter({ hasText: 'changed while downloading' }).waitFor();
  assert.equal(downloadCount, 1, 'failed multi-page export never downloads a partial dataset');
  assert.ok(await exportButton.isEnabled()); await exportContext.close();
  console.log('Sports prop browser passed: picks, mobile layout, builder, settled-result races, complete large downloads, snapshot failures, hidden-tab resume and feed outages. Screenshots: ' + output);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }

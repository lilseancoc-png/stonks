// Sports pages in a real browser: an Owner sees the Sports group and all three
// pages at desktop and phone widths in both themes; a signed-out visitor and a
// non-Owner never see the group, a pane or a Sports request. Screenshots go to
// QA_OUTPUT (default: a temp folder). Needs Playwright (PLAYWRIGHT_MODULE).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { SPORTS_PAGE_IDS } from '../lib/owner-access-policy.mjs';
import { store } from '../lib/datastore.mjs';
import { SESSION_COOKIE, signSession } from '../lib/session.mjs';
import authHandler from '../api/auth/[action].js';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { NFLVERSE_URLS, NFL_SOURCE } from '../lib/sports/nflverse.mjs';
import { GAMES, PLAYERS, WEEK_2025, WEEK_2026, SNAPS_2026, INJURIES_2026 } from './fixtures/sports-nfl.mjs';
import { NBA_SOURCE, HOOPR_URLS } from '../lib/sports/hoopr.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { encodePrefill } from '../lib/sports/prefill.mjs';
import { buildModel, modelSummary } from '../lib/sports/models.mjs';
import { packRows, unpackRows } from '../lib/sports/rows.mjs';
import { nbaModelLeague, MODEL_TEAMS } from './fixtures/sports-model.mjs';
import { buildTeamModel, teamModelSummary } from '../lib/sports/team-model.mjs';
import { seededRandom, seededNormals } from '../lib/sports/normal.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const now = new Date('2026-11-02T18:00:00Z');
process.env.PRIVATE_DATA_ENABLED = '1';
process.env.SESSION_SECRET = 'sports-browser-fixture-only';
// NFL records come from the real ingest over the shared CSV fixtures (minus
// the deliberately invalid row), so the page reads exactly what the job writes.
const objects = new Map();
const files = new Map([[NFLVERSE_URLS.games, GAMES], [NFLVERSE_URLS.players, PLAYERS], [NFLVERSE_URLS.weekly(2025), WEEK_2025],
  [NFLVERSE_URLS.weekly(2026), WEEK_2026.split('\n').filter((l) => !l.startsWith('00-0005,')).join('\n')],
  [NFLVERSE_URLS.snaps(2026), SNAPS_2026], [NFLVERSE_URLS.injuries(2026), INJURIES_2026]]);
await ingestLeague({ adapter: NFL_SOURCE,  store: { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } },
  fetchText: async (u) => files.get(u) ?? null, now: Date.parse('2026-11-02T11:05:00Z') });
const nbaFiles = new Map([[HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027]]);
await ingestLeague({ adapter: NBA_SOURCE, store: { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } },
  fetchText: async (u) => nbaFiles.get(u) ?? null, now: Date.parse('2026-11-02T11:10:00Z') });
// Stat model: fitted on the made-up league (the fixture seasons are too short
// to check), plus twelve earlier made-up games for LeBron so his picks get a
// forecast. Curry keeps his four real fixture games: too few for the model.
{
  const league = nbaModelLeague({});
  const model = buildModel({ sport: 'nba', rows: league.rows, now: Date.parse('2026-11-02T11:10:00Z') });
  const key = SPORTS_PREFIX + 'nba/player-games/2025.json';
  const rec = JSON.parse(objects.get(key));
  const rows = unpackRows(rec);
  for (let i = 0; i < 12; i++) {
    const date = '2026-03-' + String(10 + i).padStart(2, '0');
    rows.push({ sport: 'nba', season: 2025, player_id: '1966', game_id: 'fixture-lal-' + i, date, team: 'lal', opponent: i % 2 ? 'gs' : 'phx', home: i % 2 === 0, played: true, starter: true,
      minutes: 33 + (i % 4), position: 'F', week: null, season_type: 'REG', dnp_reason: null, stats: { points: 22 + ((i * 7) % 11), rebounds: 6 + (i % 5), assists: 7, threes: 2, pra: 35, steals: 1, blocks: 1 } });
  }
  // The made-up league also fills the 2025-26 season so the player and team
  // stats views have a full table to sort (twelve teams, 96 players).
  rows.push(...league.rows);
  objects.set(key, JSON.stringify({ ...rec, ...packRows(rows) }));
  // LeBron's made-up games get their game records too (final scores), so
  // the game-script chart has results to split on.
  const lalGames = Array.from({ length: 12 }, (_, i) => {
    const opp = i % 2 ? 'gs' : 'phx', home = i % 2 === 0, date = '2026-03-' + String(10 + i).padStart(2, '0');
    const lal = 108 + ((i * 5) % 17), other = 104 + ((i * 7) % 19);
    return { sport: 'nba', game_id: 'fixture-lal-' + i, season: 2025, season_type: 'REG', start_utc: date + 'T23:30:00Z', local_date: date, home_team: home ? 'lal' : opp, away_team: home ? opp : 'lal',
      status: 'final', home_score: home ? lal : other, away_score: home ? (other === lal ? other + 1 : other) : lal, neutral: false, venue: null };
  });
  const gamesKey = SPORTS_PREFIX + 'nba/games/2025.json', gamesRec = JSON.parse(objects.get(gamesKey));
  objects.set(gamesKey, JSON.stringify({ ...gamesRec, games: gamesRec.games.concat(league.games, lalGames) }));
  const playersKey = SPORTS_PREFIX + 'nba/players.json', playersRec = JSON.parse(objects.get(playersKey));
  objects.set(playersKey, JSON.stringify({ ...playersRec, players: playersRec.players.concat(league.players.map(({ minutes, pts, reb, ...p }) => p)) }));
  objects.set(SPORTS_PREFIX + 'nba/model.json', JSON.stringify({ schema_version: 1, ...model, seasons: [2025] }));
  // Team model: the stored seasons are too short to fit it, so it is fitted
  // on two earlier made-up seasons between the same teams plus the stored
  // games, and tonight's PHX at GS gets a forecast to check bets against.
  const rnd = seededRandom(11), z = seededNormals(12), made = [];
  const strength = Object.fromEntries(MODEL_TEAMS.map((t, i) => [t, (i - 5.5) * 0.8]));
  let day = Date.parse('2023-10-24T23:00:00Z');
  for (const season of [2023, 2024]) {
    for (let n = 0; n < 700; n++) {
      const i = Math.floor(rnd() * MODEL_TEAMS.length);
      let j = Math.floor(rnd() * (MODEL_TEAMS.length - 1));
      if (j >= i) j++;
      const home = MODEL_TEAMS[i], away = MODEL_TEAMS[j], start = new Date(day + n * 3600000 * 6).toISOString();
      const hs = Math.round(114 + 1.5 + strength[home] + 11.5 * z()), as0 = Math.round(112 - 1.5 + strength[away] + 11.5 * z());
      made.push({ sport: 'nba', game_id: 'made-' + season + '-' + n, season, season_type: 'REG', start_utc: start, local_date: start.slice(0, 10), home_team: home, away_team: away, status: 'final', home_score: hs, away_score: as0 === hs ? as0 + 1 : as0, neutral: false });
    }
    day = Date.parse((season + 1) + '-10-22T23:00:00Z');
  }
  const stored = [2025, 2026].flatMap((y) => (objects.has(SPORTS_PREFIX + 'nba/games/' + y + '.json') ? JSON.parse(objects.get(SPORTS_PREFIX + 'nba/games/' + y + '.json')).games : []));
  const teamModel = buildTeamModel({ sport: 'nba', games: made.concat(stored), now: Date.parse('2026-11-02T11:10:00Z') });
  assert.equal(teamModel.status, 'ok', 'the fixture team model fits');
  objects.set(SPORTS_PREFIX + 'nba/team-model.json', JSON.stringify({ schema_version: 1, ...teamModel }));
  const status = JSON.parse(objects.get(SPORTS_PREFIX + 'status/nba.json'));
  objects.set(SPORTS_PREFIX + 'status/nba.json', JSON.stringify({ ...status, model: modelSummary({ ...model, seasons: [2025] }), team_model: teamModelSummary(teamModel) }));
}
store.rawGet = async (key) => (objects.has(key) ? Buffer.from(objects.get(key)) : null);
for (const m of ['put', 'del', 'rawPut', 'rawDel', 'publishGeneration']) store[m] = async () => { throw new Error('Sports page attempted a store write: ' + m); };
store.get = async () => Buffer.from('{}');
// Pick Builder may append to its own journal and line records, and nothing
// else; the lease is an in-memory stand-in for the R2 conditional lock.
const writable = [SPORTS_PREFIX + 'journal/', SPORTS_PREFIX + 'markets/'];
store.rawPut = async (key, value) => {
  if (!writable.some((p) => key.startsWith(p))) throw new Error('Sports page attempted a store write: ' + key);
  objects.set(key, String(value));
};
store.backend = 'r2';
const leases = new Set();
store.withLease = async (name, fn) => {
  if (leases.has(name)) return { busy: true };
  leases.add(name);
  try { return { busy: false, result: await fn(() => {}) }; } finally { leases.delete(name); }
};
// The server reads the fixture day too (the page clock is installed below),
// so the boards and the pre-game save rule do not depend on the run date.
const started = Date.now();
const fixtureNow = () => now.getTime() + (Date.now() - started);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const query = Object.fromEntries(url.searchParams);
  const json = (o, n = 200) => { res.statusCode = n; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  res.status = (n) => { res.statusCode = n; return res; }; res.json = (o) => json(o, res.statusCode);
  if (url.pathname === '/api/auth/me' || url.pathname.startsWith('/data/')) {
    if (url.pathname.startsWith('/data/')) query.data = url.pathname.slice(6);
    query.action = 'me'; req.query = query;
    req.headers['x-forwarded-proto'] = 'http'; // Vercel sets this; the same-origin check reads it
    if (req.method === 'POST') { // Vercel parses JSON bodies before the handler runs
      let raw = ''; for await (const chunk of req) raw += chunk;
      try { req.body = JSON.parse(raw); } catch { req.body = raw; }
    }
    // The player page and Pick Builder read only the injury report; it lists
    // LeBron as Questionable so the page shows a listing.
    if (query.sports != null) return handleSportsRequest(req, res, { now: fixtureNow, loadPropSources: async ({ parts }) => (String(parts) === 'injuries'
      ? { injuries: { state: 'ok', observed_utc: new Date(fixtureNow()).toISOString(), reports: [{ name: 'LeBron James', espn_id: '1966', team: 'lal', status: 'Questionable', detail: 'Ankle' }] } }
      : { lines: { state: 'not_configured', lines: [], message: 'Fixture: no line feed configured.' }, injuries: { state: 'unavailable', reports: [] } }) });
    return authHandler(req, res);
  }
  if (url.pathname.startsWith('/api/')) return json({});
  if (url.pathname.startsWith('/_vercel/')) return res.end('');
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) return json({}, 404);
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { json({}, 404); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const output = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-sports');
await mkdir(output, { recursive: true });
let checks = 0;
try {
  for (const role of ['anonymous', 'member', 'owner']) for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    if (role !== 'anonymous') await context.addCookies([{ name: SESSION_COOKIE, value: await signSession({ sub: 'fixture-' + role, tr: role === 'owner', tp: role === 'owner' }), url: base, httpOnly: true }]);
    const page = await context.newPage(), errors = [], requests = [];
    await page.clock.install({ time: now });
    await page.addInitScript((t) => localStorage.setItem('stonks-theme', t), theme);
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' }));
    page.on('pageerror', (e) => errors.push(e.stack)); page.on('request', (r) => requests.push(r.url()));
    for (const id of SPORTS_PAGE_IDS) {
      await page.goto(base + '/?tab=' + id);
      await page.waitForFunction(() => document.body.hasAttribute('data-active-tab'));
      if (role !== 'owner') {
        assert.equal(await page.locator('#page-pane-' + id).count(), 0, role + ' cannot open ' + id);
        assert.equal(await page.locator('[data-nav-group="sports"]').count(), 0, role + ' never sees the Sports group');
        checks += 2; continue;
      }
      const pane = page.locator('#page-pane-' + id);
      await pane.waitFor({ state: 'visible' });
      await page.locator('#' + id + '-root .sp-days').waitFor();
      const text = await pane.innerText();
      assert(/Today/.test(text) && /Tomorrow/.test(text), id + ' shows the active days');
      assert(/Nov 2/.test(text) && /Nov 3/.test(text), id + ' uses the Los Angeles calendar day');
      if (id === 'sports-nfl') {
        assert(/Up to date/.test(text) && /2025, 2026/.test(text), 'NFL shows its job status');
        await page.locator('#sports-nfl-root [data-sp-game="2026_08_chi_sea"]').waitFor();
        const board = await page.locator('#sports-nfl-root [data-sp-part="board"]').innerText();
        assert(/CHI\s+at\s+SEA/.test(board) && /5:15\sPM\sPST/.test(board), 'Monday night is on today’s board in Pacific time');
        assert(/Tomorrow[\s\S]*No games\./.test(board), 'an empty tomorrow says so');
        assert(/SEA −3\.5 · O\/U 44\.5/.test(board), 'the board row shows the spread and total: ' + board.slice(0, 300));
        await page.locator('#sports-nfl-root [data-sp-game="2026_08_chi_sea"]').click();
        await page.locator('#sports-nfl-root [data-sp-panel="game"] [data-sp-player="00-0001"]').waitFor();
        const panel = await page.locator('#sports-nfl-root [data-sp-panel="game"]').innerText();
        assert(/Geno Smíth/.test(panel) && /Jaxon Smith-Njigba/.test(panel) && /No player games stored for this team/.test(panel), 'the game lists each team’s recent players');
        assert(/SEA favored by 3\.5 · total 44\.5 · implied CHI 20\.5, SEA 24\.0/.test(panel), 'the matchup shows the schedule’s spread and total: ' + panel.slice(0, 300));
        assert.equal(await page.locator('#sports-nfl-root [data-sp-panel="game"] .sp-tb').count(), 1, 'the game has a Team bets section');
        // A player opens a full page in place of the board, with its own address.
        await page.locator('#sports-nfl-root [data-sp-search]').fill('kelce');
        await page.locator('#sports-nfl-root [data-sp-part="results"] [data-sp-player="00-0003"]').click();
        const FP = '#sports-nfl-root [data-sp-panel="player"] ';
        await page.locator(FP + '.sp-pp-name').filter({ hasText: 'Travis Kelce' }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('player'), '00-0003', 'the player page has its own address');
        assert(!(await page.locator('#sports-nfl-root .sp-board').isVisible()) && !(await page.locator('#sports-nfl-root .sp-side').isVisible()), 'the player page takes the place of the board');
        assert(/Back to games/.test(await page.locator(FP + '[data-sp-close="player"]').innerText()), 'the back button names where it returns');
        assert.equal(await page.locator(FP + '[data-sp-ptab]').count(), 7, 'seven player tabs');
        assert(await page.locator(FP + '.sp-pp-tile').count() >= 3, 'season tiles for the key stats');
        const ppHead = await page.locator(FP + '.sp-pp-head').innerText();
        assert(/Next game/i.test(ppHead) && /DEN/.test(ppHead), 'the head shows the next game: ' + ppHead);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-sp-close')), 'player', 'keyboard focus lands on the back button');
        await page.locator(FP + '[data-sp-ptab="overview"]').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator(FP + '[data-sp-ptab="upcoming"]').getAttribute('aria-selected'), 'true', 'arrow keys move between the player tabs');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-sp-ptab')), 'pick', 'End goes to the last tab');
        await page.keyboard.press('Home');
        await page.locator(FP + '[data-sp-ptab="log"]').click();
        await page.locator(FP + '.sp-log').waitFor();
        const log = await page.locator('#sports-nfl-root [data-sp-panel="player"]').innerText();
        assert(/Travis Kelce/.test(log) && /Averages over 1 stored game\b/i.test(log) && !/1 stored games/.test(log) && /@ DEN/.test(log), 'player search opens the game log: ' + log.slice(0, 400));
        const snapCells = await page.$$eval('#sports-nfl-root [data-sp-panel="player"] .sp-log', (ts) => ts.map((t) => { const i = [...t.querySelectorAll('thead th')].findIndex((th) => /Snaps/.test(th.textContent)); return i < 0 ? null : t.querySelector('tbody tr td:nth-child(' + (i + 1) + ')')?.textContent.trim(); }));
        assert(snapCells.some((c) => /^50\s*80%$/.test(c || '')), 'the NFL log shows snaps and snap share: ' + JSON.stringify(snapCells));
        const tops = await page.$$eval('#sports-nfl-root [data-sp-panel="player"] .sp-table:not(.sp-fc):not(.sp-log) tbody tr', (trs) => trs.map((tr) => tr.getBoundingClientRect().top));
        assert(tops.length > 2 && tops.every((t, i) => i === 0 || t > tops[i - 1] + 10), 'the averages table rows sit one under another: ' + tops);
        await page.locator(FP + '[data-sp-ptab="pick"]').click();
        const kStat = page.locator('#sports-nfl-root [data-sp-panel="player"] [data-sp-pickform] [name="stat"]');
        if (await kStat.count()) assert.equal(await kStat.inputValue(), 'receptions', 'a tight end’s pick starts on receptions, not passing yards');
        assert.equal(await page.locator('#sports-nfl-root [data-sp-search]').inputValue(), 'kelce', 'the search box keeps its text');
        await page.locator(FP + '[data-sp-ptab="opponents"]').click();
        const opp = await page.locator(FP + '[data-sp-part="ptab"]').innerText();
        assert(/All teams/.test(opp) && /DEN/.test(opp), 'averages against each team: ' + opp.slice(0, 300));
        await page.locator(FP + '[data-sp-ptab="seasons"]').click();
        assert(/2026/.test(await page.locator(FP + '[data-sp-part="ptab"]').innerText()), 'averages by season');
        await page.locator(FP + '[data-sp-ptab="upcoming"]').click();
        const upN = await page.locator(FP + '.sp-pp-up tbody tr').count();
        assert(upN >= 1 || /No upcoming games stored/.test(await page.locator(FP + '[data-sp-part="ptab"]').innerText()), 'upcoming games, or a plain note');
        // Browser Back closes the page and brings the board back as it was.
        await page.evaluate(() => history.back());
        await page.locator('#sports-nfl-root .sp-board').waitFor({ state: 'visible' });
        assert(!new URL(page.url()).searchParams.has('player') && (await page.locator(FP + '.sp-pp-name').count()) === 0, 'Back closes the player page');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-sp-player')), '00-0003', 'focus returns to the name that opened the page');
        assert.equal(await page.locator('#sports-nfl-root [data-sp-panel="game"] [data-sp-player="00-0001"]').count() > 0, true, 'the open game is still there');
        await page.locator('#sports-nfl-root [data-sp-panel="game"] [data-sp-player="00-0001"]').first().click();
        await page.locator(FP + '.sp-pp-name').filter({ hasText: 'Geno Smíth' }).waitFor();
        await page.locator(FP + '[data-sp-ptab="pick"]').click();
        // The line box hints a line near the player's average for the chosen stat.
        const gForm = page.locator('#sports-nfl-root [data-sp-panel="player"] [data-sp-pickform]');
        assert.equal(await gForm.locator('[name="line"]').getAttribute('placeholder'), '250.5', 'a quarterback’s passing-yards line hint sits near the player’s average, not 24.5');
        await gForm.locator('[name="stat"]').selectOption('receptions');
        assert.equal(await gForm.locator('[name="line"]').getAttribute('placeholder'), '0.5', 'the hint follows the chosen stat');
        await gForm.locator('[name="stat"]').selectOption('passing_yards');
        await page.locator(FP + '[data-sp-close="player"]').click();
        await page.locator('#sports-nfl-root [data-sp-panel="game"]').waitFor({ state: 'visible' });
        assert(!new URL(page.url()).searchParams.has('player'), 'the back button clears the address');
        // A shared address opens the player page directly.
        await page.goto(base + '/?tab=sports-nfl&player=00-0003');
        await page.locator(FP + '.sp-pp-name').filter({ hasText: 'Travis Kelce' }).waitFor();
        await page.screenshot({ path: resolve(output, `player-page-nfl-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        await page.locator(FP + '[data-sp-close="player"]').click();
        await page.locator('#sports-nfl-root .sp-board').waitFor({ state: 'visible' });
        assert(!new URL(page.url()).searchParams.has('player'), 'closing a shared address leaves the board');
        checks += 26;
      }
      if (id === 'sports-nba') {
        assert(/Up to date/.test(text) && /2025–26, 2026–27/.test(text) && /Sun, Nov 1/.test(text), 'NBA shows its job status, seasons and latest game');
        await page.locator('#sports-nba-root [data-sp-game="401900003"]').waitFor();
        const board = await page.locator('#sports-nba-root [data-sp-part="board"]').innerText();
        assert(/PHX\s+at\s+GS/.test(board) && /7:00\sPM\sPST/.test(board) && /LAL\s+at\s+PHX/.test(board), 'tonight and tomorrow on the NBA board');
        await page.locator('#sports-nba-root [data-sp-game="401900003"]').click();
        await page.locator('#sports-nba-root [data-sp-panel="game"] svg.sp-spark').first().waitFor();
        // The matchup: both teams before this game, what each defense allows by
        // position, the stored meetings, and each player's games against this opponent.
        const GP = '#sports-nba-root [data-sp-panel="game"] ';
        const mx = await page.locator(GP + '.sp-matchup').innerText();
        assert(/Matchup/i.test(mx) && /Record/.test(mx) && /Points per game/.test(mx) && /Allowed per game/.test(mx) && /PHX[\s\S]*GS/.test(mx), 'the matchup compares both teams: ' + mx.slice(0, 400));
        assert(/What each defense allows by position/.test(mx) && /Guards/.test(mx) && /Centers/.test(mx) && /League/.test(mx), 'what each defense allows to guards, forwards and centers');
        assert(/Recent meetings/.test(mx) && (/leads|Even at/.test(mx) || /No meetings between these teams/.test(mx)), 'meetings, or a plain note when none are stored');
        assert(/\d+(st|nd|rd|th)/.test(mx), 'league ranks are shown');
        const heads = await page.$$eval(GP + '.sp-team thead th', (ths) => ths.map((th) => th.textContent.trim()));
        assert(heads.some((h) => /^vs PHX/.test(h)), 'the GS table has a column against PHX (PHX has no stored players here): ' + heads.join(','));
        await page.locator(GP + '.sp-matchup > summary').click();
        assert.equal(await page.locator(GP + '.sp-matchup').getAttribute('open'), null, 'the matchup folds away');
        await page.locator(GP + '.sp-matchup > summary').click();
        await page.locator(GP).screenshot({ path: resolve(output, `game-matchup-${width}-${theme}.png`), animations: 'disabled' });
        const mxOv = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(mxOv <= 1, 'the matchup has no sideways page scroll at ' + width);
        checks += 6;
        // Team bets: the team model's chances for this game, a bet checker,
        // the win-by chart and the lines.
        const TBS = GP + '.sp-tb ';
        const tbText = await page.locator(GP + '.sp-tb').innerText();
        assert(/PHX \d+%[\s\S]*GS \d+%\s*to win/.test(tbText) && /Expected PHX [\d.]+, GS [\d.]+/.test(tbText), 'team bets lead with both win chances and the expected score: ' + tbText.slice(0, 300));
        assert(/Check a bet/.test(tbText) && /Win by X or more/.test(tbText) && /Team numbers/.test(tbText), 'the checker, the win-by chart and the team numbers');
        assert.equal(await page.locator(TBS + 'svg.sp-tb-ch polyline.sp-tb-line').count(), 2, 'one win-by line per team');
        assert(await page.locator(TBS + 'svg.sp-tb-ch').getAttribute('data-ch'), 'the win-by chart uses the shared hover readout');
        const big = () => page.locator(TBS + '[data-sp-part="tb-result"] .sp-tb-big').innerText();
        const bigPct = async () => Number((await big()).match(/(\d+(?:\.\d)?)%/)[1]);
        assert(/to win by 10 or more\s+\d+(\.\d)?%/.test(await big()), 'the checker starts on win by 10: ' + await big());
        await page.locator(TBS + '[data-sp-tb="team"]').selectOption('gs');
        await page.locator(TBS + '[data-sp-tb="line"]').fill('20');
        await page.locator(TBS + '[data-sp-part="tb-result"]').filter({ hasText: 'GS to win by 20 or more' }).waitFor();
        const by20 = await bigPct();
        assert.equal(await page.locator(TBS + '[data-sp-tb="line"]').evaluate((el) => el === document.activeElement), true, 'typing keeps the cursor in the box');
        await page.locator(TBS + '[data-sp-tb="line"]').fill('5');
        await page.locator(TBS + '[data-sp-part="tb-result"]').filter({ hasText: 'GS to win by 5 or more' }).waitFor();
        const by5 = await bigPct();
        assert(by5 > by20 && by20 > 0, 'winning by 5 is likelier than by 20: ' + by5 + ' vs ' + by20);
        await page.locator(TBS + '[data-sp-tb="price"]').fill('+400');
        await page.locator(TBS + '.sp-tb-ev').waitFor();
        assert(/At \+400 · 5\.00 · 20¢ you need 20(\.0)?% to break even/.test(await page.locator(TBS + '.sp-tb-ev').innerText()), 'a typed price gives the breakeven and the average return: ' + await page.locator(TBS + '.sp-tb-ev').innerText());
        await page.locator(TBS + '[data-sp-tb="price"]').fill('5.0');
        await page.locator(TBS + '.sp-tb-ev').filter({ hasText: /At \+400 · 5\.00 · 20¢/ }).waitFor();
        assert.equal(await page.locator(TBS + '[data-sp-tb="price"]').getAttribute('inputmode'), null, 'the odds box keeps a keyboard with a minus sign on phones');
        await page.locator(TBS + '[data-sp-tb="market"]').selectOption('total');
        await page.locator(TBS + '[data-sp-part="tb-result"]').filter({ hasText: 'Game total over' }).waitFor();
        assert.equal(await page.locator(TBS + '[data-sp-tb="team"]').count(), 0, 'a game total needs no team');
        await page.locator(TBS + '[data-sp-tb="market"]').selectOption('win_by');
        assert(await page.locator(TBS + '.sp-tb-table').first().locator('tbody tr').count() >= 4, 'the main lines: both moneylines and spreads');
        await page.locator(TBS + '.sp-tb-more > summary').click();
        assert(/GS to win by 20\+/.test(await page.locator(TBS + '.sp-tb-more').innerText()), 'more lines include the win-by ladder');
        await page.locator(GP + '.sp-tb').screenshot({ path: resolve(output, `team-bets-${width}-${theme}.png`), animations: 'disabled' });
        assert(/(GS|PHX) \d+%/.test(await page.locator('#sports-nba-root [data-sp-game="401900003"] .sp-twin').innerText()), 'the board row shows the team model’s favorite');
        checks += 14;
        await page.locator('#sports-nba-root [data-sp-game-stat]').selectOption('rebounds');
        assert(/Rebounds per game/.test(await page.locator(GP + '.sp-matchup').innerText()), 'the matchup follows the chosen stat');
        assert(/Rebounds/.test(await page.locator('#sports-nba-root [data-sp-game-stat] option:checked').innerText()) && (await page.locator('#sports-nba-root [data-sp-panel="game"] thead th', { hasText: /^Stat$/ }).count()) === 0, 'the game panel switches every player to one stat');
        assert(/out last game/.test(await page.locator('#sports-nba-root [data-sp-panel="game"]').innerText()), 'a player who sat out is flagged');
        await page.locator('#sports-nba-root [data-sp-panel="game"] [data-sp-player="3975"]').click();
        const PL = '#sports-nba-root [data-sp-panel="player"] ';
        await page.locator(PL + '.sp-pp-name').filter({ hasText: 'Stephen Curry' }).waitFor();
        const nbaOverview = await page.locator(PL).innerText();
        await page.locator(PL + '[data-sp-ptab="log"]').click();
        await page.locator(PL + '.sp-log').waitFor();
        const nbaLog = await page.locator('#sports-nba-root [data-sp-panel="player"]').innerText();
        assert(/did not play: left ankle sprain/.test(nbaLog) && /Minutes/.test(nbaLog) && /\bMin\b/.test(nbaLog), 'the NBA log shows minutes and the missed game with its reason');
        // Stat sets: Combos shows the summed lines, All shows every stat.
        await page.locator(PL + '[data-sp-logset="combo"]').click();
        const comboHeads = await page.$$eval(PL + '.sp-log thead th', (ths) => ths.map((th) => th.textContent.replace(/[▲▼↕]/g, '').trim()));
        assert(['PRA', 'P+R', 'P+A', 'R+A', 'B+S', 'Fan'].every((h) => comboHeads.includes(h)) && !comboHeads.includes('Pts'), 'the Combos set shows the combo columns only: ' + comboHeads.join(','));
        assert(/Points \+ rebounds \+ assists/.test(await page.locator(PL + '[data-sp-part="logset"]').innerText()), 'and their averages');
        await page.locator(PL + '[data-sp-logset="all"]').click();
        const sums = await page.$$eval(PL + '.sp-log', (tables) => {
          const t = tables[0], heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼↕]/g, '').trim());
          const row = [...t.querySelectorAll('tbody tr:not(.sp-dnp)')][0], cell = (h) => Number(row.children[heads.indexOf(h)].textContent);
          return { pra: cell('PRA'), pts: cell('Pts'), reb: cell('Reb'), ast: cell('Ast'), pr: cell('P+R'), dreb: cell('DReb'), oreb: cell('OReb') };
        });
        assert(sums.pra === sums.pts + sums.reb + sums.ast && sums.pr === sums.pts + sums.reb, 'PRA and P+R in the log are summed from the same game: ' + JSON.stringify(sums));
        assert(Number.isFinite(sums.oreb) ? sums.dreb === sums.reb - sums.oreb : !Number.isFinite(sums.dreb), 'defensive rebounds are rebounds minus offensive, blank when offensive is: ' + JSON.stringify(sums));
        await page.locator(PL + '[data-sp-logset="main"]').click();
        await page.locator(PL + '[data-sp-ptab="pick"]').click();
        const form = page.locator('#sports-nba-root [data-sp-panel="player"] [data-sp-pickform]');
        assert.deepEqual(await form.locator('[name="stat"] optgroup').evaluateAll((gs) => gs.map((g) => g.label)), ['Main', 'Combos', 'More'], 'the pick form lists every stat in groups');
        assert((await form.locator('[name="stat"] option').evaluateAll((os) => os.map((o) => o.value))).includes('pra'), 'combos can be picked');
        assert.equal(await form.locator('[name="stat"]').inputValue(), 'points', 'the pick form starts on the player’s main stat');
        checks += 6;
        assert(/Next game: PHX at GS/.test(await form.innerText()), 'the pick form names the next game');
        await form.locator('[name="line"]').fill('24.3');
        await form.locator('[data-sp-addpick]').click();
        assert(/whole or half number/.test(await form.locator('[data-sp-pick-msg]').innerText()), 'a bad line is refused before anything is added');
        await form.locator('[name="line"]').fill('24.5');
        await form.locator('[data-sp-addpick]').click();
        assert(/Added\. The entry has 1 pick\./.test(await form.locator('[data-sp-pick-msg]').innerText()), 'the pick goes into the Pick Builder draft');
        await page.locator(PL + '[data-sp-ptab="overview"]').click();
        assert(/Model forecast for the next game[\s\S]*fewer than 5 stored games/i.test(nbaOverview), 'too few games: the model says so instead of guessing: ' + nbaOverview.slice(0, 700));
        assert.equal(await page.locator('#sports-nba-root [data-sp-panel="player"] .sp-fc-none li').count(), 1, 'no forecast at all: one line per reason, not a table of empty columns');
        assert(/All 12 modeled stats/.test(await page.locator('#sports-nba-root [data-sp-panel="player"] .sp-fc-none').innerText()), 'the one reason covers every modeled stat');
        assert.equal(await page.locator('#sports-nba-root [data-sp-panel="player"] table.sp-fc').count(), 0);
        // Upcoming games: rest, lines, the team model's chance and what each
        // opponent allows to his position; "Open game" goes to the game.
        await page.locator(PL + '[data-sp-ptab="upcoming"]').click();
        await page.locator(PL + '.sp-pp-up tbody tr').first().waitFor();
        const upText = await page.locator(PL + '.sp-pp-up').innerText();
        assert(/vs PHX/.test(upText) && /to G/.test(upText) && /\d+%/.test(upText) && /Open game/.test(upText), 'upcoming games with the opponent’s defense and the win chance: ' + upText.slice(0, 500));
        await page.locator(PL + '[data-sp-ptab="opponents"]').click();
        assert(/All teams/.test(await page.locator(PL + '.sp-pp-opp').innerText()), 'averages against each team');
        await page.locator(PL + '[data-sp-ptab="upcoming"]').click();
        await page.locator(PL + '[data-sp-pp-game]').first().click();
        await page.locator('#sports-nba-root [data-sp-panel="game"] .sp-tb').waitFor({ state: 'visible' });
        assert.equal(await page.locator(PL + '.sp-pp-name').count(), 0, '“Open game” leaves the player page for the game');
        checks += 3;
        const tmCard = await page.locator('#sports-nba-root .sp-tmodel').innerText();
        assert(/Team bets check/i.test(tmCard) && /of 5 kinds of bet passed/.test(tmCard), 'the side card shows the team model’s check: ' + tmCard.slice(0, 300));
        const modelCardEl = page.locator('#sports-nba-root .sp-model:not(.sp-tmodel)');
        assert(/2 of 12 stats passed/.test(await modelCardEl.innerText()), 'the card opens with a tally');
        assert.equal(await modelCardEl.locator('details.sp-model-stat[open]').count(), 0, 'each stat starts folded');
        for (const st of ['points', 'rebounds']) await modelCardEl.locator('[data-sp-model-stat="' + st + '"] > summary').click();
        await modelCardEl.locator('details.sp-model-links > summary').click();
        checks += 3;
        const side = await modelCardEl.innerText();
        assert(/Model check/i.test(side) && /Points\s*[\d.]+ vs [\d.]+\s*Passed the check/.test(side) && /Rebounds\s*[\d.]+ vs [\d.]+\s*Experimental/.test(side) && /did not beat both simple baselines/.test(side) && /sports-model-4/.test(side), 'the model check card: ' + side);
        assert(/Game spread and total: (on\. It beat leaving it out|off; )/.test(side), 'each stat says whether the spread and total are used: ' + side.slice(0, 900));
        assert(/Same-game links/i.test(side) && /Points and rebounds, one player/.test(side) && /later pairs: both cleared/.test(side), 'the card lists the same-game links and their check: ' + side);
        // Calibration: each model stat draws stated chance vs how often it happened.
        assert(await modelCardEl.locator('.sp-rel-svg').count() >= 1 && await modelCardEl.locator('.sp-rel-dot').count() >= 3, 'the model card draws a calibration chart');
        await modelCardEl.screenshot({ path: resolve(output, `model-calibration-${width}-${theme}.png`), animations: 'disabled' });
        await page.locator('#sports-nba-root [data-sp-search]').fill('lebron');
        await page.locator('#sports-nba-root [data-sp-part="results"] [data-sp-player="1966"]').click();
        await page.locator('#sports-nba-root [data-sp-panel="player"] .sp-fc').waitFor();
        assert(/Back to games/.test(await page.locator(PL + '[data-sp-close="player"]').innerText()));
        const fcText = await page.locator('#sports-nba-root [data-sp-panel="player"]').innerText();
        assert(/Model forecast for the next game/i.test(fcText) && /@ PHX/.test(fcText) && /80% range/i.test(fcText) && /Passed the check/.test(fcText) && /minutes expected/.test(fcText), 'LeBron gets a forecast for his next game: ' + fcText.slice(0, 600));
        assert.equal(await page.locator('#sports-nba-root .sp-fc tbody tr').first().locator('.sp-lines span').count(), 5, 'five lines with the chance of the over');
        assert(/Listed Questionable on the ESPN injury report \(Ankle\)/.test(await page.locator('#sports-nba-root [data-sp-panel="player"] .sp-avail').innerText()), 'the player page shows the injury listing for the next game');
        checks++;
        checks += 7;
        // Charts: the last 10 games as bars, green above the average, red below.
        const PP = '#sports-nba-root [data-sp-panel="player"] ';
        await page.locator(PP + '[data-sp-ptab="charts"]').click();
        const barRead = () => page.$$eval(PP + '[data-sp-part="chart-body"] svg.sp-ch', ([svg]) => [...svg.querySelectorAll('rect.sp-bar')].map((r, i) => ({ cls: r.getAttribute('class'), v: Number(svg.querySelectorAll('text.sp-ch-val')[i]?.textContent) })));
        await page.locator(PP + '[data-sp-part="chart-body"] svg.sp-ch').waitFor();
        let bars = await barRead();
        assert.equal(bars.length, 10, 'ten bars for the last 10 games');
        const mean = bars.reduce((a, b) => a + b.v, 0) / bars.length;
        assert(bars.every((b) => b.cls.includes(b.v > mean ? 'is-over' : b.v < mean ? 'is-under' : 'is-at')) && bars.some((b) => b.cls.includes('is-over')) && bars.some((b) => b.cls.includes('is-under')), 'bars over the average are green and under it red: ' + JSON.stringify(bars));
        assert(new RegExp('Average\\s+' + (Math.round(mean * 10) / 10).toFixed(1)).test(await page.locator(PP + '.sp-facts').innerText()), 'the facts strip shows the same average');
        assert.equal(await page.locator(PP + 'svg.sp-ch line.sp-ch-avg').count(), 1, 'one dashed average line');
        assert(await page.locator(PP + 'svg.sp-ch').getAttribute('data-ch'), 'the chart uses the shared hover readout');
        await page.locator(PP + '[data-sp-chart-line]').fill('27.5');
        await page.locator(PP + '.sp-ch-legend', { hasText: 'Over 27.5' }).waitFor();
        bars = await barRead();
        assert(bars.every((b) => b.cls.includes(b.v > 27.5 ? 'is-over' : 'is-under')) && (await page.locator(PP + 'svg.sp-ch line.sp-ch-ref').count()) === 1, 'a typed line recolors the bars against it');
        assert.equal(await page.locator(PP + '[data-sp-chart-line]').evaluate((el) => el === document.activeElement), true, 'typing keeps the cursor in the line box');
        for (const [kind, sel, min] of [['trend', 'svg.sp-ch polyline.sp-ch-line', 1], ['hits', '.sp-hit', 8], ['spread', 'svg.sp-ch rect.sp-bar', 2], ['volume', 'svg.sp-ch circle.sp-dot', 10], ['rate', 'svg.sp-ch polyline.sp-ch-line', 1], ['splits', '.sp-split', 2], ['script', '.sp-split', 2], ['pair', 'svg.sp-ch circle.sp-dot', 6]]) {
          await page.locator(PP + '[data-sp-chart-kind="' + kind + '"]').click();
          await page.locator(PP + '[data-sp-part="chart-body"] ' + sel).first().waitFor();
          assert((await page.locator(PP + '[data-sp-part="chart-body"] ' + sel).count()) >= min, kind + ' chart draws');
          if (width > 760 && theme === 'dark') await page.locator(PP + '[data-sp-part="chart"]').screenshot({ path: resolve(output, `chart-${kind}-${width}-${theme}.png`), animations: 'disabled' });
        }
        await page.locator(PP + '[data-sp-chart-kind="hits"]').click();
        assert.equal(await page.locator(PP + '.sp-hit.is-line').count(), 1, 'the typed line is marked in the hit rates');
        await page.locator(PP + '[data-sp-chart-kind="volume"]').click();
        assert(/points per minute/.test(await page.locator(PP + '[data-sp-part="chart-body"]').innerText()), 'the volume chart states the rate');
        await page.locator(PP + '[data-sp-chart-kind="splits"]').click();
        assert(/Home or away[\s\S]*Opponent/.test(await page.locator(PP + '[data-sp-part="chart-body"]').innerText()), 'splits by place and opponent');
        await page.locator(PP + '[data-sp-chart-kind="rate"]').click();
        assert(/per 36 min/.test(await page.locator(PP + '[data-sp-part="chart-body"]').innerText()), 'the rate chart reads per 36 minutes');
        await page.locator(PP + '[data-sp-chart-kind="script"]').click();
        assert(/Result[\s\S]*Team won[\s\S]*Final margin/.test(await page.locator(PP + '[data-sp-part="chart-body"]').innerText()), 'game script splits by result and margin');
        await page.locator(PP + '[data-sp-chart-kind="pair"]').click();
        await page.locator(PP + '[data-sp-chart-stat2]').selectOption('rebounds');
        await page.locator(PP + '[data-sp-part="chart-body"]').filter({ hasText: 'Rebounds average' }).waitFor();
        assert(/Correlation (−?\d\.\d\d|—) over \d+ games/.test(await page.locator(PP + '[data-sp-part="chart-body"]').innerText()), 'two stats: the correlation over the games shown');
        checks += 3;
        await page.locator(PP + '[data-sp-chart-kind="bars"]').click();
        await page.locator(PP + '[data-sp-chart-n="5"]').click();
        assert.equal((await barRead()).length, 5, 'the last-5 window draws five bars');
        await page.locator(PP + '[data-sp-chart-stat]').selectOption('rebounds');
        await page.locator(PP + '.sp-ch-legend', { hasText: 'Over 27.5' }).waitFor();
        assert(/Rebounds by game/.test(await page.locator(PP + 'svg.sp-ch').getAttribute('aria-label')), 'the stat switch redraws the chart');
        await page.locator(PP + '[data-sp-chart-line]').fill('');
        await page.locator(PP + '[data-sp-chart-n="10"]').click();
        await page.locator(PP + '[data-sp-chart-stat]').selectOption('points');
        await page.locator(PP + '[data-sp-part="chart"]').screenshot({ path: resolve(output, `chart-bars-${width}-${theme}.png`), animations: 'disabled' });
        // The chart fills its card, and the opponent names under the bars never
        // run into each other (one row when they fit, two staggered rows when not).
        const fill = await page.$eval(PP + '[data-sp-part="chart-body"]', (el) => ({ box: el.clientWidth, svg: el.querySelector('svg.sp-ch').getBoundingClientRect().width }));
        assert(fill.svg >= fill.box * 0.95 && fill.svg <= fill.box + 1, 'the chart fills its card: ' + JSON.stringify(fill));
        const labelClash = (none) => page.$eval(PP + '[data-sp-part="chart-body"] svg.sp-ch', (svg, none) => {
          const rows = new Map();
          for (const t of svg.querySelectorAll('text.sp-ch-axis:not(.sp-ch-sub)')) {
            if (t.getAttribute('text-anchor') !== 'middle' || !/^@?[A-Z]{2,4}$/.test(t.textContent)) continue;
            const r = t.getBoundingClientRect(), key = Math.round(r.top);
            rows.set(key, [...(rows.get(key) || []), [r.left, r.right, t.textContent]]);
          }
          for (const list of rows.values()) {
            list.sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1] - 0.5) return list[i - 1][2] + ' / ' + list[i][2];
          }
          return none || [...rows.values()].reduce((a, l) => a + l.length, 0) ? '' : 'no labels';
        }, none);
        assert.equal(await labelClash(), '', 'opponent labels do not overlap at 10 games');
        await page.locator(PP + '[data-sp-chart-n="20"]').click();
        await page.locator(PP + '[data-sp-chart-n="20"][aria-pressed="true"]').waitFor();
        assert.equal(await labelClash(width <= 760), '', 'opponent labels do not overlap at 20 games (a phone shows dates instead)');
        await page.locator(PP + '[data-sp-chart-n="10"]').click();
        checks += 17;
        await page.locator(PP + '[data-sp-close="player"]').click();
        // Team stats: records and what each defense allows; a team opens its players.
        const NR = '#sports-nba-root ';
        await page.locator(NR + '[data-sp-view="teams"]').click();
        await page.locator(NR + '[data-sp-team-season]').waitFor();
        await page.locator(NR + '[data-sp-team-season]').selectOption('2025');
        await page.locator(NR + '.sp-teamtable tbody tr', { hasText: 'OKC' }).waitFor();
        assert.equal(await page.locator(NR + '.sp-teamtable tbody tr').count(), 12, 'all twelve teams of the made-up season');
        await page.locator(NR + '[data-sp-tsort="points_against"]').click();
        assert.equal(await page.locator(NR + '.sp-teamtable tbody tr').first().locator('td').first().innerText(), 'SA', 'the softest defense allows the most points');
        await page.locator(NR + '[data-sp-tsort="points_against"]').click();
        assert.equal(await page.locator(NR + '.sp-teamtable tbody tr').first().locator('td').first().innerText(), 'OKC', 'a second click flips the order');
        if (width > 760) await page.locator(NR + '[data-sp-part="view"]').screenshot({ path: resolve(output, `teams-table-${width}-${theme}.png`), animations: 'disabled' });
        await page.locator(NR + '[data-sp-team-mode="chart"]').click();
        await page.locator(NR + '[data-sp-team-side]').selectOption('to:C');
        assert.equal(await page.locator(NR + '.sp-hbars li').count(), 12, 'the chart ranks every team');
        await page.locator(NR + '[data-sp-part="view"]').screenshot({ path: resolve(output, `teams-chart-${width}-${theme}.png`), animations: 'disabled' });
        await page.locator(NR + '.sp-hbars [data-sp-team-pick="sa"]').click();
        await page.locator(NR + '.sp-lead tbody tr').first().waitFor();
        const teamsShown = await page.$$eval(NR + '.sp-lead tbody tr td:nth-child(3)', (els) => [...new Set(els.map((e) => e.textContent))]);
        assert.deepEqual(teamsShown, ['SA'], 'a team opens its players');
        assert.equal(await page.locator(NR + '[data-sp-view="players"]').getAttribute('aria-pressed'), 'true');
        await page.locator(NR + '[data-sp-lead-team]').selectOption('');
        await page.locator(NR + '[data-sp-lsort="rebounds"]').click();
        const rebs = await page.$$eval(NR + '.sp-lead tbody tr', (trs) => trs.map((tr) => Number(tr.querySelector('td.is-sorted').textContent)));
        assert(rebs.length === 50 && rebs.every((v, i) => i === 0 || v <= rebs[i - 1]), 'rebounds sort high to low, 50 at a time');
        await page.locator(NR + '[data-sp-lead-set="combo"]').click();
        const leadHeads = await page.$$eval(NR + '.sp-lead thead th', (ths) => ths.map((th) => th.textContent.replace(/[▲▼]/g, '').trim()));
        assert(leadHeads.includes('PRA') && leadHeads.includes('Reb') && !leadHeads.includes('Pts'), 'Combos columns, and the sorted column stays: ' + leadHeads.join(','));
        await page.locator(NR + '[data-sp-lead-set="main"]').click();
        checks += 1;
        const allN = Number((await page.locator(NR + '[data-sp-lead-all]').innerText()).match(/Show all (\d+) players/)[1]);
        await page.locator(NR + '[data-sp-lead-all]').click();
        assert(allN >= 96 && (await page.locator(NR + '.sp-lead tbody tr').count()) === allN, 'show all lists every player with enough games');
        await page.locator(NR + '[data-sp-lead-group]').selectOption('C');
        assert.equal(await page.locator(NR + '.sp-lead tbody tr').count(), 24, 'the position filter keeps centers');
        if (width > 760) await page.locator(NR + '[data-sp-part="view"]').screenshot({ path: resolve(output, `players-table-${width}-${theme}.png`), animations: 'disabled' });
        await page.locator(NR + '[data-sp-lead-mode="chart"]').click();
        assert.equal(await page.locator(NR + '.sp-hbars li').count(), 20, 'the chart shows the top 20');
        await page.locator(NR + '[data-sp-part="view"]').screenshot({ path: resolve(output, `players-chart-${width}-${theme}.png`), animations: 'disabled' });
        await page.locator(NR + '.sp-hbars [data-sp-player]').first().click();
        await page.locator(NR + '[data-sp-panel="player"] .sp-pp-tile').first().waitFor();
        assert(/Back to player stats/.test(await page.locator(NR + '[data-sp-close="player"]').innerText()), 'the back button returns to player stats');
        for (const tab of ['upcoming', 'charts', 'log', 'opponents', 'seasons', 'pick', 'overview']) {
          await page.locator(NR + '[data-sp-ptab="' + tab + '"]').click();
          assert.equal(await page.locator(NR + '[data-sp-ptab="' + tab + '"]').getAttribute('aria-selected'), 'true', tab + ' tab is selected');
          const ovTab = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert(ovTab <= 1, 'the ' + tab + ' tab has no sideways scroll at ' + width);
        }
        await page.screenshot({ path: resolve(output, `player-page-nba-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        await page.locator(NR + '[data-sp-close="player"]').click();
        await page.locator(NR + '[data-sp-part="view"] .sp-hbars').waitFor({ state: 'visible' });
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(ov <= 1, 'the stats views have no sideways scroll at ' + width);
        await page.locator(NR + '[data-sp-view="games"]').click();
        await page.locator(NR + '[data-sp-game="401900003"]').waitFor();
        checks += 13;
        if (width > 760) await page.screenshot({ path: resolve(output, `${id}-log-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        checks += 4;
      }
      if (id === 'sports-pick-builder') {
        assert(/Enter the payout/.test(text) && /Paper picks only/.test(text), 'Pick Builder explains the flow');
        const R = '#sports-pick-builder-root ';
        const leg0 = page.locator(R + '[data-sp-leg="0"]');
        await leg0.filter({ hasText: 'Cleared over 24.5' }).waitFor();
        const l0 = await leg0.innerText();
        assert(/Stephen Curry/.test(l0) && /PHX at GS/.test(l0) && /all stored 3\/4/.test(l0), 'the pick from the NBA page arrives with its history: ' + l0);
        assert(/Last 4 against over 24\.5: 3 of 4 would have won/.test(l0) && (await leg0.locator('svg.sp-legspark rect.sp-bar.is-over').count()) === 3, 'each pick shows its last games against its line: ' + l0);
        assert(/Enter the payout if the pick wins/.test(await page.locator(R + '[data-sp-part="eval"]').innerText()), 'a missing payout is asked for');
        // A second pick through the Pick Builder's own search.
        await page.locator(R + '[data-sp-add-search]').fill('lebron');
        await page.locator(R + '[data-sp-add-player="1966"]').click();
        const addForm = page.locator(R + '[data-sp-pickform="builder"]');
        await addForm.waitFor();
        assert(/Next game: LAL at PHX/.test(await addForm.innerText()), 'LeBron’s next game is tomorrow');
        await addForm.locator('[name="line"]').fill('25.5');
        await addForm.locator('[data-sp-addpick]').click();
        await page.locator(R + '[data-sp-leg="1"]').filter({ hasText: 'Cleared over 25.5' }).waitFor();
        const leg1 = page.locator(R + '[data-sp-leg="1"]');
        await leg1.locator('[data-sp-usemodel]').waitFor();
        const l1 = await leg1.innerText();
        assert(/Model: \d+(\.\d)?% over 25\.5/.test(l1) && /80% range/.test(l1) && /minutes 10% lower/.test(l1), 'the model reads the typed line: ' + l1);
        assert(/Model: fewer than 5 stored games/.test(await leg0.innerText()), 'and says when it cannot');
        const usePct = (await leg1.locator('[data-sp-usemodel]').innerText()).match(/Use (\d+)%/)[1];
        await leg1.locator('[data-sp-usemodel]').click();
        assert.equal(await leg1.locator('[data-sp-leg-chance]').inputValue(), usePct, 'the model chance fills the box');
        assert.equal(await leg1.locator('[data-sp-src]').innerText(), 'from model');
        await page.locator(R + '[data-sp-payout="2"]').fill('3');
        await page.locator(R + '[data-sp-part="eval"]').filter({ hasText: 'Breakeven' }).waitFor();
        assert(/33\.3%/.test(await page.locator(R + '[data-sp-part="eval"]').innerText()), '3x on two picks breaks even at 33.3%');
        assert(await page.locator(R + '[data-sp-save]').isEnabled(), 'an entry without chances can still be saved');
        assert(/Too few games to copy a rate/.test(await leg0.innerText()) && (await leg0.locator('[data-sp-usehist]').count()) === 0, 'four games are shown but not offered as a chance');
        await page.locator(R + '[data-sp-leg="0"] [data-sp-leg-chance]').fill('75');
        await page.locator(R + '[data-sp-leg="1"] [data-sp-leg-chance]').fill('55');
        await page.locator(R + '[data-sp-part="eval"] .sp-tiles').waitFor();
        const ev = await page.locator(R + '[data-sp-part="eval"]').innerText();
        assert(/41\.3%/.test(ev) && /\$12\.38/.test(ev) && /\+\$2\.38/.test(ev) && /Independence baseline/.test(ev) && !/copied from history/.test(ev), 'the baseline prices the entry: ' + ev);
        assert.equal(await leg0.locator('[data-sp-src]').innerText(), 'typed', 'the chance is labeled as typed by the owner');
        if (width > 760) await page.screenshot({ path: resolve(output, `${id}-entry-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        await page.locator(R + '[data-sp-note]').fill('fixture entry');
        await page.locator(R + '[data-sp-save]').click();
        await page.locator(R + '[data-sp-part="save-msg"]').filter({ hasText: 'Saved to the paper journal' }).waitFor();
        assert.equal(await page.locator(R + '[data-sp-leg]').count(), 0, 'the entry clears after saving');
        const card = page.locator(R + '.sp-entry').first();
        await card.filter({ hasText: 'fixture entry' }).waitFor();
        const cardText = await card.innerText();
        assert(/Open/.test(cardText) && /3× all 2 hit/.test(cardText) && /Not started/.test(cardText) && /expected \+\$2\.38/.test(cardText), 'the journal shows the saved entry: ' + cardText);
        await card.locator('[data-sp-withdraw]').click();
        await card.locator('[data-sp-withdraw-yes]').click();
        await page.locator(R + '.sp-entry').first().filter({ hasText: 'Withdrawn' }).waitFor();
        assert(!requests.some((u) => /prizepicks|betr\.app|sportsbook|odds/i.test(new URL(u).hostname)), 'no request leaves the site');
        checks += 14;
      }
      assert.equal(await page.locator('[data-nav-group="sports"]').isVisible(), width > 760 ? true : await page.locator('[data-nav-group="sports"]').isVisible());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (id === 'sports-nfl') await page.screenshot({ path: resolve(output, `${id}-log-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      assert(overflow <= 1, id + ' has no sideways scroll at ' + width);
      await page.screenshot({ path: resolve(output, `${id}-${width}-${theme}.png`), fullPage: false, animations: 'disabled' });
      checks += 4;
    }
    if (role === 'owner') {
      const link = encodePrefill({ operator: 'betr', format: 'flex', stake: 5, payouts: { 2: 3 }, legs: [
        { sport: 'nba', player_id: '3975', game_id: '401900003', stat: 'points', side: 'over', threshold: 26.5 },
        { sport: 'nba', player_id: '4433', game_id: '401900003', stat: 'rebounds', side: 'under', threshold: 6.5, probability: 0.9 },
      ] });
      await page.goto(base + '/?tab=sports-pick-builder&entry=' + link);
      const R = '#sports-pick-builder-root ';
      await page.locator(R + '[data-sp-leg="1"]').filter({ hasText: 'Brandin Podziemski' }).waitFor();
      const filled = await page.locator(R).innerText();
      assert(/Filled in from a shared link/.test(filled) && /Stephen Curry/.test(filled), 'a shared link fills the draft');
      assert(!page.url().includes('entry='), 'the link leaves the address bar');
      assert.equal(await page.locator(R + '[data-sp-leg="1"] [data-sp-leg-chance]').inputValue(), '', 'a link never brings a chance');
      assert.equal(await page.locator(R + '[data-sp-operator]').inputValue(), 'betr');
      await page.locator(R + '[data-sp-payout="2"]').fill('3');
      await page.locator(R + '[data-sp-part="eval"]').filter({ hasText: 'same game' }).waitFor();
      assert(/Picks 1 and 2 are from the same game[\s\S]*Enter your chance for every pick/.test(await page.locator(R + '[data-sp-part="eval"]').innerText()), 'same-game picks are flagged and need every chance');
      await page.locator(R + '[data-sp-leg="0"] [data-sp-leg-chance]').fill('60');
      await page.locator(R + '[data-sp-leg="1"] [data-sp-leg-chance]').fill('55');
      await page.locator(R + '[data-sp-part="eval"] .sp-links').waitFor();
      const joint = await page.locator(R + '[data-sp-part="eval"]').innerText();
      assert(/How these picks moved together in past games/.test(joint) && /Points and rebounds, teammates/.test(joint) && /link [+−]?\d\.\d\d/.test(joint) && /If unrelated/.test(joint) && /Experimental/.test(joint) && /simulated games \(seed \d+\)/.test(joint),
        'two teammates in one game are priced with the measured link: ' + joint);
      if (width > 760) await page.screenshot({ path: resolve(output, `sports-pick-builder-same-game-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, 'a filled Pick Builder has no sideways scroll at ' + width);
      // A long-shot parlay price in a link (121× the stake) comes back as
      // +12000, not as +121.
      const big = encodePrefill({ operator: 'sportsbook', format: 'parlay', stake: 5, payouts: { 2: 121 }, legs: [
        { kind: 'team', sport: 'nba', game_id: '401900003', market: 'total', side: 'over', line: 260.5 },
        { kind: 'team', sport: 'nba', game_id: '401900003', market: 'win_by', team: 'phx', side: 'over', line: 25 },
      ] });
      await page.goto(base + '/?tab=sports-pick-builder&entry=' + big);
      await page.locator(R + '[data-sp-parlay]').waitFor();
      assert.equal(await page.locator(R + '[data-sp-parlay]').inputValue(), '+12000', 'a big parlay price keeps its size through a link');
      assert(/121\.00× the stake/.test(await page.locator(R + '[data-sp-parlay-note]').innerText()), 'and reads as 121×');
      await page.goto(base + '/?tab=sports-pick-builder&entry=not-a-real-link');
      await page.locator(R + '.sp-banner.sp-bad').waitFor();
      checks += 10;
      // Game bets and a sportsbook parlay: who wins and the spread on one
      // game (one number, priced exactly together), each with its own odds.
      await page.locator(R + '[data-sp-clear]').click();
      await page.locator(R + '[data-sp-add-mode="game"]').click();
      await page.locator(R + '[data-sp-gb-game]').waitFor();
      await page.locator(R + '[data-sp-gb-game]').selectOption('401900003');
      await page.locator(R + '[data-sp-gb="team"]').waitFor();
      await page.locator(R + '[data-sp-gb="team"]').selectOption('gs');
      await page.locator(R + '[data-sp-part="gb-result"]').filter({ hasText: /GS to win\s+\d+(\.\d)?%/ }).waitFor();
      await page.locator(R + '[data-sp-gb-add]').click();
      await page.locator(R + '[data-sp-leg="0"]').filter({ hasText: 'GS to win' }).waitFor();
      await page.locator(R + '[data-sp-gb="market"]').selectOption('spread');
      await page.locator(R + '[data-sp-gb="team"]').selectOption('gs');
      await page.locator(R + '[data-sp-gb="line"]').fill('-5.5');
      await page.locator(R + '[data-sp-part="gb-result"]').filter({ hasText: /GS −5\.5\s+\d+(\.\d)?%/ }).waitFor();
      await page.locator(R + '[data-sp-gb-add]').click();
      await page.locator(R + '[data-sp-leg="1"]').filter({ hasText: 'GS −5.5' }).waitFor();
      await page.locator(R + '[data-sp-gb-add]').click();
      assert(/already in the entry/.test(await page.locator(R + '[data-sp-part="gb-result"]').innerText()), 'the same game bet cannot go in twice');
      assert.equal(await page.locator(R + '[data-sp-gb="line"]').getAttribute('inputmode'), null, 'a spread box keeps a keyboard with a minus sign on phones');
      await page.locator(R + '[data-sp-gb="team"]').selectOption('phx');
      await page.locator(R + '[data-sp-gb="line"]').fill('-3.5');
      await page.locator(R + '[data-sp-gb-add]').click();
      assert(/PHX −3\.5 and GS to win can never both win/.test(await page.locator(R + '[data-sp-part="gb-result"]').innerText()), 'two bets no score lets both win are refused: ' + await page.locator(R + '[data-sp-part="gb-result"]').innerText());
      assert.equal(await page.locator(R + '[data-sp-leg]').count(), 2, 'and stay out of the entry');
      await page.locator(R + '.sp-add').screenshot({ path: resolve(output, `pick-builder-game-bet-${width}-${theme}.png`), animations: 'disabled' });
      const g0 = page.locator(R + '[data-sp-leg="0"]');
      await g0.locator('[data-sp-usemodel]').waitFor();
      const g0Text = await g0.innerText();
      assert(/Model: \d+(\.\d)?% wins/.test(g0Text) && /fair odds [+−]\d+/.test(g0Text) && /margins: \d+ of \d+ would have won|No finished games/.test(g0Text), 'a game bet shows the team model and the team’s record: ' + g0Text);
      await page.locator(R + '[data-sp-operator]').selectOption('sportsbook');
      assert.equal(await page.locator(R + '[data-sp-format]').inputValue(), 'parlay', 'a sportsbook entry is a parlay');
      await page.locator(R + '[data-sp-leg="0"] [data-sp-leg-price]').fill('-150');
      await page.locator(R + '[data-sp-leg="1"] [data-sp-leg-price]').fill('1.91');
      assert(/−150 · 1\.67 · 60¢/.test(await page.locator(R + '[data-sp-leg="0"] [data-sp-price-note]').innerText()), 'a typed price reads in all three forms');
      await page.locator(R + '.sp-parlay-all').waitFor();
      assert(/3\.18× the stake back/.test(await page.locator(R + '.sp-parlay-all').innerText()), 'the picks’ odds multiply: ' + await page.locator(R + '.sp-parlay-all').innerText());
      await page.locator(R + '[data-sp-usemodel-all]').click();
      await page.locator(R + '[data-sp-part="eval"] .sp-odds').waitFor();
      const pev = await page.locator(R + '[data-sp-part="eval"]').innerText();
      assert(/Fair odds/.test(pev) && /Your odds/.test(pev) && /Edge: [+−]\d+\.\d%/.test(pev) && /settle on the same number/.test(pev), 'the parlay shows fair odds, the offered odds and the edge: ' + pev);
      // Who wins and the spread move as one: all win is the spread's chance.
      const pAll = Number(pev.match(/Chance all hit\s+(\d+(?:\.\d+)?)%/)[1]);
      const pSpread = Number(await page.locator(R + '[data-sp-leg="1"] [data-sp-leg-chance]').inputValue());
      assert(Math.abs(pAll - pSpread) <= 1, 'winning and covering −5.5 is the cover chance: ' + pAll + ' vs ' + pSpread);
      assert(/edge [+−]\d+\.\d%/.test(await page.locator(R + '[data-sp-leg="1"] [data-sp-price-note]').innerText()), 'each priced pick shows its own edge');
      if (width > 760) await page.screenshot({ path: resolve(output, `sports-pick-builder-parlay-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      await page.locator(R + '[data-sp-part="eval"]').screenshot({ path: resolve(output, `pick-builder-odds-${width}-${theme}.png`), animations: 'disabled' });
      const pOv = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(pOv <= 1, 'a parlay entry has no sideways scroll at ' + width);
      await page.locator(R + '[data-sp-save]').click();
      await page.locator(R + '[data-sp-part="save-msg"]').filter({ hasText: 'Saved to the paper journal' }).waitFor();
      const pcard = await page.locator(R + '.sp-entry').first().innerText();
      assert(/Sportsbook · Parlay/.test(pcard) && /Parlay at \+218/.test(pcard) && /GS to win/.test(pcard) && /GS −5\.5/.test(pcard), 'the journal shows the parlay: ' + pcard);
      await page.locator(R + '.sp-entry').first().locator('[data-sp-withdraw]').click();
      await page.locator(R + '.sp-entry').first().locator('[data-sp-withdraw-yes]').click();
      await page.locator(R + '.sp-entry').first().filter({ hasText: 'Withdrawn' }).waitFor();
      // A game's Team bets checker hands its bet to the Pick Builder.
      await page.goto(base + '/?tab=sports-nba');
      await page.locator('#sports-nba-root [data-sp-game="401900003"]').click();
      await page.locator('#sports-nba-root [data-sp-tb-add]').waitFor();
      await page.locator('#sports-nba-root [data-sp-tb="market"]').selectOption('total');
      await page.locator('#sports-nba-root [data-sp-tb-add]').click();
      assert(/Added Game total over [\d.]+\. The entry has 1 pick/.test(await page.locator('#sports-nba-root [data-sp-part="tb-msg"]').innerText()), 'Team bets adds the checked bet to the Pick Builder');
      checks += 17;
      await page.goto(base + '/?tab=sports-nba');
      await page.locator('#sports-nba-root [data-sp-zone]').waitFor();
      await page.locator('#sports-nba-root [data-sp-zone]').selectOption('America/New_York');
      await page.waitForFunction(() => /Eastern/.test(document.querySelector('#sports-nba-root [data-sp-zone] option:checked')?.textContent || ''));
      assert.equal(await page.evaluate(() => localStorage.getItem('stonks-sports-tz-v1')), 'America/New_York', 'the chosen zone is remembered');
      assert(requests.some((u) => u.includes('sports=status&tz=America%2FNew_York')), 'the zone is sent to the server');
      checks += 2;
    } else {
      assert(!requests.some((u) => u.includes('sports=')), role + ' never requests Sports data');
      checks++;
    }
    assert.deepEqual(errors, [], 'no page errors for ' + role);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`Sports browser: ${checks} checks passed for anonymous, member and Owner at 1440 and 390. Screenshots: ${output}`);

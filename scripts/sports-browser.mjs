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
import { GAMES, PLAYERS, WEEK_2025, WEEK_2026 } from './fixtures/sports-nfl.mjs';
import { NBA_SOURCE, HOOPR_URLS } from '../lib/sports/hoopr.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { encodePrefill } from '../lib/sports/prefill.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const now = new Date('2026-11-02T18:00:00Z');
process.env.PRIVATE_DATA_ENABLED = '1';
process.env.SESSION_SECRET = 'sports-browser-fixture-only';
// NFL records come from the real ingest over the shared CSV fixtures (minus
// the deliberately invalid row), so the page reads exactly what the job writes.
const objects = new Map();
const files = new Map([[NFLVERSE_URLS.games, GAMES], [NFLVERSE_URLS.players, PLAYERS], [NFLVERSE_URLS.weekly(2025), WEEK_2025],
  [NFLVERSE_URLS.weekly(2026), WEEK_2026.split('\n').filter((l) => !l.startsWith('00-0005,')).join('\n')]]);
await ingestLeague({ adapter: NFL_SOURCE,  store: { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } },
  fetchText: async (u) => files.get(u) ?? null, now: Date.parse('2026-11-02T11:05:00Z') });
const nbaFiles = new Map([[HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027]]);
await ingestLeague({ adapter: NBA_SOURCE, store: { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } },
  fetchText: async (u) => nbaFiles.get(u) ?? null, now: Date.parse('2026-11-02T11:10:00Z') });
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
    if (query.sports != null) return handleSportsRequest(req, res, { now: fixtureNow });
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
        await page.locator('#sports-nfl-root [data-sp-game="2026_08_chi_sea"]').click();
        await page.locator('#sports-nfl-root [data-sp-panel="game"] [data-sp-player="00-0001"]').waitFor();
        const panel = await page.locator('#sports-nfl-root [data-sp-panel="game"]').innerText();
        assert(/Geno Smíth/.test(panel) && /Jaxon Smith-Njigba/.test(panel) && /No player games stored for this team/.test(panel), 'the game lists each team’s recent players');
        await page.locator('#sports-nfl-root [data-sp-search]').fill('kelce');
        await page.locator('#sports-nfl-root [data-sp-part="results"] [data-sp-player="00-0003"]').click();
        await page.locator('#sports-nfl-root [data-sp-panel="player"] .sp-log').waitFor();
        const log = await page.locator('#sports-nfl-root [data-sp-panel="player"]').innerText();
        assert(/Travis Kelce/.test(log) && /Averages over 1 stored games/i.test(log) && /@ DEN/.test(log), 'player search opens the game log: ' + log.slice(0, 400));
        assert.equal(await page.locator('#sports-nfl-root [data-sp-search]').inputValue(), 'kelce', 'the search box keeps its text');
        await page.locator('#sports-nfl-root [data-sp-player="00-0001"]').first().click();
        await page.locator('#sports-nfl-root [data-sp-panel="player"]').filter({ hasText: 'Geno Smíth' }).waitFor();
        await page.locator('#sports-nfl-root [data-sp-panel="game"]').scrollIntoViewIfNeeded();
        checks += 6;
      }
      if (id === 'sports-nba') {
        assert(/Up to date/.test(text) && /2025–26, 2026–27/.test(text) && /Sun, Nov 1/.test(text), 'NBA shows its job status, seasons and latest game');
        await page.locator('#sports-nba-root [data-sp-game="401900003"]').waitFor();
        const board = await page.locator('#sports-nba-root [data-sp-part="board"]').innerText();
        assert(/PHX\s+at\s+GS/.test(board) && /7:00\sPM\sPST/.test(board) && /LAL\s+at\s+PHX/.test(board), 'tonight and tomorrow on the NBA board');
        await page.locator('#sports-nba-root [data-sp-game="401900003"]').click();
        await page.locator('#sports-nba-root [data-sp-panel="game"] [data-sp-player="3975"]').click();
        await page.locator('#sports-nba-root [data-sp-panel="player"] .sp-log').waitFor();
        const nbaLog = await page.locator('#sports-nba-root [data-sp-panel="player"]').innerText();
        assert(/out last game/.test(await page.locator('#sports-nba-root [data-sp-panel="game"]').innerText()), 'a player who sat out is flagged');
        assert(/did not play: left ankle sprain/.test(nbaLog) && /Minutes/.test(nbaLog) && /\bMin\b/.test(nbaLog), 'the NBA log shows minutes and the missed game with its reason');
        const form = page.locator('#sports-nba-root [data-sp-panel="player"] [data-sp-pickform]');
        assert(/Next game: PHX at GS/.test(await form.innerText()), 'the pick form names the next game');
        await form.locator('[name="line"]').fill('24.3');
        await form.locator('[data-sp-addpick]').click();
        assert(/whole or half number/.test(await form.locator('[data-sp-pick-msg]').innerText()), 'a bad line is refused before anything is added');
        await form.locator('[name="line"]').fill('24.5');
        await form.locator('[data-sp-addpick]').click();
        assert(/Added\. The entry has 1 pick\./.test(await form.locator('[data-sp-pick-msg]').innerText()), 'the pick goes into the Pick Builder draft');
        checks += 3;
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
        checks += 10;
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
      assert(/Picks 1 and 2 are from the same game/.test(await page.locator(R + '[data-sp-part="eval"]').innerText()), 'same-game picks are flagged and not priced');
      if (width > 760) await page.screenshot({ path: resolve(output, `sports-pick-builder-same-game-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, 'a filled Pick Builder has no sideways scroll at ' + width);
      await page.goto(base + '/?tab=sports-pick-builder&entry=not-a-real-link');
      await page.locator(R + '.sp-banner.sp-bad').waitFor();
      checks += 7;
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

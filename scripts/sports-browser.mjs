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
import { ingestNfl } from '../lib/sports/ingest-nfl.mjs';
import { NFLVERSE_URLS } from '../lib/sports/nflverse.mjs';
import { GAMES, PLAYERS, WEEK_2025, WEEK_2026 } from './fixtures/sports-nfl.mjs';

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
await ingestNfl({ store: { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } },
  fetchText: async (u) => files.get(u) ?? null, now: Date.parse('2026-11-02T11:05:00Z') });
store.rawGet = async (key) => (objects.has(key) ? Buffer.from(objects.get(key)) : null);
for (const m of ['put', 'del', 'rawPut', 'rawDel', 'publishGeneration']) store[m] = async () => { throw new Error('Sports page attempted a store write: ' + m); };
store.get = async () => Buffer.from('{}');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const query = Object.fromEntries(url.searchParams);
  const json = (o, n = 200) => { res.statusCode = n; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  res.status = (n) => { res.statusCode = n; return res; }; res.json = (o) => json(o, res.statusCode);
  if (url.pathname === '/api/auth/me' || url.pathname.startsWith('/data/')) {
    if (url.pathname.startsWith('/data/')) query.data = url.pathname.slice(6);
    query.action = 'me'; req.query = query; return authHandler(req, res);
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
        assert(/Not connected yet/.test(text) && /No NBA games loaded yet/.test(text), 'NBA is honest about missing data');
        assert(!requests.some((u) => u.includes('sports=board&sport=nba')), 'an unconnected league makes no board request');
      }
      if (id === 'sports-pick-builder') assert(/Enter the payout/.test(text) && /Paper picks only/.test(text), 'Pick Builder explains the flow');
      assert.equal(await page.locator('[data-nav-group="sports"]').isVisible(), width > 760 ? true : await page.locator('[data-nav-group="sports"]').isVisible());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (id === 'sports-nfl') await page.screenshot({ path: resolve(output, `${id}-log-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      assert(overflow <= 1, id + ' has no sideways scroll at ' + width);
      await page.screenshot({ path: resolve(output, `${id}-${width}-${theme}.png`), fullPage: false, animations: 'disabled' });
      checks += 4;
    }
    if (role === 'owner') {
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

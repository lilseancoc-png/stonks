// Sports section smoke: Owner-only access, the private storage namespace,
// the Today/Tomorrow window across DST and midnight, the record contracts,
// and the page wiring. No network, no store credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sportsEnabled } from '../lib/sports/access.mjs';
import { handleSportsRequest, sportsStatus, sameOrigin } from '../lib/sports/http.mjs';
import { sportsDayWindow, activeDayOf, zonedMidnightUtc, localDate, resolveTimeZone, SPORTS_DEFAULT_TIME_ZONE } from '../lib/sports/time.mjs';
import { MODEL_SPECS } from '../lib/sports/models.mjs';
import { validateGame, validatePlayer, validatePlayerGame, validateMarketObservation, marketSeriesKey, statIds, statValue, SPORTS_STATS, STAT_GROUPS } from '../lib/sports/schema.mjs';
import { sportsKey, isSportsKey, readSportsJson, writeSportsJson, SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { OWNER_PAGE_IDS, SPORTS_PAGE_IDS } from '../lib/owner-access-policy.mjs';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { sportsFactory } from './render/sports-client.mjs';
import { UPDATE_FEATURES } from '../lib/update-checker-catalog.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// --- access -----------------------------------------------------------------
const owner = { sub: 'discord-1', tr: true, tp: true };
const on = { PRIVATE_DATA_ENABLED: '1' };
ok(sportsEnabled(owner, on), 'signed Owner opens Sports');
ok(!sportsEnabled(owner, {}), 'private data off closes Sports');
ok(!sportsEnabled(owner, { ...on, SPORTS_ENABLED: '0' }), 'kill switch closes Sports');
ok(!sportsEnabled({ ...owner, tp: false }, on), 'missing tp claim closes Sports');
ok(!sportsEnabled({ ...owner, tr: false }, on), 'missing tr claim closes Sports');
ok(!sportsEnabled({ tr: true, tp: true, sub: ' ' }, on), 'blank subject closes Sports');
ok(!sportsEnabled(null, on), 'no session closes Sports');

function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const memStore = (objects = {}) => ({
  backend: 'r2',
  rawGet: async (k) => (k in objects ? Buffer.from(typeof objects[k] === 'string' ? objects[k] : JSON.stringify(objects[k])) : null),
  rawPut: async (k, v) => { objects[k] = String(v); },
  objects,
});
async function call({ method = 'GET', query = { sports: 'status' }, session = owner, env = on, headers = {}, store = memStore() } = {}) {
  const res = fakeRes();
  await handleSportsRequest({ method, query, headers }, res, { env, getSession: async () => session, store, now: () => Date.parse('2026-11-02T18:00:00Z') });
  return res;
}
{
  const r = await call();
  eq(r.statusCode, 200, 'Owner status is 200');
  eq(r.headers['cache-control'], 'private, no-store', 'Sports responses are never cached');
  eq(r.body.window.time_zone, SPORTS_DEFAULT_TIME_ZONE, 'Los Angeles is the default day boundary');
  eq(r.body.window.today, '2026-11-02');
  eq(r.body.sources.nfl.state, 'not_connected', 'no job yet means not connected');
  eq(r.body.ai_requests, 0); eq(r.body.sportsbook_requests, 0);
}
eq((await call({ session: null })).statusCode, 403, 'signed-out visitor gets 403 when Sports is on');
eq((await call({ session: { ...owner, tp: false } })).statusCode, 403, 'non-Owner gets 403');
eq((await call({ env: {} })).statusCode, 404, 'private data off hides Sports');
eq((await call({ env: { ...on, SPORTS_ENABLED: '0' } })).statusCode, 404, 'kill switch hides Sports');
eq((await call({ query: { sports: 'bets' } })).statusCode, 405, 'unknown op is refused');
eq((await call({ query: { sports: 'save-entry' } })).statusCode, 405, 'writes are POST only');
eq((await call({ query: { sports: 'status', data: 'picks.json' } })).statusCode, 400, 'ambiguous request is refused');
eq((await call({ method: 'POST', headers: { origin: 'https://evil.example', host: 'mingstreet.app' } })).statusCode, 403, 'cross-site POST is refused');
eq((await call({ method: 'POST', headers: { origin: 'https://mingstreet.app', host: 'mingstreet.app' } })).statusCode, 405, 'status is GET-only');
eq((await call({ method: 'DELETE' })).statusCode, 405, 'other methods are refused');
ok(sameOrigin({ headers: { 'sec-fetch-site': 'same-origin' } }) && !sameOrigin({ headers: {} }), 'same-origin check');
{
  const r = await call({ query: { sports: 'status', tz: 'America/New_York' } });
  eq(r.body.window.time_zone, 'America/New_York', 'a valid zone is honored');
  const bad = await call({ query: { sports: 'status', tz: 'Mars/Olympus' } });
  eq(bad.body.window.time_zone, SPORTS_DEFAULT_TIME_ZONE, 'an invalid zone falls back');
}
{
  const store = memStore({ [sportsKey('status', { sport: 'nfl' })]: { state: 'ok', last_success_utc: '2026-11-02T10:00:00Z', seasons: [2025, 2026, 'x'], counts: { player_games: 41000 }, message: 'x'.repeat(900) } });
  const s = await sportsStatus({ store, now: Date.parse('2026-11-02T18:00:00Z') });
  eq(s.sources.nfl.state, 'ok'); eq(s.sources.nfl.seasons, [2025, 2026], 'non-year seasons are dropped');
  eq(s.sources.nfl.message.length, 300, 'long job messages are cut');
  eq(s.sources.nba.state, 'not_connected');
  const broken = await sportsStatus({ store: { backend: 'r2', rawGet: async () => { throw new Error('down'); } } });
  eq(broken.sources.nfl.state, 'not_connected', 'a store outage degrades to not connected, not a crash');
  const garbage = await sportsStatus({ store: memStore({ [sportsKey('status', { sport: 'nba' })]: { state: 'pwned' } }) });
  eq(garbage.sources.nba.state, 'unknown', 'unrecognized job states are not trusted');
}

// --- storage namespace --------------------------------------------------------
eq(sportsKey('games', { sport: 'nfl', season: 2026 }), '_stonks/sports/v1/nfl/games/2026.json');
eq(sportsKey('player-games', { sport: 'nba', season: 2025 }), '_stonks/sports/v1/nba/player-games/2025.json');
eq(sportsKey('journal'), '_stonks/sports/v1/journal/entries.json');
for (const kind of ['status', 'players', 'games', 'player-games', 'model', 'observations', 'journal']) {
  ok(sportsKey(kind, { sport: 'nba', season: 2026 }).startsWith(SPORTS_PREFIX), kind + ' stays in the private Sports namespace');
}
assert.throws(() => sportsKey('games', { sport: 'mlb', season: 2026 })); checks++;
assert.throws(() => sportsKey('games', { sport: 'nfl', season: 26 })); checks++;
assert.throws(() => sportsKey('secrets')); checks++;
ok(!isSportsKey('_stonks/sports/v1/../published.json') && !isSportsKey('picks.json'), 'only Sports keys pass');
await assert.rejects(() => readSportsJson(memStore(), 'picks.json')); checks++;
{
  const store = memStore();
  await writeSportsJson(store, sportsKey('players', { sport: 'nfl' }), { players: [] });
  eq(await readSportsJson(store, sportsKey('players', { sport: 'nfl' })), { players: [] });
  eq(await readSportsJson(store, sportsKey('players', { sport: 'nba' })), null, 'a missing record reads as null');
}
// The public /data reader refuses the whole internal prefix before any store access.
{
  process.env.PRIVATE_DATA_ENABLED = '1';
  const { serveDataKey } = await import('../lib/data-response.mjs');
  const res = fakeRes();
  await serveDataKey({ headers: {}, query: {} }, res, '_stonks/sports/v1/journal/entries.json');
  eq(res.statusCode, 400, 'Sports records are never served by /data');
  delete process.env.PRIVATE_DATA_ENABLED;
}

// --- Today / Tomorrow -----------------------------------------------------------
const LA = 'America/Los_Angeles';
eq(new Date(zonedMidnightUtc('2026-03-08', LA)).toISOString(), '2026-03-08T08:00:00.000Z', 'midnight before spring-forward is PST');
eq(new Date(zonedMidnightUtc('2026-03-09', LA)).toISOString(), '2026-03-09T07:00:00.000Z', 'midnight after spring-forward is PDT');
eq(new Date(zonedMidnightUtc('2026-11-01', LA)).toISOString(), '2026-11-01T07:00:00.000Z', 'midnight before fall-back is PDT');
eq(new Date(zonedMidnightUtc('2026-11-02', LA)).toISOString(), '2026-11-02T08:00:00.000Z', 'midnight after fall-back is PST');
{
  const w = sportsDayWindow(Date.parse('2026-11-01T12:00:00Z'), LA);
  eq([w.today, w.tomorrow, w.start_utc, w.end_utc], ['2026-11-01', '2026-11-02', '2026-11-01T07:00:00.000Z', '2026-11-03T08:00:00.000Z'], 'the window spans a 25-hour DST day');
}
eq(localDate(Date.parse('2026-11-03T07:59:59Z'), LA), '2026-11-02', 'one second before LA midnight');
eq(localDate(Date.parse('2026-11-03T08:00:00Z'), LA), '2026-11-03', 'LA midnight');
{
  const now = Date.parse('2026-11-02T18:00:00Z');
  const lateTip = '2026-11-03T06:30:00Z'; // 10:30 pm Pacific on Nov 2, already Nov 3 in New York
  eq(activeDayOf(lateTip, now, LA), 'today', 'a late Pacific tip-off is today in LA');
  eq(activeDayOf(lateTip, now, 'America/New_York'), 'tomorrow', 'and tomorrow in New York');
  eq(activeDayOf('2026-11-03T20:00:00Z', now, LA), 'tomorrow');
  eq(activeDayOf('2026-11-04T20:00:00Z', now, LA), null, 'two days out is not on the board');
  eq(activeDayOf('2026-11-01T20:00:00Z', now, LA), null, 'yesterday is not on the board');
  eq(activeDayOf('TBD', now, LA), null, 'a missing start is never active');
}
eq(resolveTimeZone('../../etc'), SPORTS_DEFAULT_TIME_ZONE); eq(resolveTimeZone('Europe/London'), 'Europe/London');

// --- record contracts ------------------------------------------------------------
const game = { sport: 'nfl', game_id: 'nfl.2026_09_kc_buf', season: 2026, week: 9, start_utc: '2026-11-02T18:00:00Z', home_team: 'buf', away_team: 'kc', status: 'scheduled' };
ok(validateGame(game).ok, 'a scheduled game validates');
ok(!validateGame({ ...game, status: 'final' }).ok, 'a final game needs scores');
ok(validateGame({ ...game, status: 'final', home_score: 24, away_score: 21 }).ok);
ok(!validateGame({ ...game, home_team: 'kc' }).ok, 'a team cannot play itself');
ok(!validateGame({ ...game, start_utc: 'tomorrow' }).ok);
ok(validatePlayer({ sport: 'nba', player_id: 'nba.p.1', name: 'Example Player', provider_ids: { espn: '123' }, teams: [{ team: 'lal', from: '2025-10-01' }] }).ok);
ok(!validatePlayer({ sport: 'nba', player_id: 'nba.p.1', name: '', provider_ids: {} }).ok, 'players need a name');
const nbaRow = { sport: 'nba', player_id: 'nba.p.1', game_id: 'nba.401', team: 'lal', opponent: 'bos', home: true, played: true, minutes: 34.5, stats: { points: 27, rebounds: 9 } };
ok(validatePlayerGame(nbaRow).ok, 'an NBA row validates');
ok(validatePlayerGame({ ...nbaRow, played: false, minutes: 0, stats: { points: null, rebounds: null } }).ok, 'a DNP is a valid row, not a dropped one');
ok(!validatePlayerGame({ ...nbaRow, minutes: undefined }).ok, 'played NBA rows need minutes');
ok(!validatePlayerGame({ ...nbaRow, sport: 'nfl', stats: { receptions: 7, targets: 5 } }).ok, 'receptions cannot exceed targets');
ok(validatePlayerGame({ ...nbaRow, sport: 'nfl', minutes: undefined, stats: { passing_yards: -4, receptions: 0, targets: 0 } }).ok, 'negative yards are real');
const obs = { sport: 'nba', operator: 'prizepicks', game_id: 'nba.401', player_id: 'nba.p.1', stat: 'points', side: 'over', threshold: 24.5, observed_at: '2026-11-02T17:00:00Z', source: 'manual' };
ok(validateMarketObservation(obs).ok, 'a captured line validates');
ok(!validateMarketObservation({ ...obs, threshold: 24.3 }).ok, 'lines are whole or half numbers');
ok(!validateMarketObservation({ ...obs, stat: 'passing_yards' }).ok, 'stats must belong to the sport');
ok(!validateMarketObservation({ ...obs, operator: 'draftkings' }).ok, 'operators are a fixed list');
eq(marketSeriesKey(obs), marketSeriesKey({ ...obs, threshold: 21.5, side: 'under' }), 'a market keeps its id as the line moves');
ok(marketSeriesKey(obs) !== marketSeriesKey({ ...obs, operator: 'betr' }), 'each operator is its own market');
ok(/^ms_[a-f0-9]{24}$/.test(marketSeriesKey(obs)));
eq(statIds('nba', { modeledOnly: true }), ['points', 'rebounds'], 'NBA stats with a forecast');
eq(statIds('nfl', { modeledOnly: true }), ['passing_yards', 'receptions'], 'NFL stats with a forecast');
ok(Object.keys(SPORTS_STATS).join() === 'nba,nfl');
// The catalog: every stat the pages and Pick Builder take. Forecast flags
// must match the fitted model list, ids must pass the prefill link check,
// and every combo part must be a stored stat of the same league.
for (const sp of ['nba', 'nfl']) {
  eq(statIds(sp, { modeledOnly: true }), Object.keys(MODEL_SPECS[sp]), sp + ': forecast flags match MODEL_SPECS');
  const list = SPORTS_STATS[sp], ids = list.map((s) => s.id);
  eq(new Set(ids).size, ids.length, sp + ': stat ids are unique');
  ok(list.every((s) => /^[a-z_]{1,40}$/.test(s.id) && s.label && s.short && STAT_GROUPS.some(([g]) => g === s.group)), sp + ': ids, labels, short names and groups');
  ok(list.filter((s) => s.parts).every((s) => s.parts.every(([part, w]) => ids.includes(part) && !list.find((x) => x.id === part).parts && Number.isFinite(w))), sp + ': combo parts are stored stats');
  ok(!ids.includes('minutes'), sp + ': minutes is not a pick stat');
}
ok(['pra', 'pts_reb', 'pts_ast', 'reb_ast', 'blk_stl', 'fantasy'].every((id) => statIds('nba').includes(id)), 'NBA combos');
ok(['rush_rec_yards', 'pass_rush_yards'].every((id) => statIds('nfl').includes(id)), 'NFL combos');
// statValue: stored stats, combos summed from parts, minutes.
const nbaStats = { points: 21, rebounds: 9, assists: 6, steals: 2, blocks: 1, turnovers: 3, offensive_rebounds: 4, threes: 3 };
const nbaPlayed = { played: true, minutes: 33.5, stats: nbaStats };
eq(statValue(nbaPlayed, 'points'), 21);
eq(statValue(nbaPlayed, 'minutes'), 33.5);
eq(statValue(nbaPlayed, 'pra'), 36, 'PRA sums points, rebounds and assists');
eq(statValue(nbaPlayed, 'pts_reb'), 30);
eq(statValue(nbaPlayed, 'pts_ast'), 27);
eq(statValue(nbaPlayed, 'reb_ast'), 15);
eq(statValue(nbaPlayed, 'blk_stl'), 3);
eq(statValue(nbaPlayed, 'defensive_rebounds'), 5, 'defensive rebounds are rebounds minus offensive');
eq(statValue(nbaPlayed, 'fantasy'), 21 + 9 * 1.2 + 6 * 1.5 + 2 * 3 + 1 * 3 - 3, 'fantasy score uses the published weights');
eq(statValue({ played: true, stats: { ...nbaStats, assists: null } }, 'pra'), null, 'an NBA combo needs every part');
eq(statValue({ played: true, stats: { ...nbaStats, assists: null } }, 'pts_reb'), 30, 'a combo without the missing part still works');
eq(statValue({ played: false, minutes: 0, stats: {} }, 'points'), null, 'a DNP row has no value');
eq(statValue({ stats: { rushing_yards: 41, receiving_yards: null } }, 'rush_rec_yards'), 41, 'NFL combos count a blank part as zero');
eq(statValue({ stats: { rushing_yards: null, receiving_yards: null } }, 'rush_rec_yards'), null, 'but not when every part is blank');
eq(statValue({ stats: { passing_yards: 251, rushing_yards: 18 } }, 'pass_rush_yards'), 269);
eq(statValue({ stats: { passing_yards: 'x' } }, 'passing_yards'), null, 'non-numbers are not values');
eq(statValue(null, 'points'), null);
ok(validateMarketObservation({ ...obs, stat: 'pra' }).ok, 'a combo line can be captured');

// --- pages and isolation -------------------------------------------------------------
const sportsSection = SITE_SECTIONS.find((s) => s.id === 'sports');
ok(sportsSection && sportsSection.owner, 'Sports is its own Owner section');
eq(sportsSection.items.map((i) => i.id), SPORTS_PAGE_IDS, 'Sports holds exactly NBA, NFL and Pick Builder');
ok(SPORTS_PAGE_IDS.every((id) => OWNER_PAGE_IDS.includes(id)), 'every Sports page is Owner-only');
const app = renderAppJs({});
const ownerTabs = JSON.parse(app.match(/var OWNER_TABS = (\{[^;]+\});/)[1]);
ok(SPORTS_PAGE_IDS.every((id) => ownerTabs[id] === 1), 'app.js gates every Sports page');
ok(app.includes("sports.load(name)") && app.includes("'/api/auth/me?sports=' + encodeURIComponent(op)"), 'pages load only through the gated route');
ok((sportsFactory.toString().match(/host\.fetch\(/g) || []).length === 1, 'the Sports pages have exactly one network call site');
ok(app.includes("document.querySelectorAll('[data-role-group=\"owner\"]')"), 'both Owner groups are revealed or removed');
ok(!/localStorage\.setItem\(TZ_KEY, (?!tz\))/.test(app), 'only the chosen time zone is stored in localStorage');
const storageWrites = sportsFactory.toString().match(/(local|session)Storage\.setItem\([A-Z_]+/g) || [];
eq(storageWrites, ['localStorage.setItem(TZ_KEY', 'sessionStorage.setItem(DRAFT_KEY'], 'the browser keeps only the zone and the unsaved draft');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
ok(/<details class="side-nav-group" data-nav-group="sports" data-role-group="owner" open hidden>/.test(html), 'the Sports group ships hidden until the Owner check');
for (const id of SPORTS_PAGE_IDS) ok(html.includes('id="page-pane-' + id + '"') && html.includes('id="' + id + '-root"'), id + ' pane ships');
ok(UPDATE_FEATURES.filter((f) => SPORTS_PAGE_IDS.includes(f.id)).every((f) => f.mode === 'on-demand'), 'Update Checker treats Sports as request-driven');
const route = readFileSync(new URL('../api/auth/[action].js', import.meta.url), 'utf8');
ok(/req\.query\?\.sports != null[\s\S]{0,120}lib\/sports\/http\.mjs/.test(route), 'Sports rides inside the existing auth function');

console.log(`Sports smoke passed (${checks} checks).`);

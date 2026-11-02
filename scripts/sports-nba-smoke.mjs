// NBA data for the Owner Sports section: the hoopR adapter, the shared league
// ingest with NBA files, packed row storage and the read views behind the
// NBA page. Offline: fixture CSV only, fake store.
//   node scripts/sports-nba-smoke.mjs
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/sports/csv.mjs';
import { normalizeNbaGames, normalizeNbaPlayerGames, HOOPR_URLS, NBA_SOURCE, NBA_TEAMS } from '../lib/sports/hoopr.mjs';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { LEAGUE_SOURCES } from '../lib/sports/leagues.mjs';
import { packRows, unpackRows, ROW_FORMAT } from '../lib/sports/rows.mjs';
import { buildBoard, buildGame, buildPlayerLog, searchPlayers } from '../lib/sports/read.mjs';
import { handleSportsRequest, recordLoader, sportsStatus } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// --- adapter -------------------------------------------------------------------
ok(HOOPR_URLS.box(2026).endsWith('player_box_2027.csv') && HOOPR_URLS.schedule(2025).endsWith('nba_schedule_2026.csv'), 'hoopR files are named by the season end year');
eq(NBA_TEAMS.length, 30, 'thirty NBA teams');
eq(Object.keys(LEAGUE_SOURCES).sort(), ['nba', 'nfl'], 'both leagues have an ingest adapter');

const g25 = normalizeNbaGames(parseCsv(SCHEDULE_2026), 2025);
eq(g25.games.map((g) => [g.game_id, g.season_type, g.status]), [
  ['401800004', 'REG', 'postponed'], ['401800001', 'REG', 'final'], ['401800002', 'PLAYIN', 'final'], ['401800003', 'POST', 'final'],
], 'season types, statuses, All-Star skipped, sorted by start');
const g26 = normalizeNbaGames(parseCsv(SCHEDULE_2027), 2026);
const tonight = g26.games.find((g) => g.game_id === '401900003');
ok(tonight.start_utc === '2026-11-03T03:00:00.000Z' && tonight.local_date === '2026-11-02' && tonight.home_score === null, 'start from the UTC field, scores only when final');
eq(g26.games.find((g) => g.game_id === '401900002').venue, 'crypto.com Arena');

const byId = new Map(g26.games.map((g) => [g.game_id, g]));
const pg = normalizeNbaPlayerGames(parseCsv(BOX_2027), byId);
eq(pg.rejected, [], 'no fixture row is invalid');
eq(pg.rows.length, 7, 'the team-total row is skipped');
const curryOut = pg.rows.find((r) => r.player_id === '3975' && r.game_id === '401900002');
ok(curryOut.played === false && curryOut.minutes === 0 && curryOut.dnp_reason === 'LEFT ANKLE SPRAIN' && curryOut.stats.points === null, 'did-not-play keeps its reason and null stats');
const bench = pg.rows.find((r) => r.player_id === '4066');
ok(bench.played === false && bench.dnp_reason == null, 'no minutes and no points counts as did not play');
const garbage = pg.rows.find((r) => r.player_id === '4067');
ok(garbage.played === true && garbage.minutes === 0 && garbage.stats.points === 2, 'points without minutes counts as played');
const pod = pg.rows.find((r) => r.player_id === '4433' && r.game_id === '401900002');
ok(pod.home === false && pod.opponent === 'lal' && pod.stats.pra === 36 && pod.stats.threes === 3, 'home flag, opponent, PRA and threes');
eq(pg.people.find((p) => p.player_id === '3975').name, 'Stephen Curry', 'names come from the box scores');
const exhibition = normalizeNbaPlayerGames(parseCsv(BOX_2026), new Map(g25.games.map((g) => [g.game_id, g])));
ok(!exhibition.rows.some((r) => r.player_id === '9999'), 'All-Star rows are skipped');

// --- packed rows -----------------------------------------------------------------
const packed = packRows(pg.rows);
eq(packed.format, ROW_FORMAT);
const roundTrip = unpackRows({ ...packed, sport: 'nba', season: 2026 });
const dropNulls = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null));
eq(roundTrip.map(dropNulls), pg.rows.map((r) => dropNulls(JSON.parse(JSON.stringify(r)))), 'packed rows unpack to the same records (empty fields left out)');
eq(unpackRows({ ...packed, sport: 'nba', season: 2026 }, { playerId: '3975' }).length, 2, 'one player unpacks without the rest');
ok(JSON.stringify(packed).length < JSON.stringify(pg.rows).length * 0.6, 'packing saves at least 40%');
eq(unpackRows({ rows: [{ player_id: 'x' }] }), [{ player_id: 'x' }], 'unpacked older records still read');

// --- ingest --------------------------------------------------------------------
function memStore() {
  const objects = new Map();
  return { objects, backend: 'mem', rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } };
}
const files = new Map([[HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027]]);
const fetched = [];
const fetchText = async (u) => { fetched.push(u); return files.get(u) ?? null; };
const NOW = Date.parse('2026-11-02T18:00:00Z');
const st = memStore();
const run = await ingestLeague({ adapter: NBA_SOURCE, store: st, fetchText, now: NOW });
eq(run.status.state, 'ok');
eq(run.status.seasons, [2025, 2026]);
eq(run.status.latest_game_date, '2026-11-01', 'the status names the latest stored game');
ok(JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/player-games/2025.json')).complete === true, 'a past season with a postponed game still finishes');
const players = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/players.json')).players;
eq(players.map((p) => p.name).sort(), ['Bench Guard', 'Brandin Podziemski', 'Garbage Time', 'LeBron James', 'Stephen Curry'], 'players come from both seasons');
fetched.length = 0;
await ingestLeague({ adapter: NBA_SOURCE, store: st, fetchText, now: NOW + 86400000 });
ok(!fetched.includes(HOOPR_URLS.box(2025)), 'the finished season is not downloaded again');
ok(JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/players.json')).players.some((p) => p.name === 'LeBron James'), 'names from a season not re-read are kept');
const status = await sportsStatus({ store: st, now: NOW });
eq(status.sources.nba.latest_game_date, '2026-11-01', 'the status route passes the latest game date');
eq(status.sources.nba.provider, 'hoopR (ESPN box scores)');

// --- read views ----------------------------------------------------------------
const load = recordLoader(st);
const board = await buildBoard({ load, sport: 'nba', nowMs: NOW, tz: 'America/Los_Angeles' });
eq(board.games.map((g) => [g.game_id, g.day, `${g.away_team}@${g.home_team}`]), [['401900003', 'today', 'phx@gs'], ['401900004', 'tomorrow', 'lal@phx']], '7 pm Pacific is today, the next night tomorrow');
eq(board.next_game.game_id, '401900005');
const game = await buildGame({ load, sport: 'nba', gameId: '401900003', seasons: [2025, 2026] });
ok(game && game.game.game_id === '401900003', 'ESPN numeric ids find their game');
const gs = game.teams.gs.players;
eq(gs.map((p) => p.name).slice(0, 2), ['Stephen Curry', 'Brandin Podziemski'], 'ordered by recent points');
ok(gs.find((p) => p.player_id === '3975').out_last_game === true, 'a player who sat out last game is flagged');
eq(gs.find((p) => p.player_id === '3975').summaries.points.last5, 27, 'averages leave out the game he missed');
eq(game.teams.phx.players, [], 'no stored games for the other team yet');
const log = await buildPlayerLog({ load, sport: 'nba', playerId: '3975', seasons: [2025, 2026] });
eq(log.games.map((g) => [g.date, g.played, g.dnp_reason]), [['2026-11-01', false, 'LEFT ANKLE SPRAIN'], ['2026-10-30', true, null], ['2026-04-19', true, null], ['2026-04-15', true, null], ['2026-04-09', true, null]], 'log across seasons with the missed game');
eq(log.summaries.points, { games: 4, last5: 27, last10: 27, average: 27, median: 27.5, low: 22, high: 31 }, 'points summary skips the missed game');
eq(log.summaries.minutes.games, 4, 'minutes are summarized from played games');
eq(log.games[2].season_type, 'POST');
eq((await searchPlayers({ load, sport: 'nba', query: 'curry' })).players[0].player_id, '3975');

// --- route ---------------------------------------------------------------------
function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(query) {
  const res = fakeRes();
  await handleSportsRequest({ method: 'GET', headers: {}, query }, res, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: 'o', tr: true, tp: true }), store: st, now: () => NOW });
  return res;
}
eq((await call({ sports: 'game', sport: 'nba', id: '401900003' })).statusCode, 200, 'NBA game through the route');
eq((await call({ sports: 'board', sport: 'nba', tz: 'America/New_York' })).body.games.map((g) => g.day), ['today', 'tomorrow'], 'a 10 pm Eastern tip-off is still today in New York');

console.log(`Sports NBA smoke passed (${checks} checks).`);

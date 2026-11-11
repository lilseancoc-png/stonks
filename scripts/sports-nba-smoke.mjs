// NBA data for the Owner Sports section: the hoopR adapter, the shared league
// ingest with NBA files, packed row storage and the read views behind the
// NBA page. Offline: fixture CSV only, fake store.
//   node scripts/sports-nba-smoke.mjs
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/sports/csv.mjs';
import { normalizeNbaGames, normalizeNbaPlayerGames, HOOPR_URLS, NBA_SOURCE, NBA_TEAMS, NBA_COM_URLS, boxScoreCheck, parseNbaComSchedule, parseNbaComBox, nbaComCheck, nbaComTricode } from '../lib/sports/hoopr.mjs';
import { integrityLine } from '../lib/sports/ingest.mjs';
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
eq(pg.rows.length, 6, 'the team-total row is skipped, and so is the blank bench line in a game whose box points fall short of the final');
eq(pg.fixes.unknown_rows_dropped, 1, 'the dropped blank line is counted');
const curryOut = pg.rows.find((r) => r.player_id === '3975' && r.game_id === '401900002');
ok(curryOut.played === false && curryOut.minutes === 0 && curryOut.dnp_reason === 'LEFT ANKLE SPRAIN' && curryOut.stats.points === null, 'did-not-play keeps its reason and null stats');
ok(!pg.rows.some((r) => r.player_id === '4066'), 'a blank line (no minutes, no stat, no reason) in a short box is unknown, not a game he sat out');
// The same blank line when the team's box adds up to its final: did not play.
const evenGame = { sport: 'nba', game_id: '401900010', season: 2026, season_type: 'REG', local_date: '2026-10-29', start_utc: '2026-10-30T00:00:00.000Z', home_team: 'gs', away_team: 'por', status: 'final', home_score: 27, away_score: 0 };
const even = normalizeNbaPlayerGames(parseCsv(BOX_2027.split('\n')[0] + '\n' + BOX_2027.split('\n').slice(1, 4).map((l) => l.replace('401900001', '401900010')).join('\n').replace(/,14,7,/, ',0,7,')), new Map([[evenGame.game_id, evenGame]]));
const bench = even.rows.find((r) => r.player_id === '4066');
ok(bench && bench.played === false && bench.dnp_reason == null && even.fixes.unknown_rows_dropped === 0, 'no minutes and no points counts as did not play when the box adds up');
const garbage = pg.rows.find((r) => r.player_id === '4067');
ok(garbage.played === true && garbage.minutes === 0 && garbage.stats.points === 2, 'points without minutes counts as played');
const pod = pg.rows.find((r) => r.player_id === '4433' && r.game_id === '401900002');
ok(pod.home === false && pod.opponent === 'lal' && pod.stats.pra === 36 && pod.stats.threes === 3, 'home flag, opponent, PRA and threes');
eq(pg.people.find((p) => p.player_id === '3975').name, 'Stephen Curry', 'names come from the box scores');
const exhibition = normalizeNbaPlayerGames(parseCsv(BOX_2026), new Map(g25.games.map((g) => [g.game_id, g])));
ok(!exhibition.rows.some((r) => r.player_id === '9999'), 'All-Star rows are skipped');

// --- adapter 2 fixes (2026-11-11) -------------------------------------------------
// A blank athlete id is filled from the one player on that team with that
// short name; a placeholder row is skipped; a did-not-play copy on a date
// the player played another game is dropped; an unknown short name is
// counted, not guessed.
const HEAD2 = 'game_id,athlete_id,athlete_display_name,athlete_short_name,team_abbreviation,opponent_team_abbreviation,home_away,minutes,points,rebounds,assists,did_not_play,reason,starter,athlete_position_abbreviation';
const otherGame = { sport: 'nba', game_id: '401900009', season: 2026, season_type: 'REG', local_date: '2026-10-30', start_utc: '2026-10-31T00:00:00.000Z', home_team: 'mia', away_team: 'chi', status: 'final', home_score: 100, away_score: 90 };
const FIXED_CSV = ([HEAD2,
  '401900001,3975,Stephen Curry,S. Curry,GS,POR,home,33,27,6,5,false,,true,G',
  '401900002,4433,Brandin Podziemski,B. Podziemski,GS,LAL,away,35,21,9,6,false,,true,G',
  '401900001,,,B. Podziemski,GS,POR,home,,0,0,0,false,COACH\'S DECISION,false,G',
  '401900001,,TEAM,,GS,POR,home,240,115,40,25,false,,false,',
  '401900001,,,X. Nobody,GS,POR,home,,0,0,0,false,,false,G',
  '401900009,3975,Stephen Curry,S. Curry,CHI,MIA,away,,,,,true,NOT WITH TEAM,false,G',
].join('\n'));
// Game 401900001 adds up here (27 = Curry's 27), so the blank row is a did-not-play.
const evenById = new Map([...byId, ['401900001', { ...byId.get('401900001'), home_score: 27 }], [otherGame.game_id, otherGame]]);
const fixed = normalizeNbaPlayerGames(parseCsv(FIXED_CSV), evenById);
eq(fixed.fixes, { ids_filled: 1, ids_unresolved: 1, duplicate_dnp_dropped: 1, unknown_rows_dropped: 0 }, 'blank ids filled or counted, duplicate did-not-play copy dropped');
// The same blank row when the box falls short of the final (the real Olbrich
// rows carried a "coach's decision" reason): unknown, dropped, counted.
const short = normalizeNbaPlayerGames(parseCsv(FIXED_CSV), new Map([...byId, [otherGame.game_id, otherGame]]));
ok(short.fixes.unknown_rows_dropped === 1 && !short.rows.some((r) => r.player_id === '4433' && r.game_id === '401900001'), 'a blank row in a short box is unknown even with a reason');
const filledRow = fixed.rows.find((r) => r.player_id === '4433' && r.game_id === '401900001');
ok(filledRow && filledRow.played === false && filledRow.stats.points === null, 'the filled row keeps its did-not-play state (no minutes, no stat)');
ok(!fixed.rows.some((r) => r.game_id === '401900009'), 'the duplicate copy is gone');
eq(fixed.rows.length, 3);
// Box-score points against the final score (every finished game).
const bx = boxScoreCheck(g26.games, pg.rows);
eq([bx.games_checked, bx.mismatched], [2, 2], 'the fixture box scores are partial, so both finals are flagged');
const fullBox = boxScoreCheck([{ game_id: 'a', status: 'final', home_team: 'gs', away_team: 'por', home_score: 10, away_score: 4, local_date: '2026-10-30' }],
  [{ game_id: 'a', team: 'gs', played: true, stats: { points: 6 } }, { game_id: 'a', team: 'gs', played: true, stats: { points: 4 } }, { game_id: 'a', team: 'por', played: true, stats: { points: 4 } }, { game_id: 'a', team: 'por', played: false, stats: { points: null } }]);
eq([fullBox.games_checked, fullBox.mismatched], [1, 0], 'box scores that add up pass');
// NBA.com second source (offline: made-up NBA.com JSON).
eq([nbaComTricode('gs'), nbaComTricode('ny'), nbaComTricode('utah'), nbaComTricode('lal')], ['GSW', 'NYK', 'UTA', 'LAL']);
const NBA_SCHED = { leagueSchedule: { gameDates: [{ games: [
  { gameId: '0022600011', gameStatus: 3, gameCode: '20261101/GSWLAL', homeTeam: { teamTricode: 'LAL', score: 108 }, awayTeam: { teamTricode: 'GSW', score: 112 } },
  { gameId: '0022600012', gameStatus: 1, gameCode: '20261102/PHXGSW', homeTeam: { teamTricode: 'GSW', score: 0 }, awayTeam: { teamTricode: 'PHX', score: 0 } },
] }] } };
eq(parseNbaComSchedule(NBA_SCHED), [{ game_id: '0022600011', date: '2026-11-01', home: 'LAL', away: 'GSW', home_score: 108, away_score: 112 }], 'only finished games');
eq(parseNbaComSchedule({ nope: 1 }), null, 'an unknown shape is null');
const NBA_BOX = { game: {
  homeTeam: { teamTricode: 'LAL', players: [{ name: 'LeBron James', played: '1', statistics: { points: 30, reboundsTotal: 8, assists: 11, minutes: 'PT37M00.00S' } }] },
  awayTeam: { teamTricode: 'GSW', players: [
    { name: 'Brandin Podziemski', played: '1', statistics: { points: 20, reboundsTotal: 9, assists: 6, minutes: 'PT35M00.00S' } },
    { name: 'Garbage Time', played: '1', statistics: { points: 2, reboundsTotal: 1, assists: 0, minutes: 'PT01M10.00S' } },
    { name: 'Lost Line', played: '1', statistics: { points: 9, reboundsTotal: 2, assists: 1, minutes: 'PT12M00.00S' } },
    { name: 'Stephen Curry', played: '0', statistics: { points: 0 } },
  ] } } };
eq(parseNbaComBox(NBA_BOX).GSW[0], { name: 'Brandin Podziemski', played: true, points: 20, rebounds: 9, assists: 6, minutes: 35 });
const people27 = pg.people;
const comFetch = async (u) => (u === NBA_COM_URLS.schedule ? JSON.stringify(NBA_SCHED) : u === NBA_COM_URLS.box('0022600011') ? JSON.stringify(NBA_BOX) : null);
const com = await nbaComCheck(comFetch, { games: g26.games, rows: pg.rows, players: people27 });
eq([com.state, com.date, com.games_checked, com.mismatched, com.players_checked, com.players_mismatched, com.players_missing], ['ok', '2026-11-01', 1, 0, 3, 1, 1],
  'the latest game day: scores agree, one player line differs (21 vs 20 points), one NBA.com player has no line here');
ok(com.examples.some((e) => e.what === 'points' && e.player_id === '4433') && com.examples.some((e) => e.what === 'missing player' && e.name === 'Lost Line'), 'the private examples name what differs');
eq((await nbaComCheck(async () => null, { games: g26.games, rows: pg.rows, players: people27 })).state, 'unavailable', 'NBA.com down is a state, never a failure');
eq((await nbaComCheck(async () => '{"x":1}', { games: g26.games, rows: pg.rows, players: people27 })).state, 'unrecognized');

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
eq(run.status.adapter_version, 2);
ok(run.status.integrity?.seasons?.[2026]?.box_games_checked === 2 && run.status.integrity.seasons[2026].box_points_off === 2, 'box-score checks per season in the status');
eq(run.status.integrity.second_source.state, 'unavailable', 'NBA.com unreachable offline');
ok(run.status.integrity.warnings.some((w) => /box-score points do not add up/.test(w)), 'a box-score gap is a warning');
const line = integrityLine(run.status.integrity);
ok(/box_points_off=2/.test(line) && !/401900/.test(line) && !/Curry/.test(line), 'the public log line has counts only: ' + line);
ok(JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/player-games/2025.json')).complete === true, 'a past season with a postponed game still finishes');
const players = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/players.json')).players;
eq(players.map((p) => p.name).sort(), ['Brandin Podziemski', 'Garbage Time', 'LeBron James', 'Stephen Curry'], 'players come from both seasons (one whose only line was unknown has no games)');
eq(run.status.integrity.seasons[2026].unknown_rows_dropped, 1, 'unknown lines are counted in the status');
fetched.length = 0;
const run2 = await ingestLeague({ adapter: NBA_SOURCE, store: st, fetchText, now: NOW + 86400000 });
ok(!fetched.includes(HOOPR_URLS.box(2025)), 'the finished season is not downloaded again');
ok(!run2.status.integrity.warnings.some((w) => /^2025:/.test(w)) && run2.status.integrity.warnings.some((w) => /^2026:/.test(w)), 'the box-score check runs on seasons read this run, not on a finished season kept as stored');
ok(JSON.parse(st.objects.get(SPORTS_PREFIX + 'nba/players.json')).players.some((p) => p.name === 'LeBron James'), 'names from a season not re-read are kept');
const status = await sportsStatus({ store: st, now: NOW });
eq(status.sources.nba.latest_game_date, '2026-11-01', 'the status route passes the latest game date');
eq(status.sources.nba.provider, 'hoopR (ESPN box scores)');

// --- read views ----------------------------------------------------------------
const load = recordLoader(st);
const board = await buildBoard({ load, sport: 'nba', nowMs: NOW, tz: 'America/Los_Angeles' });
eq(board.games.map((g) => [g.game_id, g.day, `${g.away_team}@${g.home_team}`]), [['401900003', 'today', 'phx@gs'], ['401900004', 'tomorrow', 'lal@phx']], '7 pm Pacific is today, the next night tomorrow');
eq(board.next_game.game_id, '401900005');
ok(!board.games.some((g) => g.game_lines), 'no archived spread yet: no line on the board');
st.objects.set(SPORTS_PREFIX + 'nba/lines/2026-11-02.json', JSON.stringify({ schema_version: 1, sport: 'nba', date: '2026-11-02', lines: [], games: { '401900003': [226.5, -4.5, '2026-11-02T20:00:00Z'] } }));
const boardL = await buildBoard({ load: recordLoader(st), sport: 'nba', nowMs: NOW, tz: 'America/Los_Angeles' });
eq([boardL.games[0].game_lines?.total, boardL.games[0].game_lines?.favorite, boardL.games[0].game_lines?.source], [226.5, 'phx', 'sportsbooks'], 'the archived sportsbook spread and total reach the board');
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

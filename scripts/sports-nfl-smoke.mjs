// NFL data for the Owner Sports section: the CSV reader, the nflverse
// adapter, the daily ingest (store writes, guards, failure handling) and the
// read views behind the NFL page. Offline: fixture CSV only, fake store.
//   node scripts/sports-nfl-smoke.mjs
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/sports/csv.mjs';
import { normalizeNflGames, normalizeNflPlayerGames, normalizeNflPlayers, NFLVERSE_URLS, nflGameId } from '../lib/sports/nflverse.mjs';
import { ingestNfl } from '../lib/sports/ingest-nfl.mjs';
import { buildBoard, buildGame, searchPlayers, buildPlayerLog, summarizeStat, foldName } from '../lib/sports/read.mjs';
import { handleSportsRequest, recordLoader } from '../lib/sports/http.mjs';
import { zonedTimeUtc, seasonFor } from '../lib/sports/time.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { GAMES, WEEK_HEAD, WEEK_2025, WEEK_2026, PLAYERS, wk } from './fixtures/sports-nfl.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// --- time ------------------------------------------------------------------------
eq(new Date(zonedTimeUtc('2026-10-25', '13:00', 'America/New_York')).toISOString(), '2026-10-25T17:00:00.000Z', '1 pm Eastern in daylight time');
eq(new Date(zonedTimeUtc('2026-11-01', '13:00', 'America/New_York')).toISOString(), '2026-11-01T18:00:00.000Z', '1 pm Eastern after the clocks change');
eq(new Date(zonedTimeUtc('2026-11-02', '20:15', 'America/New_York')).toISOString(), '2026-11-03T01:15:00.000Z', 'a Monday night kickoff is the next UTC day');
assert.throws(() => zonedTimeUtc('2026-11-02', '25:00', 'America/New_York')); checks++;
eq([seasonFor('nfl', '2026-09-10'), seasonFor('nfl', '2027-02-07'), seasonFor('nfl', '2027-03-01')], [2026, 2026, 2027], 'NFL seasons are labeled by their start year');
eq([seasonFor('nba', '2026-10-20'), seasonFor('nba', '2027-06-10'), seasonFor('nba', '2027-08-01')], [2026, 2026, 2027], 'NBA seasons are labeled by their start year');

// --- CSV -------------------------------------------------------------------------
const csv = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"line\nbreak",\n\n');
eq(csv, [{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: 'line\nbreak', c: '' }], 'quoted commas, quotes, newlines and a BOM');
assert.throws(() => parseCsv('a\n"open'), /quoted/); checks++;
assert.throws(() => parseCsv('a\n1\n2\n3', { maxRows: 2 }), /too many rows/); checks++;

// --- fixtures (scripts/fixtures/sports-nfl.mjs) ------------------------------

// --- adapter -------------------------------------------------------------------
const { games, rejected: badGames } = normalizeNflGames(parseCsv(GAMES), { seasons: [2025, 2026] });
eq(badGames, [], 'every fixture game is valid');
eq(games.length, 7, 'both seasons of games');
const g8 = games.find((g) => g.game_id === '2026_08_kc_den');
ok(g8 && g8.status === 'final' && g8.home_score === 24 && g8.away_score === 28 && g8.home_team === 'den', 'a scored game is final with lowercase teams');
eq(g8.start_utc, '2026-11-01T21:25:00.000Z', 'kickoff converts from Eastern');
ok(games.every((g) => !Object.keys(g).some((k) => /spread|moneyline|total_line|odds/.test(k))), 'sportsbook lines in the schedule are dropped');
ok(!JSON.stringify(games).includes('-150') && !JSON.stringify(games).includes('44.5'), 'no line values leak into stored games');
eq(games.find((g) => g.game_id === '2025_22_kc_phi').season_type, 'POST', 'the Super Bowl is a playoff game');
eq(games.find((g) => g.game_id === '2025_22_kc_phi').venue, 'Caesars, Superdome', 'quoted venue survives');
const tbd = games.find((g) => g.game_id === '2026_10_sea_la');
ok(tbd.time_tbd && tbd.status === 'scheduled', 'a game without a time is flagged as TBD');
eq(nflGameId('2026_08_KC_DEN'), '2026_08_kc_den');

const byId = new Map(games.filter((g) => g.season === 2026).map((g) => [g.game_id, g]));
const pg = normalizeNflPlayerGames(parseCsv(WEEK_2026), byId);
eq(pg.rows.length, 5, 'offense rows kept, kicker skipped, bad row rejected');
eq(pg.rejected.length, 1, 'catches above targets are rejected');
const recovered = pg.rows.find((r) => r.player_id === '00-0001' && r.week === 8);
eq(recovered?.game_id, '2026_08_chi_sea', 'a missing game id is recovered from the schedule');
const jsn = pg.rows.find((r) => r.player_id === '00-0002');
ok(jsn.home === true && jsn.opponent === 'chi' && jsn.stats.touchdowns === 1 && jsn.date === '2026-10-25', 'home flag, opponent, touchdowns and local date');
const players = normalizeNflPlayers(parseCsv(PLAYERS), { keepIds: new Set(pg.rows.map((r) => r.player_id)), season: 2026 });
eq(players.map((p) => p.player_id).sort(), ['00-0001', '00-0002', '00-0003', '00-0006', '00-0007'], 'players in logs plus active offensive players');
ok(!players.some((p) => p.player_id === '00-0008'), 'retired linemen are not stored');

// --- ingest --------------------------------------------------------------------
function memStore() {
  const objects = new Map(), order = [];
  return {
    objects, order, backend: 'mem',
    rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
    rawPut: async (k, v) => { objects.set(k, String(v)); order.push(k); },
  };
}
const files = new Map([
  [NFLVERSE_URLS.games, GAMES], [NFLVERSE_URLS.players, PLAYERS],
  [NFLVERSE_URLS.weekly(2025), WEEK_2025], [NFLVERSE_URLS.weekly(2026), WEEK_2026],
]);
const fetched = [];
const fetchText = async (url) => { fetched.push(url); return files.has(url) ? files.get(url) : null; };
const NOW = Date.parse('2026-11-02T18:00:00Z');
const st = memStore();
const run1 = await ingestNfl({ store: st, fetchText, now: NOW });
eq(run1.status.state, 'degraded', 'a rejected row marks the run as partly updated');
ok(/failed validation/.test(run1.status.message), 'the status says why');
eq(run1.status.seasons, [2025, 2026], 'two seasons stored');
eq(st.order.at(-1), SPORTS_PREFIX + 'status/nfl.json', 'status is written last');
ok(st.order.every((k) => k.startsWith(SPORTS_PREFIX)), 'every write stays under the Sports prefix');
const stored2025 = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/player-games/2025.json'));
ok(stored2025.complete === true && stored2025.rows.length === 2, 'a finished season is marked complete');
const stored2026 = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json'));
ok(stored2026.rows.length === 4 && !stored2026.rows.some((r) => r.game_id === '2026_08_chi_sea'), 'a row for a game that is not final yet waits for the next run');
fetched.length = 0;
const st2 = st; // second run on the same store
await ingestNfl({ store: st2, fetchText, now: NOW + 86400000 });
ok(!fetched.includes(NFLVERSE_URLS.weekly(2025)), 'a finished season is not downloaded again');
ok(fetched.includes(NFLVERSE_URLS.weekly(2026)), 'the current season refreshes every run');

// shrink guard: the current season loses most rows upstream
const big = memStore();
const many = [WEEK_HEAD, ...Array.from({ length: 60 }, (_, i) => wk('00-1' + String(i).padStart(3, '0'), 'WR', 'WR', 2026, 7, '2026_07_CHI_SEA', 'SEA', 'CHI', { rec: 1, tgt: 2 }))].join('\n');
await ingestNfl({ store: big, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? many : fetchText(u)), now: NOW });
const goodCount = JSON.parse(big.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json')).rows.length;
await assert.rejects(ingestNfl({ store: big, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? WEEK_HEAD + '\n' : fetchText(u)), now: NOW }), /shrank/); checks++;
eq(JSON.parse(big.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json')).rows.length, goodCount, 'a shrunken upstream file never replaces stored rows');
const failedStatus = JSON.parse(big.objects.get(SPORTS_PREFIX + 'status/nfl.json'));
ok(failedStatus.state === 'failed' && failedStatus.last_success_utc && failedStatus.counts, 'a failed run keeps the last good time and counts');

// upstream outage and off-season
const down = memStore();
await assert.rejects(ingestNfl({ store: down, fetchText: async () => null, now: NOW }), /schedule file/); checks++;
eq([...down.objects.keys()], [SPORTS_PREFIX + 'status/nfl.json'], 'an outage writes only the failed status');
const early = memStore();
const r3 = await ingestNfl({ store: early, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? null : fetchText(u)), now: NOW });
ok(/no 2026 player stats published yet/.test(r3.status.message), 'no current-season file yet is a note, not a failure');
const dry = memStore();
await ingestNfl({ store: dry, fetchText, now: NOW, dryRun: true });
eq(dry.objects.size, 0, 'a dry run writes nothing');

// --- read views ----------------------------------------------------------------
const load = recordLoader(st);
const board = await buildBoard({ load, sport: 'nfl', nowMs: NOW, tz: 'America/Los_Angeles' });
eq(board.games.map((g) => [g.game_id, g.day]), [['2026_08_chi_sea', 'today']], 'Monday night is today in Los Angeles');
eq(board.next_game?.game_id, '2026_09_den_kc', 'the next game after the window');
const lateNight = await buildBoard({ load, sport: 'nfl', nowMs: Date.parse('2026-11-01T23:00:00Z'), tz: 'America/New_York' });
eq(lateNight.games.map((g) => [g.game_id, g.day]), [['2026_08_kc_den', 'today'], ['2026_08_chi_sea', 'tomorrow']], 'from Sunday evening the Sunday game is today and Monday night is tomorrow');
ok(!JSON.stringify(board).includes('provider_ids'), 'the board sends only what the page shows');

const game = await buildGame({ load, sport: 'nfl', gameId: '2026_08_chi_sea', seasons: [2025, 2026] });
eq(Object.keys(game.teams), ['chi', 'sea'], 'away team first');
eq(game.teams.sea.players.map((p) => p.player_id), ['00-0001', '00-0002'], 'passers first, then receivers');
eq(game.teams.sea.players[0].main_stat, 'passing_yards');
eq(await buildGame({ load, sport: 'nfl', gameId: '2026_99_xxx_yyy', seasons: [2026] }), null, 'unknown game');

eq((await searchPlayers({ load, sport: 'nfl', query: 'smith' })).players.map((p) => p.name), ['Geno Smíth', 'Jaxon Smith-Njigba'], 'search folds accents and hyphens');
eq((await searchPlayers({ load, sport: 'nfl', query: 'pat mah' })).players.length, 1, 'search matches every word prefix');
eq((await searchPlayers({ load, sport: 'nfl', query: 'p' })).players, [], 'one letter returns nothing');
eq(foldName('  Ja’Marr  Chase '), 'ja marr chase');

const log = await buildPlayerLog({ load, sport: 'nfl', playerId: '00-0006', seasons: [2025, 2026] });
eq(log.games.map((g) => g.date), ['2026-11-01', '2026-02-08', '2025-09-07'], 'game log is newest first across seasons');
eq(log.summaries.passing_yards, { games: 3, last5: 246.7, last10: 246.7, average: 246.7, median: 240, low: 199, high: 301 }, 'plain averages, median, low and high');
eq(log.games[1].season_type, 'POST');
eq(await buildPlayerLog({ load, sport: 'nfl', playerId: '00-9999', seasons: [2026] }), null, 'unknown player');
eq(summarizeStat([{ played: false, stats: { points: null } }, { played: true, stats: { points: 10 } }], 'points').games, 1, 'did-not-play rows are left out, not zero');

// --- route ---------------------------------------------------------------------
function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const deps = (session = { sub: 'o', tr: true, tp: true }) => ({ env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => session, store: st, now: () => NOW });
async function call(query, d = deps()) {
  const res = fakeRes();
  await handleSportsRequest({ method: 'GET', headers: {}, query }, res, d);
  return res;
}
let res = await call({ sports: 'board', sport: 'nfl', tz: 'America/Los_Angeles' });
ok(res.statusCode === 200 && res.body.games.length === 1 && res.headers['cache-control'] === 'private, no-store', 'board through the route');
eq((await call({ sports: 'board' })).statusCode, 400, 'a league view needs a sport');
eq((await call({ sports: 'board', sport: 'mlb' })).statusCode, 400, 'only NBA and NFL');
eq((await call({ sports: 'player', sport: 'nfl', id: '../status' })).statusCode, 400, 'ids are checked');
eq((await call({ sports: 'player', sport: 'nfl', id: '00-9999' })).statusCode, 404, 'unknown player is 404');
eq((await call({ sports: 'player', sport: 'nfl', id: '00-0006' })).body.total_games, 3, 'player log through the route');
eq((await call({ sports: 'game', sport: 'nfl', id: '2026_08_CHI_SEA' })).body.game.game_id, '2026_08_chi_sea', 'game ids are case-insensitive');
eq((await call({ sports: 'players', sport: 'nfl', q: 'kelce' })).body.players[0].name, 'Travis Kelce', 'search through the route');
eq((await call({ sports: 'board', sport: 'nfl' }, deps({ sub: 'm', tr: false, tp: false }))).statusCode, 403, 'members never reach league views');
const brokenStore = { rawGet: async () => Buffer.from('{not json'), backend: 'mem' };
const quiet = console.error; console.error = () => {};
try { eq((await call({ sports: 'board', sport: 'nfl' }, { ...deps(), store: brokenStore })).statusCode, 502, 'a broken record is a 502, not a crash'); }
finally { console.error = quiet; }

console.log(`Sports NFL smoke passed (${checks} checks).`);

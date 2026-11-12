// NFL data for the Owner Sports section: the CSV reader, the nflverse
// adapter, the daily ingest (store writes, guards, failure handling) and the
// read views behind the NFL page. Offline: fixture CSV only, fake store.
//   node scripts/sports-nfl-smoke.mjs
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/sports/csv.mjs';
import { normalizeNflGames, normalizeNflPlayerGames, normalizeNflPlayers, normalizeNflSnaps, normalizeNflInjuries, pfrIndex, NFLVERSE_URLS, NFL_SOURCE, nflGameId } from '../lib/sports/nflverse.mjs';
import { availabilityFor, officialNflReport, nflRosterStatus } from '../lib/sports/book-price.mjs';
import { gameEnvironment, gameLinesView } from '../lib/sports/models.mjs';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { buildBoard, buildGame, searchPlayers, buildPlayerLog, summarizeStat, foldName } from '../lib/sports/read.mjs';
import { handleSportsRequest, recordLoader } from '../lib/sports/http.mjs';
import { zonedTimeUtc, seasonFor } from '../lib/sports/time.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { GAMES, WEEK_HEAD, WEEK_2025, WEEK_2026, PLAYERS, SNAPS_2026, INJURIES_2026, wk } from './fixtures/sports-nfl.mjs';

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
ok(games.every((g) => !Object.keys(g).some((k) => /spread|moneyline|total_line|odds/.test(k))), 'raw sportsbook columns in the schedule are dropped');
// Since 2026-11-12 (team bets) the prices ride inside `lines.prices` only,
// for the team game model's book comparison.
ok(games.every((g) => !JSON.stringify({ ...g, lines: null }).includes('-150') && !JSON.stringify({ ...g, lines: null }).includes('-110')), 'no moneyline or price outside lines.prices');
eq(games.find((g) => g.game_id === '2026_08_kc_den').lines, { total: 44.5, home_margin: 3.5, source: 'nflverse', prices: { home_ml: 130, away_ml: -150, home_spread: -110, away_spread: -110, over: -110, under: -110 } }, 'the spread and total are kept (adapter 2): home favored by 3.5; prices since 2026-11-12');
eq(games.find((g) => g.game_id === '2026_08_kc_den').rest_days, { home: 7, away: 7 }, 'rest days from the schedule');
eq(gameEnvironment(games.find((g) => g.game_id === '2026_08_kc_den'), 'den'), { total: 44.5, team_margin: 3.5, team_total: 24, source: 'nflverse' }, 'the favorite\'s implied total is (total + margin) / 2');
eq(gameEnvironment(games.find((g) => g.game_id === '2026_08_kc_den'), 'kc').team_total, 20.5, 'and the underdog\'s (total - margin) / 2');
eq(gameLinesView(games.find((g) => g.game_id === '2026_08_kc_den')).favorite, 'den', 'the game view names the favorite');
eq(gameEnvironment(games.find((g) => g.game_id === '2026_08_kc_den'), 'sea'), null, 'a team not in the game gets nothing');
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
// Snap counts (adapter 2): snaps on stat rows, an all-zero row for a player
// who took offensive snaps with no stat, unmatched PFR ids counted.
const snaps = normalizeNflSnaps(parseCsv(SNAPS_2026), pfrIndex(parseCsv(PLAYERS)));
eq(snaps.unmapped, 1, 'a snap row with no players.csv match is counted');
eq(snaps.byKey.size, 4, 'linemen are not read; a zero-snap row is kept but adds nothing');
const withSnaps = normalizeNflPlayerGames(parseCsv(WEEK_2026), byId, snaps);
const kelce = withSnaps.rows.find((r) => r.player_id === '00-0003');
ok(kelce.snaps === 50 && kelce.snap_pct === 0.8 && kelce.stats.receptions === 7, 'snaps join the stat row');
const rookie = withSnaps.rows.find((r) => r.player_id === '00-0007');
ok(rookie && rookie.played === true && rookie.source === 'snaps' && rookie.snaps === 12 && rookie.stats.receiving_yards === 0 && rookie.stats.receptions === 0 && rookie.team === 'kc' && rookie.opponent === 'den',
  'a player with offensive snaps and no stat line gets a played all-zero row');
eq(withSnaps.zero, { added: 1, unmapped: 1 }, 'the zero rows and unmatched snap rows are counted');
ok(!withSnaps.rows.some((r) => r.player_id === '00-0002' && r.week === 7 && r.source === 'snaps'), 'special-teams-only snaps add no row');
eq(withSnaps.rows.length, pg.rows.length + 1, 'only the one zero row is added');
// The official injury report: the newest week in the file, one entry per player.
const report = normalizeNflInjuries(parseCsv(INJURIES_2026), { season: 2026 });
eq(report.week, 9, 'the newest week');
eq(report.reports.map((r) => [r.player_id, r.game_status]), [['00-0001', null], ['00-0002', 'Out']], 'older weeks are left out; a blank status is no designation');
eq(report.reports[1].practice, 'Did Not Participate In Practice');
const jsnPlayer = { player_id: '00-0002', name: 'Jaxon Smith-Njigba', status: 'ACT' };
const off = officialNflReport({ ...report, source: 'nflverse' }, jsnPlayer, 'sea', 9);
ok(off.state === 'ok' && off.game_status === 'Out' && off.injury === 'Hamstring', 'the official report for this week');
eq(officialNflReport({ ...report }, jsnPlayer, 'sea', 10).state, 'not_yet', 'a report for an earlier week is not this game\'s');
const av = availabilityFor(jsnPlayer, 'sea', { state: 'ok', reports: [] }, 'nfl', { record: report, week: 9 });
ok(av.out === true && av.status === 'not listed' && av.official.game_status === 'Out', 'Out on the official report marks the player out even when ESPN has not listed him');
const avIr = availabilityFor({ player_id: 'x', name: 'X', status: 'RES' }, 'sea', { state: 'unavailable', reports: [] }, 'nfl', null);
ok(avIr.out === true && avIr.roster_status.label === 'injured reserve', 'a player on injured reserve is out even without a report');
eq(nflRosterStatus({ status: 'DEV' }).label, 'practice squad');
// Audit fixes (2026-11-11): a team that has filed nothing yet is not "not
// listed"; a filed team without the player is; a listed player with no game
// status yet has listed true and no status.
eq(officialNflReport(report, { player_id: '00-0009' }, 'lv', 9).state, 'not_yet', 'a team with no filing yet this week is not_yet, not "not listed"');
const notOn = officialNflReport(report, { player_id: '00-0009' }, 'sea', 9);
ok(notOn.state === 'ok' && notOn.listed === false && notOn.game_status === 'not listed' && notOn.teammates_out.includes('Jaxon Smith-Njigba'), 'a filed team without the player: not listed, with teammates out');
const geno = officialNflReport(report, { player_id: '00-0001' }, 'sea', 9);
ok(geno.listed === true && geno.game_status === null && !geno.teammates_out.includes('Geno Smith'), 'listed with no game status yet');
const avDev = availabilityFor({ player_id: 'y', name: 'Y', status: 'DEV' }, 'sea', { state: 'ok', reports: [] }, 'nfl', null);
ok(avDev.out === false && avDev.unsure === true && avDev.roster_status.code === 'DEV', 'a practice-squad player is unsure (he plays only if elevated), not out');

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
  [NFLVERSE_URLS.snaps(2026), SNAPS_2026], [NFLVERSE_URLS.injuries(2026), INJURIES_2026],
]);
const fetched = [];
const fetchText = async (url) => { fetched.push(url); return files.has(url) ? files.get(url) : null; };
const NOW = Date.parse('2026-11-02T18:00:00Z');
const st = memStore();
const run1 = await ingestLeague({ adapter: NFL_SOURCE,  store: st, fetchText, now: NOW });
eq(run1.status.state, 'degraded', 'a rejected row marks the run as partly updated');
ok(/failed validation/.test(run1.status.message), 'the status says why');
eq(run1.status.seasons, [2025, 2026], 'two seasons stored');
eq(st.order.at(-1), SPORTS_PREFIX + 'status/nfl.json', 'status is written last');
ok(st.order.every((k) => k.startsWith(SPORTS_PREFIX)), 'every write stays under the Sports prefix');
const stored2025 = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/player-games/2025.json'));
ok(stored2025.complete === true && stored2025.rows.length === 2, 'a finished season is marked complete');
const stored2026 = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json'));
ok(stored2026.rows.length === 5 && !stored2026.rows.some((r) => r.game_id === '2026_08_chi_sea'), 'a row for a game that is not final yet waits for the next run (four stat rows and one zero row)');
ok(stored2026.columns.includes('snaps') && stored2026.columns.includes('source'), 'the snap columns are packed when present');
ok(!JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/player-games/2025.json')).columns.includes('snaps'), 'and left out when a season has none');
const storedReport = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/injuries.json'));
ok(storedReport.week === 9 && storedReport.reports.length === 2 && storedReport.season === 2026, 'the official injury report is stored');
ok(run1.status.integrity?.seasons?.[2026]?.zero_stat_games_added === 1 && run1.status.integrity.seasons[2026].snap_rows_unmatched === 1, 'integrity counts in the status');
eq(run1.status.integrity.injury_report, { week: 9, players: 2 }, 'and the injury report week');
ok(run1.status.integrity.seasons[2025].snap_counts === false && /snap counts unavailable/.test(run1.status.message), 'a season with no snap file says so');
eq(run1.status.adapter_version, 2);
fetched.length = 0;
const st2 = st; // second run on the same store
await ingestLeague({ adapter: NFL_SOURCE,  store: st2, fetchText, now: NOW + 86400000 });
ok(!fetched.includes(NFLVERSE_URLS.weekly(2025)), 'a finished season is not downloaded again');
ok(fetched.includes(NFLVERSE_URLS.weekly(2026)), 'the current season refreshes every run');

// shrink guard: the current season loses most rows upstream
const big = memStore();
const many = [WEEK_HEAD, ...Array.from({ length: 60 }, (_, i) => wk('00-1' + String(i).padStart(3, '0'), 'WR', 'WR', 2026, 7, '2026_07_CHI_SEA', 'SEA', 'CHI', { rec: 1, tgt: 2 }))].join('\n');
await ingestLeague({ adapter: NFL_SOURCE,  store: big, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? many : fetchText(u)), now: NOW });
const goodCount = JSON.parse(big.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json')).rows.length;
await assert.rejects(ingestLeague({ adapter: NFL_SOURCE,  store: big, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? WEEK_HEAD + '\n' : fetchText(u)), now: NOW }), /shrank/); checks++;
eq(JSON.parse(big.objects.get(SPORTS_PREFIX + 'nfl/player-games/2026.json')).rows.length, goodCount, 'a shrunken upstream file never replaces stored rows');
const failedStatus = JSON.parse(big.objects.get(SPORTS_PREFIX + 'status/nfl.json'));
ok(failedStatus.state === 'failed' && failedStatus.last_success_utc && failedStatus.counts, 'a failed run keeps the last good time and counts');

// upstream outage and off-season
const down = memStore();
await assert.rejects(ingestLeague({ adapter: NFL_SOURCE,  store: down, fetchText: async () => null, now: NOW }), /schedule file/); checks++;
eq([...down.objects.keys()], [SPORTS_PREFIX + 'status/nfl.json'], 'an outage writes only the failed status');
const early = memStore();
const r3 = await ingestLeague({ adapter: NFL_SOURCE,  store: early, fetchText: async (u) => (u === NFLVERSE_URLS.weekly(2026) ? null : fetchText(u)), now: NOW });
ok(/no 2026 player stats published yet/.test(r3.status.message), 'no current-season file yet is a note, not a failure');
const dry = memStore();
await ingestLeague({ adapter: NFL_SOURCE,  store: dry, fetchText, now: NOW, dryRun: true });
eq(dry.objects.size, 0, 'a dry run writes nothing');

// --- read views ----------------------------------------------------------------
const load = recordLoader(st);
const board = await buildBoard({ load, sport: 'nfl', nowMs: NOW, tz: 'America/Los_Angeles' });
eq(board.games.map((g) => [g.game_id, g.day]), [['2026_08_chi_sea', 'today']], 'Monday night is today in Los Angeles');
eq(board.next_game?.game_id, '2026_09_den_kc', 'the next game after the window');
eq([board.games[0].game_lines?.total, board.games[0].game_lines?.favorite, board.games[0].game_lines?.home_team_total], [44.5, 'sea', 24], 'board rows carry the schedule spread and total');
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

const rookieLog = await buildPlayerLog({ load, sport: 'nfl', playerId: '00-0007', seasons: [2025, 2026] });
ok(rookieLog.games[0].zero_stat_game === true && rookieLog.games[0].snaps === 12 && rookieLog.games[0].snap_pct === 0.19, 'the log shows snaps and marks a zero-stat game');
eq(rookieLog.summaries.receiving_yards.games, 1, 'a zero-stat game counts as a played game with 0');
const log = await buildPlayerLog({ load, sport: 'nfl', playerId: '00-0006', seasons: [2025, 2026] });
eq(log.games.map((g) => g.date), ['2026-11-01', '2026-02-08', '2025-09-07'], 'game log is newest first across seasons');
eq(log.summaries.passing_yards, { games: 3, last5: 246.7, last10: 246.7, average: 246.7, median: 240, low: 199, high: 301 }, 'plain averages, median, low and high');
eq(log.games[1].season_type, 'POST');
eq(log.games.map((g) => [g.team_score, g.opp_score, g.line_margin, g.line_total]), [[28, 24, -3.5, 44.5], [20, 27, -3.5, 44.5], [17, 24, -3.5, 44.5]], 'each log row carries the team’s final score and its side of the spread (game script splits)');
{
  const U = (await buildPlayerLog({ load, sport: 'nfl', playerId: '00-0006', seasons: [2025, 2026], nowMs: NOW })).upcoming;
  eq(U.map((g) => [g.game_id, g.home, g.opponent, g.rest_days]), [['2026_09_den_kc', true, 'den', 7]], 'the player page lists the team’s next games');
  eq(U[0].lines, { team_margin: 3.5, total: 44.5, team_total: 24, source: 'nflverse' }, 'with the spread from the team’s side');
  eq([U[0].opponent_team.group, U[0].opponent_team.allowed.passing_yards, U[0].opponent_team.allowed_rank.passing_yards, U[0].opponent_team.teams], ['QB', 301, 2, 4], 'what the opponent allows to his position, ranked');
  eq([U[0].vs.games, U[0].vs.values.passing_yards], [1, 301], 'and his own games against them');
  ok(!('win_chance' in U[0]), 'no team model stored: no win chance');
}
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
// The player page reads the ESPN injury report; a fake one here (never the network).
const deps = (session = { sub: 'o', tr: true, tp: true }) => ({ env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => session, store: st, now: () => NOW,
  loadPropSources: async () => ({ injuries: { state: 'unavailable', reports: [] } }) });
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
// The older finished seasons the job keeps for the model add to the meetings
// (most NFL pairs do not meet every season); the player numbers stay on the
// two stored seasons.
eq((await call({ sports: 'game', sport: 'nfl', id: '2026_08_chi_sea' })).body.matchup.meetings.filter((m) => m.season < 2025).length, 0, 'no older meetings stored yet');
st.objects.set(SPORTS_PREFIX + 'nfl/games/2023.json', JSON.stringify({ schema_version: 1, sport: 'nfl', season: 2023, games: [
  { sport: 'nfl', game_id: '2023_05_sea_chi', season: 2023, week: 5, season_type: 'REG', start_utc: '2023-10-08T17:00:00Z', local_date: '2023-10-08', home_team: 'chi', away_team: 'sea', status: 'final', home_score: 20, away_score: 17 },
  { sport: 'nfl', game_id: '2023_06_kc_den', season: 2023, week: 6, season_type: 'REG', start_utc: '2023-10-12T00:15:00Z', local_date: '2023-10-11', home_team: 'den', away_team: 'kc', status: 'final', home_score: 8, away_score: 19 }] }));
const oldMeet = (await call({ sports: 'game', sport: 'nfl', id: '2026_08_chi_sea' })).body.matchup;
eq(oldMeet.meetings.filter((m) => m.season === 2023).map((m) => m.game_id), ['2023_05_sea_chi'], 'meetings reach into the older seasons kept for the model');
eq(oldMeet.meeting_summary.wins.chi >= 1, true, 'and count in the series record');
eq((await call({ sports: 'players', sport: 'nfl', q: 'kelce' })).body.players[0].name, 'Travis Kelce', 'search through the route');
eq((await call({ sports: 'board', sport: 'nfl' }, deps({ sub: 'm', tr: false, tp: false }))).statusCode, 403, 'members never reach league views');
const brokenStore = { rawGet: async () => Buffer.from('{not json'), backend: 'mem' };
const quiet = console.error; console.error = () => {};
try { eq((await call({ sports: 'board', sport: 'nfl' }, { ...deps(), store: brokenStore })).statusCode, 502, 'a broken record is a 502, not a crash'); }
finally { console.error = quiet; }

console.log(`Sports NFL smoke passed (${checks} checks).`);

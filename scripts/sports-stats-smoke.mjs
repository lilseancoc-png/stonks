// Player and team stats behind the Sports charts: whole-season player logs
// with rest days, the player leaderboard (season / last 10 / last 5), team
// records and what each team scores and allows (by position too), and the
// small per-player value lists in the game panel. Offline: the made-up league
// from the model tests and a fake store.
//   node scripts/sports-stats-smoke.mjs
import assert from 'node:assert/strict';
import { nbaModelLeague, SOFT_DEFENSE, TOUGH_DEFENSE } from './fixtures/sports-model.mjs';
import { packRows } from '../lib/sports/rows.mjs';
import { buildLeaders, buildTeams, buildPlayerLog, buildGame, CHART_LIMIT, LOG_LIMIT, LEADER_WINDOWS, POSITION_GROUPS, shownStats, contextStats, matchupView, teamTable, MEETINGS_LIMIT } from '../lib/sports/read.mjs';
import { statIds } from '../lib/sports/schema.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { positionGroup } from '../lib/sports/models.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const r1 = (x) => Math.round(x * 10) / 10;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// One season of the made-up league, plus a gap so rest days vary.
const L = nbaModelLeague({ days: 40 });
const players = L.players.map(({ minutes, pts, reb, ...p }) => p);
const recs = {
  [SPORTS_PREFIX + 'nba/player-games/2025.json']: { schema_version: 1, sport: 'nba', season: 2025, ...packRows(L.rows) },
  [SPORTS_PREFIX + 'nba/games/2025.json']: { schema_version: 1, sport: 'nba', season: 2025, games: L.games },
  [SPORTS_PREFIX + 'nba/players.json']: { schema_version: 1, sport: 'nba', players },
  [SPORTS_PREFIX + 'status/nba.json']: { schema_version: 1, state: 'ok', seasons: [2025, 2026] },
};
const loadKey = (key) => recs[key] ?? null;
const load = async (kind, opts = {}) => {
  const k = kind === 'players' ? 'nba/players.json' : kind === 'status' ? 'status/nba.json' : 'nba/' + kind + '/' + opts.season + '.json';
  return loadKey(SPORTS_PREFIX + k);
};

// --- leaderboard ----------------------------------------------------------------
eq(LEADER_WINDOWS, ['season', 'last10', 'last5']);
const season = await buildLeaders({ load, sport: 'nba', seasons: [2025, 2026] });
eq(season.season, 2025, 'an empty newer season falls back to the newest one with games');
eq(season.seasons, [2026, 2025], 'every stored season is offered');
eq(season.players.length, 96, 'every player who played');
eq(season.stats, shownStats('nba'), 'modeled and context stats');
eq(shownStats('nba').slice(0, 3), ['points', 'rebounds', 'minutes'], 'modeled stats first, then minutes');
eq(shownStats('nba').length, statIds('nba').length + 1, 'every catalog stat plus minutes');
eq(shownStats('nfl'), ['passing_yards', 'receptions', ...statIds('nfl').filter((s) => s !== 'passing_yards' && s !== 'receptions')], 'NFL has no minutes');
eq(contextStats('nba'), shownStats('nba').slice(2), 'context stats are the shown stats without a forecast');
eq(season.groups, POSITION_GROUPS.nba);
eq(season.teams.length, 12);
const p0 = season.players.find((p) => p.player_id === 'matl0');
const rows0 = L.rows.filter((r) => r.player_id === 'matl0').sort((a, b) => b.date.localeCompare(a.date));
const played0 = rows0.filter((r) => r.played);
eq(p0.games, played0.length, 'games played counts played games only');
eq(p0.missed, rows0.length - played0.length, 'missed games are counted separately');
eq(p0.values.points, r1(avg(played0.map((r) => r.stats.points))), 'season average of points');
eq(p0.values.minutes, r1(avg(played0.map((r) => r.minutes))), 'minutes come from the minutes field');
eq(p0.values.assists, null, 'a stat the rows never carry is empty, not zero');
eq(p0.values.pts_reb, r1(avg(played0.map((r) => r.stats.points + r.stats.rebounds))), 'combos average the per-game sums');
eq(p0.values.pra, null, 'a combo with a part the rows never carry is empty');
eq(p0.group, 'G');
const last5 = await buildLeaders({ load, sport: 'nba', seasons: [2025], window: 'last5' });
const q0 = last5.players.find((p) => p.player_id === 'matl0');
eq(q0.values.points, r1(avg(played0.slice(0, 5).map((r) => r.stats.points))), 'last 5 uses each player’s five latest played games');
ok(q0.window_games === 5 && q0.games === p0.games, 'the window does not change games played');
eq((await buildLeaders({ load, sport: 'nba', seasons: [2025], window: 'nonsense' })).window, 'season', 'an unknown window reads as the season');
eq((await buildLeaders({ load, sport: 'nba', seasons: [2025, 2026], season: 2026 })).players.length, 0, 'a season can be asked for even when empty');
eq((await buildLeaders({ load, sport: 'nba', seasons: [2025], season: 1999 })).season, 2025, 'a season that is not stored is ignored');

// --- teams -----------------------------------------------------------------------------
const teams = await buildTeams({ load, sport: 'nba', seasons: [2025] });
eq(teams.teams.length, 12, 'twelve teams');
const finals = L.games.filter((g) => g.status === 'final');
const tally = (k) => teams.teams.reduce((a, t) => a + t[k], 0);
const ties = finals.filter((g) => g.home_score === g.away_score).length;
ok(tally('wins') === finals.length - ties && tally('losses') === finals.length - ties && tally('ties') === 2 * ties && tally('games') === 2 * finals.length, 'every final game is one win and one loss (or a tie for both)');
ok(teams.teams.every((t, i) => i === 0 || (teams.teams[i - 1].win_pct ?? -1) >= (t.win_pct ?? -1)), 'teams start ordered by winning share');
const soft = teams.teams.find((t) => t.team === SOFT_DEFENSE), tough = teams.teams.find((t) => t.team === TOUGH_DEFENSE);
const byAllowed = teams.teams.slice().sort((a, b) => b.against.points - a.against.points);
ok(byAllowed[0].team === SOFT_DEFENSE && byAllowed[byAllowed.length - 1].team === TOUGH_DEFENSE, 'the built-in soft and tough defenses allow the most and fewest points');
ok(soft.against.points > tough.against.points * 1.4, 'by a wide margin');
// Points per game from player rows equal points from the final score (the made-up box scores add up).
ok(teams.teams.every((t) => Math.abs(t.for.points - t.points_for) < 0.051), 'player points add up to the final score');
for (const t of teams.teams) {
  const parts = POSITION_GROUPS.nba.reduce((a, g) => a + t.against_by[g].points, 0);
  ok(Math.abs(parts - t.against.points) < 0.2, t.team + ': allowed to guards, forwards and centers adds up to all allowed');
}
const okcCenters = L.rows.filter((r) => r.played && r.opponent === 'okc' && positionGroup('nba', players.find((p) => p.player_id === r.player_id).position) === 'C');
const okcGames = new Set(L.rows.filter((r) => r.played && r.opponent === 'okc').map((r) => r.game_id)).size;
eq(teams.teams.find((t) => t.team === 'okc').against_by.C.rebounds, r1(okcCenters.reduce((a, r) => a + r.stats.rebounds, 0) / okcGames), 'rebounds allowed to centers per game');
ok(/^[WL]\d+$/.test(soft.streak) && /^\d+-\d+$/.test(soft.last10) && soft.last10.split('-').map(Number).reduce((a, b) => a + b) === 10, 'streak and last 10');
eq(soft.for.assists, null, 'a stat no row carries is empty for teams too');
ok(teams.teams.every((t) => Math.abs(t.for.pts_reb - (t.for.points + t.for.rebounds)) < 0.15 && Math.abs(t.against.pts_reb - (t.against.points + t.against.rebounds)) < 0.15), 'team combo totals add up from their parts');

// --- player log: whole seasons and rest days ----------------------------------------------
const log = await buildPlayerLog({ load, sport: 'nba', playerId: 'matl0', seasons: [2025], nowMs: Date.parse('2026-01-01T00:00:00Z'), limit: CHART_LIMIT });
eq(log.games.length, rows0.length, 'the page gets every stored game');
eq((await buildPlayerLog({ load, sport: 'nba', playerId: 'matl0', seasons: [2025], nowMs: Date.parse('2026-01-01T00:00:00Z') })).games.length, LOG_LIMIT, 'the default stays at the log limit');
ok(log.games.slice(0, -1).every((g) => g.rest_days === 1), 'a team that plays every day is always on the second night of a back-to-back');
eq(log.games[log.games.length - 1].rest_days, null, 'the first stored game has no rest count');
ok(log.games.every((g) => typeof g.starter === 'boolean' || g.starter === null), 'starter is carried for the role split');

// --- game panel values ------------------------------------------------------------------
const lastGame = L.games[L.games.length - 1];
const game = await buildGame({ load, sport: 'nba', gameId: lastGame.game_id, seasons: [2025] });
const gp = game.teams[lastGame.home_team].players[0];
eq(game.stats, ['points', 'rebounds'], 'the game panel marks the modeled stats');
eq(game.context_stats, contextStats('nba'), 'and lists every other stat');
ok(game.context_stats.includes('pts_reb') && game.context_stats.includes('fantasy') && game.context_stats[0] === 'minutes', 'combos are in the game panel');
ok(gp.recent.points.length === 10 && gp.summaries.minutes.games > 0, 'ten recent values and minutes for each player');
const before = L.rows.filter((r) => r.player_id === gp.player_id && r.date < lastGame.local_date && r.played).sort((a, b) => b.date.localeCompare(a.date));
eq(gp.recent.points, before.slice(0, 10).map((r) => r.stats.points), 'recent values are the last ten played, newest first');
eq(gp.recent.pts_reb, before.slice(0, 10).map((r) => r.stats.points + r.stats.rebounds), 'combo values for the small charts');

// --- matchup ------------------------------------------------------------------------------
// The latest game whose two teams had met before, so meetings and the
// players' averages against this opponent have something to show.
const pairKey = (g) => [g.home_team, g.away_team].sort().join();
const repeat = L.games.filter((g) => g.status === 'final' && L.games.some((h) => h.status === 'final' && pairKey(h) === pairKey(g) && h.local_date < g.local_date)).pop();
const rg = await buildGame({ load, sport: 'nba', gameId: repeat.game_id, seasons: [2025] });
const M = rg.matchup, [AW, HM] = [repeat.away_team, repeat.home_team];
const priorFinals = L.games.filter((g) => g.status === 'final' && g.local_date < repeat.local_date);
eq(M.teams_ranked, 12, 'every team is ranked');
eq(M.teams[HM].games, priorFinals.filter((g) => g.home_team === HM || g.away_team === HM).length, 'team numbers stop before this game');
const met = priorFinals.filter((g) => pairKey(g) === pairKey(repeat)).sort((a, b) => b.start_utc.localeCompare(a.start_utc));
ok(met.length > 0, 'the fixture has an earlier meeting');
eq(M.meetings.map((m) => m.game_id), met.slice(0, MEETINGS_LIMIT).map((g) => g.game_id), 'the stored meetings, newest first');
eq(M.meeting_summary.wins[AW] + M.meeting_summary.wins[HM] + M.meeting_summary.ties, M.meetings.length, 'each meeting is a win or a tie');
eq(M.meeting_summary.avg_total, r1(avg(M.meetings.map((m) => m.home_score + m.away_score))), 'average total points');
ok(Object.keys(M.stats[HM].for).includes('pts_reb') && !Object.keys(M.stats[HM].for).includes('minutes'), 'team stats cover the catalog, not minutes');
eq(Object.keys(M.allowed_by[HM]), POSITION_GROUPS.nba, 'allowed to each position group');
// vs this opponent: the player's played games against the other team before this one.
const hp = rg.teams[HM].players[0];
const vsRows = L.rows.filter((r) => r.player_id === hp.player_id && r.played && r.opponent === AW && r.date < repeat.local_date);
ok(vsRows.length > 0, 'the player has faced this opponent');
eq([hp.vs_opp.games, hp.vs_opp.values.points, hp.vs_opp.values.pts_reb], [vsRows.length, r1(avg(vsRows.map((r) => r.stats.points))), r1(avg(vsRows.map((r) => r.stats.points + r.stats.rebounds)))], 'averages against this opponent');
ok(rg.teams[HM].players.every((p) => p.vs_opp === null || p.vs_opp.games > 0), 'no opponent games reads as null, never zeros');
// Early in a new season: meetings and the averages against this opponent
// reach back into last season; team numbers stay this season's.
const N = nbaModelLeague({ days: 6, start: '2026-10-21', season: 2026, seed: 11 });
const two = { ...recs,
  [SPORTS_PREFIX + 'nba/player-games/2026.json']: { schema_version: 1, sport: 'nba', season: 2026, ...packRows(N.rows) },
  [SPORTS_PREFIX + 'nba/games/2026.json']: { schema_version: 1, sport: 'nba', season: 2026, games: N.games } };
const load2 = async (kind, opts = {}) => two[SPORTS_PREFIX + (kind === 'players' ? 'nba/players.json' : 'nba/' + kind + '/' + opts.season + '.json')] ?? null;
const ng = N.games[N.games.length - 1];
const nv = await buildGame({ load: load2, sport: 'nba', gameId: ng.game_id, seasons: [2025, 2026] });
const both = (g) => [g.home_team, g.away_team].sort().join() === [ng.home_team, ng.away_team].sort().join();
ok(nv.matchup.meetings.some((m) => m.season === 2025), 'meetings include last season');
eq(nv.matchup.meetings.length, Math.min(MEETINGS_LIMIT, L.games.concat(N.games).filter((g) => g.status === 'final' && both(g) && g.local_date < ng.local_date).length));
eq(nv.matchup.teams[ng.home_team].games, N.games.filter((g) => g.status === 'final' && g.local_date < ng.local_date && (g.home_team === ng.home_team || g.away_team === ng.home_team)).length, 'team numbers are this season only');
const np = nv.teams[ng.home_team].players[0];
const npRows = L.rows.concat(N.rows).filter((r) => r.player_id === np.player_id && r.played && r.opponent === ng.away_team && r.date < ng.local_date);
eq(np.vs_opp.games, npRows.length, 'a player’s games against this opponent include last season');
ok(npRows.some((r) => r.season === 2025), 'and some of them are from last season');
// Ranks on a made-up game between the soft and tough defenses, over the whole season.
const table = teamTable({ sport: 'nba', rows: L.rows, games: L.games, players: new Map(players.map((p) => [p.player_id, p])), stats: shownStats('nba').filter((st) => st !== 'minutes') });
const SM = matchupView({ sport: 'nba', game: { away_team: SOFT_DEFENSE, home_team: TOUGH_DEFENSE }, gameDate: '2099-01-01', allGames: L.games, table, stats: shownStats('nba').filter((st) => st !== 'minutes') });
eq([SM.stats[TOUGH_DEFENSE].allowed_rank.points, SM.stats[SOFT_DEFENSE].allowed_rank.points], [1, 12], 'rank 1 allows the fewest points, 12 the most');
eq(SM.teams[TOUGH_DEFENSE].rank.points_against, 1, 'points allowed from final scores rank the same way');
const best = table.slice().sort((a, b) => b.win_pct - a.win_pct)[0];
eq(matchupView({ sport: 'nba', game: { away_team: best.team, home_team: SOFT_DEFENSE }, gameDate: '2099-01-01', allGames: L.games, table, stats: ['points'] }).teams[best.team].rank.win_pct, 1, 'the best record ranks first');
ok(Math.abs(SM.league.allowed.points - avg(table.map((t) => t.against.points))) < 0.051, 'league average of points allowed');
ok(SM.allowed_by_rank[SOFT_DEFENSE].G.points >= 10 && SM.allowed_by_rank[TOUGH_DEFENSE].G.points <= 3, 'soft and tough by position too');
const early = await buildGame({ load, sport: 'nba', gameId: L.games.find((g) => g.status === 'final').game_id, seasons: [2025] });
ok(Object.values(early.matchup.teams).every((t) => t === null) && early.matchup.meetings.length === 0, 'the first game has no prior numbers or meetings');

// --- the route --------------------------------------------------------------------------
const store = { backend: 'r2', rawGet: async (k) => (recs[k] ? Buffer.from(JSON.stringify(recs[k])) : null) };
async function call(query, session = { sub: 'o', tr: true, tp: true }) {
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleSportsRequest({ method: 'GET', headers: {}, query: { action: 'me', ...query } }, res, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => session, store, now: () => Date.parse('2026-01-01T00:00:00Z') });
  return res;
}
let res = await call({ sports: 'leaders', sport: 'nba', window: 'last10' });
ok(res.statusCode === 200 && res.body.window === 'last10' && res.body.players.length === 96 && res.headers['cache-control'] === 'private, no-store', 'leaders through the Owner route, never cached');
res = await call({ sports: 'teams', sport: 'nba', season: '2025' });
ok(res.statusCode === 200 && res.body.teams.length === 12, 'teams through the Owner route');
res = await call({ sports: 'teams', sport: 'nba', season: 'x; drop' });
ok(res.statusCode === 200 && res.body.season === 2025, 'a malformed season is ignored');
res = await call({ sports: 'leaders', sport: 'nhl' });
eq(res.statusCode, 400, 'unknown league');
res = await call({ sports: 'leaders', sport: 'nba' }, { sub: 'm', tr: true, tp: false });
ok(res.statusCode >= 400 && res.statusCode < 500 && !res.body.players, 'a non-Owner gets nothing');
res = await call({ sports: 'player', sport: 'nba', id: 'matl0' });
eq(res.body.games.length, rows0.length, 'the page route returns every stored game for the charts');

console.log(`Sports stats smoke passed (${checks} checks).`);

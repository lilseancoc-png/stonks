// Player and team stats behind the Sports charts: whole-season player logs
// with rest days, the player leaderboard (season / last 10 / last 5), team
// records and what each team scores and allows (by position too), and the
// small per-player value lists in the game panel. Offline: the made-up league
// from the model tests and a fake store.
//   node scripts/sports-stats-smoke.mjs
import assert from 'node:assert/strict';
import { nbaModelLeague, SOFT_DEFENSE, TOUGH_DEFENSE } from './fixtures/sports-model.mjs';
import { packRows } from '../lib/sports/rows.mjs';
import { buildLeaders, buildTeams, buildPlayerLog, buildGame, CHART_LIMIT, LOG_LIMIT, LEADER_WINDOWS, POSITION_GROUPS, shownStats, contextStats } from '../lib/sports/read.mjs';
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

import assert from 'node:assert/strict';
import { nbaTeamGames, addNBATeamGames, nbaTeamSnapshot, nbaTeamMatchup } from '../lib/sports/nba-team-context.mjs';
import { buildModel, forecastStat, factorInputs, GAME_FACTORS } from '../lib/sports/models.mjs';
import { rankGameProps } from '../lib/sports/props.mjs';
import { evaluateEntry } from '../lib/sports/journal.mjs';
import { nbaModelLeague } from './fixtures/sports-model.mjs';

const rows = [], games = [];
for (let d = 1; d <= 10; d++) {
  const date = `2026-11-${String(d).padStart(2, '0')}`, id = 'g' + d;
  games.push({ game_id: id, season: 2026, local_date: date, start_utc: date + 'T22:00Z', status: 'final', home_team: 'gs', away_team: 'bos', home_score: 110, away_score: 100 });
  for (const team of ['gs', 'bos']) for (let i = 0; i < 5; i++) rows.push({ game_id: id, player_id: team + i, date, team, opponent: team === 'gs' ? 'bos' : 'gs',
    played: true, minutes: 48, stats: { points: team === 'gs' ? 22 : 20, field_goals_attempted: 17, free_throws_attempted: 5, offensive_rebounds: 2, turnovers: i === 0 ? 2 : 3 } });
}
const tg = nbaTeamGames(rows, games);
assert.equal(tg.length, 20);
assert.equal(tg[0].possessions, 100, 'both teams average to 100 estimated possessions');
assert.deepEqual(nbaTeamGames([...rows].reverse(), [...games].reverse()), tg, 'input order does not change the estimates');
const state = new Map(); addNBATeamGames(state, tg);
const before = nbaTeamSnapshot(state, '2026-11-10');
assert.equal(before.teams.gs.games, 9, 'same-day games are excluded');
assert.equal(before.as_of_date, '2026-11-09');
assert.equal(before.league.rating, 105);
assert.equal(before.teams.gs.pace, 100);
assert.ok(before.teams.gs.offensive_rating > 105 && before.teams.gs.offensive_rating < 110, 'small samples shrink toward the league');
assert.ok(before.teams.gs.defensive_rating < 105 && before.teams.gs.net_rating > 0, 'lower defensive efficiency is better');
assert.equal(nbaTeamMatchup(nbaTeamSnapshot(state, '2026-11-05'), 'gs', 'bos'), null, 'fewer than five complete games: no adjustment');
assert.equal(nbaTeamSnapshot(state, '2027-02-01'), null, 'old rotations do not survive indefinitely');
assert.equal(nbaTeamMatchup(before, 'gs', 'missing'), null);
assert.equal(nbaTeamMatchup(null, 'gs', 'bos'), null, 'old stored models work without team context');
const changed = rows.map((r) => r.date === '2026-11-10' ? { ...r, stats: { ...r.stats, points: r.stats.points + 20 } } : r);
const changedGames = games.map((g) => g.local_date === '2026-11-10' ? { ...g, home_score: 210, away_score: 200 } : g);
const changedState = new Map(); addNBATeamGames(changedState, nbaTeamGames(changed, changedGames));
assert.deepEqual(nbaTeamSnapshot(changedState, '2026-11-10'), before, 'today’s actual scores cannot leak into today’s ratings');
const game = games[0], box = rows.filter((r) => r.game_id === game.game_id);
assert.equal(nbaTeamGames(box.slice(1), [game]).length, 0, 'partial box scores are excluded');
assert.equal(nbaTeamGames([...box, box[0]], [game]).length, 0, 'duplicates cannot inflate possession counts');
assert.equal(nbaTeamGames(box, [{ ...game, home_score: 111 }]).length, 0, 'box totals must reconcile to the final score');
assert.equal(nbaTeamGames(box, [{ ...game, status: 'in_progress' }]).length, 0, 'in-progress games are excluded');
assert.equal(nbaTeamGames(box.map((r, i) => i ? r : { ...r, stats: { ...r.stats, turnovers: null } }), [game]).length, 0, 'missing is not zero');
const ot = nbaTeamGames(box.map((r) => ({ ...r, minutes: 53 })), [game]);
const ots = new Map(); addNBATeamGames(ots, ot);
assert.equal(nbaTeamSnapshot(ots, '2026-11-02').teams.gs.pace, 90.566, 'overtime pace is normalized to 48 minutes');

const L = nbaModelLeague({ days: 20, start: '2026-10-21', season: 2026 });
const model = buildModel({ sport: 'nba', rows: L.rows, games: L.games, includeJoint: false });
const history = L.rows.filter((r) => r.player_id === 'mgs0').sort((a, b) => b.date.localeCompare(a.date));
const args = { sport: 'nba', stat: 'points', history, home: true, opponent: 'bos', group: 'G', side: 'over', threshold: 20.5, model };
const base = forecastStat(args), adjusted = structuredClone(model);
assert.ok(!Object.hasOwn(base, 'team_context'), 'models without team data retain their exact forecast shape for replay');
adjusted.context.nba_team_context = before;
adjusted.context.factors.points.team_efficiency = { betas: [1, 1, 0, 0] };
adjusted.context.factors.points.team_pace = { betas: [1] };
adjusted.context.nba_team_context.teams.bos.pace = 120;
const fc = forecastStat({ ...args, model: adjusted });
assert.ok(fc.mean > base.mean && fc.probability > base.probability, 'validated efficiency and tempo change the prop forecast');
assert.ok(fc.sensitivity.opportunity_down_10 > base.sensitivity.opportunity_down_10, 'workload stress includes the same adjustments');
assert.ok(fc.team_context.efficiency.applied && fc.team_context.pace_adjustment.applied);
assert.equal(fc.team_context.expected_pace, 110);
assert.ok(forecastStat({ ...args, model: adjusted, side: 'under' }).probability < forecastStat({ ...args, side: 'under' }).probability, 'the adjustment reverses properly for unders');
adjusted.context.factors.points.team_efficiency.betas = null;
adjusted.context.factors.points.team_pace.betas = null;
const contextOnly = forecastStat({ ...args, model: adjusted });
assert.equal(contextOnly.mean, base.mean, 'unproven inputs are displayed without a probability change');
assert.equal(contextOnly.team_context.efficiency.applied, false);
assert.equal(factorInputs('team_pace', 'nfl', { teamContext: fc.team_context }), null, 'NFL never uses the NBA adjustment');
assert.ok(!GAME_FACTORS.nfl.includes('team_efficiency') && !GAME_FACTORS.nfl.includes('team_pace'));
const now = Date.parse('2026-11-10T12:00Z');
const next = { game_id: 'next', status: 'scheduled', season: 2026, local_date: '2026-11-10', home_team: 'gs', away_team: 'bos', start_utc: '2026-11-10T23:00Z' };
const ranked = rankGameProps({ sport: 'nba', game: next, lines: [{ player_name: L.players.find((p) => p.player_id === 'mgs0').name,
  home_team: 'Golden State Warriors', away_team: 'Boston Celtics', start_utc: next.start_utc, observed_utc: new Date(now).toISOString(), stat: 'points', threshold: 20.5, side: 'over' }],
  injuries: { state: 'ok', observed_utc: new Date(now).toISOString(), reports: [] }, players: L.players, rows: L.rows, model: adjusted, allGames: L.games, now, nbaResearch: true });
assert.ok(ranked.picks[0].evidence.some((e) => e.label === 'Team efficiency'));
assert.ok(ranked.picks[0].evidence.some((e) => e.label === 'Game pace'));
assert.ok(ranked.picks[0].features.team_context, 'first-issued records carry the exact team context');
const entry = await evaluateEntry({ now, body: { operator: 'prizepicks', format: 'power', stake: 1, payouts: {},
  legs: [{ sport: 'nba', player_id: 'mgs0', game_id: next.game_id, stat: 'points', side: 'over', threshold: 20.5 }] },
  load: async (kind, opts) => kind === 'model' ? adjusted : kind === 'games' ? { games: [next] }
    : kind === 'players' ? { players: L.players } : kind === 'player-games' ? { rows: opts.season === 2026 ? L.rows : [] } : null });
assert.deepEqual(entry.legs[0].model.team_context, contextOnly.team_context, 'Pick Builder preserves the same team context and applied flags');
console.log('NBA team context: completeness, timing, overtime, shrinkage, forecast, selection evidence, Pick Builder and NFL isolation passed.');

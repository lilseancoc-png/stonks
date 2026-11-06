// Feed normalization, injury gates, point-in-time ranking, and Owner route.
// Entirely offline; provider responses below are made-up fixtures.
import assert from 'node:assert/strict';
import { normalizeOdds, normalizeInjuries, loadPropSources } from '../lib/sports/prop-sources.mjs';
import { rankGameProps, lineMatchesGame } from '../lib/sports/props.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { capturePropPicks, propRecordView } from '../lib/sports/prop-record.mjs';
import { sportsKey } from '../lib/sports/store.mjs';

const now = Date.parse('2026-11-05T18:00:00Z'), at = new Date(now).toISOString();
const game = { game_id: 'g1', status: 'scheduled', start_utc: '2026-11-05T23:00:00Z', local_date: '2026-11-05', home_team: 'lal', away_team: 'gs', season: 2026 };
const outcome = { name: 'Over', description: 'Test One', point: 15.5, price: 100, dfs_odds_type: 'standard' };
const market = { key: 'player_points', period: null, line_type: 'main', last_update: at, outcomes: [outcome] };
const event = { id: 'provider-g1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', sport_key: 'basketball_nba', commence_time: game.start_utc, bookmakers: [{ key: 'prizepicks', markets: [market] }] };
const linesFor = (m) => normalizeOdds([{ ...event, bookmakers: [{ key: 'prizepicks', markets: [m] }] }], 'nba', now);
assert.equal(normalizeOdds([event], 'nba', now).length, 1);
assert.equal(linesFor({ ...market, period: 'h1' }).length, 0);
assert.equal(linesFor({ ...market, line_type: 'alternate' }).length, 0);
assert.equal(linesFor({ ...market, suspended_at: at }).length, 0);
assert.equal(linesFor({ ...market, last_update: '2026-11-05T16:00:00Z' }).length, 0);
assert.equal(linesFor({ ...market, last_update: '2026-11-05T19:00:00Z' }).length, 0);
assert.equal(linesFor({ ...market, last_update: null }).length, 0);
assert.equal(linesFor({ ...market, outcomes: [{ ...outcome, point: null }] }).length, 0);
assert.equal(linesFor({ ...market, outcomes: [{ ...outcome, dfs_odds_type: 'goblin' }] }).length, 0);
assert.equal(linesFor({ ...market, outcomes: [{ ...outcome, name: 'Under', allowed_wager_types: 'over' }] }).length, 0);
assert.equal(normalizeOdds([{ ...event, live: true }], 'nba', now).length, 0);
assert.equal(normalizeOdds([{ ...event, sport_key: 'football_nfl' }], 'nba', now).length, 0);
assert.equal(normalizeOdds([event, event], 'nba', now).length, 1);

assert.equal(linesFor({ ...market, outcomes: [{ ...outcome, dfs_odds_type: undefined }] }).length, 0, 'NBA refuses unknown DFS line types');
const normalized = normalizeOdds([event], 'nba', now)[0];
assert.ok(lineMatchesGame(normalized, game, 'nba'));
assert.ok(!lineMatchesGame({ ...normalized, start_utc: '2026-11-06T23:00:00Z' }, game, 'nba'));
assert.ok(!lineMatchesGame({ ...normalized, home_team: 'Los Angeles Clippers' }, game, 'nba'));

const injured = normalizeInjuries({ status: 'success', timestamp: at, injuries: [{ displayName: 'Los Angeles Lakers', injuries: [{ status: 'Out', date: at, shortComment: 'Fixture absence', athlete: { displayName: 'Test Out', team: { abbreviation: 'LAL' }, links: [{ rel: ['playercard'], href: 'https://www.espn.com/nba/player/_/id/3/test-out' }] } }] }] }, 'nba');
assert.equal(injured[0].espn_id, '3');
assert.equal(injured[0].team, 'lal');
const players = ['One', 'Two', 'Out'].map((n, i) => ({ player_id: 'p' + i, name: 'Test ' + n, team: i === 1 ? 'gs' : 'lal', position: 'G', provider_ids: { espn: String(i + 1) } }));
const rows = players.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({
  player_id: p.player_id, game_id: 'old' + i, date: new Date(Date.parse('2026-10-16T12:00Z') + i * 86400000).toISOString().slice(0, 10),
  team: p.team, opponent: p.team === 'lal' ? 'gs' : 'lal', played: true, home: i % 2 === 0, minutes: 32, position: 'G', season: 2026,
  stats: { points: 20 + i % 4, rebounds: 8, assists: 6 },
})));
const lines = players.flatMap((p) => [
  { ...normalized, player_name: p.name, threshold: 15.5 },
  { ...normalized, player_name: p.name, stat: 'rebounds', threshold: 4.5 },
]);
const injuries = { state: 'ok', observed_utc: at, reports: injured };
const matchup = { teams_ranked: 30, allowed_by: { gs: { G: { points: 23, rebounds: 9 } } }, allowed_by_rank: { gs: { G: { points: 25 } } }, league: { allowed_by: { G: { points: 20, rebounds: 8 } } } };
const args = { sport: 'nba', game, lines, injuries, players, rows, model: null, matchup, allGames: [], now };
const ranked = rankGameProps(args);
assert.equal(ranked.picks.length, 2);
assert.equal(new Set(ranked.picks.map((p) => p.player_id)).size, 2);
assert.deepEqual(new Set(ranked.picks.map((p) => p.team)), new Set(['lal', 'gs']));
const oneTeam = rankGameProps({ ...args, rows: rows.map((r) => ({ ...r, team: 'lal', opponent: 'gs' })) });
assert.equal(oneTeam.picks.length, 1, 'never fill the opponent slot with a second teammate');
assert.equal(oneTeam.state, 'limited');
assert.ok(!ranked.picks.some((p) => p.player_name === 'Test Out'));
assert.equal(ranked.availability[0].status, 'Out');
assert.ok(ranked.picks.every((p) => p.basis === 'history_only' && p.model === null));
assert.ok(ranked.picks[0].evidence.some((e) => e.label === 'Opponent defense'));
assert.ok(ranked.picks[0].evidence.some((e) => e.label === 'Workload & rest'));
assert.equal(ranked.picks[0].features.workload.last5, 32, 'research snapshot includes numeric features, not only prose');
assert.equal(ranked.picks[0].history.games, 20);
assert.deepEqual(rankGameProps({ ...args, rows: rows.concat({ ...rows[0], date: '2026-11-05', stats: { points: 9999 } }) }).picks, ranked.picks, 'target-day rows cannot leak into history');
assert.equal(rankGameProps({ ...args, injuries: { ...injuries, state: 'stale' } }).state, 'waiting');
assert.equal(rankGameProps({ ...args, injuries: { ...injuries, observed_utc: '2026-11-05T16:00Z' } }).picks.length, 0);
assert.equal(rankGameProps({ ...args, game: { ...game, status: 'postponed' } }).state, 'closed');
assert.equal(rankGameProps({ ...args, now: Date.parse(game.start_utc) }).picks.length, 0);
assert.equal(rankGameProps({ ...args, lines: lines.map((l) => ({ ...l, observed_utc: '2026-11-05T16:00Z' })) }).picks.length, 0);
assert.equal(rankGameProps({ ...args, players: players.slice(0, 1) }).picks.length, 1);
assert.equal(rankGameProps({ ...args, rows: rows.slice(0, 4) }).picks.length, 0);
assert.equal(rankGameProps({ ...args, injuries: { ...injuries, reports: [...injured, { name: 'Test One', status: 'Questionable' }] } }).picks.length, 1);
assert.equal(rankGameProps({ ...args, injuries: { ...injuries, reports: [...injured, { name: 'Test One', status: 'Available', detail: 'A minutes restriction is expected.' }] } }).picks.length, 1);
const push = rankGameProps({ ...args, lines: [ { ...lines[0], threshold: 20 } ] }).picks[0];
assert.ok(push.history.pushes > 0 && push.history.hits < push.history.games, 'pushes never count as wins');

let calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url: String(url), headers: options.headers });
  return new Response(JSON.stringify(String(url).includes('prop-line') ? [event] : { status: 'success', timestamp: at, injuries: [] }), { status: 200 });
};
const sources = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, fetchImpl });
assert.equal(sources.lines.state, 'ok');
assert.equal(sources.lines.lines.length, 1);
assert.equal(sources.injuries.state, 'ok');
assert.ok(calls.every((c) => !c.url.includes('fixture-secret')), 'key travels in a header, never in a URL');
assert.ok(!JSON.stringify(sources).includes('fixture-secret'), 'key never reaches the response');
assert.equal(calls.filter((c) => c.url.includes('prop-line')).length, 2, 'NBA uses two bulk requests: PrizePicks and sportsbook references, never one per game');
const failed = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, fetchImpl: async () => new Response('{}', { status: 429 }) });
assert.equal(failed.lines.state, 'rate_limited');
assert.equal(failed.lines.lines.length, 0);
const missing = await loadPropSources({ sport: 'nba', now, env: {}, fetchImpl });
assert.equal(missing.lines.state, 'not_configured');

const res = () => ({ headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(s) { this.code=s;return this; }, json(b) { this.body=b;return this; } });
let feedCalls = 0;
const deps = { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => null, store: { rawGet: async () => null }, now: () => now, loadPropSources: async () => { feedCalls++; return sources; } };
const req = { method: 'GET', query: { sports: 'props', sport: 'nba' }, headers: {} };
const denied = res(); await handleSportsRequest(req, denied, deps);
assert.equal(denied.code, 403); assert.equal(feedCalls, 0, 'no upstream calls before Owner authorization');
const accepted = res(); await handleSportsRequest(req, accepted, { ...deps, getSession: async () => ({ sub: 'owner', tr: true, tp: true }) });
assert.equal(accepted.code, 200); assert.equal(feedCalls, 1);
assert.equal(accepted.headers['Cache-Control'], 'private, no-store');
assert.ok(!JSON.stringify(accepted.body).includes('fixture-secret'));

// Persist only the first two distinct-player picks, under a lease, and
// never rewrite their line/evidence when live rankings change.
const objects = new Map(), leases = new Set();
const store = { backend: 'r2', rawGet: async (key) => objects.has(key) ? Buffer.from(objects.get(key)) : null,
  rawPut: async (key, value) => { objects.set(key, String(value)); },
  withLease: async (key, fn) => { if (leases.has(key)) return { busy: true }; leases.add(key); try { await fn(() => {}); return { busy: false }; } finally { leases.delete(key); } } };
const view = { sport: 'nba', rank_version: 'props-rank-test', sources: { lines: { provider: 'fixture' }, injuries: { observed_utc: at } }, games: [{ ...ranked, start_utc: game.start_utc, season: 2026 }] };
assert.equal((await capturePropPicks({ store, view, now })).added, 2);
const recordKey = sportsKey('prop-record', { sport: 'nba', season: 2026 });
const saved = objects.get(recordKey);
const altered = { ...view, games: view.games.map((g) => ({ ...g, picks: g.picks.map((p) => ({ ...p, threshold: 999, rank_score: 99 })) })) };
assert.equal((await capturePropPicks({ store, view: altered, now })).added, 0);
assert.equal(objects.get(recordKey), saved, 'first issued lines and scores are immutable');
assert.equal((await capturePropPicks({ store, view: { ...view, games: [{ ...view.games[0], game_id: 'late', picks: view.games[0].picks.map((p) => ({ ...p, game_id: 'late' })) }] }, now: Date.parse(game.start_utc) + 1 })).added, 0, 'no hindsight capture');
const extras = ['push-game', 'void-game', 'pending-game'].map((id) => ({ ...view.games[0], game_id: id, picks: [{ ...ranked.picks[0], game_id: id, threshold: 20 }] }));
await Promise.all([capturePropPicks({ store, view: { ...view, games: extras }, now }), capturePropPicks({ store, view: { ...view, games: extras }, now })]);
const frozen = JSON.parse(objects.get(recordKey)).picks;
assert.equal(frozen.length, 5, 'concurrent scans do not duplicate picks');
assert.ok(frozen.every((p) => Date.parse(p.issued_utc) < Date.parse(p.game_start_utc)));
const load = async (kind) => {
  if (kind === 'prop-record') return JSON.parse(objects.get(recordKey));
  if (kind === 'games') return { games: [{ ...game, status: 'final' }, { ...game, game_id: 'push-game', status: 'final' }, { ...game, game_id: 'void-game', status: 'canceled' }, { ...game, game_id: 'pending-game', status: 'final' }] };
  if (kind === 'player-games') return { rows: frozen.filter((p) => !['void-game', 'pending-game'].includes(p.game_id)).map((p, i) => ({ game_id: p.game_id, player_id: p.player_id, played: true, stats: { [p.stat]: p.game_id === 'push-game' ? 20 : p.threshold + (i === 0 ? 1 : -1) } })) };
  return null;
};
const record = await propRecordView({ load, sport: 'nba', seasons: [2026], now, all: true });
assert.equal(record.summary.wins, 1); assert.equal(record.summary.losses, 1);
assert.equal(record.summary.pushes, 1); assert.equal(record.summary.voids, 1); assert.equal(record.summary.pending, 1);
assert.equal(record.summary.win_rate, 0.5, 'push/void/pending are excluded from win rate');
assert.equal(record.records.find((p) => p.game_id === 'pending-game').result, 'awaiting_stats');
assert.equal(record.records[0].rank_version, 'props-rank-test');
assert.ok(record.records.every((p) => Array.isArray(p.evidence)), 'research export keeps original rationale');
assert.equal(record.summary.model_check.samples, 0, 'rank scores are not probability forecasts');
const nflRecord = await propRecordView({ load, sport: 'nfl', seasons: [2026], now, all: true });
assert.equal(nflRecord.records.find((p) => p.game_id === 'pending-game').result, 'awaiting_stats', 'missing NFL row is never assumed zero');
const fillObjects = new Map(), fillStore = { ...store,
  rawGet: async (k) => fillObjects.has(k) ? Buffer.from(fillObjects.get(k)) : null,
  rawPut: async (k, value) => { fillObjects.set(k, String(value)); } };
const homePick = ranked.picks.find((p) => p.team === game.home_team), awayPick = ranked.picks.find((p) => p.team === game.away_team);
const fillView = (picks) => ({ ...view, games: [{ ...view.games[0], picks }] });
assert.equal((await capturePropPicks({ store: fillStore, view: fillView([homePick]), now })).added, 1);
assert.equal((await capturePropPicks({ store: fillStore, view: fillView([
  { ...homePick, player_id: 'another-teammate', rank_score: 99 },
  { ...homePick, player_id: 'outsider', team: 'bos' }, awayPick,
]), now })).added, 1, 'later fills reject a teammate and any player outside the game');
const filled = JSON.parse(fillObjects.get(recordKey));
assert.deepEqual(filled.picks.map((p) => p.player_id), [homePick.player_id, awayPick.player_id]);
assert.deepEqual(new Set(filled.picks.map((p) => p.team)), new Set([game.home_team, game.away_team]));
const legacy = { ...filled, picks: filled.picks.map((p) => ({ ...p, team: 'lal', rank_version: 'props-rank-2' })) };
fillObjects.set(recordKey, JSON.stringify(legacy));
assert.equal((await capturePropPicks({ store: fillStore, view, now })).added, 0);
assert.equal(fillObjects.get(recordKey), JSON.stringify(legacy), 'the new rule never rewrites legacy issues');
console.log('Sports props smoke passed (feed normalization, ranking, injuries, time boundaries, quota failures and Owner access).');

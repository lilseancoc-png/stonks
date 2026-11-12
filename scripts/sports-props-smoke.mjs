// Feed normalization, injury gates, point-in-time ranking, and Owner route.
// Entirely offline; provider responses below are made-up fixtures.
import assert from 'node:assert/strict';
import { normalizeOdds, normalizeInjuries, loadPropSources, normalizeGameLines } from '../lib/sports/prop-sources.mjs';
import { rankGameProps, lineMatchesGame, playerFor, currentTeam } from '../lib/sports/props.mjs';
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
assert.ok(ranked.matched_lines.length >= lines.length - 2 && ranked.matched_lines.every((l) => l.game_id === game.game_id && l.player_id && typeof l.threshold === 'number'), 'matched lines are kept for the line archive');
assert.ok(!('matched_lines' in JSON.parse(JSON.stringify(ranked))), 'and never reach a response');
assert.equal(new Set(ranked.picks.map((p) => p.player_id)).size, 2);
assert.deepEqual(new Set(ranked.picks.map((p) => p.team)), new Set(['lal', 'gs']));
assert.deepEqual(ranked.matching, { name: lines.length }, 'every line matched by name; counts kept for the job log');
assert.equal(ranked.unmatched_names.size, 0);
// Line matching (2026-11-11): name variants, the current team, moved players.
const byP = new Map(players.map((p) => [p.player_id, rows.filter((r) => r.player_id === p.player_id).sort((a, b) => b.date.localeCompare(a.date))]));
const herb = [...players, { player_id: 'h1', name: 'Herbert Jones', team: 'lal', provider_ids: {} }, { player_id: 'c1', name: 'C.J. McCollum', team: 'gs', provider_ids: {} }];
const herbRows = new Map([...byP, ['h1', [{ team: 'lal', date: '2026-11-01' }]], ['c1', [{ team: 'gs', date: '2026-11-01' }]]]);
assert.deepEqual(playerFor({ player_name: 'Herb Jones' }, herb, herbRows, game, 'nba'), { player: herb[3], how: 'variant' }, 'a short first name on the same last name and team');
assert.deepEqual(playerFor({ player_name: 'CJ McCollum' }, herb, herbRows, game, 'nba'), { player: herb[4], how: 'name' }, 'initials with or without dots');
assert.equal(playerFor({ player_name: 'H Jones' }, herb, herbRows, game, 'nba'), null, 'a bare initial is not a match');
assert.equal(playerFor({ player_name: 'Herb Jones' }, [...herb, { player_id: 'h2', name: 'Herbie Jones', team: 'lal', provider_ids: {} }], new Map([...herbRows, ['h2', [{ team: 'lal' }]]]), game, 'nba'), null, 'two possible players: no match');
const movedRows = new Map([...byP, ['p0', byP.get('p0').map((r) => ({ ...r, team: 'bos' }))]]);
assert.equal(playerFor({ player_name: 'Test One' }, players, movedRows, game, 'nba').team_changed, true, 'NBA: the only player with that name, last seen with another team, has moved');
const offGame = players.map((p) => (p.player_id === 'p0' ? { ...p, team: 'bos', status: 'ACT' } : p));
assert.equal(playerFor({ player_name: 'Test One' }, offGame, movedRows, game, 'nfl'), null, 'NFL: a name whose current team is in neither side of this game is someone else');
assert.equal(playerFor({ player_name: 'Test One' }, players, movedRows, game, 'nfl').how, 'name', 'NFL: the roster file puts him in this game');
assert.equal(currentTeam({ team: 'kc', status: 'ACT' }, [{ team: 'den' }], 'nfl'), 'kc', 'NFL: the roster file wins (a trade shows there first)');
assert.equal(currentTeam({ team: 'kc', status: 'CUT' }, [{ team: 'den' }], 'nfl'), null, 'NFL: a released player has no team');
assert.equal(currentTeam({ team: 'kc' }, [{ team: 'den' }], 'nba'), 'den', 'NBA: the latest box score');
const moved = rankGameProps({ ...args, rows: rows.map((r) => (r.player_id === 'p0' ? { ...r, team: 'bos' } : r)) });
assert.ok(moved.skipped.team_changed >= 1 && !moved.picks.some((p) => p.player_id === 'p0'), 'a player who moved teams is not ranked on his old role');
const nflGame = { ...game, home_team: 'kc', away_team: 'den' };
const nflTeam = (t) => (t === 'lal' ? 'kc' : t === 'gs' ? 'den' : t);
const nflArgs = { ...args, sport: 'nfl', game: nflGame, injuries: { ...injuries, reports: [] },
  lines: lines.filter((l) => l.player_name === 'Test One').map((l) => ({ ...l, home_team: 'Kansas City Chiefs', away_team: 'Denver Broncos' })),
  players: players.map((p) => ({ ...p, team: nflTeam(p.team), status: 'ACT' })), rows: rows.map((r) => ({ ...r, team: nflTeam(r.team), opponent: nflTeam(r.opponent) })) };
assert.ok(rankGameProps(nflArgs).matching.name >= 1 && !rankGameProps(nflArgs).skipped.team_changed, 'NFL fixture: the line reaches the player');
const nflMoved = rankGameProps({ ...nflArgs, rows: nflArgs.rows.map((r) => (r.player_id === 'p0' ? { ...r, team: 'buf' } : r)) });
assert.ok(nflMoved.skipped.team_changed >= 1 && nflMoved.picks.length === 0, 'NFL: players.csv says this game, the last box score says another team: not ranked on the old role');
const nflReserve = rankGameProps({ ...nflArgs, players: nflArgs.players.map((p) => ({ ...p, status: p.player_id === 'p0' ? 'RES' : 'ACT' })) });
assert.ok(nflReserve.skipped.not_on_active_roster >= 1 && nflReserve.picks.length === 0, 'NFL: a player on injured reserve is not ranked');
const unknown = rankGameProps({ ...args, lines: [...lines, { ...normalized, player_name: 'Nobody Here' }] });
assert.equal(unknown.skipped.unmatched_player, 1);
assert.deepEqual([...unknown.unmatched_names], ['Nobody Here'], 'unmatched names are kept for the count (never in a response)');
assert.ok(!('unmatched_names' in JSON.parse(JSON.stringify(unknown))));
// Game spreads and totals from the sportsbook request (NBA): main row per
// book, median across books, team totals and other books left out.
const gl = (key, outcomes, extra = {}) => ({ key, last_update: at, outcomes, ...extra });
const books = [
  { key: 'draftkings', markets: [gl('spreads', [{ name: 'Los Angeles Lakers', side: 'home', price: -110, point: -4.5 }, { name: 'Golden State Warriors', side: 'away', price: -110, point: 4.5 }], { line_type: 'main' }),
    gl('spreads', [{ name: 'Los Angeles Lakers', side: 'home', price: 200, point: -10.5 }, { name: 'Golden State Warriors', side: 'away', price: -250, point: 10.5 }], { line_type: 'alternate' }),
    gl('totals', [{ name: 'Over', price: -110, point: 228.5 }, { name: 'Under', price: -110, point: 228.5 }], { team: null, line_type: 'main' }),
    gl('totals', [{ name: 'Over', price: -110, point: 117.5 }, { name: 'Under', price: -110, point: 117.5 }], { team: 'Los Angeles Lakers' })] },
  { key: 'fanduel', markets: [gl('spreads', [{ name: 'Los Angeles Lakers', price: -112, point: -5.5 }, { name: 'Golden State Warriors', price: -108, point: 5.5 }]),
    gl('spreads', [{ name: 'Los Angeles Lakers', price: -300, point: -1.5 }, { name: 'Golden State Warriors', price: 240, point: 1.5 }]),
    gl('totals', [{ name: 'Over', price: -105, point: 229.5 }, { name: 'Under', price: -115, point: 229.5 }])] },
  { key: 'prizepicks', markets: [gl('totals', [{ name: 'Over', price: -110, point: 300 }, { name: 'Under', price: -110, point: 300 }])] },
];
const gameLines = normalizeGameLines([{ ...event, bookmakers: books }], 'nba', now);
assert.deepEqual(gameLines.map(({ observed_utc, ...g }) => g), [{ event_id: 'provider-g1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', start_utc: game.start_utc, total: 229, home_margin: 5, books: 2 }],
  'home favored by the median of 4.5 and 5.5; total the median of 228.5 and 229.5; the books split around both, so no cover or over chance is claimed for 5 or 229');
// A third book on DraftKings' numbers: the median is 4.5 / 228.5, and only the
// books at those exact lines give the cover and over chances (Shin, median).
const third = { key: 'betmgm', markets: [gl('spreads', [{ name: 'Los Angeles Lakers', side: 'home', price: -115, point: -4.5 }, { name: 'Golden State Warriors', side: 'away', price: -105, point: 4.5 }], { line_type: 'main' }),
  gl('totals', [{ name: 'Over', price: -120, point: 228.5 }, { name: 'Under', price: 100, point: 228.5 }], { team: null, line_type: 'main' })] };
const agreed = normalizeGameLines([{ ...event, bookmakers: [...books, third] }], 'nba', now)[0];
assert.deepEqual([agreed.home_margin, agreed.total, agreed.books, agreed.book.books], [4.5, 228.5, 3, 2], 'the median line, and two books priced it');
assert.ok(agreed.book.home_cover > 0.5 && agreed.book.home_cover < 0.52 && agreed.book.over > 0.5 && agreed.book.over < 0.53, 'cover and over chances from the two books at those lines only: ' + JSON.stringify(agreed.book));
// Moneylines (h2h, 2026-11-12): the books' no-vig home win chance, median across books.
const withH2h = books.map((b, i) => (i < 2 ? { ...b, markets: [...b.markets, gl('h2h', [{ name: 'Los Angeles Lakers', side: 'home', price: i ? -200 : -180 }, { name: 'Golden State Warriors', side: 'away', price: i ? 170 : 150 }])] } : b));
const h2hLines = normalizeGameLines([{ ...event, bookmakers: withH2h }], 'nba', now);
assert.ok(h2hLines[0].book.home_win > 0.63 && h2hLines[0].book.home_win < 0.66, 'home win: the median of the two books\' no-vig chances');
assert.ok(lineMatchesGame(gameLines[0], game, 'nba'), 'a game line finds its stored game');
assert.deepEqual(normalizeGameLines([{ ...event, live: true, bookmakers: books }], 'nba', now), [], 'nothing once the game is live');
assert.deepEqual(normalizeGameLines([{ ...event, bookmakers: [books[0]].map((b) => ({ ...b, markets: b.markets.map((m) => ({ ...m, suspended_at: at })) })) }], 'nba', now), [], 'a suspended market is not read');
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
assert.equal(calls.filter((c) => c.url.includes('prop-line')).length, 3, 'NBA uses three bulk requests: PrizePicks, sportsbook player prices and sportsbook game lines, never one per game');
{
  // The game markets are their own request: a refused or oversized game read
  // never takes the player prices down (2026-11-12), and the other way round.
  const marketsOf = (u) => new URL(u).searchParams.get('markets').split(',');
  const playerCall = calls.find((c) => c.url.includes('prop-line') && marketsOf(c.url).includes('player_points') && !c.url.includes('prizepicks'));
  const gameCall = calls.find((c) => c.url.includes('prop-line') && marketsOf(c.url).includes('spreads'));
  assert.ok(playerCall && !['spreads', 'totals', 'h2h'].some((m) => marketsOf(playerCall.url).includes(m)), 'the player price request carries no game markets');
  assert.deepEqual(marketsOf(gameCall.url).sort(), ['h2h', 'spreads', 'totals'], 'the game request carries only spreads, totals and moneylines');
  assert.equal(sources.reference.state, 'ok');
  assert.equal(sources.reference.game_lines_state, 'ok');
  const split = (failGames, status) => async (url) => {
    const u = String(url);
    if (!u.includes('prop-line')) return new Response(JSON.stringify({ status: 'success', timestamp: at, injuries: [] }), { status: 200 });
    const games = new URL(u).searchParams.get('markets').includes('spreads');
    return games === failGames ? new Response('{}', { status }) : new Response(JSON.stringify([event]), { status: 200 });
  };
  const gamesDown = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, fetchImpl: split(true, 422) });
  assert.equal(gamesDown.reference.state, 'ok', 'a failed game read leaves the player prices up');
  assert.equal(gamesDown.reference.game_lines_state, 'unavailable');
  assert.equal(gamesDown.reference.game_lines_http_status, 422, 'the provider status is kept for the log');
  assert.deepEqual(gamesDown.reference.game_lines, []);
  const playersDown = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, fetchImpl: split(false, 500) });
  assert.equal(playersDown.reference.state, 'unavailable');
  assert.equal(playersDown.reference.http_status, 500);
  assert.equal(playersDown.reference.game_lines_state, 'ok', 'a failed player read leaves the game lines up');
  const rateLimited = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, fetchImpl: split(true, 429) });
  assert.equal(rateLimited.reference.game_lines_state, 'rate_limited');
  let skippedCalls = 0;
  const skipped = await loadPropSources({ sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-secret' }, parts: ['lines', 'injuries', 'reference'],
    fetchImpl: async (url) => { if (String(url).includes('prop-line')) skippedCalls++; return split(true, 500)(url); } });
  assert.equal(skippedCalls, 2, 'leaving game_lines out of parts saves the game request');
  assert.equal(skipped.reference.game_lines_state, 'skipped');
  assert.equal(skipped.reference.state, 'ok');
}
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
// A final NFL game whose rows are stored but none for this player: it waits
// three days for stat corrections, then stops waiting (left out of the win rate).
const nflLoad = async (kind, opts) => kind === 'player-games' ? { rows: [...(await load(kind, opts)).rows, { game_id: 'pending-game', player_id: 'someone-else', played: true, stats: { receiving_yards: 12 } }] } : load(kind, opts);
const gameMs = Date.parse(game.start_utc);
const nflEarly = await propRecordView({ load: nflLoad, sport: 'nfl', seasons: [2026], now: gameMs + 2 * 86400000, all: true });
assert.equal(nflEarly.records.find((p) => p.game_id === 'pending-game').result, 'awaiting_stats', 'within three days it waits for corrections');
const nflLate = await propRecordView({ load: nflLoad, sport: 'nfl', seasons: [2026], now: gameMs + 4 * 86400000, all: true });
assert.equal(nflLate.records.find((p) => p.game_id === 'pending-game').result, 'no_stats', 'after three days a missing NFL row stops waiting');
assert.deepEqual([nflLate.summary.no_stats, nflLate.summary.pending, nflLate.summary.win_rate], [1, 0, 0.5], 'no stat line is out of the win rate and not pending');
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

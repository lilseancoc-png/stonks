// Adversarial regressions from the Sports bug audit. No live feeds or writes.
import assert from 'node:assert/strict';
import { rankGameProps, lineMatchesGame, recommendationsView } from '../lib/sports/props.mjs';
import { teamCode, loadPropSources } from '../lib/sports/prop-sources.mjs';
import { capturePropPicks, propRecordView, PROP_RECORD_PAGE_BYTES } from '../lib/sports/prop-record.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';

const now = Date.parse('2026-11-05T18:00Z'), at = new Date(now).toISOString();
const game = { game_id: 'g', season: 2026, status: 'scheduled', local_date: '2026-11-05', start_utc: '2026-11-05T23:00Z', home_team: 'lal', away_team: 'gs' };
const players = ['One', 'Two'].map((name, i) => ({ player_id: 'p' + i, name: 'Test ' + name, position: 'G', team: i === 0 ? 'lal' : 'gs', provider_ids: { espn: String(i + 1) } }));
const rows = players.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({ sport: 'nba', season: 2026, player_id: p.player_id, game_id: 'old-' + i,
  date: new Date(now - (20 - i) * 86400000).toISOString().slice(0, 10), team: p.team, opponent: p.team === 'lal' ? 'gs' : 'lal', home: p.team === 'lal', played: true, position: 'G', minutes: 32, stats: { points: 25 } })));
const lines = players.map((p) => ({ player_name: p.name, stat: 'points', threshold: 15.5, side: 'over', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', start_utc: game.start_utc, observed_utc: at }));
const injuries = { state: 'ok', observed_utc: at, reports: [] };
const args = { sport: 'nba', game, players, rows, lines, injuries, model: null, matchup: null, allGames: [], now };
assert.equal(rankGameProps(args).picks.length, 2);

assert.equal(teamCode('LAR', 'nfl'), 'la', 'use the actual nflverse Rams id');
for (const [home, away] of [['Los Angeles Rams', 'Seattle Seahawks'], ['Seattle Seahawks', 'Los Angeles Rams']]) {
  assert.ok(lineMatchesGame({ home_team: home, away_team: away, start_utc: game.start_utc }, { ...game, home_team: home.startsWith('Los') ? 'la' : 'sea', away_team: away.startsWith('Los') ? 'la' : 'sea' }, 'nfl'));
}
const nflPlayers = players.map((p) => ({ ...p, team: p.team === 'lal' ? 'la' : 'sea', position: 'RB' }));
const nflRows = rows.map((r, i) => ({ ...r, sport: 'nfl', team: r.team === 'lal' ? 'la' : 'sea', opponent: r.team === 'lal' ? 'sea' : 'la', position: 'RB', stats: { receiving_yards: 40, rushing_yards: 35, targets: i % 20 >= 15 ? 8 : 2, carries: i % 20 >= 15 ? 1 : 20 } }));
const nflArgs = { ...args, sport: 'nfl', game: { ...game, home_team: 'la', away_team: 'sea' }, players: nflPlayers, rows: nflRows,
  lines: lines.map((l) => ({ ...l, home_team: 'Los Angeles Rams', away_team: 'Seattle Seahawks', stat: 'receiving_yards', threshold: 25.5 })) };
const nfl = rankGameProps(nflArgs);
assert.equal(nfl.picks.length, 2);
assert.equal(nfl.picks[0].features.workload.unit, 'targets', 'RB receiving props use targets, not declining carries');
assert.equal(nfl.picks[0].features.workload.last5, 8);
assert.equal(nfl.picks[0].rank_score, rankGameProps({ ...nflArgs, rows: nflRows.map((r) => ({ ...r, stats: { ...r.stats, carries: 20 } })) }).picks[0].rank_score, 'irrelevant carries cannot lower a receiving prop');
assert.equal(rankGameProps({ ...nflArgs, lines: nflArgs.lines.map((l) => ({ ...l, stat: 'rushing_yards' })) }).picks[0].features.workload.unit, 'carries');
const ramsInjuries = { ...injuries, reports: [{ name: players[0].name, team: teamCode('LAR', 'nfl'), espn_id: '1', status: 'Out' }] };
assert.equal(rankGameProps({ ...nflArgs, injuries: ramsInjuries }).availability[0].team, 'la');
assert.equal(rankGameProps({ ...nflArgs, injuries: ramsInjuries }).picks.length, 1);

for (const detail of ['No minutes restriction tonight.', 'He will not have a minutes restriction.', 'Available without a minutes limit.', 'He is not on a minutes restriction.', 'Cleared for unlimited minutes.']) {
  assert.equal(rankGameProps({ ...args, injuries: { ...injuries, reports: [{ name: players[0].name, status: 'Available', detail }] } }).picks.length, 2, detail);
}
for (const detail of ['A minutes restriction is expected.', 'He will be limited to 20 minutes.', 'He will be limited to 20–25 minutes.', 'No change to the minutes restriction.', 'No minutes restriction initially, but he will be limited to 20 minutes.']) {
  assert.equal(rankGameProps({ ...args, injuries: { ...injuries, reports: [{ name: players[0].name, status: 'Available', detail }] } }).picks.length, 1, detail);
}
assert.equal(rankGameProps({ ...args, injuries: { ...injuries, reports: [
  { name: players[0].name, espn_id: '999', team: 'gs', status: 'Out' }, { name: players[0].name, espn_id: '1', team: 'lal', status: 'Available' },
] } }).picks.length, 2, 'another known athlete cannot override the exact identity match');

const early = new Date(now + 30000).toISOString(), later = new Date(now + 300000).toISOString();
const timing = { ...args, game: { ...game, start_utc: later }, lines: lines.map((l) => ({ ...l, start_utc: early })) };
const before = rankGameProps(timing);
assert.equal(before.picks.length, 2);
assert.equal(rankGameProps({ ...timing, now: now + 60000 }).picks.length, 0, 'a late stored kickoff cannot keep provider-started picks open');
const loadTiming = async (kind, options = {}) => options.season != null && options.season !== 2026 ? null : ({ status: { seasons: [2026] }, games: { games: [timing.game] }, players: { players }, 'player-games': { rows } })[kind] || null;
const timingView = await recommendationsView({ load: loadTiming, sport: 'nba', now, tz: 'America/Los_Angeles', sources: { lines: { state: 'ok', lines: timing.lines }, injuries } });
assert.equal(timingView.expires_utc, early, 'the UI expiry follows the earlier feed kickoff');
let writes = 0;
const store = { backend: 'r2', rawGet: async () => null, rawPut: async () => { writes++; }, withLease: async (_, fn) => { await fn(() => {}); return { busy: false }; } };
const capture = await capturePropPicks({ store, view: timingView, now, clock: () => now + 60000 });
assert.equal(capture.state, 'ok'); assert.equal(capture.added, 0); assert.equal(writes, 0, 'late acquisition cannot record a post-kickoff line');

const originalFetch = globalThis.fetch; let fetches = 0;
globalThis.fetch = async (url) => {
  fetches++;
  return new Response(JSON.stringify(String(url).includes('prop-line') ? [{ id: 'cache-event', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', commence_time: early,
    bookmakers: [{ key: 'prizepicks', markets: [{ key: 'player_points', last_update: at, outcomes: [{ description: players[0].name, name: 'Over', point: 15.5, dfs_odds_type: 'standard' }] }] }] }]
    : { status: 'success', timestamp: at, injuries: [] }));
};
try {
  const params = { sport: 'nba', now, env: { PROPLINE_API_KEY: 'fixture-cache-boundary' } };
  assert.equal((await loadPropSources(params)).lines.lines.length, 1);
  assert.equal((await loadPropSources({ ...params, now: now + 60000 })).lines.lines.length, 0);
  assert.equal(fetches, 3, 'NBA reuses both bulk quote requests and the injury cache but still closes started events');
} finally { globalThis.fetch = originalFetch; }

// A real-size research dataset exceeds one function response. Every page
// must be bounded and a complete download must preserve every record.
const saved = Array.from({ length: 600 }, (_, i) => ({ ...before.picks[0], prop_id: 'large-' + i, game_id: 'large-game-' + i, slot: 1,
  issued_utc: at, rank_version: 'props-rank-test', evidence: [{ label: 'Original analysis', text: 'x'.repeat(10000) }] }));
let largeSchedule = [], largeRows = [];
const loadLarge = async (kind) => kind === 'prop-record' ? { picks: saved } : kind === 'games' ? { games: largeSchedule } : kind === 'player-games' ? { rows: largeRows } : null;
const first = await propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, all: true });
assert.ok(JSON.stringify(saved).length > 4500000);
assert.ok(Buffer.byteLength(JSON.stringify(first)) < PROP_RECORD_PAGE_BYTES + 30000);
assert.ok(first.records.length < 250 && first.next_offset > 0);
const collected = [...first.records]; let offset = first.next_offset;
while (offset != null) {
  const page = await propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, all: true, offset, asOf: first.as_of, snapshot: first.snapshot });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < PROP_RECORD_PAGE_BYTES + 30000);
  collected.push(...page.records); offset = page.next_offset;
}
assert.equal(collected.length, 600); assert.equal(new Set(collected.map((p) => p.prop_id)).size, 600);
assert.ok(collected.every((p) => p.evidence[0].text.length === 10000), 'paging cannot discard original evidence');
await assert.rejects(() => propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, offset: -1 }), (e) => e.status === 400);
await assert.rejects(() => propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, limit: 251 }), (e) => e.status === 400);
saved.push({ ...saved[0], prop_id: 'new-after-cutoff', issued_utc: new Date(now + 1000).toISOString() });
assert.equal((await propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now: now + 2000, offset: first.next_offset, asOf: first.as_of, snapshot: first.snapshot })).total, 600);
saved.push({ ...saved[0], prop_id: 'late-write-before-cutoff' });
await assert.rejects(() => propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, offset: first.next_offset, asOf: first.as_of, snapshot: first.snapshot }), (e) => e.status === 409);
saved.pop(); saved.pop();
largeSchedule = [{ ...game, game_id: saved[0].game_id, status: 'final' }];
largeRows = [{ game_id: saved[0].game_id, player_id: saved[0].player_id, played: true, stats: { points: 40 } }];
await assert.rejects(() => propRecordView({ load: loadLarge, sport: 'nba', seasons: [2026], now, offset: first.next_offset, asOf: first.as_of, snapshot: first.snapshot }), (e) => e.status === 409, 'stat corrections cannot silently mix export snapshots');

const route = async (query, session = { sub: 'fixture', tr: true, tp: true }) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } };
  await handleSportsRequest({ method: 'GET', headers: {}, query: { sports: 'props-record', sport: 'nba', download: '1', ...query } }, res,
    { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => session, store: { rawGet: async () => null }, now: () => now });
  return res;
};
assert.equal((await route({}, null)).code, 403, 'paged exports retain the Owner gate');
const emptyDownload = await route({});
assert.equal(emptyDownload.code, 200); assert.equal(emptyDownload.headers['Cache-Control'], 'private, no-store');
assert.equal((await route({ offset: '-1' })).code, 400);
assert.equal((await route({ limit: '251' })).code, 400);
assert.equal((await route({ snapshot: 'not-a-snapshot' })).code, 400);
assert.equal((await route({ as_of: 'not-a-date' })).code, 400);
console.log('Sports prop audit passed: Rams identities, stat-specific workload, injury clearances, kickoff/cache races, bounded complete exports and snapshot consistency.');

#!/usr/bin/env node
// Owner Sports tools on the Mingstreet MCP (lib/mcp/sports-tools.mjs): who
// sees them, the kill switch, each tool's answer, parity with the Pick
// Builder route (same chance, same seed), the prefill link (no chances), the
// next-game fallback, argument checks, and that the store they hold can only
// read Sports records and never writes. Offline, fake store, signed token.
import assert from 'node:assert/strict';

const ENV = { PRIVATE_DATA_ENABLED: '1', SESSION_SECRET: 'test-session-secret-0123456789abcdef' };
const { handleMcpRequest } = await import('../lib/mcp/server.mjs');
const { tokens, OWNER_SCOPE } = await import('../lib/mcp/tokens.mjs');
const { sportsReadOnlyStore } = await import('../lib/mcp/read-only-store.mjs');
const { validateArgs, TOOLS } = await import('../lib/mcp/tools.mjs');
const { buildModel, modelSummary } = await import('../lib/sports/models.mjs');
const { packRows } = await import('../lib/sports/rows.mjs');
const { sportsKey, SPORTS_PREFIX } = await import('../lib/sports/store.mjs');
const { handleSportsRequest } = await import('../lib/sports/http.mjs');
const { decodePrefill } = await import('../lib/sports/prefill.mjs');
const { nbaModelLeague } = await import('./fixtures/sports-model.mjs');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const HOST = 'mingstreet.test', ORIGIN = 'https://' + HOST;
const NOW = Date.parse('2026-01-15T12:00:00Z');
const L = nbaModelLeague({ pace: 0.2 });
const model = buildModel({ sport: 'nba', rows: L.rows, now: NOW });
const objects = new Map();
const writes = [];
const store = {
  backend: 'r2',
  get: async () => null,
  rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
};
for (const m of ['put', 'del', 'list', 'withLease', 'publishGeneration', 'gcGenerations', 'rawPut', 'rawDel', 'rawList']) store[m] = async (k) => { writes.push([m, k]); };
const put = (kind, opts, value) => objects.set(sportsKey(kind, opts), JSON.stringify(value));
const next = { sport: 'nba', game_id: 'mnext1', season: 2025, season_type: 'REG', week: null, start_utc: '2026-01-16T03:00:00Z', local_date: '2026-01-15', time_tbd: false, home_team: 'gs', away_team: 'bos', status: 'scheduled', home_score: null, away_score: null, venue: null };
put('games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, games: [...L.games, next] });
put('player-games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, ...packRows(L.rows) });
put('players', { sport: 'nba' }, { schema_version: 1, players: L.players });
put('model', { sport: 'nba' }, { schema_version: 1, ...model, seasons: [2025] });
put('status', { sport: 'nba' }, { schema_version: 1, sport: 'nba', state: 'ok', last_success_utc: '2026-01-15T10:00:00Z', seasons: [2025], counts: { games: 481, player_games: L.rows.length, players: 96 }, model: modelSummary({ ...model, seasons: [2025] }) });
objects.set(SPORTS_PREFIX + 'markets/observations.json', JSON.stringify({ observations: [{ secret: 'line' }] }));
objects.set('_stonks/contact/v1/messages.json', '{}');

function mkRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    end(v) { if (v !== undefined) this.body = v; return this; },
  };
}
const ownerToken = await tokens.signAccess(ENV, ORIGIN, ORIGIN + '/mcp', { sub: 'owner-sub', nm: 'owner', cid: 'client-1', scope: OWNER_SCOPE });
const guestToken = await tokens.signAccess(ENV, ORIGIN, ORIGIN + '/mcp', { sub: 'guest-sub', nm: 'guest', cid: 'client-1', scope: '' });
async function rpc(method, params, { token = ownerToken, env = {} } = {}) {
  const res = mkRes();
  await handleMcpRequest({ method: 'POST', url: '/mcp', query: {}, headers: { host: HOST, 'x-forwarded-proto': 'https', 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: { jsonrpc: '2.0', id: 1, method, params } }, res, { env: { ...ENV, ...env }, store, now: () => NOW });
  return res.body;
}
const tool = async (name, args, opts) => (await rpc('tools/call', { name, arguments: args }, opts)).result;
const SPORTS_TOOLS = ['sports_list_games', 'sports_find_players', 'sports_get_game', 'sports_get_player', 'sports_evaluate_entry', 'sports_get_model_check'];

// --- who sees the tools ------------------------------------------------------------
const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
ok(SPORTS_TOOLS.every((n) => names.includes(n)), 'the Owner sees the Sports tools');
ok((await rpc('tools/list', {})).result.tools.filter((t) => t.name.startsWith('sports_')).every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint), 'all marked read-only');
eq((await rpc('tools/list', {}, { token: guestToken })).result.tools.filter((t) => t.name.startsWith('sports_')), [], 'a non-owner token sees none');
eq((await rpc('tools/list', {}, { env: { SPORTS_ENABLED: '0' } })).result.tools.filter((t) => t.name.startsWith('sports_')), [], 'SPORTS_ENABLED=0 hides them');
ok(/Unknown tool/.test((await rpc('tools/call', { name: 'sports_list_games', arguments: { sport: 'nba' } }, { env: { SPORTS_ENABLED: '0' } })).error.message), 'and they cannot be called');
ok(/Unknown tool/.test((await rpc('tools/call', { name: 'sports_list_games', arguments: { sport: 'nba' } }, { token: guestToken })).error.message), 'a non-owner cannot call them');
ok(!TOOLS.some((t) => /save|write|place|bet/i.test(t.name)), 'there is no save tool');

// --- reads -----------------------------------------------------------------------
const board = await tool('sports_list_games', { sport: 'nba', time_zone: 'America/New_York' });
eq([board.isError, board.structuredContent.access, board.structuredContent.ai_calls], [false, 'owner', 0]);
const B = board.structuredContent.results;
ok(B.window.time_zone === 'America/New_York' && B.games.some((g) => g.game_id === 'mnext1'), 'today’s games in the chosen zone, with ids');
eq(board.structuredContent.as_of, '2026-01-15T10:00:00Z', 'as_of is the league’s last data run');
const gsStar = L.truth.find((p) => p.team === 'gs' && p.minutes === 34), bosStar = L.truth.find((p) => p.team === 'bos' && p.minutes === 34);
const found = await tool('sports_find_players', { sport: 'nba', name: gsStar.name.split(' ').slice(0, 2).join(' ').toLowerCase() });
ok(found.structuredContent.results.players.some((p) => p.player_id === gsStar.player_id), 'finds a player by name');
ok((await tool('sports_find_players', { sport: 'nba', name: 'zzzz' })).structuredContent.warnings.some((w) => /NO_MATCH/.test(w)), 'no match is said');
const game = await tool('sports_get_game', { sport: 'nba', game_id: 'mnext1' });
ok(game.structuredContent.results.game.game_id === 'mnext1' && game.structuredContent.results.teams, 'one game with its teams');
const gamePlayers = Object.values(game.structuredContent.results.teams).flatMap((t) => t.players);
ok(gamePlayers.length > 0 && gamePlayers.every((p) => !('recent' in p) && !('summaries' in p) && typeof p.average.points === 'number' && typeof p.last5.points === 'number' && p.stat_games.points > 0), 'the page’s chart values stay off the MCP; averages stay as numbers');
eq(JSON.parse((await tool('sports_get_game', { sport: 'nba', game_id: 'nope' })).content[0].text).error.code, 'NOT_FOUND');
eq(game.structuredContent.results.shown_stats, ['minutes', 'points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'turnovers'], 'averages of the main stats by default');
ok(gamePlayers.every((p) => Object.keys(p.average).every((st) => game.structuredContent.results.shown_stats.includes(st))), 'and nothing else');
const comboGame = (await tool('sports_get_game', { sport: 'nba', game_id: 'mnext1', stats: ['pts_reb', 'fantasy'] })).structuredContent.results;
const comboPlayer = Object.values(comboGame.teams).flatMap((t) => t.players)[0];
eq(Object.keys(comboPlayer.average), ['pts_reb', 'fantasy'], 'or the stats asked for, combos included');
ok(comboPlayer.stat_games.pts_reb > 0 && typeof comboPlayer.average.pts_reb === 'number', 'combo averages come from the stored rows');
ok(!JSON.stringify(comboGame).includes('object with'), 'nothing is cut by the size limit');
const GM = game.structuredContent.results.matchup, gTeams = Object.keys(GM.teams);
ok(GM.teams_ranked > 0 && gTeams.length === 2 && gTeams.every((t) => GM.teams[t] && typeof GM.teams[t].rank.win_pct === 'number'), 'the matchup: both teams with league ranks');
ok(gTeams.every((t) => typeof GM.stats[t].allowed.points === 'number' && Number.isInteger(GM.allowed_by_rank[t].G.points)), 'what each defense allows, with ranks by position');
ok(Object.keys(GM.stats[gTeams[0]].for).every((st) => game.structuredContent.results.shown_stats.includes(st)), 'matchup stats follow the shown stats');
ok(Array.isArray(GM.meetings) && GM.meeting_summary.games === GM.meetings.length, 'and the stored meetings');
ok(gamePlayers.every((p) => Number.isInteger(p.vs_opp_games) && typeof p.vs_opp_avg === 'object'), 'each player’s games against this opponent');
ok(!JSON.stringify(game.structuredContent).includes('object with'), 'the default game view is not cut either');
eq(JSON.parse((await tool('sports_get_game', { sport: 'nba', game_id: 'mnext1', stats: ['passing_yards'] })).content[0].text).error.code, 'INVALID_INPUT', 'stats from the other league are refused');
const player = await tool('sports_get_player', { sport: 'nba', player_id: gsStar.player_id, games: 5 });
const P = player.structuredContent.results;
eq([P.next_game.game_id, P.games.length, P.forecast.forecasts.points.status], ['mnext1', 5, 'ok'], 'log, next game and its forecast');
ok(!/\[omitted|object with|more keys/.test(JSON.stringify(P)), 'the player view is not cut by the size limit');
ok(typeof P.games[0].stats.pts_reb === 'number' && typeof P.summaries.pts_reb.average === 'number' && P.summaries.fantasy.average === null, 'the log carries combos (fantasy needs assists, which this made-up league has none of)');

// --- evaluate: the same answer as the Pick Builder ---------------------------------
const legs = [
  { sport: 'nba', player_id: gsStar.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5, chance: 0.55 },
  { sport: 'nba', player_id: bosStar.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5, chance: 0.5 },
];
const ev = await tool('sports_evaluate_entry', { legs, operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } });
const E = ev.structuredContent.results;
const siteRes = mkRes();
await handleSportsRequest({ method: 'POST', headers: { origin: ORIGIN, host: HOST, 'x-forwarded-proto': 'https' }, query: { sports: 'evaluate' }, body: { legs: legs.map(({ chance, ...l }) => ({ ...l, probability: chance })), operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } } }, siteRes,
  { env: ENV, getSession: async () => ({ sub: 'owner-sub', tr: true, tp: true }), store: { ...store, withLease: undefined }, now: () => NOW });
const S = siteRes.body.evaluation;
eq([E.evaluation.status, E.evaluation.joint_probability, E.evaluation.simulation.seed, E.evaluation.expected_net], [S.status, S.joint_probability, S.simulation.seed, S.expected_net], 'the MCP and the Pick Builder give the same same-game number and seed');
eq(E.evaluation.status, 'joint_estimate');
eq(E.legs.map((l) => [l.chance, l.chance_source]), [[0.55, 'owner'], [0.5, 'owner']], 'chances given are the owner’s');
ok(E.pick_builder_link.startsWith(ORIGIN + '/?tab=sports-pick-builder&entry='), 'returns a Pick Builder link: ' + E.pick_builder_link.slice(0, 80));
const pre = decodePrefill(E.pick_builder_link.split('entry=')[1]);
eq([pre.operator, pre.format, pre.stake, pre.payouts, pre.legs.map((l) => [l.player_id, l.game_id, l.stat, l.side, l.threshold])],
  ['prizepicks', 'power', 10, { 2: 3 }, legs.map((l) => [l.player_id, l.game_id, l.stat, l.side, l.threshold])], 'the link fills the same entry');
ok(!JSON.stringify(pre).includes('0.55') && pre.legs.every((l) => !('probability' in l)), 'the link carries no chances');
eq(ev.structuredContent.source.saves, false, 'says it saves nothing');

// Model chances only on request; the next game when no game id is given.
const bare = await tool('sports_evaluate_entry', { legs: [{ sport: 'nba', player_id: gsStar.player_id, stat: 'points', side: 'over', threshold: 15.5 }], operator: 'betr', format: 'power', stake: 5, payouts: { 1: 1.8 } });
const BR = bare.structuredContent;
eq([BR.results.legs[0].game_id, BR.results.legs[0].chance, BR.results.evaluation.status], ['mnext1', null, 'needs_probabilities'], 'no chance is filled in by itself; the next game is used');
ok(BR.warnings.some((w) => /GAME_FROM_SCHEDULE/.test(w)), 'and the fallback game is flagged');
const withModel = (await tool('sports_evaluate_entry', { legs: [{ sport: 'nba', player_id: gsStar.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5 }], operator: 'betr', format: 'power', stake: 5, payouts: { 1: 1.8 }, use_model_chances: true })).structuredContent.results;
eq([withModel.legs[0].chance, withModel.legs[0].chance_source, withModel.evaluation.status], [withModel.legs[0].model.probability, 'model', 'independence_baseline'], 'use_model_chances copies the model’s chance, labeled');

// Argument checks and owner-fixable errors.
const errCode = async (args) => { const r = await tool('sports_evaluate_entry', args); return r.isError ? JSON.parse(r.content[0].text).error : null; };
eq((await errCode({ legs: [{ ...legs[0], extra: 1 }] })).code, 'INVALID_INPUT', 'unknown leg fields are refused');
eq((await errCode({ legs: [{ ...legs[0], chance: 1.5 }] })).code, 'INVALID_INPUT', 'a chance above 1 is refused');
eq((await errCode({ legs, payouts: { 9: 3 } })).code, 'INVALID_INPUT', 'payout keys are numbers of picks');
eq((await errCode({ legs: Array(7).fill(legs[0]) })).code, 'INVALID_INPUT', 'at most six picks');
const badLine = await errCode({ legs: [{ ...legs[0], threshold: 15.3 }] });
ok(badLine.code === 'INVALID_INPUT' && /whole or half/.test(badLine.message), 'the Pick Builder’s own reasons come through: ' + badLine.message);
eq((await errCode({ legs: [{ ...legs[0], game_id: 'nope' }] })).code, 'INVALID_INPUT', 'an unknown game');
ok(validateArgs(TOOLS.find((t) => t.name === 'sports_evaluate_entry').inputSchema, { legs, use_model_chances: false }), 'a valid entry passes the schema check');
const comboRaw = await tool('sports_evaluate_entry', { legs: [{ sport: 'nba', player_id: gsStar.player_id, game_id: 'mnext1', stat: 'pts_reb', side: 'over', threshold: 20.5 }] });
const comboEv = comboRaw.structuredContent.results;
ok(comboEv.legs[0].hit_history.all.games > 0 && comboEv.legs[0].model.reason === 'stat', 'a combo pick gets history and says it has no forecast');
ok(E.legs.every((l) => Number.isInteger(l.hit_history.last10.hits) && Number.isInteger(l.hit_history.all.games)), 'history hit counts come through as numbers');
ok(decodePrefill(comboEv.pick_builder_link.split('entry=')[1]).legs[0].stat === 'pts_reb', 'and the Pick Builder link keeps the combo');
eq((await errCode({ legs: [{ ...legs[0], stat: 'goals' }] })).code, 'INVALID_INPUT', 'an unknown stat is refused');

// --- model check -------------------------------------------------------------------
const mc = (await tool('sports_get_model_check', { sport: 'nba' })).structuredContent.results;
ok(mc.model.stats.points.status && mc.model.links.length > 0 && /stand-in|last-10/.test(mc.model.line_proxy), 'stat checks and same-game links');
eq(mc.journal.summary.entries, 0, 'paper journal totals');
const nfl = await tool('sports_get_model_check', { sport: 'nfl' });
ok(nfl.structuredContent.results.model === null && nfl.structuredContent.warnings.some((w) => /NO_MODEL|NOT_CONNECTED/.test(w)), 'a league without data says so');

// --- the store the tools hold ----------------------------------------------------------
eq(writes, [], 'no tool wrote anything');
const ro = sportsReadOnlyStore(store);
await assert.rejects(ro.rawGet(SPORTS_PREFIX + 'markets/observations.json'), /read-only/, 'captured lines are not readable');
await assert.rejects(ro.rawGet('_stonks/contact/v1/messages.json'), /read-only/, 'nothing outside Sports is readable');
await assert.rejects(ro.rawGet(SPORTS_PREFIX + 'nba/../journal/entries.json'), /read-only/);
await assert.rejects(ro.rawPut(SPORTS_PREFIX + 'journal/entries.json', '{}'), /read-only/, 'and nothing is writable');
await assert.rejects(ro.withLease('sports-journal', async () => {}), /read-only/);
ok((await ro.rawGet(sportsKey('model', { sport: 'nba' }))) != null, 'Sports records are');
eq(sportsReadOnlyStore({ get: async () => null }), null, 'a store without raw reads gives no Sports access');
checks += 6;

console.log(`Sports MCP smoke passed (${checks} checks).`);

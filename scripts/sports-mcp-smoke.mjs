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
const { nbaName } = await import('../lib/sports/nba-market.mjs');
const { buildTeamModel } = await import('../lib/sports/team-model.mjs');

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
{
  const r0 = L.rows.find((r) => r.played && r.stats.points != null);
  const r1 = L.rows.find((r) => r.played && r.stats.points != null && r.game_id !== r0.game_id);
  const pick = (r, threshold, issued, slot) => ({ prop_id: 'p-' + r.game_id + '-' + r.player_id, game_id: r.game_id, player_id: r.player_id, team: r.team, stat: 'points', side: 'over', threshold, slot,
    rank_score: 64, rank_version: 'nba-test-1', basis: 'model', issued_utc: issued, model: { probability: 0.6 },
    evidence: [{ label: 'History', text: 'cleared 7 of 10' }], features: { home: true }, availability: [{ name: 'X', team: r.team, status: 'out' }] });
  put('prop-record', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, updated_utc: '2026-01-15T11:30:00Z', picks: [
    pick(r0, r0.stats.points - 0.5, '2025-10-21T20:00:00Z', 1), pick(r1, r1.stats.points + 0.5, '2025-10-22T20:00:00Z', 1),
    { ...pick({ ...r0, game_id: 'mnext1' }, 15.5, '2026-01-15T11:00:00Z', 1), prop_id: 'p-next' },
  ] });
}
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
// The live feeds (injuries, NBA sportsbook prices) are faked: the tools read
// them through ctx.loadPropSources, never the network here.
let feedCalls = [];
let feedState = 'ok';
const QUOTE_AT = new Date(NOW).toISOString();
const bookQuote = (book, name, threshold, over) => ({ event_id: 'pl-1', home_team: 'Golden State Warriors', away_team: 'Boston Celtics', start_utc: '2026-01-16T03:00:00Z', book, stat: 'points',
  player_name: name, player_key: nbaName(name), threshold, sides: { over: { observed_utc: QUOTE_AT, book_updated_at: null }, under: { observed_utc: QUOTE_AT, book_updated_at: null } },
  over_probability: over, under_probability: 1 - over, vig_method: 'shin', margin: 0.05, observed_utc: QUOTE_AT });
async function fakeSources({ sport, parts }) {
  feedCalls.push([sport, parts.join(',')]);
  if (feedState !== 'ok') return { injuries: { state: 'unavailable', reports: [] }, ...(sport === 'nba' ? { reference: { state: 'unavailable', quotes: [] } } : {}) };
  return {
    injuries: { state: 'ok', observed_utc: QUOTE_AT, reports: [
      { name: gsStar.name, espn_id: '', team: 'gs', team_name: 'Golden State Warriors', status: 'Questionable', detail: 'Ankle', report_utc: QUOTE_AT },
      { name: 'Some Teammate', espn_id: '', team: 'gs', team_name: 'Golden State Warriors', status: 'Out', detail: 'Knee', report_utc: QUOTE_AT },
      { name: gsSecond.name, espn_id: gsSecond.player_id, team: 'gs', team_name: 'Golden State Warriors', status: 'Doubtful', detail: 'Back', report_utc: QUOTE_AT },
    ] },
    ...(sport === 'nba' ? { reference: { state: 'ok', quotes: ['draftkings', 'fanduel', 'betmgm'].flatMap((b, i) => [bookQuote(b, gsStar.name, 15.5, 0.69 + i * 0.01), bookQuote(b, gsStar.name, 17.5, 0.5)]) } } : {}),
  };
}
async function rpc(method, params, { token = ownerToken, env = {}, now = NOW } = {}) {
  const res = mkRes();
  await handleMcpRequest({ method: 'POST', url: '/mcp', query: {}, headers: { host: HOST, 'x-forwarded-proto': 'https', 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: { jsonrpc: '2.0', id: 1, method, params } }, res, { env: { ...ENV, ...env }, store, now: () => now, loadPropSources: fakeSources });
  return res.body;
}
const ro0 = sportsReadOnlyStore(store);
const tool = async (name, args, opts) => (await rpc('tools/call', { name, arguments: args }, opts)).result;
const SPORTS_TOOLS = ['sports_list_games', 'sports_find_players', 'sports_get_game', 'sports_team_odds', 'sports_get_player', 'sports_evaluate_entry', 'sports_get_model_check', 'sports_get_prop_record', 'sports_get_league_stats'];

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
const gsSecond = L.truth.find((p) => p.team === 'gs' && p.minutes === 31);
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
// Live context on the player: the injury report and every book line with the model beside it.
eq([P.availability.status, P.availability.unsure, P.availability.teammates_out], ['Questionable', true, ['Some Teammate', gsSecond.name]], 'the player carries the injury report');
// Teammates out: only the stored regular counts (Some Teammate is not in the store).
const tPts = P.forecast?.forecasts?.points?.teammates_out;
ok(tPts && tPts.minutes > 25 && tPts.minutes < 40, 'the player forecast counts the doubtful regular’s minutes: ' + JSON.stringify(tPts));
eq(tPts.applied, (model.context.absence?.points?.beta || 0) > 0, 'and raises it only when the check found a lift');
eq(P.book_lines.map((b) => [b.stat, b.threshold, b.book_over, b.books]), [['points', 15.5, 0.7, 3], ['points', 17.5, 0.5, 3]], 'every book line for the next game, median no-vig over chance');
ok(P.book_lines.every((b) => typeof b.model_over === 'number' && b.model_over > 0 && b.model_over < 1 && Math.abs(b.gap - (b.model_over - b.book_over)) < 1e-4), 'the model’s over chance sits beside each book line');
ok(player.structuredContent.warnings.some((w) => /INJURY: listed Questionable/.test(w)), 'an injury listing is a warning');
// Splits: the player page's Vs teams, Seasons and Splits views as numbers.
const SP = P.splits;
ok(SP && SP.games_used > 5 && SP.all.games === SP.games_used && SP.home.games + SP.away.games === SP.games_used, 'splits: overall, home and away add up');
ok(SP.stats.includes('points') && typeof SP.all.avg.points === 'number' && SP.by_season.length >= 1 && SP.by_season.reduce((a, x) => a + x.games, 0) === SP.games_used, 'by season covers every played game');
ok(SP.by_opponent.length >= 1 && SP.by_opponent.every((o) => o.games >= 1 && typeof o.avg.points === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(o.last_date)), 'by opponent, with the last meeting');
ok(SP.team_won.games + SP.team_lost.games <= SP.games_used && 'back_to_back' in SP.rest && 'favored' in SP, 'by result, rest and the spread');
ok(SP.games_used <= P.total_games && /the newest \d+/.test(SP.note) && !/object with|more keys/.test(JSON.stringify(SP)), 'splits say how many games they cover, uncut by the size limit');

// --- evaluate: the same answer as the Pick Builder ---------------------------------
const legs = [
  { sport: 'nba', player_id: gsStar.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5, chance: 0.55 },
  { sport: 'nba', player_id: bosStar.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5, chance: 0.5 },
];
const ev = await tool('sports_evaluate_entry', { legs, operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } });
const E = ev.structuredContent.results;
{ // A lineup the client knows rides the pick into the model and the Pick Builder link.
  const evS = (await tool('sports_evaluate_entry', { legs: [{ ...legs[0], starting: false }, legs[1]], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } })).structuredContent;
  eq(evS.results.legs[0].model.lineup?.starting ?? null, evS.results.legs[0].model.status === 'ok' ? false : null, 'the model read shows the given lineup');
  ok(/entry=/.test(evS.results.pick_builder_link), 'still returns the link');
  const pl = (await tool('sports_get_player', { sport: 'nba', player_id: gsStar.player_id, starting: true })).structuredContent;
  ok(pl.results.forecast == null || Object.values(pl.results.forecast.forecasts).every((f) => f.status !== 'ok' || f.lineup?.starting === true), 'sports_get_player passes starting to the forecast');
}
const siteRes = mkRes();
await handleSportsRequest({ method: 'POST', headers: { origin: ORIGIN, host: HOST, 'x-forwarded-proto': 'https' }, query: { sports: 'evaluate' }, body: { legs: legs.map(({ chance, ...l }) => ({ ...l, probability: chance })), operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } } }, siteRes,
  { env: ENV, getSession: async () => ({ sub: 'owner-sub', tr: true, tp: true }), store: { ...store, withLease: undefined }, now: () => NOW, loadPropSources: fakeSources });
const S = siteRes.body.evaluation;
eq(siteRes.body.legs.map((l) => l.model.probability), E.legs.map((l) => l.model.probability), 'the site and the MCP read the same injury report, so the model chances match');
eq(siteRes.body.legs.map((l) => l.availability.status), E.legs.map((l) => l.availability.status), 'and show the same listings');
eq([E.evaluation.status, E.evaluation.joint_probability, E.evaluation.simulation.seed, E.evaluation.expected_net], [S.status, S.joint_probability, S.simulation.seed, S.expected_net], 'the MCP and the Pick Builder give the same same-game number and seed');
eq(E.evaluation.status, 'joint_estimate');
eq(E.legs.map((l) => [l.chance, l.chance_source]), [[0.55, 'owner'], [0.5, 'owner']], 'chances given are the owner’s');
ok(E.pick_builder_link.startsWith(ORIGIN + '/?tab=sports-pick-builder&entry='), 'returns a Pick Builder link: ' + E.pick_builder_link.slice(0, 80));
const pre = decodePrefill(E.pick_builder_link.split('entry=')[1]);
eq([pre.operator, pre.format, pre.stake, pre.payouts, pre.legs.map((l) => [l.player_id, l.game_id, l.stat, l.side, l.threshold])],
  ['prizepicks', 'power', 10, { 2: 3 }, legs.map((l) => [l.player_id, l.game_id, l.stat, l.side, l.threshold])], 'the link fills the same entry');
ok(!JSON.stringify(pre).includes('0.55') && pre.legs.every((l) => !('probability' in l)), 'the link carries no chances');
eq(ev.structuredContent.source.saves, false, 'says it saves nothing');
// The books' price, the injury report and the per-pick breakeven ride along.
const B0 = E.legs[0].book, B1 = E.legs[1].book;
eq([B0.state, B0.chance, B0.book_count, B0.method, B0.vig_method], ['supported', 0.7, 3, 'exact', 'shin'], 'the books’ no-vig price for the same line (median of three)');
eq([B1.state, B1.chance], ['unavailable', null], 'no line posted: no price');
const gap0 = E.legs[0].model.probability - 0.7;
eq(E.legs[0].book_vs_model, { gap: Math.round(gap0 * 10000) / 10000, disagrees: Math.abs(gap0) >= 0.05, leans: gap0 > 0 ? 'model_higher' : 'book_higher' }, 'model against the books');
eq(ev.structuredContent.warnings.some((w) => /BOOK_DISAGREES: Pick 1/.test(w)), Math.abs(gap0) >= 0.05, 'a 5+ point gap is flagged');
ok(ev.structuredContent.warnings.some((w) => /INJURY: Pick 1 .*Questionable/.test(w)) && ev.structuredContent.warnings.some((w) => /TEAMMATES_OUT: Pick 1 .*Some Teammate/.test(w)), 'injury and teammate absences are flagged');
const tNote = ev.structuredContent.warnings.find((w) => /TEAMMATES_OUT: Pick 1/.test(w));
ok(E.legs[0].model.teammates_out?.minutes > 25 && (E.legs[0].model.teammates_out.applied ? /raised its forecast/ : /no reliable lift/).test(tNote), 'the note says what the model did with them: ' + tNote);
ok(!E.legs[1].model.teammates_out, 'the other team has nobody out');
eq(E.legs[1].availability.status, 'not listed');
ok(Math.abs(E.evaluation.breakeven_per_pick - Math.sqrt(1 / 3)) < 1e-6, 'each pick needs the square root of 1/3 on a 2-pick 3x power play');
ok(E.legs[0].hit_history.all.range && E.legs[0].hit_history.all.range.low <= E.legs[0].hit_history.all.range.high, 'hit counts carry a 95% range');
ok(feedCalls.some(([sport, parts]) => sport === 'nba' && parts === 'injuries,reference'), 'the PrizePicks board is not read for this');
// Book chances only on request, labeled.
const withBook = (await tool('sports_evaluate_entry', { legs: legs.map(({ chance, ...l }) => l), operator: 'betr', format: 'power', stake: 5, payouts: { 2: 3 }, use_book_chances: true })).structuredContent;
eq(withBook.results.legs.map((l) => [l.chance, l.chance_source]), [[0.7, 'book'], [null, null]], 'use_book_chances copies the exact book price, labeled');
ok(withBook.warnings.some((w) => /NO_CHANCE: 1 pick/.test(w)), 'a pick with no book price is said');
// A feed outage only leaves the live parts out.
feedState = 'down';
const quiet = (await tool('sports_evaluate_entry', { legs, operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } })).structuredContent;
eq([quiet.results.legs[0].book.state, quiet.results.legs[0].availability.state, quiet.results.evaluation.status], ['unavailable', 'unavailable', 'joint_estimate'], 'the entry is still checked');
ok(quiet.warnings.some((w) => /NO_BOOK_PRICES/.test(w)), 'and the missing prices are said');
feedState = 'ok';

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
ok(comboEv.legs[0].hit_history.all.games > 0 && comboEv.legs[0].model.status === 'ok' && comboEv.legs[0].model.probability > 0, 'a combo pick gets history and its own forecast (combos are modeled since sports-model-3)');
const fgmEv = (await tool('sports_evaluate_entry', { legs: [{ sport: 'nba', player_id: gsStar.player_id, game_id: 'mnext1', stat: 'field_goals_made', side: 'over', threshold: 5.5 }] })).structuredContent.results;
eq(fgmEv.legs[0].model.reason, 'stat', 'a stat with no model says it has no forecast');
ok(E.legs.every((l) => Number.isInteger(l.hit_history.last10.hits) && Number.isInteger(l.hit_history.all.games)), 'history hit counts come through as numbers');
ok(decodePrefill(comboEv.pick_builder_link.split('entry=')[1]).legs[0].stat === 'pts_reb', 'and the Pick Builder link keeps the combo');
eq((await errCode({ legs: [{ ...legs[0], stat: 'goals' }] })).code, 'INVALID_INPUT', 'an unknown stat is refused');

// --- how current the data is, and the game's spread and total (2026-11-11) ---------
eq([P.data_check?.last_update_utc, P.data_check?.stale], ['2026-01-15T10:00:00Z', false], 'the player view says when the data last updated');
ok(!('next_game_lines' in P) && !P.forecast.game_lines, 'no spread or total archived for the game yet: none shown, none assumed');
eq(E.legs.map((l) => l.game_lines), [null, null], 'and none on the picks');
eq(Object.keys(E.data_check), ['nba'], 'evaluate says how current each league in the entry is');
const staleRun = await tool('sports_get_player', { sport: 'nba', player_id: gsStar.player_id }, { now: NOW + 2 * 86400000 });
ok(staleRun.structuredContent.warnings.some((w) => /STALE_DATA/.test(w)) && staleRun.structuredContent.results.data_check.stale === true, 'two days without a data run is flagged');
// The props scan archives the books' spread and total every half hour.
put('lines', { sport: 'nba', date: '2026-01-15' }, { schema_version: 1, sport: 'nba', date: '2026-01-15', fields: [], lines: [], game_fields: ['total', 'home_margin', 'observed_utc'], games: { mnext1: [228.5, 4.5, QUOTE_AT] } });
const P2 = (await tool('sports_get_player', { sport: 'nba', player_id: gsStar.player_id, games: 5 })).structuredContent.results;
const GL = P2.next_game_lines;
eq([GL?.total, GL?.home_margin, GL?.favorite, GL?.home_team_total, GL?.away_team_total, GL?.source], [228.5, 4.5, 'gs', 116.5, 112, 'sportsbooks'], 'the player view shows the next game’s spread and total');
eq([P2.forecast.game_lines?.total, P2.forecast.game_lines?.team_margin, P2.forecast.game_lines?.team_total], [228.5, 4.5, 116.5], 'and the forecast names the game it assumed');
const E2 = (await tool('sports_evaluate_entry', { legs, operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } })).structuredContent.results;
eq(E2.legs.map((l) => [l.game_lines?.total, l.game_lines?.team_margin, l.game_lines?.team_total, l.game_lines?.source]), [[228.5, 4.5, 116.5, 'sportsbooks'], [228.5, -4.5, 112, 'sportsbooks']], 'each pick carries its team’s side of the spread and total');
eq(E2.legs.map((l) => [l.model.game_lines?.team_total, l.model.game_lines?.applied]), [[116.5, false], [112, false]], 'the forecast says it saw them, and that this model has no tested spread/total input, so it does not use them');
eq(E2.legs.map((l) => l.model.probability), E.legs.map((l) => l.model.probability), 'and its chances are unchanged');
const G2 = (await tool('sports_get_game', { sport: 'nba', game_id: 'mnext1' })).structuredContent.results;
eq([G2.game_lines?.favorite, G2.game_lines?.total], ['gs', 228.5], 'the game view shows them too');

// --- team vs team odds (2026-11-12) ----------------------------------------------------
{
  eq(G2.team_bets?.status, 'not_fitted', 'no team model stored yet: the game view says so');
  const noModel = await tool('sports_team_odds', { sport: 'nba', game_id: 'mnext1' });
  ok(noModel.structuredContent.warnings.some((w) => /NO_FORECAST/.test(w)), 'and the team odds tool too');
  // A season before, so the model has a held-out season to check on.
  const prev = L.games.map((x) => ({ ...x, game_id: 'p' + x.game_id, season: 2024, start_utc: new Date(Date.parse(x.start_utc) - 365 * 86400000).toISOString(), local_date: undefined }));
  const TM = buildTeamModel({ sport: 'nba', games: [...prev, ...L.games], now: NOW });
  put('team-model', { sport: 'nba' }, { schema_version: 1, ...TM });
  feedCalls = [];
  const T = await tool('sports_team_odds', { sport: 'nba', game_id: 'mnext1', bets: [{ market: 'win_by', team: 'gs', line: 20, price: 450 }, { market: 'spread', team: 'bos', line: 4.5 }, { market: 'total', side: 'over', line: 228.5 }, { market: 'win_by', team: 'xx', line: 5 }] });
  ok(!T.isError, 'team odds read: ' + JSON.stringify(T).slice(0, 300));
  const R = T.structuredContent.results;
  eq([R.forecast.mode, R.forecast.market.total, R.forecast.market.home_margin], ['market', 228.5, 4.5], 'starts from the archived spread and total');
  ok(Math.abs(R.forecast.win.home + R.forecast.win.away - 1) < 0.002 && R.forecast.win.home > 0.5, 'the favorite is more likely to win');
  ok(!('pmf' in R.forecast), 'the raw distributions stay on the page');
  eq(R.bets[0].label, 'GS to win by 20+', 'a win-by bet');
  ok(R.bets[0].breakeven > 0.18 && R.bets[0].breakeven < 0.182 && typeof R.bets[0].ev_per_dollar === 'number', 'with breakeven and expected value from +450');
  ok(Math.abs(R.bets[1].chance - (1 - R.ladder.find((x) => x.label === 'GS −4.5').chance)) < 0.001, 'the underdog side of the spread mirrors the favorite');
  ok(T.structuredContent.warnings.some((w) => /^BET_4: team must be/.test(w)), 'a bad bet is named, the rest still priced');
  ok(Object.keys(R.win_by_ladder.gs).length === 30 && R.win_by_ladder.bos['30+'] != null && Math.abs(R.win_by_ladder.gs['1+'] - R.forecast.win.home) <= 0.001, 'win-by ladder (1+ to 30+) starts at the win chance');
  ok(R.teams.gs.rating && R.teams.bos.results.games > 0, 'team ratings and results');
  ok(R.check.moneyline.n > 0 && ['validated', 'not_validated', 'learning'].includes(R.check.moneyline.status), 'how each market held up');
  ok(T.structuredContent.warnings.some((w) => /WIDTH_UNTESTED/.test(w)), 'NBA market widths are flagged as untested');
  ok(feedCalls.some(([sp, parts]) => sp === 'nba' && /reference/.test(parts) && /game_lines/.test(parts)), 'the live sportsbook read, game lines included, is asked for NBA');
  feedCalls = [];
  await tool('sports_get_player', { sport: 'nba', player_id: gsStar.player_id });
  ok(feedCalls.length && feedCalls.every(([, parts]) => !/game_lines/.test(parts)), 'the player tool leaves the game-line request out');
  const byTeams = await tool('sports_team_odds', { sport: 'nba', team: 'BOS', opponent: 'gs' });
  eq(byTeams.structuredContent.results.game.game_id, 'mnext1', 'finds the game by team codes');
  ok(byTeams.structuredContent.warnings.some((w) => /GAME_FROM_SCHEDULE/.test(w)), 'and says which game it used');
  eq(JSON.parse((await tool('sports_team_odds', { sport: 'nba', team: 'bos', opponent: 'den' })).content[0].text).error.code, 'NOT_FOUND', 'no meeting stored');
  eq(JSON.parse((await tool('sports_team_odds', { sport: 'nba' })).content[0].text).error.code, 'INVALID_INPUT', 'needs a game or a team');
  const G3 = (await tool('sports_get_game', { sport: 'nba', game_id: 'mnext1' })).structuredContent.results;
  ok(G3.team_bets.status === 'ok' && G3.team_bets.see === 'sports_team_odds' && !G3.team_bets.forecast, 'the game view carries a short team-odds line');
  ok((await ro0.rawGet(sportsKey('team-model', { sport: 'nba' }))) != null, 'the read-only store reads the team model');
  const B2 = (await tool('sports_list_games', { sport: 'nba', time_zone: 'America/New_York' })).structuredContent.results;
  const row = B2.games.find((x) => x.game_id === 'mnext1');
  ok(row.team_win && Math.abs(row.team_win.home + row.team_win.away + row.team_win.tie - 1) < 0.002 && Math.abs(row.team_win.home - R.forecast.win.home) < 1e-9, 'the board carries the same win chance');
  const MC = (await tool('sports_get_model_check', { sport: 'nba' })).structuredContent.results.team_model;
  ok(MC.status === 'ok' && MC.see === 'sports_team_odds' && ['moneyline', 'spread', 'win_by', 'total', 'team_total'].every((k) => MC.markets[k] && Number.isInteger(MC.markets[k].n)), 'the model check lists the team model per kind of bet');
  // Game bets and a sportsbook parlay through the evaluate tool.
  const gbArgs = { legs: [{ kind: 'team', sport: 'nba', game_id: 'mnext1', market: 'spread', team: 'gs', line: -4.5, price: '-110' },
    { kind: 'team', sport: 'nba', game_id: 'mnext1', market: 'total', side: 'over', line: 228.5, price: '1.91' }],
    operator: 'sportsbook', format: 'parlay', stake: 10, use_model_chances: true };
  ok(validateArgs(TOOLS.find((t) => t.name === 'sports_evaluate_entry').inputSchema, gbArgs), 'game bets and prices pass the schema check');
  const GB = await tool('sports_evaluate_entry', gbArgs);
  ok(!GB.isError, 'game bets are evaluated: ' + JSON.stringify(GB).slice(0, 300));
  const GR = GB.structuredContent.results;
  eq(GR.legs.map((l) => [l.kind, l.label]), [['team', 'GS −4.5'], ['team', 'Game total over 228.5']], 'each game bet is named');
  ok(GR.legs.every((l) => l.chance_source === 'model' && l.chance > 0 && l.chance < 1 && l.model.status === 'ok'), 'use_model_chances copies the team model’s chance');
  eq(GR.legs.map((l) => l.odds.price.american), [-110, -110], 'each price is read in every format');
  eq(GR.payouts, { 2: Math.round(1.9091 * 1.91 * 10000) / 10000 }, 'the picks’ odds multiplied');
  ok(['joint_estimate', 'not_calculated'].includes(GR.evaluation.status) && GR.evaluation.odds && GR.evaluation.odds.offered.decimal > 3.6, 'the parlay is priced or says why not, with its odds');
  const gbPre = decodePrefill(GR.pick_builder_link.split('entry=')[1]);
  eq([gbPre.format, gbPre.operator, gbPre.legs[0].kind, gbPre.legs[0].market, gbPre.legs[0].line, gbPre.legs[0].price], ['parlay', 'sportsbook', 'team', 'spread', -4.5, 1.9091], 'the Pick Builder link keeps the game bets and their odds');
  { // Win by 5+ yes and win by 15+ no: a 5-14 point win, priced on one number.
    const yes = { kind: 'team', sport: 'nba', game_id: 'mnext1', market: 'win_by', team: 'gs', line: 5 };
    const RG = (await tool('sports_evaluate_entry', { legs: [yes, { ...yes, line: 15, side: 'under' }], operator: 'kalshi', format: 'parlay', stake: 10, payouts: { 2: 2.5 }, use_model_chances: true })).structuredContent.results;
    const [y5, n15] = RG.legs;
    const y15 = R.win_by_ladder.gs['15+'];
    eq(n15.label, 'GS not to win by 15+', 'the no side is named');
    ok(Math.abs(n15.model.probability - (1 - y15)) < 0.002 && Math.abs(y5.model.probability - R.win_by_ladder.gs['5+']) < 0.002, 'the no side gets the model’s no chance: ' + n15.model.probability + ' vs ' + (1 - y15));
    ok(Math.abs(RG.evaluation.joint_probability - (R.win_by_ladder.gs['5+'] - y15)) < 0.003 && RG.evaluation.shared_numbers.length === 1, 'together they are the 5-14 point stretch: ' + RG.evaluation.joint_probability);
    eq((await errCode({ legs: [{ ...yes, line: 15 }, { ...yes, line: 5, side: 'under' }], payouts: { 2: 3 } })).code, 'INVALID_INPUT', 'win by 15+ and not by 5+ can never both win');
  }
  eq((await errCode({ legs: [{ kind: 'team', sport: 'nba', market: 'moneyline', team: 'gs' }] })).code, 'INVALID_INPUT', 'a game bet needs its game');
  eq((await errCode({ legs: [{ kind: 'team', sport: 'nba', game_id: 'mnext1', market: 'moneyline', team: 'gs', price: 'abc' }], format: 'parlay' })).code, 'INVALID_INPUT', 'a bad price is refused');
}

// --- model check -------------------------------------------------------------------
const mc = (await tool('sports_get_model_check', { sport: 'nba' })).structuredContent.results;
ok(mc.model.stats.points.status && mc.model.links.length > 0 && /stand-in|last-10/.test(mc.model.line_proxy), 'stat checks and same-game links');
eq(mc.journal.summary.entries, 0, 'paper journal totals');
const nfl = await tool('sports_get_model_check', { sport: 'nfl' });
ok(nfl.structuredContent.results.model === null && nfl.structuredContent.warnings.some((w) => /NO_MODEL|NOT_CONNECTED/.test(w)), 'a league without data says so');

// --- prop record and league stats ---------------------------------------------------
const pr = await tool('sports_get_prop_record', { sport: 'nba', recent: 2 });
ok(!pr.isError, 'prop record reads: ' + JSON.stringify(pr).slice(0, 300));
const PR = pr.structuredContent.results;
eq([PR.total, PR.summary.wins, PR.summary.losses, PR.summary.pending], [3, 1, 1, 1], 'issued props graded against the box scores');
eq(PR.records.map((r) => r.prop_id)[0], 'p-next', 'newest pick first');
eq([PR.records.length, PR.next_offset], [2, 2], 'paged');
ok(PR.by_stat.points && !('snapshot' in PR), 'splits come through; the download snapshot id does not');
eq((await tool('sports_get_prop_record', { sport: 'nba', recent: 0 })).structuredContent.results.records, [], 'recent 0 gives the totals only');
eq(pr.structuredContent.as_of, '2026-01-15T11:30:00Z', 'dated by the prop record, not the league data run');
ok(PR.records.every((r) => !('evidence' in r) && !('availability' in r) && 'model_probability' in r && 'result' in r), 'list rows are compact');
ok(!JSON.stringify(PR).includes('object with'), 'the splits are not cut');
const one = (await tool('sports_get_prop_record', { sport: 'nba', prop_id: PR.records[1].prop_id })).structuredContent.results.pick;
ok(one && one.evidence[0].text === 'cleared 7 of 10' && one.result === PR.records[1].result, 'prop_id returns that pick in full');
eq(JSON.parse((await tool('sports_get_prop_record', { sport: 'nba', prop_id: 'nope' })).content[0].text).error.code, 'NOT_FOUND');
ok((await tool('sports_get_prop_record', { sport: 'nfl' })).structuredContent.warnings.some((w) => /NO_PICKS/.test(w)), 'a league with no issued props says so');
const lead = await tool('sports_get_league_stats', { sport: 'nba', sort_by: 'points', limit: 5 });
ok(!lead.isError, 'leaders read: ' + JSON.stringify(lead).slice(0, 300));
const LD = lead.structuredContent.results;
eq([LD.sorted_by, LD.window, LD.players.length], ['points', 'season', 5], 'leaders sorted and limited');
ok(LD.players.every((p, i, a) => i === 0 || (a[i - 1].values.points ?? -1) >= (p.values.points ?? -1)), 'highest first');
const denLead = (await tool('sports_get_league_stats', { sport: 'nba', team: 'DEN', window: 'last5' })).structuredContent.results;
ok(denLead.players.length > 0 && denLead.players.every((p) => p.team === 'den') && denLead.window === 'last5', 'one team, last five games');
eq(JSON.parse((await tool('sports_get_league_stats', { sport: 'nba', sort_by: 'passing_yards' })).content[0].text).error.code, 'INVALID_INPUT', 'a stat from the other league is refused');
const teams = await tool('sports_get_league_stats', { sport: 'nba', view: 'teams' });
ok(!teams.isError && Array.isArray(teams.structuredContent.results.teams) && teams.structuredContent.results.teams.length > 0, 'teams view: ' + JSON.stringify(teams).slice(0, 300));
eq(JSON.parse((await tool('sports_get_league_stats', { sport: 'nba', season: 1999 })).content[0].text).error.code, 'NOT_FOUND', 'a season that is not stored');
eq((await tool('sports_get_league_stats', { sport: 'nba', season: 2025, view: 'teams' })).structuredContent.results.season, 2025, 'a stored season by number');
const T1 = (await tool('sports_get_league_stats', { sport: 'nba', view: 'teams', limit: 3 })).structuredContent.results;
const T2 = (await tool('sports_get_league_stats', { sport: 'nba', view: 'teams', limit: 3, offset: T1.next_offset })).structuredContent.results;
ok(T1.teams.length === 3 && T1.total > 3 && T2.offset === 3 && T2.teams[0].team !== T1.teams[0].team, 'teams page with limit and offset');
eq((await tool('sports_get_league_stats', { sport: 'nba', view: 'teams', team: 'GS' })).structuredContent.results.teams.map((t) => t.team), ['gs'], 'one team');
const most = Math.max(...LD.players.map((p) => p.games));
const veterans = (await tool('sports_get_league_stats', { sport: 'nba', min_games: most, limit: 10 })).structuredContent.results;
const everyone = (await tool('sports_get_league_stats', { sport: 'nba', limit: 10 })).structuredContent.results;
ok(veterans.players.length > 0 && veterans.players.every((p) => p.games >= most) && veterans.total < everyone.total, 'min_games filters leaders');
eq((await tool('sports_get_league_stats', { sport: 'nba', min_games: 200 })).structuredContent.results.players, [], 'and can filter everyone out');

// --- NFL: official injury report, roster status, team change, spread and total ------
{
  const { NFL_SOURCE, NFLVERSE_URLS } = await import('../lib/sports/nflverse.mjs');
  const { ingestLeague } = await import('../lib/sports/ingest.mjs');
  const F = await import('./fixtures/sports-nfl.mjs');
  const files = new Map([[NFLVERSE_URLS.games, F.GAMES], [NFLVERSE_URLS.players, F.PLAYERS], [NFLVERSE_URLS.weekly(2025), F.WEEK_2025], [NFLVERSE_URLS.weekly(2026), F.WEEK_2026],
    [NFLVERSE_URLS.snaps(2026), F.SNAPS_2026], [NFLVERSE_URLS.injuries(2026), F.INJURIES_2026]]);
  const NFL_NOW = Date.parse('2026-11-02T18:00:00Z');
  await ingestLeague({ adapter: NFL_SOURCE, store: { backend: 'mem', rawGet: store.rawGet, rawPut: async (k, v) => { objects.set(k, String(v)); } }, fetchText: async (u) => files.get(u) ?? null, now: NFL_NOW });
  const edit = (kind, fn) => { const k = sportsKey(kind, { sport: 'nfl' }); objects.set(k, JSON.stringify(fn(JSON.parse(objects.get(k))))); };
  edit('injuries', (r) => ({ ...r, reports: [...r.reports, { player_id: '00-0006', name: 'Patrick Mahomes', team: 'kc', position: 'QB', game_status: 'Questionable', injury: 'Ankle', practice: 'Limited Participation in Practice' }] }));
  edit('players', (r) => ({ ...r, players: r.players.map((p) => (p.player_id === '00-0003' ? { ...p, status: 'RES' } : p.player_id === '00-0007' ? { ...p, team: 'den' } : p)) }));
  const at = { now: NFL_NOW };
  const mah = (await tool('sports_get_player', { sport: 'nfl', player_id: '00-0006' }, at)).structuredContent;
  eq([mah.results.next_game.game_id, mah.results.availability.official?.week, mah.results.availability.official?.game_status, mah.results.availability.unsure], ['2026_09_den_kc', 9, 'Questionable', true], 'NFL: the official week 9 report for his next game');
  ok(mah.warnings.some((w) => /^OFFICIAL_REPORT: Questionable on the NFL's week 9 injury report \(Ankle\); practice: Limited/.test(w)), 'and it is a warning: ' + mah.warnings.join(' | '));
  const NL = mah.results.next_game_lines;
  eq([NL?.total, NL?.home_margin, NL?.favorite, NL?.home_team_total, NL?.away_team_total, NL?.source], [44.5, 3.5, 'kc', 24, 20.5, 'nflverse'], 'NFL: the schedule’s spread and total');
  eq(mah.results.data_check?.official_injury_report_week, 9, 'the data check names the report week');
  ok(mah.results.games.every((g) => 'snaps' in g && 'snap_pct' in g), 'NFL logs carry snaps');
  const kelce = (await tool('sports_get_player', { sport: 'nfl', player_id: '00-0003' }, at)).structuredContent;
  eq([kelce.results.availability.roster_status?.code, kelce.results.availability.out], ['RES', true], 'NFL: a player on injured reserve is marked out');
  ok(kelce.warnings.some((w) => /^ROSTER: on the injured reserve \(RES\)/.test(w)), 'and it is said');
  ok(!kelce.warnings.some((w) => /OFFICIAL_REPORT/.test(w)), 'last week’s report is not this week’s');
  const rookie = (await tool('sports_get_player', { sport: 'nfl', player_id: '00-0007' }, at)).structuredContent;
  ok(rookie.warnings.some((w) => /^TEAM_CHANGED: the roster file lists DEN, but the last stored game was with KC/.test(w)), 'NFL: a trade shows in the roster file before his first game with the new team');
  eq(rookie.results.games[0].zero_stat_game, true, 'and his snaps-only game is in the log');
  const nflEv = (await tool('sports_evaluate_entry', { legs: [
    { sport: 'nfl', player_id: '00-0006', game_id: '2026_09_den_kc', stat: 'passing_yards', side: 'over', threshold: 240.5, chance: 0.5 },
    { sport: 'nfl', player_id: '00-0007', game_id: '2026_09_den_kc', stat: 'receiving_yards', side: 'over', threshold: 10.5, chance: 0.5 },
  ], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } }, at)).structuredContent;
  eq([nflEv.results.legs[0].game_lines?.total, nflEv.results.legs[0].game_lines?.team_margin, nflEv.results.legs[0].game_lines?.team_total, nflEv.results.legs[1].game_lines?.team_margin], [44.5, 3.5, 24, -3.5], 'evaluate: an NFL pick’s spread and total come from the schedule, from his team’s side');
  eq([nflEv.results.legs[0].availability.official?.game_status, nflEv.results.legs[1].team], ['Questionable', 'den'], 'evaluate reads the same official report, and the new team');
  ok(nflEv.warnings.some((w) => /^OFFICIAL_REPORT: Pick 1 \(Patrick Mahomes over 240.5 passing_yards\): Questionable/.test(w)), 'evaluate: the official report is a warning per pick: ' + nflEv.warnings.join(' | '));
  eq(nflEv.results.legs[1].model?.reason, 'team_changed', 'a moved player gets no forecast from his old role');
  ok(nflEv.warnings.some((w) => /^TEAM_CHANGED: pick 2 \(Rookie Receiver\)/.test(w)), 'and it is said');
}

// --- the store the tools hold ----------------------------------------------------------
eq(writes, [], 'no tool wrote anything');
const ro = sportsReadOnlyStore(store);
await assert.rejects(ro.rawGet(SPORTS_PREFIX + 'markets/observations.json'), /read-only/, 'captured lines are not readable');
await assert.rejects(ro.rawGet('_stonks/contact/v1/messages.json'), /read-only/, 'nothing outside Sports is readable');
await assert.rejects(ro.rawGet(SPORTS_PREFIX + 'nba/../journal/entries.json'), /read-only/);
await assert.rejects(ro.rawPut(SPORTS_PREFIX + 'journal/entries.json', '{}'), /read-only/, 'and nothing is writable');
await assert.rejects(ro.withLease('sports-journal', async () => {}), /read-only/);
ok((await ro.rawGet(sportsKey('model', { sport: 'nba' }))) != null, 'Sports records are');
ok((await ro.rawGet(sportsKey('prop-record', { sport: 'nba', season: 2025 }))) != null, 'and so is the issued-props record');
ok((await ro.rawGet(sportsKey('lines', { sport: 'nba', date: '2026-01-15' }))) != null && (await ro.rawGet(sportsKey('injuries', { sport: 'nfl' }))) != null, 'and the line archive and the official injury report');
eq(sportsReadOnlyStore({ get: async () => null }), null, 'a store without raw reads gives no Sports access');
checks += 6;

console.log(`Sports MCP smoke passed (${checks} checks).`);

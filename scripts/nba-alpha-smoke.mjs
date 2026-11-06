// Entirely made-up quotes/box scores. No credentials or network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { normalizeOdds, loadPropSources } from '../lib/sports/prop-sources.mjs';
import { normalizeNBAQuotes, nbaMarketForProp, impliedAmerican, nbaPairEstimate, checkNBAPayout, selectNBAProps } from '../lib/sports/nba-market.mjs';
import { nbaRoleScenario, nbaTeamOpportunity } from '../lib/sports/nba-role.mjs';
import { recommendationsView } from '../lib/sports/props.mjs';
import { captureNBAResearch, nbaPairAction, nbaResearchSummary, exportNBAResearch, decodeNBAResearch, encodeNBAResearch } from '../lib/sports/nba-research.mjs';
import { handleSportsRequest, recordLoader } from '../lib/sports/http.mjs';
import { sportsKey } from '../lib/sports/store.mjs';

let now = Date.parse('2026-11-05T18:00Z');
const game = { game_id: 'nba-test', season: 2026, status: 'scheduled', local_date: '2026-11-05', home_team: 'lal', away_team: 'gs', start_utc: '2026-11-05T23:00Z' };
const people = ['One', 'Two', 'Three'].map((n, i) => ({ player_id: 'p' + i, name: 'Fixture ' + n, team: i === 2 ? 'gs' : 'lal', position: 'G', provider_ids: { espn: String(i + 1) } }));
const history = people.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({ sport: 'nba', season: 2026, player_id: p.player_id, game_id: 'past-' + i,
  date: new Date(Date.parse('2026-10-16T12:00Z') + i * 86400000).toISOString().slice(0, 10), team: p.team, opponent: p.team === 'lal' ? 'gs' : 'lal',
  played: true, home: p.team === 'lal', position: 'G', minutes: 32, stats: { points: 25, rebounds: 8, assists: 5, field_goals_attempted: 15, free_throws_attempted: 5, turnovers: 2, offensive_rebounds: 1 } })));
const event = (book, stamp = now, price = -400, threshold = 15.5) => ({ id: 'provider-g', sport_key: 'basketball_nba', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', commence_time: game.start_utc,
  bookmakers: [{ key: book, markets: people.map((p) => ({ key: 'player_points', period: null, line_type: 'main', last_update: new Date(stamp).toISOString(), outcomes: ['Over', 'Under'].map((side) => ({
    name: side, description: p.name, point: threshold, price: side === 'Over' ? price : 300,
    last_seen_at: new Date(stamp).toISOString(), last_change_at: new Date(stamp).toISOString(), book_updated_at: book === 'pinnacle' ? new Date(stamp).toISOString() : null,
    ...(book === 'prizepicks' ? { dfs_odds_type: 'standard', allowed_wager_types: 'under_or_over' } : {}) })) })) }] });
const refs = (stamp = now, price = -400) => ['draftkings', 'fanduel', 'betmgm'].flatMap((b) => normalizeNBAQuotes([event(b, stamp, price)], stamp));
const lines = () => normalizeOdds([event('prizepicks')], 'nba', now);
assert.equal(impliedAmerican(-200), 2 / 3); assert.equal(impliedAmerican(150), 0.4); assert.equal(impliedAmerican('150'), null);
assert.equal(normalizeNBAQuotes([event('prizepicks')], now).length, 0, 'DFS synthetic prices cannot be reference probabilities');
assert.equal(normalizeNBAQuotes([event('draftkings')], now).length, 3);
assert.equal(normalizeNBAQuotes([{ ...event('draftkings'), live: true }], now).length, 0);
assert.equal(normalizeNBAQuotes([{ ...event('draftkings'), commence_time: new Date(now).toISOString() }], now).length, 0);
assert.equal(normalizeNBAQuotes([event('draftkings', now - 300001)], now).length, 0);
const edit = (book, mutate) => { const e = event(book); mutate(e.bookmakers[0].markets[0]); e.bookmakers[0].markets = [e.bookmakers[0].markets[0]]; return e; };
assert.equal(normalizeNBAQuotes([edit('pinnacle', (m) => m.outcomes.forEach((o) => o.book_updated_at = new Date(now - 900000).toISOString()))], now).length, 0, 'fresh collection does not refresh a stale Pinnacle feed');
assert.equal(normalizeNBAQuotes([edit('pinnacle', (m) => m.outcomes.forEach((o) => o.book_updated_at = null))], now).length, 0);
assert.equal(normalizeNBAQuotes([edit('draftkings', (m) => m.outcomes[1].last_seen_at = new Date(now - 1000).toISOString())], now).length, 0, 'withdrawn side invalidates the pair');
assert.equal(normalizeNBAQuotes([edit('draftkings', (m) => m.period = 'h1')], now).length, 0);
assert.equal(normalizeNBAQuotes([edit('draftkings', (m) => m.outcomes.forEach((o) => o.point = 15))], now).length, 0, 'whole-line conditional prices are not unconditional win probabilities');
assert.equal(normalizeNBAQuotes([edit('draftkings', (m) => m.outcomes[0].price = null)], now).length, 0);
assert.equal(normalizeNBAQuotes([edit('draftkings', (m) => m.outcomes[0].name = '16+ Points')], now).length, 0);
const oneLine = lines()[0], market = nbaMarketForProp(oneLine, refs(), now);
assert.equal(market.state, 'supported'); assert.equal(market.method, 'exact');
assert.equal(nbaMarketForProp({ ...oneLine, last_change_at: new Date(now - 120000).toISOString() }, refs(), now).movement.watch, true);
assert.ok(Math.abs(market.probability - 0.8 / 1.05) < 0.000001);
assert.equal(nbaMarketForProp(oneLine, refs().filter((q) => q.book !== 'betmgm'), now).state, 'thin');
assert.equal(nbaMarketForProp({ ...oneLine, event_id: 'other-game' }, refs(), now).state, 'unavailable');
assert.equal(nbaMarketForProp({ ...oneLine, stat: 'fantasy' }, refs(), now).state, 'unavailable');
assert.equal(nbaMarketForProp(oneLine, refs(), now + 300001).state, 'unavailable');
const whole = nbaMarketForProp({ ...oneLine, threshold: 15 }, refs(), now);
assert.equal(whole.method, 'exact', 'More 15 strict integer wins are Over 15.5');
const bound = nbaMarketForProp({ ...oneLine, threshold: 14.5 }, refs(), now);
assert.equal(bound.method, 'monotone_bound'); assert.equal(bound.probability, null); assert.equal(bound.high, 1);
const duplicate = [...refs(), ...refs()]; assert.equal(nbaMarketForProp(oneLine, duplicate, now).book_count, 3);

const candidates = people.map((p) => ({ ...oneLine, player_id: p.player_id, player_name: p.name, team: p.team, stat: 'points', rank_score: 20,
  market: nbaMarketForProp({ ...oneLine, player_name: p.name }, refs(), now), role: { risk_flags: [] }, model: null, features: { unresolved_teammates: [] } }));
const pair = nbaPairEstimate([candidates[0], candidates[2]], null, now);
assert.equal(pair.method, 'frechet_bounds'); assert.equal(pair.probability, null);
assert.equal(checkNBAPayout(pair, 3).state, 'positive_screen');
assert.equal(checkNBAPayout(pair, 1.5).state, 'pass');
assert.throws(() => checkNBAPayout(pair, '3'), (e) => e.status === 400);
assert.equal(nbaPairEstimate([candidates[0], candidates[1]], null, now).state, 'pass');
assert.equal(nbaPairEstimate([{ ...candidates[0], role: { risk_flags: ['unmeasured_rotation_absence'] } }, candidates[2]], null, now).state, 'pass');
const model = { as_of_date: '2026-11-04', joint: { pairs: { 'points|points|opponent': { status: 'validated', link: 0.2, interval: { low: 0.1, high: 0.3 } } } } };
const modeled = candidates.map((p) => ({ ...p, model: { regular_role: true } }));
const coupled = nbaPairEstimate([modeled[0], modeled[2]], model, now);
assert.equal(coupled.method, 'copula_sensitivity'); assert.ok(coupled.low <= coupled.probability && coupled.probability <= coupled.high);
assert.equal(nbaPairEstimate([modeled[0], modeled[2]], { ...model, as_of_date: '2026-10-01' }, now).method, 'frechet_bounds');
const selected = selectNBAProps(candidates, refs(), null, now); assert.equal(new Set(selected.picks.map((p) => p.team)).size, 2);

const byPlayer = new Map(people.map((p) => [p.player_id, history.filter((r) => r.player_id === p.player_id).sort((a, b) => b.date.localeCompare(a.date))]));
const scenario = nbaRoleScenario({ player: { ...people[0], opponent: 'gs' }, history: byPlayer.get('p0'), byPlayer, players: people, availability: [{ name: people[1].name, team: 'lal', status: 'Out' }], stat: 'points', teamTotals: nbaTeamOpportunity(history) });
assert.equal(scenario.projected_minutes, 32); assert.ok(scenario.usage_pct > 0); assert.ok(scenario.possessions_proxy.expected > 0);
assert.ok(scenario.risk_flags.includes('unmeasured_rotation_absence'));
assert.equal(scenario.starting_lineup, 'unconfirmed');

const objects = new Map(), leases = new Set(); let writes = 0;
const store = { backend: 'r2', rawGet: async (k) => objects.has(k) ? Buffer.from(objects.get(k)) : null,
  rawPut: async (k, v) => { objects.set(k, String(v)); writes++; },
  withLease: async (key, fn) => { if (leases.has(key)) return { busy: true }; leases.add(key); try { await fn(() => {}); return { busy: false }; } finally { leases.delete(key); } } };
const put = (kind, value, options = {}) => objects.set(sportsKey(kind, { sport: 'nba', ...options }), JSON.stringify(value));
put('status', { seasons: [2026], state: 'ok' }); put('players', { players: people }); put('games', { games: [game] }, { season: 2026 }); put('player-games', { rows: history }, { season: 2026 });
const sources = () => ({ lines: { state: 'ok', lines: lines(), raw_events: [event('prizepicks')], provider: 'Fixture' },
  reference: { state: 'ok', quotes: refs(), raw_events: ['draftkings', 'fanduel', 'betmgm'].map((b) => event(b)), provider: 'Fixture' },
  injuries: { state: 'ok', reports: [], observed_utc: new Date(now).toISOString() } });
const view = () => recommendationsView({ load: recordLoader(store), sport: 'nba', now, tz: 'America/Los_Angeles', sources: sources() });
let v = await view(); const beforeCapture = writes;
const ageing = sources(); ageing.lines.lines = ageing.lines.lines.map((p) => ({ ...p, observed_utc: new Date(now - 299000).toISOString() }));
const expiring = await recommendationsView({ load: recordLoader(store), sport: 'nba', now, tz: 'America/Los_Angeles', sources: ageing });
assert.equal(Date.parse(expiring.expires_utc), now + 1000, 'NBA analysis expires with its oldest selected source');
assert.equal((await captureNBAResearch({ store, view: expiring, now, clock: () => now + 2000 })).added, 0, 'lease delay cannot record expired source data');
assert.equal(v.rank_version, 'nba-market-1'); assert.equal(v.games[0].pair.state, 'payout_needed');
assert.ok(!JSON.stringify(v).includes('research_input') && !JSON.stringify(v).includes('raw_events'));
assert.ok(v.games[0].picks.every((p) => p.market.state === 'supported'));
assert.equal((await captureNBAResearch({ store, view: v, now })).state, 'ok'); assert.ok(writes > beforeCapture);
const snap = v.games[0].research_snapshot_id, key = sportsKey('nba-research-game', { sport: 'nba', season: 2026, gameId: game.game_id });
let saved = decodeNBAResearch(JSON.parse(objects.get(key))); assert.equal(saved.points.length, 1);
assert.ok(saved.points[0].candidates.length > saved.points[0].picks.length, 'rejected alternatives survive for research');
assert.ok(saved.points[0].prizepicks.length && saved.points[0].sportsbook.length);
const body = { sport: 'nba', season: 2026, game_id: game.game_id, snapshot_id: snap, payout_multiplier: 3, save: false };
assert.equal((await nbaPairAction({ store, body, now })).screen.state, 'positive_screen');
put('games', { games: [{ ...game, status: 'postponed' }] }, { season: 2026 });
await assert.rejects(() => nbaPairAction({ store, body, now }), (e) => e.status === 409);
put('games', { games: [game] }, { season: 2026 });
assert.equal((await nbaPairAction({ store, body: { ...body, save: true }, now })).saved, true);
const fixed = decodeNBAResearch(JSON.parse(objects.get(key))).paper;
assert.equal((await nbaPairAction({ store, body: { ...body, save: true }, now })).saved, true);
await assert.rejects(() => nbaPairAction({ store, body: { ...body, save: true, payout_multiplier: 4 }, now }), (e) => e.status === 409);
await assert.rejects(() => nbaPairAction({ store, body, now: now + 120001 }), (e) => e.status === 409);

// Later quotes can update CLV and the live shortlist, never the issued pair.
now = Date.parse('2026-11-05T22:55Z');
const laterSources = sources(); laterSources.reference.quotes = refs(now, -600);
v = await recommendationsView({ load: recordLoader(store), sport: 'nba', now, tz: 'America/Los_Angeles', sources: laterSources });
assert.equal((await captureNBAResearch({ store, view: v, now })).state, 'ok');
saved = decodeNBAResearch(JSON.parse(objects.get(key))); assert.deepEqual(saved.paper, fixed); assert.equal(saved.points.length, 2);
const inputKey = sportsKey('nba-research-input', { sport: 'nba', digest: saved.points[0].input_hash }), originalInput = objects.get(inputKey), originalCase = objects.get(key);
objects.set(inputKey, JSON.stringify({ ...JSON.parse(originalInput), raw_bytes: 1 }));
assert.equal((await captureNBAResearch({ store, view: v, now })).state, 'unavailable'); assert.equal(objects.get(key), originalCase, 'corruption cannot reset or replace the record');
objects.set(inputKey, originalInput);
assert.notEqual(saved.points[0].picks[0].market.probability, saved.points[1].picks[0].market.probability);
const exported = await exportNBAResearch({ store, season: 2026, gameId: game.game_id });
const exportedData = JSON.parse(gunzipSync(exported)); assert.equal(exportedData.research.points.length, 2);
assert.throws(() => encodeNBAResearch({ too_big: 'x'.repeat(16 * 1024 * 1024) }), (e) => e.status === 413);
// An interrupted index write is repaired from the self-contained game object,
// even if the game starts before the next collector gets to it.
const clone = new Map(objects), indexKey = sportsKey('nba-research-index', { sport: 'nba', season: 2026 });
const caseCopy = decodeNBAResearch(JSON.parse(clone.get(key))); caseCopy.paper = null; caseCopy.index_head.paper = null;
clone.set(key, JSON.stringify(encodeNBAResearch(caseCopy))); const headCopy = JSON.parse(clone.get(indexKey)); headCopy.games[game.game_id].paper = null; clone.set(indexKey, JSON.stringify(headCopy));
let failIndex = true;
const interrupted = { ...store, rawGet: async (k) => clone.has(k) ? Buffer.from(clone.get(k)) : null, rawPut: async (k, value) => { if (k === indexKey && failIndex) { failIndex = false; throw new Error('fixture index interruption'); } clone.set(k, String(value)); } };
await assert.rejects(() => nbaPairAction({ store: interrupted, body: { ...body, snapshot_id: v.games[0].research_snapshot_id, save: true }, now }), /index interruption/);
assert.ok(decodeNBAResearch(JSON.parse(clone.get(key))).paper);
await captureNBAResearch({ store: interrupted, view: v, now: Date.parse(game.start_utc) + 1, clock: () => Date.parse(game.start_utc) + 1 });
assert.equal(JSON.parse(clone.get(indexKey)).games[game.game_id].paper.snapshot_id, v.games[0].research_snapshot_id);
const dir = await mkdtemp(join(tmpdir(), 'nba-alpha-'));
try { const file = join(dir, 'research.json.gz'); await writeFile(file, exported); execFileSync(process.execPath, ['scripts/replay-nba-research.mjs', file], { cwd: new URL('..', import.meta.url), stdio: 'pipe' }); }
finally { await rm(dir, { recursive: true, force: true }); }
const finalRows = saved.issued.map((p) => ({ player_id: p.player_id, game_id: game.game_id, played: true, stats: { points: 25 } }));
put('games', { games: [{ ...game, status: 'final' }] }, { season: 2026 }); put('player-games', { rows: finalRows }, { season: 2026 });
const summary = await nbaResearchSummary({ load: recordLoader(store), seasons: [2026], now: Date.parse(game.start_utc) + 1000 });
assert.equal(summary.wins, 2); assert.equal(summary.both_win, 1); assert.equal(summary.calibration.n, 2);
assert.equal(summary.paper.net_units, 2); assert.equal(summary.paper_by_screen.positive_screen.resolved, 1);
assert.equal(summary.closing_value.n, 2); assert.ok(summary.closing_value.average_probability_change > 0);
put('player-games', { rows: finalRows.slice(0, 1) }, { season: 2026 });
const incomplete = await nbaResearchSummary({ load: recordLoader(store), seasons: [2026], now: Date.parse(game.start_utc) + 1000 });
assert.equal(incomplete.pending, 1); assert.equal(incomplete.voids, 0); assert.equal(incomplete.paper.resolved, 0, 'missing NBA rows do not invent settlement or profit');
put('player-games', { rows: finalRows }, { season: 2026 });
const original = objects.get(key);
await captureNBAResearch({ store, view: v, now: Date.parse(game.start_utc) + 1, clock: () => Date.parse(game.start_utc) + 1 });
assert.equal(objects.get(key), original, 'post-kickoff capture never alters pregame evidence');

const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } });
let upstream = 0;
const deps = { env: { PRIVATE_DATA_ENABLED: '1' }, store, now: () => now, getSession: async () => ({ sub: 'owner', tr: true, tp: true }), loadPropSources: async () => { upstream++; return sources(); } };
const denied = response(); await handleSportsRequest({ method: 'GET', query: { sports: 'nba-research', sport: 'nba', id: game.game_id, season: '2026' }, headers: {} }, denied, { ...deps, getSession: async () => null });
assert.equal(denied.code, 403); assert.equal(upstream, 0);
const download = response(); await handleSportsRequest({ method: 'GET', query: { sports: 'nba-research', sport: 'nba', id: game.game_id, season: '2026' }, headers: {} }, download, deps);
assert.equal(download.code, 200); assert.equal(download.headers['Cache-Control'], 'private, no-store'); assert.ok(Buffer.isBuffer(download.body));
const csrf = response(); await handleSportsRequest({ method: 'POST', query: { sports: 'nba-pair' }, body, headers: { origin: 'https://other.invalid', host: 'site.invalid' } }, csrf, deps); assert.equal(csrf.code, 403);
await assert.rejects(() => nbaPairAction({ store, body: { ...body, game_id: '../escape' }, now }), (e) => e.status === 400);
assert.throws(() => sportsKey('nba-research-input', { sport: 'nba', digest: '../escape' }));

let nflCalls = 0;
const nfl = await loadPropSources({ sport: 'nfl', now, env: { PROPLINE_API_KEY: 'fixture' }, fetchImpl: async (url) => { nflCalls++; return new Response(JSON.stringify(String(url).includes('prop-line') ? [] : { status: 'success', timestamp: new Date(now).toISOString(), injuries: [] })); } });
assert.equal(nflCalls, 2); assert.equal(nfl.reference, undefined, 'NFL feed and ranking contract stay unchanged');
console.log('NBA alpha passed: fresh paired prices, timestamp/ladder safety, margin removal, strict wins, correlated pair screens, role scenarios, immutable evidence/paper entries, exact offline replay, grading/CLV/ROI and Owner/CSRF isolation.');

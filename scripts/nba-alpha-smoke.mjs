// Entirely made-up quotes/box scores. No credentials or network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { normalizeOdds, loadPropSources, loadPropSourcesWithRetry, RETRY_WAIT_MS, FORCE_REUSE_MS } from '../lib/sports/prop-sources.mjs';
import { normalizeNBAQuotes, nbaMarketForProp, impliedAmerican, nbaPairEstimate, checkNBAPayout, selectNBAProps, selectNBASlate, nbaPicksExpiry, shinProbabilities } from '../lib/sports/nba-market.mjs';
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
// -400 / +300 with the margin removed by Shin's method (closed form for two
// outcomes), not the proportional 0.8 / 1.05.
{ const a = 0.8, b = 0.25, P = a + b, z = ((P - 1) * ((a - b) ** 2 - P)) / (P * ((a - b) ** 2 - 1));
  assert.ok(Math.abs(market.probability - (Math.sqrt(z * z + 4 * (1 - z) * a * a / P) - z) / (2 * (1 - z))) < 0.000001);
  assert.ok(Math.abs(market.probability - 0.775) < 0.000001 && market.vig_method === 'shin'); }
{ const even = shinProbabilities([110 / 210, 110 / 210]); assert.ok(Math.abs(even[0] - 0.5) < 1e-9 && Math.abs(even[1] - 0.5) < 1e-9, 'even prices split evenly'); }
{ const fair = shinProbabilities([0.6, 0.45]); assert.ok(Math.abs(fair[0] + fair[1] - 1) < 1e-9 && fair[0] > 0.6 / 1.05, 'Shin moves the favourite up from the proportional split'); }
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

// The slate can choose any eligible candidate, including alternatives that
// were not the old per-game pair. Never apply opponent correlation cross-game.
{
  const make = (id, gameId, team, chance, extra = {}) => ({ ...modeled[0], player_id: id, game_id: gameId, team,
    market: { ...market, low: chance, high: chance, probability: chance }, ...extra });
  const pool = [make('a', 'g1', 'lal', 0.8), make('b', 'g1', 'gs', 0.5), make('c', 'g2', 'ny', 0.75), make('d', 'g2', 'bos', 0.5)];
  const best = selectNBASlate(pool, model, now);
  assert.deepEqual(best.picks.map((p) => p.player_id), ['a', 'c']);
  assert.equal(best.pair.method, 'independent_games'); assert.equal(best.pair.correlation, null);
  assert.equal(best.pair.low, 0.6); assert.equal(best.pair.probability, 0.6);
  assert.match(best.pair.note, /independent/);
  const coupledBest = selectNBASlate([pool[0], make('b', 'g1', 'gs', 0.8), pool[2]], model, now);
  assert.equal(coupledBest.pair.method, 'copula_sensitivity', 'same-game pairs remain eligible if stronger');
  assert.equal(selectNBASlate([pool[0], { ...pool[2], team: 'lal' }], model, now).picks.length, 0);
  assert.equal(selectNBASlate([pool[0], { ...pool[2], player_id: 'a' }], model, now).picks.length, 0);
  assert.equal(selectNBASlate([pool[0], { ...pool[2], market: { ...market, state: 'thin' } }], model, now).picks.length, 0);
  assert.equal(selectNBASlate([pool[0], { ...pool[2], game_start_utc: new Date(now).toISOString() }], model, now).picks.length, 0);
  assert.equal(selectNBASlate([pool[0], { ...pool[2], observed_utc: new Date(now - 300001).toISOString() }], model, now).picks.length, 0);
  const unsafe = make('risky', 'g3', 'chi', 0.99, { role: { risk_flags: ['unmeasured_rotation_absence'] } });
  assert.deepEqual(selectNBASlate([...pool, unsafe], model, now).picks.map((p) => p.player_id), ['a', 'c']);
  assert.deepEqual(selectNBASlate(pool.slice().reverse(), model, now), best, 'selection is deterministic');
  // Check the dominance optimization against exhaustive pair evaluation.
  const many = Array.from({ length: 80 }, (_, i) => make('player' + Math.floor(i / 4), 'game' + Math.floor(i / 16), 'team' + Math.floor(i / 8),
    0.4 + ((i * 37) % 50) / 100, { stat: i % 2 ? 'rebounds' : 'points', side: i % 3 ? 'over' : 'under' }));
  let exhaustive = -1;
  for (const a of many) for (const b of many) if (a.player_id !== b.player_id && a.team !== b.team)
    exhaustive = Math.max(exhaustive, nbaPairEstimate([a, b], model, now).low);
  assert.equal(selectNBASlate(many, model, now).pair.low, exhaustive);
  assert.equal(nbaPicksExpiry([pool[0]], now), now + 300000, 'poll cadence does not shorten validity');
  assert.equal(nbaPicksExpiry([pool[0]], now, { injuryExpiry: now + 20000 }), now + 20000);
}

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
// Per-game deadlines and local-day slate boundaries use canonical schedules.
{
  const extraGame = { ...game, game_id: 'nba-extra', home_team: 'chi', away_team: 'bos', start_utc: '2026-11-06T00:00Z' };
  const extraPlayers = [people[0], people[2]].map((p, i) => ({ ...p, player_id: 'extra-' + i, name: 'Extra ' + i, team: i ? 'bos' : 'chi', provider_ids: {} }));
  const extraRows = extraPlayers.flatMap((p, i) => history.filter((r) => r.player_id === (i ? 'p2' : 'p0')).map((r) => ({ ...r, player_id: p.player_id, team: p.team, opponent: i ? 'chi' : 'bos' })));
  const extraSources = sources(), sameDay = [game, extraGame];
  extraSources.lines.lines = extraSources.lines.lines.map((p) => ({ ...p, observed_utc: new Date(now - 299000).toISOString() }));
  for (const p of extraPlayers) extraSources.lines.lines.push({ ...oneLine, player_name: p.name, event_id: 'extra-event', home_team: 'Chicago Bulls', away_team: 'Boston Celtics', start_utc: extraGame.start_utc });
  for (const p of extraPlayers) extraSources.reference.quotes.push(...refs().filter((q) => q.player_key === 'fixture one').map((q) => ({ ...q,
    player_key: p.name.toLowerCase(), player_name: p.name, event_id: 'extra-event', home_team: 'Chicago Bulls', away_team: 'Boston Celtics', start_utc: extraGame.start_utc })));
  const load = async (kind) => kind === 'status' ? { seasons: [2026] } : kind === 'players' ? { players: [...people, ...extraPlayers] } :
    kind === 'games' ? { games: sameDay } : kind === 'player-games' ? { rows: [...history, ...extraRows] } : null;
  const separated = await recommendationsView({ load, sport: 'nba', now, tz: 'America/Los_Angeles', sources: extraSources });
  assert.equal(Date.parse(separated.games.find((g) => g.game_id === game.game_id).expires_utc), now + 1000);
  assert.equal(Date.parse(separated.games.find((g) => g.game_id === extraGame.game_id).expires_utc), now + 300000);
  assert.equal(separated.slates[0].eligible_count, separated.games.reduce((n, g) => n + g.research.candidates.filter((p) => p.market.state === 'supported').length, 0), 'both eligible games feed the slate');
  // Move the second game to the following local day, with matching source times.
  extraGame.start_utc = '2026-11-07T00:00Z';
  extraSources.lines.lines.filter((p) => p.event_id === 'extra-event').forEach((p) => p.start_utc = extraGame.start_utc);
  extraSources.reference.quotes.filter((p) => p.event_id === 'extra-event').forEach((p) => p.start_utc = extraGame.start_utc);
  const separateDays = await recommendationsView({ load, sport: 'nba', now, tz: 'America/Los_Angeles', sources: extraSources });
  assert.ok(separateDays.slates[0].picks.every((p) => p.game_id === game.game_id));
  assert.equal(separateDays.slates[1].picks.length, 2);
  assert.ok(separateDays.slates[1].picks.every((p) => p.game_id === extraGame.game_id));
}
let v = await view(); const beforeCapture = writes;
const ageing = sources(); ageing.lines.lines = ageing.lines.lines.map((p) => ({ ...p, observed_utc: new Date(now - 299000).toISOString() }));
const expiring = await recommendationsView({ load: recordLoader(store), sport: 'nba', now, tz: 'America/Los_Angeles', sources: ageing });
assert.equal(Date.parse(expiring.expires_utc), now + 1000, 'NBA analysis expires with its oldest selected source');
assert.equal((await captureNBAResearch({ store, view: expiring, now, clock: () => now + 2000 })).added, 0, 'lease delay cannot record expired source data');
assert.equal(v.rank_version, 'nba-market-1'); assert.equal(v.games[0].pair.state, 'payout_needed');
assert.ok(!JSON.stringify(v).includes('research_input') && !JSON.stringify(v).includes('raw_events'));
assert.ok(v.games[0].picks.every((p) => p.market.state === 'supported'));
assert.equal((await captureNBAResearch({ store, view: v, now })).state, 'ok'); assert.ok(writes > beforeCapture);
assert.equal(Date.parse(v.games[0].expires_utc), now + 300000);
assert.equal(Date.parse(v.refresh_after_utc), now + 120000);
assert.equal(v.slates[0].picks.length, 2); assert.equal(v.slates[1].picks.length, 0);
// A slow capture of another game must not reject this game's fresh evidence.
const isolatedView = await view(); isolatedView.expires_utc = new Date(now - 1).toISOString();
assert.equal((await captureNBAResearch({ store, view: isolatedView, now })).state, 'ok');
assert.ok(isolatedView.games[0].research_snapshot_id);
// Previously a repeated fingerprint copied an almost-expired deadline to the
// whole board. Retire that snapshot, while preserving the immutable issuance.
const isolatedObjects = new Map(objects), isolatedStore = { ...store, rawGet: async (k) => isolatedObjects.has(k) ? Buffer.from(isolatedObjects.get(k)) : null,
  rawPut: async (k, value) => isolatedObjects.set(k, String(value)) };
const isolatedKey = sportsKey('nba-research-game', { sport: 'nba', season: 2026, gameId: game.game_id });
const oldCase = decodeNBAResearch(JSON.parse(isolatedObjects.get(isolatedKey)));
oldCase.points.at(-1).expires_utc = new Date(now + 60000).toISOString();
isolatedObjects.set(isolatedKey, JSON.stringify(encodeNBAResearch(oldCase)));
const renewed = await view(); await captureNBAResearch({ store: isolatedStore, view: renewed, now: now + 2000 });
assert.notEqual(renewed.games[0].research_snapshot_id, oldCase.points.at(-1).snapshot_id);
assert.equal(Date.parse(renewed.expires_utc), now + 300000);
assert.equal(Date.parse(renewed.games[0].research_expires_utc), now + 300000);
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
await assert.rejects(() => nbaPairAction({ store, body, now: now + 300001 }), (e) => e.status === 409);

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
try {
  const file = join(dir, 'research.json.gz'); await writeFile(file, exported); execFileSync(process.execPath, ['scripts/replay-nba-research.mjs', file], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
  const outageObjects = new Map(objects), outageStore = { ...store, rawGet: async (k) => outageObjects.has(k) ? Buffer.from(outageObjects.get(k)) : null, rawPut: async (k, value) => outageObjects.set(k, String(value)) };
  const failedSources = sources(); failedSources.lines = { state: 'unavailable', lines: [], message: 'Fixture outage' };
  const outageView = await recommendationsView({ load: recordLoader(outageStore), sport: 'nba', now: now + 30000, tz: 'America/Los_Angeles', sources: failedSources });
  assert.equal((await captureNBAResearch({ store: outageStore, view: outageView, now: now + 30000 })).state, 'ok');
  const outageFile = join(dir, 'outage.json.gz'); await writeFile(outageFile, await exportNBAResearch({ store: outageStore, season: 2026, gameId: game.game_id }));
  const replay = JSON.parse(execFileSync(process.execPath, ['scripts/replay-nba-research.mjs', outageFile], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
  assert.equal(replay.snapshots, 3); assert.equal(replay.matched, 3); assert.equal(replay.results.filter((r) => r.declined_source).length, 1, 'outage evidence reproduces the original source gate');
}
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
// Scheduled jobs re-read a briefly-down feed once (only the failed parts,
// forced past the cache), never a rate limit, and still fail if it stays down.
{
  assert.ok(RETRY_WAIT_MS > FORCE_REUSE_MS, 'retry wait outlasts the forced-reuse window');
  const calls = [], waits = [];
  const fake = (states) => async ({ parts, force }) => { calls.push({ parts, force: !!force }); const st = states.shift();
    return { lines: { state: st.lines ?? 'ok', lines: [] }, injuries: { state: st.injuries ?? 'ok', reports: [] }, ...(parts.includes('reference') ? { reference: { state: st.reference ?? 'ok', quotes: [] } } : {}) }; };
  const sleep = async (ms) => { waits.push(ms); };
  let r = await loadPropSourcesWithRetry({ sport: 'nfl', parts: ['lines', 'injuries', 'reference'], load: fake([{ lines: 'unavailable' }, {}]), sleep });
  assert.equal(r.sources.lines.state, 'ok'); assert.equal(r.retried, ' retried=lines'); assert.deepEqual(waits, [RETRY_WAIT_MS]);
  assert.deepEqual(calls[1], { parts: ['lines'], force: true });
  calls.length = 0; waits.length = 0;
  r = await loadPropSourcesWithRetry({ sport: 'nba', parts: ['lines', 'injuries', 'reference', 'game_lines'], load: fake([{ reference: 'unavailable' }, { reference: 'unavailable' }]), sleep });
  assert.equal(r.sources.reference.state, 'unavailable', 'a feed that stays down still fails the run');
  assert.deepEqual(calls[1].parts, ['reference', 'game_lines']); assert.equal(r.sources.lines.state, 'ok');
  calls.length = 0; waits.length = 0;
  r = await loadPropSourcesWithRetry({ sport: 'nba', parts: ['lines', 'injuries', 'reference'], load: fake([{ lines: 'rate_limited' }]), sleep });
  assert.equal(calls.length, 1); assert.equal(waits.length, 0); assert.equal(r.retried, '');
}
console.log('NBA alpha passed: fresh paired prices, timestamp/ladder safety, margin removal, strict wins, correlated pair screens, role scenarios, immutable evidence/paper entries, exact offline replay, grading/CLV/ROI and Owner/CSRF isolation.');
// Book-price data fixes (2026-11-13): more books, NFL prices, anchored prices,
// the real-line warning and NBA.com headers. Run here so test:sports covers it.
await import('./sports-book-data-smoke.mjs');

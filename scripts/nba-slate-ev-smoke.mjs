// Offline NBA Goblin eligibility, exact-pair payouts, EV ranking and private storage.
import assert from 'node:assert/strict';
import { normalizeOdds } from '../lib/sports/prop-sources.mjs';
import { nbaOfferId, nbaPairId, nbaSlateComparisons, saveNBAPayout, readNBAPayouts } from '../lib/sports/nba-slate.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { sportsKey } from '../lib/sports/store.mjs';
import { decodePrefill, encodePrefill } from '../lib/sports/prefill.mjs';
const now = Date.parse('2026-11-13T18:00Z'), iso = (n) => new Date(n).toISOString(), at = iso(now), start = iso(now + 3600000);
const event = { id: 'e', sport_key: 'basketball_nba', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', commence_time: start,
  bookmakers: [{ key: 'prizepicks', markets: [{ key: 'player_points', line_type: 'alternate', last_update: at, outcomes: ['Over', 'Under'].map((name) => ({ name, description: 'Fixture Player', point: 10.5, price: 100, dfs_odds_type: 'goblin', last_seen_at: at, allowed_wager_types: 'under_or_over' })) }] }] };
assert.equal(normalizeOdds([event], 'nba', now).length, 0);
const goblins = normalizeOdds([event], 'nba', now, { goblins: true });
assert.equal(goblins.length, 1); assert.equal(goblins[0].side, 'over'); assert.equal(goblins[0].offer_type, 'goblin');
for (const change of [m => m.period = 'h1', m => m.suspended_at = at, m => m.description = 'flash promo',
  m => m.outcomes.forEach(o => o.dfs_odds_type = 'demon'), m => m.outcomes.forEach(o => o.last_seen_at = iso(now - 300001)),
  m => m.outcomes.forEach(o => o.boosted = true), m => m.outcomes.forEach(o => o.allowed_wager_types = 'under')]) {
  const e = structuredClone(event); change(e.bookmakers[0].markets[0]); assert.equal(normalizeOdds([e], 'nba', now, { goblins: true }).length, 0);
}
assert.equal(normalizeOdds([{ ...event, sport_key: 'americanfootball_nfl' }], 'nfl', now, { goblins: true }).length, 0);
const p = (id, probability, goblin = false) => ({ game_id: 'g' + id, player_id: id, player_name: 'Fixture ' + id, team: id, opponent: 'opp',
  stat: 'points', side: 'over', threshold: goblin ? 10.5 : 20.5, start_utc: start, game_start_utc: start, observed_utc: at,
  ...(goblin ? { offer_type: 'goblin' } : {}), role: { risk_flags: [] }, features: { unresolved_teammates: [] },
  market: { state: 'supported', low: probability, high: probability + 0.01, probability: probability + 0.005, books: [] } });
const a = p('aa', .8, true), b = p('bb', .8, true), c = p('cc', .65), d = p('dd', .65), candidates = [a, b, c, d];
const quote = (picks, multiplier) => ({ pair_id: nbaPairId(picks), offer_ids: picks.map(nbaOfferId), multiplier, source: 'owner_entered', observed_utc: at, expires_utc: iso(now + 300000) });
const plain = nbaSlateComparisons(candidates, null, now);
assert.equal(plain.pair_id, nbaPairId([a,b])); assert.equal(plain.payout, null); assert.equal(plain.best_value_pair_id, null);
assert.ok(plain.pairs.some(r => r.picks.every(p => p.offer_type === 'standard')));
assert.ok(plain.pairs.some(r => r.picks.filter(p => p.offer_type === 'goblin').length === 1));
const qs = [quote([a,b], 1.5), quote([c,d], 3)];
const priced = nbaSlateComparisons(candidates, null, now, { payouts: qs });
assert.equal(priced.best_hit_pair_id, nbaPairId([a,b])); assert.equal(priced.pair_id, nbaPairId([c,d]));
assert.equal(priced.selection_mode, 'expected_value'); assert.equal(priced.payout_checked_count, 2);
assert.ok(Math.abs(priced.pair.return_per_unit.low - (.65 * .65 * 3 - 1)) < 1e-6);
assert.ok(Math.abs(priced.pair.return_per_unit.central - (.655 * .655 * 3 - 1)) < 1e-6);
assert.ok(priced.pairs.find(r => r.pair_id === nbaPairId([a,b])).pair.return_per_unit.low < 0);
// A probability-dominated offer must still be priced from the complete pool.
const lowerA = { ...a, threshold: 12.5, market: { ...a.market, low: .7, high: .71, probability: .705 } };
const outside = nbaSlateComparisons([...candidates, lowerA], null, now, { payouts: [quote([lowerA,b], 3)] });
assert.equal(outside.pair_id, nbaPairId([lowerA,b]));
assert.equal(nbaPairId([a,b]), nbaPairId([b,a]));
for (const change of [{ threshold: 11.5 }, { side: 'under' }, { offer_type: 'standard' }, { start_utc: iso(now + 4000000), game_start_utc: iso(now + 4000000) }, { projection_id: 'new' }]) {
  assert.notEqual(nbaOfferId(a), nbaOfferId({ ...a, ...change }));
  const v = nbaSlateComparisons([{ ...a, ...change }, b], null, now, { payouts: [quote([a,b], 3)] });
  assert.equal(v.payout_checked_count, 0);
}
for (const q of [{ ...qs[1], expires_utc: at }, { ...qs[1], observed_utc: iso(now + 1) }, { ...qs[1], observed_utc: iso(now - 300000) }, { ...qs[1], source: 'standard_table' }])
  assert.equal(nbaSlateComparisons(candidates, null, now, { payouts: [q] }).payout_checked_count, 0);
const risk = { ...a, role: { risk_flags: ['unresolved'] } };
assert.equal(nbaSlateComparisons([risk,b], null, now, { payouts: [quote([risk,b], 3)] }).best_value_pair_id, null);
assert.equal(nbaSlateComparisons([{ ...a, game_start_utc: at }, b], null, now).picks.length, 0);
const soon = { ...qs[1], expires_utc: iso(now + 1000) };
assert.equal(nbaSlateComparisons(candidates, null, now, { payouts: [soon] }).expires_utc, soon.expires_utc);
const objects = new Map(); let writes = 0;
const store = { backend: 'r2', rawGet: async k => objects.has(k) ? Buffer.from(objects.get(k)) : null, rawPut: async (k,v) => { writes++; objects.set(k, String(v)); }, withLease: async (_,fn) => { await fn(() => {}); return { busy: false }; } };
const owner = '0123456789ab', other = '1123456789ab';
const view = { slates: [plain], games: candidates.map(p => ({ start_utc: p.game_start_utc, research: { candidates: [p] } })), sources: { injuries: { observed_utc: at } }, research_input: { model: null } };
const save = overrides => saveNBAPayout({ store, owner, view, offerIds: [nbaOfferId(a), nbaOfferId(b)], multiplier: 2, now, ...overrides });
const saved = await save(); assert.equal(saved.multiplier, 2); assert.equal(saved.operator, 'prizepicks');
assert.equal((await readNBAPayouts(store, owner)).length, 1); assert.equal((await readNBAPayouts(store, other)).length, 0);
await save({ multiplier: 2.1 }); assert.equal((await readNBAPayouts(store, owner)).length, 1);
assert.throws(() => sportsKey('nba-pair-payouts', { sport: 'nfl', owner }));
assert.throws(() => sportsKey('nba-pair-payouts', { sport: 'nba', owner: '../escape' }));
const before = writes;
for (const overrides of [{ offerIds: [nbaOfferId(a),nbaOfferId(a)] }, { offerIds: [nbaOfferId(a),'a'.repeat(32)] }, { multiplier: '3' }, { multiplier: 0 }, { multiplier: Infinity }, { clock: () => now + 300001 }, { store: { ...store, withLease: async () => ({ busy: true }) } }])
  await assert.rejects(() => save(overrides), e => [400,409].includes(e.status));
assert.equal(writes,before);
// Source refresh does not reset the confirmation clock.
const later = now + 120000, refreshed = candidates.map(p => ({ ...p, observed_utc: iso(later) }));
const kept = nbaSlateComparisons(refreshed, null, later, { payouts: [saved] });
assert.equal(kept.payout.expires_utc, saved.expires_utc);
assert.equal(nbaSlateComparisons(refreshed, null, now + 300000, { payouts: [saved] }).payout_checked_count, 0);
// Owner and same-origin gates execute before any feed access or store write.
const response = () => ({ setHeader() {}, status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } });
let calls = 0;
const deps = { store, env: { PRIVATE_DATA_ENABLED: '1' }, now: () => now, getSession: async () => ({ sub: 'owner', tr: true, tp: true }), loadPropSources: async () => { calls++; throw new Error('Should not fetch'); } };
for (const [req, extra, status] of [
  [{ method: 'GET', headers: {} }, {}, 405],
  [{ method: 'POST', headers: { host: 'site.invalid', origin: 'https://evil.invalid' } }, {}, 403],
  [{ method: 'POST', headers: {} }, { getSession: async () => null }, 403],
  [{ method: 'POST', headers: { host: 'site.invalid', origin: 'https://site.invalid' }, body: { sport: 'nfl' } }, {}, 400],
]) { const res = response(); await handleSportsRequest({ ...req, query: { sports: 'nba-slate-payout' } }, res, { ...deps, ...extra }); assert.equal(res.code, status); }
assert.equal(calls, 0); assert.equal(writes,before);
const link = { legs: [a,b].map(p => ({ ...p, sport: 'nba' })), payouts: { 2: 2 } };
assert.ok(decodePrefill(encodePrefill(link)).legs.every(p => p.offer_type === 'goblin'));
assert.equal(decodePrefill(encodePrefill({ ...link, legs: [{ ...link.legs[0], side: 'under' }] })), null);
console.log('NBA Goblin + exact-pair payout/EV smoke passed');

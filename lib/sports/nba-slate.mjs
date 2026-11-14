// NBA standard/Goblin comparisons. Actual payouts belong to an exact pair
// and owner; published standard tables and synthetic +100 prices are not offers.
import { createHash } from 'node:crypto';
import { nbaPairEstimate, nbaPicksExpiry, checkNBAPayout, selectNBASlate, quoteFresh } from './nba-market.mjs';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';

export const NBA_PAYOUT_AGE_MS = 300000;
const MAX_QUOTES = 64;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
export const nbaOfferId = (p) => hash([p.game_id, p.player_id, p.stat, p.side, p.threshold, p.offer_type || 'standard', p.projection_id || null, p.game_start_utc || p.start_utc]);
export const nbaPairId = (picks) => hash(picks.map(nbaOfferId).sort());
const risky = (p) => Boolean(p.role?.risk_flags?.length || p.features?.unresolved_teammates?.length);
const eligible = (p, now) => p.game_id && p.player_id && p.team && p.market?.state === 'supported' && quoteFresh(p.observed_utc, now) && Date.parse(p.start_utc) > now && nbaPicksExpiry([p], now) > now;
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const iso = (ms) => new Date(ms).toISOString();

function offer(p, now, injuryExpiry) {
  return { offer_id: nbaOfferId(p), game_id: p.game_id, player_id: p.player_id, player_name: p.player_name,
    team: p.team, opponent: p.opponent, stat: p.stat, side: p.side, threshold: p.threshold, offer_type: p.offer_type || 'standard',
    start_utc: p.game_start_utc || p.start_utc, expires_utc: iso(nbaPicksExpiry([p], now, { injuryExpiry })),
    low: p.market.low, probability: p.market.probability, risk: risky(p) };
}
const quoteCurrent = (q, now) => q?.source === 'owner_entered' && typeof q.multiplier === 'number' && q.multiplier > 1 && q.multiplier <= 100 &&
  Date.parse(q.observed_utc) <= now && Date.parse(q.observed_utc) + NBA_PAYOUT_AGE_MS > now && Date.parse(q.expires_utc) > now;

export function nbaSlateComparisons(candidates, model, now, { payouts = [], injuryExpiry } = {}) {
  const pool = candidates.filter((p) => eligible(p, now));
  const byId = new Map(pool.map((p) => [nbaOfferId(p), p]));
  const quotes = new Map(payouts.filter((q) => quoteCurrent(q, now)).map((q) => [q.pair_id, q]));
  const rowFor = (picks, estimate = nbaPairEstimate(picks, model, now)) => {
    const pair_id = nbaPairId(picks), ids = picks.map(nbaOfferId), q = quotes.get(pair_id);
    const payout = q && q.offer_ids?.length === 2 && q.offer_ids.every((id) => ids.includes(id)) ? q : null;
    const pair = payout ? checkNBAPayout(estimate, payout.multiplier) : estimate;
    return { pair_id, offer_ids: ids, picks: picks.map((p) => offer(p, now, injuryExpiry)), pair,
      expires_utc: iso(Math.min(nbaPicksExpiry(picks, now, { injuryExpiry }), payout ? Date.parse(payout.expires_utc) : Infinity)),
      payout: payout ? { multiplier: payout.multiplier, observed_utc: payout.observed_utc, expires_utc: payout.expires_utc, source: payout.source } : null };
  };
  const hit = selectNBASlate(pool, model, now);
  const hitRow = hit.picks.length === 2 ? rowFor(hit.picks, hit.pair) : null;
  // Actual payouts can reverse marginal dominance. Evaluate EVERY quoted pair
  // from the full pool, including offers omitted from the hit-rate shortlist.
  const priced = [];
  for (const q of quotes.values()) {
    if (!Array.isArray(q.offer_ids) || q.offer_ids.length !== 2) continue;
    const picks = q.offer_ids.map((id) => byId.get(id));
    if (picks.some((p) => !p) || picks[0].team === picks[1].team || picks[0].player_id === picks[1].player_id || nbaPairId(picks) !== q.pair_id) continue;
    const row = rowFor(picks);
    if (row.payout && row.pair.return_per_unit?.low != null) priced.push(row);
  }
  priced.sort((a, b) => Number(b.pair.state === 'positive_screen') - Number(a.pair.state === 'positive_screen') ||
    b.pair.return_per_unit.low - a.pair.return_per_unit.low || b.pair.low - a.pair.low || a.pair_id.localeCompare(b.pair_id));
  const bestValue = priced.find((r) => r.pair.state === 'positive_screen') || null;

  // Show four high-hit alternatives for each offer mix. Pair-specific payout
  // entry and the complete searchable offer pool let the owner compare others.
  const cases = new Map();
  for (const p of pool.slice().sort((a, b) => b.market.low - a.market.low || nbaOfferId(a).localeCompare(nbaOfferId(b)))) {
    const key = [p.game_id, p.team, p.stat, p.side, p.offer_type || 'standard', !!p.model?.regular_role, risky(p)].join('|');
    if (!cases.has(key)) cases.set(key, p);
  }
  const reduced = [...cases.values()], buckets = [[], [], []];
  for (let i = 0; i < reduced.length; i++) for (let j = i + 1; j < reduced.length; j++) {
    const a = reduced[i], b = reduced[j];
    if (a.team === b.team || a.player_id === b.player_id) continue;
    const kind = Number(a.offer_type === 'goblin') + Number(b.offer_type === 'goblin'), list = buckets[kind];
    const base = risky(a) || risky(b) ? 0 : 10;
    if (a.game_id !== b.game_id && list.length === 4 && base + Math.round(a.market.low * b.market.low * 1e6) / 1e6 <= list.at(-1).score) continue;
    const estimate = nbaPairEstimate([a, b], model, now), score = base + (estimate.low ?? -1);
    if (list.length < 4 || score > list.at(-1).score) {
      list.push({ score, picks: [a, b], estimate }); list.sort((x, y) => y.score - x.score); list.splice(4);
    }
  }
  const alternatives = buckets.flatMap((list) => list.map((r) => rowFor(r.picks, r.estimate)));
  const unique = new Map([...priced, ...(hitRow ? [hitRow] : []), ...alternatives].map((r) => [r.pair_id, r]));
  const chosen = bestValue || hitRow;
  return { ...hit, version: 'nba-slate-2', picks: chosen ? chosen.offer_ids.map((id) => byId.get(id)) : [], pair: chosen?.pair || hit.pair,
    pair_id: chosen?.pair_id || null, offer_ids: chosen?.offer_ids || [], payout: chosen?.payout || null,
    expires_utc: chosen?.expires_utc || iso(now + NBA_PAYOUT_AGE_MS),
    selection_mode: bestValue ? 'expected_value' : 'win_probability', best_value_pair_id: bestValue?.pair_id || null,
    best_hit_pair_id: hitRow?.pair_id || null, payout_checked_count: priced.length,
    pairs: [...unique.values()], offers: pool.map((p) => offer(p, now, injuryExpiry)),
    selection: bestValue ? 'Highest conservative expected return among pairs with current owner-confirmed payouts and no unresolved role risk; hit probability breaks ties.' :
      'No pair clears the current payout and role checks. Showing the highest conservative hit estimate for research; unpriced pairs need their actual app payout.' };
}

export async function readNBAPayouts(store, owner) {
  const value = await readSportsJson(store, sportsKey('nba-pair-payouts', { sport: 'nba', owner }));
  if (value && (value.version !== 'nba-pair-payouts-1' || !Array.isArray(value.quotes))) throw new Error('Invalid NBA payout record');
  return value?.quotes || [];
}

export async function saveNBAPayout({ store, owner, view, offerIds, multiplier, now, clock = () => now }) {
  checkNBAPayout({ state: 'pass', low: null, high: null }, multiplier); // shared numeric validation
  if (!Array.isArray(offerIds) || offerIds.length !== 2 || offerIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) || offerIds[0] === offerIds[1]) fail(400, 'Choose two different eligible player offers.');
  const slate = view.slates?.find((s) => offerIds.every((id) => s.offers?.some((p) => p.offer_id === id)));
  if (!slate) fail(409, 'These selections changed, expired or belong to different days. Refresh the board.');
  const all = view.games.flatMap((g) => (g.research?.candidates || []).map((p) => ({ ...p, game_start_utc: g.start_utc })));
  const picks = offerIds.map((id) => all.find((p) => nbaOfferId(p) === id));
  if (picks.some((p) => !p || !eligible(p, clock())) || picks[0].team === picks[1].team || picks[0].player_id === picks[1].player_id) fail(409, 'Choose two current players from different teams.');
  const injuryExpiry = Date.parse(view.sources.injuries.observed_utc) + 1800000;
  const inputExpiry = nbaPicksExpiry(picks, now, { injuryExpiry });
  // The confirmed payout has its own clock. Fresh reference quotes can be
  // re-read without demanding the same app payout again on every poll.
  const expires = Math.min(now + NBA_PAYOUT_AGE_MS, ...picks.flatMap((p) => [Date.parse(p.game_start_utc), Date.parse(p.start_utc)]));
  if (!(inputExpiry > clock())) fail(409, 'The inputs expired before the payout could be checked. Refresh the board.');
  if (store.backend !== 'r2' || typeof store.withLease !== 'function') fail(503, 'Payout comparisons need the private store.');
  const key = sportsKey('nba-pair-payouts', { sport: 'nba', owner });
  let saved;
  const result = await store.withLease('sports-nba-payouts-' + owner, async (guard) => {
    const quotes = await readNBAPayouts(store, owner), pair_id = nbaPairId(picks);
    saved = { pair_id, offer_ids: offerIds.slice().sort(), multiplier, operator: 'prizepicks', format: 'power', source: 'owner_entered', observed_utc: iso(now), expires_utc: iso(expires),
      picks: picks.map((p) => offer(p, now, injuryExpiry)), estimate_at_confirmation: nbaPairEstimate(picks, view.research_input.model, now) };
    if (!(Math.min(expires, inputExpiry) > clock())) fail(409, 'The pair expired before its payout could be saved. Refresh the board.');
    guard(); await writeSportsJson(store, key, { version: 'nba-pair-payouts-1', quotes: [...quotes.filter((q) => q.pair_id !== pair_id), saved].slice(-MAX_QUOTES) });
  });
  if (result?.busy) fail(409, 'Another payout check is finishing. Try again.');
  return saved;
}

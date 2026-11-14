// NBA-only quote comparisons. DFS synthetic +100 prices never enter this math.
import { foldName } from './read.mjs';
import { bvnUpper, invNorm } from './normal.mjs';
import { linkKey } from './joint.mjs';

export const NBA_ALPHA_VERSION = 'nba-market-1';
export const NBA_QUOTE_AGE_MS = 300000;
// Reference books (PropLine keys, https://prop-line.com/docs). Since
// 2026-11-13 NBA also reads Bovada, Unibet and the Novig / ProphetX
// exchanges, which PropLine lists with NBA player props: the same single
// request, more books per line (one line used to have at most two). A key the
// plan does not carry simply returns nothing.
export const NBA_BOOKS = Object.freeze(['draftkings', 'fanduel', 'betmgm', 'pinnacle', 'betrivers', 'fanatics', 'bovada', 'unibet', 'novig', 'prophetx']);
// NFL player props (2026-11-13): PropLine lists Bovada, Hard Rock, Kalshi and
// Polymarket in season (the big US books only at preseason, kept in case they
// return). The same strict rules as NBA: half lines, both sides, fresh, a
// margin between 0 and 25%.
export const NFL_BOOKS = Object.freeze(['bovada', 'hardrock', 'kalshi', 'polymarket_us', 'draftkings', 'fanduel', 'betmgm', 'fanatics', 'betrivers', 'pinnacle']);
export const NBA_REFERENCE_MARKETS = Object.freeze({ player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists', player_threes: 'threes',
  player_points_rebounds_assists: 'pra', player_points_rebounds: 'pts_reb', player_points_assists: 'pts_ast', player_rebounds_assists: 'reb_ast',
  player_steals: 'steals', player_blocks: 'blocks', player_turnovers: 'turnovers', player_blocks_steals: 'blk_stl' });
export const NFL_REFERENCE_MARKETS = Object.freeze({ player_pass_yds: 'passing_yards', player_receptions: 'receptions', player_rush_yds: 'rushing_yards',
  player_reception_yds: 'receiving_yards', player_pass_tds: 'passing_tds', player_pass_interceptions: 'interceptions',
  player_pass_completions: 'completions', player_pass_attempts: 'attempts', player_rush_attempts: 'carries',
  player_rush_tds: 'rushing_tds', player_reception_tds: 'receiving_tds', player_pass_rush_yds: 'pass_rush_yards', player_rush_reception_yds: 'rush_rec_yards' });
export const REFERENCE_BOOKS = Object.freeze({ nba: NBA_BOOKS, nfl: NFL_BOOKS });
export const REFERENCE_MARKETS = Object.freeze({ nba: NBA_REFERENCE_MARKETS, nfl: NFL_REFERENCE_MARKETS });
const SPORT_KEYS = { nba: 'basketball_nba', nfl: 'football_nfl' };
const COUNT_STATS = { nba: new Set(Object.values(NBA_REFERENCE_MARKETS)), nfl: new Set(Object.values(NFL_REFERENCE_MARKETS)) };
const round = (n) => Number.isFinite(n) ? Math.round(n * 1000000) / 1000000 : null;
const median = (xs) => { const a = xs.slice().sort((a, b) => a - b), i = Math.floor(a.length / 2); return a.length ? a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2 : null; };
export const nbaName = (s) => foldName(String(s || '').replace(/\([^)]*\)/g, '')).replace(/\s+(jr|sr|ii|iii|iv)$/, '');
export function quoteFresh(at, now) { const t = Date.parse(at); return Number.isFinite(t) && t <= now + 60000 && now - t <= NBA_QUOTE_AGE_MS; }
// Bookmaker margin removal (Shin 1993). Books load more of their margin onto
// long shots, so dividing each price by the total (the proportional method)
// leaves a favourite slightly too low and a long shot slightly too high. Shin
// models the margin as protection against a share z of informed money and
// solves for the z that makes the fair chances add to one:
//   p_i = (sqrt(z² + 4(1 − z)·π_i²/Π) − z) / (2(1 − z)),  Π = Σπ_i.
// Even prices come out the same as the proportional method; lopsided ones
// move toward the favourite (-200/+160: 63.4% becomes 64.1%; -400/+300:
// 76.2% becomes 77.5%). `implied` are the raw price chances.
export const VIG_METHOD = 'shin';
export function shinProbabilities(implied) {
  const total = implied.reduce((a, b) => a + b, 0);
  if (!(total > 1) || implied.some((p) => !(p > 0 && p < 1))) return implied.map((p) => p / total);
  const at = (z) => implied.map((p) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / total) - z) / (2 * (1 - z)));
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, sum = at(mid).reduce((a, b) => a + b, 0);
    if (sum > 1) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2);
}
export function impliedAmerican(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price) < 100 || Math.abs(price) > 1000000) return null;
  return price < 0 ? -price / (100 - price) : 100 / (100 + price);
}
function offered(o, m, book, now) {
  const observed = o.last_seen_at || m.last_update || book.last_update;
  if (!quoteFresh(observed, now)) return false;
  // A recently polled market can contain an outcome missing from that delivery.
  if (o.last_seen_at && m.last_update && Date.parse(o.last_seen_at) < Date.parse(m.last_update)) return false;
  const published = o.book_updated_at || m.book_updated_at || book.book_updated_at;
  // Pinnacle exposes the age of its cached feed. Missing is not fresh.
  if (book.key === 'pinnacle' && !published || published && !quoteFresh(published, now)) return false;
  return true;
}
export function nbaLineCurrent(o, market, book, now) { return offered(o, market, book, now); }

export function normalizeNBAQuotes(events, now) { return normalizeQuotes(events, now, 'nba'); }
export function normalizeQuotes(events, now, sport = 'nba') {
  if (!Array.isArray(events)) throw new Error('unexpected ' + String(sport).toUpperCase() + ' reference response');
  const books = REFERENCE_BOOKS[sport], markets = REFERENCE_MARKETS[sport];
  if (!books) throw new Error('unsupported sport');
  const out = [];
  for (const e of events) {
    if (e.live || e.sport_key && e.sport_key !== SPORT_KEYS[sport] || !(Date.parse(e.commence_time) > now)) continue;
    for (const b of e.bookmakers || []) {
      if (!books.includes(b.key)) continue;
      // Pair within one market delivery; never combine best prices across rows.
      const unique = new Map();
      for (const m of b.markets || []) {
        const stat = markets[m.key];
        if (!stat || m.suspended_at || m.period && !['full', 'full_game', 'game'].includes(m.period)) continue;
        if (m.line_type && !['main', 'alternate'].includes(m.line_type) || /promo|discount|boost|flash/i.test(m.description || '')) continue;
        const pairs = new Map();
        for (const o of m.outcomes || []) {
          const side = String(o.side || o.name).toLowerCase(), price = impliedAmerican(o.price);
          if (!['over', 'under'].includes(side) || !nbaName(o.description) || price == null || !offered(o, m, b, now)) continue;
          if (o.suspended_at || o.boosted || o.is_boosted || o.promotional || o.line_type && !['main', 'alternate'].includes(o.line_type)) continue;
          // Half lines on integer count stats have no push mass. Whole-line
          // two-way prices are conditional on not pushing and are not reused.
          if (typeof o.point !== 'number' || o.point < 0 || o.point > 1000 || o.point % 1 !== 0.5) continue;
          const key = nbaName(o.description) + '|' + o.point;
          const p = pairs.get(key) || { player_name: o.description, player_key: nbaName(o.description), threshold: o.point, sides: {}, invalid: false };
          const s = { price: o.price, implied: price, observed_utc: o.last_seen_at || m.last_update || b.last_update,
            book_updated_at: o.book_updated_at || m.book_updated_at || b.book_updated_at || null, last_change_at: o.last_change_at || null,
            provider_player_id: o.player_id || null };
          if (p.sides[side] && JSON.stringify(p.sides[side]) !== JSON.stringify(s)) p.invalid = true;
          p.sides[side] = s; pairs.set(key, p);
        }
        for (const p of pairs.values()) {
          const a = p.sides.over, z = p.sides.under;
          if (p.invalid || !a || !z || Math.abs(Date.parse(a.observed_utc) - Date.parse(z.observed_utc)) > 30000) continue;
          if (a.provider_player_id && z.provider_player_id && a.provider_player_id !== z.provider_player_id) continue;
          const margin = a.implied + z.implied;
          // No-margin exchanges (Novig, ProphetX, Kalshi) can price a pair
          // at exactly even money; a rounding hair under 1 is kept.
          if (margin < 0.995 || margin > 1.25) continue;
          const [overFair, underFair] = shinProbabilities([a.implied, z.implied]);
          const quote = { event_id: String(e.id), home_team: e.home_team, away_team: e.away_team, start_utc: e.commence_time,
            book: b.key, stat, ...p, over_probability: overFair, under_probability: underFair, vig_method: VIG_METHOD,
            margin: margin - 1, observed_utc: new Date(Math.min(Date.parse(a.observed_utc), Date.parse(z.observed_utc))).toISOString() };
          delete quote.invalid;
          const k = p.player_key + '|' + stat + '|' + p.threshold, prior = unique.get(k);
          if (!prior || Date.parse(quote.observed_utc) > Date.parse(prior.observed_utc)) unique.set(k, quote);
          else if (quote.observed_utc === prior.observed_utc && (quote.over_probability !== prior.over_probability || quote.under_probability !== prior.under_probability)) unique.set(k, { ...prior, conflicting: true });
        }
      }
      out.push(...[...unique.values()].filter((q) => !q.conflicting));
    }
  }
  return out;
}

// Compare strict integer wins. For an integer PP line T, More T is the same
// win event as sportsbook Over T+0.5; Less T is Under T-0.5.
// `sport`: 'nba' (default) or 'nfl', the same rules over that sport's books.
export function nbaMarketForProp(p, quotes, now, { historicalThreshold = false, sport = 'nba' } = {}) {
  const no = (reason) => ({ state: 'unavailable', reason, books: [], book_count: 0, method: null, probability: null, low: null, high: null });
  if (!COUNT_STATS[sport]?.has(p.stat)) return no('No supported two-way market for this stat.');
  if (!historicalThreshold && (!quoteFresh(p.observed_utc, now) || !(Date.parse(p.start_utc) > now))) return no('PrizePicks selection is stale or started.');
  const target = Number.isInteger(p.threshold) ? p.threshold + (p.side === 'over' ? 0.5 : -0.5) : p.threshold;
  const matches = quotes.filter((q) => q.event_id === p.event_id && q.stat === p.stat && q.player_key === nbaName(p.player_name) &&
    foldName(q.home_team) === foldName(p.home_team) && foldName(q.away_team) === foldName(p.away_team) &&
    Math.abs(Date.parse(q.start_utc) - Date.parse(p.start_utc)) <= 600000 && Date.parse(q.start_utc) > now && quoteFresh(q.observed_utc, now) &&
    Object.values(q.sides).every((s) => quoteFresh(s.observed_utc, now) && (!s.book_updated_at || quoteFresh(s.book_updated_at, now))));
  const books = [];
  for (const book of REFERENCE_BOOKS[sport]) {
    const rows = matches.filter((q) => q.book === book), sign = p.side === 'over' ? 1 : -1;
    const lower = rows.filter((q) => sign * (q.threshold - target) >= 0), upper = rows.filter((q) => sign * (q.threshold - target) <= 0);
    const prob = (q) => q[p.side + '_probability'];
    const lowQ = lower.sort((a, b) => prob(b) - prob(a))[0], highQ = upper.sort((a, b) => prob(a) - prob(b))[0];
    if (!lowQ) continue; // No fabricated probability from a one-sided upper bound.
    const low = prob(lowQ), high = highQ ? prob(highQ) : 1;
    if (low > high + 0.000001) continue; // Contradictory ladder, fail closed.
    const exact = rows.find((q) => q.threshold === target);
    books.push({ book, low: round(low), high: round(high), probability: exact ? round(prob(exact)) : null,
      method: exact ? 'exact' : 'monotone_bound', lower_quote: lowQ, upper_quote: highQ || null });
  }
  if (!books.length) return no('No fresh, coherent two-sided sportsbook comparison.');
  const allExact = books.every((b) => b.method === 'exact');
  const ppChanged = Date.parse(p.last_change_at), changes = books.map((b) => ({ book: b.book, at: b.lower_quote.sides[p.side]?.last_change_at }))
    .filter((b) => Number.isFinite(Date.parse(b.at)) && Date.parse(b.at) <= now + 60000);
  const later = Number.isFinite(ppChanged) ? changes.filter((b) => Date.parse(b.at) > ppChanged) : [];
  return { state: books.length >= 3 ? 'supported' : 'thin', reason: books.length >= 3 ? null : 'At least three distinct reference operators are required.',
    method: allExact ? 'exact' : 'monotone_bound', book_count: books.length, books,
    probability: allExact ? round(median(books.map((b) => b.probability))) : null,
    low: round(Math.min(...books.map((b) => b.low))), high: round(Math.max(...books.map((b) => b.high))),
    median_lower: round(median(books.map((b) => b.low))),
    movement: { prizepicks_last_change_at: p.last_change_at || null, reference_changes: changes, later_operators: later.length,
      watch: books.length >= 3 && later.length >= 2 && now - ppChanged >= 60000 && Math.min(...books.map((b) => b.low)) > 0.55,
      note: 'Later reference moves are a repricing watch, not proof of delayed PrizePicks adjustment. No probability boost is applied.' },
    vig_method: VIG_METHOD,
    note: 'Prices with bookmaker margin removed (Shin method); bounds describe quotes, not statistical confidence or validated win chances.' };
}

export function nbaPairEstimate(picks, model, now) {
  const no = (reason) => ({ state: 'pass', reason, method: null, low: null, high: null, probability: null, required_multiplier: null, quality: 'experimental' });
  if (picks.length !== 2 || picks[0].team === picks[1].team || picks[0].player_id === picks[1].player_id) return no('Two different players from different teams are required.');
  if (picks.some((p) => p.market?.state !== 'supported')) return no('Both props need fresh comparisons from at least three reference operators.');
  if (picks.some((p) => !quoteFresh(p.observed_utc, now) || !(Date.parse(p.start_utc) > now) || !(nbaPicksExpiry([p], now) > now))) return no('The selections expired. Refresh the board.');
  const [a, b] = picks, floor = Math.max(0, a.market.low + b.market.low - 1), ceiling = Math.min(a.market.high, b.market.high);
  const lk = model?.joint?.pairs?.[linkKey(a.stat, b.stat, 'opponent')];
  const freshModel = model?.as_of_date && now - Date.parse(model.as_of_date + 'T00:00Z') >= 0 && now - Date.parse(model.as_of_date + 'T00:00Z') <= 7 * 86400000;
  let low = floor, high = ceiling, probability = null, method = 'frechet_bounds', correlation = null;
  const crossGame = a.game_id && b.game_id && a.game_id !== b.game_id;
  if (crossGame) {
    low = a.market.low * b.market.low; high = a.market.high * b.market.high;
    if (a.market.probability != null && b.market.probability != null) probability = a.market.probability * b.market.probability;
    method = 'independent_games';
  } else if (freshModel && lk?.status === 'validated' && Number.isFinite(lk.link) && Number.isFinite(lk.interval?.low) && Number.isFinite(lk.interval?.high) && picks.every((p) => p.model?.regular_role)) {
    const direction = a.side === b.side ? 1 : -1;
    const rs = [lk.interval.low * direction, lk.interval.high * direction].sort((x, y) => x - y);
    const joint = (x, y, r) => bvnUpper(invNorm(1 - x), invNorm(1 - y), Math.max(-0.9, Math.min(0.9, r)));
    low = Math.max(floor, joint(a.market.low, b.market.low, rs[0]));
    high = Math.min(ceiling, joint(a.market.high, b.market.high, rs[1]));
    if (a.market.probability != null && b.market.probability != null) probability = joint(a.market.probability, b.market.probability, lk.link * direction);
    method = 'copula_sensitivity'; correlation = { link: lk.link, interval: lk.interval, fitted_as_of: model.as_of_date };
  }
  const risk = picks.flatMap((p) => p.role?.risk_flags || []).concat(picks.flatMap((p) => p.features?.unresolved_teammates || []).map(() => 'unresolved_teammate'));
  return { state: risk.length ? 'pass' : 'payout_needed', reason: risk.length ? 'Unresolved lineup or workload risk. Keep this as research.' : 'Enter the actual two-pick total payout to evaluate the pair.',
    method, low: round(low), high: round(Math.max(low, high)), probability: round(probability), required_multiplier: low > 0 ? round(1 / low) : null,
    correlation, risk_flags: [...new Set(risk)], quality: 'experimental',
    note: (crossGame ? 'Assumes independent outcomes in different games. ' : '') + 'Quote/link sensitivity range, not a confidence interval. The transfer from sportsbook prices to this pair is not prospectively validated.' };
}

export function checkNBAPayout(pair, multiplier) {
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 1 || multiplier > 100) throw Object.assign(new Error('Enter the actual total payout multiplier, greater than 1 and at most 100.'), { status: 400, expose: true });
  const low = pair.low == null ? null : multiplier * pair.low - 1, high = pair.high == null ? null : multiplier * pair.high - 1;
  return { ...pair, state: pair.state !== 'pass' && low > 0 ? 'positive_screen' : 'pass', payout_multiplier: multiplier,
    breakeven_probability: round(1 / multiplier), return_per_unit: { low: round(low), high: round(high) },
    reason: pair.state === 'pass' ? pair.reason : low > 0 ? 'The entered payout clears this experimental sensitivity screen.' : 'The entered payout does not clear the conservative estimate. Pass.',
    note: 'User-supplied payout. Experimental estimates, not verified alpha. Pushes/voids are not assigned a payout; paper ROI excludes them.' };
}

export function selectNBAProps(candidates, quotes, model, now) {
  const ranked = candidates.map((p) => ({ ...p, market: nbaMarketForProp(p, quotes, now) }));
  ranked.sort((a, b) => Number(b.market.state === 'supported') - Number(a.market.state === 'supported') ||
    (b.market.low ?? -1) - (a.market.low ?? -1) || b.rank_score - a.rank_score || a.player_id.localeCompare(b.player_id) || a.stat.localeCompare(b.stat));
  const teams = [...new Set(ranked.map((p) => p.team))];
  let picks = [], best = -Infinity;
  if (teams.length === 2) {
    for (const a of ranked.filter((p) => p.team === teams[0]).slice(0, 10)) for (const b of ranked.filter((p) => p.team === teams[1]).slice(0, 10)) {
      const pair = nbaPairEstimate([a, b], model, now), score = (pair.state === 'payout_needed' ? 10 : 0) + (pair.low ?? -1);
      if (score > best) { best = score; picks = [a, b]; }
    }
  } else if (ranked.length) picks = [ranked[0]];
  return { picks, pair: nbaPairEstimate(picks, model, now), candidates: ranked };
}

// Each recommendation expires with its own inputs, not another game's quote.
// The two-minute polling cadence is separate from the five-minute source limit.
export function nbaPicksExpiry(picks, now, { start, injuryExpiry } = {}) {
  const deadlines = [now + NBA_QUOTE_AGE_MS, Date.parse(start), injuryExpiry];
  for (const p of picks) {
    deadlines.push(Date.parse(p.observed_utc) + NBA_QUOTE_AGE_MS, Date.parse(p.start_utc), Date.parse(p.game_start_utc));
    for (const b of p.market?.books || []) for (const q of [b.lower_quote, b.upper_quote].filter(Boolean)) {
      deadlines.push(Date.parse(q.observed_utc) + NBA_QUOTE_AGE_MS, Date.parse(q.start_utc));
      for (const side of Object.values(q.sides || {})) deadlines.push(Date.parse(side.observed_utc) + NBA_QUOTE_AGE_MS,
        side.book_updated_at ? Date.parse(side.book_updated_at) + NBA_QUOTE_AGE_MS : NaN);
    }
  }
  return Math.min(...deadlines.filter(Number.isFinite));
}

// Inputs already have their own matched markets and canonical game times.
// Keep every non-dominated stat/side/role case; a higher marginal lower bound
// always dominates a lower one for the same pair correlation and risk state.
export function selectNBASlate(candidates, model, now) {
  const eligible = candidates.filter((p) => p.game_id && p.player_id && p.team && p.market?.state === 'supported' && quoteFresh(p.observed_utc, now) && Date.parse(p.start_utc) > now && nbaPicksExpiry([p], now) > now);
  const ranked = eligible.slice().sort((a, b) => b.market.low - a.market.low || (b.rank_score || 0) - (a.rank_score || 0) ||
    [a.game_id, a.player_id, a.stat, a.side, a.threshold].join('|').localeCompare([b.game_id, b.player_id, b.stat, b.side, b.threshold].join('|')));
  const cases = new Map(), risky = new Set();
  for (const p of ranked) {
    const risk = Boolean(p.role?.risk_flags?.length || p.features?.unresolved_teammates?.length);
    if (risk) risky.add(p);
    const key = [p.game_id, p.team, p.stat, p.side, Boolean(p.model?.regular_role), risk].join('|');
    if (!cases.has(key)) cases.set(key, p);
  }
  const pool = [...cases.values()];
  let picks = [], pair = nbaPairEstimate([], model, now), best = -Infinity, comparisons = 0;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j];
    if (a.player_id === b.player_id || a.team === b.team) continue;
    comparisons++;
    // Cross-game lower bounds are exactly the product. Avoid rechecking
    // dozens of quote timestamps for a pair that cannot beat the incumbent.
    if (a.game_id !== b.game_id && (risky.has(a) || risky.has(b) ? 0 : 10) + round(a.market.low * b.market.low) <= best) continue;
    const estimate = nbaPairEstimate([a, b], model, now);
    const score = (estimate.state === 'payout_needed' ? 10 : 0) + (estimate.low ?? -1);
    if (score > best) { best = score; picks = [a, b]; pair = estimate; }
  }
  return { version: 'nba-slate-1', picks, pair, candidate_count: candidates.length, eligible_count: eligible.length, comparisons,
    selection: 'Highest conservative joint estimate among fresh, supported two-player combinations on this day; pairs without unresolved role risk take priority.' };
}

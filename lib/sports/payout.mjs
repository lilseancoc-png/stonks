// Pick'em entry math (roadmap V4 §5.2-5.4). Pure and deterministic: the page,
// the saved paper entries and later the MCP all call these functions, so one
// set of inputs always gives one answer. Payouts are the GROSS multipliers
// the owner reads off the operator's app (stake included); the site never
// derives a payout from the number of picks.
// power / flex: pick'em payout tables. parlay (2026-11-12): sportsbook or
// prediction-market odds, each pick's odds multiplied (or one price for the
// whole parlay); a pushed pick drops out and a loss loses the entry.
export const FORMATS = Object.freeze(['power', 'flex', 'parlay']);
export const MAX_LEGS = 6;
export const MIN_LEGS = 1;

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const cents = (x) => round(x, 2);

// One leg against a final stat. Whole-number lines can push.
export function legResult(value, side, threshold) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value === threshold) return 'push';
  const over = value > threshold;
  return (side === 'over') === over ? 'win' : 'loss';
}

// P(exactly k legs win) for independent legs with win chances `ps`.
export function poissonBinomial(ps) {
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) { next[k] += dist[k] * (1 - p); next[k + 1] += dist[k] * p; }
    dist = next;
  }
  return dist;
}

// Bounds on P(all legs win) that hold under ANY dependence between legs.
export function jointBounds(ps) {
  if (!ps.length) return { low: null, high: null };
  return { low: Math.max(0, ps.reduce((a, b) => a + b, 0) - (ps.length - 1)), high: Math.min(...ps) };
}

// payouts: { "<legs won>": gross multiplier }. Power pays only when every leg
// wins; flex may pay for fewer. Returns a list of problems (empty when fine).
export function payoutProblems(format, legs, payouts) {
  const errs = [];
  if (!FORMATS.includes(format)) errs.push('format must be power, flex or parlay');
  if (!payouts || typeof payouts !== 'object' || Array.isArray(payouts)) return errs.concat('payouts must be an object');
  const keys = Object.keys(payouts);
  for (const k of keys) {
    const n = Number(k), m = payouts[k];
    if (!Number.isInteger(n) || n < 0 || n > legs) errs.push('payout keys must be a number of winning legs from 0 to ' + legs);
    else if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > 100000) errs.push('payout for ' + k + ' must be a multiplier from 0 to 100000');
  }
  if (format === 'parlay') {
    if (!(payouts[legs] > 1)) errs.push(legs === 1 ? 'enter the odds for the pick' : 'enter the odds for each pick or for the whole parlay');
    if (keys.some((k) => Number(k) !== legs)) errs.push('a parlay pays only when no pick loses');
    return errs;
  }
  if (!(payouts[legs] > 0)) errs.push(legs === 1 ? 'enter the payout if the pick wins' : 'enter the payout for all ' + legs + ' picks winning');
  if (format === 'power' && keys.some((k) => Number(k) !== legs)) errs.push('a power entry pays only when every pick wins');
  return errs;
}

// The chance EACH pick needs, if every pick had the same chance and they were
// independent, for the entry to pay back its stake on average. Power: the
// n-th root of 1 / payout. Flex: solved from the whole payout table (the
// chance p where Σ C(n,k)·p^k·(1−p)^(n−k)·payout[k] = 1). Null when the
// table never pays back (nothing to solve) or no payout is entered yet.
export function perPickBreakeven(format, payouts, n) {
  if (!(n >= 1) || !payouts || !(payouts[n] > 0)) return null;
  if (format === 'power' || format === 'parlay') return payouts[n] >= 1 ? round(payouts[n] ** (-1 / n), 6) : null;
  const ev = (p) => poissonBinomial(new Array(n).fill(p)).reduce((sum, pk, k) => sum + pk * (payouts[k] || 0), 0);
  if (ev(1) < 1) return null;
  if (ev(0) >= 1) return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ev(mid) >= 1) hi = mid; else lo = mid; }
  return round(hi, 6);
}

// Wilson 95% range for a hit rate of `hits` out of `n` decided games: where
// the player's true rate plausibly sits given so few games.
export function wilsonRange(hits, n, z = 1.959963984540054) {
  if (!(n > 0)) return null;
  const p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: round(Math.max(0, (c - m) / d), 4), high: round(Math.min(1, (c + m) / d), 4) };
}

// Expected payback from a distribution of the number of winning legs
// (distribution[k] = chance exactly k win).
export function payoutValue({ stake, payouts, distribution }) {
  const gross = distribution.reduce((sum, pk, k) => sum + pk * (payouts[k] || 0), 0) * stake;
  return { expected_gross: cents(gross), expected_net: cents(gross - stake), expected_roi: round((gross - stake) / stake, 4) };
}

// Expected value of one entry from per-leg win chances, treating the legs
// as independent. It is a labeled baseline, and the caller must not use it
// for legs from the same game (see sameGameGroups and lib/sports/joint.mjs).
export function evaluatePayout({ stake, format, payouts, probabilities }) {
  const n = probabilities.length;
  const all = payouts[n];
  const breakeven = format === 'power' && all > 0 ? round(1 / all, 6) : null;
  const perPick = perPickBreakeven(format, payouts, n);
  if (probabilities.some((p) => typeof p !== 'number' || !(p >= 0 && p <= 1))) {
    return { status: 'needs_probabilities', method: null, breakeven_probability: breakeven, breakeven_per_pick: perPick };
  }
  const dist = poissonBinomial(probabilities);
  return {
    status: 'independence_baseline',
    method: 'independent',
    joint_probability: round(dist[n], 6),
    bounds: Object.fromEntries(Object.entries(jointBounds(probabilities)).map(([k, v]) => [k, round(v, 6)])),
    distribution: dist.map((v) => round(v, 6)),
    breakeven_probability: breakeven,
    breakeven_per_pick: perPick,
    ...payoutValue({ stake, payouts, distribution: dist }),
  };
}

// Is this entry worth playing at these chances and payouts? (owner ask
// 2026-11-13). One read for the Pick Builder, the saved journal and the
// MCP, so the three always agree. It reads the evaluation the pricer already
// made and adds nothing to it:
//   negative_ev  the expected return is below 0 (or, with no combined chance,
//                below 0 under every possible link between same-game picks)
//   unsure       the expected return is 0 or more, but under 0.05% (it
//                shows as 0.0%: about break-even), or it drops below 0
//                somewhere in its range (how sure each same-game link is), or
//                at the hit rates the model's past calls near these chances
//                actually had (`tested`, the same pricing with each model
//                chance moved by the holdout miss at that chance); or there
//                is no combined chance and the any-link range runs from
//                below 0 to above 0
//   positive_ev  0.05% or more and it stays at 0 or more through every check
//   unknown      a payout or a chance is missing, or nothing bounds the return
// `weak_picks`: picks whose chance sits under what each pick needs if all
// were equally likely and independent (power, flex, a one-price parlay), or
// whose own odds lose money at its chance (a parlay with each pick's odds).
// A hint at which pick drags the entry, not a second verdict.
export const EV_CHECK_VERSION = 1;
const pctText = (p) => (Math.round(p * 1000) / 10).toFixed(1) + '%';
// Same rounding as the page's "% return" tile, so the two never differ.
const roiText = (r) => (r > 0 ? '+' : r < 0 ? '−' : '') + (Math.abs(r) * 100).toFixed(1) + '%';
export function evCheck({ evaluation, format, stake, legs, tested = null }) {
  const E = evaluation || {};
  const n = Array.isArray(legs) ? legs.length : 0;
  const from = {};
  for (const l of legs || []) if (l.probability != null) from[l.probability_source || 'owner'] = (from[l.probability_source || 'owner'] || 0) + 1;
  const chance = typeof E.joint_probability === 'number' ? E.joint_probability : null;
  const breakeven = typeof E.breakeven_probability === 'number' ? E.breakeven_probability : null;
  const roi = typeof E.expected_roi === 'number' && Number.isFinite(E.expected_roi) ? E.expected_roi : null;
  const nr = E.expected_net_range;
  const roiRange = nr && stake > 0 && Number.isFinite(nr.low) && Number.isFinite(nr.high) ? { low: round(nr.low / stake, 4), high: round(nr.high / stake, 4) } : null;
  const atTested = tested && typeof tested.expected_roi === 'number' ? { expected_roi: tested.expected_roi, picks: tested.picks } : null;
  const perPick = typeof E.breakeven_per_pick === 'number' ? E.breakeven_per_pick : null;
  const priced = format === 'parlay' && (legs || []).every((l) => l.price > 1);
  const weak = [];
  (legs || []).forEach((l, i) => {
    if (l.probability == null) return;
    if (priced) { if (typeof l.odds?.edge === 'number' && l.odds.edge < 0) weak.push({ pick: i + 1, chance: l.probability, edge: l.odds.edge }); }
    else if (n > 1 && perPick != null && l.probability < perPick) weak.push({ pick: i + 1, chance: l.probability, needs: perPick });
  });
  let verdict = 'unknown', reason;
  if (E.status === 'needs_payout') reason = 'Enter the payout to check the expected value.';
  else if (E.status === 'needs_probabilities') reason = 'Enter a chance for every pick to check the expected value.';
  else if (roi != null) {
    const dips = [roiRange && roiRange.low < 0 ? 'range' : null, atTested && atTested.expected_roi < 0 ? 'tested' : null].filter(Boolean);
    // Under 0.05% either way the return shows as 0.0%: a loss that small is
    // still a loss (warn below 0), and a gain that small is no edge.
    const flat = Math.abs(roi) < 0.0005;
    verdict = roi < 0 ? 'negative_ev' : dips.length || flat ? 'unsure' : 'positive_ev';
    const odds = chance != null && breakeven != null ? ' ' + (n === 1 ? 'It hits ' : n === 2 ? 'Both hit ' : 'All ' + n + ' hit ') + pctText(chance) + ' of the time against ' + pctText(breakeven) + ' needed.' : '';
    reason = (roi < 0 ? 'This entry loses ' + (flat ? 'a little (under 0.1% of the stake)' : 'about ' + roiText(roi).slice(1) + ' of the stake') + ' on average at these chances and payouts.'
      : flat ? 'This entry about breaks even at these chances and payouts (expected return under 0.1%).'
      : 'Expected return ' + roiText(roi) + ' at these chances and payouts.') + odds;
    if (verdict === 'unsure' && dips.length) reason += ' It is not a clear edge: ' + [
      dips.includes('range') ? 'it falls to ' + roiText(roiRange.low) + ' at the low end of the same-game range' : null,
      dips.includes('tested') ? 'at the hit rates the model’s past calls near these chances actually had, it is ' + roiText(atTested.expected_roi) : null,
    ].filter(Boolean).join(', and ') + '.';
    else if (atTested) reason += ' At the hit rates the model’s past calls near these chances actually had, it would be ' + roiText(atTested.expected_roi) + '.';
  } else if (roiRange) {
    verdict = roiRange.high < 0 ? 'negative_ev' : roiRange.low >= 0 ? 'positive_ev' : 'unsure';
    reason = verdict === 'negative_ev' ? 'This entry loses money under any link between the same-game picks: ' + roiText(roiRange.low) + ' to ' + roiText(roiRange.high) + ' of the stake.'
      : verdict === 'positive_ev' ? 'Expected return ' + roiText(roiRange.low) + ' to ' + roiText(roiRange.high) + ' under any link between the same-game picks.'
      : 'No combined chance yet: under the possible links the expected return runs from ' + roiText(roiRange.low) + ' to ' + roiText(roiRange.high) + ', so the sign is not known.';
  } else reason = E.status === 'not_calculated' ? 'No combined chance and no range for this entry, so its expected value is not known.' : 'The expected value is not known.';
  return {
    version: EV_CHECK_VERSION, verdict, reason,
    expected_roi: roi, roi_range: roiRange, at_tested_rates: atTested,
    chance_all_hit: chance, breakeven, gap_pts: chance != null && breakeven != null ? round((chance - breakeven) * 100, 1) : null,
    chances_from: from, weak_picks: weak,
  };
}

// Legs that share a game move together, so multiplying their chances would
// overstate or understate the joint chance. Returns games with 2+ legs.
export function sameGameGroups(legs) {
  const by = new Map();
  legs.forEach((leg, i) => {
    const key = leg.sport + ':' + leg.game_id;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(i);
  });
  return [...by.entries()].filter(([, idx]) => idx.length > 1).map(([key, idx]) => ({ game: key.split(':')[1], legs: idx }));
}

// How an entry ended for the owner: more back than staked, the stake back
// (a refund), some of it back, or nothing.
export function outcomeOf(gross, stake) {
  return gross > stake ? 'win' : gross === stake ? 'refund' : gross > 0 ? 'partial' : 'loss';
}

// Settle one entry from leg results. Pushes and voids follow each operator's
// own rules (a void usually drops the entry to a smaller payout table), so
// they are left for the owner to settle by hand instead of guessed.
// A parlay: any loss loses it; a push or a void drops that pick. With each
// pick's odds stored (`prices`) the rest pay their odds multiplied; with only
// one price for the whole parlay, a dropped pick is the app's call.
export function settleFromLegs({ stake, format, payouts, results, prices = null }) {
  if (format === 'parlay' && results.includes('loss')) return { state: 'settled', outcome: 'loss', gross: 0, net: cents(-stake) };
  if (results.some((r) => r == null)) return { state: 'pending' };
  if (format === 'parlay') {
    const wins = results.filter((r) => r === 'win').length;
    const perPick = Array.isArray(prices) && prices.length === results.length && prices.every((d) => d > 1);
    if (!perPick && wins < results.length) return { state: 'review', reason: 'A pick pushed or did not play; enter what the app paid.' };
    const mult = perPick ? results.reduce((a, r, i) => a * (r === 'win' ? prices[i] : 1), 1) : payouts[results.length] || 0;
    const gross = cents(mult * stake);
    return { state: 'settled', outcome: outcomeOf(gross, stake), wins, gross, net: cents(gross - stake) };
  }
  if (format === 'power' && results.includes('loss')) return { state: 'settled', outcome: 'loss', gross: 0, net: cents(-stake) };
  if (results.some((r) => r === 'push' || r === 'void')) return { state: 'review', reason: 'A pick pushed or did not play; enter what the app paid.' };
  const wins = results.filter((r) => r === 'win').length;
  const gross = cents((payouts[wins] || 0) * stake);
  return { state: 'settled', outcome: outcomeOf(gross, stake), wins, gross, net: cents(gross - stake) };
}

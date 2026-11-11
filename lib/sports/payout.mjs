// Pick'em entry math (roadmap V4 §5.2-5.4). Pure and deterministic: the page,
// the saved paper entries and later the MCP all call these functions, so one
// set of inputs always gives one answer. Payouts are the GROSS multipliers
// the owner reads off the operator's app (stake included); the site never
// derives a payout from the number of picks.
export const FORMATS = Object.freeze(['power', 'flex']);
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
  if (!FORMATS.includes(format)) errs.push('format must be power or flex');
  if (!payouts || typeof payouts !== 'object' || Array.isArray(payouts)) return errs.concat('payouts must be an object');
  const keys = Object.keys(payouts);
  for (const k of keys) {
    const n = Number(k), m = payouts[k];
    if (!Number.isInteger(n) || n < 0 || n > legs) errs.push('payout keys must be a number of winning legs from 0 to ' + legs);
    else if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > 100000) errs.push('payout for ' + k + ' must be a multiplier from 0 to 100000');
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
  if (format === 'power') return payouts[n] >= 1 ? round(payouts[n] ** (-1 / n), 6) : null;
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
export function settleFromLegs({ stake, format, payouts, results }) {
  if (results.some((r) => r == null)) return { state: 'pending' };
  if (format === 'power' && results.includes('loss')) return { state: 'settled', outcome: 'loss', gross: 0, net: cents(-stake) };
  if (results.some((r) => r === 'push' || r === 'void')) return { state: 'review', reason: 'A pick pushed or did not play; enter what the app paid.' };
  const wins = results.filter((r) => r === 'win').length;
  const gross = cents((payouts[wins] || 0) * stake);
  return { state: 'settled', outcome: outcomeOf(gross, stake), wins, gross, net: cents(gross - stake) };
}

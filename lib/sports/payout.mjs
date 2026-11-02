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

// Expected value of one entry from per-leg win chances. `independent` is
// the only joint method so far; it is a labeled baseline, and the caller
// must not use it for legs from the same game (see sameGameGroups).
export function evaluatePayout({ stake, format, payouts, probabilities }) {
  const n = probabilities.length;
  const all = payouts[n];
  const breakeven = format === 'power' && all > 0 ? round(1 / all, 6) : null;
  if (probabilities.some((p) => typeof p !== 'number' || !(p >= 0 && p <= 1))) {
    return { status: 'needs_probabilities', method: null, breakeven_probability: breakeven };
  }
  const dist = poissonBinomial(probabilities);
  const gross = dist.reduce((sum, pk, k) => sum + pk * (payouts[k] || 0), 0) * stake;
  return {
    status: 'independence_baseline',
    method: 'independent',
    joint_probability: round(dist[n], 6),
    bounds: Object.fromEntries(Object.entries(jointBounds(probabilities)).map(([k, v]) => [k, round(v, 6)])),
    distribution: dist.map((v) => round(v, 6)),
    breakeven_probability: breakeven,
    expected_gross: cents(gross),
    expected_net: cents(gross - stake),
    expected_roi: round((gross - stake) / stake, 4),
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

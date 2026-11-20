// Pick'em promotions (2026-11-20). Pure and deterministic: the Pick Builder,
// the saved paper journal and the MCP's sports_evaluate_entry all call these,
// so one entry always gets one answer. Nothing here reads PrizePicks or any
// promo feed: the owner types what the app shows.
//
// Two kinds of promo:
//
//   An entry promo changes what the entry pays (`promo` on the entry):
//     profit_boost   the profit above the stake grows by b:
//                    R' = 1 + (R - 1) x (1 + b) when R > 1, optionally capped
//                    at `max_boost` dollars of extra profit. Losing and
//                    break-even results are unchanged.
//     protected      a net loss comes back as a Bonus Lineup worth `conversion`
//                    (c) per $1 of face value: value = R + c x max(0, 1 - R),
//                    optionally capped at `max_bonus` dollars of face value.
//                    Bonus credit is not cash; c is the owner's estimate of
//                    how much of it ends up withdrawable.
//   A promo line changes one pick's line (`offer_type` on a player pick):
//     discount       a Taco / Flash Sale line set below the normal line (More
//                    only). Priced from how often real lines that much lower
//                    were cleared (the clearance table, below), not the model.
//     guarantee      a 0.5 line (More only). Priced from how often players
//                    with the same forecast recorded none of the stat (the
//                    zero table), not the model's curve.
//
// Both tables are measured on stored outcomes by the model refit
// (lib/sports/models.mjs buildModel, `promo_tables`) and only describe the
// past: a real Taco line may be set on a different mix of players.
export const PROMO_VERSION = 1;
export const ENTRY_PROMOS = Object.freeze(['none', 'profit_boost', 'protected']);
export const PROMO_LINES = Object.freeze(['discount', 'guarantee']);
// The PDF's worked example; the owner should set the real one.
export const DEFAULT_CONVERSION = 0.4;
// Clearance grid: the promo line as a share of the normal line, 0 to 1.
export const RATIO_STEP = 0.025;
const RATIO_POINTS = Math.round(1 / RATIO_STEP) + 1;
export const BUCKET_MIN = 200;   // real lines per normal-line bucket
export const TABLE_MIN = 100;    // fewer real lines for a stat: no clearance rate
export const ZERO_BINS = 10;
export const ZERO_MIN = 200;     // records per stat for a zero table

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const cents = (x) => round(x, 2);

// Wilson 95% range (same as payout.mjs, kept local so this file has no imports).
function wilson(hits, n, z = 1.959963984540054) {
  if (!(n > 0)) return null;
  const p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: round(Math.max(0, (c - m) / d)), high: round(Math.min(1, (c + m) / d)) };
}

// The owner's entry promo, checked. Returns { promo, problems }; promo is
// null for none. Percent inputs: boost_pct 1-500 (a 25% boost is 25).
export function cleanPromo(raw) {
  const problems = [];
  if (raw == null || raw === '' || raw.type == null || raw.type === 'none') return { promo: null, problems };
  if (typeof raw !== 'object' || !ENTRY_PROMOS.includes(raw.type)) return { promo: null, problems: ['promo type must be none, profit_boost or protected'] };
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (raw.type === 'profit_boost') {
    const pct = num(raw.boost_pct), cap = num(raw.max_boost);
    if (!(pct >= 1 && pct <= 500)) problems.push('the profit boost must be 1% to 500%');
    if (cap != null && !(cap > 0 && cap <= 100000)) problems.push('the boost cap must be a dollar amount above 0');
    return { promo: problems.length ? null : { type: 'profit_boost', boost_pct: round(pct, 2), ...(cap != null ? { max_boost: cents(cap) } : {}) }, problems };
  }
  const c = num(raw.conversion), cap = num(raw.max_bonus);
  if (c != null && !(c >= 0 && c <= 1)) problems.push('the bonus conversion must be 0 to 1 (40% is 0.4)');
  if (cap != null && !(cap > 0 && cap <= 100000)) problems.push('the bonus cap must be a dollar amount above 0');
  return { promo: problems.length ? null : { type: 'protected', conversion: c == null ? DEFAULT_CONVERSION : round(c, 4), conversion_assumed: c == null, ...(cap != null ? { max_bonus: cents(cap) } : {}) }, problems };
}

// What one result is worth per $1 of stake, cash plus converted bonus, with
// the promo. `R`: the gross multiplier the app pays for that result.
export function promoReturn(promo, R, stake) {
  if (!promo || !(R >= 0)) return R;
  if (promo.type === 'profit_boost') {
    if (!(R > 1)) return R;
    let extra = (R - 1) * (promo.boost_pct / 100);
    if (promo.max_boost > 0 && stake > 0) extra = Math.min(extra, promo.max_boost / stake);
    return R + extra;
  }
  if (promo.type === 'protected') {
    if (!(R < 1)) return R;
    let face = 1 - R;
    if (promo.max_bonus > 0 && stake > 0) face = Math.min(face, promo.max_bonus / stake);
    return R + promo.conversion * face;
  }
  return R;
}

// The entry's value with and without the promo from its outcome rows
// ([[chance, gross multiplier], ...], every result once). Also the promo
// size that makes the entry break even (ignoring caps): the boost for
// profit_boost, the bonus conversion for protected.
export function promoValue({ promo, rows, stake }) {
  if (!promo || !Array.isArray(rows) || !rows.length || !(stake > 0)) return null;
  let base = 0, withIt = 0, profit = 0, loss = 0, mass = 0;
  for (const [p, R] of rows) {
    if (!(p >= 0) || !(R >= 0)) continue;
    mass += p;
    base += p * R;
    withIt += p * promoReturn(promo, R, stake);
    if (R > 1) profit += p * (R - 1);
    if (R < 1) loss += p * (1 - R);
  }
  if (!(mass > 0)) return null;
  const out = {
    type: promo.type,
    expected_roi_without: round(base - 1), expected_roi_with: round(withIt - 1), gain: round(withIt - base),
    expected_net_without: cents(stake * (base - 1)), expected_net_with: cents(stake * (withIt - 1)),
  };
  if (promo.type === 'profit_boost') {
    out.boost_pct = promo.boost_pct;
    out.breakeven_boost_pct = base >= 1 ? 0 : profit > 0 ? round(((1 - base) / profit) * 100, 1) : null;
    if (promo.max_boost) out.max_boost = promo.max_boost;
  } else {
    out.conversion = promo.conversion; out.conversion_assumed = promo.conversion_assumed;
    out.expected_net_loss_share = round(loss);
    out.breakeven_conversion = base >= 1 ? 0 : loss > 0 ? round((1 - base) / loss) : null;
    if (promo.max_bonus) out.max_bonus = promo.max_bonus;
  }
  return out;
}

// A promo line's own check: a discount needs the normal line above it, a
// guarantee is a 0.5 line; both are More only. Returns an error or null.
export function promoLineProblem(offer, side, threshold, normalLine) {
  if (offer === 'guarantee') {
    if (side !== 'over') return 'a Guarantee pick is More (over) only';
    if (threshold !== 0.5) return 'a Guarantee pick is the 0.5 line';
    if (normalLine != null && !(normalLine > threshold)) return 'the normal line must be above 0.5';
    return null;
  }
  if (offer === 'discount') {
    if (side !== 'over') return 'a discounted (Taco / Flash Sale) pick is More (over) only';
    if (!(normalLine > threshold)) return 'enter the normal line, above the discounted line';
    if (normalLine > 1000 || Math.round(normalLine * 2) !== normalLine * 2) return 'the normal line must be a whole or half number';
    return null;
  }
  return null;
}

// ---- Tables (built by the model refit) ------------------------------------

// Clearance table for one stat from real lines and what happened:
// `pairs`: [[normal line, actual value], ...] (played games only). Lines are
// split into up to four buckets of similar size with BUCKET_MIN+ each; each
// bucket keeps how many cleared a line at every share of the normal line
// (0, 2.5%, ..., 100%): cleared[i] = share with value > line x ratio.
export function clearanceTable(pairs) {
  const rows = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p[0] > 0 && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (rows.length < TABLE_MIN) return null;
  const nb = Math.max(1, Math.min(4, Math.floor(rows.length / BUCKET_MIN)));
  const cut = (list) => {
    const cleared = new Array(RATIO_POINTS).fill(0);
    for (const [line, x] of list) for (let i = 0; i < RATIO_POINTS; i++) if (x > line * i * RATIO_STEP) cleared[i] += 1;
    return { lo: list[0][0], hi: list[list.length - 1][0], n: list.length, cleared: cleared.map((c) => round(c / list.length)) };
  };
  // Cut points at equal counts, moved forward so one line value stays in one
  // bucket; a bucket left under BUCKET_MIN joins the one before it (the
  // first joins the next), so every line is in exactly one bucket.
  const ranges = [];
  let from = 0;
  for (let b = 1; b <= nb; b++) {
    let to = b === nb ? rows.length : Math.floor((rows.length * b) / nb);
    while (to < rows.length && to > 0 && rows[to][0] === rows[to - 1][0]) to++;
    if (to > from) { ranges.push([from, to]); from = to; }
  }
  for (let i = 0; i < ranges.length && ranges.length > 1;) {
    if (ranges[i][1] - ranges[i][0] >= BUCKET_MIN) { i++; continue; }
    if (i > 0) { ranges[i - 1][1] = ranges[i][1]; ranges.splice(i, 1); }
    else { ranges[1][0] = ranges[0][0]; ranges.splice(0, 1); }
  }
  return { n: rows.length, step: RATIO_STEP, all: cut(rows), buckets: ranges.map(([a, b]) => cut(rows.slice(a, b))) };
}

// Zero table for one stat: `recs`: [[forecast mean, actual value, model's
// chance of 0], ...]. Ten bins of similar size by forecast mean; each keeps
// the measured share with none of the stat and the model curve's.
export function zeroTable(recs) {
  const rows = (Array.isArray(recs) ? recs : []).filter((r) => Array.isArray(r) && r[0] > 0 && Number.isFinite(r[1])).sort((a, b) => a[0] - b[0]);
  if (rows.length < ZERO_MIN) return null;
  const bins = [];
  for (let b = 0; b < ZERO_BINS; b++) {
    const list = rows.slice(Math.floor((rows.length * b) / ZERO_BINS), Math.floor((rows.length * (b + 1)) / ZERO_BINS));
    if (!list.length) continue;
    const zeros = list.filter((r) => r[1] === 0).length;
    const model = list.filter((r) => Number.isFinite(r[2]));
    bins.push({ lo: round(list[0][0], 3), hi: round(list[list.length - 1][0], 3), mean: round(list.reduce((a, r) => a + r[0], 0) / list.length, 3), n: list.length,
      zero: round(zeros / list.length), model_zero: model.length ? round(model.reduce((a, r) => a + r[2], 0) / model.length) : null });
  }
  return { n: rows.length, bins };
}

// The clearance table's bucket for a normal line of this size: the bucket
// it falls in, the end bucket beyond them, else every line.
function bucketFor(c, normalLine) {
  const b = c.buckets || [];
  return b.find((x) => normalLine >= x.lo && normalLine <= x.hi) || (b.length && normalLine < b[0].lo ? b[0] : b.length && normalLine > b[b.length - 1].hi ? b[b.length - 1] : null) || c.all;
}
// How often real lines of this size were cleared at the line itself.
export function normalLineRate({ tables, stat, normalLine }) {
  const c = tables?.[stat]?.clearance;
  if (!c || !(normalLine > 0)) return null;
  const b = bucketFor(c, normalLine);
  return { chance: b.cleared[b.cleared.length - 1], n: b.n, lo: b.lo, hi: b.hi };
}

// How often a pick on a promo line won, measured. `tables`: model.promo_tables.
//   discount:  the clearance rate at this share of the normal line, read in
//              the bucket of similar normal lines (all lines when the bucket
//              is thin), straight line between grid points.
//   guarantee: 1 - the zero rate at this forecast mean (straight line
//              between bin means; the end bins beyond them).
// Returns { chance, n, range, basis, ... } or { chance: null, reason }.
export function promoChance({ tables, stat, offer, threshold, normalLine = null, forecastMean = null }) {
  const t = tables?.[stat];
  if (offer === 'guarantee') {
    const z = t?.zero;
    if (!z?.bins?.length) return { chance: null, reason: 'no zero table for this stat yet' };
    // The forecast mean is the key; without one, the normal line (real lines
    // sit within a fraction of a unit of the average outcome).
    const byLine = !(forecastMean > 0) && normalLine > 0.5;
    if (!(forecastMean > 0) && !byLine) return { chance: null, reason: 'no forecast and no normal line for this player, so the zero rate cannot be matched' };
    if (byLine) forecastMean = normalLine;
    const bins = z.bins;
    let zero, n, model;
    if (forecastMean <= bins[0].mean) ({ zero, n, model_zero: model } = bins[0]);
    else if (forecastMean >= bins[bins.length - 1].mean) ({ zero, n, model_zero: model } = bins[bins.length - 1]);
    else {
      for (let i = 1; i < bins.length; i++) {
        const a = bins[i - 1], b = bins[i];
        if (forecastMean <= b.mean) {
          const w = b.mean > a.mean ? (forecastMean - a.mean) / (b.mean - a.mean) : 0;
          zero = a.zero + w * (b.zero - a.zero); n = a.n + b.n;
          model = a.model_zero != null && b.model_zero != null ? a.model_zero + w * (b.model_zero - a.model_zero) : null;
          break;
        }
      }
    }
    const nearest = bins.reduce((best, b) => (Math.abs(b.mean - forecastMean) < Math.abs(best.mean - forecastMean) ? b : best), bins[0]);
    const normal = normalLine > 0.5 ? normalLineRate({ tables, stat, normalLine }) : null;
    return { chance: round(1 - zero), zero_rate: round(zero), model_zero_rate: model == null ? null : round(model), n,
      ...(normal ? { at_normal_line: round(normal.chance) } : {}),
      range: (() => { const r = wilson(Math.round(nearest.zero * nearest.n), nearest.n); return r ? { low: round(1 - r.high), high: round(1 - r.low) } : null; })(),
      basis: 'players forecast near ' + round(forecastMean, 1) + (byLine ? ' (the normal line; no forecast)' : '') + ' who played: share with at least one' };
  }
  if (offer === 'discount') {
    const c = t?.clearance;
    if (!c) return { chance: null, reason: 'fewer than ' + TABLE_MIN + ' real lines stored for this stat yet' };
    if (!(normalLine > 0) || !(threshold >= 0) || !(threshold < normalLine)) return { chance: null, reason: 'needs the normal line above the discounted line' };
    const bucket = bucketFor(c, normalLine);
    const ratio = threshold / normalLine, pos = ratio / (c.step || RATIO_STEP);
    const i = Math.max(0, Math.min(bucket.cleared.length - 2, Math.floor(pos))), w = Math.max(0, Math.min(1, pos - i));
    const rate = bucket.cleared[i] + w * (bucket.cleared[i + 1] - bucket.cleared[i]);
    const atLine = bucket.cleared[bucket.cleared.length - 1];
    const range = wilson(Math.round(rate * bucket.n), bucket.n);
    return { chance: round(rate), at_normal_line: round(atLine), n: bucket.n, range, discount_pct: round((1 - ratio) * 100, 1),
      basis: 'real lines of ' + bucket.lo + ' to ' + bucket.hi + ' cleared ' + round((1 - ratio) * 100, 1) + '% lower' };
  }
  return { chance: null, reason: 'not a promo line' };
}

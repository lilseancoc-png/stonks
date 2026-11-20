// The parlay check (owner ask 2026-11-20: "the whole point is to find +EV
// lines that are accurate"). Pure. It reads an evaluation the pricer already
// made (lib/sports/journal.mjs evaluateEntry) and answers, per entry:
//   - the chance every pick hits, and what the payout needs;
//   - the expected return, with the promo when there is one;
//   - for each pick: its chance and where it came from, the chance it needs
//     for the entry to break even with the other picks as they are, the gap,
//     and the books' and the model's chance beside it;
//   - how far the chances can be trusted: a de-vigged sportsbook price or a
//     measured promo table is a market or an outcome rate; a model chance on
//     a stat whose real-line check trails a coin flip has no tested edge at
//     real PrizePicks lines (models.mjs realLinesCheck); a history hit rate
//     is a small sample.
// The verdict is "plus_ev" only when the return is positive at the chances
// used, every check in ev_check agrees, and no pick's chance is an untested
// model number. It is a read, never a block (owner decision 2026-11-13).
import { poissonBinomial } from './payout.mjs';
import { promoReturn } from './promo.mjs';

export const PARLAY_CHECK_VERSION = 1;
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const pct = (p) => (Math.round(p * 1000) / 10).toFixed(1) + '%';
const roiText = (r) => (r > 0 ? '+' : r < 0 ? '−' : '') + (Math.abs(r) * 100).toFixed(1) + '%';

// How much a pick's chance can be trusted, from its source and the model's
// own real-line check.
export function chanceTrust(leg) {
  const src = leg.probability_source;
  if (leg.probability == null) return { level: 'none', note: 'no chance entered' };
  if (src === 'book') return { level: 'market', note: 'sportsbooks’ no-vig price' };
  if (src === 'measured') return { level: 'measured', note: 'measured promo-line rate' };
  if (src === 'model') {
    if (leg.kind === 'team') return leg.model?.quality === 'validated' ? { level: 'model', note: 'team model, checked on later games' } : { level: 'model_untested', note: 'team model, not validated' };
    if (leg.model?.real_lines_check?.trailing) return { level: 'model_untested', note: 'model chance; at real PrizePicks lines this stat scores no better than a coin flip (' + leg.model.real_lines_check.n + ' lines)' };
    if (leg.model?.quality !== 'validated') return { level: 'model_untested', note: 'model chance, experimental for this stat or role' };
    return { level: 'model', note: 'model chance, validated on stand-in lines' };
  }
  if (src === 'history') return { level: 'history', note: 'past hit rate, a small sample' };
  return { level: 'owner', note: 'your own chance' };
}

// The chance pick i needs for the entry to break even with the other picks'
// chances as they are, treating the picks as unrelated (pushes left out).
// EV is a straight line in pick i's chance, so this is exact under that
// assumption. Parlays with each pick's odds: 1 / its decimal odds.
function neededChance({ legs, i, format, payouts, prices, promo, stake }) {
  const n = legs.length;
  if (format === 'parlay' && Array.isArray(prices) && prices.length === n && prices[i] > 1) return 1 / prices[i];
  const others = legs.filter((_, j) => j !== i).map((l) => l.probability);
  if (others.some((p) => !(p >= 0 && p <= 1))) return null;
  const dist = poissonBinomial(others);
  const value = (k) => promoReturn(promo, format === 'parlay' ? (k === n ? payouts[n] || 0 : 0) : payouts[k] || 0, stake);
  let win = 0, lose = 0;
  dist.forEach((p, k) => { win += p * value(k + 1); lose += p * value(k); });
  if (!(win > lose)) return null;
  const need = (1 - lose) / (win - lose);
  return need <= 0 ? 0 : need >= 1 ? null : need;
}

// `book`: per pick, the books' no-vig chance or null (the MCP reads it; the
// page has none). `alt`: other evaluations of the same entry, { book, model }
// with every pick at that source's chance, or null when a pick has none.
// `promoLines`: the entry's value with every promo line moved back to its
// normal line, or null.
export function parlayCheck({ evaluation, legs, format, payouts, prices = null, stake, promo = null, book = null, alt = {}, promoLines = null }) {
  const E = evaluation || {};
  const n = Array.isArray(legs) ? legs.length : 0;
  const evc = E.ev_check || {};
  const all = typeof E.joint_probability === 'number' ? E.joint_probability : null;
  const needAll = typeof E.breakeven_probability === 'number' ? E.breakeven_probability : null;
  // All-or-nothing entries (power, parlay): the all-hit chance the entry
  // needs with the promo counted. Flex pays partial results, so none.
  const needAllPromo = promo && needAll > 0 && format !== 'flex' ? round(1 / promoReturn(promo, 1 / needAll, stake)) : null;
  const roi = typeof E.expected_roi === 'number' ? E.expected_roi : null;
  const withPromo = E.promo && typeof E.promo.expected_roi_with === 'number' ? E.promo.expected_roi_with : null;
  const picks = (legs || []).map((l, i) => {
    const trust = chanceTrust(l);
    const need = l.probability != null ? neededChance({ legs, i, format, payouts, prices, promo, stake }) : null;
    const decided = l.push > 0 && l.probability != null ? l.probability / (1 - l.push) : l.probability;
    return {
      pick: i + 1, label: l.kind === 'team' ? l.label : (l.player_name || l.player_id) + ' ' + (l.side === 'under' ? 'under ' : 'over ') + l.threshold + ' ' + l.stat,
      ...(l.offer_type && l.offer_type !== 'standard' ? { offer: l.offer_type, normal_line: l.normal_line ?? null } : {}),
      chance: l.probability ?? null, chance_source: l.probability_source || null,
      needs: round(need), gap_pts: need != null && l.probability != null ? round((l.probability - need) * 100, 1) : null,
      book: book?.[i] ?? null, model: l.model?.status === 'ok' ? round(l.model.probability) : null,
      measured: l.promo_line?.chance ?? null,
      model_minus_book_pts: book?.[i] != null && l.model?.status === 'ok' ? round((l.model.probability - book[i]) * 100, 1) : null,
      push: l.push > 0 ? round(l.push) : 0, chance_if_decided: round(decided),
      trust: trust.level, trust_note: trust.note,
    };
  });
  const untested = picks.filter((p) => p.trust === 'model_untested').map((p) => p.pick);
  const weak = picks.filter((p) => p.gap_pts != null && p.gap_pts < 0).map((p) => p.pick);
  const levels = new Set(picks.map((p) => p.trust));
  const trust = !n || levels.has('none') ? 'incomplete' : [...levels].every((x) => x === 'market' || x === 'measured') ? 'market'
    : untested.length ? 'untested_model' : [...levels].every((x) => x === 'market' || x === 'measured' || x === 'model') ? 'model' : 'owner_or_history';
  const at = (ev) => (ev && typeof ev.expected_roi === 'number' ? { expected_roi: ev.expected_roi, chance_all_hit: ev.joint_probability ?? null, ...(ev.promo ? { expected_roi_with_promo: ev.promo.expected_roi_with } : {}) } : null);
  const atBook = at(alt.book), atModel = at(alt.model);
  const headline = withPromo != null ? withPromo : roi;
  let verdict = 'unknown';
  if (headline != null) {
    if (headline < 0) verdict = 'negative_ev';
    else if (evc.verdict === 'unsure' && withPromo == null) verdict = 'unsure';
    else if (Math.abs(headline) < 0.0005) verdict = 'unsure';
    else if (trust === 'market') verdict = 'plus_ev';
    else if (trust === 'untested_model') verdict = 'plus_ev_untested';
    else verdict = 'plus_ev_unconfirmed';
    // The books disagree: at their prices the same entry loses.
    if ((verdict === 'plus_ev_untested' || verdict === 'plus_ev_unconfirmed') && atBook && (atBook.expected_roi_with_promo ?? atBook.expected_roi) < 0) verdict = 'plus_ev_books_disagree';
  } else if (evc.verdict === 'negative_ev') verdict = 'negative_ev';
  const words = {
    plus_ev: 'Positive expected value at market or measured chances.',
    plus_ev_untested: 'Positive only on model chances that have no tested edge at real PrizePicks lines; treat it as unproven.',
    plus_ev_unconfirmed: 'Positive at the chances used, but some come from your own estimate or a short hit history, not a market price.',
    plus_ev_books_disagree: 'Positive at the chances used, but the same entry loses at the sportsbooks’ prices.',
    negative_ev: 'Negative expected value at the chances used.',
    unsure: 'About break-even, or not a clear edge across the checks.',
    unknown: 'Not enough to price it yet (a payout, a chance or a same-game link is missing).',
  };
  const parts = [words[verdict]];
  if (all != null) parts.push((n === 1 ? 'It hits ' : n === 2 ? 'Both hit ' : 'All ' + n + ' hit ') + pct(all) + (needAll != null ? ' against ' + pct(needAll) + ' needed' + (needAllPromo != null && needAllPromo !== needAll ? ' (' + pct(needAllPromo) + ' with the promo)' : '') : '') + '.');
  if (roi != null) parts.push('Expected return ' + roiText(roi) + (withPromo != null ? ', ' + roiText(withPromo) + ' with the promo' : '') + '.');
  if (atBook) parts.push('At the books’ prices: ' + roiText(atBook.expected_roi_with_promo ?? atBook.expected_roi) + '.');
  if (weak.length) parts.push('Short of what it needs: pick' + (weak.length > 1 ? 's ' : ' ') + weak.join(', ') + '.');
  return {
    version: PARLAY_CHECK_VERSION, verdict, summary: parts.join(' '),
    chance_all_hit: all, needed_all_hit: needAll, ...(needAllPromo != null ? { needed_all_hit_with_promo: needAllPromo } : {}), chance_if_unrelated: E.independent_probability ?? null,
    expected_roi: roi, expected_roi_with_promo: withPromo,
    ...(E.promo ? { promo: E.promo } : {}),
    ...(promoLines ? { at_normal_lines: promoLines } : {}),
    at_book_chances: atBook, at_model_chances: atModel,
    trust, untested_model_picks: untested, short_picks: weak,
    picks,
    needs_basis: 'each pick’s needed chance holds the other picks’ chances fixed and treats them as unrelated' + (promo ? ', with the promo counted' : ''),
  };
}

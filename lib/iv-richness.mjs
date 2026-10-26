// One rule for "are this stock's options expensive?" (site audit C2, 2026-10-26).
// The grade's IV cost, the Top Picks structure, the Strategy builder and the
// Trending IV "elevated" flag all read this band, so one stock gets one answer.
//
// Inputs are the stock's own numbers: the percentile of today's ~30-day ATM IV
// inside its stored IV history (ivRank.pctile, midrank), today's IV and the
// 30-day realized volatility (technicals.volRegime.rv30), both as decimals.
//   cheap     — percentile <= 20
//   rich      — percentile >= 80 AND IV above 30-day realized vol
//   very-rich — percentile >= 90 AND IV above 30-day realized vol
//   normal    — everything else, including a high percentile while IV is at or
//               below realized vol (the options are keeping up with the moves,
//               not charging extra for them)
// When realized vol is missing the percentile decides alone, which errs toward
// "expensive" (no naked long, no extra grade credit). earningsSoon is a tag only:
// it never changes the band.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function ivRichnessFactory() {
  var CHEAP = 20, RICH = 80, VERY_RICH = 90, EARNINGS_DAYS = 14;
  var LABELS = { unknown: 'Unknown', cheap: 'Cheap', normal: 'Normal', rich: 'Rich', 'very-rich': 'Very rich' };
  function num(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function classify(input) {
    var o = input || {};
    var pctile = num(o.pctile), iv = num(o.iv), rv30 = num(o.rv30), days = num(o.earningsDays);
    var ivOverRv = iv != null && rv30 != null && iv > 0 && rv30 > 0 ? iv > rv30 : null;
    var band;
    if (pctile == null) band = 'unknown';
    else if (pctile <= CHEAP) band = 'cheap';
    else if (pctile >= RICH && ivOverRv !== false) band = pctile >= VERY_RICH ? 'very-rich' : 'rich';
    else band = 'normal';
    var earningsSoon = days != null && days >= 0 && days <= EARNINGS_DAYS;
    var note;
    if (band === 'unknown') note = 'Not enough IV history to rank today’s premium.';
    else if (band === 'cheap') note = 'IV sits in the bottom fifth of its own history.';
    else if (band === 'normal' && pctile >= RICH) note = 'IV is high for this stock but not above its 30-day realized moves.';
    else if (band === 'normal') note = 'IV is mid-range for this stock.';
    else note = 'IV is in the top ' + (band === 'very-rich' ? 'tenth' : 'fifth') + ' of its own history'
      + (ivOverRv === true ? ' and above its 30-day realized moves.' : '; realized volatility is unavailable, so the percentile decides alone.');
    return {
      band: band,
      label: LABELS[band],
      rich: band === 'rich' || band === 'very-rich',
      veryRich: band === 'very-rich',
      cheap: band === 'cheap',
      pctile: pctile,
      iv: iv,
      rv30: rv30,
      ivOverRv: ivOverRv,
      basis: ivOverRv == null ? 'percentile-only' : 'percentile+realized',
      earningsSoon: earningsSoon,
      earningsDays: days,
      note: note
    };
  }
  return {
    CHEAP: CHEAP, RICH: RICH, VERY_RICH: VERY_RICH, EARNINGS_DAYS: EARNINGS_DAYS,
    LABELS: LABELS,
    classify: classify
  };
}

export const IV_RICHNESS = ivRichnessFactory();
export const IV_RICHNESS_VERSION = '2026-10-iv-rule';

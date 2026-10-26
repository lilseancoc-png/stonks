// Top Picks buyout guard. A signed takeover pins the target's stock to the
// deal terms, so a 1-2 week directional option on it is a bet on the deal
// breaking or a topping bid, which the 4-pillar grade does not measure.
// Confirmed targets are kept off the open-pick path; rumored targets are
// listed for context only and never block. No network or model calls: the
// input is the already-baked pending-buyouts.json payload.

// A deal row whose quoted target price is this far from our own spot most
// likely names a different listing with the same ticker. It is shown, not
// used to block.
export const BUYOUT_PRICE_MATCH_PCT = 15;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function buyoutContextFor(payload, symbol, spot) {
  const deals = Array.isArray(payload?.deals) ? payload.deals : [];
  const sym = String(symbol || '').toUpperCase();
  const deal = deals.find((d) => d && d.status === 'pending' && String(d.targetTicker || '').toUpperCase() === sym)
    || deals.find((d) => d && d.status === 'rumored' && String(d.targetTicker || '').toUpperCase() === sym);
  if (!deal) return null;
  const quoted = num(deal.targetPrice);
  const px = num(spot);
  const gapPct = quoted > 0 && px > 0 ? Math.round(Math.abs(px / quoted - 1) * 1000) / 10 : null;
  const priceMatches = gapPct == null || gapPct <= BUYOUT_PRICE_MATCH_PCT;
  const confirmed = deal.status === 'pending';
  return {
    symbol: sym,
    status: confirmed ? 'pending' : 'rumored',
    stage: deal.stage || null,
    dealType: deal.dealType || null,
    acquirer: deal.acquirer || null,
    considerationPerShare: num(deal.considerationPerShare),
    grossSpreadPct: num(deal.grossSpreadPct),
    expectedCloseAt: deal.expectedCloseAt || null,
    sourceUrl: deal.sourceUrl || null,
    stale: deal.stale === true,
    priceGapPct: gapPct,
    // Only a confirmed deal whose quoted price matches our listing blocks.
    block: confirmed && priceMatches,
  };
}

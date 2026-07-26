// Premarket leadership follow-through.
//
// The 09:00 ET heatmap refresh freezes the largest positive and negative
// premarket gaps from the curated equity universe. Later refreshes update those
// SAME names against the prior close. The cohort never re-ranks after the bell:
// that is the point of the signal. It answers whether traders kept paying for
// the morning's leaders and whether they bought the morning's broken names.

export const PREMARKET_MOVER_LIMIT = 5;

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const finite = (n) => Number.isFinite(Number(n));
const positive = (n) => finite(n) && Number(n) > 0;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function phaseForMarketState(marketState) {
  const state = String(marketState || "").toUpperCase();
  if (state.startsWith("PRE")) return "premarket";
  if (state.startsWith("REGULAR")) return "regular";
  if (state.startsWith("POST")) return "postmarket";
  if (state.startsWith("CLOSED")) return "closed";
  return "unknown";
}

function quotePremarketMove(q) {
  const prePrice = Number(q?.preMarketPrice);
  const prevClose = Number(q?.regularMarketPreviousClose);
  if (!(prePrice > 0) || !(prevClose > 0)) return null;
  return {
    prePrice: round2(prePrice),
    prevClose: round2(prevClose),
    prePct: round2(((prePrice - prevClose) / prevClose) * 100),
  };
}

function quoteCurrentPrice(q, marketState) {
  const phase = phaseForMarketState(q?.marketState || marketState);
  if (phase === "premarket" && positive(q?.preMarketPrice)) return Number(q.preMarketPrice);
  if (phase === "postmarket" && positive(q?.postMarketPrice)) return Number(q.postMarketPrice);
  if (positive(q?.regularMarketPrice)) return Number(q.regularMarketPrice);
  if (positive(q?.postMarketPrice)) return Number(q.postMarketPrice);
  if (positive(q?.preMarketPrice)) return Number(q.preMarketPrice);
  return null;
}

function gainerStatus(prePct, currentPct) {
  if (!finite(currentPct)) return "unpriced";
  if (currentPct <= 0) return "reversed";
  const soarBar = prePct + Math.max(0.5, Math.abs(prePct) * 0.2);
  if (currentPct >= soarBar) return "soared";
  if (currentPct >= prePct * 0.65) return "held";
  return "faded";
}

function declinerStatus(prePct, currentPct) {
  if (!finite(currentPct)) return "unpriced";
  const recovery = (currentPct - prePct) / Math.abs(prePct || 1);
  if (currentPct >= -0.5 || recovery >= 0.5) return "recovered";
  const worseBar = prePct - Math.max(0.5, Math.abs(prePct) * 0.15);
  if (currentPct <= worseBar) return "worsened";
  return "still-down";
}

function updateRows(rows, quotes, marketState, side) {
  return (rows || []).map((row) => {
    const q = quotes?.[row.t];
    const currentPrice = quoteCurrentPrice(q, marketState);
    const currentPct = currentPrice != null && positive(row.prevClose)
      ? round2(((currentPrice - Number(row.prevClose)) / Number(row.prevClose)) * 100)
      : finite(row.currentPct) ? Number(row.currentPct) : null;
    return {
      ...row,
      currentPrice: currentPrice != null ? round2(currentPrice) : row.currentPrice ?? null,
      currentPct,
      deltaFromPremarketPct: finite(currentPct)
        ? round2(Number(currentPct) - Number(row.prePct))
        : null,
      status: side === "gainers"
        ? gainerStatus(Number(row.prePct), currentPct)
        : declinerStatus(Number(row.prePct), currentPct),
      quoteState: q?.marketState || row.quoteState || marketState || null,
      stale: !q || currentPrice == null,
    };
  });
}

function average(values) {
  const good = values.filter(finite).map(Number);
  return good.length ? good.reduce((sum, n) => sum + n, 0) / good.length : null;
}

export function summarizePremarketMovers(gainers, decliners, marketState) {
  const phase = phaseForMarketState(marketState);
  if (phase === "premarket") {
    return {
      state: "premarket-baseline",
      tone: "pending",
      label: "Premarket baseline",
      headline: "Leaders and laggards are frozen; follow-through starts at the bell.",
      action: "Do not infer risk-on or dip-buying yet. Watch these same names after the open.",
      leaderAxis: "pending",
      laggardAxis: "pending",
      score: null,
    };
  }

  const pricedGainers = (gainers || []).filter((r) => !r.stale && finite(r.currentPct) && Number(r.prePct) > 0);
  const pricedDecliners = (decliners || []).filter((r) => !r.stale && finite(r.currentPct) && Number(r.prePct) < 0);
  if (pricedGainers.length < 2 || pricedDecliners.length < 2) {
    return {
      state: "insufficient",
      tone: "stale",
      label: "Waiting for cross-check",
      headline: "The frozen premarket baskets do not have enough current prices.",
      action: "Treat the read as unavailable until both sides of the tape can be marked.",
      leaderAxis: "unavailable",
      laggardAxis: "unavailable",
      score: null,
    };
  }

  const retention = pricedGainers.map((r) =>
    clamp(Number(r.currentPct) / Number(r.prePct), -1, 2.5));
  const recovery = pricedDecliners.map((r) =>
    clamp((Number(r.currentPct) - Number(r.prePct)) / Math.abs(Number(r.prePct)), -1, 2));
  const gainerHolding = pricedGainers.filter((r) => r.status === "held" || r.status === "soared").length;
  const gainerFailing = pricedGainers.filter((r) => r.status === "faded" || r.status === "reversed").length;
  const declinerRecovering = pricedDecliners.filter((r) => r.status === "recovered").length;
  const declinerPressured = pricedDecliners.filter((r) => r.status === "still-down" || r.status === "worsened").length;
  const avgRetention = average(retention);
  const avgRecovery = average(recovery);
  const leaderAxis =
    gainerHolding / pricedGainers.length >= 0.6 && avgRetention >= 0.65 ? "holding" :
    gainerFailing / pricedGainers.length >= 0.6 || avgRetention < 0.35 ? "failing" :
    "mixed";
  const laggardAxis =
    declinerRecovering / pricedDecliners.length >= 0.6 && avgRecovery >= 0.5 ? "recovering" :
    declinerPressured / pricedDecliners.length >= 0.6 && avgRecovery < 0.25 ? "pressured" :
    "mixed";

  let state = "mixed";
  let tone = "mixed";
  let label = "Mixed / unconfirmed";
  let headline = "Premarket leaders and laggards are not confirming one market posture.";
  let action = "Stay selective and wait for either leadership or dip-buying to broaden.";
  if (leaderAxis === "holding" && laggardAxis === "recovering") {
    state = "risk-on-dip-buying";
    tone = "risk-on";
    label = "Risk-on + dip buying";
    headline = "Premarket leaders are holding while the weakest names recover.";
    action = "The tape is rewarding upside and absorbing damage; favor long setups that hold support.";
  } else if (leaderAxis === "holding" && laggardAxis === "pressured") {
    state = "selective-risk-on";
    tone = "selective";
    label = "Selective risk-on";
    headline = "Leaders still work, but the market is not rescuing the weakest names.";
    action = "Stay with proven leadership; avoid calling the whole market bullish.";
  } else if (leaderAxis === "failing" && laggardAxis === "recovering") {
    state = "dip-buying-rotation";
    tone = "dip-buying";
    label = "Dip-buying rotation";
    headline = "Weak names are recovering, but premarket leadership is fading.";
    action = "This is rotation or short covering, not broad bullish confirmation; do not chase the open's winners.";
  } else if (leaderAxis === "failing" && laggardAxis === "pressured") {
    state = "risk-off";
    tone = "risk-off";
    label = "Risk-off";
    headline = "Premarket leaders are failing while the weakest names keep deteriorating.";
    action = "Reduce long-beta assumptions and demand a basket reversal before buying dips.";
  }

  const axisScore = (axis, good, bad) => axis === good ? 1 : axis === bad ? -1 : 0;
  return {
    state,
    tone,
    label,
    headline,
    action,
    leaderAxis,
    laggardAxis,
    score: axisScore(leaderAxis, "holding", "failing") +
      axisScore(laggardAxis, "recovering", "pressured"),
    gainerHolding,
    gainerCount: pricedGainers.length,
    declinerRecovering,
    declinerCount: pricedDecliners.length,
    avgGainerRetentionPct: round2(avgRetention * 100),
    avgDeclinerRecoveryPct: round2(avgRecovery * 100),
  };
}

function captureRows(quotes, tickerRows, side, limit) {
  const rowBySymbol = new Map((tickerRows || []).map((row) => [row.t, row]));
  const candidates = [];
  for (const [symbol, q] of Object.entries(quotes || {})) {
    const meta = rowBySymbol.get(symbol);
    if (!meta) continue;
    const move = quotePremarketMove(q);
    if (!move) continue;
    if (side === "gainers" ? move.prePct <= 0 : move.prePct >= 0) continue;
    candidates.push({
      t: symbol,
      n: meta.n || symbol,
      s: meta.s || null,
      ...move,
      currentPrice: move.prePrice,
      currentPct: move.prePct,
      deltaFromPremarketPct: 0,
      status: side === "gainers" ? "held" : "still-down",
      quoteState: q?.marketState || null,
      stale: false,
    });
  }
  candidates.sort((a, b) => side === "gainers"
    ? b.prePct - a.prePct
    : a.prePct - b.prePct);
  return candidates.slice(0, limit);
}

export function updatePremarketMovers({
  prior = null,
  quotes = {},
  tickerRows = [],
  date,
  capturedAtIso,
  marketState,
  limit = PREMARKET_MOVER_LIMIT,
} = {}) {
  const phase = phaseForMarketState(marketState);
  let tracker = prior && prior.date === date ? prior : null;

  if (!tracker) {
    if (phase !== "premarket") return null;
    const gainers = captureRows(quotes, tickerRows, "gainers", limit);
    const decliners = captureRows(quotes, tickerRows, "decliners", limit);
    // One-sided or very thin premarket quote coverage is not a valid
    // cross-market sentiment baseline. Wait for the next premarket run.
    if (gainers.length < 2 || decliners.length < 2) return null;
    tracker = {
      date,
      capturedAtIso,
      universeCount: tickerRows.length,
      limit,
      gainers,
      decliners,
    };
  }

  const gainers = updateRows(tracker.gainers, quotes, marketState, "gainers");
  const decliners = updateRows(tracker.decliners, quotes, marketState, "decliners");
  return {
    ...tracker,
    updatedAtIso: capturedAtIso,
    marketState: marketState || null,
    phase,
    gainers,
    decliners,
    summary: summarizePremarketMovers(gainers, decliners, marketState),
  };
}

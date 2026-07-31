// Deterministic unusual-flow explanation. The scanner already owns every
// fact needed to explain why a contract flagged; an LLM cannot add a causal
// claim without inventing evidence. Keeping this pure makes every note match
// the current scan exactly and removes an hourly per-contract AI cost.

const finite = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const whole = (value) => {
  const n = finite(value);
  return n == null ? "unknown" : Math.round(n).toLocaleString("en-US");
};

function premiumLabel(value) {
  const n = finite(value);
  if (n == null || n < 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

function tapeRead(tape) {
  const value = String(tape || "").toLowerCase();
  if (value === "ask") return "The last print was at the ask, consistent with buyers lifting offers.";
  if (value === "abv") return "The last print was above the midpoint, leaning toward buyer-initiated flow.";
  if (value === "bid") return "The last print was at the bid, consistent with sellers hitting bids.";
  if (value === "blw") return "The last print was below the midpoint, leaning toward seller-initiated flow.";
  return "The print was near the midpoint, so the tape does not identify an urgent side.";
}

export function buildFlowExplanation(contract, spot = null) {
  const c = contract || {};
  const symbol = String(c.symbol || "This ticker").toUpperCase();
  const side = String(c.side || "option").toLowerCase();
  const vol = finite(c.vol);
  const oi = finite(c.oi);
  const deltaVol = finite(c.deltaVol);
  const ratio = vol != null && oi != null && oi > 0 ? vol / oi : null;

  let openingRead;
  if (vol != null && oi != null && vol > oi) {
    openingRead = `${symbol} ${side} volume is ${whole(vol)} versus ${whole(oi)} contracts of prior open interest` +
      `${ratio != null ? ` (${ratio.toFixed(ratio >= 10 ? 0 : 1)}x)` : ""}, so at least some of today's activity must be opening rather than every print closing an old position.`;
  } else if (vol != null && oi != null) {
    openingRead = `${symbol} ${side} volume is ${whole(vol)} versus ${whole(oi)} contracts of prior open interest, so the totals alone cannot separate new positioning from closing trades.`;
  } else {
    openingRead = `${symbol} ${side} activity flagged on the hourly scan, but volume-versus-open-interest context is incomplete.`;
  }
  if (deltaVol != null) {
    openingRead += ` ${whole(Math.abs(deltaVol))} contracts were added in the latest scan window${deltaVol < 0 ? " on a negative revision" : ""}.`;
  }

  const dte = finite(c.dte);
  const horizon = dte == null
    ? "unknown-dated"
    : dte <= 7
      ? "tactical, near-expiry"
      : dte <= 30
        ? "short-term"
        : "longer-dated";
  const strike = finite(c.strike);
  const liveSpot = finite(spot);
  const rawOtm = finite(c.otmPct);
  const computedOtm = liveSpot > 0 && strike != null
    ? (side === "put" ? (liveSpot - strike) / liveSpot : (strike - liveSpot) / liveSpot)
    : null;
  const otm = rawOtm ?? computedOtm;
  const iv = finite(c.iv);
  const premium = premiumLabel(c.premium);
  const context = [
    `${dte == null ? "The contract" : `${Math.round(dte)} DTE`} is ${horizon}`,
    otm != null ? `${Math.abs(otm * 100).toFixed(1)}% out of the money` : null,
    iv != null && iv > 0 ? `${(iv * 100).toFixed(0)}% implied volatility` : null,
    premium ? `roughly ${premium} of traded premium` : null,
  ].filter(Boolean).join(", ");

  return `${openingRead} ${tapeRead(c.tape)} ${context}. Flow shows positioning and urgency, not the trader's motive or a confirmed stock direction.`;
}

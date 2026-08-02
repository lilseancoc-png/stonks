// Black-Scholes Greeks for European options.
//
// Mirror of the math inlined in app.js (line ~92). Duplicated rather than
// imported because app.js is a generated single-IIFE artifact and not an
// ES module — the cost of keeping the math in sync is far lower than the
// cost of rewiring the build pipeline. If you change one, change the other.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function npdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

// Abramowitz & Stegun 26.2.17 — same approximation app.js uses.
// Exported so build.mjs can compute a risk-neutral probability-of-profit
// (P(S_T past breakeven) = N(±d2)) for the Top Picks elite gauntlet without
// re-implementing the CDF. The browser keeps its own inlined copy (app.js is a
// generated IIFE that can't import) — "duplicate the math on purpose".
export function ncdf(x) {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * a);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const p = 1 - npdf(a) * poly;
  return x < 0 ? 1 - p : p;
}

// type: "call" | "put"
// S: spot, K: strike, T: years to expiry, sigma: IV (decimal), r: risk-free rate
// Returns null when inputs are degenerate so callers can render an "—".
export function greeks(type, S, K, T, sigma, r = 0.045) {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const delta = type === "call" ? ncdf(d1) : ncdf(d1) - 1;
  const thetaYr =
    type === "call"
      ? -S * npdf(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * ncdf(d2)
      : -S * npdf(d1) * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * ncdf(-d2);
  const gamma = npdf(d1) / (S * sigma * sqrtT);
  const vega = (S * npdf(d1) * sqrtT) / 100;
  return {
    delta,
    thetaDay: thetaYr / 365,
    gamma,
    vega,
  };
}

// Convenience: Black-Scholes theoretical price. Used as a fallback when the
// chain lookup has no bid/ask (deep OTM / illiquid strikes).
export function bsPrice(type, S, K, T, sigma, r = 0.045) {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === "call") {
    return S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  }
  return K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

// Yahoo expiration epochs encode a calendar date at midnight UTC. Convert that
// date to 16:00 America/New_York rather than adding a fixed UTC offset: the
// closing instant is 20:00Z under daylight time and 21:00Z under standard time.
// This is deliberately shared by build/scanner/server code so expiry-day state,
// DTE and Black-Scholes T cannot disagree around DST.
const NY_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const expiryCloseCache = new Map();

function nyParts(epochMs) {
  const parts = {};
  for (const part of NY_DATE_TIME.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

export function expiryCloseEpochSec(expirySec) {
  const raw = Number(expirySec);
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  const date = new Date(raw * 1000);
  if (!Number.isFinite(date.getTime())) return NaN;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const cacheKey = `${y}-${m + 1}-${d}`;
  if (expiryCloseCache.has(cacheKey)) return expiryCloseCache.get(cacheKey);

  // Iteratively move a UTC guess until its New York wall-clock parts equal the
  // requested local timestamp. Two iterations cover either UTC offset; a third
  // makes the conversion robust even on a transition date.
  const targetWallMs = Date.UTC(y, m, d, 16, 0, 0);
  let epochMs = targetWallMs;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(epochMs);
    const representedWallMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const adjustment = targetWallMs - representedWallMs;
    epochMs += adjustment;
    if (adjustment === 0) break;
  }
  const result = epochMs / 1000;
  expiryCloseCache.set(cacheKey, result);
  return result;
}

export function secondsToExpiry(expirySec, nowSec = Date.now() / 1000) {
  const closeSec = expiryCloseEpochSec(expirySec);
  if (!Number.isFinite(closeSec)) return 0;
  return Math.max(0, closeSec - Number(nowSec));
}

// Years from now to an expiration's New York closing instant. Floors at a tiny
// positive value so theta/greeks don't divide by zero after expiry.
export function yearsToExpiry(expirySec, nowSec = Date.now() / 1000) {
  const seconds = secondsToExpiry(expirySec, nowSec);
  return Math.max(seconds / (365.25 * 24 * 3600), 1 / (365.25 * 24 * 60));
}

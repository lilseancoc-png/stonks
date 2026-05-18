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
function ncdf(x) {
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

// Years from now to an epoch-seconds expiration. Floors at a tiny positive
// value so theta/greeks don't divide by zero on expiry day.
export function yearsToExpiry(expirySec) {
  const nowSec = Date.now() / 1000;
  const seconds = Math.max(0, expirySec - nowSec);
  return Math.max(seconds / (365.25 * 24 * 3600), 1 / (365.25 * 24 * 60));
}

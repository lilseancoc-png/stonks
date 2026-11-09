// Regime Lab: the options model for replays without real chains (C8, G6).
//
// Black-Scholes on an implied-volatility proxy: realized volatility (half
// 20-day, half 60-day) times the name's IV/RV ratio (1.15 when unknown; the
// May-Nov 2026 median across the universe). Round-trip costs in points of
// entry premium: 3.5 for a single, 12 for a debit spread, 7 for a straddle,
// 0.1% of notional for stock (the 2026-10-20 reality check). Stress mode
// doubles the costs and crushes IV 20% after any event in the hold (F22).
// Shares lib/greeks.mjs with the live engine.

import { bsPrice, greeks, ncdf } from "../greeks.mjs";

export const OPTION_MODEL_VERSION = "2026-11-09-bs-v1";
export const COSTS = Object.freeze({ long: 3.5, debit_vertical: 12, straddle: 7, stock: 0.1 });
export const MODEL_DEFAULTS = Object.freeze({ dte: 60, delta: 0.40, shortDelta: 0.20, minDteExit: 14, rfr: 0.04, ivRvRatio: 1.15, crushPct: 20, eventIvBump: 0.25, ivFloor: 0.12, ivCap: 2.0 });
export const STRUCTURES = Object.freeze(["long", "debit_vertical", "straddle", "stock"]);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function realizedVol(closes, n, end = closes.length - 1) {
  if (end < n) return null;
  const r = [];
  for (let i = end - n + 1; i <= end; i++) {
    if (!(closes[i] > 0) || !(closes[i - 1] > 0)) return null;
    r.push(Math.log(closes[i] / closes[i - 1]));
  }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt((r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1)) * 252);
}

// IV proxy at index `end` of a close series.
export function ivProxy(closes, end = closes.length - 1, ratio = MODEL_DEFAULTS.ivRvRatio) {
  const a = realizedVol(closes, 20, end), b = realizedVol(closes, 60, end);
  const blend = a != null && b != null ? 0.5 * a + 0.5 * b : a ?? b;
  if (blend == null) return null;
  return clamp((num(ratio) ?? MODEL_DEFAULTS.ivRvRatio) * blend, MODEL_DEFAULTS.ivFloor, MODEL_DEFAULTS.ivCap);
}

// Acklam's inverse normal.
export function invNorm(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function strikeIncrement(spot) {
  return spot >= 500 ? 5 : spot >= 100 ? 2.5 : spot >= 25 ? 1 : 0.5;
}

// The strike whose Black-Scholes delta is `delta` (absolute) on `side`.
export function strikeForDelta({ side, spot, iv, T, delta = MODEL_DEFAULTS.delta, rfr = MODEL_DEFAULTS.rfr }) {
  const d = clamp(num(delta) ?? 0.4, 0.05, 0.95);
  const d1 = side === "call" ? invNorm(d) : -invNorm(d);
  const k = spot * Math.exp(-d1 * iv * Math.sqrt(T) + (rfr + (iv * iv) / 2) * T);
  const inc = strikeIncrement(spot);
  return Math.max(inc, Math.round(k / inc) * inc);
}

function legPrice(type, S, K, T, iv, rfr) {
  if (T <= 0) return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  return bsPrice(type, S, K, T, iv, rfr);
}

// Open a modeled position at `spot` with the proxy IV. `dte` is calendar
// days; the mark converts sessions held to calendar time (365/252).
export function openPosition({ structure = "long", side = "call", spot, iv, dte = MODEL_DEFAULTS.dte, delta = MODEL_DEFAULTS.delta, shortDelta = MODEL_DEFAULTS.shortDelta, rfr = MODEL_DEFAULTS.rfr } = {}) {
  const S = num(spot), sig = num(iv);
  if (!(S > 0) || !(sig > 0)) return null;
  const T = dte / 365;
  const dir = side === "put" ? -1 : 1;
  if (structure === "stock") return { structure, side, dir, spot0: S, entryPremium: S, legs: [], dte, T0: T, iv0: sig, leverage: 1 };
  if (structure === "straddle") {
    const inc = strikeIncrement(S), K = Math.round(S / inc) * inc;
    const c = legPrice("call", S, K, T, sig, rfr), p = legPrice("put", S, K, T, sig, rfr);
    if (!(c + p > 0)) return null;
    return { structure, side: "both", dir: 0, spot0: S, entryPremium: c + p, legs: [{ type: "call", strike: K, qty: 1 }, { type: "put", strike: K, qty: 1 }], dte, T0: T, iv0: sig, leverage: null };
  }
  const K = strikeForDelta({ side, spot: S, iv: sig, T, delta, rfr });
  const longPx = legPrice(side, S, K, T, sig, rfr);
  if (!(longPx > 0.01)) return null;
  const g = greeks(side, S, K, T, sig, rfr);
  const leverage = g && Number.isFinite(g.delta) ? Math.abs(g.delta) * S / longPx : null;
  if (structure === "debit_vertical") {
    const K2 = strikeForDelta({ side, spot: S, iv: sig, T, delta: shortDelta, rfr });
    if ((side === "call" && K2 <= K) || (side === "put" && K2 >= K)) return null;
    const shortPx = legPrice(side, S, K2, T, sig, rfr);
    const debit = longPx - shortPx;
    if (!(debit > 0.01)) return null;
    return { structure, side, dir, spot0: S, entryPremium: debit, legs: [{ type: side, strike: K, qty: 1 }, { type: side, strike: K2, qty: -1 }], width: Math.abs(K2 - K), dte, T0: T, iv0: sig, leverage: leverage != null ? leverage * (longPx / debit) * 0.6 : null };
  }
  return { structure: "long", side, dir, spot0: S, entryPremium: longPx, legs: [{ type: side, strike: K, qty: 1 }], dte, T0: T, iv0: sig, leverage, delta: g ? Math.abs(g.delta) : null };
}

// Mark a position after `sessionsHeld` sessions at `spot` with IV `iv`.
// Returns the gross P&L in percent of entry premium (stock: of notional).
export function markPosition(pos, { spot, iv = null, sessionsHeld = 0, rfr = MODEL_DEFAULTS.rfr } = {}) {
  const S = num(spot);
  if (!pos || !(S > 0)) return null;
  if (pos.structure === "stock") return pos.dir * (S / pos.spot0 - 1) * 100;
  const sig = num(iv) ?? pos.iv0;
  const T = Math.max(0, (pos.dte - sessionsHeld * (365 / 252)) / 365);
  let value = 0;
  for (const leg of pos.legs) value += leg.qty * legPrice(leg.type, S, leg.strike, T, sig, rfr);
  if (pos.structure === "debit_vertical") value = clamp(value, 0, pos.width);
  return (value / pos.entryPremium - 1) * 100;
}

// Net of round-trip costs; stress doubles them (F22 / G6).
export function netOfCosts(grossPct, structure = "long", { stress = false } = {}) {
  const g = num(grossPct);
  if (g == null) return null;
  const cost = (COSTS[structure] ?? COSTS.long) * (stress ? 2 : 1);
  return Math.round((g - cost) * 10) / 10;
}

// Implied volatility around an event: elevated going in, crushed after.
export function eventIv(iv, { phase = "before", bump = MODEL_DEFAULTS.eventIvBump, crushPct = MODEL_DEFAULTS.crushPct } = {}) {
  const sig = num(iv);
  if (sig == null) return null;
  if (phase === "before") return clamp(sig * (1 + bump), MODEL_DEFAULTS.ivFloor, MODEL_DEFAULTS.ivCap);
  if (phase === "after") return clamp(sig * (1 - crushPct / 100), MODEL_DEFAULTS.ivFloor, MODEL_DEFAULTS.ivCap);
  return sig;
}

export { bsPrice, greeks, ncdf };

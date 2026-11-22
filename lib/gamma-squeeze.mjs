// Gamma squeeze rule 1, "a near-the-money call strike stands out" (pure, no
// I/O; used by scripts/scan-oi.mjs, tested by scripts/gamma-squeeze-smoke.mjs).
//
// Until 2026-11-17 a near-the-money strike was "concentrated" when its open
// interest was 1.5x the average of every call strike in the scan band (about
// +/-60% of spot, two expirations). The far strikes hold little open interest
// and drag that average down, so the rule fired for almost every stock. It
// now compares each strike with its neighbors in the same expiration (Owner
// choice 2026-11-17): the strike needs 1.5x the average of up to
// NEIGHBOR_STRIKES strikes on each side, and at least BIG_OI contracts.

export const NEAR_THE_MONEY_OTM_MAX = 0.10;
export const CONCENTRATED_RATIO = 1.5;
export const NEIGHBOR_STRIKES = 4;
// A strike needs this many neighbors to be compared at all; a chain with one
// or two listed strikes cannot show a wall standing out.
export const MIN_NEIGHBORS = 2;

function callOtm(strike, spot) {
  return spot > 0 && strike > 0 ? (strike - spot) / spot : null;
}

// The heaviest near-the-money call (0 to 10% out of the money) whose open
// interest is at least `bigOi` and at least `ratio` times the average of its
// neighbors in the same expiration. Returns { contract, neighborAvg, ratio,
// otm } or null.
export function concentratedNearMoneyCall(contracts, spot, {
  bigOi = 1000, ratio = CONCENTRATED_RATIO, neighbors = NEIGHBOR_STRIKES, otmMax = NEAR_THE_MONEY_OTM_MAX,
} = {}) {
  const byExp = new Map();
  for (const c of Array.isArray(contracts) ? contracts : []) {
    if (!c || c.side !== 'call' || !(c.strike > 0)) continue;
    const k = c.expSec ?? 'x';
    if (!byExp.has(k)) byExp.set(k, []);
    byExp.get(k).push(c);
  }
  let best = null;
  for (const calls of byExp.values()) {
    calls.sort((a, b) => a.strike - b.strike);
    for (let i = 0; i < calls.length; i += 1) {
      const c = calls[i], oi = Number(c.oi) || 0;
      const otm = callOtm(c.strike, spot);
      if (otm == null || otm < 0 || otm > otmMax || oi < bigOi) continue;
      const near = [...calls.slice(Math.max(0, i - neighbors), i), ...calls.slice(i + 1, i + 1 + neighbors)];
      if (near.length < MIN_NEIGHBORS) continue;
      const avg = near.reduce((s, x) => s + (Number(x.oi) || 0), 0) / near.length;
      if (avg > 0 && oi < ratio * avg) continue;
      if (!best || oi > (Number(best.contract.oi) || 0)) best = { contract: c, neighborAvg: avg, ratio: avg > 0 ? oi / avg : null, otm };
    }
  }
  return best;
}

// OI walls (2026-11-22): the call wall is the largest call open interest at or
// above the price, the put wall the largest put open interest at or below it.
// Before this the largest OI anywhere in the ±60% band won, so after a sharp
// drop deep in-the-money calls (now far below the price) and old puts (now
// above it) became "walls" (AMD's call wall read 240 in the Nov 20 pre-market
// scan). null when no strike sits on the right side; ties go to the strike
// nearer the price. Since 2026-11-22 a wall also sits within OI_WALL_BAND of
// the price: an old strike far away was still the largest (SPY's put wall
// read $600 with SPY at $690), which is not a level the front expirations
// will reach.
export const OI_WALL_BAND = 0.10;
export function oiWall(contracts, side, spot, band = OI_WALL_BAND) {
  const s = Number(spot);
  if (!(s > 0)) return null;
  const lo = s * (1 - band), hi = s * (1 + band);
  let best = null;
  for (const c of contracts || []) {
    if (!c || c.side !== side || !(c.oi > 0)) continue;
    if (side === 'call' ? !(c.strike >= s && c.strike <= hi) : !(c.strike <= s && c.strike >= lo)) continue;
    if (!best || c.oi > best.oi || (c.oi === best.oi && Math.abs(c.strike - s) < Math.abs(best.strike - s))) best = c;
  }
  return best;
}

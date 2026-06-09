// Dealer gamma-exposure (GEX) summary — server-side mirror of the browser's
// computeGex/computeGexFlip in scripts/render/app-js.mjs (the GEX tab). Kept as
// a tiny reusable module so the unusual-flow scanner can precompute a compact
// per-ticker GEX read into data/unusual.json without the browser having to fetch
// every flagged ticker's full chain. The math (constants, gamma weighting, flip
// sweep) is duplicated on purpose — app.js is a generated single IIFE that can't
// import an ES module, so change BOTH if you change one (same rule as greeks).
import { greeks } from "./greeks.mjs";

const GEX_CONTRACT_MULT = 100;                 // shares per contract
const GEX_MIN_T_DAYS = 1;                       // floor on T so 0DTE ATM gamma stays finite
const GEX_MAX_EXPS = 8;                          // near-term expirations included
const GEX_EXPIRY_OFFSET_MS = 20 * 3600 * 1000;   // ~16:00 ET close vs the midnight-UTC key
const GEX_YEAR_MS = 365 * 24 * 3600 * 1000;
const DEFAULT_RFR = 0.045;

function yearsTo(expSec, now) {
  const yrs = (Number(expSec) * 1000 + GEX_EXPIRY_OFFSET_MS - now) / GEX_YEAR_MS;
  return Math.max(yrs, GEX_MIN_T_DAYS / 365);
}

// Total dealer gamma$ across the flattened contract list at a hypothetical spot
// S — used by the gamma-flip sweep (vary S, find where this crosses zero).
function gexProfileAt(contracts, S, rfr) {
  if (!(S > 0)) return 0;
  let total = 0;
  const scale = S * S * 0.01 * GEX_CONTRACT_MULT;
  for (const c of contracts) {
    const g = greeks("call", S, c.K, c.T, c.sigma, rfr);
    if (!g || !isFinite(g.gamma)) continue;
    total += c.sign * g.gamma * c.oi * scale;
  }
  return total;
}

// Gamma flip = the spot level where net dealer gamma crosses zero. Sweep a band
// around spot, return the crossing nearest spot (interpolated), or null.
function computeFlip(contracts, spot, rfr) {
  if (!contracts.length || !(spot > 0)) return null;
  const lo = spot * 0.8, hi = spot * 1.2, steps = 80;
  let prevS = lo, prevG = gexProfileAt(contracts, lo, rfr), best = null;
  for (let i = 1; i <= steps; i++) {
    const S = lo + (hi - lo) * i / steps;
    const G = gexProfileAt(contracts, S, rfr);
    if (isFinite(prevG) && isFinite(G) && prevG !== G &&
        ((prevG <= 0 && G >= 0) || (prevG >= 0 && G <= 0))) {
      const cross = prevS + (S - prevS) * (0 - prevG) / (G - prevG);
      if (best === null || Math.abs(cross - spot) < Math.abs(best - spot)) best = cross;
    }
    prevS = S; prevG = G;
  }
  return best;
}

// Compact GEX summary from a baked per-ticker chain (the data/<SYM>.json.chains
// object: { [expSec]: { c:[{s,oi,iv,...}], p:[...] } }) at the given spot.
// Returns { net, flip, callWall, putWall } or null when there's nothing to
// score. callWall/putWall are { strike, net } (the heaviest net-positive /
// net-negative strikes aggregated across the shown expirations).
export function computeGexSummary(chains, spot, opts = {}) {
  if (!chains || !(spot > 0)) return null;
  const rfr = opts.rfr != null ? opts.rfr : DEFAULT_RFR;
  const now = opts.now != null ? opts.now : Date.now();
  const dayMs = 86400000;
  const expKeys = Object.keys(chains).map(Number)
    .filter((s) => isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  const exps = [];
  for (let i = 0; i < expKeys.length && exps.length < GEX_MAX_EXPS; i++) {
    const sec = expKeys[i];
    const dte = Math.round((sec * 1000 + GEX_EXPIRY_OFFSET_MS - now) / dayMs);
    if (dte < 0) continue;
    exps.push({ sec, T: yearsTo(sec, now) });
  }
  if (!exps.length) return null;

  const perStrike = new Map(); // strike -> net gamma$ across expirations
  const contracts = [];        // flat list for the flip sweep
  let totalNet = 0;
  for (const ex of exps) {
    const ch = chains[String(ex.sec)];
    if (!ch) continue;
    const sides = [["c", ch.c, 1], ["p", ch.p, -1]];
    for (const [, rows, sgn] of sides) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row) continue;
        const K = Number(row.s), oi = Number(row.oi), iv = Number(row.iv);
        if (!(K > 0) || !(oi > 0) || !(iv > 0)) continue;
        const g = greeks("call", spot, K, ex.T, iv, rfr);
        if (!g || !isFinite(g.gamma)) continue;
        const gex = g.gamma * oi * GEX_CONTRACT_MULT * spot * spot * 0.01;
        if (!isFinite(gex) || gex <= 0) continue;
        perStrike.set(K, (perStrike.get(K) || 0) + sgn * gex);
        totalNet += sgn * gex;
        contracts.push({ K, T: ex.T, sigma: iv, oi, sign: sgn });
      }
    }
  }
  if (!contracts.length) return null;

  let callWall = null, putWall = null;
  for (const [strike, net] of perStrike) {
    if (net > 0 && (!callWall || net > callWall.net)) callWall = { strike, net };
    if (net < 0 && (!putWall || net < putWall.net)) putWall = { strike, net };
  }
  return {
    net: totalNet,
    flip: computeFlip(contracts, spot, rfr),
    callWall,
    putWall,
  };
}

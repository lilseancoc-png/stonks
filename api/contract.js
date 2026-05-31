// Vercel serverless function: live single-contract proxy for the static site.
//
// The baked data/<SYMBOL>.json chains — and /api/chain — only carry strikes
// within ±50% of spot (STRIKE_BAND). A portfolio position whose strike has
// rolled off-band (e.g. a deep-ITM LEAP) therefore has no row in either, so the
// browser risk panel can't price it and silently drops it from the aggregate
// Greeks / VaR / beta-weighted delta. This endpoint exposes lib/yahoo.mjs's
// fetchContract — which deliberately bypasses the band — so the client can
// price those holdings too, the same way api/portfolio-review.js does server
// side.
//
// Returns the compressed contract { s, b, a, l, iv, oi, v } plus { spot,
// marketState } — the same shape fetchContract emits.

import { fetchContract, isValidSymbol } from "../lib/yahoo.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !isValidSymbol(symbol)) {
    return res.status(400).json({ error: "invalid symbol" });
  }

  const side = String(req.query.side || "").toLowerCase().trim();
  if (side !== "call" && side !== "put") {
    return res.status(400).json({ error: "invalid side" });
  }

  // exp is the epoch-second expiration baked into the position row.
  const expSec = Number(req.query.exp);
  if (!isFinite(expSec) || expSec < 0 || expSec > 4102444800) {
    return res.status(400).json({ error: "invalid exp" });
  }

  const strike = Number(req.query.strike);
  if (!isFinite(strike) || strike <= 0 || strike > 1000000) {
    return res.status(400).json({ error: "invalid strike" });
  }

  try {
    const c = await fetchContract(symbol, expSec, side, strike);
    if (!c) return res.status(404).json({ error: "contract not found" });

    // Same 20s edge cache as api/chain.js — the contract data isn't
    // user-specific (just symbol/exp/side/strike), so duplicate viewers
    // coalesce cleanly.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=120",
    );
    return res.status(200).json({ ...c, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("contract upstream failed", {
      symbol,
      expSec,
      side,
      strike,
      message: String(err?.message || err),
    });
    return res.status(502).json({ error: "contract unavailable" });
  }
}

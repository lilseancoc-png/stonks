// Vercel serverless function: live option chain proxy for the static site.
//
// The daily build bakes per-ticker chains into data/<SYMBOL>.json. While
// the market is open the page polls this endpoint every 30s for the chain
// the user is currently viewing — bid/ask/IV/volume change throughout the
// session and the baked snapshot grows stale. We mirror the same shape and
// strike filter the build uses so the browser can merge the fresh chain
// straight into state.chains[exp] without massaging it.
//
// Returns: { symbol, spot, exp, marketState, chain: { c: [...], p: [...] } }
// where each contract is compressed to { s, b, a, l, iv, oi, v } — same
// shape compressContract() emits at build time.

import { fetchChain, isValidSymbol } from "../lib/yahoo.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !isValidSymbol(symbol)) {
    return res.status(400).json({ error: "invalid symbol" });
  }

  // exp is the epoch-second expiration baked into data/<SYMBOL>.json keys.
  // Optional — when omitted Yahoo returns the nearest expiration.
  let expDate;
  const expRaw = req.query.exp;
  if (expRaw != null && expRaw !== "") {
    const expSec = Number(expRaw);
    if (!isFinite(expSec) || expSec < 0 || expSec > 4102444800) {
      return res.status(400).json({ error: "invalid exp" });
    }
    expDate = new Date(expSec * 1000);
  }

  try {
    const ch = await fetchChain(symbol, expDate);
    if (!ch) return res.status(502).json({ error: "no chain for " + symbol });

    // 20s edge cache absorbs duplicate clients viewing the same name +
    // expiration; stale-while-revalidate keeps something on hand if Yahoo
    // hiccups. The client polls every 30s, so 20s edge is enough headroom
    // to coalesce viewers without serving stuff the user perceives as old.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=120",
    );
    return res.status(200).json({
      ...ch,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    return res.status(502).json({ error: msg.slice(0, 200) });
  }
}

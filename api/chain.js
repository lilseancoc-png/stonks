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

import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const STRIKE_BAND = 0.50;

function compressContract(c) {
  return {
    s: c.strike,
    b: c.bid ?? null,
    a: c.ask ?? null,
    l: c.lastPrice ?? null,
    iv: c.impliedVolatility ?? null,
    oi: c.openInterest ?? null,
    v: c.volume ?? null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
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
    const r = await yahooFinance.options(symbol, expDate ? { date: expDate } : {});
    const spot =
      r.quote?.regularMarketPrice ??
      r.quote?.postMarketPrice ??
      r.quote?.preMarketPrice ??
      null;
    if (spot == null) return res.status(502).json({ error: "no spot for " + symbol });

    const entry = r.options?.[0];
    if (!entry) return res.status(502).json({ error: "no chain returned" });

    const minK = spot * (1 - STRIKE_BAND);
    const maxK = spot * (1 + STRIKE_BAND);
    const keep = (c) => c.strike != null && c.strike >= minK && c.strike <= maxK;

    const calls = (entry.calls || []).filter(keep).map(compressContract);
    const puts = (entry.puts || []).filter(keep).map(compressContract);

    const expSec = entry.expirationDate
      ? Math.round(new Date(entry.expirationDate).getTime() / 1000)
      : null;

    // 20s edge cache absorbs duplicate clients viewing the same name +
    // expiration; stale-while-revalidate keeps something on hand if Yahoo
    // hiccups. The client polls every 30s, so 20s edge is enough headroom
    // to coalesce viewers without serving stuff the user perceives as old.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=120",
    );
    return res.status(200).json({
      symbol,
      spot,
      exp: expSec,
      marketState: r.quote?.marketState ?? null,
      chain: { c: calls, p: puts },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    return res.status(502).json({ error: msg.slice(0, 200) });
  }
}

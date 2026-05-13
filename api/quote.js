// Vercel serverless function: live spot price proxy for the static site.
//
// Yahoo can't be called from the browser — CORS plus the consent-cookie /
// crumb handshake — so the page hits this endpoint when the user picks a
// ticker. We hand the request to the same `yahoo-finance2` client the build
// script uses, with the same desktop User-Agent so Yahoo's consent flow
// doesn't reject us.
//
// Returns just the quote: spot, prev close, change, change %, and the
// market state ("REGULAR" / "PRE" / "POST" / "CLOSED"). The browser uses
// marketState to decide whether to show a "Live" badge.

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

// Yahoo symbols: 1–6 chars, leading letter, letters/digits/dot only.
// Cheap allowlist to keep this from being used as an open Yahoo proxy.
const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return res.status(400).json({ error: "invalid symbol" });
  }

  try {
    const q = await yahooFinance.quote(symbol, {
      fields: [
        "regularMarketPrice",
        "regularMarketPreviousClose",
        "regularMarketChange",
        "regularMarketChangePercent",
        "marketState",
        "preMarketPrice",
        "postMarketPrice",
      ],
    });
    const spot =
      q?.regularMarketPrice ??
      q?.postMarketPrice ??
      q?.preMarketPrice ??
      null;
    if (spot == null) {
      return res.status(502).json({ error: "no spot for " + symbol });
    }
    // 30s edge cache absorbs duplicate clicks within a tight window;
    // stale-while-revalidate lets a slightly older value serve for another
    // 2 min while we refresh in the background.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return res.status(200).json({
      symbol,
      spot,
      prevClose: q?.regularMarketPreviousClose ?? null,
      change: q?.regularMarketChange ?? null,
      changePct: q?.regularMarketChangePercent ?? null,
      marketState: q?.marketState ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    // Yahoo allowlist errors look like a 401, but they happen on otherwise
    // valid symbols — surface as 502 so the browser falls back to baked data.
    return res.status(502).json({ error: msg.slice(0, 200) });
  }
}

// Vercel serverless function: live spot price proxy for the static site.
//
// Yahoo can't be called from the browser — CORS plus the consent-cookie /
// crumb handshake — so the page hits this endpoint when the user picks a
// ticker. Shared client + symbol allowlist live in lib/yahoo.mjs.
//
// Returns just the quote: spot, prev close, change, change %, and the
// market state ("REGULAR" / "PRE" / "POST" / "CLOSED"). The browser uses
// marketState to decide whether to show a "Live" badge.

import { fetchQuote, isValidSymbol } from "../lib/yahoo.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const symbol = String(req.query.symbol || "").toUpperCase().trim();
  if (!symbol || !isValidSymbol(symbol)) {
    return res.status(400).json({ error: "invalid symbol" });
  }

  try {
    const q = await fetchQuote(symbol);
    if (q.spot == null) {
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
      ...q,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Log the full upstream error server-side for debugging, but return a
    // generic message to the client — raw SDK errors (Yahoo allowlist
    // strings, internal stack frames) aren't useful to end users and can
    // leak implementation detail.
    console.error("quote upstream failed", { symbol, message: String(err?.message || err) });
    return res.status(502).json({ error: "quote unavailable" });
  }
}

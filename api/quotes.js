// Vercel serverless function: batched live quote proxy.
//
// /api/quote handles one symbol; the Heatmap tab needs ~100 in one shot
// for the live-overlay polling, and 100 sequential requests would blow
// through both the function's wall-clock budget and Yahoo's per-host
// rate limit. yahoo-finance2's quote() accepts an array and issues one
// upstream request, so we expose that as ?symbols=AAPL,MSFT,...
//
// Returns { quotes: [{ symbol, spot, prevClose, change, changePct,
// marketState }, ...] }. Missing symbols are silently dropped — partial
// results beat a 502 when one obscure ticker disappears from Yahoo.

import { yahooFinance, isValidSymbol } from "../lib/yahoo.mjs";

const MAX_SYMBOLS = 150;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const raw = String(req.query.symbols || "").trim();
  if (!raw) return res.status(400).json({ error: "missing symbols" });

  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.toUpperCase().trim())
        .filter((s) => s && isValidSymbol(s)),
    ),
  ).slice(0, MAX_SYMBOLS);

  if (!symbols.length) return res.status(400).json({ error: "no valid symbols" });

  try {
    const r = await yahooFinance.quote(symbols, {
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
    const list = Array.isArray(r) ? r : r ? [r] : [];
    const quotes = list
      .map((q) => {
        const spot =
          q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice ?? null;
        if (spot == null) return null;
        return {
          symbol: q?.symbol,
          spot,
          prevClose: q?.regularMarketPreviousClose ?? null,
          change: q?.regularMarketChange ?? null,
          changePct: q?.regularMarketChangePercent ?? null,
          marketState: q?.marketState ?? null,
        };
      })
      .filter(Boolean);

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return res.status(200).json({
      quotes,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("quotes upstream failed", {
      count: symbols.length,
      message: String(err?.message || err),
    });
    return res.status(502).json({ error: "quotes unavailable" });
  }
}

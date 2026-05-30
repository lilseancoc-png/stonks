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
        const reg = q?.regularMarketPrice ?? null;
        const spot = reg ?? q?.postMarketPrice ?? q?.preMarketPrice ?? null;
        if (spot == null) return null;
        const prevClose = q?.regularMarketPreviousClose ?? null;
        // When spot falls back to a pre/post-market price, Yahoo's
        // regularMarketChange/Percent (regular-session close vs prior close)
        // no longer matches the price we're showing. Re-derive off prevClose
        // so the spot and the % move share one baseline.
        let change = q?.regularMarketChange ?? null;
        let changePct = q?.regularMarketChangePercent ?? null;
        if (reg == null) {
          if (prevClose != null && prevClose !== 0) {
            change = spot - prevClose;
            changePct = ((spot - prevClose) / prevClose) * 100;
          } else {
            change = null;
            changePct = null;
          }
        }
        return {
          symbol: q?.symbol,
          spot,
          prevClose,
          change,
          changePct,
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

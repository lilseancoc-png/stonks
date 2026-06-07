// Vercel serverless function: live ZQ (30-Day Fed Funds) futures prices.
//
// Powers the FOMC widget's client-side LIVE recompute. The baked FedWatch
// probabilities (data/calendar.json) are only as fresh as the last hourly
// build, but CME FedWatch is continuous — so between bakes our numbers drift
// from CME purely on timing. The browser fixes that by recomputing the
// implied-rate path from live futures on load: it works out which ZQ contract
// months it needs from the FOMC schedule and asks for them here.
//
// Why a dedicated endpoint and not /api/quote: that endpoint's SYMBOL_RE
// (^[A-Z][A-Z0-9.]{0,5}$) rejects futures — both the '=' in ZQ=F and the
// length of dated contracts like ZQF26.CBT. Loosening that general allowlist
// would widen the open-proxy surface, so futures get their own tightly-scoped
// allowlist: ZQ Fed Funds contracts ONLY, nothing else reaches Yahoo.
//
// Mirrors the server-side FedWatch source (scripts/build.mjs
// fetchFedwatchSnapshot / fetchYahooFutureHistory). The implied-rate math that
// consumes these prices is duplicated in the browser (scripts/render/app-js.mjs
// refreshFomcLive) — app.js is a generated IIFE that can't import this module,
// the same reason the Black-Scholes greeks are duplicated. Keep them in sync.

import { yahooFinance } from "../lib/yahoo.mjs";

// ZQ contract symbols only: ZQ + CME month code (F G H J K M N Q U V X Z) +
// 2-digit year + .CBT, e.g. ZQF26.CBT — plus the continuous front-month ZQ=F.
// Nothing else is forwarded to Yahoo.
const ZQ_SYMBOL_RE = /^ZQ[FGHJKMNQUVXZ][0-9]{2}\.CBT$/;
const MAX_SYMBOLS = 40; // ~13 meetings × (own month + next month), deduped + ZQ=F

function isZqSymbol(s) {
  return s === "ZQ=F" || ZQ_SYMBOL_RE.test(s);
}

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
        .filter((s) => s && isZqSymbol(s)),
    ),
  ).slice(0, MAX_SYMBOLS);

  if (!symbols.length) return res.status(400).json({ error: "no valid ZQ symbols" });

  try {
    // One batched upstream call (yahoo-finance2's quote() accepts an array),
    // same as /api/quotes — far cheaper than one request per contract.
    const r = await yahooFinance.quote(symbols, {
      fields: ["regularMarketPrice", "regularMarketPreviousClose", "marketState"],
    });
    const list = Array.isArray(r) ? r : r ? [r] : [];
    const prices = {};
    let marketState = null;
    for (const q of list) {
      // ZQ trades nearly 24h on Globex, so regularMarketPrice is almost always
      // live; fall back to the prior settle if a far contract is momentarily
      // quoteless. Partial results are fine — the browser breaks the implied
      // path cleanly when a contract is missing (matches the build's fallback).
      const px = q?.regularMarketPrice ?? q?.regularMarketPreviousClose ?? null;
      if (px != null && isFinite(px) && q?.symbol) {
        prices[q.symbol] = Number(px);
        if (!marketState) marketState = q?.marketState ?? null;
      }
    }
    // 30s edge cache absorbs duplicate loads; stale-while-revalidate keeps a
    // slightly older value serving while we refresh.
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      prices,
      marketState,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("fed-futures upstream failed", {
      count: symbols.length,
      message: String(err?.message || err),
    });
    return res.status(502).json({ error: "fed-futures unavailable" });
  }
}

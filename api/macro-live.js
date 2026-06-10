// Vercel serverless function: live macro snapshot for the Bonds & USD tab.
//
// The Live snapshot tiles (2Y/10Y/30Y yields, DXY, VIX) are baked by
// fetchMacroBackdrop in scripts/build.mjs, so between hourly bakes they can
// run a full hour (or, pre-market, a whole overnight session) stale. The
// browser can't fetch these itself: the caret-prefixed index symbols (^TNX,
// ^VIX, …) and DX-Y.NYB deliberately fail the SYMBOL_RE allowlist on
// /api/quote(s) — that allowlist is what keeps those endpoints from being an
// open Yahoo proxy. So, like /api/fed-futures (the strict ZQ-only sibling),
// this endpoint takes NO symbol input at all: it fetches a fixed server-side
// set in ONE batched upstream call and returns per-leg
// { value, prevClose, pctChange1d, bpsChange1d }.
//
// 1d changes are derived from regularMarketPreviousClose — the same
// prior-session-close baseline the bake's fetchLeg uses — so the tiles'
// movement bands and alert thresholds classify identically against live
// values. 5d trends and the VIX 90-day percentile stay baked (they need
// price history, not worth extra upstream calls here); the browser merges
// live value + 1d move over the baked legs and keeps the rest.

import { yahooFinance, withYahooTimeout } from "../lib/yahoo.mjs";

// Mirrors the tile set in fetchMacroBackdrop (scripts/build.mjs). ^UST2YR is
// sometimes restricted on Yahoo — a missing leg comes back null and the
// browser keeps that tile on its baked value.
const LEGS = [
  { key: "twoY", symbol: "^UST2YR", isYield: true },
  { key: "tenY", symbol: "^TNX", isYield: true },
  { key: "thirtyY", symbol: "^TYX", isYield: true },
  { key: "dxy", symbol: "DX-Y.NYB", isYield: false },
  { key: "vix", symbol: "^VIX", isYield: false },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const r = await withYahooTimeout(
      yahooFinance.quote(
        LEGS.map((l) => l.symbol),
        { fields: ["regularMarketPrice", "regularMarketPreviousClose", "marketState"] },
      ),
      "macro-live",
    );
    const list = Array.isArray(r) ? r : r ? [r] : [];
    const bySym = new Map(list.filter((q) => q?.symbol).map((q) => [q.symbol, q]));

    const legs = {};
    let marketState = null;
    for (const { key, symbol, isYield } of LEGS) {
      const q = bySym.get(symbol);
      const value = q?.regularMarketPrice;
      if (typeof value !== "number" || !isFinite(value)) {
        legs[key] = null;
        continue;
      }
      if (!marketState && q?.marketState) marketState = q.marketState;
      const prevRaw = q?.regularMarketPreviousClose;
      const prevClose = typeof prevRaw === "number" && isFinite(prevRaw) ? prevRaw : null;
      const pctChange1d = prevClose != null && prevClose !== 0 ? ((value - prevClose) / prevClose) * 100 : null;
      const bpsChange1d = isYield && prevClose != null ? (value - prevClose) * 100 : null;
      legs[key] = { value, prevClose, pctChange1d, bpsChange1d };
    }

    // All-null means the upstream batch effectively failed — surface it so
    // the browser keeps the baked tiles rather than overlaying nothing.
    if (!legs.tenY && !legs.thirtyY && !legs.dxy && !legs.vix) {
      return res.status(502).json({ error: "macro quotes unavailable" });
    }

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      legs,
      marketState,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("macro-live upstream failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "macro quotes unavailable" });
  }
}

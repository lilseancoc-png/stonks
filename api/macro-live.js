// Vercel serverless function: live macro snapshot for the Bonds & USD tab AND
// the Top Picks "market tape" live regime recompute.
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
//
// The Top Picks market tape (computeLiveMacroRegime in app.js) ALSO needs the
// fast cross-asset macro-regime axes refreshed: crude + gold (the commodity /
// geopolitical-shock axis) ride in the same batched quote, and ?fng=1 folds in
// a best-effort CNN Fear & Greed read for the sentiment axis. The crude/gold
// legs are harmless to the Bonds & USD tab (it only reads the five legs above),
// and the CNN fetch only happens when ?fng=1 is passed, so the Bonds tab's 30s
// poll incurs no extra upstream work.

import { yahooFinance, withYahooTimeout } from "../lib/yahoo.mjs";

// Mirrors the tile set in fetchMacroBackdrop (scripts/build.mjs). ^UST2YR is
// sometimes restricted on Yahoo — a missing leg comes back null and the
// browser keeps that tile on its baked value. CL=F (crude) + GC=F (gold) feed
// the picks market-tape commodity axis only.
const LEGS = [
  { key: "twoY", symbol: "^UST2YR", isYield: true },
  { key: "tenY", symbol: "^TNX", isYield: true },
  { key: "thirtyY", symbol: "^TYX", isYield: true },
  { key: "dxy", symbol: "DX-Y.NYB", isYield: false },
  { key: "vix", symbol: "^VIX", isYield: false },
  { key: "crude", symbol: "CL=F", isYield: false },
  { key: "gold", symbol: "GC=F", isYield: false },
];

// CNN's 7-component Fear & Greed composite — the same source fetchCnnFearGreed
// reads in scripts/build.mjs. Best-effort live read for the picks sentiment
// axis: composite + previous close (extremes / fast-swing votes) plus the
// breadth + junk-bond components and the week/month closes (the fragile
// internals divergence read). A failure returns null and the browser falls
// back to the baked sentiment axis.
const CNN_FNG_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
async function fetchFearGreedLive() {
  try {
    const res = await fetch(CNN_FNG_URL, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.cnn.com/",
        origin: "https://www.cnn.com",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const root = json && json.fear_and_greed;
    const score = Number(root && root.score);
    if (!Number.isFinite(score)) return null;
    const num = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x) * 100) / 100 : null);
    const comp = (c) => (c && Number.isFinite(Number(c.score)) ? Math.round(Number(c.score) * 100) / 100 : null);
    return {
      score: num(score),
      rating: typeof root.rating === "string" && root.rating ? root.rating.toLowerCase() : null,
      prevClose: num(root.previous_close),
      week: num(root.previous_1_week),
      month: num(root.previous_1_month),
      breadth: comp(json.stock_price_breadth),
      credit: comp(json.junk_bond_demand),
      asOf: typeof root.timestamp === "string" ? root.timestamp : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  // The picks market tape passes ?fng=1 to also fold in the CNN Fear & Greed
  // sentiment axis; the Bonds & USD tab omits it (no extra upstream fetch).
  const fngQ = req.query && req.query.fng;
  const wantFng = (Array.isArray(fngQ) ? fngQ[0] : fngQ) === "1";

  try {
    const [quoteR, fngR] = await Promise.allSettled([
      withYahooTimeout(
        yahooFinance.quote(
          LEGS.map((l) => l.symbol),
          { fields: ["regularMarketPrice", "regularMarketPreviousClose", "marketState"] },
        ),
        "macro-live",
      ),
      wantFng ? fetchFearGreedLive() : Promise.resolve(null),
    ]);
    if (quoteR.status !== "fulfilled") throw quoteR.reason || new Error("quote failed");
    const r = quoteR.value;
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

    // All-null on the CORE macro legs means the upstream batch effectively
    // failed — surface it so the browser keeps the baked tiles rather than
    // overlaying nothing. (Crude/gold being null alone is not a failure.)
    if (!legs.twoY && !legs.tenY && !legs.thirtyY && !legs.dxy && !legs.vix) {
      return res.status(502).json({ error: "macro quotes unavailable" });
    }

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      legs,
      marketState,
      // Only present on a ?fng=1 request; null when CNN failed (browser falls
      // back to the baked sentiment axis).
      ...(wantFng ? { fng: fngR.status === "fulfilled" ? fngR.value : null } : {}),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("macro-live upstream failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "macro quotes unavailable" });
  }
}

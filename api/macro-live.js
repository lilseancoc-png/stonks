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
// and the CNN fetch only happens when ?fng=1 is passed, so the Bonds tab's
// visible-tab poll (five minutes on FOMC decision days) incurs no extra
// upstream work.

import { yahooFinance, withYahooTimeout } from "../lib/yahoo.mjs";

// Mirrors the tile set in fetchMacroBackdrop (scripts/build.mjs). The 2Y is
// deliberately NOT in this Yahoo set: Yahoo has no cash 2Y yield index, and
// 2YY=F is a forward-settled yield future rather than the current Treasury CMT.
// The handler fetches the official U.S. Treasury par-yield observation in
// parallel below. CL=F (crude) + GC=F (gold) feed the picks market-tape
// commodity axis only.
const LEGS = [
  { key: "tenY", symbol: "^TNX", isYield: true },
  { key: "thirtyY", symbol: "^TYX", isYield: true },
  { key: "dxy", symbol: "DX-Y.NYB", isYield: false },
  { key: "vix", symbol: "^VIX", isYield: false },
  { key: "crude", symbol: "CL=F", isYield: false },
  { key: "gold", symbol: "GC=F", isYield: false },
  // SPY + QQQ feed the picks market-tape Indexes axis (the overall-market read).
  // Harmless to the Bonds & USD tab, which only reads the five macro legs above.
  { key: "spy", symbol: "SPY", isYield: false },
  { key: "qqq", symbol: "QQQ", isYield: false },
  // MOVE (Treasury-option implied vol — the bond-vol axis) + the HY/IG credit ETFs
  // (the credit axis's live HYG/LQD ratio). Feed the Top Picks market-tape /
  // barometer only; the 2Y leg above also feeds the new front-end axis.
  { key: "move", symbol: "^MOVE", isYield: false },
  { key: "hyg", symbol: "HYG", isYield: false },
  { key: "lqd", symbol: "LQD", isYield: false },
];

const TREASURY_YIELD_XML =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=";

// Exported for the offline API smoke test. Treasury's Atom feed is ordered by
// date today, but sort defensively so a source-order change cannot turn an old
// observation into the headline value. The official series is an end-of-day
// constant-maturity yield, not an intraday proxy.
export function parseTreasuryTwoYearXml(xml) {
  const byDate = new Map();
  for (const chunk of String(xml || "").split(/<entry[\s>]/).slice(1)) {
    const dm = chunk.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/);
    const vm = chunk.match(/<d:BC_2YEAR[^>]*>([^<]*)<\/d:BC_2YEAR>/);
    const date = dm?.[1]?.slice(0, 10) || "";
    const value = Number(vm?.[1]);
    if (date && Number.isFinite(value)) byDate.set(date, value);
  }
  const rows = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) return null;
  const [asOf, value] = rows[rows.length - 1];
  const prevClose = rows.length >= 2 ? rows[rows.length - 2][1] : null;
  return {
    value,
    prevClose,
    pctChange1d: prevClose != null && prevClose !== 0 ? ((value - prevClose) / prevClose) * 100 : null,
    bpsChange1d: prevClose != null ? (value - prevClose) * 100 : null,
    asOf,
    source: "U.S. Treasury Daily Par Yield Curve",
  };
}

async function fetchTreasuryTwoYear() {
  const year = new Date().getUTCFullYear();
  const response = await fetch(`${TREASURY_YIELD_XML}${year}`, {
    headers: {
      "user-agent": "stonks-market-research/1.0",
      accept: "application/atom+xml,application/xml,text/xml,*/*;q=0.5",
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Treasury 2Y HTTP ${response.status}`);
  const leg = parseTreasuryTwoYearXml(await response.text());
  if (!leg) throw new Error("Treasury 2Y feed returned no usable observation");
  return leg;
}

// Cross-asset barometer legs for the Top Picks "Cross-asset signals → market
// tape" rail (renderRiskBarometer in app.js). Only fetched when the caller
// passes ?tape=1 — the Bonds & USD tab's poll omits it and pays for no extra
// symbols. Mirrors BAROMETER_ASSETS in scripts/render/app-js.mjs; isYield marks
// the legs whose 1d move is reported in basis points (the long-end yields).
// These caret-/=/-prefixed symbols (^GDAXI, ES=F, JPY=X, BTC-USD, …) all fail
// /api/quotes' SYMBOL_RE on purpose, so — like the macro legs above — they can
// only be reached through this fixed, no-symbol-input server set. The Asia/EU
// CASH indices (^GDAXI/^N225/^KS11) are closed during US hours, so the
// browser only overlays a leg whose marketState is REGULAR and leaves the rest
// on their baked overnight read.
const CROSS_ASSET_LEGS = [
  { symbol: "ES=F" },
  { symbol: "NQ=F" },
  { symbol: "^GDAXI" },
  { symbol: "^N225" },
  { symbol: "^KS11" },
  { symbol: "^VIX" },
  { symbol: "^TNX", isYield: true },
  { symbol: "^TYX", isYield: true },
  { symbol: "JPY=X" },
  { symbol: "DX-Y.NYB" },
  { symbol: "CL=F" },
  { symbol: "GC=F" },
  { symbol: "BTC-USD" },
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
  // The Top Picks cross-asset barometer passes ?tape=1 to also fold in the
  // cross-asset rail symbols (futures / Asia-EU indices / FX / metals / crypto);
  // the Bonds & USD tab omits it and quotes only the seven macro legs.
  const tapeQ = req.query && req.query.tape;
  const wantTape = (Array.isArray(tapeQ) ? tapeQ[0] : tapeQ) === "1";

  // One batched upstream call covers both sets — union the symbols so a leg in
  // both (e.g. ^VIX, ^TNX, the dollar) is quoted once.
  const legSymbols = LEGS.map((l) => l.symbol);
  const quoteSymbols = wantTape
    ? Array.from(new Set([...legSymbols, ...CROSS_ASSET_LEGS.map((l) => l.symbol)]))
    : Array.from(new Set(legSymbols));

  try {
    const [quoteR, fngR, twoYR] = await Promise.allSettled([
      withYahooTimeout(
        yahooFinance.quote(quoteSymbols, {
          fields: ["regularMarketPrice", "regularMarketPreviousClose", "marketState"],
        // yahoo-finance2's current runtime schema rejects otherwise-valid
        // futures rows when Yahoo returns `contractSymbol: false` (2YY/CL/GC).
        // This is a fixed server-owned symbol set and every field consumed below
        // is checked for type/finite value, so bypass the brittle SDK shape gate.
        }, { validateResult: false }),
        "macro-live",
      ),
      wantFng ? fetchFearGreedLive() : Promise.resolve(null),
      fetchTreasuryTwoYear(),
    ]);
    if (quoteR.status !== "fulfilled") throw quoteR.reason || new Error("quote failed");
    const r = quoteR.value;
    const list = Array.isArray(r) ? r : r ? [r] : [];
    const bySym = new Map(list.filter((q) => q?.symbol).map((q) => [q.symbol, q]));

    const legs = {};
    let marketState = null;
    for (const { key, symbol, fallback, isYield } of LEGS) {
      let q = bySym.get(symbol);
      let value = q?.regularMarketPrice;
      if ((typeof value !== "number" || !isFinite(value)) && fallback) {
        q = bySym.get(fallback);
        value = q?.regularMarketPrice;
      }
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
    // Do not substitute 2YY=F here. Its 3.961 quote on 2026-08-18 was a futures
    // contract level while the official same-day 2Y CMT was 4.19%; treating the
    // former as cash yield corrupted the tile, 2s10s spread and market-tape axis.
    // If Treasury is temporarily unavailable, return null and let the browser
    // keep the bake's authoritative Treasury/FRED value.
    legs.twoY = twoYR.status === "fulfilled" ? twoYR.value : null;

    // All-null on the CORE macro legs means the upstream batch effectively
    // failed — surface it so the browser keeps the baked tiles rather than
    // overlaying nothing. (Crude/gold being null alone is not a failure.)
    if (!legs.twoY && !legs.tenY && !legs.thirtyY && !legs.dxy && !legs.vix) {
      return res.status(502).json({ error: "macro quotes unavailable" });
    }

    // Cross-asset barometer rail (?tape=1). Keyed by the raw Yahoo symbol so the
    // browser can join it against BAROMETER_ASSETS directly; per-leg marketState
    // lets the client overlay only REGULAR-session legs and leave closed cash
    // indices on their baked overnight read. A leg with no finite quote is
    // dropped (the row keeps its baked value).
    let crossAsset = null;
    if (wantTape) {
      crossAsset = {};
      for (const { symbol, isYield } of CROSS_ASSET_LEGS) {
        const q = bySym.get(symbol);
        const value = q?.regularMarketPrice;
        if (typeof value !== "number" || !isFinite(value)) continue;
        const prevRaw = q?.regularMarketPreviousClose;
        const prevClose = typeof prevRaw === "number" && isFinite(prevRaw) ? prevRaw : null;
        const pctChange1d = prevClose != null && prevClose !== 0 ? ((value - prevClose) / prevClose) * 100 : null;
        const bpsChange1d = isYield && prevClose != null ? (value - prevClose) * 100 : null;
        crossAsset[symbol] = {
          value,
          prevClose,
          pctChange1d,
          bpsChange1d,
          marketState: q?.marketState || null,
        };
      }
    }

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({
      legs,
      marketState,
      // Only present on a ?fng=1 request; null when CNN failed (browser falls
      // back to the baked sentiment axis).
      ...(wantFng ? { fng: fngR.status === "fulfilled" ? fngR.value : null } : {}),
      // Only present on a ?tape=1 request (the cross-asset barometer rail).
      ...(wantTape ? { crossAsset } : {}),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("macro-live upstream failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "macro quotes unavailable" });
  }
}

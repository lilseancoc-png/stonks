// Webull stock quotes for the paper mirror's share orders (2026-11-19, wave 2
// build A). Option orders keep Yahoo quotes: Webull's free option quotes are
// 15 minutes late (delay_minutes: 15 in the 2026-11-19 probe), its stock
// snapshot is real time on the paper keys (last_trade_time lag 0.0-0.1 min).
//
// Endpoint: GET /market-data/stocks/snapshots/list (official OpenAPI,
// developer.webull.com/apis/docs/reference/snapshot): symbols, category
// US_STOCK or US_ETF; fields used: symbol, bid, ask, price, last_trade_time
// (ms epoch). The quote is used only when it is sane (0 < bid <= ask), fresh
// (the last trade within MAX_TRADE_AGE_MS) and, when Yahoo also answers, its
// mid sits within BAND_PCT of Yahoo's. Otherwise the share order prices off
// Yahoo exactly as before, and the attempt's quoteSource says why.
//
// Calls: at most one snapshot call per symbol per run (cached; an ETF that
// answers nothing under US_STOCK is asked once more under US_ETF). The
// mirror has a handful of share trades a run; paper keys allow 30 a minute.

export const STOCK_QUOTE_BAND_PCT = 1;
export const MAX_TRADE_AGE_MS = 5 * 60 * 1000;
export const WEBULL_STOCK_SOURCE = "Webull stock snapshot";

const num = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

// A snapshot reply -> the row for this symbol, or null.
export function snapshotRow(resp, symbol) {
  const rows = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
  const want = String(symbol || "").toUpperCase();
  return rows.find((r) => r && String(r.symbol || "").toUpperCase() === want) || null;
}

// Row -> { bid, ask, spot, tradeIso } or null when it is not a usable quote.
export function snapshotQuote(row) {
  const bid = num(row?.bid), ask = num(row?.ask);
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0) || bid > ask) return null;
  const t = num(row?.last_trade_time);
  return { bid, ask, spot: num(row?.price), tradeIso: t != null && t > 0 ? new Date(t).toISOString() : null };
}

// True when a Yahoo quote's bid/ask mid sits more than `bandPct` from its own
// last price. Yahoo's book carries no time of its own and can be stale (QQQ
// bid 717 against a 608 last on 2026-11-20), so a share order never prices
// off such a book, with or without Webull beside it (review 2026-11-22). No
// last price to compare = no verdict (false), as before.
export function yahooBookOff(q, bandPct = STOCK_QUOTE_BAND_PCT) {
  const b = num(q?.bid), a = num(q?.ask), s = num(q?.spot);
  if (!(b > 0) || !(a > 0) || !(s > 0)) return false;
  return Math.abs(((b + a) / 2) / s - 1) * 100 > bandPct;
}

// A Yahoo quote whose book failed yahooBookOff, priced at Yahoo's last trade
// instead (bid = ask = last). A real trade price beats a stale book, and an
// exit (stop, rotate, time) still gets a price this window instead of
// waiting hours for the next one. `lastOnly` marks it.
export const YAHOO_LAST_PRICE_WHY = "Yahoo bid/ask away from its last price; priced at the last price";
export function yahooLastPriceQuote(q) {
  const s = num(q?.spot);
  return s > 0 ? { ...q, bid: s, ask: s, spot: s, lastOnly: true } : null;
}

// Pick the quote a share order prices from. `webull` / `yahoo` are
// { bid, ask, spot, ... } or null. Returns the chosen quote with `source`
// and, when Webull was passed over, `fallbackWhy` (fixed words).
export function chooseStockQuote(webull, yahoo, { nowMs = Date.now(), bandPct = STOCK_QUOTE_BAND_PCT, maxAgeMs = MAX_TRADE_AGE_MS } = {}) {
  // The Yahoo backup must pass its own referee (review 2026-11-22): a book
  // away from Yahoo's last price prices at that last price instead.
  const viaYahoo = (why) => {
    if (!yahoo) return null;
    if (!yahooBookOff(yahoo, bandPct)) return { ...yahoo, fallbackWhy: why };
    const last = yahooLastPriceQuote(yahoo);
    return last ? { ...last, fallbackWhy: `${why}; ${YAHOO_LAST_PRICE_WHY}` } : null;
  };
  if (!webull) return viaYahoo("Webull quote unavailable");
  const age = webull.tradeIso ? nowMs - Date.parse(webull.tradeIso) : null;
  if (age == null || !(age <= maxAgeMs)) return viaYahoo("Webull quote stale");
  let keptWhy = null;
  if (yahoo) {
    const wm = (webull.bid + webull.ask) / 2, ym = (num(yahoo.bid) + num(yahoo.ask)) / 2;
    const off = (a, b) => Math.abs(a / b - 1) * 100 > bandPct;
    if (ym > 0 && off(wm, ym)) {
      // Audit 2026-11-22: Yahoo's bid/ask carries no time of its own and can
      // sit far from the stock's last trade (QQQ bid 717 against a 608 last
      // on 2026-11-20). When the two mids disagree, Yahoo's own last price
      // referees: a Webull mid near it and a Yahoo mid away from it keeps
      // Webull (whose quote passed the freshness check above).
      // Review 2026-11-22: a Yahoo book away from its own last price is not
      // trusted at all, so the fresh Webull quote is kept even when Webull
      // also sits away from Yahoo's last price (which may be the stale part).
      const ys = num(yahoo.spot);
      if (!(ys > 0 && off(ym, ys))) return viaYahoo(`Webull and Yahoo differ over ${bandPct}%`);
      keptWhy = "Yahoo bid/ask away from its last price";
    }
  }
  return { bid: webull.bid, ask: webull.ask, spot: webull.spot ?? yahoo?.spot ?? null, source: WEBULL_STOCK_SOURCE, quoteAsOf: webull.tradeIso, ...(keptWhy ? { keptWhy } : {}) };
}

// fetchStock(symbol) for makeQuoteFn (lib/webull-mirror.mjs): Webull first,
// Yahoo (lib/yahoo.mjs fetchQuote) as the check and the backup. Each answer
// carries `source` for the attempt's quoteSource. `onEvent(kind)` counts
// fixed-word events for the run summary (never a ticker).
export function makeWebullStockFetcher(client, yahooFetch, { nowMs = () => Date.now(), bandPct = STOCK_QUOTE_BAND_PCT, onEvent = () => {} } = {}) {
  const category = new Map();
  async function webullRow(symbol) {
    if (typeof client?.stockSnapshots !== "function") return null;
    for (const cat of category.has(symbol) ? [category.get(symbol)] : ["US_STOCK", "US_ETF"]) {
      try {
        const row = snapshotRow(await client.stockSnapshots([symbol], cat), symbol);
        if (row) { category.set(symbol, cat); return row; }
      } catch (err) {
        if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err;
        onEvent("Webull stock snapshot failed");
        return null;
      }
    }
    return null;
  }
  return async function fetchStock(symbol) {
    const [w, y] = await Promise.all([
      webullRow(symbol).then(snapshotQuote).catch((err) => { if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err; return null; }),
      Promise.resolve().then(() => (yahooFetch ? yahooFetch(symbol) : null)).catch(() => null),
    ]);
    const yb = num(y?.bid), ya = num(y?.ask);
    const yahoo = yb != null && ya != null && yb > 0 && ya > 0 && yb <= ya ? { bid: yb, ask: ya, spot: num(y?.spot), quoteAsOf: y?.quoteAsOf || null } : null;
    const pick = chooseStockQuote(w, yahoo, { nowMs: nowMs(), bandPct });
    if (!pick) return null;
    if (pick.source === WEBULL_STOCK_SOURCE) { onEvent(pick.keptWhy ? `share order priced off Webull - ${pick.keptWhy}` : "share order priced off Webull"); return pick; }
    onEvent(`share order priced off Yahoo - ${pick.fallbackWhy}`);
    return { ...pick, source: `Yahoo stock quote (${pick.fallbackWhy})` };
  };
}

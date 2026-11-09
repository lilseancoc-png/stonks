// R4 — Stocktwits watchers and trending list.
//
// Watcher counts (how many Stocktwits users follow a symbol) ride the per-name
// stream call the bake already makes for its sentiment read
// (fetchStocktwitsSentiment in build.mjs returns `watchers` from
// body.symbol.watchlist_count), so no extra request per ticker. One extra call
// a build reads the trending list, https://api.stocktwits.com/api/2/trending/
// symbols.json ({ symbols: [{ symbol, title, watchlist_count }] }). 60 days
// of [date, watchers] per tracked name. Free, no key.

import { fetchJson, finite, round, carried, errorText, upsertDated, normalizeSymbol } from "./util.mjs";

export const STOCKTWITS_TRENDING_URL = "https://api.stocktwits.com/api/2/trending/symbols.json";
export const STOCKTWITS_HISTORY_DAYS = 60;

export function watchersFromChain(chain) {
  const st = chain?.social?.sources?.stocktwits;
  if (!st || st.stale) return null;
  const w = finite(st.watchers);
  return w != null && w >= 0 ? Math.round(w) : null;
}

export function parseTrending(body) {
  const list = Array.isArray(body?.symbols) ? body.symbols : [];
  return list.map((s) => ({ symbol: normalizeSymbol(s?.symbol), title: String(s?.title || "").trim() || null, watchers: finite(s?.watchlist_count) })).filter((s) => s.symbol);
}

export async function fetchStocktwitsCrowd({ prior, symbols, chains, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchJson } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const tracked = new Set(symbols.map(normalizeSymbol));
  const bySymbol = {};
  let covered = 0;
  for (const sym of symbols) {
    const hist = Array.isArray(base.bySymbol?.[sym]?.history) ? base.bySymbol[sym].history : [];
    const w = watchersFromChain(chains?.[sym]);
    const history = w != null ? upsertDated(hist, [todayEt, w], STOCKTWITS_HISTORY_DAYS) : hist;
    if (w != null) covered++;
    const latest = history[history.length - 1] || null;
    const at = (n) => history[history.length - 1 - n] || null;
    const chg = (n) => (latest && at(n) && Number.isFinite(at(n)[1]) ? latest[1] - at(n)[1] : null);
    const pct = (n) => (chg(n) != null && at(n)[1] > 0 ? round((chg(n) / at(n)[1]) * 100, 2) : null);
    bySymbol[sym] = {
      watchers: latest ? latest[1] : null,
      date: latest ? latest[0] : null,
      change1d: chg(1), change7d: chg(7), change30d: chg(30),
      pct7d: pct(7), pct30d: pct(30),
      msgCount24h: finite(chains?.[sym]?.social?.msgCount24h),
      history,
    };
  }
  let trending = Array.isArray(base.trending) ? base.trending : [];
  let trendingError = null;
  try {
    const body = await fetchImpl(STOCKTWITS_TRENDING_URL);
    const parsed = parseTrending(body);
    if (parsed.length) trending = parsed.map((t) => ({ ...t, tracked: tracked.has(t.symbol) }));
    else trendingError = "empty trending list";
  } catch (err) {
    trendingError = errorText(err);
  }
  if (!covered && !trending.length) return carried(base, trendingError || "no watcher counts", nowIso);
  return {
    ok: covered > 0 || !trendingError,
    stale: false, carriedForward: false,
    error: trendingError,
    fetchedAt: nowIso, fetchedDate: todayEt, asOf: nowIso,
    covered,
    trendingAt: trendingError ? (base.trendingAt || null) : nowIso,
    trendingStale: !!trendingError,
    trending,
    bySymbol,
    note: "Watchers = Stocktwits users following the symbol (from the same stream read the site's sentiment uses). Trending = Stocktwits' own list of symbols with unusual message activity right now.",
  };
}

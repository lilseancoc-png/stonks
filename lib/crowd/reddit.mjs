// R1 — Reddit mentions from ApeWisdom (r/wallstreetbets and the other stock subs).
//
// https://apewisdom.io/api/v1.0/filter/all-stocks/page/N returns
// { count, pages, current_page, results: [{ rank, ticker, name, mentions,
// upvotes, rank_24h_ago, mentions_24h_ago }] }, 100 rows a page, refreshed
// every few minutes. Three pages per build (the top 300 names) once an hour
// at most; 60 days of [date, mentions, rank] per tracked name. Free, no key.

import { fetchJson, finite, round, carried, errorText, upsertDated, normalizeSymbol } from "./util.mjs";

export const REDDIT_URL = (page) => `https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`;
export const REDDIT_PAGES = 3;
export const REDDIT_HISTORY_DAYS = 60;
export const REDDIT_MIN_AVG_DAYS = 5;
export const REDDIT_TOP_KEEP = 50;
export const REDDIT_MIN_GAP_MS = 50 * 60 * 1000;

export function parseRedditRows(body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  return results.map((r) => ({
    rank: finite(r?.rank),
    symbol: normalizeSymbol(r?.ticker),
    name: String(r?.name || "").trim() || null,
    mentions: finite(r?.mentions),
    mentions24hAgo: finite(r?.mentions_24h_ago),
    upvotes: finite(r?.upvotes),
    rank24hAgo: finite(r?.rank_24h_ago),
  })).filter((r) => r.symbol && r.rank != null);
}

export async function fetchReddit({ prior, symbols, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchJson } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const lastMs = Date.parse(base.fetchedAt || "");
  if (base.ok && Number.isFinite(lastMs) && Date.parse(nowIso) - lastMs < REDDIT_MIN_GAP_MS) return { ...base, carriedForward: false };
  const tracked = new Set(symbols.map(normalizeSymbol));
  const rows = [];
  const errors = [];
  for (let page = 1; page <= REDDIT_PAGES; page++) {
    try {
      const body = await fetchImpl(REDDIT_URL(page));
      const parsed = parseRedditRows(body);
      if (!parsed.length) break;
      rows.push(...parsed);
      if (finite(body?.pages) != null && page >= body.pages) break;
    } catch (err) {
      errors.push(`page ${page}: ${errorText(err)}`);
      break;
    }
  }
  if (!rows.length) return carried(base, errors[0] || "no rows", nowIso);
  rows.sort((a, b) => a.rank - b.rank);
  const totalMentions = rows.reduce((a, r) => a + (r.mentions || 0), 0);
  const top = rows.slice(0, REDDIT_TOP_KEEP).map((r) => ({ ...r, tracked: tracked.has(r.symbol), sharePct: totalMentions ? round((r.mentions / totalMentions) * 100, 1) : null }));
  const bySymbol = {};
  for (const sym of symbols) {
    const row = rows.find((r) => r.symbol === sym) || null;
    const hist = Array.isArray(base.bySymbol?.[sym]?.history) ? base.bySymbol[sym].history : [];
    const history = upsertDated(hist, [todayEt, row?.mentions ?? 0, row?.rank ?? null, row?.upvotes ?? null], REDDIT_HISTORY_DAYS);
    const mentionsHist = history.map((r) => r[1]).filter((v) => Number.isFinite(v));
    // The 7-day average needs five earlier days; one or two days would call
    // an ordinary day a spike.
    const prior7 = mentionsHist.slice(-8, -1);
    const avg7 = prior7.length >= REDDIT_MIN_AVG_DAYS ? prior7.reduce((a, b) => a + b, 0) / prior7.length : null;
    bySymbol[sym] = {
      rank: row?.rank ?? null,
      rank24hAgo: row?.rank24hAgo ?? null,
      mentions: row?.mentions ?? 0,
      mentions24hAgo: row?.mentions24hAgo ?? null,
      upvotes: row?.upvotes ?? null,
      sharePct: row && totalMentions ? round((row.mentions / totalMentions) * 100, 2) : null,
      vsAvg7: avg7 > 0 && row ? round(row.mentions / avg7, 2) : null,
      history,
    };
  }
  return {
    ok: true, stale: false, carriedForward: false, error: errors[0] || null,
    fetchedAt: nowIso, fetchedDate: todayEt, asOf: nowIso,
    pagesRead: Math.ceil(rows.length / 100),
    totalMentions,
    top,
    bySymbol,
    note: "Mentions in the last 24 hours across the stock subreddits ApeWisdom tracks (wallstreetbets, stocks, investing, options and others). Count of posts and comments, not sentiment.",
  };
}

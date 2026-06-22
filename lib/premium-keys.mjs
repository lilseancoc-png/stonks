// Freemium tiering — which data/ keys require a Discord-role session.
//
// The site is a freemium product: most tabs (Grade, Calendar, Heatmap, 13F,
// Bonds & USD, Fear & Greed, Overnight, Streaks, Strategies, the reference
// pages) are FREE and their data/*.json serve to anyone; a handful of premium
// tabs (Top Picks, Briefs, Narratives, Unusual Flow, Volume, Gamma Exposure,
// Hot stocks, Track Record) are gated behind a valid session and so are the
// data files that back them.
//
// This module is the SINGLE source of truth for that split, shared by the Edge
// middleware (the /data/* rewrite) and the Node api/data reader (the tiered
// enforcement). Keep it dependency-free + Edge-safe (no node:* imports).
//
// Keys are data/-relative pathnames exactly as stored (e.g. "picks.json",
// "manifest.json"). Anything NOT listed here is free.

// Premium = served only to a valid Discord-role session.
// - manifest.json carries the premium half of the inlined manifest (narratives,
//   sector overviews, recently-ended picks, the unusual-flow snapshot). The free
//   half lives in manifest-free.json (macro / fear-greed / backdrop / spots).
// - picks* (incl. picks-0dte = the Day trades roster), regime-history, briefs, trends*, unusual*, volume-flags/-history,
//   oi-tracker/-history, flow-explanations, grades-history/-daily back the premium tabs.
// - ai-usage / chart-pattern-cache are internal bookkeeping, never browser-facing.
//   They're gated for good measure so the store can't be scraped through the API.
const PREMIUM_KEYS = new Set([
  "manifest.json",
  "picks.json",
  "picks-0dte.json",
  "picks-accuracy.json",
  "picks-changes.json",
  "picks-roster.json",
  "regime-history.json",
  "grades-history.json",
  "grades-daily.json",
  "briefs.json",
  "trends.json",
  "trends-history.json",
  "unusual.json",
  "unusual-history.json",
  "unusual-log.json",
  "flow-explanations.json",
  "volume-flags.json",
  "volume-history.json",
  "oi-tracker.json",
  "oi-history.json",
  "ai-usage.json",
  "chart-pattern-cache.json",
]);

// True when the given data/-relative key requires a session. Free otherwise.
// NOTE: grades.json (the all-tickers grade index) is deliberately FREE — the
// "Grade a ticker" tool (and its grade-any-ticker search) is a free feature.
export function isPremiumKey(key) {
  if (!key || typeof key !== "string") return false;
  return PREMIUM_KEYS.has(key);
}

export { PREMIUM_KEYS };

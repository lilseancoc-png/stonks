// Freemium tiering — which data/ keys require a Discord-role session.
//
// The site is a freemium product: most tabs (Grade, Calendar, Heatmap, 13F,
// Bonds & USD, Fear & Greed, Overnight, Streaks, Strategies, the reference
// pages) are FREE and their data/*.json serve to anyone; a handful of premium
// tabs (Top Picks, Briefs, Narratives, Earnings Calls, Unusual Flow, Volume,
// Gamma Exposure) are gated behind a valid session and so are the data files
// that back them.
// A THIRD, stricter tier (ROLE_RESTRICTED_KEYS) gates data behind a SPECIFIC
// Discord role on top of premium — a plain premium session is not enough.
// Two role claims exist: `tr` (the Track Record tab's files) and `tp` (the
// Top Picks tab's files); api/data checks the claim named for the key.
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
// - picks*, stock-picks (the shares-only Stock Picks tab), regime-history,
//   briefs, trends*, unusual*, volume-flags/-history,
//   oi-tracker/-history, flow-explanations, grades-history/-daily,
//   index-calendar (the SPY/QQQ/IWM monthly daily-return calendar) back the
//   premium tabs.
// - ai-usage / chart-pattern-cache / pick-thesis-cache / ticker-judgment-cache
//   are internal bookkeeping, never browser-facing (the picks' thesis prose
//   ships inside picks.json; the cached news takes ship inside the per-ticker
//   files). They're gated for good measure so the store can't be scraped
//   through the API.
const PREMIUM_KEYS = new Set([
  "manifest.json",
  "market-analysis.json",
  "stock-picks.json",
  "picks.json",
  "picks-accuracy.json",
  "picks-open.json",
  "picks-changes.json",
  "picks-roster.json",
  "regime-history.json",
  "index-calendar.json",
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
  // Earnings-call transcript AI briefs (the Earnings calls tab): the index of
  // covered names + headlines. The per-ticker detail files live under the
  // transcript- prefix, gated by PREMIUM_PREFIXES below.
  "earnings-calls.json",
  // The Event Spillover Matrix (docs/event-spillover.md): the pair matrix +
  // the forward-validation log behind the premium Event Spillover tab.
  "spillover-pairs.json",
  "spillover-log.json",
  // The shared Top Picks watchlist (written by api/watchlist.js). It stores full
  // pick objects snapshotted server-side from the tp-restricted picks.json, so it
  // must be gated exactly like picks.json — otherwise GET /data/picks-watchlist.json
  // takes the FREE branch and leaks the role-hidden roster (edge-cached) to anyone.
  "picks-watchlist.json",
  "ai-usage.json",
  "chart-pattern-cache.json",
  "pick-thesis-cache.json",
  "ticker-judgment-cache.json",
]);

// Premium key-name prefixes — for per-ticker key families too numerous to
// enumerate. Anything starting with a listed prefix is premium. (iv-history/
// is deliberately NOT here — per-ticker IV history is free like the per-ticker
// chain files.)
// - transcript- — the per-ticker earnings-call AI briefs
//   (data/transcript-<SYM>.json) behind the premium Earnings calls tab. FLAT
//   keys, not a subdirectory: Vercel's non-Next router matches a bracketed
//   api segment to exactly one path segment, so api/data/[...path].js never
//   receives nested paths like /data/transcripts/MSFT.json.
// - transcripts/ — the retired subdirectory form of the same keys (first-day
//   objects, delete-staled by the bake); kept gated so orphans can't leak.
const PREMIUM_PREFIXES = ["transcript-", "transcripts/"];

// True when the given data/-relative key requires a session. Free otherwise.
// NOTE: grades.json (the all-tickers grade index) is deliberately FREE — the
// "Grade a ticker" tool (and its grade-any-ticker search) is a free feature.
export function isPremiumKey(key) {
  if (!key || typeof key !== "string") return false;
  if (PREMIUM_KEYS.has(key)) return true;
  return PREMIUM_PREFIXES.some((p) => key.startsWith(p));
}

// Role-restricted = the STRICTER second tier on top of premium. A premium
// session is not enough — it must ALSO carry the session claim named here
// (api/data checks session[claim]). Two claims:
// - `tr` (DISCORD_TRACKRECORD_ROLE_ID(S)) — the Track Record tab's exclusive
//   files: the win-rate scorecard, the in/out churn log, the Top-10 roster,
//   the whole-universe grade-move log.
// - `tp` (DISCORD_TOPPICKS_ROLE_ID(S)) — the Top Picks tab's files: the roster
//   itself (picks.json) and the open-position marks its "since it appeared"
//   chip reads (picks-open.json). The Market Analysis tab does NOT depend on
//   these: its regime read ships in the separate, premium-but-NOT-role-
//   restricted market-analysis.json.
//
// INVARIANT: every key here MUST stay a strict subset of PREMIUM_KEYS. The
// `private, no-store` header + the session path in api/data only fire on the
// premium branch, so a role-restricted key that wasn't also premium would take
// the FREE branch (public, s-maxage) and edge-cache/leak. Keep both in sync.
const ROLE_RESTRICTED_KEYS = new Map([
  ["picks-accuracy.json", "tr"],
  ["picks-changes.json", "tr"],
  ["picks-roster.json", "tr"],
  ["grades-history.json", "tr"],
  ["picks.json", "tp"],
  ["picks-open.json", "tp"],
  // Same tp tier as picks.json — it holds snapshots of those pick objects.
  ["picks-watchlist.json", "tp"],
]);

// True when the key additionally requires a specific role claim (not just any
// premium session). Enforced in api/data on top of the premium check.
export function isRoleRestrictedKey(key) {
  if (!key || typeof key !== "string") return false;
  return ROLE_RESTRICTED_KEYS.has(key);
}

// The session claim ("tr" | "tp") the key requires, or null when it only needs
// a plain premium session.
export function roleClaimForKey(key) {
  if (!key || typeof key !== "string") return null;
  return ROLE_RESTRICTED_KEYS.get(key) || null;
}

export { PREMIUM_KEYS, ROLE_RESTRICTED_KEYS };

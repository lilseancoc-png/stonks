// Freemium tiering — which data/ keys require a Discord-role session.
//
// The site now separates general research from internal actionable tools.
// Ordinary premium covers the non-directional Earnings Tracker. Anything that
// selects a security, assigns direction,
// grades a contract, proposes structure/timing/levels, or supports sizing is
// an Owner key and requires BOTH role claims (`tr` + `tp`).
//
// This module is the SINGLE source of truth for that split, shared by the Edge
// middleware (the /data/* rewrite) and the Node api/data reader (the tiered
// enforcement). Keep it dependency-free + Edge-safe (no node:* imports).
//
// Keys are data/-relative pathnames exactly as stored (e.g. "picks.json",
// "manifest.json"). Anything NOT listed here is free.

// Premium = served only to a valid Discord-role session.
// - manifest.json carries Owner narratives, sector overviews, and flow context.
//   The public macro/fear-greed/backdrop/spots/headlines half lives in
//   manifest-free.json.
// - picks*, stock-picks (the shares-only Stock Picks tab), sector-rotation* (the
//   quality-company rebound desk + its raw model-entry ledger), regime-history,
//   briefs, earnings-tracker, iv-trending, streaks,
//   unusual*, volume-flags/-history,
//   oi-tracker/-history, flow-explanations, and grades-history/-daily back the
//   internal Owner tabs.
// - ai-usage / chart-pattern-cache / pick-thesis-cache / ticker-judgment-cache
//   are internal bookkeeping, never browser-facing (the picks' thesis prose
//   ships inside picks.json; the cached news takes ship inside the per-ticker
//   files). They're gated for good measure so the store can't be scraped
//   through the API.
const PREMIUM_KEYS = new Set([
  "manifest.json",
  "trends.json",
  "trends-history.json",
  "market-analysis.json",
  // Bake-owned FINRA short-interest + delayed ATS sidecar. The public per-
  // ticker files expose their own short-interest fundamentals, while the ATS
  // context is consumed by the premium Flow/OI scanners.
  "market-structure.json",
  "stock-picks.json",
  "sector-rotation.json",
  // Raw accumulating observation/entry/outcome ledger. The browser gets only
  // its derived projection inside sector-rotation.json; unlisted keys default
  // FREE, so this must remain explicitly gated to the same premium tier.
  "sector-rotation-log.json",
  "picks.json",
  "grades.json",
  "picks-accuracy.json",
  "picks-open.json",
  "picks-changes.json",
  "picks-roster.json",
  "regime-history.json",
  "grades-history.json",
  "grades-daily.json",
  "briefs.json",
  "index-calendar.json",
  "earnings-tracker.json",
  "iv-trending.json",
  "streaks.json",
  "unusual.json",
  "unusual-history.json",
  "unusual-log.json",
  "flow-explanations.json",
  "volume-flags.json",
  "volume-history.json",
  "oi-tracker.json",
  "oi-history.json",
  // The Event Spillover Matrix (docs/event-spillover.md): the pair matrix +
  // the forward-validation log behind the Owner Event Spillover tab.
  "spillover-pairs.json",
  "spillover-log.json",
  // Quant Lab (docs/quant-lab.md): the deterministic sigma / VRP / pairs /
  // surface / dispersion screens + their small per-day accumulator, behind
  // the premium Quant Lab tab.
  "quant.json",
  "quant-history.json",
  // Owner-only intraday paper engine inside Quant Lab. The current decision
  // snapshot and its full two-book ledger are both additionally role-restricted
  // below; listing them here first preserves private/no-store semantics.
  "day-trading.json",
  "day-trading-history.json",
  // Leveraged ETFs (the daily-reset leverage screen — the grade index mapped
  // onto listed single-stock 2× / sector-index 3× products) behind the premium
  // Leveraged ETFs tab. Premium but NOT role-restricted, same as stock-picks.
  // The -log file is the tab's accumulating track record — the payload embeds
  // its derived scoreboard, but the raw log must not leak through the free
  // branch (unlisted keys default FREE), so it is gated to the same tier.
  "leveraged-etfs.json",
  "leveraged-etfs-log.json",
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

// Premium key-name prefixes for future per-ticker families. Earnings-call
// transcript briefs are deliberately absent because Earnings Calls is free.
const PREMIUM_PREFIXES = ["iv-history/"];

// Per-ticker baked files contain the full contract grader, recommendation,
// entry-timing, fundamentals, technicals, and AI judgment. Uppercase filenames
// distinguish them from the named lower-case research payloads.
const TICKER_DATA_KEY_RE = /^[A-Z0-9.^=-]+\.json$/;

// True when the given data/-relative key requires a session. Free otherwise.
// NOTE: grades.json is Owner-only because it powers named-security conviction
// and contract grading. news-feed.json remains deliberately FREE: it contains linked public
// headline metadata + deterministic triage labels, never premium Brief prose.
export function isPremiumKey(key) {
  if (!key || typeof key !== "string") return false;
  if (PREMIUM_KEYS.has(key)) return true;
  if (TICKER_DATA_KEY_RE.test(key)) return true;
  return PREMIUM_PREFIXES.some((p) => key.startsWith(p));
}

// These are the only stored premium research payloads available to an ordinary
// member. Every other premium key is internal Owner data by default.
const MEMBER_PREMIUM_KEYS = new Set([
  "earnings-tracker.json",
]);
const OWNER_ROLE_CLAIMS = Object.freeze(["tr", "tp"]);
const ROLE_RESTRICTED_KEYS = new Map(
  [...PREMIUM_KEYS]
    .filter((key) => !MEMBER_PREMIUM_KEYS.has(key))
    .map((key) => [key, OWNER_ROLE_CLAIMS]),
);

function isOwnerPatternKey(key) {
  return TICKER_DATA_KEY_RE.test(key) || PREMIUM_PREFIXES.some((p) => key.startsWith(p));
}

// True when the key additionally requires a specific role claim (not just any
// premium session). Enforced in api/data on top of the premium check.
export function isRoleRestrictedKey(key) {
  if (!key || typeof key !== "string") return false;
  return ROLE_RESTRICTED_KEYS.has(key) || isOwnerPatternKey(key);
}

// The session claim ("tr" | "tp"), or an array of claims when every listed
// claim is required. Null means the key only needs a plain premium session.
export function roleClaimForKey(key) {
  if (!key || typeof key !== "string") return null;
  return ROLE_RESTRICTED_KEYS.get(key) || (isOwnerPatternKey(key) ? OWNER_ROLE_CLAIMS : null);
}

export { MEMBER_PREMIUM_KEYS, OWNER_ROLE_CLAIMS, PREMIUM_KEYS, ROLE_RESTRICTED_KEYS };

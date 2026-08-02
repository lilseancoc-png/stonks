// Private-data classification — which data/ keys require an Owner session.
//
// This module is the SINGLE source of truth for that split, shared by the Edge
// data router and the Node api/data reader. Keep it dependency-free + Edge-safe.
//
// Most research remains public and needs no login. The five owner idea/record
// tabs, Owner Lab, their accumulating state/shared watchlist, and internal
// bookkeeping stay private. Keys are data/-relative pathnames exactly as stored.
const PREMIUM_KEYS = new Set([
  // Owner idea desks and their accumulating state.
  "picks.json",
  "picks-open.json",
  // Retired 0DTE roster/record objects can still survive in the private store;
  // keep them Owner-only until they are explicitly deleted from that store.
  "picks-0dte.json",
  "picks-0dte-accuracy.json",
  "auto-picks.json",
  "stock-picks.json",
  "sector-rotation.json",
  "sector-rotation-log.json",
  "leveraged-etfs.json",
  "leveraged-etfs-log.json",
  // Owner Track Record and its supporting churn / grade-history sidecars.
  "picks-accuracy.json",
  "picks-changes.json",
  "picks-roster.json",
  "grades-history.json",
  "grades-daily.json",
  // Owner Lab and its accumulating research/paper-engine state.
  "quant.json",
  "quant-history.json",
  "day-trading.json",
  "day-trading-history.json",
  // Retired paper-engine names are absent from R2 but remain denylisted for a
  // fallback store or stale seed.
  "day-trades.json",
  "day-trades-history.json",
  // One shared list for the owners; public visitors use per-browser storage.
  "picks-watchlist.json",
  // Internal pipeline caches/accounting; never browser-facing.
  "ai-usage.json",
  "chart-pattern-cache.json",
  "pick-thesis-cache.json",
  "ticker-judgment-cache.json",
]);

// Legacy export name retained because the data-response boundary imports it.
// True only for Owner/internal keys; every other valid JSON key is public.
export function isPremiumKey(key) {
  if (!key || typeof key !== "string") return false;
  return PREMIUM_KEYS.has(key);
}

// There is no ordinary member/premium tier anymore.
const MEMBER_PREMIUM_KEYS = new Set();
const OWNER_ROLE_CLAIMS = Object.freeze(["tr", "tp"]);
const ROLE_RESTRICTED_KEYS = new Map(
  [...PREMIUM_KEYS]
    .map((key) => [key, OWNER_ROLE_CLAIMS]),
);

// Enforced in api/data on top of the private-key check.
export function isRoleRestrictedKey(key) {
  if (!key || typeof key !== "string") return false;
  return ROLE_RESTRICTED_KEYS.has(key);
}

// Every private key requires both signed compatibility claims. The verified
// Top Picks owner role is the sole Discord entitlement and mints both.
export function roleClaimForKey(key) {
  if (!key || typeof key !== "string") return null;
  return ROLE_RESTRICTED_KEYS.get(key) || null;
}

export { MEMBER_PREMIUM_KEYS, OWNER_ROLE_CLAIMS, PREMIUM_KEYS, ROLE_RESTRICTED_KEYS };

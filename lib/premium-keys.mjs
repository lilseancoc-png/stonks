// Private-data classification — which data/ keys require an Owner session.
//
// This module is the SINGLE source of truth for that split, shared by the Edge
// data router and the Node api/data reader. Keep it dependency-free + Edge-safe.
//
// Everything supporting the public site is free and needs no login. Only the
// actual Owner Lab, its paper engine/shared watchlist, and internal bookkeeping
// stay private. Keys are data/-relative pathnames exactly as stored.
const PREMIUM_KEYS = new Set([
  // Owner Lab and its accumulating research/paper-engine state.
  "quant.json",
  "quant-history.json",
  "day-trading.json",
  "day-trading-history.json",
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

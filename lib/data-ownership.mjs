// Single source of truth for private-store key ownership. Both the sync
// boundary and the publish-time freshness verifier import this module so a
// newly-added data file cannot be validated under one ownership model and
// uploaded under another.

export const UNUSUAL_EXCLUSIVE_KEYS = Object.freeze([
  "unusual.json",
  "unusual-history.json",
  "unusual-log.json",
  "volume-flags.json",
  "volume-history.json",
  "flow-explanations.json",
]);

export const OI_EXCLUSIVE_KEYS = Object.freeze([
  "oi-tracker.json",
  "oi-history.json",
]);

export const SEARCH_INTEREST_EXCLUSIVE_KEYS = Object.freeze([
  "search-interest.json",
  "ram-prices.json",
  "accelerator-prices.json",
]);

// Retired private payloads remain outside bake ownership until they are purged
// from every store generation. Otherwise a normal bake could re-publish a
// hydrated copy after the feature and its producer have been removed.
export const RETIRED_PRIVATE_KEYS = Object.freeze([
  "day-trading.json",
  "day-trading-history.json",
]);

export const UNUSUAL_SHARED_KEYS = Object.freeze([
  "heatmap.json",
  "market-analysis.json",
  "ai-usage.json",
  "manifest.json",
  "manifest-free.json",
]);

export const OI_SHARED_KEYS = Object.freeze([
  "manifest.json",
  "manifest-free.json",
]);

// The full bake re-mints the rolling brief during the regular session. The
// 08:30 ET Brief-only route co-owns these two read-modify-write payloads so it
// can publish the morning read without uploading any other bake-owned data.
export const BRIEF_SHARED_KEYS = Object.freeze([
  "briefs.json",
  "ai-usage.json",
]);

// Every non-bake workflow owner accepted by sync-data. Keep the CLI boundary
// on this shared list so a newly-routed producer cannot mint paid output and
// then fail only when it tries to publish.
export const SCANNER_OWNERS = Object.freeze([
  "unusual",
  "oi",
  "brief",
  "search-interest",
]);

export const SCANNER_EXCLUSIVE_KEYS = new Set([
  ...UNUSUAL_EXCLUSIVE_KEYS,
  ...OI_EXCLUSIVE_KEYS,
  ...SEARCH_INTEREST_EXCLUSIVE_KEYS,
  ...RETIRED_PRIVATE_KEYS,
]);

export const REQUEST_TIME_EXCLUSIVE_KEYS = new Set([
  "picks-watchlist.json",
]);

export function isTickerDataKey(key) {
  return /^[A-Z0-9.]+\.json$/.test(key);
}

// Remote transcript detail objects are deliberately upsert-only. The full
// bake rewrites only newly discovered calls; older details remain referenced
// by earnings-calls.json but are not rehydrated after data/ is wiped.
export function isRetainedRemoteBakeKey(key) {
  return /^transcript-[A-Z0-9.]+\.json$/.test(key);
}

export function isDynamicBakeKey(key) {
  return isTickerDataKey(key) || key.startsWith("iv-history/") || key.startsWith("transcripts/");
}

export function isBakeOwnedKey(key) {
  return !SCANNER_EXCLUSIVE_KEYS.has(key) && !REQUEST_TIME_EXCLUSIVE_KEYS.has(key);
}

export function keysForScannerOwner(owner) {
  if (owner === "unusual") return [...UNUSUAL_EXCLUSIVE_KEYS, ...UNUSUAL_SHARED_KEYS];
  if (owner === "oi") return [...OI_EXCLUSIVE_KEYS, ...OI_SHARED_KEYS];
  if (owner === "brief") return [...BRIEF_SHARED_KEYS];
  if (owner === "search-interest") return [...SEARCH_INTEREST_EXCLUSIVE_KEYS];
  throw new Error(`unknown scanner owner: ${owner}`);
}

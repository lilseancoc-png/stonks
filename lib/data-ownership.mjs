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

export const SCANNER_EXCLUSIVE_KEYS = new Set([
  ...UNUSUAL_EXCLUSIVE_KEYS,
  ...OI_EXCLUSIVE_KEYS,
  ...SEARCH_INTEREST_EXCLUSIVE_KEYS,
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
  if (owner === "search-interest") return [...SEARCH_INTEREST_EXCLUSIVE_KEYS];
  throw new Error(`unknown scanner owner: ${owner}`);
}

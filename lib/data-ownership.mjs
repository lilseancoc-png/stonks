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

// The pre-open overnight call (scripts/overnight-preopen.mjs, ~09:00-09:25 ET).
// The bake reads it and folds it into the bake-owned overnight-log.json, but
// never pushes it, so a later pre-open run is never overwritten by a bake that
// pulled an older copy.
export const OVERNIGHT_EXCLUSIVE_KEYS = Object.freeze([
  "overnight-preopen.json",
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

// The 09:00 / 19:00 ET transcript jobs mint new call briefs. The full bake
// rewrites earnings-calls.json as carry-forward after its wipe and must not
// spend Gemini; it still pushes that index. Details stay upsert-only.
export const TRANSCRIPT_SHARED_KEYS = Object.freeze([
  "earnings-calls.json",
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
  "transcripts",
  "overnight",
]);

export const SCANNER_EXCLUSIVE_KEYS = new Set([
  ...UNUSUAL_EXCLUSIVE_KEYS,
  ...OI_EXCLUSIVE_KEYS,
  ...SEARCH_INTEREST_EXCLUSIVE_KEYS,
  ...OVERNIGHT_EXCLUSIVE_KEYS,
  ...RETIRED_PRIVATE_KEYS,
]);

export const REQUEST_TIME_EXCLUSIVE_KEYS = new Set([
  "picks-watchlist.json",
  // The Owner's uploaded paper/real trade log (api/auth/[action].js
  // "picks-fills"); written only on an upload, never by a workflow.
  "picks-fills.json",
  // The Webull paper mirror's trade log (api/auth/[action].js
  // "webull-mirror"); written only by the mirror, never by a workflow.
  "webull-paper-ledger.json",
]);

// Bake-owned score list. Written on a Top Picks decision run. LEAPS_SCORE=0
// leaves the prior file in place. Not scanner-exclusive and not request-time,
// so isBakeOwnedKey stays true.
export const OPTIONAL_BAKE_KEYS = Object.freeze([
  "leaps-picks.json",
  // First deployment can land between decision windows. Later off-cadence
  // bakes restore the exact prior decision rather than relabeling it current.
  "unified-signal.json",
  // Existing non-fatal writer may leave this absent when bottom history fails.
  "bottom-tracker.json",
]);
// Owner-only LEAPS paper book. Not scanner-exclusive and not request-time, so
// isBakeOwnedKey is true and the bake may publish it. The bake writes the key
// only when a LEAPS picks list is non-empty; an empty list leaves it untouched.
// Access stays Owner-only via lib/premium-keys.mjs (never a public payload).
export const LEAPS_PAPER_KEY = "leaps-paper.json";

export function isTickerDataKey(key) {
  return /^[A-Z0-9.]+\.json$/.test(key);
}

// Remote transcript detail objects are deliberately upsert-only. The full
// bake rewrites only newly discovered calls; older details remain referenced
// by earnings-calls.json but are not rehydrated after data/ is wiped.
export function isRetainedRemoteBakeKey(key) {
  return /^transcript-[A-Z0-9.]+\.json$/.test(key) || isEarningsForecastArchiveKey(key);
}

export function isEarningsForecastKey(key) {
  return typeof key === 'string' && (key === 'earnings-forecast.json' || key === 'earnings-forecast-state.json' || key.startsWith('earnings-forecast/'));
}
export function isEarningsForecastArchiveKey(key) {
  return typeof key === 'string' && /^earnings-forecast\/(sources|observations|runs)\/[a-f0-9]{64}\.json$/.test(key);
}

// Dated AI-rejection records accumulate for good. The bake writes today's
// ai-rejections/YYYY-MM-DD.json plus ai-rejections-latest.json and is their
// owner. They are intentionally not dynamic: push delete-stales only dynamic
// keys, and a bake that loaded a firstSeen window must not drop older dates.
// ai-rejection-scorecard.json is matched for privacy (Owner-only) but is
// backtest-local: it is NOT bake-owned, and no pusher owns or uploads it.

export function isAiRejectionKey(key) {
  return key === "ai-rejections-latest.json"
    || key === "ai-rejection-scorecard.json"
    || /^ai-rejections\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
}

// Dated evidence records accumulate for good. The bake writes today's
// evidence/YYYY-MM-DD.json plus evidence-latest.json and is their owner.
// They are intentionally not dynamic: push delete-stales only dynamic keys,
// and a bake that loaded the last 60 days must not drop older dates.
export function isEvidenceRecordKey(key) {
  return key === "evidence-latest.json" || /^evidence\/\d{4}-\d{2}-\d{2}\.json$/.test(key);
}

export const UNIFIED_SIGNAL_KEY = "unified-signal.json";
export function isUnifiedSignalArchiveKey(key) {
  return typeof key === "string" && /^signal-decisions\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{16}\.json$/.test(key);
}
// Gate the entire namespace, including malformed or future archive names.
export function isUnifiedSignalKey(key) {
  return key === UNIFIED_SIGNAL_KEY || (typeof key === "string" && key.startsWith("signal-decisions/"));
}

// One file per tracked symbol, rewritten by the bake. Adding a prefix here is
// the publication policy: the freshness check allows that symbol's file and
// push may delete a symbol that left the universe. A prefix the bake writes
// but does not list here is held out of the upload instead of failing the run.
export const PER_SYMBOL_HISTORY_PREFIXES = Object.freeze([
  "iv-history/",
  "fundamentals-history/",
]);

// Retired nested objects. Push still delete-stales them. A local copy has no
// publication policy and must fail the bake rather than be uploaded.
export const DELETE_STALE_ONLY_PREFIXES = Object.freeze([
  "transcripts/",
]);

export function perSymbolHistorySymbol(key) {
  for (const prefix of PER_SYMBOL_HISTORY_PREFIXES) {
    if (!key.startsWith(prefix)) continue;
    const match = /^([A-Z0-9.]+)\.json$/.exec(key.slice(prefix.length));
    if (match) return match[1];
  }
  return null;
}

export function isDeleteStaleOnlyKey(key) {
  return DELETE_STALE_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isDynamicBakeKey(key) {
  return isTickerDataKey(key) || perSymbolHistorySymbol(key) != null || isDeleteStaleOnlyKey(key);
}

// Keys the bake push will upload. Held-back keys stay on disk, so a later
// delete-stale pass does not remove a prior published copy, but they are not
// part of this generation's updates.
export function bakeKeysToPublish(localKeys, heldKeys = []) {
  const held = heldKeys instanceof Set ? heldKeys : new Set(heldKeys || []);
  return (localKeys || []).filter((key) => isBakeOwnedKey(key) && !held.has(key));
}

// Rewritten by every full bake. It stays out of the scanner and request-time
// exclusive sets, so isBakeOwnedKey treats it as bake-owned.
export const BAKE_LINK_MAP_KEY = "link-map.json";

export function isBakeOwnedKey(key) {
  if (isLocalOnlyKey(key)) return false;
  return !SCANNER_EXCLUSIVE_KEYS.has(key) && !REQUEST_TIME_EXCLUSIVE_KEYS.has(key);
}

// Runner-local outputs that no sync-data pusher owns or uploads (e.g. a
// backtest artifact). Add a key here to keep it out of push --owner=bake AND
// seed. Owner-only/premium keys are NOT local-only: they still publish.
// The rejection scorecard is also Owner-gated in premium-keys.mjs. seed's
// owner-key check fails if this key leaves the set or would be served public.
export const AI_REJECTION_SCORECARD_KEY = "ai-rejection-scorecard.json";
export const LOCAL_ONLY_KEYS = new Set([AI_REJECTION_SCORECARD_KEY]);

export function isLocalOnlyKey(key) {
  return LOCAL_ONLY_KEYS.has(key);
}

// seed overlays every local key except request-time state (owned by live user
// actions) and runner-local outputs. Premium/Owner-only keys still seed.
export function isSeedableKey(key) {
  return !REQUEST_TIME_EXCLUSIVE_KEYS.has(key) && !isLocalOnlyKey(key);
}

export function keysForScannerOwner(owner) {
  if (owner === "unusual") return [...UNUSUAL_EXCLUSIVE_KEYS, ...UNUSUAL_SHARED_KEYS];
  if (owner === "oi") return [...OI_EXCLUSIVE_KEYS, ...OI_SHARED_KEYS];
  if (owner === "brief") return [...BRIEF_SHARED_KEYS];
  if (owner === "transcripts") return [...TRANSCRIPT_SHARED_KEYS];
  if (owner === "search-interest") return [...SEARCH_INTEREST_EXCLUSIVE_KEYS];
  if (owner === "overnight") return [...OVERNIGHT_EXCLUSIVE_KEYS];
  throw new Error(`unknown scanner owner: ${owner}`);
}

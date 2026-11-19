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

// The pre-open overnight call (scripts/overnight-preopen.mjs, ~09:00-09:10 ET).
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
  // The hourly heat-map refresh also re-marks the wide tier's public file
  // (lib/wide-tier.mjs refreshWideIntraday); the bake rewrites it.
  "wide-tier.json",
  "market-analysis.json",
  "ai-usage.json",
  "ai-cost-history.json",
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
  "ai-cost-history.json",
]);

// The 09:00 / 19:00 ET transcript jobs mint new call briefs. The full bake
// rewrites earnings-calls.json as carry-forward after its wipe and must not
// spend Gemini; it still pushes that index. Details stay upsert-only.
export const TRANSCRIPT_SHARED_KEYS = Object.freeze([
  "earnings-calls.json",
  "ai-usage.json",
  "ai-cost-history.json",
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
  "top-picks-approval.json",
  // Owner-only report exclusions. Never applied to engine or broker state.
  "track-record-reset.json",
  "webull-track-record-reset.json",
  "picks-watchlist.json",
  // The Owner's stock watchlist (api/auth/[action].js "owner-watchlist");
  // written only when the Owner stars or unstars a stock.
  "owner-watchlist.json",
  // The Owner's Top Picks market mode (api/auth/[action].js "top-picks-mode",
  // lib/top-picks-mode.mjs); written only when the Owner flips the switch.
  // The bake reads its hydrated copy before the wipe and never pushes it.
  "top-picks-mode.json",
  // The Owner controls (api/auth/[action].js "owner-controls",
  // lib/owner-controls.mjs): Stop new trades, Avoid, Watch closely, catalysts
  // and the risk dial. The bake reads its hydrated copy before the wipe and
  // never pushes it; the Webull mirror reads the store copy every run.
  "owner-controls.json",
  // The Owner's self-tuning approvals, declines, undo and restore clicks on
  // the Owner Lab Loop tab (api/auth/[action].js "picks-loop",
  // lib/self-loop/tune.mjs). The bake reads its hydrated copy before the wipe
  // and never pushes it.
  "picks-loop-control.json",
  // The Owner Settings page (api/auth/[action].js "owner-settings",
  // lib/owner-settings.mjs). The bake's settings preload reads its hydrated
  // copy and never pushes it.
  "owner-settings.json",
  // The Owner's uploaded paper/real trade log (api/auth/[action].js
  // "picks-fills"); written only on an upload, never by a workflow.
  "picks-fills.json",
  // The Webull paper mirror's trade log (api/auth/[action].js
  // "webull-mirror"); written only by the mirror, never by a workflow.
  "webull-paper-ledger.json",
  // The Owner's AI disruption review decisions (api/auth/[action].js
  // "ai-disruption-review", lib/ai-disruption/review.mjs): confirm, fix or
  // reject a launch row. The bake reads its hydrated copy before the wipe and
  // never pushes it.
  "ai-disruption-review.json",
  // The Webull data logs (W3, lib/webull-data/): capital flow, market
  // breadth and the backups, written only by the Vercel webull-data runner.
  // The bake reads its hydrated copies before the wipe and never pushes them.
  "webull-flow.json",
  "webull-breadth.json",
  "webull-backup.json",
]);

// Bake-owned score list. Written on a Top Picks decision run. LEAPS_SCORE=0
// leaves the prior file in place. Not scanner-exclusive and not request-time,
// so isBakeOwnedKey stays true.
export const OPTIONAL_BAKE_KEYS = Object.freeze([
  "owner-market-brief.json",
  "top-picks-market-study.json",
  "leaps-picks.json",
  // First deployment can land between decision windows. Later off-cadence
  // bakes restore the exact prior decision rather than relabeling it current.
  "unified-signal.json",
  // Existing non-fatal writer may leave this absent when bottom history fails.
  "bottom-tracker.json",
  // New-view sidecars (2026-11-07, writeNewViewFiles in build.mjs). Each
  // writer is non-fatal, so a failed one may leave its key absent.
  "market-map.json",
  "site-changes.json",
  // Crowd & positioning (2026-11-09, lib/crowd/): one public and one Owner
  // key, each written by a non-fatal step after the picks file.
  "crowd.json",
  "crowd-owner.json",
  // Prediction market odds (lib/prediction/, 2026-11-15): one public, one
  // Owner and one internal state key, written by a non-fatal step after the
  // picks file; PREDICTION_TRACKER=0 or a failed run keeps the prior files.
  "prediction-odds.json",
  "prediction-odds-owner.json",
  "prediction-odds-state.json",
  // AI disruption tracker (lib/ai-disruption/, Phase 1 2026-11-16): the
  // public launch log, the Owner review queue and the internal collector
  // state, written by a non-fatal step after the picks file; AI_DISRUPTION=0
  // or a failed run keeps the prior files.
  "ai-disruption.json",
  "ai-disruption-owner.json",
  "ai-disruption-state.json",
  // Policy and news data (lib/policy-news/, 2026-11-19): one Owner key, read
  // before the wipe and written after it; FEDERAL_REGISTER=0 / GDELT_NEWS=0
  // or a failed read keeps the prior file. The first bake after deploy
  // creates it.
  "policy-news.json",
  // Booms & busts (lib/history-rhymes.mjs, 2026-11-12): one public and one
  // Owner key, written by a non-fatal step (the last good pair is kept on a
  // failure; the first bake after deploy creates them).
  "history-rhymes.json",
  "history-rhymes-owner.json",
  // The Webull backup report (W3, lib/webull-data/bake.mjs): Owner-only,
  // written by a non-fatal step, so a failed bake may leave it absent.
  "webull-backup-check.json",
  // Engine history on the site (lib/engines-history.mjs, 2026-11-17): public
  // aggregates of the 1971-2026 engine history test plus today's market cell.
  // Non-fatal writer; ENGINES_HISTORY=0 writes the off stub.
  "engines-history.json",
  // Wide tier (lib/wide-tier.mjs, 2026-11-19): the public heat-map file and
  // the private bar store. Non-fatal writer; a failure keeps the prior pair,
  // WIDE_TIER=0 writes the off stub and keeps the store.
  "wide-tier.json",
  "wide-tier-state.json",
  // Corporate structure (lib/corporate-structure/, 2026-11-12): the SEC
  // collector cache behind the stock page's Leadership tab (private; the
  // public read rides each data/<SYM>.json). Read before the wipe; a failed
  // or switched-off collection keeps the prior copy.
  "corporate-structure.json",
  // Treasury auction results (lib/treasury-auctions.mjs, 2026-11-08): one
  // Fiscal Data read per ET day, public, non-fatal writer.
  "treasury-auctions.json",
  "market-days.json",
  "market-days-briefs.json",
  // Outcome rows / random control book and the evidence board (2026-11-08).
  // Both writers are non-fatal; the first bake after deploy creates them.
  "picks-outcomes.json",
  "evidence-board.json",
  // Regime Lab labels, shadow books, oracle and catalog (2026-11-09).
  // Non-fatal writer; REGIME_LAB=0 leaves the prior file in place.
  "regime-lab.json",
  // Self-improving loop state + view (lib/self-loop/, 2026-11-09). Non-fatal
  // writer; LOOP=0 leaves the prior files in place.
  "picks-loop-state.json",
  "picks-loop.json",
  // Quant labs page file + internal state (lib/labs/, 2026-11-16). Non-fatal
  // writer; QUANT_LABS=0 leaves the prior files in place.
  "quant-labs.json",
  "quant-labs-state.json",
  // Valuation lab inputs (lib/valuation-lab.mjs, 2026-11-17). Non-fatal
  // writer; VALUATION_LAB=0 leaves the prior file in place.
  "valuation-lab.json",
  // Strategy engines (lib/engines/, 2026-11-15): record, learning state and
  // page file. Non-fatal writer; a build that cannot read them writes none,
  // so the stored copies stay as they are. ENGINES=0 carries them forward.
  "engines-record.json",
  "engines-state.json",
  "engines.json",
  // Long daily AI cost ledger, written with ai-usage.json (lib/ai-cost-history.mjs).
  "ai-cost-history.json",
  // Data source health (lib/source-health.mjs): non-fatal writer at the end of the bake.
  "source-health.json",
  // Peer valuation band (lib/valuation-band.mjs, 2026-11-08): public, non-fatal writer.
  "valuation-bands.json",
  // What the bake took from the Owner Settings page (lib/owner-settings.mjs,
  // 2026-11-10). Owner-only; written only when the build ran with the settings
  // preload. Unlisted until 2026-11-16, so every build held it back.
  "owner-settings-applied.json",
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

// Top Picks run archive (lib/picks-run-archive.mjs): one flat Owner-only file
// per ET trading day holding every decision run's full candidate list. Flat,
// not nested, so a signed-in Owner can read it at /data/picks-run-<date>.json
// (the api/data route serves one path segment only). The keys are bake-owned
// and not dynamic, so push never delete-stales an older day; hydration opens
// only today's file for the bake.
export function isPicksRunArchiveKey(key) {
  return typeof key === "string" && /^picks-run-\d{4}-\d{2}-\d{2}\.json$/.test(key);
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

// Current SEC ownership parts and their explicitly retained reader-grace set
// are written by the bake. Parts absent after that grace must leave the next
// logical manifest so the normal generation collector can reclaim them.
export const OWNERSHIP_BOOK_PREFIX = "13f-books/";
export const OWNERSHIP_RETENTION_MAX_HOURS = 26;
export function isOwnershipBookKey(key) {
  return typeof key === 'string' && /^13f-books\/(summary|disclosures)-[a-f0-9]{24}\.json$/.test(key);
}
export function ownershipPartReferences(payload, now = new Date()) {
  const keys = new Set();
  const add = key => { if (isOwnershipBookKey(key)) keys.add(key); };
  for (const f of Object.values(payload?.perFirm || {})) {
    for (const key of Array.isArray(f?.holdingsParts) ? f.holdingsParts : []) add(key);
    // A hydrated root has the disclosure references from its summary parts.
    for (const row of Array.isArray(f?.holdings) ? f.holdings : []) add(row?.disclosurePart);
  }
  const ms = new Date(now).getTime();
  for (const row of Array.isArray(payload?.ownershipRetainedParts) ? payload.ownershipRetainedParts : []) {
    if (Date.parse(row?.expiresAtIso) > ms) add(row?.key);
  }
  return [...keys];
}

export function isDynamicBakeKey(key) {
  return isTickerDataKey(key) || perSymbolHistorySymbol(key) != null || isDeleteStaleOnlyKey(key) || isOwnershipBookKey(key);
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

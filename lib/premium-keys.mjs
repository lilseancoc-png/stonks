// Private-data classification — which data/ keys require an Owner session.
//
// This module is the SINGLE source of truth for that split, shared by the Edge
// data router and the Node api/data reader. Keep it dependency-free + Edge-safe.
//
// Most research remains public and needs no login. The Owner analysis,
// idea/record tabs, Owner Lab, their accumulating state/shared watchlist, and
// internal bookkeeping stay private. Keys are data/-relative pathnames exactly
// as stored.
// data-ownership.mjs is itself import-free and Edge-safe; it owns the matcher.
import { AI_REJECTION_SCORECARD_KEY, isAiRejectionKey, isEvidenceRecordKey, isUnifiedSignalKey } from "./data-ownership.mjs";

const RETIRED_KEYS = new Set([
  "day-trading.json",
  "day-trading-history.json",
]);

// Link map is Owner-only. Flip this one line to serve link-map.json on the
// public cache path. In PREMIUM_KEYS it also gets ROLE_RESTRICTED_KEYS'
// Owner claims (derived below), so no separate role check is needed.
export const LINK_MAP_OWNER_ONLY = true;

const PREMIUM_KEYS = new Set([
  // Owner cross-asset tape, scenario tree and regime history.
  "market-analysis.json",
  "unified-signal.json",
  // Owner bottom-stage read and its false-positive history.
  "bottom-tracker.json",
  "historical-data.json",
  "historical-source-history.json",
  // Owner idea desks and their accumulating state.
  "picks.json",
  "picks-open.json",
  // LEAPS list. Owner-only the same way as the other idea desks: isPremiumKey,
  // isRoleRestrictedKey, and roleClaimForKey all follow PREMIUM_KEYS.
  "leaps-picks.json",
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
  "grade-research.json",
  // LEAPS paper book. Written only when a LEAPS picks list exists; still never public.
  "leaps-paper.json",
  "picks-changes.json",
  "picks-roster.json",
  "grades-history.json",
  // Daily grade totals are the same public number as grades.json, saved once
  // per ET day so a return window can show the average grade over that window.
  // Owner Lab and its accumulating research state.
  "quant.json",
  "quant-history.json",
  // Retired Day Trading payloads are hard-404ed by data-response, and remain
  // private here as defense in depth for old store generations and adapters.
  ...RETIRED_KEYS,
  // Retired paper-engine names are absent from R2 but remain denylisted for a
  // fallback store or stale seed.
  "day-trades.json",
  "day-trades-history.json",
  // One shared list for the owners; public visitors use per-browser storage.
  "picks-watchlist.json",
  // The Owner's uploaded paper/real fills for the Track Record comparison.
  "picks-fills.json",
  // The Webull paper mirror's trade log (lib/webull-mirror.mjs).
  "webull-paper-ledger.json",
  // Internal pipeline caches/accounting; never browser-facing.
  "ai-usage.json",
  // Retired 2026-10-19 with the AI chart-pattern read; kept private because
  // the last copy may still sit in the store.
  "chart-pattern-cache.json",
  "pick-thesis-cache.json",
  "ticker-judgment-cache.json",
  "news-source-evidence.json",
  // Backtest scorecard. LOCAL_ONLY_KEYS keeps sync from publishing it. This
  // entry still gates a stale store object, including if the rejection flag
  // below is turned off.
  AI_REJECTION_SCORECARD_KEY,
  ...(LINK_MAP_OWNER_ONLY ? ["link-map.json"] : []),
]);

// Dated AI-rejection records are Owner-only. Flip this one line to serve the
// day files and latest pointer on the public cache path. The scorecard stays
// in PREMIUM_KEYS above. The matcher lives in data-ownership.mjs.
const AI_REJECTIONS_OWNER_ONLY = true;

// Dated evidence records are Owner-only. Flip this one line to serve them
// on the public cache path (isPremiumKey false, no role claim).
const EVIDENCE_OWNER_ONLY = true;

// Legacy export name retained because the data-response boundary imports it.
// True only for Owner/internal keys; every other valid JSON key is public.
export function isPremiumKey(key) {
  if (!key || typeof key !== "string") return false;
  if (isUnifiedSignalKey(key)) return true;
  if (AI_REJECTIONS_OWNER_ONLY && isAiRejectionKey(key)) return true;
  if (EVIDENCE_OWNER_ONLY && isEvidenceRecordKey(key)) return true;
  return PREMIUM_KEYS.has(key);
}

export function isRetiredKey(key) {
  if (!key || typeof key !== "string") return false;
  return RETIRED_KEYS.has(key);
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
  if (isUnifiedSignalKey(key)) return true;
  if (AI_REJECTIONS_OWNER_ONLY && isAiRejectionKey(key)) return true;
  if (EVIDENCE_OWNER_ONLY && isEvidenceRecordKey(key)) return true;
  return ROLE_RESTRICTED_KEYS.has(key);
}

// Every private key requires both signed compatibility claims. The verified
// Top Picks owner role is the sole Discord entitlement and mints both.
export function roleClaimForKey(key) {
  if (!key || typeof key !== "string") return null;
  if (isUnifiedSignalKey(key)) return OWNER_ROLE_CLAIMS;
  if (AI_REJECTIONS_OWNER_ONLY && isAiRejectionKey(key)) return OWNER_ROLE_CLAIMS;
  if (EVIDENCE_OWNER_ONLY && isEvidenceRecordKey(key)) return OWNER_ROLE_CLAIMS;
  return ROLE_RESTRICTED_KEYS.get(key) || null;
}

export { MEMBER_PREMIUM_KEYS, OWNER_ROLE_CLAIMS, PREMIUM_KEYS, RETIRED_KEYS, ROLE_RESTRICTED_KEYS };

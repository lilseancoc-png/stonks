// Public-payload sanitization at the final response boundary.
//
// Stored objects can outlive a code deploy, so generator changes alone are not
// enough for an access-policy cutover. This module strips retired Owner fields
// from otherwise-public objects immediately, before they can enter the public
// edge cache. Keep it dependency-free and deterministic.

export const BRIEF_ACCESS_POLICY_VERSION = 1;

const PUBLIC_TICKER_KEY_RE = /^[A-Z][A-Z0-9.-]*\.json$/;

export function sanitizePublicJsonText(key, text) {
  const ticker = PUBLIC_TICKER_KEY_RE.test(key || "");
  const brief = key === "briefs.json";
  const regimeHistory = key === "regime-history.json";
  if (!ticker && !brief && !regimeHistory) return null;

  const source = String(text);
  // After the first split-aware bake, large ticker files take the zero-parse
  // fast path. The exact JSON property token is absent from their payload.
  if (ticker && !source.includes('"autoPick"')) return null;

  const payload = JSON.parse(source);
  let changed = false;

  // The exact Top-Picks contract candidate used to ride every otherwise-public
  // ticker chain. It now lives in the Owner-only auto-picks.json sidecar.
  if (ticker && payload && typeof payload === "object" && "autoPick" in payload) {
    delete payload.autoPick;
    changed = true;
  }

  // AI prose and deterministic blocks can both mention Owner rosters. A legacy
  // policy version is therefore removed whole rather than scrubbed piecemeal.
  if (brief && payload && typeof payload === "object") {
    if (payload.current?.accessPolicyVersion !== BRIEF_ACCESS_POLICY_VERSION) {
      if ("current" in payload) delete payload.current;
      changed = true;
    }
    // Retired payload shape; never let an old store object bypass the version.
    for (const legacyKey of ["morning", "afternoon"]) {
      if (legacyKey in payload) {
        delete payload[legacyKey];
        changed = true;
      }
    }
  }

  // Market-regime history stays public, but historical Top-Picks direction and
  // counts do not. Strip both known legacy shapes from every carried day.
  if (regimeHistory && payload && Array.isArray(payload.days)) {
    payload.days = payload.days.map((day) => {
      if (!day || typeof day !== "object") return day;
      if (!("lean" in day) && !("picks" in day)) return day;
      const { lean: _lean, picks: _picks, ...publicDay } = day;
      changed = true;
      return publicDay;
    });
  }

  return changed ? JSON.stringify(payload) : null;
}

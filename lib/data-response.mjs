// Shared tiered data response used by both api/data/* and the authenticated
// data mode on api/auth/me. Keeping validation, role checks, cache policy, and
// store access here prevents the compatibility route from drifting away from
// lib/premium-keys.mjs (the authorization source of truth).

import { store } from "./datastore.mjs";
import { getSession } from "./session.mjs";
import { isPremiumKey, roleClaimForKey } from "./premium-keys.mjs";

// JSON-only, no traversal: the cheap allowlist defense for store keys.
export const DATA_KEY_RE = /^[A-Za-z0-9_./-]+\.json$/;

export async function serveDataKey(req, res, rawKey) {
  // Start every branch uncacheable. The only exception is a successful free
  // key, where the public cache policy is set immediately before the response.
  res.setHeader("Cache-Control", "no-store");

  if (process.env.PRIVATE_DATA_ENABLED !== "1") {
    return res.status(404).json({ error: "not found" });
  }

  const key = typeof rawKey === "string" ? rawKey : "";
  if (!key || key.includes("..") || !DATA_KEY_RE.test(key) || key.startsWith("/")) {
    return res.status(400).json({ error: "bad key" });
  }

  const premium = isPremiumKey(key);
  const roleClaim = roleClaimForKey(key);
  if (premium) {
    res.setHeader("Cache-Control", "private, no-store");
    const session = await getSession(req).catch(() => null);
    if (!session) return res.status(401).json({ error: "auth required" });
    // Single-claim keys preserve the established legacy-session behavior: only
    // an explicit false denies. Multi-claim keys are deliberately stricter and
    // require every claim to be explicitly true (Quant Lab requires tr + tp).
    const roleClaims = Array.isArray(roleClaim) ? roleClaim : roleClaim ? [roleClaim] : [];
    const missingRole = Array.isArray(roleClaim)
      ? roleClaims.some((claim) => session[claim] !== true)
      : roleClaims.some((claim) => session[claim] === false);
    if (missingRole) {
      return res.status(401).json({ error: "role required" });
    }
  }

  try {
    const buf = await store.get(key);
    if (buf == null) return res.status(404).json({ error: "not found" });
    if (!premium) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=120, stale-while-revalidate=600",
      );
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    return res.end(buf);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    console.error("data read failed", { key, message: String(err?.message || err) });
    return res.status(502).json({ error: "data unavailable" });
  }
}

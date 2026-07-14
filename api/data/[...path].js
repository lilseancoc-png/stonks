// Vercel serverless function: tiered read of a private data/ artifact.
//
// The data/*.json no longer ship as public static files — they live in a
// private blob store (lib/datastore.mjs) and are streamed from here. The site
// is FREEMIUM: free keys (per-ticker chains, calendar, heatmap, 13F, macro,
// fear-greed, correlations, grades index, …) stream to anyone and are edge-
// cacheable; PREMIUM keys (picks, briefs, narratives/unusual manifest, volume,
// OI, track-record histories — see lib/premium-keys.mjs) stream ONLY to a holder
// of a valid Discord-role session and are never shared-cacheable. The browser
// still calls fetch('data/<x>.json'); middleware.js rewrites /data/* to this
// function when the gate is on. See docs/private-data-migration.md §4.4.
//
// Activation is behind PRIVATE_DATA_ENABLED: until it's "1" this endpoint is a
// hard 404 (so a seeded store can't leak before the gate is live), and the site
// keeps serving the committed static data/ files unchanged.

import { store } from "../../lib/datastore.mjs";
import { getSession } from "../../lib/session.mjs";
import { isPremiumKey, roleClaimForKey } from "../../lib/premium-keys.mjs";

// json-only, no traversal — the cheap-allowlist defense for the store key.
const KEY_RE = /^[A-Za-z0-9_./-]+\.json$/;

export default async function handler(req, res) {
  // Gate disabled → endpoint does not exist (no unauthenticated store reads).
  if (process.env.PRIVATE_DATA_ENABLED !== "1") {
    return res.status(404).json({ error: "not found" });
  }

  // Derive the store key from the request URL PATH only. This function is reached
  // TWO ways — directly (/api/data/<key>) or via middleware's rewrite of
  // /data/<key> — and the pathname reflects the actual resource in both. We do
  // NOT read req.query.path: a client-supplied `?path=` query would otherwise
  // override which file is served (/data/A.json?path=B.json → serves B), and on a
  // middleware rewrite Vercel doesn't populate the catch-all param anyway.
  let key = "";
  try {
    // URL() normalizes any ".." away; then strip the route prefix + any leading
    // slashes so the key is a clean store pathname.
    const pathname = new URL(req.url, "http://localhost").pathname;
    key = decodeURIComponent(pathname.replace(/^\/(?:api\/data|data)\//, "")).replace(/^\/+/, "");
  } catch (_) {
    key = "";
  }
  if (!key || key.includes("..") || !KEY_RE.test(key) || key.startsWith("/")) {
    return res.status(400).json({ error: "bad key" });
  }

  const premium = isPremiumKey(key);
  const roleClaim = roleClaimForKey(key); // "tr" (Track Record) | "tp" (Top Picks) | null
  if (premium) {
    // Premium: never shared-cacheable, and only for a valid Discord-role session.
    // (Set no-store FIRST, before any auth branch, so a 401 is never edge-cached
    // or replayed across users.)
    res.setHeader("Cache-Control", "private, no-store");
    const session = await getSession(req).catch(() => null);
    if (!session) {
      return res.status(401).json({ error: "auth required" });
    }
    // Stricter tier: some keys also require a specific role claim (`tr` for the
    // Track Record files, `tp` for the Top Picks files), minted from the user's
    // Discord roles in api/auth. Use `=== false` (not `!== true`): a legacy
    // session minted before the claim existed, and an env-unset deploy (where
    // the claim is minted true), both PASS — fail-open for back-compat; we 401
    // only when mint explicitly set the claim false (a member who does NOT hold
    // the configured role).
    if (roleClaim && session[roleClaim] === false) {
      return res.status(401).json({ error: "role required" });
    }
  }
  // Note: the free-tier public cache header is set ONLY on the success path
  // below — a 404 (key not yet seeded / mid-sync) or a 502 (store hiccup) must
  // NOT inherit `s-maxage`, or the CDN would edge-cache the error and replay it
  // to every user for minutes after the data is already back.

  try {
    const buf = await store.get(key);
    if (buf == null) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "not found" });
    }
    if (!premium) {
      // Free: open to anyone and safe to edge-cache briefly (the data changes at
      // most a few times an hour, and there's nothing per-user in it).
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

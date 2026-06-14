// Vercel serverless function: gated read of a private data/ artifact.
//
// The premium data/*.json no longer ship as public static files — they live in
// a private blob store (lib/datastore.mjs) and are streamed from here ONLY to a
// holder of a valid Discord-role session. The browser still calls
// fetch('data/<x>.json'); middleware.js rewrites /data/* to this function when
// the gate is on. See docs/private-data-migration.md §4.4.
//
// Activation is behind PRIVATE_DATA_ENABLED: until it's "1" this endpoint is a
// hard 404 (so a seeded store can't leak before the gate is live), and the site
// keeps serving the committed static data/ files unchanged.

import { store } from "../../lib/datastore.mjs";
import { getSession } from "../../lib/session.mjs";

// json-only, no traversal — the cheap-allowlist defense for the store key.
const KEY_RE = /^[A-Za-z0-9_./-]+\.json$/;

export default async function handler(req, res) {
  // Gate disabled → endpoint does not exist (no unauthenticated store reads).
  if (process.env.PRIVATE_DATA_ENABLED !== "1") {
    return res.status(404).json({ error: "not found" });
  }

  // Build the store key from the catch-all segments (array of path parts).
  const segs = req.query?.path;
  const key = Array.isArray(segs) ? segs.join("/") : String(segs || "");
  if (!key || key.includes("..") || !KEY_RE.test(key)) {
    return res.status(400).json({ error: "bad key" });
  }

  // Gated content is never shared-cacheable.
  res.setHeader("Cache-Control", "private, no-store");

  // Require a valid Discord-role session.
  const session = await getSession(req).catch(() => null);
  if (!session) {
    return res.status(401).json({ error: "auth required" });
  }

  try {
    const buf = await store.get(key);
    if (buf == null) return res.status(404).json({ error: "not found" });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    return res.end(buf);
  } catch (err) {
    console.error("data read failed", { key, message: String(err?.message || err) });
    return res.status(502).json({ error: "data unavailable" });
  }
}

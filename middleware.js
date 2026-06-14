// Vercel Edge Middleware — the freemium data router (docs/private-data-migration.md §4.5).
//
// The site is freemium: the app shell, the live /api/* proxies, and the FREE
// data/*.json are open to anyone; the PREMIUM data files are gated. The split
// itself is enforced per-key inside the Node api/data reader (lib/premium-keys),
// so this Edge layer only has ONE job when the gate is on: rewrite every
// /data/* request to that gated store-reader (the private blob store isn't
// directly servable). Free vs. premium, session checks, and cache headers are
// all decided downstream in api/data.
//
// ACTIVATION: behind PRIVATE_DATA_ENABLED. Until it's "1" this is a pass-through
// no-op (the committed static data/ files serve as before) — the cutover is a
// single env flip.
//
// Edge runtime: zero imports beyond @vercel/edge, so it stays Edge-trivial.

import { next, rewrite } from "@vercel/edge";

export const config = {
  // Only /data/* needs the rewrite; everything else (shell, assets, live api,
  // the self-gating /api/data + /api/auth) passes straight through.
  matcher: ["/data/:path*"],
};

export default function middleware(req) {
  // Inert unless explicitly enabled — flag off = today's static behavior.
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return next();

  const url = new URL(req.url);
  const path = url.pathname;

  // Rewrite /data/* -> the gated store-reader, which tiers free vs. premium and
  // requires a session only for premium keys.
  if (path.startsWith("/data/")) {
    const target = new URL("/api/data/" + path.slice("/data/".length), url.origin);
    target.search = url.search;
    return rewrite(target);
  }
  return next();
}

// Vercel Edge Middleware — private-store data router.
//
// The app and all public research are free. When private-store mode is active,
// /data/* is routed through the store reader; that reader only requires an
// Owner session for the small Owner Lab/internal key set.
//
// ACTIVATION: behind PRIVATE_DATA_ENABLED. Until it's "1" this is a pass-through
// no-op (the committed static data/ files serve as before) — the cutover is a
// single env flip.
//
// Edge runtime: zero imports beyond @vercel/edge, so it stays Edge-trivial.

import { next } from "@vercel/edge";

export const config = {
  matcher: ["/data/:path*"],
};

export default function middleware(req) {
  // Inert unless explicitly enabled — flag off = today's static behavior.
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return next();

  const url = new URL(req.url);
  const path = url.pathname;

  // Redirect legacy /data/* callers through the exact /api/auth/me function
  // proven to receive the session cookie. This repairs already-open tabs whose
  // cached app.js still uses /data/*, while the shared data-response helper
  // keeps public/Owner policy identical to /api/data.
  if (path.startsWith("/data/")) {
    const target = new URL("/api/auth/me", url.origin);
    target.search = url.search;
    target.searchParams.set("data", path.slice("/data/".length));
    return new Response(null, {
      status: 307,
      headers: {
        Location: target.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  }

  return next();
}

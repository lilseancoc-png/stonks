// Vercel Edge Middleware — the freemium data router (docs/private-data-migration.md §4.5).
//
// The site is freemium: the app shell, the live /api/* proxies, and the FREE
// data/*.json are open to anyone; the PREMIUM data files are gated. The split
// itself is enforced by the shared Node data response (lib/premium-keys),
// so this Edge layer only has ONE job when the gate is on: redirect every
// /data/* request to that gated store-reader (the private blob store isn't
// directly servable). Free vs. premium, session checks, and cache headers are
// all decided downstream in lib/data-response.mjs.
//
// ACTIVATION: behind PRIVATE_DATA_ENABLED. Until it's "1" this is a pass-through
// no-op (the committed static data/ files serve as before) — the cutover is a
// single env flip.
//
// Edge runtime: zero imports beyond @vercel/edge, so it stays Edge-trivial.

import { next } from "@vercel/edge";

export const config = {
  // /data/* needs the gated redirect; / and /index.html are matched only so a
  // first-time, logged-out visitor can be shown the "What's included" intro
  // once. Everything else (assets, live api, /api/data + /api/auth) passes
  // straight through.
  matcher: ["/", "/index.html", "/data/:path*"],
};

export default function middleware(req) {
  // Inert unless explicitly enabled — flag off = today's static behavior.
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return next();

  const url = new URL(req.url);
  const path = url.pathname;

  // Redirect legacy /data/* callers through the exact /api/auth/me function
  // proven to receive the session cookie. This repairs already-open tabs whose
  // cached app.js still uses /data/*, while the shared data-response helper
  // keeps free/premium/role policy identical to /api/data.
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

  // First-visit intro: show a logged-out visitor the "What's included"
  // (free vs premium) page ONCE before the app, then let them browse freely.
  // Skipped for:
  //   · members (a valid-looking session cookie present) — straight to the app,
  //   · returning visitors (the one-time `stonks_intro_seen` cookie is set),
  //   · deep links (`/?tab=…`) — honored as-is so shared URLs land where intended.
  // The cookie is set server-side on the redirect so it shows exactly once with
  // no JS dependency and no redirect loop. The intro lives at the in-app
  // "What's included" tab (?tab=features), which the app honors as a deep link
  // (the next() branch above) — so the redirect doesn't re-trigger itself.
  if (path === "/" || path === "/index.html") {
    if (url.search) return next();
    const cookie = req.headers.get("cookie") || "";
    const hasSession = /(?:^|;\s*)stonks_session=/.test(cookie);
    const hasSeenIntro = /(?:^|;\s*)stonks_intro_seen=/.test(cookie);
    if (hasSession || hasSeenIntro) return next();
    const dest = new URL("/?tab=features", url.origin);
    return new Response(null, {
      status: 307,
      headers: {
        Location: dest.toString(),
        "Set-Cookie": "stonks_intro_seen=1; Path=/; Max-Age=31536000; SameSite=Lax",
        "Cache-Control": "no-store",
      },
    });
  }

  return next();
}

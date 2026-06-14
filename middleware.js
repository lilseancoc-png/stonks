// Vercel Edge Middleware — the Discord-role gate (docs/private-data-migration.md §4.5).
//
// Runs before static serving on every request except the public surface
// (/api/auth/*, welcome.html, favicon, Vercel internals; /api/data/* self-gates).
// When the gate is ON it:
//   • rewrites /data/* -> the gated /api/data store-reader (which re-checks auth),
//   • requires a valid session for the app shell + the live /api/* endpoints,
//     sending document navigations to /welcome.html and 401-ing data/asset fetches.
//
// ACTIVATION: behind PRIVATE_DATA_ENABLED. Until it's "1" this is a pass-through
// no-op, so deploying it changes nothing — the cutover is a single env flip.
//
// Edge runtime: imports only lib/session.mjs (jose + TextEncoder, no node:crypto),
// so it stays Edge-compatible.

import { next, rewrite } from "@vercel/edge";
import { verifySessionToken, parseCookies, SESSION_COOKIE } from "./lib/session.mjs";

export const config = {
  matcher: ["/((?!api/auth/|api/data/|_vercel|favicon\\.svg|welcome\\.html).*)"],
};

function json401() {
  return new Response(JSON.stringify({ error: "auth required" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

export default async function middleware(req) {
  // Inert unless explicitly enabled — flag off = today's behavior, exactly.
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return next();

  const url = new URL(req.url);
  const path = url.pathname;
  const cookies = parseCookies(req.headers.get("cookie") || "");
  let session = null;
  try {
    session = await verifySessionToken(cookies[SESSION_COOKIE]);
  } catch {
    session = null;
  }

  // Premium data: rewrite /data/* -> the gated store-reader function.
  if (path.startsWith("/data/")) {
    if (!session) return json401();
    const target = new URL("/api/data/" + path.slice("/data/".length), url.origin);
    target.search = url.search;
    return rewrite(target);
  }

  if (session) return next();

  // No session: document navigations -> welcome page; everything else (data /
  // asset / api fetches) -> 401.
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html");
  if (wantsHtml) {
    return Response.redirect(new URL("/welcome.html", url.origin), 302);
  }
  return json401();
}

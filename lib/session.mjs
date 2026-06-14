// lib/session.mjs — signed session cookie + cookie helpers for the Discord-role
// gate (docs/private-data-migration.md §4.5).
//
// Imported by BOTH the Node api/auth/* handlers AND (later) the Edge
// middleware.js, so it must stay runtime-agnostic: `jose` for HS256 (works in
// Node and on the Edge runtime), and only Web-standard APIs in the exported
// helpers (TextEncoder, URLSearchParams-free, no node:crypto). The cookie
// header is a plain string in both runtimes (req.headers.cookie /
// request.headers.get("cookie")), so parse/serialize are shared.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "stonks_session";
export const STATE_COOKIE = "stonks_oauth_state";
// 12h default — this is also the role-revocation latency (a hand-removed role
// takes effect within one session lifetime). Override via SESSION_TTL_SEC.
export const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 12 * 60 * 60);

function secretKey(secret = process.env.SESSION_SECRET) {
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload, { secret, ttlSec = SESSION_TTL_SEC } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .sign(secretKey(secret));
}

// Returns the decoded payload, or null on any failure (missing/expired/forged).
export async function verifySessionToken(token, { secret } = {}) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"] });
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[k] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  s += `; Path=${opts.path || "/"}`;
  if (opts.httpOnly !== false) s += "; HttpOnly";
  if (opts.secure) s += "; Secure";
  s += `; SameSite=${opts.sameSite || "Lax"}`;
  return s;
}

// Convenience for the Node api/* handlers — reads + verifies the session from
// the request's Cookie header string. Returns the payload or null.
export async function getSession(req, { secret } = {}) {
  const cookies = parseCookies(req.headers?.cookie || "");
  return await verifySessionToken(cookies[SESSION_COOKIE], { secret });
}

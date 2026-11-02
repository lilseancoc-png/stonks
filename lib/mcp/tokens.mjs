// lib/mcp/tokens.mjs — the Mingstreet MCP's stateless OAuth artifacts.
//
// Nothing here is stored. Every artifact is a JWT keyed from SESSION_SECRET
// with a purpose label, so an MCP token can never verify as a site session
// cookie (different key) and one MCP artifact can never stand in for another
// (different key + `typ`). Bumping MCP_TOKEN_VERSION revokes every MCP token
// and client without touching site sessions; rotating SESSION_SECRET revokes
// both.
//
//   client_id     signed  (HS256)   registered redirect URIs + client name
//   consent       signed  (HS256)   one authorize request, 10 min
//   pending       signed  (HS256)   same request, rides the Discord round trip
//   code          encrypted (A256GCM) auth code: owner + PKCE + Discord refresh
//   access token  signed  (HS256)   1 h, audience = <origin>/mcp
//   refresh token encrypted (A256GCM) 30 d, carries the Discord refresh token
//                                    so every refresh re-checks the owner role

import { createHash, createHmac } from "node:crypto";
import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";

export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
export const CODE_TTL_SEC = 5 * 60;
export const CONSENT_TTL_SEC = 10 * 60;
export const OWNER_SCOPE = "mingstreet.owner";

function tokenVersion(env) {
  return String(env.MCP_TOKEN_VERSION || "1").slice(0, 32);
}

function derive(env, purpose) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw Object.assign(new Error("SESSION_SECRET is not set"), { code: "NOT_CONFIGURED" });
  return new Uint8Array(
    createHmac("sha256", secret).update(`mingstreet-mcp:${purpose}:v${tokenVersion(env)}`).digest(),
  );
}

async function sign(env, purpose, claims, { ttlSec, issuer, audience } = {}) {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ ...claims, typ: purpose }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(now);
  if (ttlSec) jwt = jwt.setExpirationTime(now + ttlSec);
  if (issuer) jwt = jwt.setIssuer(issuer);
  if (audience) jwt = jwt.setAudience(audience);
  return jwt.sign(derive(env, purpose));
}

async function verify(env, purpose, token, { issuer, audience } = {}) {
  if (typeof token !== "string" || !token || token.length > 8192) return null;
  try {
    const { payload } = await jwtVerify(token, derive(env, purpose), {
      algorithms: ["HS256"],
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    });
    return payload.typ === purpose ? payload : null;
  } catch {
    return null;
  }
}

async function seal(env, purpose, claims, ttlSec, issuer) {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ ...claims, typ: purpose })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .setIssuer(issuer)
    .encrypt(derive(env, purpose));
}

async function unseal(env, purpose, token, issuer) {
  if (typeof token !== "string" || !token || token.length > 8192) return null;
  try {
    const { payload } = await jwtDecrypt(token, derive(env, purpose), { issuer });
    return payload.typ === purpose ? payload : null;
  } catch {
    return null;
  }
}

// A short, stable, non-reversible handle for logs and token binding.
export function hashId(value) {
  return createHash("sha256").update(String(value)).digest("base64url").slice(0, 22);
}

export function pkceMatches(verifier, challenge) {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export const tokens = {
  signClient: (env, client) => sign(env, "mcp-client", client),
  verifyClient: (env, clientId) => verify(env, "mcp-client", clientId),
  signConsent: (env, request) => sign(env, "mcp-consent", { req: request }, { ttlSec: CONSENT_TTL_SEC }),
  verifyConsent: async (env, token) => (await verify(env, "mcp-consent", token))?.req || null,
  signPending: (env, request) => sign(env, "mcp-pending", { req: request }, { ttlSec: CONSENT_TTL_SEC }),
  verifyPending: async (env, token) => (await verify(env, "mcp-pending", token))?.req || null,
  sealCode: (env, issuer, claims) => seal(env, "mcp-code", claims, CODE_TTL_SEC, issuer),
  openCode: (env, issuer, code) => unseal(env, "mcp-code", code, issuer),
  sealRefresh: (env, issuer, claims) => seal(env, "mcp-refresh", claims, REFRESH_TTL_SEC, issuer),
  openRefresh: (env, issuer, token) => unseal(env, "mcp-refresh", token, issuer),
  signAccess: (env, issuer, audience, claims) => sign(env, "mcp-access", claims, { ttlSec: ACCESS_TTL_SEC, issuer, audience }),
  verifyAccess: (env, issuer, audience, token) => verify(env, "mcp-access", token, { issuer, audience }),
};

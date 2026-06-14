// Vercel serverless function: start the Discord OAuth login.
//
// Sets a short-lived CSRF `state` cookie and 302-redirects to Discord's
// authorize page with the `identify guilds.members.read` scopes — the latter
// lets the callback read the user's roles in OUR guild with their own token
// (no bot needed). See docs/private-data-migration.md §4.5.
//
// INERT until the gate (middleware) is wired up — this endpoint just exists;
// nothing forces users through it yet.

import { serializeCookie, STATE_COOKIE } from "../../lib/session.mjs";

const DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize";

function proto(req) {
  return String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
}
function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto(req)}://${host}`;
}
function randomState() {
  // Web-standard RNG (no node:crypto) — 32 hex chars.
  const b = new Uint8Array(16);
  (globalThis.crypto || require("node:crypto").webcrypto).getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export default function handler(req, res) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: "discord auth not configured" });
  }
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI || `${baseUrl(req)}/api/auth/discord-callback`;
  const state = randomState();
  const secure = proto(req) === "https";

  res.setHeader(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure, sameSite: "Lax" }),
  );
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "identify guilds.members.read",
    state,
    redirect_uri: redirectUri,
    prompt: "consent",
  });
  res.statusCode = 302;
  res.setHeader("Location", `${DISCORD_AUTHORIZE}?${params.toString()}`);
  res.end();
}

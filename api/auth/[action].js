// Vercel serverless function: Discord OAuth, consolidated.
//
// One dynamic-route function handles all four auth actions so the whole flow
// costs a SINGLE serverless slot (Vercel Hobby caps at 12). The URLs are
// unchanged — Vercel routes /api/auth/<action> here with req.query.action:
//   discord-login    -> start OAuth (redirect to Discord)
//   discord-callback -> validate, role-check, mint session  (registered redirect URI)
//   logout           -> clear session
//   me               -> report session for the "signed in as …" chip
//
// Discord auth is intentionally an INTERNAL Owner Lab mechanism. Public site
// access never requires a login; only principals holding both configured Owner
// roles can mint a session.

import { randomBytes } from "node:crypto";
import {
  serializeCookie,
  parseCookies,
  signSession,
  getSession,
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SEC,
} from "../../lib/session.mjs";

const DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const memberUrl = (guildId) => `https://discord.com/api/users/@me/guilds/${guildId}/member`;

function proto(req) {
  return String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
}
function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto(req)}://${host}`;
}
function redirect(res, location, cookies) {
  if (cookies) res.setHeader("Set-Cookie", cookies);
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}
// Union of a single role ID + an optional comma-separated list.
function parseRoleIds(single, list) {
  return new Set(
    [single, ...String(list || "").split(",")]
      .map((s) => String(s || "").trim())
      .filter(Boolean),
  );
}

export default async function handler(req, res) {
  switch (req.query?.action) {
    case "discord-login":
      return login(req, res);
    case "discord-callback":
      return callback(req, res);
    case "logout":
      return logout(req, res);
    case "me":
      return me(req, res);
    default:
      return res.status(404).json({ error: "not found" });
  }
}

// --- start OAuth -------------------------------------------------------------
function login(req, res) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: "discord auth not configured" });
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI || `${baseUrl(req)}/api/auth/discord-callback`;
  const state = randomBytes(16).toString("hex");
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

// --- OAuth callback: role-check + mint session -------------------------------
async function callback(req, res) {
  const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_GUILD_ID,
    DISCORD_TRACKRECORD_ROLE_ID,
    DISCORD_TRACKRECORD_ROLE_IDS,
    DISCORD_TOPPICKS_ROLE_ID,
    DISCORD_TOPPICKS_ROLE_IDS,
    SESSION_SECRET,
  } = process.env;
  const trackRecordRoleIds = parseRoleIds(
    DISCORD_TRACKRECORD_ROLE_ID,
    DISCORD_TRACKRECORD_ROLE_IDS,
  );
  const topPicksRoleIds = parseRoleIds(DISCORD_TOPPICKS_ROLE_ID, DISCORD_TOPPICKS_ROLE_IDS);
  const ownerRolesConfigured = trackRecordRoleIds.size > 0 && topPicksRoleIds.size > 0;
  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_GUILD_ID ||
    !ownerRolesConfigured ||
    !SESSION_SECRET
  ) {
    return res.status(503).json({ error: "owner auth not configured" });
  }

  const secure = proto(req) === "https";
  const clearState = serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure });
  const cookies = parseCookies(req.headers.cookie || "");
  const code = req.query?.code;
  const state = req.query?.state;

  // CSRF: returned state must match the one we set pre-redirect.
  if (!code || !state || !cookies[STATE_COOKIE] || state !== cookies[STATE_COOKIE]) {
    return redirect(res, "/welcome.html?denied=state", clearState);
  }

  const redirectUri =
    process.env.DISCORD_REDIRECT_URI || `${baseUrl(req)}/api/auth/discord-callback`;

  try {
    // 1) code -> access token (server-side; client secret never leaves here).
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) return redirect(res, "/welcome.html?denied=token", clearState);
    const token = await tokenRes.json();

    // 2) read the user's membership + roles in OUR guild.
    const memRes = await fetch(memberUrl(DISCORD_GUILD_ID), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (memRes.status === 404) return redirect(res, "/welcome.html?denied=guild", clearState);
    if (!memRes.ok) return redirect(res, "/welcome.html?denied=member", clearState);
    const member = await memRes.json();
    const roles = Array.isArray(member.roles) ? member.roles : [];

    // 3) INTERNAL OWNER GATE. The two settings may point at the same role,
    // but both claims must be satisfied before any session is minted.
    const hasTrackRecord = roles.some((r) => trackRecordRoleIds.has(r));
    const hasTopPicks = roles.some((r) => topPicksRoleIds.has(r));
    if (!hasTrackRecord || !hasTopPicks) {
      return redirect(res, "/welcome.html?denied=role", clearState);
    }

    // 4) mint the session cookie and enter the app. `tr`/`tp` ride inside the
    // signed (HS256, tamper-proof) JWT payload — set EXPLICITLY true/false so
    // api/data can require both claims on strict `=== true` checks.
    const user = member.user || {};
    const jwt = await signSession({
      sub: user.id || null,
      name: user.global_name || user.username || "owner",
      tr: hasTrackRecord,
      tp: hasTopPicks,
    });
    const sessionCookie = serializeCookie(SESSION_COOKIE, jwt, {
      maxAge: SESSION_TTL_SEC,
      secure,
      sameSite: "Lax",
    });
    return redirect(res, "/?tab=quant", [clearState, sessionCookie]);
  } catch (err) {
    console.error("discord-callback failed", { message: String(err?.message || err) });
    return redirect(res, "/welcome.html?denied=error", clearState);
  }
}

// --- logout ------------------------------------------------------------------
function logout(req, res) {
  const secure = proto(req) === "https";
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure }));
  res.statusCode = 302;
  res.setHeader("Location", "/welcome.html");
  res.end();
}

// --- session probe -----------------------------------------------------------
async function me(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  // Authenticated data compatibility mode. Production has delivered the
  // session cookie to this exact /api/auth/me function while a near-simultaneous
  // /api/data/* invocation received no cookie and falsely returned 401. The app
  // therefore sends store reads through this proven function when the private
  // gate is on. Import lazily so the ordinary page-boot /me probe and OAuth
  // actions do not initialize either datastore SDK. Authorization, key
  // validation, and tiered cache policy remain single-sourced in data-response.
  if (req.query?.data != null) {
    if (Array.isArray(req.query.data)) {
      return res.status(400).json({ error: "bad key" });
    }
    try {
      const { serveDataKey } = await import("../../lib/data-response.mjs");
      return await serveDataKey(req, res, req.query.data);
    } catch (err) {
      console.error("auth data route failed", { message: String(err?.message || err) });
      return res.status(502).json({ error: "data unavailable" });
    }
  }
  // `enabled` tells the client whether reads should use the private-store API.
  const enabled = process.env.PRIVATE_DATA_ENABLED === "1";
  // The pair of explicit claims is the internal Owner entitlement. Legacy or
  // malformed sessions without explicit true values fail closed and must log
  // in again after the Owner gate is deployed.
  if (!process.env.SESSION_SECRET) return res.status(200).json({ authed: false, enabled, trackRecord: false, topPicks: false });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(200).json({ authed: false, enabled, trackRecord: false, topPicks: false });
  return res.status(200).json({
    authed: true,
    enabled,
    name: session.name || null,
    sub: session.sub || null,
    trackRecord: session.tr === true,
    topPicks: session.tp === true,
  });
}

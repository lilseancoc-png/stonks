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
// Entitlement = a Discord role you assign by hand; we only READ it via
// `guilds.members.read`. See docs/private-data-migration.md §4.5.
// INERT until the gate (middleware) is wired up.

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
// Union of the legacy single role ID + an optional comma-separated list, trimmed
// and de-duped. Holding ANY one of these unlocks the gate.
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
    DISCORD_REQUIRED_ROLE_ID,
    DISCORD_REQUIRED_ROLE_IDS,
    DISCORD_TRACKRECORD_ROLE_ID,
    DISCORD_TRACKRECORD_ROLE_IDS,
    SESSION_SECRET,
  } = process.env;
  // Accept ANY of a set of role IDs so a member can be unlocked by either the
  // Discord-managed subscription role (auto-granted to paying subscribers, but
  // un-assignable by hand — even by the owner) OR a normal role you assign
  // yourself (owner/comp/trial). Sourced from the legacy single
  // DISCORD_REQUIRED_ROLE_ID plus an optional comma-separated DISCORD_REQUIRED_ROLE_IDS.
  const requiredRoleIds = parseRoleIds(DISCORD_REQUIRED_ROLE_ID, DISCORD_REQUIRED_ROLE_IDS);
  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_GUILD_ID ||
    requiredRoleIds.size === 0 ||
    !SESSION_SECRET
  ) {
    return res.status(503).json({ error: "discord auth not configured" });
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

    // 3) the gate: must hold ANY of the accepted roles.
    if (!roles.some((r) => requiredRoleIds.has(r))) {
      return redirect(res, "/welcome.html?denied=role", clearState);
    }

    // 3b) STRICTER sub-tier — the Track Record tab. Computed from the SAME role
    // list already in hand (no extra Discord fetch), reusing parseRoleIds. This
    // is NOT a gate on entering the app: a member who lacks the Track Record
    // role still gets in and keeps every other premium tab — only Track Record
    // is withheld. Back-compat: when the env var is unset (size === 0) every
    // member keeps Track Record, so the feature ships dormant until configured.
    const trackRecordRoleIds = parseRoleIds(
      DISCORD_TRACKRECORD_ROLE_ID,
      DISCORD_TRACKRECORD_ROLE_IDS,
    );
    // size === 0 fails OPEN (every member keeps Track Record) — that's the
    // intentional "ships dormant until configured" default. But a var that's
    // SET yet parses to no IDs (whitespace / stray comma / wrong value) is
    // almost certainly a fat-fingered restrict attempt that silently over-grants.
    // Surface that one case in the logs so it's distinguishable from dormant.
    if ((DISCORD_TRACKRECORD_ROLE_ID || DISCORD_TRACKRECORD_ROLE_IDS) && trackRecordRoleIds.size === 0) {
      console.warn("DISCORD_TRACKRECORD_ROLE_ID/_IDS is set but parsed to no role IDs — Track Record stays open to ALL members. Check the value.");
    }
    const hasTrackRecord =
      trackRecordRoleIds.size === 0 || roles.some((r) => trackRecordRoleIds.has(r));

    // 4) mint the session cookie and enter the app. `tr` rides inside the signed
    // (HS256, tamper-proof) JWT payload — set EXPLICITLY true/false so api/data
    // can 401 the Track Record files on `tr === false`.
    const user = member.user || {};
    const jwt = await signSession({
      sub: user.id || null,
      name: user.global_name || user.username || "member",
      tr: hasTrackRecord,
    });
    const sessionCookie = serializeCookie(SESSION_COOKIE, jwt, {
      maxAge: SESSION_TTL_SEC,
      secure,
      sameSite: "Lax",
    });
    return redirect(res, "/", [clearState, sessionCookie]);
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
  // `enabled` tells the freemium client whether the gate is live at all. When
  // it's off (legacy fully-public deploy) the client treats everyone as a
  // member and shows no locks; when it's on, only an authed session unlocks
  // the premium tabs.
  const enabled = process.env.PRIVATE_DATA_ENABLED === "1";
  // trackRecord: whether this visitor may see the Track Record tab. Fail-CLOSED
  // for the unauthed cases (logged-out / no secret → hide the tab on a gated
  // deploy); for an authed session, `session.tr !== false` so a legacy session
  // minted before the `tr` claim existed (undefined) keeps Track Record until it
  // expires — no mid-session lockout.
  if (!process.env.SESSION_SECRET) return res.status(200).json({ authed: false, enabled, trackRecord: false });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(200).json({ authed: false, enabled, trackRecord: false });
  return res.status(200).json({
    authed: true,
    enabled,
    name: session.name || null,
    sub: session.sub || null,
    trackRecord: session.tr !== false,
  });
}

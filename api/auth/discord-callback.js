// Vercel serverless function: Discord OAuth callback.
//
// Validates the CSRF state, exchanges the code for an access token, reads the
// user's membership/roles in OUR guild, and — only if they hold the required
// role — mints the signed session cookie and redirects into the app. Every
// failure path lands on /welcome.html?denied=<reason> instead of erroring.
// See docs/private-data-migration.md §4.5.

import {
  serializeCookie,
  parseCookies,
  signSession,
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SEC,
} from "../../lib/session.mjs";

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

export default async function handler(req, res) {
  const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_GUILD_ID,
    DISCORD_REQUIRED_ROLE_ID,
    SESSION_SECRET,
  } = process.env;
  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_GUILD_ID ||
    !DISCORD_REQUIRED_ROLE_ID ||
    !SESSION_SECRET
  ) {
    return res.status(503).json({ error: "discord auth not configured" });
  }

  const secure = proto(req) === "https";
  const clearState = serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure });
  const cookies = parseCookies(req.headers.cookie || "");
  const code = req.query?.code;
  const state = req.query?.state;

  // CSRF: the returned state must match the one we set pre-redirect.
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

    // 3) the gate: must hold the required role.
    if (!roles.includes(DISCORD_REQUIRED_ROLE_ID)) {
      return redirect(res, "/welcome.html?denied=role", clearState);
    }

    // 4) mint the session cookie and enter the app.
    const user = member.user || {};
    const jwt = await signSession({
      sub: user.id || null,
      name: user.global_name || user.username || "member",
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

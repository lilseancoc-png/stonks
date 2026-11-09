// lib/mcp/oauth.mjs — OAuth 2.1 for the Mingstreet MCP, layered on the
// existing Discord owner login (api/auth/[action].js).
//
// Mingstreet is both the MCP resource server and a minimal authorization
// server. It never stores anything: clients register statelessly (the
// client_id is a signed record of its redirect URIs), and codes and tokens are
// signed or encrypted JWTs (lib/mcp/tokens.mjs). The only identity provider is
// Discord, checked against the same DISCORD_TOPPICKS_ROLE_ID(S) owner role as
// the site's Owner session. Nobody without that role can obtain an MCP token.
//
// Flow (what ChatGPT / Claude / any MCP client does):
//   1. POST /mcp without a token -> 401 + WWW-Authenticate resource_metadata
//   2. GET  /.well-known/oauth-protected-resource[/mcp] -> this origin is the AS
//   3. GET  /.well-known/oauth-authorization-server     -> endpoints below
//   4. POST /oauth/register  -> signed client_id (dynamic client registration)
//   5. GET  /oauth/authorize -> Mingstreet consent page naming the client and
//      where it will send you; "Continue with Discord" -> Discord
//   6. Discord -> /api/auth/discord-callback (the already-registered redirect
//      URI) -> owner role check -> code -> client redirect_uri
//   7. POST /oauth/token (PKCE S256) -> 1 h access token + 30 d refresh token.
//      Each refresh re-checks the owner role with Discord.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseCookies, serializeCookie, STATE_COOKIE } from "../session.mjs";
import { tokens, hashId, pkceMatches, OWNER_SCOPE, ACCESS_TTL_SEC, CONSENT_TTL_SEC } from "./tokens.mjs";

export const MCP_PENDING_COOKIE = "stonks_mcp_pending";
const DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const discordMemberUrl = (guildId) => `https://discord.com/api/users/@me/guilds/${guildId}/member`;

const MAX_REDIRECT_URIS = 5;
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// ---------------------------------------------------------------------------
// shared helpers

export function mcpOrigin(req, env = process.env) {
  if (env.MCP_PUBLIC_ORIGIN) return String(env.MCP_PUBLIC_ORIGIN).replace(/\/+$/, "");
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
  const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  return `${proto}://${host}`;
}
export const mcpResource = (origin) => `${origin}/mcp`;
export const resourceMetadataUrl = (origin) => `${origin}/.well-known/oauth-protected-resource/mcp`;

export function mcpEnabled(env = process.env) {
  return env.MCP_ENABLED !== "0";
}

function ownerRoleIds(env) {
  return new Set(
    [env.DISCORD_TOPPICKS_ROLE_ID, ...String(env.DISCORD_TOPPICKS_ROLE_IDS || "").split(",")]
      .map((s) => String(s || "").trim())
      .filter(Boolean),
  );
}

export function ownerAuthConfigured(env = process.env) {
  return !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_GUILD_ID && env.SESSION_SECRET && ownerRoleIds(env).size);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "600");
}

function oauthError(res, status, error, description) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(res, status, title, bodyHtml) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.statusCode = status;
  return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#111827;--muted:#4b5563;--line:#e5e7eb;--accent:#5865f2}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#141a24;--fg:#e5e7eb;--muted:#9ca3af;--line:#263041}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:480px;margin:8vh auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p,li{color:var(--muted)}code{word-break:break-all;color:var(--fg)}ul{padding-left:20px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a.btn{display:inline-block;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600}
a.primary{background:var(--accent);color:#fff}a.secondary{border:1px solid var(--line);color:var(--fg)}
</style></head><body><main><div class="card">${bodyHtml}</div></main></body></html>`);
}

function redirectWith(res, redirectUri, params, cookies) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  if (cookies) res.setHeader("Set-Cookie", cookies);
  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.setHeader("Cache-Control", "no-store");
  return res.end();
}

// RFC 8707 resource indicator: this server's /mcp URL or its origin. A
// trailing slash is tolerated (some clients normalize URLs that way).
function resourceAllowed(raw, origin) {
  if (raw == null || raw === "") return true;
  if (typeof raw !== "string") return false;
  const r = raw.replace(/\/+$/, "");
  return r === mcpResource(origin) || r === origin;
}

// HTTP Basic client credentials (client_secret_basic). Some clients also send
// a public client's id this way with an empty secret.
function basicCredentials(req) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(req.headers?.authorization || ""));
  if (!m) return { id: "", secret: "" };
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const i = raw.indexOf(":");
    return { id: decodeURIComponent(i >= 0 ? raw.slice(0, i) : raw), secret: i >= 0 ? decodeURIComponent(raw.slice(i + 1)) : "" };
  } catch {
    return { id: "", secret: "" };
  }
}

// Clients that insist on being confidential (client_secret_post / _basic)
// get a secret derived from their signed client_id, so registration stays
// stateless. PKCE is still required either way; the secret is an extra check.
const SECRET_METHODS = new Set(["client_secret_post", "client_secret_basic"]);
export function clientSecretFor(env, clientId) {
  return createHmac("sha256", String(env.SESSION_SECRET || "")).update("mcp-client-secret:" + clientId).digest("base64url");
}
function secretMatches(env, clientId, secret) {
  const want = Buffer.from(clientSecretFor(env, clientId));
  const got = Buffer.from(String(secret || ""));
  return got.length === want.length && timingSafeEqual(got, want);
}

function readBody(req) {
  let b;
  try { b = req.body; } catch { return {}; } // Vercel's getter throws on bad JSON
  if (Buffer.isBuffer(b)) b = b.toString("utf8");
  if (b && typeof b === "object" && !Array.isArray(b)) return b;
  if (typeof b === "string") {
    try {
      const trimmed = b.trim();
      if (trimmed.startsWith("{")) return JSON.parse(trimmed);
      return Object.fromEntries(new URLSearchParams(trimmed));
    } catch {
      return {};
    }
  }
  return {};
}

export function validateRedirectUri(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 512) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || BLOCKED_SCHEMES.has(u.protocol) || u.username || u.password) return false;
  if (u.protocol === "https:") return !!u.hostname;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  // Private-use schemes for native apps (RFC 8252 §7.1), e.g. cursor://...
  return /^[a-z][a-z0-9+.-]{1,40}:$/.test(u.protocol);
}

// ---------------------------------------------------------------------------
// Discord (shared with the token refresh path)

export async function discordOwnerCheck(accessToken, env, fetchImpl = fetch) {
  const r = await fetchImpl(discordMemberUrl(env.DISCORD_GUILD_ID), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return { ok: false, reason: r.status === 404 ? "guild" : "member" };
  const member = await r.json();
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const ids = ownerRoleIds(env);
  if (!roles.some((role) => ids.has(role))) return { ok: false, reason: "role" };
  const user = member.user || {};
  if (!user.id) return { ok: false, reason: "member" };
  return { ok: true, user: { id: String(user.id), name: user.global_name || user.username || "owner" } };
}

async function discordRefresh(refreshToken, env, fetchImpl = fetch) {
  const r = await fetchImpl(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) return null;
  const t = await r.json();
  return t?.access_token ? t : null;
}

// ---------------------------------------------------------------------------
// metadata

export function protectedResourceMetadata(req, res, { env = process.env } = {}) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!mcpEnabled(env)) return res.status(404).json({ error: "not found" });
  const origin = mcpOrigin(req, env);
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OWNER_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Mingstreet research",
    resource_documentation: `${origin}/?tab=home`,
  });
}

export function authorizationServerMetadata(req, res, { env = process.env } = {}) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!mcpEnabled(env)) return res.status(404).json({ error: "not found" });
  const origin = mcpOrigin(req, env);
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [OWNER_SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/?tab=home`,
  });
}

// ---------------------------------------------------------------------------
// /oauth/register — stateless dynamic client registration (RFC 7591)

export async function register(req, res, { env = process.env } = {}) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!mcpEnabled(env)) return res.status(404).json({ error: "not found" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return oauthError(res, 405, "invalid_request", "POST required");
  }
  if (!env.SESSION_SECRET) return oauthError(res, 503, "temporarily_unavailable", "Owner sign-in is not configured");
  const body = readBody(req);
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REDIRECT_URIS || !uris.every(validateRedirectUri)) {
    return oauthError(res, 400, "invalid_redirect_uri", "Give 1-5 redirect URIs: https, http on localhost, or an app scheme; no fragments");
  }
  const clientName = String(body.client_name || "MCP client").replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "MCP client";
  const issuedAt = Math.floor(Date.now() / 1000);
  const clientId = await tokens.signClient(env, { ru: [...new Set(uris)], cn: clientName });
  const method = SECRET_METHODS.has(body.token_endpoint_auth_method) ? body.token_endpoint_auth_method : "none";
  res.setHeader("Cache-Control", "no-store");
  return res.status(201).json({
    client_id: clientId,
    client_id_issued_at: issuedAt,
    ...(method === "none" ? {} : { client_secret: clientSecretFor(env, clientId), client_secret_expires_at: 0 }),
    client_name: clientName,
    redirect_uris: [...new Set(uris)],
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: OWNER_SCOPE,
  });
}

// ---------------------------------------------------------------------------
// /oauth/authorize — consent page, then Discord

async function parseAuthorizeRequest(q, env, origin) {
  const fail = (message) => ({ error: message });
  const clientId = typeof q.client_id === "string" ? q.client_id : "";
  const client = await tokens.verifyClient(env, clientId);
  if (!client || !Array.isArray(client.ru)) return fail("This app is not registered with Mingstreet. Remove the connector and add it again.");
  let redirectUri = typeof q.redirect_uri === "string" ? q.redirect_uri : "";
  if (!redirectUri && client.ru.length === 1) redirectUri = client.ru[0];
  if (!client.ru.includes(redirectUri)) return fail("The app asked to send you to an address it did not register.");
  // Registration is open, so a redirect URI proves nothing about who owns it.
  // Malformed requests get an error page here instead of a redirect, so this
  // endpoint can't be used as an open redirector before the owner consents.
  const state = typeof q.state === "string" ? q.state.slice(0, 1024) : "";
  if (q.response_type !== "code") return fail("The app sent an unsupported request (response_type must be code).");
  if (q.code_challenge_method !== "S256" || typeof q.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) {
    return fail("The app did not use PKCE (S256), which Mingstreet requires.");
  }
  if (!resourceAllowed(q.resource, origin)) {
    return fail("The app asked for access to a different server.");
  }
  return {
    request: {
      cid: hashId(clientId),
      cn: client.cn || "MCP client",
      ruri: redirectUri,
      cc: q.code_challenge,
      st: state,
      sc: OWNER_SCOPE,
    },
  };
}

export async function authorize(req, res, { env = process.env } = {}) {
  if (!mcpEnabled(env)) return res.status(404).json({ error: "not found" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!ownerAuthConfigured(env)) return page(res, 503, "Sign-in unavailable", "<h1>Sign-in unavailable</h1><p>Mingstreet owner sign-in is not configured on this deployment.</p>");
  const origin = mcpOrigin(req, env);
  const q = req.query || {};

  // Step 2: the owner pressed "Continue with Discord" on the consent page.
  if (typeof q.consent === "string") {
    const request = await tokens.verifyConsent(env, q.consent);
    if (!request) return page(res, 400, "Link expired", "<h1>This sign-in link expired</h1><p>Go back to your AI app and connect Mingstreet again.</p>");
    const secure = origin.startsWith("https://");
    const state = randomBytes(16).toString("hex");
    // The pending record is bound to this Discord state, so a later ordinary
    // site login can never be answered as this MCP authorization.
    const pending = await tokens.signPending(env, { ...request, ds: state });
    res.setHeader("Set-Cookie", [
      serializeCookie(STATE_COOKIE, state, { maxAge: CONSENT_TTL_SEC, secure, sameSite: "Lax" }),
      serializeCookie(MCP_PENDING_COOKIE, pending, { maxAge: CONSENT_TTL_SEC, secure, sameSite: "Lax" }),
    ]);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.DISCORD_CLIENT_ID,
      scope: "identify guilds.members.read",
      state,
      redirect_uri: env.DISCORD_REDIRECT_URI || `${origin}/api/auth/discord-callback`,
      prompt: "consent",
    });
    res.statusCode = 302;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Location", `${DISCORD_AUTHORIZE}?${params.toString()}`);
    return res.end();
  }

  // Step 1: validate the client's request and show who is asking.
  const parsed = await parseAuthorizeRequest(q, env, origin);
  if (parsed.error) return page(res, 400, "Can't connect", `<h1>Can't connect this app</h1><p>${escapeHtml(parsed.error)}</p>`);
  const { request } = parsed;
  const consent = await tokens.signConsent(env, request);
  let destination = request.ruri;
  try {
    const u = new URL(request.ruri);
    destination = u.protocol === "https:" || u.protocol === "http:" ? u.host : u.protocol + "//" + u.host;
  } catch { /* validated at registration */ }
  const cancel = new URL(request.ruri);
  cancel.searchParams.set("error", "access_denied");
  if (request.st) cancel.searchParams.set("state", request.st);
  cancel.searchParams.set("iss", origin);
  return page(res, 200, "Connect to Mingstreet", `
<h1>Connect “${escapeHtml(request.cn)}” to Mingstreet?</h1>
<p>After you sign in with Discord as the Mingstreet owner, this app gets <b>read-only</b> access to the site's research for one hour at a time, renewed while your owner role stays active.</p>
<ul>
<li>It can read public pages <b>and Owner-only desks</b>: Top Picks, the track record, Unified Signal, Market and Risk analysis, Earnings Forecast and the rest.</li>
<li>What it reads goes into that app's chat, so its provider sees it.</li>
<li>It can't trade, change anything, or read Webull, uploaded fills or secrets.</li>
</ul>
<p>You'll be sent back to <code>${escapeHtml(destination)}</code>.</p>
<p>Only continue if you started this from your own AI app.</p>
<div class="row"><a class="btn primary" href="/oauth/authorize?consent=${encodeURIComponent(consent)}">Continue with Discord</a>
<a class="btn secondary" href="${escapeHtml(cancel.toString())}">Cancel</a></div>`);
}

// Called by the Discord callback after the owner role check succeeded. Returns
// true when this login belonged to an MCP authorization (and was answered).
export async function completeMcpAuthorization(req, res, { discordToken, user, env = process.env, clearCookies = [] }) {
  const cookies = parseCookies(req.headers?.cookie || "");
  const pendingToken = cookies[MCP_PENDING_COOKIE];
  if (!pendingToken) return false;
  const origin = mcpOrigin(req, env);
  const secure = origin.startsWith("https://");
  const clear = [...clearCookies, serializeCookie(MCP_PENDING_COOKIE, "", { maxAge: 0, secure })];
  const request = await tokens.verifyPending(env, pendingToken);
  if (request && request.ds !== req.query?.state) return false;
  if (!request || !mcpEnabled(env)) {
    res.setHeader("Set-Cookie", clear);
    page(res, 400, "Link expired", "<h1>This sign-in expired</h1><p>Go back to your AI app and connect Mingstreet again.</p>");
    return true;
  }
  const code = await tokens.sealCode(env, origin, {
    sub: user.id,
    nm: user.name,
    cid: request.cid,
    ruri: request.ruri,
    cc: request.cc,
    sc: request.sc,
    dr: discordToken?.refresh_token || null,
  });
  redirectWith(res, request.ruri, { code, state: request.st, iss: origin }, clear);
  console.log(JSON.stringify({ evt: "mcp.authorize", sub: hashId(user.id), client: request.cid }));
  return true;
}

// ---------------------------------------------------------------------------
// /oauth/token

async function issueTokens(env, origin, { sub, nm, cid, sc, dr }) {
  const access = await tokens.signAccess(env, origin, mcpResource(origin), { sub, nm, cid, scope: sc });
  const refresh = await tokens.sealRefresh(env, origin, { sub, nm, cid, sc, dr });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope: sc };
}

export async function token(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!mcpEnabled(env)) return res.status(404).json({ error: "not found" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return oauthError(res, 405, "invalid_request", "POST required");
  }
  if (!ownerAuthConfigured(env)) return oauthError(res, 503, "temporarily_unavailable", "Owner sign-in is not configured");
  const origin = mcpOrigin(req, env);
  const body = readBody(req);
  const basic = basicCredentials(req);
  const clientId = typeof body.client_id === "string" && body.client_id ? body.client_id : basic.id;
  if (!(await tokens.verifyClient(env, clientId))) return oauthError(res, 401, "invalid_client", "Unknown client");
  // A presented secret must be the one issued at registration; a public
  // client sends none and relies on PKCE alone.
  const secret = typeof body.client_secret === "string" && body.client_secret ? body.client_secret : basic.id === clientId ? basic.secret : "";
  if (secret && !secretMatches(env, clientId, secret)) return oauthError(res, 401, "invalid_client", "Client secret does not match");
  if (!resourceAllowed(body.resource, origin)) {
    return oauthError(res, 400, "invalid_target", "Unknown resource");
  }

  if (body.grant_type === "authorization_code") {
    const code = await tokens.openCode(env, origin, body.code);
    if (!code || code.cid !== hashId(clientId)) return oauthError(res, 400, "invalid_grant", "Code is invalid or expired");
    if (body.redirect_uri != null && body.redirect_uri !== code.ruri) return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch");
    if (!pkceMatches(body.code_verifier, code.cc)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    console.log(JSON.stringify({ evt: "mcp.token", grant: "code", sub: hashId(code.sub), client: code.cid }));
    return res.status(200).json(await issueTokens(env, origin, code));
  }

  if (body.grant_type === "refresh_token") {
    const rt = await tokens.openRefresh(env, origin, body.refresh_token);
    if (!rt || rt.cid !== hashId(clientId)) return oauthError(res, 400, "invalid_grant", "Refresh token is invalid or expired");
    // Re-verify the owner role with Discord on every refresh. A removed role
    // therefore stops MCP access within one access-token lifetime.
    if (!rt.dr) return oauthError(res, 400, "invalid_grant", "Sign in again");
    let check;
    let discord;
    try {
      discord = await discordRefresh(rt.dr, env, fetchImpl);
      check = discord ? await discordOwnerCheck(discord.access_token, env, fetchImpl) : { ok: false, reason: "token" };
    } catch {
      return oauthError(res, 503, "temporarily_unavailable", "Discord is unavailable; try again");
    }
    if (!check.ok || check.user.id !== rt.sub) {
      console.log(JSON.stringify({ evt: "mcp.token.denied", sub: hashId(rt.sub), reason: check.ok ? "subject" : check.reason }));
      return oauthError(res, 400, "invalid_grant", "Owner role no longer verified; sign in again");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    console.log(JSON.stringify({ evt: "mcp.token", grant: "refresh", sub: hashId(rt.sub), client: rt.cid }));
    return res.status(200).json(
      await issueTokens(env, origin, { sub: rt.sub, nm: check.user.name, cid: rt.cid, sc: rt.sc, dr: discord.refresh_token || rt.dr }),
    );
  }

  return oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
}

// Bearer verification for /mcp. Returns the principal or null.
export async function verifyBearer(req, env = process.env) {
  const header = String(req.headers?.authorization || "");
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  if (!m || !env.SESSION_SECRET) return null;
  const origin = mcpOrigin(req, env);
  const claims = await tokens.verifyAccess(env, origin, mcpResource(origin), m[1]);
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  const scopes = String(claims.scope || "").split(/\s+/);
  return { sub: claims.sub, name: claims.nm || "owner", client: claims.cid || null, owner: scopes.includes(OWNER_SCOPE) };
}

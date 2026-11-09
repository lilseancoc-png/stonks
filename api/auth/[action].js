// Vercel serverless function: Discord OAuth, consolidated.
//
// One dynamic-route function handles all four auth actions so the whole flow
// costs a SINGLE serverless slot (Vercel Hobby caps at 12). The URLs are
// unchanged — Vercel routes /api/auth/<action> here with req.query.action:
//   discord-login    -> start OAuth (redirect to Discord)
//   discord-callback -> validate, role-check, mint session  (registered redirect URI)
//   logout           -> clear session (same-origin POST only)
//   me               -> report session for the "signed in as …" chip
//   picks-feed       -> private plain-text open/closed trade lines (secret link)
//   picks-fills      -> the Owner's uploaded paper/real trade log (GET / POST)
//   webull-mirror    -> copy the record's trades into the Webull paper account
//                       (POST from the build workflow) / its trade log (GET)
//   track-record-reset -> Owner-only, same-origin wipe of one tracker (POST)
//   track-record-data  -> Owner-only reporting view, independent of execution
//   owner-watchlist  -> the Owner's stock-page watchlist, synced across devices
//                       (GET / same-origin POST; lib/owner-watchlist.mjs)
//   top-picks-mode   -> the Owner's Top Picks market mode: Auto / No new puts /
//                       No new calls / Pause new trades (GET / same-origin POST;
//                       lib/top-picks-mode.mjs)
//   contact          -> public "Send us a message" box: GET a form ticket,
//                       same-origin POST a message (lib/contact-messages.mjs)
//   contact-inbox    -> Owner-only: read the messages (GET) and mark read /
//                       unread / delete (same-origin POST)
//   calendar-ics     -> .ics feed of watchlist earnings, CPI, jobs and FOMC
//                       (?s=SYMBOLS for anyone, ?o=<signed token> for an
//                       Owner's synced watchlist; lib/calendar-ics.mjs)
//   mcp / mcp-meta / mcp-oauth -> the Mingstreet MCP server and its OAuth
//                       endpoints (lib/mcp/; reached via vercel.json rewrites)
//
// Discord auth is intentionally an INTERNAL Owner Lab mechanism. Public site
// access never requires a login; only principals holding the existing Top Picks
// owner role can mint a session.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  serializeCookie,
  parseCookies,
  signSession,
  verifySessionToken,
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
function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).origin === new URL(baseUrl(req)).origin;
    } catch {
      return false;
    }
  }
  // Browsers set Sec-Fetch-Site even in the uncommon cases where Origin is
  // omitted. Cross-site pages cannot forge this forbidden request header.
  return String(req.headers["sec-fetch-site"] || "").toLowerCase() === "same-origin";
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

// The MCP routes arrive through vercel.json rewrites. Read the action (and
// the metadata kind / OAuth step) from the query when Vercel fills it in, and
// from the request path otherwise, whether that is the original public path
// (/mcp, /.well-known/..., /oauth/...) or the /api/auth/... destination.
export function mcpRouteOf(req) {
  let path = "", sp = new URLSearchParams();
  try { const u = new URL(req.url || "/", "http://x"); path = u.pathname; sp = u.searchParams; } catch { path = ""; }
  const q = { kind: sp.get("kind") || undefined, step: sp.get("step") || undefined, ...(req.query || {}) };
  path = path.replace(/\/+$/, "") || "/";
  if (q.action === "mcp" || path === "/mcp" || path === "/api/auth/mcp") return { action: "mcp" };
  const meta = /^\/\.well-known\/oauth-(protected-resource|authorization-server)(\/mcp)?$/.exec(path);
  if (q.action === "mcp-meta" || meta || path === "/api/auth/mcp-meta") {
    const kind = q.kind || (meta ? (meta[1] === "protected-resource" ? "resource" : "as") : "as");
    return { action: "mcp-meta", kind };
  }
  const step = /^\/oauth\/(register|authorize|token)$/.exec(path);
  if (q.action === "mcp-oauth" || step || path === "/api/auth/mcp-oauth") return { action: "mcp-oauth", step: q.step || step?.[1] || "" };
  return null;
}

export default async function handler(req, res) {
  const mcpRoute = mcpRouteOf(req);
  switch (mcpRoute?.action || req.query?.action) {
    case "discord-login":
      return login(req, res);
    case "discord-callback":
      return callback(req, res);
    case "logout":
      return logout(req, res);
    case "me":
      return me(req, res);
    case "picks-feed":
      return picksFeed(req, res);
    case "picks-fills":
      return picksFills(req, res);
    case "webull-mirror":
      return webullMirror(req, res);
    case "track-record-reset":
      return trackRecordReset(req, res);
    case "track-record-data":
      return trackRecordData(req, res);
    case "owner-watchlist":
      return ownerWatchlist(req, res);
    case "top-picks-mode":
      return topPicksMode(req, res);
    case "calendar-ics":
      return calendarIcs(req, res);
    case "contact":
      return contactSubmit(req, res);
    case "contact-inbox":
      return contactInbox(req, res);
    case "top-picks":
      return (await import('../top-picks.js')).default(req,res);
    // Mingstreet MCP server (lib/mcp/). vercel.json rewrites /mcp,
    // /.well-known/oauth-* and /oauth/* here so it costs no extra function.
    case "mcp":
      return (await import("../../lib/mcp/server.mjs")).handleMcpRequest(req, res);
    case "mcp-meta": {
      const oauth = await import("../../lib/mcp/oauth.mjs");
      return mcpRoute.kind === "resource"
        ? oauth.protectedResourceMetadata(req, res)
        : oauth.authorizationServerMetadata(req, res);
    }
    case "mcp-oauth": {
      const oauth = await import("../../lib/mcp/oauth.mjs");
      const step = mcpRoute.step;
      if (step === "register") return oauth.register(req, res);
      if (step === "authorize") return oauth.authorize(req, res);
      if (step === "token") return oauth.token(req, res);
      return res.status(404).json({ error: "not found" });
    }
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
    DISCORD_TOPPICKS_ROLE_ID,
    DISCORD_TOPPICKS_ROLE_IDS,
    SESSION_SECRET,
  } = process.env;
  const topPicksRoleIds = parseRoleIds(DISCORD_TOPPICKS_ROLE_ID, DISCORD_TOPPICKS_ROLE_IDS);
  const ownerRoleConfigured = topPicksRoleIds.size > 0;
  if (
    !DISCORD_CLIENT_ID ||
    !DISCORD_CLIENT_SECRET ||
    !DISCORD_GUILD_ID ||
    !ownerRoleConfigured ||
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

    // 3) INTERNAL OWNER GATE. Reuse the pre-existing Top Picks Discord role as
    // the single source of Owner entitlement; it was already owner-only.
    const hasOwnerRole = roles.some((r) => topPicksRoleIds.has(r));
    if (!hasOwnerRole) {
      return redirect(res, "/welcome.html?denied=role", clearState);
    }

    // 3b) An MCP client (ChatGPT, Claude, ...) started this login from
    // /oauth/authorize: answer it with an authorization code instead of a
    // site session. Only reached after the same owner role check above.
    const user0 = member.user || {};
    if (user0.id) {
      const { completeMcpAuthorization } = await import("../../lib/mcp/oauth.mjs");
      const handled = await completeMcpAuthorization(req, res, {
        discordToken: token,
        user: { id: String(user0.id), name: user0.global_name || user0.username || "owner" },
        clearCookies: [clearState],
      });
      if (handled) return;
    }

    // 4) Mint the session cookie and enter the app. Owner endpoints still
    // require the combined `tr` + `tp` compatibility claims, so the verified
    // owner role mints both explicitly inside the signed, tamper-proof JWT.
    const user = member.user || {};
    const jwt = await signSession({
      sub: user.id || null,
      name: user.global_name || user.username || "owner",
      tr: true,
      tp: true,
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
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: "origin denied" });
  }
  const secure = proto(req) === "https";
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure }));
  return res.status(204).end();
}

// --- session probe -----------------------------------------------------------
async function me(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.query?.checker != null) {
    return (await import('../../lib/update-checker-http.mjs')).handleUpdateChecker(req,res);
  }
  // Owner Sports section (lib/sports/). Same signed Owner session, no new function.
  if (req.query?.sports != null) {
    return (await import('../../lib/sports/http.mjs')).handleSportsRequest(req, res);
  }
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

// --- private picks feed ------------------------------------------------------
// /api/auth/picks-feed?key=<PICKS_FEED_KEY> returns the open Top Picks trades
// and the last week's closes as plain-text lines (lib/pick-trade-text.mjs), so
// an outside agent can read them without a Discord session. The link itself is
// the credential and it exposes only these lines, not the rest of the Owner
// data. Reset it by changing PICKS_FEED_KEY in Vercel; unset = feed off.
const PICKS_FEED_MIN_KEY = 24;

function keyMatches(given, expected) {
  // Hash both sides so the comparison is constant-time and length-independent.
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

async function picksFeed(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const expected = process.env.PICKS_FEED_KEY || "";
  const given = req.query?.key;
  if (
    process.env.PRIVATE_DATA_ENABLED !== "1" ||
    expected.length < PICKS_FEED_MIN_KEY ||
    typeof given !== "string" ||
    !keyMatches(given, expected)
  ) {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const [{ store }, { buildPicksFeedText }] = await Promise.all([
      import("../../lib/datastore.mjs"),
      import("../../lib/pick-trade-text.mjs"),
    ]);
    const buf = await store.get("picks-accuracy.json");
    const acc = buf == null ? {} : JSON.parse(buf.toString("utf8"));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.statusCode = 200;
    return res.end(buildPicksFeedText(acc));
  } catch (err) {
    console.error("picks feed failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "feed unavailable" });
  }
}

// --- Owner trade log (paper / real fills) -----------------------------------
// GET  /api/auth/picks-fills         -> { rows, updatedAt, errors, marks }
// POST /api/auth/picks-fills { csv } -> replaces the stored rows (marks kept)
// POST /api/auth/picks-fills { mark: { trade_id, took, reason } | { trade_id, clear } }
//                                    -> saves one took / skipped mark
// POST /api/auth/picks-fills { note: { trade_id | ticker, text, tags } | { ..., clear } }
//                                    -> saves one trade-journal note (notes kept on upload)
// The Track Record joins these rows to the record by trade ID (Scorecard,
// "Your fills vs the record"). Owner session with both claims required; POST
// must be same-origin. Stored under the request-time key picks-fills.json,
// which no workflow pushes or deletes.
const FILLS_KEY = "picks-fills.json";

async function trackRecordReset(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.PRIVATE_DATA_ENABLED !== '1') return res.status(404).json({ error: 'not found' });
  const session = await getSession(req).catch(() => null);
  if (!session || session.tr !== true || session.tp !== true) return res.status(401).json({ error: 'Owner access required' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'forbidden' });
  const { scope, range, operation, confirmation, previewToken } = req.body || {};
  if (!['webull', 'onsite'].includes(scope) || !['1D', '1W', '1M', '3M', 'ALL'].includes(range) || !['preview', 'wipe'].includes(operation)) {
    return res.status(400).json({ error: 'Select one tracker and a valid wipe period.' });
  }
  try {
    const [{ store }, { resetTrackRecord, previewTrackRecord }] = await Promise.all([
      import('../../lib/datastore.mjs'), import('../../lib/track-record-reset.mjs'),
    ]);
    if (operation === 'preview') {
      const preview = await previewTrackRecord({ store, scope, range });
      return res.status(200).json({ ...preview, previewToken: await signSession(preview, { ttlSec: 600 }) });
    }
    const preview = await verifySessionToken(previewToken);
    if (!preview || preview.kind !== 'track-record-wipe' || preview.scope !== scope || preview.range !== range ||
        confirmation !== `WIPE ${scope.toUpperCase()} ${range} RECORD`) {
      return res.status(400).json({ error: 'Confirmation expired or does not match the tracker and period. Select the period again.' });
    }
    const result = await resetTrackRecord({ store, preview });
    if (result.busy) return res.status(409).json({ error: 'Another log wipe is running. Wait for it to finish, then try again.' });
    return res.status(200).json(result.result);
  } catch (err) {
    if (err.code === 'RESET_STALE') return res.status(409).json({ error: err.message });
    console.error('track record reset failed', { code: err?.code, message: String(err?.message || err) });
    return res.status(502).json({ error: 'Could not wipe the record. Refresh to check its current state before trying again.' });
  }
}

async function trackRecordData(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.PRIVATE_DATA_ENABLED !== '1') return res.status(404).json({ error: 'not found' });
  const session = await getSession(req).catch(() => null);
  if (!session || session.tr !== true || session.tp !== true) return res.status(401).json({ error: 'Owner access required' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  const { readSiteRecord, SITE_RECORD_KEYS } = await import('../../lib/track-record-reset.mjs');
  if (!SITE_RECORD_KEYS.includes(req.query?.key)) return res.status(400).json({ error: 'Unknown Track Record log' });
  try {
    const { store } = await import('../../lib/datastore.mjs');
    return res.status(200).json(await readSiteRecord(store, req.query.key));
  } catch (err) {
    console.error('track record log read failed', { message: String(err?.message || err) });
    return res.status(502).json({ error: 'Track Record log unavailable' });
  }
}

async function picksFills(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: "auth required" });
  if (session.tr !== true || session.tp !== true) return res.status(401).json({ error: "role required" });
  try {
    const { store } = await import("../../lib/datastore.mjs");
    if (req.method === "GET") {
      const buf = await store.get(FILLS_KEY);
      const out = buf == null ? { rows: [], updatedAt: null, errors: [] } : JSON.parse(buf.toString("utf8"));
      // The Webull paper mirror's trades join the same view as their own
      // account ("Webull paper"); an upload never replaces them.
      const mirrored = await webullFillRows(store);
      if (mirrored.length) out.rows = [...mirrored, ...(Array.isArray(out.rows) ? out.rows : [])];
      return res.status(200).json(out);
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method not allowed" });
    }
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "forbidden" });
    const { parseFillsCsv, FILLS_MAX_BYTES, applyTradeMark, applyTradeNote } = await import("../../lib/track-record-fills.mjs");
    const readPrev = async () => {
      const prevBuf = await store.get(FILLS_KEY);
      return prevBuf == null ? { rows: [], updatedAt: null, errors: [] } : JSON.parse(prevBuf.toString("utf8"));
    };
    // One "took it / skipped it" mark (POST { mark: { trade_id, took, reason } }).
    // Marks live beside the uploaded rows and survive the next CSV upload.
    if (req.body && typeof req.body === "object" && req.body.mark) {
      if (applyTradeMark({}, req.body.mark).error) return res.status(400).json({ error: applyTradeMark({}, req.body.mark).error });
      const prev = await readPrev();
      const applied = applyTradeMark(prev.marks, req.body.mark);
      const out = { ...prev, marks: applied.marks };
      await store.put(FILLS_KEY, JSON.stringify(out));
      const mirrored = await webullFillRows(store);
      return res.status(200).json(mirrored.length ? { ...out, rows: [...mirrored, ...(Array.isArray(out.rows) ? out.rows : [])] } : out);
    }
    // One trade-journal note (POST { note: { trade_id | ticker, text, tags } }).
    if (req.body && typeof req.body === "object" && req.body.note) {
      const check = applyTradeNote({}, req.body.note);
      if (check.error) return res.status(400).json({ error: check.error });
      const prev = await readPrev();
      const applied = applyTradeNote(prev.notes, req.body.note);
      const out = { ...prev, notes: applied.notes };
      await store.put(FILLS_KEY, JSON.stringify(out));
      const mirrored = await webullFillRows(store);
      return res.status(200).json(mirrored.length ? { ...out, rows: [...mirrored, ...(Array.isArray(out.rows) ? out.rows : [])] } : out);
    }
    const csv = req.body && typeof req.body === "object" ? req.body.csv : null;
    if (typeof csv !== "string" || !csv.trim()) return res.status(400).json({ error: "no csv" });
    if (csv.length > FILLS_MAX_BYTES) return res.status(413).json({ error: "file too large" });
    const { rows, errors } = parseFillsCsv(csv);
    if (!rows.length) return res.status(400).json({ error: "no usable rows", errors });
    const prev = await readPrev();
    const out = { rows, errors, updatedAt: new Date().toISOString(), ...(prev.marks ? { marks: prev.marks } : {}), ...(prev.notes ? { notes: prev.notes } : {}) };
    await store.put(FILLS_KEY, JSON.stringify(out));
    const mirrored = await webullFillRows(store);
    return res.status(200).json(mirrored.length ? { ...out, rows: [...mirrored, ...rows] } : out);
  } catch (err) {
    console.error("picks fills failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "fills unavailable" });
  }
}

// --- Owner watchlist ----------------------------------------------------------
// GET  /api/auth/owner-watchlist  -> { symbols, updatedAt }
// POST /api/auth/owner-watchlist  { op: add|remove, symbol } or
//                                 { op: sync, local, base } (same-origin only)
// One list per Discord account (keyed by a hash of the session's user id) in
// owner-watchlist.json, which is Owner-only and request-time-owned: no
// workflow pushes or deletes it.
function ownerWatchKey(session) {
  return createHash("sha256").update("owner-watchlist:" + String(session?.sub || "owner")).digest("hex").slice(0, 24);
}
// A calendar app can't send the session cookie, so an Owner's calendar link
// carries a signed token for their watchlist key instead. It reveals only that
// Owner's watched symbols plus public dates; rotating SESSION_SECRET revokes it.
function ownerIcsToken(userKey) {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 16 || !/^[0-9a-f]{24}$/.test(userKey)) return null;
  return userKey + "." + createHmac("sha256", secret).update("calendar-ics:" + userKey).digest("hex").slice(0, 32);
}
function ownerIcsKeyOf(token) {
  const m = /^([0-9a-f]{24})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const expected = ownerIcsToken(m[1]);
  return expected && keyMatches(token, expected) ? m[1] : null;
}

// GET /api/auth/calendar-ics?s=AAPL,MSFT[&dl=1]  or  ?o=<Owner token>
async function calendarIcs(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ error: "not found" }); }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "method not allowed" });
  }
  const { parseIcsSymbols, buildCalendarIcs } = await import("../../lib/calendar-ics.mjs");
  const token = req.query?.o;
  const ownerKey = token ? ownerIcsKeyOf(token) : null;
  if (token && !ownerKey) { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ error: "not found" }); }
  try {
    const { store } = await import("../../lib/datastore.mjs");
    let symbols = parseIcsSymbols(req.query?.s);
    if (ownerKey) {
      const { OWNER_WATCHLIST_KEY, readOwnerWatchlistDoc } = await import("../../lib/owner-watchlist.mjs");
      const doc = readOwnerWatchlistDoc(await store.get(OWNER_WATCHLIST_KEY));
      symbols = parseIcsSymbols((doc.users[ownerKey]?.symbols || []).join(","));
    }
    const buf = await store.get("calendar.json");
    const calendar = buf == null ? {} : JSON.parse(buf.toString("utf8"));
    const text = buildCalendarIcs(calendar, { symbols, siteUrl: baseUrl(req) });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", ownerKey ? "private, max-age=1800" : "public, max-age=1800, s-maxage=3600");
    if (ownerKey) res.setHeader("Referrer-Policy", "no-referrer");
    if (req.query?.dl === "1") res.setHeader("Content-Disposition", 'attachment; filename="mingstreet-calendar.ics"');
    res.statusCode = 200;
    return res.end(req.method === "HEAD" ? undefined : text);
  } catch (err) {
    console.error("calendar ics failed", { message: String(err?.message || err) });
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "calendar unavailable" });
  }
}

async function ownerWatchlist(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: "auth required" });
  if (session.tr !== true || session.tp !== true) return res.status(401).json({ error: "role required" });
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (req.method === "POST" && !isSameOriginRequest(req)) return res.status(403).json({ error: "forbidden" });
  const { OWNER_WATCHLIST_KEY, readOwnerWatchlistDoc, applyOwnerWatchlistRequest, ownerWatchlistFactory } = await import("../../lib/owner-watchlist.mjs");
  // Validate the request before anything is read or stored.
  if (req.method === "POST") {
    const check = applyOwnerWatchlistRequest([], req.body);
    if (check.error) return res.status(400).json({ error: check.error });
  }
  try {
    const { store } = await import("../../lib/datastore.mjs");
    const key = ownerWatchKey(session);
    const readMine = async () => {
      const doc = readOwnerWatchlistDoc(await store.get(OWNER_WATCHLIST_KEY));
      const mine = doc.users[key] || { symbols: [], updatedAt: null };
      return { doc, mine, current: ownerWatchlistFactory().clean(mine.symbols) };
    };
    if (req.method === "GET") {
      const { mine, current } = await readMine();
      return res.status(200).json({ symbols: current, updatedAt: mine.updatedAt || null, icsToken: ownerIcsToken(key) });
    }
    // Read, change and save under the store's lease so two devices (or two
    // quick clicks) saving at once can't drop each other's change.
    const save = async (guard) => {
      const { doc, current } = await readMine();
      const out = applyOwnerWatchlistRequest(current, req.body);
      if (out.error) return out;
      const updatedAt = new Date().toISOString();
      doc.users[key] = { symbols: out.list, updatedAt };
      if (guard) guard();
      await store.put(OWNER_WATCHLIST_KEY, JSON.stringify(doc));
      return { symbols: out.list, updatedAt };
    };
    let out;
    if (store.backend === "r2" && typeof store.withLease === "function") {
      let leased;
      try { leased = await store.withLease("owner-watchlist", save); }
      catch (err) { if (err?.code === "LEASE_CONFLICT") return res.status(409).json({ error: "busy, try again" }); throw err; }
      if (leased?.busy) return res.status(409).json({ error: "busy, try again" });
      out = leased.result;
    } else out = await save(null);
    if (out.error) return res.status(400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    console.error("owner watchlist failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "watchlist unavailable" });
  }
}

// --- Top Picks market mode ----------------------------------------------------
// GET  /api/auth/top-picks-mode  -> { mode, label, updatedAt, by, history }
// POST /api/auth/top-picks-mode  { mode: auto|no-puts|no-calls|pause }
//                                (same-origin only)
// One mode for the whole Top Picks book in top-picks-mode.json, Owner-only and
// request-time-owned: no workflow pushes or deletes it. The 11:00 / 15:30 ET
// runs read it; it only holds back NEW trades by side.
async function topPicksMode(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: "auth required" });
  if (session.tr !== true || session.tp !== true) return res.status(401).json({ error: "role required" });
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (req.method === "POST" && !isSameOriginRequest(req)) return res.status(403).json({ error: "forbidden" });
  const { TOP_PICKS_MODE_KEY, readTopPicksModeDoc, applyTopPicksModeRequest, marketModeLabel } = await import("../../lib/top-picks-mode.mjs");
  // Validate the request before anything is read or stored.
  if (req.method === "POST" && applyTopPicksModeRequest(null, req.body).error) return res.status(400).json({ error: "bad mode" });
  const view = (doc) => ({ mode: doc.mode, label: marketModeLabel(doc.mode), updatedAt: doc.updatedAt || null, by: doc.by || null, history: doc.history || [] });
  try {
    const { store } = await import("../../lib/datastore.mjs");
    if (req.method === "GET") return res.status(200).json(view(readTopPicksModeDoc(await store.get(TOP_PICKS_MODE_KEY))));
    // Read, change and save under the store's lease so two quick clicks (or
    // both owners at once) can't drop each other's change.
    const save = async (guard) => {
      const current = readTopPicksModeDoc(await store.get(TOP_PICKS_MODE_KEY));
      const out = applyTopPicksModeRequest(current, req.body, { at: new Date().toISOString(), by: session.name || null });
      if (out.error) return out;
      if (!out.unchanged) {
        if (guard) guard();
        await store.put(TOP_PICKS_MODE_KEY, JSON.stringify(out.doc));
      }
      return view(out.doc);
    };
    let out;
    if (store.backend === "r2" && typeof store.withLease === "function") {
      let leased;
      try { leased = await store.withLease("top-picks-mode", save); }
      catch (err) { if (err?.code === "LEASE_CONFLICT") return res.status(409).json({ error: "busy, try again" }); throw err; }
      if (leased?.busy) return res.status(409).json({ error: "busy, try again" });
      out = leased.result;
    } else out = await save(null);
    if (out.error) return res.status(400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (err) {
    console.error("top picks mode failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "mode unavailable" });
  }
}

// --- Contact messages ("Send us a message", Learn & help) ---------------------
// GET  /api/auth/contact            -> { ticket } (signed form ticket, public)
// POST /api/auth/contact { ticket, title, message, name?, contacts?, website }
//   Public and same-origin only. `website` is a hidden honeypot. Messages are
//   stored in one raw private record (CONTACT_KEY, outside published data)
//   and only the Owner can read them through contact-inbox.
async function withContactDoc(store, fn) {
  const { CONTACT_KEY, CONTACT_LEASE, readContactDoc } = await import("../../lib/contact-messages.mjs");
  const run = async (guard) => {
    const doc = readContactDoc(await store.rawGet(CONTACT_KEY));
    const out = fn(doc);
    if (out.save) {
      if (guard) guard();
      await store.rawPut(CONTACT_KEY, JSON.stringify(out.doc));
    }
    return out;
  };
  if (store.backend === "r2" && typeof store.withLease === "function") {
    let leased;
    try { leased = await store.withLease(CONTACT_LEASE, run); }
    catch (err) { if (err?.code === "LEASE_CONFLICT") return { busy: true }; throw err; }
    if (leased?.busy) return { busy: true };
    return leased.result;
  }
  return run(null);
}

async function contactSubmit(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (process.env.PRIVATE_DATA_ENABLED !== "1" || process.env.CONTACT_ENABLED === "0") return res.status(404).json({ error: "The message box is not available right now." });
  const contact = await import("../../lib/contact-messages.mjs");
  if (req.method === "GET") {
    const ticket = contact.issueTicket();
    if (!ticket) return res.status(503).json({ error: "The message box is not available right now." });
    return res.status(200).json({ ticket, limits: { title: contact.LIMITS.TITLE_MAX, message: contact.LIMITS.MESSAGE_MAX, contacts: contact.LIMITS.CONTACTS_MAX } });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!isSameOriginRequest(req)) return res.status(403).json({ error: "forbidden" });
  const body = req.body && typeof req.body === "object" ? req.body : null;
  // Honeypot: people never see this field, simple bots fill it. Pretend it
  // worked so the bot moves on, and store nothing.
  if (body && typeof body.website === "string" && body.website.trim()) return res.status(200).json({ ok: true });
  const ticketProblem = contact.checkTicket(body?.ticket);
  if (ticketProblem === "unconfigured") return res.status(503).json({ error: "The message box is not available right now." });
  if (ticketProblem === "too-fast") return res.status(429).json({ error: "That was quick. Wait a few seconds and send again." });
  if (ticketProblem) return res.status(400).json({ error: "This form has expired. Reload the page and try again.", reload: true });
  const checked = contact.validateSubmission(body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  try {
    const { store } = await import("../../lib/datastore.mjs");
    const sender = contact.senderHash(contact.clientIp(req));
    const out = await withContactDoc(store, (doc) => {
      const r = contact.addMessage(doc, checked.message, { sender });
      return { ...r, save: r.status === "saved" };
    });
    if (out.busy) return res.status(409).json({ error: "Busy, try again in a moment." });
    if (out.status === "saved" || out.status === "duplicate") return res.status(200).json({ ok: true });
    if (out.status === "rate") return res.status(429).json({ error: "You have sent several messages already. Try again later." });
    return res.status(503).json({ error: "The inbox is full right now. Try again later." });
  } catch (err) {
    console.error("contact submit failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "Your message could not be sent. Try again." });
  }
}

// GET  /api/auth/contact-inbox                      -> { messages, unread }
// POST /api/auth/contact-inbox { op: read|unread|delete, id } | { op: read-all }
async function contactInbox(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: "auth required" });
  if (session.tr !== true || session.tp !== true) return res.status(401).json({ error: "role required" });
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (req.method === "POST" && !isSameOriginRequest(req)) return res.status(403).json({ error: "forbidden" });
  const contact = await import("../../lib/contact-messages.mjs");
  try {
    const { store } = await import("../../lib/datastore.mjs");
    if (req.method === "GET") {
      return res.status(200).json(contact.inboxView(contact.readContactDoc(await store.rawGet(contact.CONTACT_KEY))));
    }
    const out = await withContactDoc(store, (doc) => {
      const r = contact.applyInboxOp(doc, req.body);
      return { ...r, save: !r.error };
    });
    if (out.busy) return res.status(409).json({ error: "busy, try again" });
    if (out.error) return res.status(400).json({ error: out.error });
    return res.status(200).json(contact.inboxView(out.doc));
  } catch (err) {
    console.error("contact inbox failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "inbox unavailable" });
  }
}

// --- Webull paper mirror ------------------------------------------------------
// POST /api/auth/webull-mirror  (Authorization: Bearer <trigger token>)
//   Runs lib/webull-mirror.mjs once: copies new record opens/closes into the
//   Webull PaperTrade account and saves webull-paper-ledger.json. The build
//   workflows call it after Top Picks publication and in the closing window.
//   The trigger token is derived from
//   R2_SECRET_ACCESS_KEY (already set in Vercel and GitHub), so no new secret
//   is shared between the two; the response carries counts only.
// GET  /api/auth/webull-mirror[?format=csv]  (Owner session)
//   The trade log: { ledger summary, rows } or a CSV download.
// Off unless WEBULL_MIRROR=on and the Webull paper keys are set. The client
// only talks to Webull's sandbox host, so it can't reach a live account.
async function webullFillRows(store) {
  try {
    const buf = await store.get("webull-paper-ledger.json");
    if (buf == null) return [];
    const { ledgerToFillRows } = await import("../../lib/webull-mirror.mjs");
    const { projectWebullLedger, parseReset, RESET_KEYS } = await import('../../lib/track-record-reset.mjs');
    return ledgerToFillRows(projectWebullLedger(JSON.parse(buf.toString('utf8')), parseReset(await store.get(RESET_KEYS.webull))));
  } catch (err) {
    console.error("webull ledger read failed", { message: String(err?.message || err) });
    return [];
  }
}

async function webullMirror(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const mirror = await import("../../lib/webull-mirror.mjs");

  if (req.method === "GET") {
    const session = await getSession(req).catch(() => null);
    if (!session) return res.status(401).json({ error: "auth required" });
    if (session.tr !== true || session.tp !== true) return res.status(401).json({ error: "role required" });
    try {
      const { store } = await import("../../lib/datastore.mjs");
      const buf = await store.get(mirror.LEDGER_KEY);
      const { projectWebullLedger, webullEngineRecord, parseReset, RESET_KEYS } = await import('../../lib/track-record-reset.mjs');
      const rawLedger = buf == null ? mirror.emptyLedger() : JSON.parse(buf.toString('utf8'));
      const ledger = projectWebullLedger(rawLedger, parseReset(await store.get(RESET_KEYS.webull)));
      const rows = mirror.ledgerToFillRows(ledger);
      if (req.query?.format === "orders") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="webull-order-attempts.csv"');
        res.statusCode = 200;
        return res.end(mirror.orderAttemptsToCsv(ledger));
      }
      if (req.query?.format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="webull-paper-trades.csv"');
        res.statusCode = 200;
        return res.end(mirror.fillRowsToCsv(rows));
      }
      const { describeObjectLease } = await import("../../lib/object-lease.mjs");
      let executionLock;
      try {
        if (store.backend !== "r2") executionLock = { state: "unsupported" };
        else {
          const lock = await store.rawGet("_stonks/leases/webull-paper.json");
          let value;
          try { value = lock == null ? null : JSON.parse(lock.toString("utf8")); }
          catch { value = null; }
          executionLock = describeObjectLease(lock == null ? null : { value });
        }
      } catch { executionLock = { state: "unavailable" }; }
      // Webull comparisons use the raw engine record, independently of the
      // on-site reporting exclusions. Never feed a report back to execution.
      const accBuf = await store.get('picks-accuracy.json');
      const rawRecord = accBuf == null ? {} : JSON.parse(accBuf.toString('utf8'));
      const engineRecord = webullEngineRecord(rawRecord, ledger);
      const { mirrorHealth } = await import('../../lib/webull-mirror-health.mjs');
      return res.status(200).json({
        engineRecord,
        health: mirrorHealth({ acc: rawRecord, ledger: rawLedger, executionLock, enabled: String(process.env.WEBULL_MIRROR || "").trim().toLowerCase() === "on" }),
        executionLock,
        enabled: String(process.env.WEBULL_MIRROR || "").trim().toLowerCase() === "on",
        goLiveIso: ledger.goLiveIso,
        lastRunIso: ledger.lastRunIso,
        engineSnapshotIso: ledger.engineSnapshotIso ?? null,
        lastEndOfDayDeadlineIso: ledger.lastEndOfDayDeadlineIso ?? null,
        lastEndOfDayAudit: ledger.lastEndOfDayAudit ?? null,
        runs: (ledger.runs || []).slice(0, 10),
        reconciliation: ledger.reconciliation ? { checkedAtIso: ledger.reconciliation.checkedAtIso, status: ledger.reconciliation.status, alerts: ledger.reconciliation.alerts || [], failure: ledger.reconciliation.failure || null, externalGroups: ledger.reconciliation.externalGroups || 0 } : null,
        rows,
        trades: mirror.ledgerToTestTrades(ledger),
      });
    } catch (err) {
      console.error("webull mirror read failed", { message: String(err?.message || err) });
      return res.status(502).json({ error: "ledger unavailable" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  const secret = process.env.R2_SECRET_ACCESS_KEY || "";
  const auth = String(req.headers.authorization || "");
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || !given || !keyMatches(given, mirror.mirrorTriggerToken(secret))) {
    return res.status(404).json({ error: "not found" });
  }
  if (String(process.env.WEBULL_MIRROR || "").trim().toLowerCase() !== "on") return res.status(200).json({ ran: false, reason: "mirror off" });
  // Trimmed: a value pasted into Vercel with a trailing newline or space
  // would otherwise break the request signature.
  const env = (k) => String(process.env[k] || "").trim();
  const WEBULL_APP_KEY = env("WEBULL_APP_KEY"), WEBULL_APP_SECRET = env("WEBULL_APP_SECRET");
  const WEBULL_PAPER_ACCOUNT_ID = env("WEBULL_PAPER_ACCOUNT_ID"), WEBULL_ACCESS_TOKEN = env("WEBULL_ACCESS_TOKEN");
  if (!WEBULL_APP_KEY || !WEBULL_APP_SECRET || !WEBULL_PAPER_ACCOUNT_ID) {
    return res.status(200).json({ ran: false, reason: "webull paper keys not configured" });
  }
  try {
    const [{ store }, { createWebullClient }, { fetchContract }] = await Promise.all([
      import("../../lib/datastore.mjs"),
      import("../../lib/webull-client.mjs"),
      import("../../lib/yahoo.mjs"),
    ]);
    const lease = await store.withLease("webull-paper", async (guard) => {
      const [accBuf, ledgerBuf] = await Promise.all([store.get("picks-accuracy.json"), store.get(mirror.LEDGER_KEY)]);
      if (accBuf == null) return { ran: false, reason: "track record unavailable" };
      let acc = JSON.parse(accBuf.toString("utf8"));
      const ledger = ledgerBuf == null ? mirror.emptyLedger() : JSON.parse(ledgerBuf.toString("utf8"));
      if (acc.open?.some(r=>r.marketAdjustment)) {
        const [{approvedTopPicks,applyMarketAdmission},{topPicksLiveQuotes}]=await Promise.all([
          import('../../lib/top-picks-approval.mjs'),import('../top-picks.js')]);
        const approval=await approvedTopPicks({store,fetchLive:topPicksLiveQuotes}).catch(()=>null);
        acc=applyMarketAdmission(acc,approval,ledger);
      }
      const client = createWebullClient({ appKey: WEBULL_APP_KEY, appSecret: WEBULL_APP_SECRET, accessToken: WEBULL_ACCESS_TOKEN || null, timeoutMs: 5000 });
      const quoteFn = mirror.makeQuoteFn(fetchContract);
      const checkpoint = async (next) => { guard(); await store.put(mirror.LEDGER_KEY, JSON.stringify(next)); };
      const { summary } = await mirror.runWebullMirror({ client, accountId: WEBULL_PAPER_ACCOUNT_ID, acc, ledger, quoteFn, checkpoint, guard, endOfDayOnly: req.query?.mode === "eod" });
      return { ran: !summary.skipped, summary };
    });
    return res.status(200).json(lease.busy ? { ran: false, reason: "mirror already running", retryAfterMs: lease.retryAfterMs } : lease.result);
  } catch (err) {
    console.error("webull mirror failed", { message: String(err?.message || err), code: err?.code || null });
    // Only the bake's trigger sees this (bearer-gated) and prints it to a
    // public log, so it carries the error class, never Webull's text (which
    // can echo order details). A code bug's own message is safe and is what
    // makes it fixable.
    const webull = err?.name === "WebullError";
    return res.status(502).json({
      error: "mirror failed",
      code: err?.code || null,
      status: webull ? err?.status ?? null : null,
      kind: err?.name || null,
      detail: webull || err?.code === "ACCOUNT_NOT_FOUND" ? null : String(err?.message || "").slice(0, 120),
    });
  }
}

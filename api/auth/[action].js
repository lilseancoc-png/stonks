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
//
// Discord auth is intentionally an INTERNAL Owner Lab mechanism. Public site
// access never requires a login; only principals holding the existing Top Picks
// owner role can mint a session.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
    case "picks-feed":
      return picksFeed(req, res);
    case "picks-fills":
      return picksFills(req, res);
    case "webull-mirror":
      return webullMirror(req, res);
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
// GET  /api/auth/picks-fills         -> { rows, updatedAt, errors }
// POST /api/auth/picks-fills { csv } -> replaces the stored log, same shape
// The Track Record joins these rows to the record by trade ID (Scorecard,
// "Your fills vs the record"). Owner session with both claims required; POST
// must be same-origin. Stored under the request-time key picks-fills.json,
// which no workflow pushes or deletes.
const FILLS_KEY = "picks-fills.json";

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
    const { parseFillsCsv, FILLS_MAX_BYTES } = await import("../../lib/track-record-fills.mjs");
    const csv = req.body && typeof req.body === "object" ? req.body.csv : null;
    if (typeof csv !== "string" || !csv.trim()) return res.status(400).json({ error: "no csv" });
    if (csv.length > FILLS_MAX_BYTES) return res.status(413).json({ error: "file too large" });
    const { rows, errors } = parseFillsCsv(csv);
    if (!rows.length) return res.status(400).json({ error: "no usable rows", errors });
    const out = { rows, errors, updatedAt: new Date().toISOString() };
    await store.put(FILLS_KEY, JSON.stringify(out));
    const mirrored = await webullFillRows(store);
    return res.status(200).json(mirrored.length ? { ...out, rows: [...mirrored, ...rows] } : out);
  } catch (err) {
    console.error("picks fills failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "fills unavailable" });
  }
}

// --- Webull paper mirror ------------------------------------------------------
// POST /api/auth/webull-mirror  (Authorization: Bearer <trigger token>)
//   Runs lib/webull-mirror.mjs once: copies new record opens/closes into the
//   Webull PaperTrade account and saves webull-paper-ledger.json. The build
//   workflow calls it after every full bake. The trigger token is derived from
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
    return ledgerToFillRows(JSON.parse(buf.toString("utf8")));
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
      const ledger = buf == null ? mirror.emptyLedger() : JSON.parse(buf.toString("utf8"));
      const rows = mirror.ledgerToFillRows(ledger);
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
      return res.status(200).json({
        executionLock,
        enabled: String(process.env.WEBULL_MIRROR || "").trim().toLowerCase() === "on",
        goLiveIso: ledger.goLiveIso,
        lastRunIso: ledger.lastRunIso,
        engineSnapshotIso: ledger.engineSnapshotIso ?? null,
        runs: (ledger.runs || []).slice(0, 10),
        reconciliation: ledger.reconciliation ? { checkedAtIso: ledger.reconciliation.checkedAtIso, status: ledger.reconciliation.status, alerts: ledger.reconciliation.alerts || [] } : null,
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
      const acc = JSON.parse(accBuf.toString("utf8"));
      const ledger = ledgerBuf == null ? mirror.emptyLedger() : JSON.parse(ledgerBuf.toString("utf8"));
      const client = createWebullClient({ appKey: WEBULL_APP_KEY, appSecret: WEBULL_APP_SECRET, accessToken: WEBULL_ACCESS_TOKEN || null, timeoutMs: 5000 });
      const quoteFn = mirror.makeQuoteFn(fetchContract);
      const checkpoint = async (next) => { guard(); await store.put(mirror.LEDGER_KEY, JSON.stringify(next)); };
      const { summary } = await mirror.runWebullMirror({ client, accountId: WEBULL_PAPER_ACCOUNT_ID, acc, ledger, quoteFn, checkpoint, guard });
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

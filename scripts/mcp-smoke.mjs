// Smoke test for the Mingstreet MCP server (lib/mcp/) and its OAuth layer.
// No network: Discord and the store are faked. Run: node scripts/mcp-smoke.mjs
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const ENV = {
  PRIVATE_DATA_ENABLED: "1",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  DISCORD_CLIENT_ID: "dc-id",
  DISCORD_CLIENT_SECRET: "dc-secret",
  DISCORD_GUILD_ID: "guild-1",
  DISCORD_TOPPICKS_ROLE_ID: "owner-role",
};
Object.assign(process.env, ENV);
delete process.env.MCP_PUBLIC_ACCESS;
delete process.env.MCP_ENABLED;
delete process.env.MCP_TOKEN_VERSION;

const { handleMcpRequest, SUPPORTED_VERSIONS } = await import("../lib/mcp/server.mjs");
const oauth = await import("../lib/mcp/oauth.mjs");
const { boundedJson, TOOLS } = await import("../lib/mcp/tools.mjs");
const { default: authHandler } = await import("../api/auth/[action].js");

const HOST = "mingstreet.test";
const ORIGIN = `https://${HOST}`;

function mkReq({ method = "GET", query = {}, headers = {}, body } = {}) {
  return { method, query, body, headers: { host: HOST, "x-forwarded-proto": "https", ...headers }, url: "/" };
}
function mkRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; this.ended = true; return this; },
    end(v) { if (v !== undefined) this.body = v; this.ended = true; return this; },
  };
  return res;
}
async function call(fn, reqOpts, ...rest) {
  const req = mkReq(reqOpts), res = mkRes();
  await fn(req, res, ...rest);
  return res;
}
function cookiesFrom(res) {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return Object.fromEntries(list.map((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
}
const cookieHeader = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");

// ---- fake store -------------------------------------------------------------
const now = Date.parse("2026-11-02T15:00:00Z");
const files = {
  "briefs.json": { builtAtIso: "2026-11-02T14:00:00Z", current: { headline: "Stocks rise", sections: Array.from({ length: 40 }, (_, i) => ({ symbol: i === 3 ? "NVDA" : "SPY", text: "x".repeat(2000) })) } },
  "market-analysis.json": { builtAtIso: "2026-11-02T14:00:00Z", macroRegime: { band: "risk-on" } },
  "grades.json": { builtAtIso: "2026-11-02T14:00:00Z", gradeModelVersion: 9, regimeBand: "neutral", minConviction: 4, grades: {
    NVDA: { symbol: "NVDA", side: "call", total: 8, conviction: 8, recommendation: { tier: "strong" }, pillars: { trend: { score: 3 }, flow: 2 }, spot: 200, sector: "Semis", rsi: 61, ivPctile: 40 },
    AAPL: { symbol: "AAPL", side: "put", total: -5, conviction: 5, recommendation: { tier: "lean" }, pillars: {}, spot: 230, sector: "Hardware", rsi: 45, ivPctile: 20 },
  } },
  "NVDA.json": { builtAtIso: "2026-11-02T14:00:00Z", symbol: "NVDA", spot: 200, technicals: { rsi: 61 }, fundamentals: { revenue: 1e11 },
    news: Array.from({ length: 30 }, (_, i) => ({ title: "n" + i })), sessionToken: "must-not-leak",
    priceSeries: { t: ["2026-10-30", "2026-10-31", "2026-11-02"], o: [1, 2, 3], h: [1, 2, 3], l: [1, 2, 3], c: [190, 195, 200], v: [10, 20, 30] },
    bigSection: { rows: Array.from({ length: 500 }, (_, i) => ({ i, note: "y".repeat(50) })) } },
  "picks-accuracy.json": { builtAtIso: "2026-11-02T14:00:00Z",
    open: [{ symbol: "NVDA", side: "call", entryDate: "2026-10-28T15:05:00Z", optionPnlPct: 12, entrySpot: 190, lastSpot: 200,
      contract: { structure: "long", strike: 200, expiry: 1797638400, mid: 10 }, marks: Array.from({ length: 400 }, (_, i) => ({ i, note: "m".repeat(80) })) }],
    closed: [
      { symbol: "AAPL", side: "put", status: "hit-target", outcome: "win", optionPnlPct: 25, entryDate: "2026-10-20T15:05:00Z", exitDate: "2026-10-30T19:30:00Z", contract: { structure: "debit_vertical", longStrike: 230, shortStrike: 220, netDebit: 4, expiry: 1797638400 } },
      { symbol: "MSFT", side: "call", status: "hit-stop", outcome: "loss", optionPnlPct: -50, entryDate: "2026-10-01T15:05:00Z", exitDate: "2026-10-10T19:30:00Z", contract: { structure: "long", strike: 500, mid: 8, expiry: 1797638400 } },
    ],
    allTimeStats: { closed: 40 } },
  "transcript-NVDA.json": { builtAtIso: "2026-11-02T14:00:00Z", symbol: "NVDA", quarter: "Q3 2026", summary: "Strong quarter", session: "regular" },
  "picks-changes.json": { builtAtIso: "2026-11-02T14:00:00Z", events: [{ symbol: "NVDA", kind: "in" }] },
  "regime-history.json": { builtAtIso: "2026-11-02T14:00:00Z", days: [{ d: "2026-11-02", band: "risk-on" }] },
  "unified-signal.json": { builtAtIso: "2026-11-02T14:00:00Z", validUntil: "2026-11-02T14:30:00Z", rows: [] },
  "picks-fills.json": { rows: [{ secret: true }] },
  "webull-paper-ledger.json": { rows: [] },
};
const store = { backend: "memory", async get(k) { return k in files ? Buffer.from(JSON.stringify(files[k])) : null; } };
const deps = (extra = {}) => ({ env: { ...ENV, ...extra }, store, now: () => now, fetchQuote: async (s) => ({ spot: 101, marketState: "REGULAR" }), topPicks: async () => ({ picks: [{ symbol: "NVDA" }] }) });

// ---- fake Discord -----------------------------------------------------------
let discordRoles = ["owner-role"];
let discordUser = { id: "u-owner", username: "owner" };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.endsWith("/oauth2/token")) {
    const p = new URLSearchParams(init.body);
    if (p.get("grant_type") === "refresh_token" && p.get("refresh_token") === "revoked") return new Response("{}", { status: 400 });
    return new Response(JSON.stringify({ access_token: "dat-" + randomBytes(4).toString("hex"), refresh_token: "drt-" + randomBytes(4).toString("hex") }), { status: 200 });
  }
  if (url.includes("/guilds/guild-1/member")) return new Response(JSON.stringify({ roles: discordRoles, user: discordUser }), { status: 200 });
  return new Response("not found", { status: 404 });
};

// ---- metadata ---------------------------------------------------------------
{
  const prm = await call(oauth.protectedResourceMetadata, {});
  assert.equal(prm.body.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(prm.body.authorization_servers, [ORIGIN]);
  const asm = await call(oauth.authorizationServerMetadata, {});
  assert.equal(asm.body.issuer, ORIGIN);
  assert.deepEqual(asm.body.code_challenge_methods_supported, ["S256"]);
  assert.equal(asm.body.registration_endpoint, `${ORIGIN}/oauth/register`);
  // Routed through the auth function, as vercel.json rewrites do.
  const routed = await call(authHandler, { query: { action: "mcp-meta", kind: "resource" } });
  assert.equal(routed.body.resource, `${ORIGIN}/mcp`);
}

// ---- registration -----------------------------------------------------------
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
let clientId;
{
  for (const bad of [["javascript:alert(1)"], ["http://evil.example/cb"], ["https://x.example/cb#frag"], []]) {
    const r = await call(oauth.register, { method: "POST", body: { redirect_uris: bad } });
    assert.equal(r.statusCode, 400, "rejects " + JSON.stringify(bad));
  }
  const ok = await call(oauth.register, { method: "POST", body: { redirect_uris: [REDIRECT, "http://localhost:6274/oauth/callback"], client_name: "ChatGPT" } });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.body.token_endpoint_auth_method, "none");
  clientId = ok.body.client_id;
}

// ---- authorize --------------------------------------------------------------
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authQuery = { client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "client-state", resource: `${ORIGIN}/mcp`, scope: "mingstreet.owner" };
{
  const badRedirect = await call(oauth.authorize, { query: { ...authQuery, redirect_uri: "https://evil.example/cb" } });
  assert.equal(badRedirect.statusCode, 400);
  assert.match(badRedirect.body, /did not register/);
  const badClient = await call(oauth.authorize, { query: { ...authQuery, client_id: "forged" } });
  assert.equal(badClient.statusCode, 400);
  // Malformed requests never redirect (no open redirector before consent).
  const noPkce = await call(oauth.authorize, { query: { ...authQuery, code_challenge: undefined } });
  assert.equal(noPkce.statusCode, 400);
  assert.match(noPkce.body, /PKCE/);
  const badResource = await call(oauth.authorize, { query: { ...authQuery, resource: "https://other.example/mcp" } });
  assert.equal(badResource.statusCode, 400);
  assert.equal(badResource.headers.location, undefined);
}

async function fullLogin() {
  const consentPage = await call(oauth.authorize, { query: authQuery });
  assert.equal(consentPage.statusCode, 200);
  assert.match(consentPage.body, /Connect “ChatGPT” to Mingstreet/);
  assert.match(consentPage.body, /chatgpt\.com/);
  const consent = decodeURIComponent(/consent=([^"]+)"/.exec(consentPage.body)[1]);
  const toDiscord = await call(oauth.authorize, { query: { consent } });
  assert.equal(toDiscord.statusCode, 302);
  const discordUrl = new URL(toDiscord.headers.location);
  assert.equal(discordUrl.hostname, "discord.com");
  assert.equal(discordUrl.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/discord-callback`);
  const jar = cookiesFrom(toDiscord);
  assert.ok(jar.stonks_mcp_pending && jar.stonks_oauth_state);
  const cb = await call(authHandler, { query: { action: "discord-callback", code: "discord-code", state: discordUrl.searchParams.get("state") }, headers: { cookie: cookieHeader(jar) } });
  return { cb, jar, discordState: discordUrl.searchParams.get("state") };
}

let accessToken, refreshToken;
{
  const { cb } = await fullLogin();
  assert.equal(cb.statusCode, 302);
  const back = new URL(cb.headers.location);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "client-state");
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  const set = cookiesFrom(cb);
  assert.equal(set.stonks_session, undefined, "MCP login does not mint a site session");
  const code = back.searchParams.get("code");

  const wrongVerifier = await call(oauth.token, { method: "POST", body: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: randomBytes(32).toString("base64url") } });
  assert.equal(wrongVerifier.body.error, "invalid_grant");
  const other = (await call(oauth.register, { method: "POST", body: { redirect_uris: [REDIRECT] } })).body.client_id;
  const wrongClient = await call(oauth.token, { method: "POST", body: { grant_type: "authorization_code", code, client_id: other, redirect_uri: REDIRECT, code_verifier: verifier } });
  assert.equal(wrongClient.body.error, "invalid_grant");
  const tok = await call(oauth.token, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${ORIGIN}/mcp` }).toString() });
  assert.equal(tok.statusCode, 200, JSON.stringify(tok.body));
  assert.equal(tok.body.token_type, "Bearer");
  accessToken = tok.body.access_token;
  refreshToken = tok.body.refresh_token;
}

// A stale pending cookie never hijacks an ordinary site login.
{
  const { jar } = await fullLogin();
  const siteState = "site-login-state";
  const cb = await call(authHandler, { query: { action: "discord-callback", code: "c", state: siteState }, headers: { cookie: cookieHeader({ ...jar, stonks_oauth_state: siteState }) } });
  assert.equal(cb.headers.location, "/?tab=quant");
  assert.ok(cookiesFrom(cb).stonks_session);
}
// Non-owner Discord accounts never get a code.
{
  discordRoles = ["someone-else"];
  const { cb } = await fullLogin();
  assert.match(cb.headers.location, /denied=role/);
  discordRoles = ["owner-role"];
}

// ---- /mcp ---------------------------------------------------------------------
const auth = { authorization: `Bearer ${accessToken}` };
async function rpc(method, params, { headers = auth, extra = {} } = {}) {
  const r = await call((req, res) => handleMcpRequest(req, res, deps(extra)), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: { jsonrpc: "2.0", id: 1, method, params } });
  return r;
}
{
  const anon = await rpc("tools/list", {}, { headers: {} });
  assert.equal(anon.statusCode, 401);
  assert.match(anon.headers["www-authenticate"], /resource_metadata="https:\/\/mingstreet\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  const forged = await rpc("tools/list", {}, { headers: { authorization: "Bearer abc.def.ghi" } });
  assert.equal(forged.statusCode, 401);
  assert.match(forged.headers["www-authenticate"], /invalid_token/);
  // A token minted for another origin (audience) is refused.
  const otherOrigin = await call((req, res) => handleMcpRequest(req, res, deps()), { method: "POST", headers: { ...auth, host: "preview.example" }, body: { jsonrpc: "2.0", id: 1, method: "ping" } });
  assert.equal(otherOrigin.statusCode, 401);
  // Revoke-all switch.
  assert.equal((await rpc("ping", {}, { extra: { MCP_TOKEN_VERSION: "2" } })).statusCode, 401);
  // Kill switch.
  assert.equal((await rpc("ping", {}, { extra: { MCP_ENABLED: "0" } })).statusCode, 404);

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.headers["mcp-session-id"], undefined);
  assert.equal((await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "old", version: "1" } })).body.result.protocolVersion, "2024-11-05");
  const initUnknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(initUnknown.body.result.protocolVersion, "2025-11-25");
  const disc = await rpc("server/discover", { _meta: { "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" } } }, { headers: { ...auth, "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" } });
  assert.deepEqual(disc.body.result.supportedVersions, SUPPORTED_VERSIONS);
  const mismatch = await rpc("tools/list", {}, { headers: { ...auth, "mcp-method": "tools/call" } });
  assert.equal(mismatch.statusCode, 400);
  const badVersion = await rpc("tools/list", {}, { headers: { ...auth, "mcp-protocol-version": "2024-01-01" } });
  assert.equal(badVersion.statusCode, 400);
  const evil = await rpc("ping", {}, { headers: { ...auth, origin: "https://evil.example" } });
  assert.equal(evil.statusCode, 403);
  const note = await call((req, res) => handleMcpRequest(req, res, deps()), { method: "POST", headers: auth, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
  assert.equal(note.statusCode, 202);
  const batch = await call((req, res) => handleMcpRequest(req, res, deps()), { method: "POST", headers: auth, body: [{ jsonrpc: "2.0", id: 1, method: "ping" }] });
  assert.equal(batch.statusCode, 400);
  const get = await call((req, res) => handleMcpRequest(req, res, deps()), { method: "GET", headers: auth });
  assert.equal(get.statusCode, 405);

  const list = await rpc("tools/list", {});
  const names = list.body.result.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), TOOLS.map((t) => t.name).sort());
  assert.ok(list.body.result.tools.every((t) => t.annotations.readOnlyHint === true));
}

async function tool(name, args, opts) {
  const r = await rpc("tools/call", { name, arguments: args }, opts);
  return r.body.result ?? r.body;
}
{
  const lf = await tool("list_features", {});
  assert.equal(lf.isError, false);
  const feats = lf.structuredContent.results.features;
  assert.ok(feats.find((f) => f.id === "market" && f.access === "owner"));
  assert.ok(lf.structuredContent.results.covered_symbols.includes("NVDA"));

  const brief = await tool("get_feature", { feature_id: "brief" });
  assert.equal(brief.isError, false);
  assert.equal(brief.structuredContent.ai_calls, 0);
  assert.equal(brief.structuredContent.as_of, "2026-11-02T14:00:00Z");
  assert.ok(Buffer.byteLength(brief.content[0].text) <= 60_000);
  const briefNvda = await tool("get_feature", { feature_id: "brief", ticker: "nvda" });
  assert.equal(briefNvda.structuredContent.results.matches.length, 1);
  const pathed = await tool("get_feature", { feature_id: "market", path: "macroRegime" });
  assert.equal(pathed.structuredContent.results.band, "risk-on");
  assert.equal(pathed.structuredContent.access, "owner");
  for (const id of ["picks-fills", "webull-paper-ledger", "../picks-fills"]) {
    const denied = await tool("get_feature", { feature_id: id });
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.error.code, "NOT_FOUND");
  }
  const redirect = await tool("get_feature", { feature_id: "track" });
  assert.equal(redirect.structuredContent.error.code, "USE_TOOL");
  const extraArg = await tool("get_feature", { feature_id: "brief", key: "picks-fills.json" });
  assert.equal(extraArg.structuredContent.error.code, "INVALID_INPUT");

  const stock = await tool("get_stock", { ticker: "NVDA" });
  assert.equal(stock.isError, false);
  const text = stock.content[0].text;
  assert.ok(!text.includes("must-not-leak"), "secret-named fields are dropped");
  assert.ok(stock.structuredContent.results.available_sections.some((s) => s.section === "bigSection"));
  assert.equal(stock.structuredContent.results.data.bigSection, undefined);
  const stockFull = await tool("get_stock", { ticker: "NVDA", sections: ["bigSection", "sessionToken"] });
  assert.ok(stockFull.structuredContent.results.data.bigSection);
  assert.ok(!stockFull.content[0].text.includes("must-not-leak"));
  const uncovered = await tool("get_stock", { ticker: "ZZZZ" });
  assert.equal(uncovered.structuredContent.error.code, "NOT_COVERED");

  const ph = await tool("get_price_history", { ticker: "NVDA", bars: 2 });
  assert.deepEqual(ph.structuredContent.results.bars.map((b) => b.c), [195, 200]);

  const grades = await tool("get_stock_grades", { side: "call" });
  assert.deepEqual(grades.structuredContent.results.rows.map((r) => r.symbol), ["NVDA"]);
  assert.equal(grades.structuredContent.results.rows[0].pillars.trend, 3);

  const quotes = await tool("get_live_quotes", { tickers: ["NVDA", "AAPL"] });
  assert.equal(quotes.structuredContent.results.quotes.length, 2);
  const tooMany = await tool("get_live_quotes", { tickers: Array.from({ length: 11 }, () => "NVDA") });
  assert.equal(tooMany.structuredContent.error.code, "INVALID_INPUT");

  const tp = await tool("get_top_picks", {});
  assert.equal(tp.structuredContent.results.picks[0].symbol, "NVDA");
  const tr = await tool("get_track_record", {});
  assert.equal(tr.isError, false, JSON.stringify(tr));
  const trr = tr.structuredContent.results;
  assert.equal(trr.open_count, 1);
  assert.equal(trr.stats.wins, 1);
  assert.equal(trr.all_time_stats.closed, 40);
  assert.equal(trr.open_trades[0].id, "NVDA-C-10/28/26-11:05");
  assert.equal(trr.open_trades[0].entry_price, 10);
  assert.equal(trr.open_trades[0].mark_price, 11.2);
  assert.equal(trr.open_trades[0].marks, undefined, "compact rows drop mark histories");
  assert.deepEqual(trr.recent_closed.map((r) => r.symbol), ["AAPL", "MSFT"], "newest close first");
  assert.equal(trr.recent_closed[0].long_strike, 230);
  assert.ok(trr.trade_lines.includes("NVDA-C-10/28/26-11:05"));

  // ---- page datasets ----
  const lf2 = await tool("list_features", {});
  assert.ok(lf2.structuredContent.results.features.find((f) => f.id === "calls").datasets.includes("transcript"));
  const tx = await tool("get_feature", { feature_id: "calls", dataset: "transcript", ticker: "nvda" });
  assert.equal(tx.isError, false, JSON.stringify(tx));
  assert.equal(tx.structuredContent.results.summary, "Strong quarter", "per-stock dataset returned whole, not ticker-filtered");
  assert.equal(tx.structuredContent.results.session, "regular", "a plain 'session' field is not treated as a secret");
  assert.equal((await tool("get_feature", { feature_id: "calls", dataset: "transcript" })).structuredContent.error.code, "INVALID_INPUT");
  assert.equal((await tool("get_feature", { feature_id: "calls", dataset: "transcript", ticker: "ZZZZ" })).structuredContent.error.code, "NOT_COVERED");
  assert.equal((await tool("get_feature", { feature_id: "calls", dataset: "nope" })).structuredContent.error.code, "NOT_FOUND");
  const ch = await tool("get_feature", { feature_id: "track", dataset: "changes" });
  assert.equal(ch.isError, false, "a dedicated page's extra dataset is readable");
  assert.equal(ch.structuredContent.access, "owner");
  const rh = await tool("get_feature", { feature_id: "market", dataset: "regime-history" });
  assert.equal(rh.structuredContent.results.days[0].band, "risk-on");
  const use = await tool("get_feature", { feature_id: "unified-signal-engine" });
  assert.ok(use.structuredContent.warnings.some((w) => w.startsWith("EXPIRED")), "validUntil in the past is flagged");
}

// ---- anonymous public mode (off by default) ----------------------------------
{
  const pub = { headers: {}, extra: { MCP_PUBLIC_ACCESS: "1" } };
  const list = await rpc("tools/list", {}, pub);
  assert.equal(list.statusCode, 200);
  const names = list.body.result.tools.map((t) => t.name);
  for (const owner of ["get_stock", "get_stock_grades", "get_top_picks", "get_track_record"]) assert.ok(!names.includes(owner), owner + " hidden");
  assert.ok(!JSON.stringify(list.body).includes("track record"), "owner descriptions hidden");
  const lf = await tool("list_features", {}, pub);
  assert.ok(lf.structuredContent.results.features.every((f) => f.access === "public"));
  assert.equal((await tool("get_feature", { feature_id: "market" }, pub)).structuredContent.error.code, "FORBIDDEN");
  assert.equal((await tool("get_feature", { feature_id: "narratives" }, pub)).structuredContent.error.code, "FORBIDDEN");
  const guess = await rpc("tools/call", { name: "get_track_record", arguments: {} }, pub);
  assert.equal(guess.body.error.code, -32602, "owner tool name guess looks like an unknown tool");
  assert.equal((await tool("get_feature", { feature_id: "brief" }, pub)).isError, false);
  assert.equal((await tool("get_feature", { feature_id: "calls", dataset: "transcript", ticker: "NVDA" }, pub)).isError, false);
  assert.equal((await tool("get_feature", { feature_id: "track", dataset: "changes" }, pub)).structuredContent.error.code, "FORBIDDEN");
  assert.equal((await tool("get_feature", { feature_id: "market", dataset: "regime-history" }, pub)).structuredContent.error.code, "FORBIDDEN");
}

// ---- refresh re-checks the owner role ----------------------------------------
{
  const basic = "Basic " + Buffer.from(encodeURIComponent(clientId) + ":").toString("base64");
  const ok = await call(oauth.token, { method: "POST", headers: { authorization: basic }, body: { grant_type: "refresh_token", refresh_token: refreshToken, resource: `${ORIGIN}/mcp/` } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.access_token && ok.body.refresh_token);
  discordRoles = [];
  const downgraded = await call(oauth.token, { method: "POST", body: { grant_type: "refresh_token", refresh_token: ok.body.refresh_token, client_id: clientId } });
  assert.equal(downgraded.body.error, "invalid_grant");
  discordRoles = ["owner-role"];
  const garbage = await call(oauth.token, { method: "POST", body: { grant_type: "refresh_token", refresh_token: accessToken, client_id: clientId } });
  assert.equal(garbage.body.error, "invalid_grant", "an access token is not a refresh token");
}

// ---- bounded output ------------------------------------------------------------
{
  const huge = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, text: "z".repeat(500), nested: { a: { b: { c: { d: { e: 1 } } } } } })) };
  const b = boundedJson(huge);
  assert.ok(Buffer.byteLength(JSON.stringify(b.value)) <= 48_000);
  assert.equal(b.reduced, true);
}

console.log("mcp-smoke: ok");

// lib/mcp/server.mjs — the Mingstreet MCP endpoint (POST /mcp).
//
// Stateless Streamable HTTP, JSON responses (one SSE-framed message for a
// client that accepts only text/event-stream), no session IDs, batches OK:
//   * 2026-07-28 clients: per-request metadata, `server/discover`, and the
//     Mcp-Method / Mcp-Name headers (checked against the body when present).
//   * 2025-03-26 / 2025-06-18 / 2025-11-25 clients: `initialize` negotiates a
//     version; no Mcp-Session-Id is issued, so every request stands alone.
// Both families then use tools/list and tools/call. Every request is
// authorized on its own from the bearer token (lib/mcp/oauth.mjs).

import { createHash } from "node:crypto";
import { mcpEnabled, mcpOrigin, resourceMetadataUrl, verifyBearer } from "./oauth.mjs";
import { toolsFor, toolDefinition, validateArgs, ToolError, TOOLS } from "./tools.mjs";
import { readOnlyStore, sportsReadOnlyStore } from "./read-only-store.mjs";

export const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LEGACY_DEFAULT = "2025-11-25";
const MAX_BODY_BYTES = 64 * 1024;
const CALLS_PER_MINUTE = 120;
const LIVE_CALLS_PER_MINUTE = 20;
const LIVE_TOOLS = new Set(["get_live_quotes", "get_top_picks", "get_near_misses"]);
const SERVER_INFO = { name: "mingstreet", title: "Mingstreet research", version: "1.2.0" };
const INSTRUCTIONS =
  "Mingstreet (mingstreet.app) is a stock and options research site covering about 85 US stocks and ETFs. " +
  "Call list_features first: it names every page, the tool that reads it and the extra `datasets` behind it. " +
  "Data is saved research from scheduled site builds (several times per trading day), " +
  "so check `as_of` and `warnings` in every result and use get_live_quotes for current prices. " +
  "get_top_picks returns compact rows; pass `symbol` for one pick in full. get_option_chain reads a stock's saved option chain. " +
  "search and fetch find and read pages and stocks by keyword. " +
  "Everything is read-only research, not investment advice; no orders can be placed. " +
  "Owners also get sports_* tools for the private NBA/NFL Sports section: find players and games, read logs and forecasts, " +
  "and check a pick'em entry (it returns a Pick Builder link to save it on the site; nothing is saved or placed from here).";

// Browser-based MCP clients (ChatGPT, Claude, Le Chat, Copilot, the MCP
// Inspector, ...) send an Origin. Access is a bearer token in the
// Authorization header, never a cookie, so a page on another site cannot ride
// the owner's login: any https origin (and a local inspector) may call, and
// still needs its own token. Plain http from a non-local host is refused.
const ALLOWED_BROWSER_ORIGINS = [/^https:\/\/[a-z0-9.-]+(:\d+)?$/i, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/];

// Per-instance call budget. Vercel instances are short-lived, so this only
// blunts bursts; owner-only access and zero AI calls are the real cost guard.
const buckets = new Map();
function overBudget(subject, now, limit) {
  const minute = Math.floor(now / 60_000);
  const b = buckets.get(subject);
  if (!b || b.minute !== minute) {
    if (buckets.size > 500) buckets.clear();
    buckets.set(subject, { minute, n: 1 });
    return false;
  }
  return ++b.n > limit;
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

function originAllowed(req, origin) {
  const o = req.headers?.origin;
  if (!o) return true;
  return o === origin || ALLOWED_BROWSER_ORIGINS.some((re) => re.test(o));
}

function setCors(req, res) {
  const o = req.headers?.origin;
  if (!o) return;
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id");
  res.setHeader("Access-Control-Max-Age", "600");
}

function unauthorized(req, res, env, error) {
  const origin = mcpOrigin(req, env);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl(origin)}", scope="mingstreet.owner"${error ? `, error="${error}"` : ""}`,
  );
  return res.status(401).json(rpcError(null, -32001, "Sign in to Mingstreet to use this server"));
}

function readJsonBody(req) {
  let b;
  try { b = req.body; } catch { return { error: "parse" }; } // Vercel's getter throws on bad JSON
  if (b == null || b === "") return { error: "empty" };
  if (typeof b === "string" || Buffer.isBuffer(b)) {
    const text = b.toString();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { error: "too_large" };
    try { return { body: JSON.parse(text) }; } catch { return { error: "parse" }; }
  }
  if (typeof b === "object") {
    if (Buffer.byteLength(JSON.stringify(b)) > MAX_BODY_BYTES) return { error: "too_large" };
    return { body: b };
  }
  return { error: "parse" };
}

function principalLabel(p) {
  if (p.via === "owner-key") return "owner-key";
  return p.sub ? createHash("sha256").update(p.sub).digest("base64url").slice(0, 12) : "anon";
}

function textResult(envelope) {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: false,
  };
}

function toolErrorResult(code, message) {
  const payload = { error: { code, message } };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: true };
}

// Some clients accept only an event stream; they get the same single reply
// framed as one SSE message. Everyone else gets plain JSON.
function wantsEventStream(req) {
  const accept = String(req.headers?.accept || "").toLowerCase();
  return accept.includes("text/event-stream") && !accept.includes("application/json") && !accept.includes("*/*");
}

function send(req, res, status, body) {
  if (body == null) return res.status(status).end();
  if (status === 200 && wantsEventStream(req)) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    return res.status(200).end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
  }
  return res.status(status).json(body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// A person who opens /mcp in a browser gets a short page saying what it is and
// how to add it, instead of a bare 405. It names no tools (they are Owner-only).
function infoPage(res, origin) {
  const url = escapeHtml(`${origin}/mcp`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mingstreet MCP server</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1b1b1f;background:#fff}code{background:#f1f1f4;padding:2px 5px;border-radius:4px}@media (prefers-color-scheme:dark){body{color:#e8e8ec;background:#141417}code{background:#26262b}}</style></head>
<body><h1>Mingstreet MCP server</h1><p>This address is for AI apps, not browsers. Add <code>${url}</code> as a custom connector (remote MCP server, Streamable HTTP) in ChatGPT, Claude, Cursor, VS Code, Gemini CLI or any other MCP client, then sign in with Discord.</p>
<p>Access is Owner-only and read-only. Server details: <code>${escapeHtml(origin)}/.well-known/mcp.json</code>. Setup guide: <code>docs/mcp.md</code> in the site repository.</p></body></html>`);
}

// /.well-known/mcp.json (and /.well-known/mcp/server-card.json): a public
// description of this server for AI apps, registries and people setting one
// up: where to connect, which transport and how to sign in. It names no tools
// (they are Owner-only) and reveals nothing an unauthenticated 401 does not.
export function serverCard(req, res, { env = process.env } = {}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!mcpEnabled(env) || env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  const origin = mcpOrigin(req, env);
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    name: "app.mingstreet/research",
    title: SERVER_INFO.title,
    description: "Read-only stock and options research from mingstreet.app (about 85 US stocks and ETFs): grades, Top Picks, option chains, flow, macro and more. Owner-only.",
    version: SERVER_INFO.version,
    websiteUrl: origin,
    remotes: [{ type: "streamable-http", url: `${origin}/mcp` }],
    protocolVersions: SUPPORTED_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    authentication: {
      required: true,
      schemes: ["oauth2", "bearer"],
      oauth2: { protectedResourceMetadata: resourceMetadataUrl(origin), authorizationServer: origin, dynamicClientRegistration: true, pkce: "S256", scopes: ["mingstreet.owner"] },
      bearer: "Optional Owner key for clients without OAuth; off unless the site owner turns it on.",
    },
    readOnly: true,
    aiCalls: 0,
  });
}

const MAX_BATCH = 20;
// Tool calls run one after another inside one function run (10 s on Vercel
// Hobby), so a batch may carry only a few of them.
const MAX_BATCH_TOOL_CALLS = 4;

export async function handleMcpRequest(req, res, deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || Date.now;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const origin = mcpOrigin(req, env);
  setCors(req, res);

  if (!mcpEnabled(env) || env.PRIVATE_DATA_ENABLED !== "1") return res.status(404).json({ error: "not found" });
  if (!originAllowed(req, origin)) return res.status(403).json(rpcError(null, -32000, "Origin not allowed"));
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET" && /text\/html/i.test(String(req.headers?.accept || "")) && !/text\/event-stream/i.test(String(req.headers?.accept || ""))) {
    return infoPage(res, origin);
  }
  if (req.method !== "POST") {
    // No server-initiated stream: this server never pushes messages.
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json(rpcError(null, -32000, "Use POST for MCP requests"));
  }

  // --- authorization: every request on its own -----------------------------
  let principal = await verifyBearer(req, env).catch(() => null);
  if (!principal) {
    if (req.headers?.authorization) return unauthorized(req, res, env, "invalid_token");
    if (env.MCP_PUBLIC_ACCESS !== "1") return unauthorized(req, res, env);
    principal = { sub: null, name: null, client: null, owner: false };
  }

  // --- protocol checks --------------------------------------------------------
  const headerVersion = req.headers?.["mcp-protocol-version"];
  if (headerVersion && !SUPPORTED_VERSIONS.includes(String(headerVersion))) {
    return res.status(400).json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version ${headerVersion}`, { supported: SUPPORTED_VERSIONS }));
  }
  const parsed = readJsonBody(req);
  if (parsed.error === "too_large") return res.status(413).json(rpcError(null, -32600, "Request too large"));
  if (parsed.error) return res.status(400).json(rpcError(null, -32700, "Parse error"));
  const msg = parsed.body;
  const ctx = { req, res, env, now, origin, principal, deps };

  // JSON-RPC batches (sent by some 2025-03-26 clients): each message is
  // answered on its own; notifications in the batch get no entry.
  if (Array.isArray(msg)) {
    if (!msg.length || msg.length > MAX_BATCH) return res.status(400).json(rpcError(null, -32600, `A batch needs 1 to ${MAX_BATCH} messages`));
    const replies = [];
    let toolCalls = 0;
    for (const one of msg) {
      if (one?.method === "tools/call" && ++toolCalls > MAX_BATCH_TOOL_CALLS && one.id != null) {
        replies.push(rpcError(one.id, -32600, `At most ${MAX_BATCH_TOOL_CALLS} tool calls per batch; send the rest separately`));
        continue;
      }
      const r = await dispatch(one, ctx, { batch: true });
      if (r.body) replies.push(r.body);
    }
    return replies.length ? send(req, res, 200, replies) : res.status(202).end();
  }
  const r = await dispatch(msg, ctx, { batch: false });
  if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  return send(req, res, r.status, r.body);
}

async function dispatch(msg, { req, env, now, origin, principal, deps }, { batch }) {
  const reply = (status, body, headers) => ({ status, body, headers });
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return reply(400, rpcError(msg?.id, -32600, "Invalid request"));
  }
  if (!batch) {
    const headerMethod = req.headers?.["mcp-method"];
    if (headerMethod && headerMethod !== msg.method) return reply(400, rpcError(msg.id, -32600, "Mcp-Method header does not match the request body"));
    const headerName = req.headers?.["mcp-name"];
    if (headerName && msg.method === "tools/call" && headerName !== msg.params?.name) {
      return reply(400, rpcError(msg.id, -32600, "Mcp-Name header does not match the tool name"));
    }
  }

  // Notifications and client responses get 202 with no body.
  if (msg.id === undefined || msg.id === null) return reply(202, null);
  if (!["string", "number"].includes(typeof msg.id)) return reply(400, rpcError(null, -32600, "Invalid id"));

  const id = msg.id;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const capabilities = { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } };

  switch (msg.method) {
    case "initialize": {
      const requested = String(params.protocolVersion || "");
      const version = SUPPORTED_VERSIONS.includes(requested) ? requested : LEGACY_DEFAULT;
      return reply(200, rpcResult(id, { protocolVersion: version, capabilities, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }), { "MCP-Protocol-Version": version });
    }
    case "server/discover":
      return reply(200, rpcResult(id, { supportedVersions: SUPPORTED_VERSIONS, capabilities, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }));
    case "ping":
      return reply(200, rpcResult(id, {}));
    case "logging/setLevel":
      // Nothing is logged to clients; accept so clients that set a level go on.
      return reply(200, rpcResult(id, {}));
    case "tools/list": {
      // Filtered per principal: an anonymous caller never sees Owner tool
      // names, arguments or descriptions.
      const list = toolsFor(principal, env).map(toolDefinition);
      return reply(200, rpcResult(id, { tools: list, ttlMs: 300_000, cacheScope: "private" }));
    }
    case "resources/list":
      return reply(200, rpcResult(id, { resources: [] }));
    case "resources/templates/list":
      return reply(200, rpcResult(id, { resourceTemplates: [] }));
    case "prompts/list":
      return reply(200, rpcResult(id, { prompts: [] }));
    case "completion/complete":
      return reply(200, rpcResult(id, { completion: { values: [], hasMore: false } }));
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsFor(principal, env).find((t) => t.name === name);
      const started = now();
      if (!tool) {
        // Same answer whether the tool is Owner-only or does not exist.
        log({ tool: name.slice(0, 40), outcome: "unknown_tool", who: principalLabel(principal), client: principal.client });
        return reply(200, rpcError(id, -32602, `Unknown tool: ${name.slice(0, 60)}`));
      }
      if (overBudget(principal.sub || "anon", started, CALLS_PER_MINUTE)) {
        return reply(200, rpcResult(id, toolErrorResult("QUOTA_EXCEEDED", `Over ${CALLS_PER_MINUTE} calls per minute; wait a moment`)));
      }
      // Tools that call Yahoo get a tighter budget so an agent can't get the
      // site's shared Yahoo access throttled for real visitors.
      if (LIVE_TOOLS.has(name) && overBudget(`live:${principal.sub || "anon"}`, started, LIVE_CALLS_PER_MINUTE)) {
        return reply(200, rpcResult(id, toolErrorResult("QUOTA_EXCEEDED", `Live tools are limited to ${LIVE_CALLS_PER_MINUTE} calls per minute; wait a moment`)));
      }
      // Tools only ever see a get-only store (lib/mcp/read-only-store.mjs);
      // Sports tools get one that reads Sports records and nothing else.
      const base = deps.store || (await import("../datastore.mjs")).store;
      const store = readOnlyStore(base);
      const ctx = { principal, store, sportsStore: sportsReadOnlyStore(base), env, origin, now, fetchQuote: deps.fetchQuote, topPicksLive: deps.topPicksLive, loadPropSources: deps.loadPropSources };
      try {
        const args = validateArgs(tool.inputSchema, params.arguments);
        const envelope = await tool.run(ctx, args);
        log({ tool: name, outcome: "ok", ms: now() - started, who: principalLabel(principal), client: principal.client });
        return reply(200, rpcResult(id, textResult(envelope)));
      } catch (err) {
        const code = err instanceof ToolError ? err.code : "UNAVAILABLE";
        const message = err instanceof ToolError ? err.message : "Mingstreet data is temporarily unavailable; try again shortly";
        if (!(err instanceof ToolError)) console.error("mcp tool failed", { tool: name, message: String(err?.message || err).slice(0, 300) });
        log({ tool: name, outcome: code, ms: now() - started, who: principalLabel(principal), client: principal.client });
        return reply(200, rpcResult(id, toolErrorResult(code, message)));
      }
    }
    default:
      return reply(200, rpcError(id, -32601, `Method not found: ${String(msg.method).slice(0, 60)}`));
  }
}

function log(fields) {
  console.log(JSON.stringify({ evt: "mcp.call", ...fields }));
}

export { TOOLS };

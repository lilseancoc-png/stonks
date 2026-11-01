// lib/mcp/server.mjs — the Mingstreet MCP endpoint (POST /mcp).
//
// Stateless Streamable HTTP, JSON responses only (no SSE, no session IDs):
//   * 2026-07-28 clients: per-request metadata, `server/discover`, and the
//     Mcp-Method / Mcp-Name headers (checked against the body when present).
//   * 2025-03-26 / 2025-06-18 / 2025-11-25 clients: `initialize` negotiates a
//     version; no Mcp-Session-Id is issued, so every request stands alone.
// Both families then use tools/list and tools/call. Every request is
// authorized on its own from the bearer token (lib/mcp/oauth.mjs).

import { createHash } from "node:crypto";
import { mcpEnabled, mcpOrigin, resourceMetadataUrl, verifyBearer } from "./oauth.mjs";
import { toolsFor, toolDefinition, validateArgs, ToolError, TOOLS } from "./tools.mjs";

export const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const LEGACY_DEFAULT = "2025-11-25";
const MAX_BODY_BYTES = 64 * 1024;
const CALLS_PER_MINUTE = 120;
const SERVER_INFO = { name: "mingstreet", title: "Mingstreet research", version: "1.0.0" };
const INSTRUCTIONS =
  "Mingstreet (mingstreet.app) is a stock and options research site covering about 85 US stocks and ETFs. " +
  "Call list_features first. Data is saved research from scheduled site builds (several times per trading day), " +
  "so check `as_of` and `warnings` in every result and use get_live_quotes for current prices. " +
  "Everything is read-only research, not investment advice; no orders can be placed.";

const ALLOWED_BROWSER_ORIGINS = [/^https:\/\/(www\.)?mingstreet\.app$/, /^https:\/\/chatgpt\.com$/, /^https:\/\/(.+\.)?claude\.ai$/, /^https:\/\/(.+\.)?claude\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// Per-instance call budget. Vercel instances are short-lived, so this only
// blunts bursts; owner-only access and zero AI calls are the real cost guard.
const buckets = new Map();
function overBudget(subject, now) {
  const minute = Math.floor(now / 60_000);
  const b = buckets.get(subject);
  if (!b || b.minute !== minute) {
    buckets.set(subject, { minute, n: 1 });
    if (buckets.size > 500) buckets.clear();
    return false;
  }
  return ++b.n > CALLS_PER_MINUTE;
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
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
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
  if (Array.isArray(msg)) return res.status(400).json(rpcError(null, -32600, "Batch requests are not supported"));
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return res.status(400).json(rpcError(msg?.id, -32600, "Invalid request"));
  }
  const headerMethod = req.headers?.["mcp-method"];
  if (headerMethod && headerMethod !== msg.method) return res.status(400).json(rpcError(msg.id, -32600, "Mcp-Method header does not match the request body"));
  const headerName = req.headers?.["mcp-name"];
  if (headerName && msg.method === "tools/call" && headerName !== msg.params?.name) {
    return res.status(400).json(rpcError(msg.id, -32600, "Mcp-Name header does not match the tool name"));
  }

  // Notifications and client responses get 202 with no body.
  if (msg.id === undefined || msg.id === null) {
    return res.status(202).end();
  }
  if (!["string", "number"].includes(typeof msg.id)) return res.status(400).json(rpcError(null, -32600, "Invalid id"));

  const id = msg.id;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const capabilities = { tools: { listChanged: false } };

  switch (msg.method) {
    case "initialize": {
      const requested = String(params.protocolVersion || "");
      const version = SUPPORTED_VERSIONS.includes(requested) ? requested : LEGACY_DEFAULT;
      res.setHeader("MCP-Protocol-Version", version);
      return res.status(200).json(rpcResult(id, { protocolVersion: version, capabilities, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }));
    }
    case "server/discover":
      return res.status(200).json(rpcResult(id, { supportedVersions: SUPPORTED_VERSIONS, capabilities, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }));
    case "ping":
      return res.status(200).json(rpcResult(id, {}));
    case "tools/list": {
      // Filtered per principal: an anonymous caller never sees Owner tool
      // names, arguments or descriptions.
      const list = toolsFor(principal).map(toolDefinition);
      return res.status(200).json(rpcResult(id, { tools: list, ttlMs: 300_000, cacheScope: "private" }));
    }
    case "resources/list":
      return res.status(200).json(rpcResult(id, { resources: [] }));
    case "prompts/list":
      return res.status(200).json(rpcResult(id, { prompts: [] }));
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsFor(principal).find((t) => t.name === name);
      const started = now();
      if (!tool) {
        // Same answer whether the tool is Owner-only or does not exist.
        log({ tool: name.slice(0, 40), outcome: "unknown_tool", who: principalLabel(principal), client: principal.client });
        return res.status(200).json(rpcError(id, -32602, `Unknown tool: ${name.slice(0, 60)}`));
      }
      if (overBudget(principal.sub || "anon", started)) {
        return res.status(200).json(rpcResult(id, toolErrorResult("QUOTA_EXCEEDED", `Over ${CALLS_PER_MINUTE} calls per minute; wait a moment`)));
      }
      const store = deps.store || (await import("../datastore.mjs")).store;
      const ctx = { principal, store, now, fetchQuote: deps.fetchQuote, topPicks: deps.topPicks };
      try {
        const args = validateArgs(tool.inputSchema, params.arguments);
        const envelope = await tool.run(ctx, args);
        log({ tool: name, outcome: "ok", ms: now() - started, who: principalLabel(principal), client: principal.client });
        return res.status(200).json(rpcResult(id, textResult(envelope)));
      } catch (err) {
        const code = err instanceof ToolError ? err.code : "UNAVAILABLE";
        const message = err instanceof ToolError ? err.message : "Mingstreet data is temporarily unavailable; try again shortly";
        if (!(err instanceof ToolError)) console.error("mcp tool failed", { tool: name, message: String(err?.message || err).slice(0, 300) });
        log({ tool: name, outcome: code, ms: now() - started, who: principalLabel(principal), client: principal.client });
        return res.status(200).json(rpcResult(id, toolErrorResult(code, message)));
      }
    }
    default:
      return res.status(200).json(rpcError(id, -32601, `Method not found: ${String(msg.method).slice(0, 60)}`));
  }
}

function log(fields) {
  console.log(JSON.stringify({ evt: "mcp.call", ...fields }));
}

export { TOOLS };

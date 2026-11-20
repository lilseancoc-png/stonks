// Live endpoint probes for the Update Checker (2026-11-20).
//
// Why: the MCP server, its server card and the AI-disruption review endpoint
// crashed on load on Vercel from #840 (2026-11-16) to 2026-11-20 and nothing
// noticed, because every check read workflow runs and stored files, never the
// deployed functions themselves. These probes ask the live site a few
// signed-out questions every scan and flag any answer of 500 or worse.
//
// Read-only and cheap: GET only, no cookies, no tokens, no AI, no provider
// call (no quote or chain endpoints, which would call Yahoo). A signed-out
// request to an Owner endpoint should get 401; a crash gets 500.
export const SITE_ORIGIN = "https://mingstreet.app";
export const ENDPOINT_PROBES = Object.freeze([
  { id: "home", label: "Home page", path: "/", expect: "page" },
  { id: "mcp-card", label: "MCP server card", path: "/.well-known/mcp.json", expect: "json" },
  { id: "mcp", label: "MCP server", path: "/mcp", expect: "up" },
  { id: "mcp-oauth", label: "MCP sign-in metadata", path: "/.well-known/oauth-authorization-server", expect: "json" },
  { id: "owner-session", label: "Owner sign-in check", path: "/api/auth/me", expect: "up" },
  { id: "owner-data", label: "Owner data reader", path: "/api/data/manifest.json", expect: "up" },
]);
const TIMEOUT_MS = 15000;

// One probe's verdict from its HTTP status and body. "down" = the function
// answered with an error (500+) or an unreadable body where JSON is the
// contract; "unreachable" = no answer at all (network, timeout), which the
// overall status does not escalate on its own, since a runner's network blip
// is not a site fault.
export function judgeProbe(probe, httpStatus, bodyText) {
  if (!Number.isFinite(httpStatus)) return { status: "unreachable", detail: "No answer from the site." };
  if (httpStatus >= 500) {
    const crash = /FUNCTION_INVOCATION_FAILED/.test(String(bodyText || ""));
    return { status: "down", detail: `HTTP ${httpStatus}${crash ? " (the function crashed on Vercel)" : ""}.` };
  }
  if (probe.expect === "json") {
    if (httpStatus !== 200) return { status: "down", detail: `HTTP ${httpStatus}; expected 200 with JSON.` };
    try { JSON.parse(String(bodyText || "")); } catch { return { status: "down", detail: "HTTP 200 but the body is not JSON." }; }
  }
  if (probe.expect === "page" && httpStatus !== 200) return { status: "down", detail: `HTTP ${httpStatus}; expected 200.` };
  return { status: "up", detail: `HTTP ${httpStatus}.` };
}

export async function probeEndpoints({ fetchImpl = fetch, origin = SITE_ORIGIN, now = () => new Date().toISOString(), probes = ENDPOINT_PROBES } = {}) {
  const rows = [];
  for (const probe of probes) {
    const started = Date.now();
    let httpStatus = NaN, body = "";
    try {
      const res = await fetchImpl(origin + probe.path, { method: "GET", redirect: "manual", headers: { accept: probe.expect === "json" ? "application/json" : "*/*", "user-agent": "stonks-update-checker" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      httpStatus = Number(res?.status);
      try { body = typeof res?.text === "function" ? (await res.text()).slice(0, 4096) : ""; } catch { body = ""; }
    } catch { httpStatus = NaN; }
    const verdict = judgeProbe(probe, httpStatus, body);
    rows.push({ id: probe.id, label: probe.label, path: probe.path, httpStatus: Number.isFinite(httpStatus) ? httpStatus : null, ms: Date.now() - started, ...verdict });
  }
  return { checkedAt: now(), origin, rows, down: rows.filter((r) => r.status === "down").length, unreachable: rows.filter((r) => r.status === "unreachable").length };
}

// The rows that should turn the monitor red: answered with an error.
export function downEndpoints(endpoints) {
  return Array.isArray(endpoints?.rows) ? endpoints.rows.filter((r) => r && r.status === "down") : [];
}

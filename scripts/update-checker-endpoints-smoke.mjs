#!/usr/bin/env node
// Smoke test for the Update Checker's live endpoint probes
// (lib/update-checker-endpoints.mjs, 2026-11-20).
import assert from "node:assert/strict";
import { ENDPOINT_PROBES, judgeProbe, probeEndpoints, downEndpoints } from "../lib/update-checker-endpoints.mjs";
import { assessWorkflows } from "../lib/update-checker.mjs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

await ok("probes are signed-out GETs of our own site, none that calls a provider", () => {
  assert.ok(ENDPOINT_PROBES.length >= 5);
  for (const p of ENDPOINT_PROBES) {
    assert.match(p.path, /^\//);
    assert.doesNotMatch(p.path, /quote|chain|contract|fed-|macro-live|webull|sports|top-picks/, p.path);
  }
  assert.ok(ENDPOINT_PROBES.some((p) => p.path === "/.well-known/mcp.json"), "covers the MCP card (the #840 crash)");
  assert.ok(ENDPOINT_PROBES.some((p) => p.path === "/mcp"));
});

await ok("verdicts", () => {
  const json = { expect: "json" }, up = { expect: "up" }, page = { expect: "page" };
  assert.equal(judgeProbe(json, 500, "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED").status, "down");
  assert.match(judgeProbe(json, 500, "FUNCTION_INVOCATION_FAILED").detail, /crashed on Vercel/);
  assert.equal(judgeProbe(json, 200, "{\"name\":\"x\"}").status, "up");
  assert.equal(judgeProbe(json, 200, "<html>").status, "down");
  assert.equal(judgeProbe(json, 404, "{}").status, "down");
  assert.equal(judgeProbe(up, 401, "{\"error\":\"auth required\"}").status, "up", "signed out on an Owner endpoint is healthy");
  assert.equal(judgeProbe(up, 503, "").status, "down");
  assert.equal(judgeProbe(page, 200, "<html>").status, "up");
  assert.equal(judgeProbe(page, 308, "").status, "down");
  assert.equal(judgeProbe(up, NaN, "").status, "unreachable");
});

await ok("probeEndpoints sends no credentials and survives network errors", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    assert.equal(init.method, "GET");
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers.authorization, undefined);
    if (url.endsWith("/.well-known/mcp.json")) return { status: 500, text: async () => "FUNCTION_INVOCATION_FAILED" };
    if (url.endsWith("/mcp")) throw new Error("network down");
    if (url.endsWith("/.well-known/oauth-authorization-server")) return { status: 200, text: async () => "{}" };
    if (url.endsWith("/")) return { status: 200, text: async () => "<html>" };
    return { status: 401, text: async () => "{\"error\":\"auth required\"}" };
  };
  const r = await probeEndpoints({ fetchImpl, now: () => "2026-11-21T12:00:00.000Z" });
  assert.equal(seen.length, ENDPOINT_PROBES.length);
  assert.ok(seen.every((s) => s.url.startsWith("https://mingstreet.app/")));
  assert.equal(r.down, 1);
  assert.equal(r.unreachable, 1);
  assert.deepEqual(downEndpoints(r).map((x) => x.id), ["mcp-card"]);
});

await ok("a failing endpoint turns the monitor to 'endpoint', naming it", () => {
  // Saturday: no full-build slot is expected, so only the probes decide.
  const at = "2026-11-21T12:00:00.000Z", now = Date.parse(at);
  // One successful full build after Friday's last slot, so the build side is
  // healthy and only the probes decide.
  const build = { id: 1, attempt: 1, workflow: "daily.yml", name: "Daily build", status: "completed", conclusion: "success", fullBuild: true, buildConclusion: "success", siteBuild: "success", publication: "success", createdAt: "2026-11-20T21:30:00.000Z", startedAt: "2026-11-20T21:30:00.000Z", updatedAt: "2026-11-20T21:50:00.000Z", logsChecked: true, diagnostics: { findings: [] } };
  const base = { version: 1, checkedAt: at, runs: [build] };
  const down = { ...base, endpoints: { checkedAt: at, rows: [{ id: "mcp-card", label: "MCP server card", path: "/.well-known/mcp.json", status: "down", detail: "HTTP 500 (the function crashed on Vercel)." }] } };
  const m = assessWorkflows(down, now);
  assert.equal(m.status, "endpoint");
  assert.match(m.detail, /MCP server card \(HTTP 500 \(the function crashed on Vercel\)\)/);
  assert.equal(m.endpoints.rows.length, 1);
  const healthy = { ...base, endpoints: { checkedAt: at, rows: [{ id: "mcp-card", label: "MCP server card", status: "up", detail: "HTTP 200." }, { id: "mcp", label: "MCP server", status: "unreachable", detail: "No answer from the site." }] } };
  assert.notEqual(assessWorkflows(healthy, now).status, "endpoint", "unreachable alone does not escalate");
  assert.notEqual(assessWorkflows(base, now).status, "endpoint", "older reports without probes are unchanged");
});

console.log(`update-checker endpoints smoke: ${passed} passed`);

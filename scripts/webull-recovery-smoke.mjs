// Exercise the actual authenticated endpoint, signed sandbox client, R2 adapter,
// conditional lease and ledger persistence together. Every fetch stays in memory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mirrorTriggerToken, emptyLedger, clientOrderId } from "../lib/webull-mirror.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

Object.assign(process.env, {
  PRIVATE_DATA_ENABLED: "1", WEBULL_MIRROR: "on", WEBULL_APP_KEY: "fake-key", WEBULL_APP_SECRET: "fake-secret",
  WEBULL_PAPER_ACCOUNT_ID: "PAPER1", R2_ACCOUNT_ID: "fake-account", R2_ACCESS_KEY_ID: "fake-key",
  R2_SECRET_ACCESS_KEY: "fake-secret", R2_BUCKET: "test-bucket", R2_ENDPOINT: "https://object.invalid",
});
const objects = new Map(), calls = [], originalFetch = globalThis.fetch;
let sequence = 0, held = false, holdAccount, releaseAccount;
const gate = new Promise((r) => { releaseAccount = r; });
const arrived = new Promise((r) => { holdAccount = r; });
const put = (key, value) => objects.set(key, { body: JSON.stringify(value), etag: `"${++sequence}"` });
const now = Date.now(), iso = new Date(now).toISOString();
const e = { symbol: "NVDA", side: "call", entryDate: iso, contract: { structure: "long", strike: 190, expiry: Date.UTC(2026, 11, 18) / 1000, mid: 5 } };
const id = pickTradeId(e), coid = clientOrderId(id, "entry", 1);
put("picks-accuracy.json", { builtAtIso: iso, open: [e], closed: [] });
const ledger = emptyLedger();
Object.assign(ledger, { accountId: "PAPER1", goLiveIso: new Date(now - 60000).toISOString(), positionBaseline: { options: {}, equities: {}, capturedAtIso: iso }, trades: {
  [id]: { tradeId: id, symbol: "NVDA", side: "call", structure: "long", state: "entering", requestedQty: 3, engineEntryPrice: 5,
    legs: [{ side: "BUY", type: "CALL", strike: 190, expiry: "2026-12-18", expirySec: e.contract.expiry }],
    entryAttempts: [{ phase: "entry", n: 1, quantity: 3, clientOrderId: coid, status: "SENT", filledQty: 0, limit: 5 }], exitAttempts: [] },
} });
put("webull-paper-ledger.json", ledger);
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const u = new URL(request.url), method = request.method;
  calls.push({ url: u.origin + u.pathname, method });
  if (u.hostname === "object.invalid") {
    const key = decodeURIComponent(u.pathname.replace("/test-bucket/", "")), row = objects.get(key);
    if (method === "GET") return row ? new Response(row.body, { headers: { etag: row.etag } }) : new Response(null, { status: 404 });
    if (method === "PUT") {
      const match = request.headers.get("if-match"), none = request.headers.get("if-none-match");
      if (match && row?.etag !== match || none === "*" && row) return new Response(null, { status: 412 });
      const body = await request.text();
      if (key.includes("leases/")) assert.ok(match || none === "*", "lease PUT must be conditional on the wire");
      objects.set(key, { body, etag: `"${++sequence}"` });
      return new Response(null, { headers: { etag: objects.get(key).etag } });
    }
  }
  if (u.hostname === "api.sandbox.webull.com") {
    assert.ok(request.headers.get("x-signature"), "sandbox request must be signed");
    if (u.pathname.endsWith("accounts/list")) {
      if (held) { holdAccount(); await gate; }
      return Response.json([{ account_id: "PAPER1" }]);
    }
    if (u.pathname.endsWith("orders/get")) return Response.json({ data: { orders: [{ status: "FILLED", filled_quantity: "3", filled_price: "5.10", filled_time_at: iso }] } });
    if (u.pathname.endsWith("positions/list")) return Response.json([{ instrument_type: "OPTION", symbol: "NVDA", quantity: "3", legs: [{ symbol: "NVDA", quantity: "3", option_expire_date: "2026-12-18", option_type: "CALL", option_exercise_price: "190", option_contract_multiplier: "100" }] }]);
  }
  throw new Error(`Unexpected network request in offline integration test: ${u.origin}${u.pathname}`);
};
try {
  const { default: handler } = await import("../api/auth/[action].js");
  const response = () => ({ statusCode: null, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; return this; } });
  const req = { method: "POST", query: { action: "webull-mirror" }, headers: { authorization: `Bearer ${mirrorTriggerToken("fake-secret")}` } };
  held = true;
  const first = response(), firstRun = handler(req, first);
  await arrived;
  const second = response(); await handler(req, second);
  assert.equal(second.statusCode, 200); assert.equal(second.body.reason, "mirror already running");
  releaseAccount(); await firstRun;
  assert.equal(first.statusCode, 200); assert.equal(first.body.ran, true);
  const saved = JSON.parse(objects.get("webull-paper-ledger.json").body);
  assert.equal(saved.trades[id].state, "open"); assert.equal(saved.trades[id].filledQty, 3); assert.equal(saved.trades[id].fillPrice, 5.1);
  assert.equal(saved.reconciliation.status, "matched");
  assert.equal(saved.engineSnapshotIso, iso);
  assert.equal(first.body.summary.followUpNeeded, false);
  assert.equal(JSON.parse(objects.get("_stonks/leases/webull-paper.json").body).expiresAt, 0);
  assert.equal(calls.filter((c) => /orders\/place/.test(c.url)).length, 0, "refreshing a completed fill must not place an order");
  assert.equal(calls.filter((c) => /accounts\/list/.test(c.url)).length, 1, "only one concurrent endpoint enters the broker path");
  assert.equal(calls.filter((c) => /generations/.test(c.url)).length, 0, "request-owned ledger must not publish a bake generation");
  process.env.SESSION_SECRET = "offline-session-secret";
  const { signSession, SESSION_COOKIE } = await import("../lib/session.mjs");
  const token = await signSession({ tr: true, tp: true });
  const owner = response(); await handler({ method: "GET", query: { action: "webull-mirror" }, headers: { cookie: `${SESSION_COOKIE}=${token}` } }, owner);
  assert.equal(owner.statusCode, 200); assert.equal(owner.body.trades[0].filledQty, 3); assert.equal(owner.body.reconciliation.status, "matched"); assert.equal(owner.body.engineSnapshotIso, iso);
  assert.equal(owner.body.accountId, undefined); assert.equal(owner.body.positionBaseline, undefined);
  const limited = await signSession({ tr: true, tp: false });
  const forbidden = response(); await handler({ method: "GET", query: { action: "webull-mirror" }, headers: { cookie: `${SESSION_COOKIE}=${limited}` } }, forbidden);
  assert.equal(forbidden.statusCode, 401, "both existing owner claims are required");
  const trigger = (at, event, strict, status = 200, body = { ran: true, summary: {} }) => {
    const setup = `Date.now = () => ${Date.parse("2026-11-27T" + at + "Z")}; globalThis.fetch = async () => { console.log("OFFLINE_TRIGGER_REQUEST"); return Response.json(${JSON.stringify(body)}, { status: ${status} }); }; await import("./scripts/webull-mirror-trigger.mjs");`;
    return spawnSync(process.execPath, ["--input-type=module", "-e", setup], { cwd: new URL("..", import.meta.url), env: { ...process.env, GITHUB_EVENT_NAME: event, WEBULL_MIRROR_STRICT: strict ? "1" : "0", WEBULL_MIRROR_FOLLOW_UPS: "0" }, encoding: "utf8", timeout: 5000 });
  };
  const delayedBuild = trigger("20:00:00", "workflow_dispatch", true);
  assert.equal(delayedBuild.status, 0); assert.match(delayedBuild.stdout, /OFFLINE_TRIGGER_REQUEST/, "queued Top Picks publication must reach server; exchange hours belong to server");
  const published = trigger("16:00:00", "workflow_dispatch", true);
  assert.equal(published.status, 0); assert.match(published.stdout, /OFFLINE_TRIGGER_REQUEST/);
  assert.equal(trigger("16:00:00", "workflow_dispatch", true, 200, { ran: true, summary: { alerts: 1 } }).status, 1, "reconciliation alerts fail the mirror step visibly");
  assert.equal(trigger("16:00:00", "workflow_dispatch", true, 502, { error: "failed" }).status, 1);
  assert.equal(trigger("20:00:00", "workflow_dispatch", false, 502, { error: "failed" }).status, 0, "non-strict callers stay nonfatal");
  console.log("Webull endpoint recovery: authenticated refresh, signed client, R2 checkpoint, and concurrent exclusion passed (offline).");
} finally { globalThis.fetch = originalFetch; }

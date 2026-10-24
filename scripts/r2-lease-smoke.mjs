// Reproduce R2's compressed JSON ETag at the actual signed HTTP boundary.
// No request can leave this in-memory object store.
import assert from "node:assert/strict";
import { createStore } from "../lib/datastore.mjs";

const originalFetch = globalThis.fetch;
let body = JSON.stringify({ owner: "released-owner", expiresAt: 0 });
let etag = '"stored-object-1"', sequence = 1, forceWeak = false, writes = 0;
const requests = [];
globalThis.fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  assert.equal(req.url, "https://lease.invalid/bucket/_stonks/leases/webull-paper.json");
  assert.ok(req.headers.get("authorization"), "exercise the real SigV4 adapter");
  requests.push(req);
  if (req.method === "GET") return new Response(body, { headers: {
    etag: forceWeak || req.headers.get("accept-encoding") !== "identity" ? `W/${etag}` : etag,
  } });
  assert.equal(req.method, "PUT");
  writes++;
  // If-Match uses strong comparison: W/"x" never matches "x".
  if (req.headers.get("if-match") !== etag) return new Response(null, { status: 412 });
  body = await req.text(); etag = `"stored-object-${++sequence}"`;
  return new Response(null, { headers: { etag } });
};
try {
  const store = createStore({ r2AccountId: "fake", r2AccessKeyId: "fake", r2SecretAccessKey: "fake",
    r2Bucket: "bucket", r2Endpoint: "https://lease.invalid" });
  let entered = 0;
  const acquired = await store.withLease("webull-paper", async () => ++entered);
  assert.equal(acquired.busy, false);
  assert.equal(entered, 1);
  assert.equal(JSON.parse(body).expiresAt, 0, "release remains conditional");
  assert.ok(requests.filter(r => r.method === "GET").every(r => r.headers.get("accept-encoding") === "identity"));

  const before = writes;
  forceWeak = true;
  await assert.rejects(store.withLease("webull-paper", async () => ++entered), { code: "LEASE_ETAG_INVALID" });
  assert.equal(writes, before, "an unexpected weak validator must fail closed before any write");
  forceWeak = false;
  body = "invalid JSON";
  await assert.rejects(store.withLease("webull-paper", async () => ++entered), { code: "LEASE_INVALID" });
  assert.equal(writes, before, "malformed lock bytes cannot be overwritten");
  assert.equal(entered, 1);
  console.log("R2 lease: compressed ETag regression, strong conditional acquisition/release, and fail-closed checks passed (offline).");
} finally { globalThis.fetch = originalFetch; }

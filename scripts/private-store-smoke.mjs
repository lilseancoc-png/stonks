// Offline checks for private-store backend selection and hydration path safety.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createStore, store } from "../lib/datastore.mjs";
import { resolveStoreKeyPath } from "../lib/store-path.mjs";
import { serveDataKey } from "../lib/data-response.mjs";

const base = resolve("/tmp/stonks-private-store-smoke/data");
assert.equal(resolveStoreKeyPath(base, "AAPL.json"), resolve(base, "AAPL.json"));
assert.equal(resolveStoreKeyPath(base, "iv-history/AAPL.json"), resolve(base, "iv-history/AAPL.json"));
for (const key of ["../package.json", "/tmp/overwrite", "iv-history/../../package.json", "foo\\bar.json", "foo//bar.json"]) {
  assert.throws(() => resolveStoreKeyPath(base, key), /unsafe|escapes/);
}

const names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "BLOB_READ_WRITE_TOKEN"];
const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
try {
  for (const name of names) delete process.env[name];
  assert.throws(
    () => createStore({ r2AccountId: "account", r2AccessKeyId: "key", r2SecretAccessKey: "secret" }),
    /incomplete R2 configuration.*R2_BUCKET/,
  );
  assert.equal(createStore({ token: "fake-blob-token" }).backend, "blob");
  assert.equal(createStore({
    r2AccountId: "account", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "bucket",
  }).backend, "r2");
} finally {
  for (const name of names) {
    if (prior[name] == null) delete process.env[name];
    else process.env[name] = prior[name];
  }
}

// Final response-boundary policy: stale store objects are sanitized before a
// public cache header is set, while Owner keys stop before the store read.
function mockResponse() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    end(value) { this.body = value; return value; },
  };
}
const priorFlag = process.env.PRIVATE_DATA_ENABLED;
const priorGet = store.get;
let storeReads = 0;
try {
  process.env.PRIVATE_DATA_ENABLED = "1";
  store.get = async (key) => {
    storeReads++;
    if (key === "briefs.json") return Buffer.from(JSON.stringify({ current: { picks: ["SECRET"] } }));
    if (key === "MSFT.json") return Buffer.from(JSON.stringify({ spot: 500, autoPick: { call: { strike: 510 } } }));
    return Buffer.from("{}");
  };
  const briefRes = mockResponse();
  await serveDataKey({ headers: {} }, briefRes, "briefs.json");
  assert.deepEqual(JSON.parse(String(briefRes.body)), {});
  assert.match(briefRes.headers["cache-control"], /^public,/);
  const tickerRes = mockResponse();
  await serveDataKey({ headers: {} }, tickerRes, "MSFT.json");
  assert.deepEqual(JSON.parse(String(tickerRes.body)), { spot: 500 });
  const readsBeforeOwner = storeReads;
  const ownerRes = mockResponse();
  await serveDataKey({ headers: {} }, ownerRes, "picks.json");
  assert.equal(ownerRes.statusCode, 401);
  assert.equal(storeReads, readsBeforeOwner, "unauthorized Owner read must stop before storage");
} finally {
  store.get = priorGet;
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
}

console.log("private-store smoke test passed");

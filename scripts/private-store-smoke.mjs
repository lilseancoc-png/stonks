// Offline checks for private-store backend selection and hydration path safety.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createStore } from "../lib/datastore.mjs";
import { resolveStoreKeyPath } from "../lib/store-path.mjs";

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

console.log("private-store smoke test passed");

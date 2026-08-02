// Offline checks for private-store backend selection and hydration path safety.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createStore,
  DATA_GENERATION_PREFIX,
  DATA_PUBLICATION_POINTER_KEY,
  store,
  withPublishedGenerations,
} from "../lib/datastore.mjs";
import { resolveStoreKeyPath } from "../lib/store-path.mjs";
import { serveDataKey } from "../lib/data-response.mjs";
import { installHydratedSnapshot } from "./sync-data.mjs";

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

// Immutable-generation publication: all logical writes become visible at one
// pointer flip, scanner generations overlay (rather than replace) bake keys,
// and request-time state stays outside the manifest. This fake backend keeps
// the proof offline and deterministic.
function fakeRawStore(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, {
    body: Buffer.from(value),
    uploadedAt: "2026-01-01T00:00:00.000Z",
  }]));
  let failPut = null;
  return {
    objects,
    setFailPut(fn) { failPut = fn; },
    async get(key) {
      const row = objects.get(key);
      return row ? Buffer.from(row.body) : null;
    },
    async put(key, body) {
      if (failPut?.(key)) throw new Error(`injected put failure: ${key}`);
      objects.set(key, { body: Buffer.from(body), uploadedAt: new Date().toISOString() });
    },
    async del(key) { objects.delete(key); },
    async list(prefix = "") {
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, row]) => ({ key, size: row.body.length, uploadedAt: row.uploadedAt }));
    },
    hasToken: () => true,
    backend: "fake",
  };
}

const raw = fakeRawStore({
  "AAPL.json": JSON.stringify({ generation: "legacy-aapl" }),
  "unusual.json": JSON.stringify({ generation: "legacy-unusual" }),
  "picks-watchlist.json": JSON.stringify({ symbols: ["AAPL"] }),
});
const published = withPublishedGenerations(raw);
assert.equal(JSON.parse(String(await published.get("AAPL.json"))).generation, "legacy-aapl");
for (const invalidKey of ["./AAPL.json", "iv-history/./AAPL.json", "foo//bar.json"]) {
  assert.equal(await published.get(invalidKey), null);
  await assert.rejects(published.put(invalidKey, Buffer.from("{}")), /invalid logical key/);
  await assert.rejects(published.del(invalidKey), /invalid logical key/);
  await assert.rejects(
    published.publishGeneration({ owner: "invalid", updates: new Map([[invalidKey, Buffer.from("{}")]]) }),
    /refusing non-generational key/,
  );
}

// A repository checkout has no gitignored data/. Seeding from such a checkout
// (even when a request-time watchlist exists at the root) must never mint an
// authoritative empty pointer that turns every real data key into a 404.
const emptyRaw = fakeRawStore({
  "picks-watchlist.json": JSON.stringify({ symbols: ["AAPL"] }),
});
const emptyPublished = withPublishedGenerations(emptyRaw);
await assert.rejects(
  emptyPublished.publishGeneration({ owner: "seed", updates: new Map() }),
  /refusing to publish an empty logical snapshot/,
);
assert.equal(await emptyRaw.get(DATA_PUBLICATION_POINTER_KEY), null);

const poisonedGeneration = "poisoned-watchlist";
const poisonedManifestKey = `${DATA_GENERATION_PREFIX}${poisonedGeneration}/manifest.json`;
const poisonedWatchlistPath = `${DATA_GENERATION_PREFIX}${poisonedGeneration}/objects/picks-watchlist.json`;
const poisonedRaw = fakeRawStore({
  [DATA_PUBLICATION_POINTER_KEY]: JSON.stringify({
    version: 1,
    generation: poisonedGeneration,
    manifestKey: poisonedManifestKey,
  }),
  [poisonedManifestKey]: JSON.stringify({
    version: 1,
    generation: poisonedGeneration,
    publishedAt: "2026-08-02T00:00:00.000Z",
    previousGeneration: null,
    objects: {
      "picks-watchlist.json": { path: poisonedWatchlistPath, size: 2, uploadedAt: null },
    },
  }),
  [poisonedWatchlistPath]: "{}",
});
await assert.rejects(
  withPublishedGenerations(poisonedRaw).getPublication({ fresh: true }),
  /invalid object mapping for picks-watchlist\.json/,
);

const rootMappedGeneration = "poisoned-root-map";
const rootMappedManifestKey = `${DATA_GENERATION_PREFIX}${rootMappedGeneration}/manifest.json`;
const rootMappedRaw = fakeRawStore({
  [DATA_PUBLICATION_POINTER_KEY]: JSON.stringify({
    version: 1,
    generation: rootMappedGeneration,
    manifestKey: rootMappedManifestKey,
  }),
  [rootMappedManifestKey]: JSON.stringify({
    version: 1,
    generation: rootMappedGeneration,
    publishedAt: "2026-08-02T00:00:00.000Z",
    previousGeneration: null,
    objects: {
      "AAPL.json": { path: "AAPL.json", size: 2, uploadedAt: null },
    },
  }),
  "AAPL.json": "{}",
});
await assert.rejects(
  withPublishedGenerations(rootMappedRaw).getPublication({ fresh: true }),
  /invalid object mapping for AAPL\.json/,
);
for (const invalidKey of ["../outside.json", "not-json", "foo\\bar.json", "foo//bar.json"]) {
  assert.equal(await published.get(invalidKey), null);
  await assert.rejects(published.put(invalidKey, Buffer.from("{}")), /refusing invalid logical key/);
  await assert.rejects(published.del(invalidKey), /refusing invalid logical key/);
}

raw.setFailPut((key) => key.includes("/objects/grades.json"));
await assert.rejects(
  published.publishGeneration({
    owner: "bake",
    updates: new Map([
      ["AAPL.json", Buffer.from(JSON.stringify({ generation: "failed-aapl" }))],
      ["grades.json", Buffer.from(JSON.stringify({ generation: "failed-grades" }))],
    ]),
  }),
  /injected put failure/,
);
assert.equal(await raw.get(DATA_PUBLICATION_POINTER_KEY), null, "failed first publish must not create pointer");
assert.equal(JSON.parse(String(await published.get("AAPL.json"))).generation, "legacy-aapl");

raw.setFailPut(null);
const bakePublication = await published.publishGeneration({
  owner: "bake",
  updates: new Map([
    ["AAPL.json", Buffer.from(JSON.stringify({ generation: "bake-aapl" }))],
    ["grades.json", Buffer.from(JSON.stringify({ generation: "bake-grades" }))],
  ]),
});
const bakePointer = String(await raw.get(DATA_PUBLICATION_POINTER_KEY));
assert(
  Object.entries(bakePublication.manifest.objects).every(([key, record]) => record.path !== key),
  "first publication must materialize every carried legacy root into immutable generation storage",
);
assert.equal(JSON.parse(String(await published.get("AAPL.json"))).generation, "bake-aapl");

raw.setFailPut((key) => key.includes("/objects/grades.json"));
await assert.rejects(
  published.publishGeneration({
    owner: "bake",
    updates: new Map([["grades.json", Buffer.from(JSON.stringify({ generation: "partial" }))]]),
  }),
  /injected put failure/,
);
assert.equal(String(await raw.get(DATA_PUBLICATION_POINTER_KEY)), bakePointer, "failed overlay must leave pointer unchanged");
raw.setFailPut(null);

const scanPublication = await published.publishGeneration({
  owner: "unusual",
  updates: new Map([["unusual.json", Buffer.from(JSON.stringify({ generation: "scan-unusual" }))]]),
});
assert.notEqual(scanPublication.manifest.generation, bakePublication.manifest.generation);
assert.equal(JSON.parse(String(await published.get("AAPL.json"))).generation, "bake-aapl", "scanner must carry bake mapping");
assert.equal(JSON.parse(String(await published.get("unusual.json"))).generation, "scan-unusual");

// The physical publication namespace is never part of the logical data API.
// Otherwise an unauthenticated `/api/data/_stonks/...` request could discover
// the pointer/manifest and fetch a premium object's physical pathname.
for (const internalKey of [
  DATA_PUBLICATION_POINTER_KEY,
  scanPublication.manifestKey,
  scanPublication.manifest.objects["unusual.json"].path,
]) {
  assert.equal(await published.get(internalKey), null, `${internalKey} must be hidden from logical get`);
  await assert.rejects(published.put(internalKey, Buffer.from("{}")), /refusing internal key/);
  await assert.rejects(published.del(internalKey), /refusing internal key/);
}
assert.deepEqual(await published.list("_stonks/"), []);
await assert.rejects(
  published.publishGeneration({
    owner: "hostile",
    updates: new Map([[DATA_PUBLICATION_POINTER_KEY, Buffer.from("{}")]]),
  }),
  /refusing non-generational key/,
);

await published.put("picks-watchlist.json", Buffer.from(JSON.stringify({ symbols: ["MSFT"] })));
assert.deepEqual(JSON.parse(String(await raw.get("picks-watchlist.json"))), { symbols: ["MSFT"] });
assert.equal(scanPublication.manifest.objects["picks-watchlist.json"], undefined);
const logicalKeys = (await published.list("")).map((entry) => entry.key);
assert(logicalKeys.includes("AAPL.json") && logicalKeys.includes("unusual.json") && logicalKeys.includes("picks-watchlist.json"));
assert(!logicalKeys.some((key) => key.startsWith("_stonks/")), "logical list must hide publication metadata");

// Maintenance mutations (wipe-history and similar callers) publish a tiny
// overlay generation instead of modifying an active snapshot in place.
const beforeMaintenance = (await published.getPublication({ fresh: true })).manifest.generation;
await published.put("picks.json", Buffer.from(JSON.stringify({ open: [], closed: [] })));
const afterMaintenance = (await published.getPublication({ fresh: true })).manifest.generation;
assert.notEqual(afterMaintenance, beforeMaintenance);
assert.deepEqual(JSON.parse(String(await published.get("picks.json"))), { open: [], closed: [] });

// GC retention is based on when a snapshot is superseded, not when its object
// was originally uploaded. A long-lived generation retired moments ago must
// remain readable for pinned readers throughout the grace period.
const gcRaw = fakeRawStore();
const gcStore = withPublishedGenerations(gcRaw);
const gcFirst = await gcStore.publishGeneration({
  owner: "bake",
  now: new Date("2026-01-01T00:00:00.000Z"),
  updates: new Map([["AAPL.json", Buffer.from(JSON.stringify({ version: 1 }))]]),
});
for (const [key, row] of gcRaw.objects) {
  if (key.startsWith(`${DATA_GENERATION_PREFIX}${gcFirst.manifest.generation}/`)) {
    row.uploadedAt = "2026-01-01T00:00:00.000Z";
  }
}
const retiredAaplPath = gcFirst.manifest.objects["AAPL.json"].path;
const gcSecond = await gcStore.publishGeneration({
  owner: "bake",
  now: new Date("2026-03-01T00:00:00.000Z"),
  updates: new Map([["AAPL.json", Buffer.from(JSON.stringify({ version: 2 }))]]),
});
await gcStore.gcGenerations({ graceMs: 26 * 3600000, now: new Date("2026-03-01T01:00:00.000Z") });
assert(gcRaw.objects.has(retiredAaplPath), "just-retired snapshot body must survive even when its upload is old");
await gcStore.gcGenerations({ graceMs: 26 * 3600000, now: new Date("2026-03-03T12:00:00.000Z") });
assert(!gcRaw.objects.has(retiredAaplPath), "retired snapshot body may be collected after its grace period");

const gcSecondAaplPath = gcSecond.manifest.objects["AAPL.json"].path;
gcRaw.objects.get(gcSecondAaplPath).uploadedAt = "2026-03-01T00:00:00.000Z";
await gcStore.publishGeneration({
  owner: "bake",
  now: new Date("2026-03-04T00:00:00.000Z"),
  updates: new Map([["AAPL.json", Buffer.from(JSON.stringify({ version: 3 }))]]),
});
await gcRaw.del(gcSecond.manifestKey);
await assert.rejects(
  gcStore.gcGenerations({ graceMs: 26 * 3600000, now: new Date("2026-03-04T01:00:00.000Z") }),
  /predecessor is unavailable/,
);
assert(gcRaw.objects.has(gcSecondAaplPath), "GC must delete nothing when an in-grace predecessor is unavailable");

// Hydration downloads into a sibling staging directory and only swaps after
// every body succeeds. A torn publication therefore cannot destroy the prior
// local data tree.
const hydrateRoot = await mkdtemp(resolve(tmpdir(), "stonks-pull-smoke-"));
const hydrateData = resolve(hydrateRoot, "data");
try {
  await mkdir(hydrateData, { recursive: true });
  await writeFile(resolve(hydrateData, "old.json"), "old-good", "utf8");
  await assert.rejects(
    installHydratedSnapshot([], {
      dataDir: hydrateData,
      readPhysical: async () => Buffer.from("unused"),
    }),
    /remote snapshot is empty/,
  );
  assert.equal(await readFile(resolve(hydrateData, "old.json"), "utf8"), "old-good");
  const watchlistOnly = [{
    key: "picks-watchlist.json",
    physicalKey: "picks-watchlist.json",
    size: 2,
    body: Buffer.from("{}"),
  }];
  await assert.rejects(
    installHydratedSnapshot(watchlistOnly, {
      dataDir: hydrateData,
      readPhysical: async () => Buffer.from("unused"),
    }),
    /only request-time state/,
  );
  assert.equal(await readFile(resolve(hydrateData, "old.json"), "utf8"), "old-good");
  const hydrateEntries = [{ key: "new.json", physicalKey: "generation/new.json", size: 8 }];
  await assert.rejects(
    installHydratedSnapshot(hydrateEntries, {
      dataDir: hydrateData,
      readPhysical: async () => null,
    }),
    /listed object new\.json is missing/,
  );
  assert.equal(await readFile(resolve(hydrateData, "old.json"), "utf8"), "old-good");
  await assert.rejects(
    installHydratedSnapshot(hydrateEntries, {
      dataDir: hydrateData,
      readPhysical: async () => Buffer.from("short"),
    }),
    /size mismatch/,
  );
  assert.equal(await readFile(resolve(hydrateData, "old.json"), "utf8"), "old-good");
  await installHydratedSnapshot(hydrateEntries, {
    dataDir: hydrateData,
    readPhysical: async () => Buffer.from("new-good"),
  });
  assert.equal(await readFile(resolve(hydrateData, "new.json"), "utf8"), "new-good");
  await assert.rejects(readFile(resolve(hydrateData, "old.json"), "utf8"), /ENOENT/);
} finally {
  await rm(hydrateRoot, { recursive: true, force: true });
}

// A mapped physical body disappearing is publication corruption (502 at the
// response boundary), not an ordinary missing logical key (404).
const integrityPublication = await published.getPublication({ fresh: true });
await raw.del(integrityPublication.manifest.objects["picks.json"].path);
await assert.rejects(published.get("picks.json"), /published object is missing/);

// Pointer presence is authoritative. Corruption/missing target fails closed;
// only genuine pointer absence permits the legacy-root fallback.
await raw.put(DATA_PUBLICATION_POINTER_KEY, Buffer.from("{}"));
const corruptView = withPublishedGenerations(raw);
await assert.rejects(corruptView.get("AAPL.json"), /publication pointer is invalid/);

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
    if (key === "corrupt.json") throw new Error("published object missing");
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
  const corruptRes = mockResponse();
  await serveDataKey({ headers: {} }, corruptRes, "corrupt.json");
  assert.equal(corruptRes.statusCode, 502);
  assert.equal(corruptRes.headers["cache-control"], "no-store");
  const readsBeforeOwner = storeReads;
  const ownerRes = mockResponse();
  await serveDataKey({ headers: {} }, ownerRes, "picks.json");
  assert.equal(ownerRes.statusCode, 401);
  assert.equal(storeReads, readsBeforeOwner, "unauthorized Owner read must stop before storage");
  for (const internalKey of [
    DATA_PUBLICATION_POINTER_KEY,
    scanPublication.manifestKey,
    scanPublication.manifest.objects["unusual.json"].path,
  ]) {
    const readsBeforeInternal = storeReads;
    const internalRes = mockResponse();
    await serveDataKey({ headers: {} }, internalRes, internalKey);
    assert.equal(internalRes.statusCode, 400);
    assert.equal(storeReads, readsBeforeInternal, "internal publication paths must stop before storage");
  }
  for (const invalidKey of ["./briefs.json", "foo//bar.json"]) {
    const readsBeforeInvalid = storeReads;
    const invalidRes = mockResponse();
    await serveDataKey({ headers: {} }, invalidRes, invalidKey);
    assert.equal(invalidRes.statusCode, 400);
    assert.equal(storeReads, readsBeforeInvalid, "invalid logical paths must stop before storage");
  }
} finally {
  store.get = priorGet;
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
}

console.log("private-store smoke test passed");

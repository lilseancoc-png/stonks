// Private data store — backend-agnostic adapter (Cloudflare R2 or Vercel Blob).
//
// Storage layer behind the Path B private-data migration
// (docs/private-data-migration.md). Premium data/*.json live in a PRIVATE
// object store — never reachable by URL, only with credentials. The build/scan
// scripts hydrate a local data/ dir from here and flush back
// (scripts/sync-data.mjs); the gated api/data/* function streams a file from
// here after checking the Discord session.
//
// Logical interface (kept small + backend-agnostic so the backend is a drop-in
// swap):
//   get(key)         -> Buffer | null         (null when missing)
//   put(key, body)   -> void                  (atomic one-key generation)
//   del(key)         -> void                  (atomic one-key generation)
//   list(prefix='')  -> [{ key, size, uploadedAt }]
//   publishGeneration({ owner, updates, deletes }) -> pinned snapshot
//
// "key" is the data/ relative path, e.g. "picks.json", "NVDA.json",
// "iv-history/NVDA.json". Public callers always see these logical names. The
// wrapper resolves them through `_stonks/published.json`; physical generation
// names are deliberately hidden. Request-time-exclusive keys remain mutable at
// their logical root pathname and bypass the generation manifest.
//
// BACKEND SELECTION (createStore): if the R2 credentials are present
// (R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_BUCKET) the
// store talks to Cloudflare R2 over its S3-compatible API (SigV4 via the tiny
// dependency-free `aws4fetch`). If none of those four variables is present it
// falls back to Vercel Blob (BLOB_READ_WRITE_TOKEN); a partial R2 set is rejected
// so a typo cannot silently redirect reads and writes to the fallback backend. Set
// the four R2 vars in Vercel + GitHub Actions and the next run uses R2; unset
// them to roll back to Blob. R2's free tier (1M class-A ops/mo, 10 GB, zero
// egress) comfortably absorbs the every-bake re-sync that exhausts Vercel
// Blob's 2,000 advanced-ops/mo free allowance (see the billing note in the
// migration doc). Any S3-compatible store works via R2_ENDPOINT.

import { put as blobPut, get as blobGet, list as blobList, del as blobDel } from "@vercel/blob";
import { AwsClient } from "aws4fetch";
import { REQUEST_TIME_EXCLUSIVE_KEYS } from "./data-ownership.mjs";

const DEFAULT_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const ACCESS = "private";

// Logical data objects are published through one immutable-generation manifest.
// The pointer is the ONLY in-place publication write: every object and manifest
// it references is uploaded first under a never-reused generation pathname.
// A failed upload therefore leaves the prior pointer (and complete snapshot)
// untouched. Request-time objects deliberately bypass this layer.
export const DATA_PUBLICATION_POINTER_KEY = "_stonks/published.json";
export const DATA_GENERATION_PREFIX = "_stonks/generations/";
export const DATA_INTERNAL_PREFIX = "_stonks/";
const PUBLICATION_VERSION = 1;
const PUBLICATION_CACHE_MS = 1000;
let generationCounter = 0;

function isPublicationMetadataKey(key) {
  // Reserve the whole namespace, including future metadata layouts. No
  // physical publication pathname may ever enter the logical data surface.
  return String(key || "").startsWith(DATA_INTERNAL_PREFIX);
}

function isLogicalDataKey(key) {
  return typeof key === "string" &&
    /^[A-Za-z0-9_./-]+\.json$/.test(key) &&
    !key.startsWith("/") &&
    !key.startsWith(DATA_INTERNAL_PREFIX) &&
    !key.includes("..") &&
    !key.includes("//") &&
    !key.includes("\\") &&
    !key.split("/").some((segment) => segment === "." || segment === "");
}

function generationId(owner, now = new Date()) {
  generationCounter = (generationCounter + 1) % 0x100000;
  const safeOwner = String(owner || "patch").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 24) || "patch";
  const rand = Math.random().toString(36).slice(2, 10);
  return `${now.toISOString().replace(/[-:.TZ]/g, "")}-${safeOwner}-${process.pid || 0}-${generationCounter.toString(36)}-${rand}`;
}

function parseJsonBuffer(buf, label) {
  try {
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch (err) {
    throw new Error(`datastore ${label} is invalid JSON: ${err?.message || err}`);
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Retry wrapper for the network ops so a transient hiccup doesn't fail a whole
// sync. The op throws on a retryable failure (network error or non-2xx status);
// a graceful "missing" (404) is returned WITHOUT throwing so it isn't retried.
async function withRetry(label, fn, { tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  throw new Error(`datastore ${label} failed after ${tries} tries: ${lastErr?.message || lastErr}`);
}

// Drain a web ReadableStream / Node Readable into a Buffer (both are
// async-iterable on Node 18+).
async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// --- Cloudflare R2 (S3-compatible) backend -----------------------------------
function createR2Store(cfg) {
  const endpoint = (cfg.endpoint || `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
  const base = `${endpoint}/${cfg.bucket}`;
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
  });
  // Encode each path segment but keep the "/" separators (S3 keys are paths).
  const objUrl = (key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const unescapeXml = (s) =>
    String(s)
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

  async function get(key) {
    return withRetry("r2 get", async () => {
      const res = await aws.fetch(objUrl(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });
  }

  async function put(key, body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await withRetry("r2 put", async () => {
      const res = await aws.fetch(objUrl(key), {
        method: "PUT",
        body: buf,
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  async function del(key) {
    await withRetry("r2 del", async () => {
      const res = await aws.fetch(objUrl(key), { method: "DELETE" });
      // S3/R2 DELETE is idempotent — a 404 is success (already gone).
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    });
  }

  async function list(prefix = "") {
    const out = [];
    let token;
    do {
      const xml = await withRetry("r2 list", async () => {
        const u = new URL(base);
        u.searchParams.set("list-type", "2");
        if (prefix) u.searchParams.set("prefix", prefix);
        if (token) u.searchParams.set("continuation-token", token);
        const res = await aws.fetch(u.toString(), { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      });
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const b = m[1];
        const k = (b.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
        if (!k) continue;
        const size = Number((b.match(/<Size>(\d+)<\/Size>/) || [])[1] || 0);
        const lm = (b.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || null;
        out.push({ key: unescapeXml(k), size, uploadedAt: lm });
      }
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
      token = truncated ? (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] : undefined;
    } while (token);
    return out;
  }

  return { get, put, del, list, hasToken: () => true, backend: "r2" };
}

// --- Vercel Blob backend (legacy / fallback) ---------------------------------
function createBlobStore({ token } = {}) {
  const tok = token || process.env[DEFAULT_TOKEN_ENV] || "";

  function requireToken() {
    if (!tok) throw new Error(`datastore: ${DEFAULT_TOKEN_ENV} is not set`);
  }

  async function get(key) {
    requireToken();
    // get() reads private blob content with the token and resolves to null when
    // the pathname doesn't exist (no throw to catch). useCache:false so a fresh
    // write is visible immediately.
    const res = await withRetry("get", () =>
      blobGet(key, { access: ACCESS, token: tok, useCache: false }),
    );
    if (!res || !res.stream) return null;
    return await streamToBuffer(res.stream);
  }

  async function put(key, body) {
    requireToken();
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await withRetry("put", () =>
      blobPut(key, buf, {
        access: ACCESS,
        token: tok,
        addRandomSuffix: false, // stable pathname so keys are addressable
        allowOverwrite: true, // upsert semantics
        contentType: "application/json",
      }),
    );
  }

  async function del(key) {
    requireToken();
    await withRetry("del", () => blobDel(key, { token: tok }));
  }

  async function list(prefix = "") {
    requireToken();
    const out = [];
    let cursor;
    do {
      const page = await withRetry("list", () =>
        blobList({ token: tok, prefix, cursor, limit: 1000 }),
      );
      for (const b of page.blobs) {
        out.push({ key: b.pathname, size: b.size, uploadedAt: b.uploadedAt });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  return { get, put, del, list, hasToken: () => !!tok, backend: "blob" };
}

// Add atomic logical publication semantics above either raw backend. Exported
// for the offline fake-store smoke test; production callers use createStore().
export function withPublishedGenerations(raw) {
  if (!raw || !["get", "put", "del", "list"].every((name) => typeof raw[name] === "function")) {
    throw new Error("datastore: published-generation wrapper requires get/put/del/list");
  }

  let publicationCache = null;
  let publicationCacheAt = 0;

  function validatePublication(pointer, manifest, manifestKey) {
    if (!pointer || pointer.version !== PUBLICATION_VERSION ||
      typeof pointer.generation !== "string" || !pointer.generation ||
      typeof pointer.manifestKey !== "string" || pointer.manifestKey !== manifestKey ||
      manifestKey !== `${DATA_GENERATION_PREFIX}${pointer.generation}/manifest.json`) {
      throw new Error("datastore publication pointer is invalid");
    }
    if (!manifest || manifest.version !== PUBLICATION_VERSION ||
      manifest.generation !== pointer.generation ||
      !manifest.objects || typeof manifest.objects !== "object" || Array.isArray(manifest.objects) ||
      Object.keys(manifest.objects).length === 0) {
      throw new Error("datastore publication manifest is invalid");
    }
    for (const [key, record] of Object.entries(manifest.objects)) {
      const generatedMatch = typeof record?.path === "string"
        ? /^_stonks\/generations\/[A-Za-z0-9-]+\/objects\/(.+)$/.exec(record.path)
        : null;
      const generatedPath = generatedMatch?.[1] === key;
      if (!isLogicalDataKey(key) || REQUEST_TIME_EXCLUSIVE_KEYS.has(key) ||
        !record || typeof record.path !== "string" ||
        !Number.isInteger(record.size) || record.size < 0 ||
        !generatedPath) {
        throw new Error(`datastore publication manifest has invalid object mapping for ${key}`);
      }
    }
    return { pointer, manifest, manifestKey };
  }

  async function getPublication({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && publicationCache && now - publicationCacheAt <= PUBLICATION_CACHE_MS) {
      return publicationCache;
    }
    const pointerBuf = await raw.get(DATA_PUBLICATION_POINTER_KEY);
    if (pointerBuf == null) {
      publicationCache = null;
      publicationCacheAt = now;
      return null;
    }
    // Pointer present but malformed/missing-target must fail closed. Falling
    // back to mutable legacy roots here could expose a partial old publish.
    const pointer = parseJsonBuffer(pointerBuf, "publication pointer");
    const manifestKey = pointer?.manifestKey;
    if (typeof manifestKey !== "string" ||
      !/^_stonks\/generations\/[A-Za-z0-9-]+\/manifest\.json$/.test(manifestKey)) {
      throw new Error("datastore publication pointer is invalid");
    }
    const manifestBuf = await raw.get(manifestKey);
    if (manifestBuf == null) throw new Error("datastore publication manifest is missing");
    const manifest = parseJsonBuffer(manifestBuf, "publication manifest");
    publicationCache = validatePublication(pointer, manifest, manifestKey);
    publicationCacheAt = now;
    return publicationCache;
  }

  async function legacyObjects() {
    const entries = await raw.list("");
    const objects = {};
    for (const entry of entries) {
      const key = entry?.key;
      if (!isLogicalDataKey(key) || isPublicationMetadataKey(key) || REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) continue;
      objects[key] = {
        path: key,
        size: Number(entry.size) || 0,
        uploadedAt: entry.uploadedAt || null,
      };
    }
    return objects;
  }

  async function publishGeneration({ owner = "patch", updates = new Map(), deletes = [], now = new Date() } = {}) {
    const updateEntries = updates instanceof Map ? [...updates.entries()] : Object.entries(updates || {});
    const updateKeys = new Set(updateEntries.map(([key]) => key));
    const deleteKeys = new Set(deletes || []);
    for (const [key] of updateEntries) {
      if (!isLogicalDataKey(key) || REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) {
        throw new Error(`datastore refusing non-generational key ${key}`);
      }
    }
    for (const key of deletes || []) {
      if (!isLogicalDataKey(key) || REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) {
        throw new Error(`datastore refusing generational delete ${key}`);
      }
      if (updateKeys.has(key)) throw new Error(`datastore key cannot be updated and deleted together: ${key}`);
    }

    const prior = await getPublication({ fresh: true });
    const objects = prior
      ? Object.fromEntries(Object.entries(prior.manifest.objects).map(([key, value]) => [key, { ...value }]))
      : await legacyObjects();
    const id = generationId(owner, now);
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("datastore generation id is invalid");
    const prefix = `${DATA_GENERATION_PREFIX}${id}/`;
    const publishedAt = now.toISOString();

    // Materialize any legacy-root mappings into this immutable generation. This
    // matters when the first post-cutover writer is a small scanner overlay:
    // the carried bake snapshot must not remain mutable behind the pointer.
    const legacyMappings = Object.entries(objects).filter(([key, record]) =>
      record.path === key && !updateKeys.has(key) && !deleteKeys.has(key),
    );
    const materialized = await mapLimit(legacyMappings, 8, async ([key, record]) => {
      const body = await raw.get(record.path);
      if (body == null) throw new Error(`datastore legacy object disappeared during publication: ${key}`);
      const path = `${prefix}objects/${key}`;
      await raw.put(path, body);
      return [key, { path, size: body.length, uploadedAt: publishedAt }];
    });

    // Physical objects are immutable. If any upload rejects, control never
    // reaches the manifest/pointer writes; successfully-uploaded siblings are
    // harmless orphans reclaimed by a later GC.
    const uploaded = await mapLimit(updateEntries, 8, async ([key, body]) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const path = `${prefix}objects/${key}`;
      await raw.put(path, buf);
      return [key, { path, size: buf.length, uploadedAt: publishedAt }];
    });
    for (const [key, record] of materialized) objects[key] = record;
    for (const [key, record] of uploaded) objects[key] = record;
    for (const key of deletes || []) delete objects[key];
    if (Object.keys(objects).length === 0) {
      throw new Error("datastore refusing to publish an empty logical snapshot");
    }

    const manifestKey = `${prefix}manifest.json`;
    const manifest = {
      version: PUBLICATION_VERSION,
      generation: id,
      owner,
      publishedAt,
      previousGeneration: prior?.manifest?.generation || null,
      objects,
    };
    const pointer = {
      version: PUBLICATION_VERSION,
      generation: id,
      owner,
      publishedAt,
      manifestKey,
    };
    await raw.put(manifestKey, Buffer.from(JSON.stringify(manifest), "utf8"));
    await raw.put(DATA_PUBLICATION_POINTER_KEY, Buffer.from(JSON.stringify(pointer), "utf8"));
    publicationCache = validatePublication(pointer, manifest, manifestKey);
    publicationCacheAt = Date.now();
    return publicationCache;
  }

  async function get(key) {
    if (isPublicationMetadataKey(key)) return null;
    if (!isLogicalDataKey(key)) return null;
    if (REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) return raw.get(key);
    const publication = await getPublication();
    if (!publication) return raw.get(key); // clean legacy fallback: no pointer
    const record = publication.manifest.objects[key];
    if (!record) return null;
    const body = await raw.get(record.path);
    // A manifest mapping is an integrity promise, not a normal "not found".
    // Surface a backend failure so the response boundary returns 502 and never
    // misreports a torn/corrupt publication as an ordinary logical 404.
    if (body == null) throw new Error(`datastore published object is missing: ${key}`);
    return body;
  }

  async function list(prefix = "") {
    if (prefix === "_stonks" || String(prefix).startsWith(DATA_INTERNAL_PREFIX)) return [];
    const publication = await getPublication();
    if (!publication) {
      const entries = await raw.list(prefix);
      return entries.filter((entry) =>
        isLogicalDataKey(entry?.key) && !isPublicationMetadataKey(entry?.key),
      );
    }
    const generated = Object.entries(publication.manifest.objects)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, record]) => ({
        key,
        size: Number(record.size) || 0,
        uploadedAt: record.uploadedAt || publication.manifest.publishedAt || null,
      }));
    // Request-time keys intentionally live outside the immutable snapshot, but
    // remain part of the logical store surface (notably for workflow hydrate).
    const requestTime = (await mapLimit(
      [...REQUEST_TIME_EXCLUSIVE_KEYS].filter((key) => key.startsWith(prefix)),
      4,
      async (key) => {
        const body = await raw.get(key);
        return body == null ? null : { key, size: body.length, uploadedAt: null };
      },
    )).filter(Boolean);
    return [...generated, ...requestTime]
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  async function put(key, body) {
    if (isPublicationMetadataKey(key)) throw new Error(`datastore refusing internal key ${key}`);
    if (!isLogicalDataKey(key)) throw new Error(`datastore refusing invalid logical key ${key}`);
    if (REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) return raw.put(key, body);
    // Maintenance callers such as wipe-history get an atomic one-key manifest
    // generation once the pointer exists; pre-cutover stores remain root-based.
    const publication = await getPublication({ fresh: true });
    if (!publication) return raw.put(key, body);
    await publishGeneration({ owner: "logical-put", updates: new Map([[key, body]]) });
  }

  async function del(key) {
    if (isPublicationMetadataKey(key)) throw new Error(`datastore refusing internal key ${key}`);
    if (!isLogicalDataKey(key)) throw new Error(`datastore refusing invalid logical key ${key}`);
    if (REQUEST_TIME_EXCLUSIVE_KEYS.has(key)) return raw.del(key);
    const publication = await getPublication({ fresh: true });
    if (!publication) return raw.del(key);
    await publishGeneration({ owner: "logical-delete", deletes: [key] });
  }

  async function gcGenerations({ graceMs = 26 * 3600000, now = new Date() } = {}) {
    const publication = await getPublication({ fresh: true });
    if (!publication) return { scanned: 0, deleted: 0 };
    const entries = await raw.list(DATA_GENERATION_PREFIX);
    const cutoff = now.getTime() - graceMs;
    const keep = new Set([
      publication.manifestKey,
      ...Object.values(publication.manifest.objects).map((record) => record.path),
    ]);

    // Protect every snapshot on the active pointer's predecessor chain that
    // was retired inside the grace window. Object upload age is NOT retirement
    // age: an unchanged object can be months old when a new pointer finally
    // supersedes the snapshot that referenced it. Deleting by upload time alone
    // races readers that pinned the prior pointer immediately before the flip.
    const manifests = new Map([[publication.manifest.generation, {
      key: publication.manifestKey,
      manifest: publication.manifest,
    }]]);
    const protectedPrefixes = new Set();
    const manifestEntries = entries.filter((entry) =>
      /^_stonks\/generations\/[A-Za-z0-9-]+\/manifest\.json$/.test(entry?.key || "") &&
      entry.key !== publication.manifestKey,
    );
    await mapLimit(manifestEntries, 8, async (entry) => {
      const match = /^_stonks\/generations\/([A-Za-z0-9-]+)\/manifest\.json$/.exec(entry.key);
      if (!match) return;
      const generation = match[1];
      const body = await raw.get(entry.key);
      if (body == null) {
        protectedPrefixes.add(`${DATA_GENERATION_PREFIX}${generation}/`);
        return;
      }
      try {
        const manifest = parseJsonBuffer(body, `generation ${generation} manifest`);
        validatePublication(
          { version: PUBLICATION_VERSION, generation, manifestKey: entry.key },
          manifest,
          entry.key,
        );
        manifests.set(generation, { key: entry.key, manifest });
      } catch {
        // Unknown manifest contents may reference siblings in the same
        // generation. Retain that prefix rather than guessing during GC.
        protectedPrefixes.add(`${DATA_GENERATION_PREFIX}${generation}/`);
      }
    });

    let child = publication.manifest;
    const visited = new Set([child.generation]);
    while (child.previousGeneration) {
      const previousGeneration = String(child.previousGeneration);
      if (!/^[A-Za-z0-9-]+$/.test(previousGeneration) || visited.has(previousGeneration)) {
        throw new Error("datastore publication predecessor chain is invalid");
      }
      const retiredAt = Date.parse(child.publishedAt || "");
      if (!Number.isFinite(retiredAt)) {
        throw new Error("datastore publication predecessor retirement time is invalid");
      }
      // This predecessor (and therefore every older one) was retired before
      // the grace window. Active mappings above remain protected separately.
      if (retiredAt <= cutoff) break;
      const previous = manifests.get(previousGeneration);
      if (!previous) {
        // A predecessor manifest can map logical keys to objects from ANY
        // earlier generation, not just its own prefix. Without the manifest we
        // cannot construct a safe keep-set, so defer the entire GC pass.
        throw new Error(`datastore publication predecessor is unavailable: ${previousGeneration}`);
      }
      keep.add(previous.key);
      for (const record of Object.values(previous.manifest.objects)) keep.add(record.path);
      visited.add(previousGeneration);
      child = previous.manifest;
    }

    const stale = entries.filter((entry) => {
      if (!entry?.key?.startsWith(DATA_GENERATION_PREFIX) || keep.has(entry.key)) return false;
      if ([...protectedPrefixes].some((prefix) => entry.key.startsWith(prefix))) return false;
      const uploadedMs = Date.parse(entry.uploadedAt || "");
      // Unknown timestamps are retained: deletion must be conservative.
      return Number.isFinite(uploadedMs) && uploadedMs < cutoff;
    });
    await mapLimit(stale, 8, (entry) => raw.del(entry.key));
    return { scanned: entries.length, deleted: stale.length };
  }

  return {
    get,
    put,
    del,
    list,
    getPublication,
    publishGeneration,
    gcGenerations,
    rawGet: raw.get,
    rawPut: raw.put,
    rawDel: raw.del,
    rawList: raw.list,
    hasToken: raw.hasToken,
    backend: raw.backend,
  };
}

export function createStore(opts = {}) {
  const r2 = {
    accountId: opts.r2AccountId || process.env.R2_ACCOUNT_ID || "",
    accessKeyId: opts.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: opts.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: opts.r2Bucket || process.env.R2_BUCKET || "",
    endpoint: opts.r2Endpoint || process.env.R2_ENDPOINT || "",
  };
  const requiredR2 = [
    ["R2_ACCOUNT_ID", r2.accountId],
    ["R2_ACCESS_KEY_ID", r2.accessKeyId],
    ["R2_SECRET_ACCESS_KEY", r2.secretAccessKey],
    ["R2_BUCKET", r2.bucket],
  ];
  const configuredR2 = requiredR2.filter(([, value]) => !!value);
  if (configuredR2.length && configuredR2.length !== requiredR2.length) {
    const missing = requiredR2.filter(([, value]) => !value).map(([name]) => name);
    throw new Error(`datastore: incomplete R2 configuration (missing ${missing.join(", ")})`);
  }
  if (configuredR2.length === requiredR2.length) {
    return withPublishedGenerations(createR2Store(r2));
  }
  return withPublishedGenerations(createBlobStore(opts));
}

// Default singleton from env. Does not throw when no backend is configured;
// it deliberately throws at import time for a partial R2 configuration.
export const store = createStore();

export default store;

// Private data store — backend-agnostic adapter (Cloudflare R2 or Vercel Blob).
//
// Storage layer behind the Path B private-data migration
// (docs/private-data-migration.md). Premium data/*.json live in a PRIVATE
// object store — never reachable by URL, only with credentials. The build/scan
// scripts hydrate a local data/ dir from here and flush back
// (scripts/sync-data.mjs); the gated api/data/* function streams a file from
// here after checking the Discord session.
//
// Interface (kept small + backend-agnostic so the backend is a drop-in swap):
//   get(key)         -> Buffer | null         (null when missing)
//   put(key, body)   -> void                  (upsert; overwrites in place)
//   del(key)         -> void
//   list(prefix='')  -> [{ key, size, uploadedAt }]
//
// "key" is the data/ relative path, e.g. "picks.json", "NVDA.json",
// "iv-history/NVDA.json" — a 1:1 map of today's static paths, used directly as
// the object pathname.
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

const DEFAULT_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const ACCESS = "private";

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
    return createR2Store(r2);
  }
  return createBlobStore(opts);
}

// Default singleton from env. Does not throw when no backend is configured;
// it deliberately throws at import time for a partial R2 configuration.
export const store = createStore();

export default store;

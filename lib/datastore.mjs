// Private data store — backend-agnostic adapter (Vercel Blob impl).
//
// This is the storage layer behind the Path B private-data migration
// (docs/private-data-migration.md). The premium data/*.json artifacts move
// out of the public Git repo into a private object store; the build/scan
// scripts hydrate a local data/ dir from here and flush back to it
// (scripts/sync-data.mjs), and the gated api/data/* function streams files
// from here after checking the Discord session.
//
// Interface (kept small + backend-agnostic so R2/S3 is a drop-in swap later):
//   get(key)         -> Buffer | null         (null when missing)
//   put(key, body)   -> void                  (upsert; overwrites in place)
//   del(key)         -> void
//   list(prefix='')  -> [{ key, url, size, uploadedAt }]
//   keyToPathname(k) -> string                (debug / sync introspection)
//
// "key" is the data/ relative path, e.g. "picks.json", "NVDA.json",
// "iv-history/NVDA.json" — a 1:1 map of today's static paths, so nothing
// else has to learn new names.
//
// SECURITY NOTE (Vercel Blob specifics):
//   Vercel Blob serves blobs over a public, capability-style URL. We never
//   hand those URLs to the browser — the gated api/data/* function fetches
//   them SERVER-SIDE and streams the bytes, so the URL is a server-only
//   secret. As defence-in-depth we also namespace every key under a path
//   prefix that is NOT guessable from the (fixed) store host alone: it is
//   derived by hashing the read/write token (one-way SHA-256, so it never
//   reveals the token). Set BLOB_PREFIX to pin it explicitly (e.g. to
//   decouple from token rotation). Rotating the token without setting
//   BLOB_PREFIX changes the derived prefix → re-seed required.

import { put as blobPut, list as blobList, del as blobDel } from "@vercel/blob";
import { createHash } from "node:crypto";

const DEFAULT_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

function derivePrefix(token) {
  // Stable, non-token-revealing path segment. Without it, a leaked store
  // host + a known filename (picks.json) would be directly fetchable.
  const h = createHash("sha256").update("stonks-data\0" + String(token || "")).digest("hex");
  return "d-" + h.slice(0, 24);
}

// Retry wrapper for the network ops — Yahoo/Gemini flake is handled
// elsewhere; here we just want blob hiccups not to fail a whole sync.
async function withRetry(label, fn, { tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === tries - 1) break;
      const waitMs = 250 * 2 ** i;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`datastore ${label} failed after ${tries} tries: ${lastErr?.message || lastErr}`);
}

export function createStore({ token, prefix } = {}) {
  const tok = token || process.env[DEFAULT_TOKEN_ENV] || "";
  const storePrefix = prefix || process.env.BLOB_PREFIX || derivePrefix(tok);
  // Cache pathname -> url so repeated get()s in a warm process (e.g. the
  // gated function, or a sync run) skip the list() round-trip.
  const urlCache = new Map();

  function requireToken() {
    if (!tok) throw new Error(`datastore: ${DEFAULT_TOKEN_ENV} is not set`);
  }
  function keyToPathname(key) {
    const clean = String(key).replace(/^\/+/, "");
    return `${storePrefix}/${clean}`;
  }
  function pathnameToKey(pathname) {
    const head = storePrefix + "/";
    return pathname.startsWith(head) ? pathname.slice(head.length) : pathname;
  }

  async function resolveUrl(key) {
    const pathname = keyToPathname(key);
    if (urlCache.has(pathname)) return urlCache.get(pathname);
    // prefix-match then exact-filter (list() does literal prefix matching).
    const { blobs } = await withRetry("list(resolve)", () =>
      blobList({ token: tok, prefix: pathname, limit: 1000 }),
    );
    const hit = blobs.find((b) => b.pathname === pathname);
    const url = hit ? hit.url : null;
    if (url) urlCache.set(pathname, url);
    return url;
  }

  async function get(key) {
    requireToken();
    const url = await resolveUrl(key);
    if (!url) return null;
    const res = await withRetry("get(fetch)", async () => {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    });
    if (res === null) urlCache.delete(keyToPathname(key));
    return res;
  }

  async function put(key, body) {
    requireToken();
    const pathname = keyToPathname(key);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const result = await withRetry("put", () =>
      blobPut(pathname, buf, {
        access: "public",
        token: tok,
        addRandomSuffix: false, // stable pathname so keys are addressable
        allowOverwrite: true, // upsert semantics
        contentType: "application/json",
        cacheControlMaxAge: 0, // gated content — never CDN-cache the blob itself
      }),
    );
    if (result?.url) urlCache.set(pathname, result.url);
    return;
  }

  async function del(key) {
    requireToken();
    const url = await resolveUrl(key);
    if (!url) return;
    await withRetry("del", () => blobDel(url, { token: tok }));
    urlCache.delete(keyToPathname(key));
  }

  async function list(prefix = "") {
    requireToken();
    const full = keyToPathname(prefix); // storePrefix + '/' + prefix (prefix may be '')
    const out = [];
    let cursor;
    do {
      const page = await withRetry("list", () =>
        blobList({ token: tok, prefix: full, cursor, limit: 1000 }),
      );
      for (const b of page.blobs) {
        urlCache.set(b.pathname, b.url);
        out.push({
          key: pathnameToKey(b.pathname),
          url: b.url,
          size: b.size,
          uploadedAt: b.uploadedAt,
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  return { get, put, del, list, keyToPathname, storePrefix, hasToken: () => !!tok };
}

// Default singleton from env. Does NOT throw at import time when the token is
// missing — methods throw on use — so the module is safe to import anywhere.
export const store = createStore();

export default store;

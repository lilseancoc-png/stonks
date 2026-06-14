// Private data store — backend-agnostic adapter (Vercel Blob, PRIVATE access).
//
// Storage layer behind the Path B private-data migration
// (docs/private-data-migration.md). Premium data/*.json live in a PRIVATE
// Vercel Blob store — never reachable by URL, only with the read/write token.
// The build/scan scripts hydrate a local data/ dir from here and flush back
// (scripts/sync-data.mjs); the gated api/data/* function streams a file from
// here after checking the Discord session.
//
// Interface (kept small + backend-agnostic so R2/S3 is a drop-in swap later):
//   get(key)         -> Buffer | null         (null when missing)
//   put(key, body)   -> void                  (upsert; overwrites in place)
//   del(key)         -> void
//   list(prefix='')  -> [{ key, size, uploadedAt }]
//
// "key" is the data/ relative path, e.g. "picks.json", "NVDA.json",
// "iv-history/NVDA.json" — a 1:1 map of today's static paths, used directly as
// the blob pathname (a private store has no public URLs, so no namespacing /
// unguessable-prefix dance is needed — the token IS the access boundary).

import { put as blobPut, get as blobGet, list as blobList, del as blobDel } from "@vercel/blob";

const DEFAULT_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const ACCESS = "private";

// Retry wrapper for the network ops so a transient blob hiccup doesn't fail a
// whole sync.
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

export function createStore({ token } = {}) {
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

  return { get, put, del, list, hasToken: () => !!tok };
}

// Default singleton from env. Does NOT throw at import time when the token is
// missing — methods throw on use — so the module is safe to import anywhere.
export const store = createStore();

export default store;

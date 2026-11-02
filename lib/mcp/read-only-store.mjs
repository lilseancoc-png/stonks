// lib/mcp/read-only-store.mjs — the only store handles the MCP ever holds.
//
// The MCP is read-only by construction, not by convention: every tool gets a
// store that exposes `get` and nothing else. Any attempt to write, delete,
// list, publish or take a lease throws READ_ONLY before it reaches R2.
//
// `dryRunStore` exists for shared site code that computes a view and also
// records request-time state (approvedTopPicks saves its market holds in
// top-picks-approval.json, which the Webull mirror reads). It lets that code
// run unchanged against an in-memory overlay: reads see its own pending
// writes, the overlay is thrown away when the call ends, and nothing reaches
// the real store.

const WRITE_METHODS = ["put", "del", "list", "withLease", "publishGeneration", "gcGenerations", "rawPut", "rawDel", "rawList"];

export class ReadOnlyStoreError extends Error {
  constructor(method) {
    super(`The MCP store is read-only (blocked ${method})`);
    this.code = "READ_ONLY";
  }
}

export function readOnlyStore(store) {
  if (!store || typeof store.get !== "function") throw new TypeError("readOnlyStore needs a store with get()");
  if (store.__mcpReadOnly) return store;
  const ro = { backend: store.backend || "unknown", __mcpReadOnly: true, get: (key) => store.get(key) };
  for (const m of WRITE_METHODS) ro[m] = async () => { throw new ReadOnlyStoreError(m); };
  return Object.freeze(ro);
}

export function dryRunStore(store) {
  const base = readOnlyStore(store);
  const overlay = new Map();
  const dry = {
    backend: base.backend,
    __mcpReadOnly: true,
    async get(key) {
      if (overlay.has(key)) return overlay.get(key);
      return base.get(key);
    },
    async put(key, body) {
      overlay.set(key, Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    },
    // A process-local "lease": the callback runs once with a no-op guard. No
    // lock object is written, so a real site request is never blocked by it.
    async withLease(_name, fn) {
      return { busy: false, result: await fn(() => {}) };
    },
  };
  for (const m of WRITE_METHODS) if (!(m in dry)) dry[m] = async () => { throw new ReadOnlyStoreError(m); };
  return Object.freeze(dry);
}

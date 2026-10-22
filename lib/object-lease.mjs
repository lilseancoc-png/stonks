import { randomUUID } from "node:crypto";

// A single shared broker account needs one writer. read/write use object-store
// ETags and conditional PUTs. A conditional release cannot erase a successor.
export async function withObjectLease({ read, write, now = Date.now, ttlMs = 120000 }, fn) {
  const prior = await read();
  if (prior && (!Number.isFinite(prior.value?.expiresAt) || prior.value.expiresAt > now())) return { busy: true };
  const owner = randomUUID(), expiresAt = now() + ttlMs;
  const etag = await write({ owner, expiresAt }, prior?.etag ?? null);
  if (!etag) return { busy: true };
  const guard = () => {
    if (now() >= expiresAt - 15000) throw Object.assign(new Error("mirror lease expired; stop before another broker action"), { code: "LEASE_EXPIRED" });
  };
  try { return { busy: false, result: await fn(guard) }; }
  finally { await write({ owner, expiresAt: 0 }, etag).catch(() => null); }
}

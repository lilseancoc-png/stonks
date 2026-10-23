import { randomUUID } from "node:crypto";

// Safe for Owner diagnostics: never expose the owner token or object ETag.
export function describeObjectLease(prior, nowMs = Date.now()) {
  if (!prior) return { state: "absent", retryAfterMs: 0 };
  const value = prior.value;
  if (!value || typeof value.owner !== "string" || !value.owner ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0 ||
      value.expiresAt > 8640000000000000) return { state: "invalid", retryAfterMs: null };
  return { state: value.expiresAt === 0 ? "released" : value.expiresAt > nowMs ? "held" : "expired",
    expiresAtIso: value.expiresAt === 0 ? null : new Date(value.expiresAt).toISOString(),
    retryAfterMs: Math.max(0, value.expiresAt - nowMs) };
}

// A single shared broker account needs one writer. read/write use object-store
// ETags and conditional PUTs. A conditional release cannot erase a successor.
export async function withObjectLease({ read, write, now = Date.now, ttlMs = 120000 }, fn) {
  let etag, owner, expiresAt;
  // Re-read on a conditional-write race. A previous owner may have released
  // between our GET and PUT; retrying the old ETag would never acquire it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const prior = await read(), state = describeObjectLease(prior, now());
    if (state.state === "invalid") throw Object.assign(new Error("mirror lease is malformed; inspect the stored lock before recovery"), { code: "LEASE_INVALID" });
    if (state.state === "held") return { busy: true, reason: "held", retryAfterMs: state.retryAfterMs };
    owner = randomUUID(); expiresAt = now() + ttlMs;
    etag = await write({ owner, expiresAt }, prior?.etag ?? null);
    if (etag) break;
  }
  if (!etag) throw Object.assign(new Error("mirror lease conditional writes keep conflicting; inspect the stored lock"), { code: "LEASE_CONFLICT" });
  const guard = () => {
    if (now() >= expiresAt - 15000) throw Object.assign(new Error("mirror lease expired; stop before another broker action"), { code: "LEASE_EXPIRED" });
  };
  try { return { busy: false, result: await fn(guard) }; }
  finally { await write({ owner, expiresAt: 0 }, etag).catch(() => null); }
}

// Shared bits of the W3 Webull data jobs (webull-flow, webull-breadth,
// webull-backup): reading and writing their Owner keys, and telling a refused
// symbol (logged as a miss) from a failure the runner should retry.

// The covered funds (SECTORS "ETF" in scripts/build.mjs). Funds have no
// earnings, analyst ratings or targets, so the backup job skips them;
// scripts/webull-w3-smoke.mjs checks this list against build.mjs.
export const FUND_SYMBOLS = Object.freeze(["SPY", "QQQ", "IWM", "SMH", "UVXY", "TLT", "USO", "GLD", "SLV", "KWEB", "EWY"]);

// A Webull answer that says "this request will never work" (bad symbol, not
// supported for this instrument): 400, 404 or 417 (Webull's business error,
// e.g. INVALID_SYMBOL). Anything else (429, 5xx, a network error) is thrown
// back to the runner, which cools the group and retries later.
export function isRefusal(err) {
  const s = Number(err?.status);
  return s === 400 || s === 404 || s === 417;
}

// Fixed-label reason for a refusal (never the request or a symbol).
export function refusalReason(err) {
  const code = String(err?.code || "").replace(/[^A-Z0-9_]/gi, "").slice(0, 32);
  return code || `HTTP_${Number(err?.status) || "ERR"}`;
}

// A missing key starts an empty file. A failed read or an unreadable file
// throws, so the runner retries later instead of saving over a long history
// with an empty one.
export async function readKey(store, key, empty) {
  const buf = await store.get(key);
  if (buf == null) return empty();
  const j = JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf));
  if (!j || typeof j !== "object") throw new Error(`${key} is not an object`);
  return j;
}

export async function writeKey(store, key, value) {
  await store.put(key, JSON.stringify(value));
}

// Plan once per ET session date, only on the after-the-close pass.
export function planOnce(state, ctx) {
  if (!state || typeof state !== "object") return false;
  if (ctx?.phase && ctx.phase !== "close") return false;
  if (!ctx?.date || state.planned === ctx.date) return false;
  state.planned = ctx.date;
  return true;
}

export function count(ctx, name, n = 1) {
  try { if (typeof ctx?.count === "function") ctx.count(name, n); } catch { /* counting is best effort */ }
}

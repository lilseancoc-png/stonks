// Pings the Webull paper mirror (api/auth/[action].js "webull-mirror") after a
// full bake, so it copies the record's new opens/closes into the Webull paper
// account. Run by .github/workflows/daily.yml. The repo is public, so this
// prints only the HTTP status: no balances, orders or tokens reach the log.
// The bearer token is derived from R2_SECRET_ACCESS_KEY (lib/webull-mirror.mjs).
// Never fails the build.
import { mirrorTriggerToken } from "../lib/webull-mirror.mjs";

const secret = process.env.R2_SECRET_ACCESS_KEY || "";
const url = process.env.WEBULL_MIRROR_URL || "https://mingstreet.app/api/auth/webull-mirror";
if (!secret) {
  console.log("Webull mirror: no store secret, skipped.");
  process.exit(0);
}
try {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${mirrorTriggerToken(secret)}` },
    signal: AbortSignal.timeout(90000),
  });
  // ran / not-ran plus the fixed off reason (mirror off, keys missing, market
  // closed) and an error count; never the order or account details.
  const body = await res.json().catch(() => null);
  const why = body?.ran === false ? `, not run (${String(body.reason || body.summary?.skipped || "unknown").slice(0, 60)})`
    : body?.error ? `, failed (${["code", "status", "kind"].filter((k) => body[k] != null).map((k) => `${k} ${String(body[k]).slice(0, 40)}`).join(", ") || "no code"}${body.detail ? `: ${String(body.detail).slice(0, 120)}` : ""})`
    : body?.ran === true ? `, ran${body.summary?.note ? ` (${String(body.summary.note).slice(0, 60)})` : ""}${body.summary?.errors ? `, ${Number(body.summary.errors) || 0} errors` : ""}` : "";
  console.log(`Webull mirror: HTTP ${res.status}${why}`);
} catch (err) {
  console.log(`Webull mirror: request failed (${err?.name || "error"})`);
}

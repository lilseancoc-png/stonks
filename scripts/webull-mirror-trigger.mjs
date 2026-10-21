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
  console.log(`Webull mirror: HTTP ${res.status}`);
} catch (err) {
  console.log(`Webull mirror: request failed (${err?.name || "error"})`);
}

// Pings the Webull paper mirror (api/auth/[action].js "webull-mirror") after a
// Top Picks publication, so it copies the record's new opens/closes into the Webull paper
// account. Run by .github/workflows/daily.yml. The repo is public, so this
// prints only the HTTP status: no balances, orders or tokens reach the log.
// The bearer token is derived from R2_SECRET_ACCESS_KEY (lib/webull-mirror.mjs).
// The build marks this step nonfatal; strict runs expose errors and pending work.
import { mirrorTriggerToken } from "../lib/webull-mirror.mjs";
import { runMirrorWindow } from "../lib/webull-mirror-window.mjs";

const strict = process.env.WEBULL_MIRROR_STRICT === "1";
// A published build starts the window; wall-clock filtering here could drop a
// legitimately queued 11:00/15:30 build. The server enforces exchange hours.
const followUps = ["2", "4"].includes(process.env.WEBULL_MIRROR_FOLLOW_UPS) ? Number(process.env.WEBULL_MIRROR_FOLLOW_UPS) : 0;
const secret = process.env.R2_SECRET_ACCESS_KEY || "";
const url = process.env.WEBULL_MIRROR_URL || "https://mingstreet.app/api/auth/webull-mirror";
if (!secret) {
  console.log("Webull mirror: no store secret, skipped.");
  process.exit(strict ? 1 : 0);
}
async function trigger() {
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
  console.log(`Webull mirror: HTTP ${res.status}${why}${body?.summary?.alerts ? ", review required (Owner Webull test view)" : ""}`);
  return { ok: res.ok, body };
}
try {
  const { response, pending } = await runMirrorWindow({ trigger, followUps });
  const res = response, body = response.body;
  if (pending) console.log("Webull mirror: execution/reconciliation remains pending after this build window; check Owner Webull test or run the manual reconciliation.");
  const benignSkip = body?.reason === "mirror already running" || body?.summary?.skipped === "ran less than a minute ago";
  if (strict && (pending || !res.ok || body?.summary?.errors || body?.summary?.alerts || body?.ran !== true && !benignSkip)) process.exitCode = 1;
} catch (err) {
  console.log(`Webull mirror: request failed (${err?.name || "error"})`);
  if (strict) process.exitCode = 1;
}

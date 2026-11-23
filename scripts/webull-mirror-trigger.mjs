// Pings the Webull paper mirror (api/auth/[action].js "webull-mirror") after a
// Top Picks publication, so it copies the record's new opens/closes into the Webull paper
// account. Run by .github/workflows/webull-mirror.yml, which the 11:00 / 15:30 ET
// Daily builds dispatch after publication. The repo is public, so this prints
// only the HTTP status, counts and fixed review labels (describeReviewKinds):
// no tickers, balances, orders or tokens reach the log. The bearer token is
// derived from R2_SECRET_ACCESS_KEY (lib/webull-mirror.mjs). Strict runs fail
// the workflow on errors, alerts and pending work other than an order still
// working inside its price allowance.
import { mirrorTriggerToken, describeReviewKinds, describeKindCounts as describeKinds } from "../lib/webull-mirror.mjs";
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
    : body?.ran === true ? `, ran${body.summary?.note ? ` (${String(body.summary.note).slice(0, 60)})` : ""}${body.summary?.errors ? `, ${Number(body.summary.errors) || 0} errors${describeKinds(body.summary.errorKinds) ? ` (${describeKinds(body.summary.errorKinds)})` : ""}` : ""}` : "";
  const kinds = describeReviewKinds(body?.summary);
  // Warnings (fixed words, e.g. the cash check could not run) never fail the window.
  const warn = describeKinds(body?.summary?.warnings);
  // Webull's own data used this run (contract checks, share quotes, real
  // fees): fixed words and counts only.
  const data = describeKinds(body?.summary?.webullData);
  console.log(`Webull mirror: HTTP ${res.status}${why}${data ? `, Webull data (${data})` : ""}${warn ? `, warning (${warn})` : ""}${body?.summary?.alerts ? `, review required (${kinds ? `${kinds}; ` : ""}Owner Webull test view)` : ""}`);
  return { ok: res.ok, body };
}
try {
  const { response, pending } = await runMirrorWindow({ trigger, followUps });
  const res = response, body = response.body;
  let onlyNormal = false;
  if (pending) {
    // Fixed labels only. "Working inside its price allowance" is the normal
    // 2% / 4% ladder state: the order stays live and the end-of-day window
    // gives it the 5% ceiling; anything else is worth a look.
    const pk = body?.summary?.pendingKinds || null, normal = "entry order working inside its price allowance";
    // An entry the Webull call limit held for the next run is a planned wait too (2026-11-23).
    onlyNormal = !!pk && Object.keys(pk).every((k) => k === normal || k === "exit order working" || k === "entry waiting for the Webull call limit") && !body?.summary?.errors && !body?.summary?.alerts;
    console.log(`Webull mirror: still pending after this build window${describeKinds(pk) ? ` (${describeKinds(pk)})` : ""}. ` +
      (onlyNormal ? "This is the normal state of the price ladder: a limit order is still working inside its cap and stays live until it fills or the end-of-day window raises it to the 5% ceiling." : "Check the Owner Webull test view or run the manual reconciliation."));
  }
  const benignSkip = body?.reason === "mirror already running" || body?.summary?.skipped === "ran less than a minute ago";
  // A last check that found another window (the end-of-day workflow) holding
  // the account lease is not a failure: that window is doing the work.
  // Only the normal ladder state still pending (no errors, no alerts) is not a
  // failure: the order is working as designed and the log line says so.
  if (strict && (pending && !benignSkip && !onlyNormal || !res.ok || body?.summary?.errors || body?.summary?.alerts || body?.ran !== true && !benignSkip)) process.exitCode = 1;
} catch (err) {
  console.log(`Webull mirror: request failed (${err?.name || "error"})`);
  if (strict) process.exitCode = 1;
}

import { mirrorTriggerToken } from "../lib/webull-mirror.mjs";
import { endOfDayWindow, scheduledClosingWindow } from "../lib/webull-execution-policy.mjs";
import { runEndOfDayWindow } from "../lib/webull-mirror-window.mjs";

// GitHub's own schedule has run 1.5-4.5 hours late (every November run so far
// arrived after the close), so the 15:30 ET Top Picks build dispatches this
// workflow right after its mirror step. That dispatch sets
// WEBULL_EOD_WAIT_FOR_WINDOW and lands a few minutes before the final 20
// minutes; wait for the window instead of skipping it. Bounded: only when the
// window opens within WAIT_LIMIT_MIN, so an early dispatch exits quickly.
const WAIT_LIMIT_MIN = 45;
if (process.env.WEBULL_EOD_WAIT_FOR_WINDOW === "1") {
  const s = endOfDayWindow(Date.now());
  const minutesToWindow = s.trading ? s.closeMinute - 20 - s.minute : null;
  if (minutesToWindow > 0 && minutesToWindow <= WAIT_LIMIT_MIN) {
    console.log(`Webull end-of-day: waiting ${minutesToWindow} min for the closing window.`);
    while (!endOfDayWindow(Date.now()).monitor && endOfDayWindow(Date.now()).trading) await new Promise((r) => setTimeout(r, 15000));
  }
}
const current = endOfDayWindow(Date.now());
const lateDispatch = !current.trading && current.known && current.open && current.minute >= current.closeMinute && scheduledClosingWindow(Date.now(), process.env.WEBULL_EOD_SCHEDULE);
if (!current.monitor && !lateDispatch) {
  console.log("Webull end-of-day: outside the exchange closing window; skipped.");
} else {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error("Webull end-of-day: store authentication is missing");
  const url = new URL(process.env.WEBULL_MIRROR_URL || "https://mingstreet.app/api/auth/webull-mirror");
  url.searchParams.set("mode", "eod");
  const outcome = await runEndOfDayWindow({ session: endOfDayWindow, allowPostClose: lateDispatch, trigger: async () => {
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${mirrorTriggerToken(secret)}` }, signal: AbortSignal.timeout(90000) });
      const body = await res.json().catch(() => null);
      // The public repository receives counts only, never account/order data.
      console.log(`Webull end-of-day: HTTP ${res.status}${body?.summary?.alerts ? ", review required" : ""}`);
      return { ok: res.ok, body };
    } catch { return { ok: false, body: null }; }
  } });
  const r = outcome.response;
  if (!outcome.afterCloseChecked || !r?.ok || r.body?.ran !== true || r.body?.summary?.alerts || r.body?.summary?.errors || r.body?.summary?.followUpNeeded || r.body?.reason || !r.body?.summary?.endOfDayDeadlineObserved) {
    console.error("Webull end-of-day: unresolved execution or unavailable check; inspect the Owner tracker.");
    process.exitCode = 1;
  }
}

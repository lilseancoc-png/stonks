// Top Picks missed-run watchdog: the pure half.
//
// The two Top Picks decision runs (11:00 and 15:30 ET on trading days) are
// dispatched by cron-job.org. If a dispatch never arrives, or the build fails
// before it publishes, the open book is not marked, no exits fire and the
// Webull paper mirror does nothing until the next slot. This module looks at
// the Daily build runs GitHub has for today and says, per slot, whether the
// run published, is still running, failed or never arrived, and whether one
// retry may still be sent.
//
// scripts/top-picks-watchdog.mjs does the GitHub calls (list runs, read jobs,
// dispatch the retry, open or close the alert issue). It runs from
// top-picks-watchdog.yml on GitHub cron (best effort) and as the last step of
// every Daily build (on time, because cron-job.org dispatches those).
//
// Pure: no network, no clock reads. Callers pass `nowMs`.

import { etClock, sessionForDate } from "./us-equity-calendar.mjs";

export const TOP_PICKS_WATCHDOG_VERSION = 1;

// minute = ET minute of day. retryUntil is the last ET minute a retry may be
// sent: the 11:00 retry must finish before the 15:30 run starts (a newer
// pending run in the shared concurrency group would cancel it), and a 15:30
// retry must finish before the close (option orders stop at 16:00).
export const TOP_PICKS_SLOTS = Object.freeze([
  Object.freeze({ key: "11:00", minute: 660 }),
  Object.freeze({ key: "15:30", minute: 930 }),
]);
// cron-job.org's dispatch lands within seconds of the slot. Five minutes
// without any run means it never came.
export const MISSED_AFTER_MIN = 5;
// A healthy Top Picks build takes 5 to 20 minutes. Still going after this is
// worth a note in the alert, but not a second build (it would only queue).
export const SLOW_AFTER_MIN = 45;
const RETRY_TITLE = "Top Picks retry";

export function retryTitle(slotKey, date) {
  return `${RETRY_TITLE} ${slotKey} ET ${date}`;
}

export function isRetryTitle(title, slotKey, date) {
  return typeof title === "string" && title.startsWith(retryTitle(slotKey, date));
}

// The last ET minute a retry for this slot may be sent on this session.
export function retryDeadline(slot, session) {
  if (!slot || !session) return null;
  const beforeClose = session.closeMinute - 15;
  if (slot.minute === 660) return Math.min(900, beforeClose);
  return beforeClose;
}

// Slots that exist on this ET date. A slot at or after an early close (13:00)
// does not run.
export function slotsForDate(date) {
  const s = sessionForDate(date);
  if (!s || !s.open) return [];
  return TOP_PICKS_SLOTS.filter((slot) => slot.minute < s.closeMinute);
}

function etDateMinute(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return etClock(ms);
}

// runs: GitHub workflow runs for daily.yml, each
//   { id, created_at, status, conclusion, display_title, html_url, event, published }
// where `published` is true / false once the caller has read the jobs of a
// completed run (null while unknown).
export function runsForSlot(runs, slot, date) {
  const primary = [];
  const retries = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || r.event !== "workflow_dispatch") continue;
    const c = etDateMinute(r.created_at);
    if (!c || c.date !== date) continue;
    if (isRetryTitle(r.display_title, slot.key, date)) retries.push(r);
    // Same rule as daily.yml's router: only a dispatch received in the slot's
    // own minute refreshes Top Picks.
    else if (c.minute === slot.minute) primary.push(r);
  }
  return { primary, retries };
}

// One slot's state:
//   upcoming  the slot has not started
//   waiting   started under MISSED_AFTER_MIN ago, no run yet
//   running   a run (or the retry) is still going
//   slow      still going after SLOW_AFTER_MIN
//   ok        a run published (late=true when only the retry did)
//   failed    every run finished without publishing
//   missed    no run arrived
export function classifySlot(runs, slot, date, nowMs) {
  const now = etClock(nowMs);
  const { primary, retries } = runsForSlot(runs, slot, date);
  const all = primary.concat(retries);
  const base = { slot: slot.key, date, primary: primary.map(brief), retries: retries.map(brief) };
  const sameDay = now.date === date;
  if (sameDay && now.minute < slot.minute) return { ...base, state: "upcoming" };
  if (all.some((r) => r.published === true)) {
    const late = !primary.some((r) => r.published === true);
    return { ...base, state: "ok", late };
  }
  const active = all.filter((r) => r.status !== "completed");
  if (active.length) {
    const startedMin = Math.min(...active.map((r) => etDateMinute(r.created_at)?.minute ?? slot.minute));
    const slow = sameDay && now.minute - startedMin >= SLOW_AFTER_MIN;
    return { ...base, state: slow ? "slow" : "running" };
  }
  if (all.length) return { ...base, state: "failed" };
  if (sameDay && now.minute < slot.minute + MISSED_AFTER_MIN) return { ...base, state: "waiting" };
  return { ...base, state: "missed" };
}

// A run published when its build job flushed data to the private store (or,
// in the legacy mode, committed it). A later step failing, such as the static
// commit or the Webull health job, does not undo a publication.
export const PUBLISH_STEPS = Object.freeze(["Flush verified data to private store", "Commit refreshed site (legacy public data)"]);
export function runPublished(jobs) {
  return Array.isArray(jobs) && jobs.some((job) => job && job.name === "build" && Array.isArray(job.steps) &&
    job.steps.some((step) => step && step.conclusion === "success" && PUBLISH_STEPS.includes(step.name)));
}

function brief(r) {
  return { id: r.id, status: r.status, conclusion: r.conclusion ?? null, published: r.published ?? null, url: r.html_url || null, title: r.display_title || null };
}

// Today's plan: every slot's state, the one retry to send (if any) and what
// the alert issue should say.
//   opts.mode: "on" (retry + alert, default), "alert" (alert only), "off"
export function planWatchdog(runs, nowMs, opts = {}) {
  const mode = opts.mode === "off" || opts.mode === "alert" ? opts.mode : "on";
  const now = etClock(nowMs);
  const session = sessionForDate(now.date);
  const date = now.date;
  const slots = slotsForDate(date).map((slot) => {
    const st = classifySlot(runs, slot, date, nowMs);
    const deadline = retryDeadline(slot, session);
    const canRetry = mode === "on" && (st.state === "missed" || st.state === "failed") &&
      st.retries.length === 0 && deadline != null && now.minute <= deadline;
    return { ...st, retryDeadline: deadline, canRetry };
  });
  // At most one retry per watchdog pass: the newest slot that needs one. An
  // 11:00 miss is moot once the 15:30 slot has started.
  const later = (i) => slots.slice(i + 1).some((s) => s.state !== "upcoming");
  const retry = mode === "on" ? slots.filter((s, i) => s.canRetry && !later(i)).pop() || null : null;
  // A bad slot stops mattering once a later slot has published: that run
  // marked the book and fired the exits the missed one would have.
  const problems = slots.filter((s, i) => (s.state === "missed" || s.state === "failed" || s.state === "slow") &&
    !slots.slice(i + 1).some((x) => x.state === "ok"));
  const due = slots.filter((s) => s.state !== "upcoming" && s.state !== "waiting");
  const latestDue = due[due.length - 1] || null;
  // The alert stays open until the latest slot that is due has published.
  const healthy = !!latestDue && latestDue.state === "ok";
  return {
    v: TOP_PICKS_WATCHDOG_VERSION,
    date, minute: now.minute, mode, tradingDay: !!session?.open,
    slots,
    retry: retry ? { slot: retry.slot, title: retryTitle(retry.slot, date) } : null,
    alert: mode === "off" ? "none" : problems.length ? "open" : healthy ? "close" : "none",
    problems: problems.map((s) => s.slot),
  };
}

const STATE_TEXT = {
  upcoming: "not started yet",
  waiting: "starting",
  running: "running",
  slow: "still running after 45 minutes",
  ok: "published",
  failed: "failed before publishing",
  missed: "never started (no dispatch arrived)",
};

export function slotLine(s) {
  let text = STATE_TEXT[s.state] || s.state;
  if (s.state === "ok" && s.late) text = "published by the retry";
  if ((s.state === "failed" || s.state === "missed") && s.retries.length) {
    const r = s.retries[s.retries.length - 1];
    text += r.status !== "completed" ? "; retry running" : r.published ? "; retry published" : "; retry also failed";
  }
  return `${s.slot} ET: ${text}`;
}

// Issue title and body. Public repo: slot times and run links only, never
// picks, prices or the record.
export function issueText(plan, opts = {}) {
  const bad = plan.slots.filter((s) => plan.problems.includes(s.slot));
  const first = bad[0];
  const title = first
    ? `Top Picks run ${first.state === "slow" ? "running long" : first.state === "missed" ? "missed" : "failed"}: ${plan.date} ${first.slot} ET`
    : `Top Picks runs healthy: ${plan.date}`;
  const lines = [
    `Top Picks watchdog, ${plan.date} (checked ${String(Math.floor(plan.minute / 60)).padStart(2, "0")}:${String(plan.minute % 60).padStart(2, "0")} ET).`,
    "",
    ...plan.slots.map((s) => `- ${slotLine(s)}`),
    "",
  ];
  if (opts.retrySent) lines.push(`Sent one retry: a forced Daily build with Top Picks refresh ("${opts.retrySent}").`);
  else if (bad.some((s) => s.retries.length)) lines.push("One retry was already sent for this slot; no more are sent.");
  else if (bad.some((s) => s.state !== "slow" && !s.canRetry)) lines.push("Too late in the session for a retry (it must finish before the next slot or the close). The next scheduled run picks the book up.");
  if (plan.mode === "alert") lines.push("Retries are off (repo variable TOP_PICKS_WATCHDOG=alert).");
  const links = bad.flatMap((s) => s.primary.concat(s.retries)).filter((r) => r.url).map((r) => `- ${r.url}`);
  if (links.length) lines.push("", "Runs:", ...links);
  lines.push("", "Re-run by hand: Actions > Daily build > Run workflow with force and refresh_top_picks on. This issue closes itself when the next due slot publishes.");
  if (opts.runUrl) lines.push("", `_Checked by ${opts.runUrl}_`);
  return { title, body: lines.join("\n") };
}

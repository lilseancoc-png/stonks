// Top Picks missed-run watchdog: pure planner + workflow wiring.
// Run: node scripts/top-picks-watchdog-smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planWatchdog, classifySlot, runPublished, retryTitle, isRetryTitle, slotsForDate, retryDeadline,
  issueText, TOP_PICKS_SLOTS,
} from "../lib/top-picks-watchdog.mjs";
import { sessionForDate } from "../lib/us-equity-calendar.mjs";

// 2026-11-09 is a Monday in EST (UTC-5): 11:00 ET = 16:00Z, 15:30 ET = 20:30Z.
const D = "2026-11-09";
const at = (hhmm, date = D, offset = 5) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.parse(`${date}T00:00:00Z`) + ((h + offset) * 60 + m) * 60000;
};
const iso = (hhmm, date = D, offset = 5) => new Date(at(hhmm, date, offset)).toISOString();
let nextId = 1;
const run = (hhmm, o = {}) => ({
  id: nextId++, created_at: iso(hhmm, o.date), status: o.status || "completed", conclusion: o.conclusion ?? "success",
  display_title: o.title || "Daily build", html_url: `https://github.com/x/y/actions/runs/${nextId}`, event: o.event || "workflow_dispatch",
  published: o.published ?? (o.status && o.status !== "completed" ? null : true),
});

// Slots and deadlines.
assert.deepEqual(slotsForDate(D).map((s) => s.key), ["11:00", "15:30"]);
assert.deepEqual(slotsForDate("2026-11-26"), [], "Thanksgiving: market closed, no slots");
assert.deepEqual(slotsForDate("2026-11-27").map((s) => s.key), ["11:00"], "early close at 13:00 drops the 15:30 slot");
assert.deepEqual(slotsForDate("2026-11-08"), [], "Sunday");
assert.equal(retryDeadline(TOP_PICKS_SLOTS[0], sessionForDate(D)), 900, "11:00 retry must land before the 15:30 run");
assert.equal(retryDeadline(TOP_PICKS_SLOTS[1], sessionForDate(D)), 945, "15:30 retry must finish before the close");
assert.equal(retryDeadline(TOP_PICKS_SLOTS[0], sessionForDate("2026-11-27")), 765, "early close: 15 minutes before 13:00");
assert.ok(isRetryTitle(retryTitle("11:00", D), "11:00", D));
assert.ok(!isRetryTitle(retryTitle("11:00", D), "15:30", D));
assert.ok(!isRetryTitle("Daily build", "11:00", D));

// 1. Healthy 11:00 run.
let p = planWatchdog([run("11:00")], at("11:20"));
assert.equal(p.slots[0].state, "ok");
assert.equal(p.slots[1].state, "upcoming");
assert.equal(p.retry, null);
assert.equal(p.alert, "close", "a healthy latest slot closes an open alert");

// 2. No dispatch arrived: retry + alert.
p = planWatchdog([run("10:00")], at("11:20"));
assert.equal(p.slots[0].state, "missed");
assert.deepEqual(p.retry, { slot: "11:00", title: retryTitle("11:00", D) });
assert.equal(p.alert, "open");

// 3. Inside the first five minutes it is only "waiting".
p = planWatchdog([], at("11:03"));
assert.equal(p.slots[0].state, "waiting");
assert.equal(p.retry, null);
assert.equal(p.alert, "none");

// 4. A dispatch at 11:01 is a router no-op in daily.yml, so it does not count.
p = planWatchdog([run("11:01")], at("11:20"));
assert.equal(p.slots[0].state, "missed");

// 5. Build failed before publishing: retry.
p = planWatchdog([run("11:00", { conclusion: "failure", published: false })], at("11:12"));
assert.equal(p.slots[0].state, "failed");
assert.equal(p.retry.slot, "11:00");

// 6. Retry already running: no second retry, no new alert.
p = planWatchdog([run("11:00", { conclusion: "failure", published: false }), run("11:13", { title: retryTitle("11:00", D), status: "in_progress" })], at("11:20"));
assert.equal(p.slots[0].state, "running");
assert.equal(p.retry, null);
assert.equal(p.alert, "none");

// 7. Retry also failed: alert, no third build.
p = planWatchdog([run("11:00", { conclusion: "failure", published: false }), run("11:13", { title: retryTitle("11:00", D), conclusion: "failure", published: false })], at("11:40"));
assert.equal(p.slots[0].state, "failed");
assert.equal(p.retry, null);
assert.equal(p.alert, "open");
assert.match(issueText(p).body, /retry also failed/);

// 8. Retry published: ok (late), alert closes.
p = planWatchdog([run("11:00", { conclusion: "failure", published: false }), run("11:13", { title: retryTitle("11:00", D) })], at("11:40"));
assert.equal(p.slots[0].state, "ok");
assert.equal(p.slots[0].late, true);
assert.equal(p.alert, "close");

// 9. Too late for an 11:00 retry (after 15:00 ET): alert only.
p = planWatchdog([run("10:00")], at("15:05"));
assert.equal(p.slots[0].state, "missed");
assert.equal(p.slots[0].canRetry, false);
assert.equal(p.retry, null);
assert.equal(p.alert, "open");
assert.match(issueText(p).body, /Too late in the session/);

// 10. 15:30 slot missed at 15:38: retry allowed until 15:45.
p = planWatchdog([run("11:00")], at("15:38"));
assert.equal(p.slots[1].state, "missed");
assert.equal(p.retry.slot, "15:30");
p = planWatchdog([run("11:00")], at("15:50"));
assert.equal(p.retry, null, "a 15:30 retry after 15:45 would finish after the close");
assert.equal(p.alert, "open");

// 11. An 11:00 miss stops mattering once 15:30 has published.
p = planWatchdog([run("15:30")], at("16:15"));
assert.equal(p.slots[0].state, "missed");
assert.equal(p.slots[1].state, "ok");
assert.deepEqual(p.problems, []);
assert.equal(p.alert, "close");
assert.equal(p.retry, null);

// 12. The 16:10 bake is not the 15:30 run.
p = planWatchdog([run("11:00"), run("16:10")], at("16:20"));
assert.equal(p.slots[1].state, "missed");
assert.equal(p.alert, "open");

// 13. A build still going after 45 minutes is flagged, not retried.
p = planWatchdog([run("11:00", { status: "in_progress" })], at("11:50"));
assert.equal(p.slots[0].state, "slow");
assert.equal(p.retry, null);
assert.equal(p.alert, "open");
assert.match(issueText(p).title, /running long/);

// 14. Retries off (alert mode) and fully off.
p = planWatchdog([run("10:00")], at("11:20"), { mode: "alert" });
assert.equal(p.retry, null);
assert.equal(p.alert, "open");
assert.match(issueText(p).body, /Retries are off/);
p = planWatchdog([run("10:00")], at("11:20"), { mode: "off" });
assert.equal(p.alert, "none");

// 15. Holidays and weekends do nothing.
p = planWatchdog([], at("11:20", "2026-11-26"));
assert.equal(p.tradingDay, false);
assert.deepEqual(p.slots, []);
assert.equal(p.alert, "none");

// 16. Early close: 11:00 retry deadline 12:45.
p = planWatchdog([], at("12:40", "2026-11-27"));
assert.equal(p.retry?.slot, "11:00");
p = planWatchdog([], at("12:50", "2026-11-27"));
assert.equal(p.retry, null);

// 17. Summer time (EDT, UTC-4): the same ET clock.
p = planWatchdog([run("11:00", { date: "2026-06-10" })].map((r) => ({ ...r, created_at: iso("11:00", "2026-06-10", 4) })), at("11:20", "2026-06-10", 4));
assert.equal(p.slots[0].state, "ok");

// 18. Only workflow_dispatch runs and only today's runs count.
p = planWatchdog([run("11:00", { event: "push" }), run("11:00", { date: "2026-11-06" })], at("11:20"));
assert.equal(p.slots[0].state, "missed");

// Publication predicate.
const flush = { name: "Flush verified data to private store", conclusion: "success" };
assert.equal(runPublished([{ name: "build", conclusion: "success", steps: [flush] }]), true);
assert.equal(runPublished([{ name: "build", conclusion: "failure", steps: [flush] }]), true, "a later static-commit failure does not undo the flush");
assert.equal(runPublished([{ name: "build", conclusion: "success", steps: [{ ...flush, conclusion: "skipped" }] }]), false);
assert.equal(runPublished([{ name: "build", conclusion: "success", steps: [{ name: "Commit refreshed site (legacy public data)", conclusion: "success" }] }]), true);
assert.equal(runPublished([{ name: "route", conclusion: "success", steps: [flush] }]), false);
assert.equal(runPublished([]), false);
assert.equal(runPublished(null), false);

// Issue text: slot times and links only.
const text = issueText(planWatchdog([run("10:00")], at("11:20")), { retrySent: retryTitle("11:00", D), runUrl: "https://github.com/x/y/actions/runs/1" });
assert.match(text.title, /^Top Picks run missed: 2026-11-09 11:00 ET$/);
assert.match(text.body, /Sent one retry/);
assert.doesNotMatch(text.body, /optionPnl|strike|\$\d/);

// Workflow wiring.
const daily = readFileSync(new URL("../.github/workflows/daily.yml", import.meta.url), "utf8");
assert.match(daily, /^run-name: \$\{\{ inputs\.reason \|\| 'Daily build' \}\}$/m, "a retry's title must come from inputs.reason");
assert.match(daily, /\n      reason:\n        description: [^\n]+\n        required: false\n        default: ""\n        type: string\n/);
assert.match(daily, /- name: Flush verified data to private store\n        id: flush\n/);
assert.match(daily, /- name: Commit refreshed site \(legacy public data\)\n        id: legacy_commit\n/);
const step = daily.match(/- name: Top Picks watchdog[\s\S]*?run: node scripts\/top-picks-watchdog\.mjs/)?.[0];
assert.ok(step, "the Daily build ends with the watchdog");
assert.match(step, /if: \$\{\{ always\(\) \}\}/);
assert.match(step, /continue-on-error: true/);
assert.match(step, /WATCHDOG_CURRENT_RUN_ID: \$\{\{ github\.run_id \}\}/);
assert.match(step, /WATCHDOG_CURRENT_PUBLISHED: \$\{\{ steps\.flush\.outcome == 'success' \|\| steps\.legacy_commit\.outcome == 'success' \}\}/);
assert.ok(daily.indexOf("- name: Top Picks watchdog") > daily.indexOf("- name: Commit refreshed site (legacy public data)"), "watchdog runs after publication");
assert.ok(daily.indexOf("- name: Top Picks watchdog") < daily.indexOf("\n  webull-health:"), "watchdog is a build-job step");
const wd = readFileSync(new URL("../.github/workflows/top-picks-watchdog.yml", import.meta.url), "utf8");
assert.deepEqual([...wd.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]), ["10,35 15,16 * * 1-5", "38 19,20 * * 1-5"]);
assert.match(wd, /actions: write/);
assert.match(wd, /issues: write/);
assert.match(wd, /run: node scripts\/top-picks-watchdog\.mjs/);
assert.doesNotMatch(wd, /secrets\./, "the watchdog needs no secrets beyond the workflow token");
// The retry inputs the script sends must exist on daily.yml.
const script = readFileSync(new URL("./top-picks-watchdog.mjs", import.meta.url), "utf8");
for (const input of ["force", "refresh_top_picks", "refresh_swing_desks", "refresh_brief", "reason"]) {
  assert.match(script, new RegExp(`${input}: `), `retry sends ${input}`);
  assert.match(daily, new RegExp(`\\n      ${input}:\\n`), `daily.yml declares ${input}`);
}
// The cron slots land on the intended ET minutes in both offsets.
for (const [utc, offset] of [["16:10", 5], ["16:35", 5], ["20:38", 5], ["15:10", 4], ["15:35", 4], ["19:38", 4]]) {
  const [h, m] = utc.split(":").map(Number);
  const etMin = ((h - offset) * 60 + m);
  assert.ok([670, 695, 938].includes(etMin), `${utc}Z at UTC-${offset} = ${etMin}`);
}
classifySlot([], TOP_PICKS_SLOTS[0], D, at("10:00"));
console.log("top-picks watchdog smoke: ok");

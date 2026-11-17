// Learn & help audit checks (2026-11-17): the refresh schedule's holiday and
// weekly rules, Owner-only links on the public reference pages and glossary,
// the contact box's sender-hash window, and the OI tracker's ΔOI baseline
// after a market holiday. Run: node scripts/learn-help-smoke.mjs
import { readFileSync } from "node:fs";
import { refreshScheduleFactory } from "../lib/refresh-schedule.mjs";
import { closureTables } from "../lib/us-equity-calendar.mjs";
import { previousDaySnapshot } from "../lib/oi-baseline.mjs";
import { readContactDoc, addMessage, applyInboxOp, pruneRecent } from "../lib/contact-messages.mjs";
import { DOC_PAGES, DOC_THEME_OVERRIDE } from "./render/docs.mjs";
import { OWNER_PAGE_IDS } from "../lib/owner-access-policy.mjs";

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { failures++; console.error("FAIL", msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// 1. Schedule: the OI scans and the weekly GitHub cron run on holidays.
const R = refreshScheduleFactory();
const T = closureTables();
eq(R.nextLabel("oi", { dateKey: "2026-11-25", minutes: 18 * 60 }, T.holidays, T.halfDays), "tomorrow ~08:30 ET", "OI scans run on Thanksgiving");
eq(R.nextLabel("build", { dateKey: "2026-11-25", minutes: 18 * 60 }, T.holidays, T.halfDays), "Fri 10:00 ET", "full builds still skip Thanksgiving");
const goodFriday = R.nextRun("weekly", { dateKey: "2026-04-02", minutes: 12 * 60 }, T.holidays, T.halfDays);
eq(goodFriday && goodFriday.dateKey, "2026-04-03", "the weekly job runs on Good Friday (GitHub cron, no holiday check)");
ok(/GitHub/.test(R.JOBS.weekly.lateNote || ""), "the weekly job carries a late-start note");

// 2. The rendered pages say what really happens.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
ok(!/Fridays 11:30 ET/.test(app), "app.js no longer promises a Friday 11:30 ET update");
ok(/updated Friday afternoons ET/.test(app), "the weekly banner says Friday afternoons");
ok(!/after the next Friday 11:30 ET refresh/.test(html), "empty states drop the 11:30 promise");
ok(/GitHub&rsquo;s scheduler starts it late/.test(html), "the schedule card explains the late weekly start");
ok(/two open-interest scans and a Friday&rsquo;s weekly job go ahead/.test(html), "the timeline caption lists what runs on a holiday");
ok(/title="Weekly Alt Data \(Fridays\): Fri 11:30 ET \(set time; GitHub usually starts it/.test(html), "the weekly dot's tooltip carries the late note");

// 3. Public reference pages: every link to an Owner-only page is marked, and
//    the shadow-root CSS hides marked links unless the host is an Owner's.
const ownerHref = new RegExp('href="/\\?tab=(' + OWNER_PAGE_IDS.join("|") + ')"');
for (const [name, page] of Object.entries(DOC_PAGES)) {
  const tags = page.body.match(/<a\b[^>]*>/g) || [];
  for (const tag of tags) {
    if (!ownerHref.test(tag)) continue;
    const at = page.body.indexOf(tag);
    const before = page.body.slice(Math.max(0, at - 120), at);
    ok(/data-owner-link/.test(tag) || /<span data-owner-link>[^<]*$/.test(before), `${name}: Owner-only link is marked: ${tag}`);
  }
}
ok(/:host\(:not\(\.is-owner\)\) \[data-owner-link\]\{ display:none !important; \}/.test(DOC_THEME_OVERRIDE), "doc skin hides Owner links for public visitors");
ok(/h\.classList\.toggle\('is-owner', !!HAS_OWNER_ACCESS\)/.test(app) && /host\.classList\.toggle\('is-owner', !!HAS_OWNER_ACCESS\)/.test(app), "app.js marks doc hosts for an Owner");
ok(/href="\/\?tab=stock">Look up the stock and its options/.test(DOC_PAGES.cheatsheet.body), "the Options guide links the public stock page");
ok(/about 18 months on this site/.test(DOC_PAGES.cheatsheet.body) && /30-day realized volatility/.test(DOC_PAGES.cheatsheet.body), "the guide's IV note matches the site's Rich rule");

// 4. Glossary: a "See it in use" link to an Owner page is Owner-only.
const glStrat = html.match(/<a href="\/\?tab=strategies"[^>]*>See it in use<\/a>/g) || [];
ok(glStrat.length >= 2 && glStrat.every((t) => /data-owner-only/.test(t)), "glossary Strategy builder links are Owner-only");
ok(/<a href="\/\?tab=oi">See it in use<\/a>/.test(html), "glossary public links stay visible");

// 5. Privacy text matches the message box.
ok(/Last Updated: <b>November 17, 2026<\/b>/.test(DOC_PAGES.privacy.body), "privacy Last Updated date moved with the content");
ok(/once 1,000 are stored, the oldest messages already read are removed/.test(DOC_PAGES.privacy.body), "privacy states message retention");

// 6. Contact box: sender hashes older than a day are cleared on any write.
const now = Date.parse("2026-11-17T15:00:00Z");
let doc = readContactDoc(null);
doc.recent.push({ s: "old", at: now - 2 * 86400000, d: "x" }, { s: "new", at: now - 3600000, d: "y" });
doc.messages.push({ id: "mabc12345678", at: new Date(now).toISOString(), title: "t", body: "b", name: "", contacts: [], read: false });
applyInboxOp(doc, { op: "read", id: "mabc12345678" }, now);
eq(doc.recent.map((r) => r.s).join(","), "new", "an inbox change clears day-old sender hashes");
doc = pruneRecent({ recent: null }, now);
ok(Array.isArray(doc.recent) && !doc.recent.length, "pruneRecent tolerates a missing list");
doc = readContactDoc(null);
doc.recent.push({ s: "old", at: now - 2 * 86400000, d: "x" });
addMessage(doc, { title: "Hi", body: "Hello there", name: "", contacts: [] }, { sender: "me", now });
eq(doc.recent.map((r) => r.s).join(","), "me", "a new message still clears day-old sender hashes");

// 7. OI baseline: skip weekend and holiday snapshots.
const snap = (etDate, kind) => ({ etDate, kind });
const laborDay = { snapshots: [snap("2026-09-04", "pre"), snap("2026-09-04", "eod"), snap("2026-09-07", "pre"), snap("2026-09-07", "eod")] };
eq(previousDaySnapshot(laborDay, "2026-09-08")?.etDate, "2026-09-04", "the morning after Labor Day compares with Friday, not the holiday");
eq(previousDaySnapshot(laborDay, "2026-09-08")?.kind, "eod", "it takes Friday's last scan");
eq(previousDaySnapshot(laborDay, "2026-09-07")?.etDate, "2026-09-04", "a holiday scan compares with the last trading day");
const normal = { snapshots: [snap("2026-11-12", "pre"), snap("2026-11-12", "eod"), snap("2026-11-13", "pre"), snap("2026-11-13", "eod")] };
eq(previousDaySnapshot(normal, "2026-11-16")?.etDate, "2026-11-13", "Monday compares with Friday");
eq(previousDaySnapshot({ snapshots: [snap("2026-11-13", "eod"), snap("2026-11-14", "manual")] }, "2026-11-16")?.etDate, "2026-11-13", "a weekend manual scan is skipped");
eq(previousDaySnapshot({ snapshots: [snap("2026-11-26", "pre"), snap("2026-11-26", "eod")] }, "2026-11-27")?.etDate, "2026-11-26", "with only holiday scans kept it falls back to the newest earlier one");
eq(previousDaySnapshot({ snapshots: [snap("2026-11-17", "pre")] }, "2026-11-17"), null, "a cold start (only today) has no baseline");
eq(previousDaySnapshot({ snapshots: [snap("2031-01-02", "eod")] }, "2031-01-03")?.etDate, "2031-01-02", "a year outside the calendar is treated as a trading day");

// 8. The hourly flow scan ends green on an NYSE holiday (Q17, 2026-11-17):
//    a route job reads the same calendar and gates the scan job.
const flowYml = readFileSync(new URL("../.github/workflows/unusual-flow.yml", import.meta.url), "utf8");
eq(/\n  route:\n/.test(flowYml) && /\n  scan:\n    needs: route\n    if: \$\{\{ needs\.route\.outputs\.run == 'true' \}\}/.test(flowYml), true, "the flow scan waits for the holiday route");
eq(/sessionForDate/.test(flowYml) && /sparse-checkout: lib\/us-equity-calendar\.mjs/.test(flowYml), true, "the route reads the NYSE calendar");
eq(/force:/.test(flowYml) && /FORCE_RUN/.test(flowYml), true, "force=true still scans on a holiday");
eq(/\n  top-picks-watchdog:\n    needs: scan\n    if: \$\{\{ always\(\) \}\}/.test(flowYml), true, "the watchdog still runs when the scan is skipped");

console.log(`learn-help-smoke: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);

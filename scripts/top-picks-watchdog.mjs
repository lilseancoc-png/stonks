#!/usr/bin/env node
// Top Picks missed-run watchdog (GitHub side). See lib/top-picks-watchdog.mjs.
//
// Reads today's Daily build runs, decides per Top Picks slot (11:00 / 15:30
// ET) whether it published, and then:
//   - sends at most one retry per slot: a forced Daily build with the Top
//     Picks refresh on, titled "Top Picks retry <slot> ET <date>";
//   - opens one issue labeled top-picks-run when a slot is missed or failed
//     (creating an issue is what emails the repo's watchers), refreshes its
//     body on later checks, and closes it once the latest due slot publishes.
//
// Runs from top-picks-watchdog.yml (GitHub cron, best effort) and as the last
// step of every Daily build (cron-job.org dispatches those on time). Never
// fails the caller: every error is a warning and exit 0.
//
// Env: GH_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SERVER_URL,
// GITHUB_RUN_ID (all set by Actions). TOP_PICKS_WATCHDOG = on (default) |
// alert (issues only, no retry) | off. WATCHDOG_CURRENT_RUN_ID +
// WATCHDOG_CURRENT_PUBLISHED (true/false) let a Daily build report its own
// outcome before GitHub marks it complete. WATCHDOG_REF = branch to dispatch
// (default main). WATCHDOG_DRY_RUN=1 prints the plan and changes nothing
// (WATCHDOG_NOW=<ISO time> replays another moment in a dry run).
// No AI, no market data, no private store.

import { planWatchdog, issueText, runPublished, slotLine } from "../lib/top-picks-watchdog.mjs";

const LABEL = "top-picks-run";
const env = process.env;
const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repo = env.GITHUB_REPOSITORY || "";
const token = env.GH_TOKEN || env.GITHUB_TOKEN || "";
const dryRun = env.WATCHDOG_DRY_RUN === "1";
// A dry run may pin the clock (WATCHDOG_NOW=ISO) to replay a past day.
const nowMs = dryRun && env.WATCHDOG_NOW && Number.isFinite(Date.parse(env.WATCHDOG_NOW)) ? Date.parse(env.WATCHDOG_NOW) : Date.now();
const modeRaw = String(env.TOP_PICKS_WATCHDOG ?? "on").trim().toLowerCase();
const mode = /^(?:0|false|off)$/.test(modeRaw) ? "off" : modeRaw === "alert" ? "alert" : "on";
const runUrl = env.GITHUB_SERVER_URL && repo && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function main() {
  if (mode === "off") { console.log("Top Picks watchdog: off (TOP_PICKS_WATCHDOG=off)."); return; }
  if (!repo || !token) { console.log("::warning::Top Picks watchdog: no GitHub token or repository; skipped."); return; }

  const listed = await gh(`/repos/${repo}/actions/workflows/daily.yml/runs?event=workflow_dispatch&per_page=50`);
  const runs = (listed?.workflow_runs || []).map((r) => ({
    id: r.id, created_at: r.created_at, status: r.status, conclusion: r.conclusion,
    display_title: r.display_title, html_url: r.html_url, event: r.event, jobs_url: r.jobs_url, published: null,
  }));
  // The calling Daily build is still in progress as far as GitHub knows; it
  // reports its own publication.
  const currentId = Number(env.WATCHDOG_CURRENT_RUN_ID || 0);
  const currentPublished = env.WATCHDOG_CURRENT_PUBLISHED;
  for (const r of runs) {
    if (currentId && r.id === currentId && (currentPublished === "true" || currentPublished === "false")) {
      r.status = "completed";
      r.published = currentPublished === "true";
    }
  }

  // Read jobs only for completed runs that could belong to a slot today.
  const first = planWatchdog(runs, nowMs, { mode });
  const inScope = new Set(first.slots.flatMap((s) => s.primary.concat(s.retries)).map((r) => r.id));
  for (const r of runs) {
    if (!inScope.has(r.id) || r.status !== "completed" || r.published != null) continue;
    try {
      const jobs = await gh(`${new URL(r.jobs_url).pathname}?filter=latest&per_page=100`);
      r.published = runPublished(jobs?.jobs);
    } catch (err) {
      console.log(`::warning::Top Picks watchdog: could not read jobs of run ${r.id} (${err.message}); counting it as not published.`);
      r.published = false;
    }
  }
  const plan = planWatchdog(runs, nowMs, { mode });
  if (!plan.tradingDay) { console.log(`Top Picks watchdog: ${plan.date} is not a trading day; nothing to check.`); return; }
  for (const s of plan.slots) console.log(`Top Picks watchdog: ${slotLine(s)}`);

  let retrySent = null;
  if (plan.retry) {
    const ref = env.WATCHDOG_REF || "main";
    const body = { ref, inputs: { force: "true", refresh_top_picks: "true", refresh_swing_desks: "true", refresh_brief: "false", reason: plan.retry.title } };
    if (dryRun) console.log(`Top Picks watchdog (dry run): would dispatch ${JSON.stringify(body)}`);
    else {
      await gh(`/repos/${repo}/actions/workflows/daily.yml/dispatches`, { method: "POST", body: JSON.stringify(body) });
      console.log(`Top Picks watchdog: dispatched "${plan.retry.title}" on ${ref}.`);
    }
    retrySent = plan.retry.title;
    // The retry is now running for that slot.
    const s = plan.slots.find((x) => x.slot === plan.retry.slot);
    if (s) s.retries.push({ id: null, status: "queued", conclusion: null, published: null, url: null, title: plan.retry.title });
  }

  const open = await gh(`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=5`).catch(() => []);
  const existing = Array.isArray(open) ? open.find((i) => !i.pull_request) : null;
  if (plan.alert === "open") {
    const { title, body } = issueText(plan, { retrySent, runUrl });
    if (dryRun) { console.log(`Top Picks watchdog (dry run): would ${existing ? "update" : "open"} issue "${title}"\n${body}`); return; }
    if (existing) {
      await gh(`/repos/${repo}/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ title, body }) });
      console.log(`Top Picks watchdog: refreshed issue #${existing.number}.`);
    } else {
      await gh(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name: LABEL, color: "D93F0B", description: "Automated Top Picks missed-run alert (top-picks-watchdog)" }) }).catch(() => null);
      const made = await gh(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: [LABEL] }) });
      console.log(`Top Picks watchdog: opened issue #${made?.number ?? "?"}.`);
    }
  } else if (plan.alert === "close" && existing) {
    const latest = plan.slots.filter((s) => s.state === "ok").pop();
    const comment = `Recovered: the ${latest?.slot || "latest"} ET Top Picks run on ${plan.date} published${latest?.late ? " (through the retry)" : ""}.${runUrl ? ` (${runUrl})` : ""}`;
    if (dryRun) { console.log(`Top Picks watchdog (dry run): would close issue #${existing.number}: ${comment}`); return; }
    await gh(`/repos/${repo}/issues/${existing.number}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
    await gh(`/repos/${repo}/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`Top Picks watchdog: closed issue #${existing.number} (recovered).`);
  } else {
    console.log(`Top Picks watchdog: no alert change (${plan.alert}${existing ? `, issue #${existing.number} open` : ""}).`);
  }
}

main().catch((err) => {
  console.log(`::warning::Top Picks watchdog: ${String(err?.message || err).split("\n")[0]}`);
});

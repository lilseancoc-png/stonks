#!/usr/bin/env node
// Weekly stale pull request alert (GitHub side). See lib/stale-prs.mjs.
//
// Lists the repository's open pull requests, and keeps ONE issue labeled
// stale-prs: opened when at least one has had no update for STALE_PR_DAYS
// (default 7) days, refreshed while that stays true, closed when every open
// pull request is fresh again. Creating the issue is what emails the repo's
// watchers; a refresh is silent. Nothing is commented on, closed or merged.
//
// Runs from stale-prs.yml (GitHub cron, Monday morning ET) and by hand.
// Never fails the caller: every error is a warning and exit 0.
//
// Env: GH_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SERVER_URL,
// GITHUB_RUN_ID (set by Actions). STALE_PR_DAYS overrides the week.
// STALE_PRS_DRY_RUN=1 prints the plan and changes nothing.
// No AI, no market data, no private store.

import { planStalePrs, issueText, STALE_PRS_LABEL } from "../lib/stale-prs.mjs";

const env = process.env;
const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repo = env.GITHUB_REPOSITORY || "";
const token = env.GH_TOKEN || env.GITHUB_TOKEN || "";
const dryRun = env.STALE_PRS_DRY_RUN === "1";
const staleAfterDays = Number.isFinite(Number(env.STALE_PR_DAYS)) && Number(env.STALE_PR_DAYS) > 0 ? Number(env.STALE_PR_DAYS) : undefined;
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
  if (!repo || !token) { console.log("::warning::Stale PR check: no GitHub token or repository; skipped."); return; }
  const pulls = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/repos/${repo}/pulls?state=open&sort=updated&direction=asc&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || !batch.length) break;
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  const plan = planStalePrs(pulls, Date.now(), { staleAfterDays });
  console.log(`Stale PR check: ${plan.open} open, ${plan.fresh} fresh, ${plan.stale.length} stale (${plan.staleAfterDays}+ days).`);
  for (const p of plan.stale) console.log(`  #${p.number} ${p.title} (${p.ageDays} days${p.draft ? ", draft" : ""})`);

  const open = await gh(`/repos/${repo}/issues?state=open&labels=${STALE_PRS_LABEL}&per_page=5`).catch(() => []);
  const existing = Array.isArray(open) ? open.find((i) => !i.pull_request) : null;
  const { title, body } = issueText(plan, { runUrl });
  if (plan.alert === "open") {
    if (dryRun) { console.log(`Stale PR check (dry run): would ${existing ? "update" : "open"} issue "${title}"\n${body}`); return; }
    if (existing) {
      await gh(`/repos/${repo}/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ title, body }) });
      console.log(`Stale PR check: refreshed issue #${existing.number}.`);
    } else {
      await gh(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name: STALE_PRS_LABEL, color: "C5DEF5", description: "Weekly stale pull request alert (stale-prs workflow)" }) }).catch(() => null);
      const made = await gh(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: [STALE_PRS_LABEL] }) });
      console.log(`Stale PR check: opened issue #${made?.number ?? "?"}.`);
    }
  } else if (existing) {
    if (dryRun) { console.log(`Stale PR check (dry run): would close issue #${existing.number}: ${title}`); return; }
    await gh(`/repos/${repo}/issues/${existing.number}/comments`, { method: "POST", body: JSON.stringify({ body: `${body}` }) });
    await gh(`/repos/${repo}/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`Stale PR check: closed issue #${existing.number} (no stale pull requests).`);
  } else {
    console.log("Stale PR check: nothing stale and no open alert.");
  }
}

main().catch((err) => {
  console.log(`::warning::Stale PR check: ${String(err?.message || err).split("\n")[0]}`);
});

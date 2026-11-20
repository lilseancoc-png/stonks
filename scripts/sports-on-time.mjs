#!/usr/bin/env node
// Owner Sports on-time check (GitHub side). See lib/sports-on-time.mjs.
//
// GitHub's cron starts the sports workflows hours late or not at all, so the
// hourly flow scan and the Daily build (both dispatched on time by
// cron-job.org) run this: it reads the newest few runs of each sports
// workflow and dispatches only the ones whose planned run is overdue. The
// crons stay as the backup for evenings and weekends.
//
// Never fails the caller: every error is a warning and exit 0.
// Env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_API_URL, GITHUB_REPOSITORY (set by
// Actions). SPORTS_ON_TIME = on (default) | off. SPORTS_ON_TIME_REF = branch
// to dispatch (default main). SPORTS_ON_TIME_DRY_RUN=1 prints the plan and
// dispatches nothing. No AI, no market data, no sportsbook call here.

import { sportsDispatchPlan, SPORTS_ON_TIME } from "../lib/sports-on-time.mjs";

const env = process.env;
const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repo = env.GITHUB_REPOSITORY || "";
const token = env.GH_TOKEN || env.GITHUB_TOKEN || "";
const dryRun = env.SPORTS_ON_TIME_DRY_RUN === "1";
const ref = env.SPORTS_ON_TIME_REF || "main";
const off = /^(?:0|false|off)$/i.test(String(env.SPORTS_ON_TIME ?? "on").trim());

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
  if (off) { console.log("Sports on-time check: off (SPORTS_ON_TIME=off)."); return; }
  if (!repo || !token) { console.log("::warning::Sports on-time check: no GitHub token or repository; skipped."); return; }

  const runs = {};
  for (const wf of SPORTS_ON_TIME.workflows) {
    try {
      const listed = await gh(`/repos/${repo}/actions/workflows/${wf.file}/runs?per_page=5`);
      runs[wf.file] = (listed?.workflow_runs || []).map((r) => r.created_at);
    } catch (err) {
      // Unknown history: leave this workflow out rather than guess.
      console.log(`::warning::Sports on-time check: could not read ${wf.file} runs (${err.message}); skipped it.`);
      runs[wf.file] = null;
    }
  }

  const plan = sportsDispatchPlan({ nowMs: Date.now(), runs });
  for (const row of plan) {
    if (runs[row.file] === null) continue;
    if (!row.due) { console.log(`${row.file}: not due (${row.reason}).`); continue; }
    if (dryRun) { console.log(`${row.file}: due (${row.reason}); dry run, not dispatched.`); continue; }
    try {
      await gh(`/repos/${repo}/actions/workflows/${row.file}/dispatches`, { method: "POST", body: JSON.stringify({ ref }) });
      console.log(`${row.file}: dispatched (${row.reason}).`);
    } catch (err) {
      console.log(`::warning::Sports on-time check: dispatch of ${row.file} failed (${err.message}).`);
    }
  }
}

main().catch((err) => console.log(`::warning::Sports on-time check failed: ${err.message}`));

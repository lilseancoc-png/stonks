// Data-health alert (2026-11-26, stability audit): the push signal that
// source health and the engine data checks never had. Both were pull-only
// (the Update Checker page, one Owner brief line), so GDELT reading 2 of 64
// stocks for days was found by a manual audit, not by a check.
//
// After each full bake the build writes ./data-health.json (repo root,
// gitignored, never published) from source-health.json, and daily.yml's
// "Data health alert" step turns it into ONE GitHub issue labeled
// `data-health`: opened when a source or an engine feed has been bad three
// bake days running (SOURCE_REVIEW_STREAK, never on one bad build), its body
// refreshed while open, closed on the first run with nothing on the list.
// Optional Discord ping through the existing DISCORD_ALERT_WEBHOOK_URL.
//
// The repo is public, so the issue text is source names, states and day
// counts only: no ticker, no value, no detail string. Pure. No network, no AI.

import { SOURCE_REVIEW_STREAK } from "./source-health.mjs";

export const DATA_HEALTH_REPORT_FILE = "data-health.json";
export const DATA_HEALTH_LABEL = "data-health";

// Consecutive bad days, newest first, for one engine feed (days[].f[id] = 1).
function feedStreak(days, id) {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i]?.f?.[id];
    if (v !== 1) break;
    n++;
  }
  return n;
}

const cell = (s) => String(s ?? "").replace(/[|\r\n]+/g, " ").slice(0, 80);

export function buildDataHealthAlert(health, { streak = SOURCE_REVIEW_STREAK } = {}) {
  if (!health || !Array.isArray(health.sources)) return { status: "unknown", sources: [], feeds: [], md: "" };
  const days = Array.isArray(health.days) ? health.days : [];
  const sources = health.sources
    .filter((r) => r && r.state !== "ok" && Number(r.streak) >= streak)
    .map((r) => ({ id: r.id, label: r.label, provider: r.provider, state: r.state, days: Number(r.streak) }));
  const feedRows = Array.isArray(health.engineFeeds?.feeds) ? health.engineFeeds.feeds : [];
  const feeds = feedRows
    .map((f) => ({ id: f.id, label: f.label, provider: f.provider, state: f.state, days: feedStreak(days, f.id) }))
    .filter((f) => f.state === "fail" && f.days >= streak);
  const status = sources.length || feeds.length ? "alert" : "ok";
  const total = sources.length + feeds.length;
  const title = status === "alert"
    ? `Data feeds need a look: ${total} bad ${streak}+ build days running`
    : "Data feeds healthy";
  const lines = [`### Data health: **${status === "alert" ? "NEEDS A LOOK" : "OK"}**`, ""];
  if (sources.length) {
    lines.push(`Outside sources that have read not-ok for ${streak} or more build days in a row:`, "",
      "| Source | Provider | State now | Bad days in a row |", "|---|---|---|---|",
      ...sources.map((r) => `| ${cell(r.label)} | ${cell(r.provider)} | ${cell(r.state)} | ${r.days} |`), "");
  }
  if (feeds.length) {
    lines.push(`Engine data feeds that failed the automatic check ${streak} or more build days in a row:`, "",
      "| Feed | Provider | Bad days in a row |", "|---|---|---|",
      ...feeds.map((f) => `| ${cell(f.label)} | ${cell(f.provider)} | ${f.days} |`), "");
  }
  if (status === "alert") lines.push("Details are on the Owner Update Checker page (data sources table). This issue closes by itself on the first build with nothing on this list.");
  else lines.push(`Sources checked: ${health.sources.length}. Engine feeds checked: ${feedRows.length}.`);
  return { status, title, builtAtIso: health.builtAtIso || null, streak, sources, feeds, counts: { sources: health.sources.length, feeds: feedRows.length, flagged: total }, md: lines.join("\n") };
}


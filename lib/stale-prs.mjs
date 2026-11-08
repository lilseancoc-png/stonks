// Stale pull request alert: the pure half (2026-11-08).
//
// Open pull requests that nobody has touched for a week are easy to lose:
// GitHub sends no reminder, and the project usually has several branches in
// flight. scripts/stale-prs.mjs lists the repository's open pull requests
// once a week and keeps ONE issue labeled stale-prs: opened (which is what
// emails the watchers) when at least one open pull request is stale,
// refreshed while that stays true, and closed when every open pull request
// is fresh again or merged. Nothing is commented on, closed or merged.
//
// Pure: no network, no clock reads. Callers pass `nowMs`.

export const STALE_PRS_VERSION = 1;
export const STALE_PRS_LABEL = "stale-prs";
// A pull request counts as stale when its last update (push, comment, review
// or label) is older than this many days.
export const STALE_AFTER_DAYS = 7;
// Listed in the issue body, oldest first; the rest are counted only.
export const STALE_PRS_MAX_LISTED = 25;

const DAY_MS = 86400000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// One pull request as the GitHub REST API lists it (GET /repos/:r/pulls).
// Only the fields the issue needs are kept; nothing else leaves this function.
export function summarizePull(pr, nowMs) {
  if (!pr || typeof pr !== "object") return null;
  const number = num(pr.number);
  const updatedMs = Date.parse(pr.updated_at || "");
  if (number == null || !Number.isFinite(updatedMs)) return null;
  const ageDays = Math.max(0, Math.floor((nowMs - updatedMs) / DAY_MS));
  return {
    number,
    title: String(pr.title || "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 120) || `#${number}`,
    url: typeof pr.html_url === "string" && /^https:\/\/github\.com\//.test(pr.html_url) ? pr.html_url : null,
    author: typeof pr.user?.login === "string" ? pr.user.login.slice(0, 60) : null,
    draft: pr.draft === true,
    branch: typeof pr.head?.ref === "string" ? pr.head.ref.slice(0, 120) : null,
    updatedAt: new Date(updatedMs).toISOString(),
    ageDays,
  };
}

// pulls: the open pull requests as listed. Returns which are stale, the alert
// action (open | close | none) and the counts the issue body reports.
export function planStalePrs(pulls, nowMs, opts = {}) {
  const staleAfter = Number.isFinite(opts.staleAfterDays) ? opts.staleAfterDays : STALE_AFTER_DAYS;
  const all = (Array.isArray(pulls) ? pulls : []).map((p) => summarizePull(p, nowMs)).filter(Boolean);
  const stale = all.filter((p) => p.ageDays >= staleAfter).sort((a, b) => b.ageDays - a.ageDays || a.number - b.number);
  const fresh = all.length - stale.length;
  return {
    v: STALE_PRS_VERSION,
    checkedAt: new Date(nowMs).toISOString(),
    staleAfterDays: staleAfter,
    open: all.length,
    fresh,
    stale,
    drafts: stale.filter((p) => p.draft).length,
    alert: stale.length ? "open" : "close",
  };
}

export function issueText(plan, opts = {}) {
  const date = plan.checkedAt.slice(0, 10);
  const n = plan.stale.length;
  const title = n
    ? `${n} stale pull request${n === 1 ? "" : "s"} (no update in ${plan.staleAfterDays}+ days): ${date}`
    : `Open pull requests are all fresh: ${date}`;
  const lines = [
    `Weekly pull request check, ${date}. ${plan.open} open pull request${plan.open === 1 ? "" : "s"}: ${plan.fresh} updated in the last ${plan.staleAfterDays} days, ${n} stale.`,
    "",
  ];
  if (n) {
    lines.push(`Stale (oldest first, ${plan.staleAfterDays}+ days since the last push, comment or review):`, "");
    for (const p of plan.stale.slice(0, STALE_PRS_MAX_LISTED)) {
      const who = p.author ? ` by ${p.author}` : "";
      const draft = p.draft ? " (draft)" : "";
      const link = p.url ? `[#${p.number}](${p.url})` : `#${p.number}`;
      lines.push(`- ${link} ${p.title}${draft}${who}: ${p.ageDays} day${p.ageDays === 1 ? "" : "s"}, last update ${p.updatedAt.slice(0, 10)}`);
    }
    if (n > STALE_PRS_MAX_LISTED) lines.push(`- and ${n - STALE_PRS_MAX_LISTED} more`);
    lines.push("", "Rebase and merge, or close, each one. This issue refreshes weekly and closes itself when no open pull request is stale.");
  } else {
    lines.push("Nothing is waiting. This issue closes itself.");
  }
  if (opts.runUrl) lines.push("", `_Checked by ${opts.runUrl}_`);
  return { title, body: lines.join("\n") };
}

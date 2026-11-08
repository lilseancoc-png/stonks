#!/usr/bin/env node
// Offline checks for the weekly stale pull request alert (lib/stale-prs.mjs).
import assert from "node:assert/strict";
import { planStalePrs, issueText, summarizePull, STALE_AFTER_DAYS, STALE_PRS_MAX_LISTED } from "../lib/stale-prs.mjs";

const now = Date.parse("2026-11-09T13:00:00Z");
const ago = (days) => new Date(now - days * 86400000).toISOString();
const pr = (number, days, extra = {}) => ({ number, title: `Change ${number}`, html_url: `https://github.com/o/r/pull/${number}`, updated_at: ago(days), user: { login: "dev" }, head: { ref: `branch-${number}` }, draft: false, ...extra });

// Nothing open: close.
let plan = planStalePrs([], now);
assert.equal(plan.alert, "close"); assert.equal(plan.open, 0);
assert.match(issueText(plan).title, /all fresh/);

// Fresh only: close.
plan = planStalePrs([pr(1, 2), pr(2, 6.9)], now);
assert.equal(plan.alert, "close"); assert.equal(plan.fresh, 2); assert.equal(plan.stale.length, 0);

// Exactly a week is stale; ordered oldest first; drafts counted.
plan = planStalePrs([pr(3, 7), pr(4, 30, { draft: true }), pr(5, 1), { number: "bad" }, null, pr(6, 12, { title: "Tabs\tand\nnewlines  " })], now);
assert.equal(plan.alert, "open");
assert.deepEqual(plan.stale.map((p) => p.number), [4, 6, 3]);
assert.equal(plan.drafts, 1); assert.equal(plan.fresh, 1); assert.equal(plan.open, 4, "rows without a number or date are ignored");
assert.equal(plan.stale[1].title, "Tabs and newlines");
assert.equal(plan.staleAfterDays, STALE_AFTER_DAYS);
const text = issueText(plan, { runUrl: "https://github.com/o/r/actions/runs/1" });
assert.equal(text.title, "3 stale pull requests (no update in 7+ days): 2026-11-09");
assert.match(text.body, /\[#4\]\(https:\/\/github\.com\/o\/r\/pull\/4\) Change 4 \(draft\) by dev: 30 days, last update 2026-10-10/);
assert.match(text.body, /_Checked by https:\/\/github\.com\/o\/r\/actions\/runs\/1_/);
assert.ok(!/undefined|NaN/.test(text.body));

// Custom threshold and a long list.
plan = planStalePrs([pr(7, 3)], now, { staleAfterDays: 2 });
assert.equal(plan.stale.length, 1); assert.equal(plan.staleAfterDays, 2);
plan = planStalePrs(Array.from({ length: STALE_PRS_MAX_LISTED + 4 }, (_, i) => pr(100 + i, 8 + i)), now);
assert.match(issueText(plan).body, new RegExp(`and 4 more`));

// Unsafe links are dropped.
assert.equal(summarizePull({ number: 9, updated_at: ago(1), html_url: "javascript:alert(1)" }, now).url, null);
assert.equal(summarizePull({ number: 9, updated_at: "not a date" }, now), null);

console.log("stale-prs-smoke: ok");

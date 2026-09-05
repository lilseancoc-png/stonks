import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function workflow(name) {
  return readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

const weekly = workflow("search-interest.yml");

assert.match(weekly, /cron: ["']30 15 \* \* 5["']/);
assert.match(weekly, /cron: ["']30 16 \* \* 5["']/);
assert.match(weekly, /-0400\) EXPECTED_UTC_HOUR=15/);
assert.match(weekly, /-0500\) EXPECTED_UTC_HOUR=16/);
assert.match(weekly, /if \[ "\$UTC_HOUR" = "\$EXPECTED_UTC_HOUR" \]/);
assert.doesNotMatch(
  weekly,
  /UTC_DATE=\$\(date -u \+%F\)|date -d "\$UTC_DATE/,
  "weekly routing must not combine an immutable cron hour with the delayed runner's calendar date",
);

const daily = workflow("daily.yml");
assert.match(daily, /actions\/runs\/\$\{GITHUB_RUN_ID\}/);
assert.match(daily, /CREATED_AT=\$\(curl/);
assert.match(daily, /date -d "\$CREATED_AT" \+%u/);

const closeFallback = workflow("close-bake-fallback.yml");
for (const hour of [20, 21, 22]) {
  assert.match(closeFallback, new RegExp(`cron: ["']20 ${hour} \\* \\* 1-5["']`));
}
assert.match(closeFallback, /ET_MIN.*-lt 975.*ET_MIN.*-gt 1230/);
assert.match(closeFallback, /LATEST_STATUS/);
assert.match(closeFallback, /LATEST_CONCLUSION/);

// Execute the actual publication predicate embedded in the watchdog, rather
// than mirroring its logic in a test that could drift from the workflow.
const publicationCheck = closeFallback.match(/node -e '([\s\S]*?)' <<<"\$JOBS"/)?.[1];
assert.ok(publicationCheck, "watchdog must verify the latest attempt's jobs");
assert.match(closeFallback, /filter=latest&per_page=100/);
function publicationStatus(jobs) {
  const result = spawnSync(process.execPath, ["-e", publicationCheck], {
    input: JSON.stringify({ jobs }), encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  return result.status;
}
const publishStep = { name: "Flush verified data to private store", conclusion: "success" };
assert.equal(publicationStatus([
  { name: "route", conclusion: "success" },
  { name: "build", conclusion: "skipped", steps: [] },
]), 1, "a green 16:11 router-only run must not suppress recovery");
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [publishStep] }]), 0);
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [
  { name: "Commit refreshed site (legacy public data)", conclusion: "success" },
] }]), 0, "legacy publication also counts");
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [] }]), 1);
assert.equal(publicationStatus([{ name: "build", conclusion: "failure", steps: [publishStep] }]), 1);
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [{ ...publishStep, conclusion: "skipped" }] }]), 1);
assert.equal(publicationStatus([]), 1);

console.log("workflow schedule smoke: ok");

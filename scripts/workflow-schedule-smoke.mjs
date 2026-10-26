import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

assert.ok(!existsSync(new URL("../.github/workflows/overnight-preopen.yml", import.meta.url)), "the pre-open call is saved only by the 09:00 ET daily.yml run");

const daily = workflow("daily.yml");
const dailyOvernight = daily.match(/- name: Save the pre-open overnight call[\s\S]*?(?=\n      - name: Verify earnings-call schema)/)?.[0];
assert.ok(dailyOvernight, "the 09:00 transcripts job saves the pre-open overnight call");
assert.match(dailyOvernight, /continue-on-error: true/);
assert.match(dailyOvernight, /push --owner=overnight/);
assert.match(daily, /actions\/runs\/\$\{GITHUB_RUN_ID\}/);
assert.match(daily, /CREATED_AT=\$\(curl/);
assert.match(daily, /date -d "\$CREATED_AT" \+%u/);

assert.match(daily, /mode=transcripts/);
assert.match(daily, /ET_MIN.*-eq 540.*ET_MIN.*-eq 1140|ET_MIN.*-eq 1140.*ET_MIN.*-eq 540/);
assert.match(daily, /regen-transcripts\.mjs/);
assert.match(daily, /REFRESH_TRANSCRIPTS: "false"/);

const closeFallback = workflow("close-bake-fallback.yml");
for (const hour of [20, 21, 22]) {
  assert.match(closeFallback, new RegExp(`cron: ["']20 ${hour} \\* \\* 1-5["']`));
}
assert.match(closeFallback, /ET_MIN.*-lt 975.*ET_MIN.*-gt 1230/);
assert.match(closeFallback, /16:45:00/);
assert.match(closeFallback, /close_end/);
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
assert.match(closeFallback, /\[ "\$LATEST_CONCLUSION" = "success" \] \|\| \[ "\$LATEST_CONCLUSION" = "failure" \]/);
assert.equal(publicationStatus([
  { name: "build", conclusion: "success", steps: [publishStep] },
  { name: "webull-health", conclusion: "failure", steps: [] },
]), 0, "a broker failure must not duplicate an already-published research bake");
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [
  { name: "Commit refreshed site (legacy public data)", conclusion: "success" },
] }]), 0, "legacy publication also counts");
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [] }]), 1);
assert.equal(publicationStatus([{ name: "build", conclusion: "failure", steps: [publishStep] }]), 1);
assert.equal(publicationStatus([{ name: "build", conclusion: "success", steps: [{ ...publishStep, conclusion: "skipped" }] }]), 1);
assert.equal(publicationStatus([]), 1);

// Webull execution follows the actual Top Picks publication, not a wall clock
// that can run before a delayed build finishes. No independent polling cron.
const mirror = workflow("webull-mirror.yml");
assert.doesNotMatch(mirror, /schedule:|cron:/);
assert.match(mirror, /workflow_dispatch:/);
const mirrorStep = daily.match(/- name: Mirror published Top Picks to Webull paper[\s\S]*?(?=\n      - name:)/)?.[0];
assert.ok(mirrorStep);
assert.match(mirrorStep, /needs\.route\.outputs\.refresh_top_picks == 'true'/);
assert.match(mirrorStep, /WEBULL_MIRROR_FOLLOW_UPS: '2'/);
assert.match(mirrorStep, /WEBULL_MIRROR_STRICT: '1'/);
assert.match(mirrorStep, /id: webull_mirror/);
assert.match(daily, /webull_outcome: \$\{\{ steps\.webull_mirror\.outcome \}\}/);
assert.match(daily, /webull-health:[\s\S]*?needs: build[\s\S]*?always\(\) && needs\.build\.outputs\.webull_outcome == 'failure'[\s\S]*?exit 1/);
assert.ok(daily.indexOf("run: node scripts/sync-data.mjs push --owner=bake") < daily.indexOf("- name: Mirror published Top Picks"));
assert.match(daily, /ET_MIN.*-eq 660.*ET_MIN.*-eq 930/);

console.log("workflow schedule smoke: ok");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

console.log("workflow schedule smoke: ok");

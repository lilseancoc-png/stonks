// Repeatable offline Open Picks -> execution -> reporting/publication audit.
// Never loads an env file, invokes an order trigger, or runs a production bake.
import { spawnSync } from "node:child_process";
const scripts = [
  "webull-open-picks-smoke.mjs", "r2-lease-smoke.mjs", "webull-mirror-smoke.mjs", "webull-execution-smoke.mjs",
  "webull-grouped-smoke.mjs", "webull-legacy-fill-smoke.mjs", "webull-recovery-smoke.mjs", "webull-view-smoke.mjs",
  "webull-window-smoke.mjs", "picks-smoke.mjs", "top-picks-guards-smoke.mjs", "entry-policy-smoke.mjs",
  "top-picks-market-smoke.mjs", "track-record-fills-smoke.mjs", "track-record-reset-smoke.mjs",
  "yahoo-retry-smoke.mjs", "data-hydration-smoke.mjs", "private-store-smoke.mjs",
  "workflow-schedule-smoke.mjs", "party-tracker-smoke.mjs", "api-smoke.mjs",
];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(WEBULL_|R2_|BLOB_|GEMINI_|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|SESSION_SECRET|NODE_OPTIONS)/.test(key)));
const results = scripts.map(script => {
  const r = spawnSync(process.execPath, [`scripts/${script}`], {
    cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
  });
  const passed = r.status === 0;
  console.log(`${passed ? "PASS" : "FAIL"} ${script}`);
  if (!passed) console.error((r.stderr || r.stdout || r.error?.message || "check failed").slice(-8000));
  return { script, passed };
});
const freshness = spawnSync(process.execPath, ["scripts/verify-data-freshness.mjs", "--self-test"], {
  cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 90000,
});
results.push({ script: "verify-data-freshness.mjs --self-test", passed: freshness.status === 0 });
console.log(`${freshness.status === 0 ? "PASS" : "FAIL"} publication freshness`);
if (freshness.status !== 0) console.error((freshness.stderr || freshness.stdout).slice(-8000));
const failed = results.filter(r => !r.passed).length;
console.log(JSON.stringify({ readOnlyBroker: true, offline: true, checkedAtIso: new Date().toISOString(),
  passed: results.length - failed, total: results.length, failed,
  limitation: "Synthetic tests do not verify current broker holdings, provider availability, live fills, or scheduler timing." }, null, 2));
process.exitCode = failed ? 1 : 0;

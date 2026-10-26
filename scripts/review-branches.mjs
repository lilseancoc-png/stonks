// Offline regression suite for the reviewed ten-branch integration.
// No paid bake, live store operation, or workflow dispatch is performed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  [
    "scripts/ai-call-efficiency-smoke.mjs"
  ],
  [
    "scripts/ai-capex-smoke.mjs"
  ],
  [
    "scripts/ai-cost-smoke.mjs"
  ],
  [
    "scripts/ai-rejections-smoke.mjs"
  ],
  [
    "scripts/api-smoke.mjs"
  ],
  [
    "scripts/brief-smoke.mjs"
  ],
  [
    "scripts/calendar-smoke.mjs"
  ],
  [
    "scripts/capital-raises-smoke.mjs"
  ],
  [
    "scripts/central-bank-gold-smoke.mjs"
  ],
  [
    "scripts/commodities-smoke.mjs"
  ],
  [
    "scripts/context-audit-smoke.mjs"
  ],
  [
    "scripts/earnings-recovery-smoke.mjs"
  ],
  [
    "scripts/evidence-record-smoke.mjs"
  ],
  [
    "scripts/grade-contract-smoke.mjs"
  ],
  [
    "scripts/heatmap-smoke.mjs"
  ],
  [
    "scripts/leaps-expirations-smoke.mjs"
  ],
  [
    "scripts/leaps-paper-track-smoke.mjs"
  ],
  [
    "scripts/leaps-pricer-smoke.mjs"
  ],
  [
    "scripts/leaps-score-smoke.mjs"
  ],
  [
    "scripts/link-map-smoke.mjs"
  ],
  [
    "scripts/ma-tracker-smoke.mjs"
  ],
  [
    "scripts/narrative-risk-smoke.mjs"
  ],
  [
    "scripts/overnight-smoke.mjs"
  ],
  [
    "scripts/overnight-tone-smoke.mjs"
  ],
  [
    "scripts/pending-buyouts-smoke.mjs"
  ],
  [
    "scripts/picks-smoke.mjs"
  ],
  [
    "scripts/private-store-smoke.mjs"
  ],
  [
    "scripts/recovery-evidence-smoke.mjs"
  ],
  [
    "scripts/render-smoke.mjs"
  ],
  [
    "scripts/sector-rotation-smoke.mjs"
  ],
  [
    "scripts/story-detection-smoke.mjs"
  ],
  [
    "scripts/transcript-smoke.mjs"
  ],
  [
    "scripts/workflow-schedule-smoke.mjs"
  ],
  [
    "scripts/yahoo-retry-smoke.mjs"
  ],
  [
    "scripts/data-hydration-smoke.mjs"
  ],
  [
    "scripts/verify-data-freshness.mjs",
    "--self-test"
  ]
];
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !["TOKEN", "SECRET", "API_KEY", "PASSWORD", "R2_", "BLOB_"].some(part => name.includes(part))));
env.NODE_OPTIONS = "--unhandled-rejections=strict";
for (const args of commands) {
  console.log(`\nReview check: ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit", timeout: 120_000 });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `Failed: ${args.join(" ")}`);
    process.exit(result.status || 1);
  }
}
console.log(`\n${commands.length}/${commands.length} branch review commands passed.`);

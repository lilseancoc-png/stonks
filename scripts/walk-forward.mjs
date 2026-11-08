#!/usr/bin/env node
// Walk-forward replay of the grade (lib/walk-forward.mjs). Research only:
// reads the Top Picks run archive (data/picks-run-*.json) and the outcomes
// file (data/picks-outcomes.json) from a hydrated data/ folder (run
// `node scripts/sync-data.mjs pull --include-archives` first) and prints, per
// window, whether refitted pillar weights would have called direction better
// out of sample than the fixed scale. Changes nothing; no network, no AI.
//
//   node scripts/walk-forward.mjs [--horizon=r10] [--train=20] [--test=5] [--data=data] [--json]
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { joinSamples, walkForward, formatReport, DEFAULTS } from "../lib/walk-forward.mjs";
import { parseOutcomesState, PICKS_OUTCOMES_KEY } from "../lib/picks-outcomes.mjs";

const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const dataDir = resolve(process.cwd(), arg("data", process.env.DATA_DIR || "data"));
const horizon = arg("horizon", DEFAULTS.horizon);
const trainDays = Number(arg("train", DEFAULTS.trainDays)), testDays = Number(arg("test", DEFAULTS.testDays));

const files = (await readdir(dataDir).catch(() => [])).filter((f) => /^picks-run-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const dayFiles = [];
for (const f of files) { try { dayFiles.push(JSON.parse(await readFile(resolve(dataDir, f), "utf8"))); } catch { console.warn(`skipping unreadable ${f}`); } }
let outcomes = null;
try { outcomes = parseOutcomesState(await readFile(resolve(dataDir, PICKS_OUTCOMES_KEY), "utf8")); } catch { outcomes = null; }
if (!dayFiles.length || !outcomes) {
  console.log(`walk-forward: need picks-run-*.json (${files.length} found) and ${PICKS_OUTCOMES_KEY} (${outcomes ? "found" : "missing"}) in ${dataDir}. Hydrate with: node scripts/sync-data.mjs pull --include-archives`);
  process.exit(0);
}
const samples = joinSamples(dayFiles, outcomes, { horizon });
const result = walkForward(samples, { horizon, trainDays, testDays });
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else console.log(formatReport(result));

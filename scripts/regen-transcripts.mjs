#!/usr/bin/env node
// Standalone earnings-call transcript pass — discover new Motley Fool
// transcripts for the tracked universe and mint the AI briefs into
// data/earnings-calls.json + data/transcripts/<SYM>.json WITHOUT running the
// full bake (no Yahoo, no other AI passes). Respects the same knobs as the
// bake: TRANSCRIPTS_PER_BUILD, TRANSCRIPT_PROBES_PER_BUILD,
// AI_TRANSCRIPT_MODEL / AI_TRANSCRIPT_THINK / AI_TRANSCRIPT_CHARS.
//
// Needs a hydrated local data/ (node scripts/sync-data.mjs pull) so the prior
// index + earnings-history store are present, and GEMINI_API_KEY for the
// summaries (keyless = pure carry-forward, no fetches). AI spend is recorded
// against the shared data/ai-usage.json budget like every other AI caller.
import {
  loadAiUsageState,
  writeAiUsageState,
  readEarningsEventsHistory,
  readPriorEarningsCalls,
  writeEarningsCallsFiles,
} from "./build.mjs";

const builtAtIso = new Date().toISOString();
await loadAiUsageState();
const prior = await readPriorEarningsCalls();
const earningsHxStore = await readEarningsEventsHistory();
console.log(
  `earnings-calls: prior index covers ${Object.keys(prior?.calls || {}).length} names; ` +
  `${process.env.GEMINI_API_KEY ? "summarizing" : "KEYLESS — carry-forward only"}…`,
);
const info = await writeEarningsCallsFiles({ prior, earningsHxStore, builtAtIso });
await writeAiUsageState();
console.log(
  `earnings-calls: ${info.covered}/${info.universe} names covered, ${info.wrote} new ` +
  `summar${info.wrote === 1 ? "y" : "ies"}${info.keyless ? " (keyless)" : ""}, index ${(info.bytes / 1024).toFixed(1)} KB`,
);

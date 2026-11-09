// Daily AI cost ledger smoke test (lib/ai-cost-history.mjs). Offline.
// Run: node scripts/ai-cost-history-smoke.mjs
import assert from "node:assert/strict";
import { AI_COST_HISTORY_DAYS, AI_COST_HISTORY_KEY, costRowFromUsage, parseAiCostHistory, summarizeAiCost, upsertAiCostHistory } from "../lib/ai-cost-history.mjs";
import { OPTIONAL_BAKE_KEYS, UNUSUAL_SHARED_KEYS, BRIEF_SHARED_KEYS, TRANSCRIPT_SHARED_KEYS, isBakeOwnedKey } from "../lib/data-ownership.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { estimateAiBucketCost } from "./build.mjs";

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n++; };
ok("key: Owner-only, bake-owned and optional", isPremiumKey(AI_COST_HISTORY_KEY) && isBakeOwnedKey(AI_COST_HISTORY_KEY) && OPTIONAL_BAKE_KEYS.includes(AI_COST_HISTORY_KEY));
ok("key: co-owned wherever ai-usage.json is", [UNUSUAL_SHARED_KEYS, BRIEF_SHARED_KEYS, TRANSCRIPT_SHARED_KEYS].every((l) => l.includes("ai-usage.json") && l.includes(AI_COST_HISTORY_KEY)));
const usage = { dates: {
  "2026-11-05": { "gemini-3.1-flash-lite": { "ticker-judgment": { calls: 80, inputTokens: 500_000, outputTokens: 60_000, cachedTokens: 200_000, thoughtTokens: 0, mode: "inline" } },
                  "gemini-3.6-flash": { "pick-thesis": { calls: 6, inputTokens: 60_000, outputTokens: 12_000, cachedTokens: 0, thoughtTokens: 6_000, searchQueries: 6, mode: "inline" } } },
  "2026-11-06": { "gemini-3.6-flash": { "earnings-call": { calls: 3, inputTokens: 150_000, outputTokens: 20_000, cachedTokens: 0, thoughtTokens: 1_500, mode: "batch" } }, "mystery-model": { x: { calls: 1, inputTokens: 10, outputTokens: 1 } } },
  "2026-11-07": {},
} };
const row = costRowFromUsage("2026-11-05", usage.dates["2026-11-05"], estimateAiBucketCost);
const expect = estimateAiBucketCost("gemini-3.1-flash-lite", usage.dates["2026-11-05"]["gemini-3.1-flash-lite"]["ticker-judgment"]) + estimateAiBucketCost("gemini-3.6-flash", usage.dates["2026-11-05"]["gemini-3.6-flash"]["pick-thesis"]);
ok("row: totals, priced with the build's own table, split by type and model", row.calls === 86 && row.in === 560_000 && row.cached === 200_000 && Math.abs(row.usd - expect) < 1e-6 && row.types["ticker-judgment"].calls === 80 && row.models["gemini-3.6-flash"] > 0 && !row.unpriced);
const row6 = costRowFromUsage("2026-11-06", usage.dates["2026-11-06"], estimateAiBucketCost);
ok("row: batch buckets price at the batch rate, unknown models are listed as unpriced", row6.usd === Math.round(estimateAiBucketCost("gemini-3.6-flash", usage.dates["2026-11-06"]["gemini-3.6-flash"]["earnings-call"]) * 10000) / 10000 && row6.unpriced[0] === "mystery-model");
const prev = { v: 1, days: Array.from({ length: 420 }, (_, i) => ({ d: new Date(Date.UTC(2025, 8, 1 + i)).toISOString().slice(0, 10), calls: 1, usd: 0.5 })) };
const hist = upsertAiCostHistory(prev, usage, estimateAiBucketCost, { now: "2026-11-08T00:00:00.000Z" });
ok("upsert: old days kept, ledger days replaced, trimmed to the newest N", hist.days.length === AI_COST_HISTORY_DAYS && hist.days[hist.days.length - 1].d === "2026-11-07" && hist.days.find((d) => d.d === "2026-11-05").calls === 86 && hist.days.find((d) => d.d === "2026-11-07").calls === 0 && hist.days[0].d > prev.days[0].d);
ok("upsert: sorted, stamped, target kept", hist.days.every((d, i) => !i || d.d > hist.days[i - 1].d) && hist.updatedAt === "2026-11-08T00:00:00.000Z" && hist.target === 1);
const fresh = upsertAiCostHistory(null, usage, estimateAiBucketCost);
ok("upsert: a first write starts from the ledger alone", fresh.days.length === 3);
const sum = summarizeAiCost(hist, { today: "2026-11-07" });
ok("summary: 7- and 30-day averages, over-target count, active-day average", sum.last7 != null && sum.last30 != null && sum.activeAvg30 != null && sum.overTarget30 === 0 && sum.max30 >= sum.last30);
ok("parse: roundtrip and junk", parseAiCostHistory(JSON.stringify(hist)).days.length === hist.days.length && parseAiCostHistory("nope") === null && parseAiCostHistory({ days: [{ d: "bad" }, { d: "2026-01-02" }] }).days.length === 1);
console.log(`AI cost history: ${n} checks passed.`);

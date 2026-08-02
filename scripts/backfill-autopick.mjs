// One-shot helper to build the private data/auto-picks.json Owner sidecar from
// existing per-ticker files WITHOUT re-running the full Yahoo + Gemini
// pipeline. It also removes any legacy `autoPick` field from those otherwise-
// public files so exact Top-Picks contracts cannot leak through Grade.
//
// The canonical population happens in writeChainFiles() during a full
// `node scripts/build.mjs`; this script reproduces that split offline because
// regen-static.mjs never touches data/.
//
// Usage: node scripts/backfill-autopick.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");

// Reuse the picks engine + curated list + rate cache from the build module.
const build = await import("./build.mjs");
const { pickContractForPick, TICKERS, FALLBACK_RISK_FREE_RATE, readRfrHistory, writeAutoPicksFile } = build;

async function main() {
  // Use the persisted last-good ^IRX rate so greeks match what the last
  // build computed; fall back to the constant when no cache is present.
  const rfrCache = await readRfrHistory();
  const rfr = rfrCache && Number.isFinite(rfrCache.rate) ? rfrCache.rate : FALLBACK_RISK_FREE_RATE;
  console.log(`risk-free rate: ${(rfr * 100).toFixed(3)}% (${rfrCache ? "from rfr-history.json" : "fallback"})`);

  let written = 0, missing = 0, failed = 0, callNull = 0, putNull = 0;
  const ownerAutoPicks = {};
  for (const sym of TICKERS) {
    const file = resolve(DATA_DIR, `${sym}.json`);
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch (_) {
      missing++;
      continue; // no committed data for this ticker — skip
    }
    // Isolate the per-ticker build + write so one bad file or write fault
    // doesn't abort the whole run mid-pass (graceful degradation, like the
    // rest of the pipeline) — leaving some files rewritten and others not.
    try {
      const autoPick = {
        call: pickContractForPick("call", data, rfr),
        put: pickContractForPick("put", data, rfr),
      };
      ownerAutoPicks[sym] = autoPick;
      if (!autoPick.call) callNull++;
      if (!autoPick.put) putNull++;
      const { autoPick: _drop, ...rest } = data;
      await writeFile(file, JSON.stringify(rest), "utf8");
      written++;
    } catch (err) {
      failed++;
      console.warn(`  · ${sym}: autoPick backfill failed — ${String(err?.message || err)}`);
    }
  }
  const sidecar = await writeAutoPicksFile(ownerAutoPicks);
  console.log(
    `wrote private auto-picks.json for ${sidecar.count} tickers and sanitized ${written} public files` +
      (missing ? ` (${missing} tickers had no data file)` : "") +
      (failed ? ` (${failed} failed)` : "") +
      ` — ${callNull} with no qualifying call, ${putNull} with no qualifying put`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });

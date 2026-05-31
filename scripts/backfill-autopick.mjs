// One-shot helper to backfill the `autoPick` field into the existing
// committed per-ticker data/<SYM>.json files WITHOUT re-running the full
// Yahoo + Gemini pipeline. `autoPick` is the best call and best put the Top
// Picks engine would select for the name, scored with the exact same
// pickContractForPick() the picks pipeline uses (same hard filters +
// composite quality score + the five component grades). It powers the
// "★ Top-Picks grade" banner on the Grade tab.
//
// The canonical population happens in writeChainFiles() during a full
// `node scripts/build.mjs`; this script reproduces that offline so the
// already-committed data files (and a local checkout) gain the field
// without a network build, since regen-static.mjs never touches data/.
//
// Usage: node scripts/backfill-autopick.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");

// Reuse the picks engine + curated list + rate cache from the build module.
const build = await import("./build.mjs");
const { pickContractForPick, TICKERS, FALLBACK_RISK_FREE_RATE, readRfrHistory } = build;

async function main() {
  // Use the persisted last-good ^IRX rate so greeks match what the last
  // build computed; fall back to the constant when no cache is present.
  const rfrCache = await readRfrHistory();
  const rfr = rfrCache && Number.isFinite(rfrCache.rate) ? rfrCache.rate : FALLBACK_RISK_FREE_RATE;
  console.log(`risk-free rate: ${(rfr * 100).toFixed(3)}% (${rfrCache ? "from rfr-history.json" : "fallback"})`);

  let written = 0, missing = 0, callNull = 0, putNull = 0;
  for (const sym of TICKERS) {
    const file = resolve(DATA_DIR, `${sym}.json`);
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch (_) {
      missing++;
      continue; // no committed data for this ticker — skip
    }
    const autoPick = {
      call: pickContractForPick("call", data, rfr),
      put: pickContractForPick("put", data, rfr),
    };
    if (!autoPick.call) callNull++;
    if (!autoPick.put) putNull++;
    const { autoPick: _drop, ...rest } = data; // overwrite any prior field
    await writeFile(file, JSON.stringify({ ...rest, autoPick }), "utf8");
    written++;
  }
  console.log(
    `backfilled autoPick into ${written} files` +
      (missing ? ` (${missing} tickers had no data file)` : "") +
      ` — ${callNull} with no qualifying call, ${putNull} with no qualifying put`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });

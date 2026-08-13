#!/usr/bin/env node

// Weekly slow-moving Alt Data producer. Search Interest runs in the same
// workflow, while this script refreshes RAM and GPU-cloud prices from their
// public sources and preserves each dataset's existing history/last-good rows.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeAcceleratorPricesFile,
  writeRamPricesFile,
} from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");

async function readPrior(file) {
  try {
    return JSON.parse(await readFile(resolve(DATA_DIR, file), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const builtAtIso = new Date().toISOString();
  const [priorRam, priorAccelerators] = await Promise.all([
    readPrior("ram-prices.json"),
    readPrior("accelerator-prices.json"),
  ]);

  const [ram, accelerators] = await Promise.all([
    writeRamPricesFile(builtAtIso, priorRam),
    writeAcceleratorPricesFile(builtAtIso, priorAccelerators),
  ]);

  console.log(
    `wrote data/ram-prices.json - ${ram.spotItems} spot items${ram.spotStale ? " [stale]" : ""}, ` +
    `${ram.retailCats} retail categories${ram.retailStale ? " [stale]" : ""}, ${ram.bytes} bytes`,
  );
  console.log(
    `wrote data/accelerator-prices.json - ${accelerators.freshSources}/${accelerators.sources} sources fresh, ` +
    `${accelerators.models} models, ${accelerators.quotes} quotes, ${accelerators.bytes} bytes` +
    `${accelerators.staleSources.length ? ` [stale: ${accelerators.staleSources.join(",")}]` : ""}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

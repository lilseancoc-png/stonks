// sync-data.mjs — hydrate/flush the local data/ dir against the private store.
//
// Replaces "git checkout brings data/" (hydrate) and "git commit/push data/"
// (flush) under the Path B private-data migration (docs/private-data-migration.md).
// The build/scan internals are UNCHANGED — they still read/write a local data/
// dir; this tool just fills it before and drains it after.
//
// Usage:
//   node scripts/sync-data.mjs pull                 # store -> local data/   (hydrate)
//   node scripts/sync-data.mjs push --owner=bake    # local data/ -> store   (flush)
//   node scripts/sync-data.mjs push --owner=unusual
//   node scripts/sync-data.mjs push --owner=oi
//   node scripts/sync-data.mjs seed                 # one-time: upload ALL local data/
//   ...any command + --dry-run to print actions without touching the store.
//
// CONCURRENCY MODEL (docs §4.3): the three data workflows share one
// `concurrency` group so runs serialize; every run pulls latest first. Each
// producer pushes ONLY its own keyset. Scanner pushes are upsert-only (never
// delete). Only the bake delete-stales, and only within the per-ticker +
// iv-history/ prefixes (the only place keys disappear, when a ticker leaves
// the universe). This re-encodes today's Git SCANNER_FILES ownership exactly,
// so no producer can clobber another's output.
//
// Requires BLOB_READ_WRITE_TOKEN in the environment.

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../lib/datastore.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

// --- Ownership sets (mirror the workflows' git ownership) ---------------------
// Scanner-EXCLUSIVE keys: written only by scan-unusual.mjs / scan-oi.mjs. The
// bake preserves these across its wipe but must NOT push them (a concurrent
// scan may have written a fresher copy since this run pulled).
const UNUSUAL_EXCLUSIVE = [
  "unusual.json",
  "unusual-history.json",
  "unusual-log.json",
  "volume-flags.json",
  "volume-history.json",
  "flow-explanations.json",
];
const OI_EXCLUSIVE = ["oi-tracker.json", "oi-history.json"];
// Co-owned read-modify-write files (each producer pulls latest, applies its
// once-per-window update, pushes). Safe under serialized runs.
const UNUSUAL_SHARED = ["heatmap.json", "ai-usage.json"];
const OI_SHARED = ["briefs.json", "ai-usage.json"];

const SCANNER_EXCLUSIVE = new Set([...UNUSUAL_EXCLUSIVE, ...OI_EXCLUSIVE]);

// Bake delete-stales ONLY within these prefixes (dynamic per-ticker data).
const isDynamicBakeKey = (key) =>
  /^[A-Z0-9.]+\.json$/.test(key) || key.startsWith("iv-history/");

// --- small helpers ------------------------------------------------------------
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Recursively enumerate local data/ files, returning posix-relative keys.
async function localKeys() {
  if (!existsSync(DATA_DIR)) return [];
  const entries = await readdir(DATA_DIR, { recursive: true, withFileTypes: true });
  const keys = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = resolve(e.parentPath || e.path, e.name);
    const rel = abs.slice(DATA_DIR.length + 1).split(/[\\/]/).join("/");
    keys.push(rel);
  }
  return keys;
}

function parseArgs(argv) {
  const cmd = argv[0];
  const opts = { dryRun: false, owner: null };
  for (const a of argv.slice(1)) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--owner=")) opts.owner = a.slice("--owner=".length);
  }
  return { cmd, opts };
}

// --- commands -----------------------------------------------------------------
async function pull({ dryRun }) {
  const entries = await store.list("");
  console.log(`pull: ${entries.length} object(s) in store -> ${DATA_DIR}`);
  if (dryRun) {
    for (const e of entries.slice(0, 20)) console.log(`  would write ${e.key} (${e.size}b)`);
    if (entries.length > 20) console.log(`  …and ${entries.length - 20} more`);
    return;
  }
  // Fresh local dir so a ticker dropped from the store also leaves locally.
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  let bytes = 0;
  await mapLimit(entries, 8, async (e) => {
    const buf = await store.get(e.key);
    if (buf == null) return;
    const abs = resolve(DATA_DIR, e.key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    bytes += buf.length;
  });
  console.log(`pull: wrote ${entries.length} file(s), ${(bytes / 1e6).toFixed(1)} MB`);
}

async function uploadKeys(keys, { dryRun, label }) {
  const present = [];
  for (const k of keys) {
    if (existsSync(resolve(DATA_DIR, k))) present.push(k);
  }
  console.log(`${label}: uploading ${present.length} file(s)` + (dryRun ? " (dry-run)" : ""));
  if (dryRun) {
    for (const k of present.slice(0, 30)) console.log(`  would put ${k}`);
    if (present.length > 30) console.log(`  …and ${present.length - 30} more`);
    return present;
  }
  await mapLimit(present, 8, async (k) => {
    const buf = await readFile(resolve(DATA_DIR, k));
    await store.put(k, buf);
  });
  return present;
}

async function pushBake({ dryRun }) {
  const local = await localKeys();
  // Everything local except the scanner-exclusive set (which a concurrent scan owns).
  const owned = local.filter((k) => !SCANNER_EXCLUSIVE.has(k));
  const uploaded = await uploadKeys(owned, { dryRun, label: "push(bake)" });
  // Delete-stale: store keys in the dynamic per-ticker / iv-history prefixes
  // that no longer exist locally (a ticker left the universe). Never touch
  // scanner-exclusive keys.
  const localSet = new Set(local);
  const remote = await store.list("");
  const stale = remote
    .map((e) => e.key)
    .filter((k) => isDynamicBakeKey(k) && !SCANNER_EXCLUSIVE.has(k) && !localSet.has(k));
  console.log(`push(bake): ${uploaded.length} uploaded, ${stale.length} stale to delete` + (dryRun ? " (dry-run)" : ""));
  if (dryRun) {
    for (const k of stale.slice(0, 30)) console.log(`  would delete ${k}`);
    return;
  }
  await mapLimit(stale, 8, (k) => store.del(k));
}

async function pushScanner(owner, { dryRun }) {
  const keys =
    owner === "unusual"
      ? [...UNUSUAL_EXCLUSIVE, ...UNUSUAL_SHARED]
      : [...OI_EXCLUSIVE, ...OI_SHARED];
  await uploadKeys(keys, { dryRun, label: `push(${owner})` }); // upsert-only, no delete
}

async function seed({ dryRun }) {
  const local = await localKeys();
  await uploadKeys(local, { dryRun, label: "seed" }); // upload everything, no delete
  console.log(`seed: ${local.length} file(s) from ${DATA_DIR}`);
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!store.hasToken()) {
    console.error("sync-data: BLOB_READ_WRITE_TOKEN is not set");
    process.exit(1);
  }
  switch (cmd) {
    case "pull":
      await pull(opts);
      break;
    case "push":
      if (opts.owner === "bake") await pushBake(opts);
      else if (opts.owner === "unusual" || opts.owner === "oi") await pushScanner(opts.owner, opts);
      else {
        console.error("push requires --owner=bake|unusual|oi");
        process.exit(1);
      }
      break;
    case "seed":
      await seed(opts);
      break;
    default:
      console.error("usage: sync-data.mjs <pull|push --owner=…|seed> [--dry-run]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

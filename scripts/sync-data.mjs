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
//   node scripts/sync-data.mjs push --owner=brief
//   node scripts/sync-data.mjs push --owner=search-interest
//   node scripts/sync-data.mjs push --owner=daytrading
//   node scripts/sync-data.mjs seed                 # one-time: upload ALL local data/
//   node scripts/sync-data.mjs flatten              # active snapshot -> legacy roots
//   ...any command + --dry-run to print actions without touching the store.
//
// PUBLICATION MODEL (docs §4.3): workflows still serialize and each producer
// still overlays ONLY its owned keyset, but logical data is published through
// an immutable generation manifest. Changed objects + the manifest upload under
// a unique `_stonks/generations/...` prefix; one small pointer flips LAST. A
// failed upload leaves the prior complete snapshot visible. Scanner overlays
// carry the bake mappings, bake overlays carry scanner mappings, and request-
// time keys stay at their legacy root path outside every generation. Pull
// resolves the active manifest, while an absent pointer cleanly hydrates a
// pre-cutover root store. Old unreferenced objects are GC'd only after a 26h
// grace period so in-flight readers of the previous pointer remain safe.
//
// Requires a complete R2 credential set or BLOB_READ_WRITE_TOKEN.

import { readdir, readFile, writeFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../lib/datastore.mjs";
import { resolveStoreKeyPath } from "../lib/store-path.mjs";
import {
  REQUEST_TIME_EXCLUSIVE_KEYS,
  isBakeOwnedKey,
  isDynamicBakeKey as sharedIsDynamicBakeKey,
  keysForScannerOwner,
} from "../lib/data-ownership.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

// --- Ownership sets (mirror the workflows' git ownership) ---------------------
// Scanner-EXCLUSIVE keys: written only by scan-unusual.mjs / scan-oi.mjs. The
// bake preserves these across its wipe but must NOT push them (a concurrent
// scan may have written a fresher copy since this run pulled).
// Co-owned read-modify-write files (each producer pulls latest, applies its
// once-per-window update, pushes). Safe under serialized runs. The hourly run
// refreshes heatmap prices and the Market Analysis premarket cohort while the
// bake rebuilds their slower fields. manifest.json (flow sidecar) +
// manifest-free.json (free half) are regenerated
// deterministically by regen-static in EVERY workflow (they carry the bake's
// narratives from the pulled trends.json + the scanner's fresh unusual
// snapshot), so all producers push them — last-writer-wins is consistent.
// briefs.json + ai-usage.json are co-owned by the bake and the 08:30 ET
// Brief-only route. Shared workflow concurrency serializes their pull/update/
// push cycle, so the morning read cannot race an intraday bake.

// REQUEST-TIME-owned keys: written by the live api/* functions from user
// actions (api/watchlist.js), never by a workflow. NO producer may push or
// delete them — the copy `pull` hydrates locally is stale the moment a user
// clicks mid-run, so re-uploading it would silently revert their change.

// Bake delete-stales ONLY within these prefixes (dynamic per-ticker data).
// transcripts/ is the RETIRED subdirectory form of the earnings-call briefs
// (replaced by flat transcript-<SYM>.json keys, which are upsert-only and
// deliberately NOT matched here) — listing it lets the bake sweep the
// first-day orphans out of the store.
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
export async function installHydratedSnapshot(entries, {
  dataDir = DATA_DIR,
  readPhysical,
} = {}) {
  if (typeof readPhysical !== "function") throw new Error("pull: readPhysical is required");
  const planned = entries.map((entry) => {
    // Validate the complete remote keyset before creating or moving anything.
    resolveStoreKeyPath(dataDir, entry.key);
    return entry;
  });
  if (!planned.length) {
    throw new Error("pull: remote snapshot is empty; refusing to replace last-good data/");
  }
  if (!planned.some((entry) => !REQUEST_TIME_EXCLUSIVE_KEYS.has(entry.key))) {
    throw new Error("pull: remote snapshot contains only request-time state; refusing to replace last-good data/");
  }
  const parentDir = dirname(dataDir);
  await mkdir(parentDir, { recursive: true });
  const stageDir = await mkdtemp(resolve(parentDir, `.${basename(dataDir)}-pull-`));
  const backupDir = `${stageDir}-previous`;
  let installed = false;
  let movedPrevious = false;
  let bytes = 0;
  let written = 0;
  try {
    // Fetch the complete immutable snapshot before touching the live local
    // directory. A missing/corrupt store body leaves the prior hydrate intact.
    await mapLimit(planned, 8, async (entry) => {
      const buf = entry.body ?? await readPhysical(entry.physicalKey, entry);
      if (buf == null) throw new Error(`pull: listed object ${entry.key} is missing`);
      const expectedSize = Number(entry.size);
      if (Number.isFinite(expectedSize) && expectedSize >= 0 && buf.length !== expectedSize) {
        throw new Error(
          `pull: object ${entry.key} size mismatch (expected ${expectedSize}, received ${buf.length})`,
        );
      }
      const abs = resolveStoreKeyPath(stageDir, entry.key);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      bytes += buf.length;
      written++;
    });

    if (existsSync(dataDir)) {
      await rename(dataDir, backupDir);
      movedPrevious = true;
    }
    try {
      await rename(stageDir, dataDir);
      installed = true;
    } catch (installErr) {
      if (movedPrevious) {
        try {
          await rename(backupDir, dataDir);
          movedPrevious = false;
        } catch (restoreErr) {
          throw new AggregateError([installErr, restoreErr], "pull: install and rollback both failed");
        }
      }
      throw installErr;
    }
    if (movedPrevious) {
      try {
        await rm(backupDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`pull: installed snapshot but could not remove backup ${backupDir}: ${err?.message || err}`);
      }
    }
    return { written, bytes };
  } catch (err) {
    if (!installed) await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function pull({ dryRun }) {
  // Pin one publication for the whole hydrate. Calling logical list/get in a
  // loop could otherwise cross a pointer flip after the wrapper's short cache
  // expires, producing a mixed local tree even though both generations are
  // individually coherent.
  const publication = await store.getPublication({ fresh: true });
  let entries;
  if (publication) {
    const generated = Object.entries(publication.manifest.objects).map(([key, record]) => ({
      key,
      size: Number(record.size) || 0,
      uploadedAt: record.uploadedAt || publication.manifest.publishedAt || null,
      physicalKey: record.path,
    }));
    const requestTime = [];
    for (const key of REQUEST_TIME_EXCLUSIVE_KEYS) {
      const body = await store.rawGet(key);
      if (body != null) requestTime.push({ key, size: body.length, uploadedAt: null, physicalKey: key, body });
    }
    entries = [...generated, ...requestTime];
  } else {
    // Pointer absence is the explicit pre-cutover fallback. Read the same root
    // keys we listed even if another process creates the first pointer midway.
    entries = (await store.rawList(""))
      .filter((entry) => String(entry?.key || "").endsWith(".json") &&
        !String(entry?.key || "").startsWith("_stonks/"))
      .map((entry) => ({ ...entry, physicalKey: entry.key }));
  }
  console.log(`pull: ${entries.length} object(s) in store -> ${DATA_DIR}`);
  // Validate every remote key before removing the existing local directory.
  // A single poisoned object must fail closed without leaving a partial tree.
  const planned = entries.map((entry) => ({
    ...entry,
    // Resolve only to validate here; installHydratedSnapshot resolves the same
    // logical key beneath its private staging directory for the actual write.
    validatedPath: resolveStoreKeyPath(DATA_DIR, entry.key),
  }));
  if (dryRun) {
    for (const e of planned.slice(0, 20)) console.log(`  would write ${e.key} (${e.size}b)`);
    if (planned.length > 20) console.log(`  …and ${planned.length - 20} more`);
    return;
  }
  const { written, bytes } = await installHydratedSnapshot(planned, {
    dataDir: DATA_DIR,
    readPhysical: (physicalKey) => store.rawGet(physicalKey),
  });
  console.log(`pull: wrote ${written} file(s), ${(bytes / 1e6).toFixed(1)} MB`);
}

async function readKeys(keys, { dryRun, label }) {
  const present = [];
  for (const k of keys) {
    if (existsSync(resolve(DATA_DIR, k))) present.push(k);
  }
  console.log(`${label}: staging ${present.length} file(s)` + (dryRun ? " (dry-run)" : ""));
  if (dryRun) {
    for (const k of present.slice(0, 30)) console.log(`  would publish ${k}`);
    if (present.length > 30) console.log(`  …and ${present.length - 30} more`);
    return { present, updates: new Map() };
  }
  const updates = new Map();
  await mapLimit(present, 8, async (k) => {
    updates.set(k, await readFile(resolve(DATA_DIR, k)));
  });
  return { present, updates };
}

async function publish(owner, keys, { dryRun, deletes = [], label }) {
  const { present, updates } = await readKeys(keys, { dryRun, label });
  if (dryRun) return present;
  const publication = await store.publishGeneration({ owner, updates, deletes });
  console.log(
    `${label}: pointer -> ${publication.manifest.generation} ` +
    `(${present.length} changed, ${deletes.length} removed, ${Object.keys(publication.manifest.objects).length} logical total)`,
  );
  // Publication is already complete. GC is deliberately best-effort: a cleanup
  // outage must not turn a successful pointer flip into a misleading failure.
  try {
    const gc = await store.gcGenerations();
    if (gc.deleted) console.log(`${label}: GC removed ${gc.deleted}/${gc.scanned} old generation object(s)`);
  } catch (err) {
    console.warn(`${label}: generation GC deferred: ${err?.message || err}`);
  }
  return present;
}

async function pushBake({ dryRun }) {
  const local = await localKeys();
  // Everything local except the scanner-exclusive set (which a concurrent scan
  // owns) and the request-time set (which the live site owns).
  const owned = local.filter(isBakeOwnedKey);
  // Delete-stale from the NEXT logical manifest: physical old-generation
  // objects remain unreachable and age out through conservative GC.
  const localSet = new Set(local);
  const remote = await store.list("");
  const stale = remote
    .map((e) => e.key)
    .filter((k) => sharedIsDynamicBakeKey(k) && isBakeOwnedKey(k) && !localSet.has(k));
  console.log(`push(bake): ${owned.length} local, ${stale.length} stale logical key(s)` + (dryRun ? " (dry-run)" : ""));
  if (dryRun) {
    await readKeys(owned, { dryRun: true, label: "push(bake)" });
    for (const k of stale.slice(0, 30)) console.log(`  would remove mapping ${k}`);
    return;
  }
  await publish("bake", owned, { dryRun, deletes: stale, label: "push(bake)" });
}

async function pushScanner(owner, { dryRun }) {
  const keys = keysForScannerOwner(owner);
  await publish(owner, keys, { dryRun, label: `push(${owner})` }); // overlay-only, no delete
}

async function seed({ dryRun }) {
  // Exclude request-time-owned keys (picks-watchlist.json): a pulled-then-seeded
  // copy is stale the moment a user clicks, and re-uploading it would silently
  // revert their add/remove. No producer may push it — seed included.
  const local = (await localKeys()).filter((k) => !REQUEST_TIME_EXCLUSIVE_KEYS.has(k));
  if (!dryRun && !local.length) {
    throw new Error(`seed: ${DATA_DIR} has no workflow-owned JSON files; refusing to publish an empty snapshot`);
  }
  await publish("seed", local, { dryRun, label: "seed" }); // overlay everything, no delete
  console.log(`seed: ${local.length} file(s) from ${DATA_DIR}`);
}

async function flatten({ dryRun }) {
  // Rollback bridge for deploying a pre-generation datastore reader. Copy the
  // currently-published logical snapshot to legacy root names while readers
  // continue using the pointer, then remove the pointer LAST. At no point does
  // a generation-aware reader observe a partial root copy.
  const publication = await store.getPublication({ fresh: true });
  if (!publication) {
    console.log("flatten: no publication pointer; store is already in legacy-root mode");
    return;
  }
  const objects = Object.entries(publication.manifest.objects);
  const activeKeys = new Set(objects.map(([key]) => key));
  const staleRoots = (await store.rawList(""))
    .map((entry) => entry?.key)
    .filter((key) => key?.endsWith(".json") && !key.startsWith("_stonks/") &&
      !REQUEST_TIME_EXCLUSIVE_KEYS.has(key) && !activeKeys.has(key));
  // Resolve solely for validation: refuse to mutate an unsafe raw pathname.
  for (const key of staleRoots) resolveStoreKeyPath(DATA_DIR, key);
  console.log(
    `flatten: ${objects.length} object(s) from generation ${publication.manifest.generation} -> legacy roots; ` +
    `${staleRoots.length} stale root(s) to remove` +
    (dryRun ? " (dry-run)" : ""),
  );
  if (dryRun) {
    for (const [key] of objects.slice(0, 30)) console.log(`  would write root ${key}`);
    if (objects.length > 30) console.log(`  …and ${objects.length - 30} more`);
    for (const key of staleRoots.slice(0, 30)) console.log(`  would delete stale root ${key}`);
    console.log("  would delete _stonks/published.json last");
    return;
  }
  await mapLimit(objects, 8, async ([key, record]) => {
    const buf = await store.rawGet(record.path);
    if (buf == null) throw new Error(`flatten: published object ${key} is missing`);
    await store.rawPut(key, buf);
  });
  await mapLimit(staleRoots, 8, (key) => store.rawDel(key));
  await store.rawDel("_stonks/published.json");
  console.log("flatten: legacy roots are current; publication pointer removed");
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!store.hasToken()) {
    console.error(
      "sync-data: no private store configured (set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET for Cloudflare R2, or BLOB_READ_WRITE_TOKEN for Vercel Blob)",
    );
    process.exit(1);
  }
  switch (cmd) {
    case "pull":
      await pull(opts);
      break;
    case "push":
      if (opts.owner === "bake") await pushBake(opts);
      else if (opts.owner === "unusual" || opts.owner === "oi" || opts.owner === "search-interest" || opts.owner === "daytrading") await pushScanner(opts.owner, opts);
      else {
        console.error("push requires --owner=bake|unusual|oi|search-interest|daytrading");
        process.exit(1);
      }
      break;
    case "seed":
      await seed(opts);
      break;
    case "flatten":
      await flatten(opts);
      break;
    default:
      console.error("usage: sync-data.mjs <pull|push --owner=…|seed|flatten> [--dry-run]");
      process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// sync-data.mjs — hydrate/flush the local data/ dir against the private store.
//
// Replaces "git checkout brings data/" (hydrate) and "git commit/push data/"
// (flush) under the Path B private-data migration (docs/private-data-migration.md).
// The build/scan internals are UNCHANGED — they still read/write a local data/
// dir; this tool just fills it before and drains it after.
//
// Usage:
//   node scripts/sync-data.mjs pull --owner=bake    # rolling history + current data
//   node scripts/sync-data.mjs pull --owner=unusual # current data, no dated records
//   node scripts/sync-data.mjs pull --include-archives # full history for backtests
//   node scripts/sync-data.mjs push --owner=bake    # local data/ -> store   (flush)
//   node scripts/sync-data.mjs push --owner=unusual
//   node scripts/sync-data.mjs push --owner=oi
//   node scripts/sync-data.mjs push --owner=brief
//   node scripts/sync-data.mjs push --owner=transcripts
//   node scripts/sync-data.mjs push --owner=search-interest
//   node scripts/sync-data.mjs push --owner=overnight   # pre-open overnight call
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

import { readdir, readFile, writeFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../lib/datastore.mjs";
import { resolveStoreKeyPath } from "../lib/store-path.mjs";
import { hydrationPolicy } from "../lib/data-hydration.mjs";
import {
  AI_REJECTION_SCORECARD_KEY,
  REQUEST_TIME_EXCLUSIVE_KEYS,
  SCANNER_OWNERS,
  isAiRejectionKey,
  bakeKeysToPublish,
  isBakeOwnedKey,
  isDynamicBakeKey as sharedIsDynamicBakeKey,
  isEvidenceRecordKey,
  isUnifiedSignalKey,
  isLocalOnlyKey,
  isRetainedRemoteBakeKey,
  isSeedableKey,
  keysForScannerOwner,
} from "../lib/data-ownership.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";

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
// Brief-only route. earnings-calls.json + ai-usage.json are co-owned by the
// bake (carry-forward rewrite) and the 09:00 / 19:00 ET transcript jobs.
// Shared workflow concurrency serializes their pull/update/push cycle.

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
  const opts = { dryRun: false, owner: null, includeArchives: false };
  for (const a of argv.slice(1)) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--include-archives") opts.includeArchives = true;
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

export async function pull({ dryRun = false, owner = "bake", includeArchives = false, bakeDate,
  dataDir = DATA_DIR, storeClient = store } = {}) {
  const shouldHydrate = hydrationPolicy({ owner, includeArchives, bakeDate });
  // Pin one publication for the whole hydrate. Calling logical list/get in a
  // loop could otherwise cross a pointer flip after the wrapper's short cache
  // expires, producing a mixed local tree even though both generations are
  // individually coherent.
  const publication = await storeClient.getPublication({ fresh: true });
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
      const body = await storeClient.rawGet(key);
      if (body != null) requestTime.push({ key, size: body.length, uploadedAt: null, physicalKey: key, body });
    }
    entries = [...generated, ...requestTime];
  } else {
    // Pointer absence is the explicit pre-cutover fallback. Read the same root
    // keys we listed even if another process creates the first pointer midway.
    entries = (await storeClient.rawList(""))
      .filter((entry) => String(entry?.key || "").endsWith(".json") &&
        !String(entry?.key || "").startsWith("_stonks/"))
      .map((entry) => ({ ...entry, physicalKey: entry.key }));
  }
  console.log(`pull: ${entries.length} object(s) in store -> ${dataDir}`);
  // Validate every remote key before removing the existing local directory.
  // A single poisoned object must fail closed without leaving a partial tree.
  const planned = entries.map((entry) => ({
    ...entry,
    // Resolve only to validate here; installHydratedSnapshot resolves the same
    // logical key beneath its private staging directory for the actual write.
    validatedPath: resolveStoreKeyPath(dataDir, entry.key),
  })).filter(entry => shouldHydrate(entry.key));
  console.log(`pull: hydrating ${planned.length}/${entries.length} objects (${includeArchives ? "full archives" : owner || "bake"})`);
  if (dryRun) {
    for (const e of planned.slice(0, 20)) console.log(`  would write ${e.key} (${e.size}b)`);
    if (planned.length > 20) console.log(`  …and ${planned.length - 20} more`);
    return;
  }
  const { written, bytes } = await installHydratedSnapshot(planned, {
    dataDir,
    readPhysical: (physicalKey) => storeClient.rawGet(physicalKey),
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

async function readUploadHoldback() {
  try {
    const parsed = JSON.parse(await readFile(resolve(ROOT, "upload-holdback.json"), "utf8"));
    return Array.isArray(parsed?.keys) ? parsed.keys.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

async function pushBake({ dryRun }) {
  const local = await localKeys();
  // Everything local except producer-exclusive or retired-private keys, the
  // request-time set, and files the freshness check held back. Held-back
  // files stay in `local`, so delete-stale does not remove a prior copy.
  const held = await readUploadHoldback();
  const owned = bakeKeysToPublish(local, held);
  if (held.length) console.log(`push(bake): holding back ${held.length} unclassified key(s)`);
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

async function transcriptOverlayKeys() {
  const keys = [...keysForScannerOwner("transcripts")];
  const local = await localKeys();
  const runStartedMs = Date.parse(process.env.FRESHNESS_RUN_STARTED_AT || "");
  const slopMs = 60_000;
  for (const key of local.filter(isRetainedRemoteBakeKey)) {
    if (!Number.isFinite(runStartedMs)) {
      keys.push(key);
      continue;
    }
    try {
      const st = await stat(resolve(DATA_DIR, key));
      if (st.mtimeMs >= runStartedMs - slopMs) keys.push(key);
    } catch { /* pulled then deleted; skip */ }
  }
  return [...new Set(keys)];
}

async function pushScanner(owner, { dryRun }) {
  const keys = owner === "transcripts"
    ? await transcriptOverlayKeys()
    : keysForScannerOwner(owner);
  await publish(owner, keys, { dryRun, label: `push(${owner})` }); // overlay-only, no delete
}

// Publishable evidence and AI-rejection keys seed must keep Owner-only.
// A sample date proves the dated matchers, not that this file is on disk.
const SEED_PUBLISHABLE_OWNER_SAMPLES = Object.freeze([
  "unified-signal.json",
  "signal-decisions/2026-01-02T16-00-00-000Z-0123456789abcdef.json",
  "evidence-latest.json",
  "evidence/2026-01-02.json",
  "ai-rejections-latest.json",
  "ai-rejections/2026-01-02.json",
]);

// Fail closed before seed uploads. A publishable evidence or AI-rejection key
// that the matchers do not recognize is missing; one isPremiumKey would serve
// on the public cache is a public copy. The scorecard must stay local-only
// and Owner-only. isPremium defaults to the live policy; tests pass a stand-in.
export function assertSeedOwnerKeys(localKeys, isPremium = isPremiumKey) {
  if (!Array.isArray(localKeys)) throw new Error("seed: owner-key check requires the local key list");
  const problems = [];
  for (const key of SEED_PUBLISHABLE_OWNER_SAMPLES) {
    const recognized = isEvidenceRecordKey(key) || isAiRejectionKey(key) || isUnifiedSignalKey(key);
    if (!recognized) problems.push(`missing owner classification for ${key}`);
    else if (!isPremium(key)) problems.push(`public copy of ${key}`);
    else if (!isSeedableKey(key) || isLocalOnlyKey(key)) problems.push(`missing seedable owner copy of ${key}`);
  }
  const scorecardLocalOnly = isLocalOnlyKey(AI_REJECTION_SCORECARD_KEY)
    && !isSeedableKey(AI_REJECTION_SCORECARD_KEY)
    && !isBakeOwnedKey(AI_REJECTION_SCORECARD_KEY);
  if (!scorecardLocalOnly) {
    problems.push(`missing local-only classification for ${AI_REJECTION_SCORECARD_KEY}`);
  } else if (!isPremium(AI_REJECTION_SCORECARD_KEY)) {
    problems.push(`public copy of ${AI_REJECTION_SCORECARD_KEY}`);
  }
  for (const key of localKeys) {
    if (typeof key !== "string") continue;
    if (isLocalOnlyKey(key)) {
      if (isSeedableKey(key) || isBakeOwnedKey(key)) problems.push(`local-only ${key} would be published`);
      continue;
    }
    if (!(isEvidenceRecordKey(key) || isAiRejectionKey(key) || isUnifiedSignalKey(key))) continue;
    if (!isPremium(key)) problems.push(`public copy of ${key}`);
    else if (!isSeedableKey(key)) problems.push(`missing seedable owner copy of ${key}`);
  }
  if (problems.length) throw new Error(`seed: owner-key check failed: ${problems.join("; ")}`);
}

async function seed({ dryRun }) {
  // Exclude request-time-owned keys (picks-watchlist.json): a pulled-then-seeded
  // copy is stale the moment a user clicks, and re-uploading it would silently
  // revert their add/remove. No producer may push it — seed included.
  // Same exclusions as push: request-time state and runner-local keys.
  // Owner-key check runs on the full local list, before those exclusions.
  const found = await localKeys();
  assertSeedOwnerKeys(found);
  const local = found.filter(isSeedableKey);
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
      else if (SCANNER_OWNERS.includes(opts.owner)) await pushScanner(opts.owner, opts);
      else {
        console.error(`push requires --owner=bake|${SCANNER_OWNERS.join("|")}`);
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

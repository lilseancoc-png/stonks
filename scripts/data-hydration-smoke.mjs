// Exercise the actual pull boundary against pinned and legacy fake stores.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { hydrationDate, hydrationPolicy } from "../lib/data-hydration.mjs";
import { pull } from "./sync-data.mjs";
import { REQUEST_TIME_EXCLUSIVE_KEYS } from "../lib/data-ownership.mjs";

const today = "2026-10-13";
const ago = days => new Date(Date.parse(today + "T00:00:00Z") - days * 86400000).toISOString().slice(0, 10);
assert.equal(hydrationDate(new Date("2026-10-14T01:00:00Z")), today, "use the same Eastern date as the producers");
assert.throws(() => hydrationPolicy({ owner: "typo" }), /unknown hydration owner/);
assert.throws(() => hydrationPolicy({ bakeDate: "2026-02-30" }), /invalid hydration date/);
const policy = hydrationPolicy({ bakeDate: today });
assert.equal(policy(`evidence/${ago(59)}.json`), true);
assert.equal(policy(`evidence/${ago(60)}.json`), false);
assert.equal(policy(`ai-rejections/${ago(60)}.json`), true);
assert.equal(policy(`ai-rejections/${ago(61)}.json`), false);
assert.equal(policy("evidence/2026-10-14.json"), false);
assert.equal(policy("ai-rejections/2026-10-14.json"), false);

const root = await mkdtemp(resolve(tmpdir(), "stonks-hydration-"));
const objects = new Map([["picks.json", Buffer.from('{}')], ["ai-rejection-scorecard.json", Buffer.from('{}')],
  ["evidence-latest.json", Buffer.from('{}')], ["ai-rejections-latest.json", Buffer.from('{}')]]);
for (let day = 0; day < 1000; day++) for (const prefix of ["evidence", "ai-rejections"]) objects.set(`${prefix}/${ago(day)}.json`, Buffer.from('{}'));
const reads = [];
let pinned = true;
const client = {
  async getPublication() { return pinned ? { manifest: { objects: Object.fromEntries([...objects].map(([key, body]) => [key, { path: key, size: body.length }])) } } : null; },
  async rawList() { return [...objects].map(([key, body]) => ({ key, size: body.length })); },
  async rawGet(key) { reads.push(key); return objects.get(key) ?? null; },
};
const initialSize = objects.size;
try {
  for (const legacy of [false, true]) {
    pinned = !legacy;
    for (const owner of ["bake", "unusual", "oi", "brief", "transcripts", "search-interest", "overnight"]) {
      reads.length = 0;
      const dataDir = resolve(root, (legacy ? "legacy-" : "pinned-") + owner);
      await pull({ storeClient: client, dataDir, owner, bakeDate: today });
      const files = await readdir(dataDir, { recursive: true });
      const archiveReads = reads.filter(key => /^(evidence|ai-rejections)\//.test(key));
      assert.equal(archiveReads.length, owner === "bake" ? 121 : 0);
      assert.ok(files.includes("picks.json"));
      assert.ok(files.includes("evidence-latest.json"));
      assert.ok(files.includes("ai-rejections-latest.json"));
      assert.ok(!files.includes("ai-rejection-scorecard.json"));
    }
  }
  reads.length = 0;
  await pull({ storeClient: client, dataDir: resolve(root, "backtest"), includeArchives: true, bakeDate: today });
  assert.equal(reads.filter(key => /^(evidence|ai-rejections)\//.test(key)).length, 2000);
  assert.ok(!reads.includes("ai-rejection-scorecard.json"));
  assert.equal(objects.size, initialSize, "filtering hydration never deletes retained remote history");

  // Even a key that policy would skip must pass path validation first.
  const dataDir = resolve(root, "protected");
  await mkdir(dataDir); await writeFile(resolve(dataDir, "last-good.json"), '{}');
  objects.set("evidence/../../escape.json", Buffer.from('{}'));
  for (const publication of [false, true]) {
    pinned = publication; reads.length = 0;
    await assert.rejects(pull({ storeClient: client, dataDir, owner: "unusual", bakeDate: today }), /unsafe|escapes/);
    assert.equal(reads.filter(key => !REQUEST_TIME_EXCLUSIVE_KEYS.has(key)).length, 0, "poisoned snapshot must stop before generated downloads");
    assert.equal(await readFile(resolve(dataDir, "last-good.json"), "utf8"), '{}');
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log("data-hydration smoke passed: rolling bake, six scanner owners, full backtest, legacy/pinned, fail-closed paths");

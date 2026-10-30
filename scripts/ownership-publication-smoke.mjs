// Exercise the real full-bake freshness boundary and its upload allowlist.
// Synthetic files only; no store reads, publication, or external requests.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { auditFreshness, BAKE_REQUIRED_REWRITTEN_FILES } from './verify-data-freshness.mjs';
import { bakeKeysToPublish, isDynamicBakeKey, ownershipPartReferences, isOwnershipBookKey } from '../lib/data-ownership.mjs';
import { packOwnershipBooks, ownershipBookClientFactory } from '../lib/ownership-books.mjs';
import { ownershipFixture } from './fixtures/ownership.mjs';

const dir = await mkdtemp(resolve(tmpdir(), 'stonks-ownership-publication-'));
const start = '2026-10-29T16:00:00.000Z', stamp = '2026-10-29T16:02:00.000Z', now = new Date('2026-10-29T16:05:00.000Z');
const write = async (key, value) => {
  const path = resolve(dir, key); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
};
const audit = () => auditFreshness({ owner: 'bake', dataDir: dir, runStartedAt: start, now, expectedSymbols: [] });
const ownErrors = report => report.errors.filter(message => /13f|ownership/.test(message));
try {
  for (const key of BAKE_REQUIRED_REWRITTEN_FILES) await write(key, { builtAtIso: stamp, refreshedAtIso: stamp });
  await write('grades.json', { builtAtIso: stamp, grades: {} });
  for (const key of ['manifest.json', 'manifest-free.json']) await write(key, { _meta: { dataBuiltAtIso: stamp, renderedAtIso: stamp } });
  await write('macro.json', { asOf: stamp, twoY: { value: 4 }, tenY: { value: 4 }, dxy: { value: 100 } });
  const fixture = ownershipFixture(), fund = fixture.data.perFirm['Atlas Capital'];
  const root = { ...fixture.data, builtAtIso: stamp, perFirm: { 'Atlas Capital': fund } };
  const packed = packOwnershipBooks(root, 6000);
  for (const [key, body] of packed.parts) await write(key, body);
  await write('13f.json', packed.payload);
  let report = await audit();
  assert.deepEqual(report.errors, [], 'complete ownership files pass the real bake verifier');
  assert(packed.parts.size > 1);
  const published = new Set(bakeKeysToPublish(['13f.json', ...packed.parts.keys()], report.heldBack));
  for (const key of packed.parts.keys()) {
    assert(!report.heldBack.includes(key)); assert(published.has(key), 'root and every referenced part publish together');
    assert(isDynamicBakeKey(key)); assert(isOwnershipBookKey(key));
  }
  const hydrated = await ownershipBookClientFactory(async key => JSON.parse(packed.parts.get(key))).hydrate(packed.payload);
  assert.deepEqual(new Set(ownershipPartReferences(hydrated, now)), new Set(packed.parts.keys()));

  const sourceKey = [...packed.parts.keys()].find(key => key.includes('/disclosures-'));
  const original = packed.parts.get(sourceKey);
  await rm(resolve(dir, sourceKey));
  report = await audit(); assert(ownErrors(report).some(message => message.includes(sourceKey)), 'a missing source part blocks publication');
  await write(sourceKey, original + ' ');
  report = await audit(); assert(ownErrors(report).some(message => message.includes('immutable name')), 'mutated content cannot keep an old hash name');
  await write(sourceKey, original);

  // A summary may be well formed and correctly hashed yet contain a dangling
  // source reference. The root graph must reject that case too.
  const summaryKey = packed.payload.perFirm['Atlas Capital'].holdingsParts[0];
  const altered = JSON.parse(packed.parts.get(summaryKey));
  altered.rows[0].disclosurePart = '13f-books/disclosures-' + '0'.repeat(24) + '.json';
  const alteredBody = JSON.stringify(altered), alteredKey = '13f-books/summary-' + createHash('sha256').update(alteredBody).digest('hex').slice(0,24) + '.json';
  const dangling = structuredClone(packed.payload);
  dangling.perFirm['Atlas Capital'].holdingsParts[0] = alteredKey;
  await write(alteredKey, alteredBody); await write('13f.json', dangling);
  report = await audit(); assert(ownErrors(report).length > 0, 'a dangling reference cannot publish with an otherwise valid root');
  await rm(resolve(dir, alteredKey)); await write('13f.json', packed.payload);

  // Simulate an older immutable source file retained for existing browsers.
  const oldBody = JSON.stringify({ version: 1, rows: [{ disclosures: [], priorDisclosures: [] }] });
  const oldKey = '13f-books/disclosures-' + createHash('sha256').update(oldBody).digest('hex').slice(0,24) + '.json';
  const retainedRoot = { ...packed.payload, ownershipRetainedParts: [{ key: oldKey, expiresAtIso: new Date(now.getTime() + 24 * 3600000).toISOString() }] };
  await write(oldKey, oldBody); await write('13f.json', retainedRoot);
  report = await audit(); assert.deepEqual(ownErrors(report), [], 'unexpired grace parts remain published for in-flight readers');
  assert(bakeKeysToPublish([oldKey], report.heldBack).includes(oldKey));
  assert(ownershipPartReferences(retainedRoot, now).includes(oldKey));
  const expiredRoot = { ...packed.payload, ownershipRetainedParts: [{ key: oldKey, expiresAtIso: new Date(now.getTime() - 1000).toISOString() }] };
  await write('13f.json', expiredRoot); report = await audit();
  assert(ownErrors(report).some(message => message.includes('expired')), 'expired parts cannot be silently kept forever');
  assert(!ownershipPartReferences(expiredRoot, now).includes(oldKey));
  const tooLong = { ...packed.payload, ownershipRetainedParts: [{ key: oldKey, expiresAtIso: new Date(now.getTime() + 27 * 3600000).toISOString() }] };
  await write('13f.json', tooLong); report = await audit();
  assert(ownErrors(report).some(message => message.includes('unbounded')), 'retention cannot exceed the 26h validation cap');
  await rm(resolve(dir, oldKey)); await write('13f.json', packed.payload);
  report = await audit(); assert.deepEqual(report.errors, []);
  const localKeys = new Set(['13f.json', ...packed.parts.keys()]);
  const stale = [oldKey, ...packed.parts.keys()].filter(key => isDynamicBakeKey(key) && !localKeys.has(key));
  assert.deepEqual(stale, [oldKey], 'normal bake deletion removes expired logical keys and leaves current files intact');
  assert.equal(await readFile(resolve(dir, sourceKey), 'utf8'), original);
  console.log('Ownership publication checks passed: real bake freshness, complete upload graph, immutable hashes, missing files, reader grace, and bounded stale-key deletion.');
} finally { await rm(dir, { recursive: true, force: true }); }

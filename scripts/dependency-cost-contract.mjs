// Keep the cost guard strict, with an exception for these reviewed security
// patches. A compatible version number alone does not establish unchanged cost.
import assert from 'node:assert/strict';

const REVIEWED = {
  'node_modules/undici': { from: '6.28.0', to: '6.29.1' },
  'node_modules/zod': { from: '4.1.11', to: '4.6.7' },
};

export function checkDependencyRefresh(beforePackage, afterPackage, beforeLock, afterLock) {
  const expectedPackage = structuredClone(beforePackage);
  if (JSON.stringify(beforePackage.overrides) !== JSON.stringify(afterPackage.overrides)) {
    assert.equal(beforeLock.packages['node_modules/zod']?.version, REVIEWED['node_modules/zod'].from, 'Only the reviewed Zod override is allowed');
    assert.equal(afterLock.packages['node_modules/zod']?.version, REVIEWED['node_modules/zod'].to, 'The override must install the reviewed Zod patch');
    expectedPackage.overrides = { ...beforePackage.overrides, '@vercel/cli-config': { ...beforePackage.overrides?.['@vercel/cli-config'], zod: '4.6.7' } };
  }
  assert.deepEqual(afterPackage, expectedPackage, 'Dependency refresh must preserve configuration except the exact reviewed Zod override');
  assert.equal(afterLock.lockfileVersion, beforeLock.lockfileVersion);
  assert.deepEqual(Object.keys(afterLock.packages).sort(), Object.keys(beforeLock.packages).sort(), 'Dependency refresh must not add or remove packages');
  assert.deepEqual(afterLock.packages[''], beforeLock.packages[''], 'Dependency refresh must preserve root dependency ranges');
  const updates = [];
  for (const [path, after] of Object.entries(afterLock.packages)) {
    if (!path) continue;
    const before = beforeLock.packages[path];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const approved = REVIEWED[path];
    assert(approved && before.version === approved.from && after.version === approved.to, path + ': unreviewed dependency change');
    const metadata = ({ version, resolved, integrity, ...rest }) => rest;
    assert.deepEqual(metadata(after), metadata(before), path + ': dependency metadata must stay unchanged');
    const name = path.slice('node_modules/'.length);
    assert.equal(after.resolved, `https://registry.npmjs.org/${name}/-/${name}-${approved.to}.tgz`, path + ': unexpected package download');
    assert.match(after.integrity || '', /^sha512-[A-Za-z0-9+/]+={0,2}$/, path + ': integrity hash required');
    updates.push({ path, from: before.version, to: after.version });
  }
  return updates;
}

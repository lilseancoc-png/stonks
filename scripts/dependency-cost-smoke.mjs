import assert from 'node:assert/strict';
import { checkDependencyRefresh } from './dependency-cost-contract.mjs';

const pkg = { name: 'fixture', dependencies: { '@vercel/blob': '^2.6.1' } };
const lock = { lockfileVersion: 3, packages: { '': { dependencies: pkg.dependencies },
  'node_modules/undici': { version: '6.28.0', resolved: 'https://registry.npmjs.org/undici/-/undici-6.28.0.tgz', integrity: 'sha512-YWJj' },
  'node_modules/zod': { version: '4.1.11', resolved: 'https://registry.npmjs.org/zod/-/zod-4.1.11.tgz', integrity: 'sha512-YWJj' } } };
const next = structuredClone(lock);
next.packages['node_modules/undici'] = { version: '6.29.1', resolved: 'https://registry.npmjs.org/undici/-/undici-6.29.1.tgz', integrity: 'sha512-ZGVm' };
next.packages['node_modules/zod'] = { version: '4.6.7', resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.7.tgz', integrity: 'sha512-ZGVm' };
const patched = { ...pkg, overrides: { '@vercel/cli-config': { zod: '4.6.7' } } };
assert.equal(checkDependencyRefresh(pkg, patched, lock, next).length, 2);
assert.deepEqual(checkDependencyRefresh(pkg, pkg, lock, lock), []);
for (const overrides of [{ sample: 'https://untrusted.test/replacement.tgz' }, { '@vercel/cli-config': { zod: '^4.6.7' } }, { '@vercel/cli-config': { zod: '4.6.7', other: '1.0.0' } }]) {
  assert.throws(() => checkDependencyRefresh(pkg, { ...pkg, overrides }, lock, next), /configuration|override/);
}
assert.throws(() => checkDependencyRefresh(pkg, { ...patched, dependencies: { '@vercel/blob': '^3.0.0' } }, lock, next), /configuration/);
for (const [key, value] of [['version', '6.29.2'], ['version', '7.0.0'], ['version', '6.27.0'], ['resolved', 'https://untrusted.test/undici.tgz'], ['hasInstallScript', true], ['bin', { sample: 'run.js' }], ['dependencies', { 'new-provider': '1.0.0' }], ['integrity', '']]) {
  const bad = structuredClone(next); bad.packages['node_modules/undici'][key] = value;
  assert.throws(() => checkDependencyRefresh(pkg, patched, lock, bad), key);
}
const extra = structuredClone(next); extra.packages['node_modules/new-provider'] = { version: '1.0.0' };
assert.throws(() => checkDependencyRefresh(pkg, patched, lock, extra), /add or remove/);
assert.throws(() => checkDependencyRefresh(pkg, { ...pkg, overrides: { sample: 'https://untrusted.test/replacement.tgz' } }, lock, lock), /override/);
console.log('Dependency cost contract passed: only the two reviewed patches and exact override, with all other dependency configuration unchanged.');

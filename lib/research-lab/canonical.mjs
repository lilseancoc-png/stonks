import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const environmentDigest = () => sha({ versions: process.versions, platform: process.platform, arch: process.arch });
export function numericEquivalent(a, b, tolerance = 1e-12) {
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(tolerance, tolerance * Math.max(Math.abs(a), Math.abs(b)));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && numericEquivalent(a[k], b[k], tolerance));
}
let digest;
export async function codeDigest() {
  if (!digest) digest = Promise.all(['canonical.mjs', 'contracts.mjs', 'compiler.mjs', 'engine.mjs', 'statistics.mjs', 'adapters.mjs', 'worker.mjs', 'service.mjs', 'repository.mjs', '../streaks.mjs', '../streak-ma-context.mjs']
    .map(async path => [path, sha(await readFile(new URL(path, import.meta.url)))])).then(sha);
  return digest;
}

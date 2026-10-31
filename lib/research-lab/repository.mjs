import { randomUUID } from 'node:crypto';
import { contracts } from './contracts.mjs';
import { canonical, sha } from './canonical.mjs';

export const opaqueId = prefix => prefix + '_' + randomUUID().replaceAll('-', '');
export const validId = value => typeof value === 'string' && /^[a-z]+_[a-z0-9]{12,64}$/.test(value);
export function createLabRepository({ store, owner, clock = () => new Date().toISOString() }) {
  if (typeof owner !== 'string' || !owner || owner.length > 128) contracts.fail('OWNER_REQUIRED', 'A signed owner identity is required');
  const ownerHash = sha(owner), prefix = '_stonks/research-lab/' + ownerHash + '/', stateKey = prefix + 'state.json';
  function initial() { return { schema: 'mingstreet.research-state.v2', version: 0, experiments: [], runs: [], events: [], exports: [], interpretations: [], comparisons: [], exposures: [], forward_observations: [] }; }
  async function read() {
    const bytes = await store.rawGet(stateKey);
    if (bytes == null) return initial();
    if (bytes.length > 16 * 1024 * 1024) contracts.fail('RESOURCE_LIMIT', 'Journal projection exceeds its retention ceiling');
    const state = JSON.parse(bytes.toString('utf8'));
    if (state.schema !== 'mingstreet.research-state.v2') contracts.fail('SCHEMA_VERSION', 'Unsupported Journal state');
    return state;
  }
  function emit(state, type, payload, dedupeKey) {
    if (dedupeKey && state.events.some(e => e.dedupe_key === dedupeKey)) return;
    if (state.events.length >= 12000) contracts.fail('RETENTION_LIMIT', 'Journal event ceiling reached; retain and archive before adding work');
    const previous = state.events.at(-1)?.sha256 || null;
    const event = { sequence: state.events.length + 1, type, payload, occurred_at: clock(), previous_sha256: previous,
      dedupe_key: dedupeKey || opaqueId('event') };
    state.events.push({ ...event, sha256: sha(event) });
  }
  async function transact(fn) {
    if (store.backend !== 'r2' || typeof store.withLease !== 'function') contracts.fail('DURABLE_STORE_REQUIRED', 'Research Lab requires R2 conditional writes; no in-memory or Blob fallback');
    const leased = await store.withLease('research-lab-' + ownerHash, async guard => {
      const state = await read(), result = await fn(state);
      state.version++; const bytes = canonical(state);
      if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) contracts.fail('RETENTION_LIMIT', 'Journal byte ceiling reached');
      guard(); await store.rawPut(stateKey, bytes); return result;
    });
    if (leased.busy) contracts.fail('BUSY', 'Another research update is in progress; retry shortly');
    return leased.result;
  }
  async function putObject(kind, value) {
    if (!/^[a-z-]+$/.test(kind)) throw new Error('Internal object kind');
    const bytes = canonical(value), checksum = sha(bytes);
    if (Buffer.byteLength(bytes) > contracts.LIMITS.artifact_bytes) contracts.fail('RESOURCE_LIMIT', 'Artifact byte ceiling reached');
    const ref = { key: prefix + kind + '/' + checksum + '.json', sha256: checksum, bytes: Buffer.byteLength(bytes) };
    // Same bytes, same pathname. Concurrent retries cannot change the object.
    await store.rawPut(ref.key, bytes); return ref;
  }
  async function object(ref) {
    if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith(prefix) || !/\/[a-f0-9]{64}\.json$/.test(ref.key) || ref.key.includes('..')) contracts.fail('NOT_FOUND', 'Research object not found');
    const bytes = await store.rawGet(ref.key);
    if (bytes == null) contracts.fail('ARTIFACT_MISSING', 'Retained research object is missing; replay is unavailable');
    if (bytes.length > contracts.LIMITS.artifact_bytes || sha(bytes) !== ref.sha256) contracts.fail('HASH_MISMATCH', 'Retained object checksum mismatch');
    return JSON.parse(bytes.toString('utf8'));
  }
  function find(state, collection, id) {
    if (!validId(id)) contracts.fail('NOT_FOUND', 'Record not found');
    const record = state[collection].find(r => r.id === id);
    if (!record) contracts.fail('NOT_FOUND', 'Record not found');
    return record;
  }
  return { read, transact, putObject, object, emit, find, clock, ownerHash };
}

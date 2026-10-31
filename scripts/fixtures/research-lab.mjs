import { sha, canonical } from '../../lib/research-lab/canonical.mjs';
import { random } from '../../lib/research-lab/statistics.mjs';
import { withObjectLease } from '../../lib/object-lease.mjs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

export const FIXTURE_NOW = '2026-10-30T23:30:00.000Z';
export function fixtureSnapshot({ pit = false, seed = 71, count = 420, noAlpha = false } = {}) {
  const rng = random(seed), dates = [];
  for (let d = new Date('2025-01-02T12:00:00Z'); dates.length < count; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
  const assets = {};
  for (const [j, asset] of ['AAA', 'BBB', 'SPY'].entries()) {
    let price = 100 + j * 30;
    const bars = dates.map((date, i) => {
      const open = price * (1 + (rng() - 0.5) * 0.015);
      price = open * (1 + (rng() - 0.5) * 0.065 + (noAlpha ? 0 : i % 47 < 5 && j < 2 ? -0.025 : 0.003));
      return { date, open, close: price, volume: 1000000,
        available_at: pit ? date + 'T21:15:00.000Z' : null, first_published_at: pit ? date + 'T21:05:00.000Z' : null,
        ingested_at: pit ? date + 'T21:10:00.000Z' : null, tradable_at: pit ? date + 'T21:15:00.000Z' : null,
        vintage: pit ? 'controlled-synthetic-v1' : null };
    });
    assets[asset] = { bars, source_key: 'FICTIONAL-' + asset };
  }
  const snapshot = { schema: 'mingstreet.research-snapshot.v2', captured_at: FIXTURE_NOW, assets, source_id: 'SYNTHETIC_TEST_ONLY',
    history_class: pit ? 'RECONSTRUCTED_PIT' : 'EXPLORATORY_NON_PIT', calendar: 'XNYS', timezone: 'America/New_York', currency: 'USD',
    adjustment: 'synthetic_no_actions', universe_policy: 'synthetic_fixed_universe', license: { raw_export: false, derived_export: true },
    warnings: ['SYNTHETIC TEST DATA: no real prices, returns, PIT coverage or trading evidence.'] };
  return { ...snapshot, id: 'snap_' + sha(snapshot) };
}
export function fixturePlan(snapshot) {
  const dates = snapshot.assets.SPY.bars.map(b => b.date);
  return { schema: 'mingstreet.evaluation-plan.v2', target: 'benchmark_relative_return', universe: ['AAA', 'BBB'],
    discovery: [dates[0], dates[220]], holdout: [dates[260], dates.at(-1)], horizon_sessions: 10, embargo_sessions: 11,
    benchmark: 'SPY', costs: { commission_bps: 1, slippage_bps: 5 }, max_trials: 40, min_events: 5, bootstrap_samples: 100,
    execution: 'next_open', primary_metric: 'mean_excess_return' };
}
export function memoryStore(initial = new Map()) {
  const objects = initial, etags = new Map(); let n = 0;
  return { backend: 'r2', objects, get: async key => objects.get(key) || null,
    rawGet: async key => objects.get(key) || null,
    rawPut: async (key, value) => { objects.set(key, Buffer.from(value)); },
    withLease: (name, fn) => withObjectLease({ read: async () => etags.get(name) || null,
      write: async (value, etag) => { const old = etags.get(name); if ((old?.etag || null) !== etag) return null; const next = '"' + (++n) + '"'; etags.set(name, { value, etag: next }); return next; } }, fn) };
}
// Only used by local previews/tests, never selected by production code.
export async function fileFixtureStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = key => resolve(directory, sha(key) + '.json');
  return { backend: 'r2', get: async key => { try { return await readFile(filename(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    rawGet: async key => { try { return await readFile(filename(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    rawPut: async (key, bytes) => { const path = filename(key), tmp = path + '.' + process.pid; await writeFile(tmp, bytes); await rename(tmp, path); },
    withLease: async (name, fn) => {
      const path = filename('lease-' + name); let handle;
      try { handle = await (await import('node:fs/promises')).open(path + '.lock', 'wx'); }
      catch (e) { if (e.code === 'EEXIST') return { busy: true }; throw e; }
      try { return { busy: false, result: await fn(() => {}) }; }
      finally { await handle.close(); await (await import('node:fs/promises')).unlink(path + '.lock'); }
    } };
}
export async function seedSnapshot(repo, snapshot) {
  const ref = await repo.putObject('snapshots', snapshot);
  await repo.transact(s => repo.emit(s, 'SNAPSHOT_CAPTURED', { snapshot_id: snapshot.id, ref }, 'fixture-' + snapshot.id));
}
export function sourceFiles(snapshot) {
  return new Map(Object.entries(snapshot.assets).map(([asset, value]) => [asset + '.json', Buffer.from(canonical({ builtAtIso: FIXTURE_NOW, priceSeries: {
    t: value.bars.map(b => b.date), c: value.bars.map(b => b.close), o: value.bars.map(b => b.open), v: value.bars.map(b => b.volume) } }))]));
}

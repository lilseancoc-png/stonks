// Reproducible synthetic consumption estimate, never a production bill.
import { writeFile } from 'node:fs/promises';
import { memoryStore, sourceFiles, fixtureSnapshot, fixturePlan, FIXTURE_NOW } from './fixtures/research-lab.mjs';
import { createLabRepository } from '../lib/research-lab/repository.mjs';
import { contracts } from '../lib/research-lab/contracts.mjs';
import * as service from '../lib/research-lab/service.mjs';
import { advanceRun } from '../lib/research-lab/worker.mjs';
import { exportRun } from '../lib/research-lab/exchange.mjs';
const store = memoryStore(sourceFiles(fixtureSnapshot())), counts = { class_a: 0, class_b: 0, put_bytes: 0 };
const get = store.rawGet, put = store.rawPut, lease = store.withLease;
store.rawGet = async key => { counts.class_b++; return get(key); };
store.get = store.rawGet;
store.rawPut = async (key, bytes) => { counts.class_a++; counts.put_bytes += Buffer.byteLength(bytes); return put(key, bytes); };
store.withLease = async (name, fn) => { counts.class_a += 2; counts.class_b++; return lease(name, fn); };
const repo = createLabRepository({ store, owner: 'synthetic-cost-owner', clock: () => FIXTURE_NOW });
const cpuStart = process.cpuUsage(), start = performance.now();
const snapshot = await service.capture(repo, store, ['AAA', 'BBB', 'SPY']), graph = contracts.template('breadth');
graph.research_config.snapshot_id = snapshot.id; graph.research_config.as_of = FIXTURE_NOW;
const source = await service.getSnapshot(repo, await repo.read(), snapshot.id), plan = fixturePlan(source);
await service.previewCompile(repo, graph, plan);
const saved = await service.saveExperiment(repo, { graph, plan, hypothesis: 'Synthetic cost benchmark, not market evidence.' });
const run = await service.queueRun(repo, { experiment_id: saved.experiment_id, revision: 1, stage: 'discovery', idempotency_key: 'synthetic-cost-benchmark' });
await service.getRun(repo, run.id);
let steps = 0;
for (; steps < 30; steps++) { const r = await advanceRun(repo, run.id); if (service.terminal(r.status)) { steps++; if (r.status !== 'SUCCEEDED') throw Error('Benchmark run failed'); break; } }
await service.getRun(repo, run.id); await service.journal(repo);
const exported = await exportRun(repo, run.id), cpu = process.cpuUsage(cpuStart);
const objects = [...store.objects.entries()].filter(([k]) => k.startsWith('_stonks/research-lab/'));
const retainedBytes = objects.reduce((n, [, value]) => n + value.length, 0), cpuSeconds = (cpu.user + cpu.system) / 1e6;
const apiRequests = steps + 8; // capture, compile, save, queue, initial/final detail, journal, export
const report = { measured_at: '2026-10-31', scope: 'synthetic 3 assets × 420 sessions, 6-node study plus one compact export; local CPU/objects, not production billing',
  ai_api_dollars: 0, ai_requests: 0, provider_requests: 0,
  measured: { ...counts, retained_bytes: retainedBytes, objects: objects.length, steps, api_requests: apiRequests, cpu_seconds: cpuSeconds, local_elapsed_ms: performance.now() - start, zip_bytes: exported.bytes.length },
  assumptions: { region: 'iad1 illustration, not verified project region', memory_gb: 2, allocated_seconds_per_request: 1,
    r2_standard_gb_month: 0.015, r2_a_per_million: 4.5, r2_b_per_million: 0.36, vercel_cpu_hour: 0.128, vercel_memory_gb_hour: 0.0106, vercel_invocations_per_million: 0.60 },
  caveats: ['R2 lease protocol modeled as one GET and two PUTs per successful lease. Real retries/publication lookups increase usage.',
    'Vercel network duration, cold starts, instance concurrency and memory reservation were not measured. One-second requests are an illustrative allocation, not a bill prediction.',
    'Storage assumes each run retains a separate full fixture footprint for one month; reuse reduces it. Failed/orphan objects can add storage.',
    'Free allowances and existing account usage are shared. R2 billable units round upward; below are rate-normalized consumption equivalents before allowances, not invoice amounts.',
    'External ChatGPT/Claude usage follows the user’s own plan; the site makes no model calls.'],
  sources: ['https://developers.cloudflare.com/r2/pricing/', 'https://vercel.com/docs/functions/usage-and-pricing'] };
report.scenarios = [100, 200].map(runs => ({ runs, retained_gb: retainedBytes * runs / 1e9, class_a: counts.class_a * runs, class_b: counts.class_b * runs,
  ai_api_dollars: 0, r2_rate_equivalent_dollars: retainedBytes * runs / 1e9 * 0.015 + counts.class_a * runs / 1e6 * 4.5 + counts.class_b * runs / 1e6 * 0.36,
  vercel_rate_equivalent_dollars: cpuSeconds * runs / 3600 * 0.128 + apiRequests * runs * 2 / 3600 * 0.0106 + apiRequests * runs / 1e6 * 0.60,
  vercel_10_seconds_per_request_rate_equivalent_dollars: cpuSeconds * runs / 3600 * 0.128 + apiRequests * runs * 20 / 3600 * 0.0106 + apiRequests * runs / 1e6 * 0.60 }));
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

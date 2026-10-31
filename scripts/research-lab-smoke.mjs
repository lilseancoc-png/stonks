import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contracts } from '../lib/research-lab/contracts.mjs';
import { canonical, sha, numericEquivalent } from '../lib/research-lab/canonical.mjs';
import { compileGraph } from '../lib/research-lab/compiler.mjs';
import { runCompiled, executeNode } from '../lib/research-lab/engine.mjs';
import { createLabRepository } from '../lib/research-lab/repository.mjs';
import * as service from '../lib/research-lab/service.mjs';
import { advanceRun } from '../lib/research-lab/worker.mjs';
import { exportRun, validateInterpretation, importInterpretation } from '../lib/research-lab/exchange.mjs';
import { handleResearchRequest } from '../lib/research-lab/http.mjs';
import { captureSnapshot } from '../lib/research-lab/adapters.mjs';
import { researchLabEnabled } from '../lib/research-lab/access.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import authHandler from '../api/auth/[action].js';
import { fixtureSnapshot, fixturePlan, memoryStore, seedSnapshot, sourceFiles, fileFixtureStore, FIXTURE_NOW } from './fixtures/research-lab.mjs';

let checks = 0;
const check = (test, message) => { assert(test, message); checks++; };
const rejects = async (fn, code) => { await assert.rejects(fn, e => e.code === code, code); checks++; };
const throws = (fn, code) => { assert.throws(fn, e => e.code === code, code); checks++; };
const snapshot = fixtureSnapshot(), plan = fixturePlan(snapshot), graph = contracts.template('breadth');
graph.research_config.snapshot_id = snapshot.id; graph.research_config.as_of = FIXTURE_NOW;
graph.nodes.find(n => n.id === 'shock').params.threshold_pct = -3;
graph.nodes.find(n => n.id === 'breadth').params.min_fraction = 0.2;
const compiled = await compileGraph(graph, plan, snapshot);
const result = runCompiled(compiled, snapshot).result;
let noAlphaIntervals = 0, falsePositiveIntervals = 0;
for (let seed = 1; seed <= 30; seed++) {
  const nullSnapshot = fixtureSnapshot({ seed, noAlpha: true }), g = contracts.template('conditional');
  g.research_config.snapshot_id = nullSnapshot.id; g.research_config.as_of = FIXTURE_NOW;
  g.nodes.find(n => n.id === 'shock').params.threshold_pct = -3;
  const r = runCompiled(await compileGraph(g, plan, nullSnapshot), nullSnapshot).result;
  if (r.summary.uncertainty.low != null) { noAlphaIntervals++; if (r.summary.uncertainty.low > 0) falsePositiveIntervals++; }
}
check(noAlphaIntervals >= 20 && falsePositiveIntervals / noAlphaIntervals <= 0.2, 'Independent no-alpha fixtures do not routinely report a positive lower bound');
check(result.summary.events > 0, 'Golden experiment yields controlled fixture events');
check(result.summary.mean_net_return <= result.summary.mean_gross_return, 'Nonnegative costs never improve net returns');
check(sha(result) === sha(runCompiled(compiled, snapshot).result), 'Deterministic metrics and artifact bytes');
check(numericEquivalent({ value: 1 }, { value: 1 + 1e-13 }) && !numericEquivalent({ value: 1 }, { value: 1.01 }), 'Numeric replay tolerance distinguishes tiny numerical drift from changed metrics');
const moved = structuredClone(graph); moved.nodes.reverse(); moved.nodes[0].position.x += 30;
check((await compileGraph(moved, plan, snapshot)).graph_sha256 === compiled.graph_sha256, 'Layout/node order does not change numerical graph hash');
for (const [mutate, code] of [
  [g => g.nodes[0].version = '99.0.0', 'UNKNOWN_BLOCK'],
  [g => g.nodes[1].params.inject = 'fetch secrets', 'UNKNOWN_FIELD'],
  [g => g.nodes.push(structuredClone(g.nodes[0])), 'DUPLICATE_NODE'],
  [g => g.edges[0].to = 'shock.events', 'PORT_INVALID'],
  [g => g.edges.find(e => e.to === 'both.a').from = 'prices.prices', 'TYPE_MISMATCH'],
  [g => g.edges = g.edges.filter(e => e.to !== 'both.a'), 'MISSING_INPUT'],
  [g => g.edges.find(e => e.to === 'both.a').from = 'both.events', 'GRAPH_CYCLE'],
  [g => g.research_config.currency = 'EUR', 'TYPE_MISMATCH'],
  [g => g.research_config.mode = 'forecast', 'CALIBRATION_REQUIRED'],
]) { const bad = structuredClone(graph); mutate(bad); throws(() => contracts.validateGraph(bad), code); }
const overlap = structuredClone(plan); overlap.holdout[0] = overlap.discovery[1]; throws(() => contracts.validatePlan(overlap), 'HOLDOUT_OVERLAP');
const embargo = structuredClone(plan); embargo.embargo_sessions = 1; throws(() => contracts.validatePlan(embargo), 'PLAN_INVALID');
const negativeCosts = structuredClone(plan); negativeCosts.costs.slippage_bps = -1; throws(() => contracts.validatePlan(negativeCosts), 'COST_INVALID');
const sameClose = structuredClone(plan); sameClose.execution = 'same_close'; throws(() => contracts.validatePlan(sameClose), 'PLAN_INVALID');
const rawStore = memoryStore(sourceFiles(snapshot)), captured = await captureSnapshot(rawStore, ['AAA', 'BBB', 'SPY'], FIXTURE_NOW);
check(captured.history_class === 'EXPLORATORY_NON_PIT', 'Production adapter never fabricates PIT timestamps');
check(captured.assets.AAA.bars.every(b => b.ingested_at === null), 'Historical ingestion remains unknown');
const pit = fixtureSnapshot({ pit: true }), pitGraph = structuredClone(graph); pitGraph.research_config.snapshot_id = pit.id;
await compileGraph(pitGraph, plan, pit);
const leaked = structuredClone(pit); const leakBar = leaked.assets.AAA.bars[20]; leakBar.available_at = leaked.assets.AAA.bars[25].date + 'T21:15:00.000Z';
const { id: oldId, ...leakBody } = leaked; leaked.id = 'snap_' + sha(leakBody);
const lg = structuredClone(pitGraph); lg.research_config.snapshot_id = leaked.id;
const lc = await compileGraph(lg, plan, leaked);
const prices = executeNode(graph.nodes[0], {}, { snapshot: leaked, as_of: FIXTURE_NOW }).prices;
throws(() => executeNode({ type: 'study.forward', params: {} }, { prices, events: [{ asset: 'AAA', date: leakBar.date, value: true, known_at: leakBar.available_at, decision_at: leakBar.date + 'T21:15:00Z' }] }, { plan, stage: 'discovery', seed: 101, mode: 'descriptive' }), 'TEMPORAL_LEAKAGE');
const revised = structuredClone(pit); revised.assets.AAA.bars[0].vintage = null; const { id: ri, ...rb } = revised; revised.id = 'snap_' + sha(rb);
const rg = structuredClone(pitGraph); rg.research_config.snapshot_id = revised.id; await rejects(() => compileGraph(rg, plan, revised), 'PIT_INELIGIBLE');
// Same-close fictional fills and zero-volume/missing calendars are never inferred.
const sparse = structuredClone(snapshot); sparse.assets.AAA.bars[80].volume = 0;
const sparseResult = runCompiled(compiled, sparse).result;
check(sparseResult.skipped.untradable_or_missing_open_volume > 0, 'Zero-volume days exclude modeled fills');
check(result.rows.every(r => r.entry_date > r.date && r.exit_date <= plan.discovery[1]), 'Next-open execution and split-boundary label purging');
for (const kind of ['stress', 'reverse', 'sensitivity', 'monte_carlo', 'strategy']) {
  const g = contracts.template(kind); g.research_config.snapshot_id = snapshot.id; g.research_config.as_of = FIXTURE_NOW;
  const c = await compileGraph(g, plan, snapshot), r = runCompiled(c, snapshot).result;
  check(kind === 'strategy' ? r.strategy.net_return <= r.strategy.gross_return : r.kind === 'conditional_scenario' && !('probability' in r), kind + ' has correct semantics');
  check(sha(r) === sha(runCompiled(c, snapshot).result), kind + ' deterministic');
}
const streakGraph = contracts.template('forward'); streakGraph.nodes.find(n => n.id === 'shock').type = 'signal.streak'; streakGraph.nodes.find(n => n.id === 'shock').params = contracts.defaults('signal.streak');
streakGraph.research_config.snapshot_id = snapshot.id; streakGraph.research_config.as_of = FIXTURE_NOW;
check(runCompiled(await compileGraph(streakGraph, plan, snapshot), snapshot).result.summary.events > 0, 'Existing signal adapter uses the actual current.color/current.sameDays contract');
const signalCtx = { snapshot, as_of: FIXTURE_NOW, plan, seed: 101 }, fullPrices = executeNode(graph.nodes[0], {}, signalCtx).prices;
const signalNode = streakGraph.nodes.find(n => n.id === 'shock'), signals = executeNode(signalNode, { prices: fullPrices }, signalCtx).events;
const cutoff = snapshot.assets.AAA.bars[140].date, prefixPrices = structuredClone(fullPrices);
for (const asset of Object.values(prefixPrices.assets)) asset.bars = asset.bars.filter(b => b.date <= cutoff);
check(canonical(signals.filter(r => r.date <= cutoff)) === canonical(executeNode(signalNode, { prices: prefixPrices }, signalCtx).events), 'Future bars cannot change prior existing-signal observations');
for (const chain of [
  ['transform.returns', 'transform.standardize', 'logic.zthreshold'],
  ['transform.returns', 'logic.rank', 'logic.rank_filter'],
  ['transform.returns', 'transform.rolling', 'transform.winsorize', 'transform.lag', 'logic.threshold'],
]) {
  const g = contracts.template('conditional'); g.research_config = structuredClone(graph.research_config);
  g.nodes = g.nodes.filter(n => n.id !== 'shock'); g.edges = g.edges.filter(e => !e.from.startsWith('shock.') && !e.to.startsWith('shock.'));
  let previous = 'prices.prices';
  for (let i = 0; i < chain.length; i++) {
    const type = chain[i], def = contracts.blocks.find(b => b.key === type), id = 'f' + i;
    g.nodes.push({ id, type, version: contracts.VERSION, params: contracts.defaults(type), position: { x: i * 100, y: 0 } });
    g.edges.push({ from: previous, to: id + '.' + def.inputs[0].name }); previous = id + '.' + def.outputs[0].name;
  }
  g.edges.push({ from: previous, to: 'study.events' });
  check(runCompiled(await compileGraph(g, plan, snapshot), snapshot).result.kind === 'descriptive_event_study', 'Typed transform chain ' + chain.join(' → '));
}
const store = memoryStore(), repo = createLabRepository({ store, owner: 'fixture-owner', clock: () => FIXTURE_NOW }); await seedSnapshot(repo, snapshot);
const saved = await service.saveExperiment(repo, { graph, plan, hypothesis: 'Synthetic oversold-plus-breadth acceptance study.' });
const body = { experiment_id: saved.experiment_id, revision: 1, stage: 'discovery', idempotency_key: 'fixture-discovery-0001' };
const queued = await service.queueRun(repo, body), duplicate = await service.queueRun(repo, body);
check(queued.id === duplicate.id, 'Queue submission idempotent');
async function drain(r, id) { for (let i = 0; i < 30; i++) { const run = await advanceRun(r, id); if (service.terminal(run.status)) return run; } throw new Error('Worker did not finish'); }
await drain(repo, queued.id);
const completed = await service.getRun(repo, queued.id);
check(completed.run.status === 'SUCCEEDED', 'Persisted worker completes golden study');
check(sha(completed.result) === sha(result), 'Direct and persisted execution match');
const before = canonical(completed.result);
const replay = await service.queueRun(repo, { ...body, idempotency_key: 'fixture-replay-00001', replay_of: queued.id }); await drain(repo, replay.id);
check((await service.getRun(repo, replay.id)).run.replay_check.byte_identical, 'Frozen replay is byte-identical');
const cancel = await service.queueRun(repo, { ...body, idempotency_key: 'fixture-cancel-00001' });
await service.cancelRun(repo, cancel.id); await advanceRun(repo, cancel.id);
check((await service.getRun(repo, cancel.id)).run.status === 'CANCELED', 'Cancellation persists through advancement');
const inFlightCancel = await service.queueRun(repo, { ...body, idempotency_key: 'fixture-inflight-cancel' });
await advanceRun(repo, inFlightCancel.id, { afterClaim: () => service.cancelRun(repo, inFlightCancel.id) });
check((await service.getRun(repo, inFlightCancel.id)).run.status === 'CANCELED' && !(await repo.read()).runs.find(r => r.id === inFlightCancel.id).result, 'Cancellation after a persisted worker claim suppresses publication');
const failedRun = await service.queueRun(repo, { ...body, idempotency_key: 'fixture-node-failed-001' }), oldRawGet = store.rawGet;
store.rawGet = async key => { if (key.includes('/snapshots/')) throw new Error('Synthetic storage failure'); return oldRawGet(key); };
await advanceRun(repo, failedRun.id); store.rawGet = oldRawGet;
const failedDetail = await service.getRun(repo, failedRun.id);
check(failedDetail.run.status === 'FAILED' && failedDetail.result === null && failedDetail.run.attempts[0].status === 'FAILED', 'Failed node retains diagnostics without publishing partial metrics');
const final = await service.queueRun(repo, { ...body, stage: 'final', idempotency_key: 'fixture-final-000001' }); await drain(repo, final.id);
const variant = structuredClone(graph); variant.nodes.find(n => n.id === 'shock').params.threshold_pct = -2;
await service.saveExperiment(repo, { experiment_id: saved.experiment_id, expected_revision: 1, graph: variant, plan, hypothesis: 'Retuned threshold after final exposure.' });
const tuned = await service.queueRun(repo, { ...body, revision: 2, stage: 'final', idempotency_key: 'fixture-tuned-000001' });
check(tuned.holdout_status === 'HOLDOUT_COMPROMISED', 'Tuning after final exposure compromises independence');
await service.cancelRun(repo, tuned.id);
await rejects(() => service.reviewEvidence(repo, { experiment_id: saved.experiment_id, run_id: queued.id, status: 'CANDIDATE', reason: 'Test promotion denial' }), 'PIT_INELIGIBLE');
const simpler = contracts.template('conditional'); simpler.research_config = structuredClone(graph.research_config); simpler.nodes.find(n => n.id === 'shock').params.threshold_pct = -3;
const save2 = await service.saveExperiment(repo, { graph: simpler, plan, family_id: saved.family_id, hypothesis: 'Simpler oversold baseline.' });
const run2 = await service.queueRun(repo, { experiment_id: save2.experiment_id, revision: 1, stage: 'discovery', idempotency_key: 'fixture-simple-00001' }); await drain(repo, run2.id);
const cmp = await service.compareRuns(repo, [run2.id, queued.id], 'Oversold versus breadth');
check(cmp.common_observations > 0 && cmp.comparisons[0].excluded_baseline === 0, 'Comparison uses matched asset/session observations');
const subsetPlan = structuredClone(plan); subsetPlan.universe = ['AAA'];
const subsetSave = await service.saveExperiment(repo, { graph: simpler, plan: subsetPlan, hypothesis: 'Unequal universe coverage comparison fixture.' });
const subsetRun = await service.queueRun(repo, { experiment_id: subsetSave.experiment_id, revision: 1, stage: 'discovery', idempotency_key: 'fixture-subset-00001' }); await drain(repo, subsetRun.id);
const unequal = await service.compareRuns(repo, [run2.id, subsetRun.id], 'Intersection of unequal universes');
check(unequal.assets.length === 1 && unequal.comparisons[0].excluded_baseline > 0 && unequal.comparisons[0].excluded_candidate === 0, 'Unequal coverage uses common observations and reports excluded records');
await rejects(() => service.compareRuns(repo, [queued.id, final.id], 'Invalid split comparison'), 'COMPARISON_INVALID');
const zip = await exportRun(repo, queued.id), output = await mkdtemp(join(tmpdir(), 'research-lab-evidence-'));
await writeFile(join(output, 'research.zip'), zip.bytes);
check(zip.bytes.readUInt32LE(0) === 0x04034b50, 'Export is a ZIP');
check(!zip.bytes.includes(Buffer.from('source_key')) && !zip.bytes.includes(Buffer.from('first_published_at')), 'No raw source observations in export');
const canonicalExport = await repo.object((await repo.read()).exports[0].ref), imported = canonicalExport.template;
const [metricId, metric] = Object.entries(zip.index)[0];
imported.summary = 'Fixture external interpretation; narrative remains opinion.';
imported.findings = [{ type: 'quantitative_reference', claim: 'Metric copied from evidence index.', metric_id: metricId,
  expected_value: String(metric.value), expected_unit: metric.unit, assessment: 'limited', limitations: 'Synthetic data only.' }];
const preview = await validateInterpretation(repo, imported);
check(preview.verified[0].pointer_verified, 'Canonical numeric value/unit verified');
const tampered = structuredClone(imported); tampered.findings[0].expected_value = metric.value + 1; await rejects(() => validateInterpretation(repo, tampered), 'METRIC_MISMATCH');
const wrongUnit = structuredClone(imported); wrongUnit.findings[0].expected_unit = 'USD'; await rejects(() => validateInterpretation(repo, wrongUnit), 'METRIC_MISMATCH');
const malicious = structuredClone(imported); malicious.execute = 'fetch secrets'; await rejects(() => validateInterpretation(repo, malicious), 'UNKNOWN_FIELD');
const html = structuredClone(imported); html.summary = '<img src=x onerror=alert(1)>'; await rejects(() => validateInterpretation(repo, html), 'SCHEMA_INVALID');
await importInterpretation(repo, imported, 'approved', preview.input_sha256);
check(canonical((await service.getRun(repo, queued.id)).result) === before, 'Imported commentary never edits metrics');
const internalKeys = [...store.objects.keys()]; check(internalKeys.every(k => k.startsWith('_stonks/research-lab/')), 'All research writes stay outside existing engine and broker keys');
const foreign = createLabRepository({ store, owner: 'another-owner', clock: () => FIXTURE_NOW });
await rejects(() => service.getRun(foreign, queued.id), 'NOT_FOUND');
await rejects(() => validateInterpretation(foreign, imported), 'NOT_FOUND');
const state = await repo.read();
check(state.events.filter(e => e.type === 'RUN_SUCCEEDED' && e.payload.run_id === queued.id).length === 1, 'Terminal publication deduplicated');
for (let i = 1; i < state.events.length; i++) check(state.events[i].previous_sha256 === state.events[i - 1].sha256, 'Append-only event hash chain');
// Actual subprocess death between persisted claim and compute, then fresh worker process.
const directory = await mkdtemp(join(tmpdir(), 'research-lab-worker-')), disk = await fileFixtureStore(directory), diskRepo = createLabRepository({ store: disk, owner: 'fixture-owner', clock: () => FIXTURE_NOW });
await seedSnapshot(diskRepo, snapshot); const ds = await service.saveExperiment(diskRepo, { graph, plan, hypothesis: 'Restart recovery acceptance' });
const dr = await service.queueRun(diskRepo, { experiment_id: ds.experiment_id, revision: 1, stage: 'discovery', idempotency_key: 'fixture-process-00001' });
const script = new URL('./fixtures/research-lab-worker.mjs', import.meta.url).pathname;
check(spawnSync(process.execPath, [script, directory, dr.id, FIXTURE_NOW, 'crash']).status === 73, 'Real worker process crashes after durable claim');
const later = '2026-10-30T23:31:00.000Z';
for (let i = 0; i < graph.nodes.length; i++) {
  const child = spawnSync(process.execPath, [script, directory, dr.id, later, 'resume'], { encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr);
}
const restarted = await service.getRun(diskRepo, dr.id);
check(restarted.run.status === 'SUCCEEDED' && restarted.run.attempts.some(a => a.status === 'ABANDONED'), 'Fresh worker processes recover abandoned job');
check((await diskRepo.read()).events.filter(e => e.type === 'RUN_SUCCEEDED').length === 1, 'Restart publishes result exactly once');
const env = { PRIVATE_DATA_ENABLED: '1', RESEARCH_LAB_ENABLED: '1', RESEARCH_LAB_OWNER_IDS: 'fixture-owner' }, session = { sub: 'fixture-owner', tr: true, tp: true };
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, end(v) { this.body = v; return this; } });
for (const who of [null, { ...session, tr: false }, { ...session, tp: false }, { ...session, sub: 'foreign-owner' }, session]) {
  const res = response(); await handleResearchRequest({ method: 'GET', query: { lab: 'journal' }, headers: {} }, res, { env, store, getSession: async () => who });
  check(res.statusCode === (who === session ? 200 : 403), 'API checks owner claims and account allowlist');
  check(res.headers['Cache-Control'] === 'private, no-store', 'Research responses never shared-cache');
}
check(!researchLabEnabled(session, {}), 'Default off');
const denied = response(); await handleResearchRequest({ method: 'POST', query: { lab: 'snapshot' }, headers: { origin: 'https://evil.example', host: 'site.example' }, body: { symbols: ['AAA'] } }, denied, { env, store, getSession: async () => session }); check(denied.statusCode === 403, 'Cross-origin mutation denied');
const blobRepo = createLabRepository({ store: { ...store, backend: 'blob' }, owner: 'fixture-owner' }); await rejects(() => blobRepo.transact(() => null), 'DURABLE_STORE_REQUIRED');
const singleton = (await import('../lib/datastore.mjs')).store;
const oldMethods = Object.fromEntries(['backend', 'rawGet', 'rawPut', 'withLease'].map(k => [k, singleton[k]]));
const oldEnv = Object.fromEntries(['PRIVATE_DATA_ENABLED', 'RESEARCH_LAB_ENABLED', 'RESEARCH_LAB_OWNER_IDS', 'SESSION_SECRET'].map(k => [k, process.env[k]]));
try {
  Object.assign(singleton, { backend: 'r2', rawGet: store.rawGet, rawPut: store.rawPut, withLease: store.withLease });
  Object.assign(process.env, env, { SESSION_SECRET: 'research-lab-offline-signature-test' });
  const token = await signSession(session), legacy = await signSession({ ...session, tp: false });
  for (const [cookie, expected] of [[token, 200], [legacy, 403], [token + 'tampered', 403], ['', 403]]) {
    const res = response(); await authHandler({ method: 'GET', query: { action: 'me', lab: 'journal' }, headers: { cookie: SESSION_COOKIE + '=' + cookie } }, res);
    check(res.statusCode === expected, 'Actual /api/auth/me Lab routing verifies signed session and claims');
  }
  const me = response(); await authHandler({ method: 'GET', query: { action: 'me' }, headers: { cookie: SESSION_COOKIE + '=' + token } }, me); check(me.body.researchLab === true, 'Auth probe carries allowlisted feature entitlement');
  process.env.RESEARCH_LAB_ENABLED = '0'; const off = response(); await authHandler({ method: 'GET', query: { action: 'me', lab: 'journal' }, headers: { cookie: SESSION_COOKIE + '=' + token } }, off); check(off.statusCode === 404, 'Rollback flag disables actual API without deleting records');
} finally {
  Object.assign(singleton, oldMethods);
  for (const [k, v] of Object.entries(oldEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
console.log(`Research Lab: ${checks} checks passed. Golden study, temporal attacks, costs, deterministic replay, durable subprocess restart, cancellation, matched comparison, ZIP/JSON roundtrip, owner ACL and default-off gate. Evidence: ${output}`);

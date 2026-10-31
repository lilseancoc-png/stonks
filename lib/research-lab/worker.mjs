import { opaqueId } from './repository.mjs';
import { terminal, publicRun, getSnapshot } from './service.mjs';
import { executeNode } from './engine.mjs';
import { contracts } from './contracts.mjs';
import { codeDigest, numericEquivalent, environmentDigest } from './canonical.mjs';

// Persisted claim -> one pure node -> immutable output -> checkpoint. Each phase
// is short; cancellation can commit while computation is outside the owner lease.
export async function advanceRun(repo, id, hooks = {}) {
  const claim = await repo.transact(async state => {
    const run = repo.find(state, 'runs', id);
    if (terminal(run.status)) return { done: true, run: publicRun(run) };
    if (run.claim && run.claim.expires_at > repo.clock()) return { busy: true, run: publicRun(run) };
    const manifest = await repo.object(run.manifest);
    if (manifest.code_digest !== await codeDigest()) {
      run.status = 'FAILED'; run.failure = { code: 'CODE_VERSION_UNAVAILABLE', message: 'Frozen implementation is unavailable in this deployment' };
      run.completed_at = repo.clock(); repo.emit(state, 'RUN_FAILED', { run_id: id, ...run.failure }, id + '-terminal'); return { done: true, run: publicRun(run) };
    }
    const nodeId = manifest.order[run.cursor], attempts = run.attempts.filter(a => a.node_id === nodeId);
    if (run.claim) {
      const abandoned = run.attempts.find(a => a.token === run.claim.token);
      if (abandoned) { abandoned.status = 'ABANDONED'; abandoned.completed_at = repo.clock(); }
      repo.emit(state, 'NODE_RECOVERED', { run_id: id, node_id: nodeId, attempt: attempts.length });
    }
    if (attempts.length >= contracts.LIMITS.attempts || run.compute_ms >= contracts.LIMITS.run_ms) {
      run.status = 'TIMED_OUT'; run.failure = { code: 'RESOURCE_LIMIT', message: 'Run time/retry ceiling reached' }; run.completed_at = repo.clock(); delete run.claim;
      repo.emit(state, 'RUN_TIMED_OUT', { run_id: id }, id + '-terminal'); return { done: true, run: publicRun(run) };
    }
    const token = opaqueId('attempt'), now = repo.clock();
    run.status = 'RUNNING'; run.started_at ||= now; run.heartbeat_at = now;
    run.claim = { token, node_id: nodeId, expires_at: new Date(Date.parse(now) + 30000).toISOString() };
    run.attempts.push({ token, node_id: nodeId, attempt: attempts.length + 1, started_at: now, status: 'RUNNING', environment_digest: environmentDigest() });
    repo.emit(state, 'NODE_STARTED', { run_id: id, node_id: nodeId, attempt: attempts.length + 1 });
    return { token, node_id: nodeId, manifest, stage: run.stage, outputs: run.node_outputs, snapshot_id: run.snapshot_id };
  });
  if (claim.done || claim.busy) return claim.run;
  if (hooks.afterClaim) await hooks.afterClaim(claim);
  const started = Date.now(), memoryBefore = process.memoryUsage().heapUsed, cpuBefore = process.cpuUsage();
  let outputRef = null, failure = null;
  try {
    const state = await repo.read(), persisted = repo.find(state, 'runs', id);
    if (terminal(persisted.status) || persisted.claim?.token !== claim.token) return publicRun(persisted);
    const snapshot = await getSnapshot(repo, state, claim.snapshot_id), inputs = {};
    for (const edge of claim.manifest.graph.edges.filter(e => e.to.startsWith(claim.node_id + '.'))) {
      const [from, port] = edge.from.split('.'), output = await repo.object(claim.outputs[from]); inputs[edge.to.split('.')[1]] = output[port];
    }
    const node = claim.manifest.graph.nodes.find(n => n.id === claim.node_id);
    const output = executeNode(node, inputs, { snapshot, plan: claim.manifest.evaluation_plan, stage: claim.stage, seed: claim.manifest.seed,
      mode: claim.manifest.graph.research_config.mode, as_of: claim.manifest.graph.research_config.as_of, trial_count: claim.manifest.trial_count_at_registration || 1, deadline: started + contracts.LIMITS.node_ms });
    if (Date.now() - started > contracts.LIMITS.node_ms) contracts.fail('TIMED_OUT', 'Node exceeded execution deadline');
    if (process.memoryUsage().heapUsed - memoryBefore > contracts.LIMITS.memory_delta_bytes) contracts.fail('RESOURCE_LIMIT', 'Node exceeded its heap-growth ceiling');
    outputRef = await repo.putObject('node-outputs', output);
  } catch (error) { failure = { code: error.code || 'NODE_FAILED', message: String(error.message || error).slice(0, 1000) }; }
  const cpu = process.cpuUsage(cpuBefore);
  return repo.transact(async state => {
    const run = repo.find(state, 'runs', id);
    if (terminal(run.status) || run.claim?.token !== claim.token) return publicRun(run);
    const attempt = run.attempts.find(a => a.token === claim.token), wall_ms = Date.now() - started;
    Object.assign(attempt, { completed_at: repo.clock(), wall_ms, cpu_us: cpu.user + cpu.system,
      heap_delta_bytes: Math.max(0, process.memoryUsage().heapUsed - memoryBefore), cache_hit: false,
      output_bytes: outputRef?.bytes || 0, provider_requests: 0, ai_requests: 0, status: failure ? 'FAILED' : 'SUCCEEDED' });
    run.compute_ms += wall_ms; run.heartbeat_at = repo.clock(); delete run.claim;
    if (failure) {
      run.status = failure.code === 'TIMED_OUT' ? 'TIMED_OUT' : 'FAILED'; run.failure = failure; run.completed_at = repo.clock();
      repo.emit(state, 'RUN_' + run.status, { run_id: id, node_id: claim.node_id, ...failure }, id + '-terminal');
      return publicRun(run);
    }
    run.node_outputs[claim.node_id] = outputRef; run.cursor++;
    repo.emit(state, 'NODE_COMPLETED', { run_id: id, node_id: claim.node_id, sha256: outputRef.sha256 }, id + '-' + claim.node_id);
    if (run.cursor === claim.manifest.order.length) {
      const output = await repo.object(outputRef), result = output.report;
      run.result = await repo.putObject('results', result); run.status = 'SUCCEEDED'; run.completed_at = repo.clock();
      const snapshot = await getSnapshot(repo, state, run.snapshot_id);
      run.validation = { history_class: run.history_class, holdout_status: run.holdout_status, eligible_for_historical_promotion: false,
        promotion_policy: 'Human review plus complete PIT, uncertainty, baseline, untouched final and prospective evidence required; never automatic',
        trial_count_at_run: run.selection_trial, evidence_status: 'EXPLORATORY',
        limits: [...snapshot.warnings, ...result.warnings], result_sha256: run.result.sha256 };
      if (run.replay_of) {
        const original = repo.find(state, 'runs', run.replay_of);
        run.replay_check = { original_run_id: original.id, byte_identical: original.result.sha256 === run.result.sha256,
          metric_equivalent: numericEquivalent((await repo.object(original.result)).summary, result.summary), tolerance: 1e-12 };
        run.replay_check.environment_matches_manifest = claim.manifest.environment_digest === environmentDigest();
      }
      repo.emit(state, 'RUN_SUCCEEDED', { run_id: id, result_sha256: run.result.sha256, replay_check: run.replay_check || null }, id + '-terminal');
    }
    return publicRun(run);
  });
}

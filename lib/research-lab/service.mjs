import { contracts } from './contracts.mjs';
import { sha, codeDigest } from './canonical.mjs';
import { compileGraph } from './compiler.mjs';
import { opaqueId } from './repository.mjs';
import { captureSnapshot, snapshotSummary } from './adapters.mjs';
import { clusteredInterval, mean, correlation } from './statistics.mjs';
import { resolveEvidence } from './evidence.mjs';

export async function capture(repo, store, symbols) {
  const snapshot = await captureSnapshot(store, symbols, repo.clock());
  const fingerprint = s => sha({ assets: s.assets, source_id: s.source_id, history_class: s.history_class });
  const currentFingerprint = fingerprint(snapshot);
  const state = await repo.read();
  for (const entry of state.events.filter(e => e.type === 'SNAPSHOT_CAPTURED').reverse()) {
    if (entry.payload.fingerprint === currentFingerprint) return snapshotSummary(await repo.object(entry.payload.ref));
  }
  if (state.events.filter(e => e.type === 'SNAPSHOT_CAPTURED').length >= 120) contracts.fail('RESOURCE_LIMIT', 'Snapshot retention ceiling reached');
  const ref = await repo.putObject('snapshots', snapshot);
  await repo.transact(state => {
    // Snapshot references live in audit events, rather than an editable client registry.
    repo.emit(state, 'SNAPSHOT_CAPTURED', { snapshot_id: snapshot.id, ref, fingerprint: currentFingerprint }, 'snapshot-' + snapshot.id);
  });
  return snapshotSummary(snapshot);
}
export async function getSnapshot(repo, state, id) {
  const e = state.events.find(e => e.type === 'SNAPSHOT_CAPTURED' && e.payload.snapshot_id === id);
  if (!e) contracts.fail('NOT_FOUND', 'Snapshot is not owned by this account');
  return repo.object(e.payload.ref);
}
export async function previewCompile(repo, graph, plan) {
  const state = await repo.read(), snapshot = await getSnapshot(repo, state, graph?.research_config?.snapshot_id);
  return compileGraph(graph, plan, snapshot, await resolveEvidence(repo, state, graph));
}
export async function saveExperiment(repo, body) {
  contracts.keys(body, ['experiment_id', 'expected_revision', 'graph', 'plan', 'hypothesis', 'family_id'], 'experiment');
  contracts.text(body.hypothesis, 4000, 'hypothesis');
  const compiled = await previewCompile(repo, body.graph, body.plan);
  const prior = await repo.read(), family = body.experiment_id ? repo.find(prior, 'experiments', body.experiment_id).family_id : body.family_id;
  const familyBudget = prior.experiments.find(e => e.family_id === family)?.trial_budget;
  if (familyBudget && body.plan.max_trials > familyBudget) contracts.fail('TRIAL_BUDGET_CHANGE', 'A trial family cannot raise its preregistered trial budget after creation');
  const ref = await repo.putObject('revisions', { graph: body.graph, plan: body.plan, compiled, hypothesis: body.hypothesis });
  return repo.transact(state => {
    let exp;
    if (body.experiment_id) {
      exp = repo.find(state, 'experiments', body.experiment_id);
      if (body.expected_revision !== exp.revisions.length) contracts.fail('REVISION_CONFLICT', 'A newer revision exists; reopen before saving');
    } else {
      if (state.experiments.length >= contracts.LIMITS.experiments) contracts.fail('RETENTION_LIMIT', 'Experiment ceiling reached');
      const id = opaqueId('exp');
      if (body.family_id && !state.experiments.some(e => e.family_id === body.family_id)) contracts.fail('NOT_FOUND', 'Trial family not found');
      exp = { id, family_id: body.family_id || id, trial_budget: familyBudget || body.plan.max_trials, title: body.graph.name, hypothesis: body.hypothesis, created_at: repo.clock(), revisions: [], status: 'EXPLORATORY' };
      state.experiments.push(exp);
    }
    const revision = { number: exp.revisions.length + 1, graph_sha256: compiled.graph_sha256, plan_sha256: compiled.evaluation_plan_sha256, compiled_sha256: compiled.compiled_sha256, ref, saved_at: repo.clock() };
    exp.title = body.graph.name; exp.revisions.push(revision);
    const exposures = state.exposures.filter(x => exposureOverlaps(x, compiled.evaluation_plan));
    if (exposures.length) { exp.status = 'EXPLORATORY'; repo.emit(state, 'HOLDOUT_COMPROMISED', { experiment_id: exp.id, revision: revision.number,
      graph_sha256: compiled.graph_sha256, exposed_run_ids: exposures.map(e => e.run_id), reason: 'Saved after exposure to overlapping final period/universe' }); }
    repo.emit(state, 'REVISION_SAVED', { experiment_id: exp.id, revision: revision.number, graph_sha256: revision.graph_sha256 });
    return { experiment_id: exp.id, revision: revision.number, family_id: exp.family_id, compiled };
  });
}
function exposureOverlaps(exposure, plan) {
  return exposure.start <= plan.holdout[1] && exposure.end >= plan.holdout[0] && exposure.universe.some(s => plan.universe.includes(s));
}
export async function queueRun(repo, body) {
  contracts.keys(body, ['experiment_id', 'revision', 'stage', 'idempotency_key', 'replay_of'], 'run request');
  if (!['discovery', 'final'].includes(body.stage) || !Number.isInteger(body.revision) || typeof body.idempotency_key !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(body.idempotency_key)) contracts.fail('SCHEMA_INVALID', 'Invalid run revision, stage or idempotency key');
  return repo.transact(async state => {
    const requestHash = sha(body), old = state.runs.find(r => r.idempotency_key === body.idempotency_key);
    if (old) { if (old.request_sha256 !== requestHash) contracts.fail('IDEMPOTENCY_CONFLICT', 'This request key already identifies different inputs'); return publicRun(old); }
    const exp = repo.find(state, 'experiments', body.experiment_id), rev = exp.revisions.find(r => r.number === body.revision);
    if (!rev) contracts.fail('NOT_FOUND', 'Revision not found');
    let frozen = await repo.object(rev.ref), compiled = frozen.compiled, replay = null;
    if (body.replay_of) {
      replay = repo.find(state, 'runs', body.replay_of);
      if (replay.experiment_id !== exp.id || replay.revision !== rev.number || replay.stage !== body.stage || replay.status !== 'SUCCEEDED') contracts.fail('REPLAY_INVALID', 'Replay must reference a successful run of the same revision and stage');
      compiled = await repo.object(replay.manifest);
    }
    if (compiled.code_digest !== await codeDigest()) contracts.fail('CODE_VERSION_UNAVAILABLE', 'Frozen execution code is unavailable in this deployment; use the archived code revision for replay');
    if (body.stage === 'final' && compiled.graph.research_config.mode === 'conditional') contracts.fail('MODE_INVALID', 'Conditional scenarios apply assumptions and have no final-test holdout evaluation');
    const today = repo.clock().slice(0, 10), active = state.runs.filter(r => !terminal(r.status));
    if (state.runs.length >= contracts.LIMITS.runs || state.runs.filter(r => r.created_at.startsWith(today)).length >= contracts.LIMITS.daily_runs || active.length >= contracts.LIMITS.active_runs) contracts.fail('RESOURCE_LIMIT', 'Research run, daily or concurrency quota reached');
    const trials = state.runs.filter(r => r.family_id === exp.family_id && !r.replay_of).length;
    const budget = Math.min(compiled.evaluation_plan.max_trials, ...state.experiments.filter(e => e.family_id === exp.family_id).map(e => e.trial_budget || compiled.evaluation_plan.max_trials));
    if (!replay && trials >= budget) contracts.fail('TRIAL_BUDGET_EXCEEDED', 'Preregistered trial budget exhausted, including failed/canceled runs');
    const final = body.stage === 'final', priorExposure = state.exposures.some(x => exposureOverlaps(x, compiled.evaluation_plan));
    if (!replay) compiled = { ...compiled, trial_count_at_registration: trials + 1 };
    const id = opaqueId('run'), manifest = await repo.putObject('manifests', compiled);
    const run = { id, experiment_id: exp.id, family_id: exp.family_id, revision: rev.number, stage: body.stage,
      status: 'CREATED', created_at: repo.clock(), manifest, snapshot_id: compiled.snapshot_ids[0], graph_sha256: compiled.graph_sha256,
      plan_sha256: compiled.evaluation_plan_sha256, history_class: compiled.history_class,
      replay_of: replay?.id || null, idempotency_key: body.idempotency_key, request_sha256: requestHash,
      cursor: 0, node_outputs: {}, attempts: [], compute_ms: 0, provider_requests: 0, ai_requests: 0,
      holdout_status: replay ? replay.holdout_status : priorExposure ? 'HOLDOUT_COMPROMISED' : final ? 'FIRST_REGISTERED_EVALUATION' : 'UNTOUCHED',
      selection_trial: trials + (replay ? 0 : 1), warnings: [...compiled.warnings] };
    state.runs.push(run);
    for (const status of ['CREATED', 'VALIDATED', 'QUEUED']) { run.status = status; repo.emit(state, 'RUN_' + status, { run_id: id }, id + '-' + status); }
    if (final && !replay) {
      // Queueing counts as exposure even if later canceled/failed, preventing retry selection.
      state.exposures.push({ run_id: id, graph_sha256: compiled.graph_sha256, plan_sha256: compiled.evaluation_plan_sha256,
        start: compiled.evaluation_plan.holdout[0], end: compiled.evaluation_plan.holdout[1], universe: compiled.evaluation_plan.universe, occurred_at: repo.clock() });
      repo.emit(state, 'HOLDOUT_ACCESSED', { run_id: id, prior_exposure: priorExposure });
      for (const other of state.experiments.filter(e => e.family_id === exp.family_id)) other.status = 'EXPLORATORY';
    }
    if (priorExposure) run.warnings.push('HOLDOUT_COMPROMISED: overlapping final dates/universe were already exposed. No independent validation claim.');
    return publicRun(run);
  });
}
export const terminal = status => ['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT'].includes(status);
export function publicRun(run) {
  const { node_outputs, manifest, claim, idempotency_key, request_sha256, ...safe } = run;
  return { ...safe, completed_nodes: Object.keys(node_outputs || {}), attempts: run.attempts.map(({ token, ...a }) => a),
    manifest_sha256: manifest.sha256, result_sha256: run.result?.sha256 || null, result: undefined };
}
export async function getRun(repo, id) {
  const state = await repo.read(), run = repo.find(state, 'runs', id), manifest = await repo.object(run.manifest);
  return { run: publicRun(run), manifest, result: run.status === 'SUCCEEDED' ? await repo.object(run.result) : null,
    nodes: manifest.graph.nodes.map(n => ({ id: n.id, type: n.type, completed: !!run.node_outputs[n.id] })) };
}
export async function cancelRun(repo, id) {
  return repo.transact(state => {
    const run = repo.find(state, 'runs', id);
    if (!terminal(run.status)) { run.status = 'CANCELED'; run.completed_at = repo.clock(); delete run.claim; repo.emit(state, 'RUN_CANCELED', { run_id: id }, id + '-terminal'); }
    return publicRun(run);
  });
}
export async function journal(repo) {
  const state = await repo.read();
  const references = new Map();
  function collect(value) { if (!value || typeof value !== 'object') return; if (typeof value.key === 'string' && Number.isInteger(value.bytes)) references.set(value.key, value.bytes); else for (const child of Object.values(value)) collect(child); }
  collect(state);
  return { experiments: state.experiments.map(({ revisions, ...e }) => ({ ...e, revision: revisions.length })),
    runs: state.runs.map(publicRun).reverse(), events: state.events.slice(-300), interpretations: state.interpretations,
    comparisons: state.comparisons, forward_observations: state.forward_observations,
    evidence: state.events.filter(e => e.type === 'SITE_EVIDENCE_CAPTURED').map(e => ({ id: e.payload.id, label: e.payload.label, captured_at: e.occurred_at })),
    quotas: { runs: state.runs.length, max_runs: contracts.LIMITS.runs, events: state.events.length },
    operations: { queued: state.runs.filter(r => r.status === 'QUEUED').length, running: state.runs.filter(r => r.status === 'RUNNING').length,
      failed: state.runs.filter(r => ['FAILED', 'TIMED_OUT'].includes(r.status)).length,
      ai_requests: 0, provider_requests: 0, compute_ms: state.runs.reduce((v, r) => v + r.compute_ms, 0),
      export_bytes: state.exports.reduce((v, e) => v + (e.bytes || 0), 0),
      referenced_bytes: [...references.values()].reduce((a, b) => a + b, 0), state_bytes: Buffer.byteLength(JSON.stringify(state)), artifact_count: references.size,
      import_rejections: state.events.filter(e => e.type === 'IMPORT_REJECTED').length } };
}
export async function compareRuns(repo, ids, title) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) contracts.fail('SCHEMA_INVALID', 'Select 2..4 distinct frozen runs');
  contracts.text(title, 160, 'comparison title');
  const state = await repo.read(), runs = ids.map(id => repo.find(state, 'runs', id));
  if (runs.some(r => r.status !== 'SUCCEEDED')) contracts.fail('COMPARISON_INVALID', 'Only successful immutable runs can be compared');
  const manifests = await Promise.all(runs.map(r => repo.object(r.manifest))), results = await Promise.all(runs.map(r => repo.object(r.result)));
  const first = manifests[0], firstResult = results[0];
  const semantics = m => ({ mode: m.graph.research_config.mode, target: m.evaluation_plan.target, horizon: m.evaluation_plan.horizon_sessions,
    currency: m.currency, calendar: m.calendar, adjustment: m.adjustment_policy, costs: m.evaluation_plan.costs,
    benchmark: m.evaluation_plan.benchmark, execution: m.evaluation_plan.execution, history_class: m.history_class });
  if (manifests.some(m => sha(semantics(m)) !== sha(semantics(first))) || results.some(r => r.kind !== 'descriptive_event_study' || r.stage !== firstResult.stage || sha(r.bounds) !== sha(firstResult.bounds))) contracts.fail('COMPARISON_INVALID', 'Targets, horizons, mode, stage, windows, PIT class, currency, adjustments and costs must match. Strategy curves/scenarios cannot be ranked as event studies.');
  const maps = results.map(r => new Map(r.rows.map(row => [row.asset + '|' + row.date, row])));
  const common = [...maps[0].keys()].filter(k => maps.every(m => m.has(k))).sort();
  if (!common.length) contracts.fail('COMPARISON_EMPTY', 'No common asset/session observations');
  if (common.some(k => maps.slice(1).some(m => Math.abs(m.get(k).gross_return - maps[0].get(k).gross_return) > 1e-12 || Math.abs(m.get(k).baseline_return - maps[0].get(k).baseline_return) > 1e-12))) contracts.fail('COMPARISON_INVALID', 'Common observations have different frozen outcomes or price revisions; recapture a shared snapshot');
  const comparisons = results.slice(1).map((result, i) => {
    const pairs = common.map(k => ({ date: maps[0].get(k).date, asset: maps[0].get(k).asset,
      delta: maps[i + 1].get(k).contribution - maps[0].get(k).contribution }));
    const overlap = common.filter(k => maps[0].get(k).selected && maps[i + 1].get(k).selected).length;
    return { baseline_run_id: ids[0], candidate_run_id: ids[i + 1], common_observations: common.length,
      mean_increment: mean(pairs.map(r => r.delta)), unit: 'decimal_return',
      uncertainty: clusteredInterval(pairs, 'delta', first.seed, first.evaluation_plan.bootstrap_samples, first.evaluation_plan.horizon_sessions + 1),
      signal_overlap: overlap, signal_correlation: correlation(common.map(k => Number(maps[0].get(k).selected)), common.map(k => Number(maps[i + 1].get(k).selected))),
      additional_events: common.filter(k => !maps[0].get(k).selected && maps[i + 1].get(k).selected).length,
      marginal_cost_per_observation: mean(common.map(k => (maps[i + 1].get(k).selected ? maps[i + 1].get(k).cost : 0) - (maps[0].get(k).selected ? maps[0].get(k).cost : 0))),
      excluded_baseline: maps[0].size - common.length, excluded_candidate: maps[i + 1].size - common.length,
      baseline_mean_net_return: mean(common.map(k => maps[0].get(k)).filter(r => r.selected).map(r => r.net_return)),
      candidate_mean_net_return: mean(common.map(k => maps[i + 1].get(k)).filter(r => r.selected).map(r => r.net_return)) };
  });
  const value = { schema: 'mingstreet.research-comparison.v2', id: opaqueId('cmp'), title, run_ids: ids,
    run_hashes: runs.map(r => r.result.sha256), plan_hashes: manifests.map(m => m.evaluation_plan_sha256),
    common_observations: common.length, dates: [common.map(k => maps[0].get(k).date).sort()[0], common.map(k => maps[0].get(k).date).sort().at(-1)],
    assets: [...new Set(common.map(k => maps[0].get(k).asset))], comparisons, status: 'INCONCLUSIVE',
    selection_policy: 'owner_selected_frozen_run_ids; includes failed-trial ledger separately',
    method: 'paired_asset_session_contribution_difference_v1; unselected observations contribute zero, not missing; no automatic winner',
    warnings: ['Common intersection only; unmatched observations excluded explicitly. Sector/factor adjustment unavailable.',
      'Intervals are approximate dependence-aware diagnostics; multiple-testing family remains visible.'], created_at: repo.clock() };
  const ref = await repo.putObject('comparisons', value);
  await repo.transact(s => { s.comparisons.push({ id: value.id, title, ref, run_ids: ids, created_at: value.created_at }); repo.emit(s, 'COMPARISON_SAVED', { comparison_id: value.id, run_ids: ids }); });
  return value;
}
export async function reviewEvidence(repo, body) {
  contracts.keys(body, ['experiment_id', 'run_id', 'status', 'reason'], 'review'); contracts.text(body.reason, 2000, 'review reason');
  const allowed = ['EXPLORATORY', 'CANDIDATE', 'VALIDATION_PENDING', 'PAPER_MONITORING', 'VALIDATED_WITHIN_TESTED_SCOPE', 'REJECTED', 'RETIRED'];
  if (!allowed.includes(body.status)) contracts.fail('SCHEMA_INVALID', 'Unknown evidence status');
  return repo.transact(async state => {
    const exp = repo.find(state, 'experiments', body.experiment_id), run = repo.find(state, 'runs', body.run_id);
    if (run.experiment_id !== exp.id) contracts.fail('NOT_FOUND', 'Run is not part of this experiment');
    if (!['EXPLORATORY', 'REJECTED', 'RETIRED'].includes(body.status)) {
      if (run.status !== 'SUCCEEDED' || run.history_class === 'EXPLORATORY_NON_PIT') contracts.fail('PIT_INELIGIBLE', 'Promotion requires successful, documented PIT evidence');
      const result = await repo.object(run.result), summary = result.summary;
      const manifest = await repo.object(run.manifest);
      const retunedAfterInspection = state.events.some(e => e.type === 'HOLDOUT_COMPROMISED' && e.payload.exposed_run_ids?.includes(run.id) && e.payload.graph_sha256 !== run.graph_sha256);
      if (run.holdout_status === 'HOLDOUT_COMPROMISED' || retunedAfterInspection || state.exposures.some(e => e.run_id !== run.id && e.graph_sha256 !== run.graph_sha256 && exposureOverlaps(e, manifest.evaluation_plan))) contracts.fail('HOLDOUT_COMPROMISED', 'Final period has been exposed to other graph variants');
      if (result.kind !== 'descriptive_event_study' || summary.events < (await repo.object(run.manifest)).evaluation_plan.min_events || summary.uncertainty.low == null) contracts.fail('VALIDATION_INCOMPLETE', 'Baseline/sample/uncertainty evidence is incomplete');
      if (['PAPER_MONITORING', 'VALIDATED_WITHIN_TESTED_SCOPE'].includes(body.status) && run.stage !== 'final') contracts.fail('VALIDATION_INCOMPLETE', 'A registered final evaluation is required');
      if (body.status === 'VALIDATED_WITHIN_TESTED_SCOPE') contracts.fail('PROSPECTIVE_EVIDENCE_REQUIRED', 'Independent prospective observations, factor controls and audit are required; historical thresholds alone cannot validate an edge');
    }
    exp.status = body.status; repo.emit(state, 'HUMAN_EVIDENCE_REVIEW', { ...body, reviewer_hash: repo.ownerHash }); return { status: exp.status };
  });
}

export async function forwardObservation(repo, body) {
  contracts.keys(body, ['run_id', 'asset', 'target_date', 'predicted_return', 'observation_id', 'snapshot_id'], 'prospective observation');
  return repo.transact(async state => {
    if (body.observation_id) {
      const prior = state.forward_observations.find(o => o.id === body.observation_id);
      if (!prior) contracts.fail('NOT_FOUND', 'Prospective observation not found');
      if (prior.realized) return prior;
      if (repo.clock().slice(0, 10) <= prior.target_date) contracts.fail('NOT_YET_MATURE', 'Wait until the target session has completed');
      const snapshot = await getSnapshot(repo, state, body.snapshot_id), bar = snapshot.assets[prior.asset]?.bars.find(b => b.date === prior.target_date);
      if (!bar || snapshot.captured_at.slice(0, 10) < prior.target_date) contracts.fail('DATA_UNAVAILABLE', 'Capture a snapshot containing the exact target session');
      const realized = { snapshot_id: snapshot.id, realized_return: bar.close / prior.start_price - 1, recorded_at: repo.clock() };
      prior.realized = { ...realized, deviation: realized.realized_return - prior.predicted_return };
      repo.emit(state, 'FORWARD_REALIZED', { observation_id: prior.id, ...prior.realized }); return prior;
    }
    const run = repo.find(state, 'runs', body.run_id), manifest = await repo.object(run.manifest);
    if (run.status !== 'SUCCEEDED' || !manifest.evaluation_plan.universe.includes(body.asset) || !Number.isFinite(body.predicted_return) || Math.abs(body.predicted_return) > 10 || !/^\d{4}-\d\d-\d\d$/.test(body.target_date || '') || body.target_date <= repo.clock().slice(0, 10)) contracts.fail('SCHEMA_INVALID', 'Use a successful run, its asset, a future target date and a finite return');
    const snapshot = await getSnapshot(repo, state, body.snapshot_id), bar = snapshot.assets[body.asset]?.bars.at(-1);
    if (!bar || Date.parse(repo.clock()) - Date.parse(bar.date + 'T21:15:00Z') > 4 * 86400000) contracts.fail('STALE_INPUT', 'A recently captured completed-session price is required');
    if (state.forward_observations.length >= 300) contracts.fail('RETENTION_LIMIT', 'Prospective observation ceiling reached');
    const observation = { id: opaqueId('obs'), run_id: run.id, asset: body.asset, target_date: body.target_date, predicted_return: body.predicted_return,
      prediction_source: 'owner_manual_assumption_not_calibrated_probability', published_at: repo.clock(), start_price: bar.close,
      start_date: bar.date, snapshot_id: snapshot.id, realized: null };
    state.forward_observations.push(observation); repo.emit(state, 'FORWARD_FROZEN', observation); return observation;
  });
}

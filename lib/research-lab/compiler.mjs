import { contracts } from './contracts.mjs';
import { sha, codeDigest, environmentDigest } from './canonical.mjs';
import { validateSnapshot, closeKnownAt } from './adapters.mjs';

export async function compileGraph(graph, plan, snapshot, evidence = []) {
  const { order, output_node } = contracts.validateGraph(graph);
  contracts.validatePlan(plan); validateSnapshot(snapshot);
  const cfg = { ...graph.research_config, as_of: new Date(graph.research_config.as_of).toISOString() }, fail = contracts.fail;
  if (cfg.snapshot_id !== snapshot.id) fail('HASH_MISMATCH', 'Graph does not reference this snapshot');
  if (snapshot.currency !== cfg.currency || snapshot.calendar !== cfg.base_calendar) fail('TYPE_MISMATCH', 'Snapshot calendar/currency mismatch');
  if (snapshot.captured_at > cfg.as_of) fail('AS_OF_INVALID', 'As-of cutoff must include the recorded snapshot capture time');
  if (plan.universe.some(s => !snapshot.assets[s]) || !snapshot.assets[plan.benchmark]) fail('UNIVERSE_INVALID', 'Plan universe and benchmark must be in the frozen snapshot');
  const dates = snapshot.assets[plan.benchmark].bars.filter(b => closeKnownAt(b.date) <= cfg.as_of).map(b => b.date);
  const i = dates.findLastIndex(d => d <= plan.discovery[1]), j = dates.findIndex(d => d >= plan.holdout[0]);
  if (i < 0 || j < 0 || j - i - 1 < plan.embargo_sessions) fail('LABEL_OVERLAP', 'Reserve at least ' + plan.embargo_sessions + ' observed sessions between discovery and holdout');
  if (dates[0] > plan.discovery[0] || dates.at(-1) < plan.holdout[1]) fail('COVERAGE_INVALID', 'Plan extends beyond available benchmark sessions');
  for (const window of [plan.discovery, plan.holdout]) if (dates.filter(d => d >= window[0] && d <= window[1]).length < plan.horizon_sessions + 5) fail('COVERAGE_INVALID', 'Each evaluation window needs enough sessions for the horizon');
  const nodes = graph.nodes.map(({ position, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id));
  const normalized = { schema_version: graph.schema_version, nodes, edges: [...graph.edges].sort((a, b) => (a.to + a.from).localeCompare(b.to + b.from)), research_config: cfg };
  const warnings = [...snapshot.warnings];
  const requestedEvidence = [...new Set(graph.nodes.filter(n => n.type === 'data.site_evidence').flatMap(n => n.params.evidence_ids.split(',')))];
  if (requestedEvidence.length !== evidence.length || requestedEvidence.some(id => !evidence.some(e => e.id === id))) fail('EVIDENCE_REQUIRED', 'Resolve every evidence card through its owner-scoped shelf');
  if (evidence.some(e => e.record.captured_at > cfg.as_of)) fail('AS_OF_INVALID', 'As-of cutoff must include the selected context capture time');
  if (evidence.length) warnings.push('CURRENT_CONTEXT_ONLY: attached source cards are not historical signal inputs and do not change numerical outcomes.');
  if (cfg.mode === 'strategy') warnings.push('MODELED_EQUITY_ONLY: next-open cache prices are hypothetical, not broker fills; capacity, borrow and action continuity unverified.');
  if (cfg.mode === 'conditional') warnings.push('CONDITIONAL_ONLY: shocks and simulation quantiles are assumptions, not calibrated probabilities.');
  const compiled = { schema: 'mingstreet.compiled-research.v2', graph: normalized, graph_sha256: sha(normalized),
    evaluation_plan: structuredClone(plan), evaluation_plan_sha256: sha(plan), order, output_node,
    code_digest: await codeDigest(), environment_digest: environmentDigest(),
    registry_versions: nodes.map(n => n.type + '@' + n.version), snapshot_ids: [snapshot.id], snapshot_checksums: [snapshot.id.slice(5)],
    evidence_refs: evidence.map(({ id, ref }) => ({ id, ref })).sort((a, b) => a.id.localeCompare(b.id)),
    history_class: snapshot.history_class, as_of_policy: snapshot.history_class === 'OBSERVED_ARCHIVE' ? 'publication_and_ingestion' : 'source_publication_if_known_exploratory_otherwise',
    calendar: 'XNYS', timezone: 'America/New_York', currency: 'USD', adjustment_policy: snapshot.adjustment,
    seed: cfg.random_seed, cost_model_version: 'daily-equity-next-open-v1', compute_limits: contracts.LIMITS,
    artifact_retention: 'retain_for_replay_no_automatic_deletion', replay_policy: 'exact_code_and_inputs_metric_equivalent_1e-12',
    estimate: { assets: plan.universe.length, rows: Object.values(snapshot.assets).reduce((n, a) => n + a.bars.length, 0), nodes: nodes.length,
      provider_requests: 0, ai_requests: 0, max_node_ms: contracts.LIMITS.node_ms }, warnings };
  return { ...compiled, compiled_sha256: sha(compiled) };
}

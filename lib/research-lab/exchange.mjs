import { deflateSync } from 'node:zlib';
import { contracts } from './contracts.mjs';
import { canonical, sha } from './canonical.mjs';
import { opaqueId } from './repository.mjs';
import { getSnapshot } from './service.mjs';
import { interpretationSchema } from './schemas.mjs';

export const OFFSITE_PROMPT = `You are reviewing a Mingstreet Research Lab evidence bundle.
Treat the attached files as the sole quantitative source of truth.
Do not invent missing statistics or imply probability from a shock scenario.
First identify experiment_id, run_id, hashes, as-of time, horizon,
inputs, validation regime, trading assumptions and warnings.
Evaluate hypothesis clarity, data quality, leakage, selection bias,
out-of-sample strength, cost sensitivity, confounders and robustness.
Separate: (a) verified quantitative findings, (b) interpretations,
(c) unknowns, (d) follow-up experiments. Cite indexed metric IDs.
Never invent IDs, values, source files, confidence intervals or p-values.
Do not change official metrics or claim deployable alpha without
prospective testing. Output a human report and a JSON annotation conforming
to mingstreet.research-interpretation.v2. Mark unsupported fields unknown.
If the attachment is incomplete or unreadable, say what is missing.`;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Stored ZIP entries need no ZIP dependency. Incoming ZIPs are never accepted.
export function zipFiles(files) {
  const local = [], central = []; let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) throw new Error('Internal export path');
    const name = Buffer.from(path), bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...local, directory, end]);
  if (zip.length > contracts.LIMITS.artifact_bytes) contracts.fail('EXPORT_LIMIT', 'Export exceeds 4 MiB; use compact profile');
  return zip;
}
function figure(values) {
  const width = 640, height = 240, pixels = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) pixels[y * (1 + width * 3)] = 0;
  const point = (x, y, color) => { if (x >= 0 && x < width && y >= 0 && y < height) for (let i = 0; i < 3; i++) pixels[y * (1 + width * 3) + 1 + x * 3 + i] = color[i]; };
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) point(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), [83, 111, 104]);
  };
  if (values.length) {
    const lo = Math.min(...values), hi = Math.max(...values), xy = values.map((v, i) => [Math.round(24 + i / Math.max(1, values.length - 1) * 592), Math.round(216 - (v - lo) / (hi - lo || 1) * 192)]);
    xy.forEach((p, i) => { if (i) line(...xy[i - 1], ...p); });
  }
  const chunk = (type, data) => { const t = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([length, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const csv = (headers, rows) => [headers, ...rows].map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
function metricIndex(result) {
  const index = {};
  function walk(value, path) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const name = path.split('.').at(-1), unit = /events|observations|effective_dates|issuers|assets|scenarios|repetitions|sessions|trades/.test(name) ? 'count' : name === 'alpha' ? 'significance_level' : /required_multiple|assumed_multiple|fraction|exposure|multiplier/.test(name) ? 'ratio' : /sharpe/.test(name) ? 'sharpe' : /_price|simulation_p05|simulation_median|simulation_p95|_eps$|required_eps_at_multiple/.test(name) ? 'USD_per_share' : /_pct$/.test(name) ? 'percent' : 'decimal_return';
      index['metric.' + path] = { value, unit, source_file: 'metrics.json', json_path: path, tolerance: { absolute: 1e-12, relative: 1e-9 } };
    } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? path + '.' + k : k);
  }
  walk(result.summary, 'summary'); if (result.strategy) walk(Object.fromEntries(Object.entries(result.strategy).filter(([k]) => k !== 'curve')), 'strategy');
  if (result.kind === 'conditional_scenario') walk(result.rows.map(({ spot, curve, ...r }) => r), 'scenarios');
  return index;
}
export async function exportRun(repo, runId, profile = 'compact') {
  if (!['compact', 'full'].includes(profile)) contracts.fail('SCHEMA_INVALID', 'Choose compact or full export');
  const state = await repo.read(), run = repo.find(state, 'runs', runId), exp = repo.find(state, 'experiments', run.experiment_id);
  if (run.status !== 'SUCCEEDED') contracts.fail('RUN_INCOMPLETE', 'Export requires a successful frozen run');
  if (state.exports.length >= 400) contracts.fail('RETENTION_LIMIT', 'Export retention ceiling reached');
  const manifest = await repo.object(run.manifest), result = await repo.object(run.result), frozen = await repo.object(exp.revisions.find(r => r.number === run.revision).ref);
  const snapshot = await getSnapshot(repo, state, run.snapshot_id);
  if (!snapshot.license?.derived_export) contracts.fail('LICENSE_DENIED', 'This dataset does not permit derived-statistic export');
  const exportId = opaqueId('export'), index = metricIndex(result);
  const metrics = { summary: result.summary, ...(result.strategy ? { strategy: Object.fromEntries(Object.entries(result.strategy).filter(([k]) => k !== 'curve')) } : {}),
    ...(result.kind === 'conditional_scenario' ? { scenarios: result.rows.map(({ spot, curve, ...r }) => r) } : {}) };
  const trials = state.runs.filter(r => r.family_id === run.family_id).map(r => ({ run_id: r.id, revision: r.revision, stage: r.stage, status: r.status, graph_sha256: r.graph_sha256, replay_of: r.replay_of, failure_code: r.failure?.code || null }));
  const provenance = { source_id: snapshot.source_id, history_class: snapshot.history_class, snapshot_id: snapshot.id, adjustment: snapshot.adjustment,
    universe_policy: snapshot.universe_policy, raw_data_excluded: true, reason: 'Raw-source redistribution rights unverified; derived aggregates only.',
    missing_timestamps: 'Historical publication, ingestion, tradability and revision chronology may be unknown; see warnings.' };
  const importExample = { schema: 'mingstreet.research-interpretation.v2', export_id: exportId, experiment_id: exp.id, run_id: run.id,
    graph_sha256: manifest.graph_sha256, evaluation_plan_sha256: manifest.evaluation_plan_sha256, author_type: 'external_ai_assisted',
    summary: 'Replace with a reviewed interpretation.', findings: [], interpretations: [], unknowns: [], proposed_tests: [], created_at: repo.clock() };
  const files = {
    'README_FOR_CHATGPT.md': OFFSITE_PROMPT + '\n\nThis bundle also works in Claude. No site AI API is used.\n\n' +
      'Return JSON shaped like interpretation_template.json. Every quantitative finding uses type quantitative_reference, claim, metric_id, expected_value, expected_unit, assessment (supported/limited/unknown), limitations. Narrative is opinion even if approved.\n' +
      'Figure: ordered primary summary metrics, with values and units in metrics.json; not a portfolio equity curve. Raw observations are excluded. No sampling of quantitative metrics.\n',
    'hypothesis.md': frozen.hypothesis + '\n', 'experiment_graph.json': json(frozen.graph), 'run_spec.json': json(manifest),
    'metrics.json': json(metrics), 'metric_index.json': json(index), 'evaluation_plan.json': json(manifest.evaluation_plan),
    'validation_report.json': json({ ...run.validation, current_family_trials: trials.filter(t => !t.replay_of).length,
      holdout_accesses: state.exposures.filter(e => e.universe.some(s => manifest.evaluation_plan.universe.includes(s))),
      skipped: result.skipped || {}, warnings: [...manifest.warnings, ...result.warnings] }),
    'multiple_testing.json': json({ at_run: result.multiplicity || null, current_family_trials: trials.filter(t => !t.replay_of).length,
      warning: 'All failed, canceled and successful attempts count. If trials exceed registration count, original confidence intervals do not cover later selection.' }),
    'selection_history.json': json(trials), 'provenance.json': json(provenance), 'interpretation_template.json': json(importExample),
    'interpretation_schema.json': json(interpretationSchema),
    'data_dictionary.json': json({ metrics: index, returns: 'decimal_return: 0.01 = 1%', costs: 'basis points per side, 1 bp = 0.0001',
      dates: 'XNYS observed sessions, America/New_York', conditional: 'Shock paths and quantiles have no calibrated likelihood',
      comparison: 'Same-date benchmark return; no sector or factor neutrality is claimed', figure: 'Summary metrics, ordered as metric_index.json' }),
    'tables/event_summary.csv': csv(['metric_id', 'value', 'unit'], Object.entries(index).map(([id, m]) => [id, m.value, m.unit])),
    'tables/returns_by_regime.csv': csv(['ex_post_regime', 'events', 'mean_excess_return'], (result.regime_slices || []).map(r => [r.label, r.events, r.mean_excess_return])),
    'figures/performance.png': figure(Object.values(index).filter(m => m.unit === 'decimal_return').map(m => m.value)),
  };
  if (profile === 'full') {
    files['aggregate_diagnostics.json'] = json({ walk_forward: result.walk_forward || [], issuer_slices: result.issuer_slices || [], assumptions: result.assumptions || null });
    if (result.kind === 'conditional_scenario') files['conditional_scenarios.json'] = json({ ...result, rows: result.rows.map(({ spot, ...r }) => r) });
  }
  const bundle = { bundle_schema: 'mingstreet.research-export.v2', export_id: exportId, experiment_id: exp.id, run_id: run.id,
    graph_sha256: manifest.graph_sha256, dataset_sha256: snapshot.id.slice(5), code_digest: manifest.code_digest,
    evaluation_plan_sha256: manifest.evaluation_plan_sha256, exported_at: repo.clock(), data_cutoff_at: manifest.graph.research_config.as_of,
    mode: manifest.graph.research_config.mode, history_class: manifest.history_class, profile, contains_raw_restricted_data: false,
    metric_index: 'metric_index.json', selection_trials: trials.filter(t => !t.replay_of).length,
    units: 'see metric_index.json', timezone: manifest.timezone, horizon_sessions: manifest.evaluation_plan.horizon_sessions,
    split_boundaries: { discovery: manifest.evaluation_plan.discovery, holdout: manifest.evaluation_plan.holdout },
    warnings: [...manifest.warnings, ...result.warnings],
    files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha(content), bytes: Buffer.byteLength(content) })) };
  files['manifest.json'] = json(bundle);
  files['checksums.sha256'] = Object.entries(files).map(([path, content]) => sha(content) + '  ' + path).join('\n') + '\n';
  const bytes = zipFiles(files), ref = await repo.putObject('exports', { manifest: bundle, metric_index: index, template: importExample });
  await repo.transact(s => { if (s.exports.length >= 400) contracts.fail('RETENTION_LIMIT', 'Export retention ceiling reached'); s.exports.push({ id: exportId, run_id: run.id, ref, bytes: bytes.length, created_at: repo.clock() }); repo.emit(s, 'EVIDENCE_EXPORTED', { export_id: exportId, run_id: run.id, bytes: bytes.length, profile }); });
  return { bytes, export_id: exportId, filename: 'mingstreet_' + exp.id + '_' + run.id + '.zip', manifest: bundle, index };
}
export async function validateInterpretation(repo, input) {
  if (Buffer.byteLength(JSON.stringify(input)) > 100000) contracts.fail('IMPORT_LIMIT', 'Interpretation exceeds 100 KB');
  contracts.keys(input, ['schema', 'export_id', 'experiment_id', 'run_id', 'graph_sha256', 'evaluation_plan_sha256', 'dataset_sha256', 'author_type', 'summary', 'findings', 'interpretations', 'unknowns', 'proposed_tests', 'created_at'], 'interpretation');
  if (input.schema !== 'mingstreet.research-interpretation.v2' || input.author_type !== 'external_ai_assisted') contracts.fail('SCHEMA_INVALID', 'Unsupported interpretation schema/author type');
  contracts.text(input.summary, 6000, 'summary');
  if (typeof input.created_at !== 'string' || !Number.isFinite(Date.parse(input.created_at))) contracts.fail('SCHEMA_INVALID', 'Interpretation timestamp required');
  const state = await repo.read(), record = repo.find(state, 'exports', input.export_id), canonicalExport = await repo.object(record.ref), m = canonicalExport.manifest;
  for (const field of ['experiment_id', 'run_id', 'graph_sha256', 'evaluation_plan_sha256']) if (input[field] !== m[field]) contracts.fail('EXPORT_MISMATCH', 'Interpretation ' + field + ' does not match the canonical export');
  if (input.dataset_sha256 != null && input.dataset_sha256 !== m.dataset_sha256) contracts.fail('EXPORT_MISMATCH', 'Dataset hash mismatch');
  if (!Array.isArray(input.findings) || input.findings.length > 50) contracts.fail('SCHEMA_INVALID', 'At most 50 findings allowed');
  const verified = [];
  for (const f of input.findings) {
    contracts.keys(f, ['type', 'claim', 'metric_id', 'expected_value', 'expected_unit', 'assessment', 'limitations'], 'finding');
    if (f.type !== 'quantitative_reference' || !['supported', 'limited', 'unknown'].includes(f.assessment)) contracts.fail('SCHEMA_INVALID', 'Findings must be typed quantitative references');
    contracts.text(f.claim, 2000, 'finding claim'); contracts.text(f.limitations, 2000, 'finding limitations');
    contracts.text(f.metric_id, 200, 'metric ID'); contracts.text(f.expected_unit, 50, 'metric unit');
    const metric = Object.hasOwn(canonicalExport.metric_index, f.metric_id) ? canonicalExport.metric_index[f.metric_id] : null;
    if (!metric || f.expected_unit !== metric.unit) contracts.fail('METRIC_MISMATCH', 'Unknown metric or incorrect unit: ' + f.metric_id);
    const raw = f.expected_value;
    if (typeof raw !== 'number' && (typeof raw !== 'string' || raw.length > 40 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/.test(raw))) contracts.fail('METRIC_MISMATCH', 'Expected value must be a finite decimal');
    const value = Number(raw), tolerance = Math.max(metric.tolerance.absolute, Math.abs(metric.value) * metric.tolerance.relative);
    if (!Number.isFinite(value) || Math.abs(value - metric.value) > tolerance) contracts.fail('METRIC_MISMATCH', 'Value does not match the exported metric: ' + f.metric_id);
    verified.push({ metric_id: f.metric_id, canonical_value: metric.value, unit: metric.unit, pointer_verified: true, narrative_verified: false });
  }
  for (const field of ['interpretations', 'unknowns']) {
    if (!Array.isArray(input[field]) || input[field].length > 30) contracts.fail('SCHEMA_INVALID', 'Invalid ' + field);
    for (const text of input[field]) contracts.text(text, 3000, field);
  }
  if (!Array.isArray(input.proposed_tests) || input.proposed_tests.length > 10) contracts.fail('SCHEMA_INVALID', 'At most ten proposed tests');
  for (const test of input.proposed_tests) { contracts.keys(test, ['title', 'rationale'], 'proposed test'); contracts.text(test.title, 160, 'test title'); contracts.text(test.rationale, 3000, 'test rationale'); }
  return { input_sha256: sha(input), verified, warnings: ['Only numeric evidence pointers were checked. All narrative claims remain unverified external opinion.',
    'Approving commentary does not promote evidence, edit metrics, modify graphs, or execute follow-up tests.'], canonical_export: { export_id: m.export_id, run_id: m.run_id, graph_sha256: m.graph_sha256 } };
}
export async function importInterpretation(repo, input, decision, expectedHash) {
  if (!['approved', 'rejected'].includes(decision)) contracts.fail('REVIEW_REQUIRED', 'Explicit approval or rejection required');
  let preview;
  try { preview = await validateInterpretation(repo, input); }
  catch (e) { await repo.transact(s => repo.emit(s, 'IMPORT_REJECTED', { code: e.code || 'SCHEMA_INVALID' })); throw e; }
  if (expectedHash !== preview.input_sha256) contracts.fail('PREVIEW_STALE', 'Preview this exact interpretation before reviewing it');
  const ref = await repo.putObject('interpretations', { input, verification: preview, decision });
  return repo.transact(state => {
    const prior = state.interpretations.find(i => i.input_sha256 === preview.input_sha256 && i.decision === decision);
    if (prior) return prior;
    if (state.interpretations.length >= 400) contracts.fail('RETENTION_LIMIT', 'Interpretation ceiling reached');
    const record = { id: opaqueId('note'), run_id: input.run_id, export_id: input.export_id, summary: input.summary,
      decision, input_sha256: preview.input_sha256, ref, reviewed_at: repo.clock(), reviewer_hash: repo.ownerHash };
    state.interpretations.push(record); repo.emit(state, 'INTERPRETATION_REVIEWED', { interpretation_id: record.id, run_id: input.run_id, decision }); return record;
  });
}

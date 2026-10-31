import { getSession } from '../session.mjs';
import { researchLabEnabled } from './access.mjs';
import { contracts } from './contracts.mjs';
import { createLabRepository } from './repository.mjs';
import * as service from './service.mjs';
import { advanceRun } from './worker.mjs';
import { exportRun, validateInterpretation, importInterpretation } from './exchange.mjs';
import { sourceCatalog, captureEvidence } from './evidence.mjs';

function sameOrigin(req) {
  const origin = req.headers?.origin, site = req.headers?.['sec-fetch-site'];
  if (!origin) return site === 'same-origin';
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return new URL(origin).origin === new URL(proto + '://' + host).origin;
  } catch { return false; }
}
export async function handleResearchRequest(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const env = dependencies.env || process.env, session = await (dependencies.getSession || getSession)(req).catch(() => null);
  if (!researchLabEnabled(session, env)) return res.status(env.RESEARCH_LAB_ENABLED === '1' && env.PRIVATE_DATA_ENABLED === '1' ? 403 : 404).json({ error: 'Research Lab is unavailable for this session' });
  if (req.query.data != null || typeof req.query.lab !== 'string') return res.status(400).json({ error: 'Ambiguous research request' });
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'Same-origin request required' });
  const action = req.query.lab;
  const reads = ['blocks', 'sources', 'evidence', 'journal', 'experiment', 'run', 'node', 'comparison', 'interpretation', 'export-index'];
  const writes = ['source-capture', 'snapshot', 'compile', 'save', 'queue', 'advance', 'cancel', 'compare', 'export', 'validate-import', 'import', 'review', 'forward'];
  if (!(req.method === 'GET' ? reads : writes).includes(action)) return res.status(405).json({ error: 'Unknown action or incorrect method' });
  try {
    const body = req.body ?? {};
    if (req.method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > contracts.LIMITS.body_bytes)) contracts.fail('RESOURCE_LIMIT', 'Research request exceeds the JSON limit');
    if (action === 'blocks') return res.status(200).json({ blocks: contracts.blocks, limits: contracts.LIMITS, ai_requests: 0, provider_requests: 0 });
    if (action === 'sources') return res.status(200).json({ sources: sourceCatalog() });
    const store = dependencies.store || (await import('../datastore.mjs')).store;
    if (store.backend !== 'r2') contracts.fail('DURABLE_STORE_REQUIRED', 'R2 conditional-write storage is required');
    const repo = createLabRepository({ store, owner: session.sub, clock: dependencies.clock });
    let output;
    if (action === 'source-capture') { contracts.keys(body, ['source_id'], 'source capture'); output = await captureEvidence(repo, store, body.source_id); }
    if (action === 'evidence') { const s = await repo.read(), record = s.events.find(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.id === req.query.id); if (!record) contracts.fail('NOT_FOUND', 'Evidence not found'); output = await repo.object(record.payload.ref); }
    if (action === 'journal') output = await service.journal(repo);
    if (action === 'snapshot') { contracts.keys(body, ['symbols'], 'snapshot request'); output = await service.capture(repo, store, body.symbols); }
    if (action === 'compile') { contracts.keys(body, ['graph', 'plan'], 'compile request'); output = await service.previewCompile(repo, body.graph, body.plan); }
    if (action === 'save') output = await service.saveExperiment(repo, body);
    if (action === 'queue') output = await service.queueRun(repo, body);
    if (action === 'run') output = await service.getRun(repo, req.query.id);
    if (action === 'experiment') {
      const state = await repo.read(), exp = repo.find(state, 'experiments', req.query.id);
      const revision = req.query.revision == null ? exp.revisions.at(-1) : exp.revisions.find(r => r.number === Number(req.query.revision));
      if (!revision) contracts.fail('NOT_FOUND', 'Revision not found');
      const frozen = await repo.object(revision.ref);
      const { snapshotSummary } = await import('./adapters.mjs');
      output = { experiment: exp, revision: revision.number, ...frozen,
        evidence: await Promise.all((frozen.compiled.evidence_refs || []).map(e => repo.object(e.ref))),
        snapshot_summary: snapshotSummary(await service.getSnapshot(repo, state, frozen.graph.research_config.snapshot_id)) };
    }
    if (action === 'advance' || action === 'cancel') {
      contracts.keys(body, ['run_id'], action + ' request');
      output = action === 'advance' ? await advanceRun(repo, body.run_id) : await service.cancelRun(repo, body.run_id);
    }
    if (action === 'node') {
      const s = await repo.read(), run = repo.find(s, 'runs', req.query.id);
      const ref = run.node_outputs[req.query.node];
      if (!ref || run.status !== 'SUCCEEDED') contracts.fail('RUN_INCOMPLETE', 'Node artifacts are inspectable after the complete run succeeds');
      output = { node_id: req.query.node, checksum: ref.sha256, bytes: ref.bytes, output: await repo.object(ref) };
    }
    if (action === 'compare') { contracts.keys(body, ['run_ids', 'title'], 'comparison'); output = await service.compareRuns(repo, body.run_ids, body.title); }
    if (action === 'comparison' || action === 'interpretation') {
      const state = await repo.read(), record = repo.find(state, action === 'comparison' ? 'comparisons' : 'interpretations', req.query.id); output = await repo.object(record.ref);
    }
    if (action === 'export-index') { const state = await repo.read(), record = repo.find(state, 'exports', req.query.id); output = await repo.object(record.ref); }
    if (action === 'export') {
      contracts.keys(body, ['run_id', 'profile'], 'export'); const out = await exportRun(repo, body.run_id, body.profile);
      res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="' + out.filename + '"');
      res.setHeader('X-Research-Export-Id', out.export_id); return res.status(200).end(out.bytes);
    }
    if (action === 'validate-import') {
      contracts.keys(body, ['interpretation'], 'import preview');
      try { output = await validateInterpretation(repo, body.interpretation); }
      catch (e) { await repo.transact(s => repo.emit(s, 'IMPORT_REJECTED', { code: e.code || 'SCHEMA_INVALID' })); throw e; }
    }
    if (action === 'import') {
      contracts.keys(body, ['interpretation', 'decision', 'preview_sha256'], 'import review');
      output = await importInterpretation(repo, body.interpretation, body.decision, body.preview_sha256);
    }
    if (action === 'review') output = await service.reviewEvidence(repo, body);
    if (action === 'forward') output = await service.forwardObservation(repo, body);
    return res.status(200).json(output);
  } catch (e) {
    const code = e.code || 'RESEARCH_UNAVAILABLE';
    const status = code === 'NOT_FOUND' ? 404 : ['BUSY', 'REVISION_CONFLICT', 'PREVIEW_STALE'].includes(code) ? 409 : /LIMIT|BUDGET/.test(code) ? 429 : code === 'DURABLE_STORE_REQUIRED' ? 503 : e.code ? 400 : 502;
    if (!e.code) console.error('Research Lab request failed', { action, message: String(e.message || e) });
    return res.status(status).json({ code, error: e.code ? e.message : 'Research Lab storage or computation is unavailable. Saved records are retained.' });
  }
}

import { contracts } from './contracts.mjs';
import { sha } from './canonical.mjs';
import { siteCatalog } from './site-catalog.mjs';

// Explicit read-only data adapters. No broker/account records, source articles,
// arbitrary keys, provider requests or historical availability inference.
export const SOURCE_KEYS = Object.freeze({
  'owner-market-brief': 'owner-market-brief.json', brief: 'briefs.json', news: 'news-feed.json',
  market: 'market-analysis.json', risk: 'market-analysis.json', 'unified-signal-engine': 'unified-signal.json',
  'bottom-tracker': 'bottom-tracker.json', 'historical-data': 'historical-data.json', 'party-tracker': 'party-tracker.json',
  'earnings-forecast': 'earnings-forecast.json', 'forced-liquidation': 'forced-liquidation.json', grade: 'grades.json',
  narratives: 'trends.json', picks: 'picks.json', leaps: 'leaps-picks.json', stocks: 'stock-picks.json',
  rotation: 'sector-rotation.json', levetf: 'leveraged-etfs.json', quant: 'quant.json',
  heatmap: 'heatmap.json', calendar: 'calendar.json', 'pending-buyouts': 'pending-buyouts.json', earnings: 'earnings-tracker.json',
  calls: 'earnings-calls.json', spillover: 'spillover-pairs.json', 'index-cal': 'index-calendar.json',
  'pattern-lab': 'pattern-recognition.json', 'ma-tracker': 'ma-tracker.json', flow: 'unusual.json',
  volume: 'volume-flags.json', oi: 'oi-tracker.json', 'iv-trend': 'iv-trending.json', streaks: 'streaks.json',
  f13: '13f.json', 'ai-capex': 'ai-capex.json',
  'ram-prices': 'ram-prices.json', 'accelerator-prices': 'accelerator-prices.json', 'central-bank-gold': 'central-bank-gold.json',
  'search-interest': 'search-interest.json', commodities: 'commodities.json', 'capital-raises': 'capital-raises.json',
});
const derivedFields = new Set(['symbol', 'ticker', 'sector', 'industry', 'score', 'total', 'status', 'verdict', 'state',
  'rsi', 'impliedCorr', 'direction', 'lean', 'tier', 'count', 'events', 'coverage', 'stale', 'date', 'asOf', 'builtAtIso',
  'changePct', 'retZ', 'z20', 'pxZ', 'ivZ', 'richZ', 'showZ', 'qualified', 'sameDays', 'days', 'color', 'fragile']);
export const sourceCatalog = () => siteCatalog.filter(s => s.id !== 'research-lab').map(s => ({ ...s,
  capture_supported: !!SOURCE_KEYS[s.id], source_key: SOURCE_KEYS[s.id] || null,
  policy: 'current_context_only_not_a_historical_signal' }));

export async function captureEvidence(repo, store, sourceId) {
  const descriptor = sourceCatalog().find(s => s.id === sourceId);
  if (!descriptor) contracts.fail('SOURCE_NOT_FOUND', 'Unknown site feature');
  const state = await repo.read();
  if (state.events.filter(e => e.type === 'SITE_EVIDENCE_CAPTURED').length >= 120) contracts.fail('RESOURCE_LIMIT', 'Evidence shelf retention limit reached');
  const key = SOURCE_KEYS[sourceId], raw = key ? await store.get(key) : null;
  if (key && raw == null) contracts.fail('DATA_UNAVAILABLE', 'No saved source data is available. Open the source page to inspect its coverage.');
  if (raw?.length > 8 * 1024 * 1024) contracts.fail('RESOURCE_LIMIT', 'Source exceeds the bounded evidence adapter size');
  let payload = null;
  if (raw) { try { payload = JSON.parse(raw.toString('utf8')); } catch { contracts.fail('SOURCE_INVALID', 'Source JSON is unreadable'); } }
  const facts = []; let visited = 0, truncated = false;
  function walk(value, path = '', depth = 0) {
    if (++visited > 1200 || facts.length >= 40 || depth > 6) { truncated = true; return; }
    if (value && typeof value === 'object') {
      const priority = ['macroRegime', 'regime', 'summary', 'current', 'scores', 'grades', 'decisions', 'signals', 'coverage', 'rows', 'companies'];
      const entries = Object.entries(value).sort(([a], [b]) => (priority.includes(a) ? priority.indexOf(a) : 100) - (priority.includes(b) ? priority.indexOf(b) : 100));
      for (const [k, v] of entries.slice(0, 24)) {
        if (/secret|token|password|credential|account|position|order|fill|customer|email/i.test(k)) continue;
        walk(v, path ? path + '.' + k : k, depth + 1);
      }
      if (entries.length > 24) truncated = true;
    } else if (derivedFields.has(path.split('.').at(-1)) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 120 && !/[<>]/.test(value))) facts.push({ path, value, unit: 'source_native_not_normalized' });
  }
  if (payload) walk(payload);
  const observations = facts.filter(f => !['date', 'asOf', 'builtAtIso'].includes(f.path.split('.').at(-1)));
  const sourceTime = payload?.builtAtIso || payload?.generatedAtIso || payload?.asOf || payload?.current?.builtAtIso || null;
  const asOf = typeof sourceTime === 'string' && Number.isFinite(Date.parse(sourceTime)) ? sourceTime : null;
  const sourceHash = raw ? sha(raw) : sha(descriptor), contentHash = sha({ sourceId, sourceHash, facts });
  const prior = state.events.find(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.content_sha256 === contentHash);
  if (prior) return repo.object(prior.payload.ref);
  const record = { schema: 'mingstreet.site-evidence.v1', id: 'ev_' + contentHash.slice(0, 32), source_id: sourceId, label: descriptor.label,
    category: descriptor.category, url: '/?tab=' + sourceId, captured_at: repo.clock(), source_as_of: asOf, source_sha256: sourceHash,
    content_sha256: contentHash, facts, truncated, source_key: key || null, history_class: 'EXPLORATORY_NON_PIT',
    warnings: ['Current source context only. It cannot become a historical signal, prove causality or override computed metrics.',
      'Selected derived fields only; raw quotes, articles, broker/account data and credentials are excluded.',
      ...(asOf ? Date.parse(asOf) > Date.parse(repo.clock()) ? ['FUTURE_SOURCE: source time is after capture.'] : Date.parse(repo.clock()) - Date.parse(asOf) > 96 * 3600000 ? ['STALE_SOURCE: source is over 96 hours old.'] : [] : ['UNDATED_SOURCE: no usable source timestamp.']),
      ...(!observations.length ? ['Reference only: no supported derived observations beyond metadata. Inspect the source page for the full information.'] : []),
      ...(truncated ? ['BOUNDED_SAMPLE: this card is a selected excerpt, not the entire source dataset.'] : [])] };
  const ref = await repo.putObject('site-evidence', record);
  await repo.transact(s => { if (!s.events.some(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.content_sha256 === contentHash)) repo.emit(s, 'SITE_EVIDENCE_CAPTURED', { id: record.id, content_sha256: contentHash, ref, label: record.label }); });
  return record;
}
export async function resolveEvidence(repo, state, graph) {
  const ids = [...new Set(graph.nodes.filter(n => n.type === 'data.site_evidence').flatMap(n => String(n.params.evidence_ids).split(',')))];
  if (ids.length > 12) contracts.fail('RESOURCE_LIMIT', 'Use at most 12 evidence cards per experiment');
  return Promise.all(ids.map(async id => {
    const entry = state.events.find(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.id === id);
    if (!entry) contracts.fail('NOT_FOUND', 'Evidence card is not owned by this account');
    return { id, ref: entry.payload.ref, record: await repo.object(entry.payload.ref) };
  }));
}

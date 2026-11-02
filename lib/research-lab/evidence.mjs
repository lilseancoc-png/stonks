import { contracts } from './contracts.mjs';
import { sha } from './canonical.mjs';
import { siteCatalog } from './site-catalog.mjs';
import { researchUniverse } from './universe.mjs';
import { projectSavedSource } from './source-projections.mjs';

// Explicit read-only data adapters. No broker/account records, source articles,
// arbitrary keys, provider requests or historical availability inference.
import { SOURCE_KEYS } from './feature-sources.mjs';
export { SOURCE_KEYS } from './feature-sources.mjs';

const derivedFields = new Set(['symbol', 'ticker', 'sector', 'industry', 'score', 'total', 'status', 'verdict', 'state',
  'rsi', 'impliedCorr', 'direction', 'lean', 'tier', 'count', 'events', 'coverage', 'stale', 'date', 'asOf', 'builtAtIso',
  'changePct', 'retZ', 'z20', 'pxZ', 'ivZ', 'richZ', 'showZ', 'qualified', 'sameDays', 'days', 'color', 'fragile',
  'sym', 'name', 'period', 'fiscal', 'revenue', 'revenueGrowth', 'revenueGrowthYoY', 'revYoy', 'eps', 'epsActual', 'epsEstimate',
  'surprisePct', 'guidance', 'profitMargins', 'netMargin', 'grossMargins', 'operatingMargins', 'trailingPE', 'forwardPE',
  'earningsGrowth', 'freeCashflow', 'totalRevenue', 'totalDebt', 'totalCash', 'capex', 'capexB', 'capexBn', 'capexYoyPct',
  'actual', 'estimate', 'unit', 'currency', 'median', 'medianUsdHr', 'p50', 'usdPerHour', 'priceUsdHour',
  'annPct', 'totalPct', 'years', 'sessions', 'start', 'end', 'firstDate', 'lastDate', 'president', 'house', 'senate', 'party',
  'sentiment', 'strength', 'confidence', 'hypeScore', 'rate', 'yield', 'tenYear', 'fedFunds', 'pct', 'yoyPct']);
export const sourceCatalog = () => siteCatalog.filter(s => s.id !== 'research-lab' && s.category !== 'Sports').map(s => ({ ...s,
  capture_supported: !!SOURCE_KEYS[s.id], source_key: SOURCE_KEYS[s.id] || null,
  policy: 'current_context_only_not_a_historical_signal' }));

export async function captureEvidence(repo, store, sourceId, symbol = '', controls = null) {
  if (symbol && !researchUniverse.includes(symbol)) contracts.fail('SYMBOL_INVALID', 'Choose a stock or ETF in the site universe.');
  if (controls !== null) {
    contracts.keys(controls, ['president', 'house', 'senate'], 'government control');
    if (sourceId !== 'party-tracker' || symbol || !['president', 'house', 'senate'].every(k => ['D', 'R', 'any'].includes(controls[k]))) contracts.fail('PARAM_INVALID', 'Choose the president, House and Senate control for the Party tracker.');
  }
  const descriptor = sourceId === 'company' ? { id: 'company', label: symbol + ' company snapshot', category: 'Stocks' } : sourceCatalog().find(s => s.id === sourceId);
  if (!descriptor) contracts.fail('SOURCE_NOT_FOUND', 'Unknown site feature');
  if (sourceId === 'company' && !symbol) contracts.fail('SYMBOL_INVALID', 'Choose a company first.');
  const state = await repo.read();
  const key = sourceId === 'company' ? symbol + '.json' : SOURCE_KEYS[sourceId], raw = key ? await store.get(key) : null;
  if (key && raw == null) contracts.fail('DATA_UNAVAILABLE', 'No saved source data is available. Open the source page to inspect its coverage.');
  if (raw?.length > 8 * 1024 * 1024) contracts.fail('RESOURCE_LIMIT', 'Source exceeds the bounded evidence adapter size');
  let payload = null;
  if (raw) { try { payload = JSON.parse(raw.toString('utf8')); } catch { contracts.fail('SOURCE_INVALID', 'Source JSON is unreadable'); } }
  const facts = [], projection = payload && !controls ? projectSavedSource(sourceId, payload, symbol) : null;
  let visited = 0, truncated = false;
  function walk(value, path = '', depth = 0) {
    if (++visited > 1200 || facts.length >= 40 || depth > 6) { truncated = true; return; }
    if (value && typeof value === 'object') {
      const priority = ['macroRegime', 'regime', 'summary', 'current', 'scores', 'grades', 'decisions', 'signals', 'coverage', 'rows', 'companies'];
      const entries = Object.entries(value).sort(([a], [b]) => (priority.includes(a) ? priority.indexOf(a) : 100) - (priority.includes(b) ? priority.indexOf(b) : 100));
      for (const [k, v] of entries.slice(0, 24)) {
        if (/secret|token|password|credential|account|position|order|fill|customer|email|article|transcript|priceSeries|chains|quotes|raw/i.test(k)) continue;
        walk(v, path ? path + '.' + k : k, depth + 1);
      }
      if (entries.length > 24) truncated = true;
    } else if (derivedFields.has(path.split('.').at(-1)) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 120 && !/[<>]/.test(value))) facts.push({ path, value, unit: 'source_native_not_normalized' });
  }
  // Select the requested issuer before applying the bounded field projection.
  // An unmatched issuer yields an empty, explicitly missing card, never another
  // company's observations from the front of a source file.
  let matches = 0;
  if (projection) { facts.push(...projection.facts); matches = projection.matches; }
  else if (payload && controls) {
    const matching = (payload.timeline || []).flatMap(term => (term.chapters || []).filter(c =>
      (controls.president === 'any' || term.party === controls.president) && (controls.house === 'any' || c.house === controls.house) && (controls.senate === 'any' || c.senate === controls.senate))
      .map(c => ({ president: term.party, house: c.house, senate: c.senate, start: c.start, end: c.measureEnd || c.end,
        totalPct: c.totalPct, annPct: c.annPct, years: c.years })));
    walk({ count: matching.length, periods: matching });
    for (const f of facts) f.unit = /\.(totalPct|annPct)$/.test(f.path) ? 'percent' : /\.years$/.test(f.path) ? 'years' : f.path === 'count' ? 'count' : 'category';
  } else if (payload && symbol && sourceId !== 'company') {
    let scanned = 0;
    function find(value, path = '', depth = 0) {
      if (++scanned > 60000 || depth > 12) { truncated = true; return; }
      if (!value || typeof value !== 'object') return;
      if ([value.symbol, value.sym, value.ticker].includes(symbol) || path.split('.').at(-1) === symbol) { matches++; walk(value, path); return; }
      for (const [k, v] of Object.entries(value)) {
        if (/secret|token|password|credential|account|position|order|fill|customer|email|article|transcript|raw/i.test(k)) continue;
        find(v, path ? path + '.' + k : k, depth + 1);
      }
    }
    find(payload);
  } else if (payload) {
    if (sourceId === 'company') walk({ symbol, fundamentals: payload.fundamentals || {}, earnings: payload.earnings || {}, sector: payload.sector || '' });
    else walk(payload);
  }
  const observations = facts.filter(f => !['date', 'asOf', 'builtAtIso'].includes(f.path.split('.').at(-1)));
  const sourceTime = payload?.builtAtIso || payload?.generatedAtIso || payload?.asOf || payload?.current?.builtAtIso || null;
  const asOf = typeof sourceTime === 'string' && Number.isFinite(Date.parse(sourceTime)) ? sourceTime : null;
  const sourceHash = raw ? sha(raw) : sha(descriptor), contentHash = sha({ adapter_version: 2, sourceId, ...(symbol ? { symbol } : {}), ...(controls ? { controls } : {}), sourceHash, facts });
  const prior = state.events.find(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.content_sha256 === contentHash);
  if (prior) return repo.object(prior.payload.ref);
  if (state.events.filter(e => e.type === 'SITE_EVIDENCE_CAPTURED').length >= 120) contracts.fail('RESOURCE_LIMIT', 'Evidence shelf retention limit reached');
  const record = { schema: 'mingstreet.site-evidence.v1', id: 'ev_' + contentHash.slice(0, 32), source_id: sourceId, label: descriptor.label,
    category: descriptor.category, url: '/?tab=' + (sourceId === 'company' ? 'grade&s=' + encodeURIComponent(symbol) : sourceId), ...(symbol ? { symbol } : {}), captured_at: repo.clock(), source_as_of: asOf, source_sha256: sourceHash,
    content_sha256: contentHash, facts, truncated, source_key: key || null, history_class: 'EXPLORATORY_NON_PIT',
    warnings: ['Current source context only. It cannot become a historical signal, prove causality or override computed metrics.',
      'Selected derived fields only; raw quotes, articles, broker/account data and credentials are excluded.',
      ...(projection?.warnings || []),
      ...(payload?.stale || payload?.carriedForward ? ['CARRIED_FORWARD_SOURCE: the saved source is marked stale or carried forward. Build time does not establish fresh observations.'] : []),
      ...(asOf ? Date.parse(asOf) > Date.parse(repo.clock()) ? ['FUTURE_SOURCE: source time is after capture.'] : Date.parse(repo.clock()) - Date.parse(asOf) > 96 * 3600000 ? ['STALE_SOURCE: source is over 96 hours old.'] : [] : ['UNDATED_SOURCE: no usable source timestamp.']),
      ...(!observations.length ? ['Reference only: no supported derived observations beyond metadata. Inspect the source page for the full information.'] : []),
      ...(symbol && sourceId !== 'company' && !matches ? ['NO_ISSUER_MATCH: this source has no supported records for ' + symbol + '.'] : []),
      ...(controls ? ['Matched joint-control periods only. Chapter returns are rounded source percentages; years are rounded. These are historical associations, not an election, policy or return forecast. A zero match count means no such periods are covered, not a zero return.'] : []),
      ...(truncated ? ['BOUNDED_SAMPLE: this card is a selected excerpt, not the entire source dataset.'] : [])] };
  const ref = await repo.putObject('site-evidence', record);
  const canonicalRef = await repo.transact(s => {
    const existing = s.events.find(e => e.type === 'SITE_EVIDENCE_CAPTURED' && e.payload.content_sha256 === contentHash);
    if (existing) return existing.payload.ref;
    if (s.events.filter(e => e.type === 'SITE_EVIDENCE_CAPTURED').length >= 120) contracts.fail('RESOURCE_LIMIT', 'Evidence shelf retention limit reached');
    repo.emit(s, 'SITE_EVIDENCE_CAPTURED', { id: record.id, content_sha256: contentHash, ref, label: record.label }); return ref;
  });
  return canonicalRef.key === ref.key ? record : repo.object(canonicalRef);
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

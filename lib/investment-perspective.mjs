import { fullYearValuationFactory } from './full-year-valuation.mjs';
import { createHash } from 'node:crypto';

// The same arithmetic powers the frozen assessment and temporary browser scenarios.
// No grade, analyst target, provider call, or AI judgment enters this calculation.
export function investmentPerspectiveFactory(valuation) {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const round = value => finite(value) ? Math.round(value * 10000) / 10000 : null;
  const defaults = model => ({ growthPct: model.base.inputs.growthPct,
    operatingMarginPct: model.base.inputs.operatingMarginPct,
    exitMultiple: model.multiple.value, requiredReturnPct: 12 });
  function calculate(model, draft = defaults(model)) {
    const errors = [];
    for (const [key, low, high, label] of [
      ['growthPct', -95, 200, 'Revenue growth'], ['operatingMarginPct', .1, 80, 'Operating margin'],
      ['exitMultiple', 1, 100, 'Exit earnings multiple'], ['requiredReturnPct', 1, 50, 'Required annual return'],
    ]) if (!finite(draft[key]) || draft[key] < low || draft[key] > high) errors.push(`${label} must be between ${low} and ${high}.`);
    if (finite(model.base.inputs.grossMarginPct) && draft.operatingMarginPct > model.base.inputs.grossMarginPct) errors.push('Operating margin cannot exceed the supported gross margin.');
    if (errors.length) return { status: 'unavailable', label: 'Review assumptions', errors, scenarios: [], range: null, requiredGrowthPct: null };
    const scenarios = [];
    for (const [key, label, growthShift, marginShift, multipleFactor] of [
      ['downside', 'Lower assumptions', -5, -2, .8], ['base', 'Base assumptions', 0, 0, 1], ['upside', 'Higher assumptions', 5, 2, 1.2],
    ]) {
      const inputs = { ...model.base.inputs, growthPct: Math.max(-95, draft.growthPct + growthShift),
        operatingMarginPct: Math.min(model.base.inputs.grossMarginPct ?? 80, draft.operatingMarginPct + marginShift),
        exitMultiple: Math.min(120, draft.exitMultiple * multipleFactor) };
      const outcome = valuation.calculate(model.base, inputs, { asOf: model.asOf });
      if (outcome.status !== 'supported' || !(outcome.target > 0) || !finite(outcome.priceReturnPct)) {
        errors.push(outcome.reason || 'The supported earnings bridge cannot price these assumptions.');
        continue;
      }
      scenarios.push({ key, label, growthPct: round(inputs.growthPct), operatingMarginPct: round(inputs.operatingMarginPct),
        exitMultiple: round(inputs.exitMultiple), revenue: round(outcome.revenue), eps: round(outcome.eps),
        priceAtHorizon: round(outcome.target), presentValue: round(outcome.target / (1 + draft.requiredReturnPct / 100)),
        priceReturnPct: round(outcome.priceReturnPct) });
    }
    if (errors.length || scenarios.length !== 3) return { status: 'unavailable', label: 'Incomplete scenario bridge', errors, scenarios: [], range: null, requiredGrowthPct: null };
    const low = Math.min(...scenarios.map(row => row.presentValue)), high = Math.max(...scenarios.map(row => row.presentValue));
    const middle = scenarios.find(row => row.key === 'base');
    const status = model.spot < low ? 'below-range' : model.spot > high ? 'above-range' : 'within-range';
    // Solve the SAME earnings bridge for a future price that meets the hurdle.
    const reverseBase = { ...model.base, reference: { ...model.base.reference, spot: model.spot * (1 + draft.requiredReturnPct / 100) } };
    const reverse = valuation.calculate(reverseBase, { ...model.base.inputs, ...draft }, { asOf: model.asOf });
    return { status, label: { 'below-range': 'Below the scenario value range', 'within-range': 'Within the scenario value range', 'above-range': 'Above the scenario value range' }[status], errors: [],
      scenarios, range: { low, high }, basePresentValue: middle.presentValue,
      gapToBasePct: round((middle.presentValue / model.spot - 1) * 100),
      requiredGrowthPct: round(reverse.requiredGrowthPct), requiredReturnPct: draft.requiredReturnPct,
      interpretation: status === 'below-range' ? 'The price is below all three conditional present values. Review whether the assumptions and required return adequately reflect business risk.'
        : status === 'above-range' ? 'The current price needs more favorable assumptions than this scenario range supports.'
          : 'The current price falls inside the scenario range. The purchase case depends on which assumptions prove reasonable.' };
  }
  return { defaults, calculate };
}

const valuation = fullYearValuationFactory();
const calculations = investmentPerspectiveFactory(valuation);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const DAY = 86400000;
const safeTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function buildInvestmentPerspective({ symbol, chain, quote, forecast, chains, asOf }) {
  const result = { version: 1, asOf, horizon: '12-month price scenarios; next-four-quarter earnings assumptions',
    status: 'unavailable', label: 'Investment assessment unavailable', model: null, assessment: null,
    missing: [], sources: [], limitations: [
      'Conditional earnings-multiple scenarios, not an independent cash-flow valuation or calibrated price forecast.',
      'Scenario widths and the 12% default required return are explicit research assumptions, not fitted probabilities or a personalized risk hurdle.',
      'No dividends are assumed. Future prices and present values are different quantities. Estimates are not downside floors.',
      'An investment assessment cannot qualify a short-term entry or establish account suitability.',
    ] };
  const fail = reason => ({ ...result, missing: [reason] });
  if (!safeTime(asOf)) return fail('The assessment cutoff is unavailable.');
  if (!forecast?.enabled || !safeTime(forecast.builtAtIso) || Date.parse(forecast.builtAtIso) > Date.parse(asOf) || Date.parse(asOf) - Date.parse(forecast.builtAtIso) > 10 * DAY) return fail('A current, already-collected Earnings Forecast snapshot is required.');
  const matches = (Array.isArray(forecast.companies) ? forecast.companies : []).filter(company => company?.symbol === symbol);
  if (matches.length !== 1 || matches[0].former) return fail('This ticker is outside the current supported company-financial cohort.');
  const company = matches[0], record = company.companyRecord, f = chain?.fundamentals || {};
  if (/bank|insurance|reit|financial services/i.test([f.industry, f.sector, company.profile?.archetype].filter(Boolean).join(' '))) return fail('This business needs a sector-specific valuation method; the operating-company earnings bridge is not applied.');
  if (!quote.usable || quote.currency !== 'USD' || f.financialCurrency !== 'USD' || symbol === 'TSM') return fail('A usable USD quote and comparable USD per-share financial basis are required. No currency or ADR conversion is inferred.');
  if (!record || !safeTime(record.asOf) || Date.parse(record.asOf) > Date.parse(asOf) || !safeTime(company.forecast?.cutoffAt) || Date.parse(company.forecast.cutoffAt) > Date.parse(asOf)) return fail('Financial history and forecast availability must precede the assessment cutoff.');
  const quarters = Array.isArray(record.quarters) ? record.quarters : [];
  const latest = quarters.at(-1);
  if (!latest || quarters.some(q => !q || typeof q.start !== 'string' || typeof q.end !== 'string') || new Set(quarters.map(q => q.end)).size !== quarters.length || quarters.some((q, i) => i && q.start <= quarters[i - 1].end)) return fail('Financial quarters are missing, duplicated, overlapping, or out of order.');
  for (const q of quarters.slice(-4)) {
    if (!q.metrics || q.currency !== 'USD' || Object.values(q.metrics).some(metric => !safeTime(metric?.firstSeenAt) || Date.parse(metric.firstSeenAt) > Date.parse(asOf)
      || !safeTime(metric?.filed) || Date.parse(metric.filed) + DAY + 12 * 3600000 > Date.parse(asOf))) return fail('The financial bridge contains an unavailable, future, or noncomparable source observation.');
  }
  if (!safeTime(latest.end) || (Date.parse(asOf) - Date.parse(latest.end)) / DAY > 180 || Date.parse(latest.end) > Date.parse(asOf)) return fail('The latest supported reporting period is stale or invalid.');
  const reference = { ...company.valuationReference, asOf, spot: quote.value, quoteAsOf: quote.asOf, currency: quote.currency,
    reportedPeriodEnd: f.lastQuarter?.date || company.valuationReference?.reportedPeriodEnd || null };
  const base = valuation.base({ ...company, valuationReference: reference });
  if (base.status !== 'ready' || !base.epsSupported || !finite(base.inputs.operatingMarginPct) || !(base.inputs.operatingMarginPct > 0)) return fail(base.unavailableReason || 'Four comparable reported quarters and a supported positive earnings bridge are required.');
  const peers = Object.entries(chains || {}).filter(([peer, data]) => peer !== symbol && f.industry && data?.fundamentals?.industry === f.industry
    && finite(data.fundamentals.forwardPE) && data.fundamentals.forwardPE >= 1 && data.fundamentals.forwardPE <= 100
    && data.quoteProvenance?.currency === 'USD' && safeTime(data.quoteProvenance.asOf)
    && Date.parse(data.quoteProvenance.asOf) <= Date.parse(asOf) && Date.parse(asOf) - Date.parse(data.quoteProvenance.asOf) <= 96 * 3600000)
    .map(([symbol, data]) => ({ symbol, forwardPE: data.fundamentals.forwardPE, asOf: data.quoteProvenance.asOf }));
  const sorted = peers.map(p => p.forwardPE).sort((a, b) => a - b);
  const median = sorted.length >= 3 ? (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
  const own = finite(f.forwardPE) && f.forwardPE >= 1 && f.forwardPE <= 100 ? f.forwardPE : null;
  if (!median && !own) return fail('A valid earnings-multiple reference is unavailable. Analyst price targets are not substituted.');
  const multiple = { value: median || own, basis: median ? 'Median forward P/E of at least three other covered companies in the same reported industry.'
    : 'Own observed forward P/E held constant. This market-derived assumption is not independent evidence that the stock is cheap.',
    kind: median ? 'industry-reference' : 'own-market-reference', peers: median ? peers : [] };
  const model = { base, multiple, asOf, spot: quote.value, currency: 'USD', quoteAsOf: quote.asOf };
  const assessment = calculations.calculate(model);
  if (assessment.status === 'unavailable') return fail(assessment.errors.join(' '));
  const sources = quarters.slice(-4).flatMap(q => Object.values(q.metrics)).map(metric => ({ id: metric.sourceId, url: metric.sourceUrl,
    filed: metric.filed, firstSeenAt: metric.firstSeenAt })).filter(metric => typeof metric.id === 'string');
  return { ...result, status: assessment.status, label: assessment.label, model, assessment,
    inputId: createHash('sha256').update(JSON.stringify({ model, sources, forecastId: company.forecast.id || null })).digest('hex').slice(0, 20),
    missing: [], sources: [...new Map(sources.map(source => [source.id, source])).values()],
    financialPeriodEnd: latest.end, financialCutoffAt: company.forecast.cutoffAt, sourceBuiltAt: forecast.builtAtIso,
    explanation: 'Financial inputs, price, and explicit valuation assumptions determine this perspective. The four-pillar total does not enter its arithmetic.' };
}

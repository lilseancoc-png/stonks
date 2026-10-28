// The same payload boundary and age policy run in publication checks and UI.
// Serialized into app.js, so keep this factory dependency-free.
export function unifiedSignalDisplayFactory() {
  const states = ['eligible','wait','watch','avoid','insufficient-data'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const optionalNumber = value => value === null || finite(value);
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  function perspectivesValid(value) {
    if (value === undefined) return true; // Retained snapshots remain readable.
    if (!value || value.version !== 1) return false;
    if (value.quote !== undefined && (!value.quote || !optionalNumber(value.quote.value) || typeof value.quote.usable !== 'boolean' || typeof value.quote.current !== 'boolean')) return false;
    const investment = value.investment, trading = value.trading;
    if (!investment || investment.version !== 1 || !timestamp(investment.asOf) || typeof investment.horizon !== 'string'
      || !['unavailable', 'below-range', 'within-range', 'above-range'].includes(investment.status)
      || typeof investment.label !== 'string' || !strings(investment.missing) || !strings(investment.limitations) || !Array.isArray(investment.sources)) return false;
    if (investment.status !== 'unavailable') {
      const model = investment.model, result = investment.assessment;
      if (!model?.base?.inputs || model.base.status !== 'ready' || model.base.epsSupported !== true || !(model.spot > 0) || model.currency !== 'USD'
        || !timestamp(model.asOf) || !model.base.reference || !Array.isArray(model.base.inputs.lines)
        || !model.base.inputs.lines.length || !model.base.inputs.lines.every(row => row && finite(row.weight) && finite(row.demandPct) && finite(row.pricePct))
        || !finite(model.base.baselineRevenue) || !Array.isArray(model.base.quarters) || !model.base.quarters.every(q => q && typeof q.start === 'string' && typeof q.end === 'string')
        || !model.multiple || !finite(model.multiple.value) || typeof model.multiple.basis !== 'string' || !Array.isArray(model.multiple.peers)
        || !model.multiple.peers.every(peer => peer && typeof peer.symbol === 'string' && finite(peer.forwardPE))
        || !['growthPct', 'operatingMarginPct', 'exitMultiple'].every(key => finite(model.base.inputs[key]) || key === 'exitMultiple' && model.base.inputs[key] === null)
        || typeof investment.inputId !== 'string' || !result || result.status !== investment.status || typeof result.interpretation !== 'string'
        || !Array.isArray(result.scenarios) || result.scenarios.length !== 3
        || !result.scenarios.every(row => row && ['downside', 'base', 'upside'].includes(row.key) && typeof row.label === 'string'
          && ['growthPct', 'operatingMarginPct', 'exitMultiple', 'revenue', 'eps', 'priceAtHorizon', 'presentValue', 'priceReturnPct'].every(key => finite(row[key])))
        || !result.range || !(result.range.low > 0) || !(result.range.high >= result.range.low)
        || !optionalNumber(result.requiredGrowthPct) || !finite(result.requiredReturnPct)) return false;
    } else if (investment.model !== null || investment.assessment !== null) return false;
    if (!trading || trading.version !== 1 || !timestamp(trading.asOf) || typeof trading.horizon !== 'string'
      || !['insufficient-data', 'no-setup', 'invalidated', 'wait', 'setup'].includes(trading.status)
      || !['bullish', 'bearish', 'mixed'].includes(trading.direction) || typeof trading.label !== 'string'
      || !strings(trading.blocks) || !strings(trading.limitations) || !Array.isArray(trading.confirmation)
      || !trading.confirmation.every(row => row && typeof row.label === 'string' && typeof row.pass === 'boolean')
      || !trading.coverage || !finite(trading.coverage.sessions) || !trading.execution || typeof trading.execution.qualified !== 'boolean' || typeof trading.execution.reason !== 'string'
      || !trading.volatility || typeof trading.volatility.label !== 'string' || typeof trading.volatility.note !== 'string'
      || !['iv', 'mean', 'change5dPct'].every(key => optionalNumber(trading.volatility[key]))) return false;
    if (trading.setup !== null && (!trading.setup || typeof trading.setup.name !== 'string' || typeof trading.setup.asOf !== 'string' || !['call', 'put'].includes(trading.setup.side)
      || !finite(trading.setup.atr) || !optionalNumber(trading.setup.rvol) || typeof trading.setup.confirmed !== 'boolean')) return false;
    if (trading.plan !== null && (!trading.plan || !['entry', 'target', 'invalidation', 'trigger', 'rewardRisk', 'riskAtr'].every(key => optionalNumber(trading.plan[key])) || typeof trading.plan.targetMethod !== 'string' || typeof trading.plan.warning !== 'string')) return false;
    if (trading.peers !== null && (!trading.peers || !finite(trading.peers.n) || !optionalNumber(trading.peers.meanReturn5Pct) || typeof trading.peers.note !== 'string' || !Array.isArray(trading.peers.members))) return false;
    if (trading.history !== null && (!trading.history || typeof trading.history.interpretation !== 'string' || !Array.isArray(trading.history.horizons)
      || !trading.history.horizons.every(row => row && [5, 10].includes(row.sessions) && finite(row.n)
        && ['meanReturnPct', 'medianReturnPct', 'positiveOutcomePct', 'baselineMeanPct'].every(key => optionalNumber(row[key])) && finite(row.baselineN)
        && Array.isArray(row.samples) && row.samples.length === row.n && row.samples.every(sample => sample && typeof sample.signalDate === 'string' && typeof sample.outcomeDate === 'string' && finite(sample.signedReturnPct) && finite(sample.adverseMovePct))))) return false;
    if (trading.inputs !== null && (!trading.inputs || trading.inputs.encoding !== 'deflate-raw-json-base64' || !Number.isInteger(trading.inputs.rows)
      || trading.inputs.rows < 1 || trading.inputs.rows > 520 || typeof trading.inputs.sourceHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(trading.inputs.sourceHash) || typeof trading.inputs.data !== 'string' || trading.inputs.data.length > 200000
      || !Array.isArray(trading.inputs.columns) || trading.inputs.columns.join(',') !== 'date,high,low,close,volume')) return false;
    return true;
  }
  function valid(payload) {
    if (payload?.version !== 1 || typeof payload.engineVersion !== 'string' || !Array.isArray(payload.decisions) || payload.decisions.length > 1000) return false;
    const built = Date.parse(payload.builtAtIso), expiry = Date.parse(payload.validUntil);
    if (!Number.isFinite(built) || !Number.isFinite(expiry) || expiry <= built || expiry - built > 3600000) return false;
    if (typeof payload.snapshotId !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{16}$/.test(payload.snapshotId) || payload.snapshotKey !== 'signal-decisions/' + payload.snapshotId + '.json') return false;
    const seen = new Set();
    return payload.horizon?.days === 14 && payload.decisions.every(row => {
      if (!row || typeof row.symbol !== 'string' || !/^[A-Z][A-Z0-9.]{0,5}$/.test(row.symbol) || seen.has(row.symbol)) return false;
      seen.add(row.symbol);
      return states.includes(row.status) && ['bullish','bearish','mixed'].includes(row.direction)
        && (row.grade === null || finite(row.grade)) && row.quote && (row.quote.value === null || finite(row.quote.value))
        && row.plan && perspectivesValid(row.perspectives) && Array.isArray(row.blocks) && row.blocks.every(s => typeof s === 'string')
        && Array.isArray(row.evidence) && row.evidence.every(e => e && typeof e.id === 'string' && typeof e.title === 'string' && ['supports','opposes','context'].includes(e.effect))
        && row.uncertainty && Array.isArray(row.uncertainty.missing) && row.uncertainty.missing.every(s => typeof s === 'string') && row.valuation && row.stress && Array.isArray(row.stress.paths) && row.stress.paths.every(s => s && typeof s.name === 'string' && finite(s.low) && finite(s.high))
        && row.thesis && row.review && Array.isArray(row.review.invalidators) && row.changes && Array.isArray(row.changes.items)
        && row.vehicles && Array.isArray(row.vehicles.choices) && row.vehicles.choices.length === 3
        && ['shares','option','cash'].every(kind => row.vehicles.choices.filter(v => v?.kind === kind).length === 1)
        && row.vehicles.choices.every(v => {
          if (typeof v.eligible !== 'boolean') return false;
          if (v.kind !== 'option') return true;
          return Array.isArray(v.scenarios) && v.scenarios.every(s => s && typeof s.label === 'string')
            && Array.isArray(v.limitations) && Array.isArray(v.legs)
            && v.legs.every(leg => leg && [1,-1].includes(leg.qty) && ['call','put'].includes(leg.type));
        })
        && (row.status !== 'eligible' || (row.blocks.length === 0 && row.quote.current === true && row.plan.valid === true));
    });
  }
  function expired(payload, now = Date.now()) {
    return now < Date.parse(payload.builtAtIso) - 300000 || now >= Date.parse(payload.validUntil);
  }
  function status(row, payload, now = Date.now(), referenceOnly = false) {
    const quoteExpiry = Date.parse(row.quote?.validUntil || '');
    return row.status === 'eligible' && (referenceOnly || expired(payload, now) || !Number.isFinite(quoteExpiry) || now >= quoteExpiry) ? 'wait' : row.status;
  }
  const label = value => ({ eligible: 'Entry qualified at build', wait: 'Wait for confirmation', watch: 'Research watch', avoid: 'Avoid under policy', 'insufficient-data': 'Insufficient data' })[value] || 'Unavailable';
  return { valid, expired, status, label };
}

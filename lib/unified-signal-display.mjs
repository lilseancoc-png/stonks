// The same payload boundary and age policy run in publication checks and UI.
// Serialized into app.js, so keep this factory dependency-free.
export function unifiedSignalDisplayFactory() {
  const states = ['eligible','wait','watch','avoid','insufficient-data'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
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
        && row.plan && Array.isArray(row.blocks) && row.blocks.every(s => typeof s === 'string')
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

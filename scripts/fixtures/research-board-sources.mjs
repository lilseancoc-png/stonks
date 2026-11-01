// Fictional values in the actual saved producer shapes. No provider calls.
export function researchBoardSources(now) {
  return {
    'NVDA.json': { fundamentals: { name: 'Fictional NVDA', financialCurrency: 'USD', revenue: 1000000000, profitMargin: 20, revenueGrowthYoy: 10, trailingPE: 25, debtToEquity: 53.2, totalDebtAsOf: '2026-09-30', secret: 'DO_NOT_EXPORT_FIXTURE' }, earningsHx: { events: [] }, priceSeries: { c: [99999] } },
    'META.json': { fundamentals: { name: 'Fictional META', financialCurrency: 'USD', revenue: 2000000000, profitMargin: 25, revenueGrowthYoy: 15 } },
    'ai-capex.json': { builtAtIso: now, companies: [
      { ticker: 'MSFT', fyLatest: { label: 'FY2026', end: '2026-06-30', val: 999000000000 } },
      { ticker: 'META', fyLatest: { label: 'FY2025', end: '2025-12-31', val: 20000000000 }, fyPrior: { val: 16000000000 }, yoyPct: 25, ttm: { val: 22000000000, asOf: '2026-09-30' }, capexToRevenuePct: 22, guidance: { low: 25000000000, high: null, asOf: '2026-10-29', period: 'CY2027', basis: 'includes finance-lease principal payments' } },
    ] },
    'accelerator-prices.json': { builtAtIso: now, unit: 'USD per GPU-hour', summary: { freshSources: 1, sourceCount: 2, staleSources: ['Fictional carried provider'] }, benchmarks: [{ modelId: 'h100', currentMedian: 2.5, spot: { median: 2 }, onDemand: { median: 3 }, change7dPct: -5, change30dPct: null }], quotes: [{ price: 99999, secret: 'DO_NOT_EXPORT_FIXTURE' }] },
    'macro.json': { asOf: now, tenY: { value: 99999, asOf: '2026-10-29', bpsChange1d: 12, bpsChange5d: 0, trend: 'rising' }, dxy: { value: 99999, asOf: '2026-10-29', pctChange1d: -.5, pctChange5d: 1.2, trend: 'rising' } },
    'earnings-tracker.json': { builtAtIso: now, recentlyReported: [], seasons: [{ rows: [
      { sym: 'NVDA', date: '2026-10-29', epsActual: 2.4, epsEstimate: 2, surprisePct: 20, revenueActual: 1000000000, revenueCurrency: 'USD', guidance: 'up', movePct: -.04 },
      { sym: 'META', date: '2026-10-28', epsActual: 4, surprisePct: 8, revenueCurrency: 'USD', guidance: 'up', movePct: .03 },
    ] }] },
    'trends.json': { builtAtIso: now, narratives: [{ name: 'Fictional AI infrastructure', longs: ['NVDA', 'META'], sentiment: 'bullish', strength: 70, status: 'active', thesis: 'DO_NOT_EXPORT_FIXTURE' }, { name: 'Other company theme', longs: ['MSFT'], strength: 99 }] },
  };
}

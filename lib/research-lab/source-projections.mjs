// Explicit projections of saved producer contracts. Values retain their native
// units; null never becomes zero. Raw quotes, history and source prose stay out.
export function projectSavedSource(source, payload, symbol) {
  const facts = [], warnings = [];
  const add = (path, value, unit) => {
    if (facts.length >= 40 || value == null) return;
    if (!['category', 'date', 'source_interpretation'].includes(unit) && typeof value !== 'number') return;
    if (unit === 'date' && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) return;
    if (typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'boolean' && (typeof value !== 'string' || value.length > 120 || /[<>]/.test(value))) return;
    facts.push({ path, value, unit });
  };
  if (source === 'company') {
    const f = payload.fundamentals || {}, currency = /^[A-Z]{3}$/.test(f.financialCurrency || '') ? f.financialCurrency : 'financial_currency_unspecified';
    for (const key of ['name', 'sector', 'industry', 'financialCurrency']) add('fundamentals.' + key, f[key], 'category');
    for (const key of ['revenue', 'freeCashFlow', 'operatingCashFlow', 'totalDebt', 'totalCash']) add('fundamentals.' + key, f[key], currency);
    for (const key of ['profitMargin', 'operatingMargin', 'grossMargin', 'revenueGrowthYoy', 'earningsGrowthYoy', 'debtToEquity']) add('fundamentals.' + key, f[key], 'percent');
    for (const key of ['trailingPE', 'forwardPE', 'currentRatio', 'beta']) add('fundamentals.' + key, f[key], 'ratio');
    add('fundamentals.totalDebtAsOf', f.totalDebtAsOf, 'date');
    // Older saved excerpts and fixture payloads use Yahoo-native field names.
    for (const key of ['totalRevenue', 'freeCashflow']) add('fundamentals.' + key, f[key], currency);
    for (const key of ['profitMargins', 'revenueGrowth', 'grossMargins']) add('fundamentals.' + key, f[key], 'fraction');
    return { facts, warnings, matches: 1 };
  }
  if (source === 'ai-capex' && Array.isArray(payload.companies) && payload.companies.some(c => c.fyLatest || c.ttm || c.guidance)) {
    const rows = payload.companies.filter(c => !symbol || c.ticker === symbol || c.symbol === symbol);
    for (const c of rows.slice(0, symbol ? 1 : 4)) {
      const p = c.ticker || c.symbol || 'company';
      add(p + '.capex_latest_fiscal_year', c.fyLatest?.val, 'USD'); add(p + '.capex_fiscal_year_end', c.fyLatest?.end, 'date');
      add(p + '.capex_previous_fiscal_year', c.fyPrior?.val, 'USD'); add(p + '.capex_yoy_change', c.yoyPct, 'percent');
      add(p + '.capex_ttm', c.ttm?.val, 'USD'); add(p + '.capex_ttm_as_of', c.ttm?.asOf, 'date');
      add(p + '.capex_to_revenue', c.capexToRevenuePct, 'percent');
      if (c.guidance) { for (const k of ['low', 'high']) add(p + '.capex_guidance_' + k, c.guidance[k], 'USD'); for (const k of ['period', 'basis', 'asOf', 'status']) add(p + '.guidance_' + k, c.guidance[k], k === 'asOf' ? 'date' : 'category'); }
    }
    warnings.push('Reported CapEx and management guidance use different periods and definitions. Guidance is an outlook, not reported spending.');
    if (!symbol && rows.length > 4) warnings.push('BOUNDED_SAMPLE: first four companies by the source order. Choose a symbol for its complete selected excerpt.');
    return { facts, warnings, matches: rows.length };
  }
  if (source === 'accelerator-prices' && Array.isArray(payload.benchmarks)) {
    if (symbol) return { facts, warnings: ['GPU cloud prices are industry context, not issuer-specific records. Clear the symbol filter.'], matches: 0 };
    for (const b of payload.benchmarks.slice(0, 4)) {
      const p = b.modelId || b.model || 'GPU';
      add(p + '.median_cloud_rental_rate', b.currentMedian, 'USD_per_GPU_hour');
      add(p + '.median_spot_rental_rate', b.spot?.median, 'USD_per_GPU_hour'); add(p + '.median_on_demand_rental_rate', b.onDemand?.median, 'USD_per_GPU_hour');
      add(p + '.change_7d', b.change7dPct, 'percent'); add(p + '.change_30d', b.change30dPct, 'percent');
    }
    add('coverage.fresh_sources', payload.summary?.freshSources, 'count'); add('coverage.total_sources', payload.summary?.sourceCount, 'count');
    warnings.push('GPU cloud rental rates are derived marketplace medians, not chip sale prices or NVDA revenue. Provider capacity and service terms differ.');
    if (payload.summary?.staleSources?.length) warnings.push('Carried-forward providers: ' + payload.summary.staleSources.join(', ').slice(0, 400));
    return { facts, warnings, matches: 1 };
  }
  if (source === 'bonds-usd') {
    if (symbol) return { facts, warnings: ['Rates and dollar context is cross-market. Clear the symbol filter.'], matches: 0 };
    for (const key of ['twoY', 'tenY', 'thirtyY', 'dxy', 'vix', 'crude', 'gold']) {
      const leg = payload[key]; if (!leg) continue;
      const yieldLeg = ['twoY', 'tenY', 'thirtyY'].includes(key);
      for (const k of yieldLeg ? ['bpsChange1d', 'bpsChange5d'] : ['pctChange1d', 'pctChange5d']) add(key + '.' + k, leg[k], yieldLeg ? 'basis_points' : 'percent');
      add(key + '.trend', leg.trend, 'category'); add(key + '.asOf', leg.asOf, 'date');
    }
    return { facts, warnings: ['Yield changes are basis points; other market changes are percentages. Quote levels and raw price history are excluded.'], matches: 1 };
  }
  if (source === 'earnings' && (Array.isArray(payload.seasons) || Array.isArray(payload.recentlyReported))) {
    const unique = new Map();
    for (const row of [...(payload.recentlyReported || []), ...(payload.seasons || []).flatMap(s => s.rows || [])]) {
      if ((!symbol || row.sym === symbol) && row.date) unique.set(row.sym + ':' + row.date, row);
    }
    const rows = [...unique.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    for (const r of rows.slice(0, 2)) {
      const p = r.sym + '.' + r.date, currency = /^[A-Z]{3}$/.test(r.revenueCurrency || '') ? r.revenueCurrency : 'financial_currency_unspecified';
      add(p + '.reported_on', r.date, 'date'); add(p + '.eps_actual', r.epsActual, currency + '_per_share'); add(p + '.eps_estimate', r.epsEstimate, currency + '_per_share');
      add(p + '.revenue_actual', r.revenueActual, currency); add(p + '.eps_surprise', r.surprisePct, 'percent');
      add(p + '.earnings_reaction', r.movePct, 'decimal_return'); add(p + '.week_one_return', r.week1Pct, 'decimal_return');
      add(p + '.guidance_direction', r.guidance, 'category');
    }
    if (rows.length > 2) warnings.push('BOUNDED_SAMPLE: two latest matching reported events. Other reports and future earnings are excluded.');
    return { facts, warnings, matches: rows.length };
  }
  if (source === 'narratives' && Array.isArray(payload.narratives)) {
    const rows = payload.narratives.filter(n => !symbol || [...(n.longs || []), ...(n.shorts || []), ...(n.symbols || []), ...(n.tickers || [])].includes(symbol));
    for (const [i, n] of rows.slice(0, 3).entries()) {
      const p = 'theme_' + (i + 1);
      for (const k of ['name', 'sentiment', 'status', 'riskState', 'lifecycleStage']) add(p + '.' + k, n[k], 'category');
      add(p + '.strength', n.strength, 'source_score');
      if (symbol) add(p + '.issuer_role', n.longs?.includes(symbol) ? 'long' : n.shorts?.includes(symbol) ? 'short' : 'mentioned', 'source_interpretation');
    }
    warnings.push('Theme classifications and scores are site interpretations, not measured causal effects. Source prose and articles are excluded.');
    return { facts, warnings, matches: rows.length };
  }
  return null;
}

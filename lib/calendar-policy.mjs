// Calendar policy shared by the bake, regeneration, browser and coverage audit.
export function calendarEventsForUniverse(events, symbols) {
  const tracked = new Set(symbols);
  return (events || []).filter(e => e && (!e.symbol || tracked.has(e.symbol)));
}

export function calendarForDisplay(data, symbols, stockSymbols, nowMs = Date.now()) {
  const tracked = new Set(symbols), stocks = new Set(stockSymbols);
  const today = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const events = (data.events || []).filter(e => e && (!e.symbol || tracked.has(e.symbol)) && (e.type !== 'earnings' || stocks.has(e.symbol)));
  const scheduled = new Set(events.filter(e => e.type === 'earnings' && e.date >= today).map(e => e.symbol));
  return { ...data, events, coverage: { ...data.coverage, earningsUniverse: stockSymbols.length,
    earningsScheduled: scheduled.size, earningsMissing: stockSymbols.filter(s => !scheduled.has(s)) } };
}

export function calendarCoverage({ events, symbols, stockSymbols, chains, sessionMap, officialSources, reportSources, asOfMs = Date.now() }) {
  const scheduled = new Set(events.filter(e => e.type === 'earnings').map(e => e.symbol));
  const catalystReviewed = stockSymbols.filter(sym => {
    const row = chains[sym], news = row?.news;
    const age = asOfMs - Date.parse(news?.builtAt || '');
    return Array.isArray(row?.catalysts) && news && !news.fallback && !news.stale && Number.isFinite(age) && age >= -900000 && age <= 86400000;
  });
  return {
    universeSymbols: [...symbols],
    earningsUniverse: stockSymbols.length,
    earningsScheduled: scheduled.size,
    earningsMissing: stockSymbols.filter(s => !scheduled.has(s)),
    tickerInputsMissing: symbols.filter(s => !chains[s]),
    catalystSymbols: [...new Set(events.filter(e => e.type === 'catalyst').map(e => e.symbol))],
    catalystReview: { reviewed: catalystReviewed.length, universe: stockSymbols.length, missing: stockSymbols.filter(s => !catalystReviewed.includes(s)), maxAgeHours: 24 },
    nasdaq: sessionMap?.coverage || { status: 'unknown', requested: 0, succeeded: 0, failedDates: [] },
    officialSources,
    reportSources: reportSources || { forexFactory: 'unknown' },
  };
}

export function calendarSourceLabel(key) {
  const labels = { bls: 'BLS', bea: 'BEA', 'kc-fed-jackson-hole': 'Kansas City Fed · Jackson Hole' };
  if (labels[key]) return labels[key];
  const annual = /^(census|ism)-(\d{4})$/.exec(key);
  if (annual) return (annual[1] === 'ism' ? 'ISM' : 'Census') + ' · ' + annual[2];
  const fed = /^fed-board-(\d{4})-(\d{2})$/.exec(key);
  if (fed) return 'Federal Reserve · ' + new Date(fed[1] + '-' + fed[2] + '-01T12:00:00Z').toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});
  return key;
}

export function calendarHealth(data, nowMs = Date.now()) {
  const coverage = data?.coverage || {};
  const builtMs = Date.parse(data?.builtAtIso || '');
  const ageHours = Number.isFinite(builtMs) ? (nowMs - builtMs) / 3600000 : null;
  const failedSources = Object.entries(coverage.officialSources || {}).filter(([, ok]) => ok === false).map(([key]) => key);
  const warnings = [];
  if (ageHours === null || ageHours > 96 || ageHours < -1) warnings.push('Calendar snapshot needs a refresh.');
  if (failedSources.length) warnings.push('Official schedules unavailable: ' + failedSources.map(calendarSourceLabel).join(', ') + '.');
  if (coverage.nasdaq?.status === 'partial' || coverage.nasdaq?.status === 'unavailable') warnings.push('Nasdaq earnings lookup is incomplete.');
  if (coverage.reportSources?.forexFactory === 'partial' || coverage.reportSources?.forexFactory === 'unavailable') warnings.push('Weekly economic event feed is incomplete.');
  if (coverage.staleReportSubtypes?.length) warnings.push('Some report figures were carried forward from the previous calendar.');
  return { ageHours, failedSources, warnings };
}

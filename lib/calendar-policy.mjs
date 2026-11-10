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
  if (Object.hasOwn(labels,key)) return labels[key];
  const annual = /^(census|ism)-(\d{4})$/.exec(key);
  if (annual) return (annual[1] === 'ism' ? 'ISM' : 'Census') + ' · ' + annual[2];
  const fed = /^fed-board-(\d{4})-(\d{2})$/.exec(key);
  if (fed && Number(fed[2])>=1 && Number(fed[2])<=12) return 'Federal Reserve · ' + new Date(fed[1] + '-' + fed[2] + '-01T12:00:00Z').toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});
  return 'Unrecognized official schedule';
}

// An outage may reuse explicitly published dates for at most 30 days after
// verification, within the publisher's dated edition or event span.
export function calendarScheduleFallbackUsable(verifiedAt, nowMs, validThrough) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if(!date(verifiedAt) || !date(validThrough))return false;
  const age=nowMs-Date.parse(verifiedAt+'T00:00:00Z');
  return age>=0 && age<30*86400000 && nowMs<=Date.parse(validThrough+'T23:59:59.999Z');
}

export function calendarHealth(data, nowMs = Date.now()) {
  const coverage = data?.coverage || {};
  const builtMs = Date.parse(data?.builtAtIso || '');
  const ageHours = Number.isFinite(builtMs) ? (nowMs - builtMs) / 3600000 : null;
  const failedSources = Object.entries(coverage.officialSources || {}).filter(([, ok]) => ok === false).map(([key]) => key);
  const warnings = [], notices = [];
  if (ageHours === null || ageHours > 96 || ageHours < -1) warnings.push('Calendar snapshot needs a refresh.');
  const uncovered=failedSources.filter(key=>{
    const fallback=coverage.officialFallbacks?.[key];
    if(!/^ism-\d{4}$/.test(key) || fallback?.kind!=='published-schedule' || !calendarScheduleFallbackUsable(fallback.verifiedAt,nowMs,fallback.validThrough) || (data?.events || []).some(e=>e?.sourceKey===key && e.stale===true))return true;
    notices.push(calendarSourceLabel(key)+': live check unavailable; using published dates verified '+fallback.verifiedAt+'. Cached dates do not establish new report figures.');
    return false;
  });
  if (uncovered.length) warnings.push('Official schedules unavailable: ' + uncovered.map(calendarSourceLabel).join(', ') + '.');
  // A failed lookup for a print more than three weeks out (a Yahoo-estimated
  // date Nasdaq has no record shape for yet) only leaves that print's AM/PM tag
  // open; the date itself still shows. It is a notice, not a degraded calendar.
  // It kept the calendar "degraded" for weeks over MU's 2026-12-23 estimate.
  const nearCutoff=new Date(nowMs+21*86400000).toISOString().slice(0,10);
  const nasdaqFailed=Array.isArray(coverage.nasdaq?.failedDates)?coverage.nasdaq.failedDates:[];
  if (coverage.nasdaq?.status === 'unavailable' || coverage.nasdaq?.status === 'partial' && (!nasdaqFailed.length || nasdaqFailed.some(d=>!(typeof d==='string' && d>nearCutoff)))) warnings.push('Nasdaq earnings lookup is incomplete.');
  else if (coverage.nasdaq?.status === 'partial') notices.push('Nasdaq has no session record yet for '+nasdaqFailed.length+(nasdaqFailed.length===1?' earnings date':' earnings dates')+' more than three weeks out; those dates show without an AM/PM tag.');
  if (coverage.reportSources?.forexFactory === 'partial' || coverage.reportSources?.forexFactory === 'unavailable') warnings.push('Weekly economic event feed is incomplete.');
  if (coverage.staleReportSubtypes?.length) warnings.push('Some report figures were carried forward from the previous calendar.');
  const today=new Date(nowMs).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  const company=(data?.events || []).filter(e=>e?.companyEvent && e.sourceCheckFailed && (e.endDate || e.date)>=today);
  if(company.some(e=>!calendarScheduleFallbackUsable(e.verifiedAt,nowMs,e.endDate || e.date)))warnings.push('Some company-event pages are unavailable and their verified-date fallback has expired.');
  else if(company.length)notices.push('Company-event live checks are unavailable; previously verified dates remain visible with their original verification dates.');
  return { ageHours, failedSources, warnings, notices };
}

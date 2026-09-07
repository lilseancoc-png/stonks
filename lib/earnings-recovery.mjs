// Public research filters and evidence only. These do not enroll trades or
// replace Stock Picks / Sector Rotation grades. Embedded verbatim in the UI.
export function recoveryCandidates(payload, options = {}, now = Date.now()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const end = Date.parse(today + 'T00:00:00Z');
  const days = [14, 30, 60].includes(Number(options.days)) ? Number(options.days) : 30;
  const minDrop = [3, 5, 10].includes(Number(options.minDrop)) ? Number(options.minDrop) : 5;
  const latest = new Map();
  for (const season of payload?.seasons || []) {
    for (const row of season?.rows || []) {
      if (!row?.sym || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) continue;
      const stamp = Date.parse(row.date + 'T00:00:00Z');
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== row.date || stamp > end) continue;
      if (!latest.has(row.sym) || row.date > latest.get(row.sym).date) latest.set(row.sym, row);
    }
  }
  return [...latest.values()].filter(row => {
    const age = Math.round((end - Date.parse(row.date + 'T00:00:00Z')) / 86400000);
    return age >= 0 && age <= days && typeof row.movePct === 'number' && Number.isFinite(row.movePct)
      && row.movePct <= -minDrop / 100
      && (options.guidance === 'all' || row.guidance === 'up' || row.guidance === 'inline')
      && (!options.search || (row.sym + ' ' + (row.name || '')).toUpperCase().includes(String(options.search).trim().toUpperCase()));
  }).sort((a, b) => b.date.localeCompare(a.date) || a.movePct - b.movePct || a.sym.localeCompare(b.sym));
}

export function recoveryEvidence(row, data, now = Date.now()) {
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const dayMs = v => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const ms = Date.parse(v + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === v ? ms : null;
  };
  const history = input => {
    const byDate = new Map();
    for (const q of Array.isArray(input) ? input : []) {
      const stamp = dayMs(q?.date);
      if (stamp != null && stamp <= now && num(q?.value) != null) byDate.set(q.date, q);
    }
    return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
  };
  const f = data?.fundamentals || {};
  const checks = [];
  const check = (key, label, state, detail) => checks.push({ key, label, state, detail });
  const pct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const events = (Array.isArray(data?.earningsHx?.events) ? data.earningsHx.events : []).filter(e => dayMs(e?.date) != null && dayMs(e.date) <= now);
  const event = events.find(e => e.date === row.date);
  const normalizeGuidance = g => g === 'raised' || g === 'up' ? 'up' : g === 'inline' ? 'inline' : ['soft', 'lowered', 'down'].includes(g) ? 'down' : null;
  const guidance = normalizeGuidance(event?.guidance) || normalizeGuidance(row.guidance);
  const guidanceConflict = normalizeGuidance(event?.guidance) && normalizeGuidance(row.guidance) && normalizeGuidance(event.guidance) !== normalizeGuidance(row.guidance);
  // A source tag only verifies the guidance value from the same record.
  const guidanceSource = normalizeGuidance(event?.guidance) ? event.guidanceSrc || null : row.guidanceSrc || null;
  check('guidance', 'Forward guidance', guidanceConflict || guidance === 'down' ? 'fail' : guidanceSource === 'call' && ['up', 'inline'].includes(guidance) ? 'pass' : 'missing',
    guidanceConflict ? 'Report and ticker guidance disagree; reconcile the same earnings event.' : guidance === 'down' ? 'Guidance was cut; a price drop does not establish recovery.' :
      guidanceSource === 'call' && guidance ? 'Call-derived guidance ' + (guidance === 'up' ? 'raised' : 'maintained') + ' for ' + row.date + '; inspect the call evidence.' : 'Stable/raised guidance is not yet verified against this report’s call.');

  const price = num(data?.spot);
  const high = num(f.fiftyTwoWeekHigh);
  const drawdown = price > 0 && high > 0 ? num((1 - price / high) * 100) : null;
  check('drawdown', 'Room below prior highs', drawdown == null ? 'missing' : drawdown >= 15 ? 'pass' : 'fail',
    drawdown == null ? 'Prior high or price unavailable; no discount claim.' : drawdown >= 15 ? drawdown.toFixed(1) + '% below the 52-week high. This proves it is below a recorded high; exact lifetime ATH distance is unavailable.' : 'Only ' + drawdown.toFixed(1) + '% below the 52-week high; this recovery screen requires at least 15%.');

  const margin = num(f.operatingMargin);
  check('operations', 'Operating profitability', margin == null ? 'missing' : margin > 0 ? 'pass' : 'fail',
    margin == null ? 'Operating margin unavailable.' : 'Provider operating margin ' + pct(margin) + '; inspect the financial period in Fundamentals.');
  const quarters = history(f.fcfHistory).slice(-4);
  const consecutive = quarters.length === 4 && quarters.every((q,i) => !i || (Date.parse(q.date) - Date.parse(quarters[i-1].date)) / 86400000 >= 60 && (Date.parse(q.date) - Date.parse(quarters[i-1].date)) / 86400000 <= 120);
  const recentFcf = consecutive && now - dayMs(quarters[3].date) <= 180 * 86400000;
  const fcfSum = recentFcf ? quarters.reduce((sum,q) => sum + q.value, 0) : null;
  const fcf = num(fcfSum);
  const positiveQuarters = quarters.filter(q => q.value > 0).length;
  check('cashflow', 'Cash generation', fcf == null ? 'missing' : fcf > 0 && positiveQuarters >= 3 ? 'pass' : 'fail',
    fcf == null ? 'Four recent consecutive FCF quarters unavailable; no TTM cash-flow claim.' : positiveQuarters + '/4 quarters generated positive FCF; four-quarter sum through ' + quarters[3].date + '.');
  const cash = num(f.totalCash) >= 0 ? num(f.totalCash) : null, debt = num(f.totalDebt) >= 0 ? num(f.totalDebt) : null, de = num(f.debtToEquity);
  const financial = /financial|bank|insurance/i.test((f.sector || '') + ' ' + (f.industry || ''));
  const balance = financial ? null : de != null && de < 0 ? false : cash != null && debt != null && cash >= debt ? true : de != null ? de <= 200 : null;
  check('balance', 'Balance sheet', balance == null ? 'missing' : balance ? 'pass' : 'fail', financial ? 'Banks and insurers need sector-specific capital evidence.' : balance == null ? 'Cash, debt or usable debt/equity evidence missing.' : de != null && de < 0 ? 'Negative equity needs review; a low-looking ratio is not a pass.' : cash != null && debt != null && cash >= debt ? 'Reported cash covers debt.' : 'Provider debt/equity ' + de.toFixed(1) + '%; screen ceiling 200%.');
  const rev = history(f.revenueHistory).filter(q => q.value > 0);
  const lastRev = rev[rev.length-1];
  const priorRev = lastRev && rev.find(q => { const days = (Date.parse(lastRev.date)-Date.parse(q.date))/86400000; return days >= 330 && days <= 400; });
  const revenueGrowth = priorRev ? num((lastRev.value / priorRev.value - 1) * 100) : null;
  check('revenue', 'Revenue durability', revenueGrowth == null ? 'missing' : revenueGrowth >= 0 ? 'pass' : 'fail', revenueGrowth == null ? 'Comparable year-ago revenue quarter unavailable.' : pct(revenueGrowth) + ' for quarter ending ' + lastRev.date + ' versus ' + priorRev.date + '.');
  const forwardPE = num(f.forwardPE), peg = num(f.pegRatio), cap = num(f.marketCap);
  const financialCurrency = typeof f.financialCurrency === 'string' && /^[A-Z]{3}$/.test(f.financialCurrency) ? f.financialCurrency : null;
  // US-listed quote/market-cap currency is USD. Do not divide an issuer's
  // local-currency cash flows by it without a verified conversion.
  const fcfYield = financialCurrency === 'USD' && fcf != null && cap > 0 ? num(fcf / cap * 100) : null;
  check('valuation', 'Valuation context', forwardPE > 0 ? 'context' : 'missing', forwardPE > 0 ? 'Forward P/E ' + forwardPE.toFixed(1) + '×' + (peg > 0 ? ' · PEG ' + peg.toFixed(2) : '') + '. Estimates are not a recovery price target; compare peers.' : 'Forward valuation unavailable; do not infer cheapness from the selloff.');

  const series = data?.priceSeries || {};
  const byDate = new Map();
  (Array.isArray(series.t) ? series.t : []).forEach((date,i) => {
    const stamp = dayMs(date), close = num(series.c?.[i]), low = num(series.l?.[i]);
    if (stamp != null && stamp <= now && close > 0) byDate.set(date, { date, close, low: low > 0 && low <= close ? low : null });
  });
  const bars = [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
  const last = bars[bars.length-1];
  const prior = bars[bars.length-2];
  const sma20 = bars.length >= 20 ? num(bars.slice(-20).reduce((sum,b) => sum+b.close,0)/20) : null;
  const prevSma20 = bars.length >= 21 ? num(bars.slice(-21,-1).reduce((sum,b) => sum+b.close,0)/20) : null;
  const postBars = bars.filter(b => (row.session === 'AM' ? b.date >= row.date : b.date > row.date));
  const confirmed = sma20 != null && prevSma20 != null && last && prior && postBars.length >= 2 && last.close > sma20 && prior.close > prevSma20;
  check('confirmation', 'Price stabilization', !last || sma20 == null ? 'missing' : confirmed ? 'pass' : 'wait', confirmed ? 'Two post-report closes above their own 20-session averages. Reference confirmation only.' : 'Wait for two post-report closes above their 20-session averages.');
  const referenceEntry = last && sma20 != null ? Math.max(last.close, sma20) : null;
  const lows = postBars.map(b => b.low).filter(v => v > 0);
  const defense = lows.length === postBars.length && lows.length ? Math.min(...lows) : null;
  const target = num(event?.closeBefore) > 0 ? num(event.closeBefore) : null;
  const rr = target > referenceEntry && referenceEntry > defense && defense > 0 ? num((target-referenceEntry)/(referenceEntry-defense)) : null;
  check('payoff', 'Recovery room', !referenceEntry || !defense || !target ? 'missing' : rr != null && rr >= 1.5 ? 'pass' : 'fail',
    !referenceEntry || !defense || !target ? 'Entry reference, post-report low or pre-report close unavailable.' : target <= referenceEntry ? 'The pre-report close is already at/below the entry reference. This recovery path is spent.' : rr == null || rr < 1.5 ? 'Less than 1.5:1 room to the pre-report close against the post-report low.' : rr.toFixed(2) + ':1 reference room to the pre-report close. This is an anchor, not a forecast.');
  const quoteStamp = data?.quoteAsOf;
  const numericStamp = typeof quoteStamp === 'string' && /^\d+(?:\.\d+)?$/.test(quoteStamp) ? Number(quoteStamp) : quoteStamp;
  const quoteMs = typeof numericStamp === 'number' ? (numericStamp < 1e12 ? numericStamp * 1000 : numericStamp) : typeof quoteStamp === 'string' ? Date.parse(quoteStamp) : NaN;
  const quoteDate = new Date(quoteMs);
  const quoteDay = Number.isFinite(quoteDate.getTime()) ? quoteDate.toISOString().slice(0,10) : null;
  const latestFinancialDay = lastRev?.date;
  const ageDays = latestFinancialDay ? (now - Date.parse(latestFinancialDay))/86400000 : null;
  const newerReport = events.some(e => e.date > row.date);
  const reportQuarter = dayMs(event?.qEnd);
  const latestFcfDay = quarters[quarters.length - 1]?.date;
  // Recent financials can still predate the specific earnings event being
  // researched. Require both histories to cover its reported fiscal quarter.
  const coversReport = reportQuarter == null || reportQuarter <= now && dayMs(latestFinancialDay) != null && dayMs(latestFinancialDay) >= reportQuarter && dayMs(latestFcfDay) != null && dayMs(latestFcfDay) >= reportQuarter;
  const currentData = coversReport && !newerReport && dayMs(row.date) != null && last && quoteDay && quoteDay >= row.date && postBars.length && now >= Date.parse(last.date) && now - Date.parse(last.date) <= 7*86400000 && now >= quoteMs && now-quoteMs <= 7*86400000 && ageDays != null && ageDays >= 0 && ageDays <= 180;
  check('freshness', 'Evidence dates', currentData ? 'pass' : 'missing', 'Price history ' + (last?.date || 'unavailable') + ' · quote ' + (quoteDay || 'unavailable') + ' · revenue quarter ' + (latestFinancialDay || 'unavailable') + ' · FCF quarter ' + (latestFcfDay || 'unavailable') + '. ' + (newerReport ? 'A newer earnings report exists; refresh the report queue before assessing recovery.' : !coversReport ? 'Financial evidence does not yet cover the report quarter ending ' + event.qEnd + '; refresh revenue and FCF history before assessing recovery.' : currentData ? 'Reference snapshot; verify quotes before any order.' : 'Evidence is missing, predates the report or is too old for current recovery research.'));
  const failed = checks.filter(c => c.state === 'fail');
  const missing = checks.filter(c => c.state === 'missing');
  const state = failed.length ? 'blocked' : missing.length ? 'incomplete' : confirmed ? 'supported' : 'waiting';
  return { state, checks, guidance, guidanceSource, price, drawdown, forwardPE, financialCurrency, fcf, fcfYield, revenueGrowth, sma20, referenceEntry, defense, target, rr, priceDate: last?.date || null };
}

// Explicit, free-only source catalog for Owner Historical Data. No paid adapter
// or paid credentials are accepted by the collector.
export const MIN_HISTORICAL_YEARS = 10;
export const HISTORICAL_SOURCE_KEY = 'historical-source-history.json';
// Long price indexes run the same seasonal and election-cycle studies as the
// ETFs, so those studies reach back to 1950 (S&P 500) and 1971 (Nasdaq)
// instead of each fund's launch. They also feed the event studies.
const INDEX_MARKETS = [
  ['^GSPC', 'S&P 500 index', '1949-12-01', 'Price index without dividends. Starts December 1949 so 1950 windows have a prior close. Sessions before 1990 follow the provider\'s own session list.'],
  ['^IXIC', 'Nasdaq Composite index', '1971-02-05', 'Price index without dividends, from its 1971 launch. Sessions before 1990 follow the provider\'s own session list.'],
].map(([id, label, since, note]) => Object.freeze({ id, label, group: 'US stocks', since, long: true, provider: 'Yahoo Finance', publisher: 'Index prices', frequency: 'daily', unit: 'Index points', url: `https://finance.yahoo.com/quote/${encodeURIComponent(id)}/history/`, feeUsd: 0, note }));
export const HISTORICAL_MARKETS = Object.freeze([...INDEX_MARKETS, ...[
  ['SPY','S&P 500 ETF','US stocks'], ['QQQ','Nasdaq-100 ETF','US stocks'],
  ['IWM','Russell 2000 ETF','US stocks'], ['DIA','Dow 30 ETF','US stocks'],
  ['MDY','S&P MidCap 400 ETF','US stocks'], ['VTI','Total US stock market ETF','US stocks'],
  ['SHY','1–3 year Treasury ETF','Bonds'], ['IEF','7–10 year Treasury ETF','Bonds'],
  ['TLT','20+ year Treasury ETF','Bonds'], ['TIP','Inflation-protected Treasury ETF','Bonds'],
  ['LQD','Investment-grade corporate bond ETF','Bonds'], ['HYG','High-yield corporate bond ETF','Bonds'],
  ['GLD','Gold trust','Commodities'], ['SLV','Silver trust','Commodities'],
  ['USO','WTI oil futures fund','Commodities'], ['UNG','Natural gas futures fund','Commodities'],
  ['DBC','Diversified commodity futures fund','Commodities'],
].map(([id, label, group]) => Object.freeze({ id, label, group, provider: 'Yahoo Finance', publisher: 'Exchange-traded fund prices', frequency: 'daily', unit: 'USD per share', url: `https://finance.yahoo.com/quote/${id}/history/`, feeUsd: 0, note: group === 'Commodities' ? 'Fund price, not physical spot. Futures funds include roll effects and fund expenses.' : group === 'Bonds' ? 'Fund price, not bond yield; cash distributions are excluded from these price returns.' : 'ETF proxy, not a dividend-reinvested index or a historical all-stock membership database.' }))]);
// Event-study histories. Downloaded on the same daily refresh as the markets
// above but kept out of the seasonal studies and the ten-year coverage count:
// they feed only the dated event studies and the "resembles now" checks.
// The S&P 500 and Nasdaq indexes above feed the event studies too.
export const HISTORICAL_EVENT_MARKETS = Object.freeze([
  ['AAPL', 'Apple', '1990-01-01', false, 'WWDC study only. Split-adjusted closes.'],
  ['KRE', 'Regional bank ETF', '2006-06-01', false, 'Bank-stress check only.'],
  ['GME', 'GameStop', '2002-02-01', false, 'Short-squeeze episodes only. Split-adjusted closes.'],
].map(([id, label, since, long, note]) => Object.freeze({ id, label, group: 'Event studies', since, long, provider: 'Yahoo Finance', publisher: long ? 'Index prices' : 'Exchange-listed prices', frequency: 'daily', unit: long ? 'Index points' : 'USD per share', url: `https://finance.yahoo.com/quote/${encodeURIComponent(id)}/history/`, feeUsd: 0, note })));
// Release calendars for the economic-release study (FRED API, needs the
// existing FRED_API_KEY). FOMC days come from the Fed calendar in code.
export const HISTORICAL_RELEASES = Object.freeze([
  Object.freeze({ id: 'cpi', releaseId: 10, label: 'CPI release dates', publisher: 'BLS via FRED', url: 'https://fred.stlouisfed.org/release?rid=10' }),
  Object.freeze({ id: 'jobs', releaseId: 50, label: 'Jobs report release dates', publisher: 'BLS via FRED', url: 'https://fred.stlouisfed.org/release?rid=50' }),
]);
const fred = (id, label, group, publisher, frequency, unit, lagDays, note = '') => Object.freeze({ id, label, group, publisher, frequency, unit, lagDays, note, provider: 'FRED', url: `https://fred.stlouisfed.org/series/${id}`, feeUsd: 0 });
export const HISTORICAL_CONTEXT = Object.freeze([
  fred('CPIAUCSL','Consumer prices','Inflation','BLS','monthly','Index, 1982–84 = 100',75,'Seasonally adjusted, latest revised vintage. Chart uses observation periods, not release dates.'),
  fred('CPILFESL','Core consumer prices','Inflation','BLS','monthly','Index, 1982–84 = 100',75,'Excludes food and energy; latest revised vintage.'),
  fred('UNRATE','Unemployment rate','Employment','BLS','monthly','Percent',75),
  fred('PAYEMS','Nonfarm payroll employment','Employment','BLS','monthly','Thousands of persons',75),
  fred('GDPC1','Real gross domestic product','Growth','BEA','quarterly','Billions of chained 2017 dollars, annual rate',235,'The date is the first day of the reported quarter, not its publication date. Latest revised vintage, not information known at each past date.'),
  fred('INDPRO','Industrial production','Growth','Federal Reserve','monthly','Index, 2017 = 100',75),
  fred('RSAFS','Retail sales','Growth','US Census Bureau','monthly','Millions of dollars',75),
  fred('DFF','Effective federal funds rate','Rates','Federal Reserve','daily','Percent',7),
  fred('DGS2','2-year Treasury yield','Rates','US Treasury / Federal Reserve','daily','Percent',7),
  fred('DGS10','10-year Treasury yield','Rates','US Treasury / Federal Reserve','daily','Percent',7),
  fred('T10Y2Y','10-year minus 2-year yield spread','Rates','Federal Reserve','daily','Percentage points',7,'Negative values are preserved. Yield changes are not bond investment returns.'),
  fred('WALCL','Federal Reserve total assets','Liquidity','Federal Reserve','weekly','Millions of dollars',16),
  fred('RRPONTSYD','Overnight reverse-repo usage','Liquidity','Federal Reserve Bank of New York','daily','Billions of dollars',7,'Zero usage is a valid observation.'),
  fred('WTREGEN','Treasury General Account balance','Liquidity','Federal Reserve','weekly','Millions of dollars',16),
  fred('DTWEXBGS','Trade-weighted broad US dollar','Currency','Federal Reserve','daily','Index, January 2006 = 100',12,'Daily observations are published on the weekly H.10 release cadence.'),
  fred('USREC','US recession indicator','Recessions','NBER chronology via Federal Reserve','monthly','0 or 1',75,'Retrospective recession chronology. Not an as-known recession signal or a prediction.'),
  fred('VIXCLS','VIX implied volatility','Volatility','Cboe','daily','Index points',7,'Cboe data, citation required. An implied-volatility index, not an investable return series.'),
  fred('STLFSI4','Financial stress index','Credit and stress','Federal Reserve Bank of St. Louis','weekly','Index, normal conditions = 0',16,'Citation required. Revised composite methodology; not a corporate credit-spread series.'),
  fred('DCOILWTICO','WTI oil spot price','Commodity spot','US Energy Information Administration','daily','USD per barrel',10,'Physical spot benchmark, distinct from the USO fund. Negative prices remain valid.'),
  fred('DHHNGSP','Henry Hub natural gas spot','Commodity spot','US Energy Information Administration','daily','USD per million Btu',10,'Physical spot benchmark, distinct from the UNG futures fund.'),
]);
// Cached in the same file and refreshed on the same once-a-day pass, but not
// Historical Data studies: FRED only publishes about three years of these
// ICE spreads. The Bottom tracker reads them together with the overlapping
// HISTORICAL_CONTEXT series (CPI, unemployment, 2Y, 10Y, dollar, VIX, stress,
// WTI), so each FRED series is downloaded once a day for the whole site.
export const SHARED_FRED_EXTRA = Object.freeze([
  fred('BAMLH0A0HYM2','High-yield bond spread','Credit and stress','ICE Data Indices via FRED','daily','Percentage points',7,'About three years of public history; Bottom tracker only.'),
  fred('BAMLC0A0CM','Investment-grade bond spread','Credit and stress','ICE Data Indices via FRED','daily','Percentage points',7,'About three years of public history; Bottom tracker only.'),
]);
export const SHARED_FRED_IDS = Object.freeze([...HISTORICAL_CONTEXT, ...SHARED_FRED_EXTRA].map(s => s.id));
export const PAID_HISTORY_OPTIONS = Object.freeze([
  { id: 'massive-developer', name: 'Massive Stocks Developer', cost: '$79/month', purpose: 'Ten-year US stock API history and corporate actions with a supported API.', limitation: 'Individual/non-professional pricing. A two-owner site or redistribution may require a separate business license and quote.', url: 'https://massive.com/pricing', status: 'Not enabled · approval required' },
  { id: 'massive-advanced', name: 'Massive Stocks Advanced', cost: '$199/month', purpose: '20+ years of US stock history, trades, quotes and corporate actions.', limitation: 'Individual/non-professional pricing. Business/display rights require confirmation; not necessary for the current ETF studies.', url: 'https://massive.com/pricing', status: 'Not enabled · approval required' },
  { id: 'norgate-platinum', name: 'Norgate US Stocks Platinum', cost: '$630/year, or $346.50 per six months', purpose: 'Delisted stocks and historical index constituents back to 1990 for tests that avoid survivorship bias.', limitation: 'Desktop updater and server/display licensing need confirmation. Not a drop-in hosted API subscription.', url: 'https://norgatedata.com/stockmarketpackages.php', status: 'Not enabled · approval required' },
  { id: 'options-intraday', name: 'Historical options / tick / consensus data', cost: 'Provider quote required', purpose: 'Point-in-time option chains, expiration open interest, intraday events or original analyst-consensus surprises.', limitation: 'A ten-year daily ETF cache cannot establish these histories. No paid endpoint is connected.', url: 'https://datashop.cboe.com/', status: 'Not enabled · approval required' },
]);
const DAY = 86400000;
export function cleanSourceRows(rows, cutoff) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = r?.t ?? r?.date, value = r?.v ?? r?.value ?? r?.c;
    if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isFinite(Date.parse(t)) || new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) !== t || (cutoff && t > cutoff) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    map.set(t, value);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => ({ t, v }));
}
export function historicalCoverage(rows, frequency = 'daily', cutoff = null) {
  const raw = cleanSourceRows(rows, cutoff);
  const limits = { daily: [2300, 10], weekly: [470, 24], monthly: [110, 70], quarterly: [36, 140] };
  const [minimum, allowedGap] = limits[frequency] || limits.daily;
  const gapIndices = raw.slice(1).map((r, i) => ({ i: i + 1, days: (Date.parse(r.t) - Date.parse(raw[i].t)) / DAY })).filter(g => g.days > allowedGap);
  // Historical reporting can be sparse before a series becomes regular. Only
  // the contiguous tail ending at the latest observation can qualify. Earlier
  // gaps remain reported; no interpolation or invented zero observations.
  const start = gapIndices.at(-1)?.i || 0, clean = raw.slice(start);
  const firstDate = clean[0]?.t || null, lastDate = clean.at(-1)?.t || null;
  const years = firstDate && lastDate ? (Date.parse(lastDate) - Date.parse(firstDate)) / (365.2425 * DAY) : 0;
  // Use an exact calendar anniversary, avoiding leap-day float thresholds.
  const anniversary = firstDate ? `${Number(firstDate.slice(0, 4)) + MIN_HISTORICAL_YEARS}${firstDate.slice(4)}` : null;
  const enoughSpan = !!(lastDate && lastDate >= anniversary);
  const ready = enoughSpan && clean.length >= minimum;
  return { firstDate, lastDate, observations: clean.length, years: Math.round(years * 100) / 100, minimumYears: MIN_HISTORICAL_YEARS, gapCount: gapIndices.length, largestGapDays: gapIndices.length ? Math.max(...gapIndices.map(g => g.days)) : 0, rawFirstDate: raw[0]?.t || null, excludedEarlyObservations: start, status: !clean.length ? 'missing' : !enoughSpan ? 'under-ten-years' : !ready ? 'gaps-or-thin' : 'ready' };
}
function monthlyCloses(rows) {
  const map = new Map(); for (const row of rows) map.set(row.t.slice(0, 7), row);
  return [...map.values()].slice(-600);
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function buildSourceCoverage({ symbols, eventSymbols = {}, releases = {}, context = {}, records = {}, cutoff }) {
  const marketCoverage = HISTORICAL_MARKETS.map(def => ({ ...def, ...historicalCoverage((symbols[def.id] || []).map(r => ({ t: r.t, v: r.c })), def.frequency, cutoff), checkedAt: records[def.id]?.checkedAt || null, lastSuccessAt: records[def.id]?.lastSuccessAt || null, collectedAtIso: records[def.id]?.collectedAtIso || null, confirmedThrough: records[def.id]?.confirmedThrough || null, error: records[def.id]?.error || null }));
  const contextSeries = HISTORICAL_CONTEXT.map(def => {
    const raw = cleanSourceRows(context[def.id]?.rows || context[def.id] || [], cutoff), coverage = historicalCoverage(raw, def.frequency, cutoff);
    const rows = raw.filter(r => r.t >= coverage.firstDate);
    const ageDays = coverage.lastDate ? Math.floor((Date.parse(cutoff) - Date.parse(coverage.lastDate)) / DAY) : null;
    const latest = rows.at(-1)?.v ?? null;
    const last = coverage.lastDate || cutoff;
    const lastTen = rows.filter(r => r.t >= `${Number(last.slice(0, 4)) - 10}${last.slice(4)}`);
    return { ...def, ...coverage, ageDays, stale: ageDays == null || ageDays > def.lagDays, checkedAt: records[def.id]?.checkedAt || null, lastSuccessAt: records[def.id]?.lastSuccessAt || null, collectedAtIso: records[def.id]?.collectedAtIso || null, confirmedThrough: records[def.id]?.confirmedThrough || null, error: records[def.id]?.error || null, latest, median10y: coverage.status === 'ready' ? median(lastTen.map(r => r.v)) : null, percentile10y: coverage.status === 'ready' && lastTen.length ? Math.round(lastTen.filter(r => r.v <= latest).length / lastTen.length * 100) : null, chart: coverage.status === 'ready' ? monthlyCloses(rows) : [], vintage: 'Latest revised observations; not point-in-time releases' };
  });
  // Event-study inputs are listed separately; they are not part of the
  // ten-year coverage count above.
  const eventMarkets = HISTORICAL_EVENT_MARKETS.map(def => ({ ...def, ...historicalCoverage((eventSymbols[def.id] || []).map(r => ({ t: r.t, v: r.c })), def.frequency, cutoff), checkedAt: records[def.id]?.checkedAt || null, lastSuccessAt: records[def.id]?.lastSuccessAt || null, error: records[def.id]?.error || null }));
  const releaseCalendars = HISTORICAL_RELEASES.map(def => { const dates = (releases[def.id]?.dates || []).filter(d => d <= cutoff); return { ...def, releases: dates.length, firstDate: dates[0] || null, lastDate: dates.at(-1) || null, checkedAt: records[`release:${def.id}`]?.checkedAt || null, error: records[`release:${def.id}`]?.error || null }; });
  return { markets: marketCoverage, context: contextSeries, eventMarkets, releaseCalendars, minimumYears: MIN_HISTORICAL_YEARS, ready: marketCoverage.filter(s => s.status === 'ready').length + contextSeries.filter(s => s.status === 'ready').length, total: marketCoverage.length + contextSeries.length, providerFeeUsd: 0, paidOptions: PAID_HISTORY_OPTIONS, boundaries: [ 'Coverage is tracked for the listed datasets; this is not every vendor, every individual stock or every possible market saying.', 'Daily ETF prices do not supply delisted-company membership, total-return indexes, option chains, original macro-release vintages or consensus surprises.', 'Free access is not a blanket redistribution license. Source attribution and original publisher terms still apply; paid/display agreements require owner sign-off.' ] };
}

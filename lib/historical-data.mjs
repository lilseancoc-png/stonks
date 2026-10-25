// Descriptive, owner-only event studies over the existing Yahoo ETF close cache.
// No network, AI, trade signals, or changes to grades/picks. Percentages are points.
import { HISTORICAL_MARKETS, buildSourceCoverage } from './historical-sources.mjs';
import { completedCloseCutoff, historicalTradingDate, isHistoricalTradingDate } from './historical-market-calendar.mjs';
import { cleanHistoricalBars, confirmedMarketBars } from './historical-market-history.mjs';
export { completedCloseCutoff } from './historical-market-calendar.mjs';
export { cleanHistoricalBars } from './historical-market-history.mjs';
export const HISTORICAL_VERSION = 2;
export const HISTORICAL_SYMBOLS = Object.freeze(HISTORICAL_MARKETS.map(s => s.id));
const DAY = 86400000;
const date = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ms = t => Date.parse(`${t}T00:00:00Z`);
const dateBefore = t => new Date(ms(t) - DAY).toISOString().slice(0, 10);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const round = n => finite(n) ? Math.round(n * 10000) / 10000 : null;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
export function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b), i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
function electionDay(y) {
  const first = new Date(ms(date(y, 11, 1))).getUTCDay();
  return date(y, 11, 2 + ((8 - first) % 7)); // Tuesday after the first Monday.
}
function santaDates(y) {
  const dec = Array.from({ length: 14 }, (_, i) => date(y, 12, 18 + i)).filter(isHistoricalTradingDate).slice(-5);
  const jan = Array.from({ length: 8 }, (_, i) => date(y + 1, 1, i + 1)).filter(isHistoricalTradingDate).slice(0, 2);
  return [...dec, ...jan];
}
const calendar = (y, a, b, c, d, next = 0) => ({ start: date(y, a, b), end: date(y + next, c, d), mode: 'calendar' });
const eachYear = () => true;
function thanksgiving(y) {
  const d = new Date(ms(date(y, 11, 1))).getUTCDay();
  return 22 + ((4 - d + 7) % 7);
}
export const HISTORICAL_PATTERNS = Object.freeze([
  { id: 'santa', name: 'Santa Rally', group: 'Seasonal', claim: 'The year-end seven-session window is often positive.', definition: 'Last five trading sessions of December plus the first two of January. Return starts at the close before those five December sessions.', applies: eachYear, window: y => ({ start: date(y, 12, 1), end: date(y + 1, 1, 15), mode: 'santa' }) },
  { id: 'january', name: 'January effect', group: 'Seasonal', claim: 'January is sometimes described as an unusually strong month, especially for smaller companies.', definition: 'Previous December close through the final January close. Compare IWM with SPY and QQQ; this does not isolate small-company tax selling.', applies: eachYear, window: y => calendar(y, 1, 1, 1, 31) },
  { id: 'september', name: 'September weakness', group: 'Seasonal', claim: 'September is often described as a weaker month.', definition: 'Final August close through the final September close.', applies: eachYear, window: y => calendar(y, 9, 1, 9, 30) },
  { id: 'q4', name: 'Fourth-quarter rally', group: 'Seasonal', claim: 'The final quarter is often described as a stronger part of the year.', definition: 'Final September close through the final December close.', applies: eachYear, window: y => calendar(y, 10, 1, 12, 31) },
  { id: 'q1', name: 'First-quarter seasonality', group: 'Seasonal', claim: 'Measure the first quarter rather than assume an election or January effect.', definition: 'Prior year-end close through the final March close.', applies: eachYear, window: y => calendar(y, 1, 1, 3, 31) },
  { id: 'q2', name: 'Second-quarter seasonality', group: 'Seasonal', claim: 'Measure the spring quarter as a separate calendar window.', definition: 'Final March close through the final June close.', applies: eachYear, window: y => calendar(y, 4, 1, 6, 30) },
  { id: 'q3', name: 'Third-quarter seasonality', group: 'Seasonal', claim: 'Measure the summer quarter, including the commonly discussed September effect.', definition: 'Final June close through the final September close.', applies: eachYear, window: y => calendar(y, 7, 1, 9, 30) },
  { id: 'december', name: 'December seasonality', group: 'Seasonal', claim: 'A full December return is a different window from the seven-session Santa Rally.', definition: 'Final November close through the final December close.', applies: eachYear, window: y => calendar(y, 12, 1, 12, 31) },
  { id: 'thanksgiving', name: 'Thanksgiving week', group: 'Seasonal', claim: 'The short Thanksgiving trading week is often discussed as a positive seasonal window.', definition: 'Prior Friday close through the Friday after the fourth Thursday of November. Uses actual available closes, including the Friday half day.', applies: eachYear, window: y => calendar(y, 11, thanksgiving(y) - 3, 11, thanksgiving(y) + 1) },
  { id: 'summer', name: 'Sell in May', group: 'Seasonal', claim: 'May through October is said to lag the winter half-year.', definition: 'Final April close through the final October close. This is a price-return comparison, not a tested strategy after cash interest, taxes, or trading costs.', applies: eachYear, window: y => calendar(y, 5, 1, 10, 31) },
  { id: 'winter', name: 'November–April', group: 'Seasonal', claim: 'The winter half-year is said to outperform May through October.', definition: 'Final October close through the final April close of the following year.', applies: eachYear, window: y => calendar(y, 11, 1, 4, 30, 1) },
  { id: 'midterm', name: 'Midterm election year', group: 'Election cycle', claim: 'The second year of a presidential term is said to be more difficult for stocks.', definition: 'Prior year-end close through December in years with year modulo 4 equal to 2. Presidential-cycle years are calendar labels, not a causal explanation.', applies: y => y % 4 === 2, window: y => calendar(y, 1, 1, 12, 31) },
  { id: 'pre-midterm', name: 'Before the midterms', group: 'Election cycle', claim: 'Markets are said to be weaker in the run-up to midterm elections.', definition: 'Prior year-end close through the last close before the November election day in midterm years.', applies: y => y % 4 === 2, window: y => ({ start: date(y, 1, 1), end: date(y, 11, Number(electionDay(y).slice(8)) - 1), mode: 'calendar' }) },
  { id: 'post-midterm', name: 'After the midterms', group: 'Election cycle', claim: 'Stocks are said to strengthen after midterm uncertainty clears.', definition: 'Election-day close through the next 252 observed trading sessions, approximately one trading year. This is not exactly twelve calendar months.', applies: y => y % 4 === 2, window: y => ({ start: electionDay(y), end: null, mode: 'forward', sessions: 252 }) },
  { id: 'election', name: 'Presidential election year', group: 'Election cycle', claim: 'Election years are often compared with the rest of the four-year cycle.', definition: 'Prior year-end close through December in presidential election years. No party or winner conditioning.', applies: y => y % 4 === 0, window: y => calendar(y, 1, 1, 12, 31) },
  { id: 'pre-election', name: 'Pre-election year', group: 'Election cycle', claim: 'The third year of a presidential term is often described as stronger.', definition: 'Prior year-end close through December in years immediately before presidential elections.', applies: y => y % 4 === 3, window: y => calendar(y, 1, 1, 12, 31) },
  { id: 'post-election', name: 'Post-election year', group: 'Election cycle', claim: 'The first year of a presidential term is a separate historical comparison.', definition: 'Prior year-end close through December in years immediately after presidential elections.', applies: y => y % 4 === 1, window: y => calendar(y, 1, 1, 12, 31) },
]);

function lowerBound(bars, t) {
  let a = 0, b = bars.length;
  while (a < b) { const m = (a + b) >> 1; if (bars[m].t < t) a = m + 1; else b = m; }
  return a;
}
function lastOn(bars, t) { const i = lowerBound(bars, t); return i < bars.length && bars[i].t === t ? i : i - 1; }
function metrics(bars, i) {
  if (i < 63) return { ytdPct: null, trend63Pct: null, volatility20Pct: null, drawdown252Pct: null };
  const first = lowerBound(bars, `${bars[i].t.slice(0, 4)}-01-01`), base = first - 1;
  const returns = bars.slice(i - 20, i + 1).slice(1).map((b, j) => Math.log(b.c / bars[i - 20 + j].c));
  const avg = mean(returns), variance = returns.reduce((s, x) => s + (x - avg) ** 2, 0) / (returns.length - 1);
  return { ytdPct: base >= 0 ? round((bars[i].c / bars[base].c - 1) * 100) : null, trend63Pct: round((bars[i].c / bars[i - 63].c - 1) * 100), volatility20Pct: round(Math.sqrt(variance * 252) * 100), drawdown252Pct: i >= 251 ? round((bars[i].c / Math.max(...bars.slice(i - 251, i + 1).map(b => b.c)) - 1) * 100) : null };
}
function windowRows(bars, pattern, year, asOf, partial = false) {
  const w = pattern.window(year);
  let start = lowerBound(bars, w.start), end, complete, firstDate = w.start, lastDate = w.end, baseline;
  if (w.mode === 'santa') {
    const expected = santaDates(year), elapsed = expected.filter(t => t <= asOf);
    if (!elapsed.length) return null;
    start = lowerBound(bars, expected[0]); baseline = start - 1;
    if (elapsed.some(t => bars[lowerBound(bars, t)]?.t !== t)) return null;
    end = lastOn(bars, elapsed.at(-1)); complete = elapsed.length === 7;
    firstDate = expected[0]; lastDate = expected.at(-1);
  } else if (w.mode === 'forward') {
    baseline = lastOn(bars, w.start);
    if (baseline < 0 || bars[baseline].t !== w.start) return null;
    start = baseline + 1; end = baseline + w.sessions;
    complete = end < bars.length;
    if (!complete) end = bars.length - 1;
  } else {
    baseline = start - 1; end = lastOn(bars, w.end);
    const firstSession = historicalTradingDate(w.start, 1), lastSession = historicalTradingDate(w.end);
    if (!firstSession || !lastSession || bars[start]?.t !== firstSession || bars[baseline]?.t !== historicalTradingDate(dateBefore(firstSession))) return null;
    complete = asOf >= lastSession;
    if (complete && bars[end]?.t !== lastSession) return null;
  }
  if (baseline < 0 || end < start || !bars[start] || (!partial && !complete)) return null;
  if (ms(firstDate) - ms(bars[baseline].t) > 7 * DAY || ms(bars[start].t) - ms(firstDate) > 4 * DAY) return null;
  const sample = bars.slice(baseline, end + 1);
  if (sample.some((b, i) => i && ms(b.t) - ms(sample[i - 1].t) > 7 * DAY)) return null;
  if (w.mode === 'calendar' && complete && end - start + 1 < Math.floor((ms(w.end) - ms(w.start)) / DAY * .55)) return null;
  const base = bars[baseline].c, values = sample.map(b => (b.c / base - 1) * 100);
  const progress = w.mode === 'calendar'
    ? t => Math.max(0, Math.min(100, (ms(t) - ms(firstDate) + DAY) / Math.max(DAY, ms(lastDate) - ms(firstDate) + DAY) * 100))
    : (_t, i) => i / (w.mode === 'santa' ? 7 : w.sessions) * 100;
  const points = sample.map((b, i) => ({ x: i === 0 ? 0 : round(progress(b.t, i)), y: round(values[i]) }));
  if (complete) points[points.length - 1].x = 100;
  let peak = base, worst = 0;
  for (const b of sample) { peak = Math.max(peak, b.c); worst = Math.min(worst, (b.c / peak - 1) * 100); }
  return { year, start: bars[start].t, end: bars[end].t, baseline: bars[baseline].t, complete, sessions: end - baseline, returnPct: round(values.at(-1)), drawdownPct: round(worst), path: points, entry: metrics(bars, baseline) };
}
function pathAt(path, x) {
  let value = 0;
  for (const point of path) { if (point.x > x) break; value = point.y; }
  return value;
}
export function summarizeHistory(episodes) {
  const returns = episodes.map(e => e.returnPct), n = returns.length, avg = mean(returns);
  const sd = n > 1 ? Math.sqrt(returns.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) : null;
  const early = mean(returns.slice(0, Math.floor(n / 2))), late = mean(returns.slice(Math.floor(n / 2)));
  return { n, meanPct: round(avg), medianPct: round(quantile(returns, .5)), positivePct: n ? round(returns.filter(r => r > 0).length / n * 100) : null, worstPct: n ? round(Math.min(...returns)) : null, bestPct: n ? round(Math.max(...returns)) : null, earlyMeanPct: round(early), lateMeanPct: round(late), meanRange95: n >= 10 ? [round(avg - 1.96 * sd / Math.sqrt(n)), round(avg + 1.96 * sd / Math.sqrt(n))] : null,
    evidence: n < 10 ? 'Limited sample' : (Math.sign(early) !== Math.sign(late) || Math.abs(avg) <= 1.96 * sd / Math.sqrt(n)) ? 'Mixed record' : 'Observed tendency',
    path: n ? Array.from({ length: 21 }, (_, i) => { const values = episodes.map(e => pathAt(e.path, i * 5)); return { x: i * 5, median: round(quantile(values, .5)), low: round(quantile(values, .25)), high: round(quantile(values, .75)), n }; }) : [],
  };
}
function currentYearFor(pattern, asOf) {
  let y = Number(asOf.slice(0, 4)), month = Number(asOf.slice(5, 7));
  if ((pattern.id === 'santa' && month === 1 && Number(asOf.slice(8)) <= 8) || (pattern.id === 'winter' && month <= 4)) y--;
  while (!pattern.applies(y)) y--;
  return y;
}
function typicalWindows(bars, length) {
  if (!length) return { n: 0, meanPct: null };
  const values = [];
  for (let i = length; i < bars.length; i += length) values.push((bars[i].c / bars[i - length].c - 1) * 100);
  return { n: values.length, sessions: length, meanPct: round(mean(values)) };
}
function analogs(bars, current) {
  if (!current || !finite(current.trend63Pct) || !finite(current.volatility20Pct)) return { eligible: 0, rows: [] };
  const day = bars.at(-1).t, year = Number(day.slice(0, 4)), rows = [];
  for (let y = Number(bars[0].t.slice(0, 4)) + 1; y < year; y++) {
    const target = `${y}${day.slice(4)}`, i = lastOn(bars, target);
    if (i < 251 || i + 63 >= bars.length || ms(target) - ms(bars[i].t) > 4 * DAY) continue;
    const m = metrics(bars, i);
    // Scale both differences in percentage points; no optimized weighting or outcome selection.
    const distance = Math.abs(m.trend63Pct - current.trend63Pct) / 10 + Math.abs(m.volatility20Pct - current.volatility20Pct) / 10;
    rows.push({ date: bars[i].t, ...m, distance: round(distance), next20Pct: round((bars[i + 20].c / bars[i].c - 1) * 100), next63Pct: round((bars[i + 63].c / bars[i].c - 1) * 100) });
  }
  rows.sort((a, b) => a.distance - b.distance || a.date.localeCompare(b.date));
  return { eligible: rows.length, rows: rows.slice(0, 5) };
}
function recurringEffects(bars, asOf) {
  const endYear = Number(asOf.slice(0, 4)), weekdays = [[], [], [], [], []], turn = [], expiry = [];
  for (let i = 1; i < bars.length; i++) {
    if (Number(bars[i].t.slice(0, 4)) >= endYear) continue;
    const dow = new Date(ms(bars[i].t)).getUTCDay();
    if (dow >= 1 && dow <= 5) weekdays[dow - 1].push((bars[i].c / bars[i - 1].c - 1) * 100);
    if (i + 3 < bars.length && bars[i].t.slice(0, 7) !== bars[i + 1].t.slice(0, 7) && bars[i + 1].t.slice(0, 7) === bars[i + 3].t.slice(0, 7) && Number(bars[i + 3].t.slice(0, 4)) < endYear && ms(bars[i + 3].t) - ms(bars[i - 1].t) <= 10 * DAY) turn.push((bars[i + 3].c / bars[i - 1].c - 1) * 100);
  }
  for (let y = Number(bars[0].t.slice(0, 4)); y < endYear; y++) for (let m = 1; m <= 12; m++) {
    const first = new Date(ms(date(y, m, 1))).getUTCDay(), friday = 15 + ((5 - first + 7) % 7);
    const episode = windowRows(bars, { window: () => calendar(y, m, friday - 4, m, friday) }, y, asOf);
    if (episode) expiry.push(episode.returnPct);
  }
  const stats = (label, values, unit) => ({ label, n: values.length, unit, meanPct: round(mean(values)), medianPct: round(quantile(values, .5)), positivePct: values.length ? round(values.filter(v => v > 0).length / values.length * 100) : null });
  return [ ...weekdays.map((v, i) => stats(['Monday','Tuesday','Wednesday','Thursday','Friday'][i], v, 'sessions')), stats('Turn of month: final session + first three', turn, 'monthly windows'), stats('Monthly expiration week: third-Friday calendar week', expiry, 'monthly windows') ];
}
export function buildHistoricalData({ symbols = {}, builtAtIso = new Date().toISOString(), analyzedAtIso = builtAtIso, sourceBuiltAtIso = null, sourceCache = {} } = {}) {
  const cutoff = completedCloseCutoff(analyzedAtIso), indexes = {};
  const safeSymbols = Object.fromEntries(HISTORICAL_SYMBOLS.map(s => [s, Object.hasOwn(sourceCache.symbols || {}, s)
    ? confirmedMarketBars(sourceCache.symbols[s], sourceCache.records?.[s], sourceCache.version, cutoff)
    : cleanHistoricalBars(symbols[s], sourceBuiltAtIso ? [cutoff, completedCloseCutoff(sourceBuiltAtIso)].sort()[0] : cutoff)]));
  const coverage = buildSourceCoverage({ symbols: safeSymbols, context: sourceCache.context, records: sourceCache.records, cutoff });
  for (const symbol of HISTORICAL_SYMBOLS) {
    const usable = coverage.markets.find(s => s.id === symbol);
    if (usable.status !== 'ready') continue;
    const bars = safeSymbols[symbol].filter(r => r.t >= usable.firstDate);
    const asOf = bars.at(-1).t, firstYear = Number(bars[0].t.slice(0, 4)), year = Number(asOf.slice(0, 4));
    const current = { asOf, close: bars.at(-1).c, ...metrics(bars, bars.length - 1) };
    const studies = HISTORICAL_PATTERNS.map(pattern => {
      const compareYear = currentYearFor(pattern, asOf), w = pattern.window(compareYear);
      if (w.mode === 'santa') { const dates = santaDates(compareYear); w.start = dates[0]; w.end = dates.at(-1); }
      const comparison = windowRows(bars, pattern, compareYear, cutoff, true);
      const status = asOf < w.start ? 'upcoming' : comparison?.complete ? 'complete' : comparison ? 'in-progress' : 'unavailable';
      const episodes = [];
      // Hold out the comparison occurrence even after it completes.
      for (let y = firstYear; y < compareYear; y++) if (pattern.applies(y)) {
        const e = windowRows(bars, pattern, y, asOf);
        if (e) episodes.push(e);
      }
      const ranges = Object.fromEntries([['all', firstYear], ['20y', year - 20], ['10y', year - 10]].map(([key, from]) => {
        const sample = episodes.filter(e => e.year >= from), summary = summarizeHistory(sample);
        const length = Math.round(quantile(sample.map(e => e.sessions), .5));
        const progress = comparison?.path.at(-1)?.x;
        const atProgress = finite(progress) && sample.length ? sample.map(e => pathAt(e.path, progress)) : [];
        return [key, { ...summary, comparisonAtProgress: atProgress.length ? { progress, medianPct: round(quantile(atProgress, .5)), lowPct: round(quantile(atProgress, .25)), highPct: round(quantile(atProgress, .75)), percentile: round(atProgress.filter(r => r <= comparison.returnPct).length / atProgress.length * 100) } : null, baseline: typicalWindows(bars.filter(b => Number(b.t.slice(0, 4)) >= from && b.t < w.start), length), years: sample.map(({ path, entry, ...e }) => e) }];
      }));
      return { id: pattern.id, name: pattern.name, group: pattern.group, claim: pattern.claim, definition: pattern.definition, comparison: { year: compareYear, status, expectedStart: w.start, expectedEnd: w.end, ...(comparison || {}), path: comparison?.path.filter((_, i) => i % Math.max(1, Math.floor(comparison.path.length / 60)) === 0 || i === comparison.path.length - 1) || [] }, ranges };
    });
    const monthly = Array.from({ length: 12 }, (_, m) => {
      const p = { window: y => calendar(y, m + 1, 1, m + 1, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) }, episodes = [];
      for (let y = firstYear; y < year; y++) { const e = windowRows(bars, p, y, asOf); if (e) episodes.push(e); }
      return { month: m + 1, ...summarizeHistory(episodes), path: undefined };
    });
    const def = HISTORICAL_MARKETS.find(s => s.id === symbol);
    indexes[symbol] = { label: def.label, assetClass: def.group, firstDate: bars[0].t, asOf, sessions: bars.length, ageDays: round((ms(cutoff) - ms(asOf)) / DAY), current, analogs: analogs(bars, current), studies, monthly, recurring: recurringEffects(bars, asOf) };
  }
  return { version: HISTORICAL_VERSION, builtAtIso, analyzedAtIso, sourceBuiltAtIso, cutoff, indexes, coverage, source: { name: 'Yahoo Finance daily ETF closes · cached observations', url: 'https://finance.yahoo.com/quote/SPY/history/', returnType: 'ETF price return without cash-distribution reinvestment, taxes, inflation or separately modeled transaction costs. Fund expenses and futures-roll effects may already affect prices. Yahoo historical adjustments are inherited. This is not a total-return index; fund prices are not yields or physical spot returns.' }, lore: [ { name: 'Super Bowl indicator', label: 'Market lore · not tested', reason: 'Requires football results outside this dataset. No market statistic or causal claim is inferred.' }, { name: 'Sell on a full moon', label: 'Market lore · not tested', reason: 'No lunar-event dataset or prespecified test is included. No predictive claim is made.' } ], methodology: [ 'Only datasets with at least ten calendar years, sufficient observations and no large unexplained gaps qualify for historical studies. Missing or shorter histories remain visible in Sources & coverage.', 'Historical samples exclude the comparison year and unfinished windows. Calendar windows use the prior close as the starting value. At least a prior close, boundary coverage and no gaps over seven calendar days are required; isolated missing sessions cannot be ruled out by the cache.', 'The path band is the middle 50% of historical returns at each window-progress point, not a forecast or a confidence interval. Calendar windows align by calendar progress; Santa and post-midterm windows align by session progress.', 'The mean range is a rough 95% normal interval shown only at ten observations. It assumes independent years, is not corrected for the many patterns examined, and does not establish an exploitable effect. Overlapping patterns are not independent.', 'Typical windows use non-overlapping blocks of the median observed session length. This is a descriptive market-drift reference; it is not an independent statistical control and it can include seasonal windows.', 'Similar dates use the same month/day in prior years, ranked only by absolute differences in trailing 63-session return and trailing 20-session annualized realized volatility, each divided by ten percentage points. Outcomes do not affect ranking. These are descriptive analogs, not causal matches or forecasts.', 'Weekday, turn-of-month and expiration-week comparisons use prior complete calendar years. Session/month counts are not independent annual observations. Expiration week is a calendar proxy, not historical option-chain or open-interest data.', 'Macro charts contain latest revised levels at their observation periods, not historical releases available at each past date. They do not condition the return analogs or establish a point-in-time backtest.', 'Current conditions use completed daily closes only, with a conservative 16:15 ET cutoff. No intraday comparison, party effect, trading recommendation, or AI inference is included.' ] };
}

// Lookback ranges share the same annual observations. Send those observations
// once to keep the complete owner response below platform response-size limits.
export function packHistoricalData(payload) {
  return { ...payload, historyEncoding: 'shared-observations-v1', indexes: Object.fromEntries(Object.entries(payload.indexes).map(([symbol, index]) => [symbol, { ...index, studies: index.studies.map(study => ({ ...study, ranges: Object.fromEntries(Object.entries(study.ranges).map(([key, range]) => {
    if (key === 'all') return [key, range];
    const { years, ...rest } = range;
    return [key, { ...rest, fromYear: Number(index.asOf.slice(0, 4)) - (key === '20y' ? 20 : 10) }];
  })) })) }])) };
}

// Event studies and the "resembles now" matcher for Owner Historical Data.
// Deterministic: a dated event catalog plus cached daily closes. No network,
// AI, trade signals, or changes to grades/picks. Percentages are points.

export const EVENTS_VERSION = 1;
const DAY = 86400000;
const ms = t => Date.parse(`${t}T00:00:00Z`);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const round = n => finite(n) ? Math.round(n * 100) / 100 : null;
const change = (from, to) => (to / from - 1) * 100;
const date = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function quantile(values, p) {
  const a = values.filter(finite).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
const mean = a => { const v = a.filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const share = (list, test) => { const v = list.filter(x => x != null); return v.length ? round(v.filter(test).length / v.length * 100) : null; };
function lowerBound(bars, t) {
  let a = 0, b = bars.length;
  while (a < b) { const m = (a + b) >> 1; if (bars[m].t < t) a = m + 1; else b = m; }
  return a;
}

// Forward horizons in trading sessions, measured from the close BEFORE the
// event's first trading session, so the reaction day itself is included.
export const EVENT_HORIZONS = Object.freeze([[1, 'Day 1'], [5, '1 week'], [20, '1 month'], [60, '3 months'], [250, '1 year']]);

// Dated catalog. `date` is the first calendar day the market could react: an
// event announced after the close or on a weekend resolves to the next session.
// Episode lists are a fixed, pre-written sample, not chosen by outcome. Each
// category names the index it is measured on; an episode can override it.
export const EVENT_CATEGORIES = Object.freeze([
  { id: 'war', name: 'War and geopolitical shocks', claim: 'Wars and military strikes cause a short sell-off; contained conflicts have usually been recovered within months.', market: '^GSPC', episodes: [
    ['1950-06-26', 'Korean War begins', 'North Korea invaded the South on Sunday, June 25.'],
    ['1962-10-23', 'Cuban Missile Crisis', 'Kennedy announced the blockade on the evening of October 22.'],
    ['1990-08-02', 'Iraq invades Kuwait', 'Also an oil supply shock.'],
    ['2001-09-11', 'September 11 attacks', 'NYSE closed until September 17; measured from the September 10 close.'],
    ['2003-03-20', 'US-led invasion of Iraq', 'Stocks had rallied into the start of the war.'],
    ['2014-03-03', 'Russia moves into Crimea', ''],
    ['2020-01-03', 'US strike kills Qassem Soleimani', ''],
    ['2022-02-24', 'Russia invades Ukraine', 'Also an oil and commodity shock.'],
    ['2023-10-07', 'Hamas attack on Israel', 'Saturday attack; first session October 9.'],
    ['2025-06-13', 'Israel strikes Iran', ''],
  ] },
  { id: 'pandemic', name: 'Pandemics and outbreaks', claim: 'Outbreaks hit stocks hard at first; policy support drives the recovery.', market: '^GSPC', episodes: [
    ['2003-03-12', 'SARS: WHO global alert', 'Overlaps the run-up to the Iraq war.'],
    ['2009-04-27', 'H1N1 swine flu', 'First trading session after the April 24 news.'],
    ['2014-10-01', 'Ebola: first US diagnosis', 'Announced the evening of September 30.'],
    ['2016-02-01', 'Zika: WHO emergency', ''],
    ['2020-02-24', 'COVID-19 spreads to Italy and Korea', 'First broad sell-off session; the S&P 500 closing high was February 19.'],
  ] },
  { id: 'oil', name: 'Oil supply disruptions', claim: 'Oil spikes lift energy and weigh on the broad market through inflation and input costs.', market: '^GSPC', oil: true, episodes: [
    ['1973-10-17', 'OPEC oil embargo', 'Before the WTI spot series begins (1986).'],
    ['1979-01-16', 'Iranian revolution', 'The Shah left Iran on January 16. Before the WTI spot series begins.'],
    ['1990-08-02', 'Iraq invades Kuwait', ''],
    ['2011-02-22', 'Libyan civil war halts exports', ''],
    ['2019-09-16', 'Abqaiq attack on Saudi oil', 'Weekend attack; first session September 16.'],
    ['2022-03-07', 'Russian oil ban threat', 'Brent briefly near $139; the US ban followed March 8.'],
    ['2025-06-13', 'Israel strikes Iran', 'Oil jumped on Strait of Hormuz risk.'],
  ] },
  { id: 'tariffs', name: 'Tariffs and trade wars', claim: 'Tariff shocks cause sell-offs in exposed names; markets often rebound on pauses or deals.', market: '^GSPC', episodes: [
    ['1971-08-16', 'Nixon shock: 10% import surcharge', 'Announced Sunday, August 15, with the end of gold convertibility.'],
    ['2018-03-01', 'US steel and aluminum tariffs', ''],
    ['2018-03-22', 'Section 301 tariffs on China', ''],
    ['2019-05-06', 'US raises China tariffs to 25%', 'Announced by post on Sunday, May 5.'],
    ['2019-08-01', 'New 10% tariff on $300B of Chinese goods', 'Announced mid-session.'],
    ['2025-02-03', 'Tariffs on Canada, Mexico and China', 'Announced Saturday, February 1.'],
    ['2025-04-03', '"Liberation Day" reciprocal tariffs', 'Announced after the April 2 close.'],
  ] },
  { id: 'mania', name: 'Manias and bubble peaks', claim: 'Speculative booms end in sharp declines. Measured from the closing high of each boom.', market: '^GSPC', peak: true, episodes: [
    ['1973-01-11', 'Nifty Fifty peak', 'S&P 500 closing high before the 1973-74 bear market.'],
    ['1987-08-25', 'Pre-crash 1987 peak', 'S&P 500 closing high before Black Monday.'],
    ['2000-03-10', 'Dot-com peak (Nasdaq)', 'Nasdaq Composite closing high.', '^IXIC'],
    ['2007-10-09', 'Credit and housing bubble peak', 'S&P 500 closing high before the 2008 crisis.'],
    ['2021-11-19', 'Meme, SPAC and growth peak (Nasdaq)', 'Nasdaq Composite closing high before the 2022 bear market.', '^IXIC'],
  ] },
  { id: 'squeeze', name: 'Short squeezes', claim: 'Squeezes produce days to weeks of outsized gains, then a sharp reversal once covering is exhausted.', market: 'GME', episodes: [
    ['2021-01-13', 'GameStop squeeze begins', 'Heavily shorted stock; retail and options buying.'],
    ['2021-02-24', 'GameStop second spike', ''],
    ['2024-05-13', 'GameStop "Roaring Kitty" return', ''],
  ], note: 'Single-stock episodes. Volkswagen (2008) traded outside the US and is not in this dataset.' },
  { id: 'bank-run', name: 'Bank runs and bank failures', claim: 'Bank runs crash financials; the wider market falls if it turns systemic. Backstops have stopped contagion quickly.', market: '^GSPC', banks: true, episodes: [
    ['1984-05-10', 'Continental Illinois run', ''],
    ['2007-09-14', 'Northern Rock run (UK)', ''],
    ['2008-03-14', 'Bear Stearns rescue', ''],
    ['2008-09-15', 'Lehman Brothers bankruptcy', ''],
    ['2008-09-26', 'Washington Mutual seized', 'Seized the evening of September 25.'],
    ['2023-03-09', 'Silicon Valley Bank run', 'SVB failed March 10; Signature Bank March 12.'],
    ['2023-05-01', 'First Republic seized', ''],
  ] },
].map(c => Object.freeze({ ...c, episodes: c.episodes.map(([d, name, note, market]) => Object.freeze({ date: d, name, note, market: market || c.market })) })));

// Apple WWDC keynote dates (first conference day), 2003 onward.
export const WWDC_KEYNOTES = Object.freeze(['2003-06-23', '2004-06-28', '2005-06-06', '2006-08-07', '2007-06-11', '2008-06-09', '2009-06-08', '2010-06-07', '2011-06-06', '2012-06-11', '2013-06-10', '2014-06-02', '2015-06-08', '2016-06-13', '2017-06-05', '2018-06-04', '2019-06-03', '2020-06-22', '2021-06-07', '2022-06-06', '2023-06-05', '2024-06-10', '2025-06-09', '2026-06-08']);
// Apple has not announced the next one; recent keynotes fell on the first or
// second Monday of June. The estimate is labeled as such wherever it is used.
export function wwdcKeynote(year) {
  const known = WWDC_KEYNOTES.find(d => d.startsWith(`${year}-`));
  if (known) return { date: known, estimated: false };
  const first = new Date(Date.UTC(year, 5, 1)).getUTCDay(), monday = 1 + ((8 - first) % 7);
  return { date: date(year, 6, monday + 7), estimated: true };
}

// Scheduled FOMC decision days (the second day of two-day meetings), from the
// Federal Reserve's published calendars. Unscheduled 2020 emergency cuts are
// excluded. Keep in step with FOMC_MEETINGS_BASELINE in scripts/build.mjs.
export const FOMC_DECISIONS = Object.freeze([
  '2015-01-28', '2015-03-18', '2015-04-29', '2015-06-17', '2015-07-29', '2015-09-17', '2015-10-28', '2015-12-16',
  '2016-01-27', '2016-03-16', '2016-04-27', '2016-06-15', '2016-07-27', '2016-09-21', '2016-11-02', '2016-12-14',
  '2017-02-01', '2017-03-15', '2017-05-03', '2017-06-14', '2017-07-26', '2017-09-20', '2017-11-01', '2017-12-13',
  '2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13', '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19',
  '2019-01-30', '2019-03-20', '2019-05-01', '2019-06-19', '2019-07-31', '2019-09-18', '2019-10-30', '2019-12-11',
  '2020-01-29', '2020-04-29', '2020-06-10', '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16',
  '2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16', '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15',
  '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
  '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-16', '2027-07-28', '2027-09-22', '2027-11-03', '2027-12-15',
]);

// One episode: the event's first session at or after `day`, measured from the
// prior close. Recovery counts sessions until a close at or above that prior
// close after first closing below it (0 when it never closed below).
export function measureEpisode(bars, day, { peak = false } = {}) {
  let i = lowerBound(bars, day);
  if (peak) i = Math.min(i + 1, bars.length);
  if (i < 1 || i >= bars.length || ms(bars[i].t) - ms(day) > 7 * DAY || ms(day) - ms(bars[i - 1].t) > 10 * DAY + (peak ? 7 * DAY : 0)) return null;
  const b = i - 1, base = bars[b].c, out = { session: bars[i].t, baseline: bars[b].t };
  for (const [h] of EVENT_HORIZONS) out[`d${h}`] = b + h < bars.length ? round(change(base, bars[b + h].c)) : null;
  out.prior20Pct = b >= 20 ? round(change(bars[b - 20].c, base)) : null;
  out.prior250Pct = b >= 250 ? round(change(bars[b - 250].c, base)) : null;
  // Recovery looks up to three years ahead (six after a bubble peak); the
  // trough uses one year (six after a peak) so a later, unrelated decline
  // is not attributed to the event.
  const span = peak ? 1500 : 750, end = Math.min(bars.length - 1, b + span), troughEnd = Math.min(bars.length - 1, b + (peak ? 1500 : 250));
  let recovered = null, below = false;
  for (let j = i; j <= end && recovered == null; j++) {
    if (bars[j].c < base) below = true;
    else if (below) recovered = j - b;
  }
  if (!below && end === b + span) recovered = 0;
  let low = base, lowAt = b, low60 = base;
  for (let j = i; j <= troughEnd; j++) {
    if (bars[j].c < low) { low = bars[j].c; lowAt = j; }
    if (j <= b + 60) low60 = Math.min(low60, bars[j].c);
  }
  out.drawdown60Pct = round(change(base, low60));
  out.troughPct = round(change(base, low));
  out.troughSessions = lowAt - b;
  out.recoverySessions = recovered;
  out.recoveryWindowComplete = recovered != null || end === b + span;
  return out;
}
function summarizeEpisodes(rows) {
  const out = { n: rows.length };
  for (const [h] of EVENT_HORIZONS) {
    const v = rows.map(r => r[`d${h}`]).filter(finite);
    out[`d${h}`] = { n: v.length, medianPct: round(quantile(v, .5)), meanPct: round(mean(v)), positivePct: share(v, x => x > 0) };
  }
  out.medianDrawdown60Pct = round(quantile(rows.map(r => r.drawdown60Pct), .5));
  out.medianTroughPct = round(quantile(rows.map(r => r.troughPct), .5));
  const rec = rows.filter(r => r.recoveryWindowComplete);
  out.recoveredPct = share(rec, r => r.recoverySessions != null);
  out.medianRecoverySessions = round(quantile(rec.filter(r => r.recoverySessions != null).map(r => r.recoverySessions), .5));
  return out;
}
const lastBar = (bars, t) => { const i = lowerBound(bars, t); return i < bars.length && bars[i].t === t ? i : i - 1; };

function dated(category, series, context) {
  const rows = category.episodes.map(e => {
    const bars = series[e.market] || [];
    const m = bars.length ? measureEpisode(bars, e.date, { peak: category.peak }) : null;
    const row = { date: e.date, name: e.name, note: e.note, market: e.market, ...(m || { unavailable: true }) };
    if (m && category.oil) {
      const wti = context.DCOILWTICO || [], k = lastBar(wti, m.baseline);
      if (k >= 0 && ms(m.baseline) - ms(wti[k].t) <= 7 * DAY && k + 20 < wti.length) row.oil20Pct = round(change(wti[k].v, wti[k + 20].v));
    }
    if (m && category.banks) {
      const kre = series.KRE || [], k = lastBar(kre, m.baseline);
      if (k >= 0 && ms(m.baseline) - ms(kre[k].t) <= 7 * DAY && k + 20 < kre.length) row.banks20Pct = round(change(kre[k].c, kre[k + 20].c));
    }
    return row;
  });
  const ok = rows.filter(r => !r.unavailable);
  return { id: category.id, kind: 'dated', name: category.name, claim: category.claim, note: category.note || null, market: category.market, peak: !!category.peak, summary: summarizeEpisodes(ok), episodes: rows };
}

// Every S&P 500 close down 6% or more since 1950. Clusters are counted, but
// the summary uses only the first drop in any 20-session span.
function crashStudy(bars) {
  const all = [];
  let lastKept = -Infinity;
  for (let i = 1; i < bars.length; i++) {
    const r = change(bars[i - 1].c, bars[i].c);
    if (r > -6) continue;
    const m = measureEpisode(bars, bars[i].t);
    if (!m) continue;
    const first = i - lastKept > 20;
    if (first) lastKept = i;
    all.push({ date: bars[i].t, name: bars[i].t === '1987-10-19' ? 'Black Monday' : '', firstInCluster: first, ...m });
  }
  const black = all.find(r => r.date === '1987-10-19') || null;
  return { id: 'crash', kind: 'rule', name: 'Crash days and 1987 Black Monday', claim: 'A crash-scale day is met by panic, then a policy response; 1987\'s losses took about two years to recover.', definition: 'Every S&P 500 close down 6% or more from the prior close since 1950. The summary uses the first drop in any 20-session span; later drops in the same cluster stay in the table.', market: '^GSPC', summary: summarizeEpisodes(all.filter(r => r.firstInCluster)), blackMonday: black, occurrences: all.length, episodes: all };
}

// Nasdaq Composite closes down 4% or more. Closes only: "tested" means a
// later close below the drop day's close, not an intraday low.
function nasdaqStudy(bars) {
  const rows = [];
  let lastKept = -Infinity;
  for (let i = 1; i < bars.length; i++) {
    const drop = change(bars[i - 1].c, bars[i].c);
    if (drop > -4) continue;
    const c = bars[i].c, has = k => i + k < bars.length;
    const next1 = has(1) ? change(c, bars[i + 1].c) : null;
    const below = k => has(k) ? bars.slice(i + 1, i + k + 1).some(b => b.c < c) : null;
    const belowAfterBounce = has(6) ? bars.slice(i + 2, i + 7).some(b => b.c < c) : null;
    const first = i - lastKept > 20;
    if (first) lastKept = i;
    rows.push({ date: bars[i].t, dropPct: round(drop), next1Pct: round(next1), slightBounce: next1 != null ? next1 > 0 && next1 <= 2 : null, below5: below(5), below20: below(20), belowAfterBounce, fwd20Pct: has(20) ? round(change(c, bars[i + 20].c)) : null, fwd60Pct: has(60) ? round(change(c, bars[i + 60].c)) : null, firstInCluster: first });
  }
  const sum = list => {
    const bounce = list.filter(r => r.slightBounce);
    return { n: list.length, nextDayUpPct: share(list.map(r => r.next1Pct), x => x > 0), medianNext1Pct: round(quantile(list.map(r => r.next1Pct), .5)), slightBouncePct: share(list.map(r => r.slightBounce), Boolean), below5Pct: share(list.map(r => r.below5), Boolean), below20Pct: share(list.map(r => r.below20), Boolean), bounceThenBelowPct: share(bounce.map(r => r.belowAfterBounce), Boolean), bounceN: bounce.length, medianFwd20Pct: round(quantile(list.map(r => r.fwd20Pct), .5)), positiveFwd20Pct: share(list.map(r => r.fwd20Pct), x => x > 0), medianFwd60Pct: round(quantile(list.map(r => r.fwd60Pct), .5)), positiveFwd60Pct: share(list.map(r => r.fwd60Pct), x => x > 0) };
  };
  return { id: 'nasdaq-4', kind: 'nasdaq', name: 'Nasdaq down 4% in a day', claim: 'After a 4% Nasdaq drop, a small bounce the next day is usually followed by more weakness rather than a V-shaped bottom.', definition: 'Every Nasdaq Composite close down 4% or more since 1971. "Slight bounce" is a next-day gain between 0% and 2%. "Closed below" means a later close under the drop day\'s close; daily lows are not in this dataset. "First in cluster" drops are at least 20 sessions after the previous one.', market: '^IXIC', all: sum(rows), firstInCluster: sum(rows.filter(r => r.firstInCluster)), episodes: rows };
}

// Quarterly (third Friday of Mar/Jun/Sep/Dec) vs the other monthly expirations.
function witchingStudy(bars) {
  const groups = { quarterly: [], monthly: [] }, fridays = [];
  if (!bars.length) return null;
  const startYear = Math.max(1984, Number(bars[0].t.slice(0, 4))), endYear = Number(bars.at(-1).t.slice(0, 4));
  const isExpiry = new Set();
  for (let y = startYear; y <= endYear; y++) for (let m = 1; m <= 12; m++) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), friday = date(y, m, 15 + ((5 - first + 7) % 7));
    const i = lastBar(bars, friday);
    if (i < 6 || i + 5 >= bars.length || ms(friday) - ms(bars[i].t) > 3 * DAY) continue; // holiday Friday moves expiry to Thursday
    isExpiry.add(bars[i].t);
    const prevWeek = lastBar(bars, new Date(ms(friday) - 7 * DAY).toISOString().slice(0, 10));
    const row = { date: bars[i].t, dayPct: change(bars[i - 1].c, bars[i].c), weekPct: prevWeek >= 0 ? change(bars[prevWeek].c, bars[i].c) : null, nextWeekPct: change(bars[i].c, bars[i + 5].c) };
    (m % 3 === 0 ? groups.quarterly : groups.monthly).push(row);
  }
  for (let i = 1; i < bars.length; i++) if (new Date(ms(bars[i].t)).getUTCDay() === 5 && !isExpiry.has(bars[i].t)) fridays.push(Math.abs(change(bars[i - 1].c, bars[i].c)));
  const sum = (rows, label) => ({ label, n: rows.length, medianDayPct: round(quantile(rows.map(r => r.dayPct), .5)), meanAbsDayPct: round(mean(rows.map(r => Math.abs(r.dayPct)))), dayUpPct: share(rows.map(r => r.dayPct), x => x > 0), medianWeekPct: round(quantile(rows.map(r => r.weekPct), .5)), weekUpPct: share(rows.map(r => r.weekPct), x => x > 0), medianNextWeekPct: round(quantile(rows.map(r => r.nextWeekPct), .5)), nextWeekUpPct: share(rows.map(r => r.nextWeekPct), x => x > 0) });
  return { id: 'witching', kind: 'witching', name: 'Triple witching', claim: 'Quarterly expiration brings heavy volume and erratic swings with no reliable direction.', definition: 'S&P 500 on the third Friday of March, June, September and December since 1984, against the other eight monthly expirations and ordinary Fridays. Week = prior Friday close to expiration close; next week = the five sessions after. Volume is not in this dataset.', market: '^GSPC', rows: [sum(groups.quarterly, 'Quarterly (triple witching)'), sum(groups.monthly, 'Other monthly expirations')], otherFridayMeanAbsPct: round(mean(fridays)), recent: groups.quarterly.slice(-8).reverse().map(r => ({ date: r.date, dayPct: round(r.dayPct), weekPct: round(r.weekPct), nextWeekPct: round(r.nextWeekPct) })) };
}

// AAPL into and out of the WWDC keynote, alone and relative to the Nasdaq.
function wwdcStudy(aapl, nasdaq, cutoff) {
  if (!aapl.length) return null;
  const rows = [];
  for (const d of WWDC_KEYNOTES) {
    if (d > cutoff) continue;
    const i = lowerBound(aapl, d);
    if (i < 11 || i + 20 >= aapl.length || aapl[i].t !== d) continue;
    const runup = change(aapl[i - 11].c, aapl[i - 1].c), keynote = change(aapl[i - 1].c, aapl[i].c);
    const after5 = change(aapl[i].c, aapl[i + 5].c), after20 = change(aapl[i].c, aapl[i + 20].c);
    const n = lowerBound(nasdaq, d), nq = nasdaq[n]?.t === d && n >= 11 && n + 20 < nasdaq.length ? { runup: change(nasdaq[n - 11].c, nasdaq[n - 1].c), after5: change(nasdaq[n].c, nasdaq[n + 5].c) } : null;
    rows.push({ date: d, runupPct: round(runup), keynotePct: round(keynote), after5Pct: round(after5), after20Pct: round(after20), relRunupPct: nq ? round(runup - nq.runup) : null, relAfter5Pct: nq ? round(after5 - nq.after5) : null, sellTheNews: runup > 0 && after5 < 0 });
  }
  return { id: 'wwdc', kind: 'wwdc', name: 'WWDC sell the news', claim: 'Apple runs up into its June developer conference, then stalls or fades after the keynote.', definition: 'AAPL over the 10 sessions before the keynote, on keynote day, and over the 5 and 20 sessions after the keynote close. "Sell the news" = a positive run-up followed by a negative 5-session return. Relative columns subtract the Nasdaq Composite over the same sessions.', market: 'AAPL', summary: { n: rows.length, runupUpPct: share(rows.map(r => r.runupPct), x => x > 0), medianRunupPct: round(quantile(rows.map(r => r.runupPct), .5)), keynoteDownPct: share(rows.map(r => r.keynotePct), x => x < 0), medianKeynotePct: round(quantile(rows.map(r => r.keynotePct), .5)), after5DownPct: share(rows.map(r => r.after5Pct), x => x < 0), medianAfter5Pct: round(quantile(rows.map(r => r.after5Pct), .5)), medianAfter20Pct: round(quantile(rows.map(r => r.after20Pct), .5)), sellTheNewsPct: share(rows.map(r => r.sellTheNews), Boolean), medianRelAfter5Pct: round(quantile(rows.map(r => r.relAfter5Pct), .5)) }, episodes: rows };
}

// S&P 500 moves on scheduled release days against every other session in the
// same span. Direction depends on the surprise, which is not in this dataset.
function econStudy(bars, releases, cutoff) {
  const lists = [['fomc', 'FOMC rate decisions (2:00 pm ET)', FOMC_DECISIONS, 'Federal Reserve calendar, scheduled meetings since 2015'], ['cpi', 'CPI inflation report (8:30 am ET)', releases?.cpi?.dates, 'FRED release calendar (BLS)'], ['jobs', 'Jobs report (8:30 am ET)', releases?.jobs?.dates, 'FRED release calendar (BLS Employment Situation)']];
  const rows = [], upcoming = [];
  for (const [id, label, dates, source] of lists) {
    const list = (Array.isArray(dates) ? dates : []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!list.length) { rows.push({ id, label, source, n: 0, unavailable: true }); continue; }
    const past = list.filter(d => d <= cutoff), set = new Set(past), from = past[0];
    const event = [], next = [], other = [];
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].t < from) continue;
      const r = change(bars[i - 1].c, bars[i].c);
      if (set.has(bars[i].t)) { event.push(r); if (i + 1 < bars.length) next.push(change(bars[i].c, bars[i + 1].c)); }
      else other.push(r);
    }
    rows.push({ id, label, source, n: event.length, since: from, meanAbsPct: round(mean(event.map(Math.abs))), otherMeanAbsPct: round(mean(other.map(Math.abs))), bigMovePct: share(event, x => Math.abs(x) >= 1), otherBigMovePct: share(other, x => Math.abs(x) >= 1), upPct: share(event, x => x > 0), medianPct: round(quantile(event, .5)), nextDayMeanAbsPct: round(mean(next.map(Math.abs))) });
    const soon = list.find(d => d > cutoff);
    if (soon) upcoming.push({ id, label, date: soon });
  }
  return { id: 'econ', kind: 'econ', name: 'Market reactions to economic events', claim: 'Scheduled releases move markets through the surprise against expectations, not the level.', definition: 'S&P 500 close-to-close move on each release day, against every non-release session since the first release in the list. A 1% move counts as "big". Consensus forecasts and surprises are not in this dataset, so direction is not conditioned on the surprise.', market: '^GSPC', rows, upcoming };
}

// ---------------------------------------------------------------------------
// "Resembles now": deterministic checks on the latest completed closes, the
// FRED context series and recent macro headlines. Each match names the
// measured trigger and points at the study that holds the history.
const HEADLINE_RULES = [
  ['pandemic', /\b(?:pandemic|epidemic|outbreak|lockdowns?|quarantines?|WHO (?:declares|emergency)|public health emergency|new (?:virus|variant))\b/i],
  ['tariffs', /\b(?:tariffs?|trade war|import (?:tax|duties|duty)|retaliatory (?:duties|measures))\b/i],
  ['bank-run', /\b(?:bank runs?|deposit (?:flight|outflows?|run)|bank (?:failure|failures|collapse|seized|seizure)|FDIC (?:seizes|takes over|receivership))\b/i],
  ['war', /\b(?:invasion|invades?|invaded|air ?strikes?|missile (?:strikes?|attacks?)|military (?:strikes?|offensive)|drone (?:strikes?|attacks?)|declares? war|act of war|strait of hormuz)\b/i],
];
const RELIEF = /\b(?:ceasefire|truce|peace (?:deal|talks|agreement)|pause[sd]?|delay(?:s|ed)?|exempt\w*|relief|lift\w* (?:\w+ ){0,2}tariffs?|trade deal|contained|eases?)\b/i;
export function headlineHits(headlines, analyzedAtIso, maxAgeHours = 48) {
  const now = Date.parse(analyzedAtIso), hits = {};
  for (const h of Array.isArray(headlines) ? headlines : []) {
    const title = String(h?.title || h?.headline || (typeof h === 'string' ? h : '')).trim();
    const at = Date.parse(h?.date || h?.publishedAt || '');
    if (!title || !Number.isFinite(at) || now - at > maxAgeHours * 3600e3 || at > now + 300e3 || RELIEF.test(title)) continue;
    for (const [id, re] of HEADLINE_RULES) if (re.test(title)) (hits[id] ||= []).push({ title: title.slice(0, 160), date: new Date(at).toISOString() });
  }
  return Object.fromEntries(Object.entries(hits).map(([id, list]) => [id, list.slice(0, 3)]));
}
const tail = (bars, k) => bars.length > k ? change(bars.at(-1 - k).c ?? bars.at(-1 - k).v, bars.at(-1).c ?? bars.at(-1).v) : null;
function sma(bars, n) { if (bars.length < n) return null; let s = 0; for (const b of bars.slice(-n)) s += b.c; return s / n; }
const fresh = (rows, cutoff, days = 7) => rows.length && ms(cutoff) - ms(rows.at(-1).t) <= days * DAY;

function matchNow({ series, context, cutoff, headlines, squeezes, studies, seasonal }) {
  const out = [], add = (id, name, why, basis, study) => out.push({ id, name, why, basis, study });
  const spx = series['^GSPC'] || [], ixic = series['^IXIC'] || [], kre = series.KRE || [], gld = series.GLD || [];
  const vix = context.VIXCLS || [], wti = context.DCOILWTICO || [], ten = context.DGS10 || [], stress = context.STLFSI4 || [];
  const day = spx.at(-1)?.t || cutoff;
  // Tape shocks.
  if (fresh(ixic, cutoff)) {
    const k = ixic.slice(-6).findLastIndex((b, j, a) => j && change(a[j - 1].c, b.c) <= -4);
    if (k > 0) { const a = ixic.slice(-6), drop = change(a[k - 1].c, a[k].c); add('nasdaq-4', 'Nasdaq down 4% in a day', `Nasdaq ${round(drop)}% on ${a[k].t}${k < a.length - 1 ? `, ${a.length - 1 - k} session${a.length - 1 - k === 1 ? '' : 's'} ago` : ''}.`, 'price', 'nasdaq-4'); }
  }
  if (fresh(spx, cutoff)) {
    const a = spx.slice(-6), k = a.findLastIndex((b, j) => j && change(a[j - 1].c, b.c) <= -5);
    if (k > 0) add('crash', 'Crash-scale day', `S&P 500 ${round(change(a[k - 1].c, a[k].c))}% on ${a[k].t}.`, 'price', 'crash');
    const yr = tail(spx, 250), tenNow = ten.at(-1)?.v, tenThen = ten.length > 126 ? ten.at(-127).v : null;
    if (finite(yr) && yr >= 25 && finite(tenNow) && finite(tenThen) && tenNow - tenThen >= 1) add('crash-1987-setup', '1987-style setup', `S&P 500 ${round(yr)}% over a year while the 10-year yield rose ${round(tenNow - tenThen)} points in six months. Before Black Monday the index was up sharply on the year and yields had climbed about 2 points.`, 'price+rates', 'crash');
  }
  const vixNow = vix.at(-1)?.v, vixPrev = vix.at(-2)?.v;
  const vixJump = finite(vixNow) && finite(vixPrev) ? change(vixPrev, vixNow) : null;
  if (fresh(vix, cutoff) && (vixNow >= 30 || vixJump >= 25)) add('vol', 'Volatility panic', `VIX ${round(vixNow)}${finite(vixJump) ? ` (${vixJump > 0 ? '+' : ''}${round(vixJump)}% on the day)` : ''}. Compare crash days and war shocks.`, 'price', 'crash');
  const wti5 = fresh(wti, cutoff, 10) ? tail(wti, 5) : null, wti20 = fresh(wti, cutoff, 10) ? tail(wti, 20) : null;
  if (wti5 >= 10 || wti20 >= 25) add('oil', 'Oil supply shock', `WTI crude ${round(wti5)}% over 5 sessions, ${round(wti20)}% over 20.`, 'price', 'oil');
  const gold1 = fresh(gld, cutoff) ? tail(gld, 1) : null, oil1 = fresh(wti, cutoff, 10) ? tail(wti, 1) : null;
  const spx1 = fresh(spx, cutoff) ? tail(spx, 1) : null;
  // A headline alone is not a match: it also needs a risk-off reaction on the
  // latest session, so routine tariff or conflict coverage stays quiet.
  const reaction = [spx1 <= -1 ? `S&P 500 ${round(spx1)}%` : null, vixJump >= 10 ? `VIX +${round(vixJump)}%` : null].filter(Boolean);
  const warPrice = gold1 >= 2 && (oil1 >= 3 || vixJump >= 10);
  const warNews = headlines.war?.length && (reaction.length || oil1 >= 2 || gold1 >= 1);
  if (warNews || warPrice) add('war', 'War or geopolitical shock', [warNews ? `Headline: "${headlines.war[0].title}"` : null, warPrice ? `Gold ${round(gold1)}% with crude ${round(oil1)}% and VIX ${round(vixJump)}% on the day` : reaction.join(', ') || null].filter(Boolean).join('. ') + '.', warNews ? 'headline+price' : 'price', 'war');
  if (headlines.tariffs?.length && reaction.length) add('tariffs', 'Tariff shock', `Headline: "${headlines.tariffs[0].title}". ${reaction.join(', ')} on the day.`, 'headline+price', 'tariffs');
  if (headlines.pandemic?.length && reaction.length) add('pandemic', 'Outbreak or pandemic', `Headline: "${headlines.pandemic[0].title}". ${reaction.join(', ')} on the day.`, 'headline+price', 'pandemic');
  const kre10 = fresh(kre, cutoff) ? tail(kre, 10) : null, kre5 = fresh(kre, cutoff) ? tail(kre, 5) : null;
  const stressUp = stress.length > 4 ? stress.at(-1).v - stress.at(-5).v : null;
  if (kre10 <= -12 || (headlines['bank-run']?.length && kre5 <= -5)) add('bank-run', 'Bank stress', [finite(kre10) ? `Regional banks (KRE) ${round(kre10)}% over 10 sessions` : null, headlines['bank-run']?.length ? `headline: "${headlines['bank-run'][0].title}"` : null, finite(stressUp) && stressUp > 0 ? `St. Louis stress index up ${round(stressUp)} over four weeks` : null].filter(Boolean).join('; ') + '.', headlines['bank-run']?.length ? 'headline+price' : 'price', 'bank-run');
  if (fresh(ixic, cutoff)) {
    const yr = tail(ixic, 250), avg = sma(ixic, 200), above = avg ? change(avg, ixic.at(-1).c) : null;
    if (yr >= 40 && above >= 20) add('mania', 'Mania-like run', `Nasdaq ${round(yr)}% over a year and ${round(above)}% above its 200-day average. Compare the run-up into past peaks.`, 'price', 'mania');
  }
  if (Array.isArray(squeezes) && squeezes.length) add('squeeze', 'Short-squeeze style move', squeezes.slice(0, 3).map(s => `${s.sym} ${s.chPct > 0 ? '+' : ''}${round(s.chPct)}% on ${round(s.rvol)}x volume`).join(', ') + '.', 'price', 'squeeze');
  // Calendar.
  const y = Number(day.slice(0, 4)), mo = Number(day.slice(5, 7)), dd = Number(day.slice(8, 10));
  if (mo % 3 === 0) {
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), fri = 15 + ((5 - first + 7) % 7);
    if (dd >= fri - 4 && dd <= fri + 4) add('witching', 'Triple witching week', `Quarterly expiration ${date(y, mo, fri)}.`, 'calendar', 'witching');
  }
  const w = wwdcKeynote(y), wms = ms(w.date), dms = ms(day);
  if (dms >= wms - 16 * DAY && dms <= wms + 8 * DAY) add('wwdc', 'WWDC window', `Keynote ${w.date}${w.estimated ? ' (estimated; not yet announced)' : ''}.`, 'calendar', 'wwdc');
  for (const u of studies.econ?.upcoming || []) {
    const gap = (ms(u.date) - ms(cutoff)) / DAY;
    if (gap > 0 && gap <= 3) add(`econ-${u.id}`, u.label.replace(/ \(.*/, ''), `Next release ${u.date}.`, 'calendar', 'econ');
  }
  // Attach the headline number from the matching study so the card can say
  // what happened before without opening it.
  const matched = out.map(m => ({ ...m, history: historyLine(m, studies) }));
  // Seasonal windows already have studies in the seasonal view; link to them.
  for (const s of seasonal) matched.push({ id: s.id, name: s.name, why: s.why, basis: 'calendar', study: s.study, seasonal: true, history: s.history || null });
  return matched;
}
const whole = n => finite(n) ? `${Math.round(n)}%` : 'n/a';
function pctText(n) { return finite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : 'n/a'; }
function historyLine(match, studies) {
  const s = studies[match.study];
  if (!s) return null;
  if (s.kind === 'dated') { const m = s.summary; return `${m.n} past episodes: median ${pctText(m.d1.medianPct)} on day 1, ${pctText(m.d20.medianPct)} after a month, ${pctText(m.d60.medianPct)} after three months (${whole(m.d60.positivePct)} positive); median worst point in 60 sessions ${pctText(m.medianDrawdown60Pct)}.`; }
  if (s.kind === 'rule') { const m = s.summary; return `${m.n} first-in-cluster crash days since 1950: median ${pctText(m.d20.medianPct)} a month later and ${pctText(m.d250.medianPct)} a year later; ${whole(m.recoveredPct)} regained the pre-crash close within three years.`; }
  if (s.kind === 'nasdaq') { const m = s.firstInCluster; return `${s.all.n} drops since 1971. A slight bounce came next ${whole(m.slightBouncePct)} of the time (first-in-cluster), and after a slight bounce the index closed below the drop-day close within the next five sessions ${whole(m.bounceThenBelowPct)} of the time (${m.bounceN} ${m.bounceN === 1 ? 'case' : 'cases'}). Median a month later ${pctText(m.medianFwd20Pct)}.`; }
  if (s.kind === 'witching') { const [q] = s.rows; return `${q.n} quarterly expirations since 1984: S&P 500 up ${whole(q.dayUpPct)} of the time on the day, average absolute move ${pctText(q.meanAbsDayPct).replace('+', '')} vs ${pctText(s.otherFridayMeanAbsPct).replace('+', '')} on other Fridays; the following week was up ${whole(q.nextWeekUpPct)} of the time.`; }
  if (s.kind === 'wwdc') { const m = s.summary; return `${m.n} keynotes: AAPL rose into the event ${whole(m.runupUpPct)} of the time and fell over the next five sessions ${whole(m.after5DownPct)} of the time (median ${pctText(m.medianAfter5Pct)}). Full sell-the-news pattern in ${whole(m.sellTheNewsPct)} of years.`; }
  if (s.kind === 'econ') { const r = s.rows.find(x => match.id === `econ-${x.id}`); return r && r.n ? `${r.n} releases since ${r.since}: average S&P 500 move ${pctText(r.meanAbsPct).replace('+', '')} vs ${pctText(r.otherMeanAbsPct).replace('+', '')} on other days; a 1% move ${whole(r.bigMovePct)} of the time vs ${whole(r.otherBigMovePct)}.` : null; }
  return null;
}

// series: { '^GSPC': [{t,c}], '^IXIC', AAPL, KRE, GME, GLD, ... } (clean,
// confirmed closes). context: FRED rows keyed by id ({t,v}). seasonal: the
// active calendar studies from the existing seasonality engine.
export function buildHistoricalEvents({ series = {}, context = {}, releases = {}, cutoff, inputs = {}, seasonal = [] }) {
  const studies = {};
  for (const c of EVENT_CATEGORIES) studies[c.id] = dated(c, series, context);
  if ((series['^GSPC'] || []).length) studies.crash = crashStudy(series['^GSPC']);
  if ((series['^IXIC'] || []).length) studies['nasdaq-4'] = nasdaqStudy(series['^IXIC']);
  const witching = witchingStudy(series['^GSPC'] || []);
  if (witching) studies.witching = witching;
  const wwdc = wwdcStudy(series.AAPL || [], series['^IXIC'] || [], cutoff);
  if (wwdc) studies.wwdc = wwdc;
  if ((series['^GSPC'] || []).length) studies.econ = econStudy(series['^GSPC'], releases, cutoff);
  const headlines = inputs.headlineHits || {};
  const matches = matchNow({ series, context, cutoff, headlines, squeezes: inputs.squeezes || [], studies, seasonal });
  return { version: EVENTS_VERSION, asOf: (series['^GSPC'] || []).at(-1)?.t || null, horizons: EVENT_HORIZONS.map(([h, label]) => ({ sessions: h, label })), order: ['war', 'pandemic', 'oil', 'tariffs', 'mania', 'squeeze', 'bank-run', 'crash', 'nasdaq-4', 'witching', 'wwdc', 'econ'].filter(id => studies[id]), studies, matches, inputs: { headlineHits: headlines, squeezes: inputs.squeezes || [] }, methodology: [
    'Event dates are a fixed list written before measuring outcomes. Episodes are not selected by how the market reacted, but the list is short and hand-picked, so treat it as a set of case studies, not a statistical sample.',
    'Returns are index price returns from the close before the first trading session at or after the event date. Indexes exclude dividends. Horizons are trading sessions: 1, 5, 20, 60 and 250.',
    'Recovery is the number of sessions until a close at or above the pre-event close, after first closing below it; 0 means it never closed below. Episodes still inside the recovery window are not counted as unrecovered.',
    'Rule studies (crash days, Nasdaq 4% drops, triple witching, WWDC, economic releases) use every qualifying date in the data. Nearby crash days are clustered; the clustered and first-in-cluster figures are both shown.',
    'Matches use completed closes, FRED context series and macro headlines from the last 48 hours. A match says conditions look like a past event; it is not a forecast or a trade signal.',
  ] };
}

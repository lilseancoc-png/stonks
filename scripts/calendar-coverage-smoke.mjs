import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildCalendarPayload, TICKERS, SECTORS, upcomingEarningsList, dedupeCalendarEvents, fetchNasdaqEarningsSessions, fetchOfficialCalendarEvents, matchForexFactoryEventSubtype } from './build.mjs';
import { parseCensusCalendar, parseIsmCalendar, supplementalWeeklyReports, marketSessionCalendarEvents } from '../lib/calendar-sources.mjs';
import { calendarHealth } from '../lib/calendar-policy.mjs';
import { renderAppJs } from './render/app-js.mjs';

const built = '2026-10-28T01:00:00Z'; // Still October 27 in New York.
const start = Date.parse('2026-10-27'), end = Date.parse('2026-12-31');
const catalyst = { date: '2026-11-03', title: 'Developer conference', category: 'launch', evidenceVersion: 2,
  dateEvidence: 'Will host the developer conference on November 3', sourceTitle: 'Dated conference announcement',
  sourceUrl: 'https://example.com/event', sourcePublishedAt: '2026-10-26T12:00:00Z' };
const chains = { AAPL: { fundamentals: { nextEarningsDate: '2026-10-27' }, catalysts: [catalyst] },
  MSFT: { fundamentals: { nextEarningsDate: '2026-11-02' }, catalysts: [catalyst] },
  RDDT: { fundamentals: { nextEarningsDate: '2026-11-03' }, catalysts: [catalyst] },
  SPY: { fundamentals: { nextEarningsDate: '2026-11-03' } } };
const official = { type: 'report', subtype: 'official-bls-jolts', title: 'Job Openings and Labor Turnover',
  date: '2026-11-05', time: '10:00 ET', source: 'BLS', sourceKey: 'bls', official: true, sourceUrl: 'https://www.bls.gov/schedule/' };
const sessions = new Map([['MSFT|2026-11-04', 'PM'], ['RDDT|2026-11-03', 'PM'], ['SPY|2026-11-03', 'AM']]);
sessions.coverage = { status: 'partial', requested: 3, succeeded: 2, failedDates: ['2026-11-03'] };
const reports = [{ type: 'report', subtype: 'jolts', title: 'JOLTS Job Openings', date: '2026-11-03', actual: 'bad old date', consensus: 'old', previous: '7M' }];
reports.sourceStatus = { forexFactory: 'unavailable' };
const data = buildCalendarPayload(chains, [
  { title: 'Future publication is not a scheduled event', publishedAt: '2026-11-06T12:00:00Z' },
  { title: 'Fed announcement today', publisher: 'Federal Reserve', publishedAt: '2026-10-27T14:00:00Z', link: 'https://www.federalreserve.gov/' },
], built, { sessionMap: sessions, reportEvents: reports, officialCalendar: { events: [official], status: { bls: true, bea: false } } });
assert(data.events.some(e => e.symbol === 'AAPL' && e.date === '2026-10-27'), 'ET date retains today after UTC midnight');
assert(!data.events.some(e => e.symbol === 'RDDT' || e.symbol === 'SPY'), 'removed tickers and ETF earnings excluded');
assert.equal(data.coverage.earningsUniverse, TICKERS.filter(s => SECTORS[s] !== 'ETF').length);
assert(data.coverage.earningsMissing.includes('NVDA'));
assert(data.coverage.tickerInputsMissing.includes('NVDA'));
const reviewed = buildCalendarPayload({AAPL:{news:{builtAt:built},catalysts:[]}, MSFT:{news:{builtAt:built,fallback:true},catalysts:[]}}, [], built, {});
assert.equal(reviewed.coverage.catalystReview.reviewed, 1, 'successful empty extraction is distinguished from missing or fallback news');
assert(reviewed.coverage.catalystReview.missing.includes('MSFT'));

assert.equal(data.events.filter(e => e.type === 'catalyst').length, 2, 'same event title is kept for both companies');
assert.equal(data.events.find(e => e.type === 'catalyst').sourceUrl, catalyst.sourceUrl);
assert(buildCalendarPayload({AAPL:{catalysts:[{...catalyst,date:'2026-10-27'}]}}, [], built, {}).events.some(e => e.type === 'catalyst'), 'ET-day catalysts survive UTC midnight');
assert(data.events.some(e => e.date === '2026-11-03' && e.sourceKey === 'fec-2026'));
assert.equal(data.events.find(e => e.symbol === 'MSFT' && e.type === 'earnings').date, '2026-11-04');
const jolts = data.events.find(e => e.subtype === 'jolts');
assert.equal(jolts.date, '2026-11-05', 'published date supersedes cadence');
assert.equal(jolts.actual, null, 'figures tied to displaced date are cleared');
assert.equal(jolts.consensus, null);
assert.equal(data.events.filter(e => /JOLTS|Job Openings/.test(e.title)).length, 1);
assert(!data.events.some(e => /Future publication/.test(e.title)));
assert(data.events.some(e => e.observed && e.title === 'Fed announcement today'));
assert.equal(calendarHealth(data, Date.parse(built)).warnings.length, 3);
assert(calendarHealth(data, Date.parse('2026-11-06')).warnings.some(s => /refresh/.test(s)));
assert.deepEqual(upcomingEarningsList(chains, '2026-10-27').map(e => e.symbol), ['AAPL', 'MSFT']);
assert.equal(upcomingEarningsList({ AAPL: { fundamentals: { nextEarningsDate: '2026-02-31' } } }, '2026-02-01').length, 0);
assert.equal(dedupeCalendarEvents([{ type: 'catalyst', date: catalyst.date, title: catalyst.title, symbol: 'AAPL' }, { type: 'catalyst', date: catalyst.date, title: catalyst.title, symbol: 'MSFT' }]).length, 2);
assert.equal(buildCalendarPayload({ AAPL: { catalysts: [{ date: catalyst.date, title: 'Unsupported legacy event' }] } }, [], built, {}).events.filter(e => e.type === 'catalyst').length, 0);

const census = parseCensusCalendar(`<table><tr><td>Advance Monthly Sales for Retail and Food Services</td><td sorttable_customkey="199901010830">November 17, 2026</td><td>8:30 AM</td><td>October 2026</td></tr><tr><td>Suspended release</td><td sorttable_customkey="202611180830">Suspended</td><td>8:30 AM</td><td>October 2026</td></tr></table>`, 2026);
assert.equal(census.length, 1); assert.equal(census[0].date, '2026-11-17'); assert.equal(census[0].time, '08:30 ET');
const ism = parseIsmCalendar('<table><tr><th>July 2026</th><td>1</td><td>6<sup>**</sup></td></tr><tr><th>November 2026</th><td>2</td><td>4</td></tr></table>');
assert.equal(ism.find(e => e.date === '2026-07-06').subtype, 'ism-services');
assert.equal(ism.length, 4);
const weekly = supplementalWeeklyReports([
  { country: 'USD', title: 'Unemployment Claims', date: '2026-10-29T08:30:00-04:00', forecast: '200K', actual: 'invented future value' },
  { country: 'USD', title: 'ADP Employment Change', date: '2026-11-04T08:15:00-05:00' },
  { country: 'EUR', title: 'Retail Sales', date: '2026-10-29T08:30:00-04:00' },
  { country: 'USD', title: 'Unemployment Claims', date: '2026-10-29' },
], start, end, Date.parse(built));
assert.equal(weekly.length, 2); assert.equal(weekly[0].time, '08:30 ET'); assert.equal(weekly[0].actual, null);
assert.equal(weekly[1].time, '08:15 ET');
assert.equal(matchForexFactoryEventSubtype('ADP Non-Farm Employment Change'), null);
assert.equal(matchForexFactoryEventSubtype('Non-Farm Employment Change'), 'nfp');
assert.equal(matchForexFactoryEventSubtype('Core PPI m/m'), null);
assert.equal(matchForexFactoryEventSubtype('PPI y/y'), null);
assert.equal(matchForexFactoryEventSubtype('PPI m/m'), 'ppi-mom');
const adpCalendar = buildCalendarPayload({}, [], built, {
  reportEvents: [{ type:'report', subtype:'weekly-adp', title:'ADP Non-Farm Employment Change', date:'2026-11-04', sourceKey:'forex-factory' }],
  officialCalendar: { events: [{...official,title:'Employment Situation',date:'2026-11-06'}], status:{bls:true} },
});
assert.equal(adpCalendar.events.find(e => e.subtype === 'weekly-adp').date, '2026-11-04', 'ADP cannot be moved onto the official payroll date');
assert(adpCalendar.events.some(e => e.official && e.title === 'Employment Situation'), 'ADP cannot suppress the official payroll release');
const catchup = dedupeCalendarEvents([
  {type:'report',title:'Durable Goods Orders MoM',subtype:'durable-goods-mom',date:'2026-11-04'},
  ...['August 2026','September 2026'].map(referencePeriod=>({type:'report',title:'Advance Report on Durable Goods',date:'2026-11-04',official:true,referencePeriod})),
]);
assert.equal(catchup.length, 3, 'catch-up releases for different reference periods remain visible');

const market = marketSessionCalendarEvents(start, end);
assert(market.some(e => e.date === '2026-11-26' && /closed/.test(e.title)));
assert(market.some(e => e.date === '2026-11-27' && e.time === '13:00 ET'));
assert(!market.some(e => e.date === '2026-11-11'), 'Veterans Day does not close NYSE');
const recoveredTicker = buildCalendarPayload({}, [], built, { sessionMap: new Map([['NVDA|2026-11-03', 'PM']]) });
assert(recoveredTicker.events.some(e => e.symbol === 'NVDA'), 'Nasdaq recovers a tracked stock even when its chain failed');
const recoveredReports = buildCalendarPayload({}, [], built, {
  reportEvents: [{ type: 'report', subtype: 'weekly-claims', title: 'Unemployment Claims', date: '2026-11-05' }],
  priorCalendar: { events: [{ type: 'report', subtype: 'cpi-mom', title: 'Inflation Rate MoM', date: '2026-11-10', previous: '+0.2%' }],
    reportHistory: { 'cpi-mom': { points: [{ m: '2026-09', v: 0.2 }] } } },
});
assert(recoveredReports.events.some(e => e.subtype === 'cpi-mom' && e.stale), 'weekly success does not suppress monthly salvage');
assert(recoveredReports.reportHistory['cpi-mom']);
assert.deepEqual(recoveredReports.coverage.staleReportSubtypes, ['cpi-mom']);
const conflictingPrior = buildCalendarPayload({}, [], built, {
  officialCalendar: { events: [official], status: { bls: true } },
  priorCalendar: { events: [{ type: 'report', subtype: 'jolts', title: 'JOLTS Job Openings', date: '2026-11-03' }] },
});
assert(!conflictingPrior.events.some(e => e.subtype === 'jolts'), 'stale baseline cannot override a changed official date');

// Exercise network adapters against controlled failures, including HTTP 200
// block pages. No real network calls or output artifact mutations in this suite.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => String(url).includes('2026-10-28') ? {} : { data: { rows: [] } } });
  const map = await fetchNasdaqEarningsSessions(Date.parse('2026-10-28'), 2, []);
  assert.equal(map.coverage.status, 'partial'); assert.deepEqual(map.coverage.failedDates, ['2026-10-28']);
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>Access denied</html>' });
  const calendars = await fetchOfficialCalendarEvents(start, Date.parse('2026-10-31'));
  assert.equal(calendars.status.bea, false); assert.equal(calendars.status.bls, false);
  assert.equal(calendars.status['fed-board-2026-10'], false);
  assert.equal(calendars.status['census-2026'], false); assert.equal(calendars.status['ism-2026'], false);
  const yearEnd = await fetchOfficialCalendarEvents(start, end);
  assert(yearEnd.events.some(e => e.subtype === 'ism-services' && e.date === '2026-11-04' && e.stale), 'blocked ISM source retains its published dated baseline');
  const priorIsm = {type:'report',subtype:'ism-services',title:'ISM Services PMI',date:'2026-11-05',official:true,sourceKey:'ism-2026'};
  const priorPreferred = buildCalendarPayload({}, [], built, {officialCalendar:yearEnd,priorCalendar:{events:[priorIsm]}});
  assert(!priorPreferred.events.some(e => e.subtype === 'ism-services' && e.date === '2026-11-04'), 'last successful publisher date supersedes an older static baseline');
  assert(priorPreferred.events.some(e => e.subtype === 'ism-services' && e.date === '2026-11-05' && e.stale));

} finally { globalThis.fetch = originalFetch; }
new vm.Script(renderAppJs()); // Check the generated program, not just its template.
console.log('Calendar coverage smoke passed: universe, dates, citations, missing feeds, report matching, market sessions and generated browser program.');

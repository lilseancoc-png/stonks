import {fetchCompanyCalendar} from "../lib/company-events.mjs";
// Read-only calendar audit. --live checks the published payload; --sources
// also exercises official schedule adapters. Never publishes or runs AI.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { TICKERS, SECTORS, fetchOfficialCalendarEvents, calendarCutoffMs } from './build.mjs';
import { calendarHealth } from '../lib/calendar-policy.mjs';

export function auditCalendar(data, nowMs = Date.now()) {
  const today = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const current = (data.events || []).filter(e => (e.endDate || e.date) >= today);
  const stocks = TICKERS.filter(s => SECTORS[s] !== 'ETF');
  const scheduled = new Set(current.filter(e => e.type === 'earnings' && stocks.includes(e.symbol)).map(e => e.symbol));
  const removed = [...new Set((data.events || []).filter(e => e.symbol && !TICKERS.includes(e.symbol)).map(e => e.symbol))];
  const families = {
    earnings: e => e.type === 'earnings', catalysts: e => e.type === 'catalyst',
    fed: e => e.type === 'fomc' || e.type === 'fed', reports: e => e.type === 'report',
    macro: e => ['macro','cpi','sec'].includes(e.type),
    census: e => /census/.test(e.sourceKey || ''), ismServices: e => /ISM.*Services/i.test(e.title),
    weeklyClaims: e => /unemployment claims|jobless claims/i.test(e.title),
    marketSessions: e => e.sourceKey === 'nyse',
  };
  return {
    checkedAtIso: new Date(nowMs).toISOString(), calendarBuiltAtIso: data.builtAtIso, windowEnd: data.windowEnd,
    trackedSymbols: TICKERS.length, trackedStocks: stocks.length,
    upcomingEarnings: scheduled.size, earningsWithoutUpcomingDate: stocks.filter(s => !scheduled.has(s)),
    removedSymbols: removed, health: calendarHealth(data, nowMs), sourceCoverage: data.coverage || null,
    upcomingCounts: Object.fromEntries(Object.entries(families).map(([k, test]) => [k, current.filter(test).length])),
    uncitedCatalysts: current.filter(e => e.type === 'catalyst' && (!e.sourceUrl || (!e.dateEvidence && !(e.companyEvent && e.verifiedAt)))).map(e => ({ symbol: e.symbol, date: e.date, title: e.title })),
    limits: ['Counts establish receipt, not completeness.', 'Missing earnings dates can mean already reported, not announced, outside the horizon, or an unavailable input.', 'News catalysts and weekly additions cannot guarantee every material event.'],
  };
}

async function main() {
  const live = process.argv.includes('--live');
  const input = process.argv.find(a => a.startsWith('--input='))?.slice(8) || 'data/calendar.json';
  const url = 'https://www.mingstreet.app/data/calendar.json';
  let data;
  if (live) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Live calendar returned HTTP ${response.status}`);
    data = await response.json();
  } else data = JSON.parse(await readFile(input, 'utf8'));
  const report = { source: live ? url : input, ...auditCalendar(data) };
  if (process.argv.includes('--sources')) {
    const start = Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T00:00:00Z');
    const official = await fetchOfficialCalendarEvents(start, calendarCutoffMs(start));
    const company = await fetchCompanyCalendar({symbols:TICKERS,startMs:start,cutoffMs:calendarCutoffMs(start),prior:data.companyCalendar});
    report.companySources = {status:company.status,events:company.events.map(({symbol,title,date,endDate,sourceUrl,verifiedAt,sourceCheckFailed})=>({symbol,title,date,endDate,sourceUrl,verifiedAt,sourceCheckFailed}))};
    report.liveOfficialSources = { status: official.status, upcomingBySource: official.events.reduce((a, e) => { a[e.sourceKey] = (a[e.sourceKey] || 0) + 1; return a; }, {}) };
  }
  const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

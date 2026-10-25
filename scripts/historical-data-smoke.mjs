import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildHistoricalData, completedCloseCutoff, cleanHistoricalBars, summarizeHistory } from '../lib/historical-data.mjs';
import { historicalFixtureBars } from './fixtures/historical-data.mjs';
import { writeHistoricalDataFile } from './refresh-historical-data.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { serveDataKey } from '../lib/data-response.mjs';
import { store } from '../lib/datastore.mjs';
import { signSession } from '../lib/session.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';
import { historicalTradingDate, isHistoricalTradingDate } from '../lib/historical-market-calendar.mjs';
import { sessionForDate } from '../lib/us-equity-calendar.mjs';
const bars = historicalFixtureBars(), builtAtIso = '2026-10-24T22:00:00Z';
const build = rows => buildHistoricalData({ symbols: { SPY: rows }, builtAtIso });
const payload = build(bars), index = payload.indexes.SPY;
const study = id => index.studies.find(s => s.id === id);
assert.equal(completedCloseCutoff('2026-07-10T19:59:00Z'), '2026-07-09');
assert.equal(completedCloseCutoff('2026-07-10T20:15:00Z'), '2026-07-10');
assert.equal(completedCloseCutoff('2026-01-10T20:59:00Z'), '2026-01-09', 'ET date/time survives DST');
for(let t=Date.parse('2026-01-01');t<Date.parse('2029-01-01');t+=86400000){const day=new Date(t).toISOString().slice(0,10);assert.equal(isHistoricalTradingDate(day),sessionForDate(day).open,day+' matches the verified modern NYSE calendar');}
for(const day of ['2001-09-11','2001-09-14','2012-10-29','2012-10-30','2018-12-05','2025-01-09','2024-03-29']) assert.equal(isHistoricalTradingDate(day),false,day+' is a published closure');
assert.equal(historicalTradingDate('2024-03-31'),'2024-03-28');
assert.equal(isHistoricalTradingDate('2021-06-18'),true); assert.equal(isHistoricalTradingDate('2022-06-20'),false);
assert.equal(isHistoricalTradingDate('1997-01-20'),true); assert.equal(isHistoricalTradingDate('1998-01-19'),false);
assert.equal(cleanHistoricalBars([{ t: '2026-02-30', c: 2 }, { t: '2026-10-24', c: 4 }, { t: '2026-10-23', c: null }, { t: '2026-10-23', c: '10' }], '2026-10-24').length, 0);
assert.equal(index.asOf, '2026-10-23');
assert.deepEqual(build([...bars].reverse()), payload, 'input order does not change analysis');
assert.deepEqual(build([...bars, { t: '2027-01-05', c: 999999 }]), payload, 'future rows cannot affect historical comparisons or analogs');
assert.equal(study('santa').comparison.status, 'upcoming');
assert.equal(study('santa').comparison.path.length, 0);
assert(study('santa').ranges.all.years.every(e => e.sessions === 7));
for (const [instant, sessions, state] of [['2025-12-29T18:00:00Z', 2, 'in-progress'], ['2026-01-05T18:00:00Z', 6, 'in-progress'], ['2026-01-05T22:00:00Z', 7, 'complete']]) {
  const santa = buildHistoricalData({ symbols: { SPY: bars }, builtAtIso: instant }).indexes.SPY.studies.find(s => s.id === 'santa');
  assert.equal(santa.comparison.year, 2025); assert.equal(santa.comparison.sessions, sessions); assert.equal(santa.comparison.status, state);
}
assert.equal(study('pre-midterm').comparison.expectedEnd, '2026-11-02', 'election is Tuesday after first Monday');
assert(study('midterm').ranges.all.years.every(e => e.year % 4 === 2 && e.year < 2026));
assert.equal(study('midterm').comparison.status, 'in-progress');
assert.equal(study('midterm').ranges.all.meanRange95, null, 'small election samples do not get a confidence interval');
assert.equal(study('post-midterm').comparison.status, 'upcoming');
assert(study('post-midterm').ranges.all.years.every(e => e.sessions === 252));
assert(study('q4').ranges.all.years.every(e => e.year < 2026));
assert(study('january').ranges.all.years.every(e => e.year < 2026), 'completed comparison occurrence is also held out');
assert.equal(study('q4').comparisonAtProgress, undefined);
assert(study('q4').ranges.all.comparisonAtProgress.progress < 100);
assert(study('q4').ranges.all.n > study('q4').ranges['10y'].n);
for(const instant of ['2024-03-28T20:16:00Z','2024-03-31T22:00:00Z']) {
  const q=buildHistoricalData({symbols:{SPY:bars},builtAtIso:instant}).indexes.SPY.studies.find(s=>s.id==='q1');
  assert.equal(q.comparison.status,'complete','the last confirmed trading close completes a holiday/weekend-ending quarter');
  assert.equal(q.comparison.end,'2024-03-28'); assert.equal(q.comparison.path.at(-1).x,100);
}
const notClosed=buildHistoricalData({symbols:{SPY:bars},builtAtIso:'2024-03-28T19:59:00Z'}).indexes.SPY.studies.find(s=>s.id==='q1');
assert.equal(notClosed.comparison.status,'in-progress'); assert(notClosed.comparison.path.at(-1).x<100);
const missingTerminal=buildHistoricalData({symbols:{SPY:bars.filter(b=>b.t!=='2024-03-28')},builtAtIso:'2024-03-31T22:00:00Z'}).indexes.SPY.studies.find(s=>s.id==='q1');
assert.equal(missingTerminal.comparison.status,'unavailable','a closed period without its expected terminal price is not a complete return');
const saturdayEnd=buildHistoricalData({symbols:{SPY:bars},builtAtIso:'2022-12-30T21:16:00Z'}).indexes.SPY.studies.find(s=>s.id==='q4');
assert.equal(saturdayEnd.comparison.status,'complete'); assert.equal(saturdayEnd.comparison.end,'2022-12-30');
assert(index.monthly.every(m => m.n > 0));
for (const s of index.studies) for (const r of Object.values(s.ranges)) {
  assert.equal(r.n, r.years.length);
  if (r.n) { assert.equal(r.path.length, 21); assert.equal(r.path[0].median, 0); assert(r.path.every(p => p.low <= p.median && p.median <= p.high)); }
  for (const e of r.years) {
    const base = bars.find(b => b.t === e.baseline), end = bars.find(b => b.t === e.end);
    assert(Math.abs(e.returnPct - (end.c / base.c - 1) * 100) < .000051, 'return includes first session from its prior close');
  }
}
assert.deepEqual(summarizeHistory([]).path, []);
assert.equal(summarizeHistory([]).meanPct, null);
assert.equal(summarizeHistory([{ returnPct: 0, path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]).positivePct, 0, 'zero is not a positive observation');
const noBase = build(bars.filter(b => b.t >= '2020-01-02'));
assert.equal(noBase.indexes.SPY, undefined, 'less than ten years cannot publish historical studies');
assert.equal(noBase.coverage.markets.find(s => s.id === 'SPY').status, 'under-ten-years');
const missingBase = build(bars.filter(b => b.t >= '2010-01-04'));
assert(!missingBase.indexes.SPY.studies.find(s => s.id === 'january').ranges.all.years.some(e => e.year === 2010));
const gap = build(bars.filter(b => b.t !== '2023-12-29'));
assert(!gap.indexes.SPY.studies.find(s => s.id === 'santa').ranges.all.years.some(e => e.year === 2023), 'Santa missing required session is excluded');
const beforeClose = buildHistoricalData({ symbols: { SPY: [...bars, { t: '2026-10-26', c: 999999 }] }, builtAtIso: '2026-10-26T18:00:00Z' });
assert.equal(beforeClose.indexes.SPY.asOf, '2026-10-23');
for (const a of index.analogs.rows) {
  const i = bars.findIndex(b => b.t === a.date), m = index.current;
  assert.equal(a.distance, Math.round((Math.abs(a.trend63Pct - m.trend63Pct) / 10 + Math.abs(a.volatility20Pct - m.volatility20Pct) / 10) * 10000) / 10000);
  assert(Math.abs(a.next20Pct - (bars[i + 20].c / bars[i].c - 1) * 100) < .000051);
}
assert(isPremiumKey('historical-data.json'));
assert.deepEqual(roleClaimForKey('historical-data.json'), ['tr', 'tp']);
assert.deepEqual(roleClaimForKey('historical-source-history.json'), ['tr', 'tp']);
assert(isBakeOwnedKey('historical-data.json'));
const temp = await mkdtemp(resolve(tmpdir(), 'stonks-historical-'));
try {
  let result = await writeHistoricalDataFile({ dataDir: temp, builtAtIso });
  assert.equal(result.indexes, 0, 'missing cache is unavailable, not invented history');
  await writeFile(resolve(temp, 'index-long-history.json'), JSON.stringify({ builtAtIso, symbols: { SPY: bars } }));
  result = await writeHistoricalDataFile({ dataDir: temp, builtAtIso });
  assert.equal(result.indexes,0,'a legacy core cache alone cannot establish confirmed close provenance');
  const sourceCache={version:2,builtAtIso,symbols:{SPY:bars},records:{SPY:{collectedAtIso:builtAtIso,confirmedThrough:'2026-10-23'}}};
  result = await writeHistoricalDataFile({ dataDir: temp, builtAtIso, sourceCache });
  assert.equal(result.indexes,1);
  const output = JSON.parse(await readFile(resolve(temp, 'historical-data.json')));
  assert.equal(output.sourceBuiltAtIso, builtAtIso);
} finally { await rm(temp, { recursive: true, force: true }); }
const originalGet = store.get, oldSecret = process.env.SESSION_SECRET, oldEnabled = process.env.PRIVATE_DATA_ENABLED;
let reads = 0;
store.get = async () => { reads++; return Buffer.from(JSON.stringify(payload)); };
process.env.SESSION_SECRET = 'local-test-only-historical-session-secret';
process.env.PRIVATE_DATA_ENABLED = '1';
function response() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(v) { this.body = v; }, end(v) { this.body = v; } }; }
try {
  for (const claims of [null, {}, { tr: true }, { tp: true }, { tr: true, tp: false }]) {
    const cookie = claims ? 'stonks_session=' + await signSession(claims) : '';
    const res = response(); await serveDataKey({ headers: { cookie } }, res, 'historical-data.json');
    assert.equal(res.statusCode, 401); assert.equal(res.headers['Cache-Control'], 'private, no-store');
    const cacheRes = response(); await serveDataKey({ headers: { cookie } }, cacheRes, 'historical-source-history.json'); assert.equal(cacheRes.statusCode, 401);
  }
  assert.equal(reads, 0, 'unauthorized requests never reach storage');
  const res = response(), cookie = 'stonks_session=' + await signSession({ tr: true, tp: true });
  await serveDataKey({ headers: { cookie } }, res, 'historical-data.json');
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(reads, 1);
} finally {
  store.get = originalGet;
  if (oldSecret == null) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  if (oldEnabled == null) delete process.env.PRIVATE_DATA_ENABLED; else process.env.PRIVATE_DATA_ENABLED = oldEnabled;
}
console.log('Historical Data passed: completed-close cutoff, calendar/session windows, held-out years, returns, bands, analog ranking, missing data, private publication and strict owner access.');

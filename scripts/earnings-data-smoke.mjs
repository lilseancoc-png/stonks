import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { earningsWeek1DueDate, secRevenueForReport, backfillEarningsRevenue } from '../lib/earnings-data.mjs';

assert.equal(earningsWeek1DueDate('2026-10-29','AM'),'2026-11-05');
assert.equal(earningsWeek1DueDate('2026-10-29','PM'),'2026-11-06');
assert.equal(earningsWeek1DueDate('2026-11-25','PM'),'2026-12-04','Thanksgiving is not a trading session');
assert.equal(earningsWeek1DueDate('2026-11-01','AM'),'2026-11-09','Weekend announcement reacts on Monday');
assert.equal(earningsWeek1DueDate('2026-02-30','AM'),null);
assert.equal(earningsWeek1DueDate('2025-10-29','AM'),null,'Unknown calendars are not guessed');
const fact={start:'2026-07-01',end:'2026-09-30',val:1234567890,filed:'2026-10-30',form:'10-Q',accn:'0000000001-26-000040'};
const tag='RevenueFromContractWithCustomerExcludingAssessedTax';
const raw={cik:1,facts:{'us-gaap':{[tag]:{units:{USD:[fact,{...fact,start:'2026-01-01',val:9000000000}]}}}}};
const args={cik:'0000000001',reportDate:'2026-10-29',currency:'USD',asOf:'2026-11-02'};
assert.equal(secRevenueForReport(raw,args).value,fact.val,'Quarterly amount, not YTD');
assert.equal(secRevenueForReport(raw,{...args,cik:2}),null,'Different issuer rejected');
assert.equal(secRevenueForReport(raw,{...args,currency:'EUR'}),null,'Currency is never assumed');
assert.equal(secRevenueForReport(raw,{...args,asOf:'2026-10-29'}),null,'Future filing cannot fill a past snapshot');
assert.equal(secRevenueForReport(raw,{...args,sector:'Bank'}),null,'Bank contract revenue is not total revenue');
for(const change of [{val:null},{val:'123'},{val:-1},{start:'2026-01-01'},{filed:'2026-12-30'},{end:'2026-11-30'},{form:'8-K'},{accn:'invalid'}]) {
  const altered=structuredClone(raw);altered.facts['us-gaap'][tag].units.USD=[{...fact,...change}];
  assert.equal(secRevenueForReport(altered,args),null,JSON.stringify(change));
}
const store={tickers:Object.fromEntries(Array.from({length:26},(_,i)=>['T'+String(i).padStart(2,'0'),{events:[{date:'2026-10-29',epsActual:1,revenueActual:null}]}]))};
store.tickers.T00.events.push({date:'2026-10-29',epsActual:1,revenueActual:777});
const chains=Object.fromEntries(Object.keys(store.tickers).map(s=>[s,{fundamentals:{financialCurrency:'USD'}}]));
const cikMap=new Map(Object.keys(chains).map(s=>[s,1]));
let calls=0;
const readSec=async()=>{calls++;return new Response(JSON.stringify(raw));};
assert.deepEqual(await backfillEarningsRevenue({store,chains,cikMap,readSec,asOf:args.asOf}),{requests:8,filled:8});
assert.equal(store.tickers.T00.events[1].revenueActual,777,'Existing values retained');
assert.match(store.tickers.T00.events[0].revenueSource.sourceUrl,/sec.gov\/Archives/);
for(let i=0;i<3;i++)await backfillEarningsRevenue({store,chains,cikMap,readSec,asOf:args.asOf});
assert.equal(calls,20,'Daily request cap survives multiple builds');
const persisted=JSON.parse(JSON.stringify(store));
assert.equal((await backfillEarningsRevenue({store:persisted,chains,cikMap,readSec,asOf:args.asOf})).requests,0,'Restart retains cap');
assert.equal((await backfillEarningsRevenue({store,chains,cikMap,readSec,asOf:'2026-11-03'})).filled,6,'Next day resumes remaining issuers');
const failed={tickers:{T00:{events:[{date:'2026-10-29',epsActual:1,revenueActual:null}]}}};
await backfillEarningsRevenue({store:failed,chains,cikMap,readSec:async()=>{throw Error('offline');},asOf:args.asOf});
assert.equal(failed.tickers.T00.events[0].revenueActual,null);
assert.equal((await backfillEarningsRevenue({store:failed,chains,cikMap,readSec,asOf:args.asOf})).requests,0,'Failure is not retried repeatedly in one day');
assert.equal((await backfillEarningsRevenue({store:failed,chains,cikMap,readSec,asOf:'2026-11-03'})).filled,1);
const build=await readFile(new URL('build.mjs',import.meta.url),'utf8');
const match=build.match(/function revenueActualForEarningsEvent\(data, dateIso\) \{[\s\S]*?\n\}/)[0];
const picker=vm.runInNewContext('('+match+')');
assert.equal(picker({fundamentals:{revenueHistory:[{date:'2026-09-30',value:null}]}},'2026-10-29'),null,'Null revenue cannot become zero');
assert.equal(picker({fundamentals:{revenueHistory:[{date:'2026-03-31',value:1}]}},'2026-10-29'),null,'Old quarter cannot fill a new report');
// Run the real producer after collection, with model calls disabled.
const key=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;
try {
  const {buildEarningsTrackerPayload,attachEarningsHx}=await import('./build.mjs');
  const event={...store.tickers.T00.events[0],session:'PM',epsEstimate:1,surprisePct:0,movePct:.02};
  const ledger={tickers:{AMZN:{events:[event]}}};
  const data={AMZN:{fundamentals:{name:'Example',financialCurrency:'USD'}}};
  attachEarningsHx(data,ledger);
  const payload=await buildEarningsTrackerPayload(ledger,data,'2026-11-02T20:00:00Z');
  const row=payload.seasons.flatMap(s=>s.rows).find(r=>r.sym==='AMZN');
  assert.equal(row.revenueActual,fact.val);
  assert.deepEqual(row.revenueSource,event.revenueSource);
  assert.equal(row.week1DueDate,'2026-11-06');
  assert.equal(data.AMZN.earningsHx.events[0].revenueSource.sourceUrl,event.revenueSource.sourceUrl);
} finally { if(key==null)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key; }
console.log('Earnings data passed: trading windows, issuer/quarter/currency/filing provenance, YTD rejection, bank revenue, immutable known values, retries and persistent collection budgets.');

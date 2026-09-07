import assert from 'node:assert/strict';
import { recoveryCandidates, recoveryEvidence } from '../lib/earnings-recovery.mjs';

const now = Date.parse('2026-09-06T18:00:00Z');
const row = { sym: 'TEST', date: '2026-09-01', session: 'PM', movePct: -0.10, guidance: 'up', guidanceSrc: 'call' };
function fixture() {
  const dates = Array.from({ length: 21 }, (_, i) => new Date(Date.parse('2026-08-15T00:00:00Z') + i*86400000).toISOString().slice(0,10));
  return {
    spot: 105, quoteAsOf: '2026-09-04T20:00:00Z',
    fundamentals: { fiftyTwoWeekHigh: 150, operatingMargin: 12, totalCash: 30, totalDebt: 20, forwardPE: 15, marketCap: 1000,
      fcfHistory: ['2025-09-30','2025-12-31','2026-03-31','2026-06-30'].map(date => ({ date, value: 10 })),
      revenueHistory: [{ date:'2025-06-30', value:100 }, { date:'2026-06-30', value:110 }],
    },
    earningsHx: { events: [{ date: row.date, guidance:'up', guidanceSrc:'call', closeBefore:130 }] },
    priceSeries: { t:dates, c:dates.map((_,i)=>i>=19?105:100), l:dates.map(()=>98) },
  };
}
const check = (e, key) => e.checks.find(c => c.key === key);
let data = fixture();
assert.equal(recoveryEvidence(row,data,now).state, 'supported');
data.earningsHx.events[0].qEnd = '2026-07-31';
assert.equal(check(recoveryEvidence(row,data,now),'freshness').state,'missing','recent financials must cover the reported fiscal quarter');
assert.match(check(recoveryEvidence(row,data,now),'freshness').detail,/report quarter ending 2026-07-31/);
data.fundamentals.revenueHistory.push({date:'2026-07-31',value:120});
assert.equal(check(recoveryEvidence(row,data,now),'freshness').state,'missing','current revenue alone cannot cover stale FCF');
data.fundamentals.fcfHistory.push({date:'2026-07-31',value:10});
assert.equal(check(recoveryEvidence(row,data,now),'freshness').state,'pass','both histories cover the report quarter');
data.earningsHx.events[0].qEnd = '2027-01-31';
assert.equal(check(recoveryEvidence(row,data,now),'freshness').state,'missing','future fiscal quarter cannot be covered');
data = fixture();
for (const stamp of [Date.parse(data.quoteAsOf), Date.parse(data.quoteAsOf)/1000, String(Date.parse(data.quoteAsOf)/1000), data.quoteAsOf]) {
  assert.equal(check(recoveryEvidence(row,{...data,quoteAsOf:stamp},now),'freshness').state,'pass');
}
for (const stamp of [null, '', NaN, Infinity, 1e30, '2027-01-01']) {
  assert.equal(check(recoveryEvidence(row,{...data,quoteAsOf:stamp},now),'freshness').state,'missing');
}
data = fixture(); data.earningsHx.events[0].guidance = null;
assert.equal(check(recoveryEvidence({...row,guidanceSrc:null},data,now),'guidance').state,'missing','unrelated call tag cannot verify fallback guidance');
data = fixture(); data.earningsHx.events.push({ date:'2026-09-03' });
assert.equal(check(recoveryEvidence(row,data,now),'freshness').state,'missing','newer report invalidates old event queue');
data = fixture(); data.fundamentals.fcfHistory = data.fundamentals.fcfHistory.map(q=>({...q,date:q.date.replace('2026','2024').replace('2025','2023')}));
assert.equal(recoveryEvidence(row,data,now).fcf,null,'ancient cash flow cannot establish current quality');
data = fixture(); data.fundamentals.fcfHistory.push({ ...data.fundamentals.fcfHistory[3] });
assert.equal(recoveryEvidence(row,data,now).fcf,40,'duplicate quarters are counted once');
data = fixture(); data.priceSeries.l[20]=110;
assert.equal(recoveryEvidence(row,data,now).rr,null,'impossible low above close cannot support a payoff');
data = fixture(); data.priceSeries.t.push('2027-01-01'); data.priceSeries.c.push(120); data.priceSeries.l.push(118);
assert.equal(recoveryEvidence(row,data,now).priceDate,'2026-09-04','future bars cannot establish confirmation');
data = fixture(); data.earningsHx.events[0].closeBefore = 100;
assert.equal(recoveryEvidence(row,data,now).rr,null,'spent recovery anchor has no positive reward/risk');
data = fixture(); data.fundamentals.fiftyTwoWeekHigh = null;
assert.equal(check(recoveryEvidence(row,data,now),'drawdown').state,'missing','missing high cannot imply no ATH');
data = fixture(); data.fundamentals.totalCash = -30; data.fundamentals.totalDebt=-50;
assert.equal(check(recoveryEvidence(row,data,now),'balance').state,'missing');
assert.equal(recoveryEvidence(row,{},now).state,'incomplete');
data = fixture(); data.fundamentals.financialCurrency = 'TWD';
assert.equal(recoveryEvidence(row,data,now).fcfYield,null,'local-currency FCF cannot divide by USD market cap');
data.fundamentals.financialCurrency = 'USD';
assert.equal(recoveryEvidence(row,data,now).fcfYield,4,'matching USD currencies allow FCF yield');
const candidates = recoveryCandidates({ seasons:[{ rows:[row,{...row,date:'2026-09-03',guidance:'down'},{...row,sym:'BAD',date:'2026-02-30'}] }] },{},now);
assert.equal(candidates.length,0,'newest report supersedes older qualifying guidance and invalid calendar dates are excluded');
assert.equal(recoveryCandidates({seasons:[{rows:[row]}]}, {}, now).length,1);
console.log('Earnings recovery smoke passed');

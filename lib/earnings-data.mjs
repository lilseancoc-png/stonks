import { sessionForDate } from './us-equity-calendar.mjs';
const DAY=86400000;
const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const finite=value=>typeof value==='number' && Number.isFinite(value);

export function earningsWeek1DueDate(date,session){
  if(!day(date))return null;
  let ms=Date.parse(date),remaining=session==='AM'?5:6;
  if(session==='AM'){
    const current=sessionForDate(date);
    if(!current)return null;
    if(!current.open)remaining=6;
  }
  for(let i=0;i<24;i++){
    ms+=DAY;const date=new Date(ms).toISOString().slice(0,10),s=sessionForDate(date);
    if(!s)return null;
    if(s.open && --remaining===0)return date;
  }
  return null;
}

// SEC facts must match the issuer, currency, quarter duration and announcement
// window. Annual/YTD totals and bank fee-only revenue are never substituted.
export function secRevenueForReport(raw,{cik,reportDate,currency='USD',sector='',asOf}){
  if(!day(reportDate) || !day(asOf) || String(raw?.cik).padStart(10,'0')!==String(cik).padStart(10,'0'))return null;
  const tags=/^(Bank|Broker)$/.test(sector)?['RevenuesNetOfInterestExpense']:['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet'];
  const found=[];
  for(const [priority,tag] of tags.entries())for(const row of raw.facts?.['us-gaap']?.[tag]?.units?.[currency] || []){
    if(!day(row.start)||!day(row.end)||!day(row.filed)||!finite(row.val)||row.val<0||!['10-Q','10-Q/A','10-K','10-K/A'].includes(row.form)||!/^\d{10}-\d{2}-\d{6}$/.test(row.accn || ''))continue;
    const duration=(Date.parse(row.end)-Date.parse(row.start))/DAY+1,lag=(Date.parse(reportDate)-Date.parse(row.end))/DAY,fileLag=(Date.parse(row.filed)-Date.parse(reportDate))/DAY;
    if(duration<65||duration>105||lag<7||lag>100||fileLag<0||fileLag>45||row.filed>asOf)continue;
    found.push({row,tag,priority});
  }
  const hit=found.sort((a,b)=>b.row.end.localeCompare(a.row.end)||a.priority-b.priority||a.row.filed.localeCompare(b.row.filed))[0];
  if(!hit)return null;
  return {value:hit.row.val,source:{provider:'SEC company facts',periodStart:hit.row.start,periodEnd:hit.row.end,currency,tag:hit.tag,filed:hit.row.filed,accession:hit.row.accn,firstSeenAt:asOf,sourceUrl:'https://www.sec.gov/Archives/edgar/data/'+Number(cik)+'/'+hit.row.accn.replaceAll('-','')+'/'}};
}

// One daily attempt per issuer, eight requests per build and twenty per day.
// State lives in the existing earnings-history ledger, so retries/restarts
// retain the budget. Missing official facts remain missing, with a reason.
export async function backfillEarningsRevenue({store,chains,cikMap,readSec,asOf,maxRequests=8}){
  if(!day(asOf))throw Error('Revenue backfill needs an as-of date');
  const state=store.revenueCollection ||= {checks:{},day:asOf,requests:0};
  if(state.day!==asOf){state.day=asOf;state.requests=0;}
  const targets=Object.entries(store.tickers || {}).map(([symbol,entry])=>({symbol,entry,events:(entry.events || []).filter(e=>day(e.date)&&e.date<=asOf&&Date.parse(asOf)-Date.parse(e.date)<=120*DAY&&e.revenueActual==null&&finite(e.epsActual))})).filter(t=>t.events.length&&chains[t.symbol]);
  targets.sort((a,b)=>b.events.map(e=>e.date).sort().at(-1).localeCompare(a.events.map(e=>e.date).sort().at(-1))||a.symbol.localeCompare(b.symbol));
  let requests=0,filled=0;
  for(const {symbol,events} of targets){
    const cik=cikMap?.get(symbol),currency=chains[symbol].fundamentals?.financialCurrency;
    if(!cik || !currency || state.checks[symbol]?.date===asOf)continue;
    if(requests>=maxRequests || state.requests>=20)break;
    state.checks[symbol]={date:asOf,status:'unavailable'};requests++;state.requests++;
    try{
      const response=await readSec('https://data.sec.gov/api/xbrl/companyfacts/CIK'+String(cik).padStart(10,'0')+'.json');
      if(!response.ok)throw Error('SEC data unavailable');
      const text=await response.text();if(text.length>12*1024*1024)throw Error('SEC response exceeds budget');
      const raw=JSON.parse(text);
      for(const event of events){
        const hit=secRevenueForReport(raw,{cik,reportDate:event.date,currency,sector:chains[symbol].sector || chains[symbol].fundamentals?.sector || '',asOf});
        if(hit){event.revenueActual=hit.value;event.revenueSource=hit.source;filled++;}
      }
      state.checks[symbol].status='checked';
    }catch{ /* keep the original null and retry on another day */ }
  }
  return {requests,filled};
}

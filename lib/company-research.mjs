// Owner research compiled from inputs the bake already owns. No I/O or AI.
import { quarterlyFacts, contentHash } from './earnings-forecast.mjs';

export const COMPANY_HISTORY_YEARS = 3;
export const COMPANY_HISTORY_BYTE_LIMIT = 500_000;
const DAY = 86400000;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x;
const floorFor = at => { const d = new Date(at); d.setUTCFullYear(d.getUTCFullYear()-COMPANY_HISTORY_YEARS); return d.toISOString().slice(0,10); };
const historyMetrics = { revenueHistory:'revenue', netIncomeHistory:'netIncome', fcfHistory:'freeCashFlow', capexHistory:'capex', operatingCashFlowHistory:'operatingCashFlow' };

export function retainCompanyHistory({ previous = {}, chains = {}, symbols = [], asOf }) {
  const floor = floorFor(asOf), observations = {};
  for (const symbol of symbols) {
    const rows = new Map((previous[symbol] || []).filter(r => day(r.periodEnd) && r.periodEnd>=floor && r.periodEnd<=asOf.slice(0,10)).map(r => [r.id,r]));
    const f = chains[symbol]?.fundamentals || {}, currency = f.financialCurrency;
    if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) {
      const add = (metric, periodEnd, value, frequency) => {
        if (!day(periodEnd) || periodEnd<floor || periodEnd>asOf.slice(0,10) || !finite(value)) return;
        const fact = { metric,periodEnd,value,currency,frequency,provider:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+(metric==='totalDebt'?'/balance-sheet/':['freeCashFlow','capex','operatingCashFlow'].includes(metric)?'/cash-flow/':'/financials/') };
        const id=contentHash([symbol,fact]);
        if (!rows.has(id)) rows.set(id,{ id,...fact,firstSeenAt:asOf,quality:'Vendor-normalized reported financial; publication time and original filing not independently verified' });
      };
      for (const [field,metric] of Object.entries(historyMetrics)) for (const r of f[field] || []) add(metric,r.date,r.value,'quarter');
      // Debt is explicitly period-dated by the existing provider adapter. Cash
      // and outstanding shares lack equivalent field-level dates, so do not
      // manufacture quarterly observations for them.
      if (finite(f.totalDebt) && f.totalDebt>=0) add('totalDebt',f.totalDebtAsOf,f.totalDebt,'instant');
    }
    observations[symbol]=[...rows.values()].sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd)||a.firstSeenAt.localeCompare(b.firstSeenAt)||a.id.localeCompare(b.id));
  }
  const bytes=Buffer.byteLength(JSON.stringify(observations));
  if(bytes>COMPANY_HISTORY_BYTE_LIMIT) throw Object.assign(Error('Three-year company-history budget exceeded; new vendor-history observations are paused'),{code:'COMPANY_HISTORY_BUDGET'});
  return { observations,bytes,floor,years:COMPANY_HISTORY_YEARS };
}

export function buildCompanyRecord({ symbol, observations = [], vendor = [], asOf }) {
  const floor=floorFor(asOf);
  const quarters=quarterlyFacts(observations,asOf).filter(q=>q.end>=floor);
  const current = new Map();
  for (const row of vendor) {
    const key=[row.metric,row.periodEnd,row.currency].join('|'), old=current.get(key);
    if(!old || old.firstSeenAt<row.firstSeenAt) current.set(key,row);
  }
  const latestQuarter=quarters.at(-1), rows=quarters.map(q=>({
    start:q.start,end:q.end,currency:q.currency,basis:q.basis,
    metrics:Object.fromEntries(Object.entries(q.metrics).map(([metric,o])=>[metric,{ value:o.value,unit:o.unit,filed:o.filed,firstSeenAt:o.firstSeenAt,sourceUrl:o.sourceUrl,quality:o.quality,sourceId:o.id }])),
  }));
  return { version:1,years:COMPANY_HISTORY_YEARS,windowStart:floor,asOf,
    firstPeriod:rows[0]?.end||null,lastPeriod:latestQuarter?.end||null,quarters:rows,
    vendorFacts:[...current.values()].sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd)||a.metric.localeCompare(b.metric)),
    retainedVendorVersions:vendor.length,
    coverage:rows.length>=12?'twelve-or-more-quarter-ends':'partial-history',
    note:'Rolling three-year reporting window. Short or missing coverage stays visible. SEC facts reuse the existing immutable forecast sources; vendor revisions retain their first-observed versions. Retrieved history is not a claim that this system observed it before collection.',
  };
}

const connections = [
  ['memory','MU','Memory supplier','Spot pricing can inform realized-price and mix questions.','Check DRAM versus NAND mix, contract pricing, shipments, inventory and gross margin.'],
  ['memory','DRAM','Memory theme ETF','Industry exposure across holdings, rather than one issuer’s unit economics.','Check current ETF holdings and weights; do not treat it as a memory producer.'],
  ['memory','SNDK','Adjacent NAND cycle','DRAM can suggest broader memory conditions, but does not measure NAND prices.','Confirm NAND-specific pricing, capacity, customer inventory and product mix.'],
  ['memory','WDC','Adjacent storage cycle','A DRAM quote does not price hard drives or establish storage demand.','Confirm storage orders, realized pricing and capacity separately.'],
  ...['NVDA','AMD','AVGO','TSM'].map(s=>['memory',s,'AI silicon / packaging chain','Memory conditions may affect HBM availability, system costs and shipment timing.','Check disclosed supply constraints and product-specific requirements; commodity DRAM is not an HBM quote.']),
  ...['DELL','SMCI','AAPL'].map(s=>['memory',s,'Hardware input cost','Memory price changes may affect bill-of-materials cost and realized margins.','Check purchasing contracts, product mix, inventory timing and customer pass-through.']),
  ...['CRWV','ORCL','MSFT','AMZN','GOOGL'].map(s=>['gpu',s,'Compute seller / operator','Public rental offers inform pricing-pressure and capacity questions.','Check utilization, hardware generation, commitments, power costs and realized revenue per GPU.']),
  ...['NVDA','AMD','DELL','SMCI'].map(s=>['gpu',s,'Accelerator / system supplier','Rental economics can inform customer returns and replacement-demand questions.','Confirm customer orders and utilization; rental offers are not supplier revenue or realized cloud transactions.']),
  ...['MSFT','AMZN','GOOGL','META','ORCL'].map(s=>['capex',s,'Infrastructure spender','Investment creates capacity while consuming cash and future depreciation.','Check incremental revenue, operating cash flow, leases, depreciation and return on new capacity.']),
  ...['NVDA','AMD','AVGO','ANET','TSM','MU','VRT','DELL','SMCI','VST','BE'].map(s=>['capex',s,'Potential infrastructure beneficiary','Customer infrastructure investment can support demand for chips, networking, power or systems.','Verify supplier-specific orders, backlog, shipment timing and margins; aggregate CapEx is not a revenue allocation.']),
];

export function buildIndustryEvidence({ memory=null,gpu=null,capex=null,asOf,universe=[] }) {
  const age=d=>day(d)?(Date.parse(asOf)-Date.parse(d))/DAY:null;
  const status=(date,stale,maxDays)=>{const a=age(date);return stale?'retained / stale':a===null?'date unavailable':a<0?'invalid future observation':a>maxDays?'stale':'current observation';};
  const memoryRows=(memory?.spot?.items||[]).map(r=>{
    const h=memory.spot.history?.[r.name]||[], observed=h.at(-1)?.d||null;
    return {label:r.name,value:finite(r.sessionAvg)?r.sessionAvg:null,unit:'USD per quoted memory unit',change30dPct:finite(r.m1Pct)?r.m1Pct:null,date:observed,status:status(observed,memory.spot.stale,10),sourceUrl:memory.spot.sourceUrl||null};
  });
  const gpuRows=(gpu?.quotes||[]).slice(0,30).map(r=>{
    const observed=gpu.history?.[r.key]?.at(-1)?.d||(!r.stale?gpu.builtAtIso?.slice(0,10):null);
    return {label:[r.provider,r.model,r.market].filter(Boolean).join(' · '),value:finite(r.price)?r.price:null,unit:'USD per GPU-hour',date:observed,status:status(observed,r.stale,10),sourceUrl:r.sourceUrl||r.providerUrl||null};
  });
  const capexRows=(capex?.companies||[]).map(r=>{
    const date=r.ttm?.asOf||r.fyLatest?.end||null;
    return {label:r.ticker+' · '+(r.ttm?'reported TTM CapEx':'reported FY CapEx'),value:r.ttm?.val??r.fyLatest?.val??null,unit:'USD',date,status:status(date,capex.stale,r.ttm?180:550),sourceUrl:r.source==='yahoo'?'https://finance.yahoo.com/quote/'+encodeURIComponent(r.ticker)+'/cash-flow/':'https://www.sec.gov/edgar/search/#/q='+encodeURIComponent(r.ticker),periodIsReportingEnd:true};
  });
  const definitions={
    memory:{name:'Memory pricing',tab:'ram-prices',rows:memoryRows,limit:'Spot DRAM prices differ from HBM, NAND, contracted and retail pricing. No automatic earnings coefficient is fitted.'},
    gpu:{name:'GPU rental pricing',tab:'accelerator-prices',rows:gpuRows,limit:'Advertised offers are not realized prices or utilization. Provider, hardware and service composition can change.'},
    capex:{name:'Infrastructure CapEx',tab:'ai-capex',rows:capexRows,limit:'Company CapEx definitions differ and include non-AI spending. Reporting-period dates are not publication timestamps. No supplier revenue is inferred from aggregate spending.'},
  };
  return Object.entries(definitions).map(([id,d])=>({id,...d,connections:connections.filter(r=>r[0]===id&&universe.includes(r[1])).map(([,symbol,role,mechanism,confirm])=>({symbol,role,mechanism,confirm})),asOf}));
}

export function attachCompanyResearch({ state,payload,chains,asOf,industryInputs={} }) {
  const symbols=(state.cohort?.companies||[]).map(c=>c.symbol);
  let retained,warning=null;
  try{retained=retainCompanyHistory({previous:state.companyHistory||{},chains,symbols,asOf});}
  catch(error){
    if(error.code!=='COMPANY_HISTORY_BUDGET')throw error;
    // Keep accepted history and other research publishing. Only new vendor
    // history is paused; do not truncate records to make a limit disappear.
    retained=retainCompanyHistory({previous:state.companyHistory||{},chains:{},symbols,asOf});
    warning=error.message;
  }
  state.companyHistory=retained.observations;
  payload.companyStorage={years:3,additionalStateBytes:retained.bytes,limitBytes:COMPANY_HISTORY_BYTE_LIMIT,warning,newProviderCalls:0,newStorageKeys:0,accountHeadroom:'Not verified from the connected account; existing private store and publication path reused'};
  for(const c of payload.companies||[]) c.companyRecord={...buildCompanyRecord({symbol:c.symbol,observations:state.observations[c.symbol]||[],vendor:retained.observations[c.symbol]||[],asOf}),historyWarning:warning};
  payload.industryEvidence=buildIndustryEvidence({...industryInputs,asOf,universe:industryInputs.universe||Object.keys(chains)});
  return payload;
}

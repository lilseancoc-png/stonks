import { createHash } from 'node:crypto';
import { companyProfile } from './earnings-forecast-profiles.mjs';

export const FORECAST_VERSION = 1;
export const FORECAST_MODEL = 'seasonal-growth-bridge-v5';
export const FORECAST_KEY = 'earnings-forecast.json';
export const FORECAST_STATE_KEY = 'earnings-forecast-state.json';
const DAY = 86400000;
export const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = xs => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : null;
const median = xs => { const v=[...xs].sort((a,b)=>a-b); return v.length ? (v[Math.floor(v.length/2)]+v[Math.floor((v.length-1)/2)])/2 : null; };
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && finite(Date.parse(x));
const days = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/DAY)+1;
const isoDay = n => new Date(n).toISOString().slice(0,10);
const addDay = (s,n) => isoDay(Date.parse(s)+n*DAY);
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
function canonical(x) { return Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x; }
export const contentHash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(canonical(x))).digest('hex');
export const conservativePublication = filed => date(filed) ? addDay(filed,1)+'T12:00:00.000Z' : null;
const METRICS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','RevenueFromContractsWithCustomers','Revenue'],
  grossProfit: ['GrossProfit'], operatingIncome: ['OperatingIncomeLoss','ProfitLossFromOperatingActivities'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest','IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments','ProfitLossBeforeTax'],
  taxes: ['IncomeTaxExpenseBenefit','IncomeTaxExpenseContinuingOperations'],
  netIncome: ['NetIncomeLossAvailableToCommonStockholdersBasic','NetIncomeLoss','ProfitLossAttributableToOwnersOfParent','ProfitLoss'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding','AdjustedWeightedAverageShares'],
  eps: ['EarningsPerShareDiluted','DilutedEarningsLossPerShare'],
};

export function makeObservation(input) {
  if (!finite(input.value) || !date(input.start) || !date(input.end) || input.start > input.end || !finite(Date.parse(input.firstSeenAt)) || !input.availableAt || !finite(Date.parse(input.availableAt))) throw Error('Invalid financial observation');
  const observation = { quality:'reported', ...input };
  observation.id = contentHash(Object.fromEntries(Object.entries(observation).filter(([k])=>!['firstSeenAt','rawHash','id'].includes(k))));
  return observation;
}

export function normalizeCompanyFacts(raw, { symbol, firstSeenAt, rawHash, currency = symbol === 'TSM' ? 'TWD' : 'USD' }) {
  if (!raw?.cik || !raw.facts) throw Error('SEC company facts missing issuer identity');
  const issuerId = String(raw.cik).padStart(10,'0'), facts = raw.facts['us-gaap'] || raw.facts['ifrs-full'];
  if (!facts) throw Error('No supported financial taxonomy');
  const basis = raw.facts['us-gaap'] ? 'US GAAP' : 'IFRS';
  const floor = Number(firstSeenAt.slice(0,4))-8;
  const observations = [], quarantined = [];
  for (const [metric,tags] of Object.entries(METRICS)) for (const [priority,tag] of tags.entries()) {
    const unit = metric === 'eps' ? currency+'/shares' : metric === 'dilutedShares' ? 'shares' : currency;
    for (const row of facts[tag]?.units?.[unit] || []) {
      if (!date(row.start) || !date(row.end) || Number(row.end.slice(0,4)) < floor || !['10-Q','10-K','10-Q/A','10-K/A','20-F','20-F/A','6-K'].includes(row.form)) continue;
      const duration = days(row.start,row.end);
      if (!finite(row.val) || !date(row.filed) || !row.accn || duration<65 || duration>380) { quarantined.push({metric,tag,reason:'Invalid duration, value or filing provenance'}); continue; }
      observations.push(makeObservation({ issuerId,symbol,metric,start:row.start,end:row.end,value:row.val,unit,currency:metric==='dilutedShares'?null:currency,basis,tag,priority,accession:row.accn,filed:row.filed,form:row.form,
        availableAt:conservativePublication(row.filed),publicationPrecision:'filing date; conservative next-day cutoff',firstSeenAt,rawHash,
        sourceUrl:`https://www.sec.gov/Archives/edgar/data/${Number(raw.cik)}/${row.accn.replaceAll('-','')}/`, }));
    }
  }
  return {issuerId,observations,quarantined};
}

export function mergeObservations(prior = [], incoming = []) {
  const all = new Map(prior.map(o=>[o.id,o]));
  for (const row of incoming) { const old=all.get(row.id); if (old && contentHash({...old,firstSeenAt:null,rawHash:null})!==contentHash({...row,firstSeenAt:null,rawHash:null})) throw Error('Observation hash collision'); if (!old) all.set(row.id,row); }
  return [...all.values()];
}

export function quarterlyFacts(observations, cutoffAt, { mode='operational', earliest=false } = {}) {
  const cutoff=Date.parse(cutoffAt);
  if (!finite(cutoff)) throw Error('Invalid forecast cutoff');
  const selected = new Map();
  for (const o of observations || []) {
    if (Date.parse(o.availableAt)>cutoff || (mode==='operational' && Date.parse(o.firstSeenAt)>cutoff) || Date.parse(o.end)>cutoff) continue;
    const key=[o.metric,o.start,o.end,o.unit,o.basis].join('|'), old=selected.get(key);
    if (!old || (earliest ? o.availableAt<old.availableAt : o.availableAt>old.availableAt) || (o.availableAt===old.availableAt && o.priority<old.priority)) selected.set(key,o);
  }
  const values=[...selected.values()], quarters=values.filter(o=>days(o.start,o.end)>=65 && days(o.start,o.end)<=105);
  // Only additive financial amounts may be differenced. Never EPS or shares.
  for (const annual of values.filter(o=>days(o.start,o.end)>=350 && !['eps','dilutedShares'].includes(o.metric))) {
    const candidates=values.filter(o=>o.metric===annual.metric && o.unit===annual.unit && o.basis===annual.basis && o.tag===annual.tag && o.start===annual.start && days(o.start,o.end)>=250 && days(o.start,o.end)<=290 && days(o.end,annual.end)>=65 && days(o.end,annual.end)<=106 && !o.form.endsWith('/A') && !annual.form.endsWith('/A'));
    const ytd=candidates.sort((a,b)=>b.end.localeCompare(a.end))[0];
    if (!ytd || quarters.some(o=>o.metric===annual.metric && o.end===annual.end && o.unit===annual.unit && o.basis===annual.basis)) continue;
    quarters.push({...annual,id:contentHash([annual.id,ytd.id,'difference']),start:addDay(ytd.end,1),value:annual.value-ytd.value,quality:'derived FY minus nine-month YTD',derivationIds:[annual.id,ytd.id],firstSeenAt:[annual.firstSeenAt,ytd.firstSeenAt].sort().at(-1),availableAt:[annual.availableAt,ytd.availableAt].sort().at(-1)});
  }
  const groups = new Map();
  for (const o of quarters) {
    const key=[o.start,o.end,o.basis,o.metric==='dilutedShares'?'shares':o.currency].join('|');
    const q=groups.get(key)||{start:o.start,end:o.end,currency:o.currency,basis:o.basis,metrics:{}};
    const old=q.metrics[o.metric];
    if (!old || (earliest ? o.availableAt<old.availableAt : o.availableAt>old.availableAt) || (o.availableAt===old.availableAt && o.priority<old.priority)) q.metrics[o.metric]=o;
    groups.set(key,q);
  }
  const byEnd=new Map();
  for(const q of [...groups.values()].filter(q=>q.metrics.revenue?.value>0)){
    const shares=groups.get([q.start,q.end,q.basis,'shares'].join('|'))?.metrics.dilutedShares;
    if(shares)q.metrics.dilutedShares=shares;
    const old=byEnd.get(q.end),r=q.metrics.revenue,p=old?.metrics.revenue;
    if(!old||(earliest?r.availableAt<p.availableAt:r.availableAt>p.availableAt)||(r.availableAt===p.availableAt&&r.priority<p.priority))byEnd.set(q.end,q);
  }
  return [...byEnd.values()].sort((a,b)=>a.end.localeCompare(b.end));
}

function targetAfter(latest) {
  const end=new Date(latest.end+'T00:00:00Z');
  const calendarEnd=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
  const nextEnd=end.getUTCDate()===calendarEnd ? isoDay(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+4,0)) : addDay(latest.end,91);
  return {start:addDay(latest.end,1),end:nextEnd,label:'Quarter ending '+nextEnd,calendar:end.getUTCDate()===calendarEnd?'calendar quarter':'52/53-week fiscal calendar',estimated:true};
}
const ratio = (q,a,b) => finite(q.metrics[a]?.value) && finite(q.metrics[b]?.value) && q.metrics[b].value!==0 ? q.metrics[a].value/q.metrics[b].value : null;
function seasonalQuarter(quarters,targetEnd) { return [...quarters].reverse().find(q=>Math.abs(days(q.end,targetEnd)-366)<=16) || null; }

export function knownReportedPeriod(fundamentals={}) {
  const ends=(fundamentals.revenueHistory||[]).filter(r=>date(r.date)&&finite(r.value)).map(r=>r.date);
  if(date(fundamentals.lastQuarter?.date)&&finite(fundamentals.lastQuarter.epsActual))ends.push(fundamentals.lastQuarter.date);
  return ends.sort().at(-1)||null;
}

export function forecastQuarter({symbol,observations,cutoffAt,mode='operational',liveEvaluations=[],horizon='initial',reportedPeriodEnd=null}) {
  const allQuarters=quarterlyFacts(observations,cutoffAt,{mode}),latest=allQuarters.at(-1);
  if (!latest) return {symbol,status:'unavailable',reason:'No comparable quarterly reported revenue is available.',cutoffAt};
  const quarters=allQuarters.filter(q=>q.currency===latest.currency&&q.basis===latest.basis);
  const target=targetAfter(latest), seasonalMatch=seasonalQuarter(quarters,target.end), seasonal=seasonalMatch||latest;
  if(reportedPeriodEnd&&Date.parse(reportedPeriodEnd)>=Date.parse(target.end)-14*DAY)return {symbol,status:'awaiting-source',reason:'A results release is already known for this period. Forecasting is withheld until the corresponding financial statements are normalized.',cutoffAt,target,latestEnd:latest.end};
  const recent=quarters.slice(-4), growths=[];
  for(const q of recent) {const p=seasonalQuarter(quarters,q.end); if(p && p.metrics.revenue.value>0) growths.push(q.metrics.revenue.value/p.metrics.revenue.value-1);}
  const growth=seasonalMatch?median(growths):null, rawRevenue=seasonalMatch?seasonal.metrics.revenue.value*(1+(growth??0)):latest.metrics.revenue.value;
  const comparableErrors=liveEvaluations.filter(e=>e.symbol===symbol && e.model===FORECAST_MODEL && e.metric==='revenue' && e.kind==='live' && e.actualAvailableAt<=cutoffAt && (e.firstSeenAt||e.actualAvailableAt)<=cutoffAt && finite(e.error) && e.forecast>0);
  const uniqueErrors=[...new Map(comparableErrors.sort((a,b)=>a.cutoffAt.localeCompare(b.cutoffAt)).map(e=>[e.targetEnd,e])).values()].sort((a,b)=>a.targetEnd.localeCompare(b.targetEnd)).slice(-8);
  const correction=uniqueErrors.length ? clamp(mean(uniqueErrors.map(e=>(e.baseError??e.error)/(e.baseForecast??e.forecast)))*uniqueErrors.length/(uniqueErrors.length+8),-.1,.1) : 0;
  const candidate=rawRevenue===null?null:rawRevenue*(1+correction);
  const matched=uniqueErrors.filter(e=>finite(e.candidateAbsoluteError)&&finite(e.baseAbsoluteError)&&finite(e.naiveAbsoluteError));
  const epsChecks=[...new Map(liveEvaluations.filter(e=>e.symbol===symbol&&e.model===FORECAST_MODEL&&e.kind==='live'&&e.metric==='eps'&&e.actualAvailableAt<=cutoffAt&&(e.firstSeenAt||e.actualAvailableAt)<=cutoffAt&&matched.some(r=>r.targetEnd===e.targetEnd)&&finite(e.candidateAbsoluteError)&&finite(e.baseAbsoluteError)).sort((a,b)=>a.cutoffAt.localeCompare(b.cutoffAt)).map(e=>[e.targetEnd,e])).values()].sort((a,b)=>a.targetEnd.localeCompare(b.targetEnd)).slice(-8);
  const revenueGate=matched.length>=8 && mean(matched.map(e=>e.candidateAbsoluteError))<.9*Math.min(mean(matched.map(e=>e.baseAbsoluteError)),mean(matched.map(e=>e.naiveAbsoluteError)));
  const shareRows=recent.filter(q=>q.metrics.dilutedShares?.value>0),shareGrowth=shareRows.slice(1).map((q,i)=>q.metrics.dilutedShares.value/shareRows[i].metrics.dilutedShares.value-1);
  const assumedShares=shareRows.length?shareRows.at(-1).metrics.dilutedShares.value*(1+(median(shareGrowth)||0)):null;
  const assumptions = {growthRate:growth,growthSample:seasonalMatch?growths.length:0,growthRule:seasonalMatch?(growth===null?'Same fiscal quarter prior-year baseline; trailing growth unavailable':'Median of up to four available same-fiscal-quarter year-over-year revenue growth rates'):'Latest reported quarter run-rate; comparable seasonal history is unavailable',grossMargin:median(recent.map(q=>ratio(q,'grossProfit','revenue')).filter(finite)),operatingMargin:median(recent.map(q=>ratio(q,'operatingIncome','revenue')).filter(finite)),
    nonoperating:median(recent.filter(q=>finite(q.metrics.pretaxIncome?.value)&&finite(q.metrics.operatingIncome?.value)).map(q=>q.metrics.pretaxIncome.value-q.metrics.operatingIncome.value)),
    taxRate:median(recent.filter(q=>q.metrics.pretaxIncome?.value>0).map(q=>ratio(q,'taxes','pretaxIncome')).filter(n=>finite(n)&&n>=0&&n<=1)),dilutedShares:assumedShares,sharesRule:'Last reported quarterly diluted shares extrapolated by median recent sequential change; not annual minus YTD',sharesSourceEnd:shareRows.at(-1)?.end||null,
    commonIncomeAdjustment:median(recent.filter(q=>['pretaxIncome','taxes','netIncome'].every(k=>finite(q.metrics[k]?.value))).map(q=>q.metrics.netIncome.value-(q.metrics.pretaxIncome.value-q.metrics.taxes.value)))};
  // Reconcile income available to common against pretax-tax in reported history.
  // A failed or missing bridge cannot silently invent common-income adjustments.
  const bridge=recent.filter(q=>['pretaxIncome','taxes','netIncome'].every(k=>finite(q.metrics[k]?.value)));
  const epsBridge=bridge.filter(q=>q.metrics.dilutedShares?.value>0&&finite(q.metrics.eps?.value));
  const bridgeSimple=bridge.length>=2 && bridge.every(q=>Math.abs(q.metrics.pretaxIncome.value-q.metrics.taxes.value-q.metrics.netIncome.value)<=Math.max(1e6,Math.abs(q.metrics.netIncome.value)*.2)) && epsBridge.length>=2 && epsBridge.every(q=>Math.abs(q.metrics.netIncome.value/q.metrics.dilutedShares.value-q.metrics.eps.value)<=.015);
  const shareHistory=recent.map(q=>q.metrics.dilutedShares?.value).filter(n=>finite(n)&&n>0);
  const shareStable=shareHistory.length>=2 && Math.max(...shareHistory)/Math.min(...shareHistory)<1.5;
  const needsEpsGate=bridgeSimple&&shareStable;
  const promoted=revenueGate&&(!needsEpsGate&&!epsChecks.length||(epsChecks.length>=4&&mean(epsChecks.map(e=>e.candidateAbsoluteError))<=mean(epsChecks.map(e=>e.baseAbsoluteError))));
  const revenue=promoted?candidate:rawRevenue;
  const grossProfit=finite(revenue)&&finite(assumptions.grossMargin)?revenue*assumptions.grossMargin:null;
  const operatingIncome=finite(revenue)&&finite(assumptions.operatingMargin)?revenue*assumptions.operatingMargin:null;
  const pretaxIncome=finite(operatingIncome)&&finite(assumptions.nonoperating)?operatingIncome+assumptions.nonoperating:null;
  const taxes=pretaxIncome>0&&finite(assumptions.taxRate)?pretaxIncome*assumptions.taxRate:null;
  const netIncome=finite(pretaxIncome)&&finite(taxes)&&finite(assumptions.commonIncomeAdjustment)?pretaxIncome-taxes+assumptions.commonIncomeAdjustment:null;
  const eps=bridgeSimple&&shareStable&&netIncome>0&&assumptions.dilutedShares>0?netIncome/assumptions.dilutedShares:null;
  const warnings=[];
  if(!seasonalMatch)warnings.push('Short or changed reporting history: using a latest-quarter run-rate instead of a seasonal growth model.');
  if(assumptions.commonIncomeAdjustment)warnings.push('Common-income adjustment uses the median historical reconciliation residual. Its economic cause is unresolved; this is an estimated assumption.');
  if (!finite(eps)) warnings.push('EPS bridge unavailable: missing/reconciling income, tax or diluted shares, a loss, or a material share-basis change.');
  if (Date.parse(cutoffAt)-Date.parse(latest.end)>200*DAY) warnings.push('Reported financial coverage is stale; the forecast is withheld.');
  const projectEps=rev=>{const pretax=finite(assumptions.operatingMargin)&&finite(assumptions.nonoperating)?rev*assumptions.operatingMargin+assumptions.nonoperating:null;const net=pretax>0&&finite(assumptions.taxRate)&&finite(assumptions.commonIncomeAdjustment)?pretax*(1-assumptions.taxRate)+assumptions.commonIncomeAdjustment:null;return bridgeSimple&&shareStable&&net>0&&assumptions.dilutedShares>0?net/assumptions.dilutedShares:null;};
  const sourceIds=[...new Set([...recent,seasonal].flatMap(q=>Object.values(q.metrics).flatMap(o=>o.derivationIds||[o.id])))].sort();
  const manifest={symbol,target,sourceIds,modelVersion:FORECAST_MODEL,assumptions,correction,horizon,mode,trainingEvaluationIds:uniqueErrors.map(e=>e.id).filter(Boolean).sort(),promotionEvaluationIds:[...matched,...epsChecks].map(e=>e.id).filter(Boolean).sort()};
  const stale=warnings.some(w=>w.includes('stale'));
  const inputKey=contentHash({...manifest,promoted});
  return {id:contentHash({inputKey,cutoffAt}),inputKey,symbol,modelVersion:FORECAST_MODEL,status:stale?'stale':finite(revenue)&&finite(eps)?'ready':'partial',cutoffAt,target,latestEnd:latest.end,currency:seasonal.metrics.revenue.currency,basis:seasonal.metrics.revenue.basis,
    sourceIds,inputManifestHash:contentHash(sourceIds),configHash:contentHash({model:FORECAST_MODEL,growth:'median-last4-yoy',margin:'median-last4',maxBias:.1,minPromotion:8}),horizon,
    outputs:stale?{revenue:null,grossProfit:null,operatingIncome:null,pretaxIncome:null,taxes:null,netIncome:null,eps:null}:{revenue,grossProfit,operatingIncome,pretaxIncome,taxes,netIncome:bridgeSimple?netIncome:null,eps},
    baseline:{revenue:seasonal.metrics.revenue.value,eps:seasonal.metrics.eps?.value??null},
    comparison:{baseRevenue:rawRevenue,baseEps:projectEps(rawRevenue)},
    candidate:{revenue:candidate,eps:projectEps(candidate),biasFraction:correction,sample:uniqueErrors.length,active:promoted,status:promoted?'Forward comparison gate passed':'Shadow only; forward comparison gate not met',promotionRule:'At least 8 unique forward revenue quarters, candidate MAE at least 10% below both base and naive on matched cases. When an EPS bridge is supported or EPS checks exist, require at least 4 matching-quarter EPS checks and no worse EPS MAE.'},
    assumptions,warnings,sourcePeriod:{start:seasonal.start,end:seasonal.end},uncertainty:'Uncalibrated point forecast; scenario ranges are not probability intervals',manifest};
}

export function evaluateRuns(runs, issuerObservations, cutoffAt) {
  const results=[];
  for (const run of runs || []) {
    const qs=quarterlyFacts(issuerObservations[run.symbol]||[],cutoffAt,{earliest:true});
    const actual=qs.find(q=>Math.abs(days(run.target.end,q.end)-1)<=10 && Math.abs(days(run.target.start,q.start)-1)<=10);
    if (!actual) continue;
    for (const metric of ['revenue','eps']) {
      const fact=actual.metrics[metric], forecast=run.outputs[metric], naive=run.baseline[metric];
      if (!fact || !finite(forecast) || fact.firstSeenAt<=run.cutoffAt || fact.availableAt<=run.cutoffAt || fact.currency!==run.currency || fact.basis!==run.basis) continue;
      if(metric==='eps') {const a=actual.metrics.dilutedShares?.value,b=run.assumptions.dilutedShares;if(!finite(a)||!finite(b)||a/b>1.5||a/b<2/3)continue;}
      const baseForecast=metric==='revenue'?run.comparison?.baseRevenue:run.comparison?.baseEps,candidateForecast=run.candidate?.[metric];
      results.push({id:contentHash([run.id,metric,fact.id]),runId:run.id,symbol:run.symbol,model:run.modelVersion,kind:'live',targetEnd:run.target.end,actualEnd:actual.end,cutoffAt:run.cutoffAt,actualAvailableAt:fact.availableAt,firstSeenAt:fact.firstSeenAt,actualId:fact.id,metric,currency:run.currency,basis:run.basis,forecast,actual:fact.value,error:fact.value-forecast,absoluteError:Math.abs(fact.value-forecast),baseForecast:finite(baseForecast)?baseForecast:null,baseError:finite(baseForecast)?fact.value-baseForecast:null,baseAbsoluteError:finite(baseForecast)?Math.abs(fact.value-baseForecast):null,candidateAbsoluteError:finite(candidateForecast)?Math.abs(fact.value-candidateForecast):null,naive:finite(naive)?naive:null,naiveAbsoluteError:finite(naive)?Math.abs(fact.value-naive):null,sourceUrl:fact.sourceUrl});
    }
  }
  return results;
}

export function scoreRows(rows) {
  const unique=[...new Map([...rows].sort((a,b)=>a.cutoffAt.localeCompare(b.cutoffAt)).map(r=>[r.symbol+'|'+r.targetEnd+'|'+r.metric,r])).values()];
  const revenue=unique.filter(r=>r.metric==='revenue'),eps=unique.filter(r=>r.metric==='eps');
  const stats=xs=>{const matched=xs.filter(r=>finite(r.naiveAbsoluteError));return {n:xs.length,mae:mean(xs.map(r=>r.absoluteError)),bias:mean(xs.map(r=>r.error)),matchedN:matched.length,matchedModelMae:mean(matched.map(r=>r.absoluteError)),naiveMae:mean(matched.map(r=>r.naiveAbsoluteError))};};
  const denom=revenue.reduce((s,r)=>s+(r.actual>0?r.actual:0),0);
  return {revenue:{...stats(revenue),wape:denom?revenue.filter(r=>r.actual>0).reduce((s,r)=>s+r.absoluteError,0)/denom:null},eps:stats(eps),counting:'One latest forecast per issuer, target quarter and metric. Metrics and currencies are kept separate.'};
}

export function reconstructedBacktest(symbol,observations,asOf) {
  const actuals=quarterlyFacts(observations,asOf,{mode:'reconstructed',earliest:true}).slice(-12),rows=[];
  for(const actual of actuals) for(const horizonDays of [30,14,7,1]){
    const cutoffAt=new Date(Date.parse(actual.metrics.revenue.availableAt)-horizonDays*DAY).toISOString();
    const run=forecastQuarter({symbol,observations,cutoffAt,mode:'reconstructed',horizon:'Filing-'+horizonDays});
    if(!run.target||Math.abs(days(run.target.end,actual.end)-1)>10||!finite(run.outputs?.revenue))continue;
    for(const metric of ['revenue','eps']){
      const fact=actual.metrics[metric],forecast=run.outputs[metric],naive=run.baseline[metric];
      if(!fact||!finite(forecast)||fact.currency!==run.currency||fact.basis!==run.basis)continue;
      if(metric==='eps'){const shares=actual.metrics.dilutedShares?.value,base=run.assumptions.dilutedShares;if(!finite(shares)||!finite(base)||shares/base>1.5||shares/base<2/3)continue;}
      rows.push({symbol,targetEnd:actual.end,cutoffAt,horizonDays,metric,currency:run.currency,basis:run.basis,forecast,actual:fact.value,error:fact.value-forecast,absoluteError:Math.abs(fact.value-forecast),naive:finite(naive)?naive:null,naiveAbsoluteError:finite(naive)?Math.abs(fact.value-naive):null});
    }
  }
  return {kind:'reconstructed',label:'Retrospective filing-date checks; not live prediction history',limits:'Current source facts joined by documented filing date with a conservative next-day cutoff. Original ingestion and intraday release availability are not reconstructed. Cutoffs are relative to the observed filing, not a historically known earnings schedule.',horizons:[30,14,7,1].map(horizonDays=>({horizonDays,...scoreRows(rows.filter(r=>r.horizonDays===horizonDays))})),rows};
}

export function selectCohort(chains, universe, sectors, asOf) {
  const excludedFunds=universe.filter(s=>sectors[s]==='ETF'||chains[s]?.fundamentals?.quoteType==='ETF');
  const eligible=universe.filter(s=>!excludedFunds.includes(s)), missing=eligible.filter(s=>!(finite(chains[s]?.fundamentals?.marketCap)&&chains[s].fundamentals.marketCap>0));
  const ranked=eligible.filter(s=>!missing.includes(s)).map(symbol=>({symbol,name:chains[symbol].fundamentals.name||symbol,marketCap:chains[symbol].fundamentals.marketCap,quoteAsOf:chains[symbol].quoteAsOf||null})).sort((a,b)=>b.marketCap-a.marketCap||a.symbol.localeCompare(b.symbol));
  return {selectedAt:asOf,rankingAsOf:ranked.map(r=>r.quoteAsOf).filter(Boolean).sort()[0]||asOf,selection:'Largest reported USD market caps among the non-ETF site universe; launch cohort remains fixed',eligibleCount:eligible.length,rankedCount:ranked.length,excludedFunds,missing,complete:missing.length===0,companies:ranked.slice(0,10).map((r,i)=>({...r,rank:i+1}))};
}

export function businessMix(fundamentals) {
  const s=fundamentals?.segments;
  if(!s)return {product:null,geographic:null,note:'Reported revenue breakdown unavailable. No split has been estimated.'};
  const axis=(rows,period)=>Array.isArray(rows)&&rows.length&&period?.currentPeriod?.endDate?{rows:rows.filter(r=>r&&typeof r.name==='string'&&finite(r.value)&&r.value>=0).map(r=>({name:r.name,value:r.value,previousValue:finite(r.previousValue)?r.previousValue:null})),period,currency:s.currency||null,sourceUrl:s.accession?`https://www.sec.gov/Archives/edgar/data/${Number(fundamentals.cik||0)}/${s.accession.replaceAll('-','')}/`:null}:null;
  return {product:axis(s.product,s.productPeriod),geographic:axis(s.geographic,s.geographicPeriod),filed:s.filingDate||null,accession:s.accession||null,note:'Latest disclosed mix is descriptive context. Product and geography do not form an inferred cross-table or numerical driver adjustment.'};
}

export function reconcileBusinessMix(mix,observations,cutoffAt,currency){
  const quarters=quarterlyFacts(observations,cutoffAt);
  const axis=a=>{
    if(!a)return null;
    const end=a.period?.currentPeriod?.endDate,type=a.period?.periodType;
    const annual=observations.filter(o=>o.metric==='revenue'&&o.end===end&&o.currency===currency&&days(o.start,o.end)>=350&&days(o.start,o.end)<=380&&o.availableAt<=cutoffAt&&o.firstSeenAt<=cutoffAt).sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||a.priority-b.priority)[0];
    const fact=type==='annual'?annual:type==='quarter'?quarters.find(q=>q.end===end)?.metrics.revenue:null;
    const total=a.rows.reduce((v,r)=>v+r.value,0),matched=a.currency===currency&&fact&&Math.abs(total-fact.value)<=Math.max(1,Math.abs(fact.value)*.01);
    return {...a,reconciliation:{status:matched?'matched':'unverified',reportedTotal:fact?.value??null,disclosedTotal:total,sourcePeriodEnd:end,periodType:type}};
  };
  return {...mix,product:axis(mix.product),geographic:axis(mix.geographic)};
}

export function buildForecastPayload({state,chains={},builtAtIso,collection={}}) {
  return {version:FORECAST_VERSION,builtAtIso,cohort:state.cohort,context:state.context||[],cost:{newAiCalls:0,newSubscriptions:0,...collection},companies:(state.cohort?.companies||[]).map(c=>{
    const obs=state.observations[c.symbol]||[],f=chains[c.symbol]?.fundamentals||{};
    const run=[...(state.runs||[])].reverse().find(r=>r.symbol===c.symbol&&r.id===state.current[c.symbol]);
    const latest=forecastQuarter({symbol:c.symbol,observations:obs,cutoffAt:builtAtIso,liveEvaluations:state.evaluations,reportedPeriodEnd:knownReportedPeriod(f)});
    const forecast=run||latest, score=scoreRows((state.evaluations||[]).filter(e=>e.symbol===c.symbol));
    const warnings=[...(forecast.warnings||[])];
    if(forecast.target && date(f.lastQuarter?.date) && Date.parse(f.lastQuarter.date)>Date.parse(forecast.target.end)+14*DAY)warnings.push('A later vendor reporting period exists; source normalization is behind and this forecast must be reviewed.');
    const cutoffAge=(Date.parse(builtAtIso)-Date.parse(forecast.cutoffAt))/DAY;
    if(cutoffAge>45)warnings.push('This frozen forecast is more than 45 days old; inspect the cutoff before use.');
    return {...c,profile:companyProfile(c.symbol),forecast:{...forecast,warnings,manifest:undefined,sourceIds:undefined},mix:reconcileBusinessMix(state.mix?.[c.symbol]||businessMix(f),obs,builtAtIso,forecast.currency),score,observations:obs.length,
      sources:[...new Map(quarterlyFacts(obs,builtAtIso).slice(-5).flatMap(q=>Object.values(q.metrics)).map(o=>[o.id,{metric:o.metric,periodEnd:o.end,value:o.value,unit:o.unit,basis:o.basis,quality:o.quality,filed:o.filed,firstSeenAt:o.firstSeenAt,url:o.sourceUrl}])).values()],
      evaluations:(state.evaluations||[]).filter(e=>e.symbol===c.symbol).slice(-24),historical:state.reconstructed?.[c.symbol]||null,collectionError:state.sourceStatus?.[c.symbol]?.error||null};
  }),methodology:['Revenue uses the same fiscal quarter last year and median recent year-over-year growth. Earnings use recent margins, nonoperating income, tax and diluted shares only where the reported bridge reconciles.',
    'Company and external-factor research is displayed separately from numerical effects. No unsupported causal coefficients, consensus estimates or confidence levels are invented.',
    'Source publication dates use a conservative next-day eligibility boundary. Operational forecasts additionally require first ingestion before the cutoff.',
    'Actuals resolve from supported SEC financial disclosures; filing collection can lag the first earnings press release. Later revisions never rewrite a frozen forecast.',
    'The bias-corrected revenue candidate remains in shadow until its frozen forward forecasts pass the documented matched-case promotion gate. The gate is an engineering policy, not proof of durable predictive skill.',
    'Scenario overrides are temporary browser calculations. They never rewrite the frozen forecast or its actual-versus-forecast record.']};
}

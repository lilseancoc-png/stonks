// Prospective paired policy measurement, isolated from the trading ledger.
// All decisions and contracts are frozen before outcomes become available.
import { bsPrice, expiryCloseEpochSec } from './greeks.mjs';
import { positionLegs } from './track-record-fills.mjs';

export const MARKET_STUDY_VERSION = 1;
export const MARKET_STUDY_FILE = 'top-picks-market-study.json';
const num = v => v == null || v === '' || typeof v==='boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
const round = v => v == null ? null : Math.round(v*100)/100;
const dateOf = v => typeof v === 'number' ? new Date(v<1e12?v*1000:v).toISOString().slice(0,10) : String(v||'').slice(0,10);
function barsOf(data, now) {
  const bars=Array.isArray(data?._bars)?data._bars:(data?.priceSeries?.c||[]).map((c,i)=>({c,t:data.priceSeries.t?.[i]}));
  return [...new Map(bars.map(b=>({date:dateOf(b.t||b.date),close:num(b.c),high:num(b.h),low:num(b.l)}))
    .filter(b=>/^\d{4}-\d\d-\d\d$/.test(b.date)&&b.date<dateOf(now)&&b.close>0).map(b=>[b.date,b])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function optionAt(row, spot, date) {
  const legs=positionLegs(row.contract,row.side);
  if (!legs?.length || legs.some(l=>!(l.iv>0)||!(l.strike>0)||!l.expiry)) return null;
  const cost=num(row.contract.netDebit)??num(row.contract.netCredit)??num(row.contract.mid);
  const credit=row.contract.structure==='credit_vertical';
  if (!(cost>0)) return null;
  let value=0;
  const markSec=expiryCloseEpochSec(Date.parse(date+'T00:00:00Z')/1000);
  for (const l of legs) {
    const expirySec=expiryCloseEpochSec(l.expiry);
    // A later stock close cannot stand in for the contract's expiry close.
    if(!Number.isFinite(markSec)||!Number.isFinite(expirySec)||markSec>expirySec)return null;
    const t=Math.max(0,(expirySec-markSec)/(365*86400));
    const price=t===0?(l.type==='put'?Math.max(0,l.strike-spot):Math.max(0,spot-l.strike)):bsPrice(l.type,spot,l.strike,t,l.iv,row.rate??.045);
    if(!Number.isFinite(price))return null;
    value+=l.qty*price;
  }
  const vertical=['debit_vertical','credit_vertical'].includes(row.contract.structure);
  if(vertical&&legs.length===2){
    const width=Math.abs(legs[0].strike-legs[1].strike),magnitude=credit?-value:value;
    if(!(width>0)||magnitude<-.000001||magnitude>width+.000001)return null;
  }
  const risk=num(row.contract.maxLoss)??(credit?null:cost);
  return risk>0?round((value-(credit?-cost:cost))/risk*100):null;
}
export function advanceMarketStudy(prior, { decisions = [], builtAtIso, chains = {}, publication = false, assessment = null } = {}) {
  const rows=(prior?.rows||[]).map(r=>({...r,outcomes:{...(r.outcomes||{})}}));
  const ids=new Set(rows.map(r=>r.id));
  const runs=(prior?.runs||[]).slice();
  const histories=new Map();
  const history=symbol=>{if(!histories.has(symbol))histories.set(symbol,barsOf(chains[symbol],builtAtIso));return histories.get(symbol);};
  let paused=prior?.paused||false;
  if(publication&&!runs.some(r=>r.at===builtAtIso)){
    const candidates=[...new Map(decisions.filter(r=>r?.symbol&&['call','put'].includes(r.side)).map(r=>[r.symbol+':'+r.side,r])).values()];
    const valid=candidates.filter(r=>num(r.spot)>0);
    const pending=valid.filter(r=>!ids.has(`${builtAtIso}:${r.symbol}:${r.side}`));
    const fits=rows.length+pending.length<=20000;
    if(!fits)paused=true;
    // Capture the whole cohort or none of it. A storage limit must not favor
    // the first few rank-ordered names or imply zero eligibility thereafter.
    if(fits)for(const row of pending){
      const basis=history(row.symbol).filter(b=>b.date<dateOf(builtAtIso)).at(-1)||null;
      rows.push({...row,id:`${builtAtIso}:${row.symbol}:${row.side}`,decisionAt:builtAtIso,priceBasis:basis?{date:basis.date,close:basis.close}:null,outcomes:{}});
    }
    runs.push({at:builtAtIso,candidates:candidates.length,recorded:fits?valid.length:0,collectionComplete:fits&&valid.length===candidates.length,
      unavailableCandidates:candidates.length-valid.length,selected:candidates.filter(r=>r.selected).length,marketUnavailable:assessment?.ready===false,
      marketState:assessment?.state||candidates[0]?.marketState||'unavailable',assessment});
  }
  const marketSessions=history('SPY');
  for (const row of rows) {
    const bars=history(row.symbol).filter(b=>b.date>dateOf(row.decisionAt));
    const sessionsAfter=marketSessions.filter(b=>b.date>dateOf(row.decisionAt));
    for (const sessions of [5,10,20]) {
      if (row.outcomes[sessions]||bars.length<sessions) continue;
      const end=bars[sessions-1];
      // When the market calendar is available, a missing stock session must
      // not shift a nominal five-session outcome to a later winning close.
      if(marketSessions.length&&(sessionsAfter.length<sessions||sessionsAfter[sessions-1].date!==end.date||
        sessionsAfter.slice(0,sessions).some((s,i)=>s.date!==bars[i].date)))continue;
      // Crossing a split without a point-in-time adjustment must never look
      // like an avoided loss or a missed winner. Mark it unscorable.
      const path=[row.spot,...bars.slice(0,sessions).map(b=>b.close)];
      const currentBasis=row.priceBasis&&history(row.symbol).find(b=>b.date===row.priceBasis.date);
      if(currentBasis&&Math.abs(currentBasis.close/row.priceBasis.close-1)>.05){row.outcomes[sessions]={asOf:end.date,unavailable:'Historical price basis changed; corporate action or revision requires review'};continue;}
      const split=path.some((v,i)=>i>0&&(v/path[i-1]>1.8||v/path[i-1]<.55));
      if (split) {row.outcomes[sessions]={asOf:end.date,unavailable:'Large discontinuity; corporate action requires review'};continue;}
      const sign=row.side==='put'?-1:1;
      const returns=bars.slice(0,sessions).map(b=>sign*(b.close/row.spot-1)*100);
      row.outcomes[sessions]={asOf:end.date,directionalReturnPct:round(returns.at(-1)),
        adverseClosePct:round(Math.min(0,...returns)),favorableClosePct:round(Math.max(0,...returns)),
        modeledOptionRiskReturnPct:optionAt(row,end.close,end.date)};
    }
  }
  const study={version:MARKET_STUDY_VERSION,builtAtIso,startedAt:prior?.startedAt||builtAtIso,paused,rows,runs,collectionGaps:prior?.collectionGaps||0,
    method:'Prospective decision snapshots. Fixed 5/10/20 subsequent confirmed sessions. Option scenarios use frozen contracts and entry IV, per maximum loss; no fills, fees or intraday exits. Repeated names and decisions are correlated.',
    historicalCoverage:'No historical market state or AI verdict is inferred from current data.'};
  return {...study,reports:Object.fromEntries([5,10,20].map(h=>[h,summarizeMarketStudy(study,h)]))};
}
// The normal Track Record response carries compact reports. Frozen candidates
// and source assessments live in their own private bake-owned research file.
export function marketStudyView(study) {
  if(!study)return null;
  const {version,builtAtIso,startedAt,paused,method,historicalCoverage,reports,collectionGaps}=study;
  return {version,builtAtIso,startedAt,paused,method,historicalCoverage,reports,collectionGaps:collectionGaps||0,artifact:MARKET_STUDY_FILE};
}
export function unavailableMarketStudyView(prior,{builtAtIso,publication=false}={}) {
  const missed=publication&&prior?.lastMissedAt!==builtAtIso;
  return {...prior,version:MARKET_STUDY_VERSION,artifact:MARKET_STUDY_FILE,unavailable:true,paused:true,checkedAt:builtAtIso,
    collectionGaps:(prior?.collectionGaps||0)+(missed?1:0),lastMissedAt:missed?builtAtIso:prior?.lastMissedAt,
    issue:'Measurement history is unavailable. Collection is paused; saved evidence and previous reports are preserved.'};
}
export function summarizeMarketStudy(study, horizon = 10) {
  const rows=study?.rows||[];
  const mature=rows.filter(r=>num(r.outcomes?.[horizon]?.directionalReturnPct)!=null);
  const snapshots=new Map();
  for(const r of rows){const a=snapshots.get(r.decisionAt)||[];a.push(r);snapshots.set(r.decisionAt,a);}
  const runs=study?.runs||[];
  const complete=new Set(runs.filter(r=>r.collectionComplete!==false&&(r.candidates??0)<=(snapshots.get(r.at)?.length||0)).map(r=>r.at));
  const comparable=r=>r.comparable!==false&&(!runs.length||complete.has(r.decisionAt));
  const eligible=rows.filter(comparable);
  const paired=mature.filter(comparable);
  const dates=[...new Set(rows.map(r=>dateOf(r.decisionAt)))].sort();
  const split=dates.length>=10?dates[Math.floor(dates.length*.7)]:null;
  const periods={all:paired,development:split?paired.filter(r=>dateOf(r.decisionAt)<split):[],holdout:split?paired.filter(r=>dateOf(r.decisionAt)>=split):[]};
  const policies=['legacy','labels','combined'].map(key=>{
    const accepted=paired.filter(r=>r.policies?.[key]?.eligible===true);
    const allAccepted=eligible.filter(r=>r.policies?.[key]?.eligible===true);
    const returns=accepted.map(r=>r.outcomes[horizon].directionalReturnPct);
    const options=accepted.map(r=>r.outcomes[horizon].modeledOptionRiskReturnPct).filter(v=>v!=null);
    const calls=allAccepted.filter(r=>r.side==='call').length;
    return {key,decisions:allAccepted.length,calls,puts:allAccepted.length-calls,mature:accepted.length,
      meanDirectionalReturnPct:round(mean(returns)),directionalWinRatePct:returns.length>=20?round(returns.filter(v=>v>0).length/returns.length*100):null,
      modeledOptionSample:options.length,meanModeledOptionRiskReturnPct:round(mean(options)),
      worstCloseExcursionPct:accepted.length?Math.min(...accepted.map(r=>r.outcomes[horizon].adverseClosePct)):null};
  });
  const held=paired.filter(r=>r.policies?.legacy?.eligible&&!r.policies?.combined?.eligible);
  const emptyRuns=(study?.runs||[]).filter(r=>r.selected===0).length;
  const unavailableRuns=(study?.runs||[]).filter(r=>r.marketUnavailable).length;
  const switches=new Map();let flips=0;
  for(const r of eligible.slice().sort((a,b)=>a.decisionAt.localeCompare(b.decisionAt))){const key=r.symbol+':'+r.side,prev=switches.get(key),value=!!r.policies?.combined?.eligible;if(prev!=null&&prev!==value)flips++;switches.set(key,value);}
  const segment=(rs)=>policies.map(p=>{const a=rs.filter(r=>r.policies?.[p.key]?.eligible);return {key:p.key,n:a.length,mean:round(mean(a.map(r=>r.outcomes[horizon].directionalReturnPct)))};});
  return {version:MARKET_STUDY_VERSION,horizon,total:rows.length,comparable:eligible.length,mature:mature.length,publicationCount:runs.length||snapshots.size,
    comparisonRunCount:runs.length?complete.size:snapshots.size,incompleteRuns:runs.length-complete.size,emptyRuns,unavailableRuns,flips,
    avoidedLosers:held.filter(r=>r.outcomes[horizon].directionalReturnPct<0).length,
    missedWinners:held.filter(r=>r.outcomes[horizon].directionalReturnPct>0).length,
    heldBackSample:held.length,policies,splitDate:split,periods:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,segment(v)])),
    byRegime:[...new Set(paired.map(r=>r.marketState))].map(state=>({state,results:segment(paired.filter(r=>r.marketState===state))})),
    calibrated:false,paused:study?.paused===true,
    caveat:'Eligibility shadows share the same stock/contract prerequisites. They are not executed portfolios or independent observations. AI approval is available only for reviewed candidates. No policy is automatically tuned from these results.'};
}

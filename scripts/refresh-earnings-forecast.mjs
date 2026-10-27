// Existing bake only. Reads free SEC disclosures, never Gemini or a broker.
import { readFile, writeFile, mkdir, link, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { attachCompanyResearch, buildIndustryEvidence } from '../lib/company-research.mjs';
import { FORECAST_KEY, FORECAST_STATE_KEY, contentHash, makeObservation, normalizeCompanyFacts, mergeObservations, selectCohort, forecastQuarter, evaluateRuns, buildForecastPayload, businessMix, finite, conservativePublication, reconstructedBacktest, knownReportedPeriod, cohortDue, acceptCohort, rerankCohort, segmentInputMix } from '../lib/earnings-forecast.mjs';

const DAY=86400000;
export async function readForecastState(dataDir) {
  try {const s=JSON.parse(await readFile(resolve(dataDir,FORECAST_STATE_KEY),'utf8'));if(s.version!==1||!s.observations||!Array.isArray(s.runs)||!s.current)throw Error('Invalid existing forecast state; refusing to reset the ledger');return s;}
  catch(e){if(e.code==='ENOENT')return {version:1,cohort:null,observations:{},runs:[],current:{},evaluations:[],mix:{},sourceStatus:{},sourceDocuments:{}};throw e;}
}

export function parseTsmRelease(html, {url,accession,filed,firstSeenAt,rawHash}) {
  const clean=x=>x.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  const text=clean(html), header=/\b([1-4])Q(\d{2})\s+Amount/i.exec(text);
  if(!header || !/NT\$ million, except for EPS/i.test(text) || !/TIFRS/i.test(text))throw Error('Unsupported TSM quarterly earnings-release table');
  const quarter=Number(header[1]),year=2000+Number(header[2]);
  const period=(y,q)=>({start:new Date(Date.UTC(y,(q-1)*3,1)).toISOString().slice(0,10),end:new Date(Date.UTC(y,q*3,0)).toISOString().slice(0,10)});
  const periods=[period(year,quarter),period(year-1,quarter),quarter===1?period(year-1,4):period(year,quarter-1)];
  const map={'net sales':'revenue','gross profit':'grossProfit','income from operations':'operatingIncome','income before tax':'pretaxIncome','net income':'netIncome','eps (nt$)':'eps'};
  const observations=[];
  for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>clean(m[1]));
    const metric=map[cells[0]?.toLowerCase()];if(!metric||cells.length!==6)continue;
    for(const [i,col] of [1,2,4].entries()){
      const m=/^\(?(-?[\d,]+(?:\.\d+)?)\)?(?:\s+[a-z])?$/.exec(cells[col]);if(!m)continue;
      const scalar=Number(m[1].replaceAll(',',''));
      const value=(cells[col].startsWith('(')?-Math.abs(scalar):scalar)*(metric==='eps'?1:1e6);
      observations.push(makeObservation({issuerId:'0001046179',symbol:'TSM',metric,...periods[i],value,unit:metric==='eps'?'TWD/shares':'TWD',currency:'TWD',basis:'TIFRS',tag:'TSMC earnings release: '+metric,priority:0,accession,filed,form:'6-K',availableAt:conservativePublication(filed),publicationPrecision:'filing date; conservative next-day cutoff',firstSeenAt,rawHash,sourceUrl:url}));
    }
  }
  if(!observations.some(o=>o.metric==='revenue'&&o.end===periods[0].end)||!observations.some(o=>o.metric==='eps'&&o.end===periods[0].end))throw Error('TSM release failed revenue/EPS validation');
  return observations;
}

export async function prepareEarningsForecast({previous,chains,universe,sectors,cikMap=null,fetchImpl=fetch,now=()=>new Date().toISOString(),maxRequests=48,maxBytes=120e6,enabled=true,macroContext=null}) {
  const state=structuredClone(previous),startedAt=now(),today=startedAt.slice(0,10),artifacts=new Map();
  state.collectionError=null;
  state.reconstructed ||= {};
  if(macroContext)state.context=[['tenY','US 10-year Treasury yield','Percent','https://finance.yahoo.com/quote/%5ETNX/'],['dxy','US dollar index','Index points','https://finance.yahoo.com/quote/DX-Y.NYB/'],['crude','WTI crude futures','USD per barrel','https://finance.yahoo.com/quote/CL%3DF/']].filter(([key])=>finite(macroContext[key]?.value)).map(([key,label,unit,url])=>({label,value:macroContext[key].value,unit,url,asOf:macroContext[key].asOf||null,collectedAt:startedAt}));
  state.dailyCost=state.dailyCost?.date===today?state.dailyCost:{date:today,requests:0,bytes:0};
  const initialRequests=state.dailyCost.requests;
  let lastRequestAt=0;
  if(!enabled)return {state,artifacts,payload:{...buildForecastPayload({state,chains,builtAtIso:startedAt}),enabled:false}};
  // Re-rank once per calendar quarter (and until a complete ranking lands).
  if(cohortDue(state.cohort,startedAt)){const cohort=selectCohort(chains,universe,sectors,startedAt);if(acceptCohort(state.cohort,cohort,startedAt))rerankCohort(state,cohort,startedAt);}
  // Former members keep collecting filings until their last frozen forecast
  // can be scored (about four months past its target quarter).
  const inCohort=new Set((state.cohort?.companies||[]).map(c=>c.symbol));
  const tracked=[...(state.cohort?.companies||[]),...Object.values(state.former||{}).filter(c=>{if(inCohort.has(c.symbol))return false;const run=state.runs.find(r=>r.id===state.current[c.symbol]);return run&&Date.parse(run.target.end)+120*DAY>Date.parse(startedAt);})];
  async function get(url){
    const u=new URL(url);if(u.protocol!=='https:'||!['data.sec.gov','www.sec.gov'].includes(u.hostname))throw Error('Source host not permitted');
    if(state.dailyCost.requests>=maxRequests||state.dailyCost.bytes>=maxBytes)throw Error('Daily free-source request/byte limit reached');
    const pause=150-(Date.now()-lastRequestAt);if(pause>0)await new Promise(r=>setTimeout(r,pause));lastRequestAt=Date.now();
    state.dailyCost.requests++;
    const r=await fetchImpl(url,{headers:{'User-Agent':process.env.SEC_USER_AGENT||'Mingstreet research (mingstreet.app)','Accept':'application/json, text/html'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('SEC HTTP '+r.status);
    const chunks=[];let bytes=0;
    if(r.body?.getReader){const reader=r.body.getReader();try{while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;state.dailyCost.bytes+=value.byteLength;if(bytes>12e6||state.dailyCost.bytes>maxBytes){await reader.cancel();throw Error('SEC source exceeds byte limit');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}}
    else{const b=Buffer.from(await r.text());bytes=b.length;state.dailyCost.bytes+=bytes;if(bytes>12e6||state.dailyCost.bytes>maxBytes)throw Error('SEC source exceeds byte limit');chunks.push(b);}
    return Buffer.concat(chunks).toString('utf8');
  }
  const preserve=(body,metadata)=>{const hash=contentHash(body);if(!state.sourceDocuments[hash]){const record={version:1,hash,firstSeenAt:now(),...metadata,body},key='earnings-forecast/sources/'+contentHash(record)+'.json';artifacts.set(key,record);state.sourceDocuments[hash]={key,firstSeenAt:record.firstSeenAt,url:metadata.url};}return hash;};
  let map=cikMap;
  if(!map&&tracked.length&&tracked.every(c=>state.sourceStatus[c.symbol]?.issuerId))map=new Map(tracked.map(c=>[c.symbol,state.sourceStatus[c.symbol].issuerId]));
  if(!map&&tracked.length){try{const url='https://www.sec.gov/files/company_tickers.json',body=await get(url);preserve(body,{url});const j=JSON.parse(body);map=new Map(Object.values(j).map(v=>[v.ticker,String(v.cik_str).padStart(10,'0')]));}catch(e){state.collectionError=e.message;}}
  for(const c of tracked){
    const sym=c.symbol,old=state.sourceStatus[sym]||{},accessions=chains[sym]?.fundamentals?.segments?.sourceAccessions||null;
    const issuerId=map?.get(sym)||old.issuerId;
    if(issuerId){const f={...chains[sym]?.fundamentals,cik:issuerId};const mix=businessMix(f);if(mix.product||mix.geographic)state.mix[sym]=mix;}
    if(!issuerId){state.sourceStatus[sym]={...old,error:'No verified SEC issuer mapping is available'};continue;}
    const age=Date.parse(startedAt)-Date.parse(old.checkedAt||'');
    if(old.checkedAt?.slice(0,10)===today&&old.accessions===accessions)continue;
    if(sym!=='TSM'&&!old.error&&old.rawHash&&old.accessions===accessions&&age<7*DAY)continue;
    try{
      let incoming=[];
      if(sym==='TSM'){
        const url='https://data.sec.gov/submissions/CIK'+issuerId+'.json',body=await get(url);preserve(body,{url});const j=JSON.parse(body),f=j.filings?.recent;
        if(!f)throw Error('Missing issuer filing history');
        const releases=[];
        for(let i=0;i<f.form.length;i++)if(f.form[i]==='6-K'&&/tsm-\d{8}x6k\.htm/i.test(f.primaryDocument[i])&&Number(f.filingDate[i].slice(0,4))>=Number(today.slice(0,4))-3)releases.push({accession:f.accessionNumber[i],filed:f.filingDate[i],document:f.primaryDocument[i]});
        for(const r of releases.slice(0,6)){
          const marker='tsm:'+r.accession;if(state.sourceDocuments[marker])continue;
          const base='https://www.sec.gov/Archives/edgar/data/'+Number(issuerId)+'/'+r.accession.replaceAll('-','')+'/';
          const primary=await get(base+r.document);preserve(primary,{url:base+r.document});
          const links=[...primary.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
          const exhibit=links.find(l=>/a[1-4]q\d{2}e[^/]*\.htm/i.test(l));
          if(!exhibit)continue;
          const releaseUrl=new URL(exhibit,base).href,html=await get(releaseUrl),rawHash=preserve(html,{url:releaseUrl,accession:r.accession,filed:r.filed});
          const batch=parseTsmRelease(html,{...r,url:releaseUrl,firstSeenAt:now(),rawHash});
          state.observations[sym]=mergeObservations(state.observations[sym],batch);
          artifacts.set('earnings-forecast/observations/'+contentHash(batch)+'.json',{version:1,symbol:sym,observations:batch});
          incoming.push(...batch);state.sourceDocuments[marker]={rawHash,url:releaseUrl};
        }
        if(!incoming.length&&!state.observations[sym]?.length)throw Error('No supported quarterly issuer release found');
        state.sourceStatus[sym]={issuerId,accessions,checkedAt:now(),error:null,provider:'SEC issuer earnings-release exhibits'};
      }else{
        const url='https://data.sec.gov/api/xbrl/companyfacts/CIK'+issuerId+'.json',body=await get(url),rawHash=preserve(body,{url});
        const normalized=normalizeCompanyFacts(JSON.parse(body),{symbol:sym,firstSeenAt:now(),rawHash});
        if(normalized.issuerId!==issuerId)throw Error('Source issuer identity mismatch');
        incoming=normalized.observations;
        if(!incoming.length)throw Error('No supported financial observations');
        state.sourceStatus[sym]={issuerId,rawHash,accessions,checkedAt:now(),error:null,quarantined:normalized.quarantined.length,provider:'SEC company facts'};
      }
      const priorIds=new Set((state.observations[sym]||[]).map(o=>o.id));
      state.observations[sym]=mergeObservations(state.observations[sym],incoming);
      const added=state.observations[sym].filter(o=>!priorIds.has(o.id));
      if(added.length)artifacts.set('earnings-forecast/observations/'+contentHash(added)+'.json',{version:1,symbol:sym,observations:added});
    }catch(e){state.sourceStatus[sym]={...old,issuerId,accessions,checkedAt:now(),error:String(e.message).slice(0,200)};}
  }
  const cutoffAt=now();
  state.evaluations=evaluateRuns(state.runs,state.observations,cutoffAt);
  for(const c of state.cohort?.companies||[]){
    const announcement=chains[c.symbol]?.fundamentals?.nextEarningsDate,remaining=announcement?(Date.parse(announcement)-Date.parse(cutoffAt))/DAY:null;
    const horizon=remaining===null||remaining<0?'unscheduled':remaining>30?'T30plus':remaining>14?'T30':remaining>7?'T14':remaining>1?'T7':'T1';
    const run=forecastQuarter({symbol:c.symbol,observations:state.observations[c.symbol]||[],cutoffAt,liveEvaluations:state.evaluations,horizon,reportedPeriodEnd:knownReportedPeriod(chains[c.symbol]?.fundamentals),segmentMix:segmentInputMix(state.mix[c.symbol])});
    if(['ready','partial'].includes(run.status)&&finite(run.outputs?.revenue)){
      const old=state.runs.find(r=>r.inputKey===run.inputKey);if(!old){state.runs.push(run);artifacts.set('earnings-forecast/runs/'+run.id+'.json',run);}state.current[c.symbol]=old?.id||run.id;
    }else delete state.current[c.symbol];
    state.reconstructed[c.symbol]=reconstructedBacktest(c.symbol,state.observations[c.symbol]||[],cutoffAt);
  }
  const payload=buildForecastPayload({state,chains,builtAtIso:cutoffAt,collection:{requestsThisRun:state.dailyCost.requests-initialRequests,requestsToday:state.dailyCost.requests,bytesToday:state.dailyCost.bytes,requestLimitPerDay:maxRequests,collectionError:state.collectionError||null}});
  payload.enabled=true;
  attachCompanyResearch({state,payload,chains,asOf:cutoffAt,industryInputs:{universe}});
  for(const c of payload.companies){const q=chains[c.symbol];c.valuationReference={spot:q?.spot??null,quoteAsOf:q?.quoteAsOf||null,currency:q?.quoteProvenance?.currency||null,forwardPE:q?.fundamentals?.forwardPE??null,reportedPeriodEnd:knownReportedPeriod(q?.fundamentals),asOf:cutoffAt};}
  return {state,payload,artifacts,industryUniverse:universe};
}

export async function writeEarningsForecast({dataDir,prepared}){
  // Both the full bake and the standalone refresh use the same collected
  // snapshots. Publication never initiates another source scan.
  const industryInputs={};
  for(const[key,file]of [['memory','ram-prices.json'],['gpu','accelerator-prices.json'],['capex','ai-capex.json']]){
    try{industryInputs[key]=JSON.parse(await readFile(resolve(dataDir,file),'utf8'));}
    catch{industryInputs[key]=null;}
  }
  prepared.payload.industryEvidence=buildIndustryEvidence({...industryInputs,asOf:prepared.payload.builtAtIso,universe:prepared.industryUniverse||[]});
  const stateText=JSON.stringify(prepared.state);
  if(prepared.payload.companyStorage)Object.assign(prepared.payload.companyStorage,{
    stateBytes:Buffer.byteLength(stateText),
    pendingArchiveBytes:[...prepared.artifacts.values()].reduce((sum,value)=>sum+Buffer.byteLength(JSON.stringify(value)),0),
    payloadBytes:0,
  });
  let text=JSON.stringify(prepared.payload);
  if(prepared.payload.companyStorage)for(let i=0;i<3;i++){prepared.payload.companyStorage.payloadBytes=Buffer.byteLength(text);text=JSON.stringify(prepared.payload);}
  // Validate the complete UI snapshot before writing any new archive objects.
  if(Buffer.byteLength(text)>3_000_000)throw Error('Forecast UI payload exceeds budget');
  // Publish the pathname only after bytes are complete. Exclusive hard links
  // make concurrent identical puts idempotent without exposing partial JSON.
  for(const[key,value]of prepared.artifacts){
    const path=resolve(dataDir,key);await mkdir(dirname(path),{recursive:true});const text=JSON.stringify(value),temp=path+'.'+randomUUID()+'.tmp';
    await writeFile(temp,text,{flag:'wx'});
    try{try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;if(await readFile(path,'utf8')!==text)throw Error('Immutable forecast artifact collision: '+key);}}finally{await unlink(temp);}
  }
  for(const[key,body]of [[FORECAST_STATE_KEY,stateText],[FORECAST_KEY,text]]){const path=resolve(dataDir,key),temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,body,{flag:'wx'});await rename(temp,path);}
  return {companies:prepared.payload.companies.length,forecasts:prepared.payload.companies.filter(c=>finite(c.forecast.outputs?.revenue)&&c.forecast.status!=='stale').length,bytes:Buffer.byteLength(text)};
}

export async function refreshEarningsForecast({dataDir,chains,universe,sectors,cikMap,fetchImpl,now}){
  const previous=await readForecastState(dataDir),prepared=await prepareEarningsForecast({previous,chains,universe,sectors,cikMap,fetchImpl,now});
  return {...await writeEarningsForecast({dataDir,prepared}),prepared};
}

export async function runEarningsForecastCli(){
  const root=fileURLToPath(new URL('../',import.meta.url)),dataDir=resolve(root,'data');
  const {TICKERS,SECTORS}=await import('./build.mjs');const chains={};
  for(const s of TICKERS){try{chains[s]=JSON.parse(await readFile(resolve(dataDir,s+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  // A local public heatmap can fill ranking-only market caps without fabricating financials.
  try{const h=JSON.parse(await readFile(resolve(dataDir,'earnings-launch-ranking.json'),'utf8'));for(const r of h.rows||[])if(!chains[r.t])chains[r.t]={quoteAsOf:h.asOf,fundamentals:{name:r.n,marketCap:r.mc}};}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=await refreshEarningsForecast({dataDir,chains,universe:TICKERS,sectors:SECTORS});
  console.log(JSON.stringify({companies:result.companies,forecasts:result.forecasts,bytes:result.bytes,cost:result.prepared.payload.cost,status:result.prepared.payload.companies.map(c=>({symbol:c.symbol,status:c.forecast.status,reason:c.forecast.reason,error:c.collectionError,target:c.forecast.target,outputs:c.forecast.outputs}))},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runEarningsForecastCli().catch(e=>{console.error(e);process.exitCode=1;});

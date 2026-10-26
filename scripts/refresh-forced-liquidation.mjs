import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LIQUIDATION_KEY, buildForcedLiquidationPayload, liquidationMarketFromChain } from '../lib/forced-liquidation.mjs';
import { collectLiquidationSec } from '../lib/forced-liquidation-sec.mjs';
import { withYahooTimeout } from '../lib/yahoo.mjs';

export async function readForcedLiquidation(dataDir) {
  try { return JSON.parse(await readFile(resolve(dataDir,LIQUIDATION_KEY),'utf8')); } catch { return null; }
}
export async function collectLiquidationMarkets({ observations, chains = {}, previous = {}, lastAttempts = {}, quoteClient, now, maxSymbols = 8, deadlineMs = 45000 }) {
  const markets={...previous},errors=[],attempts={...lastAttempts},started=Date.now();let requested=0;
  const symbols=[...new Set(observations.filter(r=>r.kind==='equity-pledge' && r.status!=='released' && r.issuerVerified && /^[A-Z][A-Z0-9.-]{0,9}$/.test(r.symbol)).map(r=>r.symbol))];
  const missing=symbols.filter(s=>{
    const m=liquidationMarketFromChain(chains[s],now),age=Date.parse(now)-Date.parse(m?.quoteAsOf);
    return !m?.price || !Number.isFinite(age) || age>96*3600000 || age < -5*60000;
  }).sort((a,b)=>(Date.parse(attempts[a])||0)-(Date.parse(attempts[b])||0)||a.localeCompare(b));
  if(quoteClient)for(const symbol of missing.slice(0,maxSymbols)){
    if(Date.now()-started>=deadlineMs)break;
    requested++;attempts[symbol]=now;
    const previousMarket=previous[symbol]||{},rowErrors=[];
    const read=async(field,operation)=>{
      try{
        if(Date.now()-started>=deadlineMs)throw new Error('Market-data budget reached');
        return await withYahooTimeout(operation(),`collateral ${symbol} ${field}`);
      }catch(e){const error={symbol,field,message:e.message};errors.push(error);rowErrors.push(error);return null;}
    };
    const quote=await read('quote',()=>quoteClient.quote(symbol));
    const chart=await read('volume',()=>quoteClient.chart(symbol,{period1:new Date(Date.parse(now)-65*86400000),period2:new Date(now),interval:'1d'}));
    const stats=await read('float',()=>quoteClient.quoteSummary(symbol,{modules:['defaultKeyStatistics']}));
    const qt=quote?.regularMarketTime?new Date(quote.regularMarketTime):null;
    const quotes=Array.isArray(chart?.quotes)?chart.quotes:[];
    const observed=liquidationMarketFromChain({spot:quote?.regularMarketPrice,quoteAsOf:qt&&Number.isFinite(qt.getTime())?qt.toISOString():null,
      fundamentals:{floatShares:stats?.defaultKeyStatistics?.floatShares??null},
      _bars:quotes.flatMap(q=>{const t=q.date?new Date(q.date):null;return t&&Number.isFinite(t.getTime())?[{t:t.toISOString().slice(0,10),v:q.volume}]:[];})},now);
    const validQuote=observed.price!=null&&observed.quoteAsOf;
    markets[symbol]={...previousMarket,...observed,
      price:validQuote?observed.price:previousMarket.price??null,quoteAsOf:validQuote?observed.quoteAsOf:previousMarket.quoteAsOf??null,
      averageDailyVolume:chart?observed.averageDailyVolume:previousMarket.averageDailyVolume??null,
      volumeAsOf:chart?observed.volumeAsOf:previousMarket.volumeAsOf??null,
      volumeSessions:chart?observed.volumeSessions:previousMarket.volumeSessions??0,
      floatShares:stats?observed.floatShares:previousMarket.floatShares??null,
      checkedAt:now,errors:rowErrors,
    };
  }
  return { markets, coverage:{symbolsRequested:requested,symbolsDeferred:missing.length-requested,lastAttempts:attempts,errors} };
}
export async function refreshForcedLiquidation({ prior, universe, chains, cikMap, builtAtIso, quoteClient, ...collectorOptions }) {
  const collected = await collectLiquidationSec({ prior, universe, cikMap, now:builtAtIso, ...collectorOptions });
  const previous=Object.fromEntries((prior?.rows || []).filter(r=>r.symbol&&r.market).map(r=>[r.symbol,r.market]));
  const quotes=await collectLiquidationMarkets({observations:collected.observations,chains,previous,lastAttempts:prior?.coverage?.marketData?.lastAttempts||{},quoteClient,now:builtAtIso});
  return buildForcedLiquidationPayload({ ...collected, coverage:{...collected.coverage,marketData:quotes.coverage}, markets:quotes.markets, chains, universe, priorSnapshots:prior?.snapshots || [], builtAtIso });
}
export async function writeForcedLiquidation(dataDir,payload) {
  await mkdir(dataDir,{recursive:true});
  await writeFile(resolve(dataDir,LIQUIDATION_KEY),JSON.stringify(payload),'utf8');
}

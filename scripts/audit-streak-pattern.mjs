// Read-only price-data audit. --live requests two free Yahoo daily charts only.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildStreakMaContext} from '../lib/streak-ma-context.mjs';
import {splitPatternHistory,PATTERN_HISTORY_DAYS} from '../lib/pattern-history.mjs';
import {confirmedDailyBars,patternCloseSeries} from './build.mjs';
import {confirmedMarketBars} from '../lib/historical-market-history.mjs';
import {buildDivergenceStudy} from '../lib/pattern-recognition.mjs';
const live=process.argv.includes('--live'),now=new Date(),samples=[];
if(live) {
  const {default:YahooFinance}=await import('yahoo-finance2');
  const yahoo=new YahooFinance({suppressNotices:['yahooSurvey']});
  for(const symbol of ['AAPL','SPY']) {
    const chart=await yahoo.chart(symbol,{period1:new Date(+now-PATTERN_HISTORY_DAYS*86400000),period2:now,interval:'1d'});
    const bars=(chart.quotes||[]).filter(q=>q.close>0).map(q=>({t:new Date(q.date).toISOString().slice(0,10),c:q.close,v:q.volume??null}));
    assert(bars.length>450,symbol+' returned actual two-year history');samples.push({symbol,bars});
  }
} else {
  for(const name of (await readdir('data')).filter(n=>/^[A-Z][A-Z0-9.]{0,5}\.json$/.test(n))) {
    const data=JSON.parse(await readFile(resolve('data',name),'utf8')),p=data.priceSeries;
    if(!p?.t?.length||!p?.c?.length)continue;
    samples.push({symbol:name.slice(0,-5),bars:p.t.map((t,i)=>({t,c:p.c[i]})).filter(b=>b.c>0)});
  }
  if(!samples.length) {
    const cache=JSON.parse(await readFile('data/historical-source-history.json','utf8'));
    const since=new Date(+now-PATTERN_HISTORY_DAYS*86400000).toISOString().slice(0,10);
    for(const [symbol,values]of Object.entries(cache.symbols||{})) {
      const bars=confirmedMarketBars(values,cache.records?.[symbol],cache.version).filter(b=>b.t>=since);
      if(bars.length)samples.push({symbol,bars});
    }
  }
}
assert(samples.length,'Actual price histories are required');
let checks=0;
const rows=[];
for(const {symbol,bars:raw} of samples) {
  const bars=confirmedDailyBars(raw,'UNKNOWN',now),context=buildStreakMaContext(bars);
  for(const m of context?.levels||[]) {
    const mean=(period,offset=0)=>bars.slice(-period-offset,offset?-offset:undefined).reduce((sum,b)=>sum+b.c,0)/period;
    const expected=mean(m.period);
    assert(Math.abs(m.value-expected)<=0.000051,symbol+' '+m.period+'D level');
    assert(Math.abs(m.distancePct-(bars.at(-1).c/expected-1)*100)<=0.000051,symbol+' '+m.period+'D distance');
    if(bars.length>=m.period+5)assert(Math.abs(m.slopePct-(expected/mean(m.period,5)-1)*100)<=0.000051,symbol+' '+m.period+'D slope');
    checks+=3;
  }
  const windows=splitPatternHistory(raw,now),series=patternCloseSeries({_bars:windows.technical,_patternBars:windows.research,marketState:'UNKNOWN'},now.toISOString());
  assert.equal(series.length,bars.length,'Research adapter retains the full confirmed series');
  const d=buildDivergenceStudy([{symbol,closes:series.map(b=>b.c),dates:series.map(b=>b.t)}]);
  if(d.coverage[0]?.status==='included') {
    const forward=[];for(let i=80;i<series.length-10;i+=5)forward.push((series[i+10].c/series[i].c-1)*100);
    const baseline=forward.length?forward.reduce((a,b)=>a+b,0)/forward.length:null;
    assert.equal(d.baselineN,forward.length);
    if(baseline!=null)for(const [key,value]of Object.entries(d.record))assert(Math.abs(value.baselineAvgPct-(key.endsWith('Bearish')?-baseline:baseline))<=0.0051,'Independent direction-matched baseline');
    checks+=5;
  }
  rows.push({symbol,firstDate:bars[0]?.t,lastDate:bars.at(-1)?.t,researchSessions:bars.length,scoringSessions:windows.technical.length,maPeriods:context?.levels.map(m=>m.period)||[],divergenceCoverage:d.coverage[0]?.status});
}
const report={checkedAtIso:now.toISOString(),basis:live?'Two fresh Yahoo daily chart downloads; conservative completed-close cutoff':'Local cached daily closes; not a live or production audit',checks,samples:rows};
const output=resolve(tmpdir(),live?'stonks-streak-pattern-live-audit.json':'stonks-streak-pattern-cache-audit.json');
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({basis:report.basis,checks,histories:rows.length,output,...(live?{samples:rows}:{})},null,2));

import {buildPatternRecognition} from '../../lib/pattern-recognition.mjs';
import {isHistoricalTradingDate} from '../../lib/historical-market-calendar.mjs';
export function patternLabFixture() {
  const series=(start,end,phase=0)=>{
    const rows=[];let c=100;
    for(let d=new Date(start+'T12:00:00Z');d<=new Date(end+'T12:00:00Z');d=new Date(+d+86400000)) {
      const t=d.toISOString().slice(0,10);if(!isHistoricalTradingDate(t))continue;
      c*=1+.0002+Math.sin(rows.length/9+phase)*.007;
      rows.push({t,c,v:1000000});
    }
    return rows;
  };
  const long=series('2012-01-03','2026-10-27'),spy=series('2024-10-28','2026-10-27');
  const stockNames=['ALFA','BETA','GAMMA'];
  const stocks=stockNames.map((symbol,i)=>{const bars=series('2024-10-28','2026-10-27',i);return {symbol,closes:bars.map(b=>b.c),dates:bars.map(b=>b.t)};});
  const payload=buildPatternRecognition({builtAtIso:'2026-10-28T00:00:00Z',asOf:'2026-10-27',indexBars:{'^GSPC':long,SPY:long,QQQ:long,IWM:long},spyBars:spy,divergences:stocks,
    fearGreed:spy.map((b,i)=>({date:b.t,score:i%60<30?10:90})),regimeDays:spy.map((b,i)=>({date:b.t,axisScores:{indexes:i%3===0?1:-1,breadth:-1}}))});
  payload.pieces.divergences.rows=[
    {symbol:'ALFA',indicator:'rsi',direction:'bullish',olderDate:'2026-10-01',newerDate:'2026-10-20',priceChangePct:-3},
    {symbol:'BETA',indicator:'macd',direction:'bearish',olderDate:'2026-10-02',newerDate:'2026-10-19',priceChangePct:4},
    {symbol:'GAMMA',indicator:'rsi',direction:'bullish',olderDate:'2026-10-01',newerDate:'2026-10-21',priceChangePct:-2}];
  // Explicit fixture summaries exercise positive, negative, and missing outcomes.
  for(const [key,avg,n]of [['rsiBullish',1.2,45],['rsiBearish',-.8,35],['macdBullish',.4,12],['macdBearish',1.8,62]]) payload.pieces.divergences.record[key]={avgPct:avg,n,medianPct:avg/2,hitRatePct:55,baselineAvgPct:key.endsWith('Bearish')?-.5:.5,baselineN:85,worstPct:-6,bestPct:9,provisional:n<30};
  payload.pieces.leadLag={tested:2,usable:1,rows:[
    {us:'ALFA',peer:'PEER-A',sessionClass:'leading',n:200,sameDayBeta:.8,sameDayT:3.2,lag1Beta:.1,lag1T:.2,lag1N:199,corr60:.6,corr120:.5,read:'same-day link is large in-sample'},
    {us:'BETA',peer:'PEER-B',sessionClass:'24h',n:200,sameDayBeta:.2,sameDayT:.5,lag1Beta:.6,lag1T:1.3,lag1N:199,corr60:.1,corr120:.4,read:'too weak'}],caveat:'Synthetic peer relationships for display checks.'};
  return payload;
}

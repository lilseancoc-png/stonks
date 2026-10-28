// Fictional tickers and prices for offline UI and policy checks.
import { assessOptionEntryEconomics, OPTION_ENTRY_POLICY_VERSION } from '../../lib/option-entry-economics.mjs';
import { yahooQuoteProvenance } from '../../lib/quote-provenance.mjs';
import { sessionForDate } from '../../lib/us-equity-calendar.mjs';

export const UNIFIED_FIXTURE_TIME = '2026-10-23T15:05:00.000Z';
export function unifiedSignalFixture(builtAtIso = UNIFIED_FIXTURE_TIME) {
  const grade = (symbol, side = 'call', state = 'go') => {
    const sign = side === 'put' ? -1 : 1;
    return { symbol, side, total: sign * 8, sector: 'Synthetic technology',
      pillars: {
        fundamentals: { score: sign * 2, signals: [{ key: 'growth', label: 'Earnings trajectory', score: sign * 2, value: sign > 0 ? 'Improving earnings evidence' : 'Deteriorating earnings evidence', note: 'Synthetic fixture', available: true }] },
        technicals: { score: sign * 3, signals: [{ key: 'trend', label: 'Confirmed price trend', score: sign * 3, value: sign > 0 ? 'Higher closes' : 'Lower closes', available: true }] },
        mechanicals: { score: sign * 2, signals: [{ key: 'flow', label: 'Directional participation', score: sign * 2, value: 'Synthetic signed volume', available: true }] },
        narrative: { score: sign, signals: [{ key: 'story', label: 'Catalyst thesis', score: sign * 2, value: 'Fixture catalyst', available: true }, { key: 'counter', label: 'Earnings expectations risk', score: -sign, value: 'Counterevidence', available: true }] },
        timing: { state, score: 2, headline: state === 'go' ? 'Confirmed setup in the fixture' : 'Wait for a confirmed turn',
          readiness: { independentFamilies: 3, directionConfirmed: true, structureOk: true, payoffOk: true, crowdedProof: true, countertrendProof: true },
          structure: { target: sign > 0 ? 115 : 85, invalidation: sign > 0 ? 94 : 106, clear: true, rr: 2.5, targetKind: 'prior resistance/support', anchorKind: '20D SMA' } },
      } };
  };
  const names = ['BULL','BEAR','WAIT','AVOID','MISS','MIX'];
  const grades = Object.fromEntries(names.map(symbol => [symbol, grade(symbol, symbol === 'BEAR' ? 'put' : 'call', symbol === 'WAIT' ? 'wait' : 'go')]));
  grades.MIX.side = null;
  const quote = { regularMarketPrice: 100, regularMarketTime: new Date(builtAtIso), marketState: 'REGULAR', currency: 'USD', exchange: 'TEST' };
  const chains = Object.fromEntries(names.map(symbol => [symbol, { spot: 100, quoteAsOf: builtAtIso, marketState: 'REGULAR', quoteProvenance: yahooQuoteProvenance(quote, { optionSpot: true, fetchedAt: builtAtIso }),
    fundamentals: { targetMeanPrice: 120, targetLowPrice: 90, targetHighPrice: 135, numberOfAnalystOpinions: 10 },
    news: { builtAt: builtAtIso, headlines: [{ title: 'Fixture business reports higher revenue', publisher: 'Synthetic original', publishedAt: builtAtIso, link: 'https://example.com/fixture' }, { title: 'Fixture business reports higher revenue', publisher: 'Synthetic aggregator', publishedAt: builtAtIso }] }, catalysts: [] }]));
  // Real calendar dates, fictional OHLCV. The final unfinished session is
  // deliberately extreme so a look-ahead error changes the setup visibly.
  const dates = [];
  for (let ms = Date.parse('2026-01-01T12:00:00Z'); ms <= Date.parse('2026-10-23T12:00:00Z'); ms += 86400000) {
    const day = new Date(ms).toISOString().slice(0,10);
    if (sessionForDate(day)?.open) dates.push(day);
  }
  const completed = dates.filter(day => day < '2026-10-23');
  for (const symbol of names) {
    const bars = completed.map((t,i) => ({t,c:80+i*.09,h:80.6+i*.09,l:79.4+i*.09,v:1000}));
    for (const [offset,close] of [105,103,101,97,100].entries()) {
      const i=bars.length-5+offset;
      bars[i]={...bars[i],c:close,h:close+.5,l:close-.5,v:offset===4?2200:1000};
    }
    bars.push({t:'2026-10-23',c:500,h:501,l:499,v:100000});
    chains[symbol]._bars=bars;
    chains[symbol].priceHistoryProvenance={provider:'Yahoo Finance chart',interval:'1d',requestedAt:builtAtIso,fetchedAt:builtAtIso};
    Object.assign(chains[symbol].fundamentals,{financialCurrency:'USD',industry:'Fixture operating companies',sector:'Technology',forwardPE:20});
  }
  chains.MISS.quoteProvenance.asOf = null;
  chains.MISS.quoteAsOf = null;
  const expiry = Date.parse('2026-12-18T00:00:00Z') / 1000;
  const pick = symbol => {
    const side = grades[symbol].side;
    const contract = symbol === 'BEAR'
      ? { structure: 'credit_vertical', expiry, strike: 105, legs: [{ type:'call',qty:-1,strike:105,bid:2,ask:2.1,iv:.3,expiry },{type:'call',qty:1,strike:110,bid:.45,ask:.5,iv:.3,expiry}] }
      : { structure: 'long', expiry, strike: 100, bid: 4, ask: 4.2, iv: .3 };
    const optionEconomics = assessOptionEntryEconomics({ side, spot: 100, contract, plan: grades[symbol].pillars.timing.structure, nowMs: Date.parse(builtAtIso) });
    return { symbol, side, group: symbol === 'WAIT' ? 'watch' : 'actionable', contract,
      strategy: { type: symbol === 'BEAR' ? 'credit' : 'long', label: symbol === 'BEAR' ? 'Bear call credit spread' : 'Long call' },
      entry: { now: symbol !== 'WAIT', trigger: 100, economics: optionEconomics }, optionEconomics,
      entryTiming: { state: symbol === 'WAIT' ? 'wait' : 'go' }, entryPolicyVersion: OPTION_ENTRY_POLICY_VERSION,
      finalGrade: { tier: 'strong', source: 'ai', reason: 'Synthetic existing owner grade' } };
  };
  const picks = { builtAtIso, rosterMeta: { aiVetoed: ['AVOID'] }, picks: ['BULL','BEAR','WAIT'].map(pick) };
  const scenario = { builtAtIso, horizon: '5-10 sessions', scenarios: [{key:'rates',name:'Rates stress'}], sensitivities: names.map(symbol => ({ symbol, decision: { note:'Macro paths are conditional risk context, not odds.' }, scenarios: { rates: { low:-8,mid:-2,high:5 } } })) };
  const evidence = { date: builtAtIso.slice(0,10), names: { BULL: [{id:'iv-z',src:'iv-trend',dir:'up',str:2,v:2,asOf:builtAtIso.slice(0,10),firstSeen:builtAtIso.slice(0,10)}] } };
  const quant = { builtAtIso, sigma: { rows:[{symbol:'BULL',z:3}] } };
  const linkMap = { nodes:{'theme:test':{label:'Synthetic demand theme'}}, edges:[{from:'theme:test',to:'ticker:BULL',src:'fixture',kind:'theme',asOf:builtAtIso.slice(0,10)}] };
  const quarters = [['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']].map(([start,end],i)=>({start,end,currency:'USD',basis:'US GAAP',metrics:Object.fromEntries(Object.entries({revenue:100e6,grossProfit:40e6,operatingIncome:20e6,pretaxIncome:22e6,taxes:4.4e6,netIncome:17.6e6,dilutedShares:8e6,eps:2.2}).map(([metric,value])=>[metric,{value,sourceId:'fixture-'+i+'-'+metric,sourceUrl:'https://www.sec.gov/example/fixture',filed:'2026-08-01',firstSeenAt:'2026-08-03T12:00:00Z'}]))}));
  const forecast = {version:1,enabled:true,builtAtIso,companies:['BULL','WAIT','MIX'].map(symbol=>({symbol,forecast:{id:'fixture-'+symbol,cutoffAt:'2026-08-03T12:00:00Z',latestEnd:'2026-06-30',currency:'USD',target:{start:'2026-07-01'},outputs:{eps:2.4},assumptions:{growthRate:.1,grossMargin:.4,operatingMargin:.2,taxRate:.2,nonoperating:2e6,commonIncomeAdjustment:0}},companyRecord:{asOf:builtAtIso,quarters:structuredClone(quarters)},valuationReference:{forwardPE:20}}))};
  const ivTrending = {builtAtIso,tickers:[{symbol:'BULL',asOf:builtAtIso.slice(0,10),capturedAtIso:builtAtIso,iv:.897,mean:.95,chg5dPct:-2,pctile:40,n:110},{symbol:'WAIT',asOf:builtAtIso.slice(0,10),capturedAtIso:builtAtIso,iv:.897,mean:.95,chg5dPct:3,pctile:40,n:110}]};
  return { builtAtIso, grades, chains, picks, scenario, evidence, quant, linkMap, forecast, ivTrending };
}

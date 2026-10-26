// Fictional tickers and prices for offline UI and policy checks.
import { assessOptionEntryEconomics, OPTION_ENTRY_POLICY_VERSION } from '../../lib/option-entry-economics.mjs';
import { yahooQuoteProvenance } from '../../lib/quote-provenance.mjs';

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
  return { builtAtIso, grades, chains, picks, scenario, evidence, quant, linkMap };
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { unifiedSignalFixture, UNIFIED_FIXTURE_TIME } from './fixtures/unified-signal.mjs';
import { buildUnifiedSignalEngine, writeUnifiedSignalEngine } from '../lib/unified-signal.mjs';
import { publishUnifiedSignal } from './publish-unified-signal.mjs';
import { unifiedSignalDisplayFactory } from '../lib/unified-signal-display.mjs';
import { investmentPerspectiveFactory } from '../lib/investment-perspective.mjs';
import { fullYearValuationFactory } from '../lib/full-year-valuation.mjs';
import { perspectiveBars } from '../lib/trading-perspective.mjs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const by = (payload, symbol='BULL') => payload.decisions.find(row => row.symbol === symbol);
const get = (fixture, symbol='BULL') => by(buildUnifiedSignalEngine(fixture),symbol).perspectives;
const fixture = unifiedSignalFixture(), before = JSON.stringify(fixture), payload = buildUnifiedSignalEngine(fixture);
const current = by(payload).perspectives;
const policy = unifiedSignalDisplayFactory();
const investment = investmentPerspectiveFactory(fullYearValuationFactory());
check(policy.valid(payload),'extended wire payload validates');
check(JSON.stringify(fixture)===before,'both perspectives leave inputs and the owner trade untouched');
check(current.investment.status==='below-range','price is compared with scenario present values');
check(current.trading.setup.kind==='snapped-streak' && current.trading.direction==='bullish','raw completed bars identify the authoritative snapped red streak');
check(current.trading.coverage.lastDate==='2026-10-22','unfinished session is excluded from setup and historical outcomes');
const archivedInputs=current.trading.inputs;
const restored=JSON.parse(inflateRawSync(Buffer.from(archivedInputs.data,'base64')).toString());
const restoredBars=restored.map(([t,h,l,c,v])=>({t,c,h,l,v}));
check(createHash('sha256').update(JSON.stringify(restoredBars)).digest('hex')===archivedInputs.sourceHash,'compressed archival input restores the exact confirmed OHLCV values and identity');
check(restored.length===archivedInputs.rows && archivedInputs.data.length<JSON.stringify(restored).length,'replay history remains exact while reducing the private page payload');
check(by(payload,'MIX').direction==='mixed' && by(payload,'MIX').perspectives.trading.direction==='bullish','an independent price setup can disagree with the original grade');
check(by(payload,'WAIT').status==='wait' && by(payload,'WAIT').perspectives.trading.status==='setup' && !by(payload,'WAIT').perspectives.trading.execution.qualified,'research confirmation cannot promote a waiting owner trade');
check(by(payload,'AVOID').status==='avoid' && !by(payload,'AVOID').perspectives.trading.execution.qualified,'an independent setup cannot override AI rejection');
check(current.trading.volatility.change5dPct<0 && current.trading.volatility.label.includes('falling'),'below-average and falling IV is identified without a recovery forecast');
check(current.trading.volatility.asOf==='2026-10-23' && current.trading.coverage.lastDate==='2026-10-22','fresh intraday IV is dated independently from completed price bars');
const slowHistory=structuredClone(fixture);
slowHistory.builtAtIso='2026-10-23T20:30:00Z';
slowHistory.chains.BULL.priceHistoryProvenance={interval:'1d',requestedAt:'2026-10-23T20:02:00Z',fetchedAt:'2026-10-23T20:20:00Z'};
slowHistory.chains.BULL.quoteProvenance.fetchedAt='2026-10-23T20:25:00Z';slowHistory.chains.BULL.marketState='POST';
check(get(slowHistory).trading.coverage.lastDate==='2026-10-22','slow post-close chart response and later quote work cannot confirm an early request');
slowHistory.chains.BULL.priceHistoryProvenance.requestedAt='2026-10-23T20:16:00Z';
check(get(slowHistory).trading.coverage.lastDate==='2026-10-23','a chart request begun after the confirmation boundary may include the completed close');
const noChartClock=structuredClone(fixture);delete noChartClock.chains.BULL.priceHistoryProvenance;
check(get(noChartClock).trading.status==='insufficient-data','a quote retrieval stamp never substitutes for missing chart provenance');

const costlier = structuredClone(fixture);
costlier.chains.BULL.spot=250;
check(get(costlier).investment.status==='above-range','a different price changes the investment conclusion while the grade is unchanged');
check(costlier.grades.BULL.total===fixture.grades.BULL.total,'price-dependent assessment does not retune the grade');
const changedGrade = structuredClone(fixture);
changedGrade.grades.BULL.total=-20; changedGrade.grades.BULL.side='put';
assert.deepEqual(get(changedGrade).investment,current.investment); checks++;
assert.deepEqual(get(changedGrade).trading.setup,current.trading.setup); checks++;
const changedFuture = structuredClone(fixture);
changedFuture.chains.BULL._bars.at(-1).c=900;
changedFuture.chains.BULL._bars.at(-1).h=901;
changedFuture.chains.BULL._bars.at(-1).l=899;
assert.deepEqual(get(changedFuture).trading,current.trading);checks++;
const changedIv=structuredClone(fixture);changedIv.ivTrending.tickers[0].chg5dPct=20;
check(get(changedIv).trading.direction===current.trading.direction && get(changedIv).trading.plan.target===current.trading.plan.target,'IV repricing supplies no directional vote or stock target');
const mirror=structuredClone(fixture);
mirror.chains.BULL._bars=mirror.chains.BULL._bars.map(bar=>({...bar,c:200-bar.c,h:200-bar.l,l:200-bar.h}));
check(get(mirror).trading.direction==='bearish' && get(mirror).trading.setup.side==='put','a snapped green streak produces the symmetric bearish research hypothesis');
const breakout=structuredClone(fixture);
breakout.chains.BULL._bars=breakout.chains.BULL._bars.map((bar,i)=>({...bar,c:90+i*.02,h:90.5+i*.02,l:89.5+i*.02,v:1000}));
Object.assign(breakout.chains.BULL._bars.at(-2),{c:98,h:98.5,l:97.5,v:2200});
check(get(breakout).trading.setup.kind==='range-break','directional volume confirms an independent range-break hypothesis');
const pullback=structuredClone(fixture);
pullback.chains.BULL._bars=pullback.chains.BULL._bars.map((bar,i)=>({...bar,c:90+i*.08,h:93+i*.08,l:89+i*.08,v:1100}));
check(get(pullback).trading.setup.kind==='trend-pullback','trend and prior-range location identify a distinct pullback hypothesis');

const model=current.investment.model,draft=investment.defaults(model),base=investment.calculate(model,draft);
const baseScenario=base.scenarios.find(row=>row.key==='base');
check(Math.abs(baseScenario.priceAtHorizon-baseScenario.eps*draft.exitMultiple)<.001,'future price reconciles to earnings times the assumed multiple');
check(Math.abs(baseScenario.presentValue-baseScenario.priceAtHorizon/(1+draft.requiredReturnPct/100))<.001,'present value discounts the scenario price by the explicit return hurdle');
const higherHurdle=investment.calculate(model,{...draft,requiredReturnPct:25});
check(higherHurdle.basePresentValue<base.basePresentValue && higherHurdle.requiredGrowthPct>base.requiredGrowthPct,'higher required return lowers present value and raises model-implied revenue requirements');
const weaker=investment.calculate(model,{...draft,growthPct:0});
check(weaker.basePresentValue<base.basePresentValue,'lower growth feeds through the financial bridge into value');
const lossModel=structuredClone(model);lossModel.base.inputs.nonoperating=0;
check(investment.calculate(lossModel,{...draft,operatingMarginPct:1}).status==='unavailable','a loss-making downside is withheld rather than floored into an artificial positive margin');
for(const invalid of [{exitMultiple:null},{requiredReturnPct:0},{growthPct:NaN},{operatingMarginPct:75}]) check(investment.calculate(model,{...draft,...invalid}).status==='unavailable','invalid assumptions withhold prices rather than preserve a previous result');
check(JSON.stringify(fixture)===before,'browser-compatible scenario arithmetic leaves frozen inputs unchanged');

for(const [label, mutate] of [
  ['future snapshot',f=>{f.forecast.builtAtIso='2026-10-24T15:05:00Z';}],
  ['stale snapshot',f=>{f.forecast.builtAtIso='2026-09-01T15:05:00Z';}],
  ['missing history',f=>{delete f.forecast.companies[0].companyRecord;}],
  ['former member',f=>{f.forecast.companies[0].former={leftAt:'2026-10-01T00:00:00Z'};}],
  ['unsupported EPS',f=>{delete f.forecast.companies[0].forecast.outputs.eps;}],
  ['future ingestion',f=>{f.forecast.companies[0].companyRecord.quarters[3].metrics.revenue.firstSeenAt='2026-10-24T00:00:00Z';}],
  ['unavailable filing',f=>{delete f.forecast.companies[0].companyRecord.quarters[3].metrics.revenue.filed;}],
  ['currency mismatch',f=>{f.chains.BULL.fundamentals.financialCurrency='TWD';}],
  ['bank method',f=>{f.chains.BULL.fundamentals.industry='Banks - regional';}],
  ['duplicated quarter',f=>{f.forecast.companies[0].companyRecord.quarters.push(f.forecast.companies[0].companyRecord.quarters[3]);}],
  ['malformed quarter',f=>{f.forecast.companies[0].companyRecord.quarters[1]=null;}],
  ['malformed financial fact',f=>{f.forecast.companies[0].companyRecord.quarters[1].metrics.revenue=null;}],
  ['loss-making bridge',f=>{f.forecast.companies[0].forecast.assumptions.operatingMargin=-.2;}],
]) {
  const f=structuredClone(fixture);mutate(f);
  check(get(f).investment.status==='unavailable',label+' cannot manufacture an investment valuation');
  check(get(f).trading.setup?.kind==='snapped-streak',label+' does not erase an independently supported trading setup');
}
const noHistory=structuredClone(fixture);delete noHistory.chains.BULL._bars;
check(get(noHistory).trading.status==='insufficient-data' && get(noHistory).investment.status==='below-range','missing trading history does not erase the supported investment scenario');
const noVolume=structuredClone(fixture);delete noVolume.chains.BULL._bars[20].v;
check(get(noVolume).trading.status==='insufficient-data','partial volume history is not treated as measured zero');
const staleBars=structuredClone(fixture);staleBars.chains.BULL._bars.splice(-2,2);
check(get(staleBars).trading.status==='insufficient-data','an older confirmed close cannot look current');
const staleIv=structuredClone(fixture);staleIv.ivTrending.tickers[0].asOf='2026-10-21';
check(get(staleIv).trading.volatility.status==='unavailable','stale IV is not silently joined onto fresh prices');
for(const sampledAt of [null,'2026-10-23T15:06:00Z','2026-10-23T12:00:00Z']) {
  const f=structuredClone(fixture);f.ivTrending.tickers[0].capturedAtIso=sampledAt;
  check(get(f).trading.volatility.status==='unavailable','missing, future or aged sampling proof cannot establish current IV context');
}
const thinIv=structuredClone(fixture);thinIv.ivTrending.tickers[0].n=20;
check(get(thinIv).trading.volatility.status==='unavailable','thin IV history remains unavailable');
const event=structuredClone(fixture);event.chains.BULL.fundamentals.nextEarningsDate='2026-10-26';
check(get(event).trading.status==='wait','Friday recognizes a Monday earnings event inside the session-based window');
const broken=structuredClone(fixture);broken.chains.BULL.spot=90;
check(get(broken).trading.status==='invalidated','a price through the setup stop invalidates the research');
const sameIndustry=structuredClone(fixture);sameIndustry.chains.BEAR.fundamentals.industry='Different industry';
check(get(sameIndustry).trading.peers.n===current.trading.peers.n-1,'peer comparisons exclude the company itself and unrelated industries');
const halfday=perspectiveBars(fixture.chains.BULL,'2026-11-27T18:10:00Z');
check(halfday.through==='2026-11-25','half-day bar stays unconfirmed until 15 minutes after its actual close');
check(perspectiveBars(fixture.chains.BULL,'2026-11-27T18:15:00Z').through==='2026-11-27','half-day confirmation uses the verified early close');
check(perspectiveBars(fixture.chains.BULL,'2026-10-26T15:00:00Z').bars.at(-1).t==='2026-10-22','a later assessment cannot promote a retained Friday intraday candle to a confirmed close');
const missingIv=structuredClone(fixture);missingIv.ivTrending.tickers={};
check(get(missingIv).trading.volatility.status==='unavailable','a malformed optional IV feed cannot break the other perspectives');
const laterCollection=structuredClone(fixture);
laterCollection.forecast.builtAtIso='2026-10-23T15:10:00Z';
laterCollection.forecast.companies[0].companyRecord.asOf='2026-10-23T15:10:00Z';
laterCollection.assessmentAtIso='2026-10-23T15:15:00Z';
check(get(laterCollection).investment.status==='below-range','a recorded later assessment cutoff admits financial collection after the bake start without backdating it');
const laterQuote=structuredClone(laterCollection);
laterQuote.chains.BULL.quoteProvenance.asOf='2026-10-23T15:11:00Z';
laterQuote.chains.BULL.quoteProvenance.fetchedAt='2026-10-23T15:12:00Z';
const quoteDecision=by(buildUnifiedSignalEngine(laterQuote));
check(quoteDecision.status==='insufficient-data' && quoteDecision.perspectives.quote.usable && quoteDecision.perspectives.investment.model,'a quote collected after bake start is evaluated at the independent assessment cutoff without changing legacy eligibility');
laterCollection.assessmentAtIso='2026-10-23T17:15:00Z';
check(get(laterCollection).trading.status==='wait' && !get(laterCollection).trading.execution.qualified,'the perspective cutoff cannot reuse entry qualification after the observed quote expired');

// Generate repeated, fictional price episodes to exercise resolved outcomes,
// not just the fresh event whose outcomes have not occurred yet.
const episodes=structuredClone(fixture),history=episodes.chains.BULL._bars.filter(bar=>bar.t<'2026-10-23');
for(let i=0;i<history.length;i++) {
  const phase=i%25;
  const close=phase<18?95+phase*.15:([105,103,101,97,100,101,102][phase-18]);
  Object.assign(history[i],{c:close,h:close+.5,l:close-.5,v:phase===22?2200:1000});
}
// End at the confirmed bounce while keeping the correct latest session.
for(const [offset,close] of [105,103,101,97,100].entries())Object.assign(history[history.length-5+offset],{c:close,h:close+.5,l:close-.5,v:offset===4?2200:1000});
episodes.chains.BULL._bars=history;
const statistics=get(episodes).trading.history;
check(statistics?.horizons.some(h=>h.n>0),'historical prefix replay resolves earlier occurrences');
for(const horizon of statistics.horizons) {
  for(const [i,sample] of horizon.samples.entries()) {
    check(sample.signalDate<sample.outcomeDate && sample.outcomeDate<='2026-10-22','historical outcomes occur after the signal and before the cutoff');
    if(i)check(sample.signalDate>horizon.samples[i-1].outcomeDate,'per-horizon samples do not overlap');
  }
}
const legacy=structuredClone(payload);for(const row of legacy.decisions)delete row.perspectives;
check(policy.valid(legacy),'retained older snapshots without perspectives remain readable');
for(const mutate of [p=>{by(p).perspectives.trading.confirmation=null;},p=>{by(p).perspectives.investment.model.base.inputs.lines=null;},p=>{by(p).perspectives.investment.assessment.range.high=NaN;},p=>{by(p).perspectives.investment.model.multiple.peers=[null];},p=>{by(p).perspectives.investment.model.base.quarters=[null];}]) {
  const p=structuredClone(payload);mutate(p);check(!policy.valid(p),'malformed perspective data is rejected at the UI boundary');
}
const dir=await mkdtemp(resolve(tmpdir(),'stonks-perspectives-'));
try {
  await writeFile(resolve(dir,'picks.json'),JSON.stringify(fixture.picks));
  await writeFile(resolve(dir,'earnings-forecast.json'),JSON.stringify(fixture.forecast));
  await writeFile(resolve(dir,'iv-trending.json'),JSON.stringify(fixture.ivTrending));
  const published=await publishUnifiedSignal({dataDir:dir,builtAtIso:fixture.builtAtIso,chains:fixture.chains,grades:fixture.grades});
  check(by(published).perspectives.investment.status==='below-range','actual publisher joins existing financial artifacts into the investment assessment');
  check(by(published).perspectives.trading.volatility.status==='available','actual publisher threads current IV observations');
  const saved=JSON.parse(await readFile(resolve(dir,published.snapshotKey),'utf8'));
  assert.deepEqual(saved.decisions[0].perspectives,published.decisions[0].perspectives);checks++;
  await writeUnifiedSignalEngine(dir,published);
  check(await readFile(resolve(dir,'picks.json'),'utf8')===JSON.stringify(fixture.picks),'publishing new perspectives does not rewrite the trading roster');
  const oversized=buildUnifiedSignalEngine({...fixture,gradeModelVersion:'x'.repeat(4000000)});
  await assert.rejects(writeUnifiedSignalEngine(dir,oversized),/exceeds the 4 MB/);checks++;
  check(await readFile(resolve(dir,'unified-signal.json'),'utf8')===JSON.stringify(published),'an oversized research snapshot cannot advance the current view');
} finally {await rm(dir,{recursive:true,force:true});}
check(JSON.stringify(fixture)===before,'all checks preserve the original fixture');
console.log(`Unified perspectives: ${checks} checks passed. Fictional financial and price history; no predictive-performance claim.`);

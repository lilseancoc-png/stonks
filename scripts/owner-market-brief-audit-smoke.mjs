// Regression proof for production contracts and the data/UI audit findings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentAssetVersion } from '../lib/asset-version.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';
import { buildOwnerMarketBrief, ownerBriefCalendar, sourceStatus } from '../lib/owner-market-brief.mjs';
import { ownerMarketBriefDisplayFactory } from '../lib/owner-market-brief-display.mjs';
import { buildCalendarPayload, buildLeveragedEtfPicks, gatherBriefSignals } from './build.mjs';
const display=ownerMarketBriefDisplayFactory();
let checks=0;
function check(v,message){assert(v,message);checks++;}
const fixture=ownerBriefFixture(),now=Date.parse(fixture.builtAtIso),original=buildOwnerMarketBrief(fixture);
const test=(change)=>{const f=structuredClone(fixture);change(f);return buildOwnerMarketBrief(f);};
check(display.valid(original),'Builder output satisfies the shared browser boundary');
const leveraged=buildLeveragedEtfPicks({}, {}, fixture.builtAtIso);
leveraged.ideas=[{etf:'TESTX'}];leveraged.watch=[{etf:'WATCHX'}];
const roster=test(f=>f.payloads['leveraged-etfs.json']=leveraged).findings.find(f=>f.tab==='levetf');
check(/1 published idea and 1 watch candidate.*TESTX/.test(roster.detail),'Production leveraged ideas/etf contract reaches the report');
const stock=original.findings.find(f=>f.tab==='stocks');
check(stock.detail.includes('2 published ideas')&&stock.detail.includes('BULL'),'Stock candidates use their actual contract');
const missingRoster=test(f=>f.payloads['leveraged-etfs.json']={builtAtIso:f.builtAtIso}).findings.find(f=>f.tab==='levetf');
check(missingRoster.title==='Roster unavailable','Missing roster field is not a verified zero');
const missingQuote=test(f=>delete f.payloads['unified-signal.json'].decisions[0].quote.validUntil);
check(!missingQuote.ideas[0].policyCurrent,'Missing quote expiry cannot inherit snapshot approval');
const expiredQuote=test(f=>f.payloads['unified-signal.json'].decisions[0].quote.validUntil='2026-10-23T15:04:00Z');
check(!expiredQuote.ideas[0].policyCurrent&&expiredQuote.ideas[0].suggestion.startsWith('Reference'),'Expired quote downgrades qualification');
const closingQuote=test(f=>f.payloads['unified-signal.json'].decisions[0].quote.validUntil='2026-10-23T15:06:00Z');
check(display.ideaCurrent(closingQuote.ideas[0],now),'Unexpired row remains current');
check(!display.ideaCurrent(closingQuote.ideas[0],now+60000),'Quote expiry is exclusive at the exact boundary');
check(display.expiryKey(closingQuote,now)!==display.expiryKey(closingQuote,now+60000),'Open browser reacts to row expiry before report expiry');
check(!original.findings.some(f=>f.detail.includes('approval is still')),'Saved findings never assert a live approval');
const bottom=test(f=>f.payloads['bottom-tracker.json'].asOf='2026-09-01');
check(!bottom.findings.some(f=>f.tab==='bottom-tracker'),'Fresh envelope cannot refresh an old recovery observation');
check(bottom.coverage.find(s=>s.id==='bottom-tracker').asOf==='2026-09-01','Original observation date is preserved');
check(sourceStatus({builtAtIso:fixture.builtAtIso,generatedAtIso:fixture.builtAtIso,asOf:null},now).status==='undated','Explicit unknown observation date stays unknown');
const history=test(f=>f.payloads['historical-data.json'].sourceBuiltAtIso='2026-09-01T12:00:00Z');
check(history.coverage.find(s=>s.id==='historical-data').status==='stale','Historical source cutoff cannot be refreshed by its wrapper');
const dispersion=test(f=>f.payloads['quant.json']={builtAtIso:f.builtAtIso,dispersion:{idxIv:20,basketIv:35,impliedCorr:.33,names:30,histN:40,pctile:70}});
check(dispersion.findings.find(f=>f.tab==='quant').detail.includes('dispersion proxy: 1'),'Singleton dispersion screen is retained');
const rawCalendar=buildCalendarPayload({},[],fixture.builtAtIso,{companyCalendar:{events:[]},reportEvents:[{type:'report',title:'Synthetic CPI',date:'2026-10-23',actual:'0.0%',consensus:'0.1%'}],fomcMeetings:[{date:'2026-10-28'}]});
rawCalendar.events.push({type:'earnings',symbol:'TEST',date:'2026-10-23',session:'PM'});
const cal=ownerBriefCalendar(rawCalendar,fixture.builtAtIso,[{title:'Synthetic CPI',date:'2026-10-23',actual:'0.0%'}]);
const signals=gatherBriefSignals('intraday',{now:new Date(fixture.builtAtIso),calendar:cal});
check(signals.events.some(e=>e.label==='TEST earnings'),'Published Calendar earnings reach the fallback card');
check(signals.events.some(e=>e.label==='FOMC decision'),'Published Calendar FOMC reaches the fallback card');
check(signals.events.some(e=>e.label==='Synthetic CPI'),'Published macro reports reach the fallback card');
check(signals.releases[0].actual==='0.0%','Zero-valued published releases are preserved');
for(const [label,mutate]of [
 ['null scenario path',p=>p.scenarios[0].paths=[null]],
 ['malformed foundation',p=>p.publicRead.indexes={}],
 ['malformed nested movers',p=>p.publicCore.movers={gainers:[null]}],
 ['invalid reasons',p=>p.publicRead.watchlist=[{sym:'TEST',reasons:{text:'bad'}}]],
 ['malformed support',p=>p.ideas[0].support=[{}]],
 ['invalid coverage',p=>p.coverage=[null]],
 ['missing timestamp',p=>delete p.validUntil],
]){const p=structuredClone(original);mutate(p);check(!display.valid(p),'Reject before rendering: '+label);}
const oldPublic=test(f=>f.payloads['briefs.json'].current.date='2026-10-22');
check(oldPublic.publicRead===null,'Prior-session prose cannot be called the current foundation');
const missingPublicDate=test(f=>{delete f.payloads['briefs.json'].current.generatedAtIso;f.payloads['briefs.json'].current.builtAtIso=f.builtAtIso;});
check(missingPublicDate.publicRead===null,'A missing generation time cannot create invalid report expiry');
const resolved=test(f=>{const c=f.payloads['earnings-forecast.json'].companies[0];c.forecast.id='resolved';c.evaluations=[{runId:'resolved',firstSeenAt:'2026-10-22T12:00:00Z'}];});
check(resolved.forecasts.length===0,'A resolved forecast cannot be an upcoming expectation');
for(const mutate of [f=>f.payloads['earnings-forecast.json'].enabled=false,f=>delete f.payloads['earnings-forecast.json'].companies[0].forecast.currency,f=>delete f.payloads['earnings-forecast.json'].companies[0].forecast.target])check(test(mutate).forecasts.length===0,'Disabled or incomplete forecast withheld');
const emptyCounts=test(f=>delete f.payloads['leverage-distress.json'].hotFunds.counts);
check(emptyCounts.findings.find(f=>f.tab==='forced-liquidation'&&f.source==='Leverage distress').title.includes('needs review'),'Unknown leverage pressure is not zero');
const deadline=test(f=>f.publicScan.sources=[{label:'Heatmap',asOf:new Date(now-29.5*3600000).toISOString(),maxHours:30}]);
check(Date.parse(deadline.validUntil)===now+0.5*3600000,'Public desk age contributes to report expiry');
check(display.expired(original,Date.parse(original.validUntil)),'Report expiry is exclusive');
const malformedUnified=test(f=>f.payloads['unified-signal.json'].decisions=[null]);
check(malformedUnified.ideas.length===0&&malformedUnified.coverage.find(s=>s.id==='unified-signal-engine').status==='invalid','Malformed source decisions are withheld at the owning boundary');
const malformedPublic=test(f=>f.payloads['briefs.json'].current.indexes={});
check(malformedPublic.publicRead===null,'Malformed source foundation cannot enter the saved report');
check(display.valid(test(f=>{f.payloads['trends.json'].narratives.push(null);f.payloads['earnings-forecast.json'].companies.push(null);})), 'Malformed source rows cannot abort other desks');
const staleNote=test(f=>{f.payloads['market-analysis.json'].scenarioEngine.builtAtIso='2026-09-01';f.payloads['market-analysis.json'].scenarioEngine.decision={note:'OLD_SCENARIO_NOTE'};});
check(!JSON.stringify(staleNote).includes('OLD_SCENARIO_NOTE'),'Stale scenario instructions cannot leak through the market headline');
const emptyForecast=test(f=>f.payloads['earnings-forecast.json'].companies[0].forecast.outputs={revenue:null,eps:null});
check(emptyForecast.forecasts.length===0,'An unsupported numerical forecast is not a populated expectation');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const name of ['app.js','styles.css','js/streaks.js','js/book-views.js'])check(html.includes(name+'?v='+contentAssetVersion(readFileSync(new URL('../'+name,import.meta.url),'utf8'))),'Shipped cache address matches current contents: '+name);
console.log(`Owner brief data/UI audit: ${checks} production contract and adversarial regression checks passed.`);

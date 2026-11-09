// Offline failover/recovery tests using reviewed issuer URLs and explicit dates.
import assert from 'node:assert/strict';
import { collectFreeNewsSources,ISSUER_NEWS_SOURCES } from '../lib/free-news-sources.mjs';
import { evidenceSourceHealth } from '../lib/news-evidence.mjs';
import { calendarHealth,calendarScheduleFallbackUsable } from '../lib/calendar-policy.mjs';
import { ismBaselineEvents } from '../lib/calendar-sources.mjs';
import { fetchCompanyCalendar,COMPANY_EVENTS_VERSION } from '../lib/company-events.mjs';
import { buildCalendarPayload,fetchOfficialCalendarEvents } from './build.mjs';
import { UPDATE_FEATURES,inspectFeature } from '../lib/update-checker.mjs';
const now=new Date('2026-11-02T20:42:00Z'),ms=now.getTime();
// The live Lilly feed was dropped 2026-11-07 (HTTP 403 to every build). Its
// reviewed mirror stays as a fixture so the generic failover path is tested.
const source={id:'ir-lly',symbol:'LLY',name:'Eli Lilly',url:'https://investor.lilly.com/rss/news-releases.xml',fallbackUrls:['https://lilly.gcs-web.com/rss/news-releases.xml'],hosts:['investor.lilly.com','lilly.gcs-web.com'],canonicalHost:'investor.lilly.com'};
assert(!ISSUER_NEWS_SOURCES.some(s=>s.symbol==='LLY'),'the blocked Lilly feed is no longer fetched');
const issuerSources=[source];
const primary=source.url,mirror=source.fallbackUrls[0];
const article='/news-releases/news-release-details/lilly-reports-quarterly-results';
const rss=host=>`<rss><channel><item><title>Lilly reports quarterly results and raises guidance</title><pubDate>2026-10-30T12:00:00Z</pubDate><link>https://${host}${article}</link><description>Company financial results.</description></item></channel></rss>`;
const response=(text,status=200)=>new Response(text,{status,headers:{etag:'mirror-etag'}});
const fda=()=>response('{"error":{"code":"NOT_FOUND"}}',404);
const calls=[];
const fallback=await collectFreeNewsSources({issuerSources,universe:['LLY'],now,fetchImpl:async(url,opts)=>{
  calls.push({url,headers:opts.headers});return url.includes('api.fda.gov')?fda():url===primary?response('blocked',403):response(rss('lilly.gcs-web.com'));
}});
assert.equal(calls.length,3,'one primary, one mirror and one FDA request');
assert.equal(fallback.sources['ir-lly'].status,'ok');assert(fallback.sources['ir-lly'].fallback);
assert.equal(fallback.events.length,1);assert.equal(fallback.events[0].link,'https://investor.lilly.com'+article);
assert.equal(fallback.events[0].sourceStatus,'current');
assert(evidenceSourceHealth(fallback).find(s=>s.id==='ir-lly').fallback);
assert.match(inspectFeature(UPDATE_FEATURES.find(s=>s.id==='news'),{builtAtIso:now.toISOString(),sourceHealth:evidenceSourceHealth(fallback)},ms).detail,/alternate official news feed/);
const cached=await collectFreeNewsSources({issuerSources,universe:['LLY'],now:new Date(ms+1000),prior:fallback,fetchImpl:async()=>{throw Error('fresh cache should be reused');}});
assert(cached.sources['ir-lly'].fallback);assert.equal(cached.sources['ir-lly'].checkedAt,now.toISOString());
const outage=await collectFreeNewsSources({issuerSources,universe:['LLY'],now:new Date(ms+2*3600000),prior:fallback,fetchImpl:async url=>url.includes('api.fda.gov')?fda():response('blocked',403)});
assert.equal(outage.sources['ir-lly'].status,'error');assert.equal(outage.events[0].sourceStatus,'carried');
assert.equal(outage.events[0].publishedAt,fallback.events[0].publishedAt);
const recovered=await collectFreeNewsSources({issuerSources,universe:['LLY'],now:new Date(ms+4*3600000),prior:outage,fetchImpl:async url=>url.includes('api.fda.gov')?fda():response(rss('investor.lilly.com'))});
assert.equal(recovered.sources['ir-lly'].fallback,false);assert.equal(recovered.events.length,1);
assert.equal(recovered.events[0].eventId,fallback.events[0].eventId);
assert.equal(recovered.events[0].firstSeenAt,fallback.events[0].firstSeenAt,'failover/recovery never creates a newly observed copy');
const validators=[];
const unchanged=await collectFreeNewsSources({issuerSources,universe:['LLY'],now:new Date(ms+2*3600000),prior:fallback,fetchImpl:async(url,opts)=>{
  validators.push({url,etag:opts.headers['if-none-match']});return url.includes('api.fda.gov')?fda():url===primary?response('blocked',403):new Response(null,{status:304});
}});
assert.equal(validators.find(r=>r.url===primary).etag,undefined,'mirror validators cannot be sent to the primary');
assert.equal(validators.find(r=>r.url===mirror).etag,'mirror-etag');assert.equal(unchanged.sources['ir-lly'].status,'unchanged');
for(const text of ['<html>Access denied</html>',rss('fake.example')]) {
  const bad=await collectFreeNewsSources({issuerSources,universe:['LLY'],now,fetchImpl:async url=>url.includes('api.fda.gov')?fda():url===primary?response('blocked',403):response(text)});
  assert.equal(bad.sources['ir-lly'].status,'error','invalid mirror content never establishes coverage');
}

const start=Date.parse('2026-11-02'),end=Date.parse('2026-12-31');
const originalFetch=globalThis.fetch;
let official;
try {
  globalThis.fetch=async()=>({ok:false,status:403});
  official=await fetchOfficialCalendarEvents(start,end,{nowMs:ms});
} finally {globalThis.fetch=originalFetch;}
assert.equal(official.status['ism-2026'],false,'primary failure stays recorded');
assert(official.events.some(e=>e.subtype==='ism-services' && e.date==='2026-11-04' && e.scheduleFallback && !e.stale));
const calendar=buildCalendarPayload({},[],now.toISOString(),{companyCalendar:{events:[],status:{}},officialCalendar:{...official,status:{'ism-2026':false}}});
assert.equal(calendarHealth(calendar,ms).warnings.length,0);assert.match(calendarHealth(calendar,ms).notices.join(' '),/live check unavailable.*verified 2026-10-28/);
assert.equal(inspectFeature(UPDATE_FEATURES.find(s=>s.id==='calendar'),calendar,ms).status,'available');
assert(ismBaselineEvents(2026,ms).every(e=>e.actual==null && e.consensus==null),'schedule fallback cannot create report figures');
assert.deepEqual(ismBaselineEvents(2027,ms),[],'no extrapolation into an unpublished edition');
assert(!calendarScheduleFallbackUsable('2026-02-31',ms,'2026-12-31'));
assert(!calendarScheduleFallbackUsable('2026-11-03',ms,'2026-12-31'));
const expiredMs=Date.parse('2026-11-28T12:00:00Z');
assert(ismBaselineEvents(2026,expiredMs).every(e=>e.stale));
assert(calendarHealth({...calendar,builtAtIso:new Date(expiredMs).toISOString()},expiredMs).warnings.some(w=>w.includes('ISM')));
const stalePrior={type:'report',subtype:'ism-services',title:'ISM Services PMI',date:'2026-11-05',official:true,sourceKey:'ism-2026'};
const retained=buildCalendarPayload({},[],now.toISOString(),{companyCalendar:{events:[],status:{}},officialCalendar:{...official,status:{'ism-2026':false}},priorCalendar:{events:[stalePrior]}});
assert(calendarHealth(retained,ms).warnings.some(w=>w.includes('ISM')),'unknown-age prior schedules cannot hide behind the baseline fallback');
const verified=buildCalendarPayload({},[],now.toISOString(),{companyCalendar:{events:[],status:{}},officialCalendar:{...official,status:{'ism-2026':false}},priorCalendar:{events:[{...stalePrior,scheduleVerifiedAt:'2026-11-01'}]}});
assert(verified.events.some(e=>e.date==='2026-11-05' && e.scheduleFallback && !e.stale),'recent publisher reschedules take priority');
assert(!verified.events.some(e=>e.subtype==='ism-services' && e.date==='2026-11-04'));
const newerPrior=buildCalendarPayload({},[],new Date(expiredMs).toISOString(),{companyCalendar:{events:[],status:{}},officialCalendar:{events:ismBaselineEvents(2026,expiredMs),status:{'ism-2026':false},fallbacks:official.fallbacks},priorCalendar:{events:ismBaselineEvents(2026,expiredMs).filter(e=>e.date>='2026-11-28').map(e=>({...e,baseline:false,stale:false,scheduleVerifiedAt:'2026-11-25'}))}});
assert.equal(newerPrior.coverage.officialFallbacks['ism-2026'].verifiedAt,'2026-11-25','last successful dated publisher check can supersede the packaged baseline');
assert.equal(calendarHealth(newerPrior,expiredMs).warnings.length,0);

const company=await fetchCompanyCalendar({symbols:['SNOW'],startMs:start,cutoffMs:end,nowMs:ms,fetchImpl:async()=>({ok:false,status:403})});
assert(company.events.some(e=>e.date==='2026-11-03' && e.endDate==='2026-11-06' && e.scheduleFallback && !e.stale));
const companyPayload=buildCalendarPayload({},[],now.toISOString(),{companyCalendar:company});
assert(calendarHealth(companyPayload,ms).notices.some(n=>n.includes('Company-event')));
const msftUrl='https://sponsor.microsoft.com/';
const oldCompany=await fetchCompanyCalendar({symbols:['MSFT'],startMs:start,cutoffMs:end,nowMs:ms,prior:{version:COMPANY_EVENTS_VERSION,checks:{[msftUrl]:{status:'loaded',checkedAtIso:'2026-09-01T00:00:00Z'}},events:[{companyEvent:true,symbol:'MSFT',id:'msft-ignite-2026',sourceUrl:msftUrl,date:'2026-11-17',endDate:'2026-11-20',verifiedAt:'2026-09-01'}]},fetchImpl:async()=>({ok:false,status:403})});
assert(oldCompany.events.every(e=>e.stale),'expired company dates are explicitly stale');
assert(calendarHealth({...companyPayload,events:oldCompany.events},ms).warnings.some(w=>w.includes('expired')));
console.log('Source fallbacks passed: official mirror, validators, cache/recovery identity, invalid feeds, finite ISM edition, expiry, reschedules and company-event dates.');

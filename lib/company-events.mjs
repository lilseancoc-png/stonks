// Explicit issuer-published dates. Never repeat last year's date as a forecast.
// Sources were checked on 2026-10-28; future editions need their own evidence.
export const COMPANY_EVENTS_VERSION = 1;
export const COMPANY_EVENT_LOOKBACK_DAYS = 90;
const verifiedAt = '2026-10-28';
const apple = 'https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/';
const aws = 'https://aws.amazon.com/events/reinvent/faqs/';
const nvidia = 'https://www.nvidia.com/gtc/dc/faq/';
export const PUBLISHED_COMPANY_EVENTS = [
  { id:'aapl-iphone-duo-announcement-2026',symbol:'AAPL',title:'iPhone Duo announcement',date:'2026-09-09',category:'launch',sourceUrl:apple },
  { id:'aapl-iphone-duo-preorders-2026',symbol:'AAPL',title:'iPhone Duo pre-orders open',date:'2026-10-16',time:'08:00 ET',category:'launch',sourceUrl:apple },
  { id:'aapl-iphone-duo-release-2026',symbol:'AAPL',title:'iPhone Duo release · U.S. and initial markets',date:'2026-10-23',category:'launch',sourceUrl:apple },
  { id:'aapl-iphone-duo-expansion-2026',symbol:'AAPL',title:'iPhone Duo release · 28 additional markets',date:'2026-10-30',category:'launch',sourceUrl:apple },
  { id:'orcl-ai-world-2026',symbol:'ORCL',title:'Oracle AI World · Las Vegas',date:'2026-10-25',endDate:'2026-10-28',category:'conference',sourceUrl:'https://www.oracle.com/ai-world/' },
  { id:'msft-ignite-2026',symbol:'MSFT',title:'Microsoft Ignite',date:'2026-11-17',endDate:'2026-11-20',category:'conference',sourceUrl:'https://sponsor.microsoft.com/' },
  { id:'amzn-reinvent-2026',symbol:'AMZN',title:'AWS re:Invent · Las Vegas',date:'2026-11-30',endDate:'2026-12-04',category:'conference',sourceUrl:aws },
  { id:'amzn-reinvent-ceo-keynote-2026',symbol:'AMZN',title:'AWS re:Invent CEO keynote',date:'2026-12-01',time:'11:30 ET',category:'conference',sourceUrl:'https://aws.amazon.com/blogs/apn/know-before-you-go-an-aws-partners-guide-to-reinvent-2026/' },
  { id:'nvda-gtc-dc-2026',symbol:'NVDA',title:'NVIDIA GTC Washington, D.C. · conference and expo',date:'2026-12-01',endDate:'2026-12-03',category:'conference',sourceUrl:nvidia },
  { id:'nvda-gtc-dc-keynote-2026',symbol:'NVDA',title:'NVIDIA GTC · Jensen Huang keynote',date:'2026-12-01',time:'14:00 ET',category:'conference',sourceUrl:nvidia },
  { id:'snow-expedition-2026',symbol:'SNOW',title:'Snowflake Expedition · regional livestreams',date:'2026-11-03',endDate:'2026-11-06',category:'conference',sourceUrl:'https://www.snowflake.com/en/expedition/' },
  { id:'crm-dreamforce-2026',symbol:'CRM',title:'Salesforce Dreamforce',date:'2026-09-15',endDate:'2026-09-17',category:'conference',sourceUrl:'https://www.salesforce.com/dreamforce/register/' },
].map(e => ({ ...e,type:'catalyst',official:true,companyEvent:true,importance:'high',confidence:'high',
  source:'Company schedule',sourceKey:'company-'+e.symbol,verifiedAt }));

export function companyEventsInWindow(events, symbols, startMs, cutoffMs) {
  const tracked = new Set(symbols), floor = startMs - COMPANY_EVENT_LOOKBACK_DAYS * 86400000;
  return events.filter(e => tracked.has(e.symbol) && Date.parse((e.endDate || e.date)+'T00:00:00Z') >= floor && Date.parse(e.date+'T00:00:00Z') <= cutoffMs);
}

// Parse only explicit Schema.org Event objects, with an explicit year and zone.
// Date-only strings retain the issuer's calendar date. Zoned instants use ET.
export function parseIssuerEvents(html, {symbol,sourceUrl}) {
  const out = [];
  const dateParts = raw => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw || '')) {
      const ms=Date.parse(raw+'T00:00:00Z');
      return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===raw ? {date:raw} : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw || '')) return null;
    const d=new Date(raw); if(!Number.isFinite(d.getTime())) return null;
    return {date:d.toLocaleDateString('en-CA',{timeZone:'America/New_York'}),time:d.toLocaleTimeString('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'})+' ET'};
  };
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value!=='object') return;
    const types=[].concat(value['@type'] || []);
    if (types.some(t=>/^(?:Event|BusinessEvent|EducationEvent)$/.test(String(t).split(/[\/#]/).pop()))) {
      const start=dateParts(value.startDate), end=dateParts(value.endDate);
      const title=String(value.name || '').replace(/<[^>]*>/g,'').trim();
      // Keep market-relevant issuer events, not every local training webinar.
      if (start && title && /conference|investor day|analyst day|keynote|\bignite\b|re:invent|\bgtc\b|dreamforce|product launch|iphone|expedition|ai world/i.test(title)) {
        out.push({type:'catalyst',symbol,title,...start,...(end && end.date>start.date?{endDate:end.date}:{}),
          companyEvent:true,official:true,importance:'high',category:/iphone|product launch/i.test(title)?'launch':'conference',
          source:'Company schedule',sourceKey:'company-'+symbol,sourceUrl,
          issuerStatus:/(?:EventCancelled|EventPostponed)$/.test(value.eventStatus || '')?'cancelled':'scheduled'});
      }
    }
    if (value['@graph']) visit(value['@graph']);
    if (value.itemListElement) visit(value.itemListElement);
    if (value.item) visit(value.item);
  };
  for(const block of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(block[1])); } catch { /* invalid metadata cannot establish a schedule */ }
  }
  return out;
}

export async function fetchCompanyCalendar({symbols,startMs,cutoffMs,prior=null,fetchImpl=fetch,nowMs=Date.now()}) {
  const seeds=companyEventsInWindow(PUBLISHED_COMPANY_EVENTS,symbols,startMs,cutoffMs);
  const urls=[...new Set(seeds.map(e=>e.sourceUrl))], status={}, checks={};
  let events=[...seeds], next=0;
  let cancellations=prior?.version===COMPANY_EVENTS_VERSION ? [...(prior.cancellations || [])] : [];
  // Preserve previously observed reschedules and cancellations through outages.
  if(prior?.version===COMPANY_EVENTS_VERSION && Array.isArray(prior.events)) {
    for(const url of urls) if(prior.checks?.[url]) events=events.filter(e=>e.sourceUrl!==url).concat(prior.events.filter(e=>e.sourceUrl===url));
  }
  await Promise.all(Array.from({length:Math.min(4,urls.length)},async()=>{
    while(next<urls.length) {
      const url=urls[next++], rows=seeds.filter(e=>e.sourceUrl===url), previous=prior?.version===COMPANY_EVENTS_VERSION ? prior.checks?.[url] : null;
      if(previous && nowMs-Date.parse(previous.checkedAtIso)>=0 && nowMs-Date.parse(previous.checkedAtIso)<86400000 && previous.status==='loaded') {
        checks[url]=previous; status[url]='loaded';
        const previousEvents=prior.events?.filter(e=>e.sourceUrl===url) || [];
        events=events.filter(e=>e.sourceUrl!==url).concat(previousEvents);
        continue;
      }
      try {
        const res=await fetchImpl(url,{headers:{'user-agent':'Mozilla/5.0',accept:'text/html'},signal:AbortSignal.timeout(10000)});
        if(!res.ok) throw new Error('HTTP '+res.status);
        const html=await res.text();
        if(html.length<1500 || /captcha_form|access denied|verify you are human/i.test(html)) throw new Error('Source unavailable');
        const parsed=parseIssuerEvents(html,{symbol:rows[0].symbol,sourceUrl:url});
        // Structured issuer metadata can replace a known event's dates or
        // cancel it. Unmatched published rows remain dated, verified records.
        for(const event of parsed) {
          const normalize=s=>s.toLowerCase().replace(/\b20\d{2}\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
          const matching=rows.find(r=>r.date.slice(0,4)===event.date.slice(0,4) && normalize(r.title.split(' · ')[0])===normalize(event.title));
          events=events.filter(e=>!(matching && e.id===matching.id) && !(e.sourceUrl===url && e.date.slice(0,4)===event.date.slice(0,4) && normalize(e.title)===normalize(event.title)));
          if(event.issuerStatus==='cancelled') {
            cancellations.push({...event,...(matching?{id:matching.id}:{}),companyEvent:true});
            if(matching) cancellations.push(matching);
          } else {
            cancellations=cancellations.filter(e=>matching ? e.id!==matching.id : !(e.symbol===event.symbol && e.title===event.title));
            events.push({...event,...(matching?{id:matching.id}:{}),verifiedAt:new Date(nowMs).toISOString().slice(0,10)});
          }
        }
        status[url]='loaded';
        events=events.map(e=>e.sourceUrl===url ? {...e,sourceCheckFailed:false} : e);
      } catch {
        status[url]='unavailable';
        events=events.map(e=>e.sourceUrl===url?{...e,sourceCheckFailed:true}:e);
      }
      checks[url]={status:status[url],checkedAtIso:new Date(nowMs).toISOString()};
    }
  }));
  return {version:COMPANY_EVENTS_VERSION,events:companyEventsInWindow(events,symbols,startMs,cutoffMs),cancellations:companyEventsInWindow([...new Map(cancellations.map(e=>[e.sourceUrl+'|'+e.symbol+'|'+e.title+'|'+e.date,e])).values()],symbols,startMs,cutoffMs),status,checks};
}

// Prefer the publisher's known span over the same event re-extracted from news.
export function coveredByCompanySchedule(event, events) {
  if(event.type!=='catalyst' || event.companyEvent) return false;
  const normalized=s=>String(s).toLowerCase().replace(/\b20\d{2}\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  return events.some(known=>known.companyEvent && known.symbol===event.symbol && event.date>=known.date && event.date<=(known.endDate || known.date) &&
    /keynote/i.test(event.title)===/keynote/i.test(known.title) && normalized(event.title).includes(normalized(known.title.split(' · ')[0])));
}

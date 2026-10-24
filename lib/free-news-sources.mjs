import { parseNewsRss } from "./news-rss.mjs";
import { newsDateIsCurrent } from "./news-policy.mjs";
import { reconcileNewsEvidence, evidenceRevision } from "./news-evidence.mjs";
const DAY = 86400000;
const SOURCE_POLICY_VERSION = 2;
// Reviewed official RSS endpoints. Coverage is deliberately explicit and is
// always intersected with TICKERS, never SECTORS or third-party related tickers.
export const ISSUER_NEWS_SOURCES = Object.freeze([
  {id:"ir-aapl",symbol:"AAPL",name:"Apple",url:"https://www.apple.com/newsroom/rss-feed.rss",hosts:["www.apple.com","apple.com"]},
  {id:"ir-nvda",symbol:"NVDA",name:"NVIDIA",url:"https://nvidianews.nvidia.com/cats/press_release.xml",hosts:["nvidianews.nvidia.com"]},
  {id:"ir-amd",symbol:"AMD",name:"AMD",url:"https://ir.amd.com/news-events/press-releases/rss",hosts:["ir.amd.com"]},
  {id:"ir-intc",symbol:"INTC",name:"Intel",url:"https://www.intc.com/news-events/press-releases/rss",hosts:["www.intc.com"]},
  {id:"ir-lly",symbol:"LLY",name:"Eli Lilly",url:"https://investor.lilly.com/rss/news-releases.xml",hosts:["investor.lilly.com"]},
]);
// Exact applicant mapping verified against Drugs@FDA. Other sponsors/studies
// are deliberately skipped until their issuer/rights mapping is reviewed.
export const FDA_SPONSORS = Object.freeze([{symbol:"LLY",sponsor:"ELI LILLY AND CO"}]);
const ROUTINE = /\b(?:to (?:report|announce|present)|sets? (?:a )?date|announces? (?:the )?date|participat(?:e|es|ion)|to speak|named (?:a |to )|awards? for|recognized|recognition|celebrat|sustainability|donation|philanthrop|conference attendance)\b/i;
const MATERIAL = [
  ["earnings",/\b(?:reports?|announces?)\b.{0,65}\b(?:financial results|quarterly results|year[- \w]{0,25}results|earnings|revenue|net (?:income|profit))\b|\b(?:raises?|lowers?|cuts?|withdraws?|updates?)\b.{0,40}\b(?:guidance|outlook)\b/i],
  ["financing",/\b(?:offering|notes? issuance|debt financing|share repurchase|buyback|dividend (?:increase|cut|suspension))\b|\b(?:increases?|cuts?|suspends?)\b.{0,35}\bdividend\b/i],
  ["agreement",/\b(?:acquisition|acquires?|merger|definitive agreement|supply agreement|awarded|contract win|contract termination)\b/i],
  ["regulatory",/\b(?:fda approval|fda approves|recall|recalls)\b|\b(?:receives?|receiv(?:ed|ing)|grants?|granted)\b.{0,65}\b(?:approval|expanded indication)\b.{0,40}\b(?:fda|regulator)\b/i],
  ["clinical",/\b(?:clinical trial results|phase (?:[23](?:b)?|ii|iii) results)\b/i],
  ["leadership",/\b(?:ceo|cfo|chief executive|chief financial officer)\b.{0,35}\b(?:resigns?|steps? down|departs?|appoints?|appointed)\b|\b(?:appoints?|appointed|names?|named)\b.{0,80}\b(?:ceo|cfo|chief executive|chief financial officer)\b/i],
];
export function issuerEventClass(title) {
  // A reported endpoint outcome can itself say "first to report". That is
  // different from an issuer announcing when it will publish future results.
  if (/\b(?:meets?|met|achieved|fails?|failed|miss(?:es|ed)?)\b.{0,40}\b(?:primary|secondary) endpoint\b/i.test(title)) return "clinical";
  if (ROUTINE.test(title)) return null;
  // Generic collaboration announcements remain excluded. An explicit
  // commercial deployment quantity makes this narrower partnership eligible.
  if (/\b(?:strategic partnership|supply agreement)\b/i.test(title) && /\b(?:deploy|purchase|supply|buy)\b.{0,30}\b\d+(?:\.\d+)?\s*(?:giga|mega)watts?\b/i.test(title)) return "agreement";
  return MATERIAL.find(([,re])=>re.test(title))?.[0] || null;
}
function allowedLink(link, hosts) {
  try {const u=new URL(link);return u.protocol === "https:" && hosts.includes(u.hostname) ? u.href : null;}catch{return null;}
}
export function parseIssuerNews(xml, source, universe, now = Date.now()) {
  if (!universe.includes(source.symbol)) return {events:[],rejected:0};
  const rows=parseNewsRss(xml,100);
  if(!rows.length)throw new Error("No parseable RSS/Atom entries");
  if(!rows.some(r=>allowedLink(r.link,source.hosts) && Number.isFinite(Date.parse(r.publishedAt))))throw new Error("Feed has no dated official article links");
  const events=new Map();
  for(const r of rows){
    const eventClass=issuerEventClass(r.title);
    const link=allowedLink(r.link,source.hosts);
    if(!link)continue;
    const canonical=new URL(link);
    canonical.hash="";
    for(const key of [...canonical.searchParams.keys()])if(/^utm_/i.test(key))canonical.searchParams.delete(key);
    canonical.searchParams.sort();
    const articleLink=canonical.href;
    const eventId=`${source.id}:${evidenceRevision({title:articleLink})}`;
    if(!eventClass || !link || !newsDateIsCurrent(r.publishedAt,now))continue;
    if(events.get(eventId)?.publishedAt >= r.publishedAt)continue;
    events.set(eventId,{eventId,kind:"issuer-announcement",sourceKind:"issuer",symbols:[source.symbol],publisher:source.name+" · company announcement",title:r.title,publishedAt:r.publishedAt,link:articleLink,excerpt:r.description.slice(0,600),facts:{eventClass}});
  }
  return {events:[...events.values()],rejected:rows.length-events.size,partial:(xml.match(/<item\b|<entry\b/gi)||[]).length>100};
}
function isoDay(value) {
  const raw=String(value || "").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
  const t=Date.parse(raw+"T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === raw ? raw : null;
}
function number(value) {return typeof value === "number" && Number.isFinite(value) ? value : null;}
function economicEvent(id, release, period, current, previous, units, symbols, link, now) {
  const releaseDay=isoDay(release), periodDay=isoDay(period);
  if(!releaseDay || !periodDay || current == null || previous == null || current < 0 || previous < 0 || !symbols.length) return [];
  const today=new Date(now).toISOString().slice(0,10);
  if(releaseDay>today || periodDay>releaseDay || Date.parse(releaseDay)-Date.parse(periodDay)>14*DAY || now-Date.parse(releaseDay)>10*DAY) return [];
  return [{eventId:`eia:${id}:${periodDay}`,kind:"economic-release",sourceKind:"official",symbols,publisher:"EIA",publishedAt:releaseDay+"T12:00:00Z",dateOnly:true,link,
    title:`${id === "crude" ? "Commercial crude inventories excluding SPR" : "Lower 48 working natural-gas storage"}: ${current.toLocaleString("en-US")} ${units}; weekly change ${current-previous>=0?"+":""}${(current-previous).toLocaleString("en-US")} ${units} (week ending ${periodDay})`,
    facts:{series:id === "crude" ? "WCESTUS1" : "NW2_EPG0_SWO_R48_BCF",period:periodDay,releaseDate:releaseDay,actual:current,previous,change:current-previous,units,comparison:"previous-week",consensus:null,surprise:null}}];
}
export function parseEiaCrude(json, universe, now = Date.now()) {
  const series=json?.data?.["U.S."];
  if(series?.sourcekey !== "WCESTUS1" || series.units !== "thousand barrels") throw new Error("Unexpected EIA crude series/units");
  if(!Array.isArray(series.time_series) || series.time_series.some(r=>!r || !isoDay(r.date)))throw new Error("Invalid EIA observation dates");
  const rows=[...series.time_series].sort((a,b)=>b.date.localeCompare(a.date));
  // Do not skip a suppressed latest row and silently publish an older value.
  const [cur,prior]=rows;
  if(!cur || !prior || cur.suppression_flag != null || prior.suppression_flag != null || Date.parse(cur.date)-Date.parse(prior.date)!==7*DAY)throw new Error("Missing/suppressed EIA weekly observations");
  if(number(cur.value)==null || number(prior.value)==null)throw new Error("Non-numeric EIA crude observation");
  const events=economicEvent("crude",json.metadata?.release_date,cur.date,cur.value,prior.value,"thousand barrels",universe.filter(s=>s==="USO"),"https://www.eia.gov/petroleum/supply/weekly/",now);
  if(universe.includes("USO") && !events.length)throw new Error("Stale/future EIA crude release");
  return {events,rejected:0};
}
export function parseEiaGas(json, universe, now = Date.now()) {
  const s=json?.series?.find(s=>s.series_id==="png.nw2_epg0_swo_r48_bcf.w");
  if(!s || s.units!=="billion cubic feet")throw new Error("Unexpected EIA gas series/units");
  const current=isoDay(json.current_week), prior=isoDay(json.week_ago);
  if(!current || !prior || Date.parse(current)-Date.parse(prior)!==7*DAY)throw new Error("Invalid EIA gas weeks");
  const curIndex=s.data?.findIndex(r=>r[0]===current), priorIndex=s.data?.findIndex(r=>r[0]===prior);
  if(!(curIndex>=0) || !(priorIndex>=0))throw new Error("Missing EIA gas observations");
  const release=String(json.release_date || "").match(/^(\d{4})-([A-Za-z]{3})-(\d{2})/);
  const month=release ? ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(release[2])+1 : 0;
  if(!month)throw new Error("Invalid EIA gas release date");
  if(number(s.data[curIndex][1])==null || number(s.data[priorIndex][1])==null)throw new Error("Non-numeric EIA gas observation");
  const events=economicEvent("gas",`${release[1]}-${String(month).padStart(2,"0")}-${release[3]}`,current,s.data[curIndex][1],s.data[priorIndex][1],"billion cubic feet",universe.filter(s=>s==="VST"),"https://ir.eia.gov/ngs/ngs.html",now);
  if(universe.includes("VST") && !events.length)throw new Error("Stale/future EIA gas release");
  return {events,rejected:0};
}
export function parseFdaApprovals(json, mapping, universe, now = Date.now()) {
  if(!universe.includes(mapping.symbol))return {events:[],rejected:0};
  if(!Array.isArray(json?.results))throw new Error("Invalid Drugs@FDA result");
  const events=[];
  for(const app of json.results){
    if(app.sponsor_name!==mapping.sponsor || !/^(?:NDA|BLA)\d+$/.test(app.application_number || ""))continue;
    for(const sub of app.submissions || []){
      const d=String(sub.submission_status_date || "");
      const date=/^\d{8}$/.test(d) ? isoDay(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`) : null;
      if(!/^\d+$/.test(String(sub.submission_number || "")) || sub.submission_type!=="ORIG" || sub.submission_status!=="AP" || !date || !newsDateIsCurrent(date,now,7))continue;
      const names=[...new Set((app.products || []).map(p=>p.brand_name).filter(Boolean))];
      if(!names.length)continue;
      events.push({eventId:`fda:${app.application_number}:ORIG:${sub.submission_number}`,kind:"regulatory-action",sourceKind:"official",symbols:[mapping.symbol],publisher:"FDA",publishedAt:date+"T12:00:00Z",dateOnly:true,
        title:`FDA records original approval for ${names.join(", ")} (${mapping.symbol})`,link:`https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${app.application_number.replace(/\D/g,"")}`,
        facts:{action:"original-approval",applicationNumber:app.application_number,sponsor:app.sponsor_name,products:names,actionDate:date}});
    }
  }
  return {events,rejected:json.results.length-new Set(events.map(e=>e.facts.applicationNumber)).size,partial:(json.meta?.results?.total || 0)>json.results.length};
}
async function limitedText(res) {
  if(Number(res.headers.get("content-length"))>2_000_000)throw new Error("Response exceeds byte budget");
  if(!res.body?.getReader){const t=await res.text();if(t.length>2_000_000)throw new Error("Response exceeds byte budget");return t;}
  const reader=res.body.getReader();let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw new Error("Response exceeds byte budget");}parts.push(value);}}finally{reader.releaseLock();}
  return new TextDecoder().decode(Buffer.concat(parts));
}
export async function collectFreeNewsSources({universe,prior=null,fetchImpl=fetch,now=new Date(),fdaApiKey=process.env.OPENFDA_API_KEY || ""}) {
  const nowMs=now.getTime();
  // Persisted JSON is an external boundary too. Discard a corrupt cache and
  // refetch rather than allowing a malformed historical row to abort the bake.
  const validEvent=e=>e && typeof e.eventId==="string" && typeof e.sourceId==="string" && typeof e.title==="string" && typeof e.publishedAt==="string" && Array.isArray(e.symbols) && e.symbols.every(s=>typeof s==="string");
  if(prior?.policyVersion!==SOURCE_POLICY_VERSION || prior?.version!==1 || !Array.isArray(prior.events) || !prior.events.every(e=>validEvent(e) && Array.isArray(e.revisions) && e.revisions.every(r=>r && typeof r.revision==="string")) || !prior.sources || typeof prior.sources!=="object" || Array.isArray(prior.sources)) prior=null;
  if(prior && !Object.values(prior.sources).every(s=>s && Array.isArray(s.events) && s.events.every(e=>validEvent({...e,sourceId:e?.sourceId || "cached"})))) prior=null;
  const sources=ISSUER_NEWS_SOURCES.filter(s=>universe.includes(s.symbol)).map(s=>({...s,ttl:3600000,parse:t=>parseIssuerNews(t,s,universe,nowMs)}));
  if(universe.includes("USO"))sources.push({id:"eia-crude",url:"https://ir.eia.gov/wpsr/psw00.json",hosts:["ir.eia.gov"],ttl:3600000,parse:t=>parseEiaCrude(JSON.parse(t.replace(/^\uFEFF/,"")),universe,nowMs)});
  if(universe.includes("VST"))sources.push({id:"eia-gas",url:"https://ir.eia.gov/ngs/wngsr.json",hosts:["ir.eia.gov"],ttl:3600000,parse:t=>parseEiaGas(JSON.parse(t.replace(/^\uFEFF/,"")),universe,nowMs)});
  for(const mapping of FDA_SPONSORS.filter(m=>universe.includes(m.symbol))){
    const to=now.toISOString().slice(0,10).replace(/-/g,""), from=new Date(nowMs-7*DAY).toISOString().slice(0,10).replace(/-/g,"");
    const u=new URL("https://api.fda.gov/drug/drugsfda.json");
    u.searchParams.set("search",`sponsor_name.exact:"${mapping.sponsor}" AND submissions.submission_status_date:[${from} TO ${to}]`);u.searchParams.set("limit","100");
    if(fdaApiKey)u.searchParams.set("api_key",fdaApiKey);
    sources.push({id:`fda-${mapping.symbol.toLowerCase()}`,url:u.href,hosts:["api.fda.gov"],ttl:6*3600000,fda:true,parse:t=>parseFdaApprovals(JSON.parse(t),mapping,universe,nowMs)});
  }
  const states={};
  // Deliberately small registry, at most eight requests per eligible build.
  // Two concurrent requests; retries wait for the next normal build.
  let cursor=0;
  async function worker(){while(cursor<sources.length){const s=sources[cursor++],cached=prior?.sources?.[s.id],old=Array.isArray(cached?.events)?cached:null;
    if(old && newsDateIsCurrent(old.checkedAt,nowMs,1) && nowMs-Date.parse(old.checkedAt)<(old.status==="error"?30*60000:s.ttl)) {states[s.id]={...old,status:old.status==="error"?"error":"cached"};continue;}
    const checkedAt=now.toISOString();
    try{
      const headers={accept:s.fda||s.id.startsWith("eia")?"application/json":"application/rss+xml, application/atom+xml, text/xml","user-agent":"Stonks official-source reader"};
      if(old?.etag)headers["if-none-match"]=old.etag;
      if(old?.lastModified)headers["if-modified-since"]=old.lastModified;
      const res=await fetchImpl(s.url,{headers,signal:AbortSignal.timeout(10000)});
      if(res.url && !s.hosts.includes(new URL(res.url).hostname))throw new Error("Unexpected redirect host");
      if(res.status===304){if(!old)throw new Error("304 without cached source");states[s.id]={...old,checkedAt,lastSuccessAt:checkedAt,status:"unchanged",error:null};continue;}
      const text=await limitedText(res);
      if(s.fda && res.status===404 && JSON.parse(text)?.error?.code==="NOT_FOUND") {states[s.id]={checkedAt,lastSuccessAt:checkedAt,status:"ok",events:[],rejected:0};continue;}
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const parsed=s.parse(text);
      states[s.id]={...parsed,checkedAt,lastSuccessAt:checkedAt,status:parsed.partial?"partial":"ok",etag:res.headers.get("etag"),lastModified:res.headers.get("last-modified")};
    }catch(err){states[s.id]={...old,checkedAt,status:"error",error:String(err.message).replace(/https?:\/\/\S+/g,"[source]").slice(0,180),events:old?.events || []};}
  }}
  await Promise.all([worker(),worker()]);
  for(const s of sources)states[s.id].label=s.name || (s.id==="eia-crude"?"EIA crude inventories":s.id==="eia-gas"?"EIA natural-gas storage":`FDA · ${s.id.slice(4).toUpperCase()}`);
  const state=reconcileNewsEvidence(prior,states,universe,now);
  state.policyVersion=SOURCE_POLICY_VERSION;
  state.coverage={issuerSymbols:ISSUER_NEWS_SOURCES.filter(s=>universe.includes(s.symbol)).map(s=>s.symbol),fdaSymbols:FDA_SPONSORS.filter(s=>universe.includes(s.symbol)).map(s=>s.symbol),clinicalTrials:"skipped: no reviewed study-to-covered-issuer mapping"};
  return state;
}

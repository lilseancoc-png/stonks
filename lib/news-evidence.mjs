import { createHash } from "node:crypto";
export const NEWS_EVIDENCE_KEY = "news-source-evidence.json";
const DAY = 86400000;
function retainableDate(event, now) {
  const published = Date.parse(event.publishedAt);
  return Number.isFinite(published) && now.getTime() - published <= 30 * DAY && (event.dateOnly
    ? new Date(published).toISOString().slice(0,10) <= now.toISOString().slice(0,10)
    : published <= now.getTime() + 15 * 60000);
}
export function evidenceRevision(event) {
  return createHash("sha256").update(JSON.stringify([event.title,event.publishedAt,event.link,event.facts,event.excerpt])).digest("hex").slice(0,24);
}

// One writer (full bake). No raw HTML, arbitrary issuer discovery, model calls,
// or scoring votes. Each revision retains its own first-observed timestamp.
export function reconcileNewsEvidence(prior, sourceStates, universe, now = new Date()) {
  const allowed = new Set(universe);
  const asOf = now.toISOString();
  const old = new Map((prior?.events || []).map(e => [e.eventId,e]));
  const events = new Map();
  for (const e of old.values()) {
    const symbols=(e.symbols || []).filter(s=>allowed.has(s));
    if(symbols.length && sourceStates[e.sourceId] && retainableDate(e,now)) events.set(e.eventId,{...e,symbols,sourceStatus:"historical"});
  }
  for (const [sourceId,source] of Object.entries(sourceStates)) {
    for (const input of source.events || []) {
      const symbols = (input.symbols || []).filter(s => allowed.has(s));
      if (!symbols.length || !input.eventId || !Number.isFinite(Date.parse(input.publishedAt))) continue;
      if (!retainableDate(input,now)) continue;
      const revision = evidenceRevision(input);
      const before = events.get(input.eventId) || old.get(input.eventId);
      const revisions = [...(before?.revisions || [])];
      if (revisions.at(-1)?.revision !== revision) revisions.push({revision,observedAt:asOf,title:input.title,publishedAt:input.publishedAt,link:input.link,excerpt:input.excerpt || null,facts:input.facts || null});
      events.set(input.eventId, {...input,sourceId,symbols,revision,firstSeenAt:before?.firstSeenAt || asOf,revisions:revisions.slice(-4),contextOnly:true,sourceStatus:source.status === "error" ? "carried" : "current"});
    }
  }
  return {version:1,builtAtIso:asOf,universe:[...allowed].sort(),sources:sourceStates,events:[...events.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))};
}

export function evidenceFeedRows(state) {
  return (state?.events || []).map(e => ({
    eventId:e.eventId,title:e.title,publisher:e.publisher,publishedAt:e.publishedAt,
    link:e.link,firstSeenAt:e.firstSeenAt,recordKind:e.kind,sourceKind:e.sourceKind,
    contextOnly:true,carried:e.sourceStatus !== "current",facts:e.facts || null,
    ...(e.kind === "economic-release" ? {relatedSymbols:e.symbols,desk:"macro",economicRelease:true,dateOnly:true} : {symbol:e.symbols[0],desk:"company",dateOnly:e.dateOnly === true}),
  }));
}

export function evidenceSourceHealth(state) {
  return Object.entries(state?.sources || {}).map(([id,s]) => ({id,label:s.label || id,status:s.status,checkedAt:s.checkedAt,lastSuccessAt:s.lastSuccessAt || null,accepted:s.events?.length || 0,rejected:s.rejected || 0,partial:s.partial === true,error:s.error || null}));
}

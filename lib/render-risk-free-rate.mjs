// Renderer-only rebuilds may have a sparse private-data cache. Preserve a
// newer published rate with its original date, under the usual expiry rule.
export function renderRiskFreeRate({cached=null,embeddedJs='',asOf,maxAgeDays,fallback}) {
  let embedded=null;
  try {
    const rate=Number(embeddedJs.match(/\bvar RFR = ([\d.]+);/)?.[1]);
    const meta=JSON.parse(embeddedJs.match(/\bvar RFR_META = (\{[^\n]+\});/)?.[1]);
    if(['fresh','cached'].includes(meta.source))embedded={rate,asOf:meta.asOf};
  } catch { /* unknown generated format is not a rate source */ }
  const candidates=[cached,embedded].filter(Boolean).flatMap(r=>{
    const date=r.capturedAt||r.asOf,age=(Date.parse(asOf)-Date.parse(date))/86400000;
    return typeof r.rate==='number'&&Number.isFinite(r.rate)&&r.rate>=0&&r.rate<.2&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(age)&&age>=0&&age<=maxAgeDays
      ?[{rate:r.rate,asOf:r.asOf||date,source:age===0?'fresh':'cached',ageDays:age===0?null:age,date}]:[];
  }).sort((a,b)=>b.date.localeCompare(a.date));
  if(!candidates.length)return {rate:fallback,asOf,source:'fallback',ageDays:null};
  const {date,...selected}=candidates[0];return selected;
}

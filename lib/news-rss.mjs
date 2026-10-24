// Bounded RSS/Atom reader for trusted feed endpoints. Never resolves XML entities
// or external resources. Dates and summaries retain separate semantics.
export function decodeNewsText(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/&amp;(?=(?:amp|lt|gt|quot|apos|nbsp);|#)/gi, "&")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, v => ({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'","&nbsp;":" "})[v.toLowerCase()])
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_,h,d) => { const n=parseInt(h||d,h?16:10); return n>=0 && n<=0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}
export function parseNewsRss(xml, max = 30) {
  if (typeof xml !== "string" || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  const blocks=xml.match(/<item\b[^>]*>[\s\S]*?<\/item>|<entry\b[^>]*>[\s\S]*?<\/entry>/gi)||[];
  const out=[];
  for(const block of blocks.slice(0,Math.min(100,max))){
    const field=tag=>(block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))||[])[1]||"";
    const title=decodeNewsText(field("title"));
    const date=decodeNewsText(field("pubDate")||field("published")||field("updated")||field("dc:date"));
    const t=Date.parse(date);
    const tags=block.match(/<link\b[^>]*>/gi)||[];
    const atom=tags.filter(v=>!(/rel=["']self["']/i.test(v))).map(v=>(v.match(/href=["']([^"']+)["']/i)||[])[1]).find(Boolean);
    const rawLink=decodeNewsText(field("link")||atom||"");
    let link=null;
    try {const u=new URL(rawLink);if(u.protocol==="https:"||u.protocol==="http:") link=u.href;}catch{}
    if(title)out.push({title:title.slice(0,500),publishedAt:Number.isFinite(t)?new Date(t).toISOString():null,link,description:decodeNewsText(field("description")||field("summary")||field("content")).slice(0,1500),publisher:decodeNewsText(field("source"))||null,id:decodeNewsText(field("guid")||field("id"))||link});
  }
  return out;
}

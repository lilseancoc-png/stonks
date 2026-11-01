// No raw log lines or payload values leave this boundary. Findings contain
// fixed categories and counts, so credentials and research never enter reports.
import { record, stamp } from './update-checker.mjs';
import { BAKE_REQUIRED_REWRITTEN_FILES } from './publication-outputs.mjs';
import { REQUEST_TIME_EXCLUSIVE_KEYS } from './data-ownership.mjs';
const RULES=[
  ['ai-down',/AI health:\s*DOWN/i,'AI calls failed; cached output may have been reused.'],
  ['ai-degraded',/AI health:\s*DEGRADED/i,'The AI layer reported degraded output.'],
  ['exception',/\b(?:AssertionError|ReferenceError|SyntaxError|TypeError|RangeError)\b|ERR_ASSERTION/,'A program exception appears in the workflow log.'],
  ['annotation',/##\[error\]|::error::/,'GitHub recorded an error annotation.'],
  ['publication',/refusing to publish|freshness.*(?:failed|FAIL)|published object is missing|upload failed/i,'Data publication or integrity verification failed.'],
  ['source',/\[(?:calendar|owner-market-brief|earnings-forecast|party-tracker|historical|news-feed|13f|bottom-tracker|unified-signal|quant)[^\]]*\].*(?:failed|unavailable|incomplete)/i,'A feature producer reported a collection or build failure.'],
  ['execution',/unresolved execution or unavailable check|reconciliation incomplete|orders paused/i,'Stored execution diagnostics require Owner review.'],
];
export function inspectWorkflowLog(text) {
  const findings=[];
  for(const [kind,pattern,detail] of RULES){let count=0;for(const line of text.split('\n'))if(!/##\[group\]|\b(?:echo|console\.log|assert\.)\b/.test(line) && pattern.test(line))count++;if(count)findings.push({kind,detail,count});}
  return {findings};
}
export async function readBoundedText(response,limit=8*1024*1024) {
  if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>limit)throw new Error('Log exceeds diagnostic size limit');return text;}
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit)throw new Error('Log exceeds diagnostic size limit');chunks.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
export async function scanPublishedArtifacts(store,cache,now=Date.now(),limit=4000) {
  const issues=[];let checked=0;
  const publication=store.getPublication?await store.getPublication({fresh:true}):null;
  const entries=publication?Object.entries(publication.manifest.objects).map(([key,item])=>({key,size:item.size})):await store.list('');
  if(entries.length>limit)return {checked:0,total:entries.length,issues:[{key:'inventory',status:'unknown',detail:'Artifact inventory exceeds the scan limit.'}],complete:false};
  const keys=new Set(entries.map(e=>e.key));
  for(const key of BAKE_REQUIRED_REWRITTEN_FILES)if(!keys.has(key))issues.push({key,status:'missing',detail:'A required full-build artifact is absent.'});
  const read=async entry=>{
    if(!/^[A-Za-z0-9_./-]+\.json$/.test(entry.key) || entry.key.includes('..') || entry.key.startsWith('_stonks/'))return;
    const item=publication?.manifest.objects[entry.key];
    if(!cache.has(entry.key))cache.set(entry.key,(async()=>{
      try{
        const bytes=item?await store.rawGet(item.path):await store.get(entry.key);
        if(bytes==null)return {error:'missing'};
        if(bytes.length>32*1024*1024)return {error:'oversized'};
        if(item && bytes.length!==item.size)return {error:'integrity'};
        try{return {payload:JSON.parse(bytes.toString('utf8'))};}catch{return {error:'invalid'};}
      }catch{return {error:'unavailable'};}
    })());
    const {payload,error}=await cache.get(entry.key);checked++;
    if(error){issues.push({key:entry.key,status:error==='missing'?'missing':error==='invalid'?'invalid':'unavailable',detail:'Stored artifact failed its '+error+' check.'});return;}
    if(!record(payload) && !Array.isArray(payload)){issues.push({key:entry.key,status:'invalid',detail:'A stored artifact must contain a JSON object or array.'});return;}
    if(/^[A-Z0-9.]+\.json$/.test(entry.key) && (!(payload.spot>0) || !record(payload.chains) || !Array.isArray(payload._bars) || payload._bars.length<20 || !stamp(payload.quoteAsOf)))issues.push({key:entry.key,status:'invalid',detail:'Company output is missing required quote, chain or history inputs.'});
    if(entry.key==='webull-paper-ledger.json' && ['attention','unavailable','incomplete'].includes(payload.reconciliation?.status))issues.push({key:entry.key,status:'degraded',detail:'The stored broker reconciliation requires review. No broker request was made.'});
  };
  for(let i=0;i<entries.length;i+=6)await Promise.all(entries.slice(i,i+6).map(read));
  // Include request-time logs when absent from a test/legacy listing. Absence is
  // legitimate before first use; they are never required just to make a book.
  for(const key of REQUEST_TIME_EXCLUSIVE_KEYS)if(!keys.has(key)){
    const bytes=await store.get(key);if(bytes!=null)await read({key});
  }
  let researchRecords=0,researchComplete=true;
  if(store.rawList){
    try{
      const records=(await store.rawList('_stonks/research-lab/')).filter(e=>e.key.endsWith('.json'));
      if(records.length>limit){researchComplete=false;issues.push({key:'Research Lab records',status:'unknown',detail:'The internal journal exceeds the scan limit.'});}
      else for(let i=0;i<records.length;i+=6)await Promise.all(records.slice(i,i+6).map(async entry=>{
        researchRecords++;
        try{const bytes=await store.rawGet(entry.key);if(bytes==null || bytes.length>32*1024*1024)throw new Error('Record unavailable');const p=JSON.parse(bytes.toString('utf8'));if(!record(p) && !Array.isArray(p))throw new Error('Record shape');}
        catch{issues.push({key:'Research Lab internal record',status:'invalid',detail:'An internal research record failed its storage or JSON integrity check. No owner identity or record contents are exposed.'});}
      }));
    }catch{researchComplete=false;issues.push({key:'Research Lab records',status:'unavailable',detail:'The internal research journal inventory could not be checked.'});}
  }
  return {checked,total:entries.length,researchRecords,issues:issues.slice(0,200),issueCount:issues.length,complete:issues.length<=200 && researchComplete,publication:publication?.manifest.generation || null,checkedAt:new Date(now).toISOString()};
}

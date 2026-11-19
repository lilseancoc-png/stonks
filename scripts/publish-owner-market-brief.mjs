import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOwnerMarketBrief, OWNER_BRIEF_KEY, OWNER_BRIEF_SOURCES } from '../lib/owner-market-brief.mjs';
// Runs after every desk has finished, including the immutable decision publisher.
// `desk` (lib/owner-desk-state.mjs) is read by the bake before its data/ wipe:
// the Owner controls and the Webull paper fills. engines.json supplies the
// last engine run's account-limit holds.
export async function publishOwnerMarketBrief({dataDir,builtAtIso,publicScan,publicCore,previous=null,desk=null}={}) {
  const keys=[...new Set([...OWNER_BRIEF_SOURCES.map(s=>s.key),'briefs.json','engines.json'])];
  const payloads=Object.fromEntries(await Promise.all(keys.map(async key=>{
    try{return [key,JSON.parse(await readFile(resolve(dataDir,key),'utf8'))];}catch{return [key,null];}
  })));
  const payload=buildOwnerMarketBrief({builtAtIso,payloads,publicScan,publicCore,previous,desk});
  await writeFile(resolve(dataDir,OWNER_BRIEF_KEY),JSON.stringify(payload),'utf8');
  return payload;
}

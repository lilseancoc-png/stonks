// Local, synthetic owner UI fixture. No upstream calls or trading operations.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEntryPolicyChecks, entryPolicyFixture } from './entry-policy-smoke.mjs';
import { runRiskSelectionChecks } from './risk-selection-smoke.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {accepted,rejected,research}=runEntryPolicyChecks();
const {rescued}=runRiskSelectionChecks();
rescued.symbol='ALTERNATIVE';
// The ordinary scored payload carries the timing pillar; the synthetic fixture
// builds its evidence explicitly so the same browser disclosure is exercised.
const previewTiming=entryPolicyFixture().timing;
rescued.pillars.timing={...previewTiming,executionOnly:true,volatilityRisk:previewTiming.metrics.volatilityRisk};
rejected.symbol='COSTLY';
rejected.thesisCard.summary='Synthetic fixture: the stock setup clears, but the option economics do not.';
const now=new Date().toISOString();
const fixtures={
  'picks.json':{builtAtIso:now,picks:[accepted,rescued,rejected],rosterMeta:{groups:{actionable:2,watch:1}}},
  'leaps-picks.json':{...research,builtAtIso:now},
  'picks-open.json':{builtAtIso:now,picks:[]},
  'picks-accuracy.json':{builtAtIso:now,open:[],closed:[]},
};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(url.pathname==='/api/auth/me'&&!url.searchParams.has('data'))return json({enabled:true,member:true,trackRecord:true,topPicks:true,role:'owner'});
  const key=url.searchParams.get('data')||(url.pathname.startsWith('/data/')?url.pathname.slice(6):null);
  if(key){
    if(key in fixtures)return json(fixtures[key]);
    if(key.includes('/')||key.includes('..')){res.statusCode=400;return res.end();}
    try{return json(JSON.parse(await readFile(resolve(root,'data',key),'utf8')));}catch{return json({});}
  }
  if(url.pathname.startsWith('/api/'))return json({quotes:[],items:[],entries:[]});
  if(url.pathname.startsWith('/_vercel/')){res.setHeader('Content-Type','text/javascript');return res.end('');}
  const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.statusCode=404;res.end();}
});
server.listen(4178,'127.0.0.1',()=>console.log('Synthetic entry-policy preview: http://127.0.0.1:4178/?tab=picks'));

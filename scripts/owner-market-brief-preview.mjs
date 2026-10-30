// Read-only local preview with fictional data and simulated owner roles.
// It never contacts providers, private storage, or a broker.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildOwnerMarketBrief } from '../lib/owner-market-brief.mjs';
import { ownerBriefFixture, OWNER_BRIEF_FIXTURE_TIME } from './fixtures/owner-market-brief.mjs';

export async function createOwnerMarketBriefPreview({ port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL('../',import.meta.url)));
  const fixture = ownerBriefFixture();
  const payload = buildOwnerMarketBrief(fixture);
  const stale = JSON.parse(JSON.stringify(payload).replaceAll('2026-10-23','2026-10-22'));
  stale.validUntil='2026-10-23T15:04:00.000Z';
  const quoteExpiry=structuredClone(payload);
  quoteExpiry.ideas[0].policyValidUntil='2026-10-23T15:06:00.000Z';
  const malformedPath=structuredClone(payload);malformedPath.scenarios[0].paths=[null];
  const malformedFoundation=structuredClone(payload);malformedFoundation.publicRead.indexes={};
  const malformedSupport=structuredClone(payload);malformedSupport.ideas[0].support=[{}];
  const empty = buildOwnerMarketBrief({builtAtIso:OWNER_BRIEF_FIXTURE_TIME});
  const html = await readFile(resolve(root,'index.html'),'utf8');
  const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  const manifest = {...shell,symbols:[],narratives:[],deferred:false};
  let scenario='owner', requests=0;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('Cache-Control','no-store');
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(req.method!=='GET')return json({error:'Read-only preview'},405);
    const key=url.searchParams.get('data') || (url.pathname.startsWith('/data/')?url.pathname.slice(6):null);
    const owner=!['anonymous','tp-only','tr-only','disabled'].includes(scenario);
    if(url.pathname==='/api/auth/me'&&!key)return json({enabled:scenario!=='disabled',authed:owner,trackRecord:!['anonymous','tp-only'].includes(scenario),topPicks:!['anonymous','tr-only'].includes(scenario),name:'Fixture owner'});
    if(key==='owner-market-brief.json'){
      requests++;
      res.setHeader('Cache-Control','private, no-store');
      if(!owner||scenario==='revoked')return json({error:'Owner role required'},401);
      if(scenario==='error')return json({error:'Fixture outage'},503);
      if(scenario==='hang')return;
      if(scenario==='missing')return json({error:'Not built'},404);
      if(scenario==='malformed')return json({version:1,coverage:[],summary:'Invalid snapshot'});
      if(scenario==='no-narrative')return json({...payload,publicRead:null,publicCore:{...payload.publicCore,events:[{label:'TEST earnings',detail:'PM'}]}});
      if(scenario==='quote-expiry')return json(quoteExpiry);
      if(scenario==='malformed-path')return json(malformedPath);
      if(scenario==='malformed-foundation')return json(malformedFoundation);
      if(scenario==='malformed-support')return json(malformedSupport);
      if(scenario==='empty')return json(empty);
      if(scenario==='stale')return json(stale);
      return json(payload);
    }
    if(key==='unified-signal.json'){res.setHeader('Cache-Control','private, no-store');return json(owner?fixture.payloads[key]:{error:'Owner required'},owner?200:401);}
    if(key==='manifest.json'||key==='manifest-free.json')return json(manifest);
    if(key)return json({});
    if(url.pathname.startsWith('/api/'))return json({entries:[],items:[]});
    if(url.pathname.startsWith('/_vercel/'))return res.end('');
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+'/'))return json({error:'Not found'},404);
    try{
      const data=await readFile(path);
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');
      if(extname(path)==='.html')return res.end(data.toString().replace('<body>','<body><div style="padding:8px;text-align:center;font:12px system-ui;background:var(--surface-2);color:var(--muted-strong)">Local preview · fictional research data · simulated Owner · snapshot October 23, 2026</div>'));
      res.end(data);
    }catch{return json({error:'Not found'},404);}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,base:'http://127.0.0.1:'+server.address().port,payload,setScenario(value){scenario=value;},get requests(){return requests;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const preview=await createOwnerMarketBriefPreview({port:Number(process.env.OWNER_BRIEF_PREVIEW_PORT||4197)});
  console.log('Owner Market Brief local preview: '+preview.base+'/?tab=owner-market-brief');
}

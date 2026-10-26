// Read-only local preview with fictional data and simulated owner roles.
// It never contacts providers, private storage, or a broker.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUnifiedSignalEngine } from '../lib/unified-signal.mjs';
import { unifiedSignalFixture, UNIFIED_FIXTURE_TIME } from './fixtures/unified-signal.mjs';

export async function createUnifiedSignalPreview({ port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL('../',import.meta.url)));
  const fixture = unifiedSignalFixture();
  const payload = buildUnifiedSignalEngine(fixture);
  const stale = buildUnifiedSignalEngine(unifiedSignalFixture('2026-10-22T15:05:00.000Z'));
  const empty = buildUnifiedSignalEngine({builtAtIso:UNIFIED_FIXTURE_TIME});
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
    if(key==='unified-signal.json'){
      requests++;
      res.setHeader('Cache-Control','private, no-store');
      if(!owner||scenario==='revoked')return json({error:'Owner role required'},401);
      if(scenario==='error')return json({error:'Fixture outage'},503);
      if(scenario==='hang')return;
      if(scenario==='missing')return json({error:'Not built'},404);
      if(scenario==='malformed')return json({version:1,decisions:[{}]});
      if(scenario==='empty')return json(empty);
      if(scenario==='stale')return json(stale);
      return json(payload);
    }
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
  const preview=await createUnifiedSignalPreview({port:Number(process.env.UNIFIED_PREVIEW_PORT||4191)});
  console.log('Unified Signal Engine local preview: '+preview.base+'/?tab=unified-signal-engine');
}

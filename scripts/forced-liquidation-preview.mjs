// Loopback-only, read-only preview with an explicitly simulated Owner session.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {liquidationFixture} from './fixtures/forced-liquidation.mjs';
import {buildForcedLiquidationPayload} from '../lib/forced-liquidation.mjs';
export async function createLiquidationPreview({port=0,payloadFile=null}={}){
  const root=resolve(fileURLToPath(new URL('..',import.meta.url))),fixture=liquidationFixture();
  const payload=payloadFile?JSON.parse(await readFile(payloadFile,'utf8')):fixture.payload;
  const html=await readFile(resolve(root,'index.html'),'utf8'),shell=JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  const manifest={...shell,symbols:[],narratives:[],deferred:false};
  let scenario='owner',requests=0;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
    const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method!=='GET')return json({error:'Read-only preview'},405);
    const key=url.searchParams.get('data')||(url.pathname.startsWith('/data/')?url.pathname.slice(6):null);
    if(url.pathname==='/api/auth/me'&&!key)return json({enabled:scenario!=='disabled',authenticated:scenario!=='anonymous',trackRecord:!['anonymous','tp-only'].includes(scenario),topPicks:!['anonymous','tr-only'].includes(scenario)});
    if(key==='forced-liquidation.json'){
      requests++;if(['anonymous','tp-only','tr-only','disabled'].includes(scenario))return json({error:'Owner role required'},401);
      if(scenario==='error')return json({error:'Test source outage'},503);
      if(scenario==='missing')return json({error:'Not collected'},404);
      if(scenario==='malformed')return json({version:1,rows:[{}]});
      if(scenario==='empty')return json({...payload,rows:[],observations:[],summary:{tracked:0,modeled:0,nearTrigger:0,topUps:0,needsTerms:0}});
      if(scenario==='stale')return json({...payload,builtAtIso:'2026-01-01T00:00:00Z',coverage:{...payload.coverage,status:'unavailable',lastSuccessAt:'2026-01-01T00:00:00Z'},rows:payload.rows.map(r=>({...r,market:r.market?{...r.market,quoteAsOf:'2026-01-01T00:00:00Z'}:null}))});
      if(scenario==='null-price')return json({...payload,rows:payload.rows.map(r=>({...r,market:r.market?{...r.market,price:null}:null}))});
      if(scenario==='legacy')return json({...payload,rows:payload.rows.map(r=>({...r,observation:{...r.observation,parserVersion:0}}))});
      if(scenario==='old-facts')return json({...payload,rows:payload.rows.map(r=>({...r,observation:{...r.observation,asOfDate:'2024-01-01',filingDate:'2024-01-01'}}))});
      if(scenario==='stale-volume')return json({...payload,rows:payload.rows.map(r=>({...r,market:r.market?{...r.market,volumeAsOf:'2026-01-01'}:null}))});
      if(scenario==='currency-history')return json(buildForcedLiquidationPayload({observations:fixture.observations.map(r=>r.asOfDate==='2026-09-23'?{...r,currency:'unresolved'}:r),chains:fixture.chains,coverage:fixture.coverage,builtAtIso:fixture.payload.builtAtIso}));
      return json(payload);
    }
    if(key==='manifest.json'||key==='manifest-free.json')return json(manifest);
    if(key==='picks.json')return json({builtAtIso:payload.builtAtIso,picks:[],rosterMeta:{forcedLiquidationWatch:payload.rows.filter(r=>r.state!=='debt-context').map(r=>({symbol:r.symbol,state:r.state,distancePct:r.distancePct,engineEligible:r.engineEligible,vetoLong:r.vetoLong}))}});
    if(key)return json({});
    if(url.pathname.startsWith('/api/'))return json({entries:[],items:[]});
    if(url.pathname.startsWith('/_vercel/'))return res.end('');
    if(!['/','/index.html','/app.js','/styles.css','/favicon.svg','/js/streaks.js','/js/book-views.js'].includes(url.pathname))return json({error:'Not found'},404);
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+'/'))return json({error:'Not found'},404);
    try{const body=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]||'application/octet-stream');
      if(extname(path)==='.html')return res.end(body.toString().replace('<body>','<body><div style="padding:8px;text-align:center;font:12px system-ui;background:var(--surface-2);color:var(--muted-strong)">Local preview · '+(payloadFile?'collected SEC disclosures':'synthetic test facilities, not real investment ideas')+' · simulated Owner session</div>'));
      res.end(body);
    }catch{return json({error:'Not found'},404);}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return{server,base:'http://127.0.0.1:'+server.address().port,payload,setScenario(v){scenario=v;},get requests(){return requests;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const preview=await createLiquidationPreview({port:Number(process.env.LIQUIDATION_PREVIEW_PORT||4189),payloadFile:process.env.LIQUIDATION_PAYLOAD_FILE||null});
  console.log('Forced Liquidation Tracker preview: '+preview.base+'/?tab=forced-liquidation');
}

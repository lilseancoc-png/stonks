// Local-only simulated Owner session. No provider, auth-service or broker calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { earningsFixture } from './fixtures/earnings-forecast.mjs';
import { prepareEarningsForecast } from './refresh-earnings-forecast.mjs';
export async function createEarningsPreview({port=0,payloadFile=null}={}){
  const root=fileURLToPath(new URL('../',import.meta.url));let payload;
  if(payloadFile)payload=JSON.parse(await readFile(payloadFile,'utf8'));
  else{
    // 22 issuers: the list of 20 is ranked in Q1, then re-ranked in Q2 when T21 jumps to the top and T19 leaves.
    const symbols=Array.from({length:22},(_,i)=>'T'+i),chains=big=>Object.fromEntries(symbols.map((s,i)=>[s,{fundamentals:{name:'Test issuer '+i,marketCap:s===big?5e12:(22-i)*1e11}}]));
    const period={periodType:'quarter',currentPeriod:{endDate:'2024-12-31'},previousPeriod:{endDate:'2023-12-31'}};
    const mix={product:{rows:[{name:'Products',value:55,previousValue:50},{name:'Services',value:37,previousValue:50},{name:'AI platform',value:8,previousValue:null,isNew:true}],period,currency:'USD'},geographic:{rows:[{name:'Home',value:25,previousValue:30},{name:'Overseas',value:75,previousValue:70}],period:{...period,periodType:'annual'},currency:'USD'},filed:'2025-01-30'};
    const state={version:1,cohort:null,observations:Object.fromEntries(symbols.map(s=>[s,earningsFixture(s)])),runs:[],current:{},evaluations:[],mix:Object.fromEntries(symbols.map(s=>[s,mix])),sourceStatus:{},sourceDocuments:{}};
    const run=(st,big,at)=>prepareEarningsForecast({previous:st,chains:chains(big),universe:symbols,sectors:{},cikMap:new Map(),now:()=>at,fetchImpl:()=>{throw Error('Preview cannot fetch providers');}});
    payload=(await run((await run(state,null,'2025-02-15T12:00:00Z')).state,'T21','2025-04-02T12:00:00Z')).payload;
    payload.companies[1].name='Test issuer <img src=x onerror=alert(1)>';
    // The fixture has no annual revenue fact, so mark the annual region split as reconciled like a real 10-K would be.
    for(const c of payload.companies)if(c.mix.geographic)c.mix.geographic.reconciliation={...c.mix.geographic.reconciliation,status:'matched'};
  }
  const html=await readFile(resolve(root,'index.html'),'utf8'),shell=JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]),manifest={...shell,symbols:[],narratives:[],deferred:false};
  let scenario='owner',requests=0;
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
    const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
    if(req.method!=='GET')return json({error:'Read-only local preview'},405);
    const key=u.searchParams.get('data')||(u.pathname.startsWith('/data/')?u.pathname.slice(6):null);
    const denied=['anonymous','tr-only','tp-only','disabled'].includes(scenario);
    if(u.pathname==='/api/auth/me'&&!key)return json({enabled:scenario!=='disabled',authenticated:scenario!=='anonymous',trackRecord:!['anonymous','tp-only'].includes(scenario),topPicks:!['anonymous','tr-only'].includes(scenario),role:'owner'});
    if(key==='earnings-forecast.json'){
      requests++;res.setHeader('Cache-Control','private, no-store');if(denied)return json({error:'Owner required'},401);
      if(scenario==='error')return json({error:'Fixture unavailable'},503);if(scenario==='missing')return json({error:'Not yet built'},404);if(scenario==='malformed')return json({version:1,companies:[null]});
      if(scenario==='empty')return json({...payload,companies:[]});if(scenario==='stale')return json({...payload,builtAtIso:'2020-01-01T00:00:00Z'});
      if(scenario==='changed-mix'){const j=structuredClone(payload);j.companies[0].mix.product.period.currentPeriod.endDate='2025-01-31';return json(j);}
      return json(payload);
    }
    if(key==='manifest.json'||key==='manifest-free.json')return json(manifest);
    if(key)return json({});if(u.pathname.startsWith('/api/'))return json({entries:[],items:[]});if(u.pathname.startsWith('/_vercel/'))return res.end('');
    const path=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!path.startsWith(root))return json({},404);
    try{const body=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(extname(path)==='.html'?body.toString().replace('<body>','<body><div style="padding:8px;text-align:center;font:12px system-ui;background:var(--surface-2);color:var(--muted-strong)">Local preview · '+(payloadFile?'cached real financial disclosures':'synthetic test data')+' · simulated Owner session</div>'):body);}catch{json({},404);}
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  return {server,base:'http://127.0.0.1:'+server.address().port,payload,setScenario(s){scenario=s;},get requests(){return requests;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const p=await createEarningsPreview({port:Number(process.env.EARNINGS_PREVIEW_PORT||4192),payloadFile:process.env.EARNINGS_PAYLOAD_FILE||null});console.log('Earnings Forecast preview: '+p.base+'/?tab=earnings-forecast');}

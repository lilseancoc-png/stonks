// Read-only browser fixture. No credentials, market providers or broker calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { UPDATE_FEATURES,inspectFeature } from '../lib/update-checker.mjs';
import { fixtureReport,CHECKER_FIXTURE_TIME } from './fixtures/update-checker.mjs';
export { CHECKER_FIXTURE_TIME } from './fixtures/update-checker.mjs';
import { handleUpdateChecker } from '../lib/update-checker-http.mjs';

export async function createUpdateCheckerPreview({port=0}={}) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const html=await readFile(resolve(root,'index.html'),'utf8');
  const shell=JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  let scenario='owner',requests=0;
  const store={async rawGet(){
    if(scenario==='unknown')return null;
    const report=fixtureReport(['feature-only','healthy','stale-monitor','stuck','sources'].includes(scenario));
    if(scenario==='stale-monitor')report.checkedAt='2026-11-01T06:00:00Z';
    if(scenario==='stuck')report.runs.unshift({...report.runs[0],id:101,status:'in_progress',conclusion:'pending',startedAt:'2026-11-01T16:00:00Z'});
    if(!['healthy','stale-monitor','stuck','sources'].includes(scenario))for(const f of report.features){
      if(f.id==='owner-market-brief')Object.assign(f,{status:'missing',detail:'No published output found.'});
      if(f.id==='calendar')Object.assign(f,{status:'invalid',detail:'Published output contains invalid JSON.'});
      if(f.id==='heatmap')Object.assign(f,{status:'stale',detail:'The output exceeds its freshness window.'});
    }
    if(scenario==='sources'){
      const payloads={
        calendar:{events:[],coverage:{officialSources:{'ism-2026':false}}},
        news:{sourceHealth:[{id:'ir-amd',label:'PRIVATE_SENTINEL',status:'error',error:'HTTP 403 PRIVATE_SENTINEL'}]},
        'owner-market-brief':{coverage:[{key:'ram-prices.json',status:'degraded'}]},
      };
      report.features=report.features.map(row=>payloads[row.id]?inspectFeature(UPDATE_FEATURES.find(s=>s.id===row.id),{builtAtIso:CHECKER_FIXTURE_TIME,...payloads[row.id]},Date.parse(CHECKER_FIXTURE_TIME)):row);
    }
    if(scenario==='logs')report.runs[0].diagnostics.findings=[{kind:'ai-down',detail:'AI calls failed; cached output may have been reused.',count:2}];
    return Buffer.from(JSON.stringify(report));
  }};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    if(req.method!=='GET')return json({error:'Read-only preview'},405);
    const owner=!['anonymous','tp-only','tr-only','disabled'].includes(scenario);
    if(url.pathname==='/api/auth/me'&&url.searchParams.has('checker')){
      requests++;
      if(scenario==='hang')return;
      if(scenario==='error')return json({error:'Fixture outage'},503);
      req.query=Object.fromEntries(url.searchParams);res.status=function(n){this.statusCode=n;return this;};res.json=function(body){this.setHeader('Content-Type','application/json');this.end(JSON.stringify(body));};
      return handleUpdateChecker(req,res,{env:{PRIVATE_DATA_ENABLED:'1'},getSession:async()=>owner&&scenario!=='revoked'?{tr:true,tp:true}:null,store,now:Date.parse(CHECKER_FIXTURE_TIME)});
    }
    const key=url.searchParams.get('data')||(url.pathname.startsWith('/data/')?url.pathname.slice(6):null);
    if(url.pathname==='/api/auth/me'&&!key)return json({enabled:scenario!=='disabled',authed:owner,trackRecord:owner||scenario==='tr-only',topPicks:owner||scenario==='tp-only',name:'Fixture owner',sub:'fixture'});
    if(key==='manifest.json'||key==='manifest-free.json')return json({...shell,deferred:false,symbols:[],narratives:[]});
    if(key)return json({});
    if(url.pathname.startsWith('/api/'))return json({entries:[],items:[]});
    if(url.pathname.startsWith('/_vercel/'))return res.end('');
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root))return json({error:'Not found'},404);
    try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{return json({error:'Not found'},404);}
  });
  await new Promise(done=>server.listen(port,'127.0.0.1',done));
  return {server,base:'http://127.0.0.1:'+server.address().port,setScenario(s){scenario=s;},get requests(){return requests;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const p=await createUpdateCheckerPreview({port:Number(process.env.CHECKER_PREVIEW_PORT||4199)});console.log(p.base+'/?tab=update-checker');}

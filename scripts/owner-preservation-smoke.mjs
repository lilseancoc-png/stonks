// Access restrictions must change responses, never the stored research.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { store } from '../lib/datastore.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import { publicDataPayload, BRIEF_ACCESS_POLICY_VERSION } from '../lib/public-data-policy.mjs';
import authHandler from '../api/auth/[action].js';
import dataHandler from '../api/data/[...path].js';
const privateRead='Buy AAPL now.';
const fixtures={
  'AAPL.json':{spot:100,priceSeries:{t:['2026-10-28'],c:[100]},news:{paragraph:privateRead},fundamentals:{judgment:{verdict:'strong'},revenueGrowthYoy:12,recommendationKey:'buy'}},
  'grades.json':{grades:{AAPL:{total:9,recommendation:{label:privateRead}}}},
  'grades-daily.json':{days:[{date:'2026-10-28',totals:{AAPL:9}}]},
  'grades-history.json':{latest:{AAPL:{total:9}},changes:[{symbol:'AAPL',before:7,after:9}]},
  'trends.json':{narratives:[{name:'Synthetic story',thesis:privateRead}]},
  'manifest-free.json':{spots:{AAPL:100},narratives:[{thesis:privateRead}],sectorOverviews:{Technology:{industryGrades:[{score:9}]}}},
  'ma-tracker.json':{tickers:[{symbol:'AAPL',spot:100,levels:{50:101}}],summary:{topAbove:[{symbol:'AAPL',score:90}]},methodology:'Private priority formula'},
  'briefs.json':{current:{date:'2026-10-29',accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,headline:'Observed prices',summary:'Prices rose today.',watchlist:[{sym:'AAPL',take:privateRead}],analog:{assessment:privateRead}},legacyMetadata:{keep:true}},
  'news-feed.json':{version:2,counts:{total:2,high:2},items:[{title:privateRead,impact:'high',scope:'company'},{title:'Company reports quarterly revenue',impact:'high',scope:'company'}]},
};
const originals=new Map(Object.entries(fixtures).map(([key,value])=>[key,Buffer.from(JSON.stringify(value))]));
const hash=()=>Object.fromEntries([...originals].map(([key,buf])=>[key,createHash('sha256').update(buf).digest('hex')]));
const before=hash();
function deepFreeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}
for(const [key,value] of Object.entries(fixtures)){
  const text=JSON.stringify(value); publicDataPayload(key,deepFreeze(value));assert.equal(JSON.stringify(value),text,'Immutable projection: '+key);
}
const priorEnv={flag:process.env.PRIVATE_DATA_ENABLED,secret:process.env.SESSION_SECRET};
const priorMethods=Object.fromEntries(['get','put','del','publishGeneration'].map(k=>[k,store[k]]));
let writes=0;
store.get=async key=>originals.get(key)||null;
for(const key of ['put','del','publishGeneration'])store[key]=async()=>{writes++;throw Error('A data read attempted a store mutation: '+key);};
process.env.PRIVATE_DATA_ENABLED='1';process.env.SESSION_SECRET='owner-preservation-test-only';
function response(){return{headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(code){this.statusCode=code;return this;},json(value){this.body=JSON.stringify(value);return this;},end(value){this.body=String(value);return this;}};}
try{
  const token=await signSession({sub:'fixture-owner',tr:true,tp:true});
  for(const [key,bytes] of originals)for(const handler of [authHandler,dataHandler]){
    const req={method:'GET',url:'/api/data/'+key,query:{action:'me',data:key},headers:{}};
    await handler(req,response());
    // Even a legitimate owner uses the public projection at the public URL.
    req.headers.cookie=`${SESSION_COOKIE}=${token}`;await handler(req,response());
    req.query.owner='1';const owner=response();await handler(req,owner);
    assert.equal(owner.statusCode,200,key);assert.equal(owner.body,bytes.toString(),'Owner gets every original byte: '+key);
    assert.equal(owner.headers['cache-control'],'private, no-store');
    assert.deepEqual(hash(),before,'Response filtering must leave all stored bytes untouched');
  }
  assert.equal(writes,0,'No writes, deletes or publications from any restricted read');
}finally{
  for(const [key,fn] of Object.entries(priorMethods))if(fn===undefined)delete store[key];else store[key]=fn;
  for(const [key,value] of [['PRIVATE_DATA_ENABLED',priorEnv.flag],['SESSION_SECRET',priorEnv.secret]])if(value==null)delete process.env[key];else process.env[key]=value;
}
// The collector, AI prompts and persistence rules must be byte-identical to
// the branch's starting commit. Access filtering has no reason to edit them.
const { execFileSync } = await import('node:child_process');
const { readFileSync } = await import('node:fs');
const baseline = execFileSync('git', ['show', 'HEAD:scripts/build.mjs'], { cwd: new URL('../', import.meta.url), maxBuffer: 8 * 1024 * 1024 });
assert.deepEqual(readFileSync(new URL('./build.mjs', import.meta.url)), baseline, 'Data generation, models and persistence must remain unchanged');
const news=publicDataPayload('news-feed.json',fixtures['news-feed.json']);
assert.equal(news.items.length,1);assert.equal(news.counts.total,1);assert.equal(news.counts.high,1);
console.log('Owner data preservation: 9 stored snapshots byte-identical across both routes; zero writes/deletes/publications; data generator, prompts and persistence match the baseline.');

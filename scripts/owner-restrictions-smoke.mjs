// Repeatable access-control proof. Signed fixtures only, no provider or store writes.
import assert from 'node:assert/strict';
import { publicDataPayload, BRIEF_ACCESS_POLICY_VERSION } from '../lib/public-data-policy.mjs';
import { OWNER_PAGE_IDS } from '../lib/owner-access-policy.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { store } from '../lib/datastore.mjs';
import { SESSION_COOKIE, signSession } from '../lib/session.mjs';
import authHandler from '../api/auth/[action].js';
import dataHandler from '../api/data/[...path].js';
const restricted = ['grades.json','grades-daily.json','grades-history.json','grade-research.json',
  'picks.json','auto-picks.json','trends.json','trends-history.json','flow-explanations.json',
  'stock-picks.json','leaps-picks.json','signal-decisions/test.json'];
for (const key of restricted) { assert(isPremiumKey(key), key); assert.deepEqual(roleClaimForKey(key), ['tr','tp']); }
for (const id of ['grade','strategies','narratives']) assert(OWNER_PAGE_IDS.includes(id));
const marker = 'PRIVATE_RECOMMENDATION_SENTINEL';
const raw = { spot: 100, priceSeries:{t:['2026-10-28'],c:[100]},
  autoPick:{symbol:marker}, aiSignals:{read:marker}, news:{paragraph:marker},
  fundamentals:{revenueGrowthYoy:20, judgment:{summary:marker}, targetMeanPrice:200, recommendationKey:marker},
  nested:{grade:{total:marker},recommendation:marker} };
const clean = publicDataPayload('AAPL.json', raw);
assert(!JSON.stringify(clean).includes(marker)); assert.equal(clean.spot,100); assert.equal(clean.fundamentals.revenueGrowthYoy,20);
assert.equal(raw.news.paragraph,marker, 'Projection must not mutate Owner data');
assert(!JSON.stringify(publicDataPayload('manifest-free.json',{narratives:[{thesis:marker}],sectorOverviews:{read:marker},spots:{AAPL:100}})).includes(marker));
assert.equal(publicDataPayload('briefs.json',{current:{accessPolicyVersion:0,summary:marker}}).current,undefined);
assert.deepEqual(publicDataPayload('briefs.json',{current:{accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,summary:'Observed facts',watchlist:[marker],analog:{assessment:marker},playbook:[marker]}}).current,
  {accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION});
assert.equal(publicDataPayload('briefs.json',{current:{accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,summary:'Buy AAPL now.'}}).current.summary,undefined);
assert.deepEqual(publicDataPayload('news-feed.json',{items:[{title:'3 stocks to buy now'},{title:'Company reported revenue of $1 billion'}]}).items,[{title:'Company reported revenue of $1 billion'}]);
const brief = publicDataPayload('briefs.json', {current:{accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,headline:marker,summary:marker,highlights:[{text:marker}],indexes:[{sym:'SPY',chPct:1}],toolScan:{checked:['Narratives','Heatmap'],coreChecked:['Ticker tracker & Grade'],missing:[],total:3,standouts:[{tab:'narratives',text:marker},{tab:'ma-tracker',text:marker},{tab:'heatmap',text:'70% of tracked stocks rose.'}]}}});
assert(!JSON.stringify(brief).includes(marker));
assert.equal(brief.current.indexes[0].chPct,1);
assert.deepEqual(brief.current.toolScan.checked,['Heatmap']);
assert.equal(brief.current.toolScan.total,2);
assert.equal(brief.current.toolScan.standouts.length,1);
function response() { return { headers:{},statusCode:200,body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=JSON.stringify(v);return this;},end(v){this.body=String(v);return this;} }; }
const oldFlag=process.env.PRIVATE_DATA_ENABLED, oldSecret=process.env.SESSION_SECRET, oldGet=store.get;
process.env.PRIVATE_DATA_ENABLED='1'; process.env.SESSION_SECRET='owner-restrictions-offline-only';
let reads=0;store.get=async()=>{reads++;return Buffer.from(JSON.stringify(raw));};
try {
  const owner=await signSession({sub:'fixture-owner',tr:true,tp:true});
  const nonOwner=await signSession({sub:'fixture-member',tr:false,tp:false});
  const partial=await signSession({sub:'fixture-legacy',tr:true});
  const expired=await signSession({sub:'fixture-expired',tr:true,tp:true},{ttlSec:-10});
  for (const route of ['auth','data']) for (const key of restricted) for (const token of ['',nonOwner,partial,expired,owner+'forged',owner]) {
    const req={method:'GET',url:'/api/data/'+key,query:{action:'me',data:key},headers:token?{cookie:`${SESSION_COOKIE}=${token}`}:{}};
    const res=response(),before=reads;
    await (route==='auth'?authHandler:dataHandler)(req,res);
    assert.equal(res.statusCode,token===owner?200:401,route+' '+key);
    assert.equal(res.headers['cache-control'],'private, no-store');
    if(token!==owner)assert.equal(reads,before,'Deny before storage');
  }
  for(const route of ['auth','data']) {
    const req={method:'GET',url:'/api/data/AAPL.json',query:{action:'me',data:'AAPL.json'},headers:{}};
    let res=response();await(route==='auth'?authHandler:dataHandler)(req,res);
    assert.equal(res.statusCode,200);assert(!res.body.includes(marker));assert.equal(JSON.parse(res.body).spot,100);
    req.query.owner='1';res=response();await(route==='auth'?authHandler:dataHandler)(req,res);assert.equal(res.statusCode,401);
    req.headers.cookie=`${SESSION_COOKIE}=${owner}`;res=response();await(route==='auth'?authHandler:dataHandler)(req,res);
    assert.equal(res.statusCode,200);assert(res.body.includes(marker));assert.equal(res.headers['cache-control'],'private, no-store');
    delete req.query.owner;res=response();await(route==='auth'?authHandler:dataHandler)(req,res);
    assert(!res.body.includes(marker),'A cookie cannot contaminate the anonymous cache URL');
  }
  process.env.PRIVATE_DATA_ENABLED='0';const res=response();await authHandler({method:'GET',query:{action:'me',data:'grades.json'},headers:{}},res);assert.equal(res.statusCode,404);
} finally { store.get=oldGet; if(oldFlag==null)delete process.env.PRIVATE_DATA_ENABLED;else process.env.PRIVATE_DATA_ENABLED=oldFlag;if(oldSecret==null)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=oldSecret; }
console.log('Owner restrictions: both data routes, public projections, legacy payloads, invalid sessions and Brief projections passed.');

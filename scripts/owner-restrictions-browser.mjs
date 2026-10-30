// Real browser + real authenticated data handlers, using synthetic in-memory data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { OWNER_PAGE_IDS, OWNER_UI_SELECTORS } from '../lib/owner-access-policy.mjs';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { store } from '../lib/datastore.mjs';
import { SESSION_COOKIE, signSession } from '../lib/session.mjs';
import { BRIEF_ACCESS_POLICY_VERSION } from '../lib/public-data-policy.mjs';
import authHandler from '../api/auth/[action].js';
import dataHandler from '../api/data/[...path].js';
import { buildHeatmapPayload, buildMovingAverageTracker, BRIEF_TOOL_SOURCES } from './build.mjs';
import { briefPublicFixture, BRIEF_FIXTURE_NOW } from './fixtures/brief-public.mjs';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const now=BRIEF_FIXTURE_NOW;
const marker='PRIVATE_RECOMMENDATION_SENTINEL';
const source=briefPublicFixture();
const objects=new Map(BRIEF_TOOL_SOURCES.map(s=>[s.file,source[s.key]]));
const bars=Array.from({length:400},(_,i)=>({t:new Date(now.getTime()-(400-i)*86400000).toISOString().slice(0,10),c:100+i/10,o:100+i/10,h:101+i/10,l:99+i/10,v:1000000}));
const chain={spot:140,fundamentals:{name:'Synthetic company',marketCap:10000000000,revenueGrowthYoy:20,judgment:{verdict:'strong',summary:marker},recommendationKey:marker},technicals:{volume:{priceMove1dPct:1,rvol:1.2}},_bars:bars,priceSeries:{t:bars.map(x=>x.t),c:bars.map(x=>x.c),v:bars.map(x=>x.v)},expirations:[],chains:{},news:{paragraph:marker}};
const expiry=Math.floor(now.getTime()/1000)+60*86400;
chain.expirations=[expiry];chain.chains={ [expiry]: { c:[{s:140,b:10,a:11,l:10.5,iv:0.4,oi:5000,v:2000}],p:[{s:140,b:9,a:10,l:9.5,iv:0.4,oi:4000,v:1500}] } };
const heat=buildHeatmapPayload({AAPL:chain,MSFT:{...chain,spot:150}},now.toISOString());
objects.set('heatmap.json',heat);objects.set('AAPL.json',chain);objects.set('MSFT.json',chain);
const grade={symbol:'AAPL',total:9,side:'call',recommendation:{tier:'call',label:marker},pillars:{fundamentals:{score:2},technicals:{score:2},narrative:{score:3},ivCost:{score:1},timing:{score:1}}};
objects.set('grades.json',{builtAtIso:now.toISOString(),minConviction:4,grades:{AAPL:grade,MSFT:{...grade,symbol:'MSFT',total:8}}});
objects.set('grades-daily.json',{builtAtIso:now.toISOString(),days:bars.map(x=>({date:x.t,totals:{AAPL:9,MSFT:8}}))});
objects.set('briefs.json',{current:{kind:'intraday',date:'2026-10-27',generatedAtIso:now.toISOString(),accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,headline:'Synthetic factual brief',summary:'Prices rose in the observed session.',indexes:[{sym:'SPY',chPct:1}],highlights:[],watchlist:[{sym:'AAPL',take:marker}],analog:{pattern:'Private analog',assessment:marker}}});
const html=await readFile(resolve(root,'index.html'),'utf8');
const shell=JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
const manifest={...shell,symbols:['AAPL','MSFT'],deferred:true};
objects.set('manifest-free.json',{spots:{AAPL:140,MSFT:150},narratives:[{name:marker,thesis:marker}],sectorOverviews:{Technology:{thesis:marker}}});
objects.set('manifest.json',{});
objects.set('ma-tracker.json',buildMovingAverageTracker({AAPL:chain,MSFT:chain},now.toISOString()));
process.env.PRIVATE_DATA_ENABLED='1';process.env.SESSION_SECRET='owner-restrictions-browser-fixture-only';
for(const method of ['put','del','publishGeneration'])store[method]=async()=>{throw new Error('UI audit attempted a store mutation: '+method);};
store.get=async key=>Buffer.from(JSON.stringify(objects.get(key)||{}));
let authDelay=0;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const query=Object.fromEntries(url.searchParams); const json=(o,n=200)=>{res.statusCode=n;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(o));};
 res.status=n=>{res.statusCode=n;return res;};res.json=o=>json(o,res.statusCode);
 if(url.pathname.startsWith('/data/')){query.data=url.pathname.slice(6);query.action='me';req.query=query;return authHandler(req,res);}
 if(url.pathname==='/api/auth/me'){query.action='me';req.query=query;if(!query.data&&authDelay)await new Promise(r=>setTimeout(r,authDelay));return authHandler(req,res);}
 if(url.pathname.startsWith('/api/data/')){req.query=query;return dataHandler(req,res);}
 if(url.pathname==='/api/auth/logout'){query.action='logout';req.query=query;return authHandler(req,res);}
 if(url.pathname.startsWith('/api/'))return json({});
 if(url.pathname.startsWith('/_vercel/'))return res.end('');
 const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+sep))return json({},404);
 try{let body=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');if(extname(path)==='.html')body=body.toString().replace(/window\.STONKS_MANIFEST=\{.*\};<\/script>/,'window.STONKS_MANIFEST='+JSON.stringify(manifest)+';</script>');res.end(body);}catch{json({},404);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const output=process.env.QA_OUTPUT||resolve(tmpdir(),'stonks-owner-restrictions');await mkdir(output,{recursive:true});
const publicIds=SITE_SECTIONS.flatMap(s=>s.items.map(i=>i.id)).filter(id=>!OWNER_PAGE_IDS.includes(id));
const leaks=[];let checks=0;
try{
 for(const role of (process.env.QA_ROLES||'anonymous,member,owner').split(','))for(const width of (process.env.QA_WIDTHS||'1440,768,390,320').split(',').map(Number)){
  const context=await browser.newContext({viewport:{width,height:1000}});
  if(role!=='anonymous'){const token=await signSession({sub:'fixture-'+role,tr:role==='owner',tp:role==='owner'});await context.addCookies([{name:SESSION_COOKIE,value:token,url:base,httpOnly:true}]);}
  const page=await context.newPage(),errors=[],requests=[];
  await page.clock.install({time:now});
  await page.addInitScript(theme=>localStorage.setItem('stonks-theme',theme),width===1440||width===390?'dark':'light');
  await page.addInitScript(()=>localStorage.setItem('stonks-views-v1',JSON.stringify({'heatmap.color':'grade','tickers.sort':'conviction','tickers.scx':'score','compare.mode':'grade','compare.secMetric':'call'})));
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({body:''}));
  page.on('pageerror',e=>{errors.push(e.stack);console.error(e.stack);});page.on('request',r=>requests.push(r.url()));
  if(role!=='owner'){
   authDelay=150;await page.goto(base+'/?tab=heatmap',{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('#book-grade-return').isVisible(),false,'No auth-loading flash');authDelay=0;
   for(const id of publicIds){
    await page.goto(base+'/?tab='+id+(id==='compare'?'&cmp=AAPL,MSFT':''));await page.waitForFunction(()=>document.body.hasAttribute('data-active-tab'));await page.waitForTimeout(60);
    assert.equal(await page.locator('.page-pane:not([hidden])').first().getAttribute('id'),'page-pane-'+id,'Public page remains reachable '+id);
    assert.equal(await page.locator(OWNER_UI_SELECTORS.join(',')).count(),0,'No protected UI on '+id);
    if (id === 'brief') {
      assert.equal(await page.locator('.brief-headline,.brief-summary,.brief-highlights').count(),0,'Owner AI commentary stays private');
      await page.locator('.brief-evidence summary').click();
      assert((await page.locator('#brief-root').innerText()).includes('SPY'),'Factual market blocks still render');
    }
    if (id === 'compare') {
      for (const sym of ['AAPL','MSFT']) { await page.locator('#cmp-input').fill(sym); await page.locator('#cmp-input').press('Enter'); }
      await page.locator('#cmp-table-wrap table').waitFor();
      assert(!/Our grade|Analyst target|Fundamentals verdict|Entry timing|Technicals pillar/.test(await page.locator('#cmp-table-wrap').innerText()));
      await page.locator('#cmp-sectors summary').click();
      await page.locator('#cmp-sec-metric').waitFor();
      assert.equal(await page.locator('#cmp-sec-metric option[value="grade"],#cmp-sec-metric option[value="call"]').count(),0);
    }
    if (id === 'oi') {
      assert.equal(await page.locator('#oi-sort-select option[value="score"]').count(),1,'Factual gamma sorting stays public');
      assert.equal(await page.locator('#oi-sort-select').inputValue(),'score');
      await page.locator('#oi-sort-select').selectOption('oi');
    }
    if (id === 'tickers') {
      await page.locator('[data-view-toggle="tickers"][data-view-mode="table"]').click();
      assert(!/Grade|Entry/.test(await page.locator('#tickers-table thead').innerText()));
      await page.locator('[data-view-toggle="tickers"][data-view-mode="chart"]').click();
      assert.equal(await page.locator('#tickers-sc-x').inputValue(),'move1d');
      await page.locator('#tickers-search').fill('NO_SUCH_TICKER');
      await page.locator('#tickers-empty-reset').click();
      assert.equal(await page.locator('#tickers-sort').inputValue(),'alpha','Reset cannot restore a private grade sort');
      assert.equal(await page.locator('a.ticker-card[data-ticker="AAPL"]').getAttribute('href'),'?tab=heatmap&heatmapSearch=AAPL');
    }
    const text=await page.locator('.page-pane:not([hidden])').innerText();assert(!text.includes(marker),id+' private content');
    const lines=text.split('\n').filter(t=>/buy now|sell now|take the trade|ready to enter|trade posture|highest.*grade|our grade|strong call|strong put|entry-ready|crossover priority|favor pullback/i.test(t));if(lines.length)leaks.push({id,lines});
    checks++;
   }
   for(const id of OWNER_PAGE_IDS){await page.goto(base+'/?tab='+id+'&s=AAPL');await page.waitForFunction(()=>document.body.hasAttribute('data-active-tab'));assert.equal(await page.locator('#page-pane-'+id).count(),0,'Deep link blocked '+id);checks++;}
   assert(!requests.some(u=>/data=(grades|grades-daily)\.json|\/data\/grades/.test(u)),'No grade fetch for '+role);
   await page.goto(base+'/?tab=heatmap');await page.waitForFunction(()=>document.body.hasAttribute('data-active-tab'));await page.locator('.heatmap-tile').first().waitFor();
   await page.locator('.heatmap-tile[data-sym="AAPL"]').click();
   assert.equal(await page.locator('#heatmap-search').inputValue(),'AAPL');
   assert.equal(await page.locator('#page-pane-grade').count(),0);
   await page.goto(base+'/?tab=heatmap&heatmapSearch=MSFT');
   await page.waitForFunction(()=>document.body.hasAttribute('data-active-tab'));
   assert.equal(await page.locator('#heatmap-search').inputValue(),'MSFT');
   await page.locator('.heatmap-tile.is-search-hit[data-sym="MSFT"]').waitFor();
   await page.clock.runFor(500);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Public Heatmap fits the viewport');
   await page.screenshot({path:resolve(output,role+'-'+width+'.png'),animations:'disabled'});
  }else{
   await page.goto(base+'/?tab=heatmap');await page.locator('#book-grade-return .book-table').waitFor();
   assert(await page.locator('#book-grade-return').isVisible());assert((await page.locator('#book-grade-return').innerText()).includes('Grade against the stored return'));checks++;
   assert.equal(await page.locator('#page-tab-grade').count(),1);assert.equal(await page.locator('#page-tab-strategies').count(),1);
   await page.screenshot({path:resolve(output,role+'-'+width+'.png'),fullPage:true,animations:'disabled'});
   await page.goto(base+'/?tab=grade&s=AAPL');
   await page.locator('#opt-fund-summary').filter({hasText:marker}).waitFor({state:'attached'});
   await page.locator('#opt-tab-btn-fund').click();
   await page.locator('#opt-fund-summary').waitFor();
   await page.locator('#opt-tab-btn-contract').click();
   await page.locator('#opt-verdict-main').waitFor({state:'attached'});
   assert((await page.locator('#opt-eval-result').innerText()).length>0,'Owner contract grading still renders');
   assert(requests.some(url=>url.includes('data=AAPL.json')&&url.includes('owner=1')),'Owner ticker request uses the full private projection');
   checks++;
   await page.goto(base+'/?tab=compare&cmp=AAPL,MSFT');await page.waitForFunction(()=>document.body.classList.contains('is-owner'));
   // A logout/reload must remove the Owner view, including cached local preferences.
   await context.clearCookies();await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);await page.waitForFunction(()=>!document.body.classList.contains('is-owner')&&document.body.hasAttribute('data-active-tab'));
   assert.equal(await page.locator('#book-grade-return').count(),0);assert.equal(await page.locator('#page-tab-grade').count(),0);checks++;
  }
  assert.deepEqual(errors,[],role+' browser errors');await context.close();
 }
 assert.deepEqual(leaks,[],'Public recommendation wording');
 console.log('Owner browser restrictions: '+checks+' route/access checks passed at desktop and phone widths. Screenshots: '+output);
}finally{await browser.close();await new Promise(r=>server.close(r));}

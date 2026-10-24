// Offline browser checks using the generated site and deterministic source rows.
// PLAYWRIGHT_MODULE may point at an installed Playwright module.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildNewsFeedPayload} from '../lib/news-feed.mjs';
import {reconcileNewsEvidence, evidenceFeedRows, evidenceSourceHealth} from '../lib/news-evidence.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=resolve(process.env.QA_OUTPUT || resolve(tmpdir(),'stonks-news-browser'));
await mkdir(output,{recursive:true});
const now=new Date(), publishedAt=new Date(now.getTime()-3600000).toISOString();
const day=new Date(now.getTime()-86400000).toISOString().slice(0,10);
const events=[
  {eventId:'qa:issuer:quarterly-results',sourceId:'ir-aapl',kind:'issuer-announcement',sourceKind:'issuer',symbols:['AAPL'],publisher:'Apple · company announcement',title:'Apple reports quarterly results',publishedAt,link:'https://www.apple.com/newsroom/results/',facts:{eventClass:'earnings'}},
  {eventId:'qa:regulator:original-approval',sourceId:'fda-lly',kind:'regulatory-action',sourceKind:'official',symbols:['LLY'],publisher:'FDA',title:'FDA records original approval for Example (LLY)',publishedAt:day+'T12:00:00Z',dateOnly:true,link:'https://www.accessdata.fda.gov/',facts:{action:'original-approval'}},
  {eventId:'qa:eia:weekly-crude-stock',sourceId:'eia-crude',kind:'economic-release',sourceKind:'official',symbols:['USO'],publisher:'EIA',title:'Commercial crude inventories excluding SPR: 412,517 thousand barrels; weekly change -3,060 thousand barrels (week ending '+day+')',publishedAt:day+'T12:00:00Z',dateOnly:true,link:'https://www.eia.gov/petroleum/supply/weekly/',facts:{actual:412517,previous:415577,change:-3060,units:'thousand barrels',consensus:null,surprise:null}},
];
const olderDay=new Date(now.getTime()-6*86400000).toISOString().slice(0,10);
events.push({...events[2],eventId:'qa:eia:previous-week-stock',publishedAt:olderDay+'T12:00:00Z',title:'Commercial crude inventories excluding SPR: 415,577 thousand barrels; prior reporting week '+olderDay});
let sourceError=false, emptySlate=false, sourcePartial=false, apiError=false, malformedPayload=false, energyOnly=false;
function payload(){
  const sources={};
  for(const e of events){
    const source=sources[e.sourceId] ||= {label:e.publisher,status:sourceError?'error':sourcePartial?'partial':'ok',partial:sourcePartial,checkedAt:now.toISOString(),events:[],...(sourceError?{error:'offline',lastSuccessAt:publishedAt}:{})};
    if(!emptySlate && (!energyOnly || e.sourceId==='eia-crude'))source.events.push(e);
  }
  const state=reconcileNewsEvidence(null,sources,['AAPL','LLY','USO'],now);
  const feed=buildNewsFeedPayload({tickerHeadlines:evidenceFeedRows(state),now});
  return {...feed,sourceHealth:evidenceSourceHealth(state),sourceCoverage:{issuerSymbols:['AAPL'],fdaSymbols:['LLY']}};
}
const html=await readFile(resolve(root,'index.html'),'utf8');
const manifest=JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
  if(u.pathname==='/api/auth/me'&&!u.searchParams.has('data'))return json({enabled:true,member:true,trackRecord:true,topPicks:true,role:'owner'});
  const name=u.searchParams.get('data') || (u.pathname.startsWith('/data/')?u.pathname.slice(6):null);
  if(name==='news-feed.json'){if(apiError){res.statusCode=503;return json({error:'offline'});}const malformed={missing:{unexpected:true},rows:{items:[null]},health:{items:[],sourceHealth:[null]},coverage:{items:[],sourceCoverage:{issuerSymbols:'AAPL'}}};return json(malformedPayload?malformed[malformedPayload]:payload());}
  if(name==='manifest.json'||name==='manifest-free.json')return json(manifest);
  if(name)return json({});
  if(u.pathname.startsWith('/api/'))return json({items:[],quotes:[],entries:[]});
  if(u.pathname.startsWith('/_vercel/'))return res.end('');
  const path=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!path.startsWith(root+'/')){res.statusCode=403;return res.end();}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
console.log('Starting local browser on '+base);
const browser=await chromium.launch({timeout:15000,headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
  for(const width of [1366,390]) for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',timezoneId:width===390?'Pacific/Kiritimati':'America/New_York'});
    const page=await context.newPage(), errors=[];
    await page.addInitScript(theme=>{localStorage.setItem('stonks-theme',theme);const actualNow=Date.now.bind(Date);window.__newsClockOffset=0;Date.now=()=>actualNow()+window.__newsClockOffset;},theme);
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({body:''}));
    await page.goto(base+'/?tab=news',{waitUntil:'domcontentloaded',timeout:15000});
    await page.locator('#news-feed-root .news-feed-item').first().waitFor({timeout:10000}).catch(async e=>{console.log(JSON.stringify({errors,location:page.url(),body:(await page.locator('body').innerText()).slice(-2200),news:await page.locator('#news-feed-root').innerHTML()}));await page.screenshot({path:resolve(output,'failure.png')});throw e;});
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),4);
    assert.equal(await page.locator('#news-feed-root').getByText('Context only · not scored',{exact:true}).count(),4);
    assert.equal(await page.locator('#news-feed-root').getByText('Company announcement',{exact:true}).count(),1);
    assert.equal(await page.locator('#news-feed-root').getByText('Recorded FDA action',{exact:true}).count(),1);
    assert.match(await page.locator('#news-feed-summary').innerText(),/FDA sponsor coverage: LLY/);
    const eia=page.locator('.news-feed-item').filter({hasText:'412,517 thousand barrels'});
    assert.match(await eia.innerText(),/unclear/i);
    assert.match(await eia.locator('time').getAttribute('title'),/publication date only/);
    assert.doesNotMatch(await eia.locator('time').getAttribute('title'),/\d:\d/);
    assert.equal(await eia.locator('time').innerText(),new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')));
    await page.locator('#news-feed-search').fill('LLY');
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),1);
    await page.locator('#news-feed-search').fill('');
    await page.locator('[data-news-view="macro"]').click();
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),2);
    await page.locator('[data-news-view=""]').click();
    await page.locator('#news-feed-sort').selectOption('oldest');
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),4,'same-link releases must survive either sort');
    assert.match(await page.locator('#news-feed-root .news-feed-item').first().innerText(),/415,577/);
    await page.locator('#news-feed-sort').selectOption('latest');
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),4);
    await page.getByText('Official source checks',{exact:true}).click();
    assert.equal(await page.locator('#news-feed-summary li').count(),3);
    for(const size of [width,1920,390,width]){
      await page.setViewportSize({width:size,height:1000});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),size+'px no page overflow');
    }
    await page.screenshot({path:resolve(output,'news-'+width+'-'+theme+'.png'),fullPage:false});
    sourceError=true;
    await page.reload();
    await page.locator('#news-feed-root .news-feed-item').first().waitFor();
    assert.match(await page.locator('#news-feed-summary').innerText(),/3 official source check\(s\) unavailable/);
    assert.equal(await page.locator('#news-feed-root').getByText('Carried forward',{exact:true}).count(),4);
    emptySlate=true;
    await page.reload();
    await page.getByText('Official source coverage is incomplete',{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('#news-feed-summary').innerText(),/quiet slate|No high-impact/);
    sourceError=false; sourcePartial=true;
    await page.reload();
    await page.getByText('Official source coverage is incomplete',{exact:true}).waitFor();
    sourcePartial=false;
    await page.reload();
    await page.getByText('No high-impact stories in the collected 24-hour slate',{exact:true}).waitFor();
    emptySlate=false;
    for(const bad of ['missing','rows','health','coverage']){
      malformedPayload=bad;
      await page.reload();
      await page.locator('#news-feed-root .news-feed-error').waitFor();
      assert.equal(await page.locator('#news-feed-summary').innerText(),'');
    }
    malformedPayload=false;
    await page.reload();
    await page.locator('#news-feed-root .news-feed-item').first().waitFor();
    apiError=true;
    await page.evaluate(()=>{window.__newsClockOffset=31*60*1000;});
    const reenter=async()=>{await page.locator('[data-page-tab="home"]').first().dispatchEvent('click');await page.locator('[data-page-tab="news"]').first().dispatchEvent('click');};
    await reenter();
    await page.getByText('News refresh failed. Showing the earlier collected slate with its original dates.',{exact:true}).waitFor();
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),4);
    apiError=false;
    await reenter();
    await page.getByText('News refresh failed. Showing the earlier collected slate with its original dates.',{exact:true}).waitFor({state:'detached'});
    await page.locator('#news-more-filters summary').click();
    await page.locator('#news-feed-category').selectOption('regulatory');
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),1);
    energyOnly=true;
    await page.evaluate(()=>{window.__newsClockOffset+=31*60*1000;});
    await reenter();
    await page.waitForFunction(()=>document.getElementById('news-feed-category').value==='');
    assert.equal(await page.locator('#news-feed-root .news-feed-item').count(),2,'removed category cannot leave a hidden active filter');
    energyOnly=false;
    assert.deepEqual(errors,[],'no uncaught browser errors');
    console.log(width+'px '+theme+': labels, dates, filters, same-link releases, resize, empty/partial/outage/malformed states and refresh recovery passed');
    await context.close();
  }
  console.log('Browser screenshots: '+output);
}finally{await browser.close();await new Promise(r=>server.close(r));}

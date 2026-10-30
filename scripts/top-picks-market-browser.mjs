// Shipped assets with real Top Picks construction and synthetic source evidence.
// No provider, account, broker or production storage is contacted.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createWebullPreview} from './webull-review-preview.mjs';
import {webullReviewFixture} from './fixtures/webull-review.mjs';
import {entryPolicyFixture} from './entry-policy-smoke.mjs';
import {buildTopPicks,buildTopPicksPayload} from './build.mjs';
import {topPicksMarket,topPicksMarketSources} from '../lib/top-picks-market.mjs';
import {advanceMarketStudy,marketStudyView,unavailableMarketStudyView} from '../lib/top-picks-market-study.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const now=new Date().toISOString();
const macro={state:'neutral',stress:0,dataQuality:{sufficient:true},axes:{indexes:{score:0,available:true},vix:{score:0,available:true}},inputs:{indexes:{asOf:now,spy:{pctChange1d:0},qqq:{pctChange1d:0}},vix:{asOf:now,value:18}}};
const assessment=topPicksMarket.assess({macroRegime:macro,asOf:now,...topPicksMarketSources({macro,asOf:now,
 heatmap:{builtAtIso:now,tickers:[{ch:1,mc:10},{ch:-1,mc:10}]},volume:{scannedAt:now,tickers:[{sector:'A',eod:{flagged:true,dayMovePct:1}},{sector:'B',eod:{flagged:true,dayMovePct:-1}}]},
 overnight:{builtAtIso:now,tone:{label:'mixed'}},gamma:{net:1,asOf:now}})});
const {row,data,aiThesis}=entryPolicyFixture();
const picks=buildTopPicks({FIXTURE:data},[],null,null,{macroRegime:macro},null,.045,{marketAssessment:assessment,preScored:{scored:[row],peerIndex:{},regimeBand:'neutral'},aiThesisMap:{'FIXTURE:call':aiThesis}});
const payload=buildTopPicksPayload(picks,now);
let study=null;
for(let i=1;i<=15;i++)study=advanceMarketStudy(study,{publication:true,builtAtIso:'2026-09-'+String(i).padStart(2,'0')+'T15:00:00Z',assessment,decisions:[
 {symbol:'AAA',side:'call',spot:100,selected:false,marketState:'risk-off',policies:{legacy:{eligible:true},labels:{eligible:true},combined:{eligible:false}}},
 {symbol:'BBB',side:'put',spot:100,selected:true,marketState:'risk-off',policies:{legacy:{eligible:true},labels:{eligible:true},combined:{eligible:true}}}
]});
const bars=Array.from({length:29},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),c:100-i*.3}));
study=advanceMarketStudy(study,{builtAtIso:'2026-10-01T00:00:00Z',chains:{AAA:{_bars:bars},BBB:{_bars:bars}}});
const record={...webullReviewFixture(Date.now()).accuracy,marketStudy:marketStudyView(study)};
const preview=await createWebullPreview();
const output=process.env.TOP_PICKS_MARKET_BROWSER_OUT||resolve(tmpdir(),'stonks-top-picks-market-browser');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
let requests=0;
try{
 for(const [width,theme]of[[1440,'light'],[390,'light'],[1440,'dark'],[390,'dark']]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>{localStorage.setItem('stonks-theme',t);localStorage.setItem('stonks-acc-tab','market-policy');},theme);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{enabled:true,authed:true,authenticated:true,trackRecord:true,topPicks:true,user:{name:'Synthetic market-policy preview'}}}));
  await page.route('**/api/auth/top-picks',route=>{requests++;return route.fulfill({json:payload});});
  await page.route('**/api/auth/track-record-data?**',route=>new URL(route.request().url()).searchParams.get('key')==='picks-accuracy.json'?route.fulfill({json:record}):route.fulfill({json:{}}));
  await page.goto(preview.base+'/?tab=picks');
  await page.locator('.tpm-scores').first().waitFor();
  assert.match(await page.locator('.tpm-scores').first().innerText(),/Stock conviction[\s\S]*Market trade score/);
  await page.locator('.tpm-evidence > summary').click();
  assert.match(await page.locator('.tpm-evidence').innerText(),/Heatmap[\s\S]*Volume[\s\S]*Overseas Markets/);
  await page.locator('.tpm-evidence > summary').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Top Picks fits the viewport');
  const layout=await page.locator('.pick-tab-card').first().evaluate(el=>{const head=el.querySelector('.ptc-head').getBoundingClientRect(),scores=el.querySelector('.tpm-scores').getBoundingClientRect();return {headBottom:head.bottom,scoreTop:scores.top};});
  assert(layout.headBottom<=layout.scoreTop,'The conviction strip occupies its own row below the heading');
  await page.locator('#picks-section').getByRole('button',{name:'Table',exact:true}).click();
  assert.match(await page.locator('#picks-grid').innerText(),/Stock conviction[\s\S]*Market trade score[\s\S]*Market multiplier/i);
  await page.locator('#picks-section').getByRole('button',{name:'Cards',exact:true}).click();
  if(width===1440&&theme==='light'){
   const download=page.waitForEvent('download');await page.locator('#picks-export-csv').click();
   const csv=await readFile(await(await download).path(),'utf8');
   assert.match(csv,/stockConviction[\s\S]*marketTradeScore[\s\S]*marketMultiplier[\s\S]*entryStatus/);
  }
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:resolve(output,'picks-'+width+'-'+theme+'.png'),fullPage:true});
  await page.goto(preview.base+'/?tab=track');
  await page.locator('#acc-tab-market-policy').click();
  await page.locator('#an-market-policy .tpm-table').waitFor();
  assert.match(await page.locator('#an-market-policy').innerText(),/Previous policy[\s\S]*Market labels[\s\S]*Market \+ confirmation/);
  await page.locator('[data-market-horizon="5"]').click();
  assert.equal(await page.locator('[data-market-horizon="5"]').getAttribute('aria-pressed'),'true');
  await page.locator('#an-market-policy summary').click();
  assert.match(await page.locator('#an-market-policy').innerText(),/not executed portfolios|not an independently/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Page fits the viewport; comparison table scrolls within its own container');
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:resolve(output,'study-'+width+'-'+theme+'.png'),fullPage:true});
  assert.deepEqual(errors,[],'No browser exceptions');await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(now)});
 await page.route('**/api/auth/me',r=>r.fulfill({json:{enabled:true,authed:true,authenticated:true,trackRecord:true,topPicks:true}}));
 await page.route('**/api/watchlist',r=>r.fulfill({json:{items:[{pick:{...payload.picks[0],symbol:'SAVED'},stale:true,lastSeen:'2026-10-01'}]}}));
 let fail=false;
 await page.route('**/api/auth/top-picks',r=>r.fulfill(fail?{status:503,json:{error:'Synthetic unavailable review'}}:{json:payload}));
 await page.goto(preview.base+'/?tab=picks');
 await page.locator('[data-pick-open="SAVED"]').waitFor();
 assert.match(await page.locator('[data-pick-open="SAVED"] .tpm-scores strong').innerText(),/Saved snapshot requires a fresh Top Picks review/);
 await page.locator('[data-pick-open="SAVED"]').click();
 assert.match(await page.locator('#picks-detail-card .tpm-scores strong').innerText(),/Saved snapshot/);
 await page.locator('#picks-back').click();await page.locator('[data-pick-open="FIXTURE"]').click();
 await page.locator('#picks-detail-card .tpm-scores').waitFor();fail=true;
 await page.clock.runFor(61000);
 await page.locator('#picks-detail-card .tpm-scores strong').waitFor();
 assert.match(await page.locator('#picks-detail-card .tpm-scores strong').innerText(),/approval unavailable/,'An unavailable review holds an already-open detail view');
 const pausedRecord={...record,marketStudy:unavailableMarketStudyView(record.marketStudy,{builtAtIso:now,publication:true})};
 await page.route('**/api/auth/track-record-data?**',r=>r.fulfill({json:pausedRecord}));
 await page.goto(preview.base+'/?tab=track');await page.locator('#acc-tab-market-policy').click();
 await page.getByText('Measurement paused.',{exact:true}).waitFor();
 assert.match(await page.locator('#an-market-policy').innerText(),/Previous policy/,'Previous measurement reports remain visible during a storage failure');
 assert.deepEqual(errors,[],'Failure and saved-snapshot paths have no browser exceptions');
 await page.close();
 console.log('Top Picks scores and Market policy measurement passed at desktop/mobile in light/dark. Screenshots: '+output+'; approval requests: '+requests);
}finally{await browser.close();await new Promise(r=>preview.server.close(r));}

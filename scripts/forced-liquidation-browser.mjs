import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createLiquidationPreview} from './forced-liquidation-preview.mjs';
import {liquidationFixtureNow,liquidationFixtureBase} from './fixtures/forced-liquidation.mjs';
import {buildForcedLiquidationPayload,LIQUIDATION_EVIDENCE_VERSION} from '../lib/forced-liquidation.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const preview=await createLiquidationPreview(),output=process.env.QA_OUTPUT||resolve(tmpdir(),'stonks-forced-liquidation-browser');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};
async function newPage(width=1440,theme='dark'){
  const context=await browser.newContext({viewport:{width,height:1100},acceptDownloads:true}),page=await context.newPage();
  await page.clock.install({time:new Date(liquidationFixtureNow)});
  await page.addInitScript(t=>localStorage.setItem('stonks-theme',t),theme);
  await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.fulfill({body:''}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  return {context,page,errors,root:page.locator('#forced-liquidation-root')};
}
try{
  // Awareness-only quantities must survive the full browser, history and CSV path.
  for(const width of [1440,390])for(const theme of ['dark','light']){
    preview.setScenario('owner');const {context,page,root,errors}=await newPage(width,theme);
    const b={...liquidationFixtureBase,borrower:null,facilityKey:null,principalBorrowed:null,principalBasis:'undisclosed',currency:'unresolved',maintenanceLtv:null,sharesPledged:null,shareBasis:'undisclosed',collateralBasis:'unspecified'};
    const observations=[
      {...b,symbol:'ATLS',company:'Zulu Holdings',fragmentId:0,disclosedShares:500000,disclosedShareBasis:'stated-current'},
      {...b,symbol:'GAPS',company:'Alpha Holdings',fragmentId:1,disclosedShares:25000,disclosedShareBasis:'incremental-only'},
      {...b,symbol:'ATLS',company:'Zulu Holdings',fragmentId:2,disclosedShares:500000,disclosedShareBasis:'stated-current'},
      {...b,symbol:'SCEN',company:'Unverified collateral',fragmentId:3,disclosedShares:999000,disclosedShareBasis:'stated-current',issuerVerified:false},
    ];
    const payload=buildForcedLiquidationPayload({observations,coverage:preview.payload.coverage,builtAtIso:liquidationFixtureNow});
    await page.route('**/api/auth/me?data=forced-liquidation.json',route=>route.fulfill({json:payload}));
    await page.goto(preview.base+'/?tab=forced-liquidation');await root.locator('.fl-table').waitFor();
    ok(await root.locator('.fl-table tbody tr').count()===3,'known pledges stay visible without loan terms or quotes');
    ok((await root.locator('.fl-metric').first().innerText()).includes('Stocks with pledges\n2'),'stock count deduplicates repeated excerpts');
    ok((await root.innerText()).includes('Pledge disclosed')&&!(await root.innerText()).includes('Needs loan terms'),'presence is explicit rather than blocked on complete terms');
    ok((await root.innerText()).includes('500,000')&&(await root.innerText()).includes('Additional shares; total unknown'),'disclosed quantities retain their basis');
    ok(!(await root.innerText()).includes('999,000'),'unverified collateral is not promoted into a known stock pledge');
    await root.locator('[data-fl-sort-key="shares"]').click();
    ok((await root.locator('.fl-table tbody [data-fl-open]').allTextContents()).join(',')==='ATLS,ATLS,GAPS','share sort uses displayed disclosed quantity');
    await root.locator('[data-fl-sort-key="company"]').click();
    ok((await root.locator('.fl-table tbody [data-fl-open]').allTextContents()).join(',')==='GAPS,ATLS,ATLS','company sort uses company name rather than ticker order');
    const downloadPromise=page.waitForEvent('download');await root.locator('[data-fl-export]').click();const download=await downloadPromise,csv=await readFile(await download.path(),'utf8');
    ok(csv.includes('pledge_disclosed')&&csv.includes('disclosed_shares')&&csv.includes('disclosed_share_basis'),'CSV includes awareness and amount provenance');
    const lines=csv.split('\r\n'),columns=lines[0].split(',').map(c=>c.replaceAll('"','')),values=lines[1].split(',').map(c=>c.replaceAll('"',''));
    ok(values[columns.indexOf('disclosed_shares')]==='25000'&&values[columns.indexOf('shares_pledged')]==='','CSV keeps disclosed addition separate from unknown current model total');
    await root.locator('[data-fl-open]').filter({hasText:'ATLS'}).first().click();await root.locator('.fl-detail').waitFor();
    ok((await root.locator('.fl-history').innerText()).includes('500,000'),'detail and history retain the same disclosed amount');
    ok((await root.innerText()).includes('Needed to estimate liquidation:'),'missing terms describe the estimate requirement');
    const heading=await root.locator('.fl-detail h3').boundingBox();ok(heading.y>=100&&heading.y<1000,'opened detail heading clears the fixed navigation');
    await page.screenshot({path:resolve(output,'awareness-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-close]').click();await root.locator('[data-fl-filter]').selectOption('all');
    ok(await root.locator('.fl-table tbody tr').count()===4&&(await root.innerText()).includes('Stock attribution unverified'),'unresolved attribution remains reviewable separately');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'awareness layout fits the viewport');
    ok(errors.length===0,'awareness has no browser errors');await context.close();
  }
  // A legacy extraction must not revive a pledge that its source says was released.
  {
    preview.setScenario('owner');const {context,page,root}=await newPage(),payload=structuredClone(preview.payload);
    const row=payload.rows.find(r=>r.symbol==='ATLS');row.observation.status='released';row.observation.parserVersion=LIQUIDATION_EVIDENCE_VERSION-1;
    await page.route('**/api/auth/me?data=forced-liquidation.json',route=>route.fulfill({json:payload}));
    await page.goto(preview.base+'/?tab=forced-liquidation');await root.locator('.fl-table').waitFor();
    ok(!(await root.locator('.fl-table').innerText()).includes('ATLS'),'released legacy pledge stays out of default watchlist');
    await root.locator('[data-fl-filter]').selectOption('all');ok((await root.innerText()).includes('Pledge released'),'released history stays reviewable');
    await context.close();
  }
  // A retained server snapshot may still contain names removed from the universe.
  {
    preview.setScenario('owner');const {context,page,root}=await newPage();
    const payload=structuredClone(preview.payload),extra=structuredClone(payload.rows[0]);
    extra.symbol='ADUR';extra.id='off-universe';extra.observation.symbol='ADUR';extra.company='Off-universe regression';
    payload.rows.push(extra);payload.summary.tracked++;
    await page.route('**/api/auth/me?data=forced-liquidation.json',route=>route.fulfill({json:payload}));
    await page.goto(preview.base+'/?tab=forced-liquidation',{waitUntil:'domcontentloaded'});await root.locator('.fl-table').waitFor();
    ok(!await root.innerText().then(t=>t.includes('ADUR')),'retained off-universe stock is absent from watchlist');
    const downloadPromise=page.waitForEvent('download');await root.locator('[data-fl-export]').click();const download=await downloadPromise;
    const csv=await readFile(await download.path(),'utf8');ok(!csv.includes('ADUR'),'CSV excludes retained off-universe stocks');
    await root.locator('[data-fl-view="evidence"]').click();ok(!(await root.innerText()).includes('ADUR'),'filing evidence excludes retained off-universe stocks');
    await root.locator('[data-fl-view="watch"]').click();await root.locator('[data-fl-search]').fill('ADUR');ok(await root.locator('.fl-table tbody tr').count()===0,'search cannot recover an excluded stock');
    await context.close();
  }
  for(const width of [1440,900,390])for(const theme of ['dark','light']){
    preview.setScenario('owner');const {context,page,root,errors}=await newPage(width,theme);
    await page.goto(preview.base+'/?tab=forced-liquidation',{waitUntil:'domcontentloaded'});
    await root.locator('.fl-table').waitFor();
    ok(await page.locator('#page-pane-forced-liquidation').isVisible());
    ok((await root.locator('.fl-table tbody tr').count())===3,'active filter excludes corporate debt context');
    ok((await root.innerText()).includes('9.1%'));
    ok((await root.innerText()).includes('Scenario $15.38–$28.57'));
    const typing=root.locator('[data-fl-search]');await typing.pressSequentially('ATLS');ok(await typing.inputValue()==='ATLS','ordinary keystrokes preserve character order');
    // Home has platform-dependent scrolling behavior in native search fields.
    for(let i=0;i<4;i++)await typing.press('ArrowLeft');
    await typing.press('ArrowRight');await typing.pressSequentially('XY');ok(await typing.inputValue()==='AXYTLS','typing into the middle preserves the caret');await typing.fill('');
    await root.locator('[data-fl-sort-key="company"]').click();
    ok((await root.locator('.fl-table tbody [data-fl-open]').allTextContents()).join(',')==='ATLS,GAPS,SCEN','header uses actual company values');
    await root.locator('[data-fl-sort-key="company"]').click();
    const sorted=await root.locator('.fl-table tbody [data-fl-open]').allTextContents();ok(sorted.join(',')==='SCEN,GAPS,ATLS','header reverses sort');
    const sortedDownloadEvent=page.waitForEvent('download');await root.locator('[data-fl-export]').click();const sortedDownload=await sortedDownloadEvent,sortedCsv=await readFile(await sortedDownload.path(),'utf8');
    ok(sortedCsv.split('\r\n').slice(1).map(line=>line.match(/^"([^"]*)"/)[1]).join(',')===sorted.join(','),'CSV matches visible sort order');
    ok(sortedCsv.includes('quote_fresh')&&sortedCsv.includes('sec_scan_status'),'CSV carries uncertainty and source state');
    await page.reload();await root.locator('.fl-table').waitFor();ok((await root.locator('.fl-table tbody [data-fl-open]').allTextContents()).join(',')==='SCEN,GAPS,ATLS','header sort persists');
    await root.locator('[data-fl-sort]').selectOption('distance');ok(await root.locator('[data-fl-sort-key="distance"]').locator('..').getAttribute('aria-sort')==='ascending','sort menu takes control of sorting');
    await root.locator('[data-fl-view="watch"]').focus();await page.keyboard.press('ArrowRight');ok(await root.locator('[data-fl-view="funds"]').getAttribute('aria-selected')==='true','keyboard changes view');
    await page.keyboard.press('End');ok(await root.locator('[data-fl-view="method"]').getAttribute('aria-selected')==='true');await page.keyboard.press('Home');
    await root.locator('[data-fl-filter]').selectOption('topups');ok((await root.locator('.fl-table tbody tr').count())===1);
    await root.locator('[data-fl-open]').click();await root.locator('.fl-detail').waitFor();
    ok((await root.innerText()).includes('Possible collateral top-up'));
    ok((await root.innerText()).includes('500%'));
    ok((await root.locator('.fl-history tbody tr').count())===2,'comparable disclosure history retained');
    await root.locator('[data-fl-ltv]').selectOption('0.65');ok((await root.locator('.fl-scenario').innerText()).includes('$15.38'));
    await page.reload();await root.locator('.fl-detail').waitFor();ok((await root.locator('[data-fl-ltv]').inputValue())==='0.65','detail and LTV choice persist');
    ok((await root.locator('.fl-excerpt').innerText()).includes('SYNTHETIC TEST DATA'));
    ok((await root.locator('.fl-detail a').first().getAttribute('href')).startsWith('https://www.sec.gov/Archives/edgar/data/'));
    await root.locator('[data-fl-close]').click();await root.locator('[data-fl-filter]').selectOption('active');
    await root.locator('[data-fl-search]').fill('ATLS');ok((await root.locator('.fl-table tbody tr').count())===1);
    const downloadEvent=page.waitForEvent('download');await root.locator('[data-fl-export]').click();const download=await downloadEvent,csv=await readFile(await download.path(),'utf8');
    ok(csv.includes('outstanding_principal_usd')&&csv.includes('quote_as_of')&&csv.includes('"ATLS"'));ok(!csv.includes('"SCEN"'),'export honors filters');
    await root.locator('[data-fl-search]').fill('');await root.locator('[data-fl-filter]').selectOption('all');
    ok((await root.locator('.fl-table tbody tr').count())===4);
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
    await page.screenshot({path:resolve(output,'watch-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-view="evidence"]').click();ok((await root.locator('.fl-evidence').count())===4);
    await page.reload();await root.locator('.fl-evidence').first().waitFor();ok((await root.locator('[data-fl-view="evidence"]').getAttribute('aria-selected'))==='true','view persists');
    await root.locator('[data-fl-view="method"]').click();ok((await root.innerText()).includes('Trigger price = outstanding loan ÷ (pledged shares × maintenance LTV)'));
    await root.locator('[data-fl-view="funds"]').click();await root.locator('[data-fl-fund]').first().waitFor();
    ok((await root.locator('[data-fl-fund]').count())===2,'hot funds listed');ok((await root.innerText()).includes('Alert · 40%+'),'alert level shown');
    ok((await root.innerText()).includes('Our stocks held by hot funds'),'stock links shown');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:resolve(output,'funds-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-fund]').first().click();await root.locator('.fl-detail').waitFor();
    ok((await root.locator('.fl-detail tbody tr').count())===6,'top holdings listed');ok((await root.locator('.fl-detail a').first().getAttribute('href')).startsWith('https://www.sec.gov/'),'filing links stay on sec.gov');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fund detail fits');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:resolve(output,'fund-detail-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-fund-close]').click();await root.locator('[data-fl-view="rebalance"]').click();
    ok((await root.innerText()).includes('Sell $57'),'rebalance estimate shown');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:resolve(output,'rebalance-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-view="clusters"]').click();ok((await root.innerText()).includes('Cluster selloff flagged today'),'cluster read shown');ok((await root.innerText()).includes('Shadow signal'),'cluster labeled shadow');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'clusters fit');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:resolve(output,'clusters-'+width+'-'+theme+'.png'),fullPage:false});
    await root.locator('[data-fl-view="method"]').click();
    for(const nextWidth of [390,1024,width]){await page.setViewportSize({width:nextWidth,height:1100});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'resize fits '+nextWidth);}
    await root.locator('[data-fl-view="watch"]').click();await page.reload();await root.locator('.fl-table').waitFor();
    await page.goto(preview.base+'/?tab=picks',{waitUntil:'domcontentloaded'});await page.locator('#picks-liquidation-watch').waitFor();
    ok((await page.locator('#picks-liquidation-watch').innerText()).includes('new bullish pick blocked'));
    ok((await page.locator('#picks-liquidation-watch a').getAttribute('href'))==='?tab=forced-liquidation');
    ok(errors.length===0,'no runtime errors: '+errors.join('; '));await context.close();
  }
  for(const scenario of ['anonymous','tp-only','tr-only','disabled']){
    preview.setScenario(scenario);const before=preview.requests,{context,page}=await newPage();
    await page.goto(preview.base+'/?tab=forced-liquidation',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.documentElement.dataset.ownerAuthResolved==='true'||document.querySelector('#page-pane-home:not([hidden])'));
    ok(!(await page.locator('#page-pane-forced-liquidation').isVisible()),scenario+' cannot see the feature');
    ok(preview.requests===before,scenario+' makes no private tracker request');await context.close();
  }
  for(const scenario of ['error','missing','malformed','empty','stale','null-price','legacy','old-facts','stale-volume']){
    preview.setScenario(scenario);const {context,page,root,errors}=await newPage();
    await page.goto(preview.base+'/?tab=forced-liquidation',{waitUntil:'domcontentloaded'});
    if(scenario==='empty'){await root.locator('[data-fl-view]').first().waitFor();ok((await root.innerText()).includes('not evidence that the market has no pledged stock'));ok((await root.innerText()).includes('Unassessed'),'no modeled observations is not zero risk');}
    else if(scenario==='stale'){await root.locator('.fl-table').waitFor();ok(!(await root.innerText()).includes('9.1%'),'stale quote cannot show a current buffer');ok(/SEC unavailable|Incomplete SEC scan/.test(await root.innerText()));ok((await root.innerText()).includes('Stale stock quote'));}
    else if(scenario==='null-price'){await root.locator('.fl-table').waitFor();ok(!(await root.innerText()).includes('9.1%'),'a missing price cannot become a current buffer');ok((await root.innerText()).includes('Stale stock quote'));}
    else if(scenario==='legacy'){await root.locator('.fl-table').waitFor();ok(!(await root.innerText()).includes('9.1%'),'old parser output cannot retain a trigger');ok((await root.locator('.fl-table tbody tr').count())===3,'legacy debt context stays out of active pledges');ok((await root.innerText()).includes('Unassessed'),'unknown terms cannot become a zero-risk count');}
    else if(scenario==='old-facts'){await root.locator('.fl-table').waitFor();ok(!(await root.innerText()).includes('Possible collateral top-up'),'expired disclosures cannot advertise a fresh top-up');ok((await root.locator('.fl-table tbody tr').count())===3);}
    else if(scenario==='stale-volume'){await root.locator('.fl-table').waitFor();ok(!(await root.innerText()).includes('500%'),'old volume cannot supply a current liquidity ratio');ok(!(await root.innerText()).includes('Pledge >20%'));}
    else{await root.locator('[data-fl-retry]').waitFor();ok((await root.innerText()).includes(scenario==='missing'?'not been collected':scenario==='malformed'?'incomplete':'unavailable'));preview.setScenario('owner');await root.locator('[data-fl-retry]').click();await root.locator('.fl-table').waitFor();ok((await root.innerText()).includes('9.1%'));}
    ok(errors.length===0,scenario+' has no runtime errors');await context.close();
  }
  preview.setScenario('owner');{
    const {context,page,root}=await newPage();await page.goto(preview.base+'/?tab=forced-liquidation');await root.locator('.fl-table').waitFor();const before=preview.requests;
    await page.clock.fastForward(5*86400000);ok(!(await root.innerText()).includes('9.1%'),'open-page quotes expire at their known deadline');ok((await root.innerText()).includes('Unassessed'),'failed freshness is not presented as zero risk');ok(preview.requests===before,'expiry does not poll providers');
    const blocked=await page.request.get(preview.base+'/r2.env');ok(blocked.status()===404,'preview cannot serve local credentials');await context.close();
  }
  preview.setScenario('currency-history');{
    const {context,page,root}=await newPage();await page.goto(preview.base+'/?tab=forced-liquidation');await root.locator('.fl-table').waitFor();await root.locator('[data-fl-open]').first().click();await root.locator('.fl-history').waitFor();
    const firstAmount=root.locator('.fl-history tbody tr').first().locator('td').nth(1);ok((await firstAmount.innerText()).includes('currency unverified'),'history does not turn an unknown currency into USD');ok(!(await firstAmount.innerText()).includes('$'),'history cannot prefix an unverified balance with dollars');await context.close();
  }
  console.log(`Forced Liquidation Tracker browser: ${checks} checks passed across desktop, tablet, phone, both themes, resize, persistence, scenarios, export, retries, stale data, Top Picks and Owner visibility. Screenshots: ${output}`);
}finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));}

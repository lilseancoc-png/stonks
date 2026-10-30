import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createOwnerMarketBriefPreview } from './owner-market-brief-preview.mjs';
import { OWNER_BRIEF_FIXTURE_TIME } from './fixtures/owner-market-brief.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const preview=await createOwnerMarketBriefPreview(),output=process.env.QA_OUTPUT||resolve(tmpdir(),'stonks-owner-brief-browser');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
let checks=0;
const check=(v,label)=>{assert(v,label);checks++;};
try {
  for(const width of [1440,768,390,320])for(const theme of ['light','dark']){
    preview.setScenario('owner');
    const page=await browser.newPage({viewport:{width,height:1050}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date(OWNER_BRIEF_FIXTURE_TIME)});
    await page.addInitScript(v=>localStorage.setItem('stonks-theme',v),theme);
    await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.abort());
    await page.goto(preview.base+'/?tab=owner-market-brief');
    const root=page.locator('#owner-market-brief-root');
    await root.locator('.omb-idea').first().waitFor();
    check(await page.locator('#page-pane-owner-market-brief').isVisible(),'Owner deep link');
    check((await root.innerText()).includes('Synthetic public foundation'),'Complete Market Brief foundation');
    check((await root.locator('#omb-coverage').innerText()).includes('daily observation'),'Daily source dates keep their precision');
    await root.locator('.omb-jumps a').first().focus();await page.keyboard.press('Enter');
    check(await page.evaluate(()=>document.activeElement.id==='omb-outlook'),'Keyboard jump focuses the destination');
    check(await root.locator('.brief-card').count()===1,'Existing public renderer reused');
    check((await root.innerText()).includes('Market and breadth disagree'),'Disagreement is visible');
    check((await root.innerText()).includes('What challenges it'),'Counterevidence visible');
    check(/what would confirm it/i.test(await root.innerText()),'Conditional scenarios');
    check((await root.innerText()).includes('Forecast cutoff'),'Forecast cutoff visible');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Fits viewport '+width);
    if(width===1440||width===390)await page.screenshot({path:resolve(output,`owner-brief-${width}-${theme}.png`),fullPage:false,animations:'disabled'});
    if(width===1440||width===390){await root.locator('#omb-outlook').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,`owner-brief-outlook-${width}-${theme}.png`),animations:'disabled'});}
    await root.locator('[data-omb-symbol="BULL"]').click();
    await page.locator('#unified-signal-root .use-decision-head').waitFor();
    check((await page.locator('#unified-signal-root .use-decision-head').innerText()).includes('BULL'),'Ticker review opens the selected assessment');
    await page.goto(preview.base+'/?tab=owner-market-brief');await root.locator('.omb-idea').first().waitFor();
    await root.locator('[data-omb-go="market"]').first().click();
    check(await page.locator('#page-pane-market').isVisible(),'Source navigation');
    await page.goto(preview.base+'/?tab=owner-market-brief');await root.locator('.omb-idea').first().waitFor();
    await page.clock.fastForward(61*60000);
    check(!(await root.innerText()).includes('Review the existing qualified plan'),'Approval expires in an open browser');
    preview.setScenario('revoked');await root.locator('[data-omb-refresh]').click();
    await root.locator('.omb-idea').first().waitFor({state:'detached'});
    check(!(await page.locator('body').innerText()).includes('Synthetic public foundation'),'Revoked session clears private content');
    check(errors.length===0,errors.join('\n'));
    await page.close();
  }
  for(const scenario of ['anonymous','tp-only','tr-only','disabled','stale','empty','missing','error','malformed','malformed-path','malformed-foundation','malformed-support']){
    preview.setScenario(scenario);const before=preview.requests;
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date(OWNER_BRIEF_FIXTURE_TIME)});
    await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.abort());
    await page.goto(preview.base+'/?tab=owner-market-brief');
    if(['anonymous','tp-only','tr-only','disabled'].includes(scenario)){
      await page.waitForFunction(()=>!document.querySelector('#page-pane-owner-market-brief'));
      check(preview.requests===before,'No private read for '+scenario);
    }else {
      const root=page.locator('#owner-market-brief-root');
      await root.locator(scenario==='stale'?'.omb-warning':scenario==='empty'?'.omb-lead':'.omb-empty h3').waitFor();
      check(await root.locator('.omb-idea').count()===0,'No actionable shortlist for '+scenario);
      if(scenario==='stale'){check(await root.locator('.brief-decision').count()===0,'Expired report withholds the saved trading playbook');check(!(await root.innerText()).includes('Synthetic public foundation'),'Expired public narrative is withheld');check(await root.locator('.omb-findings article').count()===0,'Expired Owner instructions are withheld');}
      if(scenario==='error'||scenario==='missing'){preview.setScenario('owner');await root.locator('[data-omb-refresh]').click();await root.locator('.omb-idea').first().waitFor();check(true,'Retry recovers');}
    }
    check(errors.length===0,'No page error for '+scenario+': '+errors.join(' · '));
    await page.close();
  }
  // A row quote expires before the parent snapshot and a bad refresh keeps the
  // previous readable report instead of crashing or replacing it.
  preview.setScenario('quote-expiry');
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date(OWNER_BRIEF_FIXTURE_TIME)});
  await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.abort());
  await page.goto(preview.base+'/?tab=owner-market-brief');
  const root=page.locator('#owner-market-brief-root');await root.locator('.omb-idea').first().waitFor();
  check((await root.locator('.omb-idea').first().innerText()).includes('Qualified at source build'),'Row is qualified before its earlier expiry');
  await page.clock.fastForward(60000);
  check((await root.locator('.omb-idea').first().innerText()).includes('approval expired'),'Earlier quote expiry updates the visible card');
  check(!(await root.innerText()).includes('approval is still'),'Source summary never claims live approval');
  preview.setScenario('malformed-path');await root.locator('[data-omb-refresh]').click();
  await root.locator('.omb-warning').waitFor();
  check(await root.locator('.omb-idea').count()>0,'Malformed refresh preserves the last readable report');
  check(errors.length===0,'Malformed nested refresh causes no page errors');
  await page.clock.fastForward(24*3600000);
  check(await root.locator('.brief-decision').count()===0,'Open report expiry removes the foundation playbook');
  check(await root.locator('.omb-findings article').count()===0,'Open report expiry removes saved instructions');
  preview.setScenario('no-narrative');await page.clock.setFixedTime(new Date(OWNER_BRIEF_FIXTURE_TIME));
  await page.goto(preview.base+'/?tab=owner-market-brief');await root.locator('.omb-idea').first().waitFor();
  await root.locator('.brief-evidence summary').click();
  check((await root.locator('.brief-card').innerText()).includes('TEST earnings'),'Keyless foundation retains scheduled catalysts');
  check(errors.length===0,'Fallback and report expiry cause no page errors');
  await page.close();
  console.log(`Owner brief browser: ${checks} checks passed; desktop/tablet/phone, light/dark, full public card, source links, expiry, role denial, revocation, missing/stale/error/empty/malformed states. Screenshots: ${output}`);
}finally{await browser.close();await new Promise(r=>preview.server.close(r));}

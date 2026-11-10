import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { UPDATE_FEATURES } from '../lib/update-checker.mjs';
import { createUpdateCheckerPreview,CHECKER_FIXTURE_TIME } from './update-checker-preview.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const preview=await createUpdateCheckerPreview(),output=process.env.QA_OUTPUT||resolve(tmpdir(),'stonks-update-checker-browser');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});let checks=0;
function check(value,label){assert(value,label);checks++;}
async function pageAt(width=1440,theme='dark'){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.clock.install({time:new Date(CHECKER_FIXTURE_TIME)});
  await page.addInitScript(theme=>localStorage.setItem('stonks-theme',theme),theme);
  await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.abort());
  return page;
}
try {
  for(const width of [1440,390,320])for(const theme of ['dark','light']){
    preview.setScenario('owner');const page=await pageAt(width,theme),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(preview.base+'/?tab=update-checker');const root=page.locator('#update-checker-root');
    await root.locator('.uc-feature').first().waitFor();
    const text=await root.innerText();
    check(text.includes('Verify party control history'),'Failed step visible');
    check(text.includes('Site generation: skipped'),'Skipped build explained');
    check(text.includes('missing')&&text.includes('invalid')&&text.includes('stale'),'Partial output failures visible together');
    // The notice is a sidebar row: visible beside the page on desktop, inside
    // the closed menu drawer on phones.
    check(width>=1024?await page.locator('#side-nav #update-checker-notice').isVisible():(await page.locator('#side-nav #update-checker-notice').count())===1,'Owner notice visible');
    check(await root.locator('.uc-feature:visible').count()===3,'Issues filter');
    await root.locator('[data-uc-filter]').selectOption('all');
    check(await root.locator('.uc-feature:visible').count()===UPDATE_FEATURES.length,'Every feature is accounted for');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Fits '+width+' '+theme);
    if(width!==320)await page.screenshot({path:resolve(output,`checker-${width}-${theme}.png`),fullPage:false,animations:'disabled'});
    preview.setScenario('error');await root.locator('[data-uc-refresh]').click();await root.locator('.uc-warning').waitFor();
    check((await root.innerText()).includes('was not refreshed'),'Failed refresh labels previous snapshot');
    preview.setScenario('revoked');await root.locator('[data-uc-refresh]').click();await root.locator('.uc-feature').first().waitFor({state:'detached'});
    check(!(await page.locator('#page-pane-update-checker').isVisible()),'Revocation hides page');
    check(!(await page.locator('#update-checker-notice').count()),'Revocation clears notice');
    check(errors.length===0,errors.join('\n'));await page.close();
  }
  for(const role of ['anonymous','tp-only','tr-only','disabled']){
    preview.setScenario(role);const before=preview.requests,page=await pageAt();await page.goto(preview.base+'/?tab=update-checker');await page.waitForLoadState('networkidle');
    check(!(await page.locator('#page-pane-update-checker').isVisible()),role+' deep link denied');
    check(preview.requests===before,role+' never requests private status');await page.close();
  }
  preview.setScenario('feature-only');let extra=await pageAt();await extra.goto(preview.base+'/?tab=home');await extra.locator('#update-checker-notice').waitFor();check((await extra.locator('#update-checker-notice').innerText()).includes('3 checks'),'Feature-only issues notify owners away from checker');await extra.close();
  preview.setScenario('healthy');extra=await pageAt();await extra.goto(preview.base+'/?tab=update-checker');await extra.locator('.uc-all-clear').waitFor();check((await extra.locator('#update-checker-root').innerText()).includes('No issues detected'),'Healthy run and outputs');check(!(await extra.locator('#update-checker-notice').isVisible()),'Healthy state clears notice');await extra.close();
  preview.setScenario('sources');extra=await pageAt(390);await extra.goto(preview.base+'/?tab=update-checker');
  const sources=extra.locator('#update-checker-root');await sources.locator('.uc-feature:visible').first().waitFor();
  const sourceText=await sources.innerText();
  check(sourceText.includes('AMD (HTTP 403)') && sourceText.includes('ISM') && sourceText.includes('Memory chip prices'),'Actual inspection details reach the status page');
  check(!sourceText.includes('PRIVATE_SENTINEL'),'Private error text is withheld through API and browser');
  check(await sources.locator('.uc-feature:visible').count()===3,'Source failures appear under Needs review');
  preview.setScenario('healthy');await sources.locator('[data-uc-refresh]').click();await sources.locator('.uc-all-clear').waitFor();
  check(await sources.locator('.uc-feature:visible').count()===0,'Recovered source checks clear on refresh');await extra.close();
  for(const [scenario,message] of [['stale-monitor','12 hours otherwise'],['stuck','queued or running for over 90 minutes'],['logs','AI calls failed']]){
    preview.setScenario(scenario);const diagnosticPage=await pageAt();await diagnosticPage.goto(preview.base+'/?tab=update-checker');await diagnosticPage.locator('#update-checker-root h3').first().waitFor();check((await diagnosticPage.locator('#update-checker-root').innerText()).includes(message),scenario+' surfaced');check(await diagnosticPage.locator('#update-checker-notice').isVisible(),scenario+' notice');await diagnosticPage.close();
  }
  preview.setScenario('unknown');let page=await pageAt();await page.goto(preview.base+'/?tab=update-checker');await page.locator('.uc-feature').first().waitFor();check((await page.locator('#update-checker-root').innerText()).includes('No valid workflow report'),'Missing monitor is unknown');await page.close();
  preview.setScenario('hang');page=await pageAt();await page.goto(preview.base+'/?tab=update-checker');await page.clock.fastForward(21000);await page.locator('.uc-warning').waitFor();check(await page.locator('[data-uc-refresh]').isEnabled(),'Timeout permits retry');await page.close();
  console.log('Update Checker browser: '+checks+' checks passed; screenshots '+output);
}finally{await browser.close();await new Promise(done=>preview.server.close(done));}

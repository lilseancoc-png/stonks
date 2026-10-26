// Read-only audit reproductions. No providers, models, store writes or orders.
// Run: node scripts/update-branch-review-audit.mjs [--browser]
// Regression checks for the reviewed extraction and browser failures.
import assert from 'node:assert/strict';
import {extractLiquidationFiling} from '../lib/forced-liquidation-sec.mjs';
import {assessLiquidationObservation,liquidationMarketFromChain} from '../lib/forced-liquidation.mjs';
import {liquidationFixture,liquidationFixtureBase as base,liquidationFixtureNow as now} from './fixtures/forced-liquidation.mjs';
import {buildUnifiedSignalEngine} from '../lib/unified-signal.mjs';
import {unifiedSignalFixture} from './fixtures/unified-signal.mjs';

let passed=0,failed=0;
async function check(name,run){
  try{await run();passed++;console.log('PASS '+name);}
  catch(error){failed++;console.log('FAIL '+name+'\n  '+error.message.split('\n')[0]);}
}
const fixture=liquidationFixture();
const filing={accessionNumber:base.accessionNumber,filingDate:base.filingDate,url:base.url,form:'DEF 14A',cik:'1'};
const issuer={symbol:base.symbol,company:base.company,issuerVerified:true};
const parse=text=>extractLiquidationFiling('<html><p>'+text+'</p></html>',filing,issuer)[0];
const market=liquidationMarketFromChain(fixture.chains.ATLS,now);

await check('Disclosed maintenance terms remain a modeled estimate, control',()=>{
  assert.equal(assessLiquidationObservation(parse(base.excerpt),{market,now,scanHealthy:true}).triggerPrice,20);
});
await check('Origination LTV must not establish a maintenance threshold or entry veto',()=>{
  for(const terms of [
    'The maintenance LTV is not disclosed; maximum LTV at origination is 50%.',
    'At origination, the maximum loan-to-value ratio was 50%.',
    'The maximum allowable LTV at inception was 50%.',
    'The initial maintenance LTV is 50%.',
    'Initially, the maintenance equity margin requirement was 25%.',
    'Maximum permitted LTV is 50%.',
  ]){
    const row=parse(base.excerpt.replace('Maintenance LTV is 50%.',terms));
    const actual=assessLiquidationObservation(row,{market,now,scanHealthy:true});
    assert.equal(row.maintenanceLtv,null,terms);
    assert.equal(actual.triggerPrice,null,terms);
    assert.equal(actual.vetoLong,false,'Origination terms produced an automated bullish veto');
    assert.equal(actual.scenarios.length,3,'Unknown maintenance retains labeled sensitivity scenarios');
  }
});
await check('A preceding option count must not replace the pledged-share count',()=>{
  // Oracle 2026 proxy ownership footnote, SEC accession 0001193125-26-402816.
  // Source: https://www.sec.gov/Archives/edgar/data/1341439/000119312526402816/orcl-20260925.htm
  const row=parse('Includes 142,821 shares subject to stock options exercisable within 60 days of the record date and 413,000,000 shares pledged as collateral to secure certain personal indebtedness, including various lines of credit.');
  assert.equal(row?.sharesPledged,413000000,'Pledge extraction selected the unrelated exercisable-option holding');
});
await check('A later margin holding does not encumber an earlier holding',()=>{
  const row=parse('Includes 142,821 shares subject to stock options and 413,000,000 shares held in a margin account.');
  assert.equal(row?.sharesPledged,413000000);
  assert.equal(parse('1,000 shares are pledged and 2,000 shares are pledged.').sharesPledged,null,'Separate pledged amounts remain ambiguous');
});
await check('A disclosed maintenance covenant survives a separate origination clause',()=>{
  const row=parse(base.excerpt.replace('Maintenance LTV is 50%.','Initial LTV was 40%; maximum maintenance LTV is 50%.'));
  assert.equal(row.maintenanceLtv,.5);
  const legacy=assessLiquidationObservation({...row,parserVersion:2},{market,now,scanHealthy:true});
  assert.equal(legacy.triggerPrice,null,'Prior parser output cannot establish a trigger before reparse');
  assert.equal(legacy.engineEligible,false);
});
await check('Incomplete collateral evidence stays out of automated decisions, control',()=>{
  const row=assessLiquidationObservation({...base,principalBorrowed:null},{market,now,scanHealthy:true});
  assert.equal(row.engineEligible,false);assert.equal(row.vetoLong,false);
});
await check('Unified Signal Engine preserves qualified and rejected owner decisions, control',()=>{
  const result=buildUnifiedSignalEngine(unifiedSignalFixture());
  assert.equal(result.decisions.find(r=>r.symbol==='BULL').status,'eligible');
  assert.equal(result.decisions.find(r=>r.symbol==='AVOID').status,'avoid');
});

if(process.argv.includes('--browser')){
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
  const {createLiquidationPreview}=await import('./forced-liquidation-preview.mjs');
  const preview=await createLiquidationPreview();
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  async function pageFor(){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    await page.clock.install({time:new Date(now)});
    await page.route('**/*',route=>new URL(route.request().url()).origin===preview.base?route.continue():route.abort());
    return {context,page,root:page.locator('#forced-liquidation-root')};
  }
  try{
    await check('An open tracker expires volume warnings at the volume deadline',async()=>{
      const volumeDate=new Date(Date.parse(now.slice(0,10))-6*86400000).toISOString().slice(0,10);
      const untilExpiry=Date.parse(volumeDate)+7*86400000-Date.parse(now);
      for(const row of preview.payload.rows)if(row.market)row.market.volumeAsOf=volumeDate;
      const {context,page,root}=await pageFor();
      try{
        await page.goto(preview.base+'/?tab=forced-liquidation');await root.locator('.fl-table').waitFor();
        assert((await root.innerText()).includes('Pledge >20%'),'control: warning starts visible');
        await page.clock.fastForward(untilExpiry+60000);
        const stillVisible=(await root.innerText()).includes('Pledge >20%');
        assert.equal(stillVisible,false,'Expired volume warning persists until another interaction or unrelated timer');
      }finally{await context.close();}
    });
    await check('A stalled tracker request exposes a retry instead of loading indefinitely',async()=>{
      const {context,page,root}=await pageFor();
      try{
        let stalled=true;
        await page.route('**/api/auth/me?data=forced-liquidation.json',route=>stalled?undefined:route.continue());
        await page.goto(preview.base+'/?tab=forced-liquidation');await root.getByText('Loading SEC collateral disclosures…').waitFor();
        await page.clock.fastForward(16000);
        await root.locator('[data-fl-retry]').waitFor({timeout:3000});
        assert((await root.innerText()).includes('timed out'),'Stalled read has no timeout message');
        stalled=false;
        await root.locator('[data-fl-retry]').click();
        await root.locator('.fl-table').waitFor();
        assert(!(await root.innerText()).includes('timed out'),'Retry loads a healthy response');
      }finally{await context.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));}
}
console.log(`Update branch audit: ${passed} passed, ${failed} unresolved findings.`);
if(failed)process.exitCode=1;

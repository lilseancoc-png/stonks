// Regression evidence for universe scoping and issuer annual-report pledges.
// Optional actual SEC artifact: ARM_FILING_FILE=/path/arm-20260331.htm npm run test:liquidation-universe
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {extractLiquidationFiling,collectLiquidationSec,LIQUIDATION_PARSER_VERSION,liquidationRecentFilings} from '../lib/forced-liquidation-sec.mjs';
import {buildForcedLiquidationPayload,forcedLiquidationContext} from '../lib/forced-liquidation.mjs';
import {refreshForcedLiquidation} from './refresh-forced-liquidation.mjs';
import {TICKERS} from './build.mjs';
import {liquidationFixtureBase as base,liquidationFixtureNow as now,liquidationFixtureChain} from './fixtures/forced-liquidation.mjs';

let checks=0;
const check=async(name,run)=>{await run();checks++;console.log('PASS '+name);};
const armFiling={form:'20-F',cik:'1973239',filingDate:'2026-05-26',accessionNumber:'0001973239-26-000097',url:'https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm'};
const issuer={symbol:'ARM',company:'Arm Holdings plc',issuerVerified:true};
// Synthetic text exercising the actual filing's grammar and inline-XBRL structure.
const armText='The Example Group Facility is secured by a pledge of 769,029,000 of our ordinary shares held by Example Group, as of May 21, 2026.';
const armRaw='<html><p>'+armText+'</p><ix:footnote>Unrelated accounting fact.</ix:footnote></html>';
const directory={0:{ticker:'ARM',title:issuer.company,cik_str:1973239},1:{ticker:'ADUR',title:'Aduro Clean Technologies Inc.',cik_str:1863934}};
const adur={...base,symbol:'ADUR',company:directory[1].title,accessionNumber:'0001863934-26-000001',url:'https://www.sec.gov/Archives/edgar/data/1863934/000186393426000001/adur.htm'};
const response=body=>({ok:true,status:200,headers:new Headers(),json:async()=>body,text:async()=>body});
const fetcher=({raw=armRaw,keywordAdur=true}={})=>async url=>{
  if(url.includes('company_tickers'))return response(directory);
  if(url.includes('search-index')){
    const hit={_id:adur.accessionNumber+':adur.htm',_source:{ciks:['1863934'],adsh:adur.accessionNumber,form:'DEF 14A',file_date:adur.filingDate}};
    return response({hits:{total:{value:keywordAdur?1:0},hits:keywordAdur?[hit]:[]}});
  }
  if(url.includes('/submissions/'))return response({filings:{recent:{form:['20-F'],filingDate:[armFiling.filingDate],accessionNumber:[armFiling.accessionNumber],primaryDocument:['arm-20260331.htm']}}});
  if(url===armFiling.url)return response(raw);
  if(url===adur.url)return response('<html><p>'+base.excerpt+'</p></html>');
  throw new Error('Unexpected source '+url);
};
await check('ARM belongs to our universe and ADUR does not',()=>{assert(TICKERS.includes('ARM'));assert(!TICKERS.includes('ADUR'));});
await check('Annual-report prose is still read when inline XBRL contains a footnote',()=>{
  const row=extractLiquidationFiling(armRaw,armFiling,issuer)[0];
  assert.equal(row.sharesPledged,769029000);assert.equal(row.securityClass,'Ordinary shares');assert.equal(row.asOfDate,'2026-05-21');assert.equal(row.borrower,null,'The collateral holder is not necessarily the borrower');assert.equal(row.facilityKey,null);
  assert.equal(row.principalBorrowed,null);assert.equal(row.maintenanceLtv,null);
});
await check('An initial share pledge cannot become a current share count',()=>{
  const row=extractLiquidationFiling('<html><p>'+armText.replace('is secured','is initially secured')+'</p></html>',armFiling,issuer)[0];
  assert.equal(row.sharesPledged,null);assert.equal(row.shareBasis,'initial-only');
});
await check('Negated or future pledge language cannot create a current pledge',()=>{
  for(const words of ['is not secured','is never secured','may be secured','could be secured','will be secured']){
    assert.equal(extractLiquidationFiling('<html><p>'+armText.replace('is secured',words)+'</p></html>',armFiling,issuer).length,0,words);
  }
});
await check('A Class A pledge retains its security class',()=>{
  const row=extractLiquidationFiling('<html><p>As of May 21, 2026, 100 shares of Class A common stock are pledged as collateral.</p></html>',armFiling,issuer)[0];
  assert.equal(row.securityClass,'CLASS A');
});
await check('Ordinary shares need a verified one-for-one basis before using an ADS quote',()=>{
  for(const ratio of ['five','an undisclosed number of']){
    const raw='<html><p>American Depositary Shares, each representing '+ratio+' ordinary shares.</p><p>'+armText+'</p></html>';
    const row=extractLiquidationFiling(raw,armFiling,issuer)[0];assert.equal(row.sharesPledged,null);assert.equal(row.shareBasis,'ads-conversion-unresolved');
  }
  const raw='<html><p>American Depositary Shares, each representing one ordinary share.</p><p>'+armText+'</p></html>';
  assert.equal(extractLiquidationFiling(raw,armFiling,issuer)[0].sharesPledged,769029000);
});
await check('Annual-report forms enter the recent submissions discovery path',()=>{
  const forms=['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A'];
  const recent={form:forms,filingDate:forms.map(()=>armFiling.filingDate),accessionNumber:forms.map(()=>armFiling.accessionNumber),primaryDocument:forms.map(()=> 'annual.htm')};
  assert.equal(liquidationRecentFilings({filings:{recent}},'1973239','2025-10-01').length,forms.length);
});
let collected;
await check('A scan discovers ARM annual evidence but excludes broad-keyword ADUR evidence',async()=>{
  collected=await collectLiquidationSec({universe:['ARM'],now,fetchImpl:fetcher(),delayMs:0});
  assert.equal(collected.coverage.status,'ok');assert(collected.observations.some(r=>r.symbol==='ARM'&&r.sharesPledged===769029000));assert(collected.observations.every(r=>r.symbol==='ARM'));assert.deepEqual(collected.coverage.universeSymbols,['ARM']);
});
await check('Unrelated recent issuer reports cannot crowd out the tracked annual report',async()=>{
  const normal=fetcher();
  const c=await collectLiquidationSec({universe:['ARM'],now,delayMs:0,maxDocuments:1,fetchImpl:async url=>{
    if(url.includes('search-index'))return response({hits:{total:{value:25},hits:Array.from({length:25},(_,i)=>({_id:adur.accessionNumber+':other'+i+'.htm',_source:{ciks:['1863934'],adsh:adur.accessionNumber,form:'20-F',file_date:'2026-10-23'}}))}});
    return normal(url);
  }});
  assert(c.observations.some(r=>r.symbol==='ARM'));assert.equal(c.coverage.documentsThisRun,1);
});
await check('A tracked shareholder CIK cannot turn an untracked collateral stock into ARM',async()=>{
  const normal=fetcher({keywordAdur:false}),accession='0001973239-26-000150';
  const url='https://www.sec.gov/Archives/edgar/data/1973239/000197323926000150/schedule.xml';
  const c=await collectLiquidationSec({universe:['ARM'],now,delayMs:0,fetchImpl:async u=>{
    if(u.includes('search-index'))return response({hits:{total:{value:1},hits:[{_id:accession+':schedule.xml',_source:{ciks:['1973239'],adsh:accession,form:'SCHEDULE 13D/A',file_date:'2026-10-23'}}]}});
    if(u===url)return response('<edgarSubmission><issuerCik>1863934</issuerCik><reportingPersonName>Example Holder</reportingPersonName><footnote>500 shares were pledged as collateral.</footnote></edgarSubmission>');
    return normal(u);
  }});
  assert(c.observations.length);assert(c.observations.every(r=>r.symbol==='ARM'));
});
await check('Daily cache reuse removes an old off-universe observation',async()=>{
  const c=await collectLiquidationSec({prior:{version:1,...collected,observations:[...collected.observations,adur]},universe:['ARM'],now,fetchImpl:()=>{throw new Error('Cache must be reused');},delayMs:0});
  assert.equal(c.coverage.requestsThisRun,0);assert(c.observations.every(r=>r.symbol==='ARM'));
});
await check('Source outages cannot restore off-universe retained evidence',async()=>{
  const c=await collectLiquidationSec({prior:{version:1,observations:[...collected.observations,adur],coverage:{}},universe:['ARM'],now,fetchImpl:async()=>{throw new Error('offline');},delayMs:0});
  assert.equal(c.coverage.status,'unavailable');assert(c.observations.length);assert(c.observations.every(r=>r.symbol==='ARM'));
});
await check('Universe changes bypass the cache and reread previously inspected evidence',async()=>{
  const prior={version:1,...collected,observations:[],coverage:{...collected.coverage,universeSymbols:['ADUR'],pendingFilings:[]}};
  const c=await collectLiquidationSec({prior,universe:['ARM'],now,fetchImpl:fetcher({keywordAdur:false}),delayMs:0});
  assert(c.coverage.requestsThisRun>0);assert(c.observations.some(r=>r.symbol==='ARM'));
});
await check('Payload rows, observations, summaries and snapshot histories obey the universe',()=>{
  const broad=buildForcedLiquidationPayload({observations:[...collected.observations,adur],chains:{ADUR:liquidationFixtureChain()},coverage:collected.coverage,builtAtIso:now});
  const p=buildForcedLiquidationPayload({observations:[...collected.observations,adur],priorSnapshots:broad.snapshots,universe:['ARM'],coverage:collected.coverage,builtAtIso:now});
  assert(p.rows.length);assert(p.rows.every(r=>r.symbol==='ARM'));assert(p.observations.every(r=>r.symbol==='ARM'));assert.equal(p.summary.tracked,p.rows.length);assert(!p.snapshots.some(s=>s.key.includes('ADUR')));
  assert(p.rows.every(r=>r.triggerPrice===null&&!r.engineEligible&&!r.vetoLong));
  assert.equal(forcedLiquidationContext(p,'ADUR',liquidationFixtureChain(),now),null);
});
await check('The full refresh never requests a fallback quote for retained ADUR',async()=>{
  const calls=[];
  const p=await refreshForcedLiquidation({prior:{version:1,...collected,observations:[...collected.observations,adur]},universe:['ARM'],chains:{},builtAtIso:now,delayMs:0,fetchImpl:fetcher(),quoteClient:{quote:async s=>{calls.push(s);return {};},chart:async()=>({quotes:[]}),quoteSummary:async()=>({})}});
  assert.deepEqual(calls,['ARM']);assert(p.rows.every(r=>r.symbol==='ARM'));
});
if(process.env.ARM_FILING_FILE){
  await check('Actual Arm 2026 SEC report flows through collection into research-only ARM rows',async()=>{
    const raw=await readFile(process.env.ARM_FILING_FILE,'utf8');
    const c=await collectLiquidationSec({universe:['ARM'],now,fetchImpl:fetcher({raw}),delayMs:0});
    const p=buildForcedLiquidationPayload({...c,universe:['ARM'],builtAtIso:now});
    assert(p.rows.some(r=>r.symbol==='ARM'&&r.sharesPledged===769029000));
    assert(p.rows.every(r=>r.symbol==='ARM'&&r.triggerPrice===null&&!r.engineEligible&&!r.vetoLong));
    if(process.env.LIQUIDATION_AUDIT_PAYLOAD)await writeFile(process.env.LIQUIDATION_AUDIT_PAYLOAD,JSON.stringify(p));
  });
}
console.log(`Liquidation universe and annual-report regressions: ${checks} passed; parser ${LIQUIDATION_PARSER_VERSION}.`);

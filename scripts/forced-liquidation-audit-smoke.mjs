// Adversarial regressions found during the feature audit. No provider, model,
// account or private-store access is used by this check.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import { extractLiquidationFiling,collectLiquidationSec,LIQUIDATION_PARSER_VERSION } from '../lib/forced-liquidation-sec.mjs';
import { buildForcedLiquidationPayload,liquidationMarketFromChain,assessLiquidationObservation,distanceToLiquidation } from '../lib/forced-liquidation.mjs';
import { collectLiquidationMarkets } from './refresh-forced-liquidation.mjs';
import { buildThesisUserMessage,thesisDecisionGuardSig,scoreAllTickers } from './build.mjs';
import { liquidationFixture,liquidationFixtureBase as base,liquidationFixtureNow as now,liquidationFixtureChain } from './fixtures/forced-liquidation.mjs';

const failures=[];let checks=0;
async function check(name,run){try{await run();checks++;}catch(e){failures.push(name+': '+e.message.split('\n')[0]);}}
const filing={accessionNumber:base.accessionNumber,filingDate:base.filingDate,url:base.url,form:'4',cik:'1'};
const issuer={symbol:base.symbol,company:base.company,issuerVerified:true};
const parse=text=>extractLiquidationFiling('<html><p>'+text+'</p></html>',filing,issuer);
const terms=base.excerpt.replace('SYNTHETIC TEST DATA. ','');
await check('A negated release cannot close an active pledge',()=>assert.equal(parse(terms+' The pledged shares have not been released.')[0].status,'disclosed'));
await check('A possible future release cannot close an active pledge',()=>assert.equal(parse(terms+' The pledged shares may be released following repayment.')[0].status,'disclosed'));
await check('A partial release does not mean the whole pledge ended',()=>assert.notEqual(parse(terms+' A portion of the pledged shares was released.')[0].status,'released'));
await check('A percent of a holding is not the whole pledged holding',()=>assert.equal(parse('As of October 23, 2026, 20% of the 10,000,000 shares are pledged as collateral.')[0].sharesPledged,null));
await check('An upper bound is not a current pledged share count',()=>assert.equal(parse('A maximum of 10,000,000 shares are pledged as collateral.')[0].sharesPledged,null));
await check('Invalid calendar dates are not normalized into dated facts',()=>assert.equal(parse('As of February 30, 2026, 10,000,000 shares are pledged as collateral.')[0].asOfDate,null));
await check('An unrelated collateral release does not retire the stock pledge',()=>assert.equal(parse(terms+' Other collateral was released from a separate facility.')[0].status,'disclosed'));
await check('A preferred-stock pledge is not priced using the common ticker',()=>assert.equal(parse(terms.replace('10,000,000 shares','10,000,000 preferred shares'))[0].issuerVerified,false));
await check('Two named facilities in one paragraph cannot become one loan',()=>assert.equal(parse(terms+' Facility ID: another facility; outstanding principal of US$100 million.')[0].facilityKey,null));
await check('A non-US dollar loan cannot be labeled USD',()=>assert.notEqual(parse(terms+' The loan is denominated in SGD.')[0].currency,'USD'));
await check('A dollar symbol alone cannot establish dollar currency',()=>assert.notEqual(parse(terms.replace('US$','$'))[0].currency,'USD'));
await check('A document dollar-currency declaration can establish USD',()=>{
  const r=extractLiquidationFiling('<html><p>All dollar amounts are expressed in United States dollars.</p><p>'+terms.replace('US$','$')+'</p></html>',filing,issuer)[0];assert.equal(r.currency,'USD');
});
await check('Unrepresentable distance is unknown rather than infinity',()=>assert.equal(distanceToLiquidation(1e-308,1e308),null));

const fixture=liquidationFixture();
await check('An old parser cannot keep an automated trigger active',()=>{
  const r=assessLiquidationObservation({...base,parserVersion:LIQUIDATION_PARSER_VERSION-1},{market:liquidationMarketFromChain(fixture.chains.ATLS,now),now,scanHealthy:true});assert.equal(r.triggerPrice,null);assert.equal(r.vetoLong,false);
});
await check('A partial release leaves the remaining pledge unresolved',()=>{
  const first=parse(terms)[0],second=extractLiquidationFiling('<html><p>Borrower: Anchor Holdings; Facility ID: margin-2025; As of October 24, 2026, a portion of the pledged shares was released.</p></html>',{...filing,accessionNumber:'0000000001-26-000002',filingDate:'2026-10-24',url:filing.url.replace('000001','000002')},issuer)[0];
  const p=buildForcedLiquidationPayload({observations:[first,second],chains:fixture.chains,coverage:fixture.coverage,builtAtIso:now});assert.equal(p.rows.length,1);assert.equal(p.rows[0].triggerPrice,null);assert.notEqual(p.rows[0].state,'released');
});
await check('Duplicate current-date filings do not erase a prior top-up comparison',()=>{
  const duplicate={...base,accessionNumber:'0000000001-26-000003',filingDate:'2026-10-24'};
  const p=buildForcedLiquidationPayload({observations:[...fixture.observations,duplicate],chains:fixture.chains,coverage:fixture.coverage,builtAtIso:now});
  assert.equal(p.rows.find(r=>r.symbol==='ATLS').velocity?.collateralTopUp,true);
});
await check('Zero-volume trading sessions remain in average volume',()=>{
  const chain=liquidationFixtureChain();chain._bars=chain._bars.slice(-20);chain._bars[19].v=0;
  assert.equal(liquidationMarketFromChain(chain,now).averageDailyVolume,1900000);
});
await check('An invalid bar timestamp cannot crash the whole tracker',()=>{
  const chain=liquidationFixtureChain();chain._bars.push({t:Infinity,v:3});
  assert.equal(liquidationMarketFromChain(chain,now).averageDailyVolume,2000000);
});
await check('Today enters daily volume only after its close is confirmed',()=>{
  const c=liquidationFixtureChain();c._bars.at(-1).v=100000000;
  assert.equal(liquidationMarketFromChain(c,'2026-10-23T19:00:00Z').averageDailyVolume,2000000);
  assert.equal(liquidationMarketFromChain(c,'2026-10-23T20:20:00Z').averageDailyVolume,6900000);
});
await check('Stale volume cannot produce a current liquidity ratio',()=>{
  const m={...liquidationMarketFromChain(fixture.chains.ATLS,now),volumeAsOf:'2026-01-01'};
  const r=assessLiquidationObservation(base,{market:m,now,scanHealthy:true});assert.equal(r.pledgedToAdvPct,null);assert.equal(r.liquidityWarning,false);
});
await check('A newer external quote wins over a stale chain quote',()=>{
  const market={...liquidationMarketFromChain(fixture.chains.ATLS,now),price:23};
  const p=buildForcedLiquidationPayload({observations:[base],coverage:fixture.coverage,markets:{ATLS:market},chains:{ATLS:{...fixture.chains.ATLS,spot:10,quoteAsOf:'2026-10-01T20:00:00Z'}},builtAtIso:now});assert.equal(p.rows[0].market.price,23);
});
await check('Weekend rebuilds cannot create new observations from Friday quotes',()=>{
  const p=buildForcedLiquidationPayload({observations:fixture.observations,coverage:fixture.coverage,chains:fixture.chains,priorSnapshots:fixture.payload.snapshots,builtAtIso:'2026-10-26T15:00:00Z'});
  assert.equal(p.snapshots.length,fixture.payload.snapshots.length);assert(p.snapshots.every(s=>s.date==='2026-10-23'));
});
await check('A valid quote survives a volume-provider failure',async()=>{
  const q=await collectLiquidationMarkets({observations:[base],now,quoteClient:{
    quote:async()=>({regularMarketPrice:23,regularMarketTime:new Date('2026-10-23T20:00:00Z')}),
    chart:async()=>{throw new Error('volume unavailable');},quoteSummary:async()=>({defaultKeyStatistics:{floatShares:50e6}}),
  }});
  assert.equal(q.markets.ATLS?.price,23);assert.equal(q.markets.ATLS.averageDailyVolume,null);
});
await check('A later stock outside the eight-name budget eventually gets a quote',async()=>{
  const observations=Array.from({length:9},(_,i)=>({...base,symbol:'EXT'+i})),called=[];
  const quoteClient={quote:async s=>{called.push(s);return{regularMarketPrice:23,regularMarketTime:new Date('2026-10-23T20:00:00Z')};},chart:async()=>({quotes:[]}),quoteSummary:async()=>({})};
  const first=await collectLiquidationMarkets({observations,now,quoteClient});
  await collectLiquidationMarkets({observations,now:'2026-10-26T20:00:00Z',previous:first.markets,lastAttempts:first.coverage.lastAttempts,quoteClient});
  assert(called.includes('EXT8'));
});
await check('Incomplete collateral research is excluded from automated grading',()=>{
  const scores=scoreAllTickers(fixture.chains,[],null,null,null,null,{builtAtIso:now,forcedLiquidation:fixture.payload});
  const partial=scores.scored.find(r=>r.sym==='SCEN');
  assert(!buildThesisUserMessage(partial,'put',null).includes('SEC COLLATERAL RESEARCH'));
  assert.equal(thesisDecisionGuardSig(partial,'put','stock',null),thesisDecisionGuardSig({...partial,forcedLiquidation:null},'put','stock',null));
});

const response=value=>({ok:true,status:200,headers:new Headers(),json:async()=>value,text:async()=>value});
const directory={0:{ticker:'ATLS',title:base.company,cik_str:1}};
const metadata=i=>({accessionNumber:'0000000001-26-'+String(i).padStart(6,'0'),form:'DEF 14A',filingDate:'2026-10-23',cik:'1',url:'https://www.sec.gov/Archives/edgar/data/1/000000000126'+String(i).padStart(6,'0')+'/doc.htm'});
const fetcher=filings=>async url=>{
  if(url.includes('company_tickers'))return response(directory);
  if(url.includes('search-index'))return response({hits:{total:{value:0},hits:[]}});
  if(url.includes('/submissions/'))return response({filings:{recent:{form:filings.map(f=>f.form),filingDate:filings.map(f=>f.filingDate),accessionNumber:filings.map(f=>f.accessionNumber),primaryDocument:filings.map(()=> 'doc.htm')}}});
  return response('<html><p>'+terms+'</p></html>');
};
await check('A parser upgrade bypasses a daily cache from the prior parser',async()=>{
  let requested=0;
  await collectLiquidationSec({prior:{version:1,observations:[base],coverage:{status:'ok',lastSuccessAt:now,parserVersion:LIQUIDATION_PARSER_VERSION-1}},now,delayMs:0,universe:['ATLS'],fetchImpl:async url=>{requested++;return fetcher([])(url);}});
  assert(requested>0);
});
await check('A previously discovered filing survives the next issuer rotation',async()=>{
  const first=await collectLiquidationSec({universe:['ATLS'],now,fetchImpl:fetcher([metadata(2),metadata(3)]),delayMs:0,maxIssuers:1,maxDocuments:1});
  const second=await collectLiquidationSec({prior:{version:1,...first},universe:['ATLS'],now:'2026-10-26T20:00:00Z',fetchImpl:fetcher([]),delayMs:0,maxIssuers:1,maxDocuments:1});
  assert.equal(new Set(second.observations.map(r=>r.accessionNumber)).size,2);
});
await check('An empty current reparse removes a superseded parsed observation',async()=>{
  const meta=metadata(2),old={...base,...meta,parserVersion:LIQUIDATION_PARSER_VERSION-1};
  const prior={version:1,observations:[old],coverage:{status:'ok',lastSuccessAt:'2026-10-23T00:00:00Z',parserVersion:LIQUIDATION_PARSER_VERSION-1}};
  const c=await collectLiquidationSec({prior,now,universe:['ATLS'],delayMs:0,fetchImpl:async url=>url.includes('/Archives/')?response('<html><p>No shares are pledged.</p></html>'):fetcher([])(url)});
  assert.equal(c.observations.length,0);
});
await check('The real collection command starts without a circular-await deadlock',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'liquidation-cli-'));
  try{
    const hook=resolve(temp,'offline.mjs');
    await writeFile(hook,"globalThis.fetch=async url=>{const s=String(url);let body;if(s.includes('company_tickers'))body={0:{ticker:'ATLS',title:'Synthetic',cik_str:1}};else if(s.includes('search-index'))body={hits:{total:{value:0},hits:[]}};else throw new Error('Unexpected network request in offline CLI check');return new Response(JSON.stringify(body),{status:200});};");
    const result=spawnSync(process.execPath,['--import',hook,fileURLToPath(new URL('./collect-forced-liquidation.mjs',import.meta.url))],{cwd:temp,env:{...process.env,LIQUIDATION_DATA_DIR:temp},encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/no publication/);
    assert.equal(JSON.parse(await readFile(resolve(temp,'forced-liquidation.json'),'utf8')).version,1);
  }finally{await rm(temp,{recursive:true,force:true});}
});
for(const failure of failures)console.error('FAIL '+failure);
console.log(`Collateral audit regressions: ${checks} passed, ${failures.length} failed.`);
if(failures.length)process.exitCode=1;

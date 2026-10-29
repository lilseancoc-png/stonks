// Pledge presence and disclosed amounts do not depend on model-ready loan terms.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractLiquidationFiling,LIQUIDATION_PARSER_VERSION} from '../lib/forced-liquidation-sec.mjs';
import {buildForcedLiquidationPayload,assessLiquidationObservation,liquidationMarketFromChain,liquidationPledgeDisclosure} from '../lib/forced-liquidation.mjs';
import {liquidationFixture,liquidationFixtureBase as base,liquidationFixtureNow as now} from './fixtures/forced-liquidation.mjs';
const fixture=liquidationFixture(),market=liquidationMarketFromChain(fixture.chains.ATLS,now);
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const filing={accessionNumber:base.accessionNumber,url:base.url,filingDate:base.filingDate,form:'20-F'};
const issuer={symbol:'ATLS',company:base.company,issuerVerified:true};
const parse=text=>extractLiquidationFiling('<html><p>'+text+'</p></html>',filing,issuer)[0];
const assess=obs=>assessLiquidationObservation(obs,{now,market,scanHealthy:true});

check('A pledge-only record remains visible with no borrower, debt, terms or quote',()=>{
  const observation=parse('As of October 23, 2026, 123,456 ordinary shares are pledged as collateral.');
  assert(observation);const p=buildForcedLiquidationPayload({observations:[observation],universe:['ATLS'],builtAtIso:now});
  assert.equal(p.rows.length,1);assert.equal(p.rows[0].pledge.confirmed,true);assert.equal(p.rows[0].pledge.shares,123456);
  assert.equal(p.summary.pledgedStocks,1);assert.equal(p.summary.needsTerms,1);assert.equal(p.rows[0].triggerPrice,null);assert.equal(p.rows[0].vetoLong,false);
});
check('Early corporate debt paragraphs cannot crowd a later stock pledge out of a report',()=>{
  const raw='<html>'+Array.from({length:35},()=>'<p>The company issued secured notes to fund operations.</p>').join('')+'<p>As of October 23, 2026, 123,456 ordinary shares are pledged as collateral.</p></html>';
  const rows=extractLiquidationFiling(raw,filing,issuer);assert(rows.length<=30);assert(rows.some(r=>r.kind==='equity-pledge'&&r.disclosedShares===123456));
});
check('An explicit zero pledged amount cannot create a pledge awareness record',()=>{
  for(const text of ['0 shares are pledged as collateral.','Zero ordinary shares were pledged as collateral.'])assert.equal(parse(text),undefined);
});
check('Ambiguous loan balances do not erase an unambiguous disclosed share amount',()=>{
  const o=parse('As of October 23, 2026, 123,456 ordinary shares are pledged; outstanding principal is US$10 million; outstanding principal is US$20 million.');
  const r=assess(o);assert.equal(r.pledge.shares,123456);assert.equal(r.principalBorrowed,null);assert.equal(r.triggerPrice,null);assert.equal(r.engineEligible,false);
});
check('Initial and additional pledge quantities remain awareness facts, not current totals',()=>{
  for(const [text,basis] of [
    ['The facility is initially secured by a pledge of 123,456 ordinary shares.','initial-only'],
    ['The borrower pledged an additional 123,456 shares as collateral.','incremental-only'],
    ['The borrower pledged an additional 123,456 ordinary shares as collateral.','incremental-only'],
  ]){
    const r=assess(parse(text));assert.equal(r.pledge.confirmed,true);assert.equal(r.pledge.shares,123456);assert.equal(r.pledge.shareBasis,basis);assert.equal(r.sharesPledged,null);assert.equal(r.triggerPrice,null);
  }
});
check('An unknown ADS conversion preserves awareness without quote-based pressure or trigger',()=>{
  const raw='<html><p>American Depositary Shares, each representing five ordinary shares.</p><p>As of October 23, 2026, 123,456 ordinary shares are pledged as collateral.</p></html>';
  const r=assess(extractLiquidationFiling(raw,filing,issuer)[0]);assert.equal(r.pledge.shares,123456);assert.equal(r.pledge.quoteComparable,false);assert.equal(r.sharesPledged,null);assert.equal(r.pledgedToAdvPct,null);assert.equal(r.pledgedToFloatPct,null);assert.equal(r.engineEligible,false);
});
check('Multiple excerpts of one stock do not inflate the stock count or sum amounts',()=>{
  const first=parse('123,456 ordinary shares are pledged as collateral.'),second={...first,fragmentId:1};
  const p=buildForcedLiquidationPayload({observations:[first,second],universe:['ATLS'],builtAtIso:now});assert.equal(p.rows.length,1);assert.equal(p.summary.tracked,1);assert.equal(p.summary.pledgedStocks,1);assert(p.rows.every(r=>r.pledge.shares===123456));
});
check('Same-source amounts, borrowers and excerpt differences remain separate evidence',()=>{
  const first=parse('123,456 ordinary shares are pledged as collateral.');
  for(const changed of [{borrower:'Separate Holder'},{disclosedShares:999},{excerpt:'Different source context.'},{url:first.url+'?exhibit=2'}]){
    const p=buildForcedLiquidationPayload({observations:[first,{...first,...changed,fragmentId:1}],builtAtIso:now});assert.equal(p.rows.length,2);
  }
});
check('A collateral issuer that needs review is not counted as a confirmed stock pledge',()=>{
  const p=buildForcedLiquidationPayload({observations:[{...base,issuerVerified:false}],builtAtIso:now});assert.equal(p.summary.pledgedStocks,0);assert.equal(p.summary.tracked,0);assert.equal(p.rows[0].pledge.confirmed,false);assert.equal(p.rows[0].liquidityWarning,false);
});
check('Released and stale records cannot advertise a current liquidity warning',()=>{
  for(const change of [{status:'released'},{asOfDate:'2024-01-01',filingDate:'2024-01-01'}]){
    const r=assess({...base,...change});assert.equal(r.liquidityWarning,false);assert.equal(r.pledgedToAdvPct,null);assert.equal(r.pledgedToFloatPct,null);assert.equal(r.vetoLong,false);
  }
  assert.equal(assess({...base,status:'released'}).pledge.confirmed,false);
});
check('A partial release or holding percentage cannot disclose a current remaining count',()=>{
  const percent=assess(parse('20% of the 123,456 shares are pledged as collateral.'));assert.equal(percent.pledge.shares,null);assert.equal(percent.sharesPledged,null);
  const partial=assess(parse('A portion of the pledged shares was released.'));assert.equal(partial.pledge.shares,null);assert.equal(partial.sharesPledged,null);
});
check('Legacy extraction remains a source lead without promoting its numeric quantity',()=>{
  const r=liquidationPledgeDisclosure({...base,parserVersion:LIQUIDATION_PARSER_VERSION-1},LIQUIDATION_PARSER_VERSION);assert.equal(r.confirmed,true);assert.equal(r.shares,null);
});
check('A title in the holder name does not end the pledge sentence',()=>{
  for(const text of ['1,000,000 of the shares held by Mr. Lee are pledged as collateral.','Of these shares, 1,000,000 shares held by Dr. Chen were pledged as collateral.']){
    const o=parse(text);assert(o,text);assert.equal(o.disclosedShares,1000000,text);
  }
});
check('A release of a prior pledge does not hide a new pledge in the same disclosure',()=>{
  const mixed=assess(parse('Mr. Lee pledged 3,000,000 shares to secure a margin loan and released 1,000,000 shares from a prior pledge.'));
  assert.equal(mixed.pledge.confirmed,true);assert.notEqual(mixed.observation.status,'released');
  const full=parse('Mr. Lee had pledged 3,000,000 shares, all of which were released.');assert.equal(full.status,'released');
});
check('An agreement date is not the date of the reported pledge',()=>{
  const o=parse('Pursuant to the Pledge Agreement dated as of March 3, 2021, the Reporting Person has pledged 2,000,000 shares as collateral.');
  assert.equal(o.asOfDate,null);assert.notEqual(assess(o).state,'stale');
});
check('Ordinary wording after "class" is not a share class',()=>{
  assert.equal(parse('Title of Class of Securities: ordinary shares. 100 shares are pledged as collateral.').securityClass,'Ordinary shares');
  assert.equal(parse('100 shares of Class B common stock are pledged as collateral.').securityClass,'CLASS B');
});
check('Annual-report business wording is not a forced-sale report',()=>{
  const rows=extractLiquidationFiling('<html><p>Example Securities issues margin calls to customers whose margin accounts fall below maintenance requirements.</p></html>',{...filing,form:'10-K'},issuer);
  assert(!rows.some(r=>r.kind==='liquidation-event'));
});
check('A later full release by the same holder retires the earlier pledge',()=>{
  const pledge={...base,facilityKey:null,borrower:'Example Holder',accessionNumber:'0000000001-26-000010',filingDate:'2026-09-01',asOfDate:'2026-09-01'};
  const release={...pledge,accessionNumber:'0000000001-26-000011',filingDate:'2026-10-01',asOfDate:'2026-10-01',status:'released'};
  const p=buildForcedLiquidationPayload({observations:[pledge,release],universe:['ATLS'],builtAtIso:now});
  assert.equal(p.summary.pledgedStocks,0);assert(p.rows.every(r=>r.state==='released'&&!r.pledge.confirmed&&r.stress==null));
});
check('A stale pledge is retained but not counted as a current pledge',()=>{
  const p=buildForcedLiquidationPayload({observations:[{...base,asOfDate:'2024-01-01',filingDate:'2024-01-01'}],universe:['ATLS'],builtAtIso:now});
  assert.equal(p.rows.length,1);assert.equal(p.summary.pledgedStocks,0);assert.equal(p.summary.needsTerms,0);
});
if(process.env.ARM_FILING_FILE){
  const raw=await readFile(process.env.ARM_FILING_FILE,'utf8');
  check('The actual ARM pledge appears for awareness without a modeled liquidation price',()=>{
    const observations=extractLiquidationFiling(raw,{...filing,accessionNumber:'0001973239-26-000097',filingDate:'2026-05-26',url:'https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm'},{symbol:'ARM',company:'Arm Holdings plc',issuerVerified:true});
    const p=buildForcedLiquidationPayload({observations,universe:['ARM'],builtAtIso:now});assert.equal(p.summary.pledgedStocks,1);assert(p.rows.some(r=>r.pledge.shares===769029000));assert(p.rows.every(r=>r.triggerPrice===null&&!r.engineEligible));
  });
}
console.log(`Pledge awareness regressions: ${checks} passed.`);

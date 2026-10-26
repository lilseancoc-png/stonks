// Synthetic facilities for math and browser verification, never production data.
import { buildForcedLiquidationPayload,LIQUIDATION_EVIDENCE_VERSION } from '../../lib/forced-liquidation.mjs';
export const liquidationFixtureNow='2026-10-25T20:00:00Z';
export const liquidationFixtureBase={
  parserVersion:LIQUIDATION_EVIDENCE_VERSION,
  symbol:'ATLS',company:'Atlas Fabrication · synthetic',borrower:'Anchor Holdings',facilityKey:'anchor|margin-2025',securityClass:'Common stock',
  accessionNumber:'0000000001-26-000001',fragmentId:0,filingDate:'2026-10-23',asOfDate:'2026-10-23',form:'SCHEDULE 13D/A',
  url:'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/fixture.htm',
  kind:'equity-pledge',status:'disclosed',principalBorrowed:100000000,principalBasis:'outstanding',sharesPledged:10000000,shareBasis:'stated-current',
  maintenanceLtv:0.5,collateralBasis:'sole-listed-equity',currency:'USD',issuerVerified:true,splitUnresolved:false,extractionStatus:'synthetic test facts',
  excerpt:'SYNTHETIC TEST DATA. Borrower: Anchor Holdings; Facility ID: margin-2025; As of October 23, 2026, 10,000,000 shares are pledged as collateral. The outstanding principal balance of US$100 million is secured solely by these shares. Maintenance LTV is 50%.',
};
export function liquidationFixtureChain(price=22){
  const rows=[];
  for(let t=Date.parse('2026-09-01');t<=Date.parse('2026-10-23');t+=86400000){const d=new Date(t);if([0,6].includes(d.getUTCDay()))continue;rows.push({t:d.toISOString().slice(0,10),o:price,c:price,h:price+1,l:price-1,v:2000000});}
  return {spot:price,quoteAsOf:'2026-10-23T20:00:00Z',fundamentals:{name:'Atlas Fabrication',floatShares:50000000},_bars:rows,chains:{},technicals:{}};
}
export function liquidationFixture(){
  const b=liquidationFixtureBase;
  const previous={...b,accessionNumber:'0000000001-26-000000',filingDate:'2026-09-23',asOfDate:'2026-09-23',sharesPledged:8000000};
  const scenario={...b,symbol:'SCEN',company:'Scenario Industries · synthetic',borrower:'Scenario Parent',facilityKey:'scenario|loan1',accessionNumber:'0000000002-26-000001',maintenanceLtv:null};
  const missing={...b,symbol:'GAPS',company:'Gaps Research · synthetic',borrower:'Unknown principal',facilityKey:null,accessionNumber:'0000000003-26-000001',principalBorrowed:null,principalBasis:'undisclosed'};
  const debt={...b,symbol:'BOND',company:'Operating debt · synthetic',borrower:'Operating company',facilityKey:null,accessionNumber:'0000000004-26-000001',kind:'debt-context',principalBorrowed:null,sharesPledged:null,maintenanceLtv:null,excerpt:'SYNTHETIC TEST DATA. Secured notes issued to fund operating expenses; collateral includes subsidiary assets. No listed-stock pledge or maintenance ratio is disclosed.'};
  const observations=[previous,b,scenario,missing,debt];
  const chains=Object.fromEntries(['ATLS','SCEN','GAPS','BOND'].map(s=>[s,liquidationFixtureChain()]));
  const coverage={status:'ok',lastSuccessAt:liquidationFixtureNow,checkedAt:liquidationFixtureNow,requestsThisRun:8,documentsThisRun:5,issuersCheckedThisRun:4,universeSize:4,capped:true,scope:'Synthetic fixture coverage for local verification only.',forms:['4','SCHEDULE 13D/A','SC 13G','DEF 14A','424B5'],errors:[]};
  const payload=buildForcedLiquidationPayload({observations,chains,coverage,builtAtIso:liquidationFixtureNow});
  return {payload,observations,chains,coverage};
}

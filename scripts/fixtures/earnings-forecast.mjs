import { makeObservation } from '../../lib/earnings-forecast.mjs';
export function earningsFixture(symbol='TEST'){
  const observations=[];
  for(let y=2023;y<=2024;y++)for(let q=1;q<=4;q++){
    const start=new Date(Date.UTC(y,(q-1)*3,1)).toISOString().slice(0,10),end=new Date(Date.UTC(y,q*3,0)).toISOString().slice(0,10),filed=new Date(Date.parse(end)+30*86400000).toISOString().slice(0,10),availableAt=filed+'T12:00:00Z',firstSeenAt=filed+'T13:00:00Z';
    for(const[metric,value]of Object.entries({revenue:100,grossProfit:40,operatingIncome:20,pretaxIncome:22,taxes:4.4,netIncome:17.6,dilutedShares:8,eps:2.2}))observations.push(makeObservation({issuerId:'0000000001',symbol,metric,start,end,value,currency:metric==='dilutedShares'?null:'USD',unit:metric==='dilutedShares'?'shares':metric==='eps'?'USD/shares':'USD',basis:'US GAAP',tag:metric,priority:0,accession:y+'-'+q,filed,form:'10-Q',availableAt,firstSeenAt,rawHash:'fixture',sourceUrl:'https://www.sec.gov/example/fixture'}));
  }
  return observations;
}

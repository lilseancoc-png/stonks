// Synthetic leverage-distress payload for the local preview and browser checks.
// Fund names, CIKs and filings are invented; they are not real investment facts.
import {CLUSTER_POLICY,LEVERAGE_DISTRESS_VERSION} from '../../lib/leverage-distress.mjs';
export function leverageDistressFixture(builtAtIso='2026-10-27T20:10:00Z'){
  const top=(rows)=>rows.map(([ticker,name,value,price,livePrice,putCall])=>({ticker,name,cusip:'000000000',value,price,livePrice,liveAsOf:builtAtIso,movePct:livePrice&&price?(livePrice/price-1)*100*(putCall==='PUT'?-1:1):null,putCall:putCall||null}));
  const funds=[
    {cik:'0000000101',name:'Example Momentum Partners (synthetic)',level:'alert',period:'2026-06-30',anchorPeriod:'2026-09-30',filingDate:'2026-10-14',early13F:{filingDate:'2026-10-14'},
      ytd:61.4,ytdWithOptions:88.2,qoq:24.9,qoqWithOptions:37.5,tells:['call-heavy','concentrated','few-positions'],
      stats:{reportedValue:8.4e9,stockValue:5.1e9,callNotional:3.3e9,putNotional:0,callPct:64.7,putPct:0,positions:18},
      topMovePct:-17.8,topPricedPct:96,bookImpactPct:-14.2,pressure:'under-pressure',drawdownPct:-18.9,
      quarters:[{period:'2026-03-31',stockPct:14.2,withOptionsPct:20.1,coverage:.93},{period:'2026-06-30',stockPct:13.5,withOptionsPct:19.6,coverage:.94},{period:'2026-09-30',stockPct:24.9,withOptionsPct:37.5,coverage:.95}],
      top:top([['NVDA','NVIDIA CORP',1.4e9,186.2,154.1],['NVDA','NVIDIA CORP',1.1e9,186.2,154.1,'CALL'],['SMCI','SUPER MICRO COMPUTER INC',.62e9,52.4,39.8],['VST','VISTRA CORP',.51e9,212.0,181.5],['MRVL','MARVELL TECHNOLOGY INC',.44e9,91.2,77.3],['CEG','CONSTELLATION ENERGY CORP',.38e9,330.1,301.0]]),
      universe:[{symbol:'NVDA',shares:7.5e6,value:1.4e9},{symbol:'NVDA',shares:5.9e6,value:1.1e9,putCall:'CALL'},{symbol:'SMCI',shares:11.8e6,value:.62e9},{symbol:'MRVL',shares:4.8e6,value:.44e9}],
      recentFilings:[{form:'SC 13G/A',filingDate:'2026-10-24',url:'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000000101'},{form:'4',filingDate:'2026-10-22',url:'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000000101'}]},
    {cik:'0000000102',name:'Sample Concentrated Capital (synthetic)',level:'watch',period:'2026-06-30',anchorPeriod:'2026-06-30',filingDate:'2026-08-14',
      ytd:34.6,ytdWithOptions:36.1,qoq:11.3,qoqWithOptions:11.9,tells:['concentrated'],
      stats:{reportedValue:4.2e9,stockValue:4.0e9,callNotional:.2e9,putNotional:0,callPct:5,putPct:0,positions:31},
      topMovePct:-4.1,topPricedPct:100,bookImpactPct:-3.2,pressure:'steady',drawdownPct:-5.0,
      quarters:[{period:'2026-03-31',stockPct:9.8,withOptionsPct:10.1,coverage:.97},{period:'2026-06-30',stockPct:11.3,withOptionsPct:11.9,coverage:.98}],
      top:top([['AVGO','BROADCOM INC',.9e9,288.0,276.4],['VST','VISTRA CORP',.6e9,180.0,181.5],['META','META PLATFORMS INC',.5e9,702.0,688.0]]),
      universe:[{symbol:'AVGO',shares:3.1e6,value:.9e9},{symbol:'VST',shares:3.3e6,value:.6e9},{symbol:'META',shares:.7e6,value:.5e9}],recentFilings:[]}
  ];
  return {version:LEVERAGE_DISTRESS_VERSION,builtAtIso,parserVersion:1,
    hotFunds:{latestPeriod:'2026-06-30',ytdYear:2026,funds,
      counts:{screened:1180,flagged:2,alert:1,watch:1,pressure:1,deleveraging:0,hedgedExcluded:46,lowCoverage:22},
      benchmark:{label:'Median $3B+ book (synthetic)',ytd:12.8,qoq:6.1},
      coverage:{bulk:{status:'ok'},pendingPass:null},
      stockLinks:[
        {symbol:'NVDA',funds:1,alertFunds:1,pressureFunds:1,sharesHeld:13.4e6,pctFloat:.05,daysOfVolume:.07,stressedShares:13.4e6,stressedDaysOfVolume:.07,holders:[{fund:funds[0].name,pctOfBook:27.5},{fund:funds[0].name,putCall:'CALL',pctOfBook:21.6}]},
        {symbol:'SMCI',funds:1,alertFunds:1,pressureFunds:1,sharesHeld:11.8e6,pctFloat:2.0,daysOfVolume:.6,stressedShares:11.8e6,stressedDaysOfVolume:.6,holders:[{fund:funds[0].name,pctOfBook:12.2}]},
        {symbol:'VST',funds:1,alertFunds:0,pressureFunds:0,sharesHeld:3.3e6,pctFloat:.97,daysOfVolume:.8,stressedShares:0,stressedDaysOfVolume:0,holders:[{fund:funds[1].name,pctOfBook:15}]}]},
    rebalance:{asOf:builtAtIso,note:'Synthetic assets for the preview.',rows:[
      {underlying:'SMCI',closed:true,price:39.8,movePct:-9.2,products:[{sym:'SMCX',lev:2,aum:3.1e8}],tradeUsd:-5.7e7,side:'sell',shares:-1.43e6,pctOfAdv:4.8},
      {underlying:'NVDA',closed:true,price:154.1,movePct:-4.4,products:[{sym:'NVDL',lev:2,aum:4.2e9},{sym:'NVDS',lev:-1.5,aum:1.0e8}],tradeUsd:-3.8e8,side:'sell',shares:-2.47e6,pctOfAdv:1.2}]},
    clusters:{policy:CLUSTER_POLICY,shadow:true,
      today:{date:'2026-10-27',flagged:true,reason:'3 unrelated stocks in 3 sector groups fell on heavy volume while the index held up.',indexMovePct:-0.6,
        names:[{symbol:'SMCI',movePct:-9.2,thresholdPct:6.1,volumeRatio:3.4,group:'Technology'},{symbol:'VST',movePct:-6.8,thresholdPct:5.2,volumeRatio:2.9,group:'Utilities & power'},{symbol:'COIN',movePct:-7.5,thresholdPct:7.0,volumeRatio:2.6,group:'Financials'}],
        commonHolders:[{fund:funds[0].name,held:['SMCI','VST']}]},
      log:[{date:'2026-10-27',flagged:true,indexMovePct:-0.6,names:[{symbol:'SMCI',movePct:-9.2},{symbol:'VST',movePct:-6.8},{symbol:'COIN',movePct:-7.5}],commonHolders:[{fund:funds[0].name}]},
        {date:'2026-10-20',flagged:false,indexMovePct:-1.9,names:[{symbol:'MU',movePct:-5.1}],commonHolders:[]}]},
    errors:[]};
}

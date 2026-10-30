import { buildUnifiedSignalEngine } from '../../lib/unified-signal.mjs';
import { unifiedSignalFixture, UNIFIED_FIXTURE_TIME } from './unified-signal.mjs';
import { OWNER_BRIEF_SOURCES } from '../../lib/owner-market-brief.mjs';
import { BRIEF_ACCESS_POLICY_VERSION } from '../../lib/public-data-policy.mjs';
export const OWNER_BRIEF_FIXTURE_TIME = UNIFIED_FIXTURE_TIME;
export function ownerBriefFixture() {
  const fixture = unifiedSignalFixture();
  const builtAtIso = OWNER_BRIEF_FIXTURE_TIME;
  const payloads = Object.fromEntries(OWNER_BRIEF_SOURCES.map(s=>[s.key,{builtAtIso}]));
  payloads['unified-signal.json']=buildUnifiedSignalEngine(fixture);
  payloads['market-analysis.json']={builtAtIso,macroRegime:{state:'risk-on',drivers:['Credit remains orderly','Technology leads'],fragile:true,dataQuality:{sufficient:true}},scenarioEngine:{builtAtIso,horizon:'5–10 sessions',catalysts:[{date:'2026-10-26',title:'Synthetic earnings release'}],scenarios:[{name:'Growth and rates',driver:'Synthetic source scenario',paths:[{label:'Participation broadens',condition:'Breadth improves while yields stabilize.',reactions:['Leadership could broaden beyond the largest names.'],weight:60},{label:'Narrow rally fades',condition:'Index strength persists but breadth and credit deteriorate.',reactions:['A concentrated rally could unwind.'],weight:40}]}]}};
  payloads['bottom-tracker.json']={builtAtIso,verdict:'potential',asOf:builtAtIso.slice(0,10),summary:'Synthetic credit stabilization; confirmation remains incomplete.'};
  payloads['grades.json']={builtAtIso,grades:fixture.grades};
  payloads['trends.json']={builtAtIso,narratives:[{title:'Synthetic demand theme',summary:'Supplier demand improves; pricing still needs confirmation.'}]};
  for(const key of ['picks.json','leaps-picks.json'])payloads[key]={builtAtIso,picks:[{symbol:'BULL'},{symbol:'WAIT'}],watch:[{symbol:'WATCH'}]};
  for(const key of ['stock-picks.json','sector-rotation.json'])payloads[key]={builtAtIso,candidates:[{symbol:'BULL'},{symbol:'WAIT'}]};
  payloads['leveraged-etfs.json']={builtAtIso,ideas:[{etf:'BULLX'}],watch:[{etf:'WAITX'}]};
  payloads['picks-open.json']={builtAtIso,open:[{symbol:'BULL'}]};
  payloads['picks-accuracy.json']={builtAtIso,closed:[{symbol:'OLD'}]};
  payloads['earnings-forecast.json']={builtAtIso,companies:[{symbol:'BULL',forecast:{status:'ready',cutoffAt:'2026-10-20T12:00:00Z',target:{end:'2026-12-31'},currency:'USD',outputs:{revenue:120000000,eps:2.4},warnings:['Synthetic forecast; no market data.']}}]};
  payloads['quant.json']=fixture.quant;
  payloads['leverage-distress.json']={builtAtIso,hotFunds:{asOf:builtAtIso,counts:{pressure:2,deleveraging:1}}};
  payloads['forced-liquidation.json']={builtAtIso,rows:[{symbol:'WAIT'}],coverage:{scanHealthy:false}};
  payloads['historical-data.json']={builtAtIso,indexes:{SPY:{}}};
  payloads['briefs.json']={builtAtIso,current:{accessPolicyVersion:BRIEF_ACCESS_POLICY_VERSION,date:builtAtIso.slice(0,10),kind:'intraday',generatedAtIso:builtAtIso,headline:'Synthetic public foundation',summary:'The index rises while participation remains mixed.',highlights:[{label:'Breadth',text:'A fictional observation.'}],indexes:[{sym:'SPY',chPct:0.7}],toolScan:{checked:['Heatmap'],total:1,standouts:[]}}};
  return {builtAtIso,payloads,publicCore:{breadth:{up:30,down:70,flat:0},indexes:[{sym:'SPY',chPct:0.7}]},publicScan:{checked:['Heatmap'],missing:['Overnight markets'],facts:[{source:'Heatmap',tab:'heatmap',text:'30% of synthetic tracked names advanced.'}]}};
}

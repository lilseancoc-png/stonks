import {topPicksMarket} from './top-picks-market.mjs';
export const TOP_PICKS_APPROVAL_KEY='top-picks-approval.json';
const parse=b=>b==null?null:JSON.parse(b.toString('utf8'));

// Request-time permission has its own writer and key. It never changes the
// recommendation snapshot, research, broker orders or position ledgers.
export async function approvedTopPicks({store,fetchLive,now=()=>Date.now()}) {
  const payload=parse(await store.get('picks.json'));
  if(!payload?.rosterMeta?.marketAssessment)return payload;
  const latest=parse(await store.get('market-analysis.json'));
  let assessment=payload.rosterMeta.currentMarketAssessment||payload.rosterMeta.marketAssessment;
  if(latest?.macroRegime&&Date.parse(latest.builtAtIso)>Date.parse(assessment.asOf)) {
    assessment=topPicksMarket.assess({macroRegime:latest.macroRegime,asOf:latest.builtAtIso,desks:assessment.desks,previous:assessment.priorAxes,earnings:assessment.earnings,
      transition:latest.scenarioEngine?.transition||{fragility:{warningCount:assessment.forwardWarnings,leadingCount:assessment.leadingCount}}});
  }
  const at=new Date(now()).toISOString();
  const live=await fetchLive().catch(()=>null);
  assessment=topPicksMarket.liveReview(assessment,live?.legs||{},at);
  let reviewed=topPicksMarket.revalidate(payload,assessment,{now:now(),live:true});
  let appliedAssessment=assessment;
  const publication=payload.builtAtIso;
  const lease=await store.withLease('top-picks-approval',async guard=>{
    const prior=parse(await store.get(TOP_PICKS_APPROVAL_KEY));
    if(prior&&(!Number.isFinite(Date.parse(prior.publication))||!prior.held||Array.isArray(prior.held)||typeof prior.held!=='object'))throw Error('Stored market approval is malformed');
    const source=parse(await store.get('picks.json'));
    if(source?.builtAtIso!==publication)throw Error('Publication changed during market review');
    if(prior&&Date.parse(prior.publication)>Date.parse(publication))throw Error('Publication changed during market review');
    const held=prior?.publication===publication?{...prior.held}:{};
    let pending=null;
    const ordinary=assessment.ready&&!assessment.exceptionalShock&&payload.rosterMeta.marketPublication!=='offline-research'&&(reviewed.picks||[]).some(p=>{
      const published=payload.picks.find(old=>old.symbol===p.symbol&&old.side===p.side);
      return published?.group==='actionable'&&published.entry?.now===true&&!held[p.symbol+':'+p.side]&&p.marketApproval?.held&&p.marketApproval.reason!=='Market or stock review is stale or unavailable';
    });
    if(ordinary){
      const fingerprint=JSON.stringify([assessment.state,assessment.confirmation,(reviewed.picks||[]).filter(p=>p.marketApproval?.held).map(p=>p.symbol+':'+p.side).sort()]);
      const previous=prior?.publication===publication&&prior?.pending?.fingerprint===fingerprint?prior.pending:null;
      const confirmed=previous&&now()-Date.parse(previous.firstAt)>=30000&&Date.parse(assessment.quoteAsOf||assessment.asOf)>Date.parse(previous.quoteAsOf||previous.firstAt);
      if(!confirmed){
        pending=previous||{fingerprint,firstAt:at,quoteAsOf:assessment.quoteAsOf||assessment.asOf};
        appliedAssessment=payload.rosterMeta.currentMarketAssessment||payload.rosterMeta.marketAssessment;
        reviewed=topPicksMarket.revalidate(payload,appliedAssessment,{now:now(),live:true});
        reviewed.marketConfirmationPending=true;
      }
    }
    for(const p of reviewed.picks||[])if(p.marketApproval?.held)held[p.symbol+':'+p.side]=p.marketApproval.reason;
    guard();
    if(prior?.publication!==publication||Object.keys(held).length||pending||prior?.pending)await store.put(TOP_PICKS_APPROVAL_KEY,JSON.stringify({publication,checkedAt:at,held,pending}));
    return held;
  });
  if(lease.busy)throw Error('Market approval review is already running');
  const held=lease.result;
  reviewed={...reviewed,rosterMeta:{...reviewed.rosterMeta,currentMarketAssessment:appliedAssessment,
    pendingMarketAssessment:reviewed.marketConfirmationPending?assessment:null},picks:(reviewed.picks||[]).map(p=>{
    const reason=held[p.symbol+':'+p.side];
    if(!reason)return p;
    return {...p,group:'watch',classification:'waitEntry',marketApproval:{...p.marketApproval,held:true,reason},entry:{...p.entry,now:false,signal:'wait-market',headline:reason}};
  })};
  return reviewed;
}

// Admission handoff only. Already mirrored positions keep their original exit
// and reconciliation policy; an unmirrored open must still be a current pick.
export function applyMarketAdmission(acc,picks,ledger) {
  if(!acc?.open?.some(r=>r.marketAdjustment))return acc;
  const ready=new Set((picks?.picks||[]).filter(p=>p.group==='actionable'&&p.entry?.now===true&&!p.marketApproval?.held).map(p=>p.symbol+':'+p.side));
  return {...acc,open:acc.open.filter(r=>!r.marketAdjustment||ready.has(r.symbol+':'+r.side)||Object.values(ledger?.trades||{}).some(t=>t.symbol===r.symbol&&t.side===r.side&&t.engineEntryIso===r.entryDate))};
}

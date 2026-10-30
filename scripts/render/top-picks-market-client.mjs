// Top Picks and its Track Record only. No shared feature renderers depend on this.
export function topPicksMarketClientFactory() {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=(v,unit='')=>v==null?'Pending':Number(v).toFixed(1)+unit;
  const labels={legacy:'Previous policy',labels:'Market labels',combined:'Market + confirmation'};
  const states={'risk-on':'Risk-on',neutral:'Neutral',fragile:'Fragile','risk-off':'Risk-off','severe-risk-off':'Severe risk-off','insufficient-data':'Unconfirmed market'};
  const stamp=iso=>iso&&Number.isFinite(Date.parse(iso))?new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unknown';
  function snapshot(p,current=[]) {
    if(!p?.marketAdjustment)return p;
    const approved=current.find(r=>r.symbol===p.symbol&&r.side===p.side);
    if(approved)return approved;
    const reason='Saved snapshot requires a fresh Top Picks review';
    return {...p,group:'watch',classification:'waitEntry',marketApproval:{...p.marketApproval,held:true,reason},entry:{...p.entry,now:false,signal:'wait-market',headline:reason}};
  }
  function context(payload) {
    const a=payload?.rosterMeta?.currentMarketAssessment||payload?.rosterMeta?.marketAssessment;
    if(!a)return '';
    const counts=a.counts||{},desks=a.desks||[];
    const multiplier=a.ready?Math.max(.5,Math.min(1.1,a.base+a.confirmation)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})+'×':'Unavailable';
    const pending=payload?.rosterMeta?.pendingMarketAssessment;
    return '<details class="tpm-evidence"><summary>Market context · '+esc(states[a.state]||a.state)+' · '+esc(a.trajectory)+' · '+(counts.current||0)+' / 7 current reads</summary>'+
      (payload.marketReviewUnavailable?'<p><b>Wait — current market approval is unavailable.</b> This panel shows the last successful review.</p>':'')+
      '<p><b>'+(a.ready?'Equity-call reference multiplier '+multiplier:'Wait — current core market evidence is required')+'</b>. '+(counts.defensive||0)+' defensive and '+(counts.constructive||0)+' constructive directional reads. These are context counts; overlapping desks do not receive independent full votes. Each card applies its own trade direction and exposure.</p>'+
      (pending?'<p><b>Confirmation pending:</b> a newer '+esc(states[pending.state]||pending.state)+' read requires a second distinct observation. Published scores remain in force until confirmed.</p>':'')+
      '<p>'+esc((a.reasons||[]).join('. '))+'. Market checked '+esc(stamp(a.asOf))+'.</p><ul>'+desks.map(d=>'<li><b>'+esc(d.name)+'</b>: '+(!d.available?'unavailable or stale':d.id==='gamma'?(d.structure==='amplify'?'can amplify moves':'can dampen moves'):d.stance<0?'defensive':d.stance>0?'constructive':'mixed or neutral')+' · '+esc(stamp(d.asOf))+'</li>').join('')+'</ul>'+
      '<details><summary>Cross-asset evidence behind the market label</summary><ul>'+Object.entries(a.sourceAxes||{}).map(([key,v])=>'<li><b>'+esc(key)+'</b>: '+esc(v.available?v.label:'unavailable')+' · '+esc(stamp(v.asOf))+'</li>').join('')+'</ul></details></details>';
  }
  function scores(p) {
    if(!p?.marketAdjustment)return '';
    const a=p.marketAdjustment;
    return '<span class="tpm-scores" aria-label="Stock conviction and market-adjusted trade score">'+
      '<span>Stock conviction <b>'+value(p.stockConviction)+'</b></span><span>Market trade score <b>'+value(p.tradeScore)+'</b></span>'+
      '<span>'+esc(states[a.marketState]||a.marketState)+' · '+Number(a.multiplier).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})+'× · '+esc(a.trajectory)+'</span>'+
      (p.marketApproval?.held?'<strong>Wait · '+esc(p.marketApproval.reason||'Market review required')+'</strong>':'')+
      '<span class="tpm-time">Stock reviewed '+esc(stamp(p.marketApproval?.thesisReviewedAt))+' · Market checked '+esc(stamp(p.marketApproval?.checkedAt||a.marketAsOf))+'</span></span>';
  }
  function study(data,horizon=10,record={}) {
    const r=data?.reports?.[horizon];
    const unavailable=data?.unavailable?'<p><b>Measurement paused.</b> '+esc(data.issue)+' Last completed study update: '+esc(stamp(data.builtAtIso))+'.</p>':'';
    const controls='<div class="tpm-controls" role="group" aria-label="Forward measurement horizon">'+[5,10,20].map(h=>'<button type="button" data-market-horizon="'+h+'" aria-pressed="'+(h===horizon)+'">'+h+' sessions</button>').join('')+'</div>';
    if(!r)return '<h3>Market policy measurement</h3>'+unavailable+(data?.unavailable?'':'<p>Prospective comparisons start with the next Top Picks decision. Existing trades keep their recorded scores.</p>');
    const table=(rows)=>'<div class="tpm-table"><table><caption>Paired eligibility comparisons · '+horizon+' subsequent confirmed sessions</caption><thead><tr><th>Policy</th><th>Eligible ideas</th><th>Ideas / run</th><th>Calls / puts</th><th>Mature</th><th>Directional win rate</th><th>Mean stock move in trade direction</th><th>Worst adverse daily close</th><th>Mean modeled option return / maximum loss</th></tr></thead><tbody>'+rows.map(p=>'<tr><th>'+esc(labels[p.key])+'</th><td>'+p.decisions+'</td><td>'+value(r.publicationCount?p.decisions/r.publicationCount:null)+'</td><td>'+p.calls+' / '+p.puts+'</td><td>'+p.mature+'</td><td>'+(p.directionalWinRatePct==null?'Needs 20 mature':value(p.directionalWinRatePct,'%'))+'</td><td>'+value(p.meanDirectionalReturnPct,'%')+'</td><td>'+value(p.worstCloseExcursionPct,'%')+'</td><td>'+value(p.meanModeledOptionRiskReturnPct,'%')+' · n='+p.modeledOptionSample+'</td></tr>').join('')+'</tbody></table></div>';
    const actual=[...(record.closed||[]),...(record.archive||[])].filter(e=>e.marketAdjustment&&['win','loss','flat'].includes(e.outcome)&&e.optionPnlPct!=null&&Number.isFinite(Number(e.optionPnlPct)));
    const legacy=(record.closed||[]).filter(e=>!e.marketAdjustment).length;
    const actualMean=actual.length?actual.reduce((s,e)=>s+(Number(e.optionPnlPct)||0),0)/actual.length:null;
    const comparisons=r.periods?.holdout||[];
    return '<h3>Market policy measurement</h3>'+unavailable+'<p>Same stock opportunities, frozen decision evidence, three policy eligibility checks. These are prospective research comparisons, not executed portfolios or broker fills.</p>'+controls+
      '<div class="tpm-metrics"><span><b>'+r.publicationCount+'</b> decision runs</span><span><b>'+r.total+'</b> stock-side snapshots</span><span><b>'+r.mature+'</b> mature snapshots</span><span><b>'+r.emptyRuns+'</b> runs with no recommendations</span></div>'+table(r.policies)+
      '<p>Of '+r.heldBackSample+' mature ideas eligible under the previous policy and held by the combined policy: <b>'+r.avoidedLosers+'</b> subsequently moved against the trade; <b>'+r.missedWinners+'</b> moved with it. These are underlying-price outcomes. Eligibility changed '+r.flips+' times across repeated stock-side observations. '+r.unavailableRuns+' runs had unavailable core market evidence. '+(data.collectionGaps||0)+' decision runs could not be recorded because measurement storage was unavailable.</p>'+
      '<p><b>Recorded Top Picks cohort:</b> '+actual.length+' resolved trades with market-policy evidence; mean recorded modeled option P&amp;L '+value(actualMean,'%')+'. '+legacy+' older closed rows retain their original policy. Verified broker-fill comparisons remain in Real fills.</p>'+
      '<details><summary>Chronological comparison and limits</summary><p>'+esc(data.method)+' '+esc(r.caveat)+'</p><p>Multipliers are starting settings and have not been calibrated. '+(r.splitDate?'The first 70% of observed dates form the development window; later observations begin '+esc(r.splitDate)+'. This is a chronological monitoring split, not an independently untouched calibration holdout.':'At least ten observed dates are required for a chronological monitoring split.')+'</p>'+
      (r.splitDate?'<ul>'+comparisons.map(p=>'<li>'+esc(labels[p.key])+': later-window n='+p.n+', mean directional stock return '+value(p.mean,'%')+'</li>').join('')+'</ul>':'')+
      (r.byRegime?.length?'<p><b>By market environment</b></p><ul>'+r.byRegime.map(g=>'<li>'+esc(g.state)+': '+g.results.map(p=>esc(labels[p.key])+' n='+p.n+', '+value(p.mean,'%')).join(' · ')+'</li>').join('')+'</ul>':'')+
      '<p>'+esc(data.historicalCoverage)+' '+(data.paused?'Collection paused at the storage cap; existing observations are preserved.':'Fixed-horizon outcomes appear only after their required sessions complete.')+'</p></details>';
  }
  return {scores,study,context,snapshot};
}

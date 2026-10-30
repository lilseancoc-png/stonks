// Top Picks and its Track Record only. No shared feature renderers depend on this.
export function topPicksMarketClientFactory() {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=(v,unit='')=>v==null?'Pending':Number(v).toFixed(1)+unit;
  const factor=v=>v==null||!Number.isFinite(Number(v))?'Unknown':Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3});
  const labels={legacy:'Previous policy',labels:'Market labels',combined:'Market + confirmation'};
  const states={'risk-on':'Risk-on',neutral:'Neutral',fragile:'Fragile','risk-off':'Risk-off','severe-risk-off':'Severe risk-off','insufficient-data':'Unconfirmed market'};
  const destinations={market:'market','fear-greed':'fear-greed',heatmap:'heatmap',volume:'volume','index-cal':'index-cal',overnight:'overnight',gamma:'oi'};
  const axisNames={indexes:'SPY and QQQ',vix:'Equity volatility (VIX)',yields:'Long Treasury yields',twoY:'2-year Treasury yield',bondVol:'Bond volatility (MOVE)',dxy:'US dollar',fed:'Fed policy path',commodity:'Oil and gold',geo:'Geopolitics',inflation:'Inflation and employment',sentiment:'Fear & Greed',globalTape:'Overnight lead',breadth:'Tracked-stock breadth',putCall:'Options positioning',credit:'High-yield credit spreads',rotation:'Offense versus defense'};
  const stamp=iso=>iso&&Number.isFinite(Date.parse(iso))?new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unknown';
  function snapshot(p,current=[]) {
    if(!p?.marketAdjustment)return p;
    const approved=current.find(r=>r.symbol===p.symbol&&r.side===p.side);
    if(approved)return approved;
    const reason='Saved snapshot requires a fresh Top Picks review';
    return {...p,group:'watch',classification:'waitEntry',marketApproval:{...p.marketApproval,held:true,reason},entry:{...p.entry,now:false,signal:'wait-market',headline:reason}};
  }
  function display(p) {
    if(!p?.marketAdjustment||p.group==='actionable'||p.entry?.now!==true)return p;
    return {...p,entry:{...p.entry,now:false,signal:'wait-qualification',headline:'Wait — the final recommendation remains watch-only'}};
  }
  function context(payload) {
    const a=payload?.rosterMeta?.currentMarketAssessment||payload?.rosterMeta?.marketAssessment;
    if(!a)return '';
    const counts=a.counts||{},desks=a.desks||[];
    const multiplier=a.ready?Math.max(.5,Math.min(1.1,a.base+a.confirmation)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})+'×':'Unavailable';
    const pending=payload?.rosterMeta?.pendingMarketAssessment;
    return '<details class="tpm-evidence" data-tpm-panel="market-context"><summary>Market context · '+esc(states[a.state]||a.state)+' · '+esc(a.trajectory)+' · '+(counts.current||0)+' / 7 current reads</summary>'+
      (payload.marketReviewUnavailable?'<p><b>Wait — current market approval is unavailable.</b> This panel shows the last successful review.</p>':'')+
      '<p><b>'+(a.ready?'Equity-call reference multiplier '+multiplier:'Wait — current core market evidence is required')+'</b>. '+(counts.defensive||0)+' defensive and '+(counts.constructive||0)+' constructive directional reads. These are context counts; overlapping desks do not receive independent full votes. Each card applies its own trade direction and exposure.</p>'+
      (pending?'<p><b>Confirmation pending:</b> a newer '+esc(states[pending.state]||pending.state)+' read requires a second distinct observation. Published scores remain in force until confirmed.</p>':'')+
      '<p>'+esc((a.reasons||[]).join('. '))+'. Market checked '+esc(stamp(a.asOf))+'.</p><p><a href="?tab=risk">Inspect Risk analysis</a>. The equity-call reference combines base '+factor(a.base)+' and confirmation '+factor(a.confirmation)+', inside the 0.50–1.10 bounds.</p><ul>'+desks.map(d=>'<li><a href="?tab='+esc(destinations[d.id]||'risk')+'">'+esc(d.name)+'</a>: '+(!d.available?'unavailable or stale':d.id==='gamma'?(d.structure==='amplify'?'can amplify moves':d.structure==='dampen'?'can dampen moves':'balanced proxy'):d.stance<0?'defensive':d.stance>0?'constructive':'mixed or neutral')+' · '+esc(stamp(d.asOf))+'</li>').join('')+'</ul>'+
      '<details data-tpm-panel="market-axes"><summary>Cross-asset evidence behind the market label</summary><ul>'+Object.entries(a.sourceAxes||{}).map(([key,v])=>'<li><b>'+esc(axisNames[key]||key)+'</b>: '+esc(v.available?v.label:'unavailable')+' · score '+value(v.available?v.score:null)+' · weight '+factor(v.weight)+' · weighted contribution '+factor(v.contribution)+' · '+esc(stamp(v.asOf))+'</li>').join('')+'</ul></details></details>';
  }
  function explain(p) {
    const a=p?.marketAdjustment;if(!a)return '';
    const signed=v=>v==null||!Number.isFinite(Number(v))?'Unknown':(v>0?'+':'')+Number(v).toLocaleString(undefined,{maximumFractionDigits:4});
    const pillars=Object.entries(p.pillars||{}).filter(([k,v])=>!['ivCost','timing'].includes(k)&&!v.executionOnly).map(([k,v])=>esc(k)+' '+signed(v.score));
    return '<details class="tpm-score-audit tpm-evidence" data-tpm-panel="score-'+esc(p.symbol)+'-'+esc(p.side)+'"><summary>How this trade score is calculated</summary>'+
      '<ol><li>Stock conviction <b>'+signed(p.stockConviction)+'</b>'+(pillars.length?' from '+pillars.join(', '):'')+'.</li>'+
      '<li>After option-cost adjustment: <b>'+signed(p.optionAdjustedConviction)+'</b>. Signed change '+signed(p.optionAdjustedConviction-p.stockConviction)+'.</li>'+
      '<li>Market base '+signed(a.baseMultiplier)+' plus confirmation '+signed(a.confirmationAdjustment)+' gives the applied <b>'+Number(a.multiplier).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})+'×</b> multiplier after bounds.</li>'+
      '<li>Option-adjusted magnitude × multiplier gives '+signed(a.beforeCaps??p.tradeScore)+'. Final market trade score <b>'+signed(p.tradeScore)+'</b> after score caps and rounding. Direction stays '+esc((p.side||'').toUpperCase())+'.</li></ol>'+
      (a.caps?.length?'<p>'+esc(a.caps.join('. '))+'.</p>':'')+
      '<p>'+(a.exposure===0?'This instrument receives no generic equity-market adjustment.':a.exposure<0?'Its exposure runs opposite to broad equities.':'The market adjustment follows the trade direction.')+' '+esc((a.reasons||[]).join('. '))+'.</p>'+
      '<p><b>Entry decision:</b> '+esc(p.marketApproval?.held?p.marketApproval.reason:p.group==='actionable'&&p.entry?.now?'Published stock, contract and entry prerequisites cleared':p.entry?.headline||'Watch until the full entry review clears')+'.</p></details>';
  }
  function update(host,html) {
    const key=d=>d.getAttribute('data-tpm-panel')||d.id||d.querySelector('summary')?.textContent?.trim();
    const opened=new Set([...host.querySelectorAll('details[open]')].map(key));
    const active=host.ownerDocument?.activeElement,focusKey=active?.tagName==='SUMMARY'&&host.contains(active)?key(active.parentElement):null;
    const focusAttribute=host.contains(active)?['data-market-horizon','data-pick-tab'].find(a=>active?.hasAttribute(a)):null;
    const focusValue=focusAttribute?active.getAttribute(focusAttribute):null;
    const scrolled=new Map([...host.querySelectorAll('[data-tpm-scroll]')].map(el=>[el.getAttribute('data-tpm-scroll'),el.scrollLeft]));
    host.innerHTML=html;
    for(const d of host.querySelectorAll('details')){if(opened.has(key(d)))d.open=true;if(focusKey&&key(d)===focusKey)d.querySelector('summary')?.focus({preventScroll:true});}
    if(focusAttribute)for(const el of host.querySelectorAll('['+focusAttribute+']'))if(el.getAttribute(focusAttribute)===focusValue)el.focus({preventScroll:true});
    for(const el of host.querySelectorAll('[data-tpm-scroll]'))if(scrolled.has(el.getAttribute('data-tpm-scroll')))el.scrollLeft=scrolled.get(el.getAttribute('data-tpm-scroll'));
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
    const comparableRuns=r.comparisonRunCount??r.publicationCount;
    // Match the shared table enhancer before scroll restoration. Its sort
    // affordances otherwise widen the columns on the next animation frame.
    const headings=['Policy','Eligible ideas','Ideas / captured run','Calls / puts','Mature','Directional win rate','Mean stock move in trade direction','Worst adverse daily close','Mean modeled option return / maximum loss']
      .map(t=>'<th class="ts-th" tabindex="0" aria-sort="none" title="Click to sort">'+t+'</th>').join('');
    const table=(rows)=>'<div class="tpm-table" data-tpm-scroll="comparison" tabindex="0" aria-label="Policy comparison, scroll horizontally for more metrics"><table><caption>Paired eligibility comparisons · '+horizon+' subsequent confirmed sessions</caption><thead><tr>'+headings+'</tr></thead><tbody>'+rows.map(p=>'<tr><th>'+esc(labels[p.key])+'</th><td>'+p.decisions+'</td><td>'+value(comparableRuns?p.decisions/comparableRuns:null)+'</td><td>'+p.calls+' / '+p.puts+'</td><td>'+p.mature+'</td><td>'+(p.directionalWinRatePct==null?'Needs 20 mature':value(p.directionalWinRatePct,'%'))+'</td><td>'+value(p.meanDirectionalReturnPct,'%')+'</td><td>'+value(p.worstCloseExcursionPct,'%')+'</td><td>'+value(p.meanModeledOptionRiskReturnPct,'%')+' · n='+p.modeledOptionSample+'</td></tr>').join('')+'</tbody></table></div>';
    const actual=[...(record.closed||[]),...(record.archive||[])].filter(e=>e.marketAdjustment&&['win','loss','flat'].includes(e.outcome)&&e.optionPnlPct!=null&&Number.isFinite(Number(e.optionPnlPct)));
    const legacy=(record.closed||[]).filter(e=>!e.marketAdjustment).length;
    const actualMean=actual.length?actual.reduce((s,e)=>s+(Number(e.optionPnlPct)||0),0)/actual.length:null;
    const comparisons=r.periods?.holdout||[];
    return '<h3>Market policy measurement</h3>'+unavailable+'<p>Same stock opportunities, frozen decision evidence, three policy eligibility checks. These are prospective research comparisons, not executed portfolios or broker fills.</p>'+controls+
      '<div class="tpm-metrics"><span><b>'+r.publicationCount+'</b> decision runs</span><span><b>'+r.total+'</b> stock-side snapshots</span><span><b>'+r.mature+'</b> mature snapshots</span><span><b>'+r.emptyRuns+'</b> runs with no recommendations</span></div>'+table(r.policies)+
      '<p>Comparisons use '+comparableRuns+' completely captured runs. '+(r.incompleteRuns||0)+' incomplete runs are excluded from eligibility rates and returns. Of '+r.heldBackSample+' mature ideas eligible under the previous policy and held by the combined policy: <b>'+r.avoidedLosers+'</b> subsequently moved against the trade; <b>'+r.missedWinners+'</b> moved with it. These are underlying-price outcomes. Eligibility changed '+r.flips+' times across repeated stock-side observations. '+r.unavailableRuns+' runs had unavailable core market evidence. '+(data.collectionGaps||0)+' decision runs could not be recorded because measurement storage was unavailable.</p>'+
      '<p><b>Recorded Top Picks cohort:</b> '+actual.length+' resolved trades with market-policy evidence; mean recorded modeled option P&amp;L '+value(actualMean,'%')+'. '+legacy+' older closed rows retain their original policy. Verified broker-fill comparisons remain in Real fills.</p>'+
      '<details><summary>Chronological comparison and limits</summary><p>'+esc(data.method)+' '+esc(r.caveat)+'</p><p>Multipliers are starting settings and have not been calibrated. '+(r.splitDate?'The first 70% of observed dates form the development window; later observations begin '+esc(r.splitDate)+'. This is a chronological monitoring split, not an independently untouched calibration holdout.':'At least ten observed dates are required for a chronological monitoring split.')+'</p>'+
      (r.splitDate?'<ul>'+comparisons.map(p=>'<li>'+esc(labels[p.key])+': later-window n='+p.n+', mean directional stock return '+value(p.mean,'%')+'</li>').join('')+'</ul>':'')+
      (r.byRegime?.length?'<p><b>By market environment</b></p><ul>'+r.byRegime.map(g=>'<li>'+esc(g.state)+': '+g.results.map(p=>esc(labels[p.key])+' n='+p.n+', '+value(p.mean,'%')).join(' · ')+'</li>').join('')+'</ul>':'')+
      '<p>'+esc(data.historicalCoverage)+' '+(data.unavailable?'Collection is paused while measurement storage is unavailable.':data.paused?'Collection paused at the storage cap; existing observations are preserved.':'Fixed-horizon outcomes appear only after their required sessions complete.')+'</p></details>';
  }
  return {scores,study,context,snapshot,explain,update,display};
}

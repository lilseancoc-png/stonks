// Serialized into app.js. Keep this factory self-contained.
export function forcedLiquidationFactory(win, doc, config) {
  const storageKey='mingstreet-forced-liquidation-v1';
  let state={view:'watch',query:'',filter:'active',sort:'distance',direction:null,selected:null,ltv:0.5}, data=null, loading=false,expiryTimer=null;
  try { const saved=JSON.parse(win.localStorage.getItem(storageKey)||'null'); if(saved) state={...state,...saved}; } catch {}
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=1)=>typeof v==='number' && Number.isFinite(v) ? v.toLocaleString(undefined,{maximumFractionDigits:d}) : 'Undisclosed';
  const money=v=>typeof v==='number' && Number.isFinite(v)?'$'+n(v,2):'Undisclosed';
  const pct=v=>typeof v==='number' && Number.isFinite(v)?(v!==0&&Math.abs(v)<0.1?v.toLocaleString(undefined,{maximumSignificantDigits:2}):n(v))+'%':'Unavailable';
  const date=s=>s?esc(String(s).slice(0,19).replace('T',' ')+' UTC'):'Not recorded';
  const label=s=>({'near-trigger':'Near estimated trigger','modeled-breach':'Below modeled threshold',monitor:'Monitor','scenario-only':'Scenario only','needs-terms':'Needs loan terms','stale-quote':'Stale stock quote',stale:'Stale disclosure','debt-context':'Corporate debt context',released:'Pledge released'}[s]||'Review');
  const root=()=>doc.getElementById('forced-liquidation-root');
  function safeUrl(url) { try { const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.sec.gov'&&u.pathname.startsWith('/Archives/edgar/data/')?esc(u.href):null; }catch{return null;} }
  function link(row) {const url=safeUrl(row.url||row.sourceUrl);return url?'<a href="'+url+'" target="_blank" rel="noopener noreferrer">Open SEC '+esc(row.form||'filing')+'</a>':'SEC link unavailable';}
  function save(){try{win.localStorage.setItem(storageKey,JSON.stringify(state));}catch{}}
  function expireSnapshot(body){
    const now=Date.now(),scanAge=(now-Date.parse(body.coverage.lastSuccessAt))/86400000;
    body.coverage.scanHealthy=body.coverage.status==='ok'&&scanAge>=0&&scanAge<=3;
    for(const r of body.rows){
      const quoteAge=(now-Date.parse(r.market?.quoteAsOf))/3600000;
      const factAge=(now-Date.parse(r.observation?.asOfDate||r.observation?.filingDate))/86400000;
      const evidenceCurrent=r.observation?.parserVersion===config.evidenceVersion;
      if(!evidenceCurrent){r.principalBorrowed=null;r.sharesPledged=null;r.triggerPrice=null;r.distancePct=null;r.scenarios=[];r.estimateBasis='unavailable';r.state='needs-terms';r.engineEligible=false;r.vetoLong=false;r.pledgedToAdvPct=null;r.pledgedToFloatPct=null;r.velocity=null;r.reflexivityWatch=false;r.liquidityWarning=false;r.liquidationDaysAt100PctAdv=null;}
      if(!(typeof r.market?.price==='number'&&Number.isFinite(r.market.price)&&r.market.price>0)||!Number.isFinite(quoteAge)||quoteAge < -5/60||quoteAge>96){r.priceFresh=false;r.distancePct=null;r.vetoLong=false;r.engineEligible=false;if(r.estimateBasis==='disclosed-terms')r.state='stale-quote';for(const s of r.scenarios||[])s.distancePct=null;}
      if(!Number.isFinite(factAge)||factAge<0||factAge>400){r.state='stale';r.current=false;r.triggerPrice=null;r.distancePct=null;r.scenarios=[];r.engineEligible=false;r.vetoLong=false;r.velocity=null;r.reflexivityWatch=false;}
      if(!body.coverage.scanHealthy||factAge>90){r.engineEligible=false;r.vetoLong=false;}
      if(!r.current||!r.priceFresh){r.reflexivityWatch=false;r.distanceVelocityPpPerDay=null;}
      const volumeAge=(now-Date.parse(r.market?.volumeAsOf))/86400000;
      if(!evidenceCurrent||!r.current||!Number.isFinite(volumeAge)||volumeAge<0||volumeAge>7||r.market?.volumeSessions!==20){r.pledgedToAdvPct=null;r.liquidationDaysAt100PctAdv=null;r.liquidityWarning=false;r.reflexivityWatch=false;}
      if(r.observation.kind!=='equity-pledge')r.state='debt-context';else if(evidenceCurrent&&r.observation.status==='released')r.state='released';
    }
    body.summary={tracked:body.rows.filter(r=>r.observation.kind==='equity-pledge'&&r.state!=='released').length,
      modeled:body.rows.filter(r=>r.triggerPrice!=null).length,
      assessable:body.rows.filter(r=>r.current&&r.priceFresh&&r.distancePct!=null).length,
      comparable:body.rows.filter(r=>r.current&&r.velocity!=null).length,
      nearTrigger:body.rows.filter(r=>r.current&&r.priceFresh&&r.distancePct!=null&&r.distancePct<=15).length,
      topUps:body.rows.filter(r=>r.current&&r.state!=='released'&&r.velocity?.collateralTopUp).length,
      needsTerms:body.rows.filter(r=>['needs-terms','scenario-only'].includes(r.state)).length};
    return body;
  }
  function scheduleExpiry(){
    if(expiryTimer)win.clearTimeout(expiryTimer);
    const deadlines=[Date.parse(data.coverage.lastSuccessAt)+3*86400000];
    for(const r of data.rows){deadlines.push(Date.parse(r.market?.quoteAsOf)+96*3600000);const fact=Date.parse(r.observation?.asOfDate||r.observation?.filingDate);deadlines.push(fact+90*86400000,fact+400*86400000);}
    const next=Math.min(...deadlines.filter(t=>Number.isFinite(t)&&t>Date.now()));
    if(Number.isFinite(next))expiryTimer=win.setTimeout(()=>render(),Math.min(2147483647,Math.max(1,next-Date.now()+10)));
  }
  function metric(k,v,caption){return '<div class="fl-metric"><span>'+esc(k)+'</span><b>'+esc(v)+'</b><small>'+esc(caption)+'</small></div>';}
  function warning(text){return '<p class="fl-notice">'+esc(text)+'</p>';}
  function basis(r){return r.estimateBasis==='disclosed-terms'?'Disclosed loan terms · estimate':r.scenarios?.length?'Assumed LTV · single-stock scenario':'Insufficient disclosed terms';}
  function signals(r){return [r.velocity?.collateralTopUp?'Possible collateral top-up':null,r.liquidityWarning?'Pledge >20% of daily volume':null,r.reflexivityWatch?'Reflexivity watch':null,r.velocity?.leverageVelocityPct30d>0?'Leverage per share rising':null].filter(Boolean);}
  function coverage(){
    const c=data.coverage||{};
    return '<div class="fl-coverage"><span class="fl-status fl-'+(c.scanHealthy?'monitor':'needs-terms')+'">'+(c.scanHealthy?'SEC scan available':c.status==='unavailable'?'SEC unavailable':'Incomplete SEC scan')+'</span><span>Last successful scan '+date(c.lastSuccessAt)+'</span><span>'+n(c.documentsThisRun,0)+' documents read this run</span>'+((c.pendingFilings||[]).length?'<span>'+n(c.pendingFilings.length,0)+' documents waiting for review</span>':'')+(c.capped?'<span>Coverage capped · inspect source scope</span>':'')+'</div>';
  }
  function toolbar(){return '<div class="fl-toolbar"><label>Find a company or borrower<input type="search" data-fl-search value="'+esc(state.query)+'" placeholder="Ticker, company, stakeholder…"></label><label>Show<select data-fl-filter>'+[['active','Active pledges'],['near','Near trigger'],['topups','Collateral top-ups'],['liquidity','Liquidity warnings'],['terms','Missing terms / scenarios'],['all','All disclosures']].map(([v,t])=>'<option value="'+v+'"'+(state.filter===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label><label>Order by<select data-fl-sort>'+[['distance','Distance to trigger'],['velocity','Leverage velocity'],['volume','Pledge / daily volume'],['date','Latest filing'],['company','Company / borrower'],['principal','Principal borrowed'],['shares','Shares pledged'],['trigger','Estimated trigger'],['price','Stock price']].map(([v,t])=>'<option value="'+v+'"'+(state.sort===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label><button type="button" class="book-more" data-fl-export>Export CSV</button><button type="button" class="book-more" data-fl-retry>Reload snapshot</button></div>';}
  function visibleRows(){
    const q=String(state.query).trim().toLowerCase();
    return data.rows.filter(r=>!q||[r.symbol,r.company,r.borrower].some(v=>String(v||'').toLowerCase().includes(q))).filter(r=>{
      if(state.filter==='active')return r.observation.kind==='equity-pledge'&&r.state!=='released';
      if(state.filter==='near')return ['near-trigger','modeled-breach'].includes(r.state);
      if(state.filter==='topups')return r.velocity?.collateralTopUp;
      if(state.filter==='liquidity')return r.liquidityWarning;
      if(state.filter==='terms')return ['needs-terms','scenario-only'].includes(r.state);
      return true;
    }).sort((a,b)=>{
      const read=r=>state.sort==='company'?[r.symbol,r.borrower].filter(Boolean).join(' '):state.sort==='date'?r.observation.filingDate:state.sort==='volume'?r.pledgedToAdvPct:state.sort==='velocity'?r.velocity?.leverageVelocityPct30d:state.sort==='principal'?r.principalBorrowed:state.sort==='shares'?r.sharesPledged:state.sort==='trigger'?r.triggerPrice:state.sort==='price'?r.market?.price:r.distancePct;
      const av=read(a),bv=read(b);if(av==null||bv==null)return av==null&&bv==null?0:av==null?1:-1;
      const compare=typeof av==='string'?av.localeCompare(bv):av-bv;
      return direction()==='asc'?compare:-compare;
    });
  }
  function direction(){return state.direction||(['distance','company'].includes(state.sort)?'asc':'desc');}
  function sortHeader(key,text){const sorted=state.sort===key;return '<th aria-sort="'+(sorted?(direction()==='asc'?'ascending':'descending'):'none')+'"><button type="button" data-fl-sort-key="'+key+'">'+text+(sorted?'<span aria-hidden="true"> '+(direction()==='asc'?'↑':'↓')+'</span>':'')+'</button></th>';}
  function triggerCell(r){return r.triggerPrice!=null?money(r.triggerPrice)+'<small>Disclosed maintenance '+pct(r.maintenanceLtv*100)+'</small>':r.scenarios?.length?'<span>Scenario '+money(Math.min(...r.scenarios.map(s=>s.price)))+'–'+money(Math.max(...r.scenarios.map(s=>s.price)))+'</span><small>35–65% assumed LTV</small>':'<span>Unknown</span><small>'+esc(r.observation.collateralBasis==='mixed'?'Mixed collateral':'Loan terms incomplete')+'</small>';}
  function watch(){
    const rows=visibleRows();
    const head=[['company','Company / borrower'],['principal','Principal borrowed'],['shares','Shares pledged'],['trigger','Estimated trigger'],['price','Stock price'],['distance','Distance to trigger'],['volume','Pressure signals']].map(([key,title])=>sortHeader(key,title)).join('');
    return toolbar()+'<p class="fl-caption">Signed distance = (stock price − trigger) ÷ stock price. Negative means the quote is below a modeled threshold. It does not confirm a margin call.</p>'+(rows.length?'<div class="fl-scroll" tabindex="0" role="region" aria-label="Pledged-stock watchlist"><table class="fl-table" data-nosort><thead><tr>'+head+'</tr></thead><tbody>'+rows.map(watchRow).join('')+'</tbody></table></div>':warning(data.rows.length?'No disclosures match these filters.':'No pledged-stock disclosures are available in this snapshot. Review scan coverage below; this is not evidence that the market has no pledged stock.'));
  }
  function watchRow(r){return '<tr><td><button type="button" class="fl-open" data-fl-open="'+esc(r.id)+'">'+esc(r.symbol||'Issuer unresolved')+'</button><small>'+esc(r.company||'Issuer needs review')+'</small><small>'+esc(r.borrower||'Borrower undisclosed')+'</small><small>Facts '+esc(r.observation.asOfDate||'undated')+' · filed '+esc(r.observation.filingDate)+'</small><span class="fl-status fl-'+esc(r.state)+'">'+esc(label(r.state))+'</span></td><td>'+money(r.principalBorrowed)+'<small>'+(r.observation.principalBasis==='capacity'?'Credit limit only; drawn amount unknown':'USD · outstanding balance')+'</small></td><td>'+n(r.sharesPledged,0)+'<small>'+pct(r.pledgedToFloatPct)+' of float</small></td><td>'+triggerCell(r)+'</td><td>'+money(r.market?.price)+'<small>'+(r.priceFresh?'Quoted ':'Stale / undated · ')+date(r.market?.quoteAsOf)+'</small></td><td><b class="'+(r.distancePct!=null&&r.distancePct<=15?'fl-negative':'')+'">'+pct(r.distancePct)+'</b><small>'+esc(basis(r))+'</small></td><td>'+signals(r).map(s=>'<span class="fl-signal">'+esc(s)+'</span>').join('')+'<small>'+pct(r.pledgedToAdvPct)+' of 20-session ADV</small><small>Leverage / 30 days '+pct(r.velocity?.leverageVelocityPct30d)+'</small></td></tr>';}
  function scenario(r){
    if(!r.scenarios?.length)return warning('A single-stock scenario needs an attributable equity pledge, an outstanding USD balance, and a current pledged share count. Mixed collateral cannot be modeled here.');
    const s=r.scenarios.find(s=>s.ltv===Number(state.ltv))||r.scenarios[0],ltv=s.ltv;
    return '<section class="fl-scenario"><h4>LTV sensitivity</h4><p>Assumes this stock is the only eligible collateral. These scenarios do not replace disclosed contract terms or change Top Picks decisions.</p><label>Assumed maximum maintenance LTV<select data-fl-ltv>'+[0.35,0.5,0.65].map(v=>'<option value="'+v+'"'+(ltv===v?' selected':'')+'>'+pct(v*100)+'</option>').join('')+'</select></label><div class="fl-metrics">'+metric('Scenario trigger',money(s.price),'Loan ÷ shares ÷ assumed LTV')+metric('Scenario distance',pct(s.distancePct),'Uses the dated quote above')+'</div></section>';
  }
  function historyPrincipal(h){
    if(h.parserVersion!==config.evidenceVersion)return 'Needs extraction refresh';
    if(h.currency==='USD')return money(h.principalBorrowed);
    return h.principalBorrowed==null?'Undisclosed':n(h.principalBorrowed,0)+' · currency unverified';
  }
  function historyValue(h,key,decimals){return h.parserVersion===config.evidenceVersion?n(h[key],decimals):'Needs extraction refresh';}
  function detail(r){
    const o=r.observation;
    return '<article class="fl-detail"><div class="fl-detail-head"><div><span class="fl-kicker">'+esc(label(r.state))+'</span><h3>'+esc((r.symbol||'Unresolved issuer')+' · '+(r.borrower||'Borrower undisclosed'))+'</h3><p>'+esc(o.securityClass||'Share class unresolved')+' · '+esc(o.facilityKey||'Facility identity needs review')+'</p></div><button type="button" class="book-more" data-fl-close>Close detail</button></div><div class="fl-metrics">'+metric('Outstanding principal',money(r.principalBorrowed),o.principalBasis==='capacity'?'Facility limit is not drawn debt':'As of '+(o.asOfDate||'date undisclosed'))+metric('Shares pledged',n(r.sharesPledged,0),pct(r.pledgedToFloatPct)+' of reported float')+metric('Estimated threshold',money(r.triggerPrice),basis(r))+metric('Distance to threshold',pct(r.distancePct),'Stock quote '+(r.priceFresh?'dated and current':'stale or absent'))+'</div><div class="fl-pressure"><h4>Reflexive pressure</h4><p>'+esc(signals(r).join(' · ')||'No pressure pattern established from available observations.')+'</p><dl><dt>Pledged shares / daily volume</dt><dd>'+pct(r.pledgedToAdvPct)+' · '+n(r.liquidationDaysAt100PctAdv,2)+' average-volume days</dd><dt>Average daily volume</dt><dd>'+n(r.market?.averageDailyVolume,0)+' shares · 20 completed sessions through '+esc(r.market?.volumeAsOf||'unavailable')+'</dd><dt>Leverage per pledged share</dt><dd>'+pct(r.velocity?.leverageVelocityPct30d)+' per 30 days</dd><dt>Buffer change</dt><dd>'+n(r.distanceVelocityPpPerDay,2)+' percentage points / day</dd></dl><p class="fl-caption">20% of daily volume is a screening rule. It does not measure executable liquidity, sales participation, a gap probability, or days-to-cover for short sellers. Float is a separate denominator.</p>'+(r.velocity?'<p>'+esc('Between '+r.velocity.previousDate+' and '+r.velocity.latestDate+', shares changed '+pct(r.velocity.sharesChangePct)+' and outstanding debt changed '+pct(r.velocity.debtChangePct)+'. '+r.velocity.interpretation)+'</p>':'')+'</div>'+r.warnings.map(warning).join('')+(r.missing.length?warning('Still needed: '+r.missing.join('; ')+'.'):'')+scenario(r)+'<h4>Filing evidence</h4><p>'+link(o)+' · filed '+esc(o.filingDate)+' · facts as of '+esc(o.asOfDate||'not separately dated')+'</p><blockquote class="fl-excerpt">'+esc(o.excerpt)+'</blockquote><p class="fl-caption">'+esc(o.extractionStatus)+' · '+esc(o.collateralBasis)+' · '+esc(o.currency)+'. An excerpt can omit context; inspect the original filing and linked agreements.</p><h4>Disclosure history</h4><div class="fl-scroll"><table class="fl-table fl-history"><thead><tr><th>Filed / facts as of</th><th>Principal</th><th>Pledged shares</th><th>Maintenance LTV</th><th>Source</th></tr></thead><tbody>'+r.history.map(h=>'<tr><td>'+esc(h.filingDate)+'<small>'+esc(h.asOfDate||'Fact date undisclosed')+'</small></td><td>'+historyPrincipal(h)+'</td><td>'+historyValue(h,'sharesPledged',0)+'</td><td>'+(h.parserVersion===config.evidenceVersion?pct(h.maintenanceLtv==null?null:h.maintenanceLtv*100):'Needs extraction refresh')+'</td><td>'+link(h)+'</td></tr>').join('')+'</tbody></table></div></article>';
  }
  function evidence(){return '<p class="fl-caption">Raw excerpts include incomplete pledges and corporate debt context. Corporate borrowing alone does not establish a forced-sale threshold in the listed stock.</p>'+data.rows.map(r=>'<article class="fl-evidence"><div><span class="fl-status fl-'+esc(r.state)+'">'+esc(label(r.state))+'</span> <button type="button" class="fl-open" data-fl-open="'+esc(r.id)+'">'+esc(r.symbol||'Issuer unresolved')+'</button> · '+esc(r.observation.form)+' · '+esc(r.observation.filingDate)+'</div><p>'+esc(r.borrower||r.company||'Entity unresolved')+'</p><blockquote class="fl-excerpt">'+esc(r.observation.excerpt)+'</blockquote>'+link(r.observation)+'</article>').join('');}
  function method(){const c=data.coverage||{},sourceErrors=[...(c.errors||[]),...(c.marketData?.errors||[])];return '<div class="fl-method"><h3>What the estimate means</h3><p class="fl-formula">Trigger price = outstanding loan ÷ (pledged shares × maintenance LTV)</p><p>LTV means debt divided by eligible collateral value. A $100 million loan against 10 million shares at a 50% maximum maintenance LTV reaches that ratio at $20 a share. A 25% equity maintenance requirement is a 75% maximum LTV.</p><p>Principal, collateral stock, share class and loan facility must refer to the same borrowing. A facility limit, total corporate debt, sale proceeds, transaction price or the value of another pledged asset cannot substitute for outstanding principal.</p><h4>Signals to monitor</h4><ul><li>Distance to trigger: a signed percentage of the current dated stock quote. An estimated threshold crossing is not proof that a lender has called the loan.</li><li>Leverage velocity: change in debt per pledged share, normalized to 30 days between comparable dated disclosures. Added shares with unchanged outstanding principal is a possible collateral top-up, not new-share issuance or proof of a bank demand.</li><li>Liquidity pressure: pledged shares above 20% of 20-session average daily volume is flagged separately from pledged shares / float. Sales can be spread over time or cured with cash and other collateral.</li><li>Reflexivity watch: a shrinking buffer faster than one percentage point per day, liquidity pressure, and a collateral top-up or rising leverage. It needs repeated market snapshots with unchanged loan terms.</li></ul><h4>Top Picks use</h4><p>Fresh, attributable, disclosed single-stock loan terms within 90 days can block a new bullish Top Pick within 15% of its estimated trigger. The existing grader receives the evidence for both directions. Incomplete terms and illustrative LTV scenarios cannot block an entry or add conviction points. A bearish idea still needs the usual thesis, trend, option and entry checks.</p><h4>Coverage & freshness</h4><p>'+esc(c.scope||'Scan coverage unavailable.')+'</p><p>Forms: '+esc((c.forms||[]).join(', '))+'. '+n(c.issuersCheckedThisRun,0)+' tracked issuers checked this run from '+n(c.universeSize,0)+'. A scan is reused for 18 hours only when the parser is current and no discovered documents remain unread. Prices older than 96 hours cannot establish distance. Disclosures older than 400 days remain visible as stale research.</p>'+(sourceErrors.length?'<ul>'+sourceErrors.map(e=>'<li>'+esc([e.stage,e.symbol,e.field,e.message].filter(Boolean).join(' · '))+'</li>').join(''):'')+'<p>Parent-company debt can use subsidiary shares or a mixed pool of assets. Cure periods, accrued interest, lender haircuts, refinancing, share splits, undisclosed amendments and lender discretion can change the actual outcome.</p><p><a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noopener">SEC data sources</a> · <a href="https://www.finra.org/investors/insights/securities-backed-lines-credit" target="_blank" rel="noopener">FINRA explanation of collateral maintenance calls</a></p></div>';}
  function render(){
    const el=root();if(!el||!data||!config.owner())return;
    data=expireSnapshot(data);
    const selected=data.rows.find(r=>r.id===state.selected),s=data.summary;
    el.innerHTML=coverage()+'<div class="fl-metrics">'+metric('Pledge disclosures',n(s.tracked,0),'Latest per identified facility; unmatched leads may overlap')+metric('Near estimated trigger',data.coverage.scanHealthy&&s.assessable?n(s.nearTrigger,0):'Unassessed',n(s.assessable,0)+' of '+n(s.tracked,0)+' pledges have a dated estimate · within 15%')+metric('Possible top-ups',s.comparable?n(s.topUps,0):'Unassessed',n(s.comparable,0)+' of '+n(s.tracked,0)+' pledges have comparable loan histories')+metric('Incomplete terms',n(s.needsTerms,0),'Visible for research; no inferred loan balance')+'</div><div class="fl-tabs" role="tablist" aria-label="Liquidation tracker views">'+[['watch','Watchlist'],['evidence','Filing evidence'],['method','Method & coverage']].map(([v,t])=>'<button type="button" role="tab" aria-selected="'+(state.view===v)+'" data-fl-view="'+v+'">'+t+'</button>').join('')+'</div>'+(selected?detail(selected):state.view==='evidence'?evidence():state.view==='method'?method():watch());
    scheduleExpiry();
  }
  async function load(force=false){
    const el=root();if(!el||!config.owner()||loading)return;
    if(data&&!force)return render(); loading=true;
    el.innerHTML='<p class="fl-empty" role="status">Loading SEC collateral disclosures…</p>';
    try{const response=await win.fetch('/api/auth/me?data=forced-liquidation.json',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error(response.status===404?'The tracker has not been collected yet. The next full build will scan SEC filings.':response.status===401||response.status===403?'An Owner session is required.':'The SEC collateral snapshot is unavailable.');const body=await response.json();if(body.version!==1||!Array.isArray(body.rows)||!body.summary||!body.coverage||body.rows.some(r=>!r?.observation||!Array.isArray(r.history)||!Array.isArray(r.missing)||!Array.isArray(r.warnings)))throw new Error('The collateral snapshot is incomplete. Reload after the next successful build.');if(!config.owner())return; data=expireSnapshot(body);render();}
    catch(e){data=null;el.innerHTML=warning(e.message)+'<button type="button" class="book-more" data-fl-retry>Retry</button>';}
    finally{loading=false;}
  }
  function exportCsv(){
    data=expireSnapshot(data);
    const rows=visibleRows(), cols=['ticker','company','borrower','outstanding_principal_usd','shares_pledged','maintenance_ltv','estimated_trigger_usd','stock_price_usd','quote_as_of','distance_to_trigger_pct','estimate_basis','pledged_to_adv_pct','pledged_to_float_pct','leverage_velocity_pct_30d','possible_collateral_top_up','filing_date','facts_as_of','sec_url','disclosure_state','quote_fresh','disclosure_current','sec_scan_status','engine_eligible','extraction_version','missing_terms'];
    const cell=v=>'"'+(typeof v==='number'?String(v):String(v??'').replace(/^\s*[=+\-@\t\r]/,"'$&")).replace(/"/g,'""')+'"';
    const csv=[cols,...rows.map(r=>[r.symbol,r.company,r.borrower,r.principalBorrowed,r.sharesPledged,r.maintenanceLtv,r.triggerPrice,r.market?.price,r.market?.quoteAsOf,r.distancePct,r.estimateBasis,r.pledgedToAdvPct,r.pledgedToFloatPct,r.velocity?.leverageVelocityPct30d,r.velocity?.collateralTopUp??null,r.observation.filingDate,r.observation.asOfDate,r.observation.url,r.state,r.priceFresh,r.current,data.coverage.status,r.engineEligible,r.observation.parserVersion,r.missing.join('; ')])].map(r=>r.map(cell).join(',')).join('\r\n');
    const url=win.URL.createObjectURL(new win.Blob([csv],{type:'text/csv;charset=utf-8'})),a=doc.createElement('a');a.href=url;a.download='forced-liquidation-'+data.builtAtIso.slice(0,10)+'.csv';a.click();win.URL.revokeObjectURL(url);
  }
  doc.addEventListener('click',e=>{
    const el=e.target.closest('[data-fl-view],[data-fl-open],[data-fl-close],[data-fl-retry],[data-fl-export],[data-fl-sort-key]');if(!el||!config.owner())return;
    if(el.hasAttribute('data-fl-retry'))return load(true);if(!data)return;if(el.hasAttribute('data-fl-export'))return exportCsv();
    if(el.dataset.flView){state.view=el.dataset.flView;state.selected=null;}
    if(el.dataset.flOpen)state.selected=el.dataset.flOpen;
    if(el.dataset.flSortKey){const key=el.dataset.flSortKey,old=direction();state.direction=state.sort===key?(old==='asc'?'desc':'asc'):['company','distance'].includes(key)?'asc':'desc';state.sort=key;}
    const closing=el.hasAttribute('data-fl-close')?state.selected:null;if(closing)state.selected=null;
    save();render();
    if(el.dataset.flSortKey)root().querySelector('[data-fl-sort-key="'+el.dataset.flSortKey+'"]').focus({preventScroll:true});
    if(el.dataset.flOpen){const title=root().querySelector('.fl-detail h3');if(title){title.tabIndex=-1;title.focus();}}
    if(closing)Array.from(root().querySelectorAll('[data-fl-open]')).find(b=>b.dataset.flOpen===closing)?.focus();
  });
  doc.addEventListener('change',e=>{const el=e.target;if(!el.closest('#forced-liquidation-root')||!data)return;if(el.hasAttribute('data-fl-filter'))state.filter=el.value;else if(el.hasAttribute('data-fl-sort')){state.sort=el.value;state.direction=null;}else if(el.hasAttribute('data-fl-ltv'))state.ltv=Number(el.value);else return;save();render();});
  doc.addEventListener('input',e=>{if(!e.target.hasAttribute('data-fl-search')||!data)return;const caret=e.target.selectionStart;state.query=e.target.value;save();render();const input=root().querySelector('[data-fl-search]');input?.focus();if(caret!=null)input?.setSelectionRange(caret,caret);});
  doc.addEventListener('keydown',e=>{if(!e.target.matches('[data-fl-view]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=Array.from(root().querySelectorAll('[data-fl-view]')),i=buttons.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;e.preventDefault();const view=buttons[next].dataset.flView;buttons[next].click();root().querySelector('[data-fl-view="'+view+'"]').focus();});
  return {load};
}

// Serialized into app.js; all private reads go through the authenticated route.
export function ownerMarketBriefClient(window, document, ctx, displayFactory) {
  var display = displayFactory();
  var state = { data:null, loading:false, error:'', request:0, fetchedAt:0, expiryKey:null };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function time(v) { if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v))return new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'})+' · daily observation'; var d=new Date(v);return v && isFinite(d.getTime()) ? d.toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET' : 'Source time unavailable'; }
  function money(v,currency) { if(typeof v!=='number'||!isFinite(v))return 'Unavailable';return (currency || 'Currency unavailable')+' '+v.toLocaleString('en-US',v!==0&&Math.abs(v)<0.01?{maximumSignificantDigits:4}:{maximumFractionDigits:2}); }
  function bullets(v,empty) { return list(v).length ? '<ul>'+v.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>' : '<p class="omb-muted">'+esc(empty||'None recorded.')+'</p>'; }
  function link(tab,label,symbol) { return '<button type="button" class="omb-link" data-omb-go="'+esc(tab)+'"'+(symbol?' data-omb-symbol="'+esc(symbol)+'"':'')+'>'+esc(label)+' <span aria-hidden="true">↗</span></button>'; }
  function reset() { state.request++;state.data=null;state.loading=false;state.fetchedAt=0;state.error='';var el=document.getElementById('owner-market-brief-root');if(el)el.innerHTML=''; }
  function render() {
    var root=document.getElementById('owner-market-brief-root');
    if(!root)return;
    if(!ctx.owner()){root.innerHTML='';return;}
    var d=state.data;
    if(!d){root.innerHTML='<div class="omb-empty" role="status"><h3>'+esc(state.loading?'Gathering the Owner read…':state.error||'The first Owner brief is pending')+'</h3><p>The brief is assembled after the site’s research desks finish a full build.</p><button type="button" class="omb-link" data-omb-refresh>Try again</button></div>';bind(root);return;}
    var stale=display.expired(d);
    var ownerCoverage=d.coverage.filter(function(s){return s.audience==='owner';});
    var usable=ownerCoverage.filter(function(s){return display.coverageStatus(s)==='available';}).length;
    var html='<header class="omb-lead"><div class="omb-eyebrow">Owner research · '+esc(d.date)+'</div><h3>'+esc(stale?'Owner brief needs a fresh build':d.headline)+'</h3><p>'+esc(stale?'This saved snapshot is available for coverage review only. Open the current source desks for fresh research.':d.summary)+'</p><div class="omb-meta"><span>Assembled '+esc(time(d.builtAtIso))+'</span><span>'+usable+'/'+ownerCoverage.length+' Owner desks</span><span>Conditional outlook</span><button type="button" class="omb-link" data-omb-refresh'+(state.loading?' disabled':'')+'>'+ (state.loading?'Refreshing…':'Refresh')+'</button></div></header>';
    if(stale)html+='<p class="omb-warning" role="status">This brief is out of date. Its outlook, shortlist and market guidance are withheld. Refresh after the next completed site build.</p>';
    if(state.error)html+='<p class="omb-warning" role="status">'+esc(state.error)+' Showing the last loaded snapshot.</p>';
    html+='<nav class="omb-jumps" aria-label="Owner brief sections">'+[['outlook','Possible paths'],['ideas','Research shortlist'],['evidence','Across the site'],['coverage','Sources & coverage']].map(function(x){return '<a href="#omb-'+x[0]+'">'+x[1]+'</a>';}).join('')+'</nav>';
    if(!stale&&list(d.priorities).length)html+='<section class="omb-section omb-priorities"><h3>Focus for this update</h3><div class="omb-findings">'+d.priorities.map(function(f){return '<article><div>'+link(f.tab,f.source)+'</div><div><h4>'+esc(f.title)+'</h4><p>'+esc(f.detail)+'</p></div></article>';}).join('')+'</div></section>';
    var p=d.publicRead, core=d.publicCore||{};
    html+='<section class="omb-section"><div class="omb-section-head"><h3>The Market Brief foundation</h3>'+link('brief','Public Market brief')+'</div>';
    if(stale) html+='<p class="omb-muted">The saved market narrative and playbook have expired. Open the Market Brief for its latest published read.</p>';
    else if(p) html+=ctx.publicCard(p);
    else html+='<p class="omb-muted">No public narrative within its freshness window. Current public evidence appears below.</p>'+ctx.publicCard(Object.assign({kind:'intraday',date:d.date,generatedAtIso:d.builtAtIso,headline:'Snapshot public market evidence'},core));
    html+='</section>';
    html+='<section class="omb-section" id="omb-outlook"><div class="omb-section-head"><h3>Possible paths from here</h3>'+link('market','Full scenario desk')+'</div><p class="omb-muted">Conditions and consequences from the existing scenario desk. These paths have no calibrated odds. An alternative path weakens the first; neither is a promise.</p>';
    if(!stale&&d.scenarios.length)html+='<div class="omb-grid">'+d.scenarios.map(function(s){return '<article class="omb-panel"><span class="omb-eyebrow">'+esc(s.horizon)+'</span><h4>'+esc(s.name)+'</h4><p>'+esc(s.driver)+'</p>'+list(s.paths).map(function(path){return '<div class="omb-path"><b>'+esc(path.label)+'</b><p><span class="omb-label">What would confirm it</span>'+esc(path.condition)+'</p><p><span class="omb-label">Possible outcome</span>'+esc(path.outcome)+'</p></div>';}).join('')+'<small class="omb-muted">Source '+esc(time(s.asOf))+'</small></article>';}).join('')+'</div>';
    else html+='<p class="omb-muted">No fresh market paths available. Missing evidence does not imply a neutral outlook.</p>';
    if(!stale&&list(d.catalysts).length)html+='<h4>Next catalysts to watch</h4><ul>'+d.catalysts.map(function(c){return '<li>'+esc(c.date)+' · '+esc(c.title)+'</li>';}).join('')+'</ul>';
    html+='</section><section class="omb-section" id="omb-ideas"><div class="omb-section-head"><h3>Research shortlist</h3>'+link('unified-signal-engine','All decisions')+'</div><p class="omb-muted">Source order is preserved. Shared evidence is not counted again. Technical objectives are conditional references, not predicted returns.</p>';
    html+=!stale&&d.ideas.length?'<div class="omb-grid">'+d.ideas.map(function(i){var current=display.ideaCurrent(i);return '<article class="omb-panel omb-idea"><header><h4>'+esc(i.symbol)+'</h4><span class="omb-badge">'+esc(i.status==='eligible'?(current?'Qualified at source build':'Reference only · approval expired'):i.status)+'</span></header><p class="omb-muted">'+esc(i.direction)+' · '+esc(i.horizon)+' · '+esc(time(i.asOf))+'</p><p>'+esc(i.summary)+'</p>'+(i.thesis?'<p>'+esc(i.thesis)+'</p>':'')+'<h5>Suggested next step</h5><p>'+esc(current||i.status==='avoid'?i.suggestion:'Reference research only. Recheck the current decision and quote before considering an entry.')+'</p><h5>What supports it</h5>'+bullets(i.support,'Supporting evidence is limited.')+'<h5>What challenges it</h5>'+bullets(i.challenges,'No opposing contribution recorded; uncertainty remains.')+'<h5>Confirmation & blockers</h5>'+bullets(i.blocks,'Review the original entry checks and account risk.')+'<dl class="omb-levels"><div><dt>Source trigger</dt><dd>'+esc(money(i.trigger,i.currency))+'</dd></div><div><dt>Technical objective</dt><dd>'+esc(money(i.target,i.currency))+'</dd></div><div><dt>Invalidation</dt><dd>'+esc(money(i.invalidation,i.currency))+'</dd></div></dl>'+bullets(i.invalidators,'No additional invalidators recorded.')+(i.investment||i.trading?'<p class="omb-muted">Investment: '+esc(i.investment||'unavailable')+' · Trading: '+esc(i.trading||'unavailable')+'</p>':'')+(list(i.changes).length?'<h5>Changed at the source</h5>'+bullets(i.changes):'')+'<p class="omb-muted">'+esc(i.next)+'</p>'+link('unified-signal-engine','Review '+i.symbol,i.symbol)+'</article>';}).join('')+'</div>':'<p class="omb-muted">No current shortlist available.</p>';
    html+='</section>';
    if(!stale&&d.forecasts.length)html+='<section class="omb-section"><div class="omb-section-head"><h3>Earnings expectations to test</h3>'+link('earnings-forecast','Forecast assumptions')+'</div><p class="omb-muted">Frozen model estimates. These are neither analyst consensus nor calibrated prediction intervals. Revenue and EPS retain each company’s currency and fiscal period.</p><div class="omb-grid">'+d.forecasts.map(function(f){return '<article class="omb-panel"><h4>'+esc(f.symbol)+' · '+esc(f.status)+'</h4><p>Fiscal quarter ending '+esc(f.period||'unavailable')+'</p><dl class="omb-levels"><div><dt>Revenue estimate</dt><dd>'+esc(money(f.revenue,f.currency))+'</dd></div><div><dt>EPS estimate</dt><dd>'+esc(money(f.eps,f.currency))+'</dd></div></dl><p class="omb-muted">Forecast cutoff '+esc(time(f.cutoffAt))+'</p>'+bullets(f.warnings,'No additional source warnings.')+'</article>';}).join('')+'</div></section>';
    html+='<section class="omb-section" id="omb-evidence"><h3>Across the site</h3><p class="omb-muted">Owner interpretation followed by the public tool scan. Source links open the complete research.</p><div class="omb-findings">'+(stale?[]:d.findings).map(function(f){return '<article><div>'+link(f.tab,f.source)+'<small>'+esc(time(f.asOf))+'</small></div><div><h4>'+esc(f.title)+'</h4><p>'+esc(f.detail)+'</p></div></article>';}).join('')+'</div><details class="omb-details"><summary>Public research scan · '+(stale?0:list(d.publicFacts).length)+' findings</summary><div class="omb-findings">'+(stale?[]:list(d.publicFacts)).map(function(f){return '<article><div>'+link(f.tab,f.source)+'</div><p>'+esc(f.detail)+'</p></article>';}).join('')+'</div></details></section>';
    if(!stale&&list(d.changes).length)html+='<section class="omb-section"><h3>Changed since the previous Owner brief</h3>'+bullets(d.changes.map(function(c){return c.title+': '+c.detail;}))+'</section>';
    html+='<section class="omb-section" id="omb-coverage"><h3>Sources & coverage</h3><p class="omb-muted">Available means the snapshot passed its age check. It does not establish complete underlying coverage or independent evidence. Missing, stale, future-dated and undated sources supply no Owner findings.</p><div class="omb-coverage">'+d.coverage.map(function(s){return '<div><span>'+(s.id?link(s.tab||s.id,s.label):esc(s.label))+'</span><span class="omb-badge">'+esc(display.coverageStatus(s))+'</span><small>'+esc(s.audience)+' · '+esc(s.asOf?time(s.asOf):s.audience==='public'?'See public source for observation dates':'No verified source time')+'</small></div>';}).join('')+'</div><h4>How to use this read</h4>'+bullets(d.limits)+'<p class="omb-muted">'+esc(d.methodology)+'</p></section>';
    state.expiryKey=display.expiryKey(d);root.innerHTML=html;bind(root);ctx.bindPublic(root);
  }
  function bind(root) {
    root.querySelectorAll('[data-omb-go]').forEach(function(el){el.addEventListener('click',function(){ctx.go(el.getAttribute('data-omb-go'),el.getAttribute('data-omb-symbol'));});});
    root.querySelectorAll('[data-omb-refresh]').forEach(function(el){el.addEventListener('click',function(){load(true);});});
    root.querySelectorAll('.omb-jumps a').forEach(function(el){el.addEventListener('click',function(e){e.preventDefault();var target=document.getElementById(el.getAttribute('href').slice(1));if(target){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}});});
  }
  async function load(force) {
    if(!ctx.owner()){reset();return;}
    if(state.loading)return;
    if(!force&&state.data&&Date.now()-state.fetchedAt<60000){render();return;}
    var request=++state.request;state.loading=true;state.error='';render();
    var controller=new AbortController(),timer=window.setTimeout(function(){controller.abort();},15000);
    try {
      var response=await window.fetch('/api/auth/me?data=owner-market-brief.json',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(response.status===401||response.status===403){reset();ctx.revoke();return;}
      if(!response.ok)throw new Error(response.status===404?'The first Owner brief is pending.':'Could not refresh the Owner brief.');
      var d=await response.json();if(!display.valid(d))throw new Error('The Owner brief could not be read.');
      if(request!==state.request||!ctx.owner())return;
      state.data=d;state.fetchedAt=Date.now();
    } catch(error) {if(request===state.request)state.error=error.name==='AbortError'?'The refresh timed out. Try again.':error.message;}
    finally {window.clearTimeout(timer);if(request===state.request){state.loading=false;render();}}
  }
  window.setInterval(function(){if(state.data&&ctx.owner()&&document.getElementById('page-pane-owner-market-brief')?.hidden===false&&state.expiryKey!==display.expiryKey(state.data))render();},60000);
  return {load:load,reset:reset,render:render};
}

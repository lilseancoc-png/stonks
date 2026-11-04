// Serialized into the existing browser bundle. Diagnostics stay Owner-only.
export function updateCheckerClient(window, document, ctx) {
  var data=null, error='', loading=false, generation=0, controller=null, summaryController=null, summaryBusy=false, summarySerial=0;
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function time(v){var n=Date.parse(v);return isFinite(n)?new Date(n).toLocaleString():'Not recorded';}
  function link(run){return run && /^https:\/\/github\.com\/lilseancoc-png\/stonks\/actions\/runs\/\d+$/.test(run.url)?'<a href="'+esc(run.url)+'" target="_blank" rel="noopener noreferrer">Open run and logs ↗</a>':'';}
  function issue(row){return ['available','reference','on-demand','monitor'].indexOf(row.status)<0;}
  function badge(status){return '<span class="uc-status" data-status="'+esc(status)+'">'+esc(status)+'</span>';}
  function notice(monitor,issues){
    var el=document.getElementById('update-checker-notice');
    if(!ctx.owner()){if(el)el.remove();return;}
    if(!el){el=document.createElement('a');el.id='update-checker-notice';el.className='uc-notice';el.href='/?tab=update-checker';var host=document.querySelector('#side-nav .nav-tools');var pin=document.getElementById('workspace-pin');if(host&&pin&&pin.parentNode===host)host.insertBefore(el,pin.nextSibling);else if(host)host.appendChild(el);else document.body.appendChild(el);}
    el.hidden=monitor.status==='available' && issues===0;el.setAttribute('data-status',issues>0 && monitor.status==='available'?'review':String(monitor.status||'unknown'));
    el.textContent=issues>0 && monitor.status==='available'?'Update Checker: '+issues+' checks need review':monitor.status==='failed'?'Update Checker: a workflow failed':monitor.status==='stuck'?'Update Checker: a workflow is stuck':monitor.status==='degraded'?'Update Checker: degraded output or log errors':monitor.status==='deployment'?'Update Checker: code deployment needs review':monitor.status==='overdue'?'Update Checker: full data build overdue':monitor.status==='stale'?'Update Checker: monitor out of date':'Update Checker: status unavailable';
    el.title=el.textContent;
  }
  function reset(){generation++;summarySerial++;if(controller)controller.abort();if(summaryController)summaryController.abort();summaryBusy=false;data=null;error='';loading=false;var el=document.getElementById('update-checker-root');if(el)el.innerHTML='';el=document.getElementById('update-checker-notice');if(el)el.remove();}
  function runCard(run){
    if(!run)return '<p class="uc-muted">No recorded run.</p>';
    var html='<p>'+badge(run.conclusion)+' '+esc(run.scope)+' · '+esc(time(run.createdAt))+'</p>';
    if(run.fullBuild && ['skipped','not_reached'].includes(run.siteBuild))html+='<p>This attempt stopped before site generation. Published features may still show the previous build.</p>';
    if(run.fullBuild)html+='<p>Site generation: '+esc(run.siteBuild)+' · Data publication: '+esc(run.publication)+'</p>';
    (run.failures||[]).forEach(function(f){html+='<p class="uc-failure">'+esc(f.job)+': '+esc(f.steps.length?f.steps.join(', '):'Job failed without a step result')+'</p>';});
    if(run.diagnostics){run.diagnostics.findings.forEach(function(f){html+='<p class="uc-failure">'+esc(f.detail)+' ('+f.count+')</p>';});if(run.diagnostics.unavailableJobs)html+='<p class="uc-muted">'+run.diagnostics.unavailableJobs+' job logs unavailable. Coverage is incomplete.</p>';}
    if(run.status && run.status!=='completed')html+='<p>'+esc(run.status)+' since '+esc(time(run.startedAt))+'</p>';
    return html+link(run);
  }
  function render(){
    var root=document.getElementById('update-checker-root');if(!root || !ctx.owner())return;
    var html='<div class="uc-toolbar"><button type="button" class="book-more" data-uc-refresh'+(loading?' disabled':'')+'>'+(loading?'Checking…':'Refresh status')+'</button><span class="uc-muted">'+(data?'Observed '+esc(time(data.observedAt)):'')+'</span></div>';
    if(error)html+='<p class="uc-warning" role="status">'+esc(error)+(data?' The snapshot below was not refreshed.':'')+'</p>';
    if(!data){root.innerHTML=html+'<p>'+(loading?'Reading build history and published outputs…':'No status loaded.')+'</p>';bind(root);return;}
    var m=data.monitor;
    html+='<div class="uc-lead"><h3>'+esc(data.status==='available'?'No issues detected':'Updates need attention')+'</h3><p>'+esc(m.detail)+'</p><p>'+data.issues+' of '+data.features.length+' site features need review.</p></div>';
    if(m.monitorStale)html+='<p class="uc-warning">Workflow history is out of date. Newer failures may be missing.</p>';
    html+='<p class="uc-muted">Independent scan '+esc(time(m.checkedAt))+'. Times use your local timezone.</p>';
    html+='<div class="uc-builds"><section><h3>Latest full data build</h3>'+runCard(m.fullBuild)+'</section><section><h3>Last successful full data build</h3>'+runCard(m.lastSuccessfulFullBuild)+'</section></div>';
    if(m.stuck && m.stuck.length)html+='<section class="uc-warning"><h3>Stuck workflows</h3>'+m.stuck.map(runCard).join('')+'</section>';
    if(m.expectedSlot)html+='<p class="uc-muted">Expected full-build slot: '+esc(m.expectedSlot.date)+' '+Math.floor(m.expectedSlot.minute/60)+':'+('0'+m.expectedSlot.minute%60).slice(-2)+' ET, with a 45-minute completion allowance.</p>';
    if(m.deployment)html+='<section class="uc-deployment"><h3>Code deployment</h3>'+badge(m.deployment.state)+' <span>main '+esc(m.deployment.sha.slice(0,8))+'</span></section>';
    var a=data.artifacts;html+='<details class="uc-workflows"><summary>Stored data and log integrity'+(a?' · '+a.checked+' artifacts checked':' · awaiting scan')+'</summary>';
    if(a){html+='<p>'+a.issueCount+' integrity or stored-log issues. '+(a.researchRecords || 0)+' internal research records checked. '+(a.complete?'Inventory scan completed.':'Inventory coverage is incomplete.')+'</p>';(a.issues||[]).forEach(function(row){html+='<article><h4>'+esc(row.key)+'</h4>'+badge(row.status)+'<p>'+esc(row.detail)+'</p></article>';});}html+='</details>';
    html+='<details class="uc-workflows"><summary>Monitored workflows</summary>'+(m.workflows||[]).map(function(w){return '<article><h4>'+esc(w.latest?w.latest.name:w.path)+'</h4>'+runCard(w.latest)+'</article>';}).join('')+'</details>';
    html+='<section class="uc-features"><h3>Feature coverage</h3><p class="uc-muted">Every feature has a data check or an explicit reference / request-driven designation. Valid empty results are allowed. Raw log text and private payload values are never included.</p><label>Show <select data-uc-filter><option value="issues">Needs review</option><option value="all">All features</option></select></label><div class="uc-feature-list">';
    data.features.slice().sort(function(a,b){return (!issue(a))-(!issue(b))||a.label.localeCompare(b.label);}).forEach(function(f){html+='<article class="uc-feature" data-uc-available="'+(!issue(f)?'1':'0')+'"'+(!issue(f)?' hidden':'')+'><div><h4>'+esc(f.label)+'</h4>'+badge(f.status)+'</div><p>'+esc(f.detail)+'</p><p class="uc-muted">Content time: '+esc(time(f.asOf))+(f.key?' · '+f.maxHours+'-hour window':'')+'</p></article>';});
    html+='</div><p class="uc-all-clear"'+(data.issues?' hidden':'')+'>No feature output issues found.</p></section><p class="uc-limitation">'+esc(data.limitation)+'</p>';
    root.innerHTML=html;bind(root);
  }
  function bind(root){
    var btn=root.querySelector('[data-uc-refresh]');if(btn)btn.onclick=load;
    var filter=root.querySelector('[data-uc-filter]');if(filter)filter.onchange=function(){root.querySelectorAll('[data-uc-available="1"]').forEach(function(row){row.hidden=filter.value!=='all';});root.querySelector('.uc-all-clear').hidden=filter.value==='all'||data.issues>0;};
  }
  async function request(kind,signal){
    var response=await window.fetch('/api/auth/me?checker='+kind,{credentials:'same-origin',cache:'no-store',signal:signal});
    if(response.status===401 || response.status===403){reset();ctx.revoke();return null;}
    if(!response.ok)throw new Error('Status checks are unavailable. Try again.');
    var value=await response.json();
    if(value.version!==1 || !value.monitor || kind==='status' && !Array.isArray(value.features))throw new Error('The status response could not be read. Try again.');
    return value;
  }
  async function load(){
    if(!ctx.owner() || loading)return;
    var current=++generation;loading=true;error='';render();controller=new window.AbortController();var timer=window.setTimeout(function(){if(controller)controller.abort();},20000);
    try{var value=await request('status',controller.signal);if(!value || current!==generation || !ctx.owner())return;data=value;notice(value.monitor,value.attentionCount);}
    catch(e){if(current===generation){error='Status checks are unavailable. Try again.';notice({status:'unknown'});}}
    finally{window.clearTimeout(timer);if(current===generation){loading=false;render();}}
  }
  async function checkSummary(){
    if(!ctx.owner() || document.hidden || summaryBusy)return;
    summaryBusy=true;var current=++summarySerial;summaryController=new window.AbortController();var timer=window.setTimeout(function(){if(summaryController)summaryController.abort();},15000);
    try{var value=await request('summary',summaryController.signal);if(value && current===summarySerial && ctx.owner())notice(value.monitor,value.attentionCount);}
    catch(e){if(current===summarySerial && ctx.owner())notice({status:'unknown'});}
    finally{window.clearTimeout(timer);if(current===summarySerial)summaryBusy=false;}
  }
  window.setInterval(function(){if(ctx.owner() && !document.hidden){var pane=document.getElementById('page-pane-update-checker');if(pane && !pane.hidden)load();else checkSummary();}},300000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)checkSummary();});
  return {load:load,reset:reset,checkSummary:checkSummary};
}

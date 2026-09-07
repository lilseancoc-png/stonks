import { recoveryCandidates, recoveryEvidence } from '../../lib/earnings-recovery.mjs';

export function renderRecoveryHelpers() {
  return recoveryCandidates.toString() + '\n' + recoveryEvidence.toString() + '\n' + String.raw`
  var recoveryState = { days: 30, minDrop: 5, guidance: 'stable', search: '', limit: 6, cache: {}, loading: {}, open: {} };
  function ersViewTabs(){
    return '<div class="ers-view-tabs" role="group" aria-label="Earnings workspace"><button type="button" data-ers-view="season" aria-pressed="' + (earningsState.view !== 'recovery') + '">Season overview</button><button type="button" data-ers-view="recovery" aria-pressed="' + (earningsState.view === 'recovery') + '">Post-earnings recovery</button></div>';
  }
  function bindEarningsView(root){
    root.querySelectorAll('[data-ers-view]').forEach(function(button){ button.addEventListener('click', function(){
      earningsState.view = button.getAttribute('data-ers-view');
      try { var url = new URL(location.href); if (earningsState.view === 'recovery') url.searchParams.set('view', 'recovery'); else url.searchParams.delete('view'); history.replaceState(null, '', url); } catch(_){}
      renderEarningsTracker();
      var active = root.querySelector('[data-ers-view="' + earningsState.view + '"]'); if (active) active.focus();
    }); });
  }
  function recoveryMoney(v){ return typeof v === 'number' && isFinite(v) ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : 'Unavailable'; }
  function recoveryBig(v, currency){ return typeof v === 'number' && isFinite(v) ? (currency === 'USD' ? '$' : (currency || 'Currency unverified') + ' ') + (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : (v / 1e6).toFixed(1) + 'M') : 'Unavailable'; }
  function recoveryStateLabel(v){ return v === 'supported' ? 'Evidence supports research' : v === 'waiting' ? 'Wait for stabilization' : v === 'blocked' ? 'Recovery checks failed' : 'Evidence incomplete'; }
  function recoveryDetail(row, evidence){
    var checks = evidence.checks.map(function(c){ return '<li><span class="recovery-check-state recovery-' + c.state + '">' + (c.state === 'pass' ? 'Met' : c.state === 'fail' ? 'Failed' : c.state === 'missing' ? 'Missing' : c.state === 'wait' ? 'Wait' : 'Context') + '</span><div><b>' + escapeHtml(c.label) + '</b><p>' + escapeHtml(c.detail) + '</p></div></li>'; }).join('');
    return '<div class="recovery-metrics"><div><span>Reference price</span><b>' + recoveryMoney(evidence.price) + '</b></div><div><span>Forward P/E</span><b>' + (evidence.forwardPE > 0 ? evidence.forwardPE.toFixed(1) + '×' : 'Unavailable') + '</b></div><div><span>FCF · 4 quarters</span><b>' + recoveryBig(evidence.fcf, evidence.financialCurrency) + '</b></div><div><span>FCF / market cap · USD basis</span><b>' + (evidence.fcfYield != null ? evidence.fcfYield.toFixed(1) + '%' : 'Unavailable') + '</b></div></div>' +
      '<div class="recovery-plan"><h4>Recovery checkpoints</h4><p>Reference levels from ' + escapeHtml(evidence.priceDate || 'unavailable history') + '. Check current quotes and entry conditions before acting.</p><dl><div><dt>20-session reclaim level</dt><dd>' + recoveryMoney(evidence.sma20) + '</dd></div><div><dt>Entry reference for room calculation</dt><dd>' + recoveryMoney(evidence.referenceEntry) + '</dd></div><div><dt>Post-report low · price invalidation</dt><dd>' + recoveryMoney(evidence.defense) + '</dd></div><div><dt>Pre-report close · recovery anchor</dt><dd>' + recoveryMoney(evidence.target) + '</dd></div><div><dt>Reference reward / risk</dt><dd>' + (evidence.rr != null ? evidence.rr.toFixed(2) + ':1' : 'No viable calculation') + '</dd></div></dl><p>A guidance cut, worsening operating results or a break below the post-report low requires a fresh thesis review. The pre-report close is not a price forecast.</p></div>' +
      '<ul class="recovery-checks">' + checks + '</ul><div class="recovery-links"><a href="?tab=grade&amp;s=' + encodeURIComponent(row.sym) + '">Inspect ' + escapeHtml(row.sym) + ' fundamentals &amp; report</a><a href="?tab=calls">Review earnings calls</a><a href="?tab=compare">Compare companies</a></div>';
  }
  function recoveryCard(row){
    var record = recoveryState.cache[row.sym];
    var evidence = record && !record.error ? recoveryEvidence(row, record) : null;
    var label = evidence ? recoveryStateLabel(evidence.state) : record && record.error ? 'Could not load evidence' : 'Checking business evidence…';
    var guidance = row.guidance === 'up' ? 'raised guidance' : row.guidance === 'inline' ? 'maintained guidance' : row.guidance === 'down' ? 'guidance cut' : 'guidance unknown';
    var detail = evidence ? recoveryDetail(row, evidence) : record && record.error ? '<p>Business evidence could not be loaded. Missing data is not a quality pass.</p><button type="button" data-recovery-retry="' + escapeHtml(row.sym) + '">Retry evidence</button>' : '<p role="status">Loading the company snapshot…</p>';
    var reason = evidence && evidence.checks.find(function(c){ return c.state === 'fail'; });
    if (!reason && evidence) reason = evidence.checks.find(function(c){ return c.state === 'missing' || c.state === 'wait'; });
    return '<article class="recovery-card"><header><div><a class="recovery-symbol" href="?tab=grade&amp;s=' + encodeURIComponent(row.sym) + '">' + escapeHtml(row.sym) + '</a><span>' + escapeHtml(row.name || '') + '</span></div><strong class="ers-neg">' + (row.movePct * 100).toFixed(1) + '%<small>report-day reaction</small></strong></header><p class="recovery-event">Reported ' + escapeHtml(row.date) + ' · EPS ' + escapeHtml(row.eps || 'unknown') + ' · ' + guidance + '</p><div class="recovery-status recovery-' + (evidence ? evidence.state : 'incomplete') + '">' + label + '</div>' + (reason ? '<p class="recovery-reason">' + escapeHtml(reason.detail) + '</p>' : '') + '<details data-recovery-detail="' + escapeHtml(row.sym) + '"' + (recoveryState.open[row.sym] ? ' open' : '') + '><summary>Business evidence &amp; recovery checkpoints</summary>' + detail + '</details></article>';
  }
  function renderRecoveryScreen(root, payload){
    function selectOption(value, label, selected){ return '<option value="' + value + '"' + (String(selected) === String(value) ? ' selected' : '') + '>' + label + '</option>'; }
    root.innerHTML = '<section class="recovery-screen" aria-labelledby="recovery-title"><header class="recovery-head"><span class="recovery-kicker">Recovery research</span><h3 id="recovery-title">Sold off after earnings. Is the business holding up?</h3><p>Start with a report-day selloff and maintained or raised guidance. Then check durability, valuation and price stabilization. A beat alone is not enough.</p></header><div class="recovery-filters"><label>Reports in last<select id="recovery-days">' + [14,30,60].map(function(n){ return selectOption(n, n + ' days', recoveryState.days); }).join('') + '</select></label><label>Report-day selloff<select id="recovery-drop">' + [3,5,10].map(function(n){ return selectOption(n, 'At least ' + n + '%', recoveryState.minDrop); }).join('') + '</select></label><label>Guidance<select id="recovery-guidance">' + selectOption('stable','Maintained or raised',recoveryState.guidance) + selectOption('all','All · include cuts / unknown',recoveryState.guidance) + '</select></label><label>Find company<input id="recovery-search" type="search" placeholder="Ticker or company" value="' + escapeHtml(recoveryState.search) + '"></label><button type="button" data-recovery-reset>Reset filters</button></div><p class="recovery-policy">Business checks require positive operating margin, durable cash generation, revenue stability and balance-sheet evidence. At least 15% below the 52-week high is required; exact lifetime ATH distance is unavailable. This is a research queue, not a buy list.</p><div id="recovery-results" aria-live="polite"></div></section>';
    function refresh(){ renderRecoveryResults(root, payload); }
    [['recovery-days','days'],['recovery-drop','minDrop'],['recovery-guidance','guidance']].forEach(function(pair){ root.querySelector('#' + pair[0]).addEventListener('change', function(ev){ recoveryState[pair[1]] = ev.target.value; recoveryState.limit = 6; refresh(); }); });
    root.querySelector('#recovery-search').addEventListener('input', function(ev){ recoveryState.search = ev.target.value; recoveryState.limit = 6; refresh(); });
    root.querySelector('[data-recovery-reset]').addEventListener('click', function(){ recoveryState.days = 30; recoveryState.minDrop = 5; recoveryState.guidance = 'stable'; recoveryState.search = ''; recoveryState.limit = 6; renderRecoveryScreen(root,payload); root.querySelector('#recovery-days').focus(); });
    refresh();
  }
  function renderRecoveryResults(root, payload){
    var output = root.querySelector('#recovery-results'); if (!output) return;
    var rows = recoveryCandidates(payload, recoveryState);
    var shown = rows.slice(0, recoveryState.limit);
    var updated = payload.builtAtIso ? formatDisplayInstant(payload.builtAtIso, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : 'unavailable';
    output.innerHTML = '<p class="recovery-count">' + rows.length + ' matching report' + (rows.length === 1 ? '' : 's') + ' · newest first · event snapshot ' + escapeHtml(updated) + '</p>' + (shown.length ? '<div class="recovery-cards">' + shown.map(recoveryCard).join('') + '</div>' : '<div class="recovery-empty"><h4>No reports match these filters</h4><p>There may be no suitable recovery research today. Widen the date window or inspect all guidance outcomes; quality requirements remain unchanged.</p></div>') + (rows.length > shown.length ? '<button type="button" class="recovery-more" data-recovery-more>Show 6 more · ' + (rows.length-shown.length) + ' remaining</button>' : '');
    output.querySelectorAll('[data-recovery-detail]').forEach(function(detail){ detail.addEventListener('toggle', function(){ recoveryState.open[detail.getAttribute('data-recovery-detail')] = detail.open; }); });
    output.querySelectorAll('[data-recovery-retry]').forEach(function(button){ button.addEventListener('click', function(){ var sym = button.getAttribute('data-recovery-retry'); delete recoveryState.cache[sym]; renderRecoveryResults(root,payload); }); });
    var more = output.querySelector('[data-recovery-more]'); if (more) more.addEventListener('click', function(){ recoveryState.limit += 6; renderRecoveryResults(root,payload); });
    // Fetch at most three public company snapshots at a time, only for visible
    // event candidates. Cache successes and give failures a deliberate retry.
    var active = Object.keys(recoveryState.loading).filter(function(sym){ return recoveryState.loading[sym]; }).length;
    shown.forEach(function(row){
      if (active >= 3 || recoveryState.cache[row.sym] || recoveryState.loading[row.sym]) return;
      active++; recoveryState.loading[row.sym] = true;
      fetch(dataUrl(row.sym + '.json'), { cache: 'no-cache' }).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(j){ if (!j || !j.fundamentals) throw new Error('No fundamentals'); recoveryState.cache[row.sym] = j; }).catch(function(){ recoveryState.cache[row.sym] = { error: true }; }).finally(function(){ recoveryState.loading[row.sym] = false; if (root.isConnected && earningsState.view === 'recovery') renderRecoveryResults(root,payload); });
    });
  }
`;
}

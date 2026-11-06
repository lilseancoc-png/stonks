// Earnings week ahead page (2026-11-06). Reads the public earnings-week.json;
// owners also read the Owner-only earnings-week-plan.json for the Top Picks
// event engine's plan column. The returned string is pasted inside the app.js
// IIFE (ES5, no imports).
export function renderEarningsWeekJs() {
  return `
  var earningsWeekState = { data: null, plan: null, loading: false, planLoading: false, error: false };
  function ewbPct(v, signed){
    if (v == null || !isFinite(v)) return '—';
    return (signed && v > 0 ? '+' : '') + Number(v).toFixed(1) + '%';
  }
  function ewbSession(s){
    var k = String(s || 'TBD').toUpperCase();
    return k === 'AM' || k === 'BMO' ? 'before the open' : k === 'PM' || k === 'AMC' ? 'after the close' : 'time not set';
  }
  function ewbDate(iso){
    var t = Date.parse(String(iso || '') + 'T12:00:00Z');
    if (!isFinite(t)) return escapeHtml(iso || '');
    var d = new Date(t);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()] + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function ewbMoveBar(implied, avg){
    if (!(implied > 0) && !(avg > 0)) return '';
    var top = Math.max(implied || 0, avg || 0) * 1.15 || 1;
    var w = implied > 0 ? Math.min(100, implied / top * 100) : 0;
    var mark = avg > 0 ? Math.min(100, avg / top * 100) : null;
    return '<span class="ewb-move-bar" aria-hidden="true"><i style="width:' + w.toFixed(1) + '%"></i>' + (mark != null ? '<b style="left:calc(' + mark.toFixed(1) + '% - 1px)"></b>' : '') + '</span>';
  }
  function ewbVsTag(v){
    if (v === 'rich') return '<span class="ewb-tag rich" title="Options price a bigger move than the stock usually makes">Pricey</span>';
    if (v === 'cheap') return '<span class="ewb-tag cheap" title="Options price a smaller move than the stock usually makes">Cheap</span>';
    if (v === 'in-line') return '<span class="ewb-tag" title="Options price about the stock’s usual move">About usual</span>';
    return '';
  }
  function ewbPlanHead(p){
    return p.action === 'trade-through' ? 'Trade through it' : p.action === 'wait' ? 'Wait for the print' : 'No trade';
  }
  function ewbPlanHtml(p){
    if (!p) return '';
    var bits = [];
    if (p.side) bits.push((p.side === 'call' ? 'calls' : 'puts') + (p.conviction != null ? ' · grade ' + escapeHtml(String(p.conviction)) : ''));
    if (p.openTrade) bits.push('open trade');
    return '<span class="ewb-plan ewb-plan-' + escapeHtml(p.action || 'none') + '" title="' + escapeHtml(p.reason || '') + '"><b>' + ewbPlanHead(p) + '</b>' + (bits.length ? '<small class="vt-sub">' + bits.join(' · ') + '</small>' : '') + '</span>';
  }
  function ewbSeasonHtml(s){
    if (!s || !s.reported) return '<p class="hint">No reports in this season yet.</p>';
    var parts = [];
    parts.push('<b>' + s.reported + '</b> covered report' + (s.reported === 1 ? '' : 's') + ' this season');
    if (s.beatRate != null) parts.push('<b>' + Math.round(s.beatRate * 100) + '%</b> beat on earnings per share (' + s.beats + ' of ' + s.epsKnown + ')');
    if (s.fellShare != null) parts.push('<b>' + Math.round(s.fellShare * 100) + '%</b> fell the next session');
    if (s.avgAbsMovePct != null) parts.push('average move <b>' + ewbPct(s.avgAbsMovePct) + '</b> (net ' + ewbPct(s.avgMovePct, true) + ')');
    return '<p class="ewb-season">' + parts.join(' · ') + '</p>';
  }
  function renderEarningsWeek(){
    var root = document.getElementById('ewb-root');
    if (!root) return;
    var st = earningsWeekState, d = st.data;
    if (!d){ root.innerHTML = '<p class="ewb-empty">' + (st.error ? 'The earnings week board could not load. Try again later.' : 'Loading the earnings week…') + '</p>'; return; }
    var rows = Array.isArray(d.rows) ? d.rows : [];
    var owner = HAS_OWNER_ACCESS && st.plan && st.plan.plans;
    var cols = [
      { label: 'Date', cell: function(r){ return '<b>' + ewbDate(r.date) + '</b><small class="vt-sub">' + escapeHtml(ewbSession(r.session)) + '</small>'; }, sort: function(r){ return r.date + (String(r.session).toUpperCase() === 'PM' ? 'b' : 'a'); } },
      { label: 'Stock', cls: 'ewb-stock-col', cell: function(r){ return VIEWS.expandHtml('Show past moves') + ' <a href="' + STOCK_PAGE.href(r.symbol) + '"><b>' + escapeHtml(r.symbol) + '</b></a><small class="vt-sub">' + escapeHtml(r.name || '') + '</small>' +
        (r.reported ? '<small class="vt-sub ewb-reported" title="The report is out; the move is from the close before it to the latest price">Reported' + (r.reactionPct != null ? ': <span class="' + (r.reactionPct >= 0 ? 'pos' : 'neg') + '">' + ewbPct(r.reactionPct, true) + '</span>' : '') + '</small>' : ''); }, sort: function(r){ return r.symbol; } },
      { label: 'Options expect ±', num: true, title: 'Implied move: the move, up or down, the at-the-money straddle prices for the report', cell: function(r){ return r.impliedMovePct != null ? '<span class="ewb-move">' + ewbMoveBar(r.impliedMovePct, r.avgMovePct) + ewbPct(r.impliedMovePct) + '</span>' : ''; }, sort: function(r){ return r.impliedMovePct; } },
      { label: 'Usual move', num: true, title: 'Average size of the next-session move over the stock’s last ' + ((d.rules && d.rules.history) || 8) + ' reports', cell: function(r){ return r.avgMovePct != null ? ewbPct(r.avgMovePct) + '<small class="vt-sub">' + r.prints + ' reports · max ' + ewbPct(r.maxMovePct) + '</small>' : ''; }, sort: function(r){ return r.avgMovePct; } },
      { label: 'vs usual', title: 'Options price compared with the stock’s usual report move', cell: function(r){ return ewbVsTag(r.vsHistory); }, sort: function(r){ return r.impliedMovePct > 0 && r.avgMovePct > 0 ? r.impliedMovePct / r.avgMovePct : null; } },
      { label: 'Beat priced', num: true, title: 'Past reports where the stock moved more than options had priced', cell: function(r){ return r.exceededOf ? r.exceeded + ' of ' + r.exceededOf : ''; }, sort: function(r){ return r.exceededOf ? r.exceeded / r.exceededOf : null; } },
      { label: 'Up after', num: true, title: 'Past reports where the stock rose the next session', cell: function(r){ return r.prints ? r.upPrints + ' of ' + r.prints : ''; }, sort: function(r){ return r.prints ? r.upPrints / r.prints : null; } },
      { label: 'Run-in', num: true, title: 'How far the stock moved over the last 10 trading days into the report', cell: function(r){ return r.runInPct != null ? '<span class="' + (r.runInPct >= 0 ? 'pos' : 'neg') + '">' + ewbPct(r.runInPct, true) + '</span>' : ''; }, sort: function(r){ return r.runInPct; } }
    ];
    if (owner) cols.push({ label: 'Top Picks plan', cls: 'ewb-plan-col', title: 'What the Top Picks event engine would do with this report (Owner only)', cell: function(r){ return ewbPlanHtml(st.plan.plans[r.symbol]); }, sort: function(r){ var p = st.plan.plans[r.symbol]; return p ? (p.action === 'trade-through' ? 2 : p.action === 'wait' ? 1 : 0) : null; } });
    var detail = function(r){
      var moves = Array.isArray(r.moves) ? r.moves : [];
      var out = !moves.length ? '<p class="hint">No past report moves on record.</p>' :
        '<p class="hint">Next-session moves after the last ' + moves.length + ' reports, oldest first:</p><p>' + moves.map(function(m){
          return '<span class="ewb-tag ' + (m.movePct >= 0 ? 'cheap' : 'rich') + '" title="' + escapeHtml(m.date) + '">' + ewbPct(m.movePct, true) + '</span>';
        }).join(' ') + '</p>';
      var p = owner ? st.plan.plans[r.symbol] : null;
      if (p && p.reason) out += '<p class="ewb-plan-why"><b>Top Picks plan: ' + ewbPlanHead(p) + '.</b> ' + escapeHtml(p.reason.charAt(0).toUpperCase() + p.reason.slice(1).replace(/[.\\s]+$/, '')) + '.</p>';
      return out;
    };
    var range = d.from && d.to ? ewbDate(d.from) + ' to ' + ewbDate(d.to) : 'the next ' + (d.windowDays || 10) + ' days';
    root.innerHTML =
      '<div class="ewb-head"><h3>' + rows.length + ' report' + (rows.length === 1 ? '' : 's') + ', ' + range + '</h3>' +
        (HAS_OWNER_ACCESS && st.planLoading ? '<span class="hint">Loading the Top Picks plan…</span>' : '') + '</div>' +
      ewbSeasonHtml(d.season) +
      '<p class="hint">' + glTerm('impliedMove', 'Options expect ±') + ' is the move the options market prices for the report. "Usual move" is the stock’s own average over its last ' + ((d.rules && d.rules.history) || 8) + ' reports. Options are called pricey when they expect at least 15% more than usual, and cheap at 15% less.</p>' +
      VIEWS.tableHtml(cols, rows, { key: 'earnings-week', cls: 'ewb-table', detail: detail, empty: 'No covered company reports in the next ' + (d.windowDays || 10) + ' days.' });
  }
  function loadEarningsWeekPlan(){
    if (!HAS_OWNER_ACCESS || earningsWeekState.plan || earningsWeekState.planLoading) return;
    earningsWeekState.planLoading = true;
    fetch(dataUrl('earnings-week-plan.json'), { cache: 'no-cache', credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(j){ earningsWeekState.plan = j && j.plans ? j : null; earningsWeekState.planLoading = false; renderEarningsWeek(); });
  }
  function loadEarningsWeek(){
    loadEarningsWeekPlan();
    if (earningsWeekState.data || earningsWeekState.loading){ renderEarningsWeek(); return; }
    earningsWeekState.loading = true; earningsWeekState.error = false;
    renderEarningsWeek();
    fetch(dataUrl('earnings-week.json'), { cache: 'no-cache' })
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(j){ earningsWeekState.data = j && Array.isArray(j.rows) ? j : { rows: [] }; })
      .catch(function(){ earningsWeekState.error = true; })
      .then(function(){ earningsWeekState.loading = false; renderEarningsWeek(); });
  }
  document.addEventListener('stonks-owner-ready', function(){
    var pane = document.getElementById('page-pane-earnings-week');
    if (HAS_OWNER_ACCESS && pane && !pane.hidden) loadEarningsWeek();
  });
`;
}

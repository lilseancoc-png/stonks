// Owner Lab "Evidence" view (2026-11-08): the tests-and-gates board.
//
// Draws evidence-board.json (lib/evidence-board.mjs): every open question
// about the engine with its status, evidence count, projected decision date
// and verdict rule, on one timeline (one lane per kind of test) and one
// table; then the three reads the bake computes from the outcome rows
// (lib/picks-outcomes.mjs): what every scored name did 1 / 5 / 10 / 20
// sessions after each run, the picks against the random control book, and
// the AI grader's buy-now vs wait call.
//
// Owner-only, one fetch, no AI. The returned string is pasted inside the
// app.js IIFE (ES5, no imports) and uses $, escapeHtml, dataUrl,
// quantFetchJson and chHoverAttr from that scope.
export function renderEvidenceJs() {
  return `
  // ---- Owner Lab: Evidence (tests and gates) --------------------------------
  var evbState = { data: null, loading: false, fetchedAt: 0 };
  var EVB_LANES = [['engine', 'Engine rules'], ['grader', 'AI grader'], ['control', 'Random control'], ['signals', 'Shadow signals'], ['record', 'Track record'], ['regime', 'Regime Lab'], ['loop', 'Self-improving loop']];
  var EVB_STATUS = {
    waiting: ['Waiting for data', 'evb-s-wait'], collecting: ['Collecting', 'evb-s-collect'], ready: ['Ready to read', 'evb-s-ready'],
    pass: ['Passed', 'evb-s-pass'], fail: ['Failed', 'evb-s-fail'], inconclusive: ['No clear answer', 'evb-s-unclear']
  };
  function evbPct(v, digits){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(digits == null ? 1 : digits) + '%'; }
  function evbRate(v){ return v == null || !isFinite(v) ? '—' : Math.round(v) + '%'; }
  function evbNum(v, digits){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(digits == null ? 0 : digits); }
  function evbDate(d){
    if (!d || !/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return '—';
    var t = Date.parse(d + 'T12:00:00Z'); if (!isFinite(t)) return d;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function evbDayNum(d){ var t = Date.parse(String(d) + 'T12:00:00Z'); return isFinite(t) ? Math.round(t / 86400000) : null; }
  function evbPill(status){ var s = EVB_STATUS[status] || EVB_STATUS.waiting; return '<span class="evb-pill ' + s[1] + '">' + s[0] + '</span>'; }
  function evbBar(have, need){
    var n = Math.max(0, Number(need) || 0), h = Math.max(0, Number(have) || 0);
    var w = n ? Math.min(100, Math.round(h / n * 100)) : 0;
    return '<span class="evb-bar" role="img" aria-label="' + h + ' of ' + n + '"><span class="evb-bar-fill" style="width:' + w + '%"></span></span>';
  }
  function evbGroupCell(g){
    if (!g || !g.n) return '<td class="num">—</td><td class="num">—</td><td class="num">—</td>';
    return '<td class="num">' + g.n + '</td><td class="num">' + evbRate(g.hit) + '</td><td class="num ' + (g.avg > 0 ? 'sig-pos' : g.avg < 0 ? 'sig-neg' : '') + '">' + evbPct(g.avg, 2) + '</td>';
  }
  // One timeline, one lane per kind of test. A bar runs from the day the
  // evidence started to the fixed or projected decision day; the filled part
  // is the share of the evidence already in hand. The dot marks the decision.
  function evbTimelineSvg(board){
    var tests = (board && board.tests) || [];
    var today = evbDayNum(board && board.asOf);
    if (!today || !tests.length) return '';
    var lo = today - 21, hi = today + 35;
    tests.forEach(function(t){
      var s = evbDayNum(t.start), e = evbDayNum(t.overdue ? t.projected : (t.due || t.projected));
      if (s != null) lo = Math.min(lo, s);
      if (e != null) hi = Math.max(hi, Math.min(e, today + 200));
    });
    lo = Math.min(lo, today - 7); hi = Math.max(hi, lo + 45);
    var L = 150, R = 16, T = 26, rowH = 26, W = 760;
    var byLane = {}; tests.forEach(function(t){ (byLane[t.lane] || (byLane[t.lane] = [])).push(t); });
    var lanes = EVB_LANES.filter(function(l){ return byLane[l[0]]; });
    var rows = []; lanes.forEach(function(l){ byLane[l[0]].forEach(function(t, i){ rows.push({ lane: l, test: t, first: i === 0 }); }); });
    var H = T + rows.length * rowH + 30;
    var x = function(day){ return L + (day - lo) / (hi - lo) * (W - L - R); };
    var out = '';
    // month ticks
    var d = new Date(lo * 86400000); d.setUTCDate(1);
    for (var guard = 0; guard < 14; guard++){
      var day = Math.round(d.getTime() / 86400000);
      if (day > hi) break;
      if (day >= lo){
        var tx = x(day);
        out += '<line class="evb-grid" x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + (T - 6) + '" y2="' + (H - 24) + '"/>';
        out += '<text class="evb-axis" x="' + (tx + 3).toFixed(1) + '" y="' + (H - 10) + '">' + escapeHtml(d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })) + '</text>';
      }
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    var points = [];
    rows.forEach(function(r, i){
      var y = T + i * rowH + rowH / 2, t = r.test;
      if (r.first) out += '<text class="evb-lane" x="6" y="' + (y + 4).toFixed(1) + '">' + escapeHtml(r.lane[1]) + '</text>';
      var s = evbDayNum(t.start), e = evbDayNum(t.overdue ? t.projected : (t.due || t.projected));
      var x0 = x(s != null ? Math.max(lo, s) : today), x1 = x(e != null ? Math.min(hi, e) : hi);
      if (x1 < x0 + 4) x1 = x0 + 4;
      var share = t.progress && t.progress.need ? Math.min(1, (t.progress.have || 0) / t.progress.need) : 0;
      out += '<rect class="evb-track" x="' + x0.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" width="' + (x1 - x0).toFixed(1) + '" height="14" rx="4"/>';
      if (share > 0) out += '<rect class="evb-fill evb-fill-' + escapeHtml(t.status) + '" x="' + x0.toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" width="' + Math.max(2, (x1 - x0) * share).toFixed(1) + '" height="14" rx="4"/>';
      if (e != null) out += '<circle class="evb-dot evb-dot-' + (t.due && !t.overdue ? 'fixed' : 'proj') + '" cx="' + x1.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5"/>';
      out += '<text class="evb-label" x="' + (x0 + 6).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '">' + escapeHtml(t.name) + '</text>';
      var when = t.status === 'ready' ? 'ready to read' : t.due && !t.overdue ? 'decides ' + evbDate(t.due) : t.projected ? 'projected ' + evbDate(t.projected) : 'no pace yet';
      points.push({ x: x1, y: y, label: t.name + '\\n' + (t.progress ? (t.progress.have || 0) + ' of ' + t.progress.need + ' ' + t.progress.unit : '') + '\\n' + when });
    });
    var tx0 = x(today);
    out += '<line class="evb-today" x1="' + tx0.toFixed(1) + '" x2="' + tx0.toFixed(1) + '" y1="' + (T - 14) + '" y2="' + (H - 24) + '"/>';
    out += '<text class="evb-axis evb-today-label" x="' + (tx0 + 4).toFixed(1) + '" y="' + (T - 6) + '">today</text>';
    return '<svg class="evb-timeline" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tests timeline" preserveAspectRatio="xMinYMin meet"' + chHoverAttr(points) + '>' + out + '</svg>';
  }
  function evbTestsTable(board){
    var tests = (board && board.tests) || [];
    if (!tests.length) return '<p class="hint">No tests on the board yet.</p>';
    var rows = tests.map(function(t){
      var p = t.progress || {};
      var when = t.status === 'ready' ? 'now' : t.due && !t.overdue ? evbDate(t.due) + ' (fixed)' : t.projected ? '≈ ' + evbDate(t.projected) + (t.overdue ? ' (past ' + evbDate(t.due) + ', too little evidence)' : '') : 'no pace yet';
      var read = evbReadLine(t);
      return '<tr><td><strong>' + escapeHtml(t.name) + '</strong><div class="evb-q">' + escapeHtml(t.question || '') + '</div></td>' +
        '<td>' + evbPill(t.status) + (t.active === false ? '<div class="evb-q">Rule not in force</div>' : '') + '</td>' +
        '<td class="evb-prog">' + evbBar(p.have, p.need) + '<div class="evb-q">' + (p.have == null ? '—' : p.have) + ' of ' + (p.need == null ? '—' : p.need) + ' ' + escapeHtml(p.unit || '') + '</div></td>' +
        '<td>' + escapeHtml(when) + (t.start ? '<div class="evb-q">since ' + escapeHtml(evbDate(t.start)) + '</div>' : '') + '</td>' +
        '<td>' + read + '<div class="evb-q">' + escapeHtml(t.rule || '') + '</div></td></tr>';
    }).join('');
    return '<div class="acc-tscroll"><table class="acc-qtable evb-table" data-nosort><thead><tr><th scope="col">Test</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Decides</th><th scope="col">Read so far</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function evbReadLine(t){
    var r = t.read || {};
    switch (t.id) {
      case 'early-look': case 'dec7-input-test':
        return r.avgIc == null ? 'No complete runs yet.' : 'Rank correlation ' + evbNum(r.avgIc, 3) + ', positive in ' + evbRate(r.positiveShare) + ' of runs.';
      case 'macro-context':
        return r.winPct == null ? 'No decided trades under the new grade yet.' : 'New grade ' + evbRate(r.winPct) + ' win, ' + evbPct(r.avgPnl) + ' avg · before: ' + evbRate(r.priorWinPct) + ' win, ' + evbPct(r.priorAvgPnl) + ' avg (' + (r.priorN || 0) + ').';
      case 'random-control':
        return r.controlWinPct == null && r.picksWinPct == null ? 'Control book has no decided trades yet.' : 'Picks ' + evbRate(r.picksWinPct) + ' win, ' + evbPct(r.picksAvgPnl) + ' avg · random ' + evbRate(r.controlWinPct) + ' win, ' + evbPct(r.controlAvgPnl) + ' avg' + (r.beatsPct != null ? ' · picks beat ' + r.beatsPct + '% of random books' : '') + '.';
      case 'grader-test':
        return !r.buyNow || !r.buyNow.n ? 'No graded names with a 10-day outcome yet.' : 'Buy now ' + evbRate(r.buyNow.hit) + ' hit (' + r.buyNow.n + ') · wait ' + evbRate(r.wait && r.wait.hit) + ' hit (' + (r.wait ? r.wait.n : 0) + ').';
      case 'edge-showing':
        return r.avgPnl == null ? 'Fewer than five decided trades on the current rules.' : 'Average ' + evbPct(r.avgPnl) + ' per trade, range ' + evbPct(r.low) + ' to ' + evbPct(r.high) + ', ' + evbRate(r.winPct) + ' win.';
      case 'record-judgement':
        return r.winPct == null ? 'No decided trades yet.' : evbRate(r.winPct) + ' win rate, ' + evbPct(r.avgPnl) + ' average P&L.';
      case 'singles-default':
        return r.winPct == null ? 'No decided singles under the policy yet.' : 'Singles ' + evbRate(r.winPct) + ' win, ' + evbPct(r.avgPnl) + ' avg · spreads ' + evbRate(r.spreadWinPct) + ' win, ' + evbPct(r.spreadAvgPnl) + ' avg (' + (r.spreadN || 0) + ').';
      case 'event-plays':
        return r.winPct == null ? 'No decided event trades yet.' : 'Event ' + evbRate(r.winPct) + ' win, ' + evbPct(r.avgPnl) + ' avg · regular ' + evbRate(r.regularWinPct) + ' win, ' + evbPct(r.regularAvgPnl) + ' avg (' + (r.regularN || 0) + ').';
      case 'shadow-signals':
        if (!r.keys) return 'Rows accumulate once a trading day in grades-daily.';
        return r.keys + ' keys logged, ' + r.measured + ' with enough evidence, ' + (r.trades || 0) + ' decided trades carry a snapshot' + (r.passing && r.passing.length ? ' · clearing the bar: ' + r.passing.join(', ') : '') + (r.failing && r.failing.length ? ' · failing: ' + r.failing.join(', ') : '') + '.';
      case 'regime-switch-books':
        return r.switchAvgPnl == null && r.baseAvgPnl == null ? 'The paper books open at the next Top Picks run.' : 'Switch book ' + evbRate(r.switchWinPct) + ' win, ' + evbPct(r.switchAvgPnl) + ' avg · same rules ' + evbRate(r.baseWinPct) + ' win, ' + evbPct(r.baseAvgPnl) + ' avg.';
      case 'regime-grader-by-cell':
        return !r.cellsJudged ? 'No cell has 40 graded names yet.' : r.cellsJudged + ' cell' + (r.cellsJudged === 1 ? '' : 's') + ' judged: ' + Object.keys(r.cells || {}).map(function(k){ return k + ' ' + evbPct(r.cells[k], 2); }).join(', ') + '.';
      case 'regime-book-brakes':
        return r.refused == null ? 'No decided trades yet.' : r.refused + ' refused (avg ' + evbPct(r.refusedAvg) + ') vs kept avg ' + evbPct(r.keptAvg) + '.';
      case 'regime-live-cells':
        return r.byCell ? Object.keys(r.byCell).filter(function(k){ return r.byCell[k]; }).map(function(k){ return k + ' ' + r.byCell[k]; }).join(', ') || 'No decided trades carry a cell yet.' : 'No decided trades yet.';
      default: return '';
    }
  }
  function evbOutcomesHtml(o){
    if (!o || !o.rows) return '<p class="hint">Outcome rows start with the first Top Picks run after this deploys; each horizon fills as its close arrives.</p>';
    var head = '<thead><tr><th scope="col">Group</th><th scope="col" class="num">Names</th><th scope="col" class="num">Hit rate</th><th scope="col" class="num">Avg move, trade side</th></tr></thead>';
    var hz = ['r1', 'r5', 'r10', 'r20'].map(function(k){ return '<tr><td>' + k.slice(1) + ' session' + (k === 'r1' ? '' : 's') + ' later</td>' + evbGroupCell(o.horizons && o.horizons[k]) + '</tr>'; }).join('');
    var bands = ['7+', '4-7', '2-4', '0-2'].map(function(b){ return '<tr><td>Grade ' + b + '</td>' + evbGroupCell(o.bands && o.bands[b]) + '</tr>'; }).join('');
    var mk = ['risk-on', 'neutral', 'risk-off'].map(function(m){ return '<tr><td>' + m.charAt(0).toUpperCase() + m.slice(1) + ' market</td>' + evbGroupCell(o.markets && o.markets[m]) + '</tr>'; }).join('');
    var oc = [['pick', 'Shipped as a pick'], ['gate', 'Turned away by a rule'], ['below-bar', 'Below the trade bar'], ['open', 'Already open']].map(function(p){ return '<tr><td>' + p[1] + '</td>' + evbGroupCell(o.outcomes && o.outcomes[p[0]]) + '</tr>'; }).join('');
    var ic = o.ic && o.ic.runs ? '<p class="evb-note">Rank skill: across ' + o.ic.runs + ' run' + (o.ic.runs === 1 ? '' : 's') + ' with a 10-day outcome, the grade\\'s rank correlation with the next 10 sessions averages <strong>' + evbNum(o.ic.avg, 3) + '</strong> and is positive in <strong>' + evbRate(o.ic.positiveShare) + '</strong> of runs.</p>' : '<p class="evb-note">Rank skill needs runs whose 10-day outcome has arrived.</p>';
    var cover = '<p class="evb-note">' + o.rows + ' name-rows from ' + o.runs + ' run' + (o.runs === 1 ? '' : 's') + ' on ' + o.days + ' day' + (o.days === 1 ? '' : 's') + (o.first ? ', ' + escapeHtml(evbDate(o.first)) + ' to ' + escapeHtml(evbDate(o.last)) : '') + '; ' + o.complete + ' have a 10-day outcome. Hit rate = share of names that moved the way the grade pointed; the average is signed the same way. Names graded under 1 are left out of the horizon and market rows.</p>';
    var tbl = function(title, body){ return '<div class="evb-sub"><h4>' + title + '</h4><div class="acc-tscroll"><table class="acc-qtable" data-nosort>' + head + '<tbody>' + body + '</tbody></table></div></div>'; };
    return cover + ic + '<div class="evb-grid">' + tbl('By horizon', hz) + tbl('By grade band (10 sessions)', bands) + tbl('By market type (10 sessions)', mk) + tbl('By what the run did (10 sessions)', oc) + '</div>';
  }
  function evbControlHtml(c){
    if (!c) return '<p class="hint">The random control book starts with the first Top Picks run after this deploys.</p>';
    var row = function(label, d){ return '<tr><td>' + label + '</td><td class="num">' + (d ? d.n : 0) + '</td><td class="num">' + evbRate(d && d.winPct) + '</td><td class="num ' + (d && d.avgPnl > 0 ? 'sig-pos' : d && d.avgPnl < 0 ? 'sig-neg' : '') + '">' + evbPct(d && d.avgPnl) + '</td><td class="num">' + evbPct(d && d.medianPnl) + '</td></tr>'; };
    var beats = c.beatsPct != null ? '<p class="evb-note">The picks\\' average P&L beats <strong>' + c.beatsPct + '%</strong> of 2,000 same-size books drawn from the control trades. 95% or more is the pass mark.</p>' : '<p class="evb-note">The comparison needs 10 decided control trades and 5 decided picks since the control started' + (c.since ? ' (' + escapeHtml(evbDate(String(c.since).slice(0, 10))) + ')' : '') + '.</p>';
    return '<p class="evb-note">Every decision run also opens two random names with a random side, priced with the engine\\'s own contract picker and closed by the same option model, take-profit, stop, theta and expiry rules. ' + c.drawn + ' drawn so far, ' + c.open + ' open.</p>' +
      '<div class="acc-tscroll"><table class="acc-qtable" data-nosort><thead><tr><th scope="col">Book</th><th scope="col" class="num">Decided</th><th scope="col" class="num">Win rate</th><th scope="col" class="num">Avg P&L</th><th scope="col" class="num">Median P&L</th></tr></thead><tbody>' + row('Random control', c.control) + row('Top Picks (since control start)', c.picks) + '</tbody></table></div>' + beats;
  }
  function evbGraderHtml(o){
    var g = o && o.grader;
    if (!g) return '<p class="hint">The grader read starts with the first Top Picks run after this deploys.</p>';
    var head = '<thead><tr><th scope="col">Grader said</th><th scope="col" class="num">Names</th><th scope="col" class="num">10-day hit rate</th><th scope="col" class="num">Avg move, trade side</th></tr></thead>';
    var rows = function(groups){ return [['buy-now', 'Buy now'], ['wait', 'Wait'], ['none', 'Not graded']].map(function(p){ return '<tr><td>' + p[1] + '</td>' + evbGroupCell(groups && groups[p[0]]) + '</tr>'; }).join(''); };
    var halves = g.halves ? '<div class="evb-grid"><div class="evb-sub"><h4>First half (before ' + escapeHtml(evbDate(g.halves.split)) + ')</h4><div class="acc-tscroll"><table class="acc-qtable" data-nosort>' + head + '<tbody>' + rows(g.halves.first) + '</tbody></table></div></div><div class="evb-sub"><h4>Second half</h4><div class="acc-tscroll"><table class="acc-qtable" data-nosort>' + head + '<tbody>' + rows(g.halves.second) + '</tbody></table></div></div></div>' : '';
    return '<p class="evb-note">Names at or above the trade bar (grade ' + g.bar + '), split by the AI grader\\'s entry call at that run. The grader passes when buy-now names beat wait names by five points of hit rate in both halves of the sample. ' + g.gradedRows + ' graded names have a 10-day outcome.</p>' +
      '<div class="acc-tscroll"><table class="acc-qtable" data-nosort>' + head + '<tbody>' + rows(g.groups) + '</tbody></table></div>' + halves;
  }
  // Shadow-signal table (lib/shadow-research.mjs): every logged candidate's
  // rank correlation with forward returns, alone and with the grade held
  // fixed, and the same key on decided trades.
  var EVB_KEY_STATUS = { collecting: ['Collecting', 'evb-s-collect'], pass: ['Clears the bar', 'evb-s-pass'], fail: ['Fails', 'evb-s-fail'], inconclusive: ['No clear answer', 'evb-s-unclear'] };
  function evbIcCell(v){ return '<td class="num ' + (v > 0.02 ? 'sig-pos' : v < -0.02 ? 'sig-neg' : '') + '">' + (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(3)) + '</td>'; }
  function evbShadowHtml(sh){
    if (!sh || !sh.keys || !sh.keys.length) return '<p class="hint">The shadow table fills from the first full build after this deploys; rows need a close 5 and 10 sessions later before they count.</p>';
    var p = sh.pass || {};
    var rows = sh.keys.map(function(k){
      var r5 = (k.read && k.read['5']) || {}, r10 = (k.read && k.read['10']) || {};
      var st = EVB_KEY_STATUS[k.status] || EVB_KEY_STATUS.collecting;
      var halves = r10.half1 == null ? '—' : (r10.half1 > 0 ? '+' : '') + Number(r10.half1).toFixed(3) + ' / ' + (r10.half2 == null ? '—' : (r10.half2 > 0 ? '+' : '') + Number(r10.half2).toFixed(3));
      return '<tr><td><strong>' + escapeHtml(k.label || k.key) + '</strong><div class="evb-q">' + escapeHtml(k.key) + (k.crowd ? ' · crowd' : '') + '</div></td>' +
        '<td class="num">' + (r10.days || 0) + '<div class="evb-q">' + (k.daysLogged || 0) + ' logged</div></td>' +
        evbIcCell(r5.ic) + evbIcCell(r10.ic) +
        '<td class="num">' + (r10.t == null ? '—' : Number(r10.t).toFixed(2)) + '</td>' +
        '<td class="num">' + (r10.positiveShare == null ? '—' : Math.round(r10.positiveShare * 100) + '%') + '</td>' +
        '<td class="num">' + halves + '</td>' +
        evbIcCell(r10.partial) +
        '<td class="num">' + (k.trades && k.trades.n ? k.trades.n + (k.trades.ic == null ? '' : ' · ' + (k.trades.ic > 0 ? '+' : '') + Number(k.trades.ic).toFixed(3)) : '—') + '</td>' +
        '<td><span class="evb-pill ' + st[1] + '">' + st[0] + '</span></td></tr>';
    }).join('');
    var head = '<thead><tr><th scope="col">Signal</th><th scope="col" class="num">Days</th><th scope="col" class="num">IC 5d</th><th scope="col" class="num">IC 10d</th><th scope="col" class="num">t</th><th scope="col" class="num">Days positive</th><th scope="col" class="num">Halves (10d)</th><th scope="col" class="num">After grade</th><th scope="col" class="num">Trades · IC</th><th scope="col">Status</th></tr></thead>';
    var gauges = '';
    if (sh.gauges && sh.gauges.length){
      var gRows = sh.gauges.map(function(g){
        return '<tr><td><strong>' + escapeHtml(g.label || g.key) + '</strong><div class="evb-q">' + escapeHtml(g.key) + '</div></td><td class="num">' + (g.latest == null ? '—' : Number(g.latest).toLocaleString('en-US', { maximumFractionDigits: 2 })) + '<div class="evb-q">' + escapeHtml(evbDate(g.latestDate)) + '</div></td><td class="num">' + (g.n || 0) + '</td>' + evbIcCell(g.rho) + '</tr>';
      }).join('');
      gauges = '<div class="evb-sub"><h4>Market gauges vs SPY, next 10 sessions</h4><p class="evb-note">One value per day for the whole market (Cboe put/call, CFTC positioning, margin debt, leveraged-ETF flows, Kalshi, market short volume) against SPY\\'s forward 10-session return over non-overlapping days. Slow gauges; ' + (sh.days || 0) + ' days cannot judge them, so there is no pass bar here.</p>' +
        '<div class="acc-tscroll"><table class="acc-qtable" data-nosort><thead><tr><th scope="col">Gauge</th><th scope="col" class="num">Latest</th><th scope="col" class="num">Days</th><th scope="col" class="num">Rank corr.</th></tr></thead><tbody>' + gRows + '</tbody></table></div></div>';
    }
    return '<p class="evb-note">' + (sh.days || 0) + ' shadow day' + (sh.days === 1 ? '' : 's') + (sh.first ? ', ' + escapeHtml(evbDate(sh.first)) + ' to ' + escapeHtml(evbDate(sh.last)) : '') + '; ' + (sh.decidedTrades || 0) + ' decided trade' + (sh.decidedTrades === 1 ? '' : 's') + ' carry a snapshot. IC is the rank correlation between a key and each name\\'s forward return on that day, averaged over every shadow day (the t statistic uses non-overlapping days only); <em>after grade</em> holds the grade total fixed. A key clears the bar at ' + (p.days || 40) + '+ days and ' + (p.trades || 30) + '+ trades with a 10-day IC of ' + (p.ic || 0.03) + '+ in both halves and ' + (p.partial || 0.02) + '+ after the grade. Measurement only: nothing is promoted here.</p>' +
      '<div class="acc-tscroll"><table class="acc-qtable evb-table" data-nosort>' + head + '<tbody>' + rows + '</tbody></table></div>' + gauges;
  }
  function renderEvidenceBoard(){
    var root = $('evidence-board-root'); if (!root) return;
    var b = evbState.data;
    if (!b){ root.innerHTML = '<p class="hint">' + (evbState.error ? 'The evidence board could not be loaded (' + escapeHtml(evbState.error) + '). It is written by every full build; the first one after this deploys creates it.' : 'Loading…') + '</p>'; return; }
    var counts = b.counts || {};
    var chips = Object.keys(EVB_STATUS).filter(function(k){ return counts[k]; }).map(function(k){ return '<span class="evb-chip ' + EVB_STATUS[k][1] + '">' + counts[k] + ' ' + EVB_STATUS[k][0].toLowerCase() + '</span>'; }).join('');
    var nextTest = b.next ? (b.tests || []).filter(function(t){ return t.id === b.next.id; })[0] : null;
    var nextLine = nextTest ? '<p class="evb-lead">Next decision: <strong>' + escapeHtml(nextTest.name) + '</strong> ' + (nextTest.due ? 'on ' : 'around ') + escapeHtml(evbDate(b.next.date)) + '.</p>' : '<p class="evb-lead">No test has a decision date yet; dates appear once evidence starts arriving.</p>';
    root.innerHTML = '<div class="evb-head"><div class="evb-chips">' + chips + '</div><span class="evb-asof">As of ' + escapeHtml(evbDate(b.asOf)) + (b.versions && b.versions.grade ? ' · grade ' + escapeHtml(b.versions.grade) : '') + '</span></div>' + nextLine +
      '<section class="evb-section"><h3>Timeline</h3><p class="evb-note">One bar per test from the day its evidence started to its decision day: a fixed date (solid dot) or the date the current pace reaches the needed count (hollow dot). The filled part is the evidence already in hand.</p>' + evbTimelineSvg(b) + '</section>' +
      '<section class="evb-section"><h3>Tests and gates</h3>' + evbTestsTable(b) + '</section>' +
      '<section class="evb-section"><h3>Shadow signals: candidate inputs</h3>' + evbShadowHtml(b.shadow) + '</section>' +
      '<section class="evb-section"><h3>What happened after every run</h3>' + evbOutcomesHtml(b.outcomes) + '</section>' +
      '<section class="evb-section"><h3>Picks against a random book</h3>' + evbControlHtml(b.control) + '</section>' +
      '<section class="evb-section"><h3>Grading the AI grader</h3>' + evbGraderHtml(b.outcomes) + '</section>';
  }
  // ---- Owner Lab: daily AI cost vs the $1 target ----------------------------
  var costState = { data: null, loading: false, fetchedAt: 0, error: null };
  function costUsd(v, digits){ return v == null || !isFinite(v) ? '—' : '$' + Number(v).toFixed(digits == null ? 2 : digits); }
  function costChartSvg(hist){
    var days = (hist && hist.days || []).slice(-60);
    if (!days.length) return '';
    var target = hist.target || 1;
    var W = 760, H = 220, L = 44, R = 12, T = 14, B = 34, w = W - L - R, h = H - T - B;
    var max = Math.max(target * 1.25, Math.max.apply(null, days.map(function(d){ return d.usd || 0; })) * 1.1);
    var bw = Math.max(2, w / days.length - 2);
    var y = function(v){ return T + h - Math.min(1, v / max) * h; };
    var out = '';
    [0, max / 2, max].forEach(function(v){ out += '<line class="evb-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="evb-axis" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + escapeHtml(costUsd(v)) + '</text>'; });
    var points = [];
    days.forEach(function(d, i){
      var x = L + i * (w / days.length) + 1, v = d.usd || 0, over = v > target;
      out += '<rect class="evb-cost-bar' + (over ? ' evb-cost-over' : '') + (!d.calls ? ' evb-cost-idle' : '') + '" x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, (T + h - y(v))).toFixed(1) + '" rx="1.5"/>';
      points.push({ x: x + bw / 2, y: y(v), label: evbDate(d.d) + '\\n' + costUsd(v, 3) + ' · ' + (d.calls || 0) + ' calls' + (d.in ? '\\nin ' + Math.round(d.in / 1000) + 'k · cached ' + Math.round((d.cached || 0) / 1000) + 'k · out ' + Math.round((d.out || 0) / 1000) + 'k' : ''), value: v, time: d.d });
      if (i === 0 || i === days.length - 1 || new Date(d.d + 'T12:00:00Z').getUTCDate() === 1) out += '<text class="evb-axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + escapeHtml(new Date(d.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })) + '</text>';
    });
    out += '<line class="evb-cost-target" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(target).toFixed(1) + '" y2="' + y(target).toFixed(1) + '"/><text class="evb-axis evb-cost-target-label" x="' + (W - R) + '" y="' + (y(target) - 4).toFixed(1) + '" text-anchor="end">target ' + escapeHtml(costUsd(target)) + ' a day</text>';
    return '<svg class="evb-timeline evb-cost" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily AI cost, last ' + days.length + ' days" preserveAspectRatio="xMinYMin meet"' + chHoverAttr(points) + '>' + out + '</svg>';
  }
  function costSummary(hist){
    var days = (hist && hist.days || []);
    if (!days.length) return null;
    var last = days[days.length - 1].d, target = hist.target || 1;
    var cut = function(n){ return new Date(Date.parse(last + 'T12:00:00Z') - (n - 1) * 86400000).toISOString().slice(0, 10); };
    var w7 = days.filter(function(d){ return d.d >= cut(7); }), w30 = days.filter(function(d){ return d.d >= cut(30); });
    var sum = function(list){ return list.reduce(function(a, d){ return a + (d.usd || 0); }, 0); };
    var active = w30.filter(function(d){ return (d.calls || 0) > 0; });
    return { last: last, avg7: sum(w7) / 7, avg30: sum(w30) / 30, activeAvg: active.length ? sum(active) / active.length : null, over: w30.filter(function(d){ return (d.usd || 0) > target; }).length, total30: sum(w30), target: target, n: days.length };
  }
  function costTypesTable(hist){
    var days = (hist && hist.days || []).slice(-7);
    var types = {}, calls = {};
    days.forEach(function(d){ Object.keys(d.types || {}).forEach(function(t){ types[t] = (types[t] || 0) + (d.types[t].usd || 0); calls[t] = (calls[t] || 0) + (d.types[t].calls || 0); }); });
    var rows = Object.keys(types).sort(function(a, b){ return types[b] - types[a]; });
    if (!rows.length) return '';
    var total = rows.reduce(function(a, t){ return a + types[t]; }, 0) || 1;
    return '<div class="evb-sub"><h4>Last 7 days by call type</h4><div class="acc-tscroll"><table class="acc-qtable" data-nosort><thead><tr><th scope="col">Call type</th><th scope="col" class="num">Calls</th><th scope="col" class="num">Cost</th><th scope="col" class="num">Share</th></tr></thead><tbody>' +
      rows.map(function(t){ return '<tr><td>' + escapeHtml(t) + '</td><td class="num">' + calls[t] + '</td><td class="num">' + costUsd(types[t]) + '</td><td class="num">' + Math.round(types[t] / total * 100) + '%</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function renderCostHistory(){
    var root = $('cost-history-root'); if (!root) return;
    var h = costState.data;
    if (!h){ root.innerHTML = '<p class="hint">' + (costState.error ? 'The cost ledger could not be loaded (' + escapeHtml(costState.error) + '). It is written with every build; the first one after this deploys creates it.' : 'Loading…') + '</p>'; return; }
    var s = costSummary(h);
    if (!s){ root.innerHTML = '<p class="hint">No priced days yet.</p>'; return; }
    var lead = '<p class="evb-note">Estimated spend at the paid Gemini token rates, from the same ledger the build log prints (a ceiling: grounding queries are priced at the overage rate). Average over the last 7 days <strong>' + costUsd(s.avg7) + '</strong> a day, last 30 days <strong>' + costUsd(s.avg30) + '</strong> a day (' + costUsd(s.total30) + ' in total' + (s.activeAvg != null ? ', ' + costUsd(s.activeAvg) + ' on days with AI calls' : '') + '); ' + s.over + ' of the last 30 days went over the ' + costUsd(s.target) + ' target. ' + s.n + ' days on file, through ' + escapeHtml(evbDate(s.last)) + '.</p>';
    root.innerHTML = lead + costChartSvg(h) + costTypesTable(h);
  }
  function loadCostHistory(force){
    if (!force && costState.data && Date.now() - costState.fetchedAt < 15 * 60 * 1000){ renderCostHistory(); return; }
    if (costState.loading) return;
    costState.loading = true; costState.error = null;
    renderCostHistory();
    quantFetchJson(dataUrl('ai-cost-history.json')).then(function(row){
      costState.data = row && typeof row === 'object' && row.days ? row : null; costState.fetchedAt = Date.now(); costState.loading = false; renderCostHistory();
    }).catch(function(err){ costState.loading = false; costState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err); renderCostHistory(); });
  }
  function loadEvidenceBoard(force){
    var status = $('owner-evidence-status');
    if (!force && evbState.data && Date.now() - evbState.fetchedAt < 15 * 60 * 1000){ renderEvidenceBoard(); return; }
    if (evbState.loading) return;
    evbState.loading = true; evbState.error = null;
    if (status) status.textContent = 'Loading the evidence board…';
    renderEvidenceBoard();
    quantFetchJson(dataUrl('evidence-board.json')).then(function(row){
      evbState.data = row && typeof row === 'object' ? row : null; evbState.fetchedAt = Date.now(); evbState.loading = false;
      if (status) status.textContent = evbState.data ? 'Board written by the ' + (evbState.data.builtAt ? new Date(evbState.data.builtAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET build.' : 'latest build.') : 'No board yet.';
      renderEvidenceBoard();
    }).catch(function(err){
      evbState.loading = false; evbState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err);
      if (status) status.textContent = 'The evidence board is not available yet.';
      renderEvidenceBoard();
    });
  }
`;
}

// Owner Lab: the Loop view (2026-11-09). Renders the Owner-only
// picks-loop.json written by every full bake (lib/self-loop/index.mjs): the
// stated odds the loop wrote for each name at each Top Picks run, whether
// those odds were honest once the moves happened, how well the grade called
// direction, what the planned option would have made, which open-pick rules
// paid, and the count model behind the odds. Later steps (diagnosis,
// challengers, tuning) add their own sections when the file carries them.
//
// Pasted into the app.js IIFE after renderRegimeLabJs(), so it reuses the
// evb* formatters, escapeHtml, $, dataUrl, quantFetchJson, VIEWS,
// lineSvgHtml, lineLegendHtml and NO_PICKS from that scope. ES5 only.
export function renderSelfLoopJs() {
  return `
  // ---- Owner Lab: self-improving loop ---------------------------------------
  var slpState = { data: null, loading: false, fetchedAt: 0, error: null };
  var SLP_OUT = { pick: 'Picked', gate: 'Turned away', open: 'Already open', 'below-bar': 'Under the bar', other: 'Other' };
  var SLP_MK = { 'risk-on': 'Risk-on', neutral: 'Neutral', 'risk-off': 'Risk-off' };
  var SLP_VERDICT = { paying: ['Paying', 'evb-s-pass'], costing: ['Costing', 'evb-s-fail'], neutral: ['No clear effect', 'evb-s-unclear'], collecting: ['Collecting', 'evb-s-collect'] };
  function slpNum(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d); }
  function slpPct(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 0 : d) + '%'; }
  function slpPts(v, d){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d); }
  function slpSign(v){ return v == null || !isFinite(v) ? '' : v > 0 ? 'sig-pos' : v < 0 ? 'sig-neg' : ''; }
  function slpTable(head, body){ return '<div class="acc-tscroll"><table class="acc-qtable evb-table slp-table" data-nosort><thead><tr>' + head.map(function(h){ return '<th' + (h[1] ? ' class="num"' : '') + (h[2] ? ' title="' + escapeHtml(h[2]) + '"' : '') + '>' + escapeHtml(h[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>'; }
  function slpSection(id, title, body){ return '<section class="evb-section slp-section" id="' + id + '"><h3>' + title + '</h3>' + body + '</section>'; }
  function slpGateName(g){ var L = (NO_PICKS && NO_PICKS.GATE_LABEL) || {}; return L[g] || g; }
  function slpOutName(out){
    var s = String(out || '');
    if (s.indexOf('pick:') === 0) return 'Picked (' + s.slice(5) + ')';
    if (s.indexOf('gate:') === 0) return 'Turned away: ' + slpGateName(s.slice(5));
    return SLP_OUT[s] || s || '—';
  }
  function slpKpis(list){ return '<div class="mm-kpis slp-kpis">' + list.map(function(k){ return '<div class="mm-kpi"' + (k[2] ? ' title="' + escapeHtml(k[2]) + '"' : '') + '><span>' + escapeHtml(k[0]) + '</span><b>' + k[1] + '</b></div>'; }).join('') + '</div>'; }

  // Where the loop stands: how much it has logged, and whether the count
  // model has enough resolved rows to speak for itself yet.
  function slpStatusHtml(d){
    var s = d.status || {};
    var need = s.needRows || 200;
    var learn = s.learning ? '<span class="evb-pill evb-s-collect">Learning: ' + (s.modelRows || 0) + ' of ' + need + ' rows</span>' : '<span class="evb-pill evb-s-ready">Fitted on ' + (s.modelRows || 0) + ' rows</span>';
    var r = s.resolved || {};
    return '<p class="evb-lead">' + learn + ' Started ' + escapeHtml(evbDate(String(d.startedAt || '').slice(0, 10))) + '. Every 11:00 and 15:30 ET Top Picks run writes a stated chance for every scored name before the move happens; this page grades those chances once the move is in.</p>' +
      slpKpis([
        ['Runs logged', String(s.runs || 0)],
        ['Sessions', String(s.days || 0)],
        ['Estimates written', String(s.rows || 0)],
        ['Graded at 10 sessions', String(r.y10 || 0), 'Estimates whose 10-session stock move is known'],
        ['Option outcomes modeled', String(r.opt || 0), 'Planned contracts replayed on daily closes: +25% take-profit, -50% stop, 20 sessions, 3.5 points of costs'],
        ['This build', (s.filledThisBake || 0) + ' filled, ' + (s.prunedThisBake || 0) + ' pruned'],
      ]) +
      (s.learning ? '<p class="evb-note">Until the model holds ' + need + ' graded rows, every stated chance is mostly the 50% starting point, and is labeled as learning. That is on purpose: a chance built on a handful of trades would read more sure than it is.</p>' : '');
  }

  // Today's run: the names with the strongest grades and the odds written for them.
  function slpLatestHtml(d){
    var L = d.latest;
    if (!L || !L.rows || !L.rows.length) return '<p class="hint">No run logged yet. The first 11:00 or 15:30 ET Top Picks run after this deploys writes the first estimates.</p>';
    var cols = [
      { label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b> ' + escapeHtml(r.side || ''); }, sort: function(r){ return r.s; } },
      { label: 'Grade', num: true, cell: function(r){ return '<span class="' + slpSign(r.tot) + '">' + slpPts(r.tot) + '</span>'; }, sort: function(r){ return Math.abs(r.tot || 0); } },
      { label: 'What the run did', cell: function(r){ return escapeHtml(slpOutName(r.out)) + (r.ev ? '<div class="crd-dim">AI: ' + escapeHtml(r.ev) + '</div>' : ''); }, sort: function(r){ return String(r.out || ''); } },
      { label: '5 sessions', num: true, title: 'Stated chance the stock moves the trade\\'s way within 5 sessions', cell: function(r){ return slpPct(r.p5); }, sort: function(r){ return r.p5; } },
      { label: '10 sessions', num: true, title: 'Stated chance the stock moves the trade\\'s way within 10 sessions', cell: function(r){ return slpPct(r.p10); }, sort: function(r){ return r.p10; } },
      { label: '20 sessions', num: true, title: 'Stated chance the stock moves the trade\\'s way within 20 sessions', cell: function(r){ return slpPct(r.p20); }, sort: function(r){ return r.p20; } },
      { label: 'Expected move', num: true, title: 'Average 10-session move the trade\\'s way for setups like this one, against the move the options price (one standard deviation)', cell: function(r){ return slpPts(r.em10, 2) + '%' + (r.im10 != null ? '<div class="crd-dim">options ±' + slpNum(r.im10, 1) + '%</div>' : ''); }, sort: function(r){ return r.em10; } },
      { label: 'Hits +25% first', num: true, title: 'Stated chance the planned option reaches the +25% take-profit before the -50% stop', cell: function(r){ return slpPct(r.pTp); }, sort: function(r){ return r.pTp; } },
      { label: 'Like this', num: true, title: 'Graded rows behind the finest group this estimate came from (0 = the 50% starting point)', cell: function(r){ return String(r.n || 0); }, sort: function(r){ return r.n || 0; } },
    ];
    return '<p class="evb-lead">' + escapeHtml(evbDate(L.d)) + ' ' + escapeHtml(L.et || '') + ' ET run: ' + L.count + ' names scored; the ' + L.rows.length + ' strongest grades are shown. Chances are for the trade\\'s side: for a put, the chance the stock falls.</p>' +
      VIEWS.tableHtml(cols, L.rows, { key: 'slp-latest', tall: true, empty: 'No estimates in this run.' });
  }

  // Honesty: Brier score per horizon against the coin and the base rate, then
  // the stated-vs-actual bins for the 10-session chance.
  function slpHonestyHtml(d){
    var h = (d.scorecard && d.scorecard.honesty) || {};
    var rows = [['5 sessions', h.p5], ['10 sessions', h.p10], ['20 sessions', h.p20], ['Hits +25% first', h.pTp]];
    var body = rows.map(function(r){
      var x = r[1] || {};
      var better = x.skillVsBase == null ? '' : x.skillVsBase > 0.01 ? 'sig-pos' : x.skillVsBase < -0.01 ? 'sig-neg' : '';
      return '<tr><td>' + r[0] + '</td><td class="num">' + (x.n || 0) + '</td><td class="num">' + slpNum(x.brier, 3) + '</td><td class="num">' + slpNum(x.brierBase, 3) + '</td><td class="num">' + slpPct(x.baseRate) + '</td><td class="num ' + better + '">' + slpPts(x.skillVsBase == null ? null : x.skillVsBase * 100, 0) + (x.skillVsBase == null ? '' : '%') + '</td></tr>';
    }).join('');
    var p10 = h.p10 || {};
    var chart = '';
    if (p10.bins && p10.bins.length >= 2){
      var labels = p10.bins.map(function(b){ return b.lo + '-' + b.hi + '%'; });
      var series = [
        { name: 'Stated', values: p10.bins.map(function(b){ return b.said; }), cls: 'ln-s1', dashed: true },
        { name: 'Happened', values: p10.bins.map(function(b){ return b.got; }), cls: 'ln-s0', dots: true },
      ];
      chart = lineLegendHtml(series) + lineSvgHtml({ labels: labels, series: series, h: 220, yRange: [0, 100], yFmt: function(v){ return Math.round(v) + '%'; }, ariaLabel: 'Stated 10-session chance against how often it happened' }) +
        '<p class="evb-note">Honest odds put the two lines on top of each other. Rows per group: ' + p10.bins.map(function(b){ return b.lo + '-' + b.hi + '% ' + b.n; }).join(', ') + '.</p>';
    }
    return '<p class="evb-lead">The Brier score is the average squared miss of a stated chance (lower is better; always saying 50% scores 0.250). It only counts estimates the model had real rows behind. "Beats the base rate" compares it with always stating how often moves went the trade\\'s way on the same rows.</p>' +
      slpTable([['Horizon'], ['Graded', 1], ['Brier', 1], ['Base rate Brier', 1], ['Went its way', 1], ['Beats the base rate', 1, 'Share of the base rate\\'s squared miss removed; positive means the stated odds add something']], body) + chart;
  }

  function slpDirectionHtml(d){
    var sc = d.scorecard || {};
    var dir = sc.direction || {}, rank = sc.rank || {};
    var hs = [['y5', '5'], ['y10', '10'], ['y20', '20']];
    var body = hs.map(function(h){
      var a = (dir.all || {})[h[0]] || {}, t = (dir.trade || {})[h[0]] || {}, k = rank[h[0]] || {};
      return '<tr><td>' + h[1] + '</td><td class="num">' + (a.n || 0) + '</td><td class="num">' + slpPct(a.hit, 1) + '</td><td class="num ' + slpSign(a.avg) + '">' + slpPts(a.avg, 2) + '%</td><td class="num">' + (t.n || 0) + '</td><td class="num">' + slpPct(t.hit, 1) + '</td><td class="num ' + slpSign(t.avg) + '">' + slpPts(t.avg, 2) + '%</td><td class="num ' + slpSign(k.avg) + '">' + (k.avg == null ? '—' : slpPts(k.avg, 3)) + '</td><td class="num">' + slpPct(k.positive) + '</td><td class="num">' + slpNum(k.t, 2) + '</td></tr>';
    }).join('');
    var m = sc.moves || {};
    var moves = m.n ? '<p class="evb-note">Size of the moves: over ' + m.n + ' graded names the average 10-session move was ' + slpNum(m.realized, 2) + '% against ' + slpNum(m.implied, 2) + '% priced by the options (ratio ' + slpNum(m.ratio, 2) + '; under 1 means the options charged for more movement than came).' + (m.emN ? ' The expected move the loop stated missed by ' + slpNum(m.emMae, 2) + ' points on average, ' + (m.emBias > 0 ? 'too low' : 'too high') + ' by ' + slpNum(Math.abs(m.emBias || 0), 2) + ' points.' : '') + '</p>' : '';
    return '<p class="evb-lead">Hit rate counts moves that went the grade\\'s way (flat moves left out). Rank skill is the correlation between the grade total and the stock\\'s move across every name in a run; the t value uses one run per horizon so overlapping windows are not counted twice.</p>' +
      slpTable([['Sessions'], ['Names', 1, 'Graded names with any lean (grade 1 or more either way)'], ['Its way', 1], ['Avg move', 1], ['Names 4+', 1, 'Graded trade-grade names (grade 4 or more either way)'], ['Its way', 1], ['Avg move', 1], ['Rank skill', 1], ['Runs above 0', 1], ['t', 1]], body) + moves;
  }

  function slpSplitRows(list, nameFn){
    return (list || []).map(function(g){
      var o = g.opt || {}, dr = g.dir || {};
      return '<tr><td>' + escapeHtml(nameFn ? nameFn(g.key) : g.key) + '</td><td class="num">' + (o.n || 0) + '</td><td class="num">' + slpPct(o.win) + '</td><td class="num">' + slpPct(o.tp) + '</td><td class="num">' + slpPct(o.stop) + '</td><td class="num ' + slpSign(o.avg) + '">' + slpPts(o.avg) + '</td><td class="num">' + slpPct(dr.hit, 1) + '</td></tr>';
    }).join('');
  }
  function slpOptionsHtml(d){
    var o = (d.scorecard && d.scorecard.options) || {};
    var t = o.trade || {};
    var head = [['Group'], ['Modeled', 1], ['Won', 1], ['+25% first', 1], ['Stopped', 1], ['Average after costs', 1, 'Percent of the premium paid, after 3.5 points of costs'], ['Stock went its way at 10', 1]];
    var tabs = [
      ['By side', o.bySide, function(k){ return k === 'call' ? 'Calls' : k === 'put' ? 'Puts' : k; }],
      ['By market type', o.byMarket, function(k){ return SLP_MK[k] || k; }],
      ['By Regime Lab cell', o.byCell, null],
      ['By event play', o.byEvent, function(k){ return k === 'none' ? 'Not an event play' : k; }],
      ['By AI entry call', o.byVerdict, null],
      ['By what the run did', o.byOutcome, function(k){ return SLP_OUT[k] || k; }],
      ['By grade band (any lean)', o.byBand, function(k){ return k === '9' ? '9 and up' : k + ' to ' + (Number(k) + 1); }],
    ];
    return '<p class="evb-lead">Every trade-grade name (grade 4 or more either way), picked or not, has its planned contract replayed on daily closes at its entry IV: +25% take-profit, -50% stop, 20 sessions at most, 3.5 points of costs. Across ' + (t.n || 0) + ' modeled: won ' + slpPct(t.win) + ', average ' + slpPts(t.avg) + ' points (wins ' + slpPts(t.avgWin) + ', losses ' + slpPts(t.avgLoss) + '). A model, not fills: the Track Record is the real book.</p>' +
      tabs.map(function(tb){ return (tb[1] && tb[1].length) ? '<details class="rgl-details slp-details"' + (tb[0] === 'By side' ? ' open' : '') + '><summary>' + tb[0] + '</summary>' + slpTable(head, slpSplitRows(tb[1], tb[2])) + '</details>' : ''; }).join('');
  }

  function slpGatesHtml(d){
    var g = (d.scorecard && d.scorecard.gates) || {};
    var th = g.through || {};
    if (!g.gates || !g.gates.length) return '<p class="hint">No trade-grade name has been turned away with a modeled outcome yet.</p>';
    var body = g.gates.map(function(x){
      var v = SLP_VERDICT[x.verdict] || SLP_VERDICT.collecting;
      return '<tr><td>' + escapeHtml(slpGateName(x.gate)) + '</td><td class="num">' + x.n + '</td><td class="num ' + slpSign(x.avg) + '">' + slpPts(x.avg) + '</td><td class="num ' + slpSign(x.saved) + '">' + slpPts(x.saved) + '</td><td><span class="evb-pill ' + v[1] + '">' + v[0] + '</span></td></tr>';
    }).join('');
    return '<p class="evb-lead">Names the run let through (' + (th.n || 0) + ' modeled) averaged ' + slpPts(th.avg) + ' points after costs. For each rule: what the names it stopped would have made. "Saved" is let-through minus stopped, so a positive number means the rule kept the book out of worse trades. A verdict needs 20 names on each side.</p>' +
      slpTable([['Rule'], ['Stopped', 1], ['Their average', 1], ['Saved', 1, 'Let-through average minus the stopped names average'], ['Verdict']], body);
  }

  function slpModelHtml(d){
    var rows = (d.model || []).filter(function(r){ return r.n10 || r.nOpt; });
    if (!rows.length) return '<p class="hint">No graded rows yet; every cell reads the 50% starting point.</p>';
    var body = rows.map(function(r){ return '<tr><td>' + (r.band === 9 ? '9+' : r.band) + '</td><td>' + escapeHtml(r.side) + '</td><td class="num">' + r.n10 + '</td><td class="num">' + slpPct(r.p10) + '</td><td class="num ' + slpSign(r.em10) + '">' + slpPts(r.em10, 2) + '%</td><td class="num">' + r.nOpt + '</td><td class="num">' + slpPct(r.pTp) + '</td><td class="num ' + slpSign(r.ev) + '">' + slpPts(r.ev) + '</td></tr>'; }).join('');
    return '<p class="evb-lead">The count model the next run will use, by grade band and side (the market-type split sits under each). Each group is pulled toward the group above it until it has about 20 rows of its own, so small groups cannot shout.</p>' +
      slpTable([['Grade band'], ['Side'], ['Graded', 1], ['Went its way at 10', 1], ['Average move', 1], ['Options modeled', 1], ['+25% first', 1], ['Expected after costs', 1]], body);
  }

  function slpHistoryHtml(d){
    var h = (d.history || []).filter(function(x){ return x && x.d; });
    if (h.length < 2) return '<p class="hint">One point per run date appears once its 10-session moves are in (about two weeks after the first run).</p>';
    var labels = h.map(function(x){ return String(x.d).slice(5); });
    var xEvery = Math.max(1, Math.ceil(h.length / 8));
    var s1 = [{ name: 'Went its way (%)', values: h.map(function(x){ return x.hit; }), cls: 'ln-s0' }];
    var s2 = [{ name: 'Rank skill', values: h.map(function(x){ return x.ic; }), cls: 'ln-s0' }, { name: 'Brier', values: h.map(function(x){ return x.brier; }), cls: 'ln-s1', dashed: true }];
    return '<p class="evb-lead">By run date, once each date\\'s 10-session moves are in.</p>' +
      lineLegendHtml(s1) + lineSvgHtml({ labels: labels, series: s1, h: 200, xEvery: xEvery, ariaLabel: 'Share of names that moved the grade way, by run date' }) +
      lineLegendHtml(s2) + lineSvgHtml({ labels: labels, series: s2, h: 200, xEvery: xEvery, zero: true, yFmt: function(v){ return v.toFixed(2); }, ariaLabel: 'Rank skill and Brier score by run date' });
  }

  // Sections that later loop steps add (diagnosis, challengers, tuning) are
  // drawn by hooks they register here; none is required.
  var SLP_EXTRA = [];
  function renderSelfLoop(){
    var root = $('self-loop-root'); if (!root) return;
    var d = slpState.data;
    if (!d){ root.innerHTML = '<p class="hint">' + (slpState.error ? 'The loop could not be loaded (' + escapeHtml(slpState.error) + '). Every full build writes it; the first one after this deploys creates it.' : 'Loading…') + '</p>'; return; }
    var parts = [
      ['slp-status', 'Where the loop stands', slpStatusHtml],
      ['slp-latest', 'Latest estimates', slpLatestHtml],
      ['slp-honesty', 'Are the stated odds honest?', slpHonestyHtml],
      ['slp-direction', 'Does the grade call direction?', slpDirectionHtml],
      ['slp-options', 'What would the planned option have made?', slpOptionsHtml],
      ['slp-gates', 'Which open-pick rules pay?', slpGatesHtml],
    ];
    SLP_EXTRA.forEach(function(x){ if (x && x.when(d)) parts.push([x.id, x.title, x.html]); });
    parts.push(['slp-model', 'The model behind the odds', slpModelHtml]);
    parts.push(['slp-history', 'Day by day', slpHistoryHtml]);
    var nav = '<nav class="rgl-nav" aria-label="Loop sections">' + parts.map(function(p){ return '<a href="#' + p[0] + '">' + escapeHtml(p[1].replace(/\\?$/, '')) + '</a>'; }).join('') + '</nav>';
    root.innerHTML = nav + parts.map(function(p){ return slpSection(p[0], escapeHtml(p[1]), p[2](d)); }).join('') +
      '<p class="evb-note">Measurement only: nothing on this page changes a pick, a grade or the Track Record unless self-tuning is switched on. Built ' + escapeHtml(rglEt(d.builtAt)) + '. Rules version ' + escapeHtml(String(d.v || '')) + '.</p>';
  }
  function loadSelfLoop(force){
    var status = $('owner-loop-status');
    if (!force && slpState.data && Date.now() - slpState.fetchedAt < 15 * 60 * 1000){ renderSelfLoop(); return; }
    if (slpState.loading) return;
    slpState.loading = true; slpState.error = null;
    if (status) status.textContent = 'Loading the loop…';
    renderSelfLoop();
    quantFetchJson(dataUrl('picks-loop.json')).then(function(row){
      slpState.data = row && typeof row === 'object' ? row : null; slpState.fetchedAt = Date.now(); slpState.loading = false;
      if (status) status.textContent = slpState.data ? 'Written by the ' + rglEt(slpState.data.builtAt) + ' build.' : 'No loop file yet.';
      renderSelfLoop();
    }).catch(function(err){
      slpState.loading = false; slpState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err);
      if (status) status.textContent = 'The loop is not available yet.';
      renderSelfLoop();
    });
  }
`;
}

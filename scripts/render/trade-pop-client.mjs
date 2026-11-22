// Chance of profit on the Webull trades (2026-11-22, lib/trade-pop.mjs): the
// stated chance on every open trade with a "Why" that lays out its inputs,
// and the Owner check of stated against what happened.
//
// Reads only the stamps already on the records the Open picks page loads
// (picks-accuracy.json for Top Picks, engines.json for the engines, whose
// `popCheck` block is the check). No fetch, no AI. Pasted inside the app.js
// IIFE (ES5); uses escapeHtml and VIEWS from the same scope.
export function renderTradePopJs() {
  return `
  // ---- Chance of profit ---------------------------------------------------------
  function popPct(v){ var n = Number(v); return v == null || v === '' || !isFinite(n) ? '—' : Math.round(n * 100) + '%'; }
  function popSigned(v, d){ var n = Number(v); if (v == null || !isFinite(n)) return '—'; var s = n.toFixed(d == null ? 0 : d); return (n > 0 ? '+' : n < 0 ? '−' : '') + s.replace('-', '') + '%'; }
  function popMoney(v){ var n = Number(v); return v == null || !isFinite(n) ? '—' : '$' + n.toFixed(2); }
  function popCls(v){ var n = Number(v); return !isFinite(n) ? '' : n >= 0.55 ? 'sig-pos' : n < 0.45 ? 'sig-neg' : ''; }
  // The plain-English "why" behind one stamp.
  function popWhyHtml(s){
    if (!s) return '<p class="hint">No chance was stated for this trade (it opened before the chance of profit started on 22 November 2026, or the switch was off).</p>';
    var m = s.mod || null, out = [];
    var wR = Number(s.w) || 0;
    var head = '<p class="pop-line"><b>Our estimate: ' + popPct(s.p) + '</b> chance this trade closes with a gain. ';
    if (s.m != null && s.r != null) head += 'It blends the market model (' + popPct(s.m) + ', weight ' + Math.round((1 - wR) * 100) + '%) with the track record (' + popPct(s.r) + ', weight ' + Math.round(wR * 100) + '%). The record’s weight is its trades counted (' + escapeHtml(String(s.rn)) + ') over that number plus 40, so it grows as the sample does.';
    else if (s.m != null) head += 'It is the market model alone: there is no track record for this kind of trade yet.';
    else if (s.r != null) head += 'It is the track record (' + popPct(s.r) + ' over ' + escapeHtml(String(s.rn)) + ' trades) pulled toward a coin flip, because the market model had no usable volatility.';
    out.push(head + '</p>');
    if (m){
      if (m.none) out.push('<p class="pop-line"><b>Market model:</b> not run (' + escapeHtml(m.none) + ').</p>');
      else {
        var ex = [];
        if (m.tp != null) ex.push('take-profit ' + popSigned(m.tp));
        if (m.stop != null) ex.push('stop ' + popSigned(m.stop));
        if (m.trail && m.trail.length === 2) ex.push('trailing exit (after ' + popSigned(m.trail[0]) + ', giving back ' + Math.abs(Number(m.trail[1])) + ' points)');
        if (m.sStop != null) ex.push('stock stop ' + popMoney(m.sStop));
        if (m.sTarget != null) ex.push('stock target ' + popMoney(m.sTarget));
        ex.push('at most ' + m.sessions + ' session' + (m.sessions === 1 ? '' : 's') + (m.hw ? ' (' + escapeHtml(m.hw) + ')' : ''));
        var basis = m.kind === 'shares' ? 'Shares: the result is the stock’s move less ' + (m.cost != null ? m.cost + '%' : 'the') + ' round-trip cost.'
          : m.entryRatio > 1.0005 ? 'Bought at the ask (' + Math.round((m.entryRatio - 1) * 1000) / 10 + '% over the mid) and sold at the bid (' + Math.round((m.haircut || 0) * 1000) / 10 + '% under the mid), as the record books it.'
          : 'Valued at the mid, as the record marks it.';
        var o = m.out || {};
        var ends = [];
        if (o.tp) ends.push(popPct(o.tp) + ' reached the take-profit');
        if (o.stop) ends.push(popPct(o.stop) + ' the stop');
        if (o.trail) ends.push(popPct(o.trail) + ' the trailing exit');
        if (o.sStop) ends.push(popPct(o.sStop) + ' the stock stop');
        if (o.sTarget) ends.push(popPct(o.sTarget) + ' the stock target');
        if (o.end) ends.push(popPct(o.end) + ' ran to the last session');
        out.push('<p class="pop-line"><b>Market model: ' + popPct(s.m) + '.</b> ' + Number(m.paths || 0).toLocaleString('en-US') + ' simulated paths of the stock at ' + popPct(m.sigma) + ' a year (' + escapeHtml(m.from || 'volatility') + '), drifting at the risk-free rate, so no edge is assumed. Each path runs through this trade’s exits: ' + escapeHtml(ex.join(', ')) + '. ' + basis + '</p>');
        if (ends.length) out.push('<p class="pop-line pop-sub">Of the paths, ' + escapeHtml(ends.join(', ')) + '. The model’s average result is ' + popSigned(m.avg, 1) + '.' + (m.held != null ? ' Held to expiry with no exits, the textbook chance of finishing past the ' + popMoney(m.be) + ' breakeven would be ' + popPct(m.held) + '.' : '') + '</p>');
      }
    }
    var src = s.src || [];
    if (src.length){
      out.push('<p class="pop-line"><b>Track record: ' + popPct(s.r) + '.</b></p><ul class="pop-src">' + src.map(function(x){
        return '<li>' + escapeHtml(x.label || x.id) + ': ' + popPct(x.p) + ' won over ' + Number(x.n).toLocaleString('en-US') + ' trade' + (x.n === 1 ? '' : 's') + (x.cap != null ? ' (counted as ' + x.cap + ': a replay of past prices, so live closes soon outweigh it)' : '') + '</li>';
      }).join('') + '</ul>');
    } else out.push('<p class="pop-line"><b>Track record:</b> none yet for this kind of trade.</p>');
    if (s.note) out.push('<p class="pop-line pop-sub">' + escapeHtml(s.note) + '</p>');
    if (s.eg) out.push(egWhyHtml(s.eg));
    out.push('<p class="pop-line pop-sub">Set once when the trade opened and never changed. Not modeled: thesis, news and earnings exits, gaps inside a day, and any edge the setup really has (which is what the check below measures).' + (s.res ? ' Outcome: ' + (s.res.y === 1 ? 'closed with a gain' : s.res.y === 0 ? 'closed without a gain' : 'not counted') + (s.res.pnl != null ? ' (' + popSigned(s.res.pnl, 1) + ')' : '') + '.' : '') + '</p>');
    return '<div class="pop-why">' + out.join('') + '</div>';
  }
  // ---- Expected gain (lib/trade-pop.mjs expectedGain) ------------------------------
  var EG_BETTER = { option: 'the option', shares: 'shares', 'about even': 'about even', neither: 'neither (no gain expected either way)' };
  function egUsd(v){ var n = Number(v); return v == null || !isFinite(n) ? '' : (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function egCls(v){ var n = Number(v); return !isFinite(n) ? '' : n > 0.05 ? 'sig-pos' : n < -0.05 ? 'sig-neg' : ''; }
  function egWhyHtml(g){
    var out = [], fc = g.fc || {}, vol = g.vol || {};
    var opt = g.twin != null || vol.iv != null;
    var head = '<p class="pop-line"><b>Expected gain: ' + popSigned(g.ev, 1) + '</b> of the money put in' + (g.evUsd != null ? ' (' + egUsd(g.evUsd) + ' on ' + egUsd(g.costUsd) + ')' : '') + ', if the stock moves as forecast: ' + popSigned(fc.move, 2) + ' the trade’s way over ' + fc.sessions + ' session' + (fc.sessions === 1 ? '' : 's') + ' (' + escapeHtml(fc.from || 'no forecast') + ')' + (fc.learning ? ', still learning' : '') + '. ';
    head += 'Chance of a gain under that forecast: ' + popPct(g.pop) + '.</p>';
    out.push(head);
    var hu = g.hurdle != null ? 'It breaks even at a move of <b>' + popSigned(g.hurdle, 2) + '</b> the trade’s way over those sessions' : 'Break-even move: ' + escapeHtml(g.hurdleWhy || 'not found');
    out.push('<p class="pop-line">' + hu + '. With no move at all it would make ' + popSigned(g.ev0, 1) + ': that is the cost of the ' + (opt ? 'option (time decay, the spread and any IV above the stock’s own moves)' : 'trade (the round-trip cost)') + '.</p>');
    var v = 'The stock path moves ' + popPct(vol.path) + ' a year (' + escapeHtml(vol.from || 'volatility') + ')';
    if (vol.iv != null) v += ', while the option is priced at ' + popPct(vol.iv) + ' IV' + (vol.gap != null ? ' (' + (vol.gap >= 0 ? popPct(vol.gap) + ' above' : popPct(-vol.gap) + ' below') + ' the stock’s own moves)' : '') + '; IV ends near ' + popPct(g.ivEnd) + ' (' + escapeHtml(g.ivFrom || 'flat') + ')';
    out.push('<p class="pop-line pop-sub">' + v + '. Same exits and fills as the chance of profit above.</p>');
    if (g.twin){
      out.push('<p class="pop-line"><b>Shares instead:</b> the same forecast on shares the same way would make ' + popSigned(g.twin.ev, 1) + ' of the money put in (break-even ' + (g.twin.hurdle != null ? popSigned(g.twin.hurdle, 2) : '—') + '). Per dollar of average loss: option ' + (g.perRisk != null ? g.perRisk.toFixed(2) : '—') + ', shares ' + (g.twin.perRisk != null ? g.twin.perRisk.toFixed(2) : '—') + '. Better vehicle by that measure: <b>' + escapeHtml(EG_BETTER[g.better] || g.better || '—') + '</b>.</p>');
    }
    if (fc.ref && fc.ref.optAvg != null) out.push('<p class="pop-line pop-sub">For reference, the history test’s option trades on this setup averaged ' + popSigned(fc.ref.optAvg, 1) + ' over ' + Number(fc.ref.optN || 0).toLocaleString('en-US') + ' trades, priced from a model, so not used here.</p>');
    if (fc.ref && fc.ref.implied10 != null) out.push('<p class="pop-line pop-sub">The options imply a move of about ' + popSigned(fc.ref.implied10, 1).replace('+', '±') + ' over 10 sessions, either way.</p>');
    out.push('<p class="pop-line pop-sub">Measure only: it changes nothing about this trade. It is set once and checked against the result in the Expected gain check.</p>');
    return '<div class="pop-eg">' + out.join('') + '</div>';
  }
  function egCellHtml(t){
    var g = t && t.pop && t.pop.eg;
    if (!g) return '<span class="crd-dim">—</span>';
    return '<b class="' + egCls(g.ev) + '" title="If the stock moves ' + escapeHtml(popSigned(g.fc && g.fc.move, 2)) + ' the trade’s way. Break-even move ' + escapeHtml(g.hurdle != null ? popSigned(g.hurdle, 2) : '—') + '. With no move ' + escapeHtml(popSigned(g.ev0, 1)) + '. Open the row for why.">' + popSigned(g.ev, 1) + '</b>' + (g.hurdle != null ? '<div class="crd-dim">needs ' + popSigned(g.hurdle, 1) + '</div>' : '');
  }
  function egSortOf(t){ var v = Number(t && t.pop && t.pop.eg && t.pop.eg.ev); return t && t.pop && t.pop.eg && isFinite(v) ? v : null; }
  var EG_TIP = 'Expected gain, set when the trade opened: the average simulated result (% of the money put in) if the stock moves as forecast, through the trade’s real exits and fills. "needs" is the move the trade’s way it takes to break even. Measure only.';

  // A card line: the chance and a Why that opens in place.
  function popChipHtml(t){
    var s = t && t.pop;
    if (!s || !HAS_OWNER_ACCESS) return '';
    var eg = s.eg ? ' <span class="pop-lbl">Expected</span> <b class="' + egCls(s.eg.ev) + '">' + popSigned(s.eg.ev, 1) + '</b>' + (s.eg.hurdle != null ? ' <small>needs ' + popSigned(s.eg.hurdle, 1) + '</small>' : '') : '';
    return '<details class="pop-chip"><summary><span class="pop-lbl">Chance of profit</span> <b class="' + popCls(s.p) + '">' + popPct(s.p) + '</b> <small>model ' + popPct(s.m) + ' · record ' + popPct(s.r) + '</small>' + eg + ' <span class="pop-open">Why</span></summary>' + popWhyHtml(s) + '</details>';
  }
  // A table cell: the chance and the row's expand button (the why sits in the row's detail).
  function popCellHtml(t, withExpand){
    var s = t && t.pop;
    if (!s) return '<span class="crd-dim">—</span>';
    return (withExpand ? VIEWS.expandHtml('Why this chance') : '') + '<b class="' + popCls(s.p) + '" title="Model ' + popPct(s.m) + ', record ' + popPct(s.r) + '. Open the row for why.">' + popPct(s.p) + '</b>';
  }
  function popSortOf(t){ var v = Number(t && t.pop && t.pop.p); return t && t.pop && isFinite(v) ? v : null; }
  var POP_TIP = 'Our stated chance, set when the trade opened, that it closes with a gain: a simulation at the option’s own implied volatility through the trade’s real exits, blended with how often the same kind of trade has won. Open the row for the inputs.';

  // ---- The check ------------------------------------------------------------------
  var POP_VERDICT = { good: 'Honest and useful', flat: 'Honest, no better than the base rate', over: 'Too high', under: 'Too low', uneven: 'Uneven', worse: 'Worse than the base rate', few: 'Too few closes yet' };
  var POP_GROUP_NAMES = { 'top-picks': 'Top Picks', 'engine-options': 'Engine options', 'engine-shares': 'Engine shares', trials: 'Paper trial' };
  function popCheckHtml(c){
    if (!HAS_OWNER_ACCESS) return '';
    if (!c) return '<details class="accuracy-advanced pop-check"><summary class="accuracy-advanced-summary">Chance of profit check <span class="mm-owner-tag">Owner</span></summary><div class="accuracy-advanced-body"><p class="hint">The check appears after the next 11:00 or 15:30 ET run.</p></div></details>';
    var all = (c.groups || [])[0] || null, est = all && (all.methods || [])[0];
    var kpis = '<div class="mm-kpis">' +
      '<div class="mm-kpi"><span>Trades with a stated chance</span><b>' + (c.stamped || 0) + '</b></div>' +
      '<div class="mm-kpi"><span>Closed and graded</span><b>' + (c.closed || 0) + '</b></div>' +
      (est && est.n ? '<div class="mm-kpi"><span>Stated on average</span><b>' + popPct(est.stated) + '</b></div><div class="mm-kpi"><span>Closed with a gain</span><b>' + popPct(est.rate) + '</b></div>' : '') +
    '</div>';
    var rows = [];
    (c.groups || []).forEach(function(g){
      (g.methods || []).forEach(function(m, i){
        rows.push('<tr' + (i === 0 ? ' class="pop-grp"' : '') + '><td>' + (i === 0 ? '<b>' + escapeHtml(g.label) + '</b> <small>' + g.closed + ' closed · ' + g.open + ' open</small>' : '') + '</td><td>' + escapeHtml(m.label) + '</td><td class="num">' + (m.n || 0) + '</td><td class="num">' + popPct(m.stated) + '</td><td class="num">' + popPct(m.rate) + '</td><td class="num">' + (m.skill == null ? '—' : (m.skill > 0 ? '+' : '') + Math.round(m.skill * 100) + '%') + '</td><td title="' + escapeHtml(m.read || '') + '">' + escapeHtml(POP_VERDICT[m.verdict] || m.verdict || '') + '</td></tr>');
      });
    });
    var table = '<div class="acc-tscroll"><table class="acc-qtable pop-table" data-nosort><thead><tr><th>Trades</th><th>Method</th><th class="num">Closed</th><th class="num">Stated</th><th class="num">Won</th><th class="num" title="Brier skill against always saying the base rate: above zero means the stated chances beat it">Skill</th><th>Read</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    var buckets = est && est.buckets ? '<h4 class="pd-h4">Every Webull trade: stated against won</h4><div class="acc-tscroll"><table class="acc-qtable pop-table" data-nosort><thead><tr><th>We said</th><th class="num">Closed</th><th class="num">Stated (avg)</th><th class="num">Won</th><th>Gap</th></tr></thead><tbody>' + est.buckets.map(function(b){
      var gap = b.n && b.stated != null && b.won != null ? Math.round((b.won - b.stated) * 100) : null;
      return '<tr><td>' + Math.round(b.lo * 100) + '–' + Math.round(b.hi * 100) + '%</td><td class="num">' + b.n + '</td><td class="num">' + (b.n ? popPct(b.stated) : '—') + '</td><td class="num">' + (b.n ? popPct(b.won) : '—') + '</td><td>' + (gap == null ? '' : vtCbarHtml(gap, 30, (gap > 0 ? '+' : gap < 0 ? '−' : '') + Math.abs(gap) + ' pts')) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
    var wb = c.webull && c.webull.n ? '<p class="hint">Against the Webull fills (' + c.webull.n + ' closed in the paper account): stated ' + popPct(c.webull.stated) + ', closed with a gain ' + popPct(c.webull.rate) + '. ' + escapeHtml(c.webull.read || '') + '</p>' : '<p class="hint">No closed Webull fill has a stated chance yet; the fills are graded here once they do.</p>';
    var recent = (c.recent || []).length ? '<h4 class="pd-h4">Latest closes</h4><div class="acc-tscroll"><table class="acc-qtable pop-table" data-nosort><thead><tr><th>Trade</th><th>Made by</th><th class="num">Stated</th><th class="num">Model</th><th class="num">Record</th><th>Result</th><th>Webull</th></tr></thead><tbody>' + c.recent.slice(0, 20).map(function(r){
      return '<tr><td><b>' + escapeHtml(r.sym || '') + '</b> ' + (r.g === 'engine-shares' ? 'shares' : escapeHtml(r.side || '')) + '</td><td>' + escapeHtml(r.eng ? (typeof engName === 'function' ? engName(r.eng) : r.eng) : 'Top Picks') + (r.g === 'trials' ? ' <small>trial</small>' : '') + '</td><td class="num">' + popPct(r.p) + '</td><td class="num">' + popPct(r.m) + '</td><td class="num">' + popPct(r.r) + '</td><td>' + (r.y === 1 ? '<span class="sig-pos">Gain ' + popSigned(r.pnl, 1) + '</span>' : r.y === 0 ? '<span class="sig-neg">No gain ' + popSigned(r.pnl, 1) + '</span>' : '<span class="crd-dim">Not counted</span>') + '</td><td>' + (r.wy === 1 ? 'Gain' : r.wy === 0 ? 'No gain' : '<span class="crd-dim">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
    var egc = egCheckHtml(c.eg);
    var off = c.enabled === false ? '<p class="hint">The switch is off in Owner Settings (Research, Chance of profit on Webull trades): new trades get no chance; the ones already stated are still graded.</p>' : '';
    return '<details class="accuracy-advanced pop-check" id="open-picks-pop"' + (VIEWS.get('open-picks.pop', true) ? ' open' : '') + ' data-pop-check><summary class="accuracy-advanced-summary">Chance of profit check <span class="mm-owner-tag">Owner</span></summary><div class="accuracy-advanced-body">' +
      off + kpis +
      '<p class="hint">' + escapeHtml((c.method && c.method.text) || '') + ' A verdict needs ' + (c.minN || 30) + ' closes; skill above zero means the stated chances beat always saying the base rate.</p>' +
      table + buckets + wb + egc + recent +
      '<p class="hint">The same chances are graded in Quant labs, Calibration, next to every other chance the site states.</p>' +
    '</div></details>';
  }
  var EG_VERDICT = { close: 'Close', over: 'Too hopeful', under: 'Too cautious', few: 'Too few closes yet' };
  function egCheckHtml(e){
    if (!e || !e.n) return '<h4 class="pd-h4">Expected gain check</h4><p class="hint">No trade has an expected gain yet; trades opened from 23 November 2026 carry one.</p>';
    var rows = (e.groups || []).filter(function(g){ return g.id === 'all' || g.n; }).map(function(g){
      return '<tr><td>' + escapeHtml(g.label) + '</td><td class="num">' + g.n + '</td><td class="num">' + popSigned(g.stated, 1) + '</td><td class="num">' + popSigned(g.noEdge, 1) + '</td><td class="num">' + popSigned(g.made, 1) + '</td><td class="num">' + popPct(g.won) + '</td></tr>';
    }).join('');
    var bands = (e.bands || []).map(function(b){
      var lbl = b.lo == null ? 'under ' + b.hi + '%' : b.hi == null ? b.lo + '% or more' : b.lo + '% to ' + b.hi + '%';
      return '<tr><td>' + escapeHtml(lbl) + '</td><td class="num">' + b.n + '</td><td class="num">' + (b.n ? popSigned(b.stated, 1) : '—') + '</td><td class="num">' + (b.n ? popSigned(b.made, 1) : '—') + '</td><td class="num">' + (b.n ? popPct(b.won) : '—') + '</td></tr>';
    }).join('');
    var veh = (e.vehicle || []).filter(function(v){ return v.open || v.closed; }).map(function(v){ return escapeHtml(EG_BETTER[v.better] || v.better) + ' ' + (v.open + v.closed); }).join(', ');
    return '<h4 class="pd-h4">Expected gain check</h4>' +
      '<p class="hint"><b>' + escapeHtml(EG_VERDICT[e.verdict] || e.verdict || '') + '.</b> ' + escapeHtml(e.text || '') + ' ' + e.n + ' trades carry one (' + e.open + ' open).' + (e.rank && e.rank.read && e.closed ? ' Ranking: ' + escapeHtml(e.rank.read) : '') + (e.rank && e.rank.rho != null ? ' Rank correlation of stated against made: ' + e.rank.rho.toFixed(2) + '.' : '') + '</p>' +
      '<div class="acc-tscroll"><table class="acc-qtable pop-table" data-nosort><thead><tr><th>Closed trades</th><th class="num">Closed</th><th class="num" title="The average expected gain at entry, under the forecast">Expected</th><th class="num" title="The same run with no move: the cost of the vehicle">No move</th><th class="num">Made</th><th class="num">Won</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="acc-tscroll"><table class="acc-qtable pop-table" data-nosort><thead><tr><th>Expected at entry</th><th class="num">Closed</th><th class="num">Expected</th><th class="num">Made</th><th class="num">Won</th></tr></thead><tbody>' + bands + '</tbody></table></div>' +
      (e.pop && e.pop.n ? '<p class="hint">Chance of a gain under the forecast: stated ' + popPct(e.pop.stated) + ', won ' + popPct(e.pop.rate) + ' over ' + e.pop.n + ' closes. ' + escapeHtml(e.pop.read || '') + '</p>' : '') +
      (veh ? '<p class="hint">Better vehicle at entry, by the result per dollar of average loss: ' + veh + '.</p>' : '');
  }
  document.addEventListener('toggle', function(e){
    var d = e.target;
    if (d && d.hasAttribute && d.hasAttribute('data-pop-check')) VIEWS.set('open-picks.pop', !!d.open);
  }, true);
`;
}

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
    out.push('<p class="pop-line pop-sub">Set once when the trade opened and never changed. Not modeled: thesis, news and earnings exits, gaps inside a day, and any edge the setup really has (which is what the check below measures).' + (s.res ? ' Outcome: ' + (s.res.y === 1 ? 'closed with a gain' : s.res.y === 0 ? 'closed without a gain' : 'not counted') + (s.res.pnl != null ? ' (' + popSigned(s.res.pnl, 1) + ')' : '') + '.' : '') + '</p>');
    return '<div class="pop-why">' + out.join('') + '</div>';
  }
  // A card line: the chance and a Why that opens in place.
  function popChipHtml(t){
    var s = t && t.pop;
    if (!s || !HAS_OWNER_ACCESS) return '';
    return '<details class="pop-chip"><summary><span class="pop-lbl">Chance of profit</span> <b class="' + popCls(s.p) + '">' + popPct(s.p) + '</b> <small>model ' + popPct(s.m) + ' · record ' + popPct(s.r) + '</small> <span class="pop-open">Why</span></summary>' + popWhyHtml(s) + '</details>';
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
    var off = c.enabled === false ? '<p class="hint">The switch is off in Owner Settings (Research, Chance of profit on Webull trades): new trades get no chance; the ones already stated are still graded.</p>' : '';
    return '<details class="accuracy-advanced pop-check" id="open-picks-pop"' + (VIEWS.get('open-picks.pop', true) ? ' open' : '') + ' data-pop-check><summary class="accuracy-advanced-summary">Chance of profit check <span class="mm-owner-tag">Owner</span></summary><div class="accuracy-advanced-body">' +
      off + kpis +
      '<p class="hint">' + escapeHtml((c.method && c.method.text) || '') + ' A verdict needs ' + (c.minN || 30) + ' closes; skill above zero means the stated chances beat always saying the base rate.</p>' +
      table + buckets + wb + recent +
      '<p class="hint">The same chances are graded in Quant labs, Calibration, next to every other chance the site states.</p>' +
    '</div></details>';
  }
  document.addEventListener('toggle', function(e){
    var d = e.target;
    if (d && d.hasAttribute && d.hasAttribute('data-pop-check')) VIEWS.set('open-picks.pop', !!d.open);
  }, true);
`;
}

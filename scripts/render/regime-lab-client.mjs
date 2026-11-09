// Owner Lab: the Regime Lab view (2026-11-09). Renders the Owner-only
// regime-lab.json written by every full bake (lib/regime-lab/payload.mjs):
// today's market label with its six-cell grid, the label history, per-stock
// labels, the shadow playbook books beside the live record, today's risk
// scores and stop ladder, the headline oracle, the AI-grader-by-cell read,
// the F1-F22 test catalog and the G1-G10 guards. Pasted into the app.js IIFE
// after renderEvidenceJs(), so it reuses the evb* formatters, escapeHtml, $,
// dataUrl, quantFetchJson and chHoverAttr from that scope. ES5 only.
export function renderRegimeLabJs() {
  return `
  // ---- Owner Lab: Regime Lab -------------------------------------------------
  var rglState = { data: null, loading: false, fetchedAt: 0, error: null };
  var RGL_CHARS = [['up', 'Trending up'], ['chop', 'Choppy'], ['down', 'Trending down']];
  var RGL_ERAS = [['calm', 'Calm'], ['stressed', 'Stressed']];
  var RGL_STATUS = {
    'not-run': ['Not run yet', 'evb-s-wait'], waiting: ['Waiting for data', 'evb-s-wait'], collecting: ['Collecting', 'evb-s-collect'], ready: ['Ready to read', 'evb-s-ready'],
    pass: ['Passed', 'evb-s-pass'], fail: ['Failed', 'evb-s-fail'], inconclusive: ['No clear answer', 'evb-s-unclear'], ok: ['Read', 'evb-s-ready'], policy: ['Standing rule', 'evb-s-wait'], 'n/a': ['Not applicable', 'evb-s-wait']
  };
  function rglPill(status){ var s = RGL_STATUS[status] || RGL_STATUS.waiting; return '<span class="evb-pill ' + s[1] + '">' + s[0] + '</span>'; }
  function rglNum(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d); }
  function rglPts(v, d){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d); }
  function rglSign(v){ return v == null || !isFinite(v) ? '' : v > 0 ? 'sig-pos' : v < 0 ? 'sig-neg' : ''; }
  function rglCap(s){ s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
  function rglEt(iso){ var t = Date.parse(iso || ''); return isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'; }
  function rglCellName(d, id){ return d && d.cells && d.cells.labels && d.cells.labels[id] ? d.cells.labels[id] : rglCap(id); }
  function rglEraName(era){ return { calm: 'Calm (VIX under 15)', normal: 'Normal (VIX 15 to 20)', elevated: 'Elevated (VIX 20 to 30)', crisis: 'Crisis (VIX 30+)' }[era] || rglCap(era); }
  function rglTable(head, body, cls){ return '<div class="acc-tscroll"><table class="acc-qtable evb-table ' + (cls || '') + '" data-nosort>' + head + '<tbody>' + body + '</tbody></table></div>'; }
  function rglSection(id, title, body){ return '<section class="evb-section rgl-section" id="' + id + '"><h3>' + title + '</h3>' + body + '</section>'; }
  function rglKv(read, max){
    if (!read || typeof read !== 'object') return '';
    var out = [];
    Object.keys(read).forEach(function(k){
      if (out.length >= (max || 6)) return;
      var v = read[k];
      if (v == null) return;
      if (typeof v === 'number') out.push(escapeHtml(k) + ' ' + (Math.abs(v) >= 100 ? rglNum(v, 0) : Math.abs(v) < 1 ? rglNum(v, 3) : rglNum(v, 1)));
      else if (typeof v === 'string' || typeof v === 'boolean') out.push(escapeHtml(k) + ' ' + escapeHtml(String(v)));
    });
    return out.join(' · ');
  }

  // Today's market: the six-cell grid with the live cell highlighted, the era
  // and character behind it, what the label would switch to, the inputs.
  function rglTodayHtml(d){
    var t = d.today;
    if (!t) return '<p class="hint">No market label yet: the lab needs about 300 SPY sessions in the shared history cache. The next full build fills it.</p>';
    var shares = d.cells && d.cells.shares ? d.cells.shares : {};
    var live = d.liveByCell || {};
    var grid = '<div class="rgl-grid" role="table" aria-label="Six market cells">' +
      '<div class="rgl-grid-head" role="row"><span role="columnheader"></span>' + RGL_ERAS.map(function(e){ return '<span role="columnheader">' + e[1] + '</span>'; }).join('') + '</div>' +
      RGL_CHARS.map(function(c){
        return '<div class="rgl-grid-row" role="row"><span class="rgl-grid-label" role="rowheader">' + c[1] + '</span>' + RGL_ERAS.map(function(e){
          var id = c[0] + '-' + e[0], isNow = t.cell === id, isNext = t.transition && t.pending === id;
          var rec = shares.recent60 && shares.recent60[id] != null ? shares.recent60[id] : null;
          var lv = live[id] || null;
          var pbId = (d.playbooks || []).filter(function(p){ return (p.cells || []).indexOf(id) >= 0 && !p.baseline; })[0];
          return '<div class="rgl-cell' + (isNow ? ' is-now' : '') + (isNext ? ' is-next' : '') + '" role="cell" data-cell="' + id + '">' +
            '<div class="rgl-cell-name">' + escapeHtml(rglCellName(d, id)) + (isNow ? ' <span class="evb-pill evb-s-ready">now</span>' : isNext ? ' <span class="evb-pill evb-s-collect">pending</span>' : '') + '</div>' +
            '<div class="rgl-cell-meta">' + (rec != null ? rec + ' of the last 60 sessions' : 'no sessions yet') + '</div>' +
            '<div class="rgl-cell-meta">Playbook: ' + escapeHtml(pbId ? pbId.name : 'same rules') + '</div>' +
            '<div class="rgl-cell-meta">Live record: ' + (lv && lv.n ? lv.n + ' decided, ' + evbRate(lv.winPct) + ' win, ' + rglPts(lv.avgPnl) + '% avg' : 'no decided trades') + '</div>' +
          '</div>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    var inp = t.inputs || {}, q = inp.quality || {}, corr = inp.corr || {}, ev = inp.eventLoad || null, votes = inp.trendVotes || {};
    var why = t.why || {};
    var facts = [
      ['Volatility era', rglEraName(t.era) + (why.era ? ' — ' + why.era : '')],
      ['Character', rglCap(t.character) + (why.character ? ' — ' + why.character : '')],
      ['Confirmation', t.transition ? 'In transition: the raw read is ' + escapeHtml(rglCellName(d, t.pending)) + '; it needs ' + (t.stats && t.stats.confirm || 2) + ' sessions in a row to switch.' : 'Confirmed' + (t.daysSinceSwitch != null ? ', ' + t.daysSinceSwitch + ' session' + (t.daysSinceSwitch === 1 ? '' : 's') + ' since the last switch' : '') + (t.lastSwitch ? ' (' + escapeHtml(evbDate(t.lastSwitch)) + ')' : '') + '.'],
      ['VIX / VIX3M', rglNum(inp.vix) + ' / ' + rglNum(inp.vix3m) + (inp.termRatio != null ? ' (ratio ' + rglNum(inp.termRatio, 2) + (inp.termRatio >= 1 ? ', inverted' : '') + ')' : '')],
      ['Realized vol (20d)', inp.rv20 != null ? Math.round(inp.rv20 * 100) + '%' + (inp.rvRankPct != null ? ', ' + ordinalOf(inp.rvRankPct) + ' percentile of its own year' : '') : '—'],
      ['Breadth above 50-day', inp.breadth50 != null ? rglNum(inp.breadth50, 0) + '% of members' : '—'],
      ['Trend votes', ['SPY', 'QQQ', 'IWM', 'breadth'].filter(function(k){ return votes[k] != null; }).map(function(k){ return k + ' ' + (votes[k] > 0 ? '+1' : votes[k] < 0 ? '−1' : '0'); }).join(', ') || '—'],
      ['Trend quality', q.quality != null ? rglNum(q.quality, 2) + ' (efficiency ' + rglNum(q.er, 2) + ', ADX ' + rglNum(q.adx, 0) + ', follow-through ' + rglNum(q.follow, 2) + ')' : '—'],
      ['Correlation', corr.avgCorr != null ? 'average pair correlation ' + rglNum(corr.avgCorr, 2) + (corr.state ? ', ' + corr.state : '') + (corr.dispersion != null ? ', dispersion ' + rglNum(corr.dispersion, 3) : '') : '—'],
      ['Week ahead', ev ? rglCap(ev.level) + ' event load: ' + ev.macro + ' macro date' + (ev.macro === 1 ? '' : 's') + ', ' + ev.earnings + ' member earnings (' + rglNum(ev.earningsPct, 0) + '% of the universe)' + (ev.macroEvents && ev.macroEvents.length ? ' — ' + ev.macroEvents.map(function(e){ return escapeHtml(e.label) + ' ' + escapeHtml(evbDate(e.date)); }).join(', ') : '') : '—'],
      ['Hidden-Markov check', t.hmm ? (t.hmm.agrees ? 'Agrees' : 'Disagrees') + ': ' + (t.hmm.stressed ? 'stressed' : 'calm') + ' state, ' + evbRate(t.hmm.probStressed != null ? t.hmm.probStressed * 100 : null) + ' chance of stress' : 'not fitted this build'],
      ['Label stability', t.stats && t.stats.flipsPerYear != null ? rglNum(t.stats.flipsPerYear) + ' switches a year after confirmation (' + rglNum(t.stats.rawFlipsPerYear) + ' raw), about ' + rglNum(t.stats.avgLagDays) + ' day' + (t.stats.avgLagDays === 1 ? '' : 's') + ' late on average' : '—'],
      ['Cycle', t.cycle ? ['policy', 'credit', 'market'].map(function(k){ return k + ' ' + escapeHtml(String(t.cycle[k] || '—')); }).join(', ') + (t.cycle.quadrant ? ' (' + escapeHtml(t.cycle.quadrant) + ')' : '') : 'macro context not on this build'],
      ['Leadership', t.leadership ? escapeHtml(t.leadership) : '—']
    ];
    var factsHtml = '<dl class="rgl-facts">' + facts.map(function(f){ return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('') + '</dl>';
    var pb = t.playbook ? (d.playbooks || []).filter(function(p){ return p.id === t.playbook; })[0] : null;
    var inForce = '<p class="evb-note"><strong>Playbook in force (paper):</strong> ' + escapeHtml(pb ? pb.name : rglCap(t.playbook)) + (pb && pb.note ? ' — ' + escapeHtml(pb.note) : '') +
      ' · <strong>Era stop ladder:</strong> ' + rglNum(t.ladderStop, 0) + '% (live rule −50%)' +
      (t.brakes ? ' · <strong>Book brakes:</strong> at most ' + t.brakes.maxOpen + ' open, ' + t.brakes.themeCap + ' per theme, pause after ' + t.brakes.dailyLossLimitTrades + ' stops in a day' : '') + '</p>';
    return '<p class="evb-lead">' + escapeHtml(rglCellName(d, t.cell)) + ' as of the ' + escapeHtml(evbDate(t.date)) + ' close' + (t.transition ? ', in transition' : '') + '.</p>' + grid + inForce + factsHtml;
  }

  // The label history: one thin column per session, era on top, character
  // below, with the VIX line over it. Hover gives the date, cell and VIX.
  function rglHistoryHtml(d){
    var rows = d.history || [];
    if (rows.length < 20) return '<p class="hint">The history strip fills as sessions accumulate (' + rows.length + ' so far).</p>';
    var show = rows.slice(-260);
    var W = 760, H = 96, L = 36, R = 8, T = 6, bandH = 14, gap = 3, lineTop = T + bandH * 2 + gap * 2 + 4, lineH = H - lineTop - 14;
    var n = show.length, cw = (W - L - R) / n;
    var vix = show.map(function(r){ return r.vix; }).filter(function(v){ return v != null && isFinite(v); });
    var vMax = Math.max(40, Math.max.apply(null, vix.length ? vix : [40])), vMin = Math.min(10, Math.min.apply(null, vix.length ? vix : [10]));
    var eraCls = function(e){ return e === 'crisis' ? 'rgl-e-crisis' : e === 'elevated' ? 'rgl-e-elevated' : e === 'normal' ? 'rgl-e-normal' : 'rgl-e-calm'; };
    var chCls = function(c){ return c === 'up' ? 'rgl-c-up' : c === 'down' ? 'rgl-c-down' : 'rgl-c-chop'; };
    var rects = '', pts = [], line = [];
    show.forEach(function(r, i){
      var x = L + i * cw;
      rects += '<rect class="' + eraCls(r.era) + '" x="' + x.toFixed(2) + '" y="' + T + '" width="' + Math.max(cw, 0.8).toFixed(2) + '" height="' + bandH + '"/>';
      rects += '<rect class="' + chCls(r.ch) + (r.tr ? ' is-tr' : '') + '" x="' + x.toFixed(2) + '" y="' + (T + bandH + gap) + '" width="' + Math.max(cw, 0.8).toFixed(2) + '" height="' + bandH + '"/>';
      if (r.vix != null && isFinite(r.vix)) {
        var y = lineTop + lineH - (r.vix - vMin) / (vMax - vMin) * lineH;
        line.push((x + cw / 2).toFixed(1) + ',' + y.toFixed(1));
        pts.push([x + cw / 2, y, evbDate(r.d) + '\\n' + rglCellName(d, r.cell) + (r.tr ? ' (pending ' + rglCellName(d, r.raw || r.cell) + ')' : '') + '\\nVIX ' + rglNum(r.vix) + (r.br != null ? ' · breadth ' + rglNum(r.br, 0) + '%' : '') + (r.hmm != null ? ' · HMM ' + (r.hmm ? 'stressed' : 'calm') : '') + (r.ev ? ' · ' + r.ev + ' week' : '')]);
      }
    });
    var switches = show.map(function(r, i){ return r.sw ? '<line class="rgl-sw" x1="' + (L + i * cw).toFixed(2) + '" x2="' + (L + i * cw).toFixed(2) + '" y1="' + T + '" y2="' + (T + bandH * 2 + gap) + '"/>' : ''; }).join('');
    var labels = '<text class="rgl-axis" x="2" y="' + (T + bandH - 3) + '">Era</text><text class="rgl-axis" x="2" y="' + (T + bandH * 2 + gap - 3) + '">Trend</text><text class="rgl-axis" x="2" y="' + (lineTop + 10) + '">VIX</text>' +
      '<text class="rgl-axis" x="' + L + '" y="' + (H - 2) + '">' + escapeHtml(evbDate(show[0].d)) + '</text><text class="rgl-axis" x="' + (W - R) + '" y="' + (H - 2) + '" text-anchor="end">' + escapeHtml(evbDate(show[n - 1].d)) + '</text>';
    var legend = '<div class="rgl-legend"><span><i class="rgl-e-calm"></i>Calm</span><span><i class="rgl-e-normal"></i>Normal</span><span><i class="rgl-e-elevated"></i>Elevated</span><span><i class="rgl-e-crisis"></i>Crisis</span><span class="rgl-legend-gap"></span><span><i class="rgl-c-up"></i>Up</span><span><i class="rgl-c-chop"></i>Chop</span><span><i class="rgl-c-down"></i>Down</span><span><i class="rgl-sw-i"></i>Switch</span></div>';
    var shares = d.cells && d.cells.shares && d.cells.shares.all ? d.cells.shares.all : null;
    var shareLine = shares ? '<p class="evb-note">Across ' + (d.cells.shares.sessions || rows.length) + ' sessions: ' + Object.keys(shares).filter(function(k){ return shares[k]; }).sort(function(a, b){ return shares[b] - shares[a]; }).map(function(k){ return escapeHtml(rglCellName(d, k)) + ' ' + Math.round(shares[k] / Math.max(1, d.cells.shares.sessions || rows.length) * 100) + '%'; }).join(', ') + '.</p>' : '';
    return '<svg class="rgl-strip" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Market label history" ' + chHoverAttr(pts) + '>' + rects + switches + (line.length > 1 ? '<polyline class="rgl-vix" points="' + line.join(' ') + '"/>' : '') + labels + '</svg>' + legend + shareLine;
  }

  // F2: grid labels against the hidden-Markov challenger.
  function rglStabilityHtml(d){
    var s = d.stability;
    if (!s || !s.grid) return '';
    var row = function(name, g){ if (!g) return ''; var sep = g.separation || {}; return '<tr><td>' + name + '</td><td class="num">' + rglNum(g.flipsPerYear) + '</td><td class="num">' + rglNum(g.avgLagDays) + '</td><td class="num">' + (sep.stressedFwdVol != null ? Math.round(sep.stressedFwdVol * 100) + '%' : '—') + '</td><td class="num">' + (sep.calmFwdVol != null ? Math.round(sep.calmFwdVol * 100) + '%' : '—') + '</td><td class="num ' + (sep.ratio >= 1.3 ? 'sig-pos' : '') + '">' + rglNum(sep.ratio, 2) + '</td></tr>'; };
    var head = '<thead><tr><th scope="col">Labeler</th><th scope="col" class="num">Switches / yr</th><th scope="col" class="num">Days late</th><th scope="col" class="num">Next-20d vol, stressed</th><th scope="col" class="num">Next-20d vol, calm</th><th scope="col" class="num">Ratio</th></tr></thead>';
    return rglTable(head, row('Grid (VIX, trend, breadth)', s.grid) + row('Hidden-Markov (2 states on SPY returns)', s.hmm)) +
      '<p class="evb-note">The two agree on stressed-or-calm ' + evbRate(s.agreementPct) + ' of sessions. Preferred: <strong>' + escapeHtml(s.preferred || 'grid') + '</strong>, because ' + escapeHtml(s.why || '') + '. A stressed label earns its name when the next 20 sessions are at least 1.3x as volatile as under the calm label.</p>';
  }

  // F16: the past sessions that look most like today.
  function rglResemblesHtml(d){
    var r = d.resembles;
    if (!r || !r.neighbors || !r.neighbors.length) return '<p class="hint">Needs about 60 labeled sessions before it can find look-alikes.</p>';
    var head = '<thead><tr><th scope="col">Session</th><th scope="col">Cell then</th><th scope="col" class="num">VIX</th><th scope="col" class="num">Distance</th><th scope="col" class="num">SPY next ' + r.horizon + ' sessions</th><th scope="col">Trades in that window</th></tr></thead>';
    var body = r.neighbors.map(function(n){ return '<tr><td>' + escapeHtml(evbDate(n.date)) + (n.through ? ' → ' + escapeHtml(evbDate(n.through)) : '') + '</td><td>' + escapeHtml(rglCellName(d, n.cell)) + (n.era ? ' <span class="evb-q">' + escapeHtml(n.era) + '</span>' : '') + '</td><td class="num">' + rglNum(n.vix) + '</td><td class="num">' + rglNum(n.distance, 2) + '</td><td class="num ' + rglSign(n.spyFwdPct) + '">' + rglPts(n.spyFwdPct, 1) + '%</td><td>' + (n.calls && n.calls.n ? 'calls ' + rglPts(n.calls.avg) + ' (' + n.calls.n + ')' : '') + (n.puts && n.puts.n ? (n.calls && n.calls.n ? ' · ' : '') + 'puts ' + rglPts(n.puts.avg) + ' (' + n.puts.n + ')' : '') + (!(n.calls && n.calls.n) && !(n.puts && n.puts.n) ? '—' : '') + '</td></tr>'; }).join('');
    var sm = r.summary || {};
    return rglTable(head, body) + '<p class="evb-note">On average SPY moved <strong class="' + rglSign(sm.avgSpyFwdPct) + '">' + rglPts(sm.avgSpyFwdPct, 1) + '%</strong> over the next ' + r.horizon + ' sessions after these look-alikes (up ' + evbRate(sm.upShare) + ' of the time). ' + escapeHtml(r.note || '') + '</p>';
  }

  // A10: each tracked stock's own label today.
  function rglStocksHtml(d){
    var st = d.stocks;
    if (!st || !st.rows || !st.rows.length) return '<p class="hint">Stock labels need 60 sessions of bars per name.</p>';
    var c = st.counts || {};
    var rows = st.rows.slice().sort(function(a, b){ return (b.q || 0) - (a.q || 0) || String(a.s).localeCompare(String(b.s)); });
    var head = '<thead><tr><th scope="col">Stock</th><th scope="col">Sector</th><th scope="col">Label</th><th scope="col">Direction</th><th scope="col" class="num">Quality</th><th scope="col" class="num">Efficiency</th><th scope="col" class="num">ADX</th><th scope="col" class="num">Vol rank</th></tr></thead>';
    var body = rows.map(function(r){ return '<tr><td><strong>' + escapeHtml(r.s) + '</strong></td><td>' + escapeHtml(r.sector || '—') + '</td><td>' + (r.label === 'trending' ? '<span class="evb-pill evb-s-pass">Trending</span>' : r.label === 'choppy' ? '<span class="evb-pill evb-s-unclear">Choppy</span>' : '—') + '</td><td>' + (r.dir === 'up' ? '<span class="sig-pos">▲ up</span>' : r.dir === 'down' ? '<span class="sig-neg">▼ down</span>' : '—') + '</td><td class="num">' + rglNum(r.q, 2) + '</td><td class="num">' + rglNum(r.er, 2) + '</td><td class="num">' + rglNum(r.adx, 0) + '</td><td class="num">' + (r.rvRank != null ? ordinalOf(r.rvRank) : '—') + '</td></tr>'; }).join('');
    return '<p class="evb-note"><strong>' + (c.trending || 0) + '</strong> of ' + (c.total || rows.length) + ' names are trending (' + (c.up || 0) + ' up, ' + (c.down || 0) + ' down) and <strong>' + (c.choppy || 0) + '</strong> are choppy. A trending name is ridden with the trend; a choppy one is faded near its 20-day range (F17 tests whether that beats one rule for all).</p>' +
      '<details class="rgl-details"><summary>Every name</summary>' + rglTable(head, body, 'rgl-stocks') + '</details>';
  }

  // B1-B8: the playbooks and the shadow books beside the live record.
  function rglBooksHtml(d){
    var pbs = d.playbooks || [], b = d.books || {};
    var pbHead = '<thead><tr><th scope="col">Playbook</th><th scope="col">Cells</th><th scope="col">Sides</th><th scope="col" class="num">Size</th><th scope="col" class="num">Stop</th><th scope="col" class="num">Target</th><th scope="col" class="num">Max open</th><th scope="col">Rule</th></tr></thead>';
    var pbBody = pbs.map(function(p){ return '<tr><td><strong>' + escapeHtml(p.name) + '</strong>' + (p.item ? ' <span class="evb-q">' + escapeHtml(p.item) + '</span>' : '') + '</td><td>' + ((p.cells || []).length === 6 ? 'every cell' : (p.cells || []).length ? p.cells.map(function(c){ return escapeHtml(rglCellName(d, c)); }).join(', ') : 'while the label is in transition') + '</td><td>' + ((p.sides || []).join(', ') || 'none') + '</td><td class="num">' + (p.size != null ? (p.size === 0 ? '0' : p.size + 'x') : 'by era') + '</td><td class="num">' + (p.stopPct != null ? p.stopPct + '%' : p.maxOpen === 'brakes' ? 'ladder' : '—') + '</td><td class="num">' + (p.tpPct != null ? '+' + p.tpPct + '%' : '—') + '</td><td class="num">' + (p.maxOpen === 'brakes' ? 'brakes' : p.maxOpen != null ? p.maxOpen : '—') + '</td><td><span class="evb-q">' + escapeHtml(p.note || '') + '</span></td></tr>'; }).join('');
    var strategies = b.strategies || [];
    var sHead = '<thead><tr><th scope="col">Book</th><th scope="col" class="num">Open</th><th scope="col" class="num">Open P&L</th><th scope="col" class="num">Decided</th><th scope="col" class="num">Win rate</th><th scope="col" class="num">Avg P&L</th><th scope="col" class="num">Median</th><th scope="col" class="num">Size-weighted pts</th></tr></thead>';
    var sRow = function(label, r, strong){ return '<tr' + (strong ? ' class="rgl-row-strong"' : '') + '><td>' + label + '</td><td class="num">' + (r.open != null ? r.open : '—') + '</td><td class="num ' + rglSign(r.openPnl) + '">' + (r.openPnl != null ? rglPts(r.openPnl) + '%' : '—') + '</td><td class="num">' + (r.n || 0) + '</td><td class="num">' + evbRate(r.winPct) + '</td><td class="num ' + rglSign(r.avgPnl) + '">' + (r.avgPnl != null ? rglPts(r.avgPnl) + '%' : '—') + '</td><td class="num">' + (r.medianPnl != null ? rglPts(r.medianPnl) + '%' : '—') + '</td><td class="num ' + rglSign(r.totalPts) + '">' + (r.totalPts != null ? rglPts(r.totalPts, 0) : '—') + '</td></tr>'; };
    var sBody = strategies.map(function(s){ return sRow('<strong>' + escapeHtml(s.name) + '</strong>' + (s.baseline ? ' <span class="evb-pill evb-s-wait">baseline</span>' : '') + (s.judged ? '' : ' <span class="evb-q">' + (s.n || 0) + ' of ' + (s.need || 30) + ' decided</span>'), s, s.id === 'switch'); }).join('') + (b.live ? sRow('<em>' + escapeHtml(b.live.label || 'Live Top Picks record') + '</em>', b.live) : '');
    var verdict = b.switchBeatsBaseline == null ? 'The switch book and the baseline each need ' + (strategies[0] && strategies[0].need || 30) + ' decided paper trades before they are compared (G8: the null hypothesis is one brake, same rules everywhere).' : b.switchBeatsBaseline ? 'So far the switch book beats the same-rules baseline on average P&L.' : 'So far the switch book does not beat the same-rules baseline.';
    var sw = strategies.filter(function(s){ return s.id === 'switch'; })[0], base = strategies.filter(function(s){ return s.baseline; })[0];
    var cellHead = '<thead><tr><th scope="col">Cell</th><th scope="col" class="num">Baseline n</th><th scope="col" class="num">Baseline avg</th><th scope="col" class="num">Switch n</th><th scope="col" class="num">Switch avg</th><th scope="col">Switch playbook</th></tr></thead>';
    var cellBody = (d.cells && d.cells.ids || []).map(function(c){ var bc = base && base.byCell ? base.byCell[c] : null, sc = sw && sw.byCell ? sw.byCell[c] : null; var pb = pbs.filter(function(p){ return (p.cells || []).indexOf(c) >= 0 && !p.baseline; })[0]; return '<tr><td>' + escapeHtml(rglCellName(d, c)) + '</td><td class="num">' + (bc ? bc.n : 0) + '</td><td class="num ' + rglSign(bc && bc.avgPnl) + '">' + (bc && bc.avgPnl != null ? rglPts(bc.avgPnl) + '%' : '—') + '</td><td class="num">' + (sc ? sc.n : 0) + '</td><td class="num ' + rglSign(sc && sc.avgPnl) + '">' + (sc && sc.avgPnl != null ? rglPts(sc.avgPnl) + '%' : '—') + '</td><td>' + escapeHtml(pb ? pb.name : 'same rules') + '</td></tr>'; }).join('');
    return '<div class="evb-sub"><h4>The playbooks</h4></div>' + rglTable(pbHead, pbBody) +
      '<div class="evb-sub"><h4>Shadow books since ' + escapeHtml(b.since ? evbDate(String(b.since).slice(0, 10)) : 'the first Top Picks run after deploy') + ' (' + (b.runs || 0) + ' run' + (b.runs === 1 ? '' : 's') + ')</h4></div>' + (strategies.length ? rglTable(sHead, sBody) : '<p class="hint">The books open at the next 11:00 or 15:30 ET Top Picks run.</p>') +
      '<p class="evb-note">' + verdict + ' ' + escapeHtml(b.note || '') + '</p>' +
      (base || sw ? '<div class="evb-sub"><h4>By cell</h4></div>' + rglTable(cellHead, cellBody) : '');
  }

  // E1-E9: today's risk scores on the open trades and the stop ladder.
  function rglRiskHtml(d){
    var r = d.risk;
    if (!r) return '';
    var ladder = r.ladder || {};
    var ladderHtml = '<div class="rgl-ladder">' + ['calm', 'normal', 'elevated', 'crisis'].map(function(e){ return '<span class="rgl-ladder-step' + (r.era === e ? ' is-now' : '') + '"><b>' + rglCap(e) + '</b> ' + (ladder[e] != null ? ladder[e] + '%' : '—') + '</span>'; }).join('') + '</div>';
    var head = '<thead><tr><th scope="col">Trade</th><th scope="col">Structure</th><th scope="col" class="num">Risk 1-10</th><th scope="col" class="num">Vol rank</th><th scope="col" class="num">Days left</th><th scope="col">Event inside</th><th scope="col" class="num">P&L</th><th scope="col" class="num">Stop now</th><th scope="col" class="num">Ladder stop</th></tr></thead>';
    var body = (r.rows || []).map(function(t){ return '<tr><td><strong>' + escapeHtml(t.symbol) + '</strong> ' + escapeHtml(t.side || '') + (t.id ? '<div class="evb-q">' + escapeHtml(t.id) + '</div>' : '') + '</td><td>' + escapeHtml(t.structure || 'long') + '</td><td class="num"><span class="rgl-risk rgl-risk-' + Math.min(10, Math.max(1, Math.round(t.score || 1))) + '">' + rglNum(t.score, 1) + '</span></td><td class="num">' + (t.volRank != null ? ordinalOf(t.volRank) : '—') + '</td><td class="num">' + (t.dteLeft != null ? t.dteLeft : '—') + '</td><td>' + (t.eventInWindow ? '<span class="evb-pill evb-s-ready">earnings</span>' : '—') + '</td><td class="num ' + rglSign(t.pnl) + '">' + (t.pnl != null ? rglPts(t.pnl) + '%' : '—') + '</td><td class="num">' + (t.stopNow != null ? t.stopNow + '%' : '—') + '</td><td class="num ' + (t.tightens ? 'sig-neg' : '') + '">' + (t.ladderStop != null ? t.ladderStop + '%' : '—') + (t.tightens ? ' <span class="evb-q">would tighten</span>' : '') + '</td></tr>'; }).join('');
    return '<p class="evb-note">Risk score (E1): structure x era x the stock\\'s own volatility rank x time to expiry, plus 1.5 when an earnings print falls inside the hold. The ladder (E2) is the stop the lab would use in the current era; the live record keeps −50% until the harness proves a change (F5, F8).</p>' + ladderHtml +
      (r.rows && r.rows.length ? rglTable(head, body) + '<p class="evb-note">Average risk ' + rglNum(r.avgScore) + ' across ' + r.openNow + ' open trade' + (r.openNow === 1 ? '' : 's') + '; the era brakes allow ' + r.maxOpen + (r.overCapacity ? ' — <strong class="sig-neg">over capacity</strong>' : '') + '.</p>' : '<p class="hint">No open Top Picks trades to score.</p>');
  }

  // F10: the book brakes replayed on the live record.
  function rglBrakesHtml(d){
    var b = d.brakes;
    if (!b || !b.n) return '<p class="hint">Needs decided Top Picks trades.</p>';
    var row = function(label, g){ return '<tr><td>' + label + '</td><td class="num">' + (g ? g.n : 0) + '</td><td class="num">' + evbRate(g && (g.winPct != null ? g.winPct : g.hit)) + '</td><td class="num ' + rglSign(g && g.avg) + '">' + (g && g.avg != null ? rglPts(g.avg) + '%' : '—') + '</td></tr>'; };
    var head = '<thead><tr><th scope="col">Trades</th><th scope="col" class="num">n</th><th scope="col" class="num">Win rate</th><th scope="col" class="num">Avg P&L</th></tr></thead>';
    var byWhy = b.refused && b.refused.byWhy ? Object.keys(b.refused.byWhy).map(function(k){ return row('Refused: ' + escapeHtml(k), b.refused.byWhy[k]); }).join('') : '';
    var cluster = b.cluster ? '<p class="evb-note">The ' + escapeHtml(evbDate(b.cluster.date)) + ' cluster: ' + b.cluster.n + ' trade' + (b.cluster.n === 1 ? '' : 's') + ' opened' + (b.cluster.n ? ', averaging ' + rglPts(b.cluster.avgPnl) + '%' : '') + (b.cluster.refused ? '; the brakes would have refused ' + b.cluster.refused : '; the brakes would have refused none') + (b.cluster.byTheme && b.cluster.byTheme.length ? ' (' + b.cluster.byTheme.map(function(t){ return escapeHtml(t.theme) + ' ' + t.n; }).join(', ') + ')' : '') + '.</p>' : '';
    return rglTable(head, row('All decided', b.all) + row('Kept by the brakes', b.kept) + row('Refused by the brakes', b.refused) + byWhy) + cluster + '<p class="evb-note">' + rglPill(b.verdict === 'insufficient' ? 'collecting' : b.verdict) + ' ' + escapeHtml(b.rule || '') + '</p>';
  }

  // D1-D8: the headline oracle, its own panel (G7).
  function rglOracleHtml(d){
    var o = d.oracle;
    if (!o || !o.book) return '<p class="hint">The oracle replays after the first full build with the earnings store and the long SPY history on hand.</p>';
    var names = { earnings: 'Earnings prints', fomc: 'FOMC decisions', cpi: 'CPI releases', jobs: 'Jobs reports' };
    var types = o.types || {};
    var head = '<thead><tr><th scope="col">Headline type</th><th scope="col" class="num">Events</th><th scope="col" class="num">With a side</th><th scope="col" class="num">Hit at open</th><th scope="col" class="num">Hit at close</th><th scope="col" class="num">Already priced</th><th scope="col" class="num">Avg move</th><th scope="col">Best exit</th><th scope="col">Best structure</th><th scope="col" class="num">Break-even accuracy</th><th scope="col" class="num">Gap past −50%</th></tr></thead>';
    var body = Object.keys(names).filter(function(k){ return types[k]; }).map(function(k){ var t = types[k]; var best = t.best ? t.structures && t.structures[t.best] ? escapeHtml(t.best) + ' (' + rglPts(t.structures[t.best].avgNetClose) + ' pts)' : escapeHtml(t.best) : '—'; var be = t.noisy && t.noisy.long ? t.noisy.long.breakEvenAccuracyPct : null; return '<tr><td><strong>' + names[k] + '</strong></td><td class="num">' + t.n + '</td><td class="num">' + t.signed + '</td><td class="num">' + evbRate(t.hit && t.hit.open) + '</td><td class="num">' + evbRate(t.hit && t.hit.close) + '</td><td class="num">' + evbRate(t.alreadyPricedPct) + '</td><td class="num">' + (t.avgAbsMove != null ? rglNum(t.avgAbsMove, 1) + '%' : '—') + '</td><td>' + escapeHtml(t.bestExit || '—') + '</td><td>' + best + '</td><td class="num">' + (be != null ? be + '%' : '—') + '</td><td class="num">' + evbRate(t.risk && t.risk.gapPastStopPct) + '</td></tr>'; }).join('');
    var ceiling = o.ceiling && o.ceiling.oracle ? '<p class="evb-note"><strong>Ceiling vs the live record:</strong> a single option on the headline\\'s side, out three sessions later, averaged ' + rglPts(o.ceiling.oracle.avgNet) + ' pts over ' + o.ceiling.oracle.n + ' events' + (o.ceiling.live && o.ceiling.live.n ? '; the live record averaged ' + rglPts(o.ceiling.live.avgPnl) + '% over ' + o.ceiling.live.n + ' trades' + (o.ceiling.sharePct != null ? ' (' + o.ceiling.sharePct + '% of the ceiling)' : '') : '') + '. ' + escapeHtml(o.ceiling.note || '') + '</p>' : '';
    var vs = o.engineVsOracle && o.engineVsOracle.matched ? '<p class="evb-note"><strong>Engine vs oracle (F14):</strong> ' + o.engineVsOracle.matched + ' live event trade' + (o.engineVsOracle.matched === 1 ? '' : 's') + ' matched a headline: ' + Object.keys(o.engineVsOracle.byType || {}).map(function(k){ var v = o.engineVsOracle.byType[k]; return escapeHtml(k) + ' agreed ' + evbRate(v && v.agreePct) + ' (' + (v ? v.n : 0) + ')'; }).join(', ') + '.</p>' : '<p class="evb-note"><strong>Engine vs oracle (F14)</strong> waits for ' + (d.catalog && d.catalog.rows ? (d.catalog.rows.filter(function(r){ return r.id === 'F14'; })[0] || {}).needs && (d.catalog.rows.filter(function(r){ return r.id === 'F14'; })[0]).needs.n : 20) + ' live event trades that match a headline in the book.</p>';
    var book = o.book;
    return '<p class="evb-note">' + book.rows + ' rule-tagged headlines' + (book.first ? ', ' + escapeHtml(evbDate(book.first)) + ' to ' + escapeHtml(evbDate(book.last)) : '') + ' (' + Object.keys(book.byType || {}).map(function(k){ return book.byType[k] + ' ' + k; }).join(', ') + '). A headline\\'s side comes from the number alone: the EPS surprise sign, the rate decision against a hold, CPI against the prior month, payrolls against the prior month. ' + escapeHtml(book.caveat || '') + '</p>' +
      rglTable(head, body) +
      '<p class="evb-note">"Already priced" is the share of headlines where the stock closed against the headline\\'s side. Break-even accuracy is how often the oracle has to be right for the single option to make money after costs, given what the wrong side loses. ' + escapeHtml(o.modeled && o.modeled.note || '') + '</p>' + ceiling + vs +
      '<p class="evb-note"><strong>G7:</strong> these numbers live on this panel only and never enter the Track Record.</p>';
  }

  // F20: the AI grader inside each cell.
  function rglGraderHtml(d){
    var g = d.grader;
    if (!g || !g.byCell) return '';
    var head = '<thead><tr><th scope="col">Cell</th><th scope="col" class="num">Buy now</th><th scope="col" class="num">Buy-now hit</th><th scope="col" class="num">Wait</th><th scope="col" class="num">Wait hit</th><th scope="col" class="num">Grader adds</th></tr></thead>';
    var body = Object.keys(g.byCell).map(function(c){ var x = g.byCell[c]; return '<tr><td>' + escapeHtml(rglCellName(d, c)) + '</td><td class="num">' + (x.buyNow ? x.buyNow.n : 0) + '</td><td class="num">' + evbRate(x.buyNow && x.buyNow.hit) + '</td><td class="num">' + (x.wait ? x.wait.n : 0) + '</td><td class="num">' + evbRate(x.wait && x.wait.hit) + '</td><td class="num ' + rglSign(x.graderAdds) + '">' + (x.graderAdds != null ? rglPts(x.graderAdds, 2) + ' pts' : '<span class="evb-q">needs 10 of each</span>') + '</td></tr>'; }).join('');
    return '<p class="evb-note">' + (g.graded || 0) + ' graded names have a 10-session outcome and a label from the day before their run. ' + escapeHtml(g.rule || '') + '</p>' + rglTable(head, body);
  }

  // The F1-F22 catalog with each test's status, source and read.
  function rglCatalogHtml(d){
    var c = d.catalog;
    if (!c || !c.rows) return '';
    var counts = c.counts || {};
    var chips = Object.keys(RGL_STATUS).filter(function(k){ return counts[k]; }).map(function(k){ return '<span class="evb-chip ' + RGL_STATUS[k][1] + '">' + counts[k] + ' ' + RGL_STATUS[k][0].toLowerCase() + '</span>'; }).join('');
    var research = d.research || null;
    var lead = '<div class="evb-head"><div class="evb-chips">' + chips + '</div><span class="evb-asof">' + (c.trials != null ? c.trials + ' setups tried in research (G3)' : 'no research run yet') + (research && research.ranAt ? ' · research ' + escapeHtml(evbDate(String(research.ranAt).slice(0, 10))) : '') + '</span></div>';
    var holds = c.holdoutRuns && Object.keys(c.holdoutRuns).length ? '<p class="evb-note">Holdout windows run: ' + Object.keys(c.holdoutRuns).map(function(k){ return escapeHtml(k) + ' on ' + escapeHtml(evbDate(c.holdoutRuns[k])); }).join(', ') + '.</p>' : '<p class="evb-note">The two holdout windows (the 2026 slide, the 2022 bear) stay locked until a rule set is final; they run once.</p>';
    var head = '<thead><tr><th scope="col">Test</th><th scope="col">Lane</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Runs</th><th scope="col">Read so far</th></tr></thead>';
    var body = c.rows.map(function(r){
      var tags = (r.priceHalf ? ' <span class="evb-pill evb-s-wait" title="Price half only: no AI grader, news, fundamentals, flow or real implied volatility before 2026-05-25">price half</span>' : '') + (r.holdoutLocked ? ' <span class="evb-pill evb-s-wait">holdout locked</span>' : '');
      var ev = r.needs ? '<div class="evb-prog">' + evbBar(r.have, r.needs.n) + '<div class="evb-q">' + ((r.have || 0) >= r.needs.n ? (r.have || 0) + ' ' + escapeHtml(String(r.needs.kind || '').replace(/-/g, ' ')) + ' (needs ' + r.needs.n + ')' : (r.have || 0) + ' of ' + r.needs.n + ' ' + escapeHtml(String(r.needs.kind || '').replace(/-/g, ' '))) + '</div></div>' : '—';
      var runs = (r.runBy === 'cli' ? 'Research runner' : r.runBy === 'bake' ? 'Every full build' : 'Both') + '<div class="evb-q">' + ({ now: 'runnable now', 'each-build': 'recomputed each build', archive: 'needs the run archive', nov23: 'Nov 23', dec7: 'Dec 7' }[r.when] || escapeHtml(r.when || '')) + (r.ranAt ? ' · ran ' + escapeHtml(evbDate(String(r.ranAt).slice(0, 10))) : '') + '</div>';
      var read = rglCatalogRead(r);
      return '<tr><td><strong>' + escapeHtml(r.id) + ' ' + escapeHtml(r.name) + '</strong>' + tags + '<div class="evb-q">' + escapeHtml(r.question || '') + '</div><div class="evb-q">Data: ' + escapeHtml(r.data || '') + '</div></td><td>' + escapeHtml(r.laneLabel || r.lane) + '</td><td>' + rglPill(r.status) + (r.source ? '<div class="evb-q">from ' + (r.source === 'bake' ? 'this build' : 'research') + '</div>' : '') + '</td><td>' + ev + '</td><td>' + runs + '</td><td>' + read + (r.note ? '<div class="evb-q">' + escapeHtml(r.note) + '</div>' : '') + '</td></tr>';
    }).join('');
    return lead + holds + rglTable(head, body, 'rgl-catalog');
  }
  function rglCatalogRead(r){
    var x = r.read;
    if (!x) return r.status === 'not-run' ? '<span class="evb-q">Run <code>node scripts/regime-lab.mjs run --tests ' + escapeHtml(r.id) + '</code> on the research machine.</span>' : '<span class="evb-q">—</span>';
    if (typeof x === 'string') return escapeHtml(x);
    switch (r.id) {
      case 'F1': return 'IC trending ' + rglNum(x.trending, 3) + ' vs chop ' + rglNum(x.chop, 3) + (x.all != null ? ' (all ' + rglNum(x.all, 3) + ')' : '');
      case 'F2': return 'Grid ' + rglNum(x.gridFlips) + ' flips/yr, ratio ' + rglNum(x.gridRatio, 2) + ' · HMM ' + rglNum(x.hmmFlips) + ', ratio ' + rglNum(x.hmmRatio, 2) + (x.preferred ? ' · prefer ' + escapeHtml(x.preferred) : '');
      case 'F3': return x.beatBaseline != null ? 'Switch beat same rules in ' + escapeHtml(String(x.beatBaseline)) + ' windows' + (x.switchAvgNet != null ? ' (' + rglPts(x.switchAvgNet) + ' vs ' + rglPts(x.baseAvgNet) + ' pts)' : '') : rglKv(x);
      case 'F4': return x.cashBetter ? 'Cash beats trading in: ' + escapeHtml(String(x.cashBetter)) : 'Trading beats cash in every cell' + (x.worst ? ' (weakest ' + escapeHtml(x.worst) + ')' : '');
      case 'F5': case 'F6': case 'F7': case 'F8': case 'F9': return x.best ? 'Best ' + escapeHtml(x.best) + ' ' + rglPts(x.bestAvgNet) + ' pts vs flat −50 ' + rglPts(x.flatAvgNet) + (x.whipsawPct != null ? ' · whipsaw ' + evbRate(x.whipsawPct) : '') + (x.beat === false ? ' · does not beat the flat stop' : '') : rglKv(x);
      case 'F10': return (x.refused || 0) + ' refused, avg ' + rglPts(x.refusedAvg) + '% vs kept ' + rglPts(x.keptAvg) + '%';
      case 'F11': return 'Hit at close ' + evbRate(x.hitClose) + ' · already priced ' + evbRate(x.alreadyPricedPct);
      case 'F12': return Object.keys(x).map(function(k){ return escapeHtml(k) + ' → ' + escapeHtml(String(x[k] || '—')); }).join(', ');
      case 'F13': return 'Break-even accuracy: ' + Object.keys(x).map(function(k){ return escapeHtml(k) + ' ' + (x[k] != null ? x[k] + '%' : '—'); }).join(', ');
      case 'F14': return Object.keys(x).map(function(k){ return escapeHtml(k) + ' agreed ' + evbRate(x[k] && x[k].agreePct) + ' (' + (x[k] ? x[k].n : 0) + ')'; }).join(', ') || '—';
      case 'F15': return x.oosAvgNet != null ? 'Out of sample ' + rglPts(x.oosAvgNet) + ' pts vs fixed ' + rglPts(x.fixedAvgNet) + (x.trials != null ? ' · ' + x.trials + ' setups' : '') : rglKv(x);
      case 'F16': return x.avgSpyFwdPct != null ? 'Look-alikes: SPY ' + rglPts(x.avgSpyFwdPct, 1) + '% ahead, up ' + evbRate(x.upShare) + (x.bestSide ? ', ' + escapeHtml(x.bestSide) + 's did better' : '') : rglKv(x);
      case 'F17': return x.beatBaseline != null ? 'Beat one rule in ' + escapeHtml(String(x.beatBaseline)) + ' windows (' + rglPts(x.avgNet) + ' vs ' + rglPts(x.baselineAvgNet) + ' pts)' : rglKv(x);
      case 'F18': return ['macro', 'mixed', 'stock-picking'].filter(function(k){ return x[k] != null; }).map(function(k){ return escapeHtml(k) + ' IC ' + rglNum(typeof x[k] === 'object' ? x[k].ic : x[k], 3); }).join(' · ') || rglKv(x);
      case 'F19': return x.heavyAvg != null ? 'Heavy weeks ' + rglPts(x.heavyAvg) + ' vs rest ' + rglPts(x.restAvg) + (x.halfHelps != null ? (x.halfHelps ? ' · half size helps' : ' · half size does not help') : '') : rglKv(x);
      case 'F20': return Object.keys(x).filter(function(k){ return x[k] != null; }).map(function(k){ return escapeHtml(k) + ' ' + rglPts(x[k], 2); }).join(', ') || 'no cell has 10 buy-now and 10 wait names yet';
      case 'F21': return rglKv(x);
      case 'F22': return x.rerun != null ? x.survived + ' of ' + x.rerun + ' survived double costs and a 20% IV crush' : rglKv(x);
      default: return rglKv(x);
    }
  }

  // G1-G10 with each guard's live status.
  function rglGuardsHtml(d){
    var g = d.guards;
    if (!g || !g.guards) return '';
    var head = '<thead><tr><th scope="col">Guard</th><th scope="col">Status</th><th scope="col">Rule</th><th scope="col">Now</th></tr></thead>';
    var body = g.guards.map(function(x){ return '<tr><td><strong>' + escapeHtml(x.id) + ' ' + escapeHtml(x.name) + '</strong></td><td>' + rglPill(x.status === 'ok' ? 'pass' : x.status) + '</td><td><span class="evb-q">' + escapeHtml(x.rule || '') + '</span></td><td>' + escapeHtml(x.detail || '—') + '</td></tr>'; }).join('');
    return '<p class="evb-note">Null hypothesis for every playbook test: <strong>' + escapeHtml(g.nullHypothesis || 'same-rules') + '</strong>. ' + (d.stampedTrades ? d.stampedTrades + ' record trade' + (d.stampedTrades === 1 ? '' : 's') + ' carry a label stamp so far.' : 'Label stamps start with the first Top Picks run after this deploys.') + '</p>' + rglTable(head, body);
  }

  function rglResearchHtml(d){
    var r = d.research;
    if (!r || !r.summary) return '';
    var s = r.summary;
    var lines = Array.isArray(s.lines) ? s.lines : [];
    return '<p class="evb-lead">' + escapeHtml(s.headline || '') + '</p>' + (lines.length ? '<ul class="rgl-lines">' + lines.map(function(l){ return '<li>' + escapeHtml(l) + '</li>'; }).join('') + '</ul>' : '') + '<p class="evb-note">Committed from the research runner (research/regime-lab/results/latest.json): aggregate numbers only, never a Track Record row.' + (r.ranAt ? ' Ran ' + escapeHtml(rglEt(r.ranAt)) + '.' : '') + '</p>';
  }

  function renderRegimeLab(){
    var root = $('regime-lab-root'); if (!root) return;
    var d = rglState.data;
    if (!d){ root.innerHTML = '<p class="hint">' + (rglState.error ? 'The Regime Lab could not be loaded (' + escapeHtml(rglState.error) + '). Every full build writes it; the first one after this deploys creates it.' : 'Loading…') + '</p>'; return; }
    var v = d.versions || {};
    var nav = '<nav class="rgl-nav" aria-label="Regime Lab sections">' + [['rgl-today', 'Today'], ['rgl-history', 'History'], ['rgl-stocks', 'Stocks'], ['rgl-books', 'Playbooks'], ['rgl-risk', 'Exits and risk'], ['rgl-oracle', 'Oracle'], ['rgl-crowd', 'Crowd'], ['rgl-catalog', 'Tests'], ['rgl-guards', 'Guards']].map(function(x){ return '<a href="#' + x[0] + '">' + x[1] + '</a>'; }).join('') + '</nav>';
    root.innerHTML = nav +
      rglSection('rgl-today', 'Today\\'s market', rglTodayHtml(d)) +
      rglSection('rgl-history', 'Label history', rglHistoryHtml(d) + rglStabilityHtml(d)) +
      rglSection('rgl-resembles', 'Sessions that resemble now (F16)', rglResemblesHtml(d)) +
      rglSection('rgl-stocks', 'Stock labels (A10)', rglStocksHtml(d)) +
      rglSection('rgl-books', 'Playbooks and shadow books (B1-B8)', rglBooksHtml(d)) +
      rglSection('rgl-risk', 'Exits and risk (E1-E9)', rglRiskHtml(d)) +
      rglSection('rgl-brakes', 'Book brakes on the live record (F10)', rglBrakesHtml(d)) +
      rglSection('rgl-oracle', 'Headline oracle (D1-D8)', rglOracleHtml(d)) +
      rglSection('rgl-grader', 'AI grader by cell (F20)', rglGraderHtml(d)) +
      (d.research && d.research.summary ? rglSection('rgl-research', 'Research results', rglResearchHtml(d)) : '') +
      rglSection('rgl-crowd', 'Crowd and positioning on the open book', '<div id="rgl-crowd-body"><p class="hint">Loading the crowd join…</p></div>') +
      rglSection('rgl-catalog', 'Test catalog (F1-F22)', rglCatalogHtml(d)) +
      rglSection('rgl-guards', 'Guards (G1-G10)', rglGuardsHtml(d)) +
      '<p class="evb-note">' + escapeHtml(d.note || '') + ' Rules: labels ' + escapeHtml(v.labels || '') + ', playbooks ' + escapeHtml(v.playbooks || '') + ', exits ' + escapeHtml(v.exits || '') + ', oracle ' + escapeHtml(v.oracle || '') + '. Real option history since ' + escapeHtml(evbDate(d.realIvSince)) + '.</p>';
    rglLoadCrowd();
  }
  // Crowd & positioning (lib/crowd/, 2026-11-09): the Owner-only join of the
  // public crowd facts to the open Top Picks trades (crowd-owner.json).
  // Measurement only; nothing here changes a pick.
  var rglCrowd = { data: null, fetchedAt: 0, loading: false, error: null };
  function rglCrowdScore(v){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    return '<span class="crd-score' + (v >= 80 ? ' crd-score-hi' : v <= 20 ? ' crd-score-lo' : '') + '">' + Math.round(v) + '</span>';
  }
  function rglCrowdFlags(flags, warnings){
    var out = (flags || []).map(function(f){ return '<span class="crd-flag">' + escapeHtml(f) + '</span>'; });
    (warnings || []).forEach(function(w){ out.push('<span class="crd-flag crd-flag-warn">' + escapeHtml(w) + '</span>'); });
    return out.length ? '<span class="crd-owner-flags">' + out.join('') + '</span>' : '<span class="vt-na">—</span>';
  }
  // Rows saved before the gap read existed show the vs-close figure.
  function rglPerpGap(f){ if (!f) return null; return f.perpGapPct !== undefined ? f.perpGapPct : (f.perpVsClosePct == null ? null : f.perpVsClosePct); }
  function rglCrowdHtml(c){
    if (!c) return '<p class="hint">' + (rglCrowd.error ? 'The crowd join is not available yet (' + escapeHtml(rglCrowd.error) + '). Every full build writes it.' : 'Loading…') + '</p>';
    var g = c.gauges || {};
    var kp = [
      ['Equity put/call', g.putCallEquity == null ? '—' : Number(g.putCallEquity).toFixed(2) + (g.putCallEquityZ != null ? ' <small>' + (g.putCallEquityZ > 0 ? '+' : '') + Number(g.putCallEquityZ).toFixed(1) + 'σ</small>' : '')],
      ['Hedge funds, S&P futures', g.cotEsLevNet == null ? '—' : (g.cotEsLevNet > 0 ? 'long ' : 'short ') + Math.round(Math.abs(g.cotEsLevNet)).toLocaleString() + (g.cotEsLevZ != null ? ' <small>' + (g.cotEsLevZ > 0 ? '+' : '') + Number(g.cotEsLevZ).toFixed(1) + 'σ</small>' : '')],
      ['VIX futures, hedge funds', g.cotVxLevNet == null ? '—' : (g.cotVxLevNet > 0 ? 'long ' : 'short ') + Math.round(Math.abs(g.cotVxLevNet)).toLocaleString()],
      ['Margin debt y/y', g.marginDebtYoyPct == null ? '—' : (g.marginDebtYoyPct > 0 ? '+' : '') + Number(g.marginDebtYoyPct).toFixed(1) + '%'],
      ['Leveraged bull vs bear, 5d', g.levBullUsd5d == null && g.levBearUsd5d == null ? '—' : '$' + (Number(g.levBullUsd5d || 0) / 1e6).toFixed(0) + 'M / $' + (Number(g.levBearUsd5d || 0) / 1e6).toFixed(0) + 'M'],
      ['Kalshi S&P close, mean', g.kalshiSpxMean == null ? '—' : Math.round(g.kalshiSpxMean).toLocaleString()],
      ['Kalshi recession odds', g.kalshiRecessionPct == null ? '—' : Number(g.kalshiRecessionPct).toFixed(0) + '%'],
    ];
    var open = c.openTrades || [];
    var cols = [
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol) + '</b> ' + escapeHtml(t.side || '') + (t.id ? '<div class="crd-dim">' + escapeHtml(t.id) + '</div>' : ''); }, sort: function(t){ return t.symbol; } },
      { label: 'Attention', num: true, title: '0-100 rank of retail attention (Reddit, Wikipedia, Stocktwits) among the tracked names', cell: function(t){ return rglCrowdScore(t.attention); }, sort: function(t){ return t.attention; } },
      { label: 'Short pressure', num: true, title: '0-100 rank of short-sale volume and borrow fee among the tracked names', cell: function(t){ return rglCrowdScore(t.shortPressure); }, sort: function(t){ return t.shortPressure; } },
      { label: 'Perp gap', num: true, title: 'Where the 24/7 perp had the stock against its last close outside the session (after hours, overnight, weekends), else the 09:00 ET read', cell: function(t){ var v = rglPerpGap(t.facts); return v == null ? '<span class="vt-na">—</span>' : '<span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%</span>'; }, sort: function(t){ return rglPerpGap(t.facts); } },
      { label: 'Flags', nosort: true, cell: function(t){ return rglCrowdFlags(t.flags, t.warnings); } },
    ];
    var list = function(rows){ return rows && rows.length ? rows.map(function(r){ return '<li><b>' + escapeHtml(r.symbol) + '</b> ' + rglCrowdScore(r.attention) + (r.flags && r.flags.length ? ' <span class="crd-dim">' + escapeHtml(r.flags.join(', ')) + '</span>' : '') + '</li>'; }).join('') : '<li class="crd-dim">none yet</li>'; };
    return '<p class="evb-lead">' + (c.regime && c.regime.label ? 'Market label ' + escapeHtml(c.regime.label) + '. ' : '') + open.length + ' open trade' + (open.length === 1 ? '' : 's') + ' joined to today\\'s crowd facts; ' + (c.days || 0) + ' daily row' + (c.days === 1 ? '' : 's') + ' saved for later tests.</p>' +
      '<div class="mm-kpis">' + kp.map(function(k){ return '<div class="mm-kpi"><span>' + escapeHtml(k[0]) + '</span><b>' + k[1] + '</b></div>'; }).join('') + '</div>' +
      VIEWS.tableHtml(cols, open, { key: 'rgl-crowd-open', tall: false, empty: 'No open Top Picks trades right now.' }) +
      '<div class="rgl-facts"><div><dt>Most crowded attention</dt><dd><ul class="rgl-lines">' + list(c.mostCrowded) + '</ul></dd></div><div><dt>Least crowded</dt><dd><ul class="rgl-lines">' + list(c.leastCrowded) + '</ul></dd></div></div>' +
      '<p class="evb-note">' + escapeHtml(c.note || '') + ' Public facts behind these ranks: <a href="?tab=crowd">Crowd &amp; positioning</a>.' + (c.builtAtIso ? ' Written ' + escapeHtml(rglEt(c.builtAtIso)) + '.' : '') + '</p>';
  }
  function rglLoadCrowd(){
    var body = $('rgl-crowd-body'); if (!body) return;
    if (rglCrowd.data && Date.now() - rglCrowd.fetchedAt < 10 * 60 * 1000){ body.innerHTML = rglCrowdHtml(rglCrowd.data); return; }
    if (rglCrowd.loading){ body.innerHTML = rglCrowdHtml(null); return; }
    rglCrowd.loading = true; rglCrowd.error = null;
    body.innerHTML = rglCrowdHtml(null);
    quantFetchJson(dataUrl('crowd-owner.json')).then(function(row){
      rglCrowd.data = row && typeof row === 'object' && row.gauges ? row : null; rglCrowd.fetchedAt = Date.now(); rglCrowd.loading = false;
      if (!rglCrowd.data) rglCrowd.error = 'not written yet';
      var b = $('rgl-crowd-body'); if (b) b.innerHTML = rglCrowdHtml(rglCrowd.data);
    }).catch(function(err){
      rglCrowd.loading = false; rglCrowd.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err);
      var b = $('rgl-crowd-body'); if (b) b.innerHTML = rglCrowdHtml(null);
    });
  }
  function loadRegimeLab(force){
    var status = $('owner-regime-status');
    if (!force && rglState.data && Date.now() - rglState.fetchedAt < 15 * 60 * 1000){ renderRegimeLab(); return; }
    if (rglState.loading) return;
    rglState.loading = true; rglState.error = null;
    if (status) status.textContent = 'Loading the Regime Lab…';
    renderRegimeLab();
    quantFetchJson(dataUrl('regime-lab.json')).then(function(row){
      rglState.data = row && typeof row === 'object' ? row : null; rglState.fetchedAt = Date.now(); rglState.loading = false;
      if (status) status.textContent = rglState.data ? 'Written by the ' + rglEt(rglState.data.builtAt) + ' build' + (rglState.data.today ? '; label as of the ' + evbDate(rglState.data.today.date) + ' close.' : '.') : 'No lab file yet.';
      renderRegimeLab();
    }).catch(function(err){
      rglState.loading = false; rglState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err);
      if (status) status.textContent = 'The Regime Lab is not available yet.';
      renderRegimeLab();
    });
  }
`;
}

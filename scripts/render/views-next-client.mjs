// New ways to see the data (2026-11-07): the Market map page (fear map,
// two-number lens, chart wall, crowding map, breadth, crowded shorts), the
// What changed page, the Past days page and the option-volume-by-expiry card
// on Unusual options trades.
//
// Every public layer reads a public file the bake writes (market-map.json,
// site-changes.json, market-days.json). The Owner layers read Owner-only files
// (grades.json, grades-daily.json, picks-open.json, picks-accuracy.json,
// market-days-briefs.json, picks-run-YYYY-MM-DD.json) and are only requested
// when HAS_OWNER_ACCESS is true, so a public visitor never asks for them.
// The returned string is pasted inside the app.js IIFE (ES5, no imports).
export function renderViewsNextJs() {
  return `
  var VN = { cache: {}, pending: {} };
  // One cached fetch per key. An Owner-only key resolves to null without a
  // request unless the Owner session is confirmed; that null is not cached,
  // so the file loads once the session arrives.
  var VN_RECORD_KEYS = { 'picks-accuracy.json': 1, 'picks-changes.json': 1, 'picks-roster.json': 1, 'grades-history.json': 1 };
  function vnJson(key, ownerOnly){
    if (ownerOnly && !HAS_OWNER_ACCESS) return Promise.resolve(null);
    var ck = key + (ownerOnly ? '|o' : '');
    if (Object.prototype.hasOwnProperty.call(VN.cache, ck)) return Promise.resolve(VN.cache[ck]);
    if (VN.pending[ck]) return VN.pending[ck];
    // Track Record logs are read through the Track Record's own copy, which
    // leaves out any period the Owner wiped from reporting.
    var url = ownerOnly && VN_RECORD_KEYS[key] && typeof trackRecordDataUrl === 'function' ? trackRecordDataUrl(key) : dataUrl(key);
    VN.pending[ck] = fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(j){ VN.cache[ck] = j; delete VN.pending[ck]; return j; });
    return VN.pending[ck];
  }
  // 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st, 22nd.
  function vnOrd(n){
    var k = Math.round(Number(n));
    if (!isFinite(k)) return '—';
    var t = k % 100, u = k % 10;
    return k + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
  }
  function vnPct(v, d, signed){
    if (v == null || !isFinite(v)) return '—';
    var n = Number(v);
    return (signed !== false && n > 0 ? '+' : '') + n.toFixed(d == null ? 1 : d) + '%';
  }
  function vnChg(v, d){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    return '<span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + vnPct(v, d) + '</span>';
  }
  function vnNum(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d); }
  function vnEtDate(iso){
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    try { return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } catch (_) { return null; }
  }
  function vnDay(iso){
    var t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z');
    if (!isFinite(t)) return escapeHtml(iso || '');
    return new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function vnWhen(iso){
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    // Build and Brief times follow the header's time-zone setting, like every
    // other build stamp; formatDisplayInstant adds the zone name.
    if (typeof formatDisplayInstant === 'function') return formatDisplayInstant(new Date(t), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    try { return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'; } catch (_) { return ''; }
  }
  function vnHref(sym){ return typeof STOCK_PAGE !== 'undefined' && STOCK_PAGE.href ? STOCK_PAGE.href(sym) : '?tab=stock&s=' + encodeURIComponent(sym); }
  function vnSym(sym){ return '<a class="vn-sym" href="' + escapeHtml(vnHref(sym)) + '">' + escapeHtml(sym) + '</a>'; }
  // One colour per broad sector group (lib/sector-groups.mjs order).
  function vnGroupIdx(g){
    var order = SECTOR_GROUPS && SECTOR_GROUPS.ORDER ? SECTOR_GROUPS.ORDER : [];
    var i = order.indexOf(g);
    return i < 0 ? order.length : i;
  }
  function vnGroupLegend(groups){
    return '<ul class="vn-legend" aria-label="Sector colours">' + groups.map(function(g){
      return '<li><i class="vn-dot vn-g' + vnGroupIdx(g) + '"></i>' + escapeHtml(g) + '</li>';
    }).join('') + '</ul>';
  }
  function vnTabsHtml(list, current, attr){
    return '<div class="ui-tabs vn-tabs" role="tablist">' + list.map(function(t){
      var on = t[0] === current;
      return '<button type="button" role="tab" class="ui-tab' + (on ? ' is-on' : '') + '" ' + attr + '="' + t[0] + '" aria-selected="' + (on ? 'true' : 'false') + '">' + escapeHtml(t[1]) + '</button>';
    }).join('') + '</div>';
  }

  // ---- Market map ----------------------------------------------------------
  var MM_TABS = [['fear', 'Fear map'], ['scatter', 'Two-number lens'], ['wall', 'Chart wall'], ['crowd', 'Crowding'], ['breadth', 'Breadth'], ['shorts', 'Crowded shorts']];
  var MM_METRICS = [
    ['r1m', '1-month move', 'pct'], ['r3m', '3-month move', 'pct'], ['rytd', 'Year-to-date move', 'pct'], ['r1y', '1-year move', 'pct'],
    ['pe', 'P/E (last 12 months)', 'pe'], ['fpe', 'P/E (next 12 months)', 'pe'], ['rsi', 'RSI (14 days)', 'num'],
    ['d200', 'Distance from 200-day average', 'pct'], ['d50', 'Distance from 50-day average', 'pct'], ['dHi', 'Distance from 52-week high', 'pct'],
    ['ivp', 'IV percentile (vs its own history)', 'num'], ['si', 'Short interest (% of float)', 'pct'], ['grade', 'Site grade (Owner only)', 'num', true]
  ];
  var mmState = { data: null, loading: false, error: false, breadthCharts: [], corrSyms: null, corrM: null, openSyms: null, openLoading: false };
  function mmView(key, dflt){ return VIEWS.get('market-map.' + key, dflt); }
  function mmSetView(key, v){ VIEWS.set('market-map.' + key, v); }
  function mmMetric(key){
    for (var i = 0; i < MM_METRICS.length; i++) if (MM_METRICS[i][0] === key) return MM_METRICS[i];
    return MM_METRICS[0];
  }
  function mmValue(row, key){
    if (key === 'grade') return mmGrade(row.s);
    var v = row[key];
    if (v == null || !isFinite(v)) return null;
    // P/E outside 0..150 (losses, or tiny earnings) would flatten the chart.
    if ((key === 'pe' || key === 'fpe') && (v <= 0 || v > 150)) return null;
    return Number(v);
  }
  // The grade index is Owner-only and large: load it once, then repaint.
  function mmGrade(sym){
    if (!HAS_OWNER_ACCESS) return null;
    if (!picksGradesState.data){
      if (!mmState.gradeWait){ mmState.gradeWait = true; loadGradesIndex(function(){ mmState.gradeWait = false; renderMarketMap(); }); }
      return null;
    }
    return gradeTotalFor(sym);
  }
  function mmFmt(kind){
    return kind === 'pct' ? function(v){ return vnPct(v, 0); } : kind === 'pe' ? function(v){ return Math.round(v) + '×'; } : function(v){ return String(Math.round(v * 10) / 10); };
  }
  function loadMarketMap(){
    if (HAS_OWNER_ACCESS) mmLoadOpen();
    if (mmState.data || mmState.loading){ renderMarketMap(); return; }
    mmState.loading = true; mmState.error = false;
    renderMarketMap();
    vnJson('market-map.json').then(function(j){
      mmState.loading = false;
      if (j && Array.isArray(j.rows)) mmState.data = j; else mmState.error = true;
      renderMarketMap();
    });
  }
  function mmLoadOpen(){
    if (!HAS_OWNER_ACCESS || mmState.openSyms || mmState.openLoading) return;
    mmState.openLoading = true;
    vnJson('picks-open.json', true).then(function(j){
      mmState.openLoading = false;
      var syms = {};
      (j && Array.isArray(j.open) ? j.open : []).forEach(function(o){ if (o && o.symbol) syms[o.symbol] = (syms[o.symbol] || []).concat([o.side]); });
      mmState.openSyms = syms;
      var pane = document.getElementById('page-pane-market-map');
      if (pane && !pane.hidden) renderMarketMap();
    });
  }
  function renderMarketMap(){
    var root = document.getElementById('mm-root');
    if (!root) return;
    var d = mmState.data;
    mmState.breadthCharts.forEach(function(h){ try { h.destroy(); } catch (_) {} });
    mmState.breadthCharts = [];
    if (!d){
      root.innerHTML = '<p class="mm-empty">' + (mmState.error ? 'The market map could not load. It is written by the next full build; try again later.' : 'Loading the market map…') + '</p>';
      return;
    }
    var asof = document.getElementById('mm-asof');
    if (asof) asof.textContent = d.builtAtIso ? 'Built ' + vnWhen(d.builtAtIso) : '';
    var tab = mmView('tab', 'fear');
    if (!MM_TABS.some(function(t){ return t[0] === tab; })) tab = 'fear';
    var body = tab === 'scatter' ? mmScatterHtml(d) : tab === 'wall' ? mmWallHtml(d) : tab === 'crowd' ? mmCrowdHtml(d) : tab === 'breadth' ? mmBreadthHtml(d) : tab === 'shorts' ? mmShortsHtml(d) : mmFearHtml(d);
    root.innerHTML = vnTabsHtml(MM_TABS, tab, 'data-mm-tab') + '<div class="mm-body">' + body + '</div>';
    if (tab === 'breadth') mmMountBreadth(d);
  }
  function mmStocks(d, withEtf){ return (d.rows || []).filter(function(r){ return r && (withEtf || !r.etf); }); }
  function mmGroupsOf(rows){
    var seen = {}, out = [];
    rows.forEach(function(r){ if (r.g && !seen[r.g]){ seen[r.g] = 1; out.push(r.g); } });
    return out.sort(function(a, b){ return vnGroupIdx(a) - vnGroupIdx(b); });
  }
  function mmRadius(mc, maxMc){ return mc > 0 && maxMc > 0 ? 3 + 9 * Math.sqrt(mc / maxMc) : 4; }

  function mmFearHtml(d){
    var rows = mmStocks(d, mmView('etf', false));
    var useZ = rows.filter(function(r){ return r.skz != null; }).length >= 10;
    var maxMc = 0;
    rows.forEach(function(r){ if (r.mc > maxMc) maxMc = r.mc; });
    var pts = [];
    rows.forEach(function(r){
      var y = useZ ? r.skz : (r.skew != null ? r.skew * 100 : null);
      if (r.ivp == null || y == null) return;
      var fear = r.ivp / 100 + Math.max(-3, Math.min(3, useZ ? y : y / 3)) / 3;
      pts.push({ x: r.ivp, y: y, r: mmRadius(r.mc, maxMc), cls: 'vn-g' + vnGroupIdx(r.g), href: vnHref(r.s), row: r, fear: fear,
        label: r.s + (r.n ? ' · ' + r.n : '') + '\\nIV percentile ' + r.ivp + (r.ivb ? ' (' + r.ivb.replace('-', ' ') + ')' : '') + '\\n' + (useZ ? 'Put skew vs its history ' + vnNum(r.skz, 1) + 'σ' : 'Put minus call IV ' + vnNum(y, 1) + ' pts') + (r.ne ? '\\nEarnings ' + r.ne : '') });
    });
    if (pts.length < 5) return '<p class="mm-empty">Not enough options history yet to draw the fear map.</p>';
    pts.sort(function(a, b){ return b.fear - a.fear; });
    pts.slice(0, 6).forEach(function(p){ p.text = p.row.s; });
    pts.slice(-4).forEach(function(p){ p.text = p.row.s; });
    var top = pts.slice(0, 10);
    var soon = Date.now() + 14 * 86400000;
    var list = '<ol class="mm-fear-list">' + top.map(function(p){
      var r = p.row;
      var earnMs = r.ne ? Date.parse(r.ne + 'T12:00:00Z') : NaN;
      var earn = earnMs >= Date.now() - 86400000 && earnMs <= soon ? '<span class="mm-tag">Earnings ' + escapeHtml(r.ne.slice(5)) + '</span>' : '';
      return '<li>' + vnSym(r.s) + ' <span class="mm-dim">' + escapeHtml(r.n || '') + '</span> <span class="mm-kv">IV ' + vnOrd(r.ivp) + ' pct</span> <span class="mm-kv">skew ' + (useZ ? vnNum(r.skz, 1) + 'σ' : vnNum(p.y, 1) + ' pts') + '</span> ' + ivBandPillHtml(r.ivb) + earn + '</li>';
    }).join('') + '</ol>';
    return '<div class="mm-tools"><label class="mm-check"><input type="checkbox" data-mm-etf' + (mmView('etf', false) ? ' checked' : '') + '> Include ETFs</label></div>' +
      '<p class="mm-lede">Right means the options cost more than usual for that stock. Up means puts (crash protection) cost more than usual compared with calls. Top right is where traders are paying up for protection.</p>' +
      '<div class="mm-chart">' + scatterSvgHtml(pts, { xLabel: 'IV percentile (0 = cheapest in its history, 100 = priciest)', yLabel: useZ ? 'Put skew vs its own history (σ)' : 'Put minus call IV (points)', xFmt: function(v){ return String(Math.round(v)); }, yFmt: function(v){ return (Math.round(v * 10) / 10).toFixed(useZ ? 1 : 0); }, zeroY: true, h: 380, ariaLabel: 'Fear map: IV percentile against put skew' }) + '</div>' +
      vnGroupLegend(mmGroupsOf(rows)) +
      '<div class="mm-quads"><span><b>Top right:</b> pricey options, puts bid up. Fear.</span><span><b>Bottom left:</b> cheap options, calls bid up. Calm or chasing.</span></div>' +
      '<h3 class="mm-h3">Most fearful right now</h3>' + list +
      '<p class="mm-note">Dot size is company value. ' + (useZ ? 'Skew is the 25-delta put IV minus the 25-delta call IV, compared with the stock’s own last 60+ sessions.' : 'Skew history is still short, so the raw put-minus-call IV gap is shown.') + ' A report inside two weeks often explains pricey options.</p>';
  }

  function mmScatterHtml(d){
    var xk = mmView('x', 'r1m'), yk = mmView('y', 'd200');
    if (!HAS_OWNER_ACCESS){ if (xk === 'grade') xk = 'r1m'; if (yk === 'grade') yk = 'd200'; }
    var xm = mmMetric(xk), ym = mmMetric(yk);
    var withEtf = mmView('etf', false);
    var rows = mmStocks(d, withEtf);
    var maxMc = 0;
    rows.forEach(function(r){ if (r.mc > maxMc) maxMc = r.mc; });
    var xf = mmFmt(xm[2]), yf = mmFmt(ym[2]);
    var pts = [];
    rows.forEach(function(r){
      var x = mmValue(r, xm[0]), y = mmValue(r, ym[0]);
      if (x == null || y == null) return;
      pts.push({ x: x, y: y, r: mmRadius(r.mc, maxMc), cls: 'vn-g' + vnGroupIdx(r.g), href: vnHref(r.s), text: r.s, label: r.s + (r.n ? ' · ' + r.n : '') + '\\n' + xm[1] + ': ' + xf(x) + '\\n' + ym[1] + ': ' + yf(y) });
    });
    function opts(cur){
      return MM_METRICS.filter(function(m){ return !m[3] || HAS_OWNER_ACCESS; }).map(function(m){ return '<option value="' + m[0] + '"' + (m[0] === cur ? ' selected' : '') + '>' + escapeHtml(m[1]) + '</option>'; }).join('');
    }
    // Simple rank correlation, so the reader sees whether the two line up.
    function rho(ps){
      if (ps.length < 6) return null;
      function ranks(vals){ var idx = vals.map(function(v, i){ return [v, i]; }).sort(function(a, b){ return a[0] - b[0]; }); var r = []; idx.forEach(function(p, k){ r[p[1]] = k; }); return r; }
      var rx = ranks(ps.map(function(p){ return p.x; })), ry = ranks(ps.map(function(p){ return p.y; }));
      var n = ps.length, s = 0;
      for (var i = 0; i < n; i++) s += (rx[i] - ry[i]) * (rx[i] - ry[i]);
      return 1 - 6 * s / (n * (n * n - 1));
    }
    var rh = rho(pts);
    var gradeWait = (xk === 'grade' || yk === 'grade') && HAS_OWNER_ACCESS && !pts.length;
    return '<div class="mm-tools"><label>Across <select data-mm-x>' + opts(xk) + '</select></label><label>Up <select data-mm-y>' + opts(yk) + '</select></label>' +
      '<label class="mm-check"><input type="checkbox" data-mm-etf' + (withEtf ? ' checked' : '') + '> Include ETFs</label></div>' +
      (gradeWait ? '<p class="mm-empty">Loading grades…</p>' : pts.length < 3 ? '<p class="mm-empty">Not enough stocks have both numbers.</p>' :
        '<div class="mm-chart">' + scatterSvgHtml(pts, { xLabel: xm[1], yLabel: ym[1], xFmt: xf, yFmt: yf, zeroX: xm[2] === 'pct', zeroY: ym[2] === 'pct', h: 400, ariaLabel: xm[1] + ' against ' + ym[1] }) + '</div>') +
      vnGroupLegend(mmGroupsOf(rows)) +
      '<p class="mm-note">' + pts.length + ' stocks. Dot size is company value.' + (rh != null ? ' Rank correlation ' + rh.toFixed(2) + (Math.abs(rh) < 0.2 ? ' (the two barely line up).' : rh > 0 ? ' (higher on one tends to mean higher on the other).' : ' (higher on one tends to mean lower on the other).') : '') +
      (xm[2] === 'pe' || ym[2] === 'pe' ? ' P/E below 0 or above 150 is left out.' : '') + (xk === 'grade' || yk === 'grade' ? ' The grade is Owner-only and is never sent to public visitors.' : '') + '</p>';
  }

  function mmWallHtml(d){
    var sort = mmView('wallSort', 'r6m'), grp = mmView('wallGroup', ''), side = mmView('wallSide', '');
    var rows = mmStocks(d, true).filter(function(r){ return Array.isArray(r.sp) && r.sp.length > 2; });
    var groups = mmGroupsOf(rows);
    if (grp) rows = rows.filter(function(r){ return r.g === grp; });
    if (side === 'above') rows = rows.filter(function(r){ return r.d200 != null && r.d200 > 0; });
    if (side === 'below') rows = rows.filter(function(r){ return r.d200 != null && r.d200 <= 0; });
    rows.sort(function(a, b){
      if (sort === 'name') return a.s.localeCompare(b.s);
      var av = a[sort], bv = b[sort];
      if (av == null) return 1; if (bv == null) return -1;
      return bv - av;
    });
    var cards = rows.map(function(r){
      var n = r.sp.length;
      var pts = r.sp.map(function(v, i){ var wk = Math.round((n - 1 - i) * 126 / (n - 1) / 5); return [i === n - 1 ? 'Latest' : wk <= 0 ? 'This week' : wk + (wk === 1 ? ' week ago' : ' weeks ago'), v / 10]; });
      return '<a class="mm-wall-card vn-gb' + vnGroupIdx(r.g) + '" href="' + escapeHtml(vnHref(r.s)) + '"><span class="mm-wall-top"><b>' + escapeHtml(r.s) + '</b>' + vnChg(r.r6m, 0) + '</span>' +
        rowSparkHtml(pts, function(v){ return vnPct(v, 1); }, r.s + ' over six months') +
        '<span class="mm-wall-sub">' + (r.d200 != null ? (r.d200 > 0 ? 'Above' : 'Below') + ' 200-day by ' + vnPct(Math.abs(r.d200), 0, false) : '&nbsp;') + '</span></a>';
    }).join('');
    function sel(attr, cur, list){ return '<select ' + attr + '>' + list.map(function(o){ return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>'; }).join('') + '</select>'; }
    return '<div class="mm-tools"><label>Sort ' + sel('data-mm-wall-sort', sort, [['r6m', '6-month move'], ['r1m', '1-month move'], ['r1d', 'Last day'], ['d200', 'Distance from 200-day'], ['dHi', 'Closest to 52-week high'], ['name', 'Ticker A–Z']]) + '</label>' +
      '<label>Sector ' + sel('data-mm-wall-group', grp, [['', 'All sectors']].concat(groups.map(function(g){ return [g, g]; }))) + '</label>' +
      '<label>Trend ' + sel('data-mm-wall-side', side, [['', 'Any'], ['above', 'Above the 200-day'], ['below', 'Below the 200-day']]) + '</label></div>' +
      (rows.length ? '<div class="mm-wall">' + cards + '</div>' : '<p class="mm-empty">No stocks match.</p>') +
      '<p class="mm-note">' + rows.length + ' charts, six months of daily closes each, scaled to their own range. The number is the six-month move.</p>';
  }

  function mmCorrColor(v){
    if (v == null) return 'transparent';
    var a = Math.min(1, Math.abs(v) / 100);
    return v >= 0 ? 'rgba(220,38,38,' + (0.08 + a * 0.85).toFixed(3) + ')' : 'rgba(37,99,235,' + (0.08 + a * 0.85).toFixed(3) + ')';
  }
  function mmCrowdHtml(d){
    var c = d.corr;
    if (!c || !Array.isArray(c.syms) || c.syms.length < 4) return '<p class="mm-empty">Not enough history to measure how the stocks move together.</p>';
    var n = c.syms.length;
    // Big enough to read the labels; a phone scrolls the map sideways.
    var cell = Math.max(8, Math.min(18, Math.floor(860 / n)));
    var pad = 46;
    var fs = Math.max(7, Math.min(11, cell - 2));
    var W = pad + n * cell;
    var open = HAS_OWNER_ACCESS && mmState.openSyms ? mmState.openSyms : null;
    mmState.corrSyms = c.syms; mmState.corrM = c.m;
    var g = '';
    for (var i = 0; i < n; i++){
      for (var j = 0; j < n; j++){
        var v = c.m[i][j];
        if (v == null || i === j) continue;
        g += '<rect x="' + (pad + j * cell) + '" y="' + (pad + i * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + mmCorrColor(v) + '"/>';
      }
    }
    var labels = '';
    if (pad > 4){
      for (var k = 0; k < n; k++){
        var isOpen = open && open[c.syms[k]];
        labels += '<text class="mm-corr-lbl' + (isOpen ? ' is-open' : '') + '" x="' + (pad - 3) + '" y="' + (pad + k * cell + cell * 0.75) + '" text-anchor="end" style="font-size:' + fs + 'px">' + escapeHtml(c.syms[k]) + '</text>' +
          '<text class="mm-corr-lbl' + (isOpen ? ' is-open' : '') + '" transform="translate(' + (pad + k * cell + cell * 0.75) + ' ' + (pad - 3) + ') rotate(-90)" style="font-size:' + fs + 'px">' + escapeHtml(c.syms[k]) + '</text>';
        if (isOpen) labels += '<rect class="mm-corr-open" x="' + pad + '" y="' + (pad + k * cell) + '" width="' + (n * cell) + '" height="' + cell + '"/>';
      }
    }
    var svg = '<svg class="mm-corr-svg" viewBox="0 0 ' + W + ' ' + W + '" style="max-width:' + W + 'px;min-width:' + Math.min(W, 560) + 'px" role="img" aria-label="Correlation heatmap of ' + n + ' stocks" data-mm-corr data-pad="' + pad + '" data-cell="' + cell + '">' + g + labels + '</svg>';
    var clusters = (c.clusters || []).map(function(cl){
      return '<li><b>' + cl.avg + '%</b> average correlation · ' + cl.syms.map(vnSym).join(' ') + '</li>';
    }).join('');
    var ownerHtml = '';
    if (open){
      var syms = Object.keys(open).filter(function(s){ return c.syms.indexOf(s) >= 0; });
      var pairs = [];
      for (var a = 0; a < syms.length; a++) for (var b = a + 1; b < syms.length; b++){
        var ia = c.syms.indexOf(syms[a]), ib = c.syms.indexOf(syms[b]);
        var v2 = c.m[ia][ib];
        if (v2 != null) pairs.push({ a: syms[a], b: syms[b], v: v2 });
      }
      pairs.sort(function(x, y){ return y.v - x.v; });
      var tight = pairs.filter(function(p){ return p.v >= 60; });
      var avg = pairs.length ? Math.round(pairs.reduce(function(s, p){ return s + p.v; }, 0) / pairs.length) : null;
      ownerHtml = '<section class="mm-owner"><h3 class="mm-h3">Your open trades <span class="mm-owner-tag">Owner</span></h3>' +
        (syms.length < 2 ? '<p class="mm-note">Fewer than two open trades are in the map, so there is nothing to compare.</p>' :
          '<p class="mm-note">' + syms.length + ' open trades are highlighted on the map. Their average 60-day correlation is <b>' + (avg != null ? avg + '%' : '—') + '</b>' + (c.avg != null ? ' (the whole map averages ' + c.avg + '%)' : '') + '.</p>' +
          (tight.length ? '<ul class="mm-pairs">' + tight.slice(0, 12).map(function(p){ return '<li>' + vnSym(p.a) + ' (' + escapeHtml((open[p.a] || []).join('/')) + ') and ' + vnSym(p.b) + ' (' + escapeHtml((open[p.b] || []).join('/')) + ') move together: <b>' + p.v + '%</b></li>'; }).join('') + '</ul>' : '<p class="mm-note">No two open trades move together more than 60% of the time.</p>')) +
        '</section>';
    } else if (HAS_OWNER_ACCESS){
      ownerHtml = '<p class="mm-note">Loading your open trades…</p>';
    }
    return '<p class="mm-lede">Each cell is how closely two stocks moved day to day over the last ' + (c.window || 60) + ' sessions. Red moves together, blue moves opposite. Stocks that move together sit next to each other, so the red blocks are crowded groups.</p>' +
      '<div class="mm-corr-wrap">' + svg + '<div class="mm-corr-tip" id="mm-corr-tip" hidden></div></div>' +
      '<p class="mm-note">' + n + ' stocks, ' + escapeHtml(c.from || '') + ' to ' + escapeHtml(c.to || '') + '. Average pair: ' + (c.avg != null ? c.avg + '%' : '—') + '. ETFs are left out.</p>' +
      (clusters ? '<h3 class="mm-h3">Tight groups (move together 60%+)</h3><ul class="mm-clusters">' + clusters + '</ul>' : '') + ownerHtml;
  }
  document.addEventListener('pointermove', function(ev){
    var svg = ev.target && ev.target.closest ? ev.target.closest('svg[data-mm-corr]') : null;
    var tip = document.getElementById('mm-corr-tip');
    if (!tip) return;
    if (!svg || !mmState.corrSyms){ tip.hidden = true; return; }
    var box = svg.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : box.width;
    var scale = vb / box.width;
    var pad = Number(svg.getAttribute('data-pad')), cell = Number(svg.getAttribute('data-cell'));
    var x = (ev.clientX - box.left) * scale, y = (ev.clientY - box.top) * scale;
    var j = Math.floor((x - pad) / cell), i = Math.floor((y - pad) / cell);
    var n = mmState.corrSyms.length;
    if (i < 0 || j < 0 || i >= n || j >= n || i === j){ tip.hidden = true; return; }
    var v = mmState.corrM[i][j];
    tip.textContent = mmState.corrSyms[i] + ' and ' + mmState.corrSyms[j] + ': ' + (v == null ? '—' : v + '%');
    var wrap = svg.parentNode.getBoundingClientRect();
    tip.style.left = Math.min(wrap.width - 160, ev.clientX - wrap.left + 12) + 'px';
    tip.style.top = (ev.clientY - wrap.top + 12) + 'px';
    tip.hidden = false;
  });

  function mmBreadthHtml(d){
    var b = d.breadth;
    if (!b || !Array.isArray(b.dates) || b.dates.length < 20) return '<p class="mm-empty">Not enough history to draw breadth yet.</p>';
    var L = b.dates.length - 1;
    function last(arr){ for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }
    function avg10(arr){ var s = 0, n = 0; for (var i = Math.max(0, arr.length - 10); i < arr.length; i++) if (arr[i] != null){ s += arr[i]; n++; } return n ? s / n : null; }
    var kpis = [
      ['Above their 50-day', vnPct(last(b.a50), 0, false)],
      ['Above their 200-day', vnPct(last(b.a200), 0, false)],
      ['New 52-week highs', b.hi[L] != null ? String(b.hi[L]) : '—'],
      ['New 52-week lows', b.lo[L] != null ? String(b.lo[L]) : '—'],
      ['Volume in rising stocks (10-day avg)', vnPct(avg10(b.upv), 0, false)]
    ];
    return '<p class="mm-lede">How many of the tracked stocks are taking part. A rising market with a shrinking share of stocks above their averages is a narrow rally.</p>' +
      '<div class="mm-kpis">' + kpis.map(function(k){ return '<div class="mm-kpi"><span>' + escapeHtml(k[0]) + '</span><b>' + escapeHtml(k[1]) + '</b></div>'; }).join('') + '</div>' +
      '<h3 class="mm-h3">Share of stocks above their averages, with SPY</h3><div id="mm-breadth-1" class="mm-ck"></div>' +
      '<h3 class="mm-h3">New 52-week highs and lows</h3><div id="mm-breadth-2" class="mm-ck"></div>' +
      '<h3 class="mm-h3">Share of volume in rising stocks (10-day average)</h3><div id="mm-breadth-3" class="mm-ck"></div>' +
      '<p class="mm-note">' + escapeHtml((d.notes && d.notes.breadth) || '') + ' ' + (b.n && b.n[L] ? b.n[L] + ' stocks counted on the latest day.' : '') + '</p>';
  }
  function mmMountBreadth(d){
    var b = d.breadth;
    if (!b || !b.dates) return;
    function ser(arr){ return b.dates.map(function(t, i){ return { time: t, value: arr[i] }; }); }
    var pctFmt = function(v){ return v == null ? '' : Math.round(v) + '%'; };
    var h1 = CHART_KIT.mount(document.getElementById('mm-breadth-1'), {
      height: 260, ranges: ['3M', '6M', '1Y'], range: '1Y',
      series: [
        { name: '% above 50-day', short: '50d', type: 'line', data: ser(b.a50), format: pctFmt },
        { name: '% above 200-day', short: '200d', type: 'line', data: ser(b.a200), format: pctFmt },
        { name: 'SPY', short: 'SPY', type: 'line', axis: 'left', data: ser(b.spy), dashed: true, width: 1, format: function(v){ return '$' + Number(v).toFixed(0); } }
      ], source: 'Daily closes · tracked stocks'
    });
    var hl = [];
    b.dates.forEach(function(t, i){
      if (b.hi[i] != null) hl.push({ time: t, value: b.hi[i] });
    });
    var lows = b.dates.map(function(t, i){ return { time: t, value: b.lo[i] != null ? -b.lo[i] : null }; });
    var h2 = CHART_KIT.mount(document.getElementById('mm-breadth-2'), {
      height: 200, ranges: ['3M', '6M', '1Y'], range: '6M', priceLine: false,
      series: [
        { name: 'New highs', type: 'histogram', data: hl, color: CHART_KIT.colors().up, format: function(v){ return String(Math.round(v)); } },
        { name: 'New lows', type: 'histogram', data: lows, color: CHART_KIT.colors().down, format: function(v){ return String(Math.abs(Math.round(v))); } }
      ], source: 'Lows drawn below zero'
    });
    var upv = b.dates.map(function(t, i){
      var s = 0, n = 0;
      for (var k = Math.max(0, i - 9); k <= i; k++) if (b.upv[k] != null){ s += b.upv[k]; n++; }
      return { time: t, value: n ? s / n : null };
    });
    var h3 = CHART_KIT.mount(document.getElementById('mm-breadth-3'), {
      height: 180, ranges: ['3M', '6M', '1Y'], range: '6M',
      series: [{ name: 'Up volume', type: 'area', data: upv, format: pctFmt }],
      bands: [{ value: 50, title: '50%', axis: false }], source: 'Volume on up days ÷ volume on up and down days'
    });
    mmState.breadthCharts = [h1, h2, h3].filter(Boolean);
  }

  function mmShortsHtml(d){
    var rows = mmStocks(d, false).filter(function(r){ return r.si != null; });
    if (!rows.length) return '<p class="mm-empty">No short-interest readings yet. FINRA publishes them twice a month.</p>';
    rows.sort(function(a, b){ return b.si - a.si; });
    var latest = rows.reduce(function(m, r){ return r.siDate && r.siDate > m ? r.siDate : m; }, '');
    var cols = [
      { label: 'Stock', cell: function(r){ return vnSym(r.s) + (r.n ? '<span class="vt-sub">' + escapeHtml(r.n) + '</span>' : ''); }, sort: function(r){ return r.s; } },
      { label: 'Short % of float', num: true, cell: function(r){ return vtBarHtml(Math.min(1, r.si / 25), r.si >= 15 ? 'neg' : '', vnPct(r.si, 1, false)); }, sort: function(r){ return r.si; } },
      { label: 'Days to cover', num: true, title: 'Shares sold short ÷ average daily volume', cell: function(r){ return r.dtc != null ? vnNum(r.dtc, 1) : ''; }, sort: function(r){ return r.dtc; } },
      { label: 'Implied borrow', num: true, title: 'Borrow cost the option market is pricing, % a year, from put-call parity on the chain nearest 60 days. Inside the noise band it is not distinguishable from zero.', cell: function(r){ if (r.bw == null) return ''; var noisy = r.bwn != null && Math.abs(r.bw) <= r.bwn; return '<span class="' + (r.bw >= 5 && !noisy ? 'vn-neg' : '') + '">' + vnPct(r.bw, 1, true) + '</span>' + (r.bwn != null ? '<span class="vt-sub">±' + vnPct(r.bwn, 1, false) + '</span>' : ''); }, sort: function(r){ return r.bw; } },
      { label: 'Change vs prior report', num: true, cell: function(r){ return r.siChg != null ? vnChg(r.siChg, 0) : ''; }, sort: function(r){ return r.siChg; } },
      { label: '1-month move', num: true, cell: function(r){ return vnChg(r.r1m, 1); }, sort: function(r){ return r.r1m; } },
      { label: 'Settlement date', cell: function(r){ return escapeHtml(r.siDate || ''); }, sort: function(r){ return r.siDate; } }
    ];
    var crowded = rows.filter(function(r){ return r.si >= 10 && r.dtc != null && r.dtc >= 3; });
    var hardToBorrow = rows.filter(function(r){ return r.bw != null && r.bw >= 5 && !(r.bwn != null && r.bw <= r.bwn); });
    return '<p class="mm-lede">Stocks with the most shares sold short. A big short position plus several days of volume to buy it back is what a short squeeze needs; a high number alone is not a signal.</p>' +
      (crowded.length ? '<p class="mm-callout"><b>Crowded:</b> ' + crowded.map(function(r){ return vnSym(r.s) + ' ' + vnPct(r.si, 0, false); }).join(', ') + ' (10%+ of float and 3+ days to cover).</p>' : '') +
      (hardToBorrow.length ? '<p class="mm-callout"><b>Priced hard to borrow:</b> ' + hardToBorrow.map(function(r){ return vnSym(r.s) + ' ' + vnPct(r.bw, 0, false); }).join(', ') + ' a year, from the option market, not a broker quote.</p>' : '') +
      VIEWS.tableHtml(cols, rows, { key: 'mm-shorts', empty: 'No readings.' }) +
      '<p class="mm-note">FINRA short interest, settlement ' + escapeHtml(latest || '—') + '. FINRA publishes it twice a month, about a week after each settlement date. ETFs are left out. Implied borrow is the financing rate in put-call parity at the chain nearest 60 days, less the dividend yield; the ± band is half the bid-ask spread as a yearly rate, so a reading inside it means nothing.</p>';
  }

  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-mm-tab]') : null;
    if (!t) return;
    mmSetView('tab', t.getAttribute('data-mm-tab'));
    renderMarketMap();
  });
  document.addEventListener('change', function(ev){
    var t = ev.target;
    if (!t || !t.closest || !t.closest('#mm-root')) return;
    if (t.hasAttribute('data-mm-x')) mmSetView('x', t.value);
    else if (t.hasAttribute('data-mm-y')) mmSetView('y', t.value);
    else if (t.hasAttribute('data-mm-etf')) mmSetView('etf', !!t.checked);
    else if (t.hasAttribute('data-mm-wall-sort')) mmSetView('wallSort', t.value);
    else if (t.hasAttribute('data-mm-wall-group')) mmSetView('wallGroup', t.value);
    else if (t.hasAttribute('data-mm-wall-side')) mmSetView('wallSide', t.value);
    else return;
    renderMarketMap();
  });

  // ---- Option volume by expiry (Unusual options trades page) ---------------
  var zdteState = { loading: false, done: false };
  function loadZeroDte(){
    if (zdteState.done || zdteState.loading) return;
    zdteState.loading = true;
    vnJson('market-map.json').then(function(j){
      zdteState.loading = false; zdteState.done = true;
      renderZeroDte(j && j.zeroDte);
    });
  }
  function renderZeroDte(z){
    var root = document.getElementById('zdte-root');
    if (!root) return;
    if (!z || !z.total || !z.total.all){ root.innerHTML = '<p class="zdte-empty">No option volume in the last build yet.</p>'; return; }
    var asof = document.getElementById('zdte-asof');
    if (asof) asof.textContent = z.asOf ? 'As of ' + vnWhen(z.asOf) : '';
    var T = z.total;
    var parts = (z.buckets || []).map(function(b){ return { key: b.key, label: b.label, v: T[b.key] || 0 }; });
    var bar = '<div class="zdte-bar" role="img" aria-label="Share of option volume by days to expiry">' + parts.map(function(p, i){
      var w = p.v / T.all * 100;
      return w > 0 ? '<i class="zdte-seg zdte-s' + i + '" style="width:' + w.toFixed(2) + '%" title="' + escapeHtml(p.label + ': ' + w.toFixed(1) + '%') + '"></i>' : '';
    }).join('') + '</div><ul class="zdte-keys">' + parts.map(function(p, i){
      return '<li><i class="zdte-seg zdte-s' + i + '"></i>' + escapeHtml(p.label) + ' <b>' + (p.v / T.all * 100).toFixed(1) + '%</b></li>';
    }).join('') + '</ul>';
    var rows = (z.rows || []).slice().sort(function(a, b){ return (b.nearPct || 0) - (a.nearPct || 0); }).filter(function(r){ return r.all >= 2000; }).slice(0, 12);
    var cols = [
      { label: 'Stock', cell: function(r){ return vnSym(r.s); }, sort: function(r){ return r.s; } },
      { label: 'Same day', num: true, cell: function(r){ return r.d0Pct != null ? vnPct(r.d0Pct, 0, false) : '<span title="No option on this stock expires today">—</span>'; }, sort: function(r){ return r.d0Pct; } },
      { label: 'Within a week', num: true, cell: function(r){ return vtBarHtml((r.nearPct || 0) / 100, '', vnPct(r.nearPct, 0, false)); }, sort: function(r){ return r.nearPct; } },
      { label: 'Contracts', num: true, cell: function(r){ return Number(r.all).toLocaleString(); }, sort: function(r){ return r.all; } }
    ];
    var friday = new Date(z.date + 'T12:00:00Z').getUTCDay() === 5;
    root.innerHTML = '<p class="zdte-lede"><b>' + vnPct(T.d0Pct, 0, false) + '</b> of option contracts traded by the build expire the same day, and <b>' + vnPct(T.nearPct, 0, false) + '</b> within a week.</p>' + bar +
      (rows.length ? '<h3 class="mm-h3">Most short-dated trading</h3>' + VIEWS.tableHtml(cols, rows, { key: 'zdte', empty: '' }) : '') +
      '<p class="zdte-note">' + escapeHtml(z.note || '') + ' ' + (friday ? 'Today is a Friday, when most stocks have an expiry.' : 'Most single stocks only expire on Fridays; SPY, QQQ and IWM expire every day.') + '</p>';
  }

  // ---- What changed --------------------------------------------------------
  var WC_KINDS = [['ma', 'Average crosses'], ['streak', 'Streaks'], ['wall', 'Options walls'], ['iv', 'Option prices'], ['flow', 'Unusual trades'], ['13f', 'Fund filings'], ['insider', 'Insider trades'], ['grade', 'Grade moves']];
  var wcState = { data: null, loading: false, error: false, daily: null, dailyLoading: false };
  function loadWhatsChanged(){
    wcLoadOwner();
    if (wcState.data || wcState.loading){ renderWhatsChanged(); return; }
    wcState.loading = true;
    renderWhatsChanged();
    vnJson('site-changes.json').then(function(j){
      wcState.loading = false;
      if (j && Array.isArray(j.items)) wcState.data = j; else wcState.error = true;
      renderWhatsChanged();
    });
  }
  function wcLoadOwner(){
    if (!HAS_OWNER_ACCESS || wcState.daily || wcState.dailyLoading) return;
    wcState.dailyLoading = true;
    vnJson('grades-daily.json', true).then(function(j){
      wcState.dailyLoading = false;
      wcState.daily = j && Array.isArray(j.days) ? j : { days: [] };
      var pane = document.getElementById('page-pane-whats-changed');
      if (pane && !pane.hidden) renderWhatsChanged();
    });
  }
  // Owner layer: grade totals that moved 2+ points between the last two days.
  function wcGradeItems(){
    if (!HAS_OWNER_ACCESS || !wcState.daily) return [];
    var days = (wcState.daily.days || []).filter(function(dd){ return dd && dd.date && dd.totals; }).sort(function(a, b){ return a.date < b.date ? -1 : 1; });
    if (days.length < 2) return [];
    var cur = days[days.length - 1], prev = days[days.length - 2];
    var out = [];
    Object.keys(cur.totals).forEach(function(s){
      var a = Number(prev.totals[s]), b = Number(cur.totals[s]);
      if (!isFinite(a) || !isFinite(b) || Math.abs(b - a) < 2) return;
      out.push({ kind: 'grade', s: s, tone: b > a ? 'up' : 'down', text: 'Grade ' + a.toFixed(1) + ' → ' + b.toFixed(1) + ' (' + (b > a ? '+' : '') + (b - a).toFixed(1) + ')', d: Math.abs(b - a), owner: true, from: prev.date, to: cur.date });
    });
    return out.sort(function(x, y){ return y.d - x.d; });
  }
  function renderWhatsChanged(){
    var root = document.getElementById('wc-root');
    if (!root) return;
    var d = wcState.data;
    if (!d){ root.innerHTML = '<p class="wc-empty">' + (wcState.error ? 'What changed could not load. The next full build writes it.' : 'Loading what changed…') + '</p>'; return; }
    var asof = document.getElementById('wc-asof');
    if (asof) asof.textContent = d.builtAtIso ? 'Built ' + vnWhen(d.builtAtIso) : '';
    var items = (d.items || []).slice();
    var grades = wcGradeItems();
    items = items.concat(grades);
    var filter = VIEWS.get('whats-changed.kind', '');
    var counts = {};
    items.forEach(function(it){ counts[it.kind] = (counts[it.kind] || 0) + 1; });
    var head = d.since
      ? '<p class="wc-lede">Comparing the latest build (' + escapeHtml(vnWhen(d.builtAtIso)) + ') with the last build of ' + escapeHtml(vnDay(d.since)) + '.</p>'
      : '<p class="wc-lede">The first snapshot was saved ' + escapeHtml(vnWhen(d.builtAtIso)) + '. Changes show after the first build of the next trading day.</p>';
    var chips = '<div class="wc-chips" role="group" aria-label="Show"><button type="button" data-wc-kind="" class="wc-chip' + (!filter ? ' is-on' : '') + '">All <b>' + items.length + '</b></button>' +
      WC_KINDS.filter(function(k){ return counts[k[0]] && (k[0] !== 'grade' || HAS_OWNER_ACCESS); }).map(function(k){
        return '<button type="button" data-wc-kind="' + k[0] + '" class="wc-chip' + (filter === k[0] ? ' is-on' : '') + '">' + escapeHtml(k[1]) + ' <b>' + counts[k[0]] + '</b></button>';
      }).join('') + '</div>';
    var sections = WC_KINDS.filter(function(k){ return counts[k[0]] && (!filter || filter === k[0]); }).map(function(k){
      var list = items.filter(function(it){ return it.kind === k[0]; });
      if (k[0] === 'flow') list.sort(function(a, b){ return (b.prem || 0) - (a.prem || 0); });
      var shown = list.slice(0, filter ? 400 : 25);
      return '<section class="wc-sec' + (k[0] === 'grade' ? ' is-owner' : '') + '"><h3 class="mm-h3">' + escapeHtml(k[1]) + ' <span class="wc-count">' + list.length + '</span>' + (k[0] === 'grade' ? ' <span class="mm-owner-tag">Owner</span>' : '') + '</h3><ul class="wc-list">' +
        shown.map(function(it){
          return '<li class="wc-item' + (it.tone ? ' is-' + it.tone : '') + '">' + (it.s ? (it.owner ? '<a class="vn-sym" href="' + escapeHtml(symGradeHref(it.s)) + '">' + escapeHtml(it.s) + '</a>' : vnSym(it.s)) : '') + '<span>' + escapeHtml(it.text || '') + '</span></li>';
        }).join('') + '</ul>' + (list.length > shown.length ? '<button type="button" class="wc-more" data-wc-kind="' + k[0] + '">Show all ' + list.length + '</button>' : '') +
        (k[0] === 'grade' ? '<p class="mm-note">Grade totals from ' + escapeHtml(vnDay(grades[0] && grades[0].from)) + ' to ' + escapeHtml(vnDay(grades[0] && grades[0].to)) + ', moves of 2 points or more.</p>' : '') + '</section>';
    }).join('');
    root.innerHTML = head + (items.length ? chips + sections : '<p class="wc-empty">Nothing changed between the two builds.</p>');
  }
  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-wc-kind]') : null;
    if (!t) return;
    VIEWS.set('whats-changed.kind', t.getAttribute('data-wc-kind'));
    renderWhatsChanged();
  });

  // ---- Past days -----------------------------------------------------------
  var pdState = { days: null, map: null, loading: false, error: false, date: null, briefs: null, briefsLoading: false, runs: {}, acc: null, accLoading: false };
  function loadPastDays(){
    pdLoadOwner();
    if (pdState.days || pdState.loading){ renderPastDays(); return; }
    pdState.loading = true;
    renderPastDays();
    Promise.all([vnJson('market-days.json'), vnJson('market-map.json')]).then(function(res){
      pdState.loading = false;
      if (res[0] && Array.isArray(res[0].dates) && res[0].dates.length){
        pdState.days = res[0];
        pdState.map = res[1] && Array.isArray(res[1].rows) ? res[1] : { rows: [] };
        if (!pdState.date) pdState.date = pdState.days.dates[pdState.days.dates.length - 1];
      } else pdState.error = true;
      renderPastDays();
    });
  }
  function pdLoadOwner(){
    if (!HAS_OWNER_ACCESS) return;
    function repaint(){ var pane = document.getElementById('page-pane-past-day'); if (pane && !pane.hidden) renderPastDays(); }
    if (!pdState.briefs && !pdState.briefsLoading){
      pdState.briefsLoading = true;
      vnJson('market-days-briefs.json', true).then(function(j){ pdState.briefsLoading = false; pdState.briefs = j && Array.isArray(j.briefs) ? j : { briefs: [] }; repaint(); });
    }
    if (!pdState.acc && !pdState.accLoading){
      pdState.accLoading = true;
      vnJson('picks-accuracy.json', true).then(function(j){ pdState.accLoading = false; pdState.acc = j || { open: [], closed: [] }; repaint(); });
    }
    var date = pdState.date;
    if (date && pdState.runs[date] === undefined){
      pdState.runs[date] = null;
      vnJson('picks-run-' + date + '.json', true).then(function(j){ pdState.runs[date] = j && Array.isArray(j.runs) ? j : false; repaint(); });
    }
  }
  function pdMove(sym, i){
    var row = pdState.days.moves && pdState.days.moves[sym];
    var v = row ? row[i] : null;
    return v == null ? null : v / 100;
  }
  function pdTreemapHtml(i){
    // Stocks only: SPY / QQQ / IWM already have their own tiles above.
    var rows = (pdState.map.rows || []).filter(function(r){ return r && !r.etf && r.mc > 0 && pdState.days.moves[r.s]; });
    if (!rows.length) return '';
    var groups = {};
    rows.forEach(function(r){ var g = r.g || 'Other'; (groups[g] = groups[g] || { name: g, value: 0, items: [] }); groups[g].items.push(r); groups[g].value += r.mc; });
    var list = Object.keys(groups).map(function(k){ return groups[k]; }).sort(function(a, b){ return b.value - a.value; });
    var rects = heatmapSquarify(list, 0, 0, 100, 100);
    var root = document.getElementById('pd-root');
    var W = (root && root.clientWidth) || 900, H = 440;
    var html = '';
    rects.forEach(function(gr){
      var sectorPx = H * gr.h / 100;
      var showLabel = sectorPx >= 44;
      var labelPad = showLabel ? 16 / sectorPx * 100 : 0;
      var inner = gr.items.slice().sort(function(a, b){ return b.mc - a.mc; }).map(function(it){ return Object.assign({}, it, { value: it.mc }); });
      var tiles = heatmapSquarify(inner, 0, labelPad, 100, 100 - labelPad);
      html += '<div class="heatmap-sector" style="--x:' + gr.x.toFixed(3) + ';--y:' + gr.y.toFixed(3) + ';--w:' + gr.w.toFixed(3) + ';--h:' + gr.h.toFixed(3) + '">' + (showLabel ? '<div class="heatmap-sector-label">' + escapeHtml(gr.name) + '</div>' : '');
      tiles.forEach(function(t){
        var mv = pdMove(t.s, i);
        var pxW = W * gr.w / 100 * t.w / 100, pxH = H * gr.h / 100 * t.h / 100;
        var tiny = pxH < 16 || pxW < 22 ? ' is-tiny is-micro' : (pxH < 34 || pxW < 36 ? ' is-tiny' : '');
        // Same color scale as the Heatmap page; pale tiles take dark text in light mode.
        var cp = typeof heatmapColorParts === 'function' ? heatmapColorParts(mv, '1d') : { dir: mv == null || mv === 0 ? 'zero' : mv > 0 ? 'pos' : 'neg', intensity: mv == null ? 0 : Math.min(1, Math.abs(mv) / 3) };
        var dir = cp.dir, inten = cp.intensity;
        var sym = Math.min(24, Math.max(9, Math.round(Math.min(pxH * 0.4, pxW * 0.22))));
        html += '<a class="heatmap-tile pd-tile' + tiny + '" href="' + escapeHtml(vnHref(t.s)) + '" data-dir="' + dir + '"' + (inten < 0.4 ? ' data-faint="1"' : '') + ' title="' + escapeHtml(t.s + (t.n ? ' · ' + t.n : '') + ': ' + (mv == null ? 'no close' : vnPct(mv, 2))) + '" style="--x:' + t.x.toFixed(3) + ';--y:' + t.y.toFixed(3) + ';--w:' + t.w.toFixed(3) + ';--h:' + t.h.toFixed(3) + ';--hm-intensity:' + inten.toFixed(3) + ';--hm-sym-size:' + sym + 'px;--hm-pct-size:' + Math.max(9, Math.round(sym * 0.72)) + 'px">' +
          '<span class="heatmap-tile-sym">' + escapeHtml(t.s) + '</span><span class="heatmap-tile-pct">' + escapeHtml(mv == null ? '—' : vnPct(mv, 1)) + '</span></a>';
      });
      html += '</div>';
    });
    return '<div class="pd-map" style="height:' + H + 'px">' + html + '</div>';
  }
  function pdBriefsSince(){
    var first = pdState.briefs && (pdState.briefs.briefs || []).reduce(function(m, b){ return b && b.date && (!m || b.date < m) ? b.date : m; }, null);
    return first ? 'Briefs are saved from ' + vnDay(first) + ' on, for about six months.' : 'Briefs are saved from the first build after this page went live, for about six months.';
  }
  function pdOwnerHtml(date){
    if (!HAS_OWNER_ACCESS) return '';
    var out = '<section class="pd-owner"><h3 class="mm-h3">That day for you <span class="mm-owner-tag">Owner</span></h3>';
    var briefs = pdState.briefs ? (pdState.briefs.briefs || []).filter(function(b){ return b.date === date; }) : null;
    out += '<h4 class="pd-h4">Market Brief</h4>' + (briefs == null ? '<p class="mm-note">Loading…</p>' : briefs.length ? '<ul class="pd-briefs">' + briefs.map(function(b){
      return '<li><span class="pd-brief-when">' + escapeHtml(vnWhen(b.at) || (b.kind || '')) + '</span><b>' + escapeHtml(b.headline) + '</b>' + (b.summary ? '<p>' + escapeHtml(b.summary) + '</p>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="mm-note">No saved Brief for this day. ' + pdBriefsSince() + '</p>');
    var run = pdState.runs[date];
    out += '<h4 class="pd-h4">Top Picks runs</h4>';
    if (run === undefined || run === null) out += '<p class="mm-note">Loading…</p>';
    else if (run === false) out += '<p class="mm-note">No run archive for this day. The archive starts Nov 7, 2026.</p>';
    else out += run.runs.map(function(r){
      var picks = Array.isArray(r.picks) ? r.picks : [];
      var shipped = picks.filter(function(p){ return p && p.group === 'actionable'; });
      return '<div class="pd-run"><b>' + escapeHtml(r.et || vnWhen(r.builtAtIso)) + '</b> · ' + (Array.isArray(r.rows) && r.rows.length ? r.rows.length + ' names scored · ' : '') + (shipped.length ? shipped.length + ' ready to buy: ' + shipped.map(function(p){ return '<a class="vn-sym" href="' + escapeHtml(symGradeHref(p.s)) + '">' + escapeHtml(p.s) + '</a> ' + escapeHtml(p.side === 'put' ? 'put' : 'call') + (p.tot != null ? ' (' + Number(p.tot).toFixed(1) + ')' : ''); }).join(', ') : 'nothing ready to buy') +
        (picks.length > shipped.length ? '<span class="mm-dim"> · ' + (picks.length - shipped.length) + ' on watch</span>' : '') + '</div>';
    }).join('');
    var acc = pdState.acc;
    out += '<h4 class="pd-h4">Track record</h4>';
    if (!acc) out += '<p class="mm-note">Loading…</p>';
    else {
      var opened = (acc.open || []).concat(acc.closed || []).filter(function(e){ return e && vnEtDate(e.entryDate) === date; });
      var closed = (acc.closed || []).filter(function(e){ return e && vnEtDate(e.exitDate) === date; });
      function line(e, isClose){
        return '<li><a class="vn-sym" href="' + escapeHtml(symGradeHref(e.symbol)) + '">' + escapeHtml(e.symbol) + '</a> ' + escapeHtml(e.side === 'put' ? 'put' : 'call') + (isClose ? ' closed, ' + escapeHtml(String(e.status || e.outcome || '').replace(/-/g, ' ')) + ' ' : ' opened' + (e.optionPnlPct != null ? '<span class="mm-dim"> · ' + (e.exitDate ? 'closed at ' : 'now ') + '</span>' : ' ')) + (e.optionPnlPct != null ? vnChg(e.optionPnlPct, 0) : '') + '</li>';
      }
      out += opened.length || closed.length ? '<ul class="pd-trades">' + opened.map(function(e){ return line(e, false); }).join('') + closed.map(function(e){ return line(e, true); }).join('') + '</ul>' : '<p class="mm-note">No trades opened or closed that day.</p>';
    }
    return out + '</section>';
  }
  function renderPastDays(){
    var root = document.getElementById('pd-root');
    if (!root) return;
    var D = pdState.days;
    if (!D){ root.innerHTML = '<p class="pd-empty">' + (pdState.error ? 'Past days could not load. The next full build writes it.' : 'Loading past days…') + '</p>'; return; }
    var dates = D.dates;
    var i = dates.indexOf(pdState.date);
    if (i < 0){ i = dates.length - 1; pdState.date = dates[i]; }
    var date = dates[i];
    pdLoadOwner();
    var asof = document.getElementById('pd-asof');
    if (asof) asof.textContent = dates.length + ' trading days';
    var opts = dates.slice().reverse().map(function(dt){ return '<option value="' + dt + '"' + (dt === date ? ' selected' : '') + '>' + escapeHtml(vnDay(dt)) + '</option>'; }).join('');
    var idx = ['SPY', 'QQQ', 'IWM'].map(function(s){
      var arr = D.index && D.index[s];
      if (!arr) return '';
      var c = arr[i], p = i > 0 ? arr[i - 1] : null;
      var ch = c != null && p ? (c / p - 1) * 100 : null;
      return '<div class="mm-kpi"><span>' + s + '</span><b>' + (c != null ? '$' + Number(c).toFixed(2) : '—') + '</b>' + vnChg(ch, 2) + '</div>';
    }).join('');
    var up = 0, dn = 0, capSum = 0, capMove = 0, movers = [];
    (pdState.map.rows || []).forEach(function(r){
      if (!r || r.etf) return;
      var mv = pdMove(r.s, i);
      if (mv == null) return;
      if (mv > 0) up++; else if (mv < 0) dn++;
      if (r.mc > 0){ capSum += r.mc; capMove += r.mc * mv; }
      movers.push({ s: r.s, n: r.n, mv: mv });
    });
    movers.sort(function(a, b){ return b.mv - a.mv; });
    function moverList(list){ return '<ol class="pd-movers">' + list.map(function(m){ return '<li>' + vnSym(m.s) + ' ' + vnChg(m.mv, 1) + '</li>'; }).join('') + '</ol>'; }
    root.innerHTML = '<div class="pd-pick"><button type="button" class="pd-step" data-pd-step="-1"' + (i <= 0 ? ' disabled' : '') + ' aria-label="Earlier day">‹</button>' +
      '<label><span class="sr-only">Trading day</span><select data-pd-date>' + opts + '</select></label>' +
      '<button type="button" class="pd-step" data-pd-step="1"' + (i >= dates.length - 1 ? ' disabled' : '') + ' aria-label="Later day">›</button>' +
      (i < dates.length - 1 ? '<button type="button" class="pd-latest" data-pd-latest>Latest day</button>' : '') + '</div>' +
      '<div class="mm-kpis">' + idx + '<div class="mm-kpi"><span>Stocks up / down</span><b><span class="pos">' + up + '</span> / <span class="neg">' + dn + '</span></b></div>' +
      '<div class="mm-kpi"><span>Value-weighted move</span><b>' + vnChg(capSum ? capMove / capSum : null, 2) + '</b></div></div>' +
      pdTreemapHtml(i) +
      (movers.length ? '<div class="pd-cols"><div><h3 class="mm-h3">Biggest gains</h3>' + moverList(movers.slice(0, 5)) + '</div><div><h3 class="mm-h3">Biggest drops</h3>' + moverList(movers.slice(-5).reverse()) + '</div></div>' : '') +
      pdOwnerHtml(date) +
      '<p class="mm-note">Moves are each stock’s close against its close the session before. The written Brief is not part of the public archive.</p>';
  }
  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-pd-step], [data-pd-latest]') : null;
    if (!t || !pdState.days) return;
    var dates = pdState.days.dates;
    var i = dates.indexOf(pdState.date);
    if (t.hasAttribute('data-pd-latest')) i = dates.length - 1;
    else i = Math.max(0, Math.min(dates.length - 1, i + Number(t.getAttribute('data-pd-step'))));
    pdState.date = dates[i];
    renderPastDays();
  });
  document.addEventListener('change', function(ev){
    var t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-pd-date')) return;
    pdState.date = t.value;
    renderPastDays();
  });

  // Owner layers arrive after the session probe.
  document.addEventListener('stonks-owner-ready', function(){
    if (!HAS_OWNER_ACCESS) return;
    var open = function(id){ var p = document.getElementById('page-pane-' + id); return p && !p.hidden; };
    if (open('market-map')){ mmLoadOpen(); renderMarketMap(); }
    if (open('whats-changed')) wcLoadOwner();
    if (open('past-day')) pdLoadOwner();
  });
`;
}

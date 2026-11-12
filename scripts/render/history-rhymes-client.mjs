// Browser code for the "Booms & busts" page (2026-11-12, lib/history-rhymes.mjs).
// Pasted into the app.js IIFE after crowd-client.mjs, so it may use the vn*
// helpers, VIEWS, niceTicks, chHoverAttr, rowSparkHtml and dataUrl. ES5 only,
// inside a template string: write regex escapes as \\d, no backticks.
//
// Public: the railroad, telecom and 2008 housing case studies, today's AI
// buildout, the market-wide warning signs read from site data, credit spreads
// and dated CDS quotes reported in the press. Owner-only: the Stocks tab
// (history-rhymes-owner.json: each covered stock's buildout role and
// equity-implied default read). A public visitor never requests the Owner file
// (vnJson(..., true) resolves to null without the Owner session).
//
// The Risk analysis page shows a one-line context card from the public file
// (loadHistoryRhymesRisk); it is not one of the seven voting desks.
export function renderHistoryRhymesJs() {
  return `
  // ---- Booms & busts ---------------------------------------------------------
  var HR_TABS = [['now', 'Now vs history'], ['railroads', 'Railroads'], ['telecom', 'Telecom & fiber'], ['housing', 'Housing & 2008'], ['ai', 'AI data centers'], ['credit', 'Credit & CDS']];
  var HR_OWNER_TAB = ['stocks', 'Stocks (Owner)'];
  var HR_CASE_NAMES = { railroads: 'Railroads', telecom: 'Telecom', housing: 'Housing' };
  var hrState = { data: null, owner: null, ownerTried: false, loading: false, error: null, fetchedAt: 0, urlView: null };
  try { hrState.urlView = new URLSearchParams(location.search).get('view'); } catch (_) {}
  function hrTabs(){ return HAS_OWNER_ACCESS ? HR_TABS.concat([HR_OWNER_TAB]) : HR_TABS; }
  function hrTab(){
    var t = VIEWS.get('history-rhymes.tab', 'now');
    if (hrState.urlView){ t = hrState.urlView; hrState.urlView = null; VIEWS.set('history-rhymes.tab', t); }
    if (!hrTabs().some(function(x){ return x[0] === t; })) t = 'now';
    return t;
  }
  function hrSource(id){
    var d = hrState.data, list = d && d.sources || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function hrSourceLink(id, text){
    var s = hrSource(id);
    if (!s || !s.url) return text ? escapeHtml(text) : '';
    return '<a class="hr-src" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" title="' + escapeHtml(s.label) + '">' + escapeHtml(text || 'source') + '</a>';
  }
  function hrUsd(v){
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e12) return sign + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(0) + 'M';
    return sign + '$' + a.toFixed(0);
  }
  function hrPct(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d) + '%'; }
  function hrStatusPill(s){
    var map = { lit: ['Showing', 'is-lit'], partial: ['Partly', 'is-partial'], clear: ['Not showing', 'is-clear'], unknown: ['No reading', 'is-unknown'] };
    var m = map[s] || map.unknown;
    return '<span class="hr-pill ' + m[1] + '">' + m[0] + '</span>';
  }
  function hrX(x){
    if (typeof x === 'number') return x;
    var s = String(x || '');
    if (/^\\d{4}$/.test(s)) s += '-07-01';
    else if (/^\\d{4}-\\d{2}$/.test(s)) s += '-15';
    var t = Date.parse(s.slice(0, 10) + 'T00:00:00Z');
    return isFinite(t) ? t : null;
  }
  // Date-axis (or numeric-axis) line chart with up to four series, dated
  // markers and the shared hover readout. o: { series: [{ name, rows: [[x, v]],
  // cls }], xNum, xFmt(x), yFmt(v), marks: [{ x, label }], h, aria, zero }.
  function hrTimeSvg(o){
    o = o || {};
    var narrow = typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 560;
    var W = narrow ? 380 : 900, H = Math.round((o.h || 240) * (narrow ? 0.9 : 1.2)), padL = 50, padR = 14, padT = 14, padB = 26;
    var ser = (o.series || []).map(function(s, i){
      var pts = [];
      (s.rows || []).forEach(function(r){
        var x = o.xNum ? Number(r[0]) : hrX(r[0]), v = Number(r[1]);
        if (x != null && isFinite(x) && r[1] != null && isFinite(v)) pts.push({ x: x, v: v, label: r[2] != null ? String(r[2]) : String(r[0]) });
      });
      return { name: s.name, cls: s.cls || ('ln-s' + i), pts: pts, dashed: !!s.dashed };
    }).filter(function(s){ return s.pts.length > 1; });
    if (!ser.length) return '';
    var x0 = Infinity, x1 = -Infinity, lo = Infinity, hi = -Infinity;
    ser.forEach(function(s){ s.pts.forEach(function(p){ if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }); });
    if (o.zero){ lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo){ lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    if (o.zero && lo > 0) lo = 0;
    var ticks = niceTicks(lo, hi, 5);
    if (ticks.values.length > 1){
      var st = ticks.values[1] - ticks.values[0];
      lo = Math.floor(lo / st + 1e-9) * st; hi = Math.ceil(hi / st - 1e-9) * st;
      ticks = niceTicks(lo, hi, Math.round((hi - lo) / st) + 1);
    }
    if (x1 === x0) x1 = x0 + 1;
    var yFmt = o.yFmt || function(v){ return v.toFixed(ticks.decimals); };
    function X(x){ return padL + (W - padL - padR) * (x - x0) / (x1 - x0); }
    function Y(v){ return padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo)); }
    var g = '';
    ticks.values.forEach(function(t){
      g += '<line class="ln-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>' +
        '<text class="ln-tick" x="' + (padL - 6) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end">' + escapeHtml(yFmt(t)) + '</text>';
    });
    if (o.zero && lo < 0 && hi > 0) g += '<line class="ln-zero" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>';
    var xticks = [];
    if (o.xNum){
      xticks = niceTicks(x0, x1, narrow ? 5 : 8).values.map(function(v){ return [v, o.xFmt ? o.xFmt(v) : String(v)]; });
    } else {
      var y0 = new Date(x0).getUTCFullYear(), y1 = new Date(x1).getUTCFullYear(), span = Math.max(1, y1 - y0);
      var want = narrow ? 5 : 9, steps = [1, 2, 5, 10, 20, 25, 50], step = 50;
      for (var si = 0; si < steps.length; si++) if (span / steps[si] <= want){ step = steps[si]; break; }
      for (var yr = Math.ceil(y0 / step) * step; yr <= y1; yr += step){
        var tx = Date.UTC(yr, 0, 1);
        if (tx >= x0 && tx <= x1) xticks.push([tx, String(yr)]);
      }
    }
    xticks.forEach(function(t){
      g += '<text class="ln-tick" x="' + X(t[0]).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + escapeHtml(t[1]) + '</text>';
    });
    (o.marks || []).forEach(function(m, mi){
      var mx = o.xNum ? Number(m.x) : hrX(m.x);
      if (mx == null || !isFinite(mx) || mx < x0 || mx > x1) return;
      g += '<line class="hr-mark" x1="' + X(mx).toFixed(1) + '" x2="' + X(mx).toFixed(1) + '" y1="' + padT + '" y2="' + (H - padB) + '"><title>' + escapeHtml(m.label) + '</title></line>';
      // Labels in the right half sit left of their line so they stay inside.
      var flip = X(mx) > W * 0.55;
      if (!narrow) g += '<text class="hr-mark-lbl" x="' + (X(mx) + (flip ? -4 : 4)).toFixed(1) + '" y="' + (padT + 10 + (mi % 3) * 12) + '"' + (flip ? ' text-anchor="end"' : '') + '>' + escapeHtml(m.label) + '</text>';
    });
    var lines = '';
    for (var k = ser.length - 1; k >= 0; k--){
      var d = '';
      ser[k].pts.forEach(function(p, i){ d += (i ? 'L' : 'M') + X(p.x).toFixed(1) + ',' + Y(p.v).toFixed(1); });
      lines += '<path class="ln-line ' + ser[k].cls + (ser[k].dashed ? ' ln-dashed' : '') + '" d="' + d + '"/>';
    }
    // Hover rides series 0 (thinned to at most 360 points); other series show
    // their nearest value at that x.
    var lead = ser[0].pts, every = Math.max(1, Math.ceil(lead.length / 360)), hov = [];
    function nearest(pts, x){
      var a = 0, b = pts.length - 1;
      while (b - a > 1){ var m = (a + b) >> 1; if (pts[m].x <= x) a = m; else b = m; }
      return Math.abs(pts[a].x - x) <= Math.abs(pts[b].x - x) ? pts[a] : pts[b];
    }
    var tol = (x1 - x0) * 0.02;
    for (var h = 0; h < lead.length; h++){
      if (h % every !== 0 && h !== lead.length - 1) continue;
      var p = lead[h], txt = p.label + '\\n' + ser[0].name + ': ' + yFmt(p.v);
      for (var s2 = 1; s2 < ser.length; s2++){
        var q = nearest(ser[s2].pts, p.x);
        if (q && Math.abs(q.x - p.x) <= tol) txt += '\\n' + ser[s2].name + ': ' + yFmt(q.v) + (o.xNum ? ' (' + q.label + ')' : '');
      }
      hov.push({ x: X(p.x), y: Y(p.v), label: txt });
    }
    var legend = ser.length > 1 || o.legend ? '<p class="hr-legend">' + ser.map(function(s){ return '<span><i class="hr-sw ' + s.cls + (s.dashed ? ' is-dashed' : '') + '"></i>' + escapeHtml(s.name) + '</span>'; }).join('') + '</p>' : '';
    return '<div class="hr-chart"><svg class="hr-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escapeHtml(o.aria || 'Chart') + '"' + chHoverAttr(hov) + '>' + g + lines + '</svg>' + legend + '</div>';
  }
  function hrNumbersHtml(list){
    list = (list || []).filter(function(n){ return n && n.value; });
    if (!list.length) return '';
    return '<div class="hr-numbers">' + list.map(function(n){
      return '<div class="hr-num"><b>' + escapeHtml(n.value) + '</b><span>' + escapeHtml(n.label) + '</span>' +
        (n.detail ? '<small>' + escapeHtml(n.detail) + '</small>' : '') +
        (n.source ? '<small>' + hrSourceLink(n.source, 'source') + '</small>' : n.computed ? '<small class="hr-dim">measured from site history</small>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function hrTimelineHtml(list){
    if (!list || !list.length) return '';
    return '<ol class="hr-timeline">' + list.map(function(e){
      return '<li><time>' + escapeHtml(e.date) + '</time><span>' + escapeHtml(e.text) + (e.source ? ' ' + hrSourceLink(e.source, 'source') : '') + '</span></li>';
    }).join('') + '</ol>';
  }
  function hrCase(id){
    var d = hrState.data, list = d && d.cases || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // One case study: summary, the story, numbers, extra charts, timeline, how
  // it rhymes with today and how it differs, and its sources.
  function hrCaseHtml(id, extraNumbers, charts){
    var c = hrCase(id);
    if (!c) return '<p class="hr-empty">This case is not in the saved file.</p>';
    var nums = (extraNumbers || []).map(function(n){ return { label: n.label, value: n.value, detail: n.detail, source: n.source, computed: !n.source }; }).concat(c.numbers || []);
    return '<article class="hr-case">' +
      '<p class="hr-era">' + escapeHtml(c.era) + '</p>' +
      '<p class="hr-lede">' + escapeHtml(c.summary) + '</p>' +
      hrNumbersHtml(nums) +
      (charts || '') +
      '<div class="hr-story">' + (c.story || []).map(function(p){ return '<p>' + escapeHtml(p) + '</p>'; }).join('') + '</div>' +
      '<div class="hr-compare"><div class="hr-rhyme"><h4>How it rhymes with today</h4><p>' + escapeHtml(c.rhyme) + '</p></div><div class="hr-differs"><h4>How today is different</h4><p>' + escapeHtml(c.differs) + '</p></div></div>' +
      (c.timeline && c.timeline.length ? '<h4 class="hr-h4">Timeline</h4>' + hrTimelineHtml(c.timeline) : '') +
      '<p class="hr-sources-line">Sources: ' + (c.sources || []).map(function(s){ var src = hrSource(s); return src ? hrSourceLink(s, src.label) : ''; }).filter(Boolean).join(' · ') + '</p>' +
    '</article>';
  }

  // ---- Now vs history ----
  function hrHeroHtml(d){
    var n = d.now || {}, st = n.stage || {}, m = n.mostLike, cr = d.credit && d.credit.baa;
    var tone = st.id === 'bust' ? 'is-bust' : st.id === 'late' ? 'is-late' : st.id === 'boom' ? 'is-boom' : 'is-early';
    var k = [
      ['Warning signs showing', (n.score != null ? n.score : '—') + ' of ' + (n.total || 9) + (n.known != null && n.known < (n.total || 9) ? ' <small class="hr-dim">(' + n.known + ' read)</small>' : '')],
      ['Closest past case', m ? escapeHtml(m.name) + ' <small class="hr-dim">' + m.shared + ' of ' + m.caseSigns + ' signs shared</small>' : '—'],
    ];
    if (cr && cr.now) k.push(['Baa corporate spread', vnNum(cr.now.v, 2) + ' pts <small class="hr-dim">' + (cr.pctile != null ? vnOrd(cr.pctile) + ' percentile since ' + escapeHtml(String(cr.since || '').slice(0, 4)) : '') + '</small>']);
    var hy = d.credit && d.credit.hy;
    if (hy && hy.now) k.push(['High-yield spread', vnNum(hy.now.v, 2) + ' pts' + (hy.chg3m != null ? ' <small class="hr-dim">' + (hy.chg3m >= 0 ? '+' : '') + vnNum(hy.chg3m, 2) + ' in 3 months</small>' : '')]);
    return '<div class="hr-hero ' + tone + '"><div class="hr-hero-lead"><span class="hr-kicker">Where today sits, by the signs that came before past busts</span><b class="hr-stage">' + escapeHtml(st.label || '—') + '</b><p>' + escapeHtml(st.note || '') + '</p></div>' +
      '<div class="mm-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div></div>';
  }
  function hrSignsHtml(d){
    var signs = d.now && d.now.signs || [];
    return '<div class="hr-signs">' + signs.map(function(s){
      return '<article class="hr-sign is-' + escapeHtml(s.status || 'unknown') + '"><header>' + hrStatusPill(s.status) + '<h4>' + escapeHtml(s.label) + '</h4></header>' +
        '<p class="hr-now">' + escapeHtml(s.now || '') + '</p>' +
        '<p class="hr-seen">Seen before: ' + (s.cases && s.cases.length ? s.cases.map(function(c){ return '<span class="hr-case-chip">' + escapeHtml(HR_CASE_NAMES[c] || c) + '</span>'; }).join('') : '<span class="hr-dim">not in these cases</span>') + '</p>' +
        '<details><summary>What it looked like then</summary><p>' + escapeHtml(s.then || '') + '</p></details></article>';
    }).join('') + '</div>';
  }
  function hrMatchesHtml(d){
    var ms = d.now && d.now.matches || [];
    if (!ms.length) return '';
    return '<div class="hr-matches">' + ms.map(function(m){
      return '<div class="hr-match-row"><span class="hr-match-name">' + escapeHtml(m.name) + '</span><span class="hr-bar"><i style="width:' + Math.max(0, Math.min(100, m.similarity)) + '%"></i></span><span class="hr-match-val">' + m.shared + ' of ' + m.caseSigns + '</span></div>';
    }).join('') + '<p class="hr-note">Signs showing today (partly counts) that also showed before each bust, against all signs in either list. A description of overlap, not a probability.</p></div>';
  }
  function hrAnalogHtml(d){
    var a = d.analog;
    if (!a || !a.then || !a.now || a.then.rows.length < 2) return '<p class="hr-empty">The Nasdaq history needed for this chart is not in the cache yet.</p>';
    // Rows are [week, index, date]; the axis reads in years.
    var yrs = function(rows){ return rows.map(function(r){ return [r[0] / 52, r[1], r[2]]; }); };
    var weekOf = function(t){ var rows = a.then.rows; for (var i = 0; i < rows.length; i++) if (rows[i][2] >= t) return rows[i][0] / 52; return null; };
    var marks = (a.marks || []).map(function(m){ return { x: weekOf(m.t), label: m.label + ' (' + m.t.slice(0, 7) + ')' }; }).filter(function(m){ return m.x != null; });
    var nowRows = a.now.rows, last = nowRows[nowRows.length - 1], then = last ? a.then.rows[last[0]] : null;
    var chart = hrTimeSvg({ xNum: true, xFmt: function(y){ return 'Year ' + Math.round(y); }, yFmt: function(v){ return Math.round(v) + ''; },
      series: [{ name: 'Since Nov 2022 (ChatGPT)', rows: yrs(nowRows), cls: 'ln-s0' }, { name: 'Since Aug 1995 (Netscape IPO)', rows: yrs(a.then.rows), cls: 'ln-s1' }],
      marks: marks, h: 260, aria: 'Nasdaq Composite from the start of each buildout, indexed to 100' });
    return '<h3 class="hr-h3">The Nasdaq, then and now</h3><p class="hr-lede">The Nasdaq Composite from the public start of each buildout, both set to 100. ' +
      (last ? 'Today, ' + vnNum(last[0] / 52, 1) + ' years in, the AI-era line is at ' + vnNum(last[1], 0) + (then ? '; the 1990s line was at ' + vnNum(then[1], 0) + ' at the same point' : '') + '. ' : '') + 'The choice of starting date changes the picture: this is a case study, not a forecast.</p>' + chart;
  }
  function hrNowHtml(d){
    return hrHeroHtml(d) +
      '<h3 class="hr-h3">Nine warning signs</h3><p class="hr-lede">Each sign showed up before at least one past bust. Today\\'s reading comes from data the site already collects: SEC capital spending and revenue, GPU rents, bond issuance, credit spreads and stock prices.</p>' +
      hrSignsHtml(d) +
      '<h3 class="hr-h3">Which past case today looks most like</h3>' + hrMatchesHtml(d) +
      hrAnalogHtml(d) +
      '<details class="hr-method"><summary>How this page is measured</summary><ul>' + (d.methodology || []).map(function(m){ return '<li>' + escapeHtml(m) + '</li>'; }).join('') + '</ul></details>';
  }

  // ---- Case tabs ----
  function hrRailroadsHtml(d){
    var rr = d.railroads || {};
    var chart = hrTimeSvg({ xNum: true, xFmt: function(y){ return String(Math.round(y)); }, yFmt: function(v){ return v.toFixed(2) + '¢'; },
      series: [{ name: 'Freight revenue per ton-mile, cents', rows: (rr.freight || []).map(function(r){ return [r[0], r[1], String(r[0])]; }), cls: 'ln-s0' }],
      marks: [{ x: 1873, label: 'Panic of 1873' }, { x: 1884, label: '1884 panic' }], h: 220, legend: true, aria: 'US railroad freight revenue per ton-mile, 1865 to 1890' });
    return hrCaseHtml('railroads', null, '<h4 class="hr-h4">The price of shipping fell as track was built</h4>' + chart + '<p class="hr-note">Thirteen US railroads, NBER Macrohistory series, via FRED. ' + hrSourceLink('nberFreight', 'FRED A0303FUSA259NNBR') + '</p>');
  }
  function hrTelecomHtml(d){
    var t = d.telecom || {};
    var comm = (t.chart && t.chart.communication || []).map(function(r){ return [r[0], r[1] / 1000]; });
    var chart = comm.length > 1 ? '<h4 class="hr-h4">Private communication construction spending</h4>' + hrTimeSvg({ yFmt: function(v){ return '$' + v.toFixed(0) + 'B'; },
      series: [{ name: 'Communication construction, $B a year (Census)', rows: comm, cls: 'ln-s0' }],
      marks: [{ x: '2000-03-10', label: 'Nasdaq peak' }, { x: '2002-07-21', label: 'WorldCom files' }], h: 220, legend: true, aria: 'US private communication construction spending since 1993' }) +
      '<p class="hr-note">US Census, seasonally adjusted annual rate. ' + hrSourceLink('fredComm', 'FRED PRCMUCONS') + '. It covers buildings and structures for networks, not the equipment inside them.</p>' : '';
    return hrCaseHtml('telecom', t.facts, chart + '<p class="hr-note">The Nasdaq comparison with today is on the Now vs history tab.</p>');
  }
  function hrHousingHtml(d){
    var h = d.housing || {}, ch = h.chart || {}, col = d.collateral || {};
    var hpi = ch.hpi && ch.hpi.length > 1 ? '<h4 class="hr-h4">House prices (FHFA all-transactions index)</h4>' + hrTimeSvg({ yFmt: function(v){ return v.toFixed(0); },
      series: [{ name: 'FHFA house price index', rows: ch.hpi, cls: 'ln-s0' }],
      marks: [{ x: '2007-04-02', label: 'New Century files' }, { x: '2008-09-15', label: 'Lehman files' }], h: 220, legend: true, aria: 'FHFA house price index since 1995' }) : '';
    var rates = (ch.mortgage && ch.mortgage.length > 1) || (ch.delinquency && ch.delinquency.length > 1) ? '<h4 class="hr-h4">Mortgage rate and delinquencies</h4>' + hrTimeSvg({ yFmt: function(v){ return v.toFixed(1) + '%'; },
      series: [{ name: '30-year mortgage rate', rows: ch.mortgage || [], cls: 'ln-s0' }, { name: 'Mortgage delinquency rate (banks)', rows: ch.delinquency || [], cls: 'ln-s1' }],
      marks: [{ x: '2008-09-15', label: 'Lehman' }], h: 220, aria: 'Mortgage rate and delinquency rate since 1995' }) : '';
    var collat = col.text ? '<div class="hr-callout"><h4>Collateral that wears out</h4><p>' + escapeHtml(col.text) + '</p>' +
      '<div class="hr-numbers">' +
        (col.houseCrashPerYearPct != null ? '<div class="hr-num"><b>' + hrPct(col.houseCrashPerYearPct) + ' a year</b><span>House prices in the 2006–2011 crash (FHFA)</span></div>' : '') +
        (col.gpuHyperscalerPerYearPct != null ? '<div class="hr-num"><b>' + hrPct(col.gpuHyperscalerPerYearPct) + ' a year</b><span>H100 rent at the big clouds, 2023–2025</span></div>' : '') +
        (col.gpuMarketplacePerYearPct != null ? '<div class="hr-num"><b>' + hrPct(col.gpuMarketplacePerYearPct) + ' a year</b><span>H100 rent on marketplaces, 2024–2025</span></div>' : '') +
      '</div><p class="hr-note">Rent is not resale value, and a house crash is not the normal path for a house. The point is the direction: a chip\\'s earning power shrinks every year by design.</p></div>' : '';
    return hrCaseHtml('housing', h.facts, hpi + rates + collat);
  }
  function hrAiHtml(d){
    var g = d.gpu || {}, idx = g.index || [];
    var tbl = idx.length ? '<h4 class="hr-h4">H100 rent per GPU-hour (H100 Rental Price Index)</h4><div class="hr-table-wrap"><table class="hr-table"><thead><tr><th>Period</th><th>Big clouds</th><th>Marketplaces</th><th>Neoclouds</th></tr></thead><tbody>' +
      idx.map(function(r){ var f = function(v){ return v == null ? '<span class="hr-dim">—</span>' : '$' + Number(v).toFixed(2); }; return '<tr><td>' + escapeHtml(r.period) + '</td><td>' + f(r.hyperscaler) + '</td><td>' + f(r.marketplace) + '</td><td>' + f(r.neocloud) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="hr-note">Segment medians from ' + hrSourceLink('siliconData', 'Silicon Data') + '.</p>' : '';
    var live = g.live && g.live.history && g.live.history.length > 1 ? '<h4 class="hr-h4">H100 rent on this site\\'s tracked providers</h4>' + hrTimeSvg({ yFmt: function(v){ return '$' + v.toFixed(2); },
      series: [{ name: 'H100 median, $ per GPU-hour', rows: g.live.history, cls: 'ln-s0' }], h: 200, legend: true, aria: 'H100 rental median across tracked providers' }) +
      '<p class="hr-note">' + escapeHtml(g.note || '') + ' <a href="?tab=accelerator-prices">GPU cloud prices</a></p>' : (g.note ? '<p class="hr-note">' + escapeHtml(g.note) + '</p>' : '');
    var links = '<p class="hr-note">Spending by company: <a href="?tab=ai-capex">AI buildout spending</a>. Bond and stock sales: <a href="?tab=capital-raises">Capital markets</a>.</p>';
    return hrCaseHtml('ai-buildout', null, tbl + live + links);
  }
  function hrCreditHtml(d){
    var c = d.credit || {}, baa = c.baa || {}, hy = c.hy, ig = c.ig;
    var k = [];
    if (baa.now) k.push(['Baa spread over 10-year Treasury', vnNum(baa.now.v, 2) + ' pts', baa.now.t + (baa.pctile != null ? ' · ' + vnOrd(baa.pctile) + ' percentile since ' + String(baa.since || '').slice(0, 4) : '')]);
    if (hy && hy.now) k.push(['High-yield spread', vnNum(hy.now.v, 2) + ' pts', hy.now.t + (hy.chg3m != null ? ' · ' + (hy.chg3m >= 0 ? '+' : '') + vnNum(hy.chg3m, 2) + ' in 3 months' : '')]);
    if (ig && ig.now) k.push(['Investment-grade spread', vnNum(ig.now.v, 2) + ' pts', ig.now.t + (ig.chg3m != null ? ' · ' + (ig.chg3m >= 0 ? '+' : '') + vnNum(ig.chg3m, 2) + ' in 3 months' : '')]);
    (baa.peaks || []).forEach(function(p){ k.push([p.label, vnNum(p.v, 2) + ' pts', p.t]); });
    var tiles = k.length ? '<div class="mm-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '</b><small class="hr-dim">' + escapeHtml(x[2] || '') + '</small></div>'; }).join('') + '</div>' : '';
    var chart = baa.chart && baa.chart.length > 1 ? hrTimeSvg({ yFmt: function(v){ return v.toFixed(1); },
      series: [{ name: 'Baa spread, points', rows: baa.chart, cls: 'ln-s0' }].concat(hy && hy.chart ? [{ name: 'High-yield spread, points', rows: hy.chart, cls: 'ln-s1' }] : []),
      marks: (baa.peaks || []).map(function(p){ return { x: p.t, label: p.label.replace(/ high.*$/, '') }; }), h: 240, aria: 'Corporate credit spreads since 1986' }) +
      '<p class="hr-note">' + hrSourceLink('fredBaa', 'FRED BAA10Y') + ' (Moody\\'s via the Federal Reserve) and ' + hrSourceLink('fredHy', 'FRED BAMLH0A0HYM2') + ' (ICE BofA; FRED publishes about three years).</p>' : '';
    var rep = c.reported || [];
    var cds = '<h3 class="hr-h3">Credit default swaps reported in the press</h3>' +
      '<div class="hr-callout"><h4>Why there is no CDS chart</h4><p>' + escapeHtml(c.cdsAccess || '') + '</p></div>' +
      (rep.length ? '<div class="hr-table-wrap"><table class="hr-table"><thead><tr><th>Company</th><th>Date</th><th>5-year CDS</th><th>What was reported</th></tr></thead><tbody>' + rep.map(function(q){
        var who = q.symbol ? vnSym(q.symbol) + ' <small class="hr-dim">' + escapeHtml(q.name) + '</small>' : escapeHtml(q.name);
        var bp = q.bp == null ? '<span class="hr-dim">not published</span>' : (q.approx === 'above' ? 'above ' : '') + Number(q.bp).toLocaleString() + ' bp';
        return '<tr><td>' + who + '</td><td>' + escapeHtml(q.date) + '</td><td class="hr-numcell">' + bp + '</td><td>' + escapeHtml(q.note) + (q.sourceUrl ? ' <a class="hr-src" href="' + escapeHtml(q.sourceUrl) + '" target="_blank" rel="noopener">source</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
      '<p class="hr-note">A credit default swap pays out if the company defaults. Its price, in basis points a year (100 bp = 1%), is what it costs to insure that company\\'s debt for five years. A quote above about 1,000 bp means the market treats default as likely.</p>';
    var merton = '<h3 class="hr-h3">A free stand-in: the stock-market read of default</h3><p class="hr-lede">Without CDS prices, the site estimates default risk from the stock market with the Merton model: a company\\'s shares are worth something only if its assets end up worth more than its debt, so the share price, the debt and how much the shares swing imply a chance that assets fall below the debt. It is a model, not a market quote; it ignores when the debt is due and who stands behind it.</p>' +
      (HAS_OWNER_ACCESS ? '<p class="hr-note">Each covered stock\\'s model read is on the <button type="button" class="hr-linkbtn" data-hr-tab="stocks">Stocks tab</button>.</p>' : '');
    return '<h3 class="hr-h3">Corporate credit spreads</h3><p class="hr-lede">How much more than the government companies pay to borrow. Spreads widened before or during every bust on this page; the Baa spread peaked in late 2008.</p>' + tiles + chart + cds + merton;
  }

  // ---- Owner: Stocks ----
  function hrStocksHtml(){
    if (!HAS_OWNER_ACCESS) return '<p class="hr-empty">Owner sign-in required.</p>';
    var o = hrState.owner;
    if (!o) return '<p class="hr-empty">' + (hrState.ownerTried ? 'The Owner stock file is not written yet. The next full build creates it.' : 'Loading each stock\\'s credit read…') + '</p>';
    var flags = function(r){ return (r.flags || []).length ? '<span class="hr-flags">' + r.flags.map(function(f){ return '<span class="hr-flag">' + escapeHtml(f) + '</span>'; }).join('') + '</span>' : '<span class="hr-dim">—</span>'; };
    var detail = function(r){
      var cds = (r.cds || []).map(function(q){ return '<li>' + escapeHtml(q.date) + ': ' + escapeHtml(q.note) + (q.sourceUrl ? ' <a class="hr-src" href="' + escapeHtml(q.sourceUrl) + '" target="_blank" rel="noopener">source</a>' : '') + '</li>'; }).join('');
      if (!(r.flags || []).length && !cds) return '';
      return '<div class="hr-detail">' + ((r.flags || []).length ? flags(r) : '') + (cds ? '<ul class="hr-detail-cds">' + cds + '</ul>' : '') + '</div>';
    };
    var cdsCell = function(r){ var q = (r.cds || [])[0]; return q ? (q.bp == null ? 'record high' : (q.approx === 'above' ? '>' : '') + Number(q.bp).toLocaleString() + ' bp') + ' <small class="hr-dim">' + escapeHtml(q.date) + '</small>' : '<span class="hr-dim">—</span>'; };
    var cols = [
      { label: 'Stock', cell: function(r){ return ((r.flags || []).length || (r.cds || []).length ? VIEWS.expandHtml('Show flags and CDS reports for ' + r.symbol) : '') + vnSym(r.symbol); }, sort: function(r){ return r.symbol; } },
      { label: 'Role', cell: function(r){ return r.roleLabel ? escapeHtml(r.roleLabel) : '<span class="hr-dim">—</span>'; }, sort: function(r){ return r.roleLabel || 'zz'; } },
      { label: 'Model default chance, 5y', num: true, title: 'Equity-implied (Merton) chance that assets end below total debt in five years', cell: function(r){ var p = r.model && r.model.pdPct; return p == null ? '<span class="hr-dim">—</span>' : '<span class="' + (p >= 20 ? 'neg' : p >= 5 ? 'hr-warn' : '') + '">' + (p < 0.1 ? 'under 0.1%' : hrPct(p)) + '</span>'; }, sort: function(r){ return r.model ? r.model.pdPct : null; } },
      { label: 'Model spread', num: true, title: 'Model yield premium on the debt, basis points a year', cell: function(r){ var b = r.model && r.model.spreadBp; return b == null ? '<span class="hr-dim">—</span>' : b < 1 ? 'under 1 bp' : Number(b).toLocaleString() + ' bp'; }, sort: function(r){ return r.model ? r.model.spreadBp : null; } },
      { label: 'Reported CDS', cell: cdsCell, sort: function(r){ var q = (r.cds || [])[0]; return q ? q.bp : null; } },
      { label: 'Debt / market value', num: true, cell: function(r){ return hrPct(r.debtToMcapPct, 0); }, sort: function(r){ return r.debtToMcapPct; } },
      { label: 'Debt', num: true, cell: function(r){ return hrUsd(r.totalDebt); }, sort: function(r){ return r.totalDebt; } },
      { label: 'Capex / operating cash', num: true, cell: function(r){ return hrPct(r.capexToOcfPct, 0); }, sort: function(r){ return r.capexToOcfPct; } },
      { label: 'Free cash flow', num: true, cell: function(r){ return r.freeCashFlow == null ? '<span class="hr-dim">—</span>' : '<span class="' + (r.freeCashFlow < 0 ? 'neg' : '') + '">' + hrUsd(r.freeCashFlow) + '</span>'; }, sort: function(r){ return r.freeCashFlow; } },
      { label: 'From 52-week high', num: true, cell: function(r){ return vnChg(r.offHighPct, 0); }, sort: function(r){ return r.offHighPct; } },
      { label: 'Stock volatility', num: true, title: 'One-year realized volatility (option-implied when the history is short)', cell: function(r){ return hrPct(r.sigmaEPct, 0); }, sort: function(r){ return r.sigmaEPct; } },
      { label: 'Rating', cell: function(r){ return r.rating ? escapeHtml((r.rating.agency || '') + ' ' + (r.rating.rating || '')) : '<span class="hr-dim">—</span>'; }, sort: function(r){ return r.rating ? r.rating.rating : null; } },
      { label: 'Flags', num: true, title: 'Warning flags; open the row to read them', cell: function(r){ var n = (r.flags || []).length; return n ? '<span class="' + (n >= 3 ? 'neg' : 'hr-warn') + '">' + n + '</span>' : '<span class="hr-dim">—</span>'; }, sort: function(r){ return (r.flags || []).length; } },
    ];
    var check = o.check ? '<div class="hr-callout"><h4>Model check</h4><p>CoreWeave: the model reads ' + hrPct(o.check.modelPdPct) + ' over five years and ' + (o.check.modelSpreadBp != null ? Number(o.check.modelSpreadBp).toLocaleString() + ' bp' : '—') + ' today, against about 63% and above 1,000 bp implied by its credit default swaps on October 15, 2026 (Reuters). ' + escapeHtml(o.check.note.replace(/^Reported:[^.]*\\.\\s*/, '')) + '</p></div>' : '';
    var roles = '<details class="hr-method"><summary>What happened to each role in past busts</summary><dl class="hr-roles">' + (o.roles || []).map(function(r){ return '<dt>' + escapeHtml(r.label) + ' <small class="hr-dim">' + escapeHtml((r.symbols || []).join(', ')) + '</small></dt><dd>' + escapeHtml(r.history) + '</dd>'; }).join('') + '</dl></details>';
    var notes = '<details class="hr-method"><summary>How the model works</summary><ul>' + ((o.model && o.model.notes) || []).map(function(n){ return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul></details>';
    return '<p class="hr-lede">Owner only. Each covered stock\\'s place in the buildout and what the stock market implies about its default risk, from the Merton model: an estimate from the share price, the debt and how much the shares swing, not a market CDS quote. Research only: nothing here changes a grade, a pick or the track record. Top Picks logs the model default chance as a shadow input (epd) to test later.' + (o.stale ? ' <b class="hr-warn">This is the last good copy; the newest build could not rebuild it.</b>' : '') + '</p>' +
      check +
      '<h3 class="hr-h3">Buildout stocks</h3>' + VIEWS.tableHtml(cols, o.buildout || [], { key: 'history-rhymes-buildout', empty: 'No buildout stock has a credit read.', detail: detail }) +
      '<h3 class="hr-h3">Every other covered stock</h3>' + VIEWS.tableHtml(cols, o.others || [], { key: 'history-rhymes-others', empty: 'No other stock has a credit read.', detail: detail }) +
      roles + notes;
  }

  function renderHistoryRhymes(){
    var root = document.getElementById('history-rhymes-root'); if (!root) return;
    var d = hrState.data;
    if (!d){
      root.innerHTML = '<p class="hr-empty">' + (hrState.error ? 'This page could not load. The next full build writes it; try again later.' : 'Loading the case studies…') + '</p>';
      return;
    }
    var asof = document.getElementById('history-rhymes-asof');
    if (asof) asof.textContent = (d.asOf ? 'Data through ' + d.asOf : '') + (d.builtAtIso ? ' · built ' + vnWhen(d.builtAtIso) : '') + (d.stale ? ' · last good copy' : '');
    var tab = hrTab();
    if (tab === 'stocks' && !hrState.owner && !hrState.ownerTried) loadHistoryRhymesOwner();
    var body = tab === 'railroads' ? hrRailroadsHtml(d) : tab === 'telecom' ? hrTelecomHtml(d) : tab === 'housing' ? hrHousingHtml(d) : tab === 'ai' ? hrAiHtml(d) : tab === 'credit' ? hrCreditHtml(d) : tab === 'stocks' ? hrStocksHtml() : hrNowHtml(d);
    root.innerHTML = vnTabsHtml(hrTabs(), tab, 'data-hr-tab') + '<div class="hr-body">' + body + '</div>';
    vnTabsReveal(root);
  }
  function loadHistoryRhymesOwner(){
    if (!HAS_OWNER_ACCESS) return;
    vnJson('history-rhymes-owner.json', true).then(function(j){
      hrState.owner = j && typeof j === 'object' && (j.buildout || j.others) ? j : null;
      hrState.ownerTried = true;
      renderHistoryRhymes();
    });
  }
  function loadHistoryRhymes(force){
    if (!force && hrState.data && Date.now() - hrState.fetchedAt < 10 * 60 * 1000){ renderHistoryRhymes(); return; }
    if (hrState.loading) return;
    hrState.loading = true; hrState.error = null;
    renderHistoryRhymes();
    vnJson('history-rhymes.json', false).then(function(j){
      hrState.data = j && typeof j === 'object' && j.now ? j : null;
      hrState.error = hrState.data ? null : 'missing';
      hrState.fetchedAt = Date.now(); hrState.loading = false;
      renderHistoryRhymes();
    });
  }
  // Risk analysis: one context line under the seven desks. It does not vote.
  function loadHistoryRhymesRisk(){
    var host = document.getElementById('risk-rhymes'); if (!host) return;
    vnJson('history-rhymes.json', false).then(function(d){
      if (!d || !d.now || !d.now.stage){ host.hidden = true; return; }
      var n = d.now, lit = (n.signs || []).filter(function(s){ return s.status === 'lit'; }).map(function(s){ return s.label; });
      host.hidden = false;
      host.innerHTML = '<div class="hr-risk"><span class="hr-kicker">Context, not a vote · Booms &amp; busts</span>' +
        '<p><b>' + escapeHtml(n.stage.label) + '</b>: ' + n.score + ' of ' + n.total + ' warning signs from the railroad, telecom and 2008 busts are showing' + (n.mostLike ? '; closest to ' + escapeHtml(n.mostLike.name) : '') + '.' + (lit.length ? ' Showing: ' + escapeHtml(lit.slice(0, 4).join('; ')) + '.' : '') + '</p>' +
        '<a class="book-more" href="?tab=history-rhymes">Open Booms &amp; busts</a></div>';
    });
  }
  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-hr-tab]') : null;
    if (!t) return;
    VIEWS.set('history-rhymes.tab', t.getAttribute('data-hr-tab'));
    renderHistoryRhymes();
  });
  document.addEventListener('stonks-owner-ready', function(){
    var pane = document.getElementById('page-pane-history-rhymes');
    if (pane && !pane.hidden && hrState.data) renderHistoryRhymes();
  });
`;
}

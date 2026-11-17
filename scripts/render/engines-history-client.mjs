// Engine history on the site (2026-11-17). Pasted into the app.js IIFE, so it
// is ES5 inside a template string: write regex escapes as \\d, no backticks.
//
// One public file, engines-history.json (lib/engines-history.mjs): the
// 1971-2026 history test of the six strategy engines (aggregates only) and
// today's market cell. A page asks for a block by leaving an empty
// placeholder in its HTML; one observer fills every placeholder it sees, so
// the host pages need no wiring of their own:
//
//   <div data-eh="eras"></div>                       Pattern lab: styles by era (public)
//   <div data-eh="strip" data-eh-case="rhymes:telecom"></div>
//                                                    how each style did in a case's eras
//   <div data-eh="fit"></div>                        today's regime fit (Owner pages)
//   data-eh-names="engine"                           use engine names (Owner pages)
//
// With the file missing or switched off (ENGINES_HISTORY=0) every placeholder
// stays hidden. Context only: nothing here changes a pick, grade or engine.
export function renderEnginesHistoryJs() {
  return `
  var EH = { data: null, tried: false, loading: false };
  var EH_DIMS = [['trend', 'S&P trend'], ['vol', 'VIX'], ['rates', '10-year yield'], ['infl', 'Inflation'], ['fc', 'Conditions']];
  function ehPct(v){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%'; }
  function ehVal(v, n, min){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    var few = n != null && n < (min || 20);
    return '<span class="eh-v ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + (few ? ' is-few' : '') + '"' + (n != null ? ' title="' + n + ' trades' + (few ? ', too few to lean on' : '') + '"' : '') + '>' + ehPct(v) + '</span>';
  }
  function ehInt(n){ return n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('en-US'); }
  function ehStyle(d, id){ var s = (d.styles || []).filter(function(x){ return x.id === id; })[0]; return s || { id: id, label: id, engine: id }; }
  function ehName(d, id, engine){ var s = ehStyle(d, id); return escapeHtml(engine ? s.engine : s.label) + (s.standIn ? '<sup class="eh-star" title="Tested with a price-only stand-in, not its live rules">*</sup>' : ''); }
  function ehIds(d){ return (d.styles || []).map(function(s){ return s.id; }); }
  function ehEra(d, key){ var list = d.results && d.results.eras || []; for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i]; return null; }
  function ehYear(t){ return String(t || '').slice(0, 7); }
  function ehCaveat(d){
    return '<details class="eh-caveats"><summary>How this was tested and what to keep in mind</summary><p>' + escapeHtml(d.results && d.results.unit || '') + ' Every setup was taken, with no learning, from ' + escapeHtml(String(d.results && d.results.from || '').slice(0, 4)) + ' to ' + escapeHtml(String(d.results && d.results.to || '').slice(0, 4)) + '. "Random" is the same number of trades on random names and days.</p><ul>' +
      (d.results && d.results.caveats || []).map(function(c){ return '<li>' + escapeHtml(c) + '</li>'; }).join('') + '</ul></details>';
  }

  // Pattern lab: every era, every style, plus the whole-period line.
  function ehErasHtml(d, engine){
    var ids = ehIds(d), r = d.results || {};
    var totals = '<div class="eh-totals">' + ids.map(function(id){
      var t = r.styles && r.styles[id] || {};
      var beat = t.avg != null && t.rand != null ? t.avg - t.rand : null;
      return '<div class="eh-total"><span class="eh-total-name">' + ehName(d, id, engine) + '</span><b>' + ehVal(t.avg, t.n, 1) + '</b><small>' + ehInt(t.n) + ' trades · random ' + ehPct(t.rand) + (beat != null ? ' · ' + (beat > 0 ? 'beat random by ' : 'trailed random by ') + Math.abs(beat).toFixed(1) + ' pts' : '') + '</small><small>Before 2007 ' + ehPct(t.before2007 && t.before2007.avg) + ' · since ' + ehPct(t.since2007 && t.since2007.avg) + '</small></div>';
    }).join('') + '</div>';
    var cols = [{ label: 'Era', cell: function(e){ return '<b>' + escapeHtml(e.key) + '</b><small class="eh-dim eh-block">' + escapeHtml(ehYear(e.from)) + ' to ' + escapeHtml(ehYear(e.to)) + '</small>'; }, sort: function(e){ return e.from; } },
      { label: 'S&P 500', num: true, cell: function(e){ return ehVal(e.spy); }, sort: function(e){ return e.spy; } }];
    ids.forEach(function(id){
      var s = ehStyle(d, id);
      cols.push({ label: (engine ? s.engine : s.label) + (s.standIn ? '*' : ''), num: true, title: s.standIn ? 'Price-only stand-in' : '', cell: function(e){ var x = e.styles && e.styles[id]; return x ? ehVal(x.avg, x.n) : ''; }, sort: function(e){ var x = e.styles && e.styles[id]; return x ? x.avg : null; } });
    });
    var ts = r.trendSwitch;
    var trend = ts && ts.cagr ? '<p class="eh-callout"><b>Nothing here beat simply holding the S&amp;P 500.</b> Buy and hold made ' + ehPct(ts.cagr.buyHold) + ' a year with a worst fall of ' + ehPct(ts.maxDrawdown && ts.maxDrawdown.buyHold) + '. ' + escapeHtml(ts.rule || '') + ' That made ' + ehPct(ts.cagr.trendSwitch) + ' a year with a worst fall of ' + ehPct(ts.maxDrawdown && ts.maxDrawdown.trendSwitch) + ', but it lost more in the 2022 rate-hike bear.</p>' : '';
    return '<section class="eh-card" aria-label="Strategy styles by era">' +
      '<header class="eh-head"><span class="eh-kicker">History test · 1971 to ' + escapeHtml(String(r.to || '').slice(0, 4)) + '</span><h3>Strategy styles by era</h3></header>' +
      '<p class="eh-lede">Six rules-only option strategy styles, run through every market since 1971. Each number is the average profit or loss per trade, as a share of the premium paid, after costs. Green made money on average; grey numbers had fewer than 20 trades. Aggregates only; no picks or trades.</p>' +
      totals + trend +
      VIEWS.tableHtml(cols, r.eras || [], { key: 'eh-eras', cls: 'eh-table' }) +
      '<p class="eh-note">* Tested with a price-only stand-in, not its live rules.</p>' + ehCaveat(d) + '</section>';
  }

  // A case study: how each style did in that case's eras, best first.
  function ehStripHtml(d, caseId, engine){
    var keys = d.caseEras && d.caseEras[caseId] || [];
    var eras = keys.map(function(k){ return ehEra(d, k); }).filter(Boolean);
    if (!eras.length) return '';
    var ids = ehIds(d);
    return '<section class="eh-strip" aria-label="How each strategy style did">' +
      '<header class="eh-strip-head"><span class="eh-kicker">History test · option profit per trade after costs</span><h4>How each strategy style did</h4></header>' +
      '<div class="eh-eras">' + eras.map(function(e){
        var rows = ids.map(function(id){ return { id: id, x: e.styles && e.styles[id] }; }).filter(function(r){ return r.x && r.x.avg != null; })
          .sort(function(a, b){ return b.x.avg - a.x.avg; });
        return '<article class="eh-era"><b>' + escapeHtml(e.key) + '</b><span class="eh-dim">' + escapeHtml(ehYear(e.from)) + ' to ' + escapeHtml(ehYear(e.to)) + ' · S&amp;P 500 ' + ehPct(e.spy) + '</span>' +
          '<ul class="eh-chips">' + rows.map(function(r){ return '<li><span>' + ehName(d, r.id, engine) + '</span>' + ehVal(r.x.avg, r.x.n) + '<small>' + ehInt(r.x.n) + '</small></li>'; }).join('') + '</ul></article>';
      }).join('') + '</div>' +
      '<p class="eh-note">Trade counts on the right; grey = under 20 trades. * price-only stand-in. Before 2007 the test uses about 100 large stocks that survived to 2017. <a href="?tab=pattern-lab">Every era in Pattern lab</a></p></section>';
  }

  // Today's regime fit (Owner pages): the cell, then each style in it.
  function ehFitHtml(d, engine){
    var t = d.today;
    if (!t) return '<section class="eh-fit"><span class="eh-kicker">Context, not a vote · engine history</span><p class="eh-note">Today\\'s market cell could not be read from the long-history cache in the newest build.</p></section>';
    var p = t.parts || {}, labels = d.stateLabels || {};
    var chips = EH_DIMS.map(function(x){
      var v = p[x[0]];
      if (!v) return '<span class="eh-cellchip is-na">' + escapeHtml(x[1]) + ': no reading</span>';
      var detail = x[0] === 'trend' ? ehPct(v.gapPct) + ' vs 200-day' : x[0] === 'vol' ? String(v.value) : x[0] === 'rates' ? (v.change6m > 0 ? '+' : '') + v.change6m + ' pt in 6 mo' : x[0] === 'infl' ? v.value + '% a year' : 'NFCI ' + v.value;
      return '<span class="eh-cellchip" title="' + escapeHtml(labels[x[0]] && labels[x[0]][v.state] || '') + ' · ' + escapeHtml(v.date || '') + '"><b>' + escapeHtml(x[1]) + '</b> ' + escapeHtml(v.state) + ' <small>' + escapeHtml(detail) + '</small></span>';
    }).join('');
    var fit = t.fit || { rows: [] };
    var stat = function(s){ return s ? ehVal(s.avg, s.n, 30) + '<small class="eh-dim eh-block">' + ehInt(s.n) + '</small>' : ''; };
    var cols = [{ label: engine ? 'Engine' : 'Style', cell: function(r){ return ehName(d, r.id, engine); }, sort: function(r){ return r.label; } },
      { label: 'This cell (' + (t.cell || '—') + ')', num: true, cell: function(r){ return stat(r.cell); }, sort: function(r){ return r.cell ? r.cell.avg : null; } }];
    EH_DIMS.forEach(function(x){ if (x[0] === 'vol') return; cols.push({ label: x[1] + ': ' + (p[x[0]] ? p[x[0]].state : '—'), num: true, cell: function(r){ return stat(r[x[0]]); }, sort: function(r){ return r[x[0]] ? r[x[0]].avg : null; } }); });
    cols.push({ label: 'All markets', num: true, cell: function(r){ return stat(r.all); }, sort: function(r){ return r.all ? r.all.avg : null; } });
    var rows = fit.rows.slice().sort(function(a, b){ return (b.cell ? b.cell.avg : -1e9) - (a.cell ? a.cell.avg : -1e9); });
    return '<section class="eh-fit" aria-label="Today\\'s regime fit">' +
      '<header class="eh-head"><span class="eh-kicker">Context, not a vote · engine history since 1971</span><h4>Today\\'s regime fit</h4></header>' +
      '<div class="eh-cellchips">' + chips + '</div>' +
      VIEWS.tableHtml(cols, rows, { key: 'eh-fit', cls: 'eh-table' }) +
      '<p class="eh-note">The cell is the S&amp;P 500 against its 200-day average crossed with the VIX band (the same rule the history test used). Each number is the average option profit per trade after costs in that state since 1971, with the trade count under it; grey = under 30 trades. It changes nothing: no pick, engine or gate reads it. * price-only stand-in.</p>' + ehCaveat(d) + '</section>';
  }

  function ehFill(el){
    var d = EH.data, kind = el.getAttribute('data-eh'), engine = el.getAttribute('data-eh-names') === 'engine';
    el.setAttribute('data-eh-done', '1');
    if (!d || d.enabled === false || !d.results){ el.hidden = true; el.innerHTML = ''; return; }
    var html = kind === 'eras' ? ehErasHtml(d, engine) : kind === 'strip' ? ehStripHtml(d, el.getAttribute('data-eh-case') || '', engine) : kind === 'fit' ? ehFitHtml(d, engine) : '';
    el.hidden = !html;
    el.innerHTML = html;
  }
  function ehHydrate(){
    if (typeof document === 'undefined') return;
    var list = document.querySelectorAll('[data-eh]:not([data-eh-done])');
    if (!list.length) return;
    if (!EH.tried){
      if (EH.loading) return;
      EH.loading = true;
      vnJson('engines-history.json', false).then(function(j){
        EH.data = j && typeof j === 'object' ? j : null;
        EH.tried = true; EH.loading = false;
        ehHydrate();
      });
      return;
    }
    for (var i = 0; i < list.length; i++) ehFill(list[i]);
  }
  // Pages redraw with innerHTML; one observer picks up any new placeholder.
  var ehQueued = false;
  function ehQueue(){ if (ehQueued) return; ehQueued = true; (window.requestAnimationFrame || setTimeout)(function(){ ehQueued = false; ehHydrate(); }); }
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined'){
    new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes && muts[i].addedNodes.length){ ehQueue(); return; }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  ehQueue();
`;
}

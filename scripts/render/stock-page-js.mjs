// The public stock page (?tab=stock&s=NVDA). One company on one page: price
// and change (live while the market is open), the price chart, key numbers,
// then tabs for Overview, News, Earnings, Options, Ownership and Similar
// stocks. Owners get one more tab with the stock's grade and its Top Picks
// trades. Every stock link for public visitors lands here.
//
// Data: the public per-ticker JSON (price history, fundamentals, news,
// earnings history, IV rank, option chains), heatmap.json (names and day
// moves), oi-tracker.json (walls), the inlined unusual-flow snapshot,
// 13f.json (fund moves and Form 4 insider trades) and the earnings-call brief.
// Owner extras read grades.json and picks-accuracy.json, which the server only
// returns to the signed Owner session.
//
// The returned string is pasted inside the app.js IIFE (ES5, no imports).

export function renderStockPageJs() {
  return `
  var STOCK_PAGE = (function(){
    var SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
    var WATCH_KEY = 'stonks-watch-v1';
    var TAB_KEY = 'stonks-stock-tab-v1';
    var state = { sym: null, data: null, quote: null, tab: 'overview', chart: null, range: '6M', kind: 'area', token: 0 };
    var cache = { names: null, namesP: null, oi: null, oiP: null, f13: null, f13P: null, calls: {}, grades: null, gradesP: null, acc: null, accP: null };
    try { var savedTab = localStorage.getItem(TAB_KEY); if (savedTab) state.tab = savedTab; } catch (_) {}

    function cleanSym(s){
      var v = String(s || '').trim().toUpperCase();
      return SYM_RE.test(v) ? v : null;
    }
    function getJson(key, opts){
      return fetch(dataUrl(key), { cache: (opts && opts.cache) || 'no-cache' }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    // heatmap.json carries every stock's name, industry, size and day move.
    function names(){
      if (cache.names) return Promise.resolve(cache.names);
      if (cache.namesP) return cache.namesP;
      cache.namesP = getJson('heatmap.json', { cache: 'force-cache' }).then(function(j){
        var map = {};
        (j && Array.isArray(j.tickers) ? j.tickers : []).forEach(function(t){ if (t && t.t) map[t.t] = t; });
        cache.names = map;
        return map;
      }).catch(function(){ cache.names = {}; return cache.names; });
      return cache.namesP;
    }
    function nameOf(sym){
      var n = cache.names && cache.names[sym];
      if (n && n.n) return n.n;
      var d = state.sym === sym && state.data && state.data.fundamentals;
      return d && d.name ? d.name : '';
    }
    function readWatch(){
      try { var v = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); return Array.isArray(v) ? v.filter(cleanSym).slice(0, 40) : []; } catch (_) { return []; }
    }
    function toggleWatch(sym){
      var list = readWatch();
      var i = list.indexOf(sym);
      if (i >= 0) list.splice(i, 1); else list.unshift(sym);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (_) {}
      return i < 0;
    }
    // --- formatting --------------------------------------------------------
    function num(v, d){ return (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
    function money(v){ return (v == null || !isFinite(v)) ? '—' : '$' + num(v, Math.abs(v) >= 1000 ? 0 : 2); }
    function big(v){
      if (v == null || !isFinite(v)) return '—';
      var a = Math.abs(v), s = v < 0 ? '−' : '';
      if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B';
      if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
      if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'K';
      return s + '$' + a.toFixed(0);
    }
    function count(v){
      if (v == null || !isFinite(v)) return '—';
      var a = Math.abs(v);
      if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
      return String(Math.round(v));
    }
    function pctRaw(v, d){ return (v == null || !isFinite(v)) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 2 : d) + '%'; }
    function ratioPct(v, d){ return (v == null || !isFinite(v)) ? '—' : (Number(v) * 100).toFixed(d == null ? 1 : d) + '%'; }
    function chg(v, d){
      if (v == null || !isFinite(v)) return '<span class="stp-chg is-flat" title="No change reported">—</span>';
      var cls = v > 0 ? 'is-up' : v < 0 ? 'is-down' : 'is-flat';
      var arrow = v > 0 ? '▲' : v < 0 ? '▼' : '';
      return '<span class="stp-chg ' + cls + '">' + (arrow ? '<span aria-hidden="true">' + arrow + '</span> ' : '') + pctRaw(v, d) + '</span>';
    }
    function dateLabel(iso){
      if (!iso) return '—';
      var s = String(iso).slice(0, 10);
      var d = new Date(s + 'T12:00:00Z');
      if (!isFinite(d.getTime())) return escapeHtml(String(iso));
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    function ago(iso){
      var t = Date.parse(iso);
      if (!isFinite(t)) return '';
      var m = Math.round((Date.now() - t) / 60000);
      if (m < 60) return m <= 1 ? 'just now' : m + 'm ago';
      var h = Math.round(m / 60);
      if (h < 48) return h + 'h ago';
      return Math.round(h / 24) + 'd ago';
    }
    function symLink(sym, label){
      return '<a class="stp-sym-link" href="?tab=stock&s=' + encodeURIComponent(sym) + '" data-stock-sym="' + escapeHtml(sym) + '">' + escapeHtml(label || sym) + '</a>';
    }
    // --- navigation ----------------------------------------------------------
    function setUrl(sym, replace){
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('tab', 'stock');
        if (sym) url.searchParams.set('s', sym); else url.searchParams.delete('s');
        ['exp', 'k', 't'].forEach(function(k){ url.searchParams.delete(k); });
        var next = url.pathname + url.search + url.hash;
        if (next !== window.location.pathname + window.location.search + window.location.hash){
          if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
        }
      } catch (_) {}
    }
    function open(sym){
      var s = cleanSym(sym);
      if (!s) return;
      state.sym = s;
      var btn = document.querySelector('[data-page-tab="stock"]');
      var pane = document.getElementById('page-pane-stock');
      if (pane && pane.hidden && btn){ btn.click(); setUrl(s, true); }
      else { setUrl(s, false); load(); }
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
    }
    function urlSym(){
      try { return cleanSym(new URLSearchParams(window.location.search).get('s')); } catch (_) { return null; }
    }
    // --- loading -------------------------------------------------------------
    function load(){
      var root = document.getElementById('stock-root');
      if (!root) return;
      var fromUrl = urlSym();
      if (fromUrl) state.sym = fromUrl;
      names().then(function(){ if (!state.sym) renderPicker(root); });
      if (!state.sym){ renderPicker(root); return; }
      var sym = state.sym;
      setUrl(sym, true);
      var token = ++state.token;
      if (!state.data || state.data.__sym !== sym){
        state.data = null; state.quote = null;
        renderShell(root, sym);
        fetchChain(sym).then(function(d){
          if (token !== state.token) return;
          state.data = d || {};
          state.data.__sym = sym;
          render(root);
          liveQuote(sym, token);
        }).catch(function(){
          if (token !== state.token) return;
          root.innerHTML = '<div class="stp-missing"><p>We could not load <b>' + escapeHtml(sym) + '</b>. It may not be one of the stocks this site follows.</p><p><a href="?tab=tickers" data-go-tab="tickers">See all stocks</a></p></div>';
        });
      } else {
        render(root);
        liveQuote(sym, token);
      }
      try { if (typeof wfNoteRecent === 'function') wfNoteRecent('sym:' + sym); } catch (_) {}
    }
    function liveQuote(sym, token){
      fetch('/api/quote?symbol=' + encodeURIComponent(sym), { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(q){
          if (!q || token !== state.token || q.spot == null) return;
          state.quote = q;
          paintPrice();
        }).catch(function(){});
    }
    // --- rendering -----------------------------------------------------------
    function setHeader(title, blurb){
      var pane = document.getElementById('page-pane-stock');
      if (!pane) return;
      var t = pane.querySelector('.wf-title');
      if (t) t.textContent = title;
      var b = pane.querySelector('.wf-blurb');
      if (b) b.textContent = blurb || '';
      try { document.title = title + ' · stonks'; } catch (_) {}
    }
    function renderPicker(root){
      setHeader('Look up a stock', 'Price, chart, key numbers, news, earnings, options and owners for any stock this site follows.');
      var watch = readWatch();
      var list = SYMBOLS.slice().sort();
      var tiles = function(syms){
        return '<div class="stp-pick-grid">' + syms.map(function(s){
          var n = cache.names && cache.names[s];
          return '<a class="stp-pick" href="?tab=stock&s=' + encodeURIComponent(s) + '" data-stock-sym="' + escapeHtml(s) + '">' +
            '<span class="stp-pick-sym">' + escapeHtml(s) + '</span>' +
            '<span class="stp-pick-name">' + escapeHtml(n && n.n || INDUSTRIES[s] || SECTORS[s] || '') + '</span>' +
            (n && n.ch != null ? chg(n.ch) : '') + '</a>';
        }).join('') + '</div>';
      };
      var big8 = Object.keys(cache.names || {}).map(function(k){ return cache.names[k]; })
        .sort(function(a, b){ return (b.mc || 0) - (a.mc || 0); }).slice(0, 12).map(function(t){ return t.t; });
      root.innerHTML =
        searchBox() +
        (watch.length ? '<h3 class="stp-h3">Your watchlist</h3>' + tiles(watch) : '') +
        (big8.length ? '<h3 class="stp-h3">Largest companies</h3>' + tiles(big8) : '') +
        '<h3 class="stp-h3">Every stock A to Z</h3>' + tiles(list);
      bindSearch(root);
    }
    function searchBox(){
      return '<form class="stp-search" role="search" data-stock-search>' +
        '<label class="sr-only" for="stp-search-input">Find a stock</label>' +
        '<input id="stp-search-input" type="search" list="stp-search-list" autocomplete="off" spellcheck="false" placeholder="Find a stock, for example NVDA or Apple" />' +
        '<datalist id="stp-search-list">' + SYMBOLS.map(function(s){ return '<option value="' + escapeHtml(s) + '">' + escapeHtml(nameOf(s) || INDUSTRIES[s] || '') + '</option>'; }).join('') + '</datalist>' +
        '<button type="submit" class="stp-btn">Open</button>' +
      '</form>';
    }
    function bindSearch(root){
      var form = root.querySelector('[data-stock-search]');
      if (!form) return;
      form.addEventListener('submit', function(ev){
        ev.preventDefault();
        var v = String(form.querySelector('input').value || '').trim();
        var s = cleanSym(v);
        if (!s || SYMBOLS.indexOf(s) < 0){
          var q = v.toLowerCase();
          var hit = SYMBOLS.filter(function(x){ return (nameOf(x) || '').toLowerCase().indexOf(q) >= 0; })[0];
          if (hit) s = hit;
        }
        if (s) open(s);
      });
    }
    function renderShell(root, sym){
      setHeader(sym, '');
      root.innerHTML = '<div class="stp-head"><div class="stp-id"><span class="stp-ticker">' + escapeHtml(sym) + '</span></div></div>' +
        '<div class="stp-chart-card"><div class="ck-host"><div class="ck-skeleton" style="height:340px" aria-hidden="true"></div></div></div>';
    }
    function lastClose(d){
      var ps = d && d.priceSeries;
      if (ps && ps.c && ps.c.length) return { close: ps.c[ps.c.length - 1], prev: ps.c.length > 1 ? ps.c[ps.c.length - 2] : null, date: ps.t[ps.t.length - 1] };
      return { close: d && d.spot, prev: null, date: null };
    }
    function priceBlock(){
      var d = state.data || {};
      var lc = lastClose(d);
      var q = state.quote;
      var price = q && q.spot != null ? q.spot : (d.spot != null ? d.spot : lc.close);
      var changePct = q && q.changePct != null ? q.changePct : (lc.prev ? (lc.close / lc.prev - 1) * 100 : null);
      var change = q && q.change != null ? q.change : (lc.prev ? lc.close - lc.prev : null);
      var ms = q && q.marketState ? String(q.marketState).toUpperCase() : '';
      var session = ms === 'REGULAR' ? 'Live' : (ms.indexOf('POST') === 0 ? 'After hours' : (ms.indexOf('PRE') === 0 ? 'Pre-market' : (q ? 'Market closed' : 'Last close')));
      var asOf = q && q.quoteAsOf ? ago(q.quoteAsOf) : (lc.date ? dateLabel(lc.date) : '');
      return '<div class="stp-price-row">' +
        '<span class="stp-price">' + money(price) + '</span>' +
        '<span class="stp-change">' + (change != null && isFinite(change) ? '<span class="stp-chg-abs ' + (change >= 0 ? 'is-up' : 'is-down') + '">' + (change >= 0 ? '+' : '−') + num(Math.abs(change)) + '</span> ' : '') + chg(changePct) + '</span>' +
        '<span class="stp-session' + (ms === 'REGULAR' ? ' is-live' : '') + '">' + escapeHtml(session) + (asOf ? ' · ' + escapeHtml(asOf) : '') + '</span>' +
      '</div>';
    }
    function paintPrice(){
      var el = document.querySelector('#stock-root .stp-price-slot');
      if (el) el.innerHTML = priceBlock();
    }
    function headerHtml(){
      var d = state.data || {};
      var f = d.fundamentals || {};
      var sym = state.sym;
      var name = f.name || nameOf(sym) || sym;
      var sector = INDUSTRIES[sym] || f.industry || SECTORS[sym] || f.sector || '';
      var watching = readWatch().indexOf(sym) >= 0;
      var actions = '<button type="button" class="stp-btn stp-watch' + (watching ? ' is-on' : '') + '" data-stock-watch aria-pressed="' + (watching ? 'true' : 'false') + '">' + (watching ? '★ Watching' : '☆ Watch') + '</button>' +
        (typeof cmpToggleHtml === 'function' ? cmpToggleHtml(sym, 'stp-btn') : '') +
        (HAS_OWNER_ACCESS ? '<button type="button" class="stp-btn" data-stock-grade>Grade this stock</button>' : '');
      setHeader(name + ' (' + sym + ')', sector);
      return '<div class="stp-head">' +
        '<div class="stp-id"><span class="stp-ticker">' + escapeHtml(sym) + '</span>' +
          (sector ? '<span class="stp-sector">' + escapeHtml(sector) + '</span>' : '') + '</div>' +
        '<div class="stp-price-slot">' + priceBlock() + '</div>' +
        '<div class="stp-actions">' + actions + '</div>' +
      '</div>';
    }
    function statsHtml(){
      var d = state.data || {};
      var f = d.fundamentals || {};
      var tech = d.technicals || {};
      var ps = d.priceSeries || {};
      var lc = lastClose(d);
      var price = state.quote && state.quote.spot != null ? state.quote.spot : lc.close;
      var hi = f.fiftyTwoWeekHigh, lo = f.fiftyTwoWeekLow;
      if ((hi == null || lo == null) && ps.c && ps.c.length){
        hi = Math.max.apply(null, (ps.h || ps.c).filter(isFinite));
        lo = Math.min.apply(null, (ps.l || ps.c).filter(isFinite));
      }
      var rangeBar = '';
      if (hi != null && lo != null && hi > lo && price != null){
        var pos = Math.max(0, Math.min(100, (price - lo) / (hi - lo) * 100));
        rangeBar = '<div class="stp-range" role="img" aria-label="Price is ' + Math.round(pos) + '% of the way from the 52-week low to the high">' +
          '<span class="stp-range-track"><span class="stp-range-dot" style="left:' + pos.toFixed(1) + '%"></span></span>' +
          '<span class="stp-range-ends"><span>' + money(lo) + '</span><span>' + money(hi) + '</span></span></div>';
      }
      var avgVol = tech.volume && tech.volume.avg20;
      var next = d.earningsHx && d.earningsHx.next;
      var nextTxt = next && next.date ? dateLabel(next.date) + (next.session === 'AM' ? ' · before open' : next.session === 'PM' ? ' · after close' : '') : (f.nextEarningsDate ? dateLabel(f.nextEarningsDate) : '—');
      var cells = [
        ['Market value', big(f.marketCap)],
        ['P/E (last 12 months)', f.trailingPE != null ? num(f.trailingPE, 1) : '—'],
        ['P/E (next 12 months)', f.forwardPE != null ? num(f.forwardPE, 1) : '—'],
        ['Average volume (20 days)', count(avgVol)],
        // Yahoo's growth, margin and yield fields are already percentages.
        ['Revenue growth (year over year)', f.revenueGrowthYoy != null ? pctRaw(f.revenueGrowthYoy, 1) : '—'],
        ['Profit margin', f.profitMargin != null ? num(f.profitMargin, 1) + '%' : '—'],
        ['Dividend yield', f.dividendYield != null && f.dividendYield > 0 ? num(f.dividendYield, 2) + '%' : 'None'],
        ['Next earnings', nextTxt]
      ];
      return '<div class="stp-stats">' +
        '<div class="stp-stat stp-stat-range"><span class="stp-stat-k">52-week range</span>' + (rangeBar || '<b>—</b>') + '</div>' +
        cells.map(function(c){ return '<div class="stp-stat"><span class="stp-stat-k">' + escapeHtml(c[0]) + '</span><b>' + escapeHtml(c[1]) + '</b></div>'; }).join('') +
      '</div>';
    }
    var TABS = [['overview', 'Overview'], ['news', 'News'], ['earnings', 'Earnings'], ['options', 'Options'], ['ownership', 'Ownership'], ['similar', 'Similar stocks']];
    function tabsHtml(){
      var list = TABS.slice();
      if (HAS_OWNER_ACCESS) list.push(['owner', 'Owner desk']);
      if (!list.some(function(t){ return t[0] === state.tab; })) state.tab = 'overview';
      return '<div class="stp-tabs" role="tablist" aria-label="Stock sections">' + list.map(function(t){
        var on = t[0] === state.tab;
        return '<button type="button" role="tab" class="stp-tab' + (on ? ' is-on' : '') + '" data-stock-tab="' + t[0] + '" aria-selected="' + (on ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div><div class="stp-tab-body" role="tabpanel" id="stp-tab-body"></div>';
    }
    function render(root){
      var d = state.data || {};
      root.innerHTML = headerHtml() +
        '<div class="stp-chart-card">' +
          '<div class="stp-chart-tools"><div class="stp-kind" role="group" aria-label="Chart style">' +
            '<button type="button" class="ck-range" data-stock-kind="area" aria-pressed="' + (state.kind === 'area') + '">Line</button>' +
            '<button type="button" class="ck-range" data-stock-kind="candles" aria-pressed="' + (state.kind === 'candles') + '">Candles</button>' +
          '</div></div>' +
          '<div id="stp-chart"></div>' +
        '</div>' +
        statsHtml() + tabsHtml() + searchBox();
      drawChart();
      paintTab();
      bindSearch(root);
    }
    function drawChart(){
      var el = document.getElementById('stp-chart');
      if (!el) return;
      if (state.chart && state.chart.destroy) state.chart.destroy();
      var d = state.data || {};
      var ps = d.priceSeries || {};
      var days = [];
      var volume = [];
      for (var i = 0; i < (ps.t || []).length; i++){
        var c = ps.c[i];
        if (c == null) continue;
        var o = i > 0 && ps.c[i - 1] != null ? ps.c[i - 1] : c;
        var hi = ps.h && ps.h[i] != null ? ps.h[i] : Math.max(o, c);
        var lo = ps.l && ps.l[i] != null ? ps.l[i] : Math.min(o, c);
        days.push(state.kind === 'candles' ? { time: ps.t[i], open: o, high: Math.max(hi, o, c), low: Math.min(lo, o, c), close: c } : { time: ps.t[i], value: c });
        if (ps.v && ps.v[i] != null) volume.push({ time: ps.t[i], value: ps.v[i], up: c >= o });
      }
      var intra = d.intradaySeries || {};
      var ranges = ['5D', '1M', '3M', '6M', 'YTD', '1Y'];
      var series = [{ name: '', type: state.kind === 'candles' ? 'candles' : 'area', data: days }];
      var useIntra = state.range === '5D' && intra.t && intra.t.length > 10;
      if (useIntra){
        series = [{ name: '', type: 'area', data: intra.t.map(function(t, k){ return { time: t, value: intra.c[k] }; }) }];
        volume = [];
      }
      var f = d.fundamentals || {};
      var sma = (d.technicals && d.technicals.sma) || {};
      state.chart = CHART_KIT.mount(el, {
        series: series,
        volume: volume,
        ranges: ranges,
        range: state.range,
        intraday: useIntra,
        prefix: '$',
        height: 340,
        empty: 'No price history yet for this stock.',
        source: (useIntra ? '30-minute bars' : 'Daily closes') + ' · Yahoo Finance' + (ps.t && ps.t.length ? ' · through ' + dateLabel(ps.t[ps.t.length - 1]) : ''),
        bands: useIntra ? [] : [
          sma.sma50 != null ? { value: sma.sma50, title: '50-day avg', axis: false } : null,
          sma.sma200 != null ? { value: sma.sma200, title: '200-day avg', axis: false } : null
        ].filter(Boolean),
        onRange: function(key){
          var wasIntra = state.range === '5D';
          state.range = key;
          if ((key === '5D') !== wasIntra) setTimeout(drawChart, 0);
        }
      });
    }
    // --- tabs ----------------------------------------------------------------
    function paintTab(){
      var body = document.getElementById('stp-tab-body');
      if (!body) return;
      var t = state.tab;
      var fn = t === 'news' ? tabNews : t === 'earnings' ? tabEarnings : t === 'options' ? tabOptions : t === 'ownership' ? tabOwnership : t === 'similar' ? tabSimilar : t === 'owner' ? tabOwner : tabOverview;
      body.innerHTML = '<p class="stp-loading">Loading…</p>';
      var token = state.token;
      Promise.resolve(fn()).then(function(html){
        if (token !== state.token || state.tab !== t) return;
        body.innerHTML = html || '<p class="stp-empty">Nothing to show here yet.</p>';
      }).catch(function(){
        if (token !== state.token) return;
        body.innerHTML = '<p class="stp-empty">This section could not load. Try again in a moment.</p>';
      });
    }
    function tabOverview(){
      var d = state.data || {};
      var f = d.fundamentals || {};
      var n = d.news || {};
      var tech = d.technicals || {};
      var html = '';
      if (n.paragraph){
        html += '<section class="stp-sec"><h3 class="stp-h3">What is moving it</h3><p class="stp-lede">' + escapeHtml(n.paragraph) + '</p>' +
          (n.builtAt ? '<p class="stp-src">Summary of recent headlines · ' + escapeHtml(ago(n.builtAt)) + '</p>' : '') + '</section>';
      }
      var ps = d.priceSeries || {};
      var c = ps.c || [];
      function ret(k){ return c.length > k && c[c.length - 1 - k] ? (c[c.length - 1] / c[c.length - 1 - k] - 1) * 100 : null; }
      var ytd = null;
      if (ps.t && ps.t.length){
        var yr = String(ps.t[ps.t.length - 1]).slice(0, 4);
        for (var i = ps.t.length - 1; i >= 0; i--){ if (String(ps.t[i]).slice(0, 4) !== yr){ ytd = c[i] ? (c[c.length - 1] / c[i] - 1) * 100 : null; break; } }
      }
      html += '<section class="stp-sec"><h3 class="stp-h3">Returns</h3><div class="stp-returns">' +
        [['1 week', ret(5)], ['1 month', ret(21)], ['3 months', ret(63)], ['6 months', ret(126)], ['Year to date', ytd], ['1 year', ret(c.length - 1)]].map(function(r){
          return '<div class="stp-ret"><span>' + r[0] + '</span>' + chg(r[1], 1) + '</div>';
        }).join('') + '</div></section>';
      var sma = tech.sma || {};
      var last = c[c.length - 1];
      var smaRows = [['20-day', sma.sma20], ['50-day', sma.sma50], ['100-day', sma.sma100], ['200-day', sma.sma200]].filter(function(r){ return r[1] != null; });
      if (smaRows.length && last){
        html += '<section class="stp-sec"><h3 class="stp-h3">Price vs its averages</h3><table class="stp-table" data-nosort><thead><tr><th scope="col">Average</th><th scope="col" class="num">Level</th><th scope="col" class="num">Price vs average</th></tr></thead><tbody>' +
          smaRows.map(function(r){ return '<tr><td>' + r[0] + '</td><td class="num">' + money(r[1]) + '</td><td class="num">' + chg((last / r[1] - 1) * 100, 1) + '</td></tr>'; }).join('') +
          '</tbody></table>' + (tech.rsi != null ? '<p class="stp-src">RSI (14 days): ' + num(tech.rsi, 0) + (tech.rsi >= 70 ? ', stretched after a strong run' : tech.rsi <= 30 ? ', stretched after a sharp drop' : '') + '</p>' : '') + '</section>';
      }
      if (f.targetMeanPrice != null && last){
        html += '<section class="stp-sec"><h3 class="stp-h3">Analyst price targets</h3><div class="stp-returns">' +
          '<div class="stp-ret"><span>Average target</span><b>' + money(f.targetMeanPrice) + '</b> ' + chg((f.targetMeanPrice / last - 1) * 100, 1) + '</div>' +
          (f.targetLowPrice != null ? '<div class="stp-ret"><span>Low</span><b>' + money(f.targetLowPrice) + '</b></div>' : '') +
          (f.targetHighPrice != null ? '<div class="stp-ret"><span>High</span><b>' + money(f.targetHighPrice) + '</b></div>' : '') +
          (f.numberOfAnalystOpinions ? '<div class="stp-ret"><span>Analysts</span><b>' + escapeHtml(String(f.numberOfAnalystOpinions)) + '</b></div>' : '') +
          '</div></section>';
      }
      if (f.longBusinessSummary){
        var text = String(f.longBusinessSummary);
        var short = text.length > 420 ? text.slice(0, text.lastIndexOf('. ', 420) + 1 || 420) : text;
        html += '<section class="stp-sec"><h3 class="stp-h3">About the company</h3><p class="stp-about">' + escapeHtml(short) +
          (short.length < text.length ? ' <details class="stp-more"><summary>Read more</summary><p>' + escapeHtml(text.slice(short.length)) + '</p></details>' : '') + '</p></section>';
      }
      return html;
    }
    function tabNews(){
      var n = (state.data || {}).news || {};
      var rows = Array.isArray(n.headlines) ? n.headlines : [];
      if (!rows.length) return '<p class="stp-empty">No recent headlines for this stock. Headlines are collected at each site update during the trading day.</p>';
      return '<ul class="stp-news">' + rows.map(function(h){
        var title = escapeHtml(h.title || '');
        var link = h.url || h.link;
        return '<li><span class="stp-news-meta">' + escapeHtml(h.publisher || h.source || '') + (h.publishedAt ? ' · ' + escapeHtml(ago(h.publishedAt)) : '') + '</span>' +
          (link && /^https?:/i.test(link) ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>' : '<span>' + title + '</span>') + '</li>';
      }).join('') + '</ul>' + (n.builtAt ? '<p class="stp-src">Collected ' + escapeHtml(ago(n.builtAt)) + '</p>' : '');
    }
    function callBrief(sym){
      if (cache.calls[sym] !== undefined) return Promise.resolve(cache.calls[sym]);
      return getJson('transcript-' + encodeURIComponent(sym) + '.json').then(function(j){
        cache.calls[sym] = j && j.summary ? j : null;
        return cache.calls[sym];
      }).catch(function(){ cache.calls[sym] = null; return null; });
    }
    function tabEarnings(){
      var d = state.data || {};
      var hx = d.earningsHx || {};
      var events = (Array.isArray(hx.events) ? hx.events : []).slice().reverse().slice(0, 8);
      var next = hx.next;
      var html = '';
      if (next && next.date){
        html += '<div class="stp-callout"><b>Next report: ' + escapeHtml(dateLabel(next.date)) + '</b>' +
          (next.session === 'AM' ? ' before the open' : next.session === 'PM' ? ' after the close' : '') +
          (next.daysUntil != null ? ' · in ' + escapeHtml(String(next.daysUntil)) + ' days' : '') +
          (next.impliedMovePct != null ? ' · options price a move of about ±' + num(next.impliedMovePct, 1) + '%' : '') + '</div>';
      }
      if (events.length){
        html += '<section class="stp-sec"><h3 class="stp-h3">Last ' + events.length + ' reports</h3><div class="stp-table-wrap"><table class="stp-table" data-nosort><thead><tr>' +
          '<th scope="col">Date</th><th scope="col" class="num">EPS</th><th scope="col" class="num">Estimate</th><th scope="col" class="num">Surprise</th><th scope="col" class="num">Next-day move</th></tr></thead><tbody>' +
          events.map(function(e){
            // movePct / gapPct are stored as fractions (0.0325 = +3.25%).
            var move = e.movePct != null ? e.movePct * 100 : (e.gapPct != null ? e.gapPct * 100 : null);
            return '<tr><td>' + escapeHtml(dateLabel(e.date)) + '</td><td class="num">' + (e.epsActual != null ? num(e.epsActual) : '—') + '</td><td class="num">' + (e.epsEstimate != null ? num(e.epsEstimate) : '—') + '</td>' +
              '<td class="num">' + chg(e.surprisePct, 1) + '</td><td class="num">' + chg(move, 1) + '</td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }
      return callBrief(state.sym).then(function(brief){
        if (brief && brief.summary){
          var s = brief.summary;
          var points = (Array.isArray(s.execSummary) ? s.execSummary : []).slice(0, 5);
          html += '<section class="stp-sec"><h3 class="stp-h3">Latest earnings call</h3>' +
            (s.headline ? '<p class="stp-lede">' + escapeHtml(s.headline) + '</p>' : '') +
            (points.length ? '<ul class="stp-bullets">' + points.map(function(p){ return '<li>' + escapeHtml(typeof p === 'string' ? p : (p && (p.text || p.point)) || '') + '</li>'; }).join('') + '</ul>' : '') +
            '<p class="stp-src"><a href="?tab=calls" data-go-tab="calls">Read every call summary</a></p></section>';
        }
        return html || '<p class="stp-empty">No earnings history for this stock yet. Funds and some newer listings do not report earnings.</p>';
      });
    }
    function oiData(){
      if (cache.oi) return Promise.resolve(cache.oi);
      if (cache.oiP) return cache.oiP;
      cache.oiP = getJson('oi-tracker.json').then(function(j){ cache.oi = j || {}; return cache.oi; }).catch(function(){ cache.oi = {}; return cache.oi; });
      return cache.oiP;
    }
    // At-the-money straddle on the first expiry at least 5 days out: what
    // options traders are paying for a move by then.
    function expectedMove(d){
      var spot = d.spot;
      var exps = (d.expirations || []).slice().sort(function(a, b){ return a - b; });
      var now = Date.now() / 1000;
      for (var i = 0; i < exps.length; i++){
        if (exps[i] - now < 5 * 86400) continue;
        var ch = d.chains && d.chains[String(exps[i])];
        if (!ch || !ch.c || !ch.p) continue;
        var best = null;
        ch.c.forEach(function(c){ if (best == null || Math.abs(c.s - spot) < Math.abs(best - spot)) best = c.s; });
        var call = ch.c.filter(function(c){ return c.s === best; })[0];
        var put = ch.p.filter(function(p){ return p.s === best; })[0];
        function mid(x){ return x && x.b > 0 && x.a > 0 ? (x.b + x.a) / 2 : (x && x.l > 0 ? x.l : null); }
        var cm = mid(call), pm = mid(put);
        if (cm == null || pm == null || !spot) continue;
        return { exp: exps[i], pct: (cm + pm) / spot * 100, dollars: cm + pm };
      }
      return null;
    }
    function tabOptions(){
      var d = state.data || {};
      var sym = state.sym;
      var html = '';
      var iv = d.ivRank || {};
      var em = expectedMove(d);
      html += '<div class="stp-stats stp-stats-3">' +
        '<div class="stp-stat"><span class="stp-stat-k">Implied volatility (30 days)</span><b>' + (iv.iv != null ? ratioPct(iv.iv, 0) : '—') + '</b></div>' +
        '<div class="stp-stat"><span class="stp-stat-k">Versus its own past year</span><b>' + (iv.pctile != null ? escapeHtml(String(Math.round(iv.pctile))) + 'th percentile' : '—') + '</b>' +
          (iv.pctile != null ? '<span class="stp-stat-sub">' + (iv.pctile >= 80 ? 'Options are expensive for this stock' : iv.pctile <= 20 ? 'Options are cheap for this stock' : 'Options are priced near normal') + '</span>' : '') + '</div>' +
        '<div class="stp-stat"><span class="stp-stat-k">Expected move</span><b>' + (em ? '±' + num(em.pct, 1) + '%' : '—') + '</b>' +
          (em ? '<span class="stp-stat-sub">by ' + escapeHtml(new Date(em.exp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })) + ' (about ' + money(em.dollars) + ')</span>' : '') + '</div>' +
      '</div>';
      return oiData().then(function(oi){
        var row = (oi.tickers || []).filter(function(r){ return r && r.symbol === sym; })[0];
        if (row){
          html += '<section class="stp-sec"><h3 class="stp-h3">Options walls</h3><div class="stp-walls">' +
            (row.callWall ? '<div class="stp-wall is-call"><span>Call wall (most call open interest)</span><b>' + money(row.callWall.strike) + '</b><small>' + count(row.callWall.oi) + ' contracts</small></div>' : '') +
            (row.putWall ? '<div class="stp-wall is-put"><span>Put wall (most put open interest)</span><b>' + money(row.putWall.strike) + '</b><small>' + count(row.putWall.oi) + ' contracts</small></div>' : '') +
            (row.cpRatio != null ? '<div class="stp-wall"><span>Calls per put</span><b>' + num(row.cpRatio, 2) + '</b><small>' + count(row.callOiTotal) + ' calls · ' + count(row.putOiTotal) + ' puts</small></div>' : '') +
            '</div>' +
            (Array.isArray(row.reasons) && row.reasons.length ? '<ul class="stp-bullets">' + row.reasons.slice(0, 4).map(function(r){ return '<li>' + escapeHtml(r.label || '') + '</li>'; }).join('') + '</ul>' : '') +
            '<p class="stp-src">Front two expirations' + (oi.scannedAt ? ' · ' + escapeHtml(ago(oi.scannedAt)) : '') + ' · <a href="?tab=oi" data-go-tab="oi">Open Options walls</a></p></section>';
        }
        var flow = (UNUSUAL && Array.isArray(UNUSUAL.tickers) ? UNUSUAL.tickers : []).filter(function(t){ return t && t.symbol === sym; })[0];
        var contracts = flow && Array.isArray(flow.contracts) ? flow.contracts.slice(0, 8) : [];
        if (contracts.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Unusual trades in the latest scan</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Contract</th><th scope="col" class="num">Volume</th><th scope="col" class="num">Open interest</th><th scope="col" class="num">Premium</th><th scope="col">Traded at</th></tr></thead><tbody>' +
            contracts.map(function(c){
              var exp = c.expSec ? new Date(c.expSec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
              return '<tr><td><span class="stp-side ' + (c.side === 'put' ? 'is-put' : 'is-call') + '">' + escapeHtml(c.side === 'put' ? 'Put' : 'Call') + '</span> ' + money(c.strike) + ' · ' + escapeHtml(exp) + '</td>' +
                '<td class="num">' + count(c.vol) + '</td><td class="num">' + count(c.oi) + '</td><td class="num">' + big(c.premium) + '</td><td>' + escapeHtml(c.tape === 'ask' ? 'Ask (buyers)' : c.tape === 'bid' ? 'Bid (sellers)' : 'Mid') + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="stp-src"><a href="?tab=flow" data-go-tab="flow">See all unusual trades</a></p></section>';
        }
        html += '<p class="stp-src"><a href="?tab=strategies" data-go-tab="strategies">Build an options trade on this stock</a></p>';
        return html;
      });
    }
    function f13Data(){
      if (cache.f13) return Promise.resolve(cache.f13);
      if (cache.f13P) return cache.f13P;
      cache.f13P = getJson('13f.json').then(function(j){ cache.f13 = j || {}; return cache.f13; }).catch(function(){ cache.f13 = {}; return cache.f13; });
      return cache.f13P;
    }
    function tabOwnership(){
      var sym = state.sym;
      return f13Data().then(function(j){
        var html = '';
        var moves = [];
        var per = j.perFirm || {};
        Object.keys(per).forEach(function(firm){
          var f = per[firm] || {};
          (f.topBought || []).concat(f.topSold || []).forEach(function(r){
            if (r && r.ticker === sym) moves.push({ firm: firm, r: r, date: f.filingDate });
          });
        });
        moves.sort(function(a, b){ return Math.abs(b.r.valueChange || 0) - Math.abs(a.r.valueChange || 0); });
        if (moves.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Big funds that moved ' + escapeHtml(sym) + ' in ' + escapeHtml(j.period || 'the last quarter') + '</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Fund</th><th scope="col">Move</th><th scope="col" class="num">Change in value</th><th scope="col" class="num">Held now</th></tr></thead><tbody>' +
            moves.slice(0, 12).map(function(m){
              var r = m.r;
              var kind = r.isNew ? 'New position' : r.isExit ? 'Sold out' : (r.valueChange >= 0 ? 'Added' : 'Trimmed');
              return '<tr><td>' + escapeHtml(m.firm) + '</td><td><span class="stp-move ' + (r.valueChange >= 0 ? 'is-up' : 'is-down') + '">' + kind + '</span></td><td class="num">' + (r.valueChange >= 0 ? '+' : '') + big(r.valueChange) + '</td><td class="num">' + big(r.valueNow) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
        }
        var tx = j.insiderTransactions && Array.isArray(j.insiderTransactions.transactions) ? j.insiderTransactions.transactions : [];
        var mine = tx.filter(function(t){ return t && t.symbol === sym && t.openMarket; }).slice(0, 10);
        if (mine.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Insider buys and sells</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Trade</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Value</th></tr></thead><tbody>' +
            mine.map(function(t){
              return '<tr><td>' + escapeHtml(dateLabel(t.transactionDate)) + '</td><td>' + escapeHtml(t.ownerName || '') + (t.officerTitle ? '<small class="stp-dim"> · ' + escapeHtml(t.officerTitle) + '</small>' : '') + '</td>' +
                '<td><span class="stp-move ' + (t.direction === 'buy' ? 'is-up' : 'is-down') + '">' + (t.direction === 'buy' ? 'Bought' : 'Sold') + '</span></td><td class="num">' + count(t.shares) + '</td><td class="num">' + big(t.value) + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="stp-src">SEC Form 4 open-market trades only. Grants, option exercises and tax sales are left out.</p></section>';
        }
        if (!html) html = '<p class="stp-empty">None of the funds this site follows reported a large move in ' + escapeHtml(sym) + ' last quarter, and no insider bought or sold on the open market in the recent filings.</p>';
        html += '<p class="stp-src">' + (j.period ? escapeHtml(j.period) + ' 13F filings' + (j.filingWindow ? ', filed ' + escapeHtml(j.filingWindow) : '') + '. ' : '') + '<a href="?tab=f13" data-go-tab="f13">Open Who owns what</a></p>';
        return html;
      });
    }
    function tabSimilar(){
      var sym = state.sym;
      return names().then(function(map){
        var ind = INDUSTRIES[sym], sec = SECTORS[sym];
        var group = typeof sectorGroupOf === 'function' ? sectorGroupOf(sym) : null;
        function score(s){
          if (s === sym) return -1;
          if (ind && INDUSTRIES[s] === ind) return 3;
          if (sec && SECTORS[s] === sec) return 2;
          if (group && typeof sectorGroupOf === 'function' && sectorGroupOf(s) === group) return 1;
          return 0;
        }
        var peers = SYMBOLS.map(function(s){ return { s: s, k: score(s), mc: (map[s] && map[s].mc) || 0 }; })
          .filter(function(x){ return x.k > 0; })
          .sort(function(a, b){ return b.k - a.k || b.mc - a.mc; }).slice(0, 10);
        if (!peers.length) return '<p class="stp-empty">No close peers among the stocks this site follows.</p>';
        return '<div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Stock</th><th scope="col">Industry</th><th scope="col" class="num">Price</th><th scope="col" class="num">Day</th><th scope="col" class="num">Market value</th></tr></thead><tbody>' +
          peers.map(function(p){
            var m = map[p.s] || {};
            return '<tr><td>' + symLink(p.s) + (m.n ? '<small class="stp-dim"> ' + escapeHtml(m.n) + '</small>' : '') + '</td><td>' + escapeHtml(INDUSTRIES[p.s] || SECTORS[p.s] || '') + '</td>' +
              '<td class="num">' + money(m.sp != null ? m.sp : SPOTS[p.s]) + '</td><td class="num">' + chg(m.ch) + '</td><td class="num">' + big(m.mc) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="stp-src"><a href="?tab=compare" data-go-tab="compare">Compare these side by side</a></p>';
      });
    }
    function tabOwner(){
      if (!HAS_OWNER_ACCESS) return '';
      var sym = state.sym;
      if (!cache.gradesP) cache.gradesP = getJson('grades.json').catch(function(){ return null; });
      if (!cache.accP) cache.accP = getJson('picks-accuracy.json').catch(function(){ return null; });
      return Promise.all([cache.gradesP, cache.accP]).then(function(res){
        var g = res[0] && res[0].grades && res[0].grades[sym];
        var acc = res[1] || {};
        var html = '';
        if (g){
          var p = g.pillars || {};
          var rec = g.recommendation || {};
          html += '<section class="stp-sec"><h3 class="stp-h3">Grade</h3><div class="stp-stats stp-stats-3">' +
            '<div class="stp-stat"><span class="stp-stat-k">Total</span><b>' + (g.total != null ? (g.total > 0 ? '+' : '') + num(g.total, 1) : '—') + '</b><span class="stp-stat-sub">' + escapeHtml(rec.label || '') + '</span></div>' +
            ['fundamentals', 'technicals', 'mechanicals', 'narrative'].map(function(k){
              var v = p[k] && p[k].score;
              return '<div class="stp-stat"><span class="stp-stat-k">' + k.charAt(0).toUpperCase() + k.slice(1) + '</span><b>' + (v != null ? (v > 0 ? '+' : '') + num(v, 1) : '—') + '</b></div>';
            }).join('') +
          '</div><p class="stp-src"><button type="button" class="stp-btn" data-stock-grade>Open the full grade</button></p></section>';
        }
        var trades = (acc.open || []).map(function(r){ return { r: r, open: true }; }).concat((acc.closed || []).map(function(r){ return { r: r, open: false }; }))
          .filter(function(x){ return x.r && x.r.symbol === sym; })
          .sort(function(a, b){ return String(b.r.entryDate || '').localeCompare(String(a.r.entryDate || '')); }).slice(0, 12);
        if (trades.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Top Picks trades in ' + escapeHtml(sym) + '</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Opened</th><th scope="col">Side</th><th scope="col">Status</th><th scope="col" class="num">Option P&amp;L</th></tr></thead><tbody>' +
            trades.map(function(x){
              var r = x.r;
              var pnl = r.optionPnlPct != null ? r.optionPnlPct : r.realizedPct;
              return '<tr><td>' + escapeHtml(dateLabel(r.entryDate)) + '</td><td>' + escapeHtml(r.side === 'put' ? 'Put' : 'Call') + '</td><td>' + escapeHtml(x.open ? 'Open' : String(r.status || 'Closed').replace(/-/g, ' ')) + '</td><td class="num">' + chg(pnl, 1) + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="stp-src"><a href="?tab=track" data-go-tab="track">Open Track record</a></p></section>';
        }
        return html || '<p class="stp-empty">No grade or Top Picks trades for this stock yet.</p>';
      });
    }
    // --- events ----------------------------------------------------------------
    document.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-stock-sym], [data-stock-tab], [data-stock-kind], [data-stock-watch], [data-stock-grade], [data-go-tab], a[href^="?tab=stock&s="]') : null;
      if (!t) return;
      if (t.tagName === 'A' && !t.hasAttribute('data-stock-sym') && !t.hasAttribute('data-go-tab') && /^\\?tab=stock&s=/.test(t.getAttribute('href') || '')){
        // Any stock-page link on the site opens in place, without a reload.
        if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button === 1) return;
        var m = /[?&]s=([^&#]+)/.exec(t.getAttribute('href'));
        if (!m) return;
        ev.preventDefault();
        open(decodeURIComponent(m[1]));
        return;
      }
      if (t.hasAttribute('data-stock-sym')){
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
        ev.preventDefault();
        open(t.getAttribute('data-stock-sym'));
      } else if (t.hasAttribute('data-stock-tab')){
        state.tab = t.getAttribute('data-stock-tab');
        try { localStorage.setItem(TAB_KEY, state.tab); } catch (_) {}
        document.querySelectorAll('#stock-root .stp-tab').forEach(function(b){
          var on = b.getAttribute('data-stock-tab') === state.tab;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        paintTab();
      } else if (t.hasAttribute('data-stock-kind')){
        state.kind = t.getAttribute('data-stock-kind');
        document.querySelectorAll('[data-stock-kind]').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-stock-kind') === state.kind ? 'true' : 'false'); });
        drawChart();
      } else if (t.hasAttribute('data-stock-watch')){
        var on = toggleWatch(state.sym);
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
        t.textContent = on ? '★ Watching' : '☆ Watch';
      } else if (t.hasAttribute('data-stock-grade')){
        if (!HAS_OWNER_ACCESS) return;
        var g = document.querySelector('[data-page-tab="grade"]');
        if (g) g.click();
        var s = state.sym;
        setTimeout(function(){ try { combo.commit(s); } catch (_) {} }, 0);
      } else if (t.hasAttribute('data-go-tab')){
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
        var btn = document.querySelector('[data-page-tab="' + t.getAttribute('data-go-tab') + '"]');
        if (!btn) return;
        ev.preventDefault();
        btn.click();
      }
    });
    window.addEventListener('popstate', function(){
      var pane = document.getElementById('page-pane-stock');
      if (pane && !pane.hidden){ var s = urlSym(); if (s !== state.sym){ state.sym = s; load(); } }
    });
    return { open: open, load: load, names: names, nameOf: nameOf, watchlist: readWatch, href: function(sym){ return '?tab=stock&s=' + encodeURIComponent(String(sym || '').toUpperCase()); } };
  })();
`;
}

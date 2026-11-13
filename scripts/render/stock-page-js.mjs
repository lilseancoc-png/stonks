// The public stock page (?tab=stock&s=NVDA). One company on one page: price
// and change (live while the market is open), the price chart, key numbers,
// then tabs for Overview, News, Earnings, Options, Ownership, Leadership
// (board, executives, stakes and votes: leadership-client.mjs) and Similar
// stocks. Owners get two more tabs: Grade (the full grade tool, which used to
// be its own "Grade a stock" page and now moves in here) and Top Picks trades.
// Every stock link lands here; old ?tab=grade links open the Grade tab.
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
    var state = { sym: null, data: null, quote: null, tab: 'overview', chart: null, range: '6M', kind: 'area', token: 0, cone: true, afterTab: null, tabCharts: [], grid: { metric: 'oi', side: 'both' } };
    var cache = { names: null, namesP: null, oi: null, oiP: null, f13: null, f13P: null, calls: {}, grades: null, gradesP: null, acc: null, accP: null, accRecP: null, ulog: null, ulogP: null, ghist: null, ghistP: null };
    try { if (localStorage.getItem('stonks-stock-cone-v1') === '0') state.cone = false; } catch (_) {}
    try { var savedTab = localStorage.getItem(TAB_KEY); if (savedTab) state.tab = savedTab; } catch (_) {}

    function cleanSym(s){
      var v = String(s || '').trim().toUpperCase();
      return SYM_RE.test(v) ? v : null;
    }
    function stpOrd(n){
      var k = Math.round(Number(n)), t = k % 100, u = k % 10;
      return k + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
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
    function writeWatch(list){ try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (_) {} }
    // Owners: the list is also saved privately on the server
    // (/api/auth/owner-watchlist) so it follows them across devices.
    // WATCH_BASE_KEY holds the list this device and the server last agreed on,
    // so a removal on another device sticks (lib/owner-watchlist.mjs merge).
    var WATCH_BASE_KEY = 'stonks-watch-base-v1';
    var watchSync = { state: 'local', at: null, busy: false, icsToken: null };
    function readWatchBase(){
      try { var v = JSON.parse(localStorage.getItem(WATCH_BASE_KEY) || 'null'); return Array.isArray(v) ? v : null; } catch (_) { return null; }
    }
    // POSTs go out one at a time and only the newest reply is adopted, so a
    // slow reply to an older click can't drop a name added after it.
    var watchQueue = Promise.resolve(), watchSeq = 0;
    function adoptWatch(j){
      if (!j || !Array.isArray(j.symbols)){ watchSync.state = 'error'; repaintWatch(false); return; }
      var list = OWNER_WATCH.clean(j.symbols);
      var changed = list.join(',') !== readWatch().join(',');
      writeWatch(list);
      try { localStorage.setItem(WATCH_BASE_KEY, JSON.stringify(list)); } catch (_) {}
      watchSync.state = 'synced'; watchSync.at = j.updatedAt || null;
      // The private calendar link for this Owner's saved list (GET only).
      var newToken = typeof j.icsToken === 'string' && j.icsToken && j.icsToken !== watchSync.icsToken;
      if (newToken) watchSync.icsToken = j.icsToken;
      repaintWatch(changed || newToken);
    }
    function watchFailed(){ watchSync.state = 'error'; repaintWatch(false); }
    function watchRequest(method, body){
      return fetch('/api/auth/owner-watchlist', method === 'GET' ? { cache: 'no-store', credentials: 'same-origin' } :
        { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function(r){ return r.ok ? r.json() : null; });
    }
    // Queue a request; its reply is adopted only if nothing newer was queued.
    function queueWatch(run){
      var seq = ++watchSeq;
      watchQueue = watchQueue.then(run).then(function(j){ if (seq === watchSeq) adoptWatch(j); }, function(){ if (seq === watchSeq) watchFailed(); });
      return watchQueue;
    }
    function syncWatch(){
      if (!HAS_OWNER_ACCESS || watchSync.busy) return;
      watchSync.busy = true; watchSync.state = 'syncing';
      queueWatch(function(){
        return watchRequest('GET').then(function(j){
          if (!j || !Array.isArray(j.symbols)) return j;
          var merged = OWNER_WATCH.merge(j.symbols, readWatch(), readWatchBase());
          if (merged.join(',') === OWNER_WATCH.clean(j.symbols).join(',')) return j;
          return watchRequest('POST', { op: 'sync', local: readWatch(), base: readWatchBase() }).then(function(k){
            if (k && !k.icsToken && j.icsToken) k.icsToken = j.icsToken;
            return k;
          });
        });
      }).then(function(){ watchSync.busy = false; });
    }
    function toggleWatch(sym){
      var list = readWatch();
      var i = list.indexOf(sym);
      if (i >= 0) list.splice(i, 1); else list.unshift(sym);
      writeWatch(list);
      if (HAS_OWNER_ACCESS){
        watchSync.state = 'syncing';
        var body = { op: i < 0 ? 'add' : 'remove', symbol: sym };
        queueWatch(function(){ return watchRequest('POST', body); });
      }
      try { document.dispatchEvent(new CustomEvent('stonks-watchlist-changed')); } catch (_) {}
      return i < 0;
    }
    function watchNoteHtml(){
      if (!HAS_OWNER_ACCESS) return '';
      var txt = watchSync.state === 'synced' ? 'Saved to your Owner account, so it follows you to other devices.' :
        watchSync.state === 'syncing' ? 'Saving to your Owner account…' :
        watchSync.state === 'error' ? 'Could not reach your saved list; this device keeps its copy and syncs next time.' : '';
      return txt ? '<span class="wla-sync' + (watchSync.state === 'error' ? ' err' : '') + '" data-watch-sync>' + txt + '</span>' : '';
    }
    // Re-draw whatever shows the list: the picker's watchlist, the open
    // stock's Watch button, and listeners such as the Owner alerts on Home.
    function repaintWatch(listChanged){
      var pane = document.getElementById('page-pane-stock');
      var root = document.getElementById('stock-root');
      var block = pane && !pane.hidden && root && !state.sym ? root.querySelector('[data-stp-watch-block]') : null;
      if (block) block.innerHTML = watchBlockHtml();
      var btn = document.querySelector('[data-stock-watch]');
      if (btn && state.sym){
        var on = readWatch().indexOf(state.sym) >= 0;
        btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.textContent = on ? '★ Watching' : '☆ Watch';
      }
      if (listChanged) { try { document.dispatchEvent(new CustomEvent('stonks-watchlist-changed')); } catch (_) {} }
    }
    document.addEventListener('stonks-owner-ready', function(){ if (HAS_OWNER_ACCESS) syncWatch(); });
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
    function onGrade(){ return state.tab === 'grade' && HAS_OWNER_ACCESS; }
    function setUrl(sym, replace){
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('tab', 'stock');
        // The grade's contract (exp/k/t) stays in the link only while the
        // Grade tab shows that same stock.
        var keepContract = onGrade() && sym && url.searchParams.get('s') === sym;
        if (sym) url.searchParams.set('s', sym); else url.searchParams.delete('s');
        if (!keepContract) ['exp', 'k', 't'].forEach(function(k){ url.searchParams.delete(k); });
        if (onGrade()) url.searchParams.set('view', 'grade'); else if (state.tab === 'leadership') url.searchParams.set('view', 'leadership'); else url.searchParams.delete('view');
        var next = url.pathname + url.search + url.hash;
        if (next !== window.location.pathname + window.location.search + window.location.hash){
          if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
        }
      } catch (_) {}
    }
    function open(sym, tab){
      var s = cleanSym(sym);
      if (!s) return;
      if (tab) showTab(tab, true);
      state.sym = s;
      // Start at the top; a requested tab then scrolls into view as it shows.
      try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
      var btn = document.querySelector('[data-page-tab="stock"]');
      var pane = document.getElementById('page-pane-stock');
      // Opening from another page: the page loads this stock, not an older
      // ?s= still sitting in the address bar.
      if (pane && pane.hidden && btn){ openingSym = s; btn.click(); openingSym = null; setUrl(s, true); }
      else { setUrl(s, false); load(); }
    }
    var openingSym = null;
    function urlSym(){
      try { return cleanSym(new URLSearchParams(window.location.search).get('s')); } catch (_) { return null; }
    }
    function urlView(){
      try { return new URLSearchParams(window.location.search).get('view') || ''; } catch (_) { return ''; }
    }
    // Pick the tab the page opens on next. Old "Grade a stock" links and
    // buttons call this with 'grade' before the page loads.
    // jump: the visitor asked for this tab from elsewhere (a Grade button or
    // an old Grade link), so the page scrolls down to the tabs once it shows.
    var jumpToTabs = false;
    function showTab(tab, jump){
      if (tab === 'grade' && !HAS_OWNER_ACCESS) return;
      state.tab = tab;
      if (jump) jumpToTabs = true;
      try { localStorage.setItem(TAB_KEY, tab); } catch (_) {}
    }
    function maybeJumpToTabs(){
      if (!jumpToTabs) return;
      jumpToTabs = false;
      // The chart and key numbers above can still grow for a moment, so the
      // jump repeats twice more unless the visitor has scrolled since.
      var last = -1;
      function jump(){
        var strip = document.querySelector('#stock-root .stp-tabs');
        if (!strip || (last >= 0 && Math.abs(window.pageYOffset - last) > 2)) return;
        try {
          var top = Math.max(0, Math.round(strip.getBoundingClientRect().top + window.pageYOffset - 72));
          window.scrollTo({ top: top, behavior: 'auto' });
          last = window.pageYOffset;
        } catch (_) {}
      }
      jump();
      setTimeout(jump, 350);
      setTimeout(jump, 1000);
    }
    // The grade tool lives in the Grade tab. Before any re-render it goes back
    // to its own hidden pane so innerHTML never destroys it, and its live
    // quote polling stops while it is out of view.
    function parkGrade(){
      var sec = document.getElementById('opt-eval-section');
      var home = document.getElementById('page-pane-grade');
      if (sec && home && sec.parentNode !== home){
        home.appendChild(sec);
        if (typeof gradeHidden === 'function') gradeHidden();
      }
      var body = document.getElementById('stp-tab-body');
      if (body) body.classList.remove('is-grade');
    }
    function mountGrade(body){
      var sec = document.getElementById('opt-eval-section');
      if (!sec || !HAS_OWNER_ACCESS){ body.innerHTML = '<p class="stp-empty">The grade is not available.</p>'; return; }
      body.innerHTML = '';
      body.classList.add('is-grade');
      body.appendChild(sec);
      if (typeof gradeShowSymbol === 'function') gradeShowSymbol(state.sym);
      maybeJumpToTabs();
    }
    // Code that loads a ticker into the grade tool (Top Picks cards, Brief
    // chips, the calendar, saved links) brings the stock page along with it.
    function follow(sym){
      var s = cleanSym(sym);
      var pane = document.getElementById('page-pane-stock');
      if (!s || !pane || pane.hidden || s === state.sym) return;
      state.sym = s;
      setUrl(s, true);
      load();
    }
    // --- loading -------------------------------------------------------------
    function load(){
      var root = document.getElementById('stock-root');
      if (!root) return;
      var fromUrl = openingSym || urlSym();
      if (fromUrl) state.sym = fromUrl;
      if (!openingSym && (urlView() === 'grade' || urlView() === 'leadership')) showTab(urlView());
      parkGrade();
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
          parkGrade();
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
    function pickTiles(syms){
      return '<div class="stp-pick-grid">' + syms.map(function(s){
        var n = cache.names && cache.names[s];
        return '<a class="stp-pick" href="?tab=stock&s=' + encodeURIComponent(s) + '" data-stock-sym="' + escapeHtml(s) + '">' +
          '<span class="stp-pick-sym">' + escapeHtml(s) + '</span>' +
          '<span class="stp-pick-name">' + escapeHtml(n && n.n || INDUSTRIES[s] || SECTORS[s] || '') + '</span>' +
          (n && n.ch != null ? chg(n.ch) : '') + '</a>';
      }).join('') + '</div>';
    }
    function watchBlockHtml(){
      var watch = readWatch();
      return watch.length ? '<h3 class="stp-h3">Your watchlist</h3>' + watchNoteHtml() + pickTiles(watch) +
        (HAS_OWNER_ACCESS ? '<div class="wla-box" data-watch-alerts>' + (typeof watchAlertsHtml === 'function' ? watchAlertsHtml({ title: 'Alerts on your watchlist', limit: 12 }) : '') + '</div>' : '') : '';
    }
    function renderPicker(root){
      parkGrade();
      setHeader('Look up a stock', 'Price, chart, key numbers, news, earnings, options and owners for any stock this site follows.');
      var list = SYMBOLS.slice().sort();
      var tiles = pickTiles;
      var big8 = Object.keys(cache.names || {}).map(function(k){ return cache.names[k]; })
        .sort(function(a, b){ return (b.mc || 0) - (a.mc || 0); }).slice(0, 12).map(function(t){ return t.t; });
      root.innerHTML =
        searchBox() +
        '<div data-stp-watch-block>' + watchBlockHtml() + '</div>' +
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
      parkGrade();
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
        (typeof cmpToggleHtml === 'function' ? cmpToggleHtml(sym, 'stp-btn') : '');
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
      // FINRA short interest (public, twice a month).
      var si = f.shortInterest;
      if (si && si.percentFloat != null) cells.push(['Short interest', num(si.percentFloat, 1) + '% of float' + (si.daysToCover != null ? ' · ' + num(si.daysToCover, 1) + ' days to cover' : '')]);
      return '<div class="stp-stats">' +
        '<div class="stp-stat stp-stat-range"><span class="stp-stat-k">52-week range</span>' + (rangeBar || '<b>—</b>') + '</div>' +
        cells.map(function(c){ return '<div class="stp-stat"><span class="stp-stat-k">' + escapeHtml(c[0]) + '</span><b>' + escapeHtml(c[1]) + '</b></div>'; }).join('') +
      '</div>';
    }
    var TABS = [['overview', 'Overview'], ['story', 'Timeline'], ['news', 'News'], ['earnings', 'Earnings'], ['options', 'Options'], ['ownership', 'Ownership'], ['leadership', 'Leadership'], ['similar', 'Similar stocks']];
    // Funds have no board or executives of their own.
    function hasLeadership(){
      var d = state.data || {};
      return !!d.corporate || (typeof CALENDAR_STOCKS !== 'undefined' && CALENDAR_STOCKS.indexOf(state.sym) >= 0);
    }
    function tabsHtml(){
      var list = TABS.slice();
      if (!hasLeadership()) list = list.filter(function(t){ return t[0] !== 'leadership'; });
      // Owners: the full grade sits second, the stock's Top Picks trades last.
      if (HAS_OWNER_ACCESS){ list.splice(1, 0, ['grade', 'Grade']); list.push(['owner', 'Top Picks trades']); }
      if (!list.some(function(t){ return t[0] === state.tab; })) state.tab = 'overview';
      return '<div class="stp-tabs" role="tablist" aria-label="Stock sections">' + list.map(function(t){
        var on = t[0] === state.tab;
        return '<button type="button" role="tab" class="stp-tab' + (on ? ' is-on' : '') + '" data-stock-tab="' + t[0] + '" aria-selected="' + (on ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div><div class="stp-tab-body" role="tabpanel" id="stp-tab-body"></div>';
    }
    function render(root){
      var d = state.data || {};
      parkGrade();
      root.innerHTML = headerHtml() +
        '<div class="stp-chart-card">' +
          '<div class="stp-chart-tools"><div class="stp-kind" role="group" aria-label="Chart style">' +
            '<button type="button" class="ck-range" data-stock-kind="area" aria-pressed="' + (state.kind === 'area') + '">Line</button>' +
            '<button type="button" class="ck-range" data-stock-kind="candles" aria-pressed="' + (state.kind === 'candles') + '">Candles</button>' +
          '</div><button type="button" class="ck-range stp-cone-btn" data-stock-cone aria-pressed="' + (state.cone ? 'true' : 'false') + '" title="Show the range the options market prices to the next two expirations">Expected move</button></div>' +
          '<div id="stp-chart"></div>' +
        '</div>' +
        statsHtml() + tabsHtml() + searchBox();
      drawChart();
      paintTab();
      bindSearch(root);
    }
    // At-the-money implied volatility for one expiry: the average of the call
    // and put IV at the strike closest to the price.
    function atmIv(d, exp){
      var ch = d.chains && d.chains[String(exp)];
      var spot = d.spot;
      if (!ch || !(spot > 0)) return null;
      var best = null, bd = Infinity;
      (ch.c || []).forEach(function(r){ var dd = Math.abs(r.s - spot); if (r.iv > 0 && dd < bd){ bd = dd; best = r.s; } });
      if (best == null) return null;
      var vals = [];
      (ch.c || []).concat(ch.p || []).forEach(function(r){ if (r.s === best && r.iv > 0 && r.iv < 5) vals.push(r.iv); });
      return vals.length ? vals.reduce(function(a, b){ return a + b; }, 0) / vals.length : null;
    }
    // The forward cone: plus or minus one standard deviation from the last
    // close to the next two expirations, with total variance (IV² × time)
    // interpolated between them, on weekdays only.
    function coneData(d){
      var ps = d.priceSeries || {};
      if (!ps.t || !ps.t.length) return null;
      var lastT = String(ps.t[ps.t.length - 1]).slice(0, 10);
      var spot = ps.c[ps.c.length - 1];
      if (!(spot > 0)) return null;
      var base = Date.parse(lastT + 'T21:00:00Z') / 1000;
      var exps = (d.expirations || []).map(Number).filter(function(e){ return e - base > 43200; }).sort(function(a, b){ return a - b; });
      var picks = [];
      for (var i = 0; i < exps.length && picks.length < 2; i++){
        var iv = atmIv(d, exps[i]);
        if (iv == null) continue;
        var date = new Date(exps[i] * 1000).toISOString().slice(0, 10);
        var T = (Date.parse(date + 'T21:00:00Z') / 1000 - base) / (365 * 86400);
        if (!(T > 0)) continue;
        // Skip a second expiry within a week of the first: it adds nothing.
        if (picks.length && T - picks[0].T < 7 / 365) continue;
        picks.push({ exp: exps[i], date: date, iv: iv, T: T, w: iv * iv * T, pct: (Math.exp(iv * Math.sqrt(T)) - 1) * 100 });
      }
      if (!picks.length) return null;
      var knots = [{ T: 0, w: 0 }].concat(picks);
      function wAt(T){
        for (var k = 1; k < knots.length; k++){
          if (T <= knots[k].T){ var a = knots[k - 1], b = knots[k]; return a.w + (b.w - a.w) * (T - a.T) / (b.T - a.T); }
        }
        return knots[knots.length - 1].w;
      }
      var upper = [{ time: lastT, value: spot }], lower = [{ time: lastT, value: spot }];
      var endMs = Date.parse(picks[picks.length - 1].date + 'T12:00:00Z');
      for (var t = Date.parse(lastT + 'T12:00:00Z') + 86400000; t <= endMs; t += 86400000){
        var dt = new Date(t), dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        var iso = dt.toISOString().slice(0, 10);
        var Tt = (Date.parse(iso + 'T21:00:00Z') / 1000 - base) / (365 * 86400);
        var sd = Math.sqrt(Math.max(0, wAt(Tt)));
        upper.push({ time: iso, value: +(spot * Math.exp(sd)).toFixed(2) });
        lower.push({ time: iso, value: +(spot * Math.exp(-sd)).toFixed(2) });
      }
      return upper.length > 1 ? { upper: upper, lower: lower, picks: picks, spot: spot } : null;
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
      var cone = !useIntra && state.cone ? coneData(d) : null;
      var upMarks = null;
      if (cone){
        var nextE = (d.earningsHx && d.earningsHx.next && d.earningsHx.next.date) || f.nextEarningsDate || null;
        var coneEnd = cone.upper[cone.upper.length - 1].time;
        // Short marks only: the right edge clips long text, and the caption
        // already gives the ±% at each expiry.
        upMarks = nextE && nextE > cone.upper[0].time && nextE <= coneEnd ? [{ time: String(nextE).slice(0, 10), text: 'E', position: 'aboveBar', shape: 'circle' }] : [];
        var loMarks = [];
        series.push({ name: 'Expected high', short: '+1σ', type: 'line', data: cone.upper, dashed: true, width: 1, lastValue: false, markers: upMarks });
        series.push({ name: 'Expected low', short: '−1σ', type: 'line', data: cone.lower, dashed: true, width: 1, lastValue: false, markers: loMarks });
      }
      state.chart = CHART_KIT.mount(el, {
        series: series,
        volume: volume,
        ranges: ranges,
        range: state.range,
        intraday: useIntra,
        extendRange: !!cone,
        prefix: '$',
        height: 340,
        empty: 'No price history yet for this stock.',
        source: (useIntra ? '30-minute bars' : 'Daily closes') + ' · Yahoo Finance' + (ps.t && ps.t.length ? ' · through ' + dateLabel(ps.t[ps.t.length - 1]) : '') +
          (cone ? ' · Dashed lines: the ±1 standard-deviation range the options price, about a 68% chance of finishing inside (' + cone.picks.map(function(pk){ return '±' + num(pk.pct, 1) + '% by ' + dateLabel(pk.date); }).join(', ') + ')' + (upMarks && upMarks.length ? '; E marks the next earnings report' : '') : ''),
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
      if (t === 'grade' && HAS_OWNER_ACCESS){ mountGrade(body); return; }
      parkGrade();
      var fn = t === 'news' ? tabNews : t === 'earnings' ? tabEarnings : t === 'options' ? tabOptions : t === 'ownership' ? tabOwnership : t === 'leadership' ? tabLeadership : t === 'similar' ? tabSimilar : t === 'owner' ? tabOwner : t === 'story' ? tabStory : tabOverview;
      state.tabCharts.forEach(function(h){ try { h.destroy(); } catch (_) {} });
      state.tabCharts = [];
      state.afterTab = null;
      body.innerHTML = '<p class="stp-loading">Loading…</p>';
      var token = state.token;
      Promise.resolve(fn()).then(function(html){
        if (token !== state.token || state.tab !== t) return;
        body.innerHTML = html || '<p class="stp-empty">Nothing to show here yet.</p>';
        // A tab that draws a chart mounts it once its HTML is in place.
        var after = state.afterTab;
        state.afterTab = null;
        if (typeof after === 'function') { try { after(); } catch (_) {} }
      }).catch(function(){
        if (token !== state.token) return;
        body.innerHTML = '<p class="stp-empty">This section could not load. Try again in a moment.</p>';
      });
    }
    // --- chatter vs price -----------------------------------------------------
    // Stocktwits bullish share (last reading per ET day) next to the close.
    function chatterHtml(d){
      var hist = d.social && Array.isArray(d.social.history) ? d.social.history : [];
      var byDay = {};
      hist.forEach(function(p){
        if (!p || p.bullishSharePct == null || !p.at) return;
        var day;
        try { day = new Date(p.at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } catch (_) { return; }
        byDay[day] = p;
      });
      var days = Object.keys(byDay).sort();
      if (days.length < 3) return '';
      var ps = d.priceSeries || {};
      var close = {};
      (ps.t || []).forEach(function(t, i){ if (ps.c[i] != null) close[String(t).slice(0, 10)] = ps.c[i]; });
      var share = days.map(function(dd){ return { time: dd, value: byDay[dd].bullishSharePct }; });
      var msgs = days.map(function(dd){ return { time: dd, value: byDay[dd].msgCount24h || null }; });
      var from = days[0];
      var price = (ps.t || []).map(function(t, i){ return { time: String(t).slice(0, 10), value: ps.c[i] }; }).filter(function(p){ return p.time >= from && p.value != null; });
      state.afterTab = function(){
        var el = document.getElementById('stp-chatter');
        if (!el) return;
        state.tabCharts.push(CHART_KIT.mount(el, {
          height: 240,
          series: [
            { name: 'Bullish share', short: 'Bull %', type: 'line', data: share, format: function(v){ return Math.round(v) + '%'; } },
            { name: 'Price', short: 'Price', type: 'line', axis: 'left', data: price, dashed: true, width: 1, format: function(v){ return '$' + Number(v).toFixed(2); } },
            { name: 'Posts within 24h (of 30 sampled)', short: 'Posts', type: 'histogram', pane: 'lower', data: msgs, format: function(v){ return String(Math.round(v)); } }
          ],
          bands: [{ value: 50, title: '50%', axis: false }],
          source: 'Stocktwits, newest 30 posts per build, tagged bullish or bearish · last reading each day'
        }));
      };
      var last = byDay[days[days.length - 1]];
      return '<section class="stp-sec"><h3 class="stp-h3">What traders are saying vs the price</h3>' +
        '<p class="stp-src">Latest: ' + num(last.bullishSharePct, 0) + '% of tagged messages bullish' + (last.msgCount24h ? ' · ' + count(last.msgCount24h) + ' of the newest 30 posts were within 24 hours' : '') + '. Chatter often follows the price rather than leading it.</p>' +
        '<div id="stp-chatter"></div></section>';
    }
    // --- earnings reactions: small multiples ----------------------------------
    // Ten sessions before to five after each print, from the close before.
    function earningsMinisHtml(events){
      var list = (events || []).filter(function(e){ return Array.isArray(e.path) && e.path.some(function(v){ return v != null; }); });
      if (!list.length) return '';
      var W = 168, H = 92, P = 6;
      var cards = list.map(function(e){
        var path = e.path;
        var im = e.impliedMovePct != null ? Number(e.impliedMovePct) : e.impliedMoveEstPct != null ? Number(e.impliedMoveEstPct) : null;
        var vals = path.filter(function(v){ return v != null; }).map(function(v){ return v * 100; });
        var top = Math.max(2, Math.max.apply(null, vals.map(Math.abs)), im || 0) * 1.12;
        function X(i){ return P + i * (W - 2 * P) / (path.length - 1); }
        function Y(v){ return H / 2 - v / top * (H / 2 - P); }
        var pts = [], hov = [];
        path.forEach(function(v, i){
          if (v == null) return;
          var k = i - 10;
          pts.push(X(i).toFixed(1) + ',' + Y(v * 100).toFixed(1));
          hov.push({ x: X(i), y: Y(v * 100), label: (k === 0 ? 'Report day' : k < 0 ? (-k) + (k === -1 ? ' session before' : ' sessions before') : k + (k === 1 ? ' session after' : ' sessions after')) + '\\n' + pctRaw(v * 100, 1) });
        });
        var react = path[10] != null ? path[10] * 100 : (e.movePct != null ? e.movePct * 100 : null);
        var up = react != null ? react >= 0 : (vals[vals.length - 1] || 0) >= 0;
        var band = im ? '<rect class="stp-em-band" x="' + X(9).toFixed(1) + '" y="' + Y(im).toFixed(1) + '" width="' + (X(path.length - 1) - X(9)).toFixed(1) + '" height="' + (Y(-im) - Y(im)).toFixed(1) + '"/>' : '';
        var svg = '<svg class="stp-em-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price path around the ' + escapeHtml(dateLabel(e.date)) + ' report"' + chHoverAttr(hov) + '>' + band +
          '<line class="stp-em-zero" x1="' + P + '" x2="' + (W - P) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>' +
          '<line class="stp-em-day" x1="' + ((X(9) + X(10)) / 2).toFixed(1) + '" x2="' + ((X(9) + X(10)) / 2).toFixed(1) + '" y1="' + P + '" y2="' + (H - P) + '"/>' +
          '<polyline class="' + (up ? 'is-up' : 'is-down') + '" points="' + pts.join(' ') + '" fill="none"/></svg>';
        var verdict = e.surprisePct == null ? '' : e.surprisePct > 1 ? '<span class="stp-em-tag is-up">Beat</span>' : e.surprisePct < -1 ? '<span class="stp-em-tag is-down">Missed</span>' : '<span class="stp-em-tag">In line</span>';
        var vs = react != null && im ? (Math.abs(react) > im ? 'Moved more than the ±' + num(im, 1) + '% priced' : 'Inside the ±' + num(im, 1) + '% priced') : '';
        return '<figure class="stp-em"><figcaption><b>' + escapeHtml(dateLabel(e.date)) + '</b>' + verdict + '</figcaption>' + svg +
          '<p class="stp-em-foot">Report day ' + chg(react, 1) + (vs ? '<br>' + escapeHtml(vs) + (e.impliedMovePct == null && e.impliedMoveEstPct != null ? ' (estimated)' : '') : '') + '</p></figure>';
      }).join('');
      return '<section class="stp-sec"><h3 class="stp-h3">How the stock moved around each report</h3><div class="stp-em-grid">' + cards + '</div>' +
        '<p class="stp-src">Ten sessions before to five after, from the close before the report. The shaded band is the move the options priced. Hover a line for each day.</p></section>';
    }
    // --- option chain heat grid ------------------------------------------------
    function chainGridHtml(d){
      var spot = d.spot;
      var exps = (d.expirations || []).map(Number).sort(function(a, b){ return a - b; }).filter(function(e){ return d.chains && d.chains[String(e)]; }).slice(0, 8);
      if (!(spot > 0) || !exps.length) return '<p class="stp-empty">No option chain saved for this stock.</p>';
      var metric = state.grid.metric === 'v' ? 'v' : 'oi', side = state.grid.side;
      var strikes = {};
      exps.forEach(function(e){
        var ch = d.chains[String(e)];
        ['c', 'p'].forEach(function(k){
          if (side === 'calls' && k === 'p') return;
          if (side === 'puts' && k === 'c') return;
          (ch[k] || []).forEach(function(r){
            if (!(r.s > 0) || Math.abs(r.s / spot - 1) > 0.15) return;
            var key = String(r.s);
            strikes[key] = strikes[key] || {};
            strikes[key][e] = (strikes[key][e] || 0) + (Number(r[metric]) || 0);
          });
        });
      });
      var ks = Object.keys(strikes).map(Number).sort(function(a, b){ return b - a; });
      // Keep at most 28 strikes, centred on the price.
      if (ks.length > 28){
        var mid = 0, best = Infinity;
        ks.forEach(function(k, i){ var dd = Math.abs(k - spot); if (dd < best){ best = dd; mid = i; } });
        var lo = Math.max(0, Math.min(ks.length - 28, mid - 14));
        ks = ks.slice(lo, lo + 28);
      }
      var max = 0;
      ks.forEach(function(k){ exps.forEach(function(e){ var v = strikes[String(k)][e] || 0; if (v > max) max = v; }); });
      if (!(max > 0)) return '<p class="stp-empty">No ' + (metric === 'v' ? 'volume' : 'open interest') + ' near the price yet.</p>';
      var spotRow = -1;
      for (var i = 0; i < ks.length - 1; i++) if (ks[i] >= spot && ks[i + 1] < spot){ spotRow = i; break; }
      function lbl(e){ return new Date(e * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
      function btn(attr, val, cur, text){ return '<button type="button" class="ck-range" ' + attr + '="' + val + '" aria-pressed="' + (val === cur ? 'true' : 'false') + '">' + text + '</button>'; }
      var head = '<div class="stp-grid-tools"><span role="group" aria-label="Measure">' + btn('data-stock-grid-metric', 'oi', metric, 'Open interest') + btn('data-stock-grid-metric', 'v', metric, 'Volume') + '</span>' +
        '<span role="group" aria-label="Side">' + btn('data-stock-grid-side', 'both', side, 'Both') + btn('data-stock-grid-side', 'calls', side, 'Calls') + btn('data-stock-grid-side', 'puts', side, 'Puts') + '</span></div>';
      var rows = ks.map(function(k, ri){
        var cells = exps.map(function(e){
          var v = strikes[String(k)][e] || 0;
          var a = v > 0 ? Math.sqrt(v / max) : 0;
          return '<td class="num" style="--g:' + a.toFixed(3) + '" title="' + escapeHtml(money(k) + ' · ' + lbl(e) + ': ' + count(v)) + '">' + (v > 0 ? escapeHtml(count(v)) : '') + '</td>';
        }).join('');
        return '<tr' + (ri === spotRow ? ' class="is-spot"' : '') + '><th scope="row" class="num">' + money(k) + '</th>' + cells + '</tr>';
      }).join('');
      return head + '<div class="stp-table-wrap"><table class="stp-grid" data-nosort><thead><tr><th scope="col" class="num">Strike</th>' + exps.map(function(e){ return '<th scope="col" class="num">' + escapeHtml(lbl(e)) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="stp-src">Stronger color means more contracts. The line between two rows marks the price (' + money(spot) + '). Strikes within 15% of the price, the nearest ' + exps.length + ' expirations, from the last build.</p>';
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
      html += '<section class="stp-sec" id="stp-valuation" hidden></section>';
      html += chatterHtml(d);
      if (f.longBusinessSummary){
        var text = String(f.longBusinessSummary);
        var short = text.length > 420 ? text.slice(0, text.lastIndexOf('. ', 420) + 1 || 420) : text;
        html += '<section class="stp-sec"><h3 class="stp-h3">About the company</h3><p class="stp-about">' + escapeHtml(short) +
          (short.length < text.length ? ' <details class="stp-more"><summary>Read more</summary><p>' + escapeHtml(text.slice(short.length)) + '</p></details>' : '') + '</p></section>';
      }
      // The valuation band fills in once its public file arrives, after any
      // chart this tab already queued.
      var prevAfter = state.afterTab, vSym = state.sym, vToken = state.token;
      state.afterTab = function(){ if (typeof prevAfter === 'function') prevAfter(); fillValuation(vSym, vToken); };
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
      html += earningsMinisHtml(events);
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
        '<div class="stp-stat"><span class="stp-stat-k">Versus its own past year</span><b>' + (iv.pctile != null ? escapeHtml(stpOrd(iv.pctile)) + ' percentile' : '—') + '</b>' +
          (iv.pctile != null ? '<span class="stp-stat-sub">' + (iv.pctile >= 80 ? 'Options are expensive for this stock' : iv.pctile <= 20 ? 'Options are cheap for this stock' : 'Options are priced near normal') + '</span>' : '') + '</div>' +
        '<div class="stp-stat"><span class="stp-stat-k">Expected move</span><b>' + (em ? '±' + num(em.pct, 1) + '%' : '—') + '</b>' +
          (em ? '<span class="stp-stat-sub">by ' + escapeHtml(new Date(em.exp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })) + ' (about ' + money(em.dollars) + ')</span>' : '') + '</div>' +
      '</div>';
      html += '<section class="stp-sec"><h3 class="stp-h3">Where the open contracts are</h3><div id="stp-grid">' + chainGridHtml(d) + '</div></section>';
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
    // Peer valuation band (public valuation-bands.json, lib/valuation-band.mjs).
    function valuationData(){
      if (cache.vb) return Promise.resolve(cache.vb);
      if (cache.vbP) return cache.vbP;
      cache.vbP = getJson('valuation-bands.json').then(function(j){ cache.vb = j && j.rows ? j : { rows: {} }; return cache.vb; }).catch(function(){ cache.vb = { rows: {} }; return cache.vb; });
      return cache.vbP;
    }
    function valuationBarHtml(label, m){
      if (!m || (m.value == null && !m.peers && !m.own)) return '';
      var lo = Infinity, hi = -Infinity;
      function take(v){ if (v != null && isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      take(m.value); if (m.peers){ take(m.peers.lo); take(m.peers.hi); } if (m.own){ take(m.own.lo); take(m.own.hi); }
      if (!isFinite(lo) || !isFinite(hi)) return '';
      if (hi === lo){ lo = lo * 0.9; hi = hi * 1.1 || 1; }
      var pad = (hi - lo) * 0.08; lo -= pad; hi += pad; if (lo < 0) lo = 0;
      function P(v){ return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); }
      function f(v){ return v == null || !isFinite(v) ? '\u2014' : Number(v) >= 100 ? Math.round(v) + '\u00d7' : Number(v).toFixed(1) + '\u00d7'; }
      var track = '';
      if (m.peers) track += '<i class="stp-band-peers" style="left:' + P(m.peers.lo).toFixed(1) + '%;width:' + Math.max(0.8, P(m.peers.hi) - P(m.peers.lo)).toFixed(1) + '%" title="Peers ' + f(m.peers.lo) + ' to ' + f(m.peers.hi) + '"></i><i class="stp-band-median" style="left:' + P(m.peers.median).toFixed(1) + '%" title="Peer median ' + f(m.peers.median) + '"></i>';
      if (m.own) track += '<i class="stp-band-own" style="left:' + P(m.own.lo).toFixed(1) + '%;width:' + Math.max(0.8, P(m.own.hi) - P(m.own.lo)).toFixed(1) + '%" title="Own range ' + f(m.own.lo) + ' to ' + f(m.own.hi) + '"></i>';
      if (m.value != null) track += '<i class="stp-band-now" style="left:' + P(m.value).toFixed(1) + '%" title="Now ' + f(m.value) + '"></i>';
      var notes = [];
      if (m.peers) notes.push('peers ' + f(m.peers.lo) + '\u2013' + f(m.peers.hi) + ', median ' + f(m.peers.median) + (m.peers.pct != null ? ', this stock at the ' + stpOrd(m.peers.pct) + ' percentile' : ''));
      if (m.own) notes.push('own range ' + f(m.own.lo) + '\u2013' + f(m.own.hi) + ' over ' + m.own.days + ' session' + (m.own.days === 1 ? '' : 's') + (m.own.pct != null ? ', now at the ' + stpOrd(m.own.pct) + ' percentile' : ''));
      return '<div class="stp-band"><div class="stp-band-head"><span>' + escapeHtml(label) + '</span><b>' + (m.value != null ? f(m.value) : '<span class="stp-dim">not reported</span>') + '</b></div>' +
        '<div class="stp-band-track" role="img" aria-label="' + escapeHtml(label + ': ' + notes.join('; ')) + '">' + track + '</div>' +
        '<small class="stp-dim">' + escapeHtml(notes.join(' \u00b7 ') || 'No range yet.') + '</small></div>';
    }
    function valuationHtml(vb, sym){
      var row = vb && vb.rows && vb.rows[sym];
      if (!row) return '';
      var labels = {}; (vb.metrics || []).forEach(function(m){ labels[m.key] = m.label; });
      var bars = ['pe', 'fpe', 'evs', 'ps'].map(function(k){ return row[k] ? valuationBarHtml(labels[k] || k, row[k]) : ''; }).join('');
      if (!bars) return '';
      var peers = row.peers || {};
      var basis = peers.basis === 'industry' ? 'same sub-industry' : peers.basis === 'sector' ? 'same sector' : peers.basis === 'group' ? 'same broad group' : 'no peer group';
      return '<h3 class="stp-h3">Valuation vs peers and its own range</h3>' +
        (peers.n ? '<p class="stp-lede">Peers: ' + escapeHtml(peers.label || '') + ' (' + peers.n + ' tracked names, ' + basis + ')' + (peers.members && peers.members.length ? ' \u00b7 ' + peers.members.slice(0, 8).map(function(s){ return symLink(s); }).join(', ') + (peers.members.length > 8 ? ', \u2026' : '') : '') + '</p>' : '<p class="stp-lede">Too few tracked peers for a band; the own range still shows.</p>') +
        '<div class="stp-band-legend"><span><i class="stp-band-peers"></i>peer range</span><span><i class="stp-band-median"></i>peer median</span><span><i class="stp-band-own"></i>own range so far</span><span><i class="stp-band-now"></i>now</span></div>' +
        bars +
        '<p class="stp-src">' + escapeHtml(vb.note || '') + (vb.asOf ? ' As of ' + escapeHtml(dateLabel(vb.asOf)) + '.' : '') + '</p>';
    }
    function fillValuation(sym, token){
      valuationData().then(function(vb){
        if (state.token !== token || state.sym !== sym) return;
        var host = document.getElementById('stp-valuation');
        if (!host) return;
        var inner = valuationHtml(vb, sym);
        if (inner){ host.innerHTML = inner; host.hidden = false; }
      });
    }
    function f13Data(){
      if (cache.f13) return Promise.resolve(cache.f13);
      if (cache.f13P) return cache.f13P;
      cache.f13P = getJson('13f.json').then(function(j){ cache.f13 = j || {}; return cache.f13; }).catch(function(){ cache.f13 = {}; return cache.f13; });
      return cache.f13P;
    }
    function tabLeadership(){
      var d = state.data && state.data.corporate;
      if (!d) return '<p class="stp-empty">Board and leadership data for ' + escapeHtml(state.sym) + ' is still being collected from SEC filings. It fills in over the next few builds.</p>';
      var sym = state.sym;
      state.afterTab = function(){ LEADERSHIP.mount(document.getElementById('ld-root'), d, sym); };
      return '<div id="ld-root" class="ld-root"></div>';
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
        var f4p = j.insiderTransactions || {};
        var clusterRead = f4p.clusterBuying && Array.isArray(f4p.clusterBuying.rows) ? f4p.clusterBuying : INSIDER_CLUSTER.clusters(tx, { asOf: f4p.asOf });
        var myCluster = (clusterRead.rows || []).filter(function(r){ return r && r.symbol === sym; })[0];
        if (myCluster){
          html += '<section class="stp-sec stp-cluster"><h3 class="stp-h3">Cluster buying</h3><p class="stp-cluster-line"><span class="stp-move is-up">' + myCluster.insiders + ' insiders bought</span> ' + escapeHtml(INSIDER_CLUSTER.sentence(myCluster)) + (myCluster.names && myCluster.names.length ? ' <span class="stp-dim">' + escapeHtml(myCluster.names.slice(0, 5).join(', ')) + '</span>' : '') + '</p>' +
            '<p class="stp-src">Several insiders buying with their own money inside ' + clusterRead.windowDays + ' days is a stronger read than one purchase. It is an SEC disclosure, not a forecast.</p></section>';
        }
        if (mine.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Insider buys and sells</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Trade</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Value</th></tr></thead><tbody>' +
            mine.map(function(t){
              return '<tr><td>' + escapeHtml(dateLabel(t.transactionDate)) + '</td><td>' + escapeHtml(t.ownerName || '') + (t.officerTitle ? '<small class="stp-dim"> · ' + escapeHtml(t.officerTitle) + '</small>' : '') + '</td>' +
                '<td><span class="stp-move ' + (t.direction === 'buy' ? 'is-up' : 'is-down') + '">' + (t.direction === 'buy' ? 'Bought' : 'Sold') + '</span></td><td class="num">' + count(t.shares) + '</td><td class="num">' + big(t.value) + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="stp-src">SEC Form 4 open-market trades only. Grants, option exercises and tax sales are left out.</p></section>';
        }
        if (!html) html = '<p class="stp-empty">None of the funds this site follows reported a large move in ' + escapeHtml(sym) + ' last quarter, and no insider bought or sold on the open market in the recent filings.</p>';
        html += '<p class="stp-src">' + (j.period ? escapeHtml(j.period) + ' 13F filings' + (j.filingWindow ? ', filed ' + escapeHtml(j.filingWindow) : '') + '. ' : '') + '<a href="?tab=f13" data-go-tab="f13">Open Who owns what</a>' + (hasLeadership() ? ' · <button type="button" class="stp-link" data-stock-tab="leadership">Who runs and controls ' + escapeHtml(sym) + '</button>' : '') + '</p>';
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
    // --- timeline ---------------------------------------------------------------
    // One year of the stock's story on its price line. Public layer: earnings,
    // big move days, unusual option prints (the last 7 days the scanner keeps),
    // insider trades, fund filings and today's options walls. Owner layer:
    // grade moves and Top Picks entries and exits, read only with the session.
    function ulogData(){
      if (cache.ulog) return Promise.resolve(cache.ulog);
      if (cache.ulogP) return cache.ulogP;
      cache.ulogP = getJson('unusual-log.json').then(function(j){ cache.ulog = j || {}; return cache.ulog; }).catch(function(){ cache.ulog = {}; return cache.ulog; });
      return cache.ulogP;
    }
    // The Story's grade and trade markers are a reporting view, so they read
    // the Track Record's copy (which leaves out any wiped period), not the raw
    // engine files.
    function recordJson(key){
      var url = typeof trackRecordDataUrl === 'function' ? trackRecordDataUrl(key) : dataUrl(key);
      return fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    function ghistData(){
      if (!HAS_OWNER_ACCESS) return Promise.resolve(null);
      if (cache.ghist) return Promise.resolve(cache.ghist);
      if (cache.ghistP) return cache.ghistP;
      cache.ghistP = recordJson('grades-history.json').then(function(j){ cache.ghist = j || {}; return cache.ghist; }).catch(function(){ cache.ghistP = null; return null; });
      return cache.ghistP;
    }
    function accData(){
      if (!HAS_OWNER_ACCESS) return Promise.resolve(null);
      if (!cache.accRecP) cache.accRecP = recordJson('picks-accuracy.json').catch(function(){ cache.accRecP = null; return null; });
      return cache.accRecP;
    }
    function etDay(iso){ try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } catch (_) { return null; } }
    var STORY_KINDS = {
      earnings: { label: 'Earnings', mark: 'E' }, move: { label: 'Big move', mark: '' }, flow: { label: 'Unusual options', mark: 'U' },
      insider: { label: 'Insider', mark: 'I' }, fund: { label: 'Fund filing', mark: 'F' }, grade: { label: 'Grade', mark: 'G', owner: true }, trade: { label: 'Top Picks', mark: 'T', owner: true }
    };
    function tabStory(){
      var d = state.data || {}, sym = state.sym;
      var ps = d.priceSeries || {};
      if (!ps.t || ps.t.length < 10) return '<p class="stp-empty">Not enough price history yet for a timeline.</p>';
      var owner = HAS_OWNER_ACCESS;
      return Promise.all([f13Data(), ulogData(), oiData(), owner ? ghistData() : null, owner ? accData() : null]).then(function(res){
        var f13 = res[0] || {}, ulog = res[1] || {}, oi = res[2] || {}, gh = res[3], acc = res[4];
        var times = ps.t.map(function(t){ return String(t).slice(0, 10); });
        var first = times[0], last = times[times.length - 1];
        var ev = [];
        function add(date, kind, text, tone){ if (date && date >= first) ev.push({ date: String(date).slice(0, 10), kind: kind, text: text, tone: tone || null }); }
        ((d.earningsHx && d.earningsHx.events) || []).forEach(function(e){
          var mv = e.path && e.path[10] != null ? e.path[10] * 100 : (e.movePct != null ? e.movePct * 100 : null);
          var verdict = e.surprisePct == null ? 'reported' : e.surprisePct > 1 ? 'beat estimates' : e.surprisePct < -1 ? 'missed estimates' : 'in line with estimates';
          add(e.date, 'earnings', 'Earnings: ' + verdict + (mv != null ? ', stock ' + pctRaw(mv, 1) + ' on the report day' : ''), mv == null ? null : mv >= 0 ? 'up' : 'down');
        });
        var moves = [];
        for (var i = 1; i < ps.c.length; i++) if (ps.c[i] > 0 && ps.c[i - 1] > 0) moves.push({ i: i, m: (ps.c[i] / ps.c[i - 1] - 1) * 100 });
        var absSorted = moves.map(function(x){ return Math.abs(x.m); }).sort(function(a, b){ return a - b; });
        var med = absSorted.length ? absSorted[Math.floor(absSorted.length / 2)] : 1;
        var bar = Math.max(3, med * 3);
        var earnDays = {};
        ev.forEach(function(x){ if (x.kind === 'earnings') earnDays[x.date] = 1; });
        moves.filter(function(x){ return Math.abs(x.m) >= bar; }).sort(function(a, b){ return Math.abs(b.m) - Math.abs(a.m); }).slice(0, 10).forEach(function(x){
          var dt = times[x.i];
          if (earnDays[dt]) return;
          add(dt, 'move', (x.m >= 0 ? 'Jumped ' : 'Fell ') + pctRaw(Math.abs(x.m), 1).replace('+', '') + ' in a day', x.m >= 0 ? 'up' : 'down');
        });
        var flowDays = {};
        (Array.isArray(ulog.entries) ? ulog.entries : []).forEach(function(e){
          if (!e || e.symbol !== sym || !e.scannedAt) return;
          var day = etDay(e.scannedAt);
          var k = e.side + '|' + e.strike + '|' + e.expSec;
          var fd = flowDays[day] = flowDays[day] || { seen: {}, calls: 0, puts: 0, prem: 0 };
          if (fd.seen[k]) return;
          fd.seen[k] = 1;
          if (e.side === 'put') fd.puts++; else fd.calls++;
          fd.prem += Number(e.premium) || 0;
        });
        Object.keys(flowDays).forEach(function(day){
          var fd = flowDays[day];
          add(day, 'flow', 'Unusual options: ' + (fd.calls ? fd.calls + ' call' + (fd.calls === 1 ? '' : 's') : '') + (fd.calls && fd.puts ? ' and ' : '') + (fd.puts ? fd.puts + ' put' + (fd.puts === 1 ? '' : 's') : '') + (fd.prem ? ', ' + big(fd.prem) + ' premium' : ''), fd.calls >= fd.puts ? 'up' : 'down');
        });
        var ins = {};
        ((f13.insiderTransactions && f13.insiderTransactions.transactions) || []).forEach(function(t){
          if (!t || t.symbol !== sym || !t.openMarket || !t.transactionDate) return;
          var key = String(t.transactionDate).slice(0, 10) + '|' + (t.direction === 'buy' ? 'buy' : 'sell');
          var r = ins[key] = ins[key] || { n: 0, value: 0, who: {} };
          r.n++; r.value += Number(t.value) || 0; if (t.ownerName) r.who[t.ownerName] = 1;
        });
        Object.keys(ins).forEach(function(key){
          var parts = key.split('|'), r = ins[key], who = Object.keys(r.who);
          add(parts[0], 'insider', (who.length === 1 ? who[0] : who.length + ' insiders') + (parts[1] === 'buy' ? ' bought' : ' sold') + (r.value ? ' ' + big(r.value) : ''), parts[1] === 'buy' ? 'up' : 'down');
        });
        var funds = {};
        Object.keys(f13.perFirm || {}).forEach(function(firm){
          var fr = f13.perFirm[firm] || {};
          (fr.topBought || []).concat(fr.topSold || []).forEach(function(r){
            if (!r || r.ticker !== sym || !fr.filingDate) return;
            var day = String(fr.filingDate).slice(0, 10);
            var g = funds[day] = funds[day] || { up: [], down: [] };
            (r.valueChange >= 0 ? g.up : g.down).push(firm);
          });
        });
        Object.keys(funds).forEach(function(day){
          var g = funds[day];
          add(day, 'fund', (g.up.length ? g.up.length + ' fund' + (g.up.length === 1 ? '' : 's') + ' added (' + g.up.slice(0, 2).join(', ') + (g.up.length > 2 ? '…' : '') + ')' : '') + (g.up.length && g.down.length ? '; ' : '') + (g.down.length ? g.down.length + ' cut (' + g.down.slice(0, 2).join(', ') + (g.down.length > 2 ? '…' : '') + ')' : '') + ' in 13F filings', g.up.length >= g.down.length ? 'up' : 'down');
        });
        if (owner && gh && Array.isArray(gh.changes)){
          gh.changes.filter(function(c){ return c && c.symbol === sym && (Math.abs(Number(c.deltaScore) || 0) >= 2 || c.prevTier !== c.curTier); }).slice(0, 30).forEach(function(c){
            var day = etDay(c.date);
            ev.push({ date: day, kind: 'grade', text: 'Grade ' + (c.prevTotal != null ? Number(c.prevTotal).toFixed(1) : '?') + ' → ' + (c.total != null ? Number(c.total).toFixed(1) : '?') + (c.curTier && c.curTier !== c.prevTier ? ' (' + String(c.curTier).replace(/-/g, ' ') + ')' : ''), tone: c.direction === 'up' ? 'up' : 'down', owner: true });
          });
        }
        if (owner && acc){
          (acc.open || []).concat(acc.closed || []).forEach(function(e){
            if (!e || e.symbol !== sym) return;
            var side = e.side === 'put' ? 'put' : 'call';
            if (e.entryDate) ev.push({ date: etDay(e.entryDate), kind: 'trade', text: 'Top Picks opened a ' + side, tone: side === 'call' ? 'up' : 'down', owner: true });
            if (e.exitDate) ev.push({ date: etDay(e.exitDate), kind: 'trade', text: 'Top Picks closed the ' + side + ': ' + String(e.status || e.outcome || 'closed').replace(/-/g, ' ') + (e.optionPnlPct != null ? ' (' + pctRaw(e.optionPnlPct, 0) + ')' : ''), tone: (e.optionPnlPct || 0) >= 0 ? 'up' : 'down', owner: true });
          });
        }
        ev = ev.filter(function(x){ return x.date && x.date >= first; }).sort(function(a, b){ return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
        var on = state.storyKinds || {};
        var C = CHART_KIT.colors();
        var COLORS = { earnings: C.accent, flow: '#3b82f6', insider: '#14b8a6', fund: '#a855f7', grade: '#f97316', trade: '#ec4899' };
        var markers = ev.filter(function(x){ return on[x.kind] !== false; }).map(function(x){
          var meta = STORY_KINDS[x.kind];
          if (x.kind === 'move') return { time: x.date, text: '', color: x.tone === 'up' ? C.up : C.down, shape: x.tone === 'up' ? 'arrowUp' : 'arrowDown', position: x.tone === 'up' ? 'belowBar' : 'aboveBar' };
          return { time: x.date, text: meta.mark, color: x.kind === 'insider' ? (x.tone === 'up' ? C.up : C.down) : COLORS[x.kind], shape: x.kind === 'trade' ? 'square' : 'circle', position: x.kind === 'earnings' || x.kind === 'grade' ? 'aboveBar' : 'belowBar' };
        });
        var row = (oi.tickers || []).filter(function(r){ return r && r.symbol === sym; })[0];
        var bands = [];
        if (row && row.callWall && row.callWall.strike) bands.push({ value: Number(row.callWall.strike), title: 'Call wall', color: C.up });
        if (row && row.putWall && row.putWall.strike) bands.push({ value: Number(row.putWall.strike), title: 'Put wall', color: C.down });
        var data = times.map(function(t, k){ return { time: t, value: ps.c[k] }; });
        state.afterTab = function(){
          var el = document.getElementById('stp-story-chart');
          if (!el) return;
          state.tabCharts.push(CHART_KIT.mount(el, { height: 320, prefix: '$', ranges: ['3M', '6M', '1Y'], range: '1Y', series: [{ name: '', type: 'area', data: data }], markers: markers, bands: bands,
            source: 'Daily closes · markers from this site’s saved data' + (bands.length ? ' · walls from the latest options scan' : '') }));
        };
        var kindsPresent = {};
        ev.forEach(function(x){ kindsPresent[x.kind] = (kindsPresent[x.kind] || 0) + 1; });
        var chips = Object.keys(STORY_KINDS).filter(function(k){ return kindsPresent[k]; }).map(function(k){
          var meta = STORY_KINDS[k];
          return '<button type="button" class="stp-story-chip k-' + k + (on[k] === false ? '' : ' is-on') + '" data-story-kind="' + k + '" aria-pressed="' + (on[k] === false ? 'false' : 'true') + '">' + (meta.mark ? '<i>' + meta.mark + '</i>' : '<i>▲▼</i>') + escapeHtml(meta.label) + ' <b>' + kindsPresent[k] + '</b>' + (meta.owner ? ' <small>Owner</small>' : '') + '</button>';
        }).join('');
        var list = ev.filter(function(x){ return on[x.kind] !== false; }).slice(0, 80).map(function(x){
          return '<li class="stp-story-item k-' + x.kind + (x.tone ? ' is-' + x.tone : '') + (x.owner ? ' is-owner' : '') + '"><span class="stp-story-date">' + escapeHtml(dateLabel(x.date)) + '</span><span>' + escapeHtml(x.text) + '</span></li>';
        }).join('');
        return '<section class="stp-sec"><div class="stp-story-chips" role="group" aria-label="Show on the chart">' + chips + '</div><div id="stp-story-chart"></div>' +
          (list ? '<ol class="stp-story-list">' + list + '</ol>' : '<p class="stp-empty">Nothing notable saved for this stock in the last year.</p>') +
          '<p class="stp-src">Big moves are days at least three times the stock’s typical daily move (and at least 3%). Unusual options cover the last seven days the scanner keeps. ' + (owner ? 'Grade and Top Picks markers are Owner-only.' : '') + '</p></section>';
      });
    }
    function tabOwner(){
      if (!HAS_OWNER_ACCESS) return '';
      var sym = state.sym;
      if (!cache.accP) cache.accP = getJson('picks-accuracy.json').catch(function(){ return null; });
      return cache.accP.then(function(res){
        var acc = res || {};
        // Trade journal: the Owner's note on this ticker, then each trade's note.
        var html = typeof accNoteBoxHtml === 'function' ? '<section class="stp-sec"><h3 class="stp-h3">Your notes</h3>' + accNoteBoxHtml('ticker', sym) + '</section>' : '';
        var trades = (acc.open || []).map(function(r){ return { r: r, open: true }; }).concat((acc.closed || []).map(function(r){ return { r: r, open: false }; }))
          .filter(function(x){ return x.r && x.r.symbol === sym; })
          .sort(function(a, b){ return String(b.r.entryDate || '').localeCompare(String(a.r.entryDate || '')); }).slice(0, 12);
        if (trades.length){
          html += '<section class="stp-sec"><h3 class="stp-h3">Top Picks trades in ' + escapeHtml(sym) + '</h3><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Opened</th><th scope="col">Side</th><th scope="col">Status</th><th scope="col" class="num">Option P&amp;L</th><th scope="col">Trade note</th></tr></thead><tbody>' +
            trades.map(function(x){
              var r = x.r;
              var pnl = r.optionPnlPct != null ? r.optionPnlPct : r.realizedPct;
              var tid = typeof accNoteTradeId === 'function' ? accNoteTradeId(r) : null;
              return '<tr><td>' + escapeHtml(dateLabel(r.entryDate)) + '</td><td>' + escapeHtml(r.side === 'put' ? 'Put' : 'Call') + '</td><td>' + escapeHtml(x.open ? 'Open' : String(r.status || 'Closed').replace(/-/g, ' ')) + '</td><td class="num">' + chg(pnl, 1) + '</td><td class="stp-note-cell">' + (tid ? accNoteBoxHtml('trade', tid) : '') + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="stp-src"><a href="?tab=track" data-go-tab="track">Open Track record</a></p></section>';
        }
        if (!trades.length) html += '<p class="stp-empty">No Top Picks trades in ' + escapeHtml(sym) + ' yet. The Grade tab shows its current grade.</p>';
        return html;
      });
    }
    // --- events ----------------------------------------------------------------
    document.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-stock-sym], [data-stock-tab], [data-stock-kind], [data-stock-watch], [data-go-tab], [data-stock-cone], [data-story-kind], [data-stock-grid-metric], [data-stock-grid-side], a[href^="?tab=stock&s="]') : null;
      if (!t) return;
      if (t.hasAttribute('data-story-kind')){
        var kk = t.getAttribute('data-story-kind');
        state.storyKinds = state.storyKinds || {};
        state.storyKinds[kk] = state.storyKinds[kk] === false;
        paintTab();
        return;
      }
      if (t.hasAttribute('data-stock-cone')){
        state.cone = !state.cone;
        try { localStorage.setItem('stonks-stock-cone-v1', state.cone ? '1' : '0'); } catch (_) {}
        t.setAttribute('aria-pressed', state.cone ? 'true' : 'false');
        drawChart();
        return;
      }
      if (t.hasAttribute('data-stock-grid-metric') || t.hasAttribute('data-stock-grid-side')){
        if (t.hasAttribute('data-stock-grid-metric')) state.grid.metric = t.getAttribute('data-stock-grid-metric');
        else state.grid.side = t.getAttribute('data-stock-grid-side');
        var gridEl = document.getElementById('stp-grid');
        if (gridEl) gridEl.innerHTML = chainGridHtml(state.data || {});
        return;
      }
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
        showTab(t.getAttribute('data-stock-tab'));
        document.querySelectorAll('#stock-root .stp-tab').forEach(function(b){
          var on = b.getAttribute('data-stock-tab') === state.tab;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        setUrl(state.sym, true);
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
      if (!pane || pane.hidden) return;
      var s = urlSym();
      var wantGrade = urlView() === 'grade' && HAS_OWNER_ACCESS;
      if (s !== state.sym){ state.sym = s; if (!wantGrade && state.tab === 'grade') state.tab = 'overview'; load(); }
      else if (wantGrade !== (state.tab === 'grade')){ state.tab = wantGrade ? 'grade' : 'overview'; load(); }
    });
    return { open: open, load: load, showTab: showTab, follow: follow, names: names, nameOf: nameOf, watchlist: readWatch, watchNoteHtml: watchNoteHtml, icsToken: function(){ return HAS_OWNER_ACCESS ? watchSync.icsToken : null; }, href: function(sym){ return '?tab=stock&s=' + encodeURIComponent(String(sym || '').toUpperCase()); } };
  })();
`;
}

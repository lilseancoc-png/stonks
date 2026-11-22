// Browser code for the "Prediction markets" page (2026-11-15, lib/prediction/).
// Pasted into the app.js IIFE after crowd-client.mjs, so it may use the vn*
// helpers, VIEWS, rowSparkHtml and dataUrl. ES5 only, inside a template
// string: write regex escapes as \\d, no backticks, no straight apostrophes
// inside single-quoted strings (use a curly one).
//
// Public tabs read prediction-odds.json: the traded odds by topic, the big
// moves, the market's guess for data releases and the odds linked to each
// covered stock. The Owner tabs (tests, run-up watch, open-trade alerts,
// finder) read prediction-odds-owner.json, requested only when
// HAS_OWNER_ACCESS is true. Facts only; no recommendation.
//
// Also exported to the rest of app.js: predictionStockStripHtml(pub, sym) for
// the stock page and predictionCalLine(pub, event) for Calendar report rows.
export function renderPredictionJs() {
  return `
  // ---- Prediction markets ----------------------------------------------------
  var PMK_TABS = [['themes', 'By topic'], ['moves', 'Big moves'], ['releases', 'Data releases'], ['stocks', 'By stock']];
  var PMK_OWNER_TABS = [['tests', 'Odds tests'], ['runup', 'Run-up watch'], ['alerts', 'Open trades'], ['finder', 'Finder']];
  var pmkState = { data: null, owner: null, loading: false, ownerLoading: false, error: null, fetchedAt: 0, urlRead: false };
  // The page router drops ?view= for every page but the stock page before the
  // data arrives, so the stock page's "All linked markets" link (view=stocks)
  // is read from the address at load.
  var PMK_BOOT_QS = (function(){ try { return location.search || ''; } catch (_) { return ''; } })();
  var PMK_JUMP_LABEL = { holds: 'Stock follows jumps', echo: 'Odds follow the stock', 'no-effect': 'No effect', collecting: 'Collecting' };
  var PMK_FLOW_LABEL = { 'odds-lead': 'Odds move first', 'odds-echo': 'Stock moves first', 'same-day': 'Same day only', 'no-order': 'No order', collecting: 'Collecting' };
  var PMK_RUN_LABEL = { 'run-up-follows': 'Run-up follows', 'moves-together': 'Move together', 'no-effect': 'No effect', collecting: 'Collecting' };
  function pmkView(key, dflt){ return VIEWS.get('prediction.' + key, dflt); }
  function pmkSetView(key, v){ VIEWS.set('prediction.' + key, v); }
  function pmkNum(v, d){ return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 0 : d); }
  function pmkPts(v){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    var n = Number(v);
    return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '</span>';
  }
  function pmkChance(p){
    if (p == null || !isFinite(p)) return '<span class="vt-na">—</span>';
    var w = Math.max(0, Math.min(100, Number(p)));
    return '<span class="pmk-chance"><span class="pmk-bar" aria-hidden="true"><i style="width:' + w.toFixed(0) + '%"></i></span><b>' + Number(p).toFixed(0) + '%</b></span>';
  }
  function pmkVol(c){
    var v = c.volume;
    if (v == null || !isFinite(v)) return '—';
    var poly = pmkVenueOf(c) === 'polymarket';
    var a = Math.abs(v);
    var s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a));
    return (poly ? '$' : '') + s + (poly ? '' : ' <small class="crd-dim">contracts</small>');
  }
  function pmkVenueOf(c){ return c.venue || (/^P:/.test(String(c.id || '')) ? 'polymarket' : 'kalshi'); }
  function pmkVenue(v){ return '<span class="pmk-venue pmk-venue-' + escapeHtml(v || '') + '">' + (v === 'polymarket' ? 'Polymarket' : 'Kalshi') + '</span>'; }
  function pmkSafeUrl(u){ return u && /^https:\\/\\/(kalshi\\.com|polymarket\\.com)\\//.test(u) ? u : null; }
  function pmkTitle(c){
    var t = String(c.title || c.question || c.id || '');
    var url = pmkSafeUrl(c.url);
    var text = escapeHtml(t);
    var inner = url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>' : text;
    return '<span class="pmk-title">' + inner + '</span> ' + pmkVenue(pmkVenueOf(c)) + (c.thin ? ' <span class="pmk-thin" title="Little trading: one order can move this price">thin</span>' : '') +
      (c.pair ? ' <span class="pmk-pair" title="The same question also trades on the other venue">both venues</span>' : '');
  }
  function pmkSign(g){ return g > 0 ? '+' : g < 0 ? '−' : '?'; }
  function pmkSignTitle(g){ return g > 0 ? 'Set in advance: YES helps this stock' : g < 0 ? 'Set in advance: YES hurts this stock' : 'Direction not set; the tests learn it from the data'; }
  function pmkLinks(links, rules, max){
    var list = (links || []).slice(0, max || 6);
    if (!list.length) return '<span class="vt-na">—</span>';
    return '<span class="pmk-links">' + list.map(function(l){
      var s = l.s || l.sym, g = l.g != null ? l.g : l.sign, r = l.r || l.rule;
      return '<a class="pmk-link pmk-link-' + (g > 0 ? 'up' : g < 0 ? 'down' : 'unk') + '" href="' + escapeHtml(vnHref(s)) + '" title="' + escapeHtml(pmkSignTitle(g) + (rules && rules[r] ? ' · ' + rules[r] : '')) + '"><b>' + pmkSign(g) + '</b>' + escapeHtml(s) + '</a>';
    }).join('') + ((links || []).length > list.length ? '<small class="crd-dim">+' + ((links || []).length - list.length) + '</small>' : '') + '</span>';
  }
  function pmkSpark(c, todayEt){
    var vals = c.spark || [];
    if (!vals.length) return '';
    var base = Date.parse(String(todayEt || '').slice(0, 10) + 'T12:00:00Z');
    var pts = vals.map(function(v, i){
      var label = isFinite(base) ? new Date(base - (vals.length - 1 - i) * 86400000).toISOString().slice(0, 10) : String(i);
      return [label, v];
    });
    return rowSparkHtml(pts, function(v){ return Number(v).toFixed(0) + '%'; }, (c.title || '') + ', last 30 days');
  }
  function pmkDaysLeft(c){
    if (c.daysLeft == null) return '<span class="vt-na">—</span>';
    return c.daysLeft <= 0 ? 'today' : c.daysLeft === 1 ? '1 day' : c.daysLeft + ' days';
  }
  function pmkAllContracts(d){
    var out = [];
    (d.themes || []).forEach(function(t){ (t.contracts || []).forEach(function(c){ out.push(c); }); });
    return out;
  }
  function pmkById(d){
    if (d.__byId) return d.__byId;
    var m = {};
    pmkAllContracts(d).forEach(function(c){ m[c.id] = c; });
    (d.resolved || []).forEach(function(c){ if (!m[c.id]) m[c.id] = c; });
    d.__byId = m;
    return m;
  }
  function pmkEmpty(text){ return '<p class="crd-empty">' + escapeHtml(text) + '</p>'; }
  function pmkContractCols(d, opts){
    opts = opts || {};
    var cols = [
      { label: 'Market', cell: function(c){ return pmkTitle(c); }, sort: function(c){ return c.title; } },
      { label: 'Chance', num: true, title: 'The YES price, read as the chance the market puts on it', cell: function(c){ return pmkChance(c.p); }, sort: function(c){ return c.p; } },
      { label: '1 day', num: true, title: 'Change in points since about this time yesterday', cell: function(c){ return pmkPts(c.ch1); }, sort: function(c){ return c.ch1; } },
      { label: '7 days', num: true, title: 'Change in points against the close a week ago', cell: function(c){ return pmkPts(c.ch7); }, sort: function(c){ return c.ch7; } },
      { label: '30 days', num: true, cell: function(c){ return pmkPts(c.ch30); }, sort: function(c){ return c.ch30; } },
      { label: 'Last 30 days', nosort: true, cell: function(c){ return pmkSpark(c, d.etDate); } },
      { label: 'Resolves in', num: true, cell: function(c){ return pmkDaysLeft(c); }, sort: function(c){ return c.daysLeft; } },
      { label: 'Traded', num: true, title: 'Total traded: dollars on Polymarket, contracts on Kalshi', cell: function(c){ return pmkVol(c); }, sort: function(c){ return c.volume; } },
    ];
    if (opts.links !== false) cols.push({ label: 'Stocks it could move', nosort: true, cell: function(c){ return pmkLinks(c.links, d.rules); } });
    return cols;
  }

  // ---- By topic ----
  function pmkThemesHtml(d){
    var themes = (d.themes || []).filter(function(t){ return (t.contracts || []).length; });
    if (!themes.length) return pmkEmpty('No contracts tracked yet. The first daily build after this deploys reads both venues.');
    var cur = pmkView('theme', 'all');
    if (cur !== 'all' && !themes.some(function(t){ return t.id === cur; })) cur = 'all';
    var total = themes.reduce(function(a, t){ return a + t.contracts.length; }, 0);
    var chips = '<div class="pmk-chips" role="group" aria-label="Topic">' + [['all', 'All', total]].concat(themes.map(function(t){ return [t.id, t.label, t.contracts.length]; })).map(function(x){
      return '<button type="button" class="pmk-chip' + (x[0] === cur ? ' is-on' : '') + '" data-pmk-theme="' + escapeHtml(x[0]) + '" aria-pressed="' + (x[0] === cur ? 'true' : 'false') + '">' + escapeHtml(x[1]) + ' <small>' + x[2] + '</small></button>';
    }).join('') + '</div>';
    var show = cur === 'all' ? themes : themes.filter(function(t){ return t.id === cur; });
    return chips + show.map(function(t){
      return '<section class="pmk-theme"><div class="crd-head"><h3>' + escapeHtml(t.label) + '</h3><span class="crd-dim">' + t.contracts.length + ' tracked</span></div>' +
        (t.blurb ? '<p class="crd-lede">' + escapeHtml(t.blurb) + '</p>' : '') +
        VIEWS.tableHtml(pmkContractCols(d), t.contracts, { key: 'pmk-theme-' + t.id, cls: 'pmk-ct', empty: 'Nothing tracked in this topic.' }) + '</section>';
    }).join('');
  }

  // ---- Big moves ----
  function pmkMovesHtml(d){
    var byId = pmkById(d);
    var jumps = d.jumps || [];
    var own = pmkState.owner && pmkState.owner.jumps ? pmkState.owner.jumps : null;
    var ownKey = {};
    (own || []).forEach(function(j){ ownKey[j.id + '|' + j.date] = j; });
    var h = '<div class="crd-head"><h3>Odds that jumped 10 points or more in a day</h3><span class="crd-dim">last 14 days</span></div>' +
      '<p class="crd-lede">Each row is a move between two daily closes (16:00 ET). A jump is when traders changed their minds fast: news, a poll, a ruling, a leak.</p>';
    if (!jumps.length) h += pmkEmpty('No 10-point jump in the last 14 days.');
    else {
      var cols = [
        { label: 'Market', cell: function(j){ var c = byId[j.id] || { id: j.id, title: j.title, url: j.url }; return pmkTitle(c); }, sort: function(j){ return j.title; } },
        { label: 'Day', cell: function(j){ return escapeHtml(vnDay(j.date)); }, sort: function(j){ return j.date; } },
        { label: 'From', num: true, cell: function(j){ return pmkNum(j.from) + '%'; }, sort: function(j){ return j.from; } },
        { label: 'To', num: true, cell: function(j){ return '<b>' + pmkNum(j.to) + '%</b>'; }, sort: function(j){ return j.to; } },
        { label: 'Move', num: true, cell: function(j){ return pmkPts(j.change); }, sort: function(j){ return j.change; } },
        { label: 'Stocks it could move', nosort: true, cell: function(j){ var c = byId[j.id]; return c ? pmkLinks(c.links, d.rules) : (j.links || []).map(function(s){ return vnSym(s); }).join(' '); } },
      ];
      if (own) cols.push({ label: 'How they moved (Owner)', nosort: true, title: 'Each linked stock against SPY: the jump day and the next day, %. ETFs use their own return.', cell: function(j){
        var o = ownKey[j.id + '|' + j.date];
        if (!o || !(o.stocks || []).length) return '<span class="vt-na">—</span>';
        return '<span class="pmk-react">' + o.stocks.slice(0, 4).map(function(s){ return '<span><b>' + escapeHtml(s.sym) + '</b> ' + vnChg(s.same, 1) + ' <small class="crd-dim">next ' + (s.next1 == null ? '—' : (s.next1 > 0 ? '+' : '') + Number(s.next1).toFixed(1) + '%') + '</small></span>'; }).join('') + '</span>';
      } });
      h += VIEWS.tableHtml(cols, jumps, { key: 'pmk-jumps', cls: 'pmk-ct', empty: '' });
    }
    var res = d.resolved || [];
    h += '<div class="crd-head"><h3>Settled in the last 30 days</h3></div>';
    if (!res.length) h += pmkEmpty('No tracked contract settled in the last 30 days.');
    else h += VIEWS.tableHtml([
      { label: 'Market', cell: function(c){ return pmkTitle(c); }, sort: function(c){ return c.title; } },
      { label: 'Result', cell: function(c){ return '<span class="pmk-res pmk-res-' + escapeHtml(c.result || '') + '">' + escapeHtml(String(c.result || '').toUpperCase()) + '</span>'; }, sort: function(c){ return c.result; } },
      { label: 'Last chance before', num: true, title: 'The last price before the result was known', cell: function(c){ return c.before == null ? '<span class="vt-na">—</span>' : pmkNum(c.before) + '%'; }, sort: function(c){ return c.before; } },
      { label: 'Settled', cell: function(c){ return c.resolvedAt ? escapeHtml(vnDay(c.resolvedAt)) : '—'; }, sort: function(c){ return c.resolvedAt; } },
      { label: 'Stocks it could move', nosort: true, cell: function(c){ return pmkLinks(c.links, d.rules); } },
    ], res, { key: 'pmk-resolved', cls: 'pmk-ct', empty: '' });
    return h;
  }

  // ---- Data releases ----
  function pmkFmtVal(v, unit, digits){
    if (v == null || !isFinite(v)) return '—';
    var d = digits == null ? 2 : digits;
    return Number(v).toFixed(d) + (unit === '%' ? '%' : unit === 'k' ? 'K' : '');
  }
  function pmkReleasesHtml(d){
    var cs = d.consensus || {};
    var up = cs.upcoming || [], recent = cs.recent || [];
    var h = '<div class="crd-head"><h3>What traders expect from the next releases</h3></div>' +
      '<p class="crd-lede">Kalshi lists a ladder of yes/no contracts for each release (above 0.2%, above 0.3% and so on). The level where the ladder crosses 50% is the market’s middle guess; the 10% and 90% crossings bound an 80% range.</p>';
    if (!up.length) h += pmkEmpty('No open release ladder right now.');
    else h += VIEWS.tableHtml([
      { label: 'Release', cell: function(u){ return '<b>' + escapeHtml(u.label) + '</b>' + (u.title && u.title !== u.label ? '<div class="crd-dim">' + escapeHtml(u.title) + '</div>' : ''); }, sort: function(u){ return u.label; } },
      { label: 'Day', cell: function(u){ return u.release ? escapeHtml(vnDay(u.release)) : '—'; }, sort: function(u){ return u.release; } },
      { label: 'Market’s guess', num: true, cell: function(u){
        if (u.series === 'KXFEDDECISION') return 'cut ' + pmkNum(u.cut == null ? null : u.cut * 100) + '% · hike ' + pmkNum(u.hike == null ? null : u.hike * 100) + '%';
        return '<b>' + pmkFmtVal(u.expected, u.unit, u.digits) + '</b>';
      }, sort: function(u){ return u.expected; } },
      { label: '80% range', num: true, cell: function(u){ return u.lo != null && u.hi != null ? pmkFmtVal(u.lo, u.unit, u.digits) + ' to ' + pmkFmtVal(u.hi, u.unit, u.digits) : '<span class="vt-na">—</span>'; }, sort: function(u){ return u.hi != null && u.lo != null ? u.hi - u.lo : null; } },
      { label: 'Market', nosort: true, cell: function(u){ var url = pmkSafeUrl(u.url); return url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">Kalshi</a>' : ''; } },
    ], up, { key: 'pmk-upcoming', empty: '' });
    h += '<div class="crd-head"><h3>Past releases: the guess, the result and the market that day</h3></div>' +
      '<p class="crd-lede">The surprise is the result minus the market’s last guess at least 30 minutes before the release, scaled by how far that series usually misses. Moves are the release day’s close against the day before.</p>';
    if (!recent.length) h += pmkEmpty('No settled release with a guess yet. Older ones fill in from Kalshi’s price history over the first builds.');
    else h += VIEWS.tableHtml([
      { label: 'Release', cell: function(x){ return '<b>' + escapeHtml(x.label) + '</b>'; }, sort: function(x){ return x.label; } },
      { label: 'Day', cell: function(x){ return escapeHtml(vnDay(x.release)); }, sort: function(x){ return x.release; } },
      { label: 'Guess', num: true, cell: function(x){ return pmkFmtVal(x.expected, x.unit, x.digits); }, sort: function(x){ return x.expected; } },
      { label: 'Result', num: true, cell: function(x){ return '<b>' + pmkFmtVal(x.actual, x.unit, x.digits) + '</b>'; }, sort: function(x){ return x.actual; } },
      { label: 'Surprise', num: true, title: 'Result minus guess, in standard misses for that series', cell: function(x){ return x.z == null ? pmkFmtVal(x.surprise, x.unit, x.digits) : (x.z > 0 ? '+' : '') + Number(x.z).toFixed(1) + 'σ'; }, sort: function(x){ return x.z; } },
      { label: 'SPY', num: true, cell: function(x){ return vnChg(x.moves && x.moves.SPY, 2); }, sort: function(x){ return x.moves && x.moves.SPY; } },
      { label: 'QQQ', num: true, cell: function(x){ return vnChg(x.moves && x.moves.QQQ, 2); }, sort: function(x){ return x.moves && x.moves.QQQ; } },
      { label: 'TLT', num: true, title: 'Long Treasury bond fund', cell: function(x){ return vnChg(x.moves && x.moves.TLT, 2); }, sort: function(x){ return x.moves && x.moves.TLT; } },
      { label: 'Guess from', cell: function(x){ return '<span class="crd-dim">' + (x.source === 'tracked' ? 'tracked live' : 'price history') + '</span>'; }, sort: function(x){ return x.source; } },
    ], recent, { key: 'pmk-recent', empty: '' });
    return h;
  }

  // ---- By stock ----
  function pmkStockRows(d, sym){
    var byId = pmkById(d);
    return ((d.bySymbol || {})[sym] || []).map(function(x){
      var c = byId[x.id];
      return c ? { c: c, sign: x.sign, rule: x.rule } : null;
    }).filter(Boolean);
  }
  function pmkStocksHtml(d){
    var syms = Object.keys(d.bySymbol || {}).sort(function(a, b){ return (d.bySymbol[b] || []).length - (d.bySymbol[a] || []).length || (a < b ? -1 : 1); });
    if (!syms.length) return pmkEmpty('No tracked contract links to a covered stock yet.');
    var cur = pmkView('sym', syms[0]);
    if (syms.indexOf(cur) < 0) cur = syms[0];
    var chips = '<div class="pmk-chips" role="group" aria-label="Stock">' + syms.map(function(s){
      return '<button type="button" class="pmk-chip' + (s === cur ? ' is-on' : '') + '" data-pmk-sym="' + escapeHtml(s) + '" aria-pressed="' + (s === cur ? 'true' : 'false') + '">' + escapeHtml(s) + ' <small>' + d.bySymbol[s].length + '</small></button>';
    }).join('') + '</div>';
    var rows = pmkStockRows(d, cur);
    var cols = [
      { label: 'Market', cell: function(r){ return pmkTitle(r.c); }, sort: function(r){ return r.c.title; } },
      { label: 'If YES', cell: function(r){ return '<span class="pmk-dir pmk-dir-' + (r.sign > 0 ? 'up' : r.sign < 0 ? 'down' : 'unk') + '" title="' + escapeHtml(pmkSignTitle(r.sign)) + '">' + (r.sign > 0 ? 'helps' : r.sign < 0 ? 'hurts' : 'not set') + '</span> <small class="crd-dim">' + escapeHtml((d.rules || {})[r.rule] || r.rule || '') + '</small>'; }, sort: function(r){ return r.sign; } },
      { label: 'Chance', num: true, cell: function(r){ return pmkChance(r.c.p); }, sort: function(r){ return r.c.p; } },
      { label: '7 days', num: true, cell: function(r){ return pmkPts(r.c.ch7); }, sort: function(r){ return r.c.ch7; } },
      { label: 'Last 30 days', nosort: true, cell: function(r){ return pmkSpark(r.c, d.etDate); } },
      { label: 'Resolves in', num: true, cell: function(r){ return pmkDaysLeft(r.c); }, sort: function(r){ return r.c.daysLeft; } },
    ];
    return chips + '<div class="crd-head"><h3>' + vnSym(cur) + ' · odds that could move it</h3></div>' +
      '<p class="crd-lede">A + or − link was set in advance from what the event means for the business (a tariff on its goods, a rate cut, a ceasefire). A “not set” link names the company or a broad event; its direction has to show in the data first.</p>' +
      VIEWS.tableHtml(cols, rows, { key: 'pmk-sym', cls: 'pmk-ct', empty: 'No linked contract.' });
  }

  // ---- Owner tabs ----
  function pmkOwnerWait(){
    if (!HAS_OWNER_ACCESS) return pmkEmpty('Owner only.');
    return pmkEmpty(pmkState.ownerLoading ? 'Loading the Owner tests…' : 'The Owner file is not written yet. The next full build writes it.');
  }
  function pmkVerdict(map, v){ return '<span class="pmk-verdict pmk-v-' + escapeHtml(v || 'collecting') + '">' + escapeHtml(map[v] || v || 'Collecting') + '</span>'; }
  function pmkTestsHtml(d){
    var o = pmkState.owner;
    if (!o) return pmkOwnerWait();
    var fams = o.families || [];
    var counts = o.verdictCounts || {};
    var held = (counts['jumps:holds'] || 0) + (counts['flow:odds-lead'] || 0) + (counts['runup:run-up-follows'] || 0);
    var h = '<div class="crd-head"><h3>Do the odds move stocks?</h3><span class="crd-dim">' + fams.length + ' stock and link pairs</span></div>' +
      '<p class="crd-lede">' + escapeHtml(o.rules && o.rules.note || '') + '</p>' +
      '<p class="crd-fact">' + held + ' pair' + (held === 1 ? '' : 's') + ' pass a test so far. A pair needs ' + (o.rules ? o.rules.minEvents : 30) + ' jumps (or 60 trading days) before it is judged. Nothing here feeds a grade, a pick or a gate.</p>';
    h += VIEWS.tableHtml([
      { label: 'Stock', cell: function(f){ return vnSym(f.sym); }, sort: function(f){ return f.sym; } },
      { label: 'Link', cell: function(f){ return escapeHtml((d.rules || {})[f.rule] || f.rule); }, sort: function(f){ return f.rule; } },
      { label: 'Direction', cell: function(f){ return '<b>' + pmkSign(f.sign) + '</b>' + (f.learned ? ' <small class="crd-dim">' + (f.sign ? 'learned' : 'unknown') + '</small>' : ' <small class="crd-dim">set</small>'); }, sort: function(f){ return f.sign; } },
      { label: 'Jumps', num: true, title: 'All jumps, then the test-half count', cell: function(f){ return f.jumps.n + ' <small class="crd-dim">' + f.jumps.nTest + ' test</small>'; }, sort: function(f){ return f.jumps.n; } },
      { label: 'Jump day', num: true, title: 'Mean stock move on the jump day, turned to the link direction (test half), %', cell: function(f){ return vnChg(f.jumps.same && f.jumps.same.mean, 2); }, sort: function(f){ return f.jumps.same && f.jumps.same.mean; } },
      { label: 'Next day', num: true, cell: function(f){ return vnChg(f.jumps.next1 && f.jumps.next1.mean, 2); }, sort: function(f){ return f.jumps.next1 && f.jumps.next1.mean; } },
      { label: 'q', num: true, title: 'Benjamini-Hochberg adjusted p for the jump test', cell: function(f){ return f.jumps.q == null ? '—' : Number(f.jumps.q).toFixed(2); }, sort: function(f){ return f.jumps.q; } },
      { label: 'Jumps test', cell: function(f){ return pmkVerdict(PMK_JUMP_LABEL, f.jumps.verdict); }, sort: function(f){ return f.jumps.verdict; } },
      { label: 'Day by day', title: 'Do odds changes lead the stock, follow it, or only move the same day?', cell: function(f){ return pmkVerdict(PMK_FLOW_LABEL, f.flow.verdict); }, sort: function(f){ return f.flow.verdict; } },
      { label: 'Run-up', title: 'Does a 5-day odds move come before a 5-day stock move the same way?', cell: function(f){ return pmkVerdict(PMK_RUN_LABEL, f.runup.verdict); }, sort: function(f){ return f.runup.verdict; } },
    ], fams, { key: 'pmk-fams', empty: 'No pair has enough history yet.' });
    var ct = o.consensus && o.consensus.tests || [];
    h += '<div class="crd-head"><h3>Release surprises vs the market</h3></div>' +
      '<p class="crd-lede">A hotter-than-guessed print (or fewer cuts than priced) is a hawkish surprise. TLT is expected to fall on one; for stocks the direction is learned on the first two thirds of releases and tested on the rest.</p>' +
      VIEWS.tableHtml([
        { label: 'Releases', cell: function(t){ return t.group === 'fed' ? 'Fed decisions' : 'Economic data'; }, sort: function(t){ return t.group; } },
        { label: 'Asset', cell: function(t){ return vnSym(t.sym); }, sort: function(t){ return t.sym; } },
        { label: 'Releases read', num: true, cell: function(t){ return t.n + ' <small class="crd-dim">' + t.nTest + ' test</small>'; }, sort: function(t){ return t.n; } },
        { label: 'Move per surprise', num: true, title: 'Release-day move per one standard hawkish surprise, %', cell: function(t){ return t.slope == null ? '—' : vnChg(t.slope, 2); }, sort: function(t){ return t.slope; } },
        { label: 'Test-half r', num: true, cell: function(t){ return t.rTest == null ? '—' : Number(t.rTest).toFixed(2); }, sort: function(t){ return t.rTest; } },
        { label: 'q', num: true, cell: function(t){ return t.q == null ? '—' : Number(t.q).toFixed(2); }, sort: function(t){ return t.q; } },
        { label: 'Verdict', cell: function(t){ return pmkVerdict({ holds: 'Holds', 'no-effect': 'No effect', collecting: 'Collecting' }, t.verdict); }, sort: function(t){ return t.verdict; } },
      ], ct, { key: 'pmk-ctests', empty: 'No release test yet.' });
    return h;
  }
  function pmkRunupHtml(d){
    var o = pmkState.owner;
    if (!o) return pmkOwnerWait();
    var rows = o.runUp || [];
    return '<div class="crd-head"><h3>Odds moving into a result</h3><span class="crd-dim">resolves within 90 days</span></div>' +
      '<p class="crd-lede">Open contracts that moved 8+ points in a week, or lean 65/35 or more with a month or less left, beside each linked stock’s last 10 trading days against SPY. “With” means the stock has moved the way the odds point. Watch only: the run-up test above says whether this pattern has held.</p>' +
      VIEWS.tableHtml([
        { label: 'Market', cell: function(r){ return pmkTitle(r); }, sort: function(r){ return r.title; } },
        { label: 'Stock', cell: function(r){ return vnSym(r.sym); }, sort: function(r){ return r.sym; } },
        { label: 'If YES', cell: function(r){ return '<b>' + pmkSign(r.sign) + '</b>' + (r.pending ? ' <small class="crd-dim">not proven yet</small>' : r.learned ? ' <small class="crd-dim">learned, tested</small>' : ''); }, sort: function(r){ return r.sign; } },
        { label: 'Chance', num: true, cell: function(r){ return pmkChance(r.p); }, sort: function(r){ return r.p; } },
        { label: '7 days', num: true, cell: function(r){ return pmkPts(r.ch7); }, sort: function(r){ return r.ch7; } },
        { label: 'Resolves in', num: true, cell: function(r){ return pmkDaysLeft(r); }, sort: function(r){ return r.daysLeft; } },
        { label: 'Stock, 10 days', num: true, title: 'Move against SPY over the last 10 trading days (ETFs: own move)', cell: function(r){ return vnChg(r.move10, 1); }, sort: function(r){ return r.move10; } },
        { label: 'Lined up', cell: function(r){ return r.lined ? '<span class="pmk-dir pmk-dir-' + (r.lined === 'with' ? 'up' : 'down') + '">' + escapeHtml(r.lined) + '</span>' : '<span class="vt-na">—</span>'; }, sort: function(r){ return r.lined; } },
        { label: 'Run-up test', cell: function(r){ return pmkVerdict(PMK_RUN_LABEL, r.runupVerdict); }, sort: function(r){ return r.runupVerdict; } },
      ], rows, { key: 'pmk-runup', cls: 'pmk-ct', empty: 'Nothing moving into a result right now.' });
  }
  function pmkAlertsHtml(){
    var o = pmkState.owner;
    if (!o) return pmkOwnerWait();
    var rows = o.alerts || [];
    return '<div class="crd-head"><h3>Odds moves on names with an open Top Picks trade</h3></div>' +
      '<p class="crd-lede">A linked contract that moved 5+ points in a day or 10+ in a week. “Helps” means the move points the trade’s way. Information only: nothing here closes or changes a trade.</p>' +
      VIEWS.tableHtml([
        { label: 'Trade', cell: function(a){ return vnSym(a.symbol) + ' <small class="crd-dim">' + escapeHtml(a.side || '') + '</small>' + (a.tradeId ? '<div class="crd-dim">' + escapeHtml(a.tradeId) + '</div>' : ''); }, sort: function(a){ return a.symbol; } },
        { label: 'Market', cell: function(a){ return pmkTitle(a); }, sort: function(a){ return a.title; } },
        { label: 'Chance', num: true, cell: function(a){ return pmkChance(a.p); }, sort: function(a){ return a.p; } },
        { label: '1 day', num: true, cell: function(a){ return pmkPts(a.ch1); }, sort: function(a){ return a.ch1; } },
        { label: '7 days', num: true, cell: function(a){ return pmkPts(a.ch7); }, sort: function(a){ return a.ch7; } },
        { label: 'For the trade', cell: function(a){ return '<span class="pmk-dir pmk-dir-' + (a.reads === 'helps' ? 'up' : a.reads === 'hurts' ? 'down' : 'unk') + '">' + escapeHtml(a.reads) + '</span>' + (a.pending ? ' <small class="crd-dim">direction not proven yet</small>' : a.learned ? ' <small class="crd-dim">learned, tested</small>' : ''); }, sort: function(a){ return a.reads; } },
      ], rows, { key: 'pmk-alerts', cls: 'pmk-ct', empty: 'No linked odds move on an open trade.' });
  }
  function pmkFinderHtml(){
    var o = pmkState.owner;
    if (!o) return pmkOwnerWait();
    var rows = o.candidates || [];
    var run = o.run || {};
    return '<div class="crd-head"><h3>Relevant markets left out</h3></div>' +
      '<p class="crd-lede">The best matches from the last daily search that did not make the tracked list, and why. Topic lists are capped so the reads stay inside the free request budget' + (run.calls != null ? ' (last run: ' + run.calls + ' requests)' : '') + '.</p>' +
      VIEWS.tableHtml([
        { label: 'Market', cell: function(c){ return '<span class="pmk-title">' + escapeHtml(c.title) + '</span> ' + pmkVenue(c.venue); }, sort: function(c){ return c.title; } },
        { label: 'Topic', cell: function(c){ return escapeHtml(c.theme || ''); }, sort: function(c){ return c.theme; } },
        { label: 'Chance', num: true, cell: function(c){ return pmkChance(c.p); }, sort: function(c){ return c.p; } },
        { label: 'Traded', num: true, cell: function(c){ return pmkVol(c); }, sort: function(c){ return c.volume; } },
        { label: 'Left out because', cell: function(c){ return escapeHtml(c.why || ''); }, sort: function(c){ return c.why; } },
        { label: 'Stocks', nosort: true, cell: function(c){ return (c.links || []).map(function(s){ return vnSym(s); }).join(' ') || '<span class="vt-na">—</span>'; } },
      ], rows, { key: 'pmk-finder', cls: 'pmk-ct', empty: 'Nothing relevant was left out.' });
  }

  // ---- Page ----
  function pmkStripHtml(d){
    var all = pmkAllContracts(d);
    var big = all.filter(function(c){ return c.ch7 != null && !c.thin; }).sort(function(a, b){ return Math.abs(b.ch7) - Math.abs(a.ch7); })[0];
    var g = d.gauges || {};
    var up = (d.consensus && d.consensus.upcoming || []).filter(function(u){ return u.series !== 'KXFEDDECISION' && u.expected != null; })[0];
    var k = [];
    k.push(['Contracts tracked', String((d.counts && d.counts.tracked) || 0)]);
    if (g.cutNext != null || g.hikeNext != null) {
      // Hike, hold and cut together: a cut-only gauge says nothing in a hiking cycle.
      var fedParts = [];
      var fedTop = [['Hike', g.hikeNext], ['Hold', g.holdNext], ['Cut', g.cutNext]].filter(function(x){ return x[1] != null; }).sort(function(a, b){ return b[1] - a[1]; })[0];
      // The top outcome is the headline; the sub-line lists the other two (audit, 2026-11-22).
      [['hike', g.hikeNext], ['hold', g.holdNext], ['cut', g.cutNext]].forEach(function(x){ if (x[1] != null && x[0] !== fedTop[0].toLowerCase()) fedParts.push(x[0] + ' ' + pmkNum(x[1]) + '%'); });
      k.push(['Next Fed meeting' + (g.fedMeeting ? ' (' + escapeHtml(String(g.fedMeeting)) + ')' : ''), escapeHtml(fedTop[0]) + ' ' + pmkNum(fedTop[1]) + '%<small class="pmk-kpi-sub">' + escapeHtml(fedParts.concat(g.fedVenue ? [g.fedVenue === 'kalshi' ? 'Kalshi' : 'Polymarket'] : []).join(' · ')) + '</small>']);
    }
    if (big) k.push(['Biggest move this week', (big.ch7 > 0 ? '+' : '') + Number(big.ch7).toFixed(1) + '<small class="pmk-kpi-sub">points · ' + escapeHtml(String(big.title).slice(0, 60)) + '</small>']);
    if (up) k.push(['Next release guess', pmkFmtVal(up.expected, up.unit, up.digits) + '<small class="pmk-kpi-sub">' + escapeHtml(up.label) + (up.release ? ' · ' + escapeHtml(vnDay(up.release)) : '') + '</small>']);
    if (g.jumps != null) k.push(['10-point jumps today', String(g.jumps)]);
    return '<div class="mm-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>';
  }
  function pmkSourcesHtml(d){
    var v = d.venues || {};
    var row = function(id, label){
      var x = v[id] || null;
      var pill = !x ? '<span class="crd-src crd-src-missing">not read</span>' : x.ok ? '<span class="crd-src crd-src-ok">fresh</span>' : '<span class="crd-src crd-src-carried">carried forward</span>';
      return '<li><b>' + label + '</b> ' + pill + (x && x.tracked != null ? ' <span class="crd-dim">' + x.tracked + ' tracked' + (x.asOf ? ' · last read ' + escapeHtml(vnWhen(x.asOf)) : '') + '</span>' : '') + (x && x.error ? ' <span class="crd-dim">· ' + escapeHtml(x.error) + '</span>' : '') + '</li>';
    };
    return '<details class="crd-sources"><summary>Sources and how this works</summary><ul>' + row('kalshi', 'Kalshi') + row('polymarket', 'Polymarket') + '</ul>' +
      '<p class="crd-note">' + escapeHtml(d.note || '') + '</p>' +
      '<p class="crd-note">Both venues’ public market-data APIs are free and need no account or key. Each full build refreshes the tracked prices in a few batched requests; once a day it searches both venues for new relevant markets. Prices are matched to the 16:00 ET stock close, so a test never uses odds the stock market had not seen yet. Sports, weather, entertainment and “what will they say” markets are left out.</p></details>';
  }
  function renderPrediction(){
    var root = document.getElementById('pm-root'); if (!root) return;
    var d = pmkState.data;
    if (!d){
      root.innerHTML = '<p class="crd-empty">' + (pmkState.error ? 'The prediction markets page could not load. The next full build writes it; try again later.' : 'Loading prediction market odds…') + '</p>';
      return;
    }
    if (!pmkState.urlRead){
      pmkState.urlRead = true;
      try {
        var q = new URLSearchParams(location.search), q0 = new URLSearchParams(PMK_BOOT_QS);
        var v = q.get('view') || (q0.get('tab') === 'prediction-markets' ? q0.get('view') : null), s = q.get('s');
        // Only a real tab name is remembered; an Owner tab waits for sign-in.
        if (v && PMK_TABS.concat(PMK_OWNER_TABS).some(function(t){ return t[0] === v; })) pmkSetView('tab', v);
        if (s && /^[A-Z][A-Z0-9.]{0,5}$/.test(s)) pmkSetView('sym', s);
      } catch (_) {}
    }
    var asof = document.getElementById('pm-asof');
    if (asof) asof.textContent = d.builtAt ? 'Built ' + vnWhen(d.builtAt) + (d.stale ? ' · last good read' : '') : '';
    var tabs = PMK_TABS.concat(HAS_OWNER_ACCESS ? PMK_OWNER_TABS : []);
    var tab = pmkView('tab', 'themes');
    if (!tabs.some(function(t){ return t[0] === tab; })) tab = 'themes';
    var body = tab === 'moves' ? pmkMovesHtml(d) : tab === 'releases' ? pmkReleasesHtml(d) : tab === 'stocks' ? pmkStocksHtml(d)
      : tab === 'tests' ? pmkTestsHtml(d) : tab === 'runup' ? pmkRunupHtml(d) : tab === 'alerts' ? pmkAlertsHtml(d) : tab === 'finder' ? pmkFinderHtml(d) : pmkThemesHtml(d);
    root.innerHTML = (d.stale ? '<p class="crd-err">Neither venue answered on the last build. These are the last good prices.</p>' : '') +
      pmkStripHtml(d) + vnTabsHtml(tabs, tab, 'data-pmk-tab') + '<div class="crd-body pmk-body">' + body + '</div>' + pmkSourcesHtml(d);
    vnTabsReveal(root);
  }
  function loadPredictionOwner(){
    if (!HAS_OWNER_ACCESS || pmkState.owner || pmkState.ownerLoading) return;
    pmkState.ownerLoading = true;
    vnJson('prediction-odds-owner.json', true).then(function(j){
      pmkState.ownerLoading = false;
      pmkState.owner = j && typeof j === 'object' && Array.isArray(j.families) ? j : null;
      var pane = document.getElementById('page-pane-prediction-markets');
      if (pane && !pane.hidden) renderPrediction();
    });
  }
  function predictionPublicJson(){ return vnJson('prediction-odds.json', false).then(function(j){ return j && typeof j === 'object' && Array.isArray(j.themes) ? j : null; }); }
  function loadPrediction(force){
    loadPredictionOwner();
    if (!force && pmkState.data && Date.now() - pmkState.fetchedAt < 10 * 60 * 1000){ renderPrediction(); return; }
    if (pmkState.loading) return;
    pmkState.loading = true; pmkState.error = null;
    renderPrediction();
    predictionPublicJson().then(function(j){
      pmkState.data = j;
      pmkState.error = j ? null : 'missing';
      pmkState.fetchedAt = Date.now(); pmkState.loading = false;
      renderPrediction();
    });
  }
  document.addEventListener('click', function(ev){
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-pmk-tab],[data-pmk-theme],[data-pmk-sym]') : null;
    if (!el) return;
    if (el.hasAttribute('data-pmk-tab')) pmkSetView('tab', el.getAttribute('data-pmk-tab'));
    else if (el.hasAttribute('data-pmk-theme')) pmkSetView('theme', el.getAttribute('data-pmk-theme'));
    else pmkSetView('sym', el.getAttribute('data-pmk-sym'));
    renderPrediction();
  });
  document.addEventListener('stonks-owner-ready', function(){
    var pane = document.getElementById('page-pane-prediction-markets');
    if (pane && !pane.hidden){ loadPredictionOwner(); renderPrediction(); }
  });

  // ---- Stock page strip (stock-page-js.mjs) ----
  function predictionStockStripHtml(d, sym){
    if (!d || !sym) return '';
    var rows = pmkStockRows(d, sym);
    if (!rows.length) return '';
    var list = rows.slice().sort(function(a, b){ return (b.sign !== 0) - (a.sign !== 0) || Math.abs(b.c.ch7 || 0) - Math.abs(a.c.ch7 || 0); }).slice(0, 5);
    return '<h3 class="stp-h3">What prediction markets are betting on</h3>' +
      '<ul class="pmk-strip">' + list.map(function(r){
        var c = r.c;
        return '<li><span class="pmk-strip-p">' + pmkNum(c.p) + '%</span><span class="pmk-strip-t"><span>' + pmkTitle(c) + '</span>' +
          '<small class="crd-dim">' + (c.ch7 != null ? (c.ch7 > 0 ? '+' : '') + Number(c.ch7).toFixed(1) + ' pts this week · ' : '') + (c.daysLeft != null ? 'resolves in ' + pmkDaysLeft(c) + ' · ' : '') +
          '<span class="pmk-dir pmk-dir-' + (r.sign > 0 ? 'up' : r.sign < 0 ? 'down' : 'unk') + '">' + (r.sign > 0 ? 'YES would help' : r.sign < 0 ? 'YES would hurt' : 'direction not set') + '</span></small></span></li>';
      }).join('') + '</ul>' +
      '<p class="stp-src">Traded odds on Kalshi and Polymarket, not a forecast. <a href="?tab=prediction-markets&amp;view=stocks&amp;s=' + encodeURIComponent(sym) + '">All ' + rows.length + ' linked market' + (rows.length === 1 ? '' : 's') + '</a></p>';
  }

  // ---- Calendar report rows ----
  // The market’s guess for a release (before) or guess vs result (after),
  // matched by Calendar subtype and a release day within one day.
  function predictionCalLine(d, e){
    if (!d || !e || !e.subtype || !e.date) return '';
    var cs = d.consensus || {};
    var near = function(x){ if (!x.release || x.cal !== e.subtype) return false; var a = Date.parse(x.release + 'T12:00:00Z'), b = Date.parse(String(e.date).slice(0, 10) + 'T12:00:00Z'); return isFinite(a) && isFinite(b) && Math.abs(a - b) <= 86400000; };
    var past = (cs.recent || []).filter(near)[0];
    if (past) return '<div class="pmk-cal"><span class="pmk-venue pmk-venue-kalshi">Kalshi</span> traders expected <b>' + pmkFmtVal(past.expected, past.unit, past.digits) + '</b>; result ' + pmkFmtVal(past.actual, past.unit, past.digits) + (past.z != null ? ' (' + (past.z > 0 ? '+' : '') + Number(past.z).toFixed(1) + 'σ surprise)' : '') + '</div>';
    var up = (cs.upcoming || []).filter(near)[0];
    if (up && up.expected != null) return '<div class="pmk-cal"><span class="pmk-venue pmk-venue-kalshi">Kalshi</span> traders expect <b>' + pmkFmtVal(up.expected, up.unit, up.digits) + '</b>' + (up.lo != null && up.hi != null ? ' <small class="crd-dim">80% range ' + pmkFmtVal(up.lo, up.unit, up.digits) + ' to ' + pmkFmtVal(up.hi, up.unit, up.digits) + '</small>' : '') + '</div>';
    return '';
  }
  var pmkCalData = null, pmkCalAsked = false;
  function loadPredictionForCalendar(){
    if (pmkCalAsked) return;
    pmkCalAsked = true;
    predictionPublicJson().then(function(j){
      pmkCalData = j;
      var pane = document.getElementById('page-pane-calendar');
      if (j && pane && !pane.hidden && typeof renderCalendar === 'function') renderCalendar();
    });
  }
`;
}

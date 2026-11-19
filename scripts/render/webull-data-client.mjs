// Webull data on the Owner pages (W3, 2026-11-19). Pasted into the app.js
// IIFE, so it is ES5 inside a template string: write regex escapes as \\d and
// no backticks.
//
// Three Owner-only files (lib/webull-data/): webull-breadth.json (market
// sectors, the spread of every US stock's move, 52-week highs and lows,
// movers), webull-flow.json (daily capital flow per covered stock) and the
// bake's webull-backup-check.json (what the backups filled, where sources
// disagree). Webull's terms forbid republishing, so nothing here is ever on a
// public page: every read goes through vnJson(key, true), which returns null
// without an Owner session, and a placeholder only fills for an Owner.
//
//   <div data-wb="market"></div>                 Market analysis (Owner page)
//   <div data-wb="flow" data-wb-sym="AAPL"></div> stock page, Owner tab
//
// Display only: nothing here is a vote, a gate or a grade input.
export function renderWebullDataJs() {
  // Own scope: app.js already has wb* helpers (the Real fills tab), and a
  // second function declaration with the same name would replace them.
  return `
  (function(){
  var WB = { files: {}, loading: {} };
  var WB_BUCKETS = ['\\u2264 -10%', '-10 to -5%', '-5 to -2%', '-2 to 0%', '0%', '0 to 2%', '2 to 5%', '5 to 10%', '\\u2265 10%'];
  // Short axis labels; the hover tip keeps the full range.
  var WB_BUCKETS_SHORT = ['\\u2264-10', '-10/-5', '-5/-2', '-2/0', '0', '0/2', '2/5', '5/10', '\\u226510'];
  var WB_LISTS = [['gainers', 'Top gainers'], ['losers', 'Top losers'], ['actives', 'Most active']];
  var WB_52 = [['newHigh', 'New 52-week highs'], ['nearHigh', 'Near 52-week highs'], ['newLow', 'New 52-week lows'], ['nearLow', 'Near 52-week lows']];
  function wbNum(v){ return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  function wbInt(n){ n = wbNum(n); return n == null ? '\\u2014' : Math.round(n).toLocaleString('en-US'); }
  function wbPct(v, d){ v = wbNum(v); return v == null ? '\\u2014' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%'; }
  function wbCls(v){ v = wbNum(v); return v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function wbMoney(v){
    v = wbNum(v); if (v == null) return '\\u2014';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0));
  }
  function wbVol(v){ v = wbNum(v); if (v == null) return '\\u2014'; var a = Math.abs(v); return a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a)); }
  function wbDate(d){ return d ? escapeHtml(String(d).slice(0, 10)) : '\\u2014'; }
  function wbCount(l){ return l ? wbInt(l.n) + (l.capped ? '+' : '') : '\\u2014'; }
  function wbLoad(key){
    if (Object.prototype.hasOwnProperty.call(WB.files, key)) return Promise.resolve(WB.files[key]);
    if (WB.loading[key]) return WB.loading[key];
    WB.loading[key] = vnJson(key, true).then(function(j){ WB.files[key] = j && typeof j === 'object' ? j : null; delete WB.loading[key]; return WB.files[key]; });
    return WB.loading[key];
  }
  function wbSrc(text){ return '<p class="wbd-src">' + text + ' Webull OpenAPI, about 15 minutes delayed, saved once a day after the close. Owner only (Webull\\'s terms do not allow republishing).</p>'; }

  // ---- market breadth (Market analysis) ----------------------------------
  function wbTotals(day){
    var adv = 0, dec = 0, flat = 0, n = 0;
    var s = day && day.sectors || {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)){ adv += s[k].adv || 0; dec += s[k].dec || 0; flat += s[k].flat || 0; n++; }
    return n ? { adv: adv, dec: dec, flat: flat, sectors: n, advPct: adv + dec > 0 ? adv / (adv + dec) * 100 : null } : null;
  }
  function wbHistHtml(day){
    var b = day && day.buckets;
    if (!b || !b.n) return '<p class="wbd-empty">No stock-by-stock read saved for this session yet.</p>';
    var counts = b.counts || [], max = 1;
    for (var i = 0; i < counts.length; i++) max = Math.max(max, counts[i] || 0);
    var total = Object.keys(day.sectors || {}).length, done = Object.keys(b.sectorsDone || {}).length;
    var W = 540, H = 170, P = 20, bw = (W - P * 2) / counts.length, pts = [];
    var svg = '<svg class="wbd-hist" viewBox="0 0 ' + W + ' ' + (H + 34) + '" role="img" aria-label="How many US stocks moved by how much today">';
    for (var j = 0; j < counts.length; j++){
      var c = counts[j] || 0, h = Math.round((c / max) * (H - 18)), x = P + j * bw + 4, y = H - h;
      var cls = j < 4 ? 'wbd-bar-neg' : j === 4 ? 'wbd-bar-flat' : 'wbd-bar-pos';
      svg += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + (bw - 8).toFixed(1) + '" height="' + Math.max(h, 1) + '" rx="3"></rect>';
      svg += '<text class="wbd-bar-n" x="' + (x + (bw - 8) / 2).toFixed(1) + '" y="' + (y - 4) + '" text-anchor="middle">' + wbInt(c) + '</text>';
      svg += '<text class="wbd-bar-l" x="' + (x + (bw - 8) / 2).toFixed(1) + '" y="' + (H + 16) + '" text-anchor="middle">' + escapeHtml(WB_BUCKETS_SHORT[j]) + '</text>';
      pts.push({ x: x + (bw - 8) / 2, y: y, label: WB_BUCKETS[j] + '\\n' + wbInt(c) + ' stocks (' + (b.n ? (c / b.n * 100).toFixed(1) : '0') + '%)' });
    }
    svg = svg.replace('<svg ', '<svg ' + chHoverAttr(pts) + ' ');
    var down = (counts[0] || 0) + (counts[1] || 0) + (counts[2] || 0) + (counts[3] || 0), up = (counts[5] || 0) + (counts[6] || 0) + (counts[7] || 0) + (counts[8] || 0);
    return '<div class="wbd-hist-wrap">' + svg + '</svg></div>' +
      '<p class="wbd-line"><b class="pos">' + wbInt(up) + ' up</b> \\u00b7 <b class="neg">' + wbInt(down) + ' down</b> \\u00b7 ' + wbInt(counts[4]) + ' unchanged, of ' + wbInt(b.n) + ' stocks read' +
      (done < total ? ' <span class="wbd-warn">(' + done + ' of ' + total + ' sectors read to the end, so this is a partial count)</span>' : '') + '</p>';
  }
  function wbAdvLineHtml(hist){
    var rows = (hist || []).filter(function(h){ return h && wbNum(h.advPct) != null; }).slice(-120);
    if (rows.length < 2) return '';
    var W = 540, H = 90, P = 6, pts = [], d = '';
    for (var i = 0; i < rows.length; i++){
      var x = P + i * (W - P * 2) / (rows.length - 1), y = P + (100 - rows[i].advPct) / 100 * (H - P * 2);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      pts.push({ x: x, y: y, label: rows[i].date + '\\n' + rows[i].advPct.toFixed(1) + '% of movers up' + (rows[i].newHigh != null ? '\\n' + rows[i].newHigh + (rows[i].newHighCapped ? '+' : '') + ' new highs, ' + (rows[i].newLow != null ? rows[i].newLow + (rows[i].newLowCapped ? '+' : '') : '\\u2014') + ' new lows' : '') });
    }
    var mid = P + 0.5 * (H - P * 2);
    return '<div class="wbd-sub"><h4>Share of movers that rose, by session</h4><svg class="wbd-line-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' + chHoverAttr(pts) + ' role="img" aria-label="Advancers as a share of advancers plus decliners, by session">' +
      '<line class="wbd-mid" x1="' + P + '" x2="' + (W - P) + '" y1="' + mid + '" y2="' + mid + '"></line><path class="wbd-path" d="' + d + '"></path></svg>' +
      '<p class="wbd-src">50% line marked. ' + rows.length + ' session' + (rows.length === 1 ? '' : 's') + ' logged since ' + wbDate(rows[0].date) + '.</p></div>';
  }
  function wbSectorTable(day){
    var list = [];
    var s = day && day.sectors || {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) list.push(s[k]);
    if (!list.length) return '';
    list.sort(function(a, b){ return (b.adv + b.dec) - (a.adv + a.dec); });
    var cols = [
      { label: 'Sector', cell: function(r){ return escapeHtml(r.name || r.id); }, sort: function(r){ return r.name || r.id; } },
      { label: 'Up', num: true, cell: function(r){ return '<span class="pos">' + wbInt(r.adv) + '</span>'; }, sort: function(r){ return r.adv; } },
      { label: 'Down', num: true, cell: function(r){ return '<span class="neg">' + wbInt(r.dec) + '</span>'; }, sort: function(r){ return r.dec; } },
      { label: 'Flat or untraded', num: true, cell: function(r){ return wbInt(r.flat); }, sort: function(r){ return r.flat; } },
      { label: '% of movers up', num: true, cell: function(r){ var p = r.adv + r.dec > 0 ? r.adv / (r.adv + r.dec) * 100 : null; return p == null ? '' : vtBarHtml(p / 100) + ' ' + p.toFixed(0) + '%'; }, sort: function(r){ return r.adv + r.dec > 0 ? r.adv / (r.adv + r.dec) : null; } },
      { label: 'Sector move', num: true, cell: function(r){ return '<span class="' + wbCls(r.chg) + '">' + wbPct(r.chg, 2) + '</span>'; }, sort: function(r){ return wbNum(r.chg); } }
    ];
    return '<details class="wbd-sub"><summary>Every Webull sector (' + list.length + ')</summary>' + VIEWS.tableHtml(cols, list, { key: 'wbd-sectors', cls: 'wbd-table' }) + '</details>';
  }
  function wbListTable(l, key, opt){
    var rows = l && Array.isArray(l.rows) ? l.rows.slice(0, opt && opt.top || 15) : [];
    if (!rows.length) return '<p class="wbd-empty">Not saved for this session.</p>';
    var cols = [
      { label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b>' + (r.n ? ' <small class="wbd-dim">' + escapeHtml(r.n) + '</small>' : ''); }, sort: function(r){ return r.s; } },
      { label: 'Price', num: true, cell: function(r){ return wbNum(r.p) == null ? '' : '$' + wbNum(r.p).toFixed(2); }, sort: function(r){ return wbNum(r.p); } },
      { label: 'Day', num: true, cell: function(r){ return '<span class="' + wbCls(r.c) + '">' + wbPct(r.c) + '</span>'; }, sort: function(r){ return wbNum(r.c); } },
      { label: 'Volume', num: true, cell: function(r){ return wbVol(r.v); }, sort: function(r){ return wbNum(r.v); } }
    ];
    return VIEWS.tableHtml(cols, rows, { key: 'wbd-' + key, cls: 'wbd-table' });
  }
  function wbBackupHtml(chk){
    if (!chk) return '';
    var parts = [];
    var ef = chk.earnings && chk.earnings.filled || [], ed = chk.earnings && chk.earnings.disagree || [], tf = chk.targets && chk.targets.filled || [], xd = chk.econ && chk.econ.disagree || [];
    var fg = chk.fearGreed;
    parts.push('<li><b>Earnings dates filled in</b> for the Top Picks decision (no Yahoo or Nasdaq date): ' + (ef.length ? ef.map(function(x){ return escapeHtml(x.symbol) + ' ' + wbDate(x.date); }).join(', ') : 'none') + '.</li>');
    parts.push('<li><b>Earnings dates that disagree</b> with our main source by more than a day: ' + (ed.length ? ed.map(function(x){ return escapeHtml(x.symbol) + ' ours ' + wbDate(x.main) + ', Webull ' + wbDate(x.backup); }).join('; ') : 'none') + '.</li>');
    parts.push('<li><b>Street targets filled in</b> on the Valuation lab (no Yahoo target): ' + (tf.length ? tf.map(escapeHtml).join(', ') : 'none') + '.</li>');
    parts.push('<li><b>Release dates that disagree</b> with our calendar: ' + (xd.length ? xd.map(function(x){ return escapeHtml(x.group || '') + ' ours ' + wbDate(x.ours) + ', Webull ' + wbDate(x.webull); }).join('; ') : 'none') + '.</li>');
    if (fg) parts.push('<li><b>Fear &amp; Greed</b>: ' + (fg.verdict === 'same-index' ? 'Webull\\'s index matches CNN\\'s (' + fg.matched + ' dates, largest gap ' + fg.maxGap + ' points), so it may stand in for the engines\\' fear reads when CNN fails' + (fg.standIn ? '; <b>it stood in this build</b>' : '') : fg.verdict === 'different-index' ? 'Webull\\'s index is not CNN\\'s (' + fg.matched + ' dates, largest gap ' + fg.maxGap + ' points); shown as context only' : 'not enough matching dates yet (' + (fg.matched || 0) + ') to tell whether Webull\\'s index is CNN\\'s; context only until it is') + '.</li>');
    return '<details class="wbd-sub"><summary>Backup sources: what Webull filled in and where it disagrees</summary><ul class="wbd-list">' + parts.join('') + '</ul>' +
      '<p class="wbd-src">Built ' + wbDate(chk.builtAt) + '. A Webull value is used only when our main source has none, and is labeled backup source. Nothing public reads it.</p></details>';
  }
  function wbMarketHtml(br, chk){
    var day = br && br.today;
    if (!day) return chk ? '<section class="wbd-card"><h3>Whole-market breadth (Webull)</h3><p class="wbd-empty">No Webull breadth saved yet.</p>' + wbBackupHtml(chk) + '</section>' : '';
    var t = wbTotals(day);
    var l = day.lists || {};
    var kpis = '<div class="wbd-kpis">' +
      '<div class="wbd-kpi"><span>Movers up</span><b class="' + (t && t.advPct >= 50 ? 'pos' : 'neg') + '">' + (t && t.advPct != null ? t.advPct.toFixed(0) + '%' : '\\u2014') + '</b><small>' + (t ? wbInt(t.adv) + ' up, ' + wbInt(t.dec) + ' down' : '') + '</small></div>' +
      WB_52.map(function(x){ return '<div class="wbd-kpi"><span>' + escapeHtml(x[1]) + '</span><b>' + wbCount(l[x[0]]) + '</b>' + (l[x[0]] && l[x[0]].capped ? '<small>The list stops at 200</small>' : '<small>&nbsp;</small>') + '</div>'; }).join('') +
      '</div>';
    var movers = '<div class="wbd-cols">' + WB_LISTS.map(function(x){ return '<div class="wbd-col"><h4>' + escapeHtml(x[1]) + '</h4>' + wbListTable(l[x[0]], x[0]) + '</div>'; }).join('') + '</div>';
    var highs = '<details class="wbd-sub"><summary>52-week highs and lows</summary><div class="wbd-cols">' + WB_52.map(function(x){ return '<div class="wbd-col"><h4>' + escapeHtml(x[1]) + ' (' + wbCount(l[x[0]]) + ')</h4>' + wbListTable(l[x[0]], x[0], { top: 20 }) + '</div>'; }).join('') + '</div></details>';
    var errs = day.errors && Object.keys(day.errors).length ? '<p class="wbd-warn">Parts Webull did not answer this session: ' + Object.keys(day.errors).map(escapeHtml).join(', ') + '.</p>' : '';
    return '<section class="wbd-card"><header class="wbd-head"><span class="wbd-kicker">Owner \\u00b7 Webull data \\u00b7 ' + wbDate(day.date) + '</span><h3>Whole-market breadth (Webull)</h3>' +
      '<p class="wbd-lede">Every US stock Webull lists, a different and wider source than the S&amp;P 500 + Nasdaq-100 breadth on the Heatmap\\'s Wide view. Context only, never a vote.</p></header>' +
      kpis + '<div class="wbd-sub"><h4>How many stocks moved by how much (% change today)</h4>' + wbHistHtml(day) + '</div>' + wbAdvLineHtml(br.history) + movers + highs + wbSectorTable(day) + errs + wbBackupHtml(chk) +
      wbSrc('Webull market sectors, sector stock lists and screeners.') + '</section>';
  }

  // ---- order flow (stock page, Owner tab) --------------------------------
  function wbFlowHtml(file, sym){
    var rows = file && file.rows && Array.isArray(file.rows[sym]) ? file.rows[sym] : null;
    if (!rows || !rows.length){
      var miss = file && file.misses && file.misses[sym];
      return '<section class="stp-sec wbd-flow"><h3 class="stp-h3">Order flow (Webull)</h3><p class="stp-empty">' + (miss ? 'Webull has no capital flow for ' + escapeHtml(sym) + ' (' + escapeHtml(miss.reason || 'no data') + ').' : 'No Webull order flow saved for ' + escapeHtml(sym) + ' yet.') + '</p></section>';
    }
    var list = rows.slice(-30).map(function(r){
      var li = r[1], lo = r[2], mi = r[3], mo = r[4], si = r[5], so = r[6], tot = li + lo + mi + mo + si + so;
      return { date: r[0], large: li - lo, medium: mi - mo, small: si - so, all: li - lo + mi - mo + si - so, total: tot, largePct: tot > 0 ? (li - lo) / tot * 100 : null };
    });
    var max = 1;
    list.forEach(function(x){ max = Math.max(max, Math.abs(x.large), Math.abs(x.medium), Math.abs(x.small)); });
    var W = 540, H = 150, P = 8, mid = H / 2, gw = (W - P * 2) / list.length, bw = Math.max(1.5, gw / 3 - 1), pts = [];
    var svg = '';
    list.forEach(function(x, i){
      var gx = P + i * gw;
      [['large', 'wbd-f-large'], ['medium', 'wbd-f-medium'], ['small', 'wbd-f-small']].forEach(function(k, j){
        var v = x[k[0]], h = Math.abs(v) / max * (mid - 6), y = v >= 0 ? mid - h : mid;
        svg += '<rect class="' + k[1] + '" x="' + (gx + j * (bw + 1)).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0.5).toFixed(1) + '"></rect>';
      });
      pts.push({ x: gx + gw / 2, y: mid, label: x.date + '\\nLarge ' + wbMoney(x.large) + '\\nMedium ' + wbMoney(x.medium) + '\\nSmall ' + wbMoney(x.small) + '\\nAll sizes ' + wbMoney(x.all) });
    });
    var chart = '<svg class="wbd-flow-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' + chHoverAttr(pts) + ' role="img" aria-label="Net money in by order size, by session"><line class="wbd-mid" x1="' + P + '" x2="' + (W - P) + '" y1="' + mid + '" y2="' + mid + '"></line>' + svg + '</svg>' +
      '<p class="wbd-legend"><span class="wbd-li"><span class="wbd-key wbd-f-large"></span>Large orders</span><span class="wbd-li"><span class="wbd-key wbd-f-medium"></span>Medium</span><span class="wbd-li"><span class="wbd-key wbd-f-small"></span>Small</span><span class="wbd-li">Above the line = more bought than sold</span></p>';
    var recent = list.slice(-10).reverse();
    var cols = [
      { label: 'Session', cell: function(r){ return wbDate(r.date); }, sort: function(r){ return r.date; } },
      { label: 'Large net', num: true, cell: function(r){ return '<span class="' + wbCls(r.large) + '">' + wbMoney(r.large) + '</span>'; }, sort: function(r){ return r.large; } },
      { label: 'Medium net', num: true, cell: function(r){ return '<span class="' + wbCls(r.medium) + '">' + wbMoney(r.medium) + '</span>'; }, sort: function(r){ return r.medium; } },
      { label: 'Small net', num: true, cell: function(r){ return '<span class="' + wbCls(r.small) + '">' + wbMoney(r.small) + '</span>'; }, sort: function(r){ return r.small; } },
      { label: 'Large, % of traded', num: true, cell: function(r){ return '<span class="' + wbCls(r.largePct) + '">' + wbPct(r.largePct, 2) + '</span>'; }, sort: function(r){ return r.largePct; } },
      { label: 'Traded', num: true, cell: function(r){ return wbMoney(r.total); }, sort: function(r){ return r.total; } }
    ];
    var five = list.slice(-5), big5 = 0, tot5 = 0;
    five.forEach(function(x){ big5 += x.large; tot5 += x.total; });
    return '<section class="stp-sec wbd-flow"><h3 class="stp-h3">Order flow (Webull)</h3>' +
      '<p class="wbd-line">Large orders, last five sessions: <b class="' + wbCls(big5) + '">' + wbMoney(big5) + '</b>' + (tot5 > 0 ? ' (' + wbPct(big5 / tot5 * 100, 2) + ' of everything traded)' : '') + '.</p>' +
      chart + VIEWS.tableHtml(cols, recent, { key: 'wbd-flow', cls: 'wbd-table' }) +
      '<p class="stp-src">Dollars traded on the buy side (in) minus the sell side (out), split by order size, as Webull counts them. Logged daily to test later (about three months); not a vote and not part of the grade. ' + rows.length + ' session' + (rows.length === 1 ? '' : 's') + ' saved. Webull OpenAPI, Owner only.</p></section>';
  }

  // ---- placeholders ------------------------------------------------------
  function wbFill(el){
    var kind = el.getAttribute('data-wb');
    el.setAttribute('data-wb-done', '1');
    if (kind === 'market'){
      Promise.all([wbLoad('webull-breadth.json'), wbLoad('webull-backup-check.json')]).then(function(r){
        var html = wbMarketHtml(r[0], r[1]);
        el.hidden = !html; el.innerHTML = html;
      });
    } else if (kind === 'flow'){
      var sym = String(el.getAttribute('data-wb-sym') || '').toUpperCase();
      wbLoad('webull-flow.json').then(function(f){
        if (!f){ el.hidden = true; el.innerHTML = ''; return; }
        el.innerHTML = wbFlowHtml(f, sym); el.hidden = false;
      });
    }
  }
  function wbHydrate(){
    if (typeof document === 'undefined' || !HAS_OWNER_ACCESS) return;
    var list = document.querySelectorAll('[data-wb]:not([data-wb-done])');
    for (var i = 0; i < list.length; i++) wbFill(list[i]);
  }
  var wbQueued = false;
  function wbQueue(){ if (wbQueued) return; wbQueued = true; (window.requestAnimationFrame || setTimeout)(function(){ wbQueued = false; wbHydrate(); }); }
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined'){
    new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes && muts[i].addedNodes.length){ wbQueue(); return; }
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('stonks-owner-ready', wbQueue);
  }
  wbQueue();
  })();
`;
}

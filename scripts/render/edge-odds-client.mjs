// Edge, odds and run health (2026-11-07): three Owner reads that answer
// "is the engine working, and can I trust this pick?"
//
//   1. "Do we have an edge yet?" on the Track Record Scorecard: the average
//      P&L per closed trade with a resampled 95% range, the same for real
//      fills and for picks minus a SPY option on the same entries, the win
//      rate against the rate needed to break even, the latest rule set on
//      its own, a running-average chart and how many more trades it takes.
//   2. Similar-setup odds on each Top Picks card and open trade, from the
//      table the bake writes (lib/setup-odds.mjs → setupOdds in
//      picks-open.json and picks-accuracy.json).
//   3. Top Picks run health on Home and Open picks: did the latest 11:00 /
//      15:30 ET run publish? Read from picks-open.json's builtAtIso, which
//      only a Top Picks run writes. The GitHub-side watchdog
//      (scripts/top-picks-watchdog.mjs) retries and alerts; this only shows it.
//
// All three read files the Owner session already loads; no new fetch, no AI.
// The returned string is pasted inside the app.js IIFE (ES5, no imports). It
// uses the Track Record helpers (accPct, accMean, accStd, accQuantile, accRng,
// accWilson, accRuleSegments, escapeHtml, chHoverAttr), all function
// declarations in the same scope.
export function renderEdgeOddsJs() {
  return `
  // ---- Similar-setup odds ---------------------------------------------------
  var ODDS_LEVEL_TIP = {
    'side-band-market': 'Matched on side, grade band and market type at entry.',
    'side-band': 'Too few past trades also matched the market type, so this matches side and grade band only.',
    'side-market': 'Too few past trades matched the grade band, so this matches side and market type only.',
    'side': 'Too few past trades matched the grade band or market type, so this is every past trade on this side.'
  };
  function oddsLookup(table, sym, side){
    if (!table || !table.picks || !sym) return null;
    return table.picks[String(sym).toUpperCase() + '|' + (side === 'put' ? 'put' : 'call')] || null;
  }
  function oddsDescribe(o){
    if (!o.band && !o.market) return 'every past ' + (o.side === 'put' ? 'put' : 'call');
    var bits = [o.side === 'put' ? 'puts' : 'calls'];
    if (o.band) bits.push(o.band === 'under 7' ? 'grade under 7' : 'grade ' + o.band);
    if (o.market) bits.push(o.market + ' market');
    return bits.join(', ');
  }
  // compact: one short chip for the Top Picks grid tile.
  function oddsLineHtml(o, compact){
    if (!o || !(o.n >= 0)) return '';
    var few = o.few || o.n < 10;
    var tip = 'Past closed Top Picks trades like this one: ' + oddsDescribe(o) + '. ' + (ODDS_LEVEL_TIP[o.level] || '') +
      (o.range ? ' Likely win rate (95%): ' + o.range[0] + '–' + o.range[1] + '%.' : '') +
      (o.realN ? ' Real fills averaged ' + accPct(o.avgRealPct) + ' on ' + o.realN + '.' : '') +
      ' Every rule set counts; flat and left-coverage closes do not. Modeled option P&L.';
    if (!o.n) {
      return compact ? '' : '<div class="odds-line odds-none" title="' + escapeHtml(tip) + '">Similar past trades: none yet (' + escapeHtml(oddsDescribe(o)) + ')</div>';
    }
    var cls = o.avgPnlPct == null ? '' : o.avgPnlPct >= 0 ? 'sig-pos' : 'sig-neg';
    if (compact) {
      return '<span class="ptc-odds' + (few ? ' is-few' : '') + '" title="' + escapeHtml(tip) + '">Like this: ' + o.wins + '/' + o.n + ' won · <span class="' + cls + '">' + escapeHtml(accPct(o.avgPnlPct)) + '</span></span>';
    }
    return '<div class="odds-line' + (few ? ' is-few' : '') + '" title="' + escapeHtml(tip) + '">' +
      '<span class="odds-lbl">Similar past trades</span> ' +
      '<b>' + o.wins + ' of ' + o.n + ' won</b>' + (o.range ? ' <small>(likely ' + o.range[0] + '–' + o.range[1] + '%)</small>' : '') +
      ' · avg <span class="' + cls + '">' + escapeHtml(accPct(o.avgPnlPct)) + '</span>' +
      ' <small class="odds-what">' + escapeHtml(oddsDescribe(o)) + '</small>' +
      (few ? ' <span class="acc-few" title="Fewer than 10 matching trades: too few to trust.">few</span>' : '') +
    '</div>';
  }
  // One table cell (Open picks table view): wins / matched · average.
  function oddsCellHtml(o){
    if (!o || !o.n) return '';
    var cls = o.avgPnlPct == null ? '' : o.avgPnlPct >= 0 ? 'sig-pos' : 'sig-neg';
    return '<span class="odds-cell' + (o.few || o.n < 10 ? ' is-few' : '') + '" title="' + escapeHtml('Past closed trades like this one (' + oddsDescribe(o) + '): ' + o.wins + ' of ' + o.n + ' won' + (o.range ? ', likely ' + o.range[0] + '–' + o.range[1] + '%' : '') + '. ' + (ODDS_LEVEL_TIP[o.level] || '')) + '">' +
      o.wins + '/' + o.n + ' · <span class="' + cls + '">' + escapeHtml(accPct(o.avgPnlPct)) + '</span></span>';
  }
  function oddsTableNow(){
    var a = typeof openPicksState !== 'undefined' && openPicksState && openPicksState.data && openPicksState.data.setupOdds;
    if (a) return a;
    var b = typeof accuracyState !== 'undefined' && accuracyState && accuracyState.data && accuracyState.data.setupOdds;
    if (b) return b;
    return (typeof picksState !== 'undefined' && picksState && picksState.odds) || null;
  }

  // ---- Do we have an edge yet? ----------------------------------------------
  var EDGE_MIN_JUDGE = 30, EDGE_BOOT = 2000;
  // Decided trades, current window plus archive, oldest first, deduped.
  function edgeDecided(d){
    var all = (Array.isArray(d && d.closed) ? d.closed : []).concat(Array.isArray(d && d.archive) ? d.archive : []);
    var seen = {}, out = [];
    for (var i = 0; i < all.length; i++){
      var e = all[i];
      if (!e || (e.outcome !== 'win' && e.outcome !== 'loss') || e.counted === false) continue;
      if (e.optionPnlPct == null || e.optionPnlPct === '' || !isFinite(Number(e.optionPnlPct))) continue;
      var k = e.symbol + ':' + e.side + ':' + e.entryDate;
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(e);
    }
    out.sort(function(a, b){ return (Date.parse(a.exitDate || a.entryDate) || 0) - (Date.parse(b.exitDate || b.entryDate) || 0); });
    return out;
  }
  // Mean with a resampled (bootstrap) 95% range. Seeded by the sample so the
  // panel reads the same on every load.
  function edgeSummary(xs){
    var n = xs.length;
    if (!n) return null;
    var mean = accMean(xs), sd = n > 1 ? accStd(xs) : null;
    if (n < 3) return { n: n, mean: mean, sd: sd, lo: null, hi: null };
    var seed = n * 2654435761;
    for (var s = 0; s < n; s++) seed = (seed ^ Math.round(xs[s] * 100)) * 16777619;
    var rnd = accRng(seed >>> 0), means = new Array(EDGE_BOOT);
    for (var b = 0; b < EDGE_BOOT; b++){
      var sum = 0;
      for (var j = 0; j < n; j++) sum += xs[Math.floor(rnd() * n)];
      means[b] = sum / n;
    }
    means.sort(function(a, c){ return a - c; });
    return { n: n, mean: mean, sd: sd, lo: accQuantile(means, 0.025), hi: accQuantile(means, 0.975) };
  }
  // More closed trades until the range would clear zero at today's average
  // and spread: n where 1.96 · sd / √n < mean. Null when the average is at or
  // below zero (more trades alone cannot make it positive).
  function edgeMoreNeeded(s){
    if (!s || !(s.mean > 0) || !(s.sd > 0)) return null;
    var need = Math.ceil(Math.pow(1.96 * s.sd / s.mean, 2));
    return Math.max(0, need - s.n);
  }
  function edgeSpyDiffs(d, decided){
    var bl = d && d.baseline && Array.isArray(d.baseline.closed) ? d.baseline.closed : [];
    var byPair = {};
    bl.forEach(function(b){ if (b && b.pairKey) byPair[b.pairKey] = b; });
    var out = [];
    decided.forEach(function(e){
      var b = byPair[e.symbol + ':' + e.side + ':' + e.entryDate];
      if (!b || b.optionPnlPct == null || b.optionPnlPct === '' || !isFinite(Number(b.optionPnlPct))) return;
      out.push(Number(e.optionPnlPct) - Number(b.optionPnlPct));
    });
    return out;
  }
  function edgeRangeText(s){
    // A no-break space keeps "-4.0% to" together when a phone wraps the cell.
    return s && s.lo != null ? accPct(s.lo) + '\\u00a0to ' + accPct(s.hi) : '—';
  }
  function edgeVerdict(model, spy){
    if (!model || model.n < 10) return { key: 'early', label: 'Too early to say' };
    var spyOk = !spy || spy.n < 10 || spy.lo == null || spy.lo > 0;
    if (model.n >= EDGE_MIN_JUDGE && model.lo != null && model.lo > 0 && spyOk) return { key: 'edge', label: 'Edge showing' };
    if (model.hi != null && model.hi < 0) return { key: 'losing', label: 'Losing so far' };
    return { key: 'unclear', label: 'Not yet clear' };
  }
  // Running average per trade with its 95% band (normal approximation from
  // the 5th trade on), and the zero line.
  function edgeChartHtml(xs){
    var n = xs.length;
    if (n < 5) return '';
    // The SVG stretches to the panel width (preserveAspectRatio none), so the
    // axis labels are HTML beside it and keep their size.
    var W = 640, H = 150, L = 2, R = 2, T = 8, B = 8;
    var run = [], sum = 0, sumSq = 0;
    for (var i = 0; i < n; i++){
      sum += xs[i]; sumSq += xs[i] * xs[i];
      var k = i + 1, m = sum / k;
      var v = k > 1 ? Math.max(0, (sumSq - k * m * m) / (k - 1)) : 0;
      var h = k >= 5 ? 1.96 * Math.sqrt(v / k) : null;
      run.push({ k: k, m: m, lo: h == null ? null : m - h, hi: h == null ? null : m + h });
    }
    var lo = 0, hi = 0;
    run.forEach(function(p){ var a = p.lo != null ? p.lo : p.m, b = p.hi != null ? p.hi : p.m; if (a < lo) lo = a; if (b > hi) hi = b; });
    var pad = (hi - lo) * 0.06 || 5; lo -= pad; hi += pad;
    var x = function(k){ return L + (k - 1) * (W - L - R) / (n - 1); };
    var y = function(v){ return T + (hi - v) * (H - T - B) / (hi - lo); };
    var line = '', top = '', bot = '', hover = [];
    run.forEach(function(p, i){
      line += (i ? ' ' : '') + x(p.k).toFixed(1) + ',' + y(p.m).toFixed(1);
      if (p.lo != null){ top += (top ? ' ' : '') + x(p.k).toFixed(1) + ',' + y(p.hi).toFixed(1); bot = x(p.k).toFixed(1) + ',' + y(p.lo).toFixed(1) + (bot ? ' ' + bot : ''); }
      hover.push({ x: x(p.k), y: y(p.m), label: 'After trade ' + p.k + ': avg ' + accPct(p.m) + (p.lo != null ? '\\nlikely ' + accPct(p.lo) + ' to ' + accPct(p.hi) : '') });
    });
    var z = y(0);
    var pctTop = function(v){ return (y(v) / H * 100).toFixed(1); };
    var ylab = '<span style="top:' + pctTop(hi) + '%">' + escapeHtml(accPct(hi)) + '</span>' +
      (Math.abs(z - y(hi)) > H * 0.14 && Math.abs(z - y(lo)) > H * 0.14 ? '<span style="top:' + pctTop(0) + '%">0%</span>' : '') +
      '<span style="top:' + pctTop(lo) + '%">' + escapeHtml(accPct(lo)) + '</span>';
    return '<figure class="edge-chart"><div class="edge-plot"><div class="edge-y" aria-hidden="true">' + ylab + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Running average P&amp;L per trade with its likely range"' + chHoverAttr(hover) + '>' +
        (top ? '<polygon class="edge-band" points="' + top + ' ' + bot + '"/>' : '') +
        '<line class="edge-zero" x1="0" x2="' + W + '" y1="' + z.toFixed(1) + '" y2="' + z.toFixed(1) + '"/>' +
        '<polyline class="edge-line" points="' + line + '" fill="none"/>' +
      '</svg></div>' +
      '<div class="edge-x" aria-hidden="true"><span>trade 1</span><span>trade ' + n + '</span></div>' +
      '<figcaption>Running average P&amp;L per closed trade (modeled), oldest first. The shaded band is its likely range; the dashed line is zero.</figcaption></figure>';
  }
  function edgeRow(label, s, extra, tip){
    if (!s || !s.n) return '';
    var cls = s.mean >= 0 ? 'sig-pos' : 'sig-neg';
    var rcls = s.lo == null ? '' : s.lo > 0 ? 'sig-pos' : s.hi < 0 ? 'sig-neg' : '';
    return '<tr' + (tip ? ' title="' + escapeHtml(tip) + '"' : '') + '><td>' + label + '</td><td><span class="' + cls + '">' + escapeHtml(accPct(s.mean)) + '</span>' + (extra || '') + '</td>' +
      '<td><span class="' + rcls + '">' + escapeHtml(edgeRangeText(s)) + '</span></td><td>' + s.n + (s.n < 10 ? ' <span class="acc-few">few</span>' : '') + '</td></tr>';
  }
  function edgePanelHtml(d){
    var decided = edgeDecided(d || {});
    if (!decided.length) return '';
    var pnl = decided.map(function(e){ return Number(e.optionPnlPct); });
    var model = edgeSummary(pnl);
    var realXs = decided.filter(function(e){ return e.realFillPnlPct != null && e.realFillPnlPct !== '' && isFinite(Number(e.realFillPnlPct)); }).map(function(e){ return Number(e.realFillPnlPct); });
    var real = realXs.length >= 5 ? edgeSummary(realXs) : null;
    var spyXs = edgeSpyDiffs(d, decided);
    var spy = spyXs.length >= 5 ? edgeSummary(spyXs) : null;
    var verdict = edgeVerdict(model, spy);
    // Win rate against the rate the win and loss sizes need to break even.
    var wins = decided.filter(function(e){ return e.outcome === 'win'; });
    var losses = decided.filter(function(e){ return e.outcome === 'loss'; });
    var avgW = wins.length ? accMean(wins.map(function(e){ return Number(e.optionPnlPct); })) : null;
    var avgL = losses.length ? Math.abs(accMean(losses.map(function(e){ return Number(e.optionPnlPct); }))) : null;
    var be = avgW != null && avgL != null && avgW + avgL > 0 ? avgL / (avgW + avgL) : null;
    var wr = wins.length / decided.length, wil = accWilson(wins.length, decided.length);
    var winRow = '<tr title="The win rate the average win and loss sizes need to break even: average loss ÷ (average win + average loss)."><td>Win rate' + (be != null ? ' <small>(' + Math.round(be * 100) + '% needed to break even)</small>' : '') + '</td>' +
      '<td><span class="' + (be == null ? '' : wr >= be ? 'sig-pos' : 'sig-neg') + '">' + Math.round(wr * 100) + '%</span></td>' +
      '<td><span class="' + (be == null || !wil ? '' : wil.lo > be ? 'sig-pos' : wil.hi < be ? 'sig-neg' : '') + '">' + (wil ? Math.round(wil.lo * 100) + '–' + Math.round(wil.hi * 100) + '%' : '—') + '</span></td><td>' + decided.length + '</td></tr>';
    // The newest rule set on its own (one Track Record divider).
    var segRow = '';
    var segs = accRuleSegments(decided);
    if (segs.length > 1 && segs[0].items.length >= 3 && segs[0].items.length < decided.length){
      var segS = edgeSummary(segs[0].items.map(function(e){ return Number(e.optionPnlPct); }));
      segRow = edgeRow('Latest rule set only' + (segs[0].dates[0] ? ' <small>(since <span style="white-space:nowrap">' + escapeHtml(segs[0].dates[0]) + '</span>)</small>' : ''), segS, '', 'Only trades opened under the newest set of rules (the top row of "Win rate by rule set").');
    }
    var more = edgeMoreNeeded(model);
    var lead;
    if (verdict.key === 'early') lead = 'Only ' + model.n + ' closed trade' + (model.n === 1 ? '' : 's') + ' so far. The ranges are too wide to read until there are at least 10, and a call needs ' + EDGE_MIN_JUDGE + ' or more.';
    else if (verdict.key === 'edge') lead = 'After ' + model.n + ' closed trades the average is ' + accPct(model.mean) + ' a trade and its likely range (' + edgeRangeText(model) + ') sits above zero' + (spy ? ', with the picks ahead of a SPY option on the same entries' : '') + '.';
    else if (verdict.key === 'losing') lead = 'After ' + model.n + ' closed trades the average is ' + accPct(model.mean) + ' a trade and its whole likely range (' + edgeRangeText(model) + ') is below zero.';
    else lead = 'After ' + model.n + ' closed trades the average is ' + accPct(model.mean) + ' a trade, but the likely range runs from ' + edgeRangeText(model) + ', so the true average could still be zero or below.';
    if (verdict.key !== 'edge' && verdict.key !== 'losing'){
      if (more != null) lead += ' At today\\'s average and spread, about ' + (more > 2000 ? 'more than 2,000' : more) + ' more closed trade' + (more === 1 ? '' : 's') + ' would settle it.';
      else if (model.n >= 10) lead += ' With the average at or below zero, more trades alone won\\'t show an edge.';
    }
    if (verdict.key === 'edge' && spy && spy.lo != null && spy.lo <= 0) lead += ' Against SPY the gap is not yet clear.';
    return '<section class="acc-edge acc-edge-' + verdict.key + '" aria-label="Do we have an edge yet?">' +
      '<div class="acc-edge-head"><h3>Do we have an edge yet?</h3><span class="acc-edge-verdict">' + escapeHtml(verdict.label) + '</span></div>' +
      '<p class="acc-edge-lead">' + escapeHtml(lead) + '</p>' +
      '<div class="acc-tscroll"><table class="acc-qtable acc-edge-table" data-nosort><thead><tr><th>Measure</th><th>Now</th><th>Likely range (95%)</th><th>Trades</th></tr></thead><tbody>' +
        edgeRow('Average P&amp;L per trade <small>(model)</small>', model, '', 'Modeled option P&L per closed trade, current window plus archive. ' + ACC_MODEL_TIP) +
        (real ? edgeRow('Average real fill <small>(ask in, bid out)</small>', real, '', 'What each trade returned paying the ask to open and taking the bid to close. Only trades opened since Oct 21 2026 have it.') : '') +
        (spy ? edgeRow('Picks minus a SPY option <small>(same entries)</small>', spy, '', 'Each pick\\'s P&L minus the paired ~0.55-delta SPY option opened at the same run. Above zero means the picks beat a plain index option.') : '') +
        winRow + segRow +
      '</tbody></table></div>' +
      edgeChartHtml(pnl) +
      '<p class="hint acc-edge-note">Ranges come from resampling the closed trades ' + EDGE_BOOT.toLocaleString('en-US') + ' times. "Edge showing" needs at least ' + EDGE_MIN_JUDGE + ' closed trades, the whole range of the average above zero, and the SPY comparison not below zero. The record is judged in full at about ' + ACC_JUDGE_N + ' trades. Flat and left-coverage closes do not count.</p>' +
    '</section>';
  }

  // ---- Top Picks run health -------------------------------------------------
  var RUN_HEALTH_SLOTS = [[660, '11:00'], [930, '15:30']];
  // Same bar as the watchdog's "slow" call (lib/top-picks-watchdog.mjs): a run
  // usually publishes about five minutes after its slot.
  var RUN_HEALTH_DUE_MIN = 45;
  var runHealthFmt = null;
  function runHealthEt(ms){
    try {
      if (!runHealthFmt) runHealthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      var o = {};
      runHealthFmt.formatToParts(new Date(ms)).forEach(function(p){ o[p.type] = p.value; });
      return { date: o.year + '-' + o.month + '-' + o.day, minute: Number(o.hour) * 60 + Number(o.minute) };
    } catch (_){ return null; }
  }
  // The UTC ms of an ET wall-clock minute on an ET date (EDT or EST).
  function runHealthMs(date, minute){
    var base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
    for (var off = 4; off <= 5; off++){
      var ms = base + (minute + off * 60) * 60000, c = runHealthEt(ms);
      if (c && c.date === date && c.minute === minute) return ms;
    }
    return null;
  }
  function runHealthDayLabel(date, today){
    if (date === today) return 'today';
    var d = new Date(date + 'T12:00:00Z');
    return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
  }
  // 24-hour ET, like the 11:00 / 15:30 slot names.
  function runHealthClock(ms){
    var c = runHealthEt(ms); if (!c) return '';
    var h = Math.floor(c.minute / 60), m = c.minute % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ' ET';
  }
  // "15:30 ET run today" / "15:30 ET run on Friday"
  function runHealthRunName(h){
    return h.slot + ' ET Top Picks run ' + (h.day === 'today' ? 'today' : 'on ' + h.day);
  }
  // lastIso: picks-open.json builtAtIso (written only by a Top Picks run).
  // Returns { state: ok | late | running | missed, slot, day, lastText } for
  // the latest slot that has started, or null when it can't tell.
  function topPicksRunHealth(lastIso, nowMs){
    var last = Date.parse(lastIso || '');
    var now = runHealthEt(nowMs || Date.now());
    if (!isFinite(last) || !now) return null;
    var base = Date.UTC(Number(now.date.slice(0, 4)), Number(now.date.slice(5, 7)) - 1, Number(now.date.slice(8, 10)));
    for (var back = 0; back < 12; back++){
      var dt = new Date(base - back * 86400000), key = dt.toISOString().slice(0, 10), dow = dt.getUTCDay();
      if (dow === 0 || dow === 6 || (typeof MARKET_HOLIDAYS !== 'undefined' && MARKET_HOLIDAYS.hasOwnProperty(key))) continue;
      var half = typeof MARKET_HALF_DAYS !== 'undefined' && MARKET_HALF_DAYS.hasOwnProperty(key);
      for (var i = RUN_HEALTH_SLOTS.length - 1; i >= 0; i--){
        var slot = RUN_HEALTH_SLOTS[i];
        if (half && slot[0] >= 780) continue;
        if (back === 0 && now.minute < slot[0]) continue;
        var start = runHealthMs(key, slot[0]);
        if (start == null) return null;
        var lastText = runHealthDayLabel(runHealthEt(last).date, now.date) + ' ' + runHealthClock(last);
        var out = { slot: slot[1], day: runHealthDayLabel(key, now.date), lastText: lastText };
        // A run stamps builtAtIso as it starts, a few seconds after the slot.
        if (last >= start - 120000) { out.state = last > start + RUN_HEALTH_DUE_MIN * 60000 ? 'late' : 'ok'; return out; }
        out.state = (nowMs || Date.now()) < start + RUN_HEALTH_DUE_MIN * 60000 ? 'running' : 'missed';
        return out;
      }
    }
    return null;
  }
  function runHealthNoteHtml(h){
    if (!h || (h.state !== 'missed' && h.state !== 'late')) return '';
    if (h.state === 'late') return '<p class="run-health run-health-late" role="status">The ' + escapeHtml(runHealthRunName(h)) + ' published late, at ' + escapeHtml(h.lastText) + ' (a watchdog retry or a re-run).</p>';
    return '<p class="run-health run-health-missed" role="status"><b>The ' + escapeHtml(runHealthRunName(h)) + ' has not published.</b> Marks, exits and new trades here are from the last run (' + escapeHtml(h.lastText) + '). The watchdog sends one retry while the session allows and opens a top-picks-run alert on GitHub.</p>';
  }
`;
}

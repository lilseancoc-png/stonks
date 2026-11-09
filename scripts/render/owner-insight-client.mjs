// Owner insight pieces (2026-11-08): the closed-trade post-mortem card and
// the Scorecard "why the losses lost" tally (lib/trade-postmortem.mjs), the
// replay chart of a closed trade's price path, the rolling 20-trade win-rate
// chart on the Equity sub-tab, the "your book" sizing what-if on Top Picks
// cards, and the long-vs-short exposure bars in the Open picks Book risk
// panel. Owner-only pages; no AI, no new fetch beyond the public per-ticker
// JSON the replay reads on demand.
//
// The returned string is pasted inside the app.js IIFE (ES5, no imports) and
// uses $, escapeHtml, dataUrl, chHoverAttr, CHART_KIT, VIEWS, POST_MORTEM,
// execEtIsoDate, sectorSplitBarsHtml and renderPicks from that scope.
export function renderOwnerInsightJs() {
  return `
  // ---- Closed-trade post-mortem (lib/trade-postmortem.mjs) ------------------
  function accPostMortemHtml(e){
    var r = POST_MORTEM.build(e);
    if (!r || r.outcome === 'none') return '';
    var cls = r.outcome === 'win' ? 'is-win' : r.outcome === 'loss' ? 'is-loss' : 'is-flat';
    var facts = r.facts.map(function(f){ return '<li>' + escapeHtml(f) + '</li>'; }).join('');
    var tagHtml = r.tags.map(function(t){
      var lbl = t === 'gave-back' ? 'gave it back' : t === 'premium-stop-first' ? 'premium stop first' : t === 'needed-room' ? 'needed room' : t;
      return '<span class="acc-pm-tag">' + escapeHtml(lbl) + '</span>';
    }).join('');
    return '<details class="acc-postmortem ' + cls + '">' +
      '<summary class="acc-cp-summary">Post-mortem · <b>' + escapeHtml(r.label) + '</b></summary>' +
      '<div class="acc-pm-body">' +
        '<p class="acc-pm-head">' + escapeHtml(r.headline) + '.' + (tagHtml ? ' ' + tagHtml : '') + '</p>' +
        (facts ? '<ul class="acc-pm-facts">' + facts + '</ul>' : '') +
        '<p class="acc-pm-lesson"><b>Read:</b> ' + escapeHtml(r.lesson) + '</p>' +
      '</div>' +
    '</details>';
  }
  // Scorecard: how the decided trades won and lost, as counts and shares.
  function accLossCausesHtml(closed){
    var t = POST_MORTEM.tally(closed);
    if (!t || t.n < 3) return '';
    function row(name, n, total, cls, tip){
      var share = total ? Math.round(n / total * 100) : 0;
      return '<div class="acc-tier-row"' + (tip ? ' title="' + escapeHtml(tip) + '"' : '') + '>' +
        '<span class="acc-tier-name">' + escapeHtml(name) + '</span>' +
        '<span class="acc-tier-bar"><i class="' + cls + '" style="width:' + share + '%"></i></span>' +
        '<span class="acc-tier-rate">' + share + '%</span>' +
        '<span class="acc-tier-n">' + n + '/' + total + '</span>' +
        '<span class="acc-tier-range"></span>' +
      '</div>';
    }
    var L = t.losses, W = t.wins;
    var lossRows = L.n ? row('Wrong direction', L.direction, L.n, 'sig-neg', 'The stock moved at least 1% against the trade over the hold.') +
      row('Flat stock, premium bled', L.flat, L.n, 'sig-neg', 'The stock moved less than 1% either way; time and volatility took the premium.') +
      row('Right direction, wrong vehicle', L.vehicle, L.n, 'sig-neg', 'The stock moved at least 1% our way and the contract still lost (IV fell or time ran out).') +
      (L.unknown ? row('No price data', L.unknown, L.n, 'sig-zero') : '') : '';
    var winRows = W.n ? row('Direction call paid', W.direction, W.n, 'sig-pos') +
      (W.vehicle ? row('Won without a stock move', W.vehicle, W.n, 'sig-pos', 'The contract gained while the stock moved less than 1% for the trade, or against it.') : '') +
      (W.premium ? row('Premium collected', W.premium, W.n, 'sig-pos', 'Credit spreads that kept their credit while the stock stayed put.') : '') : '';
    var notes = [];
    if (t.gaveBack) notes.push(t.gaveBack + ' loss' + (t.gaveBack === 1 ? ' was' : 'es were') + ' at least halfway to the target first');
    if (t.premiumStopFirst) notes.push(t.premiumStopFirst + ' premium stop' + (t.premiumStopFirst === 1 ? '' : 's') + ' fired while the stock stayed inside its own stop');
    if (t.neededRoom) notes.push(t.neededRoom + ' win' + (t.neededRoom === 1 ? '' : 's') + ' first dipped at least halfway to the stop');
    return '<div class="accuracy-tiers acc-causes"><div class="accuracy-tiers-head">Why the losses lost · why the wins won</div>' +
      (lossRows ? '<div class="acc-causes-sub">Losses <span class="accuracy-group-n">' + L.n + '</span></div>' + lossRows : '') +
      (winRows ? '<div class="acc-causes-sub">Wins <span class="accuracy-group-n">' + W.n + '</span></div>' + winRows : '') +
      '<p class="hint acc-regime-note">From each trade’s stored entry and exit spot and its modeled contract result (the same read as the post-mortem under each resolved trade).' + (notes.length ? ' ' + notes.join('; ') + '.' : '') + '</p>' +
    '</div>';
  }

  // ---- Replay: the stock’s daily path over the hold -------------------------
  // Opens on demand (one public per-ticker JSON per symbol, cached), draws
  // closes from a few sessions before entry to a few after exit, with the
  // entry and exit marks, the frozen stock stop and target, and the strike.
  var accReplayCache = {};
  function accReplayHtml(e){
    if (!e || !e.symbol || !e.entryDate || !e.exitDate) return '';
    var c = e.contract || {};
    var attrs = ' data-sym="' + escapeHtml(e.symbol) + '" data-entry="' + escapeHtml(e.entryDate) + '" data-exit="' + escapeHtml(e.exitDate) + '"' +
      ' data-side="' + (e.side === 'put' ? 'put' : 'call') + '" data-espot="' + (Number(e.entrySpot) || '') + '" data-xspot="' + (Number(e.exitSpot) || '') + '"' +
      ' data-cut="' + (Number(e.cut) || '') + '" data-tp="' + (Number(e.takeProfit) || '') + '" data-strike="' + (Number(c.strike) || '') + '"';
    return '<details class="acc-replay" data-acc-replay' + attrs + '>' +
      '<summary class="acc-cp-summary">Replay · price path over the hold</summary>' +
      '<div class="acc-replay-body"><p class="muted acc-an-note">Opens on demand.</p></div>' +
    '</details>';
  }
  document.addEventListener('toggle', function(ev){
    var d = ev.target;
    if (!d || !d.hasAttribute || !d.hasAttribute('data-acc-replay') || !d.open || d.getAttribute('data-loaded')) return;
    d.setAttribute('data-loaded', '1');
    accReplayLoad(d);
  }, true);
  function accReplayFetch(sym){
    if (!accReplayCache[sym]) {
      accReplayCache[sym] = fetch(dataUrl(sym + '.json'), { cache: 'no-cache' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; });
    }
    return accReplayCache[sym];
  }
  function accReplayLoad(d){
    var body = d.querySelector('.acc-replay-body');
    if (!body) return;
    body.innerHTML = '<p class="muted acc-an-note">Loading the daily closes…</p>';
    var sym = d.getAttribute('data-sym');
    accReplayFetch(sym).then(function(data){
      var svg = accReplaySvg(data, {
        entry: d.getAttribute('data-entry'), exit: d.getAttribute('data-exit'), side: d.getAttribute('data-side'),
        entrySpot: Number(d.getAttribute('data-espot')) || null, exitSpot: Number(d.getAttribute('data-xspot')) || null,
        cut: Number(d.getAttribute('data-cut')) || null, tp: Number(d.getAttribute('data-tp')) || null, strike: Number(d.getAttribute('data-strike')) || null
      });
      body.innerHTML = svg || '<p class="muted acc-an-note">No stored daily closes cover this hold (the public price history keeps about a year, and names that left coverage have none).</p>';
    });
  }
  function accReplaySvg(data, o){
    var ps = data && data.priceSeries;
    if (!ps || !Array.isArray(ps.t) || !Array.isArray(ps.c) || ps.t.length < 2) return '';
    var t = ps.t, c = ps.c;
    var entryDay = execEtIsoDate(Date.parse(o.entry)), exitDay = execEtIsoDate(Date.parse(o.exit));
    if (!entryDay || !exitDay) return '';
    var iE = -1, iX = -1, i;
    for (i = 0; i < t.length; i++){ if (iE < 0 && t[i] >= entryDay) iE = i; if (t[i] <= exitDay) iX = i; }
    if (iE < 0 || iX < 0 || iX < iE) return '';
    var ctx = 5;
    var i0 = Math.max(0, iE - ctx), i1 = Math.min(t.length - 1, iX + ctx);
    var pts = [];
    for (i = i0; i <= i1; i++){ var v = Number(c[i]); if (isFinite(v) && v > 0) pts.push({ i: i, d: t[i], v: v }); }
    if (pts.length < 2) return '';
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function(p){ if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    [o.entrySpot, o.exitSpot, o.cut, o.tp].forEach(function(v){ if (v != null && isFinite(v) && v > 0){ if (v < lo) lo = v; if (v > hi) hi = v; } });
    if (!(hi > lo)){ lo = lo * 0.98; hi = hi * 1.02; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var W = 560, H = 170, padL = 8, padR = 62, padT = 10, padB = 22, plotW = W - padL - padR, plotH = H - padT - padB;
    function X(idx){ return padL + (idx - i0) / Math.max(1, i1 - i0) * plotW; }
    function Y(v){ return padT + (1 - (v - lo) / (hi - lo)) * plotH; }
    var line = pts.map(function(p, k){ return (k ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ');
    var hold = '<rect class="acc-rp-hold" x="' + X(iE).toFixed(1) + '" y="' + padT + '" width="' + Math.max(2, X(iX) - X(iE)).toFixed(1) + '" height="' + plotH + '" />';
    function level(v, cls, label){
      if (v == null || !isFinite(v) || v <= 0) return '';
      var y = Y(v).toFixed(1);
      return '<line class="acc-rp-level ' + cls + '" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" />' +
        '<text class="acc-rp-label ' + cls + '" x="' + (W - padR + 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '">' + escapeHtml(label) + '</text>';
    }
    var isPut = o.side === 'put';
    var levels = level(o.tp, 'is-target', 'target ' + (o.tp != null ? '$' + o.tp.toFixed(2) : '')) +
      level(o.cut, 'is-stop', 'stop ' + (o.cut != null ? '$' + o.cut.toFixed(2) : '')) +
      (o.strike != null && o.strike !== o.tp && o.strike !== o.cut ? level(o.strike, 'is-strike', 'strike ' + o.strike) : '');
    var eV = o.entrySpot != null && o.entrySpot > 0 ? o.entrySpot : pts.filter(function(p){ return p.i === iE; }).map(function(p){ return p.v; })[0];
    var xV = o.exitSpot != null && o.exitSpot > 0 ? o.exitSpot : pts.filter(function(p){ return p.i === iX; }).map(function(p){ return p.v; })[0];
    var marks = (eV ? '<circle class="acc-rp-dot is-entry" cx="' + X(iE).toFixed(1) + '" cy="' + Y(eV).toFixed(1) + '" r="4" />' : '') +
      (xV ? '<circle class="acc-rp-dot is-exit" cx="' + X(iX).toFixed(1) + '" cy="' + Y(xV).toFixed(1) + '" r="4" />' : '');
    var xl = '<text class="acc-rp-x" x="' + X(iE).toFixed(1) + '" y="' + (H - 6) + '">in ' + escapeHtml(entryDay.slice(5)) + '</text>' +
      '<text class="acc-rp-x is-end" x="' + X(iX).toFixed(1) + '" y="' + (H - 6) + '">out ' + escapeHtml(exitDay.slice(5)) + '</text>';
    var base = eV || pts[0].v;
    var hover = chHoverAttr(pts.map(function(p){
      var ch = (p.v / base - 1) * 100;
      var dir = isPut ? -ch : ch;
      return { x: X(p.i), y: Y(p.v), label: p.d + '\\n$' + p.v.toFixed(2) + ' · ' + (ch >= 0 ? '+' : '') + ch.toFixed(1) + '% vs entry' + (p.i >= iE && p.i <= iX ? (dir >= 0 ? ' (for the trade)' : ' (against)') : '') };
    }));
    var move = eV && xV ? (xV / eV - 1) * 100 : null;
    var note = '<p class="acc-eq-chart-note">Daily closes, ' + pts.length + ' sessions; the shaded band is the hold' +
      (move != null ? '. Stock ' + (move >= 0 ? '+' : '') + move.toFixed(1) + '% from entry to exit' + (isPut ? ' (a put wants down)' : '') : '') +
      '. Dashed lines: the frozen stock stop and target' + (o.strike ? ', dotted: the strike' : '') + '.</p>';
    return '<svg class="acc-rp-svg"' + hover + ' viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price path over the hold">' +
      hold + levels + '<path class="acc-rp-line" d="' + line + '" />' + marks + xl + '</svg>' + note;
  }

  // ---- Rolling 20-trade win rate (Equity sub-tab) ---------------------------
  var ACC_ROLL_WINDOW = 20;
  function accRollingWinHtml(dec){
    var rows = POST_MORTEM.rollingWinRate(dec, ACC_ROLL_WINDOW);
    if (rows.length < 2) return '<p class="muted acc-an-note">The rolling win rate starts at the fifth decided trade.</p>';
    var last = rows[rows.length - 1];
    return '<h4 class="acc-an-subhead">Rolling ' + ACC_ROLL_WINDOW + '-trade win rate <span class="acc-an-tag">' + (last.partial ? 'last ' + last.n + ' trades so far' : 'last ' + ACC_ROLL_WINDOW + ' trades') + ': ' + last.rate.toFixed(0) + '%</span></h4>' +
      '<div class="acc-eq-chart acc-roll-chart" data-acc-roll-chart></div>' +
      '<p class="acc-eq-chart-note">Each point is the win rate of the ' + ACC_ROLL_WINDOW + ' most recent decided trades at that close (fewer while the record is shorter than ' + ACC_ROLL_WINDOW + '). The flat line is the rate the average win and loss sizes need to break even.</p>';
  }
  var accRollChart = null;
  function accMountRollingWin(box, dec){
    var host = box && box.querySelector('[data-acc-roll-chart]');
    if (!host) return;
    var rows = POST_MORTEM.rollingWinRate(dec, ACC_ROLL_WINDOW);
    if (rows.length < 2) return;
    if (accRollChart) { try { accRollChart.destroy(); } catch (_) {} accRollChart = null; }
    // One point per close day (the last trade of the day), as the chart needs.
    var byDay = {}, order = [];
    rows.forEach(function(r){ if (!byDay[r.date]) order.push(r.date); byDay[r.date] = r; });
    var data = order.map(function(d){ return { time: d, value: byDay[d].rate }; });
    var wins = dec.filter(function(e){ return e.outcome === 'win'; }), losses = dec.filter(function(e){ return e.outcome === 'loss'; });
    var avgW = wins.length ? accMean(wins.map(function(e){ return Number(e.optionPnlPct) || 0; })) : null;
    var avgL = losses.length ? Math.abs(accMean(losses.map(function(e){ return Number(e.optionPnlPct) || 0; }))) : null;
    var be = avgW != null && avgL != null && avgW + avgL > 0 ? avgL / (avgW + avgL) * 100 : null;
    var pctFmt = function(v){ return v == null ? '—' : Math.round(v) + '%'; };
    var col = CHART_KIT.colors();
    var series = [{ name: 'Win rate (rolling ' + ACC_ROLL_WINDOW + ')', short: 'win %', type: 'line', data: data, color: col.up, format: pctFmt, width: 2 }];
    if (be != null) series.push({ name: 'Break-even rate', short: 'break-even', type: 'line', data: order.map(function(d){ return { time: d, value: Math.round(be * 10) / 10 }; }), color: col.down, format: pctFmt, width: 1, lastValue: false });
    accRollChart = CHART_KIT.mount(host, { series: series, height: 200, priceLine: false, ranges: ['3M', '6M', 'All'], range: 'All', source: 'Decided trades, by close day · modeled results' });
  }

  // ---- Sizing what-if (Top Picks cards) -------------------------------------
  // The engine sizes on a $25k display book. An Owner can type a book size and
  // an optional risk-per-trade to see the same weights on their own numbers.
  // Browser-only: the inputs live in localStorage and go nowhere else.
  var SIZING_WHATIF_KEY = 'stonks-sizing-v1';
  var sizingWhatIf = (function(){
    try { var raw = JSON.parse(localStorage.getItem(SIZING_WHATIF_KEY) || 'null'); if (raw && typeof raw === 'object') return { account: Number(raw.account) || null, riskPct: Number(raw.riskPct) || null }; } catch (_) {}
    return { account: null, riskPct: null };
  })();
  function sizingWhatIfSave(){ try { localStorage.setItem(SIZING_WHATIF_KEY, JSON.stringify(sizingWhatIf)); } catch (_) {} }
  function sizingWhatIfHtml(){
    return '<details class="picks-whatif"' + (sizingWhatIf.account ? ' open' : '') + '>' +
      '<summary>Size for your book <small>what-if</small></summary>' +
      '<div class="picks-whatif-body">' +
        '<label>Book size $<input type="number" id="picks-whatif-account" min="500" step="500" inputmode="numeric" placeholder="25000" value="' + (sizingWhatIf.account || '') + '"></label>' +
        '<label>Risk per trade %<input type="number" id="picks-whatif-risk" min="0.1" max="25" step="0.1" inputmode="decimal" placeholder="engine weight" value="' + (sizingWhatIf.riskPct || '') + '"></label>' +
        '<button type="button" id="picks-whatif-clear" class="flow-decision-action">Clear</button>' +
        '<p class="hint">Each card then adds a line for your book: with a risk % it is the dollars you would lose at the premium stop; blank uses the engine’s own weight. Display only, saved in this browser.</p>' +
      '</div>' +
    '</details>';
  }
  function bindSizingWhatIf(root){
    if (!root || root.getAttribute('data-bound')) return;
    root.setAttribute('data-bound', '1');
    root.addEventListener('change', function(ev){
      var tgt = ev.target;
      if (!tgt || !tgt.id) return;
      if (tgt.id === 'picks-whatif-account'){ var a = Number(tgt.value); sizingWhatIf.account = a >= 500 ? Math.round(a) : null; }
      else if (tgt.id === 'picks-whatif-risk'){ var r = Number(tgt.value); sizingWhatIf.riskPct = r > 0 && r <= 25 ? Math.round(r * 10) / 10 : null; }
      else return;
      sizingWhatIfSave();
      renderPicks(true);
    });
    root.addEventListener('click', function(ev){
      var tgt = ev.target;
      if (!tgt || tgt.id !== 'picks-whatif-clear') return;
      sizingWhatIf = { account: null, riskPct: null };
      sizingWhatIfSave();
      var a = $('picks-whatif-account'), r = $('picks-whatif-risk');
      if (a) a.value = ''; if (r) r.value = '';
      renderPicks(true);
    });
  }
  // "On your $40,000: 2 contracts (≈$1,690 premium · −$845 at the stop)".
  function pickSizingYours(p){
    var A = sizingWhatIf.account;
    var sz = p && p.sizing, c = (p && p.contract) || {};
    if (!A || !sz || sz.weight == null) return '';
    var perContract = (c.maxLoss != null ? Number(c.maxLoss) : Number(c.mid != null ? c.mid : c.last)) * 100;
    if (!(perContract > 0)) return '';
    var stopFrac = sz.riskToStopPct == null ? 0.5 : (Number(sz.riskToStopPct) > 1 ? Number(sz.riskToStopPct) / 100 : Number(sz.riskToStopPct));
    var n;
    if (sizingWhatIf.riskPct){
      var riskPerContract = perContract * (stopFrac > 0 ? stopFrac : 1);
      n = Math.floor((sizingWhatIf.riskPct / 100 * A) / riskPerContract);
    } else n = Math.floor(sz.weight * A / perContract);
    if (!(n >= 0) || !isFinite(n)) return '';
    var cost = n * perContract, atStop = cost * stopFrac;
    var usd = function(v){ return '$' + Math.round(v).toLocaleString(); };
    return 'On your ' + usd(A) + (sizingWhatIf.riskPct ? ' at ' + sizingWhatIf.riskPct + '% risk' : '') + ': ' +
      (n >= 1 ? n + (n === 1 ? ' contract' : ' contracts') + ' (≈' + usd(cost) + (c.structure === 'credit_vertical' ? ' max loss' : ' premium') + ' · −' + usd(atStop) + ' at the stop)' : 'cannot buy 1 contract');
  }

  // ---- Open picks Book risk: long vs short exposure by sector group ---------
  function bookExposureBarsHtml(groups, usd){
    var rows = Object.keys(groups || {}).map(function(k){ return { name: k, a: Math.round(groups[k].longUsd || 0), b: Math.round(groups[k].shortUsd || 0) }; });
    return sectorSplitBarsHtml(rows, { title: 'Long vs short exposure by sector group', aLabel: 'long delta $', bLabel: 'short delta $', fmt: usd,
      key: 'open-picks.bookSplit', defaultOpen: true, note: 'Calls carry long stock exposure, puts short; a group with both is partly hedged, one bar alone is a one-way bet.' });
  }
`;
}

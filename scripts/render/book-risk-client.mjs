// Book risk v2 (2026-11-23): the Owner "Book risk" panel on Open picks, for
// every open trade the Webull paper account carries (Top Picks and every
// strategy engine, options and shares) at the size the account holds.
//
// The math is lib/book-risk.mjs (pasted with toString, the option pricer and
// greeks passed in), the four past sell-offs are lib/book-risk-crashes.mjs
// (scripts/book-risk-crashes.mjs). Reads only files the site already has:
// market-days.json (public, the last year's daily moves), market-analysis.json
// (Owner, the What-if sensitivities, reused from Market analysis when it is
// loaded) and calendar.json (the expiry ladder). Sizes come from the Webull
// ledger the page already reads (opWb, engines-client.mjs). Display only:
// nothing here reaches a pick, a grade, an engine, the mirror or a record.
// Pasted inside the app.js IIFE (ES5).
import { bookRiskFactory } from '../../lib/book-risk.mjs';
import { BOOK_CRASHES } from '../../lib/book-risk-crashes.mjs';

export function renderBookRiskJs() {
  return `
  // --- Book risk (Owner, 2026-11-07; v2 2026-11-23) ---------------------------
  // The open book as one position: every open Top Picks and engine trade at
  // the size the Webull paper account holds, its stock exposure (plain and in
  // S&P 500 dollars), decay and volatility exposure, a bad day two ways and in
  // a crisis, who carries the risk, four past sell-offs and the Market analysis
  // What-if presets replayed on it, exposure by sector group and an expiry
  // ladder with the reports and Fed / CPI / jobs dates before each expiry.
  var bookCal = { data: null, loading: false };
  function bookLoadCalendar(){
    if (bookCal.data || bookCal.loading) return;
    bookCal.loading = true;
    fetch(dataUrl('calendar.json'), { cache: 'no-cache' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
      .then(function(j){ bookCal.loading = false; bookCal.data = j && Array.isArray(j.events) ? j : { events: [] }; bookRerender(); });
  }
  var BOOK_RISK = (${bookRiskFactory.toString()})({ price: stratBsPrice, greeks: greeks, r: RFR });
  var BOOK_CRASHES = ${JSON.stringify(BOOK_CRASHES)};
  var bookData = { days: null, daysAt: null, daysLoading: false, daysError: null, sens: null, sensLoading: false, sensTried: false, memo: null, memoKey: '' };
  function bookRerender(){ var pane = $('page-pane-open-picks'); if (pane && !pane.hidden && typeof renderOpenPicks === 'function') renderOpenPicks(); }
  function bookLoadDays(){
    if (bookData.days || bookData.daysLoading || bookData.daysError) return;
    bookData.daysLoading = true;
    fetch(dataUrl('market-days.json'), { cache: 'no-cache' }).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(j){ bookData.days = BOOK_RISK.seriesFrom(j); bookData.daysAt = j && j.builtAtIso || null; if (!bookData.days) bookData.daysError = 'empty'; })
      .catch(function(e){ bookData.daysError = String((e && e.message) || e || 'failed'); })
      .then(function(){ bookData.daysLoading = false; bookRerender(); });
  }
  // The What-if sensitivities: Market analysis' own copy when it is loaded,
  // else one read of the same Owner file.
  function bookSens(){
    var eng = typeof marketState !== 'undefined' && marketState.data && marketState.data.scenarioEngine;
    var list = eng && Array.isArray(eng.sensitivities) ? eng.sensitivities : bookData.sens;
    if (list) return list;
    if (!bookData.sensTried && !bookData.sensLoading){
      bookData.sensLoading = true; bookData.sensTried = true;
      fetch(dataUrl('market-analysis.json'), { cache: 'no-cache' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
        .then(function(j){ var e = j && j.scenarioEngine; bookData.sens = e && Array.isArray(e.sensitivities) ? e.sensitivities : []; bookData.sensLoading = false; bookRerender(); });
    }
    return null;
  }
  function bookSpot(sym, last, entry){ return Number(last) || Number(SPOTS && SPOTS[sym]) || Number(entry) || 0; }
  // One record trade -> the position lib/book-risk.mjs prices, sized by what
  // the Webull paper account holds (BOOK_RISK.positionOf / sizeOf, shared with
  // the MCP's get_book_exposure).
  function bookPosition(o, src, isEngine){
    var wb = typeof opWb !== 'undefined' ? opWb : null;
    return BOOK_RISK.positionOf(o, src, isEngine, { ledger: wb && wb.by ? wb.by : null, spot: bookSpot, yrs: posYrs, tradeId: tlTradeId });
  }
  // A missing implied volatility: the stock's own realized volatility over the
  // year (x 1.1), else 45%. Flagged on the position.
  function bookFillIv(pos, days){
    pos.forEach(function(p){
      p.legs.forEach(function(l){
        if (l.iv > 0) return;
        var x = days && days.bySym[p.symbol], v = null;
        if (x){ var s = 0, s2 = 0, n = 0; x.forEach(function(r){ if (r != null){ s += r; s2 += r * r; n++; } }); if (n > 30){ var m = s / n; v = Math.sqrt(Math.max(0, s2 / n - m * m) * 252) * 1.1; } }
        l.iv = v > 0.05 ? v : 0.45; p.ivEst = true;
      });
    });
  }
  function bookUsd(v){ var a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'K' : Math.round(a).toLocaleString()); }
  function bookPct(v, d){ var n = Number(v); if (!isFinite(n)) return '—'; return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(d == null ? 0 : d) + '%'; }
  function bookDay(s){ var d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); return isFinite(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : String(s || ''); }
  var BOOK_SKIP_LABEL = { missed: 'missed at Webull', 'not-bought': 'not bought at Webull', closed: 'already closed at Webull', shared: 'held by another trade on the same contract', 'no-price': 'no price', 'no-expiry': 'no expiry', 'no-contract': 'no contract' };
  function bookRiskHtml(open, engOpen){
    if (!HAS_OWNER_ACCESS) return '';
    var pos = [], skipped = {};
    function add(r){ if (r.skip){ skipped[r.skip] = (skipped[r.skip] || 0) + 1; return; } pos.push(r); }
    (open || []).forEach(function(o){ add(bookPosition(o, 'Top Picks', false)); });
    (engOpen || []).forEach(function(t){ add(bookPosition(t, t.madeBy || (typeof engName === 'function' ? engName(t.engine) : String(t.engine || 'Engine')), true)); });
    if (!pos.length) return '';
    bookLoadCalendar(); bookLoadDays();
    var isOpen = VIEWS.get('open-picks.book', true);
    var sens = isOpen ? bookSens() : null;
    bookFillIv(pos, bookData.days);
    var G = pos.map(BOOK_RISK.greeksOf);
    var netDelta = 0, grossDelta = 0, theta = 0, vega = 0, value = 0, groups = {};
    pos.forEach(function(p, i){
      var g = G[i];
      netDelta += g.deltaUsd; grossDelta += Math.abs(g.deltaUsd); theta += g.thetaUsd; vega += g.vegaUsd; value += g.valueUsd;
      var grp = sectorGroupOf(p.symbol) || 'Other';
      var b = groups[grp] = groups[grp] || { delta: 0, n: 0, calls: 0, puts: 0, shares: 0, longUsd: 0, shortUsd: 0 };
      b.delta += g.deltaUsd; b.n++; if (p.side === 'put') b.puts++; else if (p.side === 'shares') b.shares++; else b.calls++;
      if (g.deltaUsd >= 0) b.longUsd += g.deltaUsd; else b.shortUsd += -g.deltaUsd;
    });
    var key = pos.map(function(p){ return p.id + ':' + p.basis + ':' + (p.kind === 'shares' ? p.shares : p.legs[0].q) + ':' + p.S; }).join('|') + '#' + (bookData.daysAt || '') + '#' + (sens ? sens.length : 'x');
    var A = bookData.memoKey === key ? bookData.memo : null;
    if (!A && bookData.days){
      var crisis = BOOK_CRASHES.windows.filter(function(w){ return w.id === 'covid-2020'; })[0];
      A = BOOK_RISK.analyze(pos, bookData.days, { crisisRho: crisis ? crisis.corr : null });
      if (A.ok){
        A.replays = BOOK_CRASHES.windows.map(function(w){ return BOOK_RISK.replay(pos, w, A.betas); });
        if (sens && sens.length && typeof SCENARIO_IMPACT !== 'undefined'){
          var bySym = {}; sens.forEach(function(r){ if (r && r.symbol) bySym[r.symbol] = r; });
          A.whatIf = SCENARIO_IMPACT.PRESETS.map(function(pr){ return BOOK_RISK.whatIf(pos, pr, bySym, SCENARIO_IMPACT.impact, A.betas); });
        }
      }
      bookData.memo = A; bookData.memoKey = key;
    }
    var BS = BOOK_RISK.bySymbol(pos, G, A && A.ok ? A.betas : null);
    var clashRows = BS.rows.filter(function(r){ return r.clash; });
    var spy = Number(SPOTS && SPOTS.SPY);
    var maxAbs = 0;
    Object.keys(groups).forEach(function(k){ if (Math.abs(groups[k].delta) > maxAbs) maxAbs = Math.abs(groups[k].delta); });
    var groupRows = Object.keys(groups).sort(function(a, b){ return Math.abs(groups[b].delta) - Math.abs(groups[a].delta); }).map(function(k){
      var b = groups[k];
      var mix = [b.calls ? b.calls + 'C' : '', b.puts ? b.puts + 'P' : '', b.shares ? b.shares + 'S' : ''].filter(Boolean).join(' · ');
      return '<tr><td>' + escapeHtml(k) + '</td><td class="num">' + b.n + ' <small>(' + mix + ')</small></td><td class="num">' + vtCbarHtml(b.delta / (maxAbs || 1) * 10, 10, bookUsd(b.delta)) + '</td><td class="num">' + (grossDelta ? Math.round(Math.abs(b.delta) / grossDelta * 100) + '%' : '—') + '</td></tr>';
    }).join('');
    var top = pos.map(function(p, i){ return { p: p, g: G[i] }; }).sort(function(a, b){ return Math.abs(b.g.deltaUsd) - Math.abs(a.g.deltaUsd); })[0];
    var betaKpi = A && A.ok ? '<div class="mm-kpi"><span title="Each trade’s delta $ times its stock’s beta to SPY over the last year: the same exposure in S&amp;P 500 dollars.">In S&amp;P 500 dollars</span><b class="' + (A.betaDelta >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(A.betaDelta) + '</b>' + (spy > 0 ? '<small>≈ ' + Math.round(A.betaDelta / spy).toLocaleString() + ' SPY shares</small>' : '') + '</div>' : '';
    var kpis = '<div class="mm-kpis">' +
      '<div class="mm-kpi"><span>Net stock exposure (delta $)</span><b class="' + (netDelta >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(netDelta) + '</b></div>' + betaKpi +
      '<div class="mm-kpi"><span>Gross exposure</span><b>' + bookUsd(grossDelta) + '</b></div>' +
      '<div class="mm-kpi"><span title="What the options lose to time if prices and implied volatility stay where they are (calendar days; shares have none).">Daily time decay</span><b class="' + (theta >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(theta) + '/day</b><small>≈ ' + bookUsd(theta * 7) + ' a week</small></div>' +
      '<div class="mm-kpi"><span title="What the book gains (or loses) if every option’s implied volatility rises one point; falls the same if it drops a point.">Per point of volatility</span><b class="' + (vega >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(vega) + '</b></div>' +
      '<div class="mm-kpi"><span>Largest single name</span><b>' + escapeHtml(top.p.symbol) + ' ' + (grossDelta ? Math.round(Math.abs(top.g.deltaUsd) / grossDelta * 100) + '%' : '') + '</b></div>' +
      '<div class="mm-kpi"><span title="Stocks where one open trade is long the stock and another is short it, so part of each cancels the other.">Opposite bets</span><b' + (clashRows.length ? ' class="sig-neg"' : '') + '>' + (clashRows.length ? clashRows.length + ' stock' + (clashRows.length === 1 ? '' : 's') : 'None') + '</b>' + (clashRows.length ? '<small>' + escapeHtml(clashRows.map(function(r){ return r.symbol; }).join(', ')) + '</small>' : '') + '</div>' +
    '</div>';
    var riskHtml;
    if (!A){
      riskHtml = '<p class="hint">' + (bookData.daysError ? (bookData.daysError === 'empty' ? 'The file of last year’s daily moves has no moves in it' : 'The last year’s daily moves could not be read (' + escapeHtml(bookData.daysError) + ')') + ', so the bad-day estimates and crash replays are not shown.' : 'Loading the last year’s daily moves for the bad-day estimates and crash replays…') + '</p>';
    } else if (!A.ok){
      riskHtml = '<p class="hint">The bad-day estimates need at least ' + BOOK_RISK.MIN_DAYS + ' days of moves with SPY; the file has fewer.</p>';
    } else {
      riskHtml = bookBadDayHtml(A, value) + bookWhoHtml(pos, G, A) + bookReplaysHtml(A, value, sens);
    }
    var ladder = bookLadderHtml(pos, G);
    var notes = [];
    var basisN = {}; pos.forEach(function(p){ basisN[p.basis] = (basisN[p.basis] || 0) + 1; });
    notes.push('Sizes are what the Webull paper account holds: the filled quantity' + (basisN.pending ? ', the size asked for while an order still works (' + basisN.pending + ')' : '') + (basisN.record || basisN['not-sent'] ? ', and the record’s own size for ' + ((basisN.record || 0) + (basisN['not-sent'] || 0)) + ' trade' + ((basisN.record || 0) + (basisN['not-sent'] || 0) === 1 ? '' : 's') + ' the ledger has no row for' + (basisN.record ? ' (the ledger is still loading or could not be read)' : '') : '') + '.');
    var sk = Object.keys(skipped).map(function(k){ return skipped[k] + ' ' + (BOOK_SKIP_LABEL[k] || k); });
    var still = typeof opWebullOnly === 'function' ? opWebullOnly(open, engOpen).length : 0;
    if (still) sk.push(still + ' still working at Webull after the record closed (listed below)');
    if (sk.length) notes.push('Left out: ' + sk.join(', ') + '.');
    var est = pos.filter(function(p){ return p.ivEst; }).length;
    if (est) notes.push(est + ' option' + (est === 1 ? '' : 's') + ' had no implied volatility on the record; the stock’s own swings over the year stand in.');
    if (A && A.ok && A.proxied.length) notes.push(A.proxied.join(', ') + (A.proxied.length === 1 ? ' has' : ' have') + ' no daily moves on file (not a tracked name), so ' + (A.proxied.length === 1 ? 'it moves' : 'they move') + ' one for one with the S&P 500 in the bad-day estimates; the past sell-offs use each fund’s own move.');
    if (A && A.ok && A.gaps.length) notes.push(A.gaps.join(', ') + ' missed more than five days of the year; ' + (A.gaps.length === 1 ? 'its' : 'their') + ' missing days move by beta times the S&P 500.');
    notes.push('Delta $ is the stock-equivalent position: if every stock rose 1%, the book would gain about 1% of it. Options are priced with Black-Scholes at each trade’s implied volatility at entry and the latest price.');
    return '<details class="accuracy-advanced book-risk"' + (isOpen ? ' open' : ' data-book-lazy') + ' data-book-risk><summary class="accuracy-advanced-summary">Book risk: the paper account <span class="mm-owner-tag">Owner</span> <small class="book-sum-n">' + pos.length + ' trade' + (pos.length === 1 ? '' : 's') + '</small></summary><div class="accuracy-advanced-body">' +
      kpis + bookByStockHtml(BS, !!(A && A.ok)) + riskHtml +
      '<h4 class="pd-h4">Exposure by sector group</h4>' +
      '<div class="acc-tscroll"><table class="acc-qtable book-table" data-nosort><thead><tr><th>Sector group</th><th class="num">Trades</th><th class="num">Net delta $</th><th class="num">Share of gross</th></tr></thead><tbody>' + groupRows + '</tbody></table></div>' +
      bookExposureBarsHtml(groups, bookUsd) + ladder +
      '<p class="hint acc-research-note">' + notes.map(escapeHtml).join(' ') + '</p>' +
    '</div></details>';
  }
  // Exposure by stock (2026-11-25): each stock's trades netted, opposite bets
  // (one trade long the stock, another short it) first, then by size.
  function bookTradeChip(t){
    var unit = t.kind === 'shares' ? ' sh' : ' ' + (t.side === 'put' ? 'put' : 'call') + (t.qty === 1 ? '' : 's') + (t.spread ? ' spread' : '');
    return '<span class="book-pos ' + (t.deltaUsd >= 0 ? 'is-call' : 'is-put') + '" title="' + escapeHtml(t.src) + ': ' + escapeHtml(bookUsd(t.deltaUsd)) + ' delta $">' + escapeHtml(t.src) + ' <small>' + escapeHtml(String(Math.round(t.qty * 100) / 100) + unit) + '</small></span>';
  }
  function bookByStockHtml(BS, hasBeta){
    if (!BS || !BS.rows.length) return '';
    var rows = BS.rows.filter(function(r){ return r.clash; }).concat(BS.rows.filter(function(r){ return !r.clash; }));
    var maxAbs = 0;
    rows.forEach(function(r){ if (Math.abs(r.deltaUsd) > maxAbs) maxAbs = Math.abs(r.deltaUsd); });
    var NETS = { long: 'nets long', short: 'nets short', flat: 'nets about flat' };
    var body = rows.map(function(r){
      var c = r.clash;
      var tag = c ? '<div class="book-sub"><span class="book-clash">Opposite bets</span> long: ' + escapeHtml(c.longBy.join(', ')) + ' · short: ' + escapeHtml(c.shortBy.join(', ')) + ' · ' + bookUsd(c.cancelledUsd) + ' cancels out · ' + NETS[c.nets] + '</div>' : '';
      return '<tr' + (c ? ' class="book-clash-row"' : '') + '><td><b>' + escapeHtml(r.symbol) + '</b>' + tag + '</td><td>' + r.trades.map(bookTradeChip).join(' ') + '</td>' +
        '<td class="num">' + vtCbarHtml(r.deltaUsd / (maxAbs || 1) * 10, 10, bookUsd(r.deltaUsd)) + '</td>' +
        '<td class="num">' + (r.betaUsd != null ? '<span class="' + (r.betaUsd >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(r.betaUsd) + '</span>' : '<span class="crd-dim">' + (hasBeta ? '—' : '…') + '</span>') + '</td>' +
        '<td class="num">' + (r.thetaUsd ? bookUsd(r.thetaUsd) : '<span class="crd-dim">—</span>') + '</td></tr>';
    }).join('');
    return '<h4 class="pd-h4">Exposure by stock</h4>' +
      '<div class="acc-tscroll"><table class="acc-qtable book-table book-by-stock" data-nosort><thead><tr><th>Stock</th><th>Trades (made by, size)</th><th class="num">Net delta $</th><th class="num" title="Net delta $ times the stock’s beta to SPY over the last year">S&amp;P 500 $</th><th class="num">Decay a day</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      (BS.clashes ? '<p class="hint">Opposite bets: one open trade is long the stock and another is short it (shares or a call against a put), so the part that cancels earns nothing on a move but still pays the options’ decay. Each engine trades on its own; this only flags it.</p>' : '');
  }
  function bookBadDayHtml(A, value){
    function row(label, tip, v, c, extra){
      return '<tr><td>' + label + (tip ? ' <span class="book-tip" title="' + escapeHtml(tip) + '">?</span>' : '') + (extra ? '<div class="book-sub">' + extra + '</div>' : '') + '</td><td class="num sig-neg">' + bookUsd(-v) + '</td><td class="num sig-neg">' + bookUsd(-c) + '</td></tr>';
    }
    var w = A.hist.worst;
    var cr = A.crisis;
    var crisisLine = cr.rho != null && cr.rhoNow != null
      ? 'Stocks’ average daily correlation ' + cr.rhoNow.toFixed(2) + ' now, ' + cr.rho.toFixed(2) + ' in the March 2020 crash' + (cr.k > 0 ? '' : ' (already as high, so no change)')
      : 'Too few stocks in the book to measure how they move together';
    if (cr.k > 0 && cr.var95 < A.smooth.var95) crisisLine += '; lower than the smooth estimate because the book’s puts offset its calls and shares more when stocks move together';
    var nEff = A.nEff != null && isFinite(A.nEff) ? (A.nEff > 50 ? 'more than 50' : A.nEff.toFixed(1)) : null;
    return '<h4 class="pd-h4">A bad day</h4>' +
      '<div class="acc-tscroll"><table class="acc-qtable book-table book-var" data-nosort><thead><tr><th>Estimate (one trading day)</th><th class="num">Bad day, 1 in 20</th><th class="num">Worst 1-in-20 days, average</th></tr></thead><tbody>' +
        row('Last year’s days replayed', 'Each of the last ' + A.days + ' trading days’ stock moves applied to today’s trades, every option repriced (implied volatility held, one day of decay). The 1-in-20 loss is the ' + A.hist.tail + 'th worst day; the average is of those ' + A.hist.tail + ' days (value at risk and expected shortfall, 95%).', A.hist.var95, A.hist.cvar95, bookDay(A.from) + ' to ' + bookDay(A.to)) +
        row('Smooth estimate', 'A normal-curve estimate from the covariance of the stocks’ daily returns, Ledoit-Wolf shrunk toward one average correlation (shrinkage ' + Math.round(A.smooth.shrink * 100) + '%) so a year of days gives a stable matrix. Uses delta $ only, so it misses the options’ curve.', A.smooth.var95, A.smooth.cvar95, 'Ledoit-Wolf covariance, shrinkage ' + Math.round(A.smooth.shrink * 100) + '%') +
        row('If stocks move together like March 2020', 'The smooth estimate with the stocks’ pairwise correlations raised to their March 2020 average and each stock’s own swings unchanged. Bond, gold, oil and volatility funds keep their own links, a little weaker.', cr.var95, cr.cvar95, crisisLine) +
      '</tbody></table></div>' +
      '<p class="book-line">Worst day of the last year for today’s book: <b class="sig-neg">' + bookUsd(w.pnl) + '</b> (' + escapeHtml(bookDay(w.date)) + '); best: <b class="sig-pos">' + bookUsd(A.hist.best.pnl) + '</b> (' + escapeHtml(bookDay(A.hist.best.date)) + ').' +
        (nEff ? ' The book swings like ' + nEff + ' independent bets of its size.' : '') +
        (value > 0 ? ' Book value now ' + bookUsd(value) + '.' : '') + '</p>';
  }
  // Who carries the risk: each engine's (and Top Picks') share of the smooth
  // estimate, and the names that carry the most.
  function bookWhoHtml(pos, G, A){
    var src = {};
    pos.forEach(function(p, i){
      var s = src[p.src] = src[p.src] || { n: 0, delta: 0, beta: 0, share: 0 };
      s.n++; s.delta += G[i].deltaUsd; s.beta += G[i].deltaUsd * (A.betas[p.symbol] != null ? A.betas[p.symbol] : 1); s.share += A.share.byPos[i] || 0;
    });
    var keys = Object.keys(src).sort(function(a, b){ return Math.abs(src[b].share) - Math.abs(src[a].share); });
    var rows = keys.map(function(k){ var s = src[k]; return '<tr><td>' + escapeHtml(k) + '</td><td class="num">' + s.n + '</td><td class="num">' + bookUsd(s.delta) + '</td><td class="num">' + bookUsd(s.beta) + '</td><td class="num">' + vtCbarHtml(s.share * 10, 10, bookPct(s.share)) + '</td></tr>'; }).join('');
    var names = A.symbols.map(function(s){ return { s: s, v: A.share.bySym[s] || 0 }; }).sort(function(a, b){ return Math.abs(b.v) - Math.abs(a.v); }).slice(0, 6)
      .map(function(x){ return '<span class="book-pos ' + (x.v >= 0 ? 'is-put' : 'is-call') + '" title="Share of the book’s day-to-day risk; a negative share is a hedge">' + escapeHtml(x.s) + ' ' + bookPct(x.v) + '</span>'; }).join(' ');
    return '<h4 class="pd-h4">Who carries the risk</h4>' +
      '<div class="acc-tscroll"><table class="acc-qtable book-table" data-nosort><thead><tr><th>Made by</th><th class="num">Trades</th><th class="num">Net delta $</th><th class="num" title="Delta $ times each stock’s beta to SPY">S&amp;P 500 $</th><th class="num" title="Share of the smooth estimate’s day-to-day risk (adds to 100%; a negative share offsets the rest)">Share of risk</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="book-line">Names carrying the most risk: ' + names + '</p>';
  }
  function bookReplaysHtml(A, value, sens){
    function hit(r){ return r.rows.slice(0, 3).filter(function(x){ return x.pnl < 0; }).map(function(x){ return '<span class="book-hit">' + escapeHtml(x.symbol) + ' ' + bookUsd(x.pnl) + ' <small>' + escapeHtml(x.src) + '</small></span>'; }).join(' ') || '—'; }
    function pctOf(v){ return value > 0 ? ' <small>' + bookPct(v / value) + ' of book</small>' : ''; }
    var crash = A.replays.map(function(r){
      return '<tr><td><b>' + escapeHtml(r.label) + '</b><div class="book-sub">' + escapeHtml(bookDay(r.from)) + ' to ' + escapeHtml(bookDay(r.to)) + ': S&amp;P 500 ' + bookPct(r.spy, 1) + ', options’ volatility ' + (r.ivAdd >= 0 ? '+' : '−') + Math.round(Math.abs(r.ivAdd) * 100) + ' pts' + (r.viaBeta ? '; ' + r.viaBeta + ' trade' + (r.viaBeta === 1 ? '' : 's') + ' on a stock not listed then moved by beta' : '') + '</div></td><td class="num ' + (r.total >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(r.total) + pctOf(r.total) + '</td><td>' + hit(r) + '</td></tr>';
    }).join('');
    var wi = '';
    if (A.whatIf && A.whatIf.length){
      wi = A.whatIf.map(function(r){
        return '<tr><td>' + escapeHtml(r.label) + (r.viaBeta ? '<div class="book-sub">' + r.viaBeta + ' without a sensitivity, moved by beta</div>' : '') + '</td><td class="num ' + (r.total >= 0 ? 'sig-pos' : 'sig-neg') + '">' + bookUsd(r.total) + pctOf(r.total) + '</td><td>' + hit(r) + '</td></tr>';
      }).join('');
      wi = '<tr class="book-split"><th colspan="3">What if (the Market analysis presets)</th></tr>' + wi;
    } else if (!sens || bookData.sensLoading) wi = '<tr class="book-split"><th colspan="3">What if: <small>loading the Market analysis sensitivities…</small></th></tr>';
    return '<h4 class="pd-h4">Past sell-offs replayed on today’s book</h4>' +
      '<div class="acc-tscroll"><table class="acc-qtable book-table" data-nosort><thead><tr><th>Sell-off, all at once</th><th class="num">Book result</th><th>Hit hardest</th></tr></thead><tbody>' + crash + wi + '</tbody></table></div>' +
      '<p class="hint">Each stock’s own move over the window (adjusted close to close), applied at once to today’s trades, with every option’s implied volatility raised by the VIX’s rise over the window. A stock that was not listed then moves by its beta times the S&amp;P 500. The What-if rows use the same shock rule as Market analysis. A replay, not a forecast.</p>';
  }
  function bookLadderHtml(pos, G){
    var byExp = {};
    pos.forEach(function(p, i){ if (p.kind !== 'option') return; var k = new Date(p.exp * 1000).toISOString().slice(0, 10); (byExp[k] = byExp[k] || []).push({ p: p, g: G[i] }); });
    if (!Object.keys(byExp).length) return '';
    var today = new Date().toISOString().slice(0, 10);
    var events = bookCal.data ? bookCal.data.events || [] : null;
    function macroBefore(exp){
      if (!events) return null;
      var seen = {};
      return events.filter(function(e){
        if (!e || !e.date || e.date < today || e.date > exp) return false;
        if (e.type === 'fomc') return true;
        return e.type === 'macro' && /^(cpi-yoy|core-cpi-yoy|nfp|ppi-yoy|pce-yoy|core-pce-yoy)$/.test(String(e.subtype || ''));
      }).filter(function(e){ var key = e.type + e.date; if (seen[key]) return false; seen[key] = 1; return true; })
        .map(function(e){ return (e.type === 'fomc' ? 'Fed' : /cpi/.test(e.subtype) ? 'CPI' : /pce/.test(e.subtype) ? 'PCE' : /ppi/.test(e.subtype) ? 'PPI' : 'Jobs') + ' ' + e.date.slice(5); });
    }
    function earningsBefore(sym, exp){
      if (!events) return null;
      var hit = events.filter(function(e){ return e && e.type === 'earnings' && e.symbol === sym && e.date >= today && e.date <= exp; })[0];
      return hit ? hit.date.slice(5) : '';
    }
    var rows = Object.keys(byExp).sort().map(function(exp){
      var list = byExp[exp];
      var th = list.reduce(function(s, r){ return s + r.g.thetaUsd; }, 0);
      var days = Math.max(0, Math.round((Date.parse(exp + 'T20:00:00Z') - Date.now()) / 86400000));
      var macro = macroBefore(exp);
      return '<tr><td><b>' + escapeHtml(exp.slice(5)) + '</b> <small>' + days + 'd</small></td><td>' + list.map(function(r){
        var e = earningsBefore(r.p.symbol, exp);
        return '<span class="book-pos ' + (r.p.side === 'put' ? 'is-put' : 'is-call') + '" title="' + escapeHtml(r.p.src) + '">' + escapeHtml(r.p.symbol) + (e ? ' <small title="Reports before this expiry">E ' + escapeHtml(e) + '</small>' : '') + '</span>';
      }).join(' ') + '</td><td class="num">' + bookUsd(th) + '/day</td><td>' + (macro == null ? '<small class="muted">Loading…</small>' : macro.length ? macro.map(function(m){ return '<span class="book-ev">' + escapeHtml(m) + '</span>'; }).join(' · ') : '<small class="muted">None</small>') + '</td></tr>';
    }).join('');
    return '<h4 class="pd-h4">Expiry ladder</h4><div class="acc-tscroll"><table class="acc-qtable book-table" data-nosort><thead><tr><th>Expiry</th><th>Trades (E = reports first)</th><th class="num">Decay</th><th>Fed, CPI, jobs before expiry</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  document.addEventListener('toggle', function(e){
    var d = e.target;
    // A panel drawn closed skipped the What-if read; draw it again once when
    // it is opened. A panel drawn open fires this event too as it is
    // inserted, so it must not redraw (that would loop).
    if (d && d.hasAttribute && d.hasAttribute('data-book-risk')){ VIEWS.set('open-picks.book', !!d.open); if (d.open && d.hasAttribute('data-book-lazy')) bookRerender(); }
  }, true);
`;
}

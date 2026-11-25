// Book risk v2 (2026-11-23): the risk math behind the Owner "Book risk" panel
// on Open picks, for every open trade the Webull paper account carries (Top
// Picks and every strategy engine, options and shares, at the size held).
//
//   exposure   delta $ (the stock-equivalent position), beta-weighted delta
//              (what it is in S&P 500 dollars), vega (gain or loss per point
//              of implied volatility) and daily time decay.
//   bad day    1-day loss on a bad day (1 in 20, "value at risk") and the
//              average of the worst 1-in-20 days ("expected shortfall" or
//              CVaR), two ways: (a) last year's daily moves replayed on today's
//              trades with every option repriced, (b) a smooth estimate from a
//              Ledoit-Wolf covariance of the stocks' daily returns (shrunk
//              toward one average correlation, so 30-40 names on a year of days
//              give a stable matrix).
//   crisis     (b) again, with the stocks moving together as much as they did
//              in the March 2020 crash (their average pairwise correlation in
//              that window), each stock's own swings unchanged; bond, gold,
//              oil and volatility funds keep their own links, a little weaker.
//   share      each trade's and each engine's share of the day-to-day risk
//              (Euler contributions of the smooth estimate; they add to 100%,
//              and a hedge shows as a negative share).
//   replays    four past sell-offs applied all at once to today's trades: each
//              stock's own move in the window where it traded (else its beta
//              times SPY's move) and every option repriced with its implied
//              volatility up by the VIX's rise over the window.
//   what if    the Market analysis What-if presets (hot CPI, growth scare, ...)
//              through the same shock rule the scenario layer uses.
//   by stock   (2026-11-25) each stock's trades netted, with an "opposite
//              bets" tag when one trade is long the stock and another short.
//
// Measurement only: nothing here reads into a pick, a grade, an engine, a gate,
// the Webull mirror or a record. No AI, no fetch. ES5 and self-contained so
// app-js.mjs can paste the factory with toString(); the option pricer and the
// greeks come in as deps (stratBsPrice / greeks in app.js, lib/greeks.mjs in
// the smoke test), so Black-Scholes is not written a fourth time.
export function bookRiskFactory(deps) {
  var D = deps || {};
  var price = D.price, greeksFn = D.greeks;
  var RATE = isFinite(Number(D.r)) && D.r != null ? Number(D.r) : 0.045;
  // One-sided 95%: the z value and the normal tail mean phi(z) / 0.05.
  var Z95 = 1.6448536, TAIL95 = 2.0627128;
  var MIN_DAYS = 60;
  var DAY_YRS = 1 / 365.25;
  // Funds whose crash links are not the stocks' (they keep their own).
  var NON_EQUITY = { TLT: 1, IEF: 1, IEI: 1, SHY: 1, BIL: 1, TIP: 1, GLD: 1, SLV: 1, USO: 1, UVXY: 1, DBC: 1, UNG: 1, CPER: 1, UUP: 1, FXY: 1, DBA: 1 };

  function num(x){ if (x == null || x === '' || typeof x === 'boolean') return null; var n = Number(x); return isFinite(n) ? n : null; }
  function intrinsic(type, S, K){ return type === 'put' ? Math.max(0, K - S) : Math.max(0, S - K); }
  function optPrice(type, S, K, T, iv){
    if (!(K > 0)) return 0;
    if (!(S > 0)) return intrinsic(type, 0, K);
    if (!(T > 0)) return intrinsic(type, S, K);
    var p = price(type, S, K, T, Math.max(0.01, iv), RATE);
    return p != null && isFinite(p) ? p : intrinsic(type, S, K);
  }
  // A position's value at a spot, years left and an implied-volatility add.
  function valueAt(p, S, T, ivAdd){
    if (p.kind === 'shares') return p.shares * S;
    var v = 0;
    for (var i = 0; i < p.legs.length; i++){
      var l = p.legs[i];
      v += l.q * 100 * optPrice(l.type, S, l.K, T, l.iv + (ivAdd || 0));
    }
    return v;
  }
  function pnlOf(p, move, dtYears, ivAdd){
    var S1 = Math.max(0, p.S * (1 + move));
    return valueAt(p, S1, p.T - (dtYears || 0), ivAdd || 0) - valueAt(p, p.S, p.T, 0);
  }
  function greeksOf(p){
    if (p.kind === 'shares') return { deltaUsd: p.shares * p.S, thetaUsd: 0, vegaUsd: 0, valueUsd: p.shares * p.S };
    var d = 0, t = 0, v = 0;
    for (var i = 0; i < p.legs.length; i++){
      var l = p.legs[i];
      var g = p.T > 0 ? greeksFn(l.type, p.S, l.K, p.T, Math.max(0.01, l.iv), RATE) : null;
      if (g){ d += g.delta * l.q * 100 * p.S; t += g.thetaDay * l.q * 100; v += g.vega * l.q * 100; }
      else if (!(p.T > 0)){ var itm = l.type === 'put' ? (p.S < l.K ? -1 : 0) : (p.S > l.K ? 1 : 0); d += itm * l.q * 100 * p.S; }
    }
    return { deltaUsd: d, thetaUsd: t, vegaUsd: v, valueUsd: valueAt(p, p.S, p.T, 0) };
  }

  // market-days.json -> daily returns (decimal) per symbol on shared dates.
  function seriesFrom(md){
    if (!md || !md.dates || !md.moves || typeof md.moves !== 'object') return null;
    var out = {};
    for (var s in md.moves){
      if (!Object.prototype.hasOwnProperty.call(md.moves, s) || !md.moves[s] || !md.moves[s].length) continue;
      out[s] = md.moves[s].map(function(v){ var n = num(v); return n == null ? null : n / 10000; });
    }
    return { dates: md.dates.slice(), bySym: out };
  }
  function betaOf(x, m){
    var xs = [], ms = [];
    for (var i = 0; i < m.length; i++) if (x[i] != null && m[i] != null){ xs.push(x[i]); ms.push(m[i]); }
    if (xs.length < MIN_DAYS) return null;
    var mx = 0, mm = 0, k;
    for (k = 0; k < xs.length; k++){ mx += xs[k]; mm += ms[k]; }
    mx /= xs.length; mm /= ms.length;
    var c = 0, vm = 0;
    for (k = 0; k < xs.length; k++){ c += (xs[k] - mx) * (ms[k] - mm); vm += (ms[k] - mm) * (ms[k] - mm); }
    return vm > 0 ? c / vm : null;
  }
  // One clean return series per symbol: its own move where it has one, else
  // its beta times SPY's (a name listed part way through the year, a missing
  // day); a symbol the file does not carry at all moves with SPY (beta 1).
  function cleanSeries(syms, data){
    var spy = data.bySym.SPY;
    var out = {}, betas = {}, proxied = [], gaps = [];
    for (var i = 0; i < syms.length; i++){
      var s = syms[i], x = data.bySym[s];
      if (!x){ proxied.push(s); betas[s] = 1; out[s] = spy.map(function(v){ return v == null ? 0 : v; }); continue; }
      var b = s === 'SPY' ? 1 : betaOf(x, spy);
      var holes = 0;
      if (b == null){ b = 1; }
      betas[s] = b;
      out[s] = x.map(function(v, k){ if (v != null) return v; holes++; return spy[k] == null ? 0 : b * spy[k]; });
      if (holes > 5) gaps.push(s);
    }
    return { r: out, betas: betas, proxied: proxied, gaps: gaps };
  }

  // Ledoit-Wolf (2004, "Honey, I shrunk the sample covariance matrix"):
  // shrink the sample covariance toward the constant-correlation target (every
  // pair at the average correlation, own variances kept). X: T rows x n
  // columns, already demeaned. Returns { cov, delta } (delta 0-1 = how far it
  // shrank). The identity target would pull stock correlations toward zero and
  // understate a long book's risk, so it is not used here.
  function lwShrink(X){
    var T = X.length, n = X[0].length, i, j, t;
    var S = [];
    for (i = 0; i < n; i++){ S.push([]); for (j = 0; j < n; j++) S[i].push(0); }
    for (t = 0; t < T; t++) for (i = 0; i < n; i++) for (j = i; j < n; j++) S[i][j] += X[t][i] * X[t][j] / T;
    for (i = 0; i < n; i++) for (j = 0; j < i; j++) S[i][j] = S[j][i];
    if (n < 2) return { cov: S, delta: 0 };
    var sd = S.map(function(r, k){ return Math.sqrt(Math.max(0, r[k])); });
    var rbar = 0, pairs = 0;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) if (sd[i] > 0 && sd[j] > 0){ rbar += S[i][j] / (sd[i] * sd[j]); pairs++; }
    rbar = pairs ? rbar / pairs : 0;
    var F = S.map(function(r, a){ return r.map(function(v, b){ return a === b ? v : rbar * sd[a] * sd[b]; }); });
    // pi: sum of asymptotic variances of the sample entries; rho: the part of
    // that shared with the target; gamma: target misfit.
    var pi = 0, rho = 0, gam = 0;
    var piMat = [];
    for (i = 0; i < n; i++){ piMat.push([]); for (j = 0; j < n; j++) piMat[i].push(0); }
    for (t = 0; t < T; t++) for (i = 0; i < n; i++) for (j = i; j < n; j++){ var e = X[t][i] * X[t][j] - S[i][j]; piMat[i][j] += e * e / T; }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++){ var pv = j >= i ? piMat[i][j] : piMat[j][i]; pi += pv; gam += (F[i][j] - S[i][j]) * (F[i][j] - S[i][j]); }
    for (i = 0; i < n; i++) rho += piMat[i][i];
    for (i = 0; i < n; i++) for (j = 0; j < n; j++){
      if (i === j || !(sd[i] > 0) || !(sd[j] > 0)) continue;
      var thII = 0, thJJ = 0;
      for (t = 0; t < T; t++){
        var cij = X[t][i] * X[t][j] - S[i][j];
        thII += (X[t][i] * X[t][i] - S[i][i]) * cij / T;
        thJJ += (X[t][j] * X[t][j] - S[j][j]) * cij / T;
      }
      rho += rbar / 2 * (sd[j] / sd[i] * thII + sd[i] / sd[j] * thJJ);
    }
    var delta = gam > 0 ? Math.max(0, Math.min(1, (pi - rho) / gam / T)) : 1;
    return { cov: S.map(function(r, a){ return r.map(function(v, b){ return delta * F[a][b] + (1 - delta) * v; }); }), delta: delta, rbar: rbar };
  }
  function quad(w, C){ var s = 0; for (var i = 0; i < w.length; i++) for (var j = 0; j < w.length; j++) s += w[i] * C[i][j] * w[j]; return s; }
  function matVec(C, w){ return C.map(function(r){ var s = 0; for (var j = 0; j < w.length; j++) s += r[j] * w[j]; return s; }); }
  // The crisis matrix: a common crash factor added to the stocks only, then
  // each stock scaled back to its own variance. Stock pairs move to
  // (rho + k) / (1 + k); links to bond, gold, oil and volatility funds shrink by
  // 1 / sqrt(1 + k). Both steps keep the matrix valid (positive semidefinite).
  function crisisCov(C, syms, target){
    var eq = syms.map(function(s){ return !NON_EQUITY[s]; });
    var sd = C.map(function(r, i){ return Math.sqrt(Math.max(0, r[i])); });
    var sum = 0, n = 0;
    for (var i = 0; i < syms.length; i++) for (var j = i + 1; j < syms.length; j++) if (eq[i] && eq[j] && sd[i] > 0 && sd[j] > 0){ sum += C[i][j] / (sd[i] * sd[j]); n++; }
    var now = n ? sum / n : null;
    if (now == null || !(target > now) || !(target < 1)) return { cov: C, rhoNow: now, k: 0 };
    var k = (target - now) / (1 - target);
    var g = eq.map(function(e){ return e ? 1 / Math.sqrt(1 + k) : 1; });
    var out = C.map(function(r, a){ return r.map(function(v, b){ return g[a] * g[b] * (v + (eq[a] && eq[b] ? k * sd[a] * sd[b] : 0)); }); });
    return { cov: out, rhoNow: now, k: k };
  }

  // Everything that needs the year of daily moves. positions: normalized by
  // the caller ({ id, symbol, src, kind: 'option' | 'shares', S, T, legs:
  // [{ type, K, q, iv }], shares }). data: seriesFrom(market-days.json).
  // crisisRho: the crash-level average correlation (BOOK_CRASHES covid window).
  function analyze(positions, data, opts){
    opts = opts || {};
    if (!positions || !positions.length) return { ok: false, why: 'none' };
    if (!data || !data.bySym || !data.bySym.SPY) return { ok: false, why: 'no-returns' };
    var spy = data.bySym.SPY;
    var nDays = spy.length;
    if (nDays < MIN_DAYS) return { ok: false, why: 'few-days' };
    var syms = [];
    positions.forEach(function(p){ if (syms.indexOf(p.symbol) < 0) syms.push(p.symbol); });
    var cs = cleanSeries(syms, data);
    var G = positions.map(greeksOf);
    // Exposure per symbol (delta $) and the beta-weighted total.
    var w = syms.map(function(){ return 0; });
    var betaDelta = 0;
    positions.forEach(function(p, i){ w[syms.indexOf(p.symbol)] += G[i].deltaUsd; betaDelta += G[i].deltaUsd * cs.betas[p.symbol]; });
    // Smooth estimate: Ledoit-Wolf covariance of daily returns.
    var X = [], mu = syms.map(function(s){ var a = cs.r[s], m = 0; for (var k = 0; k < a.length; k++) m += a[k]; return m / a.length; });
    for (var t = 0; t < nDays; t++) X.push(syms.map(function(s, j){ return cs.r[s][t] - mu[j]; }));
    var lw = lwShrink(X);
    var sigma = Math.sqrt(Math.max(0, quad(w, lw.cov)));
    var cr = crisisCov(lw.cov, syms, num(opts.crisisRho));
    var sigmaC = Math.sqrt(Math.max(0, quad(w, cr.cov)));
    // Each trade's share of the smooth estimate's risk (Euler: w_s (Cw)_s / s^2,
    // split among the trades on a symbol by their delta $).
    var Cw = matVec(lw.cov, w);
    var bySym = {}, byPos = [], bySrc = {};
    syms.forEach(function(s, j){ bySym[s] = sigma > 0 ? w[j] * Cw[j] / (sigma * sigma) : 0; });
    positions.forEach(function(p, i){
      var j = syms.indexOf(p.symbol);
      var share = w[j] !== 0 ? bySym[p.symbol] * G[i].deltaUsd / w[j] : 0;
      byPos.push(share);
      bySrc[p.src] = (bySrc[p.src] || 0) + share;
    });
    // Diversification: how many independent bets the book swings like.
    var stand = 0;
    syms.forEach(function(s, j){ stand += Math.abs(w[j]) * Math.sqrt(Math.max(0, lw.cov[j][j])); });
    var nEff = sigma > 0 ? (stand / sigma) * (stand / sigma) : null;
    // Last year's days replayed with every option repriced (IV held, one day
    // of time decay).
    var days = [];
    for (var d = 0; d < nDays; d++){
      var tot = 0;
      for (var q = 0; q < positions.length; q++) tot += pnlOf(positions[q], cs.r[positions[q].symbol][d], DAY_YRS, 0);
      days.push({ date: data.dates[d], pnl: tot });
    }
    var sorted = days.slice().sort(function(a, b){ return a.pnl - b.pnl; });
    var kTail = Math.max(1, Math.ceil(nDays * 0.05));
    var tailSum = 0;
    for (var z = 0; z < kTail; z++) tailSum += sorted[z].pnl;
    return {
      ok: true, days: nDays, from: data.dates[0], to: data.dates[nDays - 1],
      greeks: G, symbols: syms, exposure: w, betas: cs.betas, proxied: cs.proxied, gaps: cs.gaps,
      betaDelta: betaDelta,
      smooth: { sigma: sigma, var95: Z95 * sigma, cvar95: TAIL95 * sigma, shrink: lw.delta, rbar: lw.rbar },
      crisis: { sigma: sigmaC, var95: Z95 * sigmaC, cvar95: TAIL95 * sigmaC, rhoNow: cr.rhoNow, rho: num(opts.crisisRho), k: cr.k },
      hist: { var95: Math.max(0, -sorted[kTail - 1].pnl), cvar95: Math.max(0, -tailSum / kTail), tail: kTail, worst: sorted[0], best: sorted[sorted.length - 1] },
      share: { bySym: bySym, byPos: byPos, bySrc: bySrc },
      nEff: nEff
    };
  }

  // A past sell-off applied all at once (instant, no time decay).
  function replay(positions, win, betas){
    var ivAdd = win && win.vix ? (num(win.vix.to) - num(win.vix.from)) / 100 : 0;
    var rows = [], total = 0, own = 0, viaBeta = 0, bySrc = {};
    (positions || []).forEach(function(p){
      var m = win.moves ? num(win.moves[p.symbol]) : null, how = 'own';
      if (m == null){ m = (betas && betas[p.symbol] != null ? betas[p.symbol] : 1) * num(win.spy); how = 'beta'; }
      var v = pnlOf(p, m, 0, ivAdd);
      if (how === 'own') own++; else viaBeta++;
      total += v; bySrc[p.src] = (bySrc[p.src] || 0) + v;
      rows.push({ id: p.id, symbol: p.symbol, src: p.src, move: m, how: how, pnl: v });
    });
    rows.sort(function(a, b){ return a.pnl - b.pnl; });
    return { id: win.id, label: win.label, from: win.from, to: win.to, spy: num(win.spy), ivAdd: ivAdd, total: total, own: own, viaBeta: viaBeta, bySrc: bySrc, rows: rows };
  }
  // A What-if preset through the scenario layer's own shock rule (impact()).
  function whatIf(positions, preset, sensBySym, impact, betas){
    var f = (preset && preset.shocks) || {};
    var ivAdd = (num(f.vixPoints) || 0) / 100, spyPct = num(f.spyPct) || 0;
    var total = 0, rows = [], viaBeta = 0;
    (positions || []).forEach(function(p){
      var row = sensBySym ? sensBySym[p.symbol] : null, m, how = 'model';
      if (row && row.vector && typeof impact === 'function'){ m = num(impact(row.vector, row.annualizedVolPct, f).mid); m = m == null ? 0 : m / 100; }
      else { m = (betas && betas[p.symbol] != null ? betas[p.symbol] : 1) * spyPct / 100; how = 'beta'; viaBeta++; }
      var v = pnlOf(p, m, 0, ivAdd);
      total += v; rows.push({ id: p.id, symbol: p.symbol, src: p.src, move: m, how: how, pnl: v });
    });
    rows.sort(function(a, b){ return a.pnl - b.pnl; });
    return { key: preset && preset.key, label: preset && preset.label, total: total, viaBeta: viaBeta, ivAdd: ivAdd, rows: rows };
  }

  // A missing implied volatility: the stock's own realized volatility over
  // the year (x 1.1), else 45%. Flagged on the position (ivEst). data:
  // seriesFrom(market-days.json) or null. Shared by the panel and the MCP.
  function fillIv(positions, data){
    var n = 0;
    (positions || []).forEach(function(p){
      var est = false;
      p.legs.forEach(function(l){
        if (l.iv > 0) return;
        var x = data && data.bySym ? data.bySym[p.symbol] : null, v = null;
        if (x){ var s = 0, s2 = 0, k = 0; x.forEach(function(r){ if (r != null){ s += r; s2 += r * r; k++; } }); if (k > 30){ var m = s / k; v = Math.sqrt(Math.max(0, s2 / k - m * m) * 252) * 1.1; } }
        l.iv = v > 0.05 ? v : 0.45; est = true;
      });
      if (est){ p.ivEst = true; n++; }
    });
    return n;
  }
  // Time decay over a number of calendar days, repriced (prices and implied
  // volatility held): an option expiring inside the window loses at most what
  // it is worth, where days x daily theta would overstate it.
  function decayOver(p, days){
    if (p.kind !== 'option') return 0;
    return valueAt(p, p.S, Math.max(0, p.T - days * DAY_YRS), 0) - valueAt(p, p.S, p.T, 0);
  }

  // What the paper account holds of a record trade (moved here from the Open
  // picks panel on 2026-11-25 so the MCP's get_book_exposure sizes trades the
  // same way): the Webull ledger's open quantity once it has filled, the size
  // asked for while an order works, the record's own size when the ledger has
  // no row ('not-sent') or could not be read ('record'), and nothing for a
  // trade Webull missed, did not buy, closed, or holds under another trade on
  // the same contract. w: the ledger trade row (ledgerToTestTrades) or null.
  function sizeOf(w, planned, ledgerKnown){
    if (!w) return { n: planned, basis: ledgerKnown ? 'not-sent' : 'record' };
    if (w.fillOutcome === 'shared') return { n: 0, basis: 'shared' };
    var held = Number(w.openQty);
    if (!(w.openQty != null && isFinite(held))) held = Math.max(0, (Number(w.filledQty) || 0) - (Number(w.closedQty) || 0));
    if (held > 0) return { n: held, basis: 'held' };
    if (w.state === 'entering') return { n: Number(w.requestedQty) > 0 ? Number(w.requestedQty) : planned, basis: 'pending' };
    return { n: 0, basis: w.fillOutcome === 'missed' || w.fillOutcome === 'not-bought' ? w.fillOutcome : 'closed' };
  }
  // One record trade (Top Picks open row or engine open trade) -> the position
  // the math prices, or { skip: reason }. env: { ledger: tradeId -> ledger row
  // (null when the ledger is not read), spot(symbol, lastSpot, entrySpot),
  // yrs(expirySec) years to the expiry close, tradeId(topPicksRow) }.
  function positionOf(o, src, isEngine, env){
    var c = o && o.contract; if (!c) return { skip: 'no-contract' };
    var L = env.ledger || null;
    var id = isEngine ? o.tradeId : env.tradeId(o);
    var S = Number(env.spot(o.symbol, o.lastSpot, o.entrySpot)) || 0;
    if (!(S > 0)) return { skip: 'no-price' };
    var w = L ? L[id] || null : null;
    if (c.structure === 'shares'){
      var sz0 = sizeOf(w, Number(c.shares) || 0, !!L);
      if (!(sz0.n > 0)) return { skip: sz0.basis };
      return { id: id, symbol: o.symbol, src: src, side: 'shares', kind: 'shares', S: S, T: 0, legs: [], shares: sz0.n, basis: sz0.basis, trade: o };
    }
    var exp = Number(c.exp || c.expiry);
    if (!(exp > 0)) return { skip: 'no-expiry' };
    if (isEngine && o.shared && o.shared.role === 'follower' && !w) return { skip: 'shared' };
    var side = o.side === 'put' ? 'put' : 'call';
    var planned = isEngine ? (Number(c.qty) > 0 ? Number(c.qty) : 1) : 1;
    var sz = sizeOf(w, planned, !!L);
    if (!(sz.n > 0)) return { skip: sz.basis };
    var legs = [];
    if ((c.structure === 'debit_vertical' || c.structure === 'credit_vertical') && Object.prototype.toString.call(c.legs) === '[object Array]' && c.legs.length > 1){
      c.legs.forEach(function(l){ var K = Number(l.strike), q = Number(l.qty) || 0; if (K > 0 && q) legs.push({ type: l.type || c.optionType || side, K: K, q: q * sz.n, iv: Number(l.iv) > 0 ? Number(l.iv) : null }); });
    } else if (Number(c.strike) > 0) legs.push({ type: c.optionType || side, K: Number(c.strike), q: sz.n, iv: Number(c.iv) > 0 ? Number(c.iv) : null });
    if (!legs.length) return { skip: 'no-contract' };
    return { id: id, symbol: o.symbol, src: src, side: side, kind: 'option', S: S, T: env.yrs(exp), exp: exp, legs: legs, shares: 0, basis: sz.basis, trade: o };
  }

  // Exposure by stock (2026-11-25): every trade on one stock netted (delta $,
  // S&P 500 $ when a beta is known, daily decay, volatility exposure), and an
  // "opposite bets" tag when trades on the same stock point opposite ways (one
  // long the stock, one short it), with the side that wins and how much of the
  // smaller side the larger one cancels. G: greeksOf for each position.
  // betas: analyze().betas, or null while the year of moves is loading.
  // A trade under $1 of delta $ (an option at its last day, far out of the
  // money) does not count as a side, and a stock is tagged only when the
  // smaller side is a real bet: at least $250 of delta $ and a tenth of the
  // larger side (a far out-of-the-money put beside a big share lot is not).
  var CLASH_MIN_USD = 1, CLASH_FLAT = 0.1, CLASH_SIDE_USD = 250, CLASH_SIDE_SHARE = 0.1;
  function bySymbol(positions, G, betas){
    var m = {}, list = [];
    (positions || []).forEach(function(p, i){
      var g = G && G[i]; if (!p || !g) return;
      var r = m[p.symbol];
      if (!r){
        r = m[p.symbol] = { symbol: p.symbol, n: 0, deltaUsd: 0, betaUsd: null, beta: null, thetaUsd: 0, vegaUsd: 0, valueUsd: 0, longUsd: 0, shortUsd: 0, longBy: [], shortBy: [], trades: [], clash: null };
        list.push(r);
      }
      var qty = p.kind === 'shares' ? p.shares : (p.legs && p.legs.length ? Math.abs(p.legs[0].q) : 0);
      r.n++; r.deltaUsd += g.deltaUsd; r.thetaUsd += g.thetaUsd; r.vegaUsd += g.vegaUsd; r.valueUsd += g.valueUsd;
      if (g.deltaUsd >= CLASH_MIN_USD){ r.longUsd += g.deltaUsd; if (r.longBy.indexOf(p.src) < 0) r.longBy.push(p.src); }
      else if (g.deltaUsd <= -CLASH_MIN_USD){ r.shortUsd -= g.deltaUsd; if (r.shortBy.indexOf(p.src) < 0) r.shortBy.push(p.src); }
      r.trades.push({ id: p.id, src: p.src, side: p.side, kind: p.kind, qty: qty, basis: p.basis || null, spread: !!(p.legs && p.legs.length > 1), deltaUsd: g.deltaUsd, thetaUsd: g.thetaUsd });
    });
    var clashes = 0;
    list.forEach(function(r){
      var b = betas ? num(betas[r.symbol]) : null;
      if (b != null){ r.beta = b; r.betaUsd = r.deltaUsd * b; }
      r.trades.sort(function(a, c){ return Math.abs(c.deltaUsd) - Math.abs(a.deltaUsd); });
      var small = Math.min(r.longUsd, r.shortUsd), big = Math.max(r.longUsd, r.shortUsd);
      if (small >= CLASH_SIDE_USD && small >= CLASH_SIDE_SHARE * big){
        var gross = r.longUsd + r.shortUsd;
        clashes++;
        r.clash = {
          nets: Math.abs(r.deltaUsd) < CLASH_FLAT * gross ? 'flat' : r.deltaUsd > 0 ? 'long' : 'short',
          longBy: r.longBy.slice(), shortBy: r.shortBy.slice(),
          cancelledUsd: small,
          cancelledPct: small / big
        };
      }
    });
    list.sort(function(a, c){ return Math.abs(c.deltaUsd) - Math.abs(a.deltaUsd); });
    return { rows: list, clashes: clashes };
  }

  return { analyze: analyze, replay: replay, whatIf: whatIf, greeksOf: greeksOf, bySymbol: bySymbol, sizeOf: sizeOf, positionOf: positionOf, fillIv: fillIv, decayOver: decayOver, valueAt: valueAt, pnlOf: pnlOf, seriesFrom: seriesFrom, lwShrink: lwShrink, crisisCov: crisisCov, betaOf: betaOf, NON_EQUITY: NON_EQUITY, MIN_DAYS: MIN_DAYS };
}

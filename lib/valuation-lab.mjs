// Valuation lab (Owner-only, 2026-11-17).
//
// "What is this stock worth, and why does the market disagree?" Five
// valuation methods on one set of adjustable inputs, blended by weights the
// Owner sets, compared with the market price, with the gap explained:
//
//   1. Cash-flow (DCF): revenue grown for N years, fading to a terminal rate,
//      times a free-cash-flow margin, discounted at a weighted cost of capital
//      built from the 10-year yield, beta and an equity risk premium.
//   2. Earnings path: forward EPS grown three years, sold at an exit P/E,
//      discounted at the cost of equity, plus the dividends on the way.
//   3. Peer multiples: the peer medians from valuation-bands.json (forward
//      P/E, EV/sales, price/sales) applied to this company, with a premium or
//      discount the Owner sets.
//   4. Earnings power (rate-justified): a two-stage payout model whose payout
//      follows from growth and return on equity, so the value moves with rates
//      the way a bond's does. The one cash-flow method that works for banks.
//   5. Street: the analysts' mean target, kept as a reference point.
//
// Macro dials (dollar and oil moves) shift the blend by the stock's own
// measured response from the Market Analysis scenario layer. A 10-year yield
// change flows through every discount rate instead, so rates are never
// counted twice; the measured rate response is shown beside it as a check.
//
// valuationLabFactory() is pure, dependency-free and serialized into app.js
// with toString(), so the page and the bake compute with the same code. Keep
// it free of regex, backslashes, template literals and outside names.
// buildValuationLab() prepares one row of inputs per covered stock at bake
// time from data the build already holds (no fetch, no AI). Display only:
// nothing here feeds a grade, a gate, a pick or the Track Record.

export const VALUATION_LAB_KEY = "valuation-lab.json";
export const VALUATION_LAB_VERSION = 1;

export function valuationLabEnabled(env = process.env) {
  return !/^(?:0|false|off)$/i.test(String(env.VALUATION_LAB ?? "").trim());
}

export function valuationLabFactory() {
  function fin(x) { return typeof x === "number" && isFinite(x); }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function r2(x) { return fin(x) ? Math.round(x * 100) / 100 : null; }
  function r1(x) { return fin(x) ? Math.round(x * 10) / 10 : null; }
  function median(xs) {
    var v = xs.filter(fin).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function copy(o) { var out = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; return out; }

  var METHODS = [
    { key: "dcf", label: "Cash flow (DCF)", short: "Cash flow (DCF)" },
    { key: "earnings", label: "Earnings path", short: "Earnings path" },
    { key: "peers", label: "Peer multiples", short: "Peer multiples" },
    { key: "power", label: "Earnings power (rate-justified)", short: "Earnings power" },
    { key: "street", label: "Street target", short: "Street target" }
  ];

  // Every adjustable input: key, label, unit, step, bounds. Bounds keep the
  // math inside the range where each formula means something.
  var INPUTS = [
    { key: "rf", group: "Rates and risk", label: "10-year Treasury yield", unit: "%", step: 0.05, min: 0, max: 12 },
    { key: "rateShiftBp", group: "Rates and risk", label: "Rate shock on top", unit: "bp", step: 25, min: -300, max: 300 },
    { key: "erp", group: "Rates and risk", label: "Equity risk premium", unit: "%", step: 0.25, min: 1, max: 12 },
    { key: "beta", group: "Rates and risk", label: "Beta", unit: "x", step: 0.05, min: 0.3, max: 3 },
    { key: "creditSpread", group: "Rates and risk", label: "Borrowing spread over Treasuries", unit: "%", step: 0.25, min: 0, max: 10 },
    { key: "g1", group: "Growth", label: "Revenue growth, first year", unit: "%", step: 0.5, min: -30, max: 80 },
    { key: "years", group: "Growth", label: "Years of above-normal growth", unit: "yrs", step: 1, min: 3, max: 10 },
    { key: "gT", group: "Growth", label: "Growth forever after", unit: "%", step: 0.25, min: -2, max: 5 },
    { key: "epsGrowth", group: "Earnings", label: "EPS growth a year (next 3 years)", unit: "%", step: 0.5, min: -30, max: 80 },
    { key: "epsShock", group: "Earnings", label: "Earnings surprise / recession hit", unit: "%", step: 1, min: -60, max: 60 },
    { key: "fcfMargin", group: "Earnings", label: "Free-cash-flow margin today", unit: "%", step: 0.5, min: -50, max: 70 },
    { key: "marginDrift", group: "Earnings", label: "Margin change by end of growth years", unit: "pp", step: 0.5, min: -30, max: 30 },
    { key: "roe", group: "Earnings", label: "Return on equity", unit: "%", step: 0.5, min: 2, max: 80 },
    { key: "exitPE", group: "Multiples", label: "Exit P/E in 3 years", unit: "x", step: 0.5, min: 3, max: 80 },
    { key: "peerPremium", group: "Multiples", label: "Premium (+) or discount (-) to peers", unit: "%", step: 2.5, min: -60, max: 150 },
    { key: "usdPct", group: "Macro", label: "Dollar move", unit: "%", step: 1, min: -15, max: 15 },
    { key: "oilPct", group: "Macro", label: "Oil move", unit: "%", step: 2.5, min: -50, max: 50 }
  ];
  var WEIGHT_KEYS = ["dcf", "earnings", "peers", "power", "street"];

  function boundsOf(key) { for (var i = 0; i < INPUTS.length; i++) if (INPUTS[i].key === key) return INPUTS[i]; return null; }

  // Default inputs from the row the bake prepared. Every default says where
  // it came from so the page can show it.
  function defaults(row) {
    var f = row.facts || {}, m = row.market || {}, p = row.peers || {};
    var src = {};
    var d = {};
    d.rf = fin(m.tenY) ? m.tenY : fin(m.rfr) ? m.rfr : 4.25; src.rf = fin(m.tenY) ? "10-year yield, latest build" : fin(m.rfr) ? "3-month bill rate (10-year missing)" : "fallback";
    d.rateShiftBp = 0; src.rateShiftBp = "none";
    d.erp = 5; src.erp = "long-run US average, about 5%";
    var b = fin(row.sens && row.sens.marketBeta) ? row.sens.marketBeta : f.beta;
    d.beta = fin(b) ? r2(clamp(b, 0.5, 2.5)) : 1; src.beta = fin(row.sens && row.sens.marketBeta) ? "measured vs the S&P 500 (Market Analysis)" : fin(f.beta) ? "Yahoo beta" : "market average";
    d.creditSpread = row.financial ? 1 : fin(f.debtToEquity) && f.debtToEquity > 150 ? 2.5 : 1.5; src.creditSpread = "rule of thumb from leverage";
    var growthCands = [f.revenueGrowthYoy, f.fwdRevenueGrowth, f.growthEstimateCurY].filter(fin);
    var g = median(growthCands);
    d.g1 = fin(g) ? r1(clamp(g, -10, 40)) : 5; src.g1 = growthCands.length ? "median of last year's revenue growth, analysts' revenue and EPS growth" : "fallback";
    d.years = 5; src.years = "standard";
    d.gT = 2.5; src.gT = "about long-run nominal GDP less a margin";
    var eg = fin(f.growthEstimateCurY) ? f.growthEstimateCurY : d.g1;
    d.epsGrowth = r1(clamp(eg, -10, 40)); src.epsGrowth = fin(f.growthEstimateCurY) ? "analysts' current-year EPS growth" : "same as revenue growth";
    d.epsShock = 0; src.epsShock = "none";
    var fm = fin(f.fcf) && fin(f.revenue) && f.revenue > 0 ? f.fcf / f.revenue * 100 : null;
    d.fcfMargin = fin(fm) ? r1(clamp(fm, -40, 65)) : 10; src.fcfMargin = fin(fm) ? "trailing free cash flow / revenue" : "fallback";
    d.marginDrift = 0; src.marginDrift = "none";
    d.roe = fin(f.roe) ? r1(clamp(f.roe, 4, 60)) : 15; src.roe = fin(f.roe) ? "trailing return on equity" : "fallback";
    var pe = fin(p.fpe) ? p.fpe : fin(f.forwardPE) ? f.forwardPE : fin(f.trailingPE) ? f.trailingPE : 18;
    d.exitPE = r1(clamp(pe, 6, 60)); src.exitPE = fin(p.fpe) ? "peer median forward P/E" : fin(f.forwardPE) ? "own forward P/E" : "fallback";
    d.peerPremium = 0; src.peerPremium = "none";
    d.usdPct = 0; src.usdPct = "none";
    d.oilPct = 0; src.oilPct = "none";
    var w = { dcf: 30, earnings: 25, peers: 25, power: 10, street: 10 };
    if (row.financial) { w = { dcf: 0, earnings: 30, peers: 30, power: 30, street: 10 }; }
    if (row.earlyStage) { w = { dcf: 40, earnings: 0, peers: 45, power: 0, street: 15 }; }
    d.weights = w;
    return { inputs: d, sources: src };
  }

  function normalize(inputs) {
    var d = copy(inputs);
    for (var i = 0; i < INPUTS.length; i++) {
      var b = INPUTS[i], v = Number(d[b.key]);
      d[b.key] = fin(v) ? clamp(v, b.min, b.max) : null;
    }
    d.years = fin(d.years) ? Math.round(d.years) : 5;
    var w = copy(inputs.weights || {});
    for (var j = 0; j < WEIGHT_KEYS.length; j++) { var k = WEIGHT_KEYS[j]; w[k] = fin(Number(w[k])) ? clamp(Number(w[k]), 0, 100) : 0; }
    d.weights = w;
    return d;
  }

  function rates(row, d) {
    var rf = (d.rf + d.rateShiftBp / 100) / 100;
    var ke = rf + d.beta * d.erp / 100;
    var f = row.facts || {};
    var E = fin(f.marketCap) && f.marketCap > 0 ? f.marketCap : null;
    var D = fin(f.debt) && f.debt > 0 && !row.financial ? f.debt : 0;
    var kd = (rf + d.creditSpread / 100) * (1 - 0.21);
    var wacc = E ? (ke * E + kd * D) / (E + D) : ke;
    return { rf: rf, ke: ke, kd: kd, wacc: wacc, debtWeight: E ? D / (E + D) : 0 };
  }

  function forwardEps(row) {
    var f = row.facts || {};
    if (fin(f.forwardEps) && f.forwardEps > 0) return { value: f.forwardEps, source: f.forwardEpsSource || "analysts' next-year EPS" };
    if (fin(f.trailingEps) && f.trailingEps > 0) return { value: f.trailingEps, source: "trailing EPS (no forward estimate)" };
    return { value: null, source: null };
  }

  function dcf(row, d, R) {
    var f = row.facts || {};
    if (row.financial) return { value: null, reason: "Free cash flow is not a meaningful measure for a bank or broker; use earnings power and peers." };
    if (!(fin(f.revenue) && f.revenue > 0 && fin(f.shares) && f.shares > 0)) return { value: null, reason: "Revenue or share count is missing." };
    var r = R.wacc, gT = d.gT / 100;
    if (r - gT < 0.01) return { value: null, reason: "The discount rate must sit at least 1 point above long-run growth." };
    var rev = f.revenue, pv = 0, fcfN = 0, n = d.years, path = [];
    for (var t = 1; t <= n; t++) {
      var g = d.g1 / 100 + (gT - d.g1 / 100) * (t - 1) / Math.max(1, n - 1);
      rev = rev * (1 + g);
      var margin = (d.fcfMargin + d.marginDrift * t / n) / 100;
      var cf = rev * margin * (1 + d.epsShock / 100);
      pv += cf / Math.pow(1 + r, t);
      fcfN = cf;
      path.push({ year: t, growth: g * 100, revenue: rev, fcf: cf });
    }
    var tv = fcfN * (1 + gT) / (r - gT);
    var pvTv = tv / Math.pow(1 + r, n);
    var equity = pv + pvTv - (fin(f.debt) ? f.debt : 0) + (fin(f.cash) ? f.cash : 0);
    var ps = equity / f.shares;
    if (!(ps > 0)) return { value: null, reason: "Projected cash flows do not cover the debt (cash burn at these inputs).", terminalShare: null, path: path };
    return { value: ps, terminalShare: pvTv / (pv + pvTv), discount: r * 100, path: path };
  }

  function earnings(row, d, R) {
    var f = row.facts || {}, e = forwardEps(row);
    if (!fin(e.value)) return { value: null, reason: "No positive EPS to project (the company is not yet profitable)." };
    var ke = R.ke, g = d.epsGrowth / 100, eps = e.value * (1 + d.epsShock / 100), divPv = 0;
    var payout = fin(f.payoutRatio) ? clamp(f.payoutRatio / 100, 0, 1) : 0;
    for (var t = 1; t <= 3; t++) {
      var et = eps * Math.pow(1 + g, t - 1);
      divPv += et * payout / Math.pow(1 + ke, t);
    }
    var eps3 = eps * Math.pow(1 + g, 3);
    var value = eps3 * d.exitPE / Math.pow(1 + ke, 3) + divPv;
    return { value: value > 0 ? value : null, eps0: eps, eps3: eps3, epsSource: e.source, reason: value > 0 ? null : "Earnings path is negative at these inputs." };
  }

  function peers(row, d) {
    var f = row.facts || {}, p = row.peers || {}, prem = 1 + d.peerPremium / 100, parts = [];
    var e = forwardEps(row), shock = 1 + d.epsShock / 100;
    if (fin(p.fpe) && fin(e.value)) parts.push({ key: "fpe", label: "Forward P/E " + r1(p.fpe) + "x", value: p.fpe * prem * e.value * shock });
    if (!row.financial && fin(p.evs) && fin(f.revenue) && fin(f.shares) && f.shares > 0) {
      var eq = p.evs * prem * f.revenue * shock - (fin(f.debt) ? f.debt : 0) + (fin(f.cash) ? f.cash : 0);
      if (eq > 0) parts.push({ key: "evs", label: "EV/sales " + r1(p.evs) + "x", value: eq / f.shares });
    }
    if (fin(p.ps) && fin(f.revenue) && fin(f.shares) && f.shares > 0) parts.push({ key: "ps", label: "Price/sales " + r1(p.ps) + "x", value: p.ps * prem * f.revenue * shock / f.shares });
    if (!parts.length) return { value: null, reason: "Too few covered peers with the same measures.", parts: [] };
    return { value: median(parts.map(function (x) { return x.value; })), parts: parts, basis: p.label || null, n: p.n || null };
  }

  function power(row, d, R) {
    var e = forwardEps(row);
    if (!fin(e.value)) return { value: null, reason: "No positive EPS to capitalize." };
    var ke = R.ke, gT = d.gT / 100, g = d.epsGrowth / 100, roe = d.roe / 100, n = d.years;
    if (ke - gT < 0.01) return { value: null, reason: "Cost of equity must sit at least 1 point above long-run growth." };
    var eps = e.value * (1 + d.epsShock / 100), pv = 0, et = eps;
    for (var t = 1; t <= n; t++) {
      var gt = g + (gT - g) * (t - 1) / Math.max(1, n - 1);
      var payout = clamp(1 - gt / roe, 0.05, 1);
      if (t > 1) et = et * (1 + gt);
      pv += et * payout / Math.pow(1 + ke, t);
    }
    var termPayout = clamp(1 - gT / roe, 0.05, 1);
    var tv = et * (1 + gT) * termPayout / (ke - gT);
    var value = pv + tv / Math.pow(1 + ke, n);
    return { value: value > 0 ? value : null, justifiedPE: value / eps, reason: value > 0 ? null : "Negative at these inputs." };
  }

  function street(row) {
    var s = row.street || {};
    if (!fin(s.mean) || !(s.mean > 0)) return { value: null, reason: "No analyst target." };
    return { value: s.mean, low: s.low, high: s.high, n: s.n };
  }

  // The full model at one set of inputs.
  function compute(row, inputs) {
    var d = normalize(inputs);
    var R = rates(row, d);
    var res = { dcf: dcf(row, d, R), earnings: earnings(row, d, R), peers: peers(row, d), power: power(row, d, R), street: street(row) };
    var wsum = 0, acc = 0, used = [];
    for (var i = 0; i < WEIGHT_KEYS.length; i++) {
      var k = WEIGHT_KEYS[i], v = res[k].value, w = d.weights[k];
      if (fin(v) && v > 0 && w > 0) { wsum += w; acc += w * v; used.push(k); }
    }
    var base = wsum > 0 ? acc / wsum : null;
    var s = row.sens || {};
    var macroPct = (fin(s.usd) ? s.usd * d.usdPct : 0) + (fin(s.commodity) ? s.commodity * d.oilPct : 0);
    macroPct = clamp(macroPct, -30, 30);
    var value = fin(base) ? base * (1 + macroPct / 100) : null;
    var spot = row.spot;
    var shares = {};
    for (var j = 0; j < used.length; j++) shares[used[j]] = d.weights[used[j]] / wsum;
    return {
      inputs: d, rates: { rf: R.rf * 100, ke: R.ke * 100, wacc: R.wacc * 100, kd: R.kd * 100, debtWeight: R.debtWeight * 100 },
      methods: res, used: used, weightShares: shares, beforeMacro: base, macroPct: macroPct, value: value,
      gapPct: fin(value) && fin(spot) && spot > 0 ? (value / spot - 1) * 100 : null,
      measuredRatePct: fin(s.rate10y) ? s.rate10y * d.rateShiftBp / 10 : null
    };
  }

  function solve(fn, lo, hi, target) {
    var a = lo, b = hi, fa = fn(a), fb = fn(b);
    if (!fin(fa) || !fin(fb) || (fa - target) * (fb - target) > 0) return null;
    for (var i = 0; i < 60; i++) {
      var m = (a + b) / 2, fm = fn(m);
      if (!fin(fm)) return null;
      if ((fa - target) * (fm - target) <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
      if (Math.abs(b - a) < 0.01) break;
    }
    return (a + b) / 2;
  }

  // What today's price implies, holding every other input where it is.
  function implied(row, inputs) {
    var d = normalize(inputs), spot = row.spot, out = {};
    if (!(fin(spot) && spot > 0)) return out;
    function dcfAt(key) { return function (x) { var dd = copy(d); dd[key] = x; var R = rates(row, dd); var v = dcf(row, dd, R).value; return fin(v) ? v : -1e9; }; }
    if (fin(dcf(row, d, rates(row, d)).value)) {
      out.g1 = solve(dcfAt("g1"), -30, 80, spot);
      out.fcfMargin = solve(dcfAt("fcfMargin"), -20, 80, spot);
      out.erp = solve(dcfAt("erp"), 0.5, 15, spot);
    }
    var e = earnings(row, d, rates(row, d));
    if (fin(e.value)) {
      var R = rates(row, d), ke = R.ke, divPart = e.value - e.eps3 * d.exitPE / Math.pow(1 + ke, 3);
      var pe = (spot - divPart) * Math.pow(1 + ke, 3) / e.eps3;
      out.exitPE = pe > 0 ? pe : null;
      out.epsGrowth = solve(function (x) { var dd = copy(d); dd.epsGrowth = x; var v = earnings(row, dd, rates(row, dd)).value; return fin(v) ? v : -1e9; }, -30, 80, spot);
      out.forwardPE = e.eps0 > 0 ? spot / e.eps0 : null;
    }
    var pr = peers(row, d);
    if (fin(pr.value)) out.peerPremium = (spot / pr.value * (1 + d.peerPremium / 100) - 1) * 100;
    return out;
  }

  // Which inputs move the blended value most: each nudged down and up by a
  // fixed step, everything else held.
  var NUDGE = { rf: 0.5, erp: 1, beta: 0.2, g1: 3, gT: 0.5, epsGrowth: 3, epsShock: 10, fcfMargin: 2, marginDrift: 3, roe: 3, exitPE: 3, peerPremium: 10 };
  function drivers(row, inputs) {
    var d = normalize(inputs), base = compute(row, d).value, out = [];
    if (!fin(base)) return out;
    for (var k in NUDGE) {
      if (!Object.prototype.hasOwnProperty.call(NUDGE, k)) continue;
      var lo = copy(d), hi = copy(d), b = boundsOf(k);
      lo[k] = clamp(d[k] - NUDGE[k], b.min, b.max); hi[k] = clamp(d[k] + NUDGE[k], b.min, b.max);
      var vl = compute(row, lo).value, vh = compute(row, hi).value;
      if (!fin(vl) || !fin(vh)) continue;
      var swing = Math.abs(vh - vl);
      if (swing < 0.005 * base) continue;
      out.push({ key: k, label: b.label, unit: b.unit, step: NUDGE[k], low: vl, high: vh, swing: swing });
    }
    out.sort(function (a, b) { return b.swing - a.swing; });
    return out;
  }

  // Blended value across rate shocks (columns) and first-year growth (rows).
  function grid(row, inputs) {
    var d = normalize(inputs), shifts = [-100, -50, 0, 50, 100], gs = [-6, -3, 0, 3, 6], rows = [];
    for (var i = 0; i < gs.length; i++) {
      var cells = [];
      for (var j = 0; j < shifts.length; j++) {
        var dd = copy(d);
        dd.rateShiftBp = clamp(d.rateShiftBp + shifts[j], -300, 300);
        dd.g1 = clamp(d.g1 + gs[i], -30, 80);
        dd.epsGrowth = clamp(d.epsGrowth + gs[i], -30, 80);
        var v = compute(row, dd).value;
        cells.push(fin(v) ? v : null);
      }
      rows.push({ growthDelta: gs[i], g1: clamp(d.g1 + gs[i], -30, 80), cells: cells });
    }
    return { shifts: shifts, rows: rows };
  }

  function money(x) { return fin(x) ? "$" + (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)) : "n/a"; }
  function pct(x, dgt) { return fin(x) ? (x > 0 ? "+" : "") + x.toFixed(dgt == null ? 1 : dgt) + "%" : "n/a"; }
  function num1(x) { return fin(x) ? x.toFixed(1) : "n/a"; }

  // Plain-English read of the gap: what today's price assumes, where the
  // methods disagree, which input matters most, and what the market may be
  // pricing that the model leaves out (or the reverse).
  function explain(row, result, imp, drv) {
    var d = result.inputs, spot = row.spot, lines = { headline: "", priced: [], disagree: [], market: [], us: [] };
    if (!fin(result.value) || !fin(spot)) { lines.headline = "Not enough data for a modeled price at these inputs."; return lines; }
    var gap = result.gapPct, dir = gap >= 0 ? "above" : "below";
    lines.headline = "Modeled value " + money(result.value) + " vs market " + money(spot) + ": " + Math.abs(gap).toFixed(1) + "% " + dir + " the price." +
      (Math.abs(gap) < 5 ? " Within 5%, so the market and these inputs roughly agree." : gap > 0 ? " At these inputs the market is paying less than the model thinks the business is worth." : " At these inputs the market is paying for more than the model can justify.");
    if (fin(imp.g1)) lines.priced.push("To be worth today's price on cash flow, revenue would need to grow about " + num1(imp.g1) + "% in year one (fading to " + num1(d.gT) + "%) vs your " + num1(d.g1) + "%. " + (imp.g1 > d.g1 + 1 ? "The market is pricing in faster growth than you." : imp.g1 < d.g1 - 1 ? "The market is pricing in slower growth than you." : "About the same growth you assume."));
    if (fin(imp.fcfMargin)) lines.priced.push("Or, at your growth, a free-cash-flow margin near " + num1(imp.fcfMargin) + "% (you use " + num1(d.fcfMargin) + "%).");
    if (fin(imp.erp)) lines.priced.push("The price implies an equity risk premium of about " + num1(imp.erp) + "% (you use " + num1(d.erp) + "%): " + (imp.erp < d.erp - 0.5 ? "investors accept less reward for risk than you require." : imp.erp > d.erp + 0.5 ? "investors demand more reward for risk than you do." : "close to yours."));
    if (fin(imp.exitPE)) lines.priced.push("On the earnings path, today's price needs an exit P/E of " + num1(imp.exitPE) + "x in three years (you use " + num1(d.exitPE) + "x)" + (fin(imp.epsGrowth) ? ", or EPS growth near " + num1(imp.epsGrowth) + "% a year." : "."));
    if (fin(imp.peerPremium)) lines.priced.push("Against peers the stock trades at a " + (imp.peerPremium >= 0 ? num1(imp.peerPremium) + "% premium" : num1(-imp.peerPremium) + "% discount") + " to the peer-median price.");
    var vals = [];
    for (var i = 0; i < METHODS.length; i++) { var m = result.methods[METHODS[i].key]; if (fin(m.value)) vals.push({ label: METHODS[i].label, value: m.value }); }
    vals.sort(function (a, b) { return a.value - b.value; });
    if (vals.length >= 2) {
      var lo = vals[0], hi = vals[vals.length - 1];
      lines.disagree.push("Methods range from " + money(lo.value) + " (" + lo.label + ") to " + money(hi.value) + " (" + hi.label + ")." + (hi.value / lo.value > 1.6 ? " That is a wide spread, so the weights decide a lot." : ""));
      var nearest = vals.slice().sort(function (a, b) { return Math.abs(a.value - spot) - Math.abs(b.value - spot); })[0];
      lines.disagree.push("The market price sits closest to " + nearest.label + " (" + money(nearest.value) + ").");
    }
    if (drv && drv.length) {
      var top = drv[0];
      lines.disagree.push("The input that moves the answer most is " + top.label.toLowerCase() + ": " + top.step + (top.unit === "%" || top.unit === "pp" ? " points" : top.unit === "x" ? "x" : "") + " either way spans " + money(top.low) + " to " + money(top.high) + ".");
    }
    if (fin(result.measuredRatePct) && d.rateShiftBp) lines.disagree.push("A " + d.rateShiftBp + "bp rate move: the model reprices it through the discount rate; the stock's own past response to the 10-year suggests " + pct(result.measuredRatePct) + " for the price.");
    var c = row.context || {};
    if (fin(c.revision30)) lines.market.push("Analysts' full-year EPS estimate moved " + pct(c.revision30) + " in 30 days" + (c.revision30 > 2 ? ": rising estimates often lead price." : c.revision30 < -2 ? ": falling estimates often weigh on price before the model's inputs catch up." : "."));
    if (c.grade && fin(c.grade.total)) lines.market.push("Site grade " + (c.grade.total > 0 ? "+" : "") + c.grade.total.toFixed(1) + (c.grade.side ? " (" + c.grade.side + " side)" : " (no trade)") + ": momentum, flow and news the valuation leaves out.");
    if (c.grade && fin(c.grade.macroPoints) && Math.abs(c.grade.macroPoints) >= 0.3) lines.market.push("Macro fit " + (c.grade.macroPoints > 0 ? "+" : "") + c.grade.macroPoints.toFixed(1) + ": rates, credit and the cycle currently " + (c.grade.macroPoints > 0 ? "favor" : "work against") + " this kind of company.");
    if (fin(c.shortPct) && c.shortPct >= 8) lines.market.push(num1(c.shortPct) + "% of the float is sold short: a crowd betting the price falls.");
    if (fin(c.earningsInDays) && c.earningsInDays >= 0 && c.earningsInDays <= 21) lines.market.push("Earnings in " + c.earningsInDays + " day" + (c.earningsInDays === 1 ? "" : "s") + ": the price may be waiting on the print.");
    if (fin(c.ownPePct)) lines.market.push("Forward P/E is at the " + Math.round(c.ownPePct) + "th percentile of its own saved range" + (c.ownPeDays ? " (" + c.ownPeDays + " sessions)" : "") + ".");
    if (c.forecast && fin(c.forecast.epsYoy)) lines.market.push("Earnings Forecast for the quarter ending " + c.forecast.quarterEnd + ": EPS " + pct(c.forecast.epsYoy) + " vs the same quarter last year" + (fin(c.forecast.revYoy) ? ", revenue " + pct(c.forecast.revYoy) : "") + ".");
    var f = row.facts || {};
    if (row.financial) lines.us.push("Banks and brokers: free cash flow is not used, so cash-flow value is off and the answer leans on earnings power and peers.");
    if (row.earlyStage) lines.us.push("Early-stage company: earnings-based methods are off until profits are established.");
    if (fin(f.fcf) && f.fcf <= 0 && !row.financial) lines.us.push("Free cash flow is negative today, so the cash-flow value rests on margins turning positive.");
    if (result.methods.dcf && fin(result.methods.dcf.terminalShare) && result.methods.dcf.terminalShare > 0.75) lines.us.push(Math.round(result.methods.dcf.terminalShare * 100) + "% of the cash-flow value comes after year " + d.years + ", so small changes to long-run growth or rates swing it.");
    if (row.peers && fin(row.peers.n) && row.peers.n < 4) lines.us.push("Only " + row.peers.n + " covered peers, so the peer medians are thin.");
    if (row.notes && row.notes.length) for (var n = 0; n < row.notes.length; n++) lines.us.push(row.notes[n]);
    lines.us.push("The model leaves out buybacks beyond today's share count, new products, management, competition and anything not in reported numbers.");
    return lines;
  }

  // One call for the page: result, implied values, drivers, grid, text.
  function analyze(row, inputs) {
    var result = compute(row, inputs);
    var imp = implied(row, inputs);
    var drv = drivers(row, inputs);
    return { result: result, implied: imp, drivers: drv, grid: grid(row, inputs), explain: explain(row, result, imp, drv) };
  }

  return { METHODS: METHODS, INPUTS: INPUTS, WEIGHT_KEYS: WEIGHT_KEYS, defaults: defaults, normalize: normalize, compute: compute, implied: implied, drivers: drivers, grid: grid, explain: explain, analyze: analyze };
}

const fnum = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pos = (x) => (fnum(x) != null && x > 0 ? x : null);
const r4 = (x) => (fnum(x) != null ? Math.round(x * 10000) / 10000 : null);

const FINANCIAL_SECTORS = new Set(["Bank", "Broker"]);
const FINANCIAL_SYMBOLS = new Set(["AXP"]);

// Inputs for one stock from the data the bake already holds.
export function valuationRow({ sym, data, sectorLabel = null, industry = null, band = null, sens = null, grade = null, forecast = null, growthProfile = null, market = {}, nowMs = Date.now() }) {
  const f = data?.fundamentals || {};
  const spot = pos(fnum(data?.spot));
  if (!spot) return null;
  const shares = pos(f.sharesOutstanding) ?? (pos(f.marketCap) ? f.marketCap / spot : null);
  const marketCap = pos(f.marketCap) ?? (shares ? shares * spot : null);
  const trailingEps = pos(f.trailingPE) ? spot / f.trailingPE : null;
  // Next fiscal year EPS: the analysts' +1y estimate, else price / forward P/E.
  const fy = (Array.isArray(f.epsForwardEstimates) ? f.epsForwardEstimates : []).find((e) => e?.period === "+1y" && pos(e.value));
  let forwardEps = null, forwardEpsSource = null;
  if (pos(f.forwardPE)) { forwardEps = spot / f.forwardPE; forwardEpsSource = "price / forward P/E (analysts' next 12 months)"; }
  else if (fy) { forwardEps = fy.value; forwardEpsSource = "analysts' next-fiscal-year EPS"; }
  const fyRev = (Array.isArray(f.revenueForwardEstimates) ? f.revenueForwardEstimates : []).find((e) => e?.period === "+1y" && pos(e.value));
  const fwdRevenueGrowth = pos(f.revenue) && fyRev ? (fyRev.value / f.revenue - 1) * 100 : (pos(f.revenue) && pos(f.revenueEstimateCurY) ? (f.revenueEstimateCurY / f.revenue - 1) * 100 : null);
  const financial = FINANCIAL_SECTORS.has(sectorLabel) || FINANCIAL_SYMBOLS.has(sym);
  const earlyStage = growthProfile?.key === "earlyStage" || (!pos(trailingEps) && !pos(forwardEps));
  const notes = [];
  if (f.financialCurrency && f.financialCurrency !== "USD") notes.push(`Reports in ${f.financialCurrency}; revenue and cash figures are Yahoo's and may mix currencies with the US share price.`);
  if (!pos(f.freeCashFlow) && f.freeCashFlow == null && !financial) notes.push("No free-cash-flow figure from the data source; the margin default is a fallback.");
  const nextEarnMs = Date.parse(f.nextEarningsDate || "");
  const peerRow = band || {};
  const peerOf = (k) => pos(peerRow[k]?.peers?.median);
  return {
    symbol: sym,
    name: f.name || sym,
    sector: sectorLabel,
    industry,
    spot,
    financial,
    earlyStage,
    facts: {
      revenue: pos(f.revenue), fcf: fnum(f.freeCashFlow), ocf: fnum(f.operatingCashFlow),
      cash: fnum(f.totalCash), debt: fnum(f.totalDebt), shares, marketCap,
      trailingPE: pos(f.trailingPE), forwardPE: pos(f.forwardPE), trailingEps: r4(trailingEps), forwardEps: r4(forwardEps), forwardEpsSource,
      priceToSales: pos(f.priceToSales), beta: fnum(f.beta), roe: fnum(f.returnOnEquity),
      grossMargin: fnum(f.grossMargin), operatingMargin: fnum(f.operatingMargin), profitMargin: fnum(f.profitMargin),
      revenueGrowthYoy: fnum(f.revenueGrowthYoy), earningsGrowthYoy: fnum(f.earningsGrowthYoy),
      growthEstimateCurY: fnum(f.growthEstimateCurY), fwdRevenueGrowth: fnum(fwdRevenueGrowth) != null ? Math.round(fwdRevenueGrowth * 10) / 10 : null,
      dividendYield: fnum(f.dividendYield), payoutRatio: fnum(f.payoutRatio), debtToEquity: fnum(f.debtToEquity),
      currency: f.financialCurrency || null,
    },
    peers: {
      label: peerRow.peers?.label || null, basis: peerRow.peers?.basis || null, n: peerRow.peers?.n ?? null,
      members: Array.isArray(peerRow.peers?.members) ? peerRow.peers.members.slice(0, 12) : [],
      fpe: peerOf("fpe"), pe: peerOf("pe"), evs: peerOf("evs"), ps: peerOf("ps"),
      own: { fpe: peerRow.fpe?.own || null, evs: peerRow.evs?.own || null },
    },
    street: { mean: pos(f.targetMeanPrice), low: pos(f.targetLowPrice), high: pos(f.targetHighPrice), n: fnum(f.numberOfAnalystOpinions), rating: f.recommendationKey || null },
    sens: sens ? {
      marketBeta: fnum(sens.vector?.marketBeta?.value), rate10y: fnum(sens.vector?.rate10y?.value), rate2y: fnum(sens.vector?.rate2y?.value),
      usd: fnum(sens.vector?.usd?.value), commodity: fnum(sens.vector?.commodity?.value), confidence: sens.confidence || null,
      rateSource: sens.vector?.rate10y?.source || null,
    } : null,
    growthBars: growthProfile ? { label: growthProfile.label, low: growthProfile.rev?.low ?? null, above: growthProfile.rev?.above ?? null, wellAbove: growthProfile.rev?.wellAbove ?? null } : null,
    context: {
      revision30: fnum(f.fyEpsRevision?.pct30),
      grade: grade ? { total: fnum(grade.total), side: grade.side || null, macroPoints: fnum(grade.macroFit?.points) } : null,
      shortPct: fnum(f.shortPercentOfFloat),
      earningsInDays: Number.isFinite(nextEarnMs) ? Math.round((Date.parse(String(f.nextEarningsDate).slice(0, 10)) - Date.parse(new Date(nowMs).toISOString().slice(0, 10))) / 86400000) : null,
      ownPePct: fnum(peerRow.fpe?.own?.pct), ownPeDays: fnum(peerRow.fpe?.own?.days),
      forecast,
    },
    market,
    notes,
  };
}

// The forecast quarter from earnings-forecast.json for one company, as
// growth vs the same quarter a year earlier.
export function forecastContext(company) {
  const fc = company?.forecast;
  if (!fc || company?.former) return null;
  const out = fc.outputs || {}, base = fc.baseline || {};
  const yoy = (now, then) => (pos(now) && pos(then) ? Math.round((now / then - 1) * 1000) / 10 : null);
  const epsYoy = yoy(out.eps, base.eps), revYoy = yoy(out.revenue, base.revenue);
  if (epsYoy == null && revYoy == null) return null;
  return { quarterEnd: fc.target?.end ? String(fc.target.end).slice(0, 10) : null, epsYoy, revYoy };
}

export function buildValuationLab({ chains = {}, symbols = [], sectors = {}, industries = {}, bands = null, scenarioEngine = null, grades = null, earningsForecast = null, growthProfileOf = null, macro = null, rfrPct = null, builtAtIso = new Date().toISOString() } = {}) {
  const lab = valuationLabFactory();
  const nowMs = Date.parse(builtAtIso) || Date.now();
  const sensBy = new Map((scenarioEngine?.sensitivities || []).map((s) => [s.symbol, s]));
  const fcBy = new Map((earningsForecast?.companies || []).map((c) => [c.symbol, forecastContext(c)]));
  const market = {
    tenY: fnum(macro?.tenY?.value), twoY: fnum(macro?.twoY?.value), thirtyY: fnum(macro?.thirtyY?.value),
    rfr: fnum(rfrPct), asOf: macro?.asOf || null,
  };
  const rows = {};
  let skipped = 0;
  for (const sym of symbols) {
    if (sectors[sym] === "ETF") continue;
    const data = chains[sym];
    if (!data?.fundamentals) { skipped++; continue; }
    const gp = growthProfileOf ? growthProfileOf(sym, sectors[sym]) : null;
    const row = valuationRow({
      sym, data, sectorLabel: sectors[sym] || null, industry: industries[sym] || null,
      band: bands?.rows?.[sym] || null, sens: sensBy.get(sym) || null, grade: grades?.[sym] || null,
      forecast: fcBy.get(sym) || null, growthProfile: gp, market, nowMs,
    });
    if (!row) { skipped++; continue; }
    const def = lab.defaults(row);
    const res = lab.compute(row, def.inputs);
    const imp = lab.implied(row, def.inputs);
    row.base = {
      value: res.value != null ? Math.round(res.value * 100) / 100 : null,
      gapPct: res.gapPct != null ? Math.round(res.gapPct * 10) / 10 : null,
      methods: Object.fromEntries(lab.WEIGHT_KEYS.map((k) => [k, res.methods[k].value != null ? Math.round(res.methods[k].value * 100) / 100 : null])),
      impliedGrowth: imp.g1 != null ? Math.round(imp.g1 * 10) / 10 : null,
      impliedExitPE: imp.exitPE != null ? Math.round(imp.exitPE * 10) / 10 : null,
    };
    rows[sym] = row;
  }
  return {
    version: VALUATION_LAB_VERSION,
    builtAtIso,
    market,
    count: Object.keys(rows).length,
    skipped,
    rows,
    note: "Inputs come from the build's own data: Yahoo fundamentals and analyst estimates, the peer bands, the Market Analysis sensitivities, the grade index and the Earnings Forecast. Defaults are starting points to change, not a forecast. Display only; nothing here changes a pick, a grade or the Track Record.",
  };
}

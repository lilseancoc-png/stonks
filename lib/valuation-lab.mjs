// Valuation lab (Owner-only, 2026-11-17).
//
// "What is this stock worth, and why does the market disagree?" Eight
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
//   4. Own-history multiples: the stock's own median multiples over its saved
//      daily snapshots (up to a year), i.e. back to what the market usually pays.
//   5. Growth-adjusted P/E (PEG): a fair P/E of PEG x EPS growth, the PEG
//      defaulting to the peer median.
//   6. Earnings power (rate-justified): a two-stage payout model whose payout
//      follows from growth and return on equity, so the value moves with rates
//      the way a bond's does.
//   7. Book value + excess returns (residual income): book value plus the
//      present value of returns above the cost of equity. Works for banks.
//   8. Street: the analysts' mean target, kept as a reference point.
//
// Dials on top: rates flow through every discount rate (never counted
// twice; the measured rate response is shown as a check); dollar, oil and
// S&P 500 moves use the stock's measured responses from the Market Analysis
// scenario layer; a party-in-power tilt uses its sector's history from the
// party tracker; a tax change applies to the US share of profit and lost
// foreign sales to the non-US share of revenue (SEC geographic split), and a
// tariff cost comes off pre-tax margin. About 28 named environments (economy,
// Fed, market mood, policy and politics, oil and the dollar) set these dials.
// A seeded range of outcomes (300 draws, the recession odds from Kalshi)
// gives the chance the stock is worth more than the price, and the story read
// compares last year, the analysts, our Earnings Forecast, today's price and
// the Owner's inputs, listing what the analysts may be missing and what the
// model may be missing.
//
// valuationLabFactory() is pure, dependency-free and serialized into app.js
// with toString(), so the page and the bake compute with the same code. Keep
// it free of regex, backslashes, template literals (even in comments) and
// outside names. buildValuationLab() prepares one row of inputs per covered
// stock at bake time from data the build already holds (no fetch, no AI).
// Display only: nothing here feeds a grade, a gate, a pick or the Track Record.

export const VALUATION_LAB_KEY = "valuation-lab.json";
export const VALUATION_LAB_VERSION = 2;

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
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  }
  function copy(o) { var out = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; return out; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  var METHODS = [
    { key: "dcf", label: "Cash flow (DCF)", short: "Cash flow (DCF)" },
    { key: "earnings", label: "Earnings path", short: "Earnings path" },
    { key: "peers", label: "Peer multiples", short: "Peer multiples" },
    { key: "history", label: "Own-history multiples", short: "Own history" },
    { key: "peg", label: "Growth-adjusted P/E (PEG)", short: "Growth-adjusted P/E" },
    { key: "power", label: "Earnings power (rate-justified)", short: "Earnings power" },
    { key: "book", label: "Book value + excess returns", short: "Book + excess returns" },
    { key: "street", label: "Street target", short: "Street target" }
  ];
  var WEIGHT_KEYS = METHODS.map(function (m) { return m.key; });

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
    { key: "targetPeg", group: "Multiples", label: "Fair PEG (P/E per point of EPS growth)", unit: "x", step: 0.05, min: 0.3, max: 4 },
    { key: "marketPct", group: "Economy and markets", label: "S&P 500 move", unit: "%", step: 1, min: -40, max: 30 },
    { key: "usdPct", group: "Economy and markets", label: "Dollar move", unit: "%", step: 1, min: -15, max: 15 },
    { key: "oilPct", group: "Economy and markets", label: "Oil move", unit: "%", step: 2.5, min: -50, max: 50 },
    { key: "taxChangePp", group: "Policy and politics", label: "Corporate tax rate change", unit: "pp", step: 1, min: -10, max: 15 },
    { key: "tariffPp", group: "Policy and politics", label: "Tariff cost (points of revenue)", unit: "pp", step: 0.25, min: 0, max: 10 },
    { key: "tradeHitPct", group: "Policy and politics", label: "Foreign sales lost to retaliation", unit: "%", step: 1, min: 0, max: 50 },
    { key: "politicsPct", group: "Policy and politics", label: "Party-in-power tilt (sector history, a year)", unit: "%", step: 0.5, min: -15, max: 15 },
    { key: "recessionOdds", group: "Odds for the range", label: "Chance of a recession", unit: "%", step: 1, min: 0, max: 90 }
  ];

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
    // Reported cash flow first (operating cash flow less capital spending over
    // the last four quarters, the same figure the story shows), Yahoo's
    // summary free cash flow only when the quarters are missing: the two can
    // differ by a third (NVDA, 2026-11-20: 41.9% reported, 27.4% Yahoo).
    var fmRep = fin(f.fcfTtm) && fin(f.revenueTtm) && f.revenueTtm > 0 ? f.fcfTtm / f.revenueTtm * 100 : null;
    var fm = fin(fmRep) ? fmRep : fin(f.fcf) && fin(f.revenue) && f.revenue > 0 ? f.fcf / f.revenue * 100 : null;
    d.fcfMargin = fin(fm) ? r1(clamp(fm, -40, 65)) : 10; src.fcfMargin = fin(fmRep) ? "reported free cash flow / revenue, last four quarters" : fin(fm) ? "trailing free cash flow / revenue (Yahoo)" : "fallback";
    d.marginDrift = 0; src.marginDrift = "none";
    d.roe = fin(f.roe) ? r1(clamp(f.roe, 4, 60)) : 15; src.roe = fin(f.roe) ? "trailing return on equity" : "fallback";
    var pe = fin(p.fpe) ? p.fpe : fin(f.forwardPE) ? f.forwardPE : fin(f.trailingPE) ? f.trailingPE : 18;
    d.exitPE = r1(clamp(pe, 6, 60)); src.exitPE = fin(p.fpe) ? "peer median forward P/E" : fin(f.forwardPE) ? "own forward P/E" : "fallback";
    d.peerPremium = 0; src.peerPremium = "none";
    d.targetPeg = fin(p.peg) ? r2(clamp(p.peg, 0.6, 3)) : 1.5; src.targetPeg = fin(p.peg) ? "peer median PEG (Yahoo)" : "rule of thumb";
    d.marketPct = 0; src.marketPct = "none";
    d.usdPct = 0; src.usdPct = "none";
    d.oilPct = 0; src.oilPct = "none";
    d.taxChangePp = 0; src.taxChangePp = "none (21% federal rate)";
    d.tariffPp = 0; src.tariffPp = "none";
    d.tradeHitPct = 0; src.tradeHitPct = "none";
    d.politicsPct = 0; src.politicsPct = "none";
    d.recessionOdds = fin(m.recessionOdds) ? Math.round(clamp(m.recessionOdds, 0, 90)) : 15; src.recessionOdds = fin(m.recessionOdds) ? "Kalshi recession market" : "long-run share of years in recession";
    var w = { dcf: 25, earnings: 20, peers: 20, history: 10, peg: 5, power: 5, book: 5, street: 10 };
    if (row.financial) w = { dcf: 0, earnings: 20, peers: 25, history: 5, peg: 0, power: 20, book: 20, street: 10 };
    if (row.earlyStage) w = { dcf: 35, earnings: 0, peers: 35, history: 15, peg: 0, power: 0, book: 0, street: 15 };
    d.weights = w;
    return { inputs: d, sources: src };
  }

  function normalize(inputs) {
    var d = copy(inputs);
    for (var i = 0; i < INPUTS.length; i++) {
      var b = INPUTS[i], v = Number(d[b.key]);
      d[b.key] = fin(v) ? clamp(v, b.min, b.max) : (b.key === "targetPeg" ? 1.5 : b.key === "recessionOdds" ? 15 : 0);
    }
    d.years = fin(d.years) && d.years >= 3 ? Math.round(d.years) : 5;
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

  // Policy and earnings dials as multipliers. The tax change applies to the
  // US share of profits; lost foreign sales apply to the non-US share of
  // revenue; a tariff cost in points of revenue comes off pre-tax profit.
  function policy(row, d) {
    var f = row.facts || {};
    var us = fin(f.usShare) ? clamp(f.usShare, 0, 1) : 0.6;
    var tax = clamp(1 - d.taxChangePp / 100 * us / 0.79, 0.5, 1.5);
    var sales = clamp(1 - d.tradeHitPct / 100 * (1 - us), 0.3, 1);
    var nm = fin(f.profitMargin) && f.profitMargin > 1 ? f.profitMargin : null;
    var tariff = nm ? clamp(1 - d.tariffPp * 0.79 / nm, 0, 1) : (d.tariffPp > 0 ? clamp(1 - d.tariffPp * 0.79 / 10, 0, 1) : 1);
    var profit = tax * tariff * (1 + d.epsShock / 100);
    return { us: us, usKnown: fin(f.usShare), tax: tax, sales: sales, tariff: tariff, profit: profit, all: profit * sales };
  }

  function forwardEps(row) {
    var f = row.facts || {};
    if (fin(f.forwardEps) && f.forwardEps > 0) return { value: f.forwardEps, source: f.forwardEpsSource || "analysts' next-year EPS" };
    if (fin(f.trailingEps) && f.trailingEps > 0) return { value: f.trailingEps, source: "trailing EPS (no forward estimate)" };
    return { value: null, source: null };
  }

  function dcf(row, d, R, P) {
    var f = row.facts || {};
    if (row.financial) return { value: null, reason: "Free cash flow is not a meaningful measure for a bank or broker; use earnings power, book value and peers." };
    if (!(fin(f.revenue) && f.revenue > 0 && fin(f.shares) && f.shares > 0)) return { value: null, reason: "Revenue or share count is missing." };
    var r = R.wacc, gT = d.gT / 100;
    if (r - gT < 0.01) return { value: null, reason: "The discount rate must sit at least 1 point above long-run growth." };
    var rev = f.revenue * P.sales, pv = 0, fcfN = 0, n = d.years, path = [];
    var cfMult = P.tax * (1 + d.epsShock / 100);
    for (var t = 1; t <= n; t++) {
      var g = d.g1 / 100 + (gT - d.g1 / 100) * (t - 1) / Math.max(1, n - 1);
      rev = rev * (1 + g);
      var margin = (d.fcfMargin + d.marginDrift * t / n - d.tariffPp * 0.79) / 100;
      var cf = rev * margin * cfMult;
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

  function earnings(row, d, R, P) {
    var f = row.facts || {}, e = forwardEps(row);
    if (!fin(e.value)) return { value: null, reason: "No positive EPS to project (the company is not yet profitable)." };
    var ke = R.ke, g = d.epsGrowth / 100, eps = e.value * P.all, divPv = 0;
    var payout = fin(f.payoutRatio) ? clamp(f.payoutRatio / 100, 0, 1) : 0;
    for (var t = 1; t <= 3; t++) {
      var et = eps * Math.pow(1 + g, t - 1);
      divPv += et * payout / Math.pow(1 + ke, t);
    }
    var eps3 = eps * Math.pow(1 + g, 3);
    var value = eps3 * d.exitPE / Math.pow(1 + ke, 3) + divPv;
    return { value: value > 0 ? value : null, eps0: eps, eps3: eps3, epsSource: e.source, reason: value > 0 ? null : "Earnings path is negative at these inputs." };
  }

  function multiplesValue(row, set, k, tag) {
    var f = row.facts || {}, e = forwardEps(row), parts = [];
    if (fin(set.fpe) && fin(e.value)) parts.push({ key: "fpe", label: "Forward P/E " + r1(set.fpe) + "x" + tag, value: set.fpe * e.value * k });
    if (!row.financial && fin(set.evs) && fin(f.revenue) && fin(f.shares) && f.shares > 0) {
      var eq = set.evs * f.revenue * k - (fin(f.debt) ? f.debt : 0) + (fin(f.cash) ? f.cash : 0);
      if (eq > 0) parts.push({ key: "evs", label: "EV/sales " + r1(set.evs) + "x" + tag, value: eq / f.shares });
    }
    if (fin(set.ps) && fin(f.revenue) && fin(f.shares) && f.shares > 0) parts.push({ key: "ps", label: "Price/sales " + r1(set.ps) + "x" + tag, value: set.ps * f.revenue * k / f.shares });
    return parts;
  }

  function peers(row, d, P) {
    var p = row.peers || {}, prem = 1 + d.peerPremium / 100;
    var parts = multiplesValue(row, { fpe: p.fpe, evs: p.evs, ps: p.ps }, prem * P.all, "");
    if (!parts.length) return { value: null, reason: "Too few covered peers with the same measures.", parts: [] };
    return { value: median(parts.map(function (x) { return x.value; })), parts: parts, basis: p.label || null, n: p.n || null };
  }

  // The stock's own median multiple over the saved daily snapshots (up to a
  // year): what it is worth if it goes back to what the market usually pays.
  function history(row, d, P) {
    var o = row.own || {}, set = {}, days = 0;
    var keys = ["fpe", "evs", "ps"];
    for (var i = 0; i < keys.length; i++) {
      var x = o[keys[i]];
      if (x && fin(x.median) && fin(x.days) && x.days >= 20) { set[keys[i]] = x.median; days = Math.max(days, x.days); }
    }
    var parts = multiplesValue(row, set, P.all, " (own median)");
    if (!parts.length) return { value: null, reason: "Fewer than 20 saved sessions of its own multiples so far.", parts: [] };
    return { value: median(parts.map(function (x) { return x.value; })), parts: parts, days: days };
  }

  function peg(row, d, P) {
    var e = forwardEps(row);
    if (!fin(e.value)) return { value: null, reason: "No positive EPS." };
    if (d.epsGrowth < 3) return { value: null, reason: "EPS growth under 3% a year: a growth-adjusted P/E says little for slow growers." };
    var pe = d.targetPeg * Math.min(d.epsGrowth, 40);
    return { value: e.value * P.all * pe, fairPE: pe };
  }

  function power(row, d, R, P) {
    var e = forwardEps(row);
    if (!fin(e.value)) return { value: null, reason: "No positive EPS to capitalize." };
    var ke = R.ke, gT = d.gT / 100, g = d.epsGrowth / 100, roe = d.roe / 100, n = d.years;
    if (ke - gT < 0.01) return { value: null, reason: "Cost of equity must sit at least 1 point above long-run growth." };
    var eps = e.value * P.all, pv = 0, et = eps;
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

  // Residual income: book value today plus the present value of the returns
  // above the cost of equity the book earns, fading after the growth years.
  function book(row, d, R, P) {
    var f = row.facts || {}, bv = f.bookPerShare;
    if (!(fin(bv) && bv > 0)) return { value: null, reason: "No positive book value (price/book missing or negative equity)." };
    if (fin(f.priceToBook) && f.priceToBook > 25) return { value: null, reason: "Book value is under 4% of the price (buybacks or intangible assets), so a book-based value says little." };
    var ke = R.ke, roe = d.roe / 100 * P.all, n = d.years;
    var payout = fin(f.payoutRatio) ? clamp(f.payoutRatio / 100, 0, 0.95) : clamp(1 - d.gT / d.roe, 0, 0.9);
    var b = bv, pv = 0, ri = 0, omega = 0.6;
    for (var t = 1; t <= n; t++) {
      ri = (roe - ke) * b;
      pv += ri / Math.pow(1 + ke, t);
      b = b * (1 + roe * (1 - payout));
    }
    var tv = ri * omega / (1 + ke - omega);
    var value = bv + pv + tv / Math.pow(1 + ke, n);
    return { value: value > 0 ? value : null, bookPerShare: bv, spreadPct: (roe - ke) * 100, reason: value > 0 ? null : "Returns sit far below the cost of equity at these inputs." };
  }

  function street(row) {
    var s = row.street || {};
    if (!fin(s.mean) || !(s.mean > 0)) return { value: null, reason: "No analyst target." };
    return { value: s.mean, low: s.low, high: s.high, n: s.n };
  }

  // The oil sensitivity is a blend of the stock's return vs oil and its
  // business profile, capped at 2; the Market Analysis scenario layer scales
  // it by 0.35 per 1% of oil, and this does the same so one oil move reads
  // the same on both pages.
  var OIL_DAMP = 0.35;

  // The full model at one set of inputs.
  function compute(row, inputs) {
    var d = normalize(inputs);
    var R = rates(row, d), P = policy(row, d);
    var res = { dcf: dcf(row, d, R, P), earnings: earnings(row, d, R, P), peers: peers(row, d, P), history: history(row, d, P), peg: peg(row, d, P), power: power(row, d, R, P), book: book(row, d, R, P), street: street(row) };
    var wsum = 0, acc = 0, used = [];
    for (var i = 0; i < WEIGHT_KEYS.length; i++) {
      var k = WEIGHT_KEYS[i], v = res[k].value, w = d.weights[k];
      if (fin(v) && v > 0 && w > 0) { wsum += w; acc += w * v; used.push(k); }
    }
    var base = wsum > 0 ? acc / wsum : null;
    var s = row.sens || {};
    var mBeta = fin(s.marketBeta) ? s.marketBeta : d.beta;
    var parts = { usd: fin(s.usd) ? s.usd * d.usdPct : 0, oil: fin(s.commodity) ? s.commodity * d.oilPct * OIL_DAMP : 0, market: mBeta * d.marketPct, politics: d.politicsPct };
    var macroPct = clamp(parts.usd + parts.oil + parts.market + parts.politics, -45, 45);
    var value = fin(base) ? base * (1 + macroPct / 100) : null;
    var spot = row.spot;
    var shares = {};
    for (var j = 0; j < used.length; j++) shares[used[j]] = d.weights[used[j]] / wsum;
    return {
      inputs: d, rates: { rf: R.rf * 100, ke: R.ke * 100, wacc: R.wacc * 100, kd: R.kd * 100, debtWeight: R.debtWeight * 100 },
      policy: { taxFactor: P.tax, salesFactor: P.sales, tariffFactor: P.tariff, profitFactor: P.all, usShare: P.us, usShareKnown: P.usKnown },
      methods: res, used: used, weightShares: shares, beforeMacro: base, macroPct: macroPct, macroParts: parts, value: value,
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
    function dcfAt(key) { return function (x) { var dd = copy(d); dd[key] = x; var v = dcf(row, dd, rates(row, dd), policy(row, dd)).value; return fin(v) ? v : -1e9; }; }
    if (fin(dcf(row, d, rates(row, d), policy(row, d)).value)) {
      out.g1 = solve(dcfAt("g1"), -30, 80, spot);
      out.fcfMargin = solve(dcfAt("fcfMargin"), -20, 80, spot);
      out.erp = solve(dcfAt("erp"), 0.5, 15, spot);
    }
    var R = rates(row, d), P = policy(row, d), e = earnings(row, d, R, P);
    if (fin(e.value)) {
      var ke = R.ke, divPart = e.value - e.eps3 * d.exitPE / Math.pow(1 + ke, 3);
      var pe = (spot - divPart) * Math.pow(1 + ke, 3) / e.eps3;
      out.exitPE = pe > 0 ? pe : null;
      out.epsGrowth = solve(function (x) { var dd = copy(d); dd.epsGrowth = x; var v = earnings(row, dd, rates(row, dd), policy(row, dd)).value; return fin(v) ? v : -1e9; }, -30, 80, spot);
      out.forwardPE = e.eps0 > 0 ? spot / e.eps0 : null;
    }
    var pr = peers(row, d, P);
    if (fin(pr.value)) out.peerPremium = (spot / pr.value * (1 + d.peerPremium / 100) - 1) * 100;
    var pg = peg(row, d, P);
    if (fin(pg.value) && d.epsGrowth > 0) out.peg = d.targetPeg * spot / pg.value;
    return out;
  }

  // Which inputs move the blended value most: each nudged down and up by a
  // fixed step, everything else held.
  var NUDGE = { rf: 0.5, erp: 1, beta: 0.2, g1: 3, gT: 0.5, epsGrowth: 3, epsShock: 10, fcfMargin: 2, marginDrift: 3, roe: 3, exitPE: 3, peerPremium: 10, targetPeg: 0.3, taxChangePp: 3, tariffPp: 1 };
  function drivers(row, inputs) {
    var d = normalize(inputs), base = compute(row, d).value, out = [];
    if (!fin(base)) return out;
    for (var k in NUDGE) {
      if (!has(NUDGE, k)) continue;
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

  // ---- Environments ---------------------------------------------------------
  // Each scenario changes some inputs from the defaults: "add" moves an
  // input by that much, "set" fixes it. Party scenarios read the stock's
  // sector ETF history under each party mix (party tracker, since 2001).
  var RECESSION = { epsShock: -30, g1: -8, epsGrowth: -8, erp: 1.5, creditSpread: 2, peerPremium: -20 };
  function partyTilt(row, pres, house, senate) {
    var p = row.party;
    if (!p || !p.offices) return null;
    var parts = [["president", pres, 0.5], ["house", house, 0.25], ["senate", senate, 0.25]], tot = 0, acc = 0;
    for (var i = 0; i < parts.length; i++) {
      var o = p.offices[parts[i][0]], v = o ? o[parts[i][1]] : null;
      if (fin(v)) { acc += v * parts[i][2]; tot += parts[i][2]; }
    }
    return tot > 0 ? r1(acc / tot) : null;
  }
  function scenarios(row) {
    var list = [
      { id: "base", group: "Quick", label: "Defaults", note: "Every input back at its default." },
      { id: "bear", group: "Quick", label: "Bear case", add: { g1: -5, epsGrowth: -5, epsShock: -20, erp: 1, peerPremium: -15, exitPE: -3 }, note: "Slower growth, a 20% earnings miss, a higher risk premium and a lower multiple." },
      { id: "bull", group: "Quick", label: "Bull case", add: { g1: 5, epsGrowth: 5, epsShock: 10, erp: -0.5, peerPremium: 10, exitPE: 3 }, note: "Faster growth, a 10% beat and a richer multiple." },
      { id: "rates-up", group: "Quick", label: "Rates +100bp", add: { rateShiftBp: 100 }, note: "The 10-year yield 1 point higher." },
      { id: "rates-down", group: "Quick", label: "Rates -100bp", add: { rateShiftBp: -100 }, note: "The 10-year yield 1 point lower." },
      { id: "recession", group: "Quick", label: "Recession", add: RECESSION, note: "Earnings down 30%, growth 8 points lower, wider credit spreads, a higher risk premium and a peer discount." },
      { id: "soft", group: "Economy", label: "Soft landing", add: { g1: 1, epsGrowth: 1, rateShiftBp: -50, erp: -0.25 }, note: "Inflation cools without a recession: rates ease, growth holds." },
      { id: "stagflation", group: "Economy", label: "Stagflation", add: { rateShiftBp: 100, g1: -4, epsGrowth: -4, marginDrift: -3, erp: 1, exitPE: -3 }, note: "High inflation with slow growth: higher rates, squeezed margins, lower multiples." },
      { id: "boom", group: "Economy", label: "Boom / overheating", add: { g1: 4, epsGrowth: 4, epsShock: 5, rateShiftBp: 75, erp: -0.25 }, note: "Strong demand lifts sales and earnings, but rates rise with it." },
      { id: "deflation", group: "Economy", label: "Deflation scare", add: { rateShiftBp: -150, g1: -6, epsGrowth: -6, epsShock: -15, gT: -0.5, erp: 1 }, note: "Prices and demand fall: yields drop, but so do sales and earnings." },
      { id: "cuts", group: "Rates and the Fed", label: "Fed cutting cycle", add: { rateShiftBp: -75, erp: -0.25, g1: 1 }, note: "Several Fed cuts: lower long rates and a slightly easier backdrop." },
      { id: "higher", group: "Rates and the Fed", label: "Higher for longer", add: { rateShiftBp: 50, creditSpread: 0.5, exitPE: -2 }, note: "The Fed holds rates high: costlier borrowing and lower multiples." },
      { id: "term", group: "Rates and the Fed", label: "Bond selloff", add: { rateShiftBp: 150, erp: 0.5 }, note: "Long yields jump on deficits or inflation fears (term premium)." },
      { id: "euphoria", group: "Market mood", label: "Bubble / euphoria", add: { erp: -1.5, exitPE: 5, peerPremium: 15 }, note: "Investors accept less reward for risk and pay up for growth." },
      { id: "bearmkt", group: "Market mood", label: "Bear market (S&P -20%)", add: { marketPct: -20 }, note: "The S&P 500 falls 20%; the stock moves by its measured beta." },
      { id: "credit", group: "Market mood", label: "Credit crunch", add: { creditSpread: 3, erp: 1.5, epsShock: -10, peerPremium: -10 }, note: "Lenders pull back: spreads jump, risk appetite falls, earnings dip." },
      { id: "tariffs", group: "Policy and politics", label: "Tariff escalation", add: { tariffPp: 1.5, tradeHitPct: 10, usdPct: 3 }, note: "1.5 points of revenue in new tariff costs, 10% of foreign sales lost to retaliation, a firmer dollar." },
      { id: "tradedeal", group: "Policy and politics", label: "Trade deal", set: { tariffPp: 0, tradeHitPct: 0 }, add: { usdPct: -2, peerPremium: 3 }, note: "Tariffs come off and foreign sales are safe." },
      { id: "taxcut", group: "Policy and politics", label: "Tax cut to 15%", add: { taxChangePp: -6 }, note: "Federal corporate rate cut from 21% to 15% (applies to US profits)." },
      { id: "taxhike", group: "Policy and politics", label: "Tax hike to 28%", add: { taxChangePp: 7 }, note: "Federal corporate rate raised from 21% to 28% (applies to US profits)." }
    ];
    var mixes = [["dsweep", "Democratic sweep", "D", "D", "D"], ["rsweep", "Republican sweep", "R", "R", "R"], ["dsplit", "Dem president, GOP Congress", "D", "R", "R"], ["rsplit", "GOP president, Dem Congress", "R", "D", "D"]];
    for (var i = 0; i < mixes.length; i++) {
      var t = partyTilt(row, mixes[i][2], mixes[i][3], mixes[i][4]);
      if (!fin(t)) continue;
      list.push({ id: mixes[i][0], group: "Policy and politics", label: mixes[i][1], set: { politicsPct: clamp(t, -15, 15) }, note: "Since 2001 " + sectorLabel(row.party) + " ran " + (t >= 0 ? "+" : "") + t.toFixed(1) + "% a year vs the S&P 500 under this mix. History, not a forecast; it does not show the party caused it." });
    }
    list.push({ id: "oilspike", group: "Oil and the dollar", label: "Oil spike +40%", add: { oilPct: 40, rateShiftBp: 25 }, note: "Oil up 40% (war or supply cut); the stock moves by its measured oil response." });
    list.push({ id: "oilcrash", group: "Oil and the dollar", label: "Oil crash -40%", add: { oilPct: -40 }, note: "Oil down 40%." });
    list.push({ id: "strongusd", group: "Oil and the dollar", label: "Strong dollar +8%", add: { usdPct: 8 }, note: "Dollar up 8%; the stock moves by its measured dollar response." });
    list.push({ id: "weakusd", group: "Oil and the dollar", label: "Weak dollar -8%", add: { usdPct: -8 }, note: "Dollar down 8%." });
    return list;
  }
  function applyScenario(row, inputs, id) {
    var list = scenarios(row), sc = null, d = normalize(inputs);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) sc = list[i];
    if (!sc) return null;
    var k;
    if (sc.set) for (k in sc.set) if (has(sc.set, k)) d[k] = sc.set[k];
    if (sc.add) for (k in sc.add) if (has(sc.add, k)) d[k] = (fin(d[k]) ? d[k] : 0) + sc.add[k];
    return normalize(d);
  }

  // ---- Range of outcomes ----------------------------------------------------
  // 300 seeded draws around your inputs: growth (4 points), margin (2),
  // risk premium (1), rates (60bp), exit P/E (15%) and the peer premium (10
  // points) each move by one standard deviation of that size, and a share of
  // draws (the recession odds) also take the recession case. This is the
  // spread from not knowing the inputs, not a price forecast. Same seed for
  // the same stock, so the range only moves when an input moves.
  function range(row, inputs, n) {
    var d = normalize(inputs), N = n || 300, seed = 7, sym = String(row.symbol || "X");
    for (var c = 0; c < sym.length; c++) seed = (seed * 31 + sym.charCodeAt(c)) % 2147483647;
    function rnd() { seed = (seed * 48271) % 2147483647; return seed / 2147483647; }
    function nrm() { var u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    var vals = [], recN = 0, pRec = d.recessionOdds / 100, k;
    for (var i = 0; i < N; i++) {
      var dd = copy(d), rec = rnd() < pRec, zg = nrm();
      if (rec) { recN++; for (k in RECESSION) if (has(RECESSION, k)) dd[k] = dd[k] + RECESSION[k]; }
      dd.g1 += zg * 4; dd.epsGrowth += zg * 4 + nrm() * 2;
      dd.fcfMargin += nrm() * 2; dd.erp += nrm(); dd.rateShiftBp += nrm() * 60;
      dd.exitPE += nrm() * d.exitPE * 0.15; dd.peerPremium += nrm() * 10;
      var v = compute(row, normalize(dd)).value;
      if (fin(v) && v > 0) vals.push(v);
    }
    if (vals.length < N * 0.5) return null;
    vals.sort(function (a, b) { return a - b; });
    var above = 0, sum = 0;
    for (var j = 0; j < vals.length; j++) { sum += vals[j]; if (fin(row.spot) && vals[j] > row.spot) above++; }
    return { n: vals.length, p10: quantile(vals, 0.1), p25: quantile(vals, 0.25), p50: quantile(vals, 0.5), p75: quantile(vals, 0.75), p90: quantile(vals, 0.9), mean: sum / vals.length, aboveShare: above / vals.length, recessionDraws: recN, recessionOdds: d.recessionOdds, values: vals };
  }

  function money(x) { return fin(x) ? "$" + (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)) : "n/a"; }
  function pct(x, dgt) { return fin(x) ? (x > 0 ? "+" : "") + x.toFixed(dgt == null ? 1 : dgt) + "%" : "n/a"; }
  function num1(x) { return fin(x) ? x.toFixed(1) : "n/a"; }
  function sectorLabel(p) { return p && typeof p.etf === "string" && p.etf ? "its sector (" + p.etf + ")" : "its sector"; }
  function qtrLabel(q) { return q && typeof q === "string" ? "the quarter to " + q : "the coming quarter"; }
  function ordinal(x) {
    var r = Math.round(x), t = Math.abs(r) % 100, u = Math.abs(r) % 10;
    return r + ((t >= 11 && t <= 13) ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th");
  }

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
    if (fin(imp.peg)) lines.priced.push("At your EPS growth the price works out to a PEG of " + imp.peg.toFixed(2) + " (you call " + d.targetPeg.toFixed(2) + " fair).");
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
      lines.disagree.push("The input that moves the answer most is " + top.label.toLowerCase() + ": " + top.step + (top.unit === "%" || top.unit === "pp" ? (top.step === 1 ? " point" : " points") : top.unit === "x" ? "x" : "") + " either way spans " + money(top.low) + " to " + money(top.high) + ".");
    }
    if (fin(result.measuredRatePct) && d.rateShiftBp) lines.disagree.push("A " + d.rateShiftBp + "bp rate move: the model reprices it through the discount rate; the stock's own past response to the 10-year suggests " + pct(result.measuredRatePct) + " for the price.");
    var c = row.context || {};
    if (fin(c.revision30)) lines.market.push("Analysts' full-year EPS estimate moved " + pct(c.revision30) + " in 30 days" + (c.revision30 > 2 ? ": rising estimates often lead price." : c.revision30 < -2 ? ": falling estimates often weigh on price before the model's inputs catch up." : "."));
    if (c.grade && fin(c.grade.total)) lines.market.push("Site grade " + (c.grade.total > 0 ? "+" : "") + c.grade.total.toFixed(1) + (c.grade.side === "call" || c.grade.side === "put" ? " (" + c.grade.side + " side)" : " (no trade)") + ": momentum, flow and news the valuation leaves out.");
    if (c.grade && fin(c.grade.macroPoints) && Math.abs(c.grade.macroPoints) >= 0.3) lines.market.push("Macro fit " + (c.grade.macroPoints > 0 ? "+" : "") + c.grade.macroPoints.toFixed(1) + ": rates, credit and the cycle currently " + (c.grade.macroPoints > 0 ? "favor" : "work against") + " this kind of company.");
    if (fin(c.shortPct) && c.shortPct >= 8) lines.market.push(num1(c.shortPct) + "% of the float is sold short: a crowd betting the price falls.");
    if (fin(c.earningsInDays) && c.earningsInDays >= 0 && c.earningsInDays <= 21) lines.market.push("Earnings in " + c.earningsInDays + " day" + (c.earningsInDays === 1 ? "" : "s") + ": the price may be waiting on the print.");
    if (fin(c.ownPePct)) lines.market.push("Forward P/E is at the " + ordinal(c.ownPePct) + " percentile of its own saved range" + (fin(c.ownPeDays) && c.ownPeDays > 0 ? " (" + Math.round(c.ownPeDays) + " sessions)" : "") + ".");
    if (c.forecast && fin(c.forecast.epsYoy)) lines.market.push("Earnings Forecast for " + qtrLabel(c.forecast.quarterEnd) + ": EPS " + pct(c.forecast.epsYoy) + " vs the same quarter last year" + (fin(c.forecast.revYoy) ? ", revenue " + pct(c.forecast.revYoy) : "") + ".");
    var pty = row.party;
    if (pty && typeof pty.current === "string" && pty.current && fin(pty.currentTilt)) lines.market.push("Party mix now (" + pty.current + "): since 2001 " + sectorLabel(pty) + " ran " + pct(pty.currentTilt) + " a year vs the S&P 500 under this mix. History only; try the party scenarios.");
    var f = row.facts || {};
    if (row.financial) lines.us.push("Banks and brokers: free cash flow is not used, so cash-flow value is off and the answer leans on earnings power, book value and peers.");
    if (row.earlyStage) lines.us.push("Early-stage company: earnings-based methods are off until profits are established.");
    if ((fin(f.fcfTtm) ? f.fcfTtm <= 0 : fin(f.fcf) && f.fcf <= 0) && !row.financial) lines.us.push("Free cash flow is negative today, so the cash-flow value rests on margins turning positive.");
    if (result.methods.dcf && fin(result.methods.dcf.terminalShare) && result.methods.dcf.terminalShare > 0.75) lines.us.push(Math.round(result.methods.dcf.terminalShare * 100) + "% of the cash-flow value comes after year " + d.years + ", so small changes to long-run growth or rates swing it.");
    if (row.peers && fin(row.peers.n) && row.peers.n < 4) lines.us.push("Only " + row.peers.n + " covered peers, so the peer medians are thin.");
    if ((d.taxChangePp || d.tradeHitPct) && !result.policy.usShareKnown) lines.us.push("No US vs foreign revenue split on file, so tax and trade dials assume 60% of sales and profit are in the US.");
    if (row.notes && row.notes.length) for (var n = 0; n < row.notes.length; n++) lines.us.push(row.notes[n]);
    lines.us.push("The model leaves out new products, management, competition and anything not in reported numbers.");
    return lines;
  }

  // ---- The story: then vs now, us vs analysts -------------------------------
  // Four views of growth and the multiple (last year, analysts, our Earnings
  // Forecast, today's price, your input), and two lists: where the analysts'
  // numbers may be off, and where this model may be.
  function story(row, result, imp) {
    var s = row.story || {}, d = result.inputs, a = s.analysts || {}, f = row.facts || {};
    var out = { views: [], analystsMiss: [], modelMiss: [], beat: null };
    var rev = s.rev || {}, eps = s.eps || {}, ni = s.netIncome || {}, nm = s.netMargin || {}, fcf = s.fcf || {}, mult = s.multiples || {}, ours = s.ourForecast || null;
    out.views.push({ key: "revGrowth", label: "Revenue growth", lastYear: rev.growthPct, analysts: a.revGrowthNextY, ours: ours ? ours.revYoy : null, oursNote: ours ? qtrLabel(ours.quarterEnd) + " vs a year earlier" : null, price: imp.g1, yours: d.g1 });
    out.views.push({ key: "epsGrowth", label: "EPS growth", lastYear: fin(eps.growthPct) ? eps.growthPct : ni.growthPct, analysts: fin(a.epsGrowthNextY) ? a.epsGrowthNextY : a.epsGrowthCurY, ours: ours ? ours.epsYoy : null, oursNote: ours ? qtrLabel(ours.quarterEnd) + " vs a year earlier" : null, price: imp.epsGrowth, yours: d.epsGrowth });
    out.views.push({ key: "pe", label: "Forward P/E", lastYear: mult.fpe ? mult.fpe.median : null, lastYearNote: mult.fpe && fin(mult.fpe.days) && mult.fpe.days > 0 ? "own median, " + Math.round(mult.fpe.days) + " sessions" : null, analysts: row.peers ? row.peers.fpe : null, analystsNote: "peer median", ours: null, price: imp.exitPE, priceNote: "exit P/E in 3 years", yours: d.exitPE, now: f.forwardPE });

    var bt = s.beats || {};
    if (fin(bt.n) && fin(bt.beat) && bt.n >= 3 && fin(bt.avgSurprise)) {
      if (bt.beat >= bt.n - 1 && bt.avgSurprise > 2) {
        out.beat = r1(clamp(bt.avgSurprise, -30, 30));
        out.analystsMiss.push("Analysts have been too low: the company beat the EPS estimate in " + bt.beat + " of the last " + bt.n + " quarters, by " + num1(bt.avgSurprise) + "% on average" + (bt.longRun && fin(bt.longRun.n) && fin(bt.longRun.beat) && bt.longRun.n >= 8 ? " (" + bt.longRun.beat + " of " + bt.longRun.n + (bt.longRun.since ? " since " + String(bt.longRun.since).slice(0, 4) : "") + ")" : "") + ". If that habit holds, next year's EPS lands about " + num1(bt.avgSurprise) + "% above the estimate.");
      } else if (bt.n - bt.beat >= bt.n - 1 && bt.avgSurprise < -2) {
        out.beat = r1(clamp(bt.avgSurprise, -30, 30));
        out.analystsMiss.push("Analysts have been too high: the company missed in " + (bt.n - bt.beat) + " of the last " + bt.n + " quarters, by " + num1(-bt.avgSurprise) + "% on average.");
      }
    }
    if (fin(a.revGrowthNextY) && fin(rev.growthPct)) {
      if (a.revGrowthNextY < rev.growthPct - 5) out.analystsMiss.push("Analysts expect revenue growth to slow from " + num1(rev.growthPct) + "% over the last year to " + num1(a.revGrowthNextY) + "% next year. If the recent pace holds, their revenue is too low.");
      else if (a.revGrowthNextY > rev.growthPct + 5) out.analystsMiss.push("Analysts expect revenue growth to speed up from " + num1(rev.growthPct) + "% to " + num1(a.revGrowthNextY) + "%: a bet on something new (a product, a recovery) that last year's numbers do not show yet.");
    }
    if (fin(nm.ttm) && fin(nm.priorTtm) && fin(a.epsGrowthNextY) && fin(a.revGrowthNextY)) {
      if (nm.ttm - nm.priorTtm >= 2 && a.epsGrowthNextY <= a.revGrowthNextY + 2) out.analystsMiss.push("Net margin widened from " + num1(nm.priorTtm) + "% to " + num1(nm.ttm) + "% over the last year, but analysts' EPS growth (" + num1(a.epsGrowthNextY) + "%) barely tops their revenue growth (" + num1(a.revGrowthNextY) + "%): estimates may leave out further margin gains.");
      else if (nm.ttm - nm.priorTtm <= -2 && a.epsGrowthNextY >= a.revGrowthNextY + 5) out.analystsMiss.push("Net margin narrowed from " + num1(nm.priorTtm) + "% to " + num1(nm.ttm) + "%, yet analysts expect EPS (" + num1(a.epsGrowthNextY) + "%) to outgrow sales (" + num1(a.revGrowthNextY) + "%): they are counting on margins turning around.");
    }
    if (fin(a.revision30) && Math.abs(a.revision30) >= 2) out.analystsMiss.push("The full-year EPS estimate moved " + pct(a.revision30) + " in 30 days" + (fin(a.revision90) ? " and " + pct(a.revision90) + " in 90" : "") + (fin(a.up30) || fin(a.down30) ? " (" + (fin(a.up30) ? a.up30 : 0) + " analysts raised, " + (fin(a.down30) ? a.down30 : 0) + " cut)" : "") + ": " + (a.revision30 > 0 ? "estimates are still catching up, so targets may lag." : "estimates are still falling; the bottom may not be in."));
    var st = row.street || {};
    if (fin(st.mean) && fin(row.spot)) {
      if (row.spot > st.mean * 1.03) out.analystsMiss.push("The price is " + num1((row.spot / st.mean - 1) * 100) + "% above the analysts' average target (" + money(st.mean) + "): either analysts lag the stock or the market is ahead of the numbers.");
      if (fin(st.low) && fin(st.high) && st.low > 0 && st.high / st.low >= 2) out.analystsMiss.push("Analysts disagree widely: targets run from " + money(st.low) + " to " + money(st.high) + ", so the average hides two different stories.");
    }
    if (ours && (fin(ours.vsStreetRevPct) || fin(ours.vsStreetEpsPct))) {
      var big = Math.max(Math.abs(ours.vsStreetRevPct || 0), Math.abs(ours.vsStreetEpsPct || 0));
      out.analystsMiss.push("Our Earnings Forecast (from filed numbers) for " + qtrLabel(ours.quarterEnd) + " has revenue " + (fin(ours.vsStreetRevPct) ? pct(ours.vsStreetRevPct) : "n/a") + " and EPS " + (fin(ours.vsStreetEpsPct) ? pct(ours.vsStreetEpsPct) : "n/a") + " vs the analysts' estimate" + (big >= 3 ? ": a real difference worth watching on the print." : ": close to the street.") + " (Our EPS is the reported GAAP figure; analysts usually estimate adjusted EPS, so the revenue gap is the cleaner read.)");
    }
    if (fin(fcf.conversion) && fcf.conversion >= 1.3 && fin(fcf.ttm) && fcf.ttm > 0) out.analystsMiss.push("Free cash flow is " + fcf.conversion.toFixed(1) + "x net income: the business makes more cash than its earnings show, which P/E-based targets can understate.");
    var cap = s.capital || {};
    if (fin(cap.buybackYield) && cap.buybackYield >= 2) out.analystsMiss.push("Buybacks retire about " + num1(cap.buybackYield) + "% of the shares a year (" + num1(cap.shareholderYield) + "% with dividends): per-share growth runs ahead of the company's own growth.");

    if (fin(fcf.conversion) && fcf.conversion < 0.7 && fin(ni.ttm) && ni.ttm > 0) out.modelMiss.push("Only " + Math.round(fcf.conversion * 100) + "% of net income turned into free cash flow over the last year: earnings-based methods may flatter the stock compared with cash flow.");
    if (mult.fpe && fin(mult.fpe.pct) && mult.fpe.days >= 20) {
      if (mult.fpe.pct >= 85) out.modelMiss.push("Forward P/E " + num1(mult.fpe.now) + "x is near the top of its own range (" + ordinal(mult.fpe.pct) + " percentile, median " + num1(mult.fpe.median) + "x): the market already pays for good news, and the own-history method pulls the value down.");
      else if (mult.fpe.pct <= 15) out.modelMiss.push("Forward P/E " + num1(mult.fpe.now) + "x is near the bottom of its own range (" + ordinal(mult.fpe.pct) + " percentile, median " + num1(mult.fpe.median) + "x): either the market sees a problem the numbers do not yet show, or it is a cheap spot.");
    }
    var op = s.options || {};
    if (fin(op.moveYearPct)) out.modelMiss.push("Options price a move of about +/-" + Math.round(op.moveYearPct) + "% over a year" + (fin(op.ivPct) ? " (implied volatility at the " + ordinal(op.ivPct) + " percentile of its own history)" : "") + ": one modeled value hides that much uncertainty.");
    var rx = s.reactions || {};
    if (fin(rx.avgAbsMove) && rx.avgAbsMove >= 5) out.modelMiss.push("Earnings days move it about +/-" + num1(rx.avgAbsMove) + "% on average" + (fin(rx.up) && fin(rx.n) ? " (" + rx.up + " of " + rx.n + " up)" : "") + ": one report can close or widen the gap.");
    if (fin(result.value) && fin(st.mean) && st.mean > 0) {
      var vs = (result.value / st.mean - 1) * 100;
      if (Math.abs(vs) >= 20) out.modelMiss.push("Your model sits " + num1(Math.abs(vs)) + "% " + (vs > 0 ? "above" : "below") + " the analysts' average target. The biggest difference is usually growth: you use " + num1(d.g1) + "% for revenue" + (fin(a.revGrowthNextY) ? ", analysts " + num1(a.revGrowthNextY) + "%" : "") + "; " + num1(d.epsGrowth) + "% for EPS" + (fin(a.epsGrowthNextY) ? ", analysts " + num1(a.epsGrowthNextY) + "%" : "") + ".");
    }
    if (fin(a.revGrowthNextY) && Math.abs(d.g1 - a.revGrowthNextY) >= 5) out.modelMiss.push("Your first-year revenue growth (" + num1(d.g1) + "%) is " + num1(Math.abs(d.g1 - a.revGrowthNextY)) + " points " + (d.g1 > a.revGrowthNextY ? "above" : "below") + " the analysts' (" + num1(a.revGrowthNextY) + "%).");
    var span = fin(rev.accelSpan) && rev.accelSpan > 1 ? Math.round(rev.accelSpan) : 1;
    var lastQ = Array.isArray(rev.quarters) && rev.quarters.length ? rev.quarters[rev.quarters.length - 1] : null;
    if (fin(rev.accel) && Math.abs(rev.accel) >= 4) out.modelMiss.push("Quarterly revenue growth " + (rev.accel > 0 ? "sped up" : "slowed") + " by " + num1(Math.abs(rev.accel)) + " points over the last " + (span > 1 ? span + " quarters" : "quarter") + (lastQ && fin(lastQ.yoyPct) ? " (latest " + num1(lastQ.yoyPct) + "% vs a year earlier)" : "") + ": the trend the market may be extrapolating, and one a five-year growth path smooths over.");
    return out;
  }

  // One call for the page: result, implied values, drivers, grid, range,
  // story and text.
  function analyze(row, inputs, opts) {
    var result = compute(row, inputs);
    var imp = implied(row, inputs);
    var drv = drivers(row, inputs);
    return { result: result, implied: imp, drivers: drv, grid: grid(row, inputs), range: opts && opts.range === false ? null : range(row, inputs), story: story(row, result, imp), explain: explain(row, result, imp, drv) };
  }

  return { OIL_DAMP: OIL_DAMP, METHODS: METHODS, INPUTS: INPUTS, WEIGHT_KEYS: WEIGHT_KEYS, defaults: defaults, normalize: normalize, compute: compute, implied: implied, drivers: drivers, grid: grid, range: range, scenarios: scenarios, applyScenario: applyScenario, partyTilt: partyTilt, story: story, explain: explain, analyze: analyze, ordinal: ordinal };
}

const fnum = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pos = (x) => (fnum(x) != null && x > 0 ? x : null);
const r4 = (x) => (fnum(x) != null ? Math.round(x * 10000) / 10000 : null);
const r1 = (x) => (fnum(x) != null ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fnum(x) != null ? Math.round(x * 100) / 100 : null);
const DAY = 86400000;
const growth = (now, then) => (fnum(now) != null && pos(then) ? r1((now / then - 1) * 100) : null);

const FINANCIAL_SECTORS = new Set(["Bank", "Broker"]);
const FINANCIAL_SYMBOLS = new Set(["AXP"]);

// Share of revenue booked in the US (or the Americas, where that is how the
// company splits it), from the SEC geographic segments the bake already
// keeps. Null when the split has no US-like line.
export function usRevenueShare(segments) {
  const slices = Array.isArray(segments?.geographic) ? segments.geographic.filter((s) => s && pos(s.value)) : [];
  if (slices.length < 2) return null;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const isUs = (name) => {
    const n = String(name || "").toLowerCase().replace(/\./g, "");
    return /\b(united states|us|usa|domestic|north america|americas)\b/.test(n) && !/\b(latin|south america|non-us|international|outside)\b/.test(n);
  };
  const us = slices.filter((s) => isUs(s.name)).reduce((a, s) => a + s.value, 0);
  return total > 0 && us > 0 ? r4(Math.min(1, us / total)) : null;
}

// Trailing four quarters and the four before them from a dated quarterly
// series ({ date, value }), only when the quarters are close to consecutive.
export function ttmPair(series) {
  const xs = (Array.isArray(series) ? series : []).filter((r) => r?.date && fnum(r.value) != null).slice().sort((a, b) => a.date.localeCompare(b.date));
  const span = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
  const out = { ttm: null, priorTtm: null };
  if (xs.length >= 4 && span(xs[xs.length - 4].date, xs[xs.length - 1].date) <= 300) out.ttm = xs.slice(-4).reduce((a, r) => a + r.value, 0);
  if (xs.length >= 8 && span(xs[xs.length - 8].date, xs[xs.length - 1].date) <= 670) out.priorTtm = xs.slice(-8, -4).reduce((a, r) => a + r.value, 0);
  return out;
}

// Year-over-year growth of each quarter that has a quarter about a year
// earlier in the series (newest last).
export function quarterlyYoy(series) {
  const xs = (Array.isArray(series) ? series : []).filter((r) => r?.date && fnum(r.value) != null).slice().sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (const q of xs) {
    const t = Date.parse(q.date);
    const prev = xs.find((p) => Math.abs(t - Date.parse(p.date) - 365 * DAY) <= 25 * DAY);
    if (prev && pos(prev.value)) out.push({ date: q.date, value: q.value, yoyPct: growth(q.value, prev.value) });
  }
  return out.slice(-5);
}

// Then vs now and analysts vs us for one stock, from data the bake holds.
export function storyStats({ data, spot, band = null, forecastCompany = null }) {
  const f = data?.fundamentals || {};
  const rev = ttmPair(f.revenueHistory), ni = ttmPair(f.netIncomeHistory), fcf = ttmPair(f.fcfHistory);
  const revYoy = quarterlyYoy(f.revenueHistory);
  const accel = revYoy.length >= 2 && fnum(revYoy[revYoy.length - 1].yoyPct) != null && fnum(revYoy[0].yoyPct) != null ? r1(revYoy[revYoy.length - 1].yoyPct - revYoy[0].yoyPct) : null;
  const events = Array.isArray(data?.earningsHx?.events) ? data.earningsHx.events : [];
  const epsRows = (events.length ? events.map((e) => ({ date: e.qEnd || e.date, actual: fnum(e.epsActual), estimate: fnum(e.epsEstimate) })) : (f.earningsHistory || []).map((e) => ({ date: e.date, actual: fnum(e.epsActual), estimate: fnum(e.epsEstimate) })))
    .filter((e) => e.date && e.actual != null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const epsTtm = epsRows.length >= 4 ? epsRows.slice(-4).reduce((a, e) => a + e.actual, 0) : null;
  const epsPrior = epsRows.length >= 8 ? epsRows.slice(-8, -4).reduce((a, e) => a + e.actual, 0) : null;
  const beatRows = epsRows.filter((e) => e.estimate != null && Math.abs(e.estimate) >= 0.01).slice(-4).map((e) => ({ date: e.date, actual: e.actual, estimate: e.estimate, surprisePct: r1((e.actual - e.estimate) / Math.abs(e.estimate) * 100) }));
  const lr = data?.earningsHx?.longRun || null;
  const sur = beatRows.map((b) => b.surprisePct).filter((x) => fnum(x) != null);
  const fy = (arr, period) => (Array.isArray(arr) ? arr : []).find((e) => e?.period === period && fnum(e.value) != null) || null;
  const epsNext = fy(f.epsForwardEstimates, "+1y"), revNext = fy(f.revenueForwardEstimates, "+1y");
  const epsThisY = fnum(f.epsRevisions?.yPath?.current);
  const revThisY = pos(f.revenueEstimateCurY);
  const fwdRev = pos(f.revenue) && revNext ? (revNext.value / f.revenue - 1) * 100 : null;
  // Our Earnings Forecast quarter vs the analysts' estimate for the same quarter.
  let ourForecast = null;
  const fc = forecastCompany?.forecast;
  if (fc && !forecastCompany.former && fc.target?.end && (!fc.currency || fc.currency === "USD")) {
    const end = String(fc.target.end).slice(0, 10);
    const near = (e) => e?.date && Math.abs(Date.parse(e.date) - Date.parse(end)) <= 20 * DAY;
    const sEps = (f.epsForwardEstimates || []).find((e) => (e?.period === "0q" || e?.period === "+1q") && near(e));
    const sRev = (f.revenueForwardEstimates || []).find((e) => (e?.period === "0q" || e?.period === "+1q") && near(e));
    const o = fc.outputs || {}, base = fc.baseline || {};
    ourForecast = {
      quarterEnd: end, revenue: pos(o.revenue), eps: fnum(o.eps),
      revYoy: growth(o.revenue, base.revenue), epsYoy: pos(o.eps) ? growth(o.eps, base.eps) : null,
      streetRevenue: sRev ? sRev.value : null, streetEps: sEps ? sEps.value : null,
      vsStreetRevPct: sRev && pos(o.revenue) ? growth(o.revenue, sRev.value) : null,
      vsStreetEpsPct: sEps && pos(o.eps) && pos(sEps.value) ? growth(o.eps, sEps.value) : null,
    };
    if (ourForecast.revenue == null && ourForecast.eps == null) ourForecast = null;
  }
  const mult = {};
  for (const k of ["fpe", "evs", "ps"]) {
    const b = band?.[k];
    if (b?.own || fnum(b?.value) != null) mult[k] = { now: fnum(b?.value), median: fnum(b?.own?.median), p25: fnum(b?.own?.p25), p75: fnum(b?.own?.p75), pct: fnum(b?.own?.pct), days: fnum(b?.own?.days), from: b?.own?.from || null };
  }
  const mcap = pos(f.marketCap) ?? (pos(f.sharesOutstanding) && spot ? f.sharesOutstanding * spot : null);
  const buyback = pos(f.capitalAllocation?.buybackTtm);
  const buybackYield = buyback && mcap ? r2(buyback / mcap * 100) : null;
  const dividendYield = fnum(f.dividendYield);
  const iv = pos(data?.ivRank?.iv);
  const avgMove = fnum(lr?.avgAbsMovePct);
  return {
    rev: { ttm: rev.ttm, priorTtm: rev.priorTtm, growthPct: growth(rev.ttm, rev.priorTtm), quarters: revYoy, accel, accelSpan: revYoy.length - 1 },
    netIncome: { ttm: ni.ttm, priorTtm: ni.priorTtm, growthPct: ni.priorTtm != null && ni.priorTtm > 0 ? growth(ni.ttm, ni.priorTtm) : null },
    netMargin: { ttm: pos(rev.ttm) && ni.ttm != null ? r1(ni.ttm / rev.ttm * 100) : null, priorTtm: pos(rev.priorTtm) && ni.priorTtm != null ? r1(ni.priorTtm / rev.priorTtm * 100) : null },
    fcf: {
      ttm: fcf.ttm, priorTtm: fcf.priorTtm, growthPct: fcf.priorTtm != null && fcf.priorTtm > 0 ? growth(fcf.ttm, fcf.priorTtm) : null,
      marginTtm: pos(rev.ttm) && fcf.ttm != null ? r1(fcf.ttm / rev.ttm * 100) : null,
      conversion: fcf.ttm != null && pos(ni.ttm) ? r2(fcf.ttm / ni.ttm) : null,
    },
    eps: { ttm: r2(epsTtm), priorTtm: r2(epsPrior), growthPct: epsPrior != null && epsPrior > 0 ? growth(epsTtm, epsPrior) : null },
    beats: {
      last: beatRows, n: beatRows.length, beat: beatRows.filter((b) => b.surprisePct > 0).length,
      avgSurprise: sur.length ? r1(sur.reduce((a, x) => a + x, 0) / sur.length) : null,
      longRun: lr && fnum(lr.epsN) ? { beat: lr.beat, n: lr.epsN, since: lr.since || null } : null,
    },
    analysts: {
      epsThisY: r2(epsThisY), epsNextY: epsNext ? r2(epsNext.value) : null, epsGrowthNextY: epsNext && pos(epsThisY) ? growth(epsNext.value, epsThisY) : null,
      epsGrowthCurY: fnum(f.growthEstimateCurY),
      revThisY: revThisY, revNextY: revNext ? revNext.value : null, revGrowthNextY: revNext && revThisY ? growth(revNext.value, revThisY) : r1(fwdRev),
      revision30: fnum(f.fyEpsRevision?.pct30), revision90: fnum(f.fyEpsRevision?.pct90),
      up30: fnum(f.epsRevisions?.y?.up30), down30: fnum(f.epsRevisions?.y?.down30),
      upgrades: fnum(f.analystRevisions?.upgrades), downgrades: fnum(f.analystRevisions?.downgrades), ratingWindowDays: fnum(f.analystRevisions?.windowDays),
    },
    ourForecast,
    multiples: mult,
    capital: { buybackYield, dividendYield, shareholderYield: buybackYield != null || dividendYield != null ? r2((buybackYield || 0) + (dividendYield || 0)) : null },
    options: iv ? { iv: r4(iv), ivPct: fnum(data?.ivRank?.pctile), moveYearPct: r1(iv * 100), asOf: data?.ivRank?.asOf || null } : {},
    reactions: lr && avgMove != null ? { avgAbsMove: r1(avgMove < 1 ? avgMove * 100 : avgMove), up: lr.up, n: lr.n, since: lr.since || null } : {},
  };
}

// Sector ETF excess return a year under each party in each office, from the
// party tracker rows, for the party scenarios.
export function partyContext({ kind = null, kindEtf = {}, partyRows = null, current = null, tiltOf = null }) {
  const etf = kind ? kindEtf[kind] : null;
  if (!etf || !Array.isArray(partyRows)) return null;
  const row = partyRows.find((r) => r.id === etf);
  if (!row?.offices) return null;
  const offices = {};
  for (const o of ["president", "house", "senate"]) {
    const cell = row.offices[o];
    if (!cell) continue;
    offices[o] = { D: fnum(cell.D?.excessAnnPct), R: fnum(cell.R?.excessAnnPct) };
  }
  if (!Object.keys(offices).length) return null;
  const label = current ? `${current.president || "?"} president, ${current.house || "?"} House, ${current.senate || "?"} Senate` : null;
  return { etf, kind, offices, current: label, currentTilt: current && tiltOf ? fnum(tiltOf(etf, current, partyRows)) : null };
}

// Inputs for one stock from the data the bake already holds.
export function valuationRow({ sym, data, sectorLabel = null, industry = null, band = null, sens = null, grade = null, forecast = null, forecastCompany = null, growthProfile = null, market = {}, peerPeg = null, party = null, nowMs = Date.now() }) {
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
  const ownOf = (k) => (peerRow[k]?.own ? { median: fnum(peerRow[k].own.median), p25: fnum(peerRow[k].own.p25), p75: fnum(peerRow[k].own.p75), pct: fnum(peerRow[k].own.pct), days: fnum(peerRow[k].own.days) } : null);
  const iv = pos(data?.ivRank?.iv);
  // The same four quarters for both, or neither (a revenue quarter missing
  // would mix periods).
  const fcfQ = ttmPair(f.fcfHistory), revQ = ttmPair(f.revenueHistory);
  const lastQ = (xs) => (Array.isArray(xs) ? xs.filter((r) => r?.date && fnum(r.value) != null).map((r) => r.date).sort().at(-1) : null) || null;
  const sameQ = fcfQ.ttm != null && pos(revQ.ttm) && lastQ(f.fcfHistory) === lastQ(f.revenueHistory);
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
      fcfTtm: sameQ ? fcfQ.ttm : null, revenueTtm: sameQ ? revQ.ttm : null,
      cash: fnum(f.totalCash), debt: fnum(f.totalDebt), shares, marketCap,
      trailingPE: pos(f.trailingPE), forwardPE: pos(f.forwardPE), trailingEps: r4(trailingEps), forwardEps: r4(forwardEps), forwardEpsSource,
      priceToSales: pos(f.priceToSales), priceToBook: fnum(f.priceToBook), bookPerShare: pos(f.priceToBook) ? r4(spot / f.priceToBook) : null,
      pegRatio: pos(f.pegRatio), beta: fnum(f.beta), roe: fnum(f.returnOnEquity), roa: fnum(f.returnOnAssets),
      grossMargin: fnum(f.grossMargin), operatingMargin: fnum(f.operatingMargin), profitMargin: fnum(f.profitMargin),
      revenueGrowthYoy: fnum(f.revenueGrowthYoy), earningsGrowthYoy: fnum(f.earningsGrowthYoy),
      growthEstimateCurY: fnum(f.growthEstimateCurY), fwdRevenueGrowth: fnum(fwdRevenueGrowth) != null ? Math.round(fwdRevenueGrowth * 10) / 10 : null,
      dividendYield: fnum(f.dividendYield), payoutRatio: fnum(f.payoutRatio), debtToEquity: fnum(f.debtToEquity),
      usShare: usRevenueShare(f.segments),
      currency: f.financialCurrency || null,
    },
    peers: {
      label: peerRow.peers?.label || null, basis: peerRow.peers?.basis || null, n: peerRow.peers?.n ?? null,
      members: Array.isArray(peerRow.peers?.members) ? peerRow.peers.members.slice(0, 12) : [],
      fpe: peerOf("fpe"), pe: peerOf("pe"), evs: peerOf("evs"), ps: peerOf("ps"), peg: pos(peerPeg),
      own: { fpe: peerRow.fpe?.own || null, evs: peerRow.evs?.own || null },
    },
    own: { fpe: ownOf("fpe"), evs: ownOf("evs"), ps: ownOf("ps") },
    street: { mean: pos(f.targetMeanPrice), low: pos(f.targetLowPrice), high: pos(f.targetHighPrice), n: fnum(f.numberOfAnalystOpinions), rating: f.recommendationKey || null },
    sens: sens ? {
      marketBeta: fnum(sens.vector?.marketBeta?.value), rate10y: fnum(sens.vector?.rate10y?.value), rate2y: fnum(sens.vector?.rate2y?.value),
      usd: fnum(sens.vector?.usd?.value), commodity: fnum(sens.vector?.commodity?.value), confidence: sens.confidence || null,
      rateSource: sens.vector?.rate10y?.source || null,
    } : null,
    optionsRange: iv ? { iv: r4(iv), lo: r2(spot * Math.exp(-iv)), hi: r2(spot * Math.exp(iv)), asOf: data?.ivRank?.asOf || null } : null,
    growthBars: growthProfile ? { label: growthProfile.label, low: growthProfile.rev?.low ?? null, above: growthProfile.rev?.above ?? null, wellAbove: growthProfile.rev?.wellAbove ?? null } : null,
    party,
    story: storyStats({ data, spot, band: peerRow, forecastCompany }),
    context: {
      revision30: fnum(f.fyEpsRevision?.pct30),
      grade: grade ? { total: fnum(grade.total), side: grade.side || null, macroPoints: fnum(grade.macroFit?.points), kind: grade.macroFit?.kind || null } : null,
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

export function buildValuationLab({ chains = {}, symbols = [], sectors = {}, industries = {}, bands = null, scenarioEngine = null, grades = null, earningsForecast = null, growthProfileOf = null, macro = null, rfrPct = null, partyTracker = null, partyNow = null, partyTilt = null, kindEtf = {}, kindOf = null, builtAtIso = new Date().toISOString(), streetBackup = null } = {}) {
  const lab = valuationLabFactory();
  const nowMs = Date.parse(builtAtIso) || Date.now();
  const sensBy = new Map((scenarioEngine?.sensitivities || []).map((s) => [s.symbol, s]));
  const fcCompanies = new Map((earningsForecast?.companies || []).map((c) => [c.symbol, c]));
  const market = {
    tenY: fnum(macro?.tenY?.value), twoY: fnum(macro?.twoY?.value), thirtyY: fnum(macro?.thirtyY?.value),
    rfr: fnum(rfrPct), asOf: macro?.asOf || null,
    recessionOdds: fnum(macro?.crowdGauges?.kalshiRecessionPct),
  };
  const pegOf = (s) => { const v = pos(chains[s]?.fundamentals?.pegRatio); return v && v <= 8 ? v : null; };
  const rows = {};
  const backupFilled = [];
  let skipped = 0;
  for (const sym of symbols) {
    if (sectors[sym] === "ETF") continue;
    const data = chains[sym];
    if (!data?.fundamentals) { skipped++; continue; }
    const gp = growthProfileOf ? growthProfileOf(sym, sectors[sym]) : null;
    const band = bands?.rows?.[sym] || null;
    const pegs = (band?.peers?.members || []).map(pegOf).filter((v) => v != null).sort((a, b) => a - b);
    const peerPeg = pegs.length >= 3 ? (pegs.length % 2 ? pegs[(pegs.length - 1) / 2] : (pegs[pegs.length / 2 - 1] + pegs[pegs.length / 2]) / 2) : null;
    const grade = grades?.[sym] || null;
    // The grade carries the macro kind; with the macro context off it does
    // not, so fall back to the same kind rule the grade uses.
    let kind = grade?.macroFit?.kind || null;
    if (!kind && typeof kindOf === "function") { try { kind = kindOf(sym) || null; } catch { kind = null; } }
    const party = partyContext({ kind, kindEtf, partyRows: partyTracker?.rows || null, current: partyNow, tiltOf: partyTilt });
    const fcCo = fcCompanies.get(sym) || null;
    const row = valuationRow({
      sym, data, sectorLabel: sectors[sym] || null, industry: industries[sym] || null,
      band, sens: sensBy.get(sym) || null, grade,
      forecast: forecastContext(fcCo), forecastCompany: fcCo, growthProfile: gp, market, peerPeg, party, nowMs,
    });
    if (!row) { skipped++; continue; }
    // Backup street target (Webull analyst target, Owner-only, 2026-11-19):
    // used only when Yahoo has no mean target, and labeled so the page says
    // "backup source". The Owner MCP strips it (lib/mcp/valuation-tools.mjs).
    const sb = streetBackup?.[sym];
    if (!(row.street?.mean > 0) && sb && pos(sb.mean)) {
      row.street = { mean: pos(sb.mean), low: pos(sb.low), high: pos(sb.high), n: null, rating: row.street?.rating || null, source: "webull-backup" };
      backupFilled.push(sym);
    }
    const def = lab.defaults(row);
    const res = lab.compute(row, def.inputs);
    const imp = lab.implied(row, def.inputs);
    const rng = lab.range(row, def.inputs, 200);
    row.base = {
      value: res.value != null ? Math.round(res.value * 100) / 100 : null,
      gapPct: res.gapPct != null ? Math.round(res.gapPct * 10) / 10 : null,
      methods: Object.fromEntries(lab.WEIGHT_KEYS.map((k) => [k, res.methods[k].value != null ? Math.round(res.methods[k].value * 100) / 100 : null])),
      impliedGrowth: imp.g1 != null ? Math.round(imp.g1 * 10) / 10 : null,
      impliedExitPE: imp.exitPE != null ? Math.round(imp.exitPE * 10) / 10 : null,
      aboveShare: rng ? Math.round(rng.aboveShare * 100) / 100 : null,
      p10: rng ? r2(rng.p10) : null, p90: rng ? r2(rng.p90) : null,
    };
    rows[sym] = row;
  }
  return {
    version: VALUATION_LAB_VERSION,
    builtAtIso,
    market,
    partyNow: partyNow || null,
    count: Object.keys(rows).length,
    skipped,
    rows,
    ...(backupFilled.length ? { streetBackupFilled: backupFilled } : {}),
    note: "Inputs come from the build's own data: Yahoo fundamentals and analyst estimates, the peer and own-history multiple bands, the Market Analysis sensitivities, the grade index, the Earnings Forecast, the SEC revenue split, option prices, the party tracker and the Kalshi recession market. Defaults are starting points to change, not a forecast. Display only; nothing here changes a pick, a grade or the Track Record.",
  };
}

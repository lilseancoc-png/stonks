// Valuation lab: Owner page (2026-11-17, Owner · Research, ?tab=valuation-lab).
// Renders the Owner-only valuation-lab.json written by every full bake
// (lib/valuation-lab.mjs) and recomputes every number in the browser with the
// same valuationLabFactory the bake and the MCP value_stock tool use, so a
// slider move updates the value, the gap read, the drivers, the football
// field and the rate x growth grid at once.
//
// Pasted into the app.js IIFE after renderQuantLabsJs(), so it reuses $,
// escapeHtml, dataUrl, quantFetchJson, VIEWS, rglEt and HAS_OWNER_ACCESS from
// that scope. Per-stock input changes are a per-device convenience in
// localStorage (stonks-valuation-v1); every read and write is guarded.
import { valuationLabFactory } from "../../lib/valuation-lab.mjs";

export function renderValuationLabJs() {
  return `
  // ---- Valuation lab (Owner page) --------------------------------------------
  var VL = (${valuationLabFactory.toString()})();
  var vlState = { data: null, error: null, pending: null, sym: null, inputs: null, defaults: null };
  var VL_STORE = 'stonks-valuation-v1';
  var VL_PRESETS = [
    ['base', 'Defaults', null],
    ['bear', 'Bear case', { g1: -5, epsGrowth: -5, epsShock: -20, erp: 1, peerPremium: -15, exitPE: -3 }],
    ['bull', 'Bull case', { g1: 5, epsGrowth: 5, epsShock: 10, erp: -0.5, peerPremium: 10, exitPE: 3 }],
    ['rates-up', 'Rates +100bp', { rateShiftBp: 100 }],
    ['rates-down', 'Rates -100bp', { rateShiftBp: -100 }],
    ['recession', 'Recession', { epsShock: -30, g1: -8, epsGrowth: -8, erp: 1.5, creditSpread: 2, peerPremium: -20 }]
  ];
  var VL_COLORS = { dcf: '#4f7cff', earnings: '#12a37f', peers: '#d98a1c', power: '#9b5de5', street: '#7a8699' };

  function vlFin(x){ return typeof x === 'number' && isFinite(x); }
  function vlMoney(x){ if (!vlFin(x)) return '—'; var a = Math.abs(x); return '$' + (a >= 1000 ? Math.round(x).toLocaleString('en-US') : a >= 100 ? x.toFixed(1) : x.toFixed(2)); }
  function vlPct(x, d){ return vlFin(x) ? (x > 0 ? '+' : '') + x.toFixed(d == null ? 1 : d) + '%' : '—'; }
  function vlNum(x, d){ return vlFin(x) ? Number(x).toFixed(d == null ? 1 : d) : '—'; }
  function vlBig(x){ if (!vlFin(x)) return '—'; var a = Math.abs(x), s = x < 0 ? '-' : ''; return a >= 1e12 ? s + '$' + (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? s + '$' + (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(0) + 'M' : s + '$' + a.toFixed(0); }
  function vlGapCls(x){ return !vlFin(x) ? '' : x >= 5 ? 'vl-up' : x <= -5 ? 'vl-down' : 'vl-flat'; }
  function vlFmtInput(def, v){ if (!vlFin(v)) return '—'; return def.unit === 'x' ? Number(v).toFixed(def.step < 0.1 ? 2 : 1) + 'x' : def.unit === 'bp' ? (v > 0 ? '+' : '') + Math.round(v) + 'bp' : def.unit === 'yrs' ? Math.round(v) + ' yrs' : def.unit === 'pp' ? (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' pts' : Number(v).toFixed(def.step < 0.1 ? 2 : def.step < 1 ? 2 : 1) + '%'; }

  function vlSaved(){ try { var raw = localStorage.getItem(VL_STORE); var o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  function vlSave(sym, inputs){ try { var o = vlSaved(); if (inputs) o[sym] = inputs; else delete o[sym]; localStorage.setItem(VL_STORE, JSON.stringify(o)); } catch (_) {} }
  function vlClone(o){ return JSON.parse(JSON.stringify(o)); }

  function vlFetch(force){
    if (!HAS_OWNER_ACCESS) return Promise.resolve(null);
    if (!force && vlState.data) return Promise.resolve(vlState.data);
    if (vlState.pending) return vlState.pending;
    vlState.error = null;
    vlState.pending = quantFetchJson(dataUrl('valuation-lab.json')).then(function(d){
      vlState.data = d && d.rows ? d : null; vlState.pending = null; return vlState.data;
    }, function(err){
      vlState.pending = null; vlState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err); return null;
    });
    return vlState.pending;
  }

  function vlSymbols(){
    var rows = (vlState.data && vlState.data.rows) || {};
    return Object.keys(rows).sort();
  }
  function vlRow(){ return vlState.data && vlState.sym ? vlState.data.rows[vlState.sym] : null; }

  function vlPick(sym){
    var rows = (vlState.data && vlState.data.rows) || {};
    if (!rows[sym]) sym = rows.NVDA ? 'NVDA' : vlSymbols()[0];
    if (!sym) return;
    vlState.sym = sym;
    VIEWS.set('valuation-lab.symbol', sym);
    var def = VL.defaults(rows[sym]);
    vlState.defaults = def;
    var saved = vlSaved()[sym];
    vlState.inputs = saved && typeof saved === 'object' ? VL.normalize(Object.assign(vlClone(def.inputs), saved, { weights: Object.assign({}, def.inputs.weights, saved.weights || {}) })) : vlClone(def.inputs);
  }

  // ---- Pieces ----------------------------------------------------------------
  function vlKpis(row, a){
    var r = a.result, imp = a.implied;
    var k = [
      ['Market price', vlMoney(row.spot), row.name],
      ['Modeled value', vlMoney(r.value), r.macroPct ? 'macro dials ' + vlPct(r.macroPct) : r.used.length + ' method' + (r.used.length === 1 ? '' : 's') + ' blended'],
      ['Gap', '<span class="' + vlGapCls(r.gapPct) + '">' + vlPct(r.gapPct) + '</span>', vlFin(r.gapPct) ? (r.gapPct >= 0 ? 'model above market' : 'model below market') : ''],
      ['Price implies growth', vlFin(imp.g1) ? vlNum(imp.g1) + '%' : '—', 'first-year revenue growth; you use ' + vlNum(r.inputs.g1) + '%'],
      ['Cost of equity', vlNum(r.rates.ke, 2) + '%', '10-year ' + vlNum(r.rates.rf, 2) + '% + ' + vlNum(r.inputs.beta, 2) + ' beta x ' + vlNum(r.inputs.erp, 2) + '% premium']
    ];
    return '<div class="mm-kpis vl-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '<small>' + escapeHtml(x[2] || '') + '</small></b></div>'; }).join('') + '</div>';
  }

  // Football field: each method's value at the base inputs (dot) and across
  // rates +-100bp and growth +-6 points (bar), with the market price and the
  // blend as vertical lines.
  function vlField(row, a){
    var base = a.result, corners = [];
    [[-100, -6], [-100, 6], [100, -6], [100, 6]].forEach(function(c){
      var dd = vlClone(base.inputs); dd.rateShiftBp = Math.max(-300, Math.min(300, dd.rateShiftBp + c[0])); dd.g1 = dd.g1 + c[1]; dd.epsGrowth = dd.epsGrowth + c[1];
      corners.push(VL.compute(row, dd));
    });
    var lines = [], all = [row.spot];
    VL.METHODS.forEach(function(m){
      var v = base.methods[m.key].value; if (!vlFin(v)) return;
      var vals = [v]; corners.forEach(function(c){ var x = c.methods[m.key].value; if (vlFin(x)) vals.push(x); });
      if (m.key === 'street' && vlFin(row.street.low) && vlFin(row.street.high)) vals = [row.street.low, row.street.high, v];
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      lines.push({ key: m.key, label: m.short || m.label, v: v, lo: lo, hi: hi, w: base.weightShares[m.key] || 0 }); all.push(lo, hi);
    });
    if (vlFin(base.value)) all.push(base.value);
    if (!lines.length) return '';
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), pad = (mx - mn) * 0.06 || mx * 0.1;
    mn = Math.max(0, mn - pad); mx = mx + pad;
    var W = 720, L = 190, R = 16, rowH = 30, H = lines.length * rowH + 44;
    function X(v){ return L + (v - mn) / (mx - mn) * (W - L - R); }
    var s = '<svg class="vl-field" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Value by method compared with the market price">';
    var ticks = 5;
    for (var t = 0; t <= ticks; t++){ var tv = mn + (mx - mn) * t / ticks, tx = X(tv); s += '<line x1="' + tx + '" x2="' + tx + '" y1="8" y2="' + (H - 26) + '" class="vl-grid"/><text x="' + tx + '" y="' + (H - 10) + '" text-anchor="middle" class="vl-tick">' + escapeHtml(vlMoney(tv)) + '</text>'; }
    lines.forEach(function(l, i){
      var y = 14 + i * rowH;
      s += '<text x="' + (L - 10) + '" y="' + (y + 12) + '" text-anchor="end" class="vl-lbl">' + escapeHtml(l.label) + (l.w ? ' · ' + Math.round(l.w * 100) + '%' : ' · off') + '</text>';
      s += '<rect x="' + X(l.lo) + '" y="' + (y + 3) + '" width="' + Math.max(2, X(l.hi) - X(l.lo)) + '" height="14" rx="4" fill="' + VL_COLORS[l.key] + '" opacity="' + (l.w ? 0.32 : 0.14) + '"><title>' + escapeHtml(l.label + ': ' + vlMoney(l.lo) + ' to ' + vlMoney(l.hi)) + '</title></rect>';
      s += '<circle cx="' + X(l.v) + '" cy="' + (y + 10) + '" r="6" fill="' + VL_COLORS[l.key] + '" opacity="' + (l.w ? 1 : 0.45) + '"><title>' + escapeHtml(l.label + ': ' + vlMoney(l.v)) + '</title></circle>';
    });
    var mxp = X(row.spot);
    s += '<line x1="' + mxp + '" x2="' + mxp + '" y1="4" y2="' + (H - 24) + '" class="vl-mkt"/><text x="' + mxp + '" y="' + 2 + '" dy="8" dx="4" class="vl-mkt-t">Market ' + escapeHtml(vlMoney(row.spot)) + '</text>';
    if (vlFin(base.value)){ var bx = X(base.value); s += '<line x1="' + bx + '" x2="' + bx + '" y1="4" y2="' + (H - 24) + '" class="vl-blend"/><text x="' + bx + '" y="' + (H - 26) + '" dx="4" class="vl-blend-t">Model ' + escapeHtml(vlMoney(base.value)) + '</text>'; }
    return s + '</svg><p class="vl-cap">Dot = value at your inputs. Bar = range with rates 100bp lower to higher and growth 6 points lower to higher (street: analysts\\' low to high target). Percent = share of the blend.</p>';
  }

  function vlMethodsTable(row, a){
    var r = a.result;
    var body = VL.METHODS.map(function(m){
      var x = r.methods[m.key], v = x.value, gap = vlFin(v) && row.spot > 0 ? (v / row.spot - 1) * 100 : null, w = r.inputs.weights[m.key];
      var detail = '';
      if (m.key === 'dcf' && vlFin(v)) detail = 'Discount rate ' + vlNum(x.discount, 2) + '%; ' + Math.round((x.terminalShare || 0) * 100) + '% of value after year ' + r.inputs.years;
      if (m.key === 'earnings' && vlFin(v)) detail = 'EPS ' + vlMoney(x.eps0) + ' now → ' + vlMoney(x.eps3) + ' in 3 years at ' + vlNum(r.inputs.exitPE) + 'x; ' + escapeHtml(x.epsSource || '');
      if (m.key === 'peers' && vlFin(v)) detail = (x.parts || []).map(function(p){ return escapeHtml(p.label) + ' → ' + vlMoney(p.value); }).join(' · ') + (x.basis ? ' (' + escapeHtml(x.basis) + ', ' + (x.n || 0) + ' peers)' : '');
      if (m.key === 'power' && vlFin(v)) detail = 'Justified P/E ' + vlNum(x.justifiedPE) + 'x at a ' + vlNum(r.rates.ke, 2) + '% cost of equity, ROE ' + vlNum(r.inputs.roe) + '%';
      if (m.key === 'street' && vlFin(v)) detail = vlMoney(x.low) + ' to ' + vlMoney(x.high) + (x.n ? ' · ' + x.n + ' analysts' : '') + (row.street.rating ? ' · ' + escapeHtml(row.street.rating) : '');
      if (!vlFin(v)) detail = escapeHtml(x.reason || 'Not available');
      return '<tr><td><span class="vl-sw" style="background:' + VL_COLORS[m.key] + '"></span>' + escapeHtml(m.label) + '<div class="vl-detail">' + detail + '</div></td>' +
        '<td class="num">' + vlMoney(v) + '</td><td class="num ' + vlGapCls(gap) + '">' + vlPct(gap) + '</td>' +
        '<td class="vl-wcell"><input type="range" min="0" max="100" step="5" value="' + w + '" data-vl-weight="' + m.key + '" aria-label="Weight for ' + escapeHtml(m.label) + '"' + (vlFin(v) ? '' : ' disabled') + '><span class="vl-wv" data-vl-wv="' + m.key + '">' + w + '</span></td>' +
        '<td class="num">' + (r.weightShares[m.key] ? Math.round(r.weightShares[m.key] * 100) + '%' : '—') + '</td></tr>';
    }).join('');
    return '<div class="acc-tscroll"><table class="acc-qtable vl-table" data-nosort><thead><tr><th>Method</th><th class="num">Value</th><th class="num">vs market</th><th>Weight</th><th class="num">Share</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function vlInputsHtml(){
    var d = vlState.inputs, src = vlState.defaults.sources, defs = vlState.defaults.inputs, groups = {}, order = [];
    VL.INPUTS.forEach(function(def){ if (!groups[def.group]){ groups[def.group] = []; order.push(def.group); } groups[def.group].push(def); });
    var row = vlRow();
    return order.map(function(g){
      return '<fieldset class="vl-group"><legend>' + escapeHtml(g) + '</legend>' + groups[g].map(function(def){
        var changed = Math.abs((d[def.key] || 0) - (defs[def.key] || 0)) > 1e-9;
        var hint = 'Default ' + vlFmtInput(def, defs[def.key]) + ' · ' + (src[def.key] || '');
        if (def.key === 'g1' && row && row.growthBars) hint += ' · ' + row.growthBars.label + ' bars: normal ' + (row.growthBars.low == null ? '—' : row.growthBars.low + '%') + ', strong ' + row.growthBars.above + '%, very strong ' + row.growthBars.wellAbove + '%';
        if (def.key === 'usdPct' && row && row.sens && vlFin(row.sens.usd)) hint += ' · this stock moves about ' + vlNum(row.sens.usd, 2) + '% per 1% dollar move';
        if (def.key === 'oilPct' && row && row.sens && vlFin(row.sens.commodity)) hint += ' · about ' + vlNum(row.sens.commodity, 2) + '% per 1% oil move';
        if (def.key === 'rateShiftBp' && row && row.sens && vlFin(row.sens.rate10y)) hint += ' · past response ' + vlNum(row.sens.rate10y, 2) + '% per 10bp';
        return '<label class="vl-in' + (changed ? ' vl-changed' : '') + '"><span class="vl-in-l">' + escapeHtml(def.label) + '<b data-vl-iv="' + def.key + '">' + escapeHtml(vlFmtInput(def, d[def.key])) + '</b></span>' +
          '<input type="range" min="' + def.min + '" max="' + def.max + '" step="' + def.step + '" value="' + d[def.key] + '" data-vl-input="' + def.key + '" aria-label="' + escapeHtml(def.label) + '">' +
          '<small>' + escapeHtml(hint) + '</small></label>';
      }).join('') + '</fieldset>';
    }).join('');
  }

  function vlReadHtml(a){
    var e = a.explain;
    function list(title, xs){ return xs && xs.length ? '<div class="vl-read-b"><h4 class="slp-h4">' + escapeHtml(title) + '</h4><ul class="ql-lines">' + xs.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul></div>' : ''; }
    return '<p class="vl-headline">' + escapeHtml(e.headline) + '</p><div class="vl-read">' +
      list('What today\\'s price assumes', e.priced) + list('Where the methods disagree', e.disagree) +
      list('What the market may be seeing', e.market) + list('What the model may be missing', e.us) + '</div>';
  }

  function vlDriversHtml(a){
    var ds = a.drivers.slice(0, 8), base = a.result.value;
    if (!ds.length || !vlFin(base)) return '<p class="hint">No single input moves the value much at these settings.</p>';
    var mx = 0; ds.forEach(function(d){ mx = Math.max(mx, Math.abs(d.low - base), Math.abs(d.high - base)); });
    return '<div class="vl-tornado">' + ds.map(function(d){
      var lo = Math.min(d.low, d.high) - base, hi = Math.max(d.low, d.high) - base;
      var left = 50 + lo / mx * 50, width = Math.max(0.6, (hi - lo) / mx * 50);
      var stepTxt = d.unit === 'x' ? d.step + 'x' : d.unit === '%' || d.unit === 'pp' ? d.step + ' pts' : d.step + ' ' + d.unit;
      return '<div class="vl-tr"><span class="vl-tr-l">' + escapeHtml(d.label) + ' <small>± ' + escapeHtml(stepTxt) + '</small></span>' +
        '<span class="vl-tr-bar"><i style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></i><em></em></span>' +
        '<span class="vl-tr-v">' + vlMoney(Math.min(d.low, d.high)) + ' – ' + vlMoney(Math.max(d.low, d.high)) + '</span></div>';
    }).join('') + '</div><p class="vl-cap">Each input moved down and up by the step shown, everything else held. Center line = the modeled value ' + vlMoney(base) + '.</p>';
  }

  function vlGridHtml(row, a){
    var g = a.grid;
    var head = '<tr><th>First-year growth</th>' + g.shifts.map(function(s){ return '<th class="num">' + (s === 0 ? 'Rates now' : (s > 0 ? '+' : '') + s + 'bp') + '</th>'; }).join('') + '</tr>';
    var body = g.rows.map(function(r){
      return '<tr' + (r.growthDelta === 0 ? ' class="vl-base"' : '') + '><td>' + vlNum(r.g1) + '%' + (r.growthDelta ? ' <small>(' + (r.growthDelta > 0 ? '+' : '') + r.growthDelta + ')</small>' : ' <small>(yours)</small>') + '</td>' + r.cells.map(function(c, i){
        var gap = vlFin(c) ? (c / row.spot - 1) * 100 : null;
        return '<td class="num ' + vlGapCls(gap) + (r.growthDelta === 0 && g.shifts[i] === 0 ? ' vl-here' : '') + '" title="' + escapeHtml(vlPct(gap) + ' vs market') + '">' + vlMoney(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="acc-tscroll"><table class="acc-qtable vl-grid-t" data-nosort><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div><p class="vl-cap">Blended value with the 10-year yield moved (columns) and revenue and EPS growth moved together (rows). Green = above the market price by 5%+, red = below by 5%+.</p>';
  }

  function vlFactsHtml(row, a){
    var f = row.facts, p = row.peers, r = a.result;
    var items = [
      ['Revenue (trailing)', vlBig(f.revenue)], ['Free cash flow', vlBig(f.fcf)], ['Cash / debt', vlBig(f.cash) + ' / ' + vlBig(f.debt)],
      ['Shares', vlFin(f.shares) ? (f.shares / 1e9).toFixed(2) + 'B' : '—'], ['P/E trailing / forward', vlNum(f.trailingPE) + 'x / ' + vlNum(f.forwardPE) + 'x'],
      ['Peers (' + escapeHtml(p.label || 'none') + ')', 'fwd P/E ' + vlNum(p.fpe) + 'x · EV/sales ' + vlNum(p.evs) + 'x · P/S ' + vlNum(p.ps) + 'x'],
      ['Peer names', escapeHtml((p.members || []).join(', ') || '—')],
      ['Rates', '10-year ' + vlNum(row.market.tenY, 2) + '% · 2-year ' + vlNum(row.market.twoY, 2) + '% · WACC ' + vlNum(r.rates.wacc, 2) + '%'],
      ['Measured sensitivity', row.sens ? 'beta ' + vlNum(row.sens.marketBeta, 2) + ' · ' + vlNum(row.sens.rate10y, 2) + '% per 10bp · ' + vlNum(row.sens.usd, 2) + ' dollar · ' + vlNum(row.sens.commodity, 2) + ' oil' : 'not measured'],
      ['Site grade', row.context.grade && vlFin(row.context.grade.total) ? (row.context.grade.total > 0 ? '+' : '') + row.context.grade.total.toFixed(1) + (row.context.grade.side ? ' ' + row.context.grade.side : '') : '—']
    ];
    return '<dl class="vl-facts">' + items.map(function(x){ return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>';
  }

  function vlScreenHtml(){
    var rows = (vlState.data && vlState.data.rows) || {};
    var list = Object.keys(rows).map(function(s){ var b = rows[s].base || {}; return { s: s, name: rows[s].name, gap: b.gapPct, v: b.value, spot: rows[s].spot, ig: b.impliedGrowth }; }).filter(function(x){ return vlFin(x.gap); });
    list.sort(function(a, b){ return b.gap - a.gap; });
    if (!list.length) return '';
    function rowHtml(x){ return '<tr><td><button type="button" class="ql-linkbtn" data-vl-go="' + escapeHtml(x.s) + '">' + escapeHtml(x.s) + '</button> <small>' + escapeHtml(x.name || '') + '</small></td><td class="num">' + vlMoney(x.spot) + '</td><td class="num">' + vlMoney(x.v) + '</td><td class="num ' + vlGapCls(x.gap) + '">' + vlPct(x.gap) + '</td><td class="num">' + (vlFin(x.ig) ? vlNum(x.ig) + '%' : '—') + '</td></tr>'; }
    var head = '<thead><tr><th>Stock</th><th class="num">Market</th><th class="num">Model</th><th class="num">Gap</th><th class="num">Price implies growth</th></tr></thead>';
    return '<details class="vl-screen"><summary>All covered stocks at default inputs (' + list.length + ')</summary><div class="acc-tscroll"><table class="acc-qtable vl-table">' + head + '<tbody>' + list.map(rowHtml).join('') + '</tbody></table></div><p class="vl-cap">Defaults only, from the last build. A big gap at defaults is a question to ask, not a signal: open the stock and check which inputs drive it.</p></details>';
  }

  // ---- Render ----------------------------------------------------------------
  function renderValuationLab(){
    var root = $('valuation-lab-root'); if (!root) return;
    if (!vlState.data){ root.innerHTML = '<p class="hint">' + (vlState.error ? 'The lab could not be loaded (' + escapeHtml(vlState.error) + '). Every full build writes it; the first one after this deploys creates the file.' : 'Loading…') + '</p>'; return; }
    if (!vlState.sym){
      var want = null;
      try { want = (new URLSearchParams(location.search).get('symbol') || '').toUpperCase() || null; } catch (_) {}
      vlPick(want || VIEWS.get('valuation-lab.symbol', 'NVDA'));
    }
    var row = vlRow(); if (!row){ root.innerHTML = '<p class="hint">No stock has valuation inputs yet.</p>'; return; }
    var opts = vlSymbols().map(function(s){ var r = vlState.data.rows[s]; return '<option value="' + escapeHtml(s) + '"' + (s === vlState.sym ? ' selected' : '') + '>' + escapeHtml(s + ' · ' + (r.name || '')) + '</option>'; }).join('');
    var presets = VL_PRESETS.map(function(p){ return '<button type="button" class="vl-preset" data-vl-preset="' + p[0] + '">' + escapeHtml(p[1]) + '</button>'; }).join('');
    root.innerHTML = '<div class="vl-bar"><label class="vl-pick">Stock <select data-vl-sym aria-label="Stock to value">' + opts + '</select></label><div class="vl-presets" role="group" aria-label="Scenarios">' + presets + '</div><a class="book-more" href="?tab=stock&s=' + encodeURIComponent(vlState.sym) + '">Stock page</a></div>' +
      '<div class="vl-sticky" id="vl-sticky" aria-live="polite"></div><div class="vl-layout"><div class="vl-main" id="vl-out"></div><aside class="vl-side"><h4 class="slp-h4">Inputs <button type="button" class="ql-linkbtn" data-vl-reset>Reset</button></h4><div id="vl-inputs">' + vlInputsHtml() + '</div></aside></div>' +
      vlScreenHtml() +
      '<p class="evb-note">Display only: nothing here changes a pick, a grade or the Track Record. Inputs from the ' + escapeHtml(rglEt(vlState.data.builtAtIso)) + ' build; your changes are kept on this device only.</p>';
    vlRenderOut();
  }

  function vlRenderOut(){
    var out = $('vl-out'), row = vlRow(); if (!out || !row) return;
    var a = VL.analyze(row, vlState.inputs);
    var st = $('vl-sticky');
    if (st) st.innerHTML = '<span>Market <b>' + vlMoney(row.spot) + '</b></span><span>Model <b>' + vlMoney(a.result.value) + '</b></span><span>Gap <b class="' + vlGapCls(a.result.gapPct) + '">' + vlPct(a.result.gapPct) + '</b></span>';
    out.innerHTML = vlKpis(row, a) +
      '<div class="vl-card">' + vlField(row, a) + '</div>' +
      '<div class="vl-card">' + vlReadHtml(a) + '</div>' +
      '<h4 class="slp-h4">Methods and weights</h4>' + vlMethodsTable(row, a) +
      '<h4 class="slp-h4">What moves the answer most</h4>' + vlDriversHtml(a) +
      '<h4 class="slp-h4">Rates x growth</h4>' + vlGridHtml(row, a) +
      '<h4 class="slp-h4">The numbers underneath</h4>' + vlFactsHtml(row, a);
  }

  function vlSync(){
    var d = vlState.inputs, defs = vlState.defaults.inputs;
    VL.INPUTS.forEach(function(def){
      var b = document.querySelector('[data-vl-iv="' + def.key + '"]'); if (b) b.textContent = vlFmtInput(def, d[def.key]);
      var inp = document.querySelector('[data-vl-input="' + def.key + '"]');
      if (inp){ if (String(inp.value) !== String(d[def.key])) inp.value = d[def.key]; var lab = inp.closest('.vl-in'); if (lab) lab.classList.toggle('vl-changed', Math.abs((d[def.key] || 0) - (defs[def.key] || 0)) > 1e-9); }
    });
  }

  var vlTimer = null;
  function vlChanged(){
    var same = JSON.stringify(vlState.inputs) === JSON.stringify(vlState.defaults.inputs);
    vlSave(vlState.sym, same ? null : vlState.inputs);
    if (vlTimer) cancelAnimationFrame(vlTimer);
    vlTimer = requestAnimationFrame(function(){ vlTimer = null; vlRenderOut(); });
  }

  function loadValuationLab(force){
    var status = $('valuation-lab-status');
    if (status && !vlState.data) status.textContent = 'Loading the lab…';
    renderValuationLab();
    vlFetch(force).then(function(d){
      if (status) status.textContent = d ? d.count + ' stocks · inputs from the ' + rglEt(d.builtAtIso) + ' build.' : (vlState.error === 'not written yet' ? 'No valuation file yet. The next full build writes it.' : 'The lab is not available right now.');
      renderValuationLab();
    });
  }

  document.addEventListener('input', function(ev){
    var t = ev.target; if (!t || !t.closest || !t.closest('#valuation-lab-root') || !vlState.inputs) return;
    var k = t.getAttribute('data-vl-input');
    if (k){ vlState.inputs[k] = Number(t.value); vlState.inputs = VL.normalize(vlState.inputs); vlSync(); vlChanged(); return; }
    var w = t.getAttribute('data-vl-weight');
    if (w){ vlState.inputs.weights[w] = Number(t.value); var wv = document.querySelector('[data-vl-wv="' + w + '"]'); if (wv) wv.textContent = t.value; vlChanged(); }
  });
  document.addEventListener('change', function(ev){
    var t = ev.target; if (!t || !t.matches || !t.matches('[data-vl-sym]')) return;
    vlPick(t.value); renderValuationLab();
  });
  document.addEventListener('click', function(ev){
    var t = ev.target; if (!t || !t.closest || !t.closest('#valuation-lab-root')) return;
    var go = t.closest('[data-vl-go]');
    if (go){ vlPick(go.getAttribute('data-vl-go')); renderValuationLab(); var root = $('valuation-lab-root'); if (root && root.scrollIntoView) root.scrollIntoView({ block: 'start' }); return; }
    if (t.closest('[data-vl-reset]')){ vlState.inputs = vlClone(vlState.defaults.inputs); vlSave(vlState.sym, null); $('vl-inputs').innerHTML = vlInputsHtml(); vlRenderOut(); return; }
    var pr = t.closest('[data-vl-preset]');
    if (pr){
      var id = pr.getAttribute('data-vl-preset'), p = null;
      VL_PRESETS.forEach(function(x){ if (x[0] === id) p = x[2]; });
      var next = vlClone(vlState.defaults.inputs);
      if (p) for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) next[k] = next[k] + p[k];
      vlState.inputs = VL.normalize(next); $('vl-inputs').innerHTML = vlInputsHtml(); vlChanged();
    }
  });
`;
}

// Insider cluster buying (2026-11-08, brainstorm F6).
//
// Marks names where several different insiders bought on the open market
// (SEC Form 4 code P) inside a short window. One rule for the bake (stamped on
// 13f.json as insiderTransactions.clusterBuying) and the browser (Who owns
// what, the stock page), so the factory is ES5 and self-contained: app.js
// embeds it with Function.prototype.toString(). Pure; no fetch, no AI.
//
// Default rule: 3 or more distinct reporting owners, open-market purchases,
// transaction dates within the trailing 30 days of `asOf` (the payload's
// own stamp, never the browser clock, so a stale snapshot does not invent or
// drop a cluster). Grants, exercises, gifts and tax withholding never count.

export function insiderClusterFactory() {
  var DAY = 86400000;
  var WINDOW_DAYS = 30;
  var MIN_INSIDERS = 3;
  function dayMs(iso) {
    var s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var t = Date.parse(s + 'T12:00:00Z');
    return isFinite(t) ? t : null;
  }
  function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function whoKey(t) {
    var name = String(t.ownerName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name && name !== 'reporting owner') return name;
    return t.ownerCik ? 'cik:' + t.ownerCik : null;
  }
  // transactions: Form 4 rows ({symbol, ownerName, transactionDate, direction,
  // openMarket, shares, value, roles}). opts: { asOf, windowDays, minInsiders,
  // direction ('buy' | 'sell') }. Returns { asOf, windowDays, minInsiders,
  // direction, rows: [{ symbol, insiders, names, roles, trades, shares,
  // value, firstDate, lastDate, spanDays }] } sorted by insiders, then value.
  function clusters(transactions, opts) {
    opts = opts || {};
    var windowDays = Number(opts.windowDays) > 0 ? Number(opts.windowDays) : WINDOW_DAYS;
    var minInsiders = Number(opts.minInsiders) > 0 ? Number(opts.minInsiders) : MIN_INSIDERS;
    var direction = opts.direction === 'sell' ? 'sell' : 'buy';
    var rows = Array.isArray(transactions) ? transactions : [];
    var asOf = dayMs(opts.asOf);
    if (asOf == null) {
      for (var i = 0; i < rows.length; i++) {
        var ms0 = rows[i] ? dayMs(rows[i].transactionDate) : null;
        if (ms0 != null && (asOf == null || ms0 > asOf)) asOf = ms0;
      }
    }
    if (asOf == null) return { asOf: null, windowDays: windowDays, minInsiders: minInsiders, direction: direction, rows: [] };
    var cutoff = asOf - windowDays * DAY;
    var by = {};
    for (var k = 0; k < rows.length; k++) {
      var t = rows[k];
      if (!t || !t.symbol || !t.openMarket || t.direction !== direction) continue;
      var ms = dayMs(t.transactionDate);
      if (ms == null || ms < cutoff || ms > asOf + DAY) continue;
      var who = whoKey(t);
      if (!who) continue;
      var sym = String(t.symbol).toUpperCase();
      var g = by[sym];
      if (!g) g = by[sym] = { symbol: sym, who: {}, names: [], roles: {}, trades: 0, shares: 0, value: 0, first: ms, last: ms };
      if (!g.who[who]) { g.who[who] = 1; g.names.push(String(t.ownerName || 'Reporting owner').trim()); }
      var rl = Array.isArray(t.roles) ? t.roles : [];
      for (var r = 0; r < rl.length; r++) if (rl[r]) g.roles[String(rl[r])] = 1;
      g.trades++;
      g.shares += Number(t.shares) > 0 ? Number(t.shares) : 0;
      g.value += Number(t.value) > 0 ? Number(t.value) : 0;
      if (ms < g.first) g.first = ms;
      if (ms > g.last) g.last = ms;
    }
    var out = [];
    for (var s in by) {
      if (!Object.prototype.hasOwnProperty.call(by, s)) continue;
      var c = by[s];
      var n = Object.keys(c.who).length;
      if (n < minInsiders) continue;
      out.push({
        symbol: c.symbol,
        insiders: n,
        names: c.names.slice(0, 8),
        roles: Object.keys(c.roles).slice(0, 6),
        trades: c.trades,
        shares: Math.round(c.shares),
        value: Math.round(c.value),
        firstDate: isoOf(c.first),
        lastDate: isoOf(c.last),
        spanDays: Math.round((c.last - c.first) / DAY)
      });
    }
    out.sort(function (a, b) { return b.insiders - a.insiders || b.value - a.value || a.symbol.localeCompare(b.symbol); });
    return { asOf: isoOf(asOf), windowDays: windowDays, minInsiders: minInsiders, direction: direction, rows: out };
  }
  // One sentence for a chip or a stock-page line.
  function sentence(row) {
    if (!row) return '';
    var v = Number(row.value) || 0;
    var money = v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : v > 0 ? '$' + Math.round(v) : 'an undisclosed amount';
    var span = row.spanDays <= 0 ? 'on one day' : 'over ' + row.spanDays + ' day' + (row.spanDays === 1 ? '' : 's');
    return row.insiders + ' insiders bought ' + money + ' on the open market ' + span + ' (' + row.trades + ' trade' + (row.trades === 1 ? '' : 's') + ', last ' + row.lastDate + ').';
  }
  return { WINDOW_DAYS: WINDOW_DAYS, MIN_INSIDERS: MIN_INSIDERS, clusters: clusters, sentence: sentence };
}

export const INSIDER_CLUSTER = insiderClusterFactory();
export function findInsiderClusters(transactions, opts) { return INSIDER_CLUSTER.clusters(transactions, opts); }

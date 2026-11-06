// Owner watchlist alerts (2026-11-06). For each name on the Owner's stock
// watchlist, three plain checks against data the site already publishes:
//   ma    the price crossed its 50- or 200-day average since the prior close
//         (ma-tracker.json levels + prior-close distances, live price when the
//         market is open);
//   wall  the price reached or passed its open-interest call or put wall
//         (oi-tracker.json walls, front two expirations);
//   flow  an unusual options trade printed today (unusual.json flags).
// No AI, no new fetches beyond the public files and the open /api/quotes.
// The alerts show only to an Owner (Home "Your desk" and the stock picker);
// nothing is sent anywhere.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function watchlistAlertsFactory() {
  // Within this distance of a wall counts as "at the wall".
  var WALL_NEAR_PCT = 0.75;
  var MA_PERIODS = [50, 200];
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function money(v) {
    return '$' + v.toFixed(2);
  }
  function strike(v) {
    return '$' + (Math.round(v) === v ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  }
  function bySymbol(list) {
    var out = {};
    for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].symbol) out[String(list[i].symbol).toUpperCase()] = list[i];
    return out;
  }
  function premiumText(p) {
    if (!(p > 0)) return '';
    if (p >= 1e6) return '$' + (p / 1e6).toFixed(p >= 1e7 ? 0 : 1) + 'M';
    if (p >= 1e3) return '$' + Math.round(p / 1e3) + 'K';
    return '$' + Math.round(p);
  }
  // input: { watch: [sym], ma, oi, unusual, quotes: { SYM: { spot } } }
  // Returns [{ symbol, kind: 'ma'|'wall'|'flow', dir: 'up'|'down'|null, text, at }]
  // in watchlist order, crosses first within a name.
  function build(input) {
    input = input || {};
    var watch = input.watch || [];
    var ma = bySymbol(input.ma && input.ma.tickers);
    var oi = bySymbol(input.oi && input.oi.tickers);
    var flow = bySymbol(input.unusual && input.unusual.tickers);
    var quotes = input.quotes || {};
    var out = [];
    for (var i = 0; i < watch.length; i++) {
      var sym = String(watch[i] || '').toUpperCase();
      if (!sym) continue;
      var live = quotes[sym] && num(quotes[sym].spot) > 0 ? num(quotes[sym].spot) : null;
      var m = ma[sym];
      if (m && m.levels) {
        var spot = live || num(m.spot);
        for (var k = 0; k < MA_PERIODS.length; k++) {
          var p = MA_PERIODS[k];
          var lvl = num(m.levels[p]);
          var prev = num(m.previousDistances && m.previousDistances[p]);
          if (!(spot > 0) || !(lvl > 0) || prev == null) continue;
          var now = (spot / lvl - 1) * 100;
          if (prev < 0 && now >= 0) out.push({ symbol: sym, kind: 'ma', dir: 'up', at: input.ma.builtAtIso || null, live: !!live,
            text: 'Crossed above its ' + p + '-day average (' + money(lvl) + '); price ' + money(spot) + ', ' + (now >= 0 ? '+' : '') + now.toFixed(1) + '%.' });
          else if (prev >= 0 && now < 0) out.push({ symbol: sym, kind: 'ma', dir: 'down', at: input.ma.builtAtIso || null, live: !!live,
            text: 'Crossed below its ' + p + '-day average (' + money(lvl) + '); price ' + money(spot) + ', ' + now.toFixed(1) + '%.' });
        }
      }
      var o = oi[sym];
      if (o) {
        var s2 = live || num(o.spot);
        var cw = num(o.callWall && o.callWall.strike), pw = num(o.putWall && o.putWall.strike);
        if (s2 > 0 && cw > 0 && s2 >= cw * (1 - WALL_NEAR_PCT / 100)) out.push({ symbol: sym, kind: 'wall', dir: 'up', at: input.oi.scannedAt || null, live: !!live,
          text: (s2 > cw ? 'Above its call wall at ' : 'At its call wall, ') + strike(cw) + ' (price ' + money(s2) + '). Calls there can slow a rise.' });
        if (s2 > 0 && pw > 0 && s2 <= pw * (1 + WALL_NEAR_PCT / 100)) out.push({ symbol: sym, kind: 'wall', dir: 'down', at: input.oi.scannedAt || null, live: !!live,
          text: (s2 < pw ? 'Below its put wall at ' : 'At its put wall, ') + strike(pw) + ' (price ' + money(s2) + '). Puts there can slow a fall.' });
      }
      var f = flow[sym];
      var cs = f && f.contracts && f.contracts.length ? f.contracts : null;
      if (cs) {
        var top = null, calls = 0, puts = 0;
        for (var j = 0; j < cs.length; j++) {
          var c = cs[j] || {};
          if (c.side === 'put') puts++; else calls++;
          if (!top || (num(c.premium) || 0) > (num(top.premium) || 0)) top = c;
        }
        var desc = top && num(top.strike) != null ? strike(num(top.strike)) + ' ' + (top.side === 'put' ? 'put' : 'call') + (top.expiryLabel ? ' ' + top.expiryLabel : '') : '';
        var prem = premiumText(num(top && top.premium));
        out.push({ symbol: sym, kind: 'flow', dir: calls > puts ? 'up' : puts > calls ? 'down' : null, at: input.unusual.scannedAt || null, live: false,
          text: cs.length + ' unusual option trade' + (cs.length === 1 ? '' : 's') + ' today (' + calls + ' call' + (calls === 1 ? '' : 's') + ', ' + puts + ' put' + (puts === 1 ? '' : 's') + ')' +
            (desc ? '; biggest ' + desc + (prem ? ', ' + prem + ' premium' : '') : '') + '.' });
      }
    }
    return out;
  }
  return { WALL_NEAR_PCT: WALL_NEAR_PCT, MA_PERIODS: MA_PERIODS, build: build };
}

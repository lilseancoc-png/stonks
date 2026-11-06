// Friday recap (2026-11-06): one templated read of a Top Picks week from the
// Track Record payload (picks-accuracy.json). No AI and no new data: the
// trades that opened and closed Monday to Friday (ET), the win rate by entry
// type (ordinary, through a macro event, through earnings, post-shock put)
// this week and to date, the biggest miss (the most confident losing close),
// and the open-pick rule that turned away the most names (gateLog).
// Owner-only: it reads the private record, so it renders only on the Owner
// Track Record (scripts/render/app-js.mjs, "Week recap" sub-tab).
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function weekRecapFactory() {
  var KINDS = ['none', 'macro', 'earnings', 'shock'];
  var KIND_LABEL = { none: 'Ordinary entry', macro: 'Through a macro event', earnings: 'Through earnings', shock: 'Post-shock put' };
  var CLOSE_REASON = {
    'hit-tp-prem': 'take-profit hit', 'trail-stop': 'trail stop', 'hit-stop-prem': 'premium stop hit',
    'hit-stop-under': 'stock stop hit', 'thesis-broken': 'thesis broken', 'theta-stop': 'theta stop',
    'event-review': 'event review', 'shock-time': 'post-shock time limit', 'expired': 'contract expired',
    'dropped': 'left the universe', 'left-coverage': 'left coverage (not counted)'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var fmt = null;
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function etParts(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return null;
    if (!fmt) fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var p = {};
    var parts = fmt.formatToParts(d);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    return { key: p.year + '-' + p.month + '-' + p.day, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }
  // The ET calendar date of an ISO time, as YYYY-MM-DD.
  function etKey(iso) { var p = etParts(iso); return p ? p.key : null; }
  function keyMs(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function msKey(ms) { return new Date(ms).toISOString().slice(0, 10); }
  // Monday to Friday of the week holding dateKey. A Saturday or Sunday belongs
  // to the week that just ended, so the weekend shows Friday's recap.
  function weekOf(dateKey) {
    var t = keyMs(dateKey);
    if (t == null) return null;
    var dow = new Date(t).getUTCDay();
    var mon = t - ((dow + 6) % 7) * 86400000;
    return { start: msKey(mon), end: msKey(mon + 4 * 86400000) };
  }
  function shiftWeek(dateKey, weeks) {
    var w = weekOf(dateKey);
    return w ? msKey(keyMs(w.start) + weeks * 7 * 86400000) : null;
  }
  function dayLabel(key) {
    var t = keyMs(key);
    if (t == null) return '';
    var d = new Date(t);
    return DAYS[d.getUTCDay()] + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function rangeLabel(w) {
    var a = new Date(keyMs(w.start)), b = new Date(keyMs(w.end));
    var left = MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate();
    var right = (a.getUTCMonth() === b.getUTCMonth() ? '' : MONTHS[b.getUTCMonth()] + ' ') + b.getUTCDate();
    return left + ' to ' + right + ', ' + b.getUTCFullYear();
  }
  function kindOf(e) {
    var k = e && e.eventPlay && e.eventPlay.kind;
    return k === 'macro' || k === 'earnings' || k === 'shock' ? k : 'none';
  }
  function within(key, w) { return !!key && key >= w.start && key <= w.end; }
  function tally(list) {
    var w = 0, l = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].outcome === 'win') w++;
      else if (list[i].outcome === 'loss') l++;
    }
    return { wins: w, losses: l, n: w + l, rate: w + l ? w / (w + l) : null };
  }
  function heldDays(e) {
    var a = Date.parse(e.entryDate), b = Date.parse(e.exitDate);
    return isFinite(a) && isFinite(b) && b >= a ? Math.round((b - a) / 86400000) : null;
  }
  function row(e) {
    return {
      symbol: String(e.symbol || '?'), side: e.side === 'put' ? 'put' : 'call', kind: kindOf(e),
      score: num(e.score), entryDate: e.entryDate || null, exitDate: e.exitDate || null,
      entryKey: etKey(e.entryDate), exitKey: etKey(e.exitDate),
      pnl: num(e.optionPnlPct), outcome: e.outcome || null, status: e.status || null,
      reason: CLOSE_REASON[e.status] || (e.status ? String(e.status).replace(/-/g, ' ') : ''),
      held: heldDays(e), structure: e.contract && e.contract.structure || 'long'
    };
  }
  // acc: the picks-accuracy.json payload. opts.weekOf: any date in the week
  // (YYYY-MM-DD, ET); opts.nowIso picks the current week when weekOf is unset.
  function build(acc, opts) {
    opts = opts || {};
    acc = acc || {};
    var now = etParts(opts.nowIso || new Date().toISOString());
    var today = now && now.key;
    var w = weekOf(opts.weekOf || today);
    if (!w) return null;
    var thisWeek = weekOf(today);
    var open = Array.isArray(acc.open) ? acc.open : [];
    var closed = Array.isArray(acc.closed) ? acc.closed : [];
    var opened = [], closedWk = [], allClosed = [];
    var i;
    for (i = 0; i < open.length; i++) { var o = row(open[i]); if (within(o.entryKey, w)) opened.push(o); }
    for (i = 0; i < closed.length; i++) {
      var c = row(closed[i]);
      allClosed.push(c);
      if (within(c.entryKey, w)) opened.push(c);
      if (within(c.exitKey, w)) closedWk.push(c);
    }
    opened.sort(function (a, b) { return String(a.entryDate).localeCompare(String(b.entryDate)); });
    closedWk.sort(function (a, b) { return String(a.exitDate).localeCompare(String(b.exitDate)); });
    var byEvent = [];
    for (i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var wk = tally(closedWk.filter(function (x) { return x.kind === k; }));
      var all = tally(allClosed.filter(function (x) { return x.kind === k; }));
      var openedN = opened.filter(function (x) { return x.kind === k; }).length;
      if (wk.n || all.n || openedN) byEvent.push({ kind: k, label: KIND_LABEL[k], opened: openedN, week: wk, all: all });
    }
    // Biggest miss: the losing close the model was surest about (highest
    // entry score), then the deepest loss.
    var miss = null;
    for (i = 0; i < closedWk.length; i++) {
      var x = closedWk[i];
      if (x.outcome !== 'loss') continue;
      if (!miss || Math.abs(x.score || 0) > Math.abs(miss.score || 0) ||
        (Math.abs(x.score || 0) === Math.abs(miss.score || 0) && (x.pnl == null ? 0 : x.pnl) < (miss.pnl == null ? 0 : miss.pnl))) miss = x;
    }
    var best = null;
    for (i = 0; i < closedWk.length; i++) if (closedWk[i].outcome === 'win' && (!best || (closedWk[i].pnl || 0) > (best.pnl || 0))) best = closedWk[i];
    // The rule that turned away the most names (first blocking rule per
    // candidate; a repeat block within a few days is logged once).
    var gates = {}, log = Array.isArray(acc.gateLog) ? acc.gateLog : [];
    for (i = 0; i < log.length; i++) {
      var g = log[i];
      if (!g || !g.gate || g.gate === 'opened' || !within(String(g.date || '').slice(0, 10), w)) continue;
      if (!gates[g.gate]) gates[g.gate] = { gate: g.gate, n: 0, names: [] };
      gates[g.gate].n++;
      var nm = String(g.sym || '') + (g.side === 'put' ? ' put' : ' call');
      if (gates[g.gate].names.indexOf(nm) < 0) gates[g.gate].names.push(nm);
    }
    var gateList = Object.keys(gates).map(function (key) { return gates[key]; })
      .sort(function (a, b) { return b.n - a.n || (a.gate < b.gate ? -1 : 1); });
    var pnls = closedWk.map(function (x) { return x.pnl; }).filter(function (v) { return v != null; });
    var avg = pnls.length ? pnls.reduce(function (s, v) { return s + v; }, 0) / pnls.length : null;
    return {
      week: w, label: rangeLabel(w), current: thisWeek && thisWeek.start === w.start,
      future: !!thisWeek && w.start > thisWeek.start,
      // Final once Friday's last Top Picks run (15:30 ET) is done.
      complete: !!today && (today > w.end || (today === w.end && now.minutes >= 16 * 60)),
      opened: opened, closed: closedWk, record: tally(closedWk), avgPnl: avg,
      openNow: open.length, byEvent: byEvent, miss: miss, best: best,
      gates: gateList, topGate: gateList[0] || null, gateLogged: log.length > 0
    };
  }
  function pct(v) { return v == null ? '?' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function rate(t) { return t.n ? Math.round(t.rate * 100) + '%' : 'none decided'; }
  function tradeName(x) { return x.symbol + ' ' + x.side; }
  // Plain-text recap, for Copy. gateLabels maps a gate id to its label.
  function text(r, gateLabels) {
    if (!r) return '';
    gateLabels = gateLabels || {};
    var L = ['Mingstreet Top Picks recap: ' + r.label + (r.complete ? '' : ' (week in progress)')];
    L.push('');
    L.push('Opened ' + r.opened.length + (r.opened.length ? ': ' + r.opened.map(function (x) {
      return tradeName(x) + ' (' + dayLabel(x.entryKey).slice(0, 3) + (x.score != null ? ', score ' + x.score.toFixed(1) : '') + (x.kind !== 'none' ? ', ' + KIND_LABEL[x.kind].toLowerCase() : '') + ')';
    }).join('; ') : '') + '.');
    L.push('Closed ' + r.closed.length + (r.closed.length ? ': ' + r.record.wins + ' won, ' + r.record.losses + ' lost' + (r.record.n ? ' (' + rate(r.record) + ' win rate)' : '') + (r.avgPnl != null ? ', average ' + pct(r.avgPnl) : '') : '') + '.');
    for (var i = 0; i < r.closed.length; i++) {
      var c = r.closed[i];
      L.push('  ' + tradeName(c) + ' ' + pct(c.pnl) + (c.reason ? ', ' + c.reason : '') + (c.held != null ? ', held ' + c.held + ' day' + (c.held === 1 ? '' : 's') : ''));
    }
    if (r.byEvent.length) {
      L.push('');
      L.push('Win rate by entry type (this week / to date):');
      for (i = 0; i < r.byEvent.length; i++) {
        var b = r.byEvent[i];
        L.push('  ' + b.label + ': ' + b.week.wins + '-' + b.week.losses + ' / ' + b.all.wins + '-' + b.all.losses + (b.all.n ? ' (' + rate(b.all) + ')' : ''));
      }
    }
    L.push('');
    L.push(r.miss ? 'Biggest miss: ' + tradeName(r.miss) + (r.miss.score != null ? ', entry score ' + r.miss.score.toFixed(1) : '') + ', closed ' + pct(r.miss.pnl) + (r.miss.reason ? ' (' + r.miss.reason + ')' : '') + '.' : 'Biggest miss: no losing closes this week.');
    if (r.best) L.push('Best close: ' + tradeName(r.best) + ' ' + pct(r.best.pnl) + (r.best.reason ? ' (' + r.best.reason + ')' : '') + '.');
    L.push(r.topGate ? 'Rule that turned away the most: ' + (gateLabels[r.topGate.gate] || r.topGate.gate) + ', ' + r.topGate.n + ' name' + (r.topGate.n === 1 ? '' : 's') + ' (' + r.topGate.names.slice(0, 6).join(', ') + (r.topGate.names.length > 6 ? ', and more' : '') + ').' :
      'Rule that turned away the most: none logged this week.');
    L.push('');
    L.push('Model prices, not fills. Not investment advice.');
    return L.join('\n');
  }
  // Friday after the last Top Picks run, and the weekend: the Home desk
  // points at the finished week's recap.
  function recapReady(nowIso) {
    var p = etParts(nowIso || new Date().toISOString());
    if (!p) return false;
    var dow = new Date(keyMs(p.key)).getUTCDay();
    return dow === 6 || dow === 0 || (dow === 5 && p.minutes >= 16 * 60);
  }
  return { KINDS: KINDS, KIND_LABEL: KIND_LABEL, etKey: etKey, weekOf: weekOf, recapReady: recapReady, shiftWeek: shiftWeek, dayLabel: dayLabel, build: build, text: text };
}

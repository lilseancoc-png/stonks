// The Owner "Strategy engines" page (page id `engines`). Since 2026-11-16
// (audit fix 9) the engines have a page of their own, so Top picks and the
// Top Picks track record show Top Picks only (Open picks lists every open
// Webull paper trade again since 2026-11-19, engOpenPicksHtml); the engines sat
// in a switcher on the Top Picks page for their first day. One view per
// rules-only paper engine plus "All engines". It renders the Owner-only
// engines.json written by every Top Picks decision run
// (lib/engines/index.mjs): each engine's own candidates, open and closed
// trades, scorecard, setups, learning log, shadow trades and history test,
// and the engine trades in the shared Webull paper account
// (/api/auth/webull-mirror?scope=engines). Old ?tab=picks&engine= links land
// here (selectTab in app-js.mjs).
//
// Pasted into the app.js IIFE after renderSelfLoopJs(), so it reuses the
// slp* / evb* formatters, rglEt, escapeHtml, $, dataUrl, quantFetchJson,
// VIEWS, lineSvgHtml and tlTradeId from that scope. ES5 only.
import { ENGINES, ENGINE_IDS, FLAGSHIP } from '../../lib/engines/config.mjs';

export const ENGINE_TABS = Object.freeze([
  { id: FLAGSHIP.id, name: FLAGSHIP.name, tag: FLAGSHIP.tag },
  { id: 'all', name: 'All engines', tag: '' },
  ...ENGINE_IDS.map((id) => ({ id, name: ENGINES[id].name, tag: ENGINES[id].tag })),
  // The Allocator (2026-11-17) has no trades of its own: its tab shows which
  // signal-engine setups it lets trade in today's market and at what size.
  { id: 'allocator', name: 'Allocator', tag: '' },
]);

// The page's own tabs: "All engines" first, then one per engine. Top Picks
// stays in ENGINE_TABS for its name on shared-contract labels only.
export const ENGINE_PAGE_TABS = Object.freeze(ENGINE_TABS.filter((t) => t.id !== FLAGSHIP.id));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The page: its tab bar and the pane the browser fills.
export function enginesSection() {
  const tabs = ENGINE_PAGE_TABS.map((t, i) => `<button type="button" class="ui-tab eng-tab${i === 0 ? ' is-on' : ''}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" data-eng="${esc(t.id)}">${esc(t.name)}<span class="ui-tab-count eng-count" data-eng-count="${esc(t.id)}" hidden></span></button>`).join('');
  return `<div class="eng-switch" id="eng-switch">
    <div class="ui-tabs eng-tabs" id="eng-bar" role="tablist" aria-label="Strategy engines">${tabs}</div>
  </div>
  <section class="card eng-pane" id="eng-pane" aria-live="polite"><p class="eng-empty eng-wait">Open this page to load the strategy engines.</p></section>`;
}

export function renderEnginesJs() {
  return `
  // ---- Strategy engines (their own Owner page) ------------------------------
  var ENG_TABS = ${JSON.stringify(ENGINE_TABS)};
  var ENG_SUBS = [['now', 'Now'], ['record', 'Track record'], ['learn', 'Setups and learning'], ['history', 'History test'], ['webull', 'Webull paper']];
  var ENG_HIST = [['live', 'As the engine runs', 'Shadow-start setups held back and the learning rules switched on: the closest read of how the engine runs today.', 'shadow-start setups held back, learning on'], ['held', 'Learning off', 'Shadow-start setups held back, learning rules off.', 'shadow-start setups held back, no learning'], ['raw', 'Every setup', 'Every setup trading from day one and no learning: the unpicked read.', 'every setup from day one, no learning']];
  var ENG_ENV = [['rates', 'Fed policy'], ['inflation', 'Inflation'], ['conditions', 'Financial conditions'], ['curve', 'Yield curve'], ['vix', 'VIX level'], ['recession', 'Economy']];
  // Rows of each macro split read in this order (easiest to hardest), not by trade count.
  var ENG_ENV_ORDER = { rates: ['cutting', 'on hold', 'hiking'], inflation: ['low', 'above target', 'high (4%+)'], conditions: ['loose', 'normal', 'tight'], curve: ['inverted', 'flat', 'steep'], vix: ['under 15', '15-20', '20-30', '30+'], recession: ['expansion', 'recession'] };
  var ENG_CELL = { 'up-calm': 'Trending up, calm', 'up-stressed': 'Trending up, stressed', 'down-calm': 'Trending down, calm', 'down-stressed': 'Trending down, stressed', 'chop-calm': 'Choppy, calm', 'chop-stressed': 'Choppy, stressed' };
  var ENG_STATE = { trading: ['Trading', 'evb-s-pass'], shadow: ['On shadow', 'evb-s-collect'], muted: ['Muted', 'evb-s-fail'], retired: ['Retired', 'evb-s-collect'], off: ['Switched off', 'evb-s-fail'] };
  var ENG_MIRROR_STATE = { entering: 'Buying', open: 'Open', exiting: 'Selling', closed: 'Closed', missed: 'Missed', skipped: 'Not bought', settled: 'Settled' };
  // What Webull actually filled for a trade (fillOutcome in lib/webull-mirror.mjs, 2026-11-19).
  var ENG_FILL = { filled: ['Filled', 'evb-s-pass'], partial: ['Partly filled', 'evb-s-collect'], missed: ['Missed', 'evb-s-fail'], pending: ['Buying', 'evb-s-unclear'], shared: ['Held by another', 'evb-s-unclear'], 'not-bought': ['Not bought', 'evb-s-unclear'] };
  var ENG_EVENT = { fomc: 'Fed decision day', cpi: 'CPI day', jobs: 'Jobs report day' };
  var ENG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var engState = { data: null, loading: false, fetchedAt: 0, error: null, sel: 'all', sub: 'now', hist: 'live', mirror: null, mirrorLoading: false, mirrorError: null, mirrorAt: 0, bound: false };

  function engValid(id){ if (id === 'flagship') return false; for (var i = 0; i < ENG_TABS.length; i++) if (ENG_TABS[i].id === id) return true; return false; }
  function engName(id){ for (var i = 0; i < ENG_TABS.length; i++) if (ENG_TABS[i].id === id) return ENG_TABS[i].name; return String(id || ''); }
  function engUsd(v){ if (v == null || !isFinite(v)) return '—'; var a = Math.abs(Math.round(v)); return (v < 0 ? '−' : v > 0 ? '+' : '') + '$' + a.toLocaleString('en-US'); }
  function engRate(v){ return v == null || !isFinite(v) ? '—' : Math.round(v * 100) + '%'; }
  function engRange(r){ return r && isFinite(r.lo) && isFinite(r.hi) ? Math.round(r.lo * 100) + ' to ' + Math.round(r.hi * 100) + '%' : ''; }
  function engPnl(v, d){ return v == null || !isFinite(v) ? '—' : '<span class="' + slpSign(v) + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%</span>'; }
  function engMoney(v){ var n = Number(v); return v == null || !isFinite(n) ? '—' : '$' + n.toFixed(2); }
  function engStrike(v){ var n = Number(v); if (v == null || !isFinite(n)) return '$?'; if (Math.round(n) === n) return '$' + n; var s = n.toFixed(2); while (s.charAt(s.length - 1) === '0') s = s.slice(0, -1); return '$' + s; }
  function engExp(sec){ var n = Number(sec); if (!(n > 0)) return '?'; var d = new Date(n * 1000); return ENG_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function engIsShares(t){ return !!(t && t.contract && t.contract.structure === 'shares'); }
  function engContract(t){ var c = (t && t.contract) || {}; if (c.structure === 'shares') return (c.shares || '?') + ' shares at ' + engMoney(c.mid) + engSizeHtml(t); return (c.qty > 1 ? '<span title="Contracts bought">' + c.qty + ' ×</span> ' : '') + engStrike(c.strike) + ' ' + escapeHtml(String(c.optionType || (t && t.side) || '')) + ' · ' + engExp(c.expiry) + engSizeHtml(t); }
  // How a trade was sized and filled (2026-11-19): the size taken, the flat
  // risk size beside it, each part of the conviction multiplier, and the ask
  // and bid the record booked. Opens on a tap (phones have no hover).
  function engSizeHtml(t){
    var s = t && t.size, f = t && t.fill, c = (t && t.contract) || {};
    if (!s && !(f && f.basis === 'ask-bid')) return '';
    var sh = engIsShares(t), n = sh ? c.shares : (c.qty || 1), flat = sh ? c.flatShares : c.flatQty;
    var head = (sh ? (n || '?') + ' shares' : n + (n === 1 ? ' contract' : ' contracts')) + (flat != null && flat !== n ? ', flat ' + flat : '') + (s && s.mult != null && s.mult !== 1 ? ', ' + slpNum(s.mult, 2) + 'x' : '');
    var parts = ((s && s.parts) || []).map(function(p){ return '<li><b>' + slpNum(p.x, 2) + 'x</b> ' + escapeHtml(p.why || p.key || '') + '</li>'; }).join('');
    var fill = f && f.basis === 'ask-bid' ? '<div>Booked at the ask ' + engMoney(f.entry) + ' (mid ' + engMoney(c.mid) + ')' + (f.exit != null ? ', out at the ' + (f.exitBasis === 'est' ? 'estimated bid ' : 'bid ') + engMoney(f.exit) : t.lastBid != null ? ', bid now ' + engMoney(t.lastBid) + (f.exitBasis === 'est' ? ' (estimated: no two-sided quote)' : '') : '') + '. Stops and targets fire on the mid.</div>' : '';
    return '<details class="eng-size"><summary>' + escapeHtml(s ? 'Size: ' + head : 'Fill: ask in, bid out') + '</summary>' + (s && s.why ? '<div>' + escapeHtml(engCap(s.why)) + '.</div>' : '') + (parts ? '<ul>' + parts + '</ul>' : '') + fill + '</details>';
  }
  function engDay(iso){ return evbDate(String(iso || '').slice(0, 10)); }
  // Chart axis day: "Aug 10" (with the year when the points span more than one).
  function engAxisDay(iso, withYear){ var m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso || '')); if (!m) return String(iso || ''); return ENG_MONTHS[+m[2] - 1] + ' ' + (+m[3]) + (withYear ? " '" + m[1].slice(2) : ''); }
  function engAxisEvery(n){ var narrow = typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 560; return Math.max(1, Math.ceil(n / (narrow ? 3 : 6))); }
  function engCell(k){ return ENG_CELL[k] || String(k || '—'); }
  function engCap(s){ s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
  function engSide(s){ return s === 'put' ? '<span class="eng-side eng-put">Put</span>' : '<span class="eng-side eng-call">Call</span>'; }
  // A trade's badge: Shares for a share trade (2026-11-17), else Call / Put.
  function engSideT(t){ return (engIsShares(t) ? '<span class="eng-side eng-shr" title="Bought as stock, not an option">Shares</span>' : engSide(t && t.side)) + (t && t.test ? ' <span class="eng-side eng-test" title="A labeled test: kept apart from the setups the engine trades">Test</span>' : '') + (t && t.trial ? ENG_TRIAL_BADGE : '') + (t && t.twinOf ? '<div class="crd-dim">shares twin of ' + escapeHtml(t.twinOf) + '</div>' : '') + engSplitNote(t); }
  function engSplitNote(t){
    if (!t) return '';
    var out = (t.splits || []).map(function(a){ var k = Number(a && a.factor); var r = k >= 1 ? (Math.round(k * 100) / 100) + '-for-1' : '1-for-' + (Math.round(100 / k) / 100); return '<div class="crd-dim" title="Entry, stop, target and strike divided by the ratio; count multiplied. The dollars and the % result did not move.">Followed a ' + escapeHtml(r) + ' split ' + escapeHtml(engDay(a && a.date)) + '</div>'; }).join('');
    if (t.splitReview) out += '<div class="crd-dim">' + escapeHtml(t.splitReview) + '</div>';
    if (t.splitUnconfirmed) out += '<div class="crd-dim" title="A gap of about a split ratio that no split list or history confirmed; it was marked as a real move.">Big gap on ' + escapeHtml(engDay(t.splitUnconfirmed.date)) + ' marked as a real move: check for a split</div>';
    return out;
  }
  // Paper trials (2026-11-19): unproven setups, scored apart from the engine.
  var ENG_TRIAL_BADGE = ' <span class="eng-side eng-trial" title="An unproven setup on paper, scored apart from the engine">Paper trial</span>';
  // Exit plan of one open trade: premium exits for an option, stock levels for shares.
  function engExitPlan(t){ var x = t.exits || {}; if (engIsShares(t) && t.stopLevel == null && t.targetLevel == null && !x.maxSessions && !t.exitBy) return 'Held until a monthly check swaps it'; return (engIsShares(t) ? 'Stock levels' + (x.maxSessions ? '<div class="crd-dim">' + x.maxSessions + ' sessions at most</div>' : '') : (x.tp == null ? 'no take-profit' : '+' + x.tp + '%') + ' / ' + (x.stop == null ? 'no stop' : x.stop + '%')) + (t.exitBy ? '<div class="crd-dim">out by ' + escapeHtml(engDay(t.exitBy)) + '</div>' : '') + (t.stopLevel != null ? '<div class="crd-dim">stock stop ' + engMoney(t.stopLevel) + '</div>' : '') + (t.targetLevel != null ? '<div class="crd-dim">stock target ' + engMoney(t.targetLevel) + '</div>' : ''); }
  function engPill(text, cls){ return '<span class="evb-pill ' + (cls || 'evb-s-unclear') + '">' + escapeHtml(text) + '</span>'; }
  function engSetup(e, key){ var list = (e && e.setups) || []; for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label; return String(key || ''); }
  function engFind(d, id){ var list = (d && d.engines) || []; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function engExitLabel(d, k){ var L = (d && d.closeLabels) || {}; return engCap(L[k] || k); }
  function engDetails(title, body, open){ return '<details class="rgl-details eng-details"' + (open ? ' open' : '') + '><summary>' + escapeHtml(title) + '</summary>' + body + '</details>'; }
  // Option size (2026-11-17): about $2,000 of premium a trade (book.optionUsd),
  // one contract before that or with the size fix switched off.
  function engOptUsd(){ var d = engState.data; return d && d.book && d.book.optionUsd ? Number(d.book.optionUsd) : null; }
  function engUsdWord(v){ return '$' + Number(v).toLocaleString('en-US'); }
  function engRisk(){ var d = engState.data, z = d && d.sizing; return z && z.mode === 'risk' && z.budget ? z : null; }
  function engSizeTip(){ var z = engRisk(), u = engOptUsd(); if (z) return 'Dollars made or lost at each trade’s size: since 19 November 2026 each trade risks about ' + engUsdWord(z.budget) + (z.conviction ? ' times its conviction multiplier' : '') + ' (1 to ' + z.maxQty + ' contracts); about $2,000 of premium a trade from 17 November, one contract before'; return u ? 'Dollars made or lost at each trade’s size: about ' + engUsdWord(u) + ' of premium per option trade (one contract each for trades opened before 17 November 2026)' : 'Dollars made or lost buying one contract per option trade'; }
  function engSizeWords(){ var z = engRisk(), u = engOptUsd(); if (z) return 'sized to risk about ' + engUsdWord(z.budget) + ' a trade, 1 to ' + z.maxQty + ' contracts' + (z.conviction ? ', times a conviction multiplier of ' + slpNum(z.convMin, 1) + 'x to ' + slpNum(z.convMax, 0) + 'x' : ''); return u ? 'about ' + engUsdWord(u) + ' of premium each (the number of contracts nearest that, at least one)' : 'one contract each'; }
  // Dollars on share trades: kind 'core' = a core engine's holdings (their own lots).
  function engShareTip(kind){ if (kind === 'core') return 'Dollars made or lost on each holding at its lot size'; var z = engRisk(); return z ? 'Dollars made or lost at each share trade’s size: since 19 November 2026 each risks about ' + engUsdWord(z.budget) + ' (entry minus stop per share)' + (z.conviction ? ' times its conviction multiplier' : '') + ', at most ' + engUsdWord(z.sharesMaxUsd || 25000) + ' of stock; a $5,000 lot before' : 'Dollars made or lost on a $5,000 lot per trade'; }
  function engExitsText(x){ x = x || {}; return (x.tp == null ? 'no take-profit' : '+' + x.tp + '% take-profit') + ', ' + (x.stop == null ? 'no premium stop' : x.stop + '% stop') + (x.maxSessions != null ? ', ' + x.maxSessions + ' sessions at most' : ''); }

  // Same-contract label for one engine trade row.
  function engSharedHtml(t){
    var out = '';
    if (t && t.shared && t.shared.heldBy) out += '<div class="eng-shared" title="One paper position per contract: this trade is recorded here on paper marks and is not bought a second time.">Held by ' + escapeHtml(engName(t.shared.heldBy)) + (t.shared.heldById ? ' (' + escapeHtml(t.shared.heldById) + ')' : '') + ': recorded here, not bought twice</div>';
    var w = (t && t.sharedWith) || [];
    if (w.length) out += '<div class="eng-shared eng-shared-holder" title="This engine holds the one paper position for this contract.">Also on: ' + w.map(function(x){ return escapeHtml(engName(x.engine)) + (x.tradeId ? ' (' + escapeHtml(x.tradeId) + ')' : ''); }).join(', ') + '</div>';
    return out;
  }
  // Top Picks trades that share a contract with an engine trade (Open picks).
  function engFlagshipSharedHtml(open){
    var d = engState.data, map = d && d.flagshipShared;
    if (!map || !open || !open.length || typeof tlTradeId !== 'function') return '';
    var live = {};
    (d.engines || []).forEach(function(e){ (e.open || []).forEach(function(t){ live[t.tradeId] = 1; }); });
    var rows = [];
    open.forEach(function(o){
      var id = tlTradeId(o), list = (map[id] || []).filter(function(r){ return live[r.tradeId]; });
      if (!list.length) return;
      var holds = list.some(function(r){ return r.engineRole === 'holder'; });
      rows.push('<li><b>' + escapeHtml(id) + '</b>: ' + (holds
        ? 'the same contract is held in the paper account by ' + list.filter(function(r){ return r.engineRole === 'holder'; }).map(function(r){ return escapeHtml(engName(r.engine)) + ' (' + escapeHtml(r.tradeId) + ')'; }).join(', ') + ', so Top Picks records it here and does not buy it twice.'
        : 'also on ' + list.map(function(r){ return escapeHtml(engName(r.engine)) + ' (' + escapeHtml(r.tradeId) + ')'; }).join(', ') + '. Top Picks holds the one paper position.') + '</li>');
    });
    return rows.length ? '<div class="eng-shared-note"><b>Same contract on more than one engine</b><ul>' + rows.join('') + '</ul></div>' : '';
  }

  // Open picks (owner, 2026-11-19): the page lists every open trade the
  // Webull paper account carries, Top Picks and every engine, trial and test
  // trade, each labeled with who made it and what Webull filled. The Top
  // Picks track record still counts Top Picks only.
  function engOpenTrades(){
    var d = engState.data; if (!d || !Array.isArray(d.engines)) return [];
    var out = [];
    d.engines.forEach(function(e){ (e.open || []).forEach(function(t){ if (t && t.tradeId) out.push(t); }); });
    return out;
  }
  // The whole paper account (scope=all), read from the Owner API like the
  // engines page's own read; never a data file and never the MCP.
  var opWb = { data: null, by: null, loading: false, at: 0, error: null };
  var OP_WB_LIVE = { entering: 1, open: 1, exiting: 1 };
  function opRerender(){ var op = $('page-pane-open-picks'); if (op && !op.hidden && typeof renderOpenPicks === 'function') renderOpenPicks(); }
  function opLoadWebull(force){
    if (!HAS_OWNER_ACCESS || opWb.loading) return;
    if (!force && opWb.at && Date.now() - opWb.at < (opWb.error ? 60 * 1000 : 5 * 60 * 1000)) return;
    opWb.loading = true; opWb.error = null;
    fetch('/api/auth/webull-mirror?scope=all', { cache: 'no-store', credentials: 'same-origin' }).then(function(r){
      if (!r.ok){ var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function(j){
      var by = {};
      ((j && j.trades) || []).forEach(function(t){ if (t && t.tradeId) by[t.tradeId] = t; });
      opWb.data = j && typeof j === 'object' ? j : null; opWb.by = by; opWb.at = Date.now(); opWb.loading = false;
      opRerender();
    }).catch(function(err){
      opWb.loading = false; opWb.at = Date.now();
      opWb.error = err && err.status === 404 ? 'off' : String((err && err.message) || err || 'failed');
      opRerender();
    });
  }
  // Trades still working at Webull whose record has already closed (an exit
  // still selling) or that no loaded record lists.
  function opWebullOnly(flagOpen, engOpen){
    if (!opWb.by) return [];
    var seen = {};
    (flagOpen || []).forEach(function(o){ seen[tlTradeId(o)] = 1; });
    (engOpen || []).forEach(function(t){ seen[t.tradeId] = 1; });
    return ((opWb.data && opWb.data.trades) || []).filter(function(w){ return w && w.tradeId && OP_WB_LIVE[w.state] && !seen[w.tradeId]; });
  }
  var OP_WB_TIP = 'What the Webull paper account did with this trade: filled, partly filled, missed, held by another trade on the same contract, or not bought (with the reason on the Webull tab), and its paper result. Not sent = the trade predates the mirror, a switch kept it off, or the mirror has not run since it opened.';
  function opWebullHtml(id){
    if (!opWb.by){
      if (opWb.error === 'off') return '<span class="crd-dim">Mirror off</span>';
      return '<span class="crd-dim">' + (opWb.error ? 'Could not read' : 'loading…') + '</span>';
    }
    var w = opWb.by[id];
    if (!w) return '<span class="crd-dim">Not sent</span>';
    var st = ENG_MIRROR_STATE[w.state] || engCap(w.state);
    return engFillHtml(w) + '<div class="crd-dim">' + escapeHtml(st) + (w.paperPnlPct != null && isFinite(w.paperPnlPct) ? ' · ' + (w.paperPnlPct > 0 ? '+' : '') + Number(w.paperPnlPct).toFixed(1) + '%' : '') + '</div>';
  }
  var OP_WB_RANK = { filled: 0, partial: 1, pending: 2, shared: 3, missed: 4, 'not-bought': 5 };
  function opWebullSort(id){
    if (!opWb.by) return null;
    var w = opWb.by[id];
    return w ? (OP_WB_RANK[w.fillOutcome] != null ? OP_WB_RANK[w.fillOutcome] : 6) : 7;
  }
  function opSourceHtml(t){
    var e = t && t.engine;
    // Trial and test badges ride the Ticker cell (engSideT).
    return '<a href="?tab=engines&amp;engine=' + encodeURIComponent(e || 'all') + '">' + escapeHtml(t.madeBy || engName(e)) + '</a>';
  }
  function opDays(iso){ var t = Date.parse(iso); return isFinite(t) ? Math.max(0, (Date.now() - t) / 86400000) : null; }
  function opEntry(t){ var c = (t && t.contract) || {}; var f = t && t.fill; var v = f && f.entry != null ? Number(f.entry) : Number(c.mid); return isFinite(v) && v > 0 ? v : null; }
  function opMark(t){ var v = Number(t && t.lastMid); return t && t.lastMid != null && isFinite(v) && v >= 0 ? v : null; }
  function opPositionHtml(t){
    var c = (t && t.contract) || {};
    if (c.structure === 'shares') return (c.shares || '?') + ' shares';
    return (c.qty > 1 ? c.qty + ' × ' : '') + engStrike(c.strike) + ' ' + escapeHtml(String(c.optionType || t.side || '')) + ' · ' + engExp(c.expiry);
  }
  // The engine group under the Top Picks one. Every row links to its engine.
  function engOpenPicksHtml(engOpen, extra){
    var d = engState.data;
    var rows = (engOpen || []).slice().sort(function(a, b){ return (Date.parse(b.entryDate) || 0) - (Date.parse(a.entryDate) || 0); });
    var cols = [
      { label: 'Ticker', cell: function(t){ return '<a href="?s=' + encodeURIComponent(t.symbol || '') + '">' + escapeHtml(t.symbol || '') + '</a> ' + engSideT(t); }, sort: function(t){ return t.symbol || null; } },
      { label: 'Made by', title: 'The strategy engine that opened this trade', cell: opSourceHtml, sort: function(t){ return engName(t.engine); } },
      { label: 'Position', cell: opPositionHtml, nosort: true },
      { label: 'P&L', num: true, title: 'The engine record’s open result: % of the premium for an option, % of the share price for shares', cell: function(t){ return t.optionPnlPct == null ? '' : engPnl(t.optionPnlPct); }, sort: function(t){ var v = Number(t.optionPnlPct); return t.optionPnlPct != null && isFinite(v) ? v : null; } },
      { label: 'Webull', title: OP_WB_TIP, cell: function(t){ return opWebullHtml(t.tradeId); }, sort: function(t){ return opWebullSort(t.tradeId); } },
      { label: 'Entry', num: true, title: 'Entry price per share (an option at the ask when the record books ask and bid)', cell: function(t){ var v = opEntry(t); return v == null ? '' : engMoney(v); }, sort: opEntry },
      { label: 'Mark', num: true, title: 'Latest mid price per share on the engine record', cell: function(t){ var v = opMark(t); return v == null ? '' : engMoney(v); }, sort: opMark },
      { label: 'Opened (ET)', cell: function(t){ return t.entryDate && typeof accOpenedEt === 'function' ? escapeHtml(accOpenedEt(t.entryDate)) : ''; }, sort: function(t){ var x = Date.parse(t.entryDate); return isFinite(x) ? x : null; } },
      { label: 'Days held', num: true, cell: function(t){ var x = opDays(t.entryDate); return x == null ? '' : x.toFixed(x < 10 ? 1 : 0); }, sort: function(t){ return opDays(t.entryDate); } },
      { label: 'Setup', cell: function(t){ return escapeHtml(t.setup || ''); }, sort: function(t){ return t.setup || null; } },
      { label: 'Trade ID', cell: function(t){ return '<span class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</span>'; }, sort: function(t){ return t.tradeId || null; } }
    ];
    var head = '<div class="accuracy-group-head">Strategy engine trades <span class="accuracy-group-n">' + rows.length + '</span></div>';
    var note = '<p class="eng-open-link">Paper trades from the strategy engines, including the paper trials and tests, in the same Webull paper account as Top Picks. They count on each engine’s own record, never on the Top Picks track record. <button type="button" class="eng-link" data-wf-go="engines">Open the Strategy engines page</button></p>';
    var body;
    if (!d) body = '<p class="hint">' + (engState.error ? 'The engine trades could not be read (' + escapeHtml(String(engState.error)) + ').' : 'Loading the engine trades…') + '</p>';
    else body = VIEWS.tableHtml(cols, rows, { key: 'open-picks-engines', empty: 'No engine trades are open right now.' });
    var tail = '';
    if (extra && extra.length){
      var xcols = [
        { label: 'Trade', cell: function(w){ return '<b>' + escapeHtml(w.symbol || '') + '</b> ' + (w.instrument === 'stock' ? '<span class="eng-side eng-shr">Shares</span>' : engSide(w.side)) + '<div class="crd-dim eng-id">' + escapeHtml(w.tradeId || '') + '</div>'; }, sort: function(w){ return w.symbol || null; } },
        { label: 'Made by', cell: function(w){ return escapeHtml(w.madeBy || (w.engine ? engName(w.engine) : 'Top Picks')); }, sort: function(w){ return w.madeBy || null; } },
        { label: 'Position', cell: function(w){ return escapeHtml(String(w.legs || '').replace(/^BUY /, '')); }, nosort: true },
        { label: 'Webull', title: OP_WB_TIP, cell: function(w){ return opWebullHtml(w.tradeId); }, sort: function(w){ return opWebullSort(w.tradeId); } }
      ];
      tail = '<div class="accuracy-group-head">Still working at Webull <span class="accuracy-group-n">' + extra.length + '</span></div>' +
        '<p class="eng-open-link">The record has closed these, or no open list carries them, but the paper account still holds or is still selling them.</p>' +
        VIEWS.tableHtml(xcols, extra, { key: 'open-picks-webull-only', empty: '' });
    }
    return '<div class="accuracy-group op-engines" id="open-picks-engines">' + head + note + body + tail + '</div>';
  }

  // shares: a split of share trades (% of the share price; true, or 'core' for
  // a core engine's holdings, picks the Dollars wording).
  function engSplitTable(rows, first, nameFn, shares){
    if (!rows || !rows.length) return '<p class="hint">No closed trades in this split yet.</p>';
    return slpTable([[first], ['Trades', 1], ['Win rate', 1], shares ? ['Average', 1, 'Average result per trade, % of the share price after costs'] : ['Average', 1, 'Average result per trade, % of the entry premium'], ['Median', 1], shares ? ['Dollars', 1, engShareTip(shares)] : ['Dollars', 1, engSizeTip()], ['Profit factor', 1, 'Gains divided by losses; above 1 means the wins outweigh the losses']], rows.map(function(r){
      return '<tr><td>' + escapeHtml(nameFn ? nameFn(r) : String(r.label || r.key)) + (r.from && r.to ? '<div class="crd-dim">' + escapeHtml(engDay(r.from)) + ' to ' + escapeHtml(engDay(r.to)) + '</div>' : '') + '</td><td class="num">' + (r.n || 0) + '</td><td class="num">' + engRate(r.winRate) + '</td><td class="num">' + engPnl(r.avg) + '</td><td class="num">' + engPnl(r.median) + '</td><td class="num ' + slpSign(r.usd) + '">' + engUsd(r.usd) + '</td><td class="num">' + slpNum(r.profitFactor, 2) + '</td></tr>';
    }).join(''));
  }
  function engEnvTables(byEnv, shares){
    if (!byEnv) return '';
    return ENG_ENV.map(function(k){
      var rows = byEnv[k[0]];
      if (!rows || !rows.length) return '';
      var order = ENG_ENV_ORDER[k[0]] || [];
      rows = rows.slice().sort(function(a, b){ var ia = order.indexOf(a.key), ib = order.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
      return '<h4 class="slp-h4">' + k[1] + '</h4>' + engSplitTable(rows, k[1], function(r){ return engCap(r.key); }, shares);
    }).join('');
  }
  function engCurveHtml(curve, aria){
    if (!curve || curve.length < 3) return '';
    var yrs = String(curve[0][0]).slice(0, 4) !== String(curve[curve.length - 1][0]).slice(0, 4);
    return lineSvgHtml({ labels: curve.map(function(p){ return engAxisDay(p[0], yrs); }), series: [{ name: 'Running total in dollars', values: curve.map(function(p){ return p[1]; }), cls: 'ln-s0' }], h: 220, zero: true, xEvery: engAxisEvery(curve.length), yFmt: function(v){ return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'); }, ariaLabel: aria });
  }
  // "All engines": every engine's running total on one chart (closed trades at
  // their sizes, by exit day; each line carried flat between closes).
  var ENG_LINE_CLS = ['ln-s0', 'ln-s1', 'ln-s3', 'ln-s4', 'ln-s5', 'ln-s2'];
  function engAllCurveHtml(d){
    var list = (d.engines || []).filter(function(e){ return e.stats && e.stats.curve && e.stats.curve.length; });
    if (!list.length) return '<p class="hint">No engine has closed a trade yet. Each engine gets a line here (dollars made or lost on its closed trades) once its first trade closes.</p>';
    var days = {};
    list.forEach(function(e){ e.stats.curve.forEach(function(p){ days[String(p[0]).slice(0, 10)] = 1; }); });
    var keys = Object.keys(days).sort();
    if (keys.length < 2) keys = [keys[0], keys[0]];
    var series = (d.engines || []).map(function(e, i){
      var byDay = {};
      ((e.stats && e.stats.curve) || []).forEach(function(p){ byDay[String(p[0]).slice(0, 10)] = p[1]; });
      var run = 0;
      return { name: e.name, cls: ENG_LINE_CLS[i % ENG_LINE_CLS.length], values: keys.map(function(k){ if (byDay[k] != null) run = byDay[k]; return run; }) };
    });
    var shown = series.filter(function(sr, i){ var e = d.engines[i]; return e.stats && e.stats.curve && e.stats.curve.length; });
    var yrs = keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
    return lineSvgHtml({ labels: keys.map(function(k){ return engAxisDay(k, yrs); }), series: shown, h: 240, zero: true, xEvery: engAxisEvery(keys.length),
      yFmt: function(v){ return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'); }, ariaLabel: 'Running total of each strategy engine in dollars' }) + lineLegendHtml(shown);
  }
  // Every engine's open trades in one table (each engine tab still has its own).
  function engAllOpenHtml(d){
    var rows = [];
    (d.engines || []).forEach(function(e){ (e.open || []).forEach(function(t){ rows.push({ e: e, t: t }); }); });
    var cols = [
      { label: 'Engine', cell: function(r){ return '<button type="button" class="eng-link" data-eng-go="' + escapeHtml(r.e.id) + '">' + escapeHtml(r.e.name) + '</button>'; }, sort: function(r){ return r.e.name; } },
      { label: 'Trade', cell: function(r){ return '<b>' + escapeHtml(r.t.symbol) + '</b> ' + engSideT(r.t) + '<div class="crd-dim eng-id">' + escapeHtml(r.t.tradeId || '') + '</div>' + engSharedHtml(r.t); }, sort: function(r){ return r.t.symbol; } },
      { label: 'Setup', cell: function(r){ return escapeHtml(engSetup(r.e, r.t.setup)) + '<div class="crd-dim">score ' + slpNum(r.t.score, 0) + '</div>'; }, sort: function(r){ return r.t.setup; } },
      { label: 'Contract', cell: function(r){ return engContract(r.t) + '<div class="crd-dim">opened ' + escapeHtml(rglEt(r.t.entryDate)) + '</div>'; }, sort: function(r){ return Date.parse(r.t.entryDate) || 0; } },
      { label: 'Result', num: true, cell: function(r){ return engPnl(r.t.optionPnlPct) + '<div class="crd-dim">' + engMoney(r.t.contract && r.t.contract.mid) + ' → ' + engMoney(r.t.lastMid) + '</div>'; }, sort: function(r){ return r.t.optionPnlPct; } },
      { label: 'Sessions', num: true, cell: function(r){ return String(r.t.sessions || 0) + (r.t.exits && r.t.exits.maxSessions ? '<span class="crd-dim"> of ' + r.t.exits.maxSessions + '</span>' : ''); }, sort: function(r){ return r.t.sessions || 0; } },
    ];
    return VIEWS.tableHtml(cols, rows, { key: 'eng-open-all', empty: 'No engine has an open trade. New ones open at the 11:00 and 15:30 ET runs when a setup clears its bar.' });
  }
  function engStatKpis(s, extra){
    s = s || {};
    var list = [
      ['Closed trades', String(s.n || 0), (s.wins || 0) + ' wins, ' + (s.losses || 0) + ' losses' + (s.flat ? ', ' + s.flat + ' flat' : '')],
      ['Win rate', engRate(s.winRate) + (engRange(s.winRange) ? '<small class="eng-kpi-sub">' + engRange(s.winRange) + '</small>' : ''), 'The range is where the true win rate plausibly sits given how few trades there are (Wilson 95%)'],
      ['Average trade', engPnl(s.avg), 'Average result per trade, % of the entry premium'],
      ['Median trade', engPnl(s.median)],
      ['Avg win / loss', (s.avgWin == null ? '—' : '+' + slpNum(s.avgWin, 0) + '%') + ' / ' + (s.avgLoss == null ? '—' : slpNum(s.avgLoss, 0) + '%'), 'Average winning trade and average losing trade, % of the entry premium'],
      ['Profit factor', slpNum(s.profitFactor, 2), 'Gains divided by losses; above 1 means the wins outweigh the losses'],
      ['Dollars', '<span class="' + slpSign(s.usd) + '">' + engUsd(s.usd) + '</span>', engSizeTip()],
    ];
    return slpKpis(list.concat(extra || []));
  }
  // Share trades, scored apart from options (2026-11-17): % of the share price.
  function engShareKpis(s, extra, kind){
    s = s || {};
    return slpKpis([
      ['Closed share trades', String(s.n || 0), (s.wins || 0) + ' wins, ' + (s.losses || 0) + ' losses' + (s.flat ? ', ' + s.flat + ' flat' : '')],
      ['Win rate', engRate(s.winRate) + (engRange(s.winRange) ? '<small class="eng-kpi-sub">' + engRange(s.winRange) + '</small>' : '')],
      ['Average trade', engPnl(s.avg, 2), 'Average result per share trade, % of the share price, after 0.1% costs'],
      ['Avg win / loss', (s.avgWin == null ? '—' : '+' + slpNum(s.avgWin, 1) + '%') + ' / ' + (s.avgLoss == null ? '—' : slpNum(s.avgLoss, 1) + '%')],
      ['Profit factor', slpNum(s.profitFactor, 2)],
      ['Dollars', '<span class="' + slpSign(s.usd) + '">' + engUsd(s.usd) + '</span>', kind === 'core' ? 'Dollars made or lost on closed holdings at their lot sizes' : engShareTip()],
    ].concat(extra || []));
  }
  function engSharesSetups(e){ return (e.setups || []).filter(function(s){ return (s.calls === 'shares' || s.instrument === 'both') && !s.retired; }).map(function(s){ return s.label; }); }
  function engInstBadge(s){ return s.retired ? '' : s.instrument === 'both' ? ' <span class="eng-side eng-shr" title="An option trade plus a shares twin, scored apart">Option + shares</span>' : s.calls === 'shares' ? ' <span class="eng-side eng-shr">Shares</span>' : ''; }

  // ---- One engine -----------------------------------------------------------
  function engRulesHtml(e, d){
    var c = e.contract || {}, x = e.exits || {}, sb = (d && d.book && d.book.shares) || null, shr = engSharesSetups(e);
    var who = e.universe === 'etfs' ? 'Index, bond, gold and Asia funds only' : e.universe === 'stocks' ? 'Single stocks only (no funds)' : 'Every covered name';
    return '<ul class="eng-rules">' +
      '<li><b>Universe.</b> ' + who + '.</li>' +
      '<li><b>What it buys.</b> One single call or put, about ' + slpNum(c.delta, 2) + ' delta, ' + c.dteMin + ' to ' + c.dteMax + ' days to expiry (ideal ' + c.dteIdeal + '). Never a spread.' + (e.setups || []).filter(function(s){ return s.contract && !s.retired; }).map(function(s){ return ' ' + escapeHtml(s.label) + ' buys its own: about ' + slpNum(s.contract.delta, 2) + ' delta, ' + s.contract.dteMin + ' to ' + s.contract.dteMax + ' days (ideal ' + s.contract.dteIdeal + ').'; }).join('') + '</li>' +
      (shr.length && sb ? '<li><b>Shares.</b> ' + escapeHtml(shr.length > 1 ? shr.slice(0, -1).join(', ') + ' and ' + shr[shr.length - 1] : shr[0]) + (shr.length > 1 ? ' buy' : ' buys') + ' stock instead of a call on the up side: $' + Number(sb.usd).toLocaleString('en-US') + ' of shares, out at ' + (e.sharesStopAtr != null && e.sharesOwnStop === false ? e.sharesStopAtr + ' ATR under the entry' : 'the setup’s own stock stop or ' + (e.sharesStopAtr != null ? e.sharesStopAtr : sb.stopAtr) + ' ATR under the entry') + ', its own target or ' + sb.targetAtr + ' ATR over it, or after ' + sb.maxSessions + ' sessions. These setups moved the stock too little for an option to pay in the long history test. A put is always an option: the engines never short stock. Share trades are scored apart from options and, since 19 November 2026, are also bought as stock in the Webull paper account (Owner Settings can switch share orders off).</li>' : '') +
      '<li><b>Exits.</b> ' + engExitsText(x) + (x.trailArm != null ? ', and a trailing stop once the trade is up ' + x.trailArm + '%' : '') + '. Some setups carry their own exits (see Setups and learning). Every trade closes two sessions before its contract expires.</li>' +
      '<li><b>Size.</b> Up to ' + e.slots + ' open trades' + (e.sideSlots ? ' (' + e.sideSlots.call + ' calls and ' + e.sideSlots.put + ' puts at most)' : '') + ' and ' + e.perRun + ' new per run, ' + engSizeWords() + '.' + (engRisk() ? ' An option expiring within ' + engRisk().wholeDte + ' days risks its whole premium; a longer one its premium times the stop times ' + engRisk().stopPad + '. Shares risk entry minus stop per share, at most ' + engUsdWord(engRisk().sharesMaxUsd) + ' of stock. A contract dearer than ' + engRisk().skipX + ' times the budget is not bought (a call signal buys shares instead). Each trade’s Size line shows how it was sized.' : '') + (d && d.fillBasis ? ' New option trades book the ask going in and the bid coming out; stops and targets fire on the mid.' : '') + '</li>' +
      (e.standing && e.rank
        ? '<li><b>Entry.</b> By rank, not by a score bar: a new call comes only from the ' + e.rank.enter + ' best-ranked stocks and a new put only from the ' + e.rank.enter + ' worst, best first. Nothing opens inside six sessions of the stock’s report, on a call far under its 200-day or a put far above it, or when today’s price already ran.</li>' +
          '<li><b>Swaps.</b> A holding is closed when the stock leaves the top third (calls) or the bottom third (puts) of the rank. A stock is ranked again when the month changes and after each of its reports; in between its place is fixed. A stock closed by its stop, take-profit or time limit is not bought again until it is ranked again.</li>'
        : '<li><b>Entry bar.</b> ' + (e.bar ? e.bar.now + ' of 100 on its own score (starts at ' + e.bar.base + '; its learning rules may move it between ' + e.bar.min + ' and ' + e.bar.max + ')' : '—') + '.</li>') +
      '</ul>';
  }
  function engStatusPills(e, d){
    var out = [];
    if (d && d.mode === 'off') out.push(engPill('Engines off', 'evb-s-fail'));
    else if (d && d.mode === 'pause') out.push(engPill('Paused by the owner: no new trades', 'evb-s-collect'));
    if (e.switchedOff) out.push(engPill('Switched off: no new trades', 'evb-s-fail'));
    if (e.paused) out.push(engPill('Paused itself' + (e.paused.until ? ' until ' + engDay(e.paused.until) : ''), 'evb-s-collect'));
    (e.standDown || []).forEach(function(c){ out.push(engPill('Standing down in ' + engCell(c.cell), 'evb-s-collect')); });
    if (!out.length) out.push(engPill('Trading', 'evb-s-pass'));
    return out.join(' ');
  }
  function engOpenTable(e, d){
    var cols = [
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol) + '</b> ' + engSideT(t) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>' + engSharedHtml(t); }, sort: function(t){ return t.symbol; } },
      { label: 'Setup', cell: function(t){ return escapeHtml(engSetup(e, t.setup)) + '<div class="crd-dim">' + (e.core ? 'monthly target' : 'score ' + slpNum(t.score, 0)) + (t.alloc && t.alloc.status !== 'new' ? ' · Allocator ' + (t.alloc.w === 0 ? 'would hold back' : slpNum(t.alloc.w, 2) + 'x') : '') + '</div>'; }, sort: function(t){ return t.setup; } },
      { label: 'Contract', cell: function(t){ return engContract(t) + '<div class="crd-dim">opened ' + escapeHtml(rglEt(t.entryDate)) + '</div>'; }, sort: function(t){ return Date.parse(t.entryDate) || 0; } },
      { label: 'In / now', num: true, cell: function(t){ return engMoney(t.contract && t.contract.mid) + ' → ' + engMoney(t.lastMid) + (t.fill && t.fill.basis === 'ask-bid' ? '<div class="crd-dim">booked: ask ' + engMoney(t.fill.entry) + (t.lastBid != null ? ' → bid ' + engMoney(t.lastBid) : '') + '</div>' : ''); }, sort: function(t){ return t.lastMid; } },
      { label: 'Result', num: true, cell: function(t){ return engPnl(t.optionPnlPct) + (t.markPnlPct != null && t.fill ? '<div class="crd-dim">at the mid ' + slpPts(t.markPnlPct, 1) + '%</div>' : '') + '<div class="crd-dim">best ' + slpPts(t.hiPct, 0) + '%, worst ' + slpPts(t.loPct, 0) + '%</div>'; }, sort: function(t){ return t.optionPnlPct; } },
      { label: 'At Webull', title: ENG_AT_WEBULL_TIP, cell: engAtWebullHtml, sort: engAtWebullSort },
      { label: 'Sessions', num: true, cell: function(t){ return String(t.sessions || 0) + (t.exits && t.exits.maxSessions ? '<span class="crd-dim"> of ' + t.exits.maxSessions + '</span>' : ''); }, sort: function(t){ return t.sessions || 0; } },
      { label: 'Exit plan', cell: function(t){ return engExitPlan(t); }, nosort: true },
    ];
    return VIEWS.tableHtml(cols, e.open || [], { key: 'eng-open-' + e.id, empty: 'No open trades. New ones open at the 11:00 and 15:30 ET runs when a setup clears the bar.' });
  }
  function engCandTable(e){
    var rows = e.candidates || [];
    if (!rows.length) return '<p class="hint">No setup scored near the bar at the latest run.</p>';
    var anySkipped = rows.some(function(c){ return c.skipped === 'price'; });
    return slpTable([['Stock'], ['Setup'], ['Score', 1], ['Why it scored', 'l'], ['What happened', 'l']], rows.map(function(c){
      var skipped = c.skipped === 'price';
      var res = (c.taken ? '<b class="sig-pos">Opened</b> ' + escapeHtml(c.tradeId || '') + (c.note ? '<div class="crd-dim">' + escapeHtml(c.note) + '</div>' : '') : escapeHtml(engCap(c.why || 'not taken'))) + (c.alloc && c.alloc.status !== 'new' ? '<div class="crd-dim">Allocator: ' + (c.alloc.status === 'closed' ? 'held back' : slpNum(c.alloc.w, 2) + 'x size') + '</div>' : '');
      return '<tr' + (skipped ? ' class="eng-row-skipped"' : '') + '><td><b>' + escapeHtml(c.symbol) + '</b> ' + (c.side !== 'put' && engSharesSetups(e).indexOf(engSetup(e, c.setup)) >= 0 ? engSideT({ contract: { structure: 'shares' } }) : engSide(c.side)) + '</td><td>' + escapeHtml(engSetup(e, c.setup)) + '</td><td class="num">' + (skipped ? '—' : slpNum(c.score, 0)) + '</td><td class="l">' + (skipped ? '<span class="crd-dim">Setup matched; not scored</span>' : escapeHtml((c.reasons || []).join('; '))) + '</td><td class="l">' + res + '</td></tr>';
    }).join('')) + (anySkipped ? '<p class="evb-note">Rows with no score matched a setup, but today’s price move ruled them out before scoring: the engine does not chase a move that already ran its way, and does not buy into one going against it. They are not traded and not tracked as shadow trades.</p>' : '');
  }
  // Fundamentals: both ends of the standing rank.
  function engRankHtml(e){
    var rk = e.rank;
    if (!rk) return '';
    if (!rk.live) return '<p class="hint">Only ' + (rk.n || 0) + ' stocks could be ranked at the latest run (it takes ' + rk.minNames + '). No rank trades open or close until there are enough.</p>';
    var third = rk.keep, n = rk.n;
    var num0 = function(v){ return v == null ? '—' : slpNum(v, 0); };
    var row = function(r){
      var facts = r.facts || {}, bits = [];
      if (facts.epsYoy != null) bits.push('EPS ' + (facts.epsYoy >= 0 ? '+' : '') + slpNum(facts.epsYoy, 0) + '% on the year');
      if (facts.beats4 != null) bits.push(facts.beats4 + ' beats, ' + (facts.misses4 || 0) + ' misses in 4');
      if (facts.fwdPE != null && facts.groupPE != null) bits.push('P/E ' + slpNum(facts.fwdPE, 1) + ' vs ' + slpNum(facts.groupPE, 1) + ' for its group');
      var where = r.enter === 'call' ? engPill('Can open a call', 'evb-s-pass') : r.enter === 'put' ? engPill('Can open a put', 'evb-s-fail') : r.zone === 'top' ? '<span class="crd-dim">Top third: kept if held</span>' : r.zone === 'bottom' ? '<span class="crd-dim">Bottom third: kept if held</span>' : '<span class="crd-dim">Middle</span>';
      return '<tr' + (r.held ? ' class="eng-rank-held"' : '') + '><td class="num">' + r.rank + '</td><td><b>' + escapeHtml(r.symbol) + '</b>' + (r.held ? ' ' + engSide(r.held) + '<div class="crd-dim">held</div>' : '') + '</td><td class="num">' + slpNum(r.score, 1) + '</td><td class="num">' + num0(r.earn) + '</td><td class="num">' + num0(r.quality) + '</td><td class="num">' + num0(r.price) + '</td><td class="l">' + where + '</td><td class="l"><span class="crd-dim">' + escapeHtml(bits.join(' · ')) + '</span></td><td>' + escapeHtml(engDay(r.asOf)) + '</td></tr>';
    };
    var head = [['Rank', 1], ['Stock'], ['Overall', 1], ['Earnings power', 1], ['Quality', 1], ['Price', 1], ['Where it stands', 'l'], ['Behind the rank', 'l'], ['Ranked on']];
    var elsewhere = (rk.heldElsewhere || []).length ? '<h4 class="eng-rank-h">Held, outside the two ends</h4>' + slpTable(head, rk.heldElsewhere.map(row).join('')) : '';
    return '<p class="evb-note">' + n + ' covered stocks are ranked on earnings power (40%), quality (30%) and price (30%). Every number is the stock’s place among the others, 0 to 100, so one outlier cannot dominate. New calls come from the best ' + rk.enter + ' and new puts from the worst ' + rk.enter + '; a holding is kept while it stays in its third (' + third + ' stocks at each end). A stock’s place is fixed until the month changes or it reports again.</p>' +
      '<h4 class="eng-rank-h">Best ' + rk.top.length + '</h4>' + slpTable(head, rk.top.map(row).join('')) +
      '<h4 class="eng-rank-h">Worst ' + rk.bottom.length + '</h4>' + slpTable(head, rk.bottom.map(row).join('')) + elsewhere;
  }
  function engNowHtml(e, d){
    var s = e.stats || {};
    var kpis = slpKpis([
      ['Open trades', (e.open || []).length + ' of ' + e.slots],
      ['Open result', '<span class="' + slpSign(s.openUsd) + '">' + engUsd(s.openUsd) + '</span>', 'Unrealized, at each open trade’s size, on the latest marks'],
      ['Closed trades', String(e.closedTotal || s.n || 0)],
      ['Win rate', engRate(s.winRate) + (engRange(s.winRange) ? '<small class="eng-kpi-sub">' + engRange(s.winRange) + '</small>' : '')],
      ['Average trade', engPnl(s.avg)],
      e.standing && e.rank ? ['Stocks ranked', String(e.rank.n || 0), 'Covered stocks in the standing rank at the latest run'] : ['Entry bar', e.bar ? String(e.bar.now) : '—', 'Its own 0 to 100 score a setup must reach'],
      ['Rules version', escapeHtml(e.rulesVersion || '—'), 'Goes up by one every time the engine’s rules change; stamped on each new trade'],
    ].concat(e.sharesStats ? [['Share trades', (e.sharesStats.open || 0) + ' open, ' + (e.sharesStats.n || 0) + ' closed' + (e.sharesStats.open ? '<small class="eng-kpi-sub ' + slpSign(e.sharesStats.openUsd) + '">' + engUsd(e.sharesStats.openUsd) + ' open</small>' : ''), 'Setups that buy stock instead of a call; scored apart from the options'], ['Shares average', engPnl(e.sharesStats.avg, 2), '% of the share price, after costs']] : []));
    return '<p class="evb-lead">' + escapeHtml(e.idea || '') + '</p>' +
      '<div class="eng-reads"><span class="eng-reads-lbl">Reads</span>' + (e.reads || []).map(function(r){ return '<span class="eng-chip">' + escapeHtml(r) + '</span>'; }).join('') + '</div>' +
      kpis +
      slpSection('eng-open', 'Open trades', engOpenTable(e, d)) +
      (e.standing && e.rank ? slpSection('eng-rank', 'The standing rank', engRankHtml(e)) : '') +
      slpSection('eng-cands', 'Latest run: what it looked at', (e.standing
        ? '<p class="evb-note">Every stock that could open a trade at the ' + escapeHtml(rglEt(d.runIso)) + ' run, best first, and why each was or was not opened. A stock with no free slot is simply looked at again next run. One held back by a learning rule is tracked as a shadow trade so its cost shows. The score here is the stock’s distance from the end of the rank (100 = the very top for a call, the very bottom for a put).</p>'
        : '<p class="evb-note">Every setup that scored near the bar at the ' + escapeHtml(rglEt(d.runIso)) + ' run, and why each was or was not opened. A setup held back by a learning rule or a size limit is tracked as a shadow trade so its cost shows.</p>') + engCandTable(e)) +
      slpSection('eng-rules', 'The rules', engRulesHtml(e, d));
  }
  function engClosedTable(e, d){
    var cols = [
      { label: 'Closed', cell: function(t){ return escapeHtml(engDay(t.exitDate)); }, sort: function(t){ return Date.parse(t.exitDate) || 0; } },
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol) + '</b> ' + engSideT(t) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>' + engSharedHtml(t); }, sort: function(t){ return t.symbol; } },
      { label: 'Setup', cell: function(t){ return escapeHtml(engSetup(e, t.setup)) + '<div class="crd-dim">score ' + slpNum(t.score, 0) + ' · rules ' + escapeHtml(t.rulesVersion || '—') + '</div>'; }, sort: function(t){ return t.setup; } },
      { label: 'Contract', cell: function(t){ return engContract(t) + '<div class="crd-dim">' + (t.fill && t.fill.basis === 'ask-bid' && t.fill.exit != null ? 'ask ' + engMoney(t.fill.entry) + ' → bid ' + engMoney(t.fill.exit) : engMoney(t.contract && t.contract.mid) + ' → ' + engMoney(t.exitMid)) + '</div>'; }, sort: function(t){ return t.contract && t.contract.expiry; } },
      { label: 'Result', num: true, cell: function(t){ return (t.outcome === 'void' ? '<span class="crd-dim">not counted</span>' : engPnl(t.optionPnlPct)) + '<div class="crd-dim">' + (t.sessions || 0) + (t.sessions === 1 ? ' session' : ' sessions') + '</div>'; }, sort: function(t){ return t.optionPnlPct; } },
      { label: 'At Webull', title: ENG_AT_WEBULL_TIP, cell: engAtWebullHtml, sort: engAtWebullSort },
      { label: 'Why it closed', cell: function(t){ return escapeHtml(engCap(t.statusLabel || t.status)); }, sort: function(t){ return t.status; } },
      { label: 'Market type', cell: function(t){ return escapeHtml(t.regime && t.regime.cell ? engCell(t.regime.cell) : '—'); }, sort: function(t){ return t.regime && t.regime.cell; } },
    ];
    return VIEWS.tableHtml(cols, e.closed || [], { key: 'eng-closed-' + e.id, tall: true, empty: 'No closed trades yet.' });
  }
  // Live against the history test, setup by setup (2026-11-17).
  var ENG_VS_READ = { 'no-history': ['Not in the history test', 'evb-s-collect'], 'too-early': ['Too early', 'evb-s-collect'], ahead: ['Ahead of the test', 'evb-s-pass'], 'in-line': ['In line with the test', 'evb-s-pass'], behind: ['Behind the test', 'evb-s-fail'] };
  function engVsHistHtml(e, d){
    var v = e.vsHistory; if (!v) return '';
    var rows = v.rows || [], lim = d.liveVsHistory || { minLive: 10, band: 5 };
    var inTest = !!(e.history && e.history.live);
    var lead = '<p class="evb-note">Each setup’s live paper record beside the same setup in the 2007 to 2026 history test, as the engine runs. Live counts the closed trades ' + (v.since ? 'since rules version ' + escapeHtml(v.since.v || '') + ' (' + escapeHtml(engDay(v.since.date)) + '), so trades made under older rules do not blur it' : 'since the engine started') + '. A setup is read once it has ' + lim.minLive + ' closed live trades: in line when its average is within ' + lim.band + ' points of the test, ahead or behind past that.' + (inTest ? '' : ' This engine is not in the long history test, so only its live side shows.') + '</p>';
    var offLbl = (e.fixesOff || []).map(function(id){ var f = (d.fixes || []).filter(function(x){ return x.id === id; })[0]; return f ? f.label : id; });
    if (offLbl.length) lead += '<p class="evb-note"><b>Switched off in Owner Settings:</b> ' + escapeHtml(offLbl.join('; ')) + '. The history test always runs with every fix on, so the setups these touch are compared against rules this engine is not using now.</p>';
    if (!rows.length) return lead + '<p class="hint">No setup has a trade yet.</p>';
    var caveat = false;
    var body = rows.map(function(r){
      var st = ENG_VS_READ[r.read] || ENG_VS_READ['too-early'], sh = r.instrument === 'shares', dp = sh ? 2 : 1;
      if (r.modelGain) caveat = true;
      var diff = r.diff == null ? '—' : '<span class="' + slpSign(r.diff) + '">' + (r.diff > 0 ? '+' : '') + Number(r.diff).toFixed(1) + ' pts</span>';
      return '<tr><td><b>' + escapeHtml(r.label) + '</b>' + (sh ? ' <span class="eng-side eng-shr">Shares</span>' : '') + (r.trial ? ENG_TRIAL_BADGE : '') + (r.modelGain ? '<div class="crd-dim">Test gain mostly from the price model *</div>' : '') + '</td>' +
        '<td class="num">' + (r.live.n || 0) + (r.live.open ? '<div class="crd-dim">' + r.live.open + ' open</div>' : '') + '</td><td class="num">' + engPnl(r.live.avg, dp) + '</td><td class="num">' + engRate(r.live.winRate) + '</td>' +
        '<td class="num">' + (r.history ? (r.history.n || 0) : '—') + '</td><td class="num">' + (r.history ? engPnl(r.history.avg, dp) : '—') + '</td><td class="num">' + (r.history ? engRate(r.history.winRate) : '—') + '</td>' +
        '<td class="num">' + diff + '</td><td>' + engPill(st[0] + (r.read === 'too-early' ? ' (' + (r.live.n || 0) + ' of ' + lim.minLive + ')' : ''), st[1]) + '</td></tr>';
    }).join('');
    var table = slpTable([['Setup'], ['Live trades', 1, 'Closed live trades under the current rules (and how many are open)'], ['Live average', 1, '% of the entry premium, or of the share price for share trades'], ['Live win rate', 1], ['Test trades', 1], ['Test average', 1], ['Test win rate', 1], ['Live minus test', 1, 'Live average less the test average, in percentage points'], ['Read']], body);
    var note = caveat ? '<p class="evb-note">* The test’s gain on these Macro setups came mostly from how it prices options, not from the funds moving the trade’s way. It reads volatility from past moves, which lags a shock, so options bought into a sudden move look cheaper there than they were. With volatility held flat, Macro as a whole went from +2.2% to −2.4% a trade in the replay, and the funds moved only 0.1% the trades’ way on average. Read their test number as unproven until the live record agrees.</p>' : '';
    return lead + table + note;
  }
  function engRecordHtml(e, d){
    var s = e.stats || {};
    var arch = s.archived && s.archived.n ? '<p class="evb-note">' + s.archived.n + ' older trades are folded into totals (' + s.archived.wins + ' wins, ' + s.archived.losses + ' losses, ' + engUsd(s.archived.sumUsd) + ' at their sizes) and are not in the tables below.</p>' : '';
    var more = (e.closedTotal || 0) > (e.closed || []).length ? '<p class="evb-note">Showing the newest ' + (e.closed || []).length + ' of ' + e.closedTotal + ' closed trades. The Export menu has the full record.</p>' : '';
    return '<p class="evb-lead">This record belongs to ' + escapeHtml(e.name) + ' only. It is kept apart from the Top Picks Track Record and from every other engine. Results are modeled from option marks at each run, like the Top Picks record; the Webull paper tab shows what the paper account actually filled.</p>' +
      engStatKpis(s, [['Largest drop', s.maxDrawdownUsd ? '−$' + Number(s.maxDrawdownUsd).toLocaleString('en-US') : '—', 'Largest fall from a peak of the running total']]) +
      engCurveHtml(s.curve, e.name + ' running total in dollars') +
      (e.sharesStats ? slpSection('eng-shares', 'Share trades', '<p class="evb-note">Setups that buy stock instead of a call, scored on their own: results are % of the share price after 0.1% costs, so they are never mixed into the option win rate and average above. The closed-trades table below lists both kinds (the Shares badge marks these).' + (e.sharesStats.archived && e.sharesStats.archived.n ? ' ' + e.sharesStats.archived.n + ' older share trades are folded into totals.' : '') + '</p>' +
        engShareKpis(e.sharesStats, [['Open now', (e.sharesStats.open || 0) + ' (' + engUsd(e.sharesStats.openUsd) + ')', 'Unrealized on the latest prices'], ['Largest drop', e.sharesStats.maxDrawdownUsd ? '−$' + Number(e.sharesStats.maxDrawdownUsd).toLocaleString('en-US') : '—']]) +
        engCurveHtml(e.sharesStats.curve, e.name + ' share trades, running total in dollars') +
        ((e.sharesStats.bySetup || []).length ? engDetails('Share trades by setup', engSplitTable(e.sharesStats.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, true)) : '')) : '') +
      (e.trialStats ? slpSection('eng-trials', 'Paper trials', '<p class="evb-note">Unproven setups on paper, added to see how they do live. They buy stock, use their own slots, teach the engine nothing and are scored here on their own, never mixed into the engine’s numbers above. In the history test their edge over random entries held for the same number of sessions was small, so read this record as the real test.</p>' +
        engShareKpis(e.trialStats, [['Open now', (e.trialStats.open || 0) + ' (' + engUsd(e.trialStats.openUsd) + ')', 'Unrealized on the latest prices'], ['Largest drop', e.trialStats.maxDrawdownUsd ? '−$' + Number(e.trialStats.maxDrawdownUsd).toLocaleString('en-US') : '—']]) +
        engCurveHtml(e.trialStats.curve, e.name + ' paper trials, running total in dollars') +
        ((e.trialStats.bySetup || []).length ? engDetails('Paper trials by setup', engSplitTable(e.trialStats.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, true)) : '')) : '') +
      (e.vsHistory ? slpSection('eng-vs-hist', 'Live against the history test', engVsHistHtml(e, d)) : '') +
      (e.sizing ? slpSection('eng-sizing', 'Conviction size against flat size', engSizingHtml(e.sizing, d)) : '') +
      slpSection('eng-closed', 'Closed trades', arch + more + engClosedTable(e, d)) +
      slpSection('eng-splits', 'Scorecard', '<p class="evb-note">The same record cut different ways. A split with a handful of trades says very little.</p>' +
        engDetails('By setup', engSplitTable(s.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }), true) +
        engDetails('By market type', engSplitTable(s.byCell, 'Market type', function(r){ return engCell(r.key); })) +
        engDetails('By macro environment', engEnvTables(s.byEnv) || '<p class="hint">No closed trades yet.</p>') +
        engDetails('By score', engSplitTable(s.byScore, 'Score band')) +
        engDetails('By side', engSplitTable(s.bySide, 'Side', function(r){ return engCap(r.key); })) +
        engDetails('By exit', engSplitTable(s.byExit, 'Why it closed', function(r){ return engExitLabel(d, r.key); })) +
        engDetails('By rules version', engSplitTable(s.byVersion, 'Rules version')) +
        engDetails('By year', engSplitTable(s.byYear, 'Year')));
  }
  // Conviction sizing against flat risk sizing (2026-11-19): the same closed
  // trades, in dollars, at the size taken and at the flat size.
  function engSizingHtml(z, d){
    z = z || {};
    var o = z.options || {}, sh = z.shares || {};
    var lead = '<p class="evb-note">Since 19 November 2026 each trade records two sizes: the flat risk size (about the risk budget at the stop) and the size taken after the conviction multiplier. Both lines below are the same closed trades, so the gap is what conviction sizing added or cost. ' + (z.open ? z.open + ' open trades carry both sizes. ' : '') + 'Results in % do not change with size.</p>';
    if (!(o.n || sh.n)) return lead + '<p class="hint">No closed trade with both sizes yet.</p>';
    var row = function(label, x){ return x && x.n ? '<tr><td>' + label + '</td><td class="num">' + x.n + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num ' + slpSign(x.flatUsd) + '">' + engUsd(x.flatUsd) + '</td><td class="num ' + slpSign(x.usd - x.flatUsd) + '">' + engUsd(x.usd - x.flatUsd) + '</td><td class="num">' + (x.bigger || 0) + ' / ' + (x.smaller || 0) + '</td></tr>' : ''; };
    return lead + slpTable([['Trades'], ['Closed', 1], ['At the size taken', 1], ['At the flat size', 1], ['Difference', 1], ['Sized up / down', 1, 'Trades the multiplier sized above and below the flat size']], row('Options', o) + row('Shares', sh));
  }
  function engLearnHtml(e, d){
    var setups = slpTable([['Setup'], ['How it triggers', 'l'], ['State'], ['Real trades', 1], ['Real average', 1], ['Shadow trades', 1], ['Shadow average', 1]], (e.setups || []).map(function(s){
      var st = ENG_STATE[s.state] || ENG_STATE.trading;
      var x = (s.exitsAll ? '<div class="crd-dim">Own exits: ' + escapeHtml(engExitsText(s.exitsAll)) + '</div>' : '') + (s.contract ? '<div class="crd-dim">Own contract: about ' + slpNum(s.contract.delta, 2) + ' delta, ' + s.contract.dteMin + ' to ' + s.contract.dteMax + ' days (ideal ' + s.contract.dteIdeal + ')</div>' : '');
      // Share results (% of the price) sit under the option ones, never mixed.
      var sub = function(b){ return b && b.n ? '<div class="crd-dim">shares: ' + b.n + '</div>' : ''; }, subAvg = function(b){ return b && b.n ? '<div class="crd-dim">shares: ' + engPnl(b.avg, 2) + '</div>' : ''; };
      var notes = (s.test ? '<div class="crd-dim">A labeled test, own record line</div>' : '') + ((s.retiredSides || []).indexOf('put') >= 0 && !s.retired ? '<div class="crd-dim">Its put side is retired</div>' : '') + (s.crashStand ? '<div class="crd-dim">Stands aside after a 7%+ one-day drop in the prior five sessions</div>' : '');
      return '<tr><td><b>' + escapeHtml(s.label) + '</b>' + engInstBadge(s) + (s.test ? ' <span class="eng-side eng-test">Test</span>' : '') + (s.trial && !s.retired ? ENG_TRIAL_BADGE : '') + (s.startsOnShadow ? '<div class="crd-dim">Started on shadow</div>' : '') + notes + '</td><td class="l">' + escapeHtml(s.how || '') + x + '</td><td>' + engPill(st[0], st[1]) + (s.since ? '<div class="crd-dim">since ' + escapeHtml(engDay(s.since)) + '</div>' : '') + '</td><td class="num">' + ((s.real && s.real.n) || 0) + sub(s.realShares) + '</td><td class="num">' + engPnl(s.real && s.real.avg) + subAvg(s.realShares) + '</td><td class="num">' + ((s.shadow && s.shadow.n) || 0) + sub(s.shadowShares) + '</td><td class="num">' + engPnl(s.shadow && s.shadow.avg) + subAvg(s.shadowShares) + '</td></tr>';
    }).join(''));
    var log = (e.learning && e.learning.log) || [];
    var logHtml = log.length ? slpTable([['Date'], ['Rules version'], ['What changed', 'l']], log.map(function(c){ return '<tr><td>' + escapeHtml(engDay(c.date)) + '</td><td>' + escapeHtml(c.v || '') + '</td><td class="l">' + escapeHtml(c.text || '') + '</td></tr>'; }).join('')) : '<p class="hint">No changes since the engine started.</p>';
    var sh = e.shadow || {}, ss = sh.stats || {};
    var shOpen = (sh.open || []).length ? slpTable([['Stock'], ['Setup'], ['Contract', 'l'], ['Tracked since'], ['Result so far', 1], ['Why it is a shadow', 'l']], sh.open.map(function(t){ return '<tr><td><b>' + escapeHtml(t.symbol) + '</b> ' + engSideT(t) + '</td><td>' + escapeHtml(engSetup(e, t.setup)) + '</td><td class="l">' + engContract(t) + '</td><td>' + escapeHtml(engDay(t.entryDate)) + '</td><td class="num">' + engPnl(t.optionPnlPct) + '</td><td class="l">' + escapeHtml(engCap(t.why || '')) + '</td></tr>'; }).join('')) : '<p class="hint">No open shadow trades.</p>';
    var shClosed = (sh.closed || []).length ? slpTable([['Closed'], ['Stock'], ['Setup'], ['Result', 1], ['Why it closed', 'l'], ['Why it was a shadow', 'l']], sh.closed.map(function(t){ return '<tr><td>' + escapeHtml(engDay(t.exitDate)) + '</td><td><b>' + escapeHtml(t.symbol) + '</b> ' + engSideT(t) + '</td><td>' + escapeHtml(engSetup(e, t.setup)) + '</td><td class="num">' + engPnl(t.optionPnlPct) + '</td><td class="l">' + escapeHtml(engExitLabel(d, t.status)) + '</td><td class="l">' + escapeHtml(engCap(t.shadowWhy || '')) + '</td></tr>'; }).join('')) : '';
    return '<p class="evb-lead">' + escapeHtml(e.name) + ' checks its own results and tightens itself, inside fixed limits and with no AI. It can pause after a losing streak, mute a setup whose whole record is clearly losing, stand down in a market type that keeps losing, and move its entry bar between ' + (e.bar ? e.bar.min + ' and ' + e.bar.max : 'its limits') + '. Each of those needs a result unlikely to be luck. A muted setup keeps running as shadow trades and comes back when 40 or more of them clearly win. Learning can only restrict the engine: it never adds size, slots, setups or data, and never touches Top Picks.</p>' +
      (e.standing ? '<p class="evb-note">This engine enters by rank, so its entry bar never decides a trade. The pause, the setup mute and the market-type stand-down still apply.</p>' : '') +
      (e.rules && (e.rules.steps || []).length ? '<p class="evb-note"><b>Rules changed by hand</b> (each one is also a line in the change log, so the record splits there):</p><ul class="eng-notes eng-rules-steps">' + e.rules.steps.map(function(r){ return '<li><b>Rules ' + r.n + '</b>, ' + escapeHtml(engDay(r.date)) + ': ' + escapeHtml(r.note || '') + '</li>'; }).join('') + '</ul>' : '') +
      slpKpis([
        ['Entry bar now', e.bar ? String(e.bar.now) : '—', e.bar ? 'Started at ' + e.bar.base + '; limits ' + e.bar.min + ' to ' + e.bar.max : ''],
        ['Rules version', escapeHtml(e.rulesVersion || '—')],
        ['Changes made', String(e.learning && e.learning.changes != null ? e.learning.changes : log.length), 'Every time the engine changed its own rules; the log below keeps the newest 20'],
        ['Shadow trades', (sh.open || []).length + ' open, ' + (ss.n || 0) + ' closed'],
        ['Shadow average', engPnl(ss.avg), 'Average result of the setups it saw and did not take'],
      ]) +
      '<p class="eng-status-line">' + engStatusPills(e, d) + '</p>' +
      slpSection('eng-setups', 'Setups', '<p class="evb-note">A setup that starts on shadow lost money in both halves of the first history test. It is tracked from day one and starts trading only when 40 or more shadow trades average +5% or better.</p>' + setups) +
      slpSection('eng-log', 'Change log', logHtml) +
      slpSection('eng-shadow', 'Shadow trades', '<p class="evb-note">Setups the engine saw and did not buy: a muted or shadow-start setup, a score under the bar, a market type it is standing down in, or no free slot. They are priced like real trades and never reach the paper account. They are how a muted setup earns its way back, and they show what each limit costs.</p>' + shOpen + (shClosed ? engDetails('Closed shadow trades (' + (sh.closed || []).length + ' newest)', shClosed) : ''));
  }
  function engHistKpis(h){
    var c = h.control;
    return engStatKpis(h, [
      ['Trades a year', slpNum(h.perYear, 0)],
      ['Largest drop', h.maxDrawdownUsd ? '−$' + Number(h.maxDrawdownUsd).toLocaleString('en-US') : '—'],
      ['Random entries', c ? engPnl(c.avg) : '—', c ? 'Average of ' + c.books + ' books that bought the same kind of contract on random days in the same names, with the same exits and costs' : 'Needs 20 or more trades'],
      ['Beat random', c ? c.beat + '%<small class="eng-kpi-sub">of ' + c.books + ' books</small>' : '—', 'Share of the random books this engine did better than'],
    ]);
  }
  function engHistoryHtml(e, d){
    var H = e.history, R = d.research;
    var notes = R && R.notes && R.notes.length ? '<ul class="eng-notes">' + R.notes.map(function(n){ return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>' : '';
    var replay = e.replay && (e.replay.raw || e.replay.held) ? (function(){
      var rows = [['Every setup', e.replay.raw], ['Shadow-start setups held back', e.replay.held]].filter(function(r){ return r[1]; });
      return slpSection('eng-replay', 'Recent replay', '<p class="evb-note">The same rule code replayed over the bars the build holds' + (d.replay && d.replay.from ? ' (' + escapeHtml(engDay(d.replay.from)) + ' to ' + escapeHtml(engDay(d.replay.to)) + ')' : '') + ', with real report dates, modeled option prices and costs. Refreshed once a day. It is a short window, so read it as a check that the rules still behave, not as a forecast.</p>' +
        slpTable([['Version'], ['Trades', 1], ['Win rate', 1], ['Average', 1], ['Median', 1], ['Dollars', 1, engSizeTip()], ['Random entries', 1], ['Beat random', 1]], rows.map(function(r){ var x = r[1], c = x.control; return '<tr><td>' + r[0] + '</td><td class="num">' + (x.n || 0) + '</td><td class="num">' + engRate(x.winRate) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num">' + engPnl(x.median) + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num">' + (c ? engPnl(c.avg) : '—') + '</td><td class="num">' + (c ? c.beat + '%' : '—') + '</td></tr>'; }).join('')) +
        (e.replay.held && e.replay.held.bySetup && e.replay.held.bySetup.length ? engDetails('By setup (shadow-start setups held back)', engSplitTable(e.replay.held.bySetup, 'Setup', function(r){ return engSetup(e, r.key); })) : ''));
    })() : (d.replay && (d.replay.error || d.replay.skipped) ? '<p class="evb-note">The recent replay did not run at the last build' + (d.replay.skipped ? ' (' + escapeHtml(d.replay.skipped) + ')' : '') + '.</p>' : '');
    var has = H && (H.live || H.held || H.raw);
    if (!has){
      var why = e.test === 'forward' ? 'This engine reads option flow, short interest and borrow, which have no stored history. It cannot be replayed on old data, so it is judged forward only: its paper record and its shadow trades are the test.' : e.test === 'replay' ? 'This engine needs each company’s report dates and EPS, which live in the private store, so it is not in the long history test. Every build replays it over the bars it holds instead.' : 'No long history test is on file for this engine yet.';
      return '<p class="evb-lead">' + why + '</p>' + replay + (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
    }
    var sel = H[engState.hist] ? engState.hist : (H.live ? 'live' : H.held ? 'held' : 'raw');
    var h = H[sel];
    // Shares only in this version (no option trades): the share trades are the test.
    var shrOnly = !(h.n > 0) && !!(h.shares && h.shares.n), hm = shrOnly ? h.shares : h;
    var pick = '<div class="eng-seg" role="group" aria-label="History test version">' + ENG_HIST.filter(function(o){ return H[o[0]]; }).map(function(o){ return '<button type="button" class="eng-seg-btn' + (o[0] === sel ? ' is-on' : '') + '" data-eng-hist="' + o[0] + '" title="' + escapeHtml(o[2]) + '">' + escapeHtml(o[1]) + '</button>'; }).join('') + '</div>';
    var what = ENG_HIST.filter(function(o){ return o[0] === sel; })[0];
    var cmp = slpTable([['Version'], ['Trades', 1], ['Win rate', 1], ['Average', 1], ['Dollars', 1, engSizeTip()], ['Largest drop', 1, 'Largest fall from a peak of the running total in dollars'], ['Random entries', 1, 'Average trade of books that bought the same kind of contract on random days'], ['Beat random', 1, 'Share of the random books this version did better than']], ENG_HIST.filter(function(o){ return H[o[0]]; }).map(function(o){ var x = H[o[0]], so = !(x.n > 0) && x.shares && x.shares.n; if (so) x = x.shares; var c = x.control; return '<tr><td>' + escapeHtml(o[1]) + '<div class="crd-dim">' + escapeHtml(o[3]) + (so ? ' · share trades' : '') + '</div></td><td class="num">' + (x.n || 0) + '</td><td class="num">' + engRate(x.winRate) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num">' + (x.maxDrawdownUsd ? '−$' + Number(x.maxDrawdownUsd).toLocaleString('en-US') : '—') + '</td><td class="num">' + (c ? engPnl(c.avg) : '—') + '</td><td class="num">' + (c ? c.beat + '%' : '—') + '</td></tr>'; }).join('')) +
      (H.live && H.held ? (function(){ var so = !(H.held.n > 0) && !(H.live.n > 0) && H.held.shares && H.live.shares, a = so ? H.held.shares : H.held, b = so ? H.live.shares : H.live; return '<p class="evb-note">What learning changed in this history' + (so ? ' (share trades)' : '') + ': trades ' + (a.n || 0) + ' to ' + (b.n || 0) + ', average trade ' + slpPts(a.avg, 1) + '% to ' + slpPts(b.avg, 1) + '%, largest drop $' + Number(a.maxDrawdownUsd || 0).toLocaleString('en-US') + ' to $' + Number(b.maxDrawdownUsd || 0).toLocaleString('en-US') + '. The learning rules can only hold the engine back, so read them as risk control, not as an edge.</p>'; })() : '');
    return '<p class="evb-lead">The engine’s rules replayed day by day over ' + (R && R.data ? escapeHtml(engDay(R.data.from)) + ' to ' + escapeHtml(engDay(R.data.to)) + ' (' + R.data.names + ' names)' : 'the long history') + ', with modeled option prices and 3.5% of premium taken as costs on every round trip. It answers how the idea behaved in different markets. It is not a forecast, and nothing here shows a reliable profit after costs.</p>' +
      slpSection('eng-hist-cmp', 'Three versions of the same test', cmp) +
      pick + '<p class="evb-note">' + escapeHtml(what ? what[2] : '') + (h.changes ? ' The learning rules made ' + h.changes + ' changes over the test and ended on version ' + escapeHtml(h.rulesVersion || '') + ' with the bar at ' + h.bar + '.' : '') + '</p>' +
      (shrOnly ? '<p class="evb-note">This engine bought only shares in this version of the test, so the tables below are its share trades: % of the share price after 0.1% costs a round trip, against random share lots with the same stock exits.</p>' +
        engShareKpis(h.shares, [['Random entries', h.shares.control ? engPnl(h.shares.control.avg, 2) : '—', h.shares.control ? 'Average of ' + h.shares.control.books + ' books of random share lots' : 'Needs 20 or more trades'], ['Beat random', h.shares.control ? h.shares.control.beat + '%' : '—']])
        : engHistKpis(h)) +
      engCurveHtml(hm.curve, e.name + ' history test running total in dollars') +
      (!shrOnly && h.shares && h.shares.n ? slpSection('eng-hist-shares', 'Share trades in this test', '<p class="evb-note">The setups that buy stock instead of a call, replayed at the open and close prices with 0.1% costs a round trip and scored on their own (% of the share price). Their random books buy share lots on random days with the same stock exits, held no longer than the real trade drawn beside it.</p>' +
        engShareKpis(h.shares, [['Random entries', h.shares.control ? engPnl(h.shares.control.avg, 2) : '—', h.shares.control ? 'Average of ' + h.shares.control.books + ' books of random share lots' : 'Needs 20 or more trades'], ['Beat random', h.shares.control ? h.shares.control.beat + '%' : '—']]) +
        engDetails('Share trades by setup', engSplitTable(h.shares.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, true), true) +
        engDetails('Share trades by time period', engSplitTable(h.shares.byWindow, 'Period', null, true)) +
        engDetails('Share trades by market type', engSplitTable(h.shares.byCell, 'Market type', function(r){ return engCell(r.key); }, true))) : '') +
      (h.trials && h.trials.n ? slpSection('eng-hist-trials', 'Paper trials in this test', '<p class="evb-note">Unproven setups that run on paper beside the engine, scored on their own. Their random books buy the same lot on random days and hold it no longer than the real trade drawn beside it, with the same exits, so a setup that sells after a few sessions is compared with a few sessions of random holding. The edge over those books is small; the live record is the real test.</p>' +
        engShareKpis(h.trials, [['Random entries', h.trials.control ? engPnl(h.trials.control.avg, 2) : '—', h.trials.control ? 'Average of ' + h.trials.control.books + ' books of random share lots, matched hold' : 'Needs 20 or more trades'], ['Beat random', h.trials.control ? h.trials.control.beat + '%' : '—']]) +
        engDetails('Paper trials by setup', engSplitTable(h.trials.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, true), true) +
        engDetails('Paper trials by time period', engSplitTable(h.trials.byWindow, 'Period', null, true))) : '') +
      slpSection('eng-hist-windows', 'By time period', engSplitTable(hm.byWindow, 'Period', null, shrOnly)) +
      slpSection('eng-hist-cells', 'By market type', '<p class="evb-note">The Regime Lab label on the day each trade opened: the trend of the market and whether volatility was calm or stressed.</p>' + engSplitTable(hm.byCell, 'Market type', function(r){ return engCell(r.key); }, shrOnly)) +
      slpSection('eng-hist-env', 'By macro environment', '<p class="evb-note">What the economy looked like when each trade opened, using only numbers that were public that day.</p>' + (engEnvTables(hm.byEnv, shrOnly) || '<p class="hint">No macro labels in this run.</p>')) +
      slpSection('eng-hist-more', 'More cuts',
        engDetails('By setup', engSplitTable(hm.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, shrOnly), true) +
        (shrOnly ? '' : engDetails('By score', engSplitTable(h.byScore, 'Score band')) +
        engDetails('By side', engSplitTable(h.bySide, 'Side', function(r){ return engCap(r.key); }))) +
        engDetails('By exit', engSplitTable(hm.byExit, 'Why it closed', function(r){ return engExitLabel(d, r.key); }, shrOnly)) +
        engDetails('By year', engSplitTable(hm.byYear, 'Year', null, shrOnly)) +
        (h.log && h.log.length ? engDetails('Changes the learning rules made (newest)', slpTable([['Date'], ['Rules version'], ['What changed', 'l']], h.log.map(function(c){ return '<tr><td>' + escapeHtml(engDay(c.date)) + '</td><td>' + escapeHtml(c.v || '') + '</td><td class="l">' + escapeHtml(c.text || '') + '</td></tr>'; }).join(''))) : '')) +
      replay +
      (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
  }

  // ---- Core engines (Trend follower, Momentum basket; 2026-11-17) ------------
  function engMonth(m){ var x = /^(\\d{4})-(\\d{2})/.exec(String(m || '')); return x ? ENG_MONTHS[+x[2] - 1] + ' ' + x[1] : '—'; }
  function engCoreRulesHtml(e){
    var trend = e.id === 'trend';
    return '<ul class="eng-rules">' +
      '<li><b>What it holds.</b> ' + (trend ? 'One fund: SPY or QQQ, whichever rose more over the last 12 months while that rise beat T-bills; otherwise TLT if it beat T-bills; otherwise T-bills (cash). About $' + Number(e.lotUsd || 0).toLocaleString('en-US') + ' of it.' : 'The ten covered stocks with the biggest rise from 12 months ago to 1 month ago (the latest month is left out because it tends to reverse), about $' + Number(e.lotUsd || 0).toLocaleString('en-US') + ' each. While SPY closed the month under its 10-month average, the whole basket’s money goes to TLT if it beat T-bills, else T-bills.') + '</li>' +
      '<li><b>When it changes.</b> Once a month, at the first 11:00 or 15:30 ET run after a month closes, read from month-end closes (nothing from the new month). In between the target is fixed, so a day’s move cannot reshuffle it.</li>' +
      '<li><b>Exits.</b> Only when a monthly check drops a holding (closed as “swapped at the monthly check”). No stop, no take-profit, no time limit: the monthly check is the risk control.</li>' +
      '<li><b>How.</b> Stock only, long only, never an option and never short. Since 19 November 2026 each holding is also bought as stock in the Webull paper account at the record’s share count (Owner Settings can switch share orders off). Days in T-bills earn nothing in this record; the history test does count the T-bill rate.</li>' +
      '<li><b>Learning.</b> None: a fixed monthly rule, the one that beat holding the S&P 500 in the 1972-2026 research. The Allocator does not size it.</li>' +
      '</ul>';
  }
  function engCoreReads(e, h){
    var r = h.reads || {};
    var cash = r.cash != null ? slpNum(r.cash, 2) + '%' : '—';
    if (e.id === 'trend') return '<span class="eng-chip"><b>SPY 12 months:</b> ' + engPnl(r.SPY) + '</span><span class="eng-chip"><b>QQQ:</b> ' + engPnl(r.QQQ) + '</span><span class="eng-chip"><b>TLT:</b> ' + engPnl(r.TLT) + '</span><span class="eng-chip"><b>T-bills:</b> ' + cash + '</span>';
    return '<span class="eng-chip"><b>SPY month-end:</b> ' + engMoney(r.spy) + ' vs 10-month average ' + engMoney(r.spyAvg10) + (r.spyAbove ? ' (above)' : ' (under)') + '</span><span class="eng-chip"><b>TLT 12 months:</b> ' + engPnl(r.TLT) + '</span><span class="eng-chip"><b>T-bills:</b> ' + cash + '</span><span class="eng-chip"><b>Stocks ranked:</b> ' + (r.ranked || 0) + '</span>';
  }
  function engCoreNowHtml(e, d){
    var h = e.holdings || {}, b = h.bench, sh = e.sharesStats || {};
    var target = (h.hold || []).length ? h.hold.map(function(s){ var held = (h.held || []).indexOf(s) >= 0; return '<span class="eng-chip"><b>' + escapeHtml(s) + '</b>' + ((h.setups || {})[s] === 'top-10' ? '' : ' ' + escapeHtml(engSetup(e, (h.setups || {})[s]))) + (held ? '' : ' <span class="crd-dim">(not bought yet)</span>') + '</span>'; }).join('') : '<span class="eng-chip"><b>T-bills (cash)</b></span>';
    var kpis = slpKpis([
      ['Holding', (e.open || []).length ? (e.open || []).length + ((e.open || []).length === 1 ? ' position' : ' positions') : 'Cash', 'Share lots held now'],
      ['Open result', '<span class="' + slpSign(sh.openUsd) + '">' + engUsd(sh.openUsd) + '</span>', 'Unrealized on the latest prices'],
      ['Since it started', b && b.pct != null ? engPnl(b.pct) + '<small class="eng-kpi-sub ' + slpSign(b.usd) + '">' + engUsd(b.usd) + '</small>' : '—', b ? 'Closed and open holdings on $' + Number(b.capital || 0).toLocaleString('en-US') + ' since ' + engDay(b.since) : 'Starts with its first monthly target'],
      ['S&P 500 (SPY) since then', b && b.spyPct != null ? engPnl(b.spyPct) + '<small class="eng-kpi-sub ' + slpSign(b.spyUsd) + '">' + engUsd(b.spyUsd) + '</small>' : '—', b ? 'The same money in SPY from ' + engDay(b.since) + ' (price only, SPY ' + engMoney(b.spyThen) + ' then)' : ''],
      ['Monthly check', engMonth(h.month), h.asOf ? 'Read from the ' + engDay(h.asOf) + ' close; the next check is the first run after this month closes' : ''],
      ['Closed holdings', String(sh.n || 0), (sh.n ? engPnl(sh.avg, 1) + ' average, % of the share price' : 'None yet')],
    ]);
    var ranked = (h.ranked || []).length ? slpTable([['Rank', 1], ['Stock'], ['12-1 momentum', 1, 'Rise from 12 months ago to 1 month ago'], ['Now', 'l']], h.ranked.map(function(r){ var inT = (h.hold || []).indexOf(r.symbol) >= 0, held = (h.held || []).indexOf(r.symbol) >= 0; return '<tr' + (held ? ' class="eng-rank-held"' : '') + '><td class="num">' + r.rank + '</td><td><b>' + escapeHtml(r.symbol) + '</b></td><td class="num">' + engPnl(r.mom) + '</td><td class="l">' + (held ? engPill('Held', 'evb-s-pass') : inT ? engPill('In the ten', 'evb-s-ready') : '<span class="crd-dim">Not in the ten</span>') + '</td></tr>'; }).join('')) : '';
    var log = (h.log || []).length ? slpTable([['Month'], ['Holds', 'l'], ['In', 'l'], ['Out', 'l'], ['Why', 'l']], h.log.map(function(c){ return '<tr><td>' + escapeHtml(engMonth(c.month)) + (c.since ? '<div class="crd-dim">from ' + escapeHtml(engDay(c.since)) + '</div>' : '') + '</td><td class="l">' + ((c.hold || []).length ? c.hold.map(escapeHtml).join(', ') : 'T-bills') + '</td><td class="l">' + ((c.in || []).length ? c.in.map(escapeHtml).join(', ') : '—') + '</td><td class="l">' + ((c.out || []).length ? c.out.map(escapeHtml).join(', ') : '—') + '</td><td class="l"><span class="crd-dim">' + escapeHtml(c.why || '') + '</span></td></tr>'; }).join('')) : '<p class="hint">No monthly check yet.</p>';
    return '<p class="evb-lead">' + escapeHtml(e.idea || '') + '</p>' +
      kpis +
      slpSection('eng-core-target', 'This month’s target' + (h.month ? ' (' + escapeHtml(engMonth(h.month)) + ')' : ''), h.month ? '<div class="eng-reads">' + target + '</div><p class="evb-note">' + escapeHtml(h.why || '') + '</p><div class="eng-reads"><span class="eng-reads-lbl">Reads</span>' + engCoreReads(e, h) + '</div>' : '<p class="hint">No target yet: the engine needs 13 month-end closes and the fed funds rate.</p>') +
      slpSection('eng-open', 'Holdings', engOpenTable(e, d)) +
      (ranked ? slpSection('eng-core-ranked', 'Strongest covered stocks at the last check', ranked) : '') +
      slpSection('eng-core-log', 'Monthly checks', log) +
      slpSection('eng-rules', 'The rules', engCoreRulesHtml(e));
  }
  function engCoreRecordHtml(e, d){
    var s = e.sharesStats || {};
    return '<p class="evb-lead">This record belongs to ' + escapeHtml(e.name) + ' only. Each row is one holding from the month it was bought to the month a check swapped it out, in % of the share price after 0.1% costs a round trip.</p>' +
      engShareKpis(s, [['Open now', (s.open || 0) + ' (' + engUsd(s.openUsd) + ')', 'Unrealized on the latest prices'], ['Largest drop', s.maxDrawdownUsd ? '−$' + Number(s.maxDrawdownUsd).toLocaleString('en-US') : '—']], 'core') +
      engCurveHtml(s.curve, e.name + ' running total in dollars') +
      slpSection('eng-closed', 'Closed holdings', engClosedTable(e, d)) +
      ((s.bySetup || []).length ? slpSection('eng-splits', 'Scorecard', engDetails('By setup', engSplitTable(s.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }, true), true) + engDetails('By market type', engSplitTable(s.byCell, 'Market type', function(r){ return engCell(r.key); }, true))) : '');
  }
  function engCoreHistHtml(e, d){
    var H = e.history || {}, h = H.live || H.held || H.raw, c = h && h.core, R = d.research;
    var notes = R && R.notes && R.notes.length ? '<ul class="eng-notes">' + R.notes.map(function(n){ return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>' : '';
    if (!c) return '<p class="evb-lead">No history test on file for this engine yet.</p>' + (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
    var byYear = slpTable([['Year'], [e.name, 1], ['SPY', 1], ['Difference', 1]], (c.byYear || []).map(function(y){ return '<tr><td>' + escapeHtml(y.year) + '</td><td class="num">' + engPnl(y.ret) + '</td><td class="num">' + engPnl(y.spy) + '</td><td class="num">' + engPnl(y.ret != null && y.spy != null ? Math.round((y.ret - y.spy) * 10) / 10 : null) + '</td></tr>'; }).join(''));
    return '<p class="evb-lead">The same rule code replayed day by day from ' + escapeHtml(engDay(c.from)) + ' to ' + escapeHtml(engDay(R && R.data ? R.data.to : '')) + ' (' + slpNum(c.years, 1) + ' years), as $1 that follows the holdings at every open and close, idle money earning the fed funds rate, against $1 in SPY bought the same day and held.' + (e.id === 'momentum' ? ' This one picks from today’s covered names, which are largely the names that went on to win, so it reads much better than a list of the time would: on a 1,000-name list of the time the same rule made about 21% a year.' : '') + '</p>' +
      slpKpis([
        ['A year', engPnl(c.cagr), 'Compound yearly return'],
        ['SPY a year', engPnl(c.spyCagr), 'Buy and hold over the same days'],
        ['Whole period', engPnl(c.total, 0), 'SPY ' + (c.spyTotal != null ? (c.spyTotal > 0 ? '+' : '') + slpNum(c.spyTotal, 0) + '%' : '—')],
        ['Worst drop', engPnl(c.maxDrawdown), 'SPY ' + slpNum(c.spyMaxDrawdown, 1) + '%: the largest fall from a peak'],
        ['Invested', c.invested + '%', 'Share of days in a holding rather than T-bills'],
        ['Swaps', String(c.swaps || 0), 'Holdings closed by a monthly check'],
      ]) +
      slpSection('eng-core-years', 'Year by year', byYear) +
      (h.shares && h.shares.n ? slpSection('eng-core-trades', 'Each holding', engShareKpis(h.shares, null, 'core') + engDetails('By market type', engSplitTable(h.shares.byCell, 'Market type', function(r){ return engCell(r.key); }, 'core'))) : '') +
      (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
  }
  function engCoreLearnHtml(e){
    return '<p class="evb-lead">' + escapeHtml(e.name) + ' does not learn. It runs one fixed monthly rule, and it is not paused, muted or stood down by the learning rules the signal engines use. Its monthly checks, with what came in and went out, are on the Now tab.</p>' +
      slpSection('eng-setups', 'Setups', slpTable([['Setup'], ['When it is used', 'l']], (e.setups || []).map(function(s){ return '<tr><td><b>' + escapeHtml(s.label) + '</b> <span class="eng-side eng-shr">Shares</span></td><td class="l">' + escapeHtml(s.how || '') + '</td></tr>'; }).join('')));
  }

  // ---- The Allocator ---------------------------------------------------------
  function engAllocSide(r){ return r.instrument === 'shares' ? '<span class="eng-side eng-shr">Shares</span>' : r.side ? engSide(r.side) : '<span class="crd-dim">—</span>'; }
  function engAllocState(r){ return r.status === 'closed' ? engPill('Held back', 'evb-s-fail') : r.status === 'new' ? engPill('Too new to judge', 'evb-s-collect') : engPill('Open', 'evb-s-pass'); }
  function engAllocHtml(d){
    var a = d.allocator;
    if (!a) return '<p class="evb-lead">The Allocator is off (ENGINES_ALLOCATOR=0, or Owner Settings → Data & desks → Engine Allocator). Every signal-engine setup trades at normal size.</p>';
    if (a.error) return '<p class="evb-lead">The Allocator could not be read at the last run (' + escapeHtml(a.error) + '). Setups traded at normal size.</p>';
    var rows = a.rows || [], rule = a.rule || {}, bk = a.book || {};
    var nOpen = rows.filter(function(r){ return r.status === 'open'; }).length, nClosed = rows.filter(function(r){ return r.status === 'closed'; }).length, nNew = rows.filter(function(r){ return r.status === 'new'; }).length;
    var advise = a.mode === 'advise';
    var mode = advise ? engPill('Advising: holds nothing back', 'evb-s-collect') : engPill('On: holds back setups expected to lose', 'evb-s-pass');
    var table = slpTable([['Engine'], ['Setup'], ['Side'], ['Today'], ['Size', 1, 'The size it would give a new trade, 0.1x to 2x of the normal lot'], ['Expected', 1, 'Its blended expected result a trade in today’s market type'], ['In this market', 1, 'Results in today’s market type: count and average'], ['Everywhere', 1, 'Every result: count and average'], ['From', 'l', 'Live engine trades (real and shadow) and the history test’s record it started from']], rows.map(function(r){
      var pct = function(v){ return v == null ? '—' : engPnl(v); };
      return '<tr><td><button type="button" class="eng-link" data-eng-go="' + escapeHtml(r.engine) + '">' + escapeHtml(engName(r.engine)) + '</button></td><td>' + escapeHtml(r.label || r.setup) + '</td><td>' + engAllocSide(r) + '</td><td>' + engAllocState(r) + '</td><td class="num">' + (r.status === 'closed' ? '0' : slpNum(r.w, 2) + 'x') + '</td><td class="num">' + pct(r.ev) + '</td><td class="num">' + (r.cn || 0) + '<div class="crd-dim">' + pct(r.cAvg) + '</div></td><td class="num">' + (r.n || 0) + '<div class="crd-dim">' + pct(r.avg) + '</div></td><td class="l"><span class="crd-dim">' + (r.liveN || 0) + ' live, ' + (r.priorN || 0) + ' history</span></td></tr>';
    }).join(''));
    var hist = '', H = a.history;
    if (H && H.total){
      var heldCell = function(o){ return o.heldN == null ? '<td class="num">—</td>' : '<td class="num"><span class="' + slpSign(o.heldUsd) + '">' + engUsd(o.heldUsd) + '</span><div class="crd-dim">' + o.heldN + ' trades</div></td>'; };
      var line = function(x, label, note){ return x && x.total ? '<tr><td>' + label + '<div class="crd-dim">' + note + '</div></td><td class="num">' + (x.total.off.n || 0) + '</td><td class="num ' + slpSign(x.total.off.usd) + '">' + engUsd(x.total.off.usd) + '</td>' + heldCell(x.total.off) + '<td class="num">' + (x.total.on.n || 0) + '</td><td class="num ' + slpSign(x.total.on.usd) + '">' + engUsd(x.total.on.usd) + '</td><td class="num ' + slpSign(x.total.on.sizedUsd) + '">' + engUsd(x.total.on.sizedUsd) + '</td></tr>' : ''; };
      // The note is read from the numbers: what holding back did to the
      // total, what the trades it would have held back made on the path
      // without it, and what its sizes did.
      var runs = [[H.oos, 'With a starting record'], [H, 'Starting from nothing']].filter(function(r){ return r[0] && r[0].total; });
      var diffs = runs.map(function(r){ return (r[0].total.on.usd || 0) - (r[0].total.off.usd || 0); });
      var sized = runs.map(function(r){ return (r[0].total.on.sizedUsd || 0) - (r[0].total.on.usd || 0); });
      var all = function(xs, f){ return xs.length > 0 && xs.every(f); };
      var verdict = all(diffs, function(d){ return d < 0; }) ? 'Holding back lowered the dollar total in ' + (runs.length > 1 ? 'both runs' : 'the run') + '.'
        : all(diffs, function(d){ return d > 0; }) ? 'Holding back raised the dollar total in ' + (runs.length > 1 ? 'both runs' : 'the run') + '.'
        : 'Holding back raised the dollar total in one run and lowered it in the other.';
      var parts = runs.map(function(r, i){
        var o = r[0].total.off;
        return r[1] + ': ' + engUsd(o.usd) + ' without it, ' + engUsd(r[0].total.on.usd) + ' with it' + (o.heldN != null ? '; on the path without it, the ' + o.heldN + ' trades it would have held back made ' + engUsd(o.heldUsd) : '') + '.';
      });
      var helds = runs.map(function(r){ return r[0].total.off.heldUsd; }).filter(function(v){ return v != null; });
      var knock = all(helds, function(v){ return v > 0; }) ? ' The trades it would have held back made money in ' + (helds.length > 1 ? 'both runs' : 'the run') + ', so its read of which setups lose in a market type did not hold up on the next trades.'
        : all(helds, function(v){ return v < 0; }) && all(diffs, function(d){ return d < 0; }) ? ' The trades it would have held back lost money, yet the total fell: what changed after (other trades taking their slots, the learning rules seeing a different record) cost more than the read saved.' : '';
      // Engine by engine: right where the trades it would have held back lost
      // money in every run, wrong where they made money in every run.
      var byEng = {};
      runs.forEach(function(r){ (r[0].rows || []).forEach(function(x){ if (x.off && x.off.heldUsd != null) (byEng[x.name || x.id] = byEng[x.name || x.id] || []).push(x.off.heldUsd); }); });
      var rightOn = [], wrongOn = [];
      Object.keys(byEng).forEach(function(k){ var v = byEng[k]; if (v.length === runs.length && all(v, function(u){ return u < 0; })) rightOn.push(k); else if (v.length === runs.length && all(v, function(u){ return u > 0; })) wrongOn.push(k); });
      if (rightOn.length) knock += ' It read ' + rightOn.map(function(k){ return escapeHtml(k); }).join(' and ') + ' right: the trades it would have held back there lost money in every run.';
      if (wrongOn.length) knock += ' It read ' + wrongOn.map(function(k){ return escapeHtml(k); }).join(' and ') + ' wrong: the trades it would have held back there made money in every run.';
      var sizeLine = all(sized, function(d){ return d < 0; }) ? ' Its sizes lowered the dollar total in every run, so no lot is resized: the sizes are a scored line only.'
        : all(sized, function(d){ return d > 0; }) ? ' Its sizes raised the dollar total in every run; they are still a scored line only, and no lot is resized.'
        : ' Its sizes helped in one run and hurt in the other, so no lot is resized: the sizes are a scored line only.';
      hist = slpTable([['Test'], ['Trades without it', 1], ['Dollars without it', 1, engSizeTip() + '. Share trades: ' + engShareTip().replace(/^Dollars made or lost at each share trade’s size: /, '').replace(/^Dollars made or lost on /, '')], ['It would have held back', 1, 'On the same trades: the ones it would have held back, and what they made'], ['Trades with it', 1], ['Dollars with it', 1, 'The same, after it held back losing setups'], ['At its sizes', 1, 'The trades it let through, each at the size it gave']],
        line(H.oos, 'With a starting record, as it runs live', escapeHtml(engDay(H.oos && H.oos.priorFrom)) + ' to ' + escapeHtml(engDay(H.oos && H.oos.priorTo)) + ' as its record, tested ' + escapeHtml(engDay(H.oos && H.oos.from)) + ' to ' + escapeHtml(engDay(H.oos && H.oos.to))) +
        line(H, 'Starting from nothing', escapeHtml(engDay(H.from)) + ' to ' + escapeHtml(engDay(H.to)) + ', judging each setup only on trades already finished')) +
        '<p class="evb-note">Signal engines with learning on, Technicals, Reversion and Macro (the engines the long history covers). ' + verdict + ' ' + escapeHtml(parts.join(' ')) + knock + sizeLine + ' That is why it starts out advising (since November 17, 2026): every trade opens, and the “Trades it would have held back” figure above keeps live score of whether holding back would have helped.</p>';
    }
    var heldLive = bk.advisedOut || 0;
    return '<p class="evb-lead">' + mode + ' The Allocator picks no trades. Before each signal-engine trade it looks up how that setup (engine, setup, side, and option or shares) has done in today’s market type, one of the Regime Lab’s six, and blends that with how it has done everywhere. Expected at or under zero: when on, it holds the trade back and tracks it as a shadow trade, so the setup keeps a record and can earn its way back; when advising, the trade opens and is marked as one it would hold back. Above zero: it records a size, expected ' + slpNum(rule.sizeDiv, 0) + '% a trade being normal size. A setup needs ' + (rule.minN || 30) + ' results before it is judged. Share results count ' + (rule.sharesScale || 5) + 'x, as in the learning rules. The Trend follower and Momentum basket are not allocated. Owner Settings → Data & desks → Engine Allocator switches it between advising, on and off.</p>' +
      slpKpis([
        ['Market today', escapeHtml(a.cell ? engCell(a.cell) : 'Not labeled'), a.cell ? 'The Regime Lab label at the run' : 'With no label every judged setup trades at normal size'],
        ['Setups open', String(nOpen), 'Judged and allowed today'],
        [advise ? 'Would hold back' : 'Held back', String(nClosed), 'Expected to lose in today’s market type'],
        ['Too new', String(nNew), 'Fewer than ' + (rule.minN || 30) + ' results: normal size'],
        advise ? ['Trades it would have held back', '<span class="' + slpSign(bk.heldUsd) + '">' + engUsd(bk.heldUsd || 0) + '</span>', heldLive + ' closed real trades it marked; below zero, holding back would have helped']
          : ['Shadow trades it holds', String(a.held || 0), 'Open shadow trades it held back'],
        ['Its trades: normal / its sizes', '<span class="' + slpSign(bk.plainUsd) + '">' + engUsd(bk.plainUsd) + '</span><small class="eng-kpi-sub ' + slpSign(bk.sizedUsd) + '">' + engUsd(bk.sizedUsd) + ' at its sizes</small>', (bk.n || 0) + ' closed real trades it stamped'],
      ]) +
      slpSection('eng-alloc-table', 'Every setup today', table + '<p class="evb-note">Expected = (results here ÷ (results here + ' + (rule.shrink || 30) + ')) × the average here + (' + (rule.shrink || 30) + ' ÷ (results here + ' + (rule.shrink || 30) + ')) × the average everywhere, so a market type with few results leans on the setup’s whole record. Results are % of premium for options and % of the share price × ' + (rule.sharesScale || 5) + ' for shares.' + (a.priorFrom ? ' The history record covers ' + escapeHtml(engDay(a.priorFrom.from)) + ' to ' + escapeHtml(engDay(a.priorFrom.to)) + ' (' + (a.priorFrom.n || 0) + ' trades, every setup).' : '') + '</p>') +
      (hist ? slpSection('eng-alloc-hist', 'History test', hist) : '');
  }

  // ---- Webull paper (shared account, engine trades) --------------------------
  function engLoadMirror(force){
    if (engState.mirrorLoading) return;
    if (!force && engState.mirror && Date.now() - engState.mirrorAt < 5 * 60 * 1000) return;
    if (!force && engState.mirrorError && Date.now() - engState.mirrorAt < 60 * 1000) return;
    if (!HAS_OWNER_ACCESS) return;
    engState.mirrorLoading = true; engState.mirrorError = null;
    // The paper account is read from the Owner API, never from a data file (and never by the MCP).
    fetch('/api/auth/webull-mirror?scope=engines', { cache: 'no-store', credentials: 'same-origin' }).then(function(r){
      if (!r.ok){ var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function(j){
      engState.mirror = j && typeof j === 'object' ? j : null; engState.mirrorAt = Date.now(); engState.mirrorLoading = false; renderEngines();
    }).catch(function(err){
      engState.mirrorLoading = false; engState.mirrorAt = Date.now();
      engState.mirrorError = err && err.status === 404 ? 'not available here' : String((err && err.message) || err || 'failed');
      renderEngines();
    });
  }
  function engOrderPrefix(t){ var a = (t && t.attempts) || []; for (var i = 0; i < a.length; i++) if (a[i] && a[i].orderPrefix) return a[i].orderPrefix; return ''; }
  function engUnit(t, n){ return t && t.instrument === 'stock' ? (n === 1 ? 'share' : 'shares') : (n === 1 ? 'contract' : 'contracts'); }
  function engFillHtml(t){
    var f = ENG_FILL[t.fillOutcome] || null, req = Number(t.requestedQty) || 0, got = Number(t.filledQty) || 0;
    var size = req ? (got === req || !got ? String(req) + ' ' + engUnit(t, req) + (got ? '' : ' asked') : got + ' of ' + req + ' ' + engUnit(t, req)) : '';
    return (f ? engPill(f[0], f[1]) : '—') + (size ? '<div class="crd-dim">' + escapeHtml(size) + '</div>' : '') + engStockRangeHtml(t);
  }
  // The Owner's stock order range at Webull (Owner Settings, 2026-11-19): why
  // a stock order's share count differs from the engine record's.
  function engRangeUsd(v){ return '$' + Math.round(Number(v) || 0).toLocaleString('en-US'); }
  function engStockRangeHtml(t){
    var r = t && t.stockRange;
    if (!r || t.instrument !== 'stock') return '';
    var rec = t.recordQty != null ? ' (record ' + t.recordQty + ')' : '';
    var txt = t.qtyBasis === 'shares-min' ? 'Raised to the ' + engRangeUsd(r.minUsd) + ' minimum' + rec
      : t.qtyBasis === 'shares-max' ? 'Cut to the ' + engRangeUsd(r.maxUsd) + ' maximum' + rec
      : t.qtyBasis === 'shares-over-max' ? 'One share costs more than the ' + engRangeUsd(r.maxUsd) + ' maximum' : '';
    return txt ? '<div class="crd-dim" title="Owner Settings, Account limits: the smallest and largest engine stock order at Webull. The engine record keeps its own share count.">' + escapeHtml(txt) + '</div>' : '';
  }
  function engMirrorById(){
    var m = engState.mirror; if (!m) return null;
    if (engState.mirrorIdx && engState.mirrorIdx.m === m) return engState.mirrorIdx.by;
    var by = {}; (m.trades || []).forEach(function(t){ if (t && t.tradeId) by[t.tradeId] = t; });
    engState.mirrorIdx = { m: m, by: by }; return by;
  }
  // The engine record's "At Webull" cell: the fill and the paper result beside the engine's own.
  function engAtWebullHtml(t){
    if (!HAS_OWNER_ACCESS) return '—';
    var by = engMirrorById();
    if (!by) return '<span class="crd-dim">' + (engState.mirrorLoading ? 'loading…' : '—') + '</span>';
    var w = by[t.tradeId];
    if (!w) return '<span class="crd-dim">Not sent</span>';
    var res = w.paperPnlPct != null ? '<div class="crd-dim">Webull ' + engPnl(w.paperPnlPct) + '</div>' : '';
    return engFillHtml(w) + res;
  }
  function engAtWebullSort(t){ var by = engMirrorById(), w = by && by[t.tradeId]; return w ? (w.paperPnlPct != null ? w.paperPnlPct : -1e9) : -2e9; }
  var ENG_AT_WEBULL_TIP = 'What the shared Webull paper account filled for this trade (filled, partly filled or missed) and its paper result. Not sent = the trade predates the mirror, was kept off it by a switch, or the mirror has not run since.';
  function engMirrorRows(m, id){ return ((m && m.trades) || []).filter(function(t){ return id === 'all' ? !!t.engine : t.engine === id; }); }
  function engMirrorTable(rows, withEngine){
    var cols = [
      { label: 'Trade', cell: function(t){ var px = engOrderPrefix(t); return '<b>' + escapeHtml(t.symbol || '') + '</b> ' + (t.instrument === 'stock' ? '<span class="eng-side eng-shr">Shares</span>' : engSide(t.side)) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>' + (px ? '<div class="crd-dim" title="The first letters of this trade’s order IDs at Webull. Orders sent before November 16, 2026 start with plain ms.">Webull order IDs start ' + escapeHtml(px) + '</div>' : ''); }, sort: function(t){ return t.tradeId; } },
      { label: 'State', cell: function(t){ return escapeHtml(ENG_MIRROR_STATE[t.state] || engCap(t.state)) + (t.needsReview ? ' ' + engPill('Needs review', 'evb-s-fail') : ''); }, sort: function(t){ return t.state; } },
      { label: 'Webull fill', cell: function(t){ return engFillHtml(t); }, sort: function(t){ return t.fillOutcome; } },
      { label: 'Position', cell: function(t){ return escapeHtml(String(t.legs || '').replace(/^BUY /, '')); }, nosort: true },
      { label: 'Entry', num: true, cell: function(t){ return (t.fillPrice == null ? '—' : engMoney(t.fillPrice)) + (t.engineEntryPrice != null ? '<div class="crd-dim">engine ' + engMoney(t.engineEntryPrice) + (t.fillPrice != null && t.entryDiffPct != null ? ' (' + slpPts(t.entryDiffPct, 1) + '%)' : '') + '</div>' : ''); }, sort: function(t){ return t.fillPrice; } },
      { label: 'Exit', num: true, cell: function(t){ return (t.closeFillPrice == null ? '—' : engMoney(t.closeFillPrice)) + (t.engineExitPrice != null ? '<div class="crd-dim">engine ' + engMoney(t.engineExitPrice) + (t.closeFillPrice != null && t.exitDiffPct != null ? ' (' + slpPts(t.exitDiffPct, 1) + '%)' : '') + '</div>' : ''); }, sort: function(t){ return t.closeFillPrice; } },
      { label: 'Paper result', num: true, cell: function(t){ return engPnl(t.paperPnlPct) + (t.enginePnlPct != null ? '<div class="crd-dim">engine ' + slpPts(t.enginePnlPct, 1) + '%</div>' : ''); }, sort: function(t){ return t.paperPnlPct; } },
      { label: 'Notes', cell: function(t){ var sc = t.sharedContract; return (sc ? '<div class="eng-shared">Held by ' + escapeHtml(engName(sc.heldBy || 'flagship')) + (sc.heldById ? ' (' + escapeHtml(sc.heldById) + ')' : '') + '</div>' : '') + ((t.sharedWith || []).length ? '<div class="eng-shared eng-shared-holder">Also on: ' + t.sharedWith.map(function(x){ return escapeHtml(engName(x.source || 'flagship')) + (x.tradeId ? ' (' + escapeHtml(x.tradeId) + ')' : ''); }).join(', ') + '</div>' : '') + (t.note ? '<div class="crd-dim">' + escapeHtml(t.note) + '</div>' : ''); }, nosort: true },
    ];
    if (withEngine) cols.splice(1, 0, { label: 'Made by', cell: function(t){ return escapeHtml(t.madeBy || engName(t.engine)); }, sort: function(t){ return t.engine; } });
    return VIEWS.tableHtml(cols, rows, { key: 'eng-mirror' + (withEngine ? '-all' : ''), empty: 'No engine trades in the paper account yet. The mirror runs right after each 11:00 and 15:30 ET build.' });
  }
  function engMirrorHtml(id){
    var m = engState.mirror;
    var lead = '<p class="evb-lead">Every engine trades in the same Webull paper account as Top Picks. Option trades are sent at the engine record’s size (1 to 10 contracts) and share trades, including the Trend follower and Momentum basket holdings, are bought as stock (long only, never short). Trades sent before 19 November 2026 were one contract each, so compare the % results here, not the dollars.</p>' +
      engDetails('How orders are sized, filled and labeled', '<p class="evb-note">An engine option trade asks for the record’s contract count, capped at 10. An engine stock order buys the record’s share count when it costs between the smallest and largest stock order set in Owner Settings (Account limits tab; $2,000 and $25,000 unless changed); a smaller lot is raised to the fewest whole shares that reach the smallest, a bigger one is cut to the most that fit under the largest, and a stock whose single share costs more than the largest is not bought. The engine record keeps its own share count either way. A partly filled entry keeps what filled and sells only that; an entry that never fills inside the price allowance (2%, then 4%, then 5% in the last minutes of the day) is logged as missed. Every order is labeled with the engine that made it: the trade ID starts with the engine’s tag (TEC:, REV:, MAC: and so on), the order ID sent to Webull starts with ms plus the same tag (mstec…, msrev…), and every row of both downloads has made_by and setup columns. Top Picks orders have no tag (ms followed by letters and digits). When two engines want the exact same option contract it is bought once: the first holder owns the paper position and the other records the trade on paper marks, labeled with who holds it. Stock is not shared that way: each engine buys its own shares.</p>');
    if (!m){
      if (engState.mirrorLoading || (!engState.mirrorError && HAS_OWNER_ACCESS)) return lead + '<p class="hint">Loading the paper account…</p>';
      return lead + '<p class="hint">The paper account could not be read (' + escapeHtml(engState.mirrorError || 'not signed in') + '). It is only available on the live site with the Owner session. <button type="button" class="eng-link" data-eng-mirror-retry>Try again</button></p>';
    }
    var rows = engMirrorRows(m, id), h = (m.health && m.health.engines) || null;
    var byOut = function(k){ return rows.filter(function(t){ return t.fillOutcome === k; }).length; };
    var z = m.sizing || null;
    var rangeTxt = z && z.shares && Number(z.stockMaxUsd) > 0 ? '; each stock order ' + (Number(z.stockMinUsd) > 0 ? engRangeUsd(z.stockMinUsd) + ' to ' : 'up to ') + engRangeUsd(z.stockMaxUsd) + ' of stock (Account limits tab)' : '';
    var sizeLine = z ? '<p class="evb-note">Owner Settings: share orders ' + (z.shares ? 'on' : '<b>off</b> (share trades stay on the engine record only)') + rangeTxt + '; quantities above one ' + (z.quantities ? 'on' : '<b>off</b> (every option trade is sent as one contract)') + '.</p>' : '';
    var filled = rows.filter(function(t){ return t.fillPrice != null; }), done = rows.filter(function(t){ return t.paperPnlPct != null; });
    var gaps = filled.map(function(t){ return Number(t.entryDiffPct); }).filter(function(v){ return isFinite(v); });
    var avgGap = gaps.length ? gaps.reduce(function(a, b){ return a + b; }, 0) / gaps.length : null;
    var avgPaper = done.length ? done.reduce(function(a, t){ return a + Number(t.paperPnlPct); }, 0) / done.length : null;
    var state = !m.enabled ? engPill('Mirror off', 'evb-s-fail') : m.enginesMirror === false ? engPill('Engine trades not being added (ENGINES_MIRROR is off)', 'evb-s-collect') : engPill('Mirror on', 'evb-s-pass');
    var issues = ((m.health && m.health.issues) || []).filter(function(i){ return id === 'all' || /ENGINE|MIRROR|RECONCIL|ORDER|LOCK/.test(i.code || ''); });
    return lead + '<p class="eng-status-line">' + state + ' <span class="crd-dim">Last mirror run ' + escapeHtml(rglEt(m.lastRunIso)) + '.</span></p>' + sizeLine +
      slpKpis([
        ['Orders tracked', String(rows.length)],
        ['Filled', String(byOut('filled')), 'Every contract or share asked for was bought'],
        ['Partly filled', String(byOut('partial')), 'Some of the size filled; the rest did not inside the allowed price range. Only what filled is held and sold'],
        ['Missed', String(byOut('missed')), 'The entry order did not fill inside the allowed price range'],
        ['Not bought (shared)', String(rows.filter(function(t){ return t.state === 'skipped'; }).length), 'The same contract was already held by another engine'],
        ['Avg entry gap', avgGap == null ? '—' : slpPts(avgGap, 1) + '%', 'Paper fill against the engine’s entry price; above zero means the paper account paid more'],
        ['Avg paper result', engPnl(avgPaper), 'Closed paper trades only'],
      ]) +
      (id === 'all' && h ? '<p class="evb-note">Open engine trades: ' + h.open + '. In the paper account: ' + h.mirrored + '. Shared with another holder: ' + h.shared + '. Entry not filled: ' + h.unfilled + (h.held ? ' (' + h.held + ' held back by your controls)' : '') + '. Waiting on an order: ' + h.pending + '. No mirror record yet: ' + h.untracked + '.</p>' : '') +
      (issues.length ? '<ul class="eng-notes">' + issues.map(function(i){ return '<li>' + escapeHtml(i.message || i.code) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="evb-note">Entry and Exit show the paper fill, with the engine’s own price and the gap between them underneath.</p>' +
      engMirrorTable(rows, id === 'all') +
      '<p class="evb-note">Downloads (every engine): <a href="/api/auth/webull-mirror?format=csv&amp;scope=engines">fills CSV</a> · <a href="/api/auth/webull-mirror?format=orders&amp;scope=engines">every order attempt CSV</a>. The Top Picks fills stay on the Track Record’s Real fills tab.</p>';
  }

  // ---- All engines ----------------------------------------------------------
  // The money-leak fixes of 17 November 2026 and whether each is on (Owner
  // Settings → Data & desks → Strategy engines).
  function engFixesHtml(d){
    var all = d.fixes || [];
    if (!all.length) return '';
    var li = function(f){ return '<li>' + engPill(f.on ? 'On' : 'Off', f.on ? 'evb-s-pass' : 'evb-s-fail') + ' ' + escapeHtml(f.label) + ' <span class="crd-dim">(' + (f.engines || []).map(function(id){ return escapeHtml(engName(id)); }).join(', ') + ')</span></li>'; };
    var list = all.filter(function(f){ return f.step !== 4; }), honest = all.filter(function(f){ return f.step === 4; });
    var rows = list.map(li).join('');
    var z = d.sizing, fg = d.fear;
    var honestHtml = honest.length ? slpSection('eng-all-honest', 'Honest paper trades (19 November 2026)', '<p class="evb-note">These make the paper record count what a real account would pay and hold. They were not picked from the history test. Option trades book the ask going in and the bid coming out, so the spread is a cost in the record (stops and targets still fire on the mid). Each trade is sized to risk about ' + (z && z.budget ? engUsdWord(z.budget) : 'the risk budget') + ', 1 to ' + ((z && z.maxQty) || 10) + ' contracts, and a conviction multiplier of ' + slpNum((z && z.convMin) || 0.5, 1) + 'x to ' + slpNum((z && z.convMax) || 2, 0) + 'x moves it with how far the score clears the bar, the Allocator’s read, whether the options are cheap or rich, the spread, and what is already open in the name and its sector group; every trade keeps its flat size beside it. Technicals trades shares only. Reversion’s washout bounce stands aside after a 7% one-day drop. The extreme-fear bounce is a labeled test: one call and a shares twin when fear and greed is under ' + ((fg && fg.below) || 25) + ', each with its own fills. Each has its own switch in Owner Settings (Data & desks → Strategy engines), and the record splits at a new rules version, never reset.' + (fg ? ' Fear and greed at the last run: ' + slpNum(fg.score, 0) + ' (' + escapeHtml(fg.source || 'CNN') + (fg.stale ? ', stale' : '') + ')' + (fg.score < fg.below && !fg.stale ? ', under ' + fg.below + ': the test can open.' : '.') : ' No fear and greed reading reached the last run, so the test opened nothing.') + '</p><ul class="eng-notes eng-fixes">' + honest.map(li).join('') + '</ul>' + (z && z.compare ? engSizingHtml(z.compare, d) : '')) : '';
    return honestHtml + slpSection('eng-all-fixes', 'Rule fixes from the history replay', '<p class="evb-note">On 17 November 2026 every 2007 to 2026 history-test trade was replayed with other entries, exits and contracts. The ' + (['no', 'one', 'two', 'three', 'four', 'five', 'six'][list.length] || list.length) + ' changes below helped in both halves of the history and still helped when the whole history was run again with each one switched off in turn. A fifth, no take-profit on Macro’s yields-falling TLT calls, looked better trade by trade but made less in that full run (each call held longer and blocked the next TLT signal), so it was not made. Each change has its own switch in Owner Settings (Data & desks → Strategy engines); off puts that part back for new trades. They were picked from the same history they are scored on, so the live record decides: each engine’s Track record tab shows its setups live against the test.</p><ul class="eng-notes eng-fixes">' + rows + '</ul>');
  }
  function engAllHtml(d){
    var f = d.flagshipStats;
    var rows = (d.compare || []).map(function(c){
      var st = d.mode === 'off' ? engPill('Off', 'evb-s-fail') : c.switchedOff ? engPill('Switched off', 'evb-s-fail') : (d.mode === 'pause' || c.paused) ? engPill('Paused', 'evb-s-collect') : engPill('Trading', 'evb-s-pass');
      if (c.core){
        // A core engine: its holdings in % of the share price, and the S&P line.
        var x = c.shares || {}, b = c.bench;
        return '<tr><td class="eng-cmp-name"><button type="button" class="eng-link" data-eng-go="' + escapeHtml(c.id) + '"><b>' + escapeHtml(c.name) + '</b></button><div class="crd-dim">' + escapeHtml(c.tag) + ' · core, monthly · shares' + (b && b.pct != null ? ' · ' + slpPts(b.pct, 1) + '% vs SPY ' + slpPts(b.spyPct, 1) + '% since it started' : '') + '</div></td><td>' + st + '</td><td class="num">' + c.open + ' of ' + c.slots + (c.open ? '<div class="crd-dim ' + slpSign(x.openUsd) + '">' + engUsd(x.openUsd) + '</div>' : '') + '</td><td class="num">' + (x.n || 0) + '</td><td class="num">' + engRate(x.winRate) + '</td><td class="num">' + engPnl(x.avg, 1) + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num">—</td><td class="num">—</td></tr>';
      }
      return '<tr><td class="eng-cmp-name"><button type="button" class="eng-link" data-eng-go="' + escapeHtml(c.id) + '"><b>' + escapeHtml(c.name) + '</b></button><div class="crd-dim">' + escapeHtml(c.tag) + ' · rules ' + escapeHtml(c.rulesVersion || '') + ' · bar ' + c.bar + '</div></td><td>' + st + '</td><td class="num">' + c.open + ' of ' + c.slots + (c.open ? '<div class="crd-dim ' + slpSign(c.openUsd) + '">' + engUsd(c.openUsd) + '</div>' : '') + '</td><td class="num">' + (c.n || 0) + '</td><td class="num">' + engRate(c.winRate) + (engRange(c.winRange) ? '<div class="crd-dim">' + engRange(c.winRange) + '</div>' : '') + '</td><td class="num">' + engPnl(c.avg) + '</td><td class="num ' + slpSign(c.usd) + '">' + engUsd(c.usd) + '</td><td class="num">' + slpNum(c.profitFactor, 2) + '</td><td class="num">' + (c.shadowN || 0) + (c.shadowAvg != null ? '<div class="crd-dim">' + slpPts(c.shadowAvg, 1) + '%</div>' : '') + '</td></tr>';
    }).join('');
    var flag = '<tr class="eng-flag-row"><td class="eng-cmp-name"><button type="button" class="eng-link" data-wf-go="picks"><b>Top Picks</b></button><div class="crd-dim">Flagship · its own pages and Track Record</div></td><td>' + engPill('Flagship', 'evb-s-ready') + '</td><td class="num">' + (f ? f.open : '—') + '</td><td class="num">' + (f ? f.n : '—') + '</td><td class="num">' + (f ? engRate(f.winRate) : '—') + '</td><td class="num">' + (f ? engPnl(f.avg) : '—') + '</td><td class="num crd-dim" colspan="3">Full record on the <button type="button" class="eng-link" data-wf-go="track">Top Picks track record</button> page</td></tr>';
    var t = d.total || {};
    var total = '<tr class="eng-total-row"><td class="eng-cmp-name"><b>Signal engines, options</b></td><td></td><td class="num">' + (t.open || 0) + '</td><td class="num">' + (t.n || 0) + '</td><td class="num">' + engRate(t.winRate) + '</td><td class="num">' + engPnl(t.avg) + '</td><td class="num ' + slpSign(t.usd) + '">' + engUsd(t.usd) + '</td><td class="num">' + slpNum(t.profitFactor, 2) + '</td><td></td></tr>';
    var ts = t.shares || null;
    var sharesRow = ts && ((ts.n || 0) + (ts.open || 0)) ? '<tr class="eng-total-row"><td class="eng-cmp-name"><b>Signal engines, share trades</b><div class="crd-dim">% of the share price, not counted above</div></td><td></td><td class="num">' + (ts.open || 0) + '</td><td class="num">' + (ts.n || 0) + '</td><td class="num">' + engRate(ts.winRate) + '</td><td class="num">' + engPnl(ts.avg, 2) + '</td><td class="num ' + slpSign(ts.usd) + '">' + engUsd(ts.usd) + '</td><td class="num">' + slpNum(ts.profitFactor, 2) + '</td><td></td></tr>' : '';
    var tc = t.core || null;
    var coreRow = tc && ((tc.n || 0) + (tc.open || 0)) ? '<tr class="eng-total-row"><td class="eng-cmp-name"><b>Core engines, holdings</b><div class="crd-dim">% of the share price, not counted above</div></td><td></td><td class="num">' + (tc.open || 0) + '</td><td class="num">' + (tc.n || 0) + '</td><td class="num">' + engRate(tc.winRate) + '</td><td class="num">' + engPnl(tc.avg, 1) + '</td><td class="num ' + slpSign(tc.usd) + '">' + engUsd(tc.usd) + '</td><td class="num">' + slpNum(tc.profitFactor, 2) + '</td><td></td></tr>' : '';
    var cmp = slpTable([['Engine'], ['Status'], ['Open', 1, 'Open trades of the slots it may use, and their unrealized result on the latest marks'], ['Closed', 1], ['Win rate', 1], ['Average trade', 1], ['Dollars', 1, engSizeTip()], ['Profit factor', 1], ['Shadow trades', 1, 'Closed shadow trades and their average result']], flag + rows + total + sharesRow + coreRow);

    var mk = d.market || {}, env = mk.env || {}, mac = mk.macro || {};
    var envChips = ENG_ENV.map(function(k){ return env[k[0]] ? '<span class="eng-chip"><b>' + k[1] + ':</b> ' + escapeHtml(String(env[k[0]])) + '</span>' : ''; }).join('');
    var backdrop = '<div class="eng-reads"><span class="eng-chip"><b>Market type:</b> ' + escapeHtml(mk.regime && mk.regime.cell ? engCell(mk.regime.cell) : 'not labeled') + '</span>' + (mk.macroState ? '<span class="eng-chip"><b>Market tape:</b> ' + escapeHtml(engCap(mk.macroState)) + '</span>' : '') + envChips + (mk.macroEvent ? '<span class="eng-chip"><b>Last session:</b> ' + escapeHtml(String(mk.macroEvent).split('+').map(function(k){ return ENG_EVENT[k] || k; }).join(' and ')) + '</span>' : '') + '</div>' +
      '<p class="evb-note">10-year yield ' + slpNum(mac.y10, 2) + '% (' + slpPts(mac.y10Chg, 0) + ' bp in a month) · financial conditions ' + slpNum(mac.nfci, 2) + ' (' + slpPts(mac.nfciChg, 2) + ' in four weeks) · dollar ' + slpPts(mac.usdChgPct, 1) + '% in a month · VIX ' + slpNum(mac.vix, 1) + ' (' + slpNum(mac.vixRatio, 2) + 'x the 3-month) · CPI ' + slpNum(mac.cpiYoy, 1) + '% on the year. Each number is the latest one that was public at the run.</p>';

    var lr = d.lastRun, last;
    if (!lr) last = '<p class="hint">This file was carried forward by a build that was not a Top Picks run. The engines act only at the 11:00 and 15:30 ET runs.</p>';
    else last = '<ul class="eng-notes">' +
      '<li><b>Opened ' + (lr.opened || []).length + ':</b> ' + ((lr.opened || []).length ? lr.opened.map(escapeHtml).join(', ') : 'nothing cleared a bar') + '</li>' +
      '<li><b>Closed ' + (lr.closed || []).length + ':</b> ' + ((lr.closed || []).length ? lr.closed.map(function(c){ return escapeHtml(c.tradeId) + ' (' + escapeHtml(engExitLabel(d, c.status)) + ', ' + slpPts(c.optionPnlPct, 1) + '%)'; }).join(', ') : 'none') + '</li>' +
      '<li><b>Shadow trades:</b> ' + (lr.shadowOpened || 0) + ' started, ' + (lr.shadowClosed || 0) + ' finished</li>' +
      '<li><b>Rule changes:</b> ' + ((lr.changes || []).length ? lr.changes.map(function(c){ return escapeHtml(engName(c.engine)) + ': ' + escapeHtml(c.text || ''); }).join(' ') : 'none') + '</li>' +
      ((lr.errors || []).length ? '<li class="sig-neg"><b>Errors:</b> ' + lr.errors.map(escapeHtml).join('; ') + '</li>' : '') + '</ul>';

    var shared = (d.shared || []).length ? slpTable([['Contract', 'l'], ['Holds the paper position', 'l'], ['Recorded without buying', 'l']], d.shared.map(function(s){
      return '<tr><td class="l"><b>' + escapeHtml(s.symbol) + '</b> ' + engStrike(s.contract.strike) + ' ' + escapeHtml(String(s.contract.optionType || '')) + ' · ' + engExp(s.contract.expiry) + '</td><td class="l">' + (s.heldBy ? escapeHtml(s.heldBy.name) + ' <span class="crd-dim">' + escapeHtml(s.heldBy.tradeId || '') + '</span>' : '—') + '</td><td class="l">' + (s.alsoOn || []).map(function(x){ return escapeHtml(x.name) + ' <span class="crd-dim">' + escapeHtml(x.tradeId || '') + '</span>'; }).join(', ') + '</td></tr>';
    }).join('')) : '<p class="hint">No contract is on more than one engine right now.</p>';

    var changes = (d.changes || []).length ? slpTable([['Date'], ['Engine'], ['Rules version'], ['What changed', 'l']], d.changes.map(function(c){ return '<tr><td>' + escapeHtml(engDay(c.date || c.iso)) + '</td><td>' + escapeHtml(engName(c.engine)) + '</td><td>' + escapeHtml(c.v || '') + '</td><td class="l">' + escapeHtml(c.text || '') + '</td></tr>'; }).join('')) : '<p class="hint">No engine has changed its own rules yet.</p>';

    var runs = (d.runs || []).length ? slpTable([['Run'], ['Opened', 1], ['Closed', 1], ['Shadow started', 1], ['Shadow finished', 1], ['Rule changes', 1], ['Names read', 1], ['Went first', 'l', 'The engines take turns opening new trades, one each per pass, and the engine that goes first moves on by one every run'], ['Errors', 'l']], d.runs.map(function(r){ return '<tr><td>' + escapeHtml(rglEt(r.iso)) + (r.mode && r.mode !== 'on' ? ' <span class="crd-dim">(' + escapeHtml(r.mode) + ')</span>' : '') + '</td><td class="num">' + (r.opened || 0) + '</td><td class="num">' + (r.closed || 0) + '</td><td class="num">' + (r.shadowOpened || 0) + '</td><td class="num">' + (r.shadowClosed || 0) + '</td><td class="num">' + (r.changes || 0) + '</td><td class="num">' + (r.views == null ? '—' : r.views) + '</td><td class="l">' + (r.first ? escapeHtml(engName(r.first)) : '—') + '</td><td class="l">' + ((r.errors || []).length ? '<span class="sig-neg">' + r.errors.map(escapeHtml).join('; ') + '</span>' : '') + '</td></tr>'; }).join('')) : '<p class="hint">No run logged yet.</p>';

    var hl = d.health, health = '';
    if (hl){
      var miss = [];
      if ((hl.noChain || []).length) miss.push('no option chain this build: ' + hl.noChain.map(escapeHtml).join(', '));
      if ((hl.thinBars || []).length) miss.push('too little price history: ' + hl.thinBars.map(escapeHtml).join(', '));
      if ((hl.staleBars || []).length) miss.push('price history out of date: ' + hl.staleBars.map(escapeHtml).join(', '));
      health = '<p class="evb-note">Data check at the last run: ' + hl.views + ' of ' + hl.universe + ' names had everything the engines read.' + (miss.length ? ' Left out: ' + miss.join('; ') + '.' : '') + ((hl.earnBackup || []).length ? ' Report date from Webull (the main source had none; used only to hold back new entries near the report, never to open one): ' + hl.earnBackup.map(escapeHtml).join(', ') + '.' : '') + '</p>';
    }

    var R = d.research, hist = '';
    if (R){
      var hrows = (d.engines || []).map(function(e){
        var H = e.history || {};
        function cellOf(x){ return x ? '<td class="num">' + (x.n || 0) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num">' + (x.control ? engPnl(x.control.avg) + '<div class="crd-dim">beat ' + x.control.beat + '%</div>' : '—') + '</td>' : '<td class="num crd-dim" colspan="3">not in the long test</td>'; }
        var core = e.core && H.live && H.live.core;
        if (core) return '<tr><td><button type="button" class="eng-link" data-eng-go="' + escapeHtml(e.id) + '" data-eng-sub="history">' + escapeHtml(e.name) + '</button></td><td class="num" colspan="6">' + engPnl(core.cagr) + ' a year against SPY’s ' + engPnl(core.spyCagr) + ' (worst drop ' + slpNum(core.maxDrawdown, 0) + '% vs ' + slpNum(core.spyMaxDrawdown, 0) + '%), held as a portfolio</td></tr>';
        return '<tr><td><button type="button" class="eng-link" data-eng-go="' + escapeHtml(e.id) + '" data-eng-sub="history">' + escapeHtml(e.name) + '</button></td>' + cellOf(H.raw) + cellOf(H.live) + '</tr>';
      }).join('');
      hist = '<p class="evb-note">' + (R.data ? escapeHtml(engDay(R.data.from)) + ' to ' + escapeHtml(engDay(R.data.to)) + ', ' : '') + 'modeled option prices, 3.5% costs per round trip. "Random entries" is the average of books that bought the same kind of contract on random days. No engine shows a reliable profit after costs in this test; what it shows is whether an idea did better than random and in which markets. Open an engine for the cuts by period, market type and macro environment.</p>' +
        '<div class="acc-tscroll"><table class="acc-qtable evb-table slp-table" data-nosort><thead><tr><th rowspan="2">Engine</th><th colspan="3" class="num">Every setup, no learning</th><th colspan="3" class="num">As the engine runs</th></tr><tr><th class="num">Trades</th><th class="num">Average</th><th class="num">Random entries</th><th class="num">Trades</th><th class="num">Average</th><th class="num">Random entries</th></tr></thead><tbody>' + hrows + '</tbody></table></div>';
    }

    var mode = d.mode === 'off' ? engPill('Engines off', 'evb-s-fail') : d.mode === 'pause' ? engPill('Paused: open trades are still managed, nothing new opens', 'evb-s-collect') : engPill('Running', 'evb-s-pass');
    return '<p class="evb-lead">' + mode + ' Eight rules-only engines trade on paper beside Top Picks. Six signal engines each have their own idea, data, score and track record and share one Webull paper account; two core engines (Trend follower, Momentum basket) hold stock month to month, bought as stock in the same paper account since 19 November 2026. The Allocator decides which signal setups may trade in today’s market. None of them uses AI, and none can change a Top Pick, a grade or the Top Picks Track Record. Paper tracking started ' + escapeHtml(engDay(d.startedIso || d.startDate)) + '.</p>' +
      slpSection('eng-all-cmp', 'Side by side', cmp + '<p class="evb-note">Engine results are % of the entry premium, marked at each 11:00 and 15:30 ET run; the dollars count each trade at its size (' + engSizeWords() + (engRisk() ? ' since 19 November 2026; about $2,000 of premium from 17 November' : ' since 17 November 2026') + '). Setups that buy shares instead of a call (since 17 November 2026) are scored on their own line, in % of the share price. With few trades the win-rate range is wide: judge an engine on dozens of closed trades, not a week.</p>') +
      engFixesHtml(d) +
      slpSection('eng-all-curve', 'Running total, every engine', engAllCurveHtml(d) + '<p class="evb-note">Closed trades only, each at its size, by the day each trade closed. Top Picks keeps its own curve on the Top Picks track record.</p>') +
      slpSection('eng-all-open', 'Open trades, every engine (' + (((d.total && d.total.open) || 0) + ((d.total && d.total.shares && d.total.shares.open) || 0) + ((d.total && d.total.core && d.total.core.open) || 0)) + ')', engAllOpenHtml(d)) +
      slpSection('eng-all-market', 'What the market looks like to them', backdrop) +
      slpSection('eng-all-last', 'Latest run (' + escapeHtml(rglEt(d.runIso)) + ')', last + health) +
      slpSection('eng-all-shared', 'Same contract on more than one engine', '<p class="evb-note">When two engines (or an engine and Top Picks) pick the exact same ticker, strike and expiration, the paper account buys it once. Whoever held it first owns the position; the other records the trade on its own track record, labeled with who holds it.</p>' + shared) +
      slpSection('eng-all-changes', 'Rule changes the engines made', changes) +
      (hist ? slpSection('eng-all-hist', 'History test, 2007 to 2026', hist) : '') +
      slpSection('eng-all-webull', 'Webull paper account', engMirrorHtml('all')) +
      slpSection('eng-all-runs', 'Run log', runs);
  }

  // ---- Shell ----------------------------------------------------------------
  function engOneHtml(d, e){
    var sub = engState.sub;
    var tabs = '<div class="ui-tabs eng-subtabs" role="tablist" aria-label="' + escapeHtml(e.name) + ' views">' + ENG_SUBS.map(function(s){ return '<button type="button" class="ui-tab' + (s[0] === sub ? ' is-on' : '') + '" role="tab" aria-selected="' + (s[0] === sub ? 'true' : 'false') + '" data-eng-sub="' + s[0] + '">' + s[1] + (s[0] === 'now' && (e.open || []).length ? '<span class="ui-tab-count">' + e.open.length + '</span>' : '') + '</button>'; }).join('') + '</div>';
    var body = e.core
      ? (sub === 'record' ? engCoreRecordHtml(e, d) : sub === 'learn' ? engCoreLearnHtml(e) : sub === 'history' ? engCoreHistHtml(e, d) : sub === 'webull' ? engMirrorHtml(e.id) : engCoreNowHtml(e, d))
      : (sub === 'record' ? engRecordHtml(e, d) : sub === 'learn' ? engLearnHtml(e, d) : sub === 'history' ? engHistoryHtml(e, d) : sub === 'webull' ? engMirrorHtml(e.id) : engNowHtml(e, d));
    return '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">' + (e.core ? 'Core engine · ' : 'Paper engine · ') + escapeHtml(e.tag) + '</span><h2 class="card-title">' + escapeHtml(e.name) + '</h2></div><span class="eng-head-pills">' + engStatusPills(e, d) + '</span></header>' + tabs + '<div class="ui-tab-panel eng-body">' + body + '</div>';
  }
  function engSyncBar(){
    var bar = $('eng-bar'); if (!bar) return;
    var btns = bar.querySelectorAll('[data-eng]');
    for (var i = 0; i < btns.length; i++){
      var on = btns[i].getAttribute('data-eng') === engState.sel;
      btns[i].classList.toggle('is-on', on); btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var d = engState.data, total = 0;
    var counts = bar.querySelectorAll('[data-eng-count]');
    for (var j = 0; j < counts.length; j++){
      var id = counts[j].getAttribute('data-eng-count'), n = null;
      if (d && id !== 'flagship' && id !== 'all'){ var e = engFind(d, id); n = e ? (e.open || []).length : null; }
      else if (d && id === 'all') n = d.total ? d.total.open : null;
      counts[j].hidden = !(n > 0);
      counts[j].textContent = n > 0 ? String(n) : '';
      counts[j].title = n > 0 ? n + ' open' : '';
      total += n || 0;
    }
  }
  function renderEngines(){
    engSyncBar();
    var pane = $('eng-pane');
    if (!pane) return;
    var d = engState.data;
    if (!d){
      var msg = engState.loading ? 'Loading the engines…' : engState.error === 'not written yet'
        ? 'The engines have not run yet. They act at every 11:00 and 15:30 ET Top Picks run on a trading day; the first one after this went live writes their first candidates, trades and record.'
        : 'The engines could not be loaded' + (engState.error ? ' (' + escapeHtml(engState.error) + ')' : '') + '.';
      pane.innerHTML = '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engines</span><h2 class="card-title">' + escapeHtml(engName(engState.sel)) + '</h2></div></header><p class="hint eng-empty">' + msg + (engState.loading ? '' : ' <button type="button" class="eng-link" data-eng-reload>Check again</button>') + '</p>';
      return;
    }
    var html;
    if (engState.sel === 'allocator') html = '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engines</span><h2 class="card-title">Allocator</h2><p class="picks-intro">Which signal-engine setups may trade in today’s market, and at what size.</p></div></header><div class="eng-body">' + engAllocHtml(d) + '</div>';
    else if (engState.sel === 'all') html = '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engines</span><h2 class="card-title">All engines</h2><p class="picks-intro">Six signal engines and two core engines on paper beside Top Picks, each on its own record. Top Picks has its own pages.</p></div></header><div class="eng-body">' + engAllHtml(d) + '</div>';
    else { var e = engFind(d, engState.sel); html = e ? engOneHtml(d, e) : '<p class="hint eng-empty">This engine is not in the latest file.</p>'; }
    pane.innerHTML = html + '<p class="evb-note eng-foot">Paper only. Written by the ' + escapeHtml(rglEt(d.runIso)) + ' run' + (d.builtAtIso && d.builtAtIso !== d.runIso ? ', carried by the ' + escapeHtml(rglEt(d.builtAtIso)) + ' build' : '') + '. Engines version ' + escapeHtml(String(d.version || '')) + '. Research, not advice: an option can lose its whole premium.</p>';
    if (engState.sel === 'all' || engState.sub === 'webull' || engState.sub === 'record') engLoadMirror(false);
    if (VIEWS && VIEWS.rescan) VIEWS.rescan();
  }
  function loadEngines(force){
    if (!HAS_OWNER_ACCESS) return;
    if (engState.loading) return;
    if (!force && (engState.data || engState.error) && Date.now() - engState.fetchedAt < 5 * 60 * 1000){ renderEngines(); return; }
    engState.loading = true; engState.error = null;
    renderEngines();
    quantFetchJson(dataUrl('engines.json')).then(function(row){
      engState.data = row && typeof row === 'object' && Array.isArray(row.engines) ? row : null;
      engState.error = engState.data ? null : 'not written yet';
      engState.fetchedAt = Date.now(); engState.loading = false;
      renderEngines();
      if (typeof ocRenderPanel === 'function' && OC.checkSym) ocRenderPanel();
      var op = $('page-pane-open-picks'); if (op && !op.hidden && typeof renderOpenPicks === 'function') renderOpenPicks();
    }).catch(function(err){
      engState.loading = false; engState.fetchedAt = Date.now();
      engState.error = err && err.status === 404 ? 'not written yet' : String((err && err.message) || err || 'failed');
      renderEngines();
      var op = $('page-pane-open-picks'); if (op && !op.hidden && typeof renderOpenPicks === 'function') renderOpenPicks();
    });
  }
  function engUrl(){
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== 'engines') return;
      if (engState.sel === 'all') url.searchParams.delete('engine'); else url.searchParams.set('engine', engState.sel);
      if (engState.sel === 'all' || engState.sub === 'now') url.searchParams.delete('ev'); else url.searchParams.set('ev', engState.sub);
      var next = url.pathname + (url.search || '') + (url.hash || '');
      if (next !== window.location.pathname + window.location.search + window.location.hash) history.replaceState(null, '', next);
    } catch (_) {}
  }
  function engSelect(id, sub){
    if (!engValid(id)) id = 'all';
    engState.sel = id;
    if (sub && ENG_SUBS.some(function(s){ return s[0] === sub; })) engState.sub = sub;
    engUrl();
    loadEngines(false);
    var sw = $('eng-switch'); if (sw && sw.getBoundingClientRect().top < 0 && sw.scrollIntoView) sw.scrollIntoView({ block: 'start' });
  }
  function engBind(){
    if (engState.bound) return;
    var bar = $('eng-bar'), pane = $('eng-pane');
    if (!bar || !pane) return;
    engState.bound = true;
    bar.addEventListener('click', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-eng]') : null;
      if (b) engSelect(b.getAttribute('data-eng'));
    });
    bar.addEventListener('keydown', function(ev){
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var btns = Array.prototype.slice.call(bar.querySelectorAll('[data-eng]')), i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      var n = btns[(i + (ev.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); engSelect(n.getAttribute('data-eng')); ev.preventDefault();
    });
    pane.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest ? ev.target : null; if (!t) return;
      var go = t.closest('[data-eng-go]');
      if (go){ engSelect(go.getAttribute('data-eng-go'), go.getAttribute('data-eng-sub') || 'now'); return; }
      var sub = t.closest('[data-eng-sub]');
      if (sub){ engState.sub = sub.getAttribute('data-eng-sub'); engUrl(); renderEngines(); return; }
      var hist = t.closest('[data-eng-hist]');
      if (hist){ engState.hist = hist.getAttribute('data-eng-hist'); renderEngines(); return; }
      if (t.closest('[data-eng-reload]')){ loadEngines(true); return; }
      if (t.closest('[data-eng-mirror-retry]')){ engLoadMirror(true); renderEngines(); return; }
    });
  }
  // Called every time the Strategy engines page opens (and on Back / Forward).
  function engOnTab(){
    engBind();
    var want = 'all', sub = null;
    try { var q = new URLSearchParams(window.location.search); want = q.get('engine') || 'all'; sub = q.get('ev'); } catch (_) {}
    if (!engValid(want)) want = 'all';
    engState.sel = want;
    if (sub && ENG_SUBS.some(function(s){ return s[0] === sub; })) engState.sub = sub;
    engUrl();
    if (HAS_OWNER_ACCESS) loadEngines(false); else renderEngines();
  }
`;
}

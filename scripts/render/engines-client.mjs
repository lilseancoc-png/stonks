// Strategy engines on the Top Picks page (2026-11-16). The engine switcher
// keeps Top Picks as the flagship view and adds one view per rules-only paper
// engine plus "All engines". It renders the Owner-only engines.json written
// by every Top Picks decision run (lib/engines/index.mjs): each engine's own
// candidates, open and closed trades, scorecard, setups, learning log, shadow
// trades and history test, and the engine trades in the shared Webull paper
// account (/api/auth/webull-mirror?scope=engines).
//
// Pasted into the app.js IIFE after renderSelfLoopJs(), so it reuses the
// slp* / evb* formatters, rglEt, escapeHtml, $, dataUrl, quantFetchJson,
// VIEWS, lineSvgHtml and tlTradeId from that scope. ES5 only.
import { ENGINES, ENGINE_IDS, FLAGSHIP } from '../../lib/engines/config.mjs';

export const ENGINE_TABS = Object.freeze([
  { id: FLAGSHIP.id, name: FLAGSHIP.name, tag: FLAGSHIP.tag },
  { id: 'all', name: 'All engines', tag: '' },
  ...ENGINE_IDS.map((id) => ({ id, name: ENGINES[id].name, tag: ENGINES[id].tag })),
]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The switcher bar and the engine pane, placed above the Top Picks card.
export function enginesBarHtml() {
  const tabs = ENGINE_TABS.map((t, i) => `<button type="button" class="ui-tab eng-tab${i === 0 ? ' is-on' : ''}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" data-eng="${esc(t.id)}">${esc(t.name)}${t.id === FLAGSHIP.id ? '<span class="eng-flag">Flagship</span>' : ''}<span class="ui-tab-count eng-count" data-eng-count="${esc(t.id)}" hidden></span></button>`).join('');
  return `<div class="eng-switch" id="eng-switch">
    <div class="ui-tabs eng-tabs" id="eng-bar" role="tablist" aria-label="Trading engines">${tabs}</div>
  </div>
  <section class="card eng-pane" id="eng-pane" hidden aria-live="polite"></section>`;
}

export function renderEnginesJs() {
  return `
  // ---- Strategy engines (Top Picks page) ------------------------------------
  var ENG_TABS = ${JSON.stringify(ENGINE_TABS)};
  var ENG_SUBS = [['now', 'Now'], ['record', 'Track record'], ['learn', 'Setups and learning'], ['history', 'History test'], ['webull', 'Webull paper']];
  var ENG_HIST = [['live', 'As the engine runs', 'Shadow-start setups held back and the learning rules switched on: the closest read of how the engine runs today.'], ['held', 'Learning off', 'Shadow-start setups held back, learning rules off.'], ['raw', 'Every setup', 'Every setup trading from day one and no learning: the unpicked read.']];
  var ENG_ENV = [['rates', 'Fed policy'], ['inflation', 'Inflation'], ['conditions', 'Financial conditions'], ['curve', 'Yield curve'], ['vix', 'VIX level'], ['recession', 'Economy']];
  var ENG_CELL = { 'up-calm': 'Trending up, calm', 'up-stressed': 'Trending up, stressed', 'down-calm': 'Trending down, calm', 'down-stressed': 'Trending down, stressed', 'chop-calm': 'Choppy, calm', 'chop-stressed': 'Choppy, stressed' };
  var ENG_STATE = { trading: ['Trading', 'evb-s-pass'], shadow: ['On shadow', 'evb-s-collect'], muted: ['Muted', 'evb-s-fail'] };
  var ENG_MIRROR_STATE = { entering: 'Buying', open: 'Open', exiting: 'Selling', closed: 'Closed', missed: 'Missed', skipped: 'Not bought', settled: 'Settled' };
  var ENG_EVENT = { fomc: 'Fed decision day', cpi: 'CPI day', jobs: 'Jobs report day' };
  var ENG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var engState = { data: null, loading: false, fetchedAt: 0, error: null, sel: 'flagship', sub: 'now', hist: 'live', mirror: null, mirrorLoading: false, mirrorError: null, mirrorAt: 0, bound: false };

  function engValid(id){ for (var i = 0; i < ENG_TABS.length; i++) if (ENG_TABS[i].id === id) return true; return false; }
  function engName(id){ for (var i = 0; i < ENG_TABS.length; i++) if (ENG_TABS[i].id === id) return ENG_TABS[i].name; return String(id || ''); }
  function engUsd(v){ if (v == null || !isFinite(v)) return '—'; var a = Math.abs(Math.round(v)); return (v < 0 ? '−' : v > 0 ? '+' : '') + '$' + a.toLocaleString('en-US'); }
  function engRate(v){ return v == null || !isFinite(v) ? '—' : Math.round(v * 100) + '%'; }
  function engRange(r){ return r && isFinite(r.lo) && isFinite(r.hi) ? Math.round(r.lo * 100) + ' to ' + Math.round(r.hi * 100) + '%' : ''; }
  function engPnl(v, d){ return v == null || !isFinite(v) ? '—' : '<span class="' + slpSign(v) + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%</span>'; }
  function engMoney(v){ var n = Number(v); return v == null || !isFinite(n) ? '—' : '$' + n.toFixed(2); }
  function engStrike(v){ var n = Number(v); if (v == null || !isFinite(n)) return '$?'; if (Math.round(n) === n) return '$' + n; var s = n.toFixed(2); while (s.charAt(s.length - 1) === '0') s = s.slice(0, -1); return '$' + s; }
  function engExp(sec){ var n = Number(sec); if (!(n > 0)) return '?'; var d = new Date(n * 1000); return ENG_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function engContract(t){ var c = (t && t.contract) || {}; return engStrike(c.strike) + ' ' + escapeHtml(String(c.optionType || (t && t.side) || '')) + ' · ' + engExp(c.expiry); }
  function engDay(iso){ return evbDate(String(iso || '').slice(0, 10)); }
  function engCell(k){ return ENG_CELL[k] || String(k || '—'); }
  function engCap(s){ s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
  function engSide(s){ return s === 'put' ? '<span class="eng-side eng-put">Put</span>' : '<span class="eng-side eng-call">Call</span>'; }
  function engPill(text, cls){ return '<span class="evb-pill ' + (cls || 'evb-s-unclear') + '">' + escapeHtml(text) + '</span>'; }
  function engSetup(e, key){ var list = (e && e.setups) || []; for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label; return String(key || ''); }
  function engFind(d, id){ var list = (d && d.engines) || []; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function engExitLabel(d, k){ var L = (d && d.closeLabels) || {}; return engCap(L[k] || k); }
  function engDetails(title, body, open){ return '<details class="rgl-details eng-details"' + (open ? ' open' : '') + '><summary>' + escapeHtml(title) + '</summary>' + body + '</details>'; }

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

  function engSplitTable(rows, first, nameFn){
    if (!rows || !rows.length) return '<p class="hint">No closed trades in this split yet.</p>';
    return slpTable([[first], ['Trades', 1], ['Win rate', 1], ['Average', 1, 'Average result per trade, % of the entry premium'], ['Median', 1], ['One contract each', 1, 'Dollars made or lost buying one contract per trade'], ['Profit factor', 1, 'Gains divided by losses; above 1 means the wins outweigh the losses']], rows.map(function(r){
      return '<tr><td>' + escapeHtml(nameFn ? nameFn(r) : String(r.label || r.key)) + (r.from && r.to ? '<div class="crd-dim">' + escapeHtml(engDay(r.from)) + ' to ' + escapeHtml(engDay(r.to)) + '</div>' : '') + '</td><td class="num">' + (r.n || 0) + '</td><td class="num">' + engRate(r.winRate) + '</td><td class="num">' + engPnl(r.avg) + '</td><td class="num">' + engPnl(r.median) + '</td><td class="num ' + slpSign(r.usd) + '">' + engUsd(r.usd) + '</td><td class="num">' + slpNum(r.profitFactor, 2) + '</td></tr>';
    }).join(''));
  }
  function engEnvTables(byEnv){
    if (!byEnv) return '';
    return ENG_ENV.map(function(k){ var rows = byEnv[k[0]]; return rows && rows.length ? '<h4 class="slp-h4">' + k[1] + '</h4>' + engSplitTable(rows, k[1], function(r){ return engCap(r.key); }) : ''; }).join('');
  }
  function engCurveHtml(curve, aria){
    if (!curve || curve.length < 3) return '';
    return lineSvgHtml({ labels: curve.map(function(p){ return engDay(p[0]); }), series: [{ name: 'Running total, one contract per trade', values: curve.map(function(p){ return p[1]; }), cls: 'ln-s0' }], h: 220, zero: true, yFmt: function(v){ return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'); }, ariaLabel: aria });
  }
  function engStatKpis(s, extra){
    s = s || {};
    var list = [
      ['Closed trades', String(s.n || 0), (s.wins || 0) + ' wins, ' + (s.losses || 0) + ' losses' + (s.flat ? ', ' + s.flat + ' flat' : '')],
      ['Win rate', engRate(s.winRate) + (engRange(s.winRange) ? '<small class="eng-kpi-sub">' + engRange(s.winRange) + '</small>' : ''), 'The range is where the true win rate plausibly sits given how few trades there are (Wilson 95%)'],
      ['Average trade', engPnl(s.avg), 'Average result per trade, % of the entry premium'],
      ['Median trade', engPnl(s.median)],
      ['Avg win / loss', (s.avgWin == null ? '—' : '+' + slpNum(s.avgWin, 1) + '%') + ' / ' + (s.avgLoss == null ? '—' : slpNum(s.avgLoss, 1) + '%')],
      ['Profit factor', slpNum(s.profitFactor, 2), 'Gains divided by losses; above 1 means the wins outweigh the losses'],
      ['One contract each', '<span class="' + slpSign(s.usd) + '">' + engUsd(s.usd) + '</span>', 'Dollars made or lost buying one contract per closed trade'],
    ];
    return slpKpis(list.concat(extra || []));
  }

  // ---- One engine -----------------------------------------------------------
  function engRulesHtml(e){
    var c = e.contract || {}, x = e.exits || {};
    var who = e.universe === 'etfs' ? 'Index, bond, gold and Asia funds only' : e.universe === 'stocks' ? 'Single stocks only (no funds)' : 'Every covered name';
    return '<ul class="eng-rules">' +
      '<li><b>Universe.</b> ' + who + '.</li>' +
      '<li><b>What it buys.</b> One single call or put, about ' + slpNum(c.delta, 2) + ' delta, ' + c.dteMin + ' to ' + c.dteMax + ' days to expiry (ideal ' + c.dteIdeal + '). Never a spread.</li>' +
      '<li><b>Exits.</b> +' + x.tp + '% take-profit, ' + x.stop + '% stop, ' + x.maxSessions + ' sessions at most' + (x.trailArm != null ? ', and a trailing stop once the trade is up ' + x.trailArm + '%' : '') + '. Some setups carry their own exits (see Setups and learning). Every trade closes two sessions before its contract expires.</li>' +
      '<li><b>Size.</b> Up to ' + e.slots + ' open trades and ' + e.perRun + ' new per run, one contract each.</li>' +
      '<li><b>Entry bar.</b> ' + (e.bar ? e.bar.now + ' of 100 on its own score (starts at ' + e.bar.base + '; its learning rules may move it between ' + e.bar.min + ' and ' + e.bar.max + ')' : '—') + '.</li>' +
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
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol) + '</b> ' + engSide(t.side) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>' + engSharedHtml(t); }, sort: function(t){ return t.symbol; } },
      { label: 'Setup', cell: function(t){ return escapeHtml(engSetup(e, t.setup)) + '<div class="crd-dim">score ' + slpNum(t.score, 0) + '</div>'; }, sort: function(t){ return t.setup; } },
      { label: 'Contract', cell: function(t){ return engContract(t); }, sort: function(t){ return t.contract && t.contract.expiry; } },
      { label: 'Opened', cell: function(t){ return escapeHtml(rglEt(t.entryDate)) + '<div class="crd-dim">at ' + engMoney(t.contract && t.contract.mid) + '</div>'; }, sort: function(t){ return Date.parse(t.entryDate) || 0; } },
      { label: 'Last mark', num: true, cell: function(t){ return engMoney(t.lastMid); }, sort: function(t){ return t.lastMid; } },
      { label: 'Result', num: true, cell: function(t){ return engPnl(t.optionPnlPct) + '<div class="crd-dim">best ' + slpPts(t.hiPct, 0) + '%, worst ' + slpPts(t.loPct, 0) + '%</div>'; }, sort: function(t){ return t.optionPnlPct; } },
      { label: 'Sessions', num: true, cell: function(t){ return String(t.sessions || 0) + (t.exits && t.exits.maxSessions ? '<span class="crd-dim"> of ' + t.exits.maxSessions + '</span>' : ''); }, sort: function(t){ return t.sessions || 0; } },
      { label: 'Exit plan', cell: function(t){ var x = t.exits || {}; return '+' + x.tp + '% / ' + x.stop + '%' + (t.exitBy ? '<div class="crd-dim">out by ' + escapeHtml(engDay(t.exitBy)) + '</div>' : '') + (t.stopLevel != null ? '<div class="crd-dim">stock stop ' + engMoney(t.stopLevel) + '</div>' : '') + (t.targetLevel != null ? '<div class="crd-dim">stock target ' + engMoney(t.targetLevel) + '</div>' : ''); }, nosort: true },
    ];
    return VIEWS.tableHtml(cols, e.open || [], { key: 'eng-open-' + e.id, empty: 'No open trades. New ones open at the 11:00 and 15:30 ET runs when a setup clears the bar.' });
  }
  function engCandTable(e){
    var rows = e.candidates || [];
    if (!rows.length) return '<p class="hint">No setup scored near the bar at the latest run.</p>';
    return slpTable([['Stock'], ['Setup'], ['Score', 1], ['Why it scored', 'l'], ['What happened', 'l']], rows.map(function(c){
      var res = c.taken ? '<b class="sig-pos">Opened</b> ' + escapeHtml(c.tradeId || '') + (c.note ? '<div class="crd-dim">' + escapeHtml(c.note) + '</div>' : '') : escapeHtml(engCap(c.why || 'not taken'));
      return '<tr><td><b>' + escapeHtml(c.symbol) + '</b> ' + engSide(c.side) + '</td><td>' + escapeHtml(engSetup(e, c.setup)) + '</td><td class="num">' + slpNum(c.score, 0) + '</td><td class="l">' + escapeHtml((c.reasons || []).join('; ')) + '</td><td class="l">' + res + '</td></tr>';
    }).join(''));
  }
  function engNowHtml(e, d){
    var s = e.stats || {};
    var kpis = slpKpis([
      ['Open trades', (e.open || []).length + ' of ' + e.slots],
      ['Open result', '<span class="' + slpSign(s.openUsd) + '">' + engUsd(s.openUsd) + '</span>', 'Unrealized, one contract per open trade, on the latest marks'],
      ['Closed trades', String(e.closedTotal || s.n || 0)],
      ['Win rate', engRate(s.winRate) + (engRange(s.winRange) ? '<small class="eng-kpi-sub">' + engRange(s.winRange) + '</small>' : '')],
      ['Average trade', engPnl(s.avg)],
      ['Entry bar', e.bar ? String(e.bar.now) : '—', 'Its own 0 to 100 score a setup must reach'],
      ['Rules version', escapeHtml(e.rulesVersion || '—'), 'Goes up by one every time the engine changes itself; stamped on each new trade'],
    ]);
    return '<p class="evb-lead">' + escapeHtml(e.idea || '') + '</p>' +
      '<div class="eng-reads"><span class="eng-reads-lbl">Reads</span>' + (e.reads || []).map(function(r){ return '<span class="eng-chip">' + escapeHtml(r) + '</span>'; }).join('') + '</div>' +
      kpis +
      slpSection('eng-open', 'Open trades', engOpenTable(e, d)) +
      slpSection('eng-cands', 'Latest run: what it looked at', '<p class="evb-note">Every setup that scored near the bar at the ' + escapeHtml(rglEt(d.runIso)) + ' run, and why each was or was not opened. A setup held back by a learning rule or a size limit is tracked as a shadow trade so its cost shows.</p>' + engCandTable(e)) +
      slpSection('eng-rules', 'The rules', engRulesHtml(e));
  }
  function engClosedTable(e, d){
    var cols = [
      { label: 'Closed', cell: function(t){ return escapeHtml(engDay(t.exitDate)); }, sort: function(t){ return Date.parse(t.exitDate) || 0; } },
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol) + '</b> ' + engSide(t.side) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>' + engSharedHtml(t); }, sort: function(t){ return t.symbol; } },
      { label: 'Setup', cell: function(t){ return escapeHtml(engSetup(e, t.setup)) + '<div class="crd-dim">score ' + slpNum(t.score, 0) + '</div>'; }, sort: function(t){ return t.setup; } },
      { label: 'Contract', cell: function(t){ return engContract(t); }, sort: function(t){ return t.contract && t.contract.expiry; } },
      { label: 'In / out', num: true, cell: function(t){ return engMoney(t.contract && t.contract.mid) + ' → ' + engMoney(t.exitMid); }, nosort: true },
      { label: 'Result', num: true, cell: function(t){ return t.outcome === 'void' ? '<span class="crd-dim">not counted</span>' : engPnl(t.optionPnlPct); }, sort: function(t){ return t.optionPnlPct; } },
      { label: 'Sessions', num: true, cell: function(t){ return String(t.sessions || 0); }, sort: function(t){ return t.sessions || 0; } },
      { label: 'Why it closed', cell: function(t){ return escapeHtml(engCap(t.statusLabel || t.status)); }, sort: function(t){ return t.status; } },
      { label: 'Market type', cell: function(t){ return escapeHtml(t.regime && t.regime.cell ? engCell(t.regime.cell) : '—'); }, sort: function(t){ return t.regime && t.regime.cell; } },
      { label: 'Rules', cell: function(t){ return escapeHtml(t.rulesVersion || '—'); }, sort: function(t){ return t.rulesVersion; } },
    ];
    return VIEWS.tableHtml(cols, e.closed || [], { key: 'eng-closed-' + e.id, tall: true, empty: 'No closed trades yet.' });
  }
  function engRecordHtml(e, d){
    var s = e.stats || {};
    var arch = s.archived && s.archived.n ? '<p class="evb-note">' + s.archived.n + ' older trades are folded into totals (' + s.archived.wins + ' wins, ' + s.archived.losses + ' losses, ' + engUsd(s.archived.sumUsd) + ' on one contract each) and are not in the tables below.</p>' : '';
    var more = (e.closedTotal || 0) > (e.closed || []).length ? '<p class="evb-note">Showing the newest ' + (e.closed || []).length + ' of ' + e.closedTotal + ' closed trades. The Export menu has the full record.</p>' : '';
    return '<p class="evb-lead">This record belongs to ' + escapeHtml(e.name) + ' only. It is kept apart from the Top Picks Track Record and from every other engine. Results are modeled from option marks at each run, like the Top Picks record; the Webull paper tab shows what the paper account actually filled.</p>' +
      engStatKpis(s, [['Largest drop', s.maxDrawdownUsd ? '−$' + Number(s.maxDrawdownUsd).toLocaleString('en-US') : '—', 'Largest fall from a peak of the running total']]) +
      engCurveHtml(s.curve, e.name + ' running total in dollars') +
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
  function engLearnHtml(e, d){
    var setups = slpTable([['Setup'], ['How it triggers', 'l'], ['State'], ['Real trades', 1], ['Real average', 1], ['Shadow trades', 1], ['Shadow average', 1]], (e.setups || []).map(function(s){
      var st = ENG_STATE[s.state] || ENG_STATE.trading;
      var x = s.exits ? '<div class="crd-dim">Own exits: +' + s.exits.tp + '% / ' + s.exits.stop + '%, ' + s.exits.maxSessions + ' sessions</div>' : '';
      return '<tr><td><b>' + escapeHtml(s.label) + '</b>' + (s.startsOnShadow ? '<div class="crd-dim">Started on shadow</div>' : '') + '</td><td class="l">' + escapeHtml(s.how || '') + x + '</td><td>' + engPill(st[0], st[1]) + (s.since ? '<div class="crd-dim">since ' + escapeHtml(engDay(s.since)) + '</div>' : '') + '</td><td class="num">' + ((s.real && s.real.n) || 0) + '</td><td class="num">' + engPnl(s.real && s.real.avg) + '</td><td class="num">' + ((s.shadow && s.shadow.n) || 0) + '</td><td class="num">' + engPnl(s.shadow && s.shadow.avg) + '</td></tr>';
    }).join(''));
    var log = (e.learning && e.learning.log) || [];
    var logHtml = log.length ? slpTable([['Date'], ['Rules version'], ['What changed', 'l']], log.map(function(c){ return '<tr><td>' + escapeHtml(engDay(c.date)) + '</td><td>' + escapeHtml(c.v || '') + '</td><td class="l">' + escapeHtml(c.text || '') + '</td></tr>'; }).join('')) : '<p class="hint">No changes yet. The engine is on its starting rules.</p>';
    var sh = e.shadow || {}, ss = sh.stats || {};
    var shOpen = (sh.open || []).length ? slpTable([['Stock'], ['Setup'], ['Contract', 'l'], ['Tracked since'], ['Result so far', 1], ['Why it is a shadow', 'l']], sh.open.map(function(t){ return '<tr><td><b>' + escapeHtml(t.symbol) + '</b> ' + engSide(t.side) + '</td><td>' + escapeHtml(engSetup(e, t.setup)) + '</td><td class="l">' + engContract(t) + '</td><td>' + escapeHtml(engDay(t.entryDate)) + '</td><td class="num">' + engPnl(t.optionPnlPct) + '</td><td class="l">' + escapeHtml(engCap(t.why || '')) + '</td></tr>'; }).join('')) : '<p class="hint">No open shadow trades.</p>';
    var shClosed = (sh.closed || []).length ? slpTable([['Closed'], ['Stock'], ['Setup'], ['Result', 1], ['Why it closed', 'l'], ['Why it was a shadow', 'l']], sh.closed.map(function(t){ return '<tr><td>' + escapeHtml(engDay(t.exitDate)) + '</td><td><b>' + escapeHtml(t.symbol) + '</b> ' + engSide(t.side) + '</td><td>' + escapeHtml(engSetup(e, t.setup)) + '</td><td class="num">' + engPnl(t.optionPnlPct) + '</td><td class="l">' + escapeHtml(engExitLabel(d, t.status)) + '</td><td class="l">' + escapeHtml(engCap(t.shadowWhy || '')) + '</td></tr>'; }).join('')) : '';
    return '<p class="evb-lead">' + escapeHtml(e.name) + ' checks its own results and tightens itself, inside fixed limits and with no AI. It can pause after a losing streak, mute a setup whose whole record is clearly losing, stand down in a market type that keeps losing, and move its entry bar between ' + (e.bar ? e.bar.min + ' and ' + e.bar.max : 'its limits') + '. Each of those needs a result unlikely to be luck. A muted setup keeps running as shadow trades and comes back when 40 or more of them clearly win. Learning can only restrict the engine: it never adds size, slots, setups or data, and never touches Top Picks.</p>' +
      slpKpis([
        ['Entry bar now', e.bar ? String(e.bar.now) : '—', e.bar ? 'Started at ' + e.bar.base + '; limits ' + e.bar.min + ' to ' + e.bar.max : ''],
        ['Rules version', escapeHtml(e.rulesVersion || '—')],
        ['Changes made', String(log.length)],
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
      ['Beat random', c ? c.beat + '% of books' : '—', 'Share of the random books this engine did better than'],
    ]);
  }
  function engHistoryHtml(e, d){
    var H = e.history, R = d.research;
    var notes = R && R.notes && R.notes.length ? '<ul class="eng-notes">' + R.notes.map(function(n){ return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>' : '';
    var replay = e.replay && (e.replay.raw || e.replay.held) ? (function(){
      var rows = [['Every setup', e.replay.raw], ['Shadow-start setups held back', e.replay.held]].filter(function(r){ return r[1]; });
      return slpSection('eng-replay', 'Recent replay', '<p class="evb-note">The same rule code replayed over the bars the build holds' + (d.replay && d.replay.from ? ' (' + escapeHtml(engDay(d.replay.from)) + ' to ' + escapeHtml(engDay(d.replay.to)) + ')' : '') + ', with real report dates, modeled option prices and costs. Refreshed once a day. It is a short window, so read it as a check that the rules still behave, not as a forecast.</p>' +
        slpTable([['Version'], ['Trades', 1], ['Win rate', 1], ['Average', 1], ['Median', 1], ['One contract each', 1], ['Random entries', 1], ['Beat random', 1]], rows.map(function(r){ var x = r[1], c = x.control; return '<tr><td>' + r[0] + '</td><td class="num">' + (x.n || 0) + '</td><td class="num">' + engRate(x.winRate) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num">' + engPnl(x.median) + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num">' + (c ? engPnl(c.avg) : '—') + '</td><td class="num">' + (c ? c.beat + '%' : '—') + '</td></tr>'; }).join('')) +
        (e.replay.held && e.replay.held.bySetup && e.replay.held.bySetup.length ? engDetails('By setup (shadow-start setups held back)', engSplitTable(e.replay.held.bySetup, 'Setup', function(r){ return engSetup(e, r.key); })) : ''));
    })() : (d.replay && (d.replay.error || d.replay.skipped) ? '<p class="evb-note">The recent replay did not run at the last build' + (d.replay.skipped ? ' (' + escapeHtml(d.replay.skipped) + ')' : '') + '.</p>' : '');
    var has = H && (H.live || H.held || H.raw);
    if (!has){
      var why = e.test === 'forward' ? 'This engine reads option flow, short interest and borrow, which have no stored history. It cannot be replayed on old data, so it is judged forward only: its paper record and its shadow trades are the test.' : e.test === 'replay' ? 'This engine needs each company’s report dates and EPS, which live in the private store, so it is not in the long history test. Every build replays it over the bars it holds instead.' : 'No long history test is on file for this engine yet.';
      return '<p class="evb-lead">' + why + '</p>' + replay + (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
    }
    var sel = H[engState.hist] ? engState.hist : (H.live ? 'live' : H.held ? 'held' : 'raw');
    var h = H[sel];
    var pick = '<div class="eng-seg" role="group" aria-label="History test version">' + ENG_HIST.filter(function(o){ return H[o[0]]; }).map(function(o){ return '<button type="button" class="eng-seg-btn' + (o[0] === sel ? ' is-on' : '') + '" data-eng-hist="' + o[0] + '" title="' + escapeHtml(o[2]) + '">' + escapeHtml(o[1]) + '</button>'; }).join('') + '</div>';
    var what = ENG_HIST.filter(function(o){ return o[0] === sel; })[0];
    var cmp = slpTable([['Version'], ['Trades', 1], ['Win rate', 1], ['Average', 1], ['One contract each', 1], ['Random entries', 1], ['Beat random', 1]], ENG_HIST.filter(function(o){ return H[o[0]]; }).map(function(o){ var x = H[o[0]], c = x.control; return '<tr><td>' + escapeHtml(o[1]) + '</td><td class="num">' + (x.n || 0) + '</td><td class="num">' + engRate(x.winRate) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num ' + slpSign(x.usd) + '">' + engUsd(x.usd) + '</td><td class="num">' + (c ? engPnl(c.avg) : '—') + '</td><td class="num">' + (c ? c.beat + '%' : '—') + '</td></tr>'; }).join(''));
    return '<p class="evb-lead">The engine’s rules replayed day by day over ' + (R && R.data ? escapeHtml(engDay(R.data.from)) + ' to ' + escapeHtml(engDay(R.data.to)) + ' (' + R.data.names + ' names)' : 'the long history') + ', with modeled option prices and 3.5% of premium taken as costs on every round trip. It answers how the idea behaved in different markets. It is not a forecast, and nothing here shows a reliable profit after costs.</p>' +
      slpSection('eng-hist-cmp', 'Three versions of the same test', cmp) +
      pick + '<p class="evb-note">' + escapeHtml(what ? what[2] : '') + (h.changes ? ' The learning rules made ' + h.changes + ' changes over the test and ended on version ' + escapeHtml(h.rulesVersion || '') + ' with the bar at ' + h.bar + '.' : '') + '</p>' +
      engHistKpis(h) +
      engCurveHtml(h.curve, e.name + ' history test running total in dollars') +
      slpSection('eng-hist-windows', 'By time period', engSplitTable(h.byWindow, 'Period')) +
      slpSection('eng-hist-cells', 'By market type', '<p class="evb-note">The Regime Lab label on the day each trade opened: the trend of the market and whether volatility was calm or stressed.</p>' + engSplitTable(h.byCell, 'Market type', function(r){ return engCell(r.key); })) +
      slpSection('eng-hist-env', 'By macro environment', '<p class="evb-note">What the economy looked like when each trade opened, using only numbers that were public that day.</p>' + (engEnvTables(h.byEnv) || '<p class="hint">No macro labels in this run.</p>')) +
      slpSection('eng-hist-more', 'More cuts',
        engDetails('By setup', engSplitTable(h.bySetup, 'Setup', function(r){ return engSetup(e, r.key); }), true) +
        engDetails('By score', engSplitTable(h.byScore, 'Score band')) +
        engDetails('By side', engSplitTable(h.bySide, 'Side', function(r){ return engCap(r.key); })) +
        engDetails('By exit', engSplitTable(h.byExit, 'Why it closed', function(r){ return engExitLabel(d, r.key); })) +
        engDetails('By year', engSplitTable(h.byYear, 'Year')) +
        (h.log && h.log.length ? engDetails('Changes the learning rules made (newest)', slpTable([['Date'], ['Rules version'], ['What changed', 'l']], h.log.map(function(c){ return '<tr><td>' + escapeHtml(engDay(c.date)) + '</td><td>' + escapeHtml(c.v || '') + '</td><td class="l">' + escapeHtml(c.text || '') + '</td></tr>'; }).join(''))) : '')) +
      replay +
      (notes ? slpSection('eng-hist-notes', 'What the test cannot see', notes) : '');
  }

  // ---- Webull paper (shared account, engine trades) --------------------------
  function engLoadMirror(force){
    if (engState.mirrorLoading) return;
    if (!force && engState.mirror && Date.now() - engState.mirrorAt < 5 * 60 * 1000) return;
    if (!force && engState.mirrorError && Date.now() - engState.mirrorAt < 60 * 1000) return;
    if (!HAS_OWNER_ACCESS) return;
    engState.mirrorLoading = true; engState.mirrorError = null;
    quantFetchJson('/api/auth/webull-mirror?scope=engines').then(function(j){
      engState.mirror = j && typeof j === 'object' ? j : null; engState.mirrorAt = Date.now(); engState.mirrorLoading = false; renderEngines();
    }).catch(function(err){
      engState.mirrorLoading = false; engState.mirrorAt = Date.now();
      engState.mirrorError = err && err.status === 404 ? 'not available here' : String((err && err.message) || err || 'failed');
      renderEngines();
    });
  }
  function engMirrorRows(m, id){ return ((m && m.trades) || []).filter(function(t){ return id === 'all' ? !!t.engine : t.engine === id; }); }
  function engMirrorTable(rows, withEngine){
    var cols = [
      { label: 'Trade', cell: function(t){ return '<b>' + escapeHtml(t.symbol || '') + '</b> ' + engSide(t.side) + '<div class="crd-dim eng-id">' + escapeHtml(t.tradeId || '') + '</div>'; }, sort: function(t){ return t.tradeId; } },
      { label: 'State', cell: function(t){ return escapeHtml(ENG_MIRROR_STATE[t.state] || engCap(t.state)) + (t.needsReview ? ' ' + engPill('Needs review', 'evb-s-fail') : ''); }, sort: function(t){ return t.state; } },
      { label: 'Contract', cell: function(t){ return escapeHtml(t.legs || ''); }, nosort: true },
      { label: 'Engine price', num: true, cell: function(t){ return engMoney(t.engineEntryPrice); }, sort: function(t){ return t.engineEntryPrice; } },
      { label: 'Paper fill', num: true, cell: function(t){ return t.fillPrice == null ? '—' : engMoney(t.fillPrice) + (t.entryDiffPct != null ? '<div class="crd-dim">' + slpPts(t.entryDiffPct, 1) + '% vs engine</div>' : ''); }, sort: function(t){ return t.fillPrice; } },
      { label: 'Engine exit', num: true, cell: function(t){ return engMoney(t.engineExitPrice); }, sort: function(t){ return t.engineExitPrice; } },
      { label: 'Paper exit', num: true, cell: function(t){ return t.closeFillPrice == null ? '—' : engMoney(t.closeFillPrice) + (t.exitDiffPct != null ? '<div class="crd-dim">' + slpPts(t.exitDiffPct, 1) + '% vs engine</div>' : ''); }, sort: function(t){ return t.closeFillPrice; } },
      { label: 'Paper result', num: true, cell: function(t){ return engPnl(t.paperPnlPct) + (t.enginePnlPct != null ? '<div class="crd-dim">engine ' + slpPts(t.enginePnlPct, 1) + '%</div>' : ''); }, sort: function(t){ return t.paperPnlPct; } },
      { label: 'Notes', cell: function(t){ var sc = t.sharedContract; return (sc ? '<div class="eng-shared">Held by ' + escapeHtml(engName(sc.heldBy || 'flagship')) + (sc.heldById ? ' (' + escapeHtml(sc.heldById) + ')' : '') + '</div>' : '') + ((t.sharedWith || []).length ? '<div class="eng-shared eng-shared-holder">Also on: ' + t.sharedWith.map(function(x){ return escapeHtml(engName(x.source || 'flagship')) + (x.tradeId ? ' (' + escapeHtml(x.tradeId) + ')' : ''); }).join(', ') + '</div>' : '') + (t.note ? '<div class="crd-dim">' + escapeHtml(t.note) + '</div>' : ''); }, nosort: true },
    ];
    if (withEngine) cols.splice(1, 0, { label: 'Engine', cell: function(t){ return escapeHtml(engName(t.engine)); }, sort: function(t){ return t.engine; } });
    return VIEWS.tableHtml(cols, rows, { key: 'eng-mirror' + (withEngine ? '-all' : ''), empty: 'No engine trades in the paper account yet. The mirror runs right after each 11:00 and 15:30 ET build.' });
  }
  function engMirrorHtml(id){
    var m = engState.mirror;
    var lead = '<p class="evb-lead">Every engine trades in the same Webull paper account as Top Picks, one contract per trade, and each order carries its engine’s trade ID, so the fills stay on that engine’s record. When two engines want the exact same contract it is bought once: the first holder owns the paper position and the other records the trade on paper marks, labeled with who holds it.</p>';
    if (!m){
      if (engState.mirrorLoading || (!engState.mirrorError && HAS_OWNER_ACCESS)) return lead + '<p class="hint">Loading the paper account…</p>';
      return lead + '<p class="hint">The paper account could not be read (' + escapeHtml(engState.mirrorError || 'not signed in') + '). It is only available on the live site with the Owner session. <button type="button" class="eng-link" data-eng-mirror-retry>Try again</button></p>';
    }
    var rows = engMirrorRows(m, id), h = (m.health && m.health.engines) || null;
    var filled = rows.filter(function(t){ return t.fillPrice != null; }), done = rows.filter(function(t){ return t.paperPnlPct != null; });
    var gaps = filled.map(function(t){ return Number(t.entryDiffPct); }).filter(function(v){ return isFinite(v); });
    var avgGap = gaps.length ? gaps.reduce(function(a, b){ return a + b; }, 0) / gaps.length : null;
    var avgPaper = done.length ? done.reduce(function(a, t){ return a + Number(t.paperPnlPct); }, 0) / done.length : null;
    var state = !m.enabled ? engPill('Mirror off', 'evb-s-fail') : m.enginesMirror === false ? engPill('Engine trades not being added (ENGINES_MIRROR is off)', 'evb-s-collect') : engPill('Mirror on', 'evb-s-pass');
    var issues = ((m.health && m.health.issues) || []).filter(function(i){ return id === 'all' || /ENGINE|MIRROR|RECONCIL|ORDER|LOCK/.test(i.code || ''); });
    return lead + '<p class="eng-status-line">' + state + ' <span class="crd-dim">Last mirror run ' + escapeHtml(rglEt(m.lastRunIso)) + '.</span></p>' +
      slpKpis([
        ['Orders tracked', String(rows.length)],
        ['Filled', String(filled.length)],
        ['Missed', String(rows.filter(function(t){ return t.state === 'missed'; }).length), 'The entry order did not fill inside the allowed price range'],
        ['Not bought (shared)', String(rows.filter(function(t){ return t.state === 'skipped'; }).length), 'The same contract was already held by another engine'],
        ['Avg entry gap', avgGap == null ? '—' : slpPts(avgGap, 1) + '%', 'Paper fill against the engine’s entry price'],
        ['Avg paper result', engPnl(avgPaper), 'Closed paper trades only'],
      ]) +
      (id === 'all' && h ? '<p class="evb-note">Open engine trades: ' + h.open + '. In the paper account: ' + h.mirrored + '. Shared with another holder: ' + h.shared + '. Entry not filled: ' + h.unfilled + '. Waiting on an order: ' + h.pending + '. No mirror record yet: ' + h.untracked + '.</p>' : '') +
      (issues.length ? '<ul class="eng-notes">' + issues.map(function(i){ return '<li>' + escapeHtml(i.message || i.code) + '</li>'; }).join('') + '</ul>' : '') +
      engMirrorTable(rows, id === 'all') +
      '<p class="evb-note">Downloads (every engine): <a href="/api/auth/webull-mirror?format=csv&amp;scope=engines">fills CSV</a> · <a href="/api/auth/webull-mirror?format=orders&amp;scope=engines">every order attempt CSV</a>. The Top Picks fills stay on the Track Record’s Real fills tab.</p>';
  }

  // ---- All engines ----------------------------------------------------------
  function engAllHtml(d){
    var f = d.flagshipStats;
    var rows = (d.compare || []).map(function(c){
      var st = d.mode === 'off' ? engPill('Off', 'evb-s-fail') : c.switchedOff ? engPill('Switched off', 'evb-s-fail') : (d.mode === 'pause' || c.paused) ? engPill('Paused', 'evb-s-collect') : engPill('Trading', 'evb-s-pass');
      return '<tr><td><button type="button" class="eng-link" data-eng-go="' + escapeHtml(c.id) + '"><b>' + escapeHtml(c.name) + '</b></button><div class="crd-dim">' + escapeHtml(c.tag) + ' · rules ' + escapeHtml(c.rulesVersion || '') + '</div></td><td>' + st + '</td><td class="num">' + c.open + ' of ' + c.slots + '</td><td class="num">' + (c.n || 0) + '</td><td class="num">' + engRate(c.winRate) + (engRange(c.winRange) ? '<div class="crd-dim">' + engRange(c.winRange) + '</div>' : '') + '</td><td class="num">' + engPnl(c.avg) + '</td><td class="num ' + slpSign(c.usd) + '">' + engUsd(c.usd) + '</td><td class="num ' + slpSign(c.openUsd) + '">' + engUsd(c.openUsd) + '</td><td class="num">' + slpNum(c.profitFactor, 2) + '</td><td class="num">' + c.bar + '</td><td class="num">' + (c.shadowN || 0) + (c.shadowAvg != null ? '<div class="crd-dim">' + slpPts(c.shadowAvg, 1) + '%</div>' : '') + '</td></tr>';
    }).join('');
    var flag = '<tr class="eng-flag-row"><td><button type="button" class="eng-link" data-eng-go="flagship"><b>Top Picks</b></button><div class="crd-dim">Flagship · its own Track Record</div></td><td>' + engPill('Flagship', 'evb-s-ready') + '</td><td class="num">' + (f ? f.open : '—') + '</td><td class="num">' + (f ? f.n : '—') + '</td><td class="num">' + (f ? engRate(f.winRate) : '—') + '</td><td class="num">' + (f ? engPnl(f.avg) : '—') + '</td><td class="num crd-dim" colspan="5">See the <a href="?tab=track">Track Record</a> for the full flagship record.</td></tr>';
    var t = d.total || {};
    var total = '<tr class="eng-total-row"><td><b>All six engines</b></td><td></td><td class="num">' + (t.open || 0) + '</td><td class="num">' + (t.n || 0) + '</td><td class="num">' + engRate(t.winRate) + '</td><td class="num">' + engPnl(t.avg) + '</td><td class="num ' + slpSign(t.usd) + '">' + engUsd(t.usd) + '</td><td colspan="4"></td></tr>';
    var cmp = slpTable([['Engine'], ['Status'], ['Open', 1], ['Closed', 1], ['Win rate', 1], ['Average trade', 1], ['One contract each', 1, 'Dollars made or lost on closed trades, one contract per trade'], ['Open result', 1, 'Unrealized, on the latest marks'], ['Profit factor', 1], ['Entry bar', 1], ['Shadow trades', 1, 'Closed shadow trades and their average result']], flag + rows + total);

    var mk = d.market || {}, env = mk.env || {}, mac = mk.macro || {};
    var envChips = ENG_ENV.map(function(k){ return env[k[0]] ? '<span class="eng-chip"><b>' + k[1] + ':</b> ' + escapeHtml(String(env[k[0]])) + '</span>' : ''; }).join('');
    var backdrop = '<div class="eng-reads"><span class="eng-chip"><b>Market type:</b> ' + escapeHtml(mk.regime && mk.regime.cell ? engCell(mk.regime.cell) : 'not labeled') + '</span>' + (mk.macroState ? '<span class="eng-chip"><b>Market tape:</b> ' + escapeHtml(engCap(mk.macroState)) + '</span>' : '') + envChips + (mk.macroEvent ? '<span class="eng-chip"><b>Last session:</b> ' + escapeHtml(String(mk.macroEvent).split('+').map(function(k){ return ENG_EVENT[k] || k; }).join(' and ')) + '</span>' : '') + '</div>' +
      '<p class="evb-note">10-year yield ' + slpNum(mac.y10, 2) + '% (' + slpPts(mac.y10Chg, 2) + ' in a month) · financial conditions ' + slpNum(mac.nfci, 2) + ' (' + slpPts(mac.nfciChg, 2) + ' in four weeks) · dollar ' + slpPts(mac.usdChgPct, 1) + '% in a month · VIX ' + slpNum(mac.vix, 1) + ' (' + slpNum(mac.vixRatio, 2) + 'x the 3-month) · CPI ' + slpNum(mac.cpiYoy, 1) + '% on the year. Each number is the latest one that was public at the run.</p>';

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

    var runs = (d.runs || []).length ? slpTable([['Run'], ['Opened', 1], ['Closed', 1], ['Shadow started', 1], ['Shadow finished', 1], ['Rule changes', 1], ['Names read', 1], ['Errors', 'l']], d.runs.map(function(r){ return '<tr><td>' + escapeHtml(rglEt(r.iso)) + (r.mode && r.mode !== 'on' ? ' <span class="crd-dim">(' + escapeHtml(r.mode) + ')</span>' : '') + '</td><td class="num">' + (r.opened || 0) + '</td><td class="num">' + (r.closed || 0) + '</td><td class="num">' + (r.shadowOpened || 0) + '</td><td class="num">' + (r.shadowClosed || 0) + '</td><td class="num">' + (r.changes || 0) + '</td><td class="num">' + (r.views == null ? '—' : r.views) + '</td><td class="l">' + ((r.errors || []).length ? '<span class="sig-neg">' + r.errors.map(escapeHtml).join('; ') + '</span>' : '') + '</td></tr>'; }).join('')) : '<p class="hint">No run logged yet.</p>';

    var hl = d.health, health = '';
    if (hl){
      var miss = [];
      if ((hl.noChain || []).length) miss.push('no option chain this build: ' + hl.noChain.map(escapeHtml).join(', '));
      if ((hl.thinBars || []).length) miss.push('too little price history: ' + hl.thinBars.map(escapeHtml).join(', '));
      if ((hl.staleBars || []).length) miss.push('price history out of date: ' + hl.staleBars.map(escapeHtml).join(', '));
      health = '<p class="evb-note">Data check at the last run: ' + hl.views + ' of ' + hl.universe + ' names had everything the engines read.' + (miss.length ? ' Left out: ' + miss.join('; ') + '.' : '') + '</p>';
    }

    var R = d.research, hist = '';
    if (R){
      var hrows = (d.engines || []).map(function(e){
        var H = e.history || {};
        function cellOf(x){ return x ? '<td class="num">' + (x.n || 0) + '</td><td class="num">' + engPnl(x.avg) + '</td><td class="num">' + (x.control ? engPnl(x.control.avg) + '<div class="crd-dim">beat ' + x.control.beat + '%</div>' : '—') + '</td>' : '<td class="num crd-dim" colspan="3">not in the long test</td>'; }
        return '<tr><td><button type="button" class="eng-link" data-eng-go="' + escapeHtml(e.id) + '" data-eng-sub="history">' + escapeHtml(e.name) + '</button></td>' + cellOf(H.raw) + cellOf(H.live) + '</tr>';
      }).join('');
      hist = '<p class="evb-note">' + (R.data ? escapeHtml(engDay(R.data.from)) + ' to ' + escapeHtml(engDay(R.data.to)) + ', ' : '') + 'modeled option prices, 3.5% costs per round trip. "Random entries" is the average of books that bought the same kind of contract on random days. No engine shows a reliable profit after costs in this test; what it shows is whether an idea did better than random and in which markets. Open an engine for the cuts by period, market type and macro environment.</p>' +
        '<div class="acc-tscroll"><table class="acc-qtable evb-table slp-table" data-nosort><thead><tr><th rowspan="2">Engine</th><th colspan="3" class="num">Every setup, no learning</th><th colspan="3" class="num">As the engine runs</th></tr><tr><th class="num">Trades</th><th class="num">Average</th><th class="num">Random entries</th><th class="num">Trades</th><th class="num">Average</th><th class="num">Random entries</th></tr></thead><tbody>' + hrows + '</tbody></table></div>';
    }

    var mode = d.mode === 'off' ? engPill('Engines off', 'evb-s-fail') : d.mode === 'pause' ? engPill('Paused: open trades are still managed, nothing new opens', 'evb-s-collect') : engPill('Running', 'evb-s-pass');
    return '<p class="evb-lead">' + mode + ' Six rules-only engines trade on paper beside Top Picks. Each has its own idea, its own data, its own score and its own track record, and all of them share one Webull paper account. None of them uses AI, and none can change a Top Pick, a grade or the Top Picks Track Record. Paper tracking started ' + escapeHtml(engDay(d.startedIso || d.startDate)) + '.</p>' +
      slpSection('eng-all-cmp', 'Side by side', cmp + '<p class="evb-note">Engine results are % of the entry premium on one contract per trade, marked at each 11:00 and 15:30 ET run. With few trades the win-rate range is wide: judge an engine on dozens of closed trades, not a week.</p>') +
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
    var body = sub === 'record' ? engRecordHtml(e, d) : sub === 'learn' ? engLearnHtml(e, d) : sub === 'history' ? engHistoryHtml(e, d) : sub === 'webull' ? engMirrorHtml(e.id) : engNowHtml(e, d);
    return '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engine · ' + escapeHtml(e.tag) + '</span><h2 class="card-title">' + escapeHtml(e.name) + '</h2></div><span class="eng-head-pills">' + engStatusPills(e, d) + '</span></header>' + tabs + '<div class="ui-tab-panel eng-body">' + body + '</div>';
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
      else if (d && id === 'flagship' && d.flagshipStats) n = d.flagshipStats.open;
      counts[j].hidden = !(n > 0);
      counts[j].textContent = n > 0 ? String(n) : '';
      counts[j].title = n > 0 ? n + ' open' : '';
      total += n || 0;
    }
  }
  function renderEngines(){
    engSyncBar();
    var pane = $('eng-pane'), main = $('picks-section');
    if (!pane) return;
    var flagship = engState.sel === 'flagship';
    if (main) main.hidden = !flagship;
    pane.hidden = flagship;
    if (flagship) return;
    var d = engState.data;
    if (!d){
      var msg = engState.loading ? 'Loading the engines…' : engState.error === 'not written yet'
        ? 'The engines have not run yet. They act at every 11:00 and 15:30 ET Top Picks run on a trading day; the first one after this went live writes their first candidates, trades and record.'
        : 'The engines could not be loaded' + (engState.error ? ' (' + escapeHtml(engState.error) + ')' : '') + '.';
      pane.innerHTML = '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engines</span><h2 class="card-title">' + escapeHtml(engName(engState.sel)) + '</h2></div></header><p class="hint eng-empty">' + msg + (engState.loading ? '' : ' <button type="button" class="eng-link" data-eng-reload>Check again</button>') + '</p>';
      return;
    }
    var html;
    if (engState.sel === 'all') html = '<header class="card-header eng-head"><div class="picks-heading"><span class="picks-kicker">Paper engines</span><h2 class="card-title">All engines</h2><p class="picks-intro">Six strategies beside Top Picks, each on its own record.</p></div></header><div class="eng-body">' + engAllHtml(d) + '</div>';
    else { var e = engFind(d, engState.sel); html = e ? engOneHtml(d, e) : '<p class="hint eng-empty">This engine is not in the latest file.</p>'; }
    pane.innerHTML = html + '<p class="evb-note eng-foot">Paper only. Written by the ' + escapeHtml(rglEt(d.runIso)) + ' run' + (d.builtAtIso && d.builtAtIso !== d.runIso ? ', carried by the ' + escapeHtml(rglEt(d.builtAtIso)) + ' build' : '') + '. Engines version ' + escapeHtml(String(d.version || '')) + '. Research, not advice: an option can lose its whole premium.</p>';
    if (engState.sel === 'all' || engState.sub === 'webull') engLoadMirror(false);
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
      var op = $('page-pane-open-picks'); if (op && !op.hidden && typeof renderOpenPicks === 'function') renderOpenPicks();
    }).catch(function(err){
      engState.loading = false; engState.fetchedAt = Date.now();
      engState.error = err && err.status === 404 ? 'not written yet' : String((err && err.message) || err || 'failed');
      renderEngines();
    });
  }
  function engUrl(){
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== 'picks') return;
      if (engState.sel === 'flagship') url.searchParams.delete('engine'); else url.searchParams.set('engine', engState.sel);
      if (engState.sel === 'flagship' || engState.sel === 'all' || engState.sub === 'now') url.searchParams.delete('ev'); else url.searchParams.set('ev', engState.sub);
      var next = url.pathname + (url.search || '') + (url.hash || '');
      if (next !== window.location.pathname + window.location.search + window.location.hash) history.replaceState(null, '', next);
    } catch (_) {}
  }
  function engSelect(id, sub){
    if (!engValid(id)) id = 'flagship';
    engState.sel = id;
    if (sub && ENG_SUBS.some(function(s){ return s[0] === sub; })) engState.sub = sub;
    engUrl();
    if (id === 'flagship') renderEngines(); else loadEngines(false);
    if (id !== 'flagship'){ var sw = $('eng-switch'); if (sw && sw.getBoundingClientRect().top < 0 && sw.scrollIntoView) sw.scrollIntoView({ block: 'start' }); }
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
  // Called every time the Top Picks page opens (and on Back / Forward).
  function engOnPicksTab(){
    engBind();
    var want = 'flagship', sub = null;
    try { var q = new URLSearchParams(window.location.search); want = q.get('engine') || 'flagship'; sub = q.get('ev'); } catch (_) {}
    if (!engValid(want)) want = 'flagship';
    engState.sel = want;
    if (sub && ENG_SUBS.some(function(s){ return s[0] === sub; })) engState.sub = sub;
    if (HAS_OWNER_ACCESS) loadEngines(false); else renderEngines();
  }
`;
}

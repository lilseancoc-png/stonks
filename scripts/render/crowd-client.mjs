// Browser code for the public "Crowd & positioning" page (2026-11-09,
// lib/crowd/). Pasted into the app.js IIFE after views-next-client.mjs, so it
// may use the vn* helpers, VIEWS, lineSvgHtml, rowSparkHtml and dataUrl. ES5
// only, inside a template string: write regex escapes as \\d, no backticks.
//
// The page shows the facts in crowd.json: put/call ratios, Commitments of
// Traders, margin debt, leveraged-ETF flows, short sale volume and borrow fees,
// Reddit / Wikipedia / Stocktwits attention, Kalshi odds and the 24/7 stock
// perps. Numbers, ranks and percentiles only; no recommendation. The Owner
// join (crowd-owner.json) is rendered by regime-lab-client.mjs in the Owner Lab
// and never requested here.
export function renderCrowdJs() {
  return `
  // ---- Crowd & positioning (public) -----------------------------------------
  var CROWD_TABS = [['positioning', 'Positioning'], ['shorts', 'Short pressure'], ['attention', 'Attention'], ['odds', 'Odds markets'], ['perps', '24/7 prices']];
  var crowdState = { data: null, loading: false, error: null, fetchedAt: 0 };
  function crowdView(key, dflt){ return VIEWS.get('crowd.' + key, dflt); }
  function crowdSetView(key, v){ VIEWS.set('crowd.' + key, v); }
  function crowdUsd(v){
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(0) + 'K';
    return sign + '$' + a.toFixed(0);
  }
  function crowdInt(v){ return v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString(); }
  function crowdSigned(v, d){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    return '<span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '</span>';
  }
  function crowdZ(v){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    var cls = v >= 1.5 ? 'crd-z-hi' : v <= -1.5 ? 'crd-z-lo' : '';
    return '<span class="crd-z ' + cls + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(1) + 'σ</span>';
  }
  function crowdPctile(p){
    if (p == null || !isFinite(p)) return '';
    return '<span class="crd-pct" title="Percentile among the tracked names">' + Math.round(p) + 'th</span>';
  }
  function crowdSpark(hist, idx, fmt, aria){
    var pts = (hist || []).map(function(r){ return [r[0], r[idx == null ? 1 : idx]]; });
    return rowSparkHtml(pts, fmt, aria);
  }
  function crowdSourcePill(block){
    if (!block) return '<span class="crd-src crd-src-missing">not written</span>';
    if (block.ok && !block.stale) return '<span class="crd-src crd-src-ok">fresh</span>';
    if (block.carriedForward) return '<span class="crd-src crd-src-carried">carried forward</span>';
    return '<span class="crd-src crd-src-missing">no data</span>';
  }
  function crowdAsOf(block){
    if (!block) return '';
    var s = block.asOf ? (block.asOf.length === 10 ? vnDay(block.asOf) : block.asOf.length === 7 ? block.asOf : vnWhen(block.asOf)) : '';
    return s ? '<span class="crd-asof">as of ' + escapeHtml(s) + '</span>' : '';
  }
  function crowdHead(title, block, note){
    return '<div class="crd-head"><h3>' + escapeHtml(title) + '</h3>' + crowdSourcePill(block) + crowdAsOf(block) + (block && block.untested ? '<span class="crd-src crd-src-new" title="New source: the first live builds show whether it reads">first builds</span>' : '') + '</div>' +
      (block && block.error && !block.ok ? '<p class="crd-err">Last attempt: ' + escapeHtml(block.error) + '. The numbers below are the last good read.</p>' : '') +
      (note ? '<p class="crd-lede">' + escapeHtml(note) + '</p>' : '');
  }
  function crowdEmpty(text){ return '<p class="crd-empty">' + escapeHtml(text) + '</p>'; }

  // ---- Positioning tab ----
  function crowdPutCallHtml(d){
    var pc = d.putCall;
    var h = crowdHead('Cboe put/call ratios', pc, pc && pc.note);
    if (!pc || !pc.ratios) return h + crowdEmpty('No put/call read yet. The first daily build after this deploys writes it.');
    var st = pc.stats || {};
    var rows = [['total', 'Total'], ['equity', 'Equity (single stocks)'], ['index', 'Index'], ['etp', 'ETFs and ETPs'], ['vix', 'VIX options'], ['spx', 'SPX + SPXW']].map(function(x){
      var s = st[x[0]] || {};
      return { key: x[0], label: x[1], value: s.value, avg20: s.avg20, z: s.z250, pct: s.pct250 };
    }).filter(function(r){ return r.value != null; });
    var idx = { total: 1, equity: 2, index: 3, vix: 4, spx: 5, etp: 6 };
    var cols = [
      { label: 'Ratio', cell: function(r){ return '<b>' + escapeHtml(r.label) + '</b>'; }, sort: function(r){ return r.label; } },
      { label: 'Puts per call', num: true, cell: function(r){ return vnNum(r.value, 2); }, sort: function(r){ return r.value; } },
      { label: '20-day average', num: true, cell: function(r){ return vnNum(r.avg20, 2); }, sort: function(r){ return r.avg20; } },
      { label: 'vs its own year', num: true, title: 'Standard deviations from the trailing 250 sessions', cell: function(r){ return crowdZ(r.z) + ' ' + crowdPctile(r.pct); }, sort: function(r){ return r.z; } },
      { label: 'Last 250 sessions', nosort: true, cell: function(r){ return crowdSpark(pc.history, idx[r.key], function(v){ return v.toFixed(2); }, r.label + ' put/call history'); } },
    ];
    var hist = pc.history || [];
    var chart = hist.length > 5 ? '<div class="crd-chart">' + lineSvgHtml({ labels: hist.map(function(r){ return r[0].slice(5); }), series: [{ values: hist.map(function(r){ return r[2]; }), label: 'Equity' }, { values: hist.map(function(r){ return r[1]; }), label: 'Total' }], h: 220, yFmt: function(v){ return v.toFixed(2); } }) + '<p class="crd-legend"><span class="crd-sw crd-sw-0"></span>Equity put/call <span class="crd-sw crd-sw-1"></span>Total put/call</p></div>' : '';
    var vol = pc.volume || {};
    var volLine = vol.total ? '<p class="crd-fact">Cboe volume that session: ' + crowdInt(vol.total.calls) + ' calls, ' + crowdInt(vol.total.puts) + ' puts' + (vol.equity ? '; single-stock options ' + crowdInt(vol.equity.calls) + ' calls / ' + crowdInt(vol.equity.puts) + ' puts' : '') + '.</p>' : '';
    return h + VIEWS.tableHtml(cols, rows, { key: 'crowd-putcall', empty: 'No ratios.' }) + volLine + chart;
  }
  function crowdCotHtml(d){
    var cot = d.cot;
    var h = crowdHead('Commitments of Traders: financial futures', cot, cot && cot.note);
    if (!cot || !cot.contracts) return h + crowdEmpty('No COT read yet.');
    var rows = Object.keys(cot.contracts).map(function(k){ return cot.contracts[k]; });
    var fmtK = function(v){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v))); };
    var netCell = function(g){ return g ? '<span class="' + (g.net > 0 ? 'pos' : g.net < 0 ? 'neg' : '') + '">' + fmtK(g.net) + '</span>' + (g.change != null ? ' <small class="crd-dim">' + fmtK(g.change) + ' w/w</small>' : '') : '<span class="vt-na">—</span>'; };
    var cols = [
      { label: 'Contract', cell: function(r){ return '<b>' + escapeHtml(r.label) + '</b><div class="crd-dim">as of ' + escapeHtml(r.asOf || '') + '</div>'; }, sort: function(r){ return r.label; } },
      { label: 'Leveraged funds net', num: true, title: 'Hedge funds and CTAs, long minus short contracts', cell: function(r){ return netCell(r.groups.levFund); }, sort: function(r){ return r.groups.levFund.net; } },
      { label: 'vs 3 years', num: true, title: 'Leveraged-fund net position in standard deviations from its three-year history', cell: function(r){ return crowdZ(r.groups.levFund.z3y) + ' ' + crowdPctile(r.groups.levFund.pct3y); }, sort: function(r){ return r.groups.levFund.z3y; } },
      { label: 'Asset managers net', num: true, cell: function(r){ return netCell(r.groups.assetMgr); }, sort: function(r){ return r.groups.assetMgr.net; } },
      { label: 'Dealers net', num: true, cell: function(r){ return netCell(r.groups.dealer); }, sort: function(r){ return r.groups.dealer.net; } },
      { label: 'Open interest', num: true, cell: function(r){ return crowdInt(r.openInterest) + (r.oiChange != null ? ' <small class="crd-dim">' + fmtK(r.oiChange) + '</small>' : ''); }, sort: function(r){ return r.openInterest; } },
      { label: 'Leveraged net, 3 years', nosort: true, cell: function(r){ return crowdSpark(r.history, 1, fmtK, r.label + ' leveraged-fund net'); } },
    ];
    return h + VIEWS.tableHtml(cols, rows, { key: 'crowd-cot', empty: 'No contracts.' }) +
      '<p class="crd-note">Net = long minus short contracts held by each group on the report Tuesday. Leveraged funds are the fast money; asset managers are the slow money; dealers take the other side. A reading far from its own three-year range is unusual, not a direction.</p>';
  }
  function crowdMarginHtml(d){
    var md = d.marginDebt;
    var h = crowdHead('Margin debt (FINRA)', md, md && md.note);
    if (!md || !md.summary) return h + crowdEmpty('No margin statistics yet.');
    var s = md.summary;
    var rows = (md.rows || []).slice().reverse().slice(0, 36);
    var kpis = [['Margin debt', crowdUsd((s.debitUsdM || 0) * 1e6)], ['Month over month', vnPct(s.momPct, 1)], ['Year over year', vnPct(s.yoyPct, 1)], ['Free credit balances', crowdUsd((s.freeCreditUsdM || 0) * 1e6)], ['From the peak', s.peak ? vnPct(s.peak.fromPeakPct, 1) + ' (' + escapeHtml(s.peak.month) + ')' : '—']];
    var cols = [
      { label: 'Month', cell: function(r){ return escapeHtml(r.month); }, sort: function(r){ return r.month; } },
      { label: 'Debit balances', num: true, cell: function(r){ return crowdUsd(r.debit * 1e6); }, sort: function(r){ return r.debit; } },
      { label: 'Free credit, cash accounts', num: true, cell: function(r){ return crowdUsd((r.creditCash || 0) * 1e6); }, sort: function(r){ return r.creditCash; } },
      { label: 'Free credit, margin accounts', num: true, cell: function(r){ return crowdUsd((r.creditMargin || 0) * 1e6); }, sort: function(r){ return r.creditMargin; } },
    ];
    var ser = (md.rows || []).slice(-60);
    var chart = ser.length > 3 ? '<div class="crd-chart">' + lineSvgHtml({ labels: ser.map(function(r){ return r.month; }), series: [{ values: ser.map(function(r){ return r.debit / 1000; }) }], h: 200, yFmt: function(v){ return '$' + Math.round(v) + 'B'; } }) + '</div>' : '';
    return h + '<div class="mm-kpis">' + kpis.map(function(k){ return '<div class="mm-kpi"><span>' + escapeHtml(k[0]) + '</span><b>' + k[1] + '</b></div>'; }).join('') + '</div>' + chart +
      VIEWS.tableHtml(cols, rows, { key: 'crowd-margin', tall: false, empty: 'No months.' });
  }
  function crowdLevFlowsHtml(d){
    var lf = d.levFlows;
    var h = crowdHead('Leveraged ETF creations and redemptions', lf, lf && lf.note);
    if (!lf || !lf.rows) return h + crowdEmpty('No fund read yet.');
    var t = lf.totals || {};
    var kpis = [['Bull funds, 5 days', crowdUsd(t.bullUsd5d)], ['Bear funds, 5 days', crowdUsd(t.bearUsd5d)], ['Bull funds, 1 day', crowdUsd(t.bullUsd1d)], ['Bear funds, 1 day', crowdUsd(t.bearUsd1d)], ['Funds with share counts', (lf.withShares || 0) + ' of ' + (lf.funds || 0)]];
    var rows = lf.rows.filter(function(r){ return !r.missing; });
    var cols = [
      { label: 'Fund', cell: function(r){ return '<b>' + escapeHtml(r.sym) + '</b><div class="crd-dim">' + escapeHtml(r.label || '') + '</div>'; }, sort: function(r){ return r.sym; } },
      { label: 'Side', cell: function(r){ return '<span class="crd-side crd-side-' + r.side + '">' + (r.side === 'bull' ? 'Bull' : 'Bear') + ' ' + (r.lev > 0 ? '+' : '') + r.lev + 'x</span>'; }, sort: function(r){ return r.side; } },
      { label: 'Net assets', num: true, cell: function(r){ return crowdUsd(r.netAssets); }, sort: function(r){ return r.netAssets; } },
      { label: 'Shares out', num: true, cell: function(r){ return crowdInt(r.sharesOut); }, sort: function(r){ return r.sharesOut; } },
      { label: 'Flow, 1 day', num: true, cell: function(r){ return r.flowUsd1d == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.flowUsd1d > 0 ? 'pos' : r.flowUsd1d < 0 ? 'neg' : '') + '">' + crowdUsd(r.flowUsd1d) + '</span>'; }, sort: function(r){ return r.flowUsd1d; } },
      { label: 'Flow, 5 days', num: true, cell: function(r){ return r.flowUsd5d == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.flowUsd5d > 0 ? 'pos' : r.flowUsd5d < 0 ? 'neg' : '') + '">' + crowdUsd(r.flowUsd5d) + '</span>' + (r.sharesChg5dPct != null ? ' <small class="crd-dim">' + vnPct(r.sharesChg5dPct, 1) + ' shares</small>' : ''); }, sort: function(r){ return r.flowUsd5d; } },
      { label: 'Flow, 20 days', num: true, cell: function(r){ return r.flowUsd20d == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.flowUsd20d > 0 ? 'pos' : r.flowUsd20d < 0 ? 'neg' : '') + '">' + crowdUsd(r.flowUsd20d) + '</span>'; }, sort: function(r){ return r.flowUsd20d; } },
      { label: 'Shares out, 90 days', nosort: true, cell: function(r){ return crowdSpark(r.history, 1, crowdInt, r.sym + ' shares outstanding'); } },
    ];
    return h + '<div class="mm-kpis">' + kpis.map(function(k){ return '<div class="mm-kpi"><span>' + escapeHtml(k[0]) + '</span><b>' + k[1] + '</b></div>'; }).join('') + '</div>' +
      VIEWS.tableHtml(cols, rows, { key: 'crowd-levflows', empty: 'No funds quoted.' }) +
      '<p class="crd-note">A flow here is the change in a fund\\'s shares outstanding times its NAV: money arriving in or leaving a leveraged bet on the name. Dashes mean Yahoo carries no share count for that fund yet.</p>';
  }
  function crowdPositioningHtml(d){
    return crowdPutCallHtml(d) + crowdCotHtml(d) + crowdMarginHtml(d) + crowdLevFlowsHtml(d);
  }

  // ---- Short pressure tab ----
  function crowdShortsHtml(d){
    var sv = d.shortVolume, bo = d.borrow;
    var h = crowdHead('Daily short sale volume (FINRA)', sv, sv && sv.note);
    var rows = (d.rollup || []).filter(function(r){ return r.shortPct != null || r.borrowFeePct != null; });
    var market = sv && sv.market && sv.market.latest ? '<p class="crd-fact">Across the tracked names the average short share was <b>' + vnNum(sv.market.latest[1], 1) + '%</b> on ' + vnDay(sv.market.latest[0]) + ' ' + crowdSpark(sv.market.history, 1, function(v){ return v.toFixed(1) + '%'; }, 'Average short-volume share') + '</p>' : '';
    var cols = [
      { label: 'Stock', cell: function(r){ return vnSym(r.symbol); }, sort: function(r){ return r.symbol; } },
      { label: 'Short share', num: true, title: 'Share of the last session\\'s off-exchange volume sold short', cell: function(r){ return r.shortPct == null ? '<span class="vt-na">—</span>' : vnNum(r.shortPct, 1) + '% ' + crowdPctile(r.shortPctPctile); }, sort: function(r){ return r.shortPct; } },
      { label: '20-day average', num: true, cell: function(r){ return r.shortAvg20Pct == null ? '<span class="vt-na">—</span>' : vnNum(r.shortAvg20Pct, 1) + '%'; }, sort: function(r){ return r.shortAvg20Pct; } },
      { label: 'vs its 20 days', num: true, title: 'Standard deviations from the name\\'s own 20-session average', cell: function(r){ return crowdZ(r.shortZ20); }, sort: function(r){ return r.shortZ20; } },
      { label: 'Last 60 sessions', nosort: true, cell: function(r){ var b = sv && sv.bySymbol && sv.bySymbol[r.symbol]; return b ? crowdSpark(b.history, 1, function(v){ return v.toFixed(1) + '%'; }, r.symbol + ' short-volume share') : ''; } },
      { label: 'Borrow fee', num: true, title: 'Interactive Brokers annualized stock-loan fee', cell: function(r){ return r.borrowFeePct == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.borrowFeePct >= 5 ? 'crd-hot' : '') + '">' + vnNum(r.borrowFeePct, 2) + '%</span> ' + crowdPctile(r.borrowFeePctPctile); }, sort: function(r){ return r.borrowFeePct; } },
      { label: 'Shares to borrow', num: true, cell: function(r){ var b = bo && bo.bySymbol && bo.bySymbol[r.symbol]; return r.borrowAvailable == null ? '<span class="vt-na">—</span>' : (b && b.availableCapped ? '>' : '') + crowdInt(r.borrowAvailable); }, sort: function(r){ return r.borrowAvailable; } },
    ];
    var hot = rows.filter(function(r){ return r.borrowFeePct != null && r.borrowFeePct >= 5; }).sort(function(a, b){ return b.borrowFeePct - a.borrowFeePct; });
    var heavy = rows.filter(function(r){ return r.shortZ20 != null && r.shortZ20 >= 1.5; }).sort(function(a, b){ return b.shortZ20 - a.shortZ20; });
    return h + market +
      (heavy.length ? '<p class="mm-callout"><b>Short selling well above its own norm:</b> ' + heavy.map(function(r){ return vnSym(r.symbol) + ' ' + vnNum(r.shortPct, 0) + '%'; }).join(', ') + '.</p>' : '') +
      (hot.length ? '<p class="mm-callout"><b>Costly to borrow at IBKR:</b> ' + hot.map(function(r){ return vnSym(r.symbol) + ' ' + vnNum(r.borrowFeePct, 1) + '%'; }).join(', ') + ' a year.</p>' : '') +
      VIEWS.tableHtml(cols, rows, { key: 'crowd-shorts', empty: 'No short-volume reads yet.' }) +
      crowdHead('Borrow fee and availability (Interactive Brokers)', bo, bo && bo.note) +
      (bo && bo.universe ? '<p class="crd-fact">Median fee across the tracked names ' + vnNum(bo.universe.medianFeePct, 2) + '% a year; ' + (bo.universe.hardToBorrow || 0) + ' name(s) at 5% or more.</p>' : (bo ? '' : crowdEmpty('Not read yet.'))) +
      '<p class="crd-note">Short volume is not short interest: it counts the day\\'s sell-short prints in FINRA\\'s off-exchange files, which includes market makers hedging. The twice-monthly short interest and days-to-cover are on the <a href="?tab=market-map">Market map</a>.</p>';
  }

  // ---- Attention tab ----
  function crowdAttentionHtml(d){
    var rd = d.reddit, wk = d.wikipedia, st = d.stocktwits;
    var rows = (d.rollup || []).filter(function(r){ return r.redditMentions != null || r.wikiViews != null || r.watchers != null; });
    var cols = [
      { label: 'Stock', cell: function(r){ return vnSym(r.symbol); }, sort: function(r){ return r.symbol; } },
      { label: 'Reddit rank', num: true, title: 'Rank by mentions across the stock subreddits in the last 24 hours (ApeWisdom)', cell: function(r){ return r.redditRank == null ? '<span class="vt-na">—</span>' : '#' + r.redditRank; }, sort: function(r){ return r.redditRank == null ? 9999 : r.redditRank; } },
      { label: 'Mentions, 24h', num: true, cell: function(r){ return crowdInt(r.redditMentions) + ' ' + crowdPctile(r.redditMentionsPctile); }, sort: function(r){ return r.redditMentions; } },
      { label: 'vs 7-day pace', num: true, title: 'Today\\'s mentions divided by the trailing seven-day average', cell: function(r){ return r.redditVsAvg7 == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.redditVsAvg7 >= 2 ? 'crd-hot' : '') + '">' + vnNum(r.redditVsAvg7, 1) + '×</span>'; }, sort: function(r){ return r.redditVsAvg7; } },
      { label: 'Wikipedia views', num: true, title: 'Human views of the company article on the last complete day', cell: function(r){ return crowdInt(r.wikiViews); }, sort: function(r){ return r.wikiViews; } },
      { label: 'vs 30-day', num: true, title: 'Latest day divided by the trailing 30-day average', cell: function(r){ return r.wikiRatio30 == null ? '<span class="vt-na">—</span>' : '<span class="' + (r.wikiRatio30 >= 2 ? 'crd-hot' : '') + '">' + vnNum(r.wikiRatio30, 2) + '×</span> ' + crowdPctile(r.wikiRatio30Pctile); }, sort: function(r){ return r.wikiRatio30; } },
      { label: 'Views, 90 days', nosort: true, cell: function(r){ var b = wk && wk.bySymbol && wk.bySymbol[r.symbol]; return b ? crowdSpark(b.history, 1, crowdInt, r.symbol + ' Wikipedia views') : ''; } },
      { label: 'Stocktwits watchers', num: true, cell: function(r){ return crowdInt(r.watchers); }, sort: function(r){ return r.watchers; } },
      { label: 'Watchers, 7 days', num: true, cell: function(r){ return vnChg(r.watchersPct7d, 2) + ' ' + crowdPctile(r.watchersPct7dPctile); }, sort: function(r){ return r.watchersPct7d; } },
    ];
    var top = rd && rd.top ? '<div class="crd-chips">' + rd.top.slice(0, 30).map(function(t){ return '<span class="crd-chip' + (t.tracked ? ' is-tracked' : '') + '" title="' + escapeHtml((t.name || '') + ' · ' + (t.mentions || 0) + ' mentions · rank 24h ago #' + (t.rank24hAgo == null ? '—' : t.rank24hAgo)) + '">#' + t.rank + ' ' + (t.tracked ? vnSym(t.symbol) : escapeHtml(t.symbol)) + ' <small>' + crowdInt(t.mentions) + '</small></span>'; }).join('') + '</div>' : '';
    var trending = st && st.trending && st.trending.length ? '<div class="crd-chips">' + st.trending.slice(0, 30).map(function(t){ return '<span class="crd-chip' + (t.tracked ? ' is-tracked' : '') + '" title="' + escapeHtml(t.title || '') + '">' + (t.tracked ? vnSym(t.symbol) : escapeHtml(t.symbol)) + (t.watchers != null ? ' <small>' + crowdInt(t.watchers) + ' watching</small>' : '') + '</span>'; }).join('') + '</div>' : crowdEmpty('No trending list in this build.');
    return crowdHead('Attention by name', null, 'Three ways to see where the crowd is looking: Reddit mentions, Wikipedia article views and Stocktwits watchers. Attention is not direction, and a spike often follows news that already happened.') +
      VIEWS.tableHtml(cols, rows, { key: 'crowd-attention', empty: 'No attention reads yet.' }) +
      crowdHead('Most mentioned on Reddit right now', rd, rd && rd.note) + (top || crowdEmpty('No Reddit read yet.')) +
      crowdHead('Trending on Stocktwits', st, st && st.note) + trending +
      crowdHead('Wikipedia page views', wk, wk && wk.note) + (wk && wk.covered != null ? '<p class="crd-fact">' + wk.covered + ' company articles read' + (wk.skipped ? '; ' + wk.skipped + ' tracked names (mostly ETFs) have no article mapped' : '') + '.</p>' : crowdEmpty('Not read yet.')) +
      '<p class="crd-note">Highlighted chips are names this site covers and link to their page. Counts are what each source reports; none is a measure of buying or selling.</p>';
  }

  // ---- Odds markets (Kalshi) tab ----
  function crowdKalshiEventHtml(def, ev){
    var when = ev.closeTime ? '<span class="crd-dim">settles ' + escapeHtml(vnWhen(ev.closeTime)) + '</span>' : '';
    var vol = ev.volume ? '<span class="crd-dim">' + crowdInt(ev.volume) + ' contracts traded</span>' : '<span class="crd-dim">thin market</span>';
    var body = '';
    if (def.kind === 'range' && ev.distribution){
      var dist = ev.distribution;
      var max = Math.max.apply(null, dist.buckets.map(function(b){ return b.prob; }).concat([0.01]));
      body = '<div class="crd-dist">' + dist.buckets.map(function(b){
        var label = b.floor != null && b.cap != null ? crowdInt(b.floor) + '–' + crowdInt(b.cap) : b.floor != null ? crowdInt(b.floor) + ' or above' : crowdInt(b.cap) + ' or below';
        var isBest = dist.mostLikely && b.floor === dist.mostLikely.floor && b.cap === dist.mostLikely.cap;
        return '<div class="crd-dist-row' + (isBest ? ' is-best' : '') + '"><span class="crd-dist-label">' + escapeHtml(label) + '</span><span class="crd-dist-bar"><i style="width:' + (b.prob / max * 100).toFixed(1) + '%"></i></span><span class="crd-dist-p">' + Math.round(b.prob * 100) + '%</span></div>';
      }).join('') + '</div>' +
      '<p class="crd-fact">Market-implied mean <b>' + crowdInt(dist.impliedMean) + '</b>' + (dist.band80 ? '; 80% of the priced probability sits between ' + crowdInt(dist.band80[0]) + ' and ' + crowdInt(dist.band80[1]) : '') + (dist.overround ? '; prices sum to ' + Math.round(dist.overround * 100) + '% before scaling' : '') + '.</p>';
    } else if (ev.ladder){
      var rows = ev.ladder.rows || [];
      body = rows.length ? '<div class="crd-ladder">' + rows.map(function(r){
        var p = r.probAbove != null ? r.probAbove : r.prob;
        var lbl = r.probAbove != null ? 'above ' + r.level : (r.title || r.level);
        return '<div class="crd-dist-row"><span class="crd-dist-label">' + escapeHtml(String(lbl)) + (def.unit && r.probAbove != null ? escapeHtml(def.unit === 'k' ? 'k' : def.unit) : '') + '</span><span class="crd-dist-bar"><i style="width:' + (p * 100).toFixed(1) + '%"></i></span><span class="crd-dist-p">' + Math.round(p * 100) + '%</span></div>';
      }).join('') + '</div>' + (ev.ladder.median != null ? '<p class="crd-fact">Market-implied median about <b>' + escapeHtml(String(ev.ladder.median)) + (def.unit === 'k' ? 'k' : def.unit || '') + '</b>.</p>' : '') : crowdEmpty('No priced levels.');
    }
    return '<div class="crd-event"><div class="crd-event-head"><b>' + escapeHtml(ev.title || def.label) + '</b>' + (ev.subTitle ? ' <span class="crd-dim">' + escapeHtml(ev.subTitle) + '</span>' : '') + '<span class="crd-event-meta">' + when + ' ' + vol + '</span></div>' + body + '</div>';
  }
  function crowdOddsHtml(d){
    var k = d.kalshi;
    var h = crowdHead('Kalshi event contracts', k, k && k.note);
    if (!k || !k.series) return h + crowdEmpty('No odds read yet.');
    var groups = [['index', 'Index close ranges'], ['macro', 'Economic releases'], ['rates', 'Rates']];
    var out = h;
    groups.forEach(function(g){
      var defs = Object.keys(k.series).map(function(t){ return k.series[t]; }).filter(function(s){ return s.group === g[0]; });
      if (!defs.length) return;
      out += '<h4 class="crd-h4">' + escapeHtml(g[1]) + '</h4>';
      defs.forEach(function(s){
        out += '<div class="crd-series"><div class="crd-series-head"><span class="crd-series-name">' + escapeHtml(s.label) + '</span>' + crowdSourcePill(s) + (s.history && s.history.length > 2 ? crowdSpark(s.history, 1, function(v){ return String(v); }, s.label + ' implied level') : '') + '</div>' +
          ((s.events || []).length ? s.events.map(function(ev){ return crowdKalshiEventHtml(s, ev); }).join('') : crowdEmpty(s.error ? 'Not read: ' + s.error : 'No open market.')) + '</div>';
      });
    });
    return out + '<p class="crd-note">A YES price is read as the market\\'s probability (a 45-cent contract is a 45% chance). Thin books carry wide spreads, so the traded volume is shown beside each market. These are Kalshi\\'s traders\\' prices, not this site\\'s view.</p>';
  }

  // ---- 24/7 prices (perps) tab ----
  function crowdPerpsHtml(d){
    var p = d.perps;
    var h = crowdHead('Stock perpetuals on Hyperliquid (HIP-3)', p, p && p.note);
    if (!p || !p.bySymbol) return h + crowdEmpty('No perps read yet. The first live builds show which stocks the builder exchanges list.');
    var rows = Object.keys(p.bySymbol).map(function(s){ return p.bySymbol[s]; });
    var stocks = rows.filter(function(r){ return !r.isIndex; });
    var indexes = rows.filter(function(r){ return r.isIndex; });
    var pre = p.preopen && p.preopen.bySymbol ? p.preopen.bySymbol : null;
    var cols = [
      { label: 'Name', cell: function(r){ return r.isIndex ? '<b>' + escapeHtml(r.symbol) + '</b>' : vnSym(r.symbol); }, sort: function(r){ return r.symbol; } },
      { label: 'Perp mark', num: true, cell: function(r){ return r.markPx == null ? '—' : '$' + Number(r.markPx).toFixed(2); }, sort: function(r){ return r.markPx; } },
      { label: 'vs last US close', num: true, title: 'Perp mark against the stock\\'s last confirmed daily close', cell: function(r){ return vnChg(r.vsRefClosePct, 2) + (r.refClose != null ? ' <small class="crd-dim">$' + Number(r.refClose).toFixed(2) + '</small>' : ''); }, sort: function(r){ return r.vsRefClosePct; } },
      { label: 'Pre-open today', num: true, title: 'Where the perp stood at about 09:00 ET against the prior close', cell: function(r){ var q = pre && pre[r.symbol]; return q ? vnChg(q.vsRefClosePct, 2) : '<span class="vt-na">—</span>'; }, sort: function(r){ var q = pre && pre[r.symbol]; return q ? q.vsRefClosePct : null; } },
      { label: '24h', num: true, cell: function(r){ return vnChg(r.dayChangePct, 2); }, sort: function(r){ return r.dayChangePct; } },
      { label: 'Funding, yearly', num: true, title: 'Hourly funding rate scaled to a year; positive means longs pay shorts', cell: function(r){ return r.fundingAnnualPct == null ? '<span class="vt-na">—</span>' : '<span class="' + (Math.abs(r.fundingAnnualPct) >= 30 ? 'crd-hot' : '') + '">' + (r.fundingAnnualPct > 0 ? '+' : '') + vnNum(r.fundingAnnualPct, 1) + '%</span>'; }, sort: function(r){ return r.fundingAnnualPct; } },
      { label: 'Open interest', num: true, cell: function(r){ return crowdUsd(r.oiUsd); }, sort: function(r){ return r.oiUsd; } },
      { label: 'Volume, 24h', num: true, cell: function(r){ return crowdUsd(r.dayVolumeUsd); }, sort: function(r){ return r.dayVolumeUsd; } },
      { label: 'Mark vs oracle', num: true, title: 'Perp mark against the oracle (spot) price', cell: function(r){ return vnChg(r.premiumPct, 3); }, sort: function(r){ return r.premiumPct; } },
      { label: 'Mark, recent builds', nosort: true, cell: function(r){ return crowdSpark(r.history, 1, function(v){ return '$' + Number(v).toFixed(2); }, r.symbol + ' perp mark'); } },
      { label: 'Venue', cell: function(r){ return '<span class="crd-dim">' + escapeHtml(r.dex || '') + '</span>'; }, sort: function(r){ return r.dex; } },
    ];
    var totals = '<p class="crd-fact">' + (p.covered || 0) + ' covered stocks have a perp; open interest across them ' + crowdUsd(p.totalOiUsd) + (p.dexes ? '; venues read: ' + p.dexes.map(function(x){ return escapeHtml(x.dex) + ' (' + x.assets + ')'; }).join(', ') : '') + (pre && p.preopen.asOf ? '; pre-open snapshot ' + escapeHtml(vnWhen(p.preopen.asOf)) : '') + '.</p>';
    return h + totals + VIEWS.tableHtml(cols, stocks, { key: 'crowd-perps', empty: 'No covered stock has a listed perp.' }) +
      (indexes.length ? '<h4 class="crd-h4">Index perps</h4>' + VIEWS.tableHtml(cols, indexes, { key: 'crowd-perps-idx', tall: false, empty: '' }) : '') +
      '<p class="crd-note">These contracts trade around the clock on a crypto venue against an oracle of the stock price, so the gap to the last US close is the weekend and overnight move that market is pricing. Funding is what the crowded side pays every hour to stay in. Small open interest means a few traders can move it.</p>';
  }

  // ---- Page ----
  function crowdSourcesHtml(d){
    var list = d.sources || [];
    return '<details class="crd-sources"><summary>Sources and freshness (' + (d.okCount || 0) + ' of ' + list.length + ' fresh)</summary><ul>' + list.map(function(s){
      return '<li><b>' + escapeHtml(s.label) + '</b> ' + crowdSourcePill(s) + (s.untested ? ' <span class="crd-src crd-src-new">first builds</span>' : '') + (s.asOf ? ' <span class="crd-dim">as of ' + escapeHtml(s.asOf.length === 10 ? vnDay(s.asOf) : s.asOf.length === 7 ? s.asOf : vnWhen(s.asOf)) + '</span>' : '') + (s.error && !s.ok ? ' <span class="crd-dim">· ' + escapeHtml(s.error) + '</span>' : '') + '</li>';
    }).join('') + '</ul><p class="crd-note">Every source is free and read without a key: FINRA Reg SHO files and margin statistics, Cboe daily statistics, Interactive Brokers\\' stock-loan list, the CFTC Socrata API, ApeWisdom, the Wikimedia pageviews API, Yahoo Finance quotes, Stocktwits, Kalshi\\'s public market data and Hyperliquid\\'s info endpoint. A source that fails keeps its last good read, marked carried forward.</p></details>';
  }
  function crowdStripHtml(d){
    var pc = d.putCall && d.putCall.stats || {};
    var cot = d.cot && d.cot.contracts || {};
    var md = d.marginDebt && d.marginDebt.summary || null;
    var sv = d.shortVolume && d.shortVolume.market && d.shortVolume.market.latest || null;
    var rd = d.reddit && d.reddit.top && d.reddit.top[0] || null;
    var inx = d.kalshi && d.kalshi.series && d.kalshi.series.KXINX && d.kalshi.series.KXINX.headline || null;
    var k = [];
    if (pc.equity && pc.equity.value != null) k.push(['Equity put/call', vnNum(pc.equity.value, 2) + ' ' + crowdZ(pc.equity.z250)]);
    if (pc.total && pc.total.value != null) k.push(['Total put/call', vnNum(pc.total.value, 2) + ' ' + crowdZ(pc.total.z250)]);
    if (cot.ES && cot.ES.groups) k.push(['Hedge funds in S&P futures', (cot.ES.groups.levFund.net > 0 ? 'net long ' : 'net short ') + crowdInt(Math.abs(cot.ES.groups.levFund.net)) + ' ' + crowdZ(cot.ES.groups.levFund.z3y)]);
    if (md) k.push(['Margin debt, y/y', vnChg(md.yoyPct, 1)]);
    if (sv) k.push(['Avg short-volume share', vnNum(sv[1], 1) + '%']);
    if (inx && inx.impliedMean != null) k.push(['Kalshi S&P close, implied mean', crowdInt(inx.impliedMean)]);
    if (rd) k.push(['Most mentioned on Reddit', (rd.tracked ? vnSym(rd.symbol) : escapeHtml(rd.symbol)) + ' <small class="crd-dim">' + crowdInt(rd.mentions) + '</small>']);
    return k.length ? '<div class="mm-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>' : '';
  }
  function renderCrowd(){
    var root = document.getElementById('crowd-root'); if (!root) return;
    var d = crowdState.data;
    if (!d){
      root.innerHTML = '<p class="crd-empty">' + (crowdState.error ? 'The crowd page could not load. The next full build writes it; try again later.' : 'Loading crowd and positioning data…') + '</p>';
      return;
    }
    var asof = document.getElementById('crowd-asof');
    if (asof) asof.textContent = d.builtAtIso ? 'Built ' + vnWhen(d.builtAtIso) : '';
    var tab = crowdView('tab', 'positioning');
    if (!CROWD_TABS.some(function(t){ return t[0] === tab; })) tab = 'positioning';
    var body = tab === 'shorts' ? crowdShortsHtml(d) : tab === 'attention' ? crowdAttentionHtml(d) : tab === 'odds' ? crowdOddsHtml(d) : tab === 'perps' ? crowdPerpsHtml(d) : crowdPositioningHtml(d);
    root.innerHTML = crowdStripHtml(d) + vnTabsHtml(CROWD_TABS, tab, 'data-crowd-tab') + '<div class="crd-body">' + body + '</div>' + crowdSourcesHtml(d);
  }
  function loadCrowd(force){
    if (!force && crowdState.data && Date.now() - crowdState.fetchedAt < 10 * 60 * 1000){ renderCrowd(); return; }
    if (crowdState.loading) return;
    crowdState.loading = true; crowdState.error = null;
    renderCrowd();
    vnJson('crowd.json', false).then(function(j){
      crowdState.data = j && typeof j === 'object' && j.sources ? j : null;
      crowdState.error = crowdState.data ? null : 'missing';
      crowdState.fetchedAt = Date.now(); crowdState.loading = false;
      renderCrowd();
    });
  }
  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-crowd-tab]') : null;
    if (!t) return;
    crowdSetView('tab', t.getAttribute('data-crowd-tab'));
    renderCrowd();
  });
`;
}

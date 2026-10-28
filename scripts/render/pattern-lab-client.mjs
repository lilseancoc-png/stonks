// One display model for overview, charts, tables, and exported summaries.
export function patternLabFactory(host, doc, views, symbolHref, dataUrl) {
  const $ = id => doc.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, digits = 2) => finite(value) ? value.toFixed(digits) : '—';
  const pct = value => finite(value) ? (value > 0 ? '+' : '') + number(value) + '%' : '—';
  const store = (key, fallback) => views.get('pattern-lab.' + key, fallback);
  const valid = (value, values, fallback) => values.includes(value) ? value : fallback;
  const names = {volatility:'Volatility clustering', seasonality:'Index seasonality', leadLag:'Cross-asset relationships', divergences:'Price divergences', breadth:'Breadth disagreement', sentiment:'Sentiment disagreement'};
  const state = {data:null, pending:false, error:null, bound:false,
    view:valid(store('view','overview'), ['overview','charts','tables'], 'overview'),
    study:valid(store('study','all'), ['all',...Object.keys(names)], 'all'),
    symbol:valid(store('symbol',null), ['^GSPC','SPY','QQQ','IWM'], null), query:'', direction:'all'};
  const save = key => views.set('pattern-lab.' + key, state[key]);
  const link = symbol => '<a class="pat-sym" href="' + escape(symbolHref(symbol)) + '">' + escape(symbol) + '</a>';
  function table(cols, rows, key, empty = 'No observations available for this snapshot.') {
    return views.tableHtml(cols, rows, {key:'pattern-' + key, empty});
  }
  const column = (label, key, kind) => ({label, num:kind === 'number' || kind === 'pct',
    cell:row => kind === 'pct' ? pct(row[key]) : kind === 'number' ? number(row[key], 0) : escape(row[key] ?? '—'),
    sort:row => row[key] ?? null});
  function bars(title, rows, unit, note) {
    const validRows = rows.filter(row => finite(row.value));
    if (!validRows.length) return '<p class="pat-note">No completed observations for this comparison.</p>';
    const max = Math.max(...validRows.map(row => Math.abs(row.value)), .0001);
    return '<figure class="pat-bars"><figcaption>' + escape(title) + '</figcaption><p class="pat-note">' + escape(unit) + ' · bars extend from zero · scale ±' + number(max) + '</p>' + validRows.map(row => {
      const width = Math.abs(row.value) / max * 50;
      return '<div class="pat-bar-row"><span>' + escape(row.label) + (row.n != null ? '<small>n=' + escape(row.n) + (row.provisional ? ' · limited sample' : '') + '</small>' : '') + '</span><span class="pat-bar-track" aria-hidden="true"><i class="' + (row.value < 0 ? 'is-negative' : 'is-positive') + '" style="left:' + (row.value < 0 ? 50 - width : 50) + '%;width:' + width + '%"></i></span><b>' + (unit.includes('%') ? pct(row.value) : number(row.value)) + '</b></div>';
    }).join('') + '<p class="pat-note">' + escape(note) + '</p></figure>';
  }
  function summaryRows(pieces) {
    const rows = [], add = (study, label, stats, value = stats?.avgPct, unit = '10-session return (%)') => {
      if (!stats || !finite(value)) return;
      const minimum = study === 'seasonality' ? 10 : study === 'divergences' ? 30 : 20;
      const sample = stats.provisional || (finite(stats.n) && stats.n < minimum) ? 'Limited sample' : finite(stats.n) ? 'In-sample' : 'Not recorded';
      rows.push({study, label, unit, n:stats.n ?? null, baselineN:stats.baselineN ?? null, mean:value, median:stats.medianPct ?? null,
        sample, positive:stats.hitRatePct ?? null, gap:finite(value) && finite(stats.baselineAvgPct) ? value - stats.baselineAvgPct : null, baseline:stats.baselineAvgPct ?? null, worst:stats.worstPct ?? null, best:stats.bestPct ?? null});
    };
    for (const [key, label] of [['expanding','Expanding volatility'],['calm','Calm volatility'],['neutral','Neutral volatility']]) {
      const s = pieces.volatility?.sample?.[key]; add('volatility', label, s, s?.nextAbsPct, 'Next-session absolute move (%)');
    }
    const seasonal = pieces.seasonality?.[state.symbol] || {};
    for (const m of seasonal.months || []) add('seasonality', state.symbol + ' · ' + m.name, m, m.avgPct, 'Full-month price return (%)');
    for (const d of seasonal.weekdays || []) add('seasonality', state.symbol + ' · ' + d.name, d, d.avgPct, 'Daily price return (%)');
    for (const [key,label] of [['turnOfMonth','Turn of month'],['opexWeek','Expiration week'],['santa','Santa window'],['midterm','Midterm year']]) add('seasonality', state.symbol + ' · ' + label, seasonal[key], seasonal[key]?.avgPct, 'Full-window price return (%)');
    for (const [key,label] of [['rsiBullish','RSI bullish'],['rsiBearish','RSI bearish'],['macdBullish','MACD bullish'],['macdBearish','MACD bearish']]) {
      if (state.direction !== 'all' && !key.toLowerCase().endsWith(state.direction)) continue;
      let stats = pieces.divergences?.record?.[key];
      if ((state.data?.version || 1) < 2 && key.endsWith('Bearish') && finite(stats?.baselineAvgPct)) stats = {...stats, baselineAvgPct:-stats.baselineAvgPct};
      add('divergences', label, stats, stats?.avgPct, '10-session direction-adjusted return (%)');
    }
    add('breadth', 'SPY after breadth disagreement · 5 sessions', pieces.breadth?.forward5, pieces.breadth?.forward5?.avgPct, '5-session price return (%)');
    add('breadth', 'SPY after breadth disagreement · 10 sessions', pieces.breadth?.forward10);
    add('sentiment', 'SPY after fear with a rising tape', pieces.sentiment?.fear);
    add('sentiment', 'SPY after greed with a falling tape', pieces.sentiment?.greed);
    return rows.filter(row => state.study === 'all' || row.study === state.study);
  }
  function evidenceTable(rows, key) {
    return table([column('Comparison','label'), column('Unit','unit'), column('Observations','n','number'),column('Sample','sample'),
      column('Mean','mean','pct'), column('Median','median','pct'), column('Positive','positive','pct'),
      column('Same-direction baseline','baseline','pct'), {...column('Difference (pp)','gap'),cell:row=>number(row.gap)}, column('Worst','worst','pct'), column('Best','best','pct')], rows, key);
  }
  function peerRead(row) {
    return row.sessionClass === 'leading'
      ? {beta:row.sameDayBeta,t:row.sameDayT,n:row.n,timing:'Before US open'}
      : {beta:row.lag1Beta,t:row.lag1T,n:row.lag1N,timing:row.sessionClass === '24h' ? 'Overnight market' : 'Overlaps US session'};
  }
  function matches(symbol) { return String(symbol).toUpperCase().includes(state.query); }
  function currentRows(pieces) {
    return (pieces.divergences?.rows || []).filter(row => matches(row.symbol) && (state.direction === 'all' || row.direction === state.direction));
  }
  function divergencesTable(pieces, limit) {
    const all = currentRows(pieces), rows = limit ? all.slice(0, limit) : all;
    return '<h4>Current confirmed-pivot divergences</h4><p class="pat-note">' + all.length + ' matching rows. Pivots require three later sessions for confirmation; the newer pivot can be up to 12 sessions old.</p>' + table([
      {label:'Ticker', cell:row=>link(row.symbol), sort:row=>row.symbol}, column('Indicator','indicator'), column('Direction','direction'),
      column('Older pivot','olderDate'), column('Newer pivot','newerDate'), column('Price between pivots','priceChangePct','pct')
    ], rows, 'current-divergences', 'No current divergences match these filters.') + (limit && all.length > limit ? '<p class="pat-note">Showing the first ' + limit + '. Open Tables for every matching row.</p>' : '');
  }
  function leadsTable(pieces, limit) {
    const rows = (pieces.leadLag?.rows || []).filter(row => matches(row.us));
    return table([{label:'US ticker',cell:row=>link(row.us),sort:row=>row.us},column('Peer','peer'),{label:'Timing',cell:row=>escape(peerRead(row).timing),sort:row=>peerRead(row).timing}, {label:'Observations',num:true,cell:row=>number(peerRead(row).n,0),sort:row=>peerRead(row).n ?? null},
      {...column('Relevant beta','beta'),cell:row=>number(peerRead(row).beta),sort:row=>peerRead(row).beta},
      {...column('Relevant t-stat','t'),cell:row=>number(peerRead(row).t),sort:row=>peerRead(row).t},
      column('Corr 60','corr60'),column('Corr 120','corr120'),column('Read','read')], limit ? rows.slice(0,limit) : rows, 'leads', 'No peer observations match this view.');
  }
  function seasonality(pieces) {
    const season = pieces.seasonality?.[state.symbol] || {};
    if (season.unavailable || !season.months?.length) return '<p class="pat-note">Seasonal history is unavailable for this index.</p>';
    if (state.view === 'tables') return evidenceTable(summaryRows(pieces).filter(row => row.study === 'seasonality'),'seasonality');
    const note = 'Prior complete calendar years; price returns exclude cash distributions. These are seasonal descriptions, not forecasts.';
    return '<p class="pat-note">' + escape(state.symbol) + ' · ' + number(season.years,1) + ' years · ' + (season.sessions || 0) + ' sessions. Calendar history is separate from the two-year stock studies.</p>' +
      bars('Monthly returns', (season.months || []).map(row=>({label:row.name,n:row.n,value:row.avgPct,provisional:row.provisional})), 'Mean full-month return (%)', note) +
      (state.view === 'charts' ? bars('Weekday returns',(season.weekdays || []).map(row=>({label:row.name,n:row.n,value:row.avgPct,provisional:row.provisional})),'Mean daily return (%)', note) +
        bars('Recurring windows', ['turnOfMonth','opexWeek','santa','midterm'].map(key=>({label:{turnOfMonth:'Turn of month',opexWeek:'Expiration week',santa:'Santa window',midterm:'Midterm year'}[key],n:season[key]?.n,value:season[key]?.avgPct,provisional:season[key]?.provisional})),'Mean full-window return (%)','Window lengths differ; compare each with its own history, rather than ranking them as interchangeable signals.') : '');
  }
  function section(key, pieces) {
    const s = pieces[key] || {}, rows = summaryRows(pieces).filter(row=>row.study === key);
    let takeaway = '', body = '';
    if (key === 'volatility') {
      takeaway = s.state && s.state !== 'unavailable' ? 'SPY volatility is ' + s.state + '. This describes move size, rather than market direction.' : 'SPY volatility coverage is unavailable.';
      body = state.view === 'tables' ? evidenceTable(rows,key) : bars('Move size after each volatility state', rows.map(row=>({label:row.label,n:row.n,value:row.mean,provisional:row.sample==='Limited sample'})), 'Mean next-session absolute move (%)', s.advisory || 'Historical comparison only.');
      body += '<p class="pat-note">5-session realized volatility: ' + pct(s.rv5Pct) + ' annualized · 20-session: ' + pct(s.rv20Pct) + ' annualized.</p>';
    } else if (key === 'seasonality') {
      takeaway = 'Use the same calendar window and return unit when comparing outcomes.';
      body = seasonality(pieces);
    } else if (key === 'leadLag') {
      takeaway = (s.usable || 0) + ' of ' + (s.tested || 0) + ' peer relationships meet the association or breakdown screen.';
      body = state.view === 'charts' ? bars('Relevant peer association', (s.rows || []).filter(row=>matches(row.us)).slice(0,16).map(row=>({label:row.us+' / '+row.peer,value:peerRead(row).t,n:peerRead(row).n})), 'In-sample t-statistic', 'A large t-statistic is an association, not a forecast. Leading markets use same-day observations; overlapping and overnight markets use the prior session.') : leadsTable(pieces,state.view === 'overview' ? 6 : null);
      body += '<p class="pat-note">' + escape(s.caveat || '') + '</p>';
    } else if (key === 'divergences') {
      takeaway = currentRows(pieces).length + ' current divergence rows match the view. Historical returns below are signed in the setup direction.';
      const comparable = rows.filter(row=>row.n >= 30 && finite(row.gap)).sort((a,b)=>b.gap-a.gap);
      if (comparable.length) {
        const lead = comparable[0];
        takeaway += ' Among groups with at least 30 checks, ' + lead.label + ' has the highest mean minus baseline: ' + number(lead.gap) + ' percentage points across ' + lead.n + ' overlapping observations.';
      }
      if (state.view !== 'tables') {
        body = bars('Divergence outcomes and their direction-matched baseline', rows.flatMap(row=>[{label:row.label,n:row.n,value:row.mean,provisional:row.sample==='Limited sample'},{label:row.label+' · baseline',n:row.baselineN,value:row.baseline}]), 'Mean next-10-session return (%)', 'Bearish outcomes and baselines reverse the sign of the underlying return. Overlapping five-session checks are correlated, and a high count is not a count of independent trades.');
      } else body = evidenceTable(rows,key);
      if (state.view !== 'charts') body += divergencesTable(pieces,state.view === 'overview' ? 6 : null);
      body += '<p class="pat-note">' + escape(s.note || 'These observations are exploratory.') + '</p>';
    } else if (key === 'breadth') {
      takeaway = !s.latest ? 'Breadth history is unavailable.' : s.active ? 'The latest saved day has flat or rising indexes alongside weakening breadth.' : 'The latest saved day does not show breadth disagreement.';
      body = state.view === 'tables' ? evidenceTable(rows,key) : bars('SPY after breadth disagreement',rows.map(row=>({label:row.label,n:row.n,value:row.mean,provisional:row.sample==='Limited sample'})),'Mean forward price return (%)','Five-session and ten-session results are different horizons. Repeated flagged days can overlap.');
    } else if (key === 'sentiment') {
      takeaway = s.state && s.state !== 'unavailable' ? s.state === 'aligned' ? 'No extreme-sentiment disagreement is active.' : s.state : 'Sentiment history is unavailable.';
      body = state.view === 'tables' ? evidenceTable(rows,key) : bars('SPY after sentiment disagreement',rows.map(row=>({label:row.label,n:row.n,value:row.mean,provisional:row.sample==='Limited sample'})),'Mean next-10-session price return (%)','Returns are SPY price changes. Samples can overlap; a positive average is not a validated entry signal.');
      body += '<p class="pat-note">' + escape(s.rules || '') + '</p>';
    }
    return '<section class="pat-piece" data-pat-study-section="' + key + '"><header class="pat-study-header"><h3>' + names[key] + '</h3>' + (state.view === 'overview' ? '<button type="button" data-pat-explore="' + key + '">Explore</button>' : '') + '</header><p class="pat-takeaway">' + escape(takeaway) + '</p>' + body + '</section>';
  }
  function coverage(data) {
    const rows = data.history?.stocks || [];
    if (!data.history) return '<p class="pat-note">This older snapshot does not record stock-history depth. A new data build is needed for the two-year study.</p>';
    return '<details class="pat-coverage"><summary>Actual stock-history coverage · ' + rows.length + ' names</summary><p class="pat-note">' + escape(data.history.note) + '</p>' + table([column('Ticker','symbol'),column('First close','firstDate'),column('Last close','lastDate'),column('Sessions','sessions','number'),{label:'Divergence study',cell:row=>escape({'included':'Included','under-80-sessions':'Insufficient history','excluded-large-print':'Excluded: daily move above 40%'}[row.status] || 'Not recorded'),sort:row=>row.status ?? null}],rows,'coverage') + '</details>';
  }
  function render() {
    const root = $('pattern-lab-root'), eye = $('pattern-lab-eyebrow');
    if (!root) return;
    root.setAttribute('aria-busy', String(state.pending));
    if (!state.data) {root.innerHTML = '<p class="pat-note">' + (state.error ? 'Pattern Lab could not load. <button type="button" data-pat-retry>Retry</button>' : 'Loading Pattern Lab…') + '</p>'; return;}
    const data = state.data, pieces = data.pieces || {}, selected = state.study === 'all' ? Object.keys(names) : [state.study];
    if (eye) eye.textContent = 'Snapshot ' + (data.asOf || 'unknown');
    const stale = Date.parse(data.builtAtIso);
    root.innerHTML = '<div class="pat-toolbar"><div class="pat-switch" role="group" aria-label="Pattern Lab view">' + [['overview','Overview'],['charts','Charts'],['tables','Tables']].map(([key,label])=>'<button type="button" data-pat-view="' + key + '" aria-pressed="' + (state.view === key) + '">' + label + '</button>').join('') + '</div><label>Study<select data-pat-study aria-label="Pattern study">' + [['all','All studies'],...Object.entries(names)].map(([key,label])=>'<option value="' + key + '"' + (state.study === key ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><button type="button" class="streaks-btn" data-pat-export>Export summary</button><button type="button" class="streaks-btn" data-pat-retry' + (state.pending ? ' disabled' : '') + '>' + (state.pending ? 'Refreshing…' : 'Refresh snapshot') + '</button></div>' +
      '<div class="pat-filters">' + (state.study === 'all' || state.study === 'seasonality' ? '<label>Index<select data-pat-symbol aria-label="Seasonal index">' + ['^GSPC','SPY','QQQ','IWM'].map(symbol=>'<option' + (state.symbol === symbol ? ' selected' : '') + '>' + symbol + '</option>').join('') + '</select></label>' : '') + '<label>Find ticker<input type="search" data-pat-query aria-label="Filter current tickers" value="' + escape(state.query) + '" placeholder="Current divergences and peers"></label><label>Divergence direction<select data-pat-direction aria-label="Divergence direction">' + ['all','bullish','bearish'].map(value=>'<option value="' + value + '"' + (state.direction === value ? ' selected' : '') + '>' + value + '</option>').join('') + '</select></label></div>' +
      '<p class="pat-note">Explore current conditions and past outcomes. Each study uses its own return horizon and units.</p>' +
      ((!finite(stale) || Date.now() - stale > 72 * 3600000) ? '<p class="pat-flag" role="status">Reference snapshot: this data is more than three days old or its build date is unavailable.</p>' : '') +
      '<p class="pat-note">Stock history: up to two years. Expand coverage for actual dates and sample sizes.</p>' + coverage(data) +
      selected.map(key=>section(key,pieces)).join('') + '<p class="pat-note">All results describe the available sample. Observations can overlap, and no view establishes a trading probability or changes grades or positions.</p>';
  }
  function exportSummary() {
    const pieces = state.data?.pieces || {}, rows = summaryRows(pieces);
    if (state.study === 'all' || state.study === 'leadLag') for (const row of pieces.leadLag?.rows || []) if (matches(row.us)) rows.push({study:'leadLag',label:row.us+' / '+row.peer,unit:'Association coefficients',n:peerRead(row).n,beta:peerRead(row).beta,t:peerRead(row).t,corr60:row.corr60,corr120:row.corr120,timing:peerRead(row).timing});
    const fields = ['study','label','unit','n','mean','median','positive','baseline','gap','worst','best','beta','t','corr60','corr120','timing'];
    const body = [fields,...rows.map(row=>fields.map(key=>row[key]))].map(row=>row.map(value=>'"' + String(value ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const url = host.URL.createObjectURL(new host.Blob([body],{type:'text/csv;charset=utf-8'}));
    const a = doc.createElement('a'); a.href = url; a.download = 'pattern-lab-' + state.study + '-' + state.symbol + '.csv'; a.click(); host.setTimeout(()=>host.URL.revokeObjectURL(url),1000);
  }
  function bind() {
    const root = $('pattern-lab-root'); if (!root || state.bound) return; state.bound = true;
    root.addEventListener('click',event=>{
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.patView) {state.view = button.dataset.patView;save('view');render();root.querySelector('[data-pat-view="' + state.view + '"]')?.focus();}
      if (button.dataset.patExplore) {state.study=button.dataset.patExplore;state.view='charts';save('study');save('view');render();root.querySelector('[data-pat-study]')?.focus();}
      if (button.hasAttribute('data-pat-export')) exportSummary();
      if (button.hasAttribute('data-pat-retry')) load(true);
    });
    root.addEventListener('change',event=>{
      const control = event.target;
      for (const key of ['study','symbol','direction']) if (control.hasAttribute('data-pat-' + key)) {state[key]=control.value; if (key !== 'direction') save(key);render();root.querySelector('[data-pat-' + key + ']')?.focus();}
    });
    root.addEventListener('input',event=>{
      if (!event.target.hasAttribute('data-pat-query')) return;
      const value = event.target.value, start = event.target.selectionStart, end = event.target.selectionEnd; state.query=value.trim().toUpperCase();render();const input=root.querySelector('[data-pat-query]');input.focus();input.setSelectionRange(start,end);
    });
  }
  async function load(force = false) {
    bind(); if (state.pending) return;
    if (state.data && !force) {render();return;}
    state.pending=true; state.error=null;render();
    try {
      const url = dataUrl('pattern-recognition.json');
      const response = await host.fetch(url,{cache:'no-store'}); if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json(); if (!data?.pieces || data.error) throw Error('Pattern snapshot unavailable');
      state.data=data;
      if (!state.symbol) state.symbol = data.pieces.seasonality?.['^GSPC']?.months?.length ? '^GSPC' : 'SPY';
    } catch (error) {state.error=error;state.data=null;}
    finally {state.pending=false;render();}
  }
  return {load,render};
}

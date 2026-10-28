// Bundled into app.js by function serialization. Owner data stays lazy and is
// never embedded into the HTML or saved in browser storage.
export function historicalDataFactory(host, doc, options) {
  const state = { data: null, pending: false, error: null, symbol: 'SPY', range: 'all', study: 'q4', view: 'studies', context: 'VIXCLS', bound: false, libraryScroll: 0, freshnessTimer: null };
  const nyClock = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const clockParts = time => Object.fromEntries(nyClock.formatToParts(new Date(time)).map(p => [p.type, p.value]));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const number = (n, digits = 2) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—';
  const pct = n => typeof n === 'number' && Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '—';
  const sign = n => typeof n !== 'number' || !Number.isFinite(n) || n === 0 ? '' : n > 0 ? 'h-pos' : 'h-neg';
  const status = value => ({ 'in-progress': 'In progress', complete: 'Completed · held out', upcoming: 'Upcoming', unavailable: 'Window data unavailable' })[value] || 'Unavailable';
  const rangeLabel = () => ({ all: 'All available history', '20y': 'Last 20 calendar years', '10y': 'Last 10 calendar years' })[state.range];
  const root = () => doc.getElementById('historical-data-root');
  function observationAge(date) {
    if (!date) return Infinity;
    const p = clockParts(Date.now());
    let cutoff = Date.parse(p.year + '-' + p.month + '-' + p.day + 'T00:00:00Z');
    if (Number(p.hour) * 60 + Number(p.minute) < 975) cutoff -= 86400000;
    return Math.max(0, Math.floor((cutoff - Date.parse(date + 'T00:00:00Z')) / 86400000));
  }
  const sourceStale = s => s.stale || observationAge(s.lastDate) > (s.lagDays ?? 4);
  function snapshotNotice(data) {
    return Date.now() - Date.parse(data.builtAtIso) > 4 * 86400000 ? '<p class="h-notice" role="status">This snapshot was built on ' + escape(data.builtAtIso) + ' and may be missing newer observations or releases. Refresh snapshot checks for a newer published build; it does not download live market data.</p>' : '';
  }
  function scheduleFreshness(data) {
    host.clearTimeout(state.freshnessTimer);
    if (doc.hidden || root()?.closest('.page-pane')?.hidden !== false) return;
    const now = Date.now(), today = new Date(now), candidates = [];
    // New York's close cutoff is 20:15 or 21:15 UTC. Check the actual zone so
    // the next boundary remains correct across daylight-saving changes.
    for (let day = 0; day < 3; day++) for (const hour of [20,21]) {
      const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day, hour, 15), p = clockParts(t);
      if (t > now && p.hour === '16' && p.minute === '15') candidates.push(t);
    }
    const expires = Date.parse(data.builtAtIso) + 4 * 86400000 + 1;
    if (expires > now) candidates.push(expires);
    state.freshnessTimer = host.setTimeout(() => { if (!doc.hidden && root()?.closest('.page-pane')?.hidden === false) render(); }, Math.max(1, Math.min(...candidates) - now));
  }
  function save() { try { host.localStorage.setItem('stonks-historical-view', JSON.stringify({ symbol: state.symbol, range: state.range, study: state.study, view: state.view, context: state.context })); } catch {} }
  function restore() {
    try {
      const saved = JSON.parse(host.localStorage.getItem('stonks-historical-view') || '{}');
      if (typeof saved.symbol === 'string' && /^[A-Z]{1,5}$/.test(saved.symbol)) state.symbol = saved.symbol;
      if (['all', '20y', '10y'].includes(saved.range)) state.range = saved.range;
      if (typeof saved.study === 'string') state.study = saved.study;
      if (['studies','context','sources'].includes(saved.view)) state.view = saved.view;
      if (typeof saved.context === 'string') state.context = saved.context;
    } catch {}
  }
  function valid(data) {
    const finite = v => typeof v === 'number' && Number.isFinite(v);
    const day = t => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t);
    const point = p => p && finite(p.x) && p.x >= 0 && p.x <= 100 && finite(p.y);
    const summary = s => s && Number.isInteger(s.n) && s.n >= 0 && ['meanPct', 'medianPct', 'positivePct', 'worstPct', 'bestPct'].every(k => s.n ? finite(s[k]) : s[k] === null);
    const range = r => summary(r) && Array.isArray(r.years) && r.n === r.years.length && r.years.every(y => Number.isInteger(y.year) && day(y.baseline) && day(y.end) && finite(y.returnPct) && finite(y.drawdownPct)) && Array.isArray(r.path) && r.path.every(p => p && finite(p.x) && finite(p.low) && finite(p.high) && finite(p.median) && p.low <= p.median && p.median <= p.high) && r.baseline && (r.baseline.meanPct === null || finite(r.baseline.meanPct));
    if (data?.version !== 2 || !Number.isFinite(Date.parse(data.builtAtIso)) || data.historyEncoding !== 'shared-observations-v1' || !data.indexes || typeof data.indexes !== 'object' || Array.isArray(data.indexes) || !Array.isArray(data.methodology) || !Array.isArray(data.lore) || !data.source || !Array.isArray(data.coverage?.markets) || !Array.isArray(data.coverage?.context) || !Array.isArray(data.coverage?.paidOptions)) return false;
    const covered = [...data.coverage.markets, ...data.coverage.context];
    if (data.coverage.minimumYears !== 10 || data.coverage.total !== covered.length || data.coverage.ready !== covered.filter(s=>s?.status==='ready').length || !Array.isArray(data.coverage.boundaries)) return false;
    if (!covered.every(s => s && typeof s.id === 'string' && typeof s.label === 'string' && typeof s.url === 'string' && s.url.startsWith('https://') && finite(s.years) && Number.isInteger(s.observations) && s.observations >= 0 && (s.firstDate === null || day(s.firstDate)) && (s.lastDate === null || day(s.lastDate)) && ['ready','missing','under-ten-years','gaps-or-thin'].includes(s.status) && (s.status !== 'ready' || s.years >= 10))) return false;
    if (!data.coverage.paidOptions.every(p=>p && typeof p.name==='string' && typeof p.cost==='string' && typeof p.url==='string' && p.url.startsWith('https://'))) return false;
    if (!data.coverage.context.every(s => Array.isArray(s.chart) && s.chart.every(p => p && day(p.t) && finite(p.v)))) return false;
    return Object.entries(data.indexes).every(([key, index]) => data.coverage.markets.some(s => s.id === key && s.status === 'ready') && index?.current && day(index.current.asOf) && index.analogs && Array.isArray(index.analogs.rows) && index.analogs.rows.every(a => a && day(a.date) && [a.trend63Pct, a.volatility20Pct, a.next20Pct, a.next63Pct].every(finite)) && Array.isArray(index.monthly) && index.monthly.length === 12 && index.monthly.every(summary) && Array.isArray(index.recurring) && Array.isArray(index.studies) && index.studies.every(s => typeof s?.id === 'string' && /^[a-z0-9-]+$/.test(s.id) && s.comparison && ['complete', 'in-progress', 'upcoming', 'unavailable'].includes(s.comparison.status) && Array.isArray(s.comparison.path) && s.comparison.path.every(point) && (!s.comparison.path.length || finite(s.comparison.returnPct)) && ['all', '20y', '10y'].every(key => range(s.ranges?.[key]))));
  }
  function decode(data) {
    if (data?.historyEncoding !== 'shared-observations-v1' || !data.indexes || typeof data.indexes !== 'object') return data;
    for (const index of Object.values(data.indexes)) {
      if (!Array.isArray(index?.studies)) continue;
      for (const study of index.studies) {
        const all = study?.ranges?.all?.years;
        if (!Array.isArray(all)) continue;
        for (const key of ['20y','10y']) {
          const range = study.ranges[key];
          if (range && Number.isInteger(range.fromYear)) range.years = all.filter(y => y && Number.isInteger(y.year) && y.year >= range.fromYear);
        }
      }
    }
    return data;
  }
  function viewTabs() {
    return '<div class="h-view-tabs" aria-label="Historical Data views">' + [['studies','Seasonal studies'],['context','Macro & conditions'],['sources','Sources & coverage']].map(([id,label]) => '<button type="button" data-history-view="' + id + '" aria-pressed="' + (state.view === id) + '" class="' + (state.view === id ? 'is-selected' : '') + '">' + label + '</button>').join('') + '</div>';
  }
  function coverageStatus(s) {
    if (s.status === 'ready') return '10+ years verified';
    return s.status === 'under-ten-years' ? 'Below 10 continuous years' : s.status === 'gaps-or-thin' ? 'Insufficient observations' : 'Missing · not used';
  }
  function sourceView(data) {
    const c = data.coverage, sources = [...c.markets, ...c.context];
    const table = list => '<div class="h-table-wrap"><table class="h-table h-source-table"><thead><tr><th>Dataset / original publisher</th><th>Usable dates</th><th>Years / observations</th><th>Coverage and refresh</th></tr></thead><tbody>' + list.map(s => '<tr><td><a href="' + escape(s.url) + '" target="_blank" rel="noopener">' + escape(s.id + ' · ' + s.label) + '</a><small>' + escape(s.publisher + ' via ' + s.provider) + '</small></td><td>' + escape(s.firstDate || '—') + ' → ' + escape(s.lastDate || '—') + (s.excludedEarlyObservations ? '<small>Excluded ' + s.excludedEarlyObservations + ' earlier observations before ' + s.gapCount + ' reporting gaps. Raw source starts ' + escape(s.rawFirstDate) + '.</small>' : '') + '</td><td>' + number(s.years, 1) + ' years<small>' + s.observations.toLocaleString() + ' · ' + escape(s.frequency) + '</small></td><td>' + escape(coverageStatus(s)) + (s.error ? '<small class="h-neg">Latest refresh failed · retained data: ' + escape(s.error) + '</small>' : '') + (sourceStale(s) ? '<small class="h-neg">Latest observation is stale</small>' : '') + '<small>Source check: ' + escape(s.checkedAt || 'no source check recorded') + '</small><small>Last successful download: ' + escape(s.lastSuccessAt || 'not recorded') + '</small>' + (s.confirmedThrough ? '<small>Confirmed closes through ' + escape(s.confirmedThrough) + '</small>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
    return '<div class="h-source-intro"><h3>Ten-year coverage ledger</h3><p>' + c.ready + ' of ' + c.total + ' catalogued datasets pass the ten-year history rule. Provider subscription fees for enabled adapters: $0. A missing, short or failed dataset never becomes a zero or a successful coverage claim.</p><p class="h-caption">Dates describe the contiguous usable tail, not an interpolated history. Earlier irregular reporting is retained in the source cache but excluded from comparisons. Free access does not grant blanket redistribution rights.</p></div>' + ['US stocks','Bonds','Commodities'].map(group => '<h4 class="h-source-heading">' + group + '</h4>' + table(c.markets.filter(s => s.group === group))).join('') + '<h4 class="h-source-heading">Macro, volatility and physical commodities</h4>' + table(c.context) + '<section class="h-paid"><h3>Optional paid data · none connected</h3><p>These services fill specific gaps. Each requires your approval before implementation or subscription. Prices checked October 24, 2026; taxes and business/display licenses may add cost.</p>' + c.paidOptions.map(p => '<article><h4><a href="' + escape(p.url) + '" target="_blank" rel="noopener">' + escape(p.name) + '</a> · ' + escape(p.cost) + '</h4><p>' + escape(p.purpose) + '</p><p class="h-caption">' + escape(p.limitation) + ' ' + escape(p.status) + '.</p></article>').join('') + '</section><details class="h-disclosure"><summary>Coverage boundaries and outstanding data needs</summary><ul>' + c.boundaries.map(t => '<li>' + escape(t) + '</li>').join('') + '<li>Long original-vintage macro histories need ALFRED vintage retrieval before use in a historical trading backtest. Current context charts use revised observations.</li><li>Super Bowl, lunar, intraday, event-surprise and option-chain effects remain untested without their separate event datasets.</li></ul></details>';
  }
  function chartHover(points) {
    return typeof options.hover === 'function' ? options.hover(points) : '';
  }
  function contextChart(s) {
    if (s.status !== 'ready' || !s.chart.length) return '<p class="h-notice">This dataset does not meet the ten-year coverage requirement. Its chart and comparative statistics are withheld.</p>';
    const rows = s.chart, values = rows.map(r => r.v); let low = Math.min(...values), high = Math.max(...values);
    const pad = Math.max(.001, (high - low) * .08); low -= pad; high += pad;
    const first = Date.parse(rows[0].t), last = Date.parse(rows.at(-1).t), x = t => 78 + (Date.parse(t) - first) / Math.max(1, last - first) * 590, y = v => 210 - (v - low) / (high - low) * 182;
    const path = rows.map((r,i)=>(i?'L':'M')+number(x(r.t))+','+number(y(r.v))).join(' ');
    const unit = s.unit ? ' ' + s.unit : '';
    const hover = chartHover(rows.map(r => ({
      x: x(r.t), y: y(r.v),
      label: r.t + '\n' + number(r.v) + unit + '\n' + s.label,
    })));
    return '<figure class="h-figure h-context-chart"><svg viewBox="0 0 704 267" role="img" aria-label="' + escape(s.label + ', historical levels in ' + s.unit) + '"' + hover + '>' + Array.from({length:5},(_,i)=>{const v=low+(high-low)*i/4;return '<line class="h-grid" x1="78" x2="668" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="70" y="'+(y(v)+4)+'" text-anchor="end">'+Number(v.toPrecision(4)).toLocaleString()+'</text>';}).join('') + '<path class="h-current" d="'+path+'"/>' + [0,.25,.5,.75,1].map(p=>{const t=first+(last-first)*p;return '<text x="'+(78+p*590)+'" y="235" text-anchor="middle">'+new Date(t).getUTCFullYear()+'</text>';}).join('') + '<text x="373" y="260" text-anchor="middle">Observation date (year)</text></svg><figcaption>Vertical axis: ' + escape(s.unit) + '. Monthly last available observations, latest 600 months at most.</figcaption></figure>';
  }
  function contextView(data) {
    const list = data.coverage.context;
    const s = list.find(s=>s.id===state.context) || list[0]; if(!s) return '<p class="h-empty">No context series are catalogued.</p>';
    state.context = s.id;
    return '<div class="h-toolbar"><label>Economic or market series<select data-history-control="context">' + list.map(d=>'<option value="'+escape(d.id)+'"'+(d.id===s.id?' selected':'')+'>'+escape(d.label+' · '+d.id)+'</option>').join('') + '</select></label><button type="button" class="book-more" data-history-retry>Refresh snapshot</button></div><div class="h-source-intro"><span class="h-kicker">'+escape(s.group+' · '+coverageStatus(s))+'</span><h3>'+escape(s.label)+'</h3><p>'+escape(s.note || 'Latest revised observations from the original publisher, distributed by FRED.')+'</p><p class="h-caption">'+escape(s.publisher)+' via FRED · '+escape(s.frequency)+' · usable range '+escape(s.firstDate||'—')+' to '+escape(s.lastDate||'—')+' · '+number(s.years,1)+' years</p></div>' + (sourceStale(s) ? '<p class="h-notice">The latest observation is stale for this series. The value below is the last reported observation, not a current reading.</p>' : '') + (s.error ? '<p class="h-notice">Latest source refresh failed. Any retained history keeps its original observation dates.</p>' : '') + '<div class="h-metrics">'+metric('Latest reported value',number(s.latest),'As of '+(s.lastDate||'unavailable'))+metric('Ten-year median',number(s.median10y),'Ending '+(s.lastDate||'unavailable'))+metric('Ten-year level percentile',s.percentile10y==null?'—':number(s.percentile10y,0)+'%', 'Descriptive rank, not a return')+metric('History coverage',number(s.years,1)+' years',s.observations.toLocaleString()+' observations')+'</div>'+contextChart(s)+'<p class="h-caption">Source: <a href="'+escape(s.url)+'" target="_blank" rel="noopener">'+escape(s.publisher+' · '+s.id)+'</a>. '+escape(s.vintage)+'. Observation periods may precede publication. Ten-year statistics end at the latest reported observation. Trending levels can have high percentiles without an unusual economic change. These charts do not condition return analogs or imply a trade.</p>';
  }
  function metric(label, value, note = '', cls = '') { return '<div class="h-metric"><span>' + escape(label) + '</span><b class="' + cls + '">' + escape(value) + '</b>' + (note ? '<small>' + escape(note) + '</small>' : '') + '</div>'; }
  function lineChart(study, sample) {
    const history = sample.path, current = study.comparison.path;
    if (!history.length) return '<div class="h-empty">No completed historical windows in this sample. Choose a longer lookback.</div>';
    const values = [0, ...history.flatMap(p => [p.low, p.high, p.median]), ...current.map(p => p.y)].filter(Number.isFinite);
    let low = Math.min(...values), high = Math.max(...values);
    const pad = Math.max(.5, (high - low) * .12); low -= pad; high += pad;
    const x = n => 58 + n * 6.18, y = n => 214 - (n - low) / (high - low) * 190;
    const path = points => points.map((p, i) => (i ? 'L' : 'M') + number(x(p.x)) + ',' + number(y(p.y))).join(' ');
    const band = [...history.map(p => ({ x: p.x, y: p.low })), ...[...history].reverse().map(p => ({ x: p.x, y: p.high }))];
    const grid = Array.from({ length: 5 }, (_, i) => { const v = low + (high - low) * i / 4; return '<line class="h-grid" x1="58" x2="676" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="50" y="' + (y(v) + 4) + '" text-anchor="end">' + number(v, 1) + '%</text>'; }).join('');
    const ticks = [0, 25, 50, 75, 100].map(n => '<text x="' + x(n) + '" y="237" text-anchor="middle">' + n + '%</text>').join('');
    let gap = 100;
    for (let i = 1; i < history.length; i++) gap = Math.min(gap, Math.abs(history[i].x - history[i - 1].x) || gap);
    const tol = Math.max(0.5, gap / 2);
    const hoverPoints = [];
    history.forEach(p => {
      let near = null, dist = Infinity;
      for (const point of current) {
        const d = Math.abs(point.x - p.x);
        if (d < dist) { dist = d; near = point; }
      }
      if (!near || dist > tol) near = null;
      const progress = Math.abs(p.x - Math.round(p.x)) < 0.05 ? String(Math.round(p.x)) : number(p.x, 1);
      const lines = [progress + '% of the window', 'Median ' + pct(p.median), 'Middle 50% ' + pct(p.low) + ' to ' + pct(p.high)];
      if (near) lines.push(study.comparison.year + ' comparison ' + pct(near.y));
      const label = lines.join('\n');
      const px = x(p.x);
      hoverPoints.push({ x: px, y: y(p.median), label });
      if (near) hoverPoints.push({ x: px, y: y(near.y), label });
    });
    const hover = chartHover(hoverPoints);
    return '<figure class="h-figure"><svg viewBox="0 0 704 267" role="img" aria-label="Window return chart. Historical median and middle fifty percent, with the held-out comparison through its latest completed close."' + hover + '>' + grid + '<path class="h-band" d="' + path(band) + 'Z"/><line class="h-zero" x1="58" x2="676" y1="' + y(0) + '" y2="' + y(0) + '"/><path class="h-median" d="' + path(history.map(p => ({ x: p.x, y: p.median }))) + '"/>' + (current.length ? '<path class="h-current" d="' + path(current) + '"/>' : '') + ticks + '<text x="367" y="260" text-anchor="middle">Window progress (%)</text></svg><figcaption><span class="h-legend-median">Historical median</span><span class="h-legend-band">Middle 50% of outcomes</span>' + (current.length ? '<span class="h-legend-current">' + study.comparison.year + ' held-out comparison</span>' : '') + '</figcaption><p class="h-caption">Vertical axis: price return from the prior close (%). Calendar windows align by calendar progress; Santa and post-midterm windows by trading sessions. The band shows past dispersion, not a forecast. ' + sample.n + ' completed observations · ' + escape(rangeLabel()) + '.</p></figure>';
  }
  function barChart(rows, labels, title) {
    const vals = rows.map(r => r.meanPct ?? r.returnPct).filter(Number.isFinite);
    if (!vals.length) return '<div class="h-empty">No completed observations available for this chart.</div>';
    let low = Math.min(0, ...vals), high = Math.max(0, ...vals);
    if (low === high) { low = -.5; high = .5; }
    const span = high - low, digits = Math.min(4, Math.max(1, Math.ceil(-Math.log10(span)) + 1));
    const y = v => 169 - (v - low) / span * 143, step = 618 / rows.length;
    const hover = chartHover(rows.flatMap((r, i) => {
      const v = r.meanPct ?? r.returnPct;
      if (!Number.isFinite(v)) return [];
      return [{ x: 58 + i * step + step * .5, y: y(v), label: String(labels[i] ?? '') + '\n' + pct(v) + (r.n != null ? '\n' + r.n + ' observations' : '') }];
    }));
    return '<figure class="h-figure"><svg viewBox="0 0 704 224" role="img" aria-label="' + escape(title) + '"' + hover + '><text x="50" y="30" text-anchor="end">' + number(high, digits) + '%</text><text x="50" y="173" text-anchor="end">' + number(low, digits) + '%</text><line class="h-zero" x1="58" x2="676" y1="' + y(0) + '" y2="' + y(0) + '"/>' + rows.map((r, i) => {
      const v = r.meanPct ?? r.returnPct, px = 58 + i * step + step * .15;
      if (!Number.isFinite(v)) return '';
      return '<rect class="' + (v >= 0 ? 'h-bar-pos' : 'h-bar-neg') + '" x="' + px + '" y="' + Math.min(y(0), y(v)) + '" width="' + Math.max(1, step * .7) + '" height="' + Math.abs(y(v) - y(0)) + '"></rect>' + (rows.length <= 15 || i % 3 === 0 ? '<text x="' + (px + step * .35) + '" y="191" text-anchor="middle">' + escape(labels[i]) + '</text>' : '');
    }).join('') + '<text x="367" y="217" text-anchor="middle">' + (rows.length === 12 && rows[0].month ? 'Calendar month' : 'Window anchor year') + '</text></svg><figcaption>' + escape(title) + ' · vertical axis: price return (%)</figcaption></figure>';
  }
  function exportCsv() {
    const index = state.data?.indexes[state.symbol], study = index?.studies.find(s => s.id === state.study), sample = study?.ranges[state.range];
    if (!sample) return;
    const rows = [['symbol', 'pattern', 'sample', 'year', 'baseline_close_date', 'first_session', 'last_session', 'sessions', 'price_return_pct', 'max_drawdown_pct', 'held_out', 'complete'], ...sample.years.map(e => [state.symbol, study.id, state.range, e.year, e.baseline, e.start, e.end, e.sessions, e.returnPct, e.drawdownPct, false, true])];
    if (study.comparison.path.length) { const e = study.comparison; rows.push([state.symbol, study.id, state.range, e.year, e.baseline, e.start, e.end, e.sessions, e.returnPct, e.drawdownPct, true, e.complete]); }
    const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = host.URL.createObjectURL(new host.Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = doc.createElement('a'); a.href = url; a.download = 'historical-' + state.symbol + '-' + study.id + '.csv'; a.click(); host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
  }
  function bind() {
    if (state.bound || !root()) return;
    state.bound = true; restore();
    const refreshFreshness = () => { if (state.data && !state.pending && !doc.hidden && root()?.closest('.page-pane')?.hidden === false) render(); };
    host.addEventListener('focus', refreshFreshness);
    doc.addEventListener('visibilitychange', refreshFreshness);
    root().addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (['studies','context','sources'].includes(button.dataset.historyView)) { state.view = button.dataset.historyView; save(); render(); }
      if (button.dataset.historyStudy) { state.study = button.dataset.historyStudy; save(); render(); const next = root().querySelector('[data-history-study="' + state.study + '"]'); if (next) next.focus({ preventScroll: true }); }
      if (button.hasAttribute('data-history-retry')) load(true);
      if (button.hasAttribute('data-history-export')) exportCsv();
    });
    root().addEventListener('change', event => {
      const key = event.target.getAttribute('data-history-control');
      if (key === 'symbol' || key === 'range' || key === 'context') { state[key] = event.target.value; save(); render(); root().querySelector('[data-history-control="' + key + '"]')?.focus({ preventScroll: true }); }
    });
  }
  function render() {
    const el = root(); if (!el) return;
    const oldLibrary = el.querySelector('.h-library');
    if (oldLibrary) state.libraryScroll = oldLibrary.scrollTop;
    if (!options.owner()) { el.innerHTML = '<p class="h-empty">An Owner session is required to open Historical Data.</p>'; return; }
    if (state.pending) { el.innerHTML = '<p class="h-empty" role="status">Loading historical market studies…</p>'; return; }
    if (state.error) { el.innerHTML = '<div class="h-empty" role="alert"><h3>Historical Data is unavailable</h3><p>' + escape(state.error) + '</p><button type="button" class="book-more" data-history-retry>Try again</button></div>'; return; }
    const data = state.data;
    if (!data) return;
    scheduleFreshness(data);
    const notice = snapshotNotice(data);
    if (state.view === 'sources') { el.innerHTML = viewTabs() + notice + sourceView(data); return; }
    if (state.view === 'context') { el.innerHTML = viewTabs() + notice + contextView(data); return; }
    const available = Object.keys(data.indexes);
    if (!available.length) { el.innerHTML = viewTabs() + '<div class="h-empty"><h3>Historical coverage is not ready</h3><p>No market currently meets the ten-year history requirement. Inspect Sources & coverage for actual dates and failures. Missing data is not a zero return.</p><button type="button" class="book-more" data-history-retry>Check again</button></div>'; return; }
    if (!available.includes(state.symbol)) state.symbol = available[0];
    const index = data.indexes[state.symbol], study = index.studies.find(s => s.id === state.study) || index.studies.find(s => s.id === 'q4') || index.studies[0];
    if (!study) { el.innerHTML = '<p class="h-empty">No study definitions are available in this snapshot.</p>'; return; }
    state.study = study.id;
    const sample = study.ranges[state.range], compare = study.comparison, at = sample.comparisonAtProgress, cur = index.current;
    const age = Math.max(index.ageDays || 0, observationAge(cur.asOf)), stale = age > 4;
    const sourceUrl = 'https://finance.yahoo.com/quote/' + encodeURIComponent(state.symbol) + '/history/';
    const controls = '<div class="h-toolbar"><label>Market<select data-history-control="symbol">' + available.map(s => '<option' + (s === state.symbol ? ' selected' : '') + ' value="' + escape(s) + '">' + escape(s + ' · ' + data.indexes[s].label) + '</option>').join('') + '</select></label><label>Historical sample<select data-history-control="range">' + [['all', 'All available'], ['20y', 'Last 20 years'], ['10y', 'Last 10 years']].map(([k, v]) => '<option value="' + k + '"' + (k === state.range ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label><button type="button" class="book-more" data-history-retry>Refresh snapshot</button></div>';
    const library = ['Seasonal', 'Election cycle'].map(group => '<h4>' + group + '</h4>' + index.studies.filter(s => s.group === group).map(s => '<button type="button" class="h-study-button' + (s.id === study.id ? ' is-selected' : '') + '" data-history-study="' + s.id + '" aria-pressed="' + (s.id === study.id) + '"><span>' + escape(s.name) + '</span><small>' + escape(status(s.comparison.status)) + '</small></button>').join('')).join('');
    const rows = [...sample.years].reverse();
    el.innerHTML = viewTabs() + notice + controls + (index.assetClass !== 'US stocks' ? '<p class="h-caption">' + escape(index.assetClass) + ' fund: equity-market sayings below are calendar comparisons for this asset, not assumed effects. Fund prices exclude cash distributions; commodity futures funds include roll effects.</p>' : '') + (stale ? '<p class="h-notice" role="status">Close history is ' + number(age, 0) + ' calendar days behind the completed-close cutoff. Current comparisons are stale.</p>' : '') +
      '<div class="h-context"><div><span class="h-kicker">' + (stale ? 'Last available completed-close conditions' : 'Current completed-close conditions') + '</span><h3>' + state.symbol + ' · ' + escape(cur.asOf) + '</h3><small>' + escape(index.firstDate) + ' to ' + escape(index.asOf) + ' · ' + index.sessions.toLocaleString() + ' available sessions</small></div><div class="h-metrics h-context-metrics">' + metric('Year to date', pct(cur.ytdPct), '', sign(cur.ytdPct)) + metric('63-session return', pct(cur.trend63Pct), '', sign(cur.trend63Pct)) + metric('20-session volatility', number(cur.volatility20Pct) + '%', 'Annualized realized') + metric('Drawdown', pct(cur.drawdown252Pct), 'From trailing 252-session high') + '</div></div>' +
      '<div class="h-layout"><aside class="h-library" aria-label="Historical pattern library"><h3>Pattern library</h3><p>Choose a claim. Inspect the record.</p>' + library + '</aside><div class="h-detail"><header class="h-study-head"><div><span class="h-kicker">' + escape(study.group) + ' · ' + escape(sample.evidence) + '</span><h3>' + escape(study.name) + '</h3></div><button type="button" class="book-more" data-history-export>Export observations</button></header><p class="h-claim">' + escape(study.claim) + '</p><p class="h-definition">' + escape(study.definition) + '</p>' +
      '<div class="h-metrics">' + metric('Historical mean', pct(sample.meanPct), 'Across completed windows', sign(sample.meanPct)) + metric('Historical median', pct(sample.medianPct), 'Less sensitive to outliers', sign(sample.medianPct)) + metric('Positive windows', number(sample.positivePct, 0) + '%', sample.n + ' observations') + metric('Observed range', sample.n ? pct(sample.worstPct) + ' to ' + pct(sample.bestPct) : '—', 'Worst to best full-window return') + '</div>' +
      (sample.n < 10 ? '<p class="h-notice">Small sample: only ' + sample.n + ' completed observations. Election-cycle studies have few independent years. No statistical confidence claim is made.</p>' : '<p class="h-caption">Early-half mean ' + pct(sample.earlyMeanPct) + ' · later-half mean ' + pct(sample.lateMeanPct) + (sample.meanRange95 ? ' · rough 95% mean interval ' + pct(sample.meanRange95[0]) + ' to ' + pct(sample.meanRange95[1]) : '') + '. Many patterns are being examined; these intervals are not adjusted for multiple comparisons.</p>') +
      '<section class="h-comparison"><span class="h-kicker">' + compare.year + ' comparison · ' + escape(status(compare.status)) + '</span>' + (compare.path.length ? '<p><b class="' + sign(compare.returnPct) + '">' + pct(compare.returnPct) + '</b> from ' + escape(compare.baseline) + ' through ' + escape(compare.end) + ' · ' + compare.sessions + ' completed sessions. This occurrence is excluded from historical statistics.</p>' + (at ? '<p>At the same ' + number(at.progress, 0) + '% of the window, the historical median was <b>' + pct(at.medianPct) + '</b>. This comparison is at the ' + number(at.percentile, 0) + 'th empirical percentile of the ' + sample.n + ' prior outcomes at that stage.</p>' : '') : '<p>' + (compare.status === 'upcoming' ? 'This window has not started. Expected start: ' + escape(compare.expectedStart) + '. No current-period return is shown.' : 'A reliable window comparison cannot be formed from the available closes. No return is inferred.') + '</p>') + '</section>' +
      lineChart(study, sample) + '<p class="h-caption">Typical ' + (sample.baseline.sessions || 'same-length') + '-session blocks averaged ' + pct(sample.baseline.meanPct) + ' (' + sample.baseline.n + ' non-overlapping blocks). A positive seasonal return alone does not establish outperformance over normal market drift.</p>' +
      '<details class="h-disclosure" open><summary>Every completed historical outcome</summary>' + barChart(sample.years, sample.years.map(e => e.year), 'Full-window return by anchor year') + '<div class="h-table-wrap"><table class="h-table"><thead><tr><th scope="col">Anchor year</th><th scope="col">Prior close → last close</th><th scope="col">Sessions</th><th scope="col">Return</th><th scope="col">Max drawdown</th></tr></thead><tbody>' + (rows.length ? rows.map(e => '<tr><th scope="row">' + e.year + '</th><td>' + escape(e.baseline) + ' → ' + escape(e.end) + '</td><td>' + e.sessions + '</td><td class="' + sign(e.returnPct) + '">' + pct(e.returnPct) + '</td><td>' + pct(e.drawdownPct) + '</td></tr>').join('') : '<tr><td colspan="5">No completed historical outcomes in this sample.</td></tr>') + '</tbody></table></div></details></div></div>' +
      '<details class="h-disclosure"><summary>All twelve calendar months · full available history</summary>' + barChart(index.monthly, ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], 'Mean monthly price return · prior complete calendar years') + '<p class="h-caption">Each month uses its own completed observations; the current year is held out. Monthly sample counts: ' + index.monthly.map(m => m.month + ': ' + m.n).join(' · ') + '. This overview uses full history independently of the selected study lookback.</p></details>' +
      '<details class="h-disclosure"><summary>Weekdays, turn of month and expiration week</summary><p class="h-caption">Full available history, prior complete calendar years. Session and month counts are correlated and are not independent annual samples. Expiration week is a third-Friday calendar proxy, not actual historical option-chain data.</p><div class="h-table-wrap"><table class="h-table"><thead><tr><th>Window</th><th>Observations</th><th>Mean return</th><th>Median return</th><th>Positive</th></tr></thead><tbody>'+index.recurring.map(r=>'<tr><th scope="row">'+escape(r.label)+'</th><td>'+r.n+' '+escape(r.unit)+'</td><td>'+pct(r.meanPct)+'</td><td>'+pct(r.medianPct)+'</td><td>'+number(r.positivePct,0)+'%</td></tr>').join('')+'</tbody></table></div></details>' +
      '<details class="h-disclosure"><summary>Similar calendar dates and market conditions</summary><p class="h-caption">Five closest prior-year snapshots on this month/day, ranked by trailing 63-session return and 20-session realized volatility. ' + index.analogs.eligible + ' eligible years. Outcomes did not influence selection; these are historical observations, not a forecast. This comparison uses full available history.</p><div class="h-table-wrap"><table class="h-table"><thead><tr><th scope="col">Snapshot</th><th scope="col">63-session trend</th><th scope="col">20-session vol.</th><th scope="col">Next 20 sessions</th><th scope="col">Next 63 sessions</th></tr></thead><tbody>' + (index.analogs.rows.length ? index.analogs.rows.map(a => '<tr><th scope="row">' + escape(a.date) + '</th><td>' + pct(a.trend63Pct) + '</td><td>' + number(a.volatility20Pct) + '%</td><td class="' + sign(a.next20Pct) + '">' + pct(a.next20Pct) + '</td><td class="' + sign(a.next63Pct) + '">' + pct(a.next63Pct) + '</td></tr>').join('') : '<tr><td colspan="5">Not enough comparable prior-year history.</td></tr>') + '</tbody></table></div></details>' +
      '<details class="h-disclosure"><summary>Market lore · not tested here</summary>' + data.lore.map(l => '<p><b>' + escape(l.name) + '</b> · ' + escape(l.label) + '<br>' + escape(l.reason) + '</p>').join('') + '</details>' +
      '<details class="h-disclosure"><summary>Sources, definitions and limitations</summary><p><a href="' + sourceUrl + '" target="_blank" rel="noopener">' + escape(data.source.name) + '</a></p><p>' + escape(data.source.returnType) + '</p><ul>' + data.methodology.map(m => '<li>' + escape(m) + '</li>').join('') + '</ul><p>Data cache built: ' + escape(data.sourceBuiltAtIso || 'not recorded') + '. Study built: ' + escape(data.builtAtIso) + '.</p><p>Past observations do not establish causation or predict future returns. “Observed tendency” describes consistency within this sample, not a validated trading edge.</p></details>';
    const libraryEl = el.querySelector('.h-library');
    if (libraryEl) {
      libraryEl.scrollTop = state.libraryScroll;
      const active = libraryEl.querySelector('.is-selected');
      if (active && libraryEl.scrollHeight > libraryEl.clientHeight) {
        const delta = active.getBoundingClientRect().bottom - libraryEl.getBoundingClientRect().bottom;
        if (delta > 0) libraryEl.scrollTop += delta + 8;
      }
    }
  }
  async function load(force = false) {
    bind();
    if (!options.owner()) { render(); return; }
    if (state.pending || (state.data && !force)) { render(); return; }
    state.pending = true; state.error = null; render();
    try {
      const response = await host.fetch(options.url(), { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your Owner session is no longer available. Sign in again.' : response.status === 404 ? 'The first Historical Data snapshot has not been published yet. It is produced by a full market build.' : 'The snapshot could not be read. Try again.');
      const data = decode(await response.json());
      if (!valid(data)) throw new Error('The snapshot is incomplete or uses an unsupported format. Refresh after the next full market build.');
      state.data = data;
    } catch (error) { state.error = error.message || 'Historical Data could not be loaded.'; }
    finally { state.pending = false; render(); }
  }
  return { load };
}

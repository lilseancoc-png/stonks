// Owner-only lazy view. Stores display preferences, never decision payloads.
export function unifiedSignalClientFactory(host, doc, options, policy) {
  const state = { data: null, loading: false, error: '', symbol: '', query: '', filter: 'all', view: 'decision', bound: false, timer: null, records: {} };
  const VIEWS = ['decision','evidence','prices','vehicles','record'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const num = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : 'Unavailable';
  const pct = value => typeof value === 'number' && Number.isFinite(value) ? (value > 0 ? '+' : '') + num(value) + '%' : 'Unavailable';
  const root = () => doc.getElementById('unified-signal-root');
  const currentStatus = row => policy.status(row, state.data, Date.now(), !!state.error);
  const entryBlocks = row => row.status === 'eligible' && currentStatus(row) !== 'eligible'
    ? ['Refresh the published snapshot before considering an entry. The prior entry check is expired or could not be revalidated.', ...row.blocks] : row.blocks;
  const money = (value, currency) => typeof value !== 'number' || !Number.isFinite(value) ? 'Unavailable' : num(value) + (currency ? ' ' + currency : ' · currency unverified');
  const time = value => { if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value + ' · date only'; const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Time unverified'; };
  function save() { try { host.localStorage.setItem('stonks-unified-view', JSON.stringify({ symbol: state.symbol, filter: state.filter, view: state.view })); } catch {} }
  function restore() {
    try {
      const saved = JSON.parse(host.localStorage.getItem('stonks-unified-view') || '{}');
      if (typeof saved.symbol === 'string' && /^[A-Z][A-Z0-9.]{0,5}$/.test(saved.symbol)) state.symbol = saved.symbol;
      if (['all','eligible','wait','watch','avoid','insufficient-data'].includes(saved.filter)) state.filter = saved.filter;
      if (VIEWS.includes(saved.view)) state.view = saved.view;
    } catch {}
  }
  const pill = (label, tone) => '<span class="use-tag use-tone-' + esc(tone || 'context') + '">' + esc(label) + '</span>';
  const list = (items, empty) => items.length ? '<ul class="use-notes">' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>' : empty ? '<p class="use-muted">' + esc(empty) + '</p>' : '';
  function evidenceItem(item) {
    const url = typeof item.url === 'string' && item.url.startsWith('https://') ? item.url : null;
    const sourceName = ({'grades.json':'Existing grade rubric','quant.json':'Quant Lab','link-map.json':'Company relationships','market-analysis.json':'Market Analysis','sector-rotation.json':'Sector Rotation'})[item.source] || item.source;
    return '<article class="use-observation"><div class="use-observation-head">' + pill(item.family, item.effect) + (item.unavailable ? pill('Unavailable','context') : '') + '</div><h4>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.title) + '</a>' : esc(item.title)) + '</h4><p>' + esc(item.detail) + '</p><small>' + esc(sourceName) + ' · ' + esc(time(item.asOf)) + (item.timeBasis === 'computed-assessment' ? ' · computed assessment; underlying publication times vary' : '') + '</small></article>';
  }
  function decisionView(row) {
    const support = row.evidence.filter(e => e.effect === 'supports' && !e.unavailable).slice(0, 4);
    const opposing = row.evidence.filter(e => e.effect === 'opposes' && !e.unavailable).slice(0, 4);
    return '<div class="use-answer"><h3>What is the opportunity?</h3><p>' + esc(row.summary) + '</p><p class="use-muted">' + esc(state.data.horizon.label) + '. The grade ranks existing research; it is not a win probability.</p></div>' +
      (row.thesis.summary ? '<section class="use-answer"><h3>Existing owner thesis</h3><p>' + esc(row.thesis.summary) + '</p><p class="use-muted">' + esc(row.thesis.source) + '. This interpretation is not additional independent evidence.</p></section>' : '') +
      '<div class="use-evidence-pair"><section><h3>What supports it</h3>' + (support.length ? support.map(evidenceItem).join('') : '<p class="use-muted">No supporting rubric contribution is available.</p>') + '</section><section><h3>What challenges it</h3>' + (opposing.length ? opposing.map(evidenceItem).join('') : '<p class="use-muted">No opposing rubric contribution is recorded. That does not establish certainty.</p>') + '</section></div>' +
      '<section class="use-answer"><h3>What keeps this from an entry?</h3>' + list(entryBlocks(row), 'The published owner entry checks qualified this idea at build time. Check the current market and account risk before acting.') + '</section>' +
      '<section class="use-answer"><h3>How uncertain is the assessment?</h3><p>' + esc(row.uncertainty.disagreement) + '</p>' + list(row.uncertainty.missing, 'The core connected sources are present. Predictive skill is still unproven.') + '<p class="use-muted">' + esc(row.uncertainty.dependency) + '</p><p>' + esc(row.uncertainty.accountFit) + '</p></section>' +
      '<section class="use-answer"><h3>What changes the decision?</h3><p>' + (row.plan.invalidation ? 'Review the thesis at ' + esc(money(row.plan.invalidation, row.quote.currency)) + '. ' : '') + esc(row.review.next) + '</p>' + list(row.review.invalidators,'') + '<p class="use-muted">' + esc(row.plan.warning) + '</p></section>' +
      '<section class="use-answer"><h3>What changed since the prior snapshot?</h3>' + list(row.changes.items, row.changes.firstObservation ? 'This is the first saved assessment for this ticker.' : 'No tracked direction, policy-state, grade, price, or observation change.') + '</section>';
  }
  function evidenceView(row) {
    return '<p class="use-muted">The existing rubric determines support and opposition. Raw measurements, desk summaries and relationship links are context, so the same underlying evidence is not added again.</p>' +
      [['supports','Supports the thesis'],['opposes','Opposes the thesis'],['context','Measurements and related context']].map(([effect,label]) => {
        const items = row.evidence.filter(e => e.effect === effect);
        return items.length ? '<details class="use-disclosure" data-use-details="' + effect + '"' + (effect !== 'context' ? ' open' : '') + '><summary data-use-disclosure="' + effect + '">' + esc(label) + ' · ' + items.length + '</summary><div class="use-evidence-grid">' + items.map(evidenceItem).join('') + '</div></details>' : '';
      }).join('');
  }
  function pricesView(row) {
    const q = row.quote, p = row.plan, v = row.valuation;
    return '<section class="use-answer"><span class="use-kicker">Market observation</span><h3>Observed stock price · ' + esc(money(q.value, q.currency)) + '</h3><p>' + esc(q.basis) + '</p><dl class="use-facts"><div><dt>Provider / field</dt><dd>' + esc(q.provider) + ' · ' + esc(q.field || 'Selected field unverified') + '</dd></div><div><dt>Market observation time</dt><dd>' + esc(time(q.asOf)) + '</dd></div><div><dt>Retrieved</dt><dd>' + esc(time(q.fetchedAt)) + '</dd></div><div><dt>Session / exchange</dt><dd>' + esc(q.marketState || 'Unverified') + ' · ' + esc(q.exchange || 'Unverified') + '</dd></div></dl><p>' + esc(q.reason) + '</p>' + (q.fallback ? '<p>' + esc(q.fallback) + '</p>' : '') + '</section>' +
      '<section class="use-answer"><span class="use-kicker">Entry and structure</span><h3>Proposed trade levels</h3><dl class="use-facts"><div><dt>Entry reference</dt><dd>' + esc(money(p.entry, q.currency)) + '</dd></div><div><dt>Technical objective</dt><dd>' + esc(money(p.target, q.currency)) + '</dd></div><div><dt>Invalidation</dt><dd>' + esc(money(p.invalidation, q.currency)) + '</dd></div><div><dt>Reference reward / risk</dt><dd>' + (p.valid ? (p.riskReward < 1.5 ? 'Below 1.5:1' : esc(num(p.riskReward)) + ':1') : 'Unavailable') + '</dd></div></dl><p>' + esc(p.method || 'No qualified technical target method') + (p.anchor ? ' · ' + esc(p.anchor) : '') + '. A technical objective is not independent fair value.</p></section>' +
      '<section class="use-answer"><span class="use-kicker">Conditional paths</span><h3>Forecast and market stress</h3><p>A calibrated stock forecast is not available. ' + esc(row.stress.label) + (row.stress.horizon ? ' · ' + esc(row.stress.horizon) : '') + '.</p>' + (row.stress.paths.length ? '<div class="use-table-wrap"><table class="use-table"><thead><tr><th>Macro scenario</th><th>Low stock price</th><th>High stock price</th></tr></thead><tbody>' + row.stress.paths.map(path => '<tr><td>' + esc(path.name) + '</td><td>' + esc(money(path.low,q.currency)) + '</td><td>' + esc(money(path.high,q.currency)) + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</section>' +
      '<section class="use-answer"><span class="use-kicker">Business valuation</span><h3>Independent fair value is not estimated</h3><p>' + esc(v.explanation) + '</p>' + (v.analystMean > 0 ? '<p>External analyst mean: ' + esc(money(v.analystMean,q.currency)) + '. Low: ' + esc(money(v.analystLow,q.currency)) + '. High: ' + esc(money(v.analystHigh,q.currency)) + '. ' + (v.analystCount ? esc(v.analystCount) + ' analysts. ' : '') + 'Target publication times are unverified.</p>' : '') + '</section>' +
      '<section class="use-answer"><span class="use-kicker">Option premium</span><h3>Entry costs and modeled exit values</h3><p>The trade comparison separates quote-based entry assumptions from theoretical liquidation scenarios. Per-contract quote times remain unverified.</p><button type="button" class="use-text-button" data-use-view="vehicles">Open trade comparison</button></section>';
  }
  function vehiclesView(row) {
    const shares = row.vehicles.choices.find(v => v.kind === 'shares'), option = row.vehicles.choices.find(v => v.kind === 'option');
    const allowed = currentStatus(row) === 'eligible';
    const flat = option.scenarios.find(s => s.label === 'iv-flat');
    const quoteDetails = option.legs.length ? '<div class="use-table-wrap"><table class="use-table"><thead><tr><th>Option leg</th><th>Strike</th><th>Recorded bid</th><th>Recorded ask</th></tr></thead><tbody>' + option.legs.map(leg => '<tr><td>' + esc((leg.qty > 0 ? 'Long ' : 'Short ') + leg.type) + '</td><td>' + esc(num(leg.strike)) + '</td><td>' + esc(money(leg.bid,row.quote.currency)) + '</td><td>' + esc(money(leg.ask,row.quote.currency)) + '</td></tr>').join('') + '</tbody></table></div>'
      : option.entryPerShare > 0 ? '<p>Recorded bid: ' + esc(money(option.bid,row.quote.currency)) + '. Recorded ask: ' + esc(money(option.ask,row.quote.currency)) + '.</p>' : '';
    return '<p>' + esc(allowed ? row.vehicles.reason : 'No new entry is qualified in this view. Cash remains the current action; conditional payoffs are research context.') + '</p><div class="use-table-wrap"><table class="use-table"><thead><tr><th>Expression</th><th>Policy state</th><th>Return basis</th><th>At stock objective</th><th>At invalidation</th></tr></thead><tbody>' +
      '<tr><th>' + esc(shares.label) + '</th><td>' + (allowed && shares.eligible ? 'Qualified at build' : 'Research only') + '</td><td>Stock capital, before costs</td><td>' + esc(pct(shares.targetReturnPct)) + '</td><td>' + esc(pct(shares.invalidationReturnPct)) + '</td></tr>' +
      '<tr><th>' + esc(option.label) + '</th><td>' + (allowed && option.eligible ? 'Qualified at build' : 'Not qualified') + '</td><td>Maximum quoted option loss · IV flat</td><td>' + esc(pct(flat?.atTargetPctOfRisk)) + '</td><td>' + esc(pct(flat?.atInvalidationPctOfRisk)) + '</td></tr>' +
      '<tr><th>Keep cash</th><td>Available</td><td>No trade; cash yield not modeled</td><td>No stock exposure</td><td>No stock exposure</td></tr></tbody></table></div><p class="use-muted">The denominators differ. Stock returns use invested capital; option returns use maximum quoted loss. These conditional outcomes are not probability-weighted expected returns.</p>' +
      '<section class="use-answer"><h3>Shares</h3><p>' + esc(shares.detail) + '</p><p>' + esc(row.plan.warning) + '</p></section>' +
      '<section class="use-answer"><h3>' + esc(option.label) + '</h3><p>' + esc(option.detail) + '</p>' + (option.entryPerShare > 0 ? '<dl class="use-facts"><div><dt>' + (option.structure === 'credit_vertical' ? 'Entry credit per share' : 'Entry debit per share') + '</dt><dd>' + esc(money(option.entryPerShare,row.quote.currency)) + '</dd></div><div><dt>Maximum quoted loss per contract</dt><dd>' + esc(money(option.maximumLossPerContract,row.quote.currency)) + '</dd></div><div><dt>Strike / expiration</dt><dd>' + esc(num(option.strike)) + ' / ' + esc(option.expiry ? new Date(option.expiry * 1000).toISOString().slice(0,10) : 'Unverified') + '</dd></div><div><dt>Fees</dt><dd>' + (option.feesEstimated ? 'Included in modeled economics' : 'Not estimated') + '</dd></div></dl>' : '') + quoteDetails +
      (option.scenarios.length ? '<div class="use-table-wrap"><table class="use-table"><thead><tr><th>IV assumption</th><th>At stock objective · % of maximum loss</th><th>At invalidation · % of maximum loss</th></tr></thead><tbody>' + option.scenarios.map(s => '<tr><td>' + esc(s.label) + '</td><td>' + esc(pct(s.atTargetPctOfRisk)) + '</td><td>' + esc(pct(s.atInvalidationPctOfRisk)) + '</td></tr>').join('') + '</tbody></table></div><p class="use-muted">' + esc(option.model) + ' · ' + esc(option.horizonDays) + ' calendar days. IV stresses have no probabilities.</p>' : '') + list(option.limitations, '') + '</section><section class="use-answer"><h3>Does an attractive risk-adjusted opportunity exist?</h3><p>' + (allowed ? 'The existing entry and feasibility policy qualified this setup at build time. A positive expected return is not established.' : 'Current checks do not qualify a new entry. Review the blocks on the Decision view.') + '</p><p>' + esc(row.uncertainty.accountFit) + '</p></section>';
  }
  // Company record: the grade breakdown plus the stored evidence record,
  // relationships and AI grader log for this one ticker (the per-company half
  // of Owner Lab Diagnostics). Loaded once per ticker per snapshot.
  function recordView(row) {
    const cached = state.records[row.symbol];
    return '<p class="use-muted">The stored records behind this ticker, read from the latest daily build. Nothing here feeds back into the live grade, and opening it runs no new analysis.</p>' +
      '<div class="use-record" data-use-record="' + esc(row.symbol) + '">' + (cached || '<p class="use-muted" role="status">Loading the stored records for ' + esc(row.symbol) + '…</p>') + '</div>';
  }
  function fillRecord(symbol) {
    if (state.records[symbol] || !options.record) return;
    Promise.resolve(options.record(symbol)).then(html => {
      state.records[symbol] = html;
      const box = root()?.querySelector('[data-use-record="' + symbol + '"]');
      if (box) box.innerHTML = html;
    }, () => {
      const box = root()?.querySelector('[data-use-record="' + symbol + '"]');
      if (box) box.innerHTML = '<p class="use-muted">The stored records could not be loaded. Try Refresh snapshot.</p>';
    });
  }
  function render() {
    const target = root();
    if (!target) return;
    const libraryScroll = target.querySelector('.use-library')?.scrollTop || 0;
    const disclosures = Array.from(target.querySelectorAll('[data-use-details]')).map(el => [el.getAttribute('data-use-details'), el.open]);
    const focused = target.contains(doc.activeElement) ? doc.activeElement : null;
    const focusAttribute = ['data-use-view','data-use-symbol','data-use-refresh','data-use-search','data-use-filter','data-use-disclosure'].find(attribute => focused?.hasAttribute(attribute));
    const focusValue = focusAttribute ? focused.getAttribute(focusAttribute) : null;
    if (!state.data) {
      target.innerHTML = '<div class="use-empty" role="status"><h3>' + (state.loading ? 'Loading the decision snapshot' : 'Decision snapshot unavailable') + '</h3><p>' + esc(state.error || 'The first snapshot is published with an 11:00 or 15:30 ET decision build.') + '</p>' + (!state.loading ? '<button type="button" class="use-button" data-use-refresh>Try again</button>' : '') + '</div>';
      return;
    }
    const expired = policy.expired(state.data), all = state.data.decisions;
    const visible = all.filter(row => (state.filter === 'all' || currentStatus(row) === state.filter) && (!state.query || (row.symbol + ' ' + (row.sector || '')).toLowerCase().includes(state.query.toLowerCase())));
    let selected = visible.find(row => row.symbol === state.symbol) || visible[0];
    if (selected) state.symbol = selected.symbol;
    const quoteExpired = selected?.status === 'eligible' && currentStatus(selected) === 'wait';
    const notices = state.error ? '<p class="use-notice" role="alert">' + esc(state.error) + ' Previous snapshot is reference only.</p>' : expired || quoteExpired ? '<p class="use-notice" role="status">Reference snapshot. The entry check has expired or the regular session has closed. Refresh checks for a newer published decision; it does not fetch live quotes.</p>' : '';
    target.innerHTML = '<div class="use-toolbar"><label>Find ticker or sector<input type="search" data-use-search value="' + esc(state.query) + '" placeholder="Search symbols" autocomplete="off"></label><label>Show<select data-use-filter>' + [['all','All research'],['eligible','Entry qualified'],['wait','Waiting'],['watch','Research watch'],['avoid','Avoid'],['insufficient-data','Missing data']].map(([value,label]) => '<option value="' + value + '"' + (state.filter === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><button type="button" class="use-button" data-use-refresh' + (state.loading ? ' disabled' : '') + '>' + (state.loading ? 'Checking…' : 'Refresh snapshot') + '</button></div>' +
      '<p class="use-snapshot-meta" role="status">' + visible.length + ' of ' + all.length + ' tickers · ' + esc(time(state.data.builtAtIso)) + ' · ' + esc(state.data.cadence) + '</p>' + notices +
      (selected ? '<div class="use-layout"><aside class="use-library" aria-label="Unified Signal Engine research list">' + visible.map(row => '<button type="button" data-use-symbol="' + esc(row.symbol) + '" class="use-candidate' + (row.symbol === selected.symbol ? ' is-selected' : '') + '" aria-pressed="' + (row.symbol === selected.symbol) + '"><span><b>' + esc(row.symbol) + '</b><small>' + esc(row.direction) + '</small></span><small>' + esc(policy.label(currentStatus(row))) + '</small></button>').join('') + '</aside><section class="use-detail" aria-label="Ticker assessment"><header class="use-decision-head"><div><span class="use-kicker">' + esc(state.data.horizon.label) + '</span><h3>' + esc(selected.symbol) + ' <span>' + esc(selected.direction) + '</span></h3><p>' + esc(selected.sector || 'Sector unverified') + '</p></div><div>' + pill(policy.label(currentStatus(selected)), currentStatus(selected)) + '<p class="use-price">' + esc(money(selected.quote.value,selected.quote.currency)) + '</p></div></header><nav class="use-view-tabs" aria-label="Assessment views">' + [['decision','Decision'],['evidence','Evidence'],['prices','Price explanations'],['vehicles','Trade comparison'],['record','Company record']].map(([view,label]) => '<button type="button" data-use-view="' + view + '" aria-pressed="' + (state.view === view) + '">' + label + '</button>').join('') + '</nav><div class="use-view">' + (state.view === 'evidence' ? evidenceView(selected) : state.view === 'prices' ? pricesView(selected) : state.view === 'vehicles' ? vehiclesView(selected) : state.view === 'record' ? recordView(selected) : decisionView(selected)) + '</div></section></div>' : '<div class="use-empty"><h3>No matching research</h3><p>Change the ticker search or policy filter to inspect other assessments.</p></div>') +
      '<footer class="use-footer"><p>' + esc(state.data.validation) + ' No live account sizing or order execution is connected.</p><details><summary>Method and saved decision</summary><p>' + esc(state.data.ranking) + '</p><p>Shared evidence is shown once in the rubric. Measurements and related desks remain context. Policy eligibility comes from a matching current owner trade and cannot override its entry or risk gates.</p><p>Snapshot ' + esc(state.data.snapshotId) + '</p><p>Engine ' + esc(state.data.engineVersion) + ' · entry policy ' + esc(state.data.entryPolicyVersion) + '</p></details></footer>';
    if (selected && state.view === 'record') fillRecord(selected.symbol);
    const library = target.querySelector('.use-library');
    if (library) library.scrollTop = libraryScroll;
    for (const [key,open] of disclosures) {
      const disclosure = target.querySelector('[data-use-details="' + key + '"]');
      if (disclosure) disclosure.open = open;
    }
    if (focusAttribute) target.querySelector('[' + focusAttribute + '="' + focusValue + '"]')?.focus({preventScroll:true});
    host.clearTimeout(state.timer);
    if (!expired && !doc.hidden) {
      const deadlines = [Date.parse(state.data.validUntil)].concat(all.map(row => Date.parse(row.quote.validUntil || '')).filter(ms => ms > Date.now()));
      state.timer = host.setTimeout(() => { if (root()?.closest('.page-pane')?.hidden === false) render(); }, Math.max(1, Math.min(...deadlines) - Date.now() + 1));
    }
  }
  function bind() {
    if (state.bound || !root()) return;
    state.bound = true; restore();
    root().addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-use-refresh')) { load(true); return; }
      const selectedTicker = !!button.dataset.useSymbol;
      if (selectedTicker) state.symbol = button.dataset.useSymbol;
      if (VIEWS.includes(button.dataset.useView)) state.view = button.dataset.useView;
      save(); render();
      const nextFocus = selectedTicker ? root().querySelector('[data-use-symbol="' + state.symbol + '"]') : root().querySelector('.use-view-tabs [data-use-view="' + state.view + '"]');
      nextFocus?.focus({preventScroll:true});
      if (selectedTicker && host.innerWidth <= 700) root().querySelector('.use-decision-head')?.scrollIntoView({block:'start'});
    });
    root().addEventListener('change', event => { if (event.target.hasAttribute('data-use-filter')) { state.filter = event.target.value; save(); render(); root().querySelector('[data-use-filter]')?.focus({preventScroll:true}); } });
    root().addEventListener('input', event => {
      if (!event.target.hasAttribute('data-use-search')) return;
      state.query = event.target.value; const position = event.target.selectionStart;
      render(); const input = root().querySelector('[data-use-search]'); input.focus();
      try { input.setSelectionRange(position, position); } catch {}
    });
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden && state.data && root()?.closest('.page-pane')?.hidden === false) render(); });
  }
  async function load(force = false) {
    if (!options.owner()) return;
    bind();
    if (state.loading) return;
    if (state.data && !force) { render(); return; }
    const restoreRefreshFocus = doc.activeElement?.hasAttribute('data-use-refresh');
    const controller = new host.AbortController();
    const requestTimer = host.setTimeout(() => controller.abort(), 15000);
    if (force) state.records = {};
    state.loading = true; state.error = ''; render();
    try {
      const response = await host.fetch(options.url(), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (response.status === 401 || response.status === 403) { state.data = null; throw new Error('Owner access is required. Sign in again to view private decisions.'); }
      if (response.status === 404) throw new Error('No decision snapshot has been published yet. Check after the next 11:00 or 15:30 ET build.');
      if (!response.ok) throw new Error('The published snapshot could not be loaded. Try again.');
      let payload;
      try { payload = await response.json(); } catch { throw new Error('The published snapshot could not be read. Try again.'); }
      if (!policy.valid(payload)) throw new Error('The decision snapshot is incomplete or uses an unsupported version.');
      state.data = payload;
    } catch (error) { state.error = controller.signal.aborted ? 'The snapshot request timed out. Try again.' : error.message || 'The snapshot could not be loaded.'; }
    finally {
      host.clearTimeout(requestTimer);
      state.loading = false; render();
      if (restoreRefreshFocus) root()?.querySelector('[data-use-refresh]')?.focus({preventScroll:true});
    }
  }
  // Open one ticker on a given view (Owner Lab Diagnostics links here).
  function open(symbol, view) {
    if (typeof symbol === 'string' && /^[A-Z][A-Z0-9.]{0,5}$/.test(symbol)) { state.symbol = symbol; state.query = ''; state.filter = 'all'; }
    if (VIEWS.includes(view)) state.view = view;
    save();
    if (state.data) render();
  }
  return { load, open };
}

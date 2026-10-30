// Mounted inside the existing SEC filings page. Controls stay mounted while
// result tables change, preserving focus and text selection during searches.
export function mountOwnershipExplorer(root, data, model, state, books) {
  if (!root) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const numeric = n => model.finite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : 'Unavailable';
  const price = n => model.finite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : 'Unavailable';
  const money = n => model.finite(n) ? (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unavailable';
  const pct = n => model.finite(n) ? n.toFixed(2) + '%' : 'Unavailable';
  const types = { stock: 'Shares', call: 'Calls · underlying shares', put: 'Puts · underlying shares', principal: 'Principal amount', other: 'Other disclosure' };
  const link = (url, label) => {
    try { const u = new URL(url); if (u.protocol === 'https:' && u.hostname === 'www.sec.gov' && u.pathname.startsWith('/Archives/')) return '<a target="_blank" rel="noopener" href="' + esc(u.href) + '">' + esc(label) + '</a>'; } catch {}
    return esc(label);
  };
  const options = rows => rows.map(([v, label]) => '<option value="' + v + '">' + label + '</option>').join('');
  const fundSorts = [['aum', 'AUM estimate'], ['performancePct', 'Quarter price-return proxy'], ['reportedValue', 'Reported 13F value'], ['positionCount', 'Position count'], ['concentrationPct', 'Top 10 stock concentration'], ['filingDate', 'Filing date'], ['firm', 'Fund name']];
  const positionSorts = [['valueNow', 'Reported value'], ['sharesNow', 'Shares / amount'], ['shareChange', 'Share / amount change'], ['weightPct', 'Stock book weight'], ['performancePct', 'Fund price-return proxy'], ['aum', 'Fund AUM estimate'], ['firm', 'Fund name'], ['ticker', 'Ticker']];
  const allFunds = model.funds(data), full = allFunds.filter(f => f.complete).length;
  Object.assign(state, { mode: state.mode || 'stocks', stockQuery: state.stockQuery || '', fundQuery: state.fundQuery || '', holdingQuery: state.holdingQuery || '',
    selectedFund: state.selectedFund || '', type: state.type || 'all', status: state.status || 'held',
    fundSort: state.fundSort || 'aum', positionSort: state.positionSort || 'valueNow', direction: state.direction || 'desc', page: state.page || 1 });
  root.innerHTML = '<section class="own-explorer" aria-label="Ownership explorer"><div class="own-heading"><div><span class="f13-kicker">Who owns what</span><h3>Follow a stock. Open a fund.</h3><p>Search the full collected 13F books, including smaller and unchanged positions.</p></div><span class="own-coverage">' + full + ' / ' + allFunds.length + ' full books</span></div>' +
    '<p class="own-period">Quarter-end ' + esc(data.periodEndIso || data.periodEnd || 'unavailable') + ' · Public filings from tracked managers</p>' +
    '<details class="own-method"><summary>Coverage and calculation notes</summary><p class="f13-note">' +
    'AUM estimates come from the curated manager directory and have no verified as-of date. Reported 13F value is a separate quarter-end figure, including option underlying notionals. ' +
    (data.ownershipCoverage?.unmappedPositions ? numeric(data.ownershipCoverage.unmappedPositions) + ' positions have no resolved ticker; search issuer name or CUSIP for those disclosures. ' : '') +
    (full < allFunds.length ? 'Missing or older books are not searchable until a successful data refresh. A missing result does not establish that a fund has no position.' : '') + '</p>' +
    '<p class="f13-note">Quarter price-return proxy holds the prior 13F long stock weights constant and uses split-adjusted historical closes. Requires 80% coverage by prior stock value. It excludes dividends, trading, fees, shorts and derivatives, so it is not the fund’s return. Unknown figures sort last in either direction. Changes in reported shares are unadjusted for splits. Totals can overlap across reporting managers.</p></details>' +
    (allFunds.some(f => f.holdingsLoadFailed) ? '<p class="own-empty" role="status">Some collected book files could not load. Search results cover only the books loaded successfully. <button type="button" class="f13-action" data-f13-retry>Retry holdings</button></p>' : '') +
    '<div class="own-modes" role="group" aria-label="Search ownership by"><button type="button" data-own-mode="stocks">By stock</button><button type="button" data-own-mode="funds">By fund</button></div>' +
    '<div class="own-controls"><label class="own-search"><span id="own-search-label">Search stock, issuer or CUSIP</span><input id="own-search" type="search" autocomplete="off" spellcheck="false" placeholder="e.g. NVDA, Nvidia or a CUSIP"></label>' +
    '<label><span>Sort by</span><select id="own-sort"></select></label><label><span>Order</span><select id="own-direction"><option value="desc">Highest / newest first</option><option value="asc">Lowest / oldest first</option></select></label><button type="button" class="f13-action" data-own-clear>Clear search</button></div>' +
    '<div class="own-position-controls"><label><span>Disclosure type</span><select id="own-type">' + options([['all', 'All disclosures'], ['stock', 'Shares'], ['call', 'Calls'], ['put', 'Puts'], ['principal', 'Principal amount'], ['other', 'Other']]) + '</select></label>' +
    '<label><span>Position status</span><select id="own-status">' + options([['held', 'Held at period end'], ['all', 'Held and exited'], ['exited', 'Exited since prior quarter']]) + '</select></label></div>' +
    '<p id="own-mapping-note" class="own-source-status" hidden></p>' +
    '<div id="own-summary" role="status" aria-live="polite"></div><div id="own-results"></div><div class="own-pagination"><button type="button" class="f13-action" data-own-prev>Previous</button><span id="own-page"></span><button type="button" class="f13-action" data-own-next>Next</button><button type="button" class="f13-action" data-own-download>Download results</button></div></section>';
  const $ = selector => root.querySelector(selector);
  let currentRows = [], disclosureRows = [], downloadBusy = false;
  function sourceStatus(f) {
    let html = '';
    if (f.reportingScope === 'parent-book') html += '<small class="own-source-status">Parent portfolio reported by ' + esc(f.reportingName || f.reportingCik) + ' · CIK ' + esc(f.reportingCik) + '. Includes the tracked manager; holdings are not attributed exclusively to it. ' + (f.sourceChain?.[0]?.noticeUrl ? link(f.sourceChain[0].noticeUrl, 'SEC reporting-manager notice') : '') + '</small>';
    if (f.collectionStatus === 'retained') html += '<small class="own-source-status">Retained book · last collected ' + esc(f.collectedAtIso || 'date unavailable') + '. Latest collection failed.</small>';
    return html;
  }
  function compactMoney(value) {
    if (!model.finite(value)) return 'Unavailable';
    const abs = Math.abs(value), unit = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : null;
    return unit ? (value < 0 ? '-' : '') + '$' + (abs / unit[0]).toFixed(2) + unit[1] : money(value);
  }
  function metric(label, value, fullValue) { return '<div><small>' + esc(label) + '</small><b' + (fullValue ? ' title="' + esc(fullValue) + '"' : '') + '>' + esc(value) + '</b></div>'; }
  function disclosures(row) {
    function list(rows, label) {
      if (!rows.length) return '';
      return '<h5>' + label + '</h5>' + rows.map(r => '<dl class="own-disclosure">' +
        [['Issuer', r.name], ['Class', r.titleOfClass], ['CUSIP', r.cusip], ['FIGI', r.figi], ['Put / call', r.putCall || 'None'],
          ['Amount type', r.sharesType], ['Shares / principal amount', numeric(r.shares)], ['Reported value (USD)', money(r.value)],
          ['Investment discretion', r.investmentDiscretion], ['Other manager', r.otherManager], ['Voting sole', numeric(r.votingSole)],
          ['Voting shared', numeric(r.votingShared)], ['Voting none', numeric(r.votingNone)], ['Accession', r.accession], ['Filed', r.filingDate]]
          .map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v ?? 'Not disclosed') + '</dd></div>').join('') +
        '<div><dt>Source</dt><dd>' + link(r.sourceUrl, 'SEC information table') + '</dd></div></dl>').join('');
    }
    return '<details class="own-row-details" data-own-row="' + currentRows.indexOf(row) + '"><summary>Disclosure details (' + (row.disclosureCount ?? ((row.disclosures || []).length + (row.priorDisclosures || []).length)) + ' rows)</summary><div class="own-disclosure-content">' +
      (row.disclosurePart ? '<p>Open to load the filed rows.</p>' : list(row.disclosures || [], 'This period') + list(row.priorDisclosures || [], 'Prior period')) + '</div></details>';
  }
  function positionTable(rows) {
    return '<div class="f13-table-scroll" tabindex="0" role="region" aria-label="Disclosed positions"><table class="f13-table own-table" data-nosort><thead><tr><th>Stock / disclosure</th><th>Fund</th><th>Shares / amount</th><th>Reported value</th><th>Stock book weight</th><th>Change vs prior</th><th>Filing</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td><button type="button" class="own-link" data-own-stock="' + esc(r.ticker || r.cusip) + '">' + esc(r.ticker || r.cusip) + '</button><small>' + esc(r.name) + '</small><small>' + esc(r.titleOfClass) + ' · ' + esc(types[r.type] || r.type) + (r.isExit ? ' · Exited' : r.isNew ? ' · New' : '') + '</small>' + disclosures(r) + '</td>' +
      '<td><button type="button" class="own-link" data-own-fund="' + esc(r.firm) + '">' + esc(r.firm) + '</button>' + sourceStatus(r) + '<small>AUM est. ' + esc(money(r.aum)) + '</small><small>Quarter price proxy ' + esc(pct(r.performancePct)) + '</small></td>' +
      '<td class="f13-num">' + esc(numeric(r.sharesNow)) + '<small>Prior ' + esc(numeric(r.sharesPrior)) + '</small></td><td class="f13-num">' + esc(money(r.valueNow)) + '<small>' + (r.type === 'call' || r.type === 'put' ? 'Underlying notional, not premium' : 'Quarter-end USD') + '</small><small>Prior ' + esc(money(r.valuePrior)) + '</small></td>' +
      '<td class="f13-num">' + esc(pct(r.weightPct)) + '</td><td class="f13-num">' + esc(numeric(r.shareChange)) + '<small>Value ' + esc(money(r.valueChange)) + '</small></td><td>' + esc(r.reportDate || '') + '<small>Filed ' + esc(r.filingDate || 'unavailable') + '</small>' + link(r.filingUrl, 'SEC filing') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function fundTable(rows) {
    return '<div class="f13-table-scroll" tabindex="0" role="region" aria-label="Tracked funds"><table class="f13-table own-table" data-nosort><thead><tr><th>Fund</th><th>AUM estimate</th><th>Reported 13F value</th><th>Quarter price proxy</th><th>Positions</th><th>Top 10 stock weight</th><th>Filing</th></tr></thead><tbody>' +
      rows.map(f => '<tr><td><button type="button" class="own-link" data-own-fund="' + esc(f.firm) + '">' + esc(f.firm) + '</button><small>' + esc(f.kind || '') + ' · CIK ' + esc(f.cik || 'unavailable') + '</small>' + sourceStatus(f) + '<small>' + (f.complete ? 'Full collected book' : 'Holdings unavailable · refresh required') + '</small></td>' +
      '<td class="f13-num">' + esc(money(f.aum)) + '<small>Undated directory estimate</small></td><td class="f13-num">' + esc(money(f.reportedValue)) + '</td><td class="f13-num">' + esc(pct(f.performancePct)) + '<small>' + esc(pct(f.performance?.coveragePct)) + ' stock coverage</small></td><td class="f13-num">' + esc(numeric(f.positionCount)) + '</td><td class="f13-num">' + esc(pct(f.concentrationPct)) + '</td><td>' + esc(f.reportDate || '') + '<small>Filed ' + esc(f.filingDate || 'unavailable') + '</small></td></tr>').join('') + '</tbody></table></div>';
  }
  function form4(query) {
    if (!query.trim()) return '';
    disclosureRows = model.insiders(data, query);
    if (!disclosureRows.length) return '<p class="f13-note">No matching Form 4 rows in the collected insider feed. Other filing types and confidential positions are outside this explorer.</p>';
    return '<details class="own-insiders"><summary>Collected Form 4 disclosures (' + disclosureRows.length + ')</summary><p class="f13-note">Insider transactions, separate from fund holdings. Download results includes every matching collected row.</p><div class="f13-table-scroll"><table class="f13-table" data-nosort><thead><tr><th>Date</th><th>Ticker</th><th>Insider / role</th><th>Code</th><th>Shares</th><th>Price / value</th><th>Source</th></tr></thead><tbody>' + disclosureRows.slice(0, 100).map(r => '<tr><td>' + esc(r.transactionDate || r.filingDate) + '</td><td>' + esc(r.ticker || r.symbol) + '</td><td>' + esc(r.ownerName) + '<small>' + esc((r.roles || []).join(', ')) + '</small></td><td>' + esc(r.code) + '</td><td>' + esc(numeric(r.shares)) + '</td><td>' + esc(price(r.price)) + '<small>' + esc(money(r.value)) + '</small></td><td>' + link(r.url, 'SEC Form 4') + '</td></tr>').join('') + '</tbody></table></div>' + (disclosureRows.length > 100 ? '<p>Showing 100 rows; download includes all matches.</p>' : '') + '</details>';
  }
  function draw(controls = false) {
    const directory = state.mode === 'funds' && !state.selectedFund;
    const queryKey = state.mode === 'stocks' ? 'stockQuery' : directory ? 'fundQuery' : 'holdingQuery';
    const sortKey = directory ? 'fundSort' : 'positionSort';
    if (controls) {
      $('#own-search-label').textContent = state.mode === 'stocks' ? 'Search stock, issuer or CUSIP' : directory ? 'Search tracked fund, style or CIK' : 'Search this fund’s holdings';
      $('#own-search').placeholder = directory ? 'e.g. Bridgewater, Quant or a CIK' : 'e.g. NVDA, Nvidia or a CUSIP';
      $('#own-search').value = state[queryKey];
      $('#own-sort').innerHTML = options(directory ? fundSorts : positionSorts);
      $('#own-sort').value = state[sortKey];
      $('#own-direction').value = state.direction;
      $('#own-type').value = state.type; $('#own-status').value = state.status;
      $('.own-position-controls').hidden = directory;
      root.querySelectorAll('[data-own-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ownMode === state.mode)));
    }
    const scopedFunds = state.mode === 'funds' && state.selectedFund ? allFunds.filter(f => f.firm === state.selectedFund) : allFunds;
    const unmapped = scopedFunds.reduce((n, f) => n + f.holdings.filter(r => !r.isExit && !r.ticker).length, 0);
    $('#own-mapping-note').hidden = unmapped === 0;
    $('#own-mapping-note').textContent = numeric(unmapped) + ' positions ' + (state.mode === 'funds' && state.selectedFund ? 'in this reported portfolio' : 'across the loaded books') + ' have unresolved tickers. Search issuer names or CUSIPs to include those positions.';
    disclosureRows = [];
    currentRows = directory ? model.queryFunds(data, state.fundQuery, state.fundSort, state.direction) : model.positions(data, {
      query: state[queryKey], fund: state.mode === 'funds' ? state.selectedFund : '', type: state.type, status: state.status, sort: state.positionSort, direction: state.direction });
    const pages = Math.max(1, Math.ceil(currentRows.length / 40));
    state.page = Math.max(1, Math.min(pages, state.page));
    const visible = currentRows.slice((state.page - 1) * 40, state.page * 40);
    let html = '';
    if (state.mode === 'funds' && state.selectedFund) {
      const f = allFunds.find(f => f.firm === state.selectedFund);
      html += '<div class="own-fund-head"><button type="button" class="f13-action" data-own-back>All tracked funds</button><h4>' + esc(f.firm) + '</h4>' + sourceStatus(f) + '<p>' + esc(f.kind || '') + ' · CIK ' + esc(f.cik || '') + ' · Period end ' + esc(f.reportDate || 'unavailable') + '</p></div><div class="own-metrics">' +
        metric('AUM estimate · undated', compactMoney(f.aum), money(f.aum)) + metric('Reported 13F value', compactMoney(f.reportedValue), money(f.reportedValue)) + metric('Quarter price proxy', pct(f.performancePct)) + metric('Stock price coverage', pct(f.performance?.coveragePct)) + '</div>' +
        (!f.complete ? '<p class="own-empty">The full holdings book is unavailable. ' + esc(f.collectionError || 'The next successful collection will make this manager searchable.') + '</p>' : '');
    }
    if (visible.length) html += directory ? fundTable(visible) : positionTable(visible);
    else html += '<p class="own-empty">No matches in the collected ' + (directory ? 'fund directory' : 'holdings for these filters') + '. Try a broader search or include exited positions.</p>';
    if (state.mode === 'stocks') html += form4(state.stockQuery);
    $('#own-results').innerHTML = html;
    const heldStocks = currentRows.filter(r => r.type === 'stock' && !r.isExit);
    $('#own-summary').textContent = directory ? currentRows.length + ' tracked funds' : currentRows.length + ' matching disclosures across ' + new Set(currentRows.map(r => r.firm)).size + ' funds · ' + money(heldStocks.reduce((n, r) => n + r.valueNow, 0)) + ' reported stock value · options and principal amounts kept separate';
    $('#own-page').textContent = 'Page ' + state.page + ' of ' + pages + ' · ' + currentRows.length + ' results';
    $('[data-own-prev]').disabled = state.page <= 1;
    $('[data-own-next]').disabled = state.page >= pages;
    $('[data-own-download]').disabled = downloadBusy || (!currentRows.length && !disclosureRows.length);
  }
  $('#own-search').addEventListener('input', () => {
    state[state.mode === 'stocks' ? 'stockQuery' : state.selectedFund ? 'holdingQuery' : 'fundQuery'] = $('#own-search').value;
    state.page = 1; draw();
  });
  root.addEventListener('change', ev => {
    const key = { 'own-sort': state.mode === 'funds' && !state.selectedFund ? 'fundSort' : 'positionSort', 'own-direction': 'direction', 'own-type': 'type', 'own-status': 'status' }[ev.target.id];
    if (key) { state[key] = ev.target.value; state.page = 1; draw(); }
  });
  root.addEventListener('toggle', async ev => {
    const detail = ev.target;
    if (!detail.matches('.own-row-details') || !detail.open || !books) return;
    const row = currentRows[Number(detail.dataset.ownRow)];
    if (!row?.disclosurePart) return;
    const content = detail.querySelector('.own-disclosure-content');
    content.innerHTML = '<p role="status">Loading filed rows…</p>';
    try {
      const loaded = await books.details(row);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = disclosures({ ...loaded, disclosurePart: null });
      content.innerHTML = wrapper.querySelector('.own-disclosure-content').innerHTML;
    } catch { content.innerHTML = '<p role="status">Filed rows could not load. Close and reopen to retry.</p>'; }
  }, true);
  root.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-own-mode')) { state.mode = b.dataset.ownMode; state.selectedFund = ''; state.page = 1; draw(true); }
    if (b.hasAttribute('data-own-fund')) { state.mode = 'funds'; state.selectedFund = b.dataset.ownFund; state.holdingQuery = ''; state.page = 1; draw(true); }
    if (b.hasAttribute('data-own-stock')) { state.mode = 'stocks'; state.stockQuery = b.dataset.ownStock; state.selectedFund = ''; state.page = 1; draw(true); }
    if (b.hasAttribute('data-own-back')) { state.selectedFund = ''; state.page = 1; draw(true); }
    if (b.hasAttribute('data-own-clear')) { state[state.mode === 'stocks' ? 'stockQuery' : state.selectedFund ? 'holdingQuery' : 'fundQuery'] = ''; state.page = 1; draw(true); $('#own-search').focus(); }
    if (b.hasAttribute('data-own-prev')) { state.page--; draw(); }
    if (b.hasAttribute('data-own-next')) { state.page++; draw(); }
    if (b.hasAttribute('data-own-download')) {
      if (downloadBusy) return;
      downloadBusy = true; b.disabled = true; b.textContent = 'Preparing download…';
      const requestedRows = [...currentRows], filters = { ...state }, insiders = [...disclosureRows];
      try {
        const results = books ? await books.batch(requestedRows, r => books.details(r)) : requestedRows;
        const blob = new Blob([JSON.stringify({ builtAtIso: data.builtAtIso, periodEnd: data.periodEndIso, filters, results, insiderTransactions: insiders }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'ownership-' + (data.periodEndIso || 'results') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { $('#own-summary').textContent = 'The complete disclosure download could not load. Please retry.'; }
      finally { downloadBusy = false; b.disabled = !currentRows.length && !disclosureRows.length; b.textContent = 'Download results'; }
    }
  });
  draw(true);
}

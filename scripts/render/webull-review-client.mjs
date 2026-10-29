// Browser renderer injected into the existing Track Record IIFE.
export function webullReviewFactory({ html, pct, money, hover, dateTime = String, executionDateTime = dateTime }) {
  function format(v, unit) { return v == null ? '—' : unit === '$' ? money(v, true) : unit === 'count' ? String(v) : unit === 'rate' ? v.toFixed(1) + '%' : pct(v); }
  function axis(v, unit) {
    const magnitude = Math.abs(v), scale = magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1;
    if (unit === '$' && scale > 1) return (v < 0 ? '-' : '+') + '$' + (magnitude / scale).toFixed(1) + (scale === 1e6 ? 'm' : 'k');
    return format(v, unit);
  }
  function metric(value, label, note, cls) { return '<div class="wb-metric"><span class="wb-metric-label">' + html(label) + '</span><strong class="' + (cls || '') + '">' + value + '</strong><span class="wb-metric-note">' + html(note || '') + '</span></div>'; }
  function sign(v) { return v == null || v === 0 ? '' : v > 0 ? 'sig-pos' : 'sig-neg'; }
  function card(title, subtitle, body, wide) { return '<section class="wb-chart-card' + (wide ? ' wb-wide' : '') + '"><h3>' + html(title) + '</h3><p class="wb-chart-note">' + html(subtitle) + '</p>' + body + '</section>'; }
  function empty(message) { return '<div class="wb-chart-empty">' + html(message) + '</div>'; }
  function dataTable(headers, rows, disclosure = true) {
    if (!rows.length) return '';
    const table = '<div class="acc-tscroll"><table class="acc-qtable"><thead><tr>' + headers.map(h => '<th scope="col">' + html(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(v => '<td>' + html(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    return disclosure ? '<details class="wb-chart-data"><summary>View chart data</summary>' + table + '</details>' : table;
  }
  function line(title, points, series, unit, range) {
    if (!points.length || !points.some(p => series.some(s => p[s.key] != null))) return empty('No observations yet for this chart.');
    const W = 720, H = 270, L = 76, R = 18, T = 18, B = 38, w = W - L - R, h = H - T - B;
    const vals = [0]; points.forEach(p => series.forEach(s => { if (p[s.key] != null) vals.push(p[s.key]); }));
    let lo = range ? range[0] : Math.min(...vals), hi = range ? range[1] : Math.max(...vals);
    if (!range) { const pad = (hi - lo || 1) * .1; lo -= pad; hi += pad; }
    const sx = i => L + (points.length === 1 ? w / 2 : i / (points.length - 1) * w), sy = v => T + h - (v - lo) / (hi - lo) * h;
    let svg = '<title>' + html(title) + '</title><desc>Observations in chronological order, evenly spaced. Exact values are in View chart data.</desc>';
    [lo, (lo + hi) / 2, hi].forEach(v => { svg += '<line class="acc-eq-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/><text class="acc-eq-yl" x="' + (L - 8) + '" y="' + (sy(v) + 4) + '">' + html(axis(v, unit)) + '</text>'; });
    svg += '<line class="acc-eq-base" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';
    const targets = points.flatMap((p, i) => {
      const anchor = series.find(s => p[s.key] != null);
      return anchor ? [{ x: sx(i), y: sy(p[anchor.key]), label: p.label + '\n' + series.map(s => s.name + ': ' + format(p[s.key], unit)).join('\n') }] : [];
    });
    series.forEach(s => {
      let path = '', connected = false;
      points.forEach((p, i) => {
        const v = p[s.key]; if (v == null) { connected = false; return; }
        const x = sx(i), y = sy(v); path += (connected ? ' L' : ' M') + x.toFixed(2) + ',' + y.toFixed(2); connected = true;
        const label = p.label + '\n' + s.name + ': ' + format(v, unit);
        svg += '<circle class="wb-review-dot ' + s.cls + '" cx="' + x + '" cy="' + y + '" r="3"><title>' + html(label) + '</title></circle>';
      });
      svg += '<path class="wb-line ' + s.cls + '" d="' + path + '"/>';
    });
    svg += '<text class="wb-axis-label" x="' + L + '" y="' + (H - 8) + '">First observation</text><text class="wb-axis-label wb-axis-end" x="' + (W - R) + '" y="' + (H - 8) + '">Latest observation</text>';
    return '<div class="wb-legend">' + series.map(s => '<span class="wb-key ' + s.cls + '">' + html(s.name) + '</span>').join('') + '</div><svg class="acc-eq-svg wb-review-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + html(title) + '"' + hover(targets) + '>' + svg + '</svg>' + dataTable(['Observation', ...series.map(s => s.name)], points.map(p => [p.label, ...series.map(s => format(p[s.key], unit))]));
  }
  function bars(title, rows, series, unit, max) {
    if (!rows.length || !rows.some(r => series.some(s => r[s.key] != null))) return empty('No closed trades with the required data yet.');
    const top = max || Math.max(1, ...rows.flatMap(r => series.map(s => r[s.key] || 0)));
    return '<div class="wb-bars" role="group" aria-label="' + html(title) + '">' + rows.map(r => '<div class="wb-bar-group"><div class="wb-bar-label">' + html(r.label) + (r.n != null ? '<small>n=' + r.n + '</small>' : '') + '</div>' + series.map(s => {
      const v = r[s.key];
      return '<div class="wb-bar-row"><span class="wb-bar-track"><i class="' + (r.cls || s.cls) + '" style="width:' + (v == null ? 0 : Math.max(0, Math.min(100, v / top * 100))) + '%"></i></span><span class="wb-bar-value">' + (series.length > 1 ? html(s.name) + ' ' : '') + html(format(v, unit)) + '</span></div>';
    }).join('') + '</div>').join('') + '</div>';
  }
  function render(report, lens, groupBy) {
    const r = report, s = r.stats, n = s.n;
    const note = '<p class="wb-sample-note" role="status">' + n + ' verified closed trades in this selection · ' + s.total + ' mirrored trades. ' + s.recordN + '/' + n + ' closed trades matched to saved pick records.' + (s.excludedClosed ? ' ' + s.excludedClosed + ' closed trade' + (s.excludedClosed === 1 ? '' : 's') + ' excluded because fills or quantities are unverified.' : '') + (s.undated ? ' ' + s.undated + ' closed trade' + (s.undated === 1 ? ' has' : 's have') + ' no paper close timestamp. These results remain in totals but are excluded from time charts; drawdown is withheld.' : '') + (n < 30 ? ' Early sample; patterns can change substantially as trades close.' : '') + (s.unknownFees ? ' ' + s.unknownFees + ' closed trade' + (s.unknownFees === 1 ? ' has' : 's have') + ' no recorded fee estimate.' : '') + '</p>';
    let metrics = '', charts = '';
    if (lens === 'performance') {
      metrics = metric(format(s.pnl, '$'), 'Realized paper P&L', s.moneyN + ' trades with both fill prices', sign(s.pnl)) + metric(format(s.drawdown, '$'), 'Largest closed-trade drawdown', 'From the prior realized P&L peak', s.drawdown < 0 ? 'sig-neg' : '') + metric(format(s.expectancy, '$'), 'Average P&L per trade', 'Recorded contract quantities; known fees', sign(s.expectancy)) + metric(s.noLosses ? 'No losses' : s.profitFactor == null ? '—' : s.profitFactor.toFixed(2) + '×', 'Profit factor', 'Gross winning dollars ÷ gross losing dollars');
      charts = card('Realized P&L over time', s.datedN + ' of ' + s.moneyN + ' closed trades have paper close timestamps. Recorded quantities, less known fees. Realized trade results, not account equity or open exposure.', s.datedN ? line('Cumulative realized paper profit', r.curve, [{ key: 'paper', name: 'Paper P&L', cls: 'paper' }], '$') : empty('The curve needs a verified closed trade with a paper close timestamp.'), true) +
        card('Paper versus engine', s.datedPairedN + ' dated matches of ' + s.pairedN + ' complete paper and model price pairs. Same contract quantities; engine excludes execution fees.', s.datedPairedN ? line('Matched cumulative paper and engine profit', r.comparison, [{ key: 'paper', name: 'Paper', cls: 'paper' }, { key: 'engine', name: 'Engine', cls: 'engine' }], '$') : empty('No verified closed trades have both price pairs and paper close timestamps.')) +
        card('Drawdown', 'Dollar decline from the highest realized P&L so far. Open-position swings are not captured.', s.drawdown != null ? line('Realized dollar drawdown', r.curve, [{ key: 'drawdown', name: 'Drawdown', cls: 'loss' }], '$') : empty(s.undated ? 'Drawdown is unavailable until every included closed trade has a paper close timestamp.' : 'Drawdown appears with the first verified closed fill.')) +
        card('Paper versus SPY options', s.benchmarkN + ' matched closed pairs only. Sum of per-trade returns at equal stakes, in percentage points; not a compounded portfolio return. Missing SPY pairs are excluded from both lines.', s.benchmarkN ? line('Matched return totals for paper and SPY options', r.benchmark, [{ key: 'paper', name: 'Paper', cls: 'paper' }, { key: 'spy', name: 'SPY option model', cls: 'spy' }], '%') : empty('No closed mirrored trades have a closed SPY option pair yet.'), true) +
        card('Distribution of trade returns', 'Option returns after known fees, one observation per closed trade. Breakeven is included in the 0 to 20% bucket.', n ? bars('Closed trade return distribution', r.hist, [{ key: 'value', name: 'Trades', cls: 'paper' }], 'count') : empty('Return buckets populate as paper trades close.'), true);
    } else if (lens === 'accuracy') {
      metrics = metric(format(s.winRate, 'rate'), 'Profitable options', n + ' closed trades; after known fees') + metric(format(s.direction, 'rate'), 'Stock direction at engine exit', s.directionN + ' trades with saved entry and exit stock marks') + metric(String(r.calibration.reduce((a, b) => a + b.n, 0)), 'Trades with entry PoP', 'For the probability comparison below') + metric(String(n), 'Closed sample', 'Open, missed and unsettled trades excluded');
      const groupControl = '<label class="wb-group-control">Compare by <select id="acc-wb-group" data-acc-set="wbGroup" aria-label="Accuracy comparison group">' + [['structure', 'Structure'], ['side', 'Calls / puts'], ['grade', 'AI grade'], ['tier', 'Conviction tier'], ['sector', 'Sector'], ['regime', 'Market regime'], ['run', 'Engine run']].map(o => '<option value="' + o[0] + '"' + (o[0] === groupBy ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
      charts = card('Accuracy over time', 'Trailing 20 dated closed trades, or all available when fewer than 20. Direction uses saved stock marks at engine exit, which may precede the paper close.', line('Rolling option win rate and stock direction accuracy', r.trend, [{ key: 'win', name: 'Profitable option', cls: 'paper' }, { key: 'direction', name: 'Correct direction', cls: 'spy' }], 'rate', [0, 100]), true) +
        card('Where the engine works', 'Win rate and sample size for each selected cohort. A small group can swing on a single result.', groupControl + bars('Paper win rate by cohort', r.groups, [{ key: 'value', name: 'Win rate', cls: 'paper' }], 'rate', 100) + dataTable(['Group', 'Closed trades', 'Win rate', 'Avg paper return', 'Avg engine return', 'Engine observations'], r.groups.map(g => [g.label, g.n, format(g.value, 'rate'), format(g.avg), format(g.model), g.modelN]))) +
        card('Predicted probability versus outcome', 'Entry PoP versus profitable paper exits, after known fees. Different exit rules and holding periods make this a diagnostic, not a formal calibration test.', bars('Entry probability and realized win rate', r.calibration.filter(c => c.n), [{ key: 'predicted', name: 'Predicted', cls: 'engine' }, { key: 'actual', name: 'Actual', cls: 'paper' }], 'rate', 100));
    } else if (lens === 'engine') {
      metrics = metric(String(s.total), 'Tracked trades', 'Includes labeled manual entries adopted for automated exits') + metric(format(s.bias), 'Paper minus model', s.modelN + ' paired closed returns; percentage points', sign(s.bias)) + metric(s.mae == null ? '—' : s.mae.toFixed(1) + ' pp', 'Mean absolute model error', 'Size of return gaps, regardless of sign') + metric(format(s.within, 'rate'), 'Within 5 percentage points', 'Share of paired closed trade returns');
      charts = card('Execution status', 'Current state of every mirrored trade in this selection. Waiting and open positions are not counted as completed outcomes.', bars('Mirrored trade execution states', r.execution, [{ key: 'value', name: 'Trades', cls: 'paper' }], 'count')) +
        card('Execution gaps', 'Entry order, oldest first. Positive means worse than the engine price. Entry and exit gaps are each relative to their engine price; missing observations leave a gap.', line('Entry and exit price gaps versus engine', r.slippage, [{ key: 'entry', name: 'Entry gap', cls: 'paper' }, { key: 'exit', name: 'Exit gap', cls: 'engine' }], '%'));
    } else {
      return note;
    }
    return note + '<div class="wb-metrics">' + metrics + '</div><div class="wb-chart-grid">' + charts + '</div>';
  }
  function status(info, record) {
    const rec = info.reconciliation || {}, run = Date.parse(info.lastRunIso), current = Date.parse(record.builtAtIso), checked = Date.parse(info.engineSnapshotIso);
    const reportsSnapshot = Object.prototype.hasOwnProperty.call(info, 'engineSnapshotIso');
    let body = '<p class="wb-sample-note">' + (rec.checkedAtIso ? 'Last broker reconciliation: ' + html(dateTime(rec.checkedAtIso)) + '.' : 'No broker reconciliation snapshot was supplied.') + '</p>';
    if (info.lastEndOfDayDeadlineIso) body += '<p class="wb-sample-note">Last closing-deadline check: ' + html(dateTime(info.lastEndOfDayDeadlineIso)) + '.</p>';
    const audit = info.lastEndOfDayAudit;
    if (audit && (!audit.deadlineObserved || audit.incomplete)) body += '<p class="wb-review-warning" role="alert">Closing-window review needed: ' + html(dateTime(audit.checkedAtIso)) + '. ' + (!audit.deadlineObserved ? 'No completed check was recorded in the final ten minutes. ' : '') + (audit.incomplete ? 'The final broker reconciliation was incomplete.' : '') + '</p>';
    if (!Number.isFinite(run) || reportsSnapshot && Number.isFinite(current) && (!Number.isFinite(checked) || current > checked)) body += '<p class="wb-review-warning" role="status">The latest Track Record build has not been checked by the mirror yet, or no mirror run is recorded.</p>';
    body += '<p class="wb-sample-note">Holdings and order checks follow the 11:00 and 15:30 ET Top Picks builds after publication, with up to four two-minute follow-ups while orders are pending. A separate final-20-minute window checks the book; in the last 10 minutes, eligible same-day entries get a final 5% cap and signaled exits use emergency pricing. Scheduler delays and unfilled orders remain possible. Quotes are Yahoo-derived; exchange quote timestamps are unverified. Expiry closes start with the first mirror on the two-session cutoff date.</p>';
    if (rec.externalGroups > 0) body += '<p class="wb-sample-note">' + rec.externalGroups + (rec.externalGroups === 1 ? ' position' : ' positions') + ' in the paper account came from outside the mirror. The mirror leaves them alone, and they only block a new pick that uses the same contract.</p>';
    const alerts = Array.isArray(rec.alerts) ? rec.alerts : [];
    if (alerts.length || ['attention', 'incomplete'].includes(rec.status)) body += '<div class="wb-review-warning" role="alert"><strong>Broker reconciliation needs review</strong><p>Entries may be paused or exposure may need review.</p>' + (alerts.length ? '<ul>' + alerts.map(a => '<li>' + html(a) + '</li>').join('') + '</ul>' : '') + '</div>';
    return body;
  }
  function executionHistory(t) {
    const attempts = Array.isArray(t.attempts) ? t.attempts : [];
    const decisions = Array.isArray(t.decisions) ? t.decisions : [];
    if (!attempts.length && !decisions.length) return '';
    const price = v => v == null || !Number.isFinite(Number(v)) ? 'Unknown' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const events = { prepared: 'Order prepared', 'saved-state': 'Previously saved evidence', 'submission-request': 'Submission requested', 'submission-result': 'Submission result', 'cancel-request': 'Cancellation requested', 'broker-detail': 'Broker update', 'manual-broker-import': 'Manual fill imported', 'lookup-unavailable': 'Status unavailable', 'metadata-unavailable': 'Metadata refresh unavailable' };
    const observations = attempts.flatMap(a => (a.observations || []).map(o => [
      (a.phase === 'exit' ? 'Exit ' : 'Entry ') + a.n, o.observedIso ? executionDateTime(o.observedIso) : 'Unknown', events[o.kind] || o.kind || 'Unknown',
      o.status || 'Unknown', o.filledQty ?? 'Unknown', price(o.filledPrice), o.filledIso ? executionDateTime(o.filledIso) : 'Unknown', price(o.feeActual), o.brokerOrderId || 'Unknown']));
    const evidence = observations.length ? '<details class="wb-order-observations"><summary>Broker observations and order actions (' + observations.length + ')</summary>' + dataTable(['Order', 'Observed', 'Event', 'Status', 'Cumulative filled', 'Average fill', 'Broker fill time', 'Actual fees', 'Broker order ID'], observations, false) + '<p class="wb-sample-note">These are cumulative order observations, not individual execution lots. Repeated totals are counted once. Earlier partial-fill evidence stays in this history.</p></details>' : '';
    const blocked = decisions.length ? '<p class="wb-sample-note">Execution decisions where no order was sent</p>' + dataTable(['Side', 'Stage', 'Observed', 'Reason', 'Quote source'], decisions.map(d => [d.phase, d.stage, executionDateTime(d.observedIso), d.reason, d.quoteSource]), false) : '';
    const rows = attempts.map(a => [a.phase === 'exit' ? 'Exit' : 'Entry', a.source === 'manual' ? 'Manual entry' : a.stage === 'emergency-exit' ? 'Emergency end-of-day exit' : a.stage === 'eod-entry' ? 'End-of-day entry (5% cap)' : a.stage === 'expiry-exit' ? 'Expiry exit' : a.allowancePct != null ? a.allowancePct + '% allowance' : 'Earlier policy', a.sentIso ? executionDateTime(a.sentIso) : 'Unknown', a.status || 'Unknown', (a.filledQty ?? 'Unknown') + '/' + (a.quantity ?? 'Unknown'), price(a.referencePrice), price(a.limit), a.filledPrice == null ? 'Unconfirmed' : price(a.filledPrice), a.filledIso ? executionDateTime(a.filledIso) : 'Unconfirmed', price(a.bid) + ' / ' + price(a.ask), a.cancelRequestedIso ? executionDateTime(a.cancelRequestedIso) : 'None recorded', a.quoteSource || 'Unknown', a.quoteObservedIso ? executionDateTime(a.quoteObservedIso) : 'Unknown']);
    return '<details class="wb-execution-history"><summary>Order attempts and confirmed fills (' + attempts.length + ')</summary>' + dataTable(['Side', 'Method', 'Sent', 'Broker status', 'Filled / requested', 'Modeled reference', 'Limit', 'Actual fill', 'Fill time', 'Quote bid / ask', 'Cancel requested', 'Quote source', 'Quote fetched'], rows, false) + evidence + blocked + '<p class="wb-sample-note">Limit prices are not fills. Quote fetched is when this app received the response; exchange quote timestamps are unverified. Manual prices and timing are excluded from automatic-entry statistics. Earlier automatic misses remain recorded.</p></details>';
  }
  return { render, status, executionHistory };
}

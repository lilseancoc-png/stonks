export function trackRecordResetClient(deps) {
  var dialog = deps.get('acc-reset-dialog');
  if (!dialog) return;
  var form = deps.get('acc-reset-form'), check = deps.get('acc-reset-sure');
  var submit = deps.get('acc-reset-confirm'), cancel = deps.get('acc-reset-cancel');
  var range = deps.get('acc-reset-range'), error = deps.get('acc-reset-error');
  var summary = deps.get('acc-reset-summary'), refresh = deps.get('acc-reset-refresh');
  var scope = null, busy = false, preview = null, sequence = 0;
  var labels = { webull: 'Webull', onsite: 'On-site' };
  function date(iso) { return new Date(iso).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }); }
  function count(n, single, plural) { return n + ' ' + (n === 1 ? single : plural); }
  function ready() { check.disabled = busy || !preview; submit.disabled = busy || !preview || !check.checked; }
  function request(body) {
    return deps.fetch('/api/auth/track-record-reset', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function(response) {
      return response.json().catch(function() { throw new Error('Could not read the server response. Refresh the preview before trying again.'); }).then(function(result) {
        if (!response.ok) throw new Error(result.error || 'Could not update this log.');
        return result;
      });
    });
  }
  function updatePreview() {
    var current = ++sequence;
    deps.get('acc-reset-title').textContent = 'Wipe ' + labels[scope] + ' log · ' + range.value + '?';
    preview = null; check.checked = false; error.textContent = ''; summary.textContent = 'Checking this period…'; ready();
    request({ operation: 'preview', scope: scope, range: range.value }).then(function(result) {
      if (current !== sequence || !dialog.open) return;
      preview = result;
      var dates = result.fromIso ? date(result.fromIso) + ' through ' + date(result.toIso) : 'All logged entries through ' + date(result.toIso);
      var counts = count(result.tradeCount, 'trade log entry', 'trade log entries') + ', ' + (scope === 'webull' ? count(result.runCount, 'run log', 'run logs') : count(result.activityCount, 'activity entry', 'activity entries') + ' and ' + count(result.snapshotCount, 'roster snapshot', 'roster snapshots'));
      summary.textContent = dates + ' (UTC). ' + counts + ' match. ' +
        (range.value === 'ALL' ? 'Undated entries are included.' : 'Undated entries are kept.');
      ready();
    }).catch(function(err) {
      if (current !== sequence || !dialog.open) return;
      summary.textContent = ''; error.textContent = err.message || 'Could not load this period. Refresh the preview to try again.'; ready();
    });
  }
  deps.pane.addEventListener('click', function(event) {
    var button = event.target.closest && event.target.closest('[data-track-reset]');
    if (!button || busy || !deps.isOwner()) return;
    scope = button.getAttribute('data-track-reset');
    if (scope !== 'webull' && scope !== 'onsite') return;
    deps.get('acc-reset-title').textContent = 'Wipe ' + labels[scope] + ' log?';
    deps.get('acc-reset-data').replaceChildren();
    var deleted = scope === 'webull'
      ? ['Webull trade and fill log entries selected by engine entry time', 'Their order-attempt history in reports and downloads', 'Run logs selected by run time; performance charts recalculate from the remaining trades']
      : ['Modeled open, closed and archived trade log entries selected by entry time, and matching SPY comparisons', 'Pick and grade activity selected by event time, and roster snapshots selected by snapshot time', 'On-site scorecards, equity charts, breakdowns and simulations recalculate from the remaining trades'];
    deleted.forEach(function(text) { var li = document.createElement('li'); li.textContent = text; deps.get('acc-reset-data').appendChild(li); });
    deps.get('acc-reset-kept').textContent = 'Only the ' + labels[scope] + ' reporting log is cleared. The other tracker, uploaded fills, research, live engine state, broker orders, positions and account balance stay intact. Active trades keep being managed, and wiping the log will not submit them again.';
    range.value = '1D'; submit.textContent = 'Yes, wipe ' + labels[scope] + ' log';
    dialog.showModal(); cancel.focus(); updatePreview();
  });
  range.addEventListener('change', updatePreview);
  refresh.addEventListener('click', updatePreview);
  check.addEventListener('change', ready);
  cancel.addEventListener('click', function() { if (!busy) dialog.close(); });
  dialog.addEventListener('close', function() { sequence++; preview = null; });
  dialog.addEventListener('cancel', function(event) { if (busy) event.preventDefault(); });
  form.addEventListener('submit', function(event) {
    event.preventDefault();
    if (busy || !preview || !check.checked || !deps.isOwner()) return;
    busy = true; range.disabled = true; refresh.disabled = true; cancel.disabled = true;
    submit.textContent = 'Wiping…'; error.textContent = ''; ready();
    request({ operation: 'wipe', scope: scope, range: range.value, previewToken: preview.previewToken,
      confirmation: 'WIPE ' + scope.toUpperCase() + ' ' + range.value + ' RECORD'
    }).then(function() { deps.reload(); }).catch(function(err) {
      error.textContent = err.message || 'Could not confirm the wipe. Refresh to check this log before trying again.';
      busy = false; range.disabled = false; refresh.disabled = false; cancel.disabled = false;
      check.checked = false; submit.textContent = 'Yes, wipe ' + labels[scope] + ' log'; ready();
    });
  });
}

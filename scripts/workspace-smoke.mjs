import assert from 'node:assert/strict';

export function verifyWorkspace(appJs, html) {
  const start = appJs.indexOf('  function normalizeWorkspacePins(');
  const end = appJs.indexOf('  function appendWorkspaceRetry(', start);
  assert(start >= 0 && end > start);
  const normalize = Function(appJs.slice(start, end) + '; return normalizeWorkspacePins;')();
  assert.deepEqual(normalize(['calendar', 'picks', 'calendar', null, '<script>', 'heatmap'], ['calendar', 'heatmap']), ['calendar', 'heatmap'], 'stored pins cannot restore unavailable Owner destinations or duplicate entries');
  for (const invalid of [null, {}, 'calendar', 12]) assert.deepEqual(normalize(invalid, ['calendar']), []);
  const ids = Array.from({ length: 12 }, (_, i) => String(i));
  assert.equal(normalize(ids, ids).length, 8, 'pin count is bounded');
  assert.deepEqual(normalize(['picks', 'calendar'], ['picks', 'calendar']), ['picks', 'calendar']);
  assert.match(html, /href="#main-content">Skip to content/);
  assert.match(html, /<main id="main-content" tabindex="-1">/);
  assert.match(html, /id="workspace-settings-toggle"[^>]+aria-controls="workspace-settings-panel"/);
  assert.match(html, /<details id="calendar-context"/);
}

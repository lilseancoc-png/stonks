import assert from 'node:assert/strict';

export function verifyNavFilter(appJs) {
  const start = appJs.indexOf('    function updateNavFilter(){');
  const end = appJs.indexOf('    if (navFilter) {', start);
  assert(start >= 0 && end > start);
  function classes() {
    const values = new Set();
    return { toggle: (key, on) => on ? values.add(key) : values.delete(key), contains: key => values.has(key) };
  }
  function button(id, text) {
    return { textContent: text, hidden: false, classList: classes(), getAttribute: () => id, hasAttribute: () => false };
  }
  function group(name, buttons, open = false, hidden = false) {
    return { open, hidden, classList: classes(), querySelector: () => ({ textContent: name }), querySelectorAll: () => buttons };
  }
  const calendar = button('calendar', 'Calendar');
  const earnings = button('earnings', 'Earnings tracker');
  const picks = button('picks', 'Top picks');
  const events = group('Events', [calendar, earnings]);
  const owner = group('Owner', [picks], true, true);
  const input = { value: '' };
  const clear = { hidden: true };
  const status = { hidden: true, textContent: '' };
  const create = Function('navFilter', 'navFilterClear', 'navFilterStatus', 'navGroups', 'valid',
    `var navGroupState = null; var navMatches = []; ${appJs.slice(start, end)}; return {updateNavFilter, resetNavFilter};`);
  const filter = create(input, clear, status, [events, owner], ['calendar', 'earnings']);
  input.value = 'earnings';
  filter.updateNavFilter();
  assert.equal(events.open, true, 'search temporarily expands collapsed groups');
  assert.equal(calendar.classList.contains('nav-filter-hidden'), true);
  assert.equal(earnings.classList.contains('nav-filter-hidden'), false);
  assert.equal(status.textContent, '1 workspace found');
  input.value = 'events';
  filter.updateNavFilter();
  assert.equal(status.textContent, '2 workspaces found', 'group names are searchable');
  input.value = 'top picks';
  filter.updateNavFilter();
  assert.match(status.textContent, /No matches/);
  assert.equal(owner.hidden, true, 'search never changes entitlement flags');
  assert.equal(picks.classList.contains('nav-filter-hidden'), true);
  filter.resetNavFilter();
  assert.equal(events.open, false, 'clear restores original disclosure state');
  assert.equal(owner.open, true);
  assert.equal(owner.hidden, true);
  assert.equal(input.value, '');
  assert.equal(clear.hidden, true);
  assert.equal(status.hidden, true);
  assert.equal(calendar.classList.contains('nav-filter-hidden'), false);
}

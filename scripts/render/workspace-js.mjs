// Bound inside bindPageTabs, sharing its entitlement-aware navigation resolver.
export function renderWorkspaceBindings() {
  return `
    var workspaceNav = document.getElementById('side-nav');
    var workspaceMain = document.getElementById('main-content');
    var settings = document.getElementById('workspace-settings');
    var settingsToggle = document.getElementById('workspace-settings-toggle');
    var settingsPanel = document.getElementById('workspace-settings-panel');
    function closeWorkspaceSettings(restoreFocus){
      if (!settings) return;
      settings.classList.remove('is-open');
      settingsToggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus) settingsToggle.focus();
    }
    if (settingsToggle) settingsToggle.addEventListener('click', function(){
      var open = settings.classList.toggle('is-open');
      settingsToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        var first = settingsPanel.querySelector('select, button, a');
        if (first) first.focus();
      }
    });
    document.addEventListener('click', function(ev){
      if (settings && !settings.contains(ev.target)) closeWorkspaceSettings(false);
    });
    if (settings) settings.addEventListener('focusout', function(ev){
      if (ev.relatedTarget && !settings.contains(ev.relatedTarget)) closeWorkspaceSettings(false);
    });
    // Hand focus to the existing command palette without leaving two modal
    // keyboard scopes active at once.
    document.addEventListener('keydown', function(ev){
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && !isDesktopNav() && sideNavVisible()) closeSideNavDrawer();
    }, true);
    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' && settings && settings.classList.contains('is-open')) {
        ev.preventDefault(); closeWorkspaceSettings(true);
      }
      if (ev.key !== 'Tab' || isDesktopNav() || !sideNavVisible() || !workspaceNav) return;
      var focusable = Array.from(workspaceNav.querySelectorAll('button, input, select, a[href], summary'))
        .filter(function(el){ return !el.disabled && el.getClientRects().length > 0; });
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !workspaceNav.contains(document.activeElement))) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && (document.activeElement === last || !workspaceNav.contains(document.activeElement))) {
        ev.preventDefault(); first.focus();
      }
    });
    var pinButton = document.getElementById('workspace-pin');
    var pinnedList = document.getElementById('workspace-pinned-list');
    var pinnedSection = document.getElementById('workspace-pinned');
    var pinnedIds = [];
    try {
      var savedPins = JSON.parse(localStorage.getItem('stonks-workspace-pins') || '[]');
      pinnedIds = normalizeWorkspacePins(savedPins, valid);
    } catch (_) {}
    function workspaceDestination(id){
      if (valid.indexOf(id) < 0) return null;
      var btn = document.getElementById('page-tab-' + id);
      if (!btn || btn.hidden || btn.hasAttribute('data-nav-hidden') || btn.closest('[hidden]')) return null;
      return btn;
    }
    function syncWorkspacePins(){
      if (!pinButton || !pinnedList) return;
      var active = document.querySelector('[data-page-tab][aria-selected="true"]');
      var current = active && active.getAttribute('data-page-tab');
      var isPinned = pinnedIds.indexOf(current) >= 0;
      pinButton.textContent = isPinned ? 'Unpin this workspace' : 'Pin this workspace';
      pinButton.setAttribute('aria-pressed', String(isPinned));
      pinButton.disabled = !workspaceDestination(current) || (!isPinned && pinnedIds.length >= 8);
      pinButton.title = pinnedIds.length >= 8 && !isPinned ? 'Unpin a workspace to add another (maximum 8)' : 'Saved in this browser';
      pinnedList.replaceChildren();
      pinnedIds.forEach(function(id){
        var source = workspaceDestination(id);
        if (!source) return;
        var row = document.createElement('div'); row.className = 'workspace-pin-row';
        var go = document.createElement('button'); go.type = 'button'; go.className = 'workspace-pin-link';
        go.textContent = source.textContent.trim();
        if (id === current) go.setAttribute('aria-current', 'page');
        go.addEventListener('click', function(){ selectTab(id); });
        var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'workspace-unpin';
        remove.textContent = '×'; remove.setAttribute('aria-label', 'Unpin ' + source.textContent.trim());
        remove.addEventListener('click', function(){
          pinnedIds = pinnedIds.filter(function(pin){ return pin !== id; });
          saveWorkspacePins(); pinButton.focus();
        });
        row.append(go, remove); pinnedList.appendChild(row);
      });
      pinnedSection.hidden = !pinnedList.children.length || !!document.getElementById('nav-filter').value.trim();
    }
    function saveWorkspacePins(){
      try { localStorage.setItem('stonks-workspace-pins', JSON.stringify(pinnedIds)); } catch (_) {}
      syncWorkspacePins();
    }
    if (pinButton) pinButton.addEventListener('click', function(){
      var active = document.querySelector('[data-page-tab][aria-selected="true"]');
      var id = active && active.getAttribute('data-page-tab');
      if (!workspaceDestination(id)) return;
      if (pinnedIds.indexOf(id) >= 0) pinnedIds = pinnedIds.filter(function(pin){ return pin !== id; });
      else if (pinnedIds.length < 8) pinnedIds.push(id);
      saveWorkspacePins();
    });
    var calendarContext = document.getElementById('calendar-context');
    if (calendarContext) calendarContext.open = window.matchMedia('(min-width: 761px)').matches;
`;
}

export function renderWorkspaceHelpers() {
  return `
  function normalizeWorkspacePins(saved, valid){
    if (!Array.isArray(saved)) return [];
    return saved.filter(function(id, i){
      return typeof id === 'string' && valid.indexOf(id) >= 0 && saved.indexOf(id) === i;
    }).slice(0, 8);
  }
  function appendWorkspaceRetry(host, retry){
    if (!host) return;
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'workspace-retry'; button.textContent = 'Retry';
    button.addEventListener('click', function(){
      button.disabled = true; button.textContent = 'Retrying…';
      retry();
    });
    host.appendChild(button);
  }
`;
}

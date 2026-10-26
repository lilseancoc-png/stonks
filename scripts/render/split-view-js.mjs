// Split view: two pages of the site side by side (stacked on phones). Each
// side is the site itself in a same-origin frame opened with ?embed=1, so
// every page keeps its own layout for the width it gets. The frames hide
// the header, sidebar, tab bar and footer (html.is-embed, set by a tiny
// script in <head>) and report their page back so each side's picker
// stays in step. Presentational only: no new data, no new requests beyond
// loading the pages themselves.

// Top-level: knows whether this copy of the app runs inside a split pane.
export function renderSplitViewHelpers() {
  return `
  // Any framed copy is a pane: the site may only be framed by itself
  // (frame-ancestors 'self'), and a link that reloads the pane drops ?embed=1.
  var IS_EMBED = (function(){
    try { return window.self !== window.top; }
    catch (_) { return true; }
  })();
  // A pane follows the light / dark switch made in the main window.
  if (IS_EMBED) window.addEventListener('storage', function(ev){
    if (ev.key === 'stonks-theme' && (ev.newValue === 'dark' || ev.newValue === 'light')) document.documentElement.setAttribute('data-theme', ev.newValue);
  });
  function splitReportTab(name){
    if (!IS_EMBED) return;
    try { window.parent.postMessage({ stonksSplit: 1, tab: name }, window.location.origin); } catch (_) {}
  }
`;
}

// Bound inside bindPageTabs, after the wayfinding bindings: shares valid,
// selectTab and the wf* site-map helpers.
export function renderSplitViewBindings() {
  return `
    var SPLIT_KEY = 'stonks-split-v1';
    var splitToggle = document.getElementById('split-toggle');
    var splitHost = null, splitInternalNav = false;
    var splitState = { on: false, a: '', b: '', r: 50 };
    try {
      var savedSplit = JSON.parse(localStorage.getItem(SPLIT_KEY) || 'null');
      if (savedSplit && typeof savedSplit === 'object') {
        splitState.on = savedSplit.on === true;
        splitState.a = typeof savedSplit.a === 'string' ? savedSplit.a : '';
        splitState.b = typeof savedSplit.b === 'string' ? savedSplit.b : '';
        var savedR = Number(savedSplit.r);
        if (isFinite(savedR)) splitState.r = Math.min(75, Math.max(25, savedR));
      }
    } catch (_) {}
    function splitSave(){
      try { localStorage.setItem(SPLIT_KEY, JSON.stringify(splitState)); } catch (_) {}
    }
    function splitIsOn(){ return document.body.classList.contains('split-on'); }
    function splitPickable(id){ return wfAllowed(id) && !!wfItem(id); }
    // The picker lists every page this visitor can open, grouped by section.
    function splitOptionsHtml(){
      return wfVisibleSections().map(function(sec){
        return '<optgroup label="' + escapeHtml(sec[1]) + '">' + wfSectionItems(sec).map(function(it){
          return '<option value="' + it[0] + '">' + escapeHtml(it[1]) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    }
    function splitPaneHtml(side){
      var label = side === 'a' ? 'First page' : 'Second page';
      return '<section class="split-pane split-pane-' + side + '" aria-label="' + label + '">' +
        '<div class="split-bar">' +
          '<label class="split-pick"><span class="sr-only">' + label + '</span>' +
            '<select data-split-pick="' + side + '">' + splitOptionsHtml() + '</select></label>' +
          '<button type="button" class="split-btn" data-split-full="' + side + '" title="Close split view and open this page full width">Full page</button>' +
          (side === 'b' ? '<button type="button" class="split-btn" data-split-swap title="Swap the two sides">Swap</button>' +
            '<button type="button" class="split-btn split-close" data-split-close aria-label="Close split view" title="Close split view">&times;</button>' : '') +
        '</div>' +
        '<iframe class="split-frame" data-split-frame="' + side + '" title="' + label + '"></iframe>' +
      '</section>';
    }
    function splitBuild(){
      if (splitHost) return splitHost;
      splitHost = document.createElement('div');
      splitHost.id = 'split-view';
      splitHost.className = 'split-view';
      splitHost.setAttribute('role', 'region');
      splitHost.setAttribute('aria-label', 'Split view');
      splitHost.innerHTML = splitPaneHtml('a') +
        '<div class="split-divider" role="separator" tabindex="0" aria-label="Resize the two pages" aria-valuemin="25" aria-valuemax="75"><span aria-hidden="true"></span></div>' +
        splitPaneHtml('b');
      document.body.appendChild(splitHost);
      splitHost.addEventListener('change', function(ev){
        var sel = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-split-pick') : null;
        if (sel) splitLoad(sel, ev.target.value);
      });
      splitHost.addEventListener('click', function(ev){
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-split-full], [data-split-swap], [data-split-close]') : null;
        if (!t) return;
        if (t.hasAttribute('data-split-full')) { var keep = splitState[t.getAttribute('data-split-full')]; splitClose(); selectTab(keep); }
        else if (t.hasAttribute('data-split-swap')) { var a = splitState.a; splitLoad('a', splitState.b); splitLoad('b', a); }
        else splitClose(true);
      });
      splitBindDivider(splitHost.querySelector('.split-divider'));
      return splitHost;
    }
    function splitFrame(side){ return splitHost ? splitHost.querySelector('[data-split-frame="' + side + '"]') : null; }
    function splitLoad(side, id){
      if (!splitPickable(id)) return;
      splitState[side] = id;
      splitSave();
      var sel = splitHost.querySelector('[data-split-pick="' + side + '"]');
      if (sel && sel.value !== id) sel.value = id;
      var frame = splitFrame(side);
      if (frame) {
        frame.setAttribute('data-tab', id);
        frame.src = window.location.pathname + '?tab=' + encodeURIComponent(id) + '&embed=1';
        frame.title = (side === 'a' ? 'First page: ' : 'Second page: ') + wfItem(id)[1];
      }
    }
    // A pane reports its page whenever someone navigates inside it.
    window.addEventListener('message', function(ev){
      if (!splitHost || ev.origin !== window.location.origin || !ev.data || ev.data.stonksSplit !== 1) return;
      ['a', 'b'].forEach(function(side){
        var frame = splitFrame(side);
        if (!frame || ev.source !== frame.contentWindow || !splitPickable(ev.data.tab)) return;
        splitState[side] = ev.data.tab;
        frame.setAttribute('data-tab', ev.data.tab);
        frame.title = (side === 'a' ? 'First page: ' : 'Second page: ') + wfItem(ev.data.tab)[1];
        var sel = splitHost.querySelector('[data-split-pick="' + side + '"]');
        if (sel) sel.value = ev.data.tab;
        splitSave();
      });
    });
    function splitStacked(){
      try { return window.matchMedia('(max-width: 760px)').matches; } catch (_) { return false; }
    }
    function splitApplyRatio(){
      if (!splitHost) return;
      splitHost.style.setProperty('--split-r', String(splitState.r));
      var div = splitHost.querySelector('.split-divider');
      if (div) {
        div.setAttribute('aria-valuenow', String(Math.round(splitState.r)));
        div.setAttribute('aria-orientation', splitStacked() ? 'horizontal' : 'vertical');
      }
    }
    function splitSetRatio(r){
      splitState.r = Math.min(75, Math.max(25, r));
      splitApplyRatio();
    }
    function splitBindDivider(div){
      if (!div) return;
      div.addEventListener('pointerdown', function(ev){
        ev.preventDefault();
        splitHost.classList.add('is-dragging');
        try { div.setPointerCapture(ev.pointerId); } catch (_) {}
        function move(e){
          var box = splitHost.getBoundingClientRect();
          var r = splitStacked() ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width;
          if (isFinite(r)) splitSetRatio(r * 100);
        }
        function up(){
          splitHost.classList.remove('is-dragging');
          div.removeEventListener('pointermove', move);
          div.removeEventListener('pointerup', up);
          div.removeEventListener('pointercancel', up);
          splitSave();
        }
        div.addEventListener('pointermove', move);
        div.addEventListener('pointerup', up);
        div.addEventListener('pointercancel', up);
      });
      div.addEventListener('keydown', function(ev){
        var back = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp';
        var fwd = ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
        if (!back && !fwd && ev.key !== 'Home') return;
        ev.preventDefault();
        splitSetRatio(ev.key === 'Home' ? 50 : splitState.r + (fwd ? 5 : -5));
        splitSave();
      });
    }
    // The panes sit right under the header, whatever height it has here.
    function splitPlace(){
      if (!splitHost) return;
      var header = document.querySelector('.site-header');
      var bottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      splitHost.style.top = bottom + 'px';
      splitApplyRatio();
    }
    window.addEventListener('resize', function(){ if (splitIsOn()) splitPlace(); });
    function splitSyncToggle(on){
      if (!splitToggle) return;
      splitToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      splitToggle.title = on ? 'Close split view' : 'Split view: two pages side by side';
    }
    function splitDefaultSecond(first){
      var recent = wfReadRecent().filter(function(e){ return e.slice(0, 4) === 'tab:'; }).map(function(e){ return e.slice(4); });
      var options = [splitState.b].concat(recent, ['news', 'heatmap', 'brief', 'tickers', 'calendar']);
      for (var i = 0; i < options.length; i++) if (options[i] && options[i] !== first && splitPickable(options[i])) return options[i];
      return 'home';
    }
    function splitOpen(first, second){
      splitBuild();
      if (!splitPickable(first)) first = 'home';
      if (!splitPickable(second) || second === first) second = splitDefaultSecond(first);
      document.body.classList.add('split-on');
      closeWorkspaceSettings(false);
      if (!isDesktopNav()) closeSideNavDrawer();
      splitPlace();
      splitLoad('a', first);
      splitLoad('b', second);
      // The main page steps back to Home underneath so its own live
      // refreshes stop while the two panes do the work.
      splitInternalNav = true;
      try { selectTab('home', { replace: true }); } finally { splitInternalNav = false; }
      splitState.on = true;
      splitSave();
      splitSyncToggle(true);
    }
    // restore: put the first pane's page back as the full page.
    function splitClose(restore){
      if (!splitIsOn()) return;
      document.body.classList.remove('split-on');
      var first = splitState.a;
      splitState.on = false;
      splitSave();
      splitSyncToggle(false);
      // Unload both panes so their live refreshes stop with them.
      ['a', 'b'].forEach(function(side){ var f = splitFrame(side); if (f) f.src = 'about:blank'; });
      if (restore && splitPickable(first)) selectTab(first);
    }
    if (splitToggle && !IS_EMBED) splitToggle.addEventListener('click', function(){
      if (splitIsOn()) splitClose(true);
      else {
        var active = document.querySelector('[data-page-tab][aria-selected="true"]');
        var current = active ? active.getAttribute('data-page-tab') : 'home';
        splitOpen(current, splitState.b);
      }
    });
    if (splitToggle && IS_EMBED) splitToggle.hidden = true;
    // Called once after the first page is chosen: reopen a split view that
    // was open last time. A ?tab= link fills the first side.
    function splitRestore(){
      if (IS_EMBED || !splitState.on || !splitToggle) return;
      var linked = null;
      try { linked = resolveTab(new URLSearchParams(window.location.search).get('tab')); } catch (_) {}
      splitOpen(linked || splitState.a, splitState.b);
    }
`;
}

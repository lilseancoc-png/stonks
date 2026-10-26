// Wayfinding: the section header + sibling links at the top of each page, the
// previous / next links at the bottom, Home's "Explore by topic" tiles, the
// phone tab bar and "Recently viewed". Everything is drawn from the one site
// map (site-map.mjs) and the sidebar buttons that survived the Owner gate, so
// a page hidden from this visitor never shows up as a link here either.
// Purely presentational: no data fetches, nothing leaves the browser.
import { siteMapForClient } from './site-map.mjs';

// Top-level helpers (outside bindPageTabs) so the Grade tab can note a viewed
// ticker without reaching into the navigation closure.
export function renderWayfindingHelpers() {
  return `
  var SITE_MAP = ${JSON.stringify(siteMapForClient())};
  var RECENT_KEY = 'stonks-recent-v1';
  function wfReadRecent(){
    try {
      var saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(function(v){ return typeof v === 'string'; }).slice(0, 8) : [];
    } catch (_) { return []; }
  }
  function wfNoteRecent(entry){
    if (!entry) return;
    var list = wfReadRecent();
    if (list[0] === entry) return;
    list = [entry].concat(list.filter(function(v){ return v !== entry; })).slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('stonks-recent')); } catch (_) {}
  }
  function wfSectionOf(tabId){
    for (var i = 0; i < SITE_MAP.length; i++){
      var items = SITE_MAP[i][5];
      for (var j = 0; j < items.length; j++) if (items[j][0] === tabId) return { sec: SITE_MAP[i], idx: j };
    }
    return null;
  }
  function wfItem(tabId){
    var hit = wfSectionOf(tabId);
    return hit ? hit.sec[5][hit.idx] : null;
  }
`;
}

// Bound inside bindPageTabs: shares valid / selectTab / toggleSideNav.
export function renderWayfindingBindings() {
  return `
    // A destination is linkable when this visitor can open it: allowed by the
    // Owner gate and still present (not role-hidden) in the sidebar.
    function wfAllowed(id){
      if (valid.indexOf(id) < 0) return false;
      var btn = document.getElementById('page-tab-' + id);
      return !!btn && !btn.hidden && !btn.closest('[hidden]');
    }
    function wfSectionItems(sec, includeHidden){
      return sec[5].filter(function(it){ return wfAllowed(it[0]) && (includeHidden || !it[4]); });
    }
    function wfVisibleSections(){
      return SITE_MAP.filter(function(sec){ return wfSectionItems(sec).length > 0; });
    }
    function wfGo(id){ if (wfAllowed(id)) selectTab(id); }
    function wfLink(cls, id, inner, extra){
      return '<button type="button" class="' + cls + '" data-wf-go="' + id + '"' + (extra || '') + '>' + inner + '</button>';
    }
    // Section header: "Section > Page", the sibling pages as chips, and the
    // plain one-line summary. Previous / next links close the page.
    function renderWayfinding(name){
      if (document.body) document.body.setAttribute('data-active-tab', name);
      syncPhoneTabBar(name);
      if (name === 'home') return;
      var hit = wfSectionOf(name);
      var pane = document.getElementById('page-pane-' + name);
      if (!hit || !pane) return;
      var sec = hit.sec, item = hit.sec[5][hit.idx];
      var head = pane.querySelector(':scope > .wf-head');
      if (!head){
        head = document.createElement('nav');
        head.className = 'wf-head';
        head.setAttribute('aria-label', 'Where you are');
        pane.insertBefore(head, pane.firstChild);
      }
      var siblings = wfSectionItems(sec);
      var firstInSection = siblings[0] ? siblings[0][0] : name;
      head.innerHTML =
        '<div class="wf-crumb">' + wfLink('wf-crumb-link', 'home', 'Home') + '<span aria-hidden="true">/</span>' +
          wfLink('wf-crumb-link', firstInSection, escapeHtml(sec[1])) + '<span aria-hidden="true">/</span>' +
          '<span class="wf-crumb-here" aria-current="page">' + escapeHtml(item[1]) + '</span></div>' +
        (item[3] ? '<p class="wf-blurb">' + escapeHtml(item[3]) + '</p>' : '') +
        (siblings.length > 1 ? '<div class="wf-sibs" role="list" aria-label="More in ' + escapeHtml(sec[1]) + '">' + siblings.map(function(it){
          return wfLink('wf-sib' + (it[0] === name ? ' is-here' : ''), it[0], escapeHtml(it[1]), ' role="listitem"' + (it[0] === name ? ' aria-current="page"' : ''));
        }).join('') + '</div>' : '');
      var foot = pane.querySelector(':scope > .wf-foot');
      if (!foot){
        foot = document.createElement('nav');
        foot.className = 'wf-foot';
        foot.setAttribute('aria-label', 'Previous and next page');
        pane.appendChild(foot);
      }
      // Previous / next walk the visible pages in sidebar order, crossing into
      // the neighbouring section at either end.
      var flat = [];
      wfVisibleSections().forEach(function(s){ wfSectionItems(s).forEach(function(it){ flat.push([it, s]); }); });
      var at = -1;
      for (var i = 0; i < flat.length; i++) if (flat[i][0][0] === name) at = i;
      var prev = at > 0 ? flat[at - 1] : null;
      var next = at >= 0 && at < flat.length - 1 ? flat[at + 1] : null;
      function footLink(entry, dir){
        if (!entry) return '<span></span>';
        var other = entry[1] !== sec;
        return wfLink('wf-step wf-step-' + dir, entry[0][0],
          '<small>' + (dir === 'prev' ? '&larr; Previous' : 'Next &rarr;') + (other ? ' · ' + escapeHtml(entry[1][1]) : '') + '</small><b>' + escapeHtml(entry[0][1]) + '</b>');
      }
      foot.innerHTML = footLink(prev, 'prev') + footLink(next, 'next');
    }
    // Home: one tile per section with its pages listed.
    function renderTopics(){
      var host = document.getElementById('landing-topics');
      if (!host) return;
      // Topic tiles cover the research sections; Learn & help and the
      // private Owner group stay in the sidebar only.
      host.innerHTML = wfVisibleSections().filter(function(sec){ return !sec[4] && sec[0] !== 'learn'; }).map(function(sec){
        var items = wfSectionItems(sec).filter(function(it){ return it[0] !== 'home'; });
        return '<section class="topic-tile" aria-label="' + escapeHtml(sec[1]) + '">' +
          '<header>' + wfLink('topic-title', items[0][0], escapeHtml(sec[1]) + ' <span aria-hidden="true">&rarr;</span>') +
          '<span class="topic-count">' + items.length + ' page' + (items.length === 1 ? '' : 's') + '</span></header>' +
          '<p>' + escapeHtml(sec[3]) + '</p>' +
          '<div class="topic-links">' + items.map(function(it){ return wfLink('topic-link', it[0], escapeHtml(it[1]), ' title="' + escapeHtml(it[3]) + '"'); }).join('') + '</div>' +
        '</section>';
      }).join('');
    }
    // Phone tab bar: highlight the current section; a tap opens the sidebar
    // scrolled to that section, Search opens the command palette.
    var phoneTabBar = document.getElementById('phone-tabbar');
    function syncPhoneTabBar(name){
      if (!phoneTabBar) return;
      var hit = wfSectionOf(name);
      var secId = hit ? hit.sec[0] : '';
      phoneTabBar.querySelectorAll('[data-tabbar-section]').forEach(function(b){
        var on = b.getAttribute('data-tabbar-section') === secId;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    }
    if (phoneTabBar) phoneTabBar.addEventListener('click', function(ev){
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn) return;
      if (btn.hasAttribute('data-tabbar-search')){
        if (sideNavVisible()) closeSideNavDrawer();
        var trigger = document.getElementById('cmd-palette-trigger');
        if (trigger) trigger.click();
        return;
      }
      var secId = btn.getAttribute('data-tabbar-section');
      var group = document.querySelector('details.side-nav-group[data-nav-group="' + secId + '"]');
      if (!group) return;
      // Open the drawer directly (not via the menu button) so the phone
      // keyboard does not pop up for the sidebar filter.
      if (!sideNavVisible()){
        if (isDesktopNav()) toggleSideNav();
        else { document.body.classList.add('sidenav-open'); syncSideNav(); closeWorkspaceSettings(false); }
      }
      group.open = true;
      requestAnimationFrame(function(){
        var tools = document.querySelector('#side-nav .nav-tools');
        group.style.scrollMarginTop = ((tools ? tools.offsetHeight : 0) + 8) + 'px';
        try { group.scrollIntoView({ block: 'start' }); } catch (_) {}
        var first = group.querySelector('[data-page-tab]:not([data-nav-hidden])');
        if (first) first.focus({ preventScroll: true });
      });
      group.classList.remove('is-flash'); void group.offsetWidth; group.classList.add('is-flash');
    });
    // Recently viewed (this browser only): pages and stocks, newest first.
    var recentSection = document.getElementById('workspace-recent');
    var recentList = document.getElementById('workspace-recent-list');
    function renderRecent(){
      if (!recentList) return;
      var active = document.querySelector('[data-page-tab][aria-selected="true"]');
      var current = active ? active.getAttribute('data-page-tab') : '';
      var html = wfReadRecent().filter(function(entry){
        var kind = entry.slice(0, 4), id = entry.slice(4);
        if (kind === 'tab:') return id !== current && wfAllowed(id) && !!wfItem(id);
        return kind === 'sym:' && SYMBOLS.indexOf(id) >= 0 && wfAllowed('grade');
      }).slice(0, 5).map(function(entry){
        var id = entry.slice(4);
        if (entry.slice(0, 4) === 'sym:') return '<button type="button" class="recent-chip is-sym" data-wf-sym="' + escapeHtml(id) + '">' + escapeHtml(id) + '</button>';
        return wfLink('recent-chip', id, escapeHtml(wfItem(id)[1]));
      }).join('');
      recentList.innerHTML = html;
      var filtering = !!(document.getElementById('nav-filter') || {}).value;
      if (recentSection) recentSection.hidden = !html || filtering;
    }
    document.addEventListener('stonks-recent', renderRecent);
    function wfOpenTicker(sym){
      selectTab('grade');
      setTimeout(function(){ try { combo.commit(sym); } catch (_) {} }, 0);
    }
    // One delegated listener serves every wayfinding link on the page.
    document.addEventListener('click', function(ev){
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-wf-go], [data-wf-sym]') : null;
      if (!t) return;
      ev.preventDefault();
      if (t.hasAttribute('data-wf-sym')) wfOpenTicker(t.getAttribute('data-wf-sym'));
      else wfGo(t.getAttribute('data-wf-go'));
    });
    function noteWayfindingVisit(name){
      if (name !== 'home' && name !== 'grade') wfNoteRecent('tab:' + name);
      renderRecent();
    }
    renderTopics();
    renderRecent();
`;
}

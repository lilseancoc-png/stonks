// Owner Settings page (Owner · Admin → Settings). The catalog, values,
// history and the last build's report all come from /api/auth/owner-settings
// (lib/owner-settings.mjs), so this file only draws them and posts clicks.
// Serialized into app.js with toString(): ES5 only, self-contained.

export function ownerSettingsSection() {
  return `<section class="card" id="owner-settings-section">
    <header class="card-header"><h2 class="card-title">Settings</h2></header>
    <p class="hint">Owner only. Change these here instead of in the repo. Build settings apply from the next build, and Top Picks settings from the next 11:00 or 15:30 ET run. Live site switches apply within a minute. Models, AI budgets, exits, grading weights, schedules and the stock list stay in the repo. Settings marked <strong class="os-impact-inline">Big impact</strong> in red change how Mingstreet trades or runs, and ask you to confirm first.</p>
    <div id="owner-settings-root" aria-live="polite"></div>
  </section>`;
}

export function ownerSettingsClient(window, document, ctx) {
  var data = null, error = '', busy = false, loading = false, generation = 0;
  var TAB_KEY = 'stonks-owner-settings-tab';
  var tab = null, query = '', changedOnly = false, highOnly = false, collapsed = {};
  // The open "are you sure" box: { title, intro, items, yes, body } or null.
  var ask = null, refocus = null;
  try { tab = window.localStorage.getItem(TAB_KEY); } catch (e) { tab = null; }
  // Leaving the page with the box open (Back button) closes it unsaved.
  window.addEventListener('popstate', function(){
    if (!ask) return;
    ask = null; refocus = null;
    var h = document.getElementById('os-ask-host'); if (h) h.parentNode.removeChild(h);
  });
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  // Times in ET, like the rest of the site's schedule (11:00 / 15:30 ET runs).
  function when(v){
    var n = Date.parse(v); if (!isFinite(n)) return '—';
    try { return new Date(n).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; }
    catch (e) { return new Date(n).toLocaleString(); }
  }
  function fmt(s, v){
    if (s.kind === 'switch') return v ? 'On' : 'Off';
    if (s.kind === 'choice') { for (var i = 0; i < (s.options || []).length; i++) if (s.options[i][0] === v) return s.options[i][1]; return String(v); }
    if (s.unit === '$') return '$' + Number(v).toLocaleString('en-US');
    if (s.unit === 'days') return v + (Number(v) === 1 ? ' day' : ' days');
    return String(v);
  }
  function byKey(k){ var list = (data && data.settings) || []; for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i]; return null; }
  function lockedNow(s, v){
    if (!s.lockedUntil || v === s.default) return false;
    return s.lockedValues ? s.lockedValues.indexOf(v) >= 0 : true;
  }
  function changeText(c){
    var s = byKey(c.key); if (!s) return esc(c.key);
    var f = c.from == null ? s.default : c.from, t = c.to == null ? s.default : c.to;
    return esc(s.label) + ': ' + esc(fmt(s, f)) + ' → ' + esc(fmt(s, t)) + (c.to == null ? ' (default)' : '');
  }
  function control(s){
    var dis = (busy || s.pinned) ? ' disabled' : '';
    var id = 'os-' + s.key;
    if (s.kind === 'switch') {
      var lockOn = lockedNow(s, true) && !s.value;
      return '<label class="os-switch"><input type="checkbox" id="' + id + '" data-os-key="' + esc(s.key) + '"' + (s.value ? ' checked' : '') + (dis || (lockOn ? ' disabled' : '')) + '> <span>' + (s.value ? 'On' : 'Off') + '</span></label>';
    }
    if (s.kind === 'choice') {
      return '<select id="' + id + '" data-os-key="' + esc(s.key) + '"' + dis + '>' + s.options.map(function(o){
        var lock = lockedNow(s, o[0]) && s.value !== o[0];
        return '<option value="' + esc(o[0]) + '"' + (s.value === o[0] ? ' selected' : '') + (lock ? ' disabled' : '') + '>' + esc(o[1]) + (lock ? ' (from ' + esc(s.lockedUntil) + ')' : '') + '</option>';
      }).join('') + '</select>';
    }
    return '<span class="os-num"><input type="number" id="' + id + '" data-os-num="' + esc(s.key) + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '" value="' + esc(s.value) + '"' + dis + ' inputmode="decimal"> <button type="button" class="book-more" data-os-save="' + esc(s.key) + '"' + dis + '>Save</button></span>';
  }
  function row(s){
    var tags = [];
    if (s.impact === 'high') tags.push('<span class="os-tag os-tag-high">Big impact</span>');
    if (s.changed) tags.push('<span class="os-tag os-tag-changed">Changed</span>');
    if (s.picks) tags.push('<span class="os-tag" title="New trades are stamped with this setting and the Track Record draws a dated divider when it changes.">Changes picks</span>');
    if (s.scope === 'site') tags.push('<span class="os-tag">Live</span>');
    var notes = [];
    if (s.pinned) notes.push('Pinned by a repo variable, so the repo value wins. Ask Sean to clear the variable to control it here.');
    if (s.vercelOff) notes.push('Off in Vercel, so it stays off whatever this says.');
    if (s.lockedUntil) notes.push('Can be turned on from ' + esc(s.lockedUntil) + '.');
    return '<div class="os-row' + (s.impact === 'high' ? ' os-row-high' : '') + '" data-os-row="' + esc(s.key) + '"><div class="os-main"><div class="os-label">' + esc(s.label) + ' ' + tags.join(' ') + '</div>' +
      '<p class="os-help">' + esc(s.help) + '</p>' +
      (s.impact === 'high' && s.warn ? '<p class="os-impact"><strong>Big impact: ' + esc(s.warn) + '</strong></p>' : '') +
      '<p class="os-meta">Default: ' + esc(fmt(s, s.default)) + (s.changed ? ' · <button type="button" class="os-link" data-os-reset="' + esc(s.key) + '"' + (busy ? ' disabled' : '') + '>Reset to default</button>' : '') + '</p>' +
      (notes.length ? '<p class="os-note">' + notes.join(' ') + '</p>' : '') + '</div>' +
      '<div class="os-ctl">' + control(s) + '</div></div>';
  }
  function appliedHtml(a){
    if (!a) return '<p class="os-muted">No build has read these settings yet.</p>';
    var keys = Object.keys(a.applied || {});
    var html = '<p class="os-muted">Last build to read them: ' + esc(when(a.builtAtIso || a.appliedAt)) + ' · ' + (keys.length ? 'used ' + keys.length + ' changed setting' + (keys.length === 1 ? '' : 's') : 'all defaults') + '.</p>';
    if (a.skipped && a.skipped.length) html += '<p class="os-note">Skipped: ' + a.skipped.map(function(x){ var s = byKey(x.key); return esc(s ? s.label : x.key) + ' (' + esc(x.reason) + ')'; }).join(', ') + '.</p>';
    if (data && data.updatedAt && a.settingsUpdatedAt !== data.updatedAt) html += '<p class="os-note">Your newest change has not reached a build yet.</p>';
    return html;
  }
  function historyHtml(list){
    if (!list || !list.length) return '<p class="os-muted">No changes yet. Every setting is on its default.</p>';
    var word = { set: 'Changed', reset: 'Reset', 'reset-all': 'Reset everything', undo: 'Undid a change' };
    return '<ol class="os-history">' + list.slice(0, 20).map(function(h){
      return '<li' + (h.undone ? ' class="os-undone"' : '') + '><span class="os-when">' + esc(when(h.at)) + (h.by ? ' · ' + esc(h.by) : '') + '</span> <strong>' + esc(word[h.kind] || h.kind) + '</strong>' + (h.undone ? ' <em>(undone)</em>' : '') +
        (h.changes && h.changes.length ? '<br>' + h.changes.map(changeText).join('<br>') : '') + '</li>';
    }).join('') + '</ol>';
  }
  function tabsOf(){
    var out = [];
    (data.settings || []).forEach(function(x){ if (out.indexOf(x.tab || x.group) < 0) out.push(x.tab || x.group); });
    out.push('Display'); out.push('History');
    return out;
  }
  function tabCount(t){
    if (t === 'Display') return displayChanged();
    if (t === 'History') return 0;
    return (data.settings || []).filter(function(x){ return (x.tab || x.group) === t && x.changed; }).length;
  }
  function matches(x){
    if (changedOnly && !x.changed) return false;
    if (highOnly && x.impact !== 'high') return false;
    if (!query) return true;
    var hay = (x.label + ' ' + x.help + ' ' + (x.warn || '') + ' ' + (x.impact === 'high' ? 'big impact ' : '') + (x.tab || '') + ' ' + (x.group || '') + ' ' + x.key).toLowerCase();
    return query.toLowerCase().split(/\s+/).every(function(w){ return !w || hay.indexOf(w) >= 0; });
  }
  function sectionsHtml(list, withTab){
    var groups = [];
    list.forEach(function(x){ var g = (withTab ? (x.tab || '') + ' · ' : '') + (x.group || ''); if (groups.indexOf(g) < 0) groups.push(g); });
    return groups.map(function(g){
      var items = list.filter(function(x){ return (withTab ? (x.tab || '') + ' · ' : '') + (x.group || '') === g; });
      var changed = items.filter(function(x){ return x.changed; }).length;
      // Sections fold like a game's settings menu; a search always shows them open.
      return '<details class="os-group os-fold"' + (withTab || !collapsed[g] ? ' open' : '') + ' data-os-fold="' + esc(g) + '"><summary><h3>' + esc(g) + ' <span class="os-sub">' + items.length + (changed ? ' · ' + changed + ' changed' : '') + '</span></h3></summary>' + items.map(row).join('') + '</details>';
    }).join('');
  }
  function render(){
    var root = document.getElementById('owner-settings-root'); if (!root || !ctx.owner()) return;
    // The "are you sure" box lives on <body> so no page layer can sit over it.
    var host = document.getElementById('os-ask-host');
    var act = document.activeElement;
    var focusId = act && (root.contains(act) || (host && host.contains(act))) ? act.id : null;
    var caret = focusId === 'os-search' ? document.activeElement.selectionStart : null;
    var html = '';
    if (error) html += '<p class="os-warn" role="status">' + esc(error) + '</p>';
    if (!data) { root.innerHTML = html + '<p>' + (loading ? 'Loading settings…' : 'Settings not loaded.') + '</p>'; return; }
    var canUndo = (data.history || []).some(function(h){ return h.kind !== 'undo' && !h.undone; });
    var anyChanged = data.settings.some(function(x){ return x.changed; });
    html += '<div class="os-toolbar"><button type="button" class="book-more" data-os-undo' + (busy || !canUndo ? ' disabled' : '') + '>Undo last change</button>' +
      '<button type="button" class="book-more" data-os-resetall' + (busy || !anyChanged ? ' disabled' : '') + '>Reset all to defaults</button>' +
      '<button type="button" class="book-more" data-os-go="picks">Market mode (Top Picks) →</button>' +
      '<button type="button" class="book-more" data-os-refresh' + (busy ? ' disabled' : '') + '>Refresh</button></div>';
    html += appliedHtml(data.applied);
    var tabs = tabsOf();
    if (tabs.indexOf(tab) < 0) tab = tabs[0];
    html += '<div class="os-find"><input type="search" id="os-search" placeholder="Search settings" aria-label="Search settings" value="' + esc(query) + '">' +
      '<label class="os-switch"><input type="checkbox" id="os-changed-only"' + (changedOnly ? ' checked' : '') + '> <span>Changed only</span></label>' +
      '<label class="os-switch"><input type="checkbox" id="os-high-only"' + (highOnly ? ' checked' : '') + '> <span>Big impact only</span></label></div>';
    var searching = !!query || changedOnly || highOnly;
    html += '<div class="os-layout' + (searching ? ' os-searching' : '') + '"><div class="os-tabs" role="tablist" aria-label="Settings sections">' + tabs.map(function(t){
      var n = tabCount(t), on = !searching && t === tab;
      return '<button type="button" role="tab" class="os-tab' + (on ? ' is-on' : '') + '" aria-selected="' + (on ? 'true' : 'false') + '" data-os-tab="' + esc(t) + '">' + esc(t) + (n ? ' <span class="os-count" title="' + n + ' changed">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div><div class="os-panel" role="tabpanel">';
    if (searching) {
      var hits = data.settings.filter(matches);
      var dhits = highOnly ? [] : displayRows().filter(function(x){ return matches(x); });
      html += '<p class="os-muted">' + (hits.length + dhits.length) + ' setting' + (hits.length + dhits.length === 1 ? '' : 's') + ' found.' + ' <button type="button" class="os-link" data-os-clear>Clear</button></p>';
      html += sectionsHtml(hits, true);
      if (dhits.length) html += '<section class="os-group"><h3>Display · This device</h3>' + dhits.map(displayRow).join('') + '</section>';
    } else if (tab === 'History') {
      html += '<section class="os-group"><h3>Change history</h3>' + historyHtml(data.history) + '</section>';
    } else if (tab === 'Display') {
      html += '<p class="os-muted">These apply only to this browser on this device and take effect at once. They are not saved to the site.</p>';
      html += '<section class="os-group"><h3>This device</h3>' + displayRows().map(displayRow).join('') + '</section>';
      html += '<p><button type="button" class="book-more" data-os-display-reset' + (displayChanged() ? '' : ' disabled') + '>Reset display settings</button></p>';
    } else {
      html += sectionsHtml(data.settings.filter(function(x){ return (x.tab || x.group) === tab; }), false);
    }
    html += '</div></div>';
    root.innerHTML = html;
    bind(root);
    if (ask) {
      if (!host) { host = document.createElement('div'); host.id = 'os-ask-host'; document.body.appendChild(host); }
      host.innerHTML = askHtml(ask);
      bindAsk(host);
    } else if (host) host.parentNode.removeChild(host);
    if (ask) { if (!focusId || !/^os-ask-/.test(focusId)) focusId = 'os-ask-no'; }
    else if (refocus) { if (!focusId || /^os-ask-/.test(focusId)) focusId = refocus; refocus = null; }
    if (focusId) { var f = document.getElementById(focusId); if (f) { f.focus(); if (caret != null && f.setSelectionRange) { try { f.setSelectionRange(caret, caret); } catch (e) {} } } }
  }
  // --- Display (this device only; localStorage) ---------------------------------
  var DISPLAY = [
    { key: 'theme', label: 'Theme', help: 'Auto follows your device.', options: [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']], def: 'auto' },
    { key: 'text', label: 'Text size', help: 'Size of the text on every page (the header and menu keep their size).', options: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra large']], def: 'normal' },
    { key: 'density', label: 'Layout density', help: 'Compact tightens spacing on cards and tables so more fits on screen.', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']], def: 'comfortable' },
    { key: 'motion', label: 'Motion', help: 'Reduce turns off animations and smooth scrolling.', options: [['system', 'Follow device'], ['reduce', 'Reduce']], def: 'system' },
    { key: 'start', label: 'Start page', help: 'The page that opens when you visit the site with no page in the link.', options: [['home', 'Home'], ['owner-market-brief', 'Owner Market Brief'], ['picks', 'Top picks'], ['open-picks', 'Open picks'], ['track', 'Top Picks track record'], ['brief', 'Market brief'], ['heatmap', 'Heatmap'], ['calendar', 'Calendar']], def: 'home' }
  ];
  function displayPrefs(){ var p = {}; try { p = JSON.parse(window.localStorage.getItem('stonks-display-v1') || '{}') || {}; } catch (e) { p = {}; } var t = null; try { t = window.localStorage.getItem('stonks-theme'); } catch (e) {} p.theme = t === 'dark' || t === 'light' ? t : 'auto'; return p; }
  function displayRows(){
    var p = displayPrefs();
    return DISPLAY.map(function(d){ var v = p[d.key] || d.def; var ok = d.options.some(function(o){ return o[0] === v; }); v = ok ? v : d.def; return { key: d.key, label: d.label, help: d.help, tab: 'Display', group: 'This device', options: d.options, value: v, def: d.def, changed: v !== d.def }; });
  }
  function displayChanged(){ return displayRows().filter(function(x){ return x.changed; }).length; }
  function displayRow(x){
    var label = function(v){ for (var i = 0; i < x.options.length; i++) if (x.options[i][0] === v) return x.options[i][1]; return v; };
    return '<div class="os-row" data-os-row="display-' + esc(x.key) + '"><div class="os-main"><div class="os-label">' + esc(x.label) + (x.changed ? ' <span class="os-tag os-tag-changed">Changed</span>' : '') + ' <span class="os-tag">This device</span></div>' +
      '<p class="os-help">' + esc(x.help) + '</p><p class="os-meta">Default: ' + esc(label(x.def)) + '</p></div>' +
      '<div class="os-ctl"><select id="os-display-' + esc(x.key) + '" data-os-display="' + esc(x.key) + '">' + x.options.map(function(o){ return '<option value="' + esc(o[0]) + '"' + (o[0] === x.value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div></div>';
  }
  function setDisplay(key, value){
    try {
      if (key === 'theme') {
        if (value === 'auto') window.localStorage.removeItem('stonks-theme'); else window.localStorage.setItem('stonks-theme', value);
      } else {
        var p = {}; try { p = JSON.parse(window.localStorage.getItem('stonks-display-v1') || '{}') || {}; } catch (e) { p = {}; }
        delete p.theme;
        var d = null; for (var i = 0; i < DISPLAY.length; i++) if (DISPLAY[i].key === key) d = DISPLAY[i];
        if (d && value === d.def) delete p[key]; else p[key] = value;
        if (Object.keys(p).length) window.localStorage.setItem('stonks-display-v1', JSON.stringify(p)); else window.localStorage.removeItem('stonks-display-v1');
      }
    } catch (e) { error = 'This browser would not save display settings.'; }
    if (ctx.applyDisplay) ctx.applyDisplay();
    render();
  }
  function call(method, body){
    var gen = generation;
    var opts = { method: method, cache: 'no-store', credentials: 'same-origin' };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return fetch('/api/auth/owner-settings', opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (gen !== generation) return null;
        if (r.status === 401) { ctx.revoke(); throw new Error('Sign in again to change settings.'); }
        if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.needsConfirm = !!j.needsConfirm; throw e; }
        if (!j || !Array.isArray(j.settings)) throw new Error('Settings unavailable right now. Try Refresh in a minute.');
        return j;
      });
    });
  }
  function load(){
    if (!ctx.owner() || loading) return;
    loading = true; error = ''; render();
    call('GET').then(function(j){ if (j) data = j; }).catch(function(e){ error = e.message || 'Settings unavailable.'; })
      .then(function(){ loading = false; render(); });
  }
  function post(body){
    if (busy) return;
    busy = true; error = ''; render();
    call('POST', body).then(function(j){ if (j) data = j; }).catch(function(e){
      // The server asked for an "are you sure" this page didn't know about
      // (an older copy of the page): ask now instead of failing.
      if (e.needsConfirm && !body.confirm) { var b2 = {}; for (var k in body) b2[k] = body[k]; b2.confirm = true; ask = { title: 'Are you sure?', intro: String(e.message || '').replace(/: needs confirmation$/, '') + ' has a big impact on Mingstreet.', items: [], body: b2, high: true }; return; }
      error = e.message || 'Could not save.';
    })
      .then(function(){ busy = false; render(); });
  }
  // --- "Are you sure" ------------------------------------------------------------
  // Every change to a big-impact setting (and the Dec 7 hooks) opens this box
  // first. The server refuses those changes without body.confirm, so a stale
  // page can't skip it.
  function item(s, from, to){ return { label: s.label, from: fmt(s, from), to: fmt(s, to), toDefault: to === s.default, high: s.impact === 'high', warn: s.warn || '', help: s.help, locked: !!s.lockedUntil }; }
  function askHtml(a){
    var list = a.items.map(function(it){
      return '<li' + (it.high ? ' class="os-ask-high"' : '') + '><strong>' + esc(it.label) + ':</strong> ' + esc(it.from) + ' → ' + esc(it.to) + (it.toDefault ? ' (default)' : '') +
        (it.high && it.warn && !it.toDefault ? '<p class="os-impact"><strong>' + esc(it.warn) + '</strong></p>' : '') +
        (it.high && it.toDefault ? '<p class="os-ask-note">This puts it back to the default.</p>' : '') + '</li>';
    }).join('');
    var high = !!a.high || a.items.some(function(it){ return it.high && !it.toDefault; });
    return '<div class="os-ask-back" data-os-ask-back><div class="os-ask" role="alertdialog" aria-modal="true" aria-labelledby="os-ask-title" aria-describedby="os-ask-text">' +
      '<h3 id="os-ask-title">' + esc(a.title) + '</h3>' +
      '<div id="os-ask-text">' + (a.intro ? '<p class="os-ask-note">' + esc(a.intro) + '</p>' : '') + (list ? '<ul class="os-ask-list">' + list + '</ul>' : '') +
      (high ? '<p class="os-impact"><strong>This has a big impact on Mingstreet. Are you sure?</strong></p>' : '<p class="os-ask-note">Are you sure?</p>') + '</div>' +
      '<div class="os-ask-btns"><button type="button" class="book-more" id="os-ask-no" data-os-ask-no>Cancel</button>' +
      '<button type="button" class="book-more' + (high ? ' os-danger' : '') + '" id="os-ask-yes" data-os-ask-yes>' + esc(a.yes || 'Yes, change it') + '</button></div></div></div>';
  }
  function confirmThen(a){ ask = a; refocus = document.activeElement && document.activeElement.id || null; render(); }
  function needsAsk(s){ return !!(s && (s.impact === 'high' || s.confirm)); }
  function setOne(key, value){
    var s = byKey(key); if (!s) return;
    var body = { act: 'set', values: {} }; body.values[key] = value;
    if (value === s.value) { render(); return; }
    if (needsAsk(s)) {
      body.confirm = true;
      confirmThen({ title: 'Change ' + s.label + '?', items: [item(s, s.value, value)], body: body,
        intro: s.picks ? 'New Top Picks trades are stamped with this setting and the Track Record draws a divider. Open trades are not touched.' : '' });
      return;
    }
    post(body);
  }
  function lastChange(){ var list = (data && data.history) || []; for (var i = 0; i < list.length; i++) if (list[i].kind !== 'undo' && !list[i].undone) return list[i]; return null; }
  function undoNow(){
    var last = lastChange(); if (!last) return;
    var items = [], big = false;
    (last.changes || []).forEach(function(c){ var s = byKey(c.key); if (!s) return; var f = c.to == null ? s.default : c.to, t = c.from == null ? s.default : c.from; items.push(item(s, f, t)); if (needsAsk(s)) big = true; });
    if (!big) { post({ act: 'undo' }); return; }
    confirmThen({ title: 'Undo the last change?', intro: 'Undo puts these back the way they were.', items: items, body: { act: 'undo', confirm: true }, yes: 'Yes, undo it' });
  }
  function resetOne(key){
    var s = byKey(key); if (!s) return;
    if (!needsAsk(s)) { post({ act: 'reset', key: key }); return; }
    confirmThen({ title: 'Reset ' + s.label + '?', items: [item(s, s.value, s.default)], body: { act: 'reset', key: key }, yes: 'Yes, reset it' });
  }
  function resetAll(){
    var items = (data.settings || []).filter(function(x){ return x.changed; }).map(function(x){ return item(x, x.value, x.default); });
    if (!items.length) return;
    confirmThen({ title: 'Reset every setting?', intro: 'This puts every setting on the site back to its default. Display settings on this device are not touched.', items: items, body: { act: 'reset-all' }, yes: 'Yes, reset all' });
  }
  function bind(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-key]'), function(el){
      el.addEventListener('change', function(){ setOne(el.getAttribute('data-os-key'), el.type === 'checkbox' ? el.checked : el.value); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-save]'), function(el){
      el.addEventListener('click', function(){
        var k = el.getAttribute('data-os-save'), s = byKey(k), input = document.getElementById('os-' + k);
        if (!s || !input) return;
        var v = Number(input.value);
        var off = Math.abs((v - s.min) / s.step - Math.round((v - s.min) / s.step));
        if (input.value === '' || !isFinite(v) || v < s.min || v > s.max || off > 1e-6) { error = s.label + ' must be between ' + fmt(s, s.min) + ' and ' + fmt(s, s.max) + (s.step !== 1 ? ', in steps of ' + fmt(s, s.step) : '') + '.'; render(); return; }
        setOne(k, v);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-reset]'), function(el){
      el.addEventListener('click', function(){ resetOne(el.getAttribute('data-os-reset')); });
    });
    var u = root.querySelector('[data-os-undo]'); if (u) u.addEventListener('click', undoNow);
    var ra = root.querySelector('[data-os-resetall]'); if (ra) ra.addEventListener('click', resetAll);
    var rf = root.querySelector('[data-os-refresh]'); if (rf) rf.addEventListener('click', load);
    bindRest(root);
  }
  function bindAsk(host){
    var box = host.querySelector('[data-os-ask-back]');
    if (box) {
      var no = function(){ ask = null; render(); };
      host.querySelector('[data-os-ask-no]').addEventListener('click', no);
      host.querySelector('[data-os-ask-yes]').addEventListener('click', function(){ var b = ask && ask.body; ask = null; if (b) post(b); else render(); });
      box.addEventListener('click', function(ev){ if (ev.target === box) no(); });
      box.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape') { ev.preventDefault(); no(); return; }
        if (ev.key === 'Tab') {
          // Keep focus inside the box.
          var a = document.getElementById('os-ask-no'), b = document.getElementById('os-ask-yes');
          if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); b.focus(); }
          else if (!ev.shiftKey && document.activeElement === b) { ev.preventDefault(); a.focus(); }
        }
      });
    }
  }
  function bindRest(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-tab]'), function(el){
      el.addEventListener('click', function(){ tab = el.getAttribute('data-os-tab'); query = ''; changedOnly = false; highOnly = false; try { window.localStorage.setItem(TAB_KEY, tab); } catch (e) {} render(); var b = document.querySelector('[data-os-tab="' + tab.replace(/"/g, '') + '"]'); if (b) b.focus(); });
      el.addEventListener('keydown', function(ev){
        var list = Array.prototype.slice.call(root.querySelectorAll('[data-os-tab]')), i = list.indexOf(el), next = null;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') next = list[(i + 1) % list.length];
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') next = list[(i - 1 + list.length) % list.length];
        if (next) { ev.preventDefault(); next.click(); }
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-fold]'), function(el){
      el.addEventListener('toggle', function(){ if (!query && !changedOnly && !highOnly) collapsed[el.getAttribute('data-os-fold')] = !el.open; });
    });
    var sr = root.querySelector('#os-search'); if (sr) sr.addEventListener('input', function(){ query = sr.value; render(); });
    var co = root.querySelector('#os-changed-only'); if (co) co.addEventListener('change', function(){ changedOnly = co.checked; render(); });
    var ho = root.querySelector('#os-high-only'); if (ho) ho.addEventListener('change', function(){ highOnly = ho.checked; render(); });
    var cl = root.querySelector('[data-os-clear]'); if (cl) cl.addEventListener('click', function(){ query = ''; changedOnly = false; highOnly = false; render(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-display]'), function(el){
      el.addEventListener('change', function(){ setDisplay(el.getAttribute('data-os-display'), el.value); });
    });
    var dr = root.querySelector('[data-os-display-reset]'); if (dr) dr.addEventListener('click', function(){ DISPLAY.forEach(function(d){ setDisplay(d.key, d.def); }); });
    var go = root.querySelector('[data-os-go]'); if (go) go.addEventListener('click', function(){ ctx.go(go.getAttribute('data-os-go')); });
  }
  function reset(){ generation++; data = null; error = ''; busy = false; loading = false; ask = null; var root = document.getElementById('owner-settings-root'); if (root) root.innerHTML = ''; var host = document.getElementById('os-ask-host'); if (host) host.parentNode.removeChild(host); }
  return { load: load, reset: reset };
}


// Display settings for this device (Owner Settings → Display). Runs at the top
// of app.js for every visitor on this browser, before the first tab is chosen,
// so the start page and text size apply without a flash. ES5, self-contained.
export function ownerDisplayBoot(window, document){
  function apply(){
    var p = {}; try { p = JSON.parse(window.localStorage.getItem('stonks-display-v1') || '{}') || {}; } catch (e) { p = {}; }
    var html = document.documentElement;
    var t = null; try { t = window.localStorage.getItem('stonks-theme'); } catch (e) {}
    if (!t) { var light = false; try { light = window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {} html.setAttribute('data-theme', light ? 'light' : 'dark'); }
    else if (t === 'dark' || t === 'light') html.setAttribute('data-theme', t);
    var text = { small: 1, large: 1, xl: 1 }[p.text] ? p.text : null;
    if (text) html.setAttribute('data-text-size', text); else html.removeAttribute('data-text-size');
    if (p.density === 'compact') html.setAttribute('data-density', 'compact'); else html.removeAttribute('data-density');
    if (p.motion === 'reduce') html.classList.add('reduce-motion'); else html.classList.remove('reduce-motion');
    return p;
  }
  var p = apply();
  // Start page: only for a bare visit (no page, ticker or other link state),
  // never inside a split-view pane.
  try {
    var start = typeof p.start === 'string' && /^[a-z0-9-]{2,40}$/.test(p.start) ? p.start : '';
    if (start && start !== 'home' && !window.location.search && !window.location.hash && window.self === window.top && window.history && window.history.replaceState) {
      window.history.replaceState(window.history.state, '', window.location.pathname + '?tab=' + start);
    }
  } catch (e) {}
  return apply;
}

export const ownerSettingsCss = `
#owner-settings-section { max-width: 1080px; }
.os-find { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin: 14px 0 10px; }
.os-find input[type=search] { flex: 1 1 260px; min-width: 0; font: inherit; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface, transparent); color: var(--text); }
.os-layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; align-items: start; }
.os-tabs { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 72px; }
.os-tab { display: flex; justify-content: space-between; align-items: center; gap: 8px; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: none; color: var(--muted); font: 500 14px/1.3 var(--font-sans); cursor: pointer; min-height: 0; }
.os-tab:hover { color: var(--text); background: var(--surface-2, rgba(127,127,127,.08)); }
.os-tab.is-on { color: var(--text); border-color: var(--border); background: var(--surface-2, rgba(127,127,127,.1)); font-weight: 600; }
.os-searching .os-tab { opacity: .7; }
.os-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent, #c9a227); color: var(--bg, #111); font: 600 11px/18px var(--font-sans); text-align: center; }
.os-panel { min-width: 0; }
.os-fold > summary { list-style: none; cursor: pointer; }
.os-fold > summary::-webkit-details-marker { display: none; }
.os-fold > summary h3 { display: flex; align-items: baseline; gap: 8px; }
.os-fold > summary h3::before { content: '▾'; font-size: 12px; color: var(--muted); transition: transform .15s; }
.os-fold:not([open]) > summary h3::before { transform: rotate(-90deg); }
.os-fold:not([open]) { margin-bottom: 4px; }
.os-sub { font: 500 12px/1 var(--font-sans); color: var(--muted); }
.os-panel > .os-group:first-child, .os-panel > .os-muted:first-child + .os-group { margin-top: 0; }
@media (max-width: 760px) {
  .os-layout { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .os-tabs { flex-direction: row; overflow-x: auto; position: static; padding-bottom: 4px; scrollbar-width: thin; }
  .os-tab { flex: 0 0 auto; white-space: nowrap; }
}
/* Display settings (this device) */
html[data-text-size="small"] .page-pane { --ts: 1; }
html[data-text-size="large"] .page-pane { --ts: 1.2; }
html[data-text-size="xl"] .page-pane { --ts: 1.32; }
html[data-density="compact"] .page-pane .card { padding-top: 12px; padding-bottom: 12px; }
html[data-density="compact"] .page-pane .card + .card { margin-top: 10px; }
html[data-density="compact"] .page-pane table td, html[data-density="compact"] .page-pane table th { padding-top: 4px; padding-bottom: 4px; }
html.reduce-motion *, html.reduce-motion *::before, html.reduce-motion *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
.os-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.os-group { margin-top: 22px; }
.os-group h3 { font: 600 15px/1.3 var(--font-sans); margin: 0 0 6px; }
.os-row { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--border); }
.os-main { min-width: 0; flex: 1 1 auto; }
.os-label { font: 600 14px/1.4 var(--font-sans); color: var(--text); }
.os-help, .os-meta, .os-note, .os-muted { margin: 4px 0 0; font-size: 13px; line-height: 1.45; color: var(--muted); }
.os-note { color: var(--text); }
.os-warn { margin: 8px 0; padding: 8px 10px; border-radius: 8px; background: var(--surface-2, rgba(200,60,60,.08)); color: var(--text); }
.os-ctl { flex: 0 0 auto; display: flex; align-items: center; }
.os-ctl select, .os-num input { font: inherit; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface, transparent); color: var(--text); }
.os-num input { width: 110px; }
.os-switch { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; font-size: 13px; }
.os-switch input { width: 18px; height: 18px; }
.os-tag { display: inline-block; margin-left: 4px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); font: 500 11px/1.6 var(--font-sans); color: var(--muted); vertical-align: middle; }
.os-tag-changed { color: var(--text); border-color: currentColor; }
/* Big-impact settings: bold red warning, red edge, and the are-you-sure box. */
.os-tag-high { color: var(--neg, #d8453f); border-color: currentColor; font-weight: 700; }
.os-row-high { border-left: 3px solid var(--neg, #d8453f); padding-left: 12px; }
.os-impact { margin: 6px 0 0; font-size: 13px; line-height: 1.45; color: var(--neg, #d8453f); }
.os-impact strong { font-weight: 700; }
.os-impact-inline { color: var(--neg, #d8453f); }
.os-ask-back { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.55); }
.os-ask { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 18px 20px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface, var(--bg, #fff)); color: var(--text); box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.os-ask h3 { margin: 0 0 8px; font: 700 17px/1.3 var(--font-sans); }
.os-ask-list { margin: 8px 0; padding-left: 18px; font-size: 14px; line-height: 1.45; }
.os-ask-list li { margin: 0 0 8px; }
.os-ask-note { margin: 4px 0; font-size: 13px; color: var(--muted); }
.os-ask-btns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.os-danger { background: var(--neg, #d8453f) !important; border-color: var(--neg, #d8453f) !important; color: #fff !important; font-weight: 700; }
.os-link { background: none; border: 0; padding: 0; color: var(--accent, inherit); text-decoration: underline; cursor: pointer; font: inherit; }
.os-history { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; }
.os-history li { margin: 0 0 8px; }
.os-history .os-undone { opacity: .6; }
.os-when { color: var(--muted); }
@media (max-width: 640px) { .os-row { flex-direction: column; gap: 8px; } }
`;

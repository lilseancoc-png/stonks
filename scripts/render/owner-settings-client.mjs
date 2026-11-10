// Owner Settings page (Owner · Admin → Settings). The catalog, values,
// history and the last build's report all come from /api/auth/owner-settings
// (lib/owner-settings.mjs), so this file only draws them and posts clicks.
// Serialized into app.js with toString(): ES5 only, self-contained.

export function ownerSettingsSection() {
  return `<section class="card" id="owner-settings-section">
    <header class="card-header"><h2 class="card-title">Settings</h2></header>
    <p class="hint">Owner only. Change these here instead of in the repo. Build settings apply from the next build, and Top Picks settings from the next 11:00 or 15:30 ET run. Live site switches apply within a minute. Models, AI budgets, exits, grading weights, schedules and the stock list stay in the repo.</p>
    <div id="owner-settings-root" aria-live="polite"></div>
  </section>`;
}

export function ownerSettingsClient(window, document, ctx) {
  var data = null, error = '', busy = false, loading = false, generation = 0;
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function when(v){ var n = Date.parse(v); return isFinite(n) ? new Date(n).toLocaleString() : '—'; }
  function fmt(s, v){
    if (s.kind === 'switch') return v ? 'On' : 'Off';
    if (s.kind === 'choice') { for (var i = 0; i < (s.options || []).length; i++) if (s.options[i][0] === v) return s.options[i][1]; return String(v); }
    if (s.unit === '$') return '$' + Number(v).toLocaleString('en-US');
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
    if (s.changed) tags.push('<span class="os-tag os-tag-changed">Changed</span>');
    if (s.picks) tags.push('<span class="os-tag" title="New trades are stamped with this setting and the Track Record draws a dated divider when it changes.">Changes picks</span>');
    if (s.scope === 'site') tags.push('<span class="os-tag">Live</span>');
    var notes = [];
    if (s.pinned) notes.push('Pinned by a repo variable, so the repo value wins. Ask Sean to clear the variable to control it here.');
    if (s.vercelOff) notes.push('Off in Vercel, so it stays off whatever this says.');
    if (s.lockedUntil) notes.push('Can be turned on from ' + esc(s.lockedUntil) + '.');
    return '<div class="os-row" data-os-row="' + esc(s.key) + '"><div class="os-main"><div class="os-label">' + esc(s.label) + ' ' + tags.join(' ') + '</div>' +
      '<p class="os-help">' + esc(s.help) + '</p>' +
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
  function render(){
    var root = document.getElementById('owner-settings-root'); if (!root || !ctx.owner()) return;
    var html = '';
    if (error) html += '<p class="os-warn" role="status">' + esc(error) + '</p>';
    if (!data) { root.innerHTML = html + '<p>' + (loading ? 'Loading settings…' : 'Settings not loaded.') + '</p>'; return; }
    var canUndo = (data.history || []).some(function(h){ return h.kind !== 'undo' && !h.undone; });
    var anyChanged = data.settings.some(function(s){ return s.changed; });
    html += '<div class="os-toolbar"><button type="button" class="book-more" data-os-undo' + (busy || !canUndo ? ' disabled' : '') + '>Undo last change</button>' +
      '<button type="button" class="book-more" data-os-resetall' + (busy || !anyChanged ? ' disabled' : '') + '>Reset all to defaults</button>' +
      '<button type="button" class="book-more" data-os-go="picks">Market mode (Top Picks) →</button>' +
      '<button type="button" class="book-more" data-os-refresh' + (busy ? ' disabled' : '') + '>Refresh</button></div>';
    html += appliedHtml(data.applied);
    var groups = [];
    data.settings.forEach(function(s){ if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    groups.forEach(function(g){
      html += '<section class="os-group"><h3>' + esc(g) + '</h3>' + data.settings.filter(function(s){ return s.group === g; }).map(row).join('') + '</section>';
    });
    html += '<section class="os-group"><h3>Change history</h3>' + historyHtml(data.history) + '</section>';
    root.innerHTML = html;
    bind(root);
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
    call('POST', body).then(function(j){ if (j) data = j; }).catch(function(e){ error = e.message || 'Could not save.'; })
      .then(function(){ busy = false; render(); });
  }
  function setOne(key, value){
    var s = byKey(key); if (!s) return;
    var body = { act: 'set', values: {} }; body.values[key] = value;
    if (s.confirm && value !== s.default) {
      if (!window.confirm('Turn on "' + s.label + '"? ' + s.help)) { render(); return; }
      body.confirm = true;
    }
    post(body);
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
        if (!isFinite(v) || v < s.min || v > s.max) { error = s.label + ' must be between ' + fmt(s, s.min) + ' and ' + fmt(s, s.max) + '.'; render(); return; }
        setOne(k, v);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-os-reset]'), function(el){
      el.addEventListener('click', function(){ post({ act: 'reset', key: el.getAttribute('data-os-reset') }); });
    });
    var u = root.querySelector('[data-os-undo]'); if (u) u.addEventListener('click', function(){ post({ act: 'undo' }); });
    var ra = root.querySelector('[data-os-resetall]'); if (ra) ra.addEventListener('click', function(){ if (window.confirm('Put every setting back to its default?')) post({ act: 'reset-all' }); });
    var rf = root.querySelector('[data-os-refresh]'); if (rf) rf.addEventListener('click', load);
    var go = root.querySelector('[data-os-go]'); if (go) go.addEventListener('click', function(){ ctx.go(go.getAttribute('data-os-go')); });
  }
  function reset(){ generation++; data = null; error = ''; busy = false; loading = false; var root = document.getElementById('owner-settings-root'); if (root) root.innerHTML = ''; }
  return { load: load, reset: reset };
}

export const ownerSettingsCss = `
#owner-settings-section { max-width: 920px; }
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
.os-link { background: none; border: 0; padding: 0; color: var(--accent, inherit); text-decoration: underline; cursor: pointer; font: inherit; }
.os-history { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; }
.os-history li { margin: 0 0 8px; }
.os-history .os-undone { opacity: .6; }
.os-when { color: var(--muted); }
@media (max-width: 640px) { .os-row { flex-direction: column; gap: 8px; } }
`;

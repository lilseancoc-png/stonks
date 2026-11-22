// Intuition journal panel (Owner only, 2026-11-22). A notepad that opens on
// the right of the screen and stays open while the owner moves between pages
// (the page shrinks beside it, so it reads as a split view; on a phone it is a
// full-screen sheet). Write an entry, attach evidence from the page you are
// on (click a value, row, card or chart point to log it with its page and
// as-of time; snap a picture of a card or chart; add or paste an image), and
// review past entries with their exact times, edits and results.
//
// Storage and access live in api/auth/[action].js (`journal`,
// `journal-shot`) and lib/intuition-journal.mjs. This file only draws the
// panel and posts clicks. The market numbers at the time of writing come from
// the site's own /api/macro-live and /api/quotes. No AI.
//
// Serialized into app.js with toString(): self-contained, ES5 style, no
// template literals. Everything it needs from the page comes through `ctx`.

export function journalClient(window, document, ctx) {
  var PREF_KEY = 'stonks-journal-v1', DRAFT_KEY = 'stonks-journal-draft-v1';
  var MIN_W = 320, MAX_W = 760, DEF_W = 420;
  var SHOT_MAX_BYTES = 1400000, SHOT_MAX_W = 1600, SHOT_MAX_H = 4000;
  var prefs = { open: false, w: DEF_W, view: 'write' };
  var draft = emptyDraft();
  var state = { entries: [], total: 0, more: false, me: null, loaded: false, loading: false, error: '', off: false, busy: false, msg: '', msgKind: '',
    q: '', who: '', show: 'all', openHist: {}, confirmDel: '', outcomeFor: '', focusId: '', prices: {}, pricesAt: 0 };
  var panel = null, toggle = null, nowTimer = null, picking = null;

  function emptyDraft(){ return { text: '', tags: '', call: { subject: '', direction: '', target: '', by: '', confidence: '' }, evidence: [], editing: '', newShots: [] }; }
  try { var p = JSON.parse(window.localStorage.getItem(PREF_KEY) || 'null'); if (p && typeof p === 'object') { prefs.open = p.open === true; var w = Number(p.w); if (isFinite(w)) prefs.w = Math.min(MAX_W, Math.max(MIN_W, w)); prefs.view = p.view === 'review' ? 'review' : 'write'; } } catch (e) {}
  try { var d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null'); if (d && typeof d === 'object') { draft = emptyDraft(); draft.text = String(d.text || ''); draft.tags = String(d.tags || ''); if (d.call && typeof d.call === 'object') { for (var ck in draft.call) if (d.call[ck] != null) draft.call[ck] = String(d.call[ck]); } draft.evidence = Array.isArray(d.evidence) ? d.evidence.slice(0, 12) : []; draft.editing = typeof d.editing === 'string' ? d.editing : ''; draft.newShots = Array.isArray(d.newShots) ? d.newShots.slice(0, 50) : []; } } catch (e) {}
  function savePrefs(){ try { window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function saveDraft(){ try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {
    // Full storage (big picture thumbnails): keep the words, drop thumbnails.
    try { var slim = JSON.parse(JSON.stringify(draft)); slim.evidence.forEach(function(x){ delete x.thumb; }); window.localStorage.setItem(DRAFT_KEY, JSON.stringify(slim)); } catch (e2) {}
  } }

  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function clean(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function stamp(iso){ return ctx.when(iso, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || iso; }
  function shortStamp(iso){ return ctx.when(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || iso; }
  function monthOf(iso){ return ctx.dateText(iso, { year: 'numeric', month: 'long' }) || String(iso).slice(0, 7); }
  function owner(){ return !!ctx.owner(); }
  function phone(){ return window.matchMedia ? window.matchMedia('(max-width: 760px)').matches : window.innerWidth <= 760; }
  function num(v, dp){ var n = Number(v); if (!isFinite(n)) return ''; return n.toLocaleString('en-US', { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }); }
  function pct(v){ var n = Number(v); if (!isFinite(n)) return ''; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }

  function api(path, body){
    var opts = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch(path, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){
        if (!r.ok) { var err = new Error(b && b.error ? b.error : 'The journal did not answer (HTTP ' + r.status + ').'); err.status = r.status; err.off = !!(b && b.off); throw err; }
        return b;
      });
    });
  }
  function timed(promise, ms){ return new Promise(function(res){ var t = setTimeout(function(){ res(null); }, ms); promise.then(function(v){ clearTimeout(t); res(v); }, function(){ clearTimeout(t); res(null); }); }); }

  // ---- Toggle and panel shell -------------------------------------------------
  function sync(){
    toggle = toggle || document.getElementById('journal-toggle');
    var ok = owner();
    if (toggle) { toggle.hidden = !ok; toggle.setAttribute('aria-expanded', ok && prefs.open ? 'true' : 'false'); }
    if (!ok) { if (panel) close(true); return; }
    var want = readDeepLink();
    if (want) { prefs.open = true; prefs.view = 'review'; state.focusId = want; }
    if (prefs.open) open(true);
  }
  function readDeepLink(){
    try {
      var u = new URL(window.location.href);
      var id = u.searchParams.get('journal');
      if (id == null) return '';
      u.searchParams.delete('journal');
      window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
      return /^j[0-9a-z]{6,12}[0-9a-f]{8}$/.test(id) ? id : '';
    } catch (e) { return ''; }
  }
  function build(){
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'journal-panel';
    panel.className = 'jr-panel';
    panel.setAttribute('aria-label', 'Intuition journal');
    panel.setAttribute('translate', 'no');
    panel.innerHTML =
      '<div class="jr-resize" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize the journal" title="Drag to resize"></div>' +
      '<div class="jr-head">' +
        '<div class="jr-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg><span>Intuition journal</span></div>' +
        '<div class="jr-tabs" role="tablist" aria-label="Journal views">' +
          '<button type="button" role="tab" class="jr-tab" data-jr-view="write">Write</button>' +
          '<button type="button" role="tab" class="jr-tab" data-jr-view="review">Review<span class="jr-count" data-jr-count></span></button>' +
        '</div>' +
        '<button type="button" class="jr-x" data-jr-close aria-label="Close the journal" title="Close (Alt+J)">&times;</button>' +
      '</div>' +
      '<div class="jr-body" data-jr-body></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', onInput);
    panel.addEventListener('change', onChange);
    panel.addEventListener('keydown', onKey);
    panel.addEventListener('paste', onPaste);
    bindResize(panel.querySelector('.jr-resize'));
    return panel;
  }
  // Keep at least 480px for the page (and its header) beside the panel; the
  // saved width comes back when the window is wide enough again.
  function room(){ var left = parseFloat(window.getComputedStyle(document.body).paddingLeft) || 0; return Math.max(MIN_W, window.innerWidth - left - 480); }
  function shownWidth(){ return Math.min(prefs.w, room()); }
  function applyWidth(){ document.documentElement.style.setProperty('--jr-w', Math.round(shownWidth()) + 'px'); }
  function open(quiet){
    if (!owner()) return;
    build();
    applyWidth();
    prefs.open = true; savePrefs();
    panel.hidden = false;
    document.body.classList.add('jr-on');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    render();
    if (!state.loaded && !state.loading) load();
    if (!quiet) { var f = panel.querySelector(prefs.view === 'write' ? '[data-jr-text]' : '[data-jr-q]'); if (f && !phone()) f.focus(); }
  }
  function close(quiet){
    stopPick();
    if (panel) panel.hidden = true;
    document.body.classList.remove('jr-on');
    if (nowTimer) { clearInterval(nowTimer); nowTimer = null; }
    if (!quiet) { prefs.open = false; savePrefs(); }
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); if (!quiet) toggle.focus(); }
  }
  function bindResize(h){
    if (!h) return;
    var startX = 0, startW = 0, on = false;
    function move(ev){ if (!on) return; prefs.w = Math.min(MAX_W, Math.max(MIN_W, Math.min(room(), startW + (startX - ev.clientX)))); applyWidth(); }
    function up(){ if (!on) return; on = false; document.body.classList.remove('jr-resizing'); savePrefs(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
    h.addEventListener('pointerdown', function(ev){ if (phone()) return; on = true; startX = ev.clientX; startW = shownWidth(); document.body.classList.add('jr-resizing'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); ev.preventDefault(); });
    h.addEventListener('keydown', function(ev){
      var step = ev.key === 'ArrowLeft' ? 24 : ev.key === 'ArrowRight' ? -24 : 0;
      if (!step) return;
      prefs.w = Math.min(MAX_W, Math.max(MIN_W, Math.min(room(), shownWidth() + step))); applyWidth(); savePrefs(); ev.preventDefault();
    });
  }

  // ---- Loading ------------------------------------------------------------------
  function load(more){
    state.loading = true; state.error = '';
    if (!more) renderReviewIfShown();
    var last = more && state.entries.length ? state.entries[state.entries.length - 1].id : '';
    return api('/api/auth/journal' + (last ? '?before=' + encodeURIComponent(last) : '')).then(function(b){
      state.entries = more ? state.entries.concat(b.entries || []) : (b.entries || []);
      state.total = b.total || 0; state.more = !!b.more; state.me = b.me || null; state.loaded = true; state.off = false;
    }, function(err){ state.error = err.message; state.off = !!err.off; }).then(function(){
      state.loading = false;
      updateCount();
      renderReviewIfShown();
    });
  }
  function updateCount(){ var c = panel && panel.querySelector('[data-jr-count]'); if (c) c.textContent = state.total ? ' ' + state.total : ''; }

  // ---- Rendering ----------------------------------------------------------------
  function render(){
    if (!panel) return;
    Array.prototype.forEach.call(panel.querySelectorAll('[data-jr-view]'), function(b){
      var on = b.getAttribute('data-jr-view') === prefs.view;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
    });
    updateCount();
    var body = panel.querySelector('[data-jr-body]');
    if (nowTimer) { clearInterval(nowTimer); nowTimer = null; }
    if (prefs.view === 'write') { body.innerHTML = writeHtml(); renderEvidence(); renderMsg(); tickNow(); nowTimer = setInterval(tickNow, 30000); autosize(body.querySelector('[data-jr-text]')); }
    else { body.innerHTML = reviewShellHtml(); renderList(); }
  }
  function renderReviewIfShown(){ if (panel && !panel.hidden && prefs.view === 'review') renderList(); }
  function tickNow(){ var n = panel && panel.querySelector('[data-jr-now]'); if (n) n.textContent = stamp(new Date().toISOString()); }
  function autosize(t){ if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(Math.max(140, t.scrollHeight + 2), Math.round(window.innerHeight * 0.55)) + 'px'; }

  function writeHtml(){
    var c = draft.call, editing = draft.editing ? findEntry(draft.editing) : null;
    var dirs = [['up', '▲ Up'], ['down', '▼ Down'], ['flat', '▬ Flat']];
    return '' +
      (editing ? '<div class="jr-editing">Editing your entry from <strong>' + esc(stamp(editing.createdAt)) + '</strong>. The first time stays; the old text is kept as an earlier version. <button type="button" class="jr-link" data-jr-cancel-edit>Cancel edit</button></div>' : '') +
      '<p class="jr-now-line">' + (editing ? 'Edit saved at' : 'Saved with the time you press Save') + ': <span data-jr-now></span></p>' +
      '<label class="sr-only" for="jr-text">Entry</label>' +
      '<textarea id="jr-text" class="jr-text" data-jr-text maxlength="8000" placeholder="What do you think the market will do, and why? (Paste a screenshot here too.)">' + esc(draft.text) + '</textarea>' +
      '<details class="jr-call"' + (c.subject || c.direction ? ' open' : '') + '>' +
        '<summary>Make it a call <span class="jr-hint">(optional: so you can check it later)</span></summary>' +
        '<div class="jr-call-grid">' +
          '<label class="jr-f"><span>On</span><input data-jr-call="subject" value="' + esc(c.subject) + '" maxlength="10" placeholder="NVDA or MARKET" autocapitalize="characters" spellcheck="false"></label>' +
          '<div class="jr-f"><span>Direction</span><div class="jr-seg" role="group" aria-label="Direction">' + dirs.map(function(dd){ return '<button type="button" data-jr-dir="' + dd[0] + '" aria-pressed="' + (c.direction === dd[0] ? 'true' : 'false') + '">' + dd[1] + '</button>'; }).join('') + '</div></div>' +
          '<label class="jr-f"><span>Target price</span><input data-jr-call="target" value="' + esc(c.target) + '" inputmode="decimal" placeholder="optional"></label>' +
          '<label class="jr-f"><span>By</span><input type="date" data-jr-call="by" value="' + esc(c.by) + '"></label>' +
          '<label class="jr-f"><span>Confidence</span><select data-jr-call="confidence"><option value="">-</option>' + [1, 2, 3, 4, 5].map(function(n){ return '<option value="' + n + '"' + (String(c.confidence) === String(n) ? ' selected' : '') + '>' + n + ' of 5</option>'; }).join('') + '</select></label>' +
        '</div>' +
        '<p class="jr-hint">The price of the stock (SPY for MARKET) is saved with the entry, so the review can show how far it has moved since.</p>' +
      '</details>' +
      '<label class="jr-f jr-tags"><span>Tags</span><input data-jr-tags value="' + esc(draft.tags) + '" placeholder="ai, rates, ipo" maxlength="220" spellcheck="false"></label>' +
      '<div class="jr-ev-head"><span>Evidence from the site</span>' +
        '<div class="jr-ev-btns">' +
          '<button type="button" class="jr-btn" data-jr-pick="data" title="Click any value, row, card or chart point on the page to log it with its page and as-of time">Pick a value</button>' +
          '<button type="button" class="jr-btn" data-jr-pick="shot" title="Click a card, chart or table to save a picture of it">Snap a card</button>' +
          '<label class="jr-btn jr-file" title="Add an image from your device (or paste one into the text box)"><input type="file" accept="image/*" data-jr-file hidden>Add image</label>' +
        '</div></div>' +
      '<div class="jr-ev" data-jr-ev></div>' +
      '<div class="jr-foot">' +
        '<button type="button" class="jr-save" data-jr-save>' + (editing ? 'Save changes' : 'Save entry') + '</button>' +
        '<button type="button" class="jr-link" data-jr-clear>' + (editing ? 'Cancel' : 'Clear') + '</button>' +
        '<span class="jr-msg" data-jr-msg role="status" aria-live="polite"></span>' +
      '</div>' +
      '<p class="jr-hint jr-keys">Ctrl/Cmd+Enter saves. Alt+J opens or closes the journal. Only the two owners can see it.</p>';
  }
  function evidenceItemHtml(x, i, removable){
    var head = '<div class="jr-ev-top"><span class="jr-ev-kind">' + (x.kind === 'shot' ? 'Picture' : x.kind === 'page' ? 'Page' : 'Value') + '</span>' +
      (x.label ? '<span class="jr-ev-label">' + esc(x.label) + '</span>' : '') +
      (removable ? '<button type="button" class="jr-ev-x" data-jr-ev-del="' + i + '" aria-label="Remove this evidence" title="Remove">&times;</button>' : '') + '</div>';
    var img = '';
    if (x.kind === 'shot' && x.shot) {
      var src = x.thumb || ('/api/auth/journal-shot?id=' + encodeURIComponent(x.shot.id));
      img = '<button type="button" class="jr-shot" data-jr-zoom="' + esc(x.shot.id) + '" title="Open the full picture"><img src="' + esc(src) + '" alt="' + esc(x.label || 'Picture') + '" loading="lazy"></button>';
    }
    var meta = [];
    if (x.pageLabel || x.page) meta.push(x.url ? '<a href="' + esc(x.url) + '" data-jr-go>' + esc(x.pageLabel || x.page) + '</a>' : esc(x.pageLabel || x.page));
    if (x.asOf) meta.push('as of ' + esc(x.asOf));
    if (x.capturedAt) meta.push('logged ' + esc(shortStamp(x.capturedAt)));
    return '<li class="jr-ev-item jr-ev-' + esc(x.kind) + '">' + head + img +
      (x.text ? '<div class="jr-ev-text">' + esc(x.text) + '</div>' : '') +
      (meta.length ? '<div class="jr-ev-meta">' + meta.join(' · ') + '</div>' : '') + '</li>';
  }
  function renderEvidence(){
    var box = panel && panel.querySelector('[data-jr-ev]');
    if (!box) return;
    box.innerHTML = draft.evidence.length
      ? '<ul class="jr-ev-list">' + draft.evidence.map(function(x, i){ return evidenceItemHtml(x, i, true); }).join('') + '</ul>'
      : '<p class="jr-hint">Nothing attached yet. Pick a value or snap a card on the page beside this panel to back up the idea.</p>';
  }
  function setMsg(text, kind){ state.msg = text || ''; state.msgKind = kind || ''; renderMsg(); }
  function renderMsg(){ var m = panel && panel.querySelector('[data-jr-msg]'); if (m) { m.textContent = state.msg; m.className = 'jr-msg' + (state.msgKind ? ' is-' + state.msgKind : ''); } }

  function reviewShellHtml(){
    return '<div class="jr-filters">' +
      '<label class="jr-f jr-q"><span class="sr-only">Search</span><input type="search" data-jr-q value="' + esc(state.q) + '" placeholder="Search" title="Search words, tickers and tags"></label>' +
      '<label class="jr-f"><span class="sr-only">Who</span><select data-jr-who><option value="">Both owners</option></select></label>' +
      '<label class="jr-f"><span class="sr-only">Show</span><select data-jr-show>' +
        [['all', 'All entries'], ['calls', 'Calls'], ['open', 'Calls not marked'], ['due', 'Calls past their date'], ['right', 'Right'], ['wrong', 'Wrong'], ['mixed', 'Mixed']].map(function(o){ return '<option value="' + o[0] + '"' + (state.show === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></label>' +
      '</div><div class="jr-sum" data-jr-sum></div><div data-jr-list aria-live="polite"></div>';
  }
  function findEntry(id){ for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return state.entries[i]; return null; }
  function mine(e){ return !e.author || e.author.id == null || (state.me && state.me.id === e.author.id); }
  function todayKey(){ return ctx.dateKey(new Date()); }
  function filtered(){
    var words = clean(state.q).toLowerCase().split(' ').filter(Boolean), today = todayKey();
    return state.entries.filter(function(e){
      if (state.who && (e.author ? e.author.name : 'Owner') !== state.who) return false;
      var s = state.show;
      if (s === 'calls' && !e.call) return false;
      if (s === 'open' && (!e.call || e.outcome)) return false;
      if (s === 'due' && (!e.call || e.outcome || !e.call.by || e.call.by > today)) return false;
      if ((s === 'right' || s === 'wrong' || s === 'mixed') && !(e.outcome && e.outcome.result === s)) return false;
      if (!words.length) return true;
      var hay = [e.text, (e.tags || []).join(' '), e.call ? e.call.subject : '', e.author ? e.author.name : '', e.outcome ? e.outcome.note : '']
        .concat((e.evidence || []).map(function(x){ return x.label + ' ' + x.text + ' ' + x.pageLabel; })).join(' ').toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
  }
  function renderList(){
    if (!panel) return;
    var box = panel.querySelector('[data-jr-list]'), sum = panel.querySelector('[data-jr-sum]'), who = panel.querySelector('[data-jr-who]');
    if (!box) return;
    if (who) {
      var names = {}; state.entries.forEach(function(e){ names[e.author ? e.author.name : 'Owner'] = 1; });
      who.innerHTML = '<option value="">Both owners</option>' + Object.keys(names).sort().map(function(n){ return '<option' + (state.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    }
    if (state.off) { box.innerHTML = '<p class="jr-empty">The journal is switched off (Owner Settings, Live site). Every entry is kept.</p>'; if (sum) sum.textContent = ''; return; }
    if (state.error && !state.loaded) { box.innerHTML = '<p class="jr-empty">' + esc(state.error) + ' <button type="button" class="jr-link" data-jr-reload>Try again</button></p>'; return; }
    if (!state.loaded) { box.innerHTML = '<p class="jr-empty">Loading the journal&hellip;</p>'; return; }
    var list = filtered();
    var tally = { right: 0, wrong: 0, mixed: 0, open: 0 }, calls = 0;
    state.entries.forEach(function(e){ if (e.call) { calls++; tally[e.outcome ? e.outcome.result : 'open']++; } });
    if (sum) sum.innerHTML = esc(state.total + (state.total === 1 ? ' entry' : ' entries')) + (calls ? ' · ' + calls + ' call' + (calls === 1 ? '' : 's') + ': <b class="up">' + tally.right + ' right</b>, <b class="down">' + tally.wrong + ' wrong</b>, ' + tally.mixed + ' mixed, ' + tally.open + ' not marked' : '') +
      (list.length !== state.entries.length ? ' · showing ' + list.length : '');
    if (!state.entries.length) { box.innerHTML = '<p class="jr-empty">No entries yet. Write your first one in the Write tab.</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="jr-empty">No entries match.</p>'; return; }
    var html = '', month = '';
    list.forEach(function(e){
      var m = monthOf(e.createdAt);
      if (m !== month) { if (month) html += '</ol>'; html += '<h3 class="jr-month">' + esc(m) + '</h3><ol class="jr-list">'; month = m; }
      html += entryHtml(e);
    });
    html += '</ol>';
    if (state.more) html += '<p class="jr-more"><button type="button" class="jr-btn" data-jr-older>Load older entries</button></p>';
    box.innerHTML = html;
    livePrices(list);
    if (state.focusId) {
      var el = box.querySelector('[data-jr-entry="' + state.focusId + '"]');
      if (el) { el.classList.add('is-focus'); el.scrollIntoView({ block: 'start' }); }
      state.focusId = '';
    }
  }
  function callHtml(e){
    var c = e.call; if (!c) return '';
    var arrow = c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '▬';
    var bits = ['<span class="jr-call-dir jr-' + esc(c.direction) + '">' + arrow + ' ' + esc(c.subject) + ' ' + esc(c.direction) + '</span>'];
    if (c.target != null) bits.push('target ' + esc(num(c.target)));
    if (c.by) bits.push('by ' + esc(ctx.dateText(c.by + 'T12:00:00Z', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) || c.by));
    if (c.confidence) bits.push('confidence ' + c.confidence + '/5');
    var due = c.by && !e.outcome && c.by <= todayKey() ? ' <span class="jr-due">date reached, mark the result</span>' : '';
    var since = e.ref ? '<span class="jr-since" data-jr-since="' + esc(e.id) + '">' + esc(e.ref.symbol) + ' was ' + esc(num(e.ref.price)) + '</span>' : '';
    return '<div class="jr-callrow">' + bits.join(' · ') + due + (since ? '<br>' + since : '') + '</div>';
  }
  function marketHtml(m){
    if (!m) return '';
    var parts = [];
    if (m.spy != null) parts.push('SPY ' + num(m.spy));
    if (m.qqq != null) parts.push('QQQ ' + num(m.qqq));
    if (m.vix != null) parts.push('VIX ' + num(m.vix));
    if (m.tenY != null) parts.push('10Y ' + num(m.tenY) + '%');
    if (m.dxy != null) parts.push('Dollar ' + num(m.dxy));
    if (m.crude != null) parts.push('Oil ' + num(m.crude));
    if (m.gold != null) parts.push('Gold ' + num(m.gold, 0));
    return parts.length ? '<div class="jr-mkt" title="Market when this was written">Market then: ' + esc(parts.join(' · ')) + '</div>' : '';
  }
  function entryHtml(e){
    var edited = e.updatedAt && e.updatedAt !== e.createdAt;
    var hist = e.history || [];
    var me = mine(e);
    var out = e.outcome;
    var html = '<li class="jr-entry" data-jr-entry="' + esc(e.id) + '">' +
      '<div class="jr-entry-head"><span class="jr-author">' + esc(e.author ? e.author.name : 'Owner') + '</span><time datetime="' + esc(e.createdAt) + '">' + esc(stamp(e.createdAt)) + '</time>' +
        (edited ? '<span class="jr-edited" title="Last edited ' + esc(stamp(e.updatedAt)) + '">edited</span>' : '') + '</div>' +
      callHtml(e) +
      '<div class="jr-entry-text">' + esc(e.text) + '</div>' +
      ((e.tags || []).length ? '<div class="jr-tagrow">' + e.tags.map(function(t){ return '<button type="button" class="jr-tag" data-jr-tagq="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      marketHtml(e.market) +
      ((e.evidence || []).length ? '<ul class="jr-ev-list">' + e.evidence.map(function(x, i){ return evidenceItemHtml(x, i, false); }).join('') + '</ul>' : '');
    if (out) html += '<div class="jr-outcome jr-out-' + esc(out.result) + '"><b>' + esc(out.result === 'right' ? 'Right' : out.result === 'wrong' ? 'Wrong' : 'Mixed') + '</b>' + (out.note ? ': ' + esc(out.note) : '') +
      '<span class="jr-hint"> · marked ' + esc(shortStamp(out.at)) + (out.by ? ' by ' + esc(out.by.name) : '') + '</span></div>';
    if (state.outcomeFor === e.id) {
      html += '<div class="jr-outform"><div class="jr-seg" role="group" aria-label="Result">' + [['right', 'Right'], ['wrong', 'Wrong'], ['mixed', 'Mixed']].map(function(o){ return '<button type="button" data-jr-res="' + o[0] + '" aria-pressed="' + (out && out.result === o[0] ? 'true' : 'false') + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        '<label class="jr-f"><span class="sr-only">Note</span><input data-jr-outnote maxlength="1000" placeholder="What happened (optional)" value="' + esc(out ? out.note : '') + '"></label>' +
        '<div class="jr-row"><button type="button" class="jr-save" data-jr-outsave="' + esc(e.id) + '">Save result</button>' + (out ? '<button type="button" class="jr-link" data-jr-outclear="' + esc(e.id) + '">Clear result</button>' : '') + '<button type="button" class="jr-link" data-jr-outcancel>Cancel</button></div></div>';
    }
    html += '<div class="jr-actions">' +
      '<button type="button" class="jr-link" data-jr-outcome="' + esc(e.id) + '">' + (out ? 'Change result' : 'Mark result') + '</button>' +
      (me ? '<button type="button" class="jr-link" data-jr-edit="' + esc(e.id) + '">Edit</button>' : '') +
      (hist.length ? '<button type="button" class="jr-link" data-jr-hist="' + esc(e.id) + '" aria-expanded="' + (state.openHist[e.id] ? 'true' : 'false') + '">Earlier versions (' + hist.length + ')</button>' : '') +
      (me ? (state.confirmDel === e.id ? '<button type="button" class="jr-link jr-danger" data-jr-del="' + esc(e.id) + '">Yes, delete it</button><button type="button" class="jr-link" data-jr-delno>Keep</button>' : '<button type="button" class="jr-link" data-jr-delask="' + esc(e.id) + '">Delete</button>') : '') +
      '<button type="button" class="jr-link" data-jr-copy="' + esc(e.id) + '" title="Copy a link that opens this entry">Copy link</button>' +
      '</div>';
    if (state.openHist[e.id] && hist.length) {
      html += '<ol class="jr-hist">' + hist.slice().reverse().map(function(h){
        return '<li><div class="jr-hint">Version from ' + esc(stamp(h.at)) + (h.call ? ' · call: ' + esc(h.call.subject + ' ' + h.call.direction) + (h.call.target != null ? ' to ' + esc(num(h.call.target)) : '') + (h.call.by ? ' by ' + esc(h.call.by) : '') : '') + '</div><div class="jr-entry-text">' + esc(h.text) + '</div></li>';
      }).join('') + '</ol>';
    }
    return html + '</li>';
  }
  // How far each call's subject has moved since it was written (live quote).
  function livePrices(list){
    var syms = {};
    list.forEach(function(e){ if (e.ref && e.ref.symbol) syms[e.ref.symbol] = 1; });
    var keys = Object.keys(syms).slice(0, 150);
    if (!keys.length) return;
    var fresh = Date.now() - state.pricesAt < 60000 && keys.every(function(k){ return k in state.prices; });
    var go = fresh ? Promise.resolve(null) : timed(window.fetch('/api/quotes?symbols=' + encodeURIComponent(keys.join(','))).then(function(r){ return r.ok ? r.json() : null; }), 6000);
    go.then(function(b){
      if (b && Array.isArray(b.quotes)) { b.quotes.forEach(function(q){ if (q && q.symbol && isFinite(q.spot)) state.prices[q.symbol] = q.spot; }); state.pricesAt = Date.now(); }
      list.forEach(function(e){
        var el = panel && panel.querySelector('[data-jr-since="' + e.id + '"]');
        var now = e.ref ? state.prices[e.ref.symbol] : null;
        if (!el || !isFinite(now) || !(e.ref.price > 0)) return;
        var move = (now / e.ref.price - 1) * 100, dir = e.call && e.call.direction;
        var still = dir !== 'flat' && Math.abs(move) < 0.05;
        var withIt = dir === 'up' ? move > 0 : dir === 'down' ? move < 0 : Math.abs(move) < 2;
        var hit = e.call && e.call.target != null ? (dir === 'down' ? now <= e.call.target : dir === 'up' ? now >= e.call.target : false) : false;
        el.innerHTML = esc(e.ref.symbol) + ' ' + esc(num(e.ref.price)) + ' then, ' + esc(num(now)) + ' now: <b class="' + (still ? '' : withIt ? 'up' : 'down') + '">' + esc(pct(move)) + '</b> ' +
          (!e.call ? '' : still ? '(no move yet)' : withIt ? '(with the call)' : '(against the call)') + (hit ? ' · <b class="up">target reached</b>' : '');
      });
    });
  }

  // ---- Events ---------------------------------------------------------------------
  function onClick(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('button, a[data-jr-go]') : null;
    if (!t || !panel.contains(t)) return;
    var a = function(n){ return t.getAttribute(n); };
    if (t.hasAttribute('data-jr-close')) { close(); return; }
    if (t.hasAttribute('data-jr-view')) { prefs.view = a('data-jr-view'); savePrefs(); stopPick(); render(); return; }
    if (t.hasAttribute('data-jr-dir')) { draft.call.direction = draft.call.direction === a('data-jr-dir') ? '' : a('data-jr-dir'); saveDraft(); Array.prototype.forEach.call(panel.querySelectorAll('[data-jr-dir]'), function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-jr-dir') === draft.call.direction ? 'true' : 'false'); }); return; }
    if (t.hasAttribute('data-jr-pick')) { startPick(a('data-jr-pick')); return; }
    if (t.hasAttribute('data-jr-ev-del')) { removeEvidence(Number(a('data-jr-ev-del'))); return; }
    if (t.hasAttribute('data-jr-save')) { save(); return; }
    if (t.hasAttribute('data-jr-clear') || t.hasAttribute('data-jr-cancel-edit')) { clearDraft(); return; }
    if (t.hasAttribute('data-jr-zoom')) { zoom(a('data-jr-zoom'), t.querySelector('img')); return; }
    if (t.hasAttribute('data-jr-reload')) { load(); return; }
    if (t.hasAttribute('data-jr-older')) { load(true); return; }
    if (t.hasAttribute('data-jr-tagq')) { state.q = a('data-jr-tagq'); var q = panel.querySelector('[data-jr-q]'); if (q) q.value = state.q; renderList(); return; }
    if (t.hasAttribute('data-jr-hist')) { var hid = a('data-jr-hist'); state.openHist[hid] = !state.openHist[hid]; renderList(); return; }
    if (t.hasAttribute('data-jr-delask')) { state.confirmDel = a('data-jr-delask'); renderList(); return; }
    if (t.hasAttribute('data-jr-delno')) { state.confirmDel = ''; renderList(); return; }
    if (t.hasAttribute('data-jr-del')) { removeEntry(a('data-jr-del')); return; }
    if (t.hasAttribute('data-jr-edit')) { editEntry(a('data-jr-edit')); return; }
    if (t.hasAttribute('data-jr-outcome')) { state.outcomeFor = state.outcomeFor === a('data-jr-outcome') ? '' : a('data-jr-outcome'); renderList(); return; }
    if (t.hasAttribute('data-jr-outcancel')) { state.outcomeFor = ''; renderList(); return; }
    if (t.hasAttribute('data-jr-res')) { Array.prototype.forEach.call(t.parentNode.querySelectorAll('[data-jr-res]'), function(b){ b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); }); return; }
    if (t.hasAttribute('data-jr-outsave')) { saveOutcome(a('data-jr-outsave'), false); return; }
    if (t.hasAttribute('data-jr-outclear')) { saveOutcome(a('data-jr-outclear'), true); return; }
    if (t.hasAttribute('data-jr-copy')) { copyLink(a('data-jr-copy'), t); return; }
  }
  function onInput(ev){
    var t = ev.target;
    if (t.hasAttribute('data-jr-text')) { draft.text = t.value; saveDraft(); autosize(t); return; }
    if (t.hasAttribute('data-jr-tags')) { draft.tags = t.value; saveDraft(); return; }
    if (t.hasAttribute('data-jr-call')) { draft.call[t.getAttribute('data-jr-call')] = t.value; saveDraft(); return; }
    if (t.hasAttribute('data-jr-q')) { state.q = t.value; renderList(); }
  }
  function onChange(ev){
    var t = ev.target;
    if (t.hasAttribute('data-jr-call')) { draft.call[t.getAttribute('data-jr-call')] = t.value; saveDraft(); return; }
    if (t.hasAttribute('data-jr-who')) { state.who = t.value; renderList(); return; }
    if (t.hasAttribute('data-jr-show')) { state.show = t.value; renderList(); return; }
    if (t.hasAttribute('data-jr-file') && t.files && t.files[0]) { addImageFile(t.files[0]); t.value = ''; }
  }
  function onKey(ev){
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && ev.target && ev.target.closest && ev.target.closest('[data-jr-body]') && prefs.view === 'write') { ev.preventDefault(); save(); }
    if (ev.key === 'Escape' && !picking && phone()) close();
  }
  function onPaste(ev){
    if (prefs.view !== 'write' || !ev.clipboardData) return;
    var items = ev.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) { ev.preventDefault(); addImageFile(f); } return; }
    }
  }
  function copyLink(id, btn){
    var url = window.location.origin + '/?journal=' + id;
    var done = function(){ btn.textContent = 'Link copied'; setTimeout(function(){ btn.textContent = 'Copy link'; }, 1600); };
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) window.navigator.clipboard.writeText(url).then(done, function(){ btn.textContent = url; });
    else btn.textContent = url;
  }

  // ---- Draft, save, edit -------------------------------------------------------------
  function callPayload(){
    var c = draft.call, subject = clean(c.subject).toUpperCase().replace(/^\$/, '');
    if (!subject && !c.direction) return null;
    return { subject: subject, direction: c.direction, target: clean(c.target).replace(/[$,]/g, ''), by: c.by, confidence: c.confidence };
  }
  function tagList(){ return String(draft.tags || '').split(/[,#\n]+/).map(clean).filter(Boolean); }
  function evidencePayload(){ return draft.evidence.map(function(x){ var o = {}; for (var k in x) if (k !== 'thumb') o[k] = x[k]; return o; }); }
  // Market numbers and the call's price at the moment of saving. Optional:
  // a slow or failed quote saves the entry without them.
  function snapshot(call){
    var macro = timed(window.fetch('/api/macro-live').then(function(r){ return r.ok ? r.json() : null; }), 5000);
    var sym = call && call.subject ? (call.subject === 'MARKET' ? 'SPY' : call.subject) : '';
    var quote = sym ? timed(window.fetch('/api/quotes?symbols=' + encodeURIComponent(sym)).then(function(r){ return r.ok ? r.json() : null; }), 5000) : Promise.resolve(null);
    return Promise.all([macro, quote]).then(function(got){
      var legs = got[0] && got[0].legs, at = new Date().toISOString(), market = null, ref = null;
      if (legs) {
        market = { at: at };
        ['spy', 'qqq', 'vix', 'tenY', 'dxy', 'crude', 'gold'].forEach(function(k){ if (legs[k] && isFinite(legs[k].value)) market[k] = legs[k].value; });
      }
      var q = got[1] && Array.isArray(got[1].quotes) ? got[1].quotes.filter(function(x){ return x && x.symbol === sym; })[0] : null;
      if (q && isFinite(q.spot)) ref = { symbol: sym, price: q.spot, at: at };
      else if (sym === 'SPY' && market && isFinite(market.spy)) ref = { symbol: 'SPY', price: market.spy, at: at };
      return { market: market, ref: ref };
    });
  }
  function save(){
    if (state.busy) return;
    if (!clean(draft.text)) { setMsg('Write something first.', 'bad'); var tx = panel.querySelector('[data-jr-text]'); if (tx) tx.focus(); return; }
    var call = callPayload();
    if (call && !call.direction) { setMsg('Pick up, down or flat for the call, or clear the call.', 'bad'); return; }
    if (call && !call.subject) { setMsg('Say what the call is on: a ticker, or MARKET.', 'bad'); return; }
    state.busy = true; setMsg('Saving…', '');
    var entry = { text: draft.text, tags: tagList(), call: call, evidence: evidencePayload() };
    var editing = draft.editing;
    var go = editing ? Promise.resolve({}) : snapshot(call);
    go.then(function(snap){
      if (!editing) { entry.market = snap.market; entry.ref = snap.ref; try { entry.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {} }
      return api('/api/auth/journal', editing ? { op: 'edit', id: editing, entry: entry } : { op: 'add', entry: entry });
    }).then(function(b){
      state.busy = false;
      var saved = b.entry;
      if (saved) {
        var i = -1; for (var k = 0; k < state.entries.length; k++) if (state.entries[k].id === saved.id) i = k;
        if (i >= 0) state.entries[i] = saved; else { state.entries.unshift(saved); state.total = b.total || state.total + 1; }
      }
      draft = emptyDraft(); saveDraft();
      render();
      setMsg(editing ? 'Changes saved.' : 'Saved ' + (saved ? stamp(saved.createdAt) : '') + '.', 'ok');
    }, function(err){
      state.busy = false;
      setMsg(err.off ? 'The journal is switched off (Owner Settings, Live site).' : err.message, 'bad');
    });
  }
  function discardShots(ids){ if (ids && ids.length) api('/api/auth/journal', { op: 'discard', shots: ids }).catch(function(){}); }
  function clearDraft(){
    discardShots(draft.newShots);
    draft = emptyDraft(); saveDraft(); state.msg = ''; render();
  }
  function editEntry(id){
    var e = findEntry(id); if (!e) return;
    discardShots(draft.newShots);
    draft = emptyDraft();
    draft.editing = id; draft.text = e.text; draft.tags = (e.tags || []).join(', ');
    if (e.call) draft.call = { subject: e.call.subject, direction: e.call.direction, target: e.call.target == null ? '' : String(e.call.target), by: e.call.by || '', confidence: e.call.confidence ? String(e.call.confidence) : '' };
    draft.evidence = (e.evidence || []).map(function(x){ return JSON.parse(JSON.stringify(x)); });
    saveDraft(); prefs.view = 'write'; savePrefs(); state.msg = ''; render();
    var t = panel.querySelector('[data-jr-text]'); if (t) t.focus();
  }
  function removeEvidence(i){
    var x = draft.evidence[i]; if (!x) return;
    draft.evidence.splice(i, 1);
    if (x.kind === 'shot' && x.shot && draft.newShots.indexOf(x.shot.id) >= 0) { discardShots([x.shot.id]); draft.newShots = draft.newShots.filter(function(s){ return s !== x.shot.id; }); }
    saveDraft(); renderEvidence();
  }
  function removeEntry(id){
    state.confirmDel = '';
    api('/api/auth/journal', { op: 'delete', id: id }).then(function(b){
      state.entries = state.entries.filter(function(e){ return e.id !== id; }); state.total = b.total != null ? b.total : Math.max(0, state.total - 1);
      if (draft.editing === id) { draft = emptyDraft(); saveDraft(); }
      renderList(); updateCount();
    }, function(err){ state.error = err.message; renderList(); alertInList(err.message); });
  }
  function alertInList(text){ var s = panel && panel.querySelector('[data-jr-sum]'); if (s) s.innerHTML = '<span class="jr-msg is-bad">' + esc(text) + '</span>'; }
  function saveOutcome(id, clear){
    var form = panel.querySelector('.jr-outform');
    var pressed = form ? form.querySelector('[data-jr-res][aria-pressed="true"]') : null;
    if (!clear && !pressed) { alertInList('Pick right, wrong or mixed.'); return; }
    var note = form && form.querySelector('[data-jr-outnote]') ? form.querySelector('[data-jr-outnote]').value : '';
    api('/api/auth/journal', { op: 'outcome', id: id, outcome: clear ? null : { result: pressed.getAttribute('data-jr-res'), note: note } }).then(function(b){
      for (var k = 0; k < state.entries.length; k++) if (state.entries[k].id === id && b.entry) state.entries[k] = b.entry;
      state.outcomeFor = ''; renderList();
    }, function(err){ alertInList(err.message); });
  }

  // ---- Evidence: where it came from --------------------------------------------------
  function pageOf(doc){
    var win = doc.defaultView, frame = win && win.frameElement;
    var tab = frame ? (frame.getAttribute('data-tab') || '') : ctx.tab();
    var url = '';
    try { var u = new URL(win.location.href); u.searchParams.delete('embed'); u.searchParams.delete('journal'); url = u.pathname + u.search; } catch (e) {}
    if (!/[?&]tab=/.test(url) && tab && tab !== 'home') url = '/?tab=' + encodeURIComponent(tab);
    return { page: tab, pageLabel: ctx.pageLabel(tab), url: url || '/' };
  }
  var ASOF_RE = /\b(as of|updated|last (?:build|scan|run|update)|data (?:from|through)|built|refreshed)\b[:\s]+([^·|•\n]{3,48})/i;
  function asOfNear(el){
    var doc = el.ownerDocument, node = el, depth = 0;
    while (node && node.nodeType === 1 && node !== doc.body && depth < 12) {
      var t = node.querySelector ? node.querySelector('time[datetime], [data-as-of], [data-asof], [data-updated-at]') : null;
      if (t) {
        var v = t.getAttribute('datetime') || t.getAttribute('data-as-of') || t.getAttribute('data-asof') || t.getAttribute('data-updated-at');
        var when = v && isFinite(Date.parse(v)) && /\d{4}-\d{2}-\d{2}T/.test(v) ? shortStamp(v) : clean(t.textContent || v);
        if (when) return when.slice(0, 80);
      }
      if ((node.textContent || '').length < 30000) {
        var smalls = node.querySelectorAll ? node.querySelectorAll('small, .hint, .muted, .meta, .card-sub, .card-foot, .source, footer, figcaption, p') : [];
        for (var i = 0; i < smalls.length && i < 60; i++) {
          var m = ASOF_RE.exec(clean(smalls[i].textContent));
          if (m) return clean(m[1] + ' ' + m[2]).slice(0, 80);
        }
      }
      if (node.classList && node.classList.contains('page-pane')) break;
      node = node.parentElement; depth++;
    }
    var fb = doc.getElementById('freshness-banner'), built = fb && fb.getAttribute('data-built-at');
    return built && isFinite(Date.parse(built)) ? 'site data built ' + shortStamp(built) : '';
  }
  function headingNear(el){
    var node = el.parentElement, depth = 0;
    while (node && node.nodeType === 1 && depth < 12) {
      var hs = node.querySelectorAll('h1, h2, h3, h4, .card-title, caption, legend');
      var best = null;
      for (var i = 0; i < hs.length; i++) {
        if (hs[i] === el || hs[i].contains(el)) continue;
        if (hs[i].compareDocumentPosition(el) & 4) best = hs[i];
      }
      if (best && clean(best.textContent)) return clean(best.textContent).slice(0, 140);
      if (node.classList && node.classList.contains('page-pane')) break;
      node = node.parentElement; depth++;
    }
    return '';
  }
  function textOf(el){ return clean(el.innerText != null ? el.innerText : el.textContent); }
  // Cheap size test for hover (textContent needs no layout).
  function lenOf(el){ var t = el.textContent || ''; return t.length > 3000 ? t.length : clean(t).length; }
  function rowText(tr){
    var table = tr.closest('table'), heads = [];
    if (table && table.tHead && table.tHead.rows.length) {
      var hr = table.tHead.rows[table.tHead.rows.length - 1];
      for (var i = 0; i < hr.cells.length; i++) heads.push(clean(hr.cells[i].textContent));
    }
    var parts = [];
    for (var j = 0; j < tr.cells.length; j++) {
      var v = textOf(tr.cells[j]); if (!v) continue;
      var h = heads[j];
      parts.push(h && h !== v ? h + ': ' + v : v);
    }
    return parts.join(' · ');
  }
  function chartTip(el){
    var doc = el.ownerDocument;
    if (el.closest('svg[data-ch]')) {
      var tip = doc.querySelector('.ch-tip');
      if (tip && tip.style.display !== 'none' && clean(tip.textContent)) {
        var lines = Array.prototype.map.call(tip.querySelectorAll('span'), function(s){ return clean(s.textContent); }).filter(Boolean);
        return lines.length ? lines.join(' · ') : clean(tip.textContent);
      }
    }
    var ck = el.closest('.ck-canvas');
    if (ck && ck.parentElement) { var leg = ck.parentElement.querySelector('.ck-legend'); if (leg && clean(leg.textContent)) return clean(leg.textContent); }
    return '';
  }
  var DATA_SEL = 'tr, li, dt, dd, td, th, figure, [class*="kpi"], [class*="stat"], [class*="tile"], [class*="metric"], [class*="chip"], [class*="pill"], [class*="badge"], [class*="card"], [class*="row"], p, h1, h2, h3, h4, button, a';
  var SNAP_SEL = 'table, figure, section, article, [class*="card"], [class*="panel"], [class*="tile"], [class*="chart"], [class*="strip"], [class*="grid"], svg, canvas';
  function inJournal(el){ return !!(el && el.closest && el.closest('#journal-panel, .jr-pickbar, .jr-hl, .jr-zoom')); }
  function targetFor(el, mode){
    if (!el || el.nodeType !== 1 || inJournal(el)) return null;
    var doc = el.ownerDocument;
    if (el === doc.body || el === doc.documentElement) return null;
    if (mode === 'shot') {
      var s = el.closest(SNAP_SEL);
      while (s && s.parentElement && s.parentElement !== doc.body) {
        var r = s.getBoundingClientRect();
        if (r.width >= 160 && r.height >= 70 && !(s.tagName === 'svg' || s.tagName === 'SVG' || s.tagName === 'CANVAS')) break;
        s = s.parentElement.closest(SNAP_SEL) || null;
      }
      return s && !s.classList.contains('page-pane') ? s : el.closest('.page-pane') || null;
    }
    if (el.closest('svg[data-ch], .ck-canvas')) return el.closest('svg[data-ch]') || el.closest('.ck-canvas');
    var c = el.closest(DATA_SEL);
    if (c && (c.tagName === 'TD' || c.tagName === 'TH') && c.parentElement && c.parentElement.tagName === 'TR' && !c.closest('thead')) c = c.parentElement;
    if (!c || lenOf(c) > 600) {
      c = el;
      while (c.parentElement && c.parentElement !== doc.body && lenOf(c.parentElement) <= 600 && !c.parentElement.classList.contains('page-pane')) c = c.parentElement;
    }
    return lenOf(c) ? c : null;
  }
  function captureData(el){
    var info = pageOf(el.ownerDocument), text = '', label = '';
    var tip = chartTip(el);
    if (tip) { text = tip; label = headingNear(el.closest('svg, .ck-canvas') || el); }
    else if (el.tagName === 'TR') {
      text = rowText(el);
      var table = el.closest('table'), cap = table && (table.caption ? clean(table.caption.textContent) : table.getAttribute('aria-label'));
      label = cap || headingNear(table || el);
    } else { text = textOf(el); label = headingNear(el); }
    if (!text) return null;
    return { kind: 'data', text: text.slice(0, 600), label: label, page: info.page, pageLabel: info.pageLabel, url: info.url, asOf: asOfNear(el), capturedAt: new Date().toISOString() };
  }

  // ---- Pick mode ----------------------------------------------------------------------
  var hl = null, bar = null, hovered = null, stack = [], lastTouch = 0;
  function onPickTouch(){ lastTouch = Date.now(); }
  function touchedLately(){ return Date.now() - lastTouch < 1000; }
  function docs(){
    var list = [document];
    Array.prototype.forEach.call(document.querySelectorAll('iframe.split-frame'), function(f){ try { if (f.contentDocument && f.contentDocument.body) list.push(f.contentDocument); } catch (e) {} });
    return list;
  }
  function startPick(mode){
    stopPick();
    if (draft.evidence.length >= 12) { setMsg('That is the most evidence one entry can hold (12).', 'bad'); return; }
    if (mode === 'shot' && draft.evidence.filter(function(x){ return x.kind === 'shot'; }).length >= 8) { setMsg('That is the most pictures one entry can hold (8).', 'bad'); return; }
    picking = { mode: mode, docs: docs() };
    document.body.classList.add('jr-picking');
    hl = document.createElement('div'); hl.className = 'jr-hl' + (mode === 'shot' ? ' is-shot' : ''); hl.hidden = true; document.body.appendChild(hl);
    bar = document.createElement('div'); bar.className = 'jr-pickbar'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span data-jr-pickmsg>' + (mode === 'shot' ? 'Click a card, chart or table to save a picture of it.' : 'Click a value, row, card or chart point to log it.') + ' <span class="jr-hint">↑ bigger · ↓ smaller · Esc stop</span></span>' +
      '<button type="button" class="jr-btn" data-jr-pickuse hidden>' + (mode === 'shot' ? 'Snap it' : 'Log it') + '</button>' +
      '<button type="button" class="jr-btn" data-jr-pickup hidden>Bigger</button>' +
      '<button type="button" class="jr-btn" data-jr-pickstop>Stop</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', function(ev){
      var b = ev.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-jr-pickstop')) stopPick();
      else if (b.hasAttribute('data-jr-pickuse') && hovered) take(hovered);
      else if (b.hasAttribute('data-jr-pickup') && hovered) grow();
    });
    picking.docs.forEach(function(d){
      d.addEventListener('mousemove', onPickMove, true);
      d.addEventListener('touchstart', onPickTouch, { capture: true, passive: true });
      d.addEventListener('click', onPickClick, true);
      d.addEventListener('keydown', onPickKey, true);
    });
    if (panel && phone()) panel.classList.add('is-tucked');
  }
  function stopPick(){
    if (!picking) return;
    picking.docs.forEach(function(d){
      try { d.removeEventListener('mousemove', onPickMove, true); d.removeEventListener('touchstart', onPickTouch, { capture: true }); d.removeEventListener('click', onPickClick, true); d.removeEventListener('keydown', onPickKey, true); } catch (e) {}
    });
    picking = null; hovered = null; stack = [];
    if (hl) { hl.remove(); hl = null; }
    if (bar) { bar.remove(); bar = null; }
    document.body.classList.remove('jr-picking');
    if (panel) panel.classList.remove('is-tucked');
  }
  function frameOffset(doc){
    var f = doc.defaultView && doc.defaultView.frameElement;
    if (!f) return { x: 0, y: 0 };
    var r = f.getBoundingClientRect();
    return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
  }
  function show(el){
    hovered = el;
    if (!hl) return;
    if (!el) { hl.hidden = true; return; }
    var r = el.getBoundingClientRect(), o = frameOffset(el.ownerDocument);
    hl.hidden = false;
    hl.style.left = (r.left + o.x - 3) + 'px'; hl.style.top = (r.top + o.y - 3) + 'px';
    hl.style.width = (r.width + 6) + 'px'; hl.style.height = (r.height + 6) + 'px';
    if (bar) { var u = bar.querySelector('[data-jr-pickuse]'), g = bar.querySelector('[data-jr-pickup]'); if (u) u.hidden = false; if (g) g.hidden = false; }
  }
  function onPickMove(ev){
    // A tap sends a mousemove before its click; let the click decide.
    if (!picking || inJournal(ev.target) || touchedLately()) return;
    var t = targetFor(ev.target, picking.mode);
    if (t !== hovered) { stack = []; show(t); }
  }
  function onPickClick(ev){
    if (!picking) return;
    if (inJournal(ev.target)) return;
    ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    var t = targetFor(ev.target, picking.mode);
    // Mouse: one click logs it. Touch: the first tap selects (so a value is
    // not logged by accident), Log it / Snap it in the bar confirms.
    var touch = ev.pointerType === 'touch' || touchedLately() || (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents);
    if (touch && t !== hovered) { stack = []; show(t); return; }
    if (t) take(t);
  }
  function grow(){
    if (!hovered || !hovered.parentElement) return;
    var doc = hovered.ownerDocument, p = hovered.parentElement;
    while (p && p !== doc.body && (p.getBoundingClientRect().width === hovered.getBoundingClientRect().width && p.getBoundingClientRect().height === hovered.getBoundingClientRect().height)) p = p.parentElement;
    if (!p || p === doc.body || p === doc.documentElement) return;
    stack.push(hovered); var keep = stack; show(p); stack = keep;
  }
  function onPickKey(ev){
    if (!picking) return;
    if (ev.key === 'Escape') { ev.preventDefault(); stopPick(); return; }
    if (ev.key === 'ArrowUp' && hovered) { ev.preventDefault(); grow(); return; }
    if (ev.key === 'ArrowDown' && stack.length) { ev.preventDefault(); var keep = stack; var prev = keep.pop(); show(prev); stack = keep; return; }
    if (ev.key === 'Enter' && hovered) { ev.preventDefault(); take(hovered); }
  }
  function take(el){
    var mode = picking && picking.mode;
    stopPick();
    if (!el) return;
    if (mode === 'shot') { snap(el); return; }
    var item = captureData(el);
    if (!item) { setMsg('Nothing to log there. Try a number or a row.', 'bad'); return; }
    draft.evidence.push(item); saveDraft();
    if (prefs.view !== 'write') { prefs.view = 'write'; savePrefs(); render(); } else renderEvidence();
    setMsg('Logged from ' + (item.pageLabel || 'the page') + '.', 'ok');
  }

  // ---- Pictures -----------------------------------------------------------------------
  function libFor(win){
    if (win === window) return ctx.imageLib();
    if (win.htmlToImage) return Promise.resolve(win.htmlToImage);
    return new Promise(function(res, rej){
      var s = win.document.createElement('script');
      s.src = ctx.imageLibSrc; s.async = true;
      s.onload = function(){ win.htmlToImage ? res(win.htmlToImage) : rej(new Error('Image tool did not load')); };
      s.onerror = function(){ rej(new Error('Image tool did not load')); };
      win.document.head.appendChild(s);
    });
  }
  // Fit a canvas into the size limits and encode it as JPEG, stepping the
  // quality down until it is small enough to upload.
  function encode(src, w, h){
    var scale = Math.min(1, SHOT_MAX_W / Math.max(1, w), SHOT_MAX_H / Math.max(1, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    var g = c.getContext('2d');
    g.fillStyle = ctx.cssVar('--bg', '#ffffff'); g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    var q = [0.85, 0.72, 0.6, 0.48], data = '';
    for (var i = 0; i < q.length; i++) { data = c.toDataURL('image/jpeg', q[i]); if (data.length * 0.75 <= SHOT_MAX_BYTES) break; }
    var t = document.createElement('canvas'), ts = Math.min(1, 320 / c.width);
    t.width = Math.max(1, Math.round(c.width * ts)); t.height = Math.max(1, Math.round(c.height * ts));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return { data: data, w: c.width, h: c.height, thumb: t.toDataURL('image/jpeg', 0.7) };
  }
  function upload(pic, meta){
    if (pic.data.length * 0.75 > SHOT_MAX_BYTES) { setMsg('That picture is too big even after shrinking. Pick a smaller part.', 'bad'); return Promise.resolve(); }
    setMsg('Saving the picture…', '');
    return api('/api/auth/journal-shot', { data: pic.data }).then(function(b){
      var item = { kind: 'shot', text: '', label: meta.label, page: meta.page || '', pageLabel: meta.pageLabel || '', url: meta.url || '', asOf: meta.asOf || '', capturedAt: new Date().toISOString(),
        shot: { id: b.shot.id, w: pic.w, h: pic.h, bytes: b.shot.bytes }, thumb: pic.thumb };
      draft.evidence.push(item); draft.newShots.push(b.shot.id); saveDraft();
      if (prefs.view !== 'write') { prefs.view = 'write'; savePrefs(); render(); } else renderEvidence();
      setMsg('Picture added.', 'ok');
    }, function(err){ setMsg(err.message, 'bad'); });
  }
  function snap(el){
    var doc = el.ownerDocument, win = doc.defaultView;
    var info = pageOf(doc);
    var meta = { label: headingNear(el) || (el.querySelector && el.querySelector('h1, h2, h3, .card-title') ? clean(el.querySelector('h1, h2, h3, .card-title').textContent).slice(0, 140) : '') || info.pageLabel,
      page: info.page, pageLabel: info.pageLabel, url: info.url, asOf: asOfNear(el) };
    setMsg('Making the picture…', '');
    Promise.all([libFor(win), ctx.fonts()]).then(function(got){
      var lib = got[0], fontCss = got[1];
      var w = Math.ceil(el.scrollWidth || el.getBoundingClientRect().width), h = Math.ceil(el.scrollHeight || el.getBoundingClientRect().height);
      var ratio = Math.max(0.4, Math.min(2, SHOT_MAX_W / Math.max(1, w), SHOT_MAX_H / Math.max(1, h)));
      var bg = win.getComputedStyle(doc.body).getPropertyValue('--bg').trim() || ctx.cssVar('--bg', '#ffffff');
      var opts = { pixelRatio: ratio, backgroundColor: bg, width: w, height: h, cacheBust: false, style: { margin: '0', transform: 'none' },
        filter: function(node){ return !(node.classList && (node.classList.contains('jr-hl') || node.classList.contains('jr-pickbar'))); } };
      if (fontCss) opts.fontEmbedCSS = fontCss; else opts.skipFonts = true;
      return lib.toCanvas(el, opts);
    }).then(function(canvas){
      return upload(encode(canvas, canvas.width, canvas.height), meta);
    }).catch(function(err){ setMsg('The picture could not be made (' + (err && err.message ? err.message : 'error') + '). Try a smaller card, or Add image.', 'bad'); });
  }
  function addImageFile(file){
    if (!/^image\//.test(file.type || '')) { setMsg('That file is not an image.', 'bad'); return; }
    if (draft.evidence.filter(function(x){ return x.kind === 'shot'; }).length >= 8) { setMsg('That is the most pictures one entry can hold (8).', 'bad'); return; }
    if (file.size > 25e6) { setMsg('That image is too large to add.', 'bad'); return; }
    setMsg('Reading the image…', '');
    var fr = new FileReader();
    fr.onerror = function(){ setMsg('The image could not be read.', 'bad'); };
    fr.onload = function(){
      var img = new Image();
      img.onerror = function(){ setMsg('The image could not be read.', 'bad'); };
      img.onload = function(){
        upload(encode(img, img.naturalWidth, img.naturalHeight), { label: clean(file.name || 'Image').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 140) || 'Image', page: '', pageLabel: '', url: '', asOf: '' });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function zoom(id, img){
    var box = document.createElement('div');
    box.className = 'jr-zoom'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Picture');
    var src = '/api/auth/journal-shot?id=' + encodeURIComponent(id);
    box.innerHTML = '<button type="button" class="jr-x" aria-label="Close the picture">&times;</button><img alt="" src="' + esc(src) + '">';
    if (img && img.alt) box.querySelector('img').alt = img.alt;
    function shut(){ box.remove(); document.removeEventListener('keydown', key, true); }
    function key(ev){ if (ev.key === 'Escape') { ev.preventDefault(); shut(); } }
    box.addEventListener('click', function(ev){ if (ev.target === box || ev.target.closest('.jr-x')) shut(); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(box);
    box.querySelector('.jr-x').focus();
  }

  // ---- Start --------------------------------------------------------------------------
  toggle = document.getElementById('journal-toggle');
  if (toggle) toggle.addEventListener('click', function(){ if (panel && !panel.hidden) close(); else open(); });
  document.addEventListener('keydown', function(ev){
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.code === 'KeyJ' || ev.key === 'j' || ev.key === 'J') && owner()) { ev.preventDefault(); if (panel && !panel.hidden) close(); else open(); }
  });
  document.addEventListener('stonks-owner-ready', sync);
  window.addEventListener('resize', function(){ if (panel && !panel.hidden) applyWidth(); });
  sync();
  return { sync: sync, open: open, close: close, state: state };
}

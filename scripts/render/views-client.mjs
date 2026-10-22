// Shared sort / view / compare helpers for the browser IIFE.
//
// `viewsFactory` is written as a real function so it can be unit-read and
// linted as JavaScript; app-js.mjs pastes its source into the generated
// app.js (`var VIEWS = (<source>)(window, document);`), the same pattern as
// lib/research-display.mjs. It must stay self-contained: ES5 syntax, no
// imports, no references to anything outside its own body.
//
// What it provides:
//   - Per-device memory of each tab's sort / filter / view choices
//     (localStorage, one JSON object under STORE; every read/write is guarded).
//   - The flip-order button that sits next to Sort menus.
//   - The Cards / Table switch and a small table builder for card tabs.
//   - Click-a-column-header sorting for every <table> on the site, re-applied
//     after a tab re-renders its table.
//   - A "Reset saved sorts and views" button at the foot of the sidebar.
export function viewsFactory(win, doc) {
  var STORE = 'stonks-views-v1';

  function readAll() {
    try {
      var raw = win.localStorage.getItem(STORE);
      var v = raw ? JSON.parse(raw) : {};
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }
  function get(key, fallback) {
    var all = readAll();
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
  }
  function set(key, val) {
    try {
      var all = readAll();
      if (val == null) delete all[key]; else all[key] = val;
      win.localStorage.setItem(STORE, JSON.stringify(all));
    } catch (_) {}
  }
  function clearAll() {
    try {
      win.localStorage.removeItem(STORE);
      win.localStorage.removeItem('stonks-acc-view');
    } catch (_) {}
  }
  // A saved value is only honored while it is still one of the allowed
  // options, so renaming or removing a sort key can never strand a tab.
  function choose(key, fallback, allowed) {
    var v = get(key, fallback);
    if (allowed && allowed.indexOf(v) === -1) return fallback;
    return v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Flip order ---------------------------------------------------------
  var flipHandlers = {};
  function reversed(key) { return get('rev:' + key, false) === true; }
  // Reverse a sorted list when the flip is on. Items the sort could not
  // place (missing values) stay at the end either way.
  function applyDir(arr, key, isMissing) {
    if (!reversed(key)) return arr;
    if (!isMissing) return arr.reverse();
    // Reorders arr in place (and returns it) so callers may ignore the result.
    var have = [], miss = [];
    for (var i = 0; i < arr.length; i++) (isMissing(arr[i]) ? miss : have).push(arr[i]);
    var out = have.reverse().concat(miss);
    for (var j = 0; j < out.length; j++) arr[j] = out[j];
    return arr;
  }
  function flipHtml(key) {
    var on = reversed(key);
    return '<button type="button" class="sort-flip' + (on ? ' is-on' : '') + '" data-sort-flip="' + esc(key) + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="Flip the sort order" aria-label="Flip sort order">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg></button>';
  }
  // Wrap a select's markup with its flip button (dynamically rendered menus).
  function withFlip(selectHtml, key) {
    return '<span class="sort-with-flip">' + selectHtml + flipHtml(key) + '</span>';
  }
  // Static selects (baked into index.html) get wrapped and given a button here.
  function attachFlip(select, key, onFlipFn) {
    if (!select || !select.parentNode) return;
    if (onFlipFn) flipHandlers[key] = onFlipFn;
    if (select.parentNode.classList && select.parentNode.classList.contains('sort-with-flip')) return;
    var wrap = doc.createElement('span');
    wrap.className = 'sort-with-flip';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    var tmp = doc.createElement('span');
    tmp.innerHTML = flipHtml(key);
    wrap.appendChild(tmp.firstChild);
  }
  function onFlip(key, fn) { flipHandlers[key] = fn; }

  // Sort a copy of rows by one value. Numbers sort high to low unless asc;
  // text sorts A to Z. Missing values (null / NaN / '') always go last, ties
  // keep the incoming order, and the flip button for flipKey reverses it.
  function sortBy(rows, getValue, asc, flipKey) {
    var arr = (rows || []).map(function (r, i) { return { r: r, i: i, v: getValue(r) }; });
    function miss(v) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)); }
    arr.sort(function (a, b) {
      var ma = miss(a.v), mb = miss(b.v);
      if (ma || mb) return ma && mb ? a.i - b.i : (ma ? 1 : -1);
      var c;
      if (typeof a.v === 'number' && typeof b.v === 'number') c = asc ? a.v - b.v : b.v - a.v;
      else c = String(a.v).localeCompare(String(b.v));
      return c || a.i - b.i;
    });
    if (flipKey) arr = applyDir(arr, flipKey, function (x) { return miss(x.v); });
    return arr.map(function (x) { return x.r; });
  }
  // Markup for a labelled Sort menu with its flip button.
  // opts: [[value, label], ...]
  function sortMenuHtml(attr, opts, current, flipKey, ariaLabel) {
    var h = '<select ' + attr + ' aria-label="' + esc(ariaLabel || 'Sort') + '">';
    for (var i = 0; i < opts.length; i++) h += '<option value="' + esc(opts[i][0]) + '"' + (opts[i][0] === current ? ' selected' : '') + '>' + esc(opts[i][1]) + '</option>';
    h += '</select>';
    return '<label>Sort ' + withFlip(h, flipKey) + '</label>';
  }

  // ---- Remembered selects ---------------------------------------------------
  // Restore a static <select>'s saved value (when still a valid option) and
  // save every later change. Returns the value now selected.
  function remember(select, key) {
    if (!select) return null;
    var saved = get('sel:' + key, null);
    if (saved != null) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === saved) { select.value = saved; break; }
      }
    }
    if (!select.getAttribute('data-views-remember')) {
      select.setAttribute('data-views-remember', key);
      select.addEventListener('change', function () { set('sel:' + key, select.value); });
    }
    return select.value;
  }

  // ---- Cards / Table switch -------------------------------------------------
  var viewHandlers = {};
  // A tab may offer extra layouts beyond Cards / Table (for example a chart):
  // pass them as [[mode, label], ...] to both viewMode and viewToggleHtml.
  var VIEW_MODE_RE = /^[a-z][a-z0-9-]{0,15}$/;
  function viewMode(key, extras) {
    var m = get('view:' + key, 'cards');
    if (m === 'table') return 'table';
    if (extras) for (var i = 0; i < extras.length; i++) if (extras[i][0] === m) return m;
    return 'cards';
  }
  function onView(key, fn) { viewHandlers[key] = fn; }
  function viewToggleHtml(key, extras) {
    var mode = viewMode(key, extras);
    function b(m, label) {
      return '<button type="button" data-view-toggle="' + esc(key) + '" data-view-mode="' + esc(m) + '" aria-pressed="' + (mode === m ? 'true' : 'false') + '" class="' + (mode === m ? 'is-on' : '') + '">' + esc(label) + '</button>';
    }
    var h = b('cards', 'Cards') + b('table', 'Table');
    if (extras) for (var i = 0; i < extras.length; i++) h += b(extras[i][0], extras[i][1]);
    return '<span class="view-toggle" role="group" aria-label="Layout">' + h + '</span>';
  }
  // cols: [{ label, num, cell(row) -> html, sort(row) -> number|string|null, title }]
  function tableHtml(cols, rows, opts) {
    opts = opts || {};
    var h = '<div class="vt-wrap"><table class="vt-table' + (opts.cls ? ' ' + opts.cls : '') + '"' + (opts.key ? ' data-ts-key="' + esc(opts.key) + '"' : '') + '><thead><tr>';
    for (var c = 0; c < cols.length; c++) {
      h += '<th' + (cols[c].num ? ' class="num"' : '') + (cols[c].title ? ' title="' + esc(cols[c].title) + '"' : '') + '>' + esc(cols[c].label) + '</th>';
    }
    h += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      h += '<tr' + (opts.rowAttr ? ' ' + opts.rowAttr(row) : '') + '>';
      for (var k = 0; k < cols.length; k++) {
        var col = cols[k];
        var sv = col.sort ? col.sort(row) : null;
        var sAttr = sv == null || (typeof sv === 'number' && !isFinite(sv)) ? ' data-sort=""' : ' data-sort="' + esc(sv) + '"';
        h += '<td' + (col.num ? ' class="num"' : '') + sAttr + '>' + (col.cell(row) || '<span class="vt-na">—</span>') + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    if (!rows.length) h += '<p class="vt-empty">' + esc(opts.empty || 'Nothing to show.') + '</p>';
    return h;
  }

  // ---- Click-a-header table sorting ----------------------------------------
  // Matrix-style tables (rows are metrics, columns are companies or dates)
  // keep their designed order.
  var TS_SKIP = '.cmp-table, .spill-matrix, .fomc-prob-table, .fomc-pm-table, .fomc-ladder, [data-nosort]';
  var MISSING_RE = /^(|—|–|-|n\/a|na|none|no read|unknown|\.\.\.|…)$/i;
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function cellText(cell) {
    return String(cell.textContent || '').replace(/\s+/g, ' ').trim();
  }
  // Turn a cell into a sortable value: number, date (ms) or lower-case text.
  function parseCell(cell) {
    var attr = cell.getAttribute('data-sort');
    var raw = attr != null ? attr : cellText(cell);
    var t = String(raw).trim();
    if (MISSING_RE.test(t)) return { kind: 'missing' };
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return { kind: 'num', v: Date.UTC(+iso[1], +iso[2] - 1, +iso[3]) };
    var md = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:,? (?:(\d{4})|['’](\d{2})))?\b/.exec(t);
    if (md && MONTHS[md[1].toLowerCase()] != null) {
      var yr = md[3] ? +md[3] : md[4] ? 2000 + (+md[4]) : new Date().getFullYear();
      return { kind: 'num', v: Date.UTC(yr, MONTHS[md[1].toLowerCase()], +md[2]) };
    }
    var n = t.replace(/[−–]/g, '-').replace(/[$,%×~≈±+]/g, '').trim();
    var m = /^(-?\d*\.?\d+)([kmbt])?(?=$|[^a-z0-9.])/i.exec(n);
    if (m) {
      var mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] || '').toLowerCase()] || 1;
      return { kind: 'num', v: parseFloat(m[1]) * mult };
    }
    var lead = /^\(?(-?\d*\.?\d+)\)?/.exec(n);
    if (lead && attr == null && /^[-+]?[$]?\d/.test(t.replace(/[−–]/g, '-'))) return { kind: 'num', v: parseFloat(lead[1]) };
    return { kind: 'text', v: t.toLowerCase() };
  }
  function headerRow(table) {
    var thead = table.tHead;
    if (!thead || thead.rows.length !== 1) return null;
    return thead.rows[0];
  }
  function headerUsable(th) {
    if (th.hasAttribute('data-nosort')) return false;
    if (th.querySelector('button, select, input, a')) return false;
    if (th.colSpan > 1) return false;
    return cellText(th).length > 0;
  }
  function tableKey(table) {
    var explicit = table.getAttribute('data-ts-key');
    var pane = table.closest('[id^="page-pane-"]');
    var hr = headerRow(table);
    var heads = [];
    if (hr) for (var i = 0; i < hr.cells.length; i++) heads.push(cellText(hr.cells[i]).slice(0, 24));
    return (pane ? pane.id.replace('page-pane-', '') : 'page') + '|' + (explicit || heads.join('|'));
  }
  // Rows travel in groups: a row with fewer cells than the header (a
  // colspan detail / expansion row) stays glued to the row above it.
  function rowGroups(tbody, ncols) {
    var groups = [], cur = null, pinned = [];
    for (var i = 0; i < tbody.rows.length; i++) {
      var tr = tbody.rows[i];
      if (tr.getAttribute('data-ts-orig') == null) tr.setAttribute('data-ts-orig', String(i));
      var isTotal = /\b(total|summary)\b/i.test(tr.className) || /^(total|all trades|overall)\b/i.test(cellText(tr.cells[0] || tr));
      if (isTotal) { pinned.push(tr); continue; }
      if (cur && tr.cells.length < ncols) { cur.rows.push(tr); continue; }
      cur = { rows: [tr], orig: +tr.getAttribute('data-ts-orig') };
      groups.push(cur);
    }
    return { groups: groups, pinned: pinned };
  }
  function sortTable(table, col, dir) {
    var hr = headerRow(table);
    if (!hr) return;
    var ncols = hr.cells.length;
    for (var b = 0; b < table.tBodies.length; b++) {
      var tbody = table.tBodies[b];
      var rg = rowGroups(tbody, ncols);
      var groups = rg.groups;
      if (groups.length < 2) continue;
      var vals = groups.map(function (g) {
        var cell = g.rows[0].cells[col];
        return cell ? parseCell(cell) : { kind: 'missing' };
      });
      var numN = 0, textN = 0;
      vals.forEach(function (v) { if (v.kind === 'num') numN++; else if (v.kind === 'text') textN++; });
      var numeric = numN >= textN;
      var idx = groups.map(function (g, i) { return i; });
      idx.sort(function (a, z) {
        var va = vals[a], vz = vals[z];
        var ma = va.kind === 'missing' || (numeric && va.kind !== 'num');
        var mz = vz.kind === 'missing' || (numeric && vz.kind !== 'num');
        if (ma || mz) return ma && mz ? groups[a].orig - groups[z].orig : (ma ? 1 : -1);
        if (!dir) return groups[a].orig - groups[z].orig;
        var c = numeric ? va.v - vz.v : (va.v < vz.v ? -1 : va.v > vz.v ? 1 : 0);
        if (dir === 'desc') c = -c;
        return c || groups[a].orig - groups[z].orig;
      });
      var same = true;
      for (var i = 0; i < idx.length; i++) if (idx[i] !== i) { same = false; break; }
      if (same) continue;
      var frag = doc.createDocumentFragment();
      idx.forEach(function (i) { groups[i].rows.forEach(function (tr) { frag.appendChild(tr); }); });
      rg.pinned.forEach(function (tr) { frag.appendChild(tr); });
      tbody.appendChild(frag);
    }
  }
  function markHeaders(table, state) {
    var hr = headerRow(table);
    if (!hr) return;
    for (var i = 0; i < hr.cells.length; i++) {
      var th = hr.cells[i];
      if (!headerUsable(th)) continue;
      var want = state && state.col === i ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      if (!th.classList.contains('ts-th')) {
        th.classList.add('ts-th');
        th.setAttribute('tabindex', '0');
        th.setAttribute('title', (th.getAttribute('title') ? th.getAttribute('title') + ' · ' : '') + 'Click to sort');
      }
      if (th.getAttribute('aria-sort') !== want) th.setAttribute('aria-sort', want);
    }
  }
  function enhanceTable(table) {
    if (table.matches(TS_SKIP) || !headerRow(table)) return;
    var key = tableKey(table);
    var state = get('tsort:' + key, null);
    markHeaders(table, state);
    if (state && typeof state.col === 'number') sortTable(table, state.col, state.dir);
  }
  var scanQueued = false;
  function scanTables() {
    scanQueued = false;
    var tables = doc.querySelectorAll('main table, [id^="page-pane-"] table');
    for (var i = 0; i < tables.length; i++) {
      try { enhanceTable(tables[i]); } catch (_) {}
    }
  }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    (win.requestAnimationFrame || win.setTimeout)(scanTables);
  }
  function headerActivate(th) {
    var table = th.closest('table');
    if (!table || table.matches(TS_SKIP)) return;
    var hr = headerRow(table);
    if (!hr || th.parentNode !== hr) return;
    var col = Array.prototype.indexOf.call(hr.cells, th);
    var key = tableKey(table);
    var state = get('tsort:' + key, null);
    // First click: biggest first for numbers, A to Z for text. Second click
    // flips it. Third click returns the table to its original order.
    var firstDir = 'desc';
    var probe = table.tBodies[0] && table.tBodies[0].rows[0] && table.tBodies[0].rows[0].cells[col];
    if (probe && parseCell(probe).kind === 'text') firstDir = 'asc';
    var next;
    if (!state || state.col !== col) next = { col: col, dir: firstDir };
    else if (state.dir === firstDir) next = { col: col, dir: firstDir === 'desc' ? 'asc' : 'desc' };
    else next = null;
    set('tsort:' + key, next);
    sortTable(table, next ? next.col : col, next ? next.dir : null);
    markHeaders(table, next);
  }
  function initTableSort() {
    doc.addEventListener('click', function (ev) {
      var th = ev.target && ev.target.closest ? ev.target.closest('th.ts-th') : null;
      if (th) headerActivate(th);
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var th = ev.target && ev.target.classList && ev.target.classList.contains('ts-th') ? ev.target : null;
      if (!th) return;
      ev.preventDefault();
      headerActivate(th);
    });
    if (win.MutationObserver) {
      new win.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].type === 'childList' && muts[i].addedNodes.length) { queueScan(); return; }
        }
      }).observe(doc.body, { childList: true, subtree: true });
    }
    queueScan();
  }

  // ---- Delegated clicks for flip + view switch + reset ---------------------
  function clearHeaderSort(control) {
    var pane = control.closest('[id^="page-pane-"]');
    if (!pane) return;
    var prefix = 'tsort:' + pane.id.replace('page-pane-', '') + '|';
    var all = readAll();
    Object.keys(all).forEach(function(key) { if (key.indexOf(prefix) === 0) delete all[key]; });
    try { win.localStorage.setItem(STORE, JSON.stringify(all)); } catch (_) {}
    queueScan();
  }
  function initControls() {
    // Capture runs before each menu's renderer replaces its table.
    doc.addEventListener('change', function(ev) {
      var t = ev.target;
      if (t && t.matches('select') && t.closest('.sort-with-flip')) clearHeaderSort(t);
    }, true);
    doc.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      if (!t) return;
      var flip = t.closest('[data-sort-flip]');
      if (flip) {
        clearHeaderSort(flip);
        var key = flip.getAttribute('data-sort-flip');
        var on = !reversed(key);
        set('rev:' + key, on ? true : null);
        var all = doc.querySelectorAll('[data-sort-flip="' + key + '"]');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
          all[i].classList.toggle('is-on', on);
        }
        if (flipHandlers[key]) flipHandlers[key]();
        return;
      }
      var vt = t.closest('[data-view-toggle]');
      if (vt) {
        var vkey = vt.getAttribute('data-view-toggle');
        var mode = vt.getAttribute('data-view-mode') || 'cards';
        if (!VIEW_MODE_RE.test(mode)) mode = 'cards';
        set('view:' + vkey, mode === 'cards' ? null : mode);
        var btns = doc.querySelectorAll('[data-view-toggle="' + vkey + '"]');
        for (var j = 0; j < btns.length; j++) {
          var isOn = btns[j].getAttribute('data-view-mode') === mode;
          btns[j].classList.toggle('is-on', isOn);
          btns[j].setAttribute('aria-pressed', isOn ? 'true' : 'false');
        }
        if (viewHandlers[vkey]) viewHandlers[vkey](mode);
        return;
      }
      if (t.closest('#views-reset')) {
        clearAll();
        var note = doc.getElementById('views-reset');
        if (note) note.textContent = 'Reset. Reloading…';
        win.setTimeout(function () { win.location.reload(); }, 250);
      }
    });
    // The reset sits quietly at the foot of the sidebar.
    var nav = doc.getElementById('side-nav');
    if (nav && !doc.getElementById('views-reset')) {
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.id = 'views-reset';
      btn.className = 'views-reset';
      btn.textContent = 'Reset saved sorts and views';
      btn.title = 'Forget the sort, filter and layout choices this device remembers for each tab';
      nav.appendChild(btn);
    }
  }

  var started = false;
  function start() {
    if (started || !doc.body) return;
    started = true;
    initControls();
    initTableSort();
  }

  return {
    get: get, set: set, choose: choose, clearAll: clearAll,
    reversed: reversed, applyDir: applyDir, flipHtml: flipHtml, withFlip: withFlip, attachFlip: attachFlip, onFlip: onFlip,
    remember: remember, sortBy: sortBy, sortMenuHtml: sortMenuHtml,
    viewMode: viewMode, viewToggleHtml: viewToggleHtml, onView: onView, tableHtml: tableHtml,
    parseCell: parseCell, sortTable: sortTable, rescan: queueScan,
    start: start
  };
}

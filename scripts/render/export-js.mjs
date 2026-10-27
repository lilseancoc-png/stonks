// Owner-only Export menu: saves what is on screen as a picture (PNG, copy,
// share), a PDF (a picture PDF to send, or the browser's print dialog for
// selectable text), or as data (CSV, Excel, JSON, copied table) for the page
// the owner is looking on. Everything runs in the browser from what the page
// already loaded: no new data, no AI, no server work beyond re-reading a data
// file the owner asks for (which goes through the same Owner gate).
// The button lives next to the split-view and light / dark switches and is
// hidden unless /api/auth/me reports the Owner session (applyAuth).

// Picture renderer, vendored from npm (MIT) and loaded only on first use.
export const EXPORT_IMAGE_LIB = 'js/vendor/html-to-image-1.11.11.js';

// The data file(s) behind each page, main one first. A whole-page CSV,
// Excel or JSON export is built from these when the page shows cards rather
// than tables, and they are offered as "Source data" downloads. The Look up
// a stock page adds the open ticker's own file.
export const EXPORT_SOURCES = {
  home: ['heatmap.json'], brief: ['briefs.json'], news: ['news-feed.json'], heatmap: ['heatmap.json'],
  calendar: ['calendar.json'], overnight: ['correlations.json'],
  tickers: ['heatmap.json', 'grades.json'], compare: ['grades.json'], earnings: ['earnings-tracker.json'],
  calls: ['earnings-calls.json'], f13: ['13f.json'], 'pending-buyouts': ['pending-buyouts.json'],
  'bonds-usd': ['macro-history.json'], commodities: ['commodities.json'], 'central-bank-gold': ['central-bank-gold.json'],
  'capital-raises': ['capital-raises.json', 'ipo-credit.json'],
  flow: ['unusual.json'], volume: ['volume-flags.json'], oi: ['oi-tracker.json'], 'iv-trend': ['iv-trending.json'],
  'ma-tracker': ['ma-tracker.json'], streaks: ['streaks.json'], 'pattern-lab': ['pattern-recognition.json'],
  spillover: ['spillover-pairs.json'], 'index-cal': ['index-calendar.json'],
  'ai-capex': ['ai-capex.json'], 'ram-prices': ['ram-prices.json'], 'accelerator-prices': ['accelerator-prices.json'],
  'search-interest': ['search-interest.json'],
  'unified-signal-engine': ['market-analysis.json', 'sector-rotation.json'], market: ['regime-history.json', 'correlations.json'],
  risk: ['market-analysis.json'], 'bottom-tracker': ['bottom-tracker.json'],
  picks: ['picks.json', 'picks-open.json'], leaps: ['leaps-picks.json'], stocks: ['stock-picks.json'],
  rotation: ['sector-rotation.json'], levetf: ['leveraged-etfs.json'],
  'open-picks': ['picks-open.json', 'picks-accuracy.json'],
  track: ['picks-accuracy.json', 'picks-changes.json', 'picks-roster.json', 'grades-history.json'],
  quant: ['quant.json'],
};

// Bound inside bindPageTabs, after the split-view bindings: shares the wf*
// site-map helpers, IS_EMBED and closeWorkspaceSettings.
export function renderExportBindings() {
  return `
    var exportToggle = document.getElementById('export-toggle');
    var exportPanel = null, exportParts = [], exportChoice = 0, exportBusy = false, exportTab = 'home';
    var exportShot = null; // last picture made: { key, blob }
    // Learn & help pages are guides and legal text, not data.
    var EXPORT_SKIP_SECTIONS = { learn: 1 };
    var EXPORT_SOURCES = ${JSON.stringify(EXPORT_SOURCES)};
    function exportOwner(){ return HAS_OWNER_ACCESS && !IS_EMBED; }
    function exportTabNow(){
      var a = document.querySelector('[data-page-tab][aria-controls][aria-selected="true"]');
      return a ? a.getAttribute('data-page-tab') : 'home';
    }
    function exportPaneOf(tab){
      var a = document.querySelector('[data-page-tab="' + tab + '"][aria-controls]');
      return a ? document.getElementById(a.getAttribute('aria-controls')) : null;
    }
    function exportPageLabel(tab){ var it = wfItem(tab); return it ? it[1] : tab; }
    function exportShown(el){ return !!(el && el.getClientRects().length && !el.closest('[hidden]')); }
    function exportClean(s){ return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
    function exportSlug(s){ return exportClean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export'; }
    function exportStamp(){
      var d = new Date();
      function p(n){ return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }
    function exportWhen(){
      try { return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; }
      catch (_) { return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
    }
    function exportHeading(el){
      var h = el.querySelector('h1, h2, h3, .card-title, .picks-group-title');
      return h ? exportClean(h.textContent).slice(0, 60) : '';
    }
    // A table's name: its caption or label, else the nearest heading above it
    // inside the same card.
    function exportTableName(t, i){
      var cap = t.querySelector('caption');
      if (cap && exportClean(cap.textContent)) return exportClean(cap.textContent).slice(0, 60);
      if (t.getAttribute('aria-label')) return exportClean(t.getAttribute('aria-label')).slice(0, 60);
      var node = t;
      for (var hops = 0; node && hops < 40; hops++){
        var prev = node.previousElementSibling;
        while (prev){
          if (/^H[1-6]$/.test(prev.tagName) || (prev.classList && prev.classList.contains('card-title'))) return exportClean(prev.textContent).slice(0, 60);
          var inner = prev.querySelectorAll ? prev.querySelectorAll('h2, h3, h4, .card-title') : [];
          if (inner.length) return exportClean(inner[inner.length - 1].textContent).slice(0, 60);
          prev = prev.previousElementSibling;
        }
        node = node.parentElement;
        if (!node || node.classList.contains('page-pane')) break;
      }
      return 'Table ' + (i + 1);
    }
    // Picks: the card grid (all, or one group), and an opened pick with
    // whichever of its Recommendation / Grade views is showing.
    function exportPicksParts(pane, out){
      var data = (typeof picksState !== 'undefined' && picksState.data) ? picksState.data : null;
      var all = data && Array.isArray(data.picks) ? data.picks : [];
      var detail = document.getElementById('picks-detail-card');
      if (exportShown(detail)){
        var card = detail.querySelector('.pick-card');
        var sym = card ? card.getAttribute('data-symbol') : '';
        var tab = detail.querySelector('.pick-tab.is-active');
        var pick = all.filter(function(p){ return p.symbol === sym; })[0] || null;
        out.push({ label: (sym || 'This pick') + (tab ? ' · ' + exportClean(tab.textContent) + ' view' : ''), el: detail, slug: 'pick-' + sym,
          rows: function(){ return picksExportRows().filter(function(r){ return r.ticker === sym; }); },
          raw: function(){ return pick || (typeof picksGradesState !== 'undefined' && picksGradesState.data && picksGradesState.data.grades ? picksGradesState.data.grades[sym] || null : null); } });
      }
      var grid = document.getElementById('picks-grid');
      if (!exportShown(grid)) return;
      out.push({ label: 'All pick cards', el: grid, slug: 'cards', rows: picksExportRows, raw: function(){ return all; } });
      var heads = grid.querySelectorAll(':scope > .picks-group-head');
      var groups = [];
      for (var i = 0; i < heads.length; i++){
        var cards = [], n = heads[i].nextElementSibling;
        while (n && !n.classList.contains('picks-group-head')){ if (n.matches('[data-symbol], .pick-tab-card, .pick-card')) cards.push(n); n = n.nextElementSibling; }
        if (!cards.length) continue;
        var syms = cards.map(function(c){ return c.getAttribute('data-symbol') || (c.querySelector('.ptc-sym') || {}).textContent || ''; });
        var keep = [heads[i]].concat(cards);
        var title = exportClean((heads[i].querySelector('.picks-group-title') || heads[i]).textContent);
        groups.push({ label: title + ' only (' + cards.length + ')', el: grid, keep: keep, slug: exportSlug(title),
          rows: (function(s){ return function(){ return picksExportRows().filter(function(r){ return s.indexOf(r.ticker) !== -1; }); }; })(syms),
          raw: (function(s){ return function(){ return all.filter(function(p){ return s.indexOf(p.symbol) !== -1; }); }; })(syms) });
      }
      // One group alone is just "All pick cards" again.
      if (groups.length > 1) groups.forEach(function(g){ out.push(g); });
    }
    var EXPORT_TAB_PARTS = {
      picks: exportPicksParts,
      track: function(pane, out){
        var on = pane.querySelector('.acc-tab[aria-selected="true"], .acc-tab.is-active');
        var acc = Array.prototype.filter.call(pane.querySelectorAll('.acc-pane'), exportShown)[0];
        if (acc) out.push({ label: 'Track record · ' + (on ? exportClean(on.textContent) : 'this view'), el: acc, slug: 'track-' + exportSlug(on ? on.textContent : 'view') });
      },
      // The whole page's data is the rows under the current filters.
      flow: function(pane, out){ out[0].rows = flowExportRows; },
      calendar: function(pane, out){ out[0].rows = calendarExportRows; }
    };
    function exportFindParts(tab){
      var pane = exportPaneOf(tab);
      if (!pane || !exportShown(pane)) return [];
      var out = [];
      var page = exportPageLabel(tab);
      out.push({ label: 'Whole page', el: pane, page: true, slug: 'page' });
      try { if (EXPORT_TAB_PARTS[tab]) EXPORT_TAB_PARTS[tab](pane, out); } catch (_) {}
      var seen = out.map(function(p){ return p.keep ? null : p.el; });
      var paneH = pane.getBoundingClientRect().height || 1;
      // Each top-level card with a heading, unless it is the whole page anyway.
      var cards = pane.querySelectorAll('.card, section[aria-labelledby]');
      for (var i = 0; i < cards.length && out.length < 14; i++){
        var c = cards[i];
        if (!exportShown(c) || seen.indexOf(c) !== -1) continue;
        if (c.parentElement && c.parentElement.closest('.card') && c.parentElement.closest('.card') !== pane) continue;
        var h = exportHeading(c);
        if (!h || c.getBoundingClientRect().height > paneH * 0.85) continue;
        seen.push(c);
        out.push({ label: h, el: c, slug: exportSlug(h) });
      }
      // Sections someone opened (an expanded grade, a "show more" panel).
      var opened = pane.querySelectorAll('[aria-expanded="true"][aria-controls]');
      for (var j = 0; j < opened.length && out.length < 14; j++){
        var target = document.getElementById(opened[j].getAttribute('aria-controls'));
        if (!target || !pane.contains(target) || !exportShown(target) || seen.indexOf(target) !== -1) continue;
        var th = target.getBoundingClientRect().height;
        if (th < 60) continue;
        if (seen.some(function(x){ return x && x !== pane && x.contains(target) && th > x.getBoundingClientRect().height * 0.7; })) continue;
        var name = exportClean(opened[j].textContent || opened[j].getAttribute('aria-label')).slice(0, 50) || 'Opened section';
        seen.push(target);
        out.push({ label: 'Opened: ' + name, el: target, slug: exportSlug(name) });
      }
      // Blocks inside the page that carry their own heading (a brief's
      // "Biggest movers", a track-record panel), widest headings first.
      ['h3', 'h4'].forEach(function(level){
        var hs = Array.prototype.filter.call(pane.querySelectorAll(level), function(h){ return exportShown(h) && !h.closest('nav, .export-panel'); });
        if (level === 'h4' && hs.length > 12) return;
        hs.forEach(function(hd){
          if (out.length >= 12) return;
          var block = hd.parentElement;
          if (block && /header|head$/i.test(block.className || '') && block.parentElement) block = block.parentElement;
          if (!block || block === pane || seen.indexOf(block) !== -1) return;
          var bh = block.getBoundingClientRect().height;
          if (bh < 80 || bh > paneH * 0.85) return;
          if (seen.some(function(x){ return x && x !== pane && x.contains(block) && bh > x.getBoundingClientRect().height * 0.7; })) return;
          var name = exportClean(hd.textContent).slice(0, 60);
          if (!name) return;
          seen.push(block);
          out.push({ label: name, el: block, slug: exportSlug(name) });
        });
      });
      // Every visible table with at least two rows.
      var tables = pane.querySelectorAll('table');
      for (var k = 0; k < tables.length && out.length < 16; k++){
        var t = tables[k];
        if (!exportShown(t) || t.rows.length < 2 || seen.indexOf(t) !== -1) continue;
        var tn = exportTableName(t, k);
        seen.push(t);
        out.push({ label: 'Table: ' + tn, el: t, slug: exportSlug(tn) });
      }
      out.forEach(function(p){ p.page_ = page; });
      return out;
    }

    // ---- Data out of the page ------------------------------------------
    function exportReadTable(t, name){
      var rows = [];
      for (var r = 0; r < t.rows.length; r++){
        var tr = t.rows[r];
        if (!exportShown(tr)) continue;
        var cells = [];
        for (var c = 0; c < tr.cells.length; c++){
          var v = exportClean(tr.cells[c].innerText || tr.cells[c].textContent);
          cells.push(v);
          var span = Math.min(20, parseInt(tr.cells[c].getAttribute('colspan') || '1', 10) || 1);
          for (var s = 1; s < span; s++) cells.push('');
        }
        if (cells.some(function(x){ return x !== ''; })) rows.push(cells);
      }
      if (rows.length < 2) return null;
      var width = rows.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
      var head = rows[0].slice();
      while (head.length < width) head.push('');
      var used = {};
      head = head.map(function(h, i){
        var key = h || ('Column ' + (i + 1));
        if (used[key]) key += ' (' + (++used[key]) + ')'; else used[key] = 1;
        return key;
      });
      return { name: name, head: head, rows: rows.slice(1).map(function(r){ while (r.length < width) r.push(''); return r; }) };
    }
    // The part's data as one or more tables. A page with its own data
    // (Top picks, Unusual options trades, Calendar) exports that; otherwise
    // the tables showing inside the part.
    function exportTables(part){
      if (part.rows){
        var list = [];
        try { list = part.rows() || []; } catch (_) { list = []; }
        if (list.length){
          var head = Object.keys(list[0]);
          return [{ name: part.label, head: head, rows: list.map(function(o){ return head.map(function(h){ return o[h] == null ? '' : o[h]; }); }) }];
        }
      }
      var el = part.el, found = [];
      var ts = el.tagName === 'TABLE' ? [el] : el.querySelectorAll('table');
      for (var i = 0; i < ts.length; i++){
        if (!exportShown(ts[i])) continue;
        if (part.keep && !part.keep.some(function(k){ return k.contains(ts[i]); })) continue;
        var t = exportReadTable(ts[i], exportTableName(ts[i], i));
        if (t) found.push(t);
      }
      return found;
    }
    function exportCsvText(tables){
      return tables.map(function(t){
        var lines = [];
        if (tables.length > 1) lines.push(csvEscape(t.name));
        lines.push(t.head.map(csvEscape).join(','));
        t.rows.forEach(function(r){ lines.push(r.map(csvEscape).join(',')); });
        return lines.join('\\r\\n');
      }).join('\\r\\n\\r\\n') + '\\r\\n';
    }
    function exportTsvText(tables){
      function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }
      return tables.map(function(t){
        return [t.head.map(cell).join('\\t')].concat(t.rows.map(function(r){ return r.map(cell).join('\\t'); })).join('\\n');
      }).join('\\n\\n');
    }
    function exportJsonTables(tables){
      return tables.map(function(t){
        return { table: t.name, rows: t.rows.map(function(r){ var o = {}; t.head.forEach(function(h, i){ o[h] = r[i]; }); return o; }) };
      });
    }
    // "1,234.5" -> 1234.5 for spreadsheets; anything with words stays text.
    function exportNumber(v){
      if (typeof v === 'number') return isFinite(v) ? v : null;
      var s = String(v == null ? '' : v).trim();
      if (!/^[-+\\u2212]?\\$?[0-9][0-9,]*(\\.[0-9]+)?$/.test(s) && !/^[-+\\u2212]?\\$?\\.[0-9]+$/.test(s)) return null;
      var n = Number(s.replace(/[$,+]/g, '').replace('\\u2212', '-'));
      return isFinite(n) ? n : null;
    }

    // ---- The page's own data files --------------------------------------
    // Most pages draw cards rather than tables, so a whole-page CSV / Excel /
    // JSON is built from the data files that page read. A file is read again
    // through the same Owner gate (and kept for the next export).
    var exportCache = [];
    function exportLoadSource(key){
      for (var i = 0; i < exportCache.length; i++) if (exportCache[i].key === key) return exportCache[i].p;
      var p = fetch(dataUrl(key), { cache: 'no-cache', credentials: 'same-origin' }).then(function(r){
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'sign in again' : 'not available');
        return r.json();
      });
      exportCache.unshift({ key: key, p: p });
      if (exportCache.length > 6) exportCache.length = 6;
      p.catch(function(){ exportCache = exportCache.filter(function(c){ return c.p !== p; }); });
      return p;
    }
    function exportScalar(v){
      if (v == null) return '';
      if (typeof v === 'object') return null;
      return v;
    }
    // One object -> flat columns: nested fields as "a.b", short lists joined.
    function exportFlatRow(o, prefix, row, depth){
      Object.keys(o).forEach(function(k){
        var v = o[k], name = prefix ? prefix + '.' + k : k;
        var sc = exportScalar(v);
        if (sc !== null){ row[name] = sc; return; }
        if (Array.isArray(v)){
          if (v.every(function(x){ return exportScalar(x) !== null; })) row[name] = v.join('; ');
          else row[name] = v.length + (v.length === 1 ? ' item' : ' items');
          return;
        }
        if (depth < 2) exportFlatRow(v, name, row, depth + 1);
      });
      return row;
    }
    // The lists of records inside a data file (arrays of objects, or maps
    // of ticker -> object), biggest first.
    function exportFindLists(json, file){
      var found = [];
      function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }
      function walk(v, path, depth){
        if (Array.isArray(v)){
          var objs = v.filter(isObj);
          if (objs.length >= 2 && objs.length >= v.length * 0.8) found.push({ path: path, items: objs, keyed: false });
          return;
        }
        if (!isObj(v) || depth > 3) return;
        var keys = Object.keys(v);
        if (keys.length >= 5 && keys.every(function(k){ return isObj(v[k]); }) && /^[A-Z0-9^.=-]{1,12}$/.test(keys[0])){
          found.push({ path: path, items: keys.map(function(k){ var o = { key: k }; Object.keys(v[k]).forEach(function(f){ o[f] = v[k][f]; }); return o; }), keyed: true });
          return;
        }
        keys.forEach(function(k){ walk(v[k], path ? path + '.' + k : k, depth + 1); });
      }
      walk(json, '', 0);
      found.sort(function(a, b){ return b.items.length - a.items.length; });
      return found.slice(0, 4).map(function(f){
        var rows = f.items.slice(0, 5000).map(function(o){ return exportFlatRow(o, '', {}, 0); });
        var head = [];
        rows.slice(0, 300).forEach(function(r){ Object.keys(r).forEach(function(k){ if (head.indexOf(k) === -1 && head.length < 80) head.push(k); }); });
        var base = file.replace(/\.json$/, '');
        return { name: f.path ? base + ' ' + f.path : base, head: head, rows: rows.map(function(r){ return head.map(function(h){ return r[h] == null ? '' : r[h]; }); }) };
      });
    }
    // Everything a data export needs for a part: { tables, raw, files }.
    function exportData(part){
      var tables = exportTables(part), raw = null;
      try { raw = part.raw ? part.raw() : null; } catch (_) {}
      if (!part.page || tables.length || raw != null) return Promise.resolve({ tables: tables, raw: raw });
      var keys = exportSources(exportTab);
      return Promise.all(keys.map(function(k){ return exportLoadSource(k).then(function(j){ return { key: k, json: j }; }, function(){ return null; }); })).then(function(list){
        var files = {}, out = [];
        list.forEach(function(f){
          if (!f) return;
          files[f.key] = f.json;
          exportFindLists(f.json, f.key).forEach(function(t){ if (out.length < 8) out.push(t); });
        });
        return { tables: out, raw: null, files: Object.keys(files).length ? files : null };
      });
    }
    function exportHasData(part){
      if (part.rows || part.raw) return true;
      if (part.page && exportSources(exportTab).length) return true;
      return exportTables(part).length > 0;
    }

    // ---- Files ---------------------------------------------------------
    function exportSave(blob, name){
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1500);
    }
    var EXPORT_CRC = null;
    function exportCrc32(bytes){
      if (!EXPORT_CRC){
        EXPORT_CRC = new Uint32Array(256);
        for (var n = 0; n < 256; n++){ var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; EXPORT_CRC[n] = c >>> 0; }
      }
      var crc = 0xFFFFFFFF;
      for (var i = 0; i < bytes.length; i++) crc = EXPORT_CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    // A plain (stored, uncompressed) zip: all an .xlsx needs.
    function exportZip(files){
      var enc = new TextEncoder(), parts = [], central = [], offset = 0;
      function u16(v){ return [v & 255, (v >>> 8) & 255]; }
      function u32(v){ return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
      files.forEach(function(f){
        var name = enc.encode(f.name), data = enc.encode(f.text), crc = exportCrc32(data);
        var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
        parts.push(new Uint8Array(head), name, data);
        central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
        offset += head.length + name.length + data.length;
      });
      var size = central.reduce(function(m, b){ return m + b.length; }, 0);
      var end = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(size), u32(offset), u16(0)));
      return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
    }
    function exportXml(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/g, ''); }
    function exportColName(i){ var s = ''; i++; while (i > 0){ var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
    function exportXlsx(tables){
      var files = [], sheets = [], used = {};
      tables.forEach(function(t, n){
        var name = String(t.name || ('Sheet ' + (n + 1))).replace(/[\\[\\]:*?\\/\\\\]/g, ' ').trim().slice(0, 28) || ('Sheet ' + (n + 1));
        if (used[name.toLowerCase()]) name = name.slice(0, 25) + ' ' + (n + 1);
        used[name.toLowerCase()] = 1;
        sheets.push(name);
        var all = [t.head].concat(t.rows);
        var xml = all.map(function(r, ri){
          return '<row r="' + (ri + 1) + '">' + r.map(function(v, ci){
            var ref = exportColName(ci) + (ri + 1);
            var num = ri === 0 ? null : exportNumber(v);
            if (num != null) return '<c r="' + ref + '"><v>' + num + '</v></c>';
            if (v === '' || v == null) return '';
            return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + exportXml(v) + '</t></is></c>';
          }).join('') + '</row>';
        }).join('');
        files.push({ name: 'xl/worksheets/sheet' + (n + 1) + '.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + xml + '</sheetData></worksheet>' });
      });
      var ns = 'http://schemas.openxmlformats.org/';
      files.unshift(
        { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + ns + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map(function(_, i){ return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
        { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships"><Relationship Id="rId1" Type="' + ns + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + ns + 'spreadsheetml/2006/main" xmlns:r="' + ns + 'officeDocument/2006/relationships"><sheets>' + sheets.map(function(s, i){ return '<sheet name="' + exportXml(s) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + ns + 'package/2006/relationships">' + sheets.map(function(_, i){ return '<Relationship Id="rId' + (i + 1) + '" Type="' + ns + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + ns + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
        { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + ns + 'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' }
      );
      return new Blob([exportZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    // ---- Pictures ------------------------------------------------------
    var exportLibLoad = null;
    function exportLib(){
      if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
      if (exportLibLoad) return exportLibLoad;
      exportLibLoad = new Promise(function(resolve, reject){
        var s = document.createElement('script');
        s.src = '${EXPORT_IMAGE_LIB}';
        s.async = true;
        s.onload = function(){ window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error('Image tool did not load')); };
        s.onerror = function(){ exportLibLoad = null; reject(new Error('Image tool did not load')); };
        document.head.appendChild(s);
      });
      return exportLibLoad;
    }
    // The site's fonts, latin only, inlined once so pictures use them too.
    var exportFontCss = null;
    function exportFonts(){
      if (exportFontCss) return exportFontCss;
      var link = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
      if (!link || !window.fetch) return (exportFontCss = Promise.resolve(''));
      exportFontCss = fetch(link.href).then(function(r){ if (!r.ok) throw new Error('fonts'); return r.text(); }).then(function(css){
        var blocks = css.split(/(?=\\/\\*\\s*[a-z-]+\\s*\\*\\/)/).filter(function(b){ return /^\\/\\*\\s*latin\\s*\\*\\//.test(b); });
        return Promise.all(blocks.map(function(b){
          var m = b.match(/url\\((https:[^)]+)\\)/);
          if (!m) return '';
          return fetch(m[1]).then(function(r){ return r.blob(); }).then(function(blob){
            return new Promise(function(res){ var fr = new FileReader(); fr.onload = function(){ res(b.replace(m[1], fr.result)); }; fr.onerror = function(){ res(''); }; fr.readAsDataURL(blob); });
          }).catch(function(){ return ''; });
        })).then(function(list){ return list.join('\\n'); });
      }).catch(function(){ return ''; });
      return exportFontCss;
    }
    function exportVar(name, fallback){
      var v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    }
    // Hide what the picture leaves out (page links, the other pick group)
    // while it is drawn, behind a short "Preparing" cover.
    function exportHideFor(part){
      var hidden = [];
      function hide(el){ if (el && !el.classList.contains('export-hide')){ el.classList.add('export-hide'); hidden.push(el); } }
      if (part.page) Array.prototype.forEach.call(part.el.querySelectorAll(':scope > .wf-head, :scope > .wf-foot'), hide);
      // Buttons that only mean something on the site (watch stars, "View
      // judgment", the old Export CSV buttons) stay out of the export.
      Array.prototype.forEach.call(part.el.querySelectorAll('.ptc-cta, .ptc-watch, .csv-export-btn'), hide);
      if (part.keep) Array.prototype.forEach.call(part.el.children, function(c){ if (part.keep.indexOf(c) === -1) hide(c); });
      return function(){ hidden.forEach(function(el){ el.classList.remove('export-hide'); }); };
    }
    function exportCanvas(part){
      return Promise.all([exportLib(), exportFonts()]).then(function(got){
        var lib = got[0], fontCss = got[1];
        var cover = document.createElement('div');
        cover.className = 'export-cover';
        cover.innerHTML = '<span>Preparing image&hellip;</span>';
        document.body.appendChild(cover);
        var restore = exportHideFor(part);
        var scrollY = window.scrollY;
        var el = part.el;
        var w = Math.ceil(el.scrollWidth), h = Math.ceil(el.scrollHeight);
        // Stay inside what phones can draw (about 16 million pixels).
        var ratio = Math.min(2, Math.max(0.5, Math.sqrt(16e6 / Math.max(1, w * h))), 16000 / Math.max(1, h));
        var bg = exportVar('--bg', '#ffffff');
        var opts = { pixelRatio: ratio, backgroundColor: bg, width: w, height: h, cacheBust: false,
          style: { margin: '0', transform: 'none' },
          filter: function(node){ return !(node.classList && (node.classList.contains('export-hide') || node.classList.contains('export-cover'))); } };
        if (fontCss) opts.fontEmbedCSS = fontCss; else opts.skipFonts = true;
        function done(){ restore(); cover.remove(); window.scrollTo(0, scrollY); }
        return lib.toCanvas(el, opts).then(function(c){ done(); return exportFrame(c, part, ratio); }, function(err){ done(); throw err; });
      });
    }
    // Title strip above and source line below, in the page's own colors.
    function exportFrame(shot, part, ratio){
      var pad = Math.round(24 * ratio), top = Math.round(64 * ratio), foot = Math.round(40 * ratio);
      var c = document.createElement('canvas');
      c.width = shot.width + pad * 2;
      c.height = shot.height + top + foot + pad;
      var g = c.getContext('2d');
      g.fillStyle = exportVar('--bg', '#ffffff');
      g.fillRect(0, 0, c.width, c.height);
      var sans = exportVar('--font-sans', 'system-ui, sans-serif');
      g.textBaseline = 'alphabetic';
      g.fillStyle = exportVar('--text-strong', '#111111');
      g.font = '700 ' + Math.round(20 * ratio) + 'px ' + sans;
      var title = part.page_ + (part.page ? '' : ' · ' + part.label);
      g.fillText(title, pad, Math.round(38 * ratio), c.width - pad * 2);
      g.fillStyle = exportVar('--muted', '#666666');
      g.font = '500 ' + Math.round(13 * ratio) + 'px ' + sans;
      g.fillText('Exported ' + exportWhen(), pad, Math.round(57 * ratio), c.width - pad * 2);
      g.drawImage(shot, pad, top);
      g.fillText('mingstreet.app · Research only, not investment advice.', pad, top + shot.height + Math.round(26 * ratio), c.width - pad * 2);
      return c;
    }
    function exportBlob(canvas, type, quality){
      return new Promise(function(resolve, reject){
        canvas.toBlob(function(b){ b ? resolve(b) : reject(new Error('Could not make the image')); }, type, quality);
      });
    }
    // A picture PDF: the image on one tall page (split if very long), so it
    // opens the same everywhere. Print / Save as PDF keeps selectable text.
    function exportPdf(canvas){
      var pageW = 612, scale = pageW / canvas.width, maxH = 14000;
      var sliceH = Math.floor(maxH / scale), slices = [];
      for (var y = 0; y < canvas.height; y += sliceH) slices.push([y, Math.min(sliceH, canvas.height - y)]);
      return Promise.all(slices.map(function(s){
        var part = document.createElement('canvas');
        part.width = canvas.width; part.height = s[1];
        var g = part.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, part.width, part.height);
        g.drawImage(canvas, 0, -s[0]);
        return exportBlob(part, 'image/jpeg', 0.92).then(function(b){ return b.arrayBuffer(); }).then(function(buf){ return { w: part.width, h: part.height, jpg: new Uint8Array(buf) }; });
      })).then(function(pages){
        var enc = new TextEncoder(), chunks = [], offsets = [], len = 0;
        function add(x){ var b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; }
        function obj(n, body){ offsets[n] = len; add(n + ' 0 obj\\n'); body(); add('\\nendobj\\n'); }
        var count = 2 + pages.length * 3;
        add('%PDF-1.4\\n%\\u00e2\\u00e3\\n');
        obj(1, function(){ add('<< /Type /Catalog /Pages 2 0 R >>'); });
        obj(2, function(){ add('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map(function(_, i){ return (3 + i * 3) + ' 0 R'; }).join(' ') + '] >>'); });
        pages.forEach(function(p, i){
          var n = 3 + i * 3, w = pageW, h = Math.round(p.h * scale * 100) / 100;
          var draw = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
          obj(n, function(){ add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 ' + (n + 2) + ' 0 R >> >> /Contents ' + (n + 1) + ' 0 R >>'); });
          obj(n + 1, function(){ add('<< /Length ' + draw.length + ' >>\\nstream\\n' + draw + '\\nendstream'); });
          obj(n + 2, function(){ add('<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>\\nstream\\n'); add(p.jpg); add('\\nendstream'); });
        });
        var xref = len;
        var table = 'xref\\n0 ' + (count + 1) + '\\n0000000000 65535 f \\n';
        for (var k = 1; k <= count; k++) table += String(offsets[k]).padStart(10, '0') + ' 00000 n \\n';
        add(table + 'trailer\\n<< /Size ' + (count + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF\\n');
        return new Blob(chunks, { type: 'application/pdf' });
      });
    }
    function exportPicture(part){
      var key = exportPartKey(part);
      if (exportShot && exportShot.key === key && Date.now() - exportShot.at < 60000) return Promise.resolve(exportShot);
      return exportCanvas(part).then(function(canvas){
        return exportBlob(canvas, 'image/png').then(function(blob){
          exportShot = { key: key, blob: blob, canvas: canvas, at: Date.now() };
          return exportShot;
        });
      });
    }
    function exportPartKey(part){ return exportTab + '|' + part.label; }
    // Print / Save as PDF: only the chosen part is printed.
    function exportPrint(part){
      var path = [], n = part.el;
      while (n && n !== document.body){ n.classList.add('export-print-path'); path.push(n); n = n.parentElement; }
      part.el.classList.add('export-print-target');
      var restore = exportHideFor(part);
      var head = document.createElement('div');
      head.className = 'export-print-head';
      head.innerHTML = '<b>' + escapeHtml(part.page_ + (part.page ? '' : ' · ' + part.label)) + '</b><span>Exported ' + escapeHtml(exportWhen()) + ' · mingstreet.app</span>';
      document.body.insertBefore(head, document.body.firstChild);
      document.documentElement.classList.add('exporting-print');
      function cleanup(){
        window.removeEventListener('afterprint', cleanup);
        document.documentElement.classList.remove('exporting-print');
        path.forEach(function(el){ el.classList.remove('export-print-path'); });
        part.el.classList.remove('export-print-target');
        head.remove();
        restore();
      }
      window.addEventListener('afterprint', cleanup);
      // Browsers that skip afterprint: the next tap or key means the dialog closed.
      // (The tap that chose Print has already finished its pointerdown.)
      function late(){ document.removeEventListener('pointerdown', late, true); document.removeEventListener('keydown', late, true); if (document.documentElement.classList.contains('exporting-print')) cleanup(); }
      document.addEventListener('pointerdown', late, true);
      document.addEventListener('keydown', late, true);
      window.print();
    }

    // ---- Menu ----------------------------------------------------------
    var EXPORT_FORMATS = [
      ['png', 'Image (PNG)', 'picture'],
      ['copy-img', 'Copy image', 'picture'],
      ['share', 'Share image', 'picture'],
      ['pdf', 'PDF', 'picture'],
      ['print', 'Print / Save as PDF', 'picture'],
      ['csv', 'CSV', 'data'],
      ['xlsx', 'Excel (.xlsx)', 'data'],
      ['json', 'JSON', 'data'],
      ['copy-table', 'Copy table', 'data']
    ];
    function exportCanShare(){
      try { return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); } catch (_) { return false; }
    }
    function exportSources(tab){
      var list = (EXPORT_SOURCES[tab] || []).slice();
      if (tab === 'grade' && state.symbol && /^[A-Z0-9.^=-]{1,12}$/.test(state.symbol)) list.unshift(state.symbol + '.json');
      return list;
    }
    function exportStatus(msg, bad){
      if (!exportPanel) return;
      var s = exportPanel.querySelector('.export-status');
      if (s){ s.textContent = msg || ''; s.classList.toggle('is-bad', !!bad); }
    }
    function exportBuild(){
      if (exportPanel) return exportPanel;
      exportPanel = document.createElement('div');
      exportPanel.id = 'export-panel';
      exportPanel.className = 'export-panel';
      exportPanel.setAttribute('role', 'dialog');
      exportPanel.setAttribute('aria-label', 'Export');
      exportPanel.hidden = true;
      document.body.appendChild(exportPanel);
      exportPanel.addEventListener('change', function(ev){
        if (ev.target && ev.target.name === 'export-part'){ exportChoice = Number(ev.target.value) || 0; exportMark(); exportSyncFormats(); }
      });
      exportPanel.addEventListener('click', function(ev){
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-export-format], [data-export-source], [data-export-close]') : null;
        if (!t || t.disabled) return;
        if (t.hasAttribute('data-export-close')) return exportClose(true);
        if (t.hasAttribute('data-export-source')) return exportSource(t.getAttribute('data-export-source'));
        exportRun(t.getAttribute('data-export-format'));
      });
      exportPanel.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape'){ ev.preventDefault(); exportClose(true); }
      });
      return exportPanel;
    }
    function exportRender(){
      var tab = exportTab = exportTabNow();
      var sec = wfSectionOf(tab);
      var skip = !!(sec && EXPORT_SKIP_SECTIONS[sec.sec[0]]);
      exportParts = skip ? [] : exportFindParts(tab);
      if (exportChoice >= exportParts.length) exportChoice = 0;
      var head = '<div class="export-head"><div><b>Export</b><span>' + escapeHtml(exportPageLabel(tab)) + '</span></div>' +
        '<button type="button" class="export-x" data-export-close aria-label="Close export">&times;</button></div>';
      if (!exportParts.length){
        var split = document.body.classList.contains('split-on');
        exportPanel.innerHTML = head + '<p class="export-empty">' + (split ? 'Close split view first, then export the page you want.' : skip ? 'This page is a guide, so there is no data to export. Open a data page such as Top picks or the track record.' : 'Nothing on this page can be exported yet. Wait for it to finish loading.') + '</p>';
        return;
      }
      var parts = exportParts.map(function(p, i){
        return '<label class="export-part"><input type="radio" name="export-part" value="' + i + '"' + (i === exportChoice ? ' checked' : '') + '><span>' + escapeHtml(p.label) + '</span></label>';
      }).join('');
      var formats = EXPORT_FORMATS.filter(function(f){ return f[0] !== 'share' || exportCanShare(); }).map(function(f){
        return '<button type="button" class="export-fmt export-fmt-' + f[2] + '" data-export-format="' + f[0] + '">' + escapeHtml(f[1]) + '</button>';
      }).join('');
      var sources = exportSources(tab);
      exportPanel.innerHTML = head +
        '<fieldset class="export-parts"><legend>What to export</legend>' + parts + '</fieldset>' +
        '<div class="export-fmts" role="group" aria-label="Format">' + formats + '</div>' +
        (sources.length ? '<div class="export-sources"><span>Source data (JSON)</span>' + sources.map(function(k){ return '<button type="button" class="export-src" data-export-source="' + escapeHtml(k) + '">' + escapeHtml(k) + '</button>'; }).join('') + '</div>' : '') +
        '<p class="export-status" role="status" aria-live="polite"></p>';
      exportSyncFormats();
      exportMark();
    }
    function exportSyncFormats(){
      var part = exportParts[exportChoice];
      if (!part) return;
      var hasData = exportHasData(part);
      Array.prototype.forEach.call(exportPanel.querySelectorAll('[data-export-format]'), function(b){
        var f = b.getAttribute('data-export-format');
        var isData = b.classList.contains('export-fmt-data');
        var off = (isData && !hasData) || (f === 'copy-img' && !(navigator.clipboard && window.ClipboardItem)) || (f === 'copy-table' && !(navigator.clipboard && (navigator.clipboard.writeText || window.ClipboardItem)));
        b.disabled = off;
        b.title = off && isData ? 'This part has no table or data behind it. Pick the whole page or a table.' : '';
      });
    }
    // Outline the part on the page while the menu is open.
    function exportMark(){
      Array.prototype.forEach.call(document.querySelectorAll('.export-target'), function(el){ el.classList.remove('export-target'); });
      var part = exportParts[exportChoice];
      if (part && !part.page) part.el.classList.add('export-target');
    }
    function exportPlace(){
      if (!exportPanel || exportPanel.hidden) return;
      var phone = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      if (phone){ exportPanel.style.top = ''; exportPanel.style.right = ''; return; }
      var r = (exportShown(exportToggle) ? exportToggle : document.getElementById('workspace-settings-toggle') || exportToggle).getBoundingClientRect();
      exportPanel.style.top = Math.round(r.bottom + 8) + 'px';
      exportPanel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    }
    function exportOpen(){
      if (!exportOwner()) return;
      exportBuild();
      try { closeWorkspaceSettings(false); } catch (_) {}
      exportChoice = 0;
      exportRender();
      exportPanel.hidden = false;
      exportToggle.setAttribute('aria-expanded', 'true');
      exportPlace();
      var first = exportPanel.querySelector('input[name="export-part"]:checked, [data-export-close]');
      if (first) first.focus();
    }
    function exportClose(focusBack){
      if (!exportPanel || exportPanel.hidden) return;
      exportPanel.hidden = true;
      exportToggle.setAttribute('aria-expanded', 'false');
      Array.prototype.forEach.call(document.querySelectorAll('.export-target'), function(el){ el.classList.remove('export-target'); });
      if (focusBack){
        var t = exportShown(exportToggle) ? exportToggle : document.getElementById('workspace-settings-toggle');
        if (t) t.focus();
      }
    }
    function exportName(part, ext){ return 'mingstreet-' + exportSlug(exportTab) + (part.page ? '' : '-' + exportSlug(part.slug || part.label)) + '-' + exportStamp() + '.' + ext; }
    function exportRun(fmt){
      if (!exportOwner() || exportBusy) return;
      var part = exportParts[exportChoice];
      if (!part) return;
      Array.prototype.forEach.call(document.querySelectorAll('.export-target'), function(el){ el.classList.remove('export-target'); });
      function finish(msg, bad){ exportBusy = false; exportPanel.classList.remove('is-busy'); exportStatus(msg, bad); exportMark(); }
      function fail(err){ finish('Could not export: ' + ((err && err.message) || 'something went wrong') + '.', true); }
      if (fmt === 'csv' || fmt === 'xlsx' || fmt === 'json' || fmt === 'copy-table'){
        exportBusy = true;
        exportPanel.classList.add('is-busy');
        exportStatus('Gathering data\u2026');
        var gather = exportData(part);
        if (fmt === 'copy-table'){
          var text = gather.then(function(d){ if (!d.tables.length) throw new Error('no table here'); return exportTsvText(d.tables); });
          var copied;
          // Safari needs the clipboard write to start inside the tap.
          try { copied = window.ClipboardItem ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(function(t){ return new Blob([t], { type: 'text/plain' }); }) })]) : text.then(function(t){ return navigator.clipboard.writeText(t); }); }
          catch (_) { copied = text.then(function(t){ return navigator.clipboard.writeText(t); }); }
          copied.then(function(){ finish('Table copied. Paste it into a spreadsheet or message.'); }, fail);
          return;
        }
        gather.then(function(d){
          var tables = d.tables, rows = tables.reduce(function(m, t){ return m + t.rows.length; }, 0);
          if (fmt === 'json'){
            var doc = { page: part.page_, part: part.label, exportedAt: new Date().toISOString(), source: 'mingstreet.app' };
            if (d.raw != null) doc.data = d.raw;
            if (d.files) doc.files = d.files;
            if (tables.length && d.raw == null && !d.files) doc.tables = exportJsonTables(tables);
            exportSave(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), exportName(part, 'json'));
            return finish('Saved JSON.');
          }
          if (!tables.length) throw new Error('no table here');
          if (fmt === 'csv'){ exportSave(new Blob(['\ufeff' + exportCsvText(tables)], { type: 'text/csv;charset=utf-8' }), exportName(part, 'csv')); return finish('Saved CSV (' + rows + (rows === 1 ? ' row' : ' rows') + (tables.length > 1 ? ' in ' + tables.length + ' tables' : '') + ').'); }
          exportSave(exportXlsx(tables), exportName(part, 'xlsx'));
          finish('Saved Excel file (' + tables.length + (tables.length === 1 ? ' sheet, ' : ' sheets, ') + rows + ' rows).');
        }).catch(fail);
        return;
      }
      if (fmt === 'print'){ exportClose(false); exportPrint(part); return; }
      exportBusy = true;
      exportPanel.classList.add('is-busy');
      exportStatus('Preparing image\\u2026');
      if (fmt === 'copy-img'){
        // Safari needs the clipboard write to start inside the tap.
        var pending = exportPicture(part).then(function(s){ return s.blob; });
        try {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]).then(function(){ finish('Image copied. Paste it into a message or document.'); }, fail);
        } catch (err){ fail(err); }
        return;
      }
      exportPicture(part).then(function(shot){
        if (fmt === 'png'){ exportSave(shot.blob, exportName(part, 'png')); return finish('Saved image.'); }
        if (fmt === 'pdf') return exportPdf(shot.canvas).then(function(pdf){ exportSave(pdf, exportName(part, 'pdf')); finish('Saved PDF.'); });
        if (fmt === 'share'){
          var file = new File([shot.blob], exportName(part, 'png'), { type: 'image/png' });
          return navigator.share({ files: [file], title: part.page_ }).then(function(){ finish('Shared.'); }, function(err){
            // The tap expired while the image was drawn; the next tap shares at once.
            if (err && err.name === 'NotAllowedError') return finish('Image ready. Tap Share image again to send it.');
            if (err && err.name === 'AbortError') return finish('');
            fail(err);
          });
        }
      }).catch(fail);
    }
    // A data file this page read, saved as it is stored (Owner files go
    // through the same Owner gate as the page itself).
    function exportSource(key){
      if (!exportOwner() || exportBusy) return;
      exportBusy = true;
      exportStatus('Getting ' + key + '\u2026');
      exportLoadSource(key).then(function(json){
        exportSave(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), 'mingstreet-' + key.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/\.json$/, '') + '-' + exportStamp() + '.json');
        exportBusy = false;
        exportStatus('Saved ' + key + '.');
      }).catch(function(err){ exportBusy = false; exportStatus('Could not get ' + key + ': ' + err.message + '.', true); });
    }
    if (exportToggle){
      exportToggle.hidden = !exportOwner();
      exportToggle.addEventListener('click', function(ev){
        ev.stopPropagation();
        if (exportPanel && !exportPanel.hidden) exportClose(false); else exportOpen();
      });
      document.addEventListener('click', function(ev){
        // The download link's own (scripted) click must not close the menu.
        if (!exportPanel || exportPanel.hidden || !ev.isTrusted) return;
        if (exportPanel.contains(ev.target) || exportToggle.contains(ev.target)) return;
        exportClose(false);
      });
      window.addEventListener('resize', exportPlace);
      document.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape' && exportPanel && !exportPanel.hidden) exportClose(exportPanel.contains(document.activeElement));
      });
    }
`;
}

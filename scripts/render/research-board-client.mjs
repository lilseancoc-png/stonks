// Serialized with the shared board contract into the existing buildless app.
export function researchBoardClient(win, doc, root, options, model) {
  let board = model.empty(), attachments = new Map(), selected = null, selectedEdge = null, pending = null,
    history = [], future = [], sources = null, universe = null, sourceQuery = '', stockQuery = '', timer = null,
    generation = 0, saved = false, pendingImport = null, suppressClick = false, gestureCleanup = null, gestureCancel = null, damagedDraft = null, expanded = false, editingField = null, changeVersion = 0, saveError = false, saveQueue = Promise.resolve(), captureVersions = new Map(), lastDownload = null, downloadUrls = [];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const id = () => 'b' + win.crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const btn = (action, label, extra = '') => '<button type="button" data-rb="' + action + '" ' + extra + '>' + esc(label) + '</button>';
  const field = (key, label, value, extra = '') => '<label>' + esc(label) + '<input data-rb-field="' + key + '" value="' + esc(value) + '" ' + extra + '></label>';
  const select = (key, label, values, value) => '<label>' + esc(label) + '<select data-rb-field="' + key + '">' + values.map(([k, label]) => '<option value="' + esc(k) + '"' + (k === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select></label>';
  const notice = (s, error = false) => options.message(s, error);
  const date = v => v ? new Date(/^\d{4}-\d\d-\d\d$/.test(v) ? v + 'T12:00:00' : v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unknown';
  const selectedNode = () => board.nodes.find(n => n.id === selected);
  const encode = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return win.btoa(s); };
  const decode = base64 => Uint8Array.from(win.atob(base64), c => c.charCodeAt(0));
  const digest = async bytes => [...new Uint8Array(await win.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  function database() {
    return new Promise((resolve, reject) => {
      const r = win.indexedDB.open('stonks-research-board-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  function project() {
    const used = new Set(board.nodes.filter(n => n.kind === 'document').map(n => n.data.attachment_id));
    const retained = new Set([board, ...history, ...future].flatMap(b => b.nodes.filter(n => n.kind === 'document').map(n => n.data.attachment_id)));
    for (const key of attachments.keys()) if (!retained.has(key)) attachments.delete(key);
    return { schema: 'mingstreet.research-project.v1', board: structuredClone(board), attachments: [...attachments.values()].filter(a => used.has(a.id)) };
  }
  async function persist() {
    if (!options.allowed()) return;
    if (damagedDraft) throw new Error('The original saved draft is retained. Download it, then choose Replace saved draft to save this board.');
    const owner = options.identity(), payload = project(), epoch = generation, version = changeVersion;
    const operation = saveQueue.catch(() => {}).then(async () => {
      if (epoch !== generation || !options.allowed() || owner !== options.identity()) return;
      const db = await database();
      try {
        if (epoch !== generation || !options.allowed() || owner !== options.identity()) return;
        await new Promise((resolve, reject) => {
          const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(payload, owner);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        if (epoch === generation && version === changeVersion) { saved = true; saveError = false; saveStatus(); }
      } finally { db.close(); }
    });
    saveQueue = operation; try { await operation; } catch (error) { if (epoch === generation) { saveError = true; saveStatus(); } throw error; }
  }
  function saveStatus() { const el = root.querySelector('.rb-save-status'); if (el) el.textContent = saveError ? 'Not saved · export a backup' : saved ? 'Saved in this browser' : 'Saving in this browser…'; }
  function changed() {
    changeVersion++; saveError = false; saved = false; saveStatus(); win.clearTimeout(timer);
    if (!damagedDraft) timer = win.setTimeout(() => safe(persist, 'Automatic save failed. Download a board JSON to keep a copy.'), 350); else { saveError = true; saveStatus(); }
  }
  function remember() { history.push(structuredClone(board)); if (history.length > 30) history.shift(); future = []; }
  function edit(fn) { gestureCleanup?.(); remember(); fn(); changed(); render(); }
  async function safe(fn, prefix = '') { try { await fn(); } catch (e) { notice((prefix ? prefix + ' ' : '') + e.message, true); } }
  function render() {
    const openStock = root.querySelector('.rb-stock-shelf')?.open, openSource = root.querySelector('.rb-source-shelf')?.open, exportFormat = root.querySelector('#rb-export-format')?.value || 'zip';
    root.classList.toggle('rb-expanded', expanded);
    root.innerHTML = (damagedDraft ? '<section class="rb-data-alert" role="status"><p>Your saved board could not be opened and has been retained. Download the original for recovery, or explicitly replace it with your current board.</p>' + btn('recover-draft', 'Download original saved draft') + btn('replace-draft', 'Replace saved draft with this board') + '</section>' : '') + '<section class="rb-intro"><div><h3>Piece together your research</h3><p>Add a stock, bring in evidence, then connect what could affect it. Export the whole puzzle for an AI to review.</p></div><span class="rb-save-status">' + (saved ? 'Saved in this browser' : 'Local board · export to keep a copy') + '</span></section>' +
      '<div class="rb-starts" aria-label="Starting maps">' + btn('template-nvda', 'NVDA & AI spending') + btn('template-politics', 'Election, oil & bonds') + btn('template-blank', 'New blank board') + '</div>' +
      '<div class="rb-heading">' + field('board-title', 'Research title', board.title, 'maxlength="160"') + '<label>Your question<textarea data-rb-field="board-question" maxlength="4000" placeholder="What are you trying to understand?">' + esc(board.question) + '</textarea></label></div>' +
      '<div class="rb-readiness" aria-label="Research checklist"></div><div class="rb-actions">' + btn('save', 'Save board') + btn('import', 'Import files') + '<input id="rb-files" type="file" accept=".pdf,.txt,.md,.csv,.json,.docx" multiple hidden>' +
      '<label class="rb-format">Export as<select id="rb-export-format"><option value="zip">AI review bundle (.zip)</option><option value="json">Editable board (.json)</option><option value="md">Research brief (.md)</option><option value="csv">Blocks and links (.csv)</option><option value="html">Readable report (.html)</option><option value="pdf">Print / Save PDF</option></select></label>' + btn('export', 'Export puzzle') + '</div><div class="rb-download" role="status"></div>' +
      '<div class="rb-workbench"><aside class="rb-shelf" aria-label="Add research blocks"><h4>Add a block</h4><div class="rb-blocks">' + model.kinds.filter(k => !['evidence', 'document'].includes(k)).map(k => btn('add-' + k, model.label(k), 'draggable="true" data-rb-kind="' + k + '"')).join('') + '</div><p>Drag a block onto the canvas, or click to add it.</p>' +
      '<details class="rb-stock-shelf"><summary>All site stocks & ETFs</summary>' + (universe ? '<label>Find a symbol<input id="rb-stock-search" value="' + esc(stockQuery) + '" placeholder="NVDA, META, TLT…" type="search"></label><div class="rb-stock-list"></div>' : btn('universe', 'Browse covered symbols')) + '</details>' +
      '<details class="rb-source-shelf"><summary>Every site feature</summary>' + (sources ? '<label>Search sources<input id="rb-source-search" value="' + esc(sourceQuery) + '" placeholder="Earnings, rates, GPU…" type="search"></label><div class="rb-source-list"></div>' : btn('sources', 'Browse site evidence')) + '</details><p>PDF, Word, CSV, text and Markdown files become document blocks. Board JSON reopens a saved puzzle.</p></aside>' +
      '<div class="rb-canvas-shell"><div class="rb-canvas-tools">' + btn('undo', 'Undo', history.length ? '' : 'disabled') + btn('redo', 'Redo', future.length ? '' : 'disabled') + btn('zoom-out', '−', 'aria-label="Zoom research board out"') + btn('zoom-in', '+', 'aria-label="Zoom research board in"') + btn('fit', 'Fit puzzle') + btn('expand', expanded ? 'Close expanded view' : 'Expand canvas', 'aria-pressed="' + expanded + '"') + '<span class="rb-zoom">' + Math.round(board.viewport.zoom * 100) + '%</span></div><div class="rb-scroll" tabindex="0" aria-label="Research puzzle canvas" aria-describedby="rb-canvas-help"><div class="rb-stage"><div class="rb-plane"></div></div>' +
      (!board.nodes.length ? '<div class="rb-welcome"><h4>Start with your question</h4><p>Try a connected example above, or add your first stock. Every block can be moved and linked.</p>' + btn('add-stock', 'Add a stock') + '</div>' : '') + '</div><p id="rb-canvas-help" class="rb-canvas-help">Drag a card to move it. Drag empty space to pan. Connect right dot → left dot. Delete removes the selection.</p><div class="rb-connection-status" role="status">' + (pending ? 'Choose another block’s left dot to connect. Escape cancels.' : 'Click a card to edit its details. Arrow keys move a focused card.') + '</div></div>' +
      '<aside class="rb-inspector" aria-label="Research block details"></aside></div><section class="rb-outcomes" aria-label="Scenario analysis"></section><div class="rb-import-review"></div>';
    root.querySelector('.rb-stock-shelf').open = !!openStock; root.querySelector('.rb-source-shelf').open = !!openSource; root.querySelector('#rb-export-format').value = exportFormat;
    draw(); inspector(); outcomes(); readiness(); renderSourceList(); renderStockList(); renderDownload(); if (saveError) saveStatus();
  }
  function renderSourceList() {
    const list = root.querySelector('.rb-source-list'); if (!list) return;
    const shown = sources.filter(s => (s.label + ' ' + s.description + ' ' + s.category).toLowerCase().includes(sourceQuery.toLowerCase()));
    list.innerHTML = shown.map(s => btn('source-add', s.label, 'data-source="' + esc(s.id) + '" title="' + esc(s.description) + '"')).join('') || '<p>No source matches. Try another topic.</p>';
  }
  function renderStockList() { const list = root.querySelector('.rb-stock-list'); if (list) list.innerHTML = universe.filter(s => s.toLowerCase().includes(stockQuery.toLowerCase())).map(s => btn('stock-add', s, 'data-symbol="' + esc(s) + '"')).join('') || '<p>No covered symbol matches.</p>'; }
  function dimensions() { return { w: Math.max(1600, ...board.nodes.map(n => n.position.x + 380)), h: Math.max(1000, ...board.nodes.map(n => n.position.y + 300)) }; }
  function summary(n) {
    if (n.kind === 'assumption') return n.data.driver === 'custom' ? n.notes || 'Write the assumption you want to test.' : model.drivers[n.data.driver] + ': ' + (n.data.value === null ? 'Set a value' : n.data.value);
    if (n.kind === 'outcome') { const r = model.evaluate(board, n.id); return r.change === null ? r.status === 'incomplete' ? 'Needs your assumptions' : 'Trace the possible response' : model.percent(r.change) + ' · conditional change'; }
    if (n.kind === 'document') return n.data.filename + ' · ' + Math.ceil(n.data.bytes / 1024) + ' KB';
    if (n.data.card) return n.data.card.facts.length + ' source fields · ' + date(n.data.card.source_as_of);
    if (n.kind === 'evidence') return 'Load dated evidence in the details panel.';
    return n.notes || (n.kind === 'stock' ? 'Select a symbol and load its company evidence.' : 'What evidence would answer this?');
  }
  function edgeMarkup() {
    const { w, h } = dimensions();
    return '<svg class="rb-edges" width="' + w + '" height="' + h + '" aria-label="Research connections"><defs><marker id="rb-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z"/></marker></defs>' + board.edges.map(e => {
      const a = board.nodes.find(n => n.id === e.from), b = board.nodes.find(n => n.id === e.to), x = a.position.x + 260, y = a.position.y + 80, tx = b.position.x, ty = b.position.y + 80;
      const d = 'M' + x + ',' + y + ' C' + (x + 70) + ',' + y + ' ' + (tx - 70) + ',' + ty + ' ' + tx + ',' + ty;
      return '<g data-rb-edge="' + e.id + '" class="' + (selectedEdge === e.id ? 'selected' : '') + '"><path class="rb-edge-hit" d="' + d + '"/><path class="rb-edge-line" data-relation="' + e.relation + '" d="' + d + '" marker-end="url(#rb-arrow)"/><text x="' + ((x + tx) / 2) + '" y="' + ((y + ty) / 2 - 9) + '">' + esc(e.relation) + '</text></g>';
    }).join('') + '</svg>';
  }
  function drawEdges() { const plane = root.querySelector('.rb-plane'); if (plane) { plane.querySelector('.rb-edges')?.remove(); plane.insertAdjacentHTML('afterbegin', edgeMarkup()); } }
  function draw() {
    const plane = root.querySelector('.rb-plane'); if (!plane) return;
    const { w, h } = dimensions(), stage = root.querySelector('.rb-stage'), scroll = root.querySelector('.rb-scroll');
    stage.style.width = w * board.viewport.zoom + 'px'; stage.style.height = h * board.viewport.zoom + 'px';
    plane.style.width = w + 'px'; plane.style.height = h + 'px'; plane.style.transform = 'scale(' + board.viewport.zoom + ')';
    plane.innerHTML = edgeMarkup() + board.nodes.map(n => '<article class="rb-node' + (n.id === selected ? ' selected' : '') + '" data-rb-node="' + n.id + '" data-kind="' + n.kind + '" style="left:' + n.position.x + 'px;top:' + n.position.y + 'px" tabindex="0" aria-label="' + esc(n.title + ', ' + model.label(n.kind)) + '"><button class="rb-port rb-in" data-rb-in="' + n.id + '" aria-label="Connect into ' + esc(n.title) + '" title="Connect into this block">●</button><span class="rb-node-kind">' + esc(model.label(n.kind)) + '</span><h4>' + esc(n.title) + '</h4><p class="rb-node-summary">' + esc(summary(n).slice(0, 500)) + '</p>' + btn('edit-node', 'Edit', 'class="rb-edit-node" data-id="' + n.id + '" aria-label="Edit ' + esc(n.title) + '"') + '<button class="rb-port rb-out' + (pending === n.id ? ' pending' : '') + '" data-rb-out="' + n.id + '" aria-label="Connect from ' + esc(n.title) + '" title="Connect from this block">●</button></article>').join('');
    scroll.scrollLeft = board.viewport.x; scroll.scrollTop = board.viewport.y;
    root.querySelector('.rb-zoom').textContent = Math.round(board.viewport.zoom * 100) + '%';
    root.querySelector('.rb-connection-status').textContent = pending ? 'Choose another block’s left dot to connect. Escape cancels.' : 'Click a card to edit its details. Arrow keys move a focused card.';
  }
  function factDisplay(f) {
    if (typeof f.value !== 'number') return String(f.value);
    const value = f.value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (['decimal_return', 'fraction'].includes(f.unit)) return (f.value * 100).toFixed(2) + '%';
    if (f.unit === 'percent') return value + '%';
    if (f.unit === 'basis_points') return value + ' bps';
    if (f.unit === 'USD_per_GPU_hour') return '$' + value + ' / GPU-hour';
    if (/^[A-Z]{3}$/.test(f.unit)) return new Intl.NumberFormat(undefined, { style: 'currency', currency: f.unit, maximumFractionDigits: 2 }).format(f.value);
    return value;
  }
  function evidenceHtml(card) {
    if (!card) return '<p class="rb-hint">No evidence loaded yet. This block is a placeholder.</p>';
    const alerts = card.warnings.filter(w => /STALE|CARRIED_FORWARD|UNDATED|FUTURE|NO_ISSUER|Reference only/.test(w));
    return alerts.map(w => '<p class="rb-data-alert">' + esc(w) + '</p>').join('') + '<p class="rb-hint">Source: ' + esc(date(card.source_as_of)) + '<br>Captured: ' + esc(date(card.captured_at)) + '</p><div class="rb-facts">' + card.facts.map(f => '<div><span>' + esc(f.path.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('.', ' / ')) + '</span><strong>' + esc(factDisplay(f)) + '</strong><small>' + esc(f.unit === 'source_native_not_normalized' ? 'Source units · review the full page' : f.unit) + '</small></div>').join('') + '</div><details><summary>Source limits and checksum</summary>' + card.warnings.map(w => '<p>' + esc(w) + '</p>').join('') + '<code>' + esc(card.source_sha256) + '</code></details>';
  }
  function inspector() {
    const el = root.querySelector('.rb-inspector'); if (!el) return;
    const n = selectedNode(), edge = board.edges.find(e => e.id === selectedEdge);
    if (edge) { el.innerHTML = '<h4>Edit connection</h4><p>' + esc(board.nodes.find(n => n.id === edge.from).title) + ' → ' + esc(board.nodes.find(n => n.id === edge.to).title) + '</p>' + select('edge-relation', 'How are they related?', [['affects', 'Could affect'], ['supports', 'Supports the reasoning'], ['challenges', 'Challenges the reasoning']], edge.relation) + '<label>Explain the link<textarea data-rb-field="edge-note" maxlength="2000">' + esc(edge.note) + '</textarea></label><p class="rb-hint">A connection records your reasoning. It does not establish causation.</p>' + btn('delete', 'Delete connection'); return; }
    if (!n) { el.innerHTML = '<h4>Your puzzle, one piece at a time</h4><ol><li>Add a stock or a question.</li><li>Add evidence from the site or your own files.</li><li>Connect blocks and explain the link.</li><li>Set assumptions to explore a possible outcome.</li><li>Export for AI review.</li></ol><p>Click any card to edit it. Every example starts with unanswered assumptions.</p>'; return; }
    let html = '<span class="rb-node-kind">' + esc(model.label(n.kind)) + '</span><h4>Block details</h4>' + field('title', 'Title', n.title, 'maxlength="160"');
    if (['stock', 'evidence'].includes(n.kind)) html += field('symbol', n.kind === 'stock' ? 'Stock or ETF symbol' : 'Focus on a symbol (optional)', n.data.symbol, 'maxlength="12" list="rb-symbol-options" placeholder="NVDA"') + '<datalist id="rb-symbol-options">' + (universe || []).map(s => '<option value="' + esc(s) + '">').join('') + '</datalist>';
    if (n.kind === 'evidence') html += sources ? select('source_id', 'Site feature', [['', 'Choose a source'], ...sources.map(s => [s.id, s.label])], n.data.source_id) : '<p class="rb-hint">Source: ' + esc(n.data.source_id || 'Choose from every site feature') + '</p>' + btn('sources', 'Browse sources');
    if (n.kind === 'evidence' && n.data.source_id === 'party-tracker') html += ['president', 'house', 'senate'].map(k => select('control-' + k, ({ president: 'President', house: 'House', senate: 'Senate' })[k], [['any', 'Either party'], ['D', 'Democratic'], ['R', 'Republican']], n.data.controls?.[k] || 'any')).join('') + '<p class="rb-hint">Load evidence to see periods matching all three controls together. Change the Senate filter to compare the alternatives.</p>';
    if (['stock', 'evidence'].includes(n.kind)) html += btn('capture', n.data.card ? 'Refresh this evidence' : 'Load site evidence') + '<p class="rb-hint">Reads the existing site cache on demand. A refresh replaces this board’s excerpt.</p>' + (n.kind === 'evidence' && n.data.source_id ? '<a href="/?tab=' + encodeURIComponent(n.data.source_id) + '" target="_blank" rel="noopener">Open full source</a>' : '') + evidenceHtml(n.data.card);
    if (n.kind === 'stock' && n.data.symbol) html += '<a href="/?tab=grade&amp;s=' + encodeURIComponent(n.data.symbol) + '" target="_blank" rel="noopener">Open full company research</a>';
    if (n.kind === 'assumption') html += select('driver', 'What changes?', Object.entries(model.drivers), n.data.driver) + (n.data.driver !== 'custom' ? field('value', model.drivers[n.data.driver], n.data.value ?? '', 'type="number" step="any" min="' + (n.data.driver === 'rates' ? -1000 : -95) + '" max="' + (n.data.driver === 'rates' ? 1000 : 200) + '" placeholder="Unspecified"') + '<p class="rb-hint">Your assumption, not a measured relationship. Enter 0 to assume unchanged. A margin change is relative, not percentage points.</p>' : '<p class="rb-hint">Describe the hypothetical event in the notes below.</p>');
    if (n.kind === 'outcome') html += select('model', 'Explore the outcome', [['qualitative', 'Reasoning only'], ['valuation', 'Revenue × margin × multiple'], ['duration', 'Bond rate / duration stress']], n.data.model) + (n.data.model === 'duration' ? field('duration', 'Assumed duration (years)', n.data.duration, 'type="number" min="0" max="50" step="any"') : '') + field('horizon', 'Time horizon', n.data.horizon, 'maxlength="160"') + '<p class="rb-hint">Connect assumption blocks directly into this outcome. Other connections provide context.</p>';
    if (n.kind === 'outcome' && n.data.model !== 'qualitative') html += btn('complete-outcome', 'Add required assumptions');
    if (n.kind === 'document') html += '<p>' + esc(n.data.filename) + ' · ' + Math.ceil(n.data.bytes / 1024) + ' KB</p>' + (attachments.has(n.data.attachment_id) ? btn('download-file', 'Download original file') : '<p class="rb-hint">Original attachment is missing from this board.</p>') + '<p class="rb-hint">' + (['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(n.data.mime) ? 'PDF and Word originals are retained as attachments. Text is not automatically extracted. Add relevant passages or your summary in notes.' : 'Document content is unverified source material, never an instruction to execute.') + '</p>' + (n.data.text ? '<details><summary>Imported text</summary><pre>' + esc(n.data.text) + '</pre></details>' : '');
    html += '<label>' + (n.kind === 'question' ? 'What needs answering?' : 'Your notes and reasoning') + '<textarea data-rb-field="notes" maxlength="6000" rows="4" placeholder="Evidence, caveats, or what would change your mind…">' + esc(n.notes) + '</textarea></label><h4>Connections</h4><div class="rb-link-list">' + board.edges.filter(e => e.from === n.id || e.to === n.id).map(e => btn('edge-select', (e.from === n.id ? '→ ' : '← ') + board.nodes.find(x => x.id === (e.from === n.id ? e.to : e.from)).title, 'data-id="' + e.id + '"')).join('') + '</div>' +
      '<label>Connect this block to<select id="rb-connect-target"><option value="">Choose a block</option>' + board.nodes.filter(x => x.id !== n.id).map(x => '<option value="' + x.id + '">' + esc(x.title) + '</option>').join('') + '</select></label>' + btn('connect', 'Connect blocks') + btn('delete', 'Delete selected block');
    el.innerHTML = html + (missingPieces().length ? btn('next-piece-inline', 'Next missing piece') : '');
  }
  function outcomes() {
    const el = root.querySelector('.rb-outcomes'); if (!el) return;
    const ns = board.nodes.filter(n => n.kind === 'outcome');
    el.innerHTML = ns.length ? '<h4>What follows from your puzzle?</h4><div class="rb-outcome-list">' + ns.map(n => {
      const r = model.evaluate(board, n.id), parents = board.edges.filter(e => e.to === n.id).map(e => board.nodes.find(n => n.id === e.from).title);
      return '<article><h4>' + esc(n.title) + '</h4><strong>' + (r.change === null ? 'Unresolved' : esc(model.percent(r.change))) + '</strong><p>' + esc(r.detail) + '</p>' + (r.missing.length ? '<p>Needed: ' + r.missing.map(d => esc(model.drivers[d])).join(', ') + '.</p>' : '') + '<p class="rb-hint">' + esc(n.data.horizon) + ' · ' + (r.change === null ? 'No response inferred' : 'Conditional arithmetic, not a prediction') + '</p><p>Connected context: ' + esc(parents.join(' · ') || 'None yet') + '</p></article>';
    }).join('') + '</div>' : '';
  }
  function missingPieces() {
    return board.nodes.filter(n => n.kind === 'assumption' && n.data.driver !== 'custom' && n.data.value === null)
      .concat(board.nodes.filter(n => ['stock', 'evidence'].includes(n.kind) && !n.data.card?.facts.length));
  }
  function readiness() {
    const el = root.querySelector('.rb-readiness'); if (!el) return;
    if (!board.nodes.length) { el.replaceChildren(); return; }
    const sources = board.nodes.filter(n => ['stock', 'evidence'].includes(n.kind)), needed = missingPieces();
    el.innerHTML = '<span>Evidence loaded: ' + sources.filter(n => n.data.card?.facts.length).length + ' / ' + sources.length + '</span><span>Assumptions to fill: ' + board.nodes.filter(n => n.kind === 'assumption' && n.data.driver !== 'custom' && n.data.value === null).length + '</span><span>Links with notes: ' + board.edges.filter(e => e.note.trim()).length + ' / ' + board.edges.length + '</span>' + (needed.length ? btn('next-piece', 'Go to next missing piece') : '<span>Review the reasoning, then export your puzzle.</span>');
  }
  function add(kind, data = {}, position) {
    if (board.nodes.length >= model.limits.nodes) throw new Error('This board supports up to ' + model.limits.nodes + ' blocks.');
    const scroll = root.querySelector('.rb-scroll'), preferred = position || { x: Math.round((scroll.scrollLeft + 40) / board.viewport.zoom), y: Math.round((scroll.scrollTop + 40) / board.viewport.zoom) };
    const p = model.place(board, preferred);
    edit(() => { const n = model.makeNode(kind, id(), p.x, p.y); Object.assign(n.data, data); if (kind === 'stock' && data.symbol) n.title = data.symbol; if (kind === 'evidence') n.title = sources?.find(s => s.id === data.source_id)?.label || 'Site evidence'; board.nodes.push(n); selected = n.id; selectedEdge = null; });
    revealSelected(); focusSelected();
  }
  function focusSelected() { if (selected) root.querySelector('[data-rb-node="' + selected + '"]')?.focus({ preventScroll: true }); }
  function focusDetails() { const details = root.querySelector('.rb-inspector'); details.tabIndex = -1; details.focus({ preventScroll: true }); if (win.matchMedia('(max-width:1150px)').matches) details.scrollIntoView({ block: 'start' }); }
  function revealSelected() {
    const n = selectedNode(), scroll = root.querySelector('.rb-scroll'); if (!n || !scroll) return;
    const z = board.viewport.zoom, left = n.position.x * z, top = n.position.y * z;
    if (left < scroll.scrollLeft || left + 280 * z > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = Math.max(0, left - 30);
    if (top < scroll.scrollTop || top + 180 * z > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = Math.max(0, top - 30);
    board.viewport.x = scroll.scrollLeft; board.viewport.y = scroll.scrollTop;
  }
  function completeOutcome() {
    const outcome = selectedNode(); if (!outcome || outcome.kind !== 'outcome') return;
    const incoming = board.edges.filter(e => e.to === outcome.id && e.relation === 'affects').map(e => board.nodes.find(n => n.id === e.from));
    const missing = model.requirements(outcome.data.model).filter(driver => !incoming.some(n => n.kind === 'assumption' && n.data.driver === driver));
    if (!missing.length) { notice('The required blocks are connected. Fill any blank values in those assumption blocks.'); return; }
    if (board.nodes.length + missing.length > model.limits.nodes || board.edges.length + missing.length > model.limits.edges) throw new Error('Remove unused blocks or links to make room for the required assumptions.');
    edit(() => { for (const driver of missing) {
      const p = model.place(board, { x: Math.max(20, outcome.position.x - 320), y: outcome.position.y });
      const n = model.makeNode('assumption', id(), p.x, p.y); n.title = model.drivers[driver]; n.data.driver = driver; board.nodes.push(n);
      board.edges.push({ id: id(), from: n.id, to: outcome.id, relation: 'affects', note: 'Explicit owner assumption. Set a value; zero means unchanged.' });
    } });
    focusDetails();
    notice('Required assumptions added and connected. Enter your values to calculate this outcome.');
  }

  function connect(from, to) {
    if (board.edges.length >= model.limits.edges) throw new Error('Connection limit reached.');
    model.canConnect(board, from, to);
    edit(() => { const edge = { id: id(), from, to, relation: 'affects', note: '' }; board.edges.push(edge); selectedEdge = edge.id; selected = null; pending = null; });
    notice('Connected. Explain the link in the details panel.');
  }
  function remove() {
    if (!selected && !selectedEdge) return;
    edit(() => { if (selected) { board.nodes = board.nodes.filter(n => n.id !== selected); board.edges = board.edges.filter(e => e.from !== selected && e.to !== selected); } else board.edges = board.edges.filter(e => e.id !== selectedEdge); selected = null; selectedEdge = null; pending = null; });
    root.querySelector('.rb-scroll').focus({ preventScroll: true }); notice('Selection deleted. Undo restores it.');
  }
  function compactCard(c) { return Object.fromEntries(['id', 'label', 'source_id', 'symbol', 'source_as_of', 'captured_at', 'source_sha256', 'facts', 'warnings', 'url'].filter(k => k in c).map(k => [k, c[k]])); }
  async function capture() {
    const n = selectedNode(); if (!n || !['stock', 'evidence'].includes(n.kind)) return;
    const epoch = generation, nodeId = n.id, source = n.kind === 'stock' ? 'company' : n.data.source_id;
    const selection = JSON.stringify([n.kind, n.data.symbol, n.data.source_id, n.data.controls]);
    if (!source) throw new Error('Choose a site feature first.');
    const token = id(); captureVersions.set(nodeId, token);
    const card = await options.api('source-capture', { source_id: source, ...(n.data.symbol ? { symbol: n.data.symbol } : {}), ...(source === 'party-tracker' ? { controls: n.data.controls || { president: 'any', house: 'any', senate: 'any' } } : {}) });
    if (epoch !== generation || !board.nodes.some(x => x === n) || captureVersions.get(nodeId) !== token) return;
    captureVersions.delete(nodeId);
    if (selection !== JSON.stringify([n.kind, n.data.symbol, n.data.source_id, n.data.controls])) { notice('This block’s source changed while it loaded. Load its current selection again.'); return; }
    remember(); n.data.card = compactCard(card); changed();
    const summaryEl = root.querySelector('[data-rb-node="' + nodeId + '"] .rb-node-summary'); if (summaryEl) summaryEl.textContent = summary(n);
    readiness(); root.querySelector('[data-rb="undo"]').disabled = !history.length; root.querySelector('[data-rb="redo"]').disabled = !future.length;
    if (selected === nodeId && !doc.activeElement?.matches('[data-rb-field]')) { inspector(); focusDetails(); }
    notice('Dated site evidence loaded. Review its fields and source limitations.');
  }
  async function validateProject(value) {
    if (value?.schema !== 'mingstreet.research-project.v1' || Object.keys(value).some(k => !['schema', 'board', 'attachments'].includes(k))) throw new Error('Choose an exported Research Lab board JSON. Other JSON files can be imported as documents.');
    model.validate(value.board);
    if (!Array.isArray(value.attachments) || value.attachments.length > 60) throw new Error('Invalid attachments.');
    const map = new Map(); let bytes = 0;
    for (const a of value.attachments) {
      if (!a || Object.keys(a).some(k => !['id', 'name', 'mime', 'base64', 'sha256'].includes(k)) || !/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(a.id) || map.has(a.id) || typeof a.name !== 'string' || a.name.length > 240 || typeof a.mime !== 'string' || a.mime.length > 100 || typeof a.base64 !== 'string' || a.base64.length > model.limits.file * 1.34) throw new Error('Invalid attachment metadata.');
      const raw = decode(a.base64); bytes += raw.length;
      if (raw.length > model.limits.file || bytes > model.limits.files || await digest(raw) !== a.sha256) throw new Error('Attachment size or checksum mismatch.');
      map.set(a.id, a);
    }
    for (const n of value.board.nodes.filter(n => n.kind === 'document')) {
      const a = map.get(n.data.attachment_id);
      if (!a || a.name !== n.data.filename || a.mime !== n.data.mime || a.sha256 !== n.data.sha256 || decode(a.base64).length !== n.data.bytes) throw new Error('A document is missing its matching original attachment.');
      const expected = ['text/plain', 'text/csv', 'text/markdown', 'application/json'].includes(a.mime) ? new TextDecoder('utf-8', { fatal: true }).decode(decode(a.base64)) : '';
      if (expected !== n.data.text) throw new Error('Document text does not match its original attachment.');
    }
    return map;
  }
  async function importFiles(files) {
    const epoch = generation, version = changeVersion, staged = [];
    let totalBytes = project().attachments.reduce((v, a) => v + decode(a.base64).length, 0);
    for (const file of files) {
      if (file.size > (file.name.toLowerCase().endsWith('.json') ? 24 * 1024 * 1024 : model.limits.file)) throw new Error('Files may be up to 4 MB each; editable boards may be up to 24 MB.');
      const ext = file.name.toLowerCase().split('.').at(-1);
      if (!['pdf', 'docx', 'txt', 'md', 'csv', 'json'].includes(ext)) throw new Error('Use PDF, Word (.docx), CSV, TXT, Markdown or JSON.');
      const raw = new Uint8Array(await file.arrayBuffer());
      if (ext === 'json') {
        const value = JSON.parse(new TextDecoder().decode(raw));
        if (value?.schema === 'mingstreet.research-project.v1') {
          if (files.length !== 1) throw new Error('Open one editable board at a time. Import other documents afterward.');
          const map = await validateProject(value); if (epoch !== generation) return;
          pendingImport = { board: value.board, attachments: map };
          root.querySelector('.rb-import-review').innerHTML = '<div class="rb-import-dialog" role="dialog" aria-modal="true" aria-labelledby="rb-import-title"><div><h4 id="rb-import-title">Open ' + esc(value.board.title) + '?</h4><p>' + value.board.nodes.length + ' blocks · ' + value.board.edges.length + ' links · ' + map.size + ' attachments. Imported observations and narratives are unverified.</p><p>Your current board will be downloaded as a backup before opening this one.</p>' + btn('import-apply', 'Back up & open imported board') + btn('import-cancel', 'Keep current board') + '</div></div>';
          root.querySelector('[data-rb="import-apply"]').focus(); return;
        }
      }
      if (raw.length > model.limits.file) throw new Error('A document may be up to 4 MB.');
      totalBytes += raw.length;
      if (totalBytes > model.limits.files) throw new Error('This board supports up to 8 MB of attached files.');
      if (ext === 'pdf' && new TextDecoder().decode(raw.subarray(0, 5)) !== '%PDF-') throw new Error('This file is not a readable PDF attachment.');
      const isText = ['txt', 'md', 'csv', 'json'].includes(ext), text = isText ? new TextDecoder('utf-8', { fatal: true }).decode(raw) : '';
      if (text.length > model.limits.text) throw new Error('Text files may contain up to 50,000 characters.');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Choose a UTF-8 text document without binary control characters.');
      const hash = await digest(raw), attachment = { id: id(), name: file.name.slice(0, 240), mime: ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', json: 'application/json', md: 'text/markdown', txt: 'text/plain' })[ext], sha256: hash, base64: encode(raw) };
      if (epoch !== generation) return;
      staged.push({ attachment, bytes: raw.length, text });
    }
    if (epoch !== generation) return;
    if (version !== changeVersion) throw new Error('The board changed while these files loaded. Import them again into the current board.');
    if (board.nodes.length + staged.length > model.limits.nodes) throw new Error('Remove unused blocks to make room for these documents.');
    const next = structuredClone(board), scroll = root.querySelector('.rb-scroll');
    for (const file of staged) {
      const p = model.place(next, { x: (scroll.scrollLeft + 40) / board.viewport.zoom, y: (scroll.scrollTop + 40) / board.viewport.zoom }), n = model.makeNode('document', id(), p.x, p.y);
      n.title = file.attachment.name.slice(0, 160); Object.assign(n.data, { attachment_id: file.attachment.id, filename: file.attachment.name, mime: file.attachment.mime, bytes: file.bytes, sha256: file.attachment.sha256, text: file.text }); next.nodes.push(n);
    }
    model.validate(next);
    edit(() => { board = next; for (const file of staged) attachments.set(file.attachment.id, file.attachment); selected = board.nodes.at(-1)?.id; selectedEdge = null; }); revealSelected(); focusSelected();
    notice('Files added as document blocks. Originals are included in JSON backups and AI review ZIPs. PDF and Word text is not automatically extracted.');
  }
  function download(bytes, name, mime) {
    const url = win.URL.createObjectURL(new Blob([bytes], { type: mime })), a = doc.createElement('a');
    downloadUrls.push(url); if (downloadUrls.length > 3) win.URL.revokeObjectURL(downloadUrls.shift());
    lastDownload = { url, name }; renderDownload(); a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove();
  }
  function renderDownload() { const el = root.querySelector('.rb-download'); if (el) el.innerHTML = lastDownload ? 'Latest file: <a href="' + esc(lastDownload.url) + '" download="' + esc(lastDownload.name) + '">' + esc(lastDownload.name) + '</a>. Use this link if your browser did not save it.' : ''; }
  function zip(files) {
    // STORE-only ZIP, UTF-8 names. No remote code or compression service.
    const parts = [], central = []; let offset = 0;
    const u16 = (v, at, x) => v.setUint16(at, x, true), u32 = (v, at, x) => v.setUint32(at, x >>> 0, true);
    for (const [path, content] of Object.entries(files)) {
      const name = new TextEncoder().encode(path), bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      let crc = 0xffffffff; for (const b of bytes) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer); u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x800); u16(h, 12, 33); u32(h, 14, crc); u32(h, 18, bytes.length); u32(h, 22, bytes.length); u16(h, 26, name.length); header.set(name, 30); parts.push(header, bytes);
      const entry = new Uint8Array(46 + name.length), c = new DataView(entry.buffer); u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x800); u16(c, 14, 33); u32(c, 16, crc); u32(c, 20, bytes.length); u32(c, 24, bytes.length); u16(c, 28, name.length); u32(c, 42, offset); entry.set(name, 46); central.push(entry); offset += header.length + bytes.length;
    }
    const size = central.reduce((s, b) => s + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer); u32(e, 0, 0x06054b50); u16(e, 8, central.length); u16(e, 10, central.length); u32(e, 12, size); u32(e, 16, offset);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  function report() {
    const x = Math.max(0, Math.min(...board.nodes.map(n => n.position.x), 40) - 25), y = Math.max(0, Math.min(...board.nodes.map(n => n.position.y), 40) - 25);
    const w = Math.max(400, ...board.nodes.map(n => n.position.x + 300)) - x, h = Math.max(230, ...board.nodes.map(n => n.position.y + 190)) - y;
    const graph = '<svg viewBox="' + x + ' ' + y + ' ' + w + ' ' + h + '" role="img" aria-label="Research puzzle"><defs><marker id="report-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#86744e"/></marker></defs>' + board.edges.map(e => {
      const a = board.nodes.find(n => n.id === e.from), b = board.nodes.find(n => n.id === e.to), sx = a.position.x + 260, sy = a.position.y + 80, tx = b.position.x, ty = b.position.y + 80;
      return '<path d="M' + sx + ',' + sy + ' C' + (sx + 70) + ',' + sy + ' ' + (tx - 70) + ',' + ty + ' ' + tx + ',' + ty + '" stroke="#9a865e" stroke-width="2" fill="none" marker-end="url(#report-arrow)"/><text x="' + ((sx + tx) / 2) + '" y="' + ((sy + ty) / 2 - 9) + '" font-size="12" fill="#665c48">' + esc(e.relation) + '</text>';
    }).join('') + board.nodes.map(n => '<g transform="translate(' + n.position.x + ' ' + n.position.y + ')"><title>' + esc(n.title) + '</title><rect width="260" height="160" rx="8" fill="#faf8f3" stroke="#86744e"/><text x="12" y="26" font-size="12" fill="#665c48">' + esc(model.label(n.kind)) + '</text>' + (n.title.match(/.{1,32}/gu) || ['']).map((line, i) => '<text x="12" y="' + (52 + i * 16) + '" font-size="13" fill="#29251d">' + esc(line) + '</text>').join('') + '<text x="12" y="145" font-size="10" fill="#665c48">' + esc(n.id) + '</text></g>').join('') + '</svg>';
    const prose = model.markdown(board).split('\n').slice(2).map(line => line.startsWith('### ') ? '<h3>' + esc(line.slice(4)) + '</h3>' : line.startsWith('## ') ? '<h2>' + esc(line.slice(3)) + '</h2>' : line.startsWith('> ') ? '<blockquote>' + esc(line.slice(2)) + '</blockquote>' : line ? '<p>' + esc(line) + '</p>' : '').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(board.title) + '</title><style>body{font:14px/1.6 system-ui;color:#29251d;background:white;max-width:1000px;margin:32px auto;padding:0 24px}h1{font-size:26px}h2{font-size:20px;margin-top:26px}h3{font-size:16px;margin-top:20px}h2,h3{break-after:avoid}blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;padding:3px 12px;border-left:2px solid #b7ad99;background:#faf8f3}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}svg{width:100%;max-height:600px}@media print{body{margin:0;padding:0;font-size:11px}svg{max-height:65vh;break-after:page}}@page{size:A4;margin:16mm}</style></head><body><h1>' + esc(board.title) + '</h1>' + graph + prose + '</body></html>';
  }
  async function exportBoard(format) {
    model.validate(board); const epoch = generation, owner = options.identity(); const name = board.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'research-puzzle';
    if (format === 'pdf') { const popup = win.open('', '_blank'); if (!popup) throw new Error('Allow the print window, or export the HTML report and print it.'); popup.opener = null; popup.document.open(); popup.document.write(report()); popup.document.close(); await popup.document.fonts.ready; popup.focus(); popup.print(); return; }
    if (format === 'json') download(JSON.stringify(project(), null, 2), name + '.json', 'application/json');
    if (format === 'md') download(model.markdown(board), name + '.md', 'text/markdown');
    if (format === 'html') download(report(), name + '.html', 'text/html');
    if (format === 'csv') {
      const cell = s => '"' + (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(String(s)) ? "'" : '') + String(s ?? '').replaceAll('"', '""') + '"';
      const rows = [['record', 'id', 'kind', 'title', 'notes', 'from', 'to', 'relation', 'explanation', 'data'], ...board.nodes.map(n => ['block', n.id, n.kind, n.title, n.notes, '', '', '', '', JSON.stringify(n.data)]), ...board.edges.map(e => ['connection', e.id, '', '', '', e.from, e.to, e.relation, e.note, ''])];
      download('\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n'), name + '.csv', 'text/csv');
    }
    if (format === 'zip') {
      const p = project(), files = { 'README_FOR_AI.md': model.markdown(board), 'board.json': JSON.stringify(p, null, 2), 'report.html': report() };
      for (const a of p.attachments) files['attachments/' + a.id + '-' + a.name.replace(/[^a-zA-Z0-9._-]/g, '_')] = decode(a.base64);
      files['checksums.sha256'] = (await Promise.all(Object.entries(files).map(async ([name, data]) => await digest(typeof data === 'string' ? new TextEncoder().encode(data) : data) + '  ' + name))).join('\n');
      if (epoch !== generation || !options.allowed() || owner !== options.identity()) return;
      download(zip(files), name + '.zip', 'application/zip');
    }
    notice('File prepared. The ZIP includes original attachments; PDF/HTML, Markdown and CSV contain the written brief. The download link remains available if your browser did not save it.');
  }
  async function action(name, el) {
    if (name.startsWith('add-')) add(name.slice(4));
    if (name.startsWith('template-')) { if (board.nodes.length) download(JSON.stringify(project(), null, 2), 'research-board-backup.json', 'application/json'); edit(() => { board = model.template(name.slice(9)); selected = null; selectedEdge = null; pending = null; }); notice('Starting map opened. Fill in your assumptions and load the evidence you need.'); }
    if (name === 'recover-draft') download(JSON.stringify(damagedDraft, null, 2), 'research-board-recovery.json', 'application/json');
    if (name === 'replace-draft') { const original = damagedDraft; damagedDraft = null; try { await persist(); } catch (error) { damagedDraft = original; throw error; } render(); notice('Current board saved in this browser.'); }
    if (name === 'save') { await persist(); notice('Board and attachments saved in this browser for your signed-in account. Export JSON for a portable backup.'); }
    if (name === 'undo' && history.length) { future.push(structuredClone(board)); board = history.pop(); selected = null; selectedEdge = null; pending = null; changed(); render(); }
    if (name === 'redo' && future.length) { history.push(structuredClone(board)); board = future.pop(); selected = null; selectedEdge = null; pending = null; changed(); render(); }
    if (name === 'universe') { universe = (await options.api('universe')).symbols; render(); root.querySelector('.rb-stock-shelf').open = true; }
    if (name === 'sources') { sources = (await options.api('sources')).sources; render(); root.querySelector('.rb-source-shelf').open = true; }
    if (name === 'source-add') add('evidence', { source_id: el.dataset.source });
    if (name === 'stock-add') add('stock', { symbol: el.dataset.symbol });
    if (name === 'capture') await capture();
    if (name === 'delete') remove();
    if (name === 'complete-outcome') completeOutcome();
    if (name === 'next-piece' || name === 'next-piece-inline' || name === 'edit-node') { const next = name === 'edit-node' ? board.nodes.find(n => n.id === el.dataset.id) : missingPieces()[0]; if (next) { selected = next.id; selectedEdge = null; draw(); inspector(); revealSelected(); focusDetails(); } }
    if (name === 'expand') { expanded = !expanded; root.classList.toggle('rb-expanded', expanded); const button = root.querySelector('[data-rb="expand"]'); button.textContent = expanded ? 'Close expanded view' : 'Expand canvas'; button.setAttribute('aria-pressed', String(expanded)); }
    if (name === 'connect') connect(selected, root.querySelector('#rb-connect-target').value);
    if (name === 'edge-select') { selectedEdge = el.dataset.id; selected = null; draw(); inspector(); }
    if (name === 'zoom-in' || name === 'zoom-out' || name === 'fit') {
      const scroll = root.querySelector('.rb-scroll'), width = scroll.clientWidth, height = scroll.clientHeight, old = board.viewport.zoom;
      if (name === 'fit') { const maxX = Math.max(500, ...board.nodes.map(n => n.position.x + 300)), maxY = Math.max(300, ...board.nodes.map(n => n.position.y + 210)); board.viewport = { x: 0, y: 0, zoom: Math.max(.3, Math.min(1, width / maxX, height / maxY)) }; }
      else { const next = Math.max(.3, Math.min(2, old + (name === 'zoom-in' ? .1 : -.1))); board.viewport = { x: Math.max(0, (scroll.scrollLeft + width / 2) * next / old - width / 2), y: Math.max(0, (scroll.scrollTop + height / 2) * next / old - height / 2), zoom: next }; }
      changed(); draw();
    }
    if (name === 'import') root.querySelector('#rb-files').click();
    if (name === 'import-cancel') { pendingImport = null; root.querySelector('.rb-import-review').replaceChildren(); root.querySelector('[data-rb="import"]').focus(); }
    if (name === 'import-apply' && pendingImport) {
      for (const [key, a] of [...pendingImport.attachments]) { const prior = attachments.get(key); if (prior && JSON.stringify(prior) !== JSON.stringify(a)) { const next = id(); pendingImport.attachments.delete(key); pendingImport.attachments.set(next, { ...a, id: next }); for (const n of pendingImport.board.nodes) if (n.kind === 'document' && n.data.attachment_id === key) n.data.attachment_id = next; } }
 download(JSON.stringify(project(), null, 2), 'research-board-backup.json', 'application/json'); remember(); board = pendingImport.board; for (const [id, a] of pendingImport.attachments) attachments.set(id, a); pendingImport = null; selected = null; selectedEdge = null; pending = null; changed(); render(); notice('Imported board opened. Review source provenance before relying on imported observations.'); }
    if (name === 'export') await exportBoard(root.querySelector('#rb-export-format').value);
    if (name === 'download-file') { const a = attachments.get(selectedNode().data.attachment_id); if (a) download(decode(a.base64), a.name, a.mime); }
  }
  function commitField(element, final) {
    const key = element.dataset.rbField, n = selectedNode(), edge = board.edges.find(x => x.id === selectedEdge), before = structuredClone(board);
    try {
      if (key === 'board-title') board.title = element.value;
      else if (key === 'board-question') board.question = element.value;
      else if (key === 'edge-relation') edge.relation = element.value;
      else if (key === 'edge-note') edge.note = element.value;
      else if (['title', 'notes'].includes(key)) n[key] = element.value;
      else if (key.startsWith('control-')) { n.data.controls = { president: 'any', house: 'any', senate: 'any', ...n.data.controls, [key.slice(8)]: element.value }; n.data.card = null; }
      else if (n) { n.data[key] = ['value', 'duration'].includes(key) ? element.value.trim() === '' ? null : Number(element.value) : key === 'symbol' ? element.value.toUpperCase().trim() : element.value; if (['symbol', 'source_id'].includes(key)) n.data.card = null; if (key === 'source_id' && n.data.source_id !== 'party-tracker') delete n.data.controls; }
      model.validate(board);
      if (JSON.stringify(before) !== JSON.stringify(board)) {
        if (!editingField || editingField.element !== element || !editingField.remembered) {
          history.push(before); if (history.length > 30) history.shift(); future = []; editingField = { element, remembered: true };
        }
        changed(); draw(); outcomes(); readiness();
      }
      if (final && ['driver', 'model', 'symbol', 'source_id'].includes(key)) inspector();
    } catch (error) { board = before; if (final) { render(); throw error; } }
  }
  function bind() {
    root.addEventListener('click', e => safe(async () => {
      if (suppressClick) { suppressClick = false; return; }
      const actionEl = e.target.closest('[data-rb]'); if (actionEl && !actionEl.disabled) { actionEl.disabled = true; try { await action(actionEl.dataset.rb, actionEl); } finally { if (actionEl.isConnected) actionEl.disabled = false; } return; }
      const out = e.target.closest('[data-rb-out]'); if (out) { pending = out.dataset.rbOut; draw(); notice('Choose a left dot to connect these blocks. Escape cancels.'); return; }
      const into = e.target.closest('[data-rb-in]'); if (into) { if (!pending) throw new Error('Choose a block’s right dot first.'); connect(pending, into.dataset.rbIn); return; }
      const edge = e.target.closest('[data-rb-edge]'); if (edge) { selectedEdge = edge.dataset.rbEdge; selected = null; draw(); inspector(); return; }
      const n = e.target.closest('[data-rb-node]'); if (n) { selected = n.dataset.rbNode; selectedEdge = null; draw(); inspector(); root.querySelector('[data-rb-node="' + selected + '"]').focus({ preventScroll: true }); }
    }));
    root.addEventListener('change', e => safe(async () => {
      if (e.target.id === 'rb-files') { await importFiles([...e.target.files]); e.target.value = ''; return; }
      if (e.target.dataset.rbField) commitField(e.target, true);
    }));
    root.addEventListener('focusin', e => { if (e.target.dataset.rbField) editingField = { element: e.target, remembered: false }; });
    root.addEventListener('input', e => {
      if (e.target.id === 'rb-source-search') { sourceQuery = e.target.value; renderSourceList(); }
      if (e.target.id === 'rb-stock-search') { stockQuery = e.target.value; renderStockList(); }
      if (e.target.dataset.rbField && !e.target.matches('select')) safe(() => commitField(e.target, false));
    });
    root.addEventListener('scroll', e => { if (e.target.matches('.rb-scroll')) { board.viewport.x = e.target.scrollLeft; board.viewport.y = e.target.scrollTop; changed(); } }, true);
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && gestureCancel) { gestureCancel(); return; }
      if (e.key === 'Escape') { pending = null; if (expanded) { expanded = false; root.classList.remove('rb-expanded'); const button = root.querySelector('[data-rb="expand"]'); button.textContent = 'Expand canvas'; button.setAttribute('aria-pressed', 'false'); button.focus(); } if (pendingImport) { pendingImport = null; root.querySelector('.rb-import-review').replaceChildren(); root.querySelector('[data-rb="import"]').focus(); } draw(); return; }
      if (pendingImport) { if (e.key === 'Tab') { const buttons = [...root.querySelectorAll('.rb-import-dialog button')]; if (e.shiftKey && e.target === buttons[0]) { e.preventDefault(); buttons.at(-1).focus(); } else if (!e.shiftKey && e.target === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); } } return; }
      if (e.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (['Delete', 'Backspace'].includes(e.key)) { const focused = e.target.closest('[data-rb-node]'); if (focused) { selected = focused.dataset.rbNode; selectedEdge = null; } if (selected || selectedEdge) { e.preventDefault(); remove(); } }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); safe(() => action(e.shiftKey ? 'redo' : 'undo')); }
      const n = e.target.closest('[data-rb-node]');
      if (n && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); selected = n.dataset.rbNode; selectedEdge = null; const delta = e.shiftKey ? 50 : 10; edit(() => { const n = selectedNode(); n.position.x = Math.max(0, Math.min(6000, n.position.x + (e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0))); n.position.y = Math.max(0, Math.min(6000, n.position.y + (e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0))); }); root.querySelector('[data-rb-node="' + selected + '"]').focus({ preventScroll: true }); }
    });
    root.addEventListener('dragstart', e => { const k = e.target.closest('[data-rb-kind]'); if (k) e.dataTransfer.setData('application/x-research-block', k.dataset.rbKind); });
    root.addEventListener('dragover', e => { if (e.target.closest('.rb-scroll')) e.preventDefault(); });
    root.addEventListener('drop', e => safe(async () => { const scroll = e.target.closest('.rb-scroll'); if (!scroll) return; e.preventDefault(); if (e.dataTransfer.files.length) return importFiles([...e.dataTransfer.files]); const kind = e.dataTransfer.getData('application/x-research-block'), r = scroll.getBoundingClientRect(); if (model.kinds.includes(kind)) add(kind, {}, { x: Math.max(0, (e.clientX - r.left + scroll.scrollLeft) / board.viewport.zoom), y: Math.max(0, (e.clientY - r.top + scroll.scrollTop) / board.viewport.zoom) }); }));
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0 || pendingImport) return;
      const scroll = e.target.closest('.rb-scroll'); if (!scroll) return;
      const out = e.target.closest('[data-rb-out]'), nodeEl = e.target.closest('[data-rb-node]');
      if (!out && e.target.closest('button,a,input,select,textarea,[data-rb-edge]')) return;
      gestureCleanup?.();
      const start = { x: e.clientX, y: e.clientY, sx: scroll.scrollLeft, sy: scroll.scrollTop }, n = nodeEl && board.nodes.find(n => n.id === nodeEl.dataset.rbNode), old = n && { ...n.position };
      let moved = false; const before = structuredClone(board), pointerId = e.pointerId, origin = e.target;
      if (n && !out) { doc.activeElement?.blur(); if (!nodeEl.isConnected) return; selected = n.id; selectedEdge = null; root.querySelectorAll('.rb-node').forEach(el => el.classList.toggle('selected', el === nodeEl)); nodeEl.focus({ preventScroll: true }); inspector(); }
      if (!out) scroll.setPointerCapture(pointerId);
      const move = ev => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y; if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true; e.preventDefault(); scroll.classList.add('is-dragging');
        if (out) { pending = out.dataset.rbOut; return; }
        if (n) { n.position.x = Math.max(0, Math.min(6000, old.x + dx / board.viewport.zoom)); n.position.y = Math.max(0, Math.min(6000, old.y + dy / board.viewport.zoom)); nodeEl.style.left = n.position.x + 'px'; nodeEl.style.top = n.position.y + 'px'; drawEdges(); }
        else { scroll.scrollLeft = Math.max(0, start.sx - dx); scroll.scrollTop = Math.max(0, start.sy - dy); board.viewport.x = scroll.scrollLeft; board.viewport.y = scroll.scrollTop; }
      };
      const cleanup = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', cancel); if (scroll.hasPointerCapture(pointerId)) scroll.releasePointerCapture(pointerId); scroll.classList.remove('is-dragging'); gestureCleanup = null; gestureCancel = null; };
      const up = ev => { if (ev.pointerId !== pointerId) return; cleanup(); if (moved) { suppressClick = true; win.setTimeout(() => { suppressClick = false; }, 0); if (out) { const target = doc.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-rb-in]'); if (target && root.contains(target)) safe(() => connect(out.dataset.rbOut, target.dataset.rbIn)); else { pending = null; draw(); notice('Drop on another block’s left dot, or click the two dots.'); } } else { if (n) { history.push(before); if (history.length > 30) history.shift(); future = []; } changed(); draw(); if (n) root.querySelector('[data-rb-node="' + n.id + '"]').focus({ preventScroll: true }); } } else if (!n && !out && origin.closest('.rb-scroll')) { selected = null; selectedEdge = null; draw(); inspector(); } };
      const cancel = ev => { if (ev.pointerId !== pointerId) return; cleanup(); board = before; pending = null; changed(); draw(); inspector(); };
      gestureCleanup = cleanup; gestureCancel = () => cancel({ pointerId }); win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', cancel);
    });
  }
  async function load() {
    const epoch = ++generation, owner = options.identity(); let value;
    try {
      const db = await database();
      try { value = await new Promise((resolve, reject) => { const tx = db.transaction('drafts'), r = tx.objectStore('drafts').get(owner); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); } finally { db.close(); }
      if (value) { const map = await validateProject(value); if (epoch !== generation || owner !== options.identity()) return; board = value.board; attachments = map; saved = true; }
    } catch (e) { if (epoch === generation) { damagedDraft = value || null; saveError = true; notice('Could not restore a local board: ' + e.message, true); } }
    if (epoch !== generation || !options.allowed() || owner !== options.identity()) return;
    render(); if (!root.dataset.boardBound) { bind(); root.dataset.boardBound = '1'; }
  }
  function reset() { generation++; gestureCleanup?.(); downloadUrls.forEach(url => win.URL.revokeObjectURL(url)); downloadUrls = []; lastDownload = null; captureVersions.clear(); win.clearTimeout(timer); board = model.empty(); attachments = new Map(); history = []; future = []; selected = null; selectedEdge = null; pending = null; pendingImport = null; sources = null; universe = null; sourceQuery = ''; stockQuery = ''; saved = false; saveError = false; damagedDraft = null; expanded = false; editingField = null; root.classList.remove('rb-expanded'); root.replaceChildren(); }
  return { load, reset };
}

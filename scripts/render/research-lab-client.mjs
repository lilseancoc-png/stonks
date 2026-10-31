// Serialized into the existing buildless app; no external libraries or AI SDKs.
export function researchLabClient(win, doc, options, contracts) {
  const root = doc.getElementById('research-lab-root');
  let mounted = false, view = 'workspace', graph = contracts.template(), plan = null, snapshot = null,
    experimentId = null, revision = 0, latestRevision = 0, familyId = null, dirty = true, selected = 'shock', pendingPort = null,
    history = [], future = [], currentRun = null, journalData = null, compiled = null, processing = false,
    selectedRuns = [], importInput = null, importPreview = null, libraryQuery = '', journalQuery = '', journalFilter = 'all';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = value => value == null ? 'Unavailable' : (value * 100).toFixed(2) + '%';
  const num = value => value == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const short = value => value ? value.slice(0, 12) + '…' : 'Not saved';
  const button = (action, label, extra = '') => '<button type="button" data-rl="' + action + '" ' + extra + '>' + esc(label) + '</button>';
  const warning = text => '<div class="rl-warning">' + esc(text) + '</div>';
  function message(text, error = false) { const el = root.querySelector('#rl-message'); if (el) { el.textContent = text; el.classList.toggle('error', error); } }
  async function api(action, body, params = {}) {
    if (!options.allowed()) throw new Error('Owner Research Lab session required');
    const identity = options.identity();
    const query = new URLSearchParams({ lab: action, ...params });
    const res = await win.fetch('/api/auth/me?' + query, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if ([401, 403, 404].includes(res.status) && /session|unavailable for/.test(data.error || '')) reset();
      throw new Error((data.code ? data.code + ': ' : '') + (data.error || 'Research request failed'));
    }
    if (!options.allowed() || options.identity() !== identity) throw new Error('Research session changed. Reopen the workspace.');
    return action === 'export' ? res : res.json();
  }
  function changed() { dirty = true; compiled = null; }
  function editGraph(fn) { if (root.querySelector('#rl-name')) syncForm(); history.push(JSON.stringify(graph)); if (history.length > 50) history.shift(); future = []; fn(); changed(); renderWorkspace(); }
  function changeTemplate(kind) {
    editGraph(() => {
      const cfg = graph.research_config; graph = contracts.template(kind);
      graph.research_config = { ...graph.research_config, snapshot_id: cfg.snapshot_id, as_of: cfg.as_of, random_seed: cfg.random_seed };
      experimentId = null; revision = 0; familyId = null; selected = graph.nodes[1]?.id;
    });
  }
  function defaultPlan(summary) {
    const symbols = Object.keys(summary.assets), universe = symbols.filter(s => s !== 'SPY');
    return { schema: 'mingstreet.evaluation-plan.v2', target: 'benchmark_relative_return', universe: universe.length ? universe : symbols,
      discovery: summary.suggested_windows.discovery, holdout: summary.suggested_windows.holdout, horizon_sessions: 10, embargo_sessions: 11,
      benchmark: symbols.includes('SPY') ? 'SPY' : symbols.at(-1), costs: { commission_bps: 0, slippage_bps: 5 }, max_trials: 20,
      min_events: 10, bootstrap_samples: 300, execution: 'next_open', primary_metric: 'mean_excess_return' };
  }
  function shell() {
    root.innerHTML = '<div class="rl"><header class="rl-head"><div><div class="rl-eyebrow">Mingstreet / private research</div><h2>Research Lab</h2><p>Build a question. Freeze the evidence. Test what survives.<br>Export a research bundle to ChatGPT or Claude, then review its interpretation here.</p></div><span class="rl-badge">Owner only · no AI API calls</span></header>' +
      '<div class="rl-toolbar">' + button('save', 'Save revision') + button('compile', 'Check experiment') + button('run', 'Run discovery') + button('final', 'Run final evaluation') + '</div>' +
      '<div id="rl-message" class="rl-message" role="status" aria-live="polite"></div><div class="rl-tabs" role="tablist" aria-label="Research Lab views">' +
      ['workspace', 'results', 'journal', 'exchange', 'operations'].map(v => '<button type="button" role="tab" id="rl-tab-' + v + '" aria-controls="rl-' + v + '" data-view="' + v + '" aria-selected="' + (view === v) + '">' + ({ workspace: 'Workspace', results: 'Results', journal: 'Journal', exchange: 'Offsite research', operations: 'Operations' }[v]) + '</button>').join('') + '</div>' +
      ['workspace', 'results', 'journal', 'exchange', 'operations'].map(v => '<div role="tabpanel" id="rl-' + v + '" aria-labelledby="rl-tab-' + v + '"' + (view === v ? '' : ' hidden') + '></div>').join('') + '</div>';
    renderWorkspace(); renderResults(); renderJournal(); renderExchange(); renderOperations();
  }
  function setView(next) {
    view = next;
    root.querySelectorAll('[data-view]').forEach(el => el.setAttribute('aria-selected', String(el.dataset.view === next)));
    for (const v of ['workspace', 'results', 'journal', 'exchange', 'operations']) root.querySelector('#rl-' + v).hidden = v !== next;
  }
  const input = (id, label, value, type = 'text', extra = '') => '<label>' + esc(label) + '<input id="' + id + '" type="' + type + '" value="' + esc(value) + '" ' + extra + '></label>';
  function renderWorkspace() {
    const panel = root.querySelector('#rl-workspace'); if (!panel) return;
    const connectionsOpen = panel.querySelector('.rl-keyboard-links')?.open;
    const hypothesis = panel.querySelector('#rl-hypothesis')?.value || graph.name;
    const symbols = panel.querySelector('#rl-symbols')?.value || (snapshot ? Object.keys(snapshot.assets).join(', ') : 'AAPL, MSFT, NVDA, SPY');
    panel.innerHTML = '<section class="rl-panel"><div class="rl-fields">' + input('rl-name', 'Experiment title', graph.name) +
      '<label>Template<select id="rl-template"><option value="">Choose a starting point</option>' +
      [['breadth', 'Oversold + breadth'], ['forward', 'Forward-return study'], ['conditional', 'Conditional signal test'], ['stress', 'Price-target stress test'], ['reverse', 'Reverse valuation'], ['sensitivity', 'Sensitivity grid'], ['monte_carlo', 'Conditional paths'], ['strategy', 'Exploratory equity strategy'], ['factor', 'Factor-neutral strategy · needs data'], ['earnings', 'Earnings peer spillover · needs data']].map(([k, v]) => '<option value="' + k + '">' + esc(v) + '</option>').join('') + '</select></label>' +
      '<label class="rl-wide">Hypothesis<textarea id="rl-hypothesis" maxlength="4000">' + esc(hypothesis) + '</textarea></label></div><p class="rl-muted" id="rl-revision">' +
      (experimentId ? esc(experimentId) + ' · revision ' + revision + (dirty ? ' · unsaved changes' : ' · frozen revision') : 'New experiment · save to register the graph and evaluation plan') + '</p></section>' +
      '<section class="rl-panel"><h3>1. Freeze the inputs</h3><div class="rl-fields">' + input('rl-symbols', 'Symbols, including benchmark', symbols) +
      '<div class="rl-inline">' + button('capture', 'Capture existing cache') + '</div>' + input('rl-asof', 'As-of cutoff · UTC', graph.research_config.as_of) +
      input('rl-seed', 'Deterministic seed', graph.research_config.random_seed, 'number', 'min="1" max="2147483647"') + '</div>' +
      (snapshot ? '<p class="rl-muted">Snapshot ' + esc(short(snapshot.id)) + ' · ' + esc(snapshot.history_class) + '</p><div class="rl-table-wrap"><table><thead><tr><th>Asset</th><th>First session</th><th>Last session</th><th>Rows</th></tr></thead><tbody>' +
        Object.entries(snapshot.assets).map(([s, a]) => '<tr><td>' + esc(s) + '</td><td>' + esc(a.first) + '</td><td>' + esc(a.last) + '</td><td>' + a.rows + '</td></tr>').join('') + '</tbody></table></div>' + snapshot.warnings.map(warning).join('') : '<p class="rl-muted">Uses data the site already stores. No AI or data-provider request. Missing history stays missing.</p>') + '</section>' +
      '<section class="rl-panel"><h3>2. Register the evaluation plan</h3>' + (plan ? planForm() : '<p class="rl-muted">Capture inputs to choose discovery and untouched final windows.</p>') + '</section>' +
      '<h3>3. Compose the experiment</h3><div class="rl-workbench"><aside class="rl-library" aria-label="Block library"><h3>Block library</h3>' + input('rl-library-search', 'Search blocks', libraryQuery) + '<div class="rl-library-list"></div></aside>' +
      '<div class="rl-canvas-shell"><div class="rl-canvas-tools">' + button('undo', 'Undo', history.length ? '' : 'disabled') + button('redo', 'Redo', future.length ? '' : 'disabled') + button('zoom-out', '−', 'aria-label="Zoom out"') + button('zoom-in', '+', 'aria-label="Zoom in"') + button('fit', 'Fit') + '<span id="rl-zoom-label" class="rl-muted">' + Math.round(graph.viewport.zoom * 100) + '%</span></div>' +
      '<div class="rl-scroll" tabindex="0" aria-label="Zoomable research canvas"><div class="rl-plane"></div></div><svg class="rl-minimap" viewBox="0 0 1600 800" aria-label="Graph minimap"></svg></div>' +
      '<aside class="rl-inspector" aria-label="Block properties"></aside></div>' +
      '<details class="rl-panel rl-keyboard-links"' + (connectionsOpen ? ' open' : '') + '><summary>Keyboard connections and graph links</summary><p class="rl-muted">Choose named output and input ports, then connect. Arrow keys move a focused node. Select a connection below to remove it.</p><div class="rl-fields"><label>Output port<select id="rl-connect-from"></select></label><label>Input port<select id="rl-connect-to"></select></label><div class="rl-inline">' + button('connect', 'Connect ports') + '</div></div><div class="rl-connections"></div></details>' +
      '<section class="rl-panel"><h3>4. Check, save and run</h3><p class="rl-muted">Discovery uses only its registered window. Final evaluation records holdout exposure, including failed or canceled attempts. Further tuning of the same final period compromises independence.</p>' +
      '<label class="rl-check"><input id="rl-final-ack" type="checkbox">I understand that final evaluation permanently records holdout access.</label><div id="rl-compile"></div></section>';
    renderLibrary(); renderCanvas(); renderInspector(); renderConnections(); renderCompile();
  }
  function planForm() {
    return '<div class="rl-fields">' + input('rl-universe', 'Evaluation universe', plan.universe.join(', ')) + input('rl-benchmark', 'Benchmark', plan.benchmark) +
      input('rl-disc-start', 'Discovery starts', plan.discovery[0], 'date') + input('rl-disc-end', 'Discovery ends', plan.discovery[1], 'date') +
      input('rl-hold-start', 'Final window starts', plan.holdout[0], 'date') + input('rl-hold-end', 'Final window ends', plan.holdout[1], 'date') +
      input('rl-horizon', 'Outcome horizon · sessions', plan.horizon_sessions, 'number', 'min="1" max="60"') + input('rl-embargo', 'Embargo · sessions', plan.embargo_sessions, 'number', 'min="2" max="120"') +
      input('rl-commission', 'Commission · bps per side', plan.costs.commission_bps, 'number', 'min="0" max="500" step="0.1"') + input('rl-slippage', 'Slippage · bps per side', plan.costs.slippage_bps, 'number', 'min="0" max="500" step="0.1"') +
      input('rl-trials', 'Trial budget · all attempts', plan.max_trials, 'number', 'min="1" max="100"') + input('rl-min-events', 'Minimum events', plan.min_events, 'number', 'min="5" max="500"') +
      '<label>Experiment family<select id="rl-mode">' + [['descriptive', 'Historical association'], ['conditional', 'Conditional scenario'], ['strategy', 'Modeled equity strategy'], ['forecast', 'Probability forecast · requires calibration']].map(([v, label]) => '<option value="' + v + '"' + (graph.research_config.mode === v ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div><p class="rl-muted">Target: next-open benchmark-relative return. Fixed spec time slices purge labels at boundaries. No sector/factor neutrality or causal claim.</p>';
  }
  function renderLibrary() {
    const list = root.querySelector('.rl-library-list'); if (!list) return;
    list.innerHTML = contracts.blocks.filter(b => (b.label + b.category + b.key).toLowerCase().includes(libraryQuery.toLowerCase())).map(b =>
      '<button type="button" draggable="' + b.ready + '" data-add="' + b.key + '" data-category="' + b.category + '"' + (b.ready ? '' : ' disabled') + ' title="' + esc(b.description || b.reason || b.key) + '">' + esc(b.label) + '<small>' + esc(b.ready ? b.category : b.reason) + '</small></button>').join('');
  }
  const definition = node => contracts.blocks.find(b => b.key === node.type);
  function renderCanvas() {
    const plane = root.querySelector('.rl-plane'); if (!plane) return;
    const w = Math.max(1500, ...graph.nodes.map(n => n.position.x + 300)), h = Math.max(700, ...graph.nodes.map(n => n.position.y + 250));
    plane.style.width = w + 'px'; plane.style.height = h + 'px'; plane.style.transform = 'scale(' + graph.viewport.zoom + ')';
    const edges = graph.edges.map(e => {
      const [a, ap] = e.from.split('.'), [b, bp] = e.to.split('.'), from = graph.nodes.find(n => n.id === a), to = graph.nodes.find(n => n.id === b);
      if (!from || !to) return '';
      const x1 = from.position.x + 220, y1 = from.position.y + 95 + definition(from).outputs.findIndex(p => p.name === ap) * 32,
        x2 = to.position.x, y2 = to.position.y + 95 + definition(to).inputs.findIndex(p => p.name === bp) * 32;
      return '<path d="M' + x1 + ',' + y1 + ' C' + (x1 + 70) + ',' + y1 + ' ' + (x2 - 70) + ',' + y2 + ' ' + x2 + ',' + y2 + '"/><text x="' + ((x1 + x2) / 2) + '" y="' + ((y1 + y2) / 2 - 8) + '">' + esc(ap) + '</text>';
    }).join('');
    plane.innerHTML = '<svg class="rl-edges" width="' + w + '" height="' + h + '" aria-hidden="true">' + edges + '</svg>' + graph.nodes.map(node => {
      const def = definition(node);
      return '<article class="rl-node' + (node.id === selected ? ' selected' : '') + '" tabindex="0" data-node="' + node.id + '" data-category="' + def.category + '" aria-label="' + esc(def.label + ' node ' + node.id) + '" style="left:' + node.position.x + 'px;top:' + node.position.y + 'px"><button type="button" class="rl-node-title" data-select-node="' + node.id + '">' + esc(def.label) + '</button><div class="rl-node-kind">' + esc(node.id + ' · v' + node.version) + '</div><div class="rl-ports">' +
        Array.from({ length: Math.max(def.inputs.length, def.outputs.length) }, (_, i) => '<div class="rl-port-row">' + (def.inputs[i] ? '<button type="button" data-port-in="' + node.id + '.' + def.inputs[i].name + '">○ ' + esc(def.inputs[i].name) + '</button>' : '<span></span>') +
          (def.outputs[i] ? '<button type="button" class="rl-port-out' + (pendingPort === node.id + '.' + def.outputs[i].name ? ' pending' : '') + '" data-port-out="' + node.id + '.' + def.outputs[i].name + '">' + esc(def.outputs[i].name) + ' ○</button>' : '') + '</div>').join('') + '</div></article>';
    }).join('');
    const scroll = root.querySelector('.rl-scroll'); scroll.scrollLeft = graph.viewport.x; scroll.scrollTop = graph.viewport.y;
    root.querySelector('#rl-zoom-label').textContent = Math.round(graph.viewport.zoom * 100) + '%';
    root.querySelector('.rl-minimap').innerHTML = graph.nodes.map(n => '<rect x="' + n.position.x + '" y="' + n.position.y + '" width="220" height="130"/>').join('');
  }
  function renderInspector() {
    const inspector = root.querySelector('.rl-inspector'), node = graph.nodes.find(n => n.id === selected); if (!inspector) return;
    if (!node) { inspector.innerHTML = '<h3>Block inspector</h3><p class="rl-muted">Select a block to inspect its parameters, units and provenance.</p>'; return; }
    const def = definition(node), sources = snapshot ? Object.values(snapshot.assets) : [];
    inspector.innerHTML = '<h3>' + esc(def.label) + '</h3><p class="rl-muted">' + esc(def.description || 'Versioned deterministic block. Missing observations are excluded and counted.') + '</p>' +
      Object.entries(def.params_schema.properties).map(([k, p]) => p.enum ? '<label>' + esc(k.replaceAll('_', ' ')) + '<select data-param="' + k + '">' + p.enum.map(v => '<option' + (v === node.params[k] ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>' :
        '<label>' + esc(k.replaceAll('_', ' ')) + '<input type="' + (p.type === 'string' ? 'text' : 'number') + '" data-param="' + k + '" value="' + esc(node.params[k]) + '"' + (p.type === 'string' ? ' maxlength="' + p.maxLength + '"' : ' min="' + p.minimum + '" max="' + p.maximum + '" step="' + (p.type === 'integer' ? '1' : 'any') + '"') + '></label>').join('') +
      '<h4>Typed ports</h4>' + [...def.inputs, ...def.outputs].map(p => '<div class="rl-port-info">' + esc(p.name + ' · ' + p.dtype + ' · ' + p.unit + ' · ' + p.shape + ' · ' + p.frequency + ' · ' + p.timezone) + '</div>').join('') +
      '<h4>Availability</h4><p class="rl-muted">' + esc(snapshot?.history_class || 'Capture a snapshot first') + '<br>' + esc(def.temporal_policy) + '<br>' + (sources.length ? esc(sources[0].first + ' to ' + sources[0].last) : 'No history loaded') + '</p>' +
      '<h4>Compatible next blocks</h4><p class="rl-muted">' + contracts.blocks.filter(b => b.ready && b.inputs.some(p => def.outputs.some(out => contracts.compatible(out, p)))).map(b => esc(b.label)).join(', ') + '</p>' + button('delete-node', 'Remove selected block');
  }
  function renderConnections() {
    const from = root.querySelector('#rl-connect-from'), to = root.querySelector('#rl-connect-to'); if (!from) return;
    const ports = side => graph.nodes.flatMap(n => definition(n)[side].map(p => '<option value="' + n.id + '.' + p.name + '">' + esc(n.id + '.' + p.name + ' · ' + p.unit) + '</option>')).join('');
    from.innerHTML = ports('outputs'); to.innerHTML = ports('inputs');
    root.querySelector('.rl-connections').innerHTML = graph.edges.map((e, i) => '<div class="rl-connection"><span>' + esc(e.from + ' → ' + e.to) + '</span>' + button('delete-edge', 'Remove', 'data-index="' + i + '"') + '</div>').join('');
  }
  function connect(from, to) {
    const [a, ap] = from.split('.'), [b, bp] = to.split('.'), an = graph.nodes.find(n => n.id === a), bn = graph.nodes.find(n => n.id === b);
    const out = an && definition(an).outputs.find(p => p.name === ap), into = bn && definition(bn).inputs.find(p => p.name === bp);
    if (!out || !into || !contracts.compatible(out, into)) throw new Error('TYPE_MISMATCH: port types or units are incompatible');
    const links = graph.edges.filter(e => e.to !== to).concat({ from, to });
    const visit = (id, seen) => { if (seen.has(id)) throw new Error('GRAPH_CYCLE: this connection would create a cycle'); const next = new Set(seen); next.add(id); links.filter(e => e.from.split('.')[0] === id).forEach(e => visit(e.to.split('.')[0], next)); };
    graph.nodes.forEach(n => visit(n.id, new Set()));
    editGraph(() => { graph.edges = links; pendingPort = null; }); message('Connected ' + from + ' to ' + to);
  }
  function renderCompile() {
    const el = root.querySelector('#rl-compile'); if (!el || !compiled) return;
    el.innerHTML = '<h4>Compile preview</h4><p class="rl-muted">' + esc(compiled.estimate.assets + ' assets · ' + compiled.estimate.rows + ' rows · ' + compiled.estimate.nodes + ' blocks · ' + compiled.history_class) +
      '<br>Graph ' + esc(short(compiled.graph_sha256)) + ' · plan ' + esc(short(compiled.evaluation_plan_sha256)) + '<br>0 AI requests · 0 provider requests · node ceiling ' + compiled.estimate.max_node_ms + ' ms</p>' + compiled.warnings.map(warning).join('');
  }
  function syncForm() {
    const get = id => root.querySelector('#' + id)?.value;
    graph.name = get('rl-name') || graph.name; graph.research_config.as_of = get('rl-asof') || graph.research_config.as_of;
    graph.research_config.random_seed = Number(get('rl-seed')); graph.research_config.mode = get('rl-mode') || graph.research_config.mode;
    const scroll = root.querySelector('.rl-scroll'); if (scroll) { graph.viewport.x = scroll.scrollLeft; graph.viewport.y = scroll.scrollTop; }
    if (plan) Object.assign(plan, { universe: get('rl-universe').split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase()), benchmark: get('rl-benchmark').toUpperCase(),
      discovery: [get('rl-disc-start'), get('rl-disc-end')], holdout: [get('rl-hold-start'), get('rl-hold-end')], horizon_sessions: Number(get('rl-horizon')),
      embargo_sessions: Number(get('rl-embargo')), costs: { commission_bps: Number(get('rl-commission')), slippage_bps: Number(get('rl-slippage')) }, max_trials: Number(get('rl-trials')), min_events: Number(get('rl-min-events')) });
  }
  async function save() {
    syncForm(); if (!plan) throw new Error('Capture inputs first.');
    const out = await api('save', { ...(experimentId ? { experiment_id: experimentId, expected_revision: latestRevision } : {}), ...(familyId ? { family_id: familyId } : {}),
      graph, plan, hypothesis: root.querySelector('#rl-hypothesis').value });
    experimentId = out.experiment_id; revision = out.revision; latestRevision = revision; familyId = out.family_id; compiled = out.compiled; dirty = false;
    root.querySelector('#rl-revision').textContent = experimentId + ' · frozen revision ' + revision; renderCompile(); message('Saved revision ' + revision + '. Running it cannot change this graph or plan.'); return out;
  }
  async function refreshJournal() { journalData = await api('journal'); renderJournal(); renderOperations(); }
  async function inspectRun(id) { currentRun = await api('run', undefined, { id }); renderResults(); renderExchange(); setView('results'); }
  async function drain(id) {
    if (processing) return; processing = true;
    try {
      while (options.allowed() && !doc.hidden && !doc.getElementById('page-pane-research-lab')?.hidden) {
        const run = await api('advance', { run_id: id });
        currentRun = await api('run', undefined, { id }); renderResults();
        if (['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT'].includes(run.status)) { await refreshJournal(); renderExchange(); message('Run ' + run.status.toLowerCase() + '.'); break; }
        await new Promise(resolve => win.setTimeout(resolve, 250));
      }
    } finally { processing = false; }
  }
  function renderResults() {
    const el = root.querySelector('#rl-results'); if (!el) return;
    if (!currentRun) { el.innerHTML = '<div class="rl-empty">Run a saved experiment or open a frozen run from the Journal.<br>Numerical outputs appear only after the full graph succeeds.</div>'; return; }
    const { run, result, manifest, nodes } = currentRun, total = nodes.length, fraction = Math.round(run.completed_nodes.length / total * 100);
    el.innerHTML = '<section class="rl-panel"><h3>' + esc(run.status + ' · ' + run.stage) + '</h3><p class="rl-muted">' + esc(run.id) + ' · revision ' + run.revision + ' · ' + esc(run.history_class) + '<br>Holdout: ' + esc(run.holdout_status) + '</p><div class="rl-progress" aria-label="Run progress ' + fraction + ' percent"><span style="width:' + fraction + '%"></span></div>' +
      '<div class="rl-inline">' + button('refresh-run', 'Refresh') + (!['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT'].includes(run.status) ? button('resume', 'Resume worker') + button('cancel', 'Cancel run') : '') +
      (run.status === 'SUCCEEDED' ? button('replay', 'Replay frozen inputs') + button('export', 'Export evidence ZIP') : '') + button('open-exp', 'Open this revision', 'data-id="' + run.experiment_id + '" data-revision="' + run.revision + '"') + '</div>' +
      (run.failure ? warning(run.failure.code + ': ' + run.failure.message) : '') +
      (run.replay_check ? warning('Replay: identical output bytes ' + run.replay_check.byte_identical + '; equivalent metrics ' + run.replay_check.metric_equivalent) : '') + '</section>';
    if (result) {
      const s = result.summary;
      if (result.kind !== 'conditional_scenario') el.innerHTML += '<div class="rl-metrics">' +
        [['Selected events', num(s.events)], ['Net forward return', pct(s.mean_net_return)], ['Same-date baseline', pct(s.mean_baseline_return)], ['Net excess return', pct(s.mean_excess_return)],
          ['95% interval', s.uncertainty.low == null ? 'Unavailable' : pct(s.uncertainty.low) + ' to ' + pct(s.uncertainty.high)], ['Date clusters / issuers', s.uncertainty.effective_dates + ' / ' + s.uncertainty.issuers]].map(([k, v]) => '<div class="rl-metric"><span>' + esc(k) + '</span><strong>' + esc(v) + '</strong></div>').join('') + '</div>';
      el.innerHTML += result.warnings.map(warning).join('');
      if (result.strategy) el.innerHTML += '<section class="rl-panel"><h3>Modeled equity portfolio</h3><p>' + esc('Net ' + pct(result.strategy.net_return) + ' · gross ' + pct(result.strategy.gross_return) + ' · drawdown ' + pct(result.strategy.max_drawdown) + ' · Sharpe ' + num(result.strategy.sharpe) + ' · turnover ' + num(result.strategy.turnover)) + '</p>' + chart(result.strategy.curve.map(r => r.equity)) + warning(result.strategy.caveats) + '</section>';
      if (result.kind === 'conditional_scenario') {
        const rows = result.rows.map(({ curve, ...r }) => r), headers = Object.keys(rows[0] || {});
        el.innerHTML += '<section class="rl-panel"><h3>Conditional outcomes</h3><p class="rl-muted">Assumptions ' + esc(JSON.stringify(result.assumptions)) + '</p>' + table(headers, rows.map(r => headers.map(h => typeof r[h] === 'number' ? num(r[h]) : r[h]))) + (result.rows[0]?.curve ? chart(result.rows[0].curve.map(r => r.p50)) + '<p class="rl-muted">Median simulated price path for the first asset. Assumption-driven, not a forecast.</p>' : '') + '</section>';
      } else {
        const rows = result.rows.filter(r => r.selected);
        el.innerHTML += '<section class="rl-panel"><h3>Event observations</h3><p class="rl-muted">Showing ' + Math.min(200, rows.length) + ' of ' + rows.length + ' selected events. Returns include the explicit round-trip costs.</p>' +
          table(['Asset', 'Signal', 'Entry open', 'Exit open', 'Gross', 'Net', 'Baseline', 'Net excess'], rows.slice(0, 200).map(r => [r.asset, r.date, r.entry_date, r.exit_date, pct(r.gross_return), pct(r.net_return), pct(r.baseline_return), pct(r.net_excess)])) + '</section>' +
          '<section class="rl-panel"><h3>Uncertainty and robustness</h3><p class="rl-muted">' + esc(s.uncertainty.method + '. ' + result.walk_forward_policy) + '</p>' +
          table(['Cost multiple', 'Net return', 'Net excess'], s.cost_sensitivity.map(r => [r.multiplier, pct(r.mean_net_return), pct(r.mean_excess_return)])) +
          warning('Multiplicity: ' + result.multiplicity.registered_family_attempts + ' registered family attempts · familywise alpha ' + num(result.multiplicity.alpha) + ' · adjusted interval ' + (result.multiplicity.adjusted_interval.low == null ? 'unavailable' : pct(result.multiplicity.adjusted_interval.low) + ' to ' + pct(result.multiplicity.adjusted_interval.high))) +
          table(['Window start', 'Window end', 'Events', 'Net excess'], result.walk_forward.map(r => [r.start, r.end, r.events, pct(r.mean_excess_return)])) + warning('Purged / missing observations: ' + JSON.stringify(result.skipped)) + '</section>';
      }
    }
    el.innerHTML += '<section class="rl-panel"><h3>Node artifacts and attempts</h3><div class="rl-inline">' + nodes.map(n => button('node', n.id + (n.completed ? ' ✓' : ' · waiting'), 'data-id="' + n.id + '"' + (run.status === 'SUCCEEDED' ? '' : ' disabled'))).join('') + '</div><pre id="rl-node-output" hidden></pre>' +
      '<details><summary>Attempts and resource measurements</summary><pre>' + esc(JSON.stringify(run.attempts, null, 2)) + '</pre></details><details><summary>Frozen run manifest</summary><pre>' + esc(JSON.stringify(manifest, null, 2)) + '</pre></details></section>';
  }
  function table(headers, rows) { return '<div class="rl-table-wrap"><table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
  function chart(values) {
    if (!values.length) return '';
    const lo = Math.min(...values), hi = Math.max(...values);
    return '<svg class="rl-chart" viewBox="0 0 640 190" role="img" aria-label="Research result path"><line x1="15" y1="175" x2="625" y2="175"/><path d="' + values.map((v, i) => (i ? 'L' : 'M') + (15 + i / Math.max(1, values.length - 1) * 610).toFixed(2) + ',' + (175 - (v - lo) / (hi - lo || 1) * 155).toFixed(2)).join(' ') + '"/></svg>';
  }
  function renderJournal() {
    const el = root.querySelector('#rl-journal'); if (!el) return;
    if (!journalData) { el.innerHTML = button('journal-refresh', 'Load Journal'); return; }
    const data = journalData;
    el.innerHTML = '<section class="rl-panel"><h3>Experiment dossiers</h3><div class="rl-fields">' + input('rl-journal-search', 'Search title or hypothesis', journalQuery) +
      '<label>Show<select id="rl-journal-filter"><option value="all">All research</option><option value="graveyard"' + (journalFilter === 'graveyard' ? ' selected' : '') + '>Signal graveyard · rejected / failed</option></select></label></div>' + button('journal-refresh', 'Refresh Journal') +
      data.experiments.filter(e => (e.title + e.hypothesis).toLowerCase().includes(journalQuery.toLowerCase()) && (journalFilter !== 'graveyard' || ['REJECTED', 'RETIRED'].includes(e.status) || data.runs.some(r => r.experiment_id === e.id && ['FAILED', 'CANCELED', 'TIMED_OUT'].includes(r.status)))).map(e =>
        '<article class="rl-exp"><h4>' + esc(e.title) + '</h4><p>' + esc(e.hypothesis) + '</p><p>' + esc(e.status + ' · ' + e.revision + ' revisions · ' + data.runs.filter(r => r.family_id === e.family_id && !r.replay_of).length + ' family trials') + '</p><div class="rl-inline">' + button('open-exp', 'Open latest', 'data-id="' + e.id + '"') + button('fork-exp', 'Fork variant', 'data-id="' + e.id + '"') + '</div></article>').join('') + '</section>' +
      '<section class="rl-panel"><h3>All runs, including failed trials</h3><p class="rl-muted">Select 2–4 successful studies. The first selected is the baseline. Comparisons use the same asset/session intersection, target, horizon, costs and evaluation window.</p>' + button('compare', 'Compare selected runs') +
      '<div class="rl-table-wrap"><table><thead><tr><th>Select</th><th>Run</th><th>Status</th><th>Stage</th><th>Revision</th><th>Holdout</th><th>Action</th></tr></thead><tbody>' + data.runs.map(r => '<tr><td><input type="checkbox" aria-label="Select ' + r.id + ' for comparison" data-compare-id="' + r.id + '"' + (selectedRuns.includes(r.id) ? ' checked' : '') + (r.status === 'SUCCEEDED' ? '' : ' disabled') + '></td><td>' + esc(short(r.id)) + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.stage) + '</td><td>' + r.revision + '</td><td>' + esc(r.holdout_status) + '</td><td>' + button('open-run', 'Inspect', 'data-id="' + r.id + '"') + '</td></tr>').join('') + '</tbody></table></div><div id="rl-comparison-result"></div></section>' +
      '<section class="rl-panel"><h3>Saved comparisons</h3>' + data.comparisons.map(c => button('open-comparison', c.title, 'data-id="' + c.id + '"')).join(' ') + '</section>' +
      '<section class="rl-panel"><h3>Human evidence review</h3><p class="rl-muted">Review the currently inspected run. Approval of external notes never changes scientific status. Missing PIT evidence or an exposed holdout blocks promotion.</p><div class="rl-fields"><label>Status<select id="rl-review-status">' + ['EXPLORATORY', 'CANDIDATE', 'VALIDATION_PENDING', 'PAPER_MONITORING', 'VALIDATED_WITHIN_TESTED_SCOPE', 'REJECTED', 'RETIRED'].map(s => '<option>' + s + '</option>').join('') + '</select></label>' + input('rl-review-reason', 'Reason for review', '') + '</div>' + button('review-evidence', 'Record human review') + '</section>' +
      '<section class="rl-panel"><h3>External interpretations</h3>' + data.interpretations.map(i => '<article class="rl-exp"><span class="rl-badge">' + esc(i.decision + ' · external opinion') + '</span><p>' + esc(i.summary) + '</p>' + button('open-note', 'Inspect evidence pointers', 'data-id="' + i.id + '"') + '</article>').join('') + '<pre id="rl-note-detail" hidden></pre></section>' +
      '<section class="rl-panel"><h3>Prospective scorecard</h3><p class="rl-muted">Freeze an owner-written return assumption from a recent completed-session price. The prediction is timestamped now and cannot be edited. Realization uses an exact future-session close from a later snapshot.</p><div class="rl-fields">' +
      input('rl-forward-asset', 'Asset in inspected run', plan?.universe[0] || '') + input('rl-forward-date', 'Future target session', '', 'date') + input('rl-forward-return', 'Assumed return · percent', '0', 'number', 'step="any"') + '</div>' + button('forward-freeze', 'Freeze prospective assumption') +
      data.forward_observations.map(o => '<div class="rl-exp"><p>' + esc(o.asset + ' · published ' + o.published_at + ' · target ' + o.target_date + ' · assumption ' + pct(o.predicted_return) + (o.realized ? ' · actual ' + pct(o.realized.realized_return) + ' · deviation ' + pct(o.realized.deviation) : ' · awaiting realization')) + '</p>' + (!o.realized ? button('forward-realize', 'Record realization from current snapshot', 'data-id="' + o.id + '"') : '') + '</div>').join('') + '</section>';
  }
  function renderComparison(value) {
    const el = root.querySelector('#rl-comparison-result');
    el.innerHTML = '<h4>' + esc(value.title) + '</h4><p class="rl-muted">' + esc(value.common_observations + ' common observations · ' + value.dates.join(' to ') + ' · ' + value.assets.join(', ')) + '</p>' +
      table(['Candidate', 'Mean paired increment', 'Interval', 'Overlap', 'Additional events', 'Excluded baseline / candidate'], value.comparisons.map(c => [short(c.candidate_run_id), pct(c.mean_increment), c.uncertainty.low == null ? 'Unavailable' : pct(c.uncertainty.low) + ' to ' + pct(c.uncertainty.high), c.signal_overlap, c.additional_events, c.excluded_baseline + ' / ' + c.excluded_candidate])) +
      warning(value.method) + value.warnings.map(warning).join(''); setView('journal');
  }
  function renderExchange() {
    const el = root.querySelector('#rl-exchange'); if (!el) return;
    const text = el.querySelector('#rl-import-json')?.value || '';
    el.innerHTML = '<section class="rl-panel"><h3>Take the evidence to ChatGPT or Claude</h3><p class="rl-muted">1. Inspect a completed run. 2. Download its ZIP. 3. Attach it in a new offsite chat and follow README_FOR_CHATGPT.md. 4. Bring back the structured JSON for review.</p><p class="rl-muted">The bundle includes the hypothesis, graph, frozen run specification, validation plan, all trial counts, indexed metrics, provenance, checksums and an interpretation template. Raw price data is excluded. Neither export nor import calls an AI service.</p><div class="rl-fields"><label>Export profile<select id="rl-export-profile"><option value="compact">Compact · aggregates and warnings</option><option value="full">Full · permitted aggregate diagnostics</option></select></label><div class="rl-inline">' + button('export', 'Download inspected run ZIP', currentRun?.run.status === 'SUCCEEDED' ? '' : 'disabled') + '</div></div></section>' +
      '<section class="rl-panel"><h3>Preview an external interpretation</h3><label>JSON file<input id="rl-import-file" type="file" accept="application/json,.json"></label><label>Interpretation JSON<textarea id="rl-import-json" rows="12" maxlength="100000" placeholder="Paste mingstreet.research-interpretation.v2 JSON">' + esc(text) + '</textarea></label><div class="rl-inline">' + button('preview-import', 'Verify evidence pointers') + button('approve-import', 'Approve commentary', importPreview ? '' : 'disabled') + button('reject-import', 'Reject commentary', importPreview ? '' : 'disabled') + '</div><div id="rl-import-preview"></div></section>';
    if (importPreview) renderImportPreview();
  }
  function renderImportPreview() {
    const el = root.querySelector('#rl-import-preview'); if (!el || !importPreview) return;
    el.innerHTML = importPreview.warnings.map(warning).join('') + '<p>' + esc(importInput.summary) + '</p>' +
      table(['Metric', 'Canonical value', 'Unit', 'Pointer'], importPreview.verified.map(v => [v.metric_id, num(v.canonical_value), v.unit, 'Verified · narrative unverified'])) +
      '<h4>Unverified interpretations</h4>' + importInput.interpretations.map(warning).join('') + '<h4>Unknowns</h4>' + importInput.unknowns.map(warning).join('') +
      '<h4>Proposed follow-ups</h4>' + importInput.proposed_tests.map((t, i) => '<article class="rl-exp"><h4>' + esc(t.title) + '</h4><p>' + esc(t.rationale) + '</p>' + button('draft-followup', 'Create editable draft', 'data-index="' + i + '"') + '</article>').join('');
    root.querySelector('[data-rl="approve-import"]').disabled = false; root.querySelector('[data-rl="reject-import"]').disabled = false;
  }
  function renderOperations() {
    const el = root.querySelector('#rl-operations'); if (!el) return;
    if (!journalData) { el.innerHTML = '<p class="rl-muted">Load the Journal to inspect operations.</p>'; return; }
    el.innerHTML = '<section class="rl-panel"><h3>Bounded, on-demand execution</h3><p class="rl-muted">Private R2 checkpoints retain queued work. Each request advances one allowlisted node. Leaving this page pauses the browser worker; resume from a run, or use the standalone worker. No automatic polling of idle research, AI requests, data-provider fetches or scheduled research runs.</p>' +
      '<div class="rl-metrics">' + Object.entries(journalData.operations).map(([k, v]) => '<div class="rl-metric"><span>' + esc(k.replaceAll('_', ' ')) + '</span><strong>' + num(v) + '</strong></div>').join('') + '</div><p class="rl-muted">Retained runs ' + journalData.quotas.runs + ' / ' + journalData.quotas.max_runs + '. Storage and compute usage apply; no AI API usage.</p><details><summary>Resource ceilings</summary><pre>' + esc(JSON.stringify(contracts.LIMITS, null, 2)) + '</pre></details></section>' +
      '<section class="rl-panel"><h3>Append-only audit events</h3><div class="rl-log">' + [...journalData.events].reverse().map(e => '<div><b>' + esc(e.type) + '</b> · ' + esc(e.occurred_at) + '<br>' + esc(JSON.stringify(e.payload)) + '</div>').join('') + '</div></section>';
  }
  async function action(name, el) {
    if (name === 'capture') {
      syncForm(); const symbols = root.querySelector('#rl-symbols').value.toUpperCase().split(/[\s,]+/).filter(Boolean);
      snapshot = await api('snapshot', { symbols }); graph.research_config.snapshot_id = snapshot.id; graph.research_config.as_of = snapshot.captured_at;
      plan = defaultPlan(snapshot); changed(); renderWorkspace(); message('Captured the existing cache. Historical limitations remain attached to every run and export.');
    }
    if (name === 'save') await save();
    if (name === 'compile') { syncForm(); if (!plan) throw new Error('Capture inputs first.'); contracts.validateGraph(graph); contracts.validatePlan(plan); compiled = await api('compile', { graph, plan }); renderCompile(); message('Graph and evaluation plan accepted. Review the compile preview before running.'); }
    if (name === 'run' || name === 'final') {
      if (name === 'final' && !root.querySelector('#rl-final-ack').checked) throw new Error('Read and check the holdout-access acknowledgement in step 4.');
      if (dirty || !experimentId) await save();
      const run = await api('queue', { experiment_id: experimentId, revision, stage: name === 'final' ? 'final' : 'discovery', idempotency_key: win.crypto.randomUUID() });
      await inspectRun(run.id); await drain(run.id);
    }
    if (name === 'undo' && history.length) { future.push(JSON.stringify(graph)); graph = JSON.parse(history.pop()); changed(); renderWorkspace(); }
    if (name === 'redo' && future.length) { history.push(JSON.stringify(graph)); graph = JSON.parse(future.pop()); changed(); renderWorkspace(); }
    if (name === 'zoom-in' || name === 'zoom-out' || name === 'fit') {
      const width = root.querySelector('.rl-scroll').clientWidth, maxX = Math.max(...graph.nodes.map(n => n.position.x + 260));
      graph.viewport.zoom = Math.max(0.3, Math.min(2, name === 'fit' ? width / maxX : graph.viewport.zoom + (name === 'zoom-in' ? 0.1 : -0.1))); changed(); renderCanvas();
    }
    if (name === 'delete-node') editGraph(() => { graph.nodes = graph.nodes.filter(n => n.id !== selected); graph.edges = graph.edges.filter(e => e.from.split('.')[0] !== selected && e.to.split('.')[0] !== selected); selected = null; });
    if (name === 'delete-edge') editGraph(() => graph.edges.splice(Number(el.dataset.index), 1));
    if (name === 'connect') connect(root.querySelector('#rl-connect-from').value, root.querySelector('#rl-connect-to').value);
    if (name === 'refresh-run') await inspectRun(currentRun.run.id);
    if (name === 'resume') await drain(currentRun.run.id);
    if (name === 'cancel') { await api('cancel', { run_id: currentRun.run.id }); await inspectRun(currentRun.run.id); await refreshJournal(); }
    if (name === 'replay') {
      const r = currentRun.run, replay = await api('queue', { experiment_id: r.experiment_id, revision: r.revision, stage: r.stage, replay_of: r.id, idempotency_key: win.crypto.randomUUID() });
      await inspectRun(replay.id); await drain(replay.id);
    }
    if (name === 'node') { const output = await api('node', undefined, { id: currentRun.run.id, node: el.dataset.id }), pre = root.querySelector('#rl-node-output'); pre.hidden = false; pre.textContent = JSON.stringify(output, null, 2).slice(0, 30000) + (output.bytes > 30000 ? '\nDisplay truncated; original immutable artifact retained.' : ''); }
    if (name === 'journal-refresh') await refreshJournal();
    if (name === 'open-run') await inspectRun(el.dataset.id);
    if (name === 'open-exp' || name === 'fork-exp') {
      const out = await api('experiment', undefined, { id: el.dataset.id, ...(el.dataset.revision ? { revision: el.dataset.revision } : {}) });
      graph = out.graph; plan = out.plan; experimentId = name === 'fork-exp' ? null : out.experiment.id; revision = name === 'fork-exp' ? 0 : out.revision; latestRevision = out.experiment.revisions.length; familyId = out.experiment.family_id;
      snapshot = out.snapshot_summary;
      selected = graph.nodes[1]?.id; history = []; future = []; dirty = name === 'fork-exp'; compiled = out.compiled;
      renderWorkspace(); root.querySelector('#rl-hypothesis').value = out.hypothesis; setView('workspace'); message(name === 'fork-exp' ? 'Forked within the same trial family. Edit and run explicitly.' : 'Opened frozen revision ' + revision);
    }
    if (name === 'compare') { const c = await api('compare', { run_ids: selectedRuns, title: 'Research comparison' }); await refreshJournal(); renderComparison(c); }
    if (name === 'open-comparison') renderComparison(await api('comparison', undefined, { id: el.dataset.id }));
    if (name === 'open-note') { const detail = await api('interpretation', undefined, { id: el.dataset.id }), pre = root.querySelector('#rl-note-detail'); pre.hidden = false; pre.textContent = JSON.stringify(detail, null, 2); }
    if (name === 'review-evidence') { if (!currentRun) throw new Error('Inspect a run first.'); await api('review', { experiment_id: currentRun.run.experiment_id, run_id: currentRun.run.id, status: root.querySelector('#rl-review-status').value, reason: root.querySelector('#rl-review-reason').value }); await refreshJournal(); message('Human evidence review appended.'); }
    if (name === 'export') {
      if (currentRun?.run.status !== 'SUCCEEDED') throw new Error('Inspect a successful run first.');
      const res = await api('export', { run_id: currentRun.run.id, profile: root.querySelector('#rl-export-profile')?.value || 'compact' }), blob = await res.blob(), url = win.URL.createObjectURL(blob), a = doc.createElement('a');
      a.href = url; a.download = 'mingstreet_' + currentRun.run.id + '.zip'; doc.body.append(a); a.click(); a.remove(); win.setTimeout(() => win.URL.revokeObjectURL(url), 1000); message('Evidence ZIP downloaded. Attach it in a new ChatGPT or Claude chat.');
    }
    if (name === 'preview-import') { importInput = JSON.parse(root.querySelector('#rl-import-json').value); importPreview = await api('validate-import', { interpretation: importInput }); renderImportPreview(); message('Evidence pointers verified. Review the narrative and choose approve or reject.'); }
    if (name === 'approve-import' || name === 'reject-import') {
      if (!importPreview) throw new Error('Preview the exact JSON first.');
      const latest = JSON.parse(root.querySelector('#rl-import-json').value);
      if (JSON.stringify(latest) !== JSON.stringify(importInput)) throw new Error('The JSON changed. Preview it again.');
      await api('import', { interpretation: latest, decision: name === 'approve-import' ? 'approved' : 'rejected', preview_sha256: importPreview.input_sha256 }); await refreshJournal(); message('External commentary review appended. Official metrics and evidence status are unchanged.');
    }
    if (name === 'draft-followup') { const t = importInput.proposed_tests[Number(el.dataset.index)]; changeTemplate('breadth'); graph.name = t.title; renderWorkspace(); root.querySelector('#rl-hypothesis').value = t.rationale; setView('workspace'); message('Editable proposal created. Choose inputs and unresolved parameters, then validate and run explicitly.'); }
    if (name === 'forward-freeze') {
      if (!currentRun || !snapshot) throw new Error('Inspect a successful run and capture a recent snapshot first.');
      await api('forward', { run_id: currentRun.run.id, asset: root.querySelector('#rl-forward-asset').value.toUpperCase(), target_date: root.querySelector('#rl-forward-date').value, predicted_return: Number(root.querySelector('#rl-forward-return').value) / 100, snapshot_id: snapshot.id }); await refreshJournal();
    }
    if (name === 'forward-realize') { if (!snapshot) throw new Error('Capture a current snapshot first.'); await api('forward', { observation_id: el.dataset.id, snapshot_id: snapshot.id }); await refreshJournal(); }
  }
  async function safe(fn) { try { await fn(); } catch (e) { message(e.message || String(e), true); } }
  function addNode(type) {
    if (graph.nodes.length >= contracts.LIMITS.nodes) throw new Error('Node limit reached.');
    const id = 'n' + win.crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    editGraph(() => { graph.nodes.push({ id, type, version: contracts.VERSION, params: contracts.defaults(type), position: { x: 80 + graph.nodes.length % 4 * 280, y: 350 + Math.floor(graph.nodes.length / 4) * 160 } }); selected = id; });
  }
  function bind() {
    root.addEventListener('click', event => safe(async () => {
      const actionEl = event.target.closest('[data-rl]'); if (actionEl && !actionEl.disabled) { actionEl.disabled = true; try { await action(actionEl.dataset.rl, actionEl); } finally { if (actionEl.isConnected) actionEl.disabled = false; } return; }
      const tab = event.target.closest('[data-view]'); if (tab) { if (['journal', 'operations'].includes(tab.dataset.view)) await refreshJournal(); setView(tab.dataset.view); return; }
      const add = event.target.closest('[data-add]'); if (add && !add.disabled) { syncForm(); addNode(add.dataset.add); return; }
      const node = event.target.closest('[data-select-node]'); if (node) { selected = node.dataset.selectNode; renderCanvas(); renderInspector(); return; }
      const out = event.target.closest('[data-port-out]'); if (out) { pendingPort = out.dataset.portOut; renderCanvas(); message('Choose a compatible input port, or use Keyboard connections.'); return; }
      const into = event.target.closest('[data-port-in]'); if (into) { if (!pendingPort) throw new Error('Select an output port first.'); connect(pendingPort, into.dataset.portIn); }
    }));
    root.addEventListener('input', event => {
      if (event.target.id === 'rl-library-search') { libraryQuery = event.target.value; renderLibrary(); return; }
      if (event.target.id === 'rl-import-json') { importPreview = null; root.querySelector('[data-rl="approve-import"]').disabled = true; root.querySelector('[data-rl="reject-import"]').disabled = true; return; }
      if (event.target.closest('#rl-workspace') && !['rl-final-ack', 'rl-connect-from', 'rl-connect-to'].includes(event.target.id)) changed();
    });
    root.addEventListener('change', event => safe(async () => {
      const el = event.target;
      if (el.dataset.param) { const node = graph.nodes.find(n => n.id === selected), p = definition(node).params_schema.properties[el.dataset.param]; syncForm(); editGraph(() => { node.params[el.dataset.param] = p.type === 'string' ? el.value : Number(el.value); }); }
      if (el.id === 'rl-template' && el.value) { syncForm(); changeTemplate(el.value); }
      if (el.dataset.compareId) { selectedRuns = selectedRuns.filter(id => id !== el.dataset.compareId); if (el.checked) selectedRuns.push(el.dataset.compareId); }
      if (el.id === 'rl-journal-search' || el.id === 'rl-journal-filter') { journalQuery = root.querySelector('#rl-journal-search').value; journalFilter = root.querySelector('#rl-journal-filter').value; renderJournal(); }
      if (el.id === 'rl-import-file') { const file = el.files[0]; if (!file) return; if (file.size > 100000 || !file.name.toLowerCase().endsWith('.json')) throw new Error('Choose a JSON interpretation under 100 KB. ZIP imports are not accepted.'); root.querySelector('#rl-import-json').value = await file.text(); importPreview = null; }
    }));
    root.addEventListener('keydown', event => {
      if (event.target.matches('[role=tab]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const tabs = [...root.querySelectorAll('[role=tab]')], index = tabs.indexOf(event.target), next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; next.focus(); next.click(); }
      const nodeEl = event.target.closest('[data-node]');
      if (nodeEl && event.target === nodeEl && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); selected = nodeEl.dataset.node;
        editGraph(() => { const n = graph.nodes.find(n => n.id === selected); n.position.x = Math.max(0, n.position.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0)); n.position.y = Math.max(0, n.position.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0)); });
        root.querySelector('[data-node="' + selected + '"]').focus();
      }
    });
    root.addEventListener('dragstart', e => { const el = e.target.closest('[data-add]'); if (el) e.dataTransfer.setData('text/plain', el.dataset.add); });
    root.addEventListener('dragover', e => { if (e.target.closest('.rl-scroll')) e.preventDefault(); });
    root.addEventListener('drop', e => safe(() => { if (!e.target.closest('.rl-scroll')) return; e.preventDefault(); const type = e.dataTransfer.getData('text/plain'); if (contracts.blocks.some(b => b.key === type && b.ready)) addNode(type); }));
    root.addEventListener('pointerdown', e => {
      const handle = e.target.closest('[data-select-node]'); if (!handle || e.button !== 0) return;
      const node = graph.nodes.find(n => n.id === handle.dataset.selectNode), before = JSON.stringify(graph), start = { x: e.clientX, y: e.clientY, px: node.position.x, py: node.position.y }; let moved = false;
      const move = event => { if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 5) return; moved = true; node.position = { x: Math.max(0, Math.min(5000, start.px + (event.clientX - start.x) / graph.viewport.zoom)), y: Math.max(0, Math.min(5000, start.py + (event.clientY - start.y) / graph.viewport.zoom)) }; const article = root.querySelector('[data-node="' + node.id + '"]'); article.style.left = node.position.x + 'px'; article.style.top = node.position.y + 'px'; };
      const up = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); if (moved) { history.push(before); future = []; selected = node.id; changed(); renderCanvas(); renderInspector(); } };
      win.addEventListener('pointermove', move); win.addEventListener('pointerup', up, { once: true });
    });
  }
  function reset() { processing = false; mounted = false; currentRun = null; journalData = null; importInput = null; importPreview = null; graph = contracts.template(); plan = null; snapshot = null; experimentId = null; revision = 0; latestRevision = 0; familyId = null; history = []; future = []; selectedRuns = []; compiled = null; view = 'workspace'; dirty = true; if (root) root.replaceChildren(); }
  async function load() {
    if (!root || !options.allowed()) return;
    if (!mounted) { mounted = true; shell(); if (!root.dataset.bound) { bind(); root.dataset.bound = '1'; } await safe(refreshJournal); }
  }
  return { load, reset };
}

// Shared browser/server contract. Implementations are selected by the server only.
export function researchContractsFactory() {
  const VERSION = '1.0.0';
  const LIMITS = { nodes: 24, edges: 48, assets: 12, rows: 40000, bars: 2600, grid: 81,
    artifact_bytes: 4 * 1024 * 1024, body_bytes: 160000, runs: 200, experiments: 40,
    daily_runs: 30, active_runs: 3, node_ms: 8000, run_ms: 120000, attempts: 3, memory_delta_bytes: 128 * 1024 * 1024 };
  const parameter = (type, defaults, extra = {}) => ({ type, default: defaults, ...extra });
  const integer = (v, min, max) => parameter('integer', v, { minimum: min, maximum: max });
  const number = (v, min, max) => parameter('number', v, { minimum: min, maximum: max });
  const choice = (v, values) => parameter('string', v, { enum: values });
  const port = (name, dtype, unit) => ({ name, dtype, unit, frequency: 'daily_session', calendar: 'XNYS',
    currency: 'USD', timezone: 'America/New_York', shape: 'asset_session', null_policy: 'exclude_with_count' });
  const prices = name => port(name, 'PriceSeries', 'USD');
  const events = name => port(name, 'Events', 'boolean');
  const series = name => port(name, 'FactorSeries', 'decimal_return');
  const standardized = name => port(name, 'StandardizedSeries', 'zscore');
  const rank = name => port(name, 'RankSeries', 'fraction');
  const result = name => ({ ...port(name, 'ResearchResult', 'typed_metrics'), shape: 'study' });
  const evidence = name => ({ ...port(name, 'SiteEvidence', 'research_context'), shape: 'documents', frequency: 'as_of_snapshot' });
  const block = (key, label, category, inputs, outputs, properties = {}, extra = {}) => ({
    key, version: VERSION, label, category, inputs, outputs,
    params_schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
    availability: 'inherit_dependency_history_class', temporal_policy: 'known_after_close_next_session_execution',
    missing_policy: 'exclude_with_count_no_imputation', dependencies: ['frozen_snapshot'],
    limits: LIMITS, implementation_ref: key + '@' + VERSION, model_version: VERSION,
    ready: true, ...extra,
  });
  const registry = [
    block('data.site_evidence', 'Site evidence collection', 'Data', [], [evidence('evidence')],
      { evidence_ids: parameter('string', 'choose-evidence-first', { minLength: 35, maxLength: 431, pattern: '^ev_[a-f0-9]{32}(,ev_[a-f0-9]{32}){0,11}$' }) },
      { availability: 'current_context_only', description: 'Frozen, dated source cards. Connect to the report context port; never to historical signal inputs.' }),
    block('market.prices', 'Cached daily prices', 'Data', [], [prices('prices')], {},
      { availability: 'EXPLORATORY_NON_PIT', description: 'Frozen existing OHLCV cache. USD, inherited provider adjustments; release and delisting history unverified.' }),
    block('signal.shock', 'Price decline / rise', 'Signals', [prices('prices')], [events('events')],
      { lookback_sessions: integer(5, 1, 120), threshold_pct: number(-8, -90, 100), direction: choice('below', ['below', 'above']) }),
    block('signal.breadth', 'Sample breadth confirmation', 'Signals', [prices('prices')], [events('events')],
      { window: integer(20, 2, 200), min_fraction: number(0.5, 0, 1) },
      { description: 'Share of the selected sample above its trailing mean; requires all sample members on that date. Not exchange breadth.' }),
    block('signal.streak', 'Existing streak model', 'Signals', [prices('prices')], [events('events')],
      { direction: choice('red', ['red', 'green']), min_days: integer(3, 2, 20) },
      { description: 'Mingstreet computeStreakForTicker replayed on each historical prefix. Cached inputs remain exploratory.' }),
    block('transform.returns', 'Trailing returns', 'Transform', [prices('prices')], [series('series')], { sessions: integer(5, 1, 120) }),
    block('transform.rolling', 'Rolling mean', 'Transform', [series('series')], [series('series')], { window: integer(20, 2, 200) }),
    block('transform.lag', 'Delay feature', 'Transform', [series('series')], [series('series')], { sessions: integer(1, 1, 120) }),
    block('transform.winsorize', 'Trailing winsorization', 'Transform', [series('series')], [series('series')],
      { window: integer(60, 10, 252), tail: number(0.05, 0.01, 0.2) }),
    block('transform.standardize', 'Trailing standardization', 'Transform', [series('series')], [standardized('standardized')], { window: integer(60, 10, 252) }),
    block('logic.rank', 'Cross-sectional rank', 'Logic', [series('series')], [rank('rank')]),
    block('logic.rank_filter', 'Filter rank fraction', 'Logic', [rank('rank')], [events('events')], { min_fraction: number(0.8, 0, 1) }),
    block('logic.zthreshold', 'Z-score threshold', 'Logic', [standardized('standardized')], [events('events')],
      { threshold: number(-2, -10, 10), direction: choice('below', ['below', 'above']) }),
    block('logic.filter_universe', 'Filter selected assets', 'Logic', [events('events')], [events('events')],
      { symbols: parameter('string', 'AAPL,MSFT', { minLength: 1, maxLength: 100, pattern: '^[A-Z][A-Z0-9.]{0,5}(,[A-Z][A-Z0-9.]{0,5}){0,11}$' }) }),
    block('logic.event_window', 'Sessions after event', 'Logic', [prices('prices'), events('events')], [events('events')], { start_session: integer(0, 0, 60), end_session: integer(5, 0, 60) }),
    block('signal.regime', 'Benchmark trend mask', 'Signals', [prices('prices')], [events('events')],
      { lookback_sessions: integer(20, 2, 120), direction: choice('positive', ['positive', 'negative']) }),
    block('logic.threshold', 'Return threshold', 'Logic', [series('series')], [events('events')],
      { threshold: number(-0.08, -1, 2), direction: choice('below', ['below', 'above']) }),
    block('logic.and', 'Both conditions', 'Logic', [events('a'), events('b')], [events('events')]),
    block('logic.or', 'Either condition', 'Logic', [events('a'), events('b')], [events('events')]),
    block('study.forward', 'Forward returns + baseline', 'Validation', [prices('prices'), events('events')], [result('result')],
      {}, { modes: ['descriptive', 'strategy'], description: 'Next-open study, matched same-date benchmark, purged discovery/final windows, clustered intervals and cost sensitivity.' }),
    block('scenario.stress', 'Conditional price stress', 'Scenario', [prices('prices')], [result('result')],
      { shock_pct: number(-20, -95, 200), horizon_sessions: integer(20, 1, 252) }, { modes: ['conditional'] }),
    block('scenario.reverse', 'Reverse valuation scenario', 'Scenario', [prices('prices')], [result('result')],
      { target_price: number(80, 0.01, 100000), assumed_eps: number(4, 0.01, 10000), assumed_multiple: number(20, 1, 500) }, { modes: ['conditional'] }),
    block('scenario.valuation', 'Revenue / margin / multiple shock', 'Scenario', [prices('prices')], [result('result')],
      { revenue_change_pct: number(-10, -95, 200), margin_change_pct: number(0, -95, 200), multiple_change_pct: number(0, -95, 200) },
      { modes: ['conditional'], description: 'Assumes constant shares and price proportional to revenue × net margin × earnings multiple. Driver changes are assumptions.' }),
    block('scenario.rates', 'Rate-duration stress', 'Scenario', [prices('prices')], [result('result')],
      { rate_change_bps: number(100, -1000, 1000), assumed_duration_years: number(5, 0, 50) },
      { modes: ['conditional'], description: 'Assumed constant-duration price response exp(−duration × rate change); no empirical rate model or event probability.' }),
    block('scenario.sensitivity', 'Valuation sensitivity grid', 'Scenario', [prices('prices')], [result('result')],
      { assumed_eps: number(4, 0.01, 10000), assumed_multiple: number(20, 1, 500), step_pct: number(10, 1, 40), steps: integer(2, 1, 4) }, { modes: ['conditional'] }),
    block('scenario.monte_carlo', 'Seeded conditional paths', 'Scenario', [prices('prices')], [result('result')],
      { annual_drift: number(0, -1, 1), annual_volatility: number(0.3, 0.01, 2), horizon_sessions: integer(20, 1, 252), paths: integer(250, 20, 1000) },
      { modes: ['conditional'], description: 'Assumption-driven lognormal paths. Quantiles describe simulations, never calibrated event probabilities.' }),
    block('output.report', 'Research report', 'Output', [result('result')], [result('report')]),
    block('output.report', 'Research report', 'Output', [result('result'), { ...evidence('evidence'), optional: true }], [result('report')], {},
      { version: '1.1.0', implementation_ref: 'output.report@1.1.0', model_version: '1.1.0' }),
  ];
  const unavailable = [
    ['data.events', 'Earnings event calendar', 'Verified historical release times and as-of peer membership are missing.'],
    ['data.model_score', 'Grades and pillar history', 'Historical score/pillar availability is not established.'],
    ['data.fundamentals', 'Fundamentals vintage', 'Historical publication and restatement vintages are not established.'],
    ['data.macro', 'Macro vintage', 'Latest revised macro observations cannot establish point-in-time vintages.'],
    ['transform.sector_neutral', 'Sector / factor neutralization', 'As-of sector membership and factor panels are missing.'],
    ['transform.calendar', 'Calendar resampling / alignment', 'Only XNYS daily-session USD data is supported; other calendars need an audited adapter.'],
    ['forecast.probability', 'Calibrated probability forecast', 'A trained, frozen PIT model with independent calibration scores is required.'],
    ['strategy.factor_neutral', 'Factor-neutral strategy', 'Historical factors, borrow and corporate-action-continuous executable prices are required.'],
    ['strategy.options', 'Options P&L', 'Historically tradable quotes and contract-action continuity are missing.'],
  ].map(([key, label, reason]) => block(key, label, 'Needs data', [], [], {}, { ready: false, reason }));
  const blocks = [...registry, ...unavailable];
  const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  function keys(value, allowed, label) {
    if (!object(value)) fail('SCHEMA_INVALID', label + ' must be an object');
    for (const k of Object.keys(value)) if (!allowed.includes(k)) fail('UNKNOWN_FIELD', label + ': unknown field ' + k);
  }
  function text(value, max, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000-\u0008]/.test(value)) fail('SCHEMA_INVALID', 'Invalid ' + label);
    return value;
  }
  function defaults(type) {
    const def = blocks.find(b => b.key === type);
    if (!def) fail('UNKNOWN_BLOCK', 'Unknown block ' + type);
    return Object.fromEntries(Object.entries(def.params_schema.properties).map(([k, v]) => [k, v.default]));
  }
  function compatible(out, into) {
    return ['dtype', 'unit', 'shape', 'frequency', 'calendar', 'currency', 'timezone'].every(k => out[k] === into[k]);
  }
  function validateGraph(graph) {
    keys(graph, ['schema_version', 'name', 'nodes', 'edges', 'research_config', 'viewport'], 'graph');
    if (graph.schema_version !== '1.0') fail('SCHEMA_VERSION', 'Unsupported graph schema');
    text(graph.name, 160, 'graph name');
    if (!Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > LIMITS.nodes || !Array.isArray(graph.edges) || graph.edges.length > LIMITS.edges) fail('RESOURCE_LIMIT', 'Graph exceeds node/edge limits or is empty');
    const cfg = graph.research_config;
    keys(cfg, ['snapshot_id', 'as_of', 'random_seed', 'currency', 'base_calendar', 'mode'], 'research_config');
    if (!/^snap_[a-f0-9]{64}$/.test(cfg.snapshot_id || '')) fail('SNAPSHOT_REQUIRED', 'Capture a data snapshot before compiling');
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(cfg.as_of || '') || !Number.isFinite(Date.parse(cfg.as_of))) fail('SCHEMA_INVALID', 'An explicit as-of timestamp with timezone is required');
    if (!Number.isSafeInteger(cfg.random_seed) || cfg.random_seed < 1 || cfg.random_seed > 2147483647) fail('SCHEMA_INVALID', 'Seed must be 1..2147483647');
    if (cfg.currency !== 'USD' || cfg.base_calendar !== 'XNYS') fail('TYPE_MISMATCH', 'Only USD / XNYS daily sessions are supported');
    if (!['descriptive', 'conditional', 'strategy', 'forecast'].includes(cfg.mode)) fail('MODE_INVALID', 'Unknown experiment family');
    if (cfg.mode === 'forecast') fail('CALIBRATION_REQUIRED', 'Probability forecasts require a frozen PIT model and independent calibration; none is registered');
    if (graph.viewport != null) {
      keys(graph.viewport, ['x', 'y', 'zoom'], 'viewport');
      for (const [k, v] of Object.entries(graph.viewport)) if (!Number.isFinite(v) || Math.abs(v) > 10000 || (k === 'zoom' && (v < 0.3 || v > 2))) fail('SCHEMA_INVALID', 'Invalid canvas viewport');
    }
    const nodes = new Map(), definitions = new Map(), incoming = new Map(), outgoing = new Map();
    for (const node of graph.nodes) {
      keys(node, ['id', 'type', 'version', 'params', 'position'], 'node');
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(node.id || '') || nodes.has(node.id)) fail('DUPLICATE_NODE', 'Node IDs must be unique and safe');
      const def = blocks.find(b => b.key === node.type && b.version === node.version);
      if (!def) fail('UNKNOWN_BLOCK', 'Unknown block/version ' + node.type + '@' + node.version);
      if (!def.ready) fail('ADAPTER_UNAVAILABLE', def.label + ': ' + def.reason);
      if (def.modes && !def.modes.includes(cfg.mode)) fail('MODE_INVALID', def.label + ' does not support ' + cfg.mode);
      keys(node.params, Object.keys(def.params_schema.properties), def.label + ' parameters');
      for (const [k, p] of Object.entries(def.params_schema.properties)) {
        const v = node.params[k];
        if (p.type === 'string' ? typeof v !== 'string' || (p.enum ? !p.enum.includes(v) : v.length < p.minLength || v.length > p.maxLength || !new RegExp(p.pattern).test(v)) : !Number.isFinite(v) || (p.type === 'integer' && !Number.isSafeInteger(v)) || v < p.minimum || v > p.maximum) fail('PARAM_INVALID', def.label + ': invalid ' + k);
      }
      if (node.type === 'logic.event_window' && node.params.start_session > node.params.end_session) fail('PARAM_INVALID', 'Event-window start must not follow its end');
      if (node.position) {
        keys(node.position, ['x', 'y'], 'position');
        if (![node.position.x, node.position.y].every(v => Number.isFinite(v) && v >= 0 && v <= 5000)) fail('PARAM_INVALID', 'Invalid node position');
      }
      nodes.set(node.id, node); definitions.set(node.id, def); incoming.set(node.id, []); outgoing.set(node.id, []);
    }
    const targets = new Set();
    for (const edge of graph.edges) {
      keys(edge, ['from', 'to'], 'edge');
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string') fail('PORT_INVALID', 'Named ports required');
      const [a, ap, ax] = edge.from.split('.'), [b, bp, bx] = edge.to.split('.');
      const from = definitions.get(a)?.outputs.find(p => p.name === ap), to = definitions.get(b)?.inputs.find(p => p.name === bp);
      if (ax || bx || !from || !to) fail('PORT_INVALID', 'Unknown port ' + edge.from + ' -> ' + edge.to);
      if (!compatible(from, to)) fail('TYPE_MISMATCH', edge.from + ' and ' + edge.to + ' have incompatible types or units');
      if (targets.has(edge.to)) fail('MULTIPLE_INPUT', 'Only one connection may feed ' + edge.to);
      targets.add(edge.to); incoming.get(b).push(a); outgoing.get(a).push(b);
    }
    const degrees = new Map([...incoming].map(([id, xs]) => [id, xs.length])), order = [];
    const ready = [...nodes.keys()].filter(id => !degrees.get(id)).sort();
    while (ready.length) {
      const id = ready.shift(); order.push(id);
      for (const next of outgoing.get(id)) { degrees.set(next, degrees.get(next) - 1); if (!degrees.get(next)) { ready.push(next); ready.sort(); } }
    }
    if (order.length !== nodes.size) fail('GRAPH_CYCLE', 'Connections form a cycle');
    for (const [id, def] of definitions) for (const p of def.inputs) if (!p.optional && !targets.has(id + '.' + p.name)) fail('MISSING_INPUT', id + '.' + p.name + ' needs a connection');
    const sinks = graph.nodes.filter(n => n.type === 'output.report');
    if (sinks.length !== 1) fail('OUTPUT_REQUIRED', 'Connect exactly one Research report block');
    const used = new Set();
    const walk = id => { if (!used.has(id)) { used.add(id); incoming.get(id).forEach(walk); } }; walk(sinks[0].id);
    if (used.size !== nodes.size) fail('REDUNDANT_NODE', 'Remove blocks that do not feed the report');
    return { order, output_node: sinks[0].id };
  }
  function validatePlan(plan) {
    keys(plan, ['schema', 'target', 'universe', 'discovery', 'holdout', 'horizon_sessions', 'embargo_sessions',
      'benchmark', 'costs', 'max_trials', 'min_events', 'bootstrap_samples', 'execution', 'primary_metric'], 'evaluation plan');
    if (plan.schema !== 'mingstreet.evaluation-plan.v2') fail('SCHEMA_VERSION', 'Unsupported evaluation plan');
    if (!['forward_return', 'benchmark_relative_return'].includes(plan.target) || plan.execution !== 'next_open' || plan.primary_metric !== 'mean_excess_return') fail('PLAN_INVALID', 'Unsupported target, execution or primary metric');
    if (!Array.isArray(plan.universe) || !plan.universe.length || plan.universe.length > LIMITS.assets || new Set(plan.universe).size !== plan.universe.length || !plan.universe.every(x => /^[A-Z][A-Z0-9.]{0,5}$/.test(x))) fail('PLAN_INVALID', 'Invalid universe');
    if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(plan.benchmark || '')) fail('PLAN_INVALID', 'Benchmark is required');
    for (const key of ['discovery', 'holdout']) if (!Array.isArray(plan[key]) || plan[key].length !== 2 || !plan[key].every(x => /^\d{4}-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x) || plan[key][0] >= plan[key][1]) fail('PLAN_INVALID', 'Invalid ' + key + ' dates');
    if (plan.discovery[1] >= plan.holdout[0]) fail('HOLDOUT_OVERLAP', 'Discovery and holdout must be distinct and ordered');
    for (const [k, lo, hi] of [['horizon_sessions', 1, 60], ['embargo_sessions', 2, 120], ['max_trials', 1, 100], ['min_events', 5, 500], ['bootstrap_samples', 100, 1000]]) if (!Number.isSafeInteger(plan[k]) || plan[k] < lo || plan[k] > hi) fail('PLAN_INVALID', 'Invalid ' + k);
    if (plan.embargo_sessions < plan.horizon_sessions + 1) fail('LABEL_OVERLAP', 'Embargo must cover the outcome horizon plus next-open delay');
    keys(plan.costs, ['commission_bps', 'slippage_bps'], 'costs');
    for (const v of Object.values(plan.costs)) if (!Number.isFinite(v) || v < 0 || v > 500) fail('COST_INVALID', 'Costs must be 0..500 basis points per side');
    if (Object.keys(plan.costs).length !== 2) fail('COST_INVALID', 'Commission and slippage are required');
    return plan;
  }
  function template(kind = 'breadth') {
    const make = (id, type, x, y, params) => ({ id, type, version: type === 'output.report' ? '1.1.0' : VERSION, params: params || defaults(type), position: { x, y } });
    const graph = { schema_version: '1.0', name: 'Oversold plus sample breadth', nodes: [make('prices', 'market.prices', 40, 110)], edges: [],
      research_config: { snapshot_id: '', as_of: new Date().toISOString(), random_seed: 101, currency: 'USD', base_calendar: 'XNYS', mode: 'descriptive' }, viewport: { x: 0, y: 0, zoom: 0.85 } };
    const edge = (from, to) => graph.edges.push({ from, to });
    if (['stress', 'reverse', 'sensitivity', 'monte_carlo'].includes(kind)) {
      graph.name = { stress: 'Price-target stress test', reverse: 'Reverse valuation scenario', sensitivity: 'Valuation sensitivity', monte_carlo: 'Conditional paths' }[kind];
      graph.research_config.mode = 'conditional'; graph.nodes.push(make('scenario', 'scenario.' + kind, 340, 110), make('report', 'output.report', 640, 110));
      edge('prices.prices', 'scenario.prices'); edge('scenario.result', 'report.result');
    } else {
      graph.nodes.push(make('shock', 'signal.shock', 330, 35)); edge('prices.prices', 'shock.prices');
      let source = 'shock.events';
      if (kind === 'breadth') {
        graph.nodes.push(make('breadth', 'signal.breadth', 330, 270), make('both', 'logic.and', 630, 110));
        edge('prices.prices', 'breadth.prices'); edge(source, 'both.a'); edge('breadth.events', 'both.b'); source = 'both.events';
      }
      graph.nodes.push(make('study', 'study.forward', kind === 'breadth' ? 930 : 630, 110), make('report', 'output.report', kind === 'breadth' ? 1230 : 930, 110));
      edge('prices.prices', 'study.prices'); edge(source, 'study.events'); edge('study.result', 'report.result');
      if (kind === 'forward') { graph.name = 'Forward-return study'; graph.nodes.find(n => n.id === 'shock').params.threshold_pct = 0; }
      if (kind === 'conditional') graph.name = 'Conditional signal test';
      if (kind === 'strategy') { graph.name = 'Exploratory equity strategy'; graph.research_config.mode = 'strategy'; }
      if (kind === 'factor') { graph.name = 'Factor-neutral strategy backtest'; graph.nodes.find(n => n.id === 'shock').type = 'strategy.factor_neutral'; }
      if (kind === 'earnings') { graph.name = 'Earnings-event peer spillover'; graph.nodes.find(n => n.id === 'shock').type = 'data.events'; }
    }
    return graph;
  }
  return { VERSION, LIMITS, blocks, defaults, compatible, validateGraph, validatePlan, template, fail, keys, text };
}

export const contracts = researchContractsFactory();

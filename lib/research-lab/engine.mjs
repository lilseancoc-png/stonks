import { computeStreakForTicker } from '../streaks.mjs';
import { contracts } from './contracts.mjs';
import { closeKnownAt, openAt } from './adapters.mjs';
import { mean, quantile, random, clusteredInterval } from './statistics.mjs';

const key = r => r.asset + '|' + r.date;
const lastKnown = bars => {
  const known = bars.map(b => b.available_at).filter(Boolean);
  return known.length === bars.length ? known.sort().at(-1) : null;
};
const eventOf = (asset, b, value = true, history = [b]) => ({ asset, date: b.date, value, known_at: lastKnown(history), decision_at: closeKnownAt(b.date) });
const check = ctx => { if (ctx.deadline && Date.now() > ctx.deadline) contracts.fail('TIMED_OUT', 'Node exceeded its execution deadline'); };

function features(prices, fn, ctx) {
  const out = [];
  for (const [asset, { bars }] of Object.entries(prices.assets)) for (let i = 0; i < bars.length; i++) {
    if (i % 40 === 0) check(ctx);
    const row = fn(asset, bars, i); if (row) out.push(row);
  }
  return out;
}
function aggregate(rows, plan, seed) {
  const chosen = rows.filter(r => r.selected), xs = chosen.map(r => r.net_excess);
  const interval = clusteredInterval(chosen, 'net_excess', seed, plan.bootstrap_samples, plan.horizon_sessions + 1);
  return { observations: rows.length, events: chosen.length, mean_gross_return: mean(chosen.map(r => r.gross_return)),
    mean_net_return: mean(chosen.map(r => r.net_return)), mean_baseline_return: mean(chosen.map(r => r.baseline_return)),
    mean_excess_return: mean(xs), positive_fraction: xs.length ? xs.filter(v => v > 0).length / xs.length : null,
    uncertainty: interval, cost_sensitivity: [0, 1, 2].map(multiplier => ({ multiplier,
      mean_net_return: mean(chosen.map(r => r.gross_return - r.cost * multiplier)),
      mean_excess_return: mean(chosen.map(r => r.gross_return - r.baseline_return - r.cost * multiplier)) })) };
}
function study(prices, events, ctx) {
  const { plan, stage, seed, mode } = ctx, bounds = stage === 'final' ? plan.holdout : plan.discovery;
  const selected = new Map(events.filter(r => r.value).map(r => [key(r), r])), rows = [], skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const benchmark = new Map(prices.assets[plan.benchmark].bars.map(b => [b.date, b]));
  for (const asset of plan.universe) {
    const bars = prices.assets[asset].bars;
    for (let i = 0; i < bars.length; i++) {
      if (i % 40 === 0) check(ctx);
      const b = bars[i]; if (b.date < bounds[0] || b.date > bounds[1]) continue;
      const entry = bars[i + 1], exit = bars[i + 1 + plan.horizon_sessions];
      if (!entry || !exit || exit.date > bounds[1]) { skip('purged_labels_outside_split'); continue; }
      const path = bars.slice(i + 1, i + 2 + plan.horizon_sessions);
      // Sparse assets must have the same observed session calendar as the benchmark.
      const benchDates = prices.assets[plan.benchmark].bars.filter(x => x.date >= entry.date && x.date <= exit.date).map(x => x.date);
      if (path.length !== benchDates.length || path.some((x, j) => x.date !== benchDates[j])) { skip('missing_session_alignment'); continue; }
      if (path.some(x => !(x.open > 0) || !Number.isFinite(x.open) || !(x.volume > 0))) { skip('untradable_or_missing_open_volume'); continue; }
      const be = benchmark.get(entry.date), bx = benchmark.get(exit.date);
      if (!(be?.open > 0) || !(bx?.open > 0) || !(be.volume > 0) || !(bx.volume > 0)) { skip('missing_benchmark_quote'); continue; }
      const event = selected.get(asset + '|' + b.date);
      if (event && ((event.known_at && event.known_at > openAt(entry.date)) || event.decision_at >= openAt(entry.date))) contracts.fail('TEMPORAL_LEAKAGE', asset + ' ' + b.date + ': feature was not known before next-open execution');
      if (event && b.tradable_at && b.tradable_at > openAt(entry.date)) contracts.fail('TEMPORAL_LEAKAGE', 'Source tradability is later than the modeled order');
      const gross = exit.open / entry.open - 1, baseline = plan.target === 'benchmark_relative_return' ? bx.open / be.open - 1 : 0;
      const cost = 2 * (plan.costs.commission_bps + plan.costs.slippage_bps) / 10000;
      rows.push({ asset, date: b.date, entry_date: entry.date, exit_date: exit.date, selected: !!event, gross_return: gross,
        net_return: gross - cost, baseline_return: baseline, cost, net_excess: gross - baseline - cost,
        contribution: event ? gross - baseline - cost : 0 });
    }
  }
  const summary = aggregate(rows, plan, seed), warnings = [];
  if (summary.events < plan.min_events) warnings.push('INSUFFICIENT_SAMPLE: event count below the preregistered minimum.');
  if (summary.uncertainty.low === null) warnings.push('UNCERTAINTY_UNAVAILABLE: insufficient independent date blocks or issuers.');
  warnings.push('ASSOCIATION_ONLY: same-date benchmark controls market drift, not sector/factor confounding or causality.',
    'OVERLAPPING_EVENTS: date-block and issuer bootstrap accounts for dependence approximately; intervals are not a multiple-testing correction.');
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const walk_forward = Array.from({ length: 3 }, (_, index) => {
    const slice = dates.slice(Math.floor(index * dates.length / 3), Math.floor((index + 1) * dates.length / 3));
    const bounded = rows.filter(r => slice.includes(r.date) && r.exit_date <= slice.at(-1));
    return { start: slice[0] || null, end: slice.at(-1) || null, ...aggregate(bounded, plan, seed + index + 1) };
  });
  const regimes = ['negative', 'positive'].map(label => ({ label, ...aggregate(rows.filter(r => label === 'positive' ? r.baseline_return >= 0 : r.baseline_return < 0), plan, seed) }));
  const result = { kind: mode === 'strategy' ? 'modeled_equity_strategy' : 'descriptive_event_study', stage, bounds, target: plan.target,
    horizon_sessions: plan.horizon_sessions, execution: 'signal_after_close_entry_next_open_exit_open_after_horizon',
    summary, rows, skipped, walk_forward, walk_forward_policy: 'fixed_spec_time_slices_no_training_or_selection; labels purged within slices',
    regime_slices: regimes, regime_policy: 'ex_post_benchmark_outcome_slices_descriptive_only',
    issuer_slices: plan.universe.map(asset => ({ asset, ...aggregate(rows.filter(r => r.asset === asset), plan, seed) })), warnings };
  const trials = ctx.trial_count || 1;
  result.multiplicity = { registered_family_attempts: trials, method: 'bonferroni_familywise_alpha_at_registration', alpha: 0.05 / trials,
    adjusted_interval: clusteredInterval(rows.filter(r => r.selected), 'net_excess', seed, plan.bootstrap_samples, plan.horizon_sessions + 1, 0.05 / trials),
    warning: 'Bounded bootstrap draws give coarse tails for many trials. Later attempts increase selection risk; frozen earlier intervals are not retroactively corrected.' };
  if (mode === 'strategy') result.strategy = simulatePortfolio(rows, prices, plan, ctx);
  return result;
}
function simulatePortfolio(rows, prices, plan, ctx) {
  const weight = 1 / plan.universe.length, busyUntil = new Map(), trades = [];
  for (const row of rows.filter(r => r.selected).sort((a, b) => a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset))) {
    if ((busyUntil.get(row.asset) || '') > row.entry_date) continue;
    busyUntil.set(row.asset, row.exit_date); trades.push(row);
  }
  const bounds = ctx.stage === 'final' ? plan.holdout : plan.discovery;
  const dates = prices.assets[plan.benchmark].bars.map(b => b.date).filter(d => d >= bounds[0] && d <= bounds[1]);
  const slots = new Map(plan.universe.map(asset => [asset, { cash: weight, grossCash: weight, position: null }]));
  const entries = new Map(trades.map(r => [r.asset + '|' + r.entry_date, r]));
  const quotes = new Map(plan.universe.map(asset => [asset, new Map(prices.assets[asset].bars.map(b => [b.date, b.open]))]));
  let peak = 1, equity = 1, drawdown = 0, fees = 0, turnover = 0;
  const daily = [], curve = [];
  for (const date of dates) {
    check(ctx); const prior = equity;
    for (const asset of plan.universe) {
      const slot = slots.get(asset), price = quotes.get(asset).get(date);
      if (slot.position?.exit === date) {
        const value = slot.position.units * price, fee = value * slot.position.sideCost;
        slot.cash = value - fee; slot.grossCash = slot.position.grossUnits * price;
        fees += fee; turnover += value; slot.position = null;
      }
      const entry = entries.get(asset + '|' + date);
      if (entry && !slot.position && slot.cash > 0) {
        const sideCost = entry.cost / 2, notional = slot.cash / (1 + sideCost), fee = notional * sideCost;
        slot.position = { units: notional / price, grossUnits: slot.grossCash / price, exit: entry.exit_date, sideCost };
        slot.cash = 0; slot.grossCash = 0; fees += fee; turnover += notional;
      }
    }
    let grossEquity = 0, invested = 0; equity = 0;
    for (const [asset, slot] of slots) {
      const price = quotes.get(asset).get(date);
      const value = slot.position ? slot.position.units * price : 0;
      equity += slot.cash + value; invested += value;
      grossEquity += slot.grossCash + (slot.position ? slot.position.grossUnits * price : 0);
    }
    peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity / peak - 1);
    daily.push(prior > 0 ? equity / prior - 1 : 0);
    curve.push({ date, equity, gross_equity: grossEquity, exposure: equity > 0 ? invested / equity : 0 });
  }
  const m = mean(daily), sd = Math.sqrt(mean(daily.map(v => (v - m) ** 2)) || 0);
  return { net_return: equity - 1, gross_return: (curve.at(-1)?.gross_equity ?? 1) - 1,
    sharpe: sd > 0 ? m / sd * Math.sqrt(252) : null, max_drawdown: drawdown,
    turnover, mean_exposure: mean(curve.map(r => r.exposure)), transaction_cost: fees, trades: trades.length, curve,
    policy: 'self_financing_equal_initial_asset_slots_nonoverlapping_positions_reinvest_available_slot_cash_no_borrowing',
    caveats: 'Hypothetical adjusted-cache open prices; no verified corporate actions, bid/ask, capacity, borrow or broker fills.' };
}

function scenarios(prices, type, p, ctx) {
  const assets = ctx.plan.universe, rows = [], rng = random(ctx.seed);
  for (const asset of assets) {
    const spot = prices.assets[asset].bars.at(-1)?.close;
    if (!(spot > 0)) contracts.fail('DATA_UNAVAILABLE', 'No completed-session starting price');
    if (type === 'scenario.stress') rows.push({ asset, spot, shock_pct: p.shock_pct, conditional_price: spot * (1 + p.shock_pct / 100), horizon_sessions: p.horizon_sessions });
    if (type === 'scenario.reverse') rows.push({ asset, spot, target_price: p.target_price, required_eps_at_multiple: p.target_price / p.assumed_multiple,
      required_multiple_at_eps: p.target_price / p.assumed_eps, required_eps_change: p.target_price / p.assumed_multiple / p.assumed_eps - 1 });
    if (type === 'scenario.valuation') rows.push({ asset, spot, conditional_price: spot * (1 + p.revenue_change_pct / 100) * (1 + p.margin_change_pct / 100) * (1 + p.multiple_change_pct / 100), assumed_constant_shares: true });
    if (type === 'scenario.rates') rows.push({ asset, spot, conditional_price: spot * Math.exp(-p.assumed_duration_years * p.rate_change_bps / 10000), assumed_constant_duration: true });
    if (type === 'scenario.sensitivity') for (let i = -p.steps; i <= p.steps; i++) for (let j = -p.steps; j <= p.steps; j++) {
      const eps = p.assumed_eps * (1 + i * p.step_pct / 100), multiple = p.assumed_multiple * (1 + j * p.step_pct / 100);
      if (eps <= 0 || multiple <= 0) contracts.fail('ASSUMPTION_INVALID', 'Sensitivity grid requires positive EPS and multiple');
      rows.push({ asset, assumed_eps: eps, assumed_multiple: multiple, conditional_price: eps * multiple, return_from_spot: eps * multiple / spot - 1 });
    }
    if (type === 'scenario.monte_carlo') {
      const paths = Array.from({ length: p.paths }, () => spot), curve = [];
      for (let day = 1; day <= p.horizon_sessions; day++) {
        check(ctx);
        for (let i = 0; i < paths.length; i++) {
          const z = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
          paths[i] *= Math.exp((p.annual_drift - 0.5 * p.annual_volatility ** 2) / 252 + p.annual_volatility / Math.sqrt(252) * z);
        }
        curve.push({ session: day, p05: quantile(paths, 0.05), p50: quantile(paths, 0.5), p95: quantile(paths, 0.95) });
      }
      rows.push({ asset, spot, simulation_p05: quantile(paths, 0.05), simulation_median: quantile(paths, 0.5), simulation_p95: quantile(paths, 0.95), curve });
    }
  }
  return { kind: 'conditional_scenario', scenario_type: type, assumptions: p, rows,
    summary: { assets: assets.length, scenarios: rows.length }, warnings: ['CONDITIONAL_ONLY: assumes the stated shocks, valuation drivers or path model. No calibrated probability or likelihood is inferred.'] };
}
export function executeNode(node, inputs, ctx) {
  check(ctx); const p = node.params, type = node.type;
  if (type === 'data.site_evidence') return { evidence: { documents: ctx.evidence || [], role: 'current_context_not_historical_signal' } };
  if (type === 'market.prices') return { prices: { assets: Object.fromEntries(Object.entries(ctx.snapshot.assets).map(([s, a]) => [s, { bars: a.bars.filter(b => closeKnownAt(b.date) <= ctx.as_of) }])) } };
  if (type === 'signal.shock') return { events: features(inputs.prices, (asset, bars, i) => {
    if (i < p.lookback_sessions) return null;
    const change = (bars[i].close / bars[i - p.lookback_sessions].close - 1) * 100;
    return eventOf(asset, bars[i], p.direction === 'below' ? change <= p.threshold_pct : change >= p.threshold_pct, bars.slice(i - p.lookback_sessions, i + 1));
  }, ctx).filter(r => r.value) };
  if (type === 'signal.streak') return { events: features(inputs.prices, (asset, bars, i) => {
    const value = computeStreakForTicker(asset, bars.slice(0, i + 1).map(b => ({ t: b.date, c: b.close, v: b.volume })));
    return value?.current?.color === p.direction && value.current.sameDays >= p.min_days ? eventOf(asset, bars[i], true, bars.slice(Math.max(0, i - 60), i + 1)) : null;
  }, ctx) };
  if (type === 'signal.breadth') {
    const byDate = new Map();
    for (const asset of ctx.plan.universe) {
      const bars = inputs.prices.assets[asset].bars;
      for (let i = p.window - 1; i < bars.length; i++) {
        const xs = bars.slice(i + 1 - p.window, i + 1), date = bars[i].date;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({ asset, above: bars[i].close >= mean(xs.map(b => b.close)), known_at: lastKnown(xs), date });
      }
    }
    const events = [];
    for (const [date, records] of byDate) if (records.length === ctx.plan.universe.length && records.filter(r => r.above).length / records.length >= p.min_fraction) {
      const known = records.every(r => r.known_at) ? records.map(r => r.known_at).sort().at(-1) : null;
      for (const asset of ctx.plan.universe) events.push({ asset, date, value: true, known_at: known, decision_at: closeKnownAt(date) });
    }
    return { events };
  }
  if (type === 'transform.returns') return { series: features(inputs.prices, (asset, bars, i) => i < p.sessions ? null :
    eventOf(asset, bars[i], bars[i].close / bars[i - p.sessions].close - 1, bars.slice(i - p.sessions, i + 1)), ctx) };
  if (type === 'signal.regime') {
    const bars = inputs.prices.assets[ctx.plan.benchmark].bars, events = [];
    for (let i = p.lookback_sessions; i < bars.length; i++) {
      const positive = bars[i].close >= bars[i - p.lookback_sessions].close;
      if (positive === (p.direction === 'positive')) for (const asset of ctx.plan.universe) events.push(eventOf(asset, bars[i], true, bars.slice(i - p.lookback_sessions, i + 1)));
    }
    return { events };
  }
  if (type === 'logic.filter_universe') return { events: inputs.events.filter(r => p.symbols.split(',').includes(r.asset)) };
  if (type === 'logic.event_window') {
    const events = new Map();
    for (const event of inputs.events) {
      check(ctx); const bars = inputs.prices.assets[event.asset].bars, i = bars.findIndex(b => b.date === event.date);
      if (i < 0) continue;
      for (let offset = p.start_session; offset <= p.end_session; offset++) if (bars[i + offset]) {
        const row = { ...event, date: bars[i + offset].date, decision_at: closeKnownAt(bars[i + offset].date) }; events.set(key(row), row);
      }
    }
    return { events: [...events.values()] };
  }
  if (type === 'logic.rank') {
    const grouped = new Map(), rank = [];
    for (const r of inputs.series.filter(r => ctx.plan.universe.includes(r.asset))) { if (!grouped.has(r.date)) grouped.set(r.date, []); grouped.get(r.date).push(r); }
    for (const rows of grouped.values()) {
      if (rows.length !== ctx.plan.universe.length) continue;
      rows.sort((a, b) => a.value - b.value || a.asset.localeCompare(b.asset));
      const known_at = rows.every(r => r.known_at) ? rows.map(r => r.known_at).sort().at(-1) : null;
      for (const row of rows) { const lo = rows.filter(r => r.value < row.value).length, ties = rows.filter(r => r.value === row.value).length; rank.push({ ...row, known_at, value: (lo + (ties - 1) / 2) / Math.max(1, rows.length - 1) }); }
    }
    return { rank };
  }
  if (type === 'logic.rank_filter') return { events: inputs.rank.filter(r => r.value >= p.min_fraction).map(r => ({ ...r, value: true })) };
  if (type === 'transform.standardize') {
    const grouped = new Map(), standardized = [];
    for (const row of inputs.series) { if (!grouped.has(row.asset)) grouped.set(row.asset, []); grouped.get(row.asset).push(row); }
    for (const rows of grouped.values()) for (let i = p.window - 1; i < rows.length; i++) {
      const window = rows.slice(i + 1 - p.window, i + 1), m = mean(window.map(r => r.value)), sd = Math.sqrt(mean(window.map(r => (r.value - m) ** 2)));
      if (sd > 0) standardized.push({ ...rows[i], value: (rows[i].value - m) / sd, known_at: window.every(r => r.known_at) ? window.map(r => r.known_at).sort().at(-1) : null });
    }
    return { standardized };
  }
  if (type === 'logic.zthreshold') return { events: inputs.standardized.filter(r => p.direction === 'below' ? r.value <= p.threshold : r.value >= p.threshold).map(r => ({ ...r, value: true })) };
  if (['transform.rolling', 'transform.lag', 'transform.winsorize'].includes(type)) {
    const grouped = new Map(), output = [];
    for (const row of inputs.series) { if (!grouped.has(row.asset)) grouped.set(row.asset, []); grouped.get(row.asset).push(row); }
    for (const rows of grouped.values()) for (let i = 0; i < rows.length; i++) {
      check(ctx);
      if (type === 'transform.lag') { if (i >= p.sessions) output.push({ ...rows[i - p.sessions], date: rows[i].date, decision_at: rows[i].decision_at }); continue; }
      if (i < p.window - 1) continue;
      const window = rows.slice(i - p.window + 1, i + 1), xs = window.map(r => r.value), known_at = window.every(r => r.known_at) ? window.map(r => r.known_at).sort().at(-1) : null;
      const value = type === 'transform.rolling' ? mean(xs) : Math.max(quantile(xs, p.tail), Math.min(quantile(xs, 1 - p.tail), rows[i].value));
      output.push({ ...rows[i], value, known_at });
    }
    return { series: output };
  }
  if (type === 'logic.threshold') return { events: inputs.series.filter(r => p.direction === 'below' ? r.value <= p.threshold : r.value >= p.threshold).map(r => ({ ...r, value: true })) };
  if (type === 'logic.and' || type === 'logic.or') {
    const a = new Map(inputs.a.map(r => [key(r), r])), b = new Map(inputs.b.map(r => [key(r), r])), out = [];
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(k), y = b.get(k); if (type === 'logic.and' && (!x || !y)) continue;
      out.push({ ...(x || y), known_at: x && y ? (x.known_at && y.known_at ? [x.known_at, y.known_at].sort().at(-1) : null) : (x || y).known_at });
    }
    return { events: out.sort((a, b) => key(a).localeCompare(key(b))) };
  }
  if (type === 'study.forward') return { result: study(inputs.prices, inputs.events, ctx) };
  if (type.startsWith('scenario.')) return { result: scenarios(inputs.prices, type, p, ctx) };
  if (type === 'output.report') return { report: inputs.evidence ? { ...inputs.result, site_evidence: inputs.evidence } : inputs.result };
  contracts.fail('UNKNOWN_IMPLEMENTATION', 'No allowlisted implementation for ' + type);
}
export function runCompiled(compiled, snapshot, stage = 'discovery') {
  const outputs = {};
  for (const id of compiled.order) {
    const node = compiled.graph.nodes.find(n => n.id === id), inputs = {};
    for (const e of compiled.graph.edges.filter(e => e.to.startsWith(id + '.'))) { const [a, ap] = e.from.split('.'); inputs[e.to.split('.')[1]] = outputs[a][ap]; }
    outputs[id] = executeNode(node, inputs, { snapshot, plan: compiled.evaluation_plan, stage, seed: compiled.seed,
      mode: compiled.graph.research_config.mode, as_of: compiled.graph.research_config.as_of, trial_count: compiled.trial_count_at_registration || 1 });
  }
  return { outputs, result: outputs[compiled.output_node].report };
}

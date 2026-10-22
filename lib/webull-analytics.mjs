// Serialized into app.js as well as exercised directly by the analytics check.
// Inputs are filtered, ledger-to-record joins. No broker calls or stored state.
export function webullAnalyticsFactory() {
  function num(v) { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  function mean(v) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  function quantity(t) { const q = num(t.filledQty); return q > 0 ? q : 1; }
  function net(t) { const p = num(t.paperPnlPct), price = num(t.fillPrice); return p == null ? null : p - (price > 0 ? (num(t.fees) || 0) / (price * quantity(t)) : 0); }
  function dollars(t, model) {
    const open = num(model ? t.engineEntryPrice : t.fillPrice), close = num(model ? t.engineExitPrice : t.closeFillPrice);
    if (!(open > 0) || close == null || close < 0) return null;
    return (close - open) * (/credit/i.test(t.structure || '') ? -1 : 1) * 100 * quantity(t) - (model ? 0 : num(t.fees) || 0);
  }
  function direction(r) {
    const a = num(r && r.entrySpot), b = num(r && r.exitSpot);
    return a > 0 && b > 0 && (r.side === 'call' || r.side === 'put') ? (r.side === 'put' ? b < a : b > a) : null;
  }
  function analyze(rows, groupBy) {
    const closed = rows.filter(x => x.t.state === 'closed' && net(x.t) != null && !(num(x.t.openQty) > 0))
      .map(x => ({ ...x, pnl: net(x.t), usd: dollars(x.t, false), modelUsd: dollars(x.t, true), model: num(x.t.enginePnlPct), direction: direction(x.rec), date: x.t.closeFillIso || x.t.engineExitIso || null }))
      .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0) || String(a.t.tradeId).localeCompare(String(b.t.tradeId)));
    const money = closed.filter(x => x.usd != null), paired = money.filter(x => x.modelUsd != null);
    let cumulative = 0, peak = 0, worstDrawdown = 0, modelTotal = 0, matchedTotal = 0;
    const curve = [{ label: 'Start', paper: 0, drawdown: 0 }];
    money.forEach(x => { cumulative += x.usd; peak = Math.max(peak, cumulative); const drawdown = cumulative - peak; worstDrawdown = Math.min(worstDrawdown, drawdown); curve.push({ label: x.t.symbol + ' · ' + (x.date || 'date unavailable'), paper: cumulative, drawdown }); });
    const comparison = [{ label: 'Start', paper: 0, engine: 0 }];
    paired.forEach(x => { matchedTotal += x.usd; modelTotal += x.modelUsd; comparison.push({ label: x.t.symbol + ' · ' + (x.date || 'date unavailable'), paper: matchedTotal, engine: modelTotal }); });
    let paperReturn = 0, spyReturn = 0;
    const benchmarkPairs = closed.filter(x => x.spy && x.spy.exitDate && num(x.spy.optionPnlPct) != null);
    const benchmark = [{ label: 'Start', paper: 0, spy: 0 }];
    benchmarkPairs.forEach(x => { paperReturn += x.pnl; spyReturn += num(x.spy.optionPnlPct); benchmark.push({ label: x.t.symbol + ' · ' + (x.date || 'date unavailable'), paper: paperReturn, spy: spyReturn }); });
    const returns = closed.map(x => x.pnl), wins = returns.filter(v => v > 0).length;
    const gains = money.filter(x => x.usd > 0).reduce((s, x) => s + x.usd, 0), losses = -money.filter(x => x.usd < 0).reduce((s, x) => s + x.usd, 0);
    const directional = closed.filter(x => x.direction != null);
    const trend = closed.map((x, i) => {
      const window = closed.slice(Math.max(0, i - 19), i + 1), d = window.filter(v => v.direction != null);
      return { label: x.t.symbol + ' · ' + (x.date || 'date unavailable') + ' · ' + window.length + ' trades', win: window.filter(v => v.pnl > 0).length / window.length * 100, direction: d.length ? d.filter(v => v.direction).length / d.length * 100 : null };
    });
    const hist = [
      { label: 'Below −50%', lo: -Infinity, hi: -50 }, { label: '−50 to −20%', lo: -50, hi: -20 },
      { label: '−20 to 0%', lo: -20, hi: 0 }, { label: '0 to 20%', lo: 0, hi: 20 },
      { label: '20 to 50%', lo: 20, hi: 50 }, { label: '50% and up', lo: 50, hi: Infinity },
    ].map(b => ({ label: b.label, value: returns.filter(v => v >= b.lo && v < b.hi).length, cls: b.hi <= 0 ? 'negative' : 'positive' }));
    const group = {};
    closed.forEach(x => {
      const r = x.rec || {}, t = x.t;
      const k = groupBy === 'grade' ? r.thesis && r.thesis.aiGrade || 'No AI grade' : groupBy === 'sector' ? r.sector || 'Unknown sector' : groupBy === 'regime' ? r.entryRegime || 'Unknown regime' : groupBy === 'tier' ? r.label || r.tier || 'Unknown tier' : groupBy === 'side' ? t.side === 'put' ? 'Puts' : 'Calls' : groupBy === 'run' ? (!Number.isFinite(Date.parse(t.engineEntryIso)) ? 'Unknown run' : new Date(t.engineEntryIso).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }) < 13 ? '11:00 ET' : '15:30 ET') : t.structure === 'long' ? 'Single option' : /credit/.test(t.structure || '') ? 'Credit spread' : 'Debit spread';
      (group[k] || (group[k] = [])).push(x);
    });
    const groups = Object.keys(group).map(label => { const xs = group[label], models = xs.filter(x => x.model != null); return { label, n: xs.length, value: xs.filter(x => x.pnl > 0).length / xs.length * 100, avg: mean(xs.map(x => x.pnl)), model: mean(models.map(x => x.model)), modelN: models.length }; }).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    const calibration = [{ label: 'Under 40%', lo: 0, hi: 40 }, { label: '40–55%', lo: 40, hi: 55 }, { label: '55–70%', lo: 55, hi: 70 }, { label: '70% and up', lo: 70, hi: 101 }].map(b => {
      const xs = closed.map(x => { let p = num(x.rec && x.rec.contract && x.rec.contract.pop); if (p != null && p <= 1) p *= 100; return { p, win: x.pnl > 0 }; }).filter(x => x.p != null && x.p >= b.lo && x.p < b.hi && x.p <= 100);
      return { label: b.label, n: xs.length, predicted: mean(xs.map(x => x.p)), actual: xs.length ? xs.filter(x => x.win).length / xs.length * 100 : null };
    });
    const states = [ ['Waiting for entry', ['entering']], ['Open / closing', ['open', 'exiting']], ['Closed', ['closed']], ['Missed / skipped', ['missed', 'skipped']], ['Settlement / review', ['settled', 'settlement-pending', 'error']] ];
    const knownStates = states.flatMap(s => s[1]);
    const execution = states.map(s => ({ label: s[0], value: rows.filter(x => s[1].includes(x.t.state)).length }));
    execution.push({ label: 'Other state', value: rows.filter(x => !knownStates.includes(x.t.state)).length });
    const slippage = rows.filter(x => num(x.t.entryDiffPct) != null || num(x.t.exitDiffPct) != null).slice().sort((a, b) => (Date.parse(a.t.engineEntryIso) || 0) - (Date.parse(b.t.engineEntryIso) || 0)).map(x => { const credit = /credit/i.test(x.t.structure || ''), a = num(x.t.entryDiffPct), b = num(x.t.exitDiffPct); return { label: x.t.symbol + ' · ' + (x.t.engineEntryIso || 'date unavailable'), entry: a == null ? null : credit ? -a : a, exit: b == null ? null : credit ? b : -b }; });
    const modelPairs = closed.filter(x => x.model != null);
    const errors = modelPairs.map(x => x.pnl - x.model);
    return { closed, money, paired, curve, comparison, benchmark, trend, hist, groups, calibration, execution, slippage, stats: {
      total: rows.length, n: closed.length, recordN: closed.filter(x => x.rec).length, moneyN: money.length, pairedN: paired.length, benchmarkN: benchmarkPairs.length, pnl: money.length ? cumulative : null,
      drawdown: money.length ? worstDrawdown : null, expectancy: mean(money.map(x => x.usd)), winRate: returns.length ? wins / returns.length * 100 : null,
      profitFactor: losses ? gains / losses : null, noLosses: money.length > 0 && losses === 0 && gains > 0,
      direction: directional.length ? directional.filter(x => x.direction).length / directional.length * 100 : null, directionN: directional.length,
      modelN: errors.length, bias: mean(errors), mae: mean(errors.map(Math.abs)), within: errors.length ? errors.filter(v => Math.abs(v) <= 5).length / errors.length * 100 : null,
      unknownFees: closed.filter(x => num(x.t.fees) == null).length,
    } };
  }
  return { analyze, net, dollars, quantity };
}

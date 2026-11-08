// "Why no picks today" (2026-11-06): the five names that came closest to a
// Top Pick in the last run and the rule that stopped each, read from the
// run's own gate trace (picks.json rosterMeta.turnedAway). When fewer than
// five names reached the scoring bar, the rest come from grades.json: the
// strongest scores below the bar. No AI, no new data.
//
// One label per rule: the Owner Top Picks card, the Track Record's
// "What each open-pick rule turned away" table, the Week recap and the MCP
// tool get_near_misses all read GATE_LABEL from here.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function noPicksFactory() {
  var GATE_LABEL = {
    'opened': 'Opened on the Track Record', 'book-full': 'Picked, but the 20-trade book was full',
    'losing-streak-bar': 'Losing-streak bar (needs 8+)', 'below-strong': 'Score below 7',
    'confluence': 'Fewer than 2 pillars agree', 'no-ai-slot': 'No AI review slot',
    'ai-reject': 'AI rejected', 'ai-not-strong': 'AI grade not strong', 'thesis-not-strong': 'Thesis not strong (no AI grade)',
    'ai-wait': 'AI said wait', 'timing-checks': 'Entry timing checks', 'avoid-timing': 'Avoid timing (knife or chase)',
    'scenario': 'Market scenario gate', 'slots-full': 'Top Picks slots full', 'no-contract': 'No tradeable contract',
    'collateral-stress': 'Pledged-stock collateral stress near an estimated threshold',
    'pending-buyout': 'Signed takeover target (price pinned to the deal)',
    'macro-conflict': 'Fights the macro backdrop (rates, credit, cycle)',
    'option-economics': 'Option target does not support the profit exit after quote costs',
    'sector-cap': 'Sector cap', 'factor-cap': 'Factor cap', 'factor-run-cap': 'Same-group limit (2 new per run)', 'factor-trend': 'Weak factor trend', 'side-cap': 'Call / put cap',
    'event-cap': 'Event-trade limit reached', 'below-bar': 'Score below the bar'
  };
  // What it would take to get through, in plain words.
  var GATE_NEXT = {
    'book-full': 'A slot opens when one of the 20 record trades closes.',
    'losing-streak-bar': 'While the record is on a losing streak a pick needs a score of 8 or more.',
    'below-strong': 'A pick needs a score of 7 or more.',
    'confluence': 'At least 2 of the 4 pillars have to point its way.',
    'no-ai-slot': 'Only the 6 highest scores get the AI review each run.',
    'ai-reject': 'The AI review read the case as weak this run.',
    'ai-not-strong': 'It needs a strong grade from the AI review.',
    'thesis-not-strong': 'It needs a strong thesis.',
    'ai-wait': 'The AI review wants a better entry; it looks again next run.',
    'timing-checks': 'It waits for a cleaner entry price.',
    'avoid-timing': 'It is falling hard or has run too far; it waits for the move to settle.',
    'scenario': 'The market check is holding this side back for now.',
    'slots-full': 'Every Top Picks slot is taken this run.',
    'no-contract': 'No option had enough trading and a tight enough spread.',
    'collateral-stress': 'Pledged shares near a lender threshold block new bullish picks.',
    'pending-buyout': 'A signed takeover pins the price to the deal.',
    'macro-conflict': 'Its macro fit points 0.5 or more against the trade; it clears when the rates, credit or rotation read turns.',
    'option-economics': 'After the bid/ask cost the option cannot reach the profit target.',
    'sector-cap': 'Its sector already holds the most picks allowed.',
    'factor-cap': 'Its factor group already holds the most picks allowed.',
    'factor-run-cap': 'Two names from its group already opened this run.',
    'factor-trend': 'Its factor group has been trending the wrong way.',
    'side-cap': 'The book already holds the most calls or puts allowed.',
    'event-cap': 'The limit on event trades is reached for now.'
  };
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  // A pick ready to buy now; callers pass the site's own rule
  // (pickDisplayDecision in lib/research-display.mjs) as opts.isReady.
  function ready(p) {
    return !!p && p.group === 'actionable' && !!p.entry && p.entry.now === true;
  }
  // picks: picks.json; grades: grades.json (optional); opts: { n (default 5,
  // max 20), isReady }. Returns { builtAtIso, readyCount, listed, bar,
  // misses: [{ symbol, side, score, gate, label, next, source }],
  // gates: [{ gate, label, n }], traced }.
  function nearMisses(picks, grades, opts) {
    picks = picks || {};
    opts = opts || {};
    var n = Math.max(1, Math.min(20, Number(opts.n) || 5));
    var isReady = typeof opts.isReady === 'function' ? opts.isReady : ready;
    var rm = picks.rosterMeta || {};
    var list = Array.isArray(picks.picks) ? picks.picks : [];
    var readyCount = 0;
    for (var i = 0; i < list.length; i++) if (isReady(list[i])) readyCount++;
    var bar = num(rm.minConviction) || num(rm.tradeCut) || 4;
    var seen = {}, rows = [], counts = {};
    var trace = Array.isArray(rm.turnedAway) ? rm.turnedAway : [];
    for (i = 0; i < trace.length; i++) {
      var t = trace[i];
      if (!t || !t.sym || !t.gate) continue;
      var key = t.sym + ':' + (t.side === 'put' ? 'put' : 'call');
      if (t.gate === 'picked') { seen[key] = 1; continue; }
      counts[t.gate] = (counts[t.gate] || 0) + 1;
      if (seen[key]) continue;
      seen[key] = 1;
      rows.push({ symbol: t.sym, side: t.side === 'put' ? 'put' : 'call', score: num(t.total), gate: t.gate,
        label: GATE_LABEL[t.gate] || t.gate, next: GATE_NEXT[t.gate] || '', source: 'run' });
    }
    rows.sort(function (a, b) { return Math.abs(b.score || 0) - Math.abs(a.score || 0); });
    rows = rows.slice(0, n);
    // Fewer than n names reached the bar: the strongest scores under it.
    if (rows.length < n && grades && grades.grades && typeof grades.grades === 'object') {
      var below = [];
      var g = grades.grades;
      for (var sym in g) {
        if (!Object.prototype.hasOwnProperty.call(g, sym)) continue;
        var r = g[sym] || {};
        var tot = num(r.total);
        if (tot == null || tot === 0) continue;
        var side = tot < 0 ? 'put' : 'call';
        if (seen[sym + ':' + side]) continue;
        if (Math.abs(tot) >= bar) continue;
        below.push({ symbol: r.symbol || sym, side: side, score: tot, gate: 'below-bar', label: GATE_LABEL['below-bar'],
          next: 'A name has to score ' + bar + ' or more (either way) before the other rules look at it.', source: 'grades' });
      }
      below.sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score); });
      rows = rows.concat(below.slice(0, n - rows.length));
    }
    var gates = Object.keys(counts).map(function (k) { return { gate: k, label: GATE_LABEL[k] || k, n: counts[k] }; })
      .sort(function (a, b) { return b.n - a.n || (a.gate < b.gate ? -1 : 1); });
    return { builtAtIso: picks.builtAtIso || picks.generatedAt || null, readyCount: readyCount, listed: list.length, bar: bar, misses: rows, gates: gates, traced: trace.length > 0 };
  }
  return { GATE_LABEL: GATE_LABEL, GATE_NEXT: GATE_NEXT, nearMisses: nearMisses };
}

// Shared by the build and filtered Track Record reports. Keep calculations identical.
function pnum(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }
const PICKS_BASELINE_SYMBOL = "SPY";

export function computePicksAccuracyStats(open, closed, builtAtIso, spyBars = null) {
  const decided = (closed || []).filter((c) => c && (c.outcome === "win" || c.outcome === "loss"));
  const wins = decided.filter((c) => c.outcome === "win").length;
  const losses = decided.length - wins;
  // Explicit != null before pnum(): pnum(null) is 0 (Number(null) === 0), so a
  // bare pnum() filter let null-P&L rows through as break-even 0% "wins".
  const optDecided = decided.filter((c) => c.optionPnlPct != null && pnum(c.optionPnlPct) != null);
  const optWins = optDecided.filter((c) => Number(c.optionPnlPct) > 0).length;
  // Real-fill lens (entries since 2026-10-21 carry entry bid/ask): ask in, bid
  // out, from the chain each Top Picks run already fetches.
  const realDecided = decided.filter((c) => c.realFillPnlPct != null && pnum(c.realFillPnlPct) != null);
  // "At trigger": a resting order exactly at the +TP / -stop level instead of
  // the twice-daily mark the close was booked at.
  const atTrigger = (c) => (c.exitDetail && c.exitDetail.atTriggerPct != null ? c.exitDetail.atTriggerPct : c.optionPnlPct);
  const expect = (arr, f) => {
    const values = arr.map(f).filter(v => v != null && v !== '' && Number.isFinite(Number(v))).map(Number);
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  };
  const byKey = (keyFn) => {
    const m = Object.create(null);
    for (const c of decided) { const k = keyFn(c); if (k == null) continue; (m[k] ||= { wins: 0, n: 0 }); m[k].n++; if (c.outcome === "win") m[k].wins++; }
    for (const k of Object.keys(m)) m[k].winRate = m[k].n ? m[k].wins / m[k].n : null;
    return { ...m };
  };
  const openMarks = (open || []).filter((o) => o.optionPnlPct != null && pnum(o.optionPnlPct) != null);
  return {
    decided: decided.length, wins, losses, winRate: decided.length ? wins / decided.length : null,
    optionDecided: optDecided.length, optionWinRate: optDecided.length ? optWins / optDecided.length : null,
    optionExpectancyPct: r1(expect(optDecided, (c) => c.optionPnlPct)),
    atTriggerExpectancyPct: r1(expect(optDecided, atTrigger)),
    realFillDecided: realDecided.length,
    realFillWinRate: realDecided.length ? realDecided.filter((c) => Number(c.realFillPnlPct) > 0).length / realDecided.length : null,
    realFillExpectancyPct: r1(expect(realDecided, (c) => c.realFillPnlPct)),
    // The model P&L on the same trades, so the two can be compared like for like.
    realFillModelExpectancyPct: r1(expect(realDecided.filter((c) => c.optionPnlPct != null && pnum(c.optionPnlPct) != null), (c) => c.optionPnlPct)),
    flat: (closed || []).filter((c) => c && c.outcome === "flat").length,
    expectancyPct: r1(expect(decided, (c) => c.underlyingPnlPct)),
    avgMfePct: r1(expect(decided, (c) => c.mfePct)), avgMaePct: r1(expect(decided, (c) => c.maePct)),
    // Option (contract) peak/dip — the modeled high/low option P&L over each hold.
    avgOptHiPct: r1(expect(optDecided.filter((c) => c.optHiPct != null && pnum(c.optHiPct) != null), (c) => c.optHiPct)),
    avgOptLoPct: r1(expect(optDecided.filter((c) => c.optLoPct != null && pnum(c.optLoPct) != null), (c) => c.optLoPct)),
    openOptionN: openMarks.length, openOptionAvgPnlPct: r1(expect(openMarks, (o) => o.optionPnlPct)), openOptionUp: openMarks.filter((o) => Number(o.optionPnlPct) >= 0).length,
    byTier: byKey((c) => c.tier), bySector: byKey((c) => c.sector), byRegime: byKey((c) => c.entryRegime),
    // Entry-cohort A/B (go = enrolled on a clean buy-now, wait = a trigger-state
    // entry). Renders as the Track Record's "Gate A/B" panel (app-js cohortBlock
    // shows it once both arms have decided trades) and is THE read that
    // adjudicates whether buy-now endorsement earns its keep on resolved trades.
    byCohort: byKey((c) => c.cohort),
  };
}

// Compare only complete, finite price pairs from the retained trade sample.
export function computeBaselineStats(baseline, pickClosed) {
  const bOpen = Array.isArray(baseline?.open) ? baseline.open : [];
  const bClosed = Array.isArray(baseline?.closed) ? baseline.closed : [];
  if (!bOpen.length && !bClosed.length) return null;
  const st = computePicksAccuracyStats(bOpen, bClosed, null);
  const byPair = new Map(bClosed.map((b) => [b.pairKey, b]));
  const mean = (arr) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null);
  const pick = [], spy = [], pickReal = [], spyReal = [];
  for (const c of (pickClosed || [])) {
    if (!c || (c.outcome !== "win" && c.outcome !== "loss")) continue;
    const b = byPair.get(`${c.symbol}:${c.side}:${c.entryDate}`);
    if (!b || b.optionPnlPct == null || c.optionPnlPct == null || b.optionPnlPct === '' || c.optionPnlPct === '' ||
        !Number.isFinite(Number(b.optionPnlPct)) || !Number.isFinite(Number(c.optionPnlPct))) continue;
    pick.push(Number(c.optionPnlPct)); spy.push(Number(b.optionPnlPct));
    if (c.realFillPnlPct != null && b.realFillPnlPct != null && c.realFillPnlPct !== '' && b.realFillPnlPct !== '' &&
        Number.isFinite(Number(c.realFillPnlPct)) && Number.isFinite(Number(b.realFillPnlPct))) { pickReal.push(Number(c.realFillPnlPct)); spyReal.push(Number(b.realFillPnlPct)); }
  }
  const pickAvg = mean(pick), spyAvg = mean(spy), pickRealAvg = mean(pickReal), spyRealAvg = mean(spyReal);
  return {
    symbol: baseline?.symbol || PICKS_BASELINE_SYMBOL,
    open: bOpen.length, decided: st.decided, wins: st.wins, losses: st.losses, winRate: st.winRate,
    optionExpectancyPct: st.optionExpectancyPct, realFillDecided: st.realFillDecided, realFillExpectancyPct: st.realFillExpectancyPct,
    paired: {
      n: pick.length, pickAvgPct: r1(pickAvg), spyAvgPct: r1(spyAvg),
      edgePct: pickAvg != null && spyAvg != null ? r1(pickAvg - spyAvg) : null,
      realN: pickReal.length, pickRealAvgPct: r1(pickRealAvg), spyRealAvgPct: r1(spyRealAvg),
      realEdgePct: pickRealAvg != null && spyRealAvg != null ? r1(pickRealAvg - spyRealAvg) : null,
    },
  };
}

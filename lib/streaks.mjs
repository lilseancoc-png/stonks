import { buildStreakMaContext } from "./streak-ma-context.mjs";

// A counter day moves opposite the streak. The daily noise floor, one-day
// break bar, and cumulative tolerance bar adapt to each ticker's own recent
// median absolute move below. Four consecutive counter days remains a hard
// behavioral stop. Same-direction closes heal half the tolerance bank and
// one accumulated counter day, so old damage fades without resetting a
// fragile run to pristine in a single session. Tolerance only begins after
// two same-direction days; a one-day move followed by a reversal is not a
// streak worth defending.
const STREAK_CONSECUTIVE_COUNTER_BREAK = 4;
// How recently a genuine streak must have broken to be surfaced as a
// "just snapped" mean-reversion candidate (0 = snapped on the latest session).
const STREAK_SNAPPED_RECENT_SESSIONS = 2;

export function computeStreakForTicker(symbol, bars) {
  if (!bars || bars.length < 2) return null;
  // Cap at the most recent ~60 sessions so we don't carry decades of
  // history forward; the active streak is always recent by definition.
  const tail = bars.slice(-60);
  const rawMoves = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1];
    const curr = tail[i];
    if (!(prev?.c > 0) || !(curr?.c > 0)) continue;
    const changePct = ((curr.c - prev.c) / prev.c) * 100;
    // idx -> position in `tail` (for volume baseline lookup); volume -> the
    // session's share volume (used for the streak's volume-trend read).
    rawMoves.push({ idx: i, date: curr.t || curr.date || null, close: curr.c, volume: curr.v ?? null, changePct });
  }
  if (!rawMoves.length) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const recentAbs = rawMoves.slice(-20).map((m) => Math.abs(m.changePct));
  const medianAbsMove = median(recentAbs);
  // Ignore tape dust: a +0.03% close should not extend a streak. Scale the
  // dead-band and break bars to each ticker's own recent daily movement.
  const moveNoisePct = clamp(medianAbsMove * 0.20, 0.08, 0.35);
  const counterBreakPct = clamp(medianAbsMove * 1.75, 0.8, 2.5);
  const toleranceBreakPct = clamp(counterBreakPct * 1.25, 1.0, 3.0);
  const materialRunPct = Math.max(2, medianAbsMove * 3);
  const moves = rawMoves.map((m) => ({
    ...m,
    color: m.changePct > moveNoisePct
      ? "green"
      : m.changePct < -moveNoisePct
        ? "red"
        : "flat",
  }));

  // Measure volume against the baseline before THIS run, including ended
  // runs. A new reversal must never lend its volume to the run it snapped.
  const runVolume = (run) => {
    const avg = (values) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
    const startIdx = run.history[0].idx;
    const runAvg = avg(run.history.map((m) => m.volume).filter((v) => v > 0));
    const baseAvg = avg(tail.slice(Math.max(0, startIdx - 20), startIdx).map((b) => b.v).filter((v) => v > 0));
    const volumeRatio = runAvg != null && baseAvg > 0 ? runAvg / baseAvg : null;
    return {
      volumeRatio,
      volumeTrend: volumeRatio == null ? null : volumeRatio >= 1.15 ? "rising" : volumeRatio <= 0.85 ? "falling" : "flat",
    };
  };

  // Walk oldest -> newest, restarting the streak whenever a break fires.
  // Whatever streak survives to the end of the loop is the "current" one.
  let streak = null;
  // Rarity context — the longest GENUINE (>=2 same-direction days) green and
  // red run anywhere in the 60-session window, so the renderer can flag a
  // current run as "longest in 3mo" vs a routine length.
  let maxGreenDays = 0;
  let maxRedDays = 0;
  const recordMax = (s) => {
    if (!s || s.sameDays < 2) return;
    if (s.direction === "green") maxGreenDays = Math.max(maxGreenDays, s.sameDays);
    else if (s.direction === "red") maxRedDays = Math.max(maxRedDays, s.sameDays);
  };
  // The most-recently-ended genuine streak (a "snapped" run) — captured each
  // time a real streak breaks, surfaced at the end only if it broke within the
  // last few sessions. Powers the mean-reversion "Just snapped" view.
  let priorEnded = null;
  const startStreak = (m) => ({
    direction: m.color,
    days: 1,
    sameDays: 1,
    cumulativePct: m.changePct,
    growthFactor: 1 + m.changePct / 100,
    // Counter-day drag, partially healed by later same-direction closes.
    tolerancePct: 0,
    // Net counter-day pressure after partial healing.
    counterDays: 0,
    // Current trailing run of counter days -- only this resets on a
    // same-direction day. Used solely for the N-in-a-row break rule.
    consecutiveCounterDays: 0,
    history: [m],
  });
  for (const m of moves) {
    if (m.color === "flat") {
      // Flat days are neither same nor counter -- record them but don't
      // touch direction or the tolerance bank. They interrupt consecutive
      // counter sessions; their small return stays in the compounded result.
      if (streak) {
        streak.consecutiveCounterDays = 0;
        streak.days += 1;
        streak.growthFactor *= 1 + m.changePct / 100;
        streak.cumulativePct = (streak.growthFactor - 1) * 100;
        streak.history.push(m);
      }
      continue;
    }
    if (!streak) {
      streak = startStreak(m);
      continue;
    }
    if (m.color === streak.direction) {
      // Same-direction day extends the run and heals half of prior counter-day
      // damage. Old tiny pullbacks should not permanently poison a trend, but
      // a recently fragile run should not reset to pristine in one close.
      streak.sameDays += 1;
      streak.days += 1;
      streak.growthFactor *= 1 + m.changePct / 100;
      streak.cumulativePct = (streak.growthFactor - 1) * 100;
      streak.tolerancePct *= 0.5;
      streak.counterDays = Math.max(0, streak.counterDays - 1);
      streak.consecutiveCounterDays = 0;
      streak.history.push(m);
      continue;
    }
    // Counter-direction day. Tolerance only applies once the streak has
    // ≥ 2 same-direction days under its belt; a 1-day "streak" followed
    // by a counter just flips direction.
    if (streak.sameDays < 2) {
      recordMax(streak);
      streak = startStreak(m);
      continue;
    }
    const counterMag = Math.abs(m.changePct);
    const newTolerance = streak.tolerancePct + counterMag;
    const newCounterDays = streak.counterDays + 1;
    const newConsecutiveCounter = streak.consecutiveCounterDays + 1;
    const breakSingleDay = counterMag > counterBreakPct;
    const breakCumulative = newTolerance >= toleranceBreakPct;
    const breakConsecutive = newConsecutiveCounter >= STREAK_CONSECUTIVE_COUNTER_BREAK;
    if (breakSingleDay || breakCumulative || breakConsecutive) {
      recordMax(streak);
      // The dying streak passed the sameDays>=2 guard above, so it's a real
      // run worth remembering as a recent break. `endIdx` = the breaking
      // day's position in `tail`; recency is measured against it at the end.
      const ended = {
        ...runVolume(streak),
        tolerancePct: streak.tolerancePct,
        toleranceBreakPct,
        counterDays: streak.counterDays,
        consecutiveCounterDays: streak.consecutiveCounterDays,
        color: streak.direction,
        days: streak.sameDays,
        windowDays: streak.days,
        sameDays: streak.sameDays,
        cumulativePct: streak.cumulativePct,
        endIdx: m.idx,
        reversalPct: m.changePct,
        material: (
          streak.sameDays >= 3 &&
          (streak.sameDays >= 5 || Math.abs(streak.cumulativePct) >= materialRunPct) &&
          counterMag >= Math.max(moveNoisePct, counterBreakPct * 0.5)
        ),
        brokeBy: breakSingleDay ? "big counter day" : breakCumulative ? "tolerance bank" : "counter days",
      };
      if (ended.material) priorEnded = ended;
      streak = startStreak(m);
      continue;
    }
    // Tolerated: streak survives but logs the counter day's drag.
    streak.days += 1;
    streak.growthFactor *= 1 + m.changePct / 100;
    streak.cumulativePct = (streak.growthFactor - 1) * 100;
    streak.tolerancePct = newTolerance;
    streak.counterDays = newCounterDays;
    streak.consecutiveCounterDays = newConsecutiveCounter;
    streak.history.push(m);
  }
  if (!streak) return null;
  // Fold the surviving (current) streak into the rarity context too.
  recordMax(streak);

  const lastMove = streak.history[streak.history.length - 1];
  const lastIdx = lastMove?.idx;

  const { volumeRatio, volumeTrend } = runVolume(streak);

  // Surface the snapped streak only if it broke within the last few sessions
  // (sessionsAgo 0 = snapped today). Older breaks aren't actionable, so drop.
  let lastEnded = null;
  if (
    priorEnded?.material &&
    Number.isInteger(lastIdx) &&
    Number.isInteger(priorEnded.endIdx)
  ) {
    const sessionsAgo = lastIdx - priorEnded.endIdx;
    if (sessionsAgo >= 0 && sessionsAgo <= STREAK_SNAPPED_RECENT_SESSIONS) {
      lastEnded = {
        volumeRatio: priorEnded.volumeRatio,
        volumeTrend: priorEnded.volumeTrend,
        tolerancePct: priorEnded.tolerancePct,
        toleranceBreakPct: priorEnded.toleranceBreakPct,
        counterDays: priorEnded.counterDays,
        consecutiveCounterDays: priorEnded.consecutiveCounterDays,
        color: priorEnded.color,
        days: priorEnded.days,
        windowDays: priorEnded.windowDays,
        sameDays: priorEnded.sameDays,
        cumulativePct: priorEnded.cumulativePct,
        reversalPct: priorEnded.reversalPct,
        brokeBy: priorEnded.brokeBy,
        sessionsAgo,
      };
    }
  }

  // History is emitted newest-first to match the existing data contract.
  // Emit the full streak window. The renderer uses windowDays for the spark
  // and sameDays for the signal length shown in filters and rankings.
  const histOut = streak.history.slice().reverse().map((m, idx) => ({
    sessionsBack: idx,
    date: m.date,
    close: m.close,
    changePct: m.changePct,
    color: m.color,
  }));
  return {
    symbol,
    lastClose: lastMove?.close ?? null,
    maContext: buildStreakMaContext(bars),
    current: {
      color: streak.direction,
      days: streak.days,
      windowDays: streak.days,
      sameDays: streak.sameDays,
      cumulativePct: streak.cumulativePct,
      tolerancePct: streak.tolerancePct,
      counterDays: streak.counterDays,
      consecutiveCounterDays: streak.consecutiveCounterDays,
      moveNoisePct,
      counterBreakPct,
      toleranceBreakPct,
      counterDaysBreak: STREAK_CONSECUTIVE_COUNTER_BREAK,
      volumeRatio,
      volumeTrend,
    },
    // Longest comparable run (same-direction-day metric) for each direction over the
    // ~60-session window — lets the UI flag an unusually long current run.
    context: { maxGreenDays, maxRedDays, windowSessions: moves.length },
    lastEnded,
    history: histOut,
  };
}

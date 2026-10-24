// Bottom tracker. A staged read of whether a decline is still getting worse,
// whether buyers are starting to show up, and whether a recovery has any
// confirmation. Nothing here is a trading signal: the historical section
// counts how often the long-history pieces fired early.
//
// Necessary evidence for a "potential bottom": the measured crash catalyst
// is easing, credit spreads have stopped widening, and earnings downgrades
// are no longer accelerating. "Emerging recovery" keeps those and adds
// broader participation plus higher lows in SPY and QQQ. "Stronger
// confirmation" also needs both indexes holding above the 200-day average,
// earnings forecasts turning up, and credit staying stable.
//
// Liquidity and valuation are shown with the stage they belong to. They do
// not, by themselves, flip the verdict. Earnings revisions and tracked-stock
// breadth do not have a multi-cycle history, so the backtest leaves them out
// and says so.

export const BOTTOM_TRACKER_VERSION = 1;

const DRAWDOWN_DEEP = -0.10;
const DRAWDOWN_BELOW_200 = -0.05;
const NEAR_HIGH = -0.08;
// The crash high is the highest close in about three years. A one-year
// window forgets a long bear and treats a bounce as a new high.
const PEAK_LOOKBACK = 756;
const CREDIT_WIDEN_20 = 0.15;
const CREDIT_FLAT_20 = 0.05;
const CREDIT_NARROW_20 = -0.10;
const CREDIT_STRESS_RISE = 0.25;
const CATALYST_MIN_Z = 1.25;
const CATALYST_RETRACE = 0.30;
// A higher low has to be a real turn off the decline's low, not a 0.5% wiggle.
const HIGHER_LOW_GAP = 1.01;
const BOUNCE_GAP = 1.02;
const NEAR_CRASH_LOW = 1.03;
// Being down from the high is not a bottom. Price has to be off the
// decline's own low, and that low has to be at least two weeks old.
const LOW_LIFT = 0.03;
const LOW_AGE = 10;
const SWING_WING = 10;
const HOLD_LOOKBACK = 10;
const HOLD_REQUIRED = 8;
const EARNINGS_MIN_NAMES = 12;
const EARNINGS_NOISE_PCT = 0.5;
const EARNINGS_SHARE_GAP = 0.05;
const BREADTH_MIN_NAMES = 20;
const BREADTH_PCT_RISE = 5;
const BREADTH_RANGE = 120;
const FALSE_POSITIVE_DROP = 0.95;
const TROUGH_DRAWDOWN = -0.15;
const TROUGH_WING = 63;
const TIMELY_AFTER = 21;
const TIMELY_BEFORE = 10;
const OUTCOME_63 = 63;
const OUTCOME_126 = 126;
const BACKTEST_STEP = 5;
const HISTORY_CAP = 400;

const CATALYSTS = [
  { key: "hy", label: "High-yield spreads", lookback: 20, minMove: 0.25 },
  { key: "ig", label: "Investment-grade spreads", lookback: 20, minMove: 0.15 },
  { key: "vix", label: "Equity volatility", lookback: 20, minMove: 3 },
  { key: "stress", label: "Funding and financial stress", lookback: 4, minMove: 0.2 },
  { key: "dgs2", label: "The 2-year Treasury yield", lookback: 20, minMove: 0.25 },
  { key: "cpi", label: "Inflation", lookback: 3, yoy: true, minMove: 0.005 },
  { key: "unrate", label: "Unemployment", lookback: 3, minMove: 0.2 },
  { key: "oil", label: "Oil", lookback: 20, minMove: 5 },
  { key: "dollar", label: "The dollar", lookback: 20, minMove: 1 },
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, places = 2) {
  const n = num(value);
  if (n == null) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function median(values) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function stdev(values) {
  const xs = (values || []).filter((v) => Number.isFinite(v));
  if (xs.length < 8) return null;
  const mean = xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const variance = xs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 1e-9 ? sd : null;
}

function dateKey(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function points(rows) {
  const byDate = new Map();
  for (const row of rows || []) {
    const date = dateKey(row?.date ?? row?.t);
    const value = num(row?.value ?? row?.c ?? row?.v);
    if (!date || value == null) continue;
    byDate.set(date, value);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));
}

function medianGapDays(series) {
  const gaps = [];
  for (let i = 1; i < series.length; i++) {
    const gap = (Date.parse(`${series[i].date}T00:00:00Z`) - Date.parse(`${series[i - 1].date}T00:00:00Z`)) / 86400000;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  return median(gaps);
}

function periodsPerYear(series) {
  const gap = medianGapDays(series);
  if (gap == null) return 252;
  if (gap >= 20) return 12;
  if (gap >= 5) return 52;
  return 252;
}

function toYearOverYear(series) {
  const step = periodsPerYear(series);
  const out = [];
  for (let i = step; i < series.length; i++) {
    const base = series[i - step].value;
    if (!(base > 0)) continue;
    out.push({ date: series[i].date, value: series[i].value / base - 1 });
  }
  return out;
}

function lastIndexOnOrBefore(series, date) {
  let lo = 0;
  let hi = series.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function preparePrice(series) {
  const dates = series.map((row) => row.date);
  const closes = series.map((row) => row.value);
  const n = closes.length;
  const sma200 = new Array(n).fill(null);
  let roll = 0;
  for (let i = 0; i < n; i++) {
    roll += closes[i];
    if (i >= 200) roll -= closes[i - 200];
    if (i >= 199) sma200[i] = roll / 200;
  }
  const swingIdx = [];
  for (let i = SWING_WING; i < n - SWING_WING; i++) {
    let swing = true;
    for (let k = i - SWING_WING; k <= i + SWING_WING; k++) {
      if (k !== i && closes[k] <= closes[i]) {
        swing = false;
        break;
      }
    }
    if (swing) swingIdx.push(i);
  }
  return { dates, closes, sma200, swingIdx, n };
}

function featuresAt(prep, i) {
  if (!prep || i < 60 || i >= prep.n) return { available: false };
  const { closes, sma200, swingIdx } = prep;
  const start = Math.max(0, i - (PEAK_LOOKBACK - 1));
  let peak = -Infinity;
  let peakAt = start;
  for (let k = start; k <= i; k++) {
    if (closes[k] >= peak) {
      peak = closes[k];
      peakAt = k;
    }
  }
  const last = closes[i];
  const drawdown = peak > 0 ? last / peak - 1 : null;
  const sma = sma200[i];
  const above = sma == null ? null : last > sma;
  let holdHave = 0;
  let holdCount = 0;
  for (let k = Math.max(0, i - (HOLD_LOOKBACK - 1)); k <= i; k++) {
    if (sma200[k] == null) continue;
    holdHave += 1;
    if (closes[k] > sma200[k]) holdCount += 1;
  }
  const confirmedUntil = i - SWING_WING;
  let right = -1;
  let lo = 0;
  let hi = swingIdx.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (swingIdx[mid] <= confirmedUntil) {
      right = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  let postMin = Infinity;
  let postMinAt = peakAt;
  for (let k = peakAt; k <= i; k++) {
    if (closes[k] <= postMin) {
      postMin = closes[k];
      postMinAt = k;
    }
  }
  const offLow = postMin > 0 ? last / postMin - 1 : null;
  // A fresh low, or a close still sitting on it, means the decline is extending.
  const lifted = offLow != null && offLow >= LOW_LIFT && (i - postMinAt) >= LOW_AGE;
  const afterPeak = [];
  for (let s = right; s >= 0; s--) {
    if (swingIdx[s] <= peakAt) break;
    afterPeak.push(swingIdx[s]);
  }
  let higherLow = false;
  if (afterPeak.length >= 2) {
    const later = afterPeak[0];
    const earlier = afterPeak[1];
    // The first of the two lows has to be the decline's low, or within 3% of it.
    // Two small pivots far above that low are not a bottom.
    const nearCrashLow = closes[earlier] <= postMin * NEAR_CRASH_LOW;
    higherLow = nearCrashLow
      && closes[later] >= closes[earlier] * HIGHER_LOW_GAP
      && last >= closes[later] * BOUNCE_GAP;
  }
  return {
    available: true,
    date: prep.dates[i],
    last,
    drawdown,
    peakDate: prep.dates[peakAt],
    offLow,
    lowAge: i - postMinAt,
    lifted,
    sma200: sma,
    above,
    below: above == null ? null : !above,
    holding: holdHave >= HOLD_LOOKBACK && holdCount >= HOLD_REQUIRED && above === true,
    higherLow,
  };
}

function drawdownActive(feature) {
  if (!feature?.available || feature.drawdown == null) return false;
  if (feature.drawdown <= DRAWDOWN_DEEP) return true;
  return feature.below === true && feature.drawdown <= DRAWDOWN_BELOW_200;
}

function nearHigh(feature) {
  return !!(feature?.available && feature.drawdown != null && feature.drawdown > NEAR_HIGH && feature.below !== true);
}

function creditAt(series, j, peakDate) {
  if (!series || j < 20 || !peakDate) return null;
  const level = series[j].value;
  const chg20 = level - series[j - 20].value;
  const chg60 = j >= 60 ? level - series[j - 60].value : null;
  let start = j;
  while (start > 0 && series[start].date > peakDate) start -= 1;
  if (series[start].date > peakDate) return null;
  let worst = series[start].value;
  for (let k = start; k <= j; k++) if (series[k].value > worst) worst = series[k].value;
  // Stress is a widen during THIS decline. A wide print from an older episode
  // does not count once the current decline never pushed spreads out.
  const rise = worst - series[start].value;
  const wasStressed = rise >= CREDIT_STRESS_RISE;
  const widening = chg20 > CREDIT_WIDEN_20;
  const narrowing = wasStressed && chg20 <= CREDIT_NARROW_20;
  return {
    date: series[j].date,
    level,
    chg20,
    chg60,
    rise,
    wasStressed,
    widening,
    narrowing,
    consistent: narrowing && chg60 != null && chg60 <= 0,
    stabilizing: wasStressed && !widening && chg20 <= CREDIT_FLAT_20 && !narrowing,
  };
}

function combineCredit(hy, ig) {
  if (!hy || !ig) {
    return {
      status: "unavailable",
      stoppedWidening: false,
      stable: false,
      narrowing: false,
      consistent: false,
      widening: !!(hy?.widening || ig?.widening),
      partial: true,
      hy: hy || null,
      ig: ig || null,
    };
  }
  const widening = hy.widening || ig.widening;
  const bothStressed = hy.wasStressed && ig.wasStressed;
  const bothSettled = (hy.stabilizing || hy.narrowing) && (ig.stabilizing || ig.narrowing);
  const stoppedWidening = !widening && bothStressed && bothSettled;
  const narrowing = hy.narrowing && ig.narrowing;
  const consistent = hy.consistent && ig.consistent;
  const stable = !widening && bothStressed && hy.chg20 <= CREDIT_FLAT_20 && ig.chg20 <= CREDIT_FLAT_20;
  let status = "calm";
  if (widening) status = "widening";
  else if (consistent) status = "narrowing";
  else if (narrowing) status = "narrowing";
  else if (stoppedWidening) status = "stabilizing";
  else if (hy.wasStressed || ig.wasStressed) status = "elevated";
  return { status, stoppedWidening, stable, narrowing, consistent, widening, partial: false, hy, ig };
}

function moveStats(series, j, peakDate, def) {
  const lookback = def.lookback;
  if (!series || j < lookback + 5 || !(def.minMove > 0)) return null;
  let start = j;
  while (start > 0 && series[start].date > peakDate) start -= 1;
  if (series[start].date > peakDate) return null;
  let worst = series[start].value;
  for (let k = start; k <= j; k++) if (series[k].value > worst) worst = series[k].value;
  const move = worst - series[start].value;
  if (!(move > 0)) return null;
  // Scale the move by volatility BEFORE the decline, so the spike is not
  // sitting in its own denominator. A flat history uses the minimum move.
  const changes = [];
  for (let k = lookback; k <= start; k++) changes.push(series[k].value - series[k - lookback].value);
  const sd = stdev(changes);
  const scale = sd == null ? def.minMove : Math.max(sd, def.minMove);
  const current = series[j].value;
  const recent = current - series[j - lookback].value;
  const retrace = (worst - current) / move;
  return {
    z: move / scale,
    retrace,
    recent,
    easing: retrace >= CATALYST_RETRACE && recent < 0,
    start: series[start].value,
    worst,
    current,
  };
}

function readCatalyst(seriesMap, peakDate, asOf) {
  let best = null;
  for (const def of CATALYSTS) {
    const series = seriesMap[def.key];
    if (!series?.length) continue;
    const j = lastIndexOnOrBefore(series, asOf);
    const stats = moveStats(series, j, peakDate, def);
    if (!stats || stats.z < CATALYST_MIN_Z) continue;
    if (!best || stats.z > best.z) best = { ...def, ...stats };
  }
  if (!best) {
    return { status: "unidentified", easing: false, label: null, overlap: false };
  }
  return {
    status: best.easing ? "easing" : "still-stressed",
    easing: best.easing,
    label: best.label,
    key: best.key,
    overlap: best.key === "hy" || best.key === "ig",
    z: best.z,
    retrace: best.retrace,
    recent: best.recent,
  };
}

function liquidityPoint(series, j) {
  if (!series || j < 8) return null;
  const level = series[j].value;
  const chg4 = level - series[j - 4].value;
  const chg8 = level - series[j - 8].value;
  let max = -Infinity;
  for (let k = Math.max(0, j - 26); k <= j; k++) if (series[k].value > max) max = series[k].value;
  const wasStressed = level > 0 || max > 0.5 || chg8 > 0.3;
  const deteriorating = chg4 > 0.15;
  return {
    date: series[j].date,
    level,
    chg4,
    chg8,
    wasStressed,
    deteriorating,
    stabilizing: wasStressed && chg4 <= 0,
    normalized: level < 0 && chg4 <= 0,
  };
}

function readLiquidity(point) {
  if (!point) return { status: "unavailable", stabilizing: false };
  let status = "calm";
  if (point.deteriorating) status = "deteriorating";
  else if (point.normalized) status = "normalized";
  else if (point.stabilizing) status = "stabilizing";
  else if (point.wasStressed) status = "elevated";
  return { ...point, status, stabilizing: status === "stabilizing" || status === "normalized" };
}

function readValuation(forwardPe, tenY, drawdown) {
  const pe = num(forwardPe);
  const yield10 = num(tenY);
  if (pe == null || pe <= 0 || yield10 == null) return { status: "unavailable", reset: false };
  const earningsYield = 100 / pe;
  const erp = earningsYield - yield10;
  let status = "in-between";
  if (erp >= 3) status = "reset";
  else if (erp >= 2 && drawdown != null && drawdown <= DRAWDOWN_DEEP) status = "compressing";
  else if (erp < 1.5) status = "expensive";
  return { status, reset: status === "reset" || status === "compressing", forwardPe: pe, tenY: yield10, earningsYield, erp };
}

export function summarizeRevisions(rows) {
  const covered = [];
  for (const row of rows || []) {
    const pct30 = num(row?.pct30);
    const pct90 = num(row?.pct90);
    if (pct30 == null || pct90 == null) continue;
    covered.push({ pct30, pct90 });
  }
  if (covered.length < EARNINGS_MIN_NAMES) return { covered: covered.length, unavailable: true };
  const n = covered.length;
  const down30 = covered.filter((row) => row.pct30 < -EARNINGS_NOISE_PCT).length;
  const down90 = covered.filter((row) => row.pct90 < -EARNINGS_NOISE_PCT).length;
  const up30 = covered.filter((row) => row.pct30 > EARNINGS_NOISE_PCT).length;
  return {
    covered: n,
    unavailable: false,
    downShare30: down30 / n,
    downShare90: down90 / n,
    upShare30: up30 / n,
    netUp30: up30 - down30,
    medianPct30: median(covered.map((row) => row.pct30)),
    medianPct90: median(covered.map((row) => row.pct90)),
  };
}

function readEarnings(summary) {
  if (!summary || summary.unavailable || summary.covered < EARNINGS_MIN_NAMES) {
    return { status: "unavailable", slowingOrBetter: false, improving: false, covered: summary?.covered || 0 };
  }
  const wasNegative = summary.downShare90 >= 0.4 || summary.medianPct90 <= -1;
  const slowing = summary.downShare30 <= summary.downShare90 - EARNINGS_SHARE_GAP
    || (summary.medianPct90 <= -1 && summary.medianPct30 >= summary.medianPct90 + 1);
  const accelerating = summary.downShare30 >= summary.downShare90 + EARNINGS_SHARE_GAP && summary.medianPct30 < 0;
  const improving = summary.medianPct30 >= EARNINGS_NOISE_PCT && summary.upShare30 > summary.downShare30 && summary.netUp30 > 0;
  const stabilizing = !accelerating && !improving && Math.abs(summary.medianPct30) <= EARNINGS_NOISE_PCT && summary.downShare30 <= 0.55;
  return {
    ...summary,
    status: improving ? "improving" : slowing ? "slowing" : stabilizing ? "stabilizing" : accelerating ? "accelerating" : "mixed",
    wasNegative,
    slowing,
    accelerating,
    improving,
    stabilizing,
    // Calm revisions that were never negative are not a bottoming earnings read.
    slowingOrBetter: wasNegative && !accelerating && (slowing || stabilizing || improving),
  };
}

export function breadthPath(barsBySymbol) {
  const parsed = [];
  const dateSet = new Set();
  for (const rows of Object.values(barsBySymbol || {})) {
    const clean = points(rows);
    if (clean.length < 60) continue;
    parsed.push(clean);
    for (const row of clean) dateSet.add(row.date);
  }
  const dates = [...dateSet].sort();
  const cursors = parsed.map(() => 0);
  const history = [];
  for (const date of dates) {
    let n50 = 0;
    let a50 = 0;
    let n200 = 0;
    let a200 = 0;
    let nRange = 0;
    let highs = 0;
    let lows = 0;
    for (let s = 0; s < parsed.length; s++) {
      const rows = parsed[s];
      while (cursors[s] + 1 < rows.length && rows[cursors[s] + 1].date <= date) cursors[s] += 1;
      const p = cursors[s];
      if (rows[p].date !== date) continue;
      if (p >= 49) {
        let sum = 0;
        for (let k = p - 49; k <= p; k++) sum += rows[k].value;
        n50 += 1;
        if (rows[p].value > sum / 50) a50 += 1;
      }
      if (p >= 199) {
        let sum = 0;
        for (let k = p - 199; k <= p; k++) sum += rows[k].value;
        n200 += 1;
        if (rows[p].value > sum / 200) a200 += 1;
      }
      if (p >= BREADTH_RANGE - 1) {
        let min = Infinity;
        let max = -Infinity;
        for (let k = p - (BREADTH_RANGE - 1); k <= p; k++) {
          if (rows[k].value < min) min = rows[k].value;
          if (rows[k].value > max) max = rows[k].value;
        }
        nRange += 1;
        if (rows[p].value <= min * 1.01) lows += 1;
        else if (rows[p].value >= max * 0.99) highs += 1;
      }
    }
    if (n50 < BREADTH_MIN_NAMES) continue;
    history.push({
      t: date,
      pctAbove50: round((a50 / n50) * 100, 1),
      pctAbove200: n200 >= BREADTH_MIN_NAMES ? round((a200 / n200) * 100, 1) : null,
      newHighs: nRange >= BREADTH_MIN_NAMES ? highs : null,
      newLows: nRange >= BREADTH_MIN_NAMES ? lows : null,
      n: n50,
    });
  }
  return history;
}

function readBreadth(history) {
  if (!Array.isArray(history) || history.length < 21) {
    return { status: "unavailable", improving: false, fewerNewLows: false, broadening: false, now: history?.at?.(-1) || null };
  }
  const now = history[history.length - 1];
  const prev = history[history.length - 21];
  const pctDelta = now.pctAbove50 != null && prev.pctAbove50 != null ? now.pctAbove50 - prev.pctAbove50 : null;
  const lowsDelta = now.newLows != null && prev.newLows != null ? now.newLows - prev.newLows : null;
  const improving = (pctDelta != null && pctDelta >= BREADTH_PCT_RISE)
    || (lowsDelta != null && lowsDelta <= -2 && pctDelta != null && pctDelta >= 0);
  const fewerNewLows = lowsDelta != null && lowsDelta <= -2;
  const broadening = improving || (now.pctAbove50 != null && now.pctAbove50 >= 50 && fewerNewLows);
  let status = "flat";
  if (improving) status = "improving";
  else if (pctDelta != null && pctDelta <= -BREADTH_PCT_RISE) status = "deteriorating";
  return { status, improving, fewerNewLows, broadening, now, prev, pctDelta, lowsDelta };
}

function peakDateAt(prep, featureIndex) {
  const feature = featuresAt(prep, featureIndex);
  return feature.available ? feature.peakDate : null;
}

function judgeLive(parts) {
  const active = drawdownActive(parts.spy);
  const higherLows = !!(parts.spy.higherLow && parts.qqq.higherLow);
  const holding = !!(parts.spy.holding && parts.qqq.holding);
  const lifted = !!(parts.spy.lifted && parts.qqq.lifted);
  const fundingBlocks = parts.liquidity.status === "deteriorating";
  // Early evidence: the damage stopped accelerating. That is a watch, not a bottom.
  const early = !!(active && parts.catalyst.easing && parts.credit.stoppedWidening && parts.earnings.slowingOrBetter);
  // A forming bottom needs spreads to be narrowing and both indexes off the low.
  // A 10% drop, or spreads that merely stopped rising while price makes new lows, is not one.
  const forming = !!(early && parts.credit.narrowing && lifted && !fundingBlocks);
  const potential = forming;
  const emerging = !!(forming && parts.breadth.improving && higherLows);
  // Confirmation can keep credit merely stable. It does not have to keep
  // narrowing every 20 sessions, and it still cannot print while price is
  // back on the low or funding stress is rising.
  const confirmed = !!(active && early && lifted && !fundingBlocks && higherLows && holding && parts.earnings.improving && parts.credit.stable && parts.breadth.broadening);
  let verdict = "stress";
  if (!parts.spy.available) verdict = "unavailable";
  else if (confirmed) verdict = "confirmed";
  else if (emerging) verdict = "emerging";
  else if (potential) verdict = "potential";
  else if (early) verdict = "slowing";
  else if (active) verdict = "stress";
  else if (nearHigh(parts.spy)) verdict = "no-drawdown";
  else verdict = "pullback";
  const blocks = [];
  if (active && early && !parts.credit.narrowing) blocks.push("Credit has stopped widening but has not started narrowing.");
  if (active && early && !lifted) blocks.push("SPY or QQQ is still on the decline low, so another leg down is still open.");
  if (active && early && fundingBlocks) blocks.push("Funding stress is still rising.");
  return { ...parts, active, higherLows, holding, lifted, fundingBlocks, early, forming, potential, emerging, confirmed, verdict, blocks };
}

function pct(value, places = 1) {
  const n = num(value);
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(places)}%`;
}

function pts(value, places = 2) {
  const n = num(value);
  if (n == null) return "—";
  const bp = Math.round(n * 100);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(places)} pts (${bp > 0 ? "+" : ""}${bp} bp)`;
}

function share(value) {
  const n = num(value);
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function pricePct(value) {
  const n = num(value);
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function indexFact(label, feature) {
  if (!feature?.available) return `${label} has no usable price history.`;
  const where = feature.above == null ? "its 200-day average is not available yet" : feature.above ? "above its 200-day average" : "under its 200-day average";
  return `${label} is ${pricePct(feature.drawdown)} from the high of this decline and ${where}.`;
}

function evidenceState(active, pass, partial = false, missing = false) {
  if (!active) return "na";
  if (missing) return "na";
  if (pass) return "pass";
  if (partial) return "partial";
  return "fail";
}

function buildView(judged, extras) {
  const { spy, qqq, credit, catalyst, liquidity, earnings, breadth, valuation, active } = judged;
  const creditLabel = {
    widening: "Still widening",
    narrowing: credit.consistent ? "Narrowing together" : "Starting to narrow",
    stabilizing: "Stopped widening",
    elevated: "Still elevated",
    calm: "Spreads did not widen in this decline",
    unavailable: "Unavailable",
  }[credit.status] || "Unavailable";
  const earningsLabel = {
    improving: "Forecasts turning up",
    slowing: "Downgrades slowing",
    stabilizing: "Downgrades no longer accelerating",
    accelerating: "Downgrades still accelerating",
    mixed: "No clear turn",
    unavailable: "Unavailable",
  }[earnings.status] || "Unavailable";
  const offLowText = (label, feature) => feature?.offLow == null
    ? ""
    : ` ${label} is ${pricePct(feature.offLow)} off its decline low, and that low was ${feature.lowAge} sessions ago.`;
  const priceBits = [indexFact("SPY", spy) + offLowText("", spy), indexFact("QQQ", qqq) + offLowText("", qqq)];
  if (judged.higherLows) priceBits.push("Both have a confirmed higher low since the high.");
  else if (spy.higherLow || qqq.higherLow) priceBits.push(`${spy.higherLow ? "SPY has" : "QQQ has"} a higher low. The other index does not, so the pair does not pass.`);
  else priceBits.push("A higher low needs two confirmed swing lows after the high. The first is the decline's low, the second is at least 1% higher, and price is at least 2% off that second low.");
  if (judged.holding) priceBits.push("Both have held above the 200-day average on at least 8 of the last 10 closes.");
  else if (spy.holding || qqq.holding) priceBits.push("One index is back above its 200-day average. Both are required.");

  const catalystSummary = catalyst.label
    ? `The sharpest measured stress in this decline is ${catalyst.label.charAt(0).toLowerCase()}${catalyst.label.slice(1)}. It has given back ${catalyst.retrace == null ? "—" : `${Math.round(catalyst.retrace * 100)}%`} of that move${catalyst.easing ? ", and the latest window is still improving." : ", but the latest window is not still improving or the retracement is under 30%."}${catalyst.overlap ? " Credit is also a separate gate, so this series is doing both jobs." : ""}`
    : "No single measured series (credit, volatility, funding stress, yields, inflation, unemployment, oil, or the dollar) deteriorated enough during this decline to name a catalyst.";

  const hy = credit.hy;
  const ig = credit.ig;
  const creditSummary = !hy && !ig
    ? "High-yield and investment-grade spreads are both missing, so the credit gate does not pass."
    : `High yield is ${hy ? `${hy.level.toFixed(2)}%` : "missing"}, 20 sessions ${hy ? pts(hy.chg20) : "—"}. Investment grade is ${ig ? `${ig.level.toFixed(2)}%` : "missing"}${credit.partial ? ". One spread is missing, so the credit gate does not pass." : `. ${creditLabel}.`}`;

  const earningsSummary = earnings.status === "unavailable"
    ? `Fiscal-year EPS revisions cover ${earnings.covered || 0} companies. At least ${EARNINGS_MIN_NAMES} are required, so a missing sample does not count as improvement.`
    : `${earnings.covered} covered companies: ${share(earnings.downShare30)} have a lower fiscal-year EPS estimate than 30 days ago, versus ${share(earnings.downShare90)} versus 90 days ago. The median 30-day change is ${pct(earnings.medianPct30)}. ${earningsLabel}.`;

  const breadthSummary = breadth.status === "unavailable"
    ? "Tracked-stock breadth needs 21 sessions with at least 20 names above a computable 50-day average."
    : `${breadth.now.pctAbove50}% of tracked stocks are above their 50-day average (${pct(breadth.pctDelta, 1)} versus 20 sessions ago). New 120-session lows went from ${breadth.prev.newLows ?? "—"} to ${breadth.now.newLows ?? "—"}.`;

  const liquiditySummary = liquidity.status === "unavailable"
    ? "The St. Louis Fed Financial Stress Index is missing, so funding conditions are not scored."
    : `The financial-stress index is ${liquidity.level.toFixed(2)} (${pts(liquidity.chg4)} over 4 weekly readings). ${liquidity.stabilizing ? "Funding stress is no longer rising." : liquidity.status === "deteriorating" ? "Funding stress is still rising." : "This is context, not one of the required gates."}`;

  const valuationSummary = valuation.status === "unavailable"
    ? "Valuation needs SPY's forward P/E and the 10-year Treasury yield."
    : `Forward P/E is ${valuation.forwardPe.toFixed(1)}, an earnings yield of ${valuation.earningsYield.toFixed(1)}% against a ${valuation.tenY.toFixed(2)}% 10-year yield. The gap is ${valuation.erp.toFixed(1)} points. ${valuation.reset ? "Multiples have already compressed relative to bonds." : "Investors can still argue for lower multiples."}`;

  const indicators = [
    { id: "catalyst", title: "Original crash catalyst", phase: "Early", state: catalyst.status, stateLabel: catalyst.easing ? "Easing" : catalyst.label ? "Not easing" : "Not identified", summary: catalystSummary, source: "FRED and the SPY decline window", facts: catalyst.label ? [{ label: "Series", value: catalyst.label }, { label: "Retraced", value: catalyst.retrace == null ? "—" : `${Math.round(catalyst.retrace * 100)}%` }] : [] },
    { id: "credit", title: "Credit spreads", phase: "Early, then confirmation", state: credit.status, stateLabel: creditLabel, summary: creditSummary, source: "FRED ICE BofA US high-yield OAS (BAMLH0A0HYM2) and investment-grade OAS (BAMLC0A0CM)", facts: [{ label: "High yield", value: hy ? `${hy.level.toFixed(2)}%` : "—" }, { label: "HY 20 sessions", value: hy ? pts(hy.chg20) : "—" }, { label: "Investment grade", value: ig ? `${ig.level.toFixed(2)}%` : "—" }, { label: "IG 20 sessions", value: ig ? pts(ig.chg20) : "—" }] },
    { id: "liquidity", title: "Liquidity and financial stability", phase: "Early", state: liquidity.status, stateLabel: liquidity.status === "unavailable" ? "Unavailable" : liquidity.stabilizing ? "Stabilizing" : liquidity.status === "deteriorating" ? "Still tightening" : "Not a required gate", summary: liquiditySummary, source: "FRED St. Louis Fed Financial Stress Index (STLFSI4)", facts: liquidity.level == null ? [] : [{ label: "Index", value: liquidity.level.toFixed(2) }, { label: "4 weeks", value: pts(liquidity.chg4) }] },
    { id: "earnings", title: "Earnings revisions", phase: "Early, then confirmation", state: earnings.status, stateLabel: earningsLabel, summary: earningsSummary, source: "Fiscal-year EPS estimate versus 30 and 90 days ago, across covered stocks", facts: earnings.status === "unavailable" ? [{ label: "Covered", value: String(earnings.covered || 0) }] : [{ label: "Down vs 30 days", value: share(earnings.downShare30) }, { label: "Down vs 90 days", value: share(earnings.downShare90) }, { label: "Median 30-day change", value: pct(earnings.medianPct30) }] },
    { id: "valuation", title: "Valuations and expectations", phase: "Stabilization", state: valuation.status, stateLabel: valuation.status === "reset" ? "Expectations reset" : valuation.status === "compressing" ? "Compression underway" : valuation.status === "expensive" ? "Still expensive" : valuation.status === "unavailable" ? "Unavailable" : "Not reset", summary: valuationSummary, source: "SPY forward earnings yield minus the 10-year Treasury yield (FRED DGS10)", facts: valuation.status === "unavailable" ? [] : [{ label: "Forward P/E", value: valuation.forwardPe.toFixed(1) }, { label: "Gap vs 10-year", value: `${valuation.erp.toFixed(1)} pts` }] },
    { id: "breadth", title: "Market breadth", phase: "Stabilization, then confirmation", state: breadth.status, stateLabel: breadth.improving ? "Broadening" : breadth.fewerNewLows ? "Fewer new lows" : breadth.status === "deteriorating" ? "Narrowing" : breadth.status === "unavailable" ? "Unavailable" : "Not broadening", summary: breadthSummary, source: "Share of tracked stocks above their own 50- and 200-day averages, and 120-session highs and lows", facts: breadth.now ? [{ label: "Above 50-day", value: breadth.now.pctAbove50 == null ? "—" : `${breadth.now.pctAbove50}%` }, { label: "Above 200-day", value: breadth.now.pctAbove200 == null ? "—" : `${breadth.now.pctAbove200}%` }, { label: "New lows", value: breadth.now.newLows == null ? "—" : String(breadth.now.newLows) }] : [] },
    { id: "price", title: "SPY and QQQ price", phase: "Stabilization, then confirmation", state: judged.holding ? "holding" : judged.higherLows ? "higher-low" : judged.lifted ? "lifted" : active ? "downtrend" : "calm", stateLabel: judged.holding ? "Back above the 200-day" : judged.higherLows ? "Higher lows" : judged.lifted ? "Off the low" : active ? "Still at the lows" : "Not in a deep decline", summary: priceBits.join(" "), source: "SPY and QQQ daily closes", facts: [{ label: "SPY vs high", value: pricePct(spy.drawdown) }, { label: "SPY off the low", value: pricePct(spy.offLow) }, { label: "QQQ vs high", value: pricePct(qqq.drawdown) }, { label: "QQQ off the low", value: pricePct(qqq.offLow) }] },
  ];

  const bullets = [
    { phase: "early", label: "Original crash catalyst begins easing", state: evidenceState(active, catalyst.easing, false, !catalyst.label && active), note: catalystSummary },
    { phase: "early", label: "Credit spreads stop widening and begin narrowing", state: evidenceState(active, credit.narrowing, credit.stoppedWidening && !credit.narrowing, credit.status === "unavailable"), note: creditSummary },
    { phase: "early", label: "Liquidity and funding conditions stabilize", state: evidenceState(active, liquidity.stabilizing, false, liquidity.status === "unavailable"), note: liquiditySummary },
    { phase: "early", label: "Earnings downgrades become less severe", state: evidenceState(active, earnings.slowingOrBetter, false, earnings.status === "unavailable"), note: earningsSummary },
    { phase: "stabilize", label: "Valuation expectations reset", state: evidenceState(active, valuation.reset, false, valuation.status === "unavailable"), note: valuationSummary },
    { phase: "stabilize", label: "Market breadth improves", state: evidenceState(active, breadth.improving, false, breadth.status === "unavailable"), note: breadthSummary },
    { phase: "stabilize", label: "Fewer stocks make new lows", state: evidenceState(active, breadth.fewerNewLows, false, breadth.now?.newLows == null), note: breadthSummary },
    { phase: "stabilize", label: "SPY and QQQ establish higher lows", state: evidenceState(active, judged.higherLows), note: priceBits.join(" ") },
    { phase: "confirm", label: "Indexes reclaim and hold the 200-day average", state: evidenceState(active, judged.holding), note: priceBits.join(" ") },
    { phase: "confirm", label: "Earnings forecasts begin improving", state: evidenceState(active, earnings.improving, false, earnings.status === "unavailable"), note: earningsSummary },
    { phase: "confirm", label: "Credit conditions remain stable", state: evidenceState(active, credit.stable && credit.stoppedWidening, credit.status === "calm", credit.status === "unavailable"), note: creditSummary },
    { phase: "confirm", label: "Rally participation keeps broadening", state: evidenceState(active, breadth.broadening, false, breadth.status === "unavailable"), note: breadthSummary },
  ];

  const rule = [
    { id: "slowing", title: "Damage slowing", detail: "The catalyst, credit, and earnings pace have stopped getting worse. This is a watch, not a bottom. Price can still fall.", pass: judged.early, needs: [
      { label: "Catalyst easing", pass: catalyst.easing },
      { label: "Credit stopped widening", pass: credit.stoppedWidening },
      { label: "Earnings downgrades slowing", pass: earnings.slowingOrBetter },
    ] },
    { id: "potential", title: "Bottom forming", detail: "Spreads have started narrowing and both indexes have lifted off the decline low. A new low or a fresh widen cancels it.", pass: judged.potential, needs: [
      { label: "Damage no longer accelerating", pass: judged.early },
      { label: "Both spreads narrowing", pass: credit.narrowing },
      { label: "SPY and QQQ off the low", pass: judged.lifted },
      { label: "Funding stress not rising", pass: !judged.fundingBlocks },
    ] },
    { id: "emerging", title: "Emerging recovery", detail: "The forming evidence is still true, breadth broadens, and both indexes make a higher low off the decline's own low.", pass: judged.emerging, needs: [
      { label: "Bottom-forming evidence still true", pass: judged.potential },
      { label: "Breadth broadening", pass: breadth.improving },
      { label: "Higher lows in SPY and QQQ", pass: judged.higherLows },
    ] },
    { id: "confirmed", title: "Stronger confirmation", detail: "The indexes hold above the 200-day average while earnings forecasts turn up and credit stays stable.", pass: judged.confirmed, needs: [
      { label: "Emerging-recovery evidence still true", pass: judged.emerging },
      { label: "Both indexes holding the 200-day average", pass: judged.holding },
      { label: "Earnings forecasts improving", pass: earnings.improving },
      { label: "Credit still stable", pass: credit.stable && credit.stoppedWidening },
      { label: "Participation still broadening", pass: breadth.broadening },
    ] },
  ];

  const titles = {
    unavailable: ["Bottom tracker unavailable", "Price history for SPY is too short to judge a decline."],
    "no-drawdown": ["No crash in progress", "SPY is within 8% of its three-year high and above its 200-day average. A drop from the high is not scored until the decline is deep enough to matter."],
    pullback: ["Pullback, not a crash", "SPY is off its three-year high, but not by the 10% bar (or 5% while under the 200-day average). The bottom checklist stays off."],
    stress: ["Damage still building", "A decline is underway. The catalyst, credit, or earnings downgrades are still getting worse, so this is not a bottom."],
    slowing: ["Damage slowing, not a bottom", "The catalyst, credit, and earnings downgrades are no longer accelerating. Price is still at the lows, spreads have not started narrowing, or funding stress is still rising. Being down from the high is not a bottom, and another leg lower is still possible."],
    potential: ["A bottom may be forming", "The catalyst is easing, both credit spreads have started narrowing, earnings downgrades are less severe, and SPY and QQQ have lifted off the decline low. A close under that low, or spreads widening again, cancels it."],
    emerging: ["Emerging recovery", "The early evidence is still true, more stocks are participating, and SPY and QQQ have made a higher low. The long-term averages are not reclaimed."],
    confirmed: ["Stronger confirmation", "Both indexes are holding above the 200-day average while credit and earnings forecasts keep improving. That makes a recovery more credible. It does not prove the low is in."],
  };
  let [title, summary] = titles[judged.verdict] || titles.unavailable;
  if (extras.heldBack === "confirmed" && judged.verdict === "emerging") {
    title = "Emerging recovery";
    summary = "The confirmation checklist is present on this reading, but the prior session was not yet an emerging recovery. Confirmation waits until a later session still agrees.";
  } else if (extras.heldBack === "confirmed") {
    title = "A bottom may be forming";
    summary = "The stronger checklist is present on this reading, but there is no recent session that already showed a forming bottom. It stays a forming read until that evidence persists.";
  } else if (extras.heldBack === "emerging") {
    title = "A bottom may be forming";
    summary = "Breadth and higher lows are present on this reading, but a forming bottom has not already printed on a recent session. It stays a forming read until a later session still agrees. It is not a confirmed recovery.";
  }
  const focusId = { confirmed: "confirmed", emerging: "emerging", potential: "potential", slowing: "slowing" }[judged.verdict] || "potential";
  const missing = (rule.find((row) => row.id === focusId) || rule[0]).needs.filter((need) => !need.pass).map((need) => need.label);
  const cancels = [
    { label: "New low", on: active && !judged.lifted, detail: `SPY is ${pricePct(spy.offLow)} off its decline low (${spy.lowAge ?? "—"} sessions ago). QQQ is ${pricePct(qqq.offLow)} off its low (${qqq.lowAge ?? "—"} sessions ago). A close under either low means the decline is still extending.` },
    { label: "Spreads widen again", on: !!credit.widening, detail: "Either high-yield or investment-grade spreads are widening over the last 20 sessions." },
    { label: "Catalyst not easing", on: active && !catalyst.easing, detail: catalyst.label ? `${catalyst.label} has not given back enough of its stress move, or the latest window is rising again.` : "No crash catalyst has been identified, so there is nothing easing yet." },
    { label: "Funding stress rises", on: liquidity.status === "deteriorating", detail: "The financial-stress index is still rising, so a cascading funding problem is not easing." },
  ];

  return {
    title,
    summary,
    blocks: judged.blocks || [],
    cancels,
    missing: judged.verdict === "stress" || judged.verdict === "slowing" || judged.verdict === "potential" || judged.verdict === "emerging" ? missing : [],
    indicators,
    bullets,
    rule,
    indexes: {
      spy: { last: round(spy.last, 2), drawdown: round(spy.drawdown == null ? null : spy.drawdown * 100, 1), offLow: round(spy.offLow == null ? null : spy.offLow * 100, 1), lowAge: spy.lowAge ?? null, lifted: !!spy.lifted, above200: spy.above, higherLow: spy.higherLow, holding: spy.holding },
      qqq: { last: round(qqq.last, 2), drawdown: round(qqq.drawdown == null ? null : qqq.drawdown * 100, 1), offLow: round(qqq.offLow == null ? null : qqq.offLow * 100, 1), lowAge: qqq.lowAge ?? null, lifted: !!qqq.lifted, above200: qqq.above, higherLow: qqq.higherLow, holding: qqq.holding },
    },
    spark: extras.spark,
    persistence: extras.persistence,
  };
}

function outcomeAt(closes, troughs, i) {
  const entry = closes[i];
  if (!(entry > 0)) return null;
  const last = closes.length - 1;
  const resolved = i + OUTCOME_63 <= last;
  let minFwd = Infinity;
  for (let k = i + 1; k <= Math.min(last, i + OUTCOME_63); k++) if (closes[k] < minFwd) minFwd = closes[k];
  const ret = (horizon) => (i + horizon <= last ? closes[i + horizon] / entry - 1 : null);
  let timely = false;
  for (let k = Math.max(0, i - TIMELY_BEFORE); k <= Math.min(last, i + TIMELY_AFTER); k++) {
    if (troughs[k]) timely = true;
  }
  return {
    resolved,
    falsePositive: resolved && minFwd <= entry * FALSE_POSITIVE_DROP,
    timely,
    r63: ret(OUTCOME_63),
    r126: ret(OUTCOME_126),
  };
}

function markTroughs(prep) {
  const { closes, n } = prep;
  const troughs = new Array(n).fill(false);
  for (let i = TROUGH_WING; i < n - TROUGH_WING; i++) {
    let min = Infinity;
    for (let k = i - TROUGH_WING; k <= i + TROUGH_WING; k++) if (closes[k] < min) min = closes[k];
    if (closes[i] !== min) continue;
    let earlier = false;
    for (let k = i - TROUGH_WING; k < i; k++) if (closes[k] === min) earlier = true;
    if (earlier) continue;
    const feature = featuresAt(prep, i);
    if (feature.drawdown != null && feature.drawdown <= TROUGH_DRAWDOWN) troughs[i] = true;
  }
  return troughs;
}

function rate(hits, total) {
  if (!total) return null;
  return round(hits / total, 3);
}

function finishReturns(values) {
  const xs = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return round((xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2) * 100, 1);
}

const SIGNAL_COPY = {
  "credit-stabilizing": "Credit stops widening during a decline",
  "catalyst-easing": "The measured crash catalyst starts easing",
  "liquidity-stabilizing": "Financial-stress index stops rising",
  "higher-lows": "SPY and QQQ make a higher low",
  "reclaim-200": "Both indexes hold the 200-day average while still 10% off the high",
  "proxy-potential": "Catalyst easing, spreads narrowing, and price off the low, without earnings data",
  "proxy-emerging": "That proxy plus higher lows, without breadth data",
  "proxy-confirmed": "That proxy plus a 200-day hold and stable credit, without earnings or breadth",
};

function backtest(prep) {
  const spy = prep.spy;
  if (!spy || spy.n < 320) {
    return { status: "short", note: "SPY history is shorter than about 16 months, so there is no false-positive rate yet." };
  }
  const troughs = markTroughs(spy);
  const cursors = {
    qqq: -1,
    hy: -1,
    ig: -1,
    stress: -1,
    vix: -1,
    dgs2: -1,
    cpi: -1,
    unrate: -1,
    oil: -1,
    dollar: -1,
  };
  const seriesOf = {
    qqq: prep.qqq.dates.map((date, i) => ({ date, value: prep.qqq.closes[i] })),
    hy: prep.series.hy,
    ig: prep.series.ig,
    stress: prep.series.stress,
    vix: prep.series.vix,
    dgs2: prep.series.dgs2,
    cpi: prep.series.cpi,
    unrate: prep.series.unrate,
    oil: prep.series.oil,
    dollar: prep.series.dollar,
  };
  function advance(key, date) {
    const series = seriesOf[key];
    if (!series?.length) return -1;
    while (cursors[key] + 1 < series.length && series[cursors[key] + 1].date <= date) cursors[key] += 1;
    return cursors[key] >= 0 && series[cursors[key]].date <= date ? cursors[key] : -1;
  }
  const buckets = {};
  for (const id of Object.keys(SIGNAL_COPY)) buckets[id] = { episodes: 0, resolved: 0, falsePos: 0, timely: 0, r63: [], r126: [], recent: [] };
  const baseline63 = [];
  const baseline126 = [];
  let prev = null;
  let weeks = 0;
  let from = null;
  let to = null;
  for (let i = 252; i < spy.n; i += BACKTEST_STEP) {
    const date = spy.dates[i];
    from = from || date;
    to = date;
    weeks += 1;
    const spyF = featuresAt(spy, i);
    const qqqI = advance("qqq", date);
    const qqqF = qqqI >= 60 ? featuresAt(prep.qqq, qqqI) : { available: false, higherLow: false, holding: false };
    const hyI = advance("hy", date);
    const igI = advance("ig", date);
    const peakDate = spyF.peakDate || null;
    const credit = combineCredit(
      creditAt(prep.series.hy, hyI, peakDate),
      creditAt(prep.series.ig, igI, peakDate),
    );
    const catalyst = peakDate ? readCatalyst(seriesOf, peakDate, date) : { easing: false };
    const stressI = advance("stress", date);
    const liquidity = readLiquidity(stressI >= 0 ? liquidityPoint(prep.series.stress, stressI) : null);
    const active = drawdownActive(spyF);
    const higher = !!(spyF.higherLow && qqqF.higherLow);
    const holding = !!(spyF.holding && qqqF.holding);
    const flags = {
      "credit-stabilizing": active && credit.stoppedWidening,
      "catalyst-easing": active && catalyst.easing,
      "liquidity-stabilizing": active && liquidity.stabilizing,
      "higher-lows": active && higher,
      "reclaim-200": !!(spyF.holding && qqqF.holding && spyF.drawdown != null && spyF.drawdown <= DRAWDOWN_DEEP),
      "proxy-potential": active && catalyst.easing && credit.narrowing && !!(spyF.lifted && qqqF.lifted),
      "proxy-emerging": active && catalyst.easing && credit.narrowing && !!(spyF.lifted && qqqF.lifted) && higher,
      "proxy-confirmed": active && catalyst.easing && credit.stable && higher && holding,
    };
    const outcome = outcomeAt(spy.closes, troughs, i);
    if (outcome?.r63 != null) baseline63.push(outcome.r63);
    if (outcome?.r126 != null) baseline126.push(outcome.r126);
    if (prev) {
      for (const id of Object.keys(flags)) {
        if (!flags[id] || prev[id]) continue;
        const bucket = buckets[id];
        bucket.episodes += 1;
        if (outcome?.resolved) {
          bucket.resolved += 1;
          if (outcome.falsePositive) bucket.falsePos += 1;
          if (outcome.timely) bucket.timely += 1;
          if (outcome.r63 != null) bucket.r63.push(outcome.r63);
          if (outcome.r126 != null) bucket.r126.push(outcome.r126);
        }
        bucket.recent.push({
          date,
          signal: id,
          label: SIGNAL_COPY[id],
          forward63: outcome?.r63 == null ? null : round(outcome.r63 * 100, 1),
          falsePositive: outcome?.resolved ? outcome.falsePositive : null,
          timely: outcome?.timely || false,
          unresolved: !outcome?.resolved,
        });
        if (bucket.recent.length > 8) bucket.recent.shift();
      }
    }
    prev = flags;
  }
  const signals = Object.keys(SIGNAL_COPY).map((id) => {
    const bucket = buckets[id];
    return {
      id,
      label: SIGNAL_COPY[id],
      episodes: bucket.episodes,
      resolved: bucket.resolved,
      falsePositiveRate: rate(bucket.falsePos, bucket.resolved),
      timelyRate: rate(bucket.timely, bucket.resolved),
      median63: finishReturns(bucket.r63),
      median126: finishReturns(bucket.r126),
      thin: bucket.resolved < 8,
    };
  });
  const recent = Object.values(buckets).flatMap((bucket) => bucket.recent).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  return {
    status: "ok",
    from,
    to,
    weeks,
    baseline63: finishReturns(baseline63),
    baseline126: finishReturns(baseline126),
    signals,
    recent,
    note: "A false positive is a completed 63-session window whose lowest SPY close was at least 5% under the signal close. Near a major low means a 15% drawdown trough, the lowest close in a 126-session window, landed within 21 sessions after the signal or 10 before it. Earnings revisions and tracked-stock breadth are not in this history. Rates on fewer than 8 completed episodes are shown, and they are too thin to trust.",
  };
}

function sparkOf(series, count = 80) {
  return (series || []).slice(-count).map((row) => round(row.value, 2)).filter((v) => v != null);
}

export function buildBottomTracker(input = {}) {
  const spySeries = points(input.spy);
  const qqqSeries = points(input.qqq);
  const spy = preparePrice(spySeries);
  const qqq = preparePrice(qqqSeries);
  const hy = points(input.hy);
  const ig = points(input.ig);
  const stress = points(input.stress);
  const vix = points(input.vix);
  const dgs2 = points(input.dgs2);
  const cpi = toYearOverYear(points(input.cpi));
  const unrate = points(input.unrate);
  const oil = points(input.oil);
  const dollar = points(input.dollar);
  const dgs10 = points(input.dgs10);
  const asOf = spy.n ? spy.dates[spy.n - 1] : dateKey(input.builtAtIso) || null;
  const spyF = spy.n ? featuresAt(spy, spy.n - 1) : { available: false };
  const qqqF = qqq.n ? featuresAt(qqq, qqq.n - 1) : { available: false, higherLow: false, holding: false };
  const peakDate = spyF.peakDate || null;
  const credit = combineCredit(
    creditAt(hy, lastIndexOnOrBefore(hy, asOf || "9999-99-99"), peakDate),
    creditAt(ig, lastIndexOnOrBefore(ig, asOf || "9999-99-99"), peakDate),
  );
  const catalyst = peakDate ? readCatalyst({ hy, ig, vix, stress, dgs2, cpi, unrate, oil, dollar }, peakDate, asOf) : { status: "unidentified", easing: false, label: null, overlap: false };
  const liquidity = readLiquidity(liquidityPoint(stress, lastIndexOnOrBefore(stress, asOf || "9999-99-99")));
  const tenYIndex = lastIndexOnOrBefore(dgs10, asOf || "9999-99-99");
  const valuation = readValuation(input.forwardPe, tenYIndex >= 0 ? dgs10[tenYIndex].value : null, spyF.drawdown);
  const revisionSummary = Array.isArray(input.revisions) ? summarizeRevisions(input.revisions) : (input.revisions || { unavailable: true, covered: 0 });
  const earnings = readEarnings(revisionSummary);
  const breadthHistory = Array.isArray(input.breadth) ? input.breadth : breadthPath(input.breadthBars);
  const breadth = readBreadth(breadthHistory);
  const judged = judgeLive({ spy: spyF, qqq: qqqF, credit, catalyst, liquidity, earnings, breadth, valuation });
  const prior = [];
  for (const row of input.history || []) {
    if (!row?.date || !row.verdict || row.date === asOf) continue;
    prior.push({ date: row.date, verdict: row.verdict });
  }
  // A recovery is not called off one session. Emerging needs the early evidence
  // within the last 10 days. Confirmation needs the prior recent reading to
  // already have been an emerging recovery, so the stages cannot be skipped.
  prior.sort((a, b) => (a.date < b.date ? -1 : 1));
  const recentPriorVerdict = prior.reduce((latest, row) => {
    const gap = asOf ? (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000 : Infinity;
    return gap > 0 && gap <= 10 ? row.verdict : latest;
  }, null);
  const canEmerge = recentPriorVerdict === "potential" || recentPriorVerdict === "emerging" || recentPriorVerdict === "confirmed";
  const canConfirm = recentPriorVerdict === "emerging" || recentPriorVerdict === "confirmed";
  let heldBack = null;
  if (judged.verdict === "confirmed" && !canConfirm) {
    heldBack = "confirmed";
    judged.verdict = canEmerge ? "emerging" : "potential";
  } else if (judged.verdict === "emerging" && !canEmerge) {
    heldBack = "emerging";
    judged.verdict = "potential";
  }
  const history = asOf ? prior.concat([{ date: asOf, verdict: judged.verdict }]).slice(-HISTORY_CAP) : prior.slice(-HISTORY_CAP);
  const recentPrior = prior.slice(-6);
  const persistence = {
    prior: recentPrior.length,
    same: recentPrior.filter((row) => row.verdict === judged.verdict).length,
    first: recentPrior.length === 0,
    heldBack,
  };
  const view = buildView(judged, {
    spark: { spy: sparkOf(spySeries), hy: sparkOf(hy) },
    persistence,
    heldBack,
  });
  const prep = {
    spy,
    qqq,
    series: { hy, ig, stress, vix, dgs2, cpi, unrate, oil, dollar },
  };
  return {
    version: BOTTOM_TRACKER_VERSION,
    builtAtIso: input.builtAtIso || null,
    asOf,
    verdict: judged.verdict,
    ...view,
    history,
    backtest: backtest(prep),
    method: "A decline of 10% from the three-year high only opens the checklist. It is not a bottom. Damage slowing means the catalyst is easing, both credit spreads have stopped widening, and earnings downgrades are less severe after they were already negative. A forming bottom also needs both spreads to be narrowing, funding stress not rising, and both SPY and QQQ at least 3% off the decline low with that low at least 10 sessions old. A close back under either low cancels it. Emerging recovery adds breadth and a higher low off that same low, and it requires a forming read on a session within the last 10 days. Confirmation adds a 200-day hold, improving earnings forecasts, and stable credit, and it requires the prior recent read to already be an emerging recovery. These bars are fixed. They were not fit to past bottoms.",
  };
}

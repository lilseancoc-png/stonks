// Free pattern pieces. No Gemini, no SerpApi, no new vendor.
// Index history comes from the one long daily-close cache shared with Owner
// Historical Data (data/historical-source-history.json, refreshed once a day
// inside the bake). Everything else is arithmetic on bars, Fear & Greed,
// regime history, and overnight peers the bake already fetched.
//
// Each piece stays separate. Nothing here changes a grade, a pick, or a contract.

import { buildIndexSeasonality } from "./historical-data.mjs";

export const PATTERN_INDEX_SYMBOLS = Object.freeze(["SPY", "QQQ", "IWM"]);
export const PATTERN_VERSION = 2;

function round(n, places = 2) {
  if (!Number.isFinite(n)) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function finite(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function dateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function mergeDailyCloses(bars, extra = []) {
  const byDate = new Map();
  for (const row of [...(bars || []), ...(extra || [])]) {
    const t = dateKey(row?.t ?? row?.date);
    const c = finite(row?.c ?? row?.close);
    if (!t || c == null || c <= 0) continue;
    byDate.set(t, c);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, c]) => ({ t, c }));
}

function dailyReturns(bars) {
  const clean = mergeDailyCloses(bars);
  const out = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1].c;
    const ret = prev > 0 ? clean[i].c / prev - 1 : null;
    if (ret == null || !Number.isFinite(ret)) continue;
    out.push({ date: clean[i].t, ret });
  }
  return out;
}

function summarizeReturns(values) {
  const a = (values || []).filter((x) => Number.isFinite(x));
  if (!a.length) return { n: 0, avgPct: null, hitRatePct: null };
  const avg = a.reduce((sum, x) => sum + x, 0) / a.length;
  const sorted = a.slice().sort((x, y) => x - y);
  const hits = a.filter((x) => x > 0).length;
  return {
    n: a.length,
    avgPct: round(avg * 100),
    medianPct: round((sorted[Math.floor((a.length - 1) / 2)] + sorted[Math.ceil((a.length - 1) / 2)]) / 2 * 100),
    worstPct: round(Math.min(...a) * 100),
    bestPct: round(Math.max(...a) * 100),
    hitRatePct: round((hits / a.length) * 100, 1),
  };
}

// Seasonality has one engine, shared with Owner Historical Data
// (lib/historical-data.mjs). Pattern lab shows its SPY / QQQ / IWM subset.
export function buildSeasonality(bars, asOf) {
  return buildIndexSeasonality(bars, asOf);
}

function stdev(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 20) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function ols(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 40) return { n, beta: null, t: null };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  if (sxx <= 0) return { n, beta: null, t: null };
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - alpha - beta * xs[i]) ** 2;
  const sigma2 = sse / (n - 2);
  const se = Math.sqrt(sigma2 / sxx);
  const t = se > 0 ? beta / se : (sse === 0 && beta !== 0 ? Math.sign(beta) * 99 : 0);
  return { n, beta: round(beta, 3), t: round(t, 2) };
}

export function buildVolatilityCluster(bars) {
  const paired = dailyReturns(bars)
    .map((row) => ({ ret: row.ret, log: Math.log(1 + row.ret) }))
    .filter((row) => Number.isFinite(row.log));
  const abs = paired.map((row) => Math.abs(row.ret));
  const autocorr = pearson(abs.slice(1), abs.slice(0, -1));
  const buckets = { expanding: [], calm: [], neutral: [] };
  let state = "unavailable";
  let rv5 = null;
  let rv20 = null;
  for (let i = 19; i < paired.length; i++) {
    const short = stdev(paired.slice(i - 4, i + 1).map((row) => row.log));
    const long = stdev(paired.slice(i - 19, i + 1).map((row) => row.log));
    if (short == null || long == null || long <= 0) continue;
    const label = short > long * 1.15 ? "expanding" : short < long * 0.85 ? "calm" : "neutral";
    if (i < paired.length - 1) buckets[label].push(Math.abs(paired[i + 1].ret));
    if (i === paired.length - 1) {
      state = label;
      rv5 = round(short * Math.sqrt(252) * 100, 1);
      rv20 = round(long * Math.sqrt(252) * 100, 1);
    }
  }
  const expanding = summarizeReturns(buckets.expanding);
  const calm = summarizeReturns(buckets.calm);
  const enough = expanding.n >= 20 && calm.n >= 20;
  const clusteringPresent = enough && expanding.avgPct != null && calm.avgPct != null && expanding.avgPct > calm.avgPct * 1.05;
  let advisory = "Not enough daily history to compare calm and expanding stretches.";
  if (clusteringPresent && state === "expanding") {
    advisory = "Short-horizon volatility is expanding. On this sample the next day's move was larger after similar stretches, so a mean-reversion fade is lower quality right now.";
  } else if (clusteringPresent && state === "calm") {
    advisory = "Short-horizon volatility is calm versus the last month. On this sample the next day's move was smaller after similar stretches.";
  } else if (clusteringPresent) {
    advisory = "On this sample the next day's move was larger after expanding stretches than after calm ones. The current stretch is in neither bucket, so this is context only.";
  } else if (enough) {
    advisory = "This sample does not show a stable gap between the next move after calm days and after expanding days.";
  } else if (state !== "unavailable") {
    advisory = "The current stretch is labeled, and the calm-versus-expanding sample is still thin.";
  }
  return {
    state,
    rv5Pct: rv5,
    rv20Pct: rv20,
    ratio: rv5 != null && rv20 ? round(rv5 / rv20, 2) : null,
    absReturnAutocorr: round(autocorr, 2),
    sample: {
      expanding: { n: expanding.n, nextAbsPct: expanding.avgPct },
      calm: { n: calm.n, nextAbsPct: calm.avgPct },
      neutral: { n: summarizeReturns(buckets.neutral).n, nextAbsPct: summarizeReturns(buckets.neutral).avgPct },
    },
    clusteringPresent,
    provisional: !enough,
    inSample: true,
    advisory,
  };
}

function returnsByDate(bars) {
  const map = new Map();
  for (const row of dailyReturns(bars)) map.set(row.date, row.ret);
  return map;
}

export function buildLeadLag(peers) {
  const rows = [];
  for (const peer of peers || []) {
    const us = returnsByDate(peer.usBars);
    const foreign = returnsByDate(peer.peerBars);
    const dates = [...us.keys()].filter((date) => foreign.has(date)).sort();
    if (dates.length < 40) continue;
    const sameX = [];
    const sameY = [];
    const lagX = [];
    const lagY = [];
    for (let i = 0; i < dates.length; i++) {
      sameX.push(foreign.get(dates[i]));
      sameY.push(us.get(dates[i]));
      if (i > 0) {
        lagX.push(foreign.get(dates[i - 1]));
        lagY.push(us.get(dates[i]));
      }
    }
    const same = ols(sameX, sameY);
    const lag = ols(lagX, lagY);
    const corr60 = pearson(sameX.slice(-60), sameY.slice(-60));
    const corr120 = dates.length >= 100 ? pearson(sameX.slice(-120), sameY.slice(-120)) : null;
    const broken = corr120 != null && corr60 != null && corr120 >= 0.35 && (corr60 < 0.15 || corr60 <= corr120 - 0.25);
    const leading = peer.sessionClass === "leading";
    const sameUsable = leading && same.n >= 80 && same.t != null && Math.abs(same.t) >= 2;
    const lagUsable = !leading && lag.n >= 80 && lag.t != null && Math.abs(lag.t) >= 2;
    const read = broken
      ? "60-day link has broken"
      : sameUsable
        ? "same-day link is large in-sample"
        : lagUsable
          ? "prior-session link is large in-sample"
          : "too weak";
    rows.push({
      us: peer.us,
      peer: peer.peer,
      sessionClass: peer.sessionClass || "unknown",
      n: same.n,
      sameDayBeta: same.beta,
      sameDayT: same.t,
      lag1Beta: lag.beta,
      lag1T: lag.t,
      lag1N: lag.n,
      corr60: round(corr60, 2),
      corr120: round(corr120, 2),
      broken,
      read,
    });
  }
  rows.sort((a, b) => Number(b.broken) - Number(a.broken) || Math.abs(b.lag1T || 0) - Math.abs(a.lag1T || 0));
  return {
    tested: rows.length,
    usable: rows.filter((row) => row.read !== "too weak").length,
    caveat: "A large in-sample t-stat on daily returns is not a trade. Overlapping days make the t-stat look more certain than it is.",
    broken: rows.filter((row) => row.broken).length,
    rows: rows.slice(0, 120),
  };
}

function emaSeries(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(0, delta)) / period;
    avgL = (avgL * (period - 1) + Math.max(0, -delta)) / period;
    out[i] = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function macdHistSeries(closes, fast = 12, slow = 26, signal = 9) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < slow + signal) return out;
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const line = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const signalLine = emaSeries(line.slice(slow - 1), signal);
  for (let k = signal - 1; k < signalLine.length; k++) {
    const index = slow - 1 + k;
    out[index] = line[index] - signalLine[k];
  }
  return out;
}

function pivotIndexes(values, end, k, kind) {
  const pivots = [];
  const last = Math.min(end, values.length - 1) - k;
  for (let i = k; i <= last; i++) {
    if (!Number.isFinite(values[i])) continue;
    let ok = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i || !Number.isFinite(values[j])) continue;
      if (kind === "low" ? values[j] < values[i] : values[j] > values[i]) { ok = false; break; }
    }
    if (ok) pivots.push(i);
  }
  return pivots;
}

function indicatorDiverges(older, newer, mode, direction) {
  if (!Number.isFinite(older) || !Number.isFinite(newer)) return false;
  if (mode === "rsi") return direction === "bullish" ? newer > older + 2 : newer < older - 2;
  const gap = Math.max(1e-4, Math.abs(older) * 0.1);
  return direction === "bullish" ? newer > older + gap : newer < older - gap;
}

function latestDivergence(closes, indicator, dates, end, mode) {
  const lows = pivotIndexes(closes, end, 3, "low");
  const high = pivotIndexes(closes, end, 3, "high");
  const windowStart = end - 70;
  const recent = (indexes) => indexes.filter((index) => index >= windowStart && index <= end - 3);
  const pick = (indexes, direction) => {
    const pair = recent(indexes).slice(-2);
    if (pair.length < 2) return null;
    const [older, newer] = pair;
    if (end - newer > 12) return null;
    const priceOk = direction === "bullish"
      ? closes[newer] < closes[older] * 0.995
      : closes[newer] > closes[older] * 1.005;
    if (!priceOk || !indicatorDiverges(indicator[older], indicator[newer], mode, direction)) return null;
    return {
      indicator: mode,
      direction,
      olderDate: dates[older] || null,
      newerDate: dates[newer] || null,
      priceChangePct: round((closes[newer] / closes[older] - 1) * 100),
      indicatorOlder: round(indicator[older], mode === "rsi" ? 1 : 3),
      indicatorNewer: round(indicator[newer], mode === "rsi" ? 1 : 3),
    };
  };
  return pick(lows, "bullish") || pick(high, "bearish");
}

export function buildDivergenceStudy(series) {
  const current = [];
  const buckets = {
    rsiBullish: [], rsiBearish: [], macdBullish: [], macdBearish: [],
  };
  const baseline = [];
  for (const row of series || []) {
    const paired = [];
    const rawCloses = row.closes || [];
    const rawDates = row.dates || [];
    for (let i = 0; i < rawCloses.length; i++) {
      const close = Number(rawCloses[i]);
      const date = dateKey(rawDates[i]);
      if (close > 0 && date) paired.push({ date, close });
    }
    const closes = paired.map((point) => point.close);
    const dates = paired.map((point) => point.date);
    if (closes.length < 80) continue;
    let brokenPrint = false;
    for (let i = 1; i < closes.length; i++) {
      if (Math.abs(closes[i] / closes[i - 1] - 1) > 0.4) { brokenPrint = true; break; }
    }
    if (brokenPrint) continue;
    const rsi = rsiSeries(closes);
    const macd = macdHistSeries(closes);
    const end = closes.length - 1;
    for (const mode of ["rsi", "macd"]) {
      const found = latestDivergence(closes, mode === "rsi" ? rsi : macd, dates, end, mode);
      if (found) current.push({ symbol: row.symbol, ...found });
    }
    for (let i = 80; i < closes.length - 10; i += 5) {
      const forward = closes[i + 10] / closes[i] - 1;
      if (!Number.isFinite(forward)) continue;
      baseline.push(forward);
      for (const mode of ["rsi", "macd"]) {
        const found = latestDivergence(closes, mode === "rsi" ? rsi : macd, dates, i, mode);
        if (!found) continue;
        buckets[`${mode}${found.direction === "bullish" ? "Bullish" : "Bearish"}`].push(
          found.direction === "bullish" ? forward : -forward,
        );
      }
    }
  }
  const base = summarizeReturns(baseline);
  const record = {};
  for (const [key, values] of Object.entries(buckets)) {
    const stats = summarizeReturns(values);
    record[key] = {
      ...stats,
      baselineAvgPct: base.avgPct == null ? null : key.endsWith('Bearish') ? -base.avgPct : base.avgPct,
      baselineN: base.n,
      provisional: stats.n < 30,
    };
  }
  current.sort((a, b) => String(b.newerDate || "").localeCompare(String(a.newerDate || "")));
  return {
    rows: current.slice(0, 40),
    record,
    baselineN: base.n,
    note: "Each figure is the average move over the next 10 sessions, signed in the divergence's direction. Checks overlap every 5 bars, so the count is not a count of independent trades. A one-day move larger than 40% drops that name. This does not change the technical score.",
  };
}

function forwardReturn(bars, date, sessions) {
  const clean = mergeDailyCloses(bars);
  const index = clean.findIndex((row) => row.t >= date);
  if (index < 0 || index + sessions >= clean.length) return null;
  const start = clean[index].c;
  return start > 0 ? clean[index + sessions].c / start - 1 : null;
}

function trailingReturn(bars, date, sessions) {
  const clean = mergeDailyCloses(bars);
  const index = clean.findIndex((row) => row.t >= date);
  if (index < sessions) return null;
  const start = clean[index - sessions].c;
  return start > 0 ? clean[index].c / start - 1 : null;
}

export function buildSentimentAnomaly(points, spyBars) {
  const rows = (points || [])
    .map((row) => ({ date: dateKey(row?.date), score: finite(row?.score) }))
    .filter((row) => row.date && row.score != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const fear = [];
  const greed = [];
  let latest = null;
  for (const row of rows) {
    const trail = trailingReturn(spyBars, row.date, 5);
    const ahead = forwardReturn(spyBars, row.date, 10);
    if (trail == null) continue;
    const fearDisagree = row.score <= 25 && trail >= 0.01;
    const greedDisagree = row.score >= 75 && trail <= -0.01;
    if (ahead != null && fearDisagree) fear.push(ahead);
    if (ahead != null && greedDisagree) greed.push(ahead);
    latest = {
      date: row.date,
      score: round(row.score, 1),
      spy5dPct: round(trail * 100),
      fearDisagree,
      greedDisagree,
    };
  }
  const fearStats = summarizeReturns(fear);
  const greedStats = summarizeReturns(greed);
  let state = "aligned";
  if (latest?.fearDisagree) state = "fear while price is up";
  else if (latest?.greedDisagree) state = "greed while price is down";
  else if (!latest) state = "unavailable";
  return {
    state,
    latest,
    fear: { ...fearStats, provisional: fearStats.n < 20 },
    greed: { ...greedStats, provisional: greedStats.n < 20 },
    rules: "Extreme fear is 25 or below and extreme greed is 75 or above. Disagreement needs a 5-session S&P move of at least 1% the other way.",
  };
}

export function buildBreadthRecord(regimeDays, spyBars) {
  const flagged = [];
  let latest = null;
  for (const day of regimeDays || []) {
    const date = dateKey(day?.date);
    const indexes = finite(day?.axisScores?.indexes);
    const breadth = finite(day?.axisScores?.breadth);
    if (!date || indexes == null || breadth == null) continue;
    const active = indexes >= 0 && breadth < 0;
    const ahead5 = forwardReturn(spyBars, date, 5);
    const ahead10 = forwardReturn(spyBars, date, 10);
    if (active && ahead5 != null) flagged.push({ d5: ahead5, d10: ahead10 });
    latest = { date, active, indexes, breadth };
  }
  const d5 = summarizeReturns(flagged.map((row) => row.d5));
  const d10 = summarizeReturns(flagged.map((row) => row.d10).filter((x) => x != null));
  return {
    active: !!latest?.active,
    latest,
    forward5: { ...d5, provisional: d5.n < 20 },
    forward10: { ...d10, provisional: d10.n < 20 },
    note: "A day counts when the index axis is flat or up and the breadth axis is down. The forward numbers are S&P returns after those days.",
  };
}

export function buildPatternRecognition(input = {}) {
  const asOf = dateKey(input.asOf);
  const spy = mergeDailyCloses(input.indexBars?.SPY || input.spyBars);
  const seasonality = {};
  for (const symbol of PATTERN_INDEX_SYMBOLS) {
    const bars = mergeDailyCloses(input.indexBars?.[symbol]);
    seasonality[symbol] = bars.length >= 40
      ? buildSeasonality(bars, asOf)
      : { sessions: bars.length, provisional: true, unavailable: true };
  }
  const divergence = buildDivergenceStudy(input.divergences || []);
  return {
    version: PATTERN_VERSION,
    builtAtIso: input.builtAtIso || null,
    asOf,
    history: {
      requestedStockYears: 2,
      stocks: (input.divergences || []).map(row => ({symbol: row.symbol, sessions: row.closes?.length || 0, firstDate: row.dates?.[0] || null, lastDate: row.dates?.at(-1) || null})),
      note: "Stock studies request two years of daily history. New listings and missing history may provide less. Calendar seasonality uses the separate long-history index cache; sentiment and breadth use their accumulated logs.",
    },
    cost: {
      gemini: false,
      serpApi: false,
      newVendor: false,
      extraYahooCharts: Number(input.extraYahooCharts) || 0,
      note: "No model call or additional stock-history request. Two-year stock histories reuse the daily chart request; index seasonality uses the shared long-history cache.",
    },
    separate: true,
    pieces: {
      volatility: buildVolatilityCluster(input.spyBars?.length ? input.spyBars : spy),
      seasonality,
      leadLag: buildLeadLag(input.peers),
      divergences: divergence,
      breadth: buildBreadthRecord(input.regimeDays, spy.length ? spy : input.spyBars),
      sentiment: buildSentimentAnomaly(input.fearGreed, spy.length ? spy : input.spyBars),
    },
  };
}

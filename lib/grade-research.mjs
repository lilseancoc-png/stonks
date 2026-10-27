// Grade-edge research and paper risk books.
//
// Pure, deterministic, and offline. No network and no model calls. The bake
// writes data/grade-research.json from grades already stored and from daily
// closes already stored. The Track Record tab only renders that file.
//
// The grade test never uses the option take-profit or stop. Those exits set
// the option win rate, so they cannot answer whether the grade ranks stocks.
// Paper books are a separate $100,000 account under frozen rules.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bsPrice } from "./greeks.mjs";
import { completedCloseCutoff } from './historical-market-calendar.mjs';

export const GRADE_RESEARCH_FILE = "grade-research.json";
export const RESEARCH_HORIZONS = Object.freeze([5, 10, 14]);
export const RESEARCH_HOLD = 10;
export const RESEARCH_START = 100_000;
export const RESEARCH_CAGR_MIN_DAYS = 365;
export const RESEARCH_PLACEBO_DRAWS = 200;
export const RESEARCH_PLACEBO_SEED = 1337;
export const RESEARCH_MIN_NAMES = 20;
export const RESEARCH_BETA_WINDOW = 60;
export const RESEARCH_BETA_MIN = 20;
export const RESEARCH_KILL_DAYS = 30;
export const RESEARCH_EVALUATION_HORIZON = 5;
const RFR = 0.045;
const STOP_FLOOR = 0.01;

const round = (value, digits) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
};

function mean(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((sum, v) => sum + v, 0) / xs.length : null;
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const v = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function tStat(values) {
  if (values.length < 5) return null;
  const sd = sampleSd(values);
  const m = mean(values);
  if (m == null || !(sd > 0)) return null;
  return m / (sd / Math.sqrt(values.length));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function spearman(pairs) {
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  if (pairs.length < 3) return null;
  const xs = rank(pairs.map((p) => p[0]));
  const ys = rank(pairs.map((p) => p[1]));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let k = 0; k < n; k += 1) {
    const dx = xs[k] - mx;
    const dy = ys[k] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (!(vx > 0) || !(vy > 0)) return null;
  return cov / Math.sqrt(vx * vy);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function prepareSeries(raw) {
  const rows = [];
  const datesIn = raw?.dates || raw?.t || [];
  const closesIn = raw?.closes || raw?.c || [];
  for (let i = 0; i < datesIn.length; i += 1) {
    const date = String(datesIn[i] || "").slice(0, 10);
    const close = Number(closesIn[i]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue;
    rows.push({ date, close });
  }
  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const dates = [];
  const closes = [];
  for (const row of rows) {
    if (dates.length && dates[dates.length - 1] === row.date) closes[closes.length - 1] = row.close;
    else {
      dates.push(row.date);
      closes.push(row.close);
    }
  }
  return { dates, closes, index: new Map(dates.map((date, i) => [date, i])) };
}

export function seriesFromChains(chains, { asOf = null } = {}) {
  const out = {};
  const cutoff = asOf ? completedCloseCutoff(asOf) : null;
  for (const [symbol, data] of Object.entries(chains || {})) {
    const bars = data?._bars;
    const ps = Array.isArray(bars) && bars.length ? { t: bars.map(b => b.t), c: bars.map(b => b.c) } : data?.priceSeries;
    if (!ps) continue;
    const prepared = prepareSeries(ps);
    const accepted = prepared.dates.map((date,i)=>({date,close:prepared.closes[i]})).filter(row=>!cutoff||row.date<=cutoff);
    const series = prepareSeries({dates:accepted.map(r=>r.date),closes:accepted.map(r=>r.close)});
    if (series.dates.length >= 2) out[symbol] = series;
  }
  return out;
}

function indexOnOrBefore(series, date) {
  if (!series || !date) return null;
  if (series.index.has(date)) return series.index.get(date);
  let lo = 0;
  let hi = series.dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.dates[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? ans : null;
}

function closeAt(series, date) {
  const i = indexOnOrBefore(series, date);
  return i == null ? null : series.closes[i];
}

function forwardReturn(series, date, horizon, delay = 0) {
  const base = indexOnOrBefore(series, date);
  if (base == null) return null;
  const entry = base + delay;
  const exit = entry + horizon;
  if (entry < 0 || exit >= series.closes.length) return null;
  const a = series.closes[entry];
  const b = series.closes[exit];
  if (!(a > 0) || !(b > 0)) return null;
  return { ret: (b / a - 1) * 100, entry, exit };
}

function trailingBeta(stock, spy, endIdx) {
  if (!stock || !spy || endIdx == null) return 1;
  const stockR = [];
  const spyR = [];
  for (let i = endIdx; i > 0 && stockR.length < RESEARCH_BETA_WINDOW; i -= 1) {
    const d0 = stock.dates[i - 1];
    const d1 = stock.dates[i];
    const m0 = closeAt(spy, d0);
    const m1 = closeAt(spy, d1);
    const s0 = stock.closes[i - 1];
    const s1 = stock.closes[i];
    if (!(m0 > 0) || !(m1 > 0) || !(s0 > 0) || !(s1 > 0)) continue;
    stockR.push(s1 / s0 - 1);
    spyR.push(m1 / m0 - 1);
  }
  if (stockR.length < RESEARCH_BETA_MIN) return 1;
  const n = stockR.length;
  const ms = stockR.reduce((s, v) => s + v, 0) / n;
  const mm = spyR.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const a = stockR[i] - ms;
    const b = spyR[i] - mm;
    cov += a * b;
    variance += b * b;
  }
  if (!(variance > 0)) return 1;
  return cov / variance;
}

function sectorDemean(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.sector || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    if (group.length < 2) {
      for (const row of group) row.residual = row.excess;
      continue;
    }
    const sum = group.reduce((s, row) => s + row.excess, 0);
    for (const row of group) row.residual = row.excess - (sum - row.excess) / (group.length - 1);
  }
}

function quintileOf(rank, n) {
  return Math.min(4, Math.floor((rank * 5) / n));
}

function summarizeIc(dayStats, dateSet) {
  const rows = dayStats.filter((day) => dateSet.has(day.date) && day.ic != null);
  const ics = rows.map((day) => day.ic);
  return {
    days: rows.length,
    meanIc: round(mean(ics), 4),
    tStat: round(tStat(ics), 2),
    positiveDayShare: ics.length ? round(ics.filter((v) => v > 0).length / ics.length, 4) : null,
    dates: rows.map((day) => day.date),
  };
}

function nonOverlappingDates(dates, spy, horizon) {
  if (!spy?.dates?.length) {
    const out = [];
    for (let i = 0; i < dates.length; i += horizon) out.push(dates[i]);
    return out;
  }
  const out = [];
  let next = -Infinity;
  for (const date of dates) {
    const idx = indexOnOrBefore(spy, date);
    if (idx == null) continue;
    if (idx >= next) {
      out.push(date);
      next = idx + horizon;
    }
  }
  return out;
}

function dayRows(day, series, spy, sectors, horizon) {
  const rows = [];
  const spyMove = spy ? forwardReturn(spy, day.date, horizon, 0) : null;
  const spyDelay = spy ? forwardReturn(spy, day.date, horizon, 1) : null;
  for (const [symbol, raw] of Object.entries(day.totals || {})) {
    const grade = Number(raw);
    const stock = series[symbol];
    if (!Number.isFinite(grade) || !stock) continue;
    const fwd = forwardReturn(stock, day.date, horizon, 0);
    if (!fwd) continue;
    const delayed = forwardReturn(stock, day.date, horizon, 1);
    const endIdx = indexOnOrBefore(stock, day.date);
    const beta = trailingBeta(stock, spy, endIdx);
    const spyRet = spyMove ? spyMove.ret : 0;
    const spyRetDelay = spyDelay ? spyDelay.ret : 0;
    rows.push({
      symbol,
      grade,
      sector: sectors?.[symbol] || "Unknown",
      fwd: fwd.ret,
      delayed: delayed ? delayed.ret : null,
      beta,
      excess: fwd.ret - beta * spyRet,
      excessDelay: delayed ? delayed.ret - beta * spyRetDelay : null,
    });
  }
  if (rows.length < RESEARCH_MIN_NAMES) return [];
  rows.sort((a, b) => a.grade - b.grade || a.symbol.localeCompare(b.symbol));
  sectorDemean(rows);
  const delayRows = rows.filter((row) => row.excessDelay != null).map((row) => ({ ...row, excess: row.excessDelay }));
  if (delayRows.length >= RESEARCH_MIN_NAMES) sectorDemean(delayRows);
  const delayResidual = new Map(delayRows.map((row) => [row.symbol, row.residual]));
  for (const row of rows) row.residualDelay = delayResidual.get(row.symbol) ?? null;
  return rows;
}

function decileSpread(rows, field) {
  const usable = rows.filter((row) => Number.isFinite(row[field]));
  if (usable.length < RESEARCH_MIN_NAMES) return null;
  const width = Math.max(1, Math.floor(usable.length / 10));
  const bottom = mean(usable.slice(0, width).map((row) => row[field]));
  const top = mean(usable.slice(-width).map((row) => row[field]));
  if (bottom == null || top == null) return null;
  return top - bottom;
}

function quintileLadder(days) {
  const bins = [0, 1, 2, 3, 4].map((bin) => ({ bin, means: [], hits: [], n: 0 }));
  for (const day of days) {
    const n = day.rows.length;
    const groups = [[], [], [], [], []];
    day.rows.forEach((row, rank) => groups[quintileOf(rank, n)].push(row.fwd));
    groups.forEach((group, bin) => {
      if (!group.length) return;
      bins[bin].means.push(mean(group));
      bins[bin].hits.push(group.filter((v) => v > 0).length / group.length);
      bins[bin].n += group.length;
    });
  }
  const labels = ["Q1 lowest", "Q2", "Q3", "Q4", "Q5 highest"];
  return bins.map((bin, i) => ({
    bin: i + 1,
    label: labels[i],
    n: bin.n,
    meanFwdPct: round(mean(bin.means), 2),
    hitRate: round(mean(bin.hits), 4),
  }));
}

function orderedLadder(ladder) {
  const means = ladder.map((bin) => bin.meanFwdPct);
  if (means.some((v) => v == null)) return false;
  for (let i = 1; i < means.length; i += 1) if (!(means[i] > means[i - 1])) return false;
  return true;
}

function placeboBand(days, dateSet, draws, seed) {
  const selected = days.filter((day) => dateSet.has(day.date));
  const live = mean(selected.map((day) => day.ic).filter((v) => v != null));
  if (!selected.length || live == null || draws < 1) {
    return { draws, liveMeanIc: round(live, 4), p05: null, p50: null, p95: null, above95: false };
  }
  const rng = mulberry32(seed);
  const samples = [];
  for (let draw = 0; draw < draws; draw += 1) {
    const ics = [];
    for (const day of selected) {
      const grades = shuffle(day.rows.map((row) => row.grade), rng);
      const pairs = day.rows.map((row, i) => [grades[i], row.fwd]);
      const ic = spearman(pairs);
      if (ic != null) ics.push(ic);
    }
    const m = mean(ics);
    if (m != null) samples.push(m);
  }
  samples.sort((a, b) => a - b);
  const p95 = quantile(samples, 0.95);
  return {
    draws: samples.length,
    liveMeanIc: round(live, 4),
    p05: round(quantile(samples, 0.05), 4),
    p50: round(quantile(samples, 0.50), 4),
    p95: round(p95, 4),
    above95: p95 != null && live > p95,
  };
}

function horizonReport(days, series, spy, sectors, horizon, draws, seed) {
  const evaluated = [];
  for (const day of days) {
    const rows = dayRows(day, series, spy, sectors, horizon);
    if (!rows.length) continue;
    const ic = spearman(rows.map((row) => [row.grade, row.fwd]));
    const residualIc = spearman(rows.map((row) => [row.grade, row.residual]));
    const delayPairs = rows.filter((row) => row.delayed != null);
    const delayIc = delayPairs.length >= RESEARCH_MIN_NAMES
      ? spearman(delayPairs.map((row) => [row.grade, row.delayed]))
      : null;
    evaluated.push({
      date: day.date,
      rows,
      ic,
      residualIc,
      delayIc,
      spread: decileSpread(rows, "fwd"),
      residualSpread: decileSpread(rows, "residual"),
      delaySpread: decileSpread(rows.filter((row) => row.delayed != null), "delayed"),
    });
  }
  const resolvedDates = evaluated.map((day) => day.date);
  const independent = new Set(nonOverlappingDates(resolvedDates, spy || { dates: resolvedDates, closes: [], index: new Map() }, horizon));
  const all = new Set(resolvedDates);
  const residualDays = evaluated.filter((day) => independent.has(day.date) && day.residualSpread != null);
  const delayDays = evaluated.filter((day) => independent.has(day.date) && day.delayIc != null);
  return {
    overlapping: summarizeIc(evaluated, all),
    nonOverlapping: summarizeIc(evaluated, independent),
    quintiles: quintileLadder(evaluated),
    quintileOrdered: orderedLadder(quintileLadder(evaluated)),
    residual: {
      meanIc: round(mean(evaluated.map((day) => day.residualIc)), 4),
      meanSpreadPct: round(mean(evaluated.map((day) => day.residualSpread)), 2),
      nonOverlappingIc: round(mean(residualDays.map((day) => day.residualIc)), 4),
      nonOverlappingSpreadPct: round(mean(residualDays.map((day) => day.residualSpread)), 2),
      nonOverlappingDays: residualDays.length,
    },
    delay: {
      meanIc: round(mean(evaluated.map((day) => day.delayIc)), 4),
      meanSpreadPct: round(mean(evaluated.map((day) => day.delaySpread)), 2),
      nonOverlappingIc: round(mean(delayDays.map((day) => day.delayIc)), 4),
      nonOverlappingSpreadPct: round(mean(delayDays.map((day) => day.delaySpread)), 2),
      nonOverlappingDays: delayDays.length,
    },
    placebo: placeboBand(evaluated, independent, draws, seed + horizon),
  };
}

function calendarSpan(startDate, endDate) {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 86400000;
}

function curveStats(curve, start) {
  let peak = start;
  let maxDD = 0;
  let maxDDpct = 0;
  for (const point of curve) {
    if (point.value > peak) peak = point.value;
    const drop = peak - point.value;
    if (drop > maxDD) {
      maxDD = drop;
      maxDDpct = peak > 0 ? drop / peak : 0;
    }
  }
  const final = curve.length ? curve[curve.length - 1].value : start;
  const startDate = curve[0]?.date || null;
  const endDate = curve[curve.length - 1]?.date || null;
  const spanDays = startDate && endDate ? calendarSpan(startDate, endDate) : 0;
  const cagr = spanDays >= RESEARCH_CAGR_MIN_DAYS && start > 0 && final > 0
    ? Math.pow(final / start, 365.25 / spanDays) - 1
    : null;
  return {
    start,
    final: round(final, 2),
    returnPct: start > 0 ? round((final / start - 1) * 100, 2) : null,
    maxDrawdown: round(maxDD, 2),
    maxDrawdownPct: round(maxDDpct * 100, 2),
    cagr: round(cagr, 4),
    spanDays: round(spanDays, 1),
    curve: curve.map((point) => ({ date: point.date, value: round(point.value, 2) })),
  };
}

function normalizePicks(picks, sectors) {
  const rows = [];
  const seen = new Set();
  for (const pick of [...(picks?.closed || []), ...(picks?.open || [])]) {
    if (!pick?.symbol || !pick.entryDate) continue;
    const entryDate = String(pick.entryDate).slice(0, 10);
    const side = pick.side === "put" ? "put" : "call";
    const key = `${pick.symbol}:${side}:${entryDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contract = pick.contract || {};
    rows.push({
      symbol: pick.symbol,
      side,
      entryDate,
      cut: Number(pick.cut),
      sector: pick.sector || sectors?.[pick.symbol] || "Unknown",
      score: Math.abs(Number(pick.score)) || 0,
      iv: Number(contract.iv),
      strike: Number(contract.strike),
      dte: Number(contract.dte),
      mid: Number(contract.mid),
      structure: contract.structure || "long",
    });
  }
  return rows;
}

function simulateStockBook(picks, series, opts) {
  const skipped = { pending: 0, stop: 0, slot: 0, sector: 0, gross: 0, flat: 0, data: 0 };
  const requests = [];
  for (const pick of picks) {
    const stock = series[pick.symbol];
    if (!stock) {
      skipped.data += 1;
      continue;
    }
    let entry = indexOnOrBefore(stock, pick.entryDate);
    if (entry == null) {
      skipped.data += 1;
      continue;
    }
    if (opts.delay) entry += 1;
    const exit = entry + opts.hold;
    if (exit >= stock.dates.length) {
      skipped.pending += 1;
      continue;
    }
    let stopFrac = null;
    if (opts.mode === "risk") {
      const entryPrice = stock.closes[entry];
      if (!(entryPrice > 0) || !(pick.cut > 0)) {
        skipped.stop += 1;
        continue;
      }
      stopFrac = Math.abs(entryPrice - pick.cut) / entryPrice;
      if (!(stopFrac > 0)) {
        skipped.stop += 1;
        continue;
      }
      if (stopFrac < STOP_FLOOR) stopFrac = STOP_FLOOR;
    }
    requests.push({
      ...pick,
      entry,
      exit,
      entryDate: stock.dates[entry],
      exitDate: stock.dates[exit],
      entryPrice: stock.closes[entry],
      exitPrice: stock.closes[exit],
      stopFrac,
    });
  }
  if (!requests.length) {
    return { taken: [], skipped, curve: [{ date: null, value: RESEARCH_START }] };
  }
  const dates = new Set();
  for (const stock of Object.values(series)) {
    for (const date of stock.dates) dates.add(date);
  }
  const first = requests.reduce((min, row) => row.entryDate < min ? row.entryDate : min, requests[0].entryDate);
  const last = requests.reduce((max, row) => row.exitDate > max ? row.exitDate : max, requests[0].exitDate);
  const calendar = [...dates].filter((date) => date >= first && date <= last).sort();
  const byDate = new Map();
  for (const row of requests) {
    if (!byDate.has(row.entryDate)) byDate.set(row.entryDate, []);
    byDate.get(row.entryDate).push(row);
  }
  let cash = RESEARCH_START;
  let peak = RESEARCH_START;
  let open = [];
  const taken = [];
  const curve = [];
  for (const date of calendar) {
    for (const pos of open) {
      if (date <= pos.entryDate) continue;
      const px = closeAt(pos.stock, date);
      if (!(px > 0) || !(pos.lastPrice > 0)) continue;
      const sign = pos.side === "put" ? -1 : 1;
      pos.pnl += pos.notional * sign * ((px - pos.lastPrice) / pos.entryPrice);
      pos.lastPrice = px;
    }
    const still = [];
    for (const pos of open) {
      if (pos.exitDate === date) {
        cash += pos.notional + pos.pnl;
        taken.push(pos);
      } else still.push(pos);
    }
    open = still;
    let equity = cash + open.reduce((sum, pos) => sum + pos.notional + pos.pnl, 0);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    const todays = (byDate.get(date) || []).slice().sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    for (const req of todays) {
      if (opts.flatAt20 && dd >= 0.20) {
        skipped.flat += 1;
        continue;
      }
      if (open.length >= opts.maxPos) {
        skipped.slot += 1;
        continue;
      }
      if (opts.sectorCap && req.sector && req.sector !== "Unknown") {
        const held = open.filter((pos) => pos.sector === req.sector).length;
        if (held >= opts.sectorCap) {
          skipped.sector += 1;
          continue;
        }
      }
      const grossCap = opts.throttle && dd >= 0.10 ? 0.5 : 1;
      const grossNow = open.reduce((sum, pos) => sum + pos.notional, 0);
      const room = Math.min(cash, grossCap * equity - grossNow);
      if (!(room > 1)) {
        skipped.gross += 1;
        continue;
      }
      let notional = opts.mode === "equal" ? equity / opts.maxPos : equity * 0.005 / req.stopFrac;
      if (notional > room) notional = room;
      if (!(notional > 1)) {
        skipped.gross += 1;
        continue;
      }
      cash -= notional;
      open.push({
        ...req,
        stock: series[req.symbol],
        notional,
        pnl: 0,
        lastPrice: req.entryPrice,
      });
      equity = cash + open.reduce((sum, pos) => sum + pos.notional + pos.pnl, 0);
    }
    if (equity > peak) peak = equity;
    curve.push({ date, value: equity });
  }
  return { taken, skipped, curve };
}

function optionStress(taken) {
  const plain = [];
  const crushed = [];
  const capped = [];
  let skipped = 0;
  for (const trade of taken) {
    if (trade.structure && trade.structure !== "long") {
      skipped += 1;
      continue;
    }
    if (!(trade.iv > 0) || !(trade.strike > 0) || !(trade.dte > 0) || !(trade.entryPrice > 0) || !(trade.exitPrice > 0)) {
      skipped += 1;
      continue;
    }
    const heldDays = calendarSpan(trade.entryDate, trade.exitDate);
    const t0 = trade.dte / 365.25;
    const t1 = (trade.dte - heldDays) / 365.25;
    const entryTheo = bsPrice(trade.side, trade.entryPrice, trade.strike, t0, trade.iv, RFR);
    const exitSame = t1 <= 0
      ? (trade.side === "call" ? Math.max(0, trade.exitPrice - trade.strike) : Math.max(0, trade.strike - trade.exitPrice))
      : bsPrice(trade.side, trade.exitPrice, trade.strike, t1, trade.iv, RFR);
    const exitCrush = t1 <= 0
      ? exitSame
      : bsPrice(trade.side, trade.exitPrice, trade.strike, t1, trade.iv * 0.8, RFR);
    const cost = trade.mid > 0 ? trade.mid : entryTheo;
    if (!(cost > 0) || !(exitSame >= 0) || exitCrush == null) {
      skipped += 1;
      continue;
    }
    plain.push((exitSame / cost - 1) * 100);
    crushed.push((exitCrush / cost - 1) * 100);
    capped.push(((exitSame * 0.94) / (cost * 1.06) - 1) * 100);
  }
  return {
    n: plain.length,
    skipped,
    unchangedPct: round(mean(plain), 2),
    ivDown20Pct: round(mean(crushed), 2),
    spreadCapPct: round(mean(capped), 2),
    note: "Option stress reprices the stored strike, IV, and DTE with Black-Scholes. IV down 20% changes only the exit volatility. The spread-cap case buys 6% above the stored mid and sells 6% below the theoretical exit, the full 12% naked-spread cap split across the two fills. It is a bound, not the quote on that day. Verticals are left out.",
  };
}

function finishBook(id, label, rule, result, extra = {}) {
  const stats = curveStats(result.curve.filter((point) => point.date), RESEARCH_START);
  const rs = result.taken.map((trade) => {
    if (!(trade.notional > 0)) return null;
    if (trade.stopFrac > 0) return trade.pnl / (trade.notional * trade.stopFrac);
    return trade.pnl / trade.notional;
  }).filter((v) => Number.isFinite(v));
  return {
    id,
    label,
    rule,
    ...stats,
    trades: result.taken.length,
    avgR: round(mean(rs), 3),
    skipped: result.skipped,
    ...extra,
  };
}

function gradeScaleBook(days, series, spy) {
  const horizon = RESEARCH_HOLD;
  const evaluated = [];
  for (const day of days) {
    const rows = dayRows(day, series, spy, null, horizon);
    if (rows.length >= RESEARCH_MIN_NAMES) evaluated.push({ date: day.date, rows });
  }
  const dates = nonOverlappingDates(evaluated.map((day) => day.date), spy || { dates: [], closes: [], index: new Map() }, horizon);
  const byDate = new Map(evaluated.map((day) => [day.date, day]));
  let equity = RESEARCH_START;
  const curve = [];
  const cohortReturns = [];
  let first = null;
  let last = null;
  for (const date of dates) {
    const day = byDate.get(date);
    if (!day) continue;
    const width = Math.max(1, Math.floor(day.rows.length / 10));
    const bottom = mean(day.rows.slice(0, width).map((row) => row.fwd));
    const top = mean(day.rows.slice(-width).map((row) => row.fwd));
    if (bottom == null || top == null) continue;
    const ret = 0.5 * (top - bottom) / 100;
    const exitIdx = indexOnOrBefore(spy, date);
    const exitDate = exitIdx != null && spy?.dates[exitIdx + horizon] ? spy.dates[exitIdx + horizon] : date;
    if (!first) {
      first = date;
      curve.push({ date, value: equity });
    }
    equity *= 1 + ret;
    last = exitDate;
    curve.push({ date: exitDate, value: equity });
    cohortReturns.push(ret);
  }
  if (!curve.length) curve.push({ date: null, value: RESEARCH_START });
  const stats = curveStats(curve.filter((point) => point.date), RESEARCH_START);
  return {
    id: "scale",
    label: "Grade scale",
    rule: "Every 10 trading days, long the top grade decile and short the bottom decile in equal weight. Stock return only. No option exit and no actionable gate. Each side is half the account, and the next book starts when the prior hold ends.",
    ...stats,
    trades: cohortReturns.length,
    avgR: round(mean(cohortReturns), 3),
    skipped: { pending: 0, stop: 0, slot: 0, sector: 0, gross: 0, flat: 0, data: 0 },
    firstDate: first,
    lastDate: last,
  };
}

export function buildGradeResearch({
  days = [],
  series = {},
  sectors = {},
  picks = null,
  builtAtIso = null,
  spy = "SPY",
  placeboDraws = RESEARCH_PLACEBO_DRAWS,
  seed = RESEARCH_PLACEBO_SEED,
} = {}) {
  const prepared = {};
  for (const [symbol, raw] of Object.entries(series || {})) {
    const next = raw?.dates && raw?.closes && raw?.index ? raw : prepareSeries(raw);
    if (next.dates.length >= 2) prepared[symbol] = next;
  }
  const spySeries = prepared[spy] || null;
  const snapshotDays = [];
  const seen = new Set();
  for (const day of [...(days || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    if (!day?.date || !day.totals || seen.has(day.date)) continue;
    seen.add(day.date);
    snapshotDays.push({ date: String(day.date).slice(0, 10), totals: day.totals });
  }
  const horizons = {};
  for (const horizon of RESEARCH_HORIZONS) {
    horizons[String(horizon)] = horizonReport(snapshotDays, prepared, spySeries, sectors, horizon, placeboDraws, seed);
  }
  const primary = horizons[String(RESEARCH_EVALUATION_HORIZON)];
  const enough = (primary?.residual?.nonOverlappingDays || 0) >= RESEARCH_KILL_DAYS;
  const spreadOk = (primary?.residual?.nonOverlappingSpreadPct || 0) > 0;
  const placeboOk = primary?.placebo?.above95 === true;
  const established = enough && spreadOk && placeboOk;
  const reason = established
    ? "The 5-session residual spread is positive, the non-overlapping sample has at least 30 windows, and the live rank correlation sits above 95% of within-day grade shuffles. This is the configured research threshold, not proof of persistent returns."
    : !enough
      ? `${primary?.residual?.nonOverlappingDays || 0} non-overlapping 5-session windows so far. Evaluation requires ${RESEARCH_KILL_DAYS}.`
      : !spreadOk
        ? "The 5-session sector-neutral, beta-neutral long-short spread is not positive."
        : "The live rank correlation does not clear 95% of the within-day grade shuffles.";
  const enrolled = normalizePicks(picks, sectors);
  const list = simulateStockBook(enrolled, prepared, { mode: "equal", hold: RESEARCH_HOLD, delay: false, maxPos: 10, sectorCap: 0, throttle: false, flatAt20: false });
  const risk = simulateStockBook(enrolled, prepared, { mode: "risk", hold: RESEARCH_HOLD, delay: false, maxPos: 20, sectorCap: 3, throttle: true, flatAt20: true });
  const cost = simulateStockBook(enrolled, prepared, { mode: "risk", hold: RESEARCH_HOLD, delay: true, maxPos: 20, sectorCap: 3, throttle: true, flatAt20: true });
  return {
    builtAtIso,
    ok: snapshotDays.length > 0 && Object.keys(prepared).length > 0,
    inputStatus: snapshotDays.length && !Object.keys(prepared).length ? "price-inputs-unavailable" : !snapshotDays.length ? "grades-unavailable" : "ready",
    method: {
      horizons: [...RESEARCH_HORIZONS],
      hold: RESEARCH_HOLD,
      minNames: RESEARCH_MIN_NAMES,
      betaWindow: RESEARCH_BETA_WINDOW,
      betaMin: RESEARCH_BETA_MIN,
      placeboDraws,
      placeboSeed: seed,
      startEquity: RESEARCH_START,
      cagrMinCalendarDays: RESEARCH_CAGR_MIN_DAYS,
      killDays: RESEARCH_KILL_DAYS,
      evaluationHorizon: RESEARCH_EVALUATION_HORIZON,
      note: "Forward returns are close to close, h trading days later, on each name's own bars. Beta is trailing and stops at the snapshot close. The residual is the forward return minus beta times the SPY forward return, then demeaned inside the sector. Non-overlapping windows step forward h trading days on SPY so the holding periods do not share sessions. A one-day delay enters at the next close. CAGR is omitted until the curve covers 365 calendar days.",
    },
    sample: {
      snapshotDays: snapshotDays.length,
      names: Object.keys(prepared).length,
      first: snapshotDays[0]?.date || null,
      last: snapshotDays[snapshotDays.length - 1]?.date || null,
      enrolled: enrolled.length,
    },
    killLine: { established, reason },
    horizons,
    books: [
      gradeScaleBook(snapshotDays, prepared, spySeries),
      finishBook("list", "Actionable list", "Track-record picks only, held 10 trading days in the stock. Equal weight, at most 10 open, one account. This is the list that shipped, marked on the stock instead of the option.", list),
      finishBook("risk", "Risk budget", "Same enrolled picks and 10-day stock hold. Each new name is sized so a move from the entry close to the stored stock stop is about 0.5% of equity. Gross stays within 100% of equity, or 50% after a 10% drawdown. No new names after a 20% drawdown. At most 3 open names in a sector and 20 in the book. The hold is not cut at the stop, so a larger move can lose more than 0.5%.", risk),
      finishBook("cost", "Cost and delay", "The risk-budget book, entered at the next close instead of the signal close. The equity curve is still the stock. The option lines below reprice the stored contract.", cost, { optionStress: optionStress(cost.taken) }),
    ],
  };
}

export function emptyGradeResearch(builtAtIso, reason) {
  const report = buildGradeResearch({ builtAtIso, days: [], series: {}, picks: null });
  report.ok = false;
  if (reason) report.killLine = { established: false, reason };
  return report;
}

export async function writeGradeResearchFile(dataDir, report) {
  const json = JSON.stringify(report);
  await writeFile(resolve(dataDir, GRADE_RESEARCH_FILE), json, "utf8");
  return { bytes: json.length, days: report?.sample?.snapshotDays || 0, established: report?.killLine?.established === true };
}

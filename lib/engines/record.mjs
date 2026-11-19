// Strategy engines: track-record math. One stats block per engine from its
// closed trades, with the splits the page and the history test both show:
// by setup, side, market type, macro environment, exit reason, rules version
// and (history test) time window. Each engine's record is separate from the
// flagship's and from every other engine's. Share trades (2026-11-17) are
// scored apart from options (`shares`): a stock move and an option move are
// different units, so their win rates and averages are never mixed.
//
// Pure. No network, no AI.

import { NOT_COUNTED, isSharesTrade } from "./config.mjs";
import { positionUsd, flatPositionUsd } from "./contracts.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);

export function wilson(wins, n, z = 1.96) {
  if (!n) return null;
  const p = wins / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: r3((c - m) / d), hi: r3((c + m) / d) };
}
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Dollars made or lost on the whole position: every contract bought (one
// before the 2026-11-17 size fix, about $2,000 of premium since) or the share
// lot of a share trade.
export const tradeUsd = (t) => (fin(t?.optionPnlPct) && t?.contract?.mid > 0 ? (t.optionPnlPct / 100) * positionUsd(t.contract) : null);
// The same trade at its flat risk size (2026-11-19, before the conviction
// multiplier). A trade with no flat size is its own flat size.
export const flatTradeUsd = (t) => (fin(t?.optionPnlPct) && t?.contract?.mid > 0 ? (t.optionPnlPct / 100) * flatPositionUsd(t.contract) : null);

export function summarize(trades) {
  const rows = trades.filter((t) => fin(t?.optionPnlPct) && !NOT_COUNTED.has(t.status) && t.outcome !== "void");
  const p = rows.map((t) => t.optionPnlPct);
  const wins = p.filter((x) => x > 0), losses = p.filter((x) => x < 0);
  const usd = rows.map(tradeUsd).filter(fin), flat = rows.map(flatTradeUsd).filter(fin);
  const gain = wins.reduce((a, b) => a + b, 0), lose = -losses.reduce((a, b) => a + b, 0);
  return {
    n: rows.length, wins: wins.length, losses: losses.length, flat: rows.length - wins.length - losses.length,
    winRate: rows.length ? r3(wins.length / rows.length) : null, winRange: wilson(wins.length, rows.length),
    avg: rows.length ? r1(p.reduce((a, b) => a + b, 0) / rows.length) : null, median: r1(median(p)),
    avgWin: wins.length ? r1(gain / wins.length) : null, avgLoss: losses.length ? r1(-lose / losses.length) : null,
    best: p.length ? r1(Math.max(...p)) : null, worst: p.length ? r1(Math.min(...p)) : null,
    profitFactor: lose > 0 ? Math.round((gain / lose) * 100) / 100 : null,
    usd: usd.length ? Math.round(usd.reduce((a, b) => a + b, 0)) : 0,
    flatUsd: flat.length ? Math.round(flat.reduce((a, b) => a + b, 0)) : 0,
  };
}

function split(trades, keyOf) {
  const by = new Map();
  for (const t of trades) { const k = keyOf(t); if (k == null || k === "") continue; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
  return [...by.entries()].map(([key, list]) => ({ key, ...summarize(list) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

// Score bands of five points ("60-64"), so the record can show whether a
// higher score has actually won more.
export const scoreBand = (sc) => (fin(sc) ? `${Math.floor(sc / 5) * 5}-${Math.floor(sc / 5) * 5 + 4}` : null);

const ENV_KEYS = ["rates", "inflation", "conditions", "curve", "vix", "recession"];

// The full stats block for one engine (or any list of closed trades): the
// option trades at the top level, the share trades in `shares` (same shape,
// null when there are none).
export function engineStats(closed, { windows = null } = {}) {
  // Paper trials (config.mjs ENGINE_TRIALS, 2026-11-19) are scored apart, so
  // an unproven setup never moves the engine's own option or share numbers.
  const own = closed.filter((t) => !t.trial), trial = closed.filter((t) => t.trial);
  const out = statsBlock(own.filter((t) => !isSharesTrade(t)), windows);
  const shr = own.filter(isSharesTrade);
  out.shares = shr.length ? statsBlock(shr, windows) : null;
  out.trials = trial.length ? statsBlock(trial, windows) : null;
  return out;
}
function statsBlock(closed, windows) {
  const exitDay = (t) => String(t.exitDate || "").slice(0, 10);
  const sorted = closed.slice().sort((a, b) => (exitDay(a) < exitDay(b) ? -1 : exitDay(a) > exitDay(b) ? 1 : 0));
  let run = 0;
  const curve = [];
  for (const t of sorted) { const u = tradeUsd(t); if (!fin(u) || NOT_COUNTED.has(t.status)) continue; run += u; curve.push([exitDay(t), Math.round(run)]); }
  const out = {
    ...summarize(closed),
    bySetup: split(closed, (t) => t.setup), bySide: split(closed, (t) => t.side),
    byCell: split(closed, (t) => t.regime?.cell), byExit: split(closed, (t) => t.status),
    byVersion: split(closed, (t) => t.rulesVersion), byScore: split(closed, (t) => scoreBand(t.score)).sort((a, b) => (a.key < b.key ? -1 : 1)), byYear: split(closed, (t) => String(t.entryDate || "").slice(0, 4)),
    byEnv: Object.fromEntries(ENV_KEYS.map((k) => [k, split(closed, (t) => t.env?.[k])])),
    curve: curve.length > 240 ? curve.filter((_, i) => i % Math.ceil(curve.length / 240) === 0 || i === curve.length - 1) : curve,
  };
  if (windows) out.byWindow = windows.map((w) => ({ key: w.id, label: w.label, from: w.from, to: w.to, ...summarize(closed.filter((t) => { const d = String(t.entryDate || "").slice(0, 10); return d >= w.from && d <= w.to; })) })).filter((r) => r.n > 0);
  return out;
}

// Largest fall from a peak on the cumulative dollar curve.
export function maxDrawdown(curve) {
  let peak = 0, dd = 0;
  for (const [, v] of curve || []) { if (v > peak) peak = v; if (peak - v > dd) dd = peak - v; }
  return Math.round(dd);
}

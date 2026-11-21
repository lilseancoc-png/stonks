// Strategy engines: the per-engine scorecard (2026-11-21, the scorecard pack;
// docs/engines.md "Scorecard pack"). Owner: "measure the engines' individual
// performances", from the 2026-11-20 scorecard review.
//
// From the live record only (closed trades, realized dollars on the day each
// trade closed), one row per engine:
//   - trades, return a trade (%), win rate, dollars and dollars a trade,
//     worst drop (largest fall of the engine's running closed dollars);
//   - a weekly Sharpe ratio (weekly closed dollars, mean / sd x sqrt 52) once
//     the engine has 20 weeks of record (`SCORECARD.sharpeWeeks`);
//   - results by the Top Picks market tape at entry (`macroState`, stamped on
//     every trade);
//   - options, shares and paper trials apart (they are different units);
//   - the history reference: the same sleeve in the 2007-2026 test on real
//     option prices (research/engines/scorecard/latest.json `sleeves`).
// For the book: weekly correlation between engines once the book has 12
// weeks (`SCORECARD.corrWeeks`), and "the book without this engine" (dollars,
// worst drop and Sharpe with that engine's trades left out).
//
// Measurement only: nothing here sizes, opens or closes a trade. Pure. No
// network, no AI.

import { ENGINES, ENGINE_IDS, NOT_COUNTED, isSharesTrade, engineName } from "./config.mjs";
import { tradeUsd } from "./record.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);

export const SCORECARD = Object.freeze({ sharpeWeeks: 20, corrWeeks: 12, corrMinActive: 4 });

const day = (iso) => String(iso || "").slice(0, 10);
// The Monday of a date's week (UTC calendar), as YYYY-MM-DD.
export function weekOf(date) {
  const ms = Date.parse(day(date) + "T12:00:00Z");
  if (!fin(ms)) return null;
  const d = new Date(ms), dow = (d.getUTCDay() + 6) % 7;
  return new Date(ms - dow * 86400000).toISOString().slice(0, 10);
}
// Every week from `from` to `to` (Monday dates).
export function weeksBetween(from, to) {
  const a = weekOf(from), b = weekOf(to);
  if (!a || !b || b < a) return [];
  const out = [];
  for (let ms = Date.parse(a + "T12:00:00Z"); ; ms += 7 * 86400000) { const w = new Date(ms).toISOString().slice(0, 10); if (w > b) break; out.push(w); if (out.length > 2000) break; }
  return out;
}

// A finished trade that counts (the record's own rule: void and
// left-coverage are not counted).
export const counted = (t) => !!t && fin(t.optionPnlPct) && t.outcome !== "void" && !NOT_COUNTED.has(t.status) && !!t.exitDate;

// Weekly closed dollars over `weeks`, from a list of trades and a dollar
// function (the variants recompute a trade at another size this way).
export function weeklySeries(trades, weeks, usdOf = tradeUsd) {
  const at = new Map(weeks.map((w, i) => [w, i])), out = new Array(weeks.length).fill(0);
  for (const t of trades) { const i = at.get(weekOf(t.exitDate)); const u = usdOf(t); if (i != null && fin(u)) out[i] += u; }
  return out;
}
export function sharpeOf(series) {
  const n = series.length;
  if (n < 2) return null;
  const m = series.reduce((a, b) => a + b, 0) / n, v = series.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return v > 0 ? r2((m / Math.sqrt(v)) * Math.sqrt(52)) : null;
}
// Largest fall of a running total.
export function worstDrop(series) {
  let run = 0, peak = 0, dd = 0;
  for (const x of series) { run += x; if (run > peak) peak = run; if (peak - run > dd) dd = peak - run; }
  return -Math.round(dd);
}
function corr(a, b) {
  const n = a.length; if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? r2(sab / Math.sqrt(saa * sbb)) : null;
}

function block(trades) {
  const p = trades.map((t) => t.optionPnlPct), usd = trades.map(tradeUsd).filter(fin);
  const n = p.length, wins = p.filter((x) => x > 0).length;
  const sum = usd.reduce((a, b) => a + b, 0);
  return { n, avg: n ? r1(p.reduce((a, b) => a + b, 0) / n) : null, winRate: n ? r3(wins / n) : null, usd: Math.round(sum), usdPerTrade: usd.length ? Math.round(sum / usd.length) : null };
}
function byExitOrder(trades) { return trades.slice().sort((a, b) => (day(a.exitDate) < day(b.exitDate) ? -1 : day(a.exitDate) > day(b.exitDate) ? 1 : 0)); }

// The scorecard. `history` is the committed scorecard research file.
export function buildScorecard(record, { today, history = null, specs = ENGINES } = {}) {
  const closed = (record?.closed || []).filter(counted);
  const firstDay = closed.reduce((m, t) => (!m || day(t.exitDate) < m ? day(t.exitDate) : m), null);
  const weeks = firstDay ? weeksBetween(firstDay, today || day(record?.builtAtIso) || firstDay) : [];
  const sleevesOf = (id) => (history?.sleeves || []).filter((s) => s.engine === id)
    .map((s) => ({ key: s.key, label: s.label, n: s.n, perYr: s.perYr, avg: s.avg, winRate: fin(s.win) ? r3(s.win / 100) : null, t: s.t, sharpe: s.sharpe, worstUsd: s.worstUsd, halves: s.halves || null, byTape: s.byTape || null }));
  const rows = [], series = {};
  for (const id of ENGINE_IDS) {
    const mine = closed.filter((t) => t.engine === id);
    const first = mine.reduce((m, t) => (!m || day(t.exitDate) < m ? day(t.exitDate) : m), null);
    const own = first ? weeksBetween(first, weeks[weeks.length - 1] || first) : [];
    const ws = weeklySeries(mine, own);
    series[id] = weeklySeries(mine, weeks);
    const tape = {};
    for (const t of mine) { const k = t.macroState || "unknown"; (tape[k] ||= []).push(t); }
    rows.push({
      id, name: engineName(id), tag: specs[id]?.tag || ENGINES[id]?.tag || null, core: !!(specs[id] || ENGINES[id])?.core,
      ...block(mine),
      worstUsd: worstDrop(byExitOrder(mine).map((t) => tradeUsd(t) || 0)),
      weeks: own.length,
      sharpe: own.length >= SCORECARD.sharpeWeeks ? sharpeOf(ws) : null,
      sharpeIn: own.length >= SCORECARD.sharpeWeeks ? 0 : SCORECARD.sharpeWeeks - own.length,
      parts: {
        options: block(mine.filter((t) => !t.trial && !isSharesTrade(t))),
        shares: block(mine.filter((t) => !t.trial && isSharesTrade(t))),
        trials: block(mine.filter((t) => t.trial)),
      },
      byTape: Object.entries(tape).map(([state, list]) => ({ state, ...block(list) })).sort((a, b) => b.n - a.n),
      history: sleevesOf(id),
    });
  }
  // The book, and the book without each engine.
  const bookSeries = weeks.map((_, i) => ENGINE_IDS.reduce((a, id) => a + series[id][i], 0));
  const bookReady = weeks.length >= SCORECARD.sharpeWeeks;
  const book = { ...block(closed), weeks: weeks.length, sharpe: bookReady ? sharpeOf(bookSeries) : null, sharpeIn: bookReady ? 0 : SCORECARD.sharpeWeeks - weeks.length, worstUsd: worstDrop(bookSeries),
    history: history?.book || null };
  for (const r of rows) {
    if (!r.n) { r.without = null; continue; }
    const ws = bookSeries.map((x, i) => x - series[r.id][i]);
    const rest = closed.filter((t) => t.engine !== r.id);
    r.without = { n: rest.length, usd: Math.round(rest.map(tradeUsd).filter(fin).reduce((a, b) => a + b, 0)), worstUsd: worstDrop(ws), sharpe: bookReady ? sharpeOf(ws) : null };
  }
  // Weekly correlation between engines with enough active weeks.
  const active = ENGINE_IDS.filter((id) => series[id].filter((x) => x !== 0).length >= SCORECARD.corrMinActive);
  const corrReady = weeks.length >= SCORECARD.corrWeeks;
  const correlation = { weeks: weeks.length, needWeeks: SCORECARD.corrWeeks, ready: corrReady, ids: corrReady ? active : [],
    matrix: corrReady ? active.map((a) => active.map((b) => (a === b ? 1 : corr(series[a], series[b])))) : [] };
  return { builtFor: today || null, from: firstDay, rule: { ...SCORECARD }, rows, book, correlation,
    reference: history ? { from: history.from, to: history.to, source: history.source, book: history.book || null } : null };
}

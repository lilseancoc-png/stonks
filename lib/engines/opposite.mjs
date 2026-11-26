// Opposite-side tags (2026-11-26, measure only): when a new engine trade
// takes the other side of a stock another open trade holds (an engine's or
// Top Picks'), both are tagged at entry so the record can later say which
// side won and what the pair cost.
//
// Book risk (lib/book-risk.mjs, bySymbol) already shows today's opposite
// bets; this keeps their history. The tags are written after the book step
// (runEngines), on the engine record only: `opposes` on the new trade,
// `opposedBy` on an engine trade it opposes. A Top Picks trade is named on
// the engine trade and is never written to picks-accuracy.json.
//
// Nothing here changes what the book opens, closes or sizes. Owner Settings
// ENGINES_OPPOSITE_TAG=0 stops new tags and hides the scoreboard. Pure, no
// network, no AI.

import { FLAGSHIP, NOT_COUNTED, engineName } from "./config.mjs";
import { tradeUsd } from "./record.mjs";
import { pickTradeId } from "../pick-trade-text.mjs";

export const OPPOSITE_MAX_LINKS = 6;
export const OPPOSITE_PAIRS_SHOWN = 30;

const fin = (v) => Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
// An engine trade's side: a put bets down, everything else (calls, shares,
// the core engines' fund lots) bets up.
export const engineSide = (t) => (t?.side === "put" ? "down" : "up");
// Top Picks' side is call / put or bull / bear wording.
export const flagSide = (f) => (/^(put|bear)/i.test(String(f?.side || "")) ? "down" : "up");

export function oppositeTagEnabled(env = process.env) {
  return !/^(0|off|false|no)$/.test(String(env?.ENGINES_OPPOSITE_TAG ?? "").trim().toLowerCase());
}

const linked = (t, id) => (t.opposes || []).some((x) => x.tradeId === id) || (t.opposedBy || []).some((x) => x.tradeId === id);

// Tags this run's new trades. `fresh` picks the new ones (entry this run);
// `flagshipOpen` is the Top Picks open list as runEngines hands it to the book
// ({ tradeId, symbol, side }). Returns how many links were written.
export function stampOpposites(record, { flagshipOpen = [], fresh, nowIso } = {}) {
  if (!record || !Array.isArray(record.open)) return 0;
  const isFresh = typeof fresh === "function" ? fresh : (t) => t.entryDate === nowIso;
  const open = record.open.filter((t) => t && t.symbol && !t.twinOf && !t.shadow);
  let n = 0;
  for (const t of open) {
    if (!isFresh(t) || t.opposes) continue;
    const side = engineSide(t), links = [];
    for (const o of open) {
      if (o === t || o.symbol !== t.symbol || engineSide(o) === side || linked(t, o.tradeId)) continue;
      if (links.length >= OPPOSITE_MAX_LINKS) break;
      links.push({ tradeId: o.tradeId, engine: o.engine, side: o.side || null });
      if ((o.opposedBy || []).length < OPPOSITE_MAX_LINKS) (o.opposedBy ||= []).push({ tradeId: t.tradeId, engine: t.engine, since: nowIso || t.entryDate || null });
    }
    for (const f of flagshipOpen) {
      if (!f?.tradeId || f.symbol !== t.symbol || flagSide(f) === side) continue;
      if (links.length >= OPPOSITE_MAX_LINKS) break;
      links.push({ tradeId: f.tradeId, engine: FLAGSHIP.id, side: f.side || null });
    }
    if (links.length) { t.opposes = links; n += links.length; }
  }
  return n;
}

// The result of one side: open, a counted close (its % and $), or a close
// that does not count (void, left coverage, never-trade).
function sideResult(t, isFlag) {
  if (!t) return { state: "unknown" };
  const pct = Number(t.optionPnlPct);
  if (!t.exitDate) return { state: "open", pct: fin(pct) ? r1(pct) : null };
  const counted = fin(pct) && t.outcome !== "void" && t.outcome !== "left-coverage" && t.counted !== false && !NOT_COUNTED.has(t.status);
  if (!counted) return { state: "not-counted" };
  const usd = isFlag ? null : tradeUsd(t);
  return { state: "closed", pct: r1(pct), usd: fin(usd) ? Math.round(usd) : null };
}

// The scoreboard: every tagged pair, which side won once both closed, and
// what each side made. `flagship` is every Top Picks row on hand (open,
// closed, archive), matched by trade ID.
export function oppositeScoreboard(record, { flagship = [], enabled = true, builtAtIso = null } = {}) {
  if (!enabled) return { enabled: false };
  const all = [...(record?.open || []), ...(record?.closed || [])].filter((t) => t && t.tradeId);
  const byId = new Map(all.map((t) => [t.tradeId, t]));
  const flagById = new Map();
  for (const f of flagship || []) { const id = f && pickTradeId(f); if (id) flagById.set(id, f); }
  const pairs = [];
  for (const t of all) {
    for (const l of t.opposes || []) {
      const isFlag = l.engine === FLAGSHIP.id;
      const o = isFlag ? flagById.get(l.tradeId) : byId.get(l.tradeId);
      const a = sideResult(t, false), b = sideResult(o, isFlag);
      let winner = null;
      // Dollars when both sides have them (an option and a share trade swing
      // by very different % for the same move), else the % return.
      const by = fin(a.usd) && fin(b.usd) ? "usd" : "pct";
      if (a.state === "closed" && b.state === "closed") winner = a[by] > b[by] ? "newer" : a[by] < b[by] ? "older" : "tie";
      pairs.push({
        symbol: t.symbol, date: String(t.entryDate || "").slice(0, 10),
        kind: isFlag ? "top-picks" : "engine",
        newer: { tradeId: t.tradeId, engine: t.engine, name: engineName(t.engine), side: t.side, ...a },
        older: { tradeId: l.tradeId, engine: l.engine, name: isFlag ? FLAGSHIP.name : engineName(l.engine), side: l.side || o?.side || null, ...b },
        winner, ...(winner ? { by } : {}),
        netPct: winner ? r1(a.pct + b.pct) : null,
        netUsd: winner && fin(a.usd) && fin(b.usd) ? a.usd + b.usd : null,
      });
    }
  }
  pairs.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  const settled = pairs.filter((p) => p.winner);
  const sum = (rows, f) => r1(rows.reduce((s, p) => s + (f(p) || 0), 0));
  const split = (rows) => ({
    pairs: rows.length, settled: rows.filter((p) => p.winner).length,
    newerWon: rows.filter((p) => p.winner === "newer").length, olderWon: rows.filter((p) => p.winner === "older").length, ties: rows.filter((p) => p.winner === "tie").length,
  });
  const byEngine = {};
  for (const p of settled) {
    for (const s of ["newer", "older"]) {
      const e = p[s].engine; if (!e) continue;
      const row = (byEngine[e] ||= { engine: e, name: p[s].name, settled: 0, won: 0, sumPct: 0 });
      row.settled++; if (p.winner === s) row.won++; row.sumPct = r1(row.sumPct + p[s].pct);
    }
  }
  return {
    enabled: true, builtAtIso,
    ...split(pairs),
    open: pairs.filter((p) => p.newer.state === "open" || p.older.state === "open").length,
    engineVsEngine: split(pairs.filter((p) => p.kind === "engine")),
    engineVsTopPicks: split(pairs.filter((p) => p.kind === "top-picks")),
    newerSumPct: sum(settled, (p) => p.newer.pct), olderSumPct: sum(settled, (p) => p.older.pct),
    netSumPct: sum(settled, (p) => p.netPct),
    netUsd: settled.some((p) => fin(p.netUsd)) ? Math.round(settled.reduce((s, p) => s + (fin(p.netUsd) ? p.netUsd : 0), 0)) : null,
    byEngine: Object.values(byEngine).sort((a, b) => b.settled - a.settled),
    rows: pairs.slice(0, OPPOSITE_PAIRS_SHOWN),
    note: "Measure only: a tag never changes what an engine opens, closes or sizes. A pair is settled once both sides have closed and count; the winner is the side that made more dollars when both are engine trades, else the higher % return.",
  };
}

// The Owner brief's line: open opposite pairs now and the settled record.
// Imported by lib/owner-market-brief.mjs (which runs in the bake).
export function oppositeBriefLine(board) {
  // Only while a pair is open: a settled record alone is on the engines page.
  if (!board?.enabled || !board.pairs || !board.open) return null;
  const parts = [];
  if (board.open) parts.push(`${board.open} open pair${board.open === 1 ? "" : "s"} where trades sit on opposite sides of one stock`);
  if (board.settled) parts.push(`of ${board.settled} settled, the newer trade won ${board.newerWon} and the older ${board.olderWon}; both sides together made ${board.netSumPct >= 0 ? "+" : ""}${board.netSumPct}%`);
  return parts.length ? parts.join("; ") + "." : null;
}


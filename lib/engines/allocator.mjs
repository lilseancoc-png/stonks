// Strategy engines: the Allocator (2026-11-17). A manager over the signal
// engines that picks no trades of its own. At each decision run it reads
// today's market type (the Regime Lab's six cells: trending up, trending down
// or choppy, each calm or stressed), looks up how each setup has done in that
// kind of market, and decides:
//   - whether the setup may trade today ("open") or is held back ("closed":
//     the trade is tracked as a shadow trade instead, so the setup keeps
//     building a record and can earn its way back);
//   - how big the trade would be ("size", 0.1x to 2x of the normal lot).
//
// The rule is the one that turned the options sleeve's -1.2% a trade into
// +1.8% in the 1972-2026 research ("sized by each setup's record in the
// current market"):
//   - A setup x side x instrument needs 30+ finished results before it is
//     judged; until then it trades at normal size ("new").
//   - Its expected result in today's market blends its record in that market
//     with its record everywhere, leaning on the market's own record as it
//     grows: ev = c/(c+30) x market average + 30/(c+30) x overall average,
//     where c is the number of results in today's market.
//   - ev at or under zero: closed today. Above zero: size = ev / 4, between
//     0.1x and 2x (an expected +4% a trade is normal size).
//   - Share results count 5x (LEARN.sharesScale), as in the learning layer:
//     a stock move and an option move are different units.
//
// What it counts: every finished trade of the signal engines, real and shadow
// (shadow trades are exactly the held-back ones), plus a prior from the
// committed history test (research/engines/results/latest.json, the "every
// setup, every day" run 2007-2026), so it starts with the history it was
// tested on rather than from nothing. Only trades that finished before a
// decision count: no hindsight. The history test itself starts with no prior.
//
// Size is recorded on each trade (`alloc.w`) and drives the Allocator's own
// dollar line ("sized by the Allocator" against "every trade at normal
// size"). It does not change the one contract or the $5,000 lot each trade
// buys: moving real money between engines waits for a live record.
//
// The core engines (Trend follower, Momentum basket) are not allocated.
// ENGINES_ALLOCATOR: on (default) / advise (reads and sizes, holds nothing
// back) / off.
//
// Pure. No network, no AI.

import { LEARN } from "./learn.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);

export const ALLOC = Object.freeze({
  minN: 30,     // results before a setup is judged
  shrink: 30,   // how fast the market's own record takes over from the overall one
  sizeDiv: 4,   // an expected +4% a trade is normal size
  minW: 0.1, maxW: 2,
});
const CELL_NAMES = { "up-calm": "trending-up, calm", "up-stressed": "trending-up, stressed", "down-calm": "trending-down, calm", "down-stressed": "trending-down, stressed", "chop-calm": "choppy, calm", "chop-stressed": "choppy, stressed" };
export const cellLabel = (cell) => CELL_NAMES[cell] || cell || "unknown";

const isShares = (t) => t?.contract?.structure === "shares" || t?.instrument === "shares";
// One row of the table: a setup, a side and an instrument on one engine.
export const allocKey = (engine, setup, side, inst) => `${engine}|${setup}|${side === "put" ? "put" : "call"}|${inst === "shares" ? "s" : "o"}`;
export const allocKeyOf = (t) => allocKey(t.engine, t.setup, t.side, isShares(t) ? "shares" : "option");
const scaled = (key, p) => (key.endsWith("|s") ? p * LEARN.sharesScale : p);

export function emptyAlloc(today = null) { return { v: 1, since: today, table: {} }; }

// Add one finished trade (real or shadow) to the table.
export function allocObserve(state, t) {
  if (!fin(t?.optionPnlPct) || t.outcome === "void") return;
  const a = (state.alloc ||= emptyAlloc(String(t.exitDate || "").slice(0, 10) || null));
  const key = allocKeyOf(t), row = (a.table[key] ||= {});
  const p = scaled(key, t.optionPnlPct);
  for (const c of ["*", t.regime?.cell || null]) {
    if (!c) continue;
    const x = (row[c] ||= [0, 0]);
    x[0] += 1; x[1] = Math.round((x[1] + p) * 100) / 100;
  }
}

// The prior from the history test: { key: { "*": [n, sum], cell: [n, sum] } }
// on the same scale (shares already scaled).
export function allocPrior(research) {
  const rows = research?.allocPrior?.rows;
  return rows && typeof rows === "object" ? rows : null;
}
// Build the prior from a history-test run's trades (the research script).
export function allocPriorFrom(trades) {
  const state = {};
  for (const t of trades || []) allocObserve(state, t);
  return state.alloc?.table || {};
}

const cellOf = (row, c) => (row && row[c]) || [0, 0];
function merged(state, prior, key) {
  const live = state?.alloc?.table?.[key] || null, pri = prior?.[key] || null;
  const cells = new Set([...Object.keys(live || {}), ...Object.keys(pri || {})]);
  const out = {};
  for (const c of cells) { const a = cellOf(live, c), b = cellOf(pri, c); out[c] = [a[0] + b[0], a[1] + b[1]]; }
  return { row: out, liveN: cellOf(live, "*")[0], priorN: cellOf(pri, "*")[0] };
}

// The decision for one setup in today's market.
export function allocDecide(state, prior, key, cell) {
  const { row, liveN, priorN } = merged(state, prior, key);
  const [n, s] = cellOf(row, "*"), [cn, cs] = cell ? cellOf(row, cell) : [0, 0];
  const avg = n ? s / n : null, cAvg = cn ? cs / cn : null;
  const base = { key, cell: cell || null, n, avg: r1(avg), cn, cAvg: r1(cAvg), liveN, priorN };
  if (n < ALLOC.minN) return { ...base, status: "new", open: true, w: 1, ev: null, why: `fewer than ${ALLOC.minN} results so far: normal size` };
  const ev = (cn / (cn + ALLOC.shrink)) * (cAvg ?? 0) + (ALLOC.shrink / (cn + ALLOC.shrink)) * avg;
  if (!cell) return { ...base, status: "open", open: true, w: 1, ev: r1(avg), why: "no market type today: normal size" };
  if (ev <= 0) return { ...base, status: "closed", open: false, w: 0, ev: r1(ev), why: `Allocator: expected ${r1(ev)}% a trade in ${cellLabel(cell)} markets (${cn} results there, ${n} overall)` };
  const w = Math.min(ALLOC.maxW, Math.max(ALLOC.minW, Math.round((ev / ALLOC.sizeDiv) * 20) / 20));
  return { ...base, status: "open", open: true, w, ev: r1(ev), why: `expected ${r1(ev)}% a trade in ${cellLabel(cell)} markets: ${w}x size` };
}

// What goes on a trade (real or shadow).
// Size 0 when the Allocator held the setup back (in "advise" mode the trade
// still opens, so its line shows what holding it back would have done).
export const allocStamp = (d, mode) => (d ? { w: d.open ? d.w : 0, status: d.status, ev: d.ev, n: d.n, cn: d.cn, cell: d.cell, mode } : null);

// The Allocator's own dollar line over finished real trades it stamped:
// dollars at the Allocator's size against dollars at normal size, and (in
// "advise" mode, where held-back setups still trade) the count and dollars of
// the trades it would have held back: below zero, holding back would have
// helped.
export function allocBook(closed, usdOf) {
  let n = 0, plain = 0, sized = 0, held = 0, heldUsd = 0;
  for (const t of closed || []) {
    if (!t?.alloc || t.outcome === "void") continue;
    const u = usdOf(t);
    if (!fin(u)) continue;
    n++; plain += u; sized += u * (fin(t.alloc.w) ? t.alloc.w : 1);
    if (t.alloc.status === "closed") { held++; heldUsd += u; }
  }
  return { n, plainUsd: Math.round(plain), sizedUsd: Math.round(sized), advisedOut: held, heldUsd: Math.round(heldUsd) };
}

// The page's table: one row per setup x side x instrument the engines have
// a record for (live or prior), with today's decision.
export function allocView(state, prior, specs, ids, cell, { mode = "on" } = {}) {
  const keys = new Set([...Object.keys(state?.alloc?.table || {}), ...Object.keys(prior || {})]);
  const rows = [];
  for (const key of keys) {
    const [engine, setup, side, inst] = key.split("|");
    if (!ids.includes(engine) || !specs[engine]?.setups?.[setup] || specs[engine].setups[setup].retired) continue;
    const d = allocDecide(state, prior, key, cell);
    rows.push({ key, engine, tag: specs[engine].tag, setup, label: specs[engine].setups[setup].label, side, instrument: inst === "s" ? "shares" : "option",
      status: d.status, w: d.w, ev: d.ev, n: d.n, avg: d.avg, cn: d.cn, cAvg: d.cAvg, liveN: d.liveN, priorN: d.priorN });
  }
  // Setups with no record at all yet trade at normal size.
  for (const id of ids) for (const [setup, s] of Object.entries(specs[id]?.setups || {})) {
    if (s.retired || rows.some((r) => r.engine === id && r.setup === setup)) continue;
    rows.push({ key: `${id}|${setup}`, engine: id, tag: specs[id].tag, setup, label: s.label, side: null, instrument: null, status: "new", w: 1, ev: null, n: 0, avg: null, cn: 0, cAvg: null, liveN: 0, priorN: 0 });
  }
  const order = { open: 0, new: 1, closed: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.ev ?? -99) - (a.ev ?? -99) || (a.key < b.key ? -1 : 1));
  return { mode, cell: cell || null, cellLabel: cell ? cellLabel(cell) : null, since: state?.alloc?.since || null, rows, rule: { ...ALLOC, sharesScale: LEARN.sharesScale } };
}

// Strategy engines: the loser brake (2026-11-21, the scorecard pack; docs/
// engines.md "Scorecard pack"). Owner: "Scorecard, brake, variants", from the
// 2026-11-20 engine scorecard review.
//
// A setup that keeps losing is sized down instead of retired, so it keeps
// gathering live data (owner, 2026-11-20: "prefer keeping or changing setups
// over retiring"). Its record is one setup x side x instrument on one engine
// (the Allocator's rows), counted from:
//   - the prior: the 2007-2026 history test on real option prices (Cboe
//     implied volatility, research/engines/scorecard/latest.json
//     `brakePrior`), as [closed trades, sum of % results, sum of squares];
//   - every live and shadow close of that setup since (the state's `brake`
//     table, the same three numbers).
// With 30 or more closes and a t value (average / its standard error) under
// -1, a new trade on that setup is sized at half (`BRAKE.mult`). With the
// market tape's size step it is never under a quarter (`BRAKE.floor`), and a
// trade always keeps at least one contract or one share, so the brake never
// stops a setup from trading. It only ever sizes down: a setup that recovers
// above the line is back to its normal size at the next run.
//
// Paper trials, the core engines and Owner closes ("owner-avoid") are left
// out, as in the Allocator. Pure. No network, no AI.

import { allocKey } from "./allocator.mjs";
import { ENGINES, ENGINE_FIXES } from "./config.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);

export const BRAKE = Object.freeze({ minN: 30, t: -1, mult: 0.5, floor: 0.25 });
// The engines the brake reaches: the ones its rules step names (the six
// signal engines; Downside puts, a new live test, is left out).
export const BRAKE_ENGINES = new Set(ENGINE_FIXES.find((f) => f.id === "loserBrake")?.engines || []);

export function emptyBrake(today = null) { return { v: 1, since: today, table: {} }; }

const isShares = (t) => t?.contract?.structure === "shares" || t?.instrument === "shares";
export const brakeKeyOf = (t) => allocKey(t.engine, t.setup, t.side, isShares(t) ? "shares" : "option");

// Does this finished trade count toward the brake?
export function brakeCounts(t, specs = ENGINES) {
  return !!t && BRAKE_ENGINES.has(t.engine) && fin(t.optionPnlPct) && t.outcome !== "void" && t.status !== "owner-avoid" && t.status !== "never-trade" && t.status !== "left-coverage" && !t.trial && !(specs || ENGINES)?.[t.engine]?.core;
}

// Add one finished trade (real or shadow).
export function brakeObserve(state, t, specs = ENGINES) {
  if (!brakeCounts(t, specs)) return;
  const b = (state.brake ||= emptyBrake(String(t.exitDate || "").slice(0, 10) || null));
  const x = (b.table[brakeKeyOf(t)] ||= [0, 0, 0]);
  const p = t.optionPnlPct;
  x[0] += 1; x[1] = Math.round((x[1] + p) * 100) / 100; x[2] = Math.round((x[2] + p * p) * 10) / 10;
}

// The first time the brake runs, the live table is filled from every closed
// trade the record and the shadow books still hold, so it does not start from
// nothing. Returns true when it seeded.
export function brakeSeed(state, record, specs = ENGINES) {
  if (state.brake) return false;
  state.brake = emptyBrake(null);
  for (const t of record?.closed || []) brakeObserve(state, t, specs);
  for (const es of Object.values(state.engines || {})) for (const t of es?.shadow?.closed || []) brakeObserve(state, { ...t, engine: t.engine }, specs);
  return true;
}

// The prior rows from the committed scorecard research file.
export function brakePrior(scorecard) {
  const rows = scorecard?.brakePrior?.rows;
  return rows && typeof rows === "object" ? rows : null;
}

// One setup's read: { key, n, avg, t, liveN, priorN, on }.
export function brakeRead(state, prior, key) {
  const live = state?.brake?.table?.[key] || [0, 0, 0], pri = prior?.[key] || [0, 0, 0];
  const n = (live[0] || 0) + (pri[0] || 0), s = (live[1] || 0) + (pri[1] || 0), ss = (live[2] || 0) + (pri[2] || 0);
  const avg = n ? s / n : null;
  const v = n > 1 ? Math.max(0, (ss - n * avg * avg) / (n - 1)) : null;
  const t = n > 1 && v > 0 ? avg / Math.sqrt(v / n) : null;
  const on = n >= BRAKE.minN && fin(t) && t < BRAKE.t;
  return { key, n, avg: r2(avg), t: r2(t), liveN: live[0] || 0, priorN: pri[0] || 0, on };
}

// The size step for one new trade: 1 when not braked; else BRAKE.mult, but
// never under BRAKE.floor once the other size steps (`otherMult`, the market
// tape) are counted, and never over 1.
export function brakeMult(read, otherMult = 1) {
  if (!read?.on) return 1;
  const o = fin(otherMult) && otherMult > 0 ? otherMult : 1;
  return r2(Math.min(1, Math.max(BRAKE.mult, BRAKE.floor / o)));
}

export const brakeWhy = (read, mult) => `loser brake ${mult}x (t ${r1(read.t)} over ${read.n} closes, ${read.priorN} of them in the 2007-2026 test)`;

// The page's table: every setup with 10+ closes, braked first.
export function brakeView(state, prior, { minN = 10, enabled = true } = {}) {
  const keys = new Set([...Object.keys(state?.brake?.table || {}), ...Object.keys(prior || {})]);
  const rows = [];
  for (const key of keys) {
    const r = brakeRead(state, prior, key);
    if (r.n < minN) continue;
    const [engine, setup, side, inst] = key.split("|");
    rows.push({ ...r, engine, setup, side, instrument: inst === "s" ? "shares" : "option", mult: enabled ? brakeMult(r) : 1 });
  }
  rows.sort((a, b) => Number(b.on) - Number(a.on) || (a.t ?? 0) - (b.t ?? 0));
  return { enabled, rule: { ...BRAKE }, since: state?.brake?.since || null, rows };
}

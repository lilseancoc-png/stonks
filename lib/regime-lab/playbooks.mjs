// Regime Lab: a playbook for each market cell (B1-B8, 2026-11-09).
//
// The numbers here are hypotheses for the harness, not settings. Every
// playbook is tested against "same rules everywhere" (the null hypothesis,
// G8) and against cash (B6). The engine's direction call is taken as given;
// a playbook only decides whether to take a candidate, at what size, with
// which stop and target. B7 (sub-engines in parallel) is the harness running
// every playbook as its own paper book and the "switch" strategy handing the
// live slots to the playbook the label names. Pure, no network.

import { CELLS } from "./labels.mjs";
import { ladderStop, bookBrakes } from "./exits.mjs";

export const PLAYBOOK_RULES_VERSION = "2026-11-09-playbooks-v1";

export const PLAYBOOKS = Object.freeze([
  { id: "same-rules", name: "Same rules everywhere", item: "G8", cells: CELLS, sides: ["call", "put"], size: 1, stopPct: -50, tpPct: 25, maxOpen: 8, baseline: true,
    note: "One brake, same rules: the baseline every playbook must beat, not just random." },
  { id: "ride", name: "Ride the trend", item: "B1", cells: ["up-calm"], sides: ["call"], size: 1, stopPct: -50, tpPct: 25, trailPts: 25, maxOpen: 8,
    note: "With the trend, singles, the wide stop, trail winners once they are up 25%." },
  { id: "defend", name: "Defend", item: "B2", cells: ["down-stressed", "down-calm"], sides: ["put"], size: 1, stopPct: -40, tpPct: 25, requireBounce: true, maxOpen: 5,
    note: "Puts only after a bounce back toward the 20-day average, never into the hole." },
  { id: "fade", name: "Fade the edges", item: "B3", cells: ["chop-calm"], sides: ["call", "put"], size: 0.75, stopPct: -40, tpPct: 20, nearLevelPct: 2, maxOpen: 6,
    note: "Calls within 2% of 20-day support, puts within 2% of 20-day resistance." },
  { id: "cash", name: "Mostly cash", item: "B4", cells: ["chop-stressed"], sides: [], size: 0, maxOpen: 0,
    note: "Stand aside. Only the post-shock lane and defined-risk event plays would trade here; the harness takes nothing." },
  { id: "transition", name: "Transition", item: "B5", cells: [], sides: ["call", "put"], size: 0.5, stopPct: -45, tpPct: 25, noTrend: true, closeWeakest: true, maxOpen: 4,
    note: "While the label settles: half size, no new trend trades, close the weakest open trade first." },
  { id: "size-exits", name: "Size and exits by era", item: "B8", cells: CELLS, sides: ["call", "put"], size: "era", stopPct: "ladder", tpPct: 25, maxOpen: "brakes",
    note: "The same direction model; only size, stop and max open change with the volatility era." },
]);

export const SWITCH_STRATEGY_ID = "switch";
export const PLAYBOOK_BY_ID = Object.freeze(Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p])));
export const ERA_SIZE = Object.freeze({ calm: 1, normal: 0.8, elevated: 0.6, crisis: 0.4 });

export function playbookForCell(cell, transition = false) {
  if (transition) return "transition";
  switch (cell) {
    case "up-calm": return "ride";
    case "up-stressed": return "size-exits";
    case "down-calm": return "defend";
    case "down-stressed": return "defend";
    case "chop-calm": return "fade";
    case "chop-stressed": return "cash";
    default: return "same-rules";
  }
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function bounced(bars) {
  // Two-session rally and the close back within 3% under the 20-day average:
  // a put sold into the bounce, not after a 6-16% drop.
  if (!Array.isArray(bars) || bars.length < 22) return false;
  const n = bars.length;
  const c = bars[n - 1].c, c1 = bars[n - 2].c, c2 = bars[n - 3].c;
  let s = 0; for (let i = n - 20; i < n; i++) s += bars[i].c;
  const sma20 = s / 20;
  return c > c2 && c > c1 * 0.998 && c >= sma20 * 0.97;
}

// Decide one candidate for one playbook. `label` is the confirmed label row
// in force (computed through the prior close). Returns the sizing and exits
// to use or the reason the playbook passes.
export function decideEntry(playbookOrId, { sym = null, side, total = null, spot = null, s20 = null, r20 = null, bars = null, label = null, era = null, character = null } = {}) {
  const pb = typeof playbookOrId === "string" ? PLAYBOOK_BY_ID[playbookOrId] : playbookOrId;
  if (!pb) return { take: false, reason: "no-playbook" };
  const cell = label?.cell || null;
  const transition = !!label?.transition;
  const theEra = era || label?.era || "normal";
  const theCharacter = character || label?.character || null;
  if (pb.cells.length && cell && !pb.cells.includes(cell)) return { take: false, reason: "cell", playbook: pb.id };
  if (!pb.sides.includes(side)) return { take: false, reason: pb.sides.length ? "side" : "cash", playbook: pb.id };
  if (pb.requireBounce && !bounced(bars)) return { take: false, reason: "no-bounce", playbook: pb.id };
  if (pb.noTrend && theCharacter && ((theCharacter === "up" && side === "call") || (theCharacter === "down" && side === "put"))) return { take: false, reason: "transition-no-trend", playbook: pb.id };
  if (pb.nearLevelPct != null) {
    const sp = num(spot), lo = num(s20), hi = num(r20), band = pb.nearLevelPct / 100;
    if (sp == null) return { take: false, reason: "no-spot", playbook: pb.id };
    if (side === "call" && !(lo != null && sp <= lo * (1 + band))) return { take: false, reason: "not-at-support", playbook: pb.id };
    if (side === "put" && !(hi != null && sp >= hi * (1 - band))) return { take: false, reason: "not-at-resistance", playbook: pb.id };
  }
  const size = pb.size === "era" ? (ERA_SIZE[theEra] ?? 1) : num(pb.size) ?? 1;
  if (!(size > 0)) return { take: false, reason: "cash", playbook: pb.id };
  const stopPct = pb.stopPct === "ladder" ? ladderStop(theEra) : num(pb.stopPct) ?? -50;
  const maxOpen = pb.maxOpen === "brakes" ? bookBrakes(theEra).maxOpen : num(pb.maxOpen) ?? 8;
  return { take: true, playbook: pb.id, size, stopPct, tpPct: num(pb.tpPct) ?? 25, trailPts: num(pb.trailPts), maxOpen, closeWeakest: !!pb.closeWeakest, reason: transition && pb.id !== "transition" ? "transition-day" : "ok" };
}

export function bookCapacity(playbookOrId, era = "normal") {
  const pb = typeof playbookOrId === "string" ? PLAYBOOK_BY_ID[playbookOrId] : playbookOrId;
  if (!pb) return 0;
  return pb.maxOpen === "brakes" ? bookBrakes(era).maxOpen : num(pb.maxOpen) ?? 0;
}

export function weakestOpen(openTrades) {
  let worst = null;
  for (const t of openTrades || []) { const p = num(t?.pnlPct ?? t?.optionPnlPct); if (p == null) continue; if (!worst || p < worst.p) worst = { t, p }; }
  return worst ? worst.t : null;
}

// The strategies the harness runs side by side (B7). "switch" is the only
// one that reads the label to choose a playbook; every "<playbook>-only"
// strategy applies one playbook in every cell it names and stays in cash
// elsewhere, which is what makes cash visible as a strategy (B6).
export const STRATEGIES = Object.freeze([
  { id: "same-rules", name: "Same rules everywhere (baseline)", playbook: "same-rules", baseline: true },
  { id: SWITCH_STRATEGY_ID, name: "Playbook by label (switch)", playbook: null },
  { id: "size-exits", name: "Size and exits by era", playbook: "size-exits" },
  { id: "ride-only", name: "Ride the trend only", playbook: "ride" },
  { id: "defend-only", name: "Defend only", playbook: "defend" },
  { id: "fade-only", name: "Fade the edges only", playbook: "fade" },
  { id: "cash", name: "Cash (hold off every day)", playbook: "cash", cash: true },
]);

export function strategyPlaybook(strategyId, label) {
  const s = STRATEGIES.find((x) => x.id === strategyId);
  if (!s) return null;
  if (s.cash) return "cash";
  if (s.id === SWITCH_STRATEGY_ID) return playbookForCell(label?.cell || null, !!label?.transition);
  return s.playbook;
}

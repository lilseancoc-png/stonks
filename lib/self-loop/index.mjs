// Self-improving Top Picks loop (2026-11-09). Spec: docs/self-loop.md.
//
// Gather -> estimate -> compare -> diagnose -> test a fix -> change -> repeat.
// This file holds the two bake hooks and the two files:
//
//   picks-loop-state.json  the loop's memory: the prediction ledger and the
//                          daily score history (Owner-only, bake-owned, read
//                          before the wipe like every accumulating file).
//   picks-loop.json        what the Owner Lab "Loop" view draws (Owner-only).
//
// Hooks (scripts/build.mjs):
//   loopOnRun   after each 11:00 / 15:30 ET Top Picks run: fit the
//               calibration on rows resolved before today, write this run's
//               estimates into the ledger.
//   loopOnBake  every full bake: model the option outcome on rows that can be
//               decided, prune, score, and build the view payload.
//
// Measurement only in this file: nothing here changes a pick, a grade or the
// Track Record. LOOP=0 skips both hooks and leaves the prior files in place.
// No AI call, no network.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appendRunLedger, emptyLedger, fillOptionOutcomes, joinedRows, parseLedger, pruneLedger, LEDGER_KEEP_DAYS } from "./ledger.mjs";
import { estimateFor, fitCalibration, modelTable, MIN_ROWS_FOR_ESTIMATE } from "./calibrate.mjs";
import { buildScorecard, historyRows } from "./scorecard.mjs";
import { projectDate } from "../evidence-board.mjs";

export const LOOP_STATE_KEY = "picks-loop-state.json";
export const LOOP_VIEW_KEY = "picks-loop.json";
export const LOOP_VERSION = 1;
export const LOOP_START = "2026-11-10";

export function loopEnabled(env = process.env) {
  return !/^(?:0|false|off)$/i.test(String(env.LOOP ?? "1").trim());
}

export function emptyLoopState() {
  return { v: LOOP_VERSION, startedAt: null, ledger: emptyLedger(), history: [], runs: 0, lastRun: null };
}

export function parseLoopState(body) {
  if (body == null) return null;
  let raw;
  try { raw = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = { ...emptyLoopState(), ...raw };
  state.ledger = parseLedger(raw.ledger);
  state.history = Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.d === "string") : [];
  state.runs = Number.isFinite(raw.runs) ? raw.runs : 0;
  return state;
}

// A missing file is a fresh start. A file that cannot be read this time
// (anything but "not found") returns state null so the bake skips the loop and
// leaves the stored copy alone; only a file that reads but is not loop state
// starts over.
export async function loadLoopState(dataDir) {
  let body = null;
  try { body = await readFile(resolve(dataDir, LOOP_STATE_KEY), "utf8"); } catch (err) {
    if (err?.code === "ENOENT") return { state: emptyLoopState(), fresh: true };
    return { state: null, skip: true, error: String(err?.message || err).split("\n")[0] };
  }
  const state = parseLoopState(body);
  return state ? { state } : { state: emptyLoopState(), error: "unreadable loop state" };
}

export async function writeLoopFiles(dataDir, state, view) {
  const stateBody = JSON.stringify(state);
  await writeFile(resolve(dataDir, LOOP_STATE_KEY), stateBody, "utf8");
  let viewBytes = 0;
  if (view) {
    const viewBody = JSON.stringify(view);
    await writeFile(resolve(dataDir, LOOP_VIEW_KEY), viewBody, "utf8");
    viewBytes = viewBody.length;
  }
  return { stateKey: LOOP_STATE_KEY, viewKey: LOOP_VIEW_KEY, stateBytes: stateBody.length, viewBytes, rows: state.ledger.rows.length };
}

// After a Top Picks run. outcomes: the picks-outcomes.json state as it stands
// (the stock outcomes the calibration counts). baseTotals: SYMBOL -> untuned
// total when live loop weights moved the grade (null otherwise).
export function loopOnRun(state, { run, date, outcomes, builtAtIso = null, baseTotals = null } = {}) {
  if (!state || !run) return { added: 0, model: null };
  const rows = joinedRows(state.ledger, outcomes);
  const model = fitCalibration(rows, { before: date, useBase: true });
  const added = appendRunLedger(state.ledger, run, date, { estimate: (setup) => estimateFor(model, setup), baseTotals });
  if (!state.startedAt) state.startedAt = builtAtIso || date;
  state.runs = (state.runs || 0) + (added ? 1 : 0);
  state.lastRun = { at: builtAtIso, date, et: run.et || null, rows: added, modelRows: model.rows };
  return { added, model };
}

// Today's run, the estimates it wrote, for the view: the strongest names by
// |total| first.
function latestEstimates(state, limit = 24) {
  const L = state.ledger;
  if (!L.rows.length) return null;
  const I = Object.fromEntries(L.keys.map((k, i) => [k, i]));
  const last = L.rows[L.rows.length - 1];
  const runKey = `${last[I.d]}|${last[I.et]}`;
  const rows = L.rows.filter((r) => `${r[I.d]}|${r[I.et]}` === runKey);
  rows.sort((a, b) => Math.abs(b[I.tot] ?? 0) - Math.abs(a[I.tot] ?? 0));
  return {
    d: last[I.d], et: last[I.et], count: rows.length,
    rows: rows.slice(0, limit).map((r) => ({
      s: r[I.s], side: r[I.side], tot: r[I.tot], out: r[I.out], ev: r[I.ev],
      p5: r[I.p5], p10: r[I.p10], p20: r[I.p20], em10: r[I.em10], im10: r[I.im10], pTp: r[I.pTp], n: r[I.pn],
    })),
  };
}

// Every full bake. Returns the view payload (also kept for the later steps).
export function loopOnBake(state, { chains, outcomes, today, builtAtIso, tradeBar = 4, extras = null } = {}) {
  const filled = fillOptionOutcomes(state.ledger, chains, { today });
  const pruned = pruneLedger(state.ledger, LEDGER_KEEP_DAYS);
  const rows = joinedRows(state.ledger, outcomes);
  const scorecard = buildScorecard(rows, { tradeBar });
  const hist = historyRows(rows);
  // Keep older history rows the ledger has pruned; refresh the ones it still holds.
  const fresh = new Map(hist.map((h) => [h.d, h]));
  const kept = (state.history || []).filter((h) => !fresh.has(h.d));
  state.history = kept.concat(hist).sort((a, b) => a.d.localeCompare(b.d)).slice(-400);
  const model = fitCalibration(rows, { before: today, useBase: true });
  const view = {
    v: LOOP_VERSION,
    builtAt: builtAtIso,
    today,
    startedAt: state.startedAt,
    status: {
      runs: state.runs || 0,
      days: scorecard.days,
      rows: scorecard.rows,
      resolved: scorecard.resolved,
      modelRows: model.rows,
      learning: model.rows < MIN_ROWS_FOR_ESTIMATE,
      needRows: MIN_ROWS_FOR_ESTIMATE,
      filledThisBake: filled,
      prunedThisBake: pruned,
    },
    latest: latestEstimates(state),
    model: modelTable(model),
    scorecard,
    history: state.history.slice(-120),
    ...(extras && typeof extras === "object" ? extras : {}),
  };
  return { view, rows, model, scorecard, filled, pruned };
}

// Evidence board rows for the loop (lib/evidence-board.mjs extraTests).
export function loopEvidenceTests(view) {
  if (!view?.scorecard) return [];
  const sc = view.scorecard;
  const honesty = sc.honesty?.p10 || null;
  const haveH = honesty?.n || 0;
  const needH = 400;
  const hVerdict = haveH >= needH && honesty.skillVsBase != null ? (honesty.skillVsBase > 0.01 ? "pass" : honesty.skillVsBase < -0.01 ? "fail" : "inconclusive") : null;
  const g = sc.gates || {};
  const gHave = g.through?.n || 0;
  const start = view.startedAt ? String(view.startedAt).slice(0, 10) : LOOP_START;
  const today = view.today || null;
  return [
    {
      id: "loop-honest-odds", name: "Loop: are the stated odds honest?", lane: "loop",
      question: "When the loop says a name has a 60% chance of moving its way over 10 sessions, does it happen about 60% of the time, and better than the base rate?",
      start, due: null, projected: today ? projectDate({ have: haveH, need: needH, since: start, today }) : null,
      progress: { have: haveH, need: needH, unit: "estimates with a 10-session outcome" },
      read: honesty && honesty.n ? { brier: honesty.brier, skill: honesty.skill, skillVsBase: honesty.skillVsBase, baseRate: honesty.baseRate } : null,
      rule: "Pass: on 400+ fitted estimates the Brier score beats the base rate on the same rows. Fail: it scores worse than the base rate.",
      status: hVerdict || (haveH >= needH ? "ready" : haveH > 0 ? "collecting" : "waiting"), verdict: hVerdict,
    },
    {
      id: "loop-gate-audit", name: "Loop: which rules pay?", lane: "loop",
      question: "Did the names each open-pick rule turned away do worse than the names it let through?",
      start, due: null, projected: today ? projectDate({ have: gHave, need: 20, since: start, today }) : null,
      progress: { have: gHave, need: 20, unit: "let-through names with a modeled option outcome" },
      read: (g.gates || []).length ? { paying: g.gates.filter((x) => x.verdict === "paying").map((x) => x.gate), costing: g.gates.filter((x) => x.verdict === "costing").map((x) => x.gate) } : null,
      rule: "Per rule, 20+ names each side: paying when the stopped names averaged 2+ points worse after costs, costing when 2+ points better.",
      status: gHave >= 20 ? "ready" : gHave > 0 ? "collecting" : "waiting", verdict: null,
    },
  ];
}

// Regime Lab: honest risks and the guards (G1-G9, 2026-11-09).
//
// With 22 tests, six cells and a dozen exit settings, hundreds of setups get
// scored and a few will look great by luck. These guards are part of the
// design: each one is a small function the harness, the runner and the bake
// call, plus a report the Owner page shows. G10's standing rules (never run
// the backtest-picks workflow, never reset the Track Record, no engine change
// before the archive test, $0 AI for the lab) are policy, not code; the
// report lists them for the reader.

import { HOLDOUT_WINDOW_IDS, REAL_IV_SINCE } from "./harness.mjs";

export const GUARDS_VERSION = "2026-11-09-guards-v1";
export const NULL_HYPOTHESIS = "same-rules";
export const LIVE_CELL_MIN_TRADES = 140;

export const GUARDS = Object.freeze([
  { id: "G1", name: "Labels never peek", rule: "Every label is computed from bars up to the prior close with the real 2-session confirmation lag; the harness refuses a centered series." },
  { id: "G2", name: "Eras named for reporting only", rule: "A strategy sees only the live label, never a window's name or reason." },
  { id: "G3", name: "Too many trials", rule: "The holdout windows (2026 slide, 2022 bear) are locked and run once; every report lists how many setups were tried." },
  { id: "G4", name: "Small samples per cell", rule: "Live conclusions wait for about 140-240 closed trades; until then cells are judged on the 2006+ price-half replay and labeled as such." },
  { id: "G5", name: "The replay is not the engine", rule: "Every window before real option history (2026-05-25) carries a price-half-only tag; the archive test is the only place the full engine is judged." },
  { id: "G6", name: "Stale options costs", rule: "Every surviving setup is rerun at double costs with a 20% IV crush after events (F22)." },
  { id: "G7", name: "The oracle leaks", rule: "Rule-based tags only, no headline text; the oracle lives on its own panel and its numbers never enter the Track Record." },
  { id: "G8", name: "Switching has failed before", rule: "The null hypothesis is one brake, same rules everywhere; a per-cell playbook must beat it, not just random." },
  { id: "G9", name: "Tighter stops can lose more", rule: "Whipsaw rate is a first-class metric and size-first sizing is always the comparison." },
  { id: "G10", name: "Hard rules that stay", rule: "Never run the backtest-picks workflow. Never reset the Track Record. No engine change until about a month of archived runs. $0 AI for the lab.", policy: true },
]);

export function assertCausal(series) {
  if (!series) return true;
  if (series.centered) throw new Error("G1: a centered label series may not drive a decision");
  for (const r of series.rows || []) if (r && r.asOf && r.date && r.asOf > r.date) throw new Error(`G1: label on ${r.date} uses data from ${r.asOf}`);
  return true;
}

// G2. What a strategy is allowed to know about a window.
export function hideWindow(window) { return window ? { from: window.from, to: window.to } : null; }

// G3. Count what was tried and lock the holdout windows.
export function createTrialLedger(prior = null) {
  const ledger = { trials: 0, bySuite: {}, holdoutRuns: { ...(prior?.holdoutRuns || {}) }, started: prior?.started || new Date().toISOString() };
  return {
    count(suite, n = 1) { ledger.trials += n; ledger.bySuite[suite] = (ledger.bySuite[suite] || 0) + n; return ledger.trials; },
    holdoutAllowed(windowId, { unlock = false } = {}) {
      if (!HOLDOUT_WINDOW_IDS.includes(windowId)) return { ok: true, locked: false };
      if (ledger.holdoutRuns[windowId]) return { ok: false, locked: true, reason: `holdout ${windowId} was already run on ${ledger.holdoutRuns[windowId]}` };
      if (unlock !== "once") return { ok: false, locked: true, reason: `holdout ${windowId} is locked; pass unlock: "once" to run it one time` };
      return { ok: true, locked: true };
    },
    recordHoldout(windowId, when = new Date().toISOString().slice(0, 10)) { ledger.holdoutRuns[windowId] = when; },
    summary() { return { ...ledger, bySuite: { ...ledger.bySuite }, holdoutRuns: { ...ledger.holdoutRuns } }; },
  };
}

// G4. Sample status for a live read.
export function sampleStatus(n, need = LIVE_CELL_MIN_TRADES) {
  const have = Number(n) || 0;
  return { have, need, status: have >= need ? "enough" : have > 0 ? "too-few" : "none", note: have >= need ? null : "Live cells are too thin; judged on the 2006+ price-half replay until the record reaches about 140-240 closed trades." };
}

// G5. Tag any result from before real option history.
export function priceHalfTag(from) {
  return from && from < REAL_IV_SINCE ? { priceHalfOnly: true, caveat: "Price half only: no AI grader, news, fundamentals, flow or real implied volatility in this window." } : { priceHalfOnly: false, caveat: null };
}

// G6. Run a setup in base and stress mode.
export function withStress(run) { return { base: run(false), stress: run(true) }; }

// G7. The oracle must stay out of the record.
export function oracleIsolated(record, oracleOutputs = []) {
  const rows = [...(record?.open || []), ...(record?.closed || [])];
  const leaked = rows.filter((t) => t && (t.oracle || t.neverRecord || t.fromOracle));
  const marked = oracleOutputs.every((o) => !o || o.neverRecord === true);
  return { ok: leaked.length === 0 && marked, leakedRows: leaked.length, outputsMarked: marked };
}

// G9. Whipsaw first-class and size-first always compared.
export function stopComparisonComplete(ruleIds = []) {
  const ids = new Set(ruleIds);
  return { ok: ids.has("size-first") || ids.has("size-first-ladder"), note: ids.has("size-first") ? null : "size-first missing from the comparison" };
}

// The report the Owner page shows: each guard with its live status.
export function guardReport({ labels = null, ledger = null, record = null, oracleOutputs = [], ruleIds = [], decidedTrades = 0, research = null } = {}) {
  const out = [];
  for (const g of GUARDS) {
    let status = "policy", detail = null;
    try {
      switch (g.id) {
        case "G1": { if (labels) { assertCausal(labels); status = "ok"; detail = `confirmation lag ${labels.stats?.confirm ?? 2} sessions; avg ${labels.stats?.avgLagDays ?? "—"} days late`; } else { status = "n/a"; detail = "no label series"; } break; }
        case "G2": status = "ok"; detail = "strategies receive {from,to} only"; break;
        case "G3": { const s = ledger?.summary ? ledger.summary() : ledger; status = s ? "ok" : "n/a"; detail = s ? `${s.trials} setups tried; holdout runs: ${Object.keys(s.holdoutRuns || {}).length ? Object.entries(s.holdoutRuns).map(([k, v]) => `${k} on ${v}`).join(", ") : "none yet (locked)"}` : "no ledger"; break; }
        case "G4": { const s = sampleStatus(decidedTrades); status = s.status === "enough" ? "ok" : "waiting"; detail = `${s.have} of ${s.need} decided live trades`; break; }
        case "G5": status = "ok"; detail = `price-half tag on every window before ${REAL_IV_SINCE}`; break;
        case "G6": { const n = research?.stress?.rerun ?? null; status = n == null ? "waiting" : "ok"; detail = n == null ? "stress rerun pending" : `${n} surviving setup(s) rerun at double costs and a 20% IV crush; ${research.stress.survived ?? 0} survived`; break; }
        case "G7": { const r = oracleIsolated(record, oracleOutputs); status = r.ok ? "ok" : "fail"; detail = r.ok ? "no oracle row in the record; outputs marked never-record" : `${r.leakedRows} leaked row(s)`; break; }
        case "G8": status = "ok"; detail = `baseline strategy: ${NULL_HYPOTHESIS}`; break;
        case "G9": { const r = stopComparisonComplete(ruleIds); status = r.ok ? "ok" : "waiting"; detail = r.ok ? "whipsaw rate reported; size-first in every stop comparison" : r.note; break; }
        default: status = "policy"; detail = "standing rule";
      }
    } catch (err) { status = "fail"; detail = String(err?.message || err); }
    out.push({ id: g.id, name: g.name, rule: g.rule, status, detail });
  }
  return { v: GUARDS_VERSION, guards: out, nullHypothesis: NULL_HYPOTHESIS };
}

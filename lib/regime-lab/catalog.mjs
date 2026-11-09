// Regime Lab: the test catalog (F1-F22, 2026-11-09).
//
// One row per test: what it asks, what it reads, where it runs (the research
// runner on long history, the bake on the live record, or both) and what it
// needs before it can be read. `catalogStatus` joins the rows with the
// results on hand so the Owner page shows every test with a status, a
// price-half tag where the window predates real option history (G5), and the
// count of setups tried (G3).

import { NEEDS } from "../evidence-board.mjs";

export const CATALOG_VERSION = "2026-11-09-catalog-v1";

// when: now = runnable on saved history today; each-build = recomputed by
// every full bake from the live record; nov23 / dec7 = the direction-skill
// dates the Evidence board already carries; archive = needs the run archive.
export const TEST_CATALOG = Object.freeze([
  { id: "F1", name: "Grade skill by regime", lane: "labels", runBy: "cli", when: "now", data: "2006+ bars, price-half grades", question: "Does the grade rank names better in trending markets than in chop?", needs: { kind: "label-days", n: 40 } },
  { id: "F2", name: "Grid labels vs hidden-Markov", lane: "labels", runBy: "cli", when: "now", data: "SPY, VIX, VIX3M, breadth since 2006", question: "Which label flips less, lags less and separates coming volatility better?", needs: { kind: "label-days", n: 750 } },
  { id: "F3", name: "Playbook switch vs same rules", lane: "playbooks", runBy: "cli", when: "now", data: "every named window", question: "Does switching playbooks by cell beat one set of rules everywhere (G8)?", needs: { kind: "windows", n: 3 } },
  { id: "F4", name: "Cash per cell", lane: "playbooks", runBy: "cli", when: "now", data: "same-rules trades by cell", question: "In which cells does standing aside beat trading after costs?", needs: { kind: "cell-trades", n: 5 } },
  { id: "F5", name: "Stop ladder by era", lane: "exits", runBy: "cli", when: "now", data: "every named window", question: "Does -50 / -45 / -35 / -30 by era beat the flat -50 stop?", needs: { kind: "windows", n: 3 }, exitIds: ["ladder"] },
  { id: "F6", name: "Continuous stop", lane: "exits", runBy: "cli", when: "now", data: "every named window", question: "Does a stop that tightens with the stock's own volatility rank beat the ladder?", needs: { kind: "windows", n: 3 }, exitIds: ["continuous"] },
  { id: "F7", name: "Price-based stop", lane: "exits", runBy: "cli", when: "now", data: "every named window", question: "Does an ATR stop on the stock, translated to premium, cut whipsaw losses?", needs: { kind: "windows", n: 3 }, exitIds: ["price-stop"] },
  { id: "F8", name: "Size first", lane: "exits", runBy: "cli", when: "now", data: "every named window", question: "Does sizing to a fixed risk budget beat changing the stop (G9)?", needs: { kind: "windows", n: 3 }, exitIds: ["size-first", "size-first-ladder"] },
  { id: "F9", name: "Targets, trails and time stops", lane: "exits", runBy: "cli", when: "now", data: "every named window", question: "Scaled targets, bank-half-and-trail and time stops against take-profit 25.", needs: { kind: "windows", n: 3 }, exitIds: ["scaled-target", "partial-trail", "time-3", "time-5", "time-8", "time-by-character"] },
  { id: "F10", name: "Book brakes on the live record", lane: "record", runBy: "bake", when: "each-build", data: "Track Record closed trades", question: "Would the brakes have refused the losers, including the Oct 28 cluster?", needs: { kind: "decided-trades", n: 30 } },
  { id: "F11", name: "Oracle: three-way replay", lane: "oracle", runBy: "both", when: "now", data: "earnings store, FOMC table, CPI and jobs dates", question: "With the headline known, how often is the move on the headline's side, and when is it already priced?", needs: { kind: "oracle-rows", n: 40 } },
  { id: "F12", name: "Oracle: best structure", lane: "oracle", runBy: "both", when: "now", data: "same book, modeled options", question: "Stock, single, debit spread or straddle, by headline type and IV level.", needs: { kind: "oracle-rows", n: 40 } },
  { id: "F13", name: "Oracle: risk and noise", lane: "oracle", runBy: "both", when: "now", data: "same book", question: "Gap risk past the stop, size as the stop, and the accuracy the oracle needs to break even.", needs: { kind: "oracle-rows", n: 40 } },
  { id: "F14", name: "Engine vs oracle", lane: "oracle", runBy: "bake", when: "archive", data: "run archive, Track Record event plays", question: "When the engine entered or waited into an event, did it agree with the oracle?", needs: { kind: "event-trades", n: NEEDS.eventTrades } },
  { id: "F15", name: "Walk-forward re-fit", lane: "harness", runBy: "cli", when: "now", data: "2008-2025 and 2026", question: "Does re-fitting bar, stop and book size every two months beat fixed rules out of sample?", needs: { kind: "oos-trades", n: 20 } },
  { id: "F16", name: "Resembles now", lane: "labels", runBy: "both", when: "each-build", data: "label history", question: "Which past sessions look like today, and what worked in them?", needs: { kind: "label-days", n: 300 } },
  { id: "F17", name: "Stock-level labels", lane: "playbooks", runBy: "cli", when: "now", data: "every named window", question: "Ride trending names and fade choppy ones: better than one rule for all?", needs: { kind: "windows", n: 3 } },
  { id: "F18", name: "Correlation eras", lane: "labels", runBy: "cli", when: "now", data: "member closes since 2006", question: "Does the grade rank names better when they move apart than when they move together?", needs: { kind: "label-days", n: 40 } },
  { id: "F19", name: "Event-heavy weeks", lane: "labels", runBy: "cli", when: "now", data: "macro dates, earnings dates", question: "Do trades entered into a heavy week do worse, and would half size help?", needs: { kind: "heavy-trades", n: 10 } },
  { id: "F20", name: "AI grader by cell", lane: "grader", runBy: "bake", when: "each-build", data: "picks-outcomes rows", question: "Does the grader's buy-now beat its wait inside each cell?", needs: { kind: "graded-rows", n: NEEDS.graderRows } },
  { id: "F21", name: "Input skill by cell", lane: "engine", runBy: "cli", when: "archive", data: "hydrated run archives", question: "Which pillar predicts in which cell?", needs: { kind: "archive-runs", n: NEEDS.outcomeRuns } },
  { id: "F22", name: "Stress rerun", lane: "harness", runBy: "cli", when: "now", data: "surviving setups", question: "Do the survivors still make money at double costs with a 20% IV crush after events (G6)?", needs: { kind: "survivors", n: 1 } },
]);

export const CATALOG_BY_ID = Object.freeze(Object.fromEntries(TEST_CATALOG.map((t) => [t.id, t])));
export const LANE_LABELS = Object.freeze({ labels: "Labels", playbooks: "Playbooks", exits: "Exits", harness: "Harness", oracle: "Oracle", record: "Record", grader: "Grader", engine: "Engine" });

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Join the catalog with results. `research` is the committed research
// summary (results keyed by test id, each with verdict / have / priceHalf /
// ranAt), `live` the bake-time results keyed the same way.
export function catalogStatus({ research = null, live = null, today = null } = {}) {
  const rows = [];
  for (const t of TEST_CATALOG) {
    const r = (live && live[t.id]) || (research && research.results && research.results[t.id]) || null;
    const source = live && live[t.id] ? "bake" : research && research.results && research.results[t.id] ? "research" : null;
    const have = num(r?.have) ?? 0;
    const verdict = r?.verdict || null;
    let status;
    if (verdict === "pass" || verdict === "fail" || verdict === "inconclusive") status = verdict;
    else if (verdict === "ok") status = "ready";
    else if (r) status = have >= t.needs.n ? "ready" : have > 0 ? "collecting" : "waiting";
    else status = t.when === "now" ? "not-run" : "waiting";
    rows.push({
      id: t.id, name: t.name, lane: t.lane, laneLabel: LANE_LABELS[t.lane] || t.lane, runBy: t.runBy, when: t.when, data: t.data, question: t.question,
      needs: t.needs, have, status, verdict, source, priceHalf: !!r?.priceHalf, holdoutLocked: !!r?.holdoutLocked, ranAt: r?.ranAt || null, read: r?.read || null, note: r?.note || null,
    });
  }
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { v: CATALOG_VERSION, asOf: today, rows, counts, trials: num(research?.trials) ?? null, holdoutRuns: research?.holdoutRuns || {}, researchRanAt: research?.ranAt || null };
}

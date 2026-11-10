// Regime Lab smoke test (lib/regime-lab/, 2026-11-09). Offline, synthetic
// data only: no provider, account or production store is contacted.
//   - labels: causal (G1), confirmed over two sessions, a stressed stretch
//     reads stressed, the hindsight series is refused by the guard
//   - hidden-Markov challenger fits two states on a synthetic return series
//   - risk score bounds and the era stop ladder (E1, E2)
//   - harness: deterministic, same-rules vs switch on synthetic bars, holdout
//     windows locked until unlocked once (G3)
//   - oracle: rule-tagged book, replay, never-record flag (G7)
//   - catalog: every F1-F22 row has a status; payload builds from minimal
//     inputs; shadow books open and mark; the evidence board takes the lab's
//     four rows; the Owner-only key is gated like picks-outcomes.json
//   - render: the Owner Lab markup carries the Regime Lab tab and panel
// Run: node scripts/regime-lab-smoke.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as L from "../lib/regime-lab/labels.mjs";
import { hmmLabelSeries } from "../lib/regime-lab/hmm.mjs";
import { riskScore, ladderStop, STOP_LADDER, bookBrakes, EXIT_RULE_SETS, resolveExitParams } from "../lib/regime-lab/exits.mjs";
import { PLAYBOOKS, STRATEGIES, decideEntry, strategyPlaybook, playbookForCell } from "../lib/regime-lab/playbooks.mjs";
import { makeContext, simulate, scorecard, WINDOWS, HOLDOUT_WINDOW_IDS, REAL_IV_SINCE } from "../lib/regime-lab/harness.mjs";
import { buildHeadlineBook, replayBook, structuresUnderOracle } from "../lib/regime-lab/oracle.mjs";
import { assertCausal, createTrialLedger, guardReport, oracleIsolated, priceHalfTag, sampleStatus } from "../lib/regime-lab/guards.mjs";
import { TEST_CATALOG, catalogStatus } from "../lib/regime-lab/catalog.mjs";
import { strategyComparison, labelStability, icByLabel } from "../lib/regime-lab/tests.mjs";
import * as P from "../lib/regime-lab/payload.mjs";
import { buildEvidenceBoard } from "../lib/evidence-board.mjs";
import { buildPicksRunRecord } from "../lib/picks-run-archive.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { isBakeOwnedKey, isLocalOnlyKey, isDynamicBakeKey } from "../lib/data-ownership.mjs";

// ---- synthetic market ---------------------------------------------------------
export function syntheticCalendar(n, start = "2021-01-04") {
  const cal = [];
  const d = new Date(start + "T00:00:00Z");
  while (cal.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) cal.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return cal;
}
export function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function gaussFrom(rnd) { return () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }

// A market with a stressed, falling stretch every 400 sessions (60 sessions
// long) and calm up-trends between them.
export function syntheticMarket({ n = 1400, seed = 7, members = 30 } = {}) {
  const cal = syntheticCalendar(n);
  const rnd = seeded(seed), gauss = gaussFrom(rnd);
  const stressed = (i) => i % 400 >= 200 && i % 400 < 260;
  const mk = (p0, vol, drift, beta = 1) => { let p = p0; const out = []; for (let i = 0; i < n; i++) { const st = stressed(i); const v = vol * (st ? 2.5 : 1); const dr = st ? -0.004 * beta : drift; p *= Math.exp(dr + v * gauss()); const h = p * (1 + Math.abs(gauss()) * v), l = p * (1 - Math.abs(gauss()) * v); out.push({ t: cal[i], c: +p.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), o: +((h + l) / 2).toFixed(2) }); } return out; };
  const spy = mk(380, 0.008, 0.0005), qqq = mk(300, 0.011, 0.0006, 1.2), iwm = mk(200, 0.012, 0.0003, 1.1);
  const vix = cal.map((t, i) => ({ t, c: +(stressed(i) ? 32 + gauss() * 3 : 14 + gauss() * 1.5).toFixed(2) }));
  const vix3m = vix.map((r) => ({ t: r.t, c: +(r.c * (r.c > 25 ? 0.9 : 1.08)).toFixed(2) }));
  const mem = {};
  for (let k = 0; k < members; k++) mem["S" + k] = mk(50 + k, 0.018, 0.0003 + (k % 5) * 0.0001, 0.8 + (k % 4) * 0.2);
  return { cal, spy, qqq, iwm, vix, vix3m, members: mem, stressed };
}

// The payload the browser check serves: labels, books, a marked trade, the
// catalog with one research result, an oracle on a small synthetic book.
export function regimeLabFixture() {
  const m = syntheticMarket();
  const n = m.cal.length, today = m.cal[n - 1], builtAtIso = today + "T21:10:00Z";
  const inputs = P.buildLabelInputs({ spy: m.spy, spyBars: m.spy, qqq: m.qqq, iwm: m.iwm, vix: m.vix, vix3m: m.vix3m, members: m.members });
  const { series, hmm, hmmOffset } = P.buildBakeLabels(inputs, { macroEvents: [{ label: "CPI", date: m.cal[n - 1] }], earningsDates: ["S1", "S2"].map(() => today) });
  const state = P.emptyRegimeLabState();
  const run = { rows: Object.keys(m.members).map((s, i) => ({ s, tot: (i % 2 ? 1 : -1) * (3 + (i % 7)), side: i % 2 ? "call" : "put", spot: m.members[s][n - 1].c, ne: null })) };
  const expiry = Math.floor(Date.parse(today) / 1000) + 60 * 86400;
  const contractFor = () => ({ strike: 50, expiry, dte: 60, bid: 2, ask: 2.2, mid: 2.1, iv: 0.3, delta: 0.55, thetaDay: -0.02 });
  P.openShadowBooks(state, { run, label: series.rows[series.rows.length - 1], barsOf: (s) => m.members[s] || null, contractFor, builtAtIso, sectorOf: (s) => (Number(s.slice(1)) % 3 ? "Tech" : "Energy"), bar: 4 });
  const chains = {}; for (const s of Object.keys(m.members)) chains[s] = { spot: m.members[s][n - 1].c * 1.03 };
  P.markShadowBooks(state, { chains, builtAtIso, markFn: (e, data) => ((Math.round(data.spot) % 10) - 4) * 8 * (e.side === "call" ? 1 : -1), resolveFn: (o) => (o.modeledOptPnlPct >= o.exitPolicy.takeProfitPct ? { status: "hit-tp-prem", outcome: "win" } : o.modeledOptPnlPct <= o.exitPolicy.stopPct ? { status: "hit-stop-prem", outcome: "loss" } : null), outcomeFn: (p) => (p >= 0 ? "win" : "loss") });
  // A small live record with label stamps and a cluster day.
  const closed = [];
  for (let i = 0; i < 40; i++) {
    const d = m.cal[n - 90 + i * 2];
    closed.push({ id: `S${i % 9}-C-${d}`, symbol: "S" + (i % 9), side: i % 4 === 3 ? "put" : "call", entryDate: d + "T15:30:00Z", exitDate: m.cal[n - 90 + i * 2 + 5] + "T20:00:00Z", optionPnlPct: i % 3 === 0 ? -50 : 25, outcome: i % 3 === 0 ? "loss" : "win", status: i % 3 === 0 ? "hit-stop-prem" : "hit-tp-prem", contract: { structure: "long", strike: 50, expiry, dte: 45, mid: 2 }, exitPolicy: { version: "2026-10-22-tp25", takeProfitPct: 25, stopPct: -50 }, labRegime: i % 2 ? { cell: "up-calm", era: "calm" } : null });
  }
  const open = [{ id: "S3-C-open", symbol: "S3", side: "call", entryDate: today + "T15:30:00Z", optionPnlPct: 4, contract: { structure: "long", strike: 50, expiry, dte: 60, mid: 2.1, thetaDay: -0.02 }, exitPolicy: { version: "2026-10-22-tp25", takeProfitPct: 25, stopPct: -50 } }];
  // Oracle on a synthetic earnings book over the members.
  const earningsStore = { tickers: {} };
  for (let k = 0; k < 12; k++) earningsStore.tickers["S" + k] = { events: [0, 1, 2, 3].map((q) => ({ date: m.cal[n - 40 - q * 63 - k], session: k % 2 ? "AM" : "PM", epsActual: 1 + (k + q) % 3 * 0.1, epsEstimate: 1.1, surprisePct: ((k + q) % 3 - 1) * 5 })) };
  const fomc = new Map([[m.cal[n - 30], { type: "cut", bp: -25 }], [m.cal[n - 90], { type: "hold", bp: 0 }], [m.cal[n - 150], { type: "hike", bp: 25 }]]);
  const oracle = P.buildBakeOracle({ cal: m.cal, earningsStore, fomc, releases: { cpi: [m.cal[n - 20], m.cal[n - 41]], jobs: [m.cal[n - 10]] }, fred: { CPIAUCSL: { t: m.cal.filter((_, i) => i % 21 === 0), v: m.cal.filter((_, i) => i % 21 === 0).map((_, i) => 300 + i) }, PAYEMS: { t: m.cal.filter((_, i) => i % 21 === 0), v: m.cal.filter((_, i) => i % 21 === 0).map((_, i) => 150000 + i * 100) } }, barsOf: (s) => (s === "SPY" ? m.spy : m.members[s] || null), ivRatioOf: () => 1.2, liveClosed: closed, from: m.cal[n - 100], to: today });
  const research = { ranAt: builtAtIso, trials: 48, holdoutRuns: {}, summary: { headline: "Synthetic research run.", lines: ["F1: trending IC 0.08 vs chop 0.01."] }, results: { F1: { verdict: "pass", have: 400, priceHalf: true, ranAt: today, read: { all: 0.04, trending: 0.08, chop: 0.01 } }, F3: { verdict: "inconclusive", have: 5, priceHalf: true, ranAt: today, read: { beatBaseline: "3/5", switchAvgNet: 2.1, baseAvgNet: 1.4 } } } };
  const payload = P.buildRegimeLabPayload({ state, labels: series, hmm, hmmOffset, builtAtIso, today, members: m.members, sectorOf: (s) => (Number(s.slice(1)) % 3 ? "Tech" : "Energy"), openTrades: open, closedTrades: closed, outcomes: null, oracle, research, cycle: { policy: "easing", credit: "loose", market: "expansion", quadrant: "goldilocks" }, leadership: "growth leads value", nextEarningsOf: () => null, closesOf: (s) => (m.members[s] || []).map((b) => b.c), stampedTrades: 20, gradeModelVersion: "test", spyCtx: { syms: { SPY: { c: m.spy.map((b) => b.c), idx: new Map(m.cal.map((d, i) => [d, i])) } } } });
  return { market: m, inputs, series, hmm, hmmOffset, state, payload, today, builtAtIso, closed, open, oracle };
}

async function main() {
  const m = syntheticMarket();
  const n = m.cal.length;

  // ---- A: labels -----------------------------------------------------------------
  const inputs = P.buildLabelInputs({ spy: m.spy, spyBars: m.spy, qqq: m.qqq, iwm: m.iwm, vix: m.vix, vix3m: m.vix3m, members: m.members });
  assert.equal(inputs.cal.length, Math.min(n, P.LABEL_SESSIONS), "calendar is the SPY sessions, capped");
  assert.ok(inputs.breadth50 && inputs.members, "breadth and member closes present");
  const { series, hmm, hmmOffset } = P.buildBakeLabels(inputs, { macroEvents: [{ label: "FOMC decision", date: m.cal[n - 1] }], earningsDates: [] });
  assert.equal(series.rows.length, inputs.cal.length);
  assert.equal(series.centered, false);
  assert.ok(assertCausal(series), "G1: the bake series is causal");
  assert.throws(() => assertCausal({ centered: true, rows: [] }), /G1/, "a centered series is refused");
  assert.throws(() => assertCausal({ rows: [{ date: "2026-01-02", asOf: "2026-01-05" }] }), /G1/, "a row that uses later data is refused");
  // The stressed stretch reads stressed once confirmed; the calm stretch calm.
  const offset = inputs.cal.length === n ? 0 : n - inputs.cal.length;
  const stressedCells = series.rows.filter((r, i) => m.stressed(i + offset + 0) && m.stressed(i + offset - 10)).map((r) => r.cell);
  const stressedShare = stressedCells.filter((c) => /-stressed$/.test(c)).length / Math.max(1, stressedCells.length);
  assert.ok(stressedShare > 0.8, `stressed stretch labeled stressed (${(stressedShare * 100).toFixed(0)}%)`);
  const calmCells = series.rows.filter((r, i) => !m.stressed(i + offset) && !m.stressed(i + offset - 15) && !m.stressed(i + offset + 5) && i > 60).map((r) => r.cell);
  const calmShare = calmCells.filter((c) => /-calm$/.test(c)).length / Math.max(1, calmCells.length);
  assert.ok(calmShare > 0.8, `calm stretch labeled calm (${(calmShare * 100).toFixed(0)}%)`);
  // Confirmation: a switch needs two sessions; the confirmed series flips less than the raw one.
  assert.ok(series.stats.flips < series.stats.rawFlips, "confirmation removes flips");
  assert.ok(series.stats.avgLagDays >= 1, "the confirmed label is at least a day late");
  assert.ok(series.hindsight && series.hindsight.centered === true, "the hindsight series is marked centered");
  // Event load stamps only the latest row in the bake.
  assert.ok(series.rows[series.rows.length - 1].detail.eventLoad, "latest row carries the event load");
  assert.equal(series.rows[series.rows.length - 2].detail.eventLoad, null, "earlier rows carry no forward-looking read");
  assert.ok(Array.isArray(series.spyCloses) && series.spyCloses.length === series.cal.length, "SPY closes ride the series for F2");
  // Stock labels (A10).
  const sl = L.stockLabel(m.members.S0, m.members.S0.length - 1);
  assert.ok(["trending", "choppy"].includes(sl.label), "a stock gets a label");

  // ---- A: hidden-Markov challenger ----------------------------------------------
  assert.ok(hmm && hmm.rows.length > 0 && hmm.stats.flipsPerYear >= 0, "HMM fits");
  const stability = labelStability({ grid: series, hmm, cal: series.cal, spyCloses: series.spyCloses });
  assert.ok(stability.grid.separation.ratio > 1.3, `stressed label separates forward vol (${stability.grid.separation.ratio})`);
  assert.ok(stability.agreementPct >= 50, "grid and HMM mostly agree on stress");

  // ---- E: risk and exits --------------------------------------------------------
  for (const era of ["calm", "normal", "elevated", "crisis"]) {
    const s = riskScore({ structure: "long", era, stockVolRankPct: 50, dte: 60 }).score;
    assert.ok(s >= 1 && s <= 10, `risk score in bounds for ${era}`);
  }
  assert.ok(riskScore({ era: "crisis", stockVolRankPct: 100, dte: 10, eventInWindow: true }).score > riskScore({ era: "calm", stockVolRankPct: 0, dte: 80 }).score, "risk rises with era, vol, expiry and events");
  assert.ok(riskScore({ structure: "debit" }).score < riskScore({ structure: "long" }).score, "a defined-risk spread scores lower than a single");
  assert.deepEqual([ladderStop("calm"), ladderStop("normal"), ladderStop("elevated"), ladderStop("crisis")], [STOP_LADDER.calm, STOP_LADDER.normal, STOP_LADDER.elevated, STOP_LADDER.crisis]);
  assert.ok(STOP_LADDER.crisis > STOP_LADDER.calm, "the ladder tightens into a crisis");
  assert.ok(bookBrakes("crisis").maxOpen < bookBrakes("calm").maxOpen, "brakes shrink the book in a crisis");
  assert.ok(EXIT_RULE_SETS.some((r) => r.id === "size-first"), "G9: size-first is a rule set");
  const ladderParams = resolveExitParams("ladder", { era: "crisis" });
  assert.equal(ladderParams.stopPct, STOP_LADDER.crisis, "ladder rule set resolves the era stop");

  // ---- B: playbooks ---------------------------------------------------------------
  assert.ok(PLAYBOOKS.some((p) => p.baseline && p.id === "same-rules"), "G8: same-rules is the baseline playbook");
  assert.equal(playbookForCell("chop-stressed"), "cash", "chop-stressed stands aside");
  assert.equal(strategyPlaybook("switch", { cell: "up-calm", transition: false }), "ride");
  assert.equal(strategyPlaybook("switch", { cell: "up-calm", transition: true }), "transition", "a label in transition uses the transition playbook");
  const bars = m.members.S1.slice(-30);
  const dec = decideEntry("ride", { sym: "S1", side: "call", total: 6, spot: bars[bars.length - 1].c, s20: null, r20: null, bars, label: { cell: "up-calm" }, era: "calm", character: "up" });
  assert.equal(dec.take, true, "ride takes a call in an up-calm market");
  const dec2 = decideEntry("ride", { sym: "S1", side: "put", total: -6, spot: bars[bars.length - 1].c, s20: null, r20: null, bars, label: { cell: "up-calm" }, era: "calm", character: "up" });
  assert.equal(dec2.take, false, "ride refuses a put");
  assert.equal(decideEntry("cash", { sym: "S1", side: "call", total: 8, spot: 100, bars }).take, false, "cash takes nothing");

  // ---- C: harness -------------------------------------------------------------------
  const grades = {};
  for (let i = 60; i < n; i += 5) { const d = m.cal[i]; grades[d] = {}; for (const [s, b] of Object.entries(m.members)) { const r = b[i].c / b[i - 20].c - 1; grades[d][s] = Math.max(-10, Math.min(10, Math.round(r * 60 * 10) / 10)); } }
  // The harness takes columnar bars: { t: [], c: [], h: [], l: [] }.
  const columnar = (b) => ({ t: b.map((x) => x.t), c: b.map((x) => x.c), h: b.map((x) => x.h), l: b.map((x) => x.l) });
  const bars2 = {}; for (const [s, b] of Object.entries(m.members)) bars2[s] = columnar(b);
  bars2.SPY = columnar(m.spy);
  const ctx = makeContext({ cal: m.cal, bars: bars2, grades, labels: series, sectorOf: (s) => (Number(s.slice(1)) % 3 ? "Tech" : "Energy"), themeOf: () => null, isEtf: (s) => s === "SPY", events: { earnings: [], macro: [] } });
  const win = { from: m.cal[400], to: m.cal[1000] };
  const a = simulate(ctx, { window: win, strategy: "same-rules", exits: "flat-50", seed: 1 });
  const b = simulate(ctx, { window: win, strategy: "same-rules", exits: "flat-50", seed: 1 });
  assert.deepEqual(a.trades, b.trades, "the harness is deterministic");
  assert.ok(a.trades.length >= 20, `the harness trades (${a.trades.length})`);
  const aCard = scorecard(a);
  assert.ok(Number.isFinite(aCard.avgNet) && aCard.n === a.trades.filter((t) => !t.void).length, "scorecard summarizes the trades");
  assert.ok(a.trades.every((t) => t.entry >= win.from && t.exit <= m.cal[n - 1] && Number.isFinite(t.net)), "every trade is dated inside the run and priced");
  assert.ok(a.trades.every((t) => t.cell && t.era), "every harness trade carries the label in force (G2: cell only, no window name)");
  const sw = simulate(ctx, { window: win, strategy: "switch", exits: "flat-50", seed: 1 });
  const swCard = scorecard(sw);
  assert.ok(Number.isFinite(swCard.avgNet) || swCard.n === 0, "switch strategy simulates");
  assert.ok(sw.trades.every((t) => t.playbook), "switch trades name their playbook");
  const stress = simulate(ctx, { window: win, strategy: "same-rules", exits: "flat-50", seed: 1, stress: true });
  assert.ok(scorecard(stress).avgNet <= aCard.avgNet + 1e-9, "G6: stress (double costs) never helps");
  const ladder = simulate(ctx, { window: win, strategy: "same-rules", exits: "ladder", seed: 1 });
  assert.ok(ladder.trades.length > 0 && ladder.trades.some((t) => t.stopPct !== -50), "the ladder rule set changes the stop by era");
  const ic = icByLabel(ctx, { horizon: 10, from: m.cal[400], to: m.cal[1000] });
  assert.equal(ic.id, "F1");
  assert.ok(ic.days > 20, "IC read has days");
  // Holdout lock (G3).
  const ledger = createTrialLedger();
  for (const id of HOLDOUT_WINDOW_IDS) assert.equal(ledger.holdoutAllowed(id).ok, false, `${id} is locked`);
  assert.equal(ledger.holdoutAllowed(HOLDOUT_WINDOW_IDS[0], { unlock: "once" }).ok, true);
  ledger.recordHoldout(HOLDOUT_WINDOW_IDS[0], "2026-11-09");
  assert.equal(ledger.holdoutAllowed(HOLDOUT_WINDOW_IDS[0], { unlock: "once" }).ok, false, "a holdout runs once");
  assert.ok(WINDOWS.every((w) => w.from && w.to && w.id), "every window is dated");
  assert.equal(priceHalfTag("2020-01-01").priceHalfOnly, true, "G5: pre-2026-05-25 windows are price-half");
  assert.equal(priceHalfTag(REAL_IV_SINCE).priceHalfOnly, false);
  const cmp = strategyComparison(ctx, { windowIds: ["2008-crisis"], strategyIds: ["same-rules", "switch"], ledger });
  assert.equal(cmp.id, "F3");
  assert.ok(cmp.windows.length === 0 || cmp.windows[0].control != null, "comparison carries a control pool per window");
  const lockedTry = strategyComparison(ctx, { windowIds: [HOLDOUT_WINDOW_IDS[1]], strategyIds: ["same-rules"], ledger });
  assert.ok(lockedTry.locked.some((l) => l.id === HOLDOUT_WINDOW_IDS[1]), "a locked holdout is reported, not run");

  // ---- D: oracle -----------------------------------------------------------------------
  const book = buildHeadlineBook({ cal: m.cal, earnings: [{ sym: "S1", date: m.cal[n - 50], session: "AM", epsActual: 1.2, epsEstimate: 1, surprisePct: 20 }, { sym: "S2", date: m.cal[n - 60], session: "PM", epsActual: 0.8, epsEstimate: 1, surprisePct: -20 }], fomc: [{ date: m.cal[n - 30], outcome: "cut", bp: -25 }], cpi: [{ date: m.cal[n - 20], change: 0.002, priorChange: 0.004 }], jobs: [] });
  assert.equal(book.neverRecord, true, "G7: the book is marked never-record");
  assert.ok(Object.isFrozen(book), "the book is frozen");
  assert.equal(book.rows.length, 4);
  assert.ok(book.rows.every((r) => r.tag === 1 || r.tag === -1 || r.tag === 0), "every row carries a rule tag");
  const replay = replayBook(book, (s) => (s === "SPY" ? m.spy : m.members[s] || null));
  assert.ok(replay.rows.length >= 3, "the replay prices the rows with bars");
  const structures = structuresUnderOracle(replay, (s) => (s === "SPY" ? m.spy : m.members[s] || null), { ivRatioOf: () => 1.2 });
  assert.ok(structures.rows.length >= 3 && structures.byType.earnings, "structures price per type");
  const iso = oracleIsolated({ open: [], closed: [{ symbol: "S1" }] }, [book, replay]);
  assert.equal(iso.ok, true, "G7: no oracle row in the record");
  assert.equal(oracleIsolated({ closed: [{ symbol: "S1", fromOracle: true }] }, []).ok, false, "a leaked oracle row fails the guard");

  // ---- F / G: catalog, guards --------------------------------------------------------
  assert.equal(TEST_CATALOG.length, 22, "F1-F22");
  assert.deepEqual(TEST_CATALOG.map((t) => t.id), Array.from({ length: 22 }, (_, i) => `F${i + 1}`));
  const empty = catalogStatus({ research: null, live: null, today: "2026-11-09" });
  assert.equal(empty.rows.length, 22);
  assert.ok(empty.rows.every((r) => ["not-run", "waiting", "collecting", "ready", "pass", "fail", "inconclusive"].includes(r.status)), "every row has a status");
  const withResearch = catalogStatus({ research: { trials: 10, holdoutRuns: {}, results: { F1: { verdict: "pass", have: 100, priceHalf: true } } }, live: { F10: { verdict: "inconclusive", have: 35 } }, today: "2026-11-09" });
  assert.equal(withResearch.rows.find((r) => r.id === "F1").status, "pass");
  assert.equal(withResearch.rows.find((r) => r.id === "F1").priceHalf, true, "G5 tag rides the row");
  assert.equal(withResearch.rows.find((r) => r.id === "F10").source, "bake", "a bake result wins over research");
  assert.equal(withResearch.trials, 10, "G3 trial count");
  assert.equal(sampleStatus(10).status, "too-few");
  const gr = guardReport({ labels: series, ledger, record: { open: [], closed: [] }, oracleOutputs: [book], ruleIds: EXIT_RULE_SETS.map((r) => r.id) });
  assert.equal(gr.guards.length, 10, "G1-G10");
  assert.equal(gr.guards.find((g) => g.id === "G1").status, "ok");
  assert.equal(gr.guards.find((g) => g.id === "G9").status, "ok");
  assert.equal(gr.guards.find((g) => g.id === "G10").status, "policy");

  // ---- payload, shadow books, evidence rows, state file ----------------------------------
  const fx = regimeLabFixture();
  const p = fx.payload;
  assert.equal(p.v, P.REGIME_LAB_PAYLOAD_VERSION);
  assert.ok(p.today && p.today.cell && p.today.cellLabel, "today has a cell");
  assert.equal(p.cells.ids.length, 6);
  assert.ok(p.history.length <= P.HISTORY_KEEP && p.history.length > 100, "history is compact and capped");
  assert.ok(p.history.every((r) => r.d && r.cell), "history rows carry a date and a cell");
  assert.ok(p.books.strategies.length === STRATEGIES.length, "one shadow book per strategy");
  assert.ok(p.books.open.length > 0, "shadow books opened trades");
  assert.ok(p.books.open.every((e) => e.contract && e.strategy && e.cell), "shadow entries carry contract, strategy, cell");
  const sameRules = p.books.strategies.find((s) => s.id === "same-rules");
  assert.ok(sameRules && sameRules.baseline, "the baseline book is present");
  assert.ok(p.risk.rows.length === 1 && p.risk.rows[0].score >= 1 && p.risk.rows[0].score <= 10, "risk scores on the open trades");
  assert.equal(p.brakes.id, "F10");
  assert.ok(p.oracle && p.oracle.neverRecord === true && p.oracle.book.rows > 0, "oracle rides the payload, marked never-record");
  assert.ok(p.oracle.types.earnings && p.oracle.types.earnings.n > 0, "earnings headlines replayed");
  assert.equal(p.catalog.rows.length, 22);
  assert.equal(p.catalog.rows.find((r) => r.id === "F1").status, "pass", "research result joins the catalog");
  assert.equal(p.catalog.rows.find((r) => r.id === "F10").source, "bake");
  assert.equal(p.guards.guards.length, 10);
  assert.equal(p.evidence.length, 4, "four evidence rows");
  assert.ok(p.evidence.every((t) => t.lane === "regime" && /^regime-/.test(t.id) && t.status), "evidence rows are shaped for the board");
  assert.ok(p.liveByCell["up-calm"].n > 0, "stamped trades count in their cell");
  assert.ok(p.stocks.rows.length >= 20 && p.stocks.counts.total === p.stocks.rows.length, "stock labels for the members");
  assert.ok(p.resembles.neighbors.length >= 3, "look-alike sessions found");
  assert.ok(JSON.stringify(p).length < 600000, "payload stays under 600 KB");
  // Every number in the payload is finite (no NaN leaks to the page).
  assert.doesNotMatch(JSON.stringify(p), /NaN|Infinity/, "no NaN or Infinity in the payload");
  // The stamp for a record trade.
  const stamp = P.labStamp(p.today);
  assert.deepEqual(Object.keys(stamp).sort(), ["asOf", "cell", "character", "era", "transition", "v"]);
  // Evidence board accepts the lab rows and skips a malformed one.
  const board = buildEvidenceBoard({ outcomes: null, closed: [], open: [], builtAtIso: fx.builtAtIso, today: fx.today, extraTests: [...p.evidence, { id: "bad", lane: "regime", status: "nope" }, { id: "regime-switch-books", lane: "regime", status: "waiting" }] });
  assert.equal(board.tests.filter((t) => t.lane === "regime").length, 4, "the board carries the four lab rows once");
  assert.ok(!board.tests.some((t) => t.id === "bad"), "a row with an unknown status is skipped");
  // Run archive record carries the lab stamp.
  const rec = buildPicksRunRecord({ builtAtIso: fx.builtAtIso, scored: [], picks: [], lab: stamp });
  assert.deepEqual(rec.lab, { v: stamp.v, cell: stamp.cell, era: stamp.era, character: stamp.character, transition: stamp.transition, asOf: stamp.asOf });
  assert.equal(buildPicksRunRecord({ builtAtIso: fx.builtAtIso, scored: [], picks: [] }).lab, undefined, "no stamp, no field");
  // State round-trips through the file.
  const dir = await mkdtemp(resolve(tmpdir(), "stonks-regime-lab-"));
  try {
    const info = await P.writeRegimeLab(dir, p);
    assert.equal(info.key, P.REGIME_LAB_KEY);
    const loaded = await P.loadRegimeLab(dir);
    assert.equal(loaded.error, null);
    assert.equal(loaded.state.history.length, p.history.length, "history round-trips");
    assert.equal(loaded.state.books.open.length, p.books.open.length, "open shadow trades round-trip");
    const missing = await P.loadRegimeLab(resolve(dir, "nope"));
    assert.equal(missing.error, null, "a missing file is a fresh start, not an error");
    assert.deepEqual(missing.state.history, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
  // mergeHistory keeps an earlier day's event read.
  const merged = P.mergeHistory([{ d: "2026-11-05", cell: "up-calm", ev: "heavy" }], [{ d: "2026-11-05", cell: "up-stressed" }, { d: "2026-11-06", cell: "up-calm" }]);
  assert.deepEqual(merged, [{ d: "2026-11-05", cell: "up-stressed", ev: "heavy" }, { d: "2026-11-06", cell: "up-calm" }]);
  // Kill switch.
  assert.equal(P.regimeLabEnabled({ REGIME_LAB: "0" }), false);
  assert.equal(P.regimeLabEnabled({}), true);

  // ---- Owner-only key -----------------------------------------------------------------------
  const key = P.REGIME_LAB_KEY;
  assert.equal(isPremiumKey(key), true, "regime-lab.json is private");
  assert.equal(isRoleRestrictedKey(key), true);
  assert.deepEqual(roleClaimForKey(key), ["tr", "tp"], "Owner claims required");
  assert.equal(isBakeOwnedKey(key), true, "the bake owns the file");
  assert.equal(isLocalOnlyKey(key), false);
  assert.equal(isDynamicBakeKey(key), false);

  // ---- render --------------------------------------------------------------------------------
  const { renderHtml, renderAppJs, renderStylesCss } = await import("./build.mjs");
  const app = renderAppJs({});
  assert.match(app, /function loadRegimeLab\(/, "app.js carries the Regime Lab loader");
  assert.match(app, /'regime'(?:,'[a-z-]+')*\]\.indexOf\(view\)/, "the Owner Lab view switch accepts the regime view");
  assert.match(app, /data-owner-regime-refresh/, "refresh button is bound");
  assert.match(app, /\['regime', 'Regime Lab'\]/, "the Evidence board lists the Regime Lab lane");
  const css = renderStylesCss();
  assert.match(css, /\.rgl-grid \{/, "stylesheet carries the lab");
  const { mkdtemp: mk, mkdir } = await import("node:fs/promises");
  const tmp = await mk(resolve(tmpdir(), "stonks-regime-lab-html-"));
  try {
    const dataDir = resolve(tmp, "data"); await mkdir(dataDir);
    const html = await renderHtml({ symbols: ["AAPL"], builtAt: "Nov 9, 2026", builtAtIso: "2026-11-09T16:10:00Z", narratives: [], sectorOverviews: {}, spots: {}, dataDir });
    assert.match(html, /id="owner-tab-regime"/, "Owner Lab tab");
    assert.match(html, /id="owner-panel-regime"[^>]*hidden/, "panel starts hidden");
    assert.match(html, /id="regime-lab-root"/, "panel root");
    assert.ok(html.indexOf('id="owner-panel-regime"') > html.indexOf('id="owner-panel-evidence"'), "panel sits after Evidence");
  } finally { await rm(tmp, { recursive: true, force: true }); }

  console.log("regime-lab smoke: ok");
}

if (process.argv[1] && /regime-lab-smoke\.mjs$/.test(process.argv[1])) await main();

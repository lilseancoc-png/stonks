// Regime Lab: the test implementations (F1-F22, 2026-11-09).
//
// Every test is a pure function over a harness context (harness.mjs
// makeContext), a label series (labels.mjs) or the Owner's own records. The
// research runner (scripts/regime-lab.mjs) calls the long-history tests; the
// bake (lib/regime-lab/payload.mjs) calls the ones that read the live record,
// the outcome rows and the archive. Nothing here reads a file, a clock or the
// network, and nothing here writes to the Track Record.
//
// Verdict words follow the Evidence board: pass / fail / inconclusive /
// insufficient. Every long-history result is tagged price-half-only when the
// window starts before real option history (G5).

import { CELLS, stockLabel, realizedVol } from "./labels.mjs";
import { simulate, scorecard, controlPool, byCell, byHalf, verdicts, walkForward, windowRange, priceHalfOnly, WINDOWS, HARNESS_DEFAULTS } from "./harness.mjs";
import { STRATEGIES } from "./playbooks.mjs";
import { EXIT_RULE_SETS, bookBrakes, themeOf as defaultThemeOf } from "./exits.mjs";
import { replayBook, structuresUnderOracle } from "./oracle.mjs";
import { spearman } from "../picks-outcomes.mjs";

export const TESTS_VERSION = "2026-11-09-tests-v1";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const mean = (xs) => { const v = (xs || []).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (k, n) => (n ? Math.round((k / n) * 100) : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateKey = (iso) => { const d = typeof iso === "string" ? iso.slice(0, 10) : null; return d && DATE_RE.test(d) ? d : null; };
const characterOfCell = (cell) => (cell ? (cell.startsWith("chop") ? "chop" : "trending") : null);

function describe(list) {
  const xs = list.filter((x) => Number.isFinite(x));
  return { n: xs.length, avg: xs.length ? r1(mean(xs)) : null, winPct: xs.length ? pct(xs.filter((x) => x > 0).length, xs.length) : null };
}

// Forward close-to-close move of `sym` from `date` over `horizon` sessions, in %.
export function forwardReturn(ctx, sym, date, horizon = 10) {
  const s = ctx.syms[sym];
  if (!s) return null;
  const i = s.idx.get(date);
  if (i == null || i + horizon >= s.c.length || !(s.c[i] > 0) || !(s.c[i + horizon] > 0)) return null;
  return (s.c[i + horizon] / s.c[i] - 1) * 100;
}

// `unlock` is the one-time holdout key (G4): the CLI passes it only for the
// `holdout` subcommand, so every other call leaves a holdout window locked.
function windowsFor(ctx, ids, ledger = null, unlock = false) {
  const picked = (ids && ids.length ? WINDOWS.filter((w) => ids.includes(w.id)) : WINDOWS.filter((w) => !w.holdout)).filter((w) => windowRange(ctx, w.from, w.to));
  const out = [], locked = [];
  for (const w of picked) {
    const ok = ledger ? ledger.holdoutAllowed(w.id, { unlock }) : { ok: !w.holdout, locked: !!w.holdout, reason: w.holdout ? "holdout window is locked" : null };
    if (ok.ok) out.push(w); else locked.push({ id: w.id, reason: ok.reason });
  }
  return { windows: out, locked };
}

// ---------------------------------------------------------------------------
// F1. Does the grade predict better in trending markets than in chop?
// Spearman rank correlation per grade day between the totals and the next
// `horizon` sessions' moves, grouped by the label in force at the decision
// (the prior close, G1), in both halves of the span.
// ---------------------------------------------------------------------------
export function icByLabel(ctx, { horizon = 10, from = null, to = null, bar = 4, minNames = 8 } = {}) {
  const days = ctx.gradeDays.filter((d) => (!from || d >= from) && (!to || d <= to));
  const per = [];
  for (const d of days) {
    const g = ctx.grades[d];
    const xs = [], ys = [];
    let hit = 0, signed = 0;
    for (const [sym, tot] of Object.entries(g)) {
      const t = num(tot), f = forwardReturn(ctx, sym, d, horizon);
      if (t == null || f == null) continue;
      xs.push(t); ys.push(f);
      if (Math.abs(t) >= bar) { signed++; if (Math.sign(t) === Math.sign(f)) hit++; }
    }
    if (xs.length < minNames) continue;
    const ic = spearman(xs, ys);
    if (ic == null) continue;
    const lab = ctx.lab ? ctx.lab.priorClose(d) : null;
    per.push({ date: d, ic, n: xs.length, hit: signed ? hit / signed : null, cell: lab?.cell || null, era: lab?.era || null, corr: lab?.detail?.corr?.regime || null, transition: !!lab?.transition });
  }
  const mid = per.length ? per[Math.floor(per.length / 2)].date : null;
  const group = (rows) => ({ days: rows.length, ic: r3(mean(rows.map((r) => r.ic))), positiveShare: rows.length ? pct(rows.filter((r) => r.ic > 0).length, rows.length) : null, hitPct: rows.some((r) => r.hit != null) ? Math.round(mean(rows.map((r) => r.hit).filter((x) => x != null)) * 100) : null, firstHalfIc: r3(mean(rows.filter((r) => r.date < mid).map((r) => r.ic))), secondHalfIc: r3(mean(rows.filter((r) => r.date >= mid).map((r) => r.ic))) });
  const byCellOut = {};
  for (const c of CELLS) { const rows = per.filter((r) => r.cell === c); if (rows.length) byCellOut[c] = group(rows); }
  const unl = per.filter((r) => !r.cell); if (unl.length) byCellOut.unlabeled = group(unl);
  const trending = group(per.filter((r) => characterOfCell(r.cell) === "trending"));
  const chop = group(per.filter((r) => characterOfCell(r.cell) === "chop"));
  const transition = group(per.filter((r) => r.transition));
  const byEra = {};
  for (const e of ["calm", "normal", "elevated", "crisis"]) { const rows = per.filter((r) => r.era === e); if (rows.length) byEra[e] = group(rows); }
  let verdict = "insufficient";
  if (trending.days >= 20 && chop.days >= 20) {
    const gap = trending.ic - chop.ic;
    const bothHalves = trending.firstHalfIc != null && trending.secondHalfIc != null && trending.firstHalfIc > 0.03 && trending.secondHalfIc > 0.03;
    verdict = gap >= 0.03 && bothHalves ? "pass" : trending.ic <= 0 && chop.ic <= 0 ? "fail" : "inconclusive";
  }
  return { id: "F1", horizon, bar, days: per.length, split: mid, all: group(per), trending, chop, transition, byCell: byCellOut, byEra, verdict, rule: "Pass: trending-cell IC beats chop-cell IC by 0.03 and stays above 0.03 in both halves. Fail: no cell has a positive IC.", priceHalf: priceHalfOnly(days[0] || "2000-01-01") };
}

// ---------------------------------------------------------------------------
// F2. Grid labels against the hidden-Markov challenger: flips a year, days
// late and how well each separates the next 20 sessions' SPY volatility.
// ---------------------------------------------------------------------------
export function labelStability({ grid, hmm = null, cal, spyCloses }) {
  const fwdVol = (i) => (i + 21 < spyCloses.length ? realizedVol(spyCloses, 20, i + 20) : null);
  const separation = (stressedAt) => {
    const a = [], b = [];
    for (let i = 60; i < cal.length; i++) { const s = stressedAt(i); const v = fwdVol(i); if (s == null || v == null) continue; (s ? a : b).push(v); }
    const ma = mean(a), mb = mean(b);
    return { stressedDays: a.length, calmDays: b.length, stressedFwdVol: r3(ma), calmFwdVol: r3(mb), ratio: ma != null && mb > 0 ? r2(ma / mb) : null };
  };
  const gridRows = grid?.rows || [];
  const gridOut = { flipsPerYear: grid?.stats?.flipsPerYear ?? null, rawFlipsPerYear: grid?.stats?.rawFlipsPerYear ?? null, avgLagDays: grid?.stats?.avgLagDays ?? null, hindsightLateDays: grid?.hindsight?.avgLateDays ?? null, transitionShare: grid?.stats?.transitionShare ?? null, separation: separation((i) => { const e = gridRows[i]?.era; return e ? e === "elevated" || e === "crisis" : null; }) };
  let hmmOut = null, agreementPct = null;
  if (hmm && Array.isArray(hmm.rows)) {
    const hmmRows = hmm.rows;
    hmmOut = { states: hmm.states, flipsPerYear: hmm.stats?.flipsPerYear ?? null, separation: separation((i) => (hmmRows[i] && hmmRows[i].state != null ? !!hmmRows[i].stressed : null)) };
    let agree = 0, both = 0;
    for (let i = 0; i < Math.min(gridRows.length, hmmRows.length); i++) {
      const e = gridRows[i]?.era, h = hmmRows[i];
      if (!e || !h || h.state == null) continue;
      both++; if ((e === "elevated" || e === "crisis") === !!h.stressed) agree++;
    }
    agreementPct = pct(agree, both);
  }
  let preferred = "grid", why = "the grid's thresholds are readable and its flips are counted";
  if (hmmOut && hmmOut.separation.ratio != null && gridOut.separation.ratio != null && hmmOut.separation.ratio > gridOut.separation.ratio + 0.1 && hmmOut.flipsPerYear <= gridOut.flipsPerYear) { preferred = "hmm"; why = "the hidden-Markov read separates forward volatility better with no more flips"; }
  return { id: "F2", grid: gridOut, hmm: hmmOut, agreementPct, preferred, why, verdict: gridOut.separation.ratio != null ? (gridOut.separation.ratio >= 1.3 ? "pass" : "inconclusive") : "insufficient", rule: "The stressed label passes when the next 20 sessions' SPY volatility runs at least 1.3x the calm label's." };
}

// ---------------------------------------------------------------------------
// F3 + F4. Strategies side by side per window, cash per cell.
// ---------------------------------------------------------------------------
export function strategyComparison(ctx, { windowIds = null, strategyIds = null, exits = "flat-50", structure = "long", ledger = null, unlock = false, stress = false, minCellTrades = 5 } = {}) {
  const { windows, locked } = windowsFor(ctx, windowIds, ledger, unlock);
  const ids = strategyIds || STRATEGIES.map((s) => s.id);
  const out = [];
  const cellPool = {};
  for (const w of windows) {
    const cfg = { window: { from: w.from, to: w.to }, exits, structure, stress };
    const pool = controlPool(ctx, cfg);
    const row = { id: w.id, from: w.from, to: w.to, priceHalfOnly: priceHalfOnly(w.from), control: { n: pool.length, avgNet: r1(mean(pool.map((t) => t.net))) }, strategies: {} };
    for (const sid of ids) {
      ledger?.count("F3", 1);
      const res = simulate(ctx, { ...cfg, strategy: sid });
      const card = scorecard(res, { pool, seed: `${w.id}|${sid}` });
      row.strategies[sid] = { card, verdicts: verdicts(res, { pool, minCellTrades }), byCell: byCell(res.trades), halves: byHalf(res.trades, w.from, w.to), exits: Object.fromEntries(Object.entries(res.trades.reduce((m, t) => { m[t.why] = (m[t.why] || 0) + 1; return m; }, {}))) };
      if (sid === "same-rules") for (const t of res.trades) { if (t.void || !Number.isFinite(t.net)) continue; const k = t.cell || "unlabeled"; (cellPool[k] = cellPool[k] || []).push(t); }
    }
    if (ledger) { for (const w2 of WINDOWS) if (w2.id === w.id && w2.holdout) ledger.recordHoldout(w.id); }
    out.push(row);
  }
  // Summary per strategy across windows: mean avgNet, how often it beat the baseline.
  const summary = {};
  for (const sid of ids) {
    const cards = out.map((r) => r.strategies[sid]?.card).filter(Boolean);
    const base = out.map((r) => r.strategies["same-rules"]?.card);
    let beat = 0, judged = 0;
    out.forEach((r, i) => { const c = r.strategies[sid]?.card, b = base[i]; if (c && b && c.n >= 5 && b.n >= 5) { judged++; if (c.avgNet > b.avgNet) beat++; } });
    summary[sid] = { windows: cards.length, avgNet: r1(mean(cards.map((c) => c.avgNet))), avgDrawdown: r1(mean(cards.map((c) => c.maxDrawdownPts))), avgWinPct: Math.round(mean(cards.map((c) => c.winPct)) ?? 0) || null, trades: cards.reduce((a, c) => a + c.n, 0), beatBaseline: judged ? `${beat}/${judged}` : null, passes: out.filter((r) => r.strategies[sid]?.verdicts?.verdict === "pass").length, controlRankAvg: Math.round(mean(cards.map((c) => c.controlRankPct)) ?? 0) || null };
  }
  // F4: cash per cell from the baseline's trades.
  const cash = {};
  for (const c of [...CELLS, "unlabeled"]) {
    const list = cellPool[c] || [];
    if (!list.length) continue;
    const d = describe(list.map((t) => t.net));
    const calls = describe(list.filter((t) => t.side === "call").map((t) => t.net)), puts = describe(list.filter((t) => t.side === "put").map((t) => t.net));
    cash[c] = { ...d, calls, puts, cashBetter: d.n >= minCellTrades ? d.avg < 0 : null, bestSide: calls.n >= 5 && puts.n >= 5 ? (calls.avg >= puts.avg ? "call" : "put") : null };
  }
  const switchBeats = summary.switch && summary["same-rules"] ? summary.switch.avgNet > summary["same-rules"].avgNet : null;
  return { id: "F3", windows: out, locked, summary, cash: { id: "F4", byCell: cash, rule: "Cash beats a cell when the baseline's trades in that cell lose after costs over at least 5 trades." }, exits, structure, stress, verdict: out.length ? (switchBeats === null ? "insufficient" : switchBeats && summary.switch.beatBaseline && Number(summary.switch.beatBaseline.split("/")[0]) * 2 > Number(summary.switch.beatBaseline.split("/")[1]) ? "pass" : "fail") : "insufficient", rule: "The switch playbook passes when it beats same-rules on average and in more than half of the windows." };
}

// ---------------------------------------------------------------------------
// F5-F9. Exit rule sets against the flat -50 stop, by era and character.
// ---------------------------------------------------------------------------
export function exitRuleComparison(ctx, { windowIds = null, exitIds = null, strategy = "same-rules", structure = "long", ledger = null, unlock = false, stress = false } = {}) {
  const { windows, locked } = windowsFor(ctx, windowIds, ledger, unlock);
  const ids = exitIds || EXIT_RULE_SETS.filter((r) => !r.testOnly).map((r) => r.id);
  if (!ids.includes("flat-50")) ids.unshift("flat-50");
  const out = [];
  const pooled = {};
  for (const w of windows) {
    const row = { id: w.id, from: w.from, to: w.to, priceHalfOnly: priceHalfOnly(w.from), rules: {} };
    for (const ex of ids) {
      ledger?.count("F5-F9", 1);
      const res = simulate(ctx, { window: { from: w.from, to: w.to }, strategy, exits: ex, structure, stress });
      const card = scorecard(res);
      const byEra = {}, byChar = {};
      for (const t of res.trades) {
        if (t.void || !Number.isFinite(t.net)) continue;
        const e = t.era || "unlabeled", ch = characterOfCell(t.cell) || "unlabeled";
        (byEra[e] = byEra[e] || []).push(t.net); (byChar[ch] = byChar[ch] || []).push(t.net);
        (pooled[ex] = pooled[ex] || []).push(t);
      }
      row.rules[ex] = { card, byEra: Object.fromEntries(Object.entries(byEra).map(([k, v]) => [k, describe(v)])), byCharacter: Object.fromEntries(Object.entries(byChar).map(([k, v]) => [k, describe(v)])), dailyLossBlocks: res.dailyLossBlocks, exits: res.trades.reduce((m, t) => { m[t.why] = (m[t.why] || 0) + 1; return m; }, {}) };
    }
    out.push(row);
  }
  const summary = {};
  const base = (r) => r.rules["flat-50"]?.card;
  for (const ex of ids) {
    const cards = out.map((r) => r.rules[ex]?.card).filter(Boolean);
    let beatNet = 0, lessDd = 0, judged = 0;
    for (const r of out) { const c = r.rules[ex]?.card, b = base(r); if (!c || !b || c.n < 5 || b.n < 5) continue; judged++; if (c.avgNet > b.avgNet) beatNet++; if (c.maxDrawdownPts < b.maxDrawdownPts) lessDd++; }
    const all = pooled[ex] || [];
    summary[ex] = { windows: cards.length, trades: all.length, avgNet: r1(mean(all.map((t) => t.net))), winPct: pct(all.filter((t) => t.net > 0).length, all.length), avgDrawdown: r1(mean(cards.map((c) => c.maxDrawdownPts))), whipsawPct: Math.round(mean(cards.map((c) => c.whipsawPct).filter((x) => x != null)) ?? 0) || null, avgHold: r1(mean(cards.map((c) => c.avgHold))), beatBaselineNet: judged ? `${beatNet}/${judged}` : null, lessDrawdown: judged ? `${lessDd}/${judged}` : null, byEra: {}, byCharacter: {} };
    for (const e of ["calm", "normal", "elevated", "crisis"]) { const xs = all.filter((t) => t.era === e).map((t) => t.net); if (xs.length) summary[ex].byEra[e] = describe(xs); }
    for (const ch of ["trending", "chop"]) { const xs = all.filter((t) => characterOfCell(t.cell) === ch).map((t) => t.net); if (xs.length) summary[ex].byCharacter[ch] = describe(xs); }
  }
  const ranked = Object.entries(summary).filter(([, s]) => s.trades >= 20).sort((a, b) => (b[1].avgNet - a[1].avgNet) || (a[1].avgDrawdown - b[1].avgDrawdown)).map(([id]) => id);
  const baseS = summary["flat-50"];
  const better = ranked.filter((id) => id !== "flat-50" && summary[id].avgNet > (baseS?.avgNet ?? -Infinity) && summary[id].avgDrawdown <= (baseS?.avgDrawdown ?? Infinity) && summary[id].whipsawPct != null && baseS?.whipsawPct != null && summary[id].whipsawPct <= baseS.whipsawPct + 5);
  return { id: "F5-F9", windows: out, locked, summary, ranked, better, sizeFirstCompared: ids.includes("size-first") || ids.includes("size-first-ladder"), verdict: ranked.length ? (better.length ? "pass" : "fail") : "insufficient", rule: "A rule set beats the flat -50 stop only with a higher average net, no more drawdown and a whipsaw rate within 5 points (G9)." };
}

// ---------------------------------------------------------------------------
// F10. Book brakes replayed on the live record: which trades the brakes would
// have refused, and whether the refused ones were the losers.
//   closed: Track Record closed trades (symbol, side, entryDate, exitDate,
//   optionPnlPct, outcome, status); eraOf(date) -> era string.
// ---------------------------------------------------------------------------
export function brakesOnRecord(closed, { themeOf = null, eraOf = () => "normal", sectorOf = () => null, clusterDate = "2026-10-28" } = {}) {
  const theme = themeOf || ((s) => defaultThemeOf(s, sectorOf));
  const rows = (closed || []).filter((t) => t && t.symbol && dateKey(t.entryDate) && num(t.optionPnlPct) != null && (t.outcome === "win" || t.outcome === "loss"))
    .map((t) => ({ sym: t.symbol, side: t.side, entry: String(t.entryDate), entryDate: dateKey(t.entryDate), exit: String(t.exitDate || ""), exitDate: dateKey(t.exitDate) || "9999-12-31", pnl: num(t.optionPnlPct), stop: /stop/.test(String(t.status || "")) || num(t.optionPnlPct) <= -40, theme: theme(t.symbol), era: eraOf(dateKey(t.entryDate)) || "normal" }))
    .sort((a, b) => a.entry.localeCompare(b.entry));
  const kept = [], refused = [];
  for (const t of rows) {
    const brakes = bookBrakes(t.era);
    const open = kept.filter((k) => k.exit > t.entry);
    const stopsToday = kept.filter((k) => k.stop && k.exitDate === t.entryDate && k.exit <= t.entry).length;
    let why = null;
    if (open.length >= brakes.maxOpen) why = "max-open";
    else if (t.theme && open.filter((k) => k.theme === t.theme).length >= brakes.themeCap) why = "theme-cap";
    else if (stopsToday >= brakes.dailyLossLimitTrades) why = "daily-loss";
    if (why) refused.push({ ...t, why }); else kept.push(t);
  }
  const d = (list) => ({ ...describe(list.map((t) => t.pnl)), totalPts: r1(list.reduce((a, t) => a + t.pnl, 0)) });
  const cluster = rows.filter((t) => t.entryDate === clusterDate);
  const byWhy = {};
  for (const t of refused) (byWhy[t.why] = byWhy[t.why] || []).push(t.pnl);
  const all = d(rows), keptD = d(kept), refD = d(refused);
  return {
    id: "F10", n: rows.length, all, kept: keptD, refused: { ...refD, byWhy: Object.fromEntries(Object.entries(byWhy).map(([k, v]) => [k, describe(v)])) },
    cluster: { date: clusterDate, n: cluster.length, byTheme: Object.entries(cluster.reduce((m, t) => { (m[t.theme || "other"] = m[t.theme || "other"] || []).push(t.pnl); return m; }, {})).map(([k, v]) => ({ theme: k, ...describe(v) })), refused: refused.filter((t) => t.entryDate === clusterDate).length, avgPnl: r1(mean(cluster.map((t) => t.pnl))) },
    helped: refused.length >= 5 ? refD.avg < keptD.avg : null,
    verdict: rows.length < 30 ? "insufficient" : refused.length < 5 ? "inconclusive" : refD.avg < keptD.avg && keptD.avg > all.avg ? "pass" : "fail",
    rule: "The brakes pass when the trades they refuse averaged less than the ones they keep, over at least 30 decided trades and 5 refusals.",
  };
}

// ---------------------------------------------------------------------------
// F11-F13. The oracle: three-way replay, structures, risk and noise, plus
// the stress rerun of the structures.
// ---------------------------------------------------------------------------
export function oracleSuite({ book, barsOf, ivRatioOf = () => undefined }) {
  const replay = replayBook(book, barsOf);
  const structures = structuresUnderOracle(replay, barsOf, { ivRatioOf });
  const stress = structuresUnderOracle(replay, barsOf, { ivRatioOf, stress: true });
  const types = {};
  for (const [t, r] of Object.entries(replay.byType)) {
    const s = structures.byType[t], st = stress.byType[t];
    types[t] = {
      n: r.n, signed: r.signed, hit: r.hit, avgSigned: r.avgSigned, bestExit: r.bestExit, alreadyPricedPct: r.alreadyPricedPct, avgAbsMove: r.avgAbsMove, bySign: r.bySign,
      best: s?.best || null, structures: s?.structures || null, byIv: s?.byIv || null, risk: s?.risk || null, noisy: s?.noisy || null,
      stress: st ? { best: st.best, structures: st.structures } : null,
    };
  }
  return { id: "F11-F13", neverRecord: true, rows: replay.rows.length, types, total: replay.total, caveat: book.caveat, structuresRows: structures.rows, replayRows: replay.rows };
}

// ---------------------------------------------------------------------------
// F15. Walk-forward over a small grid; only the stitched out-of-sample path.
// ---------------------------------------------------------------------------
export const DEFAULT_WALK_GRID = Object.freeze([4, 5, 6].flatMap((bar) => [-50, -40].flatMap((stopPct) => [8, 5].map((maxOpen) => ({ bar, stopPct, maxOpen })))));

export function walkForwardTest(ctx, { from, to, grid = DEFAULT_WALK_GRID, baseCfg = {}, fitMonths = 6, testMonths = 2, ledger = null } = {}) {
  const wf = walkForward(ctx, { strategy: "same-rules", exits: "flat-50", ...baseCfg }, { grid, from, to, fitMonths, testMonths });
  ledger?.count("F15", wf.trials);
  const base = simulate(ctx, { strategy: "same-rules", exits: "flat-50", ...baseCfg, window: { from, to } });
  const baseCard = scorecard(base);
  const chosen = wf.steps.filter((s) => s.chosen).map((s) => JSON.stringify(s.chosen));
  const stable = chosen.length ? Math.max(...Object.values(chosen.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {}))) / chosen.length : null;
  return { id: "F15", from, to, steps: wf.steps.map((s) => ({ fit: s.fit, test: s.test, chosen: s.chosen, inSampleAvgNet: s.inSample?.avgNet ?? null, outSampleAvgNet: s.outSample?.avgNet ?? null, outSampleN: s.outSample?.n ?? null })), oos: wf.oosScorecard, fixed: baseCard, trials: wf.trials, parameterStability: r2(stable), priceHalfOnly: priceHalfOnly(from), verdict: wf.oosScorecard.n < 20 ? "insufficient" : wf.oosScorecard.avgNet > baseCard.avgNet && wf.oosScorecard.avgNet > 0 ? "pass" : "fail", rule: "Re-fitting passes only when the stitched out-of-sample path beats the fixed rules and makes money after costs." };
}

// ---------------------------------------------------------------------------
// F16. Which past periods look like now, and what worked in them.
// ---------------------------------------------------------------------------
function labelVector(row) {
  const d = row?.detail;
  if (!d || !row.cell) return null;
  const eraIdx = { calm: 0, normal: 1, elevated: 2, crisis: 3 }[d.era] ?? 1;
  const ch = d.character;
  return [eraIdx / 3, ch === "up" ? 1 : 0, ch === "down" ? 1 : 0, num(d.quality?.quality) ?? 0.5, Math.min(1, (num(d.inputs?.vix) ?? 18) / 40), num(d.corr?.avgCorr) ?? 0.4, (num(d.inputs?.breadth50) ?? 50) / 100];
}

export function resemblesNow({ labels, ctx = null, today = null, trades = null, k = 5, horizon = 20, minGap = 40 } = {}) {
  const rows = labels?.rows || [];
  let ti = rows.length - 1;
  if (today) { const j = rows.findIndex((r) => r.date === today); if (j >= 0) ti = j; }
  const target = rows[ti];
  const tv = labelVector(target);
  if (!tv) return { id: "F16", today: target?.date || null, neighbors: [], verdict: "insufficient" };
  const spy = ctx?.syms?.SPY || null;
  const spyFwd = (date) => { if (!spy) return null; const i = spy.idx.get(date); return i != null && i + horizon < spy.c.length ? r2((spy.c[i + horizon] / spy.c[i] - 1) * 100) : null; };
  const cands = [];
  for (let i = 60; i < ti - horizon; i++) {
    const v = labelVector(rows[i]);
    if (!v) continue;
    let d = 0; for (let j = 0; j < v.length; j++) d += (v[j] - tv[j]) ** 2;
    cands.push({ i, dist: Math.sqrt(d) });
  }
  cands.sort((a, b) => a.dist - b.dist);
  const picked = [];
  for (const c of cands) { if (picked.every((p) => Math.abs(p.i - c.i) >= minGap)) picked.push(c); if (picked.length >= k) break; }
  const neighbors = picked.map((p) => {
    const r = rows[p.i];
    const end = rows[Math.min(rows.length - 1, p.i + horizon)]?.date;
    const inWin = (trades || []).filter((t) => !t.void && Number.isFinite(t.net) && t.entry >= r.date && t.entry <= end);
    return { date: r.date, through: end, cell: r.cell, era: r.detail?.era, vix: r.detail?.inputs?.vix ?? null, distance: r3(p.dist), spyFwdPct: spyFwd(r.date), calls: describe(inWin.filter((t) => t.side === "call").map((t) => t.net)), puts: describe(inWin.filter((t) => t.side === "put").map((t) => t.net)) };
  });
  const calls = describe(neighbors.flatMap((n) => Array(n.calls.n).fill(n.calls.avg))), puts = describe(neighbors.flatMap((n) => Array(n.puts.n).fill(n.puts.avg)));
  return { id: "F16", today: { date: target.date, cell: target.cell, era: target.detail?.era, character: target.detail?.character, vix: target.detail?.inputs?.vix ?? null, quality: target.detail?.quality?.quality ?? null }, horizon, neighbors, summary: { avgSpyFwdPct: r2(mean(neighbors.map((n) => n.spyFwdPct))), upShare: pct(neighbors.filter((n) => n.spyFwdPct > 0).length, neighbors.filter((n) => n.spyFwdPct != null).length), callsAvgNet: calls.avg, putsAvgNet: puts.avg, bestSide: calls.n >= 5 && puts.n >= 5 ? (calls.avg >= puts.avg ? "call" : "put") : null }, verdict: neighbors.length >= 3 ? "ok" : "insufficient", note: "Nearest past sessions by era, direction, trend quality, VIX, correlation and breadth. A resemblance, not a forecast." };
}

// ---------------------------------------------------------------------------
// F17. Stock-level labels: ride trending names, fade choppy ones.
// ---------------------------------------------------------------------------
export const stockLevelStrategy = Object.freeze({
  id: "stock-label",
  decide({ side, spot, s20, r20, bars }) {
    const lab = stockLabel(bars || []);
    if (!lab.label) return { take: false, reason: "no-label" };
    const dir = side === "call" ? "up" : "down";
    if (lab.label === "trending") {
      if (lab.direction !== dir) return { take: false, reason: "against-stock-trend" };
      return { take: true, playbook: "stock-ride", size: 1, stopPct: -50, tpPct: 25, trailPts: 25 };
    }
    const band = 0.02;
    if (side === "call" && !(num(s20) != null && spot <= s20 * (1 + band))) return { take: false, reason: "not-at-support" };
    if (side === "put" && !(num(r20) != null && spot >= r20 * (1 - band))) return { take: false, reason: "not-at-resistance" };
    return { take: true, playbook: "stock-fade", size: 0.75, stopPct: -40, tpPct: 20 };
  },
});

export function stockLabelTest(ctx, { windowIds = null, ledger = null, unlock = false, exits = "flat-50", structure = "long" } = {}) {
  const { windows, locked } = windowsFor(ctx, windowIds, ledger, unlock);
  const out = [];
  for (const w of windows) {
    ledger?.count("F17", 2);
    const cfg = { window: { from: w.from, to: w.to }, exits, structure };
    const pool = controlPool(ctx, cfg);
    const a = simulate(ctx, { ...cfg, strategy: "same-rules" }), b = simulate(ctx, { ...cfg, strategy: stockLevelStrategy });
    const byPlaybook = {};
    for (const t of b.trades) { if (t.void || !Number.isFinite(t.net)) continue; (byPlaybook[t.playbook] = byPlaybook[t.playbook] || []).push(t.net); }
    out.push({ id: w.id, from: w.from, to: w.to, priceHalfOnly: priceHalfOnly(w.from), baseline: scorecard(a, { pool, seed: `${w.id}|base` }), stockLabel: scorecard(b, { pool, seed: `${w.id}|stock` }), byPlaybook: Object.fromEntries(Object.entries(byPlaybook).map(([k, v]) => [k, describe(v)])), verdicts: verdicts(b, { pool }) });
  }
  const judged = out.filter((r) => r.baseline.n >= 5 && r.stockLabel.n >= 5);
  const beat = judged.filter((r) => r.stockLabel.avgNet > r.baseline.avgNet).length;
  return { id: "F17", windows: out, locked, beatBaseline: judged.length ? `${beat}/${judged.length}` : null, avgNet: r1(mean(out.map((r) => r.stockLabel.avgNet))), baselineAvgNet: r1(mean(out.map((r) => r.baseline.avgNet))), verdict: judged.length < 3 ? "insufficient" : beat * 2 > judged.length && mean(out.map((r) => r.stockLabel.avgNet)) > mean(out.map((r) => r.baseline.avgNet)) ? "pass" : "fail", rule: "Pass: the stock-label playbook beats same-rules in more than half the windows and on average." };
}

// ---------------------------------------------------------------------------
// F18. Correlation eras: the grade's rank skill and the baseline's trades
// when names move together versus apart.
// ---------------------------------------------------------------------------
export function correlationEraTest(ctx, { horizon = 10, trades = null, from = null, to = null } = {}) {
  const ic = icByLabel(ctx, { horizon, from, to });
  const perDay = [];
  for (const d of ctx.gradeDays.filter((x) => (!from || x >= from) && (!to || x <= to))) {
    const lab = ctx.lab ? ctx.lab.priorClose(d) : null;
    const regime = lab?.detail?.corr?.regime || null;
    if (!regime) continue;
    const xs = [], ys = [];
    for (const [sym, tot] of Object.entries(ctx.grades[d])) { const t = num(tot), f = forwardReturn(ctx, sym, d, horizon); if (t == null || f == null) continue; xs.push(t); ys.push(f); }
    const r = spearman(xs, ys);
    if (r != null) perDay.push({ regime, ic: r });
  }
  const byRegime = {};
  for (const reg of ["macro", "mixed", "stock-picking"]) {
    const rows = perDay.filter((r) => r.regime === reg);
    const tr = (trades || []).filter((t) => !t.void && Number.isFinite(t.net) && (ctx.lab?.priorClose(t.entry)?.detail?.corr?.regime || null) === reg);
    byRegime[reg] = { days: rows.length, ic: r3(mean(rows.map((r) => r.ic))), positiveShare: rows.length ? pct(rows.filter((r) => r.ic > 0).length, rows.length) : null, trades: describe(tr.map((t) => t.net)), calls: describe(tr.filter((t) => t.side === "call").map((t) => t.net)), puts: describe(tr.filter((t) => t.side === "put").map((t) => t.net)) };
  }
  const m = byRegime.macro, s = byRegime["stock-picking"];
  return { id: "F18", horizon, byRegime, verdict: m.days >= 20 && s.days >= 20 ? (s.ic - m.ic >= 0.03 ? "pass" : m.ic - s.ic >= 0.03 ? "fail" : "inconclusive") : "insufficient", rule: "Pass: the grade ranks names better when average correlation is under 0.4 (stock picking) than above 0.6 (macro) by 0.03 of IC.", all: ic.all, priceHalf: ic.priceHalf };
}

// ---------------------------------------------------------------------------
// F19. Event-heavy weeks: the baseline's trades entered into a heavy five
// sessions against the rest, and what half size there would have done.
// ---------------------------------------------------------------------------
export function eventLoadTest(ctx, trades) {
  const groups = { heavy: [], normal: [], light: [], unknown: [] };
  for (const t of trades || []) {
    if (t.void || !Number.isFinite(t.net)) continue;
    const lvl = ctx.lab?.priorClose(t.entry)?.detail?.eventLoad?.level || "unknown";
    (groups[lvl] || groups.unknown).push(t);
  }
  const out = {};
  for (const [k, v] of Object.entries(groups)) if (v.length) out[k] = { ...describe(v.map((t) => t.net)), whipsawExits: v.filter((t) => t.why === "stop").length };
  const heavy = out.heavy, rest = describe([...groups.normal, ...groups.light].map((t) => t.net));
  const total = (list, mult) => r1(list.reduce((a, t) => a + t.net * mult, 0));
  const fullPts = total(groups.heavy, 1) + total([...groups.normal, ...groups.light], 1), halfPts = total(groups.heavy, 0.5) + total([...groups.normal, ...groups.light], 1);
  return { id: "F19", groups: out, rest, halfSize: { fullPts: r1(fullPts), halfPts: r1(halfPts), helps: heavy && heavy.n >= 10 ? halfPts > fullPts : null }, verdict: !heavy || heavy.n < 10 || rest.n < 10 ? "insufficient" : heavy.avg < rest.avg - 3 ? "pass" : heavy.avg > rest.avg + 3 ? "fail" : "inconclusive", rule: "Pass (half size in heavy weeks): trades entered into a heavy week average at least 3 points less than the rest, over 10+ trades each." };
}

// ---------------------------------------------------------------------------
// F20. The AI grader by cell: buy-now against wait on names at or above the
// trade bar, signed by side, with the 10-day outcome. Rows are the Owner's
// picks-outcomes rows (keys d, et, s, side, tot, spot, out, ev, mk, r1..r20).
// ---------------------------------------------------------------------------
export function graderByCell(outcomes, labels, { tradeBar = 4, need = 40 } = {}) {
  const keys = outcomes?.keys || ["d", "et", "s", "side", "tot", "spot", "out", "ev", "mk", "r1", "r5", "r10", "r20"];
  const I = Object.fromEntries(keys.map((k, i) => [k, i]));
  const byDate = new Map((labels?.rows || []).map((r, i) => [r.date, i]));
  const cellOn = (d) => { const i = byDate.get(d); const row = i != null && i > 0 ? labels.rows[i - 1] : null; return row?.cell || null; };
  const groups = {};
  for (const r of outcomes?.rows || []) {
    const tot = num(r[I.tot]), r10 = num(r[I.r10]), ev = r[I.ev];
    if (tot == null || r10 == null || Math.abs(tot) < tradeBar) continue;
    const cell = cellOn(r[I.d]) || "unlabeled";
    const signed = (r[I.side] === "put" ? -1 : 1) * r10;
    const g = (groups[cell] = groups[cell] || { "buy-now": [], wait: [], none: [] });
    (ev === "buy-now" ? g["buy-now"] : ev === "wait" ? g.wait : g.none).push(signed);
  }
  const byCellOut = {};
  let graded = 0;
  for (const [cell, g] of Object.entries(groups)) {
    const b = describe(g["buy-now"]), w = describe(g.wait), n = describe(g.none);
    graded += b.n + w.n;
    byCellOut[cell] = { buyNow: b, wait: w, none: n, graderAdds: b.n >= 10 && w.n >= 10 ? r1(b.avg - w.avg) : null, judged: b.n + w.n >= need };
  }
  const judged = Object.values(byCellOut).filter((c) => c.judged);
  return { id: "F20", tradeBar, graded, byCell: byCellOut, verdict: judged.length ? (judged.every((c) => c.graderAdds > 0) ? "pass" : judged.every((c) => c.graderAdds <= 0) ? "fail" : "inconclusive") : "insufficient", rule: `Per cell with ${need}+ graded names: buy-now names must do better over 10 sessions than wait names, signed by side.`, need };
}

// ---------------------------------------------------------------------------
// F21. Per-input skill by cell. Rows come from hydrated run archives:
// { date, sym, side, total, pillars: { f, t, m, n }, fwd } where fwd is the
// stock's move over the horizon in percent.
// ---------------------------------------------------------------------------
export function inputSkillByCell(rows, labels, { minNames = 8, pillars = ["f", "t", "m", "n"] } = {}) {
  const byDate = new Map((labels?.rows || []).map((r, i) => [r.date, i]));
  const cellOn = (d) => { const i = byDate.get(d); const row = i != null && i > 0 ? labels.rows[i - 1] : null; return row?.cell || null; };
  const perDate = new Map();
  for (const r of rows || []) { if (!r?.date || num(r.fwd) == null) continue; if (!perDate.has(r.date)) perDate.set(r.date, []); perDate.get(r.date).push(r); }
  const ics = {};
  for (const [date, list] of perDate) {
    if (list.length < minNames) continue;
    const cell = cellOn(date) || "unlabeled";
    for (const p of [...pillars, "total"]) {
      const xs = [], ys = [];
      for (const r of list) { const v = p === "total" ? num(r.total) : num(r.pillars?.[p]); if (v == null) continue; xs.push(v); ys.push(num(r.fwd)); }
      const ic = spearman(xs, ys);
      if (ic == null) continue;
      ((ics[cell] = ics[cell] || {})[p] = ics[cell][p] || []).push(ic);
    }
  }
  const out = {};
  for (const [cell, m] of Object.entries(ics)) {
    out[cell] = {};
    for (const [p, list] of Object.entries(m)) out[cell][p] = { days: list.length, ic: r3(mean(list)), positiveShare: pct(list.filter((x) => x > 0).length, list.length) };
  }
  const names = { f: "Fundamentals", t: "Technicals", m: "Mechanicals", n: "Narrative", total: "Grade" };
  return { id: "F21", byCell: out, names, days: perDate.size, verdict: Object.keys(out).length ? "ok" : "insufficient", note: "Rank correlation per decision day between each pillar's score and the stock's move over the horizon, averaged within the cell in force." };
}

// ---------------------------------------------------------------------------
// F22. Stress rerun of the surviving setups: double costs, 20% IV crush
// after events (G6).
// ---------------------------------------------------------------------------
export function stressRerun(ctx, setups, { ledger = null } = {}) {
  const rows = [];
  for (const s of setups || []) {
    ledger?.count("F22", 2);
    const base = scorecard(simulate(ctx, { ...s, stress: false })), stress = scorecard(simulate(ctx, { ...s, stress: true }));
    rows.push({ window: s.window, strategy: typeof s.strategy === "string" ? s.strategy : s.strategy?.id || "custom", exits: s.exits || "flat-50", base: { n: base.n, avgNet: base.avgNet, winPct: base.winPct }, stress: { n: stress.n, avgNet: stress.avgNet, winPct: stress.winPct }, survived: stress.n >= 5 && stress.avgNet > 0 });
  }
  return { id: "F22", rerun: rows.length, survived: rows.filter((r) => r.survived).length, rows, verdict: rows.length ? (rows.some((r) => r.survived) ? "pass" : "fail") : "insufficient", rule: "A setup survives when it still makes money after double costs and a 20% IV crush after events." };
}

export const TEST_FUNCTIONS = Object.freeze({ icByLabel, labelStability, strategyComparison, exitRuleComparison, brakesOnRecord, oracleSuite, walkForwardTest, resemblesNow, stockLabelTest, correlationEraTest, eventLoadTest, graderByCell, inputSkillByCell, stressRerun });
export { HARNESS_DEFAULTS };

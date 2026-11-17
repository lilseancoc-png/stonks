// Quant labs (Owner-only, no AI): the bake's entry point for the five labs in
// this folder. One Owner page file and one internal state file:
//   quant-labs.json        what the Owner "Quant labs" page, the Bottom
//                          tracker / Risk analysis cards and the MCP read
//   quant-labs-state.json  the fitted market-odds models, the log of chances
//                          stated at past builds, the weekly factor panel,
//                          factor values frozen at each trade's entry, the
//                          settled prediction-market log and the annual
//                          report text store (read before the wipe)
// Measurement only: nothing here is read by a grade, a gate, a pick or the
// Track Record. Kill switch QUANT_LABS=0 (the prior files are carried).

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { finite, round, mean } from "./stats.mjs";
import { buildDrawdownOdds, gradeDrawdownLog, DRAWDOWN_ODDS_VERSION } from "./drawdown-odds.mjs";
import { buildCalibrationLab, loopSources, recordSources, engineSources, predictionSource, foldPredictionLog, earningsMoveSource, drawdownSources } from "./calibration.mjs";
import { buildRegistry } from "./registry.mjs";
import { ALL_FACTORS, PRICE_FACTORS, priceFactor, fundFactor, percentiles, panelSnapshot, foldPanel, panelSkill, bakeFactorReturns, exposures, gradeBook, directionBook, gradeVsFactors } from "./factors.mjs";
import { buildVolLab } from "./vol.mjs";
import { buildFilingLab } from "./filing-text.mjs";

export const QUANT_LABS_KEY = "quant-labs.json";
export const QUANT_LABS_STATE_KEY = "quant-labs-state.json";
export const QUANT_LABS_VERSION = 1;
export const quantLabsEnabled = (env = process.env) => env.QUANT_LABS !== "0";
export const quantLabsTextEnabled = (env = process.env) => env.QUANT_LABS !== "0" && env.QUANT_LABS_TEXT !== "0";

const emptyState = () => ({ v: QUANT_LABS_VERSION, dd: null, ddLog: [], predLog: [], panel: [], entryFactors: {}, text: {} });

// Read both files before the bake wipes data/. A missing file is a fresh start.
export async function loadQuantLabs(dataDir) {
  const out = { state: emptyState(), stateRaw: null, payloadRaw: null, prior: null, error: null };
  try {
    out.stateRaw = await readFile(resolve(dataDir, QUANT_LABS_STATE_KEY), "utf8");
    const s = JSON.parse(out.stateRaw);
    if (s && s.v === QUANT_LABS_VERSION) out.state = { ...emptyState(), ...s };
  } catch (err) { if (err?.code !== "ENOENT") out.error = String(err?.message || err); }
  try { out.payloadRaw = await readFile(resolve(dataDir, QUANT_LABS_KEY), "utf8"); out.prior = JSON.parse(out.payloadRaw); } catch { /* first run */ }
  return out;
}
// Put the prior files back untouched (kill switch, or a failed run).
export async function carryQuantLabs(dataDir, loaded) {
  let n = 0;
  if (loaded?.stateRaw) { await writeFile(resolve(dataDir, QUANT_LABS_STATE_KEY), loaded.stateRaw, "utf8"); n++; }
  if (loaded?.payloadRaw) { await writeFile(resolve(dataDir, QUANT_LABS_KEY), loaded.payloadRaw, "utf8"); n++; }
  return n;
}
export async function writeQuantLabs(dataDir, payload, state) {
  const a = JSON.stringify(payload), b = JSON.stringify(state);
  await writeFile(resolve(dataDir, QUANT_LABS_KEY), a, "utf8");
  await writeFile(resolve(dataDir, QUANT_LABS_STATE_KEY), b, "utf8");
  return { bytes: a.length, stateBytes: b.length };
}
// The history tests committed by `node scripts/quant-labs.mjs run`.
export async function loadQuantLabsResearch(root) {
  try { return JSON.parse(await readFile(resolve(root, "research/quant-labs/results/latest.json"), "utf8")); } catch { return null; }
}

const day = (v) => String(v || "").slice(0, 10);
const decidedPnl = (closed, key = "optionPnlPct") => (closed || []).filter((c) => c && (c.outcome === "win" || c.outcome === "loss" || c.outcome === "flat") && c.counted !== false).map((c) => Number(c[key])).filter(finite);

// One lab at a time; a lab that throws keeps its prior block, marked stale.
function guarded(name, prior, lines, fn) {
  try { return fn(); } catch (err) {
    lines.push(`[quant-labs] ${name} skipped: ${String(err?.message || err).split("\n")[0]}`);
    return prior ? { ...prior, stale: true } : { status: "failed", note: "This lab could not run on the last build." };
  }
}

// ctx: see scripts/build.mjs (quantLabsContext). Pure: no file, no network.
export function runQuantLabs(ctx) {
  const lines = [];
  const state = { ...emptyState(), ...(ctx.state || {}) };
  const prior = ctx.prior || {};
  const research = ctx.research || null;
  const today = ctx.today;

  // --- market odds -----------------------------------------------------------
  let ddFull = null;
  const drawdown = guarded("market odds", prior.drawdown, lines, () => {
    const spx = ctx.spx || [];
    const lastBar = spx.length ? day(spx[spx.length - 1].t) : null;
    const key = `${lastBar}|${DRAWDOWN_ODDS_VERSION}`;
    if (state.dd?.key === key && state.dd.result?.status === "ok") ddFull = state.dd.result;
    else {
      const t0 = Date.now();
      ddFull = buildDrawdownOdds({ bars: spx, fred: ctx.fred });
      if (ddFull.status === "ok") { state.dd = { key, result: ddFull }; lines.push(`[quant-labs] market odds refitted through ${ddFull.asOf} in ${Date.now() - t0} ms`); }
    }
    if (ddFull.status !== "ok") return ddFull;
    // One stated row per close; later builds the same day overwrite it.
    const stated = {};
    for (const t of ddFull.targets) if (finite(t.today)) stated[t.id] = t.today;
    state.ddLog = [...(state.ddLog || []).filter((r) => r.d !== ddFull.asOf), { d: ddFull.asOf, c: stated }].sort((a, b) => a.d.localeCompare(b.d)).slice(-800);
    const { models, ...page } = ddFull;
    const mo = research?.marketOdds;
    return {
      ...page, log: state.ddLog.slice(-120).map((r) => ({ d: r.d, ...r.c })),
      // The history run's side checks: other ridge strengths, the breadth add-on.
      study: mo ? { ridge: mo.ridge || [], breadth: mo.breadth || null, through: mo.through || null } : null,
    };
  });
  let ddLive = [];
  try { if (ddFull?.status === "ok" && (state.ddLog || []).length > 1) ddLive = gradeDrawdownLog(state.ddLog, { bars: ctx.spx, fred: ctx.fred }); } catch { ddLive = []; }

  // --- volatility ------------------------------------------------------------------
  const vol = guarded("volatility", prior.vol, lines, () => buildVolLab({
    symbols: ctx.optionSymbols || ctx.symbols, barsOf: ctx.barsOf, ivOf: ctx.ivOf, closed: ctx.record?.closed || [], research: research?.vol || null,
  }));

  // --- factors -----------------------------------------------------------------------
  const factors = guarded("factors", prior.factors, lines, () => {
    const spy = ctx.barsOf("SPY") || [];
    if (spy.length < 150) return { status: "no-data", note: "Not enough SPY history yet." };
    const cal = spy.map((b) => day(b.t)), pos = new Map(cal.map((d, i) => [d, i]));
    const mkt = spy.map((b) => Number(b.c));
    const syms = (ctx.symbols || []).filter((s) => (ctx.barsOf(s) || []).length >= 150);
    const aligned = {}, rets = {}, stocks = {};
    for (const s of syms) {
      const bars = ctx.barsOf(s);
      const c = new Array(cal.length).fill(null), m = new Map();
      for (let i = 0; i < bars.length; i++) {
        const k = pos.get(day(bars[i].t));
        if (k != null && Number(bars[i].c) > 0) c[k] = Number(bars[i].c);
        if (i && Number(bars[i - 1].c) > 0 && Number(bars[i].c) > 0) m.set(day(bars[i].t), Number(bars[i].c) / Number(bars[i - 1].c) - 1);
      }
      for (let i = 1; i < c.length; i++) if (c[i] == null && c[i - 1] != null) c[i] = c[i - 1];
      aligned[s] = c; rets[s] = m; stocks[s] = bars;
    }
    const last = cal.length - 1;
    const valueAt = (i) => (s, key) => (PRICE_FACTORS.some((f) => f.key === key) ? priceFactor(key, aligned[s], i, mkt) : i === last ? fundFactor(key, ctx.fundamentalsOf(s)) : null);
    // The weekly panel: today's snapshot, plus a one-time backfill of the
    // price factors for past weeks so their rank skill reads from day one.
    const snap = panelSnapshot(cal[last], syms, valueAt(last));
    let panel = Array.isArray(state.panel) ? state.panel : [];
    if (!panel.length) for (let i = 150; i < last; i += 5) panel = foldPanel(panel, panelSnapshot(cal[i], syms, valueAt(i)));
    panel = foldPanel(panel, snap);
    state.panel = panel;
    const closeAt = (s, d, plus) => { const i = pos.get(d); return i == null || i + plus > last ? null : aligned[s]?.[i + plus] ?? null; };
    const gradeDays = new Map((ctx.gradesDaily?.days || []).map((g) => [g.date, g.totals || {}]));
    const skill = panelSkill(panel, closeAt, { extra: { grade: (d, s) => { const v = Number(gradeDays.get(d)?.[s]); return Number.isFinite(v) ? v : null; } } });
    // Exposures of the grade book, the Top Picks direction book and each engine.
    const fr = bakeFactorReturns({ stocks, spy, qqq: ctx.barsOf("QQQ"), iwm: ctx.barsOf("IWM") });
    const retsOf = (s) => rets[s] || null;
    const books = [{ id: "grade", label: "Grade book", rows: gradeBook(ctx.gradesDaily?.days || [], retsOf) }];
    const rec = [...(ctx.record?.open || []), ...(ctx.record?.closed || [])];
    books.push({ id: "top-picks", label: "Top Picks (direction of the stocks picked)", rows: directionBook(rec, retsOf, cal) });
    const eng = [...(ctx.engines?.open || []), ...(ctx.engines?.closed || [])];
    for (const id of [...new Set(eng.map((t) => t.engine).filter(Boolean))]) {
      books.push({ id: `engine-${id}`, label: `${ctx.engines?.names?.[id] || id} engine (direction)`, rows: directionBook(eng.filter((t) => t.engine === id), retsOf, cal) });
    }
    const exposureRows = books.map((b) => ({ id: b.id, label: b.label, ...exposures(b.rows, fr) }));
    // Today's panel and the grade with the factor part taken out.
    const names = syms.map((s, k) => ({ s, grade: Number.isFinite(Number(ctx.grades?.[s]?.total)) ? Number(ctx.grades[s].total) : null, f: Object.fromEntries(ALL_FACTORS.map((f) => [f.key, snap.f[f.key][k]])) }));
    const gradeVs = gradeVsFactors(names);
    // Factor values frozen the first time a trade is seen.
    const byName = new Map(names.map((r) => [r.s, r]));
    const frozen = { ...(state.entryFactors || {}) };
    const trades = [];
    for (const t of ctx.record?.open || []) {
      const id = t.tradeId || `${t.symbol}|${t.side}|${day(t.entryDate)}`;
      const row = byName.get(t.symbol);
      if (!row) continue;
      // `exact` says the values were logged on the entry day itself; a trade
      // already open when the labs first ran is logged from that later day.
      if (!frozen[id]) frozen[id] = { d: today, s: t.symbol, side: t.side, f: row.f, exact: day(t.entryDate) === today };
      trades.push({ id, s: t.symbol, side: t.side, f: row.f, logged: frozen[id].f, loggedOn: frozen[id].d, atEntry: !!frozen[id].exact });
    }
    state.entryFactors = Object.fromEntries(Object.entries(frozen).sort((a, b) => String(a[1].d).localeCompare(String(b[1].d))).slice(-600));
    return {
      status: "ok", asOf: cal[last], names, skill, snapshots: panel.length, exposures: exposureRows, gradeVs, trades,
      list: ALL_FACTORS.map((f) => ({ key: f.key, label: f.label, short: f.short, hint: f.hint, price: PRICE_FACTORS.some((p) => p.key === f.key) })),
      history: research?.factors || null,
      // The wide test on the 500 largest US companies (aggregates only).
      universe: research?.factorUniverse || null,
    };
  });

  // --- annual report text ---------------------------------------------------------------
  const filings = guarded("annual report text", prior.filings, lines, () => buildFilingLab(state.text || {}, { symbols: ctx.symbols || [], waiting: ctx.textWaiting ?? null }));

  // --- calibration --------------------------------------------------------------------------
  state.predLog = foldPredictionLog(state.predLog, ctx.predictionResolved || []);
  const calibration = guarded("calibration", prior.calibration, lines, () => buildCalibrationLab([
    ...drawdownSources(ddFull, ddLive),
    ...loopSources(ctx.loopRows || []),
    ...recordSources(ctx.record?.closed || []),
    ...engineSources(ctx.engines?.closed || [], ctx.engines?.names || {}),
    predictionSource(state.predLog),
    earningsMoveSource(ctx.earningsStore || {}),
    ...(ctx.extraSources || []),
  ]));

  // --- registry --------------------------------------------------------------------------------
  const registry = guarded("registry", prior.registry, lines, () => {
    const closed = ctx.record?.closed || [];
    const books = [
      { id: "top-picks", label: "Top Picks record (modeled prices)", family: "top-picks", returns: decidedPnl(closed) },
      { id: "top-picks-fills", label: "Top Picks record (real-fill prices)", family: "top-picks", returns: decidedPnl(closed, "realFillPnlPct") },
      { id: "spy-baseline", label: "Same side on SPY (no-skill baseline)", family: "baseline", trials: 1, returns: decidedPnl(ctx.record?.baseline?.closed || [], "optionPnlPct") },
    ];
    const eng = ctx.engines?.closed || [];
    for (const id of [...new Set(eng.map((t) => t.engine).filter(Boolean))]) {
      books.push({ id: `engine-${id}`, label: `${ctx.engines?.names?.[id] || id} engine`, family: "engines", returns: eng.filter((t) => t.engine === id && !t.noMirror).map((t) => Number(t.optionPnlPct)).filter(finite) });
    }
    for (const b of ctx.extraBooks || []) books.push(b);
    return buildRegistry(books.filter((b) => b.returns), { research: research?.registry || [] });
  });

  // --- the card the Bottom tracker and Risk analysis show ----------------------------------------
  const pick = (id) => { const t = (drawdown?.targets || []).find((x) => x.id === id); return t && finite(t.today) ? { id, label: t.label, p: t.today, base: t.base, range: t.range, status: t.status, skill: t.skill } : null; };
  const card = drawdown?.status === "ok" ? {
    asOf: drawdown.asOf, from: drawdown.sampleFrom || null, offHigh: drawdown.offHigh, inDecline: drawdown.inDecline, stale: !!drawdown.stale,
    fall: ["fall10_3m", "fall10_6m", "fall10_12m", "fall20_12m"].map(pick).filter(Boolean),
    recovery: ["lowIn_6m", "newHigh_12m"].map(pick).filter(Boolean),
  } : null;

  const payload = {
    v: QUANT_LABS_VERSION, builtAt: ctx.builtAtIso, today,
    card, drawdown, calibration, registry, factors, vol, filings,
    research: research ? { ran: research.ran || null, note: research.note || null } : null,
  };
  const dd6 = pick("fall10_6m");
  lines.push(`[quant-labs] ${dd6 ? `10%+ fall within 6 months ${Math.round(dd6.p * 100)}% (normal ${Math.round(dd6.base * 100)}%)` : "market odds unavailable"}; ${calibration?.sources?.length ?? 0} calibration source(s), ${registry?.rows?.length ?? 0} registry book(s), ${factors?.names?.length ?? 0} factor name(s), ${vol?.names?.length ?? 0} vol name(s), ${filings?.read ?? 0} annual report(s) compared`);
  return { payload, state, lines };
}

export const _test = { emptyState, decidedPnl, mean, round };

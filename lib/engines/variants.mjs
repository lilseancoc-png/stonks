// Strategy engines: variant shadows (2026-11-21, the scorecard pack; docs/
// engines.md "Variant shadows"). Owner, 2026-11-20: "shadowing every engine
// but instead of replicating our live engine the shadow engines run with
// different risks, entries, exits, methodology ... to measure if x changed
// what the outcome would be and learn"; "Can be changing any variable and
// measure the result"; "As long as it makes sense what we are measuring".
//
// A variant is a live engine with exactly one variable changed and a stated
// hypothesis. It runs in the same 11:00 and 15:30 ET runs on the same views,
// chains and quotes as its parent, so the two see the same signals on the
// same days and the comparison is paired: the measured difference is the
// change, not the luck of the market.
//
// Two kinds:
//   - behavior (entries, exits, gates, instrument, contract, budget): its own
//     paper book, stepped by the same book code (stepBook) with the changed
//     spec. Each run it starts from a copy of the parent's learning state
//     (entry bar, muted setups, market-type stand-downs), the Allocator table
//     and the brake table, and it does not learn, so the one change is the
//     only difference. Its own book keeps only what it traded, the signals it
//     has seen and its cooldowns.
//   - sizing: no book. The parent's own trades are recomputed at the
//     variant's size (`sizeX`) from the live record.
//
// Limits: at most 3 variants an engine and 20 in all (VARIANT_LIMITS,
// checked by validateVariants). Variant trades never reach the Webull paper
// account (they live in engines-state.json, which the mirror never reads),
// never touch Top Picks, the Allocator, engine learning or the live record.
// Fills use the run's own chain quotes (ask in, bid out, as the parent); a
// variant whose contract window needs an expiry the run did not load skips
// the trade and says why, rather than fetching more data.
//
// Read: the paired difference is per signal, in dollars (each book sized to
// the same risk budget, so an option and a share trade are comparable): for
// every signal either book closed since the variant started, the variant's
// dollars minus the parent's, a signal one book did not take counting $0
// for it. A variant that changes how a trade is made, not which trades are
// made (options or shares, the contract window, the stop: `match: "same"`),
// is compared only on signals both books took, so a slot or a missing
// expiry is not read as the change. `side` limits a variant to one side
// (a shares variant changes only the up side; its puts stay options).
// A new book starts with the parent's seen signals and cooldowns, so it
// opens only on signals that arrive after it started. A variant is "collecting" until 30 paired signals; after that it
// passes the bar at a t value of 2.4 or more (Holm, for up to three
// variants an engine), is "behind" at -2.4 or less, and otherwise shows "no
// clear difference yet". Promotion is the Owner's call; nothing here
// changes a live rule. A variant ends 6 months after it started (up to 12
// when its signals are rare, `months`): it then manages its open trades and
// opens none.
//
// Pure. No network, no AI.

import { ENGINES, engineName, isSharesTrade } from "./config.mjs";
import { stepBook, emptyRecord, emptyState } from "./book.mjs";
import { tradeUsd } from "./record.mjs";
import { counted, weeksBetween, weeklySeries, sharpeOf, worstDrop } from "./scorecard.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const freeze = (o) => Object.freeze(o);

export const VARIANT_LIMITS = freeze({ perEngine: 3, total: 20, minPaired: 30, holmT: 2.4, months: 6, closedKept: 300 });

const V = (o) => freeze({ kind: "behavior", started: "2026-11-21", scope: null, side: null, match: "all", ...o });
// The starter set (the 2026-11-20 review, owner approved 2026-11-21). Each
// changes one thing. `scope`: the parent's setups the comparison reads (null
// = every setup of the engine but its paper trials).
export const VARIANTS = freeze([
  V({ id: "TEC-bar65", engine: "technicals", change: "Entry bar 60 to 65",
    hypothesis: "Do the weakest setups lose live too? In the 2007-2026 test Technicals' 60-64 scores lost 0.84% a trade in both halves while higher scores earned.",
    promoteIf: "Its trades beat the parent's by 0.5% or more a trade (the parent's 60-64 trades losing)", months: 5,
    patch: { barAtLeast: 65 } }),
  V({ id: "TEC-stop2.5", engine: "technicals", change: "Share stop 3 ATR to 2.5 ATR", match: "same",
    hypothesis: "Does a tighter stop cut the -9.3% average stop-out loss without stopping out the winners?",
    promoteIf: "A higher average a trade and a smaller worst drop", months: 5,
    patch: { spec: { sharesStopAtr: 2.5 } } }),
  V({ id: "REV-bounce-shares", engine: "reversion", scope: ["oversold-bounce"], side: "call", match: "same", change: "Washout bounce bought as shares instead of calls",
    hypothesis: "Is the bounce idea right and only the option's decay wrong? On real option prices the bounce calls lost 6.7% a trade in both halves.",
    promoteIf: "Shares beat the calls on the same signals", months: 10,
    patch: { setups: { "oversold-bounce": { instrument: "shares" } } } }),
  V({ id: "REV-rsi2-7500", engine: "reversion", kind: "sizing", scope: ["rsi2-dip"], change: "RSI(2) dip trial lot $5,000 to $7,500",
    hypothesis: "Does more money in the long sleeve that diversifies best raise the book's Sharpe live? In the history test doubling it raised the book's Sharpe and cut its worst drop.",
    promoteIf: "Book Sharpe up and its worst drop no worse", months: 3, sizeX: 1.5 }),
  V({ id: "MAC-riskoff-aside", engine: "macro", change: "Macro stands aside while the market tape reads risk-off",
    hypothesis: "Do Macro's entries lose in a risk-off tape live, as in the history test (-5.2% a trade), or is the hedge worth having there?",
    promoteIf: "A smaller book drop with no loss of what it makes in down weeks", months: 12,
    patch: { gate: "riskoff" } }),
  V({ id: "MAC-fall60", engine: "macro", scope: ["rates-fall"], side: "call", match: "same", change: "Yields-falling TLT calls about 60 days out (was 21 to 70, ideal 40)",
    hypothesis: "Does more time help the one Macro option setup that held up on real prices (+5.1% a trade)?",
    promoteIf: "A higher average on the same signals", months: 12,
    patch: { setups: { "rates-fall": { contract: { dteMin: 50, dteIdeal: 60, dteMax: 80 } } } } }),
  V({ id: "FUN-top-shares", engine: "fundamentals", scope: ["rank-top"], side: "call", match: "same", change: "Top-of-rank calls bought as shares",
    hypothesis: "Are calls on top-ranked stocks losing to decay? Over the 13-month replay they lost 3.9% a trade.",
    promoteIf: "Shares beat the calls on the same signals", months: 7,
    patch: { setups: { "rank-top": { instrument: "shares", exits: { maxSessions: 60 } } } } }),
  V({ id: "ERN-runin-shares", engine: "earnings", scope: ["run-in"], side: "call", match: "same", change: "Pre-earnings run-in in shares at any IV (not only rich IV)",
    hypothesis: "The same decay question for the run-in: does the stock's move pay better than the call?",
    promoteIf: "Shares beat the options on the same signals", months: 7,
    patch: { setups: { "run-in": { instrument: "shares" } } } }),
  V({ id: "DWN-budget75", engine: "downside", change: "Downside puts at 0.75x of the risk budget (was 0.5x); still at most 10 contracts",
    hypothesis: "Does the engine trade at all at its size? It skipped PLTR and UNH because one put cost more than twice its half budget.",
    promoteIf: "It opens trades the parent skips and its puts pay in a risk-off tape", months: null,
    patch: { spec: { budgetX: 0.75 } } }),
  // The shadow pack (2026-11-25; owner asked for shadow tests of each engine
  // on 2026-11-24, audited in the "Shadow test ideas for every engine" doc).
  // Each still changes one thing. Time-only exits keep the parent's size
  // (`sizeStop`) and the stock levels, so only the premium target and stop
  // are gone; they read every signal ("all"), because a trade held longer
  // can keep the next signal out.
  V({ id: "MAC-timeonly", engine: "macro", started: "2026-11-25", change: "Macro option trades without the premium target and stop (held to the session limit, stock levels and thesis exits kept)",
    hypothesis: "Do Macro's option losses come from the fixed +30% / -40% exits? On the bench, time-only exits lifted the engine mix and cut its worst drop, and Macro's option losses came from the stops.",
    promoteIf: "More dollars over the same signals and a worst drop no deeper", months: 12,
    patch: { spec: { exits: { tp: null, stop: null, sizeStop: -40, maxSessions: 12 } }, setups: { "event-drift": { exits: { tp: null, stop: null, sizeStop: -35 } } } } }),
  V({ id: "DWN-timeonly", engine: "downside", started: "2026-11-25", change: "Downside puts without the premium target and stop (20 sessions, the 200-day stock stop kept)",
    hypothesis: "Do the puts need room? A sell-off that takes a month gets cut by a -40% stop on a bounce or capped at +50% before the drop is done.",
    promoteIf: "More dollars over the same signals in a risk-off tape", months: 12,
    patch: { spec: { exits: { tp: null, stop: null, sizeStop: -40, maxSessions: 20 } } } }),
  V({ id: "FLO-loose", engine: "flow", started: "2026-11-25", scope: ["aggressive-flow"], change: "Aggressive flow from 3 flagged trades and $100k of premium (was 5 and $250k); the score bar is unchanged",
    hypothesis: "Is the bar the reason Flow's own setup barely trades? The smaller one-sided days it would add: do they pay, or are they noise?",
    promoteIf: "The extra trades make money and the book's dollars rise", months: 6,
    patch: { setups: { "aggressive-flow": { minPrints: 3, minPrem: 100000 } } } }),
  // The faded trade is shares held at most 7 sessions, the parent put's own
  // limit, so the pair differs in direction, not in how long it is held.
  V({ id: "FLO-fade-puts", engine: "flow", started: "2026-11-25", scope: ["aggressive-flow"], match: "same", change: "Heavy put buying on a stock above its 200-day bought as the stock for up to 7 sessions (fading the flow), not as puts",
    hypothesis: "Is heavy put buying on a stock in an uptrend mostly hedging? If so the stock keeps rising and the puts lose.",
    promoteIf: "The shares beat the puts on the same signals", months: 12,
    patch: { setups: { "aggressive-flow": { fadeBear: "only", exits: { maxSessions: 7 } } } } }),
  V({ id: "FUN-put-downtrend", engine: "fundamentals", started: "2026-11-25", scope: ["rank-bottom"], side: "put", change: "Bottom-of-rank puts only in a confirmed downtrend (price under a falling 50-day under the 200-day; was: not far above the 200-day)",
    hypothesis: "Do weak companies' puts need the chart to agree? A bad business in a rising market can keep rising for months.",
    promoteIf: "Its puts beat the parent's over the same months", months: 9,
    patch: { setups: { "rank-bottom": { needDowntrend: true } } } }),
  V({ id: "ERN-gap-drift", engine: "earnings", started: "2026-11-25", scope: ["drift"], change: "Post-earnings drift on any 5%+ gap that held, whatever the EPS number (was: an EPS beat or miss of 5%+, guidance, or no EPS number)",
    hypothesis: "Is the price reaction the signal and the EPS number noise? Gaps against the EPS number would trade here and not live.",
    promoteIf: "The extra trades make money and the book's dollars rise", months: 9,
    patch: { setups: { drift: { gapOnly: true } } } }),
]);

export function validateVariants(list = VARIANTS) {
  const errs = [], per = {}, ids = new Set();
  for (const v of list) {
    if (ids.has(v.id)) errs.push(`${v.id}: duplicate id`); ids.add(v.id);
    if (!ENGINES[v.engine] || ENGINES[v.engine].core) errs.push(`${v.id}: not a signal engine`);
    per[v.engine] = (per[v.engine] || 0) + 1;
    if (!v.hypothesis || !v.change || !v.promoteIf) errs.push(`${v.id}: needs a change, a hypothesis and a promotion rule`);
    if (v.kind === "sizing" ? !(fin(v.sizeX) && v.sizeX > 0) : !v.patch) errs.push(`${v.id}: needs ${v.kind === "sizing" ? "sizeX" : "a patch"}`);
    if (v.side != null && v.side !== "call" && v.side !== "put") errs.push(`${v.id}: side must be call or put`);
    if (v.match !== "all" && v.match !== "same") errs.push(`${v.id}: match must be all or same`);
    for (const k of v.scope || []) if (!ENGINES[v.engine]?.setups?.[k]) errs.push(`${v.id}: no setup ${k}`);
    for (const k of Object.keys(v.patch?.setups || {})) if (!ENGINES[v.engine]?.setups?.[k]) errs.push(`${v.id}: no setup ${k}`);
  }
  for (const [e, n] of Object.entries(per)) if (n > VARIANT_LIMITS.perEngine) errs.push(`${e}: ${n} variants (at most ${VARIANT_LIMITS.perEngine})`);
  if (list.length > VARIANT_LIMITS.total) errs.push(`${list.length} variants (at most ${VARIANT_LIMITS.total})`);
  return errs;
}

// The parent's spec with the variant's one change.
export function variantSpec(spec, v) {
  const p = v.patch || {};
  let out = { ...spec, ...(p.spec || {}) };
  if (p.setups) {
    const setups = { ...spec.setups };
    for (const [k, patch] of Object.entries(p.setups)) setups[k] = freeze({ ...setups[k], ...patch, ...(patch.exits ? { exits: { ...(setups[k]?.exits || {}), ...patch.exits } } : {}) });
    out.setups = freeze(setups);
  }
  return freeze(out);
}
const GATES = { riskoff: (c, id, ctx) => (/risk-off$/.test(String(ctx?.macroState || "")) ? "variant: stands aside while the market tape reads risk-off" : null) };

const plus = (date, days) => { const ms = Date.parse(String(date).slice(0, 10) + "T12:00:00Z"); return fin(ms) ? new Date(ms + days * 86400000).toISOString().slice(0, 10) : null; };
// Six months, or longer for a variant whose signals are rare (its `months`,
// the time its 30 paired closes are expected to take, up to 12).
export const variantEnds = (v) => plus(v.started, Math.round(Math.min(12, Math.max(VARIANT_LIMITS.months, fin(v.months) ? v.months : 0)) * 30.5));
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
// Fields a closed variant trade drops (its reasons, signal facts and marks
// are kept on the open trade only), so a year of variant books stays small.
const SLIM_DROP = Object.freeze(["reasons", "facts", "env", "tape", "alloc", "exits", "bar", "lastSpot", "lastMid", "hiPct", "loPct", "lastMarkDate", "markSource", "news", "targetLevel", "stopLevel", "exitBy"]);

// One run of every behavior variant. `base` is the parent's stepBook input
// (the same views, quotes, chains and switches); `specs` the parent's
// registry. Writes state.variants and returns a short summary.
export function runVariants(state, base, { specs = ENGINES, today, nowIso, list = VARIANTS, seedFrom = null } = {}) {
  const vs = (state.variants ||= { v: 1, books: {} });
  const summary = { ran: 0, opened: 0, closed: 0, errors: [] };
  for (const v of list) {
    if (v.kind !== "behavior") continue;
    const parentEs = state.engines?.[v.engine];
    if (!parentEs || !specs[v.engine]) continue;
    if (today < v.started) continue;
    // A new book starts with the parent's seen signals and cooldowns, so it
    // does not open on signals the parent already took before it started
    // (they would be read as the variant's alone).
    // `seedFrom` is the parents' seen signals and cooldowns as they were
    // before this run's live step, so a signal that first showed up today is
    // open to both books.
    if (!vs.books[v.id]) {
      const st = emptyState(), src = seedFrom?.[v.engine] || parentEs;
      st.engines = { [v.engine]: { seen: clone(src.seen) || {}, cooldown: clone(src.cooldown) || {}, shadow: { open: [], closed: [] } } };
      vs.books[v.id] = { since: nowIso, record: emptyRecord(), state: st };
    }
    const book = vs.books[v.id];
    const ended = !!variantEnds(v) && today > variantEnds(v);
    // Start from the parent's learning state; keep only the variant's own
    // signals, cooldowns and shadow trades.
    const own = book.state.engines?.[v.engine] || {};
    const es = { ...clone({ ...parentEs, seen: undefined, cooldown: undefined, shadow: undefined, outcomes: undefined, log: undefined }), seen: own.seen || {}, cooldown: own.cooldown || {}, shadow: own.shadow || { open: [], closed: [] },
      // Scratch learning logs: a variant never learns, so they are dropped after the run.
      outcomes: [], log: [] };
    if (fin(v.patch?.barAtLeast)) es.bar = Math.max(Number(es.bar) || 0, v.patch.barAtLeast);
    book.state.engines = { [v.engine]: es };
    book.state.alloc = clone(state.alloc) || undefined;
    book.state.brake = clone(state.brake) || undefined;
    const vspecs = { ...specs, [v.engine]: variantSpec(specs[v.engine], v) };
    // A run that fails part way is rolled back, so a half-stepped book never
    // closes the same trade twice.
    const before = clone({ record: book.record, seen: es.seen, cooldown: es.cooldown, shadow: es.shadow });
    try {
      const out = stepBook(book.state, book.record, {
        ...base, nowIso, today, engines: [v.engine], specs: vspecs, learn: false,
        mode: ended ? "pause" : base.mode, closedKept: VARIANT_LIMITS.closedKept,
        // The account limits read the real book; a variant is paper only.
        controls: base.controls ? { ...base.controls, limits: null } : null,
        gate: v.patch?.gate ? GATES[v.patch.gate] : null,
        // The earnings straddle trial opens on the live book only.
        straddle: null,
      });
      // Variant trade IDs carry the variant's id, so one is never mistaken for
      // a live trade of the same signal (the live record never holds them).
      const pre = `${v.id}~`, tag = (x) => (x && !String(x).startsWith(pre) ? pre + x : x);
      for (const t of out.opened) { t.tradeId = tag(t.tradeId); if (t.twin) t.twin = tag(t.twin); if (t.twinOf) t.twinOf = tag(t.twinOf); t.variant = v.id; delete t.noMirror; delete t.shared; delete t.sharedWith; }
      // A closed variant trade keeps only what the paired read and the page use.
      for (const t of book.record.closed) {
        for (const k of SLIM_DROP) delete t[k];
        if (t.contract?.size?.why) { const { why, parts, ...size } = t.contract.size; t.contract = { ...t.contract, size: { ...size, parts: (parts || []).map((x) => ({ key: x.key, x: x.x })) } }; }
      }
      summary.ran++; summary.opened += out.opened.length; summary.closed += out.closed.length;
      book.lastRun = { iso: nowIso, opened: out.opened.length, closed: out.closed.length, ...(out.errors?.length ? { errors: out.errors.slice(0, 5) } : {}) };
      if (out.errors?.length) summary.errors.push(...out.errors.slice(0, 3).map((e) => `${v.id}: ${e}`));
    } catch (err) {
      book.record = before.record;
      Object.assign(book.state.engines[v.engine], { seen: before.seen, cooldown: before.cooldown, shadow: before.shadow });
      book.lastRun = { iso: nowIso, error: String(err?.message || err).split("\n")[0] };
      summary.errors.push(`${v.id}: ${book.lastRun.error}`);
    }
    // Only the variant's own parts are kept; the rest is copied each run.
    const kept = book.state.engines[v.engine];
    book.state = { version: book.state.version, engines: { [v.engine]: { seen: kept.seen, cooldown: kept.cooldown, shadow: { open: kept.shadow?.open || [], closed: (kept.shadow?.closed || []).slice(0, 40) } } }, lastRunIso: nowIso };
    book.ended = ended || undefined;
  }
  // Books of variants no longer in the registry are dropped.
  for (const id of Object.keys(vs.books)) if (!list.some((v) => v.id === id)) delete vs.books[id];
  return summary;
}

// Which trades a variant reads: its setups (or every setup but the paper
// trials) and its side.
const inVariantScope = (v, t) => (v.scope ? v.scope.includes(t.setup) : !t.trial) && (!v.side || t.side === v.side);
// Which of the parent's trades a variant is compared on.
function inScope(v, t, sinceIso) {
  if (t.engine !== v.engine || String(t.entryDate || "") < String(sinceIso || "")) return false;
  return inVariantScope(v, t);
}
const pairKey = (t) => `${t.signalKey || `${t.symbol}|${t.side}|${t.setup}|${String(t.entryDate).slice(0, 10)}`}${t.twinOf ? "|twin" : ""}`;

// The paired read of one variant against its parent.
export function pairedRead(v, parentTrades, variantTrades, sinceIso) {
  const by = new Map();
  const add = (t, side) => { const k = pairKey(t); const x = by.get(k) || {}; x[side] = t; by.set(k, x); };
  for (const t of parentTrades) if (inScope(v, t, sinceIso)) add(t, "p");
  for (const t of variantTrades) if (inVariantScope(v, t)) add(t, "v");
  const diffs = [];
  let both = 0, parentOnly = 0, variantOnly = 0, waiting = 0;
  for (const { p, v: q } of by.values()) {
    const pOpen = p && !p.exitDate, vOpen = q && !q.exitDate;
    if (pOpen || vOpen) { waiting++; continue; }
    const pu = p && counted(p) ? tradeUsd(p) || 0 : 0, vu = q && counted(q) ? tradeUsd(q) || 0 : 0;
    if (p && !counted(p) && q && !counted(q)) continue;
    if (p && q) both++; else if (p) parentOnly++; else variantOnly++;
    // A "same" variant is read on signals both books took.
    if (v.match === "same" && !(p && q)) continue;
    diffs.push(vu - pu);
  }
  return { ...diffStats(diffs), both, parentOnly, variantOnly, waiting };
}
function diffStats(diffs) {
  const n = diffs.length;
  const m = n ? diffs.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : null;
  const t = n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : null;
  return { n, meanUsd: fin(m) ? Math.round(m) : null, totalUsd: n ? Math.round(diffs.reduce((a, b) => a + b, 0)) : 0, t: r2(t) };
}
function statusOf(v, read, today) {
  if (variantEnds(v) && today > variantEnds(v)) return { status: "ended", label: "Ended: managing its open trades, opening none" };
  if (read.n < VARIANT_LIMITS.minPaired) return { status: "collecting", label: `Collecting: ${read.n} of ${VARIANT_LIMITS.minPaired} paired closes` };
  if (fin(read.t) && read.t >= VARIANT_LIMITS.holmT) return { status: "ahead", label: `Ahead: t ${read.t} clears the ${VARIANT_LIMITS.holmT} bar (the Owner decides on promotion)` };
  if (fin(read.t) && read.t <= -VARIANT_LIMITS.holmT) return { status: "behind", label: `Behind: t ${read.t}` };
  return { status: "no-difference", label: `No clear difference yet (t ${read.t ?? "n/a"}, the bar is ${VARIANT_LIMITS.holmT})` };
}
const sideStats = (list) => {
  const done = list.filter(counted);
  const p = done.map((t) => t.optionPnlPct), u = done.map(tradeUsd).filter(fin);
  return { n: done.length, open: list.filter((t) => !t.exitDate).length, avg: p.length ? r1(p.reduce((a, b) => a + b, 0) / p.length) : null,
    winRate: p.length ? r2(p.filter((x) => x > 0).length / p.length) : null, usd: Math.round(u.reduce((a, b) => a + b, 0)) };
};
const tradeLine = (t) => ({ tradeId: t.tradeId, symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, instrument: isSharesTrade(t) ? "shares" : "option", entryDate: t.entryDate, exitDate: t.exitDate || null,
  status: t.status || "open", optionPnlPct: t.optionPnlPct ?? null, usd: fin(tradeUsd(t)) ? Math.round(tradeUsd(t)) : null, qty: t.contract?.qty ?? null, shares: t.contract?.shares ?? null,
  dte: t.contract?.dte ?? null });

// The page's Experiments view.
export function variantsView(state, record, { today, enabled = true, list = VARIANTS } = {}) {
  const books = state?.variants?.books || {};
  const parentAll = [...(record?.open || []), ...(record?.closed || [])];
  const rows = list.map((v) => {
    const base = { id: v.id, engine: v.engine, engineName: engineName(v.engine), kind: v.kind, change: v.change, hypothesis: v.hypothesis, promoteIf: v.promoteIf,
      months: v.months ?? null, started: v.started, ends: variantEnds(v), scope: v.scope, side: v.side || null, match: v.match || "all", need: VARIANT_LIMITS.minPaired, bar: VARIANT_LIMITS.holmT };
    if (v.kind === "sizing") {
      const since = v.started + "T00:00:00Z";
      const mine = parentAll.filter((t) => inScope(v, t, since));
      const read = diffStats(mine.filter(counted).map((t) => (tradeUsd(t) || 0) * (v.sizeX - 1)));
      // The whole book with this sleeve at the variant's size.
      const closed = (record?.closed || []).filter(counted);
      const first = closed.reduce((m, t) => (!m || String(t.exitDate) < m ? String(t.exitDate).slice(0, 10) : m), null);
      const weeks = first ? weeksBetween(first, today || first) : [];
      const scaled = new Set(mine.map((t) => t.tradeId));
      const baseW = weeklySeries(closed, weeks), varW = weeklySeries(closed, weeks, (t) => (tradeUsd(t) || 0) * (scaled.has(t.tradeId) ? v.sizeX : 1));
      const st = statusOf(v, read, today);
      return { ...base, sizeX: v.sizeX, ...st, pairs: read,
        parent: sideStats(mine), variant: { ...sideStats(mine), usd: Math.round(mine.filter(counted).map((t) => (tradeUsd(t) || 0) * v.sizeX).reduce((a, b) => a + b, 0)) },
        book: { weeks: weeks.length, sharpe: weeks.length >= 20 ? sharpeOf(baseW) : null, sharpeVariant: weeks.length >= 20 ? sharpeOf(varW) : null, worstUsd: worstDrop(baseW), worstUsdVariant: worstDrop(varW) } };
    }
    const b = books[v.id];
    if (!b) return { ...base, status: enabled ? "starting" : "off", label: enabled ? "Starts at the next Top Picks run" : "Variants are switched off in Owner Settings", pairs: null, parent: null, variant: null, trades: [] };
    const vt = [...(b.record?.open || []), ...(b.record?.closed || [])];
    const read = pairedRead(v, parentAll, vt, b.since);
    const st = enabled ? statusOf(v, read, today) : { status: "off", label: "Variants are switched off in Owner Settings (its book is kept)" };
    return { ...base, since: b.since, ...st, pairs: read,
      parent: sideStats(parentAll.filter((t) => inScope(v, t, b.since))), variant: sideStats(vt.filter((t) => inVariantScope(v, t))),
      lastRun: b.lastRun || null, archived: b.record?.archive?.[v.engine] || null,
      trades: vt.slice().sort((x, y) => (String(y.entryDate) > String(x.entryDate) ? 1 : -1)).slice(0, 12).map(tradeLine) };
  });
  return { enabled, rule: { ...VARIANT_LIMITS }, rows };
}

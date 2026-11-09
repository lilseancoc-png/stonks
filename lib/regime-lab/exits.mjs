// Regime Lab: exits that tighten with risk (E1-E9, 2026-11-09).
//
// The base cut is -50% of premium and +25% take-profit (the live rules). This
// module holds every alternative the lab tests: a risk score per trade (E1),
// the stop ladder and its continuous form (E2), targets scaled by the era
// (E3), price-based stops translated to the option (E4), size-first sizing
// (E5), time stops by character (E6), book-level brakes (E7), the grade-fade
// exit as a TEST-ONLY rule (E8) and the exit scorecard (E9). Nothing here is
// wired into the live engine; the harness and the shadow books read it.

export const EXIT_RULES_VERSION = "2026-11-09-exits-v1";
export const BASE_STOP_PCT = -50;
export const BASE_TP_PCT = 25;
// E2. Stop by volatility era, points of premium.
export const STOP_LADDER = Object.freeze({ calm: -50, normal: -45, elevated: -35, crisis: -30 });
// E7. Book brakes by era.
export const BOOK_BRAKES = Object.freeze({
  calm: { maxOpen: 8, dailyLossLimitTrades: 3, themeCap: 2 },
  normal: { maxOpen: 6, dailyLossLimitTrades: 2.5, themeCap: 2 },
  elevated: { maxOpen: 5, dailyLossLimitTrades: 2, themeCap: 2 },
  crisis: { maxOpen: 3, dailyLossLimitTrades: 1.5, themeCap: 1 },
});
// E6. Dead-money time stop in sessions, by market character.
export const TIME_STOPS = Object.freeze({ chop: 3, mixed: 5, trending: 8 });
// E1. Structure risk (how much of the premium a bad day can take).
// Keys match the record's contract.structure (long, debit_vertical,
// credit_vertical); the short aliases cover the harness and the oracle.
export const STRUCTURE_RISK = Object.freeze({ stock: 0.4, debit_vertical: 0.7, debit: 0.7, credit_vertical: 0.8, credit: 0.8, straddle: 0.9, long: 1.0 });
export const ERA_RISK = Object.freeze({ calm: 0.6, normal: 0.8, elevated: 1.0, crisis: 1.25 });
// The Oct 28 lesson: WDC, TSM, MU and ORCL were one bet. Theme membership for
// the theme cap; names outside the map fall back to the caller's sector group.
export const THEMES = Object.freeze({
  "ai-hardware": ["NVDA", "AMD", "AVGO", "TSM", "MU", "WDC", "SMCI", "ARM", "ANET", "DELL", "MRVL", "ORCL", "CRWV", "VRT", "AMAT", "LRCX", "KLAC", "ASML", "SNDK", "STX", "COHR", "CRDO", "ALAB", "NBIS", "SMH", "SOXX"],
  "mega-platforms": ["AAPL", "MSFT", "AMZN", "META", "GOOGL", "GOOG", "NFLX"],
  "crypto": ["COIN", "MSTR", "HOOD", "IBIT", "MARA", "RIOT", "CRCL"],
  "nuclear-power": ["VST", "CEG", "OKLO", "SMR", "NRG", "GEV", "BE"],
  "space-quantum": ["ASTS", "RKLB", "IONQ", "RGTI", "QBTS", "LUNR"],
});
const THEME_OF = new Map();
for (const [theme, syms] of Object.entries(THEMES)) for (const s of syms) THEME_OF.set(s, theme);

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function ladderStop(era) { return STOP_LADDER[era] ?? BASE_STOP_PCT; }

// Continuous form: -50% x (1 - 0.4 x volatility percentile). 0th percentile
// keeps -50, the 100th tightens to -30.
export function continuousStop(volPct) {
  const p = num(volPct);
  if (p == null) return BASE_STOP_PCT;
  return r1(BASE_STOP_PCT * (1 - 0.4 * clamp(p, 0, 100) / 100));
}

export function themeOf(sym, fallback = null) {
  return THEME_OF.get(String(sym || "").toUpperCase()) || (typeof fallback === "function" ? fallback(sym) : fallback) || null;
}

// E1. One number from 1 to 10 for a trade. A normal-era single option on a
// median-volatility name with ~60 days to expiry scores about 6.
export function riskScore({ structure = "long", era = "normal", stockVolRankPct = 50, dte = 60, eventInWindow = false } = {}) {
  const s = STRUCTURE_RISK[structure] ?? STRUCTURE_RISK.long;
  const e = ERA_RISK[era] ?? ERA_RISK.normal;
  const rank = clamp(num(stockVolRankPct) ?? 50, 0, 100);
  const v = 0.7 + 0.6 * (rank / 100);
  const d = num(dte);
  const t = d == null ? 1 : d <= 14 ? 1.2 : d <= 30 ? 1.1 : d <= 60 ? 1.0 : 0.9;
  const base = 10 * s * e * v * t * 0.75;
  const bump = eventInWindow ? 1.5 : 0;
  const score = clamp(base + bump, 1, 10);
  return { score: r1(score), parts: { structure: s, era: e, volatility: r1(v), expiry: t, event: bump }, inputs: { structure, era, stockVolRankPct: rank, dte: d, eventInWindow: !!eventInWindow } };
}

// E3. Target scaled by the stock's expected 5-day move. `leverage` is the
// option's percent move per 1% stock move (delta x spot / premium).
export function scaledTarget({ expectedMove5dPct = null, leverage = null, base = BASE_TP_PCT } = {}) {
  const m = num(expectedMove5dPct), l = num(leverage);
  if (m == null || l == null || !(l > 0)) return base;
  return r1(clamp(0.8 * l * m, 15, 60));
}

// E4. A stop on the stock price (ATR multiple), translated to premium points.
export function priceStopPremiumPct({ atrPct = null, mult = 1.75, leverage = null } = {}) {
  const a = num(atrPct), l = num(leverage);
  if (a == null || l == null || !(l > 0)) return BASE_STOP_PCT;
  return r1(-clamp(a * mult * l, 15, 85));
}

// E5. Size first: contracts = risk budget / dollars lost at the stop.
export function sizeFirst({ riskBudgetUsd = 500, stopPct = BASE_STOP_PCT, premium = null } = {}) {
  const p = num(premium);
  if (p == null || !(p > 0)) return { contracts: 0, riskPerContract: null };
  const riskPerContract = (Math.abs(num(stopPct) ?? 50) / 100) * p * 100;
  return { contracts: Math.max(0, Math.floor(riskBudgetUsd / riskPerContract)), riskPerContract: r1(riskPerContract) };
}

export function timeStopSessions(character) {
  if (character === "up" || character === "down" || character === "trending") return TIME_STOPS.trending;
  if (character === "chop") return TIME_STOPS.chop;
  return TIME_STOPS.mixed;
}

export function bookBrakes(era) { return BOOK_BRAKES[era] || BOOK_BRAKES.normal; }

// E8. Test only: close when the grade on the trade's side falls under the bar.
export function gradeFadeExit({ sideGrade = null, bar = 4 } = {}) {
  const g = num(sideGrade);
  return g != null && g < bar;
}

// The rule sets the harness compares (C3). Each one is a small object the
// harness resolves per trade through resolveExitParams.
export const EXIT_RULE_SETS = Object.freeze([
  { id: "flat-50", name: "Flat -50% / +25% (live rules)", stop: "flat", tp: "flat", baseline: true },
  { id: "ladder", name: "Stop ladder by era (E2)", stop: "ladder", tp: "flat" },
  { id: "continuous", name: "Continuous stop by vol percentile (E2)", stop: "continuous", tp: "flat" },
  { id: "price-stop", name: "Price stop 1.75 ATR, translated (E4)", stop: "price", tp: "flat" },
  { id: "size-first", name: "Fixed dollar risk, flat stop (E5)", stop: "flat", tp: "flat", sizing: "risk" },
  { id: "size-first-ladder", name: "Fixed dollar risk with the ladder (E5)", stop: "ladder", tp: "flat", sizing: "risk" },
  { id: "scaled-target", name: "Target scaled by expected move (E3)", stop: "flat", tp: "scaled" },
  { id: "partial-trail", name: "Half off at +25%, trail the rest (E3)", stop: "flat", tp: "partial" },
  { id: "time-3", name: "Time stop 3 sessions (E6)", stop: "flat", tp: "flat", timeStop: 3 },
  { id: "time-5", name: "Time stop 5 sessions (E6)", stop: "flat", tp: "flat", timeStop: 5 },
  { id: "time-8", name: "Time stop 8 sessions (E6)", stop: "flat", tp: "flat", timeStop: 8 },
  { id: "time-by-character", name: "Time stop by character (E6)", stop: "flat", tp: "flat", timeStop: "character" },
  { id: "brakes", name: "Book brakes by era (E7)", stop: "flat", tp: "flat", brakes: true },
  { id: "ladder-brakes", name: "Ladder plus brakes (E2 + E7)", stop: "ladder", tp: "flat", brakes: true },
  { id: "grade-fade", name: "Grade-fade exit (E8, test only)", stop: "flat", tp: "flat", gradeFade: true, testOnly: true },
]);

export function exitRuleSet(id) { return EXIT_RULE_SETS.find((r) => r.id === id) || null; }

// Resolve one rule set for one trade at entry.
export function resolveExitParams(ruleSet, ctx = {}) {
  const rs = typeof ruleSet === "string" ? exitRuleSet(ruleSet) : ruleSet || EXIT_RULE_SETS[0];
  const era = ctx.era || "normal";
  let stopPct = BASE_STOP_PCT;
  if (rs.stop === "ladder") stopPct = ladderStop(era);
  else if (rs.stop === "continuous") stopPct = continuousStop(ctx.volRankPct);
  else if (rs.stop === "price") stopPct = priceStopPremiumPct({ atrPct: ctx.atrPct, mult: rs.atrMult || 1.75, leverage: ctx.leverage });
  let tpPct = BASE_TP_PCT, partial = null, trailPts = null;
  if (rs.tp === "scaled") tpPct = scaledTarget({ expectedMove5dPct: ctx.expectedMove5dPct, leverage: ctx.leverage });
  else if (rs.tp === "partial") { partial = 0.5; trailPts = 25; }
  const timeStop = rs.timeStop === "character" ? timeStopSessions(ctx.character) : num(rs.timeStop);
  let sizeMult = 1, contracts = null;
  if (rs.sizing === "risk") {
    const sized = sizeFirst({ riskBudgetUsd: ctx.riskBudgetUsd ?? 500, stopPct, premium: ctx.premium });
    contracts = sized.contracts;
    // Relative to one contract at the base stop: the equal-risk size.
    const baseRisk = (Math.abs(BASE_STOP_PCT) / 100) * (num(ctx.premium) || 0) * 100;
    sizeMult = baseRisk > 0 && sized.riskPerContract > 0 ? r1(Math.min(2, baseRisk / sized.riskPerContract)) : 1;
  }
  const brakes = rs.brakes ? bookBrakes(era) : null;
  return { id: rs.id, stopPct, tpPct, partial, trailPts, timeStop: timeStop ?? null, sizeMult, contracts, maxOpen: brakes?.maxOpen ?? null, themeCap: brakes?.themeCap ?? null, dailyLossLimitTrades: brakes?.dailyLossLimitTrades ?? null, gradeFade: !!rs.gradeFade, stopMode: rs.stop, testOnly: !!rs.testOnly };
}

// E9. Whipsaw: a stopped trade that would have reached its target within
// five sessions of the stop. The harness stamps `wouldHaveHitTp` on stops.
export function whipsawRate(trades) {
  const stopped = (trades || []).filter((t) => t && /^stop/.test(String(t.why || "")));
  if (!stopped.length) return null;
  return Math.round((stopped.filter((t) => t.wouldHaveHitTp).length / stopped.length) * 1000) / 10;
}

function drawdownPoints(trades) {
  const sorted = (trades || []).filter((t) => Number.isFinite(t?.net)).slice().sort((a, b) => String(a.exit || "").localeCompare(String(b.exit || "")));
  let cum = 0, peak = 0, dd = 0;
  for (const t of sorted) { cum += t.net * (t.size ?? 1); if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  return r1(dd);
}

function describe(list) {
  const xs = list.filter((t) => Number.isFinite(t?.net));
  const n = xs.length;
  if (!n) return { n: 0, avgNet: null, winPct: null, maxDrawdownPts: null, whipsawPct: null, avgHold: null };
  const wins = xs.filter((t) => t.net > 0).length;
  const hold = xs.filter((t) => Number.isFinite(t.held));
  return {
    n, avgNet: r1(xs.reduce((a, t) => a + t.net, 0) / n), winPct: Math.round((wins / n) * 100),
    maxDrawdownPts: drawdownPoints(xs), whipsawPct: whipsawRate(xs),
    avgHold: hold.length ? r1(hold.reduce((a, t) => a + t.held, 0) / hold.length) : null,
  };
}

// E9. Per regime cell (the cell at entry) and in total.
export function exitScorecard(trades, cells = null) {
  const list = Array.isArray(trades) ? trades : [];
  const byCell = {};
  for (const t of list) { const c = t?.cell || "unlabeled"; (byCell[c] = byCell[c] || []).push(t); }
  const out = { total: describe(list), byCell: {} };
  const keys = cells || Object.keys(byCell);
  for (const c of keys) out.byCell[c] = describe(byCell[c] || []);
  return out;
}

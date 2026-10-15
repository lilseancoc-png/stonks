// LEAPS recommendations. The stock decision is the Top Picks decision with a
// different pillar mix. The contract is a listed long call or long put.
//
// Pillar weights, mapped onto scoreTicker's pillars:
//   Narrative    1.5
//   Trend        1.25
//   Flow         1.25
//   Fundamentals 1.0
// The weighted average times 4 is the Top Picks sum scale. The bars are
// higher than Top Picks because a LEAPS bet has to survive a long time:
// 5 to be an idea, 8 to buy a call, 9 to buy a put. A buy also needs two pillars
// on the trade's side and a confirmed go entry for that side. An avoid is
// dropped. Rich or cheap IV moves conviction the same way Top Picks does,
// and it cannot flip the side.
//
// A stock is more likely to be higher in one to two years than lower, so
// every scored name starts one point higher. That prior is smaller than a
// single pillar and cannot create a buy by itself. The forward fundamental
// path then adds up to two points: improving supports a call, declining
// supports a put. A call buy is dropped to a watch when fundamentals are
// declining. A put buy requires that decline.
//
// The published desk is the score only. It does not fetch a far expiration
// or name a strike. selectLeapsContract remains available for a later desk
// that chooses to spend those Yahoo reads. The theoretical "a 35% move
// doubles the premium" pricer is not part of this decision.

import { greeks } from "./greeks.mjs";
import { expirationInLeapsWindow } from "./leaps-expirations.mjs";

export const LEAPS_PICKS_KEY = "leaps-picks.json";

export const LEAPS_PILLAR_WEIGHTS = Object.freeze({
  narrative: 1.5,
  technicals: 1.25,
  mechanicals: 1.25,
  fundamentals: 1,
});

export const LEAPS_WEIGHT_TOTAL = Object.values(LEAPS_PILLAR_WEIGHTS)
  .reduce((sum, weight) => sum + weight, 0);

// Higher than the short-term bars. An idea starts at 5. A call buy starts at
// 8 and a put buy at 9, because a one- to two-year prediction has more time
// to be wrong and a falling case needs more evidence than a rising one.
// One pillar cannot reach 8 when scores are clamped at ±5.
// One grade point of long-term upward drift. Applied after the weighted
// pillars and before the side is chosen. Not large enough to clear the buy bar.
export const LEAPS_BULLISH_PRIOR = 1;
// Same cap as the short-term trajectory nudge. Added on top of the clamped
// fundamentals pillar so a business that is already at +5 or -5 can still
// show whether the next two years are improving or declining.
export const LEAPS_TRAJECTORY_CAP = 2;

export const LEAPS_MIN_CONVICTION = 5;
export const LEAPS_CALL_BUY = 8;
export const LEAPS_PUT_BUY = 9;

export function leapsBuyBar(side) {
  return side === "put" ? LEAPS_PUT_BUY : LEAPS_CALL_BUY;
}
export const LEAPS_MIN_PILLARS = 2;
export const LEAPS_ROSTER_CAP = 10;
export const LEAPS_DELTA_MIN = 0.2;
export const LEAPS_DELTA_MAX = 0.4;
export const LEAPS_DELTA_TARGET = 0.3;
export const LEAPS_OTM_MIN = 0.2;
export const LEAPS_OTM_MAX = 0.5;
export const LEAPS_OTM_TARGET = 0.35;
const LEAPS_YEAR_MS = 365.25 * 86400000;
const PILLAR_COUNT = 4;

export const LEAPS_GRADER_DAILY_CAP = 2;

export const LEAPS_GRADER_CALL_TYPE = "leaps-grader";

// Kept separate from the short-term thesis prompt. One sentence of instruction.
export const LEAPS_GRADER_PROMPT = "Grade this one LEAPS candidate for a 6-18 month hold. JSON only: {\"grade\":\"strong|moderate|weak|reject\",\"reason\":\"one sentence\"}.";

export const LEAPS_GRADER_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    grade: { type: "string", enum: ["strong", "moderate", "weak", "reject"] },
    reason: { type: "string" },
  },
  required: ["grade", "reason"],
});

// Default off. This gates the unused contract fetch and the unused grader.
// The score desk uses leapsScoresEnabled, which runs unless LEAPS_SCORE=0.
export function leapsScoreEnabled(env = process.env) {
  return env?.LEAPS_SCORE === "1";
}

// The Owner score list. On with Top Picks. LEAPS_SCORE=0 leaves the prior file alone.
export function leapsScoresEnabled(env = process.env) {
  return env?.LEAPS_SCORE !== "0";
}

function pillarNumber(value) {
  if (value == null) return null;
  const raw = typeof value === "object" ? value.score : value;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Copy only the four asset pillars. Timing and IV cost are not LEAPS inputs.
function copyPillars(row) {
  const src = row?.pillars && typeof row.pillars === "object" ? row.pillars : row;
  return structuredClone({
    narrative: src?.narrative ?? null,
    technicals: src?.technicals ?? src?.trend ?? null,
    mechanicals: src?.mechanicals ?? src?.flow ?? null,
    fundamentals: src?.fundamentals ?? null,
  });
}

export function scoreLeapsPillars(pillars) {
  const copy = structuredClone(pillars ?? {});
  const narrative = pillarNumber(copy.narrative);
  const technicals = pillarNumber(copy.technicals ?? copy.trend);
  const flow = pillarNumber(copy.mechanicals ?? copy.flow);
  const fundamentals = pillarNumber(copy.fundamentals);
  if (narrative == null || technicals == null || flow == null || fundamentals == null) return null;
  const weighted = narrative * LEAPS_PILLAR_WEIGHTS.narrative
    + technicals * LEAPS_PILLAR_WEIGHTS.technicals
    + flow * LEAPS_PILLAR_WEIGHTS.mechanicals
    + fundamentals * LEAPS_PILLAR_WEIGHTS.fundamentals;
  return weighted / LEAPS_WEIGHT_TOTAL;
}

export function leapsDecisionTotal(pillars) {
  const average = scoreLeapsPillars(pillars);
  if (average == null) return null;
  return average * PILLAR_COUNT;
}

// The fundamentals pillar already carries this. Missing or steady is a zero
// nudge. The score is the signed path, capped so it cannot outvote the pillars.
export function leapsFundamentalsTrajectory(pillars) {
  const raw = pillars?.fundamentals?.trajectory;
  if (!raw || typeof raw !== "object") return { dir: "steady", score: 0 };
  const dir = raw.dir === "improving" || raw.dir === "declining" ? raw.dir : "steady";
  const score = Number(raw.score);
  const capped = Number.isFinite(score)
    ? Math.max(-LEAPS_TRAJECTORY_CAP, Math.min(LEAPS_TRAJECTORY_CAP, score))
    : 0;
  return { dir, score: capped };
}

function pillarScore(pillars, key) {
  if (key === "technicals") return pillarNumber(pillars?.technicals ?? pillars?.trend);
  if (key === "mechanicals") return pillarNumber(pillars?.mechanicals ?? pillars?.flow);
  return pillarNumber(pillars?.[key]);
}

export function leapsPillarsAligned(pillars, side) {
  const sign = side === "call" ? 1 : -1;
  let aligned = 0;
  for (const key of ["narrative", "technicals", "mechanicals", "fundamentals"]) {
    const score = pillarScore(pillars, key);
    if (score != null && score !== 0 && Math.sign(score) === sign) aligned += 1;
  }
  return aligned;
}

// Timing is trusted only when it was computed for this side. A go on the
// opposite side is not a buy. Missing timing is not a buy either.
function entryRead(row, side) {
  const timing = row?.timing;
  if (!timing || typeof timing !== "object" || (timing.side && timing.side !== side)) {
    return { state: "unconfirmed", confirmed: false };
  }
  if (timing.state === "avoid") return { state: "avoid", confirmed: false };
  if (timing.state === "go") return { state: "go", confirmed: true };
  return { state: "wait", confirmed: false };
}

// ivCost.context.contribution is the raw Top Picks IV point: positive when
// premium is cheap, negative when it is rich, already capped. Sign it onto
// this trade, then refuse to let it cross through zero.
function applyIvDerate(total, side, row) {
  const raw = Number(row?.pillars?.ivCost?.context?.contribution);
  if (!Number.isFinite(raw)) return total;
  const signed = raw * (side === "call" ? 1 : -1);
  const next = total + signed;
  const sign = total > 0 ? 1 : -1;
  if (next * sign < 0) return 0;
  return next;
}

// pass = buy the shown contract. watch = the stock case is real but the
// entry, the confluence, or the listed contract is not. reject = do not suggest.
export function decideLeapsStock(row) {
  const pillars = copyPillars(row?.pillars && typeof row.pillars === "object" ? row.pillars : row);
  const weighted = leapsDecisionTotal(pillars);
  const trajectory = leapsFundamentalsTrajectory(pillars);
  const blank = {
    total: weighted, side: null, pillarsAligned: 0, trajectory,
    prior: LEAPS_BULLISH_PRIOR, entry: { state: "unconfirmed", confirmed: false },
  };
  if (weighted == null) return { ...blank, gate: "reject", reason: "incomplete" };
  const base = weighted + LEAPS_BULLISH_PRIOR + trajectory.score;
  if (base === 0) return { ...blank, total: base, gate: "reject", reason: "no-direction" };
  const side = base > 0 ? "call" : "put";
  const total = applyIvDerate(base, side, row);
  const aligned = leapsPillarsAligned(pillars, side);
  const entry = entryRead(row, side);
  const decision = { total, side, pillarsAligned: aligned, trajectory, prior: LEAPS_BULLISH_PRIOR, entry };
  if (total === 0) return { ...decision, gate: "reject", reason: "iv-flattened" };
  if (entry.state === "avoid") return { ...decision, gate: "reject", reason: "avoid" };
  if (Math.abs(total) < LEAPS_MIN_CONVICTION) return { ...decision, gate: "reject", reason: "below-bar" };
  const buyBar = leapsBuyBar(side);
  const atBuyBar = Math.abs(total) >= buyBar;
  const strong = atBuyBar && aligned >= LEAPS_MIN_PILLARS && entry.confirmed;
  if (strong && side === "call" && trajectory.dir === "declining") {
    return { ...decision, gate: "watch", reason: "fundamentals-declining" };
  }
  if (strong && side === "put" && trajectory.dir !== "declining") {
    return { ...decision, gate: "watch", reason: "fundamentals-not-declining" };
  }
  if (strong) return { ...decision, gate: "pass", reason: "buy" };
  let reason = "moderate";
  if (atBuyBar && aligned < LEAPS_MIN_PILLARS) reason = "confluence";
  else if (atBuyBar && !entry.confirmed) reason = "entry-wait";
  return { ...decision, gate: "watch", reason };
}

export function leapsSetupGate(row) {
  return decideLeapsStock(row).gate;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readListedQuote(row) {
  const strike = num(row?.s ?? row?.strike);
  const bid = num(row?.b ?? row?.bid);
  const ask = num(row?.a ?? row?.ask);
  const iv = num(row?.iv);
  if (strike == null || bid == null || ask == null || iv == null) return null;
  if (!(strike > 0) || !(bid > 0) || !(ask >= bid) || !(iv > 0)) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return {
    strike,
    bid,
    ask,
    mid,
    iv,
    oi: num(row?.oi) ?? 0,
    volume: num(row?.v ?? row?.volume) ?? 0,
  };
}

function contractRank(quote) {
  const band = quote.byDelta && quote.byOtm ? 0 : quote.byDelta ? 1 : 2;
  const deltaDist = quote.byDelta ? Math.abs(quote.delta - LEAPS_DELTA_TARGET) : 1;
  const otmDist = quote.byOtm ? Math.abs(quote.otm - LEAPS_OTM_TARGET) : 1;
  const tenorDist = Math.abs(quote.years * 12 - 15) / 15;
  return band * 10 + deltaDist + otmDist + quote.spreadPct + tenorDist * 0.25;
}

// One long call or long put. Qualifies on delta or on distance from spot.
// Near-dated contracts and the other side never qualify.
export function selectLeapsContract(data, side, opts = {}) {
  if (side !== "call" && side !== "put") return null;
  const spot = num(data?.spot);
  if (!(spot > 0)) return null;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  if (Number.isNaN(now.getTime())) return null;
  const rate = opts.rate == null ? 0.045 : num(opts.rate);
  if (rate == null) return null;
  const book = {};
  for (const source of [data?.chains, data?._leapsChains]) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [key, chain] of Object.entries(source)) book[key] = chain;
  }
  let best = null;
  for (const [key, chain] of Object.entries(book)) {
    const expSec = num(key);
    if (expSec == null || !expirationInLeapsWindow(expSec, now)) continue;
    const rows = side === "call" ? chain?.c : chain?.p;
    if (!Array.isArray(rows)) continue;
    const years = (expSec * 1000 - now.getTime()) / LEAPS_YEAR_MS;
    if (!(years > 0)) continue;
    for (const listed of rows) {
      const quote = readListedQuote(listed);
      if (!quote) continue;
      const priced = greeks(side, spot, quote.strike, years, quote.iv, rate);
      if (!priced || !Number.isFinite(priced.delta)) continue;
      const delta = Math.abs(priced.delta);
      const otm = side === "call" ? (quote.strike / spot - 1) : (1 - quote.strike / spot);
      const byDelta = delta >= LEAPS_DELTA_MIN && delta <= LEAPS_DELTA_MAX;
      const byOtm = otm >= LEAPS_OTM_MIN && otm <= LEAPS_OTM_MAX;
      if (!byDelta && !byOtm) continue;
      const cand = {
        ...quote,
        expSec,
        delta,
        signedDelta: priced.delta,
        otm,
        years,
        byDelta,
        byOtm,
        spreadPct: (quote.ask - quote.bid) / quote.mid,
      };
      if (!best || contractRank(cand) < contractRank(best)) best = cand;
    }
  }
  if (!best) return null;
  const qualifiedBy = [];
  if (best.byDelta) qualifiedBy.push("delta");
  if (best.byOtm) qualifiedBy.push("otm");
  return {
    side,
    structure: "long",
    strike: best.strike,
    expiry: best.expSec,
    dte: Math.round(best.years * 365.25),
    delta: Math.round(best.signedDelta * 1000) / 1000,
    otmPct: Math.round(best.otm * 1000) / 10,
    bid: best.bid,
    ask: best.ask,
    mid: Math.round(best.mid * 100) / 100,
    iv: best.iv,
    oi: best.oi,
    volume: best.volume,
    spreadPct: Math.round(best.spreadPct * 10000) / 10000,
    qualifiedBy,
  };
}

function universeRows(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.scored)) return input.scored;
  if (input?.grades && typeof input.grades === "object" && !Array.isArray(input.grades)) {
    return Object.values(input.grades);
  }
  return [];
}

// Every scored name. No top-N cut. `score` stays the weighted pillar average.
// `total` is that average on the Top Picks sum scale, which the gate uses.
export function scoreLeapsUniverse(input) {
  return universeRows(input).map((row) => {
    const pillars = copyPillars(row);
    const decision = decideLeapsStock(row);
    return {
      symbol: row?.sym || row?.symbol || null,
      score: scoreLeapsPillars(pillars),
      total: decision.total,
      side: decision.side,
      gate: decision.gate,
      reason: decision.reason,
      pillarsAligned: decision.pillarsAligned,
      entry: decision.entry,
    };
  });
}

export function planLeapsGrader({
  enabled = false,
  candidates = [],
  callsAlreadyToday = 0,
  atReserve = false,
} = {}) {
  const prompt = LEAPS_GRADER_PROMPT;
  if (!enabled) return { run: false, reason: "disabled", calls: 0, symbols: [], prompt };
  const passed = (Array.isArray(candidates) ? candidates : []).filter((row) => row && row.gate === "pass" && row.symbol);
  if (!passed.length) return { run: false, reason: "no-pass", calls: 0, symbols: [], prompt };
  // Reserve headroom is for narratives and the Brief. Skip LEAPS before any
  // model call, ahead of spending the LEAPS cap.
  if (atReserve) return { run: false, reason: "reserve", calls: 0, symbols: [], skippedFirst: true, prompt };
  const used = Math.max(0, Number(callsAlreadyToday) || 0);
  const room = Math.max(0, LEAPS_GRADER_DAILY_CAP - used);
  if (room <= 0) return { run: false, reason: "cap", calls: 0, symbols: [], prompt };
  const symbols = passed.slice(0, room).map((row) => row.symbol);
  return { run: true, reason: "ok", calls: symbols.length, symbols, prompt };
}

export async function runLeapsGrader(plan, callModel) {
  if (!plan?.run || typeof callModel !== "function") {
    return { ran: false, reason: plan?.reason || "skip", results: [] };
  }
  const results = [];
  for (const symbol of plan.symbols || []) {
    results.push({ symbol, result: await callModel({ symbol, prompt: plan.prompt }) });
  }
  return { ran: true, reason: "ok", results };
}

export function countLeapsGraderCalls(usageState, day = new Date().toISOString().slice(0, 10)) {
  const byDate = usageState?.dates?.[day];
  if (!byDate || typeof byDate !== "object") return 0;
  let calls = 0;
  for (const byModel of Object.values(byDate)) {
    calls += Number(byModel?.[LEAPS_GRADER_CALL_TYPE]?.calls) || 0;
  }
  return calls;
}

function withListedContract(row, source, opts) {
  const contract = row.side ? selectLeapsContract(source?.data, row.side, opts) : null;
  const next = { ...row, contract };
  if (next.gate === "pass" && !contract) {
    next.gate = "watch";
    next.reason = "no-contract";
  }
  return next;
}

function leapsPillarSnapshot(row) {
  const pillars = copyPillars(row?.pillars && typeof row.pillars === "object" ? row.pillars : row);
  return {
    narrative: pillarNumber(pillars.narrative),
    technicals: pillarNumber(pillars.technicals ?? pillars.trend),
    mechanicals: pillarNumber(pillars.mechanicals ?? pillars.flow),
    fundamentals: pillarNumber(pillars.fundamentals),
  };
}

// Score list for the Owner desk. No contract, no model call. Null only when
// LEAPS_SCORE=0, in which case the caller leaves the prior file untouched.
export function buildLeapsScorePayload(scored, opts = {}) {
  const env = opts.env ?? process.env;
  if (!leapsScoresEnabled(env)) return null;
  const bySymbol = new Map();
  for (const row of universeRows(scored)) {
    const symbol = row?.sym || row?.symbol || null;
    if (symbol) bySymbol.set(symbol, row);
  }
  const screened = scoreLeapsUniverse(scored).map((row) => ({
    ...row,
    pillars: leapsPillarSnapshot(bySymbol.get(row.symbol)),
  }));
  const ranked = screened
    .filter((row) => row.gate === "pass" || row.gate === "watch")
    .sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0) || String(a.symbol).localeCompare(String(b.symbol)));
  const picks = [];
  const watch = [];
  for (const row of ranked) {
    if (row.gate === "pass" && picks.length < LEAPS_ROSTER_CAP) picks.push(row);
    else if (row.gate === "pass") watch.push({ ...row, gate: "watch", reason: "roster-cap" });
    else watch.push(row);
  }
  return {
    builtAtIso: opts.builtAtIso ?? null,
    mode: "score",
    contracts: false,
    weights: LEAPS_PILLAR_WEIGHTS,
    weightTotal: LEAPS_WEIGHT_TOTAL,
    minConviction: LEAPS_MIN_CONVICTION,
    callBuy: LEAPS_CALL_BUY,
    putBuy: LEAPS_PUT_BUY,
    prior: LEAPS_BULLISH_PRIOR,
    universeCount: screened.length,
    picks,
    watch,
  };
}

export async function publishLeapsScores(scored, opts = {}) {
  const payload = buildLeapsScorePayload(scored, opts);
  if (!payload) return { written: false, key: LEAPS_PICKS_KEY, payload: null };
  if (typeof opts.write !== "function") return { written: false, key: LEAPS_PICKS_KEY, payload };
  await opts.write(LEAPS_PICKS_KEY, payload);
  return { written: true, key: LEAPS_PICKS_KEY, payload };
}

// Null when the old contract switch is off: the caller writes nothing.
export function buildLeapsPicksPayload(scored, opts = {}) {
  const env = opts.env ?? process.env;
  if (!leapsScoreEnabled(env)) return null;
  const bySymbol = new Map();
  for (const row of universeRows(scored)) {
    const symbol = row?.sym || row?.symbol || null;
    if (symbol) bySymbol.set(symbol, row);
  }
  const screened = scoreLeapsUniverse(scored).map((row) => withListedContract(row, bySymbol.get(row.symbol), opts));
  const ranked = screened
    .filter((row) => row.gate === "pass" || row.gate === "watch")
    .sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0) || String(a.symbol).localeCompare(String(b.symbol)));
  const picks = [];
  const watch = [];
  for (const row of ranked) {
    if (row.gate === "pass" && picks.length < LEAPS_ROSTER_CAP) picks.push(row);
    else if (row.gate === "pass") watch.push({ ...row, gate: "watch", reason: "roster-cap" });
    else watch.push(row);
  }
  return {
    builtAtIso: opts.builtAtIso ?? null,
    weights: LEAPS_PILLAR_WEIGHTS,
    weightTotal: LEAPS_WEIGHT_TOTAL,
    minConviction: LEAPS_MIN_CONVICTION,
    callBuy: LEAPS_CALL_BUY,
    putBuy: LEAPS_PUT_BUY,
    contractRule: {
      minMonths: 9,
      maxMonths: 24,
      sides: ["call", "put"],
      delta: [LEAPS_DELTA_MIN, LEAPS_DELTA_MAX],
      otm: [LEAPS_OTM_MIN, LEAPS_OTM_MAX],
    },
    universeCount: screened.length,
    screened,
    picks,
    watch,
  };
}

export async function publishLeapsPicks(scored, opts = {}) {
  const payload = buildLeapsPicksPayload(scored, opts);
  if (!payload) return { written: false, key: LEAPS_PICKS_KEY, payload: null };
  const plan = planLeapsGrader({
    enabled: true,
    candidates: payload.screened,
    callsAlreadyToday: opts.callsAlreadyToday ?? 0,
    atReserve: opts.atReserve === true,
  });
  const graded = await runLeapsGrader(plan, opts.callModel);
  payload.grader = {
    ran: graded.ran === true,
    reason: plan.reason,
    calls: plan.run ? graded.results.length : 0,
    cap: LEAPS_GRADER_DAILY_CAP,
    skippedFirst: plan.skippedFirst === true,
  };
  if (typeof opts.write !== "function") return { written: false, key: LEAPS_PICKS_KEY, payload };
  await opts.write(LEAPS_PICKS_KEY, payload);
  return { written: true, key: LEAPS_PICKS_KEY, payload };
}

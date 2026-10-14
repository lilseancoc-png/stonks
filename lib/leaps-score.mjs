// LEAPS pillar reweight. Reads pillar scores the short-term engine already
// produced and never writes them back. Setups are not built yet, so the gate
// stays "unknown" and unknown never enters the LEAPS list.
//
// Roadmap v4 (Different pillar weights), mapped onto scoreTicker's pillars
// (CLAUDE.md Trend / Flow / Fundamentals / Narrative):
//   Narrative   narrative     1.5
//   Trend       technicals    1.25
//   Flow        mechanicals   1.25
//   Fundamentals fundamentals 0.5
// Weighted sum / 4.5 keeps the input scale (100, 100, 100, 100 -> 100).

export const LEAPS_PICKS_KEY = "leaps-picks.json";

export const LEAPS_PILLAR_WEIGHTS = Object.freeze({
  narrative: 1.5,
  technicals: 1.25,
  mechanicals: 1.25,
  fundamentals: 0.5,
});

export const LEAPS_WEIGHT_TOTAL = Object.values(LEAPS_PILLAR_WEIGHTS)
  .reduce((sum, weight) => sum + weight, 0);

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

// Default off. The bake's one-line switch is LEAPS_SCORE_ENABLED = leapsScoreEnabled().
export function leapsScoreEnabled(env = process.env) {
  return env?.LEAPS_SCORE === "1";
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

// Story ignition, Upstream tailwind, or Quiet accumulation, and no Exhaustion.
// Those checklists do not exist yet. Unknown is never a pass.
export function leapsSetupGate(_row) {
  return "unknown";
}

function universeRows(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.scored)) return input.scored;
  if (input?.grades && typeof input.grades === "object" && !Array.isArray(input.grades)) {
    return Object.values(input.grades);
  }
  return [];
}

// Every scored name. No top-N cut.
export function scoreLeapsUniverse(input) {
  return universeRows(input).map((row) => {
    const pillars = copyPillars(row);
    return {
      symbol: row?.sym || row?.symbol || null,
      score: scoreLeapsPillars(pillars),
      gate: leapsSetupGate(row),
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

// Null when the switch is off: the caller writes nothing.
export function buildLeapsPicksPayload(scored, opts = {}) {
  const env = opts.env ?? process.env;
  if (!leapsScoreEnabled(env)) return null;
  const screened = scoreLeapsUniverse(scored);
  const picks = screened.filter((row) => row.gate === "pass");
  return {
    builtAtIso: opts.builtAtIso ?? null,
    weights: LEAPS_PILLAR_WEIGHTS,
    weightTotal: LEAPS_WEIGHT_TOTAL,
    universeCount: screened.length,
    screened,
    picks,
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

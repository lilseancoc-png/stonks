// Pure helpers for the bake's AI call budget. No I/O, no model calls.
//
// Cache-miss labels describe why attachTickerJudgments did not reuse a prior
// ticker judgment. They do not decide reuse — that predicate stays in
// scripts/build.mjs. Priority when several rules fail together:
// no-cache, fundamentals-changed, price-drift, news-count, material-headline, other.

export const TICKER_JUDGMENT_MISS_REASONS = Object.freeze([
  "no-cache",
  "fundamentals-changed",
  "price-drift",
  "news-count",
  "material-headline",
  "other",
]);

// Typical Top Picks bake that actually grades: up to 10 names × (search + final
// grade) ≈ 20 thesis calls, plus ≈ 20 contract/guidance extractions.
export const AI_PICK_LEVEL_RESERVE_CALLS_DEFAULT = 20 + 20;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitJudgmentMeta(metaSig) {
  if (typeof metaSig !== "string") return null;
  const idx = metaSig.lastIndexOf("|");
  if (idx <= 0) return null;
  const fund = metaSig.slice(idx + 1);
  if (!/^[0-9a-f]{12}$/.test(fund)) return null;
  return { prefix: metaSig.slice(0, idx), fund };
}

function currentFundHash(fundHash, metaSig) {
  if (typeof fundHash === "string" && /^[0-9a-f]{12}$/.test(fundHash)) return fundHash;
  return splitJudgmentMeta(metaSig)?.fund || null;
}

function absoluteDriftFraction(priorSpot, spot) {
  if (!(Number.isFinite(priorSpot) && priorSpot > 0 && Number.isFinite(spot))) return null;
  return Math.abs(spot - priorSpot) / priorSpot;
}

function freshHeadlineCount(priorTitles, titles) {
  if (!Array.isArray(priorTitles) || !Array.isArray(titles)) return null;
  const cached = new Set(priorTitles);
  return titles.filter((title) => !cached.has(title)).length;
}

// Mirrors the reuse predicate in attachTickerJudgments. A true result means
// the bake keeps the cached judgment. driftLimit is a fraction (0.02 = 2%).
export function tickerJudgmentWouldReuse({
  prior,
  spot,
  sig,
  metaSig,
  titles,
  driftLimit,
  newsTolerance,
  materialFresh = 0,
} = {}) {
  if (!prior || !prior.news) return false;
  const limit = finiteNumber(driftLimit);
  const drift = absoluteDriftFraction(prior.spot, spot);
  const spotOk = drift != null && limit != null && drift <= limit;
  if (!spotOk) return false;
  if (prior.sig === sig) return true;
  const tolerance = Math.max(0, finiteNumber(newsTolerance) ?? 0);
  if (!(tolerance > 0 && prior.metaSig === metaSig && Array.isArray(prior.titles) && Array.isArray(titles))) {
    return false;
  }
  const freshCount = freshHeadlineCount(prior.titles, titles);
  const material = Math.max(0, finiteNumber(materialFresh) ?? 0);
  return freshCount != null && freshCount <= tolerance && material === 0;
}

/**
 * Why a cached ticker judgment was not reused.
 * Returns null when tickerJudgmentWouldReuse would keep the entry.
 * driftPct is the absolute percent move (3.5 means 3.5%), or null when the
 * two spots cannot be compared.
 */
export function classifyTickerJudgmentMiss(input = {}) {
  if (tickerJudgmentWouldReuse(input)) return null;
  const prior = input.prior;
  const drift = prior ? absoluteDriftFraction(prior.spot, input.spot) : null;
  const driftPct = drift == null ? null : drift * 100;
  if (!prior || !prior.news) return { reason: "no-cache", driftPct };

  const priorMeta = splitJudgmentMeta(prior.metaSig);
  const fund = currentFundHash(input.fundHash, input.metaSig);
  if (priorMeta && fund && priorMeta.fund !== fund) {
    return { reason: "fundamentals-changed", driftPct };
  }

  const limit = finiteNumber(input.driftLimit);
  if (drift != null && limit != null && drift > limit) {
    return { reason: "price-drift", driftPct };
  }

  const currentMeta = splitJudgmentMeta(input.metaSig);
  const metaMatch = prior.metaSig === input.metaSig;
  if (priorMeta && currentMeta && priorMeta.prefix !== currentMeta.prefix) {
    return { reason: "other", driftPct };
  }

  const tolerance = Math.max(0, finiteNumber(input.newsTolerance) ?? 0);
  const freshCount = freshHeadlineCount(prior.titles, input.titles);
  const material = Math.max(0, finiteNumber(input.materialFresh) ?? 0);
  if (metaMatch && freshCount != null && freshCount > tolerance) {
    return { reason: "news-count", driftPct };
  }
  if (metaMatch && freshCount != null && material > 0 && freshCount <= tolerance) {
    return { reason: "material-headline", driftPct };
  }
  return { reason: "other", driftPct };
}

export function formatTickerJudgmentMiss(miss) {
  if (!miss || !miss.reason) return "other";
  if (miss.reason === "price-drift" && Number.isFinite(miss.driftPct)) {
    return `price-drift ${miss.driftPct.toFixed(2)}%`;
  }
  return miss.reason;
}

export function summarizeTickerJudgmentMisses(reasons) {
  const counts = Object.fromEntries(TICKER_JUDGMENT_MISS_REASONS.map((reason) => [reason, 0]));
  const list = reasons instanceof Map ? [...reasons.values()] : (Array.isArray(reasons) ? reasons : []);
  for (const item of list) {
    const reason = typeof item === "string" ? item : item?.reason;
    if (Object.prototype.hasOwnProperty.call(counts, reason)) counts[reason] += 1;
    else counts.other += 1;
  }
  return TICKER_JUDGMENT_MISS_REASONS.map((reason) => `${reason} ${counts[reason]}`).join(", ");
}

/**
 * Call-budget gate above the hard daily cap.
 *
 * Tiers:
 * - "judgment": per-ticker re-judgments. Stop once the calls still sitting
 *   above the narrative/Brief reserve have shrunk to the pick-level budget.
 * - "pick": Top Picks research and final grader. May
 *   spend that pick-level budget. Still stop at the narrative/Brief reserve.
 * - "bulk": charts and universe-wide signal extraction. Stop alongside
 *   re-judgments so earlier passes cannot spend the final-grading reserve.
 * - "reserved": market narratives and the Brief. The reserves do not apply;
 *   the hard cap does, in the caller.
 *
 * Returns true when this caller should be refused. A non-positive cap, or a
 * zero reserve, disables that reserve. Never throws.
 */
export function aiTierReserveBlocks(used, cap, narrativeReserve, pickReserve, tier) {
  const capN = finiteNumber(cap);
  if (capN == null || capN <= 0) return false;
  const usedN = Math.max(0, finiteNumber(used) ?? 0);
  const narrativeN = Math.max(0, finiteNumber(narrativeReserve) ?? 0);
  const pickN = Math.max(0, finiteNumber(pickReserve) ?? 0);
  if (tier === "reserved") return false;
  if (narrativeN > 0 && usedN >= Math.max(0, capN - narrativeN)) return true;
  if ((tier === "judgment" || tier === "bulk") && pickN > 0 && usedN >= Math.max(0, capN - narrativeN - pickN)) return true;
  return false;
}

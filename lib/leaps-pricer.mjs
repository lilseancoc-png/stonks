// Pure LEAPS contract pricer. No I/O.
//
// Prices a European call (or put) on each expiration inside a 9–24 month
// window. The strike is the one whose Black-Scholes delta matches a target in
// [0.20, 0.30] (default 0.25), found by a fixed-iteration bisection. Premium
// is today's theoretical value. Each contract is then revalued 6 months later
// at the same IV after a fixed set of underlying moves. A contract passes when
// the option value at the +35% move (puts: −35%) is at least 2× today's premium.
//
// Year fractions use a 365.25-day year, the same convention as lib/greeks.mjs.
// Dividend yield is zero. The normal CDF is the one in lib/greeks.mjs.

import { bsPrice, greeks } from "./greeks.mjs";

export const LEAPS_RISK_FREE_RATE = 0.04;
export const LEAPS_TARGET_DELTA = 0.25;
export const LEAPS_DELTA_MIN = 0.2;
export const LEAPS_DELTA_MAX = 0.3;
export const LEAPS_MIN_MONTHS = 9;
export const LEAPS_MAX_MONTHS = 24;
export const LEAPS_FORWARD_MONTHS = 6;
export const LEAPS_YEAR_DAYS = 365.25;
export const LEAPS_MIN_YEARS = LEAPS_MIN_MONTHS / 12;
export const LEAPS_MAX_YEARS = LEAPS_MAX_MONTHS / 12;
export const LEAPS_FORWARD_YEARS = LEAPS_FORWARD_MONTHS / 12;
export const LEAPS_TARGET_MOVE = 0.35;
export const LEAPS_PASS_MULTIPLE = 2;
export const LEAPS_MOVES = Object.freeze([0, 0.2, 0.35, 0.5]);
export const LEAPS_BISECTION_ITERS = 64;

const DAY_MS = 86400000;
const STRIKE_LO_MULT = 1e-8;
const STRIKE_HI_MULT = 1e8;
const DELTA_TOL = 1e-3;

function readSpot(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) return null;
  return value;
}

function readIv(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) return null;
  return value;
}

function readRate(value) {
  if (value === undefined) return LEAPS_RISK_FREE_RATE;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readSide(side) {
  if (side === undefined) return "call";
  if (typeof side !== "string") return null;
  const normalized = side.trim().toLowerCase();
  if (normalized === "call" || normalized === "put") return normalized;
  return null;
}

function readTargetDelta(value) {
  if (value === undefined) return LEAPS_TARGET_DELTA;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude < LEAPS_DELTA_MIN || magnitude > LEAPS_DELTA_MAX) return null;
  return magnitude;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// UTC calendar day. Date objects use their UTC Y-M-D; strings must be YYYY-MM-DD.
function utcDayNumber(value) {
  let year;
  let month;
  let day;
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) return null;
    year = value.getUTCFullYear();
    month = value.getUTCMonth();
    day = value.getUTCDate();
  } else if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  } else {
    return null;
  }
  if (!Number.isInteger(year) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month, day);
  if (!Number.isFinite(utc)) return null;
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) {
    return null;
  }
  return {
    day: Math.round(utc / DAY_MS),
    label: `${String(year).padStart(4, "0")}-${pad2(month + 1)}-${pad2(day)}`,
  };
}

function parseExpiration(raw, asOf) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return { days: raw, expiration: raw };
  }
  if (asOf == null) return null;
  const exp = utcDayNumber(raw);
  if (!exp) return null;
  return { days: exp.day - asOf.day, expiration: exp.label };
}

// "short" cannot be rolled forward 6 months. "skip" is outside 9–24 months
// but still has time left after that roll. "in" is priced.
function classifyTenor(years) {
  if (!Number.isFinite(years)) return "bad";
  if (years < LEAPS_FORWARD_YEARS) return "short";
  if (years < LEAPS_MIN_YEARS || years > LEAPS_MAX_YEARS) return "skip";
  return "in";
}

function deltaOf(side, spot, strike, years, iv, rate) {
  const row = greeks(side, spot, strike, years, iv, rate);
  if (!row || typeof row.delta !== "number" || !Number.isFinite(row.delta)) return null;
  return row.delta;
}

// Exactly 2× today's premium counts as a double. A non-positive or
// non-finite premium cannot be scored and returns null.
export function leapsDoubles(value, premium) {
  if (typeof value !== "number" || typeof premium !== "number") return null;
  if (!Number.isFinite(value) || !Number.isFinite(premium) || !(premium > 0)) return null;
  return value >= LEAPS_PASS_MULTIPLE * premium;
}

// Bounded bisection. Call delta and put delta both fall as the strike rises,
// so one comparison covers both sides. The loop always runs exactly
// LEAPS_BISECTION_ITERS times when the target sits inside the strike bracket.
export function solveLeapsStrike(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return null;
  const spot = readSpot(input.spot);
  const iv = readIv(input.iv);
  const rate = readRate(input.rate);
  const side = readSide(input.side);
  const targetAbs = readTargetDelta(input.targetDelta);
  const years = input.years;
  if (spot == null || iv == null || rate == null || side == null || targetAbs == null) return null;
  if (typeof years !== "number" || !Number.isFinite(years) || !(years > 0)) return null;

  const target = side === "put" ? -targetAbs : targetAbs;
  let lo = spot * STRIKE_LO_MULT;
  let hi = spot * STRIKE_HI_MULT;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo) || !(lo > 0)) return null;
  const deltaLo = deltaOf(side, spot, lo, years, iv, rate);
  const deltaHi = deltaOf(side, spot, hi, years, iv, rate);
  if (deltaLo == null || deltaHi == null) return null;
  if (!(deltaLo >= target && deltaHi <= target)) return null;

  for (let i = 0; i < LEAPS_BISECTION_ITERS; i++) {
    const mid = lo + (hi - lo) / 2;
    const midDelta = deltaOf(side, spot, mid, years, iv, rate);
    if (midDelta == null) return null;
    if (midDelta > target) lo = mid;
    else hi = mid;
  }

  const strike = lo + (hi - lo) / 2;
  if (!Number.isFinite(strike) || !(strike > 0)) return null;
  const delta = deltaOf(side, spot, strike, years, iv, rate);
  if (delta == null || Math.abs(delta - target) > DELTA_TOL) return null;
  return { strike, delta, iterations: LEAPS_BISECTION_ITERS };
}

function priceOne(ctx, item) {
  const solved = solveLeapsStrike({
    spot: ctx.spot,
    iv: ctx.iv,
    years: item.years,
    side: ctx.side,
    rate: ctx.rate,
    targetDelta: ctx.targetDelta,
  });
  if (!solved) return null;

  const premium = bsPrice(ctx.side, ctx.spot, solved.strike, item.years, ctx.iv, ctx.rate);
  if (typeof premium !== "number" || !Number.isFinite(premium) || !(premium > 0)) return null;

  const yearsLeft = item.years - LEAPS_FORWARD_YEARS;
  if (!Number.isFinite(yearsLeft) || !(yearsLeft > 0)) return null;

  const scenarios = [];
  for (const magnitude of LEAPS_MOVES) {
    const signed = ctx.side === "put" ? -magnitude : magnitude;
    const move = signed === 0 ? 0 : signed;
    const futureSpot = ctx.spot * (1 + move);
    if (!Number.isFinite(futureSpot) || !(futureSpot > 0)) return null;
    const value = bsPrice(ctx.side, futureSpot, solved.strike, yearsLeft, ctx.iv, ctx.rate);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    const pctChange = ((value - premium) / premium) * 100;
    if (!Number.isFinite(pctChange)) return null;
    scenarios.push({
      move,
      spot: futureSpot,
      years: yearsLeft,
      value,
      pctChange,
    });
  }

  let targetScenario = null;
  for (const row of scenarios) {
    if (Math.abs(Math.abs(row.move) - LEAPS_TARGET_MOVE) <= 1e-12) targetScenario = row;
  }
  if (!targetScenario) return null;
  const passes = leapsDoubles(targetScenario.value, premium);
  if (typeof passes !== "boolean") return null;
  const multiple = targetScenario.value / premium;
  if (!Number.isFinite(multiple)) return null;

  return {
    side: ctx.side,
    spot: ctx.spot,
    iv: ctx.iv,
    rate: ctx.rate,
    targetDelta: ctx.targetDelta,
    delta: solved.delta,
    expiration: item.expiration,
    asOf: ctx.asOf,
    days: item.days,
    years: item.years,
    strike: solved.strike,
    premium,
    iterations: solved.iterations,
    scenarios,
    targetMove: LEAPS_TARGET_MOVE,
    targetValue: targetScenario.value,
    multiple,
    passes,
  };
}

// Keep quotes whose pass flag matches `mode` ("pass" or "fail").
export function filterLeaps(quotes, mode = "pass") {
  if (!Array.isArray(quotes)) return null;
  if (mode !== "pass" && mode !== "fail") return null;
  const kept = [];
  for (const quote of quotes) {
    if (!quote || typeof quote !== "object" || typeof quote.passes !== "boolean") return null;
    if (quote.passes === (mode === "pass")) kept.push(quote);
  }
  return kept;
}

// Price every in-window expiration. Returns null on a bad input, an empty
// array when every expiration is outside the window but still at least 6
// months out, and one quote per expiration inside the window.
export function priceLeaps(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return null;
  const spot = readSpot(input.spot);
  const iv = readIv(input.iv);
  const rate = readRate(input.rate);
  const side = readSide(input.side);
  const targetDelta = readTargetDelta(input.targetDelta);
  if (spot == null || iv == null || rate == null || side == null || targetDelta == null) return null;
  if (!Array.isArray(input.expirations)) return null;

  let asOf = null;
  if (input.asOf !== undefined) {
    asOf = utcDayNumber(input.asOf);
    if (!asOf) return null;
  }

  const items = [];
  for (const raw of input.expirations) {
    const parsed = parseExpiration(raw, asOf);
    if (!parsed) return null;
    const years = parsed.days / LEAPS_YEAR_DAYS;
    const kind = classifyTenor(years);
    if (kind === "bad" || kind === "short") return null;
    if (kind === "skip") continue;
    items.push({ ...parsed, years });
  }

  const ctx = {
    spot,
    iv,
    rate,
    side,
    targetDelta,
    asOf: asOf ? asOf.label : null,
  };
  const quotes = [];
  for (const item of items) {
    const quote = priceOne(ctx, item);
    if (!quote) return null;
    quotes.push(quote);
  }
  return quotes;
}

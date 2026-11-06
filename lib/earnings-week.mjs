// Earnings week ahead (2026-11-06): every covered report in the next 10 days,
// with the move options are pricing next to the stock's own past moves and
// this season's beat rate and reactions. Public payload: earnings-week.json.
//
// The Owner layer (earnings-week-plan.json, Owner-only) adds what the Top
// Picks event engine would do with each print, from the same earningsEventPlay
// rule the live engine runs (lib/event-play.mjs). No AI, no new fetches: every
// number comes from the chains and earnings history the bake already holds.
import { earningsEventPlay } from "./event-play.mjs";

export const EARNINGS_WEEK_VERSION = 1;
export const EARNINGS_WEEK_DAYS = 10;
export const EARNINGS_WEEK_HISTORY = 8;
// Implied vs typical move: options look "rich" when they price at least 15%
// more than the stock's average past move, "cheap" at 15% less or more below.
export const EARNINGS_WEEK_RICH = 1.15;
export const EARNINGS_WEEK_CHEAP = 0.85;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const pctPts = (frac) => (frac == null ? null : r1(frac * 100));

function addDaysIso(iso, days) {
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

// The stock's own record over its last `n` priced prints (moves as fractions).
export function pastEarningsMoves(earningsHx, n = EARNINGS_WEEK_HISTORY) {
  const events = (earningsHx?.events || []).filter((e) => num(e?.movePct) != null).slice(-n);
  if (!events.length) return { n: 0, avgAbsPct: null, up: 0, maxAbsPct: null, exceeded: 0, priced: 0, moves: [] };
  const abs = events.map((e) => Math.abs(e.movePct));
  let exceeded = 0, priced = 0;
  for (const e of events) {
    const im = num(e.impliedMovePct) ?? num(e.impliedMoveEstPct);
    if (im == null || !(im > 0)) continue;
    priced++;
    if (Math.abs(e.movePct) > im) exceeded++;
  }
  return {
    n: events.length,
    avgAbsPct: pctPts(abs.reduce((a, b) => a + b, 0) / abs.length),
    up: events.filter((e) => e.movePct > 0).length,
    maxAbsPct: pctPts(Math.max(...abs)),
    exceeded, priced,
    moves: events.map((e) => ({ date: e.date, movePct: pctPts(e.movePct) })),
  };
}

// "rich" | "cheap" | "in-line" | null: implied move against the typical move.
export function impliedVsHistory(impliedPct, avgAbsPct) {
  if (!(impliedPct > 0) || !(avgAbsPct > 0)) return null;
  const ratio = impliedPct / avgAbsPct;
  if (ratio >= EARNINGS_WEEK_RICH) return "rich";
  if (ratio <= EARNINGS_WEEK_CHEAP) return "cheap";
  return "in-line";
}

// This reporting season so far, across the covered universe: beat rate (EPS
// verdicts), the share of prints that fell the next session, and the average
// move. seasonKeyOf/verdictOf are build.mjs's earningsSeasonKey and
// earningsEpsVerdict, passed in so the rule stays single-sourced.
export function seasonSoFar(chains, todayIso, { seasonKeyOf, verdictOf, isFund } = {}) {
  const key = seasonKeyOf ? seasonKeyOf(todayIso) : null;
  let n = 0, beats = 0, misses = 0, epsKnown = 0, fell = 0, moved = 0, absSum = 0, sum = 0;
  for (const [sym, data] of Object.entries(chains || {})) {
    if (isFund && isFund(sym)) continue;
    for (const e of data?.earningsHx?.events || []) {
      if (!e?.date || e.date > todayIso || (key && seasonKeyOf(e.date) !== key)) continue;
      n++;
      const v = verdictOf ? verdictOf(e) : null;
      if (v) { epsKnown++; if (v === "beat") beats++; if (v === "miss") misses++; }
      const m = num(e.movePct);
      if (m != null) { moved++; absSum += Math.abs(m); sum += m; if (m < 0) fell++; }
    }
  }
  return {
    key, reported: n, epsKnown, beats, misses,
    beatRate: epsKnown ? Math.round((beats / epsKnown) * 1000) / 1000 : null,
    priced: moved,
    fellShare: moved ? Math.round((fell / moved) * 1000) / 1000 : null,
    avgAbsMovePct: moved ? pctPts(absSum / moved) : null,
    avgMovePct: moved ? pctPts(sum / moved) : null,
  };
}

// Public board. impliedMoveFor(data, date, session) returns { pct } (a
// fraction) or null; sessionsBetween(fromIso, toIso) counts trading sessions.
export function buildEarningsWeek(chains, {
  builtAtIso, todayIso, impliedMoveFor, sessionsBetween, seasonKeyOf, verdictOf, isFund, nameOf, sectorOf, days = EARNINGS_WEEK_DAYS,
} = {}) {
  const today = todayIso || String(builtAtIso || "").slice(0, 10);
  const end = addDaysIso(today, days);
  const rows = [];
  for (const [symbol, data] of Object.entries(chains || {})) {
    if (isFund && isFund(symbol)) continue;
    const f = data?.fundamentals || {};
    const date = typeof f.nextEarningsDate === "string" ? f.nextEarningsDate.slice(0, 10) : null;
    if (!date || date < today || (end && date > end)) continue;
    const session = f.nextEarningsSession || data?.earningsHx?.next?.session || "TBD";
    const stamped = num(data?.earningsHx?.next?.impliedMovePct);
    let implied = stamped;
    let impliedSource = stamped != null ? "stamped" : null;
    if (implied == null && impliedMoveFor) {
      try { const im = impliedMoveFor(data, date, session); if (im && num(im.pct) != null) { implied = im.pct; impliedSource = "chain"; } } catch { /* skip */ }
    }
    const past = pastEarningsMoves(data?.earningsHx);
    const impliedPct = pctPts(implied);
    rows.push({
      symbol,
      name: (nameOf && nameOf(symbol, data)) || f.name || symbol,
      sector: (sectorOf && sectorOf(symbol)) || f.sector || null,
      date, session,
      sessionsOut: sessionsBetween ? sessionsBetween(today, date) : null,
      spot: num(data?.spot),
      impliedMovePct: impliedPct,
      impliedSource,
      avgMovePct: past.avgAbsPct,
      maxMovePct: past.maxAbsPct,
      prints: past.n,
      upPrints: past.up,
      exceeded: past.exceeded,
      exceededOf: past.priced,
      vsHistory: impliedVsHistory(impliedPct, past.avgAbsPct),
      runInPct: pctPts(num(data?.earningsHx?.next?.pre10Pct)),
      ivPctile: num(data?.ivRank?.pctile),
      moves: past.moves,
    });
  }
  const sessionRank = { AM: 0, BMO: 0, TBD: 1, PM: 2, AMC: 2 };
  rows.sort((a, b) => a.date.localeCompare(b.date) || (sessionRank[a.session] ?? 1) - (sessionRank[b.session] ?? 1) || a.symbol.localeCompare(b.symbol));
  return {
    version: EARNINGS_WEEK_VERSION,
    builtAtIso,
    from: today, to: end, windowDays: days,
    season: seasonSoFar(chains, today, { seasonKeyOf, verdictOf, isFund }),
    rules: { history: EARNINGS_WEEK_HISTORY, rich: EARNINGS_WEEK_RICH, cheap: EARNINGS_WEEK_CHEAP },
    rows,
  };
}

// Owner layer: what the event engine would do with each print. grades is the
// build's grade index ({ sym: { side, total, conviction } }); engineSeason is
// the same recent-reaction read the live engine passes ({ n, negativeShare });
// openSymbols are names with an open Top Picks trade.
export function buildEarningsWeekPlan(board, chains, { grades, engineSeason, minConviction = 4, openSymbols = [] } = {}) {
  const open = new Set(openSymbols || []);
  const plans = {};
  for (const row of board?.rows || []) {
    const g = grades?.[row.symbol] || null;
    const side = g?.side || null;
    const conviction = num(g?.conviction);
    const base = { side, conviction: conviction == null ? null : Math.round(conviction * 10) / 10, openTrade: open.has(row.symbol) };
    if (!side || conviction == null || conviction < minConviction) {
      plans[row.symbol] = { ...base, action: "none", reason: side ? `grade ${base.conviction} is below the ${minConviction} bar, so no trade` : "no side from the grade, so no trade" };
      continue;
    }
    const play = earningsEventPlay({ side, earningsHx: chains?.[row.symbol]?.earningsHx, season: engineSeason, sessionsOut: row.sessionsOut, date: row.date, symbol: row.symbol });
    plans[row.symbol] = {
      ...base,
      action: play.ok ? "trade-through" : "wait",
      votes: play.votes || null,
      reason: play.reason,
    };
  }
  return { version: EARNINGS_WEEK_VERSION, builtAtIso: board?.builtAtIso || null, engineSeason: engineSeason ? { n: engineSeason.n ?? null, negativeShare: engineSeason.negativeShare ?? null } : null, plans };
}

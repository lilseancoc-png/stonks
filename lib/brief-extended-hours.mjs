// Extended-hours read for the market Brief.
//
// The 08:30 ET morning Brief and the 16:10 ET closing Brief run while the
// regular session is shut, so the baked per-ticker files only describe the
// last regular close. This module turns one batched Yahoo quote sweep into the
// part of the story that happens outside the bell: pre-market gaps before the
// open, after-hours moves after the close, and the earnings prints that drive
// most of both. Pure and dependency-free so the smoke test can feed it fixed
// quotes; the fetch lives in build.mjs.

export const BRIEF_EXT_MOVE_MIN_PCT = 2;
export const BRIEF_EXT_MOVERS_MAX = 5;
export const BRIEF_EXT_EARNINGS_MAX = 8;
export const BRIEF_EXT_INDEX_SYMS = [
  ["SPY", "S&P 500 (SPY)"],
  ["QQQ", "Nasdaq 100 (QQQ)"],
  ["IWM", "Russell 2000 (IWM)"],
];
// Extended-hours prints on a thin book can be wild. A move beyond this is
// treated as a bad print, not news.
const BRIEF_EXT_MAX_ABS_PCT = 60;

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

function etDateOf(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number"
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(value instanceof Date ? value.toISOString() : String(value));
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function isoDay(dateKey) {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

// The weekday before `todayEt` (Friday for a Monday). Exchange holidays are
// not modelled; a print on a holiday-shortened week simply falls outside it.
export function previousWeekdayKey(todayEt) {
  const ms = isoDay(todayEt);
  if (ms == null) return null;
  let d = new Date(ms - 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86400000);
  return d.toISOString().slice(0, 10);
}

export function extendedSessionForKind(kind) {
  if (kind === "morning") return "premarket";
  if (kind === "afternoon") return "afterhours";
  return null;
}

// The extended-hours move vs the last regular close, or null when the quote
// has no print from THIS extended session. Yahoo's own change percent is
// measured against the last regular close; the price math is the fallback.
export function quoteExtendedMove(q, session, todayEt) {
  if (!q || !session) return null;
  const pre = session === "premarket";
  const price = Number(pre ? q.preMarketPrice : q.postMarketPrice);
  if (!positive(price)) return null;
  const stamp = pre ? q.preMarketTime : q.postMarketTime;
  if (stamp != null && todayEt && etDateOf(stamp) !== todayEt) return null;
  // After hours only means something once today's regular session is the
  // reference close; a quote still carrying yesterday's close is stale.
  if (!pre && q.regularMarketTime != null && todayEt && etDateOf(q.regularMarketTime) !== todayEt) return null;
  const reported = Number(pre ? q.preMarketChangePercent : q.postMarketChangePercent);
  const base = Number(q.regularMarketPrice);
  let pct = null;
  if (Number.isFinite(reported)) pct = reported;
  else if (positive(base)) pct = ((price - base) / base) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > BRIEF_EXT_MAX_ABS_PCT) return null;
  return { pct: round2(pct), price: round2(price) };
}

// Every earnings date a baked ticker file knows about: the last stored print
// (with EPS when the store has it), the upcoming print, and the fundamentals
// date. A print can sit in any of the three depending on when the last bake
// ran relative to the announcement.
function earningsCandidates(d) {
  const out = [];
  const hx = d?.earningsHx;
  const events = Array.isArray(hx?.events) ? hx.events : [];
  const last = events.length ? events[events.length - 1] : null;
  if (last?.date) out.push(last);
  if (hx?.next?.date) out.push(hx.next);
  const f = d?.fundamentals;
  if (f?.nextEarningsDate) out.push({ date: String(f.nextEarningsDate).slice(0, 10), session: f.nextEarningsSession || "TBD" });
  return out;
}

function sessionOf(s) {
  const v = String(s || "").toUpperCase();
  if (v === "AM" || v === "BMO" || v.startsWith("BEFORE")) return "AM";
  if (v === "PM" || v === "AMC" || v.startsWith("AFTER")) return "PM";
  return "TBD";
}

// Names whose print lands in this extended session.
// premarket:  reported after the previous session's close, or before today's open.
// afterhours: reporting after today's close (or today with no confirmed time).
export function briefEarningsInWindow({ chains = {}, session, todayEt }) {
  if (!session || !todayEt) return [];
  const prevDay = previousWeekdayKey(todayEt);
  const out = [];
  for (const [sym, d] of Object.entries(chains || {})) {
    let hit = null;
    for (const c of earningsCandidates(d)) {
      const date = String(c.date).slice(0, 10);
      const sess = sessionOf(c.session);
      let when = null;
      if (session === "premarket") {
        if (date === todayEt && sess === "AM") when = "before today's open";
        else if (date === prevDay && sess === "PM") when = "after the last close";
        else if (date === prevDay && sess === "TBD") when = "last session, time not confirmed";
      } else if (date === todayEt) {
        if (sess === "PM") when = "after today's close";
        else if (sess === "TBD") when = "today, time not confirmed";
      }
      if (!when) continue;
      const eps = Number.isFinite(c.epsActual)
        ?{ epsActual: c.epsActual, epsEstimate: Number.isFinite(c.epsEstimate) ? c.epsEstimate : null, surprisePct: Number.isFinite(c.surprisePct) ? round2(c.surprisePct) : null }
        : null;
      if (!hit || (eps && !hit.epsActual)) hit = { sym, date, when, ...(eps || {}) };
    }
    if (hit) out.push(hit);
  }
  return out;
}

// Build the extended-hours block, or null when the session has no priced
// quotes (Yahoo down, holiday, or a brief kind with no extended session).
export function buildBriefExtendedHours({ kind, quotes = {}, chains = {}, todayEt, asOfIso = null } = {}) {
  const session = extendedSessionForKind(kind);
  if (!session) return null;
  const moveBySym = new Map();
  for (const [sym, q] of Object.entries(quotes || {})) {
    const m = quoteExtendedMove(q, session, todayEt);
    if (m) moveBySym.set(String(sym).toUpperCase(), m);
  }
  const earnings = briefEarningsInWindow({ chains, session, todayEt })
    .map((e) => {
      const m = moveBySym.get(e.sym);
      return m ? { ...e, chPct: m.pct } : { ...e, chPct: null };
    })
    // Priced reactions first (biggest first), then the still-pending prints.
    .sort((a, b) => Number(b.chPct != null) - Number(a.chPct != null) ||
      Math.abs(b.chPct ?? 0) - Math.abs(a.chPct ?? 0) || a.sym.localeCompare(b.sym))
    .slice(0, BRIEF_EXT_EARNINGS_MAX);
  if (!moveBySym.size) {
    // No quotes at all: still ship the earnings list so the prints are named,
    // but only when there is something to name.
    return earnings.length ? { session, asOfIso, priced: 0, indexes: [], movers: { gainers: [], losers: [] }, earnings } : null;
  }
  const indexes = [];
  const indexSet = new Set();
  for (const [sym, label] of BRIEF_EXT_INDEX_SYMS) {
    indexSet.add(sym);
    const m = moveBySym.get(sym);
    if (m) indexes.push({ sym, label, chPct: m.pct });
  }
  const single = [...moveBySym.entries()]
    .filter(([sym, m]) => !indexSet.has(sym) && chains[sym] && Math.abs(m.pct) >= BRIEF_EXT_MOVE_MIN_PCT)
    .map(([sym, m]) => ({ sym, chPct: m.pct }));
  const gainers = single.filter((m) => m.chPct > 0).sort((a, b) => b.chPct - a.chPct).slice(0, BRIEF_EXT_MOVERS_MAX);
  const losers = single.filter((m) => m.chPct < 0).sort((a, b) => a.chPct - b.chPct).slice(0, BRIEF_EXT_MOVERS_MAX);
  return { session, asOfIso, priced: moveBySym.size, indexes, movers: { gainers, losers }, earnings };
}

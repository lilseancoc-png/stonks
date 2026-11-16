// Strategy engines: earnings facts for one name at one point in time. Builds
// the `earn` view the Earnings and Reversion engines read and the
// fundamentals core the Fundamentals engine reads, from the site's stored
// report list (date, session, EPS actual / estimate, surprise, guidance) and
// the daily bars. Everything is measured from bars at or before the last
// confirmed session, so the live bake and the replay see the same thing.
//
// Pure. No network, no AI.

import { sessionBefore } from "./contracts.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (x == null || x === "" ? null : fin(Number(x)) ? Number(x) : null);
const pc = (x) => { const v = num(x); return v == null ? null : v * 100; };
const DAY = 86400000;

// Reports as a clean list, oldest first.
export function prepareReports(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const date = String(e?.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const actual = num(e.epsActual), est = num(e.epsEstimate);
    let surprise = num(e.surprisePct);
    if (surprise == null && actual != null && est != null && Math.abs(est) >= 0.1) surprise = ((actual - est) / Math.abs(est)) * 100;
    // A surprise on a near-zero estimate is noise (the flagship's rule too).
    if (est != null && Math.abs(est) < 0.1) surprise = null;
    out.push({
      date, session: e.session === "AM" || e.session === "PM" ? e.session : "TBD",
      epsActual: actual, epsEstimate: est, surprisePct: surprise, guidance: e.guidance || null,
      // The store keeps moves as fractions (0.05 = 5%); everything here is in
      // percent, like the numbers measured from bars below.
      movePct: pc(e.movePct), week1Pct: pc(e.week1Pct), pre10Pct: pc(e.pre10Pct),
      // The move options priced before the report (a straddle read stamped in
      // the final week, or the estimate from the IV drop for older reports).
      impliedPct: pc(e.impliedMovePct) ?? pc(e.impliedMoveEstPct),
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// First bar index with date >= d (lower bound).
function lowerBound(t, d) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < d) lo = mid + 1; else hi = mid; }
  return lo;
}
// The bar a report's reaction lands on: the report day for a before-the-open
// report, else the next session.
function reactionIndex(t, rep) {
  const i = lowerBound(t, rep.date);
  if (rep.session === "AM") return i;
  return i < t.length && t[i] === rep.date ? i + 1 : i;
}

const isWeekday = (ms) => { const d = new Date(ms).getUTCDay(); return d !== 0 && d !== 6; };
// Weekdays from `from` to `to` (0 when equal, negative when `to` is earlier).
export function weekdaysBetween(from, to) {
  let a = Date.parse(from + "T12:00:00Z"), b = Date.parse(to + "T12:00:00Z");
  if (!fin(a) || !fin(b)) return null;
  const sign = b >= a ? 1 : -1; if (sign < 0) [a, b] = [b, a];
  let n = 0;
  for (let ms = a + DAY; ms <= b; ms += DAY) if (isWeekday(ms)) n++;
  return n * sign;
}

// P: precomputed bars (lib/engines/features.mjs), i: last confirmed bar,
// reports: prepareReports() output, today: the decision date,
// next: { date, session } when the caller knows the next report (live).
export function earnView(P, i, reports, { today, next = null } = {}) {
  if (!P || !reports) return null;
  const { S } = P, t = S.t;
  let last = null; const hist = [];
  let upcoming = null;
  for (const rep of reports) {
    const r = reactionIndex(t, rep);
    if (r >= 1 && r <= i) {
      const prev = S.c[r - 1];
      const row = {
        date: rep.date, session: rep.session, surprisePct: rep.surprisePct, guidance: rep.guidance,
        epsActual: rep.epsActual, epsEstimate: rep.epsEstimate, impliedPct: rep.impliedPct,
        gapPct: (S.o[r] / prev - 1) * 100, movePct: (S.c[r] / prev - 1) * 100,
        low: S.l[r], high: S.h[r], close: S.c[r], prevClose: prev,
        volRatio: fin(S.v[r]) && P.vavg20[r - 1] > 0 ? S.v[r] / P.vavg20[r - 1] : null,
        week1Pct: r + 5 <= i ? (S.c[r + 5] / S.c[r] - 1) * 100 : null,
        pre10Pct: r - 11 >= 0 ? (S.c[r - 1] / S.c[r - 11] - 1) * 100 : rep.pre10Pct,
        sessionsSince: i - r,
      };
      if (last) hist.unshift(last);
      last = row;
    } else if (r < 1 || (t.length && rep.date < t[0])) {
      // Older than the bars on hand: the stored reaction facts stand in.
      const row = { date: rep.date, session: rep.session, surprisePct: rep.surprisePct, guidance: rep.guidance, epsActual: rep.epsActual, epsEstimate: rep.epsEstimate, movePct: rep.movePct, week1Pct: rep.week1Pct, pre10Pct: rep.pre10Pct, sessionsSince: null, stored: true };
      if (last) hist.unshift(last);
      last = row;
    } else if (!upcoming && today && rep.date >= today) {
      upcoming = { date: rep.date, session: rep.session };
    }
  }
  if (last?.stored) { hist.unshift(last); last = null; }
  const nx = next?.date && today && String(next.date).slice(0, 10) >= today ? { date: String(next.date).slice(0, 10), session: next.session === "AM" || next.session === "PM" ? next.session : "TBD" } : upcoming;
  let nextOut = null;
  if (nx && today) {
    const until = weekdaysBetween(today, nx.date);
    // The last day a trade that must not see the report may be held: the day
    // of an after-the-close report, else the session before.
    nextOut = { date: nx.date, session: nx.session, sessionsUntil: until, exitBy: nx.session === "PM" ? nx.date : sessionBefore(nx.date) };
  }
  return { last, hist, next: nextOut, reports: (last ? 1 : 0) + hist.length };
}

// The fundamentals core that can be replayed: EPS against the same quarter a
// year earlier, and the beat / miss count over the last four reports.
export function fundCore(earn) {
  if (!earn?.last) return null;
  const all = [earn.last, ...earn.hist];
  const yoy = (k) => {
    const a = all[k]?.epsActual, b = all[k + 4]?.epsActual;
    return fin(a) && fin(b) && Math.abs(b) >= 0.1 ? ((a - b) / Math.abs(b)) * 100 : null;
  };
  const four = all.slice(0, 4).map((r) => r.surprisePct).filter(fin);
  if (four.length < 3) return null;
  return {
    epsYoy: yoy(0), epsYoyPrev: yoy(1),
    beats4: four.filter((x) => x > 1).length, misses4: four.filter((x) => x < -1).length,
    reports: all.length, lastDate: earn.last.date, sessionsSince: earn.last.sessionsSince,
  };
}

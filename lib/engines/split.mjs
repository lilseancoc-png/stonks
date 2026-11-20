// Strategy engines: the stock split guard (2026-11-20).
//
// An engine trade keeps its entry price, stop and target in dollars of the day
// it opened. A stock split moves the tape by the split ratio overnight, so
// without this guard an 8-for-1 split marks a share trade at about -87% (and
// trips its stop), and an option's old strike prices near zero on the new
// tape. Sandisk (SNDK) split 8-for-1 at the open on 2026-11-20 while the
// Momentum basket held its shares; Top Picks has had the same guard since
// 2026-10 (scripts/build.mjs detectSplitFactor / applySplitToEntry).
//
// Detection, per open trade, before it is marked (never on the day of the
// trade's last mark: a split takes effect at an open, so an intraday move is
// always a real move):
//   0. Split calendar: Yahoo's daily chart lists the split itself
//      (`events.splits`, read by the same call as the history and kept on the
//      bars as `bars.splitEvents`). A listed split between the last mark and
//      today confirms its ratio when the gap is about that ratio.
//   1. The fresh spot has to sit about one standard split ratio away from
//      the trade's last mark (`lastSpot`).
//   2. History check: Yahoo back-adjusts its daily closes after a split, so
//      the close on the day of the last mark, divided into the last mark,
//      gives the ratio. When that matches the same ratio, it is a split even
//      if the stock also moved since the last mark (up to LOOSE_GAP).
//   3. Without that confirmation only an exact gap (GAP_TOL) of a ratio of 3
//      or more counts (a real one-day move of exactly -67%, -75% or -87.5% is
//      far less likely than a split; a -50% crash is not, so a 2-for-1 needs
//      the history). With no dated history at all, an exact gap counts for
//      every ratio, as in Top Picks.
// Rescaling divides every dollar level by the ratio and multiplies the share
// or contract count by it (what the OCC does to listed contracts), so the
// position's dollars and its % result do not move. The trade records it in
// `corpActions` like a Top Picks trade.
//
// Pure. No network.

export const SPLIT_RATIOS = Object.freeze([1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 20]);
export const GAP_TOL = 0.04;
export const LOOSE_GAP = 0.35;
export const CONFIRM_TOL = 0.1;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
const near = (a, b, tol) => Math.abs(a / b - 1) <= tol;
// The split ratio (or its inverse, a reverse split) within tol of r.
function ratioNear(r, tol) {
  for (const c of SPLIT_RATIOS) {
    if (near(r, c, tol)) return c;
    if (near(r, 1 / c, tol)) return 1 / c;
  }
  return null;
}
const big = (k) => Math.max(k, 1 / k) >= 3;

const r3 = (x) => Math.round(x * 1000) / 1000;
const day = (v) => {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : "";
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
  return String(v || "").slice(0, 10);
};

// The close on `date` (YYYY-MM-DD), or the last close before it. A bar dated
// `today` or later is never read: it is the live session, which already
// shows today's move.
function closeOn(bars, date, today) {
  if (!Array.isArray(bars) || !date) return null;
  let best = null;
  for (const b of bars) {
    const t = String(b?.t || b?.date || "").slice(0, 10), c = Number(b?.c);
    if (!t || !(c > 0) || t > date || (today && t >= today)) continue;
    if (!best || t > best.t) best = { t, c };
  }
  return best;
}

// The combined ratio of the splits Yahoo lists after `after` and on or before
// `today` ({ date, numerator, denominator } or splitRatio "8:1"), or null.
export function calendarFactor(splits, after, today) {
  if (!Array.isArray(splits) || !after) return null;
  let k = 1, any = false;
  for (const e of splits) {
    const d = day(e?.date);
    if (!d || d <= after || (today && d > today)) continue;
    let num = Number(e?.numerator), den = Number(e?.denominator);
    if (!(num > 0 && den > 0)) { const m = /^\s*([\d.]+)\s*[:/]\s*([\d.]+)\s*$/.exec(String(e?.splitRatio || "")); if (m) { num = Number(m[1]); den = Number(m[2]); } }
    if (!(num > 0 && den > 0) || num === den) continue;
    k *= num / den; any = true;
  }
  return any && k !== 1 ? k : null;
}

// The factor to divide the trade's dollar levels by (>1 forward split, <1
// reverse), or null. lastSpot / lastDate: the trade's last mark; spot: this
// run's price; bars: the name's daily history [{ t, c }] (its
// `splitEvents`, when present, is Yahoo's split list); today: this run's
// New York date.
export function engineSplitFactor({ lastSpot, lastDate, spot, bars, splits, today }) {
  const prev = Number(lastSpot), cur = Number(spot);
  if (!(prev > 0) || !(cur > 0)) return null;
  if (today && lastDate && String(lastDate).slice(0, 10) >= today) return null;
  const r = prev / cur;
  if (near(r, 1, 0.25)) return null;
  const cal = calendarFactor(splits ?? bars?.splitEvents ?? null, lastDate, today);
  if (cal) return near(r, cal, LOOSE_GAP) ? cal : null;
  const exact = ratioNear(r, GAP_TOL);
  const bar = closeOn(bars, lastDate, today);
  if (!bar) return exact;
  const hk = ratioNear(prev / bar.c, CONFIRM_TOL);
  if (hk && near(r, hk, LOOSE_GAP)) return hk;
  return exact && big(exact) ? exact : null;
}

// A move of 40% or more since the last mark, within 10% of a split ratio,
// that neither the calendar nor the history confirms yet: Yahoo usually
// catches up within a day, and marking it now would book the old prices on
// the new tape for good (the last mark moves to the new scale, so no later
// run would see the gap). The book holds such a trade unmarked (no exit
// fires) for up to splitHoldRuns() runs, then marks it as a real move:
// 4 runs (two sessions) for a ratio of 3 or more, where a real move that
// size is rare; 1 run for 1.5, 2 or 2.5, where a real crash is not. A gap
// that is no split ratio is never held, and neither is a move on the day
// of the last mark.
export const HOLD_RUNS = 4;
export function splitHoldRuns(lastSpot, spot, { lastDate, today } = {}) {
  const prev = Number(lastSpot), cur = Number(spot);
  if (!(prev > 0) || !(cur > 0)) return 0;
  if (today && lastDate && String(lastDate).slice(0, 10) >= today) return 0;
  const r = prev / cur;
  if (!(r >= 1 / 0.6 || r <= 0.6)) return 0;
  const k = ratioNear(r, CONFIRM_TOL);
  if (!k) return 0;
  return big(k) ? HOLD_RUNS : 1;
}
export const splitSuspect = (lastSpot, spot, o) => splitHoldRuns(lastSpot, spot, o) > 0;

// Rescale an engine trade (open or shadow) by a split factor k, in place.
export function applyEngineSplit(t, k, iso) {
  if (!t || !(k > 0) || k === 1) return t;
  const px = (v, d = r2) => (fin(Number(v)) && v !== null && v !== "" ? d(Number(v) / k) : v);
  const n = (v) => (fin(Number(v)) && v !== null ? Number(v) * k : v);
  for (const f of ["entrySpot", "lastSpot", "stopLevel", "targetLevel", "lastBid"]) if (t[f] != null) t[f] = px(t[f]);
  if (t.lastMid != null) t.lastMid = px(t.lastMid, r4);
  if (t.exitSpot != null) t.exitSpot = px(t.exitSpot);
  const c = t.contract;
  if (c) {
    for (const f of ["mid", "entryFill", "bid", "ask", "thetaDay"]) if (c[f] != null) c[f] = px(c[f], r4);
    // Three decimals: the OCC's adjusted strike (775 / 8 = 96.875).
    if (c.strike != null) c.strike = px(c.strike, r3);
    // A vertical's legs move with it (one leg each per spread: their own qty
    // stays ±1; the spread count below is what multiplies).
    if (Array.isArray(c.legs)) for (const l of c.legs) {
      if (!l) continue;
      if (l.strike != null) l.strike = px(l.strike, r3);
      for (const f of ["mid", "bid", "ask"]) if (l[f] != null) l[f] = px(l[f], r4);
    }
    if (c.structure === "shares") {
      // A share count can become fractional only for a 3:2 or 5:2 split;
      // four decimals keep the position's dollars exact.
      if (c.shares != null) c.shares = r4(n(c.shares));
      if (c.flatShares != null) c.flatShares = r4(n(c.flatShares));
    } else {
      // Contracts: the OCC turns one contract into k (whole-number splits).
      // A 3:2 or 5:2 split changes the deliverable instead; rounding keeps
      // the dollars within a contract and the trade is flagged for a look.
      const q = (v) => Math.max(1, Math.round(n(v)));
      const whole = Number.isInteger(k);
      c.qty = q(Number.isInteger(c.qty) && c.qty > 0 ? c.qty : 1);
      if (Number.isInteger(c.flatQty) && c.flatQty > 0) c.flatQty = q(c.flatQty);
      if (!whole) t.splitReview = "Non-standard split: Webull adjusts this contract's deliverable; check the position by hand.";
    }
  }
  if (t.fill) for (const f of ["entry", "entryMid", "exit"]) if (t.fill[f] != null) t.fill[f] = px(t.fill[f], r4);
  (t.corpActions ||= []).push({ type: "split", factor: r4(k), date: iso });
  return t;
}

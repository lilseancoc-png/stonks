// Strategy engines: the Fundamentals engine's standing rank (2026-11-16).
//
// Fundamentals change slowly, so the engine no longer waits for the three
// weeks after a report and scores one stock at a time. It keeps ONE rank of
// every covered stock on three things (earnings power, quality, price), holds
// calls on the best names and puts on the worst, and swaps a holding only
// when it leaves the top (or bottom) third.
//
// How a stock is placed:
//   - Up to eleven numbers, in three parts. Each number is turned into the
//     stock's place among the covered stocks that have it (0 = worst,
//     100 = best), so no single outlier can dominate.
//       Earnings power: EPS against a year earlier, beats minus misses in the
//         last four reports, whether growth is speeding up, the 30-day change
//         in the full-year EPS estimate, revenue growth.
//       Quality: operating margin, return on equity, free cash flow against
//         market value, debt against equity (less is better).
//       Price: forward P/E against its sector group's (lower is better), the
//         analysts' average target against the price.
//   - A part is the average of its numbers; the overall number is
//     40% earnings power, 30% quality, 30% price (over the parts on hand).
//   - A stock needs a beat record (three of its last four reports) to be
//     ranked at all. The history test has only the report numbers, so it
//     ranks on earnings power alone.
//
// "Standing": a stock's number is fixed until the calendar month changes or
// the stock reports again, so one day's quote cannot reshuffle the book.
//
// Pure. No network, no AI. Nothing here reads a Top Picks grade.

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);

export const RANK = Object.freeze({
  weights: Object.freeze({ earn: 0.4, quality: 0.3, price: 0.3 }),
  enter: 8,        // new trades come only from the 8 best (calls) and the 8 worst (puts)
  keepShare: 1 / 3, // a holding is kept while it stays in the top (or bottom) third
  minNames: 12,    // with fewer ranked names there is no rank to trade
  shown: 10,       // rows shown at each end on the page
});
export const RANK_SETUPS = Object.freeze({ call: "rank-top", put: "rank-bottom" });
export const isRankSetup = (s) => s === RANK_SETUPS.call || s === RANK_SETUPS.put;

const PARTS = Object.freeze({
  earn: ["epsYoy", "beats", "accel", "rev30", "revGrowth"],
  quality: ["margin", "roe", "fcfYield", "debt"],
  price: ["relPE", "upside"],
});

// The raw numbers for one stock, each turned so that higher is better.
export function rankMetrics(view) {
  const core = view?.fund?.core;
  if (!core || view.isEtf) return null;
  const x = view.fund.live || null, grpPE = view.fund.groupPE;
  const m = {
    epsYoy: fin(core.epsYoy) ? clamp(core.epsYoy, -100, 200) : null,
    beats: fin(core.beats4) && fin(core.misses4) ? core.beats4 - core.misses4 : null,
    accel: fin(core.epsYoy) && fin(core.epsYoyPrev) ? clamp(core.epsYoy - core.epsYoyPrev, -100, 100) : null,
    rev30: null, revGrowth: null, margin: null, roe: null, fcfYield: null, debt: null, relPE: null, upside: null,
  };
  if (m.beats == null) return null;
  if (x) {
    if (fin(x.fyEpsRevision?.pct30)) m.rev30 = x.fyEpsRevision.pct30;
    if (fin(x.revenueGrowthYoy)) m.revGrowth = x.revenueGrowthYoy;
    if (fin(x.operatingMargin)) m.margin = x.operatingMargin;
    if (fin(x.returnOnEquity)) m.roe = x.returnOnEquity;
    if (fin(x.freeCashFlow) && x.marketCap > 0) m.fcfYield = x.freeCashFlow / x.marketCap;
    if (fin(x.debtToEquity)) m.debt = -x.debtToEquity;
    // A forward loss (P/E at or under zero) counts as the most expensive.
    if (fin(x.forwardPE) && fin(grpPE) && grpPE > 0) m.relPE = x.forwardPE > 0 ? -Math.min(3, x.forwardPE / grpPE) : -3;
    if (fin(x.targetMeanPrice) && view.spot > 0) m.upside = x.targetMeanPrice / view.spot - 1;
  }
  return m;
}

// Fresh numbers for every stock on hand: { SYM: { score, e, q, p, report, facts } }.
export function scoreAll(views) {
  const raw = {};
  for (const [sym, view] of Object.entries(views || {})) { const m = rankMetrics(view); if (m) raw[sym] = m; }
  const syms = Object.keys(raw), place = {};
  for (const s of syms) place[s] = {};
  for (const key of Object.values(PARTS).flat()) {
    const have = syms.filter((s) => fin(raw[s][key]));
    if (have.length < 2) continue;
    for (const s of have) {
      const v = raw[s][key];
      let below = 0, same = 0;
      for (const o of have) { if (raw[o][key] < v) below++; else if (raw[o][key] === v) same++; }
      place[s][key] = ((below + 0.5 * same) / have.length) * 100;
    }
  }
  const out = {};
  for (const s of syms) {
    const part = {};
    for (const [name, keys] of Object.entries(PARTS)) {
      const vals = keys.map((k) => place[s][k]).filter(fin);
      part[name] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    if (part.earn == null) continue;
    let sum = 0, w = 0;
    for (const [name, wt] of Object.entries(RANK.weights)) if (part[name] != null) { sum += part[name] * wt; w += wt; }
    const core = views[s].fund.core, x = views[s].fund.live || {};
    out[s] = {
      score: r1(sum / w), e: r1(part.earn), q: r1(part.quality), p: r1(part.price),
      report: core.lastDate || null,
      facts: {
        epsYoy: r1(core.epsYoy), beats4: core.beats4, misses4: core.misses4,
        rev30: r1(x.fyEpsRevision?.pct30), revGrowth: r1(x.revenueGrowthYoy), margin: r1(x.operatingMargin),
        fwdPE: r1(x.forwardPE), groupPE: r1(views[s].fund.groupPE),
      },
    };
  }
  return out;
}

// Update the standing rank kept on the engine's state and return it ordered.
// A stock takes its fresh number when it has none yet, when its stored one is
// from an earlier calendar month, or when it has reported since. A stock with
// no fresh number this run keeps its stored one while it is still covered.
export function standRank(es, views, { today, coverage = null } = {}) {
  const fresh = scoreAll(views), prev = es.rank?.rows || {}, rows = {};
  const month = String(today).slice(0, 7);
  for (const [sym, row] of Object.entries(prev)) {
    if (coverage && !coverage.has(sym)) continue;
    rows[sym] = row;
  }
  let refreshed = 0;
  for (const [sym, f] of Object.entries(fresh)) {
    const old = rows[sym];
    if (!old || String(old.asOf || "").slice(0, 7) !== month || (f.report && f.report > String(old.report || ""))) { rows[sym] = { ...f, asOf: today }; refreshed++; }
  }
  const order = Object.keys(rows).sort((a, b) => rows[b].score - rows[a].score || (a < b ? -1 : 1));
  // New trades come from the 8 at each end, never from outside the third a
  // holding is kept in (matters only when few stocks are ranked).
  const n = order.length, keep = Math.ceil(n * RANK.keepShare), live = n >= RANK.minNames, enter = Math.min(RANK.enter, keep);
  order.forEach((sym, i) => {
    const rank = i + 1;
    rows[sym].rank = rank;
    rows[sym].zone = !live ? null : rank <= keep ? "top" : rank > n - keep ? "bottom" : "mid";
    rows[sym].enter = !live ? null : rank <= enter ? "call" : rank > n - enter ? "put" : null;
  });
  es.rank = { date: today, n, keep, enter, rows, refreshed: refreshed ? today : es.rank?.refreshed || null };
  return { n, keep, enter, live, order, rows };
}

// What the page shows: both ends of the rank, plus any name the engine holds.
export function rankView(es, held = []) {
  const rk = es?.rank; if (!rk?.rows) return null;
  const order = Object.keys(rk.rows).sort((a, b) => rk.rows[a].rank - rk.rows[b].rank);
  const heldSet = new Map(held.map((t) => [t.symbol, t.side]));
  const row = (sym) => { const r = rk.rows[sym]; return { symbol: sym, rank: r.rank, score: r.score, earn: r.e, quality: r.q, price: r.p, zone: r.zone, enter: r.enter, asOf: r.asOf, report: r.report, held: heldSet.get(sym) || null, facts: r.facts || null }; };
  const top = order.slice(0, RANK.shown), bottom = order.slice(-RANK.shown).filter((s) => !top.includes(s));
  const shown = new Set([...top, ...bottom]);
  return {
    date: rk.date, n: rk.n, keep: rk.keep, enter: rk.enter ?? RANK.enter, live: rk.n >= RANK.minNames, minNames: RANK.minNames,
    top: top.map(row), bottom: bottom.map(row), heldElsewhere: order.filter((s) => heldSet.has(s) && !shown.has(s)).map(row),
  };
}

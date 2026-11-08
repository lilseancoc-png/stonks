// Peer valuation band (2026-11-08, brainstorm F7).
//
// Each stock's trailing P/E, forward P/E, EV/sales and price/sales against
// (a) its own daily snapshots in data/fundamentals-history/<SYM>.json (one
// point per ET day, kept one rolling year, so the "own range" grows to a year
// and says how many sessions it covers) and (b) its peer group: the names in
// the same INDUSTRY_OF_TICKER sub-industry when at least VALUATION_MIN_PEERS
// others exist, else the same fine sector label, else the broad sector group.
// Pure; the bake writes the result as the public valuation-bands.json (the
// inputs are the public per-ticker fundamentals). Display only: the grade's
// own P/E comparison is unchanged.

export const VALUATION_BANDS_KEY = "valuation-bands.json";
export const VALUATION_BANDS_VERSION = 1;
export const VALUATION_MIN_PEERS = 4;
export const VALUATION_METRICS = Object.freeze([
  { key: "pe", label: "P/E (trailing)", max: 400 },
  { key: "fpe", label: "P/E (forward)", max: 400 },
  { key: "evs", label: "EV / sales", max: 200 },
  { key: "ps", label: "Price / sales", max: 200 },
]);

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() && Number.isFinite(Number(x)) ? Number(x) : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const usable = (x, max) => (Number.isFinite(x) && x > 0 && x <= max ? x : null);

// Enterprise value over revenue: market cap plus debt minus cash, over the
// trailing revenue. Null unless both the cap and the revenue are positive.
export function evToSales({ mcap, debt, cash, rev } = {}) {
  const m = num(mcap), r = num(rev);
  if (!(m > 0) || !(r > 0)) return null;
  const ev = m + Math.max(0, num(debt) || 0) - Math.max(0, num(cash) || 0);
  return ev > 0 ? ev / r : null;
}

// The four multiples from a per-ticker `fundamentals` block.
export function currentMetrics(f = {}) {
  return {
    pe: usable(num(f.trailingPE), 400),
    fpe: usable(num(f.forwardPE), 400),
    evs: usable(evToSales({ mcap: f.marketCap, debt: f.totalDebt, cash: f.totalCash, rev: f.revenue }), 200),
    ps: usable(num(f.priceToSales), 200),
  };
}

// The same four from one fundamentals-history point ({date, pe, fpe, ps, mcap, debt, cash, rev}).
export function historyMetrics(point = {}) {
  return {
    date: point.date,
    pe: usable(num(point.pe), 400),
    fpe: usable(num(point.fpe), 400),
    evs: usable(evToSales({ mcap: point.mcap, debt: point.debt, cash: point.cash, rev: point.rev }), 200),
    ps: usable(num(point.ps), 200),
  };
}

// Midrank percentile of x among values, 0..100.
export function percentileOf(values, x) {
  const xs = (values || []).filter((v) => Number.isFinite(v));
  if (!xs.length || !Number.isFinite(x)) return null;
  let below = 0, equal = 0;
  for (const v of xs) { if (v < x) below++; else if (v === x) equal++; }
  return r1(((below + equal / 2) / xs.length) * 100);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Range summary of a list of multiples; null with fewer than three values.
export function bandStats(values) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  return { n: xs.length, lo: r2(xs[0]), p25: r2(quantile(xs, 0.25)), median: r2(quantile(xs, 0.5)), p75: r2(quantile(xs, 0.75)), hi: r2(xs[xs.length - 1]) };
}

// Which names count as peers: the other tracked names in the same
// sub-industry when it holds at least `minPeers` names counting this stock,
// else the fine sector label, else the broad group. ETFs are never peers.
export function peerGroupFor(sym, { symbols = [], industries = {}, sectors = {}, groupOf = null, isEtf = null, minPeers = VALUATION_MIN_PEERS } = {}) {
  const stocks = symbols.filter((s) => s !== sym && !(isEtf && isEtf(s)));
  const enough = (members) => members.length + 1 >= minPeers;
  const ind = industries?.[sym];
  if (ind) {
    const members = stocks.filter((s) => industries?.[s] === ind);
    if (enough(members)) return { basis: "industry", label: ind, members };
  }
  const sec = sectors?.[sym];
  if (sec) {
    const members = stocks.filter((s) => sectors?.[s] === sec);
    if (enough(members)) return { basis: "sector", label: sec, members };
  }
  const group = typeof groupOf === "function" ? groupOf(sym) : null;
  if (group) {
    const members = stocks.filter((s) => (typeof groupOf === "function" ? groupOf(s) : null) === group);
    if (enough(members)) return { basis: "group", label: group, members };
  }
  return { basis: "none", label: ind || sec || group || null, members: [] };
}

// history: Map<sym, entries[]> (or a plain object) of fundamentals-history points.
export function buildValuationBands({ chains = {}, symbols = null, industries = {}, sectors = {}, groupOf = null, isEtf = null, history = null, builtAtIso = new Date().toISOString(), asOf = null, minPeers = VALUATION_MIN_PEERS } = {}) {
  const syms = (symbols || Object.keys(chains)).filter((s) => chains?.[s]?.fundamentals);
  const current = {};
  for (const s of syms) current[s] = currentMetrics(chains[s].fundamentals);
  const histOf = (s) => {
    if (!history) return [];
    const entries = history instanceof Map ? history.get(s) : history[s];
    return Array.isArray(entries) ? entries : [];
  };
  const rows = {};
  const groupsSeen = new Set();
  for (const s of syms) {
    if (isEtf && isEtf(s)) continue;
    const peers = peerGroupFor(s, { symbols: syms, industries, sectors, groupOf, isEtf, minPeers });
    if (peers.basis !== "none") groupsSeen.add(`${peers.basis}:${peers.label}`);
    const hist = histOf(s).map(historyMetrics);
    const row = { peers: { basis: peers.basis, label: peers.label, n: peers.members.length, members: peers.members } };
    let any = false;
    for (const m of VALUATION_METRICS) {
      const value = current[s][m.key];
      const ownVals = hist.map((h) => h[m.key]).filter((v) => Number.isFinite(v));
      const ownStats = bandStats(ownVals);
      const dates = hist.filter((h) => Number.isFinite(h[m.key]) && h.date).map((h) => h.date).sort();
      const peerVals = peers.members.map((p) => current[p]?.[m.key]).filter((v) => Number.isFinite(v));
      const peerStats = peerVals.length >= Math.min(minPeers, 3) ? bandStats(peerVals) : null;
      if (value == null && !ownStats && !peerStats) continue;
      any = true;
      row[m.key] = {
        value: r2(value),
        own: ownStats ? { ...ownStats, days: ownVals.length, from: dates[0] || null, to: dates[dates.length - 1] || null, pct: value != null ? percentileOf(ownVals, value) : null } : null,
        peers: peerStats ? { ...peerStats, pct: value != null ? percentileOf(peerVals, value) : null } : null,
      };
    }
    if (any) rows[s] = row;
  }
  return {
    version: VALUATION_BANDS_VERSION,
    builtAtIso,
    asOf: asOf || String(builtAtIso).slice(0, 10),
    minPeers,
    metrics: VALUATION_METRICS.map((m) => ({ key: m.key, label: m.label })),
    peerGroups: groupsSeen.size,
    rows,
    note: "Trailing and forward P/E and price/sales are Yahoo's figures; EV/sales adds total debt and subtracts cash. The own range covers the daily snapshots saved so far, up to one year. Peers are the other tracked names in the same sub-industry when it has at least four names, else the sector, else the broad group. Display only.",
  };
}

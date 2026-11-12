// R3 — Leveraged single-stock and sector ETF share-count flows.
//
// A leveraged ETF's creations and redemptions show up as changes in shares
// outstanding; shares × NAV approximates the dollars that moved. The bake
// already owns the verified product registry (LEVERAGED_ETF_SINGLES /
// LEVERAGED_ETF_GROUPS in build.mjs); this module takes those symbols plus a
// batched Yahoo quote (sharesOutstanding, navPrice, netAssets, price) and
// keeps 60 days of [date, sharesOut, nav, netAssets] per fund. Share counts
// on Yahoo update with a lag and are missing for some funds (all of them since
// November 2026), so a row with no share count estimates its flow from the
// net-asset change net of the NAV move instead (flowBasis "assets"). Once per ET day. Free.

import { finite, round, carried, errorText, upsertDated, fetchedToday } from "./util.mjs";

export const LEV_FLOWS_HISTORY_DAYS = 60;

export function levFundList(singles, groups) {
  const out = [];
  for (const [underlying, def] of Object.entries(singles || {})) {
    for (const side of ["bull", "bear"]) {
      const leg = def?.[side];
      if (leg?.sym) out.push({ sym: leg.sym, kind: "single", underlying, side, lev: leg.lev, label: `${underlying} ${leg.lev > 0 ? "+" : ""}${leg.lev}x` });
    }
  }
  for (const [key, def] of Object.entries(groups || {})) {
    for (const side of ["bull", "bear"]) {
      const leg = def?.[side];
      if (leg?.sym) out.push({ sym: leg.sym, kind: def.kind || "group", group: key, underlying: def.proxy || null, groupLabel: def.label, side, lev: leg.lev, label: `${def.label} ${leg.lev > 0 ? "+" : ""}${leg.lev}x` });
    }
  }
  return out;
}

export function quoteRead(q) {
  if (!q) return null;
  const shares = finite(q.sharesOutstanding);
  const nav = finite(q.navPrice) ?? finite(q.regularMarketPrice);
  const netAssets = finite(q.netAssets) ?? (shares != null && nav != null ? shares * nav : null);
  return {
    sharesOut: shares,
    nav: nav != null ? round(nav, 2) : null,
    price: finite(q.regularMarketPrice),
    netAssets: netAssets != null ? Math.round(netAssets) : null,
    volume: finite(q.regularMarketVolume),
    avgVolume: finite(q.averageDailyVolume3Month),
  };
}

// Dollar flow from net assets when Yahoo has no share count: today's net
// assets minus the older net assets grown by the NAV change over the window
// (what the fund would hold with no creations or redemptions). Needs both
// rows' net assets and NAV; anything missing is null, never zero.
export function assetFlowUsd(latest, older) {
  if (!latest || !older) return null;
  const a1 = latest[3], a0 = older[3], n1 = latest[2], n0 = older[2];
  if (![a1, a0, n1, n0].every(Number.isFinite) || !(a0 > 0) || !(n0 > 0) || !(n1 > 0)) return null;
  return Math.round(a1 - a0 * (n1 / n0));
}

export function flowsFrom(history) {
  const rows = (history || []).filter((r) => Array.isArray(r));
  const latest = rows[rows.length - 1];
  if (!latest) return {};
  const at = (n) => rows[rows.length - 1 - n] || null;
  const diff = (a, b) => (a && b && Number.isFinite(a[1]) && Number.isFinite(b[1]) ? a[1] - b[1] : null);
  const nav = Number.isFinite(latest[2]) ? latest[2] : null;
  const d1 = diff(latest, at(1));
  const d5 = diff(latest, at(5));
  const d20 = diff(latest, at(20));
  const assetsLatest = Number.isFinite(latest[3]) ? latest[3] : null;
  const assets5 = at(5) && Number.isFinite(at(5)[3]) ? at(5)[3] : null;
  // Share-count flows first; the net-asset estimate fills any window the
  // share counts cannot (Yahoo dropped sharesOutstanding for these funds in
  // November 2026, which left every flow empty).
  const usd = (d, n) => (d != null && nav != null ? Math.round(d * nav) : assetFlowUsd(latest, at(n)));
  const basis = d1 != null || d5 != null ? "shares" : (assetFlowUsd(latest, at(1)) != null ? "assets" : null);
  return {
    flowShares1d: d1 != null ? Math.round(d1) : null,
    flowShares5d: d5 != null ? Math.round(d5) : null,
    flowShares20d: d20 != null ? Math.round(d20) : null,
    flowUsd1d: usd(d1, 1),
    flowUsd5d: usd(d5, 5),
    flowUsd20d: usd(d20, 20),
    flowBasis: basis,
    sharesChg5dPct: d5 != null && at(5)[1] > 0 ? round((d5 / at(5)[1]) * 100, 1) : null,
    assetsChg5dPct: assetsLatest != null && assets5 > 0 ? round((assetsLatest / assets5 - 1) * 100, 1) : null,
  };
}

// Sum one flow field over one side; null when no fund on that side has it
// (a measured zero and "nothing measured" must not look alike).
export function sideTotal(rows, side, key) {
  const xs = (rows || []).filter((r) => r.side === side && Number.isFinite(r[key]));
  return xs.length ? Math.round(xs.reduce((a, r) => a + r[key], 0)) : null;
}

export async function fetchLevFlows({ prior, funds, todayEt, quoteFn, nowIso = new Date().toISOString() } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  if (typeof quoteFn !== "function" || !funds?.length) return carried(base, "no quote function", nowIso);
  try {
    const quotes = await quoteFn(funds.map((f) => f.sym));
    const byQuote = new Map();
    for (const q of Array.isArray(quotes) ? quotes : []) if (q?.symbol) byQuote.set(String(q.symbol).toUpperCase(), q);
    const rows = [];
    let withShares = 0;
    for (const f of funds) {
      const read = quoteRead(byQuote.get(f.sym));
      const hist = Array.isArray(base.rows?.find?.((r) => r.sym === f.sym)?.history) ? base.rows.find((r) => r.sym === f.sym).history : (Array.isArray(base.bySymbol?.[f.sym]?.history) ? base.bySymbol[f.sym].history : []);
      const history = read ? upsertDated(hist, [todayEt, read.sharesOut, read.nav, read.netAssets], LEV_FLOWS_HISTORY_DAYS) : hist;
      if (read?.sharesOut != null) withShares++;
      rows.push({ ...f, ...(read || { missing: true }), ...flowsFrom(history), history });
    }
    if (!rows.some((r) => !r.missing)) throw new Error("no quotes returned");
    const withFlow = rows.filter((r) => Number.isFinite(r.flowUsd1d) || Number.isFinite(r.flowUsd5d)).length;
    return {
      ok: true, stale: false, carriedForward: false, error: null,
      fetchedAt: nowIso, fetchedDate: todayEt, asOf: todayEt,
      withShares, withFlow, funds: rows.length,
      totals: { bullUsd5d: sideTotal(rows, "bull", "flowUsd5d"), bearUsd5d: sideTotal(rows, "bear", "flowUsd5d"), bullUsd1d: sideTotal(rows, "bull", "flowUsd1d"), bearUsd1d: sideTotal(rows, "bear", "flowUsd1d") },
      rows,
      note: "Creations and redemptions estimated from the change in shares outstanding times NAV (Yahoo Finance quote fields). Where Yahoo has no share count, the flow is estimated from net assets net of the NAV move (flowBasis \"assets\"); Yahoo's net assets can lag a day. A total is empty, not zero, when no fund on that side has a flow yet.",
    };
  } catch (err) {
    return carried(base, errorText(err), nowIso);
  }
}

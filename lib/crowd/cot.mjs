// O4 — CFTC Commitments of Traders, Traders in Financial Futures (futures only).
//
// Socrata dataset gpe5-46if on publicreporting.cftc.gov: one row per contract
// per week (Tuesday positions, published Friday 15:30 ET). Dealer / asset
// manager / leveraged fund / other reportable / non-reportable long and short
// contracts plus open interest. One query covers the tracked contracts over
// three years; once per ET day; 160 weeks kept per contract. Free, no key
// (anonymous Socrata reads are rate-limited but one query a day is fine).

import { fetchJson, finite, round, carried, errorText, fetchedToday, zScore, percentileRank, isoDay } from "./util.mjs";

export const COT_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
export const COT_WEEKS = 160;

// CFTC contract market codes. A code miss leaves that contract out (the
// query also carries the names so the first live build can be checked).
export const COT_CONTRACTS = Object.freeze([
  { id: "ES", code: "13874A", label: "E-mini S&P 500", match: /E-MINI S&P 500/i, exclude: /CONSOLIDATED|MICRO/i },
  { id: "NQ", code: "209742", label: "E-mini Nasdaq-100", match: /NASDAQ MINI|E-MINI NASDAQ/i, exclude: /CONSOLIDATED|MICRO/i },
  { id: "RTY", code: "239742", label: "E-mini Russell 2000", match: /RUSSELL E-MINI|E-MINI RUSSELL/i, exclude: /CONSOLIDATED|MICRO/i },
  { id: "VX", code: "1170E1", label: "VIX futures", match: /VIX FUTURES/i, exclude: /MINI/i },
  { id: "ZN", code: "043602", label: "10-year T-note", match: /UST 10Y NOTE|10-YEAR U\.S\. TREASURY/i, exclude: /ULTRA/i },
  { id: "ZT", code: "042601", label: "2-year T-note", match: /UST 2Y NOTE|2-YEAR U\.S\. TREASURY/i },
  { id: "DX", code: "098662", label: "US Dollar Index", match: /U\.?S\.? DOLLAR INDEX/i },
  { id: "6J", code: "097741", label: "Japanese yen", match: /JAPANESE YEN/i },
  { id: "6E", code: "099741", label: "Euro FX", match: /EURO FX/i, exclude: /CONSOLIDATED|CROSS/i },
]);

function net(row, longKey, shortKey) {
  const l = finite(row?.[longKey]);
  const s = finite(row?.[shortKey]);
  return l == null || s == null ? null : l - s;
}

export function cotRowRead(row) {
  return {
    date: isoDay(row?.report_date_as_yyyy_mm_dd),
    openInterest: finite(row?.open_interest_all),
    dealer: net(row, "dealer_positions_long_all", "dealer_positions_short_all"),
    assetMgr: net(row, "asset_mgr_positions_long", "asset_mgr_positions_short"),
    levFund: net(row, "lev_money_positions_long", "lev_money_positions_short"),
    other: net(row, "other_rept_positions_long", "other_rept_positions_short"),
    nonReport: net(row, "nonrept_positions_long_all", "nonrept_positions_short_all"),
    levLong: finite(row?.lev_money_positions_long),
    levShort: finite(row?.lev_money_positions_short),
    amLong: finite(row?.asset_mgr_positions_long),
    amShort: finite(row?.asset_mgr_positions_short),
  };
}

export function buildCotContract(def, rows) {
  const reads = rows.map(cotRowRead).filter((r) => r.date && r.openInterest != null).sort((a, b) => a.date.localeCompare(b.date));
  // Collapse duplicate report dates (the dataset occasionally carries a corrected row).
  const byDate = new Map();
  for (const r of reads) byDate.set(r.date, r);
  const list = [...byDate.values()].slice(-COT_WEEKS);
  if (!list.length) return null;
  const latest = list[list.length - 1];
  const prev = list[list.length - 2] || null;
  const levSeries = list.map((r) => r.levFund);
  const amSeries = list.map((r) => r.assetMgr);
  const pctOi = (v) => (v != null && latest.openInterest > 0 ? round((v / latest.openInterest) * 100, 1) : null);
  return {
    id: def.id,
    label: def.label,
    code: def.code,
    asOf: latest.date,
    openInterest: latest.openInterest,
    oiChange: prev ? latest.openInterest - prev.openInterest : null,
    groups: {
      dealer: { net: latest.dealer, change: prev ? latest.dealer - prev.dealer : null, pctOi: pctOi(latest.dealer) },
      assetMgr: { net: latest.assetMgr, change: prev ? latest.assetMgr - prev.assetMgr : null, pctOi: pctOi(latest.assetMgr), long: latest.amLong, short: latest.amShort, z3y: zScore(latest.assetMgr, amSeries.slice(0, -1)), pct3y: percentileRank(latest.assetMgr, amSeries.slice(0, -1)) },
      levFund: { net: latest.levFund, change: prev ? latest.levFund - prev.levFund : null, pctOi: pctOi(latest.levFund), long: latest.levLong, short: latest.levShort, z3y: zScore(latest.levFund, levSeries.slice(0, -1)), pct3y: percentileRank(latest.levFund, levSeries.slice(0, -1)) },
      other: { net: latest.other, change: prev ? latest.other - prev.other : null, pctOi: pctOi(latest.other) },
      nonReport: { net: latest.nonReport, change: prev ? latest.nonReport - prev.nonReport : null, pctOi: pctOi(latest.nonReport) },
    },
    // [date, levFundNet, assetMgrNet, dealerNet, openInterest]
    history: list.map((r) => [r.date, r.levFund, r.assetMgr, r.dealer, r.openInterest]),
  };
}

export async function fetchCot({ prior, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchJson } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  const since = new Date(Date.parse(`${todayEt}T00:00:00Z`) - (COT_WEEKS + 4) * 7 * 86400000).toISOString().slice(0, 10);
  const codes = COT_CONTRACTS.map((c) => `'${c.code}'`).join(",");
  const where = `report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000' AND cftc_contract_market_code in(${codes})`;
  const select = [
    "report_date_as_yyyy_mm_dd", "market_and_exchange_names", "cftc_contract_market_code", "open_interest_all",
    "dealer_positions_long_all", "dealer_positions_short_all", "asset_mgr_positions_long", "asset_mgr_positions_short",
    "lev_money_positions_long", "lev_money_positions_short", "other_rept_positions_long", "other_rept_positions_short",
    "nonrept_positions_long_all", "nonrept_positions_short_all",
  ].join(",");
  const url = `${COT_URL}?$select=${encodeURIComponent(select)}&$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd&$limit=5000`;
  try {
    const rows = await fetchImpl(url);
    if (!Array.isArray(rows) || !rows.length) throw new Error("no rows for the tracked contract codes");
    const contracts = {};
    const names = {};
    for (const def of COT_CONTRACTS) {
      let mine = rows.filter((r) => String(r?.cftc_contract_market_code || "").trim() === def.code);
      if (def.exclude) mine = mine.filter((r) => !def.exclude.test(String(r?.market_and_exchange_names || "")));
      if (!mine.length) continue;
      const built = buildCotContract(def, mine);
      if (built) {
        contracts[def.id] = built;
        names[def.id] = String(mine[mine.length - 1]?.market_and_exchange_names || "").trim();
      }
    }
    if (!Object.keys(contracts).length) throw new Error("rows returned but none matched a tracked contract");
    const asOf = Object.values(contracts).map((c) => c.asOf).sort().pop();
    return {
      ok: true, stale: false, carriedForward: false, error: null,
      fetchedAt: nowIso, fetchedDate: todayEt, asOf,
      names,
      contracts,
      note: "Tuesday positions published Friday 15:30 ET. Leveraged funds are hedge funds and CTAs; asset managers are pension / mutual funds; dealers are the sell side taking the other side. Net = long minus short contracts.",
    };
  } catch (err) {
    return carried(base, errorText(err), nowIso);
  }
}

// Company facts → compact first-filed rows (pure; shared by the collector and its check).
export const DAY0 = Date.UTC(2000, 0, 1);
export const dayNo = (iso) => Math.round((Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") - DAY0) / 86400000);

const FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT"]);
const FLOWS = {
  rev: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet"],
  gp: ["GrossProfit"],
  cor: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  op: ["OperatingIncomeLoss"],
  ni: ["NetIncomeLoss", "ProfitLoss"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
};
const STOCKS = {
  assets: ["Assets"],
  eq: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  liab: ["Liabilities"],
  debt: ["LongTermDebt", "LongTermDebtNoncurrent"],
};
const SINCE_END = "2004-01-01";
const okSpan = (d) => (d >= 80 && d <= 100) || (d >= 170 && d <= 190) || (d >= 260 && d <= 285) || (d >= 350 && d <= 380);

// Earliest filing of each period, across the tags in priority order.
export function firstFiled(gaap, tags, unit, flow) {
  const best = new Map();
  tags.forEach((tag, rank) => {
    for (const f of gaap?.[tag]?.units?.[unit] || []) {
      if (!FORMS.has(f.form) || !f.end || !f.filed || !Number.isFinite(f.val) || f.end < SINCE_END) continue;
      if (flow) { if (!f.start) continue; const d = dayNo(f.end) - dayNo(f.start); if (!okSpan(d)) continue; }
      else if (f.start) continue;
      const key = (flow ? f.start + "|" : "") + f.end, old = best.get(key);
      // The earliest filing wins (point in time); the tag order only breaks a tie.
      if (!old || f.filed < old.filed || (f.filed === old.filed && rank < old.rank)) best.set(key, { rank, start: f.start, end: f.end, filed: f.filed, val: f.val });
    }
  });
  const rows = [...best.values()].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : (a.start || "") < (b.start || "") ? -1 : 1));
  return rows.map((r) => (flow ? [dayNo(r.start), dayNo(r.end), dayNo(r.filed), r.val] : [dayNo(r.end), dayNo(r.filed), r.val]));
}
export function extract(j) {
  const gaap = j?.facts?.["us-gaap"], dei = j?.facts?.dei;
  if (!gaap) return null;
  const out = {};
  for (const [k, tags] of Object.entries(FLOWS)) { const rows = firstFiled(gaap, tags, "USD", true); if (rows.length) out[k] = rows; }
  for (const [k, tags] of Object.entries(STOCKS)) { const rows = firstFiled(gaap, tags, "USD", false); if (rows.length) out[k] = rows; }
  const wsh = firstFiled(gaap, ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"], "shares", true);
  if (wsh.length) out.wsh = wsh;
  const sh = firstFiled({ ...(gaap || {}), ...(dei || {}) }, ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], "shares", false);
  if (sh.length) out.sh = sh;
  // Earnings per share, as filed (dollars a share). Profit divided by it gives
  // a share count that does not depend on how a filer scaled its share tags
  // and that covers every share class.
  const eps = firstFiled(gaap, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares", true);
  if (eps.length) out.eps = eps;
  // A company with a real filing history: balance sheets and yearly profits.
  // (Banks often report no plain revenue tag; funds and trusts are dropped by industry code in the test.)
  if ((out.assets || []).length < 8 || annual(out.ni) < 2) return null;
  return out;
}
const annual = (rows) => (rows || []).filter((r) => r[1] - r[0] >= 350).length;
// Why a company's facts were not kept (for the collector's log).
export function whyDropped(j) {
  const gaap = j?.facts?.["us-gaap"];
  if (!gaap) return "no US GAAP facts (" + Object.keys(j?.facts || {}).join(",") + ")";
  const assets = firstFiled(gaap, STOCKS.assets, "USD", false).length, ni = firstFiled(gaap, FLOWS.ni, "USD", true);
  const tags = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "IncomeLossFromContinuingOperations"].filter((t) => gaap[t]).map((t) => t + ":" + Object.keys(gaap[t].units || {}).join("/") + ":" + Object.values(gaap[t].units || {}).reduce((n, rows) => n + rows.length, 0));
  return `assets ${assets}, profit rows ${ni.length} (yearly ${annual(ni)}), tags ${tags.join(" ") || "none"}`;
}

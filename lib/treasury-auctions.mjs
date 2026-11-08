// Treasury auction results (2026-11-08).
//
// The US Treasury's Fiscal Data API publishes every auction's result the day
// it happens: high yield, bid-to-cover, and how much went to primary dealers,
// direct bidders and indirect bidders (the foreign-and-fund demand read). It
// is a free official JSON API with no key, so the daily bake reads it once per
// ET day and keeps about two years of coupon auctions (notes, bonds, TIPS and
// floating-rate notes; bills are summarized separately) in a public file,
// `treasury-auctions.json`, for the Rates & dollar page. No AI, no scraping.
//
// Source: https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/
// Endpoint: /services/api/fiscal_service/v1/accounting/od/auctions_query

export const TREASURY_AUCTIONS_KEY = "treasury-auctions.json";
export const TREASURY_AUCTIONS_VERSION = 1;
export const TREASURY_AUCTIONS_KEEP = 400;
export const TREASURY_AUCTIONS_LOOKBACK_DAYS = 60;
export const TREASURY_AUCTIONS_API = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
// Weak-demand read: bid-to-cover at least this far under the term's trailing
// average, or dealers taking this many more points than usual.
export const AUCTION_WEAK_BTC_GAP = 0.15;
export const AUCTION_WEAK_DEALER_GAP = 4;
export const AUCTION_TRAIL_N = 6;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => {
  if (v == null || v === "" || v === "null") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

export const COUPON_TYPES = new Set(["Note", "Bond", "TIPS", "FRN"]);

// Fiscal Data query URL for the auctions since `sinceDate` (YYYY-MM-DD).
export function treasuryAuctionsUrl(sinceDate, { base = TREASURY_AUCTIONS_API, pageSize = 300 } = {}) {
  const fields = [
    "cusip", "security_type", "security_term", "auction_date", "issue_date", "maturity_date",
    "offering_amt", "total_accepted", "bid_to_cover_ratio", "high_yield", "high_discnt_rate", "high_investment_rate",
    "primary_dealer_accepted", "direct_bidder_accepted", "indirect_bidder_accepted", "comp_accepted", "noncomp_accepted",
    "announcemt_date", "reopening",
  ].join(",");
  const params = new URLSearchParams();
  params.set("fields", fields);
  if (sinceDate) params.set("filter", `auction_date:gte:${sinceDate}`);
  params.set("sort", "-auction_date");
  params.set("page[size]", String(pageSize));
  return `${base}?${params.toString()}`;
}

// Normalize the API's string columns into one compact row. Rows without a
// CUSIP or an auction date are dropped; a row whose results are not in yet
// (announced but not auctioned) keeps null results and `pending: true`.
export function parseTreasuryAuctionRows(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const cusip = String(raw.cusip || "").trim().toUpperCase();
    const date = String(raw.auction_date || "").slice(0, 10);
    if (!cusip || !DATE_RE.test(date)) continue;
    const type = String(raw.security_type || "").trim();
    const term = String(raw.security_term || "").trim();
    const accepted = num(raw.total_accepted);
    const dealers = num(raw.primary_dealer_accepted);
    const directs = num(raw.direct_bidder_accepted);
    const indirects = num(raw.indirect_bidder_accepted);
    const share = (part) => (part != null && accepted > 0 ? r2((part / accepted) * 100) : null);
    const btc = num(raw.bid_to_cover_ratio);
    // Bills quote a discount / investment rate, coupons a yield.
    const yld = num(raw.high_yield) ?? num(raw.high_investment_rate) ?? num(raw.high_discnt_rate);
    const row = {
      cusip, date, type, term,
      issue: DATE_RE.test(String(raw.issue_date || "").slice(0, 10)) ? String(raw.issue_date).slice(0, 10) : null,
      maturity: DATE_RE.test(String(raw.maturity_date || "").slice(0, 10)) ? String(raw.maturity_date).slice(0, 10) : null,
      offered: num(raw.offering_amt),
      accepted,
      btc: r3(btc),
      yield: yld != null ? r3(yld) : null,
      dealerPct: share(dealers),
      directPct: share(directs),
      indirectPct: share(indirects),
      reopening: /^(true|yes|y)$/i.test(String(raw.reopening || "")),
    };
    if (btc == null && accepted == null) row.pending = true;
    out.push(row);
  }
  return out;
}

export function emptyTreasuryAuctions() {
  return { v: TREASURY_AUCTIONS_VERSION, fetchedDate: null, updatedAt: null, source: { name: "US Treasury Fiscal Data", url: "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/" }, auctions: [] };
}

export function parseTreasuryAuctions(body) {
  if (body == null) return null;
  let parsed;
  try { parsed = typeof body === "string" ? JSON.parse(body) : body; } catch { return null; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.auctions)) return null;
  const out = emptyTreasuryAuctions();
  out.fetchedDate = DATE_RE.test(parsed.fetchedDate || "") ? parsed.fetchedDate : null;
  out.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
  out.auctions = parsed.auctions.filter((a) => a && a.cusip && DATE_RE.test(a.date || "")).map((a) => ({ ...a }));
  return out;
}

// Upsert by CUSIP + auction date (a reopening of the same CUSIP is a separate
// auction on a later date). Results replace a pending row. Keeps the newest N.
export function upsertTreasuryAuctions(prev, rows, { fetchedDate = null, now = new Date().toISOString() } = {}) {
  const state = prev && Array.isArray(prev.auctions) ? { ...emptyTreasuryAuctions(), ...prev, auctions: prev.auctions.slice() } : emptyTreasuryAuctions();
  const byKey = new Map(state.auctions.map((a) => [`${a.cusip}|${a.date}`, a]));
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.cusip || !DATE_RE.test(row.date || "")) continue;
    const key = `${row.cusip}|${row.date}`;
    const old = byKey.get(key);
    // Never let a pending (resultless) row overwrite stored results.
    if (old && row.pending && !old.pending) continue;
    byKey.set(key, { ...row });
  }
  state.auctions = [...byKey.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.term.localeCompare(b.term)))
    .slice(-TREASURY_AUCTIONS_KEEP);
  if (fetchedDate) state.fetchedDate = fetchedDate;
  state.updatedAt = now;
  return state;
}

export function treasuryAuctionsFetchedToday(state, today) {
  return !!(state && today && state.fetchedDate === today);
}

// Per-term demand read for the page: the latest completed auction of each
// coupon term against the trailing AUCTION_TRAIL_N auctions of the same term.
export function summarizeTreasuryAuctions(state, { today = null } = {}) {
  const all = (state?.auctions || []).filter((a) => !today || a.date <= today);
  const done = all.filter((a) => !a.pending && a.btc != null);
  const coupons = done.filter((a) => COUPON_TYPES.has(a.type));
  const terms = {};
  for (const a of coupons) (terms[a.term] ||= []).push(a);
  const byTerm = Object.entries(terms).map(([term, list]) => {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = list[list.length - 1];
    const trail = list.slice(Math.max(0, list.length - 1 - AUCTION_TRAIL_N), list.length - 1);
    const avg = (key) => {
      const vals = trail.map((a) => a[key]).filter((v) => Number.isFinite(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const btcAvg = avg("btc"), dealerAvg = avg("dealerPct"), indirectAvg = avg("indirectPct"), yieldPrev = trail.length ? trail[trail.length - 1].yield : null;
    const weakBtc = btcAvg != null && latest.btc != null && latest.btc <= btcAvg - AUCTION_WEAK_BTC_GAP;
    const weakDealer = dealerAvg != null && latest.dealerPct != null && latest.dealerPct >= dealerAvg + AUCTION_WEAK_DEALER_GAP;
    const strong = btcAvg != null && latest.btc != null && latest.btc >= btcAvg + AUCTION_WEAK_BTC_GAP && !weakDealer;
    return {
      term, type: latest.type, latest: { ...latest },
      trailN: trail.length,
      btcAvg: r2(btcAvg), dealerAvg: r2(dealerAvg), indirectAvg: r2(indirectAvg),
      btcGap: btcAvg != null && latest.btc != null ? r2(latest.btc - btcAvg) : null,
      yieldChange: yieldPrev != null && latest.yield != null ? r3(latest.yield - yieldPrev) : null,
      read: trail.length < 2 ? "collecting" : weakBtc || weakDealer ? "weak" : strong ? "strong" : "normal",
      // History for the bid-to-cover line, oldest first.
      history: list.map((a) => ({ d: a.date, btc: a.btc, y: a.yield, dealer: a.dealerPct, indirect: a.indirectPct })),
    };
  }).sort((a, b) => termSortKey(a.term) - termSortKey(b.term));
  const upcoming = (state?.auctions || []).filter((a) => a.pending && (!today || a.date >= today)).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 12);
  const bills = done.filter((a) => a.type === "Bill").slice(-8).map((a) => ({ d: a.date, term: a.term, btc: a.btc, y: a.yield }));
  const weak = byTerm.filter((t) => t.read === "weak").map((t) => t.term);
  return {
    asOf: done.length ? done[done.length - 1].date : null,
    n: done.length, couponN: coupons.length,
    byTerm, upcoming, bills,
    weak,
    headline: !byTerm.length ? "No coupon auction results yet."
      : weak.length ? `Soft demand at the last ${weak.join(", ")} auction${weak.length > 1 ? "s" : ""}: fewer bids per dollar or more left with dealers than the recent average.`
        : byTerm.some((t) => t.read === "strong") ? `Demand ran above its recent average at the last ${byTerm.filter((t) => t.read === "strong").map((t) => t.term).join(", ")} auction${byTerm.filter((t) => t.read === "strong").length > 1 ? "s" : ""}.`
          : "Recent coupon auctions drew their usual demand.",
  };
}

// "2-Year", "10-Year", "20-Year", "30-Year", "4-Week", "52-Week" → months.
export function termSortKey(term) {
  const m = /^(\d+)-(Year|Month|Week|Day)/i.exec(String(term || ""));
  if (!m) return 9999;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "year" ? n * 12 : unit === "month" ? n : unit === "week" ? n / 4.33 : n / 30;
}

#!/usr/bin/env node
// Offline checks for the 2026-11-08 recording bundle: Treasury auctions,
// option-implied borrow, chain put/call totals, credit ratios, daily macro
// levels, the run archive's quote-quality and grader-audit fields, and the
// EPS-revision shadow signals. No network, no writes outside a temp dir.
import assert from "node:assert/strict";
import {
  AUCTION_TRAIL_N, COUPON_TYPES, TREASURY_AUCTIONS_KEEP, TREASURY_AUCTIONS_KEY,
  emptyTreasuryAuctions, parseTreasuryAuctionRows, parseTreasuryAuctions, summarizeTreasuryAuctions,
  termSortKey, treasuryAuctionsFetchedToday, treasuryAuctionsUrl, upsertTreasuryAuctions,
} from "../lib/treasury-auctions.mjs";
import { chainPutCallTotals, impliedBorrowRate } from "../lib/market-structure.mjs";
import { CREDIT_RATIO_PAIRS, buildCreditRatios } from "../lib/historical-data.mjs";
import { MACRO_HISTORY_KEEP, VIX_RANK_WINDOW, macroLevelsFromBackdrop, macroLevelsLate, mergeMacroLevels } from "../lib/macro-levels.mjs";
import { buildPicksRunRecord } from "../lib/picks-run-archive.mjs";
import { SHADOW_KEYS, SHADOW_SIGNAL_VERSION, buildShadowSignals } from "../lib/shadow-signals.mjs";
import { OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";

let n = 0;
const ok = (label, cond) => { n++; if (!cond) { console.error(`✗ ${label}`); process.exit(1); } };

// ---- Treasury auctions ------------------------------------------------------
const url = treasuryAuctionsUrl("2026-09-01");
ok("auction url targets Fiscal Data", url.startsWith("https://api.fiscaldata.treasury.gov/") && url.includes("auction_date%3Agte%3A2026-09-01") && url.includes("bid_to_cover_ratio"));
const apiPayload = { data: [
  { cusip: "91282CAB1", security_type: "Note", security_term: "10-Year", auction_date: "2026-11-05", issue_date: "2026-11-16", maturity_date: "2036-11-15", offering_amt: "42000000000", total_accepted: "42000000012", bid_to_cover_ratio: "2.31", high_yield: "4.123", primary_dealer_accepted: "8400000000", direct_bidder_accepted: "7560000000", indirect_bidder_accepted: "26040000012", reopening: "No" },
  { cusip: "91282CAC9", security_type: "Note", security_term: "10-Year", auction_date: "2026-10-08", offering_amt: "39000000000", total_accepted: "39000000000", bid_to_cover_ratio: "2.55", high_yield: "4.050", primary_dealer_accepted: "5460000000", direct_bidder_accepted: "7800000000", indirect_bidder_accepted: "25740000000", reopening: "Yes" },
  { cusip: "91282CAD7", security_type: "Note", security_term: "10-Year", auction_date: "2026-09-10", offering_amt: "39000000000", total_accepted: "39000000000", bid_to_cover_ratio: "2.60", high_yield: "4.000", primary_dealer_accepted: "5070000000", direct_bidder_accepted: "7800000000", indirect_bidder_accepted: "26130000000", reopening: "No" },
  { cusip: "912797AA1", security_type: "Bill", security_term: "4-Week", auction_date: "2026-11-05", offering_amt: "95000000000", total_accepted: "95000000000", bid_to_cover_ratio: "2.9", high_discnt_rate: "4.21", high_investment_rate: "4.30" },
  { cusip: "912810ZZ0", security_type: "Bond", security_term: "30-Year", auction_date: "2026-11-12", announcemt_date: "2026-11-05", offering_amt: "25000000000", total_accepted: null, bid_to_cover_ratio: null, high_yield: null },
  { cusip: "", security_type: "Note", security_term: "2-Year", auction_date: "2026-11-01" },
  { cusip: "BADDATE1", security_type: "Note", security_term: "2-Year", auction_date: "not-a-date" },
] };
const rows = parseTreasuryAuctionRows(apiPayload);
ok("parse keeps rows with a cusip and a date", rows.length === 5);
const ten = rows.find((r) => r.cusip === "91282CAB1");
ok("parse normalizes numbers and shares", ten.btc === 2.31 && ten.yield === 4.123 && ten.dealerPct === 20 && ten.indirectPct === 62 && ten.directPct === 18 && ten.reopening === false);
ok("reopening flag parsed", rows.find((r) => r.cusip === "91282CAC9").reopening === true);
ok("bill falls back to investment rate", rows.find((r) => r.type === "Bill").yield === 4.3);
const pendingRow = rows.find((r) => r.cusip === "912810ZZ0");
ok("announced auction without results is pending", pendingRow.pending === true && pendingRow.btc == null);

let state = upsertTreasuryAuctions(null, rows, { fetchedDate: "2026-11-08", now: "2026-11-08T15:00:00.000Z" });
ok("upsert sorts oldest first and stamps the fetch date", state.auctions[0].date === "2026-09-10" && state.fetchedDate === "2026-11-08" && state.auctions.length === 5);
ok("fetched-today check", treasuryAuctionsFetchedToday(state, "2026-11-08") && !treasuryAuctionsFetchedToday(state, "2026-11-09"));
// A later pending copy must not erase stored results; a result replaces a pending row.
state = upsertTreasuryAuctions(state, [{ ...ten, pending: true, btc: null }], { fetchedDate: "2026-11-09" });
ok("pending row never overwrites results", state.auctions.find((a) => a.cusip === "91282CAB1").btc === 2.31);
state = upsertTreasuryAuctions(state, [{ ...pendingRow, pending: false, btc: 2.2, yield: 4.6, dealerPct: 15, indirectPct: 70, accepted: 25e9 }], { fetchedDate: "2026-11-12" });
ok("result replaces the pending row", state.auctions.find((a) => a.cusip === "912810ZZ0").btc === 2.2 && !state.auctions.find((a) => a.cusip === "912810ZZ0").pending);
const many = Array.from({ length: TREASURY_AUCTIONS_KEEP + 20 }, (_, i) => ({ cusip: `C${i}`, date: `2020-01-${String(1 + (i % 28)).padStart(2, "0")}`, type: "Note", term: "2-Year", btc: 2.5 }));
ok("keeps the newest N auctions", upsertTreasuryAuctions(null, many).auctions.length === TREASURY_AUCTIONS_KEEP);
const roundTrip = parseTreasuryAuctions(JSON.stringify(state));
ok("file round-trips", roundTrip.auctions.length === state.auctions.length && roundTrip.fetchedDate === "2026-11-12");
ok("garbage parses to null", parseTreasuryAuctions("{") === null && parseTreasuryAuctions({ auctions: "x" }) === null);

const sm = summarizeTreasuryAuctions(state, { today: "2026-11-12" });
const tenY = sm.byTerm.find((t) => t.term === "10-Year");
ok("summary groups coupon terms", tenY && tenY.trailN === 2 && Math.abs(tenY.btcAvg - 2.58) < 1e-9);
ok("weak read: bid-to-cover 0.15+ under the trailing average", tenY.read === "weak" && sm.weak.includes("10-Year") && /Soft demand/.test(sm.headline));
ok("collecting read with fewer than two prior auctions", sm.byTerm.find((t) => t.term === "30-Year").read === "collecting");
ok("bills summarized apart from coupons", sm.bills.length === 1 && sm.couponN === 4 && COUPON_TYPES.has("TIPS"));
ok("history oldest first", tenY.history[0].d === "2026-09-10" && tenY.history.length === 3);
ok("term sort order", termSortKey("2-Year") < termSortKey("10-Year") && termSortKey("4-Week") < termSortKey("2-Year") && termSortKey("junk") === 9999);
ok("upcoming list only future pending rows", summarizeTreasuryAuctions(upsertTreasuryAuctions(null, rows), { today: "2026-11-08" }).upcoming.length === 1);
ok("empty state summary", summarizeTreasuryAuctions(emptyTreasuryAuctions()).headline.startsWith("No coupon"));
ok("auctions key is public and bake-optional", !isPremiumKey(TREASURY_AUCTIONS_KEY) && OPTIONAL_BAKE_KEYS.includes(TREASURY_AUCTIONS_KEY));
ok("trailing window constant sane", AUCTION_TRAIL_N === 6);

// ---- Option-implied borrow --------------------------------------------------
// Build a chain whose call/put mids satisfy parity with a known borrow rate.
const NOW = Date.parse("2026-11-09T15:00:00Z");
function expiryFor(days) {
  const d = new Date(NOW + days * 86400000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}
function parityChain(spot, r, q, borrow, dte, spreadAbs = 0.1) {
  const expSec = expiryFor(dte);
  const T = (expiryFor(dte) + 21 * 3600 - NOW / 1000) / 86400 / 365;
  const c = [], p = [];
  for (const k of [spot * 0.9, spot * 0.95, spot, spot * 1.05, spot * 1.1]) {
    const fwd = spot * Math.exp(-(q + borrow) * T) - k * Math.exp(-r * T); // C − P
    const put = 3 + Math.abs(k - spot) * 0.3, call = put + fwd;
    c.push({ s: k, b: call - spreadAbs / 2, a: call + spreadAbs / 2, iv: 0.4, oi: 100, v: 10 });
    p.push({ s: k, b: put - spreadAbs / 2, a: put + spreadAbs / 2, iv: 0.42, oi: 120, v: 15 });
  }
  return { spot, chains: { [expSec]: { c, p } } };
}
const hard = impliedBorrowRate(parityChain(50, 0.045, 0.01, 0.08, 62), 0.045, 1, NOW);
ok("implied borrow recovers an 8% borrow", hard && Math.abs(hard.ratePct - 8) < 0.3 && hard.hardToBorrow && hard.n === 3 && hard.dte >= 60 && hard.dte <= 64);
const easy = impliedBorrowRate(parityChain(200, 0.045, 0, 0.0, 45), 0.045, 0, NOW);
ok("easy-to-borrow name reads near zero", easy && Math.abs(easy.ratePct) < 0.3 && !easy.hardToBorrow && easy.noisePct > 0);
ok("no expiry in the 30–120 day window → null", impliedBorrowRate(parityChain(50, 0.045, 0, 0.05, 10), 0.045, 0, NOW) === null);
const oneSided = parityChain(50, 0.045, 0, 0.05, 60);
for (const row of Object.values(oneSided.chains)[0].p) row.b = 0;
ok("one-sided quotes are skipped", impliedBorrowRate(oneSided, 0.045, 0, NOW) === null);
ok("missing chain → null", impliedBorrowRate({ spot: 10 }, 0.045) === null && impliedBorrowRate(null) === null);

const pc = chainPutCallTotals(parityChain(50, 0.045, 0, 0, 60));
ok("put/call totals", pc.callOi === 500 && pc.putOi === 600 && pc.volRatio === 1.5 && pc.oiRatio === 1.2);
ok("put/call with no OI → null", chainPutCallTotals({ chains: { 1: { c: [{ s: 1 }], p: [] } } }) === null && chainPutCallTotals({}) === null);

// ---- Credit ratios -----------------------------------------------------------
function bars(start, days, fn) {
  const out = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ t: d.toISOString().slice(0, 10), c: fn(out.length) });
    t += 86400000;
  }
  return out;
}
const symbols = {
  HYG: bars("2007-04-11", 7300, (i) => 80 + Math.sin(i / 200) * 5),
  LQD: bars("2002-07-30", 9000, (i) => 110 + Math.cos(i / 300) * 6),
  IEF: bars("2002-07-30", 9000, (i) => 100 + (i % 500) / 100),
};
const cr = buildCreditRatios(symbols);
ok("credit ratios: two pairs documented", CREDIT_RATIO_PAIRS.length === 2 && cr.pairs.length === 2);
const hy = cr.pairs.find((p) => p.id === "HYG/IEF");
ok("HYG/IEF starts at the fund's first common session", hy.status === "ready" && hy.first === "2007-04-11" && hy.sessions > 4000);
ok("weekly series is far smaller than daily and ends on the last day", hy.series.length < hy.sessions / 4 && hy.series.at(-1)[0] === hy.asOf);
ok("percentile and z are finite", hy.percentile >= 0 && hy.percentile <= 100 && Number.isFinite(hy.z1y) && Number.isFinite(hy.chg20d));
ok("range position is 0..100", hy.range52Pct >= 0 && hy.range52Pct <= 100);
ok("missing fund → missing pair, no throw", buildCreditRatios({ HYG: symbols.HYG }).pairs.every((p) => p.status === "missing"));

// ---- Macro levels ------------------------------------------------------------
const backdrop = { vix: { value: 18.2 }, vixTerm: { short: 17.1, spot: 18.2, mid: 20.4, ratio: 0.892, state: "contango" }, crude: { value: 71.3 }, gold: { value: 2650.5 }, move: { value: 98.1 }, credit: { value: 3.21 } };
const lv = macroLevelsFromBackdrop(backdrop);
ok("levels from the backdrop", lv.vix9d === 17.1 && lv.vix3m === 20.4 && lv.vixRatio === 0.892 && lv.crude === 71.3 && lv.gold === 2650.5 && lv.move === 98.1 && lv.hy === 3.21);
ok("empty backdrop → no keys", Object.keys(macroLevelsFromBackdrop(null)).length === 0);
const late = macroLevelsLate({ globalMarkets: { "^VVIX": { bars: [{ t: "2026-11-06", c: 95.2 }, { t: "2026-11-07", c: null }] } }, putCall: { oiRatio: 1.12, volRatio: 0.98 }, fearGreed: { score: 41.6 }, macroRegime: { state: "risk-off", stress: -2.5 } });
ok("late levels", late.vvix === 95.2 && late.pcOi === 1.12 && late.pcVol === 0.98 && late.fg === 42 && late.regime === "risk-off" && late.stress === -2.5);
let hist = { entries: [{ date: "2026-11-06", vix: 17, vvix: 90 }, { date: "2026-11-07", vix: 18 }] };
hist = mergeMacroLevels(hist, "2026-11-07", { vvix: 95, regime: "neutral", fg: null });
ok("merge adds to today's row and skips nulls", hist.entries[1].vvix === 95 && hist.entries[1].regime === "neutral" && !("fg" in hist.entries[1]) && hist.entries[0].vvix === 90);
hist = mergeMacroLevels(hist, "2026-11-08", { vvix: 97 });
ok("merge creates a missing row in order", hist.entries.length === 3 && hist.entries[2].date === "2026-11-08" && hist.entries[2].vvix === 97);
const big = { entries: Array.from({ length: MACRO_HISTORY_KEEP + 5 }, (_, i) => ({ date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, vix: 15 })) };
ok("merge caps the file at one trading year", mergeMacroLevels(big, "2026-01-01", { vvix: 90 }).entries.length === MACRO_HISTORY_KEEP && VIX_RANK_WINDOW === 90);
ok("merge with nothing to add returns history unchanged", mergeMacroLevels(hist, null, { vvix: 1 }) === hist);

// ---- Run archive: quote quality + grader audit ---------------------------------
const builtAtIso = "2026-11-09T16:00:00.000Z";
const rec = buildPicksRunRecord({
  builtAtIso,
  scored: [
    { sym: "AAPL", total: 6.2, side: "call", pillars: {}, data: { spot: 230, _fetchedAt: "2026-11-09T15:48:30.000Z", technicals: {}, fundamentals: {} } },
    { sym: "MSFT", total: -4.5, side: "put", pillars: {}, data: { spot: 410, technicals: {}, fundamentals: {} } },
  ],
  picks: { picks: [], rosterMeta: {} },
  aiMap: { "AAPL:call": { grade: "strong", score: 81, entryVerdict: "buy-now", entryReason: "Clean break", gradeReason: "Momentum", drivers: ["Guidance raised", "Flow", "x", "y", "z"], invalidation: ["Close under 220"], model: "gemini-3.6-flash", webResearch: { sources: [{ url: "a" }, { url: "b" }] }, usage: { in: 12000, out: 900, th: 1500, cached: 8000 } } },
  aiActive: true,
  contractFor: (sym) => (sym === "AAPL" ? { strike: 230, expiry: 1770000000, dte: 55, bid: 0, ask: 5.4, mid: 5.4, iv: 0.3, delta: 0.55 } : { strike: 400, expiry: 1770000000, dte: 55, bid: 9.8, ask: 10.2, mid: 10, iv: 0.3, delta: -0.5 }),
});
const aapl = rec.rows.find((r) => r.s === "AAPL"), msft = rec.rows.find((r) => r.s === "MSFT");
ok("quote age in minutes from the chain fetch stamp", aapl.q.age === 12 && aapl.q.zq === true && !("sp" in aapl.q));
ok("spread % recorded when both sides quote; no age without a stamp", msft.q.sp === 4 && msft.q.zq === false && !("age" in msft.q));
ok("grader audit fields", aapl.ai.dr.length === 4 && aapl.ai.inv[0] === "Close under 220" && aapl.ai.mdl === "gemini-3.6-flash" && aapl.ai.web === 2 && JSON.stringify(aapl.ai.tk) === "[12000,900,1500,8000]");
ok("rows without an AI entry carry no audit block", !("ai" in msft));

// ---- Shadow signals: EPS revisions ----------------------------------------------
ok("shadow version 2 adds three keys", SHADOW_SIGNAL_VERSION === 2 && SHADOW_KEYS.slice(-3).join(",") === "er30,rn30,ar30");
const closes = Array.from({ length: 60 }, (_, i) => ({ c: 100 + i }));
const sh = buildShadowSignals({
  NVDA: { spot: 160, _bars: closes, fundamentals: { fyEpsRevision: { period: "0y", pct30: 3.456, pct90: 5 }, epsRevisions: { y: { up7: 2, up30: 9, down30: 2, down90: 3 } }, analystRevisions: { upgrades: 3, downgrades: 1 } } },
  BARE: { spot: 50, _bars: closes, fundamentals: {} },
}, { builtAtIso });
const nv = Object.fromEntries(sh.keys.map((k, i) => [k, sh.rows.NVDA[i]]));
ok("er30 / rn30 / ar30 computed from the fundamentals", nv.er30 === 3.46 && nv.rn30 === 7 && nv.ar30 === 2);
const bare = Object.fromEntries(sh.keys.map((k, i) => [k, sh.rows.BARE[i]]));
ok("missing revision data stays null, not zero", bare.er30 === null && bare.rn30 === null && bare.ar30 === null);

console.log(`Recording bundle: ${n} checks passed.`);

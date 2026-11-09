// Crowd & positioning smoke test (lib/crowd/, 2026-11-09). Offline: every
// fetcher runs against fixtures through its injected fetch, so the test
// covers parsing, carry-forward, the once-a-day guards, the public rollup and
// the Owner join. Run: node scripts/crowd-smoke.mjs
import assert from "node:assert/strict";
import { parseShortVolumeFile, fetchShortVolume, summarizeShortVolume } from "../lib/crowd/short-volume.mjs";
import { parsePutCallPage, fetchPutCall } from "../lib/crowd/put-call.mjs";
import { parseBorrowFile, fetchBorrow } from "../lib/crowd/borrow.mjs";
import { buildCotContract, fetchCot, COT_CONTRACTS } from "../lib/crowd/cot.mjs";
import { parseRedditRows, fetchReddit } from "../lib/crowd/reddit.mjs";
import { parseWikiRows, fetchWikipedia, WIKI_TITLES } from "../lib/crowd/wikipedia.mjs";
import { levFundList, quoteRead, fetchLevFlows } from "../lib/crowd/lev-flows.mjs";
import { parseTrending, fetchStocktwitsCrowd, watchersFromChain } from "../lib/crowd/stocktwits.mjs";
import { parseMarginPage, summarizeMargin, fetchMarginDebt, monthKey } from "../lib/crowd/margin-debt.mjs";
import { compactMarket, rangeDistribution, thresholdLadder, buildKalshiSeries, fetchKalshi } from "../lib/crowd/kalshi.mjs";
import { perpRows, fetchPerps, baseSymbol } from "../lib/crowd/perps.mjs";
import { buildCrowdPayload, buildCrowdOwner, buildSymbolRollup, crowdScoresForRow, CROWD_SOURCE_IDS, sessionDatesFromChain, refClosesFromChains } from "../lib/crowd/index.mjs";
import { publicDataPayload } from "../lib/public-data-policy.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { TICKERS } from "./build.mjs";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}
const asyncTests = [];
function okAsync(name, fn) { asyncTests.push([name, fn]); }

const SYMS = ["AAPL", "TSLA", "NVDA", "SPY", "HOOD"];
const TODAY = "2026-11-09";
const NOW = "2026-11-09T15:05:00.000Z";

// ---- O1 short volume
const shortFile = `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261106|AAPL|1200000.5|1000|3000000|B,Q,N\n20261106|TSLA|500000|0|800000|B,Q\n20261106|ZZZZ|1|0|2|Q\n20261106|SPY|9000000|200|20000000|B,Q,N\n`;
ok("short volume file parses with fractional volumes", () => {
  const p = parseShortVolumeFile(shortFile, SYMS);
  assert.equal(p.date, "2026-11-06");
  assert.equal(p.rows, 4);
  assert.equal(p.bySymbol.AAPL.short, 1200001);
  assert.equal(p.bySymbol.ZZZZ, undefined);
});
okAsync("short volume fetch backfills missing sessions and summarizes", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("20261105")) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    return shortFile.replace(/20261106/g, url.match(/CNMSshvol(\d{8})/)[1]);
  };
  const out = await fetchShortVolume({ prior: null, symbols: SYMS, sessionDates: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", TODAY], todayEt: TODAY, nowIso: NOW, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.sessions.length, 3, "three sessions read, the 404 skipped");
  assert.ok(out.missing.includes("2026-11-05") === true, "an older 404 is remembered as missing");
  assert.equal(out.bySymbol.AAPL.shortPct, 40);
  assert.equal(out.market.latest[1], 49.2);
  // Second run: nothing new to fetch; still ok, no refetch of the missing day.
  const calls2 = [];
  const out2 = await fetchShortVolume({ prior: out, symbols: SYMS, sessionDates: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", TODAY], todayEt: TODAY, nowIso: NOW, fetchImpl: async (u) => { calls2.push(u); throw new Error("boom"); } });
  assert.equal(calls2.length, 0);
  assert.equal(out2.ok, true);
  assert.equal(summarizeShortVolume(out2.bySymbol.TSLA.history).shortPct, 62.5);
  // Total failure with no prior carries nothing but says so.
  const bad = await fetchShortVolume({ prior: null, symbols: SYMS, sessionDates: ["2026-11-06", TODAY], todayEt: TODAY, nowIso: NOW, fetchImpl: async () => { throw new Error("down"); } });
  assert.equal(bad.ok, false);
  assert.equal(bad.stale, true);
});

// ---- O2 put/call
const cboeHtml = `<html><table><tr><th>Ratios</th><th>Value</th></tr><tr><td>TOTAL PUT/CALL RATIO</td><td>0.95</td></tr><tr><td>INDEX PUT/CALL RATIO</td><td>1.26</td></tr><tr><td>EXCHANGE TRADED PRODUCTS PUT/CALL RATIO</td><td>0.91</td></tr><tr><td>EQUITY PUT/CALL RATIO</td><td>0.59</td></tr><tr><td>CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO</td><td>1.49</td></tr><tr><td>SPX + SPXW PUT/CALL RATIO</td><td>1.22</td></tr></table>
<table><tr><td>SUM OF ALL PRODUCTS</td><td>7,752,661</td><td>7,339,138</td><td>15,091,799</td><td>412,161,934</td><td>306,294,001</td><td>718,455,935</td></tr><tr><td>EQUITY OPTIONS</td><td>2,749,110</td><td>1,609,514</td><td>4,358,624</td><td>1</td><td>2</td><td>3</td></tr></table></html>`;
ok("Cboe page parses ratios and volumes", () => {
  const p = parsePutCallPage(cboeHtml);
  assert.equal(p.ratios.total, 0.95);
  assert.equal(p.ratios.equity, 0.59);
  assert.equal(p.ratios.vix, 1.49);
  assert.equal(p.volume.total.puts, 7339138);
  assert.equal(p.volume.equity.oiTotal, 3);
});
okAsync("Cboe fetch reads the last session once a day and carries forward on failure", async () => {
  const urls = [];
  const out = await fetchPutCall({ prior: null, todayEt: TODAY, sessionDates: ["2026-11-05", "2026-11-06", TODAY], nowIso: NOW, fetchImpl: async (u) => { urls.push(u); return cboeHtml; } });
  assert.equal(out.ok, true);
  assert.equal(out.asOf, "2026-11-06");
  assert.ok(urls[0].endsWith("dt=2026-11-06"));
  assert.equal(out.history.length, 1);
  const again = await fetchPutCall({ prior: out, todayEt: TODAY, sessionDates: [], nowIso: NOW, fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(again.ratios.total, 0.95);
  const failed = await fetchPutCall({ prior: { ...out, fetchedDate: "2026-11-06" }, todayEt: TODAY, sessionDates: ["2026-11-06", TODAY], nowIso: NOW, fetchImpl: async () => { throw new Error("HTTP 503"); } });
  assert.equal(failed.ok, true, "same session already stored counts as read");
  const failed2 = await fetchPutCall({ prior: { ...out, asOf: "2026-11-05", fetchedDate: "2026-11-06" }, todayEt: TODAY, sessionDates: ["2026-11-06", TODAY], nowIso: NOW, fetchImpl: async () => { throw new Error("HTTP 503"); } });
  assert.equal(failed2.ok, false);
  assert.equal(failed2.carriedForward, true);
  assert.equal(failed2.ratios.total, 0.95, "prior values ride along");
});

// ---- O3 borrow
const ibkrFile = `#BOF|2026.11.06|16:45:12\n#SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE\nAAPL|USD|APPLE INC|265598|US0378331005|3.3|0.25|>10000000\nTSLA|USD|TESLA INC|76792991|US88160R1014|2.9|0.65|5000000\nHOOD|USD|ROBINHOOD|1|X|-8|12.5|150000\n${Array.from({ length: 120 }, (_, i) => `Z${i}|USD|Z|1|X|3|0.3|1000`).join("\n")}\n#EOF`;
ok("IBKR borrow file parses fee, rebate and capped availability", () => {
  const p = parseBorrowFile(ibkrFile, SYMS);
  assert.equal(p.asOf, "2026-11-06T16:45");
  assert.equal(p.bySymbol.AAPL.feePct, 0.25);
  assert.equal(p.bySymbol.AAPL.available, 10000000);
  assert.equal(p.bySymbol.AAPL.availableCapped, true);
  assert.equal(p.bySymbol.HOOD.rebatePct, -8);
  assert.ok(p.rows >= 120);
});
okAsync("IBKR fetch builds history and flags hard-to-borrow", async () => {
  const out = await fetchBorrow({ prior: null, symbols: SYMS, todayEt: TODAY, nowIso: NOW, readImpl: async () => ibkrFile });
  assert.equal(out.ok, true);
  assert.equal(out.untested, true);
  assert.equal(out.universe.hardToBorrow, 1);
  assert.equal(out.bySymbol.NVDA.missing, true);
  assert.deepEqual(out.bySymbol.TSLA.history, [[TODAY, 0.65, 5000000]]);
  const carried = await fetchBorrow({ prior: { ...out, fetchedDate: "2026-11-06" }, symbols: SYMS, todayEt: TODAY, nowIso: NOW, readImpl: async () => { throw new Error("ftp blocked"); } });
  assert.equal(carried.ok, false);
  assert.equal(carried.bySymbol.TSLA.feePct, 0.65);
});

// ---- O4 COT
const cotRows = [];
for (let w = 0; w < 10; w++) {
  const d = new Date(Date.UTC(2026, 8, 1 + w * 7)).toISOString().slice(0, 10);
  cotRows.push({ report_date_as_yyyy_mm_dd: `${d}T00:00:00.000`, market_and_exchange_names: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", cftc_contract_market_code: "13874A", open_interest_all: String(2000000 + w * 1000), dealer_positions_long_all: "100000", dealer_positions_short_all: "300000", asset_mgr_positions_long: "1200000", asset_mgr_positions_short: "400000", lev_money_positions_long: String(300000 + w * 5000), lev_money_positions_short: "500000", other_rept_positions_long: "50000", other_rept_positions_short: "40000", nonrept_positions_long_all: "100000", nonrept_positions_short_all: "90000" });
}
ok("COT contract read nets the groups and keeps weekly history", () => {
  const c = buildCotContract(COT_CONTRACTS[0], cotRows);
  assert.equal(c.asOf, "2026-11-03");
  assert.equal(c.groups.levFund.net, 345000 - 500000);
  assert.equal(c.groups.levFund.change, 5000);
  assert.equal(c.groups.assetMgr.net, 800000);
  assert.equal(c.history.length, 10);
  assert.ok(c.groups.levFund.z3y > 0);
});
okAsync("COT fetch filters codes, carries on failure", async () => {
  const out = await fetchCot({ prior: null, todayEt: TODAY, nowIso: NOW, fetchImpl: async (u) => { assert.ok(u.includes("13874A")); return cotRows; } });
  assert.equal(out.ok, true);
  assert.ok(out.contracts.ES);
  assert.equal(out.contracts.NQ, undefined);
  const c = await fetchCot({ prior: { ...out, fetchedDate: "2026-11-06" }, todayEt: TODAY, nowIso: NOW, fetchImpl: async () => [] });
  assert.equal(c.ok, false);
  assert.ok(c.contracts.ES);
});

// ---- R1 Reddit
const apeBody = { count: 2, pages: 1, current_page: 1, results: [{ rank: 1, ticker: "TSLA", name: "Tesla", mentions: 900, upvotes: 5000, rank_24h_ago: 2, mentions_24h_ago: 600 }, { rank: 2, ticker: "GME", name: "GameStop", mentions: 300, upvotes: 100, rank_24h_ago: 1, mentions_24h_ago: 900 }] };
ok("ApeWisdom rows parse", () => {
  const rows = parseRedditRows(apeBody);
  assert.equal(rows[0].symbol, "TSLA");
  assert.equal(rows[1].mentions24hAgo, 900);
});
okAsync("Reddit fetch marks tracked names, keeps the top list and a per-name history", async () => {
  const out = await fetchReddit({ prior: null, symbols: SYMS, todayEt: TODAY, nowIso: NOW, fetchImpl: async () => apeBody });
  assert.equal(out.ok, true);
  assert.equal(out.top[0].tracked, true);
  assert.equal(out.top[1].tracked, false);
  assert.equal(out.bySymbol.TSLA.sharePct, 75);
  assert.equal(out.bySymbol.AAPL.mentions, 0);
  assert.equal(out.bySymbol.TSLA.history.length, 1);
  const soon = await fetchReddit({ prior: out, symbols: SYMS, todayEt: TODAY, nowIso: "2026-11-09T15:20:00.000Z", fetchImpl: async () => { throw new Error("no"); } });
  assert.equal(soon.ok, true, "within the hour the prior read stands");
  const later = await fetchReddit({ prior: out, symbols: SYMS, todayEt: TODAY, nowIso: "2026-11-09T17:20:00.000Z", fetchImpl: async () => { throw new Error("HTTP 429"); } });
  assert.equal(later.ok, false);
  assert.equal(later.top[0].symbol, "TSLA");
});

// ---- R2 Wikipedia
ok("Wikipedia rows parse and every tracked name has a decision", () => {
  const rows = parseWikiRows({ items: [{ timestamp: "2026110500", views: 12000 }, { timestamp: "2026110600", views: 15000 }] });
  assert.deepEqual(rows, [["2026-11-05", 12000], ["2026-11-06", 15000]]);
  for (const sym of TICKERS) assert.ok(sym in WIKI_TITLES, `${sym} needs a Wikipedia title (or null)`);
});
okAsync("Wikipedia fetch asks only for missing days and summarizes", async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    const m = u.match(/daily\/(\d{8})\/(\d{8})$/);
    const items = [];
    for (let d = new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T00:00:00Z`); d.toISOString().slice(0, 10).replace(/-/g, "") <= m[2]; d = new Date(d.getTime() + 86400000)) {
      items.push({ timestamp: `${d.toISOString().slice(0, 10).replace(/-/g, "")}00`, views: 1000 });
    }
    return { items };
  };
  const out = await fetchWikipedia({ prior: null, symbols: SYMS, todayEt: TODAY, nowIso: NOW, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.covered, 5, "all five fixture names have a Wikipedia title");
  assert.equal(out.bySymbol.AAPL.history.length, 60);
  assert.equal(out.bySymbol.AAPL.ratio30, 1);
  const n = urls.length;
  const next = await fetchWikipedia({ prior: { ...out, fetchedDate: "2026-11-08" }, symbols: SYMS, todayEt: TODAY, nowIso: NOW, fetchImpl });
  assert.equal(urls.length, n, "history already through yesterday: no new requests");
  assert.equal(next.ok, true);
});

// ---- R3 leveraged flows
const singles = { NVDA: { bull: { sym: "NVDL", lev: 2 }, bear: { sym: "NVDD", lev: -1 } } };
const groups = { nasdaq: { label: "Nasdaq-100", kind: "index", proxy: "QQQ", bull: { sym: "TQQQ", lev: 3 }, bear: { sym: "SQQQ", lev: -3 } } };
ok("leveraged fund list and quote read", () => {
  const funds = levFundList(singles, groups);
  assert.equal(funds.length, 4);
  assert.equal(funds[0].label, "NVDA +2x");
  const q = quoteRead({ sharesOutstanding: 1000000, navPrice: 50.123, netAssets: null, regularMarketPrice: 50.2 });
  assert.equal(q.netAssets, 50123000);
});
okAsync("leveraged flows derive dollars from share-count changes", async () => {
  const funds = levFundList(singles, groups);
  const prior = { fetchedDate: "2026-11-06", rows: funds.map((f) => ({ ...f, history: [["2026-11-06", 1000000, 50, 50000000]] })) };
  const out = await fetchLevFlows({ prior, funds, todayEt: TODAY, nowIso: NOW, quoteFn: async (syms) => syms.map((s) => ({ symbol: s, sharesOutstanding: 1100000, navPrice: 52, netAssets: 57200000 })) });
  assert.equal(out.ok, true);
  assert.equal(out.rows[0].flowShares1d, 100000);
  assert.equal(out.rows[0].flowUsd1d, 5200000);
  assert.equal(out.withShares, 4);
  const failed = await fetchLevFlows({ prior: out, funds, todayEt: "2026-11-10", nowIso: NOW, quoteFn: async () => { throw new Error("yahoo down"); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.rows.length, 4);
});

// ---- R4 Stocktwits
ok("Stocktwits trending parses and watchers read from the chain", () => {
  const t = parseTrending({ symbols: [{ symbol: "TSLA", title: "Tesla", watchlist_count: 1200000 }] });
  assert.equal(t[0].watchers, 1200000);
  assert.equal(watchersFromChain({ social: { sources: { stocktwits: { watchers: 55 } } } }), 55);
  assert.equal(watchersFromChain({ social: { sources: { stocktwits: { watchers: 55, stale: true } } } }), null);
});
okAsync("Stocktwits crowd block keeps watcher history and trending", async () => {
  const chains = { TSLA: { social: { msgCount24h: 40, sources: { stocktwits: { watchers: 1200000 } } } }, AAPL: { social: { sources: { stocktwits: { watchers: 900000 } } } } };
  const prior = { bySymbol: { TSLA: { history: [["2026-11-02", 1100000]] } } };
  const out = await fetchStocktwitsCrowd({ prior, symbols: SYMS, chains, todayEt: TODAY, nowIso: NOW, fetchImpl: async () => ({ symbols: [{ symbol: "GME", title: "GameStop", watchlist_count: 1 }] }) });
  assert.equal(out.ok, true);
  assert.equal(out.covered, 2);
  assert.equal(out.bySymbol.TSLA.change1d, 100000);
  assert.equal(out.trending[0].tracked, false);
  const noTrend = await fetchStocktwitsCrowd({ prior: out, symbols: SYMS, chains, todayEt: TODAY, nowIso: NOW, fetchImpl: async () => { throw new Error("HTTP 429"); } });
  assert.equal(noTrend.trendingStale, true);
  assert.equal(noTrend.trending.length, 1);
});

// ---- S3 margin debt
const finraHtml = `<table><tr><th>Month/Year</th><th>Debit Balances in Customers' Securities Margin Accounts</th><th>Free Credit Balances in Customers' Cash Accounts</th><th>Free Credit Balances in Customers' Securities Margin Accounts</th></tr>
<tr><td>Sep-26</td><td>1,480,054</td><td>180,000</td><td>230,000</td></tr><tr><td>Aug-26</td><td>1,400,000</td><td>170,000</td><td>220,000</td></tr><tr><td>Sep-25</td><td>1,000,000</td><td>150,000</td><td>200,000</td></tr></table>`;
ok("FINRA margin page parses months in $ millions", () => {
  assert.equal(monthKey("Sep-26"), "2026-09");
  assert.equal(monthKey("Sep 2026"), "2026-09");
  const rows = parseMarginPage(finraHtml);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].debit, 1480054);
  const s = summarizeMargin(rows);
  assert.equal(s.month, "2026-09");
  assert.equal(s.yoyPct, 48);
  assert.equal(s.momPct, 5.7);
  assert.equal(s.peak.fromPeakPct, 0);
});
okAsync("margin debt accumulates months across builds", async () => {
  const prior = { fetchedDate: "2026-10-20", rows: [{ month: "2024-01", debit: 700000, creditCash: 1, creditMargin: 1 }] };
  const out = await fetchMarginDebt({ prior, todayEt: TODAY, nowIso: NOW, fetchImpl: async () => finraHtml });
  assert.equal(out.rows.length, 4);
  assert.equal(out.asOf, "2026-09");
});

// ---- P2 Kalshi
const kalshiEvents = { events: [{ event_ticker: "KXINX-26NOV09", title: "S&P 500 close on Nov 9", markets: [
  { ticker: "A", yes_sub_title: "6,900 or below", strike_type: "less", cap_strike: 6900, yes_bid_dollars: "0.08", yes_ask_dollars: "0.12", volume: 100, close_time: "2026-11-09T21:00:00Z" },
  { ticker: "B", yes_sub_title: "6,900 to 6,950", strike_type: "between", floor_strike: 6900, cap_strike: 6950, yes_bid: 30, yes_ask: 34, volume: 300, close_time: "2026-11-09T21:00:00Z" },
  { ticker: "C", yes_sub_title: "6,950 to 7,000", strike_type: "between", floor_strike: 6950, cap_strike: 7000, yes_bid_dollars: "0.40", yes_ask_dollars: "0.44", volume: 500, close_time: "2026-11-09T21:00:00Z" },
  { ticker: "D", yes_sub_title: "7,000 or above", strike_type: "greater", floor_strike: 7000, yes_bid_dollars: "0.12", yes_ask_dollars: "0.16", volume: 100, close_time: "2026-11-09T21:00:00Z" },
] }] };
ok("Kalshi range markets give an implied distribution", () => {
  const m = compactMarket(kalshiEvents.events[0].markets[1]);
  assert.equal(m.prob, 0.32);
  const dist = rangeDistribution(kalshiEvents.events[0].markets.map(compactMarket));
  assert.ok(dist.impliedMean > 6950 && dist.impliedMean < 6990, String(dist.impliedMean));
  assert.equal(dist.mostLikely.floor, 6950);
  assert.equal(dist.buckets.length, 4);
  assert.ok(Math.abs(dist.buckets.reduce((a, b) => a + b.prob, 0) - 1) < 0.01);
});
ok("Kalshi threshold ladder finds the median", () => {
  const markets = [
    { ticker: "a", strike_type: "greater", floor_strike: 0.2, yes_bid_dollars: "0.90", yes_ask_dollars: "0.92" },
    { ticker: "b", strike_type: "greater", floor_strike: 0.3, yes_bid_dollars: "0.58", yes_ask_dollars: "0.62" },
    { ticker: "c", strike_type: "greater", floor_strike: 0.4, yes_bid_dollars: "0.20", yes_ask_dollars: "0.24" },
  ].map(compactMarket);
  const l = thresholdLadder(markets);
  assert.equal(l.levels, 3);
  assert.ok(l.median > 0.3 && l.median < 0.4, String(l.median));
});
okAsync("Kalshi fetch keeps per-series carry-forward", async () => {
  const out = await fetchKalshi({ prior: null, todayEt: TODAY, nowIso: NOW, fetchImpl: async (u) => (u.includes("KXINX") ? kalshiEvents : { events: [] }), series: [{ ticker: "KXINX", label: "S&P 500 close", kind: "range", group: "index", maxEvents: 2 }, { ticker: "KXCPI", label: "CPI", kind: "threshold", group: "macro", maxEvents: 1 }] });
  assert.equal(out.ok, true);
  assert.equal(out.seriesOk, 1);
  assert.ok(out.series.KXINX.headline.impliedMean > 6900);
  assert.equal(out.series.KXCPI.ok, false);
  assert.equal(out.series.KXINX.history.length, 1);
});

// ---- P1 perps
const meta = { universe: [{ name: "xyz:TSLA", szDecimals: 2, maxLeverage: 10 }, { name: "xyz:NVDA", szDecimals: 2, maxLeverage: 10 }, { name: "xyz:SP500", szDecimals: 1, maxLeverage: 20 }, { name: "xyz:OLD", isDelisted: true }] };
const ctxs = [
  { funding: "0.0000125", openInterest: "1500.5", prevDayPx: "440", dayNtlVlm: "1000000", premium: "0.001", oraclePx: "445", markPx: "445.5", midPx: "445.4" },
  { funding: "-0.00005", openInterest: "9000", prevDayPx: "190", dayNtlVlm: "5000000", premium: "-0.002", oraclePx: "188", markPx: "187.6", midPx: "187.7" },
  { funding: "0", openInterest: "100", prevDayPx: "6900", dayNtlVlm: "1", oraclePx: "6950", markPx: "6951" },
  { funding: "0", openInterest: "1", markPx: "1" },
];
ok("perps rows join universe and contexts", () => {
  const rows = perpRows("xyz", meta, ctxs);
  assert.equal(rows.length, 3);
  assert.equal(baseSymbol("xyz:TSLA"), "TSLA");
  assert.equal(rows[0].fundingAnnualPct, 10.95);
  assert.equal(rows[0].oiUsd, Math.round(1500.5 * 445.5));
  assert.equal(rows[1].dayChangePct, -1.26);
});
okAsync("perps fetch keeps tracked names, indexes and the vs-close read", async () => {
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (body.type === "perpDexs") return [null, { name: "xyz", full_name: "trade.xyz" }, { name: "other" }];
    if (body.dex === "xyz") return [meta, ctxs];
    return [{ universe: [{ name: "other:TSLA" }] }, [{ markPx: "440", openInterest: "10", funding: "0" }]];
  };
  const out = await fetchPerps({ prior: null, symbols: SYMS, refCloses: { TSLA: { close: 440, date: "2026-11-06" } }, nowIso: NOW, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.covered, 2);
  assert.equal(out.bySymbol.TSLA.dex, "xyz", "deeper book wins");
  assert.equal(out.bySymbol.TSLA.vsRefClosePct, 1.25);
  assert.equal(out.bySymbol.SPX.isIndex, true);
  assert.equal(out.bySymbol.TSLA.history.length, 1);
  const failed = await fetchPerps({ prior: out, symbols: SYMS, refCloses: {}, nowIso: NOW, fetchImpl: async () => { throw new Error("blocked"); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.bySymbol.TSLA.markPx, 445.5);
});

// ---- orchestrator + Owner + policy
okAsync("orchestrator runs every source fail-soft and the public payload passes the policy", async () => {
  const chains = {
    SPY: { _bars: [{ t: "2026-11-05", c: 690 }, { t: "2026-11-06", c: 692 }], spot: 692 },
    TSLA: { priceSeries: { t: ["2026-11-06"], c: [440] }, social: { sources: { stocktwits: { watchers: 1 } } } },
  };
  const offline = async () => { throw new Error("offline"); };
  const crowd = await buildCrowdPayload({ prior: null, symbols: SYMS, chains, todayEt: TODAY, nowIso: NOW, quoteFn: offline, levSingles: singles, levGroups: groups, fetchers: { text: offline, json: offline, borrow: offline } });
  assert.equal(crowd.okCount, 1, "only the Stocktwits watcher block has data offline (from the chain)");
  // Second pass with live-shaped fixtures for the two cheapest sources.
  const json = async (u, opts) => {
    if (u.includes("apewisdom")) return apeBody;
    if (u.includes("kalshi")) return u.includes("KXINX") ? kalshiEvents : { events: [] };
    if (u.includes("hyperliquid")) { const b = JSON.parse(opts.body); return b.type === "perpDexs" ? [null, { name: "xyz" }] : [meta, ctxs]; }
    throw new Error("offline");
  };
  const crowd2 = await buildCrowdPayload({ prior: crowd, symbols: SYMS, chains, todayEt: TODAY, nowIso: "2026-11-09T16:30:00.000Z", quoteFn: offline, levSingles: singles, levGroups: groups, fetchers: { text: offline, json, borrow: offline } });
  assert.equal(crowd2.reddit.ok, true);
  assert.equal(crowd2.kalshi.ok, true);
  assert.equal(crowd2.perps.ok, true);
  assert.equal(crowd2.rollup.find((r) => r.symbol === "TSLA").perpVsClosePct, 1.25);
  assert.equal(crowd.sources.length, CROWD_SOURCE_IDS.length);
  assert.equal(crowd.rollup.length, SYMS.length);
  assert.deepEqual(sessionDatesFromChain(chains.SPY), ["2026-11-05", "2026-11-06"]);
  assert.equal(refClosesFromChains(chains, SYMS).TSLA.close, 440);
  const pub = publicDataPayload("crowd.json", crowd);
  assert.ok(pub && pub.sources, "public policy keeps the payload");
  assert.equal(JSON.stringify(pub).includes('"grade"'), false);
  assert.equal(isPremiumKey("crowd.json"), false, "crowd.json is public");
  assert.equal(isPremiumKey("crowd-owner.json"), true, "crowd-owner.json is Owner-only");
});

ok("rollup percentiles and Owner scores", () => {
  const blocks = {
    shortVolume: { bySymbol: Object.fromEntries(SYMS.map((s, i) => [s, { shortPct: 40 + i, avg20Pct: 40, z20: i - 2 }])) },
    reddit: { bySymbol: Object.fromEntries(SYMS.map((s, i) => [s, { rank: i + 1, mentions: 500 - i * 100, vsAvg7: i === 0 ? 4 : 1 }])) },
    wikipedia: { bySymbol: { TSLA: { views: 100, ratio30: 2.5 } } },
    stocktwits: { bySymbol: { TSLA: { watchers: 10, pct7d: 3 } } },
    borrow: { bySymbol: { HOOD: { feePct: 12.5 } } },
    perps: { bySymbol: { TSLA: { markPx: 445, vsRefClosePct: 2.5, fundingAnnualPct: 40, oiUsd: 1 } } },
  };
  const rows = buildSymbolRollup(SYMS, blocks);
  assert.equal(rows[0].symbol, "AAPL");
  assert.ok(rows.find((r) => r.symbol === "HOOD").shortZ20Pctile > rows[0].shortZ20Pctile);
  const tsla = rows.find((r) => r.symbol === "TSLA");
  const s = crowdScoresForRow(tsla);
  assert.ok(s.flags.includes("reddit-top10"));
  assert.ok(s.flags.includes("wiki-spike"));
  assert.ok(s.flags.includes("perp-longs-crowded"));
  assert.ok(s.flags.includes("perp-gap-up"));
  assert.ok(s.attention != null);
  const owner = buildCrowdOwner({ crowd: { etDate: TODAY, rollup: rows, putCall: { stats: { equity: { value: 0.6, z250: -1.2 } } } }, prior: { daily: [{ date: "2026-11-06", gauges: {}, scores: {} }] }, openTrades: [{ id: "TSLA-C-11/06/26-11:00", symbol: "TSLA", side: "call", entryDate: "2026-11-06" }], regime: { cell: "calm-trend", cellLabel: "Calm trend", era: "calm", character: "trend" }, nowIso: NOW, todayEt: TODAY });
  assert.equal(owner.openTrades[0].warnings.includes("perp longs crowded on a call"), true);
  assert.equal(owner.daily.length, 2);
  assert.equal(owner.gauges.putCallEquityZ, -1.2);
  assert.equal(owner.regime.label, "Calm trend");
  assert.equal(owner.mostCrowded[0].symbol, "AAPL", "most Reddit mentions in the fixture; the lone wiki / watcher values have no peer group yet");
  assert.ok(owner.mostCrowded.some((m) => m.symbol === "TSLA" && m.flags.includes("wiki-spike")));
});

for (const [name, fn] of asyncTests) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.stack?.split("\n").slice(0, 3).join("\n    ")}`); process.exitCode = 1; }
}
console.log(process.exitCode ? `crowd smoke: FAILED (${passed} passed)` : `crowd smoke: ${passed} checks passed`);

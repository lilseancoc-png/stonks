// Synthetic Crowd & positioning payloads for the smoke and browser tests
// (lib/crowd/). Built through the real fetchers with fake fetch functions so
// the shapes match what the bake writes; histories are then extended so the
// charts and tables render at full size. Deterministic; no network.
import { buildCrowdPayload, buildCrowdOwner } from "../lib/crowd/index.mjs";
import { LEVERAGED_ETF_SINGLES, LEVERAGED_ETF_GROUPS, TICKERS } from "./build.mjs";

export const CROWD_FIXTURE_NOW = "2026-11-09T15:05:00.000Z";
export const CROWD_FIXTURE_DAY = "2026-11-09";

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function dayList(endIso, count, weekdaysOnly = true) {
  const out = [];
  let t = Date.parse(`${endIso}T00:00:00Z`);
  while (out.length < count) {
    const d = new Date(t);
    if (!weekdaysOnly || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)) out.unshift(d.toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out;
}

export function crowdFixtureChains(symbols = TICKERS) {
  const r = rng(11);
  const chains = {};
  const days = dayList("2026-11-06", 70);
  symbols.forEach((sym, i) => {
    let c = 50 + i * 7;
    const bars = days.map((d) => { c *= 1 + (r() - 0.5) * 0.03; return { t: d, c: Math.round(c * 100) / 100, v: Math.round(1e6 + r() * 5e6) }; });
    chains[sym] = {
      spot: bars[bars.length - 1].c,
      _bars: bars,
      social: { msgCount24h: Math.round(r() * 80), sources: { stocktwits: { watchers: Math.round(50000 + r() * 2e6) } } },
    };
  });
  return chains;
}

export async function crowdFixture({ symbols = TICKERS, nowIso = CROWD_FIXTURE_NOW, todayEt = CROWD_FIXTURE_DAY } = {}) {
  const r = rng(29);
  const chains = crowdFixtureChains(symbols);
  const shortFile = (day) => ["Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market"].concat(symbols.map((s) => {
    const total = Math.round(1e6 + r() * 2e7);
    return `${day.replace(/-/g, "")}|${s}|${Math.round(total * (0.3 + r() * 0.4))}|${Math.round(total * 0.002)}|${total}|B,Q,N`;
  })).join("\n");
  const cboe = `<table><tr><td>TOTAL PUT/CALL RATIO</td><td>${(0.8 + r() * 0.4).toFixed(2)}</td></tr><tr><td>INDEX PUT/CALL RATIO</td><td>1.31</td></tr><tr><td>EXCHANGE TRADED PRODUCTS PUT/CALL RATIO</td><td>0.88</td></tr><tr><td>EQUITY PUT/CALL RATIO</td><td>${(0.45 + r() * 0.3).toFixed(2)}</td></tr><tr><td>CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO</td><td>1.12</td></tr><tr><td>SPX + SPXW PUT/CALL RATIO</td><td>1.27</td></tr></table><table><tr><td>SUM OF ALL PRODUCTS</td><td>7,752,661</td><td>7,339,138</td><td>15,091,799</td><td>412,161,934</td><td>306,294,001</td><td>718,455,935</td></tr><tr><td>EQUITY OPTIONS</td><td>2,749,110</td><td>1,609,514</td><td>4,358,624</td><td>286,140,712</td><td>179,296,403</td><td>465,437,115</td></tr></table>`;
  const ibkr = ["#BOF|2026.11.06|16:45:12", "#SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE"].concat(symbols.map((s, i) => `${s}|USD|${s} INC|${1000 + i}|US000|${(3.3 - r() * 2).toFixed(2)}|${(i % 9 === 0 ? 5 + r() * 20 : 0.2 + r() * 1.5).toFixed(2)}|${i % 4 === 0 ? ">10000000" : Math.round(1e5 + r() * 5e6)}`)).concat(Array.from({ length: 120 }, (_, i) => `Z${i}|USD|Z|1|X|3|0.3|1000`)).join("\n");
  const finra = `<table><tr><th>Month/Year</th><th>Debit</th><th>Cash</th><th>Margin</th></tr>${["Sep-26", "Aug-26", "Jul-26", "Jun-26", "May-26", "Apr-26", "Mar-26", "Feb-26", "Jan-26", "Dec-25", "Nov-25", "Oct-25", "Sep-25"].map((m, i) => `<tr><td>${m}</td><td>${(1480054 - i * 23000).toLocaleString()}</td><td>${(180000 + i * 900).toLocaleString()}</td><td>${(230000 - i * 500).toLocaleString()}</td></tr>`).join("")}</table>`;
  const cotRows = [];
  const contracts = [["13874A", "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"], ["209742", "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE"], ["1170E1", "VIX FUTURES - CBOE FUTURES EXCHANGE"], ["043602", "UST 10Y NOTE - CHICAGO BOARD OF TRADE"], ["098662", "USD INDEX - ICE FUTURES U.S."]];
  for (const [code, name] of contracts) {
    for (let w = 0; w < 156; w++) {
      const d = new Date(Date.UTC(2023, 10, 7) + w * 7 * 86400000).toISOString().slice(0, 10);
      const base = 1e6 + r() * 5e5;
      cotRows.push({ report_date_as_yyyy_mm_dd: `${d}T00:00:00.000`, market_and_exchange_names: name, cftc_contract_market_code: code, open_interest_all: String(Math.round(base * 2)), dealer_positions_long_all: String(Math.round(base * 0.1)), dealer_positions_short_all: String(Math.round(base * 0.3)), asset_mgr_positions_long: String(Math.round(base * 1.1)), asset_mgr_positions_short: String(Math.round(base * 0.4)), lev_money_positions_long: String(Math.round(base * (0.3 + r() * 0.2))), lev_money_positions_short: String(Math.round(base * 0.5)), other_rept_positions_long: "50000", other_rept_positions_short: "40000", nonrept_positions_long_all: "100000", nonrept_positions_short_all: "90000" });
    }
  }
  const apeRows = symbols.slice().sort(() => r() - 0.5).slice(0, 40).concat(["GME", "AMC", "BBAI", "SOFI", "RIVN", "LCID", "NIO", "SNAP", "COIN", "MSTR"]).map((t, i) => ({ rank: i + 1, ticker: t, name: `${t} company`, mentions: Math.round(900 / (i + 1) + r() * 20), upvotes: Math.round(r() * 5000), rank_24h_ago: Math.max(1, i + 1 + Math.round((r() - 0.5) * 6)), mentions_24h_ago: Math.round(800 / (i + 1)) }));
  const kalshiInx = { events: [{ event_ticker: "KXINX-26NOV09", title: "S&P 500 close on Nov 9", markets: [6800, 6850, 6900, 6950, 7000, 7050].map((f, i, arr) => ({ ticker: `KXINX-${f}`, yes_sub_title: i === arr.length - 1 ? `${f} or above` : `${f} to ${f + 50}`, strike_type: i === arr.length - 1 ? "greater" : "between", floor_strike: f, cap_strike: i === arr.length - 1 ? undefined : f + 50, yes_bid_dollars: String(Math.max(0.01, 0.35 - Math.abs(i - 2.5) * 0.11).toFixed(2)), yes_ask_dollars: String(Math.max(0.03, 0.39 - Math.abs(i - 2.5) * 0.11).toFixed(2)), volume: Math.round(100 + r() * 3000), open_interest: 500, close_time: "2026-11-09T21:00:00Z" })).concat([{ ticker: "KXINX-LOW", yes_sub_title: "6800 or below", strike_type: "less", cap_strike: 6800, yes_bid_dollars: "0.03", yes_ask_dollars: "0.06", volume: 80, close_time: "2026-11-09T21:00:00Z" }]) }] };
  const kalshiCpi = { events: [{ event_ticker: "KXCPI-26NOV", title: "CPI for October 2026 (month over month)", markets: [0.1, 0.2, 0.3, 0.4, 0.5].map((lvl, i) => ({ ticker: `KXCPI-${lvl}`, yes_sub_title: `above ${lvl}%`, strike_type: "greater", floor_strike: lvl, yes_bid_dollars: String((0.95 - i * 0.22).toFixed(2)), yes_ask_dollars: String((0.98 - i * 0.22).toFixed(2)), volume: 400, close_time: "2026-11-12T13:30:00Z" })) }] };
  const kalshiJobs = { events: [{ event_ticker: "KXPAYROLLS-26NOV", title: "Nonfarm payrolls for October 2026", markets: [0, 50, 100, 150, 200].map((lvl, i) => ({ ticker: `KXPAYROLLS-${lvl}`, yes_sub_title: `above ${lvl}k`, strike_type: "greater", floor_strike: lvl * 1000, yes_bid_dollars: String((0.9 - i * 0.2).toFixed(2)), yes_ask_dollars: String((0.94 - i * 0.2).toFixed(2)), volume: 250, close_time: "2026-12-04T13:30:00Z" })) }] };
  // Kalshi quotes payrolls in jobs (50000), shown in thousands; the recession
  // series is one yes/no market per event.
  const kalshiRec = { events: [{ event_ticker: "KXRECSSNBER-26", title: "Recession in 2026?", markets: [{ ticker: "KXRECSSNBER-26", yes_sub_title: "Recession", strike_type: "structured", yes_bid_dollars: "0.04", yes_ask_dollars: "0.06", volume_fp: "12000.00", open_interest_fp: "8000.00", close_time: "2026-12-31T15:00:00Z" }] }, { event_ticker: "KXRECSSNBER-27", title: "Recession in 2027?", markets: [{ ticker: "KXRECSSNBER-27", yes_sub_title: "Recession", strike_type: "structured", yes_bid_dollars: "0.19", yes_ask_dollars: "0.23", volume_fp: "45000.00", open_interest_fp: "30000.00", close_time: "2027-12-31T15:00:00Z" }] }] };
  const perpNames = symbols.filter((s) => ["TSLA", "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "HOOD", "PLTR", "MU", "AMD", "CRWV"].includes(s));
  const meta = { universe: perpNames.map((s) => ({ name: `xyz:${s}`, szDecimals: 2, maxLeverage: 10 })).concat([{ name: "xyz:SP500", szDecimals: 1, maxLeverage: 20 }]) };
  const ctxs = perpNames.map((s) => { const spot = chains[s].spot; const mark = spot * (1 + (r() - 0.5) * 0.04); return { funding: String(((r() - 0.5) * 0.0002).toFixed(7)), openInterest: String(Math.round(1000 + r() * 50000)), prevDayPx: String((spot * (1 + (r() - 0.5) * 0.02)).toFixed(2)), dayNtlVlm: String(Math.round(1e6 + r() * 5e7)), premium: String(((mark / spot - 1) * 0.3).toFixed(5)), oraclePx: String(spot.toFixed(2)), markPx: String(mark.toFixed(2)), midPx: String(mark.toFixed(2)) }; })
    .concat([{ funding: "0.0000125", openInterest: "120", prevDayPx: "6900", dayNtlVlm: "2000000", premium: "0.0001", oraclePx: "6950", markPx: "6951" }]);

  const text = async (url) => {
    if (url.includes("CNMSshvol")) return shortFile(url.match(/CNMSshvol(\d{8})/)[1].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
    if (url.includes("cboe.com")) return cboe;
    if (url.includes("finra.org/rules")) return finra;
    throw new Error("offline");
  };
  const json = async (url, opts) => {
    if (url.includes("cftc.gov")) return cotRows;
    if (url.includes("apewisdom")) return { count: apeRows.length, pages: 1, current_page: 1, results: apeRows };
    if (url.includes("wikimedia.org")) {
      const m = url.match(/daily\/(\d{8})\/(\d{8})$/);
      const items = [];
      for (let t = Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T00:00:00Z")); t <= Date.parse(m[2].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T00:00:00Z")); t += 86400000) items.push({ timestamp: `${new Date(t).toISOString().slice(0, 10).replace(/-/g, "")}00`, views: Math.round(2000 + r() * 30000) });
      return { items };
    }
    if (url.includes("stocktwits")) return { symbols: ["TSLA", "GME", "NVDA", "AMC", "PLTR", "SOFI"].map((s) => ({ symbol: s, title: `${s} Inc`, watchlist_count: Math.round(1e5 + r() * 1e6) })) };
    if (url.includes("kalshi")) return url.includes("KXINX") ? kalshiInx : url.includes("KXCPI&") || url.includes("KXCPI&status") || /series_ticker=KXCPI&/.test(url) ? kalshiCpi : url.includes("KXPAYROLLS") ? kalshiJobs : url.includes("KXRECSSNBER") ? kalshiRec : { events: [] };
    if (url.includes("hyperliquid")) { const b = JSON.parse(opts.body); return b.type === "perpDexs" ? [null, { name: "xyz", full_name: "trade.xyz" }] : [meta, ctxs]; }
    throw new Error("offline");
  };
  const quoteFn = async (syms) => syms.map((s, i) => ({ symbol: s, sharesOutstanding: Math.round(1e6 + r() * 5e7), navPrice: Math.round((10 + r() * 90) * 100) / 100, netAssets: Math.round(1e7 + r() * 2e9), regularMarketPrice: 20 + i }));
  const sessionDates = dayList("2026-11-06", 70);
  const crowd = await buildCrowdPayload({ prior: null, symbols, chains: { ...chains, SPY: { ...chains.SPY, _bars: sessionDates.map((d, i) => ({ t: d, c: 600 + i })) } }, todayEt, nowIso, quoteFn, levSingles: LEVERAGED_ETF_SINGLES, levGroups: LEVERAGED_ETF_GROUPS, fetchers: { text, json, borrow: async () => ibkr } });
  // Extend the one-build histories so charts and trend columns have depth.
  const pcDays = dayList("2026-11-06", 250);
  crowd.putCall.history = pcDays.map((d, i) => [d, Math.round((0.9 + Math.sin(i / 9) * 0.12 + (r() - 0.5) * 0.08) * 100) / 100, Math.round((0.55 + Math.sin(i / 7) * 0.08 + (r() - 0.5) * 0.06) * 100) / 100, Math.round((1.3 + (r() - 0.5) * 0.3) * 100) / 100, 1.1, 1.25, 0.9]);
  crowd.putCall.stats = { total: { value: crowd.putCall.history[249][1], avg20: 0.92, z250: 0.4, pct250: 61 }, equity: { value: crowd.putCall.history[249][2], avg20: 0.56, z250: -0.8, pct250: 24 }, index: { value: 1.31, avg20: 1.28, z250: 0.2, pct250: 55 }, vix: { value: 1.12, avg20: 1.0, z250: 0.9, pct250: 80 }, spx: { value: 1.27, avg20: 1.2, z250: 0.6, pct250: 70 }, etp: { value: 0.88, avg20: 0.9, z250: -0.1, pct250: 45 } };
  for (const sym of Object.keys(crowd.stocktwits.bySymbol)) {
    const w = crowd.stocktwits.bySymbol[sym].watchers || 100000;
    const hist = dayList("2026-11-09", 60).map((d, i) => [d, Math.round(w * (0.9 + i / 600) + (r() - 0.5) * 200)]);
    crowd.stocktwits.bySymbol[sym] = { ...crowd.stocktwits.bySymbol[sym], history: hist, change1d: 120, change7d: 900, change30d: 2600, pct7d: Math.round((r() - 0.3) * 300) / 100, pct30d: 2.7 };
  }
  for (const sym of Object.keys(crowd.reddit.bySymbol)) {
    const m = crowd.reddit.bySymbol[sym].mentions || 0;
    crowd.reddit.bySymbol[sym].history = dayList("2026-11-09", 60).map((d) => [d, Math.round(m * (0.5 + r())), crowd.reddit.bySymbol[sym].rank, null]);
    crowd.reddit.bySymbol[sym].vsAvg7 = m ? Math.round((0.5 + r() * 2.5) * 100) / 100 : null;
  }
  for (const s of crowd.levFlows.rows) {
    if (s.missing) continue;
    const hist = dayList("2026-11-09", 90).map((d, i) => [d, Math.round(s.sharesOut * (0.8 + i / 450)), s.nav, Math.round(s.netAssets * (0.8 + i / 450))]);
    const d1 = hist[89][1] - hist[88][1], d5 = hist[89][1] - hist[84][1], d20 = hist[89][1] - hist[69][1];
    Object.assign(s, { history: hist, flowShares1d: d1, flowShares5d: d5, flowShares20d: d20, flowUsd1d: Math.round(d1 * s.nav), flowUsd5d: Math.round(d5 * s.nav), flowUsd20d: Math.round(d20 * s.nav), sharesChg5dPct: Math.round(d5 / hist[84][1] * 1000) / 10 });
  }
  crowd.levFlows.totals = { bullUsd5d: 420e6, bearUsd5d: -130e6, bullUsd1d: 60e6, bearUsd1d: 12e6 };
  crowd.rollup = (await import("../lib/crowd/index.mjs")).buildSymbolRollup(symbols, crowd);
  const open = [{ id: "TSLA-C-11/06/26-11:00", symbol: "TSLA", side: "call", entryDate: "2026-11-06" }, { id: "NVDA-P-11/05/26-15:30", symbol: "NVDA", side: "put", entryDate: "2026-11-05" }, { id: "JPM-C-11/03/26-11:00", symbol: "JPM", side: "call", entryDate: "2026-11-03" }].filter((t) => symbols.includes(t.symbol));
  const owner = buildCrowdOwner({ crowd, prior: { daily: dayList("2026-11-06", 12).map((d) => ({ date: d, gauges: {}, scores: {} })) }, openTrades: open, regime: { cell: "calm-trend", cellLabel: "Calm trend", era: "calm", character: "trend" }, nowIso, todayEt });
  return { crowd, owner, chains };
}

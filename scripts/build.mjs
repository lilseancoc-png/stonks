// Renders index.html — a single-purpose Option Contract Rater.
//
// Build-time: fetches Yahoo's option chain for a curated ticker list
// using the yahoo-finance2 client (handles consent cookie + crumb so
// it works from GitHub Actions runners — raw fetches to query1.* return
// 401 "Host not in allowlist") and writes per-ticker chains to
// data/<SYMBOL>.json. index.html embeds only a small manifest listing
// the available symbols and a build timestamp.
//
// Runtime: the page loads instantly (~30 KB) and fetches a ticker's
// chain (~30-60 KB) from the same origin only when the user selects it.
// The daily GitHub Actions workflow refreshes everything each market-day
// morning and evening.
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";

// Library prints a survey notice on first use and validates response
// schemas — silence both since Yahoo occasionally omits optional fields
// we don't read.
//
// Yahoo's consent endpoint refuses to set cookies for the default Node fetch
// User-Agent (the library throws "No set-cookie header present in Yahoo's
// response"). Sending a real desktop UA makes consent.yahoo.com behave and
// the crumb flow complete normally.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "index.html");
const DATA_DIR = resolve(ROOT, "data");

// Curated list of high-volume optionable US names. List size no longer
// affects page load (each chain is its own lazy-loaded data/<sym>.json),
// but the build still hits Yahoo serially with ~350ms pauses, so each
// added ticker adds ~2-3s of wall-clock time and a bit of rate-limit
// risk against MIN_SUCCESS_RATE.
export const TICKERS = [
  // Index & sector ETFs
  "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "SLV", "USO", "XLF", "XLE", "XLK",
  // Mega-caps
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO",
  // Other tech / semis
  "ORCL", "CRM", "ADBE", "TSM", "MU", "INTC", "DRAM", "SWKS",
  // SaaS / cloud
  "NOW", "SNOW", "NET", "DDOG", "CRWD", "ZS", "MDB", "OKTA", "PANW", "WDAY", "ZM", "DOCU", "TEAM",
  // Banks / payments
  "JPM", "BAC", "V", "MA",
  // Retail / consumer
  "WMT", "COST", "DIS", "BA", "MCD", "SBUX",
  // Healthcare / pharma
  "NVO", "LLY", "UNH", "JNJ", "PFE",
  // Energy
  "XOM", "CVX",
  // Travel / modern consumer
  "UBER", "ABNB",
  // High-volatility / popular
  "COIN", "PLTR", "SHOP", "BABA", "NIO",
  "GME", "AMC",
];

// Sector mapping — surfaced in the searchable combobox so users can filter
// by sector ("software", "semis", "pharma"). Mirrors the comment blocks above.
const SECTORS = {
  // Index & sector ETFs
  SPY: "ETF", QQQ: "ETF", IWM: "ETF", DIA: "ETF", TLT: "ETF", GLD: "ETF",
  SLV: "ETF", USO: "ETF", XLF: "ETF", XLE: "ETF", XLK: "ETF",
  // Mega-caps
  AAPL: "Mega-cap tech", MSFT: "Mega-cap tech", NVDA: "Mega-cap tech",
  AMZN: "Mega-cap tech", GOOGL: "Mega-cap tech", META: "Mega-cap tech",
  TSLA: "Mega-cap tech", AMD: "Semis", NFLX: "Mega-cap tech", AVGO: "Semis",
  // Other tech / semis
  ORCL: "Software", CRM: "Software", ADBE: "Software",
  TSM: "Semis", MU: "Semis", INTC: "Semis", DRAM: "Semis", SWKS: "Semis",
  // SaaS / cloud
  NOW: "Software", SNOW: "Software", NET: "Software", DDOG: "Software",
  CRWD: "Software", ZS: "Software", MDB: "Software", OKTA: "Software",
  PANW: "Software", WDAY: "Software", ZM: "Software", DOCU: "Software", TEAM: "Software",
  // Banks / payments
  JPM: "Bank", BAC: "Bank", V: "Payments", MA: "Payments",
  // Retail / consumer
  WMT: "Retail", COST: "Retail", DIS: "Media", BA: "Industrial",
  MCD: "Restaurants", SBUX: "Restaurants",
  // Healthcare / pharma
  NVO: "Pharma", LLY: "Pharma", UNH: "Healthcare",
  JNJ: "Pharma", PFE: "Pharma",
  // Energy
  XOM: "Energy", CVX: "Energy",
  // Travel / modern consumer
  UBER: "Consumer", ABNB: "Consumer",
  // High-volatility / popular
  COIN: "Crypto", PLTR: "Software", SHOP: "Software",
  BABA: "China tech", NIO: "China tech",
  GME: "Meme", AMC: "Meme",
};

// Slimmed taxonomy — only the sectors and sub-industries that have a real
// story we want to track. The narratives card is structured
// Sector → Sector overview → Sub-industry narratives, so this list controls
// the tab strip across the top. "Precious Metals" sits at the end as a
// macro-signal block (GLD + SLV), distinct from the equity sectors above it.
const SECTOR_ORDER = [
  "Technology",
  "Consumer Cyclical",
  "Communication Services",
  "Industrials",
  "Healthcare",
  "Financials",
  "Consumer Defensive",
  "Precious Metals",
];

// Sub-industries under each sector. The AI emits a sector-level overview
// (bullish/bearish/mixed + thesis + watch-for items) PLUS one or more
// narratives per sub-industry. Sub-industries without an active narrative
// surface as a "watching, no active narrative" placeholder at the bottom.
const INDUSTRIES_BY_SECTOR = {
  "Technology": [
    "Software Infrastructure",
    "Semiconductors",
    "Communication Equipment",
    "Computer Hardware",
    "Semiconductor Equipment & Materials",
    "Consumer Electronics",
    "Software Applications",
  ],
  "Consumer Cyclical": [
    "Internet Retail",
    "Restaurants",
    "Apparel Retail",
    "Residential Construction",
  ],
  "Communication Services": [
    "Internet Content & Information",
    "Entertainment",
    "Electronic Gaming & Multimedia",
    "Advertising Agencies",
  ],
  "Industrials": [
    "Electrical Equipment & Parts",
    "Integrated Freight & Logistics",
    "Aerospace & Defense",
    "Farm & Heavy Construction Machinery",
  ],
  "Healthcare": [
    "Drug Manufacturers - General",
    "Healthcare Plans",
  ],
  "Financials": [
    "Banks - Diversified",
    "Credit Services",
  ],
  "Consumer Defensive": [
    "Discount Stores",
  ],
  "Precious Metals": [
    "Gold",
    "Silver",
  ],
};

// Each curated ticker → its Morningstar-style industry. ETFs are intentionally
// omitted; they sit outside the sector tabs and only surface inside narratives'
// longs/shorts chips.
const INDUSTRY_OF_TICKER = {
  AAPL: "Consumer Electronics",
  MSFT: "Software Infrastructure",
  NVDA: "Semiconductors",
  AMZN: "Internet Retail",
  GOOGL: "Internet Content & Information",
  META: "Internet Content & Information",
  AMD: "Semiconductors",
  NFLX: "Entertainment",
  AVGO: "Semiconductors",
  ORCL: "Software Infrastructure",
  CRM: "Software Applications",
  ADBE: "Software Applications",
  TSM: "Semiconductors",
  MU: "Semiconductors",
  INTC: "Semiconductors",
  DRAM: "Semiconductors",
  SWKS: "Semiconductors",
  NOW: "Software Applications",
  SNOW: "Software Infrastructure",
  NET: "Software Infrastructure",
  DDOG: "Software Applications",
  CRWD: "Software Infrastructure",
  ZS: "Software Infrastructure",
  MDB: "Software Infrastructure",
  OKTA: "Software Infrastructure",
  PANW: "Software Infrastructure",
  WDAY: "Software Applications",
  ZM: "Software Applications",
  DOCU: "Software Applications",
  TEAM: "Software Applications",
  JPM: "Banks - Diversified",
  BAC: "Banks - Diversified",
  V: "Credit Services",
  MA: "Credit Services",
  WMT: "Discount Stores",
  COST: "Discount Stores",
  DIS: "Entertainment",
  BA: "Aerospace & Defense",
  MCD: "Restaurants",
  SBUX: "Restaurants",
  NVO: "Drug Manufacturers - General",
  LLY: "Drug Manufacturers - General",
  UNH: "Healthcare Plans",
  JNJ: "Drug Manufacturers - General",
  PFE: "Drug Manufacturers - General",
  UBER: "Software Applications",
  PLTR: "Software Infrastructure",
  SHOP: "Software Applications",
  BABA: "Internet Retail",
  GLD: "Gold",
  SLV: "Silver",
  // Tickers intentionally without an industry mapping (TSLA, NIO, COIN, GME,
  // AMC, XOM, CVX, ABNB) sit outside the slimmed taxonomy — they still trade
  // and get option-graded, but the narrative engine won't slot them into a
  // sub-industry. They can still surface as long/short chips on narratives
  // that ride them.
};

// industry → parent sector, built once from INDUSTRIES_BY_SECTOR.
const SECTOR_OF_INDUSTRY = (function () {
  const m = {};
  for (const sector of SECTOR_ORDER) {
    for (const ind of INDUSTRIES_BY_SECTOR[sector] || []) {
      m[ind] = sector;
    }
  }
  return m;
})();

const VALID_INDUSTRY_SET = new Set(Object.keys(SECTOR_OF_INDUSTRY));

// Pick the canonical industry for a narrative. Trusts an exact match from the
// AI; otherwise votes by counting the per-ticker industries among the longs
// (then shorts) and returns the most common. Returns "Uncategorized" only
// when nothing resolves — the caller drops those narratives anyway since they
// also lack longs/shorts.
function resolveNarrativeIndustry(rawIndustry, longs, shorts) {
  if (rawIndustry && typeof rawIndustry === "string") {
    const trimmed = rawIndustry.trim();
    if (VALID_INDUSTRY_SET.has(trimmed)) return trimmed;
    // Light case-insensitive match — useful when the model emits a near-match
    // like "semiconductors" instead of "Semiconductors".
    for (const canonical of VALID_INDUSTRY_SET) {
      if (canonical.toLowerCase() === trimmed.toLowerCase()) return canonical;
    }
  }
  const counts = new Map();
  const vote = (sym, weight) => {
    const ind = INDUSTRY_OF_TICKER[sym];
    if (!ind) return;
    counts.set(ind, (counts.get(ind) || 0) + weight);
  };
  for (const s of longs || []) vote(s, 2);
  for (const s of shorts || []) vote(s, 1);
  let best = null;
  let bestCount = 0;
  for (const [ind, c] of counts) {
    if (c > bestCount) {
      best = ind;
      bestCount = c;
    }
  }
  return best || "Uncategorized";
}

// ±50% strikes around spot — captures lottery OTM and deep-ITM strikes
// without any extra Yahoo calls (we already receive the full chain, this
// just controls how much of it we keep).
const STRIKE_BAND = 0.50;
// Up from 6 — pushes coverage to ~late-2027 LEAPS for liquid names. Each
// added expiration costs one extra Yahoo call per ticker with a 250ms
// politeness pause, so the build adds ~2 min wall-clock. Less-liquid
// names asymptote at whatever Yahoo returns (the .slice() handles it).
const MAX_EXPIRATIONS = 15;
// Yahoo intermittently 401s GitHub Actions runners ("Host not in allowlist")
// or rate-limits after a burst. Retry transient failures, but bail on the
// existing site if too many tickers fail — better to serve yesterday's data
// than half a chain.
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = [1000, 3000, 8000];
const MIN_SUCCESS_RATE = 0.75;

function isTransientYahooError(err) {
  const msg = String(err?.message || err || "");
  if (/allowlist|401|403|429|5\d\d|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg)) return true;
  // yahoo-finance2 schema validation errors are not transient — don't retry.
  if (/validation|schema|FailedYahooValidationError/i.test(msg)) return false;
  // Default: retry. Most non-validation throws here are network-shaped.
  return true;
}

async function fetchTickerChainWithRetry(symbol) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const result = await fetchTickerChain(symbol);
      if (attempt > 1) console.log(`    ↻ ${symbol} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt === FETCH_RETRIES || !isTransientYahooError(err)) break;
      const wait = FETCH_BACKOFF_MS[attempt - 1] ?? 8000;
      console.log(`    ↻ ${symbol} attempt ${attempt} failed (${err.message}) — retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchYahooOptions(symbol, expDate) {
  // yahoo-finance2 returns one expiration per call (the requested date,
  // or the nearest expiration when omitted) plus the full expirationDates
  // list as Date[]. Validation is silenced globally above.
  const opts = expDate ? { date: expDate } : {};
  return await yahooFinance.options(symbol, opts);
}

function toEpochSec(d) {
  return Math.floor((d instanceof Date ? d.getTime() : d) / 1000);
}

// Yahoo contract → compact shape. Single-letter keys keep each per-ticker
// payload small. Contract symbol is intentionally omitted — the runtime
// addresses strikes by array index, not by symbol.
function compressContract(c) {
  return {
    s: c.strike ?? null,
    b: c.bid ?? null,
    a: c.ask ?? null,
    l: c.lastPrice ?? null,
    iv: c.impliedVolatility ?? null,
    oi: c.openInterest ?? null,
    v: c.volume ?? null,
  };
}

// --- Historical bars + technical indicators -----------------------------
// Pulls ~7 months of daily closes (high/low/close) per ticker. Enough warmup
// to run a 14-period RSI, a 12/26/9 MACD, and rolling 20-/50-day swing
// support/resistance off the same series. Cost is one extra Yahoo call per
// ticker (chart endpoint), added to the per-expiration calls already running
// inside fetchTickerChain — kept non-fatal so the grader still works when
// Yahoo hiccups on the chart side.
const HISTORY_LOOKBACK_DAYS = 220;

async function fetchHistoricalBars(symbol) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - HISTORY_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const result = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: "1d",
  });
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  return quotes
    .filter((q) => q && q.close != null && q.high != null && q.low != null)
    .map((q) => ({ c: q.close, h: q.high, l: q.low }));
}

function emaSeries(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// Wilder's RSI(14): seed with simple average over the first 14 deltas, then
// smooth subsequent gains/losses with a 1/period weight (the standard RSI
// recursion). Returns null if there aren't enough bars to seed.
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgG / avgL);
}

// Standard MACD(12,26,9). The signal EMA is seeded from the MACD line only
// after the slow EMA has had time to mature (slice off slow-1 warmup bars) so
// the signal isn't dragged toward zero by the early-period transient.
function computeMACD(closes, fast = 12, slow = 26, sig = 9) {
  if (closes.length < slow + sig) return null;
  const eF = emaSeries(closes, fast);
  const eS = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) => eF[i] - eS[i]);
  const signalLine = emaSeries(macdLine.slice(slow - 1), sig);
  const lineNow = macdLine[macdLine.length - 1];
  const sigNow = signalLine[signalLine.length - 1];
  return { line: lineNow, signal: sigNow, hist: lineNow - sigNow };
}

// Rolling-window support (lowest low) and resistance (highest high). Two
// windows — 20 trading days ≈ one month of swings, 50 trading days ≈ the
// quarter-ish picture — captures both the near-term and the longer-term
// levels worth watching when picking strikes.
function computeSupportResistance(bars) {
  if (bars.length < 20) return null;
  const tail = (n) => bars.slice(-n);
  const minLow = (arr) => arr.reduce((m, b) => (b.l < m ? b.l : m), Infinity);
  const maxHigh = (arr) => arr.reduce((m, b) => (b.h > m ? b.h : m), -Infinity);
  const w20 = tail(20);
  const w50 = bars.length >= 20 ? tail(Math.min(50, bars.length)) : null;
  return {
    s20: minLow(w20),
    r20: maxHigh(w20),
    s50: w50 ? minLow(w50) : null,
    r50: w50 ? maxHigh(w50) : null,
  };
}

// Annualized realized volatility from log returns over `window` recent bars.
// Returns null if there aren't enough closes. Uses sqrt(252) trading days.
function annualizedRealizedVol(closes, window) {
  if (!closes || closes.length < window + 1) return null;
  const tail = closes.slice(-window - 1);
  const rets = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1];
    const curr = tail[i];
    if (!(prev > 0) || !(curr > 0)) return null;
    rets.push(Math.log(curr / prev));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// Volatility "regime" snapshot: today's 30-day realized vol and its
// percentile within the rolling 30-day RV series across the available
// history. Useful as a "is this name running hot vs. its own past?" signal
// when paired with the current chain's IV.
function computeVolRegime(bars, window = 30) {
  if (!bars || bars.length < window + 5) return null;
  const closes = bars.map((b) => b.c);
  const today = annualizedRealizedVol(closes, window);
  if (today == null) return null;
  // Build the historical distribution: one annualized-vol sample per
  // trailing-window position across the available bars.
  const series = [];
  for (let end = window; end <= closes.length; end++) {
    const v = annualizedRealizedVol(closes.slice(0, end), window);
    if (v != null && isFinite(v)) series.push(v);
  }
  if (series.length < 10) return null;
  const sorted = series.slice().sort((a, b) => a - b);
  const below = sorted.filter((v) => v < today).length;
  const pctile = Math.round((below / sorted.length) * 100);
  const round4 = (n) => Math.round(n * 10000) / 10000;
  return {
    rv30: round4(today),
    rv30Pctile: pctile,
    samples: series.length,
  };
}

function computeTechnicals(bars) {
  if (!bars || bars.length < 27) return null;
  const closes = bars.map((b) => b.c);
  const rsi = computeRSI(closes, 14);
  const macd = computeMACD(closes, 12, 26, 9);
  const sr = computeSupportResistance(bars);
  const volRegime = computeVolRegime(bars, 30);
  const round2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
  const round4 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 10000) / 10000);
  return {
    asOfClose: round2(closes[closes.length - 1]),
    bars: closes.length,
    rsi: rsi != null ? round2(rsi) : null,
    macd: macd ? { line: round4(macd.line), signal: round4(macd.signal), hist: round4(macd.hist) } : null,
    sr: sr
      ? { s20: round2(sr.s20), r20: round2(sr.r20), s50: round2(sr.s50), r50: round2(sr.r50) }
      : null,
    volRegime,
  };
}

// Fundamentals + last earnings pull. quoteSummary lets us request multiple
// modules in a single round trip — we ask for the key valuation / health /
// growth / margin / cash flow / analyst-target slices plus the earnings
// schedule. Failure is non-fatal: the page still grades options without it.
async function fetchFundamentals(symbol) {
  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "earnings",
    "calendarEvents",
    "earningsHistory",
    "earningsTrend",
    "price",
  ];
  let res;
  try {
    res = await yahooFinance.quoteSummary(symbol, { modules });
  } catch (err) {
    console.log(`    ⚠ ${symbol} fundamentals fetch failed: ${err.message}`);
    return null;
  }
  if (!res) return null;
  const num = (v) => {
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "object" && v && "raw" in v && typeof v.raw === "number") return v.raw;
    return null;
  };
  const pct = (v) => {
    const n = num(v);
    return n == null ? null : n * 100;
  };
  const sd = res.summaryDetail || {};
  const ks = res.defaultKeyStatistics || {};
  const fd = res.financialData || {};
  const er = res.earnings || {};
  const ev = res.calendarEvents || {};
  const eh = res.earningsHistory || {};
  const et = res.earningsTrend || {};
  const pr = res.price || {};

  // Most recent reported quarter from earningsHistory (Yahoo orders -4q..0q;
  // pick the latest with an actual EPS reported). epsActual / estimate are
  // already plain numbers in yahoo-finance2.
  let lastQuarter = null;
  const history = Array.isArray(eh.history) ? eh.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const actual = num(h?.epsActual);
    if (actual == null) continue;
    const estimate = num(h?.epsEstimate);
    const surprisePct = num(h?.surprisePercent);
    let date = null;
    if (h.quarter) {
      const t = h.quarter instanceof Date ? h.quarter : new Date(h.quarter);
      if (!isNaN(t.getTime())) date = t.toISOString().slice(0, 10);
    }
    lastQuarter = {
      date,
      period: h.period || null,
      epsActual: actual,
      epsEstimate: estimate,
      surprisePct: surprisePct != null ? surprisePct * 100 : null,
    };
    break;
  }

  // Full quarter-by-quarter EPS history (oldest → newest) for the Robinhood-style
  // dot chart. Yahoo returns up to 4 quarters in earningsHistory.history; we keep
  // any row that has at least one of actual/estimate so blanks can still slot in.
  const earningsHistory = [];
  for (const h of history) {
    const actual = num(h?.epsActual);
    const estimate = num(h?.epsEstimate);
    if (actual == null && estimate == null) continue;
    let date = null;
    if (h.quarter) {
      const t = h.quarter instanceof Date ? h.quarter : new Date(h.quarter);
      if (!isNaN(t.getTime())) date = t.toISOString().slice(0, 10);
    }
    const surprisePct = num(h?.surprisePercent);
    earningsHistory.push({
      date,
      period: h.period || null,
      epsActual: actual,
      epsEstimate: estimate,
      surprisePct: surprisePct != null ? surprisePct * 100 : null,
    });
  }

  // Next earnings date from calendarEvents.earnings.earningsDate (an array of
  // Date objects — Yahoo gives a single date once it's confirmed, otherwise a
  // start/end window).
  let nextEarnings = null;
  const ed = ev?.earnings?.earningsDate;
  if (Array.isArray(ed) && ed.length) {
    const first = ed[0] instanceof Date ? ed[0] : new Date(ed[0]);
    if (!isNaN(first.getTime())) nextEarnings = first.toISOString().slice(0, 10);
  }

  // Current-quarter / current-year growth estimates from earningsTrend. The
  // trend array is keyed by period: 0q (current Q), +1q, 0y (current FY), +1y.
  const trend = Array.isArray(et.trend) ? et.trend : [];
  const findTrend = (p) => trend.find((t) => t?.period === p) || null;
  const tq = findTrend("0q");
  const ty = findTrend("0y");

  return {
    name: pr.shortName || pr.longName || null,
    marketCap: num(sd.marketCap) ?? num(pr.marketCap),
    trailingPE: num(sd.trailingPE),
    forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
    pegRatio: num(ks.pegRatio),
    priceToBook: num(ks.priceToBook),
    priceToSales: num(sd.priceToSalesTrailing12Months),
    profitMargin: pct(fd.profitMargins ?? ks.profitMargins),
    operatingMargin: pct(fd.operatingMargins),
    grossMargin: pct(fd.grossMargins),
    returnOnEquity: pct(fd.returnOnEquity),
    returnOnAssets: pct(fd.returnOnAssets),
    revenueGrowthYoy: pct(fd.revenueGrowth),
    earningsGrowthYoy: pct(fd.earningsGrowth),
    earningsQuarterlyGrowthYoy: pct(ks.earningsQuarterlyGrowth),
    debtToEquity: num(fd.debtToEquity),
    currentRatio: num(fd.currentRatio),
    quickRatio: num(fd.quickRatio),
    freeCashFlow: num(fd.freeCashflow),
    operatingCashFlow: num(fd.operatingCashflow),
    totalCash: num(fd.totalCash),
    totalDebt: num(fd.totalDebt),
    revenue: num(fd.totalRevenue),
    dividendYield: pct(sd.dividendYield),
    payoutRatio: pct(sd.payoutRatio),
    beta: num(sd.beta) ?? num(ks.beta),
    fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
    targetMeanPrice: num(fd.targetMeanPrice),
    targetHighPrice: num(fd.targetHighPrice),
    targetLowPrice: num(fd.targetLowPrice),
    recommendationKey: fd.recommendationKey || null,
    numberOfAnalystOpinions: num(fd.numberOfAnalystOpinions),
    lastQuarter,
    earningsHistory: earningsHistory.slice(-8),
    nextEarningsDate: nextEarnings,
    growthEstimateCurQ: tq ? pct(tq.growth) : null,
    growthEstimateCurY: ty ? pct(ty.growth) : null,
    revenueEstimateCurQ: tq?.revenueEstimate ? num(tq.revenueEstimate.avg) : null,
    revenueEstimateCurY: ty?.revenueEstimate ? num(ty.revenueEstimate.avg) : null,
  };
}

async function fetchTickerChain(symbol) {
  const initial = await fetchYahooOptions(symbol);
  const spot =
    initial.quote?.regularMarketPrice ??
    initial.quote?.postMarketPrice ??
    initial.quote?.preMarketPrice ??
    null;
  const allExp = initial.expirationDates || [];
  if (!spot) throw new Error(`No spot for ${symbol}`);
  if (!allExp.length) throw new Error(`No expirations for ${symbol}`);

  const expirations = allExp.slice(0, MAX_EXPIRATIONS);
  const minK = spot * (1 - STRIKE_BAND);
  const maxK = spot * (1 + STRIKE_BAND);
  const filterStrike = (c) => c.strike != null && c.strike >= minK && c.strike <= maxK;

  const chains = {};
  for (let i = 0; i < expirations.length; i++) {
    const exp = expirations[i];
    const expSec = toEpochSec(exp);
    let chainEntry;
    if (i === 0 && initial.options?.[0]) {
      chainEntry = initial.options[0];
    } else {
      await new Promise((r) => setTimeout(r, 250));
      const r = await fetchYahooOptions(symbol, exp);
      chainEntry = r.options?.[0];
    }
    if (!chainEntry) continue;
    chains[expSec] = {
      c: (chainEntry.calls || []).filter(filterStrike).map(compressContract),
      p: (chainEntry.puts || []).filter(filterStrike).map(compressContract),
    };
  }

  // Pull daily history in parallel with the per-expiration loop above by
  // kicking off the chart call last (it's cheap and we already have the spot
  // pinned). Failure is non-fatal — option grading still works without the
  // momentum panel; the runtime hides the technicals card if it's missing.
  let technicals = null;
  try {
    const bars = await fetchHistoricalBars(symbol);
    technicals = computeTechnicals(bars);
  } catch (err) {
    console.log(`    ⚠ ${symbol} historical/technicals failed: ${err.message}`);
  }

  // Fundamentals + earnings — separate Yahoo call (quoteSummary). ETFs return
  // mostly empty modules, so the renderer hides the card when there's nothing
  // useful to show.
  const fundamentals = await fetchFundamentals(symbol);

  return {
    spot,
    expirations: Object.keys(chains).map(Number).sort((a, b) => a - b),
    chains,
    technicals,
    fundamentals,
  };
}

// Annualized 13-week T-bill yield as a decimal (e.g. 0.0452). Used as the
// risk-free rate for Black-Scholes Greeks. Falls back to a static 4.5% if
// Yahoo's `^IRX` is unreachable so the build stays robust.
const FALLBACK_RISK_FREE_RATE = 0.045;

async function fetchRiskFreeRate() {
  try {
    const q = await yahooFinance.quote("^IRX");
    const pct = q?.regularMarketPrice;
    if (typeof pct === "number" && isFinite(pct) && pct >= 0 && pct < 20) {
      const rate = pct / 100;
      console.log(`Risk-free rate (^IRX): ${(rate * 100).toFixed(2)}%`);
      return rate;
    }
    console.warn(`^IRX returned unexpected price: ${pct}. Using fallback ${FALLBACK_RISK_FREE_RATE * 100}%.`);
  } catch (err) {
    console.warn(`^IRX fetch failed (${err.message}). Using fallback ${FALLBACK_RISK_FREE_RATE * 100}%.`);
  }
  return FALLBACK_RISK_FREE_RATE;
}

// Run tickers in parallel with a bounded concurrency cap. Each ticker still
// paces its own per-expiration Yahoo calls with the existing 250ms gap inside
// fetchTickerChain, so the effective request rate is at most TICKER_CONCURRENCY
// times the serial baseline — still well below typical rate-limit thresholds.
const TICKER_CONCURRENCY = 3;

async function fetchAllTickerChains() {
  const out = {};
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= TICKERS.length) return;
      const sym = TICKERS[i];
      try {
        out[sym] = await fetchTickerChainWithRetry(sym);
        console.log(`  ✓ ${sym} — spot $${out[sym].spot.toFixed(2)}, ${out[sym].expirations.length} expirations`);
      } catch (err) {
        console.error(`  ✗ ${sym} — ${err.message} (gave up after ${FETCH_RETRIES} attempts)`);
      }
      // Small per-worker politeness pause so adjacent tickers on the same
      // worker don't slam Yahoo back-to-back after the inner expiration loop.
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  const workers = Array.from({ length: Math.min(TICKER_CONCURRENCY, TICKERS.length) }, worker);
  await Promise.all(workers);
  return out;
}

function nyTimestamp() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function narrativesSection() {
  // Card chrome only — the sector tab strip, industry rows and narrative
  // cards are rendered client-side from the inline manifest in app.js so we
  // don't have to escape narrative text through Node's template literal.
  return `<section class="card" id="narratives-section">
    <header class="card-header">
      <h2 class="card-title">Active market narratives</h2>
      <span class="card-eyebrow" id="narratives-count" aria-live="polite"></span>
    </header>
    <p class="hint">The stories currently driving capital — AI capex, GLP-1, tariffs, rotations. Each sector tab opens to its dominant overview, then sub-industry narratives, each with a <em>Watch for narrative shift</em> panel listing the red flags that would break the thesis.</p>
    <div id="narratives-tabs" class="narr-tabs" role="tablist" aria-label="Market sectors"></div>
    <div id="narratives-panel" class="narr-panel" role="tabpanel"></div>
    <div id="narratives-empty" class="narr-empty" hidden>No narratives recorded for this build.</div>
    <div id="narratives-ended" class="narr-ended"></div>
    <div id="narratives-macro" class="narr-macro"></div>
  </section>`;
}

function unusualFlowSection() {
  // Card chrome only — the per-ticker rows and contract chips render
  // client-side from the inline manifest in app.js. Populated by the hourly
  // GitHub Actions scan (scripts/scan-unusual.mjs). The controls bar
  // (search/side/hot-only/sort + collapse-all) and the section collapse
  // chevron are also wired in app.js. Rows render collapsed by default so
  // the section stays a scannable list of headers.
  return `<section class="card flow-card" id="flow-section">
    <header class="card-header flow-card-header">
      <button type="button" id="flow-collapse" class="flow-collapse-btn" aria-expanded="true" aria-controls="flow-body" title="Collapse section">
        <svg class="flow-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <h2 class="card-title">Unusual options flow</h2>
      </button>
      <span class="card-eyebrow" id="flow-eyebrow" aria-live="polite"></span>
    </header>
    <div id="flow-body" class="flow-body">
      <p class="hint">Block/sweep flow: 5–30% OTM contracts that picked up at least 2,000 contracts of volume this hour (4,000 if expiring within 2 weeks) with vol &gt; OI. The kind of single-shot directional buying that often signals informed positioning. Hourly scan, front 3 expirations.</p>
      <div class="flow-controls" role="toolbar" aria-label="Filter unusual flow">
        <label class="flow-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="flow-search-input" placeholder="Search ticker (e.g. NVDA, TSLA)" autocomplete="off" spellcheck="false" />
          <button type="button" id="flow-search-clear" class="flow-search-clear" aria-label="Clear search" hidden>&times;</button>
        </label>
        <div class="flow-side-filter" role="radiogroup" aria-label="Filter by side">
          <button type="button" class="flow-pill is-on" data-side="all" role="radio" aria-checked="true">All</button>
          <button type="button" class="flow-pill" data-side="call" role="radio" aria-checked="false">Calls</button>
          <button type="button" class="flow-pill" data-side="put" role="radio" aria-checked="false">Puts</button>
        </div>
        <label class="flow-toggle">
          <input type="checkbox" id="flow-near-only" />
          <span>Near-term ≤14d</span>
        </label>
        <label class="flow-sort">
          <select id="flow-sort-select" aria-label="Sort">
            <option value="delta">Biggest hourly delta</option>
            <option value="contracts">Most contracts</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <button type="button" id="flow-expand-toggle" class="flow-action-btn" aria-pressed="true">Expand all</button>
      </div>
      <div id="flow-list" class="flow-list" role="list"></div>
      <div id="flow-empty" class="flow-empty" hidden>No unusual flow flagged in the latest scan.</div>
      <div id="flow-no-results" class="flow-empty" hidden>No tickers match these filters.</div>
    </div>
  </section>`;
}

function optionEvalSection() {
  // The ticker combobox + segmented call/put control + chain selects all
  // bind live in app.js — picking a ticker auto-loads its chain and any
  // change to type/expiry/strike re-grades immediately. No Evaluate button.
  return `<section class="card" id="opt-eval-section">
    <header class="card-header">
      <h2 class="card-title">Grade a contract</h2>
    </header>
    <p class="hint">Type to search a curated ticker, pick a call or put, then dial in expiry and strike. The verdict regrades as you go.</p>
    <div class="opt-controls">
      <div class="combo" id="symbol-combo">
        <input type="text" id="symbol-input" role="combobox"
               aria-expanded="false" aria-controls="symbol-listbox"
               aria-autocomplete="list"
               placeholder="Search ticker or sector…"
               autocomplete="off" spellcheck="false">
        <button type="button" class="combo-clear" id="symbol-clear" aria-label="Clear" tabindex="-1">&times;</button>
        <ul id="symbol-listbox" role="listbox" hidden></ul>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Option type">
        <input type="radio" name="opt-type" id="opt-type-call" value="call" checked>
        <label for="opt-type-call">Call</label>
        <input type="radio" name="opt-type" id="opt-type-put" value="put">
        <label for="opt-type-put">Put</label>
      </div>
    </div>
    <div id="opt-chain-row" class="opt-chain-row" hidden>
      <label class="field">
        <span class="field-label">Expiration</span>
        <select id="opt-expiry" aria-label="Expiration"></select>
      </label>
      <label class="field">
        <span class="field-label">Strike</span>
        <select id="opt-strike" aria-label="Strike"></select>
      </label>
    </div>
    <div id="opt-eval-status" class="opt-status" role="status"></div>
    <div id="opt-live-quote" class="opt-live" hidden aria-live="polite"></div>
    <div id="opt-live-refresh" class="opt-live-refresh" hidden aria-live="polite"></div>
    <div id="opt-max-pain" class="opt-max-pain" hidden aria-live="polite"></div>
    <div id="opt-narr-chips" class="opt-narr-chips" hidden aria-label="Narratives this ticker rides"></div>
    <div id="opt-analysis" class="opt-analysis" hidden>
      <div class="opt-tabs" role="tablist" aria-label="Ticker analysis">
        <button type="button" class="opt-tab" role="tab" aria-selected="true" aria-controls="opt-tab-pane-fund" id="opt-tab-btn-fund" data-tab="fund">Fundamentals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-tech" id="opt-tab-btn-tech" data-tab="tech">Technicals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-news" id="opt-tab-btn-news" data-tab="news">News</button>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-fund" aria-labelledby="opt-tab-btn-fund">
        <section id="opt-fundamentals" class="opt-fund" hidden aria-label="Fundamentals and earnings for this ticker">
          <header class="opt-fund-head">
            <h3 class="opt-fund-title">Fundamentals &amp; earnings</h3>
            <span id="opt-fund-verdict" class="opt-fund-verdict"></span>
          </header>
          <p id="opt-fund-summary" class="opt-fund-summary"></p>
          <div id="opt-fund-recap" class="opt-fund-recap" hidden></div>
          <div class="opt-fund-columns">
            <div class="opt-fund-col opt-fund-pos">
              <div class="opt-fund-col-head">Positives</div>
              <ul id="opt-fund-pos-list" class="opt-fund-list"></ul>
            </div>
            <div class="opt-fund-col opt-fund-neg">
              <div class="opt-fund-col-head">Negatives</div>
              <ul id="opt-fund-neg-list" class="opt-fund-list"></ul>
            </div>
          </div>
          <div id="opt-fund-metrics" class="opt-fund-metrics"></div>
          <div id="opt-fund-earnings-history" class="opt-fund-eh" hidden></div>
          <p class="opt-fund-foot">Verdict + bullets are AI-generated from Yahoo's last-reported fundamentals and earnings. For information only — cross-check before trading.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-tech" aria-labelledby="opt-tab-btn-tech" hidden>
        <section id="opt-technicals" class="opt-tech" hidden aria-label="Technical signals for this ticker">
          <header class="opt-tech-head">
            <h3 class="opt-tech-title">Technical signals</h3>
            <span class="opt-tech-sub">Momentum &amp; recent price structure on the daily chart</span>
          </header>
          <div class="opt-tech-grid" id="opt-tech-grid"></div>
          <p class="opt-tech-foot">Indicators are computed at build time from ~6 months of Yahoo daily closes. Use them as context for your option strike pick — they describe the stock, not the contract itself.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-news" aria-labelledby="opt-tab-btn-news" hidden>
        <div id="opt-news-pane" class="opt-news-pane"></div>
      </div>
    </div>
    <div class="opt-result-wrap">
      <div id="opt-result-sticky" class="opt-result-sticky" hidden></div>
      <div id="opt-eval-result" class="opt-result"></div>
    </div>
    <details class="opt-explainer" id="opt-grade-explainer">
      <summary>How is the grade computed?</summary>
      <div class="opt-explainer-body">
        <p>Each contract picks up a <b>Spread</b>, <b>Delta</b>, and <b>Theta</b> grade, then the overall verdict aggregates them:</p>
        <ul>
          <li>2+ bad &rarr; <b>Poor contract</b></li>
          <li>1 bad &rarr; <b>Mixed &mdash; proceed with caution</b></li>
          <li>2+ good &rarr; <b>Good contract</b></li>
          <li>otherwise &rarr; <b>Acceptable</b></li>
        </ul>
        <p>A clear <b>news tailwind</b> or <b>headwind</b> can nudge an <em>Acceptable</em> verdict to Good or Poor based on the AI-summarized headline sentiment.</p>
        <h4>Per-metric thresholds</h4>
        <ul>
          <li><b>Spread:</b> Tight (&le;5% of mid), Moderate (5&ndash;15%), Wide (&gt;15%)</li>
          <li><b>Delta:</b> Balanced (0.40&ndash;0.70), Slightly OTM (0.30&ndash;0.40), Deep ITM (&gt;0.70), Far OTM (&lt;0.30)</li>
          <li><b>Theta:</b> Slow decay (&lt;1% of mid/day), Normal (1&ndash;3%), Bleeding (&gt;3%)</li>
          <li><b>Liquidity (open interest):</b> Thin (&lt;10), Light (&lt;100), Liquid (&ge;100)</li>
          <li><b>30d realized vol:</b> Calm (bottom 30% of this name&rsquo;s own history), Normal, Elevated (top 30%)</li>
        </ul>
        <h4>YES / NO buy badge</h4>
        <p>The binary badge is independent of the Good/Mixed/Poor verdict. It falls to <b>NO</b> immediately for any of these mechanical disqualifiers:</p>
        <ul>
          <li>Wide spread, Far-OTM delta, or Bleeding theta</li>
          <li>&le;3 days to expiry (gamma and theta are extreme)</li>
          <li>Premium that is &gt;80% time-value with &lt;14 days to expiry</li>
        </ul>
        <p>Otherwise it scores <b>news</b> (&plusmn;2), <b>RSI</b> + <b>MACD</b> (&plusmn;1 each), and <b>fundamentals</b> verdict (&plusmn;1). The score is multiplied by the option direction (+1 for calls, &minus;1 for puts). It clears to <b>YES</b> when either: aligned score &ge;+2 with no opposing signals, or two &ldquo;good&rdquo; mechanical grades with nothing opposing the direction.</p>
        <p class="opt-explainer-foot">All thresholds are simple heuristics, not optimal strategies. For information only &mdash; not investment advice.</p>
      </div>
    </details>
  </section>
  <section class="card" id="opt-manual-section">
    <details class="opt-manual-details">
      <summary class="card-header">
        <h2 class="card-title">Grade your own contract</h2>
        <span class="opt-manual-trigger-sub">paste from your broker</span>
      </summary>
      <div class="opt-manual-body">
        <p class="hint">Paste numbers straight off Robinhood, Schwab, etc. — we strip <code>$</code>, <code>%</code>, commas, and size suffixes. IV / OI / volume are optional; without IV the Greeks are skipped.</p>
        <form id="opt-manual-form" class="opt-manual-grid">
      <label class="opt-manual-field opt-manual-paste">
        <span class="opt-manual-field-label">Paste contract symbol <span class="opt-manual-opt">optional · fills type / strike / expiry</span></span>
        <input id="m-paste" type="text" placeholder="AAPL250117C00150000" autocomplete="off" spellcheck="false">
        <span class="opt-paste-hint" id="m-paste-hint"></span>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Type</span>
        <select id="m-type">
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Share price</span>
        <input id="m-spot" type="text" inputmode="decimal" placeholder="100.77" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Strike price</span>
        <input id="m-strike" type="text" inputmode="decimal" placeholder="103" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Expiration</span>
        <input id="m-expiry" type="date" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Bid</span>
        <input id="m-bid" type="text" inputmode="decimal" placeholder="3.15 (or 3.15 × 55)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Ask</span>
        <input id="m-ask" type="text" inputmode="decimal" placeholder="3.30 (or 3.30 × 74)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Implied volatility <span class="opt-manual-opt">optional</span></span>
        <input id="m-iv" type="text" inputmode="decimal" placeholder="100.81%" autocomplete="off">
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Open interest <span class="opt-manual-opt">optional</span></span>
        <input id="m-oi" type="text" inputmode="numeric" placeholder="996" autocomplete="off">
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Volume <span class="opt-manual-opt">optional</span></span>
        <input id="m-vol" type="text" inputmode="numeric" placeholder="1,251" autocomplete="off">
      </label>
      <button type="submit" class="opt-manual-submit">Grade contract</button>
        </form>
        <div id="opt-manual-status" class="opt-status" role="status"></div>
        <div id="opt-manual-result" class="opt-result"></div>
      </div>
    </details>
  </section>`;
}

// Returns the page runtime as a plain JS string for writing to app.js.
// Loaded via <script src="app.js" defer> — the inline manifest <script> tag
// runs first per HTML parsing order so MANIFEST is always defined.
export function renderAppJs({ riskFreeRate = FALLBACK_RISK_FREE_RATE } = {}) {
  const rfrLiteral = Number(riskFreeRate).toFixed(5);
  return `// Generated by scripts/build.mjs — do not edit by hand.
(function(){
  // Theme bootstrap. Runs synchronously before the rest of the IIFE binds
  // so we never flash the wrong theme. Defaults to dark — the terminal look
  // is built around the dark palette and is the canonical view — but a
  // saved 'light' preference still wins so the toggle stays meaningful.
  try {
    var saved = localStorage.getItem('stonks-theme');
    document.documentElement.setAttribute('data-theme', saved || 'dark');
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  var MANIFEST = window.STONKS_MANIFEST || { symbols: [], narratives: [], sectorOverviews: {}, recentlyEnded: [], macroHeadlines: [], sectors: {}, industries: {}, sectorOrder: [], industriesBySector: {}, spots: {} };
  var SYMBOLS = Array.isArray(MANIFEST.symbols) ? MANIFEST.symbols : [];
  var NARRATIVES = Array.isArray(MANIFEST.narratives) ? MANIFEST.narratives : [];
  var SECTOR_OVERVIEWS = (MANIFEST.sectorOverviews && typeof MANIFEST.sectorOverviews === 'object') ? MANIFEST.sectorOverviews : {};
  var RECENTLY_ENDED = Array.isArray(MANIFEST.recentlyEnded) ? MANIFEST.recentlyEnded : [];
  var MACRO_HEADLINES = Array.isArray(MANIFEST.macroHeadlines) ? MANIFEST.macroHeadlines : [];
  var SECTORS = MANIFEST.sectors || {};
  var INDUSTRIES = MANIFEST.industries || {};
  var SECTOR_ORDER = Array.isArray(MANIFEST.sectorOrder) ? MANIFEST.sectorOrder : [];
  var INDUSTRIES_BY_SECTOR = MANIFEST.industriesBySector || {};
  var UNUSUAL = MANIFEST.unusual || null;
  var SPOTS = MANIFEST.spots || {};
  // industry -> parent sector, derived from INDUSTRIES_BY_SECTOR for tab routing.
  var SECTOR_OF_INDUSTRY = (function(){
    var m = {};
    for (var i=0; i<SECTOR_ORDER.length; i++){
      var sec = SECTOR_ORDER[i];
      var inds = INDUSTRIES_BY_SECTOR[sec] || [];
      for (var j=0; j<inds.length; j++) m[inds[j]] = sec;
    }
    return m;
  })();
  var ACTIVE_SECTOR = SECTOR_ORDER[0] || 'Technology';
  var RFR = ${rfrLiteral};
  var CHAIN_CACHE = Object.create(null);
  var state = { symbol: null, spot: null, expirations: [], chains: {}, currentExp: null, news: null, technicals: null, fundamentals: null, social: null };
  var evalTimer = null;
  var stickyIO = null;

  function $(id){ return document.getElementById(id); }
  function setStatus(elemId, msg, kind){
    var el = $(elemId); if (!el) return;
    el.textContent = msg || '';
    el.className = 'opt-status' + (kind ? ' ' + kind : '');
  }
  function fmt(n, d){ if (n == null || !isFinite(n)) return '—'; return Number(n).toFixed(d == null ? 2 : d); }
  function fmtPct(n){ if (n == null || !isFinite(n)) return '—'; return n.toFixed(2) + '%'; }
  function fmtMoney(n){ if (n == null || !isFinite(n)) return '—'; return '$' + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }
  function debounce(fn, ms){
    return function(){
      var args = arguments;
      clearTimeout(evalTimer);
      evalTimer = setTimeout(function(){ fn.apply(null, args); }, ms);
    };
  }

  // --- Freshness banner ---------------------------------------------------
  function renderFreshness(){
    var banner = $('freshness-banner');
    var bannerText = $('freshness-text');
    if (!banner || !bannerText) return;
    var iso = banner.getAttribute('data-built-at');
    var built = iso ? new Date(iso) : null;
    if (!built || isNaN(built.getTime())) return;
    var ageH = (Date.now() - built.getTime()) / 3600000;
    function rel(h){
      if (h < 1) { var m = Math.max(1, Math.round(h*60)); return m + ' minute' + (m===1?'':'s') + ' ago'; }
      if (h < 36) { var hh = Math.round(h); return hh + ' hour' + (hh===1?'':'s') + ' ago'; }
      var d = Math.round(h/24); return d + ' day' + (d===1?'':'s') + ' ago';
    }
    var dateLabel = built.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone:'America/New_York' });
    banner.classList.remove('warn','bad');
    if (ageH > 24*7) {
      banner.classList.add('bad');
      bannerText.innerHTML = 'Very stale — last refreshed ' + dateLabel + '. <span class="freshness-detail">Verify quotes on your broker before trading.</span>';
    } else if (ageH > 36) {
      banner.classList.add('warn');
      bannerText.innerHTML = 'Stale data — last refreshed ' + dateLabel + '. <span class="freshness-detail">Verify quotes on your broker before trading.</span>';
    } else {
      bannerText.innerHTML = 'Refreshed ' + rel(ageH) + ' <span class="freshness-detail">· end-of-session quotes from Yahoo</span>';
    }
  }

  // --- Math: Black-Scholes ------------------------------------------------
  function npdf(x){ return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI); }
  function ncdf(x){
    var b1=0.319381530, b2=-0.356563782, b3=1.781477937, b4=-1.821255978, b5=1.330274429;
    var a = Math.abs(x), t = 1/(1 + 0.2316419*a);
    var poly = ((((b5*t + b4)*t + b3)*t + b2)*t + b1) * t;
    var p = 1 - npdf(a)*poly;
    return x < 0 ? 1-p : p;
  }
  function greeks(type, S, K, T, sigma, r){
    if (!(S>0 && K>0 && T>0 && sigma>0)) return null;
    var sqrtT = Math.sqrt(T);
    var d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*sqrtT);
    var d2 = d1 - sigma*sqrtT;
    var delta = type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
    var thetaYr = type === 'call'
      ? -S*npdf(d1)*sigma/(2*sqrtT) - r*K*Math.exp(-r*T)*ncdf(d2)
      : -S*npdf(d1)*sigma/(2*sqrtT) + r*K*Math.exp(-r*T)*ncdf(-d2);
    var gamma = npdf(d1) / (S*sigma*sqrtT);
    var vega = S*npdf(d1)*sqrtT / 100;
    return { delta: delta, thetaDay: thetaYr/365, gamma: gamma, vega: vega };
  }

  // --- Input parsing ------------------------------------------------------
  function parseLoose(raw){
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    s = s.split(/[x×]/i)[0];
    s = s.replace(/[\\$,%\\s\\u00a0]/g, '');
    return parseFloat(s);
  }
  function parseOCC(raw){
    if (raw == null) return null;
    var s = String(raw).trim().toUpperCase();
    var m = s.match(/^([A-Z][A-Z0-9.]{0,5})(\\d{2})(\\d{2})(\\d{2})([CP])(\\d{8})$/);
    if (!m) return null;
    var yy = parseInt(m[2],10), mm = parseInt(m[3],10), dd = parseInt(m[4],10);
    if (mm<1||mm>12||dd<1||dd>31) return null;
    var year = 2000 + yy;
    var iso = year + '-' + (mm<10?'0':'') + mm + '-' + (dd<10?'0':'') + dd;
    return { root: m[1], type: m[5]==='C' ? 'call' : 'put', strike: parseInt(m[6],10)/1000, expiryISO: iso };
  }
  // 16:00 ET on the given YYYY-MM-DD expressed as a UTC epoch (seconds).
  // Resolves the EDT/EST offset for that calendar date via Intl, so DST
  // transitions don't shift theta by an hour for manually-entered contracts.
  function etCloseEpochSec(yyyymmdd){
    if (!yyyymmdd) return NaN;
    var probe = new Date(yyyymmdd + 'T16:00:00Z');
    if (isNaN(probe.getTime())) return NaN;
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(probe);
    var h = parseInt((parts.find(function(p){return p.type==='hour';})||{}).value, 10) || 0;
    var mi = parseInt((parts.find(function(p){return p.type==='minute';})||{}).value, 10) || 0;
    if (h === 24) h = 0; // some impls emit '24' for midnight
    var diffMin = (16*60) - (h*60 + mi);
    return Math.floor((probe.getTime() + diffMin*60*1000) / 1000);
  }

  // --- Theme toggle -------------------------------------------------------
  function bindThemeToggle(){
    var btn = $('theme-toggle'); if (!btn) return;
    btn.addEventListener('click', function(){
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('stonks-theme', next); } catch (_) {}
    });
  }

  // --- Combobox ----------------------------------------------------------
  var combo = {
    input: null, listbox: null, items: [], activeIdx: -1, open: false,
    init: function(){
      this.input = $('symbol-input');
      this.listbox = $('symbol-listbox');
      if (!this.input || !this.listbox) return;
      var self = this;
      this.input.addEventListener('input', function(){ self.filter(); });
      this.input.addEventListener('focus', function(){ self.filter(); });
      this.input.addEventListener('keydown', function(e){ self.onKey(e); });
      this.input.addEventListener('blur', function(){ setTimeout(function(){ self.close(); }, 120); });
      var clear = $('symbol-clear');
      if (clear) clear.addEventListener('mousedown', function(e){
        e.preventDefault(); self.input.value = ''; self.input.focus(); self.filter();
      });
      this.listbox.addEventListener('mousedown', function(e){
        var li = e.target.closest && e.target.closest('li[data-sym]');
        if (!li) return;
        e.preventDefault();
        self.commit(li.getAttribute('data-sym'));
      });
    },
    rank: function(q){
      q = (q||'').trim().toUpperCase();
      if (!q) return SYMBOLS.slice(0, 50);
      var prefix = [], contains = [], sector = [];
      for (var i=0; i<SYMBOLS.length; i++){
        var sym = SYMBOLS[i];
        var sec = (SECTORS[sym] || '').toUpperCase();
        if (sym.indexOf(q) === 0) prefix.push(sym);
        else if (sym.indexOf(q) >= 0) contains.push(sym);
        else if (sec.indexOf(q) >= 0) sector.push(sym);
      }
      return prefix.concat(contains, sector).slice(0, 50);
    },
    filter: function(){
      var matches = this.rank(this.input.value);
      this.items = matches;
      if (!matches.length){
        this.listbox.innerHTML = '<li class="combo-empty">No matches</li>';
      } else {
        var html = '';
        for (var i=0; i<matches.length; i++){
          var sym = matches[i];
          var sec = SECTORS[sym] || '';
          var spot = SPOTS[sym];
          html += '<li role="option" data-sym="' + sym + '" id="combo-opt-' + sym + '">' +
            '<span class="combo-sym">' + sym + '</span>' +
            '<span class="combo-spot">' + (spot != null ? fmtMoney(spot) : '') + '</span>' +
            '<span class="combo-sector">' + escapeHtml(sec) + '</span>' +
          '</li>';
        }
        this.listbox.innerHTML = html;
      }
      this.activeIdx = -1;
      this.show();
    },
    show: function(){
      this.listbox.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
      this.open = true;
    },
    close: function(){
      this.listbox.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
      this.open = false;
      this.activeIdx = -1;
    },
    move: function(delta){
      if (!this.items.length) return;
      this.activeIdx = (this.activeIdx + delta + this.items.length) % this.items.length;
      var nodes = this.listbox.querySelectorAll('li[data-sym]');
      for (var i=0; i<nodes.length; i++) nodes[i].classList.toggle('is-active', i === this.activeIdx);
      var sym = this.items[this.activeIdx];
      this.input.setAttribute('aria-activedescendant', 'combo-opt-' + sym);
      var active = nodes[this.activeIdx];
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    },
    onKey: function(e){
      if (e.key === 'ArrowDown'){ e.preventDefault(); if (!this.open) this.filter(); else this.move(1); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter'){
        if (this.activeIdx >= 0){ e.preventDefault(); this.commit(this.items[this.activeIdx]); }
        else if (this.items.length === 1){ e.preventDefault(); this.commit(this.items[0]); }
      }
      else if (e.key === 'Escape'){ this.close(); }
    },
    commit: function(sym){
      if (!sym) return;
      this.input.value = sym;
      this.close();
      // Tear down any in-flight polling from the previous ticker so we
      // don't keep stamping its data into state.
      stopLivePolling();
      liveLastRefreshAt = null;
      state.symbol = sym;
      loadChain();
    }
  };

  // --- Shareable URL state ------------------------------------------------
  // Encodes the user's current ticker/expiry/strike/type as query params so
  // links restore the exact graded contract on load. Held back on the first
  // render until loadChain reports the requested expiration is available.
  var pendingUrlState = null;
  var suppressUrlWrite = false;
  function parseUrlState(){
    try {
      var p = new URLSearchParams(window.location.search);
      var sym = (p.get('s') || '').toUpperCase().trim();
      var exp = parseInt(p.get('exp') || '', 10);
      var k = parseFloat(p.get('k') || '');
      var t = (p.get('t') || '').toLowerCase();
      if (t !== 'call' && t !== 'put') t = null;
      if (!sym) return null;
      return {
        sym: sym,
        exp: isFinite(exp) && exp > 0 ? exp : null,
        k: isFinite(k) && k > 0 ? k : null,
        t: t,
      };
    } catch (_) { return null; }
  }
  function buildShareUrl(){
    if (!state.symbol) return window.location.origin + window.location.pathname;
    var p = new URLSearchParams();
    p.set('s', state.symbol);
    if (state.currentExp) p.set('exp', String(state.currentExp));
    var c = findContract();
    if (c && c.s != null) p.set('k', String(c.s));
    p.set('t', getOptType());
    return window.location.origin + window.location.pathname + '?' + p.toString();
  }
  function pushUrlState(){
    if (suppressUrlWrite) return;
    if (!state.symbol) return;
    try {
      var url = buildShareUrl();
      window.history.replaceState(null, '', url);
    } catch (_) {}
  }
  function applyPendingUrlState(){
    if (!pendingUrlState) return;
    if (pendingUrlState.sym !== state.symbol) return;
    suppressUrlWrite = true;
    try {
      if (pendingUrlState.t){
        var radio = document.querySelector('input[name="opt-type"][value="' + pendingUrlState.t + '"]');
        if (radio) radio.checked = true;
      }
      if (pendingUrlState.exp && state.expirations.indexOf(pendingUrlState.exp) !== -1){
        state.currentExp = pendingUrlState.exp;
        var expSel = $('opt-expiry'); if (expSel) expSel.value = String(state.currentExp);
        populateStrikes();
      }
      if (pendingUrlState.k != null){
        var chain = state.chains[state.currentExp];
        var rows = chain ? ((getOptType() === 'call' ? chain.c : chain.p) || []) : [];
        var bestIdx = -1, bestDist = Infinity;
        for (var i = 0; i < rows.length; i++){
          var d = Math.abs((rows[i].s || 0) - pendingUrlState.k);
          if (d < bestDist){ bestDist = d; bestIdx = i; }
        }
        if (bestIdx !== -1){
          var sel = $('opt-strike'); if (sel) sel.selectedIndex = bestIdx;
        }
      }
    } finally {
      suppressUrlWrite = false;
      pendingUrlState = null;
    }
  }

  // --- Chain controls -----------------------------------------------------
  function fmtExpiryLabel(epoch){
    var d = new Date(epoch*1000);
    return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric', timeZone:'America/New_York' });
  }
  function getOptType(){
    var r = document.querySelector('input[name="opt-type"]:checked');
    return r ? r.value : 'call';
  }
  function populateExpiry(){
    var sel = $('opt-expiry'); sel.innerHTML = '';
    state.expirations.forEach(function(epoch){
      var o = document.createElement('option');
      o.value = epoch; o.textContent = fmtExpiryLabel(epoch);
      sel.appendChild(o);
    });
  }
  function populateStrikes(){
    var type = getOptType();
    var chain = state.chains[state.currentExp];
    var sel = $('opt-strike');
    if (!chain){ sel.innerHTML = ''; return; }
    var rows = (type === 'call' ? chain.c : chain.p) || [];
    if (!rows.length){
      sel.innerHTML = '<option disabled>No ' + type + 's available</option>';
      return;
    }
    var spot = state.spot;
    var bestIdx = 0, bestDist = Infinity;
    var parts = new Array(rows.length);
    for (var i=0; i<rows.length; i++){
      var r = rows[i];
      var d = Math.abs((r.s||0) - spot);
      if (d < bestDist){ bestDist = d; bestIdx = i; }
      parts[i] = '<option value="' + i + '">$' + fmt(r.s) + ' · bid ' + fmt(r.b) + ' / ask ' + fmt(r.a) + '</option>';
    }
    sel.innerHTML = parts.join('');
    sel.selectedIndex = bestIdx;
  }
  function findContract(){
    var type = getOptType();
    var chain = state.chains[state.currentExp]; if (!chain) return null;
    var rows = (type === 'call' ? chain.c : chain.p) || [];
    var idx = Number($('opt-strike').value);
    if (!isFinite(idx)) return null;
    return rows[idx] || null;
  }

  // --- Max pain -----------------------------------------------------------
  // For each candidate strike K (union of strikes in the chain) sum the
  // intrinsic value all open calls and puts would have if the underlying
  // closed at K — calls pay (K - strike) when ITM, puts pay (strike - K).
  // The strike that minimizes that total is the "max pain" price: the close
  // where the most aggregate premium expires worthless. Open interest is
  // the weight; volume and IV are ignored — this is purely a positioning
  // snapshot of who is on the hook at expiry.
  function computeMaxPain(chain){
    if (!chain) return null;
    var calls = chain.c || [];
    var puts = chain.p || [];
    var strikeSet = Object.create(null);
    var i;
    for (i = 0; i < calls.length; i++) if (calls[i] && calls[i].s != null) strikeSet[calls[i].s] = true;
    for (i = 0; i < puts.length; i++)  if (puts[i]  && puts[i].s  != null) strikeSet[puts[i].s]  = true;
    var strikes = Object.keys(strikeSet).map(Number).sort(function(a,b){ return a - b; });
    if (!strikes.length) return null;

    var totalCallOI = 0, totalPutOI = 0;
    for (i = 0; i < calls.length; i++) totalCallOI += (calls[i] && calls[i].oi) || 0;
    for (i = 0; i < puts.length; i++)  totalPutOI  += (puts[i]  && puts[i].oi)  || 0;
    if (totalCallOI + totalPutOI <= 0) return null;

    var bestStrike = null, bestPain = Infinity;
    for (var k = 0; k < strikes.length; k++){
      var K = strikes[k];
      var pain = 0;
      for (i = 0; i < calls.length; i++){
        var c = calls[i]; if (!c) continue;
        var coi = c.oi || 0; if (!coi || c.s == null) continue;
        if (K > c.s) pain += (K - c.s) * coi;
      }
      for (i = 0; i < puts.length; i++){
        var p = puts[i]; if (!p) continue;
        var poi = p.oi || 0; if (!poi || p.s == null) continue;
        if (K < p.s) pain += (p.s - K) * poi;
      }
      if (pain < bestPain){ bestPain = pain; bestStrike = K; }
    }
    if (bestStrike == null) return null;
    return {
      strike: bestStrike,
      pain: bestPain,
      totalCallOI: totalCallOI,
      totalPutOI: totalPutOI,
    };
  }
  function renderMaxPain(){
    var box = $('opt-max-pain');
    if (!box) return;
    var chain = state.currentExp ? state.chains[state.currentExp] : null;
    var mp = computeMaxPain(chain);
    if (!mp || mp.strike == null){
      box.hidden = true; box.innerHTML = '';
      return;
    }
    var spot = state.spot;
    var diff = (spot > 0) ? (mp.strike - spot) : null;
    var pct = (spot > 0) ? (diff / spot * 100) : null;
    var dirCls, dirText;
    if (diff == null){
      dirCls = 'flat';
      dirText = '';
    } else if (Math.abs(pct) < 0.25){
      dirCls = 'flat';
      dirText = 'right at spot — sellers want price pinned here';
    } else if (diff < 0){
      dirCls = 'down';
      dirText = '<b>$' + fmt(Math.abs(diff)) + '</b> (' + Math.abs(pct).toFixed(2) + '%) <b>below</b> spot — sellers benefit if price drifts down into expiration';
    } else {
      dirCls = 'up';
      dirText = '<b>$' + fmt(diff) + '</b> (' + pct.toFixed(2) + '%) <b>above</b> spot — sellers benefit if price drifts up into expiration';
    }
    var totalOI = mp.totalCallOI + mp.totalPutOI;
    var callShare = totalOI > 0 ? Math.round(mp.totalCallOI / totalOI * 100) : 0;
    var putShare = 100 - callShare;
    var expLabel = state.currentExp ? fmtExpiryLabel(state.currentExp) : '';
    box.hidden = false;
    box.innerHTML =
      '<div class="opt-max-pain-head">' +
        '<span class="opt-max-pain-label">Max pain</span>' +
        '<span class="opt-max-pain-exp">' + escapeHtml(expLabel) + '</span>' +
        tipChip(TIPS.maxPain) +
      '</div>' +
      '<div class="opt-max-pain-body">' +
        '<span class="opt-max-pain-strike ' + dirCls + '">$' + fmt(mp.strike) + '</span>' +
        (dirText ? '<span class="opt-max-pain-delta ' + dirCls + '">' + dirText + '</span>' : '') +
      '</div>' +
      '<div class="opt-max-pain-meta">' +
        'Based on ' + totalOI.toLocaleString() + ' open contracts · ' +
        callShare + '% calls / ' + putShare + '% puts' +
      '</div>';
  }

  // --- Grading ------------------------------------------------------------
  function gradeSpread(spreadPct){
    if (spreadPct <= 5)  return { label:'Tight',    cls:'good', note:'narrow spread — easy fills' };
    if (spreadPct <= 15) return { label:'Moderate', cls:'fair', note:'spread is workable but costs you on entry/exit' };
    return { label:'Wide', cls:'bad', note:'wide spread — illiquid, expect slippage' };
  }
  function gradeLiquidity(oi){
    if (oi == null || !isFinite(oi)) return null;
    if (oi < 10) return { label:'Thin', cls:'bad', note:'almost no open interest — fills uncertain, slippage likely' };
    if (oi < 100) return { label:'Light', cls:'fair', note:'modest interest — fills possible but expect some slippage' };
    return { label:'Liquid', cls:'good', note:'plenty of open interest — normal fills expected' };
  }
  function gradeVolRegime(pctile){
    if (pctile == null || !isFinite(pctile)) return null;
    if (pctile <= 30) return { label:'Calm', cls:'good', note:'realized vol in bottom 30% — premiums may be relatively cheap' };
    if (pctile <= 70) return { label:'Normal', cls:'fair', note:'realized vol mid-range vs. this name’s recent history' };
    return { label:'Elevated', cls:'bad', note:'realized vol in top 30% — premiums likely rich, expect mean reversion' };
  }
  // Days-to-earnings context for the verdict card. Expected move is the
  // volatility-implied ±X by the earnings call assuming the option's IV
  // embeds that risk: spot * iv * sqrt(daysToEarnings / 365). We only show
  // the move when earnings happens BEFORE expiry; otherwise the contract's
  // IV isn't really capturing the print and the proxy is misleading.
  function computeEarningsContext(fundamentals, spot, iv, expEpoch){
    if (!fundamentals || !fundamentals.nextEarningsDate) return null;
    var earnDt = new Date(fundamentals.nextEarningsDate + 'T16:00:00Z');
    if (isNaN(earnDt.getTime())) return null;
    var now = Date.now();
    var daysRaw = (earnDt.getTime() - now) / (24*3600*1000);
    if (daysRaw < -1) return null;
    var daysToEarnings = Math.max(0, Math.round(daysRaw));
    var withinExpiry = !expEpoch || Math.floor(earnDt.getTime() / 1000) <= expEpoch;
    var emAbs = null, emPct = null;
    if (iv > 0 && spot > 0 && daysRaw >= 0 && withinExpiry){
      emAbs = spot * iv * Math.sqrt(daysRaw / 365);
      emPct = emAbs / spot * 100;
    }
    return {
      dateIso: fundamentals.nextEarningsDate,
      daysToEarnings: daysToEarnings,
      withinExpiry: withinExpiry,
      expectedMoveAbs: emAbs,
      expectedMovePct: emPct,
    };
  }
  function gradeDelta(delta){
    var a = Math.abs(delta);
    if (a >= 0.40 && a <= 0.70) return { label:'Balanced',     cls:'good', note:'good directional sensitivity without paying full intrinsic' };
    if (a >= 0.30 && a < 0.40)  return { label:'Slightly OTM', cls:'fair', note:'cheaper but needs a real move to pay' };
    if (a > 0.70)               return { label:'Deep ITM',     cls:'fair', note:'moves nearly 1:1 with the stock — limited leverage' };
    return { label:'Far OTM', cls:'bad', note:'lottery ticket — most likely expires worthless' };
  }
  function gradeTheta(thetaDay, mid){
    if (mid <= 0 || thetaDay == null) return { label:'—', cls:'fair', note:'theta unavailable' };
    var bleed = Math.abs(thetaDay) / mid * 100;
    if (bleed < 1) return { label:'Slow decay',   cls:'good', note:'~' + bleed.toFixed(2) + '% / day — plenty of runway' };
    if (bleed < 3) return { label:'Normal decay', cls:'fair', note:'~' + bleed.toFixed(2) + '% / day — standard time pressure' };
    return { label:'Bleeding', cls:'bad', note:'~' + bleed.toFixed(2) + '% / day — heavy time decay' };
  }
  function overallVerdict(grades){
    var bad = grades.filter(function(g){ return g.cls === 'bad'; }).length;
    var good = grades.filter(function(g){ return g.cls === 'good'; }).length;
    if (bad >= 2) return { label:'Poor contract', cls:'bad' };
    if (bad === 1) return { label:'Mixed — proceed with caution', cls:'fair' };
    if (good >= 2) return { label:'Good contract', cls:'good' };
    return { label:'Acceptable', cls:'fair' };
  }
  function applyNewsNudge(verdict, news){
    if (!news || !news.sentiment) return verdict;
    if (verdict.cls !== 'fair') return verdict;
    if (news.sentiment === 'bullish') return { label:'Good contract · news tailwind', cls:'good', nudged:true };
    if (news.sentiment === 'bearish') return { label:'Poor contract · news headwind', cls:'bad', nudged:true };
    return verdict;
  }
  // Binary buy decision aggregating mechanics + news + technicals +
  // fundamentals. Falls to NO on any hard mechanical disqualifier (wide
  // spread, far-OTM delta, bleeding theta, ≤3 DTE, premium that's almost
  // all time value with no runway). Otherwise scores directional alignment
  // — news (±2), RSI and MACD (±1 each), fundamentals verdict (±1) — and
  // multiplies by the option direction (+1 for calls, -1 for puts). Needs
  // at least +2 aligned points and zero opposing edge to clear to YES.
  function shouldBuy(args){
    var sGrade = args.sGrade, dGrade = args.dGrade, tGrade = args.tGrade;
    var dte = args.daysToExpiry;
    var extrinsicRatio = args.extrinsicRatio;
    var type = args.type;
    var news = args.news, tech = args.technicals, fund = args.fundamentals;

    function no(why){ return { decision:'no', reasons:[why] }; }
    function yes(rs){ return { decision:'yes', reasons: rs }; }

    if (sGrade && sGrade.cls === 'bad') return no('wide spread will eat your edge on entry/exit');
    if (dGrade && dGrade.cls === 'bad') return no('far OTM — most likely expires worthless');
    if (tGrade && tGrade.cls === 'bad') return no('heavy theta decay grinds this down fast');
    if (dte != null && dte <= 3) return no('only ' + dte + ' day' + (dte === 1 ? '' : 's') + ' to expiry — gamma and theta are extreme');
    if (extrinsicRatio != null && extrinsicRatio > 0.8 && dte != null && dte < 14) {
      return no('paying almost all time premium with little time for it to pay off');
    }

    var dir = type === 'call' ? 1 : -1;
    var score = 0;
    var bull = [], bear = [];
    if (news && news.sentiment){
      if (news.sentiment === 'bullish'){ score += 2; bull.push('news'); }
      else if (news.sentiment === 'bearish'){ score -= 2; bear.push('news'); }
    }
    if (tech){
      var rsi = rsiState(tech.rsi);
      var macd = macdState(tech.macd);
      if (rsi.cls === 'pos'){ score += 1; bull.push('RSI'); }
      else if (rsi.cls === 'warn'){ score -= 1; bear.push('RSI'); }
      if (macd.cls === 'pos'){ score += 1; bull.push('MACD'); }
      else if (macd.cls === 'warn'){ score -= 1; bear.push('MACD'); }
    }
    if (fund && fund.verdict){
      if (fund.verdict === 'bullish'){ score += 1; bull.push('fundamentals'); }
      else if (fund.verdict === 'bearish'){ score -= 1; bear.push('fundamentals'); }
    }

    var aligned = score * dir;
    var alignedNames = dir > 0 ? bull : bear;
    var opposedNames = dir > 0 ? bear : bull;
    var goodCount = (sGrade && sGrade.cls === 'good' ? 1 : 0) +
                    (dGrade && dGrade.cls === 'good' ? 1 : 0) +
                    (tGrade && tGrade.cls === 'good' ? 1 : 0);

    if (aligned < 0) return no((opposedNames.length ? opposedNames.join(' + ') + ' lean against ' : 'signals lean against ') + (type === 'call' ? 'calls' : 'puts'));
    // Strong alignment passes regardless of mechanical "good" count.
    if (aligned >= 2){
      var rs1 = [];
      rs1.push(sGrade && sGrade.cls === 'good' ? 'spread tight' : 'spread workable');
      if (dGrade && dGrade.cls === 'good') rs1.push('delta balanced');
      rs1.push(alignedNames.join(' + ') + ' back the move');
      return yes(rs1);
    }
    // No positive conviction but mechanics are clean and nothing opposes:
    // good contract on a neutral / manual-paste backdrop still qualifies.
    if (goodCount >= 2 && opposedNames.length === 0){
      var rs2 = ['mechanics clean'];
      rs2.push(alignedNames.length ? alignedNames.join(' + ') + ' lean ' + (type === 'call' ? 'bullish' : 'bearish') : 'no opposing signals');
      return yes(rs2);
    }
    return no('not enough conviction backing this direction');
  }

  var TIPS = {
    spread:     'Gap between bid (what buyers pay) and ask (what sellers want). Wider = you lose more on entry/exit.',
    delta:      'How much the option moves per $1 the stock moves. ~0.50 = at-the-money, ~1.00 = deep ITM, near 0 = far OTM lottery.',
    theta:      'Daily $ the contract loses just from time passing. Higher = the clock is running against you faster.',
    iv:         'Implied volatility — the market\\'s guess at how much the stock will move. High IV = expensive premium.',
    gamma:      'How fast delta changes as the stock moves. Higher near ATM and near expiry.',
    vega:       'How much the contract gains/loses per 1 point change in implied volatility.',
    intrinsic:  'Money already baked in: how far in-the-money the contract is. A call $5 ITM has $5 of intrinsic value — that part is yours at expiry no matter what.',
    extrinsic:  'Time + volatility premium on top of intrinsic. Decays to zero by expiry. The bigger this is relative to mid, the more you are paying for hope.',
    breakeven:  'Underlying price the stock needs to reach at expiry just to make back what you paid. Above = profit (for calls); below = profit (for puts).',
    probITM:    'Rough probability the contract finishes in-the-money. Black-Scholes |delta| is the standard proxy — not a guarantee, just the model\\'s implied odds.',
    moneyness:  'How far the strike is from the current stock price, in percent. 0% = at the money, negative = below spot, positive = above spot.',
    maxPain:    'Strike at which the total dollar value of all in-the-money options at expiration is minimized — i.e. the most calls and puts expire worthless. Option sellers (market makers) profit most if the stock closes here, so it\\'s often called the price they would "want" pinned by expiration. Computed from open interest on the selected expiration; it shifts as OI builds and is a soft target, not a guarantee.',
    rsi:        'Relative Strength Index (14-day). Above 70 = overbought (stretched, prone to a pullback). Below 30 = oversold (washed out, prone to a bounce).',
    macd:       'Moving Average Convergence Divergence (12/26/9). MACD line above signal = bullish momentum; below = bearish. The histogram shows the gap.',
    support:    'Recent price floor — the lowest low over the lookback window. Stocks tend to find buyers around old lows. A break below is a meaningful technical event.',
    resistance: 'Recent price ceiling — the highest high over the lookback window. Stocks tend to stall at old highs. A clean break above is a meaningful technical event.'
  };
  function tipChip(text){
    if (!text) return '';
    var t = text.replace(/"/g, '&quot;');
    return ' <span class="tip" tabindex="0" role="button" aria-label="Explain: ' + t + '" data-tip="' + t + '">?</span>';
  }
  function row(label, value, sub, tip){
    return '<div class="opt-row"><div class="opt-row-label">' + label + tipChip(tip) +
      '</div><div class="opt-row-value">' + value + (sub ? ' <span class="opt-row-sub">' + sub + '</span>' : '') + '</div></div>';
  }
  function gradeChip(g){ return '<span class="opt-grade ' + g.cls + '">' + g.label + '</span>'; }
  function verdictExplainer(cls){
    var msg;
    if (cls === 'good') msg = 'Clean contract. Spread is tight, delta is balanced, theta is manageable. The mechanics are working with you — the rest is direction, sizing, and timing. Cross-check it against the technical signals and news take below before you commit.';
    else if (cls === 'bad') msg = 'Skip or rework. Wide spread or far-OTM delta or heavy theta will eat your edge before the trade plays out. Look for a tighter strike, a more liquid expiry, or a different ticker. If you still like the direction, the manual grader below lets you stress-test alternatives quickly.';
    else msg = 'Workable but not ideal. Read the chip notes below — usually one of spread, delta, or theta is asking you to compromise. Decide whether that trade-off is worth it. The technicals and news take can help break the tie when the mechanics alone are inconclusive.';
    return '<div class="opt-explain ' + cls + '"><b>What this means:</b> ' + msg + '</div>';
  }
  function newsTakeHtml(news, ticker, nudged){
    if (!news || !news.paragraph) return '';
    var sentimentLabel = ({ bullish:'Bullish', neutral:'Neutral', bearish:'Bearish', uncertain:'Uncertain' })[news.sentiment] || 'Neutral';
    var heading = 'AI news take' + (ticker ? (' · ' + escapeHtml(ticker)) : '') + ' · ' + sentimentLabel;
    var note = nudged ? '<div class="opt-news-note">This news context shifted the verdict from <b>Acceptable</b>.</div>' : '';
    var sources = Array.isArray(news.sources) ? news.sources : [];
    var sourcesRow = sources.length
      ? '<div class="opt-news-sources"><span class="opt-news-sources-label">Sources</span>' +
          sources.slice(0, 6).map(function(s){ return '<span class="opt-news-source">' + escapeHtml(s) + '</span>'; }).join('') +
        '</div>'
      : '';
    // headlines may be plain strings (old builds) or {title, publisher} objects.
    var hl = Array.isArray(news.headlines) ? news.headlines : [];
    var hlRow = hl.length
      ? '<details class="opt-news-headlines"><summary>' + hl.length + ' headlines used</summary><ul>' +
          hl.slice(0, 10).map(function(h){
            var title = typeof h === 'string' ? h : (h.title || '');
            var pub = (h && typeof h === 'object') ? (h.publisher || '') : '';
            var rep = (h && typeof h === 'object' && h.reputable) ? ' opt-news-headline-rep' : '';
            var pubTag = pub ? '<span class="opt-news-headline-pub' + rep + '">' + escapeHtml(pub) + '</span>' : '';
            return '<li>' + pubTag + '<span class="opt-news-headline-title">' + escapeHtml(title) + '</span></li>';
          }).join('') +
        '</ul></details>'
      : '';
    return '<div class="opt-news ' + (news.sentiment || 'neutral') + '">' +
      '<div class="opt-news-head">' + heading + '</div>' +
      '<div class="opt-news-body">' + escapeHtml(news.paragraph) + '</div>' +
      sourcesRow +
      hlRow +
      note +
    '</div>';
  }
  function renderNewsPane(){
    var box = $('opt-news-pane');
    if (!box) return;
    if (!state.symbol){ box.innerHTML = ''; return; }
    var socialHtml = renderSocialSentiment() || '';
    if (!state.news || !state.news.paragraph){
      box.innerHTML = socialHtml + '<div class="opt-news-empty">No AI news take available for ' + escapeHtml(state.symbol) + ' in this build.</div>';
      return;
    }
    box.innerHTML = socialHtml + newsTakeHtml(state.news, state.symbol, false);
  }
  function renderAnalysisShell(){
    // Show the tabbed analysis container as soon as a ticker is selected.
    // Individual panes still hide themselves when their data is missing.
    var shell = $('opt-analysis');
    if (shell) shell.hidden = !state.symbol;
  }
  function bindTabs(){
    var tabs = document.querySelectorAll('.opt-tab');
    if (!tabs.length) return;
    function selectTab(name){
      try { localStorage.setItem('stonks-tab', name); } catch (_) {}
      tabs.forEach(function(btn){
        var sel = btn.getAttribute('data-tab') === name;
        btn.setAttribute('aria-selected', sel ? 'true' : 'false');
        var paneId = btn.getAttribute('aria-controls');
        var pane = paneId ? document.getElementById(paneId) : null;
        if (pane) pane.hidden = !sel;
      });
    }
    tabs.forEach(function(btn){
      btn.addEventListener('click', function(){ selectTab(btn.getAttribute('data-tab')); });
    });
    var saved = null;
    try { saved = localStorage.getItem('stonks-tab'); } catch (_) {}
    selectTab(saved && ['fund','tech','news'].indexOf(saved) >= 0 ? saved : 'fund');
  }
  // Top-of-page section tabs (Narratives / Unusual flow / Grade). Persisted
  // so a return visit lands the user where they left off.
  function bindPageTabs(){
    var tabs = document.querySelectorAll('.page-tab');
    if (!tabs.length) return;
    var valid = ['narratives','flow','grade'];
    function selectTab(name){
      try { localStorage.setItem('stonks-page-tab', name); } catch (_) {}
      tabs.forEach(function(btn){
        var sel = btn.getAttribute('data-page-tab') === name;
        btn.setAttribute('aria-selected', sel ? 'true' : 'false');
        var paneId = btn.getAttribute('aria-controls');
        var pane = paneId ? document.getElementById(paneId) : null;
        if (pane) pane.hidden = !sel;
      });
    }
    tabs.forEach(function(btn){
      btn.addEventListener('click', function(){ selectTab(btn.getAttribute('data-page-tab')); });
    });
    var saved = null;
    try { saved = localStorage.getItem('stonks-page-tab'); } catch (_) {}
    selectTab(saved && valid.indexOf(saved) >= 0 ? saved : 'narratives');
  }

  function buildResultHtml(input){
    var bid = input.bid, ask = input.ask;
    var mid = (bid != null && ask != null && (bid + ask) > 0) ? (bid + ask) / 2 : (input.last || null);
    var spread = (bid != null && ask != null) ? (ask - bid) : null;
    var spreadPct = (spread != null && mid > 0) ? (spread/mid * 100) : null;
    var iv = input.iv;
    var T = (input.expEpoch*1000 - Date.now()) / (365*24*3600*1000);
    var g = (T > 0 && iv > 0 && input.spot > 0 && input.strike > 0)
      ? greeks(input.type, input.spot, input.strike, T, iv, RFR) : null;

    var sGrade = spreadPct != null ? gradeSpread(spreadPct) : { label:'—', cls:'fair', note:'no quote' };
    var dGrade = g ? gradeDelta(g.delta) : { label:'—', cls:'fair', note:'delta unavailable — IV missing' };
    var tGrade = g ? gradeTheta(g.thetaDay, mid) : { label:'—', cls:'fair', note:'theta unavailable — IV missing' };
    var baseVerdict = overallVerdict([sGrade, dGrade, tGrade]);
    var verdict = applyNewsNudge(baseVerdict, input.news);

    // Derived contract metrics. Intrinsic = how much of the premium is
    // already in-the-money cash. Time value = whatever is left, i.e. what
    // decays. Breakeven = the underlying price the stock needs to reach at
    // expiry just to recover the premium. Probability ITM ≈ |delta| under
    // Black-Scholes — a rough but standard proxy, not a guarantee.
    var intrinsic = null;
    if (input.spot != null && input.strike != null) {
      intrinsic = input.type === 'call'
        ? Math.max(0, input.spot - input.strike)
        : Math.max(0, input.strike - input.spot);
    }
    var extrinsic = (mid != null && intrinsic != null) ? Math.max(0, mid - intrinsic) : null;
    var breakeven = (mid != null && input.strike != null)
      ? (input.type === 'call' ? input.strike + mid : input.strike - mid)
      : null;
    var moneynessPct = (input.spot > 0 && input.strike != null)
      ? (input.spot - input.strike) / input.spot * 100
      : null;
    var probITM = g ? Math.abs(g.delta) * 100 : null;
    var daysToExpiry = Math.max(0, Math.round(T*365));
    var extrinsicRatio = (extrinsic != null && mid > 0) ? (extrinsic / mid) : null;

    var buy = shouldBuy({
      sGrade: sGrade, dGrade: dGrade, tGrade: tGrade,
      daysToExpiry: daysToExpiry, extrinsicRatio: extrinsicRatio,
      type: input.type,
      news: input.news, technicals: input.technicals, fundamentals: input.fundamentals,
    });

    var html = '';
    html += '<div class="opt-buy ' + buy.decision + '" id="opt-buy-main" role="status">' +
      '<span class="opt-buy-badge">' + (buy.decision === 'yes' ? 'YES' : 'NO') + '</span>' +
      '<span class="opt-buy-reason">' + escapeHtml(buy.reasons.join(' · ')) + '</span>' +
    '</div>';
    html += '<div class="opt-verdict ' + verdict.cls + '" id="opt-verdict-main">' + verdict.label + '</div>';
    html += verdictExplainer(verdict.cls);
    if (verdict.nudged && input.news && input.news.sentiment){
      var nudgeLabel = ({ bullish:'bullish', bearish:'bearish' })[input.news.sentiment] || 'news';
      html += '<div class="opt-news-note">News context (' + nudgeLabel + ') shifted the verdict from <b>Acceptable</b>. See the News tab below.</div>';
    }
    html += '<div class="opt-contract">' + (input.label || '') + ' · spot $' + fmt(input.spot) + ' · ' + daysToExpiry + ' day' + (daysToExpiry === 1 ? '' : 's') + ' to expiry</div>';
    html += '<div class="opt-grid">';
    html += row('Bid / Ask', '$' + fmt(bid) + ' / $' + fmt(ask));
    html += row('Mid', mid != null ? '$' + fmt(mid) : '—');
    html += row('Spread', spread != null ? ('$' + fmt(spread) + ' (' + fmtPct(spreadPct) + ')') : '—', gradeChip(sGrade), TIPS.spread);
    html += row('Intrinsic value', intrinsic != null ? '$' + fmt(intrinsic) : '—', '', TIPS.intrinsic);
    html += row('Time value', extrinsic != null ? '$' + fmt(extrinsic) : '—', mid > 0 && extrinsic != null ? '<span class="opt-row-mute">' + fmtPct(extrinsic / mid * 100) + ' of mid</span>' : '', TIPS.extrinsic);
    html += row('Breakeven at expiry', breakeven != null ? '$' + fmt(breakeven) : '—', input.spot > 0 && breakeven != null ? '<span class="opt-row-mute">' + (((breakeven - input.spot) / input.spot * 100) >= 0 ? '+' : '') + ((breakeven - input.spot) / input.spot * 100).toFixed(2) + '% from spot</span>' : '', TIPS.breakeven);
    html += row('Moneyness', moneynessPct != null ? ((moneynessPct >= 0 ? '+' : '') + moneynessPct.toFixed(2) + '%') : '—', '', TIPS.moneyness);
    var earn = computeEarningsContext(input.fundamentals, input.spot, iv, input.expEpoch);
    if (earn){
      var earnLabel = earn.dateIso + ' · ' + earn.daysToEarnings + ' day' + (earn.daysToEarnings === 1 ? '' : 's');
      var earnSub = earn.withinExpiry ? '<span class="opt-row-mute">before expiry</span>' : '<span class="opt-row-mute">after expiry</span>';
      html += row('Next earnings', earnLabel, earnSub, 'Yahoo-reported next earnings release date. If earnings falls before this contract’s expiry, the chain’s IV is likely elevated to embed the move.');
      if (earn.expectedMoveAbs != null){
        html += row('Expected move by earnings', '±$' + fmt(earn.expectedMoveAbs), '<span class="opt-row-mute">±' + earn.expectedMovePct.toFixed(2) + '% of spot</span>', 'Spot × IV × √(daysToEarnings/365). A volatility-implied estimate of how far the underlying could move by the print — the actual reaction often surprises in either direction.');
      }
    }
    html += row('IV', iv != null ? fmtPct(iv*100) : '—', '', TIPS.iv);
    var volRegime = input.technicals && input.technicals.volRegime;
    var vGrade = volRegime ? gradeVolRegime(volRegime.rv30Pctile) : null;
    if (volRegime && vGrade){
      var rvLabel = (volRegime.rv30*100).toFixed(0) + '% · P' + volRegime.rv30Pctile;
      html += row('30d realized vol', rvLabel, gradeChip(vGrade), 'Annualized 30-day realized volatility for this ticker, with its percentile against the rolling 30-day RV across the available daily history. A proxy for whether this name is running hotter or quieter than usual.');
    }
    html += row('Delta', g ? fmt(g.delta, 3) : '—', g ? gradeChip(dGrade) : '', TIPS.delta);
    html += row('Prob. ITM (≈ |delta|)', probITM != null ? probITM.toFixed(1) + '%' : '—', '', TIPS.probITM);
    html += row('Theta / day', g ? '$' + fmt(g.thetaDay, 3) : '—', g ? gradeChip(tGrade) : '', TIPS.theta);
    html += row('Gamma', g ? fmt(g.gamma, 4) : '—', '', TIPS.gamma);
    html += row('Vega (per 1 vol pt)', g ? '$' + fmt(g.vega, 3) : '—', '', TIPS.vega);
    var lGrade = gradeLiquidity(input.oi);
    html += row('Open interest', input.oi != null ? String(input.oi) : '—', lGrade ? gradeChip(lGrade) : '');
    html += row('Volume', input.volume != null ? String(input.volume) : '—');
    html += '</div>';
    html += '<ul class="opt-notes">';
    html += '<li><b>Spread:</b> ' + sGrade.note + '.</li>';
    html += '<li><b>Delta:</b> ' + dGrade.note + '.</li>';
    html += '<li><b>Theta:</b> ' + tGrade.note + '.</li>';
    if (lGrade && lGrade.cls !== 'good'){
      html += '<li><b>Liquidity:</b> ' + lGrade.note + '.</li>';
    }
    if (vGrade && vGrade.cls !== 'fair'){
      html += '<li><b>Vol regime:</b> ' + vGrade.note + '.</li>';
    }
    if (extrinsic != null && mid > 0){
      var extPct = extrinsic / mid * 100;
      var extNote = extPct < 25
        ? 'mostly intrinsic — you are paying for the move that has already happened'
        : extPct < 60
        ? 'a healthy mix of intrinsic and time value — typical at-the-money premium'
        : 'almost all time value — pure bet on the move; theta will grind this down fast';
      html += '<li><b>Premium make-up:</b> ' + extNote + '.</li>';
    }
    if (breakeven != null && input.spot > 0){
      var beMove = (breakeven - input.spot) / input.spot * 100;
      var beAbs = Math.abs(beMove);
      var beNote = beAbs < 2
        ? 'tiny move needed — leverage is modest'
        : beAbs < 6
        ? 'a normal session-or-two move gets you whole'
        : 'a sizable move is required just to break even — the contract is asking for conviction';
      html += '<li><b>Breakeven:</b> ' + beNote + '.</li>';
    }
    if (daysToExpiry > 0 && daysToExpiry <= 3){
      html += '<li><b>Heads-up:</b> only ' + daysToExpiry + ' day' + (daysToExpiry === 1 ? '' : 's') + ' to expiry — gamma is enormous and theta is brutal. Treat this like a same-day trade.</li>';
    }
    html += '</ul>';
    if (input.source === 'chain') {
      var payload = JSON.stringify({
        type: input.type, spot: input.spot, strike: input.strike, expEpoch: input.expEpoch,
        bid: input.bid, ask: input.ask, iv: input.iv,
        oi: input.oi, volume: input.volume,
      }).replace(/'/g, '&apos;');
      html += '<div class="opt-actions">';
      html += '<button type="button" class="opt-tweak-btn" data-tweak=\\'' + payload + '\\'>Tweak in manual form &darr;</button>';
      html += '<button type="button" class="opt-copylink-btn" id="opt-copy-link" title="Copy a link that restores this exact contract">🔗 Copy link</button>';
      html += '</div>';
    }
    var disc = input.source === 'manual'
      ? 'Greeks computed locally with Black-Scholes from your IV and a ' + (RFR*100).toFixed(1) + '% risk-free rate. You are the data source — only as accurate as the numbers you typed.'
      : 'Greeks computed with Black-Scholes from Yahoo&apos;s implied vol and a ' + (RFR*100).toFixed(1) + '% risk-free rate. Quotes are end-of-session as of the build timestamp shown above — for information only, not investment advice.';
    html += '<p class="opt-disclaimer">' + disc + '</p>';
    return { html: html, verdict: verdict, buy: buy, contractLabel: input.label || '' };
  }

  function renderStickyVerdict(verdict, label, buy){
    var bar = $('opt-result-sticky');
    if (!bar) return;
    var buyHtml = buy
      ? '<span class="opt-buy-mini ' + buy.decision + '">' + (buy.decision === 'yes' ? 'YES' : 'NO') + '</span>'
      : '';
    bar.innerHTML = buyHtml +
      '<span class="opt-verdict-mini ' + verdict.cls + '">' + verdict.label + '</span>' +
      '<span class="opt-contract-mini">' + escapeHtml(label) + '</span>';
  }
  function setupStickyObserver(){
    var verdictEl = $('opt-verdict-main');
    var bar = $('opt-result-sticky');
    if (!verdictEl || !bar || typeof IntersectionObserver === 'undefined') return;
    if (stickyIO) stickyIO.disconnect();
    stickyIO = new IntersectionObserver(function(entries){
      var e = entries[0];
      var stuck = !e.isIntersecting && e.boundingClientRect.top < 0;
      bar.hidden = !stuck;
    }, { threshold: 0, rootMargin: '-56px 0px 0px 0px' });
    stickyIO.observe(verdictEl);
  }

  function evaluate(){
    var c = findContract();
    var resultEl = $('opt-eval-result');
    var stickyEl = $('opt-result-sticky');
    if (!c){
      if (resultEl) resultEl.innerHTML = '';
      if (stickyEl){ stickyEl.hidden = true; stickyEl.innerHTML = ''; }
      return;
    }
    var type = getOptType();
    var label = (state.symbol || '') + ' ' + type.toUpperCase() + ' $' + fmt(c.s) + ' · exp ' + fmtExpiryLabel(state.currentExp);
    var built = buildResultHtml({
      type: type, spot: state.spot, strike: c.s, expEpoch: state.currentExp,
      bid: c.b, ask: c.a, last: c.l, iv: c.iv,
      oi: c.oi, volume: c.v, label: label, source: 'chain',
      news: state.news, technicals: state.technicals, fundamentals: state.fundamentals,
      ticker: state.symbol
    });
    resultEl.innerHTML = built.html;
    renderStickyVerdict(built.verdict, built.contractLabel, built.buy);
    setupStickyObserver();
    setStatus('opt-eval-status', '', '');
  }
  var scheduleEvaluate = debounce(evaluate, 80);

  function evaluateManual(ev){
    if (ev) ev.preventDefault();
    var type = $('m-type').value;
    var spot = parseLoose($('m-spot').value);
    var strike = parseLoose($('m-strike').value);
    var expDateStr = $('m-expiry').value;
    var bid = parseLoose($('m-bid').value);
    var ask = parseLoose($('m-ask').value);
    var ivRaw = $('m-iv').value.trim();
    var oiRaw = $('m-oi').value.trim();
    var volRaw = $('m-vol').value.trim();
    var ivPct = parseLoose(ivRaw);
    var oi = parseLoose(oiRaw);
    var vol = parseLoose(volRaw);

    if (!(spot > 0))   { setStatus('opt-manual-status', 'Share price is required.', 'err'); return; }
    if (!(strike > 0)) { setStatus('opt-manual-status', 'Strike price is required.', 'err'); return; }
    if (!expDateStr)   { setStatus('opt-manual-status', 'Expiration date is required.', 'err'); return; }
    if (!isFinite(bid) || !isFinite(ask) || bid < 0 || ask < 0) { setStatus('opt-manual-status', 'Bid and ask are required (enter 0 if you have no quote).', 'err'); return; }
    if (ask < bid) { setStatus('opt-manual-status', 'Ask is below bid — check your numbers.', 'err'); return; }

    var expEpoch = etCloseEpochSec(expDateStr);
    var label = type.toUpperCase() + ' $' + strike + ' · exp ' + expDateStr;
    var built = buildResultHtml({
      type: type, spot: spot, strike: strike, expEpoch: expEpoch,
      bid: bid, ask: ask, last: null,
      iv: (ivRaw && isFinite(ivPct) && ivPct >= 0) ? ivPct/100 : null,
      oi: (oiRaw && isFinite(oi)) ? Math.round(oi) : null,
      volume: (volRaw && isFinite(vol)) ? Math.round(vol) : null,
      label: label, source: 'manual'
    });
    $('opt-manual-result').innerHTML = built.html;
    setStatus('opt-manual-status', 'Graded.', 'ok');
  }

  function onPasteContract(){
    var input = $('m-paste');
    var hint = $('m-paste-hint');
    var raw = input.value;
    if (!raw || !raw.trim()){
      input.classList.remove('err');
      if (hint){ hint.textContent = ''; hint.classList.remove('err'); }
      return;
    }
    var parsed = parseOCC(raw);
    if (!parsed){
      input.classList.add('err');
      if (hint){ hint.textContent = "Doesn't look like an OCC symbol (e.g. AAPL250117C00150000)."; hint.classList.add('err'); }
      return;
    }
    input.classList.remove('err');
    $('m-type').value = parsed.type;
    $('m-strike').value = String(parsed.strike);
    $('m-expiry').value = parsed.expiryISO;
    if (hint){
      hint.textContent = 'Recognised: ' + parsed.root + ' ' + parsed.type.toUpperCase() + ' $' + parsed.strike + ' · exp ' + parsed.expiryISO;
      hint.classList.remove('err');
    }
  }

  function tweakInManual(payloadJson){
    if (!payloadJson) return;
    var p; try { p = JSON.parse(payloadJson); } catch (e) { return; }
    $('m-type').value = p.type === 'put' ? 'put' : 'call';
    if (p.spot != null)   $('m-spot').value   = String(p.spot);
    if (p.strike != null) $('m-strike').value = String(p.strike);
    if (p.expEpoch){
      var d = new Date(p.expEpoch*1000);
      var nyParts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
      var y='', mo='', da='';
      for (var i=0; i<nyParts.length; i++){
        var part = nyParts[i];
        if (part.type === 'year') y = part.value;
        else if (part.type === 'month') mo = part.value;
        else if (part.type === 'day') da = part.value;
      }
      if (y && mo && da) $('m-expiry').value = y + '-' + mo + '-' + da;
    }
    if (p.bid != null) $('m-bid').value = String(p.bid);
    if (p.ask != null) $('m-ask').value = String(p.ask);
    $('m-iv').value  = (p.iv != null)     ? (p.iv*100).toFixed(2) : '';
    $('m-oi').value  = (p.oi != null)     ? String(p.oi)          : '';
    $('m-vol').value = (p.volume != null) ? String(p.volume)      : '';
    var paste = $('m-paste'); if (paste){ paste.value=''; paste.classList.remove('err'); }
    var hint = $('m-paste-hint'); if (hint){ hint.textContent=''; hint.classList.remove('err'); }
    evaluateManual();
    var section = $('opt-manual-section');
    if (section && section.scrollIntoView) section.scrollIntoView({ behavior:'smooth', block:'start' });
    $('m-bid').focus();
  }

  function fetchChain(symbol){
    if (CHAIN_CACHE[symbol]) return Promise.resolve(CHAIN_CACHE[symbol]);
    var v = (MANIFEST && MANIFEST.builtAtIso) ? '?v=' + encodeURIComponent(MANIFEST.builtAtIso) : '';
    return fetch('data/' + encodeURIComponent(symbol) + '.json' + v, { cache: 'force-cache' })
      .then(function(resp){
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function(data){ CHAIN_CACHE[symbol] = data; return data; });
  }
  function loadChain(){
    var symbol = state.symbol; if (!symbol) return;
    var cached = !!CHAIN_CACHE[symbol];
    // The per-ticker JSON (chain + AI news take + technicals) is fetched here
    // and only here — nothing about a ticker is preloaded before the user
    // commits to it. force-cache keeps re-selects free for the rest of the
    // session.
    setStatus('opt-eval-status', cached ? '' : 'Loading ' + symbol + ' chain, news, technicals + fundamentals…', cached ? '' : 'loading');
    fetchChain(symbol).then(function(entry){
      state.spot = entry.spot;
      state.expirations = (entry.expirations || []).slice();
      state.chains = entry.chains || {};
      state.news = entry.news || null;
      state.technicals = entry.technicals || null;
      state.fundamentals = entry.fundamentals || null;
      state.social = entry.social || null;
      if (!state.expirations.length){ setStatus('opt-eval-status', 'No expirations for ' + symbol + '.', 'err'); return; }
      state.currentExp = state.expirations[0];
      populateExpiry();
      $('opt-expiry').value = String(state.currentExp);
      populateStrikes();
      applyPendingUrlState();
      renderMaxPain();
      $('opt-chain-row').hidden = false;
      renderTickerNarrativeChips(symbol);
      renderAnalysisShell();
      renderTechnicals(symbol);
      renderFundamentals(symbol);
      renderNewsPane();
      setStatus('opt-eval-status', symbol + ' · spot ' + fmtMoney(state.spot) + ' · ' + state.expirations.length + ' expirations', 'ok');
      evaluate();
      pushUrlState();
      // Kick off the live spot refresh in parallel — the page is already
      // usable with baked data; live just updates spot / Greeks / ATM pick
      // when it arrives. Quietly no-ops if the endpoint or market is closed.
      refreshLiveQuote(symbol);
    }).catch(function(err){
      setStatus('opt-eval-status', 'Failed to load ' + symbol + ': ' + (err && err.message || err), 'err');
    });
  }

  // --- Live spot --------------------------------------------------------
  // Vercel serverless function at /api/quote?symbol=XXX proxies Yahoo's
  // quote endpoint (consent cookie + crumb auth happen server-side). The
  // browser only needs spot + day change to make the grader reflect
  // intraday price; chain quotes and technicals stay on the baked daily
  // build. Cache successful responses for 30 s so rapid re-selects don't
  // re-fire the network call.
  var LIVE_CACHE = Object.create(null);
  var LIVE_TTL_MS = 30000;
  function fmtPctSigned(p){ if (p == null || !isFinite(p)) return ''; return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }
  function marketStateLabel(s){
    if (s === 'REGULAR') return { label: 'Live', cls: 'live' };
    if (s === 'PRE') return { label: 'Pre-market', cls: 'pre' };
    if (s === 'POST' || s === 'POSTPOST') return { label: 'After hours', cls: 'post' };
    return { label: 'Delayed', cls: 'delayed' };
  }
  function renderLiveQuote(symbol, q){
    var box = $('opt-live-quote'); if (!box) return;
    if (!q || q.spot == null){ box.hidden = true; box.innerHTML = ''; return; }
    var st = marketStateLabel(q.marketState);
    var changeCls = q.change == null ? '' : (q.change >= 0 ? 'up' : 'down');
    var changeTxt = q.change != null && isFinite(q.change)
      ? ((q.change >= 0 ? '+' : '') + '$' + Math.abs(q.change).toFixed(2) + ' (' + fmtPctSigned(q.changePct) + ')')
      : '';
    box.hidden = false;
    box.innerHTML = '<span class="opt-live-pill ' + st.cls + '">' + st.label + '</span>' +
      '<span class="opt-live-sym">' + escapeHtml(symbol) + '</span>' +
      '<span class="opt-live-spot">' + fmtMoney(q.spot) + '</span>' +
      (changeTxt ? '<span class="opt-live-chg ' + changeCls + '">' + changeTxt + '</span>' : '');
  }
  function refreshLiveQuote(symbol){
    if (!symbol) return;
    var box = $('opt-live-quote');
    var cached = LIVE_CACHE[symbol];
    if (cached && (Date.now() - cached.at) < LIVE_TTL_MS){
      applyLiveQuote(symbol, cached.q);
      return;
    }
    // Show a subtle "checking…" placeholder so the user knows the page is
    // still working in the background — replaced as soon as the call
    // resolves (or fails silently).
    if (box){
      box.hidden = false;
      box.innerHTML = '<span class="opt-live-pill checking">Checking quote…</span>' +
        '<span class="opt-live-sym">' + escapeHtml(symbol) + '</span>';
    }
    fetch('/api/quote?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' })
      .then(function(resp){
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function(q){
        if (!q || q.spot == null) throw new Error('no spot');
        LIVE_CACHE[symbol] = { q: q, at: Date.now() };
        // Bail if the user has already moved to a different ticker.
        if (state.symbol !== symbol) return;
        applyLiveQuote(symbol, q);
      })
      .catch(function(){
        // Silent failure — keep baked data, hide the placeholder.
        if (state.symbol !== symbol) return;
        if (box){ box.hidden = true; box.innerHTML = ''; }
      });
  }
  function applyLiveQuote(symbol, q){
    renderLiveQuote(symbol, q);
    if (q.spot != null && isFinite(q.spot) && q.spot > 0 && q.spot !== state.spot){
      state.spot = q.spot;
      // Re-snap the ATM strike pick to live spot, then regrade. The user's
      // current type/expiry selection is preserved by populateStrikes().
      populateStrikes();
      evaluate();
    }
    // Once we know the market is open, start polling the chain endpoint
    // every 30s so bid/ask/IV/volume stay fresh while the user is on the
    // page. Polling stops automatically on ticker change, market close,
    // tab hide, or page unload.
    startLivePolling();
  }

  // --- Live chain polling -------------------------------------------------
  // The baked per-ticker JSON is a 9am-ET snapshot. During the session,
  // bid/ask spreads tighten, IV moves around, OI/volume tick up, and the
  // spot drifts. /api/chain?symbol=X&exp=Y proxies a fresh Yahoo options
  // pull for the currently-viewed expiration and returns the same compressed
  // shape data/<SYMBOL>.json uses, so we can drop it straight into
  // state.chains[exp] and regrade without any other state changes.
  var CHAIN_POLL_MS = 30000;
  var livePollTimer = null;
  var livePollInFlight = false;
  var liveLastRefreshAt = null;
  function liveRefreshLabel(state){
    if (state === 'REGULAR') return 'Live · auto-refresh 30s';
    if (state === 'PRE') return 'Pre-market · refresh paused';
    if (state === 'POST' || state === 'POSTPOST') return 'After hours · refresh paused';
    return 'Market closed · refresh paused';
  }
  function renderLiveRefreshIndicator(marketState){
    var el = $('opt-live-refresh');
    if (!el) return;
    if (!state.symbol){ el.hidden = true; el.textContent = ''; return; }
    var since = liveLastRefreshAt ? Math.round((Date.now() - liveLastRefreshAt) / 1000) : null;
    var sinceTxt = (since != null && since >= 0 && since < 600)
      ? ' · last update ' + (since < 5 ? 'just now' : since + 's ago')
      : '';
    el.hidden = false;
    el.className = 'opt-live-refresh ' + (marketState === 'REGULAR' ? 'on' : 'off');
    el.textContent = liveRefreshLabel(marketState) + sinceTxt;
  }
  function refreshLiveChain(symbol, exp){
    if (!symbol || !exp) return;
    if (livePollInFlight) return;
    if (state.symbol !== symbol) return;
    livePollInFlight = true;
    fetch('/api/chain?symbol=' + encodeURIComponent(symbol) + '&exp=' + encodeURIComponent(exp), { cache: 'no-store' })
      .then(function(resp){ if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
      .then(function(r){
        livePollInFlight = false;
        if (!r || !r.chain) return;
        if (state.symbol !== symbol) return;
        if (Number(state.currentExp) !== Number(exp)) return;
        // Preserve the strike the user is currently looking at — picking
        // ATM every 30s would yank their selection.
        var prevContract = findContract();
        var prevStrike = prevContract ? prevContract.s : null;
        state.chains[exp] = r.chain;
        if (r.spot != null && isFinite(r.spot) && r.spot > 0) state.spot = r.spot;
        // Keep the live-quote pill in sync — same shape /api/quote returns
        // so renderLiveQuote can reuse its existing branch.
        var pillQ = { spot: r.spot, marketState: r.marketState, change: null, changePct: null };
        LIVE_CACHE[symbol] = { q: pillQ, at: Date.now() };
        renderLiveQuote(symbol, pillQ);
        populateStrikes();
        if (prevStrike != null){
          var type = getOptType();
          var rows = (type === 'call' ? r.chain.c : r.chain.p) || [];
          for (var i = 0; i < rows.length; i++){
            if (rows[i] && rows[i].s === prevStrike){
              $('opt-strike').selectedIndex = i;
              break;
            }
          }
        }
        liveLastRefreshAt = Date.now();
        renderMaxPain();
        evaluate();
        renderLiveRefreshIndicator(r.marketState);
        // Market just closed — stop polling.
        if (r.marketState !== 'REGULAR') stopLivePolling();
      })
      .catch(function(){
        livePollInFlight = false;
        // Silent failure; next interval will try again. Don't tear down
        // the timer on a single hiccup.
      });
  }
  function currentMarketState(){
    var c = LIVE_CACHE[state.symbol];
    return c && c.q ? c.q.marketState : null;
  }
  function startLivePolling(){
    stopLivePolling();
    if (document.hidden) return;
    if (!state.symbol || !state.currentExp) return;
    if (currentMarketState() !== 'REGULAR') {
      renderLiveRefreshIndicator(currentMarketState());
      return;
    }
    renderLiveRefreshIndicator('REGULAR');
    livePollTimer = setInterval(function(){
      if (document.hidden) return;
      if (!state.symbol || !state.currentExp){ stopLivePolling(); return; }
      refreshLiveChain(state.symbol, state.currentExp);
    }, CHAIN_POLL_MS);
  }
  function stopLivePolling(){
    if (livePollTimer){ clearInterval(livePollTimer); livePollTimer = null; }
  }
  // Pause when the tab is hidden — no point burning Yahoo calls for a
  // tab the user can't see. Resume on visibility return.
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) stopLivePolling();
    else startLivePolling();
  });

  // --- Technicals ---------------------------------------------------------
  function rsiState(rsi){
    if (rsi == null || !isFinite(rsi)) return { label:'—', cls:'fair', note:'not enough history' };
    if (rsi >= 70) return { label:'Overbought', cls:'warn',
      note:'stretched — calls here are buying late, puts may catch a mean-reversion bounce' };
    if (rsi <= 30) return { label:'Oversold', cls:'pos',
      note:'washed out — puts here are chasing, calls may catch a bounce' };
    if (rsi >= 55) return { label:'Bullish bias', cls:'pos',
      note:'momentum tilted up — trend traders lean long' };
    if (rsi <= 45) return { label:'Bearish bias', cls:'warn',
      note:'momentum tilted down — trend traders lean short' };
    return { label:'Neutral', cls:'fair', note:'no clear momentum edge either way' };
  }
  function macdState(macd){
    if (!macd) return { label:'—', cls:'fair', note:'not enough history' };
    if (macd.hist > 0 && macd.line > 0) return { label:'Bullish', cls:'pos',
      note:'MACD above signal and above zero — confirmed uptrend momentum' };
    if (macd.hist > 0 && macd.line <= 0) return { label:'Bullish cross', cls:'pos',
      note:'MACD crossed above signal while still under zero — early reversal signal' };
    if (macd.hist < 0 && macd.line < 0) return { label:'Bearish', cls:'warn',
      note:'MACD below signal and below zero — confirmed downtrend momentum' };
    if (macd.hist < 0 && macd.line >= 0) return { label:'Bearish cross', cls:'warn',
      note:'MACD crossed below signal while still above zero — early weakness signal' };
    return { label:'Flat', cls:'fair', note:'line and signal hugging — no clear momentum' };
  }
  function distancePct(level, spot){
    if (level == null || !isFinite(level) || !(spot > 0)) return null;
    return (level - spot) / spot * 100;
  }
  function fmtDistance(level, spot){
    var pct = distancePct(level, spot);
    if (pct == null) return '';
    var sign = pct >= 0 ? '+' : '';
    return sign + pct.toFixed(1) + '% vs spot';
  }
  function techCard(label, valueHtml, stateHtml, noteHtml, tip){
    return '<div class="opt-tech-card">' +
      '<div class="opt-tech-label">' + label + tipChip(tip) + '</div>' +
      '<div class="opt-tech-value">' + valueHtml + '</div>' +
      (stateHtml ? '<div class="opt-tech-state">' + stateHtml + '</div>' : '') +
      (noteHtml ? '<div class="opt-tech-note">' + noteHtml + '</div>' : '') +
    '</div>';
  }
  function renderTechnicals(sym){
    var box = $('opt-technicals');
    var grid = $('opt-tech-grid');
    if (!box || !grid) return;
    var t = state.technicals;
    if (!t){ box.hidden = true; grid.innerHTML = ''; return; }
    var spot = state.spot;
    var rsiSt = rsiState(t.rsi);
    var macdSt = macdState(t.macd);
    var html = '';

    html += techCard(
      'RSI (14)',
      '<span class="opt-tech-num">' + (t.rsi != null ? t.rsi.toFixed(1) : '—') + '</span>',
      '<span class="opt-tech-pill ' + rsiSt.cls + '">' + rsiSt.label + '</span>',
      escapeHtml(rsiSt.note),
      TIPS.rsi
    );

    if (t.macd){
      var macdVal = '<span class="opt-tech-num">' + (t.macd.hist >= 0 ? '+' : '') + t.macd.hist.toFixed(3) + '</span>' +
        '<span class="opt-tech-vsub">line ' + t.macd.line.toFixed(3) + ' · signal ' + t.macd.signal.toFixed(3) + '</span>';
      html += techCard(
        'MACD (12,26,9)',
        macdVal,
        '<span class="opt-tech-pill ' + macdSt.cls + '">' + macdSt.label + '</span>',
        escapeHtml(macdSt.note),
        TIPS.macd
      );
    } else {
      html += techCard('MACD (12,26,9)', '<span class="opt-tech-num">—</span>', '', 'not enough history', TIPS.macd);
    }

    if (t.sr){
      var sup = t.sr.s20;
      var supFar = t.sr.s50;
      var supVal = '<span class="opt-tech-num">' + (sup != null ? '$' + fmt(sup) : '—') + '</span>' +
        (supFar != null && supFar !== sup ? '<span class="opt-tech-vsub">50d $' + fmt(supFar) + '</span>' : '');
      var supDist = sup != null ? fmtDistance(sup, spot) : '';
      var supBroken = (sup != null && spot < sup);
      html += techCard(
        'Support (20d)',
        supVal,
        supDist ? '<span class="opt-tech-pill ' + (supBroken ? 'warn' : 'fair') + '">' + supDist + '</span>' : '',
        supBroken
          ? 'Spot is below the 20-day low — buyers haven\\'t defended this level yet'
          : 'Recent floor — buyers stepped in here; a break below is a meaningful technical event',
        TIPS.support
      );

      var res = t.sr.r20;
      var resFar = t.sr.r50;
      var resVal = '<span class="opt-tech-num">' + (res != null ? '$' + fmt(res) : '—') + '</span>' +
        (resFar != null && resFar !== res ? '<span class="opt-tech-vsub">50d $' + fmt(resFar) + '</span>' : '');
      var resDist = res != null ? fmtDistance(res, spot) : '';
      var resBroken = (res != null && spot > res);
      html += techCard(
        'Resistance (20d)',
        resVal,
        resDist ? '<span class="opt-tech-pill ' + (resBroken ? 'pos' : 'fair') + '">' + resDist + '</span>' : '',
        resBroken
          ? 'Spot is above the 20-day high — fresh breakout; watch for follow-through'
          : 'Recent ceiling — sellers showed up here; a clean break above is a meaningful technical event',
        TIPS.resistance
      );
    }

    grid.innerHTML = html;
    box.hidden = false;
  }

  // --- Fundamentals + earnings -------------------------------------------
  function fmtBigDollars(n){
    if (n == null || !isFinite(n)) return null;
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    return '$' + Math.round(n).toLocaleString();
  }
  function fundMetric(label, value, tone){
    if (value == null || value === '') return '';
    var toneCls = tone ? ' tone-' + tone : '';
    return '<div class="opt-fund-metric' + toneCls + '">' +
      '<div class="opt-fund-metric-label">' + escapeHtml(label) + '</div>' +
      '<div class="opt-fund-metric-value">' + value + '</div>' +
    '</div>';
  }
  function fundVerdictLabel(v){
    if (v === 'strong') return 'Strong fundamentals';
    if (v === 'weak') return 'Weak fundamentals';
    return 'Mixed fundamentals';
  }
  function renderFundamentals(sym){
    var box = $('opt-fundamentals');
    if (!box) return;
    var f = state.fundamentals;
    if (!f){ box.hidden = true; return; }
    var hasJudgment = f.judgment && (f.judgment.positives && f.judgment.positives.length || f.judgment.negatives && f.judgment.negatives.length || f.judgment.summary);
    var hasMetrics = (f.trailingPE != null || f.forwardPE != null || f.marketCap != null || f.profitMargin != null || f.revenueGrowthYoy != null || f.lastQuarter || f.nextEarningsDate);
    if (!hasJudgment && !hasMetrics){ box.hidden = true; return; }

    var verdictEl = $('opt-fund-verdict');
    var summaryEl = $('opt-fund-summary');
    var recapEl = $('opt-fund-recap');
    var posList = $('opt-fund-pos-list');
    var negList = $('opt-fund-neg-list');
    var metricsEl = $('opt-fund-metrics');

    if (hasJudgment){
      var j = f.judgment;
      var v = j.verdict || 'mixed';
      verdictEl.className = 'opt-fund-verdict ' + v;
      verdictEl.textContent = fundVerdictLabel(v);
      summaryEl.textContent = j.summary || '';
      summaryEl.hidden = !j.summary;
      if (j.earningsRecap){
        recapEl.innerHTML = '<span class="opt-fund-recap-label">Last earnings</span> ' + escapeHtml(j.earningsRecap);
        recapEl.hidden = false;
      } else {
        recapEl.hidden = true;
        recapEl.innerHTML = '';
      }
      posList.innerHTML = (j.positives || []).map(function(p){
        return '<li>' + escapeHtml(p) + '</li>';
      }).join('') || '<li class="opt-fund-empty">No clear positives surfaced.</li>';
      negList.innerHTML = (j.negatives || []).map(function(p){
        return '<li>' + escapeHtml(p) + '</li>';
      }).join('') || '<li class="opt-fund-empty">No clear negatives surfaced.</li>';
    } else {
      verdictEl.className = 'opt-fund-verdict';
      verdictEl.textContent = '';
      summaryEl.textContent = 'AI judgment unavailable for this ticker — raw metrics below.';
      summaryEl.hidden = false;
      recapEl.hidden = true;
      recapEl.innerHTML = '';
      posList.innerHTML = '';
      negList.innerHTML = '';
    }

    var metrics = '';
    metrics += fundMetric('Market cap', fmtBigDollars(f.marketCap));
    metrics += fundMetric('Trailing P/E', f.trailingPE != null ? f.trailingPE.toFixed(1) : null);
    metrics += fundMetric('Forward P/E', f.forwardPE != null ? f.forwardPE.toFixed(1) : null);
    metrics += fundMetric('PEG', f.pegRatio != null ? f.pegRatio.toFixed(2) : null);
    metrics += fundMetric('Price / Sales', f.priceToSales != null ? f.priceToSales.toFixed(2) : null);
    metrics += fundMetric('Rev. growth YoY', f.revenueGrowthYoy != null ? f.revenueGrowthYoy.toFixed(1) + '%' : null,
      f.revenueGrowthYoy != null ? (f.revenueGrowthYoy > 0 ? 'pos' : 'neg') : null);
    metrics += fundMetric('EPS growth YoY', f.earningsGrowthYoy != null ? f.earningsGrowthYoy.toFixed(1) + '%' : null,
      f.earningsGrowthYoy != null ? (f.earningsGrowthYoy > 0 ? 'pos' : 'neg') : null);
    metrics += fundMetric('Profit margin', f.profitMargin != null ? f.profitMargin.toFixed(1) + '%' : null,
      f.profitMargin != null ? (f.profitMargin > 10 ? 'pos' : f.profitMargin < 0 ? 'neg' : null) : null);
    metrics += fundMetric('Operating margin', f.operatingMargin != null ? f.operatingMargin.toFixed(1) + '%' : null);
    metrics += fundMetric('ROE', f.returnOnEquity != null ? f.returnOnEquity.toFixed(1) + '%' : null,
      f.returnOnEquity != null ? (f.returnOnEquity > 15 ? 'pos' : f.returnOnEquity < 0 ? 'neg' : null) : null);
    metrics += fundMetric('Debt / Equity', f.debtToEquity != null ? f.debtToEquity.toFixed(0) : null,
      f.debtToEquity != null ? (f.debtToEquity > 200 ? 'neg' : null) : null);
    metrics += fundMetric('Free cash flow', fmtBigDollars(f.freeCashFlow),
      f.freeCashFlow != null ? (f.freeCashFlow > 0 ? 'pos' : 'neg') : null);
    metrics += fundMetric('Dividend yield', f.dividendYield != null && f.dividendYield > 0 ? f.dividendYield.toFixed(2) + '%' : null);
    if (f.lastQuarter){
      var lq = f.lastQuarter;
      var surprise = lq.surprisePct != null ? ((lq.surprisePct >= 0 ? '+' : '') + lq.surprisePct.toFixed(1) + '%') : null;
      var beatTone = lq.surprisePct == null ? null : (lq.surprisePct > 2 ? 'pos' : lq.surprisePct < -2 ? 'neg' : null);
      var lqVal = 'EPS ' + (lq.epsActual != null ? lq.epsActual.toFixed(2) : '—');
      if (lq.epsEstimate != null) lqVal += ' <span class="opt-fund-metric-sub">est ' + lq.epsEstimate.toFixed(2) + '</span>';
      if (surprise) lqVal += ' <span class="opt-fund-metric-sub">(' + surprise + ')</span>';
      var lqLabel = 'Last earnings' + (lq.period ? ' (' + lq.period + ')' : '') + (lq.date ? ' · ' + lq.date : '');
      metrics += fundMetric(lqLabel, lqVal, beatTone);
    }
    if (f.nextEarningsDate){
      metrics += fundMetric('Next earnings', f.nextEarningsDate, 'warn');
    }
    if (f.targetMeanPrice != null && state.spot){
      var upside = (f.targetMeanPrice - state.spot) / state.spot * 100;
      var upsideStr = (upside >= 0 ? '+' : '') + upside.toFixed(1) + '%';
      metrics += fundMetric('Analyst target',
        '$' + f.targetMeanPrice.toFixed(2) + ' <span class="opt-fund-metric-sub">' + upsideStr + ' vs spot</span>',
        upside > 5 ? 'pos' : upside < -5 ? 'neg' : null);
    }
    if (f.recommendationKey){
      var recPretty = f.recommendationKey.replace(/_/g, ' ');
      var recTone = /buy|outperform/i.test(f.recommendationKey) ? 'pos' : /sell|underperform/i.test(f.recommendationKey) ? 'neg' : null;
      metrics += fundMetric('Consensus', recPretty + (f.numberOfAnalystOpinions ? ' <span class="opt-fund-metric-sub">' + f.numberOfAnalystOpinions + ' analysts</span>' : ''), recTone);
    }
    metricsEl.innerHTML = metrics;
    renderEarningsHistory();
    box.hidden = false;
  }

  function renderEarningsHistory(){
    var box = $('opt-fund-earnings-history');
    if (!box) return;
    var f = state.fundamentals;
    var eh = (f && Array.isArray(f.earningsHistory)) ? f.earningsHistory : [];
    if (eh.length < 2){ box.hidden = true; box.innerHTML = ''; return; }

    var W = 320, H = 140, padL = 36, padR = 12, padT = 12, padB = 26;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var vals = [];
    eh.forEach(function(q){
      if (q.epsActual != null) vals.push(q.epsActual);
      if (q.epsEstimate != null) vals.push(q.epsEstimate);
    });
    if (vals.length < 2){ box.hidden = true; box.innerHTML = ''; return; }
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    var range = hi - lo;
    if (range === 0){ range = Math.abs(hi) > 0 ? Math.abs(hi) * 0.2 : 1; }
    var pad = range * 0.15;
    var yMin = lo - pad;
    var yMax = hi + pad;
    function yFor(v){ return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

    var colW = plotW / eh.length;
    function xFor(i){ return padL + colW * (i + 0.5); }

    var qLabel = function(q){
      if (q.period) return q.period;
      if (q.date){
        var d = new Date(q.date);
        if (!isNaN(d.getTime())){
          var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
          return m + ' ' + String(d.getUTCFullYear()).slice(2);
        }
      }
      return '';
    };

    var yTicks = 3;
    var yAxis = '';
    for (var i = 0; i < yTicks; i++){
      var t = yMin + (yMax - yMin) * (i / (yTicks - 1));
      var y = yFor(t);
      yAxis += '<line class="opt-fund-eh-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" />';
      yAxis += '<text class="opt-fund-eh-axis" x="' + (padL - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + escapeHtml(t.toFixed(2)) + '</text>';
    }

    var actualPts = [];
    var dots = '';
    var xLabels = '';
    eh.forEach(function(q, i){
      var x = xFor(i);
      if (q.epsEstimate != null){
        dots += '<circle class="opt-fund-eh-est" cx="' + x.toFixed(1) + '" cy="' + yFor(q.epsEstimate).toFixed(1) + '" r="4"><title>Est ' + escapeHtml(q.epsEstimate.toFixed(2)) + '</title></circle>';
      }
      if (q.epsActual != null){
        var ay = yFor(q.epsActual);
        dots += '<circle class="opt-fund-eh-act" cx="' + x.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="4"><title>Actual ' + escapeHtml(q.epsActual.toFixed(2)) + (q.surprisePct != null ? ' (' + (q.surprisePct >= 0 ? '+' : '') + q.surprisePct.toFixed(1) + '%)' : '') + '</title></circle>';
        actualPts.push(x.toFixed(1) + ',' + ay.toFixed(1));
      }
      xLabels += '<text class="opt-fund-eh-axis" x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + escapeHtml(qLabel(q)) + '</text>';
    });
    var line = actualPts.length >= 2
      ? '<polyline class="opt-fund-eh-line" points="' + actualPts.join(' ') + '" />'
      : '';

    var svg = '<svg class="opt-fund-eh-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="EPS estimated vs actual, last ' + eh.length + ' quarters">' +
      yAxis + line + dots + xLabels +
      '</svg>';
    var legend = '<div class="opt-fund-eh-legend">' +
      '<span><i class="opt-fund-eh-dot est"></i> Estimated EPS</span>' +
      '<span><i class="opt-fund-eh-dot act"></i> Actual EPS</span>' +
      '</div>';
    var head = '<div class="opt-fund-eh-head">Earnings history</div>';
    box.innerHTML = head + svg + legend;
    box.hidden = false;
  }

  function renderSocialSentiment(){
    var box = $('opt-news-pane');
    if (!box) return null;
    var s = state.social;
    if (!s || !s.msgCount24h || s.msgCount24h < 5) return '';
    var bull = Math.max(0, Math.round(s.bullishPct || 0));
    var bear = Math.max(0, Math.round(s.bearishPct || 0));
    var neutral = Math.max(0, 100 - bull - bear);
    var msgs = s.msgCount24h >= 1000
      ? (s.msgCount24h / 1000).toFixed(1) + 'k'
      : Math.round(s.msgCount24h).toString();
    var lean = bull > bear + 5 ? 'bullish' : bear > bull + 5 ? 'bearish' : 'mixed';
    var chips = [];
    if (s.sources && s.sources.stocktwits){
      chips.push('st: ' + s.sources.stocktwits.total);
    }
    if (s.sources && s.sources.reddit){
      chips.push('reddit: ' + s.sources.reddit.total);
    }
    var html = '<div class="opt-social ' + lean + '">' +
      '<div class="opt-social-head">' +
        '<span class="opt-social-label">Retail chatter</span>' +
        '<span class="opt-social-stat">' + bull + '% bullish · ' + bear + '% bearish · ' + msgs + ' msgs/24h</span>' +
      '</div>' +
      '<div class="opt-social-bar" role="img" aria-label="' + bull + ' percent bullish, ' + bear + ' percent bearish">' +
        '<span class="bull" style="width:' + bull + '%"></span>' +
        '<span class="neutral" style="width:' + neutral + '%"></span>' +
        '<span class="bear" style="width:' + bear + '%"></span>' +
      '</div>' +
      (chips.length ? '<div class="opt-social-sources">' + escapeHtml(chips.join(' · ')) + '</div>' : '') +
    '</div>';
    return html;
  }

  function onExpiryChange(){
    var exp = Number($('opt-expiry').value);
    state.currentExp = exp;
    populateStrikes();
    renderMaxPain();
    scheduleEvaluate();
    pushUrlState();
    // The baked chain for the new expiration is already cached, but during
    // market hours the user wants fresh quotes for the expiration they're
    // looking at — fire one extra poll immediately and let the interval
    // pick up from there.
    if (currentMarketState() === 'REGULAR') refreshLiveChain(state.symbol, exp);
  }

  // --- Narratives ---------------------------------------------------------
  function tickerChipHtml(sym, side){
    var sec = SECTORS[sym] || '';
    var titleAttr = sec ? ' title="' + escapeHtml(sec) + '"' : '';
    return '<span class="narr-chip ' + side + '"' + titleAttr + '>' + escapeHtml(sym) + '</span>';
  }
  function narrLifeLabel(n){
    var d = n.daysRunning | 0;
    if (!d || d <= 1) return 'New today';
    return 'Day ' + d;
  }
  function narrStatusLabel(s){
    return ({ active:'Active', building:'Building', fading:'Fading' })[s] || 'Active';
  }
  function narrTimeframeLabel(tf){
    return ({ immediate:'This week', 'near-term':'1-4 wks', 'medium-term':'1-3 mo', 'long-term':'3+ mo' })[tf] || 'Near-term';
  }
  function strengthBarHtml(strength){
    var s = Math.max(0, Math.min(100, strength | 0));
    var tier = s >= 75 ? 'hi' : s >= 45 ? 'mid' : 'lo';
    return '<div class="narr-strength" title="Strength ' + s + ' / 100">' +
      '<div class="narr-strength-track"><div class="narr-strength-fill ' + tier + '" style="width:' + s + '%"></div></div>' +
      '<span class="narr-strength-num">' + s + '</span>' +
    '</div>';
  }
  function watchForItems(n){
    // New field is watchFor; legacy snapshots used triggers. Accept both.
    if (Array.isArray(n.watchFor) && n.watchFor.length) return n.watchFor;
    if (Array.isArray(n.triggers) && n.triggers.length) return n.triggers;
    return [];
  }
  function watchForHtml(n){
    var items = watchForItems(n);
    if (!items.length) return '';
    return '<div class="narr-watchfor">' +
      '<div class="narr-watchfor-head">' +
        '<span class="narr-watchfor-icon" aria-hidden="true">⚠</span>' +
        '<span class="narr-watchfor-label">Watch for narrative shift</span>' +
      '</div>' +
      '<ul class="narr-watchfor-list">' +
      items.map(function(t){ return '<li>' + escapeHtml(t) + '</li>'; }).join('') +
      '</ul>' +
    '</div>';
  }
  function conflictsHtml(n){
    if (!n.conflictsWith || !n.conflictsWith.length) return '';
    return '<div class="narr-conflicts">' +
      '<span class="narr-conflicts-label">Clashes with</span>' +
      n.conflictsWith.map(function(c){ return '<span class="narr-conflict-chip">' + escapeHtml(c) + '</span>'; }).join('') +
    '</div>';
  }
  function narrativeCardHtml(n, rankInSector){
    var sent = n.sentiment === 'bearish' ? 'bearish' : 'bullish';
    var status = ['active','building','fading'].indexOf(n.status) >= 0 ? n.status : 'active';
    var tf = n.timeframe || 'near-term';
    var confLabel = ({ high:'High', medium:'Medium', low:'Low' })[n.confidence] || 'Medium';
    var longChips = (n.longs || []).map(function(t){ return tickerChipHtml(t, 'long'); }).join('');
    var shortChips = (n.shorts || []).map(function(t){ return tickerChipHtml(t, 'short'); }).join('');
    var longRow = longChips ? '<div class="narr-side-row long"><span class="narr-side-label">Long</span>' + longChips + '</div>' : '';
    var shortRow = shortChips ? '<div class="narr-side-row short"><span class="narr-side-label">Short</span>' + shortChips + '</div>' : '';
    var staleTag = '';
    if (n.stale){
      // Show how long the cached data has been stale so the user can judge
      // whether to trust it. Computed from staleSinceIso when present, else
      // labelled just "Stale".
      var staleAge = '';
      if (n.staleSinceIso){
        var since = Date.parse(n.staleSinceIso);
        if (isFinite(since)){
          var days = Math.max(1, Math.floor((Date.now() - since) / 86400000));
          staleAge = ' · ' + days + 'd';
        }
      }
      staleTag = '<span class="narr-tag stale" title="Today\\'s extraction failed — showing the last successful narrative">Stale' + staleAge + '</span>';
    }
    return '<article class="narr' + (n.stale ? ' is-stale' : '') + '" data-sent="' + sent + '" data-status="' + status + '" role="listitem">' +
      '<span class="narr-accent" aria-hidden="true"></span>' +
      '<header class="narr-head">' +
        (rankInSector ? '<span class="narr-rank" aria-label="Rank">#' + rankInSector + '</span>' : '') +
        '<h3 class="narr-name">' + escapeHtml(n.name) + '</h3>' +
        '<span class="narr-tag sent ' + sent + '">' + (sent === 'bullish' ? 'Bullish' : 'Bearish') + '</span>' +
        '<span class="narr-tag status ' + status + '">' + narrStatusLabel(status) + '</span>' +
        '<span class="narr-tag tf" title="Typical playout window">' + narrTimeframeLabel(tf) + '</span>' +
        '<span class="narr-tag conf">Conf · ' + confLabel + '</span>' +
        staleTag +
        '<span class="narr-life"><span class="narr-life-dot"></span>' + escapeHtml(narrLifeLabel(n)) + '</span>' +
      '</header>' +
      strengthBarHtml(n.strength) +
      '<p class="narr-thesis">' + escapeHtml(n.thesis || '') + '</p>' +
      longRow + shortRow +
      watchForHtml(n) +
      conflictsHtml(n) +
    '</article>';
  }
  // Sector-overview banner — the top-down story for the active sector. Sits
  // above the sub-industry narrative blocks. Shows stance (bullish / bearish /
  // mixed), a thesis paragraph, a strength bar, and a watch-for panel of
  // red-flag catalysts that would flip the sector view.
  function sectorOverviewHtml(sector, overview){
    if (!overview || !overview.thesis) {
      return '<section class="narr-sector-overview is-empty" data-stance="neutral">' +
        '<header class="narr-sector-overview-head">' +
          '<span class="narr-sector-overview-eyebrow">Sector overview</span>' +
          '<h3 class="narr-sector-overview-title">' + escapeHtml(sector) + '</h3>' +
        '</header>' +
        '<p class="narr-sector-overview-thesis muted">No top-down view recorded for this build.</p>' +
      '</section>';
    }
    var stance = ['bullish','bearish','mixed'].indexOf(overview.stance) >= 0 ? overview.stance : 'mixed';
    var stanceLabel = ({ bullish:'Bullish', bearish:'Bearish', mixed:'Mixed' })[stance];
    var strengthHtml = (typeof overview.strength === 'number')
      ? strengthBarHtml(overview.strength)
      : '';
    var watchHtml = watchForHtml({ watchFor: overview.watchFor || [] });
    var staleTag = '';
    if (overview.stale) {
      var staleAge = '';
      if (overview.staleSinceIso) {
        var since = Date.parse(overview.staleSinceIso);
        if (isFinite(since)) {
          var days = Math.max(1, Math.floor((Date.now() - since) / 86400000));
          staleAge = ' · ' + days + 'd';
        }
      }
      staleTag = '<span class="narr-tag stale" title="Today\\'s extraction failed — showing the last successful overview">Stale' + staleAge + '</span>';
    }
    return '<section class="narr-sector-overview" data-stance="' + stance + '"' + (overview.stale ? ' data-stale="1"' : '') + '>' +
      '<header class="narr-sector-overview-head">' +
        '<span class="narr-sector-overview-eyebrow">Sector overview</span>' +
        '<h3 class="narr-sector-overview-title">' + escapeHtml(sector) + '</h3>' +
        '<span class="narr-sector-overview-stance ' + stance + '">' + stanceLabel + '</span>' +
        staleTag +
      '</header>' +
      strengthHtml +
      '<p class="narr-sector-overview-thesis">' + escapeHtml(overview.thesis) + '</p>' +
      watchHtml +
    '</section>';
  }
  // Group narratives by sector + industry, keeping the strongest-first order
  // already applied to NARRATIVES.
  function groupNarratives(){
    var bySector = {};
    for (var s=0; s<SECTOR_ORDER.length; s++) bySector[SECTOR_ORDER[s]] = {};
    for (var i=0; i<NARRATIVES.length; i++){
      var n = NARRATIVES[i];
      var ind = n.industry || 'Uncategorized';
      var sec = SECTOR_OF_INDUSTRY[ind];
      if (!sec){
        // Industry the AI invented isn't in our taxonomy — file it under the
        // longs' parent sector when we can resolve one, otherwise bucket it
        // under "Uncategorized" inside Technology so the user still sees it.
        var firstTicker = (n.longs && n.longs[0]) || (n.shorts && n.shorts[0]);
        var inferredInd = firstTicker ? INDUSTRIES[firstTicker] : null;
        sec = (inferredInd && SECTOR_OF_INDUSTRY[inferredInd]) || SECTOR_ORDER[0];
        ind = inferredInd || ind;
      }
      if (!bySector[sec]) bySector[sec] = {};
      if (!bySector[sec][ind]) bySector[sec][ind] = [];
      bySector[sec][ind].push(n);
    }
    return bySector;
  }
  function renderNarrativeTabs(grouped){
    var tabs = $('narratives-tabs');
    if (!tabs) return;
    tabs.innerHTML = SECTOR_ORDER.map(function(sec){
      var industries = grouped[sec] || {};
      var total = 0;
      for (var k in industries) total += industries[k].length;
      var isActive = sec === ACTIVE_SECTOR;
      return '<button type="button" class="narr-tab' + (isActive ? ' is-active' : '') + '"' +
        ' role="tab" aria-selected="' + (isActive ? 'true' : 'false') + '"' +
        ' data-sector="' + escapeHtml(sec) + '">' +
        '<span class="narr-tab-name">' + escapeHtml(sec) + '</span>' +
        '<span class="narr-tab-count">' + total + '</span>' +
        '</button>';
    }).join('');
    tabs.addEventListener('click', function(ev){
      var btn = ev.target.closest && ev.target.closest('.narr-tab');
      if (!btn) return;
      var sec = btn.getAttribute('data-sector');
      if (!sec || sec === ACTIVE_SECTOR) return;
      ACTIVE_SECTOR = sec;
      var all = tabs.querySelectorAll('.narr-tab');
      for (var i=0; i<all.length; i++){
        var on = all[i].getAttribute('data-sector') === sec;
        all[i].classList.toggle('is-active', on);
        all[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      renderActiveSectorPanel(grouped);
    }, { once: false });
  }
  function renderActiveSectorPanel(grouped){
    var panel = $('narratives-panel');
    if (!panel) return;
    var industries = INDUSTRIES_BY_SECTOR[ACTIVE_SECTOR] || [];
    var sectorNarratives = grouped[ACTIVE_SECTOR] || {};
    // Order industries: those with narratives first (preserve taxonomy order
    // among them), then empty ones. Lets active stories surface immediately
    // without losing the "everything we watch" picture below.
    var withN = [];
    var empties = [];
    for (var i=0; i<industries.length; i++){
      var ind = industries[i];
      if ((sectorNarratives[ind] || []).length) withN.push(ind);
      else empties.push(ind);
    }
    // Catch any narratives whose industry is in this sector but isn't in the
    // taxonomy list (defensive — shouldn't happen post-sanitization).
    for (var key in sectorNarratives){
      if (industries.indexOf(key) < 0) withN.push(key);
    }
    var overview = SECTOR_OVERVIEWS[ACTIVE_SECTOR] || null;
    var html = sectorOverviewHtml(ACTIVE_SECTOR, overview) +
      '<div class="narr-industries">';
    var rank = 0;
    for (var w=0; w<withN.length; w++){
      var ind2 = withN[w];
      var arr = sectorNarratives[ind2] || [];
      html += '<section class="narr-industry has-narratives" aria-label="' + escapeHtml(ind2) + '">' +
        '<header class="narr-industry-head">' +
          '<h3 class="narr-industry-name">' + escapeHtml(ind2) + '</h3>' +
          '<span class="narr-industry-count">' + arr.length + ' narrative' + (arr.length === 1 ? '' : 's') + '</span>' +
        '</header>' +
        '<div class="narr-industry-list" role="list">' +
        arr.map(function(n){ rank += 1; return narrativeCardHtml(n, rank); }).join('') +
        '</div>' +
      '</section>';
    }
    if (empties.length){
      html += '<details class="narr-empties"><summary>' +
        '<span class="narr-empties-label">No active narrative</span>' +
        '<span class="narr-empties-count">' + empties.length + ' sub-industr' + (empties.length === 1 ? 'y' : 'ies') + ' watching</span>' +
        '</summary>' +
        '<ul class="narr-empties-list">' +
        empties.map(function(ind){ return '<li>' + escapeHtml(ind) + '</li>'; }).join('') +
        '</ul></details>';
    }
    html += '</div>';
    panel.innerHTML = html;
  }
  function renderNarratives(){
    var empty = $('narratives-empty');
    var ended = $('narratives-ended');
    var count = $('narratives-count');
    if (count){
      if (NARRATIVES.length){
        var activeN = 0, buildingN = 0;
        for (var i=0; i<NARRATIVES.length; i++){
          if (NARRATIVES[i].status === 'building') buildingN++;
          else if (NARRATIVES[i].status !== 'fading') activeN++;
        }
        var parts = [activeN + ' active'];
        if (buildingN) parts.push(buildingN + ' building');
        count.textContent = parts.join(' · ');
      } else {
        count.textContent = '';
      }
    }
    var tabs = $('narratives-tabs');
    var panel = $('narratives-panel');
    if (!NARRATIVES.length){
      if (tabs) tabs.innerHTML = '';
      if (panel) panel.innerHTML = '';
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      // Default the active sector to the first one that actually has a
      // narrative, so the user sees content on first paint instead of an
      // empty Technology tab (which can happen if AI tags differently).
      var grouped = groupNarratives();
      var hasActive = false;
      var groupedSec = grouped[ACTIVE_SECTOR] || {};
      for (var ind in groupedSec){ if (groupedSec[ind].length) { hasActive = true; break; } }
      if (!hasActive){
        for (var s=0; s<SECTOR_ORDER.length; s++){
          var sec = SECTOR_ORDER[s];
          var inds = grouped[sec] || {};
          for (var k in inds){ if (inds[k].length) { ACTIVE_SECTOR = sec; hasActive = true; break; } }
          if (hasActive) break;
        }
      }
      renderNarrativeTabs(grouped);
      renderActiveSectorPanel(grouped);
    }
    if (ended){
      if (RECENTLY_ENDED.length){
        ended.innerHTML = '<div class="narr-ended-head">Recently cooled off</div>' +
          '<div class="narr-ended-strip">' +
          RECENTLY_ENDED.map(function(e){
            var d = e.daysSince | 0;
            var ran = e.ranDays | 0;
            var ago = d === 1 ? 'yesterday' : d + ' days ago';
            var run = ran <= 1 ? 'one-day blip' : ran + '-day run';
            return '<div class="narr-ended-card">' +
              '<div class="narr-ended-name">' + escapeHtml(e.name) + '</div>' +
              '<div class="narr-ended-meta">' + ago + ' · ' + run + '</div>' +
            '</div>';
          }).join('') +
          '</div>';
      } else {
        ended.innerHTML = '';
      }
    }
    var macro = $('narratives-macro');
    if (macro){
      if (MACRO_HEADLINES.length){
        // Show the top 8 freshest macro hits so users can see what the
        // narrative engine just looked at. Collapsed by default — it's
        // context, not the headline UI.
        macro.innerHTML = '<details class="narr-macro-details">' +
          '<summary><span class="narr-macro-head">Macro signal feed</span>' +
          '<span class="narr-macro-meta">' + MACRO_HEADLINES.length + ' headlines · Fed · BLS · Treasury · SEC · MarketWatch · CNBC</span></summary>' +
          '<ul class="narr-macro-list">' +
          MACRO_HEADLINES.slice(0, 12).map(function(h){
            var date = h.publishedAt ? h.publishedAt.slice(0, 10) : '';
            return '<li>' +
              (date ? '<span class="narr-macro-date">' + escapeHtml(date) + '</span>' : '') +
              '<span class="narr-macro-pub">' + escapeHtml(h.publisher || 'source') + '</span>' +
              '<span class="narr-macro-title">' + escapeHtml(h.title || '') + '</span>' +
            '</li>';
          }).join('') +
          '</ul></details>';
      } else {
        macro.innerHTML = '';
      }
    }
  }
  function narrativesForTicker(sym){
    if (!sym) return [];
    var hits = [];
    for (var i=0; i<NARRATIVES.length; i++){
      var n = NARRATIVES[i];
      if ((n.longs || []).indexOf(sym) >= 0) hits.push({ n: n, side: 'long' });
      else if ((n.shorts || []).indexOf(sym) >= 0) hits.push({ n: n, side: 'short' });
    }
    return hits;
  }
  function renderTickerNarrativeChips(sym){
    var box = $('opt-narr-chips');
    if (!box) return;
    var hits = narrativesForTicker(sym);
    if (!hits.length){ box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<span class="opt-narr-chips-label">Narratives</span>' + hits.map(function(h){
      var sentLabel = h.n.sentiment === 'bearish' ? 'Bearish' : 'Bullish';
      return '<span class="opt-narr-chip ' + h.side + '" title="' + escapeHtml(h.n.thesis || '') + '">' +
        escapeHtml(h.n.name) +
        '<span class="opt-narr-chip-side">' + h.side.toUpperCase() + ' · ' + sentLabel + '</span>' +
      '</span>';
    }).join('');
  }

  // --- Unusual options flow ------------------------------------------------
  function fmtVolume(n){
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\\.0$/, '') + 'k';
    return String(n);
  }
  function fmtExpiry(epochSec){
    if (!epochSec) return '—';
    var d = new Date(epochSec * 1000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }
  function deltaTier(d){
    if (!d || !isFinite(d)) return 'mild';
    if (d >= 8000) return 'hot';
    if (d >= 4000) return 'warm';
    return 'mild';
  }
  function fmtDelta(d){
    if (d == null || !isFinite(d)) return '—';
    var sign = d > 0 ? '+' : '';
    if (Math.abs(d) >= 1000) return sign + (d / 1000).toFixed(d >= 10000 || d <= -10000 ? 0 : 1).replace(/\\.0$/, '') + 'k';
    return sign + d;
  }
  function fmtOtm(p){
    if (p == null || !isFinite(p)) return '';
    return Math.round(p * 100) + '%';
  }
  function tapeLabel(t){
    if (t === 'ask') return 'AT ASK';
    if (t === 'abv') return '>MID';
    if (t === 'mid') return 'MID';
    if (t === 'blw') return '<MID';
    if (t === 'bid') return 'AT BID';
    return '';
  }
  function tapeTitle(t){
    if (t === 'ask') return 'Last print at ask — aggressive buyers scrambling for fills';
    if (t === 'abv') return 'Last print above mid — buy-side pressure';
    if (t === 'mid') return 'Last print near midpoint — balanced flow';
    if (t === 'blw') return 'Last print below mid — sell-side pressure';
    if (t === 'bid') return 'Last print at bid — aggressive sellers';
    return '';
  }
  function fmtScannedAt(iso){
    if (!iso) return '';
    try {
      var d = new Date(iso);
      // "10:00 AM ET" — we trust the cron lined up to top of hour.
      var s = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(d);
      return s + ' ET';
    } catch (_) { return ''; }
  }
  function flowContractHtml(c){
    var sideLabel = c.side === 'put' ? 'PUT' : 'CALL';
    var strike = c.strike != null ? '$' + c.strike : '';
    var deltaStr = fmtDelta(c.deltaVol);
    var tier = deltaTier(c.deltaVol);
    var otmStr = fmtOtm(c.otmPct);
    var otmTag = otmStr ? '<span class="flow-otm">' + otmStr + ' OTM</span>' : '';
    var dteTag = c.dte != null ? '<span class="flow-dte' + (c.dte <= 14 ? ' near' : '') + '">' + c.dte + 'd</span>' : '';
    var premStr = c.premium != null ? fmtBigDollars(c.premium) : null;
    var premTag = premStr ? '<span class="flow-prem">' + premStr + ' prem</span>' : '';
    var tapeLbl = tapeLabel(c.tape);
    var tapeTag = tapeLbl ? '<span class="flow-tape tape-' + c.tape + '" title="' + tapeTitle(c.tape) + '">' + tapeLbl + '</span>' : '';
    var tipPrev = c.prevVol != null ? ' · was ' + fmtVolume(c.prevVol) + ' last hr' : '';
    var tipPrem = premStr ? ' · ' + premStr + ' prem' : '';
    var tipTape = tapeLbl ? ' · ' + tapeTitle(c.tape) : '';
    var title = 'Vol ' + fmtVolume(c.vol) + ' vs OI ' + fmtVolume(c.oi) +
      (c.deltaVol != null ? ' · ' + deltaStr + ' this hour' : '') +
      tipPrev +
      (c.last != null ? ' · last $' + c.last : '') +
      tipPrem + tipTape;
    return '<div class="flow-chip ' + c.side + ' tier-' + tier + '" title="' + title + '">' +
      '<span class="flow-side">' + sideLabel + '</span>' +
      '<span class="flow-strike">' + strike + '</span>' +
      '<span class="flow-exp">' + fmtExpiry(c.expSec) + '</span>' +
      dteTag +
      otmTag +
      '<span class="flow-stats">' +
        '<span class="flow-vol">' + fmtVolume(c.vol) + '</span>' +
        '<span class="flow-sep">/</span>' +
        '<span class="flow-oi">' + fmtVolume(c.oi) + '</span>' +
      '</span>' +
      '<span class="flow-delta">' + deltaStr + '/hr</span>' +
      premTag +
      tapeTag +
    '</div>';
  }
  var flowState = {
    search: '',
    side: 'all',
    nearOnly: false,
    sort: 'delta',
    collapsedAll: true,
    perRowCollapsed: Object.create(null),
  };
  // Collapsed-by-default: with 200+ contracts on a hot ticker like QQQ the
  // section dominates the page. Seed each known ticker as collapsed so the
  // initial render is a scannable list of headers; users expand the ones
  // they care about.
  (function seedCollapsed(){
    var tickers = (UNUSUAL && Array.isArray(UNUSUAL.tickers)) ? UNUSUAL.tickers : [];
    tickers.forEach(function(t){ flowState.perRowCollapsed[t.symbol] = true; });
  })();
  function filteredTickers(){
    var tickers = (UNUSUAL && Array.isArray(UNUSUAL.tickers)) ? UNUSUAL.tickers.slice() : [];
    var out = [];
    tickers.forEach(function(t){
      var contracts = (t.contracts || []).slice();
      if (flowState.side !== 'all'){
        contracts = contracts.filter(function(c){ return c.side === flowState.side; });
      }
      if (flowState.nearOnly){
        contracts = contracts.filter(function(c){ return c.dte != null && c.dte <= 14; });
      }
      var sym = (t.symbol || '').toUpperCase();
      var q = flowState.search.trim().toUpperCase();
      if (q && sym.indexOf(q) === -1) return;
      if (!contracts.length) return;
      var topDelta = contracts.reduce(function(acc, c){ return Math.max(acc, c.deltaVol || 0); }, 0);
      out.push({
        symbol: t.symbol,
        spot: t.spot,
        contracts: contracts,
        topDelta: topDelta,
      });
    });
    if (flowState.sort === 'delta'){
      out.sort(function(a, b){ return (b.topDelta || 0) - (a.topDelta || 0); });
    } else if (flowState.sort === 'contracts'){
      out.sort(function(a, b){ return b.contracts.length - a.contracts.length; });
    } else if (flowState.sort === 'alpha'){
      out.sort(function(a, b){ return String(a.symbol).localeCompare(String(b.symbol)); });
    }
    return out;
  }
  function renderUnusualFlow(){
    var list = $('flow-list');
    var empty = $('flow-empty');
    var noResults = $('flow-no-results');
    var eyebrow = $('flow-eyebrow');
    if (!list) return;
    var allTickers = (UNUSUAL && Array.isArray(UNUSUAL.tickers)) ? UNUSUAL.tickers : [];
    var summary = UNUSUAL && UNUSUAL.summary ? UNUSUAL.summary : null;
    var hasFilters = !!(flowState.search || flowState.side !== 'all' || flowState.nearOnly);
    if (eyebrow){
      if (UNUSUAL && summary && summary.contractCount){
        var parts = [summary.contractCount + ' contract' + (summary.contractCount === 1 ? '' : 's')];
        if (summary.tickerCount) parts.push(summary.tickerCount + ' ticker' + (summary.tickerCount === 1 ? '' : 's'));
        var when = fmtScannedAt(UNUSUAL.scannedAt);
        if (when) parts.push('scanned ' + when);
        eyebrow.textContent = parts.join(' · ');
      } else if (UNUSUAL && UNUSUAL.scannedAt){
        var when2 = fmtScannedAt(UNUSUAL.scannedAt);
        eyebrow.textContent = when2 ? 'scanned ' + when2 : '';
      } else {
        eyebrow.textContent = '';
      }
    }
    if (!allTickers.length){
      list.innerHTML = '';
      if (noResults) noResults.hidden = true;
      if (empty){
        empty.hidden = false;
        if (!UNUSUAL){
          empty.textContent = 'Waiting for the first hourly scan to land.';
        } else if (UNUSUAL.summary && UNUSUAL.summary.hadPrior === false){
          empty.textContent = 'First scan of the session — hourly delta needs a prior snapshot. Check back after the next hourly run.';
        } else {
          empty.textContent = 'No block/sweep flow flagged in the latest scan.';
        }
      }
      return;
    }
    if (empty) empty.hidden = true;
    var tickers = filteredTickers();
    if (!tickers.length){
      list.innerHTML = '';
      if (noResults){
        noResults.hidden = false;
        noResults.textContent = hasFilters
          ? 'No tickers match these filters. Try clearing the search or switching back to All.'
          : 'No unusual flow flagged in the latest scan.';
      }
      return;
    }
    if (noResults) noResults.hidden = true;
    list.innerHTML = tickers.map(function(t){
      var spot = t.spot != null ? '$' + Number(t.spot).toFixed(2) : '';
      var topTier = deltaTier(t.topDelta || 0);
      var collapsed = !!flowState.perRowCollapsed[t.symbol];
      return '<article class="flow-row tier-' + topTier + (collapsed ? ' is-collapsed' : '') + '" role="listitem" data-symbol="' + escapeHtml(t.symbol) + '">' +
        '<button type="button" class="flow-row-head" aria-expanded="' + (!collapsed) + '" data-row-toggle="' + escapeHtml(t.symbol) + '">' +
          '<svg class="flow-row-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
          '<span class="flow-symbol">' + escapeHtml(t.symbol) + '</span>' +
          (spot ? '<span class="flow-spot">' + spot + '</span>' : '') +
          '<span class="flow-count">' + t.contracts.length + ' contract' + (t.contracts.length === 1 ? '' : 's') + '</span>' +
          '<span class="flow-top">Top · ' + fmtDelta(t.topDelta) + '/hr</span>' +
        '</button>' +
        '<div class="flow-contracts"' + (collapsed ? ' hidden' : '') + '>' +
          t.contracts.map(flowContractHtml).join('') +
        '</div>' +
      '</article>';
    }).join('');
  }
  function bindFlowControls(){
    var searchInput = $('flow-search-input');
    var searchClear = $('flow-search-clear');
    if (searchInput){
      searchInput.addEventListener('input', function(){
        flowState.search = searchInput.value || '';
        if (searchClear) searchClear.hidden = !flowState.search;
        renderUnusualFlow();
      });
    }
    if (searchClear){
      searchClear.addEventListener('click', function(){
        if (searchInput){ searchInput.value = ''; searchInput.focus(); }
        flowState.search = '';
        searchClear.hidden = true;
        renderUnusualFlow();
      });
    }
    var sideFilter = document.querySelector('.flow-side-filter');
    if (sideFilter){
      sideFilter.addEventListener('click', function(ev){
        var btn = ev.target.closest && ev.target.closest('.flow-pill');
        if (!btn) return;
        var side = btn.getAttribute('data-side') || 'all';
        flowState.side = side;
        var pills = sideFilter.querySelectorAll('.flow-pill');
        pills.forEach(function(p){
          var on = p.getAttribute('data-side') === side;
          p.classList.toggle('is-on', on);
          p.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        renderUnusualFlow();
      });
    }
    var nearOnly = $('flow-near-only');
    if (nearOnly){
      nearOnly.addEventListener('change', function(){
        flowState.nearOnly = !!nearOnly.checked;
        renderUnusualFlow();
      });
    }
    var sortSelect = $('flow-sort-select');
    if (sortSelect){
      sortSelect.addEventListener('change', function(){
        flowState.sort = sortSelect.value || 'delta';
        renderUnusualFlow();
      });
    }
    var expandToggle = $('flow-expand-toggle');
    if (expandToggle){
      expandToggle.addEventListener('click', function(){
        flowState.collapsedAll = !flowState.collapsedAll;
        var tickers = (UNUSUAL && Array.isArray(UNUSUAL.tickers)) ? UNUSUAL.tickers : [];
        flowState.perRowCollapsed = Object.create(null);
        if (flowState.collapsedAll){
          tickers.forEach(function(t){ flowState.perRowCollapsed[t.symbol] = true; });
        }
        expandToggle.textContent = flowState.collapsedAll ? 'Expand all' : 'Collapse all';
        expandToggle.setAttribute('aria-pressed', flowState.collapsedAll ? 'true' : 'false');
        renderUnusualFlow();
      });
    }
    var list = $('flow-list');
    if (list){
      list.addEventListener('click', function(ev){
        var btn = ev.target.closest && ev.target.closest('[data-row-toggle]');
        if (!btn) return;
        var sym = btn.getAttribute('data-row-toggle');
        flowState.perRowCollapsed[sym] = !flowState.perRowCollapsed[sym];
        renderUnusualFlow();
      });
    }
    var sectionToggle = $('flow-collapse');
    var body = $('flow-body');
    var section = $('flow-section');
    if (sectionToggle && body && section){
      sectionToggle.addEventListener('click', function(){
        var expanded = sectionToggle.getAttribute('aria-expanded') !== 'false';
        var next = !expanded;
        sectionToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
        body.hidden = !next;
        section.classList.toggle('is-collapsed', !next);
      });
    }
  }

  // --- Bind ---------------------------------------------------------------
  function bind(){
    renderFreshness();
    bindThemeToggle();
    bindPageTabs();
    bindTabs();
    combo.init();
    renderNarratives();
    renderUnusualFlow();
    bindFlowControls();

    var radioGroup = document.querySelector('[role="radiogroup"]');
    if (radioGroup){
      radioGroup.addEventListener('change', function(ev){
        if (ev.target && ev.target.name === 'opt-type'){
          if (state.currentExp) populateStrikes();
          scheduleEvaluate();
          pushUrlState();
        }
      });
    }
    var expSel = $('opt-expiry');
    if (expSel) expSel.addEventListener('change', onExpiryChange);
    var strikeSel = $('opt-strike');
    if (strikeSel) strikeSel.addEventListener('change', function(){ scheduleEvaluate(); pushUrlState(); });

    var manualForm = $('opt-manual-form');
    if (manualForm){
      manualForm.addEventListener('submit', evaluateManual);
      var paste = $('m-paste');
      if (paste) paste.addEventListener('input', onPasteContract);
      var chainSection = $('opt-eval-section');
      if (chainSection){
        chainSection.addEventListener('click', function(ev){
          var tweakBtn = ev.target.closest && ev.target.closest('.opt-tweak-btn');
          if (tweakBtn){ tweakInManual(tweakBtn.getAttribute('data-tweak')); return; }
          var copyBtn = ev.target.closest && ev.target.closest('.opt-copylink-btn');
          if (copyBtn){
            var url = buildShareUrl();
            var done = function(ok){
              copyBtn.textContent = ok ? '✓ Copied' : 'Press ⌘C';
              setTimeout(function(){ copyBtn.textContent = '🔗 Copy link'; }, 1800);
            };
            if (navigator.clipboard && navigator.clipboard.writeText){
              navigator.clipboard.writeText(url).then(function(){ done(true); }, function(){ done(false); });
            } else {
              try { window.prompt('Copy this link', url); done(true); } catch (_){ done(false); }
            }
          }
        });
      }
    }

    // Auto-load any ticker from the URL. combo.commit walks the same path
    // a user-pick takes, so loadChain consumes pendingUrlState as it lands.
    var initial = parseUrlState();
    if (initial && initial.sym && SYMBOLS.indexOf(initial.sym) !== -1){
      pendingUrlState = initial;
      var pageGradeTab = document.querySelector('[data-page-tab="grade"]');
      if (pageGradeTab) pageGradeTab.click();
      combo.commit(initial.sym);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
`;
}

export function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], sectorOverviews = {}, recentlyEnded = [], macroHeadlines = [], unusual = null, spots = {} }) {
  const tickerCount = symbols.length;
  // Backfill industry on narratives loaded from older trends.json snapshots
  // (pre-taxonomy builds didn't tag one). Also accept legacy `triggers` as
  // `watchFor` so stale-fallback data still renders red flags. resolveNarrativeIndustry
  // votes from each narrative's longs/shorts so they slot into the right tab
  // even without a fresh AI run.
  const narrativesTagged = narratives.map((n) => {
    const out = {
      ...n,
      industry: n.industry && VALID_INDUSTRY_SET.has(n.industry)
        ? n.industry
        : resolveNarrativeIndustry(n.industry, n.longs || [], n.shorts || []),
    };
    if (!Array.isArray(out.watchFor) || !out.watchFor.length) {
      if (Array.isArray(n.triggers) && n.triggers.length) out.watchFor = n.triggers;
    }
    return out;
  });
  // Manifest is embedded inline so the narratives card + combobox can paint
  // on first frame. Per-ticker chain JSON is still lazy-fetched from
  // data/<SYMBOL>.json on demand.
  const manifestPayload = JSON.stringify({
    builtAt,
    builtAtIso,
    symbols,
    narratives: narrativesTagged,
    sectorOverviews: sectorOverviews || {},
    recentlyEnded,
    macroHeadlines,
    sectors: SECTORS,
    industries: INDUSTRY_OF_TICKER,
    sectorOrder: SECTOR_ORDER,
    industriesBySector: INDUSTRIES_BY_SECTOR,
    unusual: unusual || null,
    spots,
  }).replace(/<\/script>/gi, "<\\/script>");
  const cacheBust = encodeURIComponent(builtAtIso);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>stonks · Option Contract Rater</title>
<meta name="description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital." />
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="apple-touch-icon" href="favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="stonks · Option Contract Rater">
<meta property="og:description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="stonks · Option Contract Rater">
<meta name="twitter:description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital.">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css?v=${cacheBust}">
</head>
<body>
<header class="site-header">
  <a class="brand" href="/" aria-label="stonks home">
    <svg class="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 16 L8 9 L12 13 L19 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="19" cy="4" r="1.6" fill="currentColor"/>
    </svg>
    <span class="brand-word">stonks</span>
    <span class="brand-tag">Option Rater</span>
  </a>
  <nav class="site-nav">
    <button id="theme-toggle" class="icon-btn" aria-label="Toggle theme" type="button">
      <svg class="i-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      <svg class="i-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
    <a class="icon-btn" href="https://github.com/lilseancoc-png/stonks" aria-label="Source on GitHub" target="_blank" rel="noopener">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.18c-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.44-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.22 21.39 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5z"/></svg>
    </a>
  </nav>
</header>
<p class="page-sub">Grade an options contract on spread, delta, and theta. ${tickerCount} curated tickers, refreshed daily.</p>
<div id="freshness-banner" class="freshness" data-built-at="${builtAtIso}" role="status" aria-live="polite">
  <span class="freshness-dot" aria-hidden="true"></span>
  <span id="freshness-text">Built ${builtAt} (NY)</span>
</div>
<nav class="page-tabs" role="tablist" aria-label="Page sections">
  <button type="button" class="page-tab" role="tab" data-page-tab="narratives" aria-selected="true" aria-controls="page-pane-narratives" id="page-tab-narratives">Narratives</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="flow" aria-selected="false" aria-controls="page-pane-flow" id="page-tab-flow">Unusual flow</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="grade" aria-selected="false" aria-controls="page-pane-grade" id="page-tab-grade">Grade a contract</button>
</nav>
<main>
  <div class="page-pane" id="page-pane-narratives" role="tabpanel" aria-labelledby="page-tab-narratives">
  ${narrativesSection()}
  </div>
  <div class="page-pane" id="page-pane-flow" role="tabpanel" aria-labelledby="page-tab-flow" hidden>
  ${unusualFlowSection()}
  </div>
  <div class="page-pane" id="page-pane-grade" role="tabpanel" aria-labelledby="page-tab-grade" hidden>
  ${optionEvalSection()}
  </div>
</main>
<footer class="site-footer">
  <div>Built <span class="muted">${builtAt} (NY)</span></div>
  <div class="muted">Greeks computed locally with Black-Scholes. Data: Yahoo Finance. For information only — not investment advice.</div>
  <div><a href="https://github.com/lilseancoc-png/stonks" target="_blank" rel="noopener">Source on GitHub</a></div>
</footer>
<script>window.STONKS_MANIFEST=${manifestPayload};<\/script>
<script src="app.js?v=${cacheBust}" defer></script>
</body>
</html>`;
}

// Production-grade stylesheet — light default + dark via data-theme on
// <html>. Token-driven so the same component rules apply to both themes.
export function renderStylesCss() {
  return `/* Generated by scripts/build.mjs — do not edit by hand. */
:root {
  --bg:#0c0d11;
  --surface:#13151a;
  --surface-2:#191c22;
  --surface-3:#22262e;
  --border:#23272f;
  --border-strong:#353a44;
  --text:#d4d7dd;
  --text-strong:#f1f2f5;
  --muted:#878d99;
  --accent:#d68a4f;
  --accent-soft:rgba(214,138,79,0.12);
  --accent-strong:#e09f6b;
  --pos:#4ec9a0;
  --pos-soft:rgba(78,201,160,0.12);
  --neg:#e5536f;
  --neg-soft:rgba(229,83,111,0.12);
  --warn:#e3b35c;
  --warn-soft:rgba(227,179,92,0.12);
  --shadow-sm:0 1px 0 rgba(0,0,0,0.35);
  --shadow-md:0 6px 22px rgba(0,0,0,0.42);
  --shadow-lg:0 18px 44px rgba(0,0,0,0.5);
  --r-1:4px; --r-2:6px; --r-3:8px; --r-4:12px; --r-pill:999px;
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px; --s-6:28px; --s-7:40px; --s-8:56px;
  --fs-xs:11px; --fs-sm:12px; --fs-md:13px; --fs-lg:15px; --fs-xl:17px; --fs-2xl:22px; --fs-3xl:28px;
  --font-sans:"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --font-mono:"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --focus-ring:0 0 0 2px color-mix(in srgb, var(--accent) 50%, transparent);
  color-scheme:dark;
}
:root[data-theme="light"] {
  --bg:#fbfaf8;
  --surface:#ffffff;
  --surface-2:#f5f4f1;
  --surface-3:#ebe9e5;
  --border:#e2dfd9;
  --border-strong:#bcb6ac;
  --text:#26221d;
  --text-strong:#0f0d0a;
  --muted:#5a544c;
  --accent:#b45a2b;
  --accent-soft:rgba(180,90,43,0.09);
  --accent-strong:#8f4520;
  --pos:#2f8463;
  --pos-soft:rgba(47,132,99,0.09);
  --neg:#b9415a;
  --neg-soft:rgba(185,65,90,0.09);
  --warn:#a06a1f;
  --warn-soft:rgba(160,106,31,0.10);
  --shadow-sm:0 1px 0 rgba(15,23,42,0.03);
  --shadow-md:0 6px 18px rgba(15,23,42,0.06);
  --shadow-lg:0 18px 36px rgba(15,23,42,0.08);
  --focus-ring:0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
  color-scheme:light;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background:
    radial-gradient(1200px 600px at 50% -200px, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%),
    var(--bg);
  color: var(--text);
  font: var(--fs-md)/1.6 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  font-feature-settings: "cv11", "ss01", "tnum" 1;
  letter-spacing: 0.01em;
}
.mono, code, kbd, samp {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1, "ss01" 1;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-strong); text-decoration: underline; }
button { font: inherit; }
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-2);
}

/* === Layout === */
.site-header {
  display: flex; align-items: center; justify-content: space-between;
  max-width: 960px; margin: 0 auto;
  padding: var(--s-5) var(--s-5) var(--s-3);
}
.brand {
  display: inline-flex; align-items: center; gap: var(--s-2);
  color: var(--text-strong);
  font-weight: 700; font-size: var(--fs-lg);
  letter-spacing: -0.02em;
}
.brand:hover { text-decoration: none; }
.brand-mark { color: var(--accent); }
.brand-tag {
  font-size: var(--fs-xs); font-weight: 500;
  color: var(--muted); letter-spacing: 0;
  padding: 2px 8px; border: 1px solid var(--border);
  border-radius: var(--r-pill);
  margin-left: var(--s-1);
}
.site-nav { display: inline-flex; gap: var(--s-2); align-items: center; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  border-radius: var(--r-2);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease;
}
.icon-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-2);
  text-decoration: none;
}
:root:not([data-theme="dark"]) .icon-btn .i-moon { display: none; }
:root[data-theme="dark"] .icon-btn .i-sun { display: none; }

.page-sub {
  max-width: 760px; margin: 0 auto;
  padding: 0 var(--s-5) var(--s-3);
  color: var(--muted); font-size: var(--fs-sm);
}

main {
  max-width: 760px; margin: 0 auto;
  padding: var(--s-3) var(--s-5) var(--s-7);
}

/* === Page-level section tabs ===
   Narratives / Unusual flow / Grade — sits between the freshness banner and
   the main content. Underline-style; selection is persisted to localStorage. */
.page-tabs {
  max-width: 760px;
  margin: 0 auto var(--s-3);
  padding: 0 var(--s-5);
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border);
}
.page-tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  padding: var(--s-2) var(--s-3);
  cursor: pointer;
  transition: color .12s ease, border-color .12s ease;
  margin-bottom: -1px;
  white-space: nowrap;
}
.page-tab:hover { color: var(--text); }
.page-tab[aria-selected="true"] {
  color: var(--text-strong);
  border-bottom-color: var(--accent);
}
.page-tab:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-2); }
.page-pane[hidden] { display: none; }

.site-footer {
  max-width: 960px;
  margin: var(--s-6) auto 0;
  padding: var(--s-5) var(--s-5) var(--s-7);
  color: var(--muted); font-size: var(--fs-xs);
  display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: space-between;
  border-top: 1px solid var(--border);
}
.site-footer .muted { color: var(--muted); }

/* === Freshness banner ===
   Subtle one-liner — a small status dot and muted text, no background or
   border so it doesn't compete with the cards below. The dot picks up the
   warn/bad colour when the build is stale. */
.freshness {
  max-width: 760px;
  margin: 0 var(--s-5) var(--s-3);
  padding: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap;
}
@media (min-width: 800px){ .freshness { margin-left: auto; margin-right: auto; } }
.freshness .freshness-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--pos); flex: 0 0 6px;
}
.freshness.warn .freshness-dot { background: var(--warn); }
.freshness.bad  .freshness-dot { background: var(--neg); }
.freshness-detail { color: var(--muted); }

/* === Cards === */
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--r-4);
  padding: var(--s-4) var(--s-5);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--s-3);
}
.card-header {
  display: flex; align-items: center; gap: var(--s-3);
  padding-bottom: var(--s-2);
  margin-bottom: var(--s-3);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.card-title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-strong);
}
.card-title::before {
  content: '';
  display: inline-block;
  width: 2px; height: 14px;
  background: var(--accent);
  border-radius: 2px;
  margin-right: 10px;
  vertical-align: -2px;
  opacity: 0.85;
}
.card-eyebrow {
  font-size: var(--fs-xs); color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
  font-family: var(--font-mono);
  margin-left: auto;
}
.hint {
  margin: 0 0 var(--s-3);
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-1);
  padding: 1px 6px;
}

/* === Narratives === */
/* Sector tab strip across the top of the narratives card. Horizontally
   scrollable on narrow viewports so all 11 sectors stay reachable. */
.narr-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
  margin: var(--s-2) 0 var(--s-3);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  -webkit-overflow-scrolling: touch;
}
.narr-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
  white-space: nowrap;
}
.narr-tab:hover { color: var(--text); background: var(--surface-2); }
.narr-tab.is-active {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.narr-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  background: var(--surface-3);
  border-radius: var(--r-pill);
}
.narr-tab.is-active .narr-tab-count {
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}
.narr-panel { display: flex; flex-direction: column; gap: var(--s-3); }
/* Sector-overview banner — the top-down story for the active sector. Sits
   above the sub-industry blocks. Colour-keyed by stance so the user reads
   "bullish / bearish / mixed" at a glance, with the watch-for panel nested
   below the thesis. */
.narr-sector-overview {
  position: relative;
  padding: var(--s-3) var(--s-3) var(--s-3);
  border: 1px solid var(--border);
  border-left: 4px solid var(--border-strong);
  border-radius: var(--r-3);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--surface-2) 92%, transparent) 0%,
    var(--surface) 100%);
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}
.narr-sector-overview[data-stance="bullish"] {
  border-left-color: var(--pos);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--pos-soft) 55%, var(--surface-2)) 0%,
    var(--surface) 100%);
}
.narr-sector-overview[data-stance="bearish"] {
  border-left-color: var(--neg);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--neg-soft) 55%, var(--surface-2)) 0%,
    var(--surface) 100%);
}
.narr-sector-overview[data-stance="mixed"] {
  border-left-color: var(--warn);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--warn-soft) 45%, var(--surface-2)) 0%,
    var(--surface) 100%);
}
.narr-sector-overview.is-empty { border-left-color: var(--border-strong); }
.narr-sector-overview-head {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: var(--s-2);
}
.narr-sector-overview-eyebrow {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted);
}
.narr-sector-overview-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-strong);
}
.narr-sector-overview-stance {
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 10px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  border-radius: var(--r-pill);
}
.narr-sector-overview-stance.bullish {
  color: var(--pos);
  background: var(--pos-soft);
  border: 1px solid color-mix(in srgb, var(--pos) 40%, transparent);
}
.narr-sector-overview-stance.bearish {
  color: var(--neg);
  background: var(--neg-soft);
  border: 1px solid color-mix(in srgb, var(--neg) 40%, transparent);
}
.narr-sector-overview-stance.mixed {
  color: var(--warn);
  background: var(--warn-soft);
  border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
}
.narr-sector-overview-thesis {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--text);
}
.narr-sector-overview-thesis.muted { color: var(--muted); font-style: italic; }
.narr-industries { display: flex; flex-direction: column; gap: var(--s-4); }
.narr-industry {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}
.narr-industry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-2);
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--border);
}
.narr-industry-name {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.narr-industry-count {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--muted);
}
.narr-industry-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}
.narr-empties {
  margin-top: var(--s-2);
  padding: var(--s-2) var(--s-3);
  background: var(--surface-2);
  border: 1px dashed var(--border);
  border-radius: var(--r-2);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.narr-empties > summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.narr-empties > summary::-webkit-details-marker { display: none; }
.narr-empties-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  color: var(--muted);
}
.narr-empties-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.narr-empties-list {
  margin: var(--s-2) 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 4px 12px;
  color: var(--text);
  font-size: 12px;
}
.narr-empties-list li::before {
  content: "·";
  margin-right: 6px;
  color: var(--muted);
}
.narr-list { display: flex; flex-direction: column; gap: var(--s-3); }
.narr-list:empty { display: none; }
.narr {
  position: relative;
  padding: var(--s-3) var(--s-4) var(--s-3) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
  transition: border-color .15s ease, background .15s ease;
}
.narr:hover { border-color: var(--border-strong); background: var(--surface-2); }
.narr-accent {
  position: absolute; left: 12px; top: 14px; bottom: 14px;
  width: 3px; border-radius: 2px;
  background: var(--pos);
}
.narr[data-sent="bearish"] .narr-accent { background: var(--neg); }
.narr-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2);
  margin-bottom: var(--s-1);
}
.narr-name {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.narr-tag {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.01em;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
}
.narr-tag.sent.bullish { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 35%, transparent); background: var(--pos-soft); }
.narr-tag.sent.bearish { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 35%, transparent); background: var(--neg-soft); }
.narr-life {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 500;
  padding: 2px 8px 2px 6px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--muted);
}
.narr-life-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
}
.narr-thesis {
  margin: var(--s-1) 0 var(--s-2);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.55;
}
.narr-side-row {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px;
  margin: 4px 0;
}
.narr-side-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-right: 4px;
}
.narr-side-row.long  .narr-side-label { color: var(--pos); }
.narr-side-row.short .narr-side-label { color: var(--neg); }
.narr-chip {
  display: inline-flex; align-items: center;
  height: 22px;
  padding: 0 8px;
  font-size: 11px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  border-radius: var(--r-1);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
}
.narr-chip.long  { border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.narr-chip.short { border-color: color-mix(in srgb, var(--neg) 35%, transparent); }
.narr-ended { margin-top: var(--s-4); }
.narr-ended:empty { display: none; }
.narr-ended-head {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 700;
  margin-bottom: var(--s-2);
}
.narr-ended-strip {
  display: flex; gap: var(--s-2);
  overflow-x: auto;
  padding-bottom: var(--s-1);
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.narr-ended-card {
  flex: 0 0 220px;
  scroll-snap-align: start;
  padding: var(--s-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
}
.narr-ended-name { font-size: var(--fs-sm); font-weight: 600; color: var(--text); margin-bottom: 2px; }
.narr-ended-meta { font-size: 11px; color: var(--muted); }
.narr-empty { color: var(--muted); font-size: var(--fs-sm); padding: var(--s-1) 0; }

/* Narrative rank, strength meter, status / timeframe tags, triggers, conflicts, macro digest */
.narr-rank {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  letter-spacing: -0.02em;
  margin-right: 2px;
}
.narr:first-child .narr-rank {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
}
.narr-tag.status {
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.narr-tag.status.active   { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 35%, transparent); background: var(--pos-soft); }
.narr-tag.status.building { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); background: var(--warn-soft); }
.narr-tag.status.fading   { color: var(--muted); border-color: var(--border); background: var(--surface-2); }
.narr-tag.stale {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  background: var(--warn-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.narr[data-status="fading"]   { opacity: 0.78; }
.narr[data-status="fading"]:hover { opacity: 1; }
.narr.is-stale .narr-thesis { color: var(--muted); }
.narr-tag.tf {
  color: var(--text);
  background: var(--surface-3);
  font-variant-numeric: tabular-nums;
}
.narr-strength {
  display: flex; align-items: center; gap: var(--s-2);
  margin: 2px 0 var(--s-2);
}
.narr-strength-track {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  background: var(--surface-3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.narr-strength-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width .2s ease;
}
.narr-strength-fill.hi  { background: linear-gradient(90deg, var(--accent), var(--accent-strong)); }
.narr-strength-fill.mid { background: var(--accent); opacity: 0.85; }
.narr-strength-fill.lo  { background: var(--warn); opacity: 0.8; }
.narr-strength-num {
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  min-width: 28px; text-align: right;
}
/* Red-flag / watch-for panel — the catalysts that would FLIP this narrative.
   Used by both the per-narrative card and the sector overview banner. Styled
   as a "danger watchlist" with a warm accent border so it visually pops vs.
   the thesis paragraph above it. */
.narr-watchfor {
  margin-top: var(--s-2);
  padding: var(--s-2) var(--s-2) calc(var(--s-2) - 2px);
  border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border));
  border-left-width: 3px;
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--warn-soft) 55%, transparent);
}
.narr[data-status="building"] .narr-watchfor {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--border));
  background: color-mix(in srgb, var(--warn-soft) 70%, transparent);
}
.narr-watchfor-head {
  display: inline-flex; align-items: center; gap: 6px;
  margin-bottom: 4px;
}
.narr-watchfor-icon {
  font-size: 12px;
  color: var(--warn);
  line-height: 1;
}
.narr-watchfor-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--warn);
}
.narr-watchfor-list {
  margin: 0; padding: 0 0 0 16px;
  font-size: var(--fs-sm); color: var(--text);
  line-height: 1.5;
}
.narr-watchfor-list li + li { margin-top: 3px; }
.narr-watchfor-list li::marker { color: var(--warn); }
.narr-conflicts {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px;
  margin-top: var(--s-2);
}
.narr-conflicts-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--neg);
  margin-right: 2px;
}
.narr-conflict-chip {
  display: inline-flex; align-items: center;
  height: 20px;
  padding: 0 8px;
  font-size: 11px; font-weight: 600;
  color: var(--neg);
  background: var(--neg-soft);
  border: 1px solid color-mix(in srgb, var(--neg) 35%, transparent);
  border-radius: var(--r-pill);
}
.narr-macro { margin-top: var(--s-4); }
.narr-macro:empty { display: none; }
.narr-macro-details {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
  padding: var(--s-2) var(--s-3);
}
.narr-macro-details > summary {
  cursor: pointer;
  display: flex; align-items: center; gap: var(--s-2);
  list-style: none;
}
.narr-macro-details > summary::-webkit-details-marker { display: none; }
.narr-macro-details > summary::after {
  content: '+';
  margin-left: auto;
  color: var(--muted);
  font-family: var(--font-mono);
  font-weight: 700;
}
.narr-macro-details[open] > summary::after { content: '−'; }
.narr-macro-head {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text); font-weight: 700;
}
.narr-macro-meta { font-size: 11px; color: var(--muted); }
.narr-macro-list {
  margin: var(--s-2) 0 0; padding: 0;
  list-style: none;
  display: flex; flex-direction: column; gap: 4px;
  font-size: var(--fs-sm);
}
.narr-macro-list li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: var(--s-2);
  align-items: baseline;
  padding: 4px 0;
  border-top: 1px solid var(--border);
}
.narr-macro-list li:first-child { border-top: none; }
.narr-macro-date {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.narr-macro-pub {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--accent-strong);
  white-space: nowrap;
}
.narr-macro-title { color: var(--text); }

/* === Option eval card === */
.opt-controls {
  display: flex; flex-wrap: wrap; gap: var(--s-2);
  align-items: stretch;
  margin-bottom: var(--s-3);
}
.opt-chain-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-2) var(--s-3);
  margin-bottom: var(--s-2);
}
@media (max-width: 480px){ .opt-chain-row { grid-template-columns: 1fr; } }
.field {
  display: flex; flex-direction: column; gap: 4px;
}
.field-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
}
.field select, .opt-manual-field input, .opt-manual-field select {
  height: 40px; padding: 0 var(--s-3);
  border-radius: var(--r-2);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit; font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.field select:focus-visible, .opt-manual-field input:focus-visible, .opt-manual-field select:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

/* === Combobox === */
.combo {
  position: relative;
  flex: 1 1 260px; min-width: 200px;
}
.combo input {
  width: 100%; height: 40px;
  padding: 0 36px 0 var(--s-3);
  border-radius: var(--r-2);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit; font-size: var(--fs-md);
  transition: border-color .15s, box-shadow .15s;
}
.combo input::placeholder { color: var(--muted); opacity: 0.8; }
.combo input:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }
.combo-clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px;
  border: none; background: transparent;
  color: var(--muted);
  font-size: 18px; line-height: 1;
  border-radius: var(--r-1);
  cursor: pointer;
}
.combo-clear:hover { color: var(--text); background: var(--surface-2); }
.combo ul {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  z-index: 20;
  list-style: none; margin: 0; padding: 4px;
  max-height: min(50vh, 320px); overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  box-shadow: var(--shadow-md);
}
.combo ul li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--s-2);
  align-items: center;
  padding: 8px var(--s-3);
  border-radius: var(--r-1);
  cursor: pointer;
  font-size: var(--fs-sm);
}
.combo ul li.is-active, .combo ul li:hover { background: var(--accent-soft); }
.combo-sym { font-weight: 700; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.combo-spot { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.combo-sector {
  font-size: 11px; color: var(--muted);
  padding: 2px 6px; border-radius: var(--r-1);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.combo-empty { padding: 10px var(--s-3); color: var(--muted); font-size: var(--fs-sm); }

/* === Segmented control === */
.segmented {
  display: inline-flex;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  position: relative;
}
.segmented input {
  position: absolute; opacity: 0; pointer-events: none;
}
.segmented label {
  cursor: pointer;
  padding: 6px 16px;
  font-size: var(--fs-sm); font-weight: 600;
  color: var(--muted);
  border-radius: var(--r-pill);
  transition: color .15s ease, background .15s ease, box-shadow .15s ease;
}
.segmented input:checked + label {
  color: var(--text-strong);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.segmented input:focus-visible + label { box-shadow: var(--focus-ring); }

/* === Status === */
.opt-status {
  font-size: var(--fs-sm);
  min-height: 18px; margin: var(--s-1) 0;
  color: var(--muted);
  display: flex; align-items: center; gap: var(--s-2);
}
.opt-status:empty { display: none; }
.opt-status.err { color: var(--neg); }
.opt-status.ok  { color: var(--pos); }
.opt-status.loading::before {
  content: "";
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 2px solid var(--accent-soft);
  border-top-color: var(--accent);
  animation: opt-status-spin 0.7s linear infinite;
  flex: 0 0 auto;
}
@keyframes opt-status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .opt-status.loading::before { animation: none; opacity: 0.7; }
}

/* === Unusual options flow === */
.flow-card-header { align-items: center; }
.flow-collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  text-align: left;
  font: inherit;
}
.flow-collapse-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-2); }
.flow-collapse-btn .card-title { margin: 0; }
.flow-chevron {
  color: var(--muted);
  transition: transform .18s ease, color .18s ease;
  flex: 0 0 auto;
}
.flow-collapse-btn:hover .flow-chevron { color: var(--text); }
.flow-collapse-btn[aria-expanded="false"] .flow-chevron { transform: rotate(-90deg); }
.flow-card.is-collapsed { padding-bottom: var(--s-3); }
.flow-body[hidden] { display: none; }

.flow-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
  padding: 0 0 var(--s-3);
  margin-bottom: var(--s-3);
}
.flow-search {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  padding: 4px 10px;
  min-width: 180px;
  flex: 1 1 180px;
  max-width: 260px;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.flow-search:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: var(--focus-ring);
}
.flow-search svg { color: var(--muted); flex: 0 0 auto; }
.flow-search input {
  border: 0;
  background: transparent;
  outline: 0;
  width: 100%;
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--text);
}
.flow-search input::placeholder { color: var(--muted); }
.flow-search input::-webkit-search-decoration,
.flow-search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
.flow-search-clear {
  background: transparent;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.flow-search-clear:hover { color: var(--text); }

.flow-side-filter {
  display: inline-flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 2px;
  gap: 2px;
}
.flow-pill {
  background: transparent;
  border: 0;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.flow-pill:hover { color: var(--text); }
.flow-pill.is-on {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.flow-pill:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.flow-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
.flow-toggle input { accent-color: var(--accent); margin: 0; }
.flow-toggle-hint { color: var(--muted); font-size: var(--fs-xs); }

.flow-sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--muted);
}
.flow-sort-label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
.flow-sort select {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
  padding: 4px 8px;
  cursor: pointer;
}
.flow-sort select:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }

.flow-action-btn {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--r-2);
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}
.flow-action-btn:hover { background: var(--surface-2); border-color: var(--border-strong); color: var(--text); }
.flow-action-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.flow-list { display: flex; flex-direction: column; gap: var(--s-2); }
.flow-list:empty { display: none; }
.flow-row {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  background: var(--surface-2);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--r-3);
  transition: border-color .15s ease, background .15s ease;
}
.flow-row:hover { background: var(--surface-3); border-color: var(--border-strong); }
.flow-row.tier-hot { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.flow-row.is-collapsed { padding-bottom: var(--s-2); }
.flow-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  width: 100%;
}
.flow-row-head:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-2); }
.flow-row-chevron {
  color: var(--muted);
  transition: transform .15s ease;
  flex: 0 0 auto;
}
.flow-row-head[aria-expanded="false"] .flow-row-chevron { transform: rotate(-90deg); }
.flow-row-head:hover .flow-row-chevron { color: var(--text); }

@media (max-width: 640px){
  .flow-controls { gap: var(--s-2); }
  .flow-search { min-width: 0; max-width: none; flex: 1 1 100%; }
  .flow-action-btn { margin-left: 0; }
  .flow-sort-label { display: none; }
}
.flow-symbol {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.flow-spot {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.flow-count {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.flow-top {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: var(--r-pill);
  padding: 2px 8px;
}
.flow-contracts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
/* The HTML 'hidden' attribute resolves to display:none via the UA stylesheet,
   but \`.flow-contracts { display: flex }\` is an equally-specific class
   selector that wins the cascade. Restore the collapse behavior explicitly. */
.flow-contracts[hidden] { display: none; }
.flow-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  color: var(--text);
  transition: border-color .12s ease, background .12s ease;
}
.flow-chip.call {
  border-color: color-mix(in srgb, var(--pos) 35%, transparent);
}
.flow-chip.put {
  border-color: color-mix(in srgb, var(--neg) 35%, transparent);
}
.flow-chip.tier-hot {
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface-2));
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}
.flow-side {
  font-weight: 700;
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: var(--r-1);
}
.flow-chip.call .flow-side { color: var(--pos); background: var(--pos-soft); }
.flow-chip.put  .flow-side { color: var(--neg); background: var(--neg-soft); }
.flow-strike { font-weight: 700; color: var(--text-strong); }
.flow-exp { color: var(--muted); }
.flow-stats {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  color: var(--text);
}
.flow-sep { color: var(--muted); }
.flow-oi { color: var(--muted); }
.flow-delta {
  font-weight: 700;
  color: var(--accent-strong);
  font-size: 11px;
}
.flow-chip.tier-warm .flow-delta { color: var(--warn); }
.flow-chip.tier-mild .flow-delta { color: var(--text); }
.flow-otm {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  padding: 1px 5px;
  border-radius: var(--r-1);
  background: color-mix(in srgb, var(--surface-3) 60%, transparent);
  letter-spacing: 0.02em;
}
.flow-dte {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  padding: 1px 5px;
  border-radius: var(--r-1);
  letter-spacing: 0.02em;
}
.flow-dte.near {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 18%, transparent);
}
.flow-prem {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  margin-left: 6px;
  letter-spacing: 0.01em;
}
.flow-tape {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  letter-spacing: 0.06em;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-3) 60%, transparent);
}
.flow-tape.tape-ask { color: var(--pos); background: color-mix(in srgb, var(--pos) 22%, transparent); }
.flow-tape.tape-bid { color: var(--neg); background: color-mix(in srgb, var(--neg) 22%, transparent); }
.flow-tape.tape-abv { color: var(--pos); background: color-mix(in srgb, var(--pos) 12%, transparent); }
.flow-tape.tape-blw { color: var(--neg); background: color-mix(in srgb, var(--neg) 12%, transparent); }
.flow-empty {
  color: var(--muted);
  font-size: var(--fs-sm);
  padding: var(--s-2) 0;
}

/* === Per-ticker narrative chips === */
.opt-narr-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin: var(--s-2) 0;
  align-items: center;
}
.opt-narr-chips-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted); margin-right: 2px;
}
.opt-narr-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text); font-weight: 600;
}
.opt-narr-chip.long  { border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-narr-chip.short { border-color: color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-narr-chip-side {
  font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 2px 6px; border-radius: var(--r-pill);
}
.opt-narr-chip.long  .opt-narr-chip-side { color: var(--pos); background: var(--pos-soft); }
.opt-narr-chip.short .opt-narr-chip-side { color: var(--neg); background: var(--neg-soft); }

/* === Live spot pill === */
.opt-live {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin: var(--s-2) 0;
  font-variant-numeric: tabular-nums;
}
.opt-live-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: var(--r-pill);
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  border: 1px solid var(--border);
  background: var(--surface-2); color: var(--muted);
}
.opt-live-pill::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: var(--muted);
}
.opt-live-pill.live     { color: var(--pos);  background: var(--pos-soft);  border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-live-pill.live::before { background: var(--pos); box-shadow: 0 0 0 0 color-mix(in srgb, var(--pos) 60%, transparent); animation: opt-live-pulse 1.6s ease-out infinite; }
.opt-live-pill.pre,
.opt-live-pill.post     { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-live-pill.pre::before, .opt-live-pill.post::before { background: var(--warn); }
.opt-live-pill.delayed  { color: var(--muted); background: var(--surface-3); }
.opt-live-pill.checking { color: var(--muted); background: var(--surface-3); }
.opt-live-pill.checking::before {
  background: var(--muted); animation: opt-live-pulse 1s ease-in-out infinite alternate;
}
@keyframes opt-live-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent); }
  70%  { box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%,  transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%,  transparent); }
}
.opt-live-sym   { font-size: 12px; font-weight: 700; color: var(--text-strong); letter-spacing: 0.02em; }
.opt-live-spot  { font-size: var(--fs-md); font-weight: 700; color: var(--text-strong); }
.opt-live-chg   { font-size: 12px; font-weight: 600; }
.opt-live-chg.up   { color: var(--pos); }
.opt-live-chg.down { color: var(--neg); }
.opt-live-refresh {
  display: inline-flex; align-items: center;
  margin-top: 6px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--muted);
}
.opt-live-refresh::before {
  content: ''; display: inline-block;
  width: 6px; height: 6px; margin-right: 6px;
  border-radius: 50%; background: var(--muted);
}
.opt-live-refresh.on { color: var(--pos); }
.opt-live-refresh.on::before {
  background: var(--pos);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--pos) 60%, transparent);
  animation: opt-live-pulse 1.6s ease-out infinite;
}

/* === Max pain card === */
.opt-max-pain {
  margin: var(--s-3) 0 var(--s-3);
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--r-3);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 92%, transparent), color-mix(in srgb, var(--surface-2) 60%, transparent)),
    var(--surface-2);
  font-variant-numeric: tabular-nums;
}
.opt-max-pain-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin-bottom: 6px;
}
.opt-max-pain-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--muted);
}
.opt-max-pain-exp {
  font-size: 11px; font-weight: 600;
  color: var(--text);
  padding: 2px 9px; border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--surface-3) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.opt-max-pain-body {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px;
}
.opt-max-pain-strike {
  font-size: 24px; font-weight: 700; letter-spacing: -0.01em;
  color: var(--text-strong);
  font-feature-settings: "tnum" 1;
}
.opt-max-pain-strike.up   { color: var(--pos); }
.opt-max-pain-strike.down { color: var(--neg); }
.opt-max-pain-strike.flat { color: var(--text-strong); }
.opt-max-pain-delta {
  font-size: 12px; color: var(--muted);
}
.opt-max-pain-delta.up   { color: color-mix(in srgb, var(--pos) 75%, var(--text)); }
.opt-max-pain-delta.down { color: color-mix(in srgb, var(--neg) 75%, var(--text)); }
.opt-max-pain-delta b { color: inherit; font-weight: 700; }
.opt-max-pain-meta {
  margin-top: 4px;
  font-size: 11px; color: var(--muted);
  letter-spacing: 0.03em;
}

/* === Technical signals card === */
.opt-tech {
  margin: var(--s-3) 0;
  padding: var(--s-3) var(--s-3) var(--s-2);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
  background: var(--surface-2);
}
.opt-tech-head {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2);
  margin-bottom: var(--s-2);
}
.opt-tech-title {
  margin: 0; font-size: var(--fs-md); font-weight: 700;
  color: var(--text-strong); letter-spacing: 0.01em;
}
.opt-tech-sub {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.opt-tech-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--s-2);
}
.opt-tech-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: var(--s-2) var(--s-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  min-width: 0;
}
.opt-tech-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
  display: flex; align-items: center;
}
.opt-tech-value {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px;
  font-variant-numeric: tabular-nums;
}
.opt-tech-num {
  font-size: var(--fs-xl); font-weight: 700; color: var(--text-strong);
  line-height: 1.1;
}
.opt-tech-vsub {
  font-size: 11px; color: var(--muted);
  text-transform: none; letter-spacing: 0; font-weight: 500;
}
.opt-tech-state { display: flex; align-items: center; gap: 6px; }
.opt-tech-pill {
  display: inline-block;
  padding: 2px 8px; border-radius: var(--r-pill);
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text);
}
.opt-tech-pill.pos  { color: var(--pos);  background: var(--pos-soft);  border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-tech-pill.warn { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-tech-pill.fair { color: var(--muted); background: var(--surface-3); }
.opt-tech-note {
  font-size: 11px; color: var(--muted); line-height: 1.4;
}
.opt-tech-foot {
  font-size: 11px; color: var(--muted);
  margin: var(--s-2) 0 0; line-height: 1.4;
}

/* === Fundamentals + earnings panel === */
.opt-fund {
  margin-top: var(--s-4);
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
}
.opt-fund-head {
  display: flex; align-items: center; gap: var(--s-3);
  flex-wrap: wrap;
  margin-bottom: var(--s-3);
}
.opt-fund-title {
  font-size: var(--fs-md); font-weight: 700; margin: 0;
  color: var(--text-strong);
}
.opt-fund-verdict {
  display: inline-flex; align-items: center;
  padding: 4px 10px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  border-radius: var(--r-pill);
  background: var(--surface-3); color: var(--muted);
  border: 1px solid var(--border);
}
.opt-fund-verdict.strong { color: var(--pos); background: var(--pos-soft); border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-fund-verdict.weak   { color: var(--neg); background: var(--neg-soft); border-color: color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-fund-verdict.mixed  { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-fund-summary {
  margin: 0 0 var(--s-3);
  font-size: var(--fs-md); line-height: 1.5; color: var(--text);
}
.opt-fund-recap {
  margin: 0 0 var(--s-3);
  padding: var(--s-2) var(--s-3);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-2);
  font-size: var(--fs-sm); color: var(--text); line-height: 1.5;
}
.opt-fund-recap-label {
  display: inline-block;
  margin-right: 6px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
}
.opt-fund-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-3);
  margin-bottom: var(--s-4);
}
@media (max-width: 640px) {
  .opt-fund-columns { grid-template-columns: 1fr; }
}
.opt-fund-col {
  padding: var(--s-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
}
.opt-fund-col.opt-fund-pos { border-left: 3px solid var(--pos); }
.opt-fund-col.opt-fund-neg { border-left: 3px solid var(--neg); }
.opt-fund-col-head {
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: var(--s-2);
}
.opt-fund-pos .opt-fund-col-head { color: var(--pos); }
.opt-fund-neg .opt-fund-col-head { color: var(--neg); }
.opt-fund-list {
  margin: 0; padding-left: 18px;
  font-size: var(--fs-sm); line-height: 1.5; color: var(--text);
}
.opt-fund-list li { margin-bottom: 6px; }
.opt-fund-list li:last-child { margin-bottom: 0; }
.opt-fund-list li.opt-fund-empty { color: var(--muted); font-style: italic; list-style: none; margin-left: -18px; }
.opt-fund-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--s-2);
}
.opt-fund-metric {
  padding: var(--s-2) var(--s-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
}
.opt-fund-metric.tone-pos  { border-color: color-mix(in srgb, var(--pos)  35%, var(--border)); }
.opt-fund-metric.tone-neg  { border-color: color-mix(in srgb, var(--neg)  35%, var(--border)); }
.opt-fund-metric.tone-warn { border-color: color-mix(in srgb, var(--warn) 35%, var(--border)); }
.opt-fund-metric-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted); margin-bottom: 2px;
}
.opt-fund-metric-value {
  font-size: var(--fs-md); font-weight: 600; color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}
.opt-fund-metric.tone-pos  .opt-fund-metric-value { color: var(--pos); }
.opt-fund-metric.tone-neg  .opt-fund-metric-value { color: var(--neg); }
.opt-fund-metric.tone-warn .opt-fund-metric-value { color: var(--warn); }
.opt-fund-metric-sub {
  display: inline-block; margin-left: 4px;
  font-size: 11px; font-weight: 500; color: var(--muted);
}
.opt-fund-foot {
  font-size: 11px; color: var(--muted);
  margin: var(--s-3) 0 0; line-height: 1.4;
}

/* === Earnings history dot chart === */
.opt-fund-eh {
  margin-top: var(--s-4);
  padding: var(--s-3);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  background: var(--surface-2);
}
.opt-fund-eh-head {
  font-size: 12px; font-weight: 600; color: var(--text);
  margin-bottom: var(--s-2); letter-spacing: 0.02em;
}
.opt-fund-eh-svg {
  width: 100%; height: auto; display: block;
}
.opt-fund-eh-grid {
  stroke: var(--border); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6;
}
.opt-fund-eh-axis {
  font-size: 10px; fill: var(--muted);
}
.opt-fund-eh-est { fill: color-mix(in srgb, var(--pos) 55%, transparent); }
.opt-fund-eh-act { fill: var(--pos); }
.opt-fund-eh-line {
  fill: none; stroke: var(--pos); stroke-width: 1.5; opacity: 0.6;
}
.opt-fund-eh-legend {
  display: flex; gap: var(--s-3); margin-top: var(--s-2);
  font-size: 11px; color: var(--muted);
}
.opt-fund-eh-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  vertical-align: middle; margin-right: 4px;
}
.opt-fund-eh-dot.est { background: color-mix(in srgb, var(--pos) 55%, transparent); }
.opt-fund-eh-dot.act { background: var(--pos); }

/* === Retail sentiment gauge === */
.opt-social {
  display: flex; flex-direction: column; gap: var(--s-2);
  padding: var(--s-3);
  margin-bottom: var(--s-3);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  background: var(--surface-2);
}
.opt-social-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--s-3); flex-wrap: wrap;
}
.opt-social-label {
  font-size: 12px; font-weight: 600; color: var(--text);
  letter-spacing: 0.02em;
}
.opt-social-stat {
  font-size: 11px; color: var(--muted);
}
.opt-social-bar {
  display: flex; height: 8px; width: 100%;
  border-radius: 4px; overflow: hidden;
  background: color-mix(in srgb, var(--border) 70%, transparent);
}
.opt-social-bar .bull { background: var(--pos); }
.opt-social-bar .bear { background: var(--neg); }
.opt-social-bar .neutral { background: transparent; }
.opt-social-sources {
  font-size: 11px; color: var(--muted);
}

.opt-row-mute {
  color: var(--muted); font-size: 11px; margin-left: 6px;
  font-weight: 500;
}

/* === Grade explainer === */
.opt-explainer {
  margin-top: var(--s-5);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
  background: var(--surface-2);
}
.opt-explainer summary {
  list-style: none;
  cursor: pointer;
  padding: var(--s-3) var(--s-4);
  font-weight: 600;
  font-size: var(--fs-md);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: var(--s-2);
}
.opt-explainer summary::-webkit-details-marker { display: none; }
.opt-explainer summary::before {
  content: "▸";
  display: inline-block;
  color: var(--muted);
  font-size: 11px;
  transition: transform .15s ease;
}
.opt-explainer[open] summary::before { transform: rotate(90deg); }
.opt-explainer summary:hover { color: var(--text-strong); }
.opt-explainer-body {
  padding: 0 var(--s-4) var(--s-4);
  font-size: var(--fs-sm);
  color: var(--text);
  line-height: 1.55;
}
.opt-explainer-body p { margin: 0 0 var(--s-3); }
.opt-explainer-body ul { margin: 0 0 var(--s-3); padding-left: var(--s-5); }
.opt-explainer-body li { margin-bottom: 4px; }
.opt-explainer-body h4 {
  margin: var(--s-4) 0 var(--s-2);
  font-size: var(--fs-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 700;
}
.opt-explainer-foot { color: var(--muted); font-style: italic; }

/* === Result panel === */
.opt-result-wrap { position: relative; }
.opt-result-sticky {
  position: sticky; top: 0; z-index: 5;
  display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center;
  padding: var(--s-2) var(--s-3);
  margin: 0 calc(-1 * var(--s-3));
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  -webkit-backdrop-filter: saturate(160%) blur(8px);
  backdrop-filter: saturate(160%) blur(8px);
  border-bottom: 1px solid var(--border);
}
.opt-verdict-mini {
  display: inline-block;
  padding: 4px 10px; border-radius: var(--r-pill);
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.opt-verdict-mini.good { color: var(--pos); background: var(--pos-soft); border: 1px solid color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-verdict-mini.fair { color: var(--warn); background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-verdict-mini.bad  { color: var(--neg); background: var(--neg-soft); border: 1px solid color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-contract-mini { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

.opt-result:empty { display: none; }
.opt-buy {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-3);
  border: 1px solid;
  margin: var(--s-3) 0 var(--s-2);
}
.opt-buy.yes { background: var(--pos-soft); border-color: color-mix(in srgb, var(--pos) 45%, transparent); }
.opt-buy.no  { background: var(--neg-soft); border-color: color-mix(in srgb, var(--neg) 45%, transparent); }
.opt-buy-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  padding: 8px 14px;
  border-radius: var(--r-2);
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
  color: #fff;
  flex: 0 0 auto;
}
.opt-buy.yes .opt-buy-badge { background: var(--pos); }
.opt-buy.no  .opt-buy-badge { background: var(--neg); }
.opt-buy-reason {
  font-size: var(--fs-sm);
  line-height: 1.4;
  color: var(--text);
}
.opt-buy-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  border-radius: var(--r-1);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fff;
}
.opt-buy-mini.yes { background: var(--pos); }
.opt-buy-mini.no  { background: var(--neg); }
.opt-verdict {
  display: inline-block;
  padding: 6px 14px;
  border-radius: var(--r-pill);
  font-weight: 700; font-size: var(--fs-md);
  letter-spacing: 0.02em;
  margin: var(--s-3) 0 var(--s-2);
}
.opt-verdict.good { background: var(--pos-soft); color: var(--pos); border: 1px solid color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-verdict.fair { background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-verdict.bad  { background: var(--neg-soft); color: var(--neg); border: 1px solid color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-contract {
  font-size: var(--fs-xs); color: var(--muted);
  margin-bottom: var(--s-3);
  font-variant-numeric: tabular-nums;
}
.opt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px var(--s-4);
  margin: var(--s-3) 0;
}
.opt-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--border);
  font-size: var(--fs-md);
}
.opt-row:last-child { border-bottom: none; }
.opt-row-label {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.06em;
  font-weight: 600;
}
.opt-row-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text);
}
.opt-row-sub { font-weight: 400; margin-left: 6px; }
.opt-grade {
  display: inline-block; margin-left: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 7px; border-radius: var(--r-1);
}
.opt-grade.good { color: var(--pos); background: var(--pos-soft); }
.opt-grade.fair { color: var(--warn); background: var(--warn-soft); }
.opt-grade.bad  { color: var(--neg); background: var(--neg-soft); }
.opt-notes {
  margin: var(--s-3) 0 var(--s-1);
  padding-left: var(--s-4);
  font-size: var(--fs-sm); color: var(--text);
}
.opt-notes li { margin-bottom: 3px; }
.opt-disclaimer { font-size: 11px; color: var(--muted); margin-top: var(--s-2); }
.opt-explain {
  margin: var(--s-2) 0 var(--s-3);
  padding: var(--s-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  font-size: var(--fs-sm); line-height: 1.55;
}
.opt-explain.good { border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-explain.fair { border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-explain.bad  { border-color: color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-news {
  margin: var(--s-2) 0 var(--s-3);
  padding: var(--s-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  font-size: var(--fs-sm); line-height: 1.55;
}
.opt-news.bullish   { border-color: color-mix(in srgb, var(--pos) 35%, transparent); }
.opt-news.bearish   { border-color: color-mix(in srgb, var(--neg) 35%, transparent); }
.opt-news.neutral   { border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.opt-news.uncertain { border-color: var(--border); }
.opt-news-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 4px; font-weight: 700; }
.opt-news-body { color: var(--text); }
.opt-news-note { margin-top: 6px; font-size: 12px; color: var(--muted); font-style: italic; }
.opt-tweak-btn {
  background: transparent; color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: var(--r-2);
  padding: 8px 14px;
  font: inherit; font-size: var(--fs-sm); font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.opt-tweak-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
.opt-actions {
  display: flex; flex-wrap: wrap; gap: var(--s-2);
  margin: var(--s-2) 0 var(--s-1);
}
.opt-copylink-btn {
  background: transparent; color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--r-2);
  padding: 8px 14px;
  font: inherit; font-size: var(--fs-sm); font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.opt-copylink-btn:hover { color: var(--text-strong); border-color: var(--border-strong); }

/* === Manual form === */
.opt-manual-grid {
  display: grid;
  gap: var(--s-3) var(--s-4);
  grid-template-columns: 1fr;
}
@media (min-width: 640px){
  .opt-manual-grid { grid-template-columns: 1fr 1fr; }
  .opt-manual-paste, .opt-manual-submit { grid-column: 1 / -1; }
}
.opt-manual-field {
  display: flex; flex-direction: column; gap: 6px;
}
.opt-manual-field-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
}
.opt-manual-opt {
  font-size: 9px; font-weight: 500;
  text-transform: lowercase; letter-spacing: 0;
  color: var(--muted); opacity: 0.8;
  margin-left: 4px;
}
.opt-manual-field input::placeholder { color: var(--muted); opacity: 0.65; }
.opt-manual-field input.err {
  border-color: var(--neg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--neg) 25%, transparent);
}
.opt-manual-paste input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
}
.opt-paste-hint {
  font-size: 11px; color: var(--muted);
  text-transform: none; letter-spacing: 0;
  min-height: 14px; margin-top: 2px;
}
.opt-paste-hint.err { color: var(--neg); }
.opt-manual-submit {
  background: var(--accent); color: #fff;
  border: none; border-radius: var(--r-2);
  padding: 10px 18px;
  font-size: var(--fs-md); font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, transform .05s ease;
  justify-self: start;
}
.opt-manual-submit:hover { background: color-mix(in srgb, var(--accent) 85%, #000); }
.opt-manual-submit:active { transform: translateY(1px); }

/* === Tooltip === */
.tip {
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 6px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px; font-weight: 700;
  cursor: help;
  position: relative; vertical-align: middle;
  text-transform: none; letter-spacing: 0;
}
.tip:hover, .tip:focus-visible {
  color: var(--text); border-color: var(--accent);
  outline: none;
}
.tip::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 6px); left: 50%;
  transform: translateX(-50%);
  background: var(--text-strong); color: var(--surface);
  border: none; border-radius: var(--r-2);
  padding: 8px 10px;
  font-size: 12px; font-weight: 500;
  line-height: 1.4;
  width: max-content; max-width: min(260px, 80vw);
  white-space: normal; text-align: left;
  box-shadow: var(--shadow-md);
  pointer-events: none; opacity: 0;
  transition: opacity .12s ease;
  z-index: 30;
}
.tip:hover::after, .tip:focus-visible::after { opacity: 1; }
@media (max-width: 480px){
  .tip::after { left: auto; right: 0; transform: none; }
}

/* === Terminal redesign overrides === */
/* Apply monospace to all numerics that read like terminal data */
.opt-live-spot, .opt-live-chg, .opt-tech-num, .opt-tech-vsub,
.opt-fund-metric-value, .opt-fund-metric-sub, .opt-row-value,
.opt-row-mute, .opt-row-sub, .opt-contract, .opt-contract-mini,
.opt-verdict, .opt-verdict-mini, .narr-chip, .opt-narr-chip,
.combo input, .opt-live-pill, .opt-live-sym, .opt-live-refresh {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1, "ss01" 1;
}

/* Brand wordmark feels right in mono too */
.brand-word { font-family: var(--font-mono); letter-spacing: -0.02em; font-weight: 700; }
.brand-tag { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }

/* Restrained verdict — square label, no pill, terminal-flat */
.opt-verdict {
  display: inline-flex; align-items: center;
  padding: 6px 12px;
  border-radius: var(--r-2);
  font-weight: 700; font-size: var(--fs-sm);
  text-transform: uppercase; letter-spacing: 0.08em;
  border-width: 1px; border-style: solid;
}
.opt-verdict.good { background: var(--pos-soft); color: var(--pos); border-color: color-mix(in srgb, var(--pos) 45%, transparent); }
.opt-verdict.fair { background: var(--warn-soft); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.opt-verdict.bad  { background: var(--neg-soft); color: var(--neg); border-color: color-mix(in srgb, var(--neg) 45%, transparent); }
.opt-verdict-mini {
  border-radius: var(--r-2);
  font-size: 11px; letter-spacing: 0.06em;
}

/* Tighter result rows — Bloomberg-style flat key/value table */
.opt-grid {
  gap: 0 var(--s-4);
  border-top: 1px solid var(--border);
  margin-top: var(--s-3);
}
.opt-row {
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
  border-bottom-style: solid;
}
.opt-row-value { font-weight: 500; color: var(--text-strong); }

/* Inputs / selects — flat panels, sharp corners */
.combo input,
.opt-chain-row select,
.opt-manual-field input,
.opt-manual-field select {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-3);
  color: var(--text-strong);
  padding: 8px 10px;
  font-size: var(--fs-sm);
  transition: border-color .12s ease;
}
.combo input:focus,
.opt-chain-row select:focus,
.opt-manual-field input:focus,
.opt-manual-field select:focus {
  border-color: var(--accent);
  outline: none;
}

/* Card title is now the only "loud" element — pin a terminal accent bar */
.opt-eval-section .card-title,
#opt-eval-section .card-title,
#narratives-section .card-title,
#opt-manual-section .card-title {
  font-family: var(--font-mono);
}

/* === Tabs (Technicals / Fundamentals / News) === */
.opt-tabs {
  display: flex; flex-wrap: wrap; gap: 0;
  margin: var(--s-4) 0 0;
  border-bottom: 1px solid var(--border);
}
.opt-tabs[hidden] { display: none; }
.opt-tab {
  appearance: none; background: transparent;
  border: none; border-bottom: 2px solid transparent;
  padding: 10px 16px;
  font-family: var(--font-mono);
  font-size: var(--fs-sm); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted);
  cursor: pointer;
  margin-bottom: -1px;
  transition: color .12s ease, border-color .12s ease, background .12s ease;
}
.opt-tab:hover { color: var(--text); background: var(--surface-2); }
.opt-tab[aria-selected="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.opt-tab-pane {
  padding-top: var(--s-4);
}
.opt-tab-pane[hidden] { display: none; }

/* When sub-cards live inside a tab pane, drop their own card chrome — the
   tab strip already frames them, and double borders look cluttered. */
.opt-tab-pane .opt-tech,
.opt-tab-pane .opt-fund {
  background: transparent;
  border: none;
  margin: 0;
  padding: 0;
}
.opt-tab-pane .opt-tech-head,
.opt-tab-pane .opt-fund-head {
  display: none;
}

/* News pane mirrors the old inline take but at full width inside the tab */
.opt-news-pane {
  font-size: var(--fs-sm); line-height: 1.55; color: var(--text);
}
.opt-news-pane .opt-news {
  margin: 0;
  background: transparent;
  border: none;
  padding: 0;
}
.opt-news-pane .opt-news-head {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.10em; font-weight: 700;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--s-2);
}
.opt-news-pane .opt-news-body { color: var(--text); }
.opt-news-pane .opt-news-empty {
  color: var(--muted); font-style: italic; font-size: var(--fs-sm);
}
.opt-news-sources {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px;
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--border);
}
.opt-news-sources-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
  margin-right: 2px;
}
.opt-news-source {
  display: inline-flex; align-items: center;
  height: 20px;
  padding: 0 8px;
  font-size: 11px; font-weight: 600;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
}
.opt-news-headlines {
  margin-top: var(--s-2);
  font-size: var(--fs-sm);
}
.opt-news-headlines > summary {
  cursor: pointer;
  color: var(--muted);
  list-style: none;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}
.opt-news-headlines > summary::-webkit-details-marker { display: none; }
.opt-news-headlines > summary::after {
  content: ' +';
  font-family: var(--font-mono);
}
.opt-news-headlines[open] > summary::after { content: ' −'; }
.opt-news-headlines ul {
  list-style: none;
  margin: var(--s-2) 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px;
}
.opt-news-headlines li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--s-2);
  align-items: baseline;
  padding: 4px 0;
  border-top: 1px solid var(--border);
}
.opt-news-headlines li:first-child { border-top: none; }
.opt-news-headline-pub {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted);
  white-space: nowrap;
}
.opt-news-headline-pub.opt-news-headline-rep { color: var(--accent-strong); }
.opt-news-headline-title { color: var(--text); line-height: 1.4; }

/* === Manual grader accordion === */
.opt-manual-details summary {
  list-style: none;
  cursor: pointer;
  display: flex; align-items: center; gap: var(--s-3);
  padding: 0;
  /* Pull onto the card header line cleanly */
  margin: 0;
}
.opt-manual-details summary::-webkit-details-marker { display: none; }
.opt-manual-details summary::after {
  content: '+';
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 18px; font-weight: 600;
  color: var(--muted);
  width: 20px; text-align: center;
  transition: transform .15s ease, color .12s ease;
}
.opt-manual-details[open] summary::after {
  content: '−';
  color: var(--accent);
}
.opt-manual-details summary:hover::after { color: var(--text); }
.opt-manual-details summary .card-title {
  margin: 0;
}
.opt-manual-details summary .opt-manual-trigger-sub {
  font-family: var(--font-mono);
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted);
}
.opt-manual-details > .opt-manual-body {
  padding-top: var(--s-4);
}
/* Hide the card-header divider when the accordion is closed — otherwise
   there's a stray bottom line under just the summary row. */
.opt-manual-details:not([open]) summary.card-header {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}
.opt-manual-details[open] summary.card-header {
  margin-bottom: 0;
}

/* Nudge fund-verdict chip to read more like a status tag */
.opt-fund-verdict {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.10em;
  padding: 3px 8px;
  border-radius: var(--r-2);
}

/* Sub-card heads inside tab panes — render once, smaller */
.opt-tab-pane .opt-tech-foot,
.opt-tab-pane .opt-fund-foot {
  margin-top: var(--s-3);
  padding-top: var(--s-3);
  border-top: 1px dashed var(--border);
}

/* Slightly tighter freshness banner — it competes with the header otherwise */
.freshness {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.06em;
  border-radius: var(--r-3);
}

/* Page subtitle reads as muted terminal line under the header */
.page-sub {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted);
}

/* Tighter narrative cards */
.narr {
  border-radius: var(--r-3);
}
.narr-chip {
  font-size: 11px;
  letter-spacing: 0.04em;
}

/* Section spacing — main cards sit closer to read as one continuous panel */
main { padding-top: var(--s-2); }
.card { margin-bottom: var(--s-3); }
`;
}

async function writeChainFiles(chains) {
  // Wipe data/ first so tickers that fell out of the curated list (or
  // failed this run) don't leave stale files behind. The directory is
  // then recreated fresh.
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  let totalBytes = 0;
  for (const [sym, data] of Object.entries(chains)) {
    const json = JSON.stringify(data);
    await writeFile(resolve(DATA_DIR, `${sym}.json`), json, "utf8");
    totalBytes += json.length;
  }
  return totalBytes;
}

// News-aware AI take per ticker. Runs after chains are fetched. The model
// sees recent headlines + spot price and returns a one-paragraph plain-English
// read plus a sentiment tag the runtime uses to nudge a borderline (Fair)
// verdict toward Good or Bad. Skipped silently if no GEMINI_API_KEY is set,
// so forks without a key still build.
//
// Uses Google's free-tier API with gemma-4-26b-a4b-it — Gemma 3 was retired
// from the v1beta endpoint when the Gemma 4 family launched (Mar 2026), and
// gemini-*-flash free-tier RPD is too tight for a daily build over ~65
// tickers. The 26B MoE (4B active params) is fast, generous on free tier,
// and plenty for a 3-sentence summary task.
const AI_MODEL = "gemma-4-26b-a4b-it";
const AI_NEWS_COUNT = 10;
// Publishers we trust as "reputable" for sourcing. When Yahoo returns more
// headlines than AI_NEWS_COUNT we float matches from this set to the front so
// the AI take leans on wire/major-business-press reporting rather than blog
// aggregators. Matching is case-insensitive substring against n.publisher.
const REPUTABLE_PUBLISHERS = [
  "Reuters", "Bloomberg", "Wall Street Journal", "WSJ", "Financial Times", "FT",
  "Associated Press", "AP", "MarketWatch", "CNBC", "Barron's", "Forbes",
  "The Economist", "New York Times", "Washington Post", "Business Insider",
  "Insider", "Investor's Business Daily", "Investopedia", "Morningstar",
  "Dow Jones", "S&P Global", "Moody's", "Fitch", "Yahoo Finance",
];
// Top-tier official + major-press macro feeds. The narrative extractor sees a
// digest of these alongside the per-ticker news takes so it can spot when the
// data backing a thesis just printed (CPI surprise, Fed pivot, jobs miss).
const MACRO_FEEDS = [
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { name: "BLS Employment Situation", url: "https://www.bls.gov/feed/empsit.rss" },
  { name: "BLS CPI", url: "https://www.bls.gov/feed/cpi.rss" },
  { name: "BLS PPI", url: "https://www.bls.gov/feed/ppi.rss" },
  { name: "SEC Press", url: "https://www.sec.gov/news/pressreleases.rss" },
  // U.S. Treasury removed their RSS endpoint in a 2025 site redesign — there
  // is no documented replacement. Treasury auction / sanctions / debt news
  // still reaches the narrative engine via MarketWatch and CNBC coverage.
  { name: "MarketWatch Top Stories", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
];
const MACRO_PER_FEED = 6;
const MACRO_TOTAL_CAP = 28;
// Free-tier Gemma 4 26B caps at 15 RPM / 1.5K RPD. We previously paced just
// request *starts* (every 5000ms = 12 RPM), but that's only the start rate —
// retries fired by the per-call retry loop fall outside the cadence and pile
// into the same rolling 60s window as fresh starts, occasionally pushing the
// measured rate above 15 and earning 429s on otherwise-healthy tasks.
//
// To stop retry storms from breaking the cap, EVERY call to
// ai.models.generateContent (fresh start AND every retry attempt across all
// three passes) goes through one shared sliding-window limiter. The limiter
// keeps a FIFO of timestamps of acquired slots; acquireAiSlot blocks until
// fewer than AI_RPM timestamps sit inside the last AI_WINDOW_MS, then records
// its own slot. With AI_RPM = 10 we leave a 5-RPM cushion below the 15 RPM
// quota — comfortably absorbs a few simultaneous retries.
const AI_RPM = 10;
const AI_WINDOW_MS = 60000;
const AI_SLOT_POLL_BUFFER_MS = 120;
const _aiSlotTimestamps = [];
// Serialize acquisition so two callers can't read-then-write the window in
// parallel and accidentally both grab the last slot.
let _aiSlotChain = Promise.resolve();
function acquireAiSlot() {
  const prev = _aiSlotChain;
  let release;
  _aiSlotChain = new Promise((r) => { release = r; });
  return prev.then(async () => {
    try {
      while (true) {
        const now = Date.now();
        while (_aiSlotTimestamps.length && now - _aiSlotTimestamps[0] >= AI_WINDOW_MS) {
          _aiSlotTimestamps.shift();
        }
        if (_aiSlotTimestamps.length < AI_RPM) {
          _aiSlotTimestamps.push(now);
          return;
        }
        // Wait until the oldest timestamp falls out of the window, then re-check.
        const waitMs = AI_WINDOW_MS - (now - _aiSlotTimestamps[0]) + AI_SLOT_POLL_BUFFER_MS;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    } finally {
      release();
    }
  });
}
// Google's free tier intermittently returns 500 INTERNAL on otherwise valid
// requests, and 429 RESOURCE_EXHAUSTED if a request slips through to the
// quota window (rare under the limiter, but the API also enforces a separate
// per-project per-second guard). Retry transient 5xx and 429, honouring the
// "Please retry in Xs" hint the API surfaces for rate-limit errors.
const AI_MAX_ATTEMPTS = 4;
const AI_RETRY_BACKOFF_MS = [2000, 5000, 15000];

// Classify a Gemini/Gemma error as transient and return the backoff (ms) the
// caller should wait before retrying, or null if the error isn't transient.
// 429s carry a "Please retry in 14.6985s" hint we should respect — otherwise
// we'd retry into the same rate-limit window and burn an attempt.
function classifyAiError(err, attempt) {
  const msg = String(err?.message || "");
  const causeMsg = String(err?.cause?.message || err?.cause?.code || "");
  const combined = msg + " " + causeMsg;
  const is429 = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(combined);
  const is5xx = /\b(500|502|503|504|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|BAD_GATEWAY)\b/i.test(combined);
  // Network-layer failures (no HTTP response — connection refused, DNS lookup
  // fails, TLS handshake aborts, socket reset mid-stream). undici surfaces
  // these as the bare TypeError "fetch failed" with the real cause on .cause.
  const isNetwork = /\b(fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|network|socket hang up)\b/i.test(combined);
  if (!is429 && !is5xx && !isNetwork) return null;
  if (is429) {
    const m = msg.match(/retry in ([\d.]+)\s*s/i);
    const hinted = m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : null;
    // Use the hinted retry-after if present, else fall back to our backoff
    // schedule but floored at 15s — 429 quota windows are 60s wide.
    return hinted ?? Math.max(15000, AI_RETRY_BACKOFF_MS[attempt] ?? 15000);
  }
  return AI_RETRY_BACKOFF_MS[attempt] ?? 5000;
}
const AI_SYSTEM_PROMPT =
  "You are an options-savvy financial news summarizer. " +
  "Given a US-listed ticker, its current share price, and a handful of recent " +
  "Yahoo Finance headlines, write ONE paragraph (2-4 sentences, plain English, " +
  "no bullet points, no markdown) describing the current news context an options " +
  "trader should weigh before opening a contract on this name. Mention any " +
  "imminent catalyst (earnings, regulatory action, product launch, major " +
  "guidance change) if the headlines suggest one. Stay factual; do not invent " +
  "numbers or events that are not in the headlines. Do not give buy/sell " +
  "advice. Also return a sentiment tag derived from the news: 'bullish' if the " +
  "balance of recent news is clearly positive for the underlying, 'bearish' if " +
  "clearly negative, 'neutral' if mixed or routine, and 'uncertain' if there is " +
  "not enough recent news to judge. " +
  "Respond with ONLY a JSON object of the form " +
  `{"paragraph": "...", "sentiment": "bullish"|"neutral"|"bearish"|"uncertain"} ` +
  "— no markdown fences, no prose before or after the JSON.";

function isReputablePublisher(name) {
  if (!name) return false;
  const lc = name.toLowerCase();
  return REPUTABLE_PUBLISHERS.some((p) => lc.includes(p.toLowerCase()));
}

// Very small RSS/Atom parser — enough to read <title>/<pubDate>/<updated>
// off the feeds we whitelist in MACRO_FEEDS. No XML dependency on purpose;
// these feeds are well-formed and we only need two fields per item.
function parseRssItems(xml, max) {
  if (!xml) return [];
  const out = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) || [];
  for (const block of blocks) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    let title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // Decode the handful of named/numeric entities RSS feeds commonly use.
    title = title
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
    if (!title) continue;
    const dateRaw =
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) ||
        block.match(/<updated>([\s\S]*?)<\/updated>/i) ||
        block.match(/<published>([\s\S]*?)<\/published>/i) ||
        [])[1];
    let publishedAt = null;
    if (dateRaw) {
      const d = new Date(dateRaw.trim());
      if (!isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    out.push({ title, publishedAt });
    if (out.length >= max) break;
  }
  return out;
}

async function fetchMacroHeadlines() {
  // Several gov feeds (BLS especially) drop requests from default Node fetch
  // because the User-Agent looks like a bot. Sending a realistic desktop UA
  // plus the headers a browser would normally send (Accept-Language, Referer)
  // passes more WAFs. Same trick the yahoo-finance2 client uses against
  // consent.yahoo.com.
  const browserHeaders = {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
  };
  const tasks = MACRO_FEEDS.map(async (feed) => {
    try {
      const res = await fetch(feed.url, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.log(`    ⚠ macro feed ${feed.name} HTTP ${res.status}`);
        return [];
      }
      const xml = await res.text();
      const items = parseRssItems(xml, MACRO_PER_FEED);
      return items.map((it) => ({ ...it, publisher: feed.name, source: feed.name }));
    } catch (err) {
      console.log(`    ⚠ macro feed ${feed.name} failed: ${err.message}`);
      return [];
    }
  });
  const lists = await Promise.all(tasks);
  const all = lists.flat();
  // Sort newest-first across all feeds, then cap. Items without a date sink
  // to the bottom — the parser is forgiving but undated wire items add noise.
  all.sort((a, b) => {
    const da = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const db = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return db - da;
  });
  const cutoffMs = Date.now() - 14 * 86400000;
  const fresh = all.filter((it) => !it.publishedAt || Date.parse(it.publishedAt) >= cutoffMs);
  return fresh.slice(0, MACRO_TOTAL_CAP);
}

async function fetchTickerHeadlines(symbol) {
  try {
    // Pull more than AI_NEWS_COUNT so we can float reputable wires to the front
    // and still hit the target count when Yahoo returns a mix.
    const res = await yahooFinance.search(symbol, {
      newsCount: AI_NEWS_COUNT * 2,
      quotesCount: 0,
      enableFuzzyQuery: false,
    });
    const items = Array.isArray(res?.news) ? res.news : [];
    const normalized = items
      .map((n) => ({
        title: (n.title || "").trim(),
        publisher: (n.publisher || "").trim(),
        publishedAt: n.providerPublishTime
          ? new Date(n.providerPublishTime instanceof Date ? n.providerPublishTime : n.providerPublishTime * 1000).toISOString()
          : null,
      }))
      .filter((n) => n.title.length > 0);
    // Stable sort: reputable publishers first, then most recent first. The
    // resulting list is what both the AI prompt and the data file see.
    normalized.sort((a, b) => {
      const ra = isReputablePublisher(a.publisher) ? 0 : 1;
      const rb = isReputablePublisher(b.publisher) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const da = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const db = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return db - da;
    });
    return normalized.slice(0, AI_NEWS_COUNT);
  } catch (err) {
    console.log(`    ⚠ ${symbol} headline fetch failed: ${err.message}`);
    return [];
  }
}

// --- Retail sentiment (Stocktwits + Reddit) -------------------------------
// Both endpoints are free and unauthenticated. Each fetcher returns null on
// any failure so a single bad source never breaks the daily build. The
// aggregator below sums per-source counts into a normalized percentage split.

const SOCIAL_FETCH_TIMEOUT_MS = 6000;
const STOCKTWITS_MAX_MESSAGES = 30;
const REDDIT_USER_AGENT = "stonks-grader/1.0 (+github)";
const REDDIT_BULL_RE = /\b(calls?|long|moon|buy|bull|breakout|squeeze|yolo)\b/i;
const REDDIT_BEAR_RE = /\b(puts?|short|sell|bear|crash|dump|drilling)\b/i;

async function fetchWithTimeout(url, opts = {}, timeoutMs = SOCIAL_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchStocktwitsSentiment(symbol) {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const body = await res.json();
    const messages = Array.isArray(body?.messages) ? body.messages.slice(0, STOCKTWITS_MAX_MESSAGES) : [];
    if (!messages.length) return null;
    let bull = 0, bear = 0, neutral = 0;
    let oldestMs = Infinity, newestMs = -Infinity;
    for (const m of messages) {
      const tag = m?.entities?.sentiment?.basic;
      if (tag === "Bullish") bull++;
      else if (tag === "Bearish") bear++;
      else neutral++;
      if (m?.created_at) {
        const ts = Date.parse(m.created_at);
        if (!isNaN(ts)) {
          if (ts < oldestMs) oldestMs = ts;
          if (ts > newestMs) newestMs = ts;
        }
      }
    }
    const total = bull + bear + neutral;
    const spanDays = oldestMs < newestMs ? Math.max((newestMs - oldestMs) / 86400000, 1 / 24) : 1;
    const msgsPerDay = total / spanDays;
    return {
      source: "stocktwits",
      bull, bear, neutral, total,
      msgsPerDay,
      sampledAt: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`    ⚠ ${symbol} stocktwits fetch failed: ${err.message}`);
    return null;
  }
}

async function fetchRedditMentions(symbol) {
  try {
    const url = `https://www.reddit.com/r/wallstreetbets+stocks+options/search.json?q=${encodeURIComponent(symbol)}&restrict_sr=on&sort=new&t=day&limit=50`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": REDDIT_USER_AGENT } });
    if (!res.ok) return null;
    const body = await res.json();
    const children = Array.isArray(body?.data?.children) ? body.data.children : [];
    if (!children.length) return null;
    // Short symbols collide with English words (A, F, T) — require the $TICKER
    // cashtag form for them. Longer symbols use a word-boundary match.
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchRe = symbol.length <= 2
      ? new RegExp(`\\$${escaped}\\b`, "i")
      : new RegExp(`(?:\\$|\\b)${escaped}\\b`, "i");
    let bull = 0, bear = 0, neutral = 0, total = 0;
    for (const c of children) {
      const title = (c?.data?.title || "").trim();
      if (!title || !matchRe.test(title)) continue;
      total++;
      const isBull = REDDIT_BULL_RE.test(title);
      const isBear = REDDIT_BEAR_RE.test(title);
      if (isBull && !isBear) bull++;
      else if (isBear && !isBull) bear++;
      else neutral++;
    }
    if (total === 0) return null;
    return {
      source: "reddit",
      bull, bear, neutral, total,
      msgsPerDay: total, // search window is t=day
      sampledAt: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`    ⚠ ${symbol} reddit fetch failed: ${err.message}`);
    return null;
  }
}

async function fetchSocialSentiment(symbol) {
  const [stocktwits, reddit] = await Promise.all([
    fetchStocktwitsSentiment(symbol),
    fetchRedditMentions(symbol),
  ]);
  if (!stocktwits && !reddit) return null;
  let bull = 0, bear = 0, neutral = 0, total = 0, msgCount24h = 0;
  for (const s of [stocktwits, reddit]) {
    if (!s) continue;
    bull += s.bull; bear += s.bear; neutral += s.neutral; total += s.total;
    msgCount24h += s.msgsPerDay || 0;
  }
  if (total === 0) return null;
  return {
    bullishPct: (bull / total) * 100,
    bearishPct: (bear / total) * 100,
    neutralPct: (neutral / total) * 100,
    msgCount24h,
    trend: "flat",
    sources: { stocktwits, reddit },
    builtAt: new Date().toISOString(),
  };
}

async function generateNewsTake(ai, symbol, spot, headlines) {
  const headlineBlock = headlines.length
    ? headlines
        .map((h, i) => `${i + 1}. [${h.publishedAt || "unknown date"}] (${h.publisher || "unknown"}) ${h.title}`)
        .join("\n")
    : "(no recent headlines available)";
  const userMessage =
    `Ticker: ${symbol}\n` +
    `Spot price: $${spot.toFixed(2)}\n` +
    `Recent headlines:\n${headlineBlock}`;

  // Gemma doesn't support Gemini's responseSchema (constrained decoding) and
  // sometimes ignores responseMimeType. The prompt is explicit about the JSON
  // shape; the parser below is forgiving about fences/commentary.
  let response;
  let lastErr;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    try {
      await acquireAiSlot();
      response = await ai.models.generateContent({
        model: AI_MODEL,
        contents: `${AI_SYSTEM_PROMPT}\n\n${userMessage}`,
        config: {
          temperature: 0.3,
          maxOutputTokens: 600,
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      const wait = classifyAiError(err, attempt);
      if (wait == null || attempt === AI_MAX_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!response) throw lastErr ?? new Error("no response from Gemini");

  const text = response.text;
  if (!text) throw new Error("empty Gemini response");
  // Gemma occasionally wraps JSON in ```json fences or trails commentary,
  // even with responseMimeType=application/json. Strip fences and extract the
  // outermost {...} block before parsing.
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  const parsed = JSON.parse(jsonText);
  // Keep a compact source list — distinct publisher names ordered by their
  // appearance in the (already reputable-first) headline list — so the UI can
  // display "Sources: Reuters · Bloomberg · MarketWatch" under each take.
  const sources = [];
  const seenPub = new Set();
  for (const h of headlines) {
    const p = (h.publisher || "").trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seenPub.has(key)) continue;
    seenPub.add(key);
    sources.push(p);
  }
  return {
    paragraph: String(parsed.paragraph || "").trim(),
    sentiment: parsed.sentiment,
    headlines: headlines.map((h) => ({
      title: h.title,
      publisher: h.publisher || null,
      publishedAt: h.publishedAt || null,
      reputable: isReputablePublisher(h.publisher),
    })),
    sources,
    builtAt: new Date().toISOString(),
  };
}

// Fundamentals judgment — given a ticker's fundamental metrics + last
// earnings, asks the model to produce a verdict + concise positives/negatives
// the user sees when selecting that ticker. The numeric snapshot is built
// deterministically below so we keep the prompt small and never invent
// numbers in the LLM.
const FUNDAMENTALS_SYSTEM_PROMPT =
  "You are an equity analyst writing a short fundamentals + earnings scorecard for an options trader. " +
  "Given a snapshot of a company's valuation, growth, margin, balance-sheet, cash-flow, and most-recent " +
  "earnings metrics, return a tight verdict on the underlying business and a list of the most material " +
  "POSITIVES and NEGATIVES a trader should weigh before opening a contract on the name. " +
  "Rules: " +
  "(1) Only use the numbers provided — do not invent figures, ratios, or events. " +
  "(2) Each positive / negative must be a single sentence, plain English, ideally referencing the " +
  "metric that drove it (e.g. \"Profit margin 28% — best-in-class for the sector\", \"Forward P/E 45x " +
  "vs trailing 30x — priced for substantial growth\"). " +
  "(3) Aim for 3-5 positives and 3-5 negatives. If the snapshot only supports fewer, return fewer; " +
  "do not pad. " +
  "(4) The earnings recap should mention the last reported quarter EPS vs estimate (beat / miss / " +
  "in line) and the next confirmed earnings date if provided. Skip the recap if there is no earnings " +
  "data. " +
  "(5) Verdict is one of \"strong\", \"mixed\", or \"weak\" — strong = clearly attractive fundamentals; " +
  "mixed = real tradeoffs on both sides; weak = the business has notable problems. " +
  "(6) Summary is one sentence — the elevator pitch on the fundamentals, not the stock. " +
  "Respond with ONLY a JSON object of the form " +
  "{\"verdict\":\"strong\"|\"mixed\"|\"weak\",\"summary\":\"...\",\"earningsRecap\":\"...\",\"positives\":[\"...\"],\"negatives\":[\"...\"]} " +
  "— no markdown fences, no prose before or after the JSON.";

function formatFundamentalsForPrompt(symbol, spot, f) {
  const fmtNum = (n, d = 2) => (n == null || !isFinite(n) ? "n/a" : Number(n).toFixed(d));
  const fmtPct = (n) => (n == null || !isFinite(n) ? "n/a" : `${Number(n).toFixed(1)}%`);
  const fmtBig = (n) => {
    if (n == null || !isFinite(n)) return "n/a";
    const a = Math.abs(n);
    if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toFixed(0)}`;
  };
  const lines = [];
  lines.push(`Ticker: ${symbol}`);
  if (f.name) lines.push(`Company: ${f.name}`);
  lines.push(`Spot price: $${spot.toFixed(2)}`);
  lines.push(`Market cap: ${fmtBig(f.marketCap)}`);
  lines.push("");
  lines.push("Valuation:");
  lines.push(`  Trailing P/E: ${fmtNum(f.trailingPE)}`);
  lines.push(`  Forward P/E: ${fmtNum(f.forwardPE)}`);
  lines.push(`  PEG ratio: ${fmtNum(f.pegRatio)}`);
  lines.push(`  Price/Book: ${fmtNum(f.priceToBook)}`);
  lines.push(`  Price/Sales (TTM): ${fmtNum(f.priceToSales)}`);
  lines.push("");
  lines.push("Growth (YoY):");
  lines.push(`  Revenue growth: ${fmtPct(f.revenueGrowthYoy)}`);
  lines.push(`  Earnings growth: ${fmtPct(f.earningsGrowthYoy)}`);
  lines.push(`  Quarterly earnings growth: ${fmtPct(f.earningsQuarterlyGrowthYoy)}`);
  if (f.growthEstimateCurQ != null) lines.push(`  Analyst growth est, current Q: ${fmtPct(f.growthEstimateCurQ)}`);
  if (f.growthEstimateCurY != null) lines.push(`  Analyst growth est, current FY: ${fmtPct(f.growthEstimateCurY)}`);
  lines.push("");
  lines.push("Margins / returns:");
  lines.push(`  Gross margin: ${fmtPct(f.grossMargin)}`);
  lines.push(`  Operating margin: ${fmtPct(f.operatingMargin)}`);
  lines.push(`  Profit margin: ${fmtPct(f.profitMargin)}`);
  lines.push(`  Return on equity: ${fmtPct(f.returnOnEquity)}`);
  lines.push(`  Return on assets: ${fmtPct(f.returnOnAssets)}`);
  lines.push("");
  lines.push("Balance sheet / cash flow:");
  lines.push(`  Debt/Equity: ${fmtNum(f.debtToEquity)}`);
  lines.push(`  Current ratio: ${fmtNum(f.currentRatio)}`);
  lines.push(`  Quick ratio: ${fmtNum(f.quickRatio)}`);
  lines.push(`  Total cash: ${fmtBig(f.totalCash)}`);
  lines.push(`  Total debt: ${fmtBig(f.totalDebt)}`);
  lines.push(`  Free cash flow (TTM): ${fmtBig(f.freeCashFlow)}`);
  lines.push("");
  lines.push("Dividend:");
  lines.push(`  Yield: ${fmtPct(f.dividendYield)}`);
  lines.push(`  Payout ratio: ${fmtPct(f.payoutRatio)}`);
  lines.push("");
  lines.push("Analyst targets:");
  lines.push(`  Mean target: ${f.targetMeanPrice != null ? `$${f.targetMeanPrice.toFixed(2)}` : "n/a"} ` +
    `(low ${f.targetLowPrice != null ? `$${f.targetLowPrice.toFixed(2)}` : "n/a"}, ` +
    `high ${f.targetHighPrice != null ? `$${f.targetHighPrice.toFixed(2)}` : "n/a"})`);
  lines.push(`  Consensus: ${f.recommendationKey || "n/a"} (${f.numberOfAnalystOpinions ?? "n/a"} analysts)`);
  lines.push(`  Beta: ${fmtNum(f.beta)}`);
  lines.push("");
  lines.push("Earnings:");
  if (f.lastQuarter) {
    const lq = f.lastQuarter;
    lines.push(`  Last reported (${lq.period || "?"} ${lq.date || ""}): EPS actual ${fmtNum(lq.epsActual)} ` +
      `vs estimate ${fmtNum(lq.epsEstimate)} ` +
      `(surprise ${lq.surprisePct != null ? fmtPct(lq.surprisePct) : "n/a"})`);
  } else {
    lines.push("  Last reported: n/a");
  }
  lines.push(`  Next earnings date: ${f.nextEarningsDate || "n/a"}`);
  return lines.join("\n");
}

function hasUsefulFundamentals(f) {
  if (!f) return false;
  // ETFs return mostly nulls. Require at least one valuation OR earnings metric.
  const keys = [
    "trailingPE", "forwardPE", "priceToBook", "priceToSales",
    "profitMargin", "operatingMargin", "revenueGrowthYoy",
    "marketCap", "freeCashFlow", "totalRevenue",
  ];
  for (const k of keys) {
    if (f[k] != null && isFinite(f[k])) return true;
  }
  if (f.lastQuarter && f.lastQuarter.epsActual != null) return true;
  return false;
}

async function generateFundamentalsJudgment(ai, symbol, spot, fundamentals) {
  const userMessage = formatFundamentalsForPrompt(symbol, spot, fundamentals);
  let response;
  let lastErr;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    try {
      await acquireAiSlot();
      response = await ai.models.generateContent({
        model: AI_MODEL,
        contents: `${FUNDAMENTALS_SYSTEM_PROMPT}\n\n${userMessage}`,
        config: {
          temperature: 0.25,
          maxOutputTokens: 900,
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      const wait = classifyAiError(err, attempt);
      if (wait == null || attempt === AI_MAX_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!response) throw lastErr ?? new Error("no response from Gemini");
  const text = response.text;
  if (!text) throw new Error("empty Gemini response");
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  const parsed = JSON.parse(jsonText);
  const cleanList = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => String(s || "").trim())
      .filter((s) => s.length > 0)
      .slice(0, 6);
  const verdict = ["strong", "mixed", "weak"].includes(parsed.verdict) ? parsed.verdict : "mixed";
  return {
    verdict,
    summary: String(parsed.summary || "").trim(),
    earningsRecap: String(parsed.earningsRecap || "").trim(),
    positives: cleanList(parsed.positives),
    negatives: cleanList(parsed.negatives),
    builtAt: new Date().toISOString(),
  };
}

async function attachFundamentalsJudgments(chains) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY set — skipping fundamentals judgments. Raw metrics still attached.");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const entries = Object.entries(chains).filter(([, data]) => hasUsefulFundamentals(data.fundamentals));
  console.log(`Generating fundamentals judgments for ${entries.length} tickers…`);
  // Pacing is handled centrally by acquireAiSlot() inside the generate call;
  // no per-task stagger needed. Tasks queue against the shared rate limiter
  // in roughly the order they were spawned, so we still get the same FIFO
  // behaviour the old stagger gave us but with retries also counted.
  const tasks = entries.map(([sym, data]) => (async () => {
    try {
      const judgment = await generateFundamentalsJudgment(ai, sym, data.spot, data.fundamentals);
      data.fundamentals = { ...data.fundamentals, judgment };
      console.log(`  ✓ ${sym} fundamentals — ${judgment.verdict} (+${judgment.positives.length}/-${judgment.negatives.length})`);
    } catch (err) {
      console.log(`  ✗ ${sym} fundamentals judgment failed: ${err.message}`);
    }
  })());
  await Promise.all(tasks);
}

async function attachAiNewsTakes(chains) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY set — skipping AI news takes. Chain data will still build.");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const entries = Object.entries(chains);
  console.log(`Generating AI news takes for ${entries.length} tickers…`);
  // Pacing handled by acquireAiSlot() inside generateNewsTake; the headline
  // fetch is a Yahoo HTTP call so it's safe to issue concurrently for all
  // tickers — only the model call goes through the shared limiter.
  const tasks = entries.map(([sym, data]) => (async () => {
    try {
      const headlines = await fetchTickerHeadlines(sym);
      const take = await generateNewsTake(ai, sym, data.spot, headlines);
      data.news = take;
      console.log(`  ✓ ${sym} — ${take.sentiment} (${headlines.length} headlines)`);
    } catch (err) {
      console.log(`  ✗ ${sym} — AI take failed: ${err.message}`);
      data.news = null;
    }
  })());
  await Promise.all(tasks);
}

async function attachSocialSentiment(chains) {
  const entries = Object.entries(chains);
  console.log(`Fetching retail sentiment (Stocktwits + Reddit) for ${entries.length} tickers…`);
  const tasks = entries.map(([sym, data]) => (async () => {
    const social = await fetchSocialSentiment(sym);
    data.social = social;
    if (social) {
      console.log(`  ✓ ${sym} — ${social.bullishPct.toFixed(0)}% bull / ${social.bearishPct.toFixed(0)}% bear (${Math.round(social.msgCount24h)} msgs/day)`);
    }
  })());
  await Promise.all(tasks);
}

// Trend tracking — markets run on stories (AI capex, GLP-1 obesity, tariffs,
// election plays, etc.) and those stories rotate. After per-ticker news takes
// are generated, this step asks the model to look across every ticker's
// summary + top headlines, extract the active narratives currently driving
// capital, and tag each narrative with the LONG and SHORT tickers from our
// curated list that ride it. Output is persisted in data/trends.json (latest)
// + data/trends-history.json (rolling 90-day window of compact daily snapshots
// so the page can show "X days running" / "trend cooled off N days ago").
const NARRATIVE_HISTORY_DAYS = 90;
const NARRATIVE_MAX_COUNT = 24;
const NARRATIVE_SYSTEM_PROMPT =
  "You are a markets analyst who tracks the narratives currently driving US equity flows. " +
  "Markets run on stories — AI capex, GLP-1 obesity drugs, tariff fights, the crypto trade, " +
  "post-election rotations, defense plays around geopolitics, etc. Narratives come and go, some " +
  "are dominating price action right now, others are building in the background and need a " +
  "catalyst to take over. Some narratives directly clash with each other — when one heats up the " +
  "other has to cool. Your job is to rank them, not just list them. " +
  "You are given two information sources: (1) a snapshot of recent per-ticker news takes for a " +
  "curated US ticker list, and (2) a digest of MACRO HEADLINES from official sources (Federal " +
  "Reserve, BLS, Treasury, SEC) and major business press (Reuters, Bloomberg, WSJ, MarketWatch, " +
  "CNBC) covering the last ~2 weeks. Use the macro digest to decide whether a narrative's required " +
  "trigger has fired (e.g. a hot CPI print activates the inflation/short-duration trade) or is " +
  "still pending (no trigger yet). " +
  "OUTPUT STRUCTURE — you produce TWO layers of analysis, organized by sector. For each sector in " +
  "the SECTOR/INDUSTRY WHITELIST provided in the user message, return ONE \"sector overview\" object " +
  "plus an array of sub-industry narratives that live inside that sector. " +
  "The SECTOR OVERVIEW captures the top-down story for that entire sector — e.g. \"Tech is broadly " +
  "bullish because the AI capex cycle is still expanding\", or \"Healthcare is mixed: GLP-1 leaders are " +
  "ripping but generic pharma is under PBM pressure\". The sector overview has: " +
  `a "stance" of "bullish", "bearish", or "mixed" describing the net sector posture; ` +
  `a "thesis" of 1-2 sentences explaining the dominant sector-level story right now (why this sector is moving and in which direction); ` +
  `a "strength" integer 0-100 (how dominantly the sector story is driving capital today); ` +
  `a "watchFor" array of 2-4 short concrete red flags / catalysts that would FLIP or BREAK this sector narrative — be specific and quantitative where possible (e.g. "Mag 7 hyperscaler capex guide DOWN at next earnings — would crack the AI demand thesis", "10Y yield breaks above 5% — kills the duration bid that powers software multiples", "Hot core CPI print > 0.4% MoM — forces a hawkish Fed repricing"). These are the watchlist items a trader uses to know when the sector story is rolling over. ` +
  "Then each SUB-INDUSTRY NARRATIVE within that sector is the granular trade — multiple narratives per sub-industry are fine when both bull and bear stories are real (e.g. Semiconductors might have an AI-demand bull narrative AND a China export-controls bear narrative). Do NOT fabricate narratives to fill slots; if nothing is genuinely in motion for a sub-industry, leave it out — the UI shows an empty placeholder. " +
  "Each sub-industry narrative has: " +
  `a short "name" (2-5 words, title case, e.g. "AI Infrastructure Buildout", "GLP-1 Obesity Wave"); ` +
  `an "industry" string that EXACTLY matches one of the sub-industries listed under the current sector in the whitelist; ` +
  `a one-sentence "thesis" in plain English explaining the trade and why it is in play; ` +
  `a "sentiment" of "bullish" or "bearish" describing whether the narrative is a tailwind or headwind for the longs; ` +
  `a "longs" array of tickers from the provided list that benefit from the narrative; ` +
  `a "shorts" array of tickers from the provided list that are hurt by it (empty array if none apply); ` +
  `a "confidence" of "high", "medium", or "low"; ` +
  `a "strength" integer 0-100 (95 = dominant tape driver; 60 = meaningful mover; 30 = simmering; 10 = mostly latent); ` +
  `a "status" of "active" (playing out in price), "building" (thesis intact but not yet priced — waiting on a trigger), or "fading" (move has largely happened); ` +
  `a "timeframe" of "immediate" (this week), "near-term" (1-4 weeks), "medium-term" (1-3 months), or "long-term" (3+ months); ` +
  `a "watchFor" array of 1-3 short concrete red flags / catalysts that would FLIP or BREAK this specific narrative (e.g. for an AI Semis bull narrative: "Hyperscaler capex cuts at next earnings", "MSFT spends $100B but revenue growth slows below 10%", "China export controls expand to HBM"). Frame each item as something a trader could watch and recognize when it happens. ` +
  `a "conflictsWith" array listing the NAMES of OTHER narratives in this same response that this one directly opposes. Empty array if none clash. ` +
  "Rules: only use tickers from the provided list — do not invent tickers. Each sub-industry narrative MUST have at least one long or one short. Prefer broader narratives over very narrow single-name stories. " +
  "Sectors with thin coverage (e.g. \"Consumer Defensive\" with only Discount Stores, or \"Precious Metals\" with Gold/Silver) still get an overview AND any sub-industry narratives that legitimately apply — just shorter. For Precious Metals, treat Gold (GLD) and Silver (SLV) as standalone macro plays (real-yield trade, dollar trade, geopolitical hedge, central-bank buying); the longs/shorts arrays should reference GLD and SLV directly. " +
  "If a list of PREVIOUS narrative names is provided, reuse a previous name verbatim when today's narrative is the same story so we can track its lifespan; otherwise pick a fresh name. " +
  "conflictsWith names MUST match other names in your own response exactly. " +
  "Respond with ONLY a JSON object of the form " +
  `{"sectors":[{"sector":"Technology","overview":{"stance":"bullish"|"bearish"|"mixed","thesis":"...","strength":0-100,"watchFor":["...","..."]},"narratives":[{"name":"...","industry":"...","thesis":"...","sentiment":"bullish"|"bearish","longs":["..."],"shorts":["..."],"confidence":"high"|"medium"|"low","strength":0-100,"status":"active"|"building"|"fading","timeframe":"immediate"|"near-term"|"medium-term"|"long-term","watchFor":["..."],"conflictsWith":["..."]}]}]} ` +
  "— include an entry for EVERY sector in the whitelist (even if its narratives array is empty), no markdown fences, no prose before or after the JSON.";

const TRENDS_FILE = "trends.json";
const TRENDS_HISTORY_FILE = "trends-history.json";
const UNUSUAL_FILE = "unusual.json";
const UNUSUAL_HISTORY_FILE = "unusual-history.json";

async function loadTrendHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, TRENDS_HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

// Load yesterday's full narratives + recentlyEnded snapshot. trends-history.json
// only keeps compact daily snapshots (name + sentiment + tickers); the full
// payload with thesis / triggers / industry / conflictsWith lives in
// trends.json from the previous successful build. We need this for the
// stale-fallback path when today's narrative extraction blows through its
// retry budget — the page can keep showing yesterday's stories rather than
// an empty card.
async function loadLastGoodTrends() {
  try {
    const raw = await readFile(resolve(DATA_DIR, TRENDS_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Read the most recent unusual-flow scan (produced by scripts/scan-unusual.mjs
// on its hourly cron). The daily build wipes data/, so we load this in memory
// before the wipe and rewrite it afterwards so the page keeps showing the
// last good hourly scan until the next hourly job runs.
async function loadUnusualFlow() {
  try {
    const raw = await readFile(resolve(DATA_DIR, UNUSUAL_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Same preservation pattern as loadUnusualFlow — the unusual-flow scanner
// writes data/unusual-history.json hourly, but the daily build wipes data/.
// Load before the wipe, rewrite after, so spike comparisons survive the cycle.
async function loadUnusualHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, UNUSUAL_HISTORY_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildNarrativeUserMessage(chains, previousNames, macroHeadlines) {
  const lines = Object.entries(chains).map(([sym, data]) => {
    const news = data.news;
    const sentiment = news?.sentiment || "unknown";
    const summary = (news?.paragraph || "").replace(/\s+/g, " ").trim();
    const firstHl = Array.isArray(news?.headlines) && news.headlines.length ? news.headlines[0] : null;
    // headlines used to be plain strings; they're now {title, publisher, …}.
    // Accept either shape so a half-stale data dir doesn't break the build.
    const topHeadlineRaw = !firstHl
      ? ""
      : typeof firstHl === "string"
        ? firstHl
        : (firstHl.title || "");
    const topHeadlinePub = firstHl && typeof firstHl === "object" ? (firstHl.publisher || "") : "";
    const topHeadline = topHeadlineRaw.replace(/\s+/g, " ").trim();
    // Trim each ticker block so the combined prompt stays well under the
    // model's context — Gemma 4 26B has plenty of room but we send ~65 of these.
    const summaryClip = summary.length > 260 ? summary.slice(0, 257) + "…" : summary;
    const headlineClip = topHeadline.length > 140 ? topHeadline.slice(0, 137) + "…" : topHeadline;
    const pubTag = topHeadlinePub ? ` (${topHeadlinePub})` : "";
    return `- ${sym} [${sentiment}] ${summaryClip}` + (headlineClip ? ` Headline${pubTag}: "${headlineClip}"` : "");
  });
  const previousBlock = previousNames.length
    ? `Previous narrative names from the last build (reuse verbatim when the same story is still live):\n${previousNames.map((n) => `- ${n}`).join("\n")}`
    : "No previous narratives recorded.";
  const macroLines = Array.isArray(macroHeadlines) && macroHeadlines.length
    ? macroHeadlines.slice(0, MACRO_TOTAL_CAP).map((h) => {
        const date = h.publishedAt ? h.publishedAt.slice(0, 10) : "undated";
        const t = (h.title || "").replace(/\s+/g, " ").trim();
        const clipped = t.length > 180 ? t.slice(0, 177) + "…" : t;
        return `- [${date}] (${h.publisher || "source"}) ${clipped}`;
      }).join("\n")
    : "(no macro headlines retrieved)";
  const industryWhitelist = SECTOR_ORDER
    .map((sector) => `  ${sector}:\n` + (INDUSTRIES_BY_SECTOR[sector] || []).map((ind) => `    - ${ind}`).join("\n"))
    .join("\n");
  return (
    `Tickers in scope: ${Object.keys(chains).join(", ")}\n\n` +
    `INDUSTRY WHITELIST — the "industry" field on every narrative must match one of these exact strings:\n${industryWhitelist}\n\n` +
    `${previousBlock}\n\n` +
    `Macro headlines digest (official + major business press, newest first — use these to judge whether each narrative's trigger has fired):\n${macroLines}\n\n` +
    `Recent per-ticker news takes:\n${lines.join("\n")}`
  );
}

// Narrative extraction is a single critical call (vs the 65 per-ticker news
// calls where one failure is acceptable), so we retry more aggressively here.
// The default AI_MAX_ATTEMPTS budget for ticker calls is 4 with [2s, 5s, 15s]
// backoffs — that's ~22s of tolerance, which a single longer network blip can
// blow through. For narratives we extend to 7 attempts with progressively
// longer waits, tolerating up to ~3 minutes of intermittent failure.
const NARRATIVE_MAX_ATTEMPTS = 7;
const NARRATIVE_RETRY_BACKOFF_MS = [3000, 8000, 20000, 30000, 45000, 60000];

async function generateMarketNarratives(ai, chains, previousNames, macroHeadlines) {
  const userMessage = buildNarrativeUserMessage(chains, previousNames, macroHeadlines);
  let response;
  let lastErr;
  for (let attempt = 0; attempt < NARRATIVE_MAX_ATTEMPTS; attempt++) {
    try {
      await acquireAiSlot();
      response = await ai.models.generateContent({
        model: AI_MODEL,
        contents: `${NARRATIVE_SYSTEM_PROMPT}\n\n${userMessage}`,
        config: {
          temperature: 0.4,
          maxOutputTokens: 4200,
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      // Classify with the standard helper but use the narrative-specific
      // backoff schedule when the error is transient.
      const wait = classifyAiError(err, attempt);
      if (wait == null || attempt === NARRATIVE_MAX_ATTEMPTS - 1) throw err;
      const narrativeWait = NARRATIVE_RETRY_BACKOFF_MS[attempt] ?? 60000;
      // Honour the rate-limit hint from classifyAiError when it's larger than
      // our schedule (e.g. a "retry in 30s" hint on attempt 0).
      const effectiveWait = Math.max(wait, narrativeWait);
      const causeMsg = err?.cause?.code || err?.cause?.message || "";
      console.log(
        `    ↻ narrative attempt ${attempt + 1}/${NARRATIVE_MAX_ATTEMPTS} failed (${err.message}` +
        (causeMsg ? ` · cause ${causeMsg}` : "") +
        `) — retrying in ${Math.round(effectiveWait / 1000)}s`,
      );
      await new Promise((r) => setTimeout(r, effectiveWait));
    }
  }
  if (!response) throw lastErr ?? new Error("no response from Gemini");
  const text = response.text;
  if (!text) throw new Error("empty Gemini response");
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  const parsed = JSON.parse(jsonText);
  const validSymbols = new Set(Object.keys(chains));
  const sanitizeTickers = (arr) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr
          .map((s) => String(s || "").toUpperCase().trim())
          .filter((s) => validSymbols.has(s))))
      : [];
  const sanitizeStringList = (arr, max, maxLen) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr
          .map((s) => String(s || "").replace(/\s+/g, " ").trim())
          .filter((s) => s.length > 0)
          .map((s) => (s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s))))
          .slice(0, max)
      : [];
  const VALID_STATUS = ["active", "building", "fading"];
  const VALID_TIMEFRAME = ["immediate", "near-term", "medium-term", "long-term"];
  const VALID_STANCE = ["bullish", "bearish", "mixed"];
  const STATUS_WEIGHT = { active: 2, building: 1, fading: 0 };
  const TF_WEIGHT = { immediate: 3, "near-term": 2, "medium-term": 1, "long-term": 0 };

  // The new prompt emits a sectors[] array; tolerate the legacy flat
  // narratives[] shape for stale-fallback safety.
  const sectorsRaw = Array.isArray(parsed.sectors) ? parsed.sectors : null;
  const legacyNarrativesRaw = Array.isArray(parsed.narratives) ? parsed.narratives : null;

  const cleanNarrative = (n, sectorHint) => {
    const name = String(n.name || "").trim();
    const thesis = String(n.thesis || "").trim();
    const sentiment = n.sentiment === "bearish" ? "bearish" : "bullish";
    const confidence = ["high", "medium", "low"].includes(n.confidence) ? n.confidence : "medium";
    const longs = sanitizeTickers(n.longs);
    const shorts = sanitizeTickers(n.shorts);
    let strength = Number(n.strength);
    if (!isFinite(strength)) strength = confidence === "high" ? 70 : confidence === "low" ? 30 : 50;
    strength = Math.max(0, Math.min(100, Math.round(strength)));
    const status = VALID_STATUS.includes(n.status) ? n.status : "active";
    const timeframe = VALID_TIMEFRAME.includes(n.timeframe) ? n.timeframe : "near-term";
    // watchFor is the new field; accept legacy `triggers` from older snapshots.
    const watchFor = sanitizeStringList(
      Array.isArray(n.watchFor) ? n.watchFor : n.triggers,
      3,
      160,
    );
    const conflictsWithRaw = sanitizeStringList(n.conflictsWith, 4, 60);
    // Industry must match the whitelist. If the model omits / invents one,
    // vote from the longs (then shorts). Falls back to "Uncategorized" only
    // when no ticker resolves either (which the upstream filter then drops).
    const industry = resolveNarrativeIndustry(n.industry, longs, shorts);
    const out = { name, industry, thesis, sentiment, confidence, strength, status, timeframe, watchFor, conflictsWith: conflictsWithRaw, longs, shorts };
    // Stamp the parent sector when we know it from the wrapper. The UI
    // groups by SECTOR_OF_INDUSTRY anyway, but having `sector` on the
    // narrative simplifies the stale-fallback path.
    if (sectorHint) out.sector = sectorHint;
    return out;
  };

  const cleanedNarratives = [];
  const sectorOverviews = {};

  if (sectorsRaw) {
    for (const sec of sectorsRaw) {
      const sectorName = String(sec?.sector || "").trim();
      if (!SECTOR_ORDER.includes(sectorName)) continue;
      const ov = sec.overview || {};
      const stance = VALID_STANCE.includes(ov.stance) ? ov.stance : "mixed";
      const ovThesis = String(ov.thesis || "").trim();
      let ovStrength = Number(ov.strength);
      if (!isFinite(ovStrength)) ovStrength = 50;
      ovStrength = Math.max(0, Math.min(100, Math.round(ovStrength)));
      const ovWatchFor = sanitizeStringList(ov.watchFor, 4, 180);
      if (ovThesis) {
        sectorOverviews[sectorName] = {
          stance,
          thesis: ovThesis,
          strength: ovStrength,
          watchFor: ovWatchFor,
        };
      }
      const subs = Array.isArray(sec.narratives) ? sec.narratives : [];
      for (const n of subs) cleanedNarratives.push(cleanNarrative(n, sectorName));
    }
  } else if (legacyNarrativesRaw) {
    for (const n of legacyNarrativesRaw) cleanedNarratives.push(cleanNarrative(n, null));
  }

  const cleaned = cleanedNarratives
    .filter((n) => n.name && n.thesis && (n.longs.length > 0 || n.shorts.length > 0))
    .slice(0, NARRATIVE_MAX_COUNT);

  // Drop conflictsWith references to names that aren't in our final cleaned
  // set — the model occasionally hallucinates a conflict against a narrative
  // it didn't actually emit.
  const nameSet = new Map(cleaned.map((n) => [n.name.toLowerCase(), n.name]));
  for (const n of cleaned) {
    n.conflictsWith = n.conflictsWith
      .map((c) => nameSet.get(c.toLowerCase()))
      .filter((c) => c && c.toLowerCase() !== n.name.toLowerCase());
  }
  // Sort strongest-first regardless of the order the model returned them in:
  // strength desc, then active > building > fading, then immediate > long-term,
  // then confidence high > medium > low as a stable tiebreaker.
  const CONF_WEIGHT = { high: 2, medium: 1, low: 0 };
  cleaned.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    const sw = (STATUS_WEIGHT[b.status] || 0) - (STATUS_WEIGHT[a.status] || 0);
    if (sw !== 0) return sw;
    const tw = (TF_WEIGHT[b.timeframe] || 0) - (TF_WEIGHT[a.timeframe] || 0);
    if (tw !== 0) return tw;
    return (CONF_WEIGHT[b.confidence] || 0) - (CONF_WEIGHT[a.confidence] || 0);
  });
  return { narratives: cleaned, sectorOverviews };
}

// Walk back through prior snapshots to discover when each narrative first
// appeared (matched by case-insensitive name). Gives the UI a "running for N
// days" badge so the user can see which stories are fresh vs. entrenched.
function annotateNarrativesWithLifespan(narratives, history, todayIso) {
  const today = todayIso.slice(0, 10);
  return narratives.map((n) => {
    const lcName = n.name.toLowerCase();
    let firstSeen = today;
    // History is newest-first below; iterate to find the OLDEST contiguous
    // run that includes this narrative.
    for (let i = 0; i < history.length; i++) {
      const snap = history[i];
      const hit = snap.narratives.find((h) => h.name.toLowerCase() === lcName);
      if (hit) {
        firstSeen = snap.date;
      } else {
        // First gap breaks the streak — the lifespan is the contiguous run.
        break;
      }
    }
    const daysRunning =
      Math.max(1, Math.floor((new Date(today + "T00:00:00Z").getTime() - new Date(firstSeen + "T00:00:00Z").getTime()) / 86400000) + 1);
    return { ...n, firstSeen, daysRunning };
  });
}

function updateTrendHistory(history, narratives, todayIso) {
  const date = todayIso.slice(0, 10);
  // Compact snapshot — name + sentiment + ticker lists are enough to compute
  // continuity and a "trends that came and went" view. Include strength /
  // status so later builds can chart how a narrative built up or faded
  // without bloating the file with theses/triggers.
  const snapshot = {
    date,
    builtAtIso: todayIso,
    narratives: narratives.map((n) => ({
      name: n.name,
      sentiment: n.sentiment,
      strength: n.strength,
      status: n.status,
      longs: n.longs,
      shorts: n.shorts,
    })),
  };
  // Replace any existing snapshot for today (a re-run on the same day overwrites).
  const withoutToday = history.filter((s) => s.date !== date);
  const next = [snapshot, ...withoutToday];
  // Prune anything older than NARRATIVE_HISTORY_DAYS.
  const cutoff = new Date(date + "T00:00:00Z").getTime() - NARRATIVE_HISTORY_DAYS * 86400000;
  return next.filter((s) => new Date(s.date + "T00:00:00Z").getTime() >= cutoff);
}

// Surface narratives that were active in recent history but dropped out today
// — that's the "trends come and go" view. Returns names with their last-seen
// date and total days they ran.
function computeRecentlyEnded(history, activeNarrativeNames, todayIso) {
  const active = new Set(activeNarrativeNames.map((n) => n.toLowerCase()));
  const today = todayIso.slice(0, 10);
  // Build {name -> {firstSeen, lastSeen}} from the (newest-first) history,
  // excluding any that are still active today.
  const seen = new Map();
  for (const snap of history) {
    if (snap.date === today) continue;
    for (const n of snap.narratives) {
      const key = n.name.toLowerCase();
      if (active.has(key)) continue;
      const cur = seen.get(key);
      if (!cur) {
        seen.set(key, { name: n.name, firstSeen: snap.date, lastSeen: snap.date });
      } else {
        if (snap.date < cur.firstSeen) cur.firstSeen = snap.date;
        if (snap.date > cur.lastSeen) cur.lastSeen = snap.date;
      }
    }
  }
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  return Array.from(seen.values())
    .map((e) => ({
      name: e.name,
      lastSeen: e.lastSeen,
      daysSince: Math.max(1, Math.floor((todayMs - new Date(e.lastSeen + "T00:00:00Z").getTime()) / 86400000)),
      ranDays: Math.max(1, Math.floor((new Date(e.lastSeen + "T00:00:00Z").getTime() - new Date(e.firstSeen + "T00:00:00Z").getTime()) / 86400000) + 1),
    }))
    .sort((a, b) => a.daysSince - b.daysSince)
    .slice(0, 8);
}

async function attachMarketNarratives(chains, previousHistory) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY set — skipping market narrative extraction.");
    return { narratives: [], sectorOverviews: {}, recentlyEnded: [], history: previousHistory, macroHeadlines: [] };
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const lastSnapshot = previousHistory[0];
  const previousNames = lastSnapshot ? lastSnapshot.narratives.map((n) => n.name) : [];
  // Macro RSS fetch — independent of the AI rate limiter, runs concurrently
  // with anything the limiter still has queued. The narrative generateContent
  // call will block on acquireAiSlot() if the previous pass's window hasn't
  // fully cleared yet, so we no longer need an explicit pass cooldown here.
  console.log(`Fetching macro headlines across ${MACRO_FEEDS.length} feeds…`);
  const macroHeadlines = await fetchMacroHeadlines();
  console.log(`  · ${macroHeadlines.length} macro headlines retrieved`);
  console.log(`Extracting market narratives across ${Object.keys(chains).length} tickers…`);
  try {
    const raw = await generateMarketNarratives(ai, chains, previousNames, macroHeadlines);
    const builtAtIso = new Date().toISOString();
    const narratives = annotateNarrativesWithLifespan(raw.narratives, previousHistory, builtAtIso);
    const history = updateTrendHistory(previousHistory, narratives, builtAtIso);
    const recentlyEnded = computeRecentlyEnded(history, narratives.map((n) => n.name), builtAtIso);
    const sectorOverviews = raw.sectorOverviews || {};
    console.log(`  ✓ ${narratives.length} narratives extracted across ${Object.keys(sectorOverviews).length} sectors (ordered strongest → weakest)`);
    for (const sec of SECTOR_ORDER) {
      const ov = sectorOverviews[sec];
      if (ov) {
        console.log(`    [${sec}] ${ov.stance.toUpperCase()} · str ${ov.strength} · watchFor=${ov.watchFor.length}`);
      }
    }
    for (const n of narratives) {
      console.log(`    · ${n.name} [str ${n.strength}, ${n.status}, ${n.timeframe}, ${n.sentiment}, conf ${n.confidence}, day ${n.daysRunning}] long=${n.longs.join(",")||"—"} short=${n.shorts.join(",")||"—"}` +
        (n.conflictsWith.length ? ` ⚔ ${n.conflictsWith.join(" | ")}` : ""));
    }
    return { narratives, sectorOverviews, recentlyEnded, history, macroHeadlines };
  } catch (err) {
    const causeMsg = err?.cause?.code || err?.cause?.message || "";
    console.log(
      `  ✗ Narrative extraction failed after retries: ${err.message}` +
      (causeMsg ? ` · cause ${causeMsg}` : ""),
    );
    // Fall back to the last good narratives so the page never shows an empty
    // card from a transient outage. We mark them stale (with staleSinceIso
    // preserved across consecutive failures so the staleness age is honest)
    // and persist them back to trends.json — that way a SECOND failure can
    // still recover them. The history file is intentionally left unchanged:
    // history records what was extracted, not what was displayed.
    const lastGood = await loadLastGoodTrends();
    const lastNarratives = lastGood && Array.isArray(lastGood.narratives) ? lastGood.narratives : [];
    const lastSectorOverviews = lastGood && lastGood.sectorOverviews && typeof lastGood.sectorOverviews === "object"
      ? lastGood.sectorOverviews
      : {};
    if (lastNarratives.length) {
      const todayIso = new Date().toISOString();
      console.log(`  ↩ falling back to ${lastNarratives.length} narratives from last good build (${lastGood.builtAtIso || "unknown"})`);
      const staleNarratives = lastNarratives.map((n) => ({
        ...n,
        stale: true,
        staleSinceIso: n.staleSinceIso || todayIso,
      }));
      // Mark stale on sector overviews too so the banner can signal it.
      const staleOverviews = {};
      for (const k of Object.keys(lastSectorOverviews)) {
        const ov = lastSectorOverviews[k];
        staleOverviews[k] = {
          ...ov,
          stale: true,
          staleSinceIso: ov.staleSinceIso || todayIso,
        };
      }
      return {
        narratives: staleNarratives,
        sectorOverviews: staleOverviews,
        recentlyEnded: Array.isArray(lastGood.recentlyEnded) ? lastGood.recentlyEnded : [],
        history: previousHistory,
        macroHeadlines,
      };
    }
    return { narratives: [], sectorOverviews: {}, recentlyEnded: [], history: previousHistory, macroHeadlines };
  }
}

async function main() {
  console.log("Fetching option chains for", TICKERS.length, "tickers…");
  const chains = await fetchAllTickerChains();
  const got = Object.keys(chains).length;
  const rate = got / TICKERS.length;
  console.log(`Got ${got} / ${TICKERS.length} tickers (${(rate * 100).toFixed(0)}%).`);
  if (rate < MIN_SUCCESS_RATE) {
    throw new Error(
      `Only ${got} / ${TICKERS.length} tickers fetched (need ≥${Math.ceil(MIN_SUCCESS_RATE * TICKERS.length)}). ` +
      `Leaving last-good index.html + data/ in place — GH Pages will keep serving the previous build.`
    );
  }
  await attachAiNewsTakes(chains);
  // No explicit cooldown — acquireAiSlot() is shared across passes, so the
  // first fundamentals request will naturally wait for the news-takes
  // window to drain. Same for the narrative pass that runs next.
  await attachFundamentalsJudgments(chains);
  await attachSocialSentiment(chains);
  // Read trend history + the latest unusual-flow scan BEFORE writeChainFiles
  // wipes data/. Narrative extraction references yesterday's names for
  // continuity; the unusual snapshot is rewritten after the wipe so the page
  // keeps showing it until the next hourly cron runs.
  const previousHistory = await loadTrendHistory();
  const unusual = await loadUnusualFlow();
  const unusualHistory = await loadUnusualHistory();
  const riskFreeRate = await fetchRiskFreeRate();
  const trends = await attachMarketNarratives(chains, previousHistory);
  const symbols = Object.keys(chains).sort();
  const spots = Object.fromEntries(symbols.map((s) => [s, chains[s].spot]));
  const builtAtIso = new Date().toISOString();
  const html = renderHtml({
    symbols,
    builtAt: nyTimestamp(),
    builtAtIso,
    narratives: trends.narratives,
    sectorOverviews: trends.sectorOverviews || {},
    recentlyEnded: trends.recentlyEnded,
    macroHeadlines: trends.macroHeadlines || [],
    unusual,
    spots,
  });
  const css = renderStylesCss();
  const js = renderAppJs({ riskFreeRate });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  await writeFile(resolve(ROOT, "styles.css"), css, "utf8");
  await writeFile(resolve(ROOT, "app.js"), js, "utf8");
  const totalChainBytes = await writeChainFiles(chains);
  await writeTrendFiles({
    narratives: trends.narratives,
    sectorOverviews: trends.sectorOverviews || {},
    recentlyEnded: trends.recentlyEnded,
    macroHeadlines: trends.macroHeadlines || [],
    history: trends.history,
    builtAtIso,
  });
  if (unusual) {
    await writeFile(resolve(DATA_DIR, UNUSUAL_FILE), JSON.stringify(unusual), "utf8");
  }
  if (unusualHistory) {
    await writeFile(resolve(DATA_DIR, UNUSUAL_HISTORY_FILE), JSON.stringify(unusualHistory), "utf8");
  }
  console.log(
    `wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB) + styles.css (${(css.length / 1024).toFixed(1)} KB) + app.js (${(js.length / 1024).toFixed(1)} KB) + ${symbols.length} chain files (${(totalChainBytes / 1024).toFixed(1)} KB total) + trends (${trends.narratives.length} active, ${trends.history.length}-day history)`,
  );
}

async function writeTrendFiles({ narratives, sectorOverviews, recentlyEnded, macroHeadlines, history, builtAtIso }) {
  // writeChainFiles wiped data/ a moment ago, so write into the freshly
  // recreated directory.
  const current = JSON.stringify({ builtAtIso, narratives, sectorOverviews: sectorOverviews || {}, recentlyEnded, macroHeadlines });
  await writeFile(resolve(DATA_DIR, TRENDS_FILE), current, "utf8");
  const archive = JSON.stringify({ builtAtIso, days: NARRATIVE_HISTORY_DAYS, snapshots: history });
  await writeFile(resolve(DATA_DIR, TRENDS_HISTORY_FILE), archive, "utf8");
}

// Only auto-run the full data build when invoked as the entry point. This lets
// sibling tooling import renderStylesCss / renderAppJs to regenerate the
// static assets without triggering the Yahoo + Gemini calls main() makes.
const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

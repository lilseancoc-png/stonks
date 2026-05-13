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
import { fileURLToPath } from "node:url";
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
const TICKERS = [
  // Index & sector ETFs
  "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "USO", "XLF", "XLE", "XLK",
  // Mega-caps
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO",
  // Other tech / semis
  "ORCL", "CRM", "ADBE", "TSM", "MU", "INTC", "DRAM",
  // SaaS / cloud
  "NOW", "SNOW", "NET", "DDOG", "CRWD", "ZS", "MDB", "OKTA", "PANW", "WDAY", "ZM", "DOCU",
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
  USO: "ETF", XLF: "ETF", XLE: "ETF", XLK: "ETF",
  // Mega-caps
  AAPL: "Mega-cap tech", MSFT: "Mega-cap tech", NVDA: "Mega-cap tech",
  AMZN: "Mega-cap tech", GOOGL: "Mega-cap tech", META: "Mega-cap tech",
  TSLA: "Mega-cap tech", AMD: "Semis", NFLX: "Mega-cap tech", AVGO: "Semis",
  // Other tech / semis
  ORCL: "Software", CRM: "Software", ADBE: "Software",
  TSM: "Semis", MU: "Semis", INTC: "Semis", DRAM: "Semis",
  // SaaS / cloud
  NOW: "Software", SNOW: "Software", NET: "Software", DDOG: "Software",
  CRWD: "Software", ZS: "Software", MDB: "Software", OKTA: "Software",
  PANW: "Software", WDAY: "Software", ZM: "Software", DOCU: "Software",
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

function computeTechnicals(bars) {
  if (!bars || bars.length < 27) return null;
  const closes = bars.map((b) => b.c);
  const rsi = computeRSI(closes, 14);
  const macd = computeMACD(closes, 12, 26, 9);
  const sr = computeSupportResistance(bars);
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

  return {
    spot,
    expirations: Object.keys(chains).map(Number).sort((a, b) => a - b),
    chains,
    technicals,
  };
}

async function fetchAllTickerChains() {
  const out = {};
  for (const sym of TICKERS) {
    try {
      out[sym] = await fetchTickerChainWithRetry(sym);
      console.log(`  ✓ ${sym} — spot $${out[sym].spot.toFixed(2)}, ${out[sym].expirations.length} expirations`);
    } catch (err) {
      console.error(`  ✗ ${sym} — ${err.message} (gave up after ${FETCH_RETRIES} attempts)`);
    }
    // Politeness pause between tickers.
    await new Promise((r) => setTimeout(r, 350));
  }
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
  // Card chrome only — the list, accent bars and chips are rendered
  // client-side from the inline manifest in app.js so we don't have to
  // escape narrative text through Node's template literal.
  return `<section class="card" id="narratives-section">
    <header class="card-header">
      <h2 class="card-title">Active market narratives</h2>
      <span class="card-eyebrow" id="narratives-count" aria-live="polite"></span>
    </header>
    <p class="hint">Markets run on stories — AI capex, GLP-1, tariffs, post-election rotations. These are the themes currently driving flows across the curated tickers, refreshed each build. Pick a ticker below to see which narratives it rides.</p>
    <div id="narratives-list" class="narr-list" role="list"></div>
    <div id="narratives-empty" class="narr-empty" hidden>No narratives recorded for this build.</div>
    <div id="narratives-ended" class="narr-ended"></div>
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
    <div id="opt-narr-chips" class="opt-narr-chips" hidden aria-label="Narratives this ticker rides"></div>
    <section id="opt-technicals" class="opt-tech" hidden aria-label="Technical signals for this ticker">
      <header class="opt-tech-head">
        <h3 class="opt-tech-title">Technical signals</h3>
        <span class="opt-tech-sub">Momentum &amp; recent price structure on the daily chart</span>
      </header>
      <div class="opt-tech-grid" id="opt-tech-grid"></div>
      <p class="opt-tech-foot">Indicators are computed at build time from ~6 months of Yahoo daily closes. Use them as context for your option strike pick — they describe the stock, not the contract itself.</p>
    </section>
    <div class="opt-result-wrap">
      <div id="opt-result-sticky" class="opt-result-sticky" hidden></div>
      <div id="opt-eval-result" class="opt-result"></div>
    </div>
  </section>
  <section class="card" id="opt-manual-section">
    <header class="card-header">
      <h2 class="card-title">Grade your own contract</h2>
    </header>
    <p class="hint">Looking at a contract on Robinhood, Schwab, etc.? Paste the numbers straight off the screen — we strip <code>$</code>, <code>%</code>, commas, and the <code>× 55</code> size suffix automatically. IV, OI and volume are optional; without IV we skip the Greeks.</p>
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
  </section>`;
}

// Returns the page runtime as a plain JS string for writing to app.js.
// Loaded via <script src="app.js" defer> — the inline manifest <script> tag
// runs first per HTML parsing order so MANIFEST is always defined.
function renderAppJs() {
  return `// Generated by scripts/build.mjs — do not edit by hand.
(function(){
  // Theme bootstrap. Runs synchronously before the rest of the IIFE binds
  // so we never flash the wrong theme. Respects an explicit saved
  // preference, otherwise mirrors prefers-color-scheme.
  try {
    var saved = localStorage.getItem('stonks-theme');
    var sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', saved || sys);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  var MANIFEST = window.STONKS_MANIFEST || { symbols: [], narratives: [], recentlyEnded: [], sectors: {}, spots: {} };
  var SYMBOLS = Array.isArray(MANIFEST.symbols) ? MANIFEST.symbols : [];
  var NARRATIVES = Array.isArray(MANIFEST.narratives) ? MANIFEST.narratives : [];
  var RECENTLY_ENDED = Array.isArray(MANIFEST.recentlyEnded) ? MANIFEST.recentlyEnded : [];
  var SECTORS = MANIFEST.sectors || {};
  var SPOTS = MANIFEST.spots || {};
  var RFR = 0.045;
  var CHAIN_CACHE = Object.create(null);
  var state = { symbol: null, spot: null, expirations: [], chains: {}, currentExp: null, news: null, technicals: null };
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
      state.symbol = sym;
      loadChain();
    }
  };

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

  // --- Grading ------------------------------------------------------------
  function gradeSpread(spreadPct){
    if (spreadPct <= 5)  return { label:'Tight',    cls:'good', note:'narrow spread — easy fills' };
    if (spreadPct <= 15) return { label:'Moderate', cls:'fair', note:'spread is workable but costs you on entry/exit' };
    return { label:'Wide', cls:'bad', note:'wide spread — illiquid, expect slippage' };
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
    var note = nudged ? '<div class="opt-news-note">This news context shifted the verdict above from <b>Acceptable</b>.</div>' : '';
    return '<div class="opt-news ' + (news.sentiment || 'neutral') + '">' +
      '<div class="opt-news-head">' + heading + '</div>' +
      '<div class="opt-news-body">' + escapeHtml(news.paragraph) + '</div>' +
      note +
    '</div>';
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

    var html = '';
    html += '<div class="opt-verdict ' + verdict.cls + '" id="opt-verdict-main">' + verdict.label + '</div>';
    html += verdictExplainer(verdict.cls);
    html += newsTakeHtml(input.news, input.ticker, verdict.nudged);
    html += '<div class="opt-contract">' + (input.label || '') + ' · spot $' + fmt(input.spot) + ' · ' + daysToExpiry + ' day' + (daysToExpiry === 1 ? '' : 's') + ' to expiry</div>';
    html += '<div class="opt-grid">';
    html += row('Bid / Ask', '$' + fmt(bid) + ' / $' + fmt(ask));
    html += row('Mid', mid != null ? '$' + fmt(mid) : '—');
    html += row('Spread', spread != null ? ('$' + fmt(spread) + ' (' + fmtPct(spreadPct) + ')') : '—', gradeChip(sGrade), TIPS.spread);
    html += row('Intrinsic value', intrinsic != null ? '$' + fmt(intrinsic) : '—', '', TIPS.intrinsic);
    html += row('Time value', extrinsic != null ? '$' + fmt(extrinsic) : '—', mid > 0 && extrinsic != null ? '<span class="opt-row-mute">' + fmtPct(extrinsic / mid * 100) + ' of mid</span>' : '', TIPS.extrinsic);
    html += row('Breakeven at expiry', breakeven != null ? '$' + fmt(breakeven) : '—', input.spot > 0 && breakeven != null ? '<span class="opt-row-mute">' + (((breakeven - input.spot) / input.spot * 100) >= 0 ? '+' : '') + ((breakeven - input.spot) / input.spot * 100).toFixed(2) + '% from spot</span>' : '', TIPS.breakeven);
    html += row('Moneyness', moneynessPct != null ? ((moneynessPct >= 0 ? '+' : '') + moneynessPct.toFixed(2) + '%') : '—', '', TIPS.moneyness);
    html += row('IV', iv != null ? fmtPct(iv*100) : '—', '', TIPS.iv);
    html += row('Delta', g ? fmt(g.delta, 3) : '—', g ? gradeChip(dGrade) : '', TIPS.delta);
    html += row('Prob. ITM (≈ |delta|)', probITM != null ? probITM.toFixed(1) + '%' : '—', '', TIPS.probITM);
    html += row('Theta / day', g ? '$' + fmt(g.thetaDay, 3) : '—', g ? gradeChip(tGrade) : '', TIPS.theta);
    html += row('Gamma', g ? fmt(g.gamma, 4) : '—', '', TIPS.gamma);
    html += row('Vega (per 1 vol pt)', g ? '$' + fmt(g.vega, 3) : '—', '', TIPS.vega);
    html += row('Open interest', input.oi != null ? String(input.oi) : '—');
    html += row('Volume', input.volume != null ? String(input.volume) : '—');
    html += '</div>';
    html += '<ul class="opt-notes">';
    html += '<li><b>Spread:</b> ' + sGrade.note + '.</li>';
    html += '<li><b>Delta:</b> ' + dGrade.note + '.</li>';
    html += '<li><b>Theta:</b> ' + tGrade.note + '.</li>';
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
      html += '<button type="button" class="opt-tweak-btn" data-tweak=\\'' + payload + '\\'>Tweak in manual form &darr;</button>';
    }
    var disc = input.source === 'manual'
      ? 'Greeks computed locally with Black-Scholes from your IV and a ' + (RFR*100).toFixed(1) + '% risk-free rate. You are the data source — only as accurate as the numbers you typed.'
      : 'Greeks computed with Black-Scholes from Yahoo&apos;s implied vol and a ' + (RFR*100).toFixed(1) + '% risk-free rate. Quotes are end-of-session as of the build timestamp shown above — for information only, not investment advice.';
    html += '<p class="opt-disclaimer">' + disc + '</p>';
    return { html: html, verdict: verdict, contractLabel: input.label || '' };
  }

  function renderStickyVerdict(verdict, label){
    var bar = $('opt-result-sticky');
    if (!bar) return;
    bar.innerHTML = '<span class="opt-verdict-mini ' + verdict.cls + '">' + verdict.label + '</span>' +
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
      news: state.news, ticker: state.symbol
    });
    resultEl.innerHTML = built.html;
    renderStickyVerdict(built.verdict, built.contractLabel);
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

    var expEpoch = Math.floor(new Date(expDateStr + 'T16:00:00-04:00').getTime()/1000);
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
    setStatus('opt-eval-status', cached ? '' : 'Loading ' + symbol + ' chain, news + technicals…', '');
    fetchChain(symbol).then(function(entry){
      state.spot = entry.spot;
      state.expirations = (entry.expirations || []).slice();
      state.chains = entry.chains || {};
      state.news = entry.news || null;
      state.technicals = entry.technicals || null;
      if (!state.expirations.length){ setStatus('opt-eval-status', 'No expirations for ' + symbol + '.', 'err'); return; }
      state.currentExp = state.expirations[0];
      populateExpiry();
      $('opt-expiry').value = String(state.currentExp);
      populateStrikes();
      $('opt-chain-row').hidden = false;
      renderTickerNarrativeChips(symbol);
      renderTechnicals(symbol);
      setStatus('opt-eval-status', symbol + ' · spot ' + fmtMoney(state.spot) + ' · ' + state.expirations.length + ' expirations', 'ok');
      evaluate();
    }).catch(function(err){
      setStatus('opt-eval-status', 'Failed to load ' + symbol + ': ' + (err && err.message || err), 'err');
    });
  }

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
  function onExpiryChange(){
    var exp = Number($('opt-expiry').value);
    state.currentExp = exp;
    populateStrikes();
    scheduleEvaluate();
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
  function renderNarratives(){
    var list = $('narratives-list');
    var empty = $('narratives-empty');
    var ended = $('narratives-ended');
    var count = $('narratives-count');
    if (!list) return;
    if (count) count.textContent = NARRATIVES.length ? NARRATIVES.length + ' active' : '';
    if (!NARRATIVES.length){
      list.innerHTML = '';
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      list.innerHTML = NARRATIVES.map(function(n){
        var sent = n.sentiment === 'bearish' ? 'bearish' : 'bullish';
        var confLabel = ({ high:'High', medium:'Medium', low:'Low' })[n.confidence] || 'Medium';
        var longChips = (n.longs || []).map(function(t){ return tickerChipHtml(t, 'long'); }).join('');
        var shortChips = (n.shorts || []).map(function(t){ return tickerChipHtml(t, 'short'); }).join('');
        var longRow = longChips ? '<div class="narr-side-row long"><span class="narr-side-label">Long</span>' + longChips + '</div>' : '';
        var shortRow = shortChips ? '<div class="narr-side-row short"><span class="narr-side-label">Short</span>' + shortChips + '</div>' : '';
        return '<article class="narr" data-sent="' + sent + '" role="listitem">' +
          '<span class="narr-accent" aria-hidden="true"></span>' +
          '<header class="narr-head">' +
            '<h3 class="narr-name">' + escapeHtml(n.name) + '</h3>' +
            '<span class="narr-tag sent ' + sent + '">' + (sent === 'bullish' ? 'Bullish' : 'Bearish') + '</span>' +
            '<span class="narr-tag conf">Conf · ' + confLabel + '</span>' +
            '<span class="narr-life"><span class="narr-life-dot"></span>' + escapeHtml(narrLifeLabel(n)) + '</span>' +
          '</header>' +
          '<p class="narr-thesis">' + escapeHtml(n.thesis || '') + '</p>' +
          longRow + shortRow +
        '</article>';
      }).join('');
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

  // --- Bind ---------------------------------------------------------------
  function bind(){
    renderFreshness();
    bindThemeToggle();
    combo.init();
    renderNarratives();

    var radioGroup = document.querySelector('[role="radiogroup"]');
    if (radioGroup){
      radioGroup.addEventListener('change', function(ev){
        if (ev.target && ev.target.name === 'opt-type'){
          if (state.currentExp) populateStrikes();
          scheduleEvaluate();
        }
      });
    }
    var expSel = $('opt-expiry');
    if (expSel) expSel.addEventListener('change', onExpiryChange);
    var strikeSel = $('opt-strike');
    if (strikeSel) strikeSel.addEventListener('change', scheduleEvaluate);

    var manualForm = $('opt-manual-form');
    if (manualForm){
      manualForm.addEventListener('submit', evaluateManual);
      var paste = $('m-paste');
      if (paste) paste.addEventListener('input', onPasteContract);
      var chainSection = $('opt-eval-section');
      if (chainSection){
        chainSection.addEventListener('click', function(ev){
          var btn = ev.target.closest && ev.target.closest('.opt-tweak-btn');
          if (!btn) return;
          tweakInManual(btn.getAttribute('data-tweak'));
        });
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
`;
}

function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], recentlyEnded = [], spots = {} }) {
  const tickerCount = symbols.length;
  // Manifest is embedded inline so the narratives card + combobox can paint
  // on first frame. Per-ticker chain JSON is still lazy-fetched from
  // data/<SYMBOL>.json on demand.
  const manifestPayload = JSON.stringify({
    builtAt,
    builtAtIso,
    symbols,
    narratives,
    recentlyEnded,
    sectors: SECTORS,
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
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
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
<p class="page-sub">Grade a single options contract on spread, delta, and theta — ${tickerCount} curated tickers refreshed daily. Watch the market narratives currently driving them.</p>
<div id="freshness-banner" class="freshness" data-built-at="${builtAtIso}" role="status" aria-live="polite">
  <span class="freshness-dot" aria-hidden="true"></span>
  <span id="freshness-text">Built ${builtAt} (NY) · end-of-session quotes from Yahoo</span>
</div>
<main>
  ${narrativesSection()}
  ${optionEvalSection()}
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
function renderStylesCss() {
  return `/* Generated by scripts/build.mjs — do not edit by hand. */
:root {
  --bg:#f7f8fa;
  --surface:#ffffff;
  --surface-2:#f1f3f7;
  --surface-3:#e7eaf0;
  --border:#e2e6ed;
  --border-strong:#cdd3dd;
  --text:#0f172a;
  --text-strong:#0a0f1a;
  --muted:#5f6877;
  --accent:#1f6feb;
  --accent-soft:rgba(31,111,235,0.10);
  --pos:#15803d;
  --pos-soft:rgba(21,128,61,0.10);
  --neg:#b91c1c;
  --neg-soft:rgba(185,28,28,0.10);
  --warn:#b45309;
  --warn-soft:rgba(180,83,9,0.12);
  --shadow-sm:0 1px 2px rgba(15,23,42,0.06), 0 1px 1px rgba(15,23,42,0.04);
  --shadow-md:0 6px 16px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04);
  --shadow-lg:0 18px 40px rgba(15,23,42,0.10), 0 6px 12px rgba(15,23,42,0.05);
  --r-1:4px; --r-2:8px; --r-3:12px; --r-4:16px; --r-pill:999px;
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px; --s-8:64px;
  --fs-xs:12px; --fs-sm:13px; --fs-md:14px; --fs-lg:16px; --fs-xl:20px; --fs-2xl:28px; --fs-3xl:36px;
  --focus-ring:0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
  color-scheme:light;
}
:root[data-theme="dark"] {
  --bg:#0a0d14;
  --surface:#11151e;
  --surface-2:#161b27;
  --surface-3:#1d2331;
  --border:#222a3a;
  --border-strong:#2e384c;
  --text:#e6ebf5;
  --text-strong:#ffffff;
  --muted:#8b96ac;
  --accent:#6ea8ff;
  --accent-soft:rgba(110,168,255,0.16);
  --pos:#34d399;
  --pos-soft:rgba(52,211,153,0.16);
  --neg:#f87171;
  --neg-soft:rgba(248,113,113,0.16);
  --warn:#fbbf24;
  --warn-soft:rgba(251,191,36,0.16);
  --shadow-sm:0 1px 2px rgba(0,0,0,0.5);
  --shadow-md:0 6px 18px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
  --shadow-lg:0 24px 48px rgba(0,0,0,0.6), 0 6px 14px rgba(0,0,0,0.35);
  --focus-ring:0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
  color-scheme:dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: var(--fs-md)/1.55 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
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
  color: var(--muted); font-size: var(--fs-md);
}

main {
  max-width: 760px; margin: 0 auto;
  padding: var(--s-3) var(--s-5) var(--s-7);
}

.site-footer {
  max-width: 960px;
  margin: var(--s-6) auto 0;
  padding: var(--s-5) var(--s-5) var(--s-7);
  color: var(--muted); font-size: var(--fs-xs);
  display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: space-between;
  border-top: 1px solid var(--border);
}
.site-footer .muted { color: var(--muted); }

/* === Freshness banner === */
.freshness {
  max-width: 760px;
  margin: 0 var(--s-5) var(--s-4);
  padding: var(--s-2) var(--s-4);
  border-radius: var(--r-3);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--text);
  font-size: var(--fs-sm);
  display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap;
}
@media (min-width: 800px){ .freshness { margin-left: auto; margin-right: auto; } }
.freshness .freshness-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent); flex: 0 0 8px;
}
.freshness.warn { background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.freshness.warn .freshness-dot { background: var(--warn); }
.freshness.bad  { background: var(--neg-soft);  border-color: color-mix(in srgb, var(--neg) 40%, transparent); }
.freshness.bad .freshness-dot { background: var(--neg); }
.freshness-detail { color: var(--muted); }

/* === Cards === */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-4);
  padding: var(--s-5);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--s-4);
}
.card-header {
  display: flex; align-items: baseline; gap: var(--s-3);
  margin-bottom: var(--s-1);
}
.card-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-strong);
}
.card-eyebrow {
  font-size: var(--fs-xs); color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.hint {
  margin: 0 0 var(--s-4);
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.55;
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
}
.opt-status.err { color: var(--neg); }
.opt-status.ok  { color: var(--pos); }

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
.opt-row-mute {
  color: var(--muted); font-size: 11px; margin-left: 6px;
  font-weight: 500;
}

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
  margin: var(--s-2) 0 var(--s-1);
  background: transparent; color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: var(--r-2);
  padding: 8px 14px;
  font: inherit; font-size: var(--fs-sm); font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.opt-tweak-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

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
const AI_NEWS_COUNT = 6;
// Free-tier Gemma 4 26B caps at 15 RPM / 1.5K RPD. We stagger request *starts*
// 4500ms apart (~13.3 RPM, safety margin under 15) and run requests
// concurrently — call latency overlaps the pacing window instead of being
// added to it, finishing ~65 tickers in ~4.9 minutes.
const AI_START_INTERVAL_MS = 4500;
// Google's free tier intermittently returns 500 INTERNAL on otherwise valid
// requests, and 429 RESOURCE_EXHAUSTED when a per-minute window edges over
// the quota despite our pacing. Retry transient 5xx and 429, honouring the
// "Please retry in Xs" hint the API surfaces for rate-limit errors.
const AI_MAX_ATTEMPTS = 4;
const AI_RETRY_BACKOFF_MS = [2000, 5000, 15000];
// Buffer to leave between the per-ticker pass finishing and the narrative
// extraction call firing — otherwise the narrative call lands inside the
// same 60s window as the tail of the per-ticker burst and can push us over
// the 15 RPM quota.
const AI_NARRATIVE_COOLDOWN_MS = 8000;

// Classify a Gemini/Gemma error as transient and return the backoff (ms) the
// caller should wait before retrying, or null if the error isn't transient.
// 429s carry a "Please retry in 14.6985s" hint we should respect — otherwise
// we'd retry into the same rate-limit window and burn an attempt.
function classifyAiError(err, attempt) {
  const msg = String(err?.message || "");
  const is429 = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(msg);
  const is5xx = /\b(500|503|504|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED)\b/i.test(msg);
  if (!is429 && !is5xx) return null;
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

async function fetchTickerHeadlines(symbol) {
  try {
    const res = await yahooFinance.search(symbol, {
      newsCount: AI_NEWS_COUNT,
      quotesCount: 0,
      enableFuzzyQuery: false,
    });
    const items = Array.isArray(res?.news) ? res.news : [];
    return items
      .map((n) => ({
        title: (n.title || "").trim(),
        publisher: (n.publisher || "").trim(),
        publishedAt: n.providerPublishTime
          ? new Date(n.providerPublishTime instanceof Date ? n.providerPublishTime : n.providerPublishTime * 1000).toISOString()
          : null,
      }))
      .filter((n) => n.title.length > 0)
      .slice(0, AI_NEWS_COUNT);
  } catch (err) {
    console.log(`    ⚠ ${symbol} headline fetch failed: ${err.message}`);
    return [];
  }
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
  return {
    paragraph: String(parsed.paragraph || "").trim(),
    sentiment: parsed.sentiment,
    headlines: headlines.map((h) => h.title),
    builtAt: new Date().toISOString(),
  };
}

async function attachAiNewsTakes(chains) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY set — skipping AI news takes. Chain data will still build.");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const entries = Object.entries(chains);
  console.log(`Generating AI news takes for ${entries.length} tickers…`);
  const tasks = entries.map(([sym, data], i) => (async () => {
    if (i > 0) await new Promise((r) => setTimeout(r, i * AI_START_INTERVAL_MS));
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

// Trend tracking — markets run on stories (AI capex, GLP-1 obesity, tariffs,
// election plays, etc.) and those stories rotate. After per-ticker news takes
// are generated, this step asks the model to look across every ticker's
// summary + top headlines, extract the active narratives currently driving
// capital, and tag each narrative with the LONG and SHORT tickers from our
// curated list that ride it. Output is persisted in data/trends.json (latest)
// + data/trends-history.json (rolling 90-day window of compact daily snapshots
// so the page can show "X days running" / "trend cooled off N days ago").
const NARRATIVE_HISTORY_DAYS = 90;
const NARRATIVE_MAX_COUNT = 10;
const NARRATIVE_SYSTEM_PROMPT =
  "You are a markets analyst who tracks the narratives currently driving US equity flows. " +
  "Markets run on stories — AI capex, GLP-1 obesity drugs, tariff fights, the crypto trade, " +
  "post-election rotations, defense plays around geopolitics, etc. Narratives come and go. " +
  "Given a snapshot of recent news takes for a curated list of US-listed tickers, identify the " +
  `4-${NARRATIVE_MAX_COUNT} most active market narratives RIGHT NOW. For each narrative, return: ` +
  `a short "name" (2-5 words, title case, e.g. "AI infrastructure buildout", "GLP-1 obesity wave"); ` +
  `a one-sentence "thesis" in plain English explaining the trade and why it is live now; ` +
  `a "sentiment" of "bullish" or "bearish" describing whether the narrative is a tailwind or headwind for the longs; ` +
  `a "longs" array of tickers from the provided list that benefit from the narrative; ` +
  `a "shorts" array of tickers from the provided list that are hurt by it (empty array if none apply); ` +
  `a "confidence" of "high", "medium", or "low" based on how clearly the headlines support the trade. ` +
  "Rules: only use tickers from the provided list — do not invent tickers. A narrative MUST have at " +
  "least one long or one short. Prefer broader narratives over very narrow single-name stories. If a " +
  "list of PREVIOUS narrative names is provided, reuse a previous name verbatim when today's narrative " +
  "is the same story so we can track its lifespan; otherwise pick a fresh name. " +
  "Respond with ONLY a JSON object of the form " +
  `{"narratives":[{"name":"...","thesis":"...","sentiment":"bullish"|"bearish","longs":["..."],"shorts":["..."],"confidence":"high"|"medium"|"low"}]} ` +
  "— no markdown fences, no prose before or after the JSON.";

const TRENDS_FILE = "trends.json";
const TRENDS_HISTORY_FILE = "trends-history.json";

async function loadTrendHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, TRENDS_HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

function buildNarrativeUserMessage(chains, previousNames) {
  const lines = Object.entries(chains).map(([sym, data]) => {
    const news = data.news;
    const sentiment = news?.sentiment || "unknown";
    const summary = (news?.paragraph || "").replace(/\s+/g, " ").trim();
    const topHeadline = Array.isArray(news?.headlines) && news.headlines.length
      ? news.headlines[0].replace(/\s+/g, " ").trim()
      : "";
    // Trim each ticker block so the combined prompt stays well under the
    // model's context — Gemma 4 26B has plenty of room but we send ~65 of these.
    const summaryClip = summary.length > 260 ? summary.slice(0, 257) + "…" : summary;
    const headlineClip = topHeadline.length > 140 ? topHeadline.slice(0, 137) + "…" : topHeadline;
    return `- ${sym} [${sentiment}] ${summaryClip}` + (headlineClip ? ` Headline: "${headlineClip}"` : "");
  });
  const previousBlock = previousNames.length
    ? `Previous narrative names from the last build (reuse verbatim when the same story is still live):\n${previousNames.map((n) => `- ${n}`).join("\n")}`
    : "No previous narratives recorded.";
  return (
    `Tickers in scope: ${Object.keys(chains).join(", ")}\n\n` +
    `${previousBlock}\n\n` +
    `Recent news takes:\n${lines.join("\n")}`
  );
}

async function generateMarketNarratives(ai, chains, previousNames) {
  const userMessage = buildNarrativeUserMessage(chains, previousNames);
  let response;
  let lastErr;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: AI_MODEL,
        contents: `${NARRATIVE_SYSTEM_PROMPT}\n\n${userMessage}`,
        config: {
          temperature: 0.4,
          maxOutputTokens: 2400,
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
  const validSymbols = new Set(Object.keys(chains));
  const sanitizeTickers = (arr) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr
          .map((s) => String(s || "").toUpperCase().trim())
          .filter((s) => validSymbols.has(s))))
      : [];
  const narratives = Array.isArray(parsed.narratives) ? parsed.narratives : [];
  return narratives
    .map((n) => {
      const name = String(n.name || "").trim();
      const thesis = String(n.thesis || "").trim();
      const sentiment = n.sentiment === "bearish" ? "bearish" : "bullish";
      const confidence = ["high", "medium", "low"].includes(n.confidence) ? n.confidence : "medium";
      const longs = sanitizeTickers(n.longs);
      const shorts = sanitizeTickers(n.shorts);
      return { name, thesis, sentiment, confidence, longs, shorts };
    })
    .filter((n) => n.name && n.thesis && (n.longs.length > 0 || n.shorts.length > 0))
    .slice(0, NARRATIVE_MAX_COUNT);
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
  // continuity and a "trends that came and went" view. Drop thesis/confidence
  // to keep the history file small.
  const snapshot = {
    date,
    builtAtIso: todayIso,
    narratives: narratives.map((n) => ({
      name: n.name,
      sentiment: n.sentiment,
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
    return { narratives: [], recentlyEnded: [], history: previousHistory };
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const lastSnapshot = previousHistory[0];
  const previousNames = lastSnapshot ? lastSnapshot.narratives.map((n) => n.name) : [];
  // Let the per-ticker pass's 60s rate-limit window clear before firing the
  // narrative call — otherwise this one call lands inside the tail of the
  // previous burst and pushes the project over 15 RPM.
  await new Promise((r) => setTimeout(r, AI_NARRATIVE_COOLDOWN_MS));
  console.log(`Extracting market narratives across ${Object.keys(chains).length} tickers…`);
  try {
    const raw = await generateMarketNarratives(ai, chains, previousNames);
    const builtAtIso = new Date().toISOString();
    const narratives = annotateNarrativesWithLifespan(raw, previousHistory, builtAtIso);
    const history = updateTrendHistory(previousHistory, narratives, builtAtIso);
    const recentlyEnded = computeRecentlyEnded(history, narratives.map((n) => n.name), builtAtIso);
    console.log(`  ✓ ${narratives.length} narratives extracted`);
    for (const n of narratives) {
      console.log(`    · ${n.name} [${n.sentiment}, ${n.confidence}, day ${n.daysRunning}] long=${n.longs.join(",")||"—"} short=${n.shorts.join(",")||"—"}`);
    }
    return { narratives, recentlyEnded, history };
  } catch (err) {
    console.log(`  ✗ Narrative extraction failed: ${err.message}`);
    // Don't drop the existing history just because today's extraction failed.
    return { narratives: [], recentlyEnded: [], history: previousHistory };
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
  // Read trend history BEFORE writeChainFiles wipes data/. Then narrative
  // extraction can reference yesterday's names for continuity, and the
  // history file is rewritten alongside the chains afterward.
  const previousHistory = await loadTrendHistory();
  const trends = await attachMarketNarratives(chains, previousHistory);
  const symbols = Object.keys(chains).sort();
  const spots = Object.fromEntries(symbols.map((s) => [s, chains[s].spot]));
  const builtAtIso = new Date().toISOString();
  const html = renderHtml({
    symbols,
    builtAt: nyTimestamp(),
    builtAtIso,
    narratives: trends.narratives,
    recentlyEnded: trends.recentlyEnded,
    spots,
  });
  const css = renderStylesCss();
  const js = renderAppJs();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  await writeFile(resolve(ROOT, "styles.css"), css, "utf8");
  await writeFile(resolve(ROOT, "app.js"), js, "utf8");
  const totalChainBytes = await writeChainFiles(chains);
  await writeTrendFiles({
    narratives: trends.narratives,
    recentlyEnded: trends.recentlyEnded,
    history: trends.history,
    builtAtIso,
  });
  console.log(
    `wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB) + styles.css (${(css.length / 1024).toFixed(1)} KB) + app.js (${(js.length / 1024).toFixed(1)} KB) + ${symbols.length} chain files (${(totalChainBytes / 1024).toFixed(1)} KB total) + trends (${trends.narratives.length} active, ${trends.history.length}-day history)`,
  );
}

async function writeTrendFiles({ narratives, recentlyEnded, history, builtAtIso }) {
  // writeChainFiles wiped data/ a moment ago, so write into the freshly
  // recreated directory.
  const current = JSON.stringify({ builtAtIso, narratives, recentlyEnded });
  await writeFile(resolve(DATA_DIR, TRENDS_FILE), current, "utf8");
  const archive = JSON.stringify({ builtAtIso, days: NARRATIVE_HISTORY_DAYS, snapshots: history });
  await writeFile(resolve(DATA_DIR, TRENDS_HISTORY_FILE), archive, "utf8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

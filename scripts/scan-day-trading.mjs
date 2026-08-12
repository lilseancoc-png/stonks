// Owner-only Quant Lab Day Trading Engine runner.
//
// A cheap intraday pass: one batched underlying-quote sweep plus two 5-minute
// index charts. It writes data/day-trading.json + data/day-trading-history.json and never
// submits an order. The workflow runs it every 15 minutes during the ET session.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YahooFinance from "yahoo-finance2";
import {
  DAY_TRADING_RULES,
  emptyDayTradingHistory,
  etClock,
  runDayTradingEngine,
} from "../lib/day-trading-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const STATE_FILE = "day-trading.json";
const HISTORY_FILE = "day-trading-history.json";
const QUOTE_BATCH = 120;
const CANDIDATE_LIMIT = 14;
const MAJOR_REPORTS = new Set([
  "nfp", "unrate", "jolts", "cpi-mom", "cpi-yoy", "core-cpi-mom",
  "core-cpi-yoy", "ppi-mom", "ism-mfg", "gdp-final", "core-pce-mom",
]);

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

const round = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return null;
  const k = 10 ** digits;
  return Math.round(Number(value) * k) / k;
};

async function readJson(key, fallback = null) {
  try { return JSON.parse(await readFile(resolve(DATA_DIR, key), "utf8")); }
  catch { return fallback; }
}

async function withTimeout(promise, label, ms = 15_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchQuotes(symbols) {
  const rows = [];
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH);
    const result = await withTimeout(yahooFinance.quote(batch, {
      fields: [
        "regularMarketPrice", "regularMarketPreviousClose", "regularMarketChangePercent",
        "regularMarketVolume", "regularMarketDayHigh", "regularMarketDayLow", "marketState",
        "preMarketPrice", "postMarketPrice",
      ],
    }), `quotes(${batch.length})`);
    for (const row of (Array.isArray(result) ? result : result ? [result] : [])) {
      const spot = row.regularMarketPrice ?? row.postMarketPrice ?? row.preMarketPrice;
      if (!(spot > 0) || !row.symbol) continue;
      const prevClose = row.regularMarketPreviousClose ?? null;
      const changePct = row.regularMarketPrice == null && prevClose > 0
        ? ((spot / prevClose) - 1) * 100
        : row.regularMarketChangePercent ?? null;
      rows.push({
        symbol: row.symbol, spot, prevClose, changePct,
        volume: row.regularMarketVolume ?? null,
        dayHigh: row.regularMarketDayHigh ?? null,
        dayLow: row.regularMarketDayLow ?? null,
        marketState: row.marketState ?? null,
      });
    }
  }
  return rows;
}

function barEtParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  return { date: `${p.year}-${p.month}-${p.day}`, minute: hour * 60 + Number(p.minute) };
}

async function openingRange(symbol, now) {
  try {
    const result = await withTimeout(yahooFinance.chart(symbol, {
      period1: new Date(now.getTime() - 3 * 86400_000),
      period2: now,
      interval: "5m",
    }), `chart(${symbol})`);
    const today = etClock(now).date;
    const allBars = (result?.quotes || []).map((bar) => ({ ...bar, et: barEtParts(bar.date) }))
      .filter((bar) => bar.et?.date === today && bar.et.minute >= 570 && bar.et.minute < 960)
      .sort((a, b) => a.et.minute - b.et.minute);
    const bars = allBars.filter((bar) => bar.et.minute < DAY_TRADING_RULES.entryStartEtMin);
    if (!bars.length) return null;
    const summarize = (rows) => {
      if (!rows.length) return null;
      const open = Number(rows[0].open); const close = Number(rows.at(-1).close);
      const highs = rows.map((bar) => Number(bar.high)).filter(Number.isFinite);
      const lows = rows.map((bar) => Number(bar.low)).filter(Number.isFinite);
      return {
        open: round(open), close: round(close), high: highs.length ? round(Math.max(...highs)) : null,
        low: lows.length ? round(Math.min(...lows)) : null,
        retPct: open > 0 && close > 0 ? round(((close / open) - 1) * 100, 2) : null,
        bars: rows.length,
      };
    };
    return { ...summarize(bars), lastHour: summarize(allBars.filter((bar) => bar.et.minute >= 900)) };
  } catch (err) {
    console.log(`  · ${symbol} opening range unavailable: ${err.message}`);
    return null;
  }
}

function priorIndexContext(indexCalendar, today) {
  const days = (indexCalendar?.days || []).filter((row) => row?.date < today).slice(-3);
  const vals = [];
  for (const day of days) {
    if (Number.isFinite(Number(day?.spy?.chPct))) vals.push(Number(day.spy.chPct));
    if (Number.isFinite(Number(day?.qqq?.chPct))) vals.push(Number(day.qqq.chPct));
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function parseEventMinute(raw) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i.exec(String(raw || "").trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ap = String(match[3] || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function eventGate(calendar, clock) {
  const today = (calendar?.events || []).filter((event) => event?.date === clock.date);
  const high = today.filter((event) =>
    (event.type === "report" && MAJOR_REPORTS.has(event.subtype)) ||
    (event.type === "fed" && /fomc|rate decision|minutes|chair/i.test(String(event.title || ""))),
  );
  for (const event of high) {
    const minute = parseEventMinute(event.time);
    if (minute != null && clock.minute >= minute - 45 && clock.minute <= minute + 30) {
      return { block: true, reduce: true, reason: `${event.title || "high-impact event"} window`, events: high.map((row) => row.title) };
    }
  }
  return {
    block: false,
    reduce: high.length > 0,
    reason: high.length ? "high-impact event day" : null,
    events: high.map((row) => row.title),
  };
}

function buildMarket({ now, quoteMap, firstHour, indexCalendar, calendar, macro, marketAnalysis, oi }) {
  const clock = etClock(now);
  const spy = quoteMap.get("SPY");
  const qqq = quoteMap.get("QQQ");
  const marketOpen = [spy?.marketState, qqq?.marketState].some((state) => state === "REGULAR");
  const moves = [spy?.changePct, qqq?.changePct].filter(Number.isFinite);
  const liveAvg = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0;
  const fhVals = [firstHour.spy?.retPct, firstHour.qqq?.retPct].filter(Number.isFinite);
  const fhAvg = fhVals.length ? fhVals.reduce((a, b) => a + b, 0) / fhVals.length : 0;
  const analysisState = marketAnalysis?.macroRegime?.state || "neutral";
  const analysisTilt = analysisState === "risk-on" ? 0.25
    : analysisState === "risk-off" ? -0.25
      : analysisState === "severe-risk-off" ? -0.5 : 0;
  const biasScore = liveAvg * 0.6 + fhAvg * 0.3 + analysisTilt;
  const bias = biasScore >= 0.25 ? "long" : biasScore <= -0.25 ? "short" : "neutral";
  const vix = Number(macro?.vix?.value);
  const vixTerm = macro?.vixTerm?.state || null;
  const volState = vix >= 30 ? "crisis" : vix >= 25 ? "high" : vix >= 18 ? "normal" : Number.isFinite(vix) ? "low" : "unknown";
  const event = eventGate(calendar, clock);
  const sizeMultiplier = (volState === "crisis" ? 0.5 : volState === "high" ? 0.7 : 1) * (event.reduce ? 0.5 : 1);
  const indexGex = (oi?.tickers || []).find((row) => row.symbol === "SPY") || null;
  return {
    clock,
    bias,
    marketOpen,
    biasScore: round(biasScore, 2),
    analysisState,
    liveIndexPct: round(liveAvg, 2),
    priorContextPct: round(priorIndexContext(indexCalendar, clock.date), 2),
    firstHour: {
      complete: clock.minute >= DAY_TRADING_RULES.entryStartEtMin &&
        Number(firstHour.spy?.bars || 0) >= 6 && Number(firstHour.qqq?.bars || 0) >= 6,
      spyRetPct: firstHour.spy?.retPct ?? null,
      qqqRetPct: firstHour.qqq?.retPct ?? null,
      spyHigh: firstHour.spy?.high ?? null,
      spyLow: firstHour.spy?.low ?? null,
      qqqHigh: firstHour.qqq?.high ?? null,
      qqqLow: firstHour.qqq?.low ?? null,
    },
    lastHour: {
      active: clock.minute >= 15 * 60,
      entriesAllowed: clock.minute < DAY_TRADING_RULES.forceFlatEtMin,
      spyRetPct: firstHour.spy?.lastHour?.retPct ?? null,
      qqqRetPct: firstHour.qqq?.lastHour?.retPct ?? null,
    },
    volatility: { vix: Number.isFinite(vix) ? round(vix, 2) : null, state: volState, term: vixTerm },
    event,
    indexGex: indexGex ? { callWall: indexGex.callWall, putWall: indexGex.putWall, score: indexGex.score } : null,
    sizeMultiplier: round(sizeMultiplier, 2),
    thresholdAdd: (volState === "crisis" ? 10 : volState === "high" ? 5 : 0) + (event.reduce ? 5 : 0),
  };
}

function atrFromPriceSeries(payload) {
  const ps = payload?.priceSeries;
  if (!ps || !Array.isArray(ps.c) || !Array.isArray(ps.h) || !Array.isArray(ps.l)) return null;
  const start = Math.max(1, ps.c.length - 15);
  const trs = [];
  for (let i = start; i < ps.c.length; i++) {
    const high = Number(ps.h[i]); const low = Number(ps.l[i]); const prev = Number(ps.c[i - 1]);
    if (![high, low, prev].every(Number.isFinite)) continue;
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
}

function latestVolumeSignal(row, quote) {
  const hits = Array.isArray(row?.bucketHits) ? row.bucketHits : [];
  const latest = hits.slice().sort((a, b) => String(b.scannedAt || "").localeCompare(String(a.scannedAt || "")))[0] || null;
  const fallback = Number(row?.avg20) > 0 && Number(quote?.volume) > 0 ? quote.volume / row.avg20 : 0;
  return {
    ratio: Number(latest?.volRatio) || Number(row?.eod?.ratio) || fallback,
    srBreak: latest?.srBreak || null,
    movePct: Number(latest?.priceMovePct ?? quote?.changePct) || 0,
  };
}

function candidateDirection({ signal, grade, technicals, market }) {
  let vote = 0;
  if (signal.srBreak?.type === "upper") vote += 3;
  if (signal.srBreak?.type === "lower") vote -= 3;
  vote += Math.sign(signal.movePct) * Math.min(2, Math.abs(signal.movePct) / 0.75);
  vote += Math.sign(Number(grade?.total || 0)) * Math.min(2, Math.abs(Number(grade?.total || 0)) / 8);
  vote += Math.sign(Number(technicals?.macd?.hist || 0)) * 0.75;
  if (Math.abs(vote) < 1.5 && market.bias !== "neutral") vote += market.bias === "long" ? 1 : -1;
  return vote >= 1.5 ? "long" : vote <= -1.5 ? "short" : null;
}

async function main() {
  const now = process.env.DAY_TRADING_NOW ? new Date(process.env.DAY_TRADING_NOW) : new Date();
  const clock = etClock(now);
  console.log(`Day Trading Engine ${now.toISOString()} (${clock.date}, ${clock.minute} ET minute)`);

  const [heatmap, volumeFlags, grades, indexCalendar, calendar, macro, marketAnalysis, oi, priorHistory] = await Promise.all([
    readJson("heatmap.json", { tickers: [] }),
    readJson("volume-flags.json", { tickers: [] }),
    readJson("grades.json", { grades: {} }),
    readJson("index-calendar.json", { days: [] }),
    readJson("calendar.json", { events: [] }),
    readJson("macro.json", {}),
    readJson("market-analysis.json", {}),
    readJson("oi-tracker.json", { tickers: [] }),
    readJson(HISTORY_FILE, emptyDayTradingHistory()),
  ]);
  const symbols = [...new Set((heatmap?.tickers || []).map((row) => row.t).filter(Boolean))];
  if (!symbols.length) throw new Error("no ticker universe available (heatmap.json missing/empty)");
  const quotes = await fetchQuotes(symbols);
  if (quotes.length < Math.max(10, Math.ceil(symbols.length * 0.5))) throw new Error(`systemic quote failure: ${quotes.length}/${symbols.length}`);
  const quoteMap = new Map(quotes.map((row) => [row.symbol, row]));
  const [spyRange, qqqRange] = await Promise.all([openingRange("SPY", now), openingRange("QQQ", now)]);
  const market = buildMarket({
    now, quoteMap, firstHour: { spy: spyRange, qqq: qqqRange }, indexCalendar, calendar, macro, marketAnalysis, oi,
  });

  const heatmapBySymbol = new Map((heatmap?.tickers || []).map((row) => [row.t, row]));
  const oiBySymbol = new Map((oi?.tickers || []).map((row) => [row.symbol, row]));
  const volumeRows = (volumeFlags?.tickers || []).map((row) => {
    const quote = quoteMap.get(row.symbol);
    const signal = latestVolumeSignal(row, quote);
    return { row, quote, signal, rank: signal.ratio + (signal.srBreak ? 2 : 0) + Math.min(2, Math.abs(signal.movePct) / 2) };
  }).filter((row) => row.quote && row.signal.ratio >= 1.15)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, CANDIDATE_LIMIT * 2);

  const candidates = [];
  for (const item of volumeRows) {
    const payload = await readJson(`${item.row.symbol}.json`, null);
    if (!payload) continue;
    const grade = grades?.grades?.[item.row.symbol] || null;
    const direction = candidateDirection({ signal: item.signal, grade, technicals: payload.technicals, market });
    if (!direction) continue;
    candidates.push({
      symbol: item.row.symbol,
      sector: heatmapBySymbol.get(item.row.symbol)?.s || "Unknown",
      spot: item.quote.spot,
      direction,
      volumeRatio: item.signal.ratio,
      srBreak: item.signal.srBreak,
      gex: item.row.gex || oiBySymbol.get(item.row.symbol) || null,
      grade: grade?.total ?? null,
      technicals: payload.technicals || {},
      atr: atrFromPriceSeries(payload),
    });
    if (candidates.length >= CANDIDATE_LIMIT) break;
  }

  const marks = new Map();
  for (const trade of priorHistory?.portfolios?.stock?.open || []) {
    const quote = quoteMap.get(trade.symbol);
    if (quote) marks.set(trade.id, { spot: quote.spot });
  }
  const { history, snapshot } = runDayTradingEngine({ history: priorHistory, candidates, market, marks, now });
  await mkdir(DATA_DIR, { recursive: true });
  await Promise.all([
    writeFile(resolve(DATA_DIR, STATE_FILE), JSON.stringify(snapshot), "utf8"),
    writeFile(resolve(DATA_DIR, HISTORY_FILE), JSON.stringify(history), "utf8"),
  ]);
  console.log(
    `wrote ${STATE_FILE} + ${HISTORY_FILE} — bias ${market.bias}, ${candidates.length} candidates, ` +
    `${snapshot.open.stock.length} stock open`,
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main().catch((err) => { console.error(err); process.exit(1); });

export { buildMarket, candidateDirection, eventGate, openingRange };

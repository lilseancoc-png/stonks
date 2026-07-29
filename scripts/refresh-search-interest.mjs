// Daily Google Trends search-interest collector.
//
// Google Trends' official API is still alpha-only, and its public Explore
// endpoints routinely block hosted runners. This job therefore uses SerpApi's
// structured Google Trends endpoint. It batches four tracked queries with a
// shared "stock market" anchor (Google permits five comparisons) so relative
// interest remains comparable across batches, then fetches each query's top
// and rising related searches separately.
//
// Output: data/search-interest.json (FREE; lazy-loaded by the Alt data tab).
//
// Required:
//   SERPAPI_KEY
// Optional:
//   SEARCH_TRENDS_CADENCE=daily        # payload label used by the UI
//   SEARCH_TRENDS_GEO=US
//   SEARCH_TRENDS_LIMIT=0              # 0 = the whole current universe
//   SEARCH_TRENDS_RELATED_LIMIT=0      # 0 = related queries for every row
//   SEARCH_TRENDS_RELATED=1            # 0 = skip all related-query requests
//   SEARCH_TRENDS_RELATED_CONCURRENCY=4
//   SEARCH_TRENDS_MAX_REQUESTS=40      # hard outbound cap; 0 = unlimited

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TICKERS, SECTORS } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const OUT = resolve(DATA_DIR, "search-interest.json");
const TMP_OUT = resolve(DATA_DIR, "search-interest.json.tmp");

export const SEARCH_INTEREST_ANCHOR = "stock market";
export const SEARCH_INTEREST_TERMS = [
  { id: "ai", label: "AI", query: "artificial intelligence", sector: "AI buildout" },
  { id: "ai-chips", label: "AI chips", query: "AI chips", sector: "Semiconductors" },
  { id: "data-center", label: "Data centers", query: "data center", sector: "AI infrastructure" },
  { id: "semiconductors", label: "Semiconductors", query: "semiconductors", sector: "Semiconductors" },
  { id: "cloud", label: "Cloud computing", query: "cloud computing", sector: "Software" },
  { id: "cybersecurity", label: "Cybersecurity", query: "cybersecurity", sector: "Software" },
  { id: "quantum", label: "Quantum computing", query: "quantum computing", sector: "Emerging tech" },
  { id: "robotics", label: "Robotics", query: "robotics", sector: "Automation" },
  { id: "nuclear", label: "Nuclear energy", query: "nuclear energy", sector: "Power" },
  { id: "glp1", label: "GLP-1", query: "GLP-1", sector: "Healthcare" },
  { id: "weight-loss-drugs", label: "Weight-loss drugs", query: "weight loss drugs", sector: "Healthcare" },
  { id: "space-stocks", label: "Space stocks", query: "space stocks", sector: "Space" },
  { id: "defense-stocks", label: "Defense stocks", query: "defense stocks", sector: "Defense" },
  { id: "fintech", label: "Fintech", query: "fintech", sector: "Financials" },
  { id: "bitcoin", label: "Bitcoin", query: "Bitcoin", sector: "Crypto" },
  { id: "gold", label: "Gold price", query: "gold price", sector: "Commodities" },
  { id: "oil", label: "Oil price", query: "oil price", sector: "Energy" },
  { id: "rates", label: "Interest rates", query: "interest rates", sector: "Macro" },
  { id: "recession", label: "Recession", query: "recession", sector: "Macro" },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const avg = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
};

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function readPrior() {
  try {
    const parsed = JSON.parse(await readFile(OUT, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readCompanyName(sym) {
  try {
    const parsed = JSON.parse(await readFile(resolve(DATA_DIR, `${sym}.json`), "utf8"));
    return String(parsed?.fundamentals?.name || "").trim() || sym;
  } catch {
    return sym;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export function useRequestBudget(budget) {
  if (!budget) return;
  if (budget.limit > 0 && budget.used >= budget.limit) {
    const error = new Error(`SerpApi request budget exhausted (${budget.used}/${budget.limit})`);
    error.code = "REQUEST_BUDGET_EXHAUSTED";
    throw error;
  }
  budget.used++;
}

async function fetchSerpApi(params, apiKey, attempts = 3, requestBudget = null) {
  const url = new URL("https://serpapi.com/search.json");
  const query = {
    engine: "google_trends",
    geo: process.env.SEARCH_TRENDS_GEO || "US",
    hl: "en",
    tz: process.env.SEARCH_TRENDS_TIMEZONE || "360",
    ...params,
    api_key: apiKey,
  };
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    useRequestBudget(requestBudget);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error) {
        const error = new Error(body?.error || `SerpApi HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || (error?.status >= 400 && error?.status < 500 && error?.status !== 429)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000 * (2 ** attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("SerpApi request failed");
}

function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function timelineSeries(payload, query) {
  const points = Array.isArray(payload?.interest_over_time?.timeline_data)
    ? payload.interest_over_time.timeline_data
    : [];
  return points.map((point) => {
    const match = (point.values || []).find((v) => String(v.query) === query);
    const value = Number(match?.extracted_value);
    const timestamp = Number(point.timestamp);
    return {
      date: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString().slice(0, 10) : String(point.date || ""),
      value: Number.isFinite(value) ? value : null,
    };
  }).filter((point) => point.date && point.value != null);
}

function windowAverage(history, endMs, days) {
  const startMs = endMs - days * 86_400_000;
  return avg(history.filter((p) => {
    const ms = Date.parse(p.date);
    return Number.isFinite(ms) && ms > startMs && ms <= endMs;
  }).map((p) => p.value));
}

function pctChange(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return r1(((now / before) - 1) * 100);
}

export function buildInterestMetrics(history, anchorHistory) {
  if (!history.length) return null;
  const endMs = Math.max(...history.map((p) => Date.parse(p.date)).filter(Number.isFinite));
  const now7 = windowAverage(history, endMs, 7);
  const prior7 = windowAverage(history, endMs - 7 * 86_400_000, 7);
  const now30 = windowAverage(history, endMs, 30);
  const prior30 = windowAverage(history, endMs - 30 * 86_400_000, 30);
  const anchor7 = windowAverage(anchorHistory, endMs, 7);
  return {
    interest: r1(now7),
    relativeInterest: Number.isFinite(now7) && Number.isFinite(anchor7) && anchor7 > 0
      ? r1(clamp((now7 / anchor7) * 100, 0, 999.9))
      : null,
    change7d: pctChange(now7, prior7),
    change30d: pctChange(now30, prior30),
    change7dPoints: Number.isFinite(now7) && Number.isFinite(prior7) ? r1(now7 - prior7) : null,
    change30dPoints: Number.isFinite(now30) && Number.isFinite(prior30) ? r1(now30 - prior30) : null,
    asOf: new Date(endMs).toISOString().slice(0, 10),
  };
}

function relatedRows(values, rising = false) {
  return (Array.isArray(values) ? values : []).slice(0, 8).map((item) => {
    const label = String(item?.value || "");
    const extracted = Number(item?.extracted_value);
    return {
      query: String(item?.query || "").trim(),
      value: label || (Number.isFinite(extracted) ? String(extracted) : ""),
      score: Number.isFinite(extracted) ? extracted : null,
      breakout: rising && /breakout/i.test(label),
    };
  }).filter((item) => item.query);
}

function rowFallback(item, priorById, reason) {
  const prior = priorById.get(item.id);
  if (!prior) return null;
  return { ...prior, stale: true, staleReason: reason, carriedAtIso: new Date().toISOString() };
}

export function buildSearchInterestSummary(rows) {
  const usable = rows.filter((row) => row && !row.missing);
  const sorted7d = usable.filter((row) => Number.isFinite(row.change7d)).slice()
    .sort((a, b) => b.change7d - a.change7d);
  const sortedInterest = usable.filter((row) => Number.isFinite(row.relativeInterest)).slice()
    .sort((a, b) => b.relativeInterest - a.relativeInterest);
  const breakouts = usable.flatMap((row) =>
    (row.risingQueries || []).filter((query) => query.breakout).map((query) => ({
      id: row.id, symbol: row.symbol || null, label: row.label, query: query.query,
    })));
  return {
    top7d: sorted7d.slice(0, 6).map(({ id, symbol, label, change7d }) => ({ id, symbol, label, change7d })),
    topInterest: sortedInterest.slice(0, 6).map(({ id, symbol, label, relativeInterest }) => ({ id, symbol, label, relativeInterest })),
    breakouts: breakouts.slice(0, 12),
    breakoutCount: breakouts.length,
    covered: usable.length,
    stale: usable.filter((row) => row.stale).length,
  };
}

async function main() {
  const apiKey = String(process.env.SERPAPI_KEY || "").trim();
  if (!apiKey) throw new Error("SERPAPI_KEY is required; existing search-interest.json was left untouched");

  const requestBudget = {
    limit: envInt("SEARCH_TRENDS_MAX_REQUESTS", 40),
    used: 0,
  };
  const prior = await readPrior();
  const priorById = new Map((Array.isArray(prior.rows) ? prior.rows : []).map((row) => [row.id, row]));
  const tickerLimit = envInt("SEARCH_TRENDS_LIMIT", 0);
  const symbols = tickerLimit > 0 ? TICKERS.slice(0, tickerLimit) : TICKERS;
  const tickerItems = await mapLimit(symbols, 12, async (sym) => ({
    id: `ticker:${sym}`,
    type: "ticker",
    symbol: sym,
    label: await readCompanyName(sym),
    query: `${sym} stock`,
    sector: SECTORS[sym] || "Other",
  }));
  const themeItems = SEARCH_INTEREST_TERMS.map((term) => ({ ...term, type: "theme", symbol: null }));
  const items = [...tickerItems, ...themeItems];
  const interestBatches = batches(items, 4);
  const today = new Date();
  const start = new Date(today.getTime() - 90 * 86_400_000);
  const dateRange = `${start.toISOString().slice(0, 10)} ${today.toISOString().slice(0, 10)}`;
  const builtAtIso = new Date().toISOString();
  const rowsById = new Map();
  const errors = [];
  let freshInterest = 0;

  for (let i = 0; i < interestBatches.length; i++) {
    const batch = interestBatches[i];
    try {
      const queries = [...batch.map((item) => item.query), SEARCH_INTEREST_ANCHOR];
      const payload = await fetchSerpApi(
        { q: queries.join(","), date: dateRange, data_type: "TIMESERIES" },
        apiKey,
        3,
        requestBudget,
      );
      const anchorHistory = timelineSeries(payload, SEARCH_INTEREST_ANCHOR);
      for (const item of batch) {
        const history = timelineSeries(payload, item.query);
        const metrics = buildInterestMetrics(history, anchorHistory);
        if (!metrics) {
          const carried = rowFallback(item, priorById, "No interest timeline returned");
          if (carried) rowsById.set(item.id, carried);
          else rowsById.set(item.id, { ...item, missing: true, stale: true, history: [], topQueries: [], risingQueries: [] });
          continue;
        }
        const priorRow = priorById.get(item.id);
        rowsById.set(item.id, {
          ...item,
          ...metrics,
          history,
          topQueries: priorRow?.topQueries || [],
          risingQueries: priorRow?.risingQueries || [],
          relatedUpdatedAtIso: priorRow?.relatedUpdatedAtIso || null,
          stale: false,
          updatedAtIso: builtAtIso,
        });
        freshInterest++;
      }
      console.log(`interest: batch ${i + 1}/${interestBatches.length} (${batch.map((item) => item.symbol || item.label).join(", ")})`);
    } catch (error) {
      errors.push(`interest batch ${i + 1}: ${error.message}`);
      for (const item of batch) {
        const carried = rowFallback(item, priorById, error.message);
        if (carried) rowsById.set(item.id, carried);
        else rowsById.set(item.id, { ...item, missing: true, stale: true, history: [], topQueries: [], risingQueries: [] });
      }
      console.warn(`interest: batch ${i + 1}/${interestBatches.length} failed: ${error.message}`);
    }
  }

  if (!freshInterest && !priorById.size) {
    throw new Error(`No Google Trends interest data returned (${errors[0] || "unknown error"}); output was not written`);
  }

  const relatedEnabled = String(process.env.SEARCH_TRENDS_RELATED || "1").trim() !== "0";
  const relatedLimit = envInt("SEARCH_TRENDS_RELATED_LIMIT", 0);
  const relatedCandidates = items.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === "theme" ? -1 : 1;
    const aPrior = Date.parse(priorById.get(a.id)?.relatedUpdatedAtIso || 0);
    const bPrior = Date.parse(priorById.get(b.id)?.relatedUpdatedAtIso || 0);
    return aPrior - bPrior;
  });
  const relatedItems = !relatedEnabled
    ? []
    : relatedLimit > 0
      ? relatedCandidates.slice(0, relatedLimit)
      : relatedCandidates;
  const relatedConcurrency = clamp(envInt("SEARCH_TRENDS_RELATED_CONCURRENCY", 4), 1, 8);
  let freshRelated = 0;
  await mapLimit(relatedItems, relatedConcurrency, async (item, index) => {
    try {
      const payload = await fetchSerpApi(
        { q: item.query, date: dateRange, data_type: "RELATED_QUERIES" },
        apiKey,
        3,
        requestBudget,
      );
      const row = rowsById.get(item.id);
      if (!row) return;
      row.topQueries = relatedRows(payload?.related_queries?.top, false);
      row.risingQueries = relatedRows(payload?.related_queries?.rising, true);
      row.relatedUpdatedAtIso = builtAtIso;
      freshRelated++;
      if ((index + 1) % 20 === 0 || index + 1 === relatedItems.length) {
        console.log(`related: ${index + 1}/${relatedItems.length}`);
      }
    } catch (error) {
      errors.push(`related ${item.id}: ${error.message}`);
      console.warn(`related: ${item.id} failed: ${error.message}`);
    }
  });

  const rows = items.map((item) => rowsById.get(item.id)).filter(Boolean);
  const payload = {
    builtAtIso,
    source: {
      name: "Google Trends",
      provider: "SerpApi",
      cadence: String(process.env.SEARCH_TRENDS_CADENCE || "daily").trim().toLowerCase() || "daily",
      geo: process.env.SEARCH_TRENDS_GEO || "US",
      periodDays: 90,
      anchor: SEARCH_INTEREST_ANCHOR,
      note: "Interest is Google Trends relative search interest, normalized against the shared stock-market anchor. It is not absolute search volume.",
    },
    universe: { tickers: tickerItems.length, themes: themeItems.length, total: items.length },
    status: {
      state: errors.length ? "partial" : "ok",
      freshInterest,
      freshRelated,
      relatedEnabled,
      requestsUsed: requestBudget.used,
      requestLimit: requestBudget.limit,
      errors: errors.slice(0, 20),
    },
    summary: buildSearchInterestSummary(rows),
    rows,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TMP_OUT, JSON.stringify(payload), "utf8");
  await rename(TMP_OUT, OUT);
  console.log(`wrote ${OUT}: ${rows.length} rows, ${freshInterest} fresh timelines, ${freshRelated} related-query sets`);
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

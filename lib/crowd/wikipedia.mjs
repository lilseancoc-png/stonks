// R2 — Wikipedia article page views for each covered company (Wikimedia REST API).
//
// https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/
// all-access/user/<Article>/daily/<YYYYMMDD>/<YYYYMMDD> returns one row per
// day ({ timestamp: "2026110500", views }). Data for a UTC day lands the
// next day, so the bake asks up to yesterday once per ET day, only for the
// days still missing (first run backfills 60 days). Needs a descriptive
// User-Agent; no key. 90 days of [date, views] per name.
//
// UNTESTED FROM THE BUILD SANDBOX (the endpoint was unreachable here); the
// first live build shows whether it reads. A failure only carries forward.

import { fetchJson, finite, round, carried, errorText, addDays, upsertDated, fetchedToday, mean, zScore, isoDay } from "./util.mjs";

export const WIKI_HISTORY_DAYS = 60;
export const WIKI_BACKFILL_DAYS = 60;
export const WIKI_CONCURRENCY = 4;

// Hand-made ticker -> English Wikipedia article title (underscored). A
// missing name is skipped, never guessed.
export const WIKI_TITLES = Object.freeze({
  SPY: "SPDR_S&P_500_ETF_Trust", QQQ: "Invesco_QQQ", IWM: null, SMH: null, UVXY: null, TLT: null, USO: null, GLD: "SPDR_Gold_Shares", SLV: null, KWEB: null, EWY: null,
  AAPL: "Apple_Inc.", MSFT: "Microsoft", AMZN: "Amazon_(company)", META: "Meta_Platforms", GOOGL: "Alphabet_Inc.", TSLA: "Tesla,_Inc.", NVDA: "Nvidia",
  TSM: "TSMC", AVGO: "Broadcom", ORCL: "Oracle_Corporation", NFLX: "Netflix,_Inc.",
  JPM: "JPMorgan_Chase", V: "Visa_Inc.", MA: "Mastercard", LLY: "Eli_Lilly_and_Company", MRNA: "Moderna", MRK: "Merck_&_Co.", WMT: "Walmart", COST: "Costco",
  CRWD: "CrowdStrike", ADBE: "Adobe_Inc.", SHOP: "Shopify", BAC: "Bank_of_America", SCHW: "Charles_Schwab_Corporation", BABA: "Alibaba_Group", MS: "Morgan_Stanley",
  GS: "Goldman_Sachs", HOOD: "Robinhood_Markets", AXP: "American_Express", AMD: "AMD", C: "Citigroup", UNH: "UnitedHealth_Group",
  DELL: "Dell_Technologies", ASML: "ASML_Holding", VST: "Vistra_Corp",
  NOW: "ServiceNow", MDB: "MongoDB_Inc.", ACN: "Accenture", OKTA: "Okta,_Inc.", SNOW: "Snowflake_Inc.",
  RKLB: "Rocket_Lab", CRM: "Salesforce", ASTS: "AST_SpaceMobile", FTNT: "Fortinet", INTU: "Intuit", TEAM: "Atlassian",
  NKE: "Nike,_Inc.", PANW: "Palo_Alto_Networks", DIS: "The_Walt_Disney_Company", IBM: "IBM", QCOM: "Qualcomm",
  HD: "The_Home_Depot", PLTR: "Palantir_Technologies", PYPL: "PayPal", DDOG: "Datadog",
  SBUX: "Starbucks", ANET: "Arista_Networks", TXN: "Texas_Instruments", INTC: "Intel", SMCI: "Supermicro", NVO: "Novo_Nordisk",
  CRWV: "CoreWeave", MRVL: "Marvell_Technology", AMAT: "Applied_Materials", MU: "Micron_Technology", BE: "Bloom_Energy", SNDK: "SanDisk",
  WDC: "Western_Digital", DRAM: null,
  SPCX: null,
  CBRS: null, ARM: "Arm_Holdings", VRT: "Vertiv", TGT: "Target_Corporation",
});

export const WIKI_URL = (title, from, to) =>
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title)}/daily/${from}/${to}`;

export function parseWikiRows(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.map((it) => {
    const ts = String(it?.timestamp || "");
    const date = /^\d{10}$/.test(ts) ? isoDay(ts.slice(0, 8)) : null;
    return date ? [date, finite(it?.views)] : null;
  }).filter((r) => r && Number.isFinite(r[1]));
}

export function summarizeWiki(history) {
  const rows = (history || []).filter((r) => Array.isArray(r) && Number.isFinite(r[1]));
  if (!rows.length) return null;
  const views = rows.map((r) => r[1]);
  const latest = rows[rows.length - 1];
  const prior30 = views.slice(-31, -1);
  const avg30 = mean(prior30);
  const last7 = views.slice(-7);
  return {
    date: latest[0],
    views: latest[1],
    avg7: round(mean(last7), 0),
    avg30: round(avg30, 0),
    ratio30: avg30 > 0 ? round(latest[1] / avg30, 2) : null,
    z30: zScore(latest[1], prior30),
    days: rows.length,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchWikipedia({ prior, symbols, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchJson, titles = WIKI_TITLES } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  const yesterday = addDays(todayEt, -1);
  const targets = symbols.filter((s) => titles[s]);
  const errors = [];
  let okCount = 0;
  const bySymbol = { ...(base.bySymbol || {}) };
  await mapLimit(targets, WIKI_CONCURRENCY, async (sym) => {
    const hist = Array.isArray(bySymbol[sym]?.history) ? bySymbol[sym].history : [];
    const lastDate = hist.length ? hist[hist.length - 1][0] : null;
    const from = lastDate && lastDate >= addDays(yesterday, -WIKI_BACKFILL_DAYS) ? addDays(lastDate, 1) : addDays(yesterday, -WIKI_BACKFILL_DAYS + 1);
    if (from > yesterday) {
      okCount++;
      bySymbol[sym] = { title: titles[sym], ...(summarizeWiki(hist) || {}), history: hist };
      return;
    }
    try {
      const body = await fetchImpl(WIKI_URL(titles[sym], from.replace(/-/g, ""), yesterday.replace(/-/g, "")), { headers: { "api-user-agent": "stonks-app market-data pipeline (https://mingstreet.app)" } });
      let history = hist;
      for (const row of parseWikiRows(body)) history = upsertDated(history, row, WIKI_HISTORY_DAYS);
      bySymbol[sym] = { title: titles[sym], ...(summarizeWiki(history) || {}), history };
      okCount++;
    } catch (err) {
      // 404 = no views in the window (rare) or a renamed article; keep what we have.
      errors.push(`${sym}: ${errorText(err)}`);
      bySymbol[sym] = { title: titles[sym], ...(summarizeWiki(hist) || {}), history: hist, stale: true };
    }
  });
  if (!okCount) return { ...carried(base, errors[0] || "no article read", nowIso), untested: true };
  const asOf = Object.values(bySymbol).map((s) => s.date).filter(Boolean).sort().pop() || null;
  return {
    ok: true, stale: false, carriedForward: false, error: errors.length ? `${errors.length} article(s) failed: ${errors[0]}` : null, untested: true,
    fetchedAt: nowIso, fetchedDate: todayEt, asOf,
    covered: okCount, skipped: symbols.length - targets.length,
    bySymbol,
    note: "Daily human (non-bot) views of each company's English Wikipedia article, through the last complete UTC day. Attention, not opinion.",
  };
}

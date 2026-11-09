// R2 — Wikipedia article page views for each covered company (Wikimedia REST API).
//
// https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/
// all-access/user/<Article>/daily/<YYYYMMDD>/<YYYYMMDD> returns one row per
// day ({ timestamp: "2026110500", views }). Data for a UTC day lands the
// next day, so the bake asks up to yesterday, only for the days still missing
// (first run backfills 60 days); a name whose newest day had not landed yet
// is asked again by a later build that day (at most three passes a day).
// Needs a descriptive User-Agent; no key. 60 days of [date, views] per name.
//
// The page-views API counts the exact title asked for and does not follow
// redirects, so a hand-kept title that has become a redirect reads a trickle
// of views. Once a week the titles are resolved through the MediaWiki API
// (action=query&redirects=1, 50 titles a call) and the canonical title is the
// one counted; a name whose title changes starts its history again. Every
// name is summarized as of one common day (the day most names have reached),
// so the cross-name ranks never compare a Saturday with a Friday.

import { fetchJson, finite, round, carried, errorText, addDays, upsertDated, fetchedToday, mean, zScore, isoDay } from "./util.mjs";

export const WIKI_HISTORY_DAYS = 60;
export const WIKI_BACKFILL_DAYS = 60;
export const WIKI_CONCURRENCY = 4;
export const WIKI_TITLE_CHECK_DAYS = 7;
export const WIKI_PASSES_PER_DAY = 3;
const WIKI_API_BATCH = 50;
const WIKI_HEADERS = { "api-user-agent": "stonks-app market-data pipeline (https://mingstreet.app)" };

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

export const WIKI_RESOLVE_URL = (titles) =>
  `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(titles.join("|"))}`;

// Maps each asked (underscored) title to its canonical underscored title,
// following normalization and up to three redirect hops; null when the page
// does not exist. Titles the response does not mention keep themselves.
export function parseTitleResolution(body, asked) {
  const q = body?.query || {};
  const norm = new Map((Array.isArray(q.normalized) ? q.normalized : []).map((n) => [n?.from, n?.to]));
  const redir = new Map((Array.isArray(q.redirects) ? q.redirects : []).map((r) => [r?.from, r?.to]));
  const pages = Array.isArray(q.pages) ? q.pages : Object.values(q.pages || {});
  const missing = new Set(pages.filter((p) => p && (p.missing === true || p.missing === "" || p.invalid === true || p.invalid === "")).map((p) => p.title));
  const out = {};
  for (const t of asked) {
    let cur = norm.get(t) || norm.get(t.replace(/_/g, " ")) || t.replace(/_/g, " ");
    for (let i = 0; i < 3 && redir.has(cur); i++) cur = redir.get(cur);
    out[t] = missing.has(cur) ? null : String(cur).replace(/ /g, "_");
  }
  return out;
}

async function resolveTitles(list, fetchImpl) {
  const out = {};
  for (let i = 0; i < list.length; i += WIKI_API_BATCH) {
    const chunk = list.slice(i, i + WIKI_API_BATCH);
    Object.assign(out, parseTitleResolution(await fetchImpl(WIKI_RESOLVE_URL(chunk), { headers: WIKI_HEADERS }), chunk));
  }
  return out;
}

function daysApart(a, b) {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 86400000) : Infinity;
}

export function parseWikiRows(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.map((it) => {
    const ts = String(it?.timestamp || "");
    const date = /^\d{10}$/.test(ts) ? isoDay(ts.slice(0, 8)) : null;
    return date ? [date, finite(it?.views)] : null;
  }).filter((r) => r && Number.isFinite(r[1]));
}

// Summary as of `asOf` (the common day) when given: rows after it wait for
// the next build, so every name's latest, 7-day and 30-day reads line up.
export function summarizeWiki(history, asOf = null) {
  const rows = (history || []).filter((r) => Array.isArray(r) && Number.isFinite(r[1]) && (!asOf || r[0] <= asOf));
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
    ratio30: avg30 > 0 && prior30.length >= 7 ? round(latest[1] / avg30, 2) : null,
    z30: prior30.length >= 7 ? zScore(latest[1], prior30) : null,
    days: rows.length,
  };
}

// The day most names have reached (the median newest day), so one late
// article does not hold the rest back and one early one does not run ahead.
export function commonWikiDate(bySymbol) {
  const days = Object.values(bySymbol || {}).map((s) => {
    const h = Array.isArray(s?.history) ? s.history : [];
    return h.length ? h[h.length - 1][0] : null;
  }).filter(Boolean).sort();
  return days.length ? days[Math.floor((days.length - 1) / 2)] : null;
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
  const passes = base.fetchedDate === todayEt ? Number(base.passesToday) || 1 : 0;
  // Done for the day once every name reached yesterday, or after three passes.
  if (fetchedToday(base, todayEt) && (base.complete !== false || passes >= WIKI_PASSES_PER_DAY)) return { ...base, carriedForward: false };
  const yesterday = addDays(todayEt, -1);
  const targets = symbols.filter((s) => titles[s]);
  const errors = [];
  // Weekly redirect check; a failed check keeps the last answer (or the hand titles).
  let resolved = base.resolvedTitles && typeof base.resolvedTitles === "object" ? { ...base.resolvedTitles } : {};
  let titlesCheckedAt = base.titlesCheckedAt || null;
  const asked = [...new Set(targets.map((s) => titles[s]))];
  if (!titlesCheckedAt || daysApart(titlesCheckedAt, todayEt) >= WIKI_TITLE_CHECK_DAYS || asked.some((t) => !(t in resolved))) {
    try {
      resolved = await resolveTitles(asked, fetchImpl);
      titlesCheckedAt = todayEt;
    } catch (err) {
      errors.push(`title check: ${errorText(err)}`);
    }
  }
  const titleOf = (sym) => (titles[sym] in resolved ? resolved[titles[sym]] : titles[sym]);
  let okCount = 0;
  const bySymbol = {};
  for (const [sym, row] of Object.entries(base.bySymbol || {})) if (symbols.includes(sym)) bySymbol[sym] = row;
  await mapLimit(targets, WIKI_CONCURRENCY, async (sym) => {
    const title = titleOf(sym);
    if (!title) {
      errors.push(`${sym}: no article "${titles[sym]}"`);
      delete bySymbol[sym];
      return;
    }
    const prev = bySymbol[sym];
    // Views of a redirect title are not the article's views: start again.
    const hist = prev?.title === title && Array.isArray(prev?.history) ? prev.history : [];
    const lastDate = hist.length ? hist[hist.length - 1][0] : null;
    const from = lastDate && lastDate >= addDays(yesterday, -WIKI_BACKFILL_DAYS) ? addDays(lastDate, 1) : addDays(yesterday, -WIKI_BACKFILL_DAYS + 1);
    if (from > yesterday) {
      okCount++;
      bySymbol[sym] = { title, history: hist };
      return;
    }
    try {
      const body = await fetchImpl(WIKI_URL(title, from.replace(/-/g, ""), yesterday.replace(/-/g, "")), { headers: WIKI_HEADERS });
      let history = hist;
      for (const row of parseWikiRows(body)) history = upsertDated(history, row, WIKI_HISTORY_DAYS);
      bySymbol[sym] = { title, history };
      okCount++;
    } catch (err) {
      // 404 = no views in the window (rare) or a renamed article; keep what we have.
      errors.push(`${sym}: ${errorText(err)}`);
      bySymbol[sym] = { title, history: hist, stale: true };
    }
  });
  if (!okCount) return { ...carried(base, errors[0] || "no article read", nowIso), resolvedTitles: resolved, titlesCheckedAt };
  const asOf = commonWikiDate(bySymbol);
  for (const [sym, row] of Object.entries(bySymbol)) {
    const summary = summarizeWiki(row.history, asOf) || {};
    bySymbol[sym] = { title: row.title, ...summary, history: row.history, ...(row.stale ? { stale: true } : {}), ...(summary.date && asOf && summary.date < asOf ? { behind: true } : {}) };
  }
  const complete = targets.every((s) => !titleOf(s) || (bySymbol[s]?.history || []).some((r) => r[0] === yesterday));
  const renamed = asked.filter((t) => resolved[t] && resolved[t] !== t).map((t) => `${t} -> ${resolved[t]}`);
  return {
    ok: true, stale: false, carriedForward: false, error: errors.length ? `${errors.length} article(s) failed: ${errors[0]}` : null,
    fetchedAt: nowIso, fetchedDate: todayEt, asOf,
    passesToday: passes + 1, complete,
    covered: okCount, skipped: symbols.length - targets.length,
    resolvedTitles: resolved, titlesCheckedAt, renamed,
    bySymbol,
    note: "Daily human (non-bot) views of each company's English Wikipedia article (redirects resolved to the article itself), through the last complete UTC day. Every name is read as of the same day. Attention, not opinion.",
  };
}

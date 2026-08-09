// Central-bank gold demand and official reserve holdings.
//
// Both inputs are World Gold Council public chart surfaces:
// - the Central Banks Dashboard, compiled from IMF IFS plus official sources;
// - the latest Gold Demand Trends central-bank chart (Metals Focus + WGC).
//
// Holdings are reported and can lag by country. Global demand is an estimated
// net-purchase series and is revised between reports. They deliberately remain
// separate in the payload because summing reported country changes will not
// reproduce the estimated global demand total.

const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SOURCE_TIMEOUT_MS = 30_000;
const HOLDINGS_HISTORY_QUARTERS = 25;

export const CENTRAL_BANK_GOLD_SOURCES = Object.freeze({
  holdings: {
    id: "holdings",
    name: "World Gold Council - Gold Reserves by Country",
    url: "https://www.gold.org/goldhub/data/gold-reserves-by-country",
    apiUrl: "https://fsapi.gold.org/api/cbd/v11/charts/getPage?page=snapshot&periodicity=QTD_FULL",
  },
  demand: {
    id: "demand",
    name: "World Gold Council - Gold Demand Trends",
    url: "https://www.gold.org/goldhub/research/gold-demand-trends",
  },
});

function finite(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  const n = finite(value);
  if (n == null) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function pctChange(current, prior) {
  const a = finite(current);
  const b = finite(prior);
  if (a == null || b == null || b === 0) return null;
  return round(((a - b) / Math.abs(b)) * 100, 2);
}

async function fetchText(url, accept = "text/html,application/xhtml+xml,application/json") {
  const res = await fetch(url, {
    headers: {
      "user-agent": FETCH_UA,
      accept,
      origin: "https://www.gold.org",
      referer: "https://www.gold.org/",
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function rowValues(row) {
  return Array.isArray(row) ? row.map((cell) => cell?.val ?? null) : [];
}

function rowIso3(row) {
  if (!Array.isArray(row)) return null;
  return row.find((cell) => /^[A-Z]{3}$/.test(String(cell?.rowId || "")))?.rowId || null;
}

function snapshotRows(snapshot) {
  return Array.isArray(snapshot?.rows) ? snapshot.rows : [];
}

// Reduce the WGC dashboard's quarter-by-quarter table to one latest-reported
// row per country. A dashboard quarter can contain AWAITED cells, so each
// country carries its own actual dataAsOf instead of inheriting the page date.
export function parseGoldHoldingsChart(chartData) {
  const quarterly = chartData?.table?.QTD_FULL;
  if (!quarterly || typeof quarterly !== "object") {
    throw new Error("gold holdings table is missing");
  }
  const datesDesc = Object.keys(quarterly)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    .reverse();
  if (!datesDesc.length) throw new Error("gold holdings dates are missing");

  const countryIds = new Set();
  for (const date of datesDesc) {
    for (const row of snapshotRows(quarterly[date])) {
      const iso3 = rowIso3(row);
      if (iso3) countryIds.add(iso3);
    }
  }

  const countries = [];
  for (const iso3 of countryIds) {
    const observations = [];
    let identity = null;
    for (const date of datesDesc) {
      const row = snapshotRows(quarterly[date]).find((candidate) => rowIso3(candidate) === iso3);
      if (!row) continue;
      const values = rowValues(row);
      if (!identity) identity = { country: String(values[0] || iso3), region: String(values[1] || "Other") };
      const tonnes = finite(values[5]);
      if (tonnes == null || tonnes < 0) continue;
      observations.push({
        date,
        tonnes: round(tonnes),
        goldSharePct: round(values[7]),
      });
    }
    if (!observations.length) continue;
    const latest = observations[0];
    const previousQuarter = observations.find((row) => row.date < latest.date) || null;
    const yearAgoTarget = new Date(`${latest.date}T00:00:00Z`);
    yearAgoTarget.setUTCFullYear(yearAgoTarget.getUTCFullYear() - 1);
    const targetDate = yearAgoTarget.toISOString().slice(0, 10);
    const yearAgo = observations.find((row) => row.date <= targetDate) || null;
    const change3mTonnes = previousQuarter ? round(latest.tonnes - previousQuarter.tonnes) : null;
    const change12mTonnes = yearAgo ? round(latest.tonnes - yearAgo.tonnes) : null;
    countries.push({
      iso3,
      country: identity?.country || iso3,
      region: identity?.region || "Other",
      dataAsOf: latest.date,
      holdingsTonnes: latest.tonnes,
      goldSharePct: latest.goldSharePct,
      change3mTonnes,
      change3mPct: previousQuarter ? pctChange(latest.tonnes, previousQuarter.tonnes) : null,
      change12mTonnes,
      change12mPct: yearAgo ? pctChange(latest.tonnes, yearAgo.tonnes) : null,
      history: observations.slice(0, HOLDINGS_HISTORY_QUARTERS).reverse(),
    });
  }
  countries.sort((a, b) => b.holdingsTonnes - a.holdingsTonnes || a.country.localeCompare(b.country));
  if (countries.length < 50) throw new Error(`gold holdings coverage too thin (${countries.length} countries)`);
  return {
    dashboardAsOf: String(chartData?.options?.maxDateAvailable || datesDesc[0]),
    minDateAvailable: String(chartData?.options?.minDateAvailable || datesDesc[datesDesc.length - 1]),
    countries,
  };
}

function reportPeriodFromPath(path) {
  const q = String(path || "").match(/gold-demand-trends-q([1-4])-(20\d{2})/i);
  if (q) return { quarter: Number(q[1]), year: Number(q[2]) };
  const fy = String(path || "").match(/gold-demand-trends-full-year-(20\d{2})/i);
  return fy ? { quarter: 4, year: Number(fy[1]) } : null;
}

export function discoverLatestGoldDemandReport(html) {
  const matches = String(html || "").matchAll(
    /(?:https:\/\/www\.gold\.org)?(\/goldhub\/research\/gold-demand-trends\/gold-demand-trends-(?:q[1-4]-20\d{2}|full-year-20\d{2}))/gi,
  );
  const reports = [];
  for (const match of matches) {
    const period = reportPeriodFromPath(match[1]);
    if (period) reports.push({ path: match[1], ...period });
  }
  reports.sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  if (!reports.length) throw new Error("latest Gold Demand Trends report was not discovered");
  const latest = reports[0];
  return {
    ...latest,
    url: `https://www.gold.org${latest.path}/central-banks`,
  };
}

function chartLibFromArticle(html) {
  const divs = String(html || "").match(/<div class="wgc-chart-container"[^>]*>/gi) || [];
  for (const div of divs) {
    const title = div.match(/data-chart-data-title="([^"]*)"/i)?.[1] || "";
    const lib = div.match(/data-chart-data-lib="([^"]+)"/i)?.[1] || "";
    if (lib && /central bank/i.test(title) && /(buying|purchase|demand|net)/i.test(title)) return lib.replaceAll("&amp;", "&");
  }
  const fallback = divs.map((div) => div.match(/data-chart-data-lib="([^"]+)"/i)?.[1]).find(Boolean);
  if (!fallback) throw new Error("central-bank demand chart URL is missing");
  return fallback.replaceAll("&amp;", "&");
}

function assignedJson(source, marker = "_self._opt = ") {
  const startMarker = String(source || "").indexOf(marker);
  if (startMarker < 0) throw new Error("chart options assignment is missing");
  const start = String(source).indexOf("{", startMarker + marker.length);
  if (start < 0) throw new Error("chart options object is missing");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error("chart options object is incomplete");
}

function quarterEnd(year, quarter) {
  return `${year}-${String(quarter * 3).padStart(2, "0")}-${quarter === 1 || quarter === 4 ? "31" : "30"}`;
}

function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`;
}

// WGC has used both a one-series chronological chart and a four-series
// (Q1/Q2/Q3/Q4 by year) chart. Support both so report redesigns do not erase
// history at the next quarterly refresh.
export function parseGoldDemandChartScript(script, latestPeriod = null) {
  const options = assignedJson(script);
  const categories = Array.isArray(options?.xAxis?.categories) ? options.xAxis.categories : [];
  const series = Array.isArray(options?.series) ? options.series : [];
  const rows = [];
  const quarterSeries = series.filter((row) => /^Q[1-4]$/i.test(String(row?.name || "")));
  if (quarterSeries.length >= 2 && categories.some((value) => /^20\d{2}$/.test(String(value)))) {
    for (const row of quarterSeries) {
      const quarter = Number(String(row.name).slice(1));
      categories.forEach((yearValue, index) => {
        const year = Number(yearValue);
        const tonnes = finite(row.data?.[index]);
        if (!Number.isInteger(year) || tonnes == null) return;
        if (latestPeriod && (year > latestPeriod.year || (year === latestPeriod.year && quarter > latestPeriod.quarter))) return;
        rows.push({ period: quarterLabel(year, quarter), year, quarter, endDate: quarterEnd(year, quarter), tonnes: round(tonnes) });
      });
    }
  } else {
    const net = series.find((row) => /net purchase/i.test(String(row?.name || ""))) || series[0];
    categories.forEach((label, index) => {
      const match = String(label).match(/Q([1-4])['’]?(\d{2,4})/i);
      const tonnes = finite(net?.data?.[index]);
      if (!match || tonnes == null) return;
      const quarter = Number(match[1]);
      const rawYear = Number(match[2]);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      rows.push({ period: quarterLabel(year, quarter), year, quarter, endDate: quarterEnd(year, quarter), tonnes: round(tonnes) });
    });
  }
  rows.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  if (rows.length < 8) throw new Error(`gold demand history too thin (${rows.length} quarters)`);
  return rows;
}

export async function fetchCentralBankGoldSources() {
  const holdingsPromise = (async () => {
    const text = await fetchText(CENTRAL_BANK_GOLD_SOURCES.holdings.apiUrl, "application/json");
    return parseGoldHoldingsChart(JSON.parse(text)?.chartData);
  })();
  const demandPromise = (async () => {
    const landing = await fetchText(CENTRAL_BANK_GOLD_SOURCES.demand.url);
    const report = discoverLatestGoldDemandReport(landing);
    const article = await fetchText(report.url);
    const chartUrl = chartLibFromArticle(article);
    const script = await fetchText(chartUrl, "application/javascript,text/javascript,*/*");
    return {
      report,
      chartUrl,
      history: parseGoldDemandChartScript(script, report),
    };
  })();
  const [holdings, demand] = await Promise.allSettled([holdingsPromise, demandPromise]);
  return {
    holdings: holdings.status === "fulfilled"
      ? { ok: true, data: holdings.value, error: null }
      : { ok: false, data: null, error: String(holdings.reason?.message || holdings.reason) },
    demand: demand.status === "fulfilled"
      ? { ok: true, data: demand.value, error: null }
      : { ok: false, data: null, error: String(demand.reason?.message || demand.reason) },
  };
}

function demandSummary(history) {
  const rows = Array.isArray(history) ? history : [];
  const latest = rows.at(-1) || null;
  const prior = rows.at(-2) || null;
  const yearAgo = latest ? rows.find((row) => row.year === latest.year - 1 && row.quarter === latest.quarter) : null;
  const trailing4 = rows.slice(-4);
  return {
    latestPeriod: latest?.period || null,
    latestEndDate: latest?.endDate || null,
    latestTonnes: latest?.tonnes ?? null,
    qoqPct: latest && prior ? pctChange(latest.tonnes, prior.tonnes) : null,
    yoyPct: latest && yearAgo ? pctChange(latest.tonnes, yearAgo.tonnes) : null,
    trailing4QuarterTonnes: trailing4.length === 4 ? round(trailing4.reduce((sum, row) => sum + row.tonnes, 0)) : null,
  };
}

function holdingsSummary(countries, dashboardAsOf = null) {
  const rows = Array.isArray(countries) ? countries : [];
  const referenceMs = Date.parse(dashboardAsOf || "");
  // Keep very old reporters visible in the all-country table, but never let an
  // ancient three-month move become a current buyer/seller headline.
  const comparable3m = rows.filter((row) => {
    if (row.change3mTonnes == null) return false;
    const dataMs = Date.parse(row.dataAsOf || "");
    return !Number.isFinite(referenceMs) || (Number.isFinite(dataMs) && referenceMs - dataMs <= 200 * 86_400_000);
  });
  const topBuyers = comparable3m.slice().sort((a, b) => b.change3mTonnes - a.change3mTonnes).slice(0, 5)
    .map(({ iso3, country, change3mTonnes, change3mPct }) => ({ iso3, country, changeTonnes: change3mTonnes, changePct: change3mPct }));
  const topSellers = comparable3m.slice().sort((a, b) => a.change3mTonnes - b.change3mTonnes).slice(0, 5)
    .filter((row) => row.change3mTonnes < 0)
    .map(({ iso3, country, change3mTonnes, change3mPct }) => ({ iso3, country, changeTonnes: change3mTonnes, changePct: change3mPct }));
  return {
    countryCount: rows.length,
    reportedHoldingsTonnes: round(rows.reduce((sum, row) => sum + (row.holdingsTonnes || 0), 0)),
    comparable3mCountries: comparable3m.length,
    reportedChange3mTonnes: round(comparable3m.reduce((sum, row) => sum + row.change3mTonnes, 0)),
    topBuyers,
    topSellers,
  };
}

export function buildCentralBankGoldPayload({ sources, prior = null, builtAtIso = new Date().toISOString() }) {
  const holdingsFresh = !!sources?.holdings?.ok;
  const demandFresh = !!sources?.demand?.ok;
  const countries = holdingsFresh
    ? sources.holdings.data.countries
    : (Array.isArray(prior?.countries) ? prior.countries : []);
  const demand = demandFresh
    ? sources.demand.data.history
    : (Array.isArray(prior?.demand) ? prior.demand : []);
  if (!countries.length && !demand.length) {
    throw new Error(`central-bank gold sources unavailable: holdings=${sources?.holdings?.error || "missing"}; demand=${sources?.demand?.error || "missing"}`);
  }
  const holdingsAsOf = holdingsFresh
    ? sources.holdings.data.dashboardAsOf
    : prior?.holdingsAsOf || null;
  const reportUrl = demandFresh
    ? sources.demand.data.report.url
    : prior?.sources?.find((row) => row.id === "demand")?.url || CENTRAL_BANK_GOLD_SOURCES.demand.url;
  const report = demandFresh ? sources.demand.data.report : null;
  const sourceRows = [
    {
      ...CENTRAL_BANK_GOLD_SOURCES.holdings,
      ok: holdingsFresh,
      stale: !holdingsFresh,
      dataAsOf: holdingsAsOf,
      error: holdingsFresh ? null : sources?.holdings?.error || "source unavailable",
    },
    {
      ...CENTRAL_BANK_GOLD_SOURCES.demand,
      url: reportUrl,
      chartUrl: demandFresh ? sources.demand.data.chartUrl : null,
      ok: demandFresh,
      stale: !demandFresh,
      dataAsOf: demand.at(-1)?.endDate || null,
      error: demandFresh ? null : sources?.demand?.error || "source unavailable",
    },
  ];
  return {
    schemaVersion: 1,
    builtAtIso,
    sourceState: holdingsFresh && demandFresh ? "fresh" : holdingsFresh || demandFresh ? "partial" : "stale",
    stale: !holdingsFresh && !demandFresh,
    holdingsAsOf,
    report: report ? { year: report.year, quarter: report.quarter, url: report.url } : prior?.report || null,
    summary: {
      ...demandSummary(demand),
      ...holdingsSummary(countries, holdingsAsOf),
    },
    demand,
    countries,
    sources: sourceRows,
    methodology:
      "Country holdings are latest-reported official reserves from the World Gold Council dashboard, compiled from IMF IFS and official sources; reporting dates vary by country. Global demand is the World Gold Council / Metals Focus estimated net-purchase series and can be revised. Reported country changes and estimated global demand are not expected to reconcile.",
  };
}

const FINRA_BASE = "https://api.finra.org/data/group/otcMarket/name";
const SHORT_INTEREST_DATASET = `${FINRA_BASE}/consolidatedShortInterest`;
const ATS_WEEKLY_DATASET = `${FINRA_BASE}/weeklySummary`;
const DAY_MS = 86400000;

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits = 2) {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function isoDay(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\//g, ".");
}

function barsFromChain(chain) {
  if (Array.isArray(chain?._bars)) return chain._bars;
  const ps = chain?.priceSeries;
  if (!ps || !Array.isArray(ps.t) || !Array.isArray(ps.v)) return [];
  return ps.t.map((t, i) => ({ t, v: ps.v[i] }));
}

export function weeklyConsolidatedVolume(chain, weekStartDate) {
  const start = Date.parse(`${weekStartDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return null;
  const end = start + 7 * DAY_MS;
  let total = 0;
  let sessions = 0;
  for (const bar of barsFromChain(chain)) {
    const date = isoDay(bar?.t);
    const time = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
    const volume = finite(bar?.v);
    if (!Number.isFinite(time) || time < start || time >= end || !(volume >= 0)) continue;
    total += volume;
    sessions++;
  }
  return sessions >= 3 && total > 0 ? Math.round(total) : null;
}

async function finraPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "stonks-app market-data pipeline",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`FINRA HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("FINRA returned a non-array payload");
  return json;
}

function latestRowsBySymbol(rows, symbolField, dateField, keep = 1) {
  const grouped = new Map();
  for (const row of rows || []) {
    const symbol = normalizeSymbol(row?.[symbolField]);
    const date = String(row?.[dateField] || "");
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!grouped.has(symbol)) grouped.set(symbol, []);
    grouped.get(symbol).push(row);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => String(b?.[dateField] || "").localeCompare(String(a?.[dateField] || "")));
    list.splice(keep);
  }
  return grouped;
}

export function buildShortInterestRead(row, floatShares = null) {
  if (!row) return null;
  const shares = finite(row.currentShortPositionQuantity);
  const priorShares = finite(row.previousShortPositionQuantity);
  const daysToCover = finite(row.daysToCoverQuantity);
  const averageDailyVolume = finite(row.averageDailyVolumeQuantity);
  const reportedChangePct = finite(row.changePercent);
  const changeShares = shares != null && priorShares != null ? shares - priorShares : finite(row.changePreviousNumber);
  const changePct = reportedChangePct != null
    ? reportedChangePct
    : (changeShares != null && priorShares > 0 ? changeShares / priorShares * 100 : null);
  const float = finite(floatShares);
  return {
    source: "FINRA",
    settlementDate: isoDay(row.settlementDate),
    sharesShort: shares,
    priorSharesShort: priorShares,
    changeShares: changeShares == null ? null : Math.round(changeShares),
    changePct: round(changePct),
    averageDailyVolume: averageDailyVolume == null ? null : Math.round(averageDailyVolume),
    daysToCover: round(daysToCover),
    percentFloat: shares != null && float > 0 ? round(shares / float * 100) : null,
    revision: !!row.revisionFlag,
  };
}

export function buildAtsRead(rows, chain) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const reads = rows.slice(0, 2).map((row) => {
    const weekStartDate = isoDay(row.summaryStartDate);
    const atsVolume = finite(row.totalWeeklyShareQuantity);
    const totalVolume = weeklyConsolidatedVolume(chain, weekStartDate);
    return {
      weekStartDate,
      publishedDate: isoDay(row.initialPublishedDate),
      atsVolume: atsVolume == null ? null : Math.round(atsVolume),
      totalVolume,
      darkPoolPct: atsVolume != null && totalVolume > 0 ? round(atsVolume / totalVolume * 100) : null,
      tradeCount: finite(row.totalWeeklyTradeCount),
      tier: row.tierIdentifier || null,
    };
  });
  const current = reads[0];
  if (!current?.weekStartDate || current.atsVolume == null) return null;
  const prior = reads[1] || null;
  const wowChangePp = current.darkPoolPct != null && prior?.darkPoolPct != null
    ? round(current.darkPoolPct - prior.darkPoolPct)
    : null;
  const wowChangePct = current.darkPoolPct != null && prior?.darkPoolPct > 0
    ? round((current.darkPoolPct / prior.darkPoolPct - 1) * 100)
    : null;
  const publishedMs = Date.parse(`${current.publishedDate}T00:00:00Z`);
  const weekMs = Date.parse(`${current.weekStartDate}T00:00:00Z`);
  const observedDelayWeeks = Number.isFinite(publishedMs) && Number.isFinite(weekMs)
    ? Math.max(0, Math.round((publishedMs - weekMs) / (7 * DAY_MS)))
    : null;
  return {
    source: "FINRA ATS",
    weekStartDate: current.weekStartDate,
    publishedDate: current.publishedDate,
    atsVolume: current.atsVolume,
    totalVolume: current.totalVolume,
    darkPoolPct: current.darkPoolPct,
    wowChangePp,
    wowChangePct,
    priorWeekStartDate: prior?.weekStartDate || null,
    priorDarkPoolPct: prior?.darkPoolPct ?? null,
    delayed: true,
    delayWeeks: observedDelayWeeks ?? (current.tier === "T1" ? 2 : current.tier === "T2" ? 4 : null),
  };
}

function priorBySymbol(prior) {
  if (prior?.bySymbol && typeof prior.bySymbol === "object") return prior.bySymbol;
  return {};
}

export async function fetchFinraMarketStructure(symbols, chains, prior = null, asOf = new Date()) {
  const universe = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
  const cutoff = new Date(asOf.getTime() - 120 * DAY_MS).toISOString().slice(0, 10);
  const priorMap = priorBySymbol(prior);
  let shortRows = null;
  let atsRows = null;
  const errors = [];

  try {
    shortRows = await finraPost(SHORT_INTEREST_DATASET, {
      limit: 5000,
      fields: [
        "symbolCode", "settlementDate", "currentShortPositionQuantity",
        "previousShortPositionQuantity", "changePreviousNumber", "changePercent",
        "daysToCoverQuantity", "averageDailyVolumeQuantity", "revisionFlag",
      ],
      domainFilters: [{ fieldName: "symbolCode", values: universe }],
      compareFilters: [{ compareType: "GREATER", fieldName: "settlementDate", fieldValue: cutoff }],
    });
  } catch (err) {
    errors.push(`short interest: ${err.message}`);
  }

  try {
    atsRows = await finraPost(ATS_WEEKLY_DATASET, {
      limit: 5000,
      fields: [
        "issueSymbolIdentifier", "summaryStartDate", "totalWeeklyShareQuantity",
        "totalWeeklyTradeCount", "summaryTypeCode", "tierIdentifier", "initialPublishedDate",
      ],
      domainFilters: [{ fieldName: "issueSymbolIdentifier", values: universe }],
      compareFilters: [
        { compareType: "EQUAL", fieldName: "summaryTypeCode", fieldValue: "ATS_W_SMBL" },
        { compareType: "GREATER", fieldName: "summaryStartDate", fieldValue: cutoff },
      ],
    });
  } catch (err) {
    errors.push(`ATS: ${err.message}`);
  }

  const shortGrouped = latestRowsBySymbol(shortRows, "symbolCode", "settlementDate", 1);
  const atsGrouped = latestRowsBySymbol(atsRows, "issueSymbolIdentifier", "summaryStartDate", 2);
  const bySymbol = {};
  for (const symbol of universe) {
    const chain = chains?.[symbol] || null;
    const floatShares = finite(chain?.fundamentals?.floatShares);
    const shortInterest = buildShortInterestRead(shortGrouped.get(symbol)?.[0], floatShares)
      || priorMap[symbol]?.shortInterest
      || null;
    const ats = buildAtsRead(atsGrouped.get(symbol), chain)
      || priorMap[symbol]?.ats
      || null;
    if (shortInterest || ats) bySymbol[symbol] = { shortInterest, ats };
  }

  return {
    builtAtIso: asOf.toISOString(),
    sources: {
      shortInterest: "FINRA Consolidated Short Interest · twice monthly",
      ats: "FINRA ATS weekly summary · delayed 2 weeks for Tier 1 and 4 weeks for Tier 2",
      totalVolume: "Matching consolidated daily share volume from the ticker price history",
    },
    errors,
    bySymbol,
  };
}

export function attachShortInterestToChains(chains, payload) {
  for (const [symbol, row] of Object.entries(payload?.bySymbol || {})) {
    const chain = chains?.[symbol];
    const si = row?.shortInterest;
    if (!chain?.fundamentals || !si) continue;
    chain.fundamentals.shortInterest = si;
    chain.fundamentals.sharesShort = si.sharesShort;
    chain.fundamentals.sharesShortPriorMonth = si.priorSharesShort;
    chain.fundamentals.shortRatio = si.daysToCover;
    if (si.percentFloat != null) chain.fundamentals.shortPercentOfFloat = si.percentFloat;
    chain.fundamentals.dateShortInterest = si.settlementDate;
  }
}

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

// ---------------------------------------------------------------------------
// Option-implied borrow rate (2026-11-08). The one borrow-cost source the site
// reads is its own option chains: with a call and a put at the same strike and
// expiry, put-call parity gives the financing rate the market is using for the
// stock. C − P = S·e^(−(q+b)·T) − K·e^(−r·T), so q + b = −ln((C − P + K·e^(−rT)) / S) / T.
// Subtracting the dividend yield q leaves b, the implied borrow (hard-to-borrow
// names price well above zero). No network and no paid feed; every input is
// already in the chain. Reads the expiry nearest 60 days (30–120 accepted),
// takes the median over the three strikes nearest spot with two-sided quotes,
// and reports percent per year. Noise from the bid-ask spread is roughly
// (half spread) / (spot × T), so wide-spread names are flagged by `n`/`spreadPct`.
const BORROW_MIN_DTE = 30, BORROW_MAX_DTE = 120, BORROW_TARGET_DTE = 60;
const BORROW_STRIKES = 3;

function expiryCloseEpochSeconds(expSec) {
  // 16:00 ET on the expiration date (Yahoo keys expirations at 00:00 UTC).
  const d = new Date(Number(expSec) * 1000);
  const month = d.getUTCMonth(), day = d.getUTCDate(), year = d.getUTCFullYear();
  // Second Sunday of March to first Sunday of November = EDT (UTC−4), else EST (UTC−5).
  const nthSunday = (y, m, n) => { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  const dst = (month > 2 && month < 10) || (month === 2 && day >= nthSunday(year, 2, 2)) || (month === 10 && day < nthSunday(year, 10, 1));
  return Math.floor(Date.UTC(year, month, day, dst ? 20 : 21, 0, 0) / 1000);
}

export function impliedBorrowRate(data, riskFreeRate = 0.045, dividendYieldPct = 0, nowMs = Date.now()) {
  const spot = finite(data?.spot);
  if (!(spot > 0) || !data?.chains || typeof data.chains !== "object") return null;
  const nowSec = Math.floor(nowMs / 1000);
  const exps = Object.keys(data.chains).map(Number).filter(Number.isFinite)
    .map((expSec) => ({ expSec, dte: (expiryCloseEpochSeconds(expSec) - nowSec) / 86400 }))
    .filter((e) => e.dte >= BORROW_MIN_DTE && e.dte <= BORROW_MAX_DTE)
    .sort((a, b) => Math.abs(a.dte - BORROW_TARGET_DTE) - Math.abs(b.dte - BORROW_TARGET_DTE));
  if (!exps.length) return null;
  const { expSec, dte } = exps[0];
  const chain = data.chains[expSec];
  const T = dte / 365;
  const r = Number.isFinite(riskFreeRate) ? riskFreeRate : 0.045;
  const q = Number.isFinite(dividendYieldPct) ? dividendYieldPct / 100 : 0;
  const twoSided = (c) => c && finite(c.s) > 0 && finite(c.b) > 0 && finite(c.a) > 0 && c.a >= c.b;
  const puts = new Map();
  for (const p of Array.isArray(chain?.p) ? chain.p : []) if (twoSided(p)) puts.set(p.s, p);
  const pairs = [];
  for (const c of Array.isArray(chain?.c) ? chain.c : []) {
    if (!twoSided(c)) continue;
    const p = puts.get(c.s);
    if (!p) continue;
    pairs.push({ k: c.s, cMid: (c.b + c.a) / 2, pMid: (p.b + p.a) / 2, spread: ((c.a - c.b) + (p.a - p.b)) / 2 });
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot));
  const near = pairs.slice(0, BORROW_STRIKES);
  const rates = [];
  let spreadSum = 0;
  for (const pr of near) {
    const forwardPv = pr.cMid - pr.pMid + pr.k * Math.exp(-r * T);
    if (!(forwardPv > 0)) continue;
    const carry = -Math.log(forwardPv / spot) / T; // q + b
    const b = (carry - q) * 100;
    if (Number.isFinite(b)) { rates.push(b); spreadSum += pr.spread; }
  }
  if (!rates.length) return null;
  rates.sort((a, b) => a - b);
  const mid = rates.length % 2 ? rates[(rates.length - 1) / 2] : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
  const clamped = Math.max(-25, Math.min(250, mid));
  return {
    ratePct: round(clamped),
    dte: Math.round(dte),
    expiry: expSec,
    n: rates.length,
    // Average half bid-ask spread of the pairs used, as % of spot per year: the
    // measurement noise. A rate inside this band is not distinguishable from zero.
    noisePct: round(((spreadSum / rates.length) / 2 / spot / T) * 100),
    hardToBorrow: clamped >= 5,
  };
}

// Day volume and open interest, puts over calls, across every expiry of one
// chain. Zero calls → null ratio (never Infinity).
export function chainPutCallTotals(data) {
  const ch = data?.chains;
  if (!ch || typeof ch !== "object") return null;
  let callOi = 0, putOi = 0, callVol = 0, putVol = 0, touched = false;
  for (const leg of Object.values(ch)) {
    if (!leg) continue;
    for (const row of Array.isArray(leg.c) ? leg.c : []) { const oi = finite(row?.oi), v = finite(row?.v); if (oi != null) { callOi += oi; touched = true; } if (v != null) callVol += v; }
    for (const row of Array.isArray(leg.p) ? leg.p : []) { const oi = finite(row?.oi), v = finite(row?.v); if (oi != null) { putOi += oi; touched = true; } if (v != null) putVol += v; }
  }
  if (!touched) return null;
  return {
    callOi: Math.round(callOi), putOi: Math.round(putOi), callVol: Math.round(callVol), putVol: Math.round(putVol),
    oiRatio: callOi > 0 ? round(putOi / callOi) : null,
    volRatio: callVol > 0 ? round(putVol / callVol) : null,
  };
}

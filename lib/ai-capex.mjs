// AI CapEx helpers that keep data/ai-capex.json current without manual
// quarterly edits and without any extra paid/AI calls:
//
//  1. Management guidance. AI_CAPEX_GUIDANCE in build.mjs is the hand-checked
//     baseline. Each name's earnings-call brief (data/transcript-<SYM>.json,
//     already minted once per quarter by regen-transcripts.mjs) carries a
//     guidance table; a full-year CapEx row from a NEWER call replaces the
//     baseline automatically. When the company reported after the guide we
//     show but no newer figure was found, the guide is flagged for review
//     instead of silently going stale.
//  2. Stale SEC series. Some filers (TSMC's 20-F) stop appearing in SEC's
//     XBRL company-concept API. When the SEC series is more than ~14 months
//     old, the same quarterly cash-flow rows the bake already fetches from
//     Yahoo (fundamentals.capexHistory / revenueHistory) roll it forward,
//     converted to USD at each quarter's average FX rate.
//
// Pure functions only — build.mjs does the I/O.

const UNIT_MULT = {
  trillion: 1e12, t: 1e12,
  billion: 1e9, bn: 1e9, b: 1e9,
  million: 1e6, mm: 1e6, m: 1e6,
};
const UNIT = "(trillion|billion|bn|b|million|mm|m)";
const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
const RANGE_RE = new RegExp(`\\$\\s*${NUM}\\s*${UNIT}?\\s*(?:-|to|and)\\s*\\$?\\s*${NUM}\\s*${UNIT}\\b`, "i");
const SINGLE_RE = new RegExp(`\\$\\s*${NUM}\\s*${UNIT}\\b`, "i");
const FLOOR_RE = /\b(?:more than|at least|over|exceed(?:ing|s)?|above|north of|in excess of|greater than|upwards of)\s*\$|\$\s*[\d.,]+\s*(?:trillion|billion|bn|b|million|mm|m)\s*\+|\bor more\b|\bplus\b/i;
const QUARTER_RE = /\b(?:Q[1-4]|[1-4]Q|quarter(?:ly)?|H[12]|(?:first|second) half|half[- ]year)\b/i;
export const CAPEX_METRIC_RE = /\bcap(?:ital)?[\s-]*ex(?:penditures?)?\b|\bcapital (?:expenditures?|spend(?:ing)?|budget)\b/i;
const NOT_DOLLAR_CAPEX_RE = /\b(?:intensity|as a (?:percent|%|share)|% of|depreciation)\b/i;

const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// "$130-145 billion" / "approximately $220B" / "more than $25 billion" →
// { low, high, qualifier } in USD (high null = floor). Non-USD figures and
// text without a dollar amount + unit return null.
export function parseCapexGuidanceValue(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const s = text.replace(/US\s*\$/gi, "$").replace(/[‒-―−]/g, "-");
  if (/\bNT\s*\$|\bNTD\b|\bTWD\b|\bRMB\b|[€£¥]/i.test(s)) return null;
  const range = s.match(RANGE_RE);
  if (range) {
    const highUnit = range[4].toLowerCase();
    const lowUnit = (range[2] || range[4]).toLowerCase();
    const low = num(range[1]) * UNIT_MULT[lowUnit];
    const high = num(range[3]) * UNIT_MULT[highUnit];
    if (!(low > 0) || !(high > 0)) return null;
    if (high < low) return null;
    return { low, high, qualifier: high === low ? "about" : "range" };
  }
  const single = s.match(SINGLE_RE);
  if (!single) return null;
  const val = num(single[1]) * UNIT_MULT[single[2].toLowerCase()];
  if (!(val > 0)) return null;
  if (FLOOR_RE.test(s)) return { low: val, high: null, qualifier: "more than" };
  return { low: val, high: val, qualifier: "about" };
}

// The calendar year a full-year guide covers, or null when the row is a
// quarter/half, or is a fiscal year that is not the calendar year.
// `calendarFiscal` = the company's fiscal year IS the calendar year, so
// "FY2026" / "2026" / "full year" rows count as CY2026.
export function capexGuidancePeriodYear(text, { calendarFiscal = false, defaultYear = null } = {}) {
  const s = String(text || "");
  if (QUARTER_RE.test(s)) return null;
  const year = (y) => {
    const n = Number(y);
    return n < 100 ? 2000 + n : n;
  };
  const cal = s.match(/\b(?:CY|calendar(?:\s+year)?)\s*'?(20\d{2}|\d{2})\b/i);
  if (cal) return year(cal[1]);
  const fy = s.match(/\b(?:FY|fiscal(?:\s+year)?)\s*'?(20\d{2}|\d{2})\b/i);
  if (fy) return calendarFiscal ? year(fy[1]) : null;
  const bare = s.match(/\b(20\d{2})\b/);
  if (bare) return calendarFiscal ? year(bare[1]) : null;
  if (calendarFiscal && defaultYear && /\b(?:full[- ]year|this year|for the year|annual)\b/i.test(s)) return defaultYear;
  return null;
}

const midpoint = (g) => (g.high == null ? g.low : (g.low + g.high) / 2);

// Pull a full-year dollar CapEx guide out of an earnings-call brief.
// `reference` (USD) is a sanity anchor — the prior guide's midpoint or the SEC
// TTM CapEx — so a mis-extracted figure (a quarterly number, a segment, a
// different currency) is rejected rather than published.
export function extractCapexGuidanceFromBrief(brief, { calendarFiscal = false, reference = null } = {}) {
  const rows = Array.isArray(brief?.summary?.guidance) ? brief.summary.guidance : [];
  const callDate = typeof brief?.callDate === "string" ? brief.callDate.slice(0, 10) : null;
  if (!rows.length || !callDate) return null;
  const callYear = Number(callDate.slice(0, 4));
  let best = null;
  for (const row of rows) {
    const metric = String(row?.metric || "");
    const value = String(row?.value || "");
    if (!CAPEX_METRIC_RE.test(metric) || NOT_DOLLAR_CAPEX_RE.test(metric)) continue;
    const periodText = `${row?.period || ""} ${metric}`;
    if (QUARTER_RE.test(periodText)) continue;
    const yearVal = capexGuidancePeriodYear(periodText, { calendarFiscal, defaultYear: callYear })
      ?? capexGuidancePeriodYear(value, { calendarFiscal, defaultYear: null });
    if (!yearVal || yearVal < callYear || yearVal > callYear + 1) continue;
    const parsed = parseCapexGuidanceValue(value);
    if (!parsed || parsed.low < 1e9) continue;
    if (reference > 0) {
      const mid = midpoint(parsed);
      if (mid < 0.4 * reference || mid > 3 * reference) continue;
    }
    const change = ["raised", "lowered", "maintained", "new", "withdrawn"].includes(row?.change) ? row.change : null;
    const cand = {
      period: `CY${yearVal}`,
      ...parsed,
      asOf: callDate,
      event: `${brief.quarter ? `${brief.quarter} ` : ""}earnings call`,
      basis: "as stated on the earnings call",
      sourceUrl: brief.sourceUrl || null,
      source: brief.source || null,
      auto: true,
      callChange: change,
    };
    if (!best || yearVal > Number(best.period.slice(2))) best = cand;
  }
  return best;
}

const fmtB = (v) => `$${Math.round(v / 1e9)}B`;
const fmtGuide = (g) => (g.high == null ? `>${fmtB(g.low)}` : g.high !== g.low ? `${fmtB(g.low)}–${fmtB(g.high)}` : fmtB(g.low));

// Merge the hand-checked baseline with newer call-brief guides (and the prior
// payload's auto guides, so a store miss on the brief never reverts a figure),
// then flag any guide that predates the company's latest earnings report.
export function resolveAiCapexGuidance({
  tickers,
  manual = {},
  briefs = {},
  prior = {},
  lastPrints = {},
  references = {},
  calendarFiscal = new Set(),
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const out = {};
  const thisYear = Number(todayIso.slice(0, 4));
  for (const ticker of tickers || []) {
    const base = manual[ticker] ? { ...manual[ticker], ticker, auto: false } : null;
    const ref = base ? midpoint(base) : references[ticker] || null;
    const opts = { calendarFiscal: calendarFiscal.has(ticker), reference: ref };
    const fromBrief = briefs[ticker] ? extractCapexGuidanceFromBrief(briefs[ticker], opts) : null;
    const priorAuto = prior[ticker]?.auto && prior[ticker].low > 0 && prior[ticker].asOf ? { ...prior[ticker] } : null;
    const cands = [base, fromBrief, priorAuto].filter(Boolean);
    if (!cands.length) { out[ticker] = null; continue; }
    // Newest statement wins; on a same-day tie the hand-checked entry wins.
    cands.sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)) || (a.auto ? 1 : 0) - (b.auto ? 1 : 0));
    const chosen = { ...cands[0], ticker };
    delete chosen.review;
    if (chosen.auto) {
      const previous = cands.slice(1).find((c) => c.period === chosen.period && c.asOf < chosen.asOf);
      if (previous && !(chosen.previous && chosen.previous.asOf === previous.asOf)) {
        chosen.previous = { low: previous.low, high: previous.high, qualifier: previous.qualifier, asOf: previous.asOf };
        const delta = midpoint(chosen) / midpoint(previous) - 1;
        chosen.change = Math.abs(delta) < 0.01 ? `reiterated (${fmtGuide(previous)} before)`
          : `${delta > 0 ? "raised" : "lowered"} from ${fmtGuide(previous)}`;
      } else if (!previous && !chosen.change && chosen.callChange && chosen.callChange !== "new") {
        chosen.change = chosen.callChange;
      }
    }
    const printDate = typeof lastPrints[ticker] === "string" ? lastPrints[ticker].slice(0, 10) : null;
    const periodYear = Number(String(chosen.period || "").replace(/\D/g, "")) || null;
    if (printDate && chosen.asOf && Date.parse(printDate) - Date.parse(chosen.asOf) > 3 * 86400000) {
      chosen.review = { reason: "newer-report", reportDate: printDate };
    } else if (periodYear && periodYear < thisYear) {
      chosen.review = { reason: "past-period" };
    }
    out[ticker] = chosen;
  }
  return out;
}

// Group totals for the guide strip. Only one period is summed (the one most
// companies guide); a company already guiding a different year is listed
// separately rather than blended into the sum.
export function buildGuidanceTotals(guidanceByTicker) {
  const all = Object.values(guidanceByTicker || {}).filter((g) => g && g.low > 0 && g.period);
  if (!all.length) return null;
  const byPeriod = new Map();
  for (const g of all) byPeriod.set(g.period, (byPeriod.get(g.period) || 0) + 1);
  const period = [...byPeriod.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
  const companies = all.filter((g) => g.period === period);
  return {
    period,
    lowSum: companies.reduce((sum, g) => sum + g.low, 0),
    highSum: companies.reduce((sum, g) => sum + (g.high == null ? g.low : g.high), 0),
    hasFloor: companies.some((g) => g.high == null),
    count: companies.length,
    latestAsOf: companies.map((g) => g.asOf).sort().pop() || null,
    companies,
    otherPeriods: all.filter((g) => g.period !== period).map((g) => ({ ticker: g.ticker, period: g.period, low: g.low, high: g.high })),
    needsReview: all.filter((g) => g.review).map((g) => ({ ticker: g.ticker, ...g.review })),
    autoCount: companies.filter((g) => g.auto).length,
    comparabilityNote: "Company definitions differ; guidance is directional and is not added to SEC-reported cash CapEx.",
  };
}

// --- Stale-SEC fallback -----------------------------------------------------

const DAY = 86400000;

// Average FX close (foreign units per USD, Yahoo "<CUR>=X") over the quarter
// ending `endIso`; falls back to the nearest close on or before it, then the
// first close in the series.
export function fxRateForQuarter(bars, endIso) {
  const rows = (Array.isArray(bars) ? bars : []).filter((b) => b?.t && Number(b.c) > 0);
  if (!rows.length) return null;
  const end = Date.parse(endIso);
  const start = end - 92 * DAY;
  const inQ = rows.filter((b) => { const t = Date.parse(b.t); return t > start && t <= end; });
  if (inQ.length >= 5) return inQ.reduce((s, b) => s + Number(b.c), 0) / inQ.length;
  const before = rows.filter((b) => Date.parse(b.t) <= end);
  if (before.length) return Number(before[before.length - 1].c);
  return Number(rows[0].c);
}

const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Roll quarterly rows ({date: period-end ISO, value}) into a USD TTM plus any
// complete fiscal years. Returns null when fewer than four consecutive
// quarters are available or a non-USD series cannot be converted.
export function quarterlyToUsd(rows, { currency = "USD", fxBars = null, fiscalYearEndMonth = 12 } = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ date: String(r?.date || "").slice(0, 10), value: Math.abs(Number(r?.value)) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value) && r.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 4) return null;
  const cur = String(currency || "USD").toUpperCase();
  const usd = [];
  for (const r of clean) {
    if (cur === "USD") { usd.push({ ...r, usd: r.value }); continue; }
    const rate = fxRateForQuarter(fxBars, r.date);
    if (!(rate > 0)) return null;
    usd.push({ ...r, usd: r.value / rate, fx: rate });
  }
  const last4 = usd.slice(-4);
  for (let i = 1; i < last4.length; i++) {
    const gap = (Date.parse(last4[i].date) - Date.parse(last4[i - 1].date)) / DAY;
    if (gap < 75 || gap > 105) return null;
  }
  const ttm = { val: Math.round(last4.reduce((s, r) => s + r.usd, 0)), asOf: last4[3].date, basis: "ttm" };
  const fyem = Number(fiscalYearEndMonth) >= 1 && Number(fiscalYearEndMonth) <= 12 ? Number(fiscalYearEndMonth) : 12;
  const byFy = new Map();
  for (const r of usd) {
    const y = Number(r.date.slice(0, 4));
    const m = Number(r.date.slice(5, 7));
    const fy = m > fyem ? y + 1 : y;
    if (!byFy.has(fy)) byFy.set(fy, []);
    byFy.get(fy).push(r);
  }
  const annual = [];
  for (const [fy, qs] of [...byFy.entries()].sort((a, b) => a[0] - b[0])) {
    if (new Set(qs.map((q) => q.date)).size !== 4) continue;
    annual.push({
      endIso: `${fy}-${String(fyem).padStart(2, "0")}-${String(lastDayOfMonth(fy, fyem)).padStart(2, "0")}`,
      val: Math.round(qs.reduce((s, q) => s + q.usd, 0)),
    });
  }
  return {
    ttm,
    annual,
    currency: cur,
    fxRate: cur === "USD" ? null : last4[3].fx,
  };
}

// True when the SEC series ends so long ago that the latest annual filing is
// missing from the XBRL feed (a 20-F filer lands ~4 months after year end, so
// 14 months without a newer FY means the feed stopped).
export function secSeriesIsStale(latestEndIso, builtAtIso) {
  const end = Date.parse(latestEndIso);
  const now = Date.parse(builtAtIso);
  if (!Number.isFinite(end)) return true;
  if (!Number.isFinite(now)) return false;
  return now - end > 425 * DAY;
}

// Data source health (2026-11-08): what each outside source delivered, from
// the payloads the bake already writes.
//
// Every fetcher in the bake degrades gracefully: a failed read carries the
// last-good copy forward and marks it `stale` (or `aged`, `carriedForward`),
// so the site never blanks, but a parser that quietly broke shows up only as
// a carry-forward that never ends. This module reads each source's payload
// after the bake, records the newest observation it holds and how much of it
// is carried, keeps 60 days of those states, and flags a source whose
// carry-forward streak has reached three days. The Update Checker shows the
// table; nothing here fetches, retries or changes a payload.
//
// Pure except the two file helpers. No network, no AI.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SOURCE_HEALTH_KEY = "source-health.json";
export const SOURCE_HEALTH_VERSION = 1;
export const SOURCE_HEALTH_KEEP_DAYS = 60;
// A carry-forward streak this long is a check to make, not a bad day.
export const SOURCE_REVIEW_STREAK = 3;
// How old the newest observation may be before a source reads "aged", by
// how often the source publishes. Daily sources get a long weekend plus a
// holiday; quarterly filings a full reporting lag.
export const SOURCE_AGE_HOURS = Object.freeze({ hourly: 30, daily: 96, weekly: 240, monthly: 45 * 24, quarterly: 120 * 24 });

// Each outside source and the payload that shows what it delivered. The
// readers below are generic: they look for the newest dated observation and
// the bake's own stale / aged / carriedForward markers at any depth.
export const SOURCES = Object.freeze([
  { id: "yahoo-chains", label: "Option chains and daily bars", provider: "Yahoo Finance", key: "manifest.json", cadence: "daily" },
  { id: "yahoo-quotes", label: "Live quotes (heatmap)", provider: "Yahoo Finance", key: "heatmap.json", cadence: "hourly" },
  { id: "yahoo-global", label: "Overnight markets sweep", provider: "Yahoo Finance", key: "correlations.json", cadence: "daily" },
  { id: "unusual-flow", label: "Unusual options flow scan", provider: "Yahoo Finance", key: "unusual.json", cadence: "hourly" },
  { id: "oi-tracker", label: "Open-interest tracker", provider: "Yahoo Finance", key: "oi-tracker.json", cadence: "daily" },
  { id: "macro-levels", label: "Yields, dollar, VIX, inflation", provider: "Yahoo Finance / FRED / BLS", key: "macro.json", cadence: "daily" },
  { id: "fed-liquidity", label: "Fed liquidity line", provider: "FRED", key: "macro-history.json", path: "liquidity", cadence: "weekly" },
  { id: "fedwatch", label: "Fed funds futures", provider: "CME via Yahoo", key: "fedwatch-history.json", cadence: "daily" },
  { id: "rfr", label: "3-month T-bill rate", provider: "US Treasury / FRED", key: "rfr-history.json", cadence: "daily" },
  { id: "fear-greed", label: "Fear & Greed", provider: "CNN", key: "fear-greed.json", cadence: "daily" },
  { id: "calendar", label: "Macro and earnings calendar", provider: "BLS / FRED / Fed / Nasdaq", key: "calendar.json", cadence: "daily" },
  { id: "treasury-auctions", label: "Treasury auction results", provider: "Fiscal Data", key: "treasury-auctions.json", cadence: "daily" },
  { id: "commodities", label: "Commodities", provider: "Yahoo / FRED / World Bank / scrapes", key: "commodities.json", cadence: "daily" },
  { id: "ai-capex", label: "AI CapEx", provider: "SEC XBRL", key: "ai-capex.json", cadence: "quarterly" },
  { id: "capital-raises", label: "Capital raises", provider: "SEC XBRL", key: "capital-raises.json", cadence: "daily" },
  { id: "ipo-credit", label: "IPOs, bond issuance, credit", provider: "stockanalysis / EDGAR / SIFMA / FRED / NY Fed", key: "ipo-credit.json", cadence: "monthly" },
  { id: "pending-buyouts", label: "Pending buyouts", provider: "ditat.io / Yahoo news", key: "pending-buyouts.json", cadence: "daily" },
  { id: "f13", label: "13F holdings and Form 4", provider: "SEC EDGAR", key: "13f.json", cadence: "quarterly" },
  { id: "leverage-distress", label: "Hot funds and pledges", provider: "SEC EDGAR", key: "leverage-distress.json", cadence: "daily" },
  { id: "news", label: "News feeds", provider: "issuer feeds / RSS", key: "news.json", cadence: "daily" },
  { id: "narratives", label: "Market narratives", provider: "Gemini", key: "narratives.json", cadence: "daily" },
  { id: "briefs", label: "Brief", provider: "Gemini", key: "briefs.json", cadence: "daily" },
  { id: "earnings-history", label: "Earnings dates and prints", provider: "Yahoo Finance", key: "earnings-history.json", cadence: "daily" },
  { id: "earnings-calls", label: "Earnings call transcripts", provider: "Motley Fool / MarketBeat", key: "earnings-calls.json", cadence: "weekly" },
  { id: "bottom-tracker", label: "Credit spreads (Bottom tracker)", provider: "FRED", key: "bottom-tracker.json", cadence: "daily" },
  { id: "historical-sources", label: "Long index and FRED history", provider: "Yahoo Finance / FRED", key: "historical-source-history.json", cadence: "daily" },
  { id: "central-bank-gold", label: "Central bank gold", provider: "World Gold Council / IMF", key: "central-bank-gold.json", cadence: "monthly" },
  { id: "overnight-preopen", label: "Pre-open call", provider: "Yahoo Finance", key: "overnight-preopen.json", cadence: "daily" },
  { id: "ram-prices", label: "RAM prices", provider: "TrendForce / WhereIsMyRam", key: "ram-prices.json", cadence: "weekly" },
  { id: "accelerator-prices", label: "GPU cloud prices", provider: "Vast / CoreWeave / Runpod / Lambda", key: "accelerator-prices.json", cadence: "weekly" },
  { id: "search-interest", label: "Search interest", provider: "Google Trends", key: "search-interest.json", cadence: "weekly" },
  { id: "crowd-short-volume", label: "Short sale volume", provider: "FINRA Reg SHO", key: "crowd.json", path: "shortVolume", cadence: "daily" },
  { id: "crowd-put-call", label: "Put/call ratios", provider: "Cboe", key: "crowd.json", path: "putCall", cadence: "daily" },
  { id: "crowd-borrow", label: "Borrow fee and availability", provider: "Interactive Brokers", key: "crowd.json", path: "borrow", cadence: "daily" },
  { id: "crowd-cot", label: "Commitments of Traders", provider: "CFTC", key: "crowd.json", path: "cot", cadence: "weekly" },
  { id: "crowd-reddit", label: "Reddit mentions", provider: "ApeWisdom", key: "crowd.json", path: "reddit", cadence: "daily" },
  { id: "crowd-wikipedia", label: "Wikipedia page views", provider: "Wikimedia", key: "crowd.json", path: "wikipedia", cadence: "daily" },
  { id: "crowd-lev-flows", label: "Leveraged ETF flows", provider: "Yahoo Finance", key: "crowd.json", path: "levFlows", cadence: "daily" },
  { id: "crowd-stocktwits", label: "Stocktwits watchers and trending", provider: "Stocktwits", key: "crowd.json", path: "stocktwits", cadence: "daily" },
  { id: "crowd-margin-debt", label: "Margin debt", provider: "FINRA", key: "crowd.json", path: "marginDebt", cadence: "monthly" },
  { id: "crowd-kalshi", label: "Kalshi odds", provider: "Kalshi", key: "crowd.json", path: "kalshi", cadence: "daily" },
  { id: "crowd-perps", label: "Stock perpetuals", provider: "Hyperliquid", key: "crowd.json", path: "perps", cadence: "daily" },
]);

export const SOURCE_STATES = Object.freeze(["ok", "partial", "carried", "aged", "missing", "unreadable"]);
const STATE_CODE = { ok: 0, partial: 1, carried: 2, aged: 3, missing: 4, unreadable: 5 };
const CODE_STATE = Object.fromEntries(Object.entries(STATE_CODE).map(([k, v]) => [v, k]));

const DATE_KEY_RE = /^(asOf|asOfIso|date|observedAt|observed_utc|fetchedAt|fetchedDate|updatedAt|updatedAtIso|scannedAt|lastDate|capturedAt|aiGeneratedAtIso|generatedAtIso|at|etDate|dataBuiltAtIso)$/;
const FLAG_KEYS = ["stale", "aged", "carriedForward"];
const OK_STATUSES = new Set(["ok", "available", "unchanged", "cached", "fresh", "success"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MAX_DEPTH = 4;
const ARRAY_SAMPLE = 60;

function dateMs(v) {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v.trim())) return null;
  const t = Date.parse(v.trim().length === 10 ? `${v.trim()}T12:00:00Z` : v.trim());
  return Number.isFinite(t) ? t : null;
}

// Walks a payload (bounded) and gathers: the newest dated observation that is
// not in the future, the bake's carry markers, and failed source statuses.
export function scanPayload(payload, nowMs = Date.now()) {
  const out = { at: null, flagged: 0, carried: 0, aged: 0, failed: 0, statuses: 0 };
  const horizon = nowMs + 36 * 3600000;
  const seen = new Set();
  const visit = (node, depth, parentKey) => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const start = Math.max(0, node.length - ARRAY_SAMPLE);
      for (let i = start; i < node.length; i++) visit(node[i], depth + 1, parentKey);
      return;
    }
    let hasFlag = false;
    for (const key of FLAG_KEYS) {
      if (typeof node[key] === "boolean") hasFlag = true;
      if (node[key] === true) {
        if (key === "aged") out.aged++;
        else out.carried++;
      }
    }
    if (hasFlag) out.flagged++;
    if (typeof node.status === "string" && (parentKey === "sourceHealth" || parentKey === "coverage" || parentKey === "sources")) {
      out.statuses++;
      if (!OK_STATUSES.has(node.status)) out.failed++;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "builtAtIso" || key === "renderedAtIso") continue;
      if (DATE_KEY_RE.test(key)) {
        const t = dateMs(value);
        if (t != null && t <= horizon && (out.at == null || t > out.at)) out.at = t;
        continue;
      }
      if (value && typeof value === "object") visit(value, depth + 1, key);
    }
  };
  visit(payload, 0, null);
  return out;
}

function selectPath(payload, path) {
  if (!path) return payload;
  return String(path).split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), payload);
}

// One source's state from its payload (null = not written, undefined entry
// error = unreadable).
export function assessSource(def, payload, nowMs = Date.now(), error = null) {
  const base = { id: def.id, label: def.label, provider: def.provider, key: def.key, cadence: def.cadence, at: null, ageHours: null, carried: 0, flagged: 0, aged: 0, failed: 0 };
  if (error) return { ...base, state: "unreadable", detail: "The payload could not be read as JSON." };
  const block = selectPath(payload, def.path);
  if (block == null) return { ...base, state: "missing", detail: def.path ? `No ${def.path} block in ${def.key}.` : `No ${def.key} was written.` };
  const scan = scanPayload(block, nowMs);
  const at = scan.at != null ? new Date(scan.at).toISOString() : null;
  const ageHours = scan.at != null ? Math.max(0, Math.round((nowMs - scan.at) / 360000) / 10) : null;
  const allowance = SOURCE_AGE_HOURS[def.cadence] ?? SOURCE_AGE_HOURS.daily;
  const row = { ...base, at, ageHours, carried: scan.carried, flagged: scan.flagged, aged: scan.aged, failed: scan.failed };
  const topCarried = block && typeof block === "object" && !Array.isArray(block) && (block.stale === true || block.carriedForward === true);
  if (topCarried || (scan.carried > 0 && scan.carried * 2 >= scan.flagged)) {
    return { ...row, state: "carried", detail: topCarried ? "The whole payload is a carried last-good copy." : `${scan.carried} of ${scan.flagged} parts are carried last-good copies.` };
  }
  if (scan.carried > 0 || scan.aged > 0 || scan.failed > 0) {
    const bits = [];
    if (scan.carried) bits.push(`${scan.carried} of ${scan.flagged} parts carried`);
    if (scan.aged) bits.push(`${scan.aged} aged`);
    if (scan.failed) bits.push(`${scan.failed} of ${scan.statuses} source checks not ok`);
    return { ...row, state: "partial", detail: bits.join(", ") + "." };
  }
  if (ageHours != null && ageHours > allowance) {
    return { ...row, state: "aged", detail: `Newest observation is ${Math.round(ageHours / 24)} days old; a ${def.cadence} source should be within ${Math.round(allowance / 24)} days.` };
  }
  return { ...row, state: "ok", detail: at ? "Fresh observation, nothing carried." : "Written this run; the payload carries no observation dates." };
}

export function etDateOf(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}

export function emptySourceHealth() {
  return { v: SOURCE_HEALTH_VERSION, builtAtIso: null, sources: [], days: [] };
}

export function parseSourceHealth(body) {
  if (body == null) return null;
  let parsed;
  try { parsed = typeof body === "string" ? JSON.parse(body) : body; } catch { return null; }
  if (!parsed || typeof parsed !== "object" || parsed.v !== SOURCE_HEALTH_VERSION) return null;
  return {
    v: SOURCE_HEALTH_VERSION,
    builtAtIso: typeof parsed.builtAtIso === "string" ? parsed.builtAtIso : null,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    days: (Array.isArray(parsed.days) ? parsed.days : []).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.s && typeof d.s === "object"),
  };
}

// payloads: Map key -> { payload } | { error } | undefined (not written).
// prior: the previous source-health.json (for the day history).
export function buildSourceHealth({ payloads, prior = null, builtAtIso, now = null } = {}) {
  const nowMs = Number.isFinite(now) ? now : (Date.parse(builtAtIso || "") || Date.now());
  const sources = SOURCES.map((def) => {
    const entry = payloads instanceof Map ? payloads.get(def.key) : payloads?.[def.key];
    if (!entry) return assessSource(def, null, nowMs);
    return assessSource(def, entry.payload ?? null, nowMs, entry.error || null);
  });
  const today = etDateOf(builtAtIso) || new Date(nowMs).toISOString().slice(0, 10);
  const days = (prior?.days || []).filter((d) => d.date !== today).slice();
  // Within a day the worst state wins, so a morning miss that the afternoon
  // bake repaired still shows as a bad day in the history.
  const earlier = (prior?.days || []).find((d) => d.date === today)?.s || {};
  const s = {};
  for (const row of sources) {
    const code = STATE_CODE[row.state] ?? 0;
    const was = Number.isInteger(earlier[row.id]) ? earlier[row.id] : -1;
    s[row.id] = Math.max(code, was);
  }
  days.push({ date: today, s });
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const kept = days.slice(-SOURCE_HEALTH_KEEP_DAYS);
  // Streaks and 30-day bad-day counts from the history, today included.
  const last30 = kept.slice(-30);
  for (const row of sources) {
    let streak = 0;
    for (let i = kept.length - 1; i >= 0; i--) {
      const code = kept[i].s[row.id];
      if (code == null || code === 0) break;
      streak++;
    }
    row.badDays30 = last30.filter((d) => d.s[row.id] != null && d.s[row.id] !== 0).length;
    row.streak = streak;
    row.review = row.state === "missing" || row.state === "unreadable" || streak >= SOURCE_REVIEW_STREAK;
  }
  const review = sources.filter((r) => r.review).length;
  return {
    v: SOURCE_HEALTH_VERSION,
    builtAtIso: builtAtIso || new Date(nowMs).toISOString(),
    reviewStreak: SOURCE_REVIEW_STREAK,
    counts: { sources: sources.length, ok: sources.filter((r) => r.state === "ok").length, review },
    sources,
    days: kept,
  };
}

export function stateName(code) {
  return CODE_STATE[code] || "ok";
}

export async function loadSourceHealth(dataDir) {
  try {
    const body = await readFile(resolve(dataDir, SOURCE_HEALTH_KEY), "utf8");
    const parsed = parseSourceHealth(body);
    return parsed ? { state: parsed, error: null } : { state: null, error: "unparseable" };
  } catch (err) {
    return { state: null, error: err?.code === "ENOENT" ? null : String(err?.message || err) };
  }
}

// Reads each source's payload from the bake's data directory.
export async function readSourcePayloads(dataDir, defs = SOURCES) {
  const out = new Map();
  for (const def of defs) {
    if (out.has(def.key)) continue;
    try {
      const body = await readFile(resolve(dataDir, def.key), "utf8");
      try { out.set(def.key, { payload: JSON.parse(body) }); } catch { out.set(def.key, { error: "invalid" }); }
    } catch { /* not written this run */ }
  }
  return out;
}

export async function writeSourceHealth(dataDir, payload) {
  const json = JSON.stringify(payload);
  await writeFile(resolve(dataDir, SOURCE_HEALTH_KEY), json, "utf8");
  return { key: SOURCE_HEALTH_KEY, bytes: json.length, sources: payload.sources.length, review: payload.counts?.review ?? 0 };
}

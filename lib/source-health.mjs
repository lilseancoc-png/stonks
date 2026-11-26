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
  { id: "yahoo-quotes", label: "Live quotes (heatmap)", provider: "Yahoo Finance", key: "heatmap.json", cadence: "hourly", builtAtCounts: true },
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
  // Dated by the newest flagged headline, and a quiet week has none: two weeks
  // without a flagged raise is normal, not a stalled source (2026-11-22).
  { id: "capital-raises", label: "Capital raises", provider: "SEC XBRL", key: "capital-raises.json", cadence: "daily", maxAgeHours: 14 * 24 },
  { id: "ipo-credit", label: "IPOs, bond issuance, credit", provider: "stockanalysis / EDGAR / SIFMA / FRED / NY Fed", key: "ipo-credit.json", cadence: "monthly" },
  { id: "pending-buyouts", label: "Pending buyouts", provider: "ditat.io / Yahoo news", key: "pending-buyouts.json", cadence: "daily" },
  { id: "f13", label: "13F holdings and Form 4", provider: "SEC EDGAR", key: "13f.json", cadence: "quarterly" },
  { id: "leverage-distress", label: "Hot funds and pledges", provider: "SEC EDGAR", key: "leverage-distress.json", cadence: "daily" },
  { id: "news", label: "News feeds", provider: "issuer feeds / RSS", key: "news-feed.json", cadence: "daily" },
  { id: "narratives", label: "Market narratives", provider: "Gemini", key: "trends.json", cadence: "daily" },
  { id: "briefs", label: "Brief", provider: "Gemini", key: "briefs.json", cadence: "daily" },
  { id: "earnings-history", label: "Earnings dates and prints", provider: "Yahoo Finance", key: "earnings-history.json", cadence: "daily" },
  { id: "earnings-calls", label: "Earnings call transcripts", provider: "Motley Fool / MarketBeat", key: "earnings-calls.json", cadence: "weekly" },
  { id: "bottom-tracker", label: "Credit spreads (Bottom tracker)", provider: "FRED", key: "bottom-tracker.json", cadence: "daily" },
  // Dated by the last session each market download confirmed (`confirmedThrough`
  // in the records); the cache had no observation dates of its own, so it read
  // ok however old it was (2026-11-22).
  { id: "historical-sources", label: "Long index and FRED history", provider: "Yahoo Finance / FRED", key: "historical-source-history.json", path: "records", cadence: "daily", obsKeys: ["confirmedThrough"] },
  // Monthly, but each month is published about two months after it ends
  // (IMF IFS), so the newest point is up to ~75 days old just before a release.
  { id: "central-bank-gold", label: "Central bank gold", provider: "World Gold Council / IMF", key: "central-bank-gold.json", cadence: "monthly", maxAgeHours: 80 * 24 },
  { id: "overnight-preopen", label: "Pre-open call", provider: "Yahoo Finance", key: "overnight-preopen.json", cadence: "daily" },
  { id: "ram-prices", label: "RAM prices", provider: "TrendForce / WhereIsMyRam", key: "ram-prices.json", cadence: "weekly" },
  { id: "accelerator-prices", label: "GPU cloud prices", provider: "Vast / CoreWeave / Runpod / Lambda", key: "accelerator-prices.json", cadence: "weekly" },
  { id: "search-interest", label: "Search interest", provider: "Google Trends", key: "search-interest.json", cadence: "weekly" },
  // These two are dated by the session they cover (the prior session), so a
  // Friday read is still newest all Tuesday after a Monday holiday.
  { id: "crowd-short-volume", label: "Short sale volume", provider: "FINRA Reg SHO", key: "crowd.json", path: "shortVolume", cadence: "daily", maxAgeHours: 5 * 24 },
  { id: "crowd-put-call", label: "Put/call ratios", provider: "Cboe", key: "crowd.json", path: "putCall", cadence: "daily", maxAgeHours: 5 * 24 },
  // crowd-borrow (IBKR) left the list 2026-11-13: the read is off by default
  // (lib/crowd/borrow.mjs), so it is not a source the site depends on.
  // Tuesday positions published the Friday after, so the newest report is
  // ten days old just before each release, and a holiday moves the release
  // to the Monday (Christmas 2026: the 12-15 report is still newest on 12-28).
  { id: "crowd-cot", label: "Commitments of Traders", provider: "CFTC", key: "crowd.json", path: "cot", cadence: "weekly", maxAgeHours: 15 * 24 },
  { id: "crowd-reddit", label: "Reddit mentions", provider: "ApeWisdom", key: "crowd.json", path: "reddit", cadence: "daily" },
  { id: "crowd-wikipedia", label: "Wikipedia page views", provider: "Wikimedia", key: "crowd.json", path: "wikipedia", cadence: "daily" },
  // crowd-lev-flows left the list 2026-11-22: off by default
  // (lib/crowd/lev-flows.mjs), Yahoo stopped sending the figures it needs.
  { id: "crowd-stocktwits", label: "Stocktwits watchers and trending", provider: "Stocktwits", key: "crowd.json", path: "stocktwits", cadence: "daily" },
  { id: "crowd-margin-debt", label: "Margin debt", provider: "FINRA", key: "crowd.json", path: "marginDebt", cadence: "monthly" },
  { id: "crowd-kalshi", label: "Kalshi odds", provider: "Kalshi", key: "crowd.json", path: "kalshi", cadence: "daily" },
  { id: "crowd-perps", label: "Stock perpetuals", provider: "Hyperliquid", key: "crowd.json", path: "perps", cadence: "daily" },
  { id: "prediction-kalshi", label: "Prediction market odds", provider: "Kalshi", key: "prediction-odds.json", path: "venues.kalshi", cadence: "daily" },
  { id: "prediction-polymarket", label: "Prediction market odds", provider: "Polymarket", key: "prediction-odds.json", path: "venues.polymarket", cadence: "daily" },
  { id: "federal-register", label: "Federal Register rules and orders", provider: "Federal Register", key: "policy-news.json", path: "fr", cadence: "daily" },
  // Dated only by the last day any stock was read (`lastOkDate`); `date` and
  // `health.ranAt` are the last attempt, not an observation. A block whose
  // `coverage` reads "low" or "none" (under half the covered stocks with a
  // fresh read) is partial: on 2026-11-23 four of 64 were read and this row
  // still said ok.
  { id: "gdelt-news", label: "News volume and tone", provider: "GDELT Project", key: "policy-news.json", path: "gdelt", cadence: "daily", obsOnly: ["lastOkDate"] },
  // The Webull data logs (W3, written after the close by the Vercel
  // webull-data runner, not by the bake). The Flow engine's big-order trial
  // reads the flow log; a runner that stops leaves it to age quietly, so the
  // bake reports the newest session each log holds (audit 2026-11-22).
  { id: "webull-flow", label: "Big-order flow", provider: "Webull OpenAPI", key: "webull-flow.json", cadence: "daily" },
  { id: "webull-breadth", label: "Whole-market breadth", provider: "Webull OpenAPI", key: "webull-breadth.json", cadence: "daily" },
  // The AI disruption collector's per-lab readers (one row each: ok, lastOk).
  // A lab page that changes its layout fails quietly while the others carry
  // on, so the list reports failed readers and the newest good read
  // (audit 2026-11-22). The collector runs once a trading day.
  { id: "ai-disruption", label: "AI lab release notes", provider: "AI lab blogs and release notes", key: "ai-disruption.json", path: "sources", cadence: "daily", feedList: true },
  // Providers with no row of their own until 2026-11-26 (stability audit):
  // each reads the bake's own record of what the provider answered.
  // Nasdaq's earnings-session lookup (AM / PM tags on the calendar).
  { id: "nasdaq-sessions", label: "Earnings session times (AM / PM)", provider: "Nasdaq", key: "calendar.json", path: "coverage.nasdaq", cadence: "daily", countOk: true, unchangedOk: true, check: "answered", answered: { ok: "succeeded", of: "requested", status: "status" } },
  // The weekly economic event feed behind the calendar's report rows.
  { id: "forex-factory", label: "Weekly economic events", provider: "ForexFactory", key: "calendar.json", path: "coverage.reportSources", cadence: "daily", countOk: true, unchangedOk: true, check: "status", statusField: "forexFactory" },
  // Google News RSS headlines per stock (real publisher names beside Yahoo's
  // feed). Not a file: the bake counts the names it asked and the names that
  // answered and passes { coverage } in (synthetic key, never written).
  { id: "google-news", label: "Headlines with publisher names", provider: "Google News RSS", key: "google-news-rss.synthetic", cadence: "daily", countOk: true, unchangedOk: true },
  // The S&P 500 and Nasdaq-100 member lists behind the wide tier, re-read at
  // most every 30 days (lib/wide-tier.mjs membersMaxAgeDays).
  { id: "index-members", label: "S&P 500 and Nasdaq-100 member lists", provider: "Wikipedia list / n100tickers", key: "wide-tier.json", path: "members", cadence: "monthly", countKey: "count", unchangedOk: true, check: "lastError", obsOnly: ["asOf"] },
]);

// Sources whose numbers can honestly stay the same from one session to the
// next, or whose main list honestly swings with the news, skip the generic
// unchanged / coverage checks below (countOk / unchangedOk on the row).
const EVENT_LIST_SOURCES = new Set(["calendar", "fedwatch", "oi-tracker", "unusual-flow", "capital-raises", "pending-buyouts", "news", "federal-register", "gdelt-news", "ai-disruption",
  "narratives", "briefs", "earnings-calls", "ipo-credit", "treasury-auctions", "crowd-kalshi", "prediction-kalshi", "prediction-polymarket", "crowd-stocktwits", "crowd-reddit"]);
const STEADY_SOURCES = new Set(["capital-raises", "treasury-auctions", "pending-buyouts", "earnings-history", "earnings-calls", "narratives", "briefs", "federal-register", "leverage-distress", "f13", "ai-capex"]);

export const SOURCE_STATES = Object.freeze(["ok", "partial", "carried", "aged", "missing", "unreadable"]);
const STATE_CODE = { ok: 0, partial: 1, carried: 2, aged: 3, missing: 4, unreadable: 5 };
const CODE_STATE = Object.fromEntries(Object.entries(STATE_CODE).map(([k, v]) => [v, k]));

// Dates that say when the data itself is from, and stamps that say when the
// bake read or wrote it. Within one object an observation date wins over a
// stamp: a weekly COT block carries `asOf` (the Tuesday report) beside
// `fetchedAt` (today's read), and taking the newest of both showed an
// eleven-day-old report as six hours old (review 2026-11-22). A stamp still
// counts on an object that has no observation date of its own.
const OBS_KEY_RE = /^(asOf|asOfIso|date|observedAt|observed_utc|lastDate|at|etDate|dataBuiltAtIso|publishedAt)$/;
const STAMP_KEY_RE = /^(fetchedAt|fetchedDate|updatedAt|updatedAtIso|scannedAt|capturedAt|aiGeneratedAtIso|generatedAtIso|refreshedAtIso)$/;
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
export function scanPayload(payload, nowMs = Date.now(), { obsKeys = null, obsOnly = null } = {}) {
  const extraObs = Array.isArray(obsKeys) && obsKeys.length ? new Set(obsKeys) : null;
  // obsOnly: only these keys date the payload (no observation or stamp
  // pattern), for a block whose other dates are attempt times.
  const onlyObs = Array.isArray(obsOnly) && obsOnly.length ? new Set(obsOnly) : null;
  const out = { at: null, flagged: 0, carried: 0, aged: 0, failed: 0, statuses: 0 };
  // Upcoming dates (next week's earnings, tomorrow's release) are not
  // observations; the old 36-hour slack let them show as "newest" (2026-11-12).
  const horizon = nowMs + 6 * 3600000;
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
    let obs = null;
    let stamp = null;
    for (const [key, value] of Object.entries(node)) {
      if (key === "builtAtIso" || key === "renderedAtIso") continue;
      const isObs = onlyObs ? onlyObs.has(key) : OBS_KEY_RE.test(key) || (extraObs != null && extraObs.has(key));
      if (isObs || (!onlyObs && STAMP_KEY_RE.test(key))) {
        const t = dateMs(value);
        if (t != null && t <= horizon) {
          if (isObs) obs = obs == null ? t : Math.max(obs, t);
          else stamp = stamp == null ? t : Math.max(stamp, t);
        }
        continue;
      }
      if (value && typeof value === "object") visit(value, depth + 1, key);
    }
    const t = obs ?? stamp;
    if (t != null && (out.at == null || t > out.at)) out.at = t;
  };
  visit(payload, 0, null);
  return out;
}

// A list of feed readers ({ ok, lastOk }): failed readers count as failed
// source checks and the newest good read is the observation.
function scanFeedList(list, nowMs) {
  const out = { at: null, flagged: 0, carried: 0, aged: 0, failed: 0, statuses: 0 };
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    out.statuses++;
    if (r.ok !== true) out.failed++;
    const t = dateMs(r.lastOk);
    if (t != null && t <= nowMs + 6 * 3600000 && (out.at == null || t > out.at)) out.at = t;
  }
  return out;
}

function selectPath(payload, path) {
  if (!path) return payload;
  return String(path).split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), payload);
}

// Row-specific checks for the providers added 2026-11-26 (def.check).
function customCheck(def, block) {
  if (!block || typeof block !== "object") return null;
  if (def.check === "answered") {
    const f = def.answered || {};
    const ok = Number(block[f.ok]), of = Number(block[f.of]);
    const status = typeof block[f.status] === "string" ? block[f.status] : null;
    if (status === "unavailable") return { state: "partial", detail: "The lookup did not answer this run." };
    if (Number.isFinite(ok) && Number.isFinite(of) && of > 0 && ok * 2 < of) return { state: "partial", detail: `Answered ${ok} of ${of} lookups.` };
    return null;
  }
  if (def.check === "status") {
    const v = block[def.statusField];
    if (v === "partial" || v === "unavailable") return { state: "partial", detail: `The feed read ${v} this run.` };
    return null;
  }
  if (def.check === "lastError") {
    if (block.lastError) return { state: "partial", detail: "The last re-read of the lists failed; the stored lists are in use." };
    return null;
  }
  return null;
}

// Generic value checks for every source (2026-11-26, stability audit): a
// feed that keeps answering but answers wrong. The leveraged-ETF flows read
// $0 for every fund while the Update Checker said ok.
const TIME_NUM_KEY_RE = /(At|Ms|Iso|Ts|Epoch|Sec|Time|time|date|Date|age|Age|hours|Hours|days|Days|stamp|Stamp|version|Version|ttl|Ttl)$|^(v|t|ts|version|year|month|day)$/;
const PROFILE_MAX_DEPTH = 5;
const PROFILE_MAX_NUMS = 4000;

// Numbers in a block: how many, how many are zero, a hash of them all (for
// "identical to the last session"), and, for lists of rows, which fields had
// any non-zero value. Timestamps and version numbers are left out.
export function numericProfile(block) {
  let count = 0, zeros = 0, h = 2166136261;
  const fields = new Map();
  const mix = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  const seen = new Set();
  const visit = (node, depth, key, rowField) => {
    if (count >= PROFILE_MAX_NUMS || depth > PROFILE_MAX_DEPTH) return;
    if (typeof node === "number") {
      if (!Number.isFinite(node) || (key && TIME_NUM_KEY_RE.test(key))) return;
      count++;
      if (node === 0) zeros++;
      mix(`${key || ""}=${node};`);
      if (rowField) {
        const f = fields.get(rowField) || { rows: 0, nonzero: 0 };
        f.rows++; if (node !== 0) f.nonzero++;
        fields.set(rowField, f);
      }
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const start = Math.max(0, node.length - ARRAY_SAMPLE);
      for (let i = start; i < node.length; i++) {
        const item = node[i];
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const [k, v] of Object.entries(item)) visit(v, depth + 1, k, typeof v === "number" ? k : null);
        } else visit(item, depth + 1, key, null);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) visit(v, depth + 1, k, null);
  };
  visit(block, 0, null, null);
  const live = [...fields].filter(([, f]) => f.rows >= 5 && f.nonzero > 0).map(([k]) => k).sort().slice(0, 40);
  const zeroed = [...fields].filter(([, f]) => f.rows >= 5 && f.nonzero === 0).map(([k]) => k);
  return { count, zeros, hash: count ? h.toString(36) : null, live, zeroed };
}

// The size of a block's main list: an array's length, else the biggest list
// or by-name map among its top-level fields (def.countKey names the count).
export function listCount(block, def = {}) {
  if (def.countKey && block && typeof block === "object") {
    const n = Number(block[def.countKey]);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(block)) return block.length;
  if (!block || typeof block !== "object") return null;
  let best = null;
  for (const v of Object.values(block)) {
    let n = null;
    if (Array.isArray(v)) n = v.length;
    else if (v && typeof v === "object") {
      const vals = Object.values(v);
      if (vals.length >= 3 && vals.filter((x) => x && typeof x === "object").length * 2 > vals.length) n = vals.length;
    }
    if (n != null && (best == null || n > best)) best = n;
  }
  return best;
}

const ZERO_FIELD_KEEP_DAYS = 7;
const daysApart = (a, b) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };

// Applies the generic checks to an ok row. `profile` from numericProfile,
// `count` from listCount, `priorRow` the same source in the last table,
// `priorCounts` its list sizes on earlier days. Returns the row with fp /
// fpSince / n / live set, and a partial state when a check fails.
export function applyValueChecks(row, def, { profile, count, priorRow = null, priorCounts = [], today } = {}) {
  const out = { ...row };
  if (profile) {
    out.fp = profile.hash;
    out.fpSince = profile.hash && priorRow?.fp === profile.hash && typeof priorRow.fpSince === "string" ? priorRow.fpSince : today;
    out.live = profile.live;
  }
  if (Number.isFinite(count)) out.n = count;
  // A field that had values and is now zero in every row stays on the live
  // list (so it keeps reading partial, and three days of it alert) until it
  // has been zero for ZERO_FIELD_KEEP_DAYS.
  let zeroedNow = [];
  if (profile) {
    const wasLive = new Set(Array.isArray(priorRow?.live) ? priorRow.live : []);
    const priorSince = priorRow?.zeroSince && typeof priorRow.zeroSince === "object" ? priorRow.zeroSince : {};
    const zeroSince = {};
    for (const k of profile.zeroed) {
      if (!wasLive.has(k)) continue;
      const since = typeof priorSince[k] === "string" ? priorSince[k] : today;
      if (today && daysApart(since, today) > ZERO_FIELD_KEEP_DAYS) continue;
      zeroSince[k] = since;
      zeroedNow.push(k);
    }
    out.live = [...new Set([...profile.live, ...zeroedNow])].sort().slice(0, 40);
    if (zeroedNow.length) out.zeroSince = zeroSince; else delete out.zeroSince;
  }
  if (row.state !== "ok" || !profile) return out;
  if (profile.count >= 6 && profile.zeros === profile.count) {
    return { ...out, state: "partial", detail: "Every number in it is zero." };
  }
  if (zeroedNow.length) {
    return { ...out, state: "partial", detail: `${zeroedNow.slice(0, 3).join(", ")} ${zeroedNow.length === 1 ? "is" : "are"} zero in every row, and had values in the last build.` };
  }
  const steady = def.unchangedOk || STEADY_SOURCES.has(def.id);
  if (!steady && (def.cadence === "daily" || def.cadence === "hourly") && profile.count >= 8 &&
      typeof out.fpSince === "string" && today && out.fpSince < today) {
    return { ...out, state: "partial", detail: `Every number is the same as on ${out.fpSince}.` };
  }
  const prior = priorCounts.filter((n) => Number.isFinite(n));
  const usual = median(prior.slice(-5));
  if (!def.countOk && !EVENT_LIST_SOURCES.has(def.id) && Number.isFinite(count) && usual != null && usual >= 5 && count * 2 < usual) {
    return { ...out, state: "partial", detail: `Covered ${count} items; usually about ${Math.round(usual)}.` };
  }
  return out;
}

// One source's state from its payload (null = not written, undefined entry
// error = unreadable).
export function assessSource(def, payload, nowMs = Date.now(), error = null) {
  const base = { id: def.id, label: def.label, provider: def.provider, key: def.key, cadence: def.cadence, at: null, ageHours: null, carried: 0, flagged: 0, aged: 0, failed: 0 };
  if (error) return { ...base, state: "unreadable", detail: "The payload could not be read as JSON." };
  const block = selectPath(payload, def.path);
  if (block == null) return { ...base, state: "missing", detail: def.path ? `No ${def.path} block in ${def.key}.` : `No ${def.key} was written.` };
  const scan = def.feedList && Array.isArray(block) ? scanFeedList(block, nowMs) : scanPayload(block, nowMs, { obsKeys: def.obsKeys, obsOnly: def.obsOnly });
  // The heatmap's quotes are taken when the file is written (by the bake or
  // the hourly refresh), so its build time is the observation; otherwise only
  // the previous close's date was found and every afternoon read "aged"
  // (audit 2026-11-12).
  if (def.builtAtCounts) {
    const t = dateMs(block?.refreshedAtIso) ?? dateMs(block?.builtAtIso);
    if (t != null && t <= nowMs + 6 * 3600000 && (scan.at == null || t > scan.at)) scan.at = t;
  }
  const at = scan.at != null ? new Date(scan.at).toISOString() : null;
  const ageHours = scan.at != null ? Math.max(0, Math.round((nowMs - scan.at) / 360000) / 10) : null;
  const allowance = def.maxAgeHours ?? SOURCE_AGE_HOURS[def.cadence] ?? SOURCE_AGE_HOURS.daily;
  const row = { ...base, at, ageHours, carried: scan.carried, flagged: scan.flagged, aged: scan.aged, failed: scan.failed };
  const topCarried = block && typeof block === "object" && !Array.isArray(block) && (block.stale === true || block.carriedForward === true);
  if (topCarried || (scan.carried > 0 && scan.carried * 2 >= scan.flagged)) {
    return { ...row, state: "carried", detail: topCarried ? "The whole payload is a carried last-good copy." : `${scan.carried} of ${scan.flagged} parts are carried last-good copies.` };
  }
  // A block that says how much of its list it covered (`coverage`: { fresh,
  // of, status }) is partial when it covered too little, with the count.
  const cov = block && typeof block === "object" && !Array.isArray(block) ? block.coverage : null;
  if (cov && typeof cov === "object" && Number(cov.of) > 0 && (cov.status === "low" || cov.status === "none")) {
    return { ...row, state: "partial", detail: `Fresh reads for ${Number(cov.fresh) || 0} of ${Number(cov.of)} names.` };
  }
  const custom = customCheck(def, block);
  if (custom) return { ...row, ...custom };
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
// feedChecks: the bake's automatic engine data checks (lib/data-checks.mjs
// compactChecks), carried as `engineFeeds` for the Update Checker; null when
// the checks are off.
export function buildSourceHealth({ payloads, prior = null, builtAtIso, now = null, feedChecks = null } = {}) {
  const nowMs = Number.isFinite(now) ? now : (Date.parse(builtAtIso || "") || Date.now());
  const today = etDateOf(builtAtIso) || new Date(nowMs).toISOString().slice(0, 10);
  const priorRows = new Map((prior?.sources || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const priorDays = (prior?.days || []).filter((d) => d.date !== today);
  const sources = SOURCES.map((def) => {
    const entry = payloads instanceof Map ? payloads.get(def.key) : payloads?.[def.key];
    if (!entry) return assessSource(def, null, nowMs);
    const row = assessSource(def, entry.payload ?? null, nowMs, entry.error || null);
    if (entry.error || entry.payload == null) return row;
    const block = selectPath(entry.payload, def.path);
    if (block == null || def.feedList) return row;
    try {
      return applyValueChecks(row, def, {
        profile: numericProfile(block),
        count: listCount(block, def),
        priorRow: priorRows.get(def.id) || null,
        priorCounts: priorDays.map((d) => d.n?.[def.id]),
        today,
      });
    } catch { return row; }
  });
  const days = priorDays.slice();
  // Within a day the worst state wins, so a morning miss that the afternoon
  // bake repaired still shows as a bad day in the history.
  const earlier = (prior?.days || []).find((d) => d.date === today)?.s || {};
  const s = {};
  for (const row of sources) {
    const code = STATE_CODE[row.state] ?? 0;
    const was = Number.isInteger(earlier[row.id]) ? earlier[row.id] : -1;
    s[row.id] = Math.max(code, was);
  }
  const n = {};
  for (const row of sources) if (Number.isFinite(row.n)) n[row.id] = row.n;
  // Engine feed fails by day (lib/data-checks.mjs), for the data-health
  // alert's three-day rule. Within a day a fail sticks.
  const f = {};
  const earlierF = (prior?.days || []).find((d) => d.date === today)?.f || {};
  for (const fd of Array.isArray(feedChecks?.feeds) ? feedChecks.feeds : []) {
    if (!fd || !fd.id) continue;
    f[fd.id] = fd.state === "fail" || earlierF[fd.id] === 1 ? 1 : 0;
  }
  days.push({ date: today, s, ...(Object.keys(n).length ? { n } : {}), ...(Object.keys(f).length ? { f } : {}) });
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
    ...(feedChecks && Array.isArray(feedChecks.feeds) ? { engineFeeds: feedChecks } : {}),
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

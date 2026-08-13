// Publish-time proof that the workflow's owned outputs were produced by THIS
// run. This is ownership-aware: a full bake rebuilds pricing and decision
// artifacts, while unusual flow, OI and search interest keep their own cadence.
//
// Usage:
//   node scripts/verify-data-freshness.mjs --owner=bake
//   node scripts/verify-data-freshness.mjs --owner=unusual
//   node scripts/verify-data-freshness.mjs --owner=oi
//   node scripts/verify-data-freshness.mjs --owner=search-interest
//   node scripts/verify-data-freshness.mjs --owner=daytrading
//   node scripts/verify-data-freshness.mjs --self-test

import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TICKERS } from "./build.mjs";
import {
  isBakeOwnedKey,
  isRetainedRemoteBakeKey,
  isTickerDataKey,
} from "../lib/data-ownership.mjs";
import {
  MIN_IV_SUCCESS_RATE,
  MIN_TICKER_SUCCESS_RATE,
} from "../lib/freshness-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_DATA_DIR = resolve(ROOT, "data");
const CLOCK_SLOP_MS = 5000;
// File mtimes come from the same runner clock as FRESHNESS_RUN_STARTED_AT. Do
// not apply the payload timestamp slop here: even a one-second allowance could
// let a just-hydrated prior-run file masquerade as this run's rewrite.
const FILE_MTIME_SLOP_MS = 0;
const FUTURE_SLOP_MS = 5 * 60000;
const STAMP_MATCH_MS = 1500;
// Must match scan-oi.mjs's publication guard. Keeping this verifier-side
// invariant explicit prevents a malformed or hand-produced scanner payload
// from bypassing the scanner's last-good-data protection.
const MIN_OI_SURFACED_COVERAGE_RATE = 0.25;
const MIN_OI_FETCH_SUCCESS_RATE = 0.5;

const BAKE_STAMPED_FILES = [
  "auto-picks.json",
  "trends.json",
  "grades.json",
  "calendar.json",
  "heatmap.json",
  "correlations.json",
  "streaks.json",
  "market-analysis.json",
  "ma-tracker.json",
  "stock-picks.json",
  "sector-rotation.json",
  "leveraged-etfs.json",
  "iv-trending.json",
  "quant.json",
  "news-feed.json",
  "13f.json",
];

// Every static object the full bake is expected to leave behind. Some are
// current decision payloads, some are context/history, and some are caches;
// all must at least be valid JSON rewritten by the completed build. This is
// intentionally explicit: an added bake-owned key fails as unclassified until
// its freshness semantics are reviewed here.
const BAKE_REQUIRED_REWRITTEN_FILES = [
  "13f.json",
  "ai-capex.json",
  "ai-usage.json",
  "auto-picks.json",
  "briefs.json",
  "calendar.json",
  "capital-raises.json",
  "central-bank-gold.json",
  "chart-pattern-cache.json",
  "commodities.json",
  "correlations.json",
  "earnings-calls.json",
  "earnings-history.json",
  "earnings-tracker.json",
  "fear-greed-history.json",
  "fear-greed.json",
  "fedwatch-history.json",
  "grades-daily.json",
  "grades-history.json",
  "grades.json",
  "heatmap.json",
  "index-calendar.json",
  "ipo-credit.json",
  "iv-trending.json",
  "leveraged-etfs-log.json",
  "leveraged-etfs.json",
  "macro-history.json",
  "macro.json",
  "ma-tracker.json",
  "manifest-free.json",
  "manifest.json",
  "market-analysis.json",
  "market-structure.json",
  "news-feed.json",
  "pick-thesis-cache.json",
  "picks-accuracy.json",
  "picks-changes.json",
  "picks-open.json",
  "picks-roster.json",
  "picks.json",
  "prediction-history.json",
  "quant-history.json",
  "quant.json",
  "regime-history.json",
  "rfr-history.json",
  "sector-rotation-log.json",
  "sector-rotation.json",
  "spillover-log.json",
  "spillover-pairs.json",
  "stock-picks.json",
  "streaks.json",
  "ticker-judgment-cache.json",
  "trends-history.json",
  "trends.json",
];

const BAKE_STATIC_KEYS = new Set(BAKE_REQUIRED_REWRITTEN_FILES);

const CONTEXT_CAN_BE_EXPLICITLY_STALE = [
  "earnings-tracker.json",
  "earnings-calls.json",
  "ai-capex.json",
  "capital-raises.json",
  "central-bank-gold.json",
  "ram-prices.json",
  "accelerator-prices.json",
  "commodities.json",
  "ipo-credit.json",
  "spillover-pairs.json",
];

function parseArgs(argv) {
  const out = {
    owner: null,
    dataDir: DEFAULT_DATA_DIR,
    runStartedAt: process.env.FRESHNESS_RUN_STARTED_AT || null,
    selfTest: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--owner=")) out.owner = arg.slice("--owner=".length);
    else if (arg.startsWith("--data-dir=")) out.dataDir = resolve(arg.slice("--data-dir=".length));
    else if (arg.startsWith("--run-started-at=")) out.runStartedAt = arg.slice("--run-started-at=".length);
    else if (arg === "--self-test") out.selfTest = true;
  }
  return out;
}

function validMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function etParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function etDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const row = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${row.year}-${row.month}-${row.day}`;
}

function isEtMarketWindow(date) {
  const parts = etParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 17 * 60;
}

async function readJson(dataDir, key) {
  return JSON.parse(await readFile(resolve(dataDir, key), "utf8"));
}

function stampOf(payload, paths = ["builtAtIso"]) {
  for (const path of paths) {
    let current = payload;
    for (const part of path.split(".")) current = current?.[part];
    if (validMs(current) != null) return current;
  }
  return null;
}

function makeReport(owner, dataDir, runStartedAt, now) {
  return {
    owner,
    dataDir,
    runStartedAt: runStartedAt.toISOString(),
    checkedAt: now.toISOString(),
    checks: [],
    warnings: [],
    errors: [],
  };
}

function pass(report, message) {
  report.checks.push(message);
}

function warn(report, message) {
  report.warnings.push(message);
}

function fail(report, message) {
  report.errors.push(message);
}

function requireRunStamp(report, key, value, runStartedAt, now) {
  const ms = validMs(value);
  if (ms == null) {
    fail(report, `${key}: missing/invalid freshness timestamp`);
    return null;
  }
  if (ms < runStartedAt.getTime() - CLOCK_SLOP_MS) {
    fail(report, `${key}: timestamp ${value} predates this run (${runStartedAt.toISOString()})`);
  } else if (ms > now.getTime() + FUTURE_SLOP_MS) {
    fail(report, `${key}: timestamp ${value} is implausibly in the future`);
  } else {
    pass(report, `${key}: fresh at ${value}`);
  }
  return ms;
}

async function requireJson(report, dataDir, key) {
  try {
    const payload = await readJson(dataDir, key);
    pass(report, `${key}: valid JSON`);
    return payload;
  } catch (err) {
    fail(report, `${key}: missing or invalid JSON (${String(err?.message || err).split("\n")[0]})`);
    return null;
  }
}

async function localKeys(dataDir) {
  if (!existsSync(dataDir)) return [];
  const entries = await readdir(dataDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const abs = resolve(entry.parentPath || entry.path, entry.name);
      return abs.slice(dataDir.length + 1).split(/[\\/]/).join("/");
    })
    .sort();
}

async function requireRewrittenJson(report, dataDir, key, runStartedAt) {
  const payload = await requireJson(report, dataDir, key);
  if (!payload) return null;
  try {
    const fileStat = await stat(resolve(dataDir, key));
    if (fileStat.mtimeMs < runStartedAt.getTime() - FILE_MTIME_SLOP_MS) {
      fail(report, `${key}: was not rewritten by this run`);
    } else {
      pass(report, `${key}: rewritten by this run`);
    }
  } catch (err) {
    fail(report, `${key}: cannot stat file (${String(err?.message || err).split("\n")[0]})`);
  }
  return payload;
}

function latestSnapshot(payload) {
  const rows = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  return rows.reduce((latest, row) => {
    const ms = validMs(row?.scannedAt);
    return ms != null && (!latest || ms > latest.ms) ? { row, ms } : latest;
  }, null);
}

async function requireCurrentHistorySnapshot(
  report,
  dataDir,
  key,
  runStartedAt,
  now,
  canonicalMs = null,
) {
  const payload = await requireJson(report, dataDir, key);
  if (!payload) return null;
  const latest = latestSnapshot(payload);
  const value = latest?.row?.scannedAt || null;
  const ms = requireRunStamp(report, `${key} latest snapshot`, value, runStartedAt, now);
  if (ms != null && canonicalMs != null && Math.abs(ms - canonicalMs) > STAMP_MATCH_MS) {
    fail(report, `${key}: latest snapshot does not match its current payload scan`);
  }
  return payload;
}

async function requireStampedFile(
  report,
  dataDir,
  key,
  canonicalMs,
  runStartedAt,
  now,
  paths = ["builtAtIso"],
) {
  const payload = await requireJson(report, dataDir, key);
  if (!payload) return null;
  if (payload.stale === true) {
    fail(report, `${key}: explicitly marked stale`);
  }
  const value = stampOf(payload, paths);
  const ms = requireRunStamp(report, key, value, runStartedAt, now);
  if (ms != null && canonicalMs != null && Math.abs(ms - canonicalMs) > STAMP_MATCH_MS) {
    fail(report, `${key}: ${value} does not match canonical bake ${new Date(canonicalMs).toISOString()}`);
  }
  return payload;
}

async function warnCadence(report, dataDir, key, paths, maxAgeMs, now) {
  try {
    const payload = await readJson(dataDir, key);
    const value = stampOf(payload, paths);
    const ms = validMs(value);
    if (ms == null) return warn(report, `${key}: no usable source timestamp`);
    const age = now.getTime() - ms;
    if (age < -FUTURE_SLOP_MS) warn(report, `${key}: source timestamp is in the future (${value})`);
    else if (age > maxAgeMs) warn(report, `${key}: outside cadence (${(age / 3600000).toFixed(1)}h old; ${value})`);
    else pass(report, `${key}: within cadence (${(age / 60000).toFixed(0)}m old)`);
  } catch {
    warn(report, `${key}: missing; this run cannot use its cross-cadence context`);
  }
}

async function auditBake({ report, dataDir, runStartedAt, now, expectedSymbols }) {
  const refreshTopPicks = !/^(?:0|false)$/i.test(process.env.REFRESH_TOP_PICKS || "1");
  const stampedFiles = refreshTopPicks
    ? [...BAKE_STAMPED_FILES, "picks.json", "picks-open.json"]
    : BAKE_STAMPED_FILES;
  const grades = await requireJson(report, dataDir, "grades.json");
  const canonicalValue = stampOf(grades);
  const canonicalMs = requireRunStamp(report, "grades.json", canonicalValue, runStartedAt, now);

  const symbols = expectedSymbols.filter((symbol) => existsSync(resolve(dataDir, `${symbol}.json`)));
  const minimum = Math.ceil(expectedSymbols.length * MIN_TICKER_SUCCESS_RATE);
  if (symbols.length < minimum) fail(report, `ticker coverage ${symbols.length}/${expectedSymbols.length}; need at least ${minimum}`);
  else pass(report, `ticker coverage ${symbols.length}/${expectedSymbols.length}`);

  let validTickerFiles = 0;
  const quoteDates = [];
  const tickerQuoteRows = [];
  const marketStates = [];
  const tickerPayloads = new Map();
  for (const symbol of symbols) {
    const key = `${symbol}.json`;
    try {
      const path = resolve(dataDir, key);
      const [payload, fileStat] = await Promise.all([readJson(dataDir, key), stat(path)]);
      if (!(Number.isFinite(payload?.spot) && payload.spot > 0)) throw new Error("invalid spot");
      if (!payload?.chains || typeof payload.chains !== "object") throw new Error("missing chains");
      if (!payload?.technicals || typeof payload.technicals !== "object") throw new Error("missing technicals");
      const chainRows = Object.values(payload.chains);
      const contractCount = chainRows.reduce(
        (sum, row) => sum + (Array.isArray(row?.c) ? row.c.length : 0) + (Array.isArray(row?.p) ? row.p.length : 0),
        0,
      );
      if (!chainRows.length || contractCount < 2) throw new Error("empty/thin option chain");
      if (
        !Array.isArray(payload?.priceSeries?.t) ||
        !Array.isArray(payload?.priceSeries?.c) ||
        payload.priceSeries.t.length < 20 ||
        payload.priceSeries.c.length !== payload.priceSeries.t.length
      ) {
        throw new Error("thin/invalid priceSeries");
      }
      if (fileStat.mtimeMs < runStartedAt.getTime() - FILE_MTIME_SLOP_MS) throw new Error("file was not rewritten this run");
      const quoteMs = validMs(payload.quoteAsOf);
      if (quoteMs == null) throw new Error("missing quoteAsOf provenance");
      quoteDates.push(quoteMs);
      tickerQuoteRows.push({ symbol, quoteMs });
      if (typeof payload.marketState === "string" && payload.marketState) marketStates.push(payload.marketState);
      else throw new Error("missing marketState provenance");
      tickerPayloads.set(symbol, payload);
      validTickerFiles += 1;
    } catch (err) {
      fail(report, `${key}: ${String(err?.message || err).split("\n")[0]}`);
    }
  }
  if (validTickerFiles === symbols.length) pass(report, `${validTickerFiles} ticker files passed schema + rewrite checks`);

  const regularCount = marketStates.filter((state) => state === "REGULAR").length;
  if (validTickerFiles > 0 && regularCount >= Math.ceil(validTickerFiles / 2)) {
    const currentEtDate = etDateKey(now);
    const staleQuotes = tickerQuoteRows.filter((row) => etDateKey(new Date(row.quoteMs)) !== currentEtDate);
    if (staleQuotes.length) {
      fail(
        report,
        `${staleQuotes.length} ticker quote(s) are not from the current ET session while the market is regular: ${staleQuotes.slice(0, 8).map((row) => row.symbol).join(", ")}${staleQuotes.length > 8 ? ", ..." : ""}`,
      );
    } else {
      pass(report, `all ${tickerQuoteRows.length} quotes are from the current ET session`);
    }
  } else {
    pass(report, `quote-session date check skipped outside regular trading (${regularCount}/${validTickerFiles} REGULAR)`);
  }

  const gradeCount = grades?.grades && typeof grades.grades === "object"
    ? Object.keys(grades.grades).length
    : 0;
  if (gradeCount !== symbols.length) fail(report, `grades.json covers ${gradeCount} names but ${symbols.length} ticker files were rebuilt`);
  else pass(report, `grades.json coverage matches ticker files (${gradeCount})`);

  // Cost-control may retain an AM/PM chart read after a newer 30-minute bar
  // arrives, but that payload must be display-only everywhere. Prove the
  // published grade did not accidentally score a stale cached pattern.
  let staleChartRows = 0;
  for (const [symbol, payload] of tickerPayloads) {
    if (payload?.technicals?.chartPattern?.stale !== true) continue;
    staleChartRows += 1;
    const signals = grades?.grades?.[symbol]?.pillars?.technicals?.signals;
    const signal = Array.isArray(signals) ? signals.find((row) => row?.key === "chartPattern") : null;
    if (!signal || signal.score !== 0 || signal.available !== false) {
      fail(report, `${symbol}: stale chart pattern is not quarantined in grades.json`);
    }
  }
  if (staleChartRows > 0 && !report.errors.some((message) => message.includes("stale chart pattern is not quarantined"))) {
    pass(report, `${staleChartRows} changed-bar chart pattern(s) are display-only in grades.json`);
  }

  for (const key of stampedFiles) {
    if (key !== "grades.json") {
      await requireStampedFile(report, dataDir, key, canonicalMs, runStartedAt, now);
    }
  }
  if (!refreshTopPicks) {
    for (const key of ["picks.json", "picks-open.json"]) {
      await requireRewrittenJson(report, dataDir, key, runStartedAt);
    }
    pass(report, "Top Picks cadence is carry-forward for this bake");
  }

  // Prove that every static object the bake owns was recreated after the
  // destructive data/ wipe. Semantic stamps above remain the stronger proof
  // for decision payloads; this catches silent non-fatal skips that would
  // otherwise leave an older private-store object serving indefinitely.
  for (const key of BAKE_REQUIRED_REWRITTEN_FILES) {
    await requireRewrittenJson(report, dataDir, key, runStartedAt);
  }

  // IV ranks now participate in structure selection. Whenever a ticker ships
  // one, it must be tied to today's in-memory ATM-IV sample and match the
  // published iv-history series. Missing current IV is represented by omitting
  // ivRank, never by silently using yesterday's regime.
  let currentIvRanks = 0;
  let currentIvSamples = 0;
  for (const [symbol, payload] of tickerPayloads) {
    const key = `iv-history/${symbol}.json`;
    let history = null;
    try { history = await readJson(dataDir, key); } catch { /* counted in aggregate below */ }
    const latest = Array.isArray(history?.entries) ? history.entries.at(-1) : null;
    const latestIv = Number(latest?.iv);
    const capturedMs = validMs(latest?.capturedAtIso);
    const isCurrentSample = latest?.date === etDateKey(now) &&
      latestIv >= 0.02 && latestIv <= 5 &&
      capturedMs != null && capturedMs >= runStartedAt.getTime() - CLOCK_SLOP_MS;
    if (isCurrentSample) currentIvSamples += 1;

    if (payload?.ivRank) {
      currentIvRanks += 1;
      const asOf = payload.ivRank.asOf;
      if (asOf !== etDateKey(now)) {
        fail(report, `${symbol}.json: ivRank is not from the current ET date (${asOf || "missing"})`);
      } else if (!isCurrentSample) {
        fail(report, `${key}: current-run sample does not support the published ivRank`);
      } else if (Math.abs(latestIv - Number(payload.ivRank.iv)) > 0.0001) {
        fail(report, `${key}: latest IV does not match ${symbol}.json ivRank`);
      } else {
        pass(report, `${symbol}: current IV rank matches published history`);
      }
    }
  }
  const minimumIvSamples = Math.ceil(symbols.length * MIN_IV_SUCCESS_RATE);
  if (regularCount >= Math.ceil(validTickerFiles / 2)) {
    if (currentIvSamples < minimumIvSamples) {
      fail(report, `current decision-grade IV coverage ${currentIvSamples}/${symbols.length}; need at least ${minimumIvSamples} during regular trading`);
    } else {
      pass(report, `current decision-grade IV coverage ${currentIvSamples}/${symbols.length}`);
    }
  } else if (currentIvSamples < minimumIvSamples) {
    warn(report, `current decision-grade IV coverage is ${currentIvSamples}/${symbols.length} outside regular option trading; stale ranks remain excluded`);
  } else {
    pass(report, `current decision-grade IV coverage ${currentIvSamples}/${symbols.length}`);
  }
  pass(report, `${currentIvRanks} ticker(s) carry a statistically ranked current IV sample`);

  const macro = await requireJson(report, dataDir, "macro.json");
  if (macro) {
    if (macro.stale === true) fail(report, "macro.json: explicitly marked stale");
    requireRunStamp(report, "macro.json", stampOf(macro, ["asOf"]), runStartedAt, now);
    const macroLegs = ["twoY", "tenY", "thirtyY", "dxy", "vix"]
      .filter((key) => Number.isFinite(macro?.[key]?.value));
    if (macroLegs.length < 3) fail(report, `macro.json has only ${macroLegs.length}/5 live market legs`);
    else pass(report, `macro.json has ${macroLegs.length}/5 live market legs`);
  }

  for (const key of ["manifest.json", "manifest-free.json"]) {
    const sidecar = await requireJson(report, dataDir, key);
    if (!sidecar) continue;
    const dataMs = requireRunStamp(
      report,
      `${key} data provenance`,
      stampOf(sidecar, ["_meta.dataBuiltAtIso"]),
      runStartedAt,
      now,
    );
    requireRunStamp(
      report,
      `${key} render provenance`,
      stampOf(sidecar, ["_meta.renderedAtIso"]),
      runStartedAt,
      now,
    );
    if (dataMs != null && canonicalMs != null && Math.abs(dataMs - canonicalMs) > STAMP_MATCH_MS) {
      fail(report, `${key}: data provenance does not match canonical bake`);
    }
  }

  for (const key of CONTEXT_CAN_BE_EXPLICITLY_STALE) {
    try {
      const payload = await readJson(dataDir, key);
      if (payload?.stale === true) {
        warn(report, `${key}: explicitly stale context was re-evaluated and carried forward`);
      }
    } catch {
      // Required-file checks above already report absence/corruption.
    }
  }

  const expectedSet = new Set(expectedSymbols);
  const unclassified = [];
  for (const key of await localKeys(dataDir)) {
    if (!isBakeOwnedKey(key)) continue;
    if (BAKE_STATIC_KEYS.has(key)) continue;
    if (isTickerDataKey(key) && expectedSet.has(key.slice(0, -5))) continue;
    if (/^iv-history\/[A-Z0-9.]+\.json$/.test(key) && expectedSet.has(key.slice(11, -5))) continue;
    if (isRetainedRemoteBakeKey(key)) {
      await requireRewrittenJson(report, dataDir, key, runStartedAt);
      continue;
    }
    unclassified.push(key);
  }
  if (unclassified.length) {
    fail(report, `unclassified bake-owned key(s) would be uploaded: ${unclassified.slice(0, 12).join(", ")}${unclassified.length > 12 ? ", ..." : ""}`);
  } else {
    pass(report, "every bake-owned local key has an explicit publication policy");
  }

  if (isEtMarketWindow(now)) {
    await warnCadence(report, dataDir, "unusual.json", ["scannedAt"], 90 * 60000, now);
    await warnCadence(report, dataDir, "volume-flags.json", ["scannedAt"], 90 * 60000, now);
  }
  await warnCadence(report, dataDir, "oi-tracker.json", ["scannedAt"], 12 * 3600000, now);
  await warnCadence(report, dataDir, "search-interest.json", ["builtAtIso"], 9 * 86400000, now);

  if (quoteDates.length) {
    const newest = Math.max(...quoteDates);
    const oldest = Math.min(...quoteDates);
    pass(report, `quote provenance spans ${new Date(oldest).toISOString()} to ${new Date(newest).toISOString()}`);
  }
}

async function auditUnusual({ report, dataDir, runStartedAt, now }) {
  for (const [key, paths] of [
    ["unusual.json", ["scannedAt"]],
    ["unusual-log.json", ["updatedAt"]],
    ["volume-flags.json", ["scannedAt"]],
    ["heatmap.json", ["refreshedAtIso"]],
    ["market-analysis.json", ["refreshedAtIso"]],
  ]) {
    await requireStampedFile(report, dataDir, key, null, runStartedAt, now, paths);
  }
  const unusualPayload = await requireJson(report, dataDir, "unusual.json");
  const volumePayload = await requireJson(report, dataDir, "volume-flags.json");
  await requireCurrentHistorySnapshot(
    report,
    dataDir,
    "unusual-history.json",
    runStartedAt,
    now,
    validMs(unusualPayload?.scannedAt),
  );
  await requireCurrentHistorySnapshot(
    report,
    dataDir,
    "volume-history.json",
    runStartedAt,
    now,
    validMs(volumePayload?.scannedAt),
  );
  const explanations = await requireRewrittenJson(
    report,
    dataDir,
    "flow-explanations.json",
    runStartedAt,
  );
  if (explanations?.mode !== "deterministic-v1") {
    fail(report, "flow-explanations.json: missing deterministic explanation provenance");
  }
  await requireRewrittenJson(report, dataDir, "ai-usage.json", runStartedAt);
  for (const key of ["manifest.json", "manifest-free.json"]) {
    await requireStampedFile(report, dataDir, key, null, runStartedAt, now, ["_meta.renderedAtIso"]);
  }
}

async function auditOi({ report, dataDir, runStartedAt, now }) {
  const tracker = await requireStampedFile(report, dataDir, "oi-tracker.json", null, runStartedAt, now, ["scannedAt"]);
  const history = await requireCurrentHistorySnapshot(
    report,
    dataDir,
    "oi-history.json",
    runStartedAt,
    now,
    validMs(tracker?.scannedAt),
  );

  if (tracker) {
    const rows = Array.isArray(tracker.tickers) ? tracker.tickers : null;
    const scanned = tracker?.summary?.scanned;
    const failed = tracker?.summary?.failed;
    const declaredCount = tracker?.summary?.tickerCount;
    if (!rows) {
      fail(report, "oi-tracker.json: tickers must be an array");
    } else if (!rows.length) {
      fail(report, "oi-tracker.json: no surfaced tickers; refusing an empty OI publication");
    } else {
      const invalidRows = rows.filter((row) =>
        !row?.symbol ||
        !(Number.isFinite(row?.spot) && row.spot > 0) ||
        !(Number.isFinite(row?.callOiTotal) && row.callOiTotal >= 0) ||
        !(Number.isFinite(row?.putOiTotal) && row.putOiTotal >= 0) ||
        row.callOiTotal + row.putOiTotal <= 0 ||
        !Array.isArray(row?.strikes) ||
        !row.strikes.length);
      if (invalidRows.length) {
        fail(report, `oi-tracker.json: ${invalidRows.length} surfaced ticker row(s) have no usable OI/strikes`);
      } else {
        pass(report, `oi-tracker.json: ${rows.length} surfaced ticker row(s) have usable OI`);
      }
      if (new Set(rows.map((row) => row?.symbol)).size !== rows.length) {
        fail(report, "oi-tracker.json: duplicate surfaced ticker symbols");
      }
    }

    if (!Number.isInteger(scanned) || scanned <= 0) {
      fail(report, "oi-tracker.json: summary.scanned must be a positive integer");
    }
    if (!Number.isInteger(failed) || failed < 0) {
      fail(report, "oi-tracker.json: summary.failed must be a non-negative integer");
    }
    if (rows && declaredCount !== rows.length) {
      fail(report, `oi-tracker.json: summary.tickerCount ${declaredCount} does not match ${rows.length} ticker row(s)`);
    }
    if (rows && Number.isInteger(scanned) && scanned > 0) {
      const coverage = rows.length / scanned;
      if (rows.length > scanned) {
        fail(report, `oi-tracker.json: surfaced ticker count ${rows.length} exceeds fetched count ${scanned}`);
      } else if (coverage < MIN_OI_SURFACED_COVERAGE_RATE) {
        fail(
          report,
          `oi-tracker.json: surfaced coverage ${(coverage * 100).toFixed(0)}% is below ${MIN_OI_SURFACED_COVERAGE_RATE * 100}%`,
        );
      } else {
        pass(report, `oi-tracker.json: surfaced coverage ${(coverage * 100).toFixed(0)}%`);
      }
    }
    if (Number.isInteger(scanned) && scanned > 0 && Number.isInteger(failed) && failed >= 0) {
      const attempted = scanned + failed;
      const successRate = scanned / attempted;
      if (successRate < MIN_OI_FETCH_SUCCESS_RATE) {
        fail(
          report,
          `oi-tracker.json: fetch success ${(successRate * 100).toFixed(0)}% is below ${MIN_OI_FETCH_SUCCESS_RATE * 100}%`,
        );
      } else {
        pass(report, `oi-tracker.json: fetch success ${(successRate * 100).toFixed(0)}%`);
      }
    }
  }

  if (history) {
    const current = latestSnapshot(history)?.row;
    const contracts = Array.isArray(current?.contracts) ? current.contracts : null;
    if (!contracts?.length) {
      fail(report, "oi-history.json: latest snapshot has no contracts");
    } else {
      const malformed = contracts.filter((contract) =>
        !contract?.symbol ||
        !["call", "put"].includes(contract?.side) ||
        !(Number.isFinite(contract?.strike) && contract.strike > 0) ||
        !(Number.isFinite(contract?.expSec) && contract.expSec > 0) ||
        !(Number.isFinite(contract?.oi) && contract.oi >= 0));
      if (malformed.length) {
        fail(report, `oi-history.json: latest snapshot has ${malformed.length} malformed contract row(s)`);
      } else {
        pass(report, `oi-history.json: latest snapshot has ${contracts.length} usable contract row(s)`);
      }
      if (Array.isArray(tracker?.tickers)) {
        const positiveOiSymbols = new Set(
          contracts.filter((contract) => contract?.oi > 0).map((contract) => contract.symbol),
        );
        const missing = tracker.tickers
          .map((row) => row?.symbol)
          .filter((symbol) => symbol && !positiveOiSymbols.has(symbol));
        if (missing.length) {
          fail(
            report,
            `oi-history.json: latest snapshot lacks positive-OI contracts for surfaced ticker(s): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}`,
          );
        } else if (tracker.tickers.length) {
          pass(report, "oi-history.json: latest snapshot covers every surfaced ticker");
        }
      }
    }
  }
  for (const key of ["manifest.json", "manifest-free.json"]) {
    await requireStampedFile(report, dataDir, key, null, runStartedAt, now, ["_meta.renderedAtIso"]);
  }
}

async function auditSearchInterest({ report, dataDir, runStartedAt, now }) {
  for (const key of ["search-interest.json", "ram-prices.json", "accelerator-prices.json"]) {
    await requireStampedFile(report, dataDir, key, null, runStartedAt, now);
  }
}

async function auditBrief({ report, dataDir, runStartedAt, now }) {
  const payload = await requireStampedFile(
    report,
    dataDir,
    "briefs.json",
    null,
    runStartedAt,
    now,
    ["builtAtIso"],
  );
  const current = payload?.current;
  if (!current || typeof current !== "object") {
    fail(report, "briefs.json: missing current morning brief");
  } else {
    const generatedMs = validMs(current.generatedAtIso);
    const generated = generatedMs == null ? null : new Date(generatedMs);
    if (current.date !== etDateKey(now)) {
      fail(report, `briefs.json: current brief is for ${current.date || "an unknown date"}, not ${etDateKey(now)}`);
    }
    if (current.kind !== "morning" || Number(current.etHour) !== 8) {
      fail(report, `briefs.json: expected an 08:xx ET morning brief, found ${current.kind || "unknown"} at ${current.etHour ?? "unknown"}`);
    }
    if (!generated || etDateKey(generated) !== etDateKey(now) || Number(etParts(generated).hour) !== 8) {
      fail(report, "briefs.json: generatedAtIso is not from today's 08:xx ET brief window");
    } else {
      pass(report, `briefs.json: current morning brief was minted at ${current.generatedAtIso}`);
    }
  }
  await requireRewrittenJson(report, dataDir, "ai-usage.json", runStartedAt);
}

async function auditDayTrading({ report, dataDir, runStartedAt, now }) {
  const snapshot = await requireStampedFile(report, dataDir, "day-trading.json", null, runStartedAt, now, ["updatedAt"]);
  const history = await requireStampedFile(report, dataDir, "day-trading-history.json", null, runStartedAt, now, ["updatedAt"]);
  if (!snapshot?.portfolios?.stock || snapshot?.portfolios?.options) {
    fail(report, "day-trading.json: expected the stock-only portfolio summary");
  }
  if (!history?.portfolios?.stock || history?.portfolios?.options) {
    fail(report, "day-trading-history.json: expected the stock-only ledger");
  }
}

export async function auditFreshness({
  owner,
  dataDir = DEFAULT_DATA_DIR,
  runStartedAt = null,
  now = new Date(),
  expectedSymbols = TICKERS,
} = {}) {
  if (!["bake", "unusual", "oi", "brief", "search-interest", "daytrading"].includes(owner)) {
    throw new Error("owner must be bake|unusual|oi|brief|search-interest|daytrading");
  }
  const startMs = validMs(runStartedAt);
  if (startMs == null) {
    throw new Error("FRESHNESS_RUN_STARTED_AT (or --run-started-at) must be a valid ISO timestamp");
  }
  const start = new Date(startMs);
  const report = makeReport(owner, dataDir, start, now);
  if (owner === "bake") await auditBake({ report, dataDir, runStartedAt: start, now, expectedSymbols });
  else if (owner === "unusual") await auditUnusual({ report, dataDir, runStartedAt: start, now });
  else if (owner === "oi") await auditOi({ report, dataDir, runStartedAt: start, now });
  else if (owner === "brief") await auditBrief({ report, dataDir, runStartedAt: start, now });
  else if (owner === "daytrading") await auditDayTrading({ report, dataDir, runStartedAt: start, now });
  else await auditSearchInterest({ report, dataDir, runStartedAt: start, now });
  return report;
}

function renderReport(report) {
  const status = report.errors.length ? "FAIL" : report.warnings.length ? "PASS WITH WARNINGS" : "PASS";
  return [
    `Data freshness: ${status} (${report.owner})`,
    `  ${report.checks.length} checks passed, ${report.warnings.length} warning(s), ${report.errors.length} error(s)`,
    ...report.warnings.map((message) => `  WARNING: ${message}`),
    ...report.errors.map((message) => `  ERROR: ${message}`),
  ].join("\n");
}

async function writeStepSummary(report) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const status = report.errors.length ? "FAIL" : report.warnings.length ? "PASS WITH WARNINGS" : "PASS";
  const body = [
    `### Data freshness: ${status}`,
    "",
    `Owner: \`${report.owner}\` · ${report.checks.length} checks · ${report.warnings.length} warnings · ${report.errors.length} errors`,
    "",
    ...report.warnings.map((message) => `- ⚠️ ${message}`),
    ...report.errors.map((message) => `- ❌ ${message}`),
    "",
  ].join("\n");
  await appendFile(path, body, "utf8");
}

async function selfTest() {
  const dir = await mkdtemp(resolve(tmpdir(), "stonks-freshness-"));
  try {
    const start = new Date("2026-07-30T14:00:00.000Z");
    const stamp = "2026-07-30T14:02:00.000Z";
    const write = async (key, payload) => {
      const path = resolve(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(payload), "utf8");
    };
    await write("mtime-probe.json", {});
    await utimes(resolve(dir, "mtime-probe.json"), new Date(start.getTime() - 1), new Date(start.getTime() - 1));
    const mtimeProbe = makeReport("self-test", dir, start, new Date(stamp));
    await requireRewrittenJson(mtimeProbe, dir, "mtime-probe.json", start);
    if (!mtimeProbe.errors.some((message) => message.includes("was not rewritten"))) {
      throw new Error("self-test expected a pre-window mtime to fail without clock slop");
    }
    await rm(resolve(dir, "mtime-probe.json"));
    for (const key of BAKE_REQUIRED_REWRITTEN_FILES) await write(key, {});
    const ticker = {
      spot: 100,
      quoteAsOf: stamp,
      marketState: "REGULAR",
      technicals: {
        rsi: 50,
        chartPattern: { pattern: "Bull Flag", stage: "confirmed", stale: true },
      },
      ivRank: { asOf: "2026-07-30", iv: 0.4, n: 20, pctile: 50, rank: 50 },
      chains: {},
      priceSeries: {
        t: Array.from({ length: 20 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`),
        c: Array.from({ length: 20 }, (_, index) => 100 + index),
      },
    };
    ticker.chains = {
      1780000000: {
        c: [{ s: 100, b: 1, a: 1.1 }],
        p: [{ s: 100, b: 1, a: 1.1 }],
      },
    };
    await write("TEST.json", ticker);
    await write("iv-history/TEST.json", {
      symbol: "TEST",
      entries: [{ date: "2026-07-30", capturedAtIso: stamp, iv: 0.4 }],
    });
    for (const key of [...BAKE_STAMPED_FILES, "picks.json", "picks-open.json"]) {
      const payload = key === "grades.json"
        ? {
            builtAtIso: stamp,
            grades: {
              TEST: {
                pillars: {
                  technicals: {
                    signals: [{ key: "chartPattern", score: 0, available: false, value: "Bull Flag (stale context)" }],
                  },
                },
              },
            },
          }
        : key === "heatmap.json" || key === "market-analysis.json"
          ? { builtAtIso: stamp, refreshedAtIso: stamp }
          : { builtAtIso: stamp };
      await write(key, payload);
    }
    await write("macro.json", {
      asOf: stamp,
      twoY: { value: 4 },
      tenY: { value: 4 },
      dxy: { value: 100 },
      vix: { value: 20 },
    });
    await write("manifest.json", { _meta: { dataBuiltAtIso: stamp, renderedAtIso: stamp } });
    await write("manifest-free.json", { _meta: { dataBuiltAtIso: stamp, renderedAtIso: stamp } });
    const validOiTracker = {
      scannedAt: stamp,
      summary: { tickerCount: 1, flaggedCount: 0, scanned: 1, failed: 0 },
      tickers: [{
        symbol: "TEST",
        spot: 100,
        callOiTotal: 1200,
        putOiTotal: 800,
        strikes: [{ side: "call", strike: 105, expSec: 1780000000, oi: 1200 }],
      }],
    };
    const validOiHistory = {
      snapshots: [{
        scannedAt: stamp,
        contracts: [{ symbol: "TEST", side: "call", strike: 105, expSec: 1780000000, oi: 1200 }],
      }],
    };
    await write("oi-tracker.json", validOiTracker);
    await write("search-interest.json", { builtAtIso: stamp });
    await write("ram-prices.json", { builtAtIso: stamp });
    await write("accelerator-prices.json", { builtAtIso: stamp });
    await write("unusual.json", { scannedAt: stamp });
    await write("unusual-history.json", { snapshots: [{ scannedAt: stamp }] });
    await write("unusual-log.json", { updatedAt: stamp, entries: [] });
    await write("volume-flags.json", { scannedAt: stamp });
    await write("volume-history.json", { snapshots: [{ scannedAt: stamp }] });
    await write("oi-history.json", validOiHistory);
    await write("flow-explanations.json", { updatedAt: stamp, mode: "deterministic-v1", entries: {} });
    await write("day-trading.json", { updatedAt: stamp, portfolios: { stock: {} } });
    await write("day-trading-history.json", { updatedAt: stamp, portfolios: { stock: {} } });

    const report = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (report.errors.length) throw new Error(renderReport(report));

    const priorRefreshTopPicks = process.env.REFRESH_TOP_PICKS;
    process.env.REFRESH_TOP_PICKS = "0";
    await write("picks.json", { builtAtIso: "2026-07-29T15:30:00.000Z" });
    await write("picks-open.json", { builtAtIso: "2026-07-29T15:30:00.000Z", open: [] });
    const carryReport = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (priorRefreshTopPicks == null) delete process.env.REFRESH_TOP_PICKS;
    else process.env.REFRESH_TOP_PICKS = priorRefreshTopPicks;
    if (carryReport.errors.length) throw new Error(renderReport(carryReport));
    await write("picks.json", { builtAtIso: stamp });
    await write("picks-open.json", { builtAtIso: stamp, open: [] });

    await write("grades.json", {
      builtAtIso: stamp,
      grades: {
        TEST: {
          pillars: {
            technicals: {
              signals: [{ key: "chartPattern", score: 1, available: true, value: "Bull Flag" }],
            },
          },
        },
      },
    });
    const unsafeChart = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!unsafeChart.errors.some((message) => message.includes("stale chart pattern is not quarantined"))) {
      throw new Error("self-test expected a stale chart pattern grade contribution to fail");
    }
    await write("grades.json", {
      builtAtIso: stamp,
      grades: {
        TEST: {
          pillars: {
            technicals: {
              signals: [{ key: "chartPattern", score: 0, available: false, value: "Bull Flag (stale context)" }],
            },
          },
        },
      },
    });
    for (const owner of ["unusual", "oi", "search-interest", "daytrading"]) {
      const ownerReport = await auditFreshness({
        owner,
        dataDir: dir,
        runStartedAt: start.toISOString(),
        now: new Date("2026-07-30T14:05:00.000Z"),
        expectedSymbols: ["TEST"],
      });
      if (ownerReport.errors.length) throw new Error(renderReport(ownerReport));
    }

    await write("oi-tracker.json", {
      scannedAt: stamp,
      summary: { tickerCount: 0, flaggedCount: 0, scanned: 12, failed: 0 },
      tickers: [],
    });
    await write("oi-history.json", { snapshots: [{ scannedAt: stamp, contracts: [] }] });
    const emptyOi = await auditFreshness({
      owner: "oi",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!emptyOi.errors.some((message) => message.includes("no surfaced tickers"))) {
      throw new Error("self-test expected an empty OI tracker to fail");
    }
    if (!emptyOi.errors.some((message) => message.includes("latest snapshot has no contracts"))) {
      throw new Error("self-test expected an empty OI history snapshot to fail");
    }

    await write("oi-tracker.json", {
      ...validOiTracker,
      summary: { ...validOiTracker.summary, scanned: 5 },
    });
    await write("oi-history.json", validOiHistory);
    const sparseOi = await auditFreshness({
      owner: "oi",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!sparseOi.errors.some((message) => message.includes("surfaced coverage"))) {
      throw new Error("self-test expected a systemically sparse OI tracker to fail");
    }
    await write("oi-tracker.json", validOiTracker);
    await write("oi-history.json", validOiHistory);

    const briefStart = new Date("2026-07-30T12:30:00.000Z");
    const briefStamp = "2026-07-30T12:32:00.000Z";
    await write("briefs.json", {
      builtAtIso: briefStamp,
      current: {
        kind: "morning",
        date: "2026-07-30",
        etHour: 8,
        generatedAtIso: briefStamp,
      },
    });
    await write("ai-usage.json", { updatedAt: briefStamp });
    const briefReport = await auditFreshness({
      owner: "brief",
      dataDir: dir,
      runStartedAt: briefStart.toISOString(),
      now: new Date("2026-07-30T12:35:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (briefReport.errors.length) throw new Error(renderReport(briefReport));
    await write("briefs.json", { builtAtIso: stamp });
    await write("ai-usage.json", {});

    const stale = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: "2026-07-30T15:00:00.000Z",
      now: new Date("2026-07-30T15:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!stale.errors.length) throw new Error("self-test expected stale fixture to fail");

    await write("oi-history.json", { snapshots: [{ scannedAt: "2026-07-30T13:00:00.000Z" }] });
    const staleOiHistory = await auditFreshness({
      owner: "oi",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!staleOiHistory.errors.some((message) => message.includes("oi-history.json latest snapshot"))) {
      throw new Error("self-test expected stale OI history to fail");
    }
    await write("oi-history.json", validOiHistory);

    await rm(resolve(dir, "briefs.json"));
    const missingRequired = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!missingRequired.errors.some((message) => message.startsWith("briefs.json:"))) {
      throw new Error("self-test expected a missing declared bake output to fail");
    }
    await write("briefs.json", {});

    await write("rogue-payload.json", { builtAtIso: stamp });
    const unclassified = await auditFreshness({
      owner: "bake",
      dataDir: dir,
      runStartedAt: start.toISOString(),
      now: new Date("2026-07-30T14:05:00.000Z"),
      expectedSymbols: ["TEST"],
    });
    if (!unclassified.errors.some((message) => message.includes("unclassified bake-owned"))) {
      throw new Error("self-test expected an unclassified bake-owned key to fail");
    }
    console.log("verify-data-freshness self-test passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const report = await auditFreshness({
    owner: args.owner,
    dataDir: args.dataDir,
    runStartedAt: args.runStartedAt,
  });
  console.log(renderReport(report));
  await writeStepSummary(report);
  if (process.env.GITHUB_ACTIONS) {
    for (const message of report.warnings) console.log(`::warning::${message}`);
    for (const message of report.errors) console.log(`::error::${message}`);
  }
  if (report.errors.length) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

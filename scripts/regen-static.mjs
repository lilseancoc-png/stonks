// Regenerates index.html, app.js, and styles.css from the existing
// data/trends.json + data/*.json without re-running the Yahoo + Gemini
// pipeline in build.mjs. Useful when only the page renderers changed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contentAssetVersion } from "../lib/asset-version.mjs";
import {
  FALLBACK_RISK_FREE_RATE,
  FOMC_MEETINGS_BASELINE,
  RFR_CACHE_MAX_DAYS,
  buildHeatmapPayload,
  buildMovingAverageTracker,
  ensureTickerCoverage,
  readRfrHistory,
  renderAppJs,
  renderHtml,
  renderStylesCss,
} from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

const trendsRaw = await readFile(resolve(DATA_DIR, "trends.json"), "utf8");
const trends = JSON.parse(trendsRaw);

let unusual = null;
try {
  const unusualRaw = await readFile(resolve(DATA_DIR, "unusual.json"), "utf8");
  unusual = JSON.parse(unusualRaw);
} catch {}

let fearGreed = null;
try {
  const fngRaw = await readFile(resolve(DATA_DIR, "fear-greed.json"), "utf8");
  fearGreed = JSON.parse(fngRaw);
} catch {}

let macro = null;
try {
  const macroRaw = await readFile(resolve(DATA_DIR, "macro.json"), "utf8");
  macro = JSON.parse(macroRaw);
} catch {}

let volumeFlags = null;
try {
  const vfRaw = await readFile(resolve(DATA_DIR, "volume-flags.json"), "utf8");
  volumeFlags = JSON.parse(vfRaw);
} catch {}

let oi = null;
try {
  const oiRaw = await readFile(resolve(DATA_DIR, "oi-tracker.json"), "utf8");
  oi = JSON.parse(oiRaw);
} catch {}

const files = await readdir(DATA_DIR);
// Match the ticker allowlist shape (lib/yahoo.mjs SYMBOL_RE: leading letter,
// then letters/digits/dot, ≤6 chars) so dotted/numeric tickers like BRK.B
// aren't silently dropped. The named data files (unusual.json, 13f.json,
// oi-tracker.json, …) are lowercase / digit-leading / hyphenated, so none
// match this uppercase pattern.
const symbols = files
  .filter((f) => /^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const spots = {};
// Market backdrop is reconstructed from the existing per-ticker JSON so the
// regen path matches build.mjs's main() — keeps the Execute now? card from
// going blank between full bakes. SPY/QQQ/IWM/SMH/UVXY are always in
// TICKERS, but tolerate missing entries so a partial data/ dir still works.
const MARKET_BACKDROP_SYMBOLS = ["SPY", "QQQ", "IWM", "SMH", "UVXY"];
const marketBackdrop = {};
// Heatmap payload also gets rebuilt from the same per-ticker JSONs so a
// regen pass produces a usable data/heatmap.json without re-hitting Yahoo.
// We stash each parsed JSON under chainsForHeatmap so buildHeatmapPayload
// can consume it with the same shape the live bake uses.
const chainsForHeatmap = {};
for (const sym of symbols) {
  try {
    const raw = await readFile(resolve(DATA_DIR, sym + ".json"), "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j.spot === "number") spots[sym] = j.spot;
    if (j) chainsForHeatmap[sym] = j;
    if (MARKET_BACKDROP_SYMBOLS.includes(sym) && j && j.technicals) {
      const t = j.technicals;
      const vol = t.volume || {};
      marketBackdrop[sym] = {
        spot: j.spot ?? null,
        move1dPct: vol.priceMove1dPct ?? null,
        rsi: t.rsi ?? null,
        macdHist: t.macd?.hist ?? null,
        rvol: vol.rvol ?? null,
        s20: t.sr?.s20 ?? null,
        r20: t.sr?.r20 ?? null,
      };
    }
  } catch {}
}

const todayIsoForFomc = new Date().toISOString().slice(0, 10);
const nextFomcDates = FOMC_MEETINGS_BASELINE
  .map((m) => m.date)
  .filter((d) => d >= todayIsoForFomc)
  .sort()
  .slice(0, 2);

// A local data/ hydrate can lag the committed shell (private-store data is not
// versioned with the repo). Never make the shipped freshness stamp older just
// because a renderer-only regen ran against that stale hydrate. Preserve the
// newer existing shell timestamp; REGEN_BUILT_AT_ISO is a one-shot recovery
// override for a workspace whose shell was already regenerated from stale data.
let existingBuiltAtIso = null;
let existingShellManifest = null;
try {
  const existingHtml = await readFile(resolve(ROOT, "index.html"), "utf8");
  existingBuiltAtIso = existingHtml.match(/\bdata-built-at="([^"]+)"/)?.[1] || null;
  const manifestMatch = existingHtml.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/);
  if (manifestMatch) existingShellManifest = JSON.parse(manifestMatch[1]);
} catch {}
const builtAtCandidates = [
  trends.builtAtIso,
  existingBuiltAtIso,
  process.env.REGEN_BUILT_AT_ISO,
].filter((value) => Number.isFinite(Date.parse(value)));
const builtAtIso = builtAtCandidates.length
  ? builtAtCandidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
  : new Date().toISOString();
const parseMetaOverride = (name) => {
  try { return process.env[name] ? JSON.parse(process.env[name]) : null; } catch { return null; }
};
const newerMeta = (current, existing, override) => [current, existing, override]
  .filter((value) => value && Number.isFinite(Date.parse(value.scannedAt)))
  .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))[0] || null;
// Scanner-owned freshness stubs can be newer than a local bake hydrate. Carry
// the newest shell metadata forward so a renderer-only regen does not erase
// evidence of the hourly volume or twice-daily OI refresh.
const volumeFlagsMeta = newerMeta(
  volumeFlags,
  existingShellManifest?.volumeFlagsMeta,
  parseMetaOverride("REGEN_VOLUME_FLAGS_META"),
);
const oiMeta = newerMeta(
  oi,
  existingShellManifest?.oiMeta,
  parseMetaOverride("REGEN_OI_META"),
);
const builtAt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
}).format(new Date(builtAtIso));

// Backfill ticker coverage on the existing narratives — the daily build only
// started doing this after the AI-cherry-picks-tickers fix, so trends.json
// produced before that lacks watchlists for quiet sub-industries.
const coveredNarratives = ensureTickerCoverage(trends.narratives || [], symbols);

const renderInput = {
  symbols,
  builtAt,
  builtAtIso,
  narratives: coveredNarratives,
  sectorOverviews: trends.sectorOverviews || {},
  recentlyEnded: trends.recentlyEnded || [],
  macroHeadlines: trends.macroHeadlines || [],
  unusual,
  spots,
  fearGreed,
  macro,
  volumeFlags: volumeFlagsMeta ? { ...(volumeFlags || {}), ...volumeFlagsMeta } : volumeFlags,
  marketBackdrop,
  nextFomcDates,
  oi: oiMeta ? { ...(oi || {}), ...oiMeta } : oi,
  dataDir: DATA_DIR,
  // Asset versions are added only after the rendered bytes are available.
  // Keep this input focused on the data provenance and display timestamp.
};
const css = renderStylesCss();
// The committed data/rfr-history.json holds the last fetched 3M T-bill rate
// (written by build.mjs, and it survives the build's data/ wipe). Thread it
// through so the regenerated app.js keeps the real risk-free rate instead of
// silently resetting greeks to the hardcoded FALLBACK_RISK_FREE_RATE (4.5%).
// This matters because daily.yml re-runs THIS script *after* build.mjs and
// commits its app.js — and the hourly unusual-flow / twice-daily oi-tracker
// workflows regen app.js from here too, with no build to bake the rate. Pass
// it as the structured payload so the greeks tooltip's source label stays
// honest ("fresh" only if captured today, else "cached").
let riskFreeRate = {
  rate: FALLBACK_RISK_FREE_RATE,
  asOf: todayIsoForFomc,
  source: "fallback",
  ageDays: null,
};
try {
  const rfr = await readRfrHistory();
  if (rfr && Number.isFinite(rfr.rate) && rfr.rate >= 0 && rfr.rate < 0.20) {
    const capturedIso = rfr.capturedAt || rfr.asOf || null;
    const isFresh = capturedIso === todayIsoForFomc;
    // On a non-fresh (cached) reading, carry the age so the greeks tooltip can
    // show "cached ^IRX, Nd old" — matching what build.mjs's fetchRiskFreeRate
    // emits. Fresh readings have no meaningful age (ageDays stays null).
    let ageDays = null;
    if (!isFresh && capturedIso) {
      const capturedMs = Date.parse(capturedIso);
      const todayMs = Date.parse(todayIsoForFomc);
      if (Number.isFinite(capturedMs) && Number.isFinite(todayMs)) {
        const rawAgeDays = (todayMs - capturedMs) / 86400000;
        if (rawAgeDays >= 0) ageDays = rawAgeDays;
      }
    }
    if (isFresh || (ageDays != null && ageDays <= RFR_CACHE_MAX_DAYS)) {
      riskFreeRate = {
        rate: rfr.rate,
        asOf: rfr.asOf || null,
        source: isFresh ? "fresh" : "cached",
        ageDays,
      };
    } else {
      console.warn(
        `regen-static: cached ^IRX is missing a valid date or older than ${RFR_CACHE_MAX_DAYS}d; ` +
        `using ${(FALLBACK_RISK_FREE_RATE * 100).toFixed(1)}% fallback`,
      );
    }
  }
} catch { /* no readable rfr-history.json — keep the explicit 4.5% fallback */ }
const js = renderAppJs({ riskFreeRate });
const streaksJs = await readFile(resolve(ROOT, "js", "streaks.js"), "utf8");
const html = renderHtml({
  ...renderInput,
  renderedAtIso: new Date().toISOString(),
  assetVersions: {
    styles: contentAssetVersion(css),
    app: contentAssetVersion(js),
    streaks: contentAssetVersion(streaksJs),
  },
});

await writeFile(resolve(ROOT, "index.html"), html, "utf8");
await writeFile(resolve(ROOT, "styles.css"), css, "utf8");
await writeFile(resolve(ROOT, "app.js"), js, "utf8");

// heatmap.json is hourly-refreshed by scripts/refresh-heatmap.mjs via
// .github/workflows/heatmap.yml — it carries fresher `ch`/`sp` than the
// per-ticker JSONs we'd rebuild from here. Only seed it from per-ticker
// JSONs if the file is genuinely missing (first regen after a wipe,
// developer running this standalone before any bake). When it already
// exists, leave the hourly-refreshed values alone.
let heatmapNote;
try {
  await readFile(resolve(DATA_DIR, "heatmap.json"), "utf8");
  heatmapNote = "data/heatmap.json preserved (hourly-refreshed)";
} catch {
  const heatmapPayload = buildHeatmapPayload(chainsForHeatmap, builtAtIso);
  const heatmapJson = JSON.stringify(heatmapPayload);
  await writeFile(resolve(DATA_DIR, "heatmap.json"), heatmapJson, "utf8");
  heatmapNote = `data/heatmap.json (${heatmapPayload.tickers.length} tickers, seeded)`;
}

// The MA tracker is bake-owned and deterministic over the same persisted
// ticker payloads, so renderer-only regeneration can keep its local contract
// current without any Yahoo or AI calls.
const maTrackerPayload = buildMovingAverageTracker(chainsForHeatmap, builtAtIso);
const maTrackerJson = JSON.stringify(maTrackerPayload);
await writeFile(resolve(DATA_DIR, "ma-tracker.json"), maTrackerJson, "utf8");
const maTrackerNote = `data/ma-tracker.json (${maTrackerPayload.summary.inBand} in-band levels)`;

console.log(
  `Regenerated index.html (${(html.length / 1024).toFixed(1)} KB), ` +
    `styles.css (${(css.length / 1024).toFixed(1)} KB), ` +
    `app.js (${(js.length / 1024).toFixed(1)} KB), ` +
    `${heatmapNote}, ${maTrackerNote}.`,
);

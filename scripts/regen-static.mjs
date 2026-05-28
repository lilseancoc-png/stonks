// Regenerates index.html, app.js, and styles.css from the existing
// data/trends.json + data/*.json without re-running the Yahoo + Gemini
// pipeline in build.mjs. Useful when only the page renderers changed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml, renderAppJs, renderStylesCss, ensureTickerCoverage, FOMC_MEETINGS_BASELINE, buildHeatmapPayload } from "./build.mjs";

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

const builtAtIso = trends.builtAtIso || new Date().toISOString();
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

const html = renderHtml({
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
  volumeFlags,
  marketBackdrop,
  nextFomcDates,
  oi,
});
const css = renderStylesCss();
const js = renderAppJs();

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

console.log(
  `Regenerated index.html (${(html.length / 1024).toFixed(1)} KB), ` +
    `styles.css (${(css.length / 1024).toFixed(1)} KB), ` +
    `app.js (${(js.length / 1024).toFixed(1)} KB), ` +
    `${heatmapNote}.`,
);

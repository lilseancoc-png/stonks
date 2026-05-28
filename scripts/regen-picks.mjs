// Regenerates data/picks.json from the existing per-ticker data/*.json
// files + data/streaks.json + data/trends.json. Useful when only the
// picks algorithm changed — no Yahoo or Gemini calls needed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopPicks, PICKS_MIN_CONVICTION } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

const trendsRaw = await readFile(resolve(DATA_DIR, "trends.json"), "utf8");
const trends = JSON.parse(trendsRaw);
const narratives = trends.narratives || [];

const streaksRaw = await readFile(resolve(DATA_DIR, "streaks.json"), "utf8");
const streaksFile = JSON.parse(streaksRaw);
const streaksMap = {};
for (const row of streaksFile.tickers || []) {
  if (row && row.symbol) streaksMap[row.symbol] = row;
}

// The unusual-flow scanner writes data/unusual.json hourly. Picks use it
// for the "unusual flow" signal — but the file is optional, so a missing
// or stale read just skips that one driver.
let unusualPayload = null;
try {
  const raw = await readFile(resolve(DATA_DIR, "unusual.json"), "utf8");
  unusualPayload = JSON.parse(raw);
} catch {}

const files = await readdir(DATA_DIR);
// Match the ticker allowlist shape (lib/yahoo.mjs SYMBOL_RE: leading letter,
// then letters/digits/dot, ≤6 chars) so dotted/numeric tickers like BRK.B
// aren't silently dropped. The named data files (unusual.json, 13f.json, …)
// are lowercase / digit-leading / hyphenated, so none match this pattern.
const symbols = files
  .filter((f) => /^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const chains = {};
for (const sym of symbols) {
  try {
    const raw = await readFile(resolve(DATA_DIR, sym + ".json"), "utf8");
    const j = JSON.parse(raw);
    if (j && j.chains && j.spot > 0) chains[sym] = j;
  } catch {}
}

const picks = buildTopPicks(chains, narratives, streaksMap, unusualPayload);
const out = {
  builtAtIso: new Date().toISOString(),
  minConviction: PICKS_MIN_CONVICTION,
  picks,
};

// Match the minified format that build.mjs::writeTopPicksFile uses, so a
// regen here produces a small, reviewable diff against the workflow-built
// file rather than reformatting every line.
await writeFile(
  resolve(DATA_DIR, "picks.json"),
  JSON.stringify(out),
  "utf8",
);

console.log(`Regenerated picks.json — ${picks.length} pick${picks.length === 1 ? "" : "s"}.`);
for (const p of picks) {
  const c = p.contract;
  const overall = c?.contractQuality?.overall || "—";
  console.log(
    `  ${p.symbol.padEnd(6)} ${p.side.toUpperCase()} ` +
    `conv=${String(p.conviction).padStart(2)} ` +
    `comp=${String(p.compositeScore).padStart(5)} ` +
    `Δ${c?.delta?.toFixed?.(2) ?? "—"} ` +
    `${c?.dte ?? "?"}d ` +
    `RR=${c?.rrRatio ?? "—"} ` +
    `overall=${overall}` +
    (c?.earningsInWindow ? " 📅EARNINGS" : ""),
  );
}

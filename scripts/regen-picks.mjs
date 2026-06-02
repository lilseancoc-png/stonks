// Regenerates data/picks.json (+ data/grades.json) from the existing
// per-ticker data/*.json files + data/streaks.json + data/trends.json. Useful
// when only the picks algorithm changed — no Yahoo or Gemini calls needed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopPicks, buildGradesIndex, PICKS_MIN_CONVICTION, updatePicksAccuracyFile, readGradesHistory, writeGradesHistory, diffGradesHistory, applyPickFirstSeen, readPicksChanges, writePicksChanges, buildPicksChanges, appendPicksChanges } from "./build.mjs";

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

// The full build fetches the macro backdrop (VIX / DXY / 10Y) and threads it
// into picks for the VIX-spot, VIX-tracking, DXY-1d and 10y-1d signals. On a
// regen we read the committed data/macro.json instead — no Yahoo call. A
// missing/stale read just leaves those macro signals at "no data" (the VIX leg
// in particular is often absent from older macro.json files until a full build
// repopulates it).
let macroBackdrop = null;
try {
  const raw = await readFile(resolve(DATA_DIR, "macro.json"), "utf8");
  macroBackdrop = JSON.parse(raw);
} catch {}

// The hourly scanner writes data/volume-flags.json (underlying hourly volume vs
// 20D-average hourly volume). Picks use it for the "unusual volume" signal —
// optional, so a missing read falls back to daily relative volume.
let volumeFlags = null;
try {
  const raw = await readFile(resolve(DATA_DIR, "volume-flags.json"), "utf8");
  volumeFlags = JSON.parse(raw);
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

const picks = buildTopPicks(chains, narratives, streaksMap, unusualPayload, macroBackdrop, volumeFlags);
const builtAtIso = new Date().toISOString();

// Preserve the day-streak across a render-only regen. We don't wipe data/ here,
// so the live picks.json still holds each surviving name's original firstSeen —
// read it and inherit, exactly as the full build's writeTopPicksFile does (a
// dropped/new name resets to builtAtIso). Without this, regen would emit picks
// with no firstSeen and the Top Picks tenure chips would vanish until the next
// full bake. Missing/corrupt file → everything is treated as freshly seen.
let priorPicks = null;
try {
  const priorRaw = await readFile(resolve(DATA_DIR, "picks.json"), "utf8");
  const priorParsed = JSON.parse(priorRaw);
  if (Array.isArray(priorParsed?.picks)) priorPicks = priorParsed.picks;
} catch {
  // First run / missing / corrupt — no prior firstSeen to inherit.
}
applyPickFirstSeen(picks, priorPicks, builtAtIso);

const out = {
  builtAtIso,
  minConviction: PICKS_MIN_CONVICTION,
  picks,
};

// Match the minified format that build.mjs::writeTopPicksFile uses, so a
// regen here produces a small, reviewable diff against the workflow-built
// file rather than reformatting every line. (Regen leaves the exit-plan prose
// templated — the AI polish only runs in the full build.)
await writeFile(
  resolve(DATA_DIR, "picks.json"),
  JSON.stringify(out),
  "utf8",
);

// Grade index for every tracked ticker (powers the Top Picks tab's grade-any-
// ticker search). Same 4-pillar scoring as buildTopPicks; kept in step with the
// regen'd picks. Same minified format as build.mjs::writeGradesFile.
const grades = buildGradesIndex(chains, narratives, streaksMap, unusualPayload, macroBackdrop, volumeFlags);
await writeFile(
  resolve(DATA_DIR, "grades.json"),
  JSON.stringify({ builtAtIso, minConviction: PICKS_MIN_CONVICTION, grades }),
  "utf8",
);
console.log(`Regenerated grades.json — ${Object.keys(grades).length} tickers.`);

// Grade-change log: diff the regen'd grade index against the live history file.
// No data/ wipe here, so we read the live grades-history.json directly (the full
// build pre-reads it before its wipe instead). Capture the prior snapshot's
// `latest` BEFORE writeGradesHistory overwrites it — the picks churn log below
// needs it as the prior grade state.
let ghPrevLatest = {};
try {
  const ghPrev = await readGradesHistory();
  ghPrevLatest = ghPrev.latest || {};
  const ghNext = diffGradesHistory(ghPrev, grades, builtAtIso);
  await writeGradesHistory(ghNext);
  console.log(`Updated grades-history.json — ${ghNext.changes.length} change events.`);
} catch (err) {
  console.warn(`grades-history.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Picks churn log: same deterministic actionable-bar crossing detection as the
// full build (no AI one-liner here — regen is AI-free). Reads the live
// picks-changes.json (no wipe) and appends this regen's events.
try {
  const pcPrev = await readPicksChanges();
  const churn = buildPicksChanges(ghPrevLatest, grades, builtAtIso, pcPrev);
  const pcNext = appendPicksChanges(pcPrev, churn, builtAtIso);
  await writePicksChanges(pcNext);
  const entered = churn.filter((e) => e.event === "entered").length;
  console.log(`Updated picks-changes.json — ${entered} in, ${churn.length - entered} out (${pcNext.changes.length} logged).`);
} catch (err) {
  console.warn(`picks-changes.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Keep the accuracy tracker in step with the regen'd picks: enroll new picks
// and mark open ones to market using the cached spots. AI-free, so it's safe
// to run here. Pass the grade index so checkpoint scores reflect current grades.
try {
  const acc = await updatePicksAccuracyFile(chains, builtAtIso, null, grades);
  console.log(`Updated picks-accuracy.json — ${acc.open} open, ${acc.closed} closed${acc.winRate != null ? `, ${(acc.winRate * 100).toFixed(0)}% win rate` : ""}.`);
} catch (err) {
  console.warn(`picks-accuracy.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

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

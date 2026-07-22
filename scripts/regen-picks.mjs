// Regenerates data/picks.json (+ data/grades.json) from the existing
// per-ticker data/*.json files + data/streaks.json + data/trends.json. Useful
// when only the picks algorithm changed — no Yahoo or Gemini calls needed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopPicks, buildGradesIndex, gradeTradeCut, PICKS_MIN_CONVICTION, FALLBACK_RISK_FREE_RATE, updatePicksAccuracyFile, readGradesHistory, writeGradesHistory, diffGradesHistory, applyPickFirstSeen, readPicksChanges, writePicksChanges, buildPicksChanges, appendPicksChanges, buildPicksRoster, writePicksRoster, attachIvRanks, computeMacroRegime, buildIndexAxisInput, buildBreadthAxisInput, buildPutCallAxisInput, buildRotationAxisInput, deriveGlobalTapeAxis, readRfrHistory, readGradesDaily, appendGradesDaily, writeGradesDaily, readRegimeHistory, appendRegimeHistory, writeRegimeHistory, buildStockPicks, writeStockPicksFile, STOCK_PICKS_FILE, readPriorStockPicks, buildSectorRotationRebounds, writeSectorRotationFile, SECTOR_ROTATION_FILE, buildLeveragedEtfPicks, writeLeveragedEtfsFile, LEVERAGED_ETFS_FILE, readPriorLevEtfLog, levRecordFromLog } from "./build.mjs";

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

// Cross-asset macro-stress regime (PICKS_MACRO_REGIME): the full build attaches
// this to macroBackdrop before scoring (computeMacroRegime over the macro backdrop
// + the FedWatch hawkish drift). Reproduce it offline from the committed
// data/macro.json + data/fedwatch-history.json so a regen's picks/grades reflect
// the same risk-off tilt, de-grossing and tactical puts. Missing/stale FedWatch →
// the Fed axis just reads "no data" (graceful); a null macroBackdrop skips it.
// Prior picks payload — read EARLY (no wipe here, but buildTopPicks overwrites
// picks.json below): the regime-persistence read needs the prior
// rosterMeta.macroRegime, and applyPickFirstSeen later needs the prior picks.
let priorPicksPayload = null;
try {
  const priorRaw = await readFile(resolve(DATA_DIR, "picks.json"), "utf8");
  const priorParsed = JSON.parse(priorRaw);
  if (priorParsed && typeof priorParsed === "object") priorPicksPayload = priorParsed;
} catch {
  // First run / missing / corrupt — no prior picks.
}
const priorPicks = Array.isArray(priorPicksPayload?.picks) ? priorPicksPayload.picks : null;

// The market-tape (macro regime) is computed AFTER the chains load below — its
// Indexes axis (SPY+QQQ) reads the freshly loaded chains.

// Prior whole-universe grade snapshot — read EARLY (before writeGradesHistory
// overwrites it below): the tier hysteresis (PICKS_TIER_HYSTERESIS) needs each
// name's prior tier/total, and the churn/roster builders reuse the same snapshot.
let ghPrev = { latest: {}, changes: [] };
try { ghPrev = await readGradesHistory(); } catch {}
const priorGrades = ghPrev.latest || {};

// The hourly scanner writes data/volume-flags.json (underlying hourly volume vs
// 20D-average hourly volume). Picks use it for the "unusual volume" signal —
// optional, so a missing read falls back to daily relative volume.
let volumeFlags = null;
try {
  const raw = await readFile(resolve(DATA_DIR, "volume-flags.json"), "utf8");
  volumeFlags = JSON.parse(raw);
} catch {}

// Scanner-data extras (same set the full build threads): the OI tracker
// (oiDeltaNet/gammaSqueeze signals + the wall-proximity timing read), the
// rolling flow log (flowPersist), and the committed overnight correlations
// (the overnight peer timing read). Each is optional and staleness-gated
// inside the engine, so a missing/old file just reads "no data".
const scannerExtras = {};
try {
  scannerExtras.oiTracker = JSON.parse(await readFile(resolve(DATA_DIR, "oi-tracker.json"), "utf8"));
} catch {}
try {
  scannerExtras.flowLog = JSON.parse(await readFile(resolve(DATA_DIR, "unusual-log.json"), "utf8"));
} catch {}
try {
  scannerExtras.correlations = JSON.parse(await readFile(resolve(DATA_DIR, "correlations.json"), "utf8"));
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

// Market tape (macro regime) — recomputed fresh (RESETS every build, no
// persistence). The same axes the full build uses, reproduced offline from the
// committed snapshots: SPY/QQQ off the loaded chains, plus fedwatch / Fear &
// Greed / correlations from disk (each missing → that axis reads "no data").
if (macroBackdrop) {
  let fedwatchHistory = null;
  try {
    fedwatchHistory = JSON.parse(await readFile(resolve(DATA_DIR, "fedwatch-history.json"), "utf8"));
  } catch {}
  let fearGreed = null;
  try {
    fearGreed = JSON.parse(await readFile(resolve(DATA_DIR, "fear-greed.json"), "utf8"));
  } catch {}
  try {
    const corr = JSON.parse(await readFile(resolve(DATA_DIR, "correlations.json"), "utf8"));
    macroBackdrop.crossAsset = deriveGlobalTapeAxis(corr && corr.markets ? corr.markets : null);
  } catch {}
  macroBackdrop.indexes = buildIndexAxisInput(chains);
  // Universe breadth + put/call recomputed from the loaded chains (same as the
  // bake); 2Y / MOVE / HY credit ride macroBackdrop from macro.json (offline).
  macroBackdrop.breadth = buildBreadthAxisInput(chains);
  macroBackdrop.putCall = buildPutCallAxisInput(chains);
  macroBackdrop.rotation = buildRotationAxisInput(chains);
  macroBackdrop.macroRegime = computeMacroRegime(macroBackdrop, fedwatchHistory, narratives, fearGreed, trends.macroHeadlines || []);
  if (macroBackdrop.macroRegime && macroBackdrop.macroRegime.state !== "neutral") {
    const m = macroBackdrop.macroRegime;
    console.log(`Market tape: ${m.state} (stress ${m.stress}, ${m.riskOffAxes} risk-off axes)${m.drivers.length ? ` — ${m.drivers.join(", ")}` : ""}`);
  }
}

// P1.6 — attach IV percentiles (from the committed iv-history) before scoring so
// computeEntryTiming's IV-rank soft read + the picks card's ivPctile populate.
await attachIvRanks(chains);

// P1.3 edge governor: read the live (pre-update) accuracy `closed` set so gross
// scales by the trailing realized option edge, exactly as the full build threads
// picksAccuracyPrev.closed. Missing/corrupt → null (governor uses its default).
let priorClosed = null;
// Re-entry suppression: the live `open` set so a name with a tracked position
// isn't re-picked until it exits (same rule the full build threads as priorOpen).
let priorOpen = null;
try {
  const accRaw = await readFile(resolve(DATA_DIR, "picks-accuracy.json"), "utf8");
  const accJ = JSON.parse(accRaw);
  if (accJ && Array.isArray(accJ.closed)) priorClosed = accJ.closed;
  if (accJ && Array.isArray(accJ.open)) priorOpen = accJ.open;
} catch {}

// Risk-free rate for the contract-selection greeks (pickContractForPick):
// read the last bake's fetched 3M T-bill rate from the committed
// data/rfr-history.json — same offline pattern as regen-static.mjs — instead
// of silently letting buildTopPicks default to the hardcoded 4.5%. Letting it
// default repriced every candidate contract's delta/theta at a rate that can
// sit a full point off the live one, so a regen could select different
// contracts than the bake it was supposed to reproduce.
let riskFreeRate = FALLBACK_RISK_FREE_RATE;
try {
  const rfr = await readRfrHistory();
  if (rfr && Number.isFinite(rfr.rate)) riskFreeRate = rfr.rate;
} catch { /* no rfr-history.json yet — keep the 4.5% fallback */ }

const builtAtIso = new Date().toISOString();
const picks = buildTopPicks(chains, narratives, streaksMap, unusualPayload, macroBackdrop, volumeFlags, riskFreeRate, { priorClosed, priorGrades, openPositions: priorOpen, builtAtIso, reentryCooldown: true, ...scannerExtras });

// Preserve the day-streak across a render-only regen. priorPicks was read above
// (before this overwrite), exactly as the full build's writeTopPicksFile does (a
// dropped/new name resets to builtAtIso). Without this, regen would emit picks
// with no firstSeen and the Top Picks tenure chips would vanish until the next
// full bake. Missing/corrupt file → everything is treated as freshly seen.
applyPickFirstSeen(picks, priorPicks, builtAtIso);

const out = {
  builtAtIso,
  // P3.2 — publish the live percentile actionable cutoff (matches build.mjs::
  // writeTopPicksFile), not the legacy ±PICKS_MIN_CONVICTION — the cross-sectional
  // rework retired the fixed bar, so a hardcoded 12 here ships an actionable-bar that
  // disagrees with the tiers the engine actually assigned.
  minConviction: picks.rosterMeta?.tradeCut ?? PICKS_MIN_CONVICTION,
  rosterMeta: picks.rosterMeta || null,
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

// Market analysis payload — the same macroRegime object that rides picks.json's
// rosterMeta, split into its own premium-but-NOT-role-restricted key so the
// Market analysis tab works for every premium member (picks.json itself is
// role-restricted to the Top Picks role). Mirrors build.mjs::main().
await writeFile(
  resolve(DATA_DIR, "market-analysis.json"),
  JSON.stringify({ builtAtIso, macroRegime: macroBackdrop?.macroRegime || null }),
  "utf8",
);

// Grade index for every tracked ticker (powers the Top Picks tab's grade-any-
// ticker search). Same 4-pillar scoring as buildTopPicks; kept in step with the
// regen'd picks. Same minified format as build.mjs::writeGradesFile.
const grades = buildGradesIndex(chains, narratives, streaksMap, unusualPayload, macroBackdrop, volumeFlags, { priorGrades, priorClosed, ...scannerExtras });
// minConviction = the live percentile trade cutoff (P3.2), mirroring
// build.mjs::writeGradesFile exactly — the grade-any-ticker card reads this as the
// "actionable bar", so a hardcoded ±PICKS_MIN_CONVICTION here makes a searched name
// that the engine tiered as a Call/Put render as "graded below the actionable bar".
// tierCutoffs is stashed non-enumerable on grades (like regimeBand below).
const gradesMinConviction = (grades.tierCutoffs && Number.isFinite(grades.tierCutoffs.tradeCut))
  ? grades.tierCutoffs.tradeCut : PICKS_MIN_CONVICTION;
await writeFile(
  resolve(DATA_DIR, "grades.json"),
  // regimeBand (§3.5.1) is stashed non-enumerable on grades — lift it into the
  // payload so the grade-any-ticker breakdown shows the active weighting.
  JSON.stringify({ builtAtIso, minConviction: gradesMinConviction, regimeBand: grades.regimeBand || "neutral", grades }),
  "utf8",
);
console.log(`Regenerated grades.json — ${Object.keys(grades).length} tickers (minConviction ${Number(gradesMinConviction).toFixed(2)}).`);

// Shares-only Stock Picks (premium tab) — the deterministic quality-dip
// screen over the same universe, reusing the grade index just built. Mirrors
// build.mjs::main(); rebuilt fresh (no accumulation), so a regen is exact.
try {
  const spPayload = buildStockPicks(chains, grades, builtAtIso);
  // DCA dial (VOO/QQQ): bake-owned — an offline regen has no Yahoo, so carry
  // the live file's `dca` block forward untouched (it refreshes next bake).
  const priorSp = await readPriorStockPicks();
  if (priorSp?.dca) spPayload.dca = priorSp.dca;
  const spInfo = await writeStockPicksFile(spPayload);
  console.log(`Regenerated ${STOCK_PICKS_FILE} — ${spInfo.candidates} dip candidates (${spInfo.buyZone} in the buy zone).`);
} catch (err) {
  console.warn(`${STOCK_PICKS_FILE} skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Sector Rotation Rebounds (premium tab) — pure over the hydrated per-ticker
// bars, grade index and company/news fields. Mirrors build.mjs::main() exactly;
// no quotes or AI calls are needed for an algorithm-only regeneration.
try {
  // Do not append today's clock date with the last persisted `spot`: offline
  // data may be days old, and that synthetic flat row would change trough age,
  // z-scores and reversion progress without any new market observation. A
  // persisted same-session quote timestamp may still refine its existing row.
  const rotationPayload = buildSectorRotationRebounds(chains, grades, builtAtIso, { appendAsOfRow: false });
  const rotationInfo = await writeSectorRotationFile(rotationPayload);
  console.log(`Regenerated ${SECTOR_ROTATION_FILE} — ${rotationInfo.candidates} clean candidate(s) (${rotationInfo.confirmed} confirmed / ${rotationInfo.firstThrust} first thrust), ${rotationInfo.nearMisses} near miss(es).`);
} catch (err) {
  console.warn(`${SECTOR_ROTATION_FILE} skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Leveraged ETFs (premium tab) — the daily-reset leverage screen over the same
// grade index. Mirrors build.mjs::main(); the IDEAS payload regenerates exactly
// (fully deterministic, no Yahoo, no AI). The track-record LOG is deliberately
// NOT reconciled offline — an algo-regen has no live ETF quotes, so opening or
// closing entries here would pollute the record with unpriced churn; instead
// the prior log's scoreboard is re-attached unchanged (next bake reconciles).
try {
  const levPayload = buildLeveragedEtfPicks(chains, grades, builtAtIso, macroBackdrop?.macroRegime ?? null, {
    rfr: riskFreeRate,
    picks: out?.picks || picks || null,
  });
  const levLogPrev = await readPriorLevEtfLog();
  if (levLogPrev) levPayload.record = levRecordFromLog(levLogPrev);
  const levInfo = await writeLeveragedEtfsFile(levPayload);
  console.log(`Regenerated ${LEVERAGED_ETFS_FILE} — ${levInfo.ideas} idea(s), ${levInfo.watch} watch row(s).`);
} catch (err) {
  console.warn(`${LEVERAGED_ETFS_FILE} skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Daily grade snapshot (universe-IC substrate) — upsert today's ET row, same as
// the full build. Read-modify-write on the live file (no wipe here).
try {
  const gdPrev = await readGradesDaily();
  const gd = await writeGradesDaily(appendGradesDaily(gdPrev, grades, builtAtIso));
  console.log(`Updated grades-daily.json — ${gd.days} day snapshot(s).`);
} catch (err) {
  console.warn(`grades-daily.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Daily market-regime timeline (Top Picks "risk-on / risk-off history" calendar)
// — upsert today's ET row from the same macro-regime gauge + roster lean as the
// full build. Read-modify-write on the live file (no wipe here).
try {
  const rhPrev = await readRegimeHistory();
  let calls = 0, puts = 0;
  for (const p of picks) { if (p && p.side === "put") puts++; else if (p) calls++; }
  const rh = await writeRegimeHistory(appendRegimeHistory(rhPrev, macroBackdrop?.macroRegime || null, { calls, puts }, builtAtIso));
  console.log(`Updated regime-history.json — ${rh.days} day snapshot(s).`);
} catch (err) {
  console.warn(`regime-history.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Grade-change log: diff the regen'd grade index against the history snapshot
// captured ABOVE (before buildTopPicks ran — the full build pre-reads it before
// its wipe instead). The picks churn log below reuses the same prior `latest`.
const ghPrevLatest = priorGrades;
try {
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
  const pcNext = appendPicksChanges(pcPrev, churn, builtAtIso, gradeTradeCut(grades));
  await writePicksChanges(pcNext);
  const entered = churn.filter((e) => e.event === "entered").length;
  console.log(`Updated picks-changes.json — ${entered} in, ${churn.length - entered} out (${pcNext.changes.length} logged).`);
} catch (err) {
  console.warn(`picks-changes.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Top-10 roster snapshot: the current 10-name list with in/held/new status,
// prior→current pillar deltas, dropped names paired to the entrant that took
// their slot, and a per-pick forecast. Same deterministic builder as the full
// build; AI-free here (regen runs no Gemini). priorPicks (read above before the
// overwrite) is the prior visible top-N; ghPrevLatest is the prior whole-universe
// grade snapshot, so status stays pre-bell-collapse immune.
try {
  const rosterPayload = buildPicksRoster(picks, priorPicks, ghPrevLatest, grades, builtAtIso, false);
  await writePicksRoster(rosterPayload);
  console.log(`Updated picks-roster.json — ${rosterPayload.count} in roster, ${rosterPayload.exited.length} out, ${rosterPayload.swaps.length} swap(s).`);
} catch (err) {
  console.warn(`picks-roster.json skipped — ${String(err?.message || err).split("\n")[0]}`);
}

// Keep the accuracy tracker in step: mark the open book to market and resolve
// exits using the cached spots — but do NOT enroll this regen's roster. The
// regen roster is AI-free (no final-grader classification/rank/veto), so
// enrolling it put systematically different selections into the live track
// record than the bake ships; enrollment happens on the next bake.
try {
  const acc = await updatePicksAccuracyFile(chains, builtAtIso, null, grades, { enrollNewPicks: false });
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
    `Δ${c?.delta?.toFixed?.(2) ?? "—"} ` +
    `${c?.dte ?? "?"}d ` +
    `RR=${c?.rrRatio ?? "—"} ` +
    `overall=${overall}` +
    (c?.earningsInWindow ? " 📅EARNINGS" : ""),
  );
}

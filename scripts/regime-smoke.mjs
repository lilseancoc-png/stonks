// Offline smoke test for the cross-asset macro-regime pipeline.
// Loads the REAL committed data/*.json (exactly as regen-picks.mjs does), then
// runs buildTopPicks three times — neutral / risk-off / severe — driving the
// real computeMacroRegime gauge via injected VIX/DXY/yield fields, and diffs the
// rosters. Verifies: the gauge classifies correctly, the roster rotates toward
// puts as the tape deteriorates, and the deployed gross de-grosses (and calls cap
// in a severe tape). Not committed by default — a throwaway harness.
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopPicks, computeMacroRegime, detectMarketRegime, attachIvRanks } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data");

const readJson = async (f, fallback = null) => {
  try { return JSON.parse(await readFile(resolve(DATA, f), "utf8")); } catch { return fallback; }
};

const trends = await readJson("trends.json", {});
const narratives = trends.narratives || [];
const streaksFile = await readJson("streaks.json", { tickers: [] });
const streaksMap = {};
for (const row of streaksFile.tickers || []) if (row?.symbol) streaksMap[row.symbol] = row;
const unusualPayload = await readJson("unusual.json", null);
const volumeFlags = await readJson("volume-flags.json", null);
const baseBackdrop = await readJson("macro.json", {}) || {};

const files = await readdir(DATA);
const symbols = files
  .filter((f) => /^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
const chains = {};
for (const sym of symbols) {
  const j = await readJson(sym + ".json", null);
  if (j && j.chains && j.spot > 0) chains[sym] = j;
}
await attachIvRanks(chains);
console.log(`Loaded ${Object.keys(chains).length} tickers with chains.\n`);

// Build a macroBackdrop for a scenario by injecting the raw cross-asset fields and
// letting the REAL computeMacroRegime gauge classify them. fed drift = null and
// narratives = [] so the gauge is a pure function of the injected VIX/DXY/yields
// (no accidental Fed/geo axis leaking in from the committed tape).
function backdropFor(kind) {
  const b = structuredClone(baseBackdrop);
  if (kind === "neutral") {
    b.vix = { value: 13.5, trend: "flat" };
    b.vixTerm = { state: "contango", ratio: 0.95 };
    b.dxy = { pctChange1d: 0.05, pctChange5d: 0.1, trend: "flat" };
    b.tenY = { bpsChange1d: 1, bpsChange5d: 2, trend: "flat" };
    b.thirtyY = { bpsChange1d: 1 };
    b.crude = { pctChange1d: 0.3, pctChange5d: 1 };
    b.gold = { pctChange1d: 0.1, pctChange5d: 0.5 };
  } else if (kind === "risk-off") {
    b.vix = { value: 22, trend: "rising" };          // ≥18 rising → −1
    b.vixTerm = { state: "contango", ratio: 0.98 };
    b.dxy = { pctChange1d: 0.7, pctChange5d: 1.0, trend: "rising" }; // ≥0.6 → −1
    b.tenY = { bpsChange1d: 4, bpsChange5d: 6, trend: "flat" };       // <10bps → no axis
    b.thirtyY = { bpsChange1d: 4 };
    b.crude = { pctChange1d: 0.3, pctChange5d: 1 };
    b.gold = { pctChange1d: 0.1, pctChange5d: 0.5 };
  } else if (kind === "risk-on") {
    b.vix = { value: 15.2, trend: "rising", pctChange1d: -12 }; // sharp crush <18 → +1
    b.vixTerm = { state: "contango", ratio: 0.94 };
    b.dxy = { pctChange1d: -0.7, pctChange5d: -1.2, trend: "falling" }; // ≤−0.6 → +1
    b.tenY = { bpsChange1d: -12, bpsChange5d: -15, trend: "falling" };  // ≤−10bps → +1
    b.thirtyY = { bpsChange1d: -10 };
    b.crude = { pctChange1d: 0.3, pctChange5d: 1 };
    b.gold = { pctChange1d: 0.1, pctChange5d: 0.5 };
  } else { // severe
    b.vix = { value: 30, trend: "rising" };          // ≥25 rising → −2
    b.vixTerm = { state: "backwardation", ratio: 1.08 };
    b.dxy = { pctChange1d: 1.2, pctChange5d: 2.0, trend: "rising" };  // ≥0.9 → −2
    b.tenY = { bpsChange1d: 20, bpsChange5d: 30, trend: "rising" };   // ≥16bps → −2
    b.thirtyY = { bpsChange1d: 18 };
    b.crude = { pctChange1d: 0.3, pctChange5d: 1 };
    b.gold = { pctChange1d: 0.1, pctChange5d: 0.5 };
  }
  b.macroRegime = computeMacroRegime(b, null, []);
  return b;
}

const spyMove = chains?.SPY?.technicals?.volume?.priceMove1dPct ?? null;
const results = {};

for (const kind of ["risk-on", "neutral", "risk-off", "severe"]) {
  const bd = backdropFor(kind);
  const mr = bd.macroRegime;
  const regime = detectMarketRegime({ spyMove }, bd);
  const picks = buildTopPicks(chains, narratives, streaksMap, unusualPayload, bd, volumeFlags, undefined, { priorClosed: null });
  const calls = picks.filter((p) => p.side === "call").length;
  const puts = picks.filter((p) => p.side === "put").length;
  const tactical = picks.filter((p) => p.recommendation?.tier === "tactical-put").length;
  const gross = picks.reduce((a, p) => a + (Number(p.sizing?.weight) || 0), 0);
  const meta = picks.rosterMeta || {};
  const topMag = picks.length ? Math.max(...picks.map((p) => Math.abs(p.total))) : 0;
  results[kind] = { mr, regime, n: picks.length, calls, puts, tactical, gross, topMag, meta, picks };

  console.log(`━━━ ${kind.toUpperCase()} ━━━`);
  console.log(`  gauge        : state=${mr.state} stress=${mr.stress} riskOffAxes=${mr.riskOffAxes} riskOnAxes=${mr.riskOnAxes}`);
  console.log(`  drivers      : ${mr.drivers.join(", ") || "—"}`);
  console.log(`  detectRegime : ${regime}`);
  console.log(`  roster       : ${picks.length} picks — ${calls} call / ${puts} put (${tactical} tactical)`);
  console.log(`  top |total|  : ${topMag.toFixed(1)}  (actionable floor = ${12})`);
  console.log(`  deployedGross: ${(gross * 100).toFixed(1)}%  (Σ sizing.weight)`);
  console.log(`  callCapped   : ${(meta.skippedMacroCallCapped || []).length}   vetoed(gate): ${meta.vetoed ?? "—"}`);
  console.log(`  top 8        : ${picks.slice(0, 8).map((p) => `${p.symbol}:${p.side[0].toUpperCase()}${p.conviction}`).join("  ")}`);
  console.log("");
}

// ---- assertions -----------------------------------------------------------
const N = results.neutral, R = results["risk-off"], S = results.severe, O = results["risk-on"];
const putShare = (r) => r.n ? r.puts / r.n : 0;
// Expected deployed gross = PICKS_GROSS_TARGET(0.80) × rosterRamp(min(1,n/5)) ×
// edgeDefault(0.6, priorClosed=null) × regimeMult. Ramp saturates at n≥5.
const expectGross = (r, regimeMult) => 0.80 * Math.min(1, r.n / 5) * 0.6 * regimeMult;
// Per-pick weights are stored .toFixed(4)-rounded, so Σweight carries up to ~n×5e-5
// of rounding error vs the exact gross target — tolerate a few thousandths.
const near = (a, b) => Math.abs(a - b) < 2e-3;
// Invariants assert the regime MECHANICS only — things true regardless of the
// absolute-floor calibration (which is under review). The roster size / put-share
// at a given floor is a printed diagnostic above, not a hard assertion.
const checks = [
  ["gauge risk-on classifies risk-on (vol crush + dollar/yields easing, carries one dissenter)", O.mr.state === "risk-on"],
  ["detectMarketRegime lifts to risk-on", O.regime === "risk-on"],
  ["gauge neutral classifies neutral", N.mr.state === "neutral"],
  ["gauge risk-off classifies risk-off", R.mr.state === "risk-off"],
  ["gauge severe classifies severe-risk-off", S.mr.state === "severe-risk-off"],
  ["detectMarketRegime flips risk-off w/o SPY −1%", R.regime === "risk-off" && S.regime === "risk-off"],
  ["stress rosters lean net-short (puts > calls)", R.puts > R.calls && S.puts > S.calls],
  ["put share is non-decreasing as the tape worsens", putShare(S) >= putShare(R) && putShare(R) >= putShare(N)],
  ["risk-off gross matches 0.80×ramp×0.6×0.6", R.n === 0 || near(R.gross, expectGross(R, 0.6))],
  ["severe gross matches 0.80×ramp×0.6×0.4", S.n === 0 || near(S.gross, expectGross(S, 0.4))],
  ["severe de-grosses vs risk-off (regime mult 0.4 vs 0.6, ramp-adjusted)", S.n === 0 || R.n === 0 || (S.gross < R.gross && near(S.gross / R.gross, (0.4 / 0.6) * (Math.min(1, S.n / 5) / Math.min(1, R.n / 5))))],
  ["severe caps calls ≤ 3", S.calls <= 3],
];
console.log("━━━ ASSERTIONS ━━━");
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} passed.`);
process.exit(pass === checks.length ? 0 : 1);

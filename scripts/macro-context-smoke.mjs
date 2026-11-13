// Smoke test for the Top Picks macro, cycle and rotation context
// (lib/macro-context.mjs + lib/macro-weights.json + the PICKS_MACRO_CONTEXT
// hooks in scripts/build.mjs). Runs the switch-off checks in this process
// (PICKS_MACRO_CONTEXT=0, the kill switch), then re-runs itself with the
// switch at its default (on) and with grade points for the switch-on checks.
// No network, no data/ files, no AI.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as MC from "../lib/macro-context.mjs";

const ON = process.argv.some((a) => a === "--on" || a === "--on-points");
let failures = 0, passes = 0;
const ok = (name, cond) => { if (cond) passes++; else { failures++; console.log(`FAIL ${name}`); } };

// ---- synthetic history -------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const rand = rng(7);
const cal = [];
for (let d = Date.UTC(2024, 0, 2); cal.length < 420; d += 86400000) {
  const wd = new Date(d).getUTCDay();
  if (wd !== 0 && wd !== 6) cal.push(new Date(d).toISOString().slice(0, 10));
}
const walk = (start, drift, vol) => { let x = start; return cal.map(() => (x *= 1 + drift + (rand() - 0.5) * vol)); };
const level = (start, drift, vol) => { let x = start; return cal.map(() => (x += drift + (rand() - 0.5) * vol)); };
const daily = (v) => ({ t: cal.slice(), v });
const monthly = (start, step) => { const t = [], v = []; let x = start; for (let m = 0; m < 24; m++) { t.push(`${2023 + Math.floor((m + 11) / 12)}-${String(((m + 11) % 12) + 1).padStart(2, "0")}-01`); v.push((x *= 1 + step)); } return { t, v }; };
const series = {
  SPY: daily(walk(470, 0.0005, 0.02)), HYG: daily(walk(76, 0.0001, 0.006)), IEF: daily(walk(95, 0, 0.006)),
  USO: daily(walk(72, 0.0008, 0.03)), "DX-Y.NYB": daily(walk(102, 0.0002, 0.006)), "^VIX": daily(level(15, 0, 1.2).map((x) => Math.max(10, x))),
  DFF: daily(level(5.3, -0.002, 0.01)), DGS2: daily(level(4.4, -0.001, 0.06)), T10Y2Y: daily(level(-0.3, 0.002, 0.04)),
  T5YIE: daily(level(2.3, 0, 0.03)), CPIAUCSL: monthly(300, 0.003), CPILFESL: monthly(305, 0.0028), UNRATE: monthly(3.8, 0.004),
};
const KINDS = ["banks", "cardLender", "payments", "semiconductors", "softwareGrowth", "consumerStaples", "energy", "healthcare", "utilitiesRate", "industrials"];
const stocks = [];
KINDS.forEach((kind, k) => { for (let j = 0; j < 3; j++) { const c = walk(50 + k * 10 + j, 0.0003 * (k - 4), 0.03); stocks.push({ sym: `T${k}${j}`, kind, closes: cal.map((t, i) => ({ t, c: c[i] })) }); } });
stocks.push({ sym: "SHORTY", kind: "banks", closes: cal.slice(-40).map((t, i) => ({ t, c: 20 + i * 0.1 })) });
const weights = JSON.parse(readFileSync(new URL("../lib/macro-weights.json", import.meta.url), "utf8"));
const partyRows = [{ id: "XLF", offices: { president: { D: { excessAnnPct: -2 }, R: { excessAnnPct: 3 } }, house: { D: { excessAnnPct: -1 }, R: { excessAnnPct: 2 } }, senate: { D: { excessAnnPct: 0 }, R: { excessAnnPct: 1 } } } }];

if (!ON) {
  // ---- weights table ----------------------------------------------------------
  ok("weights: 30 features in the library's order", JSON.stringify(weights.feats) === JSON.stringify(MC.MACRO_FEATS) && weights.gamma.length === 30);
  ok("weights: every gamma is a finite number", weights.gamma.every((g) => Number.isFinite(g)));
  ok("weights: points scale and cap", weights.scale > 0 && weights.cap === 1.5 && /^\d{4}-\d{2}-\d{2}$/.test(weights.trainedThrough));

  // ---- feature vector and fit -------------------------------------------------
  const f = (score) => Object.fromEntries(MC.FACTORS.map((k) => [k, { score }]));
  const x = MC.macroFeatureVector({ exposures: { rates: -1 }, now: f(1), back20: f(0.5), back65: f(-1), flow: 0.6, rel5Pct: 3, partyTilt: 5 });
  ok("features: level, 13-week and 4-week change scale by exposure", x.L_rates === -1 && x.T_rates === -2 && x.S_rates === -0.5 && x.L_oil === 0);
  ok("features: rotation, one-week move / 3 and party / 10", x.rot === 0.6 && x.rot5 === 1 && x.party === 0.5);
  const big = MC.stockMacroFit({ kind: "banks", exposures: Object.fromEntries(MC.FACTORS.map((k) => [k, 1.5])), now: f(2), back20: f(-2), back65: f(-2), flow: 2, rel5Pct: 9, partyTilt: 20, weights });
  ok("fit: points are capped at 1.5 either way", Math.abs(big.points) <= 1.5);
  ok("fit: parts are sorted by size and labeled", big.parts.length > 0 && big.parts.every((p, i, a) => i === 0 || Math.abs(a[i - 1].contributionPct) >= Math.abs(p.contributionPct)) && big.parts.every((p) => p.label));
  ok("fit: no weights -> no fit", MC.stockMacroFit({ kind: "banks", exposures: {}, now: f(1), weights: null }) === null);
  ok("fit sentence: flips sign for a put", /for a put/.test(MC.fitSentence(big, "put")) && MC.fitSentence(big, "put").includes(`${big.points >= 0 ? "-" : "+"}`));

  // ---- whole context ------------------------------------------------------------
  const ctx = MC.buildMacroContext({ series, calendar: cal, stocks, weights, partyRows, breadthPct200: 60 });
  ok("context: built from synthetic history", ctx && ctx.asOf === cal[cal.length - 1] && ctx.version === MC.MACRO_CONTEXT_VERSION);
  ok("context: one fit per stock with enough history", Object.keys(ctx.fits).length === stocks.length && stocks.every((s) => ctx.fits[s.sym]));
  ok("context: every fit within the cap", Object.values(ctx.fits).every((v) => Math.abs(v.points) <= 1.5 && Number.isFinite(v.points)));
  ok("context: measured sensitivities used when a year of closes exists", ctx.fits.T00.measured === true && ctx.fits.SHORTY.measured === false);
  ok("context: rotation map covers the groups that have 6 months of closes", ctx.rotation.groups.length === KINDS.length && ctx.rotation.groups.every((g) => g.label));
  ok("context: rotation read is a sentence", typeof ctx.rotation.hypothesis === "string" && ctx.rotation.hypothesis.length > 20);
  ok("context: stress check reports a state", ["normal", "rotation", "broad de-risking", "systemic"].includes(ctx.systemic.state) && !("blocksCalls" in ctx.systemic));
  ok("context: cycle labels and bucket", ctx.cycles.bucket.key.split("|").length === 3 && ctx.cycles.politics.president);
  ok("context: factor scores 4 and 13 weeks back", MC.FACTORS.every((k) => k in ctx.factorsAgo.sessions20 && k in ctx.factorsAgo.sessions65));
  ok("context: missing series are listed, not invented", ctx.missing.includes("NFCI") && ctx.missing.includes("ICSA") && !ctx.missing.includes("SPY"));
  ok("context: too little history -> null", MC.buildMacroContext({ series, calendar: cal.slice(0, 50), stocks, weights }) === null);
  ok("context: grader lines", MC.contextLines(ctx).length >= 3 && MC.contextLines(ctx)[0].startsWith("Cycle read:"));
  // Candidate inputs (Baa spread, recession odds): shown, never scored.
  ok("candidates: listed, unscored, empty without their inputs", ctx.candidates?.scored === false && ctx.candidates.now.baa.score === null && ctx.candidates.now.recession.score === null);
  const withBaa = MC.buildMacroContext({ series: { ...series, BAA10Y: daily(level(2.0, 0.004, 0.02)) }, calendar: cal, stocks, weights, partyRows, breadthPct200: 60, candidateLive: { kalshiRecessionPct: 40 } });
  ok("candidates: the Baa spread reads level and 3-month change", withBaa.candidates.now.baa.detail.spread > 2 && withBaa.candidates.now.baa.detail.change3m > 0 && withBaa.candidates.now.baa.score > -2);
  ok("candidates: a missing Kalshi read is no read, not 0% odds", MC.buildMacroContext({ series, calendar: cal, stocks, weights, candidateLive: { kalshiRecessionPct: null } }).candidates.now.recession.score === null);
  ok("candidates: 40% recession odds read +1", withBaa.candidates.now.recession.score === 1 && withBaa.candidates.now.recession.detail.oddsPct === 40);
  ok("candidates: the fits and grader lines do not change", JSON.stringify(withBaa.fits) === JSON.stringify(MC.buildMacroContext({ series, calendar: cal, stocks, weights, partyRows, breadthPct200: 60 }).fits) && JSON.stringify(MC.contextLines(withBaa)) === JSON.stringify(MC.contextLines(ctx)));
  ok("candidates: not in the learned feature list", MC.MACRO_CANDIDATES.every((k) => !MC.FACTORS.includes(k)) && !MC.MACRO_FEATS.some((f) => /baa|recession/.test(f)) && !withBaa.missing.includes("BAA10Y"));
  const lateDate = MC.buildMacroContext({ series, calendar: cal, date: cal[300], stocks, weights });
  ok("context: a past date sees only data through that date", lateDate.asOf === cal[300]);
  ok("party: tilt from the Party tracker rows", MC.partyTiltFor("XLF", { president: "R", house: "R", senate: "R" }, partyRows) === 2.25 && MC.partyTiltFor("XLK", { president: "R" }, partyRows) === null);

  // ---- engine hooks with the switch OFF -------------------------------------------
  // The settings are read when build.mjs first loads, so the kill switch is set here.
  process.env.PICKS_MACRO_CONTEXT = "0";
  const B = await import("./build.mjs");
  ok("switch off with PICKS_MACRO_CONTEXT=0", B.PICKS_MACRO_CONTEXT === false && B.GRADE_MODEL_VERSION === "2026-11-price-pillar");
  ok("AXP reads as a card lender in the macro read only", B.macroContextKindOf("AXP") === "cardLender" && B.macroKindOf("AXP", {}) !== "cardLender");
  const chainsOff = { AXP: { spot: 300, chains: {}, technicals: null, fundamentals: { sector: null } } };
  const mbOff = { macroContext: { fits: { AXP: { points: 1.2, predRelPct: 0.27, kind: "cardLender", parts: [] } }, factors: { rates: { detail: { pricedPct: 0.7 } } } }, rotation: { spread: 0.1, spread20d: -9 } };
  const offRow = B.scoreAllTickers(chainsOff, [], null, null, mbOff, null, {}).scored.find((r) => r.sym === "AXP");
  ok("switch off: the fit adds no points and is not attached", offRow && offRow.preRegimeTotal === 0 && !offRow.macroFit);
  const mrOff = B.computeMacroRegime(mbOff, null, null, null, []);
  ok("switch off: the Fed axis ignores hikes priced", mrOff.axes.fed.score === 0);
  ok("switch off: the rotation axis reads one day", mrOff.axes.rotation.score === 0 && !mrOff.axes.rotation.window);
  ok("switch off: the browser tape keeps the one-day help text", mrOff.thresholds?.macroContextOn === false);
  const ctxB = B.buildMacroContextForBuild({ chains: null });
  ok("switch off: bake helper is safe with nothing", ctxB === null);
  const msg = B.macroGraderLines({ sym: "T10", macroFit: { ...ctx.fits.T10, kindLabel: "card lenders" } }, "call", ctx).join("\n");
  ok("grader prompt: cycle lines and the fit sentence when supplied", /MACRO CYCLES — Cycle read:/.test(msg) && /MACRO FIT \(card lenders;/.test(msg));
  ok("grader prompt: nothing added without the context", B.macroGraderLines({ sym: "T10" }, "call", null).length === 0);
  const base = B.buildThesisUserMessage({ sym: "T10", data: { spot: 50, fundamentals: {} }, total: 5, pillars: {}, drivers: [], macroFit: ctx.fits.T10 }, "call", null, { macroContext: ctx });
  ok("grader prompt: the base message never carries the macro lines", !/MACRO CYCLES|MACRO FIT/.test(base));

  // ---- switch ON in a child process --------------------------------------------
  ok("switch off: no macro block", B.macroConflict({ macroFit: { points: -1.5 } }, "call") === false && B.structuralVeto({ macroFit: { points: -1.5 } }, "call") === null);
  // An undefined value leaves the setting out of the child's environment.
  for (const [mode, env] of [["--on", {}], ["--on-points", { PICKS_MACRO_POINTS: "1", PICKS_MACRO_BLOCK_PTS: "0" }]]) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode], { env: { ...process.env, PICKS_MACRO_CONTEXT: undefined, PICKS_MACRO_POINTS: undefined, PICKS_MACRO_BLOCK_PTS: undefined, ...env }, encoding: "utf8" });
    process.stdout.write(child.stdout || "");
    if (child.status !== 0) { failures++; console.log(`FAIL ${mode} run exited ${child.status}\n${child.stderr || ""}`); }
    else passes += Number((child.stdout.match(/ON-PASSES (\d+)/) || [])[1] || 0);
  }
  console.log(failures ? `macro-context smoke: ${failures} failed, ${passes} passed` : `macro-context smoke: all ${passes} checks passed`);
  process.exit(failures ? 1 : 0);
} else {
  const B = await import("./build.mjs");
  const pointsMode = process.argv.includes("--on-points");
  ok("switch on by default: version moves so the Track Record splits", B.PICKS_MACRO_CONTEXT === true && B.GRADE_MODEL_VERSION === "2026-11-macro-context");
  const T = B.computeMacroRegime({}, null, null, null, []).thresholds || {};
  ok("switch on: the browser tape gets the one-month and hikes-priced settings", T.macroContextOn === true && T.rotationPp20d === 4 && T.fedPricedPts === 0.25);
  const chains = { AXP: { spot: 300, chains: {}, technicals: null, fundamentals: { sector: null } }, SPY: { spot: 500, chains: {}, technicals: null, fundamentals: { quoteType: "ETF" } } };
  const fitsUp = { AXP: { points: 1.2, predRelPct: 0.27, kind: "cardLender", parts: [{ key: "credit", label: "Credit conditions", contributionPct: 0.2 }] }, SPY: { points: 1.5, kind: "broad", parts: [] } };
  const up = B.scoreAllTickers(chains, [], null, null, { macroContext: { fits: fitsUp } }, null, {}).scored;
  const axp = up.find((r) => r.sym === "AXP"), spy = up.find((r) => r.sym === "SPY");
  ok("switch on: funds get no macro fit", spy.preRegimeTotal === 0 && !spy.macroFit);
  if (pointsMode) {
    ok("points mode: the fit adds its points before the regime overlay", axp.preRegimeTotal === 1.2 && axp.macroFit?.points === 1.2 && axp.macroFit.inGrade === true && axp.macroFit.kindLabel === "card lenders");
    const down = B.scoreAllTickers(chains, [], null, null, { macroContext: { fits: { AXP: { ...fitsUp.AXP, points: -1.2 } } } }, null, {}).scored.find((r) => r.sym === "AXP");
    ok("points mode: the fit never pushes a grade across zero", down.preRegimeTotal === 0);
    ok("points mode with the block at 0: nothing blocked", B.PICKS_MACRO_BLOCK_PTS === 0 && B.structuralVeto({ macroFit: { points: -1.5 } }, "call") === null);
    ok("points mode: grader line says the fit is in the grade", /already inside the grade/.test(B.macroGraderLines({ macroFit: { ...fitsUp.AXP, kindLabel: "card lenders", inGrade: true } }, "call", null).join("")));
  } else {
    ok("default: the fit is shown but adds no points", B.PICKS_MACRO_POINTS === false && axp.preRegimeTotal === 0 && axp.macroFit?.points === 1.2 && axp.macroFit.inGrade === false);
    ok("default: block at 0.5 points", B.PICKS_MACRO_BLOCK_PTS === 0.5);
    ok("block: a call the fit reads -0.5 or lower is kept off", B.structuralVeto({ macroFit: { points: -0.5 } }, "call") === "macro-conflict" && B.structuralVeto({ macroFit: { points: -0.49 } }, "call") === null);
    ok("block: a put the fit reads +0.5 or higher is kept off", B.structuralVeto({ macroFit: { points: 0.73 } }, "put") === "macro-conflict" && B.structuralVeto({ macroFit: { points: -0.9 } }, "put") === null);
    ok("block: no fit, no block; the older vetoes still come first", B.structuralVeto({}, "call") === null && B.structuralVeto({ pendingBuyout: { block: true }, macroFit: { points: -1 } }, "call") === "pending-buyout");
    ok("block: grader line says the fit is not in the grade", /not added to the grade/.test(B.macroGraderLines({ macroFit: { ...fitsUp.AXP, kindLabel: "card lenders", inGrade: false } }, "call", null).join("")));
    const NP = (await import("../lib/no-picks.mjs")).noPicksFactory();
    ok("block: the gate has a label and a next step", /macro backdrop/.test(NP.GATE_LABEL["macro-conflict"]) && NP.GATE_NEXT["macro-conflict"].length > 20);
  }
  const mb = { macroContext: { factors: { rates: { detail: { pricedPct: 0.7 } } } }, rotation: { spread: 0.1, spread20d: -9 } };
  const mr = B.computeMacroRegime(mb, null, null, null, []);
  ok("switch on: hikes priced floor the Fed axis at -1", mr.axes.fed.score === -1 && /Hikes priced/.test(mr.axes.fed.label) && mr.axes.fed.pricedPct === 0.7);
  ok("switch on: the rotation axis reads one month", mr.axes.rotation.window === "20d" && mr.axes.rotation.score <= -1);
  const calm = B.computeMacroRegime({ macroContext: { factors: { rates: { detail: { pricedPct: 0.1 } } } }, rotation: { spread: 0.1, spread20d: 1 } }, null, null, null, []);
  ok("switch on: nothing priced, no floor; small spread, no vote", calm.axes.fed.score === 0 && calm.axes.rotation.score === 0);
  console.log(`ON-PASSES ${passes}`);
  if (failures) process.exit(1);
}

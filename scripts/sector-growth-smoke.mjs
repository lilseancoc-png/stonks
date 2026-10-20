// Offline smoke test for the sector-relative growth bars (lib/sector-growth.mjs)
// and their wiring into the Fundamentals pillar. No network, no data/.
// Run: node scripts/sector-growth-smoke.mjs
import {
  GROWTH_PROFILES, LEGACY_GROWTH_BARS, GROWTH_RECOVERY_PP,
  growthProfileKeyFor, growthBarScore, quarterlyYoySeries, latestTwoYoy, scoreSectorGrowth,
} from "../lib/sector-growth.mjs";
import { TICKERS, SECTORS } from "./build.mjs";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const AS_OF = Date.parse("2026-10-20T15:00:00Z");
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
// Quarter-end rows oldest -> newest, ending 2026-09-30.
function quarterRows(values, endY = 2026, endM = 9) {
  const out = [];
  let y = endY, m = endM;
  for (let i = values.length - 1; i >= 0; i--) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.unshift({ date: iso(y, m, last), value: values[i] });
    m -= 3; if (m <= 0) { m += 12; y -= 1; }
  }
  return out;
}

// --- 1. Every profile's bars are ordered and sane --------------------------
for (const [key, p] of Object.entries(GROWTH_PROFILES)) {
  for (const which of ["rev", "eps"]) {
    const b = p[which];
    if (!b) { ok(`${key}.${which}: only early-stage skips EPS`, key === "earlyStage" && which === "eps"); continue; }
    ok(`${key}.${which}: shrink < above < wellAbove`, b.shrink < b.above && b.above < b.wellAbove, JSON.stringify(b));
    if (b.low != null) ok(`${key}.${which}: shrink < low < above`, b.shrink < b.low && b.low < b.above, JSON.stringify(b));
    else ok(`${key}.${which}: no in-line band only for early-stage`, key === "earlyStage");
  }
}
ok("memory: in-line band starts at 10%, not 0%", GROWTH_PROFILES.memory.rev.low === 10 && GROWTH_PROFILES.memory.eps.low === 10);
ok("legacy bars unchanged", JSON.stringify(LEGACY_GROWTH_BARS) === JSON.stringify({
  rev: { low: null, above: 8, wellAbove: 20, shrink: -20 }, eps: { low: null, above: 10, wellAbove: 30, shrink: -25 },
}));

// --- 2. Every covered stock has a profile ----------------------------------
const stocks = TICKERS.filter((s) => SECTORS[s] !== "ETF");
const unmapped = stocks.filter((s) => !growthProfileKeyFor(s, SECTORS[s]));
ok("every covered stock maps to a growth profile", unmapped.length === 0, unmapped.join(","));
ok("NVDA uses Semis bars", growthProfileKeyFor("NVDA", SECTORS.NVDA) === "semis");
ok("MU/SNDK/WDC/DRAM use Memory bars", ["MU", "SNDK", "WDC", "DRAM"].every((s) => growthProfileKeyFor(s, SECTORS[s]) === "memory"));
ok("ASML/AMAT use Semi equipment bars", ["ASML", "AMAT"].every((s) => growthProfileKeyFor(s, SECTORS[s]) === "semiEquipment"));
ok("COST/WMT/TGT/HD use Retail bars", ["COST", "WMT", "TGT", "HD"].every((s) => growthProfileKeyFor(s, SECTORS[s]) === "retail"));
ok("UNH uses Managed care bars", growthProfileKeyFor("UNH", SECTORS.UNH) === "managedCare");
ok("unknown sector keeps legacy bars", growthProfileKeyFor("ZZZZ", "Energy") === null
  && scoreSectorGrowth({ sym: "ZZZZ", sectorLabel: "Energy", revYoy: 5, epsYoy: 5 }) === null);

// --- 3. Bar boundaries -----------------------------------------------------
const sw = GROWTH_PROFILES.software.rev;
ok("bar: exactly +2 bar scores +2", growthBarScore(30, sw).score === 2);
ok("bar: just under +2 scores +1", growthBarScore(29.9, sw).score === 1);
ok("bar: exactly +1 bar scores +1", growthBarScore(20, sw).score === 1);
ok("bar: in-line low edge scores 0", growthBarScore(12, sw).score === 0 && growthBarScore(12, sw).verdict === "in line");
ok("bar: just under the band scores -1", growthBarScore(11.9, sw).score === -1);
ok("bar: exactly the shrink bar scores -1 (strict)", growthBarScore(0, sw).score === -1);
ok("bar: under the shrink bar scores -2", growthBarScore(-0.1, sw).score === -2);
ok("bar: early-stage has no -1 step", growthBarScore(-5, GROWTH_PROFILES.earlyStage.rev).score === 0
  && growthBarScore(-10.1, GROWTH_PROFILES.earlyStage.rev).score === -2);

// --- 4. YoY series math ------------------------------------------------------
const yoy = quarterlyYoySeries(quarterRows([100, 100, 100, 100, 60, 90]));
ok("yoy: one rate per quarter with a year-ago base", yoy.length === 2);
ok("yoy: -40% then -10%", Math.abs(yoy[0].yoy + 40) < 1e-9 && Math.abs(yoy[1].yoy + 10) < 1e-9);
const tr = latestTwoYoy(yoy, AS_OF);
ok("trend: delta is +30 points", tr && Math.abs(tr.deltaPp - 30) < 1e-9);
ok("trend: stale history (>200d) is ignored", latestTwoYoy(yoy, Date.parse("2027-06-30")) === null);
ok("yoy: zero/negative base is skipped", quarterlyYoySeries(quarterRows([-1, 1, 1, 1, 2])).length === 0);

// --- 5. Recovery guard (the owner's -40% -> -10% case) ---------------------
const recover = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: -10, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 60, 90]) }, asOfMs: AS_OF,
});
ok("recovery: -40% -> -10% is not penalized", recover.rev.score === 0 && recover.rev.verdict === "recovering", JSON.stringify(recover.rev));
ok("recovery: note names both quarters", /Revenue growth went from -40% to -10% over the last two quarters/.test(recover.rev.note), recover.rev.note);
const stillFalling = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: -35, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 60, 65]) }, asOfMs: AS_OF,
});
ok("recovery: -40% -> -35% keeps the -2", stillFalling.rev.score === -2, JSON.stringify(stillFalling.rev));
const memSmall = scoreSectorGrowth({
  sym: "MU", sectorLabel: SECTORS.MU, revYoy: -30, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 55, 70]) }, asOfMs: AS_OF,
});
ok("recovery: memory needs 20 points (-45% -> -30% is 15)", memSmall.rev.score === -2, JSON.stringify(memSmall.rev));
ok("recovery: default threshold is 10 points", GROWTH_RECOVERY_PP === 10);
// Seasonal business: a big holiday/16-week quarter followed by a smaller one.
// Same-quarter YoY rates are flat, so nothing reads as recovering.
const seasonal = scoreSectorGrowth({
  sym: "COST", sectorLabel: "Retail", revYoy: -6, epsYoy: 8,
  fundamentals: { revenueHistory: quarterRows([60, 60, 80, 60, 56, 56.4]) }, asOfMs: AS_OF,
});
ok("seasonality: a seasonal sequential drop is not read as a trend", seasonal.rev.score === -2, JSON.stringify(seasonal.rev));
// Consensus fallback when only one YoY rate exists.
const consensus = scoreSectorGrowth({
  sym: "NKE", sectorLabel: "Apparel", revYoy: -12, epsYoy: 5,
  fundamentals: {
    revenueHistory: quarterRows([100, 100, 100, 100, 88]),
    revenueForwardEstimates: [{ date: "2026-12-31", period: "0q", value: 99 }],
  },
  asOfMs: AS_OF,
});
ok("recovery: consensus fallback (-12% now, -1% expected)", consensus.rev.score === 0 && consensus.rev.recovery?.source === "consensus", JSON.stringify(consensus.rev));

// --- 6. EPS one-off guard ----------------------------------------------------
const oneOff = scoreSectorGrowth({ sym: "MRVL", sectorLabel: "Semis", revYoy: 27.6, epsYoy: -80.4, fundamentals: {}, asOfMs: AS_OF });
ok("eps one-off: healthy revenue, no EPS history -> not scored", oneOff.eps.score === 0 && /one quarter/.test(oneOff.eps.verdict), JSON.stringify(oneOff.eps));
const twoBad = scoreSectorGrowth({
  sym: "TGT", sectorLabel: "Retail", revYoy: 4, epsYoy: -25,
  fundamentals: { netIncomeHistory: quarterRows([2, 2, 2, 2, 1.7, 1.5]) }, asOfMs: AS_OF,
});
ok("eps: below norm two quarters running is penalized", twoBad.eps.score === -2, JSON.stringify(twoBad.eps));
const oneOffWithHx = scoreSectorGrowth({
  sym: "TGT", sectorLabel: "Retail", revYoy: 4, epsYoy: -25,
  fundamentals: { netIncomeHistory: quarterRows([2, 2, 2, 2, 2.2, 1.5]) }, asOfMs: AS_OF,
});
ok("eps one-off: prior quarter healthy (+10%) -> not scored, note names it", oneOffWithHx.eps.score === 0
  && /net income grew 10% the quarter before/.test(oneOffWithHx.eps.note), JSON.stringify(oneOffWithHx.eps));
const noRevEps = scoreSectorGrowth({ sym: "TGT", sectorLabel: "Retail", revYoy: null, epsYoy: -25, fundamentals: {}, asOfMs: AS_OF });
ok("eps one-off: needs revenue evidence (missing revenue keeps the penalty)", noRevEps.eps.score === -2, JSON.stringify(noRevEps.eps));
// Revenue below its norm but improving still confirms an EPS penalty: the
// one-off guard is for a weak EPS quarter on healthy revenue.
const revImprovingEpsWeak = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: -10, epsYoy: -30,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 60, 90]) }, asOfMs: AS_OF,
});
ok("eps: revenue recovering (waived) still confirms a weak EPS quarter", revImprovingEpsWeak.rev.score === 0
  && revImprovingEpsWeak.eps.score === -2, JSON.stringify(revImprovingEpsWeak.eps));
// EPS has no consensus stand-in (the estimate is adjusted EPS, the figure is GAAP).
const epsNoConsensus = scoreSectorGrowth({
  sym: "NKE", sectorLabel: "Apparel", revYoy: 0.1, epsYoy: -34.8,
  fundamentals: { growthEstimateCurQ: 40 }, asOfMs: AS_OF,
});
ok("eps: consensus does not waive an EPS penalty", epsNoConsensus.eps.score === -2 && epsNoConsensus.eps.recovery == null, JSON.stringify(epsNoConsensus.eps));
// History that ends a quarter before the latest reported quarter is not used.
const lagged = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: -10, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 60, 90], 2026, 6), lastQuarter: { date: "2026-09-30" } },
  asOfMs: AS_OF,
});
ok("recovery: history lagging the latest quarter is ignored", lagged.rev.score === -2 && lagged.rev.recovery == null, JSON.stringify(lagged.rev));
const aligned = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: -10, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 60, 90]), lastQuarter: { date: "2026-09-30" } },
  asOfMs: AS_OF,
});
ok("recovery: history ending at the latest quarter is used", aligned.rev.score === 0 && aligned.rev.verdict === "recovering", JSON.stringify(aligned.rev));
const revConfirm = scoreSectorGrowth({ sym: "NKE", sectorLabel: "Apparel", revYoy: -10, epsYoy: -35, fundamentals: {}, asOfMs: AS_OF });
ok("eps: penalized when revenue is penalized too", revConfirm.rev.score === -2 && revConfirm.eps.score === -2);
const epsRecover = scoreSectorGrowth({
  sym: "DIS", sectorLabel: "Media", revYoy: 1, epsYoy: -10,
  fundamentals: { netIncomeHistory: quarterRows([1, 1, 1, 1, 0.5, 0.9]) }, asOfMs: AS_OF,
});
ok("eps: -50% -> -10% reads recovering", epsRecover.eps.score === 0 && epsRecover.eps.verdict === "recovering", JSON.stringify(epsRecover.eps));
ok("eps: recovery note shows both quarters on the net income basis",
  /Net income growth went from -50% to -10% over the last two quarters \(\+40 pts\)/.test(epsRecover.eps.note), epsRecover.eps.note);
// A positive rate under the band that is climbing reads "improving", not
// "recovering" (nothing to recover from).
const improving = scoreSectorGrowth({
  sym: "CRM", sectorLabel: "Software", revYoy: 10, epsYoy: 20,
  fundamentals: { revenueHistory: quarterRows([100, 100, 100, 100, 99, 110]) }, asOfMs: AS_OF,
});
ok("recovery: -1% -> +10% reads improving, not recovering", improving.rev.score === 0 && improving.rev.verdict === "improving"
  && improving.rev.value === "10% · improving", JSON.stringify(improving.rev));
ok("recovery: note says the shortfall is not penalized", /so the shortfall is not penalized/.test(improving.rev.note), improving.rev.note);
// Missing EPS (Yahoo sends no earningsGrowth) stays unavailable, never "0%".
const noEps = scoreSectorGrowth({ sym: "CRWD", sectorLabel: "Software", revYoy: 22, epsYoy: null, fundamentals: {}, asOfMs: AS_OF });
ok("eps: missing EPS growth is unavailable and unscored", noEps.eps.available === false && noEps.eps.score === 0
  && noEps.eps.value === null && noEps.eps.verdict === null, JSON.stringify(noEps.eps));

// --- 7. Sector examples from the review ---------------------------------------
const cost = scoreSectorGrowth({ sym: "COST", sectorLabel: "Retail", revYoy: 11.1, epsYoy: 15, fundamentals: {}, asOfMs: AS_OF });
ok("COST 11.1% revenue is well above the retail norm (+2)", cost.rev.score === 2 && cost.rev.value === "11.1% · well above norm");
ok("COST 15% EPS is above the retail norm (+1)", cost.eps.score === 1);
const intu = scoreSectorGrowth({ sym: "INTU", sectorLabel: "Software", revYoy: 10.4, epsYoy: 10.7, fundamentals: {}, asOfMs: AS_OF });
ok("INTU 10.4% revenue is below the software norm (-1)", intu.rev.score === -1);
ok("INTU EPS below norm is penalized only because revenue is too", intu.eps.score === -1);
const pltr = scoreSectorGrowth({ sym: "PLTR", sectorLabel: "Software", revYoy: 84.7, epsYoy: 325, fundamentals: {}, asOfMs: AS_OF });
ok("PLTR is well above on both (+2/+2)", pltr.rev.score === 2 && pltr.eps.score === 2);
const asts = scoreSectorGrowth({ sym: "ASTS", sectorLabel: "Space", revYoy: 1952, epsYoy: -40, fundamentals: {}, asOfMs: AS_OF });
ok("early-stage: revenue +2, EPS shown but not scored", asts.rev.score === 2 && asts.eps.score === 0 && asts.eps.available === true && /not scored/.test(asts.eps.value));
const mu = scoreSectorGrowth({ sym: "MU", sectorLabel: SECTORS.MU, revYoy: 5, epsYoy: 20, fundamentals: {}, asOfMs: AS_OF });
ok("memory: 5% revenue is below the 10% band (-1)", mu.rev.score === -1);
const jpm = scoreSectorGrowth({ sym: "JPM", sectorLabel: "Bank", revYoy: 12.7, epsYoy: 17.2, fundamentals: {}, asOfMs: AS_OF });
ok("JPM 12.7% revenue / 17.2% EPS are above the bank norm", jpm.rev.score === 1 && jpm.eps.score === 1);
const nulls = scoreSectorGrowth({ sym: "CRWD", sectorLabel: "Software", revYoy: null, epsYoy: null, fundamentals: {}, asOfMs: AS_OF });
ok("missing inputs stay unavailable and score 0", nulls.rev.available === false && nulls.eps.available === false && nulls.rev.score === 0 && nulls.eps.score === 0);

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);

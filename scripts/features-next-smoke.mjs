// Smoke test for the 2026-11-08 feature additions that ride existing data:
// F5 macro what-if dials (lib/scenario-engine.mjs scenarioImpactFactory),
// F6 insider cluster buying (lib/insider-cluster.mjs), F7 peer valuation
// bands (lib/valuation-band.mjs), F8 earnings-season by-sector scorecard
// (earningsSeasonBySector in scripts/build.mjs) and G4 the cycle clock trail
// (buildCycleTrail in lib/macro-context.mjs). No network, no data/ files,
// no AI. Run: node scripts/features-next-smoke.mjs
import { scenarioImpactFactory } from "../lib/scenario-engine.mjs";
import { insiderClusterFactory, findInsiderClusters } from "../lib/insider-cluster.mjs";
import { buildValuationBands, peerGroupFor, percentileOf, bandStats, evToSales, VALUATION_METRICS } from "../lib/valuation-band.mjs";
import { buildCycleTrail, CYCLE_CLOCK_THRESHOLDS } from "../lib/macro-context.mjs";
import { earningsSeasonBySector } from "./build.mjs";

let failures = 0, passes = 0;
const ok = (name, cond) => { if (cond) passes++; else { failures++; console.log(`FAIL ${name}`); } };
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

// ---- F5: what-if dials ----------------------------------------------------------
{
  const SI = scenarioImpactFactory();
  ok("F5: six dials with ids, ranges and units", Array.isArray(SI.DIALS) && SI.DIALS.length === 6 && SI.DIALS.every((d) => d.key && d.label && Number.isFinite(d.min) && Number.isFinite(d.max) && d.min < d.max && Number.isFinite(d.step) && typeof d.unit === "string"));
  ok("F5: presets name their shocks on known dials", Array.isArray(SI.PRESETS) && SI.PRESETS.length >= 4 && SI.PRESETS.every((p) => p.key && p.label && p.shocks && Object.keys(p.shocks).every((k) => SI.DIALS.some((d) => d.key === k))));
  ok("F5: factory is ES5-safe (no arrow functions, const or let)", !/=>|\bconst\b|\blet\b/.test(scenarioImpactFactory.toString()));
  const V = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
  const vector = V({ marketBeta: 1.2, rate10y: -0.4, rate2y: -0.2, usd: -0.3, commodity: 0.2, growthDefensive: 0.5, aiCapex: 0.8, geopolitical: -0.1 });
  const zero = SI.impact(vector, 30, {});
  ok("F5: no shock -> zero mid, a band around it", near(zero.mid, 0) && zero.low < 0 && zero.high > 0 && !SI.anyShock({}) && !SI.anyShock({ spyPct: 0 }));
  const up = SI.impact(vector, 30, { spyPct: 5 });
  ok("F5: +5% S&P with beta 1.2 -> +6% market contribution", near(up.contributions.market, 6) && near(up.mid, 6) && up.low < up.mid && up.mid < up.high && SI.anyShock({ spyPct: 5 }));
  const rates = SI.impact(vector, 30, { tenYBps: 50 });
  ok("F5: +50 bps on the 10-year scales the rate beta by 10-bp steps", near(rates.contributions.rates, -2) && rates.mid < 0);
  const vix = SI.impact(vector, 30, { vixPoints: 10 });
  ok("F5: a VIX jump drags a high-beta name, never lifts it", vix.mid < 0 && near(vix.contributions.volatility, Math.round(Math.max(0, 1.2 - 0.8) * -10 * 0.12 * 10) / 10));
  const lowBeta = SI.impact({ ...vector, marketBeta: { value: 0.5 } }, 30, { vixPoints: 10 });
  ok("F5: a low-beta name has no VIX drag", near(lowBeta.contributions.volatility, 0));
  const calm = SI.impact(vector, 12, { spyPct: 5 }), wild = SI.impact(vector, 80, { spyPct: 5 });
  ok("F5: band width grows with the name's own vol and is clamped", (wild.high - wild.low) > (calm.high - calm.low) && (wild.high - wild.low) <= 28 + 1e-9 && (calm.high - calm.low) >= 4 - 1e-9);
  const oil = SI.impact(vector, 30, { oilPct: 10 });
  ok("F5: oil moves through the commodity beta at 0.35", near(oil.contributions.commodity, 0.7));
}

// ---- F6: insider cluster buying -------------------------------------------------
{
  const IC = insiderClusterFactory();
  ok("F6: factory is ES5-safe", !/=>|\bconst\b|\blet\b/.test(insiderClusterFactory.toString()));
  const tx = [
    { symbol: "ACME", ownerName: "Ann Chief", roles: ["officer"], officerTitle: "CEO", transactionDate: "2026-10-20", direction: "buy", openMarket: true, shares: 1000, value: 50000 },
    { symbol: "ACME", ownerName: "Bob Finance", roles: ["officer"], transactionDate: "2026-10-28", direction: "buy", openMarket: true, shares: 500, value: 25000 },
    { symbol: "ACME", ownerName: "Cara Board", roles: ["director"], transactionDate: "2026-11-05", direction: "buy", openMarket: true, shares: 200, value: 10000 },
    { symbol: "ACME", ownerName: "Cara Board", roles: ["director"], transactionDate: "2026-11-06", direction: "buy", openMarket: true, shares: 100, value: 5000 },
    { symbol: "ACME", ownerName: "Dan Grant", roles: ["officer"], transactionDate: "2026-11-01", direction: "buy", openMarket: false, shares: 9000, value: 1 },
    { symbol: "ACME", ownerName: "Eve Seller", roles: ["officer"], transactionDate: "2026-11-02", direction: "sell", openMarket: true, shares: 300, value: 15000 },
    { symbol: "ACME", ownerName: "Old Timer", roles: ["director"], transactionDate: "2026-09-01", direction: "buy", openMarket: true, shares: 300, value: 15000 },
    { symbol: "DUO", ownerName: "One", transactionDate: "2026-11-01", direction: "buy", openMarket: true, shares: 10, value: 100 },
    { symbol: "DUO", ownerName: "Two", transactionDate: "2026-11-02", direction: "buy", openMarket: true, shares: 10, value: 100 },
    { symbol: "NONAME", ownerName: "", transactionDate: "2026-11-02", direction: "buy", openMarket: true, shares: 10, value: 100 },
  ];
  const read = IC.clusters(tx, { asOf: "2026-11-07" });
  ok("F6: defaults are a 30-day window and three insiders", read.windowDays === 30 && read.minInsiders === 3 && read.direction === "buy" && read.asOf === "2026-11-07");
  ok("F6: one cluster, the two-insider name and the nameless row are out", read.rows.length === 1 && read.rows[0].symbol === "ACME");
  const a = read.rows[0];
  ok("F6: three distinct insiders over four open-market buys", a.insiders === 3 && a.trades === 4 && a.shares === 1800 && a.value === 90000);
  ok("F6: grants, sales and the stale buy are excluded", !a.names.includes("Dan Grant") && !a.names.includes("Eve Seller") && !a.names.includes("Old Timer"));
  ok("F6: dates span the cluster", a.firstDate === "2026-10-20" && a.lastDate === "2026-11-06" && a.spanDays === 17);
  ok("F6: the sentence reads as English with the counts", /3 insiders/.test(IC.sentence(a)) && /\$90,000|\$90\.0k|90,000|90k/i.test(IC.sentence(a)));
  const wide = IC.clusters(tx, { asOf: "2026-11-07", windowDays: 90 });
  ok("F6: a wider window admits the September buy", wide.rows[0].insiders === 4);
  const sells = IC.clusters(tx, { asOf: "2026-11-07", direction: "sell", minInsiders: 1 });
  ok("F6: direction and minimum are honored", sells.rows.length === 1 && sells.rows[0].names[0] === "Eve Seller");
  const auto = findInsiderClusters(tx);
  ok("F6: asOf defaults to the latest transaction date, never the clock", auto.asOf === "2026-11-06" && auto.rows.length === 1);
  ok("F6: empty input is an empty read", IC.clusters([], {}).rows.length === 0 && IC.clusters(null, {}).asOf === null);
  const future = IC.clusters(tx, { asOf: "2026-10-01" });
  ok("F6: trades after asOf are not counted", future.rows.length === 0);
}

// ---- F7: peer valuation bands ---------------------------------------------------
{
  ok("F7: four metrics, each with a label and a cap", VALUATION_METRICS.length === 4 && VALUATION_METRICS.every((m) => m.key && m.label && m.max > 0));
  ok("F7: EV/sales adds debt and subtracts cash", near(evToSales({ mcap: 1000, debt: 200, cash: 100, rev: 500 }), 2.2) && evToSales({ mcap: 1000, rev: 0 }) === null);
  ok("F7: percentile is midrank 0..100", percentileOf([1, 2, 3, 4, 5], 3) === 50 && percentileOf([1, 2, 3, 4], 0) === 0 && percentileOf([1, 2, 3, 4], 9) === 100 && percentileOf([], 1) === null);
  const st = bandStats([10, 20, 30, 40, 50]);
  ok("F7: band stats carry n, lo, quartiles, median, hi", st.n === 5 && st.lo === 10 && st.hi === 50 && st.median === 30 && st.p25 <= st.median && st.median <= st.p75 && bandStats([1, 2]) === null);
  const symbols = ["A1", "A2", "A3", "A4", "B1", "B2", "E1"];
  const industries = { A1: "Semis", A2: "Semis", A3: "Semis", A4: "Semis", B1: "Software", B2: "Software" };
  const sectors = { A1: "Tech", A2: "Tech", A3: "Tech", A4: "Tech", B1: "Tech", B2: "Tech", E1: "ETF" };
  const groupOf = (s) => (sectors[s] === "ETF" ? "ETFs" : "Technology");
  const isEtf = (s) => s === "E1";
  const pA = peerGroupFor("A1", { symbols, industries, sectors, groupOf, isEtf });
  ok("F7: four names in a sub-industry make an industry band without the stock itself", pA.basis === "industry" && pA.label === "Semis" && pA.members.length === 3 && !pA.members.includes("A1"));
  const pB = peerGroupFor("B1", { symbols, industries, sectors, groupOf, isEtf });
  ok("F7: a thin sub-industry falls back to the sector, ETFs excluded", pB.basis === "sector" && pB.members.length === 5 && !pB.members.includes("E1") && !pB.members.includes("B1"));
  const pG = peerGroupFor("B1", { symbols, industries, sectors: { ...sectors, B1: "Lonely" }, groupOf, isEtf });
  ok("F7: a lone sector falls back to the broad group", pG.basis === "group" && pG.members.length === 5);
  const chains = {};
  symbols.forEach((s, i) => { chains[s] = { fundamentals: { trailingPE: 20 + i * 5, forwardPE: 18 + i * 4, priceToSales: 5 + i, marketCap: 1e11 * (i + 1), totalDebt: 1e10, totalCash: 5e9, revenue: 2e10 * (i + 1) } }; });
  chains.E1 = { fundamentals: { trailingPE: 22 } };
  const history = new Map([["A1", [
    { date: "2026-08-01", pe: 15, fpe: 14, ps: 4, mcap: 9e10, debt: 1e10, cash: 5e9, rev: 2e10 },
    { date: "2026-09-01", pe: 18, fpe: 16, ps: 4.5, mcap: 9.5e10, debt: 1e10, cash: 5e9, rev: 2e10 },
    { date: "2026-10-01", pe: 25, fpe: 20, ps: 5.5, mcap: 1.1e11, debt: 1e10, cash: 5e9, rev: 2e10 },
  ]]]);
  const vb = buildValuationBands({ chains, symbols, industries, sectors, groupOf, isEtf, history, builtAtIso: "2026-11-08T15:00:00Z", asOf: "2026-11-08" });
  ok("F7: payload shape", vb.version === 1 && vb.asOf === "2026-11-08" && vb.minPeers === 4 && vb.metrics.length === 4 && typeof vb.note === "string" && vb.peerGroups >= 1);
  ok("F7: ETFs get no row; stocks with fundamentals do", !vb.rows.E1 && vb.rows.A1 && vb.rows.B2);
  const a1 = vb.rows.A1;
  ok("F7: current P/E and peers with a percentile", a1.pe.value === 20 && a1.pe.peers && a1.pe.peers.n === 3 && a1.pe.peers.lo === 25 && a1.pe.peers.hi === 35 && a1.pe.peers.pct === 0);
  ok("F7: own range from the saved history with session count and dates", a1.pe.own && a1.pe.own.days === 3 && a1.pe.own.lo === 15 && a1.pe.own.hi === 25 && a1.pe.own.from === "2026-08-01" && a1.pe.own.to === "2026-10-01" && a1.pe.own.pct != null);
  ok("F7: EV/sales row is derived for the current value and the history", a1.evs && a1.evs.value != null && a1.evs.own && a1.evs.own.days === 3);
  ok("F7: a name without history has no own band but keeps peers", vb.rows.B2.pe.own === null && vb.rows.B2.pe.peers && vb.rows.B2.pe.peers.n === 5);
  const capped = buildValuationBands({ chains: { X: { fundamentals: { trailingPE: 9000, priceToSales: 3 } } }, symbols: ["X"] });
  ok("F7: an absurd multiple is dropped, not plotted", capped.rows.X && (capped.rows.X.pe == null || capped.rows.X.pe.value == null) && capped.rows.X.ps.value === 3);
}

// ---- F8: earnings season by sector ---------------------------------------------
{
  const groupOf = (s) => ({ A: "Technology", B: "Technology", C: "Technology", D: "Technology", E: "Energy", F: "Energy" }[s] || null);
  const rows = [
    { sym: "A", sector: "Semis", eps: "beat", guidance: "up", guidanceSrc: "call", movePct: 0.05, exceededImplied: true, week1Pct: 0.06 },
    { sym: "B", sector: "Software", eps: "beat", guidance: "inline", guidanceSrc: "news", movePct: 0.02, exceededImplied: false, week1Pct: 0.01 },
    { sym: "C", sector: "Software", eps: "miss", guidance: null, movePct: -0.08, exceededImplied: true, week1Pct: -0.1 },
    { sym: "D", sector: "Hardware", eps: "inline", guidance: "down", guidanceSrc: "call", movePct: 0.0, exceededImplied: null, week1Pct: null },
    { sym: "E", sector: "Oil", eps: "beat", guidance: null, movePct: 0.03 },
    { sym: "F", sector: "Oil", eps: null, guidance: null, movePct: null },
    { sym: "Z", sector: "Mystery", eps: "beat", movePct: 0.01 },
  ];
  const out = earningsSeasonBySector(rows, groupOf);
  ok("F8: one row per broad group, largest first, unknown falls back to the fine sector", out.length === 3 && out[0].group === "Technology" && out[1].group === "Energy" && out[2].group === "Mystery");
  const t = out[0];
  ok("F8: counts beats, in-lines and misses", t.reported === 4 && t.names === 4 && t.epsKnown === 4 && t.beat === 2 && t.inline === 1 && t.miss === 1 && t.beatRatePct === 50);
  ok("F8: guidance split and how many came from calls", t.guidKnown === 3 && t.guidUp === 1 && t.guidInline === 1 && t.guidDown === 1 && t.guidFromCalls === 2);
  ok("F8: reactions: up/down breadth, averages, implied-move exceedance", t.moveKnown === 4 && t.up === 2 && t.down === 1 && t.breadthPct === 66.7 && near(t.avgMovePct, -0.0025, 1e-6) && t.impliedKnown === 3 && t.exceeded === 2 && t.exceededPct === 66.7);
  ok("F8: week-one drift averages only the known prints", t.avgWeek1Pct != null && near(t.avgWeek1Pct, -0.01, 1e-6));
  ok("F8: tone needs three reports; two-name Energy has none", ["positive", "mixed", "negative"].includes(t.tone) && out[1].tone === null && out[1].epsKnown === 1 && out[1].moveKnown === 1);
  ok("F8: empty input is an empty table", earningsSeasonBySector([]).length === 0 && earningsSeasonBySector(null).length === 0);
  const hot = earningsSeasonBySector([1, 2, 3, 4].map((i) => ({ sym: "S" + i, sector: "X", eps: "beat", guidance: "up", movePct: 0.04 })), () => "G");
  const cold = earningsSeasonBySector([1, 2, 3, 4].map((i) => ({ sym: "S" + i, sector: "X", eps: "miss", guidance: "down", movePct: -0.04 })), () => "G");
  ok("F8: tone follows the evidence", hot[0].tone === "positive" && cold[0].tone === "negative");
}

// ---- G4: cycle clock trail -----------------------------------------------------
{
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const rand = rng(11);
  const cal = [];
  for (let d = Date.UTC(2024, 0, 2); cal.length < 420; d += 86400000) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) cal.push(new Date(d).toISOString().slice(0, 10));
  }
  const walk = (start, drift, vol) => { let x = start; return cal.map(() => (x *= 1 + drift + (rand() - 0.5) * vol)); };
  const level = (start, drift, vol) => { let x = start; return cal.map(() => (x += drift + (rand() - 0.5) * vol)); };
  const daily = (v) => ({ t: cal.slice(), v });
  const monthly = (start, step) => { const t = [], v = []; let x = start; for (let m = 0; m < 36; m++) { t.push(`${2022 + Math.floor((m + 11) / 12)}-${String(((m + 11) % 12) + 1).padStart(2, "0")}-01`); v.push((x *= 1 + step)); } return { t, v }; };
  const series = {
    SPY: daily(walk(470, 0.0005, 0.02)), HYG: daily(walk(76, 0.0001, 0.006)), IEF: daily(walk(95, 0, 0.006)),
    USO: daily(walk(72, 0.0008, 0.03)), "DX-Y.NYB": daily(walk(102, 0.0002, 0.006)), "^VIX": daily(level(15, 0, 1.2).map((x) => Math.max(10, x))),
    DFF: daily(level(5.3, -0.002, 0.01)), DGS2: daily(level(4.4, -0.001, 0.06)), T10Y2Y: daily(level(-0.3, 0.002, 0.04)),
    T5YIE: daily(level(2.3, 0, 0.03)), CPIAUCSL: monthly(300, 0.003), CPILFESL: monthly(305, 0.0028), UNRATE: monthly(3.8, 0.004),
  };
  ok("G4: thresholds are the documented bars", CYCLE_CLOCK_THRESHOLDS.growthSlowing === -0.75 && CYCLE_CLOCK_THRESHOLDS.growthStrong === 0.5 && CYCLE_CLOCK_THRESHOLDS.cpiWarm === 2.5 && CYCLE_CLOCK_THRESHOLDS.cpiHot === 3.5);
  const trail = buildCycleTrail({ series, calendar: cal, months: 12 });
  ok("G4: a trail builds from the synthetic history", trail && trail.asOf === cal[cal.length - 1] && trail.months === 12 && trail.thresholds.cpiHot === 3.5);
  ok("G4: one point per month, 13 months for a 12-month trail, in order", trail.points.length === 13 && trail.points.every((p, i, a) => i === 0 || a[i - 1].month < p.month) && trail.points.every((p) => /^\d{4}-\d{2}$/.test(p.month) && p.date.startsWith(p.month)));
  ok("G4: every point has growth, CPI and a quadrant", trail.points.every((p) => Number.isFinite(p.growth) && Number.isFinite(p.cpiYoy) && typeof p.quadrant === "string" && p.quadrant.length > 0 && p.growthLabel && p.inflationLabel));
  const last = trail.points[trail.points.length - 1];
  ok("G4: `now` repeats the last point", trail.now.quadrant === last.quadrant && trail.now.growth === last.growthLabel && trail.now.inflation === last.inflationLabel);
  ok("G4: CPI year over year is in a sane band for a 0.3%/month series", trail.points.every((p) => p.cpiYoy > 2 && p.cpiYoy < 5));
  const back = buildCycleTrail({ series, calendar: cal, months: 12, date: cal[300] });
  ok("G4: an as-of date stops the trail there", back && back.asOf === cal[300] && back.points[back.points.length - 1].date <= cal[300]);
  ok("G4: too little history -> null; no series -> null", buildCycleTrail({ series, calendar: cal.slice(0, 50) }) === null && buildCycleTrail({ series: {}, calendar: cal }) === null);
  const six = buildCycleTrail({ series, calendar: cal, months: 6 });
  ok("G4: a shorter trail has fewer points", six.points.length === 7);
}

console.log(`features-next-smoke: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);

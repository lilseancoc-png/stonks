// Offline checks for the Owner Valuation lab (lib/valuation-lab.mjs,
// 2026-11-17): the five methods on made-up companies, the blend and weights,
// what the price implies, drivers and the rate x growth grid, the bake
// builder, the Owner-only key, the kill switch, the MCP value_stock tool and
// that the browser copy of the factory is the same code. Synthetic data only.
// Run: node scripts/valuation-lab-smoke.mjs
import assert from "node:assert/strict";
import { valuationLabFactory, valuationRow, buildValuationLab, forecastContext, valuationLabEnabled, VALUATION_LAB_KEY } from "../lib/valuation-lab.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { OWNER_PAGE_IDS } from "../lib/owner-access-policy.mjs";
import { OWNER_SETTINGS } from "../lib/owner-settings.mjs";
import { SOURCE_KEYS } from "../lib/site-catalog/feature-sources.mjs";

const L = valuationLabFactory();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Made-up companies (not real filings).
export function valuationFixture() {
  const chains = {
    MEGA: { spot: 200, fundamentals: { name: "Mega Platforms (made up)", marketCap: 2e12, sharesOutstanding: 1e10, trailingPE: 32, forwardPE: 27, revenue: 300e9, freeCashFlow: 80e9, totalCash: 60e9, totalDebt: 90e9, beta: 1.15, returnOnEquity: 45, revenueGrowthYoy: 9, growthEstimateCurY: 12, payoutRatio: 12, dividendYield: 0.5, targetMeanPrice: 230, targetLowPrice: 170, targetHighPrice: 290, numberOfAnalystOpinions: 38, recommendationKey: "buy", fyEpsRevision: { pct30: 3.1, pct90: 5 }, shortPercentOfFloat: 1, nextEarningsDate: "2026-11-27", epsForwardEstimates: [{ period: "+1y", value: 8.2 }], revenueForwardEstimates: [{ period: "+1y", value: 330e9 }] } },
    BANKX: { spot: 150, fundamentals: { name: "Bank X (made up)", marketCap: 400e9, sharesOutstanding: 2.66e9, trailingPE: 13, forwardPE: 12, revenue: 150e9, freeCashFlow: -20e9, totalCash: 500e9, totalDebt: 600e9, beta: 1.1, returnOnEquity: 15, revenueGrowthYoy: 5, growthEstimateCurY: 7, payoutRatio: 30, targetMeanPrice: 165, numberOfAnalystOpinions: 20 } },
    BURN: { spot: 20, fundamentals: { name: "Cash Burner (made up)", marketCap: 6e9, sharesOutstanding: 3e8, revenue: 400e6, freeCashFlow: -150e6, totalCash: 900e6, totalDebt: 200e6, beta: 2.1, revenueGrowthYoy: 60, targetMeanPrice: 25, numberOfAnalystOpinions: 6, shortPercentOfFloat: 18 } },
    PEER1: { spot: 100, fundamentals: { name: "Peer one (made up)", marketCap: 500e9, sharesOutstanding: 5e9, trailingPE: 30, forwardPE: 25, revenue: 80e9, freeCashFlow: 20e9, totalCash: 10e9, totalDebt: 10e9 } },
    PEER2: { spot: 50, fundamentals: { name: "Peer two (made up)", marketCap: 300e9, sharesOutstanding: 6e9, trailingPE: 28, forwardPE: 24, revenue: 50e9, freeCashFlow: 10e9 } },
    ETFX: { spot: 400, fundamentals: { name: "Some ETF" } },
  };
  const sectors = { MEGA: "Mega-cap tech", PEER1: "Mega-cap tech", PEER2: "Mega-cap tech", BANKX: "Bank", BURN: "Space", ETFX: "ETF" };
  const bands = { rows: {
    MEGA: { peers: { label: "Mega-cap tech", basis: "sector", n: 6, members: ["PEER1", "PEER2"] }, fpe: { peers: { median: 25 }, own: { pct: 64, days: 180 } }, evs: { peers: { median: 6.5 } }, ps: { peers: { median: 6.2 } } },
    BANKX: { peers: { label: "Bank", basis: "sector", n: 5, members: [] }, fpe: { peers: { median: 11.5 } }, ps: { peers: { median: 2.6 } }, evs: { peers: { median: 9 } } },
    BURN: { peers: { label: "Space", basis: "sector", n: 3, members: [] }, ps: { peers: { median: 12 } }, evs: { peers: { median: 11 } } },
  } };
  const scenarioEngine = { sensitivities: [{ symbol: "MEGA", confidence: "high", vector: { marketBeta: { value: 1.1 }, rate10y: { value: -0.8, source: "return vs 10Y change" }, usd: { value: -0.5 }, commodity: { value: 0.1 } } }] };
  const grades = { MEGA: { total: 5.2, side: "call", macroFit: { points: 0.6 } } };
  const earningsForecast = { companies: [{ symbol: "MEGA", forecast: { target: { end: "2026-12-31" }, outputs: { revenue: 90e9, eps: 2.2 }, baseline: { revenue: 82e9, eps: 1.9 } } }] };
  const macro = { tenY: { value: 4.4 }, twoY: { value: 3.9 }, asOf: "2026-11-17T15:30:00Z" };
  return { chains, sectors, bands, scenarioEngine, grades, earningsForecast, macro };
}

export function valuationPayload() {
  const fx = valuationFixture();
  return buildValuationLab({ chains: fx.chains, symbols: Object.keys(fx.chains), sectors: fx.sectors, industries: {}, bands: fx.bands, scenarioEngine: fx.scenarioEngine, grades: fx.grades, earningsForecast: fx.earningsForecast, growthProfileOf: (s, label) => (label === "Space" ? { key: "earlyStage", label: "Early-stage", rev: { low: null, above: 30, wellAbove: 60 } } : label === "Mega-cap tech" ? { key: "megaCap", label: "Mega-cap platforms", rev: { low: 8, above: 15, wellAbove: 25 } } : null), macro: fx.macro, rfrPct: 4.0, builtAtIso: "2026-11-17T16:00:00.000Z" });
}

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---- Builder ----------------------------------------------------------------
const payload = valuationPayload();
ok(payload.version === 1 && payload.count === 5, "five stocks valued, the ETF left out");
ok(!payload.rows.ETFX, "ETFs are never valued");
const mega = payload.rows.MEGA, bank = payload.rows.BANKX, burn = payload.rows.BURN;
ok(mega.market.tenY === 4.4 && mega.market.rfr === 4, "market rates ride every row");
close(mega.facts.forwardEps, 200 / 27, 1e-3, "forward EPS = price / forward P/E");
close(mega.facts.fwdRevenueGrowth, 10, 0.05, "analysts' next-year revenue growth");
ok(mega.peers.fpe === 25 && mega.peers.evs === 6.5, "peer medians from the bands");
ok(mega.sens.rate10y === -0.8 && mega.sens.usd === -0.5, "measured sensitivities joined");
ok(mega.context.grade.total === 5.2 && mega.context.grade.macroPoints === 0.6, "grade context joined");
ok(mega.context.forecast.epsYoy === 15.8 && mega.context.forecast.revYoy === 9.8, "Earnings Forecast quarter joined as growth vs a year ago");
ok(mega.context.earningsInDays === 10, "days to earnings");
ok(bank.financial && !mega.financial, "banks flagged as financial");
ok(burn.earlyStage, "a company with no earnings is early-stage");
ok(forecastContext({ former: { leftAt: "x" }, forecast: {} }) === null, "former Earnings Forecast companies add nothing");

// ---- Defaults ---------------------------------------------------------------
const dm = L.defaults(mega);
ok(dm.inputs.rf === 4.4 && /10-year/.test(dm.sources.rf), "10-year yield is the default risk-free rate");
ok(dm.inputs.beta === 1.1 && /measured/.test(dm.sources.beta), "measured beta preferred");
ok(dm.inputs.g1 === 10, "growth default = median of revenue growth, analysts' revenue and EPS growth (9, 10, 12)");
close(dm.inputs.fcfMargin, 26.7, 0.05, "FCF margin default");
ok(dm.inputs.exitPE === 25 && /peer/.test(dm.sources.exitPE), "exit P/E defaults to the peer median");
const db = L.defaults(bank);
ok(db.inputs.weights.dcf === 0 && db.inputs.weights.power > 0, "banks: no DCF weight, earnings power on");
const dbn = L.defaults(burn);
ok(dbn.inputs.weights.earnings === 0 && dbn.inputs.weights.dcf > 0, "early-stage: earnings methods off");

// ---- Methods ----------------------------------------------------------------
const rm = L.compute(mega, dm.inputs);
for (const k of L.WEIGHT_KEYS) ok(rm.methods[k].value > 0, `MEGA ${k} has a value`);
close(rm.rates.ke, 4.4 + 1.1 * 5, 1e-9, "cost of equity = rf + beta x ERP");
ok(rm.rates.wacc < rm.rates.ke, "debt lowers the WACC");
const wsum = Object.values(rm.weightShares).reduce((a, b) => a + b, 0);
close(wsum, 1, 1e-9, "weight shares total 100%");
const manual = L.WEIGHT_KEYS.reduce((a, k) => a + rm.methods[k].value * rm.weightShares[k], 0);
close(rm.beforeMacro, manual, 1e-9, "blend = weighted mean of the method values");
close(rm.gapPct, (rm.value / 200 - 1) * 100, 1e-9, "gap vs market");
// Hand check of the earnings path: EPS0 x 1.12^3 x 25 / 1.099^3 + dividends.
{
  const eps0 = mega.facts.forwardEps, ke = (4.4 + 5.5) / 100, g = 0.12;
  let div = 0; for (let t = 1; t <= 3; t++) div += eps0 * Math.pow(1 + g, t - 1) * 0.12 / Math.pow(1 + ke, t);
  close(rm.methods.earnings.value, eps0 * Math.pow(1 + g, 3) * 25 / Math.pow(1 + ke, 3) + div, 1e-6, "earnings path by hand");
}
// Street = analysts' mean.
ok(rm.methods.street.value === 230, "street target");
// Peers: median of the three peer prices.
ok(rm.methods.peers.parts.length === 3, "three peer measures");

// Rates up lowers every discounted method; the street target does not move.
const up = L.compute(mega, { ...dm.inputs, rateShiftBp: 100 });
for (const k of ["dcf", "earnings", "power"]) ok(up.methods[k].value < rm.methods[k].value, `+100bp lowers ${k}`);
ok(up.methods.street.value === rm.methods.street.value && up.methods.peers.value === rm.methods.peers.value, "+100bp leaves peers and street alone");
close(up.measuredRatePct, -8, 1e-9, "measured response: -0.8% per 10bp x 10");
// Faster growth raises DCF; a recession hit lowers every earnings method.
ok(L.compute(mega, { ...dm.inputs, g1: 20 }).methods.dcf.value > rm.methods.dcf.value, "more growth, more DCF value");
const hit = L.compute(mega, { ...dm.inputs, epsShock: -30 });
for (const k of ["dcf", "earnings", "peers", "power"]) ok(hit.methods[k].value < rm.methods[k].value, `-30% earnings lowers ${k}`);
// Weights: all on one method = that method.
const only = L.compute(mega, { ...dm.inputs, weights: { dcf: 0, earnings: 0, peers: 100, power: 0, street: 0 } });
close(only.value, rm.methods.peers.value, 1e-9, "100% peers = peer value");
// Macro dials: a 10% stronger dollar at -0.5 = -5%.
const usd = L.compute(mega, { ...dm.inputs, usdPct: 10 });
close(usd.macroPct, -5, 1e-9, "dollar dial uses the measured response");
close(usd.value, usd.beforeMacro * 0.95, 1e-9, "macro shift applied to the blend");
// Bounds: out-of-range inputs are clamped, never NaN.
const wild = L.compute(mega, { ...dm.inputs, rf: 99, gT: 50, erp: -5, beta: 9 });
ok(wild.inputs.rf === 12 && wild.inputs.gT === 5 && wild.inputs.erp === 1 && wild.inputs.beta === 3, "inputs clamped to their bounds");
// Terminal growth too close to the discount rate is refused, not infinite.
const tight = L.compute(mega, { ...dm.inputs, rf: 0, rateShiftBp: 0, erp: 1, beta: 0.3, gT: 5 });
ok(tight.methods.dcf.value === null && /1 point above/.test(tight.methods.dcf.reason), "DCF refuses r - g < 1 point");
ok(Number.isFinite(tight.value) || tight.value === null, "no infinite blend");

// Bank and cash-burner.
const rb = L.compute(bank, db.inputs);
ok(rb.methods.dcf.value === null && /bank/.test(rb.methods.dcf.reason), "no DCF for a bank");
ok(rb.methods.power.value > 0 && rb.methods.peers.parts.every((p) => p.key !== "evs"), "bank: earnings power, no EV/sales");
const rbn = L.compute(burn, dbn.inputs);
ok(rbn.methods.earnings.value === null && rbn.methods.power.value === null, "cash burner: no earnings methods");
ok(rbn.methods.peers.value > 0, "cash burner: sales multiples still work");

// ---- Implied, drivers, grid, read --------------------------------------------
const a = L.analyze(mega, dm.inputs);
ok(Number.isFinite(a.implied.g1), "price implies a growth rate");
const atImplied = L.compute(mega, { ...dm.inputs, g1: a.implied.g1 }).methods.dcf.value;
close(atImplied, 200, 0.5, "DCF at the implied growth = market price");
const atPe = L.compute(mega, { ...dm.inputs, exitPE: a.implied.exitPE }).methods.earnings.value;
close(atPe, 200, 1e-6, "earnings path at the implied exit P/E = market price");
ok(a.drivers.length >= 4 && a.drivers.every((d, i) => !i || a.drivers[i - 1].swing >= d.swing), "drivers ranked by swing");
ok(a.grid.rows.length === 5 && a.grid.rows.every((r) => r.cells.length === 5), "5 x 5 rate x growth grid");
close(a.grid.rows[2].cells[2], a.result.value, 1e-9, "grid center = the modeled value");
ok(a.grid.rows[2].cells[4] < a.grid.rows[2].cells[0], "higher rates, lower value across the grid");
ok(a.grid.rows[4].cells[2] > a.grid.rows[0].cells[2], "more growth, higher value down the grid");
const e = a.explain;
ok(/Modeled value \$\d/.test(e.headline) && /vs market \$200\.00/.test(e.headline), "headline states both prices");
ok(e.priced.some((x) => /revenue would need to grow/.test(x)), "reverse-DCF line");
ok(e.priced.some((x) => /exit P\/E/.test(x)), "implied exit P/E line");
ok(e.disagree.some((x) => /moves the answer most/.test(x)), "biggest-lever line");
ok(e.market.some((x) => /estimate moved \+3\.1%/.test(x)) && e.market.some((x) => /Site grade \+5\.2/.test(x)), "market-context lines");
ok(e.market.some((x) => /Earnings Forecast/.test(x)), "Earnings Forecast line");
ok(e.us.some((x) => /leaves out/.test(x)), "model limits stated");
const eb = L.analyze(burn, dbn.inputs).explain;
ok(eb.us.some((x) => /Early-stage/.test(x)) && eb.us.some((x) => /negative today/.test(x)), "cash burner caveats");
ok(eb.market.some((x) => /18\.0% of the float/.test(x)), "short interest line");
const JUNK = /undefined|NaN|\[object Object\]|Infinity/;
for (const sym of Object.keys(payload.rows)) {
  const an = L.analyze(payload.rows[sym], L.defaults(payload.rows[sym]).inputs);
  ok(!JUNK.test(JSON.stringify(an.explain)), `${sym}: read has no raw values`);
}
ok(payload.rows.MEGA.base.value === Math.round(rm.value * 100) / 100, "bake base value = browser value at defaults");

// ---- The browser copy is the same code --------------------------------------
{
  const src = valuationLabFactory.toString();
  ok(!src.includes("\\") && !src.includes("`") && !src.includes("${"), "factory is safe to paste into the app.js template");
  const copy = new Function("return (" + src + ")()")();
  close(copy.compute(mega, dm.inputs).value, rm.value, 1e-12, "toString copy computes the same value");
}

// ---- Access, ownership, switch, catalog --------------------------------------
ok(isPremiumKey(VALUATION_LAB_KEY) && JSON.stringify(roleClaimForKey(VALUATION_LAB_KEY)) === JSON.stringify(["tr", "tp"]), "valuation-lab.json is Owner-only");
ok(OPTIONAL_BAKE_KEYS.includes(VALUATION_LAB_KEY), "optional bake key (off leaves the prior file)");
ok(OWNER_PAGE_IDS.includes("valuation-lab"), "Owner page");
ok(SOURCE_KEYS["valuation-lab"] === VALUATION_LAB_KEY, "MCP feature source");
const setting = OWNER_SETTINGS.find((s) => s.key === "VALUATION_LAB");
ok(setting && setting.default === true && setting.scope === "build" && !setting.picks, "Owner Settings switch, not a picks setting");
ok(valuationLabEnabled({}) && valuationLabEnabled({ VALUATION_LAB: "1" }) && !valuationLabEnabled({ VALUATION_LAB: "0" }) && !valuationLabEnabled({ VALUATION_LAB: "off" }), "kill switch");

// ---- MCP value_stock ---------------------------------------------------------
{
  const { TOOLS } = await import("../lib/mcp/tools.mjs");
  const tool = TOOLS.find((t) => t.name === "value_stock");
  ok(tool && tool.audience === "owner", "value_stock is an Owner tool");
  const store = { get: async (k) => (k === VALUATION_LAB_KEY ? Buffer.from(JSON.stringify(payload)) : null) };
  const ctx = (owner) => ({ principal: { owner }, store, now: () => Date.parse("2026-11-17T17:00:00Z") });
  await assert.rejects(() => tool.run(ctx(false), { symbol: "MEGA" }), /Owner/); checks++;
  const out = await tool.run(ctx(true), { symbol: "MEGA", inputs: { rateShiftBp: 100 }, weights: { street: 0 } });
  ok(out.results.symbol === "MEGA" && out.results.inputs.rateShiftBp === 100 && out.results.methods.street.weight_share === 0, "overrides applied");
  close(out.results.modeled_value, Math.round(L.compute(mega, { ...dm.inputs, rateShiftBp: 100, weights: { ...dm.inputs.weights, street: 0 } }).value * 100) / 100, 0.011, "MCP value = page value");
  ok(out.ai_calls === 0 && out.results.read.headline.length > 20, "zero AI calls, read included");
  ok(Array.isArray(out.results.rate_growth_grid.rows) && out.results.top_drivers.length > 0, "grid and drivers");
  await assert.rejects(() => tool.run(ctx(true), { symbol: "ZZZZ" }), /no valuation row|coverage/); checks++;
}

console.log(`valuation-lab smoke: ${checks} checks passed`);

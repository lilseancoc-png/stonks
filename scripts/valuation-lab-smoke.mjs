// Offline checks for the Owner Valuation lab (lib/valuation-lab.mjs,
// 2026-11-17): the five methods on made-up companies, the blend and weights,
// what the price implies, drivers and the rate x growth grid, the bake
// builder, the Owner-only key, the kill switch, the MCP value_stock tool and
// that the browser copy of the factory is the same code. Synthetic data only.
// Round 2 (same day): eight methods, policy and politics dials, about 28
// environments, the range of outcomes and the then-vs-now / analysts story.
// Run: node scripts/valuation-lab-smoke.mjs
import assert from "node:assert/strict";
import { valuationLabFactory, valuationRow, buildValuationLab, forecastContext, valuationLabEnabled, VALUATION_LAB_KEY, usRevenueShare, ttmPair, quarterlyYoy } from "../lib/valuation-lab.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { OWNER_PAGE_IDS } from "../lib/owner-access-policy.mjs";
import { OWNER_SETTINGS } from "../lib/owner-settings.mjs";
import { SOURCE_KEYS } from "../lib/site-catalog/feature-sources.mjs";
import { partyTiltFor, KIND_PARTY_ETF } from "../lib/macro-context.mjs";

const L = valuationLabFactory();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Made-up companies (not real filings).
function quarters(values) {
  // Quarter ends from 2024-12-31, about 91 days apart.
  return values.map((value, i) => ({ date: new Date(Date.parse("2024-12-31") + i * 91.3 * 86400000).toISOString().slice(0, 10), value }));
}

export function valuationFixture() {
  const chains = {
    MEGA: { spot: 200, fundamentals: { name: "Mega Platforms (made up)", marketCap: 2e12, sharesOutstanding: 1e10, trailingPE: 32, forwardPE: 27, revenue: 300e9, freeCashFlow: 80e9, totalCash: 60e9, totalDebt: 90e9, beta: 1.15, returnOnEquity: 45, revenueGrowthYoy: 9, growthEstimateCurY: 12, payoutRatio: 12, dividendYield: 0.5, targetMeanPrice: 230, targetLowPrice: 170, targetHighPrice: 290, numberOfAnalystOpinions: 38, recommendationKey: "buy", fyEpsRevision: { pct30: 3.1, pct90: 5 }, shortPercentOfFloat: 1, nextEarningsDate: "2026-11-27", epsForwardEstimates: [{ date: "2026-12-31", period: "0q", value: 2.0 }, { period: "+1y", value: 8.2 }], revenueForwardEstimates: [{ date: "2026-12-31", period: "0q", value: 86e9 }, { period: "+1y", value: 330e9 }],
      priceToBook: 12, pegRatio: 2.1, profitMargin: 25, revenueEstimateCurY: 305e9, epsRevisions: { y: { up30: 9, down30: 2 }, yPath: { current: 7.4 } },
      capitalAllocation: { buybackTtm: 60e9 },
      revenueHistory: quarters([62, 64, 66, 68, 70, 72, 74, 78].map((x) => x * 1e9)),
      netIncomeHistory: quarters([13, 14, 14, 15, 17, 18, 19, 21].map((x) => x * 1e9)),
      fcfHistory: quarters([15, 16, 17, 17, 18, 19, 20, 23].map((x) => x * 1e9)),
      segments: { geographic: [{ name: "United States", value: 180e9 }, { name: "Europe", value: 70e9 }, { name: "Asia Pacific", value: 50e9 }] } },
      ivRank: { iv: 0.32, pctile: 40, asOf: "2026-11-16" },
      earningsHx: { events: [["2025-10-30", 1.4, 1.35], ["2026-01-29", 1.6, 1.5], ["2026-04-30", 1.65, 1.55], ["2026-07-30", 1.8, 1.7], ["2026-10-29", 1.95, 1.8]].map(([date, a, e]) => ({ date, epsActual: a, epsEstimate: e })), longRun: { n: 30, since: "2019-01-30", up: 19, avgAbsMovePct: 0.061, epsN: 30, beat: 26 } } },
    BANKX: { spot: 150, fundamentals: { name: "Bank X (made up)", priceToBook: 1.4, marketCap: 400e9, sharesOutstanding: 2.66e9, trailingPE: 13, forwardPE: 12, revenue: 150e9, freeCashFlow: -20e9, totalCash: 500e9, totalDebt: 600e9, beta: 1.1, returnOnEquity: 15, revenueGrowthYoy: 5, growthEstimateCurY: 7, payoutRatio: 30, targetMeanPrice: 165, numberOfAnalystOpinions: 20 } },
    BURN: { spot: 20, fundamentals: { name: "Cash Burner (made up)", marketCap: 6e9, sharesOutstanding: 3e8, revenue: 400e6, freeCashFlow: -150e6, totalCash: 900e6, totalDebt: 200e6, beta: 2.1, revenueGrowthYoy: 60, targetMeanPrice: 25, numberOfAnalystOpinions: 6, shortPercentOfFloat: 18 } },
    PEER1: { spot: 100, fundamentals: { name: "Peer one (made up)", pegRatio: 1.8, marketCap: 500e9, sharesOutstanding: 5e9, trailingPE: 30, forwardPE: 25, revenue: 80e9, freeCashFlow: 20e9, totalCash: 10e9, totalDebt: 10e9 } },
    PEER2: { spot: 50, fundamentals: { name: "Peer two (made up)", pegRatio: 2.0, marketCap: 300e9, sharesOutstanding: 6e9, trailingPE: 28, forwardPE: 24, revenue: 50e9, freeCashFlow: 10e9 } },
    PEER3: { spot: 80, fundamentals: { name: "Peer three (made up)", pegRatio: 2.6, revenue: 20e9, sharesOutstanding: 1e9 } },
    ETFX: { spot: 400, fundamentals: { name: "Some ETF" } },
  };
  const sectors = { MEGA: "Mega-cap tech", PEER1: "Mega-cap tech", PEER2: "Mega-cap tech", PEER3: "Mega-cap tech", BANKX: "Bank", BURN: "Space", ETFX: "ETF" };
  const bands = { rows: {
    MEGA: { peers: { label: "Mega-cap tech", basis: "sector", n: 6, members: ["PEER1", "PEER2", "PEER3"] }, fpe: { value: 27, peers: { median: 25 }, own: { median: 24, p25: 22, p75: 27, pct: 92, days: 180 } }, evs: { value: 6.7, peers: { median: 6.5 }, own: { median: 6.0, days: 180 } }, ps: { value: 6.7, peers: { median: 6.2 }, own: { median: 6.1, days: 180 } } },
    BANKX: { peers: { label: "Bank", basis: "sector", n: 5, members: [] }, fpe: { peers: { median: 11.5 } }, ps: { peers: { median: 2.6 } }, evs: { peers: { median: 9 } } },
    BURN: { peers: { label: "Space", basis: "sector", n: 3, members: [] }, ps: { peers: { median: 12 } }, evs: { peers: { median: 11 } } },
  } };
  const scenarioEngine = { sensitivities: [{ symbol: "MEGA", confidence: "high", vector: { marketBeta: { value: 1.1 }, rate10y: { value: -0.8, source: "return vs 10Y change" }, usd: { value: -0.5 }, commodity: { value: 0.1 } } }] };
  const grades = { MEGA: { total: 5.2, side: "call", macroFit: { points: 0.6, kind: "megacapTech" } } };
  const earningsForecast = { companies: [{ symbol: "MEGA", forecast: { target: { end: "2026-12-31" }, outputs: { revenue: 90e9, eps: 2.2 }, baseline: { revenue: 82e9, eps: 1.9 } } }] };
  const macro = { tenY: { value: 4.4 }, twoY: { value: 3.9 }, asOf: "2026-11-17T15:30:00Z", crowdGauges: { kalshiRecessionPct: 22 } };
  // Party tracker row for the sector ETF (made-up figures).
  const partyTracker = { rows: [{ id: "XLK", offices: { president: { D: { excessAnnPct: 3.2 }, R: { excessAnnPct: 1.1 } }, house: { D: { excessAnnPct: 2.0 }, R: { excessAnnPct: 2.4 } }, senate: { D: { excessAnnPct: 2.6 }, R: { excessAnnPct: 1.8 } } } }] };
  return { chains, sectors, bands, scenarioEngine, grades, earningsForecast, macro, partyTracker };
}

export function valuationPayload() {
  const fx = valuationFixture();
  return buildValuationLab({ chains: fx.chains, symbols: Object.keys(fx.chains), sectors: fx.sectors, industries: {}, bands: fx.bands, scenarioEngine: fx.scenarioEngine, grades: fx.grades, earningsForecast: fx.earningsForecast, growthProfileOf: (s, label) => (label === "Space" ? { key: "earlyStage", label: "Early-stage", rev: { low: null, above: 30, wellAbove: 60 } } : label === "Mega-cap tech" ? { key: "megaCap", label: "Mega-cap platforms", rev: { low: 8, above: 15, wellAbove: 25 } } : null), macro: fx.macro, rfrPct: 4.0, partyTracker: fx.partyTracker, partyNow: { president: "R", house: "R", senate: "R" }, partyTilt: partyTiltFor, kindEtf: KIND_PARTY_ETF, builtAtIso: "2026-11-17T16:00:00.000Z" });
}

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---- Builder ----------------------------------------------------------------
const payload = valuationPayload();
ok(payload.version === 2 && payload.count === 6, "six stocks valued, the ETF left out");
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
close(dm.inputs.fcfMargin, 27.2, 0.05, "FCF margin default: reported last four quarters (80 / 294), not Yahoo's summary (80 / 300)");
ok(/reported/.test(dm.sources.fcfMargin), "FCF margin says it is the reported figure");
{
  const noQ = L.defaults({ ...mega, facts: { ...mega.facts, fcfTtm: null, revenueTtm: null } });
  close(noQ.inputs.fcfMargin, 26.7, 0.05, "FCF margin falls back to Yahoo's figure without the quarters");
  ok(/Yahoo/.test(noQ.sources.fcfMargin), "fallback source says Yahoo");
}
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

// ---- Round 2: new methods, dials, environments, range, story ----------------
{
  close(mega.facts.usShare, 0.6, 1e-9, "US share of revenue from the SEC geographic split");
  close(mega.facts.bookPerShare, 200 / 12, 1e-3, "book value per share = price / price-to-book");
  ok(mega.peers.peg === 2.0, "peer median PEG from the peers' Yahoo PEG");
  ok(mega.own.fpe.median === 24 && mega.own.fpe.days === 180, "own-history medians joined");
  ok(usRevenueShare({ geographic: [{ name: "Americas", value: 50 }, { name: "EMEA", value: 30 }, { name: "Latin America", value: 20 }] }) === 0.5, "Americas counts as US-like, Latin America does not");
  ok(usRevenueShare({ geographic: [{ name: "Worldwide", value: 10 }] }) === null && usRevenueShare(null) === null, "no split, no share");
  ok(ttmPair([{ date: "2026-03-31", value: 1 }]).ttm === null, "fewer than four quarters, no trailing year");
  const st = mega.story;
  close(st.rev.ttm, 294e9, 1, "trailing revenue");
  close(st.rev.growthPct, 13.1, 0.05, "revenue growth vs the year before");
  close(st.netMargin.ttm, 25.5, 0.05, "trailing net margin");
  close(st.netMargin.priorTtm, 21.5, 0.05, "net margin a year earlier");
  close(st.fcf.conversion, 80 / 75, 0.01, "free cash flow / net income");
  close(st.eps.ttm, 7.0, 1e-9, "trailing EPS from the last four prints");
  ok(st.eps.priorTtm === null, "no prior EPS year with five prints");
  ok(st.beats.n === 4 && st.beats.beat === 4 && st.beats.avgSurprise > 5, "beat record from actual vs estimate");
  ok(st.beats.longRun.beat === 26 && st.beats.longRun.n === 30, "long-run beat record joined");
  close(st.analysts.epsGrowthNextY, 10.8, 0.05, "analysts' next-year EPS growth vs this year");
  close(st.analysts.revGrowthNextY, 8.2, 0.05, "analysts' next-year revenue growth vs this year");
  ok(st.analysts.up30 === 9 && st.analysts.down30 === 2, "estimate raises and cuts");
  close(st.ourForecast.vsStreetRevPct, 4.7, 0.05, "our Earnings Forecast revenue vs the analysts' same-quarter estimate");
  close(st.ourForecast.vsStreetEpsPct, 10, 0.05, "our Earnings Forecast EPS vs the analysts' estimate");
  close(st.capital.buybackYield, 3, 1e-9, "buyback yield");
  ok(st.options.moveYearPct === 32 && st.reactions.avgAbsMove === 6.1, "options move and earnings-day moves");
  ok(quarterlyYoy(mega.chains?.revenueHistory || []).length === 0, "quarterlyYoy tolerates a missing series");
  ok(st.rev.quarters.length === 4 && st.rev.accel != null, "quarterly growth and its change");
  ok(mega.optionsRange.lo < 200 && mega.optionsRange.hi > 200, "options one-year range around the price");
  ok(mega.party.etf === "XLK" && mega.party.currentTilt === 1.6, "party tilt for the current mix (0.5 president, 0.25 each chamber)");
  ok(!bank.party, "no party row without a macro kind");
  ok(bank.story && bank.story.rev.ttm === null && bank.story.beats.n === 0, "a stock with no history gets an empty story, no crash");
  ok(dm.inputs.recessionOdds === 22 && /Kalshi/.test(dm.sources.recessionOdds), "recession odds default from Kalshi");
  ok(dm.inputs.targetPeg === 2 && /peer/.test(dm.sources.targetPeg), "fair PEG defaults to the peer median");

  // New methods.
  close(rm.methods.history.parts.find((p) => p.key === "fpe").value, 24 * mega.facts.forwardEps, 1e-6, "own-history forward P/E value");
  close(rm.methods.peg.value, mega.facts.forwardEps * 2 * 12, 1e-6, "PEG value = forward EPS x PEG x growth");
  ok(rm.methods.book.value > mega.facts.bookPerShare && rm.methods.book.spreadPct > 0, "book + excess returns above book when ROE beats the cost of equity");
  ok(L.compute(mega, { ...dm.inputs, epsGrowth: 2 }).methods.peg.value === null, "PEG off under 3% growth");
  ok(rb.methods.book.value > 0, "banks get a book value method");
  ok(L.compute(bank, { ...db.inputs, roe: 5 }).methods.book.value < rb.methods.book.value, "lower ROE, lower book value");
  ok(L.compute(burn, dbn.inputs).methods.history.value === null, "no own history, no own-history value");

  // Policy and politics dials.
  const cut = L.compute(mega, { ...dm.inputs, taxChangePp: -6 });
  close(cut.methods.earnings.value / rm.methods.earnings.value, 1 + 0.06 * 0.6 / 0.79, 1e-9, "tax cut on the US share of profit");
  const trade = L.compute(mega, { ...dm.inputs, tradeHitPct: 10 });
  close(trade.methods.earnings.value / rm.methods.earnings.value, 1 - 0.1 * 0.4, 1e-9, "retaliation hits the non-US share of sales");
  const tar = L.compute(mega, { ...dm.inputs, tariffPp: 1 });
  close(tar.methods.earnings.value / rm.methods.earnings.value, 1 - 0.79 / 25, 1e-9, "tariff cost comes off pre-tax margin");
  ok(tar.methods.dcf.value < rm.methods.dcf.value, "tariff cost lowers the cash-flow value");
  const mkt = L.compute(mega, { ...dm.inputs, marketPct: -20 });
  close(mkt.macroPct, -22, 1e-9, "S&P -20% at a measured beta of 1.1");
  close(L.compute(mega, { ...dm.inputs, politicsPct: 2 }).macroPct, 2, 1e-9, "party tilt adds to the macro dials");

  // Environments.
  const sc = L.scenarios(mega), ids = sc.map((x) => x.id);
  for (const id of ["base", "bear", "bull", "rates-up", "rates-down", "recession", "soft", "stagflation", "boom", "deflation", "cuts", "higher", "term", "euphoria", "bearmkt", "credit", "tariffs", "tradedeal", "taxcut", "taxhike", "dsweep", "rsweep", "dsplit", "rsplit", "oilspike", "oilcrash", "strongusd", "weakusd"]) ok(ids.includes(id), `scenario ${id}`);
  ok(!L.scenarios(bank).some((x) => x.id === "dsweep"), "party scenarios need party data");
  const ds = L.applyScenario(mega, dm.inputs, "dsweep");
  ok(ds.politicsPct === 2.8, "Democratic sweep sets the sector's history under D/D/D");
  ok(L.applyScenario(mega, dm.inputs, "recession").epsShock === -30, "recession scenario");
  ok(L.applyScenario(mega, { ...dm.inputs, tariffPp: 3 }, "tradedeal").tariffPp === 0, "trade deal sets tariffs to zero");
  ok(L.applyScenario(mega, dm.inputs, "nope") === null, "unknown scenario");
  for (const x of sc) {
    if (x.id === "base") continue;
    const v = L.compute(mega, L.applyScenario(mega, dm.inputs, x.id)).value;
    ok(Number.isFinite(v) && v > 0, `${x.id}: a finite value`);
    ok(x.note && x.group && !JUNK.test(x.note), `${x.id}: labeled`);
  }
  ok(L.compute(mega, L.applyScenario(mega, dm.inputs, "recession")).value < rm.value && L.compute(mega, L.applyScenario(mega, dm.inputs, "bull")).value > rm.value, "recession below, bull above");

  // Range of outcomes.
  const r1 = L.range(mega, dm.inputs), r2 = L.range(mega, dm.inputs);
  ok(r1.p50 === r2.p50 && r1.aboveShare === r2.aboveShare, "same seed, same range");
  ok(r1.p10 < r1.p50 && r1.p50 < r1.p90 && r1.aboveShare >= 0 && r1.aboveShare <= 1, "ordered range and a share");
  ok(r1.recessionDraws > 35 && r1.recessionDraws < 100, `about 22% of 300 draws take the recession case (${r1.recessionDraws})`);
  ok(L.range(mega, { ...dm.inputs, recessionOdds: 80 }).p50 < r1.p50, "higher recession odds, lower middle");
  ok(mega.base.aboveShare != null && mega.base.p10 < mega.base.p90, "bake keeps the range at defaults");

  // Story.
  const sa = L.analyze(mega, dm.inputs);
  ok(sa.story.views.length === 3 && sa.story.views[0].analysts === st.analysts.revGrowthNextY && sa.story.views[0].ours === st.ourForecast.revYoy, "four views of growth");
  ok(sa.story.analystsMiss.some((x) => /beat the EPS estimate in 4 of the last 4/.test(x)) && sa.story.beat > 5, "beat streak line and the usual surprise");
  ok(sa.story.analystsMiss.some((x) => /Our Earnings Forecast/.test(x) && /GAAP/.test(x)), "our forecast vs the street, with the GAAP caveat");
  ok(sa.story.analystsMiss.some((x) => /Buybacks retire about 3\.0%/.test(x)), "buyback line");
  ok(sa.story.analystsMiss.some((x) => /estimate moved \+3\.1% in 30 days/.test(x)), "revision line");
  ok(sa.story.modelMiss.some((x) => /top of its own range \(92nd/.test(x)), "rich vs own history");
  ok(sa.story.modelMiss.some((x) => /Options price a move of about \+\/-32%/.test(x)), "options line");
  ok(sa.story.modelMiss.some((x) => /Earnings days move it about \+\/-6\.1%/.test(x)), "earnings-day line");
  ok(sa.explain.market.some((x) => /Party mix now/.test(x)), "current party mix line");
  for (const sym of Object.keys(payload.rows)) {
    const an = L.analyze(payload.rows[sym], L.defaults(payload.rows[sym]).inputs);
    ok(!JUNK.test(JSON.stringify(an.story)) && !JUNK.test(JSON.stringify(an.explain)), `${sym}: story has no raw values`);
  }

  // MCP: scenario, range and story.
  const { TOOLS } = await import("../lib/mcp/tools.mjs");
  const tool = TOOLS.find((t) => t.name === "value_stock");
  const store = { get: async (k) => (k === VALUATION_LAB_KEY ? Buffer.from(JSON.stringify(payload)) : null) };
  const ctx = { principal: { owner: true }, store, now: () => Date.parse("2026-11-17T17:00:00Z") };
  const out = await tool.run(ctx, { symbol: "MEGA", scenario: "tariffs" });
  ok(out.results.inputs.tariffPp === 1.5 && out.results.scenario === "tariffs", "MCP applies a scenario");
  ok(out.results.range_of_outcomes.draws > 100 && out.results.story.analysts_may_be_missing.length > 0 && out.results.scenarios.length >= 28, "MCP returns the range, the story and the scenario list");
  ok(Object.keys(out.results.methods).length === 8, "MCP returns all eight methods");
  const bad = await tool.run(ctx, { symbol: "MEGA", scenario: "nope" });
  ok(bad.warnings.some((w) => /Unknown scenario/.test(w)), "MCP warns on an unknown scenario");
  ok(bad.results.scenario === null, "MCP reports no scenario when the one asked for was not applied");
  const odd = await tool.run(ctx, { symbol: "MEGA", inputs: "rf=9", weights: [1, 2] });
  ok(Number.isFinite(odd.results.modeled_value) && odd.results.inputs.rf === dm.inputs.rf, "MCP ignores inputs / weights that are not objects");

  // Audit fixes (2026-11-17).
  // Oil reads through the same 0.35 scaling as the Market Analysis scenario layer.
  close(L.compute(mega, { ...dm.inputs, oilPct: 40 }).macroParts.oil, 0.1 * 40 * 0.35, 1e-9, "oil move uses the scenario layer's 0.35 scaling");
  ok(L.OIL_DAMP === 0.35, "the page reads the same oil scaling");
  // The price-above-target line reads as a plain size, not a signed change.
  const hot = L.analyze({ ...mega, street: { ...mega.street, mean: mega.spot * 0.8 } }, dm.inputs);
  ok(hot.story.analystsMiss.some((x) => /^The price is 25\.0% above the analysts/.test(x)), "price above target reads without a + sign");
  // The party tilt still works when the grade has no macro kind (macro context off).
  const fx2 = valuationFixture();
  const common = { chains: fx2.chains, symbols: Object.keys(fx2.chains), sectors: fx2.sectors, industries: {}, bands: fx2.bands, scenarioEngine: fx2.scenarioEngine, grades: { MEGA: { total: 5.2, side: "call" } }, earningsForecast: fx2.earningsForecast, macro: fx2.macro, rfrPct: 4.0, partyTracker: fx2.partyTracker, partyNow: { president: "R", house: "R", senate: "R" }, partyTilt: partyTiltFor, kindEtf: KIND_PARTY_ETF, builtAtIso: "2026-11-17T16:00:00.000Z" };
  ok(buildValuationLab(common).rows.MEGA.party == null, "no macro kind and no fallback: no party tilt");
  const withKind = buildValuationLab({ ...common, kindOf: (sym) => (sym === "MEGA" ? "megacapTech" : null) });
  ok(withKind.rows.MEGA.party && withKind.rows.MEGA.party.etf === "XLK", "kind fallback keeps the party tilt");
  ok(buildValuationLab({ ...common, kindOf: () => { throw new Error("x"); } }).count === payload.count, "a failing kind fallback skips the tilt, not the stock");
  for (const sym of Object.keys(payload.rows)) {
    const ex = L.analyze(payload.rows[sym], { ...L.defaults(payload.rows[sym]).inputs, tariffPp: 3, taxChangePp: 5 }).explain;
    ok(!/\b1 points\b/.test(JSON.stringify(ex)), `${sym}: drivers text says 1 point`);
  }

  // Fuzz: blank, zero, negative or junk fields must never throw or print raw values.
  let seed = 12345;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const paths = (o, pre = []) => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? [[...pre, k], ...paths(v, [...pre, k])] : [[...pre, k]]));
  const junk = () => [null, undefined, 0, -1, -1e12, NaN, Infinity, "", "abc", [], {}][Math.floor(rnd() * 11)];
  let fuzzed = 0;
  for (let i = 0; i < 400; i++) {
    const src = payload.rows[Object.keys(payload.rows)[i % Object.keys(payload.rows).length]];
    const row = JSON.parse(JSON.stringify(src));
    const all = paths(row);
    for (let j = 0; j < 1 + Math.floor(rnd() * 6); j++) {
      const path = all[Math.floor(rnd() * all.length)];
      let o = row;
      for (let q = 0; q < path.length - 1 && o; q++) o = o[path[q]];
      if (o && typeof o === "object") o[path[path.length - 1]] = junk();
    }
    const def = L.defaults(row);
    const inputs = { ...def.inputs };
    for (const d of L.INPUTS) if (rnd() < 0.2) inputs[d.key] = d.min + rnd() * (d.max - d.min);
    const an = L.analyze(row, inputs);
    const txt = JSON.stringify(an.story) + JSON.stringify(an.explain);
    { const m = txt.match(/[^"]*(undefined|NaN|\[object Object\]|Infinity)[^"]*/); assert.ok(!m, `fuzz ${i}: raw value in text: ${m && m[0]}`); }
    assert.ok(an.result.value === null || Number.isFinite(an.result.value), `fuzz ${i}: value ${an.result.value}`);
    for (const k of L.WEIGHT_KEYS) assert.ok(an.result.methods[k].value === null || Number.isFinite(an.result.methods[k].value), `fuzz ${i}: ${k} ${an.result.methods[k].value}`);
    for (const id of ["bear", "oilspike", "dsweep", "tariffs"]) L.applyScenario(row, def.inputs, id);
    fuzzed++;
  }
  ok(fuzzed === 400, "400 fuzzed rows: no throw, no raw values, values finite or blank");
}

console.log(`valuation-lab smoke: ${checks} checks passed`);

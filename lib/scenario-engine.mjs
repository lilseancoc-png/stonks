// Deterministic scenario + sensitivity layer for Market Analysis.
//
// This is a conditional risk overlay, not a forecasting model. It turns the
// existing calendar, 16-axis regime, rolling macro history, ticker price
// histories, sector/macro profiles, and Event Spillover matrix into:
//   * ranked upcoming catalysts;
//   * estimated 5-10 session regime-transition probabilities;
//   * a rotating five-driver scenario tree with three paths per driver;
//   * per-ticker factor sensitivities and conditional impact ranges;
//   * conservative sizing / timing / vehicle guidance.
//
// The builder is pure so synthetic fixtures can exercise every branch without
// network data or a hydrated private store.

export const SCENARIO_ENGINE_VERSION = 1;

const DAY_MS = 86400000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0));
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const finite = (x) => Number.isFinite(Number(x));
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pctRange = (mid, width) => ({
  low: r1(mid - width),
  high: r1(mid + width),
  mid: r1(mid),
});

const AI_CAPEX_EXPOSURE = {
  NVDA: 1, AVGO: 0.9, AMD: 0.9, MRVL: 0.85, ARM: 0.8, ANET: 0.85,
  VRT: 0.9, CLS: 0.8, DELL: 0.7, SMCI: 0.8, MU: 0.8, DRAM: 0.75,
  LRCX: 0.7, AMAT: 0.7, ASML: 0.7, TSM: 0.75, ORCL: 0.65, CRWV: 0.8,
  MSFT: 0.5, AMZN: 0.55, META: 0.45, GOOGL: 0.45, VST: 0.7, OKLO: 0.7,
  BE: 0.55, CEG: 0.6, SMH: 0.8, QQQ: 0.35,
};

const GEO_EXPOSURE = {
  GD: 0.9, LMT: 0.9, RTX: 0.85, NOC: 0.85,
  XOM: 0.65, CVX: 0.65, OXY: 0.7, USO: 0.9,
  BABA: -0.9, KWEB: -0.9, TSM: -0.8, ASML: -0.65, EWY: -0.55,
  FDX: -0.45, UPS: -0.45, AAPL: -0.35, NVDA: -0.35,
};

const GROWTH_KIND = {
  softwareGrowth: 1, spaceGrowth: 1, highBeta: 1, crypto: 1,
  semiconductors: 0.8, aiInfra: 0.8, megacapTech: 0.55,
  consumerDiscretionary: 0.5, consumerDiscretionaryGoods: 0.5,
  consumerServices: 0.5, mediaEntertainment: 0.45, homebuilder: 0.4,
  enterpriseTech: 0.35, industrials: 0.25, brokers: 0.2,
  assetManagers: 0.2, payments: 0.15, broad: 0,
  banks: -0.05, financials: -0.05, materials: -0.1, energy: -0.15,
  medicalDevices: -0.25, restaurants: -0.3, pharma: -0.55,
  healthcare: -0.55, healthInsurers: -0.65, consumerStaples: -0.7,
  defense: -0.6, utilitiesRate: -0.55, gold: -0.35, bondProxy: -0.5,
  volLong: -0.8,
};

const USD_KIND = {
  semiconductors: -0.65, megacapTech: -0.45, industrials: -0.5,
  materials: -0.65, china: -0.75, gold: -0.8, crypto: -0.35,
  softwareGrowth: -0.15, enterpriseTech: -0.25, energy: -0.2,
  consumerStaples: -0.15, broad: -0.2,
};

const COMMODITY_KIND = {
  energy: 1, materials: 0.5, gold: 0.75, airline: -0.9,
  logistics: -0.7, restaurants: -0.35, consumerDiscretionaryGoods: -0.2,
  industrials: -0.15,
};

const EVENT_ANALOGS = [
  [/fomc|fed/i, "Prior FOMC repricing windows; compare the first rates move with the VIX and breadth confirmation."],
  [/cpi|inflation/i, "Inflation-surprise windows such as 2022; the path depends on whether yields or growth expectations dominate."],
  [/payroll|nonfarm|unemployment|jobs/i, "Labor-growth inflection windows; strong data can be risk-on or rates-negative depending on the inflation backdrop."],
  [/ppi/i, "Producer-price surprise windows; watch whether input costs pass through to yields and margins."],
  [/jolts/i, "Labor-demand cooling/reacceleration windows; confirmation normally comes from 2Y yields and cyclicals."],
  [/earnings/i, "The ticker's own prior earnings windows, with implied-versus-realized move and spillover context where available."],
  [/product|launch|conference|investor day/i, "Prior company product or investor-day windows; positioning and guidance usually matter more than the headline alone."],
  [/default|credit|bank/i, "Credit-stress episodes such as the 2023 regional-bank shock; require spread and funding confirmation."],
  [/war|tariff|sanction|shipping|geopolit/i, "Geopolitical risk-premium episodes; separate the energy/shipping channel from a broad growth scare."],
];

function axisScore(regime, key) {
  const x = regime?.axes?.[key]?.score;
  return finite(x) ? Number(x) : 0;
}

function seriesReturns(data) {
  const t = data?.priceSeries?.t;
  const c = data?.priceSeries?.c;
  if (!Array.isArray(t) || !Array.isArray(c)) return new Map();
  const out = new Map();
  for (let i = 1; i < Math.min(t.length, c.length); i++) {
    const a = Number(c[i - 1]), b = Number(c[i]);
    if (a > 0 && finite(b)) out.set(String(t[i]), ((b / a) - 1) * 100);
  }
  return out;
}

function macroChanges(entries, key, mode = "pct") {
  const out = new Map();
  const rows = Array.isArray(entries) ? entries : [];
  for (let i = 1; i < rows.length; i++) {
    const a = Number(rows[i - 1]?.[key]), b = Number(rows[i]?.[key]);
    if (!finite(a) || !finite(b) || a === 0) continue;
    const value = mode === "bps" ? (b - a) * 100 : ((b / a) - 1) * 100;
    out.set(String(rows[i].date), value);
  }
  return out;
}

function regressionBeta(yMap, xMap, minN = 18) {
  const pairs = [];
  for (const [date, y] of yMap) {
    const x = xMap.get(date);
    if (finite(x) && finite(y)) pairs.push([Number(x), Number(y)]);
  }
  if (pairs.length < minN) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let cov = 0, vx = 0, vy = 0;
  for (const [x, y] of pairs) {
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  if (vx <= 1e-9 || vy <= 1e-9) return null;
  const beta = cov / vx;
  const corr = cov / Math.sqrt(vx * vy);
  return { beta, n: pairs.length, corr: clamp(corr, -1, 1) };
}

function historicalVolPct(data) {
  const rv = Number(data?.technicals?.volRegime?.rv30);
  if (finite(rv) && rv > 0) return rv * 100;
  const vals = [...seriesReturns(data).values()].slice(-40);
  if (vals.length < 10) return 30;
  const m = mean(vals);
  const sd = Math.sqrt(mean(vals.map((x) => (x - m) ** 2)));
  return sd * Math.sqrt(252);
}

function spilloverStrength(symbol, spilloverMatrix) {
  const pairs = Array.isArray(spilloverMatrix?.pairs) ? spilloverMatrix.pairs : [];
  const rows = pairs.filter((p) => p?.follower === symbol && finite(p.bShrunk));
  if (!rows.length) return { value: 0, n: 0, source: "unavailable" };
  return {
    value: r2(clamp(mean(rows.map((p) => Math.abs(Number(p.bShrunk)))), 0, 2)),
    n: rows.length,
    source: "event-spillover",
  };
}

function sensitivityForTicker(symbol, data, context) {
  const kind = context.kindOf ? context.kindOf(symbol, data) : "broad";
  const returns = seriesReturns(data);
  const spyReturns = context.spyReturns;
  const marketFit = regressionBeta(returns, spyReturns);
  const fundamentalBeta = Number(data?.fundamentals?.beta);
  const marketBeta = marketFit
    ? clamp(marketFit.beta, -1, 3.5)
    : finite(fundamentalBeta) ? clamp(fundamentalBeta, -1, 3.5) : 1;

  const tenFit = regressionBeta(returns, context.tenYChanges);
  const twoFit = regressionBeta(returns, context.twoYChanges);
  const dxyFit = regressionBeta(returns, context.dxyChanges);
  const oilFit = regressionBeta(returns, context.usoReturns);

  const profile = context.profiles?.[kind] || context.profiles?.broad || {};
  const profileRateWeight = (profile.axes || [])
    .filter((a) => a.key === "yields" || a.key === "fed")
    .reduce((sum, a) => sum + (a.invert ? 1 : -1) * Number(a.w || 0), 0);
  const priorUsd = USD_KIND[kind] ?? -0.1;
  const priorCommodity = COMMODITY_KIND[kind] ?? 0;
  const rate10y = tenFit ? clamp(tenFit.beta * 10, -4, 4) : clamp(profileRateWeight * 0.9, -3, 3);
  const rate2y = twoFit ? clamp(twoFit.beta * 10, -4, 4) : clamp(profileRateWeight * 0.6, -3, 3);
  const usd = dxyFit ? clamp(0.65 * dxyFit.beta + 0.35 * priorUsd, -3, 3) : priorUsd;
  const commodity = oilFit ? clamp(0.55 * oilFit.beta + 0.45 * priorCommodity, -2, 2) : priorCommodity;
  const aiCapex = AI_CAPEX_EXPOSURE[symbol] ?? (kind === "aiInfra" ? 0.75 : kind === "semiconductors" ? 0.45 : 0);
  const geopolitical = GEO_EXPOSURE[symbol] ?? (kind === "defense" ? 0.8 : kind === "china" ? -0.75 : 0);
  const growthDefensive = GROWTH_KIND[kind] ?? 0;
  const spill = spilloverStrength(symbol, context.spilloverMatrix);

  const samples = [marketFit?.n, tenFit?.n, twoFit?.n, dxyFit?.n].filter(finite);
  const empirical = samples.filter((n) => n >= 18).length;
  const confidence = empirical >= 3 ? "high" : empirical >= 1 ? "medium" : "profile";
  const tags = [];
  if (Math.abs(rate10y) >= 0.8) tags.push(rate10y < 0 ? "rates-sensitive" : "higher-yield beneficiary");
  if (growthDefensive >= 0.6) tags.push("growth");
  if (growthDefensive <= -0.5) tags.push("defensive");
  if (Math.abs(usd) >= 0.5) tags.push("USD-sensitive");
  if (Math.abs(commodity) >= 0.5) tags.push(commodity > 0 ? "commodity beneficiary" : "input-cost exposed");
  if (aiCapex >= 0.45) tags.push("AI/CapEx");
  if (Math.abs(geopolitical) >= 0.45) tags.push(geopolitical > 0 ? "geopolitical beneficiary" : "geopolitical exposed");
  if (spill.value >= 0.35) tags.push("event spillover");

  return {
    symbol,
    name: data?.fundamentals?.name || symbol,
    sector: context.sectors?.[symbol] || data?.fundamentals?.sector || "Other",
    kind,
    confidence,
    annualizedVolPct: r1(historicalVolPct(data)),
    vector: {
      marketBeta: { value: r2(marketBeta), n: marketFit?.n || 0, source: marketFit ? "60-252d regression" : finite(fundamentalBeta) ? "fundamentals" : "fallback" },
      rate10y: { value: r2(rate10y), n: tenFit?.n || 0, source: tenFit ? "return vs 10Y change" : "business profile" },
      rate2y: { value: r2(rate2y), n: twoFit?.n || 0, source: twoFit ? "return vs 2Y change" : "business profile" },
      growthDefensive: { value: r2(growthDefensive), source: "business profile" },
      usd: { value: r2(usd), n: dxyFit?.n || 0, source: dxyFit ? "return vs DXY" : "business profile" },
      commodity: { value: r2(commodity), n: oilFit?.n || 0, source: oilFit ? "return vs oil" : "business profile" },
      aiCapex: { value: r2(aiCapex), source: aiCapex ? "thematic map" : "none" },
      geopolitical: { value: r2(geopolitical), source: geopolitical ? "exposure map" : "none" },
      eventSpillover: spill,
    },
    tags,
  };
}

function impactForPath(sensitivity, path) {
  const v = sensitivity.vector;
  const f = path.shocks || {};
  const market = Number(v.marketBeta.value) * Number(f.spyPct || 0);
  const rates = Number(v.rate10y.value) * (Number(f.tenYBps || 0) / 10)
    + Number(v.rate2y.value) * (Number(f.twoYBps || 0) / 10) * 0.45;
  const usd = Number(v.usd.value) * Number(f.dxyPct || 0);
  const commodity = Number(v.commodity.value) * Number(f.oilPct || 0) * 0.35;
  const growth = Number(v.growthDefensive.value) * Number(f.growthPct || 0);
  const ai = Number(v.aiCapex.value) * Number(f.aiCapexPct || 0) * 0.65;
  const geo = Number(v.geopolitical.value) * Number(f.geoPct || 0);
  const volDrag = Math.max(0, Number(v.marketBeta.value) - 0.8) * -Number(f.vixPoints || 0) * 0.12;
  const mid = market + rates + usd + commodity + growth + ai + geo + volDrag;
  const horizonVol = Number(sensitivity.annualizedVolPct || 30) / Math.sqrt(252) * Math.sqrt(8);
  const width = clamp(horizonVol * 0.55 + Math.abs(mid) * 0.3 + 1.25, 2, 14);
  return {
    ...pctRange(mid, width),
    contributions: {
      market: r1(market), rates: r1(rates), usd: r1(usd),
      commodity: r1(commodity), growth: r1(growth), aiCapex: r1(ai),
      geopolitical: r1(geo), volatility: r1(volDrag),
    },
  };
}

const SCENARIO_CATALOG = [
  {
    key: "orderly-disinflation",
    name: "Orderly disinflation / soft landing",
    driver: "Inflation cools without a material growth break",
    channels: ["rates", "growth", "multiples", "USD", "sentiment"],
    analog: "2019-style policy easing and selected mid-cycle slowdowns; use as a shape reference, not a one-for-one match.",
    score: ({ regime, catalysts }) => 1.5 + 0.45 * axisScore(regime, "inflation") + 0.25 * axisScore(regime, "credit")
      + (catalysts.some((e) => /cpi|ppi|payroll/i.test(e.title)) ? 0.35 : 0),
    paths: [
      { key: "confirm", label: "Clean confirmation", weight: 50, condition: "Inflation prints cool, 2Y/10Y yields ease, credit and breadth remain firm.", reactions: ["Duration/growth multiples expand without a volatility shock.", "Cyclicals participate if earnings revisions hold."], shocks: { spyPct: 4, twoYBps: -20, tenYBps: -15, dxyPct: -1.5, vixPoints: -2, growthPct: 2, aiCapexPct: 1 } },
      { key: "rotation", label: "Good data, mixed tape", weight: 30, condition: "Inflation cools but positioning is crowded or earnings breadth narrows.", reactions: ["Indexes grind higher while leadership rotates away from crowded winners.", "Defensives lag, but single-stock dispersion rises."], shocks: { spyPct: 1.5, twoYBps: -10, tenYBps: -5, dxyPct: -0.5, vixPoints: 0, growthPct: 0.5, aiCapexPct: 0 } },
      { key: "false-dawn", label: "False dawn", weight: 20, condition: "Growth data rolls over faster than inflation, turning easing into recession pricing.", reactions: ["Initial duration rally gives way to earnings downgrades.", "Credit and breadth decide whether the move becomes broad risk-off."], shocks: { spyPct: -6, twoYBps: -30, tenYBps: -25, dxyPct: 1, vixPoints: 6, growthPct: -4, aiCapexPct: -2 } },
    ],
  },
  {
    key: "sticky-inflation",
    name: "Sticky inflation / higher for longer",
    driver: "Inflation or wages re-accelerate and the rate path reprices hawkishly",
    channels: ["2Y/10Y rates", "discount rates", "USD", "margins", "credit"],
    analog: "2022 inflation-fight and 2018 tightening windows; distinguish an orderly multiple reset from a credit cascade.",
    score: ({ regime, catalysts }) => 1.25 - 0.55 * axisScore(regime, "inflation") - 0.35 * axisScore(regime, "yields")
      - 0.2 * axisScore(regime, "fed") + (catalysts.some((e) => /cpi|ppi|fomc/i.test(e.title)) ? 0.4 : 0),
    paths: [
      { key: "orderly-reset", label: "Orderly multiple reset", weight: 45, condition: "Yields rise, but credit stays contained and earnings estimates hold.", reactions: ["Long-duration growth de-rates while banks/value absorb rotation.", "Indexes correct modestly rather than cascade."], shocks: { spyPct: -3, twoYBps: 25, tenYBps: 20, dxyPct: 1.5, vixPoints: 3, growthPct: -2, oilPct: 2 } },
      { key: "cascade", label: "Rates-to-credit cascade", weight: 30, condition: "10Y breaks higher while VIX inverts and credit spreads widen.", reactions: ["Growth-stock drawdowns accelerate beyond the first multiple reset.", "Low-quality balance sheets and funding-dependent themes underperform."], shocks: { spyPct: -9, twoYBps: 40, tenYBps: 35, dxyPct: 2.5, vixPoints: 9, growthPct: -5, oilPct: 3 } },
      { key: "reflation", label: "Reflation without stress", weight: 25, condition: "Nominal growth and pricing power offset the rate shock.", reactions: ["Energy/materials and selected financials lead.", "Mega-cap quality holds better than unprofitable duration."], shocks: { spyPct: 1, twoYBps: 20, tenYBps: 25, dxyPct: 0.5, vixPoints: 0, growthPct: -1, oilPct: 6 } },
    ],
  },
  {
    key: "growth-scare",
    name: "Growth scare / mild recession pricing",
    driver: "Labor, demand, breadth, and credit weaken together",
    channels: ["growth", "credit", "earnings", "rates", "sentiment"],
    analog: "2015-16 growth scares and the 2023 regional-bank stress window; falling yields are not automatically bullish when earnings risk dominates.",
    score: ({ regime }) => 1.1 - 0.45 * axisScore(regime, "credit") - 0.4 * axisScore(regime, "breadth")
      - 0.25 * axisScore(regime, "indexes") - 0.2 * axisScore(regime, "rotation"),
    paths: [
      { key: "mild", label: "Mild slowdown", weight: 45, condition: "Growth cools, yields fall, and credit remains functional.", reactions: ["Quality duration and defensives outperform the index.", "Cyclicals lag without a disorderly liquidation."], shocks: { spyPct: -3, twoYBps: -30, tenYBps: -25, dxyPct: 0.5, vixPoints: 4, growthPct: -3, aiCapexPct: -1 } },
      { key: "earnings-reset", label: "Earnings reset", weight: 35, condition: "Breadth and revisions deteriorate while indexes initially hold.", reactions: ["Index resilience masks a wider single-stock drawdown.", "High operating leverage and discretionary demand take the second-order hit."], shocks: { spyPct: -8, twoYBps: -40, tenYBps: -30, dxyPct: 1.5, vixPoints: 8, growthPct: -6, aiCapexPct: -3 } },
      { key: "policy-cushion", label: "Policy cushion", weight: 20, condition: "The Fed reprices quickly and credit/breadth stabilize.", reactions: ["Duration rebounds before cyclicals.", "The recovery remains narrow until earnings expectations bottom."], shocks: { spyPct: 2, twoYBps: -45, tenYBps: -30, dxyPct: -1, vixPoints: -2, growthPct: -1, aiCapexPct: 1 } },
    ],
  },
  {
    key: "geopolitical-shock",
    name: "Geopolitical / supply-chain risk premium",
    driver: "Energy, shipping, sanctions, or Asia supply chains transmit a shock",
    channels: ["energy", "shipping", "supply chain", "USD", "inflation", "sentiment"],
    analog: "Energy and shipping shock windows; separate a contained sector rotation from an inflation-and-credit feedback loop.",
    score: ({ regime, catalysts }) => 0.85 - 0.5 * axisScore(regime, "geo") - 0.45 * axisScore(regime, "commodity")
      + (catalysts.some((e) => /war|tariff|sanction|shipping/i.test(e.title)) ? 0.6 : 0),
    paths: [
      { key: "contained", label: "Contained premium", weight: 50, condition: "Oil rises but credit, shipping, and VIX term structure stay orderly.", reactions: ["Energy/defense lead while airlines, logistics, and discretionary margins lag.", "The broad index absorbs a sector rotation."], shocks: { spyPct: -2, dxyPct: 1, vixPoints: 3, oilPct: 10, geoPct: 3, growthPct: -1 } },
      { key: "supply-cascade", label: "Supply-chain cascade", weight: 30, condition: "Energy and freight jump together and inflation expectations reprice.", reactions: ["Input-cost pressure becomes a margin and rates shock.", "Semis/hardware add supply-chain downside to the broad risk-off move."], shocks: { spyPct: -8, twoYBps: 15, tenYBps: 20, dxyPct: 2, vixPoints: 9, oilPct: 20, geoPct: 6, growthPct: -4, aiCapexPct: -2 } },
      { key: "de-escalation", label: "Fast de-escalation", weight: 20, condition: "Risk premium fades before real-economy disruption appears.", reactions: ["Oil and defense give back part of the premium.", "High-beta and travel recover as volatility compresses."], shocks: { spyPct: 3, dxyPct: -0.5, vixPoints: -3, oilPct: -8, geoPct: -2, growthPct: 1 } },
    ],
  },
  {
    key: "ai-capex-cycle",
    name: "AI CapEx acceleration / digestion",
    driver: "Hyperscaler spending, RAM/power constraints, and AI monetization diverge",
    channels: ["AI CapEx", "RAM", "power", "supply chain", "multiples", "earnings"],
    analog: "Semiconductor inventory and infrastructure-investment cycles; order visibility and customer concentration determine the second-order path.",
    score: ({ catalysts }) => 1.25 + Math.min(0.9, catalysts.filter((e) => e.symbol && AI_CAPEX_EXPOSURE[e.symbol] >= 0.4).length * 0.18),
    paths: [
      { key: "acceleration", label: "CapEx accelerates", weight: 45, condition: "Hyperscalers raise spend and suppliers confirm backlog/lead-time strength.", reactions: ["Compute, networking, memory, power, and cooling beneficiaries broaden.", "Crowded leaders still need earnings delivery to avoid sell-the-news."], shocks: { spyPct: 2, growthPct: 2, aiCapexPct: 8, dxyPct: -0.5, vixPoints: -1 } },
      { key: "digestion", label: "Orderly digestion", weight: 35, condition: "Spend stays high but growth decelerates toward installed-capacity digestion.", reactions: ["Leadership narrows to companies with backlog and pricing power.", "Second-tier suppliers see multiple compression without a broad tech bust."], shocks: { spyPct: -1, growthPct: -1, aiCapexPct: -4, vixPoints: 2 } },
      { key: "cutback", label: "CapEx cutback", weight: 20, condition: "Monetization disappoints or funding/power constraints force project deferrals.", reactions: ["High-AI-beta suppliers de-rate first and hardest.", "Mega-cap customers may outperform suppliers if lower spend supports cash flow."], shocks: { spyPct: -6, growthPct: -4, aiCapexPct: -12, dxyPct: 1, vixPoints: 7 } },
    ],
  },
  {
    key: "liquidity-meltup",
    name: "Risk-on liquidity wave / melt-up exhaustion",
    driver: "Positioning, vol control, and broad liquidity extend the rally",
    channels: ["liquidity", "positioning", "VIX", "breadth", "multiples"],
    analog: "Late-cycle melt-up and volatility-compression windows; breadth determines continuation versus exhaustion.",
    score: ({ regime }) => 1.0 + 0.35 * axisScore(regime, "indexes") + 0.35 * axisScore(regime, "vix")
      + 0.25 * axisScore(regime, "breadth") + 0.15 * axisScore(regime, "sentiment"),
    paths: [
      { key: "broadening", label: "Healthy broadening", weight: 45, condition: "Breadth and offense/defense confirm while credit stays tight.", reactions: ["High beta participates without relying on one crowded theme.", "Pullbacks remain shallow and volatility is sold."], shocks: { spyPct: 6, growthPct: 3, dxyPct: -1, vixPoints: -3, aiCapexPct: 2 } },
      { key: "narrow", label: "Narrow index melt-up", weight: 35, condition: "Indexes rise while breadth and equal-weight participation stall.", reactions: ["Mega-cap leaders mask deterioration underneath.", "Single-stock downside rises even before the index turns."], shocks: { spyPct: 3, growthPct: 1, vixPoints: -1, aiCapexPct: 2 } },
      { key: "exhaustion", label: "Positioning unwind", weight: 20, condition: "Fear & Greed/put-call extremes meet breadth deterioration or VIX inversion.", reactions: ["Crowded high-beta leaders gap lower as vol-control deleverages.", "Defensives and cash-flow quality hold relative value."], shocks: { spyPct: -9, growthPct: -6, dxyPct: 1.5, vixPoints: 10, aiCapexPct: -4 } },
    ],
  },
];

function eventImportance(ev, chains, todayMs) {
  const title = String(ev?.title || "");
  const type = String(ev?.type || "");
  const subtype = String(ev?.subtype || "");
  let score = 2;
  if (type === "fomc" || /fomc|rate decision/i.test(title)) score = 5;
  else if (/cpi|nonfarm|payroll/i.test(subtype + " " + title)) score = 5;
  else if (/ppi|unemployment|jolts|jobs/i.test(subtype + " " + title)) score = 4;
  else if (type === "earnings") {
    const beta = Number(chains?.[ev.symbol]?.fundamentals?.beta);
    const cap = Number(chains?.[ev.symbol]?.fundamentals?.marketCap);
    score = cap >= 1e12 || AI_CAPEX_EXPOSURE[ev.symbol] >= 0.7 ? 5
      : cap >= 1e11 || beta >= 1.5 ? 4 : 3;
  } else if (type === "catalyst") {
    score = ev.confidence === "high" ? 4 : 3;
  }
  const eventMs = Date.parse(String(ev?.date || "") + "T00:00:00Z");
  const days = finite(eventMs) ? Math.round((eventMs - todayMs) / DAY_MS) : 99;
  if (days >= 0 && days <= 2) score = Math.min(5, score + 1);
  return clamp(score, 1, 5);
}

function eventChannels(ev) {
  const s = `${ev?.type || ""} ${ev?.subtype || ""} ${ev?.title || ""}`.toLowerCase();
  if (/fomc|fed|rate/.test(s)) return ["rates", "USD", "multiples", "credit", "sentiment"];
  if (/cpi|ppi|inflation/.test(s)) return ["rates", "margins", "USD", "multiples"];
  if (/payroll|jobs|unemployment|jolts/.test(s)) return ["growth", "rates", "credit", "consumer"];
  if (/earnings/.test(s)) return ["earnings", "multiples", "sentiment", "event spillover"];
  if (/war|tariff|sanction|shipping/.test(s)) return ["energy", "supply chain", "USD", "sentiment"];
  if (/product|launch|conference|investor/.test(s)) return ["demand", "CapEx", "sentiment", "multiples"];
  return ["growth", "sentiment"];
}

function eventAnalog(ev) {
  const s = `${ev?.type || ""} ${ev?.subtype || ""} ${ev?.title || ""}`;
  return EVENT_ANALOGS.find(([re]) => re.test(s))?.[1] || null;
}

function buildCatalysts(calendar, chains, asOfDate) {
  const todayMs = Date.parse(String(asOfDate || new Date().toISOString()).slice(0, 10) + "T00:00:00Z");
  const rows = [];
  for (const ev of calendar?.events || []) {
    if (!ev?.date) continue;
    const eventMs = Date.parse(ev.date + "T00:00:00Z");
    if (!finite(eventMs) || eventMs < todayMs - DAY_MS || eventMs > todayMs + 30 * DAY_MS) continue;
    const daysOut = Math.max(0, Math.round((eventMs - todayMs) / DAY_MS));
    const importance = eventImportance(ev, chains, todayMs);
    rows.push({
      date: ev.date,
      window: ev.time || ev.session || (daysOut === 0 ? "today" : daysOut === 1 ? "next session" : `${daysOut}d`),
      daysOut,
      importance,
      type: ev.type || "event",
      title: ev.title || "Upcoming event",
      symbol: ev.symbol || null,
      channels: eventChannels(ev),
      analog: eventAnalog(ev),
      source: ev.source || null,
      stale: !!ev.stale,
    });
  }
  rows.sort((a, b) => b.importance - a.importance || a.daysOut - b.daysOut || a.title.localeCompare(b.title));
  const macro = rows.filter((r) => !r.symbol).slice(0, 6);
  const stock = rows.filter((r) => r.symbol).slice(0, 8);
  return [...macro, ...stock]
    .sort((a, b) => a.daysOut - b.daysOut || b.importance - a.importance)
    .slice(0, 12);
}

function buildTransitionLayer(regime, regimeHistory, macroHistory, macroBackdrop, currentDate = null) {
  const axes = regime?.axes || {};
  const hist = Array.isArray(regimeHistory?.days) ? regimeHistory.days : [];
  const priorRows = hist.filter((d) => d?.axisScores && (!currentDate || d.date !== currentDate));
  const prior = priorRows.at(-1) || null;
  const five = priorRows.length >= 5 ? priorRows[priorRows.length - 5] : priorRows[0] || null;
  const velocity = {};
  for (const key of Object.keys(axes)) {
    const now = axisScore(regime, key);
    const d1 = prior?.axisScores && finite(prior.axisScores[key]) ? now - Number(prior.axisScores[key]) : 0;
    const d5 = five?.axisScores && finite(five.axisScores[key]) ? now - Number(five.axisScores[key]) : d1;
    velocity[key] = { score: now, d1: r1(d1), d5: r1(d5), direction: d1 < 0 || d5 < -0.5 ? "deteriorating" : d1 > 0 || d5 > 0.5 ? "improving" : "stable" };
  }

  const flags = [];
  const mh = Array.isArray(macroHistory?.entries) ? macroHistory.entries : [];
  const curveRows = mh.filter((r) => finite(r.twoY) && finite(r.tenY));
  if (curveRows.length >= 2) {
    const now = curveRows.at(-1);
    const old = curveRows[Math.max(0, curveRows.length - 6)];
    const spreadNow = (Number(now.tenY) - Number(now.twoY)) * 100;
    const speed = spreadNow - (Number(old.tenY) - Number(old.twoY)) * 100;
    flags.push({
      key: "curve-speed",
      label: `2s10s ${speed >= 0 ? "steepening" : "flattening"} ${Math.abs(speed).toFixed(0)} bps over ${Math.min(5, curveRows.length - 1)} sessions`,
      state: Math.abs(speed) >= 15 ? "warning" : "stable",
      direction: speed >= 0 ? "steepening" : "flattening",
      value: r1(speed),
    });
  }
  const vixBackward = macroBackdrop?.vixTerm?.state === "backwardation";
  flags.push({
    key: "vix-term",
    label: vixBackward ? "VIX curve is in backwardation" : `VIX curve remains ${macroBackdrop?.vixTerm?.state || "unavailable"}`,
    state: vixBackward ? "warning" : "stable",
    direction: vixBackward ? "deteriorating" : "stable",
    value: finite(macroBackdrop?.vixTerm?.ratio) ? r2(macroBackdrop.vixTerm.ratio) : null,
  });
  const oas5d = Number(macroBackdrop?.credit?.oasChg5d);
  flags.push({
    key: "credit",
    label: finite(oas5d) ? `HY OAS ${oas5d >= 0 ? "widening" : "tightening"} ${Math.abs(oas5d).toFixed(2)} over 5d` : "Credit-spread velocity unavailable",
    state: finite(oas5d) && oas5d >= 0.15 ? "warning" : "stable",
    direction: finite(oas5d) ? (oas5d > 0.03 ? "deteriorating" : oas5d < -0.03 ? "improving" : "stable") : "unknown",
    value: finite(oas5d) ? r2(oas5d) : null,
  });
  const breadthDivergence = axisScore(regime, "indexes") >= 0 && axisScore(regime, "breadth") < 0;
  flags.push({
    key: "breadth-divergence",
    label: breadthDivergence ? "Breadth is deteriorating while indexes hold" : "Breadth and indexes are not bearishly diverging",
    state: breadthDivergence ? "warning" : "stable",
    direction: breadthDivergence ? "deteriorating" : "stable",
    value: axisScore(regime, "breadth") - axisScore(regime, "indexes"),
  });
  const dollarCommodityShock = axisScore(regime, "dxy") < 0 && axisScore(regime, "commodity") < 0;
  flags.push({
    key: "dollar-commodity",
    label: dollarCommodityShock ? "Dollar and commodity shocks are arriving together" : "No joint DXY + commodity shock",
    state: dollarCommodityShock ? "warning" : "stable",
    direction: dollarCommodityShock ? "deteriorating" : "stable",
    value: axisScore(regime, "dxy") + axisScore(regime, "commodity"),
  });
  const positioningExtreme = Math.abs(axisScore(regime, "sentiment")) >= 1 && Math.abs(axisScore(regime, "putCall")) >= 1
    && Math.sign(axisScore(regime, "sentiment")) === Math.sign(axisScore(regime, "putCall"));
  flags.push({
    key: "positioning",
    label: positioningExtreme ? "Fear & Greed and put/call positioning are jointly stretched" : "Positioning is not jointly extreme",
    state: positioningExtreme ? "warning" : "stable",
    direction: positioningExtreme && axisScore(regime, "sentiment") > 0 ? "exhaustion-risk" : positioningExtreme ? "washout-risk" : "stable",
    value: axisScore(regime, "sentiment") + axisScore(regime, "putCall"),
  });

  const deteriorating = Object.values(velocity).filter((v) => v.direction === "deteriorating").length;
  const improving = Object.values(velocity).filter((v) => v.direction === "improving").length;
  const warningCount = flags.filter((f) => f.state === "warning").length;
  const state = regime?.state || "neutral";
  const stateBase = state === "severe-risk-off" ? 82 : state === "risk-off" ? 68 : state === "risk-on" ? 18 : 35;
  const stress = Number(regime?.stress || 0);
  const riskOff = clamp(stateBase + Math.max(0, -stress) * 3 + deteriorating * 2.2 + warningCount * 5 - improving * 1.2, 5, 92);
  const riskOnBase = state === "risk-on" ? 66 : state === "neutral" ? 40 : 18;
  const continuation = clamp(riskOnBase + Math.max(0, stress) * 2.5 + improving * 2 - deteriorating * 1.5 - warningCount * 4, 5, 88);
  const exhaustion = clamp(100 - continuation + (positioningExtreme ? 8 : 0) + (breadthDivergence ? 8 : 0), 8, 88);
  const fragile = warningCount >= 3 || deteriorating >= 5;
  return {
    horizon: "next 5-10 sessions",
    currentRegime: state,
    probabilities: {
      riskOffShiftPct: Math.round(riskOff),
      riskOnContinuationPct: Math.round(continuation),
      riskOnExhaustionPct: Math.round(exhaustion),
      label: "deterministic estimate, not a forecast",
    },
    fragility: {
      state: fragile ? "fragile" : warningCount ? "watch" : "stable",
      label: fragile
        ? `Regime fragile - ${warningCount} of ${flags.length} leading checks warning; ${deteriorating} axes deteriorating`
        : warningCount
          ? `Regime watch - ${warningCount} leading check${warningCount === 1 ? "" : "s"} warning`
          : "Regime stable - no leading-warning cluster",
      warningCount,
      leadingCount: flags.length,
      deterioratingAxes: deteriorating,
      improvingAxes: improving,
    },
    flags,
    axisVelocity: velocity,
  };
}

function normalizeScenarioProbabilities(selected) {
  const exps = selected.map((s) => Math.exp(clamp(s.rawScore, -2, 4)));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  const mids = exps.map((x) => Math.round(x / total * 100));
  const delta = 100 - mids.reduce((a, b) => a + b, 0);
  if (mids.length) mids[0] += delta;
  return selected.map((s, i) => ({
    ...s,
    probability: {
      mid: mids[i],
      low: Math.max(3, mids[i] - 5),
      high: Math.min(65, mids[i] + 5),
      source: "deterministic scenario score",
    },
  }));
}

function scenarioDecision(sensitivity, scenarios, transition) {
  let weighted = 0;
  let worst = 0;
  let widest = 0;
  for (const scenario of scenarios) {
    const impact = sensitivity.scenarios[scenario.key];
    weighted += Number(impact?.mid || 0) * (scenario.probability.mid / 100);
    worst = Math.min(worst, Number(impact?.low || 0));
    widest = Math.max(widest, Number(impact?.high || 0) - Number(impact?.low || 0));
  }
  const fragile = transition.fragility.state === "fragile";
  const adverse = weighted <= -2 || worst <= -10;
  const supportive = weighted >= 2 && !fragile;
  let sizeMultiplier = 1;
  if (fragile) sizeMultiplier *= 0.8;
  if (transition.probabilities.riskOffShiftPct >= 60) sizeMultiplier *= 0.8;
  if (worst <= -12) sizeMultiplier *= 0.8;
  if (widest >= 18) sizeMultiplier *= 0.9;
  sizeMultiplier = r2(clamp(sizeMultiplier, 0.5, 1));
  return {
    bias: supportive ? "supportive" : adverse ? "adverse" : "mixed",
    weightedImpactPct: r1(weighted),
    worstCasePct: r1(worst),
    convictionDelta: supportive ? 1 : adverse ? -1 : 0,
    timing: fragile || adverse ? "wait-for-confirmation" : supportive ? "normal-trigger" : "selective",
    sizeMultiplier,
    vehicle: widest >= 16 || worst <= -12 ? "defined-risk spread" : fragile ? "shares or defined-risk" : "best-fit vehicle",
    note: fragile
      ? "Leading regime checks are deteriorating; require confirmation and cap size."
      : adverse ? "Current scenario mix is an adverse filter for this exposure."
        : supportive ? "Current scenario mix supports the exposure, subject to the ticker's own setup."
          : "Scenario paths disagree; keep the ticker thesis and entry trigger in control.",
  };
}

function aggregateSectors(rows, scenarios) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.sector)) groups.set(row.sector, []);
    groups.get(row.sector).push(row);
  }
  return [...groups.entries()].map(([sector, members]) => {
    const impacts = {};
    for (const scenario of scenarios) {
      const vals = members.map((r) => r.scenarios[scenario.key]).filter(Boolean);
      impacts[scenario.key] = {
        low: r1(mean(vals.map((v) => v.low))),
        mid: r1(mean(vals.map((v) => v.mid))),
        high: r1(mean(vals.map((v) => v.high))),
      };
    }
    return { sector, n: members.length, scenarios: impacts };
  }).sort((a, b) => a.sector.localeCompare(b.sector));
}

export function buildScenarioEngine({
  builtAtIso = new Date().toISOString(),
  asOfDate = String(builtAtIso).slice(0, 10),
  chains = {},
  macroBackdrop = null,
  macroRegime = null,
  regimeHistory = null,
  macroHistory = null,
  calendar = null,
  sectors = {},
  kindOf = null,
  profiles = null,
  spilloverMatrix = null,
} = {}) {
  const regime = macroRegime || macroBackdrop?.macroRegime || { state: "neutral", axes: {}, stress: 0 };
  const catalysts = buildCatalysts(calendar, chains, asOfDate);
  const transition = buildTransitionLayer(regime, regimeHistory, macroHistory, macroBackdrop || {}, asOfDate);
  const scored = SCENARIO_CATALOG.map((scenario) => ({
    ...scenario,
    rawScore: scenario.score({ regime, catalysts, transition }),
  })).sort((a, b) => b.rawScore - a.rawScore).slice(0, 5);
  const scenarios = normalizeScenarioProbabilities(scored).map((scenario) => ({
    key: scenario.key,
    name: scenario.name,
    driver: scenario.driver,
    channels: scenario.channels,
    analog: scenario.analog,
    probability: scenario.probability,
    paths: scenario.paths.map((path) => ({
      ...path,
      probability: {
        mid: path.weight,
        low: Math.max(5, path.weight - 8),
        high: Math.min(75, path.weight + 8),
      },
    })),
  }));

  const macroEntries = macroHistory?.entries || [];
  const context = {
    sectors,
    kindOf,
    profiles,
    spilloverMatrix,
    spyReturns: seriesReturns(chains.SPY),
    usoReturns: seriesReturns(chains.USO),
    tenYChanges: macroChanges(macroEntries, "tenY", "bps"),
    twoYChanges: macroChanges(macroEntries, "twoY", "bps"),
    dxyChanges: macroChanges(macroEntries, "dxy", "pct"),
  };
  const sensitivities = [];
  for (const [symbol, data] of Object.entries(chains)) {
    if (!data?.priceSeries) continue;
    const row = sensitivityForTicker(symbol, data, context);
    row.scenarios = {};
    for (const scenario of scenarios) {
      const paths = scenario.paths.map((path) => ({
        key: path.key,
        weight: path.probability.mid,
        impact: impactForPath(row, path),
      }));
      const mid = paths.reduce((sum, p) => sum + p.impact.mid * p.weight / 100, 0);
      row.scenarios[scenario.key] = {
        low: r1(Math.min(...paths.map((p) => p.impact.low))),
        mid: r1(mid),
        high: r1(Math.max(...paths.map((p) => p.impact.high))),
        bias: mid >= 1 ? "positive" : mid <= -1 ? "negative" : "mixed",
        paths,
      };
    }
    row.decision = scenarioDecision(row, scenarios, transition);
    sensitivities.push(row);
  }
  sensitivities.sort((a, b) => a.symbol.localeCompare(b.symbol));

  for (const scenario of scenarios) {
    const ranked = sensitivities
      .map((row) => ({ symbol: row.symbol, sector: row.sector, impact: row.scenarios[scenario.key]?.mid || 0 }))
      .sort((a, b) => b.impact - a.impact);
    scenario.exposure = {
      positive: ranked.slice(0, 6),
      negative: ranked.slice(-6).reverse(),
    };
  }

  const grossMultiplier = transition.probabilities.riskOffShiftPct >= 65 ? 0.65
    : transition.fragility.state === "fragile" ? 0.75
      : transition.probabilities.riskOffShiftPct >= 50 ? 0.85 : 1;

  return {
    version: SCENARIO_ENGINE_VERSION,
    builtAtIso,
    horizon: "5-10 sessions",
    framing: "Conditional risk and filtering overlay - not a point forecast.",
    catalysts,
    transition,
    scenarios,
    sensitivities,
    sectors: aggregateSectors(sensitivities, scenarios),
    decision: {
      grossMultiplier,
      applyTo: ["sizing", "timing", "vehicle", "conviction context"],
      note: grossMultiplier < 1
        ? `Scenario fragility caps new-position gross sizing at ${Math.round(grossMultiplier * 100)}% of the existing regime/edge budget.`
        : "No additional scenario gross cap; existing regime, edge, and entry gates remain authoritative.",
    },
    methodology: {
      probability: "Rule-based scores from the current 16-axis regime, axis velocity/divergence, and upcoming events; ranges express model uncertainty.",
      sensitivity: "Historical return betas where samples exist, blended with business-profile and thematic exposure maps.",
      impact: "Scenario factor shocks multiplied by ticker sensitivities, widened by realized volatility; ranges are stress estimates, not price targets.",
      limitations: [
        "Regime probabilities are deterministic estimates and are not calibrated forecasts.",
        "Historical analogs are reference patterns, not claims that the current setup is identical.",
        "Portfolio exposure is only available for a user-entered equal-weight basket because the live portfolio stack is not connected to Market Analysis.",
      ],
    },
  };
}

const SCENARIO_HISTORY_VERSION = 1;
const SCENARIO_HISTORY_MAX_DAYS = 180;

// Persist one last-good scenario snapshot per ET date. Later same-day builds
// replace the row instead of manufacturing eight independent daily forecasts;
// future dates append so the UI can audit how the conditional overlay evolved.
export function appendScenarioHistory(prior, engine, builtAtIso = new Date().toISOString(), asOfDate = null) {
  const previous = Array.isArray(prior?.observations)
    ? prior.observations.filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")))
    : [];
  if (!engine?.transition?.probabilities || !engine?.transition?.fragility) {
    return previous.length ? {
      version: SCENARIO_HISTORY_VERSION,
      updatedAtIso: prior?.updatedAtIso || null,
      observations: previous.slice(-SCENARIO_HISTORY_MAX_DAYS),
    } : null;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || ""))
    ? String(asOfDate)
    : String(builtAtIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return previous.length ? prior : null;
  const transition = engine.transition;
  const probs = transition.probabilities;
  const fragility = transition.fragility;
  const warnings = (transition.flags || [])
    .filter((flag) => flag?.state === "warning")
    .map((flag) => flag.key)
    .filter(Boolean);
  const primary = Array.isArray(engine.scenarios) ? engine.scenarios[0] : null;
  const observation = {
    date,
    recordedAtIso: builtAtIso,
    engineVersion: engine.version || 1,
    horizon: engine.horizon || "5-10 sessions",
    currentRegime: transition.currentRegime || null,
    fragilityState: fragility.state || "stable",
    fragilityLabel: fragility.label || null,
    riskOffShiftPct: finite(probs.riskOffShiftPct) ? Math.round(probs.riskOffShiftPct) : null,
    riskOnContinuationPct: finite(probs.riskOnContinuationPct) ? Math.round(probs.riskOnContinuationPct) : null,
    riskOnExhaustionPct: finite(probs.riskOnExhaustionPct) ? Math.round(probs.riskOnExhaustionPct) : null,
    grossMultiplier: finite(engine.decision?.grossMultiplier) ? r2(engine.decision.grossMultiplier) : null,
    warningCount: finite(fragility.warningCount) ? Math.round(fragility.warningCount) : warnings.length,
    leadingCount: finite(fragility.leadingCount) ? Math.round(fragility.leadingCount) : (transition.flags || []).length,
    deterioratingAxes: finite(fragility.deterioratingAxes) ? Math.round(fragility.deterioratingAxes) : null,
    improvingAxes: finite(fragility.improvingAxes) ? Math.round(fragility.improvingAxes) : null,
    warningKeys: warnings,
    primaryScenario: primary ? {
      key: primary.key || null,
      name: primary.name || null,
      low: finite(primary.probability?.low) ? Math.round(primary.probability.low) : null,
      mid: finite(primary.probability?.mid) ? Math.round(primary.probability.mid) : null,
      high: finite(primary.probability?.high) ? Math.round(primary.probability.high) : null,
    } : null,
  };
  const observations = previous.filter((row) => row.date !== date);
  observations.push(observation);
  observations.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    version: SCENARIO_HISTORY_VERSION,
    updatedAtIso: builtAtIso,
    observations: observations.slice(-SCENARIO_HISTORY_MAX_DAYS),
  };
}

export function scenarioOverlayForSymbol(engine, symbol) {
  const row = engine?.sensitivities?.find((x) => x.symbol === symbol);
  return row ? row.decision : null;
}

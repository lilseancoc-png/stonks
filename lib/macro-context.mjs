// Macro, cycle and rotation context for Top Picks.
//
// The market tape (computeMacroRegime) reads what changed TODAY. This layer
// reads WHERE WE ARE in each cycle and what the market is pricing next:
//   rates/Fed path, inflation, growth, credit, the market cycle, liquidity,
//   the dollar, oil, and which party holds the presidency and Congress.
// It then scores every stock against that backdrop with a sector playbook
// (how a card lender, a bank, a chip maker or a staple usually behaves) blended
// with the stock's own measured sensitivities, plus a rotation read (where
// money has been moving) and a systemic sell-off check.
//
// The weights that turn this into points are LEARNED walk-forward from about
// twenty years of sector history (research/macro-backtest), separately for
// each environment, and shipped as a dated table (lib/macro-weights.json).
// Nothing here fetches data or calls an AI; every function is pure.

export const MACRO_CONTEXT_VERSION = "2026-11-macro-context-v1";

export const FACTORS = Object.freeze(["rates", "curve", "inflation", "growth", "credit", "risk", "liquidity", "dollar", "oil"]);

export const FACTOR_LABELS = Object.freeze({
  rates: "Fed path and short rates",
  curve: "Yield-curve slope",
  inflation: "Inflation",
  growth: "Growth and jobs",
  credit: "Credit conditions",
  risk: "Market cycle",
  liquidity: "Liquidity",
  dollar: "Dollar",
  oil: "Oil",
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const num = (x) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Series reader. `series` maps an id to { t: [ISO dates], v: [values] } sorted
// by date. Monthly/quarterly releases carry a publication lag so a backtest at
// date D only sees what was published by D.
// ---------------------------------------------------------------------------
export const RELEASE_LAG_DAYS = Object.freeze({
  CPIAUCSL: 45, CPILFESL: 45, PCEPILFE: 60, UNRATE: 35, PAYEMS: 35, INDPRO: 45, RSAFS: 45, M2SL: 50,
  UMCSENT: 30, SAHMREALTIME: 35, DRTSCILM: 45, DRTSCIS: 45, DRCCLACBS: 75, DRALACBS: 75, REVOLSL: 45, TOTALSL: 45,
  WALCL: 2, WTREGEN: 2, NFCI: 5, ANFCI: 5, STLFSI4: 5, ICSA: 5, CCSA: 12, HOUST: 30, PERMIT: 30,
});

export function makeSeriesReader(series = {}) {
  const cache = new Map();
  const get = (id) => {
    if (cache.has(id)) return cache.get(id);
    const s = series[id];
    const out = s && Array.isArray(s.t) && s.t.length ? s : null;
    cache.set(id, out);
    return out;
  };
  // Index of the last observation visible on `date` (inclusive, after lag).
  const idxAt = (id, date) => {
    const s = get(id);
    if (!s) return -1;
    const lag = RELEASE_LAG_DAYS[id] || 0;
    const cut = lag ? addDays(date, -lag) : date;
    let lo = 0, hi = s.t.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= cut) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  const at = (id, date, maxStaleDays = 40) => {
    const s = get(id); const i = idxAt(id, date);
    if (i < 0) return null;
    const lag = RELEASE_LAG_DAYS[id] || 0;
    if ((Date.parse(date) - Date.parse(s.t[i])) / DAY > maxStaleDays + lag) return null;
    return num(s.v[i]);
  };
  // Value `back` observations before the visible one (trading-day series).
  const back = (id, date, n) => {
    const s = get(id); const i = idxAt(id, date);
    if (i < 0 || i - n < 0) return null;
    return num(s.v[i - n]);
  };
  // Value as of a calendar offset (works for monthly series too).
  const atOffset = (id, date, days, maxStaleDays = 60) => at(id, addDays(date, -days), maxStaleDays);
  const window = (id, date, n) => {
    const s = get(id); const i = idxAt(id, date);
    if (i < 0) return [];
    return s.v.slice(Math.max(0, i - n + 1), i + 1).map(num).filter((x) => x != null);
  };
  const has = (id) => !!get(id);
  return { at, back, atOffset, window, has, idxAt, get };
}

// ---------------------------------------------------------------------------
// Party control (dated segments; same facts as the Party tracker).
// ---------------------------------------------------------------------------
export const PARTY_SEGMENTS = Object.freeze({
  president: [["2001-01-20", "R"], ["2009-01-20", "D"], ["2017-01-20", "R"], ["2021-01-20", "D"], ["2025-01-20", "R"]],
  house: [["1995-01-03", "R"], ["2007-01-03", "D"], ["2011-01-03", "R"], ["2019-01-03", "D"], ["2023-01-03", "R"]],
  senate: [["2001-01-03", "R"], ["2001-06-06", "D"], ["2002-11-12", "R"], ["2007-01-03", "D"], ["2015-01-03", "R"], ["2021-01-20", "D"], ["2025-01-03", "R"]],
});

export function partyOnDate(date, segments = PARTY_SEGMENTS) {
  const pick = (rows) => { let p = null; for (const [d, party] of rows) if (d <= date) p = party; return p; };
  const president = pick(segments.president), house = pick(segments.house), senate = pick(segments.senate);
  const alignment = president && president === house && president === senate ? "unified" : "divided";
  return { president, house, senate, alignment, key: `${president || "?"}${house || "?"}${senate || "?"}` };
}

// ---------------------------------------------------------------------------
// Factor scores. Each is roughly a z-score clamped to ±2; the sign convention
// is "the factor is rising / hot / tight / risk-on". Every part is optional —
// a missing series simply drops out of the average.
// ---------------------------------------------------------------------------
const avg = (parts) => {
  const xs = parts.filter((p) => p && Number.isFinite(p.v));
  if (!xs.length) return null;
  const w = xs.reduce((a, p) => a + (p.w ?? 1), 0);
  return clamp(xs.reduce((a, p) => a + p.v * (p.w ?? 1), 0) / w, -2, 2);
};
const part = (key, v, w = 1, label = null) => (Number.isFinite(v) ? { key, v: clamp(v, -3, 3), w, label } : null);

// Ratio of two price series' change over n sessions (total-return proxy).
function relChange(R, a, b, date, n) {
  const a0 = R.back(a, date, n), a1 = R.back(a, date, 0), b0 = R.back(b, date, n), b1 = R.back(b, date, 0);
  if (![a0, a1, b0, b1].every((x) => x > 0)) return null;
  return (a1 / a0) / (b1 / b0) - 1;
}
function pctChange(R, id, date, n) {
  const x0 = R.back(id, date, n), x1 = R.back(id, date, 0);
  return x0 > 0 && x1 > 0 ? x1 / x0 - 1 : null;
}
function yoy(R, id, date) {
  const now = R.at(id, date, 70), then = R.atOffset(id, date, 365, 70);
  return now > 0 && then > 0 ? (now / then - 1) * 100 : null;
}
function sma(R, id, date, n) {
  const w = R.window(id, date, n);
  return w.length >= Math.min(n, 40) ? w.reduce((a, b) => a + b, 0) / w.length : null;
}

// `live` carries today's site reads when they are fresher than the series:
// { fedExpectedChange12m (pct points), hyOas, hyOasChg20d, breadthPct200, vix, vix3m }.
export function computeFactors(R, date, live = {}) {
  const f = {};
  // Rates / Fed path: what is priced (2Y vs fed funds, or FedWatch live), what
  // the Fed has done (6-month change), and short-rate momentum.
  {
    const dff = R.at("DFF", date, 10), dgs2 = R.at("DGS2", date, 10), dgs3m = R.at("DGS3MO", date, 10);
    const priced = Number.isFinite(live.fedExpectedChange12m) ? live.fedExpectedChange12m
      : dgs2 != null && dff != null ? dgs2 - dff : null;
    const dff6m = dff != null ? (() => { const x = R.back("DFF", date, 182); return x != null ? dff - x : null; })() : null;
    const d2y63 = dgs2 != null ? (() => { const x = R.back("DGS2", date, 63); return x != null ? dgs2 - x : null; })() : null;
    const near = dgs3m != null && dff != null ? dgs3m - dff : null;
    f.rates = {
      score: avg([part("priced", priced / 0.5, 0.35), part("action", dff6m / 0.5, 0.3), part("momentum", d2y63 / 0.4, 0.2), part("near", near / 0.25, 0.15)]),
      detail: { fedFunds: r2(dff), twoYear: r2(dgs2), pricedPct: r2(priced), fedChange6m: r2(dff6m), twoYearChange3m: r2(d2y63), source: Number.isFinite(live.fedExpectedChange12m) ? "FedWatch" : "2Y vs fed funds" },
    };
  }
  // Curve slope: steepening vs flattening/inverting.
  {
    const s = R.at("T10Y2Y", date, 10), s63 = R.back("T10Y2Y", date, 63);
    f.curve = { score: avg([part("change", s != null && s63 != null ? (s - s63) / 0.3 : null, 0.7), part("level", s != null ? (s - 0.5) / 1.0 : null, 0.3)]), detail: { tenMinusTwo: r2(s) } };
  }
  // Inflation: level, direction, and market breakevens.
  {
    const y = yoy(R, "CPIAUCSL", date), y3 = (() => { const a = R.atOffset("CPIAUCSL", date, 92, 70), b = R.atOffset("CPIAUCSL", date, 92 + 365, 70); return a > 0 && b > 0 ? (a / b - 1) * 100 : null; })();
    const core = yoy(R, "CPILFESL", date);
    const be = R.at("T5YIE", date, 10), be63 = R.back("T5YIE", date, 63);
    f.inflation = {
      score: avg([part("level", y != null ? (y - 2.5) / 1.0 : null, 0.3), part("core", core != null ? (core - 2.5) / 1.0 : null, 0.2), part("trend", y != null && y3 != null ? (y - y3) / 0.4 : null, 0.3), part("breakevens", be != null && be63 != null ? (be - be63) / 0.25 : null, 0.2)]),
      detail: { cpiYoy: r1(y), coreYoy: r1(core), cpiYoy3mAgo: r1(y3), breakeven5y: r2(be) },
    };
  }
  // Growth: unemployment vs its 12-month low (Sahm-style), jobless claims,
  // industrial production and real retail sales.
  {
    const u = R.at("UNRATE", date, 70);
    let uMin = null; for (let m = 1; m <= 12; m++) { const x = R.atOffset("UNRATE", date, m * 30.5, 70); if (x != null) uMin = uMin == null ? x : Math.min(uMin, x); }
    const claims = R.window("ICSA", date, 4), claimsYr = R.window("ICSA", date, 52);
    const c4 = claims.length ? claims.reduce((a, b) => a + b, 0) / claims.length : null;
    const cMin = claimsYr.length >= 20 ? Math.min(...claimsYr) : null;
    const ip = yoy(R, "INDPRO", date), rs = yoy(R, "RSAFS", date), cpi = yoy(R, "CPIAUCSL", date);
    f.growth = {
      score: avg([
        part("jobs", u != null && uMin != null ? -(u - uMin - 0.15) / 0.3 : null, 0.35),
        part("claims", c4 != null && cMin != null ? -(c4 / cMin - 1.12) / 0.12 : null, 0.25),
        part("industry", ip != null ? ip / 2.5 : null, 0.2),
        part("spending", rs != null && cpi != null ? (rs - cpi - 1) / 2.5 : null, 0.2),
      ]),
      detail: { unemployment: r1(u), unemployment12mLow: r1(uMin), claims4w: c4 != null ? Math.round(c4) : null, industryYoy: r1(ip), retailYoy: r1(rs) },
    };
  }
  // Credit: junk-bond prices vs Treasuries, financial-conditions indexes,
  // bank lending standards, and the HY spread where we have it.
  {
    const hyRel = relChange(R, "HYG", "IEF", date, 63);
    const nfci = R.at("NFCI", date, 20), nfci13 = R.atOffset("NFCI", date, 91, 20);
    const sloos = R.at("DRTSCILM", date, 120);
    const oas = Number.isFinite(live.hyOas) ? live.hyOas : R.at("BAMLH0A0HYM2", date, 10);
    const oas63 = R.back("BAMLH0A0HYM2", date, 63);
    const oasChg = Number.isFinite(live.hyOasChg60d) ? live.hyOasChg60d : oas != null && oas63 != null ? oas - oas63 : null;
    f.credit = {
      score: avg([
        part("junkVsTreasuries", hyRel != null ? -(hyRel) / 0.025 : null, 0.35),
        part("conditions", nfci != null ? (nfci + 0.35) / 0.25 : null, 0.2),
        part("conditionsTrend", nfci != null && nfci13 != null ? (nfci - nfci13) / 0.12 : null, 0.15),
        part("lendingStandards", sloos != null ? (sloos - 5) / 15 : null, 0.15),
        part("spreadTrend", oasChg != null ? oasChg / 0.6 : null, 0.15),
      ]),
      detail: { junkVsTreasuries3m: r2(hyRel != null ? hyRel * 100 : null), nfci: r2(nfci), banksTighteningPct: r1(sloos), hyOas: r2(oas), hyOasChange3m: r2(oasChg) },
    };
  }
  // Market cycle: trend, drawdown, volatility and its term structure, breadth.
  {
    const spy = R.back("SPY", date, 0), s200 = sma(R, "SPY", date, 200);
    const w252 = R.window("SPY", date, 252); const hi = w252.length ? Math.max(...w252) : null;
    const dd = spy && hi ? spy / hi - 1 : null;
    const m126 = pctChange(R, "SPY", date, 126);
    const vix = Number.isFinite(live.vix) ? live.vix : R.back("^VIX", date, 0);
    const vix3m = Number.isFinite(live.vix3m) ? live.vix3m : R.back("^VIX3M", date, 0);
    const breadth = Number.isFinite(live.breadthPct200) ? live.breadthPct200 : null;
    f.risk = {
      score: avg([
        part("trend", spy && s200 ? (spy / s200 - 1) / 0.05 : null, 0.25),
        part("drawdown", dd != null ? (dd + 0.06) / 0.06 : null, 0.2),
        part("momentum", m126 != null ? (m126 - 0.04) / 0.08 : null, 0.15),
        part("volatility", vix != null ? -(vix - 18) / 6 : null, 0.2),
        part("volCurve", vix != null && vix3m ? -(vix / vix3m - 0.92) / 0.06 : null, 0.1),
        part("breadth", breadth != null ? (breadth - 55) / 18 : null, 0.1),
      ]),
      detail: { spyVs200dPct: r1(spy && s200 ? (spy / s200 - 1) * 100 : null), drawdownPct: r1(dd != null ? dd * 100 : null), vix: r1(vix), vixTermRatio: r2(vix && vix3m ? vix / vix3m : null), breadthPct200: r1(breadth) },
    };
  }
  // Liquidity: Fed balance sheet minus Treasury cash minus reverse repo, and M2.
  {
    const net = (d) => { const w = R.at("WALCL", d, 14), t = R.at("WTREGEN", d, 14), rr = R.at("RRPONTSYD", d, 10) ?? 0; return w != null && t != null ? w / 1000 - t / 1000 - rr : null; };
    const n0 = net(date), n13 = net(addDays(date, -91));
    const m2 = yoy(R, "M2SL", date);
    f.liquidity = { score: avg([part("netFed", n0 != null && n13 != null ? (n0 - n13) / 150 : null, 0.6), part("m2", m2 != null ? (m2 - 5) / 3 : null, 0.4)]), detail: { netLiquidityBn: n0 != null ? Math.round(n0) : null, change13wBn: n0 != null && n13 != null ? Math.round(n0 - n13) : null, m2Yoy: r1(m2) } };
  }
  {
    const d = pctChange(R, "DX-Y.NYB", date, 63) ?? pctChange(R, "UUP", date, 63);
    f.dollar = { score: d != null ? clamp(d / 0.03, -2, 2) : null, detail: { change3mPct: r1(d != null ? d * 100 : null) } };
  }
  {
    const o = pctChange(R, "USO", date, 63);
    f.oil = { score: o != null ? clamp(o / 0.15, -2, 2) : null, detail: { change3mPct: r1(o != null ? o * 100 : null) } };
  }
  for (const k of FACTORS) if (f[k]) f[k].score = r2(f[k].score);
  return f;
}

// ---------------------------------------------------------------------------
// Cycle labels and the environment bucket used for weights and reporting.
// ---------------------------------------------------------------------------
export function classifyCycles(f, R, date, live = {}) {
  const fr = f.rates?.detail || {};
  const priced = fr.pricedPct, act = fr.fedChange6m;
  let policy = "on hold";
  if (act != null && act >= 0.25) policy = priced != null && priced < -0.25 ? "tightening, cuts priced next" : "tightening";
  else if (act != null && act <= -0.25) policy = priced != null && priced > 0.25 ? "easing, hikes priced next" : "easing";
  else if (priced != null && priced >= 0.25) policy = "hikes priced";
  else if (priced != null && priced <= -0.25) policy = "cuts priced";
  const policyBucket = /^tightening|^hikes/.test(policy) ? "tightening" : /^easing|^cuts/.test(policy) ? "easing" : "hold";

  const cs = f.credit?.score;
  const cd = f.credit?.detail || {};
  let credit = "normal";
  if (cs != null) {
    if (cs >= 1.25) credit = "stress";
    else if (cs >= 0.5) credit = "tightening";
    else if (cs <= -0.5) credit = (cd.nfci != null && cd.nfci > -0.2) ? "repair" : "easy";
  }
  const creditBucket = credit === "stress" || credit === "tightening" ? "tight" : credit === "easy" || credit === "repair" ? "easy" : "normal";

  const rd = f.risk?.detail || {};
  const dd = rd.drawdownPct, above = rd.spyVs200dPct;
  let market = "bull";
  if (dd != null && dd <= -20) market = "bear";
  else if (dd != null && dd <= -10) market = above != null && above > 0 ? "recovery" : "correction";
  else if (above != null && above < 0) market = "correction";
  else if (dd != null && dd > -3 && (live.breadthPct200 != null ? live.breadthPct200 < 50 : false)) market = "late bull (narrow)";
  const marketBucket = market === "bear" || market === "correction" ? "down" : "up";

  const inf = f.inflation?.detail?.cpiYoy;
  const inflation = inf == null ? "unknown" : inf >= 3.5 ? "hot" : inf >= 2.5 ? "warm" : "cool";
  const gs = f.growth?.score;
  const growth = gs == null ? "unknown" : gs <= -0.75 ? "slowing" : gs >= 0.5 ? "strong" : "steady";
  const quadrant = growth === "slowing" ? (inflation === "hot" ? "stagflation risk" : "slowdown")
    : inflation === "hot" || inflation === "warm" ? (growth === "strong" ? "overheating" : "reflation") : "goldilocks";
  const ls = f.liquidity?.score;
  const liquidity = ls == null ? "unknown" : ls >= 0.5 ? "expanding" : ls <= -0.5 ? "draining" : "steady";
  const politics = partyOnDate(date);
  return {
    policy, credit, market, inflation, growth, quadrant, liquidity, politics,
    bucket: { policy: policyBucket, credit: creditBucket, market: marketBucket, key: `${policyBucket}|${creditBucket}|${marketBucket}` },
  };
}

// ---------------------------------------------------------------------------
// Sector playbook: how each kind of business usually moves RELATIVE TO THE
// MARKET when a factor is rising (positive = helps). Economic priors; the
// learned weights decide how much each factor counts in each environment.
// ---------------------------------------------------------------------------
export const KIND_EXPOSURES = Object.freeze({
  banks: { rates: 0.2, curve: 0.7, growth: 0.5, credit: -0.8, risk: 0.2, inflation: 0.1 },
  cardLender: { rates: -0.4, curve: 0.2, growth: 0.5, credit: -1.0, risk: 0.3, inflation: -0.2 },
  payments: { rates: -0.1, inflation: 0.3, growth: 0.4, credit: -0.2, dollar: -0.3, risk: 0.1 },
  brokers: { rates: 0.3, risk: 0.7, credit: -0.4, liquidity: 0.3 },
  assetManagers: { risk: 0.8, credit: -0.5, liquidity: 0.3 },
  financials: { rates: 0.1, curve: 0.5, growth: 0.4, credit: -0.7, risk: 0.3 },
  financialsRiskOn: { risk: 0.6, growth: 0.3, credit: -0.4 },
  insurers: { rates: 0.3, risk: -0.3, growth: 0.1, credit: -0.2 },
  healthInsurers: { growth: -0.2, risk: -0.5, inflation: -0.2 },
  healthcare: { growth: -0.3, risk: -0.5, rates: -0.1, dollar: -0.1 },
  biotech: { rates: -0.5, risk: 0.5, liquidity: 0.4, credit: -0.3 },
  pharma: { growth: -0.4, risk: -0.5, rates: -0.1, dollar: -0.2 },
  medicalDevices: { growth: -0.1, risk: -0.2, rates: -0.3 },
  consumerStaples: { growth: -0.4, risk: -0.6, rates: -0.2, inflation: -0.1, credit: 0.2 },
  consumerDiscretionaryGoods: { growth: 0.6, rates: -0.5, credit: -0.5, inflation: -0.3, oil: -0.3, risk: 0.3 },
  restaurants: { growth: 0.3, inflation: -0.4, oil: -0.2, risk: 0.1 },
  consumerServices: { growth: 0.6, oil: -0.3, risk: 0.4, credit: -0.3 },
  mediaEntertainment: { growth: 0.4, risk: 0.3, rates: -0.2 },
  megacapTech: { rates: -0.4, risk: 0.3, liquidity: 0.3, dollar: -0.3, growth: 0.1 },
  softwareGrowth: { rates: -0.8, liquidity: 0.6, risk: 0.6, credit: -0.3 },
  semiconductors: { growth: 0.6, risk: 0.8, dollar: -0.4, rates: -0.3, liquidity: 0.3 },
  enterpriseTech: { growth: 0.3, rates: -0.3, risk: 0.2 },
  aiInfra: { risk: 0.8, rates: -0.6, credit: -0.6, liquidity: 0.4 },
  power: { rates: -0.5, growth: 0.2, risk: 0.2, inflation: 0.1 },
  utilitiesRate: { rates: -0.8, risk: -0.5, growth: -0.3 },
  homebuilder: { rates: -1.0, growth: 0.4, credit: -0.4 },
  reits: { rates: -0.9, credit: -0.5, growth: 0.2, risk: 0.1 },
  energy: { oil: 1.2, inflation: 0.4, dollar: -0.2, growth: 0.2 },
  logistics: { growth: 0.5, oil: -0.5 },
  airline: { growth: 0.5, oil: -0.9, risk: 0.4 },
  industrials: { growth: 0.7, dollar: -0.4, risk: 0.4, rates: -0.1 },
  defense: { risk: -0.2, growth: 0.1 },
  materials: { growth: 0.6, dollar: -0.6, inflation: 0.4, oil: 0.2 },
  gold: { rates: -0.6, dollar: -0.8, risk: -0.3, inflation: 0.3, liquidity: 0.3 },
  bondProxy: { rates: -1.4, growth: -0.6, risk: -0.4, inflation: -0.6, credit: 0.3 },
  volLong: { risk: -1.5, credit: 1.0 },
  china: { dollar: -0.5, risk: 0.4, growth: 0.2 },
  spaceGrowth: { risk: 1.0, liquidity: 0.8, rates: -0.6, credit: -0.6 },
  highBeta: { risk: 1.0, liquidity: 0.8, rates: -0.6, credit: -0.6 },
  crypto: { risk: 1.0, liquidity: 1.0, rates: -0.6, dollar: -0.5 },
  broad: {},
});

// Card issuers carry a loan book: tightening credit and a weaker consumer hit
// them in a way that does not touch the card networks.
export const CARD_LENDER_SYMS = new Set(["AXP", "COF", "SYF", "DFS", "ALLY", "SOFI", "UPST", "AFRM"]);

// Party-tracker sector ETF that stands in for each kind (for the party tilt).
export const KIND_PARTY_ETF = Object.freeze({
  banks: "XLF", cardLender: "XLF", payments: "XLF", brokers: "XLF", assetManagers: "XLF", financials: "XLF", financialsRiskOn: "XLF",
  insurers: "XLF", healthInsurers: "XLV", healthcare: "XLV", biotech: "XLV", pharma: "XLV", medicalDevices: "XLV", reits: "XLRE",
  consumerStaples: "XLP", consumerDiscretionaryGoods: "XLY", restaurants: "XLY", consumerServices: "XLY", airline: "XLY",
  mediaEntertainment: "XLC", megacapTech: "XLK", softwareGrowth: "XLK", semiconductors: "XLK", enterpriseTech: "XLK", aiInfra: "XLK",
  power: "XLU", utilitiesRate: "XLU", homebuilder: "XLY", energy: "XLE", logistics: "XLI", industrials: "XLI", defense: "XLI",
  materials: "XLB", spaceGrowth: "XLI", highBeta: "QQQ", crypto: "QQQ", china: null, gold: null, bondProxy: null, volLong: null, broad: "SPY",
});

// Plain names for the groups in the rotation read.
export const KIND_LABELS = Object.freeze({
  banks: "banks", cardLender: "card lenders", payments: "payment networks", brokers: "brokers", assetManagers: "asset managers",
  financials: "financials", financialsRiskOn: "fintech", insurers: "insurers", healthInsurers: "health insurers", healthcare: "health care",
  biotech: "biotech", pharma: "drug makers", medicalDevices: "medical devices", consumerStaples: "staples",
  consumerDiscretionaryGoods: "consumer goods", restaurants: "restaurants", consumerServices: "travel and services",
  mediaEntertainment: "media", megacapTech: "megacap tech", softwareGrowth: "software", semiconductors: "chips",
  enterpriseTech: "enterprise tech", aiInfra: "AI infrastructure", power: "power and solar", utilitiesRate: "utilities",
  homebuilder: "homebuilders", reits: "real estate", energy: "energy", logistics: "transports", airline: "airlines",
  industrials: "industrials", defense: "defense", materials: "metals and materials", gold: "gold", bondProxy: "long bonds",
  volLong: "volatility", china: "China", spaceGrowth: "space", highBeta: "high-beta growth", crypto: "crypto", broad: "broad market",
});

// Blend the playbook with the stock's own measured sensitivities (when present).
// `measured` holds factor betas already scaled to the playbook's units.
export function exposuresFor(kind, measured = null, blend = 0.5) {
  const prior = KIND_EXPOSURES[kind] || KIND_EXPOSURES.broad;
  const out = {};
  for (const fk of FACTORS) {
    const p = prior[fk] ?? 0;
    const m = measured && Number.isFinite(measured[fk]) ? clamp(measured[fk], -1.5, 1.5) : null;
    out[fk] = m == null ? p : (1 - blend) * p + blend * m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measured sensitivities: rolling regression of a stock's daily return in
// excess of the market on factor returns (2Y change, curve change, junk vs
// Treasuries, dollar, oil). Returned in "relative-vol units per factor-sigma".
// `closes` and factor series are aligned arrays of daily closes / levels.
// ---------------------------------------------------------------------------
export function measuredExposures({ stock, market, factors }, n = 252) {
  const len = Math.min(stock.length, market.length);
  if (len < 120) return null;
  const s = stock.slice(-Math.min(n + 1, len)), m = market.slice(-s.length);
  const rel = [];
  for (let i = 1; i < s.length; i++) rel.push(s[i] / s[i - 1] - 1 - (m[i] / m[i - 1] - 1));
  const sd = (xs) => { const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, xs.length - 1)); };
  const relSd = sd(rel);
  if (!(relSd > 0)) return null;
  const out = {};
  for (const [fk, spec] of Object.entries(factors || {})) {
    const lv = spec.levels.slice(-s.length);
    if (lv.length !== s.length || lv.some((x) => !Number.isFinite(x))) continue;
    const fr = [];
    for (let i = 1; i < lv.length; i++) fr.push(spec.kind === "diff" ? lv[i] - lv[i - 1] : lv[i] / lv[i - 1] - 1);
    const fsd = sd(fr);
    if (!(fsd > 0)) continue;
    const mu1 = rel.reduce((a, b) => a + b, 0) / rel.length, mu2 = fr.reduce((a, b) => a + b, 0) / fr.length;
    let cov = 0; for (let i = 0; i < rel.length; i++) cov += (rel[i] - mu1) * (fr[i] - mu2);
    cov /= Math.max(1, rel.length - 1);
    const corr = cov / (relSd * fsd);
    out[fk] = r2(clamp(corr * 3 * (spec.sign ?? 1), -1.5, 1.5)); // corr 0.33 ~ one playbook unit
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rotation map: where money has moved across groups, relative to the
// equal-weight universe, over one week, one month and one quarter.
// groups: { name: { members: [sym], closesBySym: { sym: [closes...] } } }
// ---------------------------------------------------------------------------
export function buildRotationMap(groups, opts = {}) {
  const rows = [];
  const ret = (c, n) => (c && c.length > n && c[c.length - 1 - n] > 0 ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);
  for (const [name, g] of Object.entries(groups || {})) {
    const per = (n) => { const xs = (g.members || []).map((s) => ret(g.closesBySym?.[s], n)).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    rows.push({ name, n: (g.members || []).length, r5: per(5), r20: per(20), r60: per(60), r120: per(120) });
  }
  const ew = (k) => { const xs = rows.map((r) => r[k]).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
  const base = { r5: ew("r5"), r20: ew("r20"), r60: ew("r60"), r120: ew("r120") };
  for (const r of rows) {
    r.rel5 = r.r5 != null ? r.r5 - base.r5 : null; r.rel20 = r.r20 != null ? r.r20 - base.r20 : null;
    r.rel60 = r.r60 != null ? r.r60 - base.r60 : null; r.rel120 = r.r120 != null ? r.r120 - base.r120 : null;
    // Flow score: the one-to-three month trend counts most; the latest week is
    // read against it (a one-week pop inside a falling quarter is not a rotation).
    r.flow = r.rel60 == null ? null : r2(clamp((0.5 * (r.rel60 ?? 0) + 0.35 * (r.rel20 ?? 0) + 0.15 * (r.rel120 ?? 0)) / 0.06, -2, 2));
  }
  const up = rows.filter((r) => r.r20 != null && r.r20 > 0).length, dn = rows.filter((r) => r.r20 != null && r.r20 < 0).length;
  const sorted = rows.filter((r) => r.flow != null).sort((a, b) => b.flow - a.flow);
  const fmt = (r) => ({ name: r.name, flow: r.flow, rel20Pct: r1(r.rel20 * 100), rel60Pct: r1(r.rel60 * 100), r20Pct: r1(r.r20 * 100) });
  const dispersion = (() => { const xs = rows.map((r) => r.rel20).filter((x) => x != null); if (xs.length < 3) return null; const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length); })();
  return {
    base: { r5Pct: r1(base.r5 * 100), r20Pct: r1(base.r20 * 100), r60Pct: r1(base.r60 * 100) },
    groups: rows.map((r) => ({ name: r.name, n: r.n, flow: r.flow, r5Pct: r1(r.r5 * 100), r20Pct: r1(r.r20 * 100), r60Pct: r1(r.r60 * 100), rel20Pct: r1(r.rel20 * 100), rel60Pct: r1(r.rel60 * 100) })),
    into: sorted.slice(0, 4).filter((r) => r.flow > 0.25).map(fmt),
    outOf: sorted.slice(-4).reverse().filter((r) => r.flow < -0.25).map(fmt),
    upGroups: up, downGroups: dn, dispersionPct: r1(dispersion != null ? dispersion * 100 : null),
    flowByGroup: Object.fromEntries(rows.map((r) => [r.name, r.flow])),
  };
}

// Plain-English read of why money may be moving, built from the clues.
export function rotationHypothesis(map, factors, cycles) {
  if (!map || !map.groups?.length) return null;
  const into = map.into.map((g) => KIND_LABELS[g.name] || g.name), out = map.outOf.map((g) => KIND_LABELS[g.name] || g.name);
  const intoKeys = map.into.map((g) => g.name + " " + (KIND_LABELS[g.name] || "")), outKeys = map.outOf.map((g) => g.name + " " + (KIND_LABELS[g.name] || ""));
  if (!into.length && !out.length) return "No clear rotation: groups are moving together.";
  const clues = [];
  const f = (k) => factors?.[k]?.score;
  if (f("rates") >= 0.5) clues.push("more Fed hikes being priced");
  if (f("rates") <= -0.5) clues.push("rate cuts being priced");
  if (f("credit") >= 0.5) clues.push("credit tightening");
  if (f("inflation") >= 0.75) clues.push("inflation running hot");
  if (f("growth") <= -0.5) clues.push("growth slowing");
  if (f("oil") >= 0.75) clues.push("oil rising");
  if (f("dollar") >= 0.75) clues.push("a stronger dollar");
  if (f("risk") <= -0.5) clues.push("a falling, volatile market");
  const why = clues.length ? ` Clues: ${clues.slice(0, 3).join(", ")}.` : "";
  const defensive = intoKeys.some((n) => /staple|health|pharma|utilit|payment|insur/i.test(n));
  const offense = outKeys.some((n) => /semi|chip|software|aiInfra|tech|growth|space|beta|crypto/i.test(n));
  const theme = defensive && offense ? " That is a defensive rotation: out of long-duration growth into cash-flow businesses." : "";
  return `Money is leaving ${out.join(", ") || "no single group"} and going to ${into.join(", ") || "no single group"}.${theme}${why}${cycles?.market ? ` Market cycle: ${cycles.market}.` : ""}`;
}

// ---------------------------------------------------------------------------
// Systemic check: rotation (some groups up while others fall) vs broad
// de-risking vs systemic stress (everything down together, credit widening,
// volatility inverted). Context only: the 2008-2026 replay found that blocking
// calls in systemic weeks made results worse (those weeks often mark lows).
// ---------------------------------------------------------------------------
export function systemicState({ map, factors, avgCorr = null, avgCorrBase = null, breadthPct200 = null }) {
  const evidence = [];
  const groups = map?.groups?.filter((g) => g.r20Pct != null) || [];
  const shareDown = groups.length ? groups.filter((g) => g.r20Pct < -2).length / groups.length : null;
  if (shareDown != null && shareDown >= 0.8) evidence.push(`${Math.round(shareDown * 100)}% of groups fell over a month`);
  const credit = factors?.credit?.score, risk = factors?.risk?.score;
  const cd = factors?.credit?.detail || {}, rd = factors?.risk?.detail || {};
  const creditBreak = credit != null && credit >= 1.0;
  if (creditBreak) evidence.push(`credit tightening fast (junk vs Treasuries ${cd.junkVsTreasuries3m ?? "?"}% over 3 months)`);
  const volBreak = rd.vix != null && rd.vix >= 28 && rd.vixTermRatio != null && rd.vixTermRatio >= 1.0;
  if (volBreak) evidence.push(`VIX ${rd.vix} with an inverted curve`);
  const corrBreak = avgCorr != null && avgCorrBase != null && avgCorr >= Math.max(0.6, avgCorrBase + 0.2);
  if (corrBreak) evidence.push(`stocks moving together (correlation ${r2(avgCorr)} vs ${r2(avgCorrBase)} normal)`);
  const breadthBreak = breadthPct200 != null && breadthPct200 < 25;
  if (breadthBreak) evidence.push(`only ${Math.round(breadthPct200)}% of stocks above their 200-day`);
  const ddBreak = rd.drawdownPct != null && rd.drawdownPct <= -12;
  const hits = [shareDown != null && shareDown >= 0.8, creditBreak, volBreak, corrBreak, breadthBreak].filter(Boolean).length;
  let state = "normal";
  if (hits >= 3 && (creditBreak || ddBreak)) state = "systemic";
  else if (hits >= 2 || (shareDown != null && shareDown >= 0.8 && risk != null && risk < -0.75)) state = "broad de-risking";
  else if (map && map.into?.length && map.outOf?.length && (map.dispersionPct ?? 0) >= 3) state = "rotation";
  const label = state === "systemic" ? "Systemic stress: everything is falling together, with credit or a deep drawdown confirming."
    : state === "broad de-risking" ? "Broad de-risking: most groups are falling; calls need extra proof."
    : state === "rotation" ? "Rotation: money is moving between groups, not leaving the market."
    : "Normal: no broad stress.";
  return { state, label, evidence, shareDownPct: shareDown != null ? Math.round(shareDown * 100) : null };
}

// ---------------------------------------------------------------------------
// Learned weights (lib/macro-weights.json): one global set, fitted walk-forward
// on 25 sector and industry ETFs, 2008-2026. Thirty features per stock:
//   L_f  exposure x factor level now
//   T_f  exposure x factor change over 13 weeks (65 sessions)
//   S_f  exposure x factor change over 4 weeks (20 sessions)
//   rot  the stock's group money-flow score (rotation map)
//   rot5 the group's one-week move vs the universe, / 3
//   party the group's history under the party mix in power, / 10
// Prediction = sum(gamma * feature) = percent of 10-day return relative to the
// universe. Per-environment weight sets were tested and did not beat one
// global set, so only the global set ships.
// ---------------------------------------------------------------------------
export const MACRO_FEATS = Object.freeze([...FACTORS.map((f) => "L_" + f), ...FACTORS.map((f) => "T_" + f), ...FACTORS.map((f) => "S_" + f), "rot", "rot5", "party"]);

export function macroFeatureVector({ exposures, now, back20, back65, flow = null, rel5Pct = null, partyTilt = null }) {
  const x = {};
  for (const fk of FACTORS) {
    const e = exposures?.[fk] ?? 0, sc = now?.[fk]?.score, a = back65?.[fk]?.score, b = back20?.[fk]?.score;
    x["L_" + fk] = Number.isFinite(sc) ? e * sc : 0;
    x["T_" + fk] = Number.isFinite(sc) && Number.isFinite(a) ? e * (sc - a) : 0;
    x["S_" + fk] = Number.isFinite(sc) && Number.isFinite(b) ? e * (sc - b) : 0;
  }
  x.rot = Number.isFinite(flow) ? flow : 0;
  x.rot5 = Number.isFinite(rel5Pct) ? rel5Pct / 3 : 0;
  x.party = Number.isFinite(partyTilt) ? partyTilt / 10 : 0;
  return x;
}

export function stockMacroFit({ kind, exposures, now, back20, back65, flow = null, rel5Pct = null, partyTilt = null, weights }) {
  if (!weights || !Array.isArray(weights.feats) || !Array.isArray(weights.gamma)) return null;
  const x = macroFeatureVector({ exposures, now, back20, back65, flow, rel5Pct, partyTilt });
  const g = Object.fromEntries(weights.feats.map((f, j) => [f, Number(weights.gamma[j]) || 0]));
  let pred = 0;
  const parts = [];
  for (const fk of FACTORS) {
    const cL = (g["L_" + fk] || 0) * x["L_" + fk], cT = (g["T_" + fk] || 0) * x["T_" + fk], cS = (g["S_" + fk] || 0) * x["S_" + fk];
    const c = cL + cT + cS;
    pred += c;
    if (Math.abs(c) < 0.005) continue;
    const sc = now?.[fk]?.score, a = back65?.[fk]?.score, b = back20?.[fk]?.score;
    parts.push({
      key: fk, label: FACTOR_LABELS[fk], exposure: r2(exposures?.[fk] ?? 0), factor: r2(sc),
      change4w: Number.isFinite(sc) && Number.isFinite(b) ? r2(sc - b) : null,
      change13w: Number.isFinite(sc) && Number.isFinite(a) ? r2(sc - a) : null,
      contributionPct: r2(c), fromLevel: r2(cL), fromChange: r2(cT + cS),
    });
  }
  const cRot = (g.rot || 0) * x.rot + (g.rot5 || 0) * x.rot5;
  pred += cRot;
  if (Math.abs(cRot) >= 0.005) parts.push({ key: "rotation", label: "Rotation", flow: r2(flow), rel5Pct: r2(rel5Pct), contributionPct: r2(cRot) });
  const cParty = (g.party || 0) * x.party;
  pred += cParty;
  if (Math.abs(cParty) >= 0.005) parts.push({ key: "party", label: "Party in power", tiltPctYr: r2(partyTilt), contributionPct: r2(cParty) });
  parts.sort((p, q) => Math.abs(q.contributionPct) - Math.abs(p.contributionPct));
  const scale = Number.isFinite(weights.scale) && weights.scale > 0 ? weights.scale : 0.222;
  const cap = Number.isFinite(weights.cap) ? weights.cap : 1.5;
  return { kind, predRelPct: r2(pred), points: r2(clamp(pred / scale, -cap, cap)), parts };
}

// Sector excess return (pct/yr) under the current party mix, from party-tracker
// rows ({ id, offices: { president: { D: {excessAnnPct}, R: {...} }, house, senate } }).
export function partyTiltFor(etf, politics, partyRows) {
  if (!etf || !politics || !Array.isArray(partyRows)) return null;
  const row = partyRows.find((r) => r.id === etf);
  if (!row?.offices) return null;
  const xs = [];
  for (const [office, w] of [["president", 0.5], ["house", 0.25], ["senate", 0.25]]) {
    const p = politics[office]; const v = num(row.offices?.[office]?.[p]?.excessAnnPct);
    if (v != null) xs.push({ v, w });
  }
  if (!xs.length) return null;
  const tot = xs.reduce((a, x) => a + x.w, 0);
  return r2(xs.reduce((a, x) => a + x.v * x.w, 0) / tot);
}

// ---------------------------------------------------------------------------
// The whole read for one build. Pure: the caller assembles the series.
//   series:   id -> { t: [ISO dates], v: [values] } (FRED rows and daily closes
//             keyed by symbol: SPY, HYG, IEF, USO, DX-Y.NYB, ^VIX, ^VIX3M)
//   calendar: ascending trading dates (SPY sessions), through `date`
//   stocks:   [{ sym, kind, closes: [{ t, c }] }] (no ETFs)
//   weights:  lib/macro-weights.json
// Factor scores leave out breadth on every date so the 4- and 13-week changes
// compare like with like (breadth only feeds the labels and the stress check).
// ---------------------------------------------------------------------------
const MEASURED_FACTORS = Object.freeze([
  ["rates", "DGS2", "diff", 1], ["curve", "T10Y2Y", "diff", 1], ["inflation", "T5YIE", "diff", 1],
  ["credit", "HYG/IEF", "pct", -1], ["risk", "SPY", "pct", 1], ["dollar", "DX-Y.NYB", "pct", 1], ["oil", "USO", "pct", 1],
]);
const MARKET_IDS = new Set(["SPY", "HYG", "IEF", "USO", "DX-Y.NYB", "^VIX", "^VIX3M", "UUP"]);

function closesOn(dates, closes) {
  const m = new Map();
  for (const b of closes || []) { const c = num(b?.c ?? b?.close); const t = b?.t ?? b?.date; if (t && c > 0) m.set(String(t).slice(0, 10), c); }
  return dates.map((d) => m.get(d) ?? null);
}

function avgPairCorr(seriesList) {
  const rets = seriesList.map((c) => { const r = []; for (let k = 1; k < c.length; k++) r.push(c[k] > 0 && c[k - 1] > 0 ? c[k] / c[k - 1] - 1 : null); return r; });
  let cs = 0, cn = 0;
  for (let a = 0; a < rets.length; a++) for (let b = a + 1; b < rets.length; b++) {
    const xs = [], ys = [];
    for (let k = 0; k < rets[a].length; k++) if (rets[a][k] != null && rets[b][k] != null) { xs.push(rets[a][k]); ys.push(rets[b][k]); }
    if (xs.length < 10) continue;
    const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
    let c = 0, vx = 0, vy = 0;
    for (let k = 0; k < xs.length; k++) { c += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; vy += (ys[k] - my) ** 2; }
    if (vx > 0 && vy > 0) { cs += c / Math.sqrt(vx * vy); cn++; }
  }
  return cn ? cs / cn : null;
}

export function buildMacroContext({ series = {}, calendar = [], date = null, stocks = [], weights = null, partyRows = null, breadthPct200 = null, factorLiveAt = null } = {}) {
  const cal = (calendar || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (!date || d <= date));
  const i = cal.length - 1;
  if (i < 70) return null;
  const R = makeSeriesReader(series);
  const day = cal[i];
  const liveAt = (d) => (typeof factorLiveAt === "function" ? factorLiveAt(d) || {} : {});
  const now = computeFactors(R, day, liveAt(day));
  const back20 = computeFactors(R, cal[i - 20], liveAt(cal[i - 20]));
  const back65 = computeFactors(R, cal[i - 65], liveAt(cal[i - 65]));
  const cycles = classifyCycles(now, R, day, { breadthPct200 });

  // Factor levels on the last 253 sessions for the measured sensitivities.
  const win = cal.slice(Math.max(0, i - 252), i + 1);
  const lv = (id) => {
    if (id === "HYG/IEF") { const a = lv("HYG"), b = lv("IEF"); return a.map((x, k) => (x > 0 && b[k] > 0 ? x / b[k] : null)); }
    return win.map((d) => R.at(id, d, MARKET_IDS.has(id) ? 5 : 10));
  };
  const spyWin = lv("SPY");
  const factorLevels = {};
  for (const [fk, id, kind, sign] of MEASURED_FACTORS) {
    const levels = lv(id);
    if (levels.every((x) => Number.isFinite(x))) factorLevels[fk] = { levels, kind, sign };
  }

  // Rotation map over the stocks' own groups.
  const groups = {};
  const closesBy = {};
  for (const st of stocks || []) {
    if (!st?.sym || !st.kind) continue;
    const c = closesOn(cal.slice(Math.max(0, i - 252), i + 1), st.closes);
    closesBy[st.sym] = c;
    const tail = c.slice(-131);
    if (tail.length < 131 || tail.some((x) => !(x > 0))) continue;
    (groups[st.kind] ||= { members: [], closesBySym: {} }).members.push(st.sym);
    groups[st.kind].closesBySym[st.sym] = tail;
  }
  const map = buildRotationMap(groups);
  const rel5 = Object.fromEntries(map.groups.map((g) => [g.name, g.r5Pct != null && map.base.r5Pct != null ? g.r5Pct - map.base.r5Pct : null]));

  // Stress check: groups falling together, credit, volatility, breadth, and how
  // tightly the groups move together vs their own past year.
  const groupSeries = Object.values(groups).map((g) => {
    const len = 253;
    const out = new Array(len).fill(null);
    for (let k = 0; k < len; k++) {
      const xs = g.members.map((sym) => closesBy[sym]?.[closesBy[sym].length - len + k]).filter((x) => x > 0);
      out[k] = xs.length === g.members.length ? xs : null;
    }
    // equal-weight index from member returns
    const idx = [100];
    for (let k = 1; k < len; k++) {
      const a = out[k - 1], b = out[k];
      if (!a || !b) { idx.push(idx[k - 1]); continue; }
      const r = b.reduce((p, x, q) => p + x / a[q] - 1, 0) / b.length;
      idx.push(idx[k - 1] * (1 + r));
    }
    return idx;
  });
  let avgCorr = null, avgCorrBase = null;
  if (groupSeries.length >= 4) {
    avgCorr = avgPairCorr(groupSeries.map((x) => x.slice(-21)));
    const past = [];
    for (let end = groupSeries[0].length - 26; end >= 21; end -= 5) past.push(avgPairCorr(groupSeries.map((x) => x.slice(end - 21, end))));
    const ok = past.filter((x) => x != null).sort((a, b) => a - b);
    avgCorrBase = ok.length >= 20 ? ok[ok.length >> 1] : null;
  }
  const systemic = systemicState({ map, factors: now, avgCorr, avgCorrBase, breadthPct200 });

  const fits = {};
  for (const st of stocks || []) {
    if (!st?.sym || !st.kind) continue;
    const c = closesBy[st.sym];
    let measured = null;
    if (c && c.length === 253 && c.every((x) => x > 0) && spyWin.every((x) => x > 0)) {
      measured = measuredExposures({ stock: c, market: spyWin, factors: factorLevels }, 252);
    }
    const exposures = exposuresFor(st.kind, measured, 0.5);
    const fit = stockMacroFit({
      kind: st.kind, exposures, now, back20, back65,
      flow: map.flowByGroup[st.kind], rel5Pct: rel5[st.kind],
      partyTilt: partyTiltFor(KIND_PARTY_ETF[st.kind], cycles.politics, partyRows),
      weights,
    });
    if (fit) fits[st.sym] = { ...fit, measured: !!measured };
  }
  const scoreOnly = (f) => Object.fromEntries(FACTORS.map((k) => [k, f[k]?.score ?? null]));
  const missing = ["DFF", "DGS2", "DGS3MO", "T10Y2Y", "T5YIE", "CPIAUCSL", "CPILFESL", "UNRATE", "ICSA", "INDPRO", "RSAFS", "NFCI", "DRTSCILM", "BAMLH0A0HYM2", "WALCL", "WTREGEN", "RRPONTSYD", "M2SL", "SPY", "HYG", "IEF", "USO", "DX-Y.NYB", "^VIX", "^VIX3M"].filter((id) => !R.has(id));
  return {
    version: MACRO_CONTEXT_VERSION,
    weightsVersion: weights?.version || null,
    trainedThrough: weights?.trainedThrough || null,
    asOf: day,
    factors: now,
    factorsAgo: { sessions20: scoreOnly(back20), sessions65: scoreOnly(back65) },
    cycles,
    rotation: {
      base: map.base, into: map.into, outOf: map.outOf, dispersionPct: map.dispersionPct,
      groups: map.groups.map((g) => ({ ...g, label: KIND_LABELS[g.name] || g.name })).sort((a, b) => (b.flow ?? -9) - (a.flow ?? -9)),
      hypothesis: rotationHypothesis(map, now, cycles),
    },
    systemic: { ...systemic, avgCorr: r2(avgCorr), avgCorrBase: r2(avgCorrBase) },
    fits,
    missing,
  };
}

// Cycle clock (2026-11-08, brainstorm G4): growth against inflation at the
// last session of each of the past `months` months plus the latest session,
// from the same factor scores the Top Picks grader reads. Growth is the
// growth factor score (jobs, claims, industry, real spending; -2..+2) and
// inflation is CPI year over year, so the quadrant labels match
// classifyCycles (slowing below -0.75, strong above +0.5; warm from 2.5%,
// hot from 3.5%). Pure; a dozen factor reads, no fetch.
export const CYCLE_CLOCK_THRESHOLDS = Object.freeze({ growthSlowing: -0.75, growthStrong: 0.5, cpiWarm: 2.5, cpiHot: 3.5 });
export function buildCycleTrail({ series = {}, calendar = [], months = 12, date = null } = {}) {
  const cal = (calendar || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (!date || d <= date));
  if (cal.length < 70) return null;
  const R = makeSeriesReader(series);
  const lastByMonth = new Map();
  for (const d of cal) lastByMonth.set(d.slice(0, 7), d);
  const keys = [...lastByMonth.keys()].sort().slice(-(Math.max(1, months) + 1));
  const points = [];
  for (const k of keys) {
    const d = lastByMonth.get(k);
    const f = computeFactors(R, d, {});
    const c = classifyCycles(f, R, d, {});
    const growth = f.growth?.score ?? null, cpi = f.inflation?.detail?.cpiYoy ?? null;
    if (growth == null || cpi == null) continue; // a point needs both axes to be placed
    points.push({
      date: d, month: k,
      growth: r2(growth), inflation: r2(f.inflation?.score ?? null), cpiYoy: r1(cpi), coreYoy: r1(f.inflation?.detail?.coreYoy ?? null),
      unemployment: f.growth?.detail?.unemployment ?? null,
      quadrant: c.quadrant, growthLabel: c.growth, inflationLabel: c.inflation,
    });
  }
  if (!points.length) return null;
  const last = points[points.length - 1];
  return { asOf: cal[cal.length - 1], months, thresholds: { ...CYCLE_CLOCK_THRESHOLDS }, points, now: { quadrant: last.quadrant, growth: last.growthLabel, inflation: last.inflationLabel } };
}

// One-line reason for the thesis card and the grader prompt.
export function fitSentence(fit, side) {
  if (!fit) return null;
  const pts = side === "put" ? -fit.points : fit.points;
  const top = fit.parts.slice(0, 3).map((p) => {
    const dir = p.contributionPct >= 0 ? "helps" : "hurts";
    if (p.key === "rotation") return `money flow ${p.flow >= 0 ? "into" : "out of"} its group ${dir}`;
    if (p.key === "party") return `party-in-power history ${dir}`;
    return `${p.label.toLowerCase()} ${dir}`;
  });
  return `Macro and cycle fit ${pts >= 0 ? "+" : ""}${r1(pts)} for a ${side}: ${top.join("; ") || "no strong macro link"}.`;
}

// Compact context lines for the AI grader.
export function contextLines(ctx) {
  if (!ctx) return [];
  const c = ctx.cycles || {}, f = ctx.factors || {};
  const fr = f.rates?.detail || {}, cd = f.credit?.detail || {}, inf = f.inflation?.detail || {}, rd = f.risk?.detail || {};
  const lines = [
    `Cycle read: policy ${c.policy} (fed funds ${fr.fedFunds ?? "?"}%, priced next 12m ${fr.pricedPct != null ? (fr.pricedPct >= 0 ? "+" : "") + fr.pricedPct : "?"} pts via ${fr.source || "?"}); inflation ${c.inflation} (CPI ${inf.cpiYoy ?? "?"}%); growth ${c.growth}; credit ${c.credit}${cd.hyOas != null ? ` (HY spread ${cd.hyOas}%)` : ""}; market ${c.market} (drawdown ${rd.drawdownPct ?? "?"}%); liquidity ${c.liquidity}.`,
    `Politics: president ${c.politics?.president || "?"}, House ${c.politics?.house || "?"}, Senate ${c.politics?.senate || "?"} (${c.politics?.alignment || "?"}).`,
  ];
  if (ctx.rotation?.hypothesis) lines.push(`Rotation: ${ctx.rotation.hypothesis}`);
  if (ctx.systemic) lines.push(`Stress check: ${ctx.systemic.label}${ctx.systemic.evidence?.length ? ` (${ctx.systemic.evidence.join("; ")})` : ""}`);
  return lines;
}

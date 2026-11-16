// Made-up daily closes and earnings for the AI disruption scorecard tests
// (scripts/ai-disruption-scorecard-smoke.mjs, scripts/ai-disruption-browser.mjs).
// Seeded, so every run gets the same numbers. `drop` pushes each targeted
// stock down by that fraction against the benchmark on the day after a launch
// (0 = launches do nothing). Nothing here is real market data.
const DAY = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

export function tradingDays(from, to) {
  const out = [];
  for (let t = Date.parse(from + "T12:00:00Z"); t <= Date.parse(to + "T12:00:00Z"); t += DAY) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// series: { IGV, SPY, <SYM>: { rows: [{ t, c }] } } for every covered target.
export function fixtureSeries(launches, { drop = 0, seed = 7, from = "2021-01-04", to = "2026-11-13" } = {}) {
  const days = tradingDays(from, to);
  const rand = rng(seed);
  const syms = [...new Set(launches.flatMap((l) => (l.targets || []).filter((t) => t.coverage === "covered").map((t) => t.company)))];
  const bench = [];
  let b = 100;
  for (let i = 0; i < days.length; i += 1) { b *= 1 + 0.012 * gauss(rand); bench.push(b); }
  const hits = new Map(syms.map((s) => [s, new Set()]));
  if (drop) {
    for (const l of launches) for (const t of l.targets || []) {
      if (t.coverage !== "covered") continue;
      const i = days.findIndex((d) => d >= l.date);
      if (i >= 0 && i + 1 < days.length) hits.get(t.company).add(i + 1);
    }
  }
  const series = { IGV: { rows: days.map((t, i) => ({ t, c: bench[i] })) }, SPY: { rows: days.map((t, i) => ({ t, c: 400 * bench[i] / 100 })) } };
  for (const s of syms) {
    let c = 100;
    const rows = [];
    for (let i = 0; i < days.length; i += 1) {
      const br = i ? bench[i] / bench[i - 1] - 1 : 0;
      c *= 1 + br + 0.015 * gauss(rand) - (hits.get(s).has(i) ? drop : 0);
      rows.push({ t: days[i], c });
    }
    series[s] = { rows };
  }
  return series;
}

// Quarterly reports for each company with EPS surprise, reaction and revenue.
export function fixtureEarnings(companies, { seed = 11, from = "2021-02-01", to = "2026-11-10" } = {}) {
  const rand = rng(seed);
  const tickers = {};
  for (const sym of companies) {
    const events = [];
    let rev = 1000 + 1000 * rand();
    for (let t = Date.parse(from + "T12:00:00Z") + Math.floor(rand() * 60) * DAY; t <= Date.parse(to + "T12:00:00Z"); t += 91 * DAY) {
      rev *= 1.02 + 0.03 * gauss(rand);
      events.push({ date: new Date(t).toISOString().slice(0, 10), surprisePct: 3 + 5 * gauss(rand), movePct: 0.05 * gauss(rand), revenueActual: Math.round(rev) });
    }
    tickers[sym] = { events };
  }
  return { tickers };
}

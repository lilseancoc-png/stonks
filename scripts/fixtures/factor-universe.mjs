// Made-up universe for the Factor lab's wide history test: companies, filed
// numbers and daily prices in the shape research/factor-universe/collect.mjs
// writes. Nothing here is a real company's number.
//
// `plant` names one company trait that drives returns (default gross profit to
// assets); every other trait is noise, so a test can tell a real factor from a
// lucky one. A few companies carry the data problems the real download has:
//   U003 splits its stock 2 for 1 part-way through,
//   U005 files its weighted share counts in thousands,
//   U006 files one quarter's per-share figures a million times too large,
//   U007 is quoted per depositary share (ten shares each), so today's quote
//        does not match its filed count,
//   U008 spins off a business that the price history books as a 2.37-for-1 split,
//   U011 files one quarter with every dollar figure in thousands.
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const DAY0 = Date.UTC(2000, 0, 1);
export const dayNo = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - DAY0) / 86400000);
const isoOf = (d) => new Date(DAY0 + d * 86400000).toISOString().slice(0, 10);

export const SPIN_RATIO = 2.37;
export function universeFixture({ companies = 160, fromYear = 2010, toYear = 2019, plant = "gpa", strength = 0.006, seed = 11, splitAt = "2015-06-15", spinAt = "2016-03-01" } = {}) {
  const rnd = mulberry(seed);
  // Weekdays only.
  const calendar = [];
  for (let d = dayNo(`${fromYear}-01-01`); d <= dayNo(`${toYear}-12-31`); d++) { const wd = new Date(DAY0 + d * 86400000).getUTCDay(); if (wd !== 0 && wd !== 6) calendar.push(d); }
  const months = [...new Set(calendar.map((d) => Number(isoOf(d).slice(0, 7).replace("-", ""))))];
  const list = [], prices = {}, facts = {};
  const splitDay = dayNo(splitAt), splitIdx = calendar.findIndex((d) => d >= splitDay);
  const spinIdx = calendar.findIndex((d) => d >= dayNo(spinAt));
  for (let k = 0; k < companies; k++) {
    const sym = "U" + String(k).padStart(3, "0");
    const fin = k % 10 === 9;
    const company = { rank: k, sym, cik: String(9000000 + k).padStart(10, "0"), name: "Made-up company " + k, sic: fin ? 6021 : 3570 + (k % 7) };
    list.push(company);
    // Persistent traits, each a standard normal draw.
    const trait = { gpa: gauss(rnd), margin: gauss(rnd), growth: gauss(rnd), lev: gauss(rnd) };
    const drift = 0.0003 + (plant && trait[plant] != null ? (strength / 21) * trait[plant] : 0);
    const splits = k === 3 ? [[splitIdx, 2]] : k === 8 ? [[spinIdx, SPIN_RATIO]] : [];
    // Split-adjusted closes (what Yahoo returns): one continuous series.
    const c = [];
    let px = 20 + 80 * rnd();
    for (let i = 0; i < calendar.length; i++) { px *= 1 + drift + gauss(rnd) * 0.015; c.push(Number(px.toPrecision(6))); }
    const d = [];
    if (k % 3 === 0) for (let i = 40; i < calendar.length; i += 63) d.push([i, Number((c[i] * 0.004).toPrecision(4))]);
    prices[sym] = { s: 0, c, d, sp: splits };
    // Filed numbers: quarters of a calendar fiscal year, filed 35 days after a
    // quarter and 55 days after the year.
    const f = { rev: [], gp: [], op: [], ni: [], cfo: [], capex: [], wsh: [], eps: [], assets: [], eq: [], liab: [], sh: [] };
    let assets = (2 + 8 * rnd()) * 1e9;
    const sharesToday = (0.5 + rnd()) * 1e8;                 // in today's (post-split) terms
    // Today's quote, as the download saves it (one depositary share of U007 is ten shares).
    const perQuote = k === 7 ? 10 : 1;
    company.q = { cap: Math.round(c[c.length - 1] * sharesToday / perQuote), px: c[c.length - 1], so: Math.round(sharesToday / perQuote), cur: "USD" };
    for (let y = fromYear - 1; y <= toYear; y++) {
      const ytd = { rev: 0, gp: 0, op: 0, ni: 0, cfo: 0, capex: 0 };
      for (let q = 1; q <= 4; q++) {
        const start = dayNo(`${y}-01-01`), end = dayNo(new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10));
        const filed = end + (q === 4 ? 55 : 35);
        const slip = k === 11 && y === 2014 && q === 2 ? 1000 : 1;          // one filing in thousands of dollars
        assets *= 1 + 0.01 + 0.01 * trait.growth + gauss(rnd) * 0.005;
        const gp = assets * (0.06 + 0.02 * trait.gpa + gauss(rnd) * 0.003);
        const rev = gp / 0.45, op = rev * (0.15 + 0.03 * trait.margin), ni = op * 0.78, cfo = ni * (1.1 + gauss(rnd) * 0.1), capex = rev * 0.05;
        for (const [key, v] of Object.entries({ rev, gp, op, ni, cfo, capex })) ytd[key] += v;
        const liab = assets * Math.min(0.9, Math.max(0.1, 0.5 + 0.1 * trait.lev));
        f.assets.push([end, filed, Math.round(assets / slip)]); f.liab.push([end, filed, Math.round(liab / slip)]); f.eq.push([end, filed, Math.round((assets - liab) / slip)]);
        // Shares as filed: before the split the company reports half as many.
        const asFiled = (day) => Math.round(k === 3 && day < splitDay ? sharesToday / 2 : sharesToday);
        f.sh.push([end + 20, filed, asFiled(end + 20)]);
        const qStart = dayNo(new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString().slice(0, 10));
        // Per-share profit as filed: on that filing's share count, to the cent.
        const perShare = (profit) => Number((profit / asFiled(filed)).toFixed(2)) * (k === 6 && y === 2014 && q === 3 ? 1e6 : 1);
        for (const key of Object.keys(ytd)) {
          if (fin && (key === "gp")) continue;
          f[key].push([start, end, filed, Math.round(ytd[key] / slip)]);                // year to date (the full year at q4)
          if (q === 2 || q === 3) f[key].push([qStart, end, filed, Math.round((key === "rev" ? rev : key === "gp" ? gp : key === "op" ? op : key === "ni" ? ni : key === "cfo" ? cfo : capex) / slip)]);
        }
        f.eps.push([start, end, filed, perShare(ytd.ni)]);
        if (q === 2 || q === 3) f.eps.push([qStart, end, filed, perShare(ni)]);
        f.wsh.push([q === 4 ? start : qStart, end, filed, Math.round(asFiled(filed) / (k === 5 ? 1000 : 1))]);
      }
    }
    if (fin) delete f.gp;
    facts[sym] = f;
  }
  // The index fund that sets the calendar is not a company.
  prices.SPY = { s: 0, c: calendar.map((_, i) => 100 + i * 0.02), d: [], sp: [] };
  return { universe: { builtAtIso: `${toYear}-12-31T22:00:00.000Z`, day0: "2000-01-01", calendar, months, companies: list }, prices, facts };
}

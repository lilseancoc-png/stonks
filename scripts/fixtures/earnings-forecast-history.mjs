// Synthetic filed history for the Earnings Forecast history test. Made-up
// companies only: nothing here is a real company's number.
import { makeObservation } from '../../lib/earnings-forecast.mjs';

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// mode 'trending': each company's year-over-year growth drifts (a random walk),
// so the newest growth rate is the better guide and "Latest growth" should win.
// mode 'steady': growth is noise around a fixed level, so the middle of the
// last four rates is the better guide and the current rule should stand.
// `shock` adds a move every company shares in a quarter, which the companies
// that file first reveal to the ones that file later.
export function historyUniverse({ companies = 12, fromYear = 2015, toYear = 2026, toQuarter = 2, mode = 'trending', shock = 0.02, seed = 7 } = {}) {
  const rnd = mulberry(seed), quarters = [];
  for (let y = fromYear; y <= toYear; y++) for (let q = 1; q <= 4; q++) { if (y === toYear && q > toQuarter) break; quarters.push([y, q]); }
  const common = quarters.map(() => gauss(rnd) * shock);
  const out = {};
  for (let c = 0; c < companies; c++) {
    const symbol = 'H' + String(c).padStart(2, '0'), observations = [], lag = 18 + ((c * 7) % 30);
    let growth = 0.04 + rnd() * 0.12;
    const level = growth, revenue = [];
    quarters.forEach(([y, q], i) => {
      if (mode === 'trending') growth = Math.max(-0.3, Math.min(0.8, growth + gauss(rnd) * 0.03));
      else growth = level + gauss(rnd) * 0.04;
      const season = 1 + 0.08 * Math.sin((q / 4) * 2 * Math.PI + c);
      const rev = i < 4 ? (500 + 200 * c) * season * 1e6 : revenue[i - 4] * (1 + growth + common[i] + gauss(rnd) * 0.004);
      revenue.push(rev);
      const start = new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString().slice(0, 10), end = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
      const filed = day(Date.parse(end) + lag * 86400000), availableAt = day(Date.parse(filed) + 86400000) + 'T12:00:00.000Z', firstSeenAt = availableAt;
      const margin = 0.22 + 0.02 * gauss(rnd), operatingIncome = rev * margin, pretaxIncome = operatingIncome + 2e6, taxes = pretaxIncome * 0.2, netIncome = pretaxIncome - taxes, dilutedShares = 1e8, eps = netIncome / dilutedShares;
      for (const [metric, value] of Object.entries({ revenue: rev, grossProfit: rev * 0.5, operatingIncome, pretaxIncome, taxes, netIncome, dilutedShares, eps })) {
        observations.push(makeObservation({ issuerId: String(1000 + c).padStart(10, '0'), symbol, metric, start, end, value, currency: metric === 'dilutedShares' ? null : 'USD', unit: metric === 'dilutedShares' ? 'shares' : metric === 'eps' ? 'USD/shares' : 'USD', basis: 'US GAAP', tag: metric, priority: 0, accession: symbol + '-' + y + '-' + q, filed, form: '10-Q', availableAt, firstSeenAt, rawHash: 'fixture', sourceUrl: 'https://www.sec.gov/example/fixture' }));
      }
    });
    out[symbol] = observations;
  }
  return out;
}

// Monthly factory output and a daily-ish dollar index, both made up.
export function historyFred({ fromYear = 2012, toYear = 2026, seed = 3 } = {}) {
  const rnd = mulberry(seed), ip = [], usd = [];
  let a = 100, b = 100;
  for (let y = fromYear; y <= toYear; y++) for (let m = 0; m < 12; m++) {
    a *= 1 + 0.001 + gauss(rnd) * 0.004; b *= 1 + gauss(rnd) * 0.01;
    ip.push({ date: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), value: a });
    for (const d of [3, 10, 17, 24]) usd.push({ date: new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10), value: b * (1 + gauss(rnd) * 0.002) });
  }
  return (id) => (id === 'INDPRO' ? ip : id === 'DTWEXBGS' ? usd : []);
}

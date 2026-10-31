export const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export function quantile(xs, q) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b), n = (sorted.length - 1) * q, i = Math.floor(n);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (n - i);
}
export function random(seed) {
  let v = seed >>> 0;
  return () => { v += 0x6D2B79F5; let x = v; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}
// Moving blocks of dates preserve overlapping-label dependence. Issuer resampling
// additionally accounts for repeated observations from the same security.
export function clusteredInterval(rows, field, seed, repetitions = 300, blockLength = 11, alpha = 0.05) {
  const dates = [...new Set(rows.map(r => r.date))].sort(), assets = [...new Set(rows.map(r => r.asset))].sort();
  if (dates.length < Math.max(5, blockLength * 2) || assets.length < 2) return { low: null, high: null, effective_dates: dates.length, issuers: assets.length, method: 'insufficient_date_blocks_or_issuers' };
  const rng = random(seed), draws = [], groups = new Map();
  for (const r of rows) { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(r); }
  for (let n = 0; n < repetitions; n++) {
    const weights = new Map();
    for (let a = 0; a < assets.length; a++) { const id = assets[Math.floor(rng() * assets.length)]; weights.set(id, (weights.get(id) || 0) + 1); }
    let total = 0, count = 0;
    for (let k = 0; k < dates.length; k += blockLength) {
      const start = Math.floor(rng() * dates.length);
      for (let j = 0; j < Math.min(blockLength, dates.length - k); j++) for (const r of groups.get(dates[(start + j) % dates.length])) {
        const w = weights.get(r.asset) || 0; total += r[field] * w; count += w;
      }
    }
    if (count) draws.push(total / count);
  }
  return { low: quantile(draws, alpha / 2), high: quantile(draws, 1 - alpha / 2), effective_dates: dates.length, issuers: assets.length,
    block_sessions: blockLength, repetitions, alpha, method: 'moving_date_blocks_and_issuer_cluster_bootstrap_v1' };
}
export function correlation(a, b) {
  if (a.length < 3) return null;
  const ma = mean(a), mb = mean(b), cov = a.reduce((v, x, i) => v + (x - ma) * (b[i] - mb), 0);
  const va = a.reduce((v, x) => v + (x - ma) ** 2, 0), vb = b.reduce((v, x) => v + (x - mb) ** 2, 0);
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

// Normal-curve helpers shared by the stat model (models.mjs) and the
// same-game engine (joint.mjs). Pure and deterministic.

// Standard normal CDF (Abramowitz & Stegun 7.1.26, error below 1.5e-7).
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Inverse standard normal CDF (Acklam's rational approximation, relative
// error below 1.2e-9). p is clamped away from 0 and 1.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
export function invNorm(p) {
  const q0 = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (q0 < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  if (q0 > 1 - 0.02425) return -invNorm(1 - q0);
  const q = q0 - 0.5, r = q * q;
  return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

// Gauss-Legendre nodes and weights on [-1, 1], found by Newton's method on
// the Legendre polynomial (no copied tables).
function gaussLegendre(n) {
  const x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      dp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / dp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}
const GL = gaussLegendre(24);

// P(X > h and Y > k) for two standard normals with correlation r, |r| < 1.
// Uses dP/dr = the bivariate normal density, integrated from 0 to r with
// r = sin(t) (Genz's first method), so it is smooth for |r| up to 0.95.
export function bvnUpper(h, k, r) {
  const base = normCdf(-h) * normCdf(-k);
  if (r === 0) return base;
  const rr = Math.max(-0.95, Math.min(0.95, r));
  const asr = Math.asin(rr), hk = h * k, hs = (h * h + k * k) / 2;
  let s = 0;
  for (let i = 0; i < GL.x.length; i++) {
    const sn = Math.sin(asr * (GL.x[i] + 1) / 2);
    s += GL.w[i] * Math.exp((sn * hk - hs) / (1 - sn * sn));
  }
  return Math.min(1, Math.max(0, base + (s * asr) / (4 * Math.PI)));
}

// Seeded random numbers (mulberry32) and standard normals (Box-Muller), so
// a simulation with the same seed always gives the same answer.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededNormals(seed) {
  const rand = seededRandom(seed);
  let spare = null;
  return () => {
    if (spare != null) { const v = spare; spare = null; return v; }
    const u = rand() || 1e-12, v = rand();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}
// FNV-1a: a stable 32-bit seed from text.
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

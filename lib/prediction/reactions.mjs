// Prediction market odds tracker: do the odds tell us anything about stock
// moves? Three tests, all on daily data lined up at the 16:00 ET close, all
// deterministic (seeded), none of them changing a pick or a grade.
//
//   B  Odds jumps. A contract's chance moving 10+ points between two closes.
//      For every stock it links to: the abnormal move that day, the next 1, 3
//      and 5 days, and the 3 days before (was it already priced?).
//   C  Lead or echo. Over every day, does an odds move come before the stock
//      move (odds lead), after it (odds echo the market) or on the same day?
//   D  Run-ups. Over five-day windows, do rising odds go with the stock
//      moving the linked way at the same time or over the next five days, and
//      does the stock drift toward a likely result as the close date nears?
//
// Rules that keep the results honest:
//   - Only '1' days (a price matched to 16:00 ET) are used, so a value that
//     may hold after-hours news is never matched to that day's close.
//   - Single stocks use the move left after the S&P 500 (return minus beta x
//     SPY); index and asset ETFs use their own return.
//   - Links are grouped into families (rule x stock). The first two thirds of
//     each family's dates are the fit half and the last third the test half;
//     a link whose sign was not declared (company, election, Fed chair) learns
//     its sign on the fit half only. Verdicts read the test half.
//   - p-values come from a seeded sign-flip test; across families they are
//     corrected with Benjamini-Hochberg. Under MIN_EVENTS a family is
//     "collecting", not "no effect".

import { daysBetween } from './history.mjs';

export const JUMP_POINTS = 10;
export const JUMP_GAP_DAYS = 3;
export const MIN_EVENTS = 30;
export const MIN_TEST = 10;
export const MIN_PAIRS = 60;
export const FDR_Q = 0.10;
export const PERM_REPS = 1000;
const RAW_RETURN_SYMS = new Set(['SPY', 'QQQ', 'IWM', 'SMH', 'UVXY', 'TLT', 'USO', 'GLD', 'SLV', 'KWEB', 'EWY', 'DRAM']);

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

// Seeded PRNG (mulberry32) so every bake prints the same p-values.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashSeed = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// One-sided sign-flip p-value for mean(values) > 0.
export function signFlipP(values, seedKey = 'x', reps = PERM_REPS) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const obs = xs.reduce((a, b) => a + b, 0) / xs.length;
  const rand = rng(hashSeed(seedKey));
  let hits = 0;
  for (let r = 0; r < reps; r += 1) {
    let s = 0;
    for (const x of xs) s += rand() < 0.5 ? -x : x;
    if (s / xs.length >= obs) hits += 1;
  }
  return (hits + 1) / (reps + 1);
}

// Benjamini-Hochberg q-values for an array of p (nulls kept null).
export function bhAdjust(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length;
  const q = ps.map(() => null);
  let min = 1;
  for (let k = m - 1; k >= 0; k -= 1) {
    const [p, i] = idx[k];
    min = Math.min(min, (p * m) / (k + 1));
    q[i] = Math.min(1, min);
  }
  return q;
}

export function corr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i += 1) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
// Two-sided normal-approximation p for a correlation r over n pairs.
export function corrP(r, n) {
  if (r == null || n < 4) return null;
  const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
  // Normal tail, Abramowitz-Stegun.
  const z = t, tt = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const tail = d * tt * (0.3193815 + tt * (-0.3565638 + tt * (1.781478 + tt * (-1.821256 + tt * 1.330274))));
  return Math.min(1, 2 * tail);
}

// ---- stock returns --------------------------------------------------------

// prices: { SYM: [[date, close], ...] } oldest first. Returns per symbol a
// map date → daily return in % (abnormal for single stocks).
export function returnTables(prices) {
  const raw = {};
  for (const [sym, rows] of Object.entries(prices || {})) {
    const m = new Map();
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1][1], b = rows[i][1];
      if (a > 0 && b > 0) m.set(rows[i][0], (b / a - 1) * 100);
    }
    raw[sym] = m;
  }
  const spy = raw.SPY || new Map();
  const out = {};
  for (const [sym, m] of Object.entries(raw)) {
    if (RAW_RETURN_SYMS.has(sym) || !spy.size) { out[sym] = m; continue; }
    const xs = [], ys = [];
    for (const [d, r] of m) if (spy.has(d)) { xs.push(spy.get(d)); ys.push(r); }
    let beta = 1;
    if (xs.length >= 60) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let c = 0, v = 0;
      for (let i = 0; i < xs.length; i += 1) { c += (xs[i] - mx) * (ys[i] - my); v += (xs[i] - mx) ** 2; }
      if (v > 0) beta = Math.max(-1, Math.min(4, c / v));
    }
    const ab = new Map();
    for (const [d, r] of m) if (spy.has(d)) ab.set(d, r - beta * spy.get(d));
    out[sym] = ab;
  }
  return out;
}

// The trading calendar (SPY's dates, else the longest price list).
export function tradingDays(prices) {
  const spy = prices?.SPY;
  if (Array.isArray(spy) && spy.length) return spy.map((r) => r[0]);
  let best = [];
  for (const rows of Object.values(prices || {})) if (rows.length > best.length) best = rows;
  return best.map((r) => r[0]);
}

const sumRange = (m, days, from, to) => {
  if (from < 0 || to >= days.length || from > to) return null;
  let s = 0;
  for (let i = from; i <= to; i += 1) {
    const v = m.get(days[i]);
    if (v == null) return null;
    s += v;
  }
  return s;
};

// The contract's precise 16:00 ET chance on each trading day (null when the
// day has no '1' value).
export function alignedOdds(c, days) {
  const out = new Array(days.length).fill(null);
  if (!c?.d0 || !Array.isArray(c.dv)) return out;
  for (let i = 0; i < days.length; i += 1) {
    const k = daysBetween(c.d0, days[i]);
    if (k < 0 || k >= c.dv.length) continue;
    if ((c.dq || '')[k] === '1' && c.dv[k] != null) out[i] = c.dv[k];
  }
  return out;
}

// ---- the three tests ------------------------------------------------------

export function familyKey(link) { return `${link.rule}|${link.sym}`; }

// Every jump in one contract: [{ i, date, change }] with change in points,
// at least JUMP_GAP_DAYS trading days after the previous jump.
export function findJumps(odds, days) {
  const out = [];
  let lastI = -Infinity;
  for (let i = 1; i < odds.length; i += 1) {
    if (odds[i] == null || odds[i - 1] == null) continue;
    const ch = (odds[i] - odds[i - 1]) * 100;
    if (Math.abs(ch) < JUMP_POINTS) continue;
    if (i - lastI <= JUMP_GAP_DAYS) continue;
    out.push({ i, date: days[i], change: r2(ch) });
    lastI = i;
  }
  return out;
}

function splitHalf(rows) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const cut = Math.floor((sorted.length * 2) / 3);
  return { fit: sorted.slice(0, cut), test: sorted.slice(cut), all: sorted };
}
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// analyzeReactions({ contracts, prices }) → { families, jumps, asOf }.
export function analyzeReactions({ contracts = [], prices = {}, todayEt = null } = {}) {
  const days = tradingDays(prices);
  const rets = returnTables(prices);
  const fam = new Map();
  const famOf = (link) => {
    const k = familyKey(link);
    if (!fam.has(k)) fam.set(k, { key: k, rule: link.rule, sym: link.sym, sign: link.sign, jumps: [], pairs: [], windows: [], resolved: [], contracts: new Set() });
    return fam.get(k);
  };
  const jumpLog = [];
  for (const c of contracts) {
    if (!Array.isArray(c.links) || !c.links.length) continue;
    const odds = alignedOdds(c, days);
    const jumps = findJumps(odds, days);
    for (const link of c.links) {
      const m = rets[link.sym];
      if (!m) continue;
      const f = famOf(link);
      f.contracts.add(c.id);
      for (const j of jumps) {
        const row = {
          date: j.date, change: j.change, dir: Math.sign(j.change), id: c.id,
          same: m.get(days[j.i]) ?? null,
          next1: sumRange(m, days, j.i + 1, j.i + 1), next3: sumRange(m, days, j.i + 1, j.i + 3), next5: sumRange(m, days, j.i + 1, j.i + 5),
          prev3: sumRange(m, days, j.i - 3, j.i - 1),
        };
        if (row.same == null) continue;
        f.jumps.push(row);
      }
      // Test C: day pairs.
      for (let i = 1; i < odds.length - 1; i += 1) {
        if (odds[i] == null || odds[i - 1] == null) continue;
        const dp = (odds[i] - odds[i - 1]) * 100;
        const arT = m.get(days[i]), arN = m.get(days[i + 1]);
        const dpN = odds[i + 1] != null ? (odds[i + 1] - odds[i]) * 100 : null;
        if (arT == null) continue;
        f.pairs.push({ date: days[i], dp, ar: arT, arNext: arN ?? null, dpNext: dpN });
      }
      // Test D: five-day windows, non-overlapping, ending every fifth day.
      const close = Date.parse(c.closeTime || '');
      for (let i = 5; i < odds.length; i += 5) {
        if (odds[i] == null || odds[i - 5] == null) continue;
        const conc = sumRange(m, days, i - 4, i);
        const fwd = sumRange(m, days, i + 1, i + 5);
        if (conc == null) continue;
        const daysLeft = Number.isFinite(close) ? Math.round((close - Date.parse(`${days[i]}T21:00:00Z`)) / 86400000) : null;
        f.windows.push({ date: days[i], d5: (odds[i] - odds[i - 5]) * 100, level: (odds[i - 5] - 0.5) * 100, conc, fwd, daysLeft });
      }
      // Resolved contracts: the move into and out of the result.
      if (c.result && c.resolvedAt) {
        const rd = String(c.resolvedAt).slice(0, 10);
        let ri = days.findIndex((d) => d >= rd);
        if (ri < 0) ri = days.length;
        const pre = c.lastPreResult;
        const before10 = sumRange(m, days, ri - 10, ri - 1);
        const after3 = sumRange(m, days, ri, ri + 2);
        if (before10 != null && Number.isFinite(pre)) f.resolved.push({ date: rd, result: c.result, pre, before10, after3 });
      }
    }
    for (const j of jumps) {
      if (todayEt && daysBetween(j.date, todayEt) > 45) continue;
      jumpLog.push({ id: c.id, date: j.date, change: j.change, i: j.i });
    }
  }

  const families = [];
  for (const f of fam.values()) {
    // ---- learned sign (fit half only) for undeclared links
    const J = splitHalf(f.jumps);
    let sign = f.sign;
    let learned = false;
    if (!sign) {
      const fitSame = mean(J.fit.map((r) => r.dir * r.same));
      const P = splitHalf(f.pairs);
      const fitR = corr(P.fit.map((r) => r.dp), P.fit.map((r) => r.ar));
      const s = fitSame != null && J.fit.length >= 5 ? Math.sign(fitSame) : fitR != null && P.fit.length >= 20 ? Math.sign(fitR) : 0;
      sign = s || 0;
      learned = true;
    }
    const jt = J.test;
    const signed = (key) => jt.map((r) => (r[key] == null ? null : r.dir * (sign || 1) * r[key])).filter(Number.isFinite);
    const jumpStats = {};
    for (const key of ['same', 'next1', 'next3', 'next5', 'prev3']) {
      const xs = signed(key);
      jumpStats[key] = { n: xs.length, mean: r3(mean(xs)), p: sign && xs.length >= MIN_TEST ? signFlipP(xs, `${f.key}:${key}`) : null };
    }
    // ---- test C on the test half of days
    const P = splitHalf(f.pairs);
    const sx = (r) => (sign || 1) * r.dp;
    const pt = P.test;
    const sameR = corr(pt.map(sx), pt.map((r) => r.ar));
    const leadRows = pt.filter((r) => r.arNext != null);
    const leadR = corr(leadRows.map(sx), leadRows.map((r) => r.arNext));
    const echoRows = pt.filter((r) => r.dpNext != null);
    const echoR = corr(echoRows.map((r) => r.ar), echoRows.map((r) => (sign || 1) * r.dpNext));
    // ---- test D
    const W = splitHalf(f.windows);
    const wt = W.test;
    const concR = corr(wt.map((r) => (sign || 1) * r.d5), wt.map((r) => r.conc));
    const fwdRows = wt.filter((r) => r.fwd != null);
    const fwdR = corr(fwdRows.map((r) => (sign || 1) * r.d5), fwdRows.map((r) => r.fwd));
    const nearRows = W.all.filter((r) => r.daysLeft != null && r.daysLeft >= 0 && r.daysLeft <= 30 && r.fwd != null);
    const levelR = corr(nearRows.map((r) => (sign || 1) * r.level), nearRows.map((r) => r.fwd));
    const res = f.resolved.map((r) => ({ ...r, dirRes: r.result === 'yes' ? 1 : -1 }));
    families.push({
      key: f.key, rule: f.rule, sym: f.sym, declaredSign: f.sign, sign, learned, contracts: f.contracts.size,
      jumps: { n: f.jumps.length, nTest: jt.length, ...jumpStats },
      flow: { n: P.all.length, nTest: pt.length, same: r3(sameR), lead: r3(leadR), echo: r3(echoR), pSame: corrP(sameR, pt.length), pLead: corrP(leadR, leadRows.length), pEcho: corrP(echoR, echoRows.length) },
      runup: {
        n: W.all.length, nTest: wt.length, concurrent: r3(concR), forward: r3(fwdR), pConc: corrP(concR, wt.length), pFwd: corrP(fwdR, fwdRows.length),
        nearClose: { n: nearRows.length, level: r3(levelR), p: corrP(levelR, nearRows.length) },
        resolved: { n: res.length, before10: r3(mean(res.map((r) => r.dirRes * (sign || 1) * r.before10))), after3: r3(mean(res.map((r) => (sign || 1) * ((r.result === 'yes' ? 1 : 0) - r.pre) * (r.after3 ?? NaN)).filter(Number.isFinite))) },
      },
    });
  }

  // ---- corrections and verdicts
  const qJump = bhAdjust(families.map((f) => (f.jumps.nTest >= MIN_TEST ? Math.min(f.jumps.same.p ?? 1, f.jumps.next1.p ?? 1) : null)));
  // One-sided correlation p: only a positive signed correlation counts.
  const oneSided = (r, p) => (r == null || p == null ? null : r > 0 ? p / 2 : 1 - p / 2);
  const qLead = bhAdjust(families.map((f) => (f.flow.nTest >= MIN_PAIRS / 3 ? oneSided(f.flow.lead, f.flow.pLead) : null)));
  const qEcho = bhAdjust(families.map((f) => (f.flow.nTest >= MIN_PAIRS / 3 ? oneSided(f.flow.echo, f.flow.pEcho) : null)));
  const qSame = bhAdjust(families.map((f) => (f.flow.nTest >= MIN_PAIRS / 3 ? oneSided(f.flow.same, f.flow.pSame) : null)));
  const qRun = bhAdjust(families.map((f) => (f.runup.nTest >= MIN_TEST ? oneSided(f.runup.forward, f.runup.pFwd) : null)));
  const qConc = bhAdjust(families.map((f) => (f.runup.nTest >= MIN_TEST ? oneSided(f.runup.concurrent, f.runup.pConc) : null)));
  families.forEach((f, i) => {
    const noSign = !f.sign;
    f.jumps.q = r3(qJump[i]);
    f.jumps.verdict = f.jumps.n < MIN_EVENTS || f.jumps.nTest < MIN_TEST || noSign ? 'collecting'
      : qJump[i] != null && qJump[i] <= FDR_Q ? 'holds'
        : (f.jumps.prev3.p != null && f.jumps.prev3.p <= 0.05 && (f.jumps.same.p ?? 1) > 0.2) ? 'echo' : 'no-effect';
    f.flow.qLead = r3(qLead[i]); f.flow.qEcho = r3(qEcho[i]); f.flow.qSame = r3(qSame[i]);
    f.flow.verdict = f.flow.n < MIN_PAIRS || noSign ? 'collecting'
      : qLead[i] != null && qLead[i] <= FDR_Q && (f.flow.lead ?? 0) > (f.flow.echo ?? 0) ? 'odds-lead'
        : qEcho[i] != null && qEcho[i] <= FDR_Q && (f.flow.echo ?? 0) > (f.flow.lead ?? 0) ? 'odds-echo'
          : qSame[i] != null && qSame[i] <= FDR_Q ? 'same-day' : 'no-order';
    f.runup.qFwd = r3(qRun[i]); f.runup.qConc = r3(qConc[i]);
    f.runup.verdict = f.runup.n < MIN_EVENTS || f.runup.nTest < MIN_TEST || noSign ? 'collecting'
      : qRun[i] != null && qRun[i] <= FDR_Q ? 'run-up-follows'
        : qConc[i] != null && qConc[i] <= FDR_Q ? 'moves-together' : 'no-effect';
  });
  families.sort((a, b) => b.jumps.n - a.jumps.n || b.flow.n - a.flow.n || a.key.localeCompare(b.key));
  return { families, jumpLog, days, rets };
}

// Follow-through for recent jumps, per linked stock (for the Owner jump log).
export function jumpFollowThrough(jumpLog, contractsById, rets, days, familiesByKey) {
  const out = [];
  for (const j of jumpLog) {
    const c = contractsById[j.id];
    if (!c) continue;
    const stocks = [];
    for (const link of c.links || []) {
      const m = rets[link.sym];
      if (!m) continue;
      const fam = familiesByKey?.get(familyKey(link));
      const sign = link.sign || fam?.sign || 0;
      stocks.push({
        sym: link.sym, sign, learned: !link.sign && !!sign,
        same: r2(m.get(days[j.i]) ?? null), next1: r2(sumRange(m, days, j.i + 1, j.i + 1)), next3: r2(sumRange(m, days, j.i + 1, j.i + 3)), prev3: r2(sumRange(m, days, j.i - 3, j.i - 1)),
      });
    }
    out.push({ id: j.id, date: j.date, change: j.change, stocks });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.change) - Math.abs(a.change)).slice(0, 60);
}

// Abnormal move over the last n trading days for one symbol, in %.
export function trailingMove(rets, days, sym, n = 10) {
  const m = rets[sym];
  if (!m || days.length < n) return null;
  let s = 0, k = 0;
  for (let i = days.length - n; i < days.length; i += 1) {
    const v = m.get(days[i]);
    if (v != null) { s += v; k += 1; }
  }
  return k >= Math.ceil(n * 0.7) ? r2(s) : null;
}

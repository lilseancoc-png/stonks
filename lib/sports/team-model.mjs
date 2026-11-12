// Team vs team game model (owner ask 2026-11-11): the chance of a team
// winning, winning by X or more points, covering a spread, a game total and a
// team total going over or under. Deterministic, no AI, refit by the same
// sports-data job as the stat model and stored as <sport>/team-model.json.
//
// How a game is forecast:
//   1. Ratings. Each team carries an offense and a defense rating (points it
//      scores and allows above the league average). They are updated after
//      every final game by a fixed share of the miss, shrink toward average
//      between seasons, and give each team's expected points (plus a home
//      edge and, where it beat leaving it out, a rest edge). Walk-forward:
//      every game is predicted only from games before it.
//   2. Market. When the game has a sportsbook spread and total (NFL from the
//      schedule, NBA from the props scan), the expected margin and total
//      start from the market and move toward the ratings only by the share
//      that improved earlier games (`blend`). Markets are hard to beat, so
//      that share is usually small.
//   3. Spread of outcomes. Margins, totals and team scores are whole numbers
//      with favorite values (NFL wins by 3 and 7, team scores of 17, 20, 24),
//      so each is a normal curve over whole numbers reweighted by how often
//      each value really happened on earlier games (`weights`), with the
//      center held at the expected value. The widths are the measured misses.
//   4. Check. Fitted on the earlier seasons, scored on the latest finished
//      season and this season so far: win chances, covers and overs at the
//      market numbers, win-by-X ladders and team totals, against the market
//      alone and a coin flip. A market is `validated` with 300+ held-out
//      results and a calibration error of 0.03 or less.
import { normCdf, invNorm, seededRandom, seedOf } from './normal.mjs';
import { impliedAmerican, shinProbabilities } from './nba-market.mjs';

export const TEAM_MODEL_VERSION = 'team-model-1';
export const TEAM_MARKETS = Object.freeze(['moneyline', 'spread', 'win_by', 'total', 'team_total']);

const CFG = Object.freeze({
  nba: { warmup: 120, early: 8, restCap: 1, kGrid: [0.03, 0.045, 0.06, 0.08], carryGrid: [0.5, 0.65, 0.8], blendPrior: 0.2, alt: [1, 5, 10, 15, 20], totalAlt: [10, 20], teamStep: 8, minHold: 300 },
  nfl: { warmup: 48, early: 3, restCap: 7, kGrid: [0.04, 0.06, 0.08, 0.11], carryGrid: [0.4, 0.55, 0.7], blendPrior: 0.2, alt: [1, 3, 7, 10, 14, 17], totalAlt: [7, 14], teamStep: 7, minHold: 300 },
});
const MAX_ABS = 90;          // widest margin / team score / total offset kept in a weight table
const PSEUDO = 4;            // pseudo-count pulling each favorite-value weight toward 1
const ECE_MAX = 0.03;
// What each market's chances are compared with: the market's own spread and
// total with no rating input where the game has them; a coin flip for a
// moneyline or team total without them; win-by rungs and model-only totals
// only against the market (games without one are left out of that compare).
const BASELINE_NAME = Object.freeze({ moneyline: 'market alone (else 50/50)', spread: 'market alone', win_by: 'market alone', total: 'market alone', team_total: 'market alone (else 50/50)' });
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;
const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sdOf = (xs) => { const m = meanOf(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };

const dateOf = (g) => g.local_date || String(g.start_utc || '').slice(0, 10);
const isFinal = (g) => g && g.status === 'final' && Number.isInteger(g.home_score) && Number.isInteger(g.away_score);
const hasLines = (g) => g?.lines && Number.isFinite(g.lines.total) && Number.isFinite(g.lines.home_margin);
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);

// Rest edge for the home side: NBA = away on the second night of a
// back-to-back minus home on one (−1, 0, 1); NFL = days of rest difference in
// weeks, capped at one week either way.
// A gap longer than this is the offseason, not rest: no rest edge, and the
// days are shown as unknown.
export const REST_MAX_DAYS = 30;
export function restEdge(sport, homeRest, awayRest) {
  if (homeRest == null || awayRest == null || homeRest > REST_MAX_DAYS || awayRest > REST_MAX_DAYS) return 0;
  if (sport === 'nba') return (awayRest <= 1 ? 1 : 0) - (homeRest <= 1 ? 1 : 0);
  return Math.max(-1, Math.min(1, (homeRest - awayRest) / 7));
}

// Days since each team's previous game, from a list of games (any status).
export function restDaysFor(games, game) {
  const d = dayNum(dateOf(game));
  const last = (team) => {
    let best = null;
    for (const g of games) {
      if (g.game_id === game.game_id || (g.home_team !== team && g.away_team !== team) || g.status === 'canceled' || g.status === 'postponed') continue;
      const x = dayNum(dateOf(g));
      if (x < d && (best == null || x > best)) best = x;
    }
    return best == null || d - best > REST_MAX_DAYS ? null : d - best;
  };
  if (game.rest_days && Number.isInteger(game.rest_days.home) && Number.isInteger(game.rest_days.away)) return { home: game.rest_days.home, away: game.rest_days.away };
  return { home: last(game.home_team), away: last(game.away_team) };
}

// Walk-forward ratings over games sorted by start. Returns each final game's
// pre-game prediction and the end state.
function runRatings(sport, games, p) {
  const team = new Map();
  const get = (t) => { if (!team.has(t)) team.set(t, { off: 0, def: 0, season: null, games: 0, last: null }); return team.get(t); };
  let league = null, leagueN = 0, season = null;
  const preds = [];
  for (const g of games) {
    if (g.season !== season) {
      season = g.season;
      for (const s of team.values()) { s.off *= p.carry; s.def *= p.carry; }
    }
    const H = get(g.home_team), A = get(g.away_team);
    for (const s of [H, A]) if (s.season !== g.season) { s.season = g.season; s.games = 0; }
    const day = dayNum(dateOf(g));
    const rest = g.rest_days && Number.isInteger(g.rest_days.home) && Number.isInteger(g.rest_days.away) ? { home: g.rest_days.home, away: g.rest_days.away }
      : { home: H.last == null ? null : day - H.last, away: A.last == null ? null : day - A.last };
    const edge = restEdge(sport, rest.home, rest.away);
    if (!isFinal(g)) continue;
    const L = league ?? (g.home_score + g.away_score) / 2;
    const h = g.neutral ? 0 : p.home;
    const ph = L + h / 2 + (p.rest || 0) * edge / 2 + H.off + A.def;
    const pa = L - h / 2 - (p.rest || 0) * edge / 2 + A.off + H.def;
    preds.push({ g, ph, pa, edge, early: Math.min(H.games, A.games) < CFG[sport].early });
    const eh = g.home_score - ph, ea = g.away_score - pa;
    H.off += p.k * eh; A.def += p.k * eh; A.off += p.k * ea; H.def += p.k * ea;
    leagueN++;
    league = L + (leagueN < 50 ? 1 / leagueN : 0.004) * ((g.home_score + g.away_score) / 2 - L);
    H.games++; A.games++; H.last = day; A.last = day;
  }
  return { preds, team, league };
}

// Least-squares share of the way from the market to the ratings.
function fitBlend(pairs) {
  let num = 0, den = 0;
  for (const [y, mkt, mod] of pairs) { num += (y - mkt) * (mod - mkt); den += (mod - mkt) ** 2; }
  return den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
}

// Means for one prediction under fitted numbers. `mode` is market when the
// game has a spread and total, else model.
function meansOf(pr, fit) {
  const mm = pr.ph - pr.pa, mt = pr.ph + pr.pa, g = pr.g;
  if (hasLines(g)) {
    const margin = g.lines.home_margin + fit.blend.margin * (mm - g.lines.home_margin);
    const total = g.lines.total + fit.blend.total * (mt - g.lines.total);
    return { mode: 'market', margin, total };
  }
  return { mode: 'model', margin: mm, total: mt };
}

// Favorite-value weights: how often each whole-number value happened over
// how often the plain normal curve expected it, shrunk toward 1.
function fitWeights(items, symmetric) {
  const obs = new Map(), exp = new Map();
  for (const { mu, sd, x } of items) {
    const kx = symmetric ? Math.abs(x) : x;
    obs.set(kx, (obs.get(kx) || 0) + 1);
    const lo = Math.floor(mu - 5 * sd), hi = Math.ceil(mu + 5 * sd);
    for (let k = lo; k <= hi; k++) {
      const pk = normCdf((k + 0.5 - mu) / sd) - normCdf((k - 0.5 - mu) / sd);
      const kk = symmetric ? Math.abs(k) : k;
      exp.set(kk, (exp.get(kk) || 0) + pk);
    }
  }
  const keys = [...new Set([...obs.keys(), ...exp.keys()])].filter((k) => (exp.get(k) || 0) > 0.05 || obs.get(k));
  if (!keys.length) return null;
  const lo = Math.max(symmetric ? 0 : -MAX_ABS * 4, Math.min(...keys)), hi = Math.min(MAX_ABS * 4, Math.max(...keys));
  const w = [];
  for (let k = lo; k <= hi; k++) w.push(r3(((obs.get(k) || 0) + PSEUDO) / ((exp.get(k) || 0) + PSEUDO)));
  return { start: lo, w, symmetric: !!symmetric };
}
const weightAt = (wt, k) => {
  if (!wt) return 1;
  const kk = wt.symmetric ? Math.abs(k) : k, i = kk - wt.start;
  return i >= 0 && i < wt.w.length ? wt.w[i] : 1;
};

// The whole-number distribution: { start, p } with p summing to 1, its mean
// held at `mu` (a few shifts of the curve's center).
export function wholePmf(mu, sd, wt) {
  if (!(sd > 0) || !Number.isFinite(mu)) return null;
  const lo = Math.floor(mu - 6 * sd), hi = Math.ceil(mu + 6 * sd);
  let c = mu, p = null;
  for (let it = 0; it < 4; it++) {
    p = [];
    let s = 0;
    for (let k = lo; k <= hi; k++) {
      const v = (normCdf((k + 0.5 - c) / sd) - normCdf((k - 0.5 - c) / sd)) * weightAt(wt, k);
      p.push(v); s += v;
    }
    if (!(s > 0)) return null;
    let m = 0;
    for (let i = 0; i < p.length; i++) { p[i] /= s; m += (lo + i) * p[i]; }
    if (Math.abs(m - mu) < 0.01) break;
    c += mu - m;
  }
  return { start: lo, p };
}
// P(value > line), P(value = line) and P(value < line) for any line. The
// three add to 1 even for a stored distribution whose rounded entries do
// not quite (the page's checker divides the same way).
export function pmfChances(pmf, line) {
  let over = 0, push = 0, under = 0;
  if (!pmf) return null;
  for (let i = 0; i < pmf.p.length; i++) {
    const k = pmf.start + i;
    if (k > line + 1e-9) over += pmf.p[i]; else if (Math.abs(k - line) < 1e-9) push += pmf.p[i]; else under += pmf.p[i];
  }
  const s = over + push + under || 1;
  return { over: over / s, push: push / s, under: under / s };
}

// The calibration error a perfectly calibrated forecaster would still show
// on these chances (95th percentile of seeded draws): with a few hundred
// yes/no results, a 0.03 error can be luck alone.
function eceNoise(ps, draws = 200) {
  const rnd = seededRandom(seedOf('team-ece:' + ps.length + ':' + ps.slice(0, 5).join(',')));
  const out = [];
  for (let d = 0; d < draws; d++) out.push(reliability(ps, ps.map((p) => (rnd() < p ? 1 : 0))).ece);
  out.sort((a, b) => a - b);
  return out[Math.floor(draws * 0.95)];
}
// Calibration slope: logistic fit of what happened on the log-odds of the
// chance. 1 is right, below 1 the chances are too far from 50% (overconfident).
function calibrationSlope(ps, ys) {
  const xs = ps.map((p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p)))));
  let a = 0, b = 1;
  for (let it = 0; it < 25; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < xs.length; i++) {
      const q = 1 / (1 + Math.exp(-(a + b * xs[i]))), w = q * (1 - q), e = ys[i] - q;
      g0 += e; g1 += e * xs[i]; h00 += w; h01 += w * xs[i]; h11 += w * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 1e-9)) return null;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-7) break;
  }
  return Number.isFinite(b) ? r3(b) : null;
}

function reliability(ps, ys, bins = 10) {
  const B = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (let i = 0; i < ps.length; i++) {
    const b = B[Math.min(bins - 1, Math.floor(ps[i] * bins))];
    b.n++; b.p += ps[i]; b.y += ys[i];
  }
  let ece = 0;
  for (const b of B) if (b.n) ece += (b.n / ps.length) * Math.abs(b.p / b.n - b.y / b.n);
  return { ece: r4(ece), bins: B.filter((b) => b.n).map((b) => ({ n: b.n, chance: r3(b.p / b.n), happened: r3(b.y / b.n) })) };
}
const brier = (ps, ys) => (ps.length ? r4(ps.reduce((a, p, i) => a + (p - ys[i]) ** 2, 0) / ps.length) : null);

// Grid search of the rating numbers on the training games (after the warm-up),
// then the rest edge, blend, widths and weights.
function fitOn(sport, games, trainCut) {
  const cfg = CFG[sport];
  const finals = games.filter(isFinal);
  const homeEdge = meanOf(finals.filter((g) => !g.neutral && dateOf(g) < trainCut).map((g) => g.home_score - g.away_score)) ?? 0;
  let best = null;
  for (const k of cfg.kGrid) for (const carry of cfg.carryGrid) {
    const { preds } = runRatings(sport, games, { k, carry, home: homeEdge, rest: 0 });
    const use = preds.slice(cfg.warmup).filter((x) => dateOf(x.g) < trainCut);
    let se = 0;
    for (const x of use) se += (x.g.home_score - x.g.away_score - (x.ph - x.pa)) ** 2 + 0.5 * (x.g.home_score + x.g.away_score - x.ph - x.pa) ** 2;
    if (use.length && (!best || se / use.length < best.se)) best = { k, carry, se: se / use.length };
  }
  if (!best) return null;
  const p = { k: best.k, carry: best.carry, home: r2(homeEdge), rest: 0 };
  // Rest edge: least squares on the margin miss, kept only when it beats
  // leaving it out on the later half of the training games.
  const base = runRatings(sport, games, p).preds.slice(cfg.warmup).filter((x) => dateOf(x.g) < trainCut);
  const half = Math.floor(base.length / 2);
  const fitR = (xs) => { let n = 0, d = 0; for (const x of xs) { n += x.edge * (x.g.home_score - x.g.away_score - (x.ph - x.pa)); d += x.edge * x.edge; } return d > 0 ? n / d : 0; };
  const rTry = fitR(base.slice(0, half));
  const sse = (xs, r) => xs.reduce((a, x) => a + (x.g.home_score - x.g.away_score - (x.ph - x.pa) - r * x.edge) ** 2, 0);
  const restKept = rTry !== 0 && sse(base.slice(half), rTry) < sse(base.slice(half), 0);
  if (restKept) p.rest = r2(Math.max(-6, Math.min(6, fitR(base))));
  const { preds } = runRatings(sport, games, p);
  const train = preds.slice(cfg.warmup).filter((x) => dateOf(x.g) < trainCut);
  const lined = train.filter((x) => hasLines(x.g));
  const blendTested = lined.length >= 200;
  const blend = blendTested
    ? { margin: r3(fitBlend(lined.map((x) => [x.g.home_score - x.g.away_score, x.g.lines.home_margin, x.ph - x.pa]))), total: r3(fitBlend(lined.map((x) => [x.g.home_score + x.g.away_score, x.g.lines.total, x.ph + x.pa]))) }
    : { margin: cfg.blendPrior, total: cfg.blendPrior };
  const fit = { params: p, blend: { ...blend, tested: blendTested, games: lined.length }, rest_kept: restKept };
  // Widths: the measured misses, split by mode; early-season games get their
  // own multiplier. NBA without enough market games uses the model widths.
  const miss = { market: { margin: [], total: [], score: [] }, model: { margin: [], total: [], score: [] } };
  const earlyM = [], lateM = [];
  // The model widths come from every training game's ratings-only miss (an
  // NFL game almost always has a market line, but a game without one still
  // needs a width); the market widths from the games with a line.
  const push = (box, x, m) => {
    const dm = x.g.home_score - x.g.away_score - m.margin, dt = x.g.home_score + x.g.away_score - m.total;
    box.margin.push(dm); box.total.push(dt);
    box.score.push(x.g.home_score - (m.total + m.margin) / 2, x.g.away_score - (m.total - m.margin) / 2);
    return dm;
  };
  for (const x of train) {
    const dm = push(miss.model, x, { margin: x.ph - x.pa, total: x.ph + x.pa });
    (x.early ? earlyM : lateM).push(dm);
    if (hasLines(x.g)) push(miss.market, x, meansOf(x, fit));
  }
  const sd = {};
  for (const mode of ['market', 'model']) {
    const b = miss[mode];
    sd[mode] = b.margin.length >= 150 ? { margin: r2(sdOf(b.margin)), total: r2(sdOf(b.total)), score: r2(sdOf(b.score)), games: b.margin.length } : null;
  }
  if (!sd.model) return null;
  if (!sd.market) sd.market = { ...sd.model, games: 0, borrowed: true };
  const eSd = sdOf(earlyM), lSd = sdOf(lateM);
  sd.early = eSd && lSd && earlyM.length >= 60 ? r3(Math.max(1, Math.min(1.4, eSd / lSd))) : 1;
  fit.sd = sd;
  // Favorite-value weights, from the training games with their own widths.
  const items = { margin: [], total: [], score: [] };
  for (const x of train) {
    const m = meansOf(x, fit), s = sd[m.mode], e = x.early ? sd.early : 1;
    items.margin.push({ mu: m.margin, sd: s.margin * e, x: x.g.home_score - x.g.away_score });
    items.total.push({ mu: m.total, sd: s.total * e, x: x.g.home_score + x.g.away_score });
    items.score.push({ mu: (m.total + m.margin) / 2, sd: s.score * e, x: x.g.home_score }, { mu: (m.total - m.margin) / 2, sd: s.score * e, x: x.g.away_score });
  }
  // The margin weight is the same for either side (|margin|), so a tie
  // (margin 0) is as rare as it really is.
  fit.weights = { margin: fitWeights(items.margin, true), total: fitWeights(items.total, false), score: fitWeights(items.score, false) };
  // NBA games cannot end level (overtime), so a margin of 0 never happens.
  if (sport === 'nba' && fit.weights.margin && fit.weights.margin.start === 0) fit.weights.margin.w[0] = 0;
  fit.train_games = train.length;
  return fit;
}

// One game's three distributions and means from fitted numbers.
function gameDists(fit, means, early) {
  const s = fit.sd[means.mode], e = early ? fit.sd.early : 1;
  const homeMu = (means.total + means.margin) / 2, awayMu = (means.total - means.margin) / 2;
  return {
    margin: wholePmf(means.margin, s.margin * e, fit.weights.margin),
    total: wholePmf(means.total, s.total * e, fit.weights.total),
    home: wholePmf(homeMu, s.score * e, fit.weights.score),
    away: wholePmf(awayMu, s.score * e, fit.weights.score),
  };
}
// A two-way chance with pushes taken out (a push refunds the bet).
const twoWay = (c) => (c && c.over + c.under > 0 ? c.over / (c.over + c.under) : null);

// The held-out check of one fit.
function checkFit(sport, games, fit, holdFrom) {
  const cfg = CFG[sport];
  const { preds } = runRatings(sport, games, fit.params);
  const hold = preds.filter((x) => dateOf(x.g) >= holdFrom);
  const kinds = { moneyline: [[], [], []], spread: [[], [], []], win_by: [[], [], []], total: [[], [], []], team_total: [[], [], []] };
  const add = (kind, p, y, base) => { if (p == null || y == null) return; kinds[kind][0].push(p); kinds[kind][1].push(y); kinds[kind][2].push(base); };
  const noBlend = { ...fit, blend: { margin: 0, total: 0 } };
  for (const x of hold) {
    const g = x.g, m = g.home_score - g.away_score, t = g.home_score + g.away_score;
    const means = meansOf(x, fit), d = gameDists(fit, means, x.early);
    // Baseline: the market alone when there is one, else 50/50.
    const bm = hasLines(g) ? gameDists(noBlend, meansOf(x, noBlend), x.early) : null;
    if (m !== 0) add('moneyline', twoWay(pmfChances(d.margin, 0)), m > 0 ? 1 : 0, bm ? twoWay(pmfChances(bm.margin, 0)) : 0.5);
    if (hasLines(g)) {
      const sl = g.lines.home_margin, tl = g.lines.total;
      if (m !== sl) add('spread', twoWay(pmfChances(d.margin, sl)), m > sl ? 1 : 0, twoWay(pmfChances(bm.margin, sl)));
      if (t !== tl) add('total', twoWay(pmfChances(d.total, tl)), t > tl ? 1 : 0, twoWay(pmfChances(bm.total, tl)));
      for (const off of cfg.totalAlt) for (const tl2 of [tl - off, tl + off]) if (t !== tl2) add('total', twoWay(pmfChances(d.total, tl2)), t > tl2 ? 1 : 0, twoWay(pmfChances(bm.total, tl2)));
    } else {
      const tl = Math.round(means.total) + 0.5;
      for (const off of [0, ...cfg.totalAlt.flatMap((o) => [-o, o])]) add('total', twoWay(pmfChances(d.total, tl + off)), t > tl + off ? 1 : 0, null);
    }
    // Win by X or more, for both teams.
    for (const X of cfg.alt) {
      const line = X - 0.5;
      add('win_by', pmfChances(d.margin, line).over, m > line ? 1 : 0, bm ? pmfChances(bm.margin, line).over : null);
      add('win_by', pmfChances(d.margin, -line).under, -m > line ? 1 : 0, bm ? pmfChances(bm.margin, -line).under : null);
    }
    // Team totals at each team's expected points (half point).
    for (const [pmf, bp, score, mu] of [[d.home, bm?.home, g.home_score, (means.total + means.margin) / 2], [d.away, bm?.away, g.away_score, (means.total - means.margin) / 2]]) {
      for (const off of [0, -cfg.teamStep, cfg.teamStep]) {
        const line = Math.round(mu) + 0.5 + off;
        add('team_total', pmfChances(pmf, line).over, score > line ? 1 : 0, bp ? pmfChances(bp, line).over : off ? null : 0.5);
      }
    }
  }
  const out = {};
  for (const [kind, [ps, ys, bs]] of Object.entries(kinds)) {
    if (!ps.length) { out[kind] = { status: 'no_data', n: 0 }; continue; }
    const rel = reliability(ps, ys);
    const baseIdx = bs.map((b, i) => (b == null ? -1 : i)).filter((i) => i >= 0);
    const bModel = brier(baseIdx.map((i) => ps[i]), baseIdx.map((i) => ys[i])), bBase = brier(baseIdx.map((i) => bs[i]), baseIdx.map((i) => ys[i]));
    const noise = r4(eceNoise(ps)), slope = calibrationSlope(ps, ys);
    out[kind] = {
      n: ps.length, brier: brier(ps, ys), ece: rel.ece, ece_luck: noise, slope, reliability: rel.bins,
      baseline: baseIdx.length ? { n: baseIdx.length, model: bModel, baseline: bBase, name: BASELINE_NAME[kind] } : null,
      status: ps.length < cfg.minHold ? 'learning' : rel.ece <= Math.max(ECE_MAX, noise) ? 'validated' : 'not_validated',
    };
  }
  // Mean misses on the held-out games, for the record.
  const mm = [], mt = [], mkm = [], mkt = [], bt = [];
  for (const x of hold) {
    const means = meansOf(x, fit), g = x.g;
    bt.push(g.home_score + g.away_score - means.total);
    mm.push(Math.abs(g.home_score - g.away_score - means.margin)); mt.push(Math.abs(g.home_score + g.away_score - means.total));
    if (hasLines(g)) { mkm.push(Math.abs(g.home_score - g.away_score - g.lines.home_margin)); mkt.push(Math.abs(g.home_score + g.away_score - g.lines.total)); }
  }
  return { games: hold.length, from: holdFrom, mean_miss: { margin: mm.length ? r2(meanOf(mm)) : null, total: mt.length ? r2(meanOf(mt)) : null, market_margin: mkm.length ? r2(meanOf(mkm)) : null, market_total: mkt.length ? r2(meanOf(mkt)) : null, market_games: mkm.length, total_bias: bt.length ? r2(meanOf(bt)) : null }, markets: out };
}

// The fit stored as <sport>/team-model.json: check first (fit on the earlier
// seasons, score the latest finished season and this one), then the served
// numbers refit on every game, plus each team's current ratings.
export function buildTeamModel({ sport, games, now = Date.now() }) {
  if (!CFG[sport]) throw new Error('sport must be nba or nfl');
  const sorted = (Array.isArray(games) ? games : []).filter((g) => g && g.start_utc && g.home_team && g.away_team && g.status !== 'canceled' && g.status !== 'postponed')
    .slice().sort((a, b) => a.start_utc.localeCompare(b.start_utc) || String(a.game_id).localeCompare(String(b.game_id)));
  const finals = sorted.filter(isFinal);
  const seasons = [...new Set(finals.map((g) => g.season))].sort((a, b) => a - b);
  if (seasons.length < 2 || finals.length < CFG[sport].warmup + 200) return { version: TEAM_MODEL_VERSION, sport, fitted_utc: new Date(now).toISOString(), status: 'not_enough_games', games: finals.length };
  // Hold out the last two seasons (the latest finished one and this one), or
  // only the last when there are just two.
  const holdSeason = seasons.length >= 3 ? seasons[seasons.length - 2] : seasons[seasons.length - 1];
  const holdFrom = dateOf(finals.find((g) => g.season === holdSeason));
  const trial = fitOn(sport, sorted, holdFrom);
  const check = trial ? checkFit(sport, sorted, trial, holdFrom) : null;
  const fit = fitOn(sport, sorted, '9999-12-31');
  if (!fit) return { version: TEAM_MODEL_VERSION, sport, fitted_utc: new Date(now).toISOString(), status: 'not_enough_games', games: finals.length };
  const end = runRatings(sport, sorted, fit.params);
  const ratings = {};
  for (const [t, s] of end.team) ratings[t] = { off: r2(s.off), def: r2(s.def), net: r2(s.off - s.def), season: s.season, games: s.games, last: s.last == null ? null : new Date(s.last * 86400000).toISOString().slice(0, 10) };
  return {
    version: TEAM_MODEL_VERSION, sport, fitted_utc: new Date(now).toISOString(), status: 'ok',
    games: finals.length, seasons, league: r2(end.league), params: fit.params, rest_kept: fit.rest_kept, blend: fit.blend, sd: fit.sd, weights: fit.weights,
    trial: trial ? { params: trial.params, blend: trial.blend, sd: trial.sd } : null,
    check, ratings,
  };
}

// The books' own no-vig chances for a game (Shin's method): NFL from the
// schedule's American prices, NBA from the props scan's sportsbook median.
// { home_win, home_cover, over } at the market moneyline, spread and total;
// null when no prices are stored.
export function bookChances(game) {
  const l = game?.lines;
  if (!l) return null;
  const pair = (a, b) => {
    const x = impliedAmerican(a), y = impliedAmerican(b);
    return x != null && y != null ? r4(shinProbabilities([x, y])[0]) : null;
  };
  let out = null;
  if (l.prices) {
    const p = l.prices;
    out = { home_win: pair(p.home_ml, p.away_ml), home_cover: pair(p.home_spread, p.away_spread), over: pair(p.over, p.under), source: l.source || 'nflverse' };
  } else if (l.book) {
    const b = l.book, ok = (v) => (Number.isFinite(v) && v > 0 && v < 1 ? v : null);
    out = { home_win: ok(b.home_win), home_cover: ok(b.home_cover), over: ok(b.over), source: 'sportsbooks', ...(b.books ? { books: b.books } : {}) };
  }
  return out && (out.home_win != null || out.home_cover != null || out.over != null) ? out : null;
}

// The forecast for one game from a stored team model: expected margin, total
// and team scores, their whole-number distributions (compact, for the page to
// price any line) and the main chances. `rest`: { home, away } days, or null.
export function forecastGame(model, game, { rest = null } = {}) {
  if (!model || model.status !== 'ok' || !game) return null;
  const R = model.ratings || {};
  const H = R[game.home_team], A = R[game.away_team];
  if (!H || !A) return null;
  const season = Number.isInteger(game.season) ? game.season : null;
  const carry = (s) => (season != null && s.season != null && s.season < season ? model.params.carry : 1);
  const edge = rest ? restEdge(model.sport, rest.home, rest.away) : 0;
  const h = game.neutral ? 0 : model.params.home;
  const L = model.league;
  const ph = L + h / 2 + (model.params.rest || 0) * edge / 2 + H.off * carry(H) + A.def * carry(A);
  const pa = L - h / 2 - (model.params.rest || 0) * edge / 2 + A.off * carry(A) + H.def * carry(H);
  const early = Math.min(season != null && H.season === season ? H.games : 0, season != null && A.season === season ? A.games : 0) < CFG[model.sport].early;
  const means = meansOf({ ph, pa, g: game }, model);
  const d = gameDists(model, means, early);
  if (!d.margin || !d.total || !d.home || !d.away) return null;
  const pack = (pmf) => trimmed(pmf);
  const ml = pmfChances(d.margin, 0);
  return {
    version: model.version, mode: means.mode, early,
    ratings_only: { home_points: r2(ph), away_points: r2(pa), margin: r2(ph - pa), total: r2(ph + pa) },
    expected: { home_margin: r2(means.margin), total: r2(means.total), home_points: r2((means.total + means.margin) / 2), away_points: r2((means.total - means.margin) / 2) },
    market: hasLines(game) ? { home_margin: game.lines.home_margin, total: game.lines.total, source: game.lines.source || null } : null,
    book: bookChances(game),
    blend: model.blend, rest: rest || null, rest_edge: edge,
    sd: { margin: r2(model.sd[means.mode].margin * (early ? model.sd.early : 1)), total: r2(model.sd[means.mode].total * (early ? model.sd.early : 1)), score: r2(model.sd[means.mode].score * (early ? model.sd.early : 1)) },
    win: { home: r4(ml.over), away: r4(ml.under), tie: r4(ml.push) },
    pmf: { margin: pack(d.margin), total: pack(d.total), home: pack(d.home), away: pack(d.away) },
  };
}
function trimmed(pmf) {
  // Five decimals is plenty and keeps the payload small; the near-zero tails
  // (rounded to 0) are dropped from both ends.
  const p = pmf.p.map((x) => Math.round(x * 1e5) / 1e5);
  let a = 0, b = p.length;
  while (a < b && p[a] === 0) a++;
  while (b > a && p[b - 1] === 0) b--;
  return { start: pmf.start + a, p: p.slice(a, b) };
}

// Price one team bet from a forecast. `bet`: { market, team, line, side,
// price } where team is 'home' / 'away' or the team id, side is over / under
// for totals, and line is the spread (−7.5 = favored by 7.5), the win-by
// points, or the total. Returns win / push / lose chances and, with an
// American price, the breakeven and expected value per $1.
export function priceTeamBet(fc, game, bet) {
  if (!fc || !bet) return { error: 'no_forecast' };
  const market = String(bet.market || '');
  if (!TEAM_MARKETS.includes(market)) return { error: 'market must be one of ' + TEAM_MARKETS.join(', ') };
  const pmf = (k) => ({ start: fc.pmf[k].start, p: fc.pmf[k].p });
  let who = null;
  if (market !== 'total') {
    const t = String(bet.team || '').toLowerCase();
    who = t === 'home' || t === game.home_team ? 'home' : t === 'away' || t === game.away_team ? 'away' : null;
    if (!who) return { error: 'team must be ' + game.home_team + ' or ' + game.away_team };
  }
  const line = bet.line == null || bet.line === '' ? null : Number(bet.line);
  let win, push, lose, label;
  const team = who === 'home' ? game.home_team : who === 'away' ? game.away_team : null;
  const sign = who === 'away' ? -1 : 1; // margin from this team's side = sign * home margin
  if (market === 'moneyline') {
    const c = pmfChances(pmf('margin'), 0);
    win = who === 'home' ? c.over : c.under; lose = who === 'home' ? c.under : c.over; push = c.push;
    label = team.toUpperCase() + ' to win';
  } else if (market === 'win_by') {
    if (!(Number.isFinite(line) && line >= 1 && line <= 60)) return { error: 'win_by needs points from 1 to 60' };
    const X = Math.ceil(line);
    const c = pmfChances(pmf('margin'), sign * (X - 0.5));
    win = who === 'home' ? c.over : c.under; push = 0; lose = 1 - win;
    label = team.toUpperCase() + ' to win by ' + X + '+';
  } else if (market === 'spread') {
    if (!(Number.isFinite(line) && Math.abs(line) <= 60)) return { error: 'spread needs a line from -60 to 60' };
    // Team covers when its margin + line > 0, so home margin > -line (home) or < line (away).
    const c = pmfChances(pmf('margin'), who === 'home' ? -line : line);
    win = who === 'home' ? c.over : c.under; push = c.push; lose = who === 'home' ? c.under : c.over;
    label = team.toUpperCase() + ' ' + (line > 0 ? '+' : line < 0 ? '−' : '') + (line === 0 ? 'pick’em' : Math.abs(line));
  } else {
    const side = String(bet.side || '').toLowerCase();
    if (side !== 'over' && side !== 'under') return { error: 'totals need side over or under' };
    if (!(Number.isFinite(line) && line > 0 && line <= 400)) return { error: 'totals need a line above 0' };
    const c = pmfChances(pmf(market === 'total' ? 'total' : who), line);
    win = side === 'over' ? c.over : c.under; push = c.push; lose = side === 'over' ? c.under : c.over;
    label = (market === 'total' ? 'Game total ' : team.toUpperCase() + ' team total ') + side + ' ' + line;
  }
  const out = { market, team, line, side: bet.side || null, label, win: r4(win), push: r4(push), lose: r4(lose), chance: r4(win + lose > 0 ? win / (win + lose) : 0), fair_american: fairAmerican(win + lose > 0 ? win / (win + lose) : 0) };
  // The books' no-vig chance for the same bet, when it is the market's own
  // moneyline, spread or total.
  const B = fc.book, M = fc.market;
  let book = null;
  if (B && market === 'moneyline' && B.home_win != null) book = who === 'home' ? B.home_win : 1 - B.home_win;
  else if (B && M && market === 'spread' && B.home_cover != null && Math.abs((who === 'home' ? -line : line) - M.home_margin) < 1e-9) book = who === 'home' ? B.home_cover : 1 - B.home_cover;
  else if (B && M && market === 'total' && B.over != null && Math.abs(line - M.total) < 1e-9) book = String(bet.side).toLowerCase() === 'over' ? B.over : 1 - B.over;
  if (book != null) { out.book_chance = r4(book); out.gap = r4(out.chance - book); }
  const price = bet.price == null || bet.price === '' ? null : Number(bet.price);
  if (price != null) {
    if (!Number.isFinite(price) || (price > -100 && price < 100) || Math.abs(price) > 100000) return { ...out, error: 'price must be American odds like -110 or +150' };
    const dec = price > 0 ? 1 + price / 100 : 1 + 100 / -price;
    out.price = price;
    out.breakeven = r4(1 / dec);
    out.ev_per_dollar = r4(win * (dec - 1) - lose);
  }
  return out;
}
export function fairAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

// A short ladder of every market for the page and the MCP: moneyline, the
// market spread (or the expected margin rounded to a half point), win-by
// rungs for each team, the game total and team totals at the market or
// expected numbers and a few steps either side.
export function teamBetLadder(fc, game, sport) {
  if (!fc) return null;
  const cfg = CFG[sport] || CFG.nba;
  const half = (x) => Math.round(x - 0.5) + 0.5;
  const sp = fc.market ? fc.market.home_margin : half(fc.expected.home_margin);
  const tl = fc.market ? fc.market.total : half(fc.expected.total);
  const tstep = sport === 'nfl' ? 3 : 5, step = sport === 'nfl' ? 3 : 5;
  const rows = [];
  rows.push(priceTeamBet(fc, game, { market: 'moneyline', team: 'home' }), priceTeamBet(fc, game, { market: 'moneyline', team: 'away' }));
  rows.push(priceTeamBet(fc, game, { market: 'spread', team: 'home', line: -sp }), priceTeamBet(fc, game, { market: 'spread', team: 'away', line: sp }));
  for (const X of cfg.alt.slice(1)) for (const team of ['home', 'away']) rows.push(priceTeamBet(fc, game, { market: 'win_by', team, line: X }));
  for (const t of [tl - 2 * tstep, tl - tstep, tl, tl + tstep, tl + 2 * tstep]) rows.push(priceTeamBet(fc, game, { market: 'total', side: 'over', line: t }));
  const hl = half(fc.expected.home_points), al = half(fc.expected.away_points);
  for (const [team, l] of [['home', hl], ['away', al]]) for (const t of [l - step, l, l + step]) rows.push(priceTeamBet(fc, game, { market: 'team_total', team, side: 'over', line: t }));
  return rows.filter((r) => !r.error);
}

// Status line for the Model check card and the MCP: one entry per market.
export function teamModelSummary(model) {
  if (!model) return null;
  if (model.status !== 'ok') return { version: model.version, status: model.status, games: model.games ?? 0 };
  const markets = Object.fromEntries(Object.entries(model.check?.markets || {}).map(([k, v]) => [k, { status: v.status, n: v.n, ece: v.ece ?? null, ece_luck: v.ece_luck ?? null, slope: v.slope ?? null, brier: v.brier ?? null, baseline: v.baseline || null, reliability: v.reliability || [] }]));
  return { version: model.version, status: 'ok', fitted_utc: model.fitted_utc, games: model.games, seasons: model.seasons, params: model.params, blend: model.blend, sd: model.sd, held_out: model.check ? { games: model.check.games, from: model.check.from, mean_miss: model.check.mean_miss } : null, markets };
}

// Normal scores of every final game's results on the served model's own
// curves (walk-forward ratings: each game is predicted only from the games
// before it), for the same-game links between game bets and player lines
// (lib/sports/joint.mjs fitJoint). Each game gives the home and away team's
// margin (one number, seen from each side), each team's points and the
// game total, in fitJoint's record shape. `split`: games from this date on
// also carry the chance of clearing a stand-in line (the expected value on
// the half point) and whether it did, for the check on later games.
export function teamJointRecords({ sport, games, model, split = null }) {
  if (!model || model.status !== 'ok' || !CFG[sport]) return [];
  const sorted = (Array.isArray(games) ? games : []).filter((g) => g && g.start_utc && g.home_team && g.away_team && g.status !== 'canceled' && g.status !== 'postponed')
    .slice().sort((a, b) => a.start_utc.localeCompare(b.start_utc) || String(a.game_id).localeCompare(String(b.game_id)));
  const fit = { params: model.params, blend: model.blend, sd: model.sd, weights: model.weights };
  const { preds } = runRatings(sport, sorted, model.params);
  const out = [];
  const cdf = (pmf, x) => { let s = 0; for (let i = 0; i < pmf.p.length && pmf.start + i <= x; i++) s += pmf.p[i]; return Math.min(1, s); };
  const zOf = (pmf, x) => invNormSafe((cdf(pmf, x - 1) + cdf(pmf, x)) / 2);
  for (const x of preds.slice(CFG[sport].warmup)) {
    const g = x.g, means = meansOf(x, fit), d = gameDists(fit, means, x.early);
    if (!d.margin || !d.total || !d.home || !d.away) continue;
    const m = g.home_score - g.away_score, t = g.home_score + g.away_score;
    const zm = zOf(d.margin, m), zt = zOf(d.total, t), zh = zOf(d.home, g.home_score), za = zOf(d.away, g.away_score);
    const date = dateOf(g), later = split != null && date >= split;
    const rec = (stat, team, pid, z, pmf, mu, value, flip) => {
      const r = { stat, game_id: g.game_id, team, player_id: pid, z };
      if (split != null && !later) r.zTrain = z;
      if (later) {
        const line = Math.round(mu) + 0.5, over = pmfChances(pmf, line).over;
        r.pTest = flip ? 1 - over : over;
        r.y = flip ? (value < line ? 1 : 0) : (value > line ? 1 : 0);
      }
      return r;
    };
    out.push(
      rec('team_margin', g.home_team, 'team:' + g.home_team, zm, d.margin, means.margin, m, false),
      rec('team_margin', g.away_team, 'team:' + g.away_team, -zm, d.margin, means.margin, m, true),
      rec('team_points', g.home_team, 'team:' + g.home_team, zh, d.home, (means.total + means.margin) / 2, g.home_score, false),
      rec('team_points', g.away_team, 'team:' + g.away_team, za, d.away, (means.total - means.margin) / 2, g.away_score, false),
      rec('game_total', null, 'game:' + g.game_id, zt, d.total, means.total, t, false),
    );
  }
  return out;
}
const invNormSafe = (p) => invNorm(Math.min(1 - 1e-9, Math.max(1e-9, p)));

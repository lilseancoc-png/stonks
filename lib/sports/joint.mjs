// Same-game chances for the Owner Sports Pick Builder (roadmap V4 §5.3).
// Deterministic and AI-free.
//
// Picks from one game move together: a fast game lifts both teams' points,
// a player who plays more minutes gets more points AND more rebounds, two
// teammates share one ball. Multiplying their chances would be wrong, so the
// site measures how much they move together and prices them with that.
//
// The measure: every scored forecast in the stat model (models.mjs) leaves a
// miss, turned into a normal score (where the result fell on the forecast's
// own curve). For each kind of pair in one game (same player, teammates,
// opponents; for each two stats) the link is the correlation of those normal
// scores. That link already holds the shared conditions the roadmap lists
// (pace, minutes, game script, shared targets), measured from the games
// rather than simulated play by play.
//
// The price: a Gaussian copula. Each pick wins when its own normal score
// lands past the point that gives the chance the owner entered; the scores
// are drawn together with the measured links (seeded simulation, 100,000
// draws). That gives the chance all picks win and the chance of exactly k
// wins for flex. The range re-runs the same draws with every link at the
// low and the high end of its 95% interval (a higher link between two
// winning sides always raises the all-win chance), and it never leaves the
// bounds that hold under any link.
//
// The check: the links are fitted on the earlier 60% of days and scored on
// the later 40% (the same split as the stat model). For each later pair the
// copula's four outcomes (both cleared their stand-in line, only one, none)
// are scored against treating the two as unrelated. A link is validated
// only with 300+ later pairs, a score no worse than independence, and a
// both-cleared rate within 2 points of what happened. (A link near zero can
// pass: then the check says treating that kind of pair as unrelated was
// right on later games.)
import { invNorm, bvnUpper, seededNormals, seedOf } from './normal.mjs';
import { jointBounds, payoutValue } from './payout.mjs';

export const JOINT_VERSION = 'sports-joint-1';
export const JOINT_METHOD = 'gaussian-copula';
export const RELATIONS = Object.freeze(['same_player', 'teammate', 'opponent']);
export const JOINT_DRAWS = 100000;
const MIN_LINK_GAMES = 30;
const MIN_TEST_PAIRS = 300;
const BOTH_TOLERANCE = 0.02;
const MAX_LINK = 0.9;
const Z95 = 1.959963984540054;

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const clampLink = (r) => Math.max(-MAX_LINK, Math.min(MAX_LINK, r));

export function relationOf(a, b) {
  if (a.player_id === b.player_id) return 'same_player';
  return a.team === b.team ? 'teammate' : 'opponent';
}
export function linkKey(statA, statB, relation) {
  const [x, y] = [statA, statB].sort();
  return x + '|' + y + '|' + relation;
}

// ---- Fitting -----------------------------------------------------------------
function sums() { return { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, games: 0 }; }
function addPair(s, x, y) { s.n += 1; s.sx += x; s.sy += y; s.sxx += x * x; s.syy += y * y; s.sxy += x * y; }
function pearson(s) {
  if (s.n < 3) return null;
  const mx = s.sx / s.n, my = s.sy / s.n;
  const vx = s.sxx / s.n - mx * mx, vy = s.syy / s.n - my * my;
  return vx > 0 && vy > 0 ? (s.sxy / s.n - mx * my) / Math.sqrt(vx * vy) : null;
}
// The 95% interval of a link (Fisher's z), counting games rather than pairs:
// pairs from one game share players, so this errs wide.
export function linkInterval(rho, games) {
  if (!(games > 3)) return { low: -MAX_LINK, high: MAX_LINK };
  const z = Math.atanh(clampLink(rho)), se = 1 / Math.sqrt(games - 3);
  return { low: round(clampLink(Math.tanh(z - Z95 * se))), high: round(clampLink(Math.tanh(z + Z95 * se))) };
}

// Calls fn(key, first, second, symmetric) for every pair in one game, with
// the two records in the key's stat order.
function eachPair(list, fn) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.player_id === b.player_id && a.stat === b.stat) continue;
      const key = linkKey(a.stat, b.stat, relationOf(a, b));
      if (a.stat === b.stat) fn(key, a, b, true);
      else if (a.stat < b.stat) fn(key, a, b, false);
      else fn(key, b, a, false);
    }
  }
}

// records: one per scored forecast, from buildModel:
//   { stat, game_id, team, player_id, z, zTrain?, pTest?, y? }
// z: normal score of the result on the final model; zTrain: the same on the
// model fitted to the earlier days (train days only); pTest / y: the
// holdout chance of clearing the stand-in line and whether it did (later
// days only).
export function fitJoint(records) {
  const byGame = new Map();
  for (const r of records) {
    if (!r || r.game_id == null || !Number.isFinite(r.z)) continue;
    let list = byGame.get(r.game_id);
    if (!list) byGame.set(r.game_id, (list = []));
    list.push(r);
  }
  const keys = new Map();
  const slot = (key) => {
    let s = keys.get(key);
    if (!s) keys.set(key, (s = { all: sums(), train: sums(), test: { pairs: 0, games: 0, bc: 0, bi: 0, both: 0, qc: 0, qi: 0 }, seenAll: null, seenTrain: null, seenTest: null }));
    return s;
  };
  // Pass 1: every pair's normal scores.
  for (const [game, list] of byGame) {
    eachPair(list, (key, a, b, sym) => {
      const s = slot(key);
      addPair(s.all, a.z, b.z);
      if (sym) addPair(s.all, b.z, a.z);
      if (s.seenAll !== game) { s.all.games += 1; s.seenAll = game; }
      if (Number.isFinite(a.zTrain) && Number.isFinite(b.zTrain)) {
        addPair(s.train, a.zTrain, b.zTrain);
        if (sym) addPair(s.train, b.zTrain, a.zTrain);
        if (s.seenTrain !== game) { s.train.games += 1; s.seenTrain = game; }
      }
    });
  }
  const trainLink = new Map();
  for (const [key, s] of keys) { const r = pearson(s.train); if (r != null && s.train.games >= MIN_LINK_GAMES) trainLink.set(key, clampLink(r)); }
  // Pass 2: score the later pairs with the link fitted on earlier days.
  for (const [game, list] of byGame) {
    eachPair(list, (key, a, b) => {
      if (!trainLink.has(key) || !(a.pTest > 0 && a.pTest < 1) || !(b.pTest > 0 && b.pTest < 1)) return;
      const s = keys.get(key), T = s.test;
      const both = bvnUpper(invNorm(1 - a.pTest), invNorm(1 - b.pTest), trainLink.get(key));
      const indep = a.pTest * b.pTest;
      const obs = [a.y && b.y, a.y && !b.y, !a.y && b.y, !a.y && !b.y].map((v) => (v ? 1 : 0));
      const cells = (q) => [q, a.pTest - q, b.pTest - q, 1 - a.pTest - b.pTest + q];
      T.bc += cells(both).reduce((t, q, i) => t + (q - obs[i]) ** 2, 0);
      T.bi += cells(indep).reduce((t, q, i) => t + (q - obs[i]) ** 2, 0);
      T.both += obs[0]; T.qc += both; T.qi += indep; T.pairs += 1;
      if (s.seenTest !== game) { T.games += 1; s.seenTest = game; }
    });
  }
  const pairs = {};
  for (const key of [...keys.keys()].sort()) {
    const s = keys.get(key), rho = pearson(s.all);
    if (rho == null || s.all.games < MIN_LINK_GAMES) continue;
    const [x, y, relation] = key.split('|');
    const sym = x === y, T = s.test;
    const test = T.pairs ? {
      pairs: T.pairs, games: T.games,
      brier: { copula: round(T.bc / T.pairs, 5), independent: round(T.bi / T.pairs, 5) },
      both_cleared: { observed: round(T.both / T.pairs), copula: round(T.qc / T.pairs), independent: round(T.qi / T.pairs) },
    } : null;
    let reason = null;
    if (!test || test.pairs < MIN_TEST_PAIRS) reason = 'fewer than 300 later pairs to check';
    else if (T.bc > T.bi) reason = 'scored worse than treating the picks as unrelated';
    else if (Math.abs(test.both_cleared.copula - test.both_cleared.observed) > BOTH_TOLERANCE) reason = 'the both-cleared rate was off by more than 2 points';
    pairs[key] = {
      stats: [x, y], relation,
      link: round(clampLink(rho)), interval: linkInterval(rho, s.all.games),
      link_train: trainLink.has(key) ? round(trainLink.get(key)) : null,
      games: s.all.games, pairs: sym ? s.all.n / 2 : s.all.n,
      status: reason ? 'experimental' : 'validated', reason, test,
    };
  }
  return { version: JOINT_VERSION, method: JOINT_METHOD, pairs };
}

// ---- Pricing one entry ------------------------------------------------------------
// Lower-triangular L with L·Lᵀ = R. A matrix that is not a valid correlation
// (links measured separately need not fit together) is pulled toward
// independence until it is.
export function choleskyOf(R) {
  const n = R.length;
  for (let shrink = 1, tries = 0; tries < 60; tries++, shrink *= 0.95) {
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = i === j ? 1 : R[i][j] * shrink;
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (s <= 1e-9) { ok = false; break; } L[i][i] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    if (ok) return { L, shrink: round(shrink, 4) };
  }
  return { L: R.map((_, i) => R.map((__, j) => (i === j ? 1 : 0))), shrink: 0 };
}

// One game's picks: exactly-k distribution at the measured links, and the
// all-win chance with every link at its low and high end (same draws).
export function simulateGroup({ legs, links, draws = JOINT_DRAWS, seed }) {
  const n = legs.length;
  const sign = legs.map((l) => (l.side === 'under' ? -1 : 1));
  const cut = legs.map((l) => invNorm(1 - l.probability));
  const matrix = (pick) => legs.map((_, i) => legs.map((__, j) => {
    if (i === j) return 1;
    const lk = links[i < j ? i + ',' + j : j + ',' + i];
    const s = sign[i] * sign[j];
    // In win-direction terms; a higher value always helps every pick win together.
    return pick === 'mid' ? s * lk.link : s > 0 ? (pick === 'low' ? lk.interval.low : lk.interval.high) : -(pick === 'low' ? lk.interval.high : lk.interval.low);
  }));
  const mid = choleskyOf(matrix('mid')), lo = choleskyOf(matrix('low')), hi = choleskyOf(matrix('high'));
  const normal = seededNormals(seed);
  const dist = new Array(n + 1).fill(0);
  let allMid = 0, allLo = 0, allHi = 0;
  const e = new Array(n);
  const wins = (L) => {
    let k = 0;
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (let j = 0; j <= i; j++) w += L[i][j] * e[j];
      if (w > cut[i]) k++;
    }
    return k;
  };
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < n; i++) e[i] = normal();
    const k = wins(mid.L);
    dist[k] += 1;
    if (k === n) allMid += 1;
    if (wins(lo.L) === n) allLo += 1;
    if (wins(hi.L) === n) allHi += 1;
  }
  return {
    distribution: dist.map((c) => c / draws),
    all: allMid / draws, low: Math.min(allLo, allMid) / draws, high: Math.max(allHi, allMid) / draws,
    adjusted: mid.shrink < 1,
  };
}

function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return out;
}

// Plain-language name of a link, for the page and saved entries.
export function linkLabel(stats, relation) {
  const [a, b] = stats;
  const who = relation === 'same_player' ? 'one player' : relation === 'teammate' ? 'teammates' : 'opponents';
  return (a === b ? a : a + ' and ' + b).replace(/_/g, ' ') + ', ' + who;
}

// The joint price of an entry with same-game picks, or why there is none.
// legs: enriched legs (sport, stat, side, player_id, team, game_id,
// probability, model.regular_role); groups: sameGameGroups(legs);
// joints: { nba: model.joint, nfl: model.joint }; asOf: { nba: date, ... }.
export function jointEvaluation({ legs, groups, joints, asOf = {}, versions = {}, stake, format, payouts, draws = JOINT_DRAWS }) {
  const n = legs.length;
  const no = (detail) => ({ status: 'not_calculated', reason: 'same_game', detail, method: JOINT_METHOD });
  const links = [];
  for (const g of groups) {
    const sport = legs[g.legs[0]].sport, joint = joints[sport];
    if (!joint?.pairs) return no('The same-game links have not been measured yet; the next daily data run measures them.');
    for (let x = 0; x < g.legs.length; x++) {
      for (let y = x + 1; y < g.legs.length; y++) {
        const i = g.legs[x], j = g.legs[y], a = legs[i], b = legs[j];
        if (!a.team || !b.team || a.team_in_game === false || b.team_in_game === false) return no('A player’s team in this game is not known from the stored logs.');
        const relation = relationOf(a, b), key = linkKey(a.stat, b.stat, relation);
        const lk = joint.pairs[key];
        if (!lk || !Number.isFinite(lk.link) || !lk.interval) return no('There is no measured link yet for ' + linkLabel(key.split('|'), relation) + '.');
        links.push({ group: g, i, j, key, relation, stats: lk.stats, link: lk.link, interval: lk.interval, status: lk.status });
      }
    }
  }
  const grouped = new Set(groups.flatMap((g) => g.legs));
  const seedText = JSON.stringify([JOINT_VERSION, legs.map((l) => [l.sport, l.stat, l.side, l.probability, l.player_id, l.team]), links.map((l) => [l.i, l.j, l.link])]);
  const seed = seedOf(seedText);
  let dist = [1], low = 1, high = 1, adjusted = false;
  groups.forEach((g, gi) => {
    const local = {};
    links.filter((l) => l.group === g).forEach((l) => { local[g.legs.indexOf(l.i) + ',' + g.legs.indexOf(l.j)] = l; });
    const sim = simulateGroup({ legs: g.legs.map((i) => legs[i]), links: local, draws, seed: (seed + gi * 7919) >>> 0 });
    dist = convolve(dist, sim.distribution);
    low *= sim.low; high *= sim.high;
    adjusted = adjusted || sim.adjusted;
  });
  legs.forEach((l, i) => {
    if (grouped.has(i)) return;
    dist = convolve(dist, [1 - l.probability, l.probability]);
    low *= l.probability; high *= l.probability;
  });
  const ps = legs.map((l) => l.probability);
  const bounds = jointBounds(ps);
  const value = payoutValue({ stake, payouts, distribution: dist });
  const all = payouts[n];
  const sportsIn = [...new Set(groups.map((g) => legs[g.legs[0]].sport))];
  const regular = [...grouped].every((i) => legs[i].model?.regular_role === true);
  const validated = links.every((l) => l.status === 'validated') && regular;
  const out = {
    status: 'joint_estimate',
    quality: validated ? 'validated' : 'experimental',
    quality_reason: validated ? null : !regular ? 'the links were measured on players in a regular role, and a player here has no regular-role forecast' : 'a link did not pass its check on later games',
    method: JOINT_METHOD,
    joint_version: JOINT_VERSION,
    model_version: sportsIn.map((s) => versions[s]).filter(Boolean).join(', ') || null,
    as_of_date: sportsIn.map((s) => asOf[s]).filter(Boolean).sort()[0] || null,
    joint_probability: round(dist[n], 6),
    range: { low: round(Math.max(bounds.low, Math.min(low, dist[n])), 6), high: round(Math.min(bounds.high, Math.max(high, dist[n])), 6) },
    independent_probability: round(ps.reduce((a, b) => a * b, 1), 6),
    bounds: { low: round(bounds.low, 6), high: round(bounds.high, 6) },
    distribution: dist.map((v) => round(v, 6)),
    breakeven_probability: format === 'power' && all > 0 ? round(1 / all, 6) : null,
    ...value,
    links: links.map((l) => ({ legs: [l.i, l.j], relation: l.relation, stats: l.stats, link: l.link, low: l.interval.low, high: l.interval.high, status: l.status })),
    simulation: { draws, seed, adjusted },
  };
  if (format === 'power' && all > 0) out.expected_net_range = { low: round(stake * (out.range.low * all - 1), 2), high: round(stake * (out.range.high * all - 1), 2) };
  return out;
}

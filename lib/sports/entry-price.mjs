// The price of one Pick Builder entry, any mix of player lines and game bets
// (owner ask 2026-11-12). Deterministic and AI-free.
//
// Every pick has three outcomes: it wins, pushes (a whole-number line landing
// exactly) or loses. Picks from different games are independent. Picks from
// one game are drawn together (Gaussian copula, seeded, 100,000 draws) with
// the links measured on past games (lib/sports/joint.mjs). Each pick reads
// one game number (lib/sports/bets.mjs latentOf): a player's stat, the home
// team's margin, the game total or a team's points. Picks on the SAME number
// share one draw, so "LAL to win" and "LAL −5.5" are priced exactly as one
// margin, not as two linked guesses.
//
// The result is the chance of every combination of outcomes (at most 3^6),
// from which each entry type is paid:
//   power / flex  pick'em payout table by the number of picks that won
//   parlay        sportsbook or prediction-market odds: a loss loses all, a
//                 push drops that pick (its odds become 1), and with only one
//                 price for the whole parlay a push is counted as the stake
//                 back (the app's own rule settles it).
import { invNorm, normCdf, seededNormals, seedOf } from './normal.mjs';
import { relationOf, linkKey, choleskyOf, linkLabel, JOINT_METHOD, JOINT_DRAWS } from './joint.mjs';
import { jointBounds } from './payout.mjs';
import { fairOdds, edgeOf } from './bets.mjs';

// The seed text keeps the first pricing version's tag, so a player-only entry
// draws exactly the numbers it drew before game bets were added.
const SEED_TAG = 'sports-joint-1';
const round = (x, d = 6) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const clampP = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const WIN = 2, PUSH = 1, LOSE = 0;

// The cut points of one pick on its oriented number w (w = z when the
// number's first pick wins high, else −z). `same`: this pick wins on the same
// side as that first pick.
function cutsOf(leg, same) {
  const pW = clampP(leg.probability), pP = Math.max(0, Math.min(1 - pW, leg.push || 0));
  if (same) return { same, win: invNorm(1 - pW), push: pP > 0 ? invNorm(clampP(1 - pW - pP)) : null };
  return { same, win: invNorm(pW), push: pP > 0 ? invNorm(clampP(pW + pP)) : null };
}
function outcomeAt(c, w) {
  if (c.same) return w > c.win ? WIN : c.push != null && w > c.push ? PUSH : LOSE;
  return w < c.win ? WIN : c.push != null && w < c.push ? PUSH : LOSE;
}

// One game's picks: the numbers they read, the links between those numbers,
// the outcome table at the measured links and the all-win chance with every
// link at the low and the high end of its 95% interval (same draws).
function simulateGame({ legs, idx, joint, draws, seed }) {
  const lat = [], latOf = [];
  for (const i of idx) {
    const L = legs[i].latent;
    let u = lat.findIndex((x) => x.id === L.id);
    if (u < 0) { u = lat.length; lat.push({ id: L.id, entity: L.entity, up: L.up, first: i }); }
    latOf.push(u);
  }
  const m = lat.length, links = [], missing = [];
  const mat = { mid: [], low: [], high: [] };
  for (const k of Object.keys(mat)) for (let a = 0; a < m; a++) mat[k].push(new Array(m).fill(0).map((_, b) => (a === b ? 1 : 0)));
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const A = lat[a], B = lat[b];
      const relation = relationOf(A.entity, B.entity), key = linkKey(A.entity.stat, B.entity.stat, relation);
      const lk = joint?.pairs?.[key];
      const legsAB = [A.first, B.first];
      if (!lk || !Number.isFinite(lk.link) || !lk.interval) { missing.push({ legs: legsAB, key, relation, label: linkLabel(key.split('|'), relation) }); continue; }
      const s = (A.up ? 1 : -1) * (B.up ? 1 : -1);
      mat.mid[a][b] = mat.mid[b][a] = s * lk.link;
      // In win-direction terms; a higher value always helps every pick win together.
      const lo = s > 0 ? lk.interval.low : -lk.interval.high, hi = s > 0 ? lk.interval.high : -lk.interval.low;
      mat.low[a][b] = mat.low[b][a] = lo;
      mat.high[a][b] = mat.high[b][a] = hi;
      links.push({ legs: legsAB, key, relation, stats: lk.stats, link: lk.link, interval: lk.interval, status: lk.status });
    }
  }
  const cuts = idx.map((i, k) => cutsOf(legs[i], legs[i].latent.up === lat[latOf[k]].up));
  const shared = [];
  for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) if (latOf[x] === latOf[y]) shared.push([idx[x], idx[y]]);
  // Every pick reads the same number: no link and no simulation, the exact
  // chance of each stretch of that number.
  if (m === 1) {
    const pts = [...new Set(cuts.flatMap((c) => [c.win, c.push]).filter((v) => v != null && Number.isFinite(v)))].sort((a, b) => a - b);
    const edges = [-Infinity, ...pts, Infinity], table = new Map();
    let all = 0;
    for (let k = 0; k + 1 < edges.length; k++) {
      const a = edges[k], b = edges[k + 1], p = normCdf(b) - normCdf(a);
      if (!(p > 0)) continue;
      const w0 = a === -Infinity ? b - 1 : b === Infinity ? a + 1 : (a + b) / 2;
      const code = cuts.map((c) => outcomeAt(c, w0)).join('');
      table.set(code, (table.get(code) || 0) + p);
      if (!/[01]/.test(code)) all += p;
    }
    return { table, lowTable: table, highTable: table, all, low: all, high: all, links, missing, shared, adjusted: false, exact: true };
  }
  const mid = choleskyOf(mat.mid), lo = choleskyOf(mat.low), hi = choleskyOf(mat.high);
  const normal = seededNormals(seed);
  const e = new Array(m), w = new Array(m);
  const counts = new Map(), lowCounts = new Map(), highCounts = new Map();
  let allMid = 0, allLo = 0, allHi = 0;
  const fill = (L) => { for (let a = 0; a < m; a++) { let s = 0; for (let b = 0; b <= a; b++) s += L[a][b] * e[b]; w[a] = s; } };
  const record = (table) => {
    let code = '';
    for (let k = 0; k < idx.length; k++) code += outcomeAt(cuts[k], w[latOf[k]]);
    table.set(code, (table.get(code) || 0) + 1);
    return !code.includes('0') && !code.includes('1');
  };
  for (let d = 0; d < draws; d++) {
    for (let a = 0; a < m; a++) e[a] = normal();
    fill(mid.L);
    if (record(counts)) allMid++;
    fill(lo.L); if (record(lowCounts)) allLo++;
    fill(hi.L); if (record(highCounts)) allHi++;
  }
  const normalize = (table) => new Map([...table].map(([c, n]) => [c, n / draws]));
  return { table: normalize(counts), lowTable: normalize(lowCounts), highTable: normalize(highCounts), all: allMid / draws, low: Math.min(allLo, allMid) / draws, high: Math.max(allHi, allMid) / draws, links, missing, shared, adjusted: mid.shrink < 1 };
}

// legs: each { sport, game_id, kind, probability, push, latent, team,
// team_in_game, model }, every probability present. groups: sameGameGroups.
// joints: { nba, nfl } the stored `joint` blocks.
export function priceOutcomes({ legs, groups, joints, draws = JOINT_DRAWS }) {
  const n = legs.length;
  const grouped = new Set(groups.flatMap((g) => g.legs));
  const unknownTeam = groups.some((g) => g.legs.some((i) => legs[i].kind !== 'team' && (!legs[i].team || legs[i].team_in_game === false)));
  // Seed: the same text the player-only pricing used, so those entries keep
  // their numbers; game bets add their own fields.
  const pairList = [];
  for (const g of groups) {
    const joint = joints[legs[g.legs[0]].sport];
    for (let x = 0; x < g.legs.length; x++) for (let y = x + 1; y < g.legs.length; y++) {
      const A = legs[g.legs[x]].latent, B = legs[g.legs[y]].latent;
      const lk = A.id === B.id ? { link: 1 } : joint?.pairs?.[linkKey(A.entity.stat, B.entity.stat, relationOf(A.entity, B.entity))];
      pairList.push([g.legs[x], g.legs[y], lk && Number.isFinite(lk.link) ? lk.link : null]);
    }
  }
  const seedText = JSON.stringify([SEED_TAG, legs.map((l) => (l.kind === 'team' ? [l.sport, l.market, l.side, l.probability, 'team', l.team, l.line, l.push || 0] : [l.sport, l.stat, l.side, l.probability, l.player_id, l.team])), pairList]);
  const seed = seedOf(seedText);
  const factors = [], links = [], missing = [], shared = [];
  let low = 1, high = 1, adjusted = false;
  groups.forEach((g, gi) => {
    const sim = simulateGame({ legs, idx: g.legs, joint: joints[legs[g.legs[0]].sport], draws, seed: (seed + gi * 7919) >>> 0 });
    factors.push({ idx: g.legs, table: sim.table, lowTable: sim.lowTable, highTable: sim.highTable });
    links.push(...sim.links); missing.push(...sim.missing); shared.push(...sim.shared);
    low *= sim.low; high *= sim.high; adjusted = adjusted || sim.adjusted;
  });
  legs.forEach((l, i) => {
    if (grouped.has(i)) return;
    const pW = l.probability, pP = Math.max(0, Math.min(1 - pW, l.push || 0));
    const table = new Map([['2', pW], ['1', pP], ['0', Math.max(0, 1 - pW - pP)]].filter(([, p]) => p > 0));
    factors.push({ idx: [i], table, lowTable: table, highTable: table });
    low *= pW; high *= pW;
  });
  // Every combination: the product of the independent games.
  const combine = (key) => {
    let outcomes = new Map([[new Array(n).fill('-').join(''), 1]]);
    for (const f of factors) {
      const next = new Map();
      for (const [code, p] of outcomes) {
        for (const [part, q] of f[key]) {
          const arr = code.split('');
          f.idx.forEach((i, k) => { arr[i] = part[k]; });
          const c = arr.join('');
          next.set(c, (next.get(c) || 0) + p * q);
        }
      }
      outcomes = next;
    }
    return outcomes;
  };
  return { outcomes: combine('table'), outcomesLow: combine('lowTable'), outcomesHigh: combine('highTable'), range: { low, high }, links, missing, shared, unknownTeam, adjusted, seed, draws };
}

// Money and chances from an outcome table. `prices`: each pick's decimal
// odds (parlay with per-pick odds), else null.
export function valueOutcomes({ outcomes, n, stake, format, payouts, prices }) {
  const wins = new Array(n + 1).fill(0);
  let allWin = 0, noLoss = 0, gross = 0;
  const perPick = format === 'parlay' && Array.isArray(prices) && prices.length === n && prices.every((d) => d > 1);
  const combo = format === 'parlay' && !perPick ? payouts[n] : null;
  for (const [code, p] of outcomes) {
    const k = [...code].filter((c) => c === '2').length;
    wins[k] += p;
    const lost = code.includes('0');
    if (k === n) allWin += p;
    if (!lost) noLoss += p;
    if (format === 'parlay') {
      if (lost) continue;
      if (perPick) gross += p * [...code].reduce((a, c, i) => a * (c === '2' ? prices[i] : 1), 1);
      else gross += p * (k === n ? combo || 0 : 1);
    } else gross += p * (payouts[k] || 0);
  }
  const total = gross * stake;
  return {
    distribution: wins.map((v) => round(v)),
    all_win: allWin, push_no_loss: noLoss - allWin,
    expected_gross: round(total, 2), expected_net: round(total - stake, 2), expected_roi: round((total - stake) / stake, 4),
  };
}

// The whole evaluation block for an entry whose picks all have a chance.
// `quality` inputs: each same-game link's status and the players' roles.
export function evaluateOutcomes({ legs, groups, joints, asOf = {}, versions = {}, stake, format, payouts, prices = null, draws = JOINT_DRAWS }) {
  const n = legs.length;
  const priced = priceOutcomes({ legs, groups, joints, draws });
  const value = valueOutcomes({ outcomes: priced.outcomes, n, stake, format, payouts, prices });
  const ps = legs.map((l) => l.probability);
  const bounds = jointBounds(ps);
  const indep = ps.reduce((a, b) => a * b, 1);
  // What the app pays when every pick wins: the payout table's top row, or
  // the parlay's odds (the picks' odds multiplied, or the one typed in).
  const offered = format === 'parlay' && Array.isArray(prices) && prices.every((d) => d > 1) ? prices.reduce((a, b) => a * b, 1) : payouts[n] || null;
  const odds = {
    fair: fairOdds(value.all_win),
    fair_if_unrelated: fairOdds(indep),
    offered: offered > 0 ? { decimal: round(offered, 3), ...(fairOdds(1 / offered) ? { american: fairOdds(1 / offered).american, cents: fairOdds(1 / offered).cents } : {}) } : null,
    // Expected profit per $1. A parlay counts its pushes (a pushed pick drops
    // out); a power entry counts a push as a miss, as its payout table does.
    edge: offered > 1 && format !== 'flex' ? (format === 'parlay' ? value.expected_roi : edgeOf(value.all_win, offered)) : null,
  };
  const base = {
    joint_probability: round(value.all_win),
    independent_probability: round(indep),
    bounds: { low: round(bounds.low), high: round(bounds.high) },
    distribution: value.distribution,
    push_chance: round(value.push_no_loss),
    breakeven_probability: format !== 'flex' && offered > 0 ? round(1 / offered) : null,
    expected_gross: value.expected_gross, expected_net: value.expected_net, expected_roi: value.expected_roi,
    odds,
  };
  if (!groups.length) return { status: 'independence_baseline', method: 'independent', ...base };
  const sportsIn = [...new Set(groups.map((g) => legs[g.legs[0]].sport))];
  const shared = priced.shared.map(([a, b]) => ({ legs: [a, b] }));
  const linkOut = priced.links.map((l) => ({ legs: l.legs, relation: l.relation, stats: l.stats, link: l.link, low: l.interval.low, high: l.interval.high, status: l.status }));
  if (priced.unknownTeam || priced.missing.length) {
    // A pair with no measured link: no combined chance, only what holds
    // under any link and the "if unrelated" figure, both labeled.
    const all = payouts[n] || offered;
    return {
      status: 'not_calculated', reason: 'same_game', method: JOINT_METHOD,
      detail: priced.unknownTeam ? 'A player’s team in this game is not known from the stored logs.' : 'There is no measured link yet for ' + priced.missing.map((m) => m.label).filter((v, i, a) => a.indexOf(v) === i).join('; ') + '.',
      missing_links: priced.missing.map((m) => ({ legs: m.legs, relation: m.relation, stats: m.key.split('|').slice(0, 2) })),
      independent_probability: base.independent_probability, bounds: base.bounds, breakeven_probability: base.breakeven_probability,
      odds: { fair_if_unrelated: odds.fair_if_unrelated, offered: odds.offered },
      // All-win bounds alone cannot bound a parlay's return when pushes pay
      // out a smaller entry. Leave that range absent until links are known.
      ...(format !== 'flex' && all > 0 && !(format === 'parlay' && legs.some(l => l.push > 0)) ? { expected_net_range: { low: round(stake * (bounds.low * all - 1), 2), high: round(stake * (bounds.high * all - 1), 2) } } : {}),
      links: linkOut, shared_numbers: shared,
    };
  }
  const groupedLegs = groups.flatMap((g) => g.legs);
  const regular = groupedLegs.every((i) => legs[i].kind === 'team' || legs[i].model?.regular_role === true);
  const validated = priced.links.every((l) => l.status === 'validated') && regular;
  // Simulation noise can step a hair outside what holds under any link
  // (nested picks on one number); the shown numbers stay inside it.
  const inB = (x) => Math.max(bounds.low, Math.min(bounds.high, x));
  const allWin = inB(value.all_win);
  base.joint_probability = round(allWin);
  const range = { low: round(Math.min(allWin, inB(priced.range.low))), high: round(Math.max(allWin, inB(priced.range.high))) };
  const out = {
    status: 'joint_estimate',
    quality: validated ? 'validated' : 'experimental',
    quality_reason: validated ? null : !regular ? 'the links were measured on players in a regular role, and a player here has no regular-role forecast' : 'a link did not pass its check on later games',
    method: JOINT_METHOD,
    model_version: sportsIn.map((s) => versions[s]).filter(Boolean).join(', ') || null,
    as_of_date: sportsIn.map((s) => asOf[s]).filter(Boolean).sort()[0] || null,
    ...base,
    range,
    links: linkOut,
    shared_numbers: shared,
    simulation: { draws: priced.draws, seed: priced.seed, adjusted: priced.adjusted },
  };
  if (format === 'flex' || offered > 0) {
    // Price every outcome at each link endpoint, including payouts after a
    // pushed pick drops out. Multiplying only the all-win chance omitted
    // those returns and could put the estimate outside its own range. Flex
    // pays on every row of its table, so it is priced the same way
    // (2026-11-13; before, a same-game flex entry showed no range).
    const values = [value.expected_net, ...[priced.outcomesLow, priced.outcomesHigh].map(outcomes => valueOutcomes({ outcomes, n, stake, format, payouts, prices }).expected_net)];
    out.expected_net_range = { low: Math.min(...values), high: Math.max(...values) };
  }
  return out;
}

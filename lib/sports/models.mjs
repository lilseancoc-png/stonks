// Single-stat forecasts for the Owner Sports section (roadmap V4 §5.1, 5.2,
// 5.5). Deterministic and AI-free: the same stored games always give the same
// numbers. One model shape for all four enabled stats:
//
//   expected stat = expected opportunity × rate per opportunity
//                   × opponent factor × home / away factor
//
//   NBA points, rebounds    opportunity = minutes
//   NFL passing yards       opportunity = pass attempts (QBs)
//   NFL receptions          opportunity = targets (WR, TE, RB)
//
// Opportunity is the player's recent games, recency weighted and pulled
// toward his own longer average. Rate is recency weighted and shrunk toward
// the league rate for his position group. The opponent factor is what that
// team allowed in its recent games against the league average, shrunk hard
// by sample size. A straight-line correction fitted on past forecasts then
// pulls the mean back where past forecasts ran high or low. The spread is a
// straight line too (variance = a + b × expected stat, fitted on past
// misses). Counts follow a negative binomial with that variance; passing
// yards, which are not skewed like a count, follow a normal curve. So
// thresholds get exact win / loss / push chances.
//
// buildModel walks the stored seasons day by day and forecasts every game
// from data before that day only. The earlier 60% of days fit the spread and
// the correction; the later 40% are an untouched holdout scored against two
// simple baselines (last-10 hit rate and the plain average). Only games where
// the player had a regular role going in are scored, because those are the
// players lines are posted for. No real lines are stored for past games, so
// the holdout uses the player's last-10 average rounded to a half point as a
// stand-in line.
//
// The tuning (no shrink of minutes / attempts / targets toward the group
// mean, a pull toward the player's own longer average, hard opponent shrink,
// the normal curve for passing yards) was chosen on real seasons:
// NBA 2023-26 and NFL 2022-26. docs/sports/README.md has the numbers.
//
// The same scored forecasts also measure how picks from one game move
// together (lib/sports/joint.mjs); buildModel stores those links as `joint`.
import { normCdf, invNorm } from './normal.mjs';
import { fitJoint } from './joint.mjs';

export { normCdf };
export const SPORTS_MODEL_VERSION = 'sports-model-1';
export const MODEL_SPECS = Object.freeze({
  nba: Object.freeze({
    points: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    rebounds: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
  }),
  nfl: Object.freeze({
    passing_yards: { opportunity: 'attempts', unit: 'pass attempts', groups: ['QB'], dist: 'normal', roleMin: 20, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 40 },
    receptions: { opportunity: 'targets', unit: 'targets', groups: ['WR', 'TE', 'RB'], dist: 'nb', roleMin: 3, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 12 },
  }),
});
const TEAM_WINDOW = { nba: 25, nfl: 12 };
const TEAM_SHRINK = { nba: 30, nfl: 20 };
const OWN_PRIOR = 2;            // opportunity: pull toward the player's own longer average
export const MIN_GAMES = 5;     // fewer stored games: no forecast (the check uses the same bar)
const TRAIN_SHARE = 0.6;
const BINS = 10;
const Z90 = 1.2815515655446004;

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function positionGroup(sport, position) {
  const p = String(position || '').toUpperCase();
  if (sport === 'nba') return p.includes('C') ? 'C' : p.includes('F') ? 'F' : 'G';
  if (p === 'FB') return 'RB';
  return ['QB', 'WR', 'TE', 'RB'].includes(p) ? p : 'other';
}

function opportunityOf(sport, spec, row) {
  return sport === 'nba' ? row.minutes : row.stats?.[spec.opportunity];
}
// A game that can teach the model: the player played and both numbers exist.
export function usableRow(sport, stat, row) {
  const spec = MODEL_SPECS[sport]?.[stat];
  if (!spec || !row || !row.played) return false;
  const v = row.stats?.[stat], o = opportunityOf(sport, spec, row);
  return typeof v === 'number' && Number.isFinite(v) && typeof o === 'number' && Number.isFinite(o) && o >= 0;
}

// ---- Negative binomial (Poisson when r is Infinity) ---------------------------
export function nbCdf(mu, r, k) {
  if (k < 0) return 0;
  if (!(mu > 0)) return 1;
  const poisson = !Number.isFinite(r);
  const lq = poisson ? 0 : Math.log(mu / (r + mu));
  let logp = poisson ? -mu : r * Math.log(r / (r + mu));
  let cdf = 0;
  for (let i = 0; i <= k; i++) {
    cdf += Math.exp(logp);
    if (cdf >= 1 - 1e-12) return 1;
    logp += poisson ? Math.log(mu / (i + 1)) : Math.log((i + r) / (i + 1)) + lq;
  }
  return Math.min(1, cdf);
}
export function nbPmf(mu, r, k) {
  return k < 0 ? 0 : nbCdf(mu, r, k) - nbCdf(mu, r, k - 1);
}
export function nbQuantile(mu, r, q) {
  if (!(mu > 0)) return 0;
  const poisson = !Number.isFinite(r);
  const lq = poisson ? 0 : Math.log(mu / (r + mu));
  let logp = poisson ? -mu : r * Math.log(r / (r + mu));
  let cdf = 0;
  for (let i = 0; i < 100000; i++) {
    cdf += Math.exp(logp);
    if (cdf >= q) return i;
    logp += poisson ? Math.log(mu / (i + 1)) : Math.log((i + r) / (i + 1)) + lq;
  }
  return Infinity;
}

// The spread rule: variance = a + b × expected stat, fitted on past
// forecasts (fitSpread). For a count the negative binomial with that
// variance is used (a Poisson when the variance is not above the mean).
export function varianceOf(spread, mu) {
  return Math.max(0.05, (spread?.a ?? 0) + (spread?.b ?? 1) * mu, 0.3 * mu);
}
export function nbSizeOf(spread, mu) {
  const v = varianceOf(spread, mu);
  return v > mu * 1.0001 ? (mu * mu) / (v - mu) : Infinity;
}

// P(stat <= k) for a whole number k, for either curve. The normal curve
// treats each whole number as the half-point band around it.
export function cdfAt(dist, mu, spread, k) {
  if (dist !== 'normal') return nbCdf(mu, nbSizeOf(spread, mu), k);
  if (!(mu > 0)) return k >= 0 ? 1 : 0;
  return normCdf((k + 0.5 - mu) / Math.sqrt(varianceOf(spread, mu)));
}
export function quantileOf(dist, mu, spread, q) {
  if (dist !== 'normal') return nbQuantile(mu, nbSizeOf(spread, mu), q);
  const z = q === 0.1 ? -Z90 : q === 0.9 ? Z90 : null;
  if (z == null) throw new Error('only the 10th and 90th percentiles are used');
  return Math.max(0, Math.round(mu + z * Math.sqrt(varianceOf(spread, mu))));
}

// Win / loss / push for one side of a line (V4 §5.2). Half lines never push.
export function lineChances(mu, spread, side, threshold, dist = 'nb') {
  const t = Number(threshold);
  const whole = Number.isInteger(t);
  const atOrBelow = cdfAt(dist, mu, spread, Math.floor(t));
  const push = whole ? atOrBelow - cdfAt(dist, mu, spread, t - 1) : 0;
  const over = 1 - atOrBelow, under = atOrBelow - push;
  return side === 'under' ? { win: under, loss: over, push } : { win: over, loss: under, push };
}

// Straight-line correction x ≈ a + b·mu, by least squares on past forecasts.
// The slope stays in 0.6-1.2 so a short sample cannot flip or flatten it.
export function fitCorrection(pairs) {
  if (pairs.length < 30) return { a: 0, b: 1 };
  const n = pairs.length, mx = pairs.reduce((s, [m]) => s + m, 0) / n, my = pairs.reduce((s, [, x]) => s + x, 0) / n;
  let sxy = 0, sxx = 0;
  for (const [m, x] of pairs) { sxy += (m - mx) * (x - my); sxx += (m - mx) ** 2; }
  const b = Math.min(1.2, Math.max(0.6, sxx > 0 ? sxy / sxx : 1));
  return { a: my - b * mx, b };
}
const corrected = (c, mu) => Math.max(0.05, (c?.a ?? 0) + (c?.b ?? 1) * mu);

// Least squares of the squared miss on the forecast: variance = a + b·mu.
// The slope never goes below zero; too few pairs keep a Poisson-like rule.
export function fitSpread(pairs) {
  if (pairs.length < 30) return { a: 0, b: 1 };
  const n = pairs.length, mx = pairs.reduce((s, [m]) => s + m, 0) / n;
  const e2 = pairs.map(([m, x]) => (x - m) ** 2), my = e2.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  pairs.forEach(([m], i) => { sxy += (m - mx) * (e2[i] - my); sxx += (m - mx) ** 2; });
  const b = Math.max(0, sxx > 0 ? sxy / sxx : 0);
  return { a: round(my - b * mx, 4), b: round(b, 4) };
}

// ---- League state, built up one day at a time ------------------------------------
function newState(sport) {
  const stats = Object.keys(MODEL_SPECS[sport]);
  return {
    sport,
    groups: Object.fromEntries(stats.map((s) => [s, {}])),
    teams: Object.fromEntries(stats.map((s) => [s, {}])),
    loc: Object.fromEntries(stats.map((s) => [s, { homeSum: 0, homeN: 0, awaySum: 0, awayN: 0 }])),
  };
}
function addDay(state, rows) {
  const { sport } = state;
  for (const stat of Object.keys(MODEL_SPECS[sport])) {
    const spec = MODEL_SPECS[sport][stat];
    const teamGame = new Map();
    for (const r of rows) {
      if (!usableRow(sport, stat, r)) continue;
      const g = positionGroup(sport, r.position);
      const acc = state.groups[stat][g] || (state.groups[stat][g] = { opp: 0, stat: 0, n: 0 });
      acc.opp += opportunityOf(sport, spec, r); acc.stat += r.stats[stat]; acc.n += 1;
      const key = r.game_id + '|' + r.team;
      const t = teamGame.get(key) || { total: 0, opponent: r.opponent, home: r.home };
      t.total += r.stats[stat];
      teamGame.set(key, t);
    }
    for (const t of teamGame.values()) {
      const list = state.teams[stat][t.opponent] || (state.teams[stat][t.opponent] = []);
      list.push(t.total);
      if (list.length > TEAM_WINDOW[sport]) list.shift();
      const loc = state.loc[stat];
      if (t.home) { loc.homeSum += t.total; loc.homeN += 1; } else { loc.awaySum += t.total; loc.awayN += 1; }
    }
  }
}
// The compact, point-in-time numbers a forecast needs.
function contextOf(state, spread = {}, correction = {}) {
  const { sport } = state, out = { groups: {}, teams: {}, location: {}, spread: {}, correction: {} };
  for (const stat of Object.keys(MODEL_SPECS[sport])) {
    const groups = {};
    let all = { opp: 0, stat: 0, n: 0 };
    for (const [g, a] of Object.entries(state.groups[stat]).sort((x, y) => x[0].localeCompare(y[0]))) {
      if (!a.n) continue;
      groups[g] = { opp_mean: round(a.opp / a.n), rate: a.opp > 0 ? round(a.stat / a.opp, 5) : 0, n: a.n };
      all = { opp: all.opp + a.opp, stat: all.stat + a.stat, n: all.n + a.n };
    }
    if (all.n) groups.all = { opp_mean: round(all.opp / all.n), rate: all.opp > 0 ? round(all.stat / all.opp, 5) : 0, n: all.n };
    out.groups[stat] = groups;
    const loc = state.loc[stat], n = loc.homeN + loc.awayN;
    const league = n ? (loc.homeSum + loc.awaySum) / n : null;
    out.location[stat] = league ? { home: round(loc.homeN ? loc.homeSum / loc.homeN / league : 1), away: round(loc.awayN ? loc.awaySum / loc.awayN / league : 1) } : { home: 1, away: 1 };
    const teams = {};
    for (const [team, list] of Object.entries(state.teams[stat]).sort((x, y) => x[0].localeCompare(y[0]))) {
      if (!league || !list.length) continue;
      const raw = mean(list) / league;
      teams[team] = { factor: round(1 + (raw - 1) * (list.length / (list.length + TEAM_SHRINK[sport]))), games: list.length };
    }
    out.teams[stat] = teams;
    out.spread[stat] = spread[stat] ?? null;
    out.correction[stat] = correction[stat] ? { a: round(correction[stat].a), b: round(correction[stat].b) } : { a: 0, b: 1 };
  }
  return out;
}

// ---- One forecast ------------------------------------------------------------------
// `history`: the player's earlier games, newest first. Returns the mean and
// its parts, or why there is no forecast.
export function forecastMean({ sport, stat, history, home, opponent, group, context }) {
  const spec = MODEL_SPECS[sport]?.[stat];
  if (!spec) return { status: 'not_calculated', reason: 'stat' };
  if (spec.groups && !spec.groups.includes(group)) return { status: 'not_calculated', reason: 'position' };
  const rows = history.filter((r) => usableRow(sport, stat, r));
  if (rows.length < MIN_GAMES) return { status: 'not_calculated', reason: 'too_few_games', games: rows.length };
  const g = context?.groups?.[stat]?.[group] || context?.groups?.[stat]?.all;
  if (!g) return { status: 'not_calculated', reason: 'no_model' };
  let ow = 0, oo = 0;
  rows.slice(0, spec.oppWindow).forEach((r, i) => { const w = 0.5 ** (i / spec.oppHalfLife); ow += w; oo += w * opportunityOf(sport, spec, r); });
  const longer = mean(rows.slice(0, spec.rateWindow).map((r) => opportunityOf(sport, spec, r)));
  const expectedOpp = (oo + OWN_PRIOR * longer) / (ow + OWN_PRIOR);
  let ro = 0, rs = 0;
  rows.slice(0, spec.rateWindow).forEach((r, i) => { const w = 0.5 ** (i / spec.rateHalfLife); ro += w * opportunityOf(sport, spec, r); rs += w * r.stats[stat]; });
  const rate = (rs + spec.priorUnits * g.rate) / (ro + spec.priorUnits);
  const opponentFactor = (opponent && context.teams?.[stat]?.[opponent]?.factor) || 1;
  const locationFactor = context.location?.[stat]?.[home ? 'home' : 'away'] || 1;
  const raw = expectedOpp * rate * opponentFactor * locationFactor;
  return {
    status: 'ok', raw_mean: raw, mean: corrected(context.correction?.[stat], raw),
    expected_opportunity: expectedOpp, regular_role: expectedOpp >= spec.roleMin, rate, opponent_factor: opponentFactor, location_factor: locationFactor,
    games: rows.length, unit: spec.unit,
  };
}

// The forecast the pages show for one player, stat and game. With a side and
// threshold it adds that line's chances; `lines: true` adds the chance of the
// over at the half lines around the forecast (the player page, before a line
// is typed in).
export function forecastStat({ sport, stat, history, home, opponent, group, model, side, threshold, lines = false }) {
  if (!model?.context) return { status: 'not_calculated', reason: 'no_model' };
  const fc = forecastMean({ sport, stat, history, home, opponent, group, context: model.context });
  if (fc.status !== 'ok') return fc;
  const spread = model.context.spread?.[stat];
  if (!spread || !Number.isFinite(spread.a) || !Number.isFinite(spread.b)) return { status: 'not_calculated', reason: 'no_model' };
  const dist = MODEL_SPECS[sport][stat].dist;
  // The check covers regular-role games only, so a smaller role is never
  // shown as validated.
  const quality = fc.regular_role && model.evaluation?.[stat]?.status === 'validated' ? 'validated' : 'experimental';
  const out = {
    status: 'ok', quality, regular_role: fc.regular_role, model_version: model.model_version, as_of_date: model.as_of_date || null,
    mean: round(fc.mean, 2), low: quantileOf(dist, fc.mean, spread, 0.1), high: quantileOf(dist, fc.mean, spread, 0.9),
    expected_opportunity: round(fc.expected_opportunity, 1), unit: fc.unit, rate: round(fc.rate, 4),
    opponent_factor: round(fc.opponent_factor, 3), location_factor: round(fc.location_factor, 3), games: fc.games,
  };
  if (side && threshold != null && threshold !== '') {
    const ch = lineChances(fc.mean, spread, side, threshold, dist);
    out.probability = round(ch.win); out.push = round(ch.push); out.loss = round(ch.loss);
    // V4 §5.5: the same line if the minutes / attempts / targets run 10% lower or higher.
    const at = (k) => round(lineChances(corrected(model.context.correction?.[stat], fc.raw_mean * k), spread, side, threshold, dist).win);
    out.sensitivity = { opportunity_down_10: at(0.9), opportunity_up_10: at(1.1) };
  }
  if (lines) out.lines = lineTable(fc.mean, spread, dist);
  return out;
}

export function lineTable(mu, spread, dist = 'nb', count = 5) {
  const step = mu >= 60 ? 10 : 1;
  const start = Math.max(0.5, Math.floor(mu) + 0.5 - Math.floor(count / 2) * step);
  return Array.from({ length: count }, (_, i) => start + i * step).map((t) => ({ threshold: t, over: round(lineChances(mu, spread, 'over', t, dist).win) }));
}

// The few numbers the status card shows for each stat.
export function modelSummary(model) {
  if (!model || typeof model !== 'object') return null;
  const stats = {};
  for (const [stat, ev] of Object.entries(model.evaluation || {})) {
    stats[stat] = {
      status: ev.status === 'validated' ? 'validated' : 'experimental',
      reason: ev.reason || null,
      test_n: ev.test?.n ?? 0,
      split_date: ev.split_date || null,
      brier: ev.test?.brier || null,
      ece: ev.test?.ece ?? null,
      over_rate: ev.test?.over_rate ?? null,
    };
  }
  const links = Object.entries(model.joint?.pairs || {}).map(([key, p]) => ({
    key, stats: p.stats, relation: p.relation, link: p.link, status: p.status, reason: p.reason || null,
    test_pairs: p.test?.pairs ?? 0, brier: p.test?.brier || null, both_cleared: p.test?.both_cleared || null,
  }));
  return { model_version: model.model_version, as_of_date: model.as_of_date || null, generated_utc: model.generated_utc || null, seasons: Array.isArray(model.seasons) ? model.seasons : [], stats, links };
}

// ---- Build and check the model over the stored seasons ------------------------------
function brier(ps, ys) { return mean(ps.map((p, i) => (p - ys[i]) ** 2)); }
function logLoss(ps, ys) { return mean(ps.map((p, i) => { const q = Math.min(1 - 1e-4, Math.max(1e-4, p)); return -(ys[i] ? Math.log(q) : Math.log(1 - q)); })); }
function reliability(ps, ys) {
  const bins = Array.from({ length: BINS }, (_, i) => ({ lo: i / BINS, hi: (i + 1) / BINS, n: 0, p: 0, y: 0 }));
  ps.forEach((p, i) => { const b = bins[Math.min(BINS - 1, Math.floor(p * BINS))]; b.n += 1; b.p += p; b.y += ys[i]; });
  const out = bins.filter((b) => b.n).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, mean_p: round(b.p / b.n), hit_rate: round(b.y / b.n) }));
  const ece = ps.length ? out.reduce((a, b) => a + (b.n / ps.length) * Math.abs(b.mean_p - b.hit_rate), 0) : null;
  return { bins: out, ece: round(ece) };
}

export function buildModel({ sport, rows, now = Date.now(), includeJoint = true }) {
  const stats = Object.keys(MODEL_SPECS[sport]);
  const sorted = rows.filter((r) => r && r.date).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.game_id).localeCompare(String(b.game_id)) || String(a.player_id).localeCompare(String(b.player_id)));
  const days = new Map();
  for (const r of sorted) { if (!days.has(r.date)) days.set(r.date, []); days.get(r.date).push(r); }
  const state = newState(sport);
  const histories = new Map();
  const records = Object.fromEntries(stats.map((s) => [s, []]));
  for (const [date, dayRows] of days) {
    const context = contextOf(state);
    for (const row of dayRows) {
      const hist = histories.get(row.player_id);
      if (!hist) continue;
      for (const stat of stats) {
        if (!usableRow(sport, stat, row)) continue;
        const prior = hist.list.filter((r) => usableRow(sport, stat, r));
        if (prior.length < MIN_GAMES) continue;
        const recent = prior.slice(-60).reverse();
        const fc = forecastMean({ sport, stat, history: recent, home: row.home, opponent: row.opponent, group: positionGroup(sport, row.position || recent[0].position), context });
        if (fc.status !== 'ok' || !fc.regular_role) continue;
        const last10 = recent.slice(0, 10).map((r) => r.stats[stat]);
        const avg10 = mean(last10), line = Math.floor(avg10) + 0.5;
        records[stat].push({
          date, game_id: row.game_id, team: row.team, player_id: row.player_id, mu: fc.raw_mean, x: row.stats[stat], line, avg10,
          avgAll: mean(prior.map((r) => r.stats[stat])), hits10: last10.filter((v) => v > line).length, n10: last10.length,
        });
      }
    }
    addDay(state, dayRows);
    for (const row of dayRows) {
      const h = histories.get(row.player_id) || { list: [] };
      h.list.push(row);
      if (h.list.length > 120) h.list.shift();
      histories.set(row.player_id, h);
    }
  }
  const evaluation = {}, spread = {}, correction = {}, zScores = [];
  for (const stat of stats) {
    const recs = records[stat], dist = MODEL_SPECS[sport][stat].dist;
    // What later forecasts use: fitted on every scored game.
    correction[stat] = fitCorrection(recs.map((r) => [r.mu, r.x]));
    spread[stat] = fitSpread(recs.map((r) => [corrected(correction[stat], r.mu), r.x]));
    // Where each result fell on its forecast's curve, as a normal score
    // (the middle of its step, so whole-number stats are not pushed to an
    // edge). These measure the same-game links.
    const score = (c, s, r) => { const m = corrected(c, r.mu); return invNorm((cdfAt(dist, m, s, r.x - 1) + cdfAt(dist, m, s, r.x)) / 2); };
    const out = recs.map((r) => ({ stat, game_id: r.game_id, team: r.team, player_id: r.player_id, z: score(correction[stat], spread[stat], r) }));
    zScores.push(...out);
    const dates = [...new Set(recs.map((r) => r.date))].sort();
    if (dates.length < 4) { evaluation[stat] = { status: 'experimental', reason: 'not enough past games to check yet', forecasts: recs.length, test: null }; continue; }
    // The check: fit on the earlier days only, score the later days.
    const split = dates[Math.floor(dates.length * TRAIN_SHARE)];
    const train = recs.filter((r) => r.date < split), test = recs.filter((r) => r.date >= split);
    const cTrain = fitCorrection(train.map((r) => [r.mu, r.x]));
    const muOf = (r) => corrected(cTrain, r.mu);
    const sModel = fitSpread(train.map((r) => [muOf(r), r.x])), sAvg = fitSpread(train.map((r) => [r.avgAll, r.x]));
    const ys = test.map((r) => (r.x > r.line ? 1 : 0));
    const pModel = test.map((r) => 1 - cdfAt(dist, muOf(r), sModel, Math.floor(r.line)));
    const pAvg = test.map((r) => 1 - cdfAt(dist, r.avgAll, sAvg, Math.floor(r.line)));
    const pLast10 = test.map((r) => (r.hits10 + 1) / (r.n10 + 2));
    recs.forEach((r, i) => { if (r.date < split) out[i].zTrain = score(cTrain, sModel, r); });
    let ti = 0;
    recs.forEach((r, i) => { if (r.date >= split) { out[i].pTest = pModel[ti]; out[i].y = ys[ti]; ti++; } });
    const rel = reliability(pModel, ys);
    const scores = { model: round(brier(pModel, ys)), last10_hit_rate: round(brier(pLast10, ys)), plain_average: round(brier(pAvg, ys)) };
    const validated = test.length >= 300 && scores.model < scores.last10_hit_rate && scores.model < scores.plain_average && rel.ece <= 0.03;
    evaluation[stat] = {
      status: validated ? 'validated' : 'experimental',
      reason: validated ? null : test.length < 300 ? 'fewer than 300 holdout games' : rel.ece > 0.03 ? 'chances were off by more than 3 points on average' : 'did not beat both simple baselines',
      forecasts: recs.length,
      split_date: split,
      train: { n: train.length, from: train[0]?.date || null },
      test: {
        n: test.length, to: test[test.length - 1]?.date || null,
        over_rate: round(mean(ys)),
        brier: scores,
        log_loss: { model: round(logLoss(pModel, ys)), last10_hit_rate: round(logLoss(pLast10, ys)), plain_average: round(logLoss(pAvg, ys)) },
        mae: { model: round(mean(test.map((r) => Math.abs(muOf(r) - r.x))), 2), last10_average: round(mean(test.map((r) => Math.abs(r.avg10 - r.x))), 2), plain_average: round(mean(test.map((r) => Math.abs(r.avgAll - r.x))), 2) },
        ece: rel.ece, reliability: rel.bins,
      },
    };
  }
  return {
    sport, model_version: SPORTS_MODEL_VERSION,
    generated_utc: new Date(now).toISOString(),
    as_of_date: sorted.length ? sorted[sorted.length - 1].date : null,
    line_proxy: 'the player’s last-10 average rounded to a half point (no past lines are stored)',
    scored: 'regular-role games only (' + stats.map((st) => MODEL_SPECS[sport][st].roleMin + '+ expected ' + MODEL_SPECS[sport][st].unit).filter((v, i, a) => a.indexOf(v) === i).join('; ') + ')',
    context: contextOf(state, spread, correction),
    evaluation,
    joint: includeJoint ? fitJoint(zScores) : null,
  };
}

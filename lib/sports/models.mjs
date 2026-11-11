// Single-stat forecasts for the Owner Sports section (roadmap V4 §5.1, 5.2,
// 5.5). Deterministic and AI-free: the same stored games always give the same
// numbers. One model shape for every modeled stat (MODEL_SPECS: 12 NBA, 9
// NFL since sports-model-3, 2026-11-11):
//
//   expected stat = expected opportunity × rate per opportunity
//                   × opponent factor × home / away factor
//                   × teammates-out lift (NBA, where it tested better)
//                   × game factors (sports-model-4, 2026-11-11: the game's
//                     spread and total, NFL snap-share trend; per stat, only
//                     where they tested better; GAME_FACTORS below)
//
//   NBA, every stat           opportunity = minutes
//   NFL passing yards, completions, attempts      = pass attempts (QBs)
//   NFL receptions, receiving yards               = targets (WR, TE, RB)
//   NFL rushing yards, carries                    = carries (RB, QB)
//   NFL rush + rec yards = carries + targets; pass + rush yards = attempts + carries
//
// Combos (PRA, rush + receiving yards, ...) are modeled as their own stat
// from the summed values (statValue), not by adding two forecasts.
//
// Opportunity is the player's recent games, recency weighted and pulled
// toward his own longer average. Rate is recency weighted and shrunk toward
// the league rate for his position group. The opponent factor is what that
// team allowed in its recent games against the league average, shrunk hard
// by sample size. A straight-line correction fitted on past forecasts then
// pulls the mean back where past forecasts ran high or low. The spread is a
// straight line too (variance = a + b × expected stat, fitted on past
// misses). Counts follow a negative binomial with that variance; passing
// yards (and pass + rush yards), which are not skewed like a count, follow a
// normal curve; rushing and receiving yards are skewed and stay negative
// binomial (both measured on real seasons). So thresholds get exact win /
// loss / push chances.
//
// Those chances can go through one recalibration step (Platt scaling: the
// log-odds of each over chance are stretched or squeezed by a fitted line,
// sigmoid(a + b × log-odds)), applied to the over chance at every whole
// number so over, under and push still add up to one. It is fitted on the
// holdout below and USED ONLY when it beats the raw chances there on both
// scores, cross-fitted. On the 2026-11-11 data it did not for any stat (the
// NBA points calls at 60-70% that hit 55% came mostly from the first games
// of the new season, where forecasts ran high; see `early_season`), so no
// chance changed; the check reruns with every refit.
//
// buildModel walks the stored seasons day by day and forecasts every game
// from data before that day only. The earlier 60% of days fit the spread and
// the correction; the later 40% are an untouched holdout scored against two
// simple baselines (last-10 hit rate and the plain average). The
// recalibration is fitted on that holdout and checked by cross-fitting: fit
// on its earlier half, score the later half, and the other way round, so no
// scored game helped fit its own correction. The holdout also measures how
// far forecasts ran off in a player's first games of a season, when most of
// his history is last season (`early_season`); forecasts in that spot carry
// the measured miss. Only games where
// the player had a regular role going in are scored, because those are the
// players lines are posted for. The holdout uses the player's last-10
// average rounded to a half point as a stand-in line. Where a real
// PrizePicks line is stored for a held-out game (the issued props record,
// and from 2026-11-11 the line archive, lib/sports/line-archive.mjs), the
// same forecast is also scored at that line (`real_lines`); once 300 are
// scored the model must beat the last-10 hit rate and a coin flip there too.
//
// Teammates out (NBA): when regulars (15+ average minutes, played 3 of their
// last 5) are missing, a player's forecast rises by beta × minutes missing /
// 240. Beta is fitted on the earlier days and kept only where it beat no
// adjustment on the holdout on both scores (`teammates_out`); NFL showed no
// consistent lift and is not adjusted. In the check, who was missing comes
// from the box scores; live it comes from the ESPN injury report.
//
// Game factors (since 2026-11-11, GAME_FACTORS): the game spread and total
// (the team's implied points and expected margin), the NFL snap-share trend,
// and any research-only factor passed in. Each is fitted on the earlier games
// that have it and KEPT ONLY when it beats leaving it out on the later ones,
// on both Brier score and log loss, by more than one standard error
// (`factors` in each stat's check). Games without the input are forecast as
// before. Weather was tested the same way and left out (docs/sports/README.md).
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
import { statValue } from './schema.mjs';

export { normCdf };
export const SPORTS_MODEL_VERSION = 'sports-model-4';
export const MODEL_SPECS = Object.freeze({
  nba: Object.freeze({
    points: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    rebounds: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    assists: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    threes: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    steals: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    blocks: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    turnovers: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    pra: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    pts_reb: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    pts_ast: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    reb_ast: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
    blk_stl: { opportunity: 'minutes', unit: 'minutes', groups: null, dist: 'nb', roleMin: 20, oppWindow: 10, oppHalfLife: 5, rateWindow: 40, rateHalfLife: 20, priorUnits: 60 },
  }),
  nfl: Object.freeze({
    passing_yards: { opportunity: 'attempts', unit: 'pass attempts', groups: ['QB'], dist: 'normal', roleMin: 20, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 40 },
    receptions: { opportunity: 'targets', unit: 'targets', groups: ['WR', 'TE', 'RB'], dist: 'nb', roleMin: 3, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 12 },
    rushing_yards: { opportunity: 'carries', unit: 'carries', groups: ['RB', 'QB'], dist: 'nb', roleMin: 6, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 30 },
    receiving_yards: { opportunity: 'targets', unit: 'targets', groups: ['WR', 'TE', 'RB'], dist: 'nb', roleMin: 3, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 12 },
    rush_rec_yards: { opportunity: ['carries', 'targets'], unit: 'carries + targets', groups: ['RB', 'WR', 'TE'], dist: 'nb', roleMin: 6, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 30 },
    pass_rush_yards: { opportunity: ['attempts', 'carries'], unit: 'pass attempts + carries', groups: ['QB'], dist: 'normal', roleMin: 20, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 40 },
    completions: { opportunity: 'attempts', unit: 'pass attempts', groups: ['QB'], dist: 'nb', roleMin: 20, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 40 },
    attempts: { opportunity: 'attempts', unit: 'pass attempts', groups: ['QB'], dist: 'nb', roleMin: 20, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 40 },
    carries: { opportunity: 'carries', unit: 'carries', groups: ['RB', 'QB'], dist: 'nb', roleMin: 6, oppWindow: 8, oppHalfLife: 4, rateWindow: 24, rateHalfLife: 10, priorUnits: 30 },
  }),
});
const TEAM_WINDOW = { nba: 25, nfl: 12 };
const TEAM_SHRINK = { nba: 30, nfl: 20 };
const OWN_PRIOR = 2;            // opportunity: pull toward the player's own longer average
export const MIN_GAMES = 5;     // fewer stored games: no forecast (the check uses the same bar)
// Fewer games than this in the season (with last season's behind them): an
// early-season forecast. NBA 8 of 82, NFL 3 of 17.
export const EARLY_GAMES = Object.freeze({ nba: 8, nfl: 3 });
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

// Opportunity: NBA minutes; in NFL one stored count or the sum of several
// (rush + receiving yards run on carries + targets).
function opportunityOf(sport, spec, row) {
  if (sport === 'nba') return row.minutes;
  if (!Array.isArray(spec.opportunity)) return row.stats?.[spec.opportunity];
  let sum = 0;
  for (const k of spec.opportunity) { const v = row.stats?.[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return null; sum += v; }
  return sum;
}
// A stat's value in a row: stored, or a combo summed from its parts.
const valueOf = (row, stat) => statValue(row, stat);
// A game that can teach the model: the player played and both numbers exist.
export function usableRow(sport, stat, row) {
  const spec = MODEL_SPECS[sport]?.[stat];
  if (!spec || !row || !row.played) return false;
  const v = valueOf(row, stat), o = opportunityOf(sport, spec, row);
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

// ---- Recalibration -------------------------------------------------------------
// Platt scaling on the over chance: sigmoid(a + b × log-odds). b below 1
// pulls far-from-even chances back toward 50%; a shifts every line the same
// way. { a: 0, b: 1 } (or no calibration) changes nothing.
const CAL_MIN = 200;
const logit = (p) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };
export function calibrate(cal, p) {
  if (!cal || !(p > 0 && p < 1) || (cal.a === 0 && cal.b === 1)) return p;
  return 1 / (1 + Math.exp(-(cal.a + cal.b * logit(p))));
}
// Logistic fit of the outcome on the log-odds of the stated chance (Newton
// steps, a light pull toward no change). Under CAL_MIN games: no change.
export function fitCalibration(ps, ys) {
  const n = ps.length;
  if (n < CAL_MIN) return { a: 0, b: 1, n };
  const xs = ps.map(logit);
  let a = 0, b = 1;
  const ridge = 1;
  for (let it = 0; it < 50; it++) {
    let g0 = -ridge * a, g1 = -ridge * (b - 1), h00 = ridge, h01 = 0, h11 = ridge;
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * xs[i]))), w = p * (1 - p), r = ys[i] - p;
      g0 += r; g1 += r * xs[i]; h00 += w; h01 += w * xs[i]; h11 += w * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 0)) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return { a: round(Math.min(0.5, Math.max(-0.5, a)), 4), b: round(Math.min(1.5, Math.max(0.5, b)), 4), n };
}
// P(stat <= k) after recalibrating the over chance at k.
export function calibratedCdf(dist, mu, spread, k, cal) {
  const raw = cdfAt(dist, mu, spread, k);
  return cal ? 1 - calibrate(cal, 1 - raw) : raw;
}

export function quantileOf(dist, mu, spread, q, cal = null) {
  if (cal && !(cal.a === 0 && cal.b === 1)) {
    // Smallest whole number whose recalibrated chance of at-or-below reaches q.
    const top = Math.ceil(mu + 12 * Math.sqrt(varianceOf(spread, mu))) + 10;
    for (let k = 0; k <= top; k++) if (calibratedCdf(dist, mu, spread, k, cal) >= q) return k;
    return top;
  }
  if (dist !== 'normal') return nbQuantile(mu, nbSizeOf(spread, mu), q);
  const z = q === 0.1 ? -Z90 : q === 0.9 ? Z90 : null;
  if (z == null) throw new Error('only the 10th and 90th percentiles are used');
  return Math.max(0, Math.round(mu + z * Math.sqrt(varianceOf(spread, mu))));
}

// Win / loss / push for one side of a line (V4 §5.2). Half lines never push.
// `cal`: the fitted recalibration (model.context.calibration[stat]); left
// out, the raw curve.
export function lineChances(mu, spread, side, threshold, dist = 'nb', cal = null) {
  const t = Number(threshold);
  const whole = Number.isInteger(t);
  const atOrBelow = calibratedCdf(dist, mu, spread, Math.floor(t), cal);
  const push = whole ? atOrBelow - calibratedCdf(dist, mu, spread, t - 1, cal) : 0;
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
      acc.opp += opportunityOf(sport, spec, r); acc.stat += valueOf(r, stat); acc.n += 1;
      const key = r.game_id + '|' + r.team;
      const t = teamGame.get(key) || { total: 0, opponent: r.opponent, home: r.home };
      t.total += valueOf(r, stat);
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
function contextOf(state, spread = {}, correction = {}, calibration = {}, absence = {}, factors = {}) {
  const { sport } = state, out = { groups: {}, teams: {}, location: {}, spread: {}, correction: {}, calibration: {}, absence: {}, factors: {} };
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
    out.calibration[stat] = calibration[stat] ? { a: calibration[stat].a, b: calibration[stat].b } : { a: 0, b: 1 };
    out.absence[stat] = { beta: absence[stat]?.beta || 0 };
    // Only factors the check kept carry betas; the scale is kept either way
    // so pages can show the inputs.
    out.factors[stat] = factors[stat] || {};
  }
  return out;
}

// ---- One forecast ------------------------------------------------------------------
// `history`: the player's earlier games, newest first. Returns the mean and
// its parts, or why there is no forecast.
// ---- Teammates out (NBA, since 2026-11-11) ------------------------------------------
// When regulars miss a game, the players left take on their minutes and
// shots. A regular, for one team and date: his latest game row is with that
// team within the last 12 days, he played in 3 of his last 5 rows, and he
// averaged 15+ minutes over his last 10 games played. `absent` is the sum of
// those averages for the regulars who do not play, and each stat's forecast
// rises by beta × absent / 240 (240 = a team's minutes in a game). Beta is
// fitted on past games and used only when it beat no adjustment on the
// holdout (see buildModel). In the check, who was out comes from the box
// score; on the pages and the MCP it comes from the injury report (Out or
// Doubtful), so a late scratch is not known in advance.
export const ABSENCE = Object.freeze({ windowDays: 12, minMinutes: 15, teamMinutes: 240 });
const DAY_MS = 86400000;
// A player's average minutes as a regular of `team` before `date`, else 0.
// `rows`: his game rows, newest first, all before that date.
export function regularMinutes(rows, team, date) {
  const last = rows?.[0];
  if (!last || last.team !== team) return 0;
  const gap = Date.parse(date + 'T12:00:00Z') - Date.parse(last.date + 'T12:00:00Z');
  if (!(gap > 0) || gap > ABSENCE.windowDays * DAY_MS) return 0;
  if (rows.slice(0, 5).filter((r) => r.played).length < 3) return 0;
  const minutes = rows.slice(0, 10).filter((r) => r.played && typeof r.minutes === 'number').map((r) => r.minutes);
  const avg = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0;
  return avg >= ABSENCE.minMinutes ? avg : 0;
}
// The minutes a team loses for one game: regulars among `outRows` (each a
// player's game rows, newest first, before the game). Callers pass the rows
// of teammates the injury report lists as Out or Doubtful.
export function absentMinutes(outRows, team, date) {
  let sum = 0;
  for (const rows of outRows || []) sum += regularMinutes(rows, team, date);
  return round(sum, 1) || 0;
}
// Every team playing that day: minutes of regulars without a played row.
function absentMinutesByTeam(date, dayRows, histories) {
  const teams = new Set(dayRows.map((r) => r.team));
  const playing = new Set(dayRows.filter((r) => r.played).map((r) => r.team + '|' + r.player_id));
  const out = new Map();
  for (const [pid, h] of histories) {
    const last = h.list[h.list.length - 1];
    if (!last || !teams.has(last.team) || playing.has(last.team + '|' + pid)) continue;
    const m = regularMinutes(h.list.slice(-10).reverse(), last.team, date);
    if (m) out.set(last.team, (out.get(last.team) || 0) + m);
  }
  return out;
}
export function absenceFactor(context, stat, absent) {
  const beta = context?.absence?.[stat]?.beta || 0;
  return absent > 0 && beta > 0 ? 1 + beta * Math.min(absent, 120) / ABSENCE.teamMinutes : 1;
}
// Least squares of the miss on the absent share, through the origin:
// x ≈ mu × (1 + beta × share). Held to 0..1.
function fitAbsence(recs, muOf) {
  let sxy = 0, sxx = 0;
  for (const r of recs) {
    const z = Math.min(r.absent || 0, 120) / ABSENCE.teamMinutes, m = muOf(r);
    if (!(z > 0)) continue;
    sxy += z * (r.x - m); sxx += z * z * m;
  }
  return sxx > 0 ? round(Math.max(0, Math.min(1, sxy / sxx)), 4) : 0;
}

// ---- Game factors (since 2026-11-11) ------------------------------------------------
// A factor turns one game's inputs into a few numbers z (0 = nothing
// unusual) and moves the forecast by 1 + Σ beta × z (held to 0.5-1.6). The
// betas are fitted on earlier games by weighted least squares (fitFactor) and
// a factor is used only where it beat leaving it out on the later games that
// have it, on both scores, by more than one standard error (buildModel).
//
//   game_lines   the team's implied points (total ± margin, halved) against
//                the league average, and its expected margin. NFL: the
//                schedule's spread and total (closing numbers for past
//                games). NBA: the consensus the props scan archives from
//                sportsbook prices, so it can only be checked once enough
//                archived games exist.
//   snap_trend   NFL: the player's last two snap shares against his last
//                eight (a role that is growing or shrinking).
export const GAME_FACTORS = Object.freeze({ nba: Object.freeze(['game_lines']), nfl: Object.freeze(['game_lines', 'snap_trend']) });
const MARGIN_SCALE = { nba: 10, nfl: 7 };
const FACTOR_MIN = 200;   // games with the input needed on each side of the check
// The team's side of a game's spread and total, or null.
export function gameEnvironment(game, team) {
  const l = game?.lines;
  if (!l || !Number.isFinite(l.total) || !Number.isFinite(l.home_margin) || !team) return null;
  const home = team === game.home_team;
  if (!home && team !== game.away_team) return null;
  const margin = home ? l.home_margin : -l.home_margin;
  return { total: l.total, team_margin: margin, team_total: round((l.total + margin) / 2, 2), source: l.source || null };
}
// The spread and total shown with a game: who is favored and each team's
// implied total ((total ± margin) / 2).
export function gameLinesView(game) {
  const l = game?.lines;
  if (!l || !Number.isFinite(l.total) || !Number.isFinite(l.home_margin)) return null;
  const home = gameEnvironment(game, game.home_team), away = gameEnvironment(game, game.away_team);
  return { total: l.total, home_margin: l.home_margin, favorite: l.home_margin > 0 ? game.home_team : l.home_margin < 0 ? game.away_team : null,
    home_team_total: home?.team_total ?? null, away_team_total: away?.team_total ?? null, source: l.source || null,
    ...(l.books ? { books: l.books } : {}), ...(l.observed_utc ? { observed_utc: l.observed_utc } : {}) };
}

// The player's snap share over his last eight played games (newest first),
// the same eight games the model's check looks back on; games without a snap
// count are skipped, not replaced by older ones.
export function snapTrend(history) {
  const shares = [];
  let seen = 0;
  for (const r of history || []) {
    if (!r.played) continue;
    if (++seen > 8) break;
    if (typeof r.snap_pct === 'number' && Number.isFinite(r.snap_pct)) shares.push(r.snap_pct);
  }
  if (shares.length < 4) return null;
  const long = mean(shares), recent = mean(shares.slice(0, 2));
  return long > 0.05 ? { recent: round(recent, 3), long: round(long, 3), change: round(Math.max(-0.6, Math.min(0.6, recent / long - 1)), 3) } : null;
}
// z for one factor from what the game and the history give; null = no input.
// `inputs`: { env (gameEnvironment), history (newest first), extra (research) }.
export function factorInputs(name, sport, inputs, scale = {}) {
  if (name === 'game_lines') {
    const env = inputs.env, avg = scale.avg_team_total;
    if (!env || !(avg > 0)) return null;
    return [env.team_total / avg - 1, env.team_margin / MARGIN_SCALE[sport]];
  }
  if (name === 'snap_trend') {
    if (sport !== 'nfl') return null;
    const t = snapTrend(inputs.history);
    return t ? [t.change] : null;
  }
  const research = inputs.extra?.[name];
  return Array.isArray(research) && research.every(Number.isFinite) ? research : null;
}
// The last `n` played rows of an oldest-first list, newest first.
function lastPlayed(list, n) {
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (list[i].played) out.push(list[i]);
  return out;
}
const factorMult = (betas, z) => {
  if (!z || !betas) return 1;
  let s = 1;
  z.forEach((v, i) => { s += (betas[i] || 0) * v; });
  return Math.max(0.5, Math.min(1.6, s));
};
// Weighted least squares of the miss on mu × z (weights 1 / mu, as for a
// count): x - mu ≈ mu × Σ beta_k z_k. Each beta held to ±3.
export function fitFactor(recs, muOf, zOf) {
  const rows = recs.map((r) => ({ m: muOf(r), x: r.x, z: zOf(r) })).filter((r) => r.z && r.m > 0);
  const k = rows[0]?.z.length || 0;
  if (!k || rows.length < 30) return null;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (const { m, x, z } of rows) {
    for (let i = 0; i < k; i++) {
      b[i] += (x - m) * z[i];
      for (let j = 0; j < k; j++) A[i][j] += m * z[i] * z[j];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-6 * rows.length; // keeps a flat input from blowing up
  // Gaussian elimination (k is 1 or 2).
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r2 = c + 1; r2 < k; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[piv][c])) piv = r2;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (!(Math.abs(M[c][c]) > 1e-12)) return null;
    for (let r2 = 0; r2 < k; r2++) {
      if (r2 === c) continue;
      const f = M[r2][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r2][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => round(Math.max(-3, Math.min(3, row[k] / row[i])), 4));
}

export function forecastMean({ sport, stat, history, home, opponent, group, context, absent = 0, env = null }) {
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
  rows.slice(0, spec.rateWindow).forEach((r, i) => { const w = 0.5 ** (i / spec.rateHalfLife); ro += w * opportunityOf(sport, spec, r); rs += w * valueOf(r, stat); });
  const rate = (rs + spec.priorUnits * g.rate) / (ro + spec.priorUnits);
  const opponentFactor = (opponent && context.teams?.[stat]?.[opponent]?.factor) || 1;
  const locationFactor = context.location?.[stat]?.[home ? 'home' : 'away'] || 1;
  const raw = expectedOpp * rate * opponentFactor * locationFactor;
  const absence = absenceFactor(context, stat, absent);
  // Game factors kept by the check (context.factors[stat][name].betas).
  const factors = {};
  let factor = 1;
  for (const name of GAME_FACTORS[sport] || []) {
    const f = context.factors?.[stat]?.[name];
    const z = factorInputs(name, sport, { env, history }, f || {});
    if (!z) continue;
    const m = f?.betas ? factorMult(f.betas, z) : 1;
    factors[name] = { z: z.map((v) => round(v, 3)), factor: round(m, 3), applied: Boolean(f?.betas) };
    factor *= m;
  }
  return {
    status: 'ok', raw_mean: raw, mean: corrected(context.correction?.[stat], raw) * absence * factor, absence_factor: absence, game_factor: factor, factors,
    expected_opportunity: expectedOpp, regular_role: expectedOpp >= spec.roleMin, rate, opponent_factor: opponentFactor, location_factor: locationFactor,
    games: rows.length, unit: spec.unit,
  };
}

// The forecast the pages show for one player, stat and game. With a side and
// threshold it adds that line's chances; `lines: true` adds the chance of the
// over at the half lines around the forecast (the player page, before a line
// is typed in).
// Early season: fewer than EARLY_GAMES[sport] usable games in the game's season,
// with earlier seasons behind them. `season` is the game's season (the
// newest history row's when left out).
export function earlySeason(sport, stat, history, season) {
  const rows = history.filter((r) => usableRow(sport, stat, r));
  const s = season ?? rows[0]?.season;
  if (s == null) return false;
  const current = rows.filter((r) => r.season === s).length;
  return current < (EARLY_GAMES[sport] ?? 0) && rows.some((r) => r.season != null && r.season < s);
}
// How past calls near this chance did on the holdout: the reliability bin
// the over chance falls in, turned to this pick's side.
function testedAt(ev, overChance, side) {
  const bins = ev?.test?.reliability;
  if (!Array.isArray(bins) || !(overChance >= 0 && overChance <= 1)) return null;
  const b = bins.find((x) => overChance >= x.lo && (overChance < x.hi || (x.hi >= 1 && overChance <= 1)));
  if (!b || b.n < 30) return null;
  const flip = (v) => (side === 'under' ? round(1 - v) : v);
  return { said: flip(b.mean_p), hit: flip(b.hit_rate), games: b.n };
}

// `absent`: minutes of regular teammates listed out for this game
// (absentMinutes below); NBA only, 0 when nobody is out or nothing is known.
// `env`: the team's side of the game spread and total (gameEnvironment), or
// null when none is posted.
export function forecastStat({ sport, stat, history, home, opponent, group, model, side, threshold, lines = false, season = null, absent = 0, env = null }) {
  if (!model?.context) return { status: 'not_calculated', reason: 'no_model' };
  const fc = forecastMean({ sport, stat, history, home, opponent, group, context: model.context, absent: sport === 'nba' ? absent : 0, env });
  if (fc.status !== 'ok') return fc;
  const spread = model.context.spread?.[stat];
  if (!spread || !Number.isFinite(spread.a) || !Number.isFinite(spread.b)) return { status: 'not_calculated', reason: 'no_model' };
  const dist = MODEL_SPECS[sport][stat].dist;
  // Models fitted before recalibration have none: the raw curve.
  const cal = model.context.calibration?.[stat] || null;
  // The check covers regular-role games only, so a smaller role is never
  // shown as validated.
  const quality = fc.regular_role && model.evaluation?.[stat]?.status === 'validated' ? 'validated' : 'experimental';
  const out = {
    status: 'ok', quality, regular_role: fc.regular_role, model_version: model.model_version, as_of_date: model.as_of_date || null,
    mean: round(fc.mean, 2), low: quantileOf(dist, fc.mean, spread, 0.1, cal), high: quantileOf(dist, fc.mean, spread, 0.9, cal),
    expected_opportunity: round(fc.expected_opportunity, 1), unit: fc.unit, rate: round(fc.rate, 4),
    opponent_factor: round(fc.opponent_factor, 3), location_factor: round(fc.location_factor, 3), games: fc.games,
  };
  if (sport === 'nba' && absent > 0) out.teammates_out = { minutes: round(absent, 1), factor: round(fc.absence_factor, 3), applied: fc.absence_factor !== 1 };
  if (env) out.game_lines = { total: env.total, team_total: env.team_total, team_margin: env.team_margin, source: env.source,
    factor: fc.factors.game_lines?.factor ?? 1, applied: Boolean(fc.factors.game_lines?.applied) };
  if (fc.factors.snap_trend) {
    const t = snapTrend(history);
    out.snap_trend = { recent: t?.recent ?? null, longer: t?.long ?? null, factor: fc.factors.snap_trend.factor, applied: fc.factors.snap_trend.applied };
  }
  const ev = model.evaluation?.[stat];
  if (earlySeason(sport, stat, history, season)) {
    const s = season ?? history.find((h) => usableRow(sport, stat, h))?.season;
    const es = ev?.early_season;
    out.early_season = { games_this_season: history.filter((r) => usableRow(sport, stat, r) && r.season === s).length,
      tested_games: es?.n ?? 0, tested_miss: es?.n >= 30 ? es.bias : null };
  }
  if (side && threshold != null && threshold !== '') {
    const ch = lineChances(fc.mean, spread, side, threshold, dist, cal);
    out.probability = round(ch.win); out.push = round(ch.push); out.loss = round(ch.loss);
    // How calls near this chance did on the holdout (the over chance's bin).
    out.tested = testedAt(ev, side === 'over' ? ch.win : ch.loss, side);
    // V4 §5.5: the same line if the minutes / attempts / targets run 10% lower or higher.
    const at = (k) => round(lineChances(corrected(model.context.correction?.[stat], fc.raw_mean * k) * fc.absence_factor * fc.game_factor, spread, side, threshold, dist, cal).win);
    out.sensitivity = { opportunity_down_10: at(0.9), opportunity_up_10: at(1.1) };
  }
  if (lines) out.lines = lineTable(fc.mean, spread, dist, 5, cal);
  out.recalibrated = Boolean(cal && !(cal.a === 0 && cal.b === 1));
  return out;
}

// The model's over chance at any line, from a forecast's mean (the MCP sets
// it beside each sportsbook line). Null when the stat is not modeled.
export function overChanceAt(model, sport, stat, mu, threshold) {
  const spec = MODEL_SPECS[sport]?.[stat], spread = model?.context?.spread?.[stat];
  if (!spec || !spread || !(mu > 0) || !Number.isFinite(Number(threshold))) return null;
  return round(lineChances(mu, spread, 'over', threshold, spec.dist, model.context.calibration?.[stat] || null).win);
}

export function lineTable(mu, spread, dist = 'nb', count = 5, cal = null) {
  const step = mu >= 60 ? 10 : 1;
  const start = Math.max(0.5, Math.floor(mu) + 0.5 - Math.floor(count / 2) * step);
  return Array.from({ length: count }, (_, i) => start + i * step).map((t) => ({ threshold: t, over: round(lineChances(mu, spread, 'over', t, dist, cal).win) }));
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
      recalibration: ev.calibration ? { applied: Boolean(ev.calibration.applied), a: ev.calibration.a, b: ev.calibration.b, why: ev.calibration.why || null } : null,
      early_season: ev.early_season || null,
      teammates_out: ev.teammates_out ? { applied: Boolean(ev.teammates_out.applied), beta: ev.teammates_out.beta, why: ev.teammates_out.why || null } : null,
      factors: ev.factors ? Object.fromEntries(Object.entries(ev.factors).map(([k, f]) => [k, { applied: Boolean(f.applied), games: f.games ?? 0, test: f.test ?? 0,
        brier_with: f.with?.brier ?? null, brier_without: f.without?.brier ?? null, why: f.why || null }])) : null,
      real_lines: ev.real_lines ? { n: ev.real_lines.n || 0, provided: ev.real_lines.provided || 0, enough: Boolean(ev.real_lines.enough),
        brier: ev.real_lines.brier || null, over_rate: ev.real_lines.over_rate ?? null, ece: ev.real_lines.ece ?? null, note: ev.real_lines.note || null } : null,
      // Reliability bins for the calibration chart: what the model said (p)
      // against how often it happened (y) on the held-out games.
      reliability: Array.isArray(ev.test?.reliability)
        ? ev.test.reliability.filter((b) => b && b.n > 0).map((b) => ({ p: b.mean_p, y: b.hit_rate, n: b.n }))
        : [],
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

// ---- Real lines (fix 4, since 2026-11-11) ------------------------------------------
// PrizePicks lines the site stored (the issued props record, and from
// 2026-11-11 every main line the props scan sees, `<sport>/lines/<date>.json`)
// let the holdout be scored at the line that was really posted instead of
// the last-10 stand-in. Baselines: the player's last-10 hit rate at that
// line (smoothed) and an even 50%. The model must beat both once 300 real
// lines are scored, or it is not validated.
const REAL_MIN = 300;
function realProvided(realLines, stat) {
  let n = 0;
  for (const l of realLines.values()) if (l.stat === stat) n++;
  return n;
}
function scoreRealLines({ test, half, muOf, sModel, dist, cal, provided }) {
  const ps = [], ys = [], l10 = [], dates = [], sources = { issued: 0, archive: 0 };
  test.forEach((r, i) => {
    if (r.real == null || r.x === r.real) return;
    const c = cal ? cal[half[i] ? 1 : 0] : null;
    const ch = lineChances(muOf(r), sModel, 'over', r.real, dist, c);
    const decided = ch.win + ch.loss;
    if (!(decided > 0)) return;
    ps.push(ch.win / decided); ys.push(r.x > r.real ? 1 : 0); dates.push(r.date);
    const prior = (r.last10 || []).filter((v) => v !== r.real);
    l10.push((prior.filter((v) => v > r.real).length + 1) / (prior.length + 2));
    sources[r.real_source === 'archive' ? 'archive' : 'issued'] += 1;
  });
  const n = ps.length;
  if (!n) return { n: 0, provided, not_scored: provided, note: provided ? 'no stored line matched a held-out regular-role game yet' : 'no real lines stored yet' };
  const even = ps.map(() => 0.5), rel = reliability(ps, ys);
  return {
    n, provided, not_scored: Math.max(0, provided - n), from: dates.reduce((a, b) => (a < b ? a : b)), to: dates.reduce((a, b) => (a > b ? a : b)), sources,
    over_rate: round(mean(ys)),
    brier: { model: round(brier(ps, ys)), last10_hit_rate: round(brier(l10, ys)), even: round(brier(even, ys)) },
    log_loss: { model: round(logLoss(ps, ys)), last10_hit_rate: round(logLoss(l10, ys)), even: round(logLoss(even, ys)) },
    ece: rel.ece, reliability: rel.bins,
    enough: n >= REAL_MIN,
  };
}

// `games`: the stored game records (their `lines` feed the game-lines
// factor). `research`: { names, inputs(row, game) → { name: z } } adds
// factors that are checked the same way but never served (offline tests);
// `research.off` leaves the served factors out (to measure them).
export function buildModel({ sport, rows, now = Date.now(), includeJoint = true, lines = [], games = [], research = null }) {
  const stats = Object.keys(MODEL_SPECS[sport]);
  const gameMap = new Map((Array.isArray(games) ? games : []).map((g) => [g.game_id, g]));
  const factorNames = [...(research?.off ? [] : GAME_FACTORS[sport] || []), ...(research?.names || [])];
  // The league's average implied team points, over the games with lines.
  const lined = [...gameMap.values()].filter((g) => g.lines && Number.isFinite(g.lines.total));
  const scale = { avg_team_total: lined.length ? round(mean(lined.map((g) => g.lines.total / 2)), 3) : null };
  const sorted = rows.filter((r) => r && r.date).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.game_id).localeCompare(String(b.game_id)) || String(a.player_id).localeCompare(String(b.player_id)));
  const days = new Map();
  for (const r of sorted) { if (!days.has(r.date)) days.set(r.date, []); days.get(r.date).push(r); }
  const state = newState(sport);
  const histories = new Map();
  const records = Object.fromEntries(stats.map((s) => [s, []]));
  // Real lines to score (fix 4): one per game, player and stat.
  const realLines = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || !MODEL_SPECS[sport]?.[l.stat] || typeof l.threshold !== 'number' || !Number.isFinite(l.threshold)) continue;
    const key = l.game_id + '|' + l.player_id + '|' + l.stat;
    const prior = realLines.get(key);
    if (!prior || (prior.source !== 'archive' && l.source === 'archive')) realLines.set(key, l);
  }
  for (const [date, dayRows] of days) {
    const context = contextOf(state);
    const absent = sport === 'nba' ? absentMinutesByTeam(date, dayRows, histories) : null;
    for (const row of dayRows) {
      const hist = histories.get(row.player_id);
      if (!hist) continue;
      // One game's factor inputs, shared by every stat's record.
      const game = gameMap.get(row.game_id);
      const inputs = { env: gameEnvironment(game, row.team), history: lastPlayed(hist.list, 8), extra: research?.inputs?.(row, game) || null };
      const fz = Object.fromEntries(factorNames.map((n) => [n, factorInputs(n, sport, inputs, scale)]));
      for (const stat of stats) {
        if (!usableRow(sport, stat, row)) continue;
        const prior = hist.list.filter((r) => usableRow(sport, stat, r));
        if (prior.length < MIN_GAMES) continue;
        const recent = prior.slice(-60).reverse();
        const fc = forecastMean({ sport, stat, history: recent, home: row.home, opponent: row.opponent, group: positionGroup(sport, row.position || recent[0].position), context });
        if (fc.status !== 'ok' || !fc.regular_role) continue;
        const last10 = recent.slice(0, 10).map((r) => valueOf(r, stat));
        const avg10 = mean(last10), line = Math.floor(avg10) + 0.5;
        const real = realLines.get(row.game_id + '|' + row.player_id + '|' + stat);
        records[stat].push({
          date, game_id: row.game_id, team: row.team, player_id: row.player_id, mu: fc.raw_mean, x: valueOf(row, stat), line, avg10,
          early: earlySeason(sport, stat, recent, row.season),
          avgAll: mean(prior.map((r) => valueOf(r, stat))), hits10: last10.filter((v) => v > line).length, n10: last10.length,
          absent: absent?.get(row.team) || 0, fz,
          ...(real ? { real: real.threshold, real_source: real.source, last10 } : {}),
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
  const evaluation = {}, spread = {}, correction = {}, calibration = {}, absence = {}, factors = {}, zScores = [];
  const zOf = (r) => Math.min(r.absent || 0, 120) / ABSENCE.teamMinutes;
  for (const stat of stats) {
    const recs = records[stat], dist = MODEL_SPECS[sport][stat].dist;
    // What later forecasts use: fitted on every scored game.
    correction[stat] = fitCorrection(recs.map((r) => [r.mu, r.x]));
    const dates = [...new Set(recs.map((r) => r.date))].sort();
    const enough = dates.length >= 4;
    // The check: fit on the earlier days only, score the later days.
    const split = enough ? dates[Math.floor(dates.length * TRAIN_SHARE)] : null;
    const train = enough ? recs.filter((r) => r.date < split) : [], test = enough ? recs.filter((r) => r.date >= split) : [];
    const cTrain = fitCorrection(train.map((r) => [r.mu, r.x]));
    const muBase = (r) => corrected(cTrain, r.mu);
    const ys = test.map((r) => (r.x > r.line ? 1 : 0));
    // Teammates out (NBA): fitted on the earlier days, kept only when it
    // beats no adjustment on the later days on both scores.
    let muOf = muBase, absenceCheck = null, beta = 0;
    if (sport === 'nba' && enough) {
      const bTrain = fitAbsence(train, muBase);
      const adj = (r) => muBase(r) * (1 + bTrain * zOf(r));
      const s0 = fitSpread(train.map((r) => [muBase(r), r.x])), s1 = fitSpread(train.map((r) => [adj(r), r.x]));
      const p0 = test.map((r) => 1 - cdfAt(dist, muBase(r), s0, Math.floor(r.line)));
      const p1 = test.map((r) => 1 - cdfAt(dist, adj(r), s1, Math.floor(r.line)));
      const without = { brier: round(brier(p0, ys)), log_loss: round(logLoss(p0, ys)) }, withIt = { brier: round(brier(p1, ys)), log_loss: round(logLoss(p1, ys)) };
      const used = bTrain > 0 && withIt.brier < without.brier && withIt.log_loss < without.log_loss;
      if (used) { muOf = adj; beta = fitAbsence(recs, (r) => corrected(correction[stat], r.mu)); }
      absenceCheck = { applied: used, beta, beta_check: bTrain, games_with_absences: round(test.filter((r) => r.absent > 0).length / Math.max(1, test.length), 3), without, with: withIt,
        why: used ? 'raised the forecast when regulars were out and beat no adjustment on the holdout' : bTrain > 0 ? 'did not beat no adjustment on the holdout; not used' : 'no lift measured; not used' };
    }
    absence[stat] = { beta };
    // Game factors, one at a time on top of what is kept so far. Each is
    // fitted on the earlier dates among the games that have its input and
    // scored on the later ones. In the main check below a kept factor moves
    // the training days and the games on or after its own split, never a
    // scored game that helped fit it.
    let fullMu = (r) => corrected(correction[stat], r.mu) * (1 + beta * zOf(r));
    const factorChecks = {};
    factors[stat] = {};
    for (const name of factorNames) {
      const fzOf = (r) => r.fz?.[name] || null;
      const has = recs.filter(fzOf);
      const fDates = [...new Set(has.map((r) => r.date))].sort();
      const fSplit = fDates.length >= 4 ? fDates[Math.floor(fDates.length * TRAIN_SHARE)] : null;
      const fTrain = fSplit ? has.filter((r) => r.date < fSplit) : [], fTest = fSplit ? has.filter((r) => r.date >= fSplit) : [];
      const served = (GAME_FACTORS[sport] || []).includes(name);
      if (served) factors[stat][name] = name === 'game_lines' ? { betas: null, avg_team_total: scale.avg_team_total } : { betas: null };
      if (fTrain.length < FACTOR_MIN || fTest.length < FACTOR_MIN) {
        factorChecks[name] = { applied: false, games: has.length, why: `fewer than ${FACTOR_MIN} games with this input on each side of the check yet` };
        continue;
      }
      const bTrain = fitFactor(fTrain, muOf, fzOf);
      if (!bTrain) { factorChecks[name] = { applied: false, games: has.length, why: 'no lift measured; not used' }; continue; }
      const adj = (r) => muOf(r) * factorMult(bTrain, fzOf(r));
      const s0 = fitSpread(fTrain.map((r) => [muOf(r), r.x])), s1 = fitSpread(fTrain.map((r) => [adj(r), r.x]));
      const yT = fTest.map((r) => (r.x > r.line ? 1 : 0));
      const p0 = fTest.map((r) => 1 - cdfAt(dist, muOf(r), s0, Math.floor(r.line)));
      const p1 = fTest.map((r) => 1 - cdfAt(dist, adj(r), s1, Math.floor(r.line)));
      const without = { brier: round(brier(p0, yT)), log_loss: round(logLoss(p0, yT)) }, withIt = { brier: round(brier(p1, yT)), log_loss: round(logLoss(p1, yT)) };
      // How sure the gain is: the Brier gain per game and its standard
      // error, with games on one date counted together (they share news).
      // A factor is kept only when it beats leaving it out on both scores
      // AND its gain is larger than that standard error (not noise).
      const byDay = new Map();
      fTest.forEach((r, i) => byDay.set(r.date, (byDay.get(r.date) || 0) + (p0[i] - yT[i]) ** 2 - (p1[i] - yT[i]) ** 2));
      const gain = { brier: round(mean(fTest.map((_, i) => (p0[i] - yT[i]) ** 2 - (p1[i] - yT[i]) ** 2)), 5),
        se: round(Math.sqrt([...byDay.values()].reduce((a, v) => a + v * v, 0)) / fTest.length, 5) };
      const beats = brier(p1, yT) < brier(p0, yT) && logLoss(p1, yT) < logLoss(p0, yT); // unrounded
      const used = beats && gain.brier > gain.se;
      let betas = null;
      if (used) betas = fitFactor(has, fullMu, fzOf) || bTrain;
      // A research-only factor is reported, never folded into the served model.
      if (used && served) {
        const prior = muOf, priorFull = fullMu, kept = betas;
        muOf = (r) => ((r.date < (split || '') || r.date >= fSplit) && fzOf(r) ? prior(r) * factorMult(bTrain, fzOf(r)) : prior(r));
        fullMu = (r) => priorFull(r) * factorMult(kept, fzOf(r));
        factors[stat][name].betas = kept;
      }
      factorChecks[name] = { applied: used && served, ...(served ? {} : { research_only: true, would_apply: used }), betas: betas || null, betas_check: bTrain,
        games: has.length, train: fTrain.length, test: fTest.length, split_date: fSplit, without, with: withIt, gain,
        why: used ? 'beat leaving it out on the later games by more than the noise' + (served ? '' : ' (research only, not served)')
          : beats ? 'gain on the later games was within the noise; not used' : 'did not beat leaving it out on the later games; not used' };
    }
    spread[stat] = fitSpread(recs.map((r) => [fullMu(r), r.x]));
    // Where each result fell on its forecast's curve, as a normal score
    // (the middle of its step, so whole-number stats are not pushed to an
    // edge). These measure the same-game links.
    const score = (m, s, r) => invNorm((cdfAt(dist, m, s, r.x - 1) + cdfAt(dist, m, s, r.x)) / 2);
    const out = recs.map((r) => ({ stat, game_id: r.game_id, team: r.team, player_id: r.player_id, z: score(fullMu(r), spread[stat], r) }));
    zScores.push(...out);
    if (!enough) { calibration[stat] = { a: 0, b: 1 }; evaluation[stat] = { status: 'experimental', reason: 'not enough past games to check yet', forecasts: recs.length, test: null }; continue; }
    const sModel = fitSpread(train.map((r) => [muOf(r), r.x])), sAvg = fitSpread(train.map((r) => [r.avgAll, r.x]));
    const pRaw = test.map((r) => 1 - cdfAt(dist, muOf(r), sModel, Math.floor(r.line)));
    // The recalibration: fitted on the whole holdout, checked cross-fitted on
    // its two halves (by date) so each scored game is predicted by a fit that
    // never saw it, and used only when that check beats the raw chances on
    // both Brier score and log loss.
    const fitted = fitCalibration(pRaw, ys);
    const testDates = [...new Set(test.map((r) => r.date))];
    const mid = testDates[Math.floor(testDates.length / 2)];
    const half = test.map((r) => r.date < mid);
    const fitOn = (inFirst) => fitCalibration(pRaw.filter((_, i) => half[i] === inFirst), ys.filter((_, i) => half[i] === inFirst));
    const calFirst = fitOn(true), calSecond = fitOn(false);
    const pCross = pRaw.map((p, i) => calibrate(half[i] ? calSecond : calFirst, p));
    const cross = { brier: round(brier(pCross, ys)), log_loss: round(logLoss(pCross, ys)), ece: reliability(pCross, ys).ece };
    const raw = { brier: round(brier(pRaw, ys)), log_loss: round(logLoss(pRaw, ys)), ece: reliability(pRaw, ys).ece };
    const changes = !(fitted.a === 0 && fitted.b === 1);
    // Compared unrounded: a 4-decimal tie must not decide it (2026-11-11).
    const applied = changes && calFirst.n >= 200 && calSecond.n >= 200
      && brier(pCross, ys) < brier(pRaw, ys) && logLoss(pCross, ys) < logLoss(pRaw, ys);
    calibration[stat] = applied ? { a: fitted.a, b: fitted.b } : { a: 0, b: 1 };
    const pModel = applied ? pCross : pRaw;
    // Early-season forecasts on the holdout: how far the mean ran off.
    const early = test.filter((r) => r.early);
    const earlySeasonCheck = { n: early.length, bias: early.length ? round(mean(early.map((r) => muOf(r) - r.x)), 2) : null };
    const pAvg = test.map((r) => 1 - cdfAt(dist, r.avgAll, sAvg, Math.floor(r.line)));
    const pLast10 = test.map((r) => (r.hits10 + 1) / (r.n10 + 2));
    recs.forEach((r, i) => { if (r.date < split) out[i].zTrain = score(muOf(r), sModel, r); });
    let ti = 0;
    recs.forEach((r, i) => { if (r.date >= split) { out[i].pTest = pModel[ti]; out[i].y = ys[ti]; ti++; } });
    const rel = reliability(pModel, ys);
    const scores = { model: round(brier(pModel, ys)), last10_hit_rate: round(brier(pLast10, ys)), plain_average: round(brier(pAvg, ys)) };
    // Real lines (fix 4): the same held-out forecasts, scored at the line
    // PrizePicks actually posted. Pushes on whole-number lines are left out.
    const realCheck = scoreRealLines({ test, half, muOf, sModel, dist, cal: applied ? [calFirst, calSecond] : null, provided: realProvided(realLines, stat) });
    let validated = test.length >= 300 && scores.model < scores.last10_hit_rate && scores.model < scores.plain_average && rel.ece <= 0.03;
    let reason = validated ? null : test.length < 300 ? 'fewer than 300 holdout games' : rel.ece > 0.03 ? 'chances were off by more than 3 points on average' : 'did not beat both simple baselines';
    if (validated && realCheck.n >= REAL_MIN && !(realCheck.brier.model < realCheck.brier.last10_hit_rate && realCheck.brier.model < realCheck.brier.even)) {
      validated = false; reason = 'did not beat both simple baselines on real PrizePicks lines';
    }
    evaluation[stat] = {
      status: validated ? 'validated' : 'experimental',
      reason,
      forecasts: recs.length,
      split_date: split,
      calibration: { method: 'platt', applied, a: fitted.a, b: fitted.b, fitted_on: fitted.n, cross_fit: cross, raw,
        why: applied ? 'beat the raw chances on the holdout, cross-fitted' : changes ? 'did not beat the raw chances on the holdout, cross-fitted; raw chances kept' : 'too few holdout games to fit' },
      ...(absenceCheck ? { teammates_out: absenceCheck } : {}),
      factors: factorChecks,
      early_season: earlySeasonCheck,
      real_lines: realCheck,
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
    line_proxy: 'the player’s last-10 average rounded to a half point; real PrizePicks lines are scored separately as they are stored (real_lines)',
    scored: 'regular-role games only (' + stats.map((st) => MODEL_SPECS[sport][st].roleMin + '+ expected ' + MODEL_SPECS[sport][st].unit).filter((v, i, a) => a.indexOf(v) === i).join('; ') + ')',
    context: contextOf(state, spread, correction, calibration, absence, factors),
    evaluation,
    joint: includeJoint ? fitJoint(zScores) : null,
  };
}


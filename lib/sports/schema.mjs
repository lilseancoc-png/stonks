// Sports record contracts (roadmap V4 §3.2 / §4). Every adapter (nflverse,
// hoopR, an owner CSV) normalizes into these shapes before anything is stored,
// so the boards, Pick Builder, models and MCP read one format. Validators
// return { ok, errors } and never throw on bad input.
import { createHash } from 'node:crypto';

export const SPORTS_SCHEMA_VERSION = 1;
export const SPORTS = Object.freeze(['nba', 'nfl']);

// Supported markets. `enabled` stats have models and boards in the first
// releases; the rest are reserved names so stored records never need renaming.
export const SPORTS_STATS = Object.freeze({
  nba: Object.freeze([
    { id: 'points', label: 'Points', enabled: true },
    { id: 'rebounds', label: 'Rebounds', enabled: true },
    { id: 'assists', label: 'Assists', enabled: false },
    { id: 'threes', label: '3-pointers made', enabled: false },
    { id: 'pra', label: 'Points + rebounds + assists', enabled: false },
  ]),
  nfl: Object.freeze([
    { id: 'passing_yards', label: 'Passing yards', enabled: true },
    { id: 'receptions', label: 'Receptions', enabled: true },
    { id: 'rushing_yards', label: 'Rushing yards', enabled: false },
    { id: 'receiving_yards', label: 'Receiving yards', enabled: false },
    { id: 'touchdowns', label: 'Touchdowns', enabled: false },
  ]),
});

export const PERIODS = Object.freeze(['full_game']);
export const SIDES = Object.freeze(['over', 'under']);
export const GAME_STATUSES = Object.freeze(['scheduled', 'in_progress', 'final', 'postponed', 'canceled']);
export const OPERATORS = Object.freeze(['prizepicks', 'betr', 'other']);
export const SOURCES = Object.freeze(['manual', 'screenshot', 'import', 'provider']);

const ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,95}$/;
const isoOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const nonNegInt = (v) => Number.isInteger(v) && v >= 0;
const text = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function check(errors, cond, msg) { if (!cond) errors.push(msg); }
function done(errors) { return { ok: errors.length === 0, errors }; }
function sportOk(errors, sport) { check(errors, SPORTS.includes(sport), 'sport must be nba or nfl'); }

export function statIds(sport, { enabledOnly = false } = {}) {
  return (SPORTS_STATS[sport] || []).filter((s) => !enabledOnly || s.enabled).map((s) => s.id);
}

export function validId(v) { return typeof v === 'string' && ID_RE.test(v); }

export function validateGame(g) {
  const e = [];
  if (!g || typeof g !== 'object') return done(['game must be an object']);
  sportOk(e, g.sport);
  check(e, validId(g.game_id), 'game_id is required');
  check(e, Number.isInteger(g.season) && g.season >= 1946 && g.season <= 2100, 'season must be a year');
  check(e, isoOk(g.start_utc), 'start_utc must be an ISO timestamp');
  check(e, validId(g.home_team) && validId(g.away_team) && g.home_team !== g.away_team, 'home_team and away_team must be two team ids');
  check(e, GAME_STATUSES.includes(g.status), 'status is not recognized');
  if (g.status === 'final') check(e, nonNegInt(g.home_score) && nonNegInt(g.away_score), 'a final game needs both scores');
  if (g.week != null) check(e, Number.isInteger(g.week) && g.week >= 0 && g.week <= 30, 'week must be 0-30');
  return done(e);
}

export function validatePlayer(p) {
  const e = [];
  if (!p || typeof p !== 'object') return done(['player must be an object']);
  sportOk(e, p.sport);
  check(e, validId(p.player_id), 'player_id is required');
  check(e, text(p.name, 80), 'name is required');
  check(e, p.provider_ids && typeof p.provider_ids === 'object' && !Array.isArray(p.provider_ids), 'provider_ids must be an object');
  if (Array.isArray(p.teams)) {
    for (const t of p.teams) check(e, validId(t.team) && /^\d{4}-\d{2}-\d{2}$/.test(t.from) && (t.to == null || /^\d{4}-\d{2}-\d{2}$/.test(t.to)), 'team memberships need team, from and optional to dates');
  }
  return done(e);
}

// One player in one game. `played: false` is a DNP and keeps zero minutes;
// it is stored, never silently dropped, so hit rates can count it.
export function validatePlayerGame(r) {
  const e = [];
  if (!r || typeof r !== 'object') return done(['player game must be an object']);
  sportOk(e, r.sport);
  check(e, validId(r.player_id) && validId(r.game_id), 'player_id and game_id are required');
  check(e, validId(r.team) && validId(r.opponent) && r.team !== r.opponent, 'team and opponent are required');
  check(e, typeof r.home === 'boolean', 'home must be true or false');
  check(e, typeof r.played === 'boolean', 'played must be true or false');
  const stats = r.stats && typeof r.stats === 'object' ? r.stats : null;
  check(e, !!stats, 'stats must be an object');
  if (stats) {
    for (const [k, v] of Object.entries(stats)) {
      check(e, v === null || (typeof v === 'number' && Number.isFinite(v) && v >= (k === 'passing_yards' || k === 'rushing_yards' || k === 'receiving_yards' ? -99 : 0)), `stat ${k} must be a number or null`);
    }
    if (r.sport === 'nba' && r.played) check(e, typeof r.minutes === 'number' && r.minutes >= 0 && r.minutes <= 70, 'NBA rows need minutes when played');
    if (r.sport === 'nfl' && stats.receptions != null && stats.targets != null) check(e, stats.receptions <= stats.targets, 'receptions cannot exceed targets');
  }
  return done(e);
}

// A line the owner saw on an operator's app (typed in or read from a
// screenshot by Claude/ChatGPT). Observations are appended, never edited.
export function validateMarketObservation(o) {
  const e = [];
  if (!o || typeof o !== 'object') return done(['observation must be an object']);
  sportOk(e, o.sport);
  check(e, OPERATORS.includes(o.operator), 'operator is not recognized');
  check(e, validId(o.game_id) && validId(o.player_id), 'game_id and player_id are required');
  check(e, statIds(o.sport).includes(o.stat), 'stat is not supported for this sport');
  check(e, PERIODS.includes(o.period || 'full_game'), 'period must be full_game');
  check(e, SIDES.includes(o.side), 'side must be over or under');
  check(e, typeof o.threshold === 'number' && Number.isFinite(o.threshold) && o.threshold >= 0 && o.threshold <= 1000 && Math.round(o.threshold * 2) === o.threshold * 2, 'threshold must be a whole or half number');
  check(e, isoOk(o.observed_at), 'observed_at must be an ISO timestamp');
  check(e, SOURCES.includes(o.source), 'source is not recognized');
  return done(e);
}

// Stable id for one market over time (V4 §4): it stays the same when the
// threshold moves from 19.5 to 21.5, so line movement is a series of
// observations under one key. The threshold and side are NOT in the key.
export function marketSeriesKey(o, { comparisonFamily = 'over_under', contractFamily = 'pickem', settlementRuleVersion = 1 } = {}) {
  const parts = [o.operator, o.sport, o.game_id, o.player_id, o.stat, o.period || 'full_game', comparisonFamily, contractFamily, 'v' + settlementRuleVersion];
  if (parts.some((p) => typeof p !== 'string' || !p)) throw new Error('market series key needs operator, sport, game, player and stat');
  return 'ms_' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

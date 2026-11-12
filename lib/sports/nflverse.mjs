// nflverse adapter (https://github.com/nflverse/nflverse-data, CC BY 4.0).
// Pure functions: CSV rows in, Sports records out (lib/sports/schema.mjs).
// The schedule file also carries sportsbook numbers. Since adapter 2
// (2026-11-11, owner OK) the game spread and total are kept as `lines` (the
// stat model tests them as an input and keeps them only when they beat its
// holdout). Since 2026-11-12 the moneylines and spread / total prices are
// kept too, for the team game model's book comparison (lib/sports/team-model.mjs).
//
// Adapter 2 also reads the snap counts (games where a player was on the field
// but recorded no stat are missing from the weekly stats file, which inflated
// over hit rates) and the official injury and practice report.
import { zonedTimeUtc } from './time.mjs';
import { parseCsv } from './csv.mjs';
import { validateGame, validatePlayer, validatePlayerGame } from './schema.mjs';

export const NFL_ADAPTER_VERSION = 2;
const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download/';
export const NFLVERSE_URLS = Object.freeze({
  games: RELEASES + 'schedules/games.csv',
  players: RELEASES + 'players/players.csv',
  weekly: (season) => RELEASES + 'stats_player/stats_player_week_' + season + '.csv',
  snaps: (season) => RELEASES + 'snap_counts/snap_counts_' + season + '.csv',
  injuries: (season) => RELEASES + 'injuries/injuries_' + season + '.csv',
});

// Offensive players only: the stats Sports covers come from these groups.
export const NFL_POSITION_GROUPS = Object.freeze(['QB', 'RB', 'WR', 'TE']);
const POST_TYPES = new Set(['WC', 'DIV', 'CON', 'SB', 'POST']);

const lower = (v) => String(v ?? '').trim().toLowerCase();
const numOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (s === '' || s === 'NA') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => { const n = numOrNull(v); return n == null ? null : Math.round(n); };
const textOrNull = (v, max = 80) => {
  const s = String(v ?? '').trim();
  return s && s !== 'NA' ? s.slice(0, max) : null;
};

export function nflGameId(raw) {
  return lower(raw).replace(/[^a-z0-9_]/g, '');
}

// The game total and the expected home margin (nflverse `spread_line`: a
// positive number means the home team is favored by that many points). A
// finished game keeps its closing numbers; an upcoming game has them about a
// week ahead and they move until kickoff.
// Since 2026-11-12 (team bets) the schedule's American prices ride along as
// `prices` (moneylines, spread and total odds) so the team game model can
// show the books' own no-vig chance beside its own; a price outside ±100 to
// ±100000 is left out.
const americanOrNull = (v) => { const n = intOrNull(v); return n != null && Math.abs(n) >= 100 && Math.abs(n) <= 100000 ? n : null; };
function gamePrices(r) {
  const p = { home_ml: americanOrNull(r.home_moneyline), away_ml: americanOrNull(r.away_moneyline), home_spread: americanOrNull(r.home_spread_odds), away_spread: americanOrNull(r.away_spread_odds), over: americanOrNull(r.over_odds), under: americanOrNull(r.under_odds) };
  return Object.values(p).some((v) => v != null) ? { prices: Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)) } : {};
}
function gameLines(r) {
  const total = numOrNull(r.total_line), margin = numOrNull(r.spread_line);
  if (total == null || margin == null || !(total > 0 && total <= 150) || Math.abs(margin) > 60) return {};
  return { lines: { total, home_margin: margin, source: 'nflverse', ...gamePrices(r) } };
}
// Days since each team's previous game (nflverse `home_rest` / `away_rest`).
function gameRest(r) {
  const home = intOrNull(r.home_rest), away = intOrNull(r.away_rest);
  return home == null && away == null ? {} : { rest_days: { home, away } };
}

// games.csv → one record per game in `seasons` (all seasons when omitted).
export function normalizeNflGames(rows, { seasons } = {}) {
  const want = seasons ? new Set(seasons) : null;
  const games = [], rejected = [];
  for (const r of rows) {
    const season = intOrNull(r.season);
    if (want && !want.has(season)) continue;
    const homeScore = intOrNull(r.home_score), awayScore = intOrNull(r.away_score);
    const timeKnown = /^\d{1,2}:\d{2}$/.test(String(r.gametime || '').trim());
    let start = null;
    try { start = new Date(zonedTimeUtc(String(r.gameday || '').trim(), timeKnown ? r.gametime.trim() : '13:00', 'America/New_York')).toISOString(); } catch { start = null; }
    const g = {
      sport: 'nfl',
      game_id: nflGameId(r.game_id),
      season,
      week: intOrNull(r.week),
      season_type: POST_TYPES.has(String(r.game_type || '').trim()) ? 'POST' : 'REG',
      start_utc: start,
      time_tbd: !timeKnown,
      local_date: String(r.gameday || '').trim(),
      home_team: lower(r.home_team),
      away_team: lower(r.away_team),
      status: homeScore != null && awayScore != null ? 'final' : 'scheduled',
      home_score: homeScore,
      away_score: awayScore,
      overtime: String(r.overtime || '').trim() === '1',
      neutral: String(r.location || '').trim() === 'Neutral',
      venue: textOrNull(r.stadium),
      roof: textOrNull(r.roof, 20),
      ...gameLines(r),
      ...gameRest(r),
      provider_ids: { nflverse: textOrNull(r.game_id, 40), espn: textOrNull(r.espn, 20), pfr: textOrNull(r.pfr, 20) },
    };
    const v = validateGame(g);
    if (v.ok) games.push(g); else rejected.push({ id: r.game_id, errors: v.errors });
  }
  games.sort((a, b) => a.start_utc.localeCompare(b.start_utc) || a.game_id.localeCompare(b.game_id));
  return { games, rejected };
}

// stats_player_week_<season>.csv → one row per player per game. nflverse
// lists only players who recorded a stat; `snaps` (normalizeNflSnaps) fills
// in the rest: every row gets the player's offensive snaps and snap share,
// and a game where he played offensive snaps with no stat row becomes a zero
// row (`source: 'snaps'`), so averages and hit rates count it.
export function normalizeNflPlayerGames(rows, gamesById, snaps = null) {
  const out = [], rejected = [];
  for (const r of rows) {
    if (!NFL_POSITION_GROUPS.includes(String(r.position_group || '').trim())) continue;
    const team = lower(r.team), opponent = lower(r.opponent_team);
    let gameId = nflGameId(r.game_id);
    let game = gamesById.get(gameId);
    if (!game) {
      // Older files can miss game_id; recover it from the schedule.
      const season = intOrNull(r.season), week = intOrNull(r.week);
      game = [...gamesById.values()].find((g) => g.season === season && g.week === week &&
        ((g.home_team === team && g.away_team === opponent) || (g.home_team === opponent && g.away_team === team)));
      gameId = game?.game_id || gameId;
    }
    if (!game) { rejected.push({ id: r.player_id + '@' + r.game_id, errors: ['game not in the schedule'] }); continue; }
    const rushTd = intOrNull(r.rushing_tds), recTd = intOrNull(r.receiving_tds);
    const row = {
      sport: 'nfl',
      player_id: lower(r.player_id),
      game_id: gameId,
      season: game.season,
      week: game.week,
      season_type: game.season_type,
      date: game.local_date,
      team,
      opponent,
      home: game.home_team === team,
      played: true,
      position: textOrNull(r.position, 8),
      stats: {
        passing_yards: intOrNull(r.passing_yards),
        completions: intOrNull(r.completions),
        attempts: intOrNull(r.attempts),
        passing_tds: intOrNull(r.passing_tds),
        interceptions: intOrNull(r.passing_interceptions),
        carries: intOrNull(r.carries),
        rushing_yards: intOrNull(r.rushing_yards),
        rushing_tds: rushTd,
        receptions: intOrNull(r.receptions),
        targets: intOrNull(r.targets),
        receiving_yards: intOrNull(r.receiving_yards),
        receiving_tds: recTd,
        touchdowns: rushTd == null && recTd == null ? null : (rushTd || 0) + (recTd || 0),
      },
    };
    const snap = snaps?.byKey.get(row.player_id + '|' + gameId);
    if (snap) { row.snaps = snap.snaps; row.snap_pct = snap.snap_pct; }
    const v = validatePlayerGame(row);
    if (v.ok) out.push(row); else rejected.push({ id: r.player_id + '@' + r.game_id, errors: v.errors });
  }
  const zero = { added: 0, unmapped: snaps?.unmapped || 0 };
  if (snaps) {
    const have = new Set(out.map((r) => r.player_id + '|' + r.game_id));
    for (const [key, snap] of snaps.byKey) {
      if (have.has(key) || !(snap.snaps > 0)) continue;
      const game = gamesById.get(snap.game_id);
      if (!game || ![game.home_team, game.away_team].includes(snap.team)) continue;
      const row = {
        sport: 'nfl', player_id: snap.player_id, game_id: game.game_id, season: game.season, week: game.week,
        season_type: game.season_type, date: game.local_date, team: snap.team,
        opponent: game.home_team === snap.team ? game.away_team : game.home_team, home: game.home_team === snap.team,
        played: true, position: snap.position, snaps: snap.snaps, snap_pct: snap.snap_pct, source: 'snaps',
        stats: Object.fromEntries(NFL_ZERO_STATS.map((k) => [k, 0])),
      };
      if (validatePlayerGame(row).ok) { out.push(row); zero.added++; }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id) || a.player_id.localeCompare(b.player_id));
  return { rows: out, rejected, zero };
}
const NFL_ZERO_STATS = ['passing_yards', 'completions', 'attempts', 'passing_tds', 'interceptions', 'carries', 'rushing_yards', 'rushing_tds',
  'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'touchdowns'];
// Snap-count positions of the offensive groups Sports covers.
const SNAP_GROUP = { QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE' };

// snap_counts_<season>.csv (Pro Football Reference ids) → offensive snaps per
// player and game, keyed `gsis id|game id`. `pfrToPlayer` maps a PFR id to the
// players file row (gsis id + position). Rows of other positions are skipped;
// a skill-position row with no gsis match is counted as `unmapped`.
export function normalizeNflSnaps(rows, pfrToPlayer) {
  const byKey = new Map();
  let unmapped = 0;
  for (const r of rows) {
    const group = SNAP_GROUP[String(r.position || '').trim().toUpperCase()];
    if (!group) continue;
    const snaps = intOrNull(r.offense_snaps), pct = numOrNull(r.offense_pct);
    if (snaps == null) continue;
    const person = pfrToPlayer.get(String(r.pfr_player_id || '').trim());
    if (!person) { if (snaps > 0) unmapped++; continue; }
    const gameId = nflGameId(r.game_id);
    byKey.set(person.player_id + '|' + gameId, {
      player_id: person.player_id, game_id: gameId, team: lower(r.team),
      position: person.position || String(r.position || '').trim().toUpperCase().slice(0, 8),
      snaps, snap_pct: pct == null ? null : Math.round(Math.max(0, Math.min(1, pct)) * 1000) / 1000,
    });
  }
  return { byKey, unmapped };
}
export function pfrIndex(playerRows) {
  const out = new Map();
  for (const r of playerRows) {
    const pfr = String(r.pfr_id || '').trim(), id = lower(r.gsis_id);
    if (pfr && pfr !== 'NA' && id) out.set(pfr, { player_id: id, position: textOrNull(r.position, 8) });
  }
  return out;
}

// injuries_<season>.csv → the official NFL injury and practice report for the
// newest week in the file, one entry per player (gsis id). A team with no
// rows that week (a bye, or no report filed yet) has no entries. Game status
// is the report's designation (Out, Doubtful, Questionable; blank = no
// designation); practice is the last listed practice participation.
export function normalizeNflInjuries(rows, { season } = {}) {
  const list = rows.filter((r) => intOrNull(r.season) === season || season == null);
  const week = list.reduce((m, r) => Math.max(m, intOrNull(r.week) ?? 0), 0);
  if (!week) return { week: null, reports: [] };
  const reports = [];
  for (const r of list) {
    if (intOrNull(r.week) !== week) continue;
    const id = lower(r.gsis_id);
    if (!id) continue;
    reports.push({
      player_id: id, name: textOrNull(r.full_name) || [r.first_name, r.last_name].filter(Boolean).join(' '),
      team: lower(r.team), position: textOrNull(r.position, 8),
      game_status: textOrNull(r.report_status, 30), injury: textOrNull(r.report_primary_injury, 60) || textOrNull(r.practice_primary_injury, 60),
      practice: textOrNull(r.practice_status, 60),
    });
  }
  reports.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  return { week, reports };
}

// players.csv → the players that appear in the stored game logs, plus active
// offensive players of `season` who have not recorded a stat yet.
export function normalizeNflPlayers(rows, { keepIds, season }) {
  const players = [];
  for (const r of rows) {
    const id = lower(r.gsis_id);
    if (!id) continue;
    const group = String(r.position_group || '').trim();
    const active = String(r.status || '').trim() === 'ACT' && NFL_POSITION_GROUPS.includes(group) && intOrNull(r.last_season) >= season;
    if (!keepIds.has(id) && !active) continue;
    const p = {
      sport: 'nfl',
      player_id: id,
      name: textOrNull(r.display_name) || [r.first_name, r.last_name].filter(Boolean).join(' '),
      position: textOrNull(r.position, 8),
      team: lower(r.latest_team) || null,
      status: textOrNull(r.status, 12),
      last_season: intOrNull(r.last_season),
      provider_ids: { gsis: textOrNull(r.gsis_id, 20), espn: textOrNull(r.espn_id, 20), pfr: textOrNull(r.pfr_id, 20), nfl: textOrNull(r.nfl_id, 20) },
    };
    if (validatePlayer(p).ok) players.push(p);
  }
  players.sort((a, b) => a.name.localeCompare(b.name) || a.player_id.localeCompare(b.player_id));
  return players;
}

// The ingest adapter (lib/sports/ingest.mjs).
export const NFL_SOURCE = Object.freeze({
  sport: 'nfl', source: 'nflverse', version: NFL_ADAPTER_VERSION,
  // Two seasons hold too few passing games to check the model, so three
  // older finished seasons are kept for it (about 6,500 rows each).
  modelHistory: 3,
  // The team game model reads eight more seasons of games from the same
  // schedule file (not stored): more games for its favorite-number weights
  // (wins by 3 and 7) and its market check.
  teamHistory: 8,
  async games(fetchText, seasons, notes) {
    const csv = await fetchText(NFLVERSE_URLS.games);
    if (!csv) throw new Error('nflverse schedule file is unavailable');
    const { games, rejected } = normalizeNflGames(parseCsv(csv), { seasons });
    if (rejected.length) notes.push(rejected.length + ' schedule rows failed validation and were skipped');
    return new Map(seasons.map((s) => [s, games.filter((g) => g.season === s)]));
  },
  // The snap counts need the players file (PFR → gsis ids). A missing snap
  // file (not published yet) leaves the stat rows as they are and says so.
  async rows(fetchText, season, seasonGames) {
    const csv = await fetchText(NFLVERSE_URLS.weekly(season));
    if (csv == null) return null;
    const gamesById = new Map(seasonGames.map((g) => [g.game_id, g]));
    let snaps = null;
    const notes = [];
    const [snapCsv, playersCsv] = await Promise.all([fetchText(NFLVERSE_URLS.snaps(season)), fetchText(NFLVERSE_URLS.players)]);
    if (snapCsv && playersCsv) snaps = normalizeNflSnaps(parseCsv(snapCsv), pfrIndex(parseCsv(playersCsv)));
    else notes.push(`${season}: snap counts unavailable; games with no stat line are missing`);
    const out = normalizeNflPlayerGames(parseCsv(csv), gamesById, snaps);
    return { ...out, notes, integrity: { zero_stat_games_added: out.zero.added, snap_rows_unmatched: out.zero.unmapped, snap_counts: Boolean(snaps) } };
  },
  async players(fetchText, rowsBySeason, current) {
    const csv = await fetchText(NFLVERSE_URLS.players);
    if (!csv) throw new Error('nflverse players file is unavailable');
    const keepIds = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    return { players: normalizeNflPlayers(parseCsv(csv), { keepIds, season: current }) };
  },
  // Extra records for the current season: the official injury report. A
  // missing file is noted and never fails the run.
  async extras(fetchText, current, notes) {
    const csv = await fetchText(NFLVERSE_URLS.injuries(current)).catch(() => null);
    if (!csv) { notes.push('official injury report unavailable'); return {}; }
    const { week, reports } = normalizeNflInjuries(parseCsv(csv), { season: current });
    return { injuries: { season: current, week, source: 'nflverse (official NFL injury report)', reports } };
  },
});

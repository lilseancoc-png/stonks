// nflverse adapter (https://github.com/nflverse/nflverse-data, CC BY 4.0).
// Pure functions: CSV rows in, Sports records out (lib/sports/schema.mjs).
// The schedule file also carries sportsbook spreads, totals and moneylines;
// those columns are deliberately dropped, because Sports stores no
// sportsbook lines.
import { zonedTimeUtc } from './time.mjs';
import { parseCsv } from './csv.mjs';
import { validateGame, validatePlayer, validatePlayerGame } from './schema.mjs';

export const NFL_ADAPTER_VERSION = 1;
const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download/';
export const NFLVERSE_URLS = Object.freeze({
  games: RELEASES + 'schedules/games.csv',
  players: RELEASES + 'players/players.csv',
  weekly: (season) => RELEASES + 'stats_player/stats_player_week_' + season + '.csv',
});

// Offensive players only: the stats Sports covers come from these groups.
export const NFL_POSITION_GROUPS = Object.freeze(['QB', 'RB', 'WR', 'TE']);
const POST_TYPES = new Set(['WC', 'DIV', 'CON', 'SB', 'POST']);

const lower = (v) => String(v ?? '').trim().toLowerCase();
const intOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (s === '' || s === 'NA') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const textOrNull = (v, max = 80) => {
  const s = String(v ?? '').trim();
  return s && s !== 'NA' ? s.slice(0, max) : null;
};

export function nflGameId(raw) {
  return lower(raw).replace(/[^a-z0-9_]/g, '');
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
      provider_ids: { nflverse: textOrNull(r.game_id, 40), espn: textOrNull(r.espn, 20), pfr: textOrNull(r.pfr, 20) },
    };
    const v = validateGame(g);
    if (v.ok) games.push(g); else rejected.push({ id: r.game_id, errors: v.errors });
  }
  games.sort((a, b) => a.start_utc.localeCompare(b.start_utc) || a.game_id.localeCompare(b.game_id));
  return { games, rejected };
}

// stats_player_week_<season>.csv → one row per player per game. nflverse
// lists only players who recorded a stat, so a missed game is absent rather
// than a zero row.
export function normalizeNflPlayerGames(rows, gamesById) {
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
    const v = validatePlayerGame(row);
    if (v.ok) out.push(row); else rejected.push({ id: r.player_id + '@' + r.game_id, errors: v.errors });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id) || a.player_id.localeCompare(b.player_id));
  return { rows: out, rejected };
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
  async games(fetchText, seasons, notes) {
    const csv = await fetchText(NFLVERSE_URLS.games);
    if (!csv) throw new Error('nflverse schedule file is unavailable');
    const { games, rejected } = normalizeNflGames(parseCsv(csv), { seasons });
    if (rejected.length) notes.push(rejected.length + ' schedule rows failed validation and were skipped');
    return new Map(seasons.map((s) => [s, games.filter((g) => g.season === s)]));
  },
  async rows(fetchText, season, seasonGames) {
    const csv = await fetchText(NFLVERSE_URLS.weekly(season));
    if (csv == null) return null;
    return normalizeNflPlayerGames(parseCsv(csv), new Map(seasonGames.map((g) => [g.game_id, g])));
  },
  async players(fetchText, rowsBySeason, current) {
    const csv = await fetchText(NFLVERSE_URLS.players);
    if (!csv) throw new Error('nflverse players file is unavailable');
    const keepIds = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    return { players: normalizeNflPlayers(parseCsv(csv), { keepIds, season: current }) };
  },
});

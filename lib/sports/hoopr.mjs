// hoopR / ESPN adapter for NBA (sportsdataverse-data release files, the data
// behind the hoopR R package: https://hoopr.sportsdataverse.org/). Pure
// functions: CSV rows in, Sports records out (lib/sports/schema.mjs).
// hoopR labels a season by the year it ENDS (2027 = 2026-27); Sports labels
// it by the year it starts, so file season = Sports season + 1.
import { parseCsv } from './csv.mjs';
import { validateGame, validatePlayer, validatePlayerGame } from './schema.mjs';

export const NBA_ADAPTER_VERSION = 1;
const RELEASES = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/';
export const HOOPR_URLS = Object.freeze({
  schedule: (season) => RELEASES + 'espn_nba_schedules/nba_schedule_' + (season + 1) + '.csv',
  box: (season) => RELEASES + 'espn_nba_player_boxscores/player_box_' + (season + 1) + '.csv',
});

// ESPN team abbreviations of the 30 NBA teams. All-Star and exhibition
// teams (WORLD, STARS, STRIPES, ...) are not in this list and are skipped.
export const NBA_TEAMS = Object.freeze(['atl', 'bkn', 'bos', 'cha', 'chi', 'cle', 'dal', 'den', 'det', 'gs', 'hou', 'ind', 'lac', 'lal', 'mem', 'mia', 'mil', 'min', 'no', 'ny', 'okc', 'orl', 'phi', 'phx', 'por', 'sa', 'sac', 'tor', 'utah', 'wsh']);
const TEAMS = new Set(NBA_TEAMS);
const SEASON_TYPES = { 2: 'REG', 3: 'POST', 5: 'PLAYIN' };
const STATUS = { STATUS_FINAL: 'final', STATUS_POSTPONED: 'postponed', STATUS_CANCELED: 'canceled', STATUS_IN_PROGRESS: 'in_progress', STATUS_HALFTIME: 'in_progress', STATUS_END_PERIOD: 'in_progress' };

const lower = (v) => String(v ?? '').trim().toLowerCase();
const numOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (s === '' || s === 'NA') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => { const n = numOrNull(v); return n == null ? null : Math.round(n); };
const textOrNull = (v, max = 80) => { const s = String(v ?? '').trim(); return s && s !== 'NA' ? s.slice(0, max) : null; };

// nba_schedule_<year>.csv → one record per regular-season, play-in or playoff game.
export function normalizeNbaGames(rows, season) {
  const games = [], rejected = [];
  for (const r of rows) {
    const type = SEASON_TYPES[String(r.season_type || '').trim()];
    const home = lower(r.home_abbreviation), away = lower(r.away_abbreviation);
    if (!type || !TEAMS.has(home) || !TEAMS.has(away)) continue;
    const status = STATUS[String(r.status_type_name || '').trim()] || 'scheduled';
    const startMs = Date.parse(String(r.date || r.start_date || '').trim());
    const final = status === 'final';
    const g = {
      sport: 'nba',
      game_id: textOrNull(r.game_id || r.id, 20),
      season,
      week: null,
      season_type: type,
      start_utc: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      time_tbd: String(r.time_valid || '').trim() === 'false',
      local_date: String(r.game_date || '').trim(),
      home_team: home,
      away_team: away,
      status,
      home_score: final ? intOrNull(r.home_score) : null,
      away_score: final ? intOrNull(r.away_score) : null,
      neutral: String(r.neutral_site || '').trim() === 'true',
      venue: textOrNull(r.venue_full_name),
      provider_ids: { espn: textOrNull(r.game_id || r.id, 20) },
    };
    const v = validateGame(g);
    if (v.ok && /^\d{4}-\d{2}-\d{2}$/.test(g.local_date)) games.push(g);
    else rejected.push({ id: r.game_id || r.id, errors: v.ok ? ['game_date is missing'] : v.errors });
  }
  const seen = new Set();
  const unique = games.filter((g) => (seen.has(g.game_id) ? false : seen.add(g.game_id)));
  unique.sort((a, b) => a.start_utc.localeCompare(b.start_utc) || a.game_id.localeCompare(b.game_id));
  return { games: unique, rejected };
}

// player_box_<year>.csv → one row per player per game. Did-not-play rows are
// kept with null stats and their reason, so hit rates can count them.
export function normalizeNbaPlayerGames(rows, gamesById) {
  const out = [], rejected = [], people = new Map();
  for (const r of rows) {
    if (!textOrNull(r.athlete_id)) continue; // team-total and placeholder rows
    const game = gamesById.get(textOrNull(r.game_id, 20));
    const team = lower(r.team_abbreviation), opponent = lower(r.opponent_team_abbreviation);
    if (!game || !TEAMS.has(team) || !TEAMS.has(opponent)) continue;
    const minutes = numOrNull(r.minutes);
    const points = intOrNull(r.points);
    const dnp = String(r.did_not_play || '').trim() === 'true';
    const played = !dnp && ((minutes != null && minutes > 0) || (points != null && points > 0));
    const pts = played ? points : null, reb = played ? intOrNull(r.rebounds) : null, ast = played ? intOrNull(r.assists) : null;
    const row = {
      sport: 'nba',
      player_id: lower(r.athlete_id),
      game_id: game.game_id,
      season: game.season,
      week: null,
      season_type: game.season_type,
      date: game.local_date,
      team, opponent,
      home: String(r.home_away || '').trim() === 'home',
      played,
      starter: String(r.starter || '').trim() === 'true',
      minutes: played ? Math.round((minutes ?? 0) * 10) / 10 : 0,
      position: textOrNull(r.athlete_position_abbreviation, 8),
      stats: {
        points: pts, rebounds: reb, assists: ast,
        threes: played ? intOrNull(r.three_point_field_goals_made) : null,
        three_attempts: played ? intOrNull(r.three_point_field_goals_attempted) : null,
        field_goals_made: played ? intOrNull(r.field_goals_made) : null,
        field_goals_attempted: played ? intOrNull(r.field_goals_attempted) : null,
        free_throws_made: played ? intOrNull(r.free_throws_made) : null,
        free_throws_attempted: played ? intOrNull(r.free_throws_attempted) : null,
        offensive_rebounds: played ? intOrNull(r.offensive_rebounds) : null,
        steals: played ? intOrNull(r.steals) : null,
        blocks: played ? intOrNull(r.blocks) : null,
        turnovers: played ? intOrNull(r.turnovers) : null,
        pra: pts == null || reb == null || ast == null ? null : pts + reb + ast,
      },
    };
    if (!played) row.dnp_reason = textOrNull(r.reason, 60);
    const v = validatePlayerGame(row);
    if (!v.ok) { rejected.push({ id: r.athlete_id + '@' + r.game_id, errors: v.errors }); continue; }
    out.push(row);
    const prev = people.get(row.player_id);
    if (!prev || prev.date <= row.date) {
      people.set(row.player_id, {
        date: row.date,
        player: {
          sport: 'nba', player_id: row.player_id,
          name: textOrNull(r.athlete_display_name) || row.player_id,
          position: row.position, team, status: null, last_season: game.season,
          provider_ids: { espn: textOrNull(r.athlete_id, 20) },
        },
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id) || a.player_id.localeCompare(b.player_id));
  return { rows: out, rejected, people: [...people.values()].map((x) => x.player).filter((p) => validatePlayer(p).ok) };
}

// The ingest adapter (lib/sports/ingest.mjs).
export const NBA_SOURCE = Object.freeze({
  sport: 'nba', source: 'hoopR (ESPN)', version: NBA_ADAPTER_VERSION,
  async games(fetchText, seasons, notes) {
    const out = new Map();
    for (const season of seasons) {
      const csv = await fetchText(HOOPR_URLS.schedule(season));
      if (csv == null) { out.set(season, []); continue; }
      const { games, rejected } = normalizeNbaGames(parseCsv(csv), season);
      if (rejected.length) notes.push(`${season}: ${rejected.length} schedule rows failed validation and were skipped`);
      out.set(season, games);
    }
    return out;
  },
  async rows(fetchText, season, seasonGames) {
    const csv = await fetchText(HOOPR_URLS.box(season));
    if (csv == null) return null;
    return normalizeNbaPlayerGames(parseCsv(csv), new Map(seasonGames.map((g) => [g.game_id, g])));
  },
  // Names come from the box scores themselves; a finished season that was
  // not re-read keeps the names stored on an earlier run.
  async players(fetchText, rowsBySeason, current, { people, stored }) {
    const ids = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    const players = [...ids].map((id) => people.get(id) || stored.get(id)).filter(Boolean);
    players.sort((a, b) => a.name.localeCompare(b.name) || a.player_id.localeCompare(b.player_id));
    return { players };
  },
});

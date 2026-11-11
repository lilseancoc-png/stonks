// hoopR / ESPN adapter for NBA (sportsdataverse-data release files, the data
// behind the hoopR R package: https://hoopr.sportsdataverse.org/). Pure
// functions: CSV rows in, Sports records out (lib/sports/schema.mjs).
// hoopR labels a season by the year it ENDS (2027 = 2026-27); Sports labels
// it by the year it starts, so file season = Sports season + 1.
//
// Adapter 2 (2026-11-11): a box row with a blank athlete id gets the id of
// the one player on that team whose short name matches (ESPN sometimes drops
// the id, which silently lost those rows); a did-not-play row is dropped when
// the same player played another game that date (an ESPN duplicate); a row
// with blank minutes but any recorded stat counts as played. Each daily run
// also checks box-score points against the final score and, as a second
// source, NBA.com's schedule and box scores for the latest game day
// (integrity counts in the status record only; nothing is changed by them).
import { parseCsv } from './csv.mjs';
import { validateGame, validatePlayer, validatePlayerGame } from './schema.mjs';
import { foldName } from './read.mjs';

export const NBA_ADAPTER_VERSION = 2;
const RELEASES = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/';
export const HOOPR_URLS = Object.freeze({
  schedule: (season) => RELEASES + 'espn_nba_schedules/nba_schedule_' + (season + 1) + '.csv',
  box: (season) => RELEASES + 'espn_nba_player_boxscores/player_box_' + (season + 1) + '.csv',
});
// NBA.com's public CDN files (the league's own data), read only for the
// daily cross-check.
export const NBA_COM_URLS = Object.freeze({
  schedule: 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json',
  box: (gameId) => 'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_' + gameId + '.json',
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
const STAT_COLUMNS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls', 'field_goals_attempted', 'free_throws_attempted'];
export function normalizeNbaPlayerGames(rows, gamesById) {
  const out = [], rejected = [], people = new Map();
  const fixes = { ids_filled: 0, ids_unresolved: 0, duplicate_dnp_dropped: 0, unknown_rows_dropped: 0 };
  // Rows with blank minutes, no stat and no did-not-play flag: usually an
  // inactive player, but when his team's box points fall short of its final
  // score the source lost that player's line (ESPN blanked L. Olbrich's line
  // in seven 2025-26 games, even with a "coach's decision" reason). Those are
  // dropped below as unknown rather than stored as a game he sat out (which
  // would count as an absence on his page).
  const blankRows = new Set();
  // Blank athlete ids: the one id on that team (this season) whose short
  // name matches ("Olbrich" = "L. Olbrich").
  const byTeamShort = new Map();
  for (const r of rows) {
    const id = textOrNull(r.athlete_id);
    if (!id) continue;
    const key = lower(r.team_abbreviation) + '|' + lower(r.athlete_short_name);
    const ids = byTeamShort.get(key) || new Set();
    ids.add(id); byTeamShort.set(key, ids);
  }
  const fillId = (r) => {
    const team = lower(r.team_abbreviation), short = lower(r.athlete_short_name), full = lower(r.athlete_display_name);
    if ((!short && !full) || full === 'team') return null;
    const found = new Set();
    for (const [key, ids] of byTeamShort) {
      const [t, name] = key.split('|');
      if (t !== team) continue;
      if ((short && (name === short || name.endsWith(' ' + short))) || (full && name && full.endsWith(' ' + name.replace(/^\S+\.\s*/, '')))) ids.forEach((x) => found.add(x));
    }
    return found.size === 1 ? [...found][0] : null;
  };
  for (const r of rows) {
    let athleteId = textOrNull(r.athlete_id);
    const team0 = lower(r.team_abbreviation);
    if (!athleteId) {
      if (!TEAMS.has(team0) || !textOrNull(r.game_id)) continue; // team-total and placeholder rows
      athleteId = fillId(r);
      if (!athleteId) { if ((textOrNull(r.athlete_short_name) || textOrNull(r.athlete_display_name)) && lower(r.athlete_display_name) !== 'team') fixes.ids_unresolved++; continue; }
      fixes.ids_filled++;
    }
    const game = gamesById.get(textOrNull(r.game_id, 20));
    const team = team0, opponent = lower(r.opponent_team_abbreviation);
    if (!game || !TEAMS.has(team) || !TEAMS.has(opponent)) continue;
    const minutes = numOrNull(r.minutes);
    const points = intOrNull(r.points);
    const dnp = String(r.did_not_play || '').trim() === 'true';
    // Played: minutes, or (minutes blank) any recorded stat.
    const played = !dnp && ((minutes != null && minutes > 0) || STAT_COLUMNS.some((c) => (numOrNull(r[c]) ?? 0) > 0));
    const pts = played ? points : null, reb = played ? intOrNull(r.rebounds) : null, ast = played ? intOrNull(r.assists) : null;
    const row = {
      sport: 'nba',
      player_id: lower(athleteId),
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
    if (!played && !dnp && minutes == null) blankRows.add(row);
    const v = validatePlayerGame(row);
    if (!v.ok) { rejected.push({ id: athleteId + '@' + r.game_id, errors: v.errors }); continue; }
    out.push(row);
    const prev = people.get(row.player_id);
    const name = textOrNull(r.athlete_display_name);
    if (name && (!prev || prev.date <= row.date)) {
      people.set(row.player_id, {
        date: row.date,
        player: {
          sport: 'nba', player_id: row.player_id,
          name,
          position: row.position, team, status: null, last_season: game.season,
          provider_ids: { espn: textOrNull(athleteId, 20) },
        },
      });
    }
  }
  // An ESPN duplicate: the same player listed for two games on one date. The
  // did-not-play copy is dropped when he played the other game.
  const playedOn = new Set(out.filter((r) => r.played).map((r) => r.player_id + '|' + r.date));
  // Team-games whose stored points fall short of the final score.
  const pts = new Map();
  for (const r of out) if (r.played && typeof r.stats?.points === 'number') pts.set(r.game_id + '|' + r.team, (pts.get(r.game_id + '|' + r.team) || 0) + r.stats.points);
  const short = (r) => {
    const g = gamesById.get(r.game_id);
    if (g?.status !== 'final') return false;
    const final = r.team === g.home_team ? g.home_score : r.team === g.away_team ? g.away_score : null;
    return Number.isInteger(final) && (pts.get(r.game_id + '|' + r.team) || 0) < final;
  };
  const kept = out.filter((r) => {
    if (blankRows.has(r) && short(r)) { fixes.unknown_rows_dropped++; return false; }
    if (r.played || !playedOn.has(r.player_id + '|' + r.date)) return true;
    fixes.duplicate_dnp_dropped++;
    return false;
  });
  // The same game listed twice for a player keeps one row (played first).
  const seen = new Set();
  const unique = kept.sort((a, b) => Number(b.played) - Number(a.played)).filter((r) => {
    const k = r.player_id + '|' + r.game_id;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  unique.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id) || a.player_id.localeCompare(b.player_id));
  return { rows: unique, rejected, people: [...people.values()].map((x) => x.player).filter((p) => validatePlayer(p).ok), fixes };
}

// Box-score points against the final score, per final game: a game whose
// stored player points do not add up to its final score is listed.
export function boxScoreCheck(games, rows) {
  const sums = new Map();
  for (const r of rows) {
    if (!r.played || typeof r.stats?.points !== 'number') continue;
    const k = r.game_id + '|' + r.team;
    sums.set(k, (sums.get(k) || 0) + r.stats.points);
  }
  const finals = games.filter((g) => g.status === 'final');
  const off = [];
  for (const g of finals) {
    const home = sums.get(g.game_id + '|' + g.home_team) || 0, away = sums.get(g.game_id + '|' + g.away_team) || 0;
    if (home !== g.home_score || away !== g.away_score) off.push({ game_id: g.game_id, date: g.local_date, box: [away, home], final: [g.away_score, g.home_score] });
  }
  return { games_checked: finals.length, mismatched: off.length, examples: off.slice(-5) };
}

// ---- NBA.com second source ---------------------------------------------------------
const NBA_COM_TRICODE = { gs: 'GSW', ny: 'NYK', no: 'NOP', sa: 'SAS', utah: 'UTA', wsh: 'WAS' };
export const nbaComTricode = (espn) => NBA_COM_TRICODE[espn] || String(espn || '').toUpperCase();
// scheduleLeagueV2.json → finished games: { game_id, date (ET, YYYY-MM-DD),
// home, away (tricodes), home_score, away_score }. Null when the shape is
// not the one this reader knows.
export function parseNbaComSchedule(json) {
  const dates = json?.leagueSchedule?.gameDates;
  if (!Array.isArray(dates)) return null;
  const out = [];
  for (const d of dates) {
    for (const g of Array.isArray(d?.games) ? d.games : []) {
      if (Number(g?.gameStatus) !== 3) continue;
      const code = /^(\d{4})(\d{2})(\d{2})\//.exec(String(g.gameCode || ''));
      const date = code ? `${code[1]}-${code[2]}-${code[3]}` : String(g.gameDateEst || '').slice(0, 10);
      const home = g.homeTeam, away = g.awayTeam;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !home?.teamTricode || !away?.teamTricode) continue;
      out.push({ game_id: String(g.gameId), date, home: home.teamTricode, away: away.teamTricode, home_score: Number(home.score), away_score: Number(away.score) });
    }
  }
  return out;
}
const isoMinutes = (v) => {
  const m = /^PT(\d+)M([\d.]+)S$/.exec(String(v || ''));
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};
// boxscore_<id>.json → { tricode: [{ name, played, points, rebounds, assists, minutes }] }.
export function parseNbaComBox(json) {
  const game = json?.game;
  if (!game?.homeTeam || !game?.awayTeam) return null;
  const out = {};
  for (const t of [game.homeTeam, game.awayTeam]) {
    if (!t.teamTricode || !Array.isArray(t.players)) return null;
    out[t.teamTricode] = t.players.map((p) => ({
      name: p.name || [p.firstName, p.familyName].filter(Boolean).join(' '),
      played: String(p.played) === '1',
      points: Number(p.statistics?.points ?? 0), rebounds: Number(p.statistics?.reboundsTotal ?? 0), assists: Number(p.statistics?.assists ?? 0),
      minutes: isoMinutes(p.statistics?.minutes),
    }));
  }
  return out;
}
const nameKey = (n) => foldName(n).replace(/\s+(jr|sr|ii|iii|iv)$/, '');
// Compare the latest game day's finals and box scores with NBA.com. Counts
// only; `examples` (private status record) names at most five differences.
export async function nbaComCheck(fetchText, { games, rows, players, maxGames = 15 }) {
  const raw = await fetchText(NBA_COM_URLS.schedule).catch(() => null);
  let schedule = null;
  try { schedule = raw ? parseNbaComSchedule(JSON.parse(raw)) : null; } catch { schedule = null; }
  if (!schedule) return { state: raw ? 'unrecognized' : 'unavailable', provider: 'NBA.com' };
  const finals = games.filter((g) => g.status === 'final' && g.local_date);
  const latest = finals.reduce((m, g) => (g.local_date > m ? g.local_date : m), '');
  const day = finals.filter((g) => g.local_date === latest);
  const byKey = new Map(schedule.map((g) => [g.date + '|' + g.away + '|' + g.home, g]));
  const names = new Map((players || []).map((p) => [p.player_id, nameKey(p.name)]));
  const out = { state: 'ok', provider: 'NBA.com', date: latest || null, games_checked: 0, mismatched: 0, not_found: 0, players_checked: 0, players_mismatched: 0, players_missing: 0, examples: [] };
  for (const g of day.slice(0, maxGames)) {
    const other = byKey.get(g.local_date + '|' + nbaComTricode(g.away_team) + '|' + nbaComTricode(g.home_team));
    if (!other) { out.not_found++; continue; }
    out.games_checked++;
    if (other.home_score !== g.home_score || other.away_score !== g.away_score) {
      out.mismatched++;
      if (out.examples.length < 5) out.examples.push({ game_id: g.game_id, what: 'final score', ours: [g.away_score, g.home_score], nba_com: [other.away_score, other.home_score] });
    }
    let box = null;
    try { const b = await fetchText(NBA_COM_URLS.box(other.game_id)); box = b ? parseNbaComBox(JSON.parse(b)) : null; } catch { box = null; }
    if (!box) continue;
    for (const team of [g.home_team, g.away_team]) {
      const theirs = new Map((box[nbaComTricode(team)] || []).filter((p) => p.played).map((p) => [nameKey(p.name), p]));
      const ours = rows.filter((x) => x.game_id === g.game_id && x.team === team && x.played);
      // Played on NBA.com but not a played row here (a box score that lost
      // a player's line). Names compared after folding accents and suffixes.
      const oursNames = new Set(ours.map((r) => names.get(r.player_id)));
      for (const [k, p] of theirs) {
        if (oursNames.has(k)) continue;
        out.players_missing++;
        if (out.examples.length < 5) out.examples.push({ game_id: g.game_id, what: 'missing player', name: p.name, nba_com: [p.points, p.rebounds, p.assists] });
      }
      for (const r of ours) {
        const p = theirs.get(names.get(r.player_id));
        if (!p) continue;
        out.players_checked++;
        const diff = ['points', 'rebounds', 'assists'].filter((k) => p[k] !== r.stats?.[k]);
        if (diff.length) {
          out.players_mismatched++;
          if (out.examples.length < 5) out.examples.push({ game_id: g.game_id, player_id: r.player_id, what: diff.join(', '), ours: diff.map((k) => r.stats?.[k]), nba_com: diff.map((k) => p[k]) });
        }
      }
    }
  }
  return out;
}

// The ingest adapter (lib/sports/ingest.mjs).
export const NBA_SOURCE = Object.freeze({
  sport: 'nba', source: 'hoopR (ESPN)', version: NBA_ADAPTER_VERSION,
  // One older finished season for the stat model only (2026-11-11): it gives
  // the check season starts with a season behind them, so the early-season
  // adjustment can be fitted on earlier games and tested on later ones.
  modelHistory: 1,
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
    const out = normalizeNbaPlayerGames(parseCsv(csv), new Map(seasonGames.map((g) => [g.game_id, g])));
    const box = boxScoreCheck(seasonGames, out.rows);
    return { ...out, integrity: { ...out.fixes, box_games_checked: box.games_checked, box_points_off: box.mismatched,
      ...(box.mismatched ? { box_examples: box.examples } : {}) } };
  },
  // Names come from the box scores themselves; a finished season that was
  // not re-read keeps the names stored on an earlier run.
  async players(fetchText, rowsBySeason, current, { people, stored }) {
    const ids = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    const players = [...ids].map((id) => people.get(id) || stored.get(id)).filter(Boolean);
    players.sort((a, b) => a.name.localeCompare(b.name) || a.player_id.localeCompare(b.player_id));
    return { players };
  },
  // The daily cross-checks: box-score points vs the final score (every
  // refreshed season, counted in rows()) and NBA.com for the latest game day.
  async check(fetchText, { rowsBySeason, gamesBySeason, players, current, refreshed = null }) {
    const games = gamesBySeason.get(current)?.length ? gamesBySeason.get(current) : gamesBySeason.get(current - 1) || [];
    const season = gamesBySeason.get(current)?.some((g) => g.status === 'final') ? current : current - 1;
    const second = await nbaComCheck(fetchText, { games: gamesBySeason.get(season) || games, rows: rowsBySeason.get(season) || [], players });
    const warnings = [];
    if (second.state !== 'ok') warnings.push(`NBA.com cross-check ${second.state}`);
    else if (second.mismatched || second.players_mismatched || second.players_missing) warnings.push(`NBA.com disagrees on ${second.mismatched} final scores and ${second.players_mismatched} player lines, and lists ${second.players_missing} players as playing who have no played line here, for ${second.date}`);
    for (const [s, rows] of rowsBySeason) {
      if (refreshed && !refreshed.has(s)) continue; // checked when it was read
      const g = gamesBySeason.get(s) || [];
      const box = boxScoreCheck(g, rows);
      if (box.mismatched) warnings.push(`${s}: ${box.mismatched} games where box-score points do not add up to the final score`);
    }
    return { second_source: second, warnings };
  },
});

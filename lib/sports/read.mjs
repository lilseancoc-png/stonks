// Read-side views over stored Sports records, shared by every league: the
// Today / Tomorrow board, one game's likely players, player search and a
// player's game log with plain averages. Pure given a `load(kind, opts)`
// reader, so tests run without a store. No model lives here: summaries are
// counts, averages and medians of what happened; forecasts come from
// lib/sports/models.mjs and are labeled as such.
import { sportsDayWindow, activeDayOf, seasonFor, localDate } from './time.mjs';
import { statIds } from './schema.mjs';
import { unpackRows } from './rows.mjs';
import { forecastStat, positionGroup } from './models.mjs';

export const LOG_LIMIT = 40;
const SEARCH_LIMIT = 20;
const TEAM_PLAYER_LIMIT = 14;
const RECENT_TEAM_GAMES = 3;

// Extra counting stats shown beside the enabled ones (context, not markets).
export const CONTEXT_STATS = Object.freeze({
  nfl: ['completions', 'attempts', 'targets', 'carries', 'rushing_yards', 'receiving_yards', 'touchdowns'],
  nba: ['minutes', 'assists', 'threes', 'pra', 'steals', 'blocks'],
});

export function foldName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const round1 = (n) => Math.round(n * 10) / 10;
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : round1((s[m - 1] + s[m]) / 2);
}
const mean = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// Averages of one stat over a player's rows (newest first). DNP rows and
// missing values are left out and counted, never treated as zero.
export function summarizeStat(rows, stat) {
  const value = (r) => (stat === 'minutes' ? r.minutes : r.stats?.[stat]);
  const vals = rows.filter((r) => r.played && typeof value(r) === 'number').map(value);
  return {
    games: vals.length,
    last5: mean(vals.slice(0, 5)),
    last10: mean(vals.slice(0, 10)),
    average: mean(vals),
    median: median(vals),
    low: vals.length ? Math.min(...vals) : null,
    high: vals.length ? Math.max(...vals) : null,
  };
}

async function seasonRecords(load, sport, kind, seasons) {
  const out = [];
  for (const season of [...new Set(seasons)].sort()) {
    const rec = await load(kind, { sport, season });
    if (rec) out.push({ season, rec });
  }
  return out;
}

export function storedSeasons(status, sport, nowMs) {
  const current = seasonFor(sport, localDate(nowMs, 'America/New_York'));
  const listed = Array.isArray(status?.seasons) ? status.seasons.filter(Number.isInteger) : [];
  return listed.length ? listed : [current - 1, current];
}

function gameView(g, day) {
  return {
    game_id: g.game_id, day, start_utc: g.start_utc, time_tbd: !!g.time_tbd,
    home_team: g.home_team, away_team: g.away_team, status: g.status,
    home_score: g.home_score ?? null, away_score: g.away_score ?? null,
    week: g.week ?? null, season_type: g.season_type || null, venue: g.venue || null,
  };
}

// Games starting today or tomorrow in `tz`, plus the next game after the
// window so an empty board can say when play resumes.
export async function buildBoard({ load, sport, nowMs, tz }) {
  const window = sportsDayWindow(nowMs, tz);
  const seasons = [seasonFor(sport, window.today), seasonFor(sport, window.tomorrow)];
  const recs = await seasonRecords(load, sport, 'games', [...seasons, seasons[1] + 1]);
  const all = recs.flatMap((r) => (Array.isArray(r.rec.games) ? r.rec.games : []));
  const games = [];
  let next = null;
  for (const g of all) {
    const day = activeDayOf(g.start_utc, nowMs, window.time_zone);
    if (day) games.push(gameView(g, day));
    else if (g.start_utc >= window.end_utc && (!next || g.start_utc < next.start_utc)) next = g;
  }
  games.sort((a, b) => a.start_utc.localeCompare(b.start_utc) || a.game_id.localeCompare(b.game_id));
  return { sport, window, games, next_game: next ? gameView(next, null) : null, seasons_loaded: recs.map((r) => r.season) };
}

function playersIndex(rec) {
  return new Map((Array.isArray(rec?.players) ? rec.players : []).map((p) => [p.player_id, p]));
}

function primaryStat(sport, position, summaries) {
  if (sport === 'nfl') return position === 'QB' ? 'passing_yards' : 'receptions';
  return 'points';
}

// One game: the players each team has used in its last three games this
// season, with recent averages of the enabled stats.
export async function buildGame({ load, sport, gameId, seasons = [] }) {
  // NFL ids start with the season ("2026_08_chi_sea"); ESPN NBA ids do not.
  const guess = Number(String(gameId).slice(0, 4));
  const plausible = Number.isInteger(guess) && guess >= 1946 && guess <= 2100 && /^\d{4}_/.test(String(gameId));
  const order = [...new Set([...(plausible ? [guess] : []), ...seasons.slice().reverse()])];
  let game = null, season = null;
  for (const s of order) {
    const rec = await load('games', { sport, season: s });
    game = (rec?.games || []).find((g) => g.game_id === gameId) || null;
    if (game) { season = s; break; }
  }
  if (!game) return null;
  const [pgRec, playersRec] = await Promise.all([load('player-games', { sport, season }), load('players', { sport })]);
  const rows = unpackRows(pgRec).filter((r) => r.date < (game.local_date || game.start_utc.slice(0, 10)));
  const players = playersIndex(playersRec);
  const enabled = statIds(sport, { enabledOnly: true });
  const teams = {};
  for (const team of [game.away_team, game.home_team]) {
    const teamGames = [...new Set(rows.filter((r) => r.team === team).map((r) => r.date + '|' + r.game_id))].sort().reverse().slice(0, RECENT_TEAM_GAMES).map((k) => k.split('|')[1]);
    const recent = new Set(teamGames);
    const byPlayer = new Map();
    for (const r of rows) {
      if (r.team !== team) continue;
      if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
      byPlayer.get(r.player_id).push(r);
    }
    const list = [];
    for (const [pid, prs] of byPlayer) {
      prs.sort((a, b) => b.date.localeCompare(a.date));
      if (!recent.has(prs[0].game_id)) continue;
      const p = players.get(pid);
      const summaries = Object.fromEntries(enabled.map((st) => [st, summarizeStat(prs, st)]));
      const position = prs[0].position || p?.position || null;
      const main = primaryStat(sport, position, summaries);
      list.push({ player_id: pid, name: p?.name || pid, position, games: prs.length, last_game: prs[0].date, out_last_game: prs[0].played === false, main_stat: main, summaries });
    }
    // Passers first, then everyone else, each by recent average of their main stat.
    const rank = (x) => (x.main_stat === 'passing_yards' ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (b.summaries[b.main_stat]?.last5 ?? -1) - (a.summaries[a.main_stat]?.last5 ?? -1) || a.name.localeCompare(b.name));
    teams[team] = { recent_games: teamGames.length, players: list.slice(0, TEAM_PLAYER_LIMIT) };
  }
  return { sport, game: gameView(game, null), teams, stats: enabled };
}

export async function searchPlayers({ load, sport, query }) {
  const q = foldName(query);
  if (q.length < 2) return { sport, query: q, players: [] };
  const terms = q.split(' ');
  const rec = await load('players', { sport });
  const hits = (Array.isArray(rec?.players) ? rec.players : []).filter((p) => {
    const n = foldName(p.name);
    return terms.every((t) => n.split(' ').some((w) => w.startsWith(t)) || n.includes(t));
  });
  hits.sort((a, b) => (b.last_season || 0) - (a.last_season || 0) || a.name.localeCompare(b.name));
  return { sport, query: q, players: hits.slice(0, SEARCH_LIMIT).map((p) => ({ player_id: p.player_id, name: p.name, position: p.position || null, team: p.team || null, last_season: p.last_season ?? null })) };
}

// The next game a team has not started yet, from the stored schedule. The
// Pick Builder attaches a pick to this game.
export async function nextTeamGame({ load, sport, seasons, team, nowMs }) {
  if (!team) return null;
  const recs = await Promise.all(seasons.map((season) => load('games', { sport, season })));
  const next = recs.flatMap((r) => r?.games || [])
    .filter((g) => (g.home_team === team || g.away_team === team) && g.status === 'scheduled' && Date.parse(g.start_utc) > nowMs)
    .sort((a, b) => a.start_utc.localeCompare(b.start_utc))[0];
  return next ? {
    game_id: next.game_id, start_utc: next.start_utc, time_tbd: !!next.time_tbd, local_date: next.local_date,
    home_team: next.home_team, away_team: next.away_team, week: next.week ?? null, season_type: next.season_type || null,
  } : null;
}

// Model forecasts of each enabled stat for one upcoming game. `rows` are the
// player's stored games, newest first, all before that game.
export function nextGameForecasts({ sport, model, rows, team, game, position, stats }) {
  if (!game || !team) return null;
  const home = team === game.home_team;
  const opponent = home ? game.away_team : team === game.away_team ? game.home_team : null;
  if (!opponent) return null;
  const group = positionGroup(sport, rows[0]?.position || position);
  const out = {};
  for (const stat of stats) {
    out[stat] = forecastStat({ sport, stat, history: rows, home, opponent, group, model, lines: true });
  }
  return { game_id: game.game_id, home, opponent, forecasts: out };
}

// A player's stored games (newest first, up to LOG_LIMIT) and averages of
// the enabled and context stats over every stored game.
export async function buildPlayerLog({ load, sport, playerId, seasons, nowMs = Date.now() }) {
  const [playersRec, model, ...pgRecs] = await Promise.all([load('players', { sport }), load('model', { sport }).catch(() => null), ...seasons.map((season) => load('player-games', { sport, season }))]);
  const player = playersIndex(playersRec).get(playerId) || null;
  const rows = pgRecs.flatMap((rec) => unpackRows(rec, { playerId }));
  if (!player && !rows.length) return null;
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id));
  const enabled = statIds(sport, { enabledOnly: true });
  const shown = [...enabled, ...(CONTEXT_STATS[sport] || [])];
  // NFL: nflverse's latest roster team; NBA: the team in the latest box score.
  const team = (sport === 'nfl' ? player?.team || rows[0]?.team : rows[0]?.team || player?.team) || null;
  const nextGame = await nextTeamGame({ load, sport, seasons, team, nowMs });
  return {
    sport,
    next_game: nextGame,
    forecast: nextGameForecasts({ sport, model, rows, team, game: nextGame, position: player?.position, stats: enabled }),
    player: player || { player_id: playerId, name: playerId, position: rows[0]?.position || null, team: rows[0]?.team || null },
    stats: enabled,
    context_stats: CONTEXT_STATS[sport] || [],
    summaries: Object.fromEntries(shown.map((st) => [st, summarizeStat(rows, st)])),
    games: rows.slice(0, LOG_LIMIT).map((r) => ({
      game_id: r.game_id, date: r.date, season: r.season, week: r.week ?? null, season_type: r.season_type || null,
      team: r.team, opponent: r.opponent, home: r.home, played: r.played, position: r.position || null,
      minutes: r.minutes ?? null, dnp_reason: r.played ? null : r.dnp_reason || null,
      stats: Object.fromEntries(shown.filter((st) => st !== 'minutes').map((st) => [st, r.stats?.[st] ?? null])),
    })),
    total_games: rows.length,
  };
}

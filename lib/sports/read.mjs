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
// The Sports page asks for every stored game (two seasons) so its charts can
// show a whole season; the MCP keeps the shorter default.
export const CHART_LIMIT = 200;
export const LEADER_WINDOWS = Object.freeze(['season', 'last10', 'last5']);
const RECENT_VALUES = 10;
const SEARCH_LIMIT = 20;
const TEAM_PLAYER_LIMIT = 14;
const RECENT_TEAM_GAMES = 3;

// Extra counting stats shown beside the enabled ones (context, not markets).
export const CONTEXT_STATS = Object.freeze({
  nfl: ['completions', 'attempts', 'targets', 'carries', 'rushing_yards', 'receiving_yards', 'touchdowns'],
  nba: ['minutes', 'assists', 'threes', 'pra', 'steals', 'blocks'],
});

// Every stat a page shows: the enabled ones first, then the context stats.
export function shownStats(sport) {
  return [...statIds(sport, { enabledOnly: true }), ...(CONTEXT_STATS[sport] || [])];
}
export const POSITION_GROUPS = Object.freeze({ nba: ['G', 'F', 'C'], nfl: ['QB', 'RB', 'WR', 'TE'] });
const statValue = (r, stat) => (stat === 'minutes' ? r.minutes : r.stats?.[stat]);

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
  const vals = playedValues(rows, stat);
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

function playedValues(rows, stat) {
  return rows.filter((r) => r.played && typeof statValue(r, stat) === 'number').map((r) => statValue(r, stat));
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
  const shown = shownStats(sport);
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
      const summaries = Object.fromEntries(shown.map((st) => [st, summarizeStat(prs, st)]));
      // The last ten played values of each stat, newest first, for the
      // small bar charts beside each name.
      const recentValues = Object.fromEntries(shown.map((st) => [st, playedValues(prs, st).slice(0, RECENT_VALUES)]));
      const position = prs[0].position || p?.position || null;
      const main = primaryStat(sport, position, summaries);
      list.push({ player_id: pid, name: p?.name || pid, position, games: prs.length, last_game: prs[0].date, out_last_game: prs[0].played === false, main_stat: main, summaries, recent: recentValues });
    }
    // Passers first, then everyone else, each by recent average of their main stat.
    const rank = (x) => (x.main_stat === 'passing_yards' ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (b.summaries[b.main_stat]?.last5 ?? -1) - (a.summaries[a.main_stat]?.last5 ?? -1) || a.name.localeCompare(b.name));
    teams[team] = { recent_games: teamGames.length, players: list.slice(0, TEAM_PLAYER_LIMIT) };
  }
  return { sport, game: gameView(game, null), teams, stats: enabled, context_stats: CONTEXT_STATS[sport] || [] };
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
export async function buildPlayerLog({ load, sport, playerId, seasons, nowMs = Date.now(), limit = LOG_LIMIT }) {
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
  const rest = await restDays({ load, sport, seasons, rows: rows.slice(0, limit) });
  return {
    sport,
    next_game: nextGame,
    forecast: nextGameForecasts({ sport, model, rows, team, game: nextGame, position: player?.position, stats: enabled }),
    player: player || { player_id: playerId, name: playerId, position: rows[0]?.position || null, team: rows[0]?.team || null },
    stats: enabled,
    context_stats: CONTEXT_STATS[sport] || [],
    summaries: Object.fromEntries(shown.map((st) => [st, summarizeStat(rows, st)])),
    games: rows.slice(0, limit).map((r, i) => ({
      game_id: r.game_id, date: r.date, season: r.season, week: r.week ?? null, season_type: r.season_type || null,
      team: r.team, opponent: r.opponent, home: r.home, played: r.played, position: r.position || null,
      minutes: r.minutes ?? null, dnp_reason: r.played ? null : r.dnp_reason || null,
      starter: typeof r.starter === 'boolean' ? r.starter : null, rest_days: rest[i],
      stats: Object.fromEntries(shown.filter((st) => st !== 'minutes').map((st) => [st, r.stats?.[st] ?? null])),
    })),
    total_games: rows.length,
  };
}

const DAY_MS = 86400000;
const dayNumber = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / DAY_MS);

// Days since the player's team last played, from the stored schedule (not
// the player's own rows: NFL files leave out games with no stat, and a
// player who sat still had a team game). Null for a team's first stored game.
async function restDays({ load, sport, seasons, rows }) {
  const recs = await Promise.all(seasons.map((season) => load('games', { sport, season }).catch(() => null)));
  const byTeam = new Map();
  for (const g of recs.flatMap((r) => r?.games || [])) {
    if (g.status === 'postponed' || g.status === 'canceled') continue;
    const d = g.local_date || String(g.start_utc || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    for (const t of [g.home_team, g.away_team]) {
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push(dayNumber(d));
    }
  }
  for (const list of byTeam.values()) list.sort((a, b) => a - b);
  return rows.map((r) => {
    const list = byTeam.get(r.team);
    if (!list) return null;
    const day = dayNumber(r.date);
    let prev = null;
    for (const x of list) { if (x < day) prev = x; else break; }
    return prev == null || day - prev > 30 ? null : day - prev;
  });
}

// The newest stored season with played games, or the one asked for.
async function seasonRows(load, sport, seasons, want) {
  const list = [...new Set(seasons)].filter(Number.isInteger).sort((a, b) => b - a);
  const order = Number.isInteger(want) && list.includes(want) ? [want] : list;
  for (const season of order) {
    const rows = unpackRows(await load('player-games', { sport, season }));
    if (rows.some((r) => r.played)) return { season, seasons: list, rows };
  }
  return { season: order[0] ?? null, seasons: list, rows: [] };
}

// Every player's averages for one season: the whole season, or each
// player's last ten or five played games in it. The page sorts and filters.
export async function buildLeaders({ load, sport, seasons, season: want, window = 'season' }) {
  const win = LEADER_WINDOWS.includes(window) ? window : 'season';
  const take = win === 'last10' ? 10 : win === 'last5' ? 5 : Infinity;
  const { season, seasons: list, rows } = await seasonRows(load, sport, seasons, want);
  const players = playersIndex(await load('players', { sport }));
  const stats = shownStats(sport);
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  const out = [];
  for (const [pid, prs] of byPlayer) {
    prs.sort((a, b) => b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id));
    const played = prs.filter((r) => r.played);
    if (!played.length) continue;
    const used = played.slice(0, take);
    const p = players.get(pid);
    const position = prs[0].position || p?.position || null;
    out.push({
      player_id: pid, name: p?.name || pid, team: prs[0].team, position, group: positionGroup(sport, position),
      games: played.length, missed: prs.length - played.length, window_games: used.length, last_game: prs[0].date,
      values: Object.fromEntries(stats.map((st) => [st, mean(playedValues(used, st))])),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { sport, season, seasons: list, window: win, stats, groups: POSITION_GROUPS[sport] || [], teams: [...new Set(out.map((x) => x.team))].sort(), players: out };
}

// Team records from final scores, and per-game team totals of each stat:
// what a team's players put up, what its opponents put up against it, and
// that split by the opposing player's position group.
export async function buildTeams({ load, sport, seasons, season: want }) {
  const { season, seasons: list, rows } = await seasonRows(load, sport, seasons, want);
  const stats = shownStats(sport).filter((st) => st !== 'minutes');
  const groups = POSITION_GROUPS[sport] || [];
  const gamesRec = season == null ? null : await load('games', { sport, season });
  const T = new Map();
  const teamOf = (t) => {
    if (!T.has(t)) T.set(t, { team: t, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, played: 0, home: [0, 0, 0], away: [0, 0, 0], results: [], forGames: new Map(), againstGames: new Map() });
    return T.get(t);
  };
  const finals = (gamesRec?.games || []).filter((g) => g.status === 'final' && Number.isInteger(g.home_score) && Number.isInteger(g.away_score))
    .sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  for (const g of finals) {
    for (const [t, us, them, where] of [[g.home_team, g.home_score, g.away_score, 'home'], [g.away_team, g.away_score, g.home_score, 'away']]) {
      const x = teamOf(t);
      const res = us > them ? 0 : us < them ? 1 : 2;
      x.played++; x.pf += us; x.pa += them;
      x[['wins', 'losses', 'ties'][res]]++;
      x[where][res]++;
      x.results.push('WLT'[res]);
    }
  }
  const zero = () => Object.fromEntries(stats.map((st) => [st, 0]));
  const players = playersIndex(await load('players', { sport }));
  const seen = new Set();
  for (const r of rows) {
    if (!r.played) continue;
    const mine = teamOf(r.team).forGames, theirs = teamOf(r.opponent).againstGames;
    if (!mine.has(r.game_id)) mine.set(r.game_id, zero());
    if (!theirs.has(r.game_id)) theirs.set(r.game_id, { all: zero(), ...Object.fromEntries(groups.map((g) => [g, zero()])) });
    const grp = positionGroup(sport, r.position || players.get(r.player_id)?.position);
    const a = theirs.get(r.game_id);
    for (const st of stats) {
      const v = r.stats?.[st];
      if (typeof v !== 'number') continue;
      seen.add(st);
      mine.get(r.game_id)[st] += v;
      a.all[st] += v;
      if (a[grp]) a[grp][st] += v;
    }
  }
  const avg = (games, pick) => {
    const list = [...games.values()].map(pick);
    return Object.fromEntries(stats.map((st) => [st, list.length && seen.has(st) ? round1(list.reduce((s, x) => s + x[st], 0) / list.length) : null]));
  };
  const rec = (a) => a[0] + '-' + a[1] + (a[2] ? '-' + a[2] : '');
  const teams = [...T.values()].map((x) => {
    const last = x.results.slice(-10);
    let streak = null;
    if (x.results.length) {
      const k = x.results[x.results.length - 1];
      let n = 0;
      for (let i = x.results.length - 1; i >= 0 && x.results[i] === k; i--) n++;
      streak = k + n;
    }
    return {
      team: x.team, games: x.played, wins: x.wins, losses: x.losses, ties: x.ties,
      win_pct: x.played ? Math.round(((x.wins + x.ties / 2) / x.played) * 1000) / 1000 : null,
      points_for: x.played ? round1(x.pf / x.played) : null, points_against: x.played ? round1(x.pa / x.played) : null,
      home: rec(x.home), away: rec(x.away),
      last10: rec([last.filter((c) => c === 'W').length, last.filter((c) => c === 'L').length, last.filter((c) => c === 'T').length]), streak,
      stat_games: x.forGames.size, against_games: x.againstGames.size,
      for: avg(x.forGames, (v) => v), against: avg(x.againstGames, (v) => v.all),
      against_by: Object.fromEntries(groups.map((g) => [g, avg(x.againstGames, (v) => v[g])])),
    };
  }).filter((x) => x.games || x.stat_games);
  teams.sort((a, b) => (b.win_pct ?? -1) - (a.win_pct ?? -1) || a.team.localeCompare(b.team));
  return { sport, season, seasons: list, stats, groups, teams };
}

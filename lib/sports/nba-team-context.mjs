// Possession-adjusted NBA team context from complete, final box scores.
// These are estimates, not the NBA's official play-by-play ratings. Use both
// teams' FGA + .44 FTA - OREB + TOV estimates; normalize pace to 48 minutes.
// Every historical snapshot excludes its date, so today's result cannot
// explain today's prop. No additional feed or private-store writes.
export const NBA_TEAM_WINDOW = 20;
export const NBA_TEAM_MIN_GAMES = 5;
const PRIOR_GAMES = 8, MAX_AGE_DAYS = 60, DAY = 86400000;
const fields = ['points', 'field_goals_attempted', 'free_throws_attempted', 'offensive_rebounds', 'turnovers'];
const round = (v) => Math.round(v * 1000) / 1000;
const sum = (xs, key) => xs.reduce((s, x) => s + x[key], 0);

export function nbaTeamGames(rows, games) {
  const byGame = new Map();
  for (const r of rows || []) {
    if (!r.played) continue;
    const list = byGame.get(r.game_id) || [];
    list.push(r); byGame.set(r.game_id, list);
  }
  const out = [], seen = new Set();
  for (const g of [...(games || [])].sort((a, b) => String(a.game_id).localeCompare(String(b.game_id)))) {
    const date = g.local_date || String(g.start_utc || '').slice(0, 10);
    if (seen.has(g.game_id) || g.status !== 'final' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(g.home_score) || !Number.isFinite(g.away_score) || g.home_team === g.away_team) continue;
    seen.add(g.game_id);
    const box = byGame.get(g.game_id) || [];
    if (box.some((r) => ![g.home_team, g.away_team].includes(r.team) || r.date !== date)) continue;
    const totals = [g.home_team, g.away_team].map((team) => {
      const rs = box.filter((r) => r.team === team).sort((a, b) => String(a.player_id).localeCompare(String(b.player_id)));
      if (rs.length < 5 || new Set(rs.map((r) => r.player_id)).size !== rs.length
        || rs.some((r) => !Number.isFinite(r.minutes) || r.minutes < 0
          || fields.some((k) => !Number.isFinite(r.stats?.[k]) || r.stats[k] < 0))) return null;
      const t = Object.fromEntries(fields.map((k) => [k, rs.reduce((s, r) => s + r.stats[k], 0)]));
      t.minutes = sum(rs, 'minutes');
      t.possessions = t.field_goals_attempted + 0.44 * t.free_throws_attempted - t.offensive_rebounds + t.turnovers;
      return t;
    });
    const [h, a] = totals;
    if (!h || !a || h.points !== g.home_score || a.points !== g.away_score
      || Math.min(h.minutes, a.minutes) < 235 || Math.max(h.minutes, a.minutes) > 400
      || Math.abs(h.minutes - a.minutes) > 5 || Math.min(h.possessions, a.possessions) <= 0) continue;
    const possessions = (h.possessions + a.possessions) / 2, duration = (h.minutes + a.minutes) / 10;
    const pace = possessions * 48 / duration;
    if (!(pace >= 65 && pace <= 130)) continue;
    for (const [team, opponent, own, opp] of [[g.home_team, g.away_team, h, a], [g.away_team, g.home_team, a, h]])
      out.push({ game_id: g.game_id, date, team, opponent, possessions, duration, points_for: own.points, points_against: opp.points });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id) || a.team.localeCompare(b.team));
}

export function addNBATeamGames(state, games) {
  for (const g of games) {
    const list = state.get(g.team) || [];
    list.push(g);
    if (list.length > NBA_TEAM_WINDOW) list.shift();
    state.set(g.team, list);
  }
}

export function nbaTeamSnapshot(state, beforeDate) {
  const oldest = new Date(Date.parse(beforeDate + 'T00:00Z') - MAX_AGE_DAYS * DAY).toISOString().slice(0, 10);
  const teams = [...state].sort(([a], [b]) => a.localeCompare(b)).map(([team, rs]) =>
    [team, rs.filter((r) => r.date < beforeDate && r.date >= oldest).slice(-NBA_TEAM_WINDOW)]).filter(([, rs]) => rs.length);
  const all = teams.flatMap(([, rs]) => rs), poss = sum(all, 'possessions'), duration = sum(all, 'duration');
  if (!all.length || !(poss > 0 && duration > 0)) return null;
  const rating = 100 * sum(all, 'points_for') / poss, pace = 48 * poss / duration;
  const team = Object.fromEntries(teams.map(([code, rs]) => {
    const p = sum(rs, 'possessions'), mins = sum(rs, 'duration'), w = rs.length / (rs.length + PRIOR_GAMES);
    const off = w * (100 * sum(rs, 'points_for') / p) + (1 - w) * rating;
    const def = w * (100 * sum(rs, 'points_against') / p) + (1 - w) * rating;
    return [code, { games: rs.length, last_game_date: rs.at(-1).date,
      offensive_rating: round(off), defensive_rating: round(def), net_rating: round(off - def),
      pace: round(w * (48 * p / mins) + (1 - w) * pace) }];
  }));
  return { as_of_date: all.reduce((d, r) => r.date > d ? r.date : d, ''), window: NBA_TEAM_WINDOW,
    min_games: NBA_TEAM_MIN_GAMES, prior_games: PRIOR_GAMES, source: 'box_score_estimate',
    league: { rating: round(rating), pace: round(pace) }, teams: team };
}

export function nbaTeamMatchup(snapshot, team, opponent) {
  if (!snapshot || !team || !opponent || team === opponent) return null;
  const own = snapshot.teams?.[team], opp = snapshot.teams?.[opponent];
  if (!own || !opp || Math.min(own.games, opp.games) < NBA_TEAM_MIN_GAMES) return null;
  if (![own.offensive_rating, own.defensive_rating, own.pace, opp.offensive_rating, opp.defensive_rating, opp.pace,
    snapshot.league?.rating, snapshot.league?.pace].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { team, opponent, own, opposing: opp, league: snapshot.league, as_of_date: snapshot.as_of_date,
    window: snapshot.window, source: snapshot.source, expected_pace: round((own.pace + opp.pace) / 2) };
}

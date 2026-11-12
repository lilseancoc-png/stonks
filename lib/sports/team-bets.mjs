// The Team bets block of a game panel and the MCP's sports_team_odds tool:
// the team game model's forecast for one game (lib/sports/team-model.mjs),
// a ladder of priced bets, how well each market held up in testing, and the
// team numbers behind it (against the spread, over / under, margins, rest,
// ratings and, for NBA, pace from the box scores). Pure given its inputs.
import { forecastGame, teamBetLadder, teamModelSummary, restDaysFor } from './team-model.mjs';

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const dateOf = (g) => g.local_date || String(g.start_utc || '').slice(0, 10);
const isFinal = (g) => g && g.status === 'final' && Number.isInteger(g.home_score) && Number.isInteger(g.away_score);
const CLOSE = { nba: 5, nfl: 8 };      // a "close game": decided by this many points or fewer (NFL: one score)
const BIG = { nba: 15, nfl: 14 };      // a "big win"
const rec = (w, l, p) => w + '-' + l + (p ? '-' + p : '');

// One team's game-result numbers from the final games given (this season
// before the game): record against the spread and over / under where the
// game had a line, average margin and total, close-game record, big wins and
// losses, home / away margins and the last ten margins (newest first).
export function teamResultStats(sport, team, finals) {
  const mine = finals.filter((g) => g.home_team === team || g.away_team === team).sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  if (!mine.length) return null;
  let ats = [0, 0, 0], ou = [0, 0, 0], close = [0, 0], big = [0, 0], scored = 0, allowed = 0, fav = [0, 0], dog = [0, 0];
  const margins = [], totals = [], home = [], away = [], vsLine = [];
  for (const g of mine) {
    const isHome = g.home_team === team;
    const m = isHome ? g.home_score - g.away_score : g.away_score - g.home_score, t = g.home_score + g.away_score;
    margins.push(m); totals.push(t); (isHome ? home : away).push(m);
    scored += isHome ? g.home_score : g.away_score; allowed += isHome ? g.away_score : g.home_score;
    if (Math.abs(m) <= CLOSE[sport] && m !== 0) close[m > 0 ? 0 : 1]++;
    if (m >= BIG[sport]) big[0]++; else if (m <= -BIG[sport]) big[1]++;
    const l = g.lines;
    if (l && Number.isFinite(l.home_margin) && Number.isFinite(l.total)) {
      const exp = isHome ? l.home_margin : -l.home_margin, d = m - exp;
      vsLine.push(d);
      ats[d > 0 ? 0 : d < 0 ? 1 : 2]++;
      ou[t > l.total ? 0 : t < l.total ? 1 : 2]++;
      if (exp > 0) fav[m > 0 ? 0 : 1]++; else if (exp < 0) dog[m > 0 ? 0 : 1]++;
    }
  }
  const n = mine.length, avg = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    games: n, points_for: r1(scored / n), points_against: r1(allowed / n), avg_margin: avg(margins), avg_total: avg(totals),
    home_margin: avg(home), away_margin: avg(away), home_games: home.length, away_games: away.length,
    close: rec(close[0], close[1]), close_points: CLOSE[sport], big_wins: big[0], big_losses: big[1], big_points: BIG[sport],
    lined_games: ats[0] + ats[1] + ats[2],
    ats: ats[0] + ats[1] + ats[2] ? rec(ats[0], ats[1], ats[2]) : null, over_under: ou[0] + ou[1] + ou[2] ? rec(ou[0], ou[1], ou[2]) : null,
    vs_line: avg(vsLine), as_favorite: fav[0] + fav[1] ? rec(fav[0], fav[1]) : null, as_underdog: dog[0] + dog[1] ? rec(dog[0], dog[1]) : null,
    last10: margins.slice(-10).reverse(),
    win_by: Object.fromEntries([1, 5, 10, 15, 20].map((x) => [x, margins.filter((v) => v >= x).length])),
  };
}

// NBA pace and efficiency from the summed box scores (teamTable rows):
// possessions ≈ FGA + 0.44 × FTA − offensive rebounds + turnovers.
function nbaPace(row) {
  const f = row?.for, a = row?.against;
  const poss = (s) => (s && [s.field_goals_attempted, s.free_throws_attempted, s.offensive_rebounds, s.turnovers].every((v) => Number.isFinite(v)) ? s.field_goals_attempted + 0.44 * s.free_throws_attempted - s.offensive_rebounds + s.turnovers : null);
  const pf = poss(f), pa = poss(a);
  if (!pf || !pa || !Number.isFinite(row.points_for) || !Number.isFinite(row.points_against)) return null;
  const pace = (pf + pa) / 2;
  return { possessions: r1(pace), offense_per_100: r1((row.points_for / pace) * 100), defense_per_100: r1((row.points_against / pace) * 100) };
}

function ratingRanks(model) {
  const R = model?.ratings || {}, season = Math.max(...Object.values(R).map((r) => r.season || 0));
  const list = Object.entries(R).filter(([, r]) => r.season === season);
  const rank = (key, high) => {
    const sorted = list.slice().sort((a, b) => (high ? b[1][key] - a[1][key] : a[1][key] - b[1][key]));
    return new Map(sorted.map(([t], i) => [t, i + 1]));
  };
  return { n: list.length, net: rank('net', true), off: rank('off', true), def: rank('def', false) };
}

// `game`: the stored game with its `lines` (NBA's from the archive or the
// live sportsbook read). `allGames`: every stored game (for rest days and the
// team numbers). `table`: teamTable rows for the season before the game.
export function teamBetsView({ sport, game, model, allGames = [], table = [] }) {
  const summary = teamModelSummary(model);
  if (!model || model.status !== 'ok') return { status: model ? model.status : 'not_fitted', check: summary };
  const day = dateOf(game);
  const rest = restDaysFor(allGames, game);
  const fc = game.status === 'scheduled' ? forecastGame(model, game, { rest }) : null;
  const finals = allGames.filter((g) => isFinal(g) && g.season === game.season && dateOf(g) < day && g.game_id !== game.game_id);
  const byTeam = new Map(table.map((t) => [t.team, t]));
  const ranks = ratingRanks(model);
  const teams = {};
  for (const t of [game.away_team, game.home_team]) {
    const r = model.ratings?.[t];
    teams[t] = {
      results: teamResultStats(sport, t, finals),
      rest_days: t === game.home_team ? rest.home : rest.away,
      rating: r ? { offense: r.off, defense: r.def, net: r.net, games: r.games, as_of: r.last, net_rank: ranks.net.get(t) ?? null, offense_rank: ranks.off.get(t) ?? null, defense_rank: ranks.def.get(t) ?? null, teams: ranks.n } : null,
      ...(sport === 'nba' ? { pace: nbaPace(byTeam.get(t)) } : {}),
    };
  }
  const out = {
    status: fc ? 'ok' : game.status === 'scheduled' ? 'no_forecast' : 'played',
    model_version: model.version, fitted_utc: model.fitted_utc,
    check: summary, teams,
  };
  if (fc) {
    out.forecast = fc;
    out.ladder = teamBetLadder(fc, game, sport);
  }
  if (isFinal(game)) out.final = { home_score: game.home_score, away_score: game.away_score, margin: game.home_score - game.away_score, total: game.home_score + game.away_score };
  return out;
}

// The next scheduled game between two teams in the stored seasons (either
// one at home), or null. Team ids are the league's lowercase codes.
export async function findTeamGame({ load, sport, seasons, team, opponent, nowMs = Date.now() }) {
  const a = String(team || '').toLowerCase(), b = String(opponent || '').toLowerCase();
  let best = null;
  for (const season of [...new Set(seasons)]) {
    const rec = await load('games', { sport, season }).catch(() => null);
    for (const g of rec?.games || []) {
      if (g.status !== 'scheduled' || !(Date.parse(g.start_utc) > nowMs - 3 * 3600000)) continue;
      const pair = [g.home_team, g.away_team];
      if (!pair.includes(a) || (b && !pair.includes(b))) continue;
      if (!best || g.start_utc < best.start_utc) best = g;
    }
  }
  return best;
}

// The win-by ladder for both teams: chance of winning by at least 1..max
// points (from the forecast's margin distribution), keyed "1+" .. "30+" per
// team. An object, not an array: the MCP output cuts arrays at 8-25 items but
// keeps 30 keys.
export function winByLadder(fc, game, max = 30) {
  if (!fc?.pmf?.margin) return null;
  const { start, p } = fc.pmf.margin;
  const all = p.reduce((a, b) => a + b, 0) || 1;
  const atLeast = (sign, x) => { let s = 0; for (let i = 0; i < p.length; i++) if (sign * (start + i) >= x) s += p[i]; return Math.round((s / all) * 1000) / 1000; };
  const side = (sign) => { const o = {}; for (let x = 1; x <= max; x++) o[x + '+'] = atLeast(sign, x); return o; };
  return { [game.home_team]: side(1), [game.away_team]: side(-1) };
}

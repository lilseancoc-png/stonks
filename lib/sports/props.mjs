// Two distinct-player props per game, ranked from live lines and the same
// stored history/matchup/model used elsewhere in Sports. Ranking is an
// experimental research score, never an entry win probability or payout.
import { buildBoard, buildGame, storedSeasons, foldName } from './read.mjs';
import { unpackRows } from './rows.mjs';
import { statValue } from './schema.mjs';
import { forecastStat, MODEL_SPECS, positionGroup } from './models.mjs';
import { fresh, LINE_MAX_AGE_MS, INJURY_MAX_AGE_MS, teamCode } from './prop-sources.mjs';
import { localDate } from './time.mjs';

const DAY = 86400000;
export const PROP_RANK_VERSION = 'props-rank-1';
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (n) => n == null ? null : Math.round(n * 100) / 100;
const nameKey = (n) => foldName(n).replace(/\s+(jr|sr|ii|iii|iv)$/, '');
const OUT = /^(out|doubtful|suspended|inactive|injured reserve|ir|pup|reserve|physically unable to perform)$/i;
const UNCERTAIN = /questionable|game.time decision|day.to.day|unknown/i;
const LIMITED = /minutes? (?:limit|restriction)|limited (?:minutes|snaps)|snap (?:count|limit)|will not play/i;
const TEAM_NAMES = {
  nba: ['atl|Atlanta Hawks', 'bkn|Brooklyn Nets', 'bos|Boston Celtics', 'cha|Charlotte Hornets', 'chi|Chicago Bulls', 'cle|Cleveland Cavaliers', 'dal|Dallas Mavericks', 'den|Denver Nuggets', 'det|Detroit Pistons', 'gs|Golden State Warriors', 'hou|Houston Rockets', 'ind|Indiana Pacers', 'lac|Los Angeles Clippers|LA Clippers', 'lal|Los Angeles Lakers', 'mem|Memphis Grizzlies', 'mia|Miami Heat', 'mil|Milwaukee Bucks', 'min|Minnesota Timberwolves', 'no|New Orleans Pelicans', 'ny|New York Knicks', 'okc|Oklahoma City Thunder', 'orl|Orlando Magic', 'phi|Philadelphia 76ers', 'phx|Phoenix Suns', 'por|Portland Trail Blazers', 'sa|San Antonio Spurs', 'sac|Sacramento Kings', 'tor|Toronto Raptors', 'utah|Utah Jazz', 'wsh|Washington Wizards'],
  nfl: ['ari|Arizona Cardinals', 'atl|Atlanta Falcons', 'bal|Baltimore Ravens', 'buf|Buffalo Bills', 'car|Carolina Panthers', 'chi|Chicago Bears', 'cin|Cincinnati Bengals', 'cle|Cleveland Browns', 'dal|Dallas Cowboys', 'den|Denver Broncos', 'det|Detroit Lions', 'gb|Green Bay Packers', 'hou|Houston Texans', 'ind|Indianapolis Colts', 'jax|Jacksonville Jaguars', 'kc|Kansas City Chiefs', 'lv|Las Vegas Raiders', 'lac|Los Angeles Chargers', 'lar|Los Angeles Rams', 'mia|Miami Dolphins', 'min|Minnesota Vikings', 'ne|New England Patriots', 'no|New Orleans Saints', 'nyg|New York Giants', 'nyj|New York Jets', 'phi|Philadelphia Eagles', 'pit|Pittsburgh Steelers', 'sea|Seattle Seahawks', 'sf|San Francisco 49ers', 'tb|Tampa Bay Buccaneers', 'ten|Tennessee Titans', 'was|Washington Commanders'],
};
function franchise(name, sport) {
  for (const row of TEAM_NAMES[sport]) {
    const [code, ...names] = row.split('|');
    if (names.some((n) => foldName(n) === foldName(name))) return code;
  }
  return teamCode(name, sport);
}
export function lineMatchesGame(line, game, sport) {
  return Math.abs(Date.parse(line.start_utc) - Date.parse(game.start_utc)) <= 10 * 60000 &&
    franchise(line.home_team, sport) === game.home_team && franchise(line.away_team, sport) === game.away_team;
}
function reportFor(player, reports) {
  const id = String(player.provider_ids?.espn || '');
  const matches = reports.filter((i) => id && i.espn_id === id || nameKey(i.name) === nameKey(player.name));
  // Conflicting reports should never accidentally turn an Out into Active.
  return matches.find((i) => OUT.test(i.status)) || matches.find((i) => UNCERTAIN.test(i.status)) || matches[0] || null;
}
function hitCounts(rows, stat, side, line) {
  const values = rows.filter((r) => r.played).map((r) => statValue(r, stat)).filter((v) => v != null);
  return { games: values.length, hits: values.filter((v) => side === 'over' ? v > line : v < line).length,
    pushes: values.filter((v) => v === line).length, average: round(mean(values)) };
}
// A one-standard-error Wilson lower bound discounts a small run of wins.
function lowerRate(hits, games) {
  if (!games) return 0;
  const p = hits / games;
  return (p + 0.5 / games - Math.sqrt(p * (1 - p) / games + 0.25 / games ** 2)) / (1 + 1 / games);
}
function playerFor(line, players, historyByPlayer, game) {
  const espn = /^espn:(.+)$/.exec(line.provider_player_id || '')?.[1];
  const matches = players.filter((p) => {
    const rows = historyByPlayer.get(p.player_id) || [], team = rows[0]?.team || p.team;
    return [game.home_team, game.away_team].includes(team) &&
      (espn ? String(p.provider_ids?.espn) === espn : nameKey(p.name) === nameKey(line.player_name));
  });
  return matches.length === 1 ? matches[0] : null;
}
function split(rows, pred, stat, side, threshold) { return hitCounts(rows.filter(pred), stat, side, threshold); }

export function rankGameProps({ sport, game, lines, injuries, players, rows, model, matchup, allGames, now }) {
  const result = { game_id: game.game_id, picks: [], candidates: 0, skipped: {}, availability: [], state: 'ready', message: null };
  const skip = (reason) => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; };
  if (game.status !== 'scheduled' || game.time_tbd || !(Date.parse(game.start_utc) > now)) return { ...result, state: 'closed', message: 'Pregame picks close when a game starts or is postponed.' };
  if (injuries.state !== 'ok' || !fresh(injuries.observed_utc, now, INJURY_MAX_AGE_MS)) return { ...result, state: 'waiting', message: 'Waiting for a current injury report before ranking picks.' };
  const date = localDate(Date.parse(game.start_utc), 'America/New_York');
  const history = rows.filter((r) => r.date < date);
  const byPlayer = new Map();
  for (const r of history) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  for (const rs of byPlayer.values()) rs.sort((a, b) => b.date.localeCompare(a.date));
  const reports = injuries.reports || [];
  const teams = [game.away_team, game.home_team];
  result.availability = reports.filter((i) => teams.includes(i.team) || teams.includes(franchise(i.team_name, sport)))
    .map((i) => ({ name: i.name, team: i.team || franchise(i.team_name, sport), status: i.status, detail: i.detail, report_utc: i.report_utc }));
  const candidates = [];
  for (const line of lines) {
    if (!lineMatchesGame(line, game, sport) || !fresh(line.observed_utc, now, LINE_MAX_AGE_MS)) continue;
    const p = playerFor(line, players, byPlayer, game);
    if (!p) { skip('unmatched_player'); continue; }
    const rs = byPlayer.get(p.player_id) || [], latest = rs[0], report = reportFor(p, reports);
    if (report && (OUT.test(report.status) || UNCERTAIN.test(report.status) || LIMITED.test(report.detail))) { skip('availability_unresolved_or_out'); continue; }
    if (!latest || !latest.played || !fresh(latest.date + 'T00:00:00Z', now, (sport === 'nba' ? 10 : 21) * DAY)) { skip('recent_role_missing'); continue; }
    const team = latest.team, home = team === game.home_team, opponent = home ? game.away_team : game.home_team;
    // Trades change role; only use this team's most recent stint for the
    // core ranking. Older teams still contribute to labeled opponent splits.
    const stint = [];
    for (const r of rs) { if (r.team !== team) break; stint.push(r); }
    const recent = stint.filter((r) => r.played && statValue(r, line.stat) != null).slice(0, 20);
    const H = hitCounts(recent, line.stat, line.side, line.threshold);
    if (H.games < 8) { skip('insufficient_history'); continue; }
    const last5 = hitCounts(recent.slice(0, 5), line.stat, line.side, line.threshold);
    const last10 = hitCounts(recent.slice(0, 10), line.stat, line.side, line.threshold);
    const group = positionGroup(sport, latest.position || p.position), dir = line.side === 'over' ? 1 : -1;
    const modelFresh = model && fresh(model.as_of_date + 'T00:00:00Z', now, (sport === 'nba' ? 7 : 14) * DAY);
    const fc = MODEL_SPECS[sport]?.[line.stat] && modelFresh
      ? forecastStat({ sport, stat: line.stat, history: stint, home, opponent, group, model, side: line.side, threshold: line.threshold }) : null;
    const defense = matchup?.allowed_by?.[opponent]?.[group]?.[line.stat] ?? matchup?.stats?.[opponent]?.allowed?.[line.stat] ?? null;
    const league = matchup?.league?.allowed_by?.[group]?.[line.stat] ?? matchup?.league?.allowed?.[line.stat] ?? null;
    const defenseRank = matchup?.allowed_by_rank?.[opponent]?.[group]?.[line.stat] ?? matchup?.stats?.[opponent]?.allowed_rank?.[line.stat] ?? null;
    const evidence = [
      { label: 'Recent form', text: `${last5.hits}/${last5.games} last 5 and ${last10.hits}/${last10.games} last 10 cleared this side; last-10 average ${last10.average}.` },
      { label: 'Availability', text: report ? `${report.status}: ${report.detail || 'Listed on the latest report.'}` : 'Not listed on the latest ESPN injury report; starting lineup is not confirmed.' },
    ];
    let score = lowerRate(H.hits, H.games), modelOut = null;
    if (fc?.status === 'ok') {
      const stress = Math.min(fc.probability, fc.sensitivity.opportunity_down_10, fc.sensitivity.opportunity_up_10);
      score = 0.6 * stress + 0.4 * score - (fc.quality === 'validated' ? 0 : 0.025);
      modelOut = fc;
      evidence.push({ label: 'Stat model', text: `Forecast ${fc.mean}; ${Math.round(fc.probability * 100)}% for this side (${fc.quality}). Expected ${fc.expected_opportunity} ${fc.unit}; opponent factor ${fc.opponent_factor}. Chance falls to ${Math.round(stress * 100)}% in the ±10% workload check.` });
    }
    if (defense != null && league > 0) {
      const bump = Math.max(-0.03, Math.min(0.03, (defense / league - 1) * dir * 0.15));
      // Existing forecasts already include defense; do not count it twice.
      if (!modelOut) score += bump;
      evidence.push({ label: 'Opponent defense', text: `${opponent.toUpperCase()} allows ${defense} to ${group} per game vs ${league} league average${defenseRank ? `; rank ${defenseRank}/${matchup.teams_ranked} (1 = fewest allowed)` : ''}.` });
    } else evidence.push({ label: 'Opponent defense', text: 'Not enough stored team games for this stat and position.' });
    const vs = split(rs, (r) => r.opponent === opponent, line.stat, line.side, line.threshold);
    const location = split(recent, (r) => r.home === home, line.stat, line.side, line.threshold);
    evidence.push({ label: 'Matchup & location', text: `${vs.games ? `Vs ${opponent.toUpperCase()}: average ${vs.average}, ${vs.hits}/${vs.games} cleared` : 'No stored meetings for this player'}; ${home ? 'home' : 'away'}: ${location.hits}/${location.games} cleared (average ${location.average ?? '—'}).` });
    const unit = sport === 'nba' ? 'minutes' : (p.position === 'QB' ? 'attempts' : p.position === 'RB' ? 'carries' : 'targets');
    const volume = (r) => unit === 'minutes' ? r.minutes : r.stats?.[unit];
    const vol5 = mean(recent.slice(0, 5).map(volume).filter((n) => typeof n === 'number'));
    const vol10 = mean(recent.slice(0, 10).map(volume).filter((n) => typeof n === 'number'));
    if (vol5 != null && vol10 > 0 && vol5 < vol10 * 0.85 && line.side === 'over') score -= 0.04;
    const prevGame = allGames.filter((g) => g.status === 'final' && [g.home_team, g.away_team].includes(team) && Date.parse(g.start_utc) < Date.parse(game.start_utc)).sort((a, b) => b.start_utc.localeCompare(a.start_utc))[0];
    const rest = prevGame ? Math.round((Date.parse(date + 'T12:00Z') - Date.parse((prevGame.local_date || localDate(Date.parse(prevGame.start_utc), 'America/New_York')) + 'T12:00Z')) / DAY) : null;
    if (sport === 'nba' && rest === 1 && line.side === 'over') score -= 0.015;
    evidence.push({ label: 'Workload & rest', text: `${vol5 == null ? 'Workload unavailable' : `${round(vol5)} ${unit} last 5 vs ${round(vol10)} last 10`}; ${rest == null ? 'prior team game unavailable' : `${rest} calendar day(s) since the previous team game${rest === 1 && sport === 'nba' ? ' (back-to-back)' : ''}`}.` });
    const outs = result.availability.filter((i) => i.team === team && OUT.test(i.status));
    let measured = 0;
    const absenceSplits = [];
    for (const out of outs.slice(0, 8)) {
      const teammate = players.find((x) => nameKey(x.name) === nameKey(out.name));
      if (!teammate) continue;
      const dnp = new Set((byPlayer.get(teammate.player_id) || []).filter((r) => r.team === team && r.played === false).map((r) => r.game_id));
      const without = split(recent, (r) => dnp.has(r.game_id), line.stat, line.side, line.threshold);
      if (without.games < 3) continue;
      measured++;
      absenceSplits.push({ player_id: teammate.player_id, name: out.name, ...without });
      score += Math.max(-0.015, Math.min(0.015, (lowerRate(without.hits, without.games) - lowerRate(H.hits, H.games)) * 0.08));
      evidence.push({ label: 'Teammate absence', text: `With ${out.name} recorded DNP: average ${without.average}, ${without.hits}/${without.games} cleared. Small observational split, not a causal forecast.` });
    }
    if (outs.length && !measured) evidence.push({ label: 'Teammate absence', text: `${outs.map((i) => i.name).join(', ')} out/doubtful. Too few recorded DNP games to estimate this player's change in role.` });
    const unresolved = result.availability.filter((i) => i.team === team && UNCERTAIN.test(i.status));
    if (unresolved.length) { score -= 0.02; evidence.push({ label: 'Lineup risk', text: `Teammate status unresolved: ${unresolved.map((i) => i.name).join(', ')}. Role may change.` }); }
    const opponentReports = result.availability.filter((i) => i.team === opponent);
    if (opponentReports.length) evidence.push({ label: 'Opponent availability', text: `${opponentReports.map((i) => i.name + ': ' + i.status).join('; ')}. Historical defensive rates do not quantify the effect of these absences.` });
    if (report && !/^(active|available|probable)$/i.test(report.status)) score -= 0.03;
    if (score < 0.50) { skip('weak_evidence'); continue; }
    candidates.push({ ...line, sport, game_id: game.game_id, player_id: p.player_id, player_name: p.name, team, opponent,
      rank_score: round(score * 100), basis: modelOut ? 'model_and_history' : 'history_only', model: modelOut,
      features: { home, position_group: group, opponent_defense: { allowed: defense, league_average: league, rank: defenseRank, teams_ranked: matchup?.teams_ranked ?? null },
        workload: { unit, last5: round(vol5), last10: round(vol10) }, rest_days: rest, opponent_split: vs, location_split: location,
        teammate_absence_splits: absenceSplits, unresolved_teammates: unresolved.map((i) => i.name) },
      history: H, last5, last10, evidence, latest_game_date: latest.date });
  }
  candidates.sort((a, b) => b.rank_score - a.rank_score || b.history.games - a.history.games || a.player_id.localeCompare(b.player_id) || a.stat.localeCompare(b.stat));
  result.candidates = candidates.length;
  const selected = new Set();
  for (const c of candidates) {
    if (selected.has(c.player_id)) continue;
    selected.add(c.player_id); result.picks.push(c);
    if (result.picks.length === 2) break;
  }
  if (result.picks.length < 2) { result.state = 'limited'; result.message = result.picks.length ? 'Only one player has enough current evidence. The second slot stays open.' : lines.some((l) => lineMatchesGame(l, game, sport)) ? 'No props have enough current evidence for a pick.' : 'No current PrizePicks lines are posted for this game in the feed.'; }
  return result;
}

export async function recommendationsView({ load, sport, now, tz, sources }) {
  const [board, status, people, model] = await Promise.all([buildBoard({ load, sport, nowMs: now, tz }), load('status', { sport }), load('players', { sport }), load('model', { sport }).catch(() => null)]);
  const seasons = storedSeasons(status, sport, now);
  const records = await Promise.all(seasons.map(async (season) => ({ rows: await load('player-games', { sport, season }), games: await load('games', { sport, season }) })));
  const rows = records.flatMap((r) => unpackRows(r.rows)), games = records.flatMap((r) => r.games?.games || []);
  const output = [];
  for (const item of board.games) {
    const base = { game_id: item.game_id, picks: [], availability: [], candidates: 0, skipped: {} };
    if (sources.lines.state !== 'ok') { output.push({ ...base, state: sources.lines.state, message: sources.lines.message }); continue; }
    const full = games.find((g) => g.game_id === item.game_id) || item;
    const view = await buildGame({ load, sport, gameId: item.game_id, seasons });
    output.push({ ...rankGameProps({ sport, game: full, lines: sources.lines.lines, injuries: sources.injuries, players: people?.players || [], rows, model, matchup: view?.matchup, allGames: games, now }), start_utc: full.start_utc, season: full.season });
  }
  const { lines, ...lineMeta } = sources.lines, { reports, ...injuryMeta } = sources.injuries;
  const expiry = Math.min(now + 120000, ...board.games.map((g) => Date.parse(g.start_utc)).filter((ms) => ms > now));
  return { sport, rank_version: PROP_RANK_VERSION, generated_utc: new Date(now).toISOString(), expires_utc: new Date(expiry).toISOString(), window: board.window,
    sources: { lines: { ...lineMeta, count: lines.length }, injuries: injuryMeta }, games: output,
    methodology: 'Experimental ranking of current full-game standard lines, using sample-discounted history, stat models where available, workload sensitivity, opponent defense, location, rest and injury context. Two different players; these are individual picks, not a priced entry.' };
}

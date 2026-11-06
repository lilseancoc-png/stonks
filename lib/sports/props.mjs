// One player prop from each team, ranked from live lines and the same
// stored history/matchup/model used elsewhere in Sports. Ranking is an
// experimental research score, never an entry win probability or payout.
import { buildBoard, buildGame, storedSeasons, foldName } from './read.mjs';
import { unpackRows } from './rows.mjs';
import { statValue } from './schema.mjs';
import { forecastStat, MODEL_SPECS, positionGroup } from './models.mjs';
import { fresh, LINE_MAX_AGE_MS, INJURY_MAX_AGE_MS, teamCode } from './prop-sources.mjs';
import { localDate } from './time.mjs';
import { NBA_ALPHA_VERSION, NBA_QUOTE_AGE_MS, selectNBAProps } from './nba-market.mjs';
import { nbaRoleScenario, nbaTeamOpportunity } from './nba-role.mjs';

const DAY = 86400000;
export const PROP_RANK_VERSION = 'props-rank-3';
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (n) => n == null ? null : Math.round(n * 100) / 100;
const nameKey = (n) => foldName(n).replace(/\s+(jr|sr|ii|iii|iv)$/, '');
const OUT = /^(out|doubtful|suspended|inactive|injured reserve|ir|pup|reserve|physically unable to perform)$/i;
const UNCERTAIN = /questionable|game.time decision|day.to.day|unknown/i;
const LIMITED = /\b(?:minutes? (?:limit|restriction|cap)s?|limited (?:minutes|snaps)|limited to [\w -]+ (?:minutes|snaps)|snap (?:count|limit)|minutes (?:will be|are|will remain) (?:capped|limited))\b/i;
function restricted(detail = '') {
  const text = String(detail).replace(/[’‘]/g, "'").replace(/[–—]/g, '-');
  if (/\b(?:will not|won't) (?:play|suit up|be available)\b/i.test(text)) return true;
  // Remove explicit clearances, not arbitrary clauses containing "no".
  const clearance = /\b(?:(?:no|without)\s+(?:(?:a|any|strict|hard|reported|expected)\s+)*|(?:won't|will not|doesn't|does not|isn't expected to|is not expected to)\s+(?:have|face|be on|be under)\s+(?:(?:a|any|strict|hard)\s+)*|not\s+(?:on|under|subject to)\s+(?:(?:a|any)\s+)*)(?:minutes?|snap)\s+(?:limit|restriction|cap|count)s?\b/gi;
  return LIMITED.test(text.replace(clearance, ''));
}
const TEAM_NAMES = {
  nba: ['atl|Atlanta Hawks', 'bkn|Brooklyn Nets', 'bos|Boston Celtics', 'cha|Charlotte Hornets', 'chi|Chicago Bulls', 'cle|Cleveland Cavaliers', 'dal|Dallas Mavericks', 'den|Denver Nuggets', 'det|Detroit Pistons', 'gs|Golden State Warriors', 'hou|Houston Rockets', 'ind|Indiana Pacers', 'lac|Los Angeles Clippers|LA Clippers', 'lal|Los Angeles Lakers', 'mem|Memphis Grizzlies', 'mia|Miami Heat', 'mil|Milwaukee Bucks', 'min|Minnesota Timberwolves', 'no|New Orleans Pelicans', 'ny|New York Knicks', 'okc|Oklahoma City Thunder', 'orl|Orlando Magic', 'phi|Philadelphia 76ers', 'phx|Phoenix Suns', 'por|Portland Trail Blazers', 'sa|San Antonio Spurs', 'sac|Sacramento Kings', 'tor|Toronto Raptors', 'utah|Utah Jazz', 'wsh|Washington Wizards'],
  nfl: ['ari|Arizona Cardinals', 'atl|Atlanta Falcons', 'bal|Baltimore Ravens', 'buf|Buffalo Bills', 'car|Carolina Panthers', 'chi|Chicago Bears', 'cin|Cincinnati Bengals', 'cle|Cleveland Browns', 'dal|Dallas Cowboys', 'den|Denver Broncos', 'det|Detroit Lions', 'gb|Green Bay Packers', 'hou|Houston Texans', 'ind|Indianapolis Colts', 'jax|Jacksonville Jaguars', 'kc|Kansas City Chiefs', 'lv|Las Vegas Raiders', 'lac|Los Angeles Chargers', 'la|Los Angeles Rams', 'mia|Miami Dolphins', 'min|Minnesota Vikings', 'ne|New England Patriots', 'no|New Orleans Saints', 'nyg|New York Giants', 'nyj|New York Jets', 'phi|Philadelphia Eagles', 'pit|Pittsburgh Steelers', 'sea|Seattle Seahawks', 'sf|San Francisco 49ers', 'tb|Tampa Bay Buccaneers', 'ten|Tennessee Titans', 'was|Washington Commanders'],
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
    franchise(line.home_team, sport) === teamCode(game.home_team, sport) && franchise(line.away_team, sport) === teamCode(game.away_team, sport);
}
function reportFor(player, reports, team, sport) {
  const id = String(player.provider_ids?.espn || '');
  const exact = id ? reports.filter((i) => i.espn_id === id) : [];
  const matches = exact.length ? exact : reports.filter((i) => (!id || !i.espn_id) && nameKey(i.name) === nameKey(player.name) &&
    (!i.team && !i.team_name || teamCode(i.team || franchise(i.team_name, sport), sport) === team));
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
function workload(sport, stat) {
  if (sport === 'nba') return { unit: 'minutes', parts: ['minutes'] };
  if (stat === 'pass_rush_yards') return { unit: 'pass attempts + carries', parts: ['attempts', 'carries'] };
  if (stat === 'rush_rec_yards' || stat === 'touchdowns') return { unit: 'carries + targets', parts: ['carries', 'targets'] };
  if (['passing_yards', 'passing_tds', 'interceptions', 'completions', 'attempts'].includes(stat)) return { unit: 'pass attempts', parts: ['attempts'] };
  if (['rushing_yards', 'rushing_tds', 'carries'].includes(stat)) return { unit: 'carries', parts: ['carries'] };
  return { unit: 'targets', parts: ['targets'] };
}

export function rankGameProps({ sport, game, lines, injuries, players, rows, model, matchup, allGames, now, includeCandidates = false, nbaResearch = false }) {
  const result = { game_id: game.game_id, home_team: game.home_team, away_team: game.away_team, picks: [], candidates: 0, skipped: {}, availability: [], state: 'ready', message: null };
  if (nbaResearch) result.decisions = [];
  let currentLine;
  const skip = (reason) => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; if (nbaResearch) result.decisions.push({ line: currentLine, state: 'rejected', reason }); };
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
  result.availability = reports.map((i) => ({ name: i.name,
    team: teams.includes(teamCode(i.team, sport)) ? teamCode(i.team, sport) : franchise(i.team_name, sport), status: i.status, detail: i.detail, report_utc: i.report_utc }))
    .filter((i) => teams.includes(i.team));
  const candidates = [];
  const teamTotals = nbaResearch ? nbaTeamOpportunity(history) : null;
  for (const line of lines) {
    currentLine = line;
    if (!(Date.parse(line.start_utc) > now) || !lineMatchesGame(line, game, sport) || !fresh(line.observed_utc, now, LINE_MAX_AGE_MS)) continue;
    const p = playerFor(line, players, byPlayer, game);
    if (!p) { skip('unmatched_player'); continue; }
    const rs = byPlayer.get(p.player_id) || [], latest = rs[0], report = reportFor(p, reports, latest?.team || p.team, sport);
    if (report && (OUT.test(report.status) || UNCERTAIN.test(report.status) || restricted(report.detail))) { skip('availability_unresolved_or_out'); continue; }
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
    const { unit, parts } = workload(sport, line.stat);
    const volume = (r) => {
      const values = parts.map((key) => key === 'minutes' ? r.minutes : r.stats?.[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
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
    if (score < 0.50 && !nbaResearch) { skip('weak_evidence'); continue; }
    candidates.push({ ...line, sport, game_id: game.game_id, player_id: p.player_id, player_name: p.name, team, opponent,
      ...(nbaResearch ? { role: nbaRoleScenario({ player: { ...p, team, opponent }, history: stint, byPlayer, players, availability: result.availability, stat: line.stat, teamTotals }) } : {}),
      rank_score: round(score * 100), basis: modelOut ? 'model_and_history' : 'history_only', model: modelOut,
      features: { home, position_group: group, opponent_defense: { allowed: defense, league_average: league, rank: defenseRank, teams_ranked: matchup?.teams_ranked ?? null },
        workload: { unit, last5: round(vol5), last10: round(vol10) }, rest_days: rest, opponent_split: vs, location_split: location,
        teammate_absence_splits: absenceSplits, unresolved_teammates: unresolved.map((i) => i.name) },
      history: H, last5, last10, evidence, latest_game_date: latest.date });
    if (nbaResearch) result.decisions.push({ line, state: 'eligible', player_id: p.player_id, history_rank: round(score * 100) });
  }
  candidates.sort((a, b) => b.rank_score - a.rank_score || b.history.games - a.history.games || a.player_id.localeCompare(b.player_id) || a.stat.localeCompare(b.stat));
  result.candidates = candidates.length;
  // Offline research can inspect rejected alternatives using the exact live
  // scorer. HTTP callers never request this potentially large payload.
  if (includeCandidates) result.ranked_candidates = candidates;
  const selected = new Set();
  const selectedTeams = new Set();
  for (const c of candidates) {
    if (selected.has(c.player_id) || selectedTeams.has(c.team)) continue;
    selected.add(c.player_id); selectedTeams.add(c.team); result.picks.push(c);
    if (result.picks.length === 2) break;
  }
  if (result.picks.length < 2) { result.state = 'limited'; result.message = result.picks.length ? 'Only one team has an eligible pick. The other team’s slot stays open.' : lines.some((l) => lineMatchesGame(l, game, sport)) ? 'No props have enough current evidence for a pick.' : 'No current PrizePicks lines are posted for this game in the feed.'; }
  return result;
}

export async function recommendationsView({ load, sport, now, tz, sources }) {
  const [board, status, people, model] = await Promise.all([buildBoard({ load, sport, nowMs: now, tz }), load('status', { sport }), load('players', { sport }), load('model', { sport }).catch(() => null)]);
  const seasons = storedSeasons(status, sport, now);
  const records = await Promise.all(seasons.map(async (season) => ({ rows: await load('player-games', { sport, season }), games: await load('games', { sport, season }) })));
  const rows = records.flatMap((r) => unpackRows(r.rows)), games = records.flatMap((r) => r.games?.games || []);
  const output = [];
  for (const item of board.games) {
    const full = games.find((g) => g.game_id === item.game_id) || item;
    const base = { game_id: item.game_id, start_utc: full.start_utc, season: full.season, home_team: full.home_team, away_team: full.away_team, picks: [], availability: [], candidates: 0, skipped: {} };
    if (sources.lines.state !== 'ok') { output.push({ ...base, state: sources.lines.state, message: sources.lines.message }); continue; }
    const view = await buildGame({ load, sport, gameId: item.game_id, seasons });
    const ranked = rankGameProps({ sport, game: full, lines: sources.lines.lines, injuries: sources.injuries, players: people?.players || [], rows, model, matchup: view?.matchup, allGames: games, now,
      includeCandidates: sport === 'nba', nbaResearch: sport === 'nba' });
    const { ranked_candidates, decisions, ...publicRanked } = ranked;
    const entry = { ...publicRanked, start_utc: full.start_utc, season: full.season };
    if (sport === 'nba') {
      const alpha = selectNBAProps(ranked_candidates || [], sources.reference?.quotes || [], model, now);
      entry.picks = alpha.picks; entry.pair = alpha.pair;
      Object.defineProperty(entry, 'research', { value: { game: full, decisions: decisions || [], candidates: alpha.candidates, matchup: view?.matchup || null } });
    }
    output.push(entry);
  }
  const { lines, raw_events, ...lineMeta } = sources.lines, { reports, ...injuryMeta } = sources.injuries;
  const { quotes, raw_events: referenceRaw, ...referenceMeta } = sources.reference || {};
  let expiry = Math.min(now + 120000, ...board.games.map((g) => Date.parse(g.start_utc)).filter((ms) => ms > now),
    ...output.flatMap((g) => g.picks.map((p) => Date.parse(p.start_utc))).filter((ms) => ms > now));
  if (sport === 'nba') {
    const deadlines = output.flatMap((g) => g.picks.flatMap((p) => [Date.parse(p.observed_utc) + NBA_QUOTE_AGE_MS,
      ...(p.market?.books || []).flatMap((b) => [b.lower_quote, b.upper_quote].filter(Boolean).flatMap((q) => Object.values(q.sides).flatMap((s) => [
        Date.parse(s.observed_utc) + NBA_QUOTE_AGE_MS, ...(s.book_updated_at ? [Date.parse(s.book_updated_at) + NBA_QUOTE_AGE_MS] : []),
      ])))]));
    if (injuryMeta.observed_utc) deadlines.push(Date.parse(injuryMeta.observed_utc) + INJURY_MAX_AGE_MS);
    expiry = Math.min(expiry, ...deadlines.filter(Number.isFinite));
  }
  const result = { sport, rank_version: sport === 'nba' ? NBA_ALPHA_VERSION : PROP_RANK_VERSION, generated_utc: new Date(now).toISOString(), expires_utc: new Date(expiry).toISOString(), window: board.window,
    sources: { lines: { ...lineMeta, count: lines.length }, injuries: injuryMeta, ...(sport === 'nba' ? { reference: { ...referenceMeta, state: referenceMeta.state || 'unavailable', count: quotes?.length || 0 } } : {}) }, games: output,
    methodology: 'Experimental ranking of current full-game standard lines, using sample-discounted history, stat models where available, workload sensitivity, opponent defense, location, rest and injury context. One player from each team; these are individual picks, not a priced entry.' };
  if (sport === 'nba') {
    result.methodology = 'Experimental NBA shortlist anchored to fresh two-way sportsbook prices, with measured minutes/absence scenarios. One player from each team. A pair needs an entered payout and a sensitivity check; market probabilities and copula transfer are not prospectively validated.';
    Object.defineProperty(result, 'research_input', { value: { status, people, model, records } });
    Object.defineProperty(result, 'research_sources', { value: sources });
  }
  return result;
}

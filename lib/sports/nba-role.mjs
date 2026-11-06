// Measured opportunity scenarios, kept separate from sportsbook probabilities.
// No invented starting lineup and no causal claim for observational DNP splits.
import { statValue } from './schema.mjs';
import { nbaName } from './nba-market.mjs';
const OUT = /^(out|doubtful|suspended|inactive|injured reserve|ir|reserve)$/i;
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (v) => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
export function nbaTeamOpportunity(rows) {
  const totals = new Map();
  for (const r of rows) {
    if (!r.played) continue;
    const key = r.game_id + '|' + r.team, a = totals.get(key) || { date: r.date, team: r.team, minutes: 0, used: 0, offensive_rebounds: 0, valid: true };
    const s = r.stats || {}, values = [s.field_goals_attempted, s.free_throws_attempted, s.turnovers, s.offensive_rebounds, r.minutes];
    if (!values.every((n) => typeof n === 'number' && Number.isFinite(n))) a.valid = false;
    else { a.minutes += r.minutes; a.used += s.field_goals_attempted + 0.44 * s.free_throws_attempted + s.turnovers; a.offensive_rebounds += s.offensive_rebounds; }
    totals.set(key, a);
  }
  return totals;
}
export function nbaRoleScenario({ player, history, byPlayer, players, availability, stat, teamTotals = new Map() }) {
  const recent = history.filter((r) => r.played && r.minutes > 0).slice(0, 40);
  if (recent.length < 8) return { state: 'unavailable', risk_flags: ['insufficient_role_history'], reason: 'Fewer than eight played games for a minutes scenario.' };
  const minutes = recent.slice(0, 10).map((r) => r.minutes), weight = minutes.map((_, i) => 0.5 ** (i / 5));
  const base = minutes.reduce((s, m, i) => s + m * weight[i], 0) / weight.reduce((s, w) => s + w, 0), risks = [], absences = [];
  const missingGames = new Set();
  for (const report of availability.filter((p) => p.team === player.team && OUT.test(p.status) && nbaName(p.name) !== nbaName(player.name))) {
    const matches = players.filter((p) => nbaName(p.name) === nbaName(report.name) && byPlayer.get(p.player_id)?.[0]?.team === player.team);
    if (matches.length !== 1) continue;
    const teammate = byPlayer.get(matches[0].player_id) || [], normal = avg(teammate.filter((r) => r.played && r.team === player.team).slice(0, 10).map((r) => r.minutes));
    if (!(normal >= 20)) continue; // Bench absences do not invent a starter-sized shift.
    const dnps = new Set(teammate.filter((r) => r.team === player.team && r.played === false).map((r) => r.game_id));
    const matched = recent.slice(0, 20).filter((r) => dnps.has(r.game_id));
    absences.push({ name: report.name, normal_minutes: round(normal), observed_without_games: matched.length, without_minutes: round(avg(matched.map((r) => r.minutes))) });
    if (matched.length < 3) risks.push('unmeasured_rotation_absence');
    else matched.forEach((r) => missingGames.add(r.game_id));
  }
  const without = recent.slice(0, 20).filter((r) => missingGames.has(r.game_id));
  const delta = without.length ? (avg(without.map((r) => r.minutes)) - base) * without.length / (without.length + 10) : 0;
  const projected = Math.max(0, Math.min(48, base + delta));
  const sorted = recent.slice(0, 20).map((r) => r.minutes).sort((a, b) => a - b);
  const low = Math.max(0, Math.min(48, sorted[Math.floor((sorted.length - 1) * 0.1)] + delta));
  const high = Math.max(low, Math.min(48, sorted[Math.ceil((sorted.length - 1) * 0.9)] + delta));
  if (high - low > 14) risks.push('volatile_minutes');
  const rateRows = recent.filter((r) => statValue(r, stat) != null), units = rateRows.reduce((s, r) => s + r.minutes, 0);
  const rate = units ? rateRows.reduce((s, r) => s + statValue(r, stat), 0) / units : null;
  const withoutRows = without.filter((r) => statValue(r, stat) != null), withoutUnits = withoutRows.reduce((s, r) => s + r.minutes, 0);
  const withoutRate = withoutUnits ? withoutRows.reduce((s, r) => s + statValue(r, stat), 0) / withoutUnits : null;
  const projectedRate = rate == null ? null : withoutRate == null ? rate : rate + (withoutRate - rate) * withoutRows.length / (withoutRows.length + 10);
  const usage = (rs) => avg(rs.map((r) => {
    const t = teamTotals.get(r.game_id + '|' + r.team), s = r.stats || {};
    if (!t?.valid || !(t.used > 0) || ![s.field_goals_attempted, s.free_throws_attempted, s.turnovers].every(Number.isFinite)) return null;
    return 100 * (s.field_goals_attempted + 0.44 * s.free_throws_attempted + s.turnovers) * (t.minutes / 5) / (r.minutes * t.used);
  }).filter((v) => v != null && v >= 0 && v <= 100));
  const baseUsage = usage(recent.slice(0, 10)), absenceUsage = usage(without);
  const tempo = (team) => avg([...teamTotals.values()].filter((t) => t.team === team && t.valid && t.minutes > 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((t) => (t.used - t.offensive_rebounds) * 48 / (t.minutes / 5)));
  const ownTempo = tempo(player.team), opponentTempo = tempo(player.opponent);
  const expectedTempo = ownTempo && opponentTempo ? (ownTempo + opponentTempo) / 2 : null;
  const tempoFactor = expectedTempo && ownTempo ? Math.max(0.8, Math.min(1.2, expectedTempo / ownTempo)) : 1;
  return { state: 'experimental', baseline_minutes: round(base), projected_minutes: round(projected), minutes_range: { low: round(low), high: round(high) },
    stat_per_minute: round(rate), projected_stat_per_minute: round(projectedRate), scenario_stat_mean: projectedRate == null ? null : round(projected * projectedRate * tempoFactor), absence_splits: absences,
    usage_pct: round(baseUsage == null ? null : absenceUsage == null ? baseUsage : baseUsage + (absenceUsage - baseUsage) * without.length / (without.length + 10)),
    possessions_proxy: { team: round(ownTempo), opponent: round(opponentTempo), expected: round(expectedTempo), factor: round(tempoFactor) },
    games: recent.length, risk_flags: [...new Set(risks)], starting_lineup: 'unconfirmed',
    note: 'Recency-weighted minutes, measured DNP changes in minutes/rate, usage and a box-score possessions proxy where available. Minute range is historical variation, not a confidence interval. This scenario does not increase market probabilities.' };
}

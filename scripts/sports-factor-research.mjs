// Offline factor research for the Sports stat models (run by hand, no
// network). Reads a local copy of the stored Sports records and checks new
// game factors with buildModel's research hook: each is fitted on the
// earlier dates and kept only when it beats leaving it out on the later ones
// on Brier and log loss by more than a day-clustered standard error, on top
// of the factors the model already serves. Research factors are reported,
// never served.
//
//   node scripts/sports-factor-research.mjs --store DIR --sport nba [--before YYYY-MM-DD] [--out FILE]
//
// DIR holds the records as the data job writes them, one file per key with
// "/" written as "__" (for example _stonks__sports__v1__nba__player-games__2026.json).
//
// Factors (2026-11-20):
//   rest       own rest. NBA: [back-to-back, 3+ days off]; NFL: [short week
//              (5 days or less), off a bye (12+ days)]
//   rest_edge  own rest flags minus the opponent's
//   travel     time zones crossed since the team's last game: [|hours| / 3,
//              hours / 3] (east is positive); neutral sites left out
//   return     first game back after missing 2+ of his team's games
//   pos_out    NBA: regular minutes missing at his position (G / F / C) / 240
//   vacated    NFL: share of the team's targets and carries of regulars who
//              are not playing: [targets, carries]
//
// `return`, NFL `vacated` and NFL `rest` (completions and attempts) passed on
// two holdouts (all seasons, and games before 2025-07-01 NBA / 2026-03-01
// NFL) and are served since sports-model-7 (models.mjs computes them itself);
// once served, this script reports the model's own check for them and tests
// only the others.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildModel, GAME_FACTORS, positionGroup, regularMinutes } from '../lib/sports/models.mjs';
import { unpackRows } from '../lib/sports/rows.mjs';

const DAY = 86400000;
// Standard-time UTC offsets of each team's home city (the shift between two
// cities is what matters; daylight time moves both).
export const TEAM_TZ = Object.freeze({
  nba: { atl: -5, bos: -5, bkn: -5, cha: -5, cle: -5, det: -5, ind: -5, mia: -5, ny: -5, orl: -5, phi: -5, tor: -5, wsh: -5,
    chi: -6, dal: -6, hou: -6, mem: -6, mil: -6, min: -6, no: -6, okc: -6, sa: -6,
    den: -7, utah: -7, phx: -7, gs: -8, lac: -8, lal: -8, por: -8, sac: -8 },
  nfl: { atl: -5, bal: -5, buf: -5, car: -5, cin: -5, cle: -5, det: -5, ind: -5, jax: -5, mia: -5, ne: -5, nyg: -5, nyj: -5, phi: -5, pit: -5, tb: -5, was: -5,
    chi: -6, dal: -6, gb: -6, hou: -6, kc: -6, min: -6, no: -6, ten: -6, ari: -7, den: -7, la: -8, lac: -8, lv: -8, sea: -8, sf: -8 },
});
const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);

// Every factor input for every stored row, keyed `player|game`. Pure: rows
// and games in, a Map out. Uses only what was known before each game.
export function researchInputs(sport, rows, games) {
  const tz = TEAM_TZ[sport];
  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const teamGames = new Map();
  for (const g of games) {
    if (g.status !== 'final' || !g.local_date) continue;
    for (const t of [g.home_team, g.away_team]) { const l = teamGames.get(t) || []; l.push(g); teamGames.set(t, l); }
  }
  for (const l of teamGames.values()) l.sort((a, b) => a.local_date.localeCompare(b.local_date));
  const prevGame = (team, date) => {
    const l = teamGames.get(team) || [];
    let lo = 0, hi = l.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (l[m].local_date < date) lo = m + 1; else hi = m; }
    return lo > 0 ? l[lo - 1] : null;
  };
  const gamesBetween = (team, from, to) => (teamGames.get(team) || []).filter((g) => g.local_date > from && g.local_date < to).length;
  const placeTz = (g) => (g && !g.neutral ? tz[g.home_team] : null);
  const restFlags = (team, date) => {
    const p = prevGame(team, date);
    if (!p) return null;
    const d = days(p.local_date, date);
    if (d > 30) return null;
    return sport === 'nba' ? [d <= 1 ? 1 : 0, d >= 3 ? 1 : 0] : [d <= 5 ? 1 : 0, d >= 12 ? 1 : 0];
  };
  const sorted = rows.filter((r) => r?.date && r.player_id).slice().sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map();
  for (const r of sorted) { const l = byDate.get(r.date) || []; l.push(r); byDate.set(r.date, l); }
  const hist = new Map(); // player -> rows, oldest first
  const volume = new Map(); // NFL: team|game -> { targets, carries }
  const out = new Map();
  for (const [date, dayRows] of byDate) {
    const playing = new Set(dayRows.filter((r) => r.played).map((r) => r.team + '|' + r.player_id));
    const teams = new Set(dayRows.map((r) => r.team));
    // Regulars of each team who are not playing today.
    const missing = new Map(); // team -> [{ pos, minutes, targets, carries }]
    const teamVolume = new Map(); // NFL: team -> { targets, carries } per game, last 4 games
    for (const [pid, h] of hist) {
      const last = h[h.length - 1];
      if (!last || !teams.has(last.team) || playing.has(last.team + '|' + pid)) continue;
      const recent = h.slice(-10).reverse();
      if (sport === 'nba') {
        const m = regularMinutes(recent, last.team, date);
        if (m) { const l = missing.get(last.team) || []; l.push({ pos: positionGroup('nba', last.position), minutes: m }); missing.set(last.team, l); }
      } else {
        if (days(last.date, date) > 21) continue;
        const team4 = (teamGames.get(last.team) || []).filter((g) => g.local_date < date).slice(-4).map((g) => g.game_id);
        const played = h.filter((r) => r.played && team4.includes(r.game_id));
        if (played.length < 3) continue;
        const avg = (k) => played.reduce((a, r) => a + (r.stats?.[k] || 0), 0) / played.length;
        const t = avg('targets'), c = avg('carries');
        if (t >= 3 || c >= 5) { const l = missing.get(last.team) || []; l.push({ targets: t, carries: c }); missing.set(last.team, l); }
      }
    }
    if (sport === 'nfl') {
      for (const team of teams) {
        const team4 = (teamGames.get(team) || []).filter((g) => g.local_date < date).slice(-4).map((g) => g.game_id);
        if (!team4.length) continue;
        let t = 0, c = 0;
        for (const id of team4) { const v = volume.get(team + '|' + id); if (v) { t += v.targets; c += v.carries; } }
        teamVolume.set(team, { targets: t / team4.length, carries: c / team4.length });
      }
    }
    for (const r of dayRows) {
      const g = gameById.get(r.game_id);
      const z = {};
      const own = restFlags(r.team, date), opp = restFlags(r.opponent, date);
      if (own) z.rest = own;
      if (own && opp) z.rest_edge = own.map((v, i) => v - opp[i]);
      const p = prevGame(r.team, date);
      if (p && days(p.local_date, date) <= 30) {
        const a = placeTz(p), b = placeTz(g);
        if (a != null && b != null) z.travel = [Math.abs(b - a) / 3, (b - a) / 3];
      }
      const h = hist.get(r.player_id) || [];
      const lastPlayed = [...h].reverse().find((x) => x.played);
      if (lastPlayed && lastPlayed.team === r.team && days(lastPlayed.date, date) <= 60) z.return = [gamesBetween(r.team, lastPlayed.date, date) >= 2 ? 1 : 0];
      if (sport === 'nba') {
        const pos = positionGroup('nba', r.position || lastPlayed?.position);
        const lost = (missing.get(r.team) || []).filter((m) => m.pos === pos).reduce((a, m) => a + m.minutes, 0);
        z.pos_out = [Math.min(lost, 120) / 240];
      } else {
        const v = teamVolume.get(r.team);
        if (v && v.targets > 0 && v.carries > 0) {
          const gone = missing.get(r.team) || [];
          const t = gone.reduce((a, m) => a + m.targets, 0), c = gone.reduce((a, m) => a + m.carries, 0);
          z.vacated = [Math.min(0.6, t / v.targets), Math.min(0.6, c / v.carries)];
        }
      }
      out.set(r.player_id + '|' + r.game_id, z);
    }
    for (const r of dayRows) {
      const l = hist.get(r.player_id) || []; l.push(r); if (l.length > 40) l.shift(); hist.set(r.player_id, l);
      const k = r.team + '|' + r.game_id, v = volume.get(k) || { targets: 0, carries: 0 };
      v.targets += r.stats?.targets || 0; v.carries += r.stats?.carries || 0; volume.set(k, v);
    }
  }
  return out;
}

export const RESEARCH_FACTORS = Object.freeze({ nba: ['rest', 'rest_edge', 'travel', 'return', 'pos_out'], nfl: ['rest', 'rest_edge', 'travel', 'return', 'vacated'] });

function loadStore(dir, sport) {
  const files = readdirSync(dir);
  const read = (f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const rows = [], games = [];
  for (const f of files.filter((f) => f.includes(`__${sport}__player-games__`)).sort()) rows.push(...unpackRows(read(f)));
  for (const f of files.filter((f) => f.includes(`__${sport}__games__`)).sort()) games.push(...(read(f).games || []));
  return { rows, games };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const sport = arg('sport'), dir = arg('store');
  if (!['nba', 'nfl'].includes(sport) || !dir) { console.error('usage: --store DIR --sport nba|nfl [--out FILE]'); process.exit(2); }
  // --before DATE: only games before DATE (a second, earlier holdout).
  const before = arg('before');
  const loaded = loadStore(dir, sport);
  const rows = before ? loaded.rows.filter((r) => r.date < before) : loaded.rows;
  const games = before ? loaded.games.filter((g) => (g.local_date || '') < before) : loaded.games;
  const inputs = researchInputs(sport, rows, games);
  const served = GAME_FACTORS[sport] || [];
  const research = RESEARCH_FACTORS[sport].filter((n) => !served.includes(n));
  const names = [...served, ...research];
  const model = buildModel({ sport, rows, games, includeJoint: false, research: { names: research, inputs: (row) => inputs.get(row.player_id + '|' + row.game_id) || null } });
  const table = [];
  for (const [stat, ev] of Object.entries(model.evaluation)) {
    for (const name of names) {
      const f = ev.factors?.[name];
      if (!f) continue;
      table.push({ stat, factor: name, games: f.games, test: f.test ?? null, gain: f.gain?.brier ?? null, se: f.gain?.se ?? null,
        served: served.includes(name), would_apply: f.would_apply ?? f.applied ?? false, betas: f.betas_check ?? null, why: f.why });
    }
  }
  const summary = Object.fromEntries(names.map((n) => [n, table.filter((t) => t.factor === n && t.would_apply).map((t) => t.stat)]));
  const result = { sport, generated_utc: new Date().toISOString(), rows: rows.length, games: games.length, summary, table };
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(result, null, 1));
  console.log(sport, 'rows', rows.length, 'games', games.length);
  for (const t of table) console.log([t.stat, t.factor + (t.served ? ' (served)' : ''), t.games, t.test, t.gain, t.se, t.would_apply ? 'PASS' : '-', JSON.stringify(t.betas)].join('\t'));
  console.log('passes:', JSON.stringify(summary));
}

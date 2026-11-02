// A made-up NBA league for the stat-model tests: deterministic (seeded),
// with known minutes, scoring rates, one soft defense and one tough one, so
// the tests can check the model finds what was built in. Not real data.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand, lambda) {
  // Knuth for small means, a normal approximation above 40.
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(rand)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}
function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
}
// Gamma(shape k, mean 1) by summing exponentials (k is a whole number here).
function gammaMean1(rand, k) {
  let s = 0;
  for (let i = 0; i < k; i++) s -= Math.log(rand() || 1e-12);
  return s / k;
}

export const MODEL_TEAMS = ['atl', 'bos', 'chi', 'den', 'gs', 'lal', 'mia', 'mil', 'ny', 'okc', 'phx', 'sa'];
export const SOFT_DEFENSE = 'sa';   // opponents score 25% more
export const TOUGH_DEFENSE = 'okc'; // opponents score 20% less

const ROLES = [
  { pos: 'G', min: 34 }, { pos: 'G', min: 31 }, { pos: 'F', min: 30 }, { pos: 'F', min: 27 },
  { pos: 'C', min: 26 }, { pos: 'G', min: 19 }, { pos: 'F', min: 15 }, { pos: 'C', min: 11 },
];

// `days` game days from `start`, every team playing once a day (six games).
// Returns rows (lib/sports/schema.mjs player games), games and players.
export function nbaModelLeague({ seed = 7, days = 80, start = '2025-10-21', season = 2025 } = {}) {
  const rand = rng(seed);
  const players = [];
  for (const team of MODEL_TEAMS) {
    ROLES.forEach((r, i) => {
      players.push({
        sport: 'nba', player_id: 'm' + team + i, name: team.toUpperCase() + ' Player ' + (i + 1), team, position: r.pos,
        minutes: r.min, pts: 0.3 + rand() * 0.55, reb: (r.pos === 'C' ? 0.28 : r.pos === 'F' ? 0.19 : 0.12) + rand() * 0.06,
        provider_ids: { espn: 'm' + team + i }, last_season: season,
      });
    });
  }
  const effect = (opp) => (opp === SOFT_DEFENSE ? 1.25 : opp === TOUGH_DEFENSE ? 0.8 : 1);
  const rows = [], games = [];
  const t0 = Date.parse(start + 'T00:00:00Z');
  for (let d = 0; d < days; d++) {
    const date = new Date(t0 + d * 86400000).toISOString().slice(0, 10);
    const order = MODEL_TEAMS.slice().sort(() => rand() - 0.5);
    for (let g = 0; g < order.length; g += 2) {
      const home = order[g], away = order[g + 1];
      const game_id = 'm' + season + String(d).padStart(3, '0') + g;
      const score = { [home]: 0, [away]: 0 };
      for (const team of [home, away]) {
        const opp = team === home ? away : home;
        for (const p of players.filter((x) => x.team === team)) {
          const played = rand() > 0.02;
          const minutes = played ? Math.max(4, Math.min(46, Math.round(p.minutes + gauss(rand) * 3.5))) : 0;
          const mu = minutes * p.pts * effect(opp) * (team === home ? 1.03 : 0.97);
          const points = played ? poisson(rand, mu * gammaMean1(rand, 6)) : null;
          const rebounds = played ? poisson(rand, minutes * p.reb * gammaMean1(rand, 12)) : null;
          if (played) score[team] += points;
          rows.push({
            sport: 'nba', player_id: p.player_id, game_id, season, week: null, season_type: 'REG', date, team, opponent: opp, home: team === home,
            played, starter: p.minutes >= 26, minutes: played ? minutes : 0, position: p.pos, dnp_reason: played ? null : 'COACH\'S DECISION',
            stats: { points, rebounds, assists: null, threes: null, pra: null, steals: null, blocks: null },
          });
        }
      }
      games.push({
        sport: 'nba', game_id, season, season_type: 'REG', week: null, start_utc: date + 'T23:30:00Z', local_date: date, time_tbd: false,
        home_team: home, away_team: away, status: 'final', home_score: score[home], away_score: score[away], venue: null,
      });
    }
  }
  return { rows, games, players: players.map(({ minutes, pts, reb, ...p }) => p), truth: players };
}

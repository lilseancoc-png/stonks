// Stored player-game rows are packed as columns + arrays: a full NBA season
// is ~35,000 rows, and repeating every key in every row tripled its size.
// `unpackRows` returns the plain row objects lib/sports/schema.mjs defines.
export const ROW_FORMAT = 'columns-1';
const BASE = ['player_id', 'game_id', 'date', 'team', 'opponent', 'home', 'played', 'position', 'week', 'season_type', 'minutes', 'starter', 'dnp_reason'];
const BOOLS = new Set(['home', 'played', 'starter']);

export function packRows(rows) {
  const statKeys = [...new Set(rows.flatMap((r) => Object.keys(r.stats || {})))].sort();
  const columns = [...BASE, ...statKeys.map((k) => 'stats.' + k)];
  const data = rows.map((r) => [
    ...BASE.map((k) => { const v = r[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v; }),
    ...statKeys.map((k) => r.stats?.[k] ?? null),
  ]);
  return { format: ROW_FORMAT, columns, rows: data };
}

// `playerId` filters before building objects, so one player's log does not
// unpack a whole season.
export function unpackRows(rec, { playerId } = {}) {
  if (!rec || !Array.isArray(rec.rows)) return [];
  if (rec.format !== ROW_FORMAT) return playerId ? rec.rows.filter((r) => r.player_id === playerId) : rec.rows;
  const cols = Array.isArray(rec.columns) ? rec.columns : [];
  const pid = cols.indexOf('player_id');
  const src = playerId ? rec.rows.filter((a) => a[pid] === playerId) : rec.rows;
  return src.map((a) => {
    const r = { sport: rec.sport, season: rec.season, stats: {} };
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i], v = a[i];
      if (c.startsWith('stats.')) r.stats[c.slice(6)] = v ?? null;
      else if (v == null) continue;
      else r[c] = BOOLS.has(c) ? v === 1 : v;
    }
    return r;
  });
}

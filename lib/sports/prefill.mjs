// Pick Builder prefill links:
//   https://mingstreet.app/?tab=sports-pick-builder&entry=<base64url JSON>
// Claude or ChatGPT reads a slip screenshot, finds each player and game, and
// hands back this link; the page fills the draft and the owner checks and
// saves it. A link never carries chances: those stay the owner's to enter.
// decodePrefill is pasted into app.js with toString(), so it must stay
// self-contained (no imports, no outer names).
export const PREFILL_PARAM = 'entry';
export const PREFILL_VERSION = 1;

export function encodePrefill(entry) {
  const body = {
    v: 1,
    operator: entry.operator || null,
    format: entry.format || 'power',
    stake: entry.stake ?? null,
    payouts: entry.payouts || {},
    // Game bets (2026-11-12) carry kind 'team'; any pick may carry its odds
    // (`price`, decimal) for a parlay.
    legs: (entry.legs || []).map((l) => {
      const price = l.price > 1 ? { price: l.price } : {};
      return l.kind === 'team'
        ? { kind: 'team', sport: l.sport, game_id: l.game_id, market: l.market, team: l.team ?? null, side: l.side ?? null, line: l.line ?? null, ...price }
        : { sport: l.sport, player_id: l.player_id, game_id: l.game_id, stat: l.stat, side: l.side, threshold: l.threshold, ...(l.sport === 'nba' && l.offer_type ? { offer_type: l.offer_type } : {}), ...(l.sport === 'nba' && typeof l.starting === 'boolean' ? { starting: l.starting } : {}), ...price };
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePrefill(param) {
  const ID = /^[a-z0-9][a-z0-9_.:-]{0,95}$/;
  if (typeof param !== 'string' || !param || param.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(param)) return null;
  let data;
  try {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((param.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) { return null; }
  if (!data || data.v !== 1 || !Array.isArray(data.legs) || data.legs.length < 1 || data.legs.length > 6) return null;
  const legs = [];
  const half = (x) => typeof x === 'number' && Number.isFinite(x) && Math.round(x * 2) === x * 2;
  for (const l of data.legs) {
    if (!l || (l.sport !== 'nba' && l.sport !== 'nfl')) return null;
    const price = typeof l.price === 'number' && l.price > 1 && l.price <= 1001 ? { price: Math.round(l.price * 10000) / 10000 } : {};
    if (l.kind === 'team') {
      const game = String(l.game_id || '').toLowerCase(), market = l.market;
      if (!ID.test(game) || ['moneyline', 'spread', 'win_by', 'total', 'team_total'].indexOf(market) < 0) return null;
      const team = market === 'total' ? null : String(l.team || '').toLowerCase();
      if (market !== 'total' && !/^[a-z0-9]{2,5}$/.test(team)) return null;
      const line = market === 'moneyline' ? null : Number(l.line);
      if (market === 'spread' && !(half(line) && Math.abs(line) <= 60)) return null;
      if (market === 'win_by' && !(Number.isInteger(line) && line >= 1 && line <= 60)) return null;
      if ((market === 'total' || market === 'team_total') && !(half(line) && line > 0 && line <= 400)) return null;
      const side = market === 'total' || market === 'team_total' || market === 'win_by' ? (l.side === 'under' ? 'under' : l.side === 'over' || market === 'win_by' ? 'over' : null) : 'over';
      if (!side) return null;
      legs.push(Object.assign({ kind: 'team', sport: l.sport, game_id: game, market, team, side, line }, price));
      continue;
    }
    const player = String(l.player_id || '').toLowerCase(), game = String(l.game_id || '').toLowerCase();
    const t = Number(l.threshold);
    if (!ID.test(player) || !ID.test(game) || typeof l.stat !== 'string' || !/^[a-z_]{1,40}$/.test(l.stat)) return null;
    if (l.side !== 'over' && l.side !== 'under') return null;
    if (!(l.threshold != null && l.threshold !== '' && Number.isFinite(t) && t >= 0 && t <= 1000 && Math.round(t * 2) === t * 2)) return null;
    const starting = l.sport === 'nba' && typeof l.starting === 'boolean' ? { starting: l.starting } : {};
    if (l.offer_type != null && (l.sport !== 'nba' || !['standard', 'goblin'].includes(l.offer_type) || (l.offer_type === 'goblin' && l.side !== 'over'))) return null;
    legs.push(Object.assign({ sport: l.sport, player_id: player, game_id: game, stat: l.stat, side: l.side, threshold: t }, starting, price, l.offer_type ? { offer_type: l.offer_type } : {}));
  }
  const payouts = {};
  if (data.payouts && typeof data.payouts === 'object' && !Array.isArray(data.payouts)) {
    Object.keys(data.payouts).forEach((k) => {
      const n = Number(k), m = Number(data.payouts[k]);
      if (Number.isInteger(n) && n >= 0 && n <= legs.length && Number.isFinite(m) && m >= 0 && m <= 100000) payouts[n] = m;
    });
  }
  const stake = Number(data.stake);
  return {
    operator: ['prizepicks', 'betr', 'sportsbook', 'kalshi', 'other'].indexOf(data.operator) >= 0 ? data.operator : null,
    format: data.format === 'flex' || data.format === 'parlay' ? data.format : 'power',
    stake: stake > 0 && stake <= 100000 ? Math.round(stake * 100) / 100 : null,
    payouts,
    legs,
  };
}

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
    legs: (entry.legs || []).map((l) => ({ sport: l.sport, player_id: l.player_id, game_id: l.game_id, stat: l.stat, side: l.side, threshold: l.threshold })),
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
  for (const l of data.legs) {
    if (!l || (l.sport !== 'nba' && l.sport !== 'nfl')) return null;
    const player = String(l.player_id || '').toLowerCase(), game = String(l.game_id || '').toLowerCase();
    const t = Number(l.threshold);
    if (!ID.test(player) || !ID.test(game) || typeof l.stat !== 'string' || !/^[a-z_]{1,40}$/.test(l.stat)) return null;
    if (l.side !== 'over' && l.side !== 'under') return null;
    if (!(l.threshold != null && l.threshold !== '' && Number.isFinite(t) && t >= 0 && t <= 1000 && Math.round(t * 2) === t * 2)) return null;
    legs.push({ sport: l.sport, player_id: player, game_id: game, stat: l.stat, side: l.side, threshold: t });
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
    operator: ['prizepicks', 'betr', 'other'].indexOf(data.operator) >= 0 ? data.operator : null,
    format: data.format === 'flex' ? 'flex' : 'power',
    stake: stake > 0 && stake <= 100000 ? Math.round(stake * 100) / 100 : null,
    payouts,
    legs,
  };
}

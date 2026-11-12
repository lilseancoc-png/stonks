// Every kind of pick the Pick Builder takes (owner ask 2026-11-12): player
// lines and game bets (who wins, the spread, win by X or more, the game total
// and each team's total), and the odds math shared by the server, the page
// and the MCP. Pure and deterministic.
//
// Two kinds of pick:
//   player: { kind: 'player', sport, game_id, player_id, stat, side, threshold }
//   team:   { kind: 'team', sport, game_id, market, team, side, line }
// A pick without `kind` is a player pick (every entry saved before this).
//
// Team markets (the team game model's own, lib/sports/team-model.mjs):
//   moneyline   `team` wins (an NFL tie is a push)
//   spread      `team` covers `line` (−5.5 = favored by 5.5; whole lines push)
//   win_by      `team` wins by `line` or more points (side over = yes, under = no)
//   total       the game total goes `side` over / under `line`
//   team_total  `team`'s own points go `side` over / under `line`
//
// Odds: a price can be typed as American (−110, +150), decimal (1.91) or a
// prediction-market price in cents (62¢, the Kalshi style: pay 62¢, get $1
// back if it happens). Each is stored as the decimal multiplier, stake
// included, so one number drives every format.

export const LEG_KINDS = Object.freeze(['player', 'team']);
export const TEAM_BET_MARKETS = Object.freeze(['moneyline', 'spread', 'win_by', 'total', 'team_total']);
export const MARKET_LABELS = Object.freeze({ moneyline: 'To win', spread: 'Spread', win_by: 'Win by X or more', total: 'Game total', team_total: 'Team total' });
export const MAX_DECIMAL = 1001;   // +100000 American
const round = (x, d) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export const legKind = (leg) => (leg && leg.kind === 'team' ? 'team' : 'player');

// ---- Odds formats ----------------------------------------------------------------
// Read a typed price. Returns { decimal, american, cents, typed } or null.
//   "-110" "+150"  American (a sign, or 100 and up with no sign)
//   "1.91"         decimal (above 1 and below 100)
//   "62c" "62¢"    cents on a $1 contract (1 to 99)
//   ".62" "0.62"   the same as a chance (above 0 and below 1)
export function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw > 1 && raw <= MAX_DECIMAL ? fromDecimal(raw) : null;
  const s = String(raw).trim().replace(/−/g, '-').replace(/\s+/g, '').toLowerCase();
  let m;
  if ((m = /^(\d{1,2}(?:\.\d+)?)(?:c|¢|cents?)$/.exec(s))) {
    const c = Number(m[1]);
    return c > 0 && c < 100 ? fromDecimal(100 / c, 'cents') : null;
  }
  if ((m = /^([+-])(\d{3,6}(?:\.\d+)?)$/.exec(s))) {
    const a = Number(m[2]);
    if (!(a >= 100 && a <= 100000)) return null;
    return fromDecimal(m[1] === '+' ? 1 + a / 100 : 1 + 100 / a, 'american');
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const x = Number(s);
  if (x > 0 && x < 1) return fromDecimal(1 / x, 'cents');
  if (x > 1 && x < 100) return fromDecimal(x, 'decimal');
  if (x >= 100 && x <= 100000) return fromDecimal(1 + x / 100, 'american');
  return null;
}
function fromDecimal(d, typed = 'decimal') {
  if (!(d > 1 && d <= MAX_DECIMAL)) return null;
  return { decimal: round(d, 4), american: americanOf(d), cents: round(100 / d, 1), typed };
}
// American odds for a decimal multiplier (−110 for 1.909, +150 for 2.5).
export function americanOf(d) {
  if (!(d > 1)) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}
// The fair price of a chance in every format: what a bet at exactly this
// chance would pay with no margin.
export function fairOdds(p) {
  if (!(p > 0 && p < 1)) return null;
  const d = 1 / p;
  return { decimal: round(d, 3), american: americanOf(d), cents: round(p * 100, 1) };
}
export function americanText(a) { return a == null ? '—' : (a > 0 ? '+' : '−') + Math.abs(a); }
// The price's edge for a chance: expected profit per $1 staked.
export function edgeOf(p, decimal) {
  if (!(p >= 0 && p <= 1) || !(decimal > 1)) return null;
  return round(p * decimal - 1, 4);
}

// ---- Team picks ------------------------------------------------------------------
// Checks one team pick's own fields (the game's teams are checked when it is
// matched). Returns the cleaned pick or an error message.
export function cleanTeamLeg(raw) {
  const market = String(raw.market || '');
  if (!TEAM_BET_MARKETS.includes(market)) return { error: 'choose a game bet: ' + TEAM_BET_MARKETS.join(', ') };
  const team = market === 'total' ? null : String(raw.team || '').toLowerCase();
  if (market !== 'total' && !/^[a-z0-9]{2,5}$/.test(team)) return { error: 'choose the team' };
  let side = raw.side == null || raw.side === '' ? null : String(raw.side);
  const line = raw.line == null || raw.line === '' ? null : Number(raw.line);
  const half = (x) => Number.isFinite(x) && Math.round(x * 2) === x * 2;
  if (market === 'moneyline') { side = 'over'; return { market, team, side, line: null }; }
  if (market === 'spread') {
    if (!(half(line) && Math.abs(line) <= 60)) return { error: 'the spread must be a whole or half number from −60 to 60' };
    return { market, team, side: 'over', line };
  }
  if (market === 'win_by') {
    if (!(Number.isInteger(line) && line >= 1 && line <= 60)) return { error: 'win by needs whole points from 1 to 60' };
    if (side == null) side = 'over';
    if (side !== 'over' && side !== 'under') return { error: 'win by is yes (over) or no (under)' };
    return { market, team, side, line };
  }
  if (side !== 'over' && side !== 'under') return { error: 'choose over or under' };
  if (!(half(line) && line > 0 && line <= 400)) return { error: 'the total must be a whole or half number above 0' };
  return { market, team, side, line };
}

// A short name for a team pick: "LAL to win", "LAL −5.5", "LAL to win by
// 10+", "LAL not to win by 10+", "Over 228.5", "LAL over 114.5".
export function teamLegLabel(leg) {
  const T = String(leg.team || '').toUpperCase();
  const num = (x) => (x < 0 ? '−' : '') + Math.abs(x);
  switch (leg.market) {
    case 'moneyline': return T + ' to win';
    case 'spread': return T + ' ' + (leg.line === 0 ? 'pick’em' : (leg.line > 0 ? '+' : '') + num(leg.line));
    case 'win_by': return T + (leg.side === 'under' ? ' not to win by ' : ' to win by ') + leg.line + '+';
    case 'total': return 'Game total ' + leg.side + ' ' + leg.line;
    case 'team_total': return T + ' team total ' + leg.side + ' ' + leg.line;
    default: return 'Game bet';
  }
}
// Kalshi-style name for a player line: "over 24.5" reads as "25+".
export function milestoneLabel(side, threshold) {
  if (side !== 'over' || !Number.isFinite(threshold) || Math.round(threshold * 2) % 2 === 0) return null;
  return Math.ceil(threshold) + '+';
}

// The model's bet for a team pick, in priceTeamBet's terms.
export function teamBetOf(leg) {
  return leg.market === 'win_by' ? { market: 'win_by', team: leg.team, line: leg.line }
    : { market: leg.market, team: leg.team, side: leg.side, line: leg.line };
}

// A finished game's result for one team pick: win, push or loss.
export function teamLegResult(leg, game) {
  if (!game || !Number.isInteger(game.home_score) || !Number.isInteger(game.away_score)) return null;
  const home = leg.team === game.home_team, away = leg.team === game.away_team;
  const margin = game.home_score - game.away_score, mine = home ? margin : away ? -margin : null;
  const cmp = (a, b) => (a > b ? 'win' : a < b ? 'loss' : 'push');
  switch (leg.market) {
    case 'moneyline': return mine == null ? null : cmp(mine, 0);
    case 'spread': return mine == null ? null : cmp(mine + leg.line, 0);
    case 'win_by': {
      if (mine == null) return null;
      const yes = mine >= leg.line;
      return (leg.side === 'under' ? !yes : yes) ? 'win' : 'loss';
    }
    case 'total': { const r = cmp(game.home_score + game.away_score, leg.line); return leg.side === 'under' ? flip(r) : r; }
    case 'team_total': {
      if (!home && !away) return null;
      const r = cmp(home ? game.home_score : game.away_score, leg.line);
      return leg.side === 'under' ? flip(r) : r;
    }
    default: return null;
  }
}
const flip = (r) => (r === 'win' ? 'loss' : r === 'loss' ? 'win' : r);

// ---- The number each pick reads in a same-game simulation ----------------------
// Each pick wins when one game number lands on its side of a cut: a player's
// stat, the home team's margin, the game total or one team's points. Picks on
// the same number share it exactly (LAL to win and LAL −5.5 move as one).
// `entity` names the number for the measured links (lib/sports/joint.mjs):
// a player and stat, or the team numbers team_margin / team_points /
// game_total, stored from each team's side.
//   up: true when the pick wins with a HIGH value of that number.
export function latentOf(leg, game) {
  if (legKind(leg) === 'player') {
    return { id: 'p:' + leg.player_id + ':' + leg.stat, up: leg.side !== 'under', entity: { player_id: leg.player_id, team: leg.team || null, stat: leg.stat } };
  }
  const home = game ? game.home_team : null;
  const isHome = leg.team != null && leg.team === home;
  if (leg.market === 'total') return { id: 'g:total', up: leg.side !== 'under', entity: { player_id: 'game:' + leg.game_id, team: null, stat: 'game_total' } };
  if (leg.market === 'team_total') return { id: 'g:pts:' + leg.team, up: leg.side !== 'under', entity: { player_id: 'team:' + leg.team, team: leg.team, stat: 'team_points' } };
  // Margin picks read the HOME team's margin.
  const teamUp = leg.market === 'win_by' && leg.side === 'under' ? false : true;
  return { id: 'g:margin', up: isHome ? teamUp : !teamUp, entity: { player_id: 'team:' + home, team: home, stat: 'team_margin' } };
}

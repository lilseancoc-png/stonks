// The sportsbook's price for one owner line, next to the model's chance.
// NBA only: the read-only PropLine feed carries reference sportsbooks
// (lib/sports/prop-sources.mjs) for NBA, and none for NFL. The price is the
// median of the books' no-vig chances (Shin method, lib/sports/nba-market.mjs)
// for exactly this line, or the range a book's nearby lines pin it to. Books
// set these prices with far more information than the stored box scores, so a
// wide gap between the model and the books is a reason to look again, not an
// edge. Pure: the caller loads the feed.
import { lineMatchesGame, reportFor, OUT, UNCERTAIN, restricted } from './props.mjs';
import { nbaMarketForProp, nbaName, VIG_METHOD } from './nba-market.mjs';
import { teamCode } from './prop-sources.mjs';

// How far the model and the book may differ before it is pointed out.
export const BOOK_GAP = 0.05;
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y), i = Math.floor(a.length / 2); return a.length ? (a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2) : null; };

// leg: { sport, player_name, stat, side, threshold }; game: the stored game.
export function bookPriceForLine(leg, game, reference, now) {
  const no = (state, reason) => ({ state, reason, chance: null, low: null, high: null, book_count: 0, books: [], lines: [], vig_method: VIG_METHOD });
  if (leg.sport !== 'nba') return no('unavailable', 'Sportsbook prices are read for NBA only; the free feed has no NFL reference books.');
  if (!reference || reference.state !== 'ok') return no(reference?.state || 'unavailable', reference?.message || 'Sportsbook prices are unavailable right now.');
  if (!game || !(Date.parse(game.start_utc) > now)) return no('unavailable', 'Books are compared only before the game starts.');
  const key = nbaName(leg.player_name);
  const quotes = (reference.quotes || []).filter((q) => q.player_key === key && q.stat === leg.stat && lineMatchesGame(q, game, 'nba'));
  if (!quotes.length) return no('unavailable', 'No current sportsbook line for this player and stat.');
  // Every line the books post for this player and stat, so the owner sees
  // where the main line sits even when it is not the line on the slip.
  const byLine = new Map();
  for (const q of quotes) { if (!byLine.has(q.threshold)) byLine.set(q.threshold, []); byLine.get(q.threshold).push(q); }
  const lines = [...byLine].sort((a, b) => a[0] - b[0]).map(([threshold, qs]) => ({ threshold, over: r4(median(qs.map((q) => q.over_probability))), books: qs.length }));
  const ev = quotes[0];
  const m = nbaMarketForProp({ event_id: ev.event_id, home_team: ev.home_team, away_team: ev.away_team, start_utc: ev.start_utc,
    player_name: leg.player_name, stat: leg.stat, side: leg.side, threshold: leg.threshold }, reference.quotes, now, { historicalThreshold: true });
  if (m.state === 'unavailable') return { ...no('unavailable', m.reason), lines };
  return {
    state: m.state, reason: m.reason, method: m.method,
    // Exact: every book posts this line, median of their no-vig chances.
    // Bounded: the chance sits between `low` and `high` from nearby lines.
    chance: m.probability, low: m.low, high: m.high, book_count: m.book_count,
    books: m.books.map((b) => ({ book: b.book, chance: b.probability, low: b.low, high: b.high, method: b.method })),
    lines, vig_method: VIG_METHOD,
  };
}

// The model against the books: null when either is missing. `gap` is model
// minus book (exact prices) or the distance outside the books' range.
export function bookVsModel(book, modelChance) {
  if (!(modelChance >= 0 && modelChance <= 1) || !book || !['supported', 'thin'].includes(book.state)) return null;
  let gap;
  if (book.chance != null) gap = modelChance - book.chance;
  else if (book.low != null && book.high != null) gap = modelChance > book.high ? modelChance - book.high : modelChance < book.low ? modelChance - book.low : 0;
  else return null;
  return { gap: r4(gap), disagrees: Math.abs(gap) >= BOOK_GAP, leans: gap > 0 ? 'model_higher' : gap < 0 ? 'book_higher' : 'same' };
}

// The latest injury report for one player and his team's absences. Reports
// come from ESPN (lib/sports/prop-sources.mjs) and are context only.
// NFL roster status codes (nflverse players.csv, refreshed every ingest).
const NFL_ROSTER_STATUS = { ACT: 'active roster', RES: 'injured reserve', PUP: 'physically unable to perform list', RSN: 'reserve/non-football injury',
  RSR: 'reserve list', DEV: 'practice squad', CUT: 'released', RLS: 'released', EXE: 'exempt list', INA: 'inactive', SUS: 'suspended',
  RET: 'retired', UFA: 'free agent', RFA: 'free agent', NWT: 'not with team', TRD: 'traded' };
export function nflRosterStatus(player) {
  const code = String(player?.status || '').toUpperCase();
  return code ? { code, label: NFL_ROSTER_STATUS[code] || code } : null;
}
// A player's line on the official NFL injury report (nflverse, stored as
// `nfl/injuries.json` by the daily ingest; game status Out / Doubtful /
// Questionable, practice participation). `week`: the upcoming game's week.
// State `not_yet`: the stored report is for another week, or the player's
// team has filed nothing for this week yet (teams file from the Wednesday
// before a Sunday game). Listed with no game status yet: `game_status` null
// (`listed` true); team filed and the player is not on it: 'not listed'.
export function officialNflReport(record, player, team, week = null) {
  if (!record || !Array.isArray(record.reports)) return null;
  const base = { week: record.week ?? null, source: record.source || 'NFL official injury report' };
  if (week != null && record.week !== week) return { state: 'not_yet', ...base };
  const own = record.reports.find((r) => r.player_id === player?.player_id);
  const teamListed = record.reports.some((r) => r.team === team);
  if (!own && !teamListed) return { state: 'not_yet', ...base };
  return { state: 'ok', ...base, listed: Boolean(own),
    game_status: own ? own.game_status || null : 'not listed', practice: own?.practice || null, injury: own?.injury || null,
    teammates_out: record.reports.filter((r) => r.team === team && r !== own && /^(out|doubtful)$/i.test(r.game_status || '')).map((r) => r.name).slice(0, 10) };
}
// `official`: { record, week } for NFL (the stored official report). Either
// report saying Out or Doubtful marks the player out; Questionable marks it
// unsure. The NFL roster status rides along: off the active roster (injured
// reserve, released, ...) marks him out; the practice squad marks him unsure
// (he plays only when elevated for the game).
export function availabilityFor(player, team, injuries, sport, official = null) {
  const extra = {};
  if (sport === 'nfl') {
    const roster = nflRosterStatus(player);
    if (roster) extra.roster_status = roster;
    const o = official ? officialNflReport(official.record, player, team, official.week ?? null) : null;
    if (o) extra.official = o;
  }
  const officialOut = extra.official?.state === 'ok' && /^(out|doubtful)$/i.test(extra.official.game_status || '');
  const officialUnsure = extra.official?.state === 'ok' && /questionable/i.test(extra.official.game_status || '');
  const practiceSquad = extra.roster_status?.code === 'DEV';
  const offRoster = !!extra.roster_status && !['ACT', 'DEV'].includes(extra.roster_status.code);
  if (!injuries || injuries.state !== 'ok') {
    return { state: injuries?.state || 'unavailable', status: null, detail: null, teammates_out: [], teammates_unsure: [],
      ...(officialOut || offRoster ? { out: true } : officialUnsure || practiceSquad ? { unsure: true } : {}), ...extra };
  }
  const reports = injuries.reports || [];
  const own = reportFor(player, reports, team, sport);
  const onTeam = reports.filter((i) => teamCode(i.team, sport) === team && i !== own);
  return {
    state: 'ok', observed_utc: injuries.observed_utc || null,
    status: own ? own.status : 'not listed', detail: own?.detail || null,
    out: (own ? OUT.test(own.status) : false) || officialOut || offRoster,
    unsure: (own ? UNCERTAIN.test(own.status) || restricted(own.detail) : false) || officialUnsure || practiceSquad,
    teammates_out: onTeam.filter((i) => OUT.test(i.status)).map((i) => i.name).slice(0, 10),
    teammates_unsure: onTeam.filter((i) => UNCERTAIN.test(i.status)).map((i) => i.name).slice(0, 10),
    ...extra,
  };
}

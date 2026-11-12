// Pick Builder service: check a 1-6 pick entry against stored games and
// player history, price it with the entered payout (lib/sports/payout.mjs),
// save it as a paper entry, and settle saved entries from final stats.
// Saved entries and captured lines are append-only records in R2:
//   journal/entries.json      { events: [entry | settle | withdraw] }
//   markets/observations.json { observations: [...] }
// A leg's chance is always chosen by the owner: typed in, or copied on
// purpose from the history hit rate or the stat model (lib/sports/models.mjs).
// Nothing here fills one in.
import { createHash, randomBytes } from 'node:crypto';
import { SPORTS, SIDES, OPERATORS, statIds, statValue, validId, marketSeriesKey, SPORTS_SCHEMA_VERSION } from './schema.mjs';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { unpackRows } from './rows.mjs';
import { seasonFor, localDate } from './time.mjs';
import { forecastStat, gameEnvironment, positionGroup } from './models.mjs';
import { currentTeam, teamAbsence } from './props.mjs';
import { archivedGameLine } from './line-archive.mjs';
import { availabilityFor } from './book-price.mjs';
import { FORMATS, MIN_LEGS, MAX_LEGS, payoutProblems, sameGameGroups, legResult, settleFromLegs, outcomeOf, perPickBreakeven, wilsonRange } from './payout.mjs';
import { evaluateOutcomes } from './entry-price.mjs';
import { legKind, cleanTeamLeg, teamLegLabel, teamBetOf, teamLegResult, latentOf, parsePrice, fairOdds, neverBothWin } from './bets.mjs';
import { forecastGame, priceTeamBet, restDaysFor, teamModelSummary } from './team-model.mjs';

export const JOURNAL_LIMIT = 5000;
export const OBSERVATION_LIMIT = 20000;
// 'book': the sportsbooks' no-vig chance, copied on purpose (the MCP's
// use_book_chances); like the others it is the owner's choice.
export const PROB_SOURCES = Object.freeze(['owner', 'history', 'model', 'book']);
const ENTRY_ID_RE = /^pe_[a-f0-9]{18}$/;
const round2 = (x) => Math.round(x * 100) / 100;

// Saved entries carry this tag, not the Discord id, so the record shows which
// owner saved an entry without storing who they are.
export function ownerTag(sub) {
  return createHash('sha256').update('sports-owner:' + String(sub || '')).digest('hex').slice(0, 12);
}

// A request the owner can fix. `expose` lets the route return the message.
function fail(status, message) { throw Object.assign(new Error(message), { status, expose: true }); }

// History hit counts for one line: how often the player cleared it. Context
// only, never a forecast: last 5 / last 10 / every stored game. `range` is
// the Wilson 95% range of the hit rate over the decided games (pushes left
// out): 7 of 10 reads as anywhere from about 40% to 89%.
export function hitHistory(rows, stat, side, threshold) {
  const played = rows.filter((r) => r.played && statValue(r, stat) != null).sort((a, b) => b.date.localeCompare(a.date));
  const count = (list) => {
    const res = list.map((r) => legResult(statValue(r, stat), side, threshold));
    const hits = res.filter((x) => x === 'win').length, pushes = res.filter((x) => x === 'push').length;
    return { hits, pushes, games: list.length, range: wilsonRange(hits, list.length - pushes) };
  };
  return { last5: count(played.slice(0, 5)), last10: count(played.slice(0, 10)), all: count(played) };
}

// A typed price for one pick (parlays): American, decimal or cents, stored
// as the decimal multiplier.
function cleanPrice(raw, at) {
  if (raw == null || raw === '') return null;
  const p = parsePrice(raw);
  if (!p) fail(400, at + 'the odds must look like −110, +150, 1.91 or 62¢');
  return p.decimal;
}

function cleanChance(raw, at) {
  let probability = null, probability_source = null;
  if (raw.probability != null && raw.probability !== '') {
    probability = Number(raw.probability);
    if (!(probability > 0 && probability < 1)) fail(400, at + 'the chance must be between 0% and 100%');
    probability = Math.round(probability * 10000) / 10000;
    probability_source = PROB_SOURCES.includes(raw.probability_source) ? raw.probability_source : 'owner';
  }
  return { probability, probability_source };
}

// A game bet (lib/sports/bets.mjs): who wins, the spread, win by X or more,
// the game total or a team total.
function cleanTeamPick(raw, at) {
  const sport = raw.sport, game_id = String(raw.game_id || '').toLowerCase();
  if (!SPORTS.includes(sport)) fail(400, at + 'sport must be nba or nfl');
  if (!validId(game_id)) fail(400, at + 'the game is required');
  const t = cleanTeamLeg(raw);
  if (t.error) fail(400, at + t.error);
  return { kind: 'team', sport, game_id, market: t.market, team: t.team, side: t.side, line: t.line, ...cleanChance(raw, at), price: cleanPrice(raw.price, at) };
}

function cleanLeg(raw, i) {
  const at = 'Pick ' + (i + 1) + ': ';
  if (!raw || typeof raw !== 'object') fail(400, at + 'must be an object');
  if (raw.kind === 'team') return cleanTeamPick(raw, at);
  if (raw.kind != null && raw.kind !== 'player') fail(400, at + 'kind must be player or team');
  const sport = raw.sport, stat = raw.stat, side = raw.side;
  const player_id = String(raw.player_id || '').toLowerCase(), game_id = String(raw.game_id || '').toLowerCase();
  const threshold = Number(raw.threshold);
  if (!SPORTS.includes(sport)) fail(400, at + 'sport must be nba or nfl');
  if (!validId(player_id) || !validId(game_id)) fail(400, at + 'player and game are required');
  if (!statIds(sport).includes(stat)) fail(400, at + 'that stat is not available');
  if (!SIDES.includes(side)) fail(400, at + 'choose over or under');
  if (!(raw.threshold !== '' && raw.threshold != null && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1000 && Math.round(threshold * 2) === threshold * 2)) fail(400, at + 'the line must be a whole or half number');
  return { kind: 'player', sport, player_id, game_id, stat, side, threshold, ...cleanChance(raw, at), price: cleanPrice(raw.price, at) };
}

// Two picks that cannot sit in one entry: the same pick twice, or two that
// can never both win (over 30.5 and under 25.5 points; LAL and BOS to win).
// Over / under the same number at different lines is a range and is allowed.
function clashOf(a, b) {
  if (a.sport !== b.sport || legKind(a) !== legKind(b)) return null;
  if (legKind(a) === 'player') {
    if (a.player_id !== b.player_id || a.stat !== b.stat) return null;
    if (a.side === b.side) return a.threshold === b.threshold ? 'The same pick is in the entry twice' : 'The same player and stat on the same side twice; keep one line';
    const over = a.side === 'over' ? a : b, under = a.side === 'over' ? b : a;
    return under.threshold <= over.threshold + 0.5 ? 'Over and under on the same player and stat cancel out' : null;
  }
  if (a.game_id !== b.game_id) return null;
  if (a.market === b.market && a.team === b.team && a.side === b.side && a.line === b.line) return 'The same pick is in the entry twice';
  if (a.market === 'moneyline' && b.market === 'moneyline') return 'Both teams to win cancel out';
  if (neverBothWin(a, b)) return teamLegLabel(a) + ' and ' + teamLegLabel(b) + ' can never both win';
  return null;
}

// The picks are always checked strictly. The payout part is strict only when
// saving: a draft without a payout yet still gets its history and warnings.
function cleanEntry(body, { strict }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Send the entry as JSON');
  const legs = Array.isArray(body.legs) ? body.legs.map(cleanLeg) : fail(400, 'legs must be a list');
  if (legs.length < MIN_LEGS || legs.length > MAX_LEGS) fail(400, 'An entry has 1 to 6 picks');
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { const c = clashOf(legs[i], legs[j]); if (c) fail(400, c); }
  const problems = [];
  const operator = OPERATORS.includes(body.operator) ? body.operator : (problems.push('Choose the app: PrizePicks, Betr, a sportsbook, Kalshi or other'), null);
  const format = FORMATS.includes(body.format) ? body.format : (problems.push('Choose power, flex or parlay'), 'power');
  const stake = Number(body.stake);
  if (!(stake > 0 && stake <= 100000)) problems.push('The paper stake must be more than $0 and at most $100,000');
  const payouts = {};
  if (body.payouts && typeof body.payouts === 'object' && !Array.isArray(body.payouts)) {
    for (const [k, v] of Object.entries(body.payouts)) if (v !== '' && v != null) payouts[k] = Number(v);
  }
  // A parlay: each pick's odds multiplied when every pick has them, else the
  // one price typed for the whole parlay (payouts[n], decimal).
  let prices = null;
  if (format === 'parlay') {
    if (legs.every((l) => l.price > 1)) {
      prices = legs.map((l) => l.price);
      for (const k of Object.keys(payouts)) delete payouts[k];
      payouts[legs.length] = Math.round(prices.reduce((a, b) => a * b, 1) * 10000) / 10000;
    } else if (payouts[legs.length] != null && !(payouts[legs.length] > 1)) problems.push('the parlay odds must pay more than the stake');
  } else legs.forEach((l) => { l.price = null; });
  problems.push(...payoutProblems(format, legs.length, payouts));
  if (strict && problems.length) fail(400, problems[0]);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  return { legs, operator, format, stake: stake > 0 ? round2(stake) : null, payouts, prices, note, problems };
}

// The model's read of one leg, kept small because saved entries carry it.
function legModel(model, leg, before, team, opponent, home, season, absence = null, env = null) {
  if (!opponent || !team) return { status: 'not_calculated', reason: 'team' };
  const history = before.slice().sort((a, b) => b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id));
  // Moved teams since the last stored game: the role there is not measured.
  if (history[0] && history[0].team !== team) return { status: 'not_calculated', reason: 'team_changed' };
  const fc = forecastStat({ sport: leg.sport, stat: leg.stat, history, home, opponent, group: positionGroup(leg.sport, history[0]?.position), model, side: leg.side, threshold: leg.threshold, season, absent: absence?.minutes || 0, env });
  if (fc.status !== 'ok') return { status: fc.status, reason: fc.reason || null };
  const { status, quality, regular_role, model_version, as_of_date, mean, low, high, expected_opportunity, unit, probability, push, sensitivity, games, tested, early_season, teammates_out, game_lines } = fc;
  return { status, quality, regular_role, model_version, as_of_date, mean, low, high, expected_opportunity, unit, probability, push, sensitivity, games, tested: tested || null, early_season: early_season || null,
    teammates_out: teammates_out ? { ...teammates_out, players: absence.players.map((p) => p.name) } : null,
    game_lines: game_lines ? { total: game_lines.total, team_total: game_lines.team_total, team_margin: game_lines.team_margin, applied: !!game_lines.applied } : null };
}

// Fill each leg from stored records: the game (teams, start), the player
// (name, team), history hit counts and the model's chance. A leg that cannot
// be matched is an error.
// `injuries`: { nba, nfl: { state, reports } } from the live ESPN feed, when
// the caller has it (the site and the MCP); each leg then shows the player's
// listing and NBA forecasts count regular teammates listed out. Without it
// the forecast assumes everyone usual plays.
// A team pick's own numbers before its game: this season's finals for the
// team (or both teams, for a game total) as values against the pick's line,
// newest first, and the hit counts in the player picks' shape.
function teamPickHistory(leg, game, allGames) {
  const finals = allGames.filter((g) => g.status === 'final' && Number.isInteger(g.home_score) && Number.isInteger(g.away_score) && g.season === game.season && g.local_date < game.local_date && g.game_id !== game.game_id)
    .sort((a, b) => b.start_utc.localeCompare(a.start_utc));
  const teams = leg.market === 'total' ? [game.home_team, game.away_team] : [leg.team];
  const rows = [];
  for (const g of finals) {
    const t = teams.find((x) => x === g.home_team || x === g.away_team);
    if (!t) continue;
    const home = g.home_team === t, opp = home ? g.away_team : g.home_team;
    const margin = home ? g.home_score - g.away_score : g.away_score - g.home_score;
    const value = leg.market === 'total' ? g.home_score + g.away_score : leg.market === 'team_total' ? (home ? g.home_score : g.away_score) : margin;
    rows.push({ date: g.local_date, opponent: opp, home, value, result: teamLegResult({ ...leg, team: t }, g) });
  }
  const count = (list) => {
    const hits = list.filter((r) => r.result === 'win').length, pushes = list.filter((r) => r.result === 'push').length;
    return { hits, pushes, games: list.length, range: wilsonRange(hits, list.length - pushes) };
  };
  // The line each value is read against, for the small chart.
  const chart = leg.market === 'moneyline' ? { side: 'over', threshold: 0 } : leg.market === 'spread' ? { side: 'over', threshold: -leg.line }
    : leg.market === 'win_by' ? { side: leg.side, threshold: leg.line - 0.5 } : { side: leg.side, threshold: leg.line };
  return { history: { last5: count(rows.slice(0, 5)), last10: count(rows.slice(0, 10)), all: count(rows) }, recent: rows.slice(0, 10).map(({ result, ...r }) => r), chart };
}

async function findGame(load, leg, nowMs) {
  const current = seasonFor(leg.sport, localDate(nowMs, 'America/New_York'));
  for (const s of [current, current - 1, current + 1]) {
    const rec = await load('games', { sport: leg.sport, season: s });
    const game = (rec?.games || []).find((g) => g.game_id === leg.game_id) || null;
    if (game) return { game, season: s, games: rec.games };
  }
  return { game: null, season: null, games: [] };
}

// A game bet: the stored game, the team game model's chance (win, push and
// lose, the books' no-vig chance where it is the market's own line) and the
// team's results this season against the same line.
async function enrichTeamLeg(load, leg, nowMs) {
  let { game, games } = await findGame(load, leg, nowMs);
  if (!game) fail(400, 'A pick refers to a game that is not stored');
  if (leg.market !== 'total' && leg.team !== game.home_team && leg.team !== game.away_team) fail(400, teamLegLabel(leg) + ': that team is not in this game');
  if (!game.lines && leg.sport === 'nba') {
    const lines = archivedGameLine(await load('lines', { sport: 'nba', date: game.local_date }).catch(() => null), game.game_id);
    if (lines) game = { ...game, lines };
  }
  const model = await load('team-model', { sport: leg.sport }).catch(() => null);
  let read;
  if (!model || model.status !== 'ok') read = { status: 'not_calculated', reason: 'no_model' };
  else if (game.status !== 'scheduled') read = { status: 'not_calculated', reason: 'started' };
  else {
    const fc = forecastGame(model, game, { rest: restDaysFor(games, game) });
    const r = fc ? priceTeamBet(fc, game, teamBetOf(leg)) : null;
    if (!r || r.error) read = { status: 'not_calculated', reason: fc ? 'bet' : 'team' };
    else {
      const check = teamModelSummary(model)?.markets?.[leg.market] || null;
      read = {
        status: 'ok', kind: 'team', model_version: model.version, fitted_utc: model.fitted_utc, mode: fc.mode, early: fc.early,
        // probability: the chance the pick WINS (a push is its own chance).
        probability: r.win, push: r.push, loss: r.lose, chance_no_push: r.chance, fair_american: r.fair_american,
        book_chance: r.book_chance ?? null, gap: r.gap ?? null,
        quality: check?.status === 'validated' ? 'validated' : 'experimental', check: check ? { status: check.status, n: check.n, ece: check.ece } : null,
        expected: fc.expected, market: fc.market, win: fc.win,
      };
    }
  }
  const pre = teamPickHistory(leg, game, games);
  const team = leg.team;
  return {
    ...leg, label: teamLegLabel(leg),
    team, opponent: team ? (team === game.home_team ? game.away_team : game.home_team) : null,
    game_start_utc: game.start_utc, game_status: game.status,
    matchup: game.away_team + '@' + game.home_team, home_team: game.home_team, away_team: game.away_team,
    team_in_game: true,
    history: pre.history, recent: pre.recent, chart: pre.chart,
    model: read,
    push: read.status === 'ok' ? read.push : 0,
    latent: latentOf(leg, game),
    ...(game.lines && Number.isFinite(game.lines.total) ? { game_lines: { total: game.lines.total, home_margin: game.lines.home_margin } } : {}),
  };
}

async function enrichLegs(load, legs, nowMs, injuries = null) {
  const out = [];
  for (const leg of legs) {
    if (legKind(leg) === 'team') { out.push(await enrichTeamLeg(load, leg, nowMs)); continue; }
    const current = seasonFor(leg.sport, localDate(nowMs, 'America/New_York'));
    let game = null, season = null;
    for (const s of [current, current - 1, current + 1]) {
      const rec = await load('games', { sport: leg.sport, season: s });
      game = (rec?.games || []).find((g) => g.game_id === leg.game_id) || null;
      if (game) { season = s; break; }
    }
    if (!game) fail(400, 'A pick refers to a game that is not stored');
    const playersRec = await load('players', { sport: leg.sport });
    const player = (playersRec?.players || []).find((p) => p.player_id === leg.player_id);
    if (!player) fail(400, 'A pick refers to a player that is not stored');
    const rows = [], all = [];
    const report = leg.sport === 'nba' && injuries?.nba?.state === 'ok' ? injuries.nba : null;
    for (const s of [season - 1, season]) {
      const rec = await load('player-games', { sport: leg.sport, season: s });
      if (report) { const every = unpackRows(rec); all.push(...every); rows.push(...every.filter((r) => r.player_id === leg.player_id)); }
      else rows.push(...unpackRows(rec, { playerId: leg.player_id }));
    }
    const before = rows.filter((r) => r.date < game.local_date);
    const last = before.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    // An upcoming game: the player's team now (NFL roster file, NBA latest
    // box score); a past game: the team of his last game before it.
    const team = (game.status === 'scheduled' ? currentTeam(player, last ? [last] : [], leg.sport) : null) || last?.team || player.team || null;
    // Spread and total: stored (NFL) or the props scan's archive (NBA).
    if (!game.lines && leg.sport === 'nba') {
      const lines = archivedGameLine(await load('lines', { sport: 'nba', date: game.local_date }).catch(() => null), game.game_id);
      if (lines) game = { ...game, lines };
    }
    const opponent = team === game.home_team ? game.away_team : team === game.away_team ? game.home_team : null;
    const model = await load('model', { sport: leg.sport }).catch(() => null);
    const absence = report && opponent ? teamAbsence({ sport: 'nba', team, date: game.local_date, reports: report.reports || [], players: playersRec?.players || [], rows: all, exclude: leg.player_id }) : null;
    const read = legModel(model, leg, before, team, opponent, team === game.home_team, season, absence, gameEnvironment(game, team));
    // "from model" only when the chance is the model's own number.
    const source = leg.probability_source === 'model' && !(read.status === 'ok' && Math.abs(read.probability - leg.probability) < 0.00005) ? 'owner' : leg.probability_source;
    out.push({
      ...leg,
      probability_source: source,
      player_name: player.name, team, opponent,
      game_start_utc: game.start_utc, game_status: game.status,
      matchup: game.away_team + '@' + game.home_team,
      team_in_game: opponent != null,
      history: hitHistory(before, leg.stat, leg.side, leg.threshold),
      // The last ten played values before this game, newest first, for the
      // Pick Builder's small chart. Not saved with the entry.
      recent: before.filter((r) => r.played && statValue(r, leg.stat) != null).sort((a, b) => b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id))
        .slice(0, 10).map((r) => ({ date: r.date, opponent: r.opponent, home: r.home, value: statValue(r, leg.stat) })),
      model: read,
      // The player's listing on the ESPN report the caller read (and, NFL,
      // the stored official report and roster status). Not saved.
      ...(injuries?.[leg.sport] ? { availability: availabilityFor(player, team, injuries[leg.sport], leg.sport,
        leg.sport === 'nfl' ? { record: await load('injuries', { sport: 'nfl' }).catch(() => null), week: game.week ?? null } : null) } : {}),
      ...(game.lines && gameEnvironment(game, team) ? { game_lines: gameEnvironment(game, team) } : {}),
      // The chance a whole-number line lands exactly (the model's), for
      // parlays, where a push drops the pick. Not saved.
      push: read.status === 'ok' && read.push > 0 ? read.push : 0,
    });
    out[out.length - 1].latent = latentOf(out[out.length - 1], game);
  }
  return out;
}

const breakevenOf = (format, payouts, n) => (format !== 'flex' && payouts[n] > 0 ? Math.round(1e6 / payouts[n]) / 1e6 : null);
const perPickOf = (entry, n) => (entry.problems.length ? null : perPickBreakeven(entry.format, entry.payouts, n));

// Every pick has a chance: price the whole entry (lib/sports/entry-price.mjs).
// Same-game picks use the measured links when every pair has one, else the
// entry is left unpriced with the reason and what holds under any link.
async function priceEntry(load, entry, legs, groups) {
  const joints = {}, asOf = {}, versions = {};
  for (const sport of new Set(groups.map((g) => legs[g.legs[0]].sport))) {
    const model = await load('model', { sport }).catch(() => null);
    joints[sport] = model?.joint || null;
    asOf[sport] = model?.as_of_date || null;
    versions[sport] = model?.model_version || null;
  }
  return evaluateOutcomes({ legs, groups, joints, asOf, versions, stake: entry.stake, format: entry.format, payouts: entry.payouts, prices: entry.prices });
}

// Each pick's fair odds at the chance used and, with a typed price, its edge
// (expected profit per $1 on that pick alone).
function legOdds(l) {
  const p = l.probability, d = l.price;
  const pushP = l.push || 0;
  return {
    fair: p != null ? fairOdds(p + pushP > 0 && pushP > 0 ? p / (1 - pushP) : p) : null,
    price: d > 1 ? { decimal: d, ...(fairOdds(1 / d) ? { american: fairOdds(1 / d).american, cents: fairOdds(1 / d).cents } : {}) } : null,
    edge: p != null && d > 1 ? Math.round((p * d + pushP - 1) * 10000) / 10000 : null,
  };
}

// Read-only: what the entry looks like and what it is worth. Same-game legs
// are priced only with measured links; a missing payout, chance or link is
// reported, never filled in.
export async function evaluateEntry({ load, body, now = Date.now(), strict = false, injuries = null }) {
  const entry = cleanEntry(body, { strict });
  const legs = await enrichLegs(load, entry.legs, now, injuries);
  const groups = sameGameGroups(legs);
  const n = legs.length;
  const breakeven = breakevenOf(entry.format, entry.payouts, n), perPick = perPickOf(entry, n);
  let evaluation;
  if (entry.problems.length) evaluation = { status: 'needs_payout', problems: entry.problems, breakeven_probability: breakeven, breakeven_per_pick: null };
  else if (legs.some((l) => l.probability == null)) evaluation = { status: 'needs_probabilities', method: null, breakeven_probability: breakeven, breakeven_per_pick: perPick };
  else evaluation = { ...(await priceEntry(load, entry, legs, groups)), breakeven_probability: breakeven, breakeven_per_pick: perPick };
  legs.forEach((l) => { l.odds = legOdds(l); });
  const started = legs.filter((l) => Date.parse(l.game_start_utc) <= now).map((l) => l.game_id);
  const { problems, ...rest } = entry;
  const warnings = legs.filter((l) => !l.team_in_game).map((l) => l.player_name + ' is not on either team in this game by the stored logs');
  return {
    ...rest, legs, same_game: groups, evaluation,
    locked: started.length > 0,
    warnings,
  };
}

function journalEvents(rec) { return Array.isArray(rec?.events) ? rec.events : []; }

async function appendUnderLease(store, name, key, field, items, limit) {
  if (store.backend !== 'r2' || typeof store.withLease !== 'function') fail(503, 'Saving needs the R2 store');
  let leased;
  try {
    leased = await store.withLease(name, async (guard) => {
      const rec = (await readSportsJson(store, key)) || { schema_version: SPORTS_SCHEMA_VERSION, [field]: [] };
      const list = Array.isArray(rec[field]) ? rec[field] : [];
      if (list.length + items.length > limit) fail(507, 'The Sports journal is full; archive older entries first');
      list.push(...items);
      guard();
      await writeSportsJson(store, key, { ...rec, schema_version: SPORTS_SCHEMA_VERSION, [field]: list, updated_utc: new Date().toISOString() });
    });
  } catch (err) {
    if (err?.code === 'LEASE_CONFLICT') fail(409, 'Another save is in progress; try again in a moment');
    if (err?.code === 'LEASE_UNSUPPORTED') fail(503, 'Saving needs the R2 store');
    throw err;
  }
  if (leased?.busy) fail(409, 'Another save is in progress; try again in a moment');
}

// Save a paper entry. Every game must still be ahead (a paper pick saved
// after kickoff is not a pre-game decision). Each leg is also recorded as a
// captured line for the line history.
export async function saveEntry({ store, load, body, now = Date.now(), sub, injuries = null }) {
  const ev = await evaluateEntry({ load, body, now, strict: true, injuries });
  if (ev.locked) fail(409, 'A game in this entry has started; paper picks are saved before the games');
  const nowIso = new Date(now).toISOString();
  const entry = {
    entry_id: 'pe_' + randomBytes(9).toString('hex'),
    created_utc: nowIso, by: ownerTag(sub),
    operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts, note: ev.note,
    ...(ev.prices ? { prices: ev.prices } : {}),
    legs: ev.legs.map(({ team_in_game, game_status, recent, availability, game_lines, latent, chart, ...l }) => l),
    same_game: ev.same_game, evaluation: ev.evaluation, payout_version: 1,
  };
  // Line history: player lines only (a game bet has no player series).
  const observations = ev.legs.filter((l) => legKind(l) === 'player').map((l) => ({
    market_series: marketSeriesKey({ operator: ev.operator, sport: l.sport, game_id: l.game_id, player_id: l.player_id, stat: l.stat }),
    operator: ev.operator, sport: l.sport, game_id: l.game_id, player_id: l.player_id, stat: l.stat, period: 'full_game',
    side: l.side, threshold: l.threshold, observed_at: nowIso, source: 'manual', entry_id: entry.entry_id,
  }));
  await appendUnderLease(store, 'sports-journal', sportsKey('journal'), 'events', [{ type: 'entry', at: nowIso, entry }], JOURNAL_LIMIT);
  // The entry is the record; a missed line capture is logged, not fatal.
  if (observations.length) await appendUnderLease(store, 'sports-observations', sportsKey('observations'), 'observations', observations, OBSERVATION_LIMIT)
    .catch((err) => console.error('[sports] line capture skipped:', err?.message || err));
  return entry;
}

// Whether any player row of this game is stored (packed or plain records).
function gameHasRows(rec, gameId) {
  if (!rec || !Array.isArray(rec.rows)) return false;
  const gi = Array.isArray(rec.columns) ? rec.columns.indexOf('game_id') : -1;
  return rec.rows.some((a) => (Array.isArray(a) ? a[gi] : a?.game_id) === gameId);
}

// Settle each leg from stored final stats. Once a game's NBA box score is
// stored, a missing row means the player did not dress (void); until then
// the leg stays open. NFL: since adapter 2 a player who took offensive
// snaps but recorded no stat has a stored all-zero row (from the snap
// counts), so such a leg settles; a missing NFL row stays open for the owner.
async function settleEntry(load, entry, now) {
  const legs = [];
  for (const leg of entry.legs) {
    const season = seasonFor(leg.sport, (leg.game_start_utc || '').slice(0, 10) || localDate(now, 'America/New_York'));
    const games = await load('games', { sport: leg.sport, season }).catch(() => null);
    const game = (games?.games || []).find((g) => g.game_id === leg.game_id);
    if (legKind(leg) === 'team') {
      // A game bet settles from the final score; a canceled or postponed game voids it.
      let result = null, actual = null;
      if (game?.status === 'final') {
        result = teamLegResult(leg, game);
        const margin = game.home_score - game.away_score;
        actual = leg.market === 'total' ? game.home_score + game.away_score : leg.market === 'team_total' ? (leg.team === game.home_team ? game.home_score : game.away_score) : (leg.team === game.home_team ? margin : -margin);
      } else if (game?.status === 'canceled' || game?.status === 'postponed') result = 'void';
      legs.push({ ...leg, actual, result, game_status: game?.status || 'unknown' });
      continue;
    }
    const pgRec = await load('player-games', { sport: leg.sport, season }).catch(() => null);
    const row = unpackRows(pgRec, { playerId: leg.player_id }).find((r) => r.game_id === leg.game_id);
    let result = null, actual = null;
    if (game?.status === 'final' || game?.status === 'canceled' || game?.status === 'postponed') {
      if (game.status !== 'final' || (row && row.played === false)) result = 'void';
      else if (row) { actual = statValue(row, leg.stat); result = legResult(actual, leg.side, leg.threshold); }
      else result = leg.sport === 'nba' && gameHasRows(pgRec, leg.game_id) ? 'void' : null;
    }
    legs.push({ ...leg, actual, result, game_status: game?.status || 'unknown' });
  }
  return { legs, settlement: settleFromLegs({ stake: entry.stake, format: entry.format, payouts: entry.payouts, prices: entry.prices || null, results: legs.map((l) => l.result) }) };
}

function applyRevisions(entry, computed, manual, withdrawn) {
  let settlement = computed;
  const m = manual.get(entry.entry_id);
  if (m) settlement = { state: 'settled', outcome: outcomeOf(m.gross, entry.stake), gross: m.gross, net: round2(m.gross - entry.stake), manual: true, note: m.note };
  if (withdrawn.has(entry.entry_id)) settlement = { state: 'withdrawn' };
  return settlement;
}

function revisionMaps(events) {
  const manual = new Map(), withdrawn = new Set();
  for (const e of events) {
    if (e.type === 'settle') manual.set(e.entry_id, e);
    if (e.type === 'withdraw') withdrawn.add(e.entry_id);
  }
  return { manual, withdrawn };
}

const allStarted = (entry, now) => entry.legs.every((l) => Date.parse(l.game_start_utc) <= now);
const anyStarted = (entry, now) => entry.legs.some((l) => Date.parse(l.game_start_utc) <= now);

// What the owner may still change. Withdraw is for an entry saved by mistake,
// before any game starts. A typed-in payout is for pushes, voids and missing
// stats once every game has started; it never overrides an entry the final
// stats already settled.
function allowedActions(entry, settlement, now, me) {
  if (entry.by !== me || settlement.state === 'withdrawn') return [];
  const out = [];
  if (!anyStarted(entry, now)) out.push('withdraw');
  if (allStarted(entry, now) && (settlement.state === 'pending' || settlement.state === 'review' || settlement.manual)) out.push('settle');
  return out;
}

// Owner records what the app paid (for pushes and voids) or withdraws an entry.
export async function reviseEntry({ store, load, body, now = Date.now(), sub }) {
  const id = String(body?.entry_id || '');
  if (!ENTRY_ID_RE.test(id)) fail(400, 'entry_id is required');
  const events = journalEvents(await load('journal'));
  const saved = events.find((e) => e.type === 'entry' && e.entry?.entry_id === id)?.entry;
  if (!saved) fail(404, 'No saved entry with that id');
  const me = ownerTag(sub);
  if (saved.by !== me) fail(403, 'Only the owner who saved this entry can change it');
  const { manual, withdrawn } = revisionMaps(events);
  const { settlement: computed } = await settleEntry(load, saved, now);
  const allowed = allowedActions(saved, applyRevisions(saved, computed, manual, withdrawn), now, me);
  const at = new Date(now).toISOString();
  let event;
  if (body.action === 'settle') {
    if (!allowed.includes('settle')) fail(409, withdrawn.has(id) ? 'This entry was withdrawn' : !allStarted(saved, now) ? 'Enter the payout after every game has started' : 'The final stats already settled this entry');
    const gross = Number(body.gross);
    if (!(body.gross !== '' && body.gross != null && gross >= 0 && gross <= 1e7)) fail(400, 'Enter the total the app paid back, from $0');
    event = { type: 'settle', at, by: me, entry_id: id, gross: round2(gross), note: typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '' };
  } else if (body.action === 'withdraw') {
    if (!allowed.includes('withdraw')) fail(409, withdrawn.has(id) ? 'This entry was already withdrawn' : 'A game has started; the entry stays in the record');
    event = { type: 'withdraw', at, by: me, entry_id: id };
  } else fail(400, 'action must be settle or withdraw');
  await appendUnderLease(store, 'sports-journal', sportsKey('journal'), 'events', [event], JOURNAL_LIMIT);
  return event;
}

const decided = (p, push) => (typeof p === 'number' && push > 0 && push < 1 ? Math.min(0.9999, p / (1 - push)) : p);
export function chanceCheck(legs, chanceOf) {
  const pairs = legs.map((l) => [chanceOf(l), l.result === 'win' ? 1 : 0]).filter(([p]) => typeof p === 'number' && p > 0 && p < 1);
  if (!pairs.length) return { picks: 0, mean_chance: null, hit_rate: null, brier: null };
  const avg = (f) => Math.round((pairs.reduce((a, x) => a + f(x), 0) / pairs.length) * 10000) / 10000;
  return { picks: pairs.length, mean_chance: avg(([p]) => p), hit_rate: avg(([, y]) => y), brier: avg(([p, y]) => (p - y) ** 2) };
}

// Every saved entry, newest first, with its legs settled from stored final
// stats. A typed-in payout overrides the computed result; the latest one wins.
export async function journalView({ load, now = Date.now(), sub }) {
  const events = journalEvents(await load('journal'));
  const me = ownerTag(sub);
  const { manual, withdrawn } = revisionMaps(events);
  const entries = events.filter((e) => e.type === 'entry' && e.entry).map((e) => e.entry);
  const out = [];
  for (const entry of entries.slice().reverse()) {
    const { legs, settlement: computed } = await settleEntry(load, entry, now);
    const settlement = applyRevisions(entry, computed, manual, withdrawn);
    out.push({ ...entry, legs, settlement, mine: entry.by === me, actions: allowedActions(entry, settlement, now, me) });
  }
  const live = out.filter((e) => e.settlement.state !== 'withdrawn');
  const settled = live.filter((e) => e.settlement.state === 'settled');
  const staked = settled.reduce((a, e) => a + e.stake, 0), returned = settled.reduce((a, e) => a + e.settlement.gross, 0);
  const expected = settled.filter((e) => typeof e.evaluation?.expected_net === 'number');
  const graded = live.flatMap((e) => e.legs).filter((l) => l.result === 'win' || l.result === 'loss');
  return {
    entries: out,
    summary: {
      entries: live.length,
      settled: settled.length,
      pending: live.filter((e) => e.settlement.state === 'pending').length,
      review: live.filter((e) => e.settlement.state === 'review').length,
      wins: settled.filter((e) => e.settlement.outcome === 'win').length,
      staked: round2(staked),
      returned: round2(returned),
      net: round2(returned - staked),
      roi: staked ? Math.round(((returned - staked) / staked) * 10000) / 10000 : null,
      priced_settled: expected.length,
      expected_net_settled: expected.length ? round2(expected.reduce((a, e) => a + e.evaluation.expected_net, 0)) : null,
    },
    // How the chances held up on settled picks (pushes and voids left out):
    // the model's chance where one was shown, and the chance actually used.
    // A pick's chance counts a push as not winning; with pushes left out of
    // the results, it is read as the chance of winning when it does not push.
    calibration: {
      model: chanceCheck(graded, (l) => (l.model?.status === 'ok' ? decided(l.model.probability, l.model.push) : null)),
      used: chanceCheck(graded, (l) => decided(l.probability, l.push)),
    },
  };
}

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
import { forecastStat, positionGroup } from './models.mjs';
import { FORMATS, MIN_LEGS, MAX_LEGS, payoutProblems, evaluatePayout, sameGameGroups, legResult, settleFromLegs, outcomeOf, perPickBreakeven, wilsonRange } from './payout.mjs';
import { jointEvaluation } from './joint.mjs';

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

function cleanLeg(raw, i) {
  const at = 'Pick ' + (i + 1) + ': ';
  if (!raw || typeof raw !== 'object') fail(400, at + 'must be an object');
  const sport = raw.sport, stat = raw.stat, side = raw.side;
  const player_id = String(raw.player_id || '').toLowerCase(), game_id = String(raw.game_id || '').toLowerCase();
  const threshold = Number(raw.threshold);
  if (!SPORTS.includes(sport)) fail(400, at + 'sport must be nba or nfl');
  if (!validId(player_id) || !validId(game_id)) fail(400, at + 'player and game are required');
  if (!statIds(sport).includes(stat)) fail(400, at + 'that stat is not available');
  if (!SIDES.includes(side)) fail(400, at + 'choose over or under');
  if (!(raw.threshold !== '' && raw.threshold != null && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1000 && Math.round(threshold * 2) === threshold * 2)) fail(400, at + 'the line must be a whole or half number');
  let probability = null, probability_source = null;
  if (raw.probability != null && raw.probability !== '') {
    probability = Number(raw.probability);
    if (!(probability > 0 && probability < 1)) fail(400, at + 'the chance must be between 0% and 100%');
    probability = Math.round(probability * 10000) / 10000;
    probability_source = PROB_SOURCES.includes(raw.probability_source) ? raw.probability_source : 'owner';
  }
  return { sport, player_id, game_id, stat, side, threshold, probability, probability_source };
}

// The picks are always checked strictly. The payout part is strict only when
// saving: a draft without a payout yet still gets its history and warnings.
function cleanEntry(body, { strict }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Send the entry as JSON');
  const legs = Array.isArray(body.legs) ? body.legs.map(cleanLeg) : fail(400, 'legs must be a list');
  if (legs.length < MIN_LEGS || legs.length > MAX_LEGS) fail(400, 'An entry has 1 to 6 picks');
  const seen = new Map();
  for (const l of legs) {
    const k = l.sport + ':' + l.player_id + ':' + l.stat;
    if (seen.has(k)) fail(400, seen.get(k) === l.side ? 'The same pick is in the entry twice' : 'Over and under on the same player and stat cancel out');
    seen.set(k, l.side);
  }
  const problems = [];
  const operator = OPERATORS.includes(body.operator) ? body.operator : (problems.push('Choose PrizePicks, Betr or other'), null);
  const format = FORMATS.includes(body.format) ? body.format : (problems.push('Choose power or flex'), 'power');
  const stake = Number(body.stake);
  if (!(stake > 0 && stake <= 100000)) problems.push('The paper stake must be more than $0 and at most $100,000');
  const payouts = {};
  if (body.payouts && typeof body.payouts === 'object' && !Array.isArray(body.payouts)) {
    for (const [k, v] of Object.entries(body.payouts)) if (v !== '' && v != null) payouts[k] = Number(v);
  }
  problems.push(...payoutProblems(format, legs.length, payouts));
  if (strict && problems.length) fail(400, problems[0]);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  return { legs, operator, format, stake: stake > 0 ? round2(stake) : null, payouts, note, problems };
}

// The model's read of one leg, kept small because saved entries carry it.
function legModel(model, leg, before, team, opponent, home, season) {
  if (!opponent || !team) return { status: 'not_calculated', reason: 'team' };
  const history = before.slice().sort((a, b) => b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id));
  const fc = forecastStat({ sport: leg.sport, stat: leg.stat, history, home, opponent, group: positionGroup(leg.sport, history[0]?.position), model, side: leg.side, threshold: leg.threshold, season });
  if (fc.status !== 'ok') return { status: fc.status, reason: fc.reason || null };
  const { status, quality, regular_role, model_version, as_of_date, mean, low, high, expected_opportunity, unit, probability, push, sensitivity, games, tested, early_season } = fc;
  return { status, quality, regular_role, model_version, as_of_date, mean, low, high, expected_opportunity, unit, probability, push, sensitivity, games, tested: tested || null, early_season: early_season || null };
}

// Fill each leg from stored records: the game (teams, start), the player
// (name, team), history hit counts and the model's chance. A leg that cannot
// be matched is an error.
async function enrichLegs(load, legs, nowMs) {
  const out = [];
  for (const leg of legs) {
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
    const rows = [];
    for (const s of [season - 1, season]) rows.push(...unpackRows(await load('player-games', { sport: leg.sport, season: s }), { playerId: leg.player_id }));
    const before = rows.filter((r) => r.date < game.local_date);
    const last = before.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const team = last?.team || player.team || null;
    const opponent = team === game.home_team ? game.away_team : team === game.away_team ? game.home_team : null;
    const model = await load('model', { sport: leg.sport }).catch(() => null);
    const read = legModel(model, leg, before, team, opponent, team === game.home_team, season);
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
    });
  }
  return out;
}

const breakevenOf = (format, payouts, n) => (format === 'power' && payouts[n] > 0 ? Math.round(1e6 / payouts[n]) / 1e6 : null);
const perPickOf = (entry, n) => (entry.problems.length ? null : perPickBreakeven(entry.format, entry.payouts, n));

// Same-game picks: priced with the measured links (lib/sports/joint.mjs)
// when every pair has one, else left unpriced with the reason.
async function sameGamePrice(load, entry, legs, groups) {
  const joints = {}, asOf = {}, versions = {};
  for (const sport of new Set(groups.map((g) => legs[g.legs[0]].sport))) {
    const model = await load('model', { sport }).catch(() => null);
    joints[sport] = model?.joint || null;
    asOf[sport] = model?.as_of_date || null;
    versions[sport] = model?.model_version || null;
  }
  return jointEvaluation({ legs, groups, joints, asOf, versions, stake: entry.stake, format: entry.format, payouts: entry.payouts });
}

// Read-only: what the entry looks like and what it is worth. Same-game legs
// are priced only with measured links; a missing payout, chance or link is
// reported, never filled in.
export async function evaluateEntry({ load, body, now = Date.now(), strict = false }) {
  const entry = cleanEntry(body, { strict });
  const legs = await enrichLegs(load, entry.legs, now);
  const groups = sameGameGroups(legs);
  const n = legs.length;
  const breakeven = breakevenOf(entry.format, entry.payouts, n), perPick = perPickOf(entry, n);
  let evaluation;
  if (entry.problems.length) evaluation = { status: 'needs_payout', problems: entry.problems, breakeven_probability: breakeven, breakeven_per_pick: null };
  else if (groups.length && legs.some((l) => l.probability == null)) evaluation = { status: 'needs_probabilities', method: null, breakeven_probability: breakeven, breakeven_per_pick: perPick };
  else if (groups.length) evaluation = { ...(await sameGamePrice(load, entry, legs, groups)), breakeven_probability: breakeven, breakeven_per_pick: perPick };
  else evaluation = evaluatePayout({ stake: entry.stake, format: entry.format, payouts: entry.payouts, probabilities: legs.map((l) => l.probability) });
  const started = legs.filter((l) => Date.parse(l.game_start_utc) <= now).map((l) => l.game_id);
  const { problems, ...rest } = entry;
  return {
    ...rest, legs, same_game: groups, evaluation,
    locked: started.length > 0,
    warnings: legs.filter((l) => !l.team_in_game).map((l) => l.player_name + ' is not on either team in this game by the stored logs'),
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
export async function saveEntry({ store, load, body, now = Date.now(), sub }) {
  const ev = await evaluateEntry({ load, body, now, strict: true });
  if (ev.locked) fail(409, 'A game in this entry has started; paper picks are saved before the games');
  const nowIso = new Date(now).toISOString();
  const entry = {
    entry_id: 'pe_' + randomBytes(9).toString('hex'),
    created_utc: nowIso, by: ownerTag(sub),
    operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts, note: ev.note,
    legs: ev.legs.map(({ team_in_game, game_status, recent, ...l }) => l),
    same_game: ev.same_game, evaluation: ev.evaluation, payout_version: 1,
  };
  const observations = ev.legs.map((l) => ({
    market_series: marketSeriesKey({ operator: ev.operator, sport: l.sport, game_id: l.game_id, player_id: l.player_id, stat: l.stat }),
    operator: ev.operator, sport: l.sport, game_id: l.game_id, player_id: l.player_id, stat: l.stat, period: 'full_game',
    side: l.side, threshold: l.threshold, observed_at: nowIso, source: 'manual', entry_id: entry.entry_id,
  }));
  await appendUnderLease(store, 'sports-journal', sportsKey('journal'), 'events', [{ type: 'entry', at: nowIso, entry }], JOURNAL_LIMIT);
  // The entry is the record; a missed line capture is logged, not fatal.
  await appendUnderLease(store, 'sports-observations', sportsKey('observations'), 'observations', observations, OBSERVATION_LIMIT)
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
// the leg stays open. NFL files leave out players with no stat, so a
// missing NFL row stays open for the owner.
async function settleEntry(load, entry, now) {
  const legs = [];
  for (const leg of entry.legs) {
    const season = seasonFor(leg.sport, (leg.game_start_utc || '').slice(0, 10) || localDate(now, 'America/New_York'));
    const games = await load('games', { sport: leg.sport, season }).catch(() => null);
    const game = (games?.games || []).find((g) => g.game_id === leg.game_id);
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
  return { legs, settlement: settleFromLegs({ stake: entry.stake, format: entry.format, payouts: entry.payouts, results: legs.map((l) => l.result) }) };
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
    calibration: {
      model: chanceCheck(graded, (l) => (l.model?.status === 'ok' ? l.model.probability : null)),
      used: chanceCheck(graded, (l) => l.probability),
    },
  };
}

// Private, bounded pregame evidence. First decision + last 15 snapshots;
// the first explicit paper entry pins its original snapshot too. Raw financial
// data publication, sync-data and the public reader cannot reach this prefix.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { NBA_ALPHA_VERSION, nbaMarketForProp, nbaPairEstimate, checkNBAPayout, quoteFresh } from './nba-market.mjs';
import { lineMatchesGame } from './props.mjs';
import { unpackRows } from './rows.mjs';
import { statValue } from './schema.mjs';

const MAX_RAW = 16 * 1024 * 1024, MAX_GZIP = 2 * 1024 * 1024, MAX_EXPORT = 4 * 1024 * 1024;
const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const round = (n) => Number.isFinite(n) ? Math.round(n * 1000000) / 1000000 : null;
export function encodeNBAResearch(value, { input = false } = {}) {
  const raw = Buffer.from(JSON.stringify(value)), zipped = gzipSync(raw);
  if (raw.length > (input ? 64 * 1024 * 1024 : MAX_RAW) || zipped.length > (input ? 4 * 1024 * 1024 : MAX_GZIP)) fail(413, 'NBA research record exceeds its size limit. Existing records remain intact.');
  return { encoding: 'gzip-base64', sha256: hash(raw), raw_bytes: raw.length, payload: zipped.toString('base64') };
}
export function decodeNBAResearch(record, { input = false } = {}) {
  if (!record || record.encoding !== 'gzip-base64' || typeof record.payload !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Invalid NBA research envelope');
  const raw = gunzipSync(Buffer.from(record.payload, 'base64'), { maxOutputLength: input ? 64 * 1024 * 1024 : MAX_RAW });
  if (raw.length !== record.raw_bytes || hash(raw) !== record.sha256) throw new Error('NBA research digest mismatch');
  return JSON.parse(raw.toString('utf8'));
}
function compactPick(p) {
  return { player_id: p.player_id, player_name: p.player_name, team: p.team, opponent: p.opponent, stat: p.stat, side: p.side, threshold: p.threshold,
    market: { state: p.market.state, method: p.market.method, probability: p.market.probability, low: p.market.low, high: p.market.high, book_count: p.market.book_count },
    model_probability: p.model?.probability ?? null };
}
function matchRaw(events, game) { return (events || []).filter((e) => lineMatchesGame({ start_utc: e.commence_time, home_team: e.home_team, away_team: e.away_team }, game, 'nba')); }
function inputRefs(caseData) { return [...new Set(caseData.points.map((p) => p.input_hash))]; }
async function readCase(store, season, gameId) {
  const record = await readSportsJson(store, sportsKey('nba-research-game', { sport: 'nba', season, gameId }));
  return record ? decodeNBAResearch(record) : null;
}
function trimCase(data) {
  const pinned = new Set([data.paper?.snapshot_id, ...data.issued.map((p) => p.snapshot_id)]);
  while (data.points.length > 16) {
    const remove = data.points.findIndex((p, i) => i > 0 && i < data.points.length - 1 && !pinned.has(p.snapshot_id));
    if (remove < 0) break;
    data.points.splice(remove, 1); data.dropped_intermediate++;
  }
  for (;;) {
    try { if (data.index_head) { data.index_head.retained = data.points.length; data.index_head.input_hashes = inputRefs(data); } return encodeNBAResearch(data); }
    catch (err) {
      if (err.status !== 413) throw err;
      const remove = data.points.findIndex((p, i) => i > 0 && i < data.points.length - 1 && !pinned.has(p.snapshot_id));
      if (remove < 0) throw err;
      data.points.splice(remove, 1); data.dropped_intermediate++;
    }
  }
}

export async function captureNBAResearch({ store, view, now = Date.now(), clock = () => now }) {
  if (view.sport !== 'nba') return null;
  if (store.backend !== 'r2' || typeof store.withLease !== 'function' || !view.research_input) return { state: 'unavailable', message: 'Complete NBA research could not be recorded.' };
  let added = 0;
  try {
    const input = encodeNBAResearch(view.research_input, { input: true }), digest = input.sha256;
    const inputKey = sportsKey('nba-research-input', { sport: 'nba', digest });
    const existing = await readSportsJson(store, inputKey);
    if (!existing) await writeSportsJson(store, inputKey, input);
    else if (decodeNBAResearch(existing, { input: true }) && existing.sha256 !== digest) throw new Error('Wrong input at content address');
    const seasons = [...new Set([...(view.research_input.status?.seasons || []), ...view.games.map((g) => g.season)])].filter(Number.isInteger);
    for (const season of seasons) {
      const lease = await store.withLease('sports-nba-research-' + season, async (guard) => {
        const indexKey = sportsKey('nba-research-index', { sport: 'nba', season });
        const priorIndex = await readSportsJson(store, indexKey);
        if (priorIndex && (priorIndex.version !== NBA_ALPHA_VERSION || !priorIndex.games || typeof priorIndex.games !== 'object')) throw new Error('Invalid NBA research index');
        const index = priorIndex || { version: NBA_ALPHA_VERSION, season, games: {} }; let changed = false;
        for (const g of view.games.filter((g) => g.season === season)) {
          const captured = clock(), knownStart = Math.min(Date.parse(g.start_utc), ...g.picks.map((p) => Date.parse(p.start_utc)));
          if (!(knownStart > captured) || Date.parse(g.expires_utc || view.expires_utc) <= captured) continue;
          const sources = view.research_sources, game = g.research?.game || g;
          const first = await readCase(store, season, g.game_id);
          const point = { version: NBA_ALPHA_VERSION, game, evaluated_utc: view.generated_utc, captured_utc: new Date(captured).toISOString(),
            expires_utc: g.expires_utc || view.expires_utc, input_hash: digest, sources: { ...view.sources },
            prizepicks: matchRaw(sources.lines.raw_events, game), sportsbook: matchRaw(sources.reference?.raw_events, game),
            offered_lines: sources.lines.lines.filter((l) => lineMatchesGame(l, game, 'nba')),
            quotes: (sources.reference?.quotes || []).filter((q) => lineMatchesGame(q, game, 'nba')),
            injuries: sources.injuries, decisions: g.research?.decisions || [], candidates: g.research?.candidates || [],
            picks: g.picks, pair: g.pair, matchup: g.research?.matchup || null };
          const fingerprint = hash(JSON.stringify({ ...point, captured_utc: null, evaluated_utc: null, expires_utc: null }));
          const last = first?.points.at(-1);
          if (last?.fingerprint === fingerprint && captured - Date.parse(last.captured_utc) < 120000 && Date.parse(last.expires_utc) > captured + 30000 && Date.parse(last.expires_utc) >= Date.parse(point.expires_utc)) {
            g.research_snapshot_id = last.snapshot_id; g.research_expires_utc = last.expires_utc;
            g.paper_pair_saved = Boolean(first.paper);
            g.paper_pair_payout = first.paper?.payout_multiplier ?? null;
            g.expires_utc = new Date(Math.min(Date.parse(g.expires_utc || view.expires_utc), Date.parse(last.expires_utc))).toISOString();
            // Repair an index write interrupted after the game object was saved.
            if (index.games[g.game_id]?.latest_snapshot_id === last.snapshot_id) continue;
          } else {
            point.fingerprint = fingerprint; point.snapshot_id = hash(JSON.stringify(point));
          }
          const data = first || { version: NBA_ALPHA_VERSION, season, game_id: g.game_id, start_utc: g.start_utc, points: [], issued: [], paper: null, dropped_intermediate: 0 };
          if (point.snapshot_id) data.points.push(point);
          const active = data.points.at(-1);
          // Independent prospective NBA cohort: the first issued players stay
          // fixed even when a game already had a legacy prop-record pair.
          for (const p of active.picks) if (data.issued.length < 2 && !data.issued.some((x) => x.player_id === p.player_id || x.team === p.team))
            data.issued.push({ ...p, issued_utc: active.captured_utc, snapshot_id: active.snapshot_id });
          const head = { game_id: g.game_id, start_utc: g.start_utc, latest_snapshot_id: active.snapshot_id, latest_capture_utc: active.captured_utc,
            captures: (index.games[g.game_id]?.captures || 0) + (point.snapshot_id ? 1 : 0), retained: data.points.length, input_hashes: inputRefs(data),
            issued: data.issued.map(compactPick), paper: data.paper ? { ...data.paper, picks: data.paper.picks.map(compactPick) } : null };
          const oldHead = index.games[g.game_id];
          if (oldHead?.closing) head.closing = oldHead.closing;
          if (oldHead?.voided_status) { head.voided_status = oldHead.voided_status; head.voided_utc = oldHead.voided_utc; }
          if (['canceled', 'postponed'].includes(game.status)) { head.voided_status = game.status; head.voided_utc ||= new Date(clock()).toISOString(); }
          // Price the ORIGINAL issued thresholds using only this pregame
          // snapshot. A pulled PP selection need not still be offered.
          const closing = data.issued.map((p) => ({ player_id: p.player_id, stat: p.stat, side: p.side, threshold: p.threshold,
            market: nbaMarketForProp(p, active.quotes, Date.parse(active.captured_utc), { historicalThreshold: true }) }));
          if (closing.length === 2 && closing.every((p) => p.market.state === 'supported')) head.closing = { captured_utc: active.captured_utc,
            lead_seconds: (Date.parse(g.start_utc) - Date.parse(active.captured_utc)) / 1000,
            picks: closing.map((p) => ({ ...p, market: { method: p.market.method, probability: p.market.probability, low: p.market.low, high: p.market.high, book_count: p.market.book_count } })) };
          data.index_head = head;
          const envelope = trimCase(data);
          if (!(knownStart > clock()) || Date.parse(g.expires_utc || view.expires_utc) <= clock()) continue;
          guard(); await writeSportsJson(store, sportsKey('nba-research-game', { sport: 'nba', season, gameId: g.game_id }), envelope);
          index.games[g.game_id] = head; changed = true; added += point.snapshot_id ? 1 : 0;
          g.research_snapshot_id = active.snapshot_id; g.research_expires_utc = active.expires_utc;
          g.paper_pair_saved = Boolean(data.paper);
          g.paper_pair_payout = data.paper?.payout_multiplier ?? null;
        }
        // Repair a game-object write whose subsequent index write failed,
        // including the first capture of a game that has since started.
        const recentlyStarted = view.research_input.records.flatMap((r) => r.games?.games || []).filter((g) => g.season === season && Date.parse(g.start_utc) <= clock() && clock() - Date.parse(g.start_utc) < 86400000);
        for (const g of recentlyStarted) {
          if (index.games[g.game_id]?.closed_utc) continue;
          const data = await readCase(store, season, g.game_id);
          if (data?.index_head) { index.games[g.game_id] = { ...data.index_head, closed_utc: new Date(clock()).toISOString() }; changed = true; }
        }
        const schedule = new Map(view.research_input.records.flatMap((r) => r.games?.games || []).map((g) => [g.game_id, g]));
        for (const g of Object.values(index.games)) {
          const status = schedule.get(g.game_id)?.status;
          if (!g.voided_status && ['canceled', 'postponed'].includes(status)) { g.voided_status = status; g.voided_utc = new Date(clock()).toISOString(); changed = true; }
          if (!g.closed_utc && Date.parse(g.start_utc) <= clock()) { g.closed_utc = new Date(clock()).toISOString(); changed = true; }
        }
        if (changed) { guard(); await writeSportsJson(store, indexKey, index); }
      });
      if (lease?.busy) return { state: 'busy', added, message: 'NBA evidence recording is busy; refresh before evaluating a pair.' };
    }
    return { state: 'ok', added, policy: 'First decision and last 15 complete pregame snapshots, bounded by bytes; first saved paper entry is pinned.' };
  } catch { return { state: 'unavailable', added, message: 'Complete NBA evidence could not be saved. Refresh before evaluating or saving a paper pair.' }; }
}

export async function nbaPairAction({ store, body, now = Date.now(), clock = () => now }) {
  const { season, game_id: gameId, snapshot_id: snapshotId, payout_multiplier: payout, save } = body;
  if (!Number.isInteger(season) || season < 1946 || season > 2100 || typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,95}$/.test(gameId) || typeof snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotId) || typeof save !== 'boolean') fail(400, 'Invalid NBA pair request');
  const evaluate = async (guard) => {
    const data = await readCase(store, season, gameId); if (!data) fail(404, 'No NBA evidence for this game yet');
    const point = data.points.find((p) => p.snapshot_id === snapshotId);
    const current = clock();
    if (!point || Date.parse(point.expires_utc) <= current || !(Date.parse(point.game.start_utc) > current)) fail(409, 'This board expired or changed. Refresh lines before evaluating the pair.');
    const schedule = await readSportsJson(store, sportsKey('games', { sport: 'nba', season })), game = schedule?.games?.find((g) => g.game_id === gameId);
    if (!game || game.status !== 'scheduled' || game.time_tbd || !(Date.parse(game.start_utc) > clock()) || Math.abs(Date.parse(game.start_utc) - Date.parse(point.game.start_utc)) > 600000) fail(409, 'The game status or start time changed. Refresh the board.');
    // Recheck every source at use time, including book-published timestamps.
    const picks = point.picks.map((p) => ({ ...p, market: nbaMarketForProp(p, point.quotes, current) }));
    if (picks.some((p) => !quoteFresh(p.observed_utc, current) || !(Date.parse(p.start_utc) > current))) fail(409, 'The PrizePicks selections expired. Refresh before evaluating or saving.');
    const input = await readSportsJson(store, sportsKey('nba-research-input', { sport: 'nba', digest: point.input_hash }));
    const bundle = decodeNBAResearch(input, { input: true });
    const screen = checkNBAPayout(nbaPairEstimate(picks, bundle.model, current), payout);
    if (!save) return { screen, saved: false };
    if (picks.length !== 2) fail(400, 'A complete opposing-team pair is required to save a paper entry');
    if (data.paper) {
      if (data.paper.snapshot_id !== snapshotId || data.paper.payout_multiplier !== payout) fail(409, 'This game already has a frozen paper pair. Its original picks and payout stay unchanged.');
      const indexKey = sportsKey('nba-research-index', { sport: 'nba', season }), index = await readSportsJson(store, indexKey);
      if (index?.games?.[gameId] && !index.games[gameId].paper) { index.games[gameId].paper = { ...data.paper, picks: data.paper.picks.map(compactPick) }; guard(); await writeSportsJson(store, indexKey, index); }
      return { screen: data.paper.screen, saved: true, entry: data.paper };
    }
    data.paper = { snapshot_id: snapshotId, issued_utc: new Date(current).toISOString(), payout_multiplier: payout, payout_source: 'owner_entered', picks, screen };
    const indexKey = sportsKey('nba-research-index', { sport: 'nba', season }), index = await readSportsJson(store, indexKey);
    if (!index?.games?.[gameId]) fail(409, 'The research index is not ready; refresh before saving.');
    data.index_head.paper = { ...data.paper, picks: picks.map(compactPick) };
    const envelope = trimCase(data);
    if (!(Math.min(Date.parse(point.game.start_utc), Date.parse(game.start_utc)) > clock()) || Date.parse(point.expires_utc) <= clock()) fail(409, 'The pair expired before it could be saved.');
    guard(); await writeSportsJson(store, sportsKey('nba-research-game', { sport: 'nba', season, gameId }), envelope);
    index.games[gameId].paper = { ...data.paper, picks: picks.map(compactPick) };
    guard(); await writeSportsJson(store, indexKey, index);
    return { screen, saved: true, entry: data.paper };
  };
  if (!save) return evaluate(() => {});
  if (store.backend !== 'r2' || !store.withLease) fail(503, 'Private paper recording is unavailable');
  let result;
  const lease = await store.withLease('sports-nba-research-' + season, async (guard) => { result = await evaluate(guard); });
  if (lease?.busy) fail(409, 'NBA evidence is being recorded. Try again shortly.');
  return result;
}

export async function exportNBAResearch({ store, season, gameId, webLimit = true }) {
  const data = await readCase(store, season, gameId); if (!data) fail(404, 'No NBA research for this game');
  const inputs = {};
  for (const digest of inputRefs(data)) inputs[digest] = decodeNBAResearch(await readSportsJson(store, sportsKey('nba-research-input', { sport: 'nba', digest })), { input: true });
  const body = gzipSync(Buffer.from(JSON.stringify({ format: 'nba-research-export-1', research: data, inputs })));
  if (webLimit && body.length > MAX_EXPORT) fail(413, 'This complete research bundle exceeds the web download limit. Use the private research CLI; no fields were discarded.');
  return body;
}

function grade(p, index) {
  const row = index.get(p.player_id), actual = row?.played ? statValue(row, p.stat) : null;
  return row?.played === false ? 'void' : actual == null ? 'pending' : actual === p.threshold ? 'push' : (p.side === 'over' ? actual > p.threshold : actual < p.threshold) ? 'win' : 'loss';
}
export async function nbaResearchSummary({ load, seasons, now = Date.now() }) {
  let captures = 0, games = 0, wins = 0, losses = 0, pushes = 0, voids = 0, pending = 0, pairs = 0, both = 0, brier = 0, calibrated = 0;
  const clv = [], paper = { saved: 0, resolved: 0, wins: 0, units_returned: 0, excluded_push_void: 0, pending: 0 }, bins = new Map(), recent = [], screenGroups = {};
  for (const season of seasons) {
    const [ix, box, schedule] = await Promise.all([load('nba-research-index', { sport: 'nba', season }), load('player-games', { sport: 'nba', season }), load('games', { sport: 'nba', season })]);
    const rows = unpackRows(box), byGame = new Map(), statuses = new Map((schedule?.games || []).map((g) => [g.game_id, g.status]));
    for (const r of rows) { const m = byGame.get(r.game_id) || new Map(); m.set(r.player_id, r); byGame.set(r.game_id, m); }
    for (const head of Object.values(ix?.games || {})) {
      games++; captures += head.captures;
      const recentEntry = { game_id: head.game_id, season, start_utc: head.start_utc }; recent.push(recentEntry);
      const final = statuses.get(head.game_id) === 'final', canceled = Boolean(head.voided_status) || ['canceled', 'postponed'].includes(statuses.get(head.game_id)), stats = byGame.get(head.game_id) || new Map();
      const grades = (head.issued || []).map((p) => canceled ? 'void' : final ? grade(p, stats, stats.size > 0) : 'pending');
      grades.forEach((s) => { if (s === 'win') wins++; else if (s === 'loss') losses++; else if (s === 'push') pushes++; else if (s === 'void') voids++; else pending++; });
      if (grades.length === 2 && grades.every((s) => ['win', 'loss'].includes(s))) { pairs++; if (grades.every((s) => s === 'win')) both++; }
      (head.issued || []).forEach((p, i) => {
        if (['win', 'loss'].includes(grades[i]) && p.market.state === 'supported' && p.market.method === 'exact' && Number.isFinite(p.market.probability)) {
          const predicted = p.market.probability, y = grades[i] === 'win' ? 1 : 0; brier += (predicted - y) ** 2; calibrated++;
          const key = Math.min(9, Math.floor(predicted * 10)), b = bins.get(key) || { n: 0, predicted: 0, wins: 0 }; b.n++; b.predicted += predicted; b.wins += y; bins.set(key, b);
        }
        const close = head.closing?.picks.find((q) => q.player_id === p.player_id && q.stat === p.stat && q.side === p.side && q.threshold === p.threshold);
        if (!canceled && Date.parse(head.start_utc) <= now && head.closing?.lead_seconds >= 0 && head.closing.lead_seconds <= 600 && close && p.market.state === 'supported' && p.market.method === 'exact' && close.market.method === 'exact' && p.market.probability != null && close.market.probability != null) clv.push(close.market.probability - p.market.probability);
      });
      if (head.paper) {
        paper.saved++;
        const group = screenGroups[head.paper.screen.state] || (screenGroups[head.paper.screen.state] = { saved: 0, resolved: 0, wins: 0, returned: 0 }); group.saved++;
        const results = head.paper.picks.map((p) => canceled ? 'void' : final ? grade(p, stats, stats.size > 0) : 'pending');
        recentEntry.paper = { payout: head.paper.payout_multiplier, players: head.paper.picks.map((p) => p.player_name), result: results.some((s) => ['push', 'void'].includes(s)) ? 'excluded' : results.every((s) => s === 'win') ? 'win' : results.every((s) => ['win', 'loss'].includes(s)) ? 'loss' : 'pending' };
        if (results.some((s) => ['push', 'void'].includes(s))) paper.excluded_push_void++;
        else if (results.length === 2 && results.every((s) => ['win', 'loss'].includes(s))) { paper.resolved++; group.resolved++; if (results.every((s) => s === 'win')) { paper.wins++; group.wins++; group.returned += head.paper.payout_multiplier; paper.units_returned += head.paper.payout_multiplier; } }
        else paper.pending++;
      }
    }
  }
  return { version: NBA_ALPHA_VERSION, games, captures, wins, losses, pushes, voids, pending, hit_rate: round(wins / (wins + losses)), resolved_pairs: pairs, both_win: both,
    both_win_rate: round(both / pairs), calibration: { n: calibrated, brier: round(brier / calibrated), bins: [...bins].sort((a, b) => a[0] - b[0]).map(([key, b]) => ({ bin: key * 10, n: b.n, predicted: round(b.predicted / b.n), observed: round(b.wins / b.n), status: b.n >= 30 ? 'descriptive' : 'insufficient_sample' })) },
    closing_value: { n: clv.length, average_probability_change: round(clv.reduce((a, b) => a + b, 0) / clv.length), positive: clv.filter((v) => v > 0).length, note: 'Original threshold, last supported pregame capture within ten minutes of kickoff; indicative CLV, not proof of profit.' },
    paper: { ...paper, units_returned: round(paper.units_returned), net_units: round(paper.units_returned - paper.resolved), roi: round((paper.units_returned - paper.resolved) / paper.resolved) },
    paper_by_screen: Object.fromEntries(Object.entries(screenGroups).map(([k, s]) => [k, { ...s, net_units: round(s.returned - s.resolved), roi: round((s.returned - s.resolved) / s.resolved) }])),
    recent_games: recent.sort((a, b) => b.start_utc.localeCompare(a.start_utc)).slice(0, 30),
    note: 'New prospective NBA cohort. First issued props and first explicit paper pair remain fixed. Payouts are owner-entered. Push/void paper pairs are excluded from ROI; no operator-specific settlement is invented.' };
}

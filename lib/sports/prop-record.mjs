// The first issued pair per game is the benchmark. Live shortlist changes
// never replace a saved line, score or thesis. Only pregame snapshots count.
import { createHash } from 'node:crypto';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { seasonFor, localDate } from './time.mjs';
import { unpackRows } from './rows.mjs';
import { statValue } from './schema.mjs';
import { fresh, LINE_MAX_AGE_MS } from './prop-sources.mjs';
import { NBA_QUOTE_AGE_MS } from './nba-market.mjs';
import { foldName } from './read.mjs';

const POLICY = 'first_pair_per_game';
const MAX_PICKS = 5000; // one NBA season is about 3,000 incl. playoffs
export const PROP_RECORD_PAGE_LIMIT = 250;
export const PROP_RECORD_PAGE_BYTES = 1024 * 1024;
// Closing line value (2026-11-08): every pregame scan also notes the current
// PrizePicks line for each saved, not-yet-started pick; the last one seen
// before the start is the closing line. The saved line never changes. A
// closing line seen more than this long before the start (the scans stopped
// early) is kept but left out of the closing-line statistics.
export const CLOSING_LEAD_MAX_SECONDS = 4 * 3600;
function fail(status, message) { throw Object.assign(new Error(message), { status, expose: true }); }
// The current line for a saved pick: same event, stat and player (provider id
// when both sides have one, else the folded name); same side preferred, the
// other side otherwise (PrizePicks posts one main line for both).
export function closingLineFor(pick, lines) {
  if (!pick || !Array.isArray(lines)) return null;
  const name = foldName(pick.player_name || '');
  const same = (l) => l && l.event_id === pick.event_id && l.stat === pick.stat && typeof l.threshold === 'number' && Number.isFinite(l.threshold) &&
    (pick.provider_player_id && l.provider_player_id ? l.provider_player_id === pick.provider_player_id : foldName(l.player_name || '') === name);
  const hits = lines.filter(same);
  if (!hits.length) return null;
  return hits.find((l) => l.side === pick.side) || hits[0];
}
// How the line moved for the pick, from its saved closing line: points in
// the pick's favor (an over wants the closing line above the saved line, an
// under below) and whether the pick beat the close.
export function closingValue(pick) {
  const c = pick?.closing;
  if (!c || typeof c.threshold !== 'number' || typeof pick.threshold !== 'number') return null;
  const points = (Math.round(((pick.side === 'over' ? 1 : -1) * (c.threshold - pick.threshold)) * 2) / 2) || 0;
  const lead = Number.isFinite(c.lead_seconds) ? c.lead_seconds : null;
  return { line: c.threshold, points, beat: points > 0 ? true : points < 0 ? false : null, observed_utc: c.observed_utc, lead_seconds: lead, stale: lead == null || lead > CLOSING_LEAD_MAX_SECONDS };
}
function noteClosing(saved, lines, nowMs) {
  let changed = 0;
  for (const p of saved) {
    const kickoff = Date.parse(p.game_start_utc);
    if (!(kickoff > nowMs)) continue;
    const line = closingLineFor(p, lines);
    if (!line || !(Date.parse(line.observed_utc) <= nowMs + 60000)) continue;
    const lead = Math.round((kickoff - Date.parse(line.observed_utc)) / 1000);
    if (!(lead >= 0)) continue;
    const prev = p.closing;
    if (prev && prev.threshold === line.threshold && prev.observed_utc === line.observed_utc) continue;
    if (prev && Date.parse(prev.observed_utc) > Date.parse(line.observed_utc)) continue;
    p.closing = { threshold: line.threshold, side: line.side, observed_utc: line.observed_utc, recorded_utc: new Date(nowMs).toISOString(), lead_seconds: lead };
    changed++;
  }
  return changed;
}
export async function capturePropPicks({ store, view, lines = null, now = Date.now(), clock = () => now }) {
  if (store.backend !== 'r2' || typeof store.withLease !== 'function') return { state: 'unavailable', message: 'The prop record needs the private R2 store.' };
  const groups = new Map();
  const nbaAlpha = view.sport === 'nba' && String(view.rank_version || '').startsWith('nba-market-');
  const lineAge = nbaAlpha ? NBA_QUOTE_AGE_MS : LINE_MAX_AGE_MS;
  const currentLines = Array.isArray(lines) ? lines.filter((l) => l && fresh(l.observed_utc, now, lineAge)) : null;
  for (const game of view.games || []) {
    if (!(Date.parse(game.start_utc) > now)) continue;
    const season = game.season ?? seasonFor(view.sport, localDate(Date.parse(game.start_utc), 'America/New_York'));
    const list = groups.get(season) || [];
    for (const p of game.picks || []) if (typeof p.team === 'string' && [game.home_team, game.away_team].includes(p.team) && fresh(p.observed_utc, now, lineAge)) list.push({ ...p, season, game_start_utc: game.start_utc });
    // A season with no new pick still gets its closing lines noted.
    if (list.length || (currentLines && currentLines.length)) groups.set(season, list);
  }
  let added = 0, closings = 0;
  try {
    for (const [season, incoming] of groups) {
      const key = sportsKey('prop-record', { sport: view.sport, season });
      const leased = await store.withLease('sports-props-' + view.sport + '-' + season, async (guard) => {
        // A corrupt existing record is an error, never an invitation to reset it.
        const prior = await readSportsJson(store, key);
        if (prior && (!Array.isArray(prior.picks) || prior.policy !== POLICY)) throw new Error('invalid prop record');
        if (!prior && !incoming.length) return;
        const picks = (prior?.picks || []).map((p) => ({ ...p }));
        const byGame = new Map();
        for (const p of picks) { const list = byGame.get(p.game_id) || []; list.push(p); byGame.set(p.game_id, list); }
        let count = 0;
        for (const p of incoming) {
          const issuedNow = clock();
          const kickoff = Math.min(Date.parse(p.game_start_utc), Date.parse(p.start_utc || p.game_start_utc));
          if (!(kickoff > issuedNow) || !fresh(p.observed_utc, issuedNow, lineAge) || nbaAlpha && !(Date.parse(view.expires_utc) > issuedNow)) continue;
          const saved = byGame.get(p.game_id) || [];
          if (saved.length >= 2 || saved.some((s) => s.player_id === p.player_id || s.team === p.team)) continue;
          if (picks.length >= MAX_PICKS) throw new Error('prop record full');
          const id = createHash('sha256').update([view.sport, p.game_id, p.player_id, p.stat, p.side, p.threshold].join('|')).digest('hex').slice(0, 24);
          const pick = { ...p, prop_id: id, slot: saved.length + 1, issued_utc: new Date(issuedNow).toISOString(), rank_version: view.rank_version,
            injury_report_utc: view.sources.injuries.observed_utc, line_provider: view.sources.lines.provider,
            availability: (view.games.find((g) => g.game_id === p.game_id)?.availability || []).map(({ name, team, status, report_utc }) => ({ name, team, status, report_utc })) };
          picks.push(pick); saved.push(pick); byGame.set(p.game_id, saved); count++;
        }
        const noted = currentLines ? noteClosing(picks, currentLines, clock()) : 0;
        if (count || noted) { guard(); await writeSportsJson(store, key, { schema_version: 1, sport: view.sport, season, policy: POLICY, updated_utc: new Date(now).toISOString(), picks }); }
        added += count; closings += noted;
      });
      if (leased?.busy) return { state: 'busy', message: 'Another scan is recording picks; refresh in a moment.', added, closings };
    }
    return { state: 'ok', policy: POLICY, added, closings };
  } catch { return { state: 'unavailable', added, closings, message: 'The prop record could not be saved. These live rankings are not confirmed recorded.' }; }
}

function summary(picks) {
  const count = (s) => picks.filter((p) => p.result === s).length;
  const wins = count('win'), losses = count('loss'), graded = wins + losses;
  const modeled = picks.filter((p) => ['win', 'loss'].includes(p.result) && typeof p.model?.probability === 'number');
  return { picks: picks.length, wins, losses, pushes: count('push'), voids: count('void'), pending: picks.filter((p) => ['pending', 'awaiting_stats'].includes(p.result)).length,
    win_rate: graded ? wins / graded : null,
    model_check: { samples: modeled.length, brier: modeled.length ? modeled.reduce((a, p) => a + (p.model.probability - (p.result === 'win' ? 1 : 0)) ** 2, 0) / modeled.length : null },
    closing_line: closingSummary(picks) };
}
// Closing line value over a list: how often the saved line beat the last
// pregame line, the average move in the pick's favor, a half-point histogram,
// and the win rate when the line moved for us against when it moved against.
function closingSummary(picks) {
  const rows = picks.filter((p) => p.clv && !p.clv.stale);
  const beat = rows.filter((p) => p.clv.beat === true).length, worse = rows.filter((p) => p.clv.beat === false).length;
  const hist = {};
  for (const p of rows) { const b = Math.max(-3, Math.min(3, p.clv.points)); const k = (b > 0 ? '+' : '') + b.toFixed(1); hist[k] = (hist[k] || 0) + 1; }
  const rate = (list) => { const w = list.filter((p) => p.result === 'win').length, l = list.filter((p) => p.result === 'loss').length; return w + l ? { n: w + l, win_rate: w / (w + l) } : { n: 0, win_rate: null }; };
  const leads = rows.map((p) => p.clv.lead_seconds).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return { n: rows.length, too_early: picks.filter((p) => p.clv && p.clv.stale).length, beat, worse, unchanged: rows.length - beat - worse, beat_rate: beat + worse ? beat / (beat + worse) : null,
    average_points: rows.length ? Math.round(rows.reduce((a, p) => a + p.clv.points, 0) / rows.length * 100) / 100 : null,
    median_lead_seconds: leads.length ? leads[Math.floor(leads.length / 2)] : null,
    histogram: hist, when_beat: rate(rows.filter((p) => p.clv.beat === true)), when_worse: rate(rows.filter((p) => p.clv.beat === false)), when_unchanged: rate(rows.filter((p) => p.clv.beat === null)),
    note: 'The closing line is the last PrizePicks line a pregame scan saw for the same player and stat (scans run every 30 minutes, more often for NBA). Points are in the pick\u2019s favor: an over wants the line to move up after the pick, an under down. A closing line seen more than four hours before the start is kept on the pick but left out of these counts. A moving line is evidence the pick was early, not proof of profit.' };
}

export async function propRecordView({ load, sport, seasons, now = Date.now(), all = false, offset = 0, limit = all ? PROP_RECORD_PAGE_LIMIT : 100, asOf, snapshot }) {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_PICKS * seasons.length || !Number.isInteger(limit) || limit < 1 || limit > PROP_RECORD_PAGE_LIMIT) fail(400, 'Invalid prop record page');
  const asOfMs = asOf == null ? now : Date.parse(asOf);
  if (!Number.isFinite(asOfMs) || asOfMs > now + 60000) fail(400, 'Invalid prop record snapshot time');
  const records = await Promise.all(seasons.map(async (season) => {
    const [record, schedule, box] = await Promise.all([load('prop-record', { sport, season }), load('games', { sport, season }), load('player-games', { sport, season })]);
    const games = new Map((schedule?.games || []).map((g) => [g.game_id, g]));
    const rows = unpackRows(box), index = new Map(rows.map((r) => [r.game_id + '|' + r.player_id, r]));
    const hasRows = new Set(rows.map((r) => r.game_id));
    return (record?.picks || []).map((p) => {
      const game = games.get(p.game_id), row = index.get(p.game_id + '|' + p.player_id);
      let result = 'pending', actual = null;
      if (['canceled', 'postponed'].includes(game?.status)) result = 'void';
      else if (game?.status === 'final') {
        if (row?.played === false) result = 'void';
        else if (row?.played && (actual = statValue(row, p.stat)) != null) result = actual === p.threshold ? 'push' : (p.side === 'over' ? actual > p.threshold : actual < p.threshold) ? 'win' : 'loss';
        else result = sport === 'nba' && !String(p.rank_version || '').startsWith('nba-market-') && !row && hasRows.has(p.game_id) ? 'void' : 'awaiting_stats';
      }
      return { ...p, actual, result, game_status: game?.status || 'unknown', clv: closingValue(p) };
    });
  }));
  const picks = records.flat().filter((p) => Date.parse(p.issued_utc) <= asOfMs).sort((a, b) =>
    b.issued_utc.localeCompare(a.issued_utc) || a.game_id.localeCompare(b.game_id) || a.slot - b.slot || String(a.prop_id).localeCompare(String(b.prop_id)));
  // A late pregame write or a box-score correction between pages must not
  // silently splice different datasets into the downloaded research file.
  const version = createHash('sha256').update(JSON.stringify(picks.map((p) => [p.prop_id, p.issued_utc, p.stat, p.side, p.threshold, p.rank_score, p.rank_version, p.result, p.actual, p.game_status, p.model?.probability, p.closing?.threshold ?? null]))).digest('hex').slice(0, 24);
  if (snapshot != null && snapshot !== version) fail(409, 'The prop record changed while downloading. Please retry the download.');
  const page = []; let pageBytes = 0;
  for (const p of picks.slice(offset, offset + limit)) {
    const bytes = Buffer.byteLength(JSON.stringify(p)) + 1;
    if (bytes > PROP_RECORD_PAGE_BYTES) fail(413, 'A saved prop exceeds the research download size limit');
    if (pageBytes + bytes > PROP_RECORD_PAGE_BYTES) break;
    page.push(p); pageBytes += bytes;
  }
  const splitBy = (key) => Object.fromEntries([...new Set(picks.map(key))].sort().map((value) => [value, summary(picks.filter((p) => key(p) === value))]));
  return { sport, generated_utc: new Date(now).toISOString(), as_of: new Date(asOfMs).toISOString(), snapshot: version,
    offset, page_size: page.length, next_offset: offset + page.length < picks.length ? offset + page.length : null,
    policy: POLICY, seasons, summary: summary(picks),
    by_stat: splitBy((p) => p.stat), by_basis: splitBy((p) => p.basis), by_rank: splitBy((p) => String(Math.floor(p.rank_score / 10) * 10) + '–' + String(Math.floor(p.rank_score / 10) * 10 + 9)),
    by_line_move: splitBy((p) => !p.clv || p.clv.stale ? 'no closing line' : p.clv.beat === true ? 'moved for us' : p.clv.beat === false ? 'moved against' : 'unchanged'),
    total: picks.length, records: page,
    note: 'First issued picks before each game; original lines and analysis stay fixed. From props-rank-3, pairs require one player from each team; earlier versions retain their original selections. Wins/losses use final stored stats. Win rate excludes pushes, voids and pending stats. Operator-specific reboot and payout rules are not modeled.' };
}

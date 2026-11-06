// The first issued pair per game is the benchmark. Live shortlist changes
// never replace a saved line, score or thesis. Only pregame snapshots count.
import { createHash } from 'node:crypto';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { seasonFor, localDate } from './time.mjs';
import { unpackRows } from './rows.mjs';
import { statValue } from './schema.mjs';
import { fresh, LINE_MAX_AGE_MS } from './prop-sources.mjs';

const POLICY = 'first_pair_per_game';
const MAX_PICKS = 5000; // one NBA season is about 3,000 incl. playoffs
export const PROP_RECORD_PAGE_LIMIT = 250;
export const PROP_RECORD_PAGE_BYTES = 1024 * 1024;
function fail(status, message) { throw Object.assign(new Error(message), { status, expose: true }); }
export async function capturePropPicks({ store, view, now = Date.now(), clock = () => now }) {
  if (store.backend !== 'r2' || typeof store.withLease !== 'function') return { state: 'unavailable', message: 'The prop record needs the private R2 store.' };
  const groups = new Map();
  for (const game of view.games || []) {
    if (!(Date.parse(game.start_utc) > now)) continue;
    const season = game.season ?? seasonFor(view.sport, localDate(Date.parse(game.start_utc), 'America/New_York'));
    const list = groups.get(season) || [];
    for (const p of game.picks || []) if (typeof p.team === 'string' && [game.home_team, game.away_team].includes(p.team) && fresh(p.observed_utc, now, LINE_MAX_AGE_MS)) list.push({ ...p, season, game_start_utc: game.start_utc });
    if (list.length) groups.set(season, list);
  }
  let added = 0;
  try {
    for (const [season, incoming] of groups) {
      const key = sportsKey('prop-record', { sport: view.sport, season });
      const leased = await store.withLease('sports-props-' + view.sport + '-' + season, async (guard) => {
        // A corrupt existing record is an error, never an invitation to reset it.
        const prior = await readSportsJson(store, key);
        if (prior && (!Array.isArray(prior.picks) || prior.policy !== POLICY)) throw new Error('invalid prop record');
        const picks = (prior?.picks || []).slice();
        const byGame = new Map();
        for (const p of picks) { const list = byGame.get(p.game_id) || []; list.push(p); byGame.set(p.game_id, list); }
        let count = 0;
        for (const p of incoming) {
          const issuedNow = clock();
          const kickoff = Math.min(Date.parse(p.game_start_utc), Date.parse(p.start_utc || p.game_start_utc));
          if (!(kickoff > issuedNow) || !fresh(p.observed_utc, issuedNow, LINE_MAX_AGE_MS)) continue;
          const saved = byGame.get(p.game_id) || [];
          if (saved.length >= 2 || saved.some((s) => s.player_id === p.player_id || s.team === p.team)) continue;
          if (picks.length >= MAX_PICKS) throw new Error('prop record full');
          const id = createHash('sha256').update([view.sport, p.game_id, p.player_id, p.stat, p.side, p.threshold].join('|')).digest('hex').slice(0, 24);
          const pick = { ...p, prop_id: id, slot: saved.length + 1, issued_utc: new Date(issuedNow).toISOString(), rank_version: view.rank_version,
            injury_report_utc: view.sources.injuries.observed_utc, line_provider: view.sources.lines.provider,
            availability: (view.games.find((g) => g.game_id === p.game_id)?.availability || []).map(({ name, team, status, report_utc }) => ({ name, team, status, report_utc })) };
          picks.push(pick); saved.push(pick); byGame.set(p.game_id, saved); count++;
        }
        if (count) { guard(); await writeSportsJson(store, key, { schema_version: 1, sport: view.sport, season, policy: POLICY, updated_utc: new Date(now).toISOString(), picks }); }
        added += count;
      });
      if (leased?.busy) return { state: 'busy', message: 'Another scan is recording picks; refresh in a moment.', added };
    }
    return { state: 'ok', policy: POLICY, added };
  } catch { return { state: 'unavailable', added, message: 'The prop record could not be saved. These live rankings are not confirmed recorded.' }; }
}

function summary(picks) {
  const count = (s) => picks.filter((p) => p.result === s).length;
  const wins = count('win'), losses = count('loss'), graded = wins + losses;
  const modeled = picks.filter((p) => ['win', 'loss'].includes(p.result) && typeof p.model?.probability === 'number');
  return { picks: picks.length, wins, losses, pushes: count('push'), voids: count('void'), pending: picks.filter((p) => ['pending', 'awaiting_stats'].includes(p.result)).length,
    win_rate: graded ? wins / graded : null,
    model_check: { samples: modeled.length, brier: modeled.length ? modeled.reduce((a, p) => a + (p.model.probability - (p.result === 'win' ? 1 : 0)) ** 2, 0) / modeled.length : null } };
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
        else result = sport === 'nba' && !row && hasRows.has(p.game_id) ? 'void' : 'awaiting_stats';
      }
      return { ...p, actual, result, game_status: game?.status || 'unknown' };
    });
  }));
  const picks = records.flat().filter((p) => Date.parse(p.issued_utc) <= asOfMs).sort((a, b) =>
    b.issued_utc.localeCompare(a.issued_utc) || a.game_id.localeCompare(b.game_id) || a.slot - b.slot || String(a.prop_id).localeCompare(String(b.prop_id)));
  // A late pregame write or a box-score correction between pages must not
  // silently splice different datasets into the downloaded research file.
  const version = createHash('sha256').update(JSON.stringify(picks.map((p) => [p.prop_id, p.issued_utc, p.stat, p.side, p.threshold, p.rank_score, p.rank_version, p.result, p.actual, p.game_status, p.model?.probability]))).digest('hex').slice(0, 24);
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
    total: picks.length, records: page,
    note: 'First issued picks before each game; original lines and analysis stay fixed. From props-rank-3, pairs require one player from each team; earlier versions retain their original selections. Wins/losses use final stored stats. Win rate excludes pushes, voids and pending stats. Operator-specific reboot and payout rules are not modeled.' };
}

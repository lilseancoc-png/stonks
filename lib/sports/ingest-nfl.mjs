// NFL ingestion: nflverse release files → Sports records in the private
// store. Run daily by .github/workflows/sports-data.yml through
// scripts/sports-ingest.mjs. Keeps the current and previous season. A
// finished season is fetched once and then left alone. A bad upstream file
// never replaces good stored data: the run records the failure in the status
// record and keeps what was there.
import { parseCsv } from './csv.mjs';
import { NFLVERSE_URLS, NFL_ADAPTER_VERSION, normalizeNflGames, normalizeNflPlayerGames, normalizeNflPlayers } from './nflverse.mjs';
import { SPORTS_SCHEMA_VERSION } from './schema.mjs';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { seasonFor, localDate } from './time.mjs';

const SHRINK_GUARD = 0.8; // a refreshed season may not lose more than 20% of its stored rows

export async function ingestNfl({ store, fetchText, now = Date.now(), log = () => {}, dryRun = false }) {
  const nowIso = new Date(now).toISOString();
  const statusKey = sportsKey('status', { sport: 'nfl' });
  const prior = await readSportsJson(store, statusKey).catch(() => null);
  const current = seasonFor('nfl', localDate(now, 'America/New_York'));
  const seasons = [current - 1, current];
  const notes = [];
  const writes = [];
  try {
    const gamesCsv = await fetchText(NFLVERSE_URLS.games);
    if (!gamesCsv) throw new Error('nflverse schedule file is unavailable');
    const { games, rejected: badGames } = normalizeNflGames(parseCsv(gamesCsv), { seasons });
    if (badGames.length) notes.push(badGames.length + ' schedule rows failed validation and were skipped');
    const counts = { games: 0, player_games: 0, players: 0 };
    const rowsBySeason = new Map();
    for (const season of seasons) {
      const seasonGames = games.filter((g) => g.season === season);
      const complete = seasonGames.length > 0 && seasonGames.every((g) => g.status === 'final' || g.status === 'canceled');
      const storedGames = await readSportsJson(store, sportsKey('games', { sport: 'nfl', season })).catch(() => null);
      const storedRows = await readSportsJson(store, sportsKey('player-games', { sport: 'nfl', season })).catch(() => null);
      const fresh = season === current || !storedRows || !storedGames || storedRows.adapter_version !== NFL_ADAPTER_VERSION || storedRows.complete !== true;
      if (!fresh) {
        log(`nfl ${season}: finished season already stored, kept as is`);
        rowsBySeason.set(season, storedRows.rows || []);
        counts.games += (storedGames.games || []).length;
        counts.player_games += (storedRows.rows || []).length;
        continue;
      }
      if (!seasonGames.length) {
        if (season === current) { notes.push(`no ${season} schedule published yet`); rowsBySeason.set(season, []); continue; }
        throw new Error(`nflverse schedule has no ${season} games`);
      }
      const weeklyCsv = await fetchText(NFLVERSE_URLS.weekly(season));
      let rows = [];
      if (weeklyCsv == null) {
        if (season !== current) throw new Error(`nflverse player stats for ${season} are unavailable`);
        notes.push(`no ${season} player stats published yet`);
      } else {
        const out = normalizeNflPlayerGames(parseCsv(weeklyCsv), new Map(seasonGames.map((g) => [g.game_id, g])));
        // A row for a game that is not final yet (a file read mid-game, or a
        // schedule that has not caught up) would show a partial stat line in
        // logs and averages. It waits for the next run.
        const finals = new Set(seasonGames.filter((g) => g.status === 'final').map((g) => g.game_id));
        rows = out.rows.filter((r) => finals.has(r.game_id));
        if (rows.length < out.rows.length) log(`nfl ${season}: ${out.rows.length - rows.length} player games held back until their game is final`);
        if (out.rejected.length) notes.push(`${season}: ${out.rejected.length} player rows failed validation and were skipped`);
      }
      const before = Array.isArray(storedRows?.rows) ? storedRows.rows.length : 0;
      if (before > 50 && rows.length < before * SHRINK_GUARD) {
        throw new Error(`${season} player stats shrank from ${before} to ${rows.length} rows; kept the stored copy`);
      }
      const envelope = { schema_version: SPORTS_SCHEMA_VERSION, sport: 'nfl', season, source: 'nflverse', adapter_version: NFL_ADAPTER_VERSION, generated_utc: nowIso, complete };
      writes.push([sportsKey('games', { sport: 'nfl', season }), { ...envelope, games: seasonGames }]);
      writes.push([sportsKey('player-games', { sport: 'nfl', season }), { ...envelope, rows }]);
      rowsBySeason.set(season, rows);
      counts.games += seasonGames.length;
      counts.player_games += rows.length;
      log(`nfl ${season}: ${seasonGames.length} games, ${rows.length} player games${complete ? ' (season finished)' : ''}`);
    }
    const playersCsv = await fetchText(NFLVERSE_URLS.players);
    if (!playersCsv) throw new Error('nflverse players file is unavailable');
    const keepIds = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    const players = normalizeNflPlayers(parseCsv(playersCsv), { keepIds, season: current });
    const known = new Set(players.map((p) => p.player_id));
    const unmatched = [...keepIds].filter((id) => !known.has(id)).length;
    if (unmatched) notes.push(`${unmatched} players in the game logs are missing from the players file`);
    counts.players = players.length;
    writes.push([sportsKey('players', { sport: 'nfl' }), { schema_version: SPORTS_SCHEMA_VERSION, sport: 'nfl', source: 'nflverse', adapter_version: NFL_ADAPTER_VERSION, generated_utc: nowIso, players }]);
    const status = {
      schema_version: SPORTS_SCHEMA_VERSION, sport: 'nfl', source: 'nflverse', adapter_version: NFL_ADAPTER_VERSION,
      state: notes.some((n) => /failed validation|missing from/.test(n)) ? 'degraded' : 'ok',
      last_success_utc: nowIso, last_attempt_utc: nowIso,
      seasons: seasons.filter((s) => rowsBySeason.has(s)),
      counts, message: notes.length ? notes.join('; ') : null,
    };
    // Data first, status last: a reader never sees a status for files that
    // were not written.
    if (!dryRun) {
      for (const [key, value] of writes) await writeSportsJson(store, key, value);
      await writeSportsJson(store, statusKey, status);
    }
    log(`nfl status: ${status.state}; ${counts.games} games, ${counts.player_games} player games, ${counts.players} players${dryRun ? ' (dry run, nothing written)' : ''}`);
    return { status, writes: writes.map(([key, value]) => ({ key, bytes: Buffer.byteLength(JSON.stringify(value)) })) };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 300);
    const failed = {
      schema_version: SPORTS_SCHEMA_VERSION, sport: 'nfl', source: 'nflverse', adapter_version: NFL_ADAPTER_VERSION,
      state: 'failed', last_success_utc: prior?.last_success_utc || null, last_attempt_utc: nowIso,
      seasons: Array.isArray(prior?.seasons) ? prior.seasons : [], counts: prior?.counts || null, message,
    };
    if (!dryRun) await writeSportsJson(store, statusKey, failed).catch(() => {});
    throw Object.assign(new Error(message), { status: failed });
  }
}

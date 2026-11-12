// League ingestion: provider files → Sports records in the private store.
// Run daily by .github/workflows/sports-data.yml through
// scripts/sports-ingest.mjs, once per league. Each league keeps its current
// and previous season. A finished season is fetched once and then left
// alone. A bad upstream file never replaces good stored data: the run records
// the failure in the status record and keeps what was there.
//
// An adapter (lib/sports/nflverse.mjs, lib/sports/hoopr.mjs) supplies:
//   sport, source, version
//   modelHistory                       older finished seasons kept for the
//                                      stat model only (pages show two)
//   teamHistory                        optional: more older seasons of games
//                                      (not stored) for the team game model
//                                      only, read from the same schedule
//                                      download (NFL games.csv has every year)
//   games(fetchText, seasons)          → Map(season → games), or throws
//   rows(fetchText, season, games)     → { rows, rejected } or null when not published yet
//   players(fetchText, rowsBySeason, current, { people, stored }) → { players, notes }
//     `people` holds player records the adapter returned from refreshed
//     seasons (newest season wins); `stored` holds the last players record.
//   rows() may also return `notes` and `integrity` (counts for the status
//     record's integrity block, e.g. NFL games added from snap counts).
//   extras(fetchText, current, notes)  optional → { injuries } records to write
//   check(fetchText, { rowsBySeason, gamesBySeason, players, current, now, refreshed })
//     optional → integrity counts and warnings (e.g. NBA box score vs final
//     score). `refreshed`: the seasons re-read this run (a finished season
//     kept as stored was checked when it was read). Never throws into the
//     run; a failure is noted.
//
// Each provider file is downloaded at most once per run (the NFL players
// file is read by both the snap counts and the players step).
import { SPORTS_SCHEMA_VERSION } from './schema.mjs';
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { seasonFor, localDate } from './time.mjs';
import { packRows, unpackRows } from './rows.mjs';
import { buildModel, modelSummary } from './models.mjs';
import { buildTeamModel, teamModelSummary, teamJointRecords } from './team-model.mjs';
import { fitJoint, GAME_STATS } from './joint.mjs';
import { loadRealLines, withGameLines } from './line-archive.mjs';

const SHRINK_GUARD = 0.8; // a refreshed season may not lose more than 20% of its stored rows

function once(fetchText) {
  const seen = new Map();
  return (url) => {
    if (!seen.has(url)) seen.set(url, Promise.resolve().then(() => fetchText(url)));
    return seen.get(url);
  };
}

export async function ingestLeague({ adapter, store, fetchText: fetchRaw, now = Date.now(), log = () => {}, dryRun = false }) {
  const sport = adapter.sport;
  const fetchText = once(fetchRaw);
  const integrity = { checked_utc: new Date(now).toISOString(), seasons: {}, warnings: [] };
  const nowIso = new Date(now).toISOString();
  const statusKey = sportsKey('status', { sport });
  const base = { schema_version: SPORTS_SCHEMA_VERSION, sport, source: adapter.source, adapter_version: adapter.version };
  const prior = await readSportsJson(store, statusKey).catch(() => null);
  const current = seasonFor(sport, localDate(now, 'America/New_York'));
  const seasons = [current - 1, current];
  const history = Array.from({ length: adapter.modelHistory || 0 }, (_, i) => current - 2 - i).reverse();
  const notes = [];
  const writes = [];
  let invalid = false;
  try {
    const gamesBySeason = await adapter.games(fetchText, [...history, ...seasons], notes);
    const counts = { games: 0, player_games: 0, players: 0 };
    const rowsBySeason = new Map(), people = new Map(), refreshed = new Set();
    const storedPlayers = await readSportsJson(store, sportsKey('players', { sport })).catch(() => null);
    const stored = new Map((Array.isArray(storedPlayers?.players) ? storedPlayers.players : []).map((p) => [p.player_id, p]));
    for (const season of seasons) {
      const seasonGames = gamesBySeason.get(season) || [];
      // Postponed games are replayed under a new id, so they do not hold a season open.
      const complete = seasonGames.length > 0 && seasonGames.every((g) => ['final', 'canceled', 'postponed'].includes(g.status));
      const storedGames = await readSportsJson(store, sportsKey('games', { sport, season })).catch(() => null);
      const storedRows = await readSportsJson(store, sportsKey('player-games', { sport, season })).catch(() => null);
      const fresh = season === current || !storedRows || !storedGames || storedRows.adapter_version !== adapter.version || storedRows.complete !== true;
      if (!fresh) {
        log(`${sport} ${season}: finished season already stored, kept as is`);
        const kept = unpackRows(storedRows);
        rowsBySeason.set(season, kept);
        counts.games += (storedGames.games || []).length;
        counts.player_games += kept.length;
        continue;
      }
      if (!seasonGames.length) {
        if (season === current) { notes.push(`no ${season} schedule published yet`); rowsBySeason.set(season, []); continue; }
        throw new Error(`${adapter.source} has no ${season} games`);
      }
      const out = await adapter.rows(fetchText, season, seasonGames);
      let rows = [];
      if (out == null) {
        if (season !== current) throw new Error(`${adapter.source} player stats for ${season} are unavailable`);
        notes.push(`no ${season} player stats published yet`);
      } else {
        // A row for a game that is not final yet (a file read mid-game, or a
        // schedule that has not caught up) would show a partial stat line in
        // logs and averages. It waits for the next run.
        const finals = new Set(seasonGames.filter((g) => g.status === 'final').map((g) => g.game_id));
        rows = out.rows.filter((r) => finals.has(r.game_id));
        if (rows.length < out.rows.length) log(`${sport} ${season}: ${out.rows.length - rows.length} player games held back until their game is final`);
        for (const p of out.people || []) people.set(p.player_id, p);
        if (out.rejected.length) { invalid = true; notes.push(`${season}: ${out.rejected.length} player rows failed validation and were skipped`); }
        notes.push(...(out.notes || []));
        if (out.integrity) integrity.seasons[season] = out.integrity;
        refreshed.add(season);
      }
      const before = Array.isArray(storedRows?.rows) ? storedRows.rows.length : 0;
      if (before > 50 && rows.length < before * SHRINK_GUARD) {
        throw new Error(`${season} player stats shrank from ${before} to ${rows.length} rows; kept the stored copy`);
      }
      const envelope = { ...base, season, generated_utc: nowIso, complete };
      writes.push([sportsKey('games', { sport, season }), { ...envelope, games: seasonGames }]);
      writes.push([sportsKey('player-games', { sport, season }), { ...envelope, ...packRows(rows) }]);
      rowsBySeason.set(season, rows);
      counts.games += seasonGames.length;
      counts.player_games += rows.length;
      log(`${sport} ${season}: ${seasonGames.length} games, ${rows.length} player games${complete ? ' (season finished)' : ''}`);
    }
    // Older finished seasons for the model: fetched once, then left alone. A
    // miss here is noted and never fails the run.
    const modelRows = [], modelSeasons = [], missingHistory = [];
    for (const season of history) {
      try {
        const storedGames = await readSportsJson(store, sportsKey('games', { sport, season })).catch(() => null);
        const storedRows = await readSportsJson(store, sportsKey('player-games', { sport, season })).catch(() => null);
        if (storedGames && storedRows && storedRows.adapter_version === adapter.version && storedRows.complete === true) {
          modelRows.push(...unpackRows(storedRows));
          modelSeasons.push(season);
          continue;
        }
        const seasonGames = gamesBySeason.get(season) || [];
        if (!seasonGames.length || !seasonGames.every((g) => ['final', 'canceled', 'postponed'].includes(g.status))) throw new Error('schedule is not finished');
        const out = await adapter.rows(fetchText, season, seasonGames);
        if (!out?.rows?.length) throw new Error('no player stats');
        if (out.rejected.length) notes.push(`${season}: ${out.rejected.length} player rows failed validation and were skipped`);
        if (out.integrity) integrity.seasons[season] = out.integrity;
        notes.push(...(out.notes || []));
        refreshed.add(season);
        const envelope = { ...base, season, generated_utc: nowIso, complete: true };
        writes.push([sportsKey('games', { sport, season }), { ...envelope, games: seasonGames }]);
        writes.push([sportsKey('player-games', { sport, season }), { ...envelope, ...packRows(out.rows) }]);
        modelRows.push(...out.rows);
        modelSeasons.push(season);
        log(`${sport} ${season}: ${seasonGames.length} games, ${out.rows.length} player games (kept for the model)`);
      } catch (err) {
        missingHistory.push(season);
        log(`${sport} ${season}: history for the model unavailable (${String(err?.message || err).slice(0, 80)})`);
      }
    }
    if (missingHistory.length) notes.push('older seasons for the model are unavailable: ' + missingHistory.join(', '));
    const { players, notes: playerNotes = [] } = await adapter.players(fetchText, rowsBySeason, current, { people, stored });
    const keepIds = new Set([...rowsBySeason.values()].flat().map((r) => r.player_id));
    const known = new Set(players.map((p) => p.player_id));
    const unmatched = [...keepIds].filter((id) => !known.has(id)).length;
    if (unmatched) { invalid = true; notes.push(`${unmatched} players in the game logs are missing from the players file`); }
    notes.push(...playerNotes);
    counts.players = players.length;
    writes.push([sportsKey('players', { sport }), { ...base, generated_utc: nowIso, players }]);
    // Extra records (the NFL official injury report). A miss is noted only.
    if (adapter.extras) {
      try {
        const extra = await adapter.extras(fetchText, current, notes);
        if (extra?.injuries) {
          writes.push([sportsKey('injuries', { sport }), { ...base, generated_utc: nowIso, ...extra.injuries }]);
          integrity.injury_report = { week: extra.injuries.week ?? null, players: extra.injuries.reports?.length || 0 };
        }
      } catch (err) { notes.push('extra records unavailable'); log(`${sport} extras failed: ${String(err?.message || err).slice(0, 80)}`); }
    }
    // Cross-checks (NBA box points vs the final score, a second source).
    if (adapter.check) {
      try {
        const checked = await adapter.check(fetchText, { rowsBySeason, gamesBySeason, players, current, now, log, refreshed });
        if (checked) { const { warnings = [], ...rest } = checked; Object.assign(integrity, rest); integrity.warnings.push(...warnings); }
      } catch (err) { integrity.warnings.push('cross-check unavailable'); log(`${sport} cross-check failed: ${String(err?.message || err).slice(0, 80)}`); }
    }
    // Refit the stat forecasts on the same rows. A failure keeps the stored
    // model and is noted; the game data still lands.
    let model = null;
    try {
      const allRows = [...modelRows, ...[...rowsBySeason.values()].flat()];
      // Real PrizePicks lines (issued props + the line archive) to score the
      // check at; a failed read only means the check has none this run.
      const finalDates = [...new Set(allRows.map((r) => r.date).filter(Boolean))];
      // Game spreads and totals for the model's game-lines check: the
      // schedule's own (NFL), or the ones the NBA props scan archived (read
      // from the same archive files).
      const archivedGameLines = new Map();
      const lines = await loadRealLines({ store, sport, dates: finalDates, seasons: [...modelSeasons, ...seasons], gameLines: archivedGameLines }).catch(() => []);
      const allGames = withGameLines([...gamesBySeason.values()].flat(), archivedGameLines);
      model = buildModel({ sport, rows: allRows, now, lines, games: allGames });
      model.seasons = [...modelSeasons, ...seasons.filter((x) => rowsBySeason.has(x))];
      writes.push([sportsKey('model', { sport }), { ...base, ...model }]);
      for (const [stat, ev] of Object.entries(model.evaluation)) log(`${sport} model ${stat}: ${ev.status}, ${ev.test?.n ?? 0} holdout games, ${ev.real_lines?.n ?? 0} at real lines`);
    } catch (err) {
      notes.push('model refit failed; kept the stored model');
      log(`${sport} model refit failed: ${String(err?.message || err).slice(0, 120)}`);
    }
    // The team game model (win, win by X, spread, totals): every stored
    // season's games, NBA spreads and totals from the line archive, plus the
    // adapter's extra history seasons. A failure keeps the stored one.
    let teamModel = null;
    try {
      const extraSeasons = Array.from({ length: adapter.teamHistory || 0 }, (_, i) => current - 2 - (adapter.modelHistory || 0) - i).reverse();
      const extraGames = extraSeasons.length ? [...(await adapter.games(fetchText, extraSeasons, [])).values()].flat() : [];
      const archived = new Map();
      if (sport === 'nba') {
        const dates = [...new Set([...gamesBySeason.values()].flat().filter((g) => g.status === 'final' && g.local_date).map((g) => g.local_date))];
        await loadRealLines({ store, sport, dates, seasons: [], gameLines: archived }).catch(() => []);
      }
      const teamGames = withGameLines([...extraGames, ...[...gamesBySeason.values()].flat()], archived);
      teamModel = buildTeamModel({ sport, games: teamGames, now });
      writes.push([sportsKey('team-model', { sport }), { ...base, ...teamModel }]);
      // Same-game links between game bets and player lines: refit the
      // player links with each game's team numbers beside them.
      if (model?.joint_records && teamModel.status === 'ok') {
        const splits = Object.values(model.evaluation || {}).map((e) => e.split_date).filter(Boolean).sort();
        const split = splits.length ? splits[Math.floor(splits.length / 2)] : null;
        const joint = fitJoint([...model.joint_records, ...teamJointRecords({ sport, games: teamGames, model: teamModel, split })]);
        model.joint = joint;
        const key = sportsKey('model', { sport });
        const at = writes.findIndex(([k]) => k === key);
        if (at >= 0) writes[at] = [key, { ...writes[at][1], joint }];
        const teamPairs = Object.values(joint.pairs).filter((p) => p.stats.some((x) => GAME_STATS.includes(x)));
        log(`${sport} same-game links with game bets: ${teamPairs.length} measured, ${teamPairs.filter((p) => p.status === 'validated').length} validated`);
      }
      const tm = teamModelSummary(teamModel);
      log(`${sport} team model: ${tm.status}, ${tm.games ?? 0} games${tm.markets ? '; ' + Object.entries(tm.markets).map(([k, v]) => `${k} ${v.status} (${v.n})`).join(', ') : ''}`);
    } catch (err) {
      notes.push('team model refit failed; kept the stored one');
      log(`${sport} team model refit failed: ${String(err?.message || err).slice(0, 120)}`);
    }
    const dates = [...rowsBySeason.values()].flat().map((r) => r.date).filter(Boolean).sort();
    const status = {
      ...base,
      state: invalid || notes.some((n) => /failed validation/.test(n)) ? 'degraded' : 'ok',
      last_success_utc: nowIso, last_attempt_utc: nowIso,
      seasons: seasons.filter((s) => rowsBySeason.has(s)),
      latest_game_date: dates.length ? dates[dates.length - 1] : null,
      counts, message: notes.length ? notes.join('; ').slice(0, 300) : null,
      integrity,
      model: model ? modelSummary(model) : prior?.model || null,
      team_model: teamModel ? teamModelSummary(teamModel) : prior?.team_model || null,
    };
    // Data first, status last: a reader never sees a status for files that
    // were not written.
    if (!dryRun) {
      for (const [key, value] of writes) await writeSportsJson(store, key, value);
      await writeSportsJson(store, statusKey, status);
    }
    log(`${sport} status: ${status.state}; ${counts.games} games, ${counts.player_games} player games, ${counts.players} players, latest game ${status.latest_game_date || 'none'}${dryRun ? ' (dry run, nothing written)' : ''}`);
    log(`${sport} integrity: ${integrityLine(integrity)}`);
    return { status, model, writes: writes.map(([key, value]) => ({ key, bytes: Buffer.byteLength(JSON.stringify(value)) })) };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 300);
    const failed = {
      ...base, state: 'failed', last_success_utc: prior?.last_success_utc || null, last_attempt_utc: nowIso,
      seasons: Array.isArray(prior?.seasons) ? prior.seasons : [], latest_game_date: prior?.latest_game_date || null,
      counts: prior?.counts || null, message, integrity: prior?.integrity || null, model: prior?.model || null, team_model: prior?.team_model || null,
    };
    if (!dryRun) await writeSportsJson(store, statusKey, failed).catch(() => {});
    throw Object.assign(new Error(message), { status: failed });
  }
}

// Counts only, for the public workflow log.
export function integrityLine(integrity) {
  const parts = [];
  for (const [season, i] of Object.entries(integrity?.seasons || {})) {
    const bits = Object.entries(i).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => `${k}=${v}`);
    if (bits.length) parts.push(`${season}: ${bits.join(' ')}`);
  }
  if (integrity?.injury_report) parts.push(`injury report week ${integrity.injury_report.week ?? '?'}: ${integrity.injury_report.players} players`);
  if (integrity?.box_scores) parts.push(`box scores checked ${integrity.box_scores.games_checked}, off ${integrity.box_scores.mismatched}`);
  const ss = integrity?.second_source;
  if (ss) parts.push(`NBA.com ${ss.state}${ss.games_checked != null ? `: ${ss.games_checked} games, ${ss.mismatched} scores off, ${ss.players_checked} player lines checked, ${ss.players_mismatched} off, ${ss.players_missing ?? 0} missing` : ''}`);
  if (integrity?.warnings?.length) parts.push(`${integrity.warnings.length} warnings`);
  return parts.join('; ') || 'nothing to report';
}

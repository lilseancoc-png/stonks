// The PrizePicks line archive (since 2026-11-11). Every props scan already
// matches the current main lines to stored players and games; this keeps
// one entry per game, player and stat, by game date (ET), so the daily model
// check can score its held-out forecasts at the line PrizePicks really
// posted, not only at the last-10 stand-in (lib/sports/models.mjs,
// `real_lines`). Nothing is fetched for it: it is written from lines the
// scan already read. Pregame lines only. A file changes only when a new line
// appears or a line moves, so a quiet scan writes nothing.
import { sportsKey, readSportsJson, writeSportsJson } from './store.mjs';
import { localDate } from './time.mjs';

// The first day with an archive; earlier dates are never read.
export const LINE_ARCHIVE_START = '2026-11-11';
const MAX_LINES = 20000; // a busy NBA day is about 2,000
const FIELDS = ['first_line', 'first_seen_utc', 'line', 'line_since_utc'];

function validLine(l) {
  return l && typeof l.game_id === 'string' && l.game_id && typeof l.player_id === 'string' && l.player_id && typeof l.stat === 'string' && l.stat &&
    typeof l.threshold === 'number' && Number.isFinite(l.threshold) && l.threshold >= 0 && Number.isInteger(l.threshold * 2);
}

// Game spreads and totals (since 2026-11-11, NBA): the props scan's
// sportsbook reference read already carries them, so the same files keep the
// latest pregame consensus per game under `games`
// ({ game_id: [total, home_margin, observed_utc, home_win?] }; home_margin > 0
// = home favored; home_win, since 2026-11-12, the books' no-vig moneyline
// chance of the home team, when the books priced one). The stat model tests
// them as an input once enough games have them; the team game model starts
// from them.
function validGameLine(g) {
  return g && typeof g.game_id === 'string' && g.game_id && Number.isFinite(g.total) && g.total > 0 && g.total <= 400 &&
    Number.isFinite(g.home_margin) && Math.abs(g.home_margin) <= 60;
}

// `lines`: [{ game_id, player_id, stat, threshold, observed_utc, start_utc }].
// `gameLines`: [{ game_id, total, home_margin, observed_utc, start_utc }].
export async function archiveLines({ store, sport, lines, gameLines = [], now = Date.now() }) {
  const hasLines = Array.isArray(lines) && lines.length, hasGames = Array.isArray(gameLines) && gameLines.length;
  if (store?.backend !== 'r2' || typeof store.withLease !== 'function' || (!hasLines && !hasGames)) return { state: 'skipped', added: 0, moved: 0, games: 0 };
  const byDate = new Map();
  const pregame = (x) => {
    const start = Date.parse(x.start_utc), seen = Date.parse(x.observed_utc);
    if (!(start > now) || !(seen <= start) || !(seen <= now + 60000)) return null;
    const date = localDate(start, 'America/New_York');
    return date < LINE_ARCHIVE_START ? null : date;
  };
  const slot = (date) => byDate.get(date) || byDate.set(date, { lines: [], games: [] }).get(date);
  for (const l of hasLines ? lines : []) {
    if (!validLine(l)) continue;
    const date = pregame(l);
    if (date) slot(date).lines.push(l);
  }
  for (const g of hasGames ? gameLines : []) {
    if (!validGameLine(g)) continue;
    const date = pregame(g);
    if (date) slot(date).games.push(g);
  }
  let added = 0, moved = 0, games = 0;
  try {
    for (const [date, { lines: list, games: gameList }] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
      const key = sportsKey('lines', { sport, date });
      const leased = await store.withLease('sports-lines-' + sport + '-' + date, async (guard) => {
        const prior = await readSportsJson(store, key);
        // A damaged file is an error, never an invitation to start it over.
        if (prior && (!prior.lines || typeof prior.lines !== 'object' || Array.isArray(prior.lines))) throw new Error('invalid line archive');
        const out = { ...(prior?.lines || {}) };
        let count = Object.keys(out).length, changed = 0;
        for (const l of list.slice().sort((a, b) => Date.parse(a.observed_utc) - Date.parse(b.observed_utc))) {
          const k = l.game_id + '|' + l.player_id + '|' + l.stat;
          const was = out[k];
          if (!was) {
            if (count >= MAX_LINES) continue;
            out[k] = [l.threshold, l.observed_utc, l.threshold, l.observed_utc];
            count++; added++; changed++;
          } else if (Array.isArray(was) && was[2] !== l.threshold && Date.parse(l.observed_utc) > Date.parse(was[3])) {
            out[k] = [was[0], was[1], l.threshold, l.observed_utc];
            moved++; changed++;
          }
        }
        const gamesOut = prior?.games && typeof prior.games === 'object' && !Array.isArray(prior.games) ? { ...prior.games } : {};
        for (const g of gameList.slice().sort((a, b) => Date.parse(a.observed_utc) - Date.parse(b.observed_utc))) {
          const was = gamesOut[g.game_id];
          if (Array.isArray(was) && !(Date.parse(g.observed_utc) > Date.parse(was[2]))) continue;
          const win = Number.isFinite(g.home_win) && g.home_win > 0 && g.home_win < 1 ? g.home_win : null;
          if (Array.isArray(was) && was[0] === g.total && was[1] === g.home_margin && (was[3] ?? null) === win) continue;
          gamesOut[g.game_id] = win == null ? [g.total, g.home_margin, g.observed_utc] : [g.total, g.home_margin, g.observed_utc, win];
          games++; changed++;
        }
        if (!changed) return;
        guard();
        await writeSportsJson(store, key, { schema_version: 1, sport, date, fields: FIELDS, updated_utc: new Date(now).toISOString(), lines: out,
          ...(Object.keys(gamesOut).length ? { game_fields: ['total', 'home_margin', 'observed_utc', 'home_win'], games: gamesOut } : {}) });
      });
      if (leased?.busy) return { state: 'busy', added, moved, games };
    }
    return { state: 'ok', added, moved, games };
  } catch {
    return { state: 'unavailable', added, moved, games };
  }
}

// One game's archived spread and total from a day's archive file, as a
// game's `lines` ({ total, home_margin, observed_utc, source }); null when
// the file has none for it.
export function archivedGameLine(file, gameId) {
  const v = file?.games?.[gameId];
  const g = Array.isArray(v) ? { game_id: String(gameId), total: v[0], home_margin: v[1] } : null;
  const win = Array.isArray(v) && Number.isFinite(v[3]) && v[3] > 0 && v[3] < 1 ? v[3] : null;
  return validGameLine(g) ? { total: g.total, home_margin: g.home_margin, observed_utc: typeof v[2] === 'string' ? v[2] : null, source: 'sportsbooks', ...(win != null ? { book: { home_win: win } } : {}) } : null;
}

// Fill each game's `lines` from archived game lines when the schedule has
// none (NBA). `gameLines`: Map(game_id → { total, home_margin }).
export function withGameLines(games, gameLines) {
  if (!gameLines?.size) return games;
  return games.map((g) => (g.lines || !gameLines.has(g.game_id) ? g : { ...g, lines: { ...gameLines.get(g.game_id), source: 'archive' } }));
}

// The real lines for the model check: the archive's latest pregame line for
// each game day from LINE_ARCHIVE_START on, plus the issued props record's
// saved line (from before the archive existed). `dates`: the game days to
// read; `seasons`: the prop-record seasons. Missing files are skipped.
// `gameLines` (a Map, optional) is filled with the archived game spreads and
// totals from the same files.
export async function loadRealLines({ store, sport, dates = [], seasons = [], gameLines = null }) {
  const out = [];
  const read = (key) => readSportsJson(store, key).catch(() => null);
  for (const season of seasons) {
    const record = await read(sportsKey('prop-record', { sport, season }));
    for (const p of Array.isArray(record?.picks) ? record.picks : []) {
      const l = { game_id: String(p.game_id ?? ''), player_id: String(p.player_id ?? ''), stat: p.stat, threshold: p.threshold };
      if (validLine(l)) out.push({ ...l, source: 'issued' });
    }
  }
  const days = [...new Set(dates)].filter((d) => typeof d === 'string' && d >= LINE_ARCHIVE_START).sort();
  for (let i = 0; i < days.length; i += 8) {
    const files = await Promise.all(days.slice(i, i + 8).map((date) => read(sportsKey('lines', { sport, date }))));
    for (const f of files) {
      if (gameLines && f?.games && typeof f.games === 'object') {
        for (const [gameId, v] of Object.entries(f.games)) {
          const g = Array.isArray(v) ? { game_id: gameId, total: v[0], home_margin: v[1] } : null;
          if (validGameLine(g)) gameLines.set(gameId, { total: g.total, home_margin: g.home_margin });
        }
      }
      if (!f?.lines || typeof f.lines !== 'object') continue;
      for (const [k, v] of Object.entries(f.lines)) {
        const [game_id, player_id, stat] = k.split('|');
        const l = { game_id, player_id, stat, threshold: Array.isArray(v) ? v[2] : null };
        if (validLine(l)) out.push({ ...l, source: 'archive' });
      }
    }
  }
  return out;
}

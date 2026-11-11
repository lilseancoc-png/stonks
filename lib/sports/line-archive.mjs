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

// `lines`: [{ game_id, player_id, stat, threshold, observed_utc, start_utc }].
export async function archiveLines({ store, sport, lines, now = Date.now() }) {
  if (store?.backend !== 'r2' || typeof store.withLease !== 'function' || !Array.isArray(lines) || !lines.length) return { state: 'skipped', added: 0, moved: 0 };
  const byDate = new Map();
  for (const l of lines) {
    if (!validLine(l)) continue;
    const start = Date.parse(l.start_utc), seen = Date.parse(l.observed_utc);
    if (!(start > now) || !(seen <= start) || !(seen <= now + 60000)) continue;
    const date = localDate(start, 'America/New_York');
    if (date < LINE_ARCHIVE_START) continue;
    const list = byDate.get(date) || [];
    list.push(l);
    byDate.set(date, list);
  }
  let added = 0, moved = 0;
  try {
    for (const [date, list] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
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
        if (!changed) return;
        guard();
        await writeSportsJson(store, key, { schema_version: 1, sport, date, fields: FIELDS, updated_utc: new Date(now).toISOString(), lines: out });
      });
      if (leased?.busy) return { state: 'busy', added, moved };
    }
    return { state: 'ok', added, moved };
  } catch {
    return { state: 'unavailable', added, moved };
  }
}

// The real lines for the model check: the archive's latest pregame line for
// each game day from LINE_ARCHIVE_START on, plus the issued props record's
// saved line (from before the archive existed). `dates`: the game days to
// read; `seasons`: the prop-record seasons. Missing files are skipped.
export async function loadRealLines({ store, sport, dates = [], seasons = [] }) {
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

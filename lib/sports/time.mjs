// Today / Tomorrow for the Sports boards. Storage is always UTC; the boards
// read a configurable IANA time zone (default Los Angeles, per the Sports
// roadmap) so a 7:30 pm Pacific tip-off counts as "today" there even though
// it is already tomorrow in UTC. No library: Intl handles DST.

export const SPORTS_DEFAULT_TIME_ZONE = 'America/Los_Angeles';

// Zones offered in the page's picker. Any valid IANA zone is accepted by the
// server; this list is only what the menu shows.
export const SPORTS_TIME_ZONES = Object.freeze([
  ['America/Los_Angeles', 'Pacific'],
  ['America/Denver', 'Mountain'],
  ['America/Chicago', 'Central'],
  ['America/New_York', 'Eastern'],
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function resolveTimeZone(tz) {
  return validTimeZone(tz) ? tz : SPORTS_DEFAULT_TIME_ZONE;
}

function parts(ms, tz) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

// Offset of `tz` from UTC at instant `ms`, in milliseconds (LA in winter = -8h).
export function zoneOffsetMs(ms, tz) {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - (Math.floor(ms / 1000) * 1000);
}

// Calendar date (YYYY-MM-DD) of instant `ms` in `tz`.
export function localDate(ms, tz) {
  const p = parts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(dateStr, days) {
  if (!DATE_RE.test(dateStr)) throw new Error('date must be YYYY-MM-DD');
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// UTC instant of local midnight that starts `dateStr` in `tz`. Two passes so
// a DST change between the guess and the answer is still exact.
export function zonedMidnightUtc(dateStr, tz) {
  if (!DATE_RE.test(dateStr)) throw new Error('date must be YYYY-MM-DD');
  const [y, m, d] = dateStr.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffsetMs(wall, tz);
  guess = wall - zoneOffsetMs(guess, tz);
  return guess;
}

// UTC instant of a local wall-clock time (`HH:MM` on `dateStr`) in `tz`.
// Providers publish kickoffs in local time (nflverse uses US Eastern).
export function zonedTimeUtc(dateStr, hhmm, tz) {
  if (!DATE_RE.test(dateStr)) throw new Error('date must be YYYY-MM-DD');
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('time must be HH:MM');
  const [y, mo, d] = dateStr.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  let guess = wall - zoneOffsetMs(wall, tz);
  guess = wall - zoneOffsetMs(guess, tz);
  return guess;
}

// Season label for a calendar date: always the year the season STARTS
// (NFL 2026 = Sept 2026 to Feb 2027; NBA 2026 = Oct 2026 to June 2027).
export function seasonFor(sport, dateStr) {
  if (!DATE_RE.test(dateStr)) throw new Error('date must be YYYY-MM-DD');
  const [y, m] = dateStr.split('-').map(Number);
  const firstMonth = sport === 'nba' ? 8 : 3; // NBA ends in June; NFL ends in February
  return m >= firstMonth ? y : y - 1;
}

// The active window: games whose start falls on today or tomorrow in `tz`.
// `endUtc` is exclusive (local midnight after tomorrow).
export function sportsDayWindow(nowMs, tz) {
  const zone = resolveTimeZone(tz);
  const today = localDate(nowMs, zone), tomorrow = addDays(today, 1);
  return {
    time_zone: zone, today, tomorrow,
    start_utc: new Date(zonedMidnightUtc(today, zone)).toISOString(),
    end_utc: new Date(zonedMidnightUtc(addDays(today, 2), zone)).toISOString(),
  };
}

// 'today' | 'tomorrow' | null for a game start. Postponed games carry their
// new start, so they move boards automatically; a missing start is never active.
export function activeDayOf(startIso, nowMs, tz) {
  const ms = Date.parse(startIso);
  if (!Number.isFinite(ms)) return null;
  const w = sportsDayWindow(nowMs, tz), day = localDate(ms, w.time_zone);
  return day === w.today ? 'today' : day === w.tomorrow ? 'tomorrow' : null;
}

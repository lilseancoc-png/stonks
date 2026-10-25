// NYSE daily research calendar, 1990 onward. This is separate from the verified
// order/expiry calendar; it never authorizes execution. Cached closes are still
// required. Regular holidays: https://www.nyse.com/markets/hours-calendars
// Exceptional closures: https://www.nyse.com/pdfs/closings.pdf
const DAY = 86400000;
const key = ms => new Date(ms).toISOString().slice(0, 10);
const stamp = (y, m, d) => Date.UTC(y, m - 1, d);
const exceptional = new Set(['1994-04-27', '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', '2004-06-11', '2007-01-02', '2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09']);
const closedYears = new Map();
function closedDates(year) {
  if (closedYears.has(year)) return closedYears.get(year);
  const closed = new Set();
  const nth = (month, weekday, n) => stamp(year, month, 1 + (weekday - new Date(stamp(year, month, 1)).getUTCDay() + 7) % 7 + (n - 1) * 7);
  const observed = (month, day, saturday = true) => {
    let t = stamp(year, month, day), dow = new Date(t).getUTCDay();
    if (dow === 6 && saturday) t -= DAY;
    if (dow === 0) t += DAY;
    closed.add(key(t));
  };
  observed(1, 1, false); // NYSE stays open before a Saturday New Year's Day.
  if (year >= 1998) closed.add(key(nth(1, 1, 3)));
  closed.add(key(nth(2, 1, 3)));
  // Gregorian Easter, Meeus/Jones/Butcher. Good Friday is two days earlier.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = h + l - 7 * m + 114;
  closed.add(key(stamp(year, Math.floor(easter / 31), easter % 31 + 1) - 2 * DAY));
  const mayEnd = stamp(year, 5, 31);
  closed.add(key(mayEnd - (new Date(mayEnd).getUTCDay() + 6) % 7 * DAY));
  if (year >= 2022) observed(6, 19);
  observed(7, 4);
  closed.add(key(nth(9, 1, 1)));
  closed.add(key(nth(11, 4, 4)));
  observed(12, 25);
  closedYears.set(year, closed);
  return closed;
}
export function isHistoricalTradingDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const ms = Date.parse(date + 'T00:00:00Z'), y = Number(date.slice(0, 4));
  if (!Number.isFinite(ms) || key(ms) !== date || y < 1990) return false;
  return ![0, 6].includes(new Date(ms).getUTCDay()) && !exceptional.has(date) && !closedDates(y).has(date);
}
export function historicalTradingDate(date, direction = -1) {
  const start = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(start)) return null;
  for (let i = 0; i < 14; i++) {
    const day = key(start + i * direction * DAY);
    if (isHistoricalTradingDate(day)) return day;
  }
  return null;
}
export function completedCloseCutoff(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) * 60 + Number(parts.minute) >= 975 ? today : key(Date.parse(today + 'T00:00:00Z') - DAY);
}

// Published NYSE closures, verified 2026-10-22. Refuse unknown years instead
// of guessing a trading session for order/expiry controls.
// https://www.nyse.com/trade/hours-calendars
const CLOSED = {
  2026: "01-01 01-19 02-16 04-03 05-25 06-19 07-03 09-07 11-26 12-25",
  2027: "01-01 01-18 02-15 03-26 05-31 06-18 07-05 09-06 11-25 12-24",
  2028: "01-17 02-21 04-14 05-29 06-19 07-04 09-04 11-23 12-25",
};
const EARLY = new Set(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function etClock(ms) {
  const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
export function sessionForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const year = Number(date.slice(0, 4)), holidays = CLOSED[year];
  if (!holidays) return null;
  const d = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  const open = d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.split(" ").includes(date.slice(5));
  return { date, open, openMinute: 570, closeMinute: EARLY.has(date) ? 780 : 960 };
}
export function previousTradingDate(date) {
  const d = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(d.getTime())) return null;
  for (let i = 0; i < 12; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10), s = sessionForDate(key);
    if (!s) return null;
    if (s.open) return key;
  }
  return null;
}
export function marketSession(ms) {
  const clock = etClock(ms), s = sessionForDate(clock.date);
  return { ...clock, known: !!s, open: !!s?.open, closeMinute: s?.closeMinute ?? null,
    trading: !!s?.open && clock.minute >= s.openMinute && clock.minute < s.closeMinute };
}
export function expiryControl(trade, nowMs) {
  const clock = etClock(nowMs);
  const dates = (trade.legs || []).map((l) => {
    // Without verified last-trading metadata, start two sessions before the
    // expiration date. This also leaves a full session for AM-settled products.
    const finalDate = l.lastTradingDate || previousTradingDate(l.expiry);
    return finalDate && previousTradingDate(finalDate);
  });
  if (!dates.length || dates.some((d) => !d)) return { known: false, due: true, expired: false };
  const closeDate = dates.sort()[0], session = sessionForDate(closeDate);
  const expiry = (trade.legs || []).map((l) => l.expiry).sort()[0];
  const expSession = sessionForDate(expiry);
  return { known: true, closeDate, closeMinute: session.closeMinute - 90,
    // Build-driven execution must start with the first mirror on this date,
    // rather than waiting for an afternoon minute with no scheduled trigger.
    due: clock.date >= closeDate,
    expired: clock.date > expiry || (clock.date === expiry && clock.minute >= (expSession?.closeMinute ?? 960)) };
}

// Calendar subscription (2026-11-06): an iCalendar (.ics) feed of the dates
// that move a watchlist: each watched stock's earnings, the CPI and jobs
// reports, and FOMC rate decisions. Built from the public calendar.json the
// bake already writes (30 days of events plus the FOMC meeting list), so it
// costs no new fetches and no AI. Served by api/auth/[action].js
// ("calendar-ics"): ?s=AAPL,MSFT for anyone, or an Owner's signed link that
// reads the synced Owner watchlist.
//
// Pure: no network, no clock unless nowIso is omitted.

const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
export const ICS_MAX_SYMBOLS = 40;

export function parseIcsSymbols(raw) {
  const out = [];
  for (const part of String(raw || "").split(",")) {
    const s = part.trim().toUpperCase();
    if (SYM_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= ICS_MAX_SYMBOLS) break;
  }
  return out;
}

// RFC 5545 text escaping and 75-octet line folding.
function esc(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.join("\r\n ");
}
const ymd = (iso) => String(iso || "").slice(0, 10).replace(/-/g, "");
function nextDay(iso) {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return new Date(t + 86400000).toISOString().slice(0, 10);
}
function stamp(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
// "08:30 ET" / "14:00 ET" / "8:30 AM" -> "083000", else null.
function etClock(text) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(text || ""));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) { const pm = m[3].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return null;
  return String(h).padStart(2, "0") + String(min).padStart(2, "0") + "00";
}
function addMinutes(hhmmss, mins) {
  const h = Number(hhmmss.slice(0, 2)), m = Number(hhmmss.slice(2, 4));
  const t = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return String(Math.floor(t / 60)).padStart(2, "0") + String(t % 60).padStart(2, "0") + "00";
}

// America/New_York, the US rules since 2007.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:20070311T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:20071104T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

function reportGroup(ev) {
  const t = `${ev?.subtype || ""} ${ev?.title || ""}`.toLowerCase();
  if (/\badp\b/.test(t)) return null;
  if (/^(?:core-)?cpi-|consumer price index|\bcpi\b/.test(t)) return "cpi";
  if (/^(?:nfp|unrate)\b|employment situation|non-farm|nonfarm/.test(t)) return "jobs";
  return null;
}

const SESSION_TEXT = { AM: "before the open", BMO: "before the open", PM: "after the close", AMC: "after the close" };

// calendar: the calendar.json payload. Returns the .ics text (CRLF lines).
export function buildCalendarIcs(calendar, { symbols = [], nowIso = new Date().toISOString(), name = "Mingstreet: watchlist earnings, CPI, jobs, FOMC", siteUrl = "https://mingstreet.app" } = {}) {
  // Today in New York, so tonight's events don't drop off at 8 PM ET.
  const nowMs = Date.parse(nowIso);
  const today = Number.isFinite(nowMs) ? new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : String(nowIso).slice(0, 10);
  const watch = new Set(parseIcsSymbols(symbols.join ? symbols.join(",") : symbols));
  const items = new Map();
  const add = (uid, fields) => { if (!items.has(uid)) items.set(uid, fields); };
  for (const ev of Array.isArray(calendar?.events) ? calendar.events : []) {
    const date = typeof ev?.date === "string" ? ev.date.slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;
    if (ev.type === "earnings" && ev.symbol && watch.has(String(ev.symbol).toUpperCase())) {
      const sym = String(ev.symbol).toUpperCase();
      const when = SESSION_TEXT[String(ev.session || "").toUpperCase()] || "time not set";
      const implied = Number(ev.impliedMovePct);
      add(`earnings-${sym}-${date}`, {
        date, allDay: true,
        summary: `${sym} earnings (${when})`,
        description: `${sym} reports ${when}.${Number.isFinite(implied) && implied > 0 ? ` Options price a move of about ±${(implied * 100).toFixed(1)}%.` : ""} Source: ${ev.source || "Mingstreet calendar"}.`,
        url: `${siteUrl}/?tab=stock&s=${encodeURIComponent(sym)}`,
      });
    } else if (ev.type === "fomc") {
      add(`fomc-${date}`, { date, time: etClock(ev.time) || "140000", minutes: 60, summary: "FOMC rate decision", description: `${ev.title || "FOMC rate decision"}. Statement at 2:00 PM ET, press conference at 2:30 PM ET.`, url: `${siteUrl}/?tab=calendar` });
    } else if (ev.type === "report") {
      const g = reportGroup(ev);
      if (!g) continue;
      const label = g === "cpi" ? "CPI inflation report" : "Jobs report (payrolls and unemployment)";
      add(`${g}-${date}`, { date, time: etClock(ev.time) || "083000", minutes: 30, summary: label, description: `${label}, released at 8:30 AM ET${ev.source ? ` (${ev.source})` : ""}.`, url: `${siteUrl}/?tab=calendar` });
    }
  }
  // FOMC meetings past the 30-day event window.
  for (const m of Array.isArray(calendar?.fomc?.meetings) ? calendar.fomc.meetings : []) {
    const date = typeof m?.date === "string" ? m.date.slice(0, 10) : null;
    if (!date || date < today) continue;
    add(`fomc-${date}`, { date, time: "140000", minutes: 60, summary: "FOMC rate decision", description: `FOMC meeting ${m.label || date}. Statement at 2:00 PM ET, press conference at 2:30 PM ET.`, url: `${siteUrl}/?tab=calendar` });
  }
  const dtstamp = stamp(nowIso);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mingstreet//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];
  const sorted = [...items.entries()].sort((a, b) => (a[1].date < b[1].date ? -1 : a[1].date > b[1].date ? 1 : a[0] < b[0] ? -1 : 1));
  for (const [uid, it] of sorted) {
    lines.push("BEGIN:VEVENT", `UID:${uid}@mingstreet.app`, `DTSTAMP:${dtstamp}`);
    if (it.allDay) lines.push(`DTSTART;VALUE=DATE:${ymd(it.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(it.date))}`, "TRANSP:TRANSPARENT");
    else lines.push(`DTSTART;TZID=America/New_York:${ymd(it.date)}T${it.time}`, `DTEND;TZID=America/New_York:${ymd(it.date)}T${addMinutes(it.time, it.minutes || 30)}`);
    lines.push(`SUMMARY:${esc(it.summary)}`, `DESCRIPTION:${esc(it.description + " Not investment advice.")}`, `URL:${it.url}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

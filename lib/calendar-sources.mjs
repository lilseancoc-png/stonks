import { sessionForDate } from './us-equity-calendar.mjs';

export const ISM_CALENDAR_URL = 'https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/';
export const censusCalendarUrl = year => `https://www.census.gov/economic-indicators/calendar-listview-${year}.html`;
// Published 2026 table, checked October 28, 2026. The publisher sometimes
// serves an HTTP-200 CAPTCHA to Node. Keep this dated fallback visible as
// cached schedule data; never extrapolate it into unpublished years.
export function ismBaselineEvents(year) {
  if (Number(year) !== 2026) return [];
  const manufacturing = [5,2,2,1,1,1,1,3,1,1,2,1];
  const services = [7,4,4,6,5,3,6,5,3,5,4,3];
  return manufacturing.flatMap((day, month) => [
    { type: 'report', subtype: 'ism-mfg', title: 'ISM Manufacturing PMI', date: iso(year, month + 1, day) },
    { type: 'report', subtype: 'ism-services', title: 'ISM Services PMI', date: iso(year, month + 1, services[month]) },
  ]).map(e => ({ ...e, time: '10:00 ET', source: 'ISM', sourceKey: `ism-${year}`, sourceUrl: ISM_CALENDAR_URL,
    official: true, importance: 'high', baseline: true, stale: true, scheduleVerifiedAt: '2026-10-28' }));
}
const text = html => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const iso = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function dateFromText(raw) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(raw);
  const month = months.indexOf(m?.[1]?.toLowerCase()) + 1;
  if (!m || !month) return null;
  const date = iso(m[3], month, m[2]);
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
function timeFromText(raw) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(raw);
  if (!m) return null;
  return `${String(Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)).padStart(2, '0')}:${m[2]} ET`;
}

export function parseCensusCalendar(html, year) {
  const events = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
    if (cells.length < 4) continue;
    // Visible dates are authoritative. Hidden sort keys can retain a date
    // even after a release is suspended or rescheduled.
    const date = dateFromText(cells[1]), time = timeFromText(cells[2]);
    if (!date || !time || Number(date.slice(0, 4)) !== Number(year)) continue;
    events.push({ type: 'report', subtype: 'official-census-' + cells[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: cells[0], date, time, referencePeriod: cells[3], source: 'U.S. Census Bureau',
      sourceKey: `census-${year}`, sourceUrl: censusCalendarUrl(year), official: true,
      importance: /retail|residential|durable|international trade/i.test(cells[0]) ? 'high' : 'medium' });
  }
  return events;
}

export function parseIsmCalendar(html) {
  const events = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]));
    const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(cells[0] || '');
    const month = months.indexOf(m?.[1]?.toLowerCase()) + 1;
    if (!m || !month) continue;
    ['Manufacturing', 'Services'].forEach((label, i) => {
      const day = /^(\d{1,2})(?:\s*\*+)?$/.exec(cells[i + 1] || '')?.[1];
      if (!day) return;
      const date = iso(m[2], month, day);
      const parsed = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
      events.push({ type: 'report', subtype: label === 'Services' ? 'ism-services' : 'ism-mfg',
        title: `ISM ${label} PMI`, date, time: '10:00 ET', source: 'ISM', sourceKey: `ism-${m[2]}`,
        sourceUrl: ISM_CALENDAR_URL, official: true, importance: 'high' });
    });
  }
  return events;
}

// Complement the long-range official schedules with explicitly dated weekly
// events. Do not invent a future cadence or manufacture Actual/Consensus.
export function supplementalWeeklyReports(rows, startMs, cutoffMs, nowMs) {
  const allowed = /jobless claims|unemployment claims|ADP|retail sales|consumer confidence|consumer sentiment|inflation expectations|flash.*PMI|ISM.*services|existing home sales|pending home sales|crude oil inventories|natural gas storage|(?:10|30)-y(?:ear)? bond auction/i;
  return (rows || []).flatMap(row => {
    if (row?.country !== 'USD' || !allowed.test(row.title || '') || !/T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(row.date || '')) return [];
    const at = Date.parse(row.date);
    if (!Number.isFinite(at)) return [];
    const date = new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const dayMs = Date.parse(date + 'T00:00:00Z');
    if (dayMs < startMs || dayMs > cutoffMs) return [];
    const title = String(row.title);
    return [{ type: 'report', subtype: /ISM.*services/i.test(title) ? 'ism-services' : 'weekly-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title, date, time: new Date(at).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) + ' ET',
      actual: at <= nowMs ? row.actual || null : null, previous: row.previous || null, consensus: row.forecast || null,
      source: 'ForexFactory', sourceKey: 'forex-factory', sourceUrl: 'https://www.forexfactory.com/calendar',
      importance: row.impact === 'High' ? 'high' : 'medium' }];
  });
}

export function marketSessionCalendarEvents(startMs, cutoffMs) {
  const events = [];
  for (let ms = startMs; ms <= cutoffMs; ms += 86400000) {
    const d = new Date(ms), date = d.toISOString().slice(0, 10);
    if ([0, 6].includes(d.getUTCDay())) continue;
    const session = sessionForDate(date);
    if (!session || (session.open && session.closeMinute === 960)) continue;
    events.push({ type: 'holiday', date, title: session.open ? 'U.S. stock market early close · 13:00 ET' : 'U.S. stock market closed',
      ...(session.open ? { time: '13:00 ET' } : {}), source: 'NYSE', sourceKey: 'nyse',
      sourceUrl: 'https://www.nyse.com/trade/hours-calendars', official: true, importance: 'medium' });
  }
  return events;
}

export function scheduledPolicyCalendarEvents(startMs, cutoffMs) {
  // FEC's published 2026 calendar, checked October 28, 2026. Do not infer
  // special elections or unannounced fiscal/policy deadlines from a cadence.
  return [{ type: 'macro', date: '2026-11-03', title: 'U.S. midterm elections',
    source: 'Federal Election Commission', sourceKey: 'fec-2026',
    sourceUrl: 'https://www.fec.gov/documents/5910/2026pdates.pdf',
    official: true, importance: 'high', scheduleVerifiedAt: '2026-10-28' }]
    .filter(e => Date.parse(e.date + 'T00:00:00Z') >= startMs && Date.parse(e.date + 'T00:00:00Z') <= cutoffMs);
}

// Owner Party tracker. Market and sector returns while each party held the
// presidency, the House, or the Senate, from Bush's inauguration forward.
// Control dates are a checked calendar, not a guess from election years.
// Price math is separate so a bad download cannot invent a party return.

export const PARTY_TRACKER_VERSION = 1;
export const PARTY_TRACKER_KEY = 'party-tracker.json';
export const STUDY_START = '2001-01-20';
const YEAR_DAYS = 365.2425;
const DAY_MS = 86400000;
// The longest US market closure in the window was September 11–17, 2001.
const MAX_SESSION_GAP_DAYS = 7;

// Half-open ranges [start, end). A 50–50 Senate is the vice president's party.
// Independents who caucused with a party are counted with that caucus.
// Senate dates follow the Senate Historical Office party-division pages.
// House dates follow each Congress's opening majority. No Congress in this
// window changed which party organized the chamber.
export const PRESIDENT_CONTROL = Object.freeze([
  Object.freeze({ party: 'R', name: 'George W. Bush', start: '2001-01-20', end: '2009-01-20' }),
  Object.freeze({ party: 'D', name: 'Barack Obama', start: '2009-01-20', end: '2017-01-20' }),
  Object.freeze({ party: 'R', name: 'Donald Trump', start: '2017-01-20', end: '2021-01-20' }),
  Object.freeze({ party: 'D', name: 'Joe Biden', start: '2021-01-20', end: '2025-01-20' }),
  Object.freeze({ party: 'R', name: 'Donald Trump', start: '2025-01-20', end: '2029-01-20' }),
]);

export const HOUSE_CONTROL = Object.freeze([
  Object.freeze({ party: 'R', congress: 107, start: '2001-01-03', end: '2003-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 108, start: '2003-01-03', end: '2005-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 109, start: '2005-01-03', end: '2007-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'D', congress: 110, start: '2007-01-03', end: '2009-01-03', note: 'Democratic majority for the whole Congress.' }),
  Object.freeze({ party: 'D', congress: 111, start: '2009-01-03', end: '2011-01-03', note: 'Democratic majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 112, start: '2011-01-03', end: '2013-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 113, start: '2013-01-03', end: '2015-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 114, start: '2015-01-03', end: '2017-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 115, start: '2017-01-03', end: '2019-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'D', congress: 116, start: '2019-01-03', end: '2021-01-03', note: 'Democratic majority for the whole Congress.' }),
  Object.freeze({ party: 'D', congress: 117, start: '2021-01-03', end: '2023-01-03', note: 'Democratic majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 118, start: '2023-01-03', end: '2025-01-03', note: 'Republican majority for the whole Congress.' }),
  Object.freeze({ party: 'R', congress: 119, start: '2025-01-03', end: '2027-01-03', note: 'Republican majority. Later vacancies and Kevin Kiley’s 2026 switch to independent did not change control. He continued to caucus with the Republicans.' }),
]);

export const SENATE_CONTROL = Object.freeze([
  Object.freeze({ party: 'R', congress: 107, start: '2001-01-20', end: '2001-06-06', note: '50–50. Vice President Cheney’s vote gave Republicans the majority.' }),
  Object.freeze({ party: 'D', congress: 107, start: '2001-06-06', end: '2002-11-12', note: 'Jim Jeffords left the Republicans on June 6, 2001 and caucused with the Democrats.' }),
  Object.freeze({ party: 'R', congress: 107, start: '2002-11-12', end: '2003-01-03', note: 'James Talent (R) replaced Jean Carnahan (D). The Senate Historical Office dates the Republican seat majority to November 12, 2002. The Senate was out of session and did not reorganize before the next Congress.' }),
  Object.freeze({ party: 'R', congress: 108, start: '2003-01-03', end: '2005-01-03', note: '51 Republicans. Jim Jeffords caucused with the Democrats.' }),
  Object.freeze({ party: 'R', congress: 109, start: '2005-01-03', end: '2007-01-03', note: '55 Republicans. Jim Jeffords caucused with the Democrats.' }),
  Object.freeze({ party: 'D', congress: 110, start: '2007-01-03', end: '2009-01-03', note: '49 Democrats plus Joe Lieberman and Bernie Sanders, who caucused with the Democrats.' }),
  Object.freeze({ party: 'D', congress: 111, start: '2009-01-03', end: '2011-01-03', note: 'Democratic majority for the whole Congress, including the Specter switch and the Franken seating.' }),
  Object.freeze({ party: 'D', congress: 112, start: '2011-01-03', end: '2013-01-03', note: '51 Democrats plus two independents who caucused with them.' }),
  Object.freeze({ party: 'D', congress: 113, start: '2013-01-03', end: '2015-01-03', note: 'Democratic majority. A short New Jersey vacancy did not change it.' }),
  Object.freeze({ party: 'R', congress: 114, start: '2015-01-03', end: '2017-01-03', note: '54 Republicans. Two independents caucused with the Democrats.' }),
  Object.freeze({ party: 'R', congress: 115, start: '2017-01-03', end: '2019-01-03', note: 'Republican majority. Doug Jones’s 2018 seating did not change it.' }),
  Object.freeze({ party: 'R', congress: 116, start: '2019-01-03', end: '2021-01-03', note: '53 Republicans. Angus King and Bernie Sanders caucused with the Democrats.' }),
  Object.freeze({ party: 'R', congress: 117, start: '2021-01-03', end: '2021-01-20', note: '51 Republicans, 46 Democrats, two independents caucusing with Democrats, and one vacant Georgia seat until the runoff winners were sworn in.' }),
  Object.freeze({ party: 'D', congress: 117, start: '2021-01-20', end: '2023-01-03', note: '50–50 after Jon Ossoff and Raphael Warnock were sworn in. Vice President Harris’s vote gave Democrats the majority.' }),
  Object.freeze({ party: 'D', congress: 118, start: '2023-01-03', end: '2025-01-03', note: 'Democrats plus independents who caucused with them: Angus King, Bernie Sanders, Kyrsten Sinema, and later Joe Manchin.' }),
  Object.freeze({ party: 'R', congress: 119, start: '2025-01-03', end: '2027-01-03', note: 'Republican majority. Brief vacancies at the start, and later resignations, did not change it. Angus King and Bernie Sanders caucus with the Democrats.' }),
]);

export const PARTY_SERIES = Object.freeze([
  Object.freeze({ id: 'SPY', label: 'S&P 500', group: 'market', since: '1993-01-29' }),
  Object.freeze({ id: 'QQQ', label: 'Nasdaq-100', group: 'market', since: '1999-03-10' }),
  Object.freeze({ id: 'DIA', label: 'Dow 30', group: 'market', since: '1998-01-20' }),
  Object.freeze({ id: 'IWM', label: 'Russell 2000', group: 'market', since: '2000-05-22' }),
  Object.freeze({ id: 'XLK', label: 'Technology', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLF', label: 'Financials', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLV', label: 'Health care', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLE', label: 'Energy', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLI', label: 'Industrials', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLY', label: 'Consumer discretionary', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLP', label: 'Consumer staples', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLB', label: 'Materials', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLU', label: 'Utilities', group: 'sector', since: '1998-12-16' }),
  Object.freeze({ id: 'XLRE', label: 'Real estate', group: 'sector', since: '2015-10-08' }),
  Object.freeze({ id: 'XLC', label: 'Communication services', group: 'sector', since: '2018-06-19' }),
]);

const OFFICES = Object.freeze([
  Object.freeze({ id: 'president', label: 'President', segments: PRESIDENT_CONTROL }),
  Object.freeze({ id: 'house', label: 'House', segments: HOUSE_CONTROL }),
  Object.freeze({ id: 'senate', label: 'Senate', segments: SENATE_CONTROL }),
]);

const SOURCES = Object.freeze([
  Object.freeze({ name: 'U.S. Senate Historical Office, Party Division', url: 'https://www.senate.gov/history/partydiv.htm' }),
  Object.freeze({ name: 'U.S. House of Representatives, Party Divisions of the House of Representatives', url: 'https://history.house.gov/institution/party-divisions/party-divisions/' }),
  Object.freeze({ name: 'Yahoo Finance adjusted closes for the listed ETFs', url: 'https://finance.yahoo.com/quote/SPY/history/' }),
]);

const METHODOLOGY = Object.freeze([
  'The window starts at George W. Bush’s inauguration on January 20, 2001, so the presidency, the House, and the Senate are compared over the same stretch of days. It runs through the latest S&P 500 session. The current term stays open until its scheduled end.',
  'Each session’s close-to-close return belongs to the party in office at that close. A new president is credited from Inauguration Day. A new Congress is credited from January 3. The return on a handover day includes the gap from the previous close.',
  'The headline is the annualized return. Total return and years sit beside it, so a party that held power longer is not treated as better just for serving more time.',
  'The market is SPY, the S&P 500 ETF. Figures use Yahoo adjusted closes, so splits and cash dividends are in the return. Fund expenses are already in the price. Nothing here is adjusted for inflation.',
  'Sector returns use SPDR sector ETFs. Real estate starts in October 2015 and communication services in June 2018. Their comparison with the S&P 500 uses only the days that ETF existed.',
  'A 50–50 Senate counts for the party of the vice president who breaks the tie. Independents who caucused with a party count with that party.',
  'The Senate Historical Office dates Jim Jeffords’s switch to June 6, 2001, and a Republican seat majority to November 12, 2002, even though the Senate did not reorganize before the next Congress.',
  'Republicans kept the Senate from January 3 to January 20, 2021. Democrats took the majority the day Jon Ossoff, Raphael Warnock, and Vice President Harris were sworn in.',
  'This is a record of what prices did. It covers seven presidential terms across five presidencies and thirteen Congresses. The 2008, 2020, and 2022 declines move the averages. It does not show that a party caused the return.',
]);

export function partyName(party) {
  if (party === 'D') return 'Democratic';
  if (party === 'R') return 'Republican';
  return '';
}

export function nextDay(iso) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
}

export function partyOn(segments, date) {
  for (const seg of segments) {
    if (date >= seg.start && date < seg.end) return seg;
  }
  return null;
}

export function controlGaps(segments, from, to) {
  const rows = segments
    .map((seg) => ({ start: seg.start > from ? seg.start : from, end: seg.end < to ? seg.end : to }))
    .filter((seg) => seg.end > seg.start)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const problems = [];
  let cursor = from;
  for (const seg of rows) {
    if (seg.start > cursor) problems.push({ kind: 'gap', start: cursor, end: seg.start });
    if (seg.start < cursor) problems.push({ kind: 'overlap', start: seg.start, end: cursor });
    if (seg.end > cursor) cursor = seg.end;
  }
  if (cursor < to) problems.push({ kind: 'gap', start: cursor, end: to });
  return problems;
}

export function cleanAdjustedBars(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = row?.t;
    const v = Number(row?.v);
    if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t) || !(v > 0)) continue;
    map.set(t, v);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([t, v]) => ({ t, v }));
}

export function barsFromChart(result) {
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  let adjusted = 0;
  let closeOnly = 0;
  const rows = [];
  for (const quote of quotes) {
    if (!quote?.date) continue;
    const hasAdj = quote.adjclose != null || quote.adjClose != null;
    const raw = hasAdj ? (quote.adjclose ?? quote.adjClose) : quote.close;
    if (hasAdj) adjusted += 1;
    else if (quote.close != null) closeOnly += 1;
    const t = new Date(quote.date).toISOString().slice(0, 10);
    rows.push({ t, v: Number(raw) });
  }
  return { rows: cleanAdjustedBars(rows), adjusted, closeOnly };
}

function etParts(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Yahoo returns the session in progress as the last daily bar. Before the
// 16:00 ET close that bar is not a close, so it is dropped.
export function dropOpenSession(rows, builtAtIso) {
  const list = Array.isArray(rows) ? rows : [];
  const et = etParts(builtAtIso);
  if (!et || !list.length) return list;
  const last = list.at(-1);
  if (last?.t === et.date && et.minutes < 16 * 60) return list.slice(0, -1);
  return list;
}

export function historyProblem(bars, studyStart = STUDY_START) {
  if (!bars.length || !(bars[0].t < studyStart)) return 'S&P 500 history does not reach back before Bush’s inauguration, so party returns were not computed.';
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t < studyStart) continue;
    if (dayCount(bars[i - 1].t, bars[i].t) > MAX_SESSION_GAP_DAYS) {
      return `S&P 500 history is missing sessions between ${bars[i - 1].t} and ${bars[i].t}, so party returns were not computed.`;
    }
  }
  return null;
}

function sessionReturns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].v;
    const cur = bars[i].v;
    if (!(prev > 0) || !(cur > 0)) continue;
    out.push({ t: bars[i].t, r: cur / prev - 1 });
  }
  return out;
}

function round(n, digits = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function dayCount(start, end) {
  return (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY_MS;
}

function compoundMoves(rows, days) {
  let growth = 1;
  let up = 0;
  let peak = 1;
  let level = 1;
  let maxDd = 0;
  let sessions = 0;
  for (const row of rows) {
    const next = 1 + row.r;
    if (!(next > 0)) continue;
    growth *= next;
    level *= next;
    if (level > peak) peak = level;
    const dd = level / peak - 1;
    if (dd < maxDd) maxDd = dd;
    if (row.r > 0) up += 1;
    sessions += 1;
  }
  const years = days / YEAR_DAYS;
  const totalPct = sessions ? (growth - 1) * 100 : null;
  const annPct = sessions && years > 0 && growth > 0 ? (growth ** (1 / years) - 1) * 100 : null;
  return {
    totalPct: round(totalPct),
    annPct: round(annPct),
    sessions,
    years: round(years, 2),
    maxDrawdownPct: sessions ? round(maxDd * 100) : null,
    upDayPct: sessions ? round((up / sessions) * 100, 1) : null,
  };
}

function partyStats(returns, segments, party, from, to) {
  const rows = [];
  for (const row of returns) {
    if (row.t < from || row.t >= to) continue;
    const seg = partyOn(segments, row.t);
    if (seg?.party === party) rows.push(row);
  }
  let days = 0;
  for (const seg of segments) {
    if (seg.party !== party) continue;
    const start = seg.start > from ? seg.start : from;
    const end = seg.end < to ? seg.end : to;
    if (end > start) days += dayCount(start, end);
  }
  return compoundMoves(rows, days);
}

function growthCurve(returns, segments, party, from, to) {
  const byMonth = new Map();
  let level = 1;
  for (const row of returns) {
    if (row.t < from || row.t >= to) continue;
    const seg = partyOn(segments, row.t);
    if (seg?.party !== party) continue;
    level *= 1 + row.r;
    byMonth.set(row.t.slice(0, 7), { t: row.t, level: round(level, 4) });
  }
  const points = [...byMonth.values()];
  if (!points.length || points[0].level !== 1) points.unshift({ t: from, level: 1 });
  return points;
}

function ordinal(n) {
  const v = n % 100;
  const suffix = v % 10 === 1 && v !== 11 ? 'st' : v % 10 === 2 && v !== 12 ? 'nd' : v % 10 === 3 && v !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function slicesBetween(from, to) {
  const cuts = new Set([from, to]);
  for (const office of OFFICES) {
    for (const seg of office.segments) {
      if (seg.start > from && seg.start < to) cuts.add(seg.start);
      if (seg.end > from && seg.end < to) cuts.add(seg.end);
    }
  }
  const dates = [...cuts].sort();
  const out = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const start = dates[i];
    const end = dates[i + 1];
    const president = partyOn(PRESIDENT_CONTROL, start);
    const house = partyOn(HOUSE_CONTROL, start);
    const senate = partyOn(SENATE_CONTROL, start);
    if (!president || !house || !senate) continue;
    const alignment = president.party === house.party && house.party === senate.party ? 'unified' : 'divided';
    const prev = out.at(-1);
    if (prev && prev.end === start && prev.president === president.party && prev.house === house.party && prev.senate === senate.party) {
      prev.end = end;
      continue;
    }
    out.push({
      start,
      end,
      president: president.party,
      presidentName: president.name,
      house: house.party,
      houseCongress: house.congress,
      senate: senate.party,
      senateCongress: senate.congress,
      alignment,
    });
  }
  return out;
}

function sliceStats(returns, slices, accept, from, to) {
  const rows = [];
  let index = 0;
  for (const row of returns) {
    if (row.t < from || row.t >= to) continue;
    while (index < slices.length && slices[index].end <= row.t) index += 1;
    const slice = slices[index];
    if (!slice || row.t < slice.start || row.t >= slice.end || !accept(slice)) continue;
    rows.push(row);
  }
  let days = 0;
  for (const slice of slices) {
    if (!accept(slice)) continue;
    const start = slice.start > from ? slice.start : from;
    const end = slice.end < to ? slice.end : to;
    if (end > start) days += dayCount(start, end);
  }
  return compoundMoves(rows, days);
}

function leaderOf(dem, rep) {
  if (dem?.annPct == null || rep?.annPct == null) return null;
  const gap = dem.annPct - rep.annPct;
  if (Math.abs(gap) < 0.05) return 'tie';
  return gap > 0 ? 'D' : 'R';
}

function fmtPct(n) {
  if (n == null) return 'n/a';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function controlPhrase(label) {
  return label === 'President' ? 'presidential' : label;
}

function officeRead(label, dem, rep) {
  const phrase = controlPhrase(label);
  if (dem.annPct == null || rep.annPct == null) return `Not enough S&P 500 history to compare ${phrase} control.`;
  const gap = dem.annPct - rep.annPct;
  if (Math.abs(gap) < 0.05) {
    return `Democratic and Republican ${phrase} periods compounded at the same annualized rate in this sample, ${fmtPct(dem.annPct)} a year.`;
  }
  const leader = gap > 0 ? 'Democratic' : 'Republican';
  const lead = gap > 0 ? dem : rep;
  const trail = gap > 0 ? rep : dem;
  const other = gap > 0 ? 'Republican' : 'Democratic';
  return `${leader} ${phrase} periods compounded at ${fmtPct(lead.annPct)} a year, versus ${fmtPct(trail.annPct)} under ${other} control. The gap is ${Math.abs(gap).toFixed(1)} points a year across ${lead.years.toFixed(1)} years.`;
}

function excessPhrase(n) {
  if (n == null) return 'no S&P comparison';
  if (Math.abs(n) < 0.05) return 'in line with the S&P 500';
  const points = `${Math.abs(n).toFixed(1)} points ${n > 0 ? 'ahead of' : 'behind'} the S&P 500`;
  return points;
}

function sectorSentence(row, officeLabel, cell) {
  if (!row || cell.D.annPct == null || cell.R.annPct == null) return `${officeLabel} comparison is unavailable for this sector.`;
  const partial = row.partial ? ` History for this ETF starts ${row.firstDate}, so both sides use only the overlapping days.` : '';
  return `${row.label} compounded at ${fmtPct(cell.D.annPct)} a year under Democratic ${controlPhrase(officeLabel)} control and ${fmtPct(cell.R.annPct)} under Republican control. On those same days that is ${excessPhrase(cell.D.excessAnnPct)} under Democrats and ${excessPhrase(cell.R.excessAnnPct)} under Republicans.${partial}`;
}

// Funds with a shorter history are left out: their gap covers different years.
function widestSentence(rows, officeId, officeLabel) {
  const phrase = controlPhrase(officeLabel);
  const comparable = rows.filter((row) => row.group === 'sector' && !row.partial && row.offices[officeId].D.annPct != null && row.offices[officeId].R.annPct != null);
  if (!comparable.length) return '';
  let dem = null;
  let rep = null;
  for (const row of comparable) {
    const gap = row.offices[officeId].gapAnnPct;
    if (dem == null || gap > dem.gap) dem = { label: row.label, gap };
    if (rep == null || gap < rep.gap) rep = { label: row.label, gap };
  }
  if (dem.gap > 0.05 && rep.gap < -0.05) {
    return `${dem.label} had the largest Democratic edge under ${phrase} control, ${dem.gap.toFixed(1)} points a year. ${rep.label} had the largest Republican edge, ${Math.abs(rep.gap).toFixed(1)} points a year.`;
  }
  if (dem.gap > 0.05) {
    return `Every comparable sector compounded faster under Democratic ${phrase} control. The widest gap was ${dem.label} at ${dem.gap.toFixed(1)} points a year.`;
  }
  if (rep.gap < -0.05) {
    return `Every comparable sector compounded faster under Republican ${phrase} control. The widest gap was ${rep.label} at ${Math.abs(rep.gap).toFixed(1)} points a year.`;
  }
  return `Sector gaps under ${phrase} control are within a tenth of a point a year in this sample.`;
}

function rangeStats(returns, start, end) {
  const rows = returns.filter((row) => row.t >= start && row.t < end);
  return compoundMoves(rows, dayCount(start, end));
}

function heldStats(returns, start, end) {
  const rows = returns.filter((row) => row.t >= start && row.t < end);
  if (!rows.length) return { ...compoundMoves([], 0), partial: false };
  const heldStart = rows[0].t > start ? rows[0].t : start;
  return { ...compoundMoves(rows, dayCount(heldStart, end)), partial: dayCount(start, rows[0].t) > 30, firstDate: rows[0].t };
}

function indexPath(bars, start, end) {
  let base = null;
  const inside = [];
  for (const bar of bars) {
    if (bar.t < start) base = bar.v;
    else if (bar.t < end) inside.push(bar);
  }
  if (!(base > 0) || !inside.length) return [];
  const byMonth = new Map();
  for (const bar of inside) byMonth.set(bar.t.slice(0, 7), bar);
  byMonth.set(inside.at(-1).t.slice(0, 7), inside.at(-1));
  return [...byMonth.values()].map((bar) => {
    const president = partyOn(PRESIDENT_CONTROL, bar.t);
    const house = partyOn(HOUSE_CONTROL, bar.t);
    const senate = partyOn(SENATE_CONTROL, bar.t);
    return {
      t: bar.t,
      level: round(bar.v / base, 4),
      president: president?.party || '',
      house: house?.party || '',
      senate: senate?.party || '',
    };
  });
}

function windowRows(returnsOf, start, end) {
  const rows = [];
  for (const def of PARTY_SERIES) {
    if (def.id === 'SPY') continue;
    const seriesReturns = returnsOf[def.id];
    if (!seriesReturns) continue;
    const stats = heldStats(seriesReturns, start, end);
    if (!stats.sessions) continue;
    const heldStart = stats.firstDate > start ? stats.firstDate : start;
    const dates = new Set(seriesReturns.filter((row) => row.t >= heldStart && row.t < end).map((row) => row.t));
    const aligned = returnsOnDates((returnsOf.SPY || []).filter((row) => row.t >= heldStart && row.t < end), dates);
    const spyAligned = compoundMoves(aligned, dayCount(heldStart, end));
    rows.push({
      id: def.id,
      label: def.label,
      group: def.group,
      partial: stats.partial,
      firstDate: stats.firstDate,
      totalPct: stats.totalPct,
      annPct: stats.annPct,
      excessAnnPct: stats.annPct != null && spyAligned.annPct != null ? round(stats.annPct - spyAligned.annPct) : null,
      excessTotalPct: stats.totalPct != null && spyAligned.totalPct != null ? round(stats.totalPct - spyAligned.totalPct) : null,
      sessions: stats.sessions,
      years: stats.years,
    });
  }
  return rows;
}

export function sortPartyRows(rows, { key = 'name', dir = 'asc', office = 'president' } = {}) {
  const sign = dir === 'asc' ? 1 : -1;
  const read = (row) => {
    if (key === 'name') return row.label;
    if (key === 'total') return row.totalPct;
    if (key === 'ann') return row.annPct;
    if (key === 'excess') return row.excessAnnPct;
    const cell = row.offices?.[office];
    if (!cell) return null;
    if (key === 'D') return cell.D?.annPct ?? null;
    if (key === 'R') return cell.R?.annPct ?? null;
    if (key === 'gap') return cell.gapAnnPct ?? null;
    return null;
  };
  return [...(rows || [])].sort((a, b) => {
    const av = read(a);
    const bv = read(b);
    if (key === 'name') return sign * String(av ?? '').localeCompare(String(bv ?? ''));
    if (av == null && bv == null) return String(a.label).localeCompare(String(b.label));
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return String(a.label).localeCompare(String(b.label));
    return (av - bv) * sign;
  });
}

function stretchId(name, start) {
  return `${String(name || 'stretch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${start.slice(0, 4)}`;
}

function measuredSpan(seg, from, to) {
  const start = seg.start > from ? seg.start : from;
  const end = seg.end < to ? seg.end : to;
  if (end <= start) return null;
  return { start, end, open: seg.end > to };
}

function returnsOnDates(source, dates) {
  const out = [];
  for (const row of source) if (dates.has(row.t)) out.push(row);
  return out;
}

export function emptyPartyTracker(builtAtIso, message) {
  return {
    version: PARTY_TRACKER_VERSION,
    builtAtIso,
    error: message,
    offices: [],
    rows: [],
    timeline: [],
    periods: [],
    methodology: [...METHODOLOGY],
    sources: SOURCES.map((source) => ({ ...source })),
  };
}

export function refreshReady(data) {
  return !!(data && data.version === PARTY_TRACKER_VERSION && !data.error && Array.isArray(data.offices) && data.offices.length === 3 && data.asOf);
}

export function priorPartyTrackerUsable(prior) {
  return !!(prior && prior.version === PARTY_TRACKER_VERSION && prior.asOf && Array.isArray(prior.offices) && prior.offices.length === 3);
}

export function buildPartyTracker({ series, builtAtIso, studyStart = STUDY_START } = {}) {
  const spyBars = cleanAdjustedBars(series?.SPY);
  const spyReturns = sessionReturns(spyBars);
  const problem = historyProblem(spyBars, studyStart);
  if (problem) return emptyPartyTracker(builtAtIso, problem);
  const asOf = spyBars.at(-1).t;
  if (asOf < studyStart) return emptyPartyTracker(builtAtIso, 'S&P 500 history ends before Bush’s inauguration, so party returns were not computed.');
  const from = studyStart;
  const to = nextDay(asOf);
  const marketReturns = spyReturns.filter((row) => row.t >= from && row.t < to);
  const slices = slicesBetween(from, to);

  const offices = OFFICES.map((office) => {
    const dem = partyStats(marketReturns, office.segments, 'D', from, to);
    const rep = partyStats(marketReturns, office.segments, 'R', from, to);
    return {
      id: office.id,
      label: office.label,
      parties: { D: dem, R: rep },
      leader: leaderOf(dem, rep),
      gapAnnPct: dem.annPct != null && rep.annPct != null ? round(dem.annPct - rep.annPct) : null,
      read: officeRead(office.label, dem, rep),
    };
  });

  const curves = {};
  for (const office of OFFICES) {
    curves[office.id] = {
      D: growthCurve(marketReturns, office.segments, 'D', from, to),
      R: growthCurve(marketReturns, office.segments, 'R', from, to),
    };
  }

  const government = {
    unifiedD: sliceStats(marketReturns, slices, (slice) => slice.alignment === 'unified' && slice.president === 'D', from, to),
    unifiedR: sliceStats(marketReturns, slices, (slice) => slice.alignment === 'unified' && slice.president === 'R', from, to),
    divided: sliceStats(marketReturns, slices, (slice) => slice.alignment === 'divided', from, to),
    bothChambersD: sliceStats(marketReturns, slices, (slice) => slice.house === 'D' && slice.senate === 'D', from, to),
    bothChambersR: sliceStats(marketReturns, slices, (slice) => slice.house === 'R' && slice.senate === 'R', from, to),
    splitChambers: sliceStats(marketReturns, slices, (slice) => slice.house !== slice.senate, from, to),
  };

  const rows = [];
  for (const def of PARTY_SERIES) {
    if (def.id === 'SPY') continue;
    const bars = cleanAdjustedBars(series?.[def.id]);
    const returns = sessionReturns(bars).filter((row) => row.t >= from && row.t < to);
    if (returns.length < 2) continue;
    const firstDate = returns[0].t;
    const partial = dayCount(studyStart, firstDate) > 180;
    const dates = new Set(returns.map((row) => row.t));
    const alignedSpy = returnsOnDates(marketReturns, dates);
    const officesForRow = {};
    for (const office of OFFICES) {
      const sectorFrom = firstDate > from ? firstDate : from;
      const dem = partyStats(returns, office.segments, 'D', sectorFrom, to);
      const rep = partyStats(returns, office.segments, 'R', sectorFrom, to);
      const spyDem = partyStats(alignedSpy, office.segments, 'D', sectorFrom, to);
      const spyRep = partyStats(alignedSpy, office.segments, 'R', sectorFrom, to);
      dem.excessAnnPct = dem.annPct != null && spyDem.annPct != null ? round(dem.annPct - spyDem.annPct) : null;
      rep.excessAnnPct = rep.annPct != null && spyRep.annPct != null ? round(rep.annPct - spyRep.annPct) : null;
      officesForRow[office.id] = {
        D: dem,
        R: rep,
        leader: leaderOf(dem, rep),
        gapAnnPct: dem.annPct != null && rep.annPct != null ? round(dem.annPct - rep.annPct) : null,
      };
    }
    rows.push({
      id: def.id,
      label: def.label,
      group: def.group,
      since: def.since,
      firstDate,
      lastDate: returns.at(-1).t,
      partial,
      offices: officesForRow,
    });
  }

  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  const highlights = {};
  for (const office of OFFICES) {
    highlights[office.id] = {
      health: sectorSentence(byId.XLV, office.label, byId.XLV ? byId.XLV.offices[office.id] : { D: {}, R: {} }),
      energy: sectorSentence(byId.XLE, office.label, byId.XLE ? byId.XLE.offices[office.id] : { D: {}, R: {} }),
      widest: widestSentence(rows, office.id, office.label),
    };
    const officeRow = offices.find((item) => item.id === office.id);
    officeRow.sectorRead = highlights[office.id].widest;
  }

  const returnsOf = { SPY: marketReturns };
  for (const def of PARTY_SERIES) {
    if (def.id === 'SPY') continue;
    const bars = cleanAdjustedBars(series?.[def.id]);
    returnsOf[def.id] = sessionReturns(bars).filter((row) => row.t < to);
  }
  const timeline = [];
  for (const term of PRESIDENT_CONTROL) {
    const span = measuredSpan(term, from, to);
    if (!span) continue;
    const stats = rangeStats(marketReturns, span.start, span.end);
    const id = stretchId(term.name, span.start);
    const chapters = slices.filter((slice) => slice.presidentName === term.name && slice.start >= span.start && slice.end <= span.end && slice.president === term.party)
      .map((slice) => {
        const statsForSlice = rangeStats(marketReturns, slice.start, slice.end);
        return {
          id: `${id}-${slice.start}`,
          start: slice.start,
          end: slice.end > asOf ? asOf : slice.end,
          measureEnd: slice.end,
          house: slice.house,
          houseCongress: slice.houseCongress,
          senate: slice.senate,
          senateCongress: slice.senateCongress,
          alignment: slice.alignment,
          totalPct: statsForSlice.totalPct,
          annPct: statsForSlice.annPct,
          years: statsForSlice.years,
          path: indexPath(spyBars, slice.start, slice.end),
          sectors: windowRows(returnsOf, slice.start, slice.end),
        };
      });
    timeline.push({
      id,
      name: term.name,
      party: term.party,
      start: span.start,
      end: span.open ? asOf : span.end,
      open: span.open,
      totalPct: stats.totalPct,
      annPct: stats.annPct,
      years: stats.years,
      path: indexPath(spyBars, span.start, span.end),
      sectors: windowRows(returnsOf, span.start, span.end),
      chapters,
    });
  }

  const periods = [];
  for (const office of OFFICES) {
    for (const seg of office.segments) {
      const span = measuredSpan(seg, from, to);
      if (!span) continue;
      const stats = rangeStats(marketReturns, span.start, span.end);
      const who = office.id === 'president' ? seg.name : `${ordinal(seg.congress)} Congress`;
      periods.push({
        office: office.id,
        label: who,
        party: seg.party,
        start: span.start,
        end: span.open ? asOf : span.end,
        open: span.open,
        note: seg.note || '',
        totalPct: stats.totalPct,
        annPct: stats.annPct,
        years: stats.years,
        sessions: stats.sessions,
      });
    }
  }

  const president = partyOn(PRESIDENT_CONTROL, asOf);
  const house = partyOn(HOUSE_CONTROL, asOf);
  const senate = partyOn(SENATE_CONTROL, asOf);
  const alignment = president && house && senate && president.party === house.party && house.party === senate.party ? 'unified' : 'divided';
  const current = president && house && senate ? {
    asOf,
    president: { party: president.party, name: president.name },
    house: { party: house.party, congress: house.congress },
    senate: { party: senate.party, congress: senate.congress },
    alignment,
    read: `As of ${asOf}, ${president.name} (${partyName(president.party)}) is president. The House is ${partyName(house.party)} (${ordinal(house.congress)} Congress) and the Senate is ${partyName(senate.party)} (${ordinal(senate.congress)} Congress). ${alignment === 'unified' ? 'One party holds the presidency and both chambers.' : 'Control is split across the presidency, the House, and the Senate.'}`,
  } : null;

  return {
    version: PARTY_TRACKER_VERSION,
    builtAtIso,
    asOf,
    window: { start: from, end: asOf, open: true, requestedStart: studyStart },
    market: { id: 'SPY', label: 'S&P 500' },
    current,
    caveat: 'These figures are what the market did while each party held the office. They do not show that the party caused the result.',
    path: indexPath(spyBars, from, to),
    offices,
    government,
    curves,
    rows,
    highlights,
    timeline,
    periods,
    coverage: PARTY_SERIES.filter((def) => cleanAdjustedBars(series?.[def.id]).length).map((def) => {
      const bars = cleanAdjustedBars(series[def.id]);
      return { id: def.id, label: def.label, firstDate: bars[0].t, lastDate: bars.at(-1).t, sessions: Math.max(0, bars.length - 1) };
    }),
    errors: [],
    methodology: [...METHODOLOGY],
    sources: SOURCES.map((source) => ({ ...source })),
  };
}

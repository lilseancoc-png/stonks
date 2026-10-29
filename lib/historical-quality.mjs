// Data checks for the long-history cache behind Historical Data, Pattern lab
// and the Bottom tracker. Deterministic and offline: the cached rows, the
// collector's per-source records and the dated lists in code go in; a list of
// named checks comes out. Nothing here changes a study, a grade or a pick.
//
// Date labels get two independent tests. From 1990 every cached close must sit
// on an NYSE session and every session must have a close. And SPY must move
// with the S&P 500 index on the same day: a one-day label shift makes the
// next-day comparison agree better than the same-day one.
import { isHistoricalTradingDate } from './historical-market-calendar.mjs';
import { HISTORICAL_MARKETS, HISTORICAL_EVENT_MARKETS, HISTORICAL_CONTEXT } from './historical-sources.mjs';
import { EVENT_CATEGORIES, FOMC_DECISIONS, FOMC_RATE_CHANGES, FOMC_RATE_CHANGES_CHECKED, WWDC_KEYNOTES, fomcOutcomes, fomcOutcomeFromDff } from './historical-events.mjs';

export const QUALITY_VERSION = 1;
const DAY = 86400000;
const CALENDAR_START = '1990-01-01';
// A close-to-close move this large in a broad fund or index is a bad print
// until shown otherwise. Single stocks and volatility funds are left out.
const JUMP_LIMIT = { index: 0.25, fund: 0.25 };
const JUMP_EXEMPT = new Set(['GME', 'UNG', 'USO']);
// One-day moves over 25% checked against the news and left as real. Silver's
// 2026-01-30 crash (its worst day since 1980) is the only one in the fund set
// as of the 2026-10-28 audit.
const VERIFIED_MOVES = Object.freeze({ SLV: ['2026-01-30'] });
const ms = t => Date.parse(`${t}T00:00:00Z`);
const key = n => new Date(n).toISOString().slice(0, 10);
const round = (n, d = 4) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null;
function corr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 30) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : null;
}
const check = (id, area, status, title, detail, extra = {}) => ({ id, area, status, title, detail, ...extra });

// Sessions from max(first close, 1990) to the last close with no close, and
// closes dated on a day the NYSE was shut.
export function sessionGaps(bars) {
  if (!bars?.length) return { missing: [], offCalendar: [] };
  const have = new Set(bars.map(b => b.t)), missing = [];
  const from = bars[0].t > CALENDAR_START ? bars[0].t : CALENDAR_START, to = bars.at(-1).t;
  for (let t = ms(from); t <= ms(to); t += DAY) { const d = key(t); if (isHistoricalTradingDate(d) && !have.has(d)) missing.push(d); }
  return { missing, offCalendar: bars.filter(b => b.t >= CALENDAR_START && !isHistoricalTradingDate(b.t)).map(b => b.t) };
}

function returnsByDate(bars) {
  const out = new Map();
  for (let i = 1; i < bars.length; i++) out.set(bars[i].t, { r: bars[i].c / bars[i - 1].c - 1, prev: bars[i - 1].t });
  return out;
}
// Same-day agreement between two close series, plus the one-day-shifted
// agreement in both directions. Days whose prior close differs between the
// two series (a missing session in one) are skipped.
export function labelAgreement(a, b) {
  const ra = returnsByDate(a), rb = returnsByDate(b), dates = [...ra.keys()].filter(t => rb.has(t) && ra.get(t).prev === rb.get(t).prev).sort();
  const same = [dates.map(t => ra.get(t).r), dates.map(t => rb.get(t).r)];
  const bDates = [...rb.keys()].sort(), next = new Map(bDates.slice(0, -1).map((t, i) => [t, bDates[i + 1]])), prev = new Map(bDates.slice(1).map((t, i) => [t, bDates[i]]));
  const shifted = map => { const xs = [], ys = []; for (const t of ra.keys()) { const u = map.get(t); if (u && rb.has(u)) { xs.push(ra.get(t).r); ys.push(rb.get(u).r); } } return corr(xs, ys); };
  const diffs = dates.map((t, i) => Math.abs(same[0][i] - same[1][i]));
  return { n: dates.length, from: dates[0] || null, to: dates.at(-1) || null, sameDay: round(corr(...same)), aheadOne: round(shifted(next)), behindOne: round(shifted(prev)), bigDiffDays: diffs.filter(d => d > 0.01).length, bigDiffSample: dates.filter((_, i) => diffs[i] > 0.01).slice(-5) };
}

export function buildQualityChecks({ symbols = {}, records = {}, context = {}, releases = {}, cutoff } = {}) {
  const out = [];
  const markets = [...HISTORICAL_MARKETS, ...HISTORICAL_EVENT_MARKETS];
  // 1. Calendar and coverage, per market.
  for (const def of markets) {
    const bars = symbols[def.id] || [], rec = records[def.id] || {};
    if (!bars.length) { out.push(check(`calendar-${def.id}`, 'Market closes', 'fail', `${def.id} closes`, 'No cached closes.')); continue; }
    const { missing, offCalendar } = sessionGaps(bars);
    const dropped = Number(rec.offCalendarRows) || 0;
    const status = offCalendar.length || dropped > 5 ? 'fail' : missing.length > 3 ? 'warn' : 'pass';
    const since = bars[0].t, years = round((ms(bars.at(-1).t) - ms(since)) / (365.2425 * DAY), 1);
    out.push(check(`calendar-${def.id}`, 'Market closes', status, `${def.id} closes`,
      `${bars.length.toLocaleString('en-US')} closes ${since} to ${bars.at(-1).t} (${years} years). ` +
      (missing.length ? `${missing.length} NYSE session${missing.length === 1 ? '' : 's'} since ${since > CALENDAR_START ? since : CALENDAR_START} without a close (latest ${missing.slice(-3).join(', ')}). ` : 'Every NYSE session since ' + (since > CALENDAR_START ? since : CALENDAR_START) + ' has a close. ') +
      (offCalendar.length ? `${offCalendar.length} closes dated on market holidays or weekends (${offCalendar.slice(-3).join(', ')}).` : '') +
      (dropped ? `The last download had ${dropped} row${dropped === 1 ? '' : 's'} dated off the NYSE calendar, removed before caching${rec.offCalendarSample?.length ? ` (${rec.offCalendarSample.join(', ')})` : ''}.` : ''),
      { firstDate: since, lastDate: bars.at(-1).t, years, missingSessions: missing.length, offCalendar: offCalendar.length + dropped }));
    // Bad prints.
    if (!JUMP_EXEMPT.has(def.id) && def.group !== 'Event studies') {
      const jumps = [];
      for (let i = 1; i < bars.length; i++) { const r = bars[i].c / bars[i - 1].c - 1; if (Math.abs(r) > (def.long ? JUMP_LIMIT.index : JUMP_LIMIT.fund) && !(VERIFIED_MOVES[def.id] || []).includes(bars[i].t)) jumps.push(`${bars[i].t} ${(r * 100).toFixed(1)}%`); }
      if (jumps.length) out.push(check(`jump-${def.id}`, 'Market closes', 'warn', `${def.id} one-day jumps over 25%`, `${jumps.length}: ${jumps.slice(-4).join(', ')}. Not yet checked against a second source; a bad print would distort every study window that holds it.`));
    }
  }
  // 2. Date labels: SPY against the S&P 500 index, same day vs shifted.
  const spy = symbols.SPY || [], spx = symbols['^GSPC'] || [];
  if (spy.length > 300 && spx.length > 300) {
    const a = labelAgreement(spy, spx);
    const shifted = Math.max(a.aheadOne ?? -1, a.behindOne ?? -1);
    const status = a.sameDay == null ? 'warn' : a.sameDay < 0.95 || shifted >= a.sameDay ? 'fail' : a.bigDiffDays > a.n * 0.01 ? 'warn' : 'pass';
    out.push(check('labels-spy-gspc', 'Date labels', status, 'SPY vs S&P 500 index, same-day moves',
      `${a.n.toLocaleString('en-US')} shared sessions ${a.from} to ${a.to}. Same-day correlation ${a.sameDay}; shifted one day ${a.aheadOne} and ${a.behindOne}. ${a.bigDiffDays} day${a.bigDiffDays === 1 ? '' : 's'} differ by more than 1 point${a.bigDiffSample.length ? ` (latest ${a.bigDiffSample.join(', ')})` : ''}. A few such days are normal (the fund's last trade vs the index's final print on fast days, SPY ex-dividend days); a date slip would show as a higher shifted correlation, and more than 1% of sessions is flagged.`, a));
  }
  const qqq = symbols.QQQ || [], ixic = symbols['^IXIC'] || [];
  if (qqq.length > 300 && ixic.length > 300) {
    const a = labelAgreement(qqq, ixic), shifted = Math.max(a.aheadOne ?? -1, a.behindOne ?? -1);
    out.push(check('labels-qqq-ixic', 'Date labels', a.sameDay == null ? 'warn' : a.sameDay < 0.9 || shifted >= a.sameDay ? 'fail' : 'pass', 'QQQ vs Nasdaq Composite, same-day moves', `${a.n.toLocaleString('en-US')} shared sessions. Same-day correlation ${a.sameDay}; shifted one day ${a.aheadOne} and ${a.behindOne}. Different indexes (Nasdaq-100 vs Composite), so a looser bar.`, a));
  }
  // 3. FRED series: observation dates and staleness.
  for (const def of HISTORICAL_CONTEXT) {
    const rows = context[def.id]?.rows || context[def.id] || [];
    if (!rows.length) { out.push(check(`fred-${def.id}`, 'Macro series', 'fail', `${def.id}`, 'No cached observations.')); continue; }
    const last = rows.at(-1).t, age = cutoff ? Math.floor((ms(cutoff) - ms(last)) / DAY) : null;
    const weekend = def.frequency === 'daily' ? rows.filter(r => [0, 6].includes(new Date(ms(r.t)).getUTCDay())).length : 0;
    const misdated = def.frequency === 'monthly' || def.frequency === 'quarterly' ? rows.filter(r => r.t.slice(8) !== '01').length : 0;
    const stale = age != null && age > def.lagDays;
    out.push(check(`fred-${def.id}`, 'Macro series', weekend || misdated ? 'fail' : stale ? 'warn' : 'pass', `${def.id} · ${def.label}`,
      `${rows.length.toLocaleString('en-US')} observations ${rows[0].t} to ${last}${age != null ? `, ${age} days before the cutoff (allowed ${def.lagDays})` : ''}.` + (weekend ? ` ${weekend} daily observations dated on weekends.` : '') + (misdated ? ` ${misdated} ${def.frequency} observations not dated on the 1st of the period.` : '')));
  }
  // 4. Dated lists in code.
  const fomcBad = FOMC_DECISIONS.filter(d => !isHistoricalTradingDate(d));
  const fomcDup = FOMC_DECISIONS.length - new Set(FOMC_DECISIONS).size;
  const sorted = FOMC_DECISIONS.every((d, i) => !i || FOMC_DECISIONS[i - 1] < d);
  const perYear = {};
  for (const d of FOMC_DECISIONS) perYear[d.slice(0, 4)] = (perYear[d.slice(0, 4)] || 0) + 1;
  const oddYears = Object.entries(perYear).filter(([, n]) => n !== 8).map(([y, n]) => `${y}: ${n}`);
  out.push(check('list-fomc', 'Dated lists', fomcBad.length || fomcDup || !sorted ? 'fail' : 'pass', 'FOMC decision days', `${FOMC_DECISIONS.length} scheduled decisions ${FOMC_DECISIONS[0]} to ${FOMC_DECISIONS.at(-1)}, all on NYSE sessions${fomcBad.length ? ` except ${fomcBad.join(', ')}` : ''}${fomcDup ? `; ${fomcDup} duplicates` : ''}${sorted ? '' : '; out of order'}. Years without eight meetings: ${oddYears.join(', ') || 'none'} (2020 had its March meeting replaced by emergency moves).`));
  // Rate decisions: every listed change must be a weekday in order, and since
  // 2016 (when the effective rate tracks the target range closely) the
  // effective fed funds rate must agree with hike / cut / hold.
  const { byDate, intermeeting } = fomcOutcomes();
  const changeBad = FOMC_RATE_CHANGES.filter(([d], i) => [0, 6].includes(new Date(ms(d)).getUTCDay()) || (i && FOMC_RATE_CHANGES[i - 1][0] >= d)).map(([d]) => d);
  const dff = (context.DFF?.rows || context.DFF || []).filter(r => r && r.t);
  const disagree = [];
  let compared = 0;
  if (dff.length) for (const [d, o] of byDate) {
    if (d < '2016-01-01') continue;
    const est = fomcOutcomeFromDff(dff, d);
    if (!est) continue;
    compared++;
    if (est.type !== o.type) disagree.push(`${d} (list ${o.type}, rate ${est.type})`);
  }
  const counts = [...byDate.values()].reduce((m, o) => (m[o.type] = (m[o.type] || 0) + 1, m), {});
  out.push(check('list-fomc-rates', 'Dated lists', changeBad.length || disagree.length ? 'fail' : dff.length ? 'pass' : 'warn', 'FOMC hike, cut or hold',
    `${FOMC_RATE_CHANGES.length} target changes from the Fed's list, checked through ${FOMC_RATE_CHANGES_CHECKED}: ${counts.hike || 0} hikes, ${counts.cut || 0} cuts and ${counts.hold || 0} holds at scheduled decisions, plus ${intermeeting.length} intermeeting moves.` + (changeBad.length ? ` Weekend or out-of-order dates: ${changeBad.join(', ')}.` : '') + (dff.length ? ` Effective fed funds rate agrees on ${compared - disagree.length} of ${compared} decisions since 2016${disagree.length ? `; disagrees on ${disagree.join(', ')}` : ''}.` : ' The effective fed funds rate (DFF) is not cached, so the list was not cross-checked.')));
  const wwdcBad = WWDC_KEYNOTES.filter(d => !isHistoricalTradingDate(d) || new Date(ms(d)).getUTCDay() !== 1);
  out.push(check('list-wwdc', 'Dated lists', wwdcBad.length ? 'fail' : 'pass', 'WWDC keynote days', `${WWDC_KEYNOTES.length} keynotes ${WWDC_KEYNOTES[0]} to ${WWDC_KEYNOTES.at(-1)}${wwdcBad.length ? `; not a Monday trading day: ${wwdcBad.join(', ')}` : ', each a Monday trading day'}.`));
  const far = [];
  for (const c of EVENT_CATEGORIES) for (const e of c.episodes) {
    const bars = symbols[e.market] || [];
    if (!bars.length || e.date < bars[0].t) continue;
    const next = bars.find(b => b.t >= e.date);
    if (!next || ms(next.t) - ms(e.date) > 7 * DAY) far.push(`${e.date} ${e.name}`);
    else if (c.peak && next.t !== e.date) far.push(`${e.date} ${e.name} (peak date has no close)`);
  }
  out.push(check('list-events', 'Dated lists', far.length ? 'fail' : 'pass', 'Event catalog dates', far.length ? `No close within a week of: ${far.join('; ')}.` : `Every catalogued event date has a close within a week in its market; every peak date is a trading day.`));
  for (const [id, label] of [['cpi', 'CPI release dates'], ['jobs', 'Jobs report release dates']]) {
    const dates = (releases[id]?.dates || []).filter(d => !cutoff || d <= cutoff);
    if (!dates.length) { out.push(check(`release-${id}`, 'Dated lists', 'warn', label, 'Not collected (the build needs FRED_API_KEY).')); continue; }
    const weekend = dates.filter(d => [0, 6].includes(new Date(ms(d)).getUTCDay()));
    const months = new Set(dates.map(d => d.slice(0, 7))), gaps = [];
    for (let t = ms(dates[0].slice(0, 7) + '-01'); t <= ms(dates.at(-1).slice(0, 7) + '-01'); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) { const m = key(t).slice(0, 7); if (!months.has(m)) gaps.push(m); }
    out.push(check(`release-${id}`, 'Dated lists', weekend.length ? 'fail' : gaps.length > 2 ? 'warn' : 'pass', label, `${dates.length} past releases ${dates[0]} to ${dates.at(-1)}.` + (weekend.length ? ` ${weekend.length} dated on weekends.` : '') + (gaps.length ? ` Months with no release: ${gaps.slice(-6).join(', ')}${gaps.length > 6 ? ` and ${gaps.length - 6} more` : ''} (a missing month can be real: the fall 2025 government shutdown cancelled releases).` : ' No month is missing.')));
  }
  const summary = { pass: out.filter(c => c.status === 'pass').length, warn: out.filter(c => c.status === 'warn').length, fail: out.filter(c => c.status === 'fail').length };
  return { version: QUALITY_VERSION, cutoff: cutoff || null, summary, checks: out };
}

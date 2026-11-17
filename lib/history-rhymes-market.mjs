// Booms & busts, whole-market panel (2026-11-17): six signs that came before
// past US bear markets, read from data the site already collects, and a test
// of each sign on the site's own long history.
//
// Boom side (a market running on borrowed money and stretched prices):
//   margin-debt     FINRA margin debt, year over year (crowd.json)
//   valuation       S&P 500 earnings yield against the 10-year Treasury yield
//                   (SPY's P/E from the chains, the same reading as the
//                   Bottom tracker's valuation line)
//   credit-growth   US corporate bond sales, last three months against a
//                   year earlier (SIFMA, ipo-credit.json)
// Bust side (the brakes that came before past declines):
//   rates-rising    fed funds up from its two-year low, the 10-year yield up
//                   over a year, and hikes priced (2-year yield over fed funds)
//   curve-inverted  the 10-year minus 2-year spread below zero
//   credit-strain   Baa and high-yield spreads widening
//
// Thresholds were set from the research and the usual market reading before
// the history test was run, and were not changed after it. The test reads
// month-ends: a sign "showed before" a bear market when it was lit in the
// 12 months up to the peak, and its hit rate is the share of lit months
// followed by a new bear market (the S&P 500 closing 20% or more below its
// prior high) within 24 months, against the same share for every month.
// Months inside a decline (after a peak, up to its low) are left out: a sign
// that lights during the fall is not a warning. Margin debt, valuation and
// bond sales have no long history in the site's data, so they are not tested
// in the build (valuation was checked once by hand on Shiller's monthly data;
// the result is in its `history` note).
//
// Which signs count toward the panel's stage: every boom sign (they describe
// a boom, they are not a timing call), and a bust sign only when its own
// history test shows that lit months were followed by a bear market at least
// 1.2 times as often as other months, over 24 or more lit months
// (MARKET_COUNT_RULE). A bust sign that fails is still shown, with its record,
// and marked "not counted". When the history is missing the sign counts.
//
// Deterministic and pure. No fetch, no AI call.

import { readValuation } from './bottom-tracker.mjs';

const DAY = 86400000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (n) => (finite(n) ? Math.round(n * 10) / 10 : null);
const r2 = (n) => (finite(n) ? Math.round(n * 100) / 100 : null);
const ms = (t) => Date.parse(`${String(t).slice(0, 10)}T00:00:00Z`);
const sign = (n, d = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;

export const MARKET_SIGNS = Object.freeze([
  { id: 'margin-debt', side: 'boom', label: 'Borrowed money chases stocks', tested: false,
    rule: 'Lit when FINRA margin debt is up 30% or more from a year earlier; partly at 15%.',
    then: 'Margin debt climbed fast into the 2000, 2007 and 2021 market peaks and fell as each decline forced selling. In 1929, loans to buy stocks on margin had swelled through the late 1920s before the crash.' },
  { id: 'valuation', side: 'boom', label: 'Stocks yield less than bonds', tested: false,
    rule: 'Lit when the S&P 500 earnings yield (100 / P/E) is below the 10-year Treasury yield; partly when it is less than 1.5 points above it (the Bottom tracker\'s "expensive" line).',
    then: 'Before the 1987 crash the 10-year yield had climbed from about 7% to above 10% while stocks earned about 5% on their price, and in early 2000 stocks earned under 4% against a 6% bond yield. In 2007, 2020 and 2021 stocks still earned more than bonds, so this sign was off before those falls.',
    history: 'Checked by hand on Shiller\'s monthly S&P 500 earnings and the long Treasury yield, 1950 to mid-2023 (trailing earnings, so it reads a little differently from SPY\'s forward P/E): lit in the 12 months before 5 of 11 bear markets, and lit or partly showing before 8. But stocks earned less than bonds for most of 1969 to 1999, so a bear market followed a lit month within two years less often than after an average month (29% against 36%). Read it as a description of how expensive stocks are, not as timing.' },
  { id: 'credit-growth', side: 'boom', label: 'Companies borrow at a fast pace', tested: false,
    rule: 'Lit when US corporate bond sales over the last three months are up 25% or more from a year earlier; partly at 10%.',
    then: 'Junk bonds and leveraged loans boomed into 1989, telecom borrowing into 2000 and buyout borrowing into 2007; in each case lenders then pulled back and defaults rose. Research finds that fast credit growth is one of the steadiest signs before financial crises (Schularick and Taylor, 2012).' },
  { id: 'rates-rising', side: 'bust', label: 'The Fed and bond yields push rates up', tested: true,
    rule: 'Lit when fed funds is 1.75 points or more above its two-year low, the 10-year yield is up 1.5 points or more in a year, or fed funds is up 0.75 with more hikes priced (the 2-year yield 0.25 or more above fed funds). Partly at 0.75 (fed funds), 0.75 (10-year), or hikes priced after any rise of 0.25.',
    then: 'The Fed raised rates before the 1929, 1973, 1980, 2000 and 2007 peaks and through 2022, and the 10-year yield jumped from about 7% to above 10% in the months before the 1987 crash. It also raised rates in years that ended with no bear market, such as 1994.' },
  { id: 'curve-inverted', side: 'bust', label: 'The yield curve inverts', tested: true,
    rule: 'Lit when the 10-year yield fell below the 2-year yield on any day in the last 24 months; partly when the gap is under 0.25 points now.',
    then: 'The 10-year minus 2-year spread turned negative before the 1980, 1981, 1990, 2001 and 2008 recessions, and briefly in 2019 before the 2020 fall. It was inverted from mid-2022 into 2024.' },
  { id: 'credit-strain', side: 'bust', label: 'Credit markets start to charge more', tested: true,
    rule: 'Lit when the high-yield spread is up 0.75 points in three months or above 5.5, or the Baa spread is up 0.35 in three months; partly at 0.30 (high yield) or 0.15 (Baa). The history test reads the Baa part only (high-yield history on FRED starts in 2023).',
    then: 'Corporate spreads widened through 2000–2002 and from 2007. The Baa spread reached its highs in late 2008.' },
]);
export const MARKET_SIGN_IDS = MARKET_SIGNS.map((s) => s.id);
// A tested bust sign counts toward the stage only when its lit months were
// followed by a bear market this much more often than other months.
export const MARKET_COUNT_RULE = Object.freeze({ minLift: 1.2, minLitMonths: 24 });
export function marketSignCounts(sign, record) {
  if (!sign || sign.side !== 'bust' || !sign.tested) return { counts: true, why: null };
  if (!record || record.lift == null) return { counts: true, why: 'untested' };
  const ok = record.lift >= MARKET_COUNT_RULE.minLift && record.litMonths >= MARKET_COUNT_RULE.minLitMonths;
  return { counts: ok, why: ok ? 'passed' : 'failed' };
}

// Names for the bear markets the long S&P 500 history finds (peak month).
export const BEAR_NAMES = Object.freeze({
  '1956-08': '1956–57 slump', '1961-12': '1962 flash crash', '1966-02': '1966 credit crunch', '1968-11': '1968–70 bear market',
  '1973-01': '1973–74 oil shock', '1980-11': '1980–82 Volcker squeeze', '1987-08': '1987 crash', '2000-03': '2000–02 dot-com bust',
  '2007-10': '2007–09 financial crisis', '2020-02': '2020 COVID crash', '2022-01': '2022 rate shock',
});

// ---------------------------------------------------------------------------
// Series helpers.
export function rowsOf(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ t: r?.t ?? r?.date, v: num(r?.v ?? r?.c ?? r?.value) }))
    .filter((r) => typeof r.t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.t) && r.v != null)
    .sort((a, b) => a.t.localeCompare(b.t));
}
function at(rows, t) {
  let lo = 0, hi = rows.length - 1, out = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= t) { out = rows[m]; lo = m + 1; } else hi = m - 1; }
  return out;
}
export function addMonths(key, k) {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
const monthsBetween = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
// Per month: last value, average and low.
function monthly(rows) {
  const out = new Map();
  for (const r of rows) {
    const k = r.t.slice(0, 7);
    const m = out.get(k) || { last: null, sum: 0, n: 0, min: Infinity };
    m.last = r.v; m.sum += r.v; m.n += 1; if (r.v < m.min) m.min = r.v;
    out.set(k, m);
  }
  for (const m of out.values()) m.avg = m.sum / m.n;
  return out;
}

// ---------------------------------------------------------------------------
// Bear markets: the S&P 500 closing 20% or more below its running high. One
// bear runs from that high to the lowest close before a new high.
export function bearMarkets(spxRows, { threshold = 20 } = {}) {
  const rows = rowsOf(spxRows);
  const out = [];
  let hi = null, cur = null;
  for (const r of rows) {
    if (!hi || r.v > hi.v) {
      if (cur) { out.push(cur); cur = null; }
      hi = r;
      continue;
    }
    if (!cur && r.v <= hi.v * (1 - threshold / 100)) cur = { peak: hi.t, peakV: hi.v, trough: r.t, troughV: r.v };
    if (cur && r.v < cur.troughV) { cur.trough = r.t; cur.troughV = r.v; }
  }
  if (cur) out.push({ ...cur, ongoing: true });
  return out.map((b) => ({ peak: b.peak, trough: b.trough, fallPct: r1((b.troughV / b.peakV - 1) * 100), ongoing: !!b.ongoing, name: BEAR_NAMES[b.peak.slice(0, 7)] || null }));
}

// ---------------------------------------------------------------------------
// The tested signs as rules on monthly data, so the same code reads today and
// every past month. Each returns { status, parts } or null when the inputs
// are missing at that month.
function rateRead({ ffM, tenM, twoM }, key, nowFf = null, nowTen = null, nowTwo = null) {
  const ff = nowFf ?? ffM.get(key)?.avg;
  if (!finite(ff)) return null;
  const prior = [];
  for (let k = 1; k <= 24; k++) { const v = ffM.get(addMonths(key, -k))?.avg; if (finite(v)) prior.push(v); }
  if (prior.length < 12) return null;
  const ffUp = ff - Math.min(...prior);
  const ten = nowTen ?? tenM.get(key)?.last, tenThen = tenM.get(addMonths(key, -12))?.last;
  const tenUp = finite(ten) && finite(tenThen) ? ten - tenThen : null;
  const two = nowTwo ?? twoM.get(key)?.last;
  const gap = finite(two) ? two - ff : null;
  const priced = gap != null && gap >= 0.25;
  const lit = ffUp >= 1.75 || (tenUp != null && tenUp >= 1.5) || (ffUp >= 0.75 && priced);
  const partial = ffUp >= 0.75 || (tenUp != null && tenUp >= 0.75) || (priced && ffUp >= 0.25);
  return { status: lit ? 'lit' : partial ? 'partial' : 'clear', ff: r2(ff), ffUp: r2(ffUp), ten: r2(ten), tenUp: r2(tenUp), two: r2(two), gap: r2(gap), priced };
}
function curveRead({ curveM }, key, nowSpread = null) {
  const now = nowSpread ?? curveM.get(key)?.last;
  if (!finite(now)) return null;
  let invertedIn = null, low = null, have = 0;
  for (let k = 0; k < 24; k++) {
    const m = curveM.get(addMonths(key, -k));
    if (!m) continue;
    have += 1;
    if (m.min < 0 && invertedIn == null) invertedIn = addMonths(key, -k);
    if (low == null || m.min < low) low = m.min;
  }
  if (have < 12) return null;
  const lit = invertedIn != null || now < 0;
  return { status: lit ? 'lit' : now < 0.25 ? 'partial' : 'clear', spread: r2(now), lastInverted: invertedIn, low: r2(low) };
}
function baaRead({ baaM }, key, nowBaa = null) {
  const now = nowBaa ?? baaM.get(key)?.last, then = baaM.get(addMonths(key, -3))?.last;
  if (!finite(now) || !finite(then)) return null;
  const up = now - then;
  return { status: up >= 0.35 ? 'lit' : up >= 0.15 ? 'partial' : 'clear', baa: r2(now), baaUp: r2(up) };
}

function monthlyInputs(fred) {
  return {
    ffM: monthly(rowsOf(fred?.DFF)), tenM: monthly(rowsOf(fred?.DGS10)), twoM: monthly(rowsOf(fred?.DGS2)),
    curveM: monthly(rowsOf(fred?.T10Y2Y)), baaM: monthly(rowsOf(fred?.BAA10Y)),
  };
}

const TESTED = Object.freeze({
  'rates-rising': (inp, key) => rateRead(inp, key),
  'curve-inverted': (inp, key) => curveRead(inp, key),
  'credit-strain': (inp, key) => baaRead(inp, key),
});

// ---------------------------------------------------------------------------
// History test. `bears` defaults to the ones found in `spx`.
export function marketHistoryTest({ fred = {}, spx = [], bears = null, horizonMonths = 24, leadWindow = 12 } = {}) {
  const spxRows = rowsOf(spx);
  const bearList = Array.isArray(bears) ? bears : bearMarkets(spxRows);
  const lastSpx = spxRows.at(-1)?.t || null;
  if (!lastSpx || !bearList.length) return null;
  const inp = monthlyInputs(fred);
  const lastKey = lastSpx.slice(0, 7);
  const cutoff = addMonths(lastKey, -horizonMonths); // last month whose 24 months are complete
  const peakKeys = bearList.map((b) => ({ ...b, pk: b.peak.slice(0, 7), tk: b.trough.slice(0, 7) }));
  const inDecline = (key) => peakKeys.some((b) => key > b.pk && key <= b.tk);
  const followed = (key) => peakKeys.some((b) => b.pk > key && monthsBetween(key, b.pk) <= horizonMonths);
  const firstKey = (map) => { const ks = [...map.keys()].sort(); return ks[0] || null; };
  const starts = { 'rates-rising': firstKey(inp.ffM), 'curve-inverted': firstKey(inp.curveM), 'credit-strain': firstKey(inp.baaM) };
  const statusAt = {};
  const out = { horizonMonths, leadWindow, until: cutoff, lastData: lastSpx, signs: {}, bears: [] };
  for (const id of Object.keys(TESTED)) {
    const s0 = starts[id];
    if (!s0) continue;
    const map = new Map();
    let key = addMonths(s0, 1);
    while (key <= lastKey) { const r = TESTED[id](inp, key); if (r) map.set(key, r.status); key = addMonths(key, 1); }
    statusAt[id] = map;
    const keys = [...map.keys()].filter((k) => k <= cutoff && !inDecline(k));
    if (keys.length < 60) continue;
    const lit = keys.filter((k) => map.get(k) === 'lit');
    const showing = keys.filter((k) => map.get(k) !== 'clear');
    const rate = (ks) => (ks.length ? r1(ks.filter(followed).length / ks.length * 100) : null);
    const base = rate(keys);
    const covered = peakKeys.filter((b) => map.has(addMonths(b.pk, -leadWindow)) || map.has(b.pk));
    const before = covered.filter((b) => { for (let k = 0; k <= leadWindow; k++) if (map.get(addMonths(b.pk, -k)) === 'lit') return true; return false; });
    out.signs[id] = {
      since: [...map.keys()][0], months: keys.length, litMonths: lit.length, showingMonths: showing.length,
      basePct: base, litPct: rate(lit), showingPct: rate(showing),
      lift: base && rate(lit) != null ? r2(rate(lit) / base) : null,
      bearsCovered: covered.length, bearsBefore: before.length,
    };
  }
  // Two or more of the three bust signs (partly counts half), from the month
  // all three have data.
  const ids = Object.keys(statusAt);
  if (ids.length === 3) {
    const keysAll = [...statusAt[ids[0]].keys()].filter((k) => ids.every((id) => statusAt[id].has(k)));
    const val = (k) => ids.reduce((s, id) => s + (statusAt[id].get(k) === 'lit' ? 1 : statusAt[id].get(k) === 'partial' ? 0.5 : 0), 0);
    const keys = keysAll.filter((k) => k <= cutoff && !inDecline(k));
    if (keys.length >= 60) {
      const hit = keys.filter((k) => val(k) >= 2);
      const rate = (ks) => (ks.length ? r1(ks.filter(followed).length / ks.length * 100) : null);
      const base = rate(keys);
      const covered = peakKeys.filter((b) => keysAll.includes(b.pk));
      const before = covered.filter((b) => { for (let k = 0; k <= leadWindow; k++) if (val(addMonths(b.pk, -k)) >= 2) return true; return false; });
      out.combined = { label: 'Two or more of the three bust signs', since: keysAll[0], months: keys.length, litMonths: hit.length, basePct: base, litPct: rate(hit), lift: base && rate(hit) != null ? r2(rate(hit) / base) : null, bearsCovered: covered.length, bearsBefore: before.length };
    }
  }
  // Per bear market: the strongest status in the 12 months up to its peak,
  // and how many months before the peak the sign first lit (within 24).
  for (const b of peakKeys) {
    const reads = {};
    for (const id of ids) {
      const map = statusAt[id];
      if (!map.has(b.pk) && !map.has(addMonths(b.pk, -leadWindow))) { reads[id] = null; continue; }
      let best = 'clear';
      for (let k = 0; k <= leadWindow; k++) { const s = map.get(addMonths(b.pk, -k)); if (s === 'lit') { best = 'lit'; break; } if (s === 'partial') best = 'partial'; }
      let first = null;
      for (let k = horizonMonths; k >= 0; k--) if (map.get(addMonths(b.pk, -k)) === 'lit') { first = k; break; }
      reads[id] = { status: best, leadMonths: first };
    }
    out.bears.push({ peak: b.peak, trough: b.trough, fallPct: b.fallPct, ongoing: !!b.ongoing, name: b.name || BEAR_NAMES[b.pk] || null, reads });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Today's reading of the six market signs.
export function readMarketSigns({ fred = {}, crowd = null, chains = {}, ipoCredit = null } = {}) {
  const out = {};
  // Margin debt.
  {
    const md = crowd?.marginDebt?.summary || null;
    const yoy = num(md?.yoyPct);
    if (yoy == null) out['margin-debt'] = { status: 'unknown', now: 'No FINRA margin debt reading with a year-earlier month yet.' };
    else out['margin-debt'] = { status: yoy >= 30 ? 'lit' : yoy >= 15 ? 'partial' : 'clear', value: r1(yoy),
      now: `FINRA margin debt was $${(num(md.debitUsdM) / 1e3).toFixed(0)} billion in ${md.month}, ${sign(yoy, 1)}% from a year earlier${num(md.peak?.fromPeakPct) != null && md.peak.fromPeakPct < 0 ? ` and ${Math.abs(md.peak.fromPeakPct).toFixed(1)}% below its ${md.peak.month} high` : num(md.peak?.fromPeakPct) === 0 ? ', a record' : ''}.` };
  }
  // Valuation against bonds (the Bottom tracker's rule and inputs).
  {
    const ten = rowsOf(fred?.DGS10).at(-1)?.v ?? null;
    const f = chains?.SPY?.fundamentals || {};
    const v = readValuation(f.forwardPE ?? null, ten, null, f.trailingPE ?? null);
    if (v.status === 'unavailable') out.valuation = { status: 'unknown', now: 'No SPY P/E or 10-year yield in this build.' };
    else out.valuation = { status: v.erp < 0 ? 'lit' : v.erp < 1.5 ? 'partial' : 'clear', value: r2(v.erp),
      now: `SPY's ${v.basis} P/E is ${v.pe.toFixed(1)}, an earnings yield of ${v.earningsYield.toFixed(1)}% against a ${v.tenY.toFixed(2)}% 10-year yield: stocks earn ${Math.abs(v.erp).toFixed(1)} points ${v.erp < 0 ? 'less' : 'more'} than bonds.` };
  }
  // Corporate bond sales.
  {
    const months = Array.isArray(ipoCredit?.raises?.bonds?.months) ? ipoCredit.raises.bonds.months : [];
    const tot = (r) => (num(r.ig) || 0) + (num(r.hy) || 0) + (num(r.cv) || 0);
    if (months.length < 15) out['credit-growth'] = { status: 'unknown', now: 'Bond issuance history is too short for a year-over-year read.' };
    else {
      const a = months.slice(-3), b = months.slice(-15, -12);
      const now3 = a.reduce((s, r) => s + tot(r), 0), prev3 = b.reduce((s, r) => s + tot(r), 0);
      const hyNow = a.reduce((s, r) => s + (num(r.hy) || 0), 0), hyPrev = b.reduce((s, r) => s + (num(r.hy) || 0), 0);
      const yoy = prev3 > 0 ? (now3 / prev3 - 1) * 100 : null;
      if (yoy == null) out['credit-growth'] = { status: 'unknown', now: 'No bond issuance a year earlier to compare.' };
      else out['credit-growth'] = { status: yoy >= 25 ? 'lit' : yoy >= 10 ? 'partial' : 'clear', value: r1(yoy),
        now: `US corporate bond sales over the three months to ${a.at(-1).m} were $${now3.toFixed(0)} billion, ${sign(yoy, 1)}% from a year earlier (SIFMA). High yield was ${now3 > 0 ? Math.round(hyNow / now3 * 100) : 0}% of it, against ${prev3 > 0 ? Math.round(hyPrev / prev3 * 100) : 0}% a year earlier.` };
    }
  }
  // Rates rising.
  {
    const inp = monthlyInputs(fred);
    const ffRows = rowsOf(fred?.DFF), tenRows = rowsOf(fred?.DGS10), twoRows = rowsOf(fred?.DGS2);
    const last = ffRows.at(-1);
    if (!last) out['rates-rising'] = { status: 'unknown', now: 'No fed funds history in the cache yet.' };
    else {
      // Today: fed funds averaged over the last 30 days against the prior 24
      // monthly averages; the latest 10-year and 2-year yields.
      const recent = ffRows.filter((r) => ms(r.t) > ms(last.t) - 30 * DAY);
      const ffNow = recent.reduce((s, r) => s + r.v, 0) / recent.length;
      const key = last.t.slice(0, 7);
      const tenNow = tenRows.at(-1)?.v ?? null, twoNow = twoRows.at(-1)?.v ?? null;
      const tenThen = tenNow != null ? at(tenRows, new Date(ms(tenRows.at(-1).t) - 365 * DAY).toISOString().slice(0, 10))?.v ?? null : null;
      const r = rateRead({ ...inp, tenM: new Map(tenThen != null ? [[addMonths(key, -12), { last: tenThen }]] : []) }, key, ffNow, tenNow, twoNow);
      if (!r) out['rates-rising'] = { status: 'unknown', now: 'Not enough fed funds history in the cache.' };
      else out['rates-rising'] = { status: r.status, value: r.ffUp,
        now: [`Fed funds ${r.ff.toFixed(2)}%, ${r.ffUp > 0.05 ? `${r.ffUp.toFixed(2)} points above` : 'at'} its low of the last two years.`,
          r.tenUp != null ? `10-year yield ${r.ten.toFixed(2)}%, ${sign(r.tenUp)} over a year.` : '',
          r.gap != null ? `2-year yield ${r.two.toFixed(2)}%, ${r.priced ? `${r.gap.toFixed(2)} points above fed funds, so the market expects hikes` : r.gap <= -0.25 ? `${Math.abs(r.gap).toFixed(2)} points below fed funds, so the market expects cuts` : 'close to fed funds'}.` : ''].filter(Boolean).join(' ') };
    }
  }
  // Yield curve.
  {
    const inp = monthlyInputs(fred);
    const rows = rowsOf(fred?.T10Y2Y), last = rows.at(-1);
    const r = last ? curveRead(inp, last.t.slice(0, 7), last.v) : null;
    if (!r) out['curve-inverted'] = { status: 'unknown', now: 'Not enough yield curve history in the cache.' };
    else out['curve-inverted'] = { status: r.status, value: r.spread,
      now: `The 10-year yield is ${sign(r.spread)} points over the 2-year (${last.t}). ${r.lastInverted ? `It was last inverted in ${r.lastInverted}${r.low != null ? `, as low as ${r.low.toFixed(2)} in the last two years` : ''}.` : 'It has not been inverted in the last two years.'}` };
  }
  // Credit strain (unchanged rule; reads Baa and high yield).
  {
    const baa = rowsOf(fred?.BAA10Y), hy = rowsOf(fred?.BAMLH0A0HYM2);
    const delta = (rows, days) => { const l = rows.at(-1); if (!l) return null; const t = at(rows, new Date(ms(l.t) - days * DAY).toISOString().slice(0, 10)); return t ? l.v - t.v : null; };
    const baaUp = delta(baa, 91), hyUp = delta(hy, 91);
    const hyNow = hy.at(-1)?.v ?? null, baaNow = baa.at(-1)?.v ?? null;
    if (baaNow == null && hyNow == null) out['credit-strain'] = { status: 'unknown', now: 'No corporate spread history in the cache yet.' };
    else {
      const pctile = (rows, v) => { const vals = rows.map((r) => r.v); return vals.length ? Math.round(vals.filter((x) => x <= v).length / vals.length * 100) : null; };
      const ord = (n) => { const a = Math.abs(n) % 100, b = Math.abs(n) % 10; return n + (a >= 11 && a <= 13 ? 'th' : b === 1 ? 'st' : b === 2 ? 'nd' : b === 3 ? 'rd' : 'th'); };
      const lit = (hyUp != null && hyUp >= 0.75) || (baaUp != null && baaUp >= 0.35) || (hyNow != null && hyNow >= 5.5);
      const partial = (hyUp != null && hyUp >= 0.3) || (baaUp != null && baaUp >= 0.15);
      out['credit-strain'] = { status: lit ? 'lit' : partial ? 'partial' : 'clear', value: r2(baaNow),
        now: [baaNow != null ? `Baa corporate spread ${baaNow.toFixed(2)} points over the 10-year Treasury${baaUp != null ? ` (${sign(baaUp)} over three months)` : ''}, ${ord(pctile(baa, baaNow))} percentile since ${baa[0].t.slice(0, 4)}.` : '', hyNow != null ? `High-yield spread ${hyNow.toFixed(2)} points${hyUp != null ? ` (${sign(hyUp)} over three months)` : ''}.` : ''].filter(Boolean).join(' ') };
    }
  }
  return out;
}

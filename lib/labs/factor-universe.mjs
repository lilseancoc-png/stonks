// Factor lab, wide universe: a monthly, point-in-time history test on the
// largest US companies.
//
// The Factor lab's own history test (factors.mjs) reads price factors on the
// ~85 covered stocks. This one answers the wider question: across the 500
// largest US companies at each past month-end, did value, momentum,
// profitability, quality, earnings growth, low volatility or size predict the
// next month's return, and what was left after trading costs?
//
// Inputs are the public download on the research-factor-data branch
// (research/factor-universe/collect.mjs): the SEC's first-filed company facts
// with their filing dates, and Yahoo daily bars with dividends and splits.
// Every number used at a month-end was public by that day.
//
// Pure: no network, no file access. The result is aggregates only; no company
// is named in it.
import { finite, round, mean, sd, tStat, spearman, ols, maxDrawdown, trialsAdjustedT } from "./stats.mjs";

export const UNIVERSE_VERSION = 1;
export const UNIVERSE_SIZE = 500;
export const UNIVERSE_HORIZONS = [1, 3, 6, 12];     // months ahead
export const UNIVERSE_MIN_NAMES = 100;               // names a month needs for a factor
export const UNIVERSE_MIN_MONTHS = 36;               // months a verdict needs
export const UNIVERSE_COST_BPS = 10;                 // per side, large US stocks

export const UNIVERSE_FAMILIES = [
  { key: "value", label: "Value" },
  { key: "momentum", label: "Momentum" },
  { key: "profitability", label: "Profitability" },
  { key: "quality", label: "Quality" },
  { key: "earnings", label: "Earnings growth" },
  { key: "risk", label: "Low volatility" },
  { key: "size", label: "Smaller size" },
];
export const UNIVERSE_FACTORS = [
  { key: "ey", family: "value", label: "Earnings yield", hint: "Profit over the last four quarters per dollar of market value" },
  { key: "bm", family: "value", label: "Book to market", hint: "Shareholder equity per dollar of market value" },
  { key: "sy", family: "value", label: "Sales yield", hint: "Sales over the last four quarters per dollar of market value" },
  { key: "fcfy", family: "value", label: "Free cash flow yield", hint: "Cash from operations less capital spending, per dollar of market value" },
  { key: "mom12", family: "momentum", label: "12-month momentum", hint: "Return over the last year, skipping the last month" },
  { key: "mom6", family: "momentum", label: "6-month momentum", hint: "Return over the last six months, skipping the last month" },
  { key: "rev1", family: "momentum", label: "1-month reversal", hint: "Last month's losers (they tend to bounce)", solo: true },
  { key: "gpa", family: "profitability", label: "Gross profit to assets", hint: "Gross profit per dollar of assets" },
  { key: "roe", family: "profitability", label: "Return on equity", hint: "Profit per dollar of shareholder equity" },
  { key: "opm", family: "profitability", label: "Operating margin", hint: "Operating profit as a share of sales" },
  { key: "accr", family: "quality", label: "Profit backed by cash", hint: "Low accruals: profit that showed up as cash from operations" },
  { key: "lev", family: "quality", label: "Low debt load", hint: "Fewer liabilities against assets" },
  { key: "inv", family: "quality", label: "Slow asset growth", hint: "Companies that grew their balance sheet less over a year" },
  { key: "iss", family: "quality", label: "Few new shares", hint: "Share count flat or shrinking over a year" },
  { key: "sue", family: "earnings", label: "Earnings growth surprise", hint: "The latest quarter's profit against the same quarter a year earlier, per dollar of market value. The free stand-in for analyst revisions" },
  { key: "lowvol", family: "risk", label: "Low volatility", hint: "Calmer stocks over the last six months" },
  { key: "size", family: "size", label: "Smaller company", hint: "Smaller market value inside the 500" },
];
// Ratios that mean something different for banks and insurers.
const NOT_FOR_FINANCIALS = new Set(["gpa", "opm", "accr", "lev", "fcfy"]);
// Funds, trusts and shells that file like companies.
const SKIP_SIC = new Set([6189, 6221, 6722, 6726, 6770, 6792, 6795]);
const isFinancial = (sic) => sic >= 6000 && sic <= 6799;

// --- point-in-time fundamentals -------------------------------------------------------------
// Flow rows are [start, end, filed, value] in day numbers; the earliest filing
// of each period. Returns, for every period end, the trailing-year total and
// the day all of its parts were public: a full-year figure as filed, or the
// last full year plus this year to date minus the same stretch a year earlier.
export function ttmSeries(rows) {
  const fy = [], ytd = [];
  for (const r of rows || []) (r[1] - r[0] >= 350 ? fy : ytd).push(r);
  const out = fy.map((a) => ({ end: a[1], avail: a[2], val: a[3] }));
  for (const y of ytd) {
    const A = fy.find((a) => Math.abs(a[1] + 1 - y[0]) <= 7);
    if (!A) continue;                                   // not a year-to-date figure
    const p = ytd.find((q) => Math.abs(q[0] - A[0]) <= 7 && Math.abs(y[1] - q[1] - 365) <= 10);
    if (!p) continue;
    out.push({ end: y[1], avail: Math.max(y[2], A[2], p[2]), val: A[3] + y[3] - p[3] });
  }
  return out.sort((a, b) => a.end - b.end || a.avail - b.avail);
}
// Newest period public by `day` (and not older than `stale` days).
export function latestKnown(series, day, stale = 550) {
  let best = null;
  for (const e of series) if (e.avail <= day && e.end <= day && e.end >= day - stale && (!best || e.end > best.end)) best = e;
  return best;
}
// The entry whose period ends about `back` days before `end`, public by `day`.
function knownNear(series, day, end, back, slack) {
  let best = null;
  for (const e of series) if (e.avail <= day && Math.abs(end - e.end - back) <= slack && (!best || Math.abs(end - e.end - back) < Math.abs(end - best.end - back))) best = e;
  return best;
}
const stockSeries = (rows) => (rows || []).map((r) => ({ end: r[0], avail: r[1], val: r[2] })).sort((a, b) => a.end - b.end);

// Share count in today's terms, so it matches Yahoo's split-adjusted close.
//
// Filings give three readings, each restated for splits up to its filing day:
//   w  the weighted-average count behind earnings per share (every class),
//   c  the count on the cover page or balance sheet (newer, sometimes one class),
//   e  profit divided by earnings per share (coarse when the per-share figure
//      is a few cents; off where profit includes partners' or preferred shares).
//
// Units. Filers scale these tags differently: a count filed in thousands or
// millions reads 1,000 or 1,000,000 times too small, and now and then it is
// the per-share figure or the profit that is off instead. No one reading is
// the yardstick. Each is set against the middle of all three readings in the
// filings around it; one that sits 1,000x or 1,000,000x away is rescaled, and
// one that is still more than 30x away (a shell company's 1,000 shares) is
// left out.
//
// Splits. The price history books some spin-offs as splits (the price before
// the day is scaled down, though no share was split). Each event is read off
// the filed counts well before and after it: the count moved with it (a
// split) or did not (a spin-off). A spin-off factor applies to month-ends
// before the event only, which is what the scaled price needs. A filing made
// in the weeks before a split can already be restated for it; that too is
// read off its counts.
const SHARE_SRC = { w: 0, c: 1, e: 2 };
const EPS_FLOOR = 0.02;       // dollars a share: enough for the right order of size
const EPS_USABLE = 0.25;      // dollars a share: fine enough to stand in as a count
const SHARE_AROUND = 20;      // readings either side that set the level
const SHARE_UNIT_TOL = 0.35;  // log10: how close to exactly 1,000x a slip must be
const SHARE_JUNK = 1.5;       // log10: about 30x from the level
const SHARE_AGREE = Math.log10(1.5);
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
// Ratios a real split or stock dividend takes: any whole number, 3-for-2, 5-for-4, 5%...
const SPLIT_RATIOS = (() => { const s = []; for (let m = 2; m <= 4; m++) for (let n = m + 1; n <= 10; n++) s.push(n / m); for (let k = 1; k <= 25; k++) s.push(1 + k / 100); return s; })();
const looksLikeSplit = (r) => { const x = r >= 1 ? r : 1 / r; return (x >= 1.5 && Math.abs(x / Math.round(x) - 1) < 0.003) || SPLIT_RATIOS.some((v) => Math.abs(x / v - 1) < 0.003); };
export function sharesSeries(facts, splits) {
  const events = (splits || []).filter(([, r]) => r > 0 && r !== 1);
  const info = { rescaled: 0, dropped: 0, spins: 0 };
  const epsBy = new Map((facts?.eps || []).map((r) => [r[0] + "|" + r[1], r]));
  let rows = [];
  for (const r of facts?.ni || []) {
    const e = epsBy.get(r[0] + "|" + r[1]);
    if (!e || !(Math.abs(e[3]) >= EPS_FLOOR) || !r[3]) continue;
    const raw = r[3] / e[3];
    if (raw > 0) rows.push({ key: r[0] + "|" + r[1], end: r[1], filed: e[2], avail: Math.max(r[2], e[2]), raw, span: r[1] - r[0], src: "e", fine: Math.abs(e[3]) >= EPS_USABLE });
  }
  for (const r of facts?.wsh || []) if (r[3] > 0) rows.push({ key: r[0] + "|" + r[1], end: r[1], filed: r[2], avail: r[2], raw: r[3], span: r[1] - r[0], src: "w" });
  for (const r of facts?.sh || []) if (r[2] > 0) rows.push({ end: r[0], filed: r[1], avail: r[1], raw: r[2], span: 0, src: "c" });
  rows.sort((a, b) => a.filed - b.filed || a.end - b.end || SHARE_SRC[a.src] - SHARE_SRC[b.src]);
  // 1. Units, against the level of the readings around each one. Every event is
  //    treated as a split here: the levels only need the right order of size.
  const nominal = (day) => events.reduce((k, [d, r]) => (d > day ? k * r : k), 1);
  const logs = rows.map((e) => Math.log10(e.raw * nominal(e.filed)));
  if (rows.length >= 5) {
    rows = rows.filter((e, i) => {
      const near = [];
      for (let j = Math.max(0, i - SHARE_AROUND); j < Math.min(rows.length, i + SHARE_AROUND + 1); j++) if (j !== i) near.push(logs[j]);
      const gap = median(near) - logs[i], k = Math.round(gap / 3);
      if (k !== 0 && Math.abs(k) <= 2 && Math.abs(gap - 3 * k) < SHARE_UNIT_TOL) { e.raw *= 1000 ** k; if (e.src !== "e") info.rescaled++; return true; }
      if (Math.abs(gap) > SHARE_JUNK) { if (e.src !== "e") info.dropped++; return false; }
      return true;
    });
  }
  // 2. Split or spin-off, and from which filing the counts carry a split.
  //    A factor below one is a reverse split (a spin-off only ever lowers the
  //    price). Above one, an odd factor (2.0842) is a spin-off, and a round
  //    one (2, 3-for-2) is read off the counts: they moved with it or did not.
  const level = (list) => median(list.map((e) => Math.log10(e.raw)));
  const real = [], spins = [];
  for (const [day, ratio] of events) {
    const lr = Math.log10(ratio);
    let list = null, base = null, change = null;
    for (const src of ["w", "c", "e"]) {
      const of = rows.filter((e) => e.src === src);
      const pre = of.filter((e) => e.filed < day - 100 && e.filed >= day - 500).slice(-4), post = of.filter((e) => e.filed >= day && e.filed <= day + 400).slice(0, 4);
      if (pre.length && post.length) { list = of; base = level(pre); change = level(post) - base; break; }
    }
    const split = ratio < 1 ? true : !looksLikeSplit(ratio) ? false : change == null ? true : Math.abs(change - lr) < Math.abs(change);
    if (!split) { spins.push([day, ratio]); continue; }
    // A filing in the weeks before the split day can already be restated for it.
    let from = day;
    if (list) for (const f of [...new Set(list.filter((e) => e.filed >= day - 100 && e.filed < day).map((e) => e.filed))]) {
      const x = level(list.filter((e) => e.filed === f)) - base;
      if (Math.abs(x - lr) < Math.abs(x)) { from = f; break; }
    }
    real.push([from, ratio]);
  }
  info.spins = spins.length;
  const after = (day) => real.reduce((k, [from, r]) => (from > day ? k * r : k), 1);
  for (const e of rows) e.val = e.raw * after(e.filed);
  // 3. Profit over earnings per share stands in as a count only where it is
  //    fine enough and, period for period, agrees with the company's weighted counts.
  const eBy = new Map(rows.filter((e) => e.src === "e").map((e) => [e.key, e]));
  const gaps = rows.filter((e) => e.src === "w" && eBy.has(e.key)).map((e) => Math.log10(eBy.get(e.key).val / e.val));
  const agree = gaps.length < 4 || Math.abs(median(gaps)) < SHARE_AGREE;
  const kept = rows.filter((e) => e.src !== "e" || (agree && e.fine));
  // 4. One filing far from both neighbours of its own kind is a typo.
  const out = [];
  for (const src of Object.keys(SHARE_SRC)) {
    const list = kept.filter((e) => e.src === src).sort((a, b) => a.avail - b.avail || a.end - b.end || a.span - b.span);
    for (let i = 1; i + 1 < list.length; i++) {
      const a = list[i - 1].val, b = list[i].val, c = list[i + 1].val;
      if (Math.abs(Math.log(b / a)) > Math.log(1.6) && Math.abs(Math.log(c / a)) < Math.log(1.3)) list[i] = { ...list[i], val: a };
    }
    out.push(...list);
  }
  out.sort((a, b) => a.avail - b.avail || a.end - b.end || SHARE_SRC[a.src] - SHARE_SRC[b.src] || a.span - b.span);
  out.info = info;
  out.spins = spins;
  return out;
}
// The count row public by `day`, read from the newest period public by then
// and the 100 days before it. The largest weighted or cover count there is
// used: a cover count is newer, so a listing or a large share issue shows
// there first, but it can cover one share class of several, where the
// weighted count covers all; and a full year's weighted average lags the
// quarter before it after a listing. Profit over earnings per share stands in
// only when neither is there. `only` reads one kind of count, newest period first.
function shareRow(series, day, stale = 550, only = null) {
  let newest = null;
  for (const e of series) { if (e.avail > day) break; if (e.end >= day - stale && e.end <= day + 60 && (!only || e.src === only) && (newest == null || e.end > newest)) newest = e.end; }
  if (newest == null) return null;
  let top = null, last = null, stand = null;
  for (const e of series) {
    if (e.avail > day) break;
    if (e.end < newest - 100 || e.end > day + 60 || (only && e.src !== only)) continue;
    if (!last || e.end > last.end || (e.end === last.end && e.span < last.span)) last = e;
    if (e.src === "e") { if (!stand || e.end > stand.end || (e.end === stand.end && e.span < stand.span)) stand = e; }
    else if (!top || e.val > top.val) top = e;
  }
  return only ? last : top || stand;
}
// Shares to multiply the split-adjusted close by on `day`.
function sharesAt(series, day, stale = 550) {
  const r = shareRow(series, day, stale);
  return r ? (series.spins || []).reduce((k, [d, ratio]) => (d > day ? k * ratio : k), r.val) : null;
}

// Today's count against today's quote: the quoted share count, or the quoted
// market value over the quoted price, whichever is nearer. Past counts are
// never scaled to it. A company whose count is well above the quote (a price
// quoted per depositary share, units the listed company does not own) or well
// below it (a share class the filings do not total) is left out of the test,
// because its market value would be wrong through all of its history.
export const SHARE_CHECK_HIGH = 1.5, SHARE_CHECK_LOW = 0.5;
export function shareCheck(count, q) {
  const refs = [q?.so, q?.cap > 0 && q?.px > 0 ? q.cap / q.px : null].filter((x) => x > 0);
  if (!refs.length) return { state: "unquoted", ratio: null };
  if (!(count > 0)) return { state: "none", ratio: null };
  const ratio = refs.map((x) => count / x).sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0];
  return { state: ratio > SHARE_CHECK_HIGH ? "high" : ratio < SHARE_CHECK_LOW ? "low" : "ok", ratio };
}

// A filing whose total assets or sales read hundreds of times away from the
// filings around it was filed in the wrong units (or is a shell's, before a
// merger): nothing first reported in it is used.
const FILING_FAR = 2.3;       // log10: about 200x
function badFilings(f) {
  const bad = new Set();
  const scan = (rows, endOf, filedOf) => {
    const list = rows.filter((r) => r[r.length - 1] > 0).sort((a, b) => endOf(a) - endOf(b));
    for (let i = 0; i < list.length; i++) {
      const near = [];
      for (let j = Math.max(0, i - 4); j < Math.min(list.length, i + 5); j++) if (j !== i) near.push(Math.log10(list[j][list[j].length - 1]));
      if (near.length >= 3 && Math.abs(Math.log10(list[i][list[i].length - 1]) - median(near)) > FILING_FAR) bad.add(filedOf(list[i]));
    }
  };
  scan(f.assets || [], (r) => r[0], (r) => r[1]);
  const bySpan = new Map();
  for (const r of f.rev || []) { const k = Math.round((r[1] - r[0]) / 91); if (!bySpan.has(k)) bySpan.set(k, []); bySpan.get(k).push(r); }
  for (const rows of bySpan.values()) scan(rows, (r) => r[1], (r) => r[2]);
  return bad;
}
function withoutBadFilings(f) {
  const bad = badFilings(f);
  if (!bad.size) return { facts: f, left: 0 };
  const out = {};
  for (const [key, rows] of Object.entries(f)) out[key] = Array.isArray(rows) ? rows.filter((r) => !bad.has(r.length === 4 ? r[2] : r[1])) : rows;
  return { facts: out, left: bad.size };
}

// --- prices ------------------------------------------------------------------------------------
// Total-return index on the shared calendar (null before the first bar).
// Missing sessions carry the last value.
function totalReturn(p, n) {
  const tr = new Array(n).fill(null), px = new Array(n).fill(null);
  const div = new Map((p.d || []).map(([i, a]) => [i, a]));
  let last = null, idx = 1;
  for (let k = 0; k < p.c.length && p.s + k < n; k++) {
    const i = p.s + k, c = p.c[k];
    if (c > 0) { if (last != null) idx *= (c + (div.get(i) || 0)) / last; last = c; }
    if (last != null) { tr[i] = idx; px[i] = last; }
  }
  return { tr, px };
}

// --- one company, prepared once ---------------------------------------------------------------
function prepare(company, facts, price, calendar) {
  const n = calendar.length;
  const { tr, px } = totalReturn(price, n);
  const splits = (price.sp || []).map(([i, r]) => [calendar[i], r]);
  const { facts: f, left: filingsLeft } = withoutBadFilings(facts || {});
  const gp = f.gp?.length ? ttmSeries(f.gp) : null;
  const shares = sharesSeries(f, splits);
  // Today's count against today's quote (only for a company still trading at the end).
  let last = n - 1; while (last >= 0 && !(px[last] > 0)) last--;
  const live = last >= n - 6;
  const check = live ? shareCheck(sharesAt(shares, calendar[last]), company.q) : { state: "unquoted", ratio: null };
  return {
    sym: company.sym, sic: company.sic || null, fin: isFinancial(company.sic || 0), tr, px,
    shares, check, filingsLeft,
    rev: ttmSeries(f.rev), ni: ttmSeries(f.ni), op: ttmSeries(f.op), cfo: ttmSeries(f.cfo), capex: ttmSeries(f.capex), gp, cor: gp ? null : ttmSeries(f.cor),
    assets: stockSeries(f.assets), eq: stockSeries(f.eq), liab: stockSeries(f.liab),
  };
}

// Every factor for one company at one month-end (calendar index i, day number d).
function factorsAt(c, i, d, monthEnds, m) {
  const out = {};
  const price = c.px[i], shares = sharesAt(c.shares, d);
  const cap = price > 0 && shares > 0 ? price * shares : null;
  out.cap = cap;
  const tr = (k) => (k >= 0 && k < monthEnds.length ? c.tr[monthEnds[k]] : null);
  const now = tr(m), m1 = tr(m - 1), m6 = tr(m - 6), m12 = tr(m - 12);
  if (m1 > 0 && m12 > 0) out.mom12 = m1 / m12 - 1;
  if (m1 > 0 && m6 > 0) out.mom6 = m1 / m6 - 1;
  if (now > 0 && m1 > 0) out.rev1 = -(now / m1 - 1);
  if (i >= 126 && c.tr[i - 126] > 0) {
    const rets = [];
    for (let k = i - 125; k <= i; k++) if (c.tr[k] > 0 && c.tr[k - 1] > 0) rets.push(c.tr[k] / c.tr[k - 1] - 1);
    if (rets.length >= 100) out.lowvol = -sd(rets);
  }
  if (!cap) return out;
  out.size = -Math.log(cap);
  const ni = latestKnown(c.ni, d), rev = latestKnown(c.rev, d), cfo = latestKnown(c.cfo, d), op = latestKnown(c.op, d);
  const assets = latestKnown(c.assets, d), eq = latestKnown(c.eq, d), liab = latestKnown(c.liab, d);
  if (ni) out.ey = ni.val / cap;
  if (eq && eq.val > 0) out.bm = eq.val / cap;
  if (rev && rev.val > 0) out.sy = rev.val / cap;
  if (ni && eq && eq.val > 0) out.roe = ni.val / eq.val;
  if (ni) {
    const prev = knownNear(c.ni, d, ni.end, 91, 20);
    if (prev) out.sue = (ni.val - prev.val) / cap;
  }
  if (assets && assets.val > 0) {
    const old = knownNear(c.assets, d, assets.end, 365, 45);
    if (old && old.val > 0) out.inv = -(assets.val / old.val - 1);
  }
  // Share count against a year earlier, read from the same kind of filed count
  // (profit over earnings per share is too coarse for a change of a few percent).
  for (const src of ["w", "c"]) {
    const rowNow = shareRow(c.shares, d, 550, src), rowOld = rowNow && shareRow(c.shares, d - 365, 550, src);
    if (rowNow && rowOld && rowOld.end < rowNow.end - 250) { out.iss = -(rowNow.val / rowOld.val - 1); break; }
  }
  if (!c.fin) {
    if (cfo) { const capex = latestKnown(c.capex, d); out.fcfy = (cfo.val - (capex && capex.end === cfo.end ? Math.abs(capex.val) : 0)) / cap; }
    if (op && rev && rev.val > 0 && op.end === rev.end) out.opm = op.val / rev.val;
    if (assets && assets.val > 0) {
      const gross = c.gp ? latestKnown(c.gp, d) : null, cor = !c.gp && c.cor ? latestKnown(c.cor, d) : null;
      const gpv = gross ? gross.val : cor && rev && cor.end === rev.end ? rev.val - cor.val : null;
      if (finite(gpv)) out.gpa = gpv / assets.val;
      if (ni && cfo && ni.end === cfo.end) out.accr = -(ni.val - cfo.val) / assets.val;
      const l = liab ? liab.val : eq ? assets.val - eq.val : null;
      if (finite(l)) out.lev = -l / assets.val;
    }
  }
  return out;
}

// Percentile ranks in [0, 1] for the finite entries (ties share a rank).
function pctRanks(values) {
  const idx = values.map((v, k) => (finite(v) ? k : -1)).filter((k) => k >= 0).sort((a, b) => values[a] - values[b]);
  const out = new Array(values.length).fill(null), n = idx.length;
  for (let a = 0; a < n;) {
    let b = a; while (b + 1 < n && values[idx[b + 1]] === values[idx[a]]) b++;
    const r = n > 1 ? (a + b) / 2 / (n - 1) : 0.5;
    for (let k = a; k <= b; k++) out[idx[k]] = r;
    a = b + 1;
  }
  return out;
}

// Top fifth minus bottom fifth, tracked month by month.
function makeBook() { return { ic: Object.fromEntries(UNIVERSE_HORIZONS.map((h) => [h, []])), ls: [], top: [], turn: [], names: [], prevTop: null, prevBot: null }; }
function stepBook(book, values, fwd) {
  const have = [];
  for (let k = 0; k < values.length; k++) if (finite(values[k])) have.push(k);
  if (have.length < UNIVERSE_MIN_NAMES) return;
  book.names.push(have.length);
  for (const h of UNIVERSE_HORIZONS) {
    const xs = [], ys = [];
    for (const k of have) if (finite(fwd[h]?.[k])) { xs.push(values[k]); ys.push(fwd[h][k]); }
    if (xs.length >= UNIVERSE_MIN_NAMES) { const r = spearman(xs, ys); if (finite(r)) book.ic[h].push(r); }
  }
  const order = have.filter((k) => finite(fwd[1]?.[k])).sort((a, b) => values[a] - values[b]);
  const fifth = Math.floor(order.length / 5);
  if (fifth < 10) return;
  const bot = order.slice(0, fifth), top = order.slice(-fifth);
  // Tied values cannot be split into a top and a bottom.
  if (!(values[top[0]] > values[bot[bot.length - 1]])) return;
  const avg = (list) => mean(list.map((k) => fwd[1][k]));
  book.ls.push((avg(top) - avg(bot)) * 100);
  book.top.push((avg(top) - avg(order)) * 100);
  if (book.prevTop) {
    const kept = top.filter((k) => book.prevTop.has(book.ids[k])).length + bot.filter((k) => book.prevBot.has(book.ids[k])).length;
    book.turn.push(1 - kept / (top.length + bot.length));
  }
  book.prevTop = new Set(top.map((k) => book.ids[k])); book.prevBot = new Set(bot.map((k) => book.ids[k]));
}
function summarize(book, costBps) {
  const ls = book.ls, n = ls.length, half = Math.floor(n / 2);
  const turnover = book.turn.length ? mean(book.turn) : null;
  // Each month trades `turnover` of both sides, in and out.
  const cost = turnover != null ? turnover * 2 * 2 * (costBps / 100) : 0;
  const icRow = (h) => {
    const xs = book.ic[h], hh = Math.floor(xs.length / 2);
    return { h, n: xs.length, ic: xs.length ? round(mean(xs), 3) : null, t: xs.length > 5 ? round(tStat(xs) / Math.sqrt(h), 2) : null, first: hh > 5 ? round(mean(xs.slice(0, hh)), 3) : null, second: hh > 5 ? round(mean(xs.slice(hh)), 3) : null };
  };
  const ic = UNIVERSE_HORIZONS.map(icRow), main = ic[0];
  const s = sd(ls);
  return {
    months: n, names: book.names.length ? Math.round(mean(book.names)) : 0, ic,
    spread: n ? {
      perYear: round(mean(ls) * 12, 1), net: round((mean(ls) - cost) * 12, 1), t: n > 5 ? round(tStat(ls), 2) : null,
      sharpe: s ? round((mean(ls) / s) * Math.sqrt(12), 2) : null, netSharpe: s ? round(((mean(ls) - cost) / s) * Math.sqrt(12), 2) : null,
      worst: round(maxDrawdown(ls.map((x) => x / 100)) * 100, 1), turnover: round(turnover, 2),
      first: half > 5 ? round(mean(ls.slice(0, half)) * 12, 1) : null, second: half > 5 ? round(mean(ls.slice(half)) * 12, 1) : null,
      topVsAll: round(mean(book.top) * 12, 1),
    } : null,
    bothHalves: finite(main.first) && finite(main.second) ? Math.sign(main.first) === Math.sign(main.second) && main.first !== 0 : null,
  };
}
function verdictOf(row, tBar) {
  const main = row.ic[0];
  if (!main || row.months < UNIVERSE_MIN_MONTHS) return "few";
  const dir = Math.sign(main.ic || 0);
  if (Math.abs(main.t ?? 0) >= tBar && row.bothHalves && (row.spread?.net ?? 0) * dir > 0) return dir > 0 ? "holds" : "reversed";
  return Math.abs(main.t ?? 0) >= 2 ? "lucky" : "none";
}

// universe: { calendar: [dayNo], months: [yyyymm], companies: [{ sym, sic }] }
// prices:   { SYM: { s, c, d, sp } }     facts: { SYM: { rev, ni, ... } }
export function evaluateUniverse({ universe, prices, facts }, { size = UNIVERSE_SIZE, costBps = UNIVERSE_COST_BPS, from = null, minNames = null } = {}) {
  // The test starts at the first month with a full universe.
  if (minNames == null) minNames = size;
  const calendar = universe?.calendar || [], n = calendar.length;
  if (n < 600) return { status: "no-data", note: "The download has too little price history." };
  const iso = (d) => new Date(Date.UTC(2000, 0, 1) + d * 86400000).toISOString().slice(0, 10);
  // Last session of each month.
  const monthEnds = [], monthKey = [];
  for (let i = 0; i < n; i++) { const key = iso(calendar[i]).slice(0, 7); if (monthKey[monthKey.length - 1] === key) monthEnds[monthEnds.length - 1] = i; else { monthKey.push(key); monthEnds.push(i); } }
  // The last month is complete only when the calendar ends on its final session; drop it to be safe.
  monthEnds.pop(); monthKey.pop();
  const companies = [];
  // Share counts against today's quotes, company by company (counts only are kept).
  const shareCounts = { checked: 0, ok: 0, high: 0, low: 0, none: 0, rescaled: 0, spinoffs: 0, filingsLeft: 0 };
  for (const c of universe.companies || []) {
    if (!prices?.[c.sym] || !facts?.[c.sym] || SKIP_SIC.has(c.sic)) continue;
    const prep = prepare(c, facts[c.sym], prices[c.sym], calendar);
    if (prep.check.state !== "unquoted") { shareCounts.checked++; shareCounts[prep.check.state]++; }
    if (prep.shares.info.rescaled) shareCounts.rescaled++;
    shareCounts.spinoffs += prep.shares.info.spins; shareCounts.filingsLeft += prep.filingsLeft;
    if (prep.check.state === "high" || prep.check.state === "low") continue;
    companies.push(prep);
  }
  const M = monthEnds.length, maxH = Math.max(...UNIVERSE_HORIZONS);
  const books = Object.fromEntries(UNIVERSE_FACTORS.map((f) => [f.key, makeBook()]));
  const composite = makeBook();
  const famKeys = UNIVERSE_FAMILIES.map((f) => f.key);
  const fm = Object.fromEntries(famKeys.map((k) => [k, []]));
  const fmMonths = [];
  const sizes = [], caps = [], used = [];
  let fromIdx = null;
  for (let m = 12; m + 1 < M; m++) {
    if (from && monthKey[m] < from.slice(0, 7)) continue;
    const i = monthEnds[m], d = calendar[i];
    // Everything known this month-end, then the largest `size` by market value.
    const rows = [];
    for (const c of companies) { if (!(c.px[i] > 0)) continue; const f = factorsAt(c, i, d, monthEnds, m); if (f.cap > 0) rows.push({ c, f }); }
    if (rows.length < minNames) continue;
    rows.sort((a, b) => b.f.cap - a.f.cap);
    const members = rows.slice(0, size);
    if (fromIdx == null) fromIdx = m;
    sizes.push(members.length); caps.push(members[members.length - 1].f.cap); used.push(monthKey[m]);
    const ids = members.map((r) => r.c.sym);
    // Forward total returns over each horizon (a name that stops trading keeps its last price).
    const fwd = {};
    for (const h of UNIVERSE_HORIZONS) {
      if (m + h >= M) continue;
      const j = monthEnds[m + h];
      fwd[h] = members.map((r) => (r.c.tr[i] > 0 && r.c.tr[j] > 0 ? r.c.tr[j] / r.c.tr[i] - 1 : null));
    }
    if (!fwd[1]) continue;
    const ranksOf = {};
    for (const fdef of UNIVERSE_FACTORS) {
      const values = members.map((r) => (finite(r.f[fdef.key]) ? r.f[fdef.key] : null));
      const book = books[fdef.key]; book.ids = ids;
      stepBook(book, values, fwd);
      ranksOf[fdef.key] = pctRanks(values);
    }
    // Family score: the average rank of its factors a company has.
    const famScore = {};
    for (const fam of famKeys) {
      const keys = UNIVERSE_FACTORS.filter((f) => f.family === fam && !f.solo).map((f) => f.key);
      famScore[fam] = members.map((_, k) => { const xs = keys.map((key) => ranksOf[key][k]).filter(finite); return xs.length ? mean(xs) : null; });
    }
    // The five families the question names, equally weighted.
    const named = ["value", "momentum", "profitability", "quality", "earnings"];
    const comp = members.map((_, k) => { const xs = named.map((fam) => famScore[fam][k]); return xs.every(finite) ? mean(xs) : null; });
    composite.ids = ids; stepBook(composite, comp, fwd);
    // Fama-MacBeth: one cross-sectional regression a month on standardized family scores.
    const X = [], y = [];
    const z = {};
    for (const fam of famKeys) { const xs = famScore[fam].filter(finite), mu = mean(xs), s = sd(xs); z[fam] = famScore[fam].map((v) => (finite(v) && s ? (v - mu) / s : null)); }
    for (let k = 0; k < members.length; k++) { const row = famKeys.map((fam) => z[fam][k]); if (row.every(finite) && finite(fwd[1][k])) { X.push(row); y.push(fwd[1][k] * 100); } }
    if (X.length >= UNIVERSE_MIN_NAMES) { const fit = ols(X, y); if (fit) { famKeys.forEach((fam, a) => fm[fam].push(fit.beta[a])); fmMonths.push(monthKey[m]); } }
  }
  if (fromIdx == null) return { status: "no-data", note: "No month had enough companies with a known market value." };
  const trials = UNIVERSE_FACTORS.length + 1, tBar = trialsAdjustedT(trials);
  const factors = UNIVERSE_FACTORS.map((f) => {
    const row = { key: f.key, family: f.family, label: f.label, hint: f.hint, ...summarize(books[f.key], costBps) };
    row.verdict = verdictOf(row, tBar);
    return row;
  });
  const comp = { label: "Value, momentum, profitability, quality and earnings growth together", ...summarize(composite, costBps) };
  comp.verdict = verdictOf(comp, tBar);
  const families = UNIVERSE_FAMILIES.map((f) => {
    const xs = fm[f.key], half = Math.floor(xs.length / 2);
    return { key: f.key, label: f.label, months: xs.length, slope: xs.length ? round(mean(xs), 3) : null, t: xs.length > 5 ? round(tStat(xs), 2) : null, first: half > 5 ? round(mean(xs.slice(0, half)), 3) : null, second: half > 5 ? round(mean(xs.slice(half)), 3) : null };
  });
  return {
    status: "ok", version: UNIVERSE_VERSION, size, costBps, trials, tBar: round(tBar, 2),
    pool: companies.length, months: used.length, from: used[0], to: used[used.length - 1],
    names: Math.round(mean(sizes)), smallest: { first: round(caps[0] / 1e9, 1), last: round(caps[caps.length - 1] / 1e9, 1) },
    factors, composite: comp, families, familyMonths: fmMonths.length,
    shares: shareCounts,
  };
}
export const _test = { pctRanks, totalReturn, factorsAt, prepare, sharesAt };

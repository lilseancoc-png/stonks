// Prediction market odds tracker, test A: the market's expected number for a
// data release against what came out, and how stocks and bonds took the gap.
//
// Kalshi lists a ladder of "above X" contracts for each CPI, jobs,
// unemployment and jobless-claims release. The level where the ladder crosses
// 50% is the market's middle guess, and the levels at 90% and 10% bound its
// central 80%. Every bake keeps that guess for each open release (from the
// Crowd page's Kalshi read, no extra call); once a release settles, one call
// per series reads the settled ladder for the actual number. Releases from
// before tracking began are filled from Kalshi's hourly price history, at most
// a few calls per bake, a few levels each, nearest the result.
//
// Fed decisions are kept the same way: the expected value is the chance of a
// cut minus the chance of a hike just before the decision, the actual is +1
// cut, 0 hold, -1 hike.

import { thresholdLadder, rangeDistribution } from '../crowd/kalshi.mjs';
import { kalshiSettledEvents, kalshiHistory } from './venues.mjs';
import { etParts, addDays } from './history.mjs';
import { corr, corrP, bhAdjust, returnTables } from './reactions.mjs';

export const CONSENSUS_SERIES = Object.freeze([
  // cal: the Calendar report row (calendar.json subtype) the release matches.
  { series: 'KXCPI', label: 'CPI, month over month', unit: '%', hawk: 1, digits: 2, cal: 'cpi-mom' },
  { series: 'KXCPICOREYOY', label: 'Core CPI, year over year', unit: '%', hawk: 1, digits: 2, cal: 'core-cpi-yoy' },
  { series: 'KXPAYROLLS', label: 'Nonfarm payrolls', unit: 'k', scale: 1000, hawk: 1, digits: 0, cal: 'nfp' },
  { series: 'KXU3', label: 'Unemployment rate', unit: '%', hawk: -1, digits: 2, cal: 'unrate' },
  { series: 'KXJOBLESSCLAIMS', label: 'Initial jobless claims', unit: 'k', scale: 1000, hawk: -1, digits: 0, cal: null },
]);
export const FED_SERIES = 'KXFEDDECISION';
export const CONSENSUS_ASSETS = Object.freeze(['SPY', 'QQQ', 'IWM', 'TLT']);
// A hawkish surprise (hotter data, fewer cuts) should push bond prices down.
// Stocks can go either way, so their sign is learned on the fit half.
export const CONSENSUS_DECLARED = Object.freeze({ TLT: -1 });
export const CONSENSUS_KEEP_EVENTS = 160;
export const CONSENSUS_MIN = 30;
export const CONSENSUS_BACKFILL_LEVELS = 6;

const r = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// Middle guess and 80% band from a set of compact Kalshi markets.
export function ladderRead(markets) {
  const lad = thresholdLadder(markets || []);
  const rows = lad.rows.filter((x) => x.probAbove != null).sort((a, b) => a.level - b.level);
  const cross = (target) => {
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1], b = rows[i];
      if (a.probAbove >= target && b.probAbove <= target && a.probAbove > b.probAbove) {
        const t = (a.probAbove - target) / Math.max(1e-6, a.probAbove - b.probAbove);
        return a.level + t * (b.level - a.level);
      }
    }
    return null;
  };
  let median = lad.median;
  if (median == null) {
    const dist = rangeDistribution(markets || []);
    if (dist?.impliedMean != null) median = dist.impliedMean;
  }
  return { median: median != null ? r(median, 4) : null, lo: r(cross(0.9), 4), hi: r(cross(0.1), 4), levels: rows.length };
}

const releaseDate = (closeIso) => {
  const ms = Date.parse(closeIso || '');
  if (!Number.isFinite(ms)) return null;
  const p = etParts(ms);
  return p.hour >= 16 ? addDays(p.date, 1) : p.date;
};

function ensure(state) {
  if (!state.consensus || typeof state.consensus !== 'object') state.consensus = { events: {}, settledCheck: {} };
  state.consensus.events ||= {};
  state.consensus.settledCheck ||= {};
  return state.consensus;
}

// Each bake: the current middle guess for every open release the Crowd page
// read (crowd.json kalshi.series[*].events), plus the Fed decision odds from
// tracked Kalshi contracts.
export function snapshotConsensus(state, { crowdKalshi = null, contracts = {}, nowMs = Date.now() } = {}) {
  const cs = ensure(state);
  let n = 0;
  for (const def of CONSENSUS_SERIES) {
    const ser = crowdKalshi?.series?.[def.series];
    if (!ser || ser.ok === false) continue;
    for (const ev of Array.isArray(ser.events) ? ser.events : []) {
      if (!ev?.eventTicker) continue;
      const read = ladderRead(ev.markets);
      if (read.median == null) continue;
      const row = (cs.events[ev.eventTicker] ||= { series: def.series, kind: 'macro', title: ev.title || def.label, closeTime: ev.closeTime || null, snaps: [] });
      row.closeTime = ev.closeTime || row.closeTime;
      row.title = ev.title || row.title;
      row.strikes = (ev.markets || []).filter((m) => m.ticker).map((m) => ({ t: m.ticker, f: m.floor, c: m.cap, s: m.strikeType })).slice(0, 40);
      row.snaps.push([nowMs, read.median, read.lo, read.hi]);
      if (row.snaps.length > 40) row.snaps = row.snaps.slice(-40);
      n += 1;
    }
  }
  // Fed decisions: group tracked Kalshi KXFEDDECISION outcomes by event.
  const byEvent = {};
  for (const c of Object.values(contracts || {})) {
    if (c.venue !== 'kalshi' || c.series !== FED_SERIES || !c.eventTicker) continue;
    (byEvent[c.eventTicker] ||= []).push(c);
  }
  for (const [evt, list] of Object.entries(byEvent)) {
    const open = list.filter((c) => c.status === 'open' && c.last?.p != null);
    if (!open.length) continue;
    let cut = 0, hike = 0;
    for (const c of open) {
      const label = `${c.outcome || ''} ${c.title || ''}`.toLowerCase();
      if (/no change|hold|unchanged|maintain/.test(label)) continue;
      if (/hike|increase|raise/.test(label)) hike += c.last.p;
      else if (/cut|decrease|lower/.test(label)) cut += c.last.p;
    }
    const row = (cs.events[evt] ||= { series: FED_SERIES, kind: 'fed', title: open[0].eventTitle || 'Fed decision', closeTime: open[0].closeTime || null, snaps: [] });
    row.snaps.push([nowMs, r(cut - hike, 4), r(cut, 4), r(hike, 4)]);
    if (row.snaps.length > 40) row.snaps = row.snaps.slice(-40);
    n += 1;
  }
  return n;
}

// The actual number from a settled ladder (Kalshi's expiration value when
// it gives one, else the gap between the highest "yes" and lowest "no" level).
export function actualFromSettled(markets, def = {}) {
  const scale = def.scale > 0 ? def.scale : 1;
  for (const m of markets || []) {
    const ev = Number(String(m?.expiration_value ?? '').replace(/[,%\s]/g, ''));
    if (m?.expiration_value != null && m.expiration_value !== '' && Number.isFinite(ev)) return r(ev / scale, 4);
  }
  let lo = -Infinity, hi = Infinity, bucket = null;
  for (const m of markets || []) {
    const res = String(m?.result || '').toLowerCase();
    if (res !== 'yes' && res !== 'no') continue;
    const st = String(m?.strike_type || '');
    const f = Number.isFinite(Number(m?.floor_strike)) ? Number(m.floor_strike) / scale : null;
    const c = Number.isFinite(Number(m?.cap_strike)) ? Number(m.cap_strike) / scale : null;
    if (/between/.test(st) && f != null && c != null) { if (res === 'yes') bucket = (f + c) / 2; continue; }
    if ((/greater/.test(st) || (f != null && c == null)) && f != null) { if (res === 'yes') lo = Math.max(lo, f); else hi = Math.min(hi, f); }
    else if ((/less/.test(st) || (c != null && f == null)) && c != null) { if (res === 'yes') hi = Math.min(hi, c); else lo = Math.max(lo, c); }
  }
  if (bucket != null) return r(bucket, 4);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return r((lo + hi) / 2, 4);
  if (Number.isFinite(lo)) return r(lo, 4);
  if (Number.isFinite(hi)) return r(hi, 4);
  return null;
}

// The last guess at least 30 minutes before the release closed.
export function expectedFromSnaps(row) {
  const close = Date.parse(row?.closeTime || '');
  const snaps = (row?.snaps || []).filter((s) => !Number.isFinite(close) || s[0] <= close - 30 * 60000);
  const last = snaps[snaps.length - 1];
  return last ? { value: last[1], lo: last[2], hi: last[3], at: new Date(last[0]).toISOString() } : null;
}

// After a release closes: read the settled ladders (one call per series, at
// most once a day per series) and fill in the actual numbers; settled
// releases not seen before are added for the history backfill.
export async function settleConsensus(state, client, { nowMs = Date.now(), contracts = {} } = {}) {
  const cs = ensure(state);
  const today = etParts(nowMs).date;
  let calls = 0;
  for (const def of CONSENSUS_SERIES) {
    const pending = Object.values(cs.events).some((e) => e.series === def.series && e.actual == null && Date.parse(e.closeTime || '') < nowMs - 3600000);
    const neverRead = !cs.settledCheck[def.series];
    if (!pending && !neverRead) continue;
    if (cs.settledCheck[def.series] === today) continue;
    if (client.left() < 2) break;
    try {
      const events = await kalshiSettledEvents(client, def.series, { limit: 30 });
      calls += 1;
      for (const ev of events) {
        if (!ev?.event_ticker) continue;
        const markets = Array.isArray(ev.markets) ? ev.markets : [];
        const actual = actualFromSettled(markets, def);
        if (actual == null) continue;
        const closes = markets.map((m) => Date.parse(m?.close_time || '')).filter(Number.isFinite);
        const row = (cs.events[ev.event_ticker] ||= { series: def.series, kind: 'macro', title: ev.title || def.label, closeTime: closes.length ? new Date(Math.min(...closes)).toISOString() : null, snaps: [], backfill: true });
        row.actual = actual;
        row.settledAt = row.settledAt || new Date(nowMs).toISOString();
        if (!row.strikes || !row.strikes.length) {
          const scale = def.scale > 0 ? def.scale : 1;
          row.strikes = markets.filter((m) => m?.ticker).map((m) => ({ t: m.ticker, f: Number.isFinite(Number(m.floor_strike)) ? Number(m.floor_strike) / scale : null, c: Number.isFinite(Number(m.cap_strike)) ? Number(m.cap_strike) / scale : null, s: m.strike_type || null })).slice(0, 40);
        }
      }
      cs.settledCheck[def.series] = today;
    } catch (err) {
      client.noteError('kalshi', err);
      if (err?.budget) break;
    }
  }
  // Fed decisions: settled from the tracked outcome contracts themselves.
  const byEvent = {};
  for (const c of Object.values(contracts || {})) if (c.venue === 'kalshi' && c.series === FED_SERIES && c.eventTicker) (byEvent[c.eventTicker] ||= []).push(c);
  for (const [evt, list] of Object.entries(byEvent)) {
    const row = cs.events[evt];
    if (!row || row.actual != null) continue;
    const yes = list.find((c) => c.result === 'yes');
    if (!yes) continue;
    const label = `${yes.outcome || ''} ${yes.title || ''}`.toLowerCase();
    row.actual = /no change|hold|unchanged|maintain/.test(label) ? 0 : /hike|increase|raise/.test(label) ? -1 : /cut|decrease|lower/.test(label) ? 1 : null;
    row.settledAt = yes.resolvedAt || new Date(nowMs).toISOString();
  }
  return calls;
}

// Fills the expected value of releases settled before tracking began, from
// hourly prices of the levels nearest the result two hours before the close.
export async function backfillConsensus(state, client, { maxCalls = 30 } = {}) {
  const cs = ensure(state);
  let calls = 0;
  const todo = Object.entries(cs.events).filter(([, e]) => e.kind === 'macro' && e.actual != null && e.expected == null && !e.expectedTried && (e.snaps || []).length === 0)
    .sort((a, b) => String(b[1].closeTime).localeCompare(String(a[1].closeTime)));
  for (const [, e] of todo) {
    const close = Date.parse(e.closeTime || '');
    const strikes = (e.strikes || []).filter((s) => s.f != null || s.c != null);
    if (!Number.isFinite(close) || !strikes.length) { e.expectedTried = true; continue; }
    const near = strikes.slice().sort((a, b) => Math.abs((a.f ?? a.c) - e.actual) - Math.abs((b.f ?? b.c) - e.actual)).slice(0, CONSENSUS_BACKFILL_LEVELS);
    if (calls + near.length > maxCalls || client.left() < near.length) break;
    const at = close / 1000 - 2 * 3600;
    const markets = [];
    // A read cut short (call budget, time limit, a venue not answering) is
    // not a real try: the release is left for a later bake.
    let cutShort = false;
    for (const s of near) {
      try {
        const pts = await kalshiHistory(client, { series: e.series, ticker: s.t, startTs: at - 30 * 3600, endTs: at + 1, period: 60 });
        calls += 1;
        const last = pts.filter((x) => x[0] <= at + 1).pop();
        if (last) markets.push({ ticker: s.t, floor: s.f, cap: s.c, strikeType: s.s, prob: last[1] });
      } catch (err) {
        calls += 1;
        client.noteError('kalshi', err);
        if (err?.budget || err?.transient) { cutShort = true; break; }
      }
    }
    if (cutShort) break;
    e.expectedTried = true;
    const read = ladderRead(markets);
    if (read.median != null) {
      e.expected = read.median; e.expectedLo = read.lo; e.expectedHi = read.hi; e.expectedSource = 'history';
    }
  }
  return calls;
}

// One row per settled release with both numbers.
export function consensusRows(state) {
  const cs = state?.consensus?.events || {};
  const rows = [];
  for (const [evt, e] of Object.entries(cs)) {
    if (e.actual == null) continue;
    const snap = e.kind === 'fed' || (e.snaps || []).length ? expectedFromSnaps(e) : null;
    const expected = snap ? snap.value : e.expected;
    if (expected == null) continue;
    const def = CONSENSUS_SERIES.find((d) => d.series === e.series) || { label: 'Fed decision', unit: '', hawk: -1, digits: 2 };
    rows.push({
      event: evt, series: e.series, kind: e.kind, label: def.label, unit: def.unit, digits: def.digits ?? 2,
      title: e.title, release: releaseDate(e.closeTime), closeTime: e.closeTime,
      expected: r(expected, 4), lo: snap ? snap.lo : e.expectedLo ?? null, hi: snap ? snap.hi : e.expectedHi ?? null,
      actual: e.actual, surprise: r(e.actual - expected, 4), source: snap ? 'tracked' : 'history', hawk: def.hawk,
    });
  }
  // Standardize macro surprises by each series' own typical miss.
  const bySeries = {};
  for (const row of rows) if (row.kind === 'macro') (bySeries[row.series] ||= []).push(row);
  for (const list of Object.values(bySeries)) {
    const abs = list.map((x) => Math.abs(x.surprise)).filter(Number.isFinite).sort((a, b) => a - b);
    const med = abs.length ? abs[Math.floor(abs.length / 2)] : null;
    for (const row of list) {
      const band = row.lo != null && row.hi != null ? (row.hi - row.lo) / 2.56 : null;
      const scale = abs.length >= 6 && med > 0 ? med * 1.4826 : band && band > 0 ? band : null;
      row.z = scale ? r(row.surprise / scale, 2) : null;
      row.hawkZ = row.z != null ? r(row.hawk * row.z, 2) : null;
    }
  }
  for (const row of rows) if (row.kind === 'fed') { row.z = r(row.surprise / 0.25, 2); row.hawkZ = r(-row.surprise / 0.25, 2); }
  return rows.sort((a, b) => String(b.release).localeCompare(String(a.release)));
}

// Release-day moves for the assets, and the fit / test read per group.
export function consensusTest(rows, prices) {
  const rets = returnTables(Object.fromEntries(CONSENSUS_ASSETS.filter((s) => prices?.[s]).map((s) => [s, prices[s]])));
  for (const row of rows) {
    row.moves = {};
    for (const s of CONSENSUS_ASSETS) {
      const v = rets[s]?.get(row.release);
      if (v != null) row.moves[s] = Math.round(v * 100) / 100;
    }
  }
  const groups = { macro: rows.filter((x) => x.kind === 'macro'), fed: rows.filter((x) => x.kind === 'fed') };
  const tests = [];
  for (const [g, list] of Object.entries(groups)) {
    for (const s of CONSENSUS_ASSETS) {
      const pts = list.filter((x) => x.hawkZ != null && x.moves?.[s] != null).sort((a, b) => String(a.release).localeCompare(String(b.release)));
      const cut = Math.floor((pts.length * 2) / 3);
      const fit = pts.slice(0, cut), test = pts.slice(cut);
      let sign = CONSENSUS_DECLARED[s] || 0, learned = false;
      if (!sign && fit.length >= 6) { const rf = corr(fit.map((x) => x.hawkZ), fit.map((x) => x.moves[s])); sign = rf ? Math.sign(rf) : 0; learned = true; }
      const rt = test.length >= 4 ? corr(test.map((x) => x.hawkZ), test.map((x) => x.moves[s])) : null;
      const signedR = rt != null && sign ? rt * sign : null;
      const p = signedR != null ? (signedR > 0 ? corrP(rt, test.length) / 2 : 1 - corrP(rt, test.length) / 2) : null;
      // Move per one standard surprise, in % (all events, for display).
      const all = pts;
      let slope = null;
      if (all.length >= 6) {
        const mx = all.reduce((a, x) => a + x.hawkZ, 0) / all.length, my = all.reduce((a, x) => a + x.moves[s], 0) / all.length;
        let c = 0, v = 0;
        for (const x of all) { c += (x.hawkZ - mx) * (x.moves[s] - my); v += (x.hawkZ - mx) ** 2; }
        slope = v > 0 ? Math.round((c / v) * 1000) / 1000 : null;
      }
      tests.push({ group: g, sym: s, n: pts.length, nTest: test.length, sign, learned, rTest: r(rt), p: r(p), slope });
    }
  }
  const q = bhAdjust(tests.map((t) => (t.nTest >= 10 ? t.p : null)));
  tests.forEach((t, i) => {
    t.q = r(q[i]);
    t.verdict = t.n < CONSENSUS_MIN || t.nTest < 10 || !t.sign ? 'collecting' : q[i] != null && q[i] <= 0.1 ? 'holds' : 'no-effect';
  });
  return tests;
}

// Public: the releases coming up with the market's guess, and the recent
// ones with guess, result and how SPY / TLT took it.
export function consensusPublic(state, { crowdKalshi = null, rows = [], nowMs = Date.now() } = {}) {
  const upcoming = [];
  for (const def of CONSENSUS_SERIES) {
    const ser = crowdKalshi?.series?.[def.series];
    for (const ev of Array.isArray(ser?.events) ? ser.events : []) {
      const close = Date.parse(ev?.closeTime || '');
      if (!Number.isFinite(close) || close < nowMs) continue;
      const read = ladderRead(ev.markets);
      if (read.median == null) continue;
      upcoming.push({ series: def.series, cal: def.cal || null, label: def.label, unit: def.unit, digits: def.digits, title: ev.title || def.label, release: releaseDate(ev.closeTime), closeTime: ev.closeTime, expected: read.median, lo: read.lo, hi: read.hi, levels: read.levels, url: `https://kalshi.com/markets/${def.series.toLowerCase()}` });
    }
  }
  for (const [evt, e] of Object.entries(state?.consensus?.events || {})) {
    if (e.kind !== 'fed' || e.actual != null) continue;
    const close = Date.parse(e.closeTime || '');
    const last = (e.snaps || [])[e.snaps.length - 1];
    if (!Number.isFinite(close) || close < nowMs || !last) continue;
    upcoming.push({ series: FED_SERIES, label: 'Fed decision', unit: '', title: e.title, event: evt, release: releaseDate(e.closeTime), closeTime: e.closeTime, cut: last[2], hike: last[3], url: 'https://kalshi.com/markets/kxfeddecision' });
  }
  upcoming.sort((a, b) => String(a.closeTime).localeCompare(String(b.closeTime)));
  return {
    upcoming: upcoming.slice(0, 16),
    recent: rows.slice(0, 24).map((x) => ({ series: x.series, cal: CONSENSUS_SERIES.find((d) => d.series === x.series)?.cal || null, label: x.label, unit: x.unit, digits: x.digits, release: x.release, expected: x.expected, lo: x.lo, hi: x.hi, actual: x.actual, surprise: x.surprise, z: x.z, source: x.source, moves: x.moves || {} })),
  };
}

// Prunes old settled releases.
export function pruneConsensus(state) {
  const cs = ensure(state);
  const list = Object.entries(cs.events).sort((a, b) => String(b[1].closeTime).localeCompare(String(a[1].closeTime)));
  if (list.length <= CONSENSUS_KEEP_EVENTS) return;
  for (const [k] of list.slice(CONSENSUS_KEEP_EVENTS)) delete cs.events[k];
}


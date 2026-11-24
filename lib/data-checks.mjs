// Automatic data checks for the strategy engines (2026-11-24, owner request:
// "better than repeatedly doing audits").
//
// Every full bake looks at each data feed the engines read, before they read
// it, and asks three questions:
//   coverage    did the feed read most of the names it should? (GDELT news
//               read 2 of 64 stocks on 2026-11-23 while source health said ok)
//   believable  is every number possible? (a price move of 50% or more, a
//               Webull net share past 100%, a news spike on most stocks at
//               once, a VIX of 0, a Fear & Greed score of 140)
//   fresh       is it from the latest session, or an old copy reused quietly?
//
// A feed reads ok, warn (shown, still used) or fail. On a fail, and only in
// "guard" mode, guardEngineInputs() takes that one input away from the
// engines for the run, so every rule that reads it skips it the way it
// already skips a missing reading (no news read = the news gate never blocks;
// no VIX = no VIX pause and no panic exception; no Webull row = no big-order
// trial). Price bars are checked name by name: a name whose bars are not
// believable is left out of new entries for the run, exactly like a name
// whose bars are out of date. Earnings dates are checked and shown but never
// taken away: a missing report date would let an engine trade into a report.
//
// The result rides source-health.json (the Update Checker's data table), the
// Owner brief (a finding when a feed fails) and the engines page (what the
// last run skipped). Top Picks is not guarded here.
//
// Pure. No network, no AI. Kill switch: Owner Settings DATA_CHECKS
// ("guard", the default; "report" = checks shown, engines read everything;
// "off" = no checks).

import { sessionForDate } from "./us-equity-calendar.mjs";
import { barDate } from "./engines/features.mjs";

export const DATA_CHECKS_VERSION = 1;
export const DATA_CHECK_STATES = Object.freeze(["ok", "warn", "fail", "missing", "off"]);

// Limits. Each is a line a real market does not cross, not a tuning knob.
export const LIMITS = Object.freeze({
  coverFail: 0.5,         // under half the names read = fail
  barsCoverFail: 0.75,    // the bake's own MIN_SUCCESS_RATE
  dayMove: 0.5,           // a close 50% or more from the prior close
  printRevert: 0.05,      // ...that the next close undoes to within 5% = a bad print
  spotGap: 0.5,           // today's quote 50% or more from the last close
  barsLookback: 5,        // confirmed bars checked per name
  barsMaxDays: 5,         // newest bar more than 5 calendar days old = stale (the engines' own rule)
  badShareFail: 0.2,      // 20%+ of rows with impossible numbers = fail
  newsSpikeShare: 0.5,    // half or more of the read stocks at 2x news at once
  newsSpikeMinRead: 8,
  newsMaxRatio: 100,
  newsMaxTone: 25,
  webullMaxPct: 100,      // a net share of traded value cannot pass 100%
  sessionsBehind: { "webull-flow": 2, crowd: 2, news: 1 },
  vix: [5, 150],
  vixMaxDays: 5,
  vixLiveRatio: [1 / 3, 3],
  fear: [0, 100],
  fearMaxDays: 5,
  shortZ: 20,
  borrowFee: 1000,
});

// FRED series the engines read: a believable range and how old the newest
// row may be before it reads "warn" (stale is shown, never taken away: each
// series is already read with its own publication lag).
export const FRED_LIMITS = Object.freeze({
  DGS10: { range: [-2, 25], maxDays: 10 },
  DGS2: { range: [-2, 25], maxDays: 10 },
  T10Y2Y: { range: [-6, 6], maxDays: 10 },
  DFF: { range: [-1, 25], maxDays: 10 },
  NFCI: { range: [-3, 10], maxDays: 17 },
  DTWEXBGS: { range: [50, 250], maxDays: 17 },
  CPIAUCSL: { range: [100, 1000], maxDays: 80 },
  UNRATE: { range: [0, 30], maxDays: 80 },
  USREC: { range: [0, 1], maxDays: 200 },
});

// Each feed, what reads it, and what the guard does when it fails. Plain text
// for the pages.
export const FEEDS = Object.freeze([
  { id: "bars", label: "Daily price bars", provider: "Yahoo Finance", uses: "every engine's setups, stops and targets", guard: "a name with bars that are not believable opens nothing new this run (open trades keep their exits)" },
  { id: "option-flow", label: "Unusual option flow scan", provider: "Yahoo Finance", uses: "Flow's own setups and the call volume surge trial", guard: "no flow read this run: Flow's setups and the surge trial open nothing" },
  { id: "webull-flow", label: "Webull big-order flow", provider: "Webull OpenAPI", uses: "Flow's big-order paper trial", guard: "no big-order read: the trial opens nothing" },
  { id: "news", label: "News volume and tone", provider: "GDELT Project", uses: "the news gate on every signal engine, Downside's news points, Reversion's news tag", guard: "no news read: the gate blocks nothing and Downside adds no news points" },
  { id: "crowd", label: "Short-sale volume and borrow", provider: "FINRA / IBKR", uses: "the short-squeeze setup's heavy-shorting and hard-to-borrow points", guard: "no crowd read: those bonus points are skipped" },
  { id: "vix", label: "VIX and 3-month VIX", provider: "Cboe via FRED / Yahoo", uses: "the VIX pause, the bounce skip's panic exception, the VIX rollover trial, Macro's volatility setups", guard: "no VIX read: no VIX pause, no panic exception, no rollover trial, no volatility setups" },
  { id: "fred", label: "Rates, conditions, dollar, inflation", provider: "FRED", uses: "Macro's setups, the hikes-priced reads, the core engines' cash rate, the trade tags", guard: "a series with impossible values is left out; anything that reads it skips it" },
  { id: "fear-greed", label: "Fear & Greed", provider: "CNN", uses: "the extreme-fear bounce test and the index-fear trial", guard: "no Fear & Greed read: both open nothing" },
  { id: "sector-funds", label: "Sector fund bars", provider: "Yahoo Finance (wide tier)", uses: "the Momentum basket's sector switch", guard: "a fund that fails is left out; the basket stays in its own names" },
  { id: "earnings", label: "Earnings dates", provider: "Yahoo / Nasdaq / Webull backup", uses: "Earnings setups and every engine's stand-aside before a report", guard: "checked and shown only: a missing report date can't be skipped safely" },
]);
const FEED_BY_ID = new Map(FEEDS.map((f) => [f.id, f]));

const DAY = 86400000;
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (x == null || x === "" ? null : fin(Number(x)) ? Number(x) : null);
const dayOf = (v) => {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const daysBetween = (a, b) => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Is `date` a US stock market session? Falls back to weekdays for a year the
// holiday calendar does not list.
export function isSession(date) {
  const s = sessionForDate(date);
  if (s) return s.open !== false;
  const d = new Date(date + "T12:00:00Z").getUTCDay();
  return d !== 0 && d !== 6;
}
// The last session strictly before `today`.
export function priorSession(today) {
  let d = addDays(today, -1);
  for (let i = 0; i < 15 && !isSession(d); i++) d = addDays(d, -1);
  return d;
}
// Sessions after `date` up to and including `ref` (0 = date is ref or later).
export function sessionsBehind(date, ref) {
  if (!date || !ref || date >= ref) return 0;
  let n = 0;
  for (let d = addDays(date, 1); d <= ref && n < 400; d = addDays(d, 1)) if (isSession(d)) n++;
  return n;
}

export function dataChecksMode(env = process.env) {
  const v = String(env?.DATA_CHECKS ?? "").trim().toLowerCase();
  if (v === "off" || v === "0" || v === "false") return "off";
  if (v === "report") return "report";
  return "guard";
}

function row(id, state, bits = {}) {
  const def = FEED_BY_ID.get(id);
  return { id, label: def.label, provider: def.provider, uses: def.uses, guard: def.guard, state, coverage: null, asOf: null, why: [], ...bits };
}
const worst = (a, b) => (["ok", "warn", "missing", "fail"].indexOf(b) > ["ok", "warn", "missing", "fail"].indexOf(a) ? b : a);

// --- bars --------------------------------------------------------------------
// One name's confirmed bars (dated before today), newest last.
function confirmed(bars, today) {
  const out = [];
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = barDate(b?.t ?? b?.date);
    if (t && t < today) out.push({ t, o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c) });
  }
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out;
}
// The newest 50%+ day in a name's last bars (real or not), or null.
export function bigMove(bars) {
  const last = bars.slice(-(LIMITS.barsLookback + 1));
  for (let i = last.length - 1; i >= 1; i--) {
    const r = last[i].c / last[i - 1].c - 1;
    if (fin(r) && Math.abs(r) >= LIMITS.dayMove) return `${r > 0 ? "+" : ""}${Math.round(r * 100)}% on ${last[i].t}`;
  }
  return null;
}
// Why a name's bars are not believable, or null.
export function barsProblem(bars, spot) {
  const last = bars.slice(-(LIMITS.barsLookback + 1));
  for (const b of last) {
    if (!fin(b.c) || b.c <= 0) return `a close of ${b.c ?? "nothing"} on ${b.t}`;
    if (fin(b.h) && fin(b.l) && (b.h <= 0 || b.l <= 0 || b.h < b.l)) return `a high of ${b.h} under a low of ${b.l} on ${b.t}`;
    if (fin(b.h) && fin(b.l) && (b.c > b.h * 1.01 || b.c < b.l * 0.99)) return `a close of ${b.c} outside its day's range (${b.l} to ${b.h}) on ${b.t}`;
  }
  // A 50%+ day that undoes itself the next session (back within 5% of the
  // close before it) is a bad print, not a move: real 50% days in this
  // universe (AMD 2016-04-22, HOOD 2021-08-04, BE 2024-11-15) hold, and
  // those are left to the engines (shown as big moves, never removed).
  for (let i = 1; i < last.length - 1; i++) {
    const r = last[i].c / last[i - 1].c - 1;
    if (Math.abs(r) >= LIMITS.dayMove && Math.abs(last[i + 1].c / last[i - 1].c - 1) <= LIMITS.printRevert) return `a ${r > 0 ? "+" : ""}${Math.round(r * 100)}% day on ${last[i].t} that reversed the next session (a bad print)`;
  }
  const lc = last[last.length - 1]?.c;
  if (fin(spot) && spot > 0 && fin(lc) && lc > 0 && Math.abs(spot / lc - 1) >= LIMITS.spotGap) return `today's quote (${spot}) is ${Math.round((spot / lc - 1) * 100)}% from the last close (${lc})`;
  return null;
}
function checkBars({ today, universe, chains, barsOf }) {
  const names = {}, moves = [];
  let fresh = 0, stale = 0, missing = 0;
  for (const sym of universe) {
    const data = chains?.[sym];
    const bars = confirmed(typeof barsOf === "function" ? barsOf(sym) : [], today);
    if (!data || !(Number(data.spot) > 0) || bars.length < 2) { missing++; continue; }
    if (daysBetween(bars[bars.length - 1].t, today) > LIMITS.barsMaxDays) { stale++; continue; }
    const why = barsProblem(bars, Number(data.spot));
    if (why) { names[sym] = why; continue; }
    const big = bigMove(bars);
    if (big) moves.push(`${sym} ${big}`);
    fresh++;
  }
  const of = universe.length, bad = Object.keys(names).length;
  const r = row("bars", "ok", { coverage: { read: fresh, of }, bad, names });
  if (moves.length) r.why.push(`${moves.length} name${moves.length === 1 ? "" : "s"} with a 50%+ day that held (a real move, still read): ${moves.slice(0, 6).join(", ")}`);
  if (bad) r.why.push(`${bad} name${bad === 1 ? "" : "s"} with bars that are not believable: ${Object.entries(names).slice(0, 6).map(([s, w]) => `${s} (${w})`).join("; ")}`);
  if (stale) r.why.push(`${stale} name${stale === 1 ? "" : "s"} with bars more than ${LIMITS.barsMaxDays} days old (the engines already leave those out)`);
  if (missing) r.why.push(`${missing} name${missing === 1 ? "" : "s"} with no quote or no bars`);
  if (of && fresh / of < LIMITS.barsCoverFail) { r.state = "fail"; r.why.unshift(`only ${fresh} of ${of} names (${pct(fresh, of)}%) had fresh, believable bars`); }
  else if (bad || stale || moves.length) r.state = "warn";
  return r;
}

// --- option flow ---------------------------------------------------------------
function checkOptionFlow({ today, unusual }) {
  if (!unusual) return row("option-flow", "missing", { why: ["no fresh flow scan reached this build (the bake reads a scan only while it is recent), so the Flow setups already read nothing"] });
  const scanDay = dayOf(unusual.scannedAt);
  const contracts = (Array.isArray(unusual.tickers) ? unusual.tickers : []).flatMap((t) => (Array.isArray(t?.contracts) ? t.contracts : []).filter((c) => c && c.flagged !== false));
  const bad = contracts.filter((c) => !(num(c.premium) >= 0) || (c.volume != null && !(num(c.volume) >= 0)) || (c.dte != null && !(num(c.dte) >= 0))).length;
  const readable = contracts.filter((c) => !c.tapeStale && ["ask", "abv", "bid", "blw"].includes(c.tape)).length;
  const r = row("option-flow", "ok", { asOf: unusual.scannedAt || null, coverage: { read: readable, of: contracts.length }, bad });
  if (scanDay && scanDay !== today) { r.state = "fail"; r.why.push(`the scan is from ${scanDay}, not today`); }
  if (contracts.length && bad / contracts.length >= LIMITS.badShareFail) { r.state = "fail"; r.why.push(`${bad} of ${contracts.length} flagged prints have an impossible premium, volume or days to expiry`); }
  else if (bad) { r.state = worst(r.state, "warn"); r.why.push(`${bad} flagged print${bad === 1 ? "" : "s"} with an impossible number`); }
  if (contracts.length >= 20 && readable / contracts.length < 0.1) { r.state = worst(r.state, "warn"); r.why.push(`only ${readable} of ${contracts.length} prints had a readable bought or sold side`); }
  return r;
}

// --- Webull big-order flow -------------------------------------------------------
function checkWebullFlow({ today, stocks, webullFlow }) {
  if (!webullFlow) return row("webull-flow", "missing", { why: ["no Webull flow log this build (switched off, or the runner has not written one)"] });
  const names = {};
  let read = 0, newest = null;
  for (const [sym, r] of Object.entries(webullFlow)) {
    const wfl = num(r?.wfl), wfl5 = num(r?.wfl5), wft = num(r?.wft);
    if (!fin(wfl) && !fin(wfl5)) continue;
    if ((fin(wfl) && Math.abs(wfl) > LIMITS.webullMaxPct) || (fin(wfl5) && Math.abs(wfl5) > LIMITS.webullMaxPct) || (fin(wft) && wft < 0)) { names[sym] = `net share ${wfl ?? wfl5}%`; continue; }
    read++;
    const d = dayOf(r?.date);
    if (d && (!newest || d > newest)) newest = d;
  }
  const bad = Object.keys(names).length, of = stocks.length;
  const r = row("webull-flow", "ok", { asOf: newest, coverage: { read: Math.min(read, of), of }, bad, names });
  const behind = newest ? sessionsBehind(newest, priorSession(today)) : null;
  if (!newest) { r.state = "fail"; r.why.push("no row carries a session date"); }
  else if (behind > LIMITS.sessionsBehind["webull-flow"]) { r.state = "fail"; r.why.push(`the newest session is ${newest}, ${behind} sessions behind`); }
  if (of && read / of < LIMITS.coverFail) { r.state = "fail"; r.why.push(`read for ${read} of ${of} stocks`); }
  if (bad && (read + bad) && bad / (read + bad) >= LIMITS.badShareFail) { r.state = "fail"; r.why.push(`${bad} names past a 100% net share`); }
  else if (bad) { r.state = worst(r.state, "warn"); r.why.push(`${bad} name${bad === 1 ? "" : "s"} past a 100% net share, left out: ${Object.keys(names).slice(0, 6).join(", ")}`); }
  return r;
}

// --- news (GDELT) ---------------------------------------------------------------
function checkNews({ today, stocks, policyNews, gdelt }) {
  const rows = policyNews || {};
  let read = 0, spikes = 0, bad = 0;
  for (const s of stocks) {
    const n = rows[s];
    if (!n || !fin(num(n.nvr))) continue;
    const nvr = num(n.nvr), ntn = num(n.ntn);
    if (nvr < 0 || nvr > LIMITS.newsMaxRatio || (ntn != null && Math.abs(ntn) > LIMITS.newsMaxTone)) { bad++; continue; }
    read++;
    if (nvr >= 2) spikes++;
  }
  const of = stocks.length;
  const last = dayOf(gdelt?.lastOkDate);
  const r = row("news", "ok", { asOf: last, coverage: { read, of }, bad, spikes });
  if (!last) { r.state = "fail"; r.why.push("no day with a GDELT read"); }
  else {
    const behind = sessionsBehind(last, priorSession(today));
    if (behind > LIMITS.sessionsBehind.news) { r.state = "fail"; r.why.push(`the newest read is from ${last}`); }
  }
  if (of && read / of < LIMITS.coverFail) { r.state = "fail"; r.why.push(`read for ${read} of ${of} stocks`); }
  if (read >= LIMITS.newsSpikeMinRead && spikes / read >= LIMITS.newsSpikeShare) { r.state = "fail"; r.why.push(`${spikes} of ${read} stocks show a news spike at once, which points to a broken baseline, not news`); }
  if (bad) { r.state = (read + bad) && bad / (read + bad) >= LIMITS.badShareFail ? "fail" : worst(r.state, "warn"); r.why.push(`${bad} stock${bad === 1 ? "" : "s"} with an impossible news ratio or tone`); }
  return r;
}

// --- crowd (short-sale volume, borrow) -----------------------------------------------
function checkCrowd({ today, stocks, crowdRollup, crowd }) {
  if (!Array.isArray(crowdRollup) || !crowdRollup.length) return row("crowd", "missing", { why: ["no crowd read this build, so the bonus points already read nothing"] });
  const by = new Map(crowdRollup.map((r) => [r?.symbol, r]));
  let read = 0, bad = 0;
  for (const s of stocks) {
    const c = by.get(s);
    const z = num(c?.shortZ20), fee = num(c?.borrowFeePct);
    if ((z != null && Math.abs(z) > LIMITS.shortZ) || (fee != null && (fee < 0 || fee > LIMITS.borrowFee))) { bad++; continue; }
    if (z != null) read++;
  }
  const of = stocks.length;
  const asOf = dayOf(crowd?.shortVolume?.asOf);
  const r = row("crowd", "ok", { asOf, coverage: { read, of }, bad });
  if (!asOf) { r.state = "fail"; r.why.push("the short-sale volume block has no session date"); }
  else {
    const behind = sessionsBehind(asOf, priorSession(today));
    if (behind > LIMITS.sessionsBehind.crowd) { r.state = "fail"; r.why.push(`the newest short-sale session is ${asOf}, ${behind} sessions behind`); }
  }
  if (of && read / of < LIMITS.coverFail) { r.state = "fail"; r.why.push(`short-sale volume read for ${read} of ${of} stocks`); }
  if (bad) { r.state = (read + bad) && bad / (read + bad) >= LIMITS.badShareFail ? "fail" : worst(r.state, "warn"); r.why.push(`${bad} stock${bad === 1 ? "" : "s"} with an impossible short-volume score or borrow fee`); }
  return r;
}

// --- VIX -------------------------------------------------------------------------
const lastRow = (series) => {
  const a = Array.isArray(series) ? series : [];
  for (let i = a.length - 1; i >= 0; i--) { const t = dayOf(a[i]?.t ?? a[i]?.date), v = num(a[i]?.v ?? a[i]?.value ?? a[i]?.c); if (t && v != null) return { t, v }; }
  return null;
};
const inRange = (v, [lo, hi]) => fin(v) && v >= lo && v <= hi;
function checkVix({ today, vix, vix3m, liveVol }) {
  const lv = lastRow(vix), l3 = lastRow(vix3m);
  if (!lv) return row("vix", "fail", { why: ["no VIX closes"] });
  const r = row("vix", "ok", { asOf: lv.t, value: lv.v });
  if (!inRange(lv.v, LIMITS.vix)) { r.state = "fail"; r.why.push(`the last VIX close (${lv.v} on ${lv.t}) is outside ${LIMITS.vix[0]} to ${LIMITS.vix[1]}`); }
  if (daysBetween(lv.t, today) > LIMITS.vixMaxDays) { r.state = "fail"; r.why.push(`the last VIX close is from ${lv.t}`); }
  if (l3 && !inRange(l3.v, LIMITS.vix)) { r.state = "fail"; r.why.push(`the last 3-month VIX close (${l3.v}) is outside ${LIMITS.vix[0]} to ${LIMITS.vix[1]}`); }
  if (!l3) { r.state = worst(r.state, "warn"); r.why.push("no 3-month VIX closes, so the VIX curve reads are blank"); }
  r.liveOk = true;
  if (liveVol) {
    const v = num(liveVol.vix), v3 = num(liveVol.vix3m);
    const ratio = fin(v) && lv.v > 0 ? v / lv.v : null;
    if (!inRange(v, LIMITS.vix) || (v3 != null && !inRange(v3, LIMITS.vix)) || !(ratio >= LIMITS.vixLiveRatio[0] && ratio <= LIMITS.vixLiveRatio[1])) {
      r.liveOk = false; r.state = worst(r.state, "warn");
      r.why.push(`today's VIX quote (${v}) is not believable next to the last close (${lv.v}); the engines read the close instead`);
    }
  }
  return r;
}

// --- FRED --------------------------------------------------------------------------
function checkFred({ today, fred }) {
  const series = {};
  let state = "ok";
  const why = [];
  for (const [id, lim] of Object.entries(FRED_LIMITS)) {
    const lr = lastRow(fred?.[id]);
    if (!lr) { series[id] = "missing"; state = worst(state, "warn"); why.push(`${id}: no rows`); continue; }
    // Every row in the window the engines read back over (a year-on-year
    // change and a 182-day change, plus the publication lag) must be
    // possible, not only the newest.
    const from = addDays(today, -400);
    const recent = (Array.isArray(fred[id]) ? fred[id] : []).filter((x) => (dayOf(x?.t ?? x?.date) || "") >= from);
    const badRow = recent.find((x) => { const v = num(x?.v ?? x?.value ?? x?.c); return v != null && !inRange(v, lim.range); });
    if (badRow) { series[id] = "fail"; state = "fail"; why.push(`${id}: ${num(badRow.v ?? badRow.value ?? badRow.c)} on ${dayOf(badRow.t ?? badRow.date)} is outside ${lim.range[0]} to ${lim.range[1]}`); continue; }
    if (daysBetween(lr.t, today) > lim.maxDays) { series[id] = "warn"; state = worst(state, "warn"); why.push(`${id}: newest row ${lr.t}`); continue; }
    series[id] = "ok";
  }
  const ids = Object.keys(FRED_LIMITS);
  return row("fred", state, { series, coverage: { read: ids.filter((k) => series[k] === "ok").length, of: ids.length }, why });
}

// --- Fear & Greed -----------------------------------------------------------------------
function checkFear({ today, fearGreed, fearHistory }) {
  const r = row("fear-greed", "ok", { asOf: dayOf(fearGreed?.asOf), historyOk: true, snapshotOk: true });
  if (!fearGreed) { r.state = "warn"; r.why.push("no Fear & Greed snapshot this build"); }
  else {
    const s = num(fearGreed.score);
    if (!inRange(s, LIMITS.fear)) { r.state = "fail"; r.snapshotOk = false; r.why.push(`a score of ${fearGreed.score} is outside 0 to 100`); }
    if (fearGreed.stale) { r.state = worst(r.state, "warn"); r.why.push("the snapshot is a carried last-good copy (the engines already ignore it)"); }
  }
  const rows = (Array.isArray(fearHistory) ? fearHistory : []).slice(-10);
  const badRow = rows.find((x) => { const v = num(Array.isArray(x) ? x[1] : x?.score); return v != null && !inRange(v, LIMITS.fear); });
  if (badRow) { r.state = "fail"; r.historyOk = false; r.why.push(`a daily close of ${Array.isArray(badRow) ? badRow[1] : badRow.score} is outside 0 to 100`); }
  const last = lastRow(rows.map((x) => (Array.isArray(x) ? { t: x[0], v: x[1] } : { t: x?.date, v: x?.score })).filter((x) => x.t < today));
  if (!last || daysBetween(last.t, today) > LIMITS.fearMaxDays) { r.state = worst(r.state, "warn"); r.why.push(last ? `the newest daily close is from ${last.t}` : "no daily closes"); }
  return r;
}

// --- sector funds --------------------------------------------------------------------------
function checkSectorFunds({ today, sectorBars, sectorSpot }) {
  if (!sectorBars || typeof sectorBars !== "object") return row("sector-funds", "missing", { why: ["no sector fund bars this build, so the basket already stays in its own names"] });
  const names = {};
  let read = 0;
  const syms = Object.keys(sectorBars);
  for (const sym of syms) {
    const bars = confirmed(sectorBars[sym], today);
    if (bars.length < 2) { names[sym] = "too few bars"; continue; }
    if (daysBetween(bars[bars.length - 1].t, today) > LIMITS.barsMaxDays) { names[sym] = `newest bar ${bars[bars.length - 1].t}`; continue; }
    const why = barsProblem(bars, num(sectorSpot?.[sym]));
    if (why) { names[sym] = why; continue; }
    read++;
  }
  const bad = Object.keys(names).length;
  const r = row("sector-funds", "ok", { coverage: { read, of: syms.length }, bad, names });
  if (bad) { r.state = read ? "warn" : "fail"; r.why.push(`${bad} fund${bad === 1 ? "" : "s"} left out: ${Object.entries(names).slice(0, 6).map(([s, w]) => `${s} (${w})`).join("; ")}`); }
  return r;
}

// --- earnings (shown, never taken away) ------------------------------------------------------
function checkEarnings({ today, stocks, chains, earningsStore }) {
  let read = 0, pastNext = 0;
  const past = [];
  for (const s of stocks) {
    const ev = earningsStore?.tickers?.[s]?.events;
    if (Array.isArray(ev) && ev.length) read++;
    const nx = dayOf(chains?.[s]?.earningsHx?.next?.date);
    if (nx && daysBetween(nx, today) > 3) { pastNext++; past.push(`${s} ${nx}`); }
  }
  const of = stocks.length;
  const r = row("earnings", "ok", { coverage: { read, of }, bad: pastNext });
  if (of && read / of < 0.75) { r.state = "warn"; r.why.push(`report history for ${read} of ${of} stocks`); }
  if (pastNext) { r.state = "warn"; r.why.push(`${pastNext} "next report" date${pastNext === 1 ? " is" : "s are"} already past: ${past.slice(0, 6).join(", ")}`); }
  return r;
}

// input: the same fields the bake passes to runEngines (only the feed parts
// are read) plus `crowd` (the whole crowd payload, for its session date) and
// `gdelt` (the policy-news GDELT block, for its last good day).
// switchedOff: feed ids whose own source switch is off (GDELT_NEWS=0,
// CROWD=0). A feed switched off on purpose reads "missing", not "fail", and
// is not guarded: its rules already read nothing new.
export function feedsSwitchedOff(env = process.env) {
  const off = (v) => /^(?:0|false|off)$/i.test(String(v ?? "").trim());
  const out = [];
  if (off(env?.GDELT_NEWS)) out.push("news");
  if (off(env?.CROWD)) out.push("crowd");
  return out;
}

export function checkEngineFeeds(input, { today, builtAtIso = null, mode = "guard", universe = null, stocks = null, switchedOff = [] } = {}) {
  if (mode === "off") return null;
  const offSet = new Set(Array.isArray(switchedOff) ? switchedOff : []);
  const tickers = Array.isArray(input?.tickers) ? input.tickers : [];
  const isEtf = typeof input?.isEtf === "function" ? input.isEtf : () => false;
  const uni = universe || tickers;
  const st = stocks || tickers.filter((s) => !isEtf(s));
  const parts = [
    ["bars", () => checkBars({ today, universe: uni, chains: input.chains, barsOf: input.barsOf })],
    ["option-flow", () => checkOptionFlow({ today, unusual: input.unusual })],
    ["webull-flow", () => checkWebullFlow({ today, stocks: st, webullFlow: input.webullFlow })],
    ["news", () => checkNews({ today, stocks: st, policyNews: input.policyNews, gdelt: input.gdelt })],
    ["crowd", () => checkCrowd({ today, stocks: st, crowdRollup: input.crowdRollup, crowd: input.crowd })],
    ["vix", () => checkVix({ today, vix: input.vix, vix3m: input.vix3m, liveVol: input.liveVol })],
    ["fred", () => checkFred({ today, fred: input.fred })],
    ["fear-greed", () => checkFear({ today, fearGreed: input.fearGreed, fearHistory: input.fearHistory })],
    ["sector-funds", () => checkSectorFunds({ today, sectorBars: input.sectorBars, sectorSpot: input.sectorSpot })],
    ["earnings", () => checkEarnings({ today, stocks: st, chains: input.chains, earningsStore: input.earningsStore })],
  ];
  const feeds = parts.map(([id, fn]) => {
    if (offSet.has(id)) return row(id, "missing", { why: ["switched off in Owner Settings, so its rules read nothing new"] });
    try { return fn(); } catch (err) { return row(id, "fail", { why: [`the check itself failed: ${String(err?.message || err).split("\n")[0].slice(0, 160)}`] }); }
  });
  for (const f of feeds) {
    f.guarded = mode === "guard" && guardApplies(f);
    f.detail = f.why.length ? f.why.join("; ") + "." : f.state === "ok" ? "Covered, believable and fresh." : "";
  }
  return {
    version: DATA_CHECKS_VERSION, builtAtIso, today, mode,
    counts: { feeds: feeds.length, ok: feeds.filter((f) => f.state === "ok").length, warn: feeds.filter((f) => f.state === "warn").length, fail: feeds.filter((f) => f.state === "fail").length, guarded: feeds.filter((f) => f.guarded).length },
    feeds,
  };
}

// Does the guard take something away for this feed? Bars and sector funds
// act name by name (any bad name), FRED series by series, VIX's live quote
// on its own; the rest only on a whole-feed fail. Earnings never.
function guardApplies(f) {
  if (f.id === "earnings") return false;
  if (f.id === "bars" || f.id === "sector-funds" || f.id === "webull-flow") return f.state === "fail" || (f.bad || 0) > 0;
  if (f.id === "fred") return Object.values(f.series || {}).includes("fail");
  if (f.id === "vix") return f.state === "fail" || f.liveOk === false;
  if (f.id === "fear-greed") return f.snapshotOk === false || f.historyOk === false;
  return f.state === "fail";
}

// The engine input with every failed feed taken away, plus `dataGuard` (what
// was taken and why, for the engines page). A copy: the bake's own objects
// are never changed. Report mode and a null check return the input as is.
export function guardEngineInputs(input, checks) {
  if (!checks || checks.mode !== "guard") return input;
  const out = { ...input };
  const skipped = [], names = {};
  const note = (f, what) => skipped.push({ id: f.id, label: f.label, what, why: f.detail });
  for (const f of checks.feeds) {
    if (!f.guarded) continue;
    switch (f.id) {
      case "bars": for (const [s, w] of Object.entries(f.names || {})) names[s] = w; if (Object.keys(f.names || {}).length) note(f, `${Object.keys(f.names).length} name(s) open nothing new`); break;
      case "option-flow": out.unusual = null; note(f, "Flow setups and the surge trial skipped"); break;
      case "webull-flow":
        if (f.state === "fail") { out.webullFlow = null; note(f, "big-order trial skipped"); }
        else { const w = { ...(input.webullFlow || {}) }; for (const s of Object.keys(f.names || {})) delete w[s]; out.webullFlow = w; note(f, `${Object.keys(f.names || {}).length} name(s) left out of the big-order trial`); }
        break;
      case "news":
        if (input.policyNews) {
          // Federal Register counts stay; only the GDELT reads go.
          const pn = {};
          for (const [s, r] of Object.entries(input.policyNews)) { const { nvr, ntn, ...rest } = r || {}; if (Object.keys(rest).length) pn[s] = rest; }
          out.policyNews = pn;
        }
        note(f, "news gate and news points skipped");
        break;
      case "crowd": out.crowdRollup = null; note(f, "short-volume and borrow points skipped"); break;
      case "vix":
        if (f.state === "fail") { out.vix = null; out.vix3m = null; out.liveVol = null; note(f, "VIX reads skipped"); }
        else { out.liveVol = null; note(f, "today's VIX quote skipped; the last close is read"); }
        break;
      case "fred": {
        const fred = { ...(input.fred || {}) };
        const bad = Object.entries(f.series || {}).filter(([, s]) => s === "fail").map(([k]) => k);
        for (const k of bad) fred[k] = [];
        out.fred = fred;
        note(f, `${bad.join(", ")} left out`);
        break;
      }
      case "fear-greed":
        if (f.snapshotOk === false) out.fearGreed = null;
        if (f.historyOk === false) out.fearHistory = [];
        note(f, "fear tests skipped");
        break;
      case "sector-funds":
        if (f.state === "fail") { out.sectorBars = null; out.sectorSpot = null; note(f, "sector switch skipped"); }
        else {
          const b = { ...(input.sectorBars || {}) }, sp = { ...(input.sectorSpot || {}) };
          for (const s of Object.keys(f.names || {})) { delete b[s]; delete sp[s]; }
          out.sectorBars = b; out.sectorSpot = sp; note(f, `${Object.keys(f.names || {}).length} fund(s) left out`);
        }
        break;
      default: break;
    }
  }
  out.dataGuard = { mode: checks.mode, skipped, names };
  return out;
}

// Compact form for source-health.json and the Owner brief (no per-name maps
// past a handful, strings capped).
export function compactChecks(checks) {
  if (!checks) return null;
  return {
    version: checks.version, builtAtIso: checks.builtAtIso, mode: checks.mode, counts: checks.counts,
    feeds: checks.feeds.map((f) => ({
      id: f.id, label: f.label, provider: f.provider, state: f.state, guarded: !!f.guarded,
      coverage: f.coverage ? { read: f.coverage.read, of: f.coverage.of } : null, asOf: f.asOf || null,
      uses: f.uses, guard: f.guard, detail: String(f.detail || "").slice(0, 400),
    })),
  };
}

// One Owner brief line for the feeds that failed (null when none did).
export function checksBriefLine(checks) {
  const c = checks && Array.isArray(checks.feeds) ? checks : null;
  if (!c) return null;
  const failed = c.feeds.filter((f) => f.state === "fail");
  if (!failed.length) return null;
  const lines = failed.slice(0, 5).map((f) => `${f.label}: ${String(f.detail || "").replace(/\.$/, "")}${c.mode === "guard" && f.guarded ? `. Engines: ${f.guard}` : ""}.`);
  const tail = c.mode === "guard" ? "" : " Data checks are in report mode, so the engines still read these feeds.";
  return { title: `${failed.length} data feed${failed.length === 1 ? "" : "s"} failed the automatic check`, detail: lines.join(" ") + tail };
}
